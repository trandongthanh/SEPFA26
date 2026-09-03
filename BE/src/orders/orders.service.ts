import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { PaymentComponent } from '../payments/entities/payment-component.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { ServicePackage } from '../providers/entities/service-package.entity';
import { DistanceService } from './distance.service';
import { PlantRecognitionService } from './plant-recognition.service';
import { AddInitialPhotoDto } from './dto/add-initial-photo.dto';
import { CreateOrderDto, CreateOrderPlantDto } from './dto/create-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { RespondNegotiationDto } from './dto/respond-negotiation.dto';
import { ShippingRateInputDto } from './dto/replace-shipping-rates.dto';
import { AgreementSignature } from './entities/agreement-signature.entity';
import { Handover } from './entities/handover.entity';
import { InitialPhoto } from './entities/initial-photo.entity';
import { Negotiation } from './entities/negotiation.entity';
import { Plant } from './entities/plant.entity';
import { ServiceAgreement } from './entities/service-agreement.entity';
import { ServiceOrder } from './entities/service-order.entity';
import { ShippingRate } from './entities/shipping-rate.entity';
import { generateAgreementNo, generateOrderCode } from './order-code';
import { assertTransition } from './order-status';
import { computeShippingFee, pickTier } from './shipping-fee';

// Postgres unique_violation — bắt để retry orderCode trùng.
const PG_UNIQUE_VIOLATION = '23505';
const ORDER_CODE_MAX_RETRY = 3;

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(ServiceOrder)
    private readonly orderRepo: Repository<ServiceOrder>,
    @InjectRepository(Plant)
    private readonly plantRepo: Repository<Plant>,
    @InjectRepository(InitialPhoto)
    private readonly photoRepo: Repository<InitialPhoto>,
    @InjectRepository(AgreementSignature)
    private readonly agreementSignatureRepo: Repository<AgreementSignature>,
    @InjectRepository(ShippingRate)
    private readonly shippingRateRepo: Repository<ShippingRate>,
    @InjectRepository(CustomerProfile)
    private readonly customerRepo: Repository<CustomerProfile>,
    @InjectRepository(ProviderProfile)
    private readonly providerRepo: Repository<ProviderProfile>,
    @InjectRepository(ServicePackage)
    private readonly packageRepo: Repository<ServicePackage>,
    private readonly distanceService: DistanceService,
    private readonly plantRecognition: PlantRecognitionService,
    private readonly dataSource: DataSource,
  ) {}

  async listShippingRatesForAdmin(): Promise<ShippingRate[]> {
    return this.shippingRateRepo.find({ order: { minKm: 'ASC' } });
  }

  async replaceShippingRates(rates: ShippingRateInputDto[]): Promise<ShippingRate[]> {
    const sorted = [...rates].sort((a, b) => a.minKm - b.minKm);
    for (let index = 0; index < sorted.length; index++) {
      const rate = sorted[index];
      const next = sorted[index + 1];
      if (rate.maxKm !== null && rate.maxKm !== undefined && rate.maxKm <= rate.minKm) {
        throw new BadRequestException('SHIPPING_RATE_RANGE_INVALID');
      }
      if (next && rate.maxKm !== next.minKm) {
        throw new BadRequestException('SHIPPING_RATE_RANGES_MUST_BE_CONTIGUOUS');
      }
      if (!next && rate.maxKm !== null && rate.maxKm !== undefined) {
        throw new BadRequestException('LAST_SHIPPING_RATE_MUST_NOT_HAVE_MAX_KM');
      }
    }
    return this.dataSource.transaction(async (manager) => {
      // Đây là thao tác thay toàn bộ cấu hình do Admin gửi lên. TypeORM 0.3+
      // không cho phép delete({}); QueryBuilder biểu đạt rõ chủ đích xoá tất cả.
      await manager.createQueryBuilder().delete().from(ShippingRate).execute();
      const saved = await manager.save(
        ShippingRate,
        sorted.map((rate) =>
          manager.create(ShippingRate, {
            minKm: String(rate.minKm),
            maxKm: rate.maxKm === null || rate.maxKm === undefined ? null : String(rate.maxKm),
            baseFee: String(rate.baseFee),
            perKmFee: String(rate.perKmFee),
            billingUnitKm: rate.billingUnitKm === null || rate.billingUnitKm === undefined ? null : String(rate.billingUnitKm),
            isActive: rate.isActive ?? true,
          }),
        ),
      );
      return saved.sort((a, b) => Number(a.minKm) - Number(b.minKm));
    });
  }

  /**
   * POST /orders — tạo đơn DRAFT.
   * 9 bước theo docs/sequence-diagrams/orders-create.md: lỗi rẻ check trước,
   * gọi Google (tốn tiền/chậm) gần cuối, ghi DB trong 1 transaction sau cùng.
   * Client không gửi số tiền nào — server tính hết rồi snapshot vào đơn.
   */
  async createOrder(accountId: string, dto: CreateOrderDto) {
    // 1. Hồ sơ khách + GPS (không có tọa độ thì không tính được phí ship).
    const customer = await this.customerRepo.findOne({ where: { accountId }, relations: { account: true } });
    if (!customer) {
      throw new NotFoundException('CUSTOMER_PROFILE_NOT_FOUND');
    }
    if (
      customer.verificationStatus !== 'APPROVED' ||
      !customer.cccdFrontUrl || !customer.cccdBackUrl || !customer.selfieWithIdUrl ||
      !customer.account?.phone
    ) {
      throw new ForbiddenException('Vui lòng hoàn tất xác minh căn cước, ảnh selfie cùng căn cước và chờ admin duyệt trước khi đặt đơn.');
    }

    // 2. Giờ hẹn lấy cây phải ở tương lai (mốc duy nhất của luật hủy).
    const scheduledPickupAt = new Date(dto.scheduledPickupAt);
    if (scheduledPickupAt.getTime() <= Date.now()) {
      throw new BadRequestException('PICKUP_TIME_IN_PAST');
    }

    // 3+4. Gói tồn tại, đang bán, provider đã APPROVED — với khách, gói chưa đạt
    // các điều kiện này coi như không tồn tại (404, không lộ lý do).
    const pkg = await this.packageRepo.findOne({
      where: { id: dto.servicePackageId, isActive: true },
      relations: { provider: true },
    });
    if (!pkg || pkg.provider.verificationStatus !== 'APPROVED') {
      throw new NotFoundException('SERVICE_PACKAGE_NOT_FOUND');
    }

    // 5. Provider phải đã ghim GPS — lỗi dữ liệu phía hệ thống, không phải lỗi khách.
    if (pkg.provider.gpsLat === null || pkg.provider.gpsLng === null) {
      throw new ServiceUnavailableException('PROVIDER_GPS_MISSING');
    }

    // 6. Số cây trong giới hạn gói.
    if (dto.plants.length > pkg.maxPlants) {
      throw new BadRequestException('PLANT_COUNT_EXCEEDS_PACKAGE');
    }

    // 7. Giá khai từng cây nằm trong khoảng gói cho phép.
    for (const plant of dto.plants) {
      this.assertDeclaredValueInRange(plant, pkg);
    }

    // 8. Đo km (Google, lỗi → 503) rồi tính phí theo bậc giá trong DB.
    const km = await this.distanceService.getKm(
      { lat: dto.pickupGpsLat, lng: dto.pickupGpsLng },
      { lat: Number(pkg.provider.gpsLat), lng: Number(pkg.provider.gpsLng) },
    );
    const tiers = await this.shippingRateRepo.find({
      where: { isActive: true },
      order: { minKm: 'ASC' },
    });

    let pickupFee: number;
    if (tiers.length === 0) {
      // Fallback: if no shipping rates configured in DB, avoid blocking customer
      // flows in dev/staging. Default to zero pickup fee and log a warning.
      // Production should seed shipping rates properly.
      // TODO: consider returning a warning to FE so admins can be alerted.
      console.warn(
        'No active shipping rates configured — defaulting pickup fee to 0.',
      );
      pickupFee = 0;
    } else {
      const tier = pickTier(tiers, km);
      if (!tier) {
        throw new ServiceUnavailableException('SHIPPING_RATE_NOT_CONFIGURED');
      }
      pickupFee = computeShippingFee(tier, km, dto.plants.length);
    }

    // 9. Tính tiền (BigInt — tiền bigint không đi qua number) + ghi trong 1 transaction.
    // provisionalTotal KHÔNG gồm ship — ship nằm riêng ở pickupFeeSnapshot (component PICKUP_FEE sau này).
    const provisionalTotal = BigInt(pkg.basePrice) * BigInt(dto.plants.length);

    // D12: vòng retry NẰM NGOÀI transaction — mỗi lần thử là 1 transaction riêng.
    // (Trong 1 transaction, INSERT trùng làm transaction hỏng → lần thử sau cũng lỗi.)
    for (let attempt = 1; attempt <= ORDER_CODE_MAX_RETRY; attempt++) {
      try {
        return await this.dataSource.transaction((manager) => {
          const order = manager.create(ServiceOrder, {
            orderCode: generateOrderCode(),
            customerId: customer.id,
            providerId: pkg.providerId,
            servicePackageId: pkg.id,
            status: 'DRAFT',
            plantCount: dto.plants.length,
            basePriceSnapshot: pkg.basePrice,
            pickupFeeSnapshot: String(pickupFee),
            durationDaysSnapshot: pkg.durationDays,
            reportFrequencySnapshot: pkg.reportFrequencyDays,
            provisionalTotal: provisionalTotal.toString(),
            scheduledPickupAt,
            pickupAddress: dto.pickupAddress?.trim() || null,
            pickupGpsLat: String(dto.pickupGpsLat),
            pickupGpsLng: String(dto.pickupGpsLng),
            customerNote: dto.customerNote ?? null,
            plants: dto.plants.map((plant) =>
              manager.create(Plant, {
                name: plant.name,
                speciesName: plant.speciesName ?? null,
                // Khai giá mà quên set cờ → server tự hiểu là có khai.
                isValueDeclared:
                  plant.declaredValue !== undefined ||
                  (plant.isValueDeclared ?? false),
                declaredValue: plant.declaredValue ?? null,
              }),
            ),
          });
          return manager.save(order); // cascade insert plants cùng transaction
        });
      } catch (err) {
        if (
          attempt < ORDER_CODE_MAX_RETRY &&
          (err as { code?: string }).code === PG_UNIQUE_VIOLATION
        ) {
          continue; // orderCode trùng (~1/4,3 tỷ) → sinh mã khác, transaction mới
        }
        throw err;
      }
    }
    throw new InternalServerErrorException('ORDER_CODE_GENERATION_FAILED');
  }

  /**
   * POST /orders/:id/plants/:plantId/initial-photos — thêm ảnh hiện trạng.
   * Chỉ chủ đơn (sai chủ → 404 chống IDOR), chỉ khi đơn còn DRAFT.
   * Ảnh append-only — bằng chứng gốc khi tranh chấp, không có API sửa/xóa.
   */
  async addInitialPhoto(
    accountId: string,
    orderId: string,
    plantId: string,
    dto: AddInitialPhotoDto,
  ) {
    const order = await this.getOwnedOrderAsCustomer(accountId, orderId);
    if (order.status !== 'DRAFT') {
      throw new ConflictException('ORDER_NOT_EDITABLE');
    }
    const plant = await this.plantRepo.findOne({
      where: { id: plantId, serviceOrderId: order.id },
    });
    if (!plant) {
      throw new NotFoundException('PLANT_NOT_FOUND');
    }
    const analysis = await this.plantRecognition.enrich(
      dto.photoUrl,
      dto.analysis ?? null,
    );
    return this.photoRepo.save(
      this.photoRepo.create({
        plantId: plant.id,
        photoUrl: dto.photoUrl,
        caption: dto.caption ?? null,
        analysis,
      }),
    );
  }

  /**
   * POST /orders/:id/submit — gửi đơn cho nhà vườn.
   * Điều kiện: DRAFT + MỌI cây có ≥ 1 ảnh (1 query GROUP BY, không N+1).
   * 1 transaction: DRAFT → PENDING_PROVIDER + tạo negotiation chờ provider trả lời.
   */
  async submitOrder(accountId: string, orderId: string) {
    const order = await this.getOwnedOrderAsCustomer(accountId, orderId);
    assertTransition(order.status, 'PENDING_PROVIDER');

    const plants = await this.plantRepo.find({
      where: { serviceOrderId: order.id },
    });
    const counts = await this.photoRepo
      .createQueryBuilder('photo')
      .select('photo.plant_id', 'plantId')
      .addSelect('COUNT(*)', 'count')
      .where('photo.plant_id IN (:...plantIds)', {
        plantIds: plants.map((plant) => plant.id),
      })
      .groupBy('photo.plant_id')
      .getRawMany<{ plantId: string; count: string }>();
    const photographed = new Set(counts.map((row) => row.plantId));
    const missing = plants.filter((plant) => !photographed.has(plant.id));
    if (missing.length > 0) {
      throw new BadRequestException({
        message: 'MISSING_INITIAL_PHOTO',
        plants: missing.map((plant) => ({ id: plant.id, name: plant.name })),
      });
    }

    // D5: khoá dòng đơn + kiểm lại trạng thái trong transaction — bấm "gửi đơn"
    // 2 lần cùng lúc chỉ 1 request đi tiếp (không lật trạng thái, không 500 vì unique).
    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(ServiceOrder, {
        where: { id: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== 'DRAFT') {
        throw new ConflictException('INVALID_STATE_TRANSITION');
      }
      locked.status = 'PENDING_PROVIDER';
      const saved = await manager.save(locked);
      await manager.save(
        manager.create(Negotiation, {
          serviceOrderId: order.id,
          providerResponse: null,
        }),
      );
      return saved;
    });
  }

  /**
   * GET /orders — danh sách đơn PHÍA MÌNH (khách: đơn mình đặt; vườn: đơn gửi tới mình).
   * Không nhận id từ client — phía lọc suy từ JWT (role + accountId), chống IDOR tận gốc.
   */
  async listOrders(accountId: string, role: string, query: QueryOrderDto) {
    const where: Record<string, unknown> = {};
    if (role === 'CUSTOMER') {
      const customer = await this.customerRepo.findOne({
        where: { accountId },
      });
      if (!customer) {
        throw new NotFoundException('CUSTOMER_PROFILE_NOT_FOUND');
      }
      where.customerId = customer.id;
    } else {
      const provider = await this.providerRepo.findOne({
        where: { accountId },
      });
      if (!provider) {
        throw new NotFoundException('PROVIDER_PROFILE_NOT_FOUND');
      }
      where.providerId = provider.id;
      // Vườn không thấy đơn nháp — DRAFT là không gian riêng của khách.
      if (query.status === 'DRAFT') {
        return { data: [], total: 0, page: query.page, limit: query.limit };
      }
    }
    if (query.status) {
      where.status = query.status;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const [data, total] = await this.orderRepo.findAndCount({
      where:
        role === 'PROVIDER' && !query.status
          ? // Loại DRAFT khỏi list của vườn bằng danh sách trạng thái thấy được.
            ORDER_VISIBLE_TO_PROVIDER.map((status) => ({ ...where, status }))
          : where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      relations: {
        servicePackage: true,
        customer: { account: true },
      },
    });
    return {
      data: data.map((order) => ({
        ...order,
        servicePackageName: order.servicePackage?.name ?? null,
        customerName: order.customer?.account?.fullName ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * GET /orders/:id — chi tiết đơn kèm cây + ảnh + negotiation.
   * Chỉ 2 bên trong đơn xem được; người ngoài → 404 (không lộ đơn tồn tại).
   */
  async getOrderDetail(accountId: string, role: string, orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: { plants: true },
    });
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }

    if (role === 'CUSTOMER') {
      const customer = await this.customerRepo.findOne({
        where: { accountId },
      });
      if (!customer || order.customerId !== customer.id) {
        throw new NotFoundException('ORDER_NOT_FOUND');
      }
    } else {
      const provider = await this.providerRepo.findOne({
        where: { accountId },
      });
      if (
        !provider ||
        order.providerId !== provider.id ||
        order.status === 'DRAFT' // đơn nháp là không gian riêng của khách
      ) {
        throw new NotFoundException('ORDER_NOT_FOUND');
      }
    }

    const plantIds = order.plants.map((plant) => plant.id);
    const [photos, negotiation, agreement, handover, customer, provider] = await Promise.all([
      plantIds.length > 0
        ? this.photoRepo
            .createQueryBuilder('photo')
            .where('photo.plant_id IN (:...plantIds)', { plantIds })
            .orderBy('photo.created_at', 'ASC')
            .getMany()
        : Promise.resolve([]),
      this.dataSource
        .getRepository(Negotiation)
        .findOne({ where: { serviceOrderId: order.id } }),
      this.dataSource
        .getRepository(ServiceAgreement)
        .findOne({ where: { serviceOrderId: order.id } }),
      this.dataSource
        .getRepository(Handover)
        .findOne({ where: { serviceOrderId: order.id } }),
      this.customerRepo.findOne({
        where: { id: order.customerId },
        relations: { account: true },
      }),
      this.providerRepo.findOne({
        where: { id: order.providerId },
        relations: { account: true },
      }),
    ]);
    const signatures = agreement
      ? await this.agreementSignatureRepo.find({
          where: { agreementId: agreement.id, signPhase: 'ONLINE' },
          order: { signedAt: 'ASC' },
        })
      : [];

    return {
      ...order,
      plants: order.plants.map((plant) => ({
        ...plant,
        initialPhotos: photos.filter((photo) => photo.plantId === plant.id),
      })),
      negotiation,
      agreement: agreement
        ? {
            id: agreement.id,
            agreementNo: agreement.agreementNo,
            status: agreement.status,
            termsSnapshot: {
              ...agreement.termsSnapshot,
              parties:
                agreement.termsSnapshot.parties ??
                this.buildPartySnapshot(customer, provider),
              clauses:
                agreement.termsSnapshot.clauses ?? this.contractClauses(),
            },
            signatures: signatures.map((signature) => ({
              id: signature.id,
              signerRole: signature.signerRole,
              signedAt: signature.signedAt,
            })),
          }
        : null,
      handover: handover
        ? {
            status: handover.status,
            customerConfirmDueAt: handover.customerConfirmDueAt,
          }
        : null,
    };
  }

  /**
   * POST /orders/:id/negotiation/respond — vườn quyết ACCEPT/REJECT.
   * ACCEPT (1 transaction): negotiation + tạo hợp đồng PENDING (termsSnapshot
   * chụp điều khoản tại thời điểm này) + đơn → AGREEMENT_PENDING.
   * REJECT (1 transaction): negotiation + đơn → REJECTED (terminal — muốn tiếp
   * tục thì khách tạo đơn mới).
   */
  async respondNegotiation(
    accountId: string,
    orderId: string,
    dto: RespondNegotiationDto,
  ) {
    const provider = await this.providerRepo.findOne({
      where: { accountId },
      relations: { account: true },
    });
    if (!provider) {
      throw new NotFoundException('PROFILE_NOT_FOUND');
    }
    if (provider.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException('PROFILE_NOT_APPROVED');
    }
    const order = await this.orderRepo.findOne({
      where: { id: orderId, providerId: provider.id },
      relations: { plants: true },
    });
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    const customer = await this.customerRepo.findOne({
      where: { id: order.customerId },
      relations: { account: true },
    });
    if (!customer) throw new InternalServerErrorException('CUSTOMER_PROFILE_NOT_FOUND');

    // D5: khoá dòng + kiểm lại trạng thái trong transaction — vườn bấm 2 lần
    // (hoặc ACCEPT+REJECT chồng nhau) chỉ 1 request thắng, không lật trạng thái terminal.
    const target = dto.response === 'REJECT' ? 'REJECTED' : 'AGREEMENT_PENDING';
    assertTransition(order.status, target);

    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(ServiceOrder, {
        where: { id: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status !== 'PENDING_PROVIDER') {
        throw new ConflictException('INVALID_STATE_TRANSITION');
      }

      if (dto.response === 'REJECT') {
        await manager.update(
          Negotiation,
          { serviceOrderId: order.id },
          { providerResponse: 'REJECT' },
        );
        locked.status = 'REJECTED';
        await manager.save(locked);
        return { status: locked.status };
      }

      if (dto.proposedTotal !== undefined) {
        if (BigInt(dto.proposedTotal) <= 0n) {
          throw new BadRequestException('PROPOSED_TOTAL_INVALID');
        }
        // Giá chốt từ video call trở thành giá dịch vụ snapshot dùng cho agreement/payment.
        locked.provisionalTotal = dto.proposedTotal;
      }

      // Lock only the order row. Loading a one-to-many relation together with
      // FOR UPDATE makes TypeORM emit a LEFT JOIN that PostgreSQL rejects.
      const plants = await manager.find(Plant, {
        where: { serviceOrderId: locked.id },
        order: { createdAt: 'ASC' },
      });
      if (plants.length !== locked.plantCount) {
        throw new InternalServerErrorException('ORDER_PLANTS_INCONSISTENT');
      }
      locked.plants = plants;

      await manager.update(
        Negotiation,
        { serviceOrderId: order.id },
        {
          providerResponse: 'ACCEPT',
          proposedTotal: dto.proposedTotal ?? null,
          pickupLocation: dto.pickupLocation ?? null,
          providerNote: dto.providerNote ?? null,
        },
      );
      // Hợp đồng phải tồn tại TRƯỚC chữ ký đầu tiên (FK của agreement_signatures).
      const agreement = await manager.save(
        manager.create(ServiceAgreement, {
          serviceOrderId: order.id,
          agreementNo: generateAgreementNo(),
          termsSnapshot: this.buildTermsSnapshot(
            locked,
            dto,
            this.buildPartySnapshot(customer, provider),
          ),
          status: 'PENDING',
        }),
      );
      locked.status = 'AGREEMENT_PENDING';
      await manager.save(locked);
      return { status: locked.status, agreementId: agreement.id };
    });
  }

  /**
   * POST /orders/:id/agreement/sign — 1 endpoint cho cả 2 vai, signerRole lấy
   * từ JWT (không ký hộ được). Idempotent nhờ UNIQUE(agreement, role, phase).
   * Chữ ký thứ 2 (1 transaction): hợp đồng SIGNED + sinh payment components
   * (PACKAGE_PRICE + PICKUP_FEE nếu > 0) + khóa giá tạm + đơn → AWAITING_PAYMENT.
   */
  async signAgreement(
    accountId: string,
    role: string,
    orderId: string,
    ip: string | undefined,
  ) {
    const order = await this.getOrderAsParty(accountId, role, orderId);
    if (order.status !== 'AGREEMENT_PENDING') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    const signerRole = role as 'CUSTOMER' | 'PROVIDER';

    // Toàn bộ trong 1 transaction + khóa dòng hợp đồng: 2 bên bấm ký cùng lúc
    // vẫn tuần tự hóa — không thể cùng thấy "0 chữ ký" rồi kẹt không ai chốt.
    return this.dataSource.transaction(async (manager) => {
      const agreement = await manager.findOne(ServiceAgreement, {
        where: { serviceOrderId: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!agreement) {
        throw new InternalServerErrorException('AGREEMENT_NOT_FOUND');
      }

      const existing = await manager.find(AgreementSignature, {
        where: { agreementId: agreement.id, signPhase: 'ONLINE' },
      });
      const signedRoles = existing.map((sig) => sig.signerRole);
      if (signedRoles.includes(signerRole)) {
        return {
          alreadySigned: true,
          signed: signedRoles,
          waitingFor: this.waitingFor(signedRoles),
        };
      }

      const signedAt = new Date();
      await manager.save(
        manager.create(AgreementSignature, {
          agreementId: agreement.id,
          signerId: accountId,
          signerRole,
          signPhase: 'ONLINE' as const,
          signedAt,
          signatureHash: createHash('sha256')
            .update(
              `${agreement.id}|${accountId}|ONLINE|${signedAt.toISOString()}`,
            )
            .digest('hex'),
          ipAddress: ip ?? null,
        }),
      );

      const allSigned = [...signedRoles, signerRole];
      if (allSigned.length < 2) {
        return { signed: allSigned, waitingFor: this.waitingFor(allSigned) };
      }

      // Đủ 2 chữ ký — chốt: hợp đồng SIGNED, sinh khoản phải trả, khóa giá tạm.
      assertTransition(order.status, 'AWAITING_PAYMENT');
      agreement.status = 'SIGNED';
      await manager.save(agreement);

      const components = [
        manager.create(PaymentComponent, {
          serviceOrderId: order.id,
          componentType: 'PACKAGE_PRICE' as const,
          amount: order.provisionalTotal,
          status: 'PENDING' as const,
        }),
      ];
      // Phí ship = 0 thì không tạo dòng component thừa.
      if (BigInt(order.pickupFeeSnapshot) > 0n) {
        components.push(
          manager.create(PaymentComponent, {
            serviceOrderId: order.id,
            componentType: 'PICKUP_FEE' as const,
            amount: order.pickupFeeSnapshot,
            status: 'PENDING' as const,
          }),
        );
      }
      await manager.save(components);

      order.provisionalLockedAt = new Date();
      order.status = 'AWAITING_PAYMENT';
      await manager.save(order);

      const amountDue = (
        BigInt(order.provisionalTotal) + BigInt(order.pickupFeeSnapshot)
      ).toString();
      return { status: order.status, amountDue };
    });
  }

  // ---- helpers ----

  // Điều khoản đóng băng tại thời điểm provider ACCEPT — nội dung 2 bên sẽ ký.
  private buildTermsSnapshot(
    order: ServiceOrder,
    negotiation?: RespondNegotiationDto,
    parties?: Record<string, unknown>,
  ) {
    return {
      orderCode: order.orderCode,
      basePriceSnapshot: order.basePriceSnapshot,
      plantCount: order.plantCount,
      provisionalTotal: order.provisionalTotal,
      pickupFeeSnapshot: order.pickupFeeSnapshot,
      durationDaysSnapshot: order.durationDaysSnapshot,
      reportFrequencySnapshot: order.reportFrequencySnapshot,
      scheduledPickupAt: order.scheduledPickupAt.toISOString(),
      plants: order.plants.map((plant) => ({
        name: plant.name,
        speciesName: plant.speciesName,
        isValueDeclared: plant.isValueDeclared,
        declaredValue: plant.declaredValue,
      })),
      negotiated: negotiation
        ? {
            proposedTotal: negotiation.proposedTotal ?? null,
            pickupLocation: negotiation.pickupLocation ?? null,
            providerNote: negotiation.providerNote ?? null,
          }
        : null,
      parties,
      clauses: this.contractClauses(),
    };
  }

  private buildPartySnapshot(
    customer: CustomerProfile | null,
    provider: ProviderProfile | null,
  ) {
    return {
      customer: {
        fullName: customer?.account?.fullName ?? 'Chưa cung cấp',
        address:
          customer?.address ?? customer?.defaultPickupAddress ?? 'Chưa cung cấp',
        identityNumber: 'Chưa cung cấp',
        identityDocuments: [],
      },
      provider: {
        fullName: provider?.account?.fullName ?? provider?.displayName ?? 'Chưa cung cấp',
        address: provider?.address ?? 'Chưa cung cấp',
        identityNumber: 'Chưa cung cấp',
        identityDocuments: [provider?.cccdFrontUrl, provider?.cccdBackUrl].filter(
          (url): url is string => Boolean(url),
        ),
      },
    };
  }

  private contractClauses() {
    return [
      'Nhà vườn thực hiện chăm sóc theo thông tin đơn và tình trạng cây được hai bên xác nhận tại thời điểm ký.',
      'Khách cam kết cây, chủng loại, số lượng, giá trị khai báo, ảnh ban đầu và tình trạng thực tế khi bàn giao là trung thực.',
      'Nếu cây hoặc tình trạng thực tế khác đáng kể với ảnh ban đầu, thông tin mô tả hoặc nội dung đã cung cấp cho Nhà vườn, Nhà vườn có quyền từ chối nhận cây và hủy đơn.',
      'Khi Nhà vườn từ chối nhận vì thông tin hoặc tình trạng cây không đúng như đã cung cấp, phí dịch vụ đã thanh toán sẽ được hoàn lại cho Khách; phí vận chuyển/lấy cây theo đơn do Khách chịu.',
      'Mọi thay đổi về giá, địa điểm nhận cây hoặc ghi chú chỉ có hiệu lực khi được ghi nhận trong đơn và snapshot hợp đồng trước khi hai bên ký.',
      'Hai bên ưu tiên trao đổi và cung cấp bằng chứng qua hệ thống; tranh chấp được xử lý theo quy trình tranh chấp của LanCare.',
    ];
  }

  private waitingFor(signedRoles: string[]) {
    return (['CUSTOMER', 'PROVIDER'] as const).filter(
      (partyRole) => !signedRoles.includes(partyRole),
    );
  }

  // Load đơn với tư cách 1 TRONG 2 BÊN của đơn (theo role JWT) — người ngoài → 404.
  private async getOrderAsParty(
    accountId: string,
    role: string,
    orderId: string,
  ) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    if (role === 'CUSTOMER') {
      const customer = await this.customerRepo.findOne({
        where: { accountId },
      });
      if (!customer || order.customerId !== customer.id) {
        throw new NotFoundException('ORDER_NOT_FOUND');
      }
    } else {
      const provider = await this.providerRepo.findOne({
        where: { accountId },
      });
      if (!provider || order.providerId !== provider.id) {
        throw new NotFoundException('ORDER_NOT_FOUND');
      }
    }
    return order;
  }

  // declaredValue phải > 0, ≥ min (nếu gói có), ≤ max (nếu gói có) — so bằng BigInt.
  private assertDeclaredValueInRange(
    plant: CreateOrderPlantDto,
    pkg: ServicePackage,
  ) {
    // D3: khai giá (isValueDeclared=true) thì BẮT BUỘC có declaredValue —
    // chặn mở khoá ADJUST khống + trần đền bù null ở bàn giao.
    if (plant.isValueDeclared === true && plant.declaredValue === undefined) {
      throw new BadRequestException('DECLARED_VALUE_REQUIRED');
    }
    if (plant.declaredValue === undefined) {
      return;
    }
    const value = BigInt(plant.declaredValue);
    const min = pkg.minDeclaredValue ? BigInt(pkg.minDeclaredValue) : null;
    const max = pkg.maxDeclaredValue ? BigInt(pkg.maxDeclaredValue) : null;
    // D11: min là cận BAO HÀM (value < min mới loại) — đối xứng với max, khớp UI "từ ...đ".
    if (
      value <= 0n ||
      (min !== null && value < min) ||
      (max !== null && value > max)
    ) {
      throw new BadRequestException('DECLARED_VALUE_OUT_OF_RANGE');
    }
  }

  // Load đơn với tư cách CHỦ đơn (customer) — sai chủ/không có → 404, chống IDOR.
  private async getOwnedOrderAsCustomer(accountId: string, orderId: string) {
    const customer = await this.customerRepo.findOne({ where: { accountId } });
    if (!customer) {
      throw new NotFoundException('CUSTOMER_PROFILE_NOT_FOUND');
    }
    const order = await this.orderRepo.findOne({
      where: { id: orderId, customerId: customer.id },
    });
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    return order;
  }
}

// Vườn chỉ thấy đơn từ PENDING_PROVIDER trở đi (DRAFT là của riêng khách).
const ORDER_VISIBLE_TO_PROVIDER = [
  'PENDING_PROVIDER',
  'AGREEMENT_PENDING',
  'AWAITING_PAYMENT',
  'PAID',
  'HANDOVER_IN_PROGRESS',
  'HANDOVER_AWAITING_CONFIRM',
  'IN_CARE',
  'REJECTED',
  'CANCELLED',
] as const;
