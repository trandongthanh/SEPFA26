import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  applyBankPatch,
  BankFields,
  BankInfo,
  pickBank,
} from '../common/bank-info';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { QueryUnmatchedTransactionDto } from './dto/query-unmatched-transaction.dto';
import { RefundUnmatchedTransactionDto } from './dto/refund-unmatched-transaction.dto';
import { Disbursement } from './entities/disbursement.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import {
  RecipientType,
  resolveRefundTarget,
  suggestedRecipientType,
} from './unmatched-refund-rules';
import { UnmatchedReason } from './unmatched-reasons';

export interface SuggestedRecipient {
  type: RecipientType;
  id: string;
  name: string | null;
  bank: BankInfo | null;
}

/**
 * "Hộp tiền chưa khớp" cho admin: tiền thật đã vào tài khoản nền tảng nhưng không ghi nhận được vào đơn
 * (dòng `transactions` PENDING, lý do ở `unmatched_reason`). Admin xem và bấm Hoàn → lệnh chi
 * UNMATCHED_REFUND chi ngay; chuyển khoản xong thì bấm "Đã chuyển" ở màn lệnh chi như mọi lệnh khác.
 * Không ghi sổ ký quỹ: tiền này chưa từng vào sổ của đơn nào.
 */
@Injectable()
export class UnmatchedTransactionsService {
  constructor(
    @InjectRepository(PaymentTransaction)
    private readonly transactionRepo: Repository<PaymentTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  /** GET /admin/unmatched-transactions — tiền về gần nhất lên đầu. */
  async list(query: QueryUnmatchedTransactionDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const qb = this.withRelations()
      .where('txn.status = :status', { status: 'PENDING' })
      .andWhere('txn.direction = :direction', { direction: 'IN' })
      .orderBy('txn.createdAt', 'DESC')
      .addOrderBy('txn.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);
    if (query.status === 'OPEN') {
      qb.andWhere('txn.refund_disbursement_id IS NULL');
    } else if (query.status === 'RESOLVED') {
      qb.andWhere('txn.refund_disbursement_id IS NOT NULL');
    }
    const [rows, total] = await qb.getManyAndCount();
    return { data: rows.map((row) => this.toView(row)), total, page, limit };
  }

  /**
   * POST /admin/unmatched-transactions/:id/refund — khoá dòng tiền vào (cùng kiểu webhook nâng PENDING →
   * SUCCESS) nên hoàn và ghi nhận không chạy chồng; một khoản chỉ hoàn được một lần.
   */
  async refund(
    adminAccountId: string,
    transactionId: string,
    dto: RefundUnmatchedTransactionDto,
  ) {
    const requestedBank = this.requestedBank(dto);
    await this.dataSource.transaction(async (manager) => {
      const txn = await manager.findOne(PaymentTransaction, {
        where: { id: transactionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!txn) {
        throw new NotFoundException('UNMATCHED_TRANSACTION_NOT_FOUND');
      }
      if (txn.refundDisbursementId) {
        throw new ConflictException('TRANSACTION_ALREADY_RESOLVED');
      }
      if (txn.status !== 'PENDING' || txn.direction !== 'IN') {
        // SUCCESS = tiền đã vào đơn, hoàn đi đường chia tiền / huỷ đơn, không đi đường này.
        throw new ConflictException('TRANSACTION_NOT_REFUNDABLE');
      }
      const order = txn.serviceOrderId
        ? await manager.findOne(ServiceOrder, {
            where: { id: txn.serviceOrderId },
            relations: { customer: { account: true }, provider: true },
          })
        : null;
      const suggested = this.suggest(txn.unmatchedReason, order);
      const note = dto.note || null;
      const target = resolveRefundTarget({
        hasOrder: order !== null,
        suggested,
        requestedBank,
        note,
      });

      const now = new Date();
      const disbursement = await manager.save(
        manager.create(Disbursement, {
          serviceOrderId: txn.serviceOrderId,
          customerId: target.customerId,
          providerId: target.providerId,
          sourceTransactionId: txn.id,
          type: 'UNMATCHED_REFUND' as const,
          amount: txn.amount,
          eligibleAt: now,
          bankName: target.bank.bankName,
          bankAccount: target.bank.bankAccount,
          bankHolder: target.bank.bankHolder,
          bankBin: target.bank.bankBin,
          status: 'PENDING' as const,
        }),
      );
      txn.refundDisbursementId = disbursement.id;
      txn.resolvedByAccountId = adminAccountId;
      txn.resolvedAt = now;
      txn.resolutionNote = note;
      await manager.save(txn);
    });

    const saved = await this.withRelations()
      .where('txn.id = :id', { id: transactionId })
      .getOneOrFail();
    return this.toView(saved);
  }

  private withRelations() {
    return this.transactionRepo
      .createQueryBuilder('txn')
      .leftJoinAndSelect('txn.serviceOrder', 'serviceOrder')
      .leftJoinAndSelect('serviceOrder.customer', 'customer')
      .leftJoinAndSelect('customer.account', 'customerAccount')
      .leftJoinAndSelect('serviceOrder.provider', 'provider')
      .leftJoinAndSelect('txn.refundDisbursement', 'refundDisbursement')
      .leftJoinAndSelect('txn.resolvedBy', 'resolvedBy');
  }

  // Tài khoản admin nhập tay: không gửi gì → null; gửi thì phải đủ bộ 3 (applyBankPatch ném 400).
  private requestedBank(dto: RefundUnmatchedTransactionDto): BankInfo | null {
    const target: BankFields = {
      bankName: null,
      bankAccount: null,
      bankHolder: null,
      bankBin: null,
    };
    applyBankPatch(target, {
      bankName: dto.bankName,
      bankAccount: dto.bankAccount,
      bankHolder: dto.bankHolder,
      bankBin: dto.bankBin,
    });
    return pickBank(target);
  }

  // Người nhận gợi ý + tài khoản trong hồ sơ của họ (đơn cần nạp sẵn customer.account + provider).
  private suggest(
    reason: UnmatchedReason | null,
    order: ServiceOrder | null,
  ): SuggestedRecipient | null {
    const type = suggestedRecipientType(reason, order !== null);
    if (!order || !type) return null;
    if (type === 'PROVIDER') {
      return {
        type,
        id: order.providerId,
        name: order.provider?.displayName ?? null,
        bank: order.provider ? pickBank(order.provider) : null,
      };
    }
    return {
      type,
      id: order.customerId,
      name: order.customer?.account?.fullName ?? null,
      bank: order.customer ? pickBank(order.customer) : null,
    };
  }

  private toView(row: PaymentTransaction) {
    const suggested = this.suggest(row.unmatchedReason, row.serviceOrder);
    return {
      id: row.id,
      sepayTxnId: row.sepayTxnId,
      amount: row.amount,
      transferContent: row.transferContent,
      receivedAt: row.createdAt,
      // Dòng PENDING từ trước khi có cột lý do.
      reason: row.unmatchedReason ?? ('LEGACY_UNKNOWN' as const),
      order: row.serviceOrder
        ? { id: row.serviceOrder.id, orderCode: row.serviceOrder.orderCode }
        : null,
      suggestedRecipient: suggested,
      resolution: row.refundDisbursementId
        ? {
            disbursementId: row.refundDisbursementId,
            disbursementStatus: row.refundDisbursement?.status ?? null,
            resolvedBy: row.resolvedBy?.fullName ?? null,
            resolvedAt: row.resolvedAt,
            note: row.resolutionNote,
          }
        : null,
    };
  }
}
