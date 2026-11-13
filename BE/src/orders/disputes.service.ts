import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not, Repository } from 'typeorm';
import { CareReport } from '../care-reports/entities/care-report.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import {
  loadCustomerSettlement,
  loadProviderSettlement,
} from '../payments/customer-settlement';
import { PaymentComponent } from '../payments/entities/payment-component.entity';
import { escrowBalance } from '../payments/escrow-balance';
import { settleOrder } from '../payments/settle-order';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import {
  type DisputeCaps,
  type DisputeOutcome,
  type DisputeParty,
  adminDueAt,
  canTransitionDispute,
  checkOffer,
  capCompensation,
  computeDisputeCaps,
  computeVerdictAmounts,
  customerReceives,
  negotiationDueAt,
} from './dispute-rules';
import { AddDisputeEvidenceDto } from './dto/add-dispute-evidence.dto';
import { CreateDisputeOfferDto } from './dto/create-dispute-offer.dto';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { QueryDisputeDto } from './dto/query-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { AssessmentPhoto } from './entities/assessment-photo.entity';
import { DisputeEvidence } from './entities/dispute-evidence.entity';
import { DisputeOffer } from './entities/dispute-offer.entity';
import { DisputePlant } from './entities/dispute-plant.entity';
import { Dispute } from './entities/dispute.entity';
import { HandoverObjectionPhoto } from './entities/handover-objection-photo.entity';
import { Handover } from './entities/handover.entity';
import { PlantAssessment } from './entities/plant-assessment.entity';
import { Plant } from './entities/plant.entity';
import { ServiceOrder } from './entities/service-order.entity';
import { OrderStateService } from './order-state.service';

// Vai trò người gọi các route của hai bên (controller đã chặn bằng @Roles).
type PartyRole = 'CUSTOMER' | 'PROVIDER';

interface CloseDisputeInput {
  outcome: DisputeOutcome;
  // R — tiền công hoàn; C — tiền đền.
  refund: bigint;
  compensation: bigint;
  resolvedByAccountId?: string;
  resolutionNote?: string;
}

/**
 * Tranh chấp lúc trả cây. Chỉ KHÁCH mở, trong 48 giờ sau khi vườn chốt trả cây (đơn
 * RETURN_AWAITING_CONFIRM → DISPUTED); lúc này cả hai sổ còn nguyên tiền. Hai bên thương lượng 3 ngày
 * (mỗi đề nghị hai số: hoàn công + đền); không xong thì bộ quét chuyển admin, admin kết luận từng cây.
 * Ba đường kết thúc (đồng ý / khách rút / admin phân xử) đều đi qua `closeDispute`: tranh chấp RESOLVED,
 * đơn DISPUTED → COMPLETED, chốt phiên trả cây và chia tiền hai sổ bằng `settleOrder` — tất cả trong MỘT
 * transaction. Thứ tự khoá luôn là ĐƠN trước, TRANH CHẤP sau để hai request cùng đơn không khoá chéo.
 * Đơn mẫu: 2 cây × 200.000, phí lấy cây 60.000 (sổ đơn 484.000); cây A khai 3.000.000, cây B không khai
 * (mức đền 400.000) → sổ bảo đảm 3.400.000.
 */
@Injectable()
export class DisputesService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    @InjectRepository(ServiceOrder)
    private readonly orderRepo: Repository<ServiceOrder>,
    @InjectRepository(Plant)
    private readonly plantRepo: Repository<Plant>,
    @InjectRepository(CustomerProfile)
    private readonly customerRepo: Repository<CustomerProfile>,
    @InjectRepository(ProviderProfile)
    private readonly providerRepo: Repository<ProviderProfile>,
    private readonly dataSource: DataSource,
    private readonly orderState: OrderStateService,
  ) {}

  /**
   * POST /orders/:orderId/dispute — khách mở tranh chấp. Thứ tự kiểm đúng sequence đã duyệt:
   * đơn của khách (404) → đã khai đủ tài khoản ngân hàng (409, vì tiền hoàn/đền chuyển về đó) →
   * cây bị khiếu nại hợp lệ (400) → trong transaction: đơn đúng chặng (409) → còn trong 48 giờ (409).
   * Mở lần 2 → 409 INVALID_STATE_TRANSITION (đơn đã rời RETURN_AWAITING_CONFIRM).
   */
  async openDispute(accountId: string, orderId: string, dto: OpenDisputeDto) {
    const customer = await this.customerRepo.findOne({ where: { accountId } });
    const order = customer
      ? await this.orderRepo.findOne({
          where: { id: orderId, customerId: customer.id },
        })
      : null;
    if (!customer || !order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    if (!customer.bankName || !customer.bankAccount || !customer.bankHolder) {
      throw new ConflictException('REFUND_BANK_ACCOUNT_REQUIRED');
    }
    const caredIds = await this.caredPlantIds(order.id);
    const evidencePlantIds = dto.evidence
      .map((photo) => photo.plantId)
      .filter((id): id is string => !!id);
    if (
      [...dto.plantIds, ...evidencePlantIds].some((id) => !caredIds.has(id))
    ) {
      // Cây không thuộc đơn, hoặc bị từ chối lúc nhận (vườn chưa từng giữ → không có gì để khiếu nại).
      throw new BadRequestException('PLANT_NOT_IN_CARE');
    }

    return this.dataSource.transaction(async (manager) => {
      await this.orderState.transition(
        manager,
        order.id,
        'RETURN_AWAITING_CONFIRM',
        'DISPUTED',
      );
      const now = new Date();
      // Route tự kiểm hạn 48 giờ, không trông vào bộ quét (bộ quét có thể chưa kịp tự hoàn tất đơn).
      const handover = await manager.findOne(Handover, {
        where: {
          serviceOrderId: order.id,
          handoverType: 'OUT',
          status: 'AWAITING_CUSTOMER',
        },
      });
      if (
        !handover ||
        !handover.customerConfirmDueAt ||
        handover.customerConfirmDueAt.getTime() <= now.getTime()
      ) {
        throw new ConflictException('DISPUTE_WINDOW_CLOSED');
      }

      const dispute = await manager.save(
        manager.create(Dispute, {
          serviceOrderId: order.id,
          openedByAccountId: accountId,
          reason: dto.reason,
          description: dto.description,
          status: 'NEGOTIATING' as const,
          negotiationDueAt: negotiationDueAt(now),
        }),
      );
      await manager.save(
        dto.plantIds.map((plantId) =>
          manager.create(DisputePlant, {
            disputeId: dispute.id,
            plantId,
            verdict: null,
          }),
        ),
      );
      await manager.save(
        dto.evidence.map((photo) =>
          manager.create(DisputeEvidence, {
            disputeId: dispute.id,
            party: 'CUSTOMER' as const,
            uploadedByAccountId: accountId,
            plantId: photo.plantId ?? null,
            photoUrl: photo.photoUrl,
            caption: photo.caption || null,
            note: null,
          }),
        ),
      );
      // Dừng đồng hồ 48 giờ của phiên trả cây: bộ quét tự hoàn tất chỉ tìm phiên AWAITING_CUSTOMER.
      await manager.update(Handover, handover.id, { status: 'DISPUTED' });
      return {
        disputeId: dispute.id,
        status: dispute.status,
        negotiationDueAt: dispute.negotiationDueAt,
      };
    });
  }

  /**
   * GET /orders/:orderId/dispute — hồ sơ tranh chấp cho khách hoặc vườn của đơn. Hai bên thấy CÙNG nội dung;
   * tiền chỉ có hai số đã chốt (hoàn công, đền) và dòng "khách nhận tổng" — không có phí 12% hay số vườn nhận.
   */
  async getDispute(accountId: string, role: PartyRole, orderId: string) {
    const { order } = await this.getOrderAsParty(accountId, role, orderId);
    const dispute = await this.disputeRepo.findOne({
      where: { serviceOrderId: order.id },
    });
    if (!dispute) {
      throw new NotFoundException('DISPUTE_NOT_FOUND');
    }
    return this.buildView(dispute, order);
  }

  /**
   * POST /orders/:orderId/dispute/evidence — khách hoặc vườn nộp thêm ảnh khi tranh chấp chưa RESOLVED
   * (đang thương lượng hoặc đang chờ admin). Bảng chỉ thêm dòng; `party` suy từ vai trò người gọi.
   */
  async addEvidence(
    accountId: string,
    role: PartyRole,
    orderId: string,
    dto: AddDisputeEvidenceDto,
  ) {
    const { order, party } = await this.getOrderAsParty(
      accountId,
      role,
      orderId,
    );
    const taggedPlantIds = dto.photos
      .map((photo) => photo.plantId)
      .filter((id): id is string => !!id);
    if (taggedPlantIds.length > 0) {
      const caredIds = await this.caredPlantIds(order.id);
      if (taggedPlantIds.some((id) => !caredIds.has(id))) {
        throw new BadRequestException('PLANT_NOT_IN_CARE');
      }
    }

    return this.dataSource.transaction(async (manager) => {
      // Khoá dòng tranh chấp: nộp đúng lúc admin bấm phân xử thì hoặc vào trước, hoặc nhận 409.
      const dispute = await manager.findOne(Dispute, {
        where: { serviceOrderId: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!dispute) {
        throw new NotFoundException('DISPUTE_NOT_FOUND');
      }
      if (dispute.status === 'RESOLVED') {
        throw new ConflictException('DISPUTE_CLOSED');
      }
      const saved = await manager.save(
        dto.photos.map((photo) =>
          manager.create(DisputeEvidence, {
            disputeId: dispute.id,
            party,
            uploadedByAccountId: accountId,
            plantId: photo.plantId ?? null,
            photoUrl: photo.photoUrl,
            caption: photo.caption || null,
            note: dto.note || null,
          }),
        ),
      );
      return {
        disputeId: dispute.id,
        party,
        evidence: saved.map((row) => this.toEvidenceView(row)),
      };
    });
  }

  /**
   * POST /orders/:orderId/dispute/offers — một bên gửi đề nghị (hoàn công + đền). Chỉ khi còn NEGOTIATING
   * và chưa quá hạn 3 ngày. Đề nghị đang chờ trước đó (của bất kỳ bên nào) bị thay → SUPERSEDED.
   * Đơn mẫu khiếu nại cây A: trần 400.000 / 3.000.000; vườn gửi 100.000 + 1.000.000 → customerReceives 1.106.000.
   */
  async createOffer(
    accountId: string,
    role: PartyRole,
    orderId: string,
    dto: CreateDisputeOfferDto,
  ) {
    const { order, party } = await this.getOrderAsParty(
      accountId,
      role,
      orderId,
    );
    const refund = BigInt(dto.refundAmount);
    const compensation = BigInt(dto.compensationAmount);

    return this.dataSource.transaction(async (manager) => {
      const dispute = await manager.findOne(Dispute, {
        where: { serviceOrderId: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!dispute) {
        throw new NotFoundException('DISPUTE_NOT_FOUND');
      }
      const now = new Date();
      if (
        dispute.status !== 'NEGOTIATING' ||
        dispute.negotiationDueAt.getTime() <= now.getTime()
      ) {
        throw new ConflictException('DISPUTE_NOT_NEGOTIATING');
      }
      const caps = await this.loadCaps(manager, order, dispute.id);
      const check = checkOffer(refund, compensation, caps);
      if (check !== 'OK') {
        throw new BadRequestException(check);
      }
      await manager.update(
        DisputeOffer,
        { disputeId: dispute.id, status: 'PENDING' },
        { status: 'SUPERSEDED' },
      );
      const offer = await manager.save(
        manager.create(DisputeOffer, {
          disputeId: dispute.id,
          proposedBy: party,
          refundAmount: refund.toString(),
          compensationAmount: compensation.toString(),
          message: dto.message || null,
          status: 'PENDING' as const,
        }),
      );
      return {
        offerId: offer.id,
        customerReceives: customerReceives(refund, compensation).toString(),
      };
    });
  }

  /**
   * POST /orders/:orderId/dispute/offers/:offerId/accept — bên KHÔNG gửi đề nghị bấm đồng ý → xong tranh chấp.
   * Đơn mẫu, đồng ý hoàn công 100.000 + đền 1.000.000: sổ đơn khách 106.000 / vườn 324.000 / nền tảng 54.000,
   * sổ bảo đảm khách 1.000.000 / vườn 2.400.000. `settlement` trả về là phần của NGƯỜI GỌI.
   */
  async acceptOffer(
    accountId: string,
    role: PartyRole,
    orderId: string,
    offerId: string,
  ) {
    const { order, party } = await this.getOrderAsParty(
      accountId,
      role,
      orderId,
    );

    return this.dataSource.transaction(async (manager) => {
      const { locked, dispute } = await this.lockOrderAndDispute(
        manager,
        order.id,
      );
      const offer = await manager.findOne(DisputeOffer, {
        where: { id: offerId, disputeId: dispute.id },
      });
      if (!offer) {
        throw new NotFoundException('OFFER_NOT_FOUND');
      }
      if (offer.proposedBy === party) {
        throw new ForbiddenException('OFFER_OWN');
      }
      const now = new Date();
      // Đề nghị đã bị thay, tranh chấp đã sang admin / đã xong, hoặc đã quá hạn 3 ngày (bộ quét chưa kịp chuyển).
      if (
        offer.status !== 'PENDING' ||
        dispute.status !== 'NEGOTIATING' ||
        dispute.negotiationDueAt.getTime() <= now.getTime()
      ) {
        throw new ConflictException('OFFER_NOT_PENDING');
      }
      offer.status = 'ACCEPTED';
      offer.respondedAt = now;
      await manager.save(offer);
      await this.closeDispute(manager, locked, dispute, now, {
        outcome: 'AGREED',
        refund: BigInt(offer.refundAmount),
        compensation: BigInt(offer.compensationAmount),
      });

      // Khách chỉ thấy phần khách; vườn thấy thêm phần của vườn (cùng hình dạng `settlement` ở chi tiết đơn).
      const customerPart = await loadCustomerSettlement(manager, locked.id);
      const settlement =
        party === 'PROVIDER' && customerPart
          ? await loadProviderSettlement(manager, locked, customerPart)
          : customerPart;
      return { status: dispute.status, outcome: dispute.outcome, settlement };
    });
  }

  /**
   * POST /orders/:orderId/dispute/withdraw — khách rút khiếu nại khi còn thương lượng: đơn hoàn tất như bình
   * thường (R = 0, C = 0 → đơn mẫu 0 / 412.000 / 72.000; bảo đảm về vườn 3.400.000). KHÔNG tính là khách thua.
   */
  async withdraw(accountId: string, orderId: string) {
    const { order } = await this.getOrderAsParty(
      accountId,
      'CUSTOMER',
      orderId,
    );
    return this.dataSource.transaction(async (manager) => {
      const { locked, dispute } = await this.lockOrderAndDispute(
        manager,
        order.id,
      );
      if (dispute.status !== 'NEGOTIATING') {
        throw new ConflictException('DISPUTE_NOT_NEGOTIATING');
      }
      await this.closeDispute(manager, locked, dispute, new Date(), {
        outcome: 'WITHDRAWN',
        refund: 0n,
        compensation: 0n,
      });
      return { status: dispute.status, outcome: dispute.outcome };
    });
  }

  /**
   * Chuyển tranh chấp quá hạn thương lượng sang admin — bộ quét 5 phút gọi, mỗi tranh chấp một transaction
   * của nơi gọi. Khoá dòng rồi KIỂM LẠI: đã xong / đã chuyển rồi / chưa tới hạn → không làm gì, trả false
   * (hai bên vừa đồng ý đúng lúc bộ quét chạy thì bên đồng ý thắng). Không đụng đơn, không đụng tiền.
   * Ví dụ mở 15/11 16:00, quét lúc 18/11 16:03 → ADMIN_REVIEW, admin_due_at 23/11 16:03.
   */
  async escalateDispute(
    manager: EntityManager,
    disputeId: string,
    now: Date,
  ): Promise<boolean> {
    const dispute = await manager.findOne(Dispute, {
      where: { id: disputeId },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !dispute ||
      dispute.status !== 'NEGOTIATING' ||
      dispute.negotiationDueAt.getTime() > now.getTime()
    ) {
      return false;
    }
    dispute.status = 'ADMIN_REVIEW';
    dispute.escalatedAt = now;
    dispute.adminDueAt = adminDueAt(now);
    await manager.save(dispute);
    // Đóng đề nghị còn treo: sang admin rồi thì không ai bấm đồng ý được nữa.
    await manager.update(
      DisputeOffer,
      { disputeId: dispute.id, status: 'PENDING' },
      { status: 'SUPERSEDED' },
    );
    return true;
  }

  // ---- Admin ----

  /**
   * GET /admin/disputes — tranh chấp quá hạn mềm 5 ngày (chưa xong mà đã qua admin_due_at) nổi lên đầu,
   * sau đó theo hạn admin gần nhất; mỗi dòng có `isOverdue` để hiện nhãn trễ.
   */
  async listForAdmin(query: QueryDisputeDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const now = new Date();
    const qb = this.disputeRepo
      .createQueryBuilder('d')
      .innerJoin(ServiceOrder, 'o', 'o.id = d.service_order_id');
    if (query.status) {
      qb.where('d.status = :status', { status: query.status });
    }
    const total = await qb.getCount();
    const rows = await qb
      .select('d.id', 'id')
      .addSelect('d.service_order_id', 'orderId')
      .addSelect('o.order_code', 'orderCode')
      .addSelect('d.status', 'status')
      .addSelect('d.outcome', 'outcome')
      .addSelect('d.reason', 'reason')
      .addSelect('d.created_at', 'openedAt')
      .addSelect('d.negotiation_due_at', 'negotiationDueAt')
      .addSelect('d.escalated_at', 'escalatedAt')
      .addSelect('d.admin_due_at', 'adminDueAt')
      .addSelect('d.resolved_at', 'resolvedAt')
      .addSelect('d.refund_amount', 'refundAmount')
      .addSelect('d.compensation_amount', 'compensationAmount')
      .addSelect(
        `CASE WHEN d.status <> 'RESOLVED' AND d.admin_due_at < :now THEN 0 ELSE 1 END`,
        'overdue_rank',
      )
      .setParameter('now', now)
      .orderBy('overdue_rank', 'ASC')
      .addOrderBy('d.admin_due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('d.created_at', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<{
        id: string;
        orderId: string;
        orderCode: string;
        status: Dispute['status'];
        outcome: Dispute['outcome'];
        reason: string;
        openedAt: Date;
        negotiationDueAt: Date;
        escalatedAt: Date | null;
        adminDueAt: Date | null;
        resolvedAt: Date | null;
        refundAmount: string | null;
        compensationAmount: string | null;
        overdue_rank: number;
      }>();
    return {
      data: rows.map(({ overdue_rank: _rank, ...row }) => ({
        ...row,
        isOverdue: isOverdue(row, now),
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * GET /admin/disputes/:disputeId — hồ sơ đầy đủ để admin phân xử: nội dung hai bên thấy + chuỗi bằng chứng
   * theo thời gian (biên bản nhận cây kèm cờ rủi ro và ý kiến phản đối của khách, số báo cáo chăm,
   * biên bản trả cây), ghi chú phân xử, số lần khách đã thua tranh chấp.
   */
  async getForAdmin(disputeId: string) {
    const dispute = await this.disputeRepo.findOne({
      where: { id: disputeId },
    });
    if (!dispute) {
      throw new NotFoundException('DISPUTE_NOT_FOUND');
    }
    const order = await this.orderRepo.findOneOrFail({
      where: { id: dispute.serviceOrderId },
      relations: { customer: { account: true }, provider: true },
    });
    const view = await this.buildView(dispute, order);
    const [plants, handovers, careReports] = await Promise.all([
      this.plantRepo.find({
        where: { serviceOrderId: order.id },
        order: { createdAt: 'ASC' },
      }),
      this.dataSource.getRepository(Handover).find({
        where: { serviceOrderId: order.id, status: Not('CANCELLED') },
      }),
      // Chỉ ĐỌC bảng của module care-reports (không sửa module đó): admin cần biết vườn có báo cáo đều không.
      this.dataSource.getRepository(CareReport).find({
        where: { serviceOrderId: order.id },
        order: { periodIndex: 'ASC' },
      }),
    ]);
    const assessments = await this.loadAssessments(
      handovers.map((handover) => handover.id),
    );
    const handoverView = (type: 'IN' | 'OUT') => {
      const handover = handovers.find((row) => row.handoverType === type);
      return handover
        ? {
            status: handover.status,
            customerConfirmDueAt: handover.customerConfirmDueAt,
            confirmedAt: handover.confirmedAt,
            assessments: assessments.get(handover.id) ?? [],
          }
        : null;
    };
    const now = new Date();
    return {
      ...view,
      isOverdue: isOverdue(dispute, now),
      resolvedByAccountId: dispute.resolvedByAccountId,
      resolutionNote: dispute.resolutionNote,
      order: {
        id: order.id,
        orderCode: order.orderCode,
        status: order.status,
        basePrice: order.basePriceSnapshot,
        finalTotal: order.finalTotal,
        pickupFee: order.pickupFeeSnapshot,
        careStartedAt: order.careStartedAt,
        careDueAt: order.careDueAt,
      },
      // KHÔNG spread hồ sơ / Account (passwordHash, SĐT, CCCD, STK) — chỉ field admin cần ở màn phân xử.
      customer: {
        id: order.customerId,
        fullName: order.customer?.account?.fullName ?? null,
        lostDisputeCount: order.customer?.lostDisputeCount ?? 0,
      },
      provider: {
        id: order.providerId,
        displayName: order.provider?.displayName ?? null,
      },
      // Mọi cây của đơn (kể cả cây không bị khiếu nại / bị từ chối lúc nhận) để admin có bối cảnh.
      orderPlants: plants.map((plant) => ({
        plantId: plant.id,
        name: plant.name,
        speciesName: plant.speciesName,
        isValueDeclared: plant.isValueDeclared,
        declaredValue: plant.declaredValue,
        compensationCap: plant.protectionCap,
        handoverDecision: plant.handoverDecision,
        isHighRisk: plant.isHighRisk,
      })),
      handoverIn: handoverView('IN'),
      handoverOut: handoverView('OUT'),
      careReports: {
        submittedCount: careReports.length,
        reports: careReports.map((report) => ({
          id: report.id,
          periodIndex: report.periodIndex,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
          submittedAt: report.submittedAt,
        })),
      },
    };
  }

  /**
   * POST /admin/disputes/:disputeId/resolve — admin kết luận TỪNG cây bị khiếu nại, không nhập tiền.
   * R = Σ giá gói các cây vườn có lỗi, C = Σ mức đền các cây mất giá trị (dispute-rules.ts).
   * Đơn mẫu, cây A: NOT_AT_FAULT → 0 / 0 · SERVICE_FAULT → 200.000 / 0 (khách nhận 212.000) ·
   * VALUE_LOST → 200.000 / 3.000.000 (khách nhận 212.000 + 3.000.000).
   * Mọi cây đều không lỗi = khách khiếu nại sai → hồ sơ khách +1 lần thua, không phạt tiền.
   */
  async resolve(
    adminAccountId: string,
    disputeId: string,
    dto: ResolveDisputeDto,
  ) {
    const found = await this.disputeRepo.findOne({ where: { id: disputeId } });
    if (!found) {
      throw new NotFoundException('DISPUTE_NOT_FOUND');
    }

    return this.dataSource.transaction(async (manager) => {
      const { locked, dispute } = await this.lockOrderAndDispute(
        manager,
        found.serviceOrderId,
      );
      if (dispute.status !== 'ADMIN_REVIEW') {
        throw new ConflictException('DISPUTE_NOT_IN_REVIEW');
      }
      const disputePlants = await manager.find(DisputePlant, {
        where: { disputeId: dispute.id },
      });
      // Phải đủ đúng các cây bị khiếu nại: thiếu, dư (cây lạ) hay trùng đều là kết luận chưa hoàn chỉnh.
      const verdicts = new Map(
        dto.plants.map((item) => [item.plantId, item.verdict]),
      );
      if (
        verdicts.size !== dto.plants.length ||
        verdicts.size !== disputePlants.length ||
        disputePlants.some((row) => !verdicts.has(row.plantId))
      ) {
        throw new BadRequestException('DISPUTE_VERDICT_INCOMPLETE');
      }
      for (const row of disputePlants) {
        row.verdict = verdicts.get(row.plantId)!;
      }
      await manager.save(disputePlants);

      const plants = await manager.find(Plant, {
        where: { serviceOrderId: locked.id },
      });
      const capOf = new Map(
        plants.map((plant) => [plant.id, BigInt(plant.protectionCap ?? '0')]),
      );
      const amounts = computeVerdictAmounts(
        disputePlants.map((row) => ({
          verdict: row.verdict!,
          protectionCap: capOf.get(row.plantId) ?? 0n,
        })),
        BigInt(locked.basePriceSnapshot),
      );
      if (amounts.allNotAtFault) {
        await manager.increment(
          CustomerProfile,
          { id: locked.customerId },
          'lostDisputeCount',
          1,
        );
      }
      // Tiền đền chỉ lấy từ sổ bảo đảm của đơn: đơn cũ không có tiền bảo đảm (sổ 0) mà admin kết luận
      // VALUE_LOST thì C = 0 thay vì làm hàm chia tiền ném lỗi 500. Đơn mẫu: sổ 3.400.000 ≥ 3.000.000 → không đổi.
      const compensation = capCompensation(
        amounts.compensation,
        await escrowBalance(manager, locked.id, 'SECURITY'),
      );
      await this.closeDispute(manager, locked, dispute, new Date(), {
        outcome: 'ADJUDICATED',
        refund: amounts.refund,
        compensation,
        resolvedByAccountId: adminAccountId,
        resolutionNote: dto.note,
      });
      return {
        status: dispute.status,
        outcome: dispute.outcome,
        refundAmount: dispute.refundAmount,
        compensationAmount: dispute.compensationAmount,
      };
    });
  }

  // ---- helpers ----

  /**
   * Điểm kết thúc DUY NHẤT của tranh chấp — gọi trong transaction đã khoá dòng đơn rồi dòng tranh chấp.
   * Tranh chấp RESOLVED + hai số R/C, đề nghị còn treo đóng lại, đơn DISPUTED → COMPLETED, phiên trả cây
   * chốt (dừng ở DISPUTED từ lúc mở) và chia tiền cả hai sổ. Lỗi bất kỳ bước nào → cả transaction huỷ,
   * tranh chấp vẫn như cũ.
   */
  private async closeDispute(
    manager: EntityManager,
    locked: ServiceOrder,
    dispute: Dispute,
    now: Date,
    input: CloseDisputeInput,
  ): Promise<void> {
    if (
      locked.status !== 'DISPUTED' ||
      !canTransitionDispute(dispute.status, 'RESOLVED')
    ) {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    dispute.status = 'RESOLVED';
    dispute.outcome = input.outcome;
    dispute.refundAmount = input.refund.toString();
    dispute.compensationAmount = input.compensation.toString();
    dispute.resolvedAt = now;
    dispute.resolvedByAccountId = input.resolvedByAccountId ?? null;
    dispute.resolutionNote = input.resolutionNote ?? null;
    await manager.save(dispute);
    await manager.update(
      DisputeOffer,
      { disputeId: dispute.id, status: 'PENDING' },
      { status: 'SUPERSEDED' },
    );

    await this.orderState.apply(manager, locked, 'COMPLETED');
    await manager.update(
      Handover,
      { serviceOrderId: locked.id, handoverType: 'OUT', status: 'DISPUTED' },
      { status: 'CONFIRMED', confirmedAt: now, lockedAt: now },
    );
    await settleOrder(manager, locked, now, {
      refund: input.refund,
      compensation: input.compensation,
    });
  }

  // Khoá ĐƠN trước, TRANH CHẤP sau — cùng thứ tự ở mọi đường kết thúc nên không khoá chéo.
  private async lockOrderAndDispute(manager: EntityManager, orderId: string) {
    const locked = await this.orderState.lock(manager, orderId);
    const dispute = locked
      ? await manager.findOne(Dispute, {
          where: { serviceOrderId: orderId },
          lock: { mode: 'pessimistic_write' },
        })
      : null;
    if (!locked || !dispute) {
      throw new NotFoundException('DISPUTE_NOT_FOUND');
    }
    return { locked, dispute };
  }

  // Load đơn với tư cách MỘT TRONG HAI BÊN của đơn — người ngoài → 404, chống IDOR.
  // Không chặn vườn đã bị tước APPROVED: tranh chấp là chuyện tiền của đơn đã làm, vườn vẫn phải phản hồi được.
  private async getOrderAsParty(
    accountId: string,
    role: PartyRole,
    orderId: string,
  ): Promise<{ order: ServiceOrder; party: DisputeParty }> {
    const profile =
      role === 'CUSTOMER'
        ? await this.customerRepo.findOne({ where: { accountId } })
        : await this.providerRepo.findOne({ where: { accountId } });
    const order = profile
      ? await this.orderRepo.findOne({
          where:
            role === 'CUSTOMER'
              ? { id: orderId, customerId: profile.id }
              : { id: orderId, providerId: profile.id },
        })
      : null;
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    return { order, party: role };
  }

  // Cây vườn đã nhận chăm (không bị từ chối lúc nhận) — chỉ những cây này mới khiếu nại được.
  private async caredPlantIds(orderId: string): Promise<Set<string>> {
    const plants = await this.plantRepo.find({
      where: { serviceOrderId: orderId },
    });
    return new Set(
      plants
        .filter(
          (plant) =>
            plant.handoverDecision === 'ACCEPT' ||
            plant.handoverDecision === 'ACCEPT_HIGH_RISK',
        )
        .map((plant) => plant.id),
    );
  }

  /**
   * Hai trần hiện hành của đề nghị: tiền công đang giữ (giá công chốt + add-on khách đã trả) và tổng mức đền
   * các cây bị khiếu nại — nhưng không quá số dư sổ bảo đảm của đơn (đơn cũ không có tiền bảo đảm → đền ≤ 0).
   * Đơn đang DISPUTED nên các số này đứng yên (không nhận add-on mới, không sửa cây, sổ bảo đảm chưa chia).
   */
  private async loadCaps(
    manager: EntityManager,
    order: ServiceOrder,
    disputeId: string,
  ): Promise<DisputeCaps> {
    // Tuần tự (không Promise.all): `manager` có thể là transaction — một kết nối chỉ chạy một câu một lúc.
    const addons = await manager.find(PaymentComponent, {
      where: {
        serviceOrderId: order.id,
        componentType: 'ADD_ON',
        status: 'PAID',
      },
    });
    const disputePlants = await manager.find(DisputePlant, {
      where: { disputeId },
    });
    const plants = await manager.find(Plant, {
      where: { serviceOrderId: order.id },
    });
    const capOf = new Map(
      plants.map((plant) => [plant.id, BigInt(plant.protectionCap ?? '0')]),
    );
    return computeDisputeCaps({
      finalTotal: BigInt(order.finalTotal ?? order.provisionalTotal),
      paidAddonAmounts: addons.map((component) => BigInt(component.amount)),
      disputedProtectionCaps: disputePlants.map(
        (row) => capOf.get(row.plantId) ?? 0n,
      ),
      securityBalance: await escrowBalance(manager, order.id, 'SECURITY'),
    });
  }

  private toEvidenceView(row: DisputeEvidence) {
    return {
      id: row.id,
      plantId: row.plantId,
      photoUrl: row.photoUrl,
      caption: row.caption,
      note: row.note,
      createdAt: row.createdAt,
    };
  }

  /**
   * Nội dung hồ sơ tranh chấp mà CẢ HAI BÊN đều được thấy (admin thấy thêm ở getForAdmin).
   * Cố ý không có phí 12%, phí nền tảng hay số vườn nhận: route này khách gọi được.
   */
  private async buildView(dispute: Dispute, order: ServiceOrder) {
    const manager = this.dataSource.manager;
    const [disputePlants, plants, evidences, offers, handoverIn] =
      await Promise.all([
        manager.find(DisputePlant, {
          where: { disputeId: dispute.id },
          order: { createdAt: 'ASC' },
        }),
        manager.find(Plant, { where: { serviceOrderId: order.id } }),
        manager.find(DisputeEvidence, {
          where: { disputeId: dispute.id },
          order: { createdAt: 'ASC' },
        }),
        manager.find(DisputeOffer, {
          where: { disputeId: dispute.id },
          order: { createdAt: 'ASC' },
        }),
        manager.findOne(Handover, {
          where: {
            serviceOrderId: order.id,
            handoverType: 'IN',
            status: Not('CANCELLED'),
          },
        }),
      ]);
    const objectionPhotos = handoverIn
      ? await manager.find(HandoverObjectionPhoto, {
          where: { handoverId: handoverIn.id },
          order: { createdAt: 'ASC' },
        })
      : [];
    const plantOf = new Map(plants.map((plant) => [plant.id, plant]));
    // Đơn đã chia tiền thì dòng add-on chuyển RELEASED → trần tính lại sẽ lệch; lúc đó trần không còn ý nghĩa.
    const caps =
      dispute.status === 'RESOLVED'
        ? null
        : await this.loadCaps(manager, order, dispute.id);
    const resolved = dispute.status === 'RESOLVED';

    return {
      id: dispute.id,
      orderId: order.id,
      status: dispute.status,
      outcome: dispute.outcome,
      reason: dispute.reason,
      description: dispute.description,
      openedAt: dispute.createdAt,
      negotiationDueAt: dispute.negotiationDueAt,
      escalatedAt: dispute.escalatedAt,
      // Ngày dự kiến có kết quả khi đang chờ admin (hạn mềm).
      adminDueAt: dispute.adminDueAt,
      resolvedAt: dispute.resolvedAt,
      plants: disputePlants.map((row) => {
        const plant = plantOf.get(row.plantId);
        return {
          plantId: row.plantId,
          name: plant?.name ?? null,
          // Mức đền của cây = trần tiền đền cho riêng cây đó.
          compensationCap: plant?.protectionCap ?? null,
          verdict: row.verdict,
        };
      }),
      evidence: {
        customer: evidences
          .filter((row) => row.party === 'CUSTOMER')
          .map((row) => this.toEvidenceView(row)),
        provider: evidences
          .filter((row) => row.party === 'PROVIDER')
          .map((row) => this.toEvidenceView(row)),
      },
      // Ý kiến phản đối + ảnh khách ghi lúc đồng ý biên bản NHẬN cây (khoá cùng biên bản) — bằng chứng có sẵn.
      handoverObjection:
        handoverIn &&
        (handoverIn.customerObjectionNote || objectionPhotos.length > 0)
          ? {
              note: handoverIn.customerObjectionNote,
              photos: objectionPhotos.map((photo) => ({
                photoUrl: photo.photoUrl,
                caption: photo.caption,
                createdAt: photo.createdAt,
              })),
            }
          : null,
      offers: offers.map((offer) => ({
        id: offer.id,
        proposedBy: offer.proposedBy,
        refundAmount: offer.refundAmount,
        compensationAmount: offer.compensationAmount,
        // Dòng "khách nhận tổng cộng" của đề nghị này: hoàn công + 6% tương ứng + đền.
        customerReceives: customerReceives(
          BigInt(offer.refundAmount),
          BigInt(offer.compensationAmount),
        ).toString(),
        message: offer.message,
        status: offer.status,
        respondedAt: offer.respondedAt,
        createdAt: offer.createdAt,
      })),
      caps: caps
        ? {
            refundCap: caps.refundCap.toString(),
            compensationCap: caps.compensationCap.toString(),
          }
        : null,
      // Ba số chỉ có khi đã xong (RESOLVED); trước đó null.
      refundAmount: dispute.refundAmount,
      compensationAmount: dispute.compensationAmount,
      customerReceives: resolved
        ? customerReceives(
            BigInt(dispute.refundAmount ?? '0'),
            BigInt(dispute.compensationAmount ?? '0'),
          ).toString()
        : null,
    };
  }

  /**
   * Biên bản khám cây của các phiên bàn giao — TOÀN BỘ bản ghi theo thời gian (khám lại thì thêm dòng,
   * không ghi đè) kèm ảnh, để admin lần theo chuỗi bằng chứng từ lúc nhận tới lúc trả.
   */
  private async loadAssessments(handoverIds: string[]) {
    const result = new Map<
      string,
      Array<{
        id: string;
        plantId: string;
        checklist: Record<string, unknown>;
        note: string | null;
        assessedAt: Date;
        photos: Array<{ photoUrl: string; caption: string | null }>;
      }>
    >();
    if (handoverIds.length === 0) return result;
    const rows = await this.dataSource
      .getRepository(PlantAssessment)
      .createQueryBuilder('pa')
      .where('pa.handover_id IN (:...handoverIds)', { handoverIds })
      .orderBy('pa.created_at', 'ASC')
      .getMany();
    const ids = rows.map((row) => row.id);
    const photos = ids.length
      ? await this.dataSource
          .getRepository(AssessmentPhoto)
          .createQueryBuilder('ap')
          .where('ap.assessment_id IN (:...ids)', { ids })
          .orderBy('ap.created_at', 'ASC')
          .getMany()
      : [];
    for (const row of rows) {
      const list = result.get(row.handoverId!) ?? [];
      list.push({
        id: row.id,
        plantId: row.plantId,
        checklist: row.checklist,
        note: row.note,
        assessedAt: row.createdAt,
        photos: photos
          .filter((photo) => photo.assessmentId === row.id)
          .map((photo) => ({
            photoUrl: photo.photoUrl,
            caption: photo.caption,
          })),
      });
      result.set(row.handoverId!, list);
    }
    return result;
  }
}

// Quá hạn mềm của admin: tranh chấp CHƯA xong mà đã qua admin_due_at (đang thương lượng thì chưa có hạn này).
function isOverdue(
  dispute: { status: Dispute['status']; adminDueAt: Date | null },
  now: Date,
): boolean {
  return (
    dispute.status !== 'RESOLVED' &&
    dispute.adminDueAt !== null &&
    new Date(dispute.adminDueAt).getTime() < now.getTime()
  );
}
