import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { CreatePaymentClaimDto } from './dto/create-payment-claim.dto';
import { QueryPaymentClaimDto } from './dto/query-payment-claim.dto';
import { RejectPaymentClaimDto } from './dto/reject-payment-claim.dto';
import { PaymentClaimPhoto } from './entities/payment-claim-photo.entity';
import { PaymentClaim } from './entities/payment-claim.entity';
import {
  claimPartyOf,
  PAYMENT_CLAIM_MAX_OPEN,
  PaymentClaimParty,
} from './payment-claim-rules';

// Ảnh cùng một lần nộp có cùng created_at → thêm id cho thứ tự ổn định (giống listForOrder).
function sortPhotos(photos: PaymentClaimPhoto[] | undefined) {
  return [...(photos ?? [])].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
}

/**
 * Phiếu báo đã chuyển tiền: khách / vườn của đơn báo "đã chuyển nhưng chưa được ghi nhận", kèm ảnh sao kê.
 * Chỉ lưu lời khai + ảnh cho admin đối chiếu — không ghi sổ ký quỹ, không đổi số tiền nào.
 * Nộp được ở mọi trạng thái đơn (đơn có thể đã tự huỷ vì quá hạn trả tiền trong lúc tiền đang lạc).
 */
@Injectable()
export class PaymentClaimsService {
  constructor(
    @InjectRepository(PaymentClaim)
    private readonly claimRepo: Repository<PaymentClaim>,
    @InjectRepository(ServiceOrder)
    private readonly orderRepo: Repository<ServiceOrder>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * POST /orders/:orderId/payment-claims — khoá dòng đơn để hai lần bấm cùng lúc không vượt 3 phiếu mở.
   * Người ngoài đơn nhận 404 như đơn không tồn tại (không lộ đơn của người khác).
   */
  async create(accountId: string, orderId: string, dto: CreatePaymentClaimDto) {
    return this.dataSource.transaction(async (manager) => {
      // Postgres không cho FOR UPDATE trên LEFT JOIN phía nullable → khoá riêng dòng đơn, nạp hai bên sau.
      const order = await manager.findOne(ServiceOrder, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) {
        throw new NotFoundException('ORDER_NOT_FOUND');
      }
      // Tuần tự: cùng một kết nối của transaction.
      const customer = await manager.findOne(CustomerProfile, {
        where: { id: order.customerId },
        select: { id: true, accountId: true },
      });
      const provider = await manager.findOne(ProviderProfile, {
        where: { id: order.providerId },
        select: { id: true, accountId: true },
      });
      const party = this.partyOrNotFound(
        accountId,
        customer?.accountId ?? null,
        provider?.accountId ?? null,
      );

      const openCount = await manager.count(PaymentClaim, {
        where: { serviceOrderId: orderId, party, status: 'OPEN' },
      });
      if (openCount >= PAYMENT_CLAIM_MAX_OPEN) {
        throw new ConflictException('PAYMENT_CLAIM_LIMIT_REACHED');
      }

      const claim = await manager.save(
        manager.create(PaymentClaim, {
          serviceOrderId: orderId,
          party,
          submittedByAccountId: accountId,
          amount: String(dto.amount),
          transferredAt: dto.transferredAt ? new Date(dto.transferredAt) : null,
          note: dto.note || null,
          status: 'OPEN' as const,
          transactionId: null,
          handledByAccountId: null,
          handledAt: null,
          rejectReason: null,
        }),
      );
      const photos = await manager.save(
        dto.photos.map((photo) =>
          manager.create(PaymentClaimPhoto, {
            claimId: claim.id,
            photoUrl: photo.photoUrl,
          }),
        ),
      );
      // Phiếu mới chưa gắn khoản tiền nào → refund null, không cần đọc lại.
      return this.toView({ ...claim, photos, transaction: null });
    });
  }

  /** GET /orders/:orderId/payment-claims — chỉ phiếu của chính bên gọi, mới nhất lên đầu. */
  async listForOrder(accountId: string, orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: { customer: true, provider: true },
    });
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    const party = this.partyOrNotFound(
      accountId,
      order.customer?.accountId ?? null,
      order.provider?.accountId ?? null,
    );
    const claims = await this.claimRepo.find({
      where: { serviceOrderId: orderId, party },
      relations: {
        photos: true,
        transaction: { refundDisbursement: true },
      },
      // Ảnh cùng một lần nộp có cùng created_at → thêm id cho thứ tự ổn định.
      order: {
        createdAt: 'DESC',
        id: 'ASC',
        photos: { createdAt: 'ASC', id: 'ASC' },
      },
    });
    return claims.map((claim) => this.toView(claim));
  }

  /**
   * GET /admin/payment-claims — phiếu mới nhất lên đầu, lọc trạng thái / số tiền khai.
   * skip/take (không limit/offset thô): TypeORM lấy id phiếu theo trang trước rồi mới nạp ảnh,
   * nên phiếu 3 ảnh không chiếm 3 chỗ trong trang.
   */
  async listForAdmin(query: QueryPaymentClaimDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const qb = this.claimRepo
      .createQueryBuilder('claim')
      .leftJoinAndSelect('claim.photos', 'photo')
      .leftJoinAndSelect('claim.serviceOrder', 'serviceOrder')
      .leftJoinAndSelect('claim.submittedBy', 'submittedBy')
      .leftJoinAndSelect('claim.transaction', 'transaction')
      .leftJoinAndSelect('transaction.refundDisbursement', 'refundDisbursement')
      // Không sắp theo cột ảnh ở đây: cột của bảng con trong ORDER BY làm câu lấy id theo trang ra trùng phiếu.
      .orderBy('claim.createdAt', 'DESC')
      .addOrderBy('claim.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);
    if (query.status) {
      qb.andWhere('claim.status = :status', { status: query.status });
    }
    if (query.amount !== undefined) {
      // amount là bigint → so bằng chuỗi số nguyên.
      qb.andWhere('claim.amount = :amount', { amount: String(query.amount) });
    }
    const [rows, total] = await qb.getManyAndCount();
    return {
      data: rows.map((claim) => ({
        ...this.toView({ ...claim, photos: sortPhotos(claim.photos) }),
        orderCode: claim.serviceOrder?.orderCode ?? null,
        orderStatus: claim.serviceOrder?.status ?? null,
        submittedBy: {
          accountId: claim.submittedByAccountId,
          fullName: claim.submittedBy?.fullName ?? null,
        },
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * POST /admin/payment-claims/:id/reject — UPDATE có điều kiện `status = 'OPEN'`: hai admin bấm cùng lúc
   * (hoặc phiếu vừa được hoàn kèm) thì người sau không sửa được dòng nào → 409, không ghi đè.
   * `update` của TypeORM tự tăng `version` và đặt `updated_at` như `manager.update` ở các service khác.
   */
  async reject(
    adminAccountId: string,
    claimId: string,
    dto: RejectPaymentClaimDto,
  ) {
    const result = await this.claimRepo.update(
      { id: claimId, status: 'OPEN' },
      {
        status: 'REJECTED',
        rejectReason: dto.reason,
        handledByAccountId: adminAccountId,
        handledAt: new Date(),
      },
    );
    if (!result.affected) {
      // Không sửa được → đọc lại để trả đúng mã.
      const existing = await this.claimRepo.findOne({
        where: { id: claimId },
        select: { id: true, status: true },
      });
      if (!existing) {
        throw new NotFoundException('PAYMENT_CLAIM_NOT_FOUND');
      }
      throw new ConflictException('PAYMENT_CLAIM_NOT_OPEN');
    }
    const saved = await this.claimRepo.findOneOrFail({
      where: { id: claimId },
      relations: { photos: true, transaction: { refundDisbursement: true } },
      order: { photos: { createdAt: 'ASC', id: 'ASC' } },
    });
    return this.toView(saved);
  }

  /**
   * Hình dạng phiếu trả cho client (dùng chung khách, vườn, admin). `refund` = lệnh hoàn của khoản tiền
   * gắn với phiếu (transactions.refund_disbursement_id) — cần nạp sẵn transaction.refundDisbursement.
   */
  toView(
    claim: Pick<
      PaymentClaim,
      | 'id'
      | 'serviceOrderId'
      | 'party'
      | 'amount'
      | 'transferredAt'
      | 'note'
      | 'status'
      | 'rejectReason'
      | 'createdAt'
      | 'handledAt'
      | 'transactionId'
    > & {
      photos?: Pick<PaymentClaimPhoto, 'id' | 'photoUrl'>[] | null;
      transaction?: PaymentClaim['transaction'];
    },
  ) {
    const disbursement = claim.transactionId
      ? (claim.transaction?.refundDisbursement ?? null)
      : null;
    return {
      id: claim.id,
      orderId: claim.serviceOrderId,
      party: claim.party,
      amount: claim.amount,
      transferredAt: claim.transferredAt,
      note: claim.note,
      status: claim.status,
      rejectReason: claim.rejectReason,
      photos: (claim.photos ?? []).map((photo) => ({
        id: photo.id,
        photoUrl: photo.photoUrl,
      })),
      createdAt: claim.createdAt,
      handledAt: claim.handledAt,
      refund: disbursement
        ? {
            status: disbursement.status,
            paidAt: disbursement.paidAt,
            receiptUrl: disbursement.receiptUrl,
          }
        : null,
    };
  }

  private partyOrNotFound(
    accountId: string,
    customerAccountId: string | null,
    providerAccountId: string | null,
  ): PaymentClaimParty {
    const party = claimPartyOf({
      accountId,
      customerAccountId,
      providerAccountId,
    });
    if (!party) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    return party;
  }
}
