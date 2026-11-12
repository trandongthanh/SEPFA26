import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { MarkDisbursementPaidDto } from './dto/mark-disbursement-paid.dto';
import { QueryDisbursementDto } from './dto/query-disbursement.dto';
import { Disbursement } from './entities/disbursement.entity';

export interface BankInfo {
  bankName: string;
  bankAccount: string;
  bankHolder: string;
}

// Đủ cả 3 trường mới coi là có tài khoản nhận tiền (thiếu 1 trường thì admin không chuyển được).
function pickBank(source: {
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
}): BankInfo | null {
  const { bankName, bankAccount, bankHolder } = source;
  return bankName && bankAccount && bankHolder
    ? { bankName, bankAccount, bankHolder }
    : null;
}

/**
 * Lệnh chi cho admin: xem danh sách và bấm "Đã chuyển" sau khi chuyển khoản tay.
 * Không ghi thêm sổ ký quỹ — bút toán PAYOUT đã ghi lúc đơn COMPLETED (settle-order.ts).
 */
@Injectable()
export class DisbursementsService {
  constructor(
    @InjectRepository(Disbursement)
    private readonly disbursementRepo: Repository<Disbursement>,
    private readonly dataSource: DataSource,
  ) {}

  /** GET /admin/disbursements — lệnh tới hạn sớm nhất lên đầu. */
  async list(query: QueryDisbursementDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const qb = this.disbursementRepo
      .createQueryBuilder('disbursement')
      .leftJoinAndSelect('disbursement.serviceOrder', 'serviceOrder')
      .leftJoinAndSelect('disbursement.provider', 'provider')
      .orderBy('disbursement.eligibleAt', 'ASC')
      .addOrderBy('disbursement.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);
    if (query.status) {
      qb.where('disbursement.status = :status', { status: query.status });
    }
    const [rows, total] = await qb.getManyAndCount();
    const now = new Date();
    return {
      data: rows.map((row) => this.toView(row, now)),
      total,
      page,
      limit,
    };
  }

  /**
   * POST /admin/disbursements/:id/mark-paid — khoá dòng lệnh chi: 2 admin bấm cùng lúc
   * thì người sau thấy PAID và nhận 409.
   */
  async markPaid(
    adminAccountId: string,
    disbursementId: string,
    dto: MarkDisbursementPaidDto,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const disbursement = await manager.findOne(Disbursement, {
        where: { id: disbursementId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!disbursement) {
        throw new NotFoundException('DISBURSEMENT_NOT_FOUND');
      }
      if (disbursement.status === 'PAID') {
        throw new ConflictException('DISBURSEMENT_ALREADY_PAID');
      }
      const now = new Date();
      // Chưa hết 3 ngày chờ khiếu nại thì chưa được chi.
      if (disbursement.eligibleAt.getTime() > now.getTime()) {
        throw new ConflictException('DISBURSEMENT_NOT_ELIGIBLE');
      }

      if (!pickBank(disbursement)) {
        // Chỉ lệnh trả vườn mới được lấy bù tài khoản từ hồ sơ vườn. Lệnh hoàn tiền khách (REFUND,
        // chưa sinh ở đợt này) mà lấy bù kiểu đó thì tiền của khách sẽ chạy vào tài khoản vườn.
        if (disbursement.type !== 'PAYOUT') {
          throw new ConflictException('DISBURSEMENT_BANK_INFO_MISSING');
        }
        // Lúc đơn COMPLETED vườn chưa khai ngân hàng → chụp bù từ hồ sơ hiện tại.
        const provider = await manager.findOne(ProviderProfile, {
          where: { id: disbursement.providerId },
        });
        const bank = provider ? pickBank(provider) : null;
        if (!bank) {
          throw new ConflictException('PROVIDER_BANK_INFO_MISSING');
        }
        Object.assign(disbursement, bank);
      }

      disbursement.status = 'PAID';
      disbursement.paidAt = now;
      disbursement.paidByAccountId = adminAccountId;
      disbursement.transferCode = dto.transferCode;
      // Ghi chú toàn khoảng trắng (sau trim còn rỗng) coi như không ghi.
      disbursement.note = dto.note || null;
      await manager.save(disbursement);
    });

    const saved = await this.disbursementRepo.findOneOrFail({
      where: { id: disbursementId },
      relations: { serviceOrder: true, provider: true },
    });
    return this.toView(saved, new Date());
  }

  // Một hình dạng cho cả danh sách lẫn kết quả mark-paid.
  private toView(row: Disbursement, now: Date) {
    return {
      id: row.id,
      orderId: row.serviceOrderId,
      orderCode: row.serviceOrder.orderCode,
      providerId: row.providerId,
      providerName: row.provider.displayName,
      type: row.type,
      amount: row.amount,
      eligibleAt: row.eligibleAt,
      isEligible: row.eligibleAt.getTime() <= now.getTime(),
      status: row.status,
      // Bản chụp trên lệnh chi; trống thì gợi ý theo hồ sơ vườn hiện tại — chỉ với lệnh trả vườn.
      bank:
        pickBank(row) ??
        (row.type === 'PAYOUT' ? pickBank(row.provider) : null),
      transferCode: row.transferCode,
      paidAt: row.paidAt,
      note: row.note,
    };
  }
}
