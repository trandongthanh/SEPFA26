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
import { refundCancelledHandover } from '../payments/cancel-order-refund';
import { loadCustomerSettlement } from '../payments/customer-settlement';
import { SecurityDeposit } from '../payments/entities/security-deposit.entity';
import { settleOrder } from '../payments/settle-order';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { closeAddonsForReturn } from './addon-expiry';
import { compensationCapFor } from './compensation-cap';
import { AssessPlantDto } from './dto/assess-plant.dto';
import { AssessReturnPlantDto } from './dto/assess-return-plant.dto';
import { CancelHandoverDto } from './dto/cancel-handover.dto';
import { CancelReturnDto } from './dto/cancel-return.dto';
import { ConfirmHandoverDto } from './dto/confirm-handover.dto';
import { DeclineHandoverDto } from './dto/decline-handover.dto';
import { AgreementSignature } from './entities/agreement-signature.entity';
import { AssessmentPhoto } from './entities/assessment-photo.entity';
import { Handover } from './entities/handover.entity';
import { HandoverItem } from './entities/handover-item.entity';
import { HandoverObjectionPhoto } from './entities/handover-objection-photo.entity';
import { Plant } from './entities/plant.entity';
import { PlantAssessment } from './entities/plant-assessment.entity';
import { ServiceAgreement } from './entities/service-agreement.entity';
import { ServiceOrder } from './entities/service-order.entity';
import { generateSecurityDepositCode } from './order-code';
import { OrderStateService } from './order-state.service';
import { assertTransition } from './order-status';

// Hạn khách xác nhận kết quả bàn giao — cron auto-confirm HOÃN, deadline vẫn ghi sẵn.
const CUSTOMER_CONFIRM_WINDOW_MS = 48 * 60 * 60 * 1000;

// Vườn có 2 giờ kể từ lúc khách đồng ý biên bản để nộp tiền bảo đảm; quá hạn thì bộ quét huỷ đơn.
export const SECURITY_DEPOSIT_WINDOW_MS = 2 * 60 * 60 * 1000;
const DEPOSIT_CODE_MAX_RETRY = 3;

/**
 * Các endpoint bàn giao nhận cây (PAID → IN_CARE): giá tạm khóa lúc ký online, giá CHÍNH THỨC
 * (giá gói × số cây vườn nhận) chốt lúc vườn chốt biên bản. Thứ tự tại chỗ: vườn khám, chọn cây →
 * khách đồng ý (có thể kèm phản đối) → vườn nộp tiền bảo đảm → tiền về (webhook SePay) → IN_CARE.
 * Hai lối huỷ tại chỗ: khách không giao cây (decline), vườn không nộp tiền bảo đảm (cancel / quá 2 giờ).
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
    private readonly orderState: OrderStateService,
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
      const locked = await this.orderState.transition(
        manager,
        order.id,
        'PAID',
        'HANDOVER_IN_PROGRESS',
      );
      const handover = await manager.save(
        manager.create(Handover, {
          serviceOrderId: order.id,
          handoverType: 'IN' as const,
          status: 'IN_PROGRESS' as const,
        }),
      );
      return { handoverId: handover.id, status: locked.status };
    });
  }

  /**
   * POST /orders/:id/handover/plants/:plantId/assess — thẩm định TỪNG cây.
   * Append-only: re-assess trước complete tạo bản ghi MỚI, plant lấy quyết định
   * mới nhất, chuỗi bằng chứng cũ giữ nguyên. Vườn chỉ nhận / nhận kèm cờ rủi ro /
   * từ chối — không sửa giá công (chăm thêm thì đề xuất add-on).
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
   * (→ HANDOVER_AWAITING_CONFIRM). Giá công chốt = basePriceSnapshot × số cây được nhận,
   * server tự tính (vườn không sửa giá). Mỗi cây được nhận có mức đền: có khai giá = giá khai,
   * không khai = 2 × giá gói; tổng mức đền = tiền bảo đảm vườn sẽ phải nộp.
   * Đơn mẫu 2 cây × 200.000, cây A khai 3.000.000, cây B không khai: finalTotal 400.000,
   * mức đền 3.000.000 + 400.000 → securityDepositAmount 3.400.000.
   * REJECT toàn bộ thì không cho complete — ép đường cancel để logic tiền hủy nằm 1 chỗ.
   */
  async completeHandover(accountId: string, orderId: string) {
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
    const basePrice = BigInt(order.basePriceSnapshot);
    const finalTotal = (basePrice * BigInt(keptPlants.length)).toString();
    const handover = await this.getActiveHandover(order.id);

    return this.dataSource.transaction(async (manager) => {
      const locked = await this.orderState.transition(
        manager,
        order.id,
        'HANDOVER_IN_PROGRESS',
        'HANDOVER_AWAITING_CONFIRM',
      );
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
      // Mức đền cho MỌI cây được nhận: có khai giá = giá khai, không khai = 2 × giá gói.
      // (isValueDeclared mà thiếu declaredValue là dữ liệu cũ — coi như không khai.)
      let securityDepositAmount = 0n;
      for (const plant of keptPlants) {
        const cap = compensationCapFor(plant, basePrice);
        plant.protectionCap = cap.toString();
        securityDepositAmount += cap;
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
      await manager.save(locked);
      return {
        finalTotal,
        customerConfirmDueAt,
        // Tổng mức đền các cây được nhận = tiền bảo đảm vườn phải nộp.
        securityDepositAmount: securityDepositAmount.toString(),
        plants: keptPlants.map((plant) => ({
          plantId: plant.id,
          compensationCap: plant.protectionCap,
        })),
      };
    });
  }

  /**
   * POST /orders/:id/handover/confirm — khách đồng ý biên bản nhận cây (có thể kèm ý kiến phản đối + ảnh).
   * Đơn GIỮ NGUYÊN HANDOVER_AWAITING_CONFIRM; phiên nhận cây sang AWAITING_DEPOSIT và sinh khoản tiền bảo đảm
   * vườn phải nộp trong 2 giờ = tổng mức đền các cây được nhận (đơn mẫu 3.000.000 + 400.000 = 3.400.000).
   * Tiền bảo đảm về (webhook SePay) thì đơn mới sang IN_CARE và mới bắt đầu tính ngày chăm.
   * Chữ ký giai đoạn HANDOVER của khách vẫn ghi ở đây. KHÔNG đụng sổ đơn.
   * Bấm lần 2 → 409 (phiên không còn AWAITING_CUSTOMER).
   */
  async confirmHandover(
    accountId: string,
    orderId: string,
    dto: ConfirmHandoverDto,
    ip: string | undefined,
  ) {
    const order = await this.getOrderAsCustomer(accountId, orderId);
    if (order.status !== 'HANDOVER_AWAITING_CONFIRM') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }

    return this.dataSource.transaction(async (manager) => {
      // Khoá dòng đơn + kiểm lại: bấm đúp / khách bấm "không giao cây" cùng lúc chỉ một bên thắng.
      const locked = await this.orderState.lock(manager, order.id);
      if (!locked || locked.status !== 'HANDOVER_AWAITING_CONFIRM') {
        throw new ConflictException('INVALID_STATE_TRANSITION');
      }
      const handover = await manager.findOne(Handover, {
        where: {
          serviceOrderId: order.id,
          handoverType: 'IN',
          status: 'AWAITING_CUSTOMER',
        },
      });
      if (!handover) {
        // Khách đã đồng ý rồi (phiên đang AWAITING_DEPOSIT).
        throw new ConflictException('INVALID_STATE_TRANSITION');
      }
      const now = new Date();

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

      // Ý kiến phản đối + ảnh của khách: khoá cùng biên bản, làm bằng chứng lúc tranh chấp.
      const objectionPhotos = dto.objectionPhotos ?? [];
      if (objectionPhotos.length > 0) {
        await manager.save(
          objectionPhotos.map((photo) =>
            manager.create(HandoverObjectionPhoto, {
              handoverId: handover.id,
              photoUrl: photo.photoUrl,
              caption: photo.caption || null,
            }),
          ),
        );
      }

      // Tiền bảo đảm = Σ mức đền (protection_cap đã ghi lúc vườn chốt biên bản) của cây được nhận.
      const plants = await manager.find(Plant, {
        where: { serviceOrderId: order.id },
      });
      const amount = plants
        .filter(
          (plant) =>
            plant.handoverDecision !== null &&
            plant.handoverDecision !== 'REJECT',
        )
        .reduce((sum, plant) => sum + BigInt(plant.protectionCap ?? '0'), 0n);
      const dueAt = new Date(now.getTime() + SECURITY_DEPOSIT_WINDOW_MS);
      const deposit = await manager.save(
        manager.create(SecurityDeposit, {
          serviceOrderId: order.id,
          providerId: order.providerId,
          amount: amount.toString(),
          depositCode: await this.newDepositCode(manager),
          dueAt,
          status: 'PENDING' as const,
        }),
      );

      await manager.update(Handover, handover.id, {
        status: 'AWAITING_DEPOSIT',
        customerObjectionNote: dto.objectionNote || null,
      });
      return {
        status: locked.status,
        handoverStatus: 'AWAITING_DEPOSIT' as const,
        finalTotal: locked.finalTotal,
        securityDepositAmount: deposit.amount,
        depositDueAt: deposit.dueAt,
      };
    });
  }

  /**
   * POST /orders/:id/handover/decline — khách KHÔNG giao cây sau khi xem biên bản (phiên đang
   * AWAITING_CUSTOMER, vườn chưa nộp gì). Đơn → CANCELLED. Vườn đã mất công tới nơi nên giữ phí lấy cây;
   * khách nhận lại giá gói + 6%; nền tảng không thu. Đơn mẫu: khách 424.000, vườn 60.000.
   * Khách đã đồng ý biên bản rồi (phiên AWAITING_DEPOSIT) → 409, vì khách đã ký.
   */
  async declineHandover(
    accountId: string,
    orderId: string,
    dto: DeclineHandoverDto,
  ) {
    const order = await this.getOrderAsCustomer(accountId, orderId);
    if (order.status !== 'HANDOVER_AWAITING_CONFIRM') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    assertTransition(order.status, 'CANCELLED');

    return this.dataSource.transaction(async (manager) => {
      const locked = await this.orderState.transition(
        manager,
        order.id,
        'HANDOVER_AWAITING_CONFIRM',
        'CANCELLED',
      );
      const now = new Date();
      // Điều kiện status trong câu UPDATE: phiên đã sang AWAITING_DEPOSIT thì không dòng nào đổi → 409,
      // cả transaction huỷ (đơn vẫn chờ vườn nộp tiền bảo đảm).
      const cancelled = await manager.update(
        Handover,
        {
          serviceOrderId: order.id,
          handoverType: 'IN',
          status: 'AWAITING_CUSTOMER',
        },
        { status: 'CANCELLED', note: dto.reason },
      );
      if (!cancelled.affected) {
        throw new ConflictException('INVALID_STATE_TRANSITION');
      }
      locked.cancelledBy = 'CUSTOMER';
      locked.cancelledAt = now;
      locked.cancelReason = dto.reason;
      await manager.save(locked);

      const { customerRefund } = await refundCancelledHandover(
        manager,
        locked,
        now,
        'CUSTOMER',
      );
      // Route của KHÁCH: chỉ trả số khách nhận lại, không trả phần của vườn.
      return {
        status: locked.status,
        refundAmount: customerRefund.toString(),
      };
    });
  }

  /**
   * POST /orders/:id/handover/cancel — vườn tự huỷ vì không nộp được tiền bảo đảm (phiên đang
   * AWAITING_DEPOSIT, khoản còn PENDING). Lỗi của vườn → khách nhận lại 100%, kể cả phí lấy cây.
   */
  async cancelHandover(
    accountId: string,
    orderId: string,
    dto: CancelHandoverDto,
  ) {
    const order = await this.getOrderAsProvider(accountId, orderId);
    return this.dataSource.transaction(async (manager) => {
      await this.cancelForUnpaidDeposit(manager, order.id, dto.reason);
      return { status: 'CANCELLED' as const };
    });
  }

  /**
   * Lõi của nhánh "vườn không nộp tiền bảo đảm" — dùng chung cho vườn bấm huỷ và bộ quét hết 2 giờ.
   * Gọi BÊN TRONG transaction của nơi gọi (mỗi đơn một transaction). Khoá dòng đơn rồi kiểm lại khoản
   * bảo đảm còn PENDING: tiền vừa về (webhook) hoặc đã huỷ rồi → 409 SECURITY_DEPOSIT_NOT_PENDING,
   * không đổi gì. Đơn mẫu: sổ đơn REFUND −484.000 → 0, 1 lệnh chi REFUND 484.000 cho khách,
   * mọi dòng hoá đơn REFUNDED, khoản bảo đảm + phiên nhận cây CANCELLED.
   * Hàm này KHÔNG kiểm hạn 2 giờ — nơi gọi tự quyết lúc nào được huỷ.
   */
  async cancelForUnpaidDeposit(
    manager: EntityManager,
    orderId: string,
    reason: string,
  ): Promise<void> {
    const locked = await this.orderState.lock(manager, orderId);
    const deposit = locked
      ? await manager.findOne(SecurityDeposit, {
          where: { serviceOrderId: orderId, status: 'PENDING' },
          lock: { mode: 'pessimistic_write' },
        })
      : null;
    if (!locked || !deposit) {
      throw new ConflictException('SECURITY_DEPOSIT_NOT_PENDING');
    }
    await this.orderState.apply(manager, locked, 'CANCELLED');
    const now = new Date();
    deposit.status = 'CANCELLED';
    await manager.save(deposit);
    await manager.update(
      Handover,
      {
        serviceOrderId: orderId,
        handoverType: 'IN',
        status: 'AWAITING_DEPOSIT',
      },
      { status: 'CANCELLED', note: reason },
    );
    locked.cancelledBy = 'PROVIDER';
    locked.cancelledAt = now;
    locked.cancelReason = reason;
    await manager.save(locked);

    await refundCancelledHandover(manager, locked, now, 'PROVIDER');
  }

  // ---- Trả cây (IN_CARE → COMPLETED) ----

  /**
   * POST /orders/:id/return/start — vườn bắt đầu trả cây (IN_CARE → RETURN_IN_PROGRESS).
   * Chỉ khi đã hết hạn chăm (care_due_at); trả sớm = dừng giữa chừng, làm sau.
   * Còn add-on đã trả tiền mà chưa báo xong thì chưa trả cây được (ADDON_OPEN).
   */
  async startReturn(accountId: string, orderId: string) {
    const order = await this.getOrderAsProvider(accountId, orderId);
    if (order.status !== 'IN_CARE') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    if (!order.careDueAt || Date.now() < order.careDueAt.getTime()) {
      throw new ConflictException('CARE_NOT_DUE');
    }

    return this.dataSource.transaction(async (manager) => {
      const locked = await this.orderState.transition(
        manager,
        order.id,
        'IN_CARE',
        'RETURN_IN_PROGRESS',
      );
      // Add-on khách đã trả tiền mà chưa làm xong → 409 ADDON_OPEN (huỷ cả transaction, đơn vẫn IN_CARE);
      // đề xuất còn chờ trả lời / chờ trả tiền → đóng lại vì cây sắp về nhà khách.
      await closeAddonsForReturn(manager, order.id, new Date());
      const handover = await manager.save(
        manager.create(Handover, {
          serviceOrderId: order.id,
          handoverType: 'OUT' as const,
          status: 'IN_PROGRESS' as const,
        }),
      );
      return { handoverId: handover.id, status: locked.status };
    });
  }

  /**
   * POST /orders/:id/return/plants/:plantId/assess — ghi tình trạng 1 cây lúc trả.
   * Append-only như lúc nhận; KHÔNG đụng plants.handover_decision / is_high_risk
   * (đó là mốc lúc nhận, giữ làm bằng chứng so sánh).
   */
  async assessReturnPlant(
    accountId: string,
    orderId: string,
    plantId: string,
    dto: AssessReturnPlantDto,
  ) {
    const order = await this.getOrderAsProvider(accountId, orderId);
    if (order.status !== 'RETURN_IN_PROGRESS') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    const plant = await this.plantRepo.findOne({
      where: { id: plantId, serviceOrderId: order.id },
    });
    if (!plant) {
      throw new NotFoundException('PLANT_NOT_FOUND');
    }
    if (plant.handoverDecision === 'REJECT') {
      // Cây bị từ chối lúc nhận: vườn chưa từng giữ, không có gì để trả.
      throw new BadRequestException('PLANT_NOT_IN_CARE');
    }
    const handover = await this.getActiveHandover(order.id, 'OUT');

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
      return { assessmentId: assessment.id };
    });
  }

  /**
   * POST /orders/:id/return/complete — vườn kiểm xong mọi cây đang chăm
   * (→ RETURN_AWAITING_CONFIRM), hẹn khách xác nhận trong 48h.
   */
  async completeReturn(accountId: string, orderId: string) {
    const order = await this.getOrderAsProvider(accountId, orderId);
    if (order.status !== 'RETURN_IN_PROGRESS') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    const handover = await this.getActiveHandover(order.id, 'OUT');
    const plants = await this.plantRepo.find({
      where: { serviceOrderId: order.id },
    });
    const caredIds = plants
      .filter((plant) => plant.handoverDecision !== 'REJECT')
      .map((plant) => plant.id);
    const assessed = await this.dataSource
      .getRepository(PlantAssessment)
      .createQueryBuilder('pa')
      .select('DISTINCT pa.plant_id', 'plantId')
      .where('pa.handover_id = :handoverId', { handoverId: handover.id })
      .getRawMany<{ plantId: string }>();
    const assessedIds = new Set(assessed.map((row) => row.plantId));
    if (caredIds.some((id) => !assessedIds.has(id))) {
      throw new BadRequestException('UNASSESSED_PLANTS');
    }

    return this.dataSource.transaction(async (manager) => {
      const locked = await this.orderState.transition(
        manager,
        order.id,
        'RETURN_IN_PROGRESS',
        'RETURN_AWAITING_CONFIRM',
      );
      const customerConfirmDueAt = new Date(
        Date.now() + CUSTOMER_CONFIRM_WINDOW_MS,
      );
      await manager.update(Handover, handover.id, {
        status: 'AWAITING_CUSTOMER',
        customerConfirmDueAt,
      });
      return { status: locked.status, customerConfirmDueAt };
    });
  }

  /**
   * POST /orders/:id/return/cancel — vườn huỷ phiên trả (khách vắng nhà...)
   * → đơn về IN_CARE để hẹn lại. Ảnh và bản ghi đã chụp giữ nguyên.
   */
  async cancelReturn(accountId: string, orderId: string, dto: CancelReturnDto) {
    const order = await this.getOrderAsProvider(accountId, orderId);
    if (order.status !== 'RETURN_IN_PROGRESS') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    const handover = await this.getActiveHandover(order.id, 'OUT');

    return this.dataSource.transaction(async (manager) => {
      const locked = await this.orderState.transition(
        manager,
        order.id,
        'RETURN_IN_PROGRESS',
        'IN_CARE',
      );
      await manager.update(Handover, handover.id, {
        status: 'CANCELLED',
        note: dto.reason,
      });
      return { status: locked.status };
    });
  }

  /**
   * POST /orders/:id/return/confirm — khách xác nhận đã nhận lại cây (→ COMPLETED).
   * Không chữ ký. Cùng transaction: chia tiền (REFUND nếu có cây bị từ chối lúc nhận, PLATFORM_FEE,
   * PAYOUT → sổ về 0) và tạo lệnh chi (settle-order.ts) — lỗi bất kỳ bước nào thì đơn vẫn chờ khách xác nhận.
   */
  async confirmReturn(accountId: string, orderId: string) {
    const order = await this.getOrderAsCustomer(accountId, orderId);
    if (order.status !== 'RETURN_AWAITING_CONFIRM') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    const handover = await this.handoverRepo.findOne({
      where: {
        serviceOrderId: order.id,
        handoverType: 'OUT',
        status: 'AWAITING_CUSTOMER',
      },
    });
    if (!handover) {
      throw new InternalServerErrorException('HANDOVER_NOT_FOUND');
    }

    return this.dataSource.transaction(async (manager) => {
      const locked = await this.orderState.transition(
        manager,
        order.id,
        'RETURN_AWAITING_CONFIRM',
        'COMPLETED',
      );
      const completedAt = await this.finalizeReturn(
        manager,
        handover.id,
        'CONFIRMED',
      );
      await settleOrder(manager, locked, completedAt);
      // Route của KHÁCH → chỉ trả phần khách được thấy (cùng hình dạng `settlement` trong chi tiết đơn);
      // phí 12%, phí nền tảng, số vườn nhận không trả ở đây.
      const settlement = await loadCustomerSettlement(manager, locked.id);
      return { status: locked.status, completedAt, settlement };
    });
  }

  /**
   * Chốt phiên trả cây — dùng chung cho khách bấm tay và tác vụ tự xác nhận 48h.
   * Điều kiện status = AWAITING_CUSTOMER để 2 đường không chốt chồng nhau.
   */
  async finalizeReturn(
    manager: EntityManager,
    handoverId: string,
    mode: 'CONFIRMED' | 'AUTO_CONFIRMED',
  ): Promise<Date> {
    const now = new Date();
    await manager.update(
      Handover,
      { id: handoverId, status: 'AWAITING_CUSTOMER' },
      { status: mode, confirmedAt: now, lockedAt: now },
    );
    return now;
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

  // Mã chuyển khoản bảo đảm chưa ai dùng (4,3 tỷ mã — trùng cực hiếm, thử lại vài lần cho chắc;
  // DB vẫn có UNIQUE làm chốt cuối).
  private async newDepositCode(manager: EntityManager): Promise<string> {
    for (let attempt = 0; attempt < DEPOSIT_CODE_MAX_RETRY; attempt++) {
      const code = generateSecurityDepositCode();
      const taken = await manager.exists(SecurityDeposit, {
        where: { depositCode: code },
      });
      if (!taken) return code;
    }
    throw new InternalServerErrorException('DEPOSIT_CODE_GENERATION_FAILED');
  }

  // Phiên IN_PROGRESS đúng chiều phải tồn tại khi đơn đang ở chặng đó — lệch là lỗi hệ thống.
  private async getActiveHandover(
    serviceOrderId: string,
    handoverType: 'IN' | 'OUT' = 'IN',
  ) {
    const handover = await this.handoverRepo.findOne({
      where: { serviceOrderId, handoverType, status: 'IN_PROGRESS' },
    });
    if (!handover) {
      throw new InternalServerErrorException('HANDOVER_NOT_FOUND');
    }
    return handover;
  }
}
