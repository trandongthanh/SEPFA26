import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { EscrowLedger } from '../payments/entities/escrow-ledger.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { AssessPlantDto } from './dto/assess-plant.dto';
import { CompleteHandoverDto } from './dto/complete-handover.dto';
import { AgreementSignature } from './entities/agreement-signature.entity';
import { AssessmentPhoto } from './entities/assessment-photo.entity';
import { Handover } from './entities/handover.entity';
import { HandoverItem } from './entities/handover-item.entity';
import { Plant } from './entities/plant.entity';
import { PlantAssessment } from './entities/plant-assessment.entity';
import { ServiceAgreement } from './entities/service-agreement.entity';
import { ServiceOrder } from './entities/service-order.entity';
import { assertTransition } from './order-status';

// Hạn khách xác nhận kết quả bàn giao — cron auto-confirm HOÃN, deadline vẫn ghi sẵn.
const CUSTOMER_CONFIRM_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * 4 endpoint bàn giao nhận cây (PAID → IN_CARE) — nơi hiện thực định giá 2 tầng:
 * giá tạm khóa lúc ký online, giá CHÍNH THỨC khóa lúc khách confirm bàn giao.
 * Nguồn thiết kế: docs/sequence-diagrams/orders-handover.md.
 */
@Injectable()
export class HandoverService {
  constructor(
    @InjectRepository(ServiceOrder)
    private readonly orderRepo: Repository<ServiceOrder>,
    @InjectRepository(Plant)
    private readonly plantRepo: Repository<Plant>,
    @InjectRepository(Handover)
    private readonly handoverRepo: Repository<Handover>,
    @InjectRepository(CustomerProfile)
    private readonly customerRepo: Repository<CustomerProfile>,
    @InjectRepository(ProviderProfile)
    private readonly providerRepo: Repository<ProviderProfile>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * POST /orders/:id/handover/start — provider mở phiên bàn giao
   * (PAID → HANDOVER_IN_PROGRESS). Khóa dòng đơn + re-check trong transaction:
   * bấm 2 lần cùng lúc chỉ 1 phiên được mở.
   */
  async startHandover(accountId: string, orderId: string) {
    const order = await this.getOrderAsProvider(accountId, orderId);
    if (order.status !== 'PAID') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    assertTransition(order.status, 'HANDOVER_IN_PROGRESS');

    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(ServiceOrder, {
        where: { id: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== 'PAID') {
        throw new ConflictException('INVALID_STATE_TRANSITION');
      }
      const handover = await manager.save(
        manager.create(Handover, {
          serviceOrderId: order.id,
          handoverType: 'IN' as const,
          status: 'IN_PROGRESS' as const,
        }),
      );
      locked.status = 'HANDOVER_IN_PROGRESS';
      await manager.save(locked);
      return { handoverId: handover.id, status: locked.status };
    });
  }

  /**
   * POST /orders/:id/handover/plants/:plantId/assess — thẩm định TỪNG cây.
   * Append-only: re-assess trước complete tạo bản ghi MỚI, plant lấy quyết định
   * mới nhất, chuỗi bằng chứng cũ giữ nguyên. ADJUST chỉ cho cây khai giá
   * (cây thường giá theo gói — chống hét giá khi cây đã nằm trong tay vườn).
   */
  async assessPlant(
    accountId: string,
    orderId: string,
    plantId: string,
    dto: AssessPlantDto,
  ) {
    const order = await this.getOrderAsProvider(accountId, orderId);
    if (order.status !== 'HANDOVER_IN_PROGRESS') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    const plant = await this.plantRepo.findOne({
      where: { id: plantId, serviceOrderId: order.id },
    });
    if (!plant) {
      throw new NotFoundException('PLANT_NOT_FOUND');
    }
    if (dto.decision === 'ADJUST' && !plant.isValueDeclared) {
      throw new BadRequestException('ADJUST_NOT_ALLOWED');
    }
    // D9: cờ isHighRisk phải khớp decision — chống lệch bằng chứng trách nhiệm
    // (ACCEPT_HIGH_RISK mà cờ false, hoặc ngược lại).
    if ((dto.decision === 'ACCEPT_HIGH_RISK') !== dto.isHighRisk) {
      throw new BadRequestException('HIGH_RISK_FLAG_MISMATCH');
    }
    const handover = await this.getActiveHandover(order.id);

    return this.dataSource.transaction(async (manager) => {
      const assessment = await manager.save(
        manager.create(PlantAssessment, {
          plantId: plant.id,
          handoverId: handover.id,
          assessorId: accountId,
          checklist: dto.checklist,
          note: dto.note ?? null,
        }),
      );
      await manager.save(
        dto.photos.map((photo) =>
          manager.create(AssessmentPhoto, {
            assessmentId: assessment.id,
            photoUrl: photo.photoUrl,
            caption: photo.caption ?? null,
            gpsLat: photo.gpsLat !== undefined ? String(photo.gpsLat) : null,
            gpsLng: photo.gpsLng !== undefined ? String(photo.gpsLng) : null,
          }),
        ),
      );
      plant.handoverDecision = dto.decision;
      plant.isHighRisk = dto.isHighRisk;
      await manager.save(plant);
      return { assessmentId: assessment.id, decision: dto.decision };
    });
  }

  /**
   * POST /orders/:id/handover/complete — chốt thẩm định
   * (→ HANDOVER_AWAITING_CONFIRM). finalTotal đề xuất chỉ đi kèm cây ADJUST;
   * mặc định = basePriceSnapshot × số cây không-REJECT. REJECT toàn bộ thì
   * không cho complete — ép đường cancel để logic tiền hủy nằm 1 chỗ.
   */
  async completeHandover(
    accountId: string,
    orderId: string,
    dto: CompleteHandoverDto,
  ) {
    const order = await this.getOrderAsProvider(accountId, orderId);
    if (order.status !== 'HANDOVER_IN_PROGRESS') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    assertTransition(order.status, 'HANDOVER_AWAITING_CONFIRM');

    const plants = await this.plantRepo.find({
      where: { serviceOrderId: order.id },
    });
    if (plants.some((plant) => plant.handoverDecision === null)) {
      throw new BadRequestException('UNASSESSED_PLANTS');
    }
    const keptPlants = plants.filter(
      (plant) => plant.handoverDecision !== 'REJECT',
    );
    if (keptPlants.length === 0) {
      // Không còn gì để chăm — đúng luồng là provider HỦY đơn (hoàn 100% kể cả ship).
      throw new BadRequestException('ALL_PLANTS_REJECTED');
    }
    const hasAdjust = plants.some(
      (plant) => plant.handoverDecision === 'ADJUST',
    );
    if (hasAdjust && dto.proposedFinalTotal === undefined) {
      throw new BadRequestException('FINAL_TOTAL_REQUIRED');
    }
    if (!hasAdjust && dto.proposedFinalTotal !== undefined) {
      throw new BadRequestException('ADJUST_NOT_ALLOWED');
    }
    if (dto.proposedFinalTotal !== undefined) {
      const proposed = BigInt(dto.proposedFinalTotal);
      if (proposed <= 0n) {
        throw new BadRequestException('FINAL_TOTAL_REQUIRED');
      }
      // D1-cap: trần giá cuối = Σ(giá khách đã khai cho cây ADJUST) +
      // giá gói × (cây còn nhận không-ADJUST). Vườn KHÔNG hét giá vượt mức
      // khách đã đồng ý từ đầu, dù cây đã nằm trong tay vườn.
      const base = BigInt(order.basePriceSnapshot);
      let cap = 0n;
      for (const plant of keptPlants) {
        cap +=
          plant.handoverDecision === 'ADJUST' && plant.declaredValue
            ? BigInt(plant.declaredValue)
            : base;
      }
      if (proposed > cap) {
        throw new BadRequestException('FINAL_TOTAL_EXCEEDS_CAP');
      }
    }
    const finalTotal =
      dto.proposedFinalTotal ??
      (BigInt(order.basePriceSnapshot) * BigInt(keptPlants.length)).toString();
    const handover = await this.getActiveHandover(order.id);

    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(ServiceOrder, {
        where: { id: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== 'HANDOVER_IN_PROGRESS') {
        throw new ConflictException('INVALID_STATE_TRANSITION');
      }
      // Chốt từng cây: high_risk_flag đóng băng tại thời điểm complete.
      await manager.save(
        plants.map((plant) =>
          manager.create(HandoverItem, {
            handoverId: handover.id,
            plantId: plant.id,
            highRiskFlag: plant.isHighRisk,
          }),
        ),
      );
      // Trần đền bù cây được nhận: cây khai giá = declaredValue, cây thường = null.
      for (const plant of keptPlants) {
        plant.protectionCap = plant.isValueDeclared
          ? plant.declaredValue
          : null;
      }
      await manager.save(keptPlants);

      const customerConfirmDueAt = new Date(
        Date.now() + CUSTOMER_CONFIRM_WINDOW_MS,
      );
      await manager.update(Handover, handover.id, {
        status: 'AWAITING_CUSTOMER',
        customerConfirmDueAt,
      });
      locked.finalTotal = finalTotal;
      locked.status = 'HANDOVER_AWAITING_CONFIRM';
      await manager.save(locked);
      return { finalTotal, customerConfirmDueAt };
    });
  }

  /**
   * POST /orders/:id/handover/confirm — khách xác nhận (→ IN_CARE, hết scope
   * Phase 1). Điểm khóa giá CHÍNH THỨC: chữ ký HANDOVER + finalLockedAt;
   * cây REJECT hoàn tiền bằng bút toán REFUND (admin chuyển tay theo sổ);
   * chênh ADJUST chỉ ghi nhận — quyết toán sau IN_CARE là luồng payout.
   */
  async confirmHandover(
    accountId: string,
    orderId: string,
    ip: string | undefined,
  ) {
    const order = await this.getOrderAsCustomer(accountId, orderId);
    if (order.status !== 'HANDOVER_AWAITING_CONFIRM') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    assertTransition(order.status, 'IN_CARE');

    const handover = await this.handoverRepo.findOne({
      where: { serviceOrderId: order.id, status: 'AWAITING_CUSTOMER' },
    });
    if (!handover) {
      throw new InternalServerErrorException('HANDOVER_NOT_FOUND');
    }
    const plants = await this.plantRepo.find({
      where: { serviceOrderId: order.id },
    });
    const rejectedCount = plants.filter(
      (plant) => plant.handoverDecision === 'REJECT',
    ).length;

    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(ServiceOrder, {
        where: { id: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== 'HANDOVER_AWAITING_CONFIRM') {
        throw new ConflictException('INVALID_STATE_TRANSITION');
      }
      const now = new Date();
      await manager.update(Handover, handover.id, {
        status: 'CONFIRMED',
        confirmedAt: now,
        lockedAt: now,
      });

      // Chữ ký giai đoạn HANDOVER — cùng bảng chữ ký online, phase khác.
      const agreement = await manager.findOne(ServiceAgreement, {
        where: { serviceOrderId: order.id },
      });
      if (!agreement) {
        throw new InternalServerErrorException('AGREEMENT_NOT_FOUND');
      }
      await manager.save(
        manager.create(AgreementSignature, {
          agreementId: agreement.id,
          signerId: accountId,
          signerRole: 'CUSTOMER' as const,
          signPhase: 'HANDOVER' as const,
          signedAt: now,
          signatureHash: createHash('sha256')
            .update(
              `${agreement.id}|${accountId}|HANDOVER|${now.toISOString()}`,
            )
            .digest('hex'),
          ipAddress: ip ?? null,
        }),
      );

      // Cây bị loại chốt hẳn tại đây → ghi nợ hoàn phần đó vào sổ escrow.
      if (rejectedCount > 0) {
        const refund = BigInt(locked.basePriceSnapshot) * BigInt(rejectedCount);
        const lastBalance = await this.lastEscrowBalance(manager, order.id);
        await manager.save(
          manager.create(EscrowLedger, {
            serviceOrderId: order.id,
            transactionId: null,
            entryType: 'REFUND' as const,
            amount: (-refund).toString(),
            balanceAfter: (lastBalance - refund).toString(),
            note: `Hoàn ${rejectedCount} cây bị từ chối tại bàn giao đơn ${locked.orderCode}`,
          }),
        );
      }

      locked.finalLockedAt = now;
      locked.careStartedAt = now;
      locked.careDueAt = new Date(
        now.getTime() + locked.durationDaysSnapshot * 24 * 60 * 60 * 1000,
      );
      locked.status = 'IN_CARE';
      await manager.save(locked);
      return {
        status: locked.status,
        finalTotal: locked.finalTotal,
        careDueAt: locked.careDueAt,
      };
    });
  }

  // ---- helpers ----

  // Load đơn với tư cách provider của đơn — người ngoài → 404, chống IDOR.
  private async getOrderAsProvider(accountId: string, orderId: string) {
    const provider = await this.providerRepo.findOne({ where: { accountId } });
    if (!provider) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    // D10: vườn bị tước APPROVED (giấy phép giả...) không được tiếp tục bàn giao.
    if (provider.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException('PROFILE_NOT_APPROVED');
    }
    const order = await this.orderRepo.findOne({
      where: { id: orderId, providerId: provider.id },
    });
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    return order;
  }

  private async getOrderAsCustomer(accountId: string, orderId: string) {
    const customer = await this.customerRepo.findOne({ where: { accountId } });
    if (!customer) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    const order = await this.orderRepo.findOne({
      where: { id: orderId, customerId: customer.id },
    });
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    return order;
  }

  // Phiên IN_PROGRESS phải tồn tại khi đơn đang HANDOVER_IN_PROGRESS — lệch là lỗi hệ thống.
  private async getActiveHandover(serviceOrderId: string) {
    const handover = await this.handoverRepo.findOne({
      where: { serviceOrderId, status: 'IN_PROGRESS' },
    });
    if (!handover) {
      throw new InternalServerErrorException('HANDOVER_NOT_FOUND');
    }
    return handover;
  }

  // Số dư escrow hiện tại của đơn = balance_after của bút toán mới nhất.
  private async lastEscrowBalance(
    manager: EntityManager,
    orderId: string,
  ): Promise<bigint> {
    const last = await manager.getRepository(EscrowLedger).findOne({
      where: { serviceOrderId: orderId },
      order: { createdAt: 'DESC' },
    });
    return last ? BigInt(last.balanceAfter) : 0n;
  }
}
