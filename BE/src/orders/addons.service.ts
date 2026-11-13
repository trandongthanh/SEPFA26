import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { Role } from '../common/constants/roles';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { customerFeeFor } from '../payments/settlement';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { expireAddon, expireOverdueAddons } from './addon-expiry';
import {
  ADDON_MAX_OPEN_PER_ORDER,
  ADDON_MAX_PRICE,
  ADDON_MIN_PRICE,
  ADDON_OPEN_STATUSES,
  assertAddonTransition,
  generateAddonCode,
  overdueReason,
  paymentDueAt,
  respondDueAt,
} from './addon-rules';
import { CompleteAddonDto } from './dto/complete-addon.dto';
import { CreateAddonDto } from './dto/create-addon.dto';
import { RespondAddonDto } from './dto/respond-addon.dto';
import { AddonProposal } from './entities/addon-proposal.entity';
import { Plant } from './entities/plant.entity';
import { ServiceOrder } from './entities/service-order.entity';
import { OrderStateService } from './order-state.service';

const PG_UNIQUE_VIOLATION = '23505';
const ADDON_CODE_ATTEMPTS = 3;

/**
 * Add-on — việc phát sinh ngoài gói trong lúc đang chăm (đơn IN_CARE).
 * Vườn đề xuất → khách đồng ý / từ chối trong 48 giờ → khách trả tiền trong 24 giờ (QR + webhook nằm ở
 * payments.service.ts) → vườn báo đã làm xong. Tiền add-on chia cùng đơn khi COMPLETED (settle-order.ts).
 * Đơn mẫu: add-on "Thay giá thể" 100.000 → khách chuyển 106.000 → vườn nhận thêm 88.000 khi đơn xong.
 */
@Injectable()
export class AddonsService {
  constructor(
    @InjectRepository(AddonProposal)
    private readonly addonRepo: Repository<AddonProposal>,
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

  /** POST /orders/:orderId/addons — vườn đề xuất add-on cho đơn đang chăm. */
  async create(accountId: string, orderId: string, dto: CreateAddonDto) {
    const order = await this.getOrderAsProvider(accountId, orderId);
    if (order.status !== 'IN_CARE') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    const price = BigInt(dto.price);
    if (price < ADDON_MIN_PRICE || price > ADDON_MAX_PRICE) {
      throw new BadRequestException('ADDON_PRICE_OUT_OF_RANGE');
    }
    if (dto.plantId) {
      // Chỉ nhận cây vườn đang giữ: cây bị từ chối lúc nhận đã ở lại nhà khách.
      const plant = await this.plantRepo.findOne({
        where: { id: dto.plantId, serviceOrderId: order.id },
      });
      if (!plant || plant.handoverDecision === 'REJECT') {
        throw new BadRequestException('PLANT_NOT_IN_ORDER');
      }
    }

    // Mã add-on sinh ngẫu nhiên, UNIQUE ở DB — trùng (cực hiếm) thì làm lại cả transaction với mã mới.
    for (let attempt = 1; ; attempt += 1) {
      try {
        const saved = await this.dataSource.transaction((manager) =>
          this.insertProposal(manager, order.id, accountId, price, dto),
        );
        return (await this.toViews([saved]))[0];
      } catch (err) {
        const isDuplicateCode =
          (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
        if (!isDuplicateCode || attempt >= ADDON_CODE_ATTEMPTS) {
          throw err;
        }
      }
    }
  }

  private async insertProposal(
    manager: EntityManager,
    orderId: string,
    accountId: string,
    price: bigint,
    dto: CreateAddonDto,
  ) {
    // Khoá dòng đơn: 2 request tạo cùng lúc không vượt được giới hạn số đề xuất đang mở,
    // và không tạo lọt khi vườn vừa bấm trả cây.
    const locked = await this.orderState.lock(manager, orderId);
    if (!locked || locked.status !== 'IN_CARE') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    const now = new Date();
    await expireOverdueAddons(manager, orderId, now);
    const openCount = await manager.count(AddonProposal, {
      where: { serviceOrderId: orderId, status: In([...ADDON_OPEN_STATUSES]) },
    });
    if (openCount >= ADDON_MAX_OPEN_PER_ORDER) {
      throw new ConflictException('ADDON_LIMIT_REACHED');
    }
    return manager.save(
      manager.create(AddonProposal, {
        serviceOrderId: orderId,
        plantId: dto.plantId ?? null,
        addonCode: generateAddonCode(),
        title: dto.title,
        reason: dto.reason,
        price: price.toString(),
        photoUrls: dto.photoUrls,
        status: 'PENDING' as const,
        respondDueAt: respondDueAt(now),
        createdByAccountId: accountId,
      }),
    );
  }

  /** GET /orders/:orderId/addons — khách, vườn của đơn (hoặc admin) xem mọi đề xuất, mới nhất trước. */
  async list(accountId: string, role: Role, orderId: string) {
    const order = await this.getOrderForRole(accountId, role, orderId);
    await expireOverdueAddons(this.dataSource.manager, order.id, new Date());
    const proposals = await this.addonRepo.find({
      where: { serviceOrderId: order.id },
      order: { createdAt: 'DESC' },
    });
    return this.toViews(proposals);
  }

  /**
   * POST /orders/:orderId/addons/:addonId/respond — khách đồng ý hoặc từ chối.
   * Đồng ý: chốt phí dịch vụ 6% và mở hạn trả tiền 24 giờ. Im lặng quá 48 giờ = hết hạn,
   * không ai được đồng ý thay khách vì là tiền của khách.
   */
  async respond(
    accountId: string,
    orderId: string,
    addonId: string,
    dto: RespondAddonDto,
  ) {
    const order = await this.getOrderAsCustomer(accountId, orderId);
    const saved = await this.withLockedAddon(
      order.id,
      addonId,
      (manager, proposal, now) => {
        if (dto.decision === 'ACCEPT') {
          assertAddonTransition(proposal.status, 'ACCEPTED');
          proposal.status = 'ACCEPTED';
          proposal.customerFee = customerFeeFor(
            BigInt(proposal.price),
          ).toString();
          proposal.paymentDueAt = paymentDueAt(now);
        } else {
          assertAddonTransition(proposal.status, 'REJECTED');
          proposal.status = 'REJECTED';
        }
        proposal.decidedAt = now;
        proposal.customerNote = dto.note ?? null;
        return manager.save(proposal);
      },
    );
    return (await this.toViews([saved]))[0];
  }

  /** POST /orders/:orderId/addons/:addonId/complete — vườn báo đã làm xong add-on khách đã trả tiền. */
  async complete(
    accountId: string,
    orderId: string,
    addonId: string,
    dto: CompleteAddonDto,
  ) {
    const order = await this.getOrderAsProvider(accountId, orderId);
    const saved = await this.withLockedAddon(
      order.id,
      addonId,
      (manager, proposal, now) => {
        assertAddonTransition(proposal.status, 'DONE');
        proposal.status = 'DONE';
        proposal.doneAt = now;
        proposal.donePhotoUrls = dto.photoUrls;
        proposal.doneNote = dto.note ?? null;
        return manager.save(proposal);
      },
    );
    return (await this.toViews([saved]))[0];
  }

  // ---- helpers ----

  /**
   * Khoá dòng đề xuất rồi chạy `change`. Đề xuất vừa quá hạn thì ghi EXPIRED và COMMIT trước,
   * sau đó mới báo 409 ADDON_EXPIRED (ném lỗi trong transaction sẽ làm mất luôn dòng EXPIRED).
   */
  private async withLockedAddon(
    orderId: string,
    addonId: string,
    change: (
      manager: EntityManager,
      proposal: AddonProposal,
      now: Date,
    ) => Promise<AddonProposal>,
  ): Promise<AddonProposal> {
    const result = await this.dataSource.transaction(async (manager) => {
      const proposal = await manager.findOne(AddonProposal, {
        where: { id: addonId, serviceOrderId: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!proposal) {
        throw new NotFoundException('ADDON_NOT_FOUND');
      }
      const now = new Date();
      const reason = overdueReason(proposal, now);
      if (reason) {
        await expireAddon(manager, proposal, reason, now);
        return null;
      }
      if (proposal.status === 'EXPIRED') {
        return null;
      }
      return change(manager, proposal, now);
    });
    if (!result) {
      throw new ConflictException('ADDON_EXPIRED');
    }
    return result;
  }

  private async getOrderForRole(
    accountId: string,
    role: Role,
    orderId: string,
  ) {
    if (role === 'CUSTOMER') {
      return this.getOrderAsCustomer(accountId, orderId);
    }
    if (role === 'PROVIDER') {
      return this.getOrderAsProvider(accountId, orderId, false);
    }
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    return order;
  }

  // Cùng luật với handover.service.ts: vườn bị tước APPROVED không được thao tác tiếp trên đơn (chỉ còn xem).
  private async getOrderAsProvider(
    accountId: string,
    orderId: string,
    requireApproved = true,
  ) {
    const provider = await this.providerRepo.findOne({ where: { accountId } });
    if (!provider) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    if (requireApproved && provider.verificationStatus !== 'APPROVED') {
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

  // Trả đúng các field màn hình cần; tiền là chuỗi đồng. Không spread entity.
  private async toViews(proposals: AddonProposal[]) {
    const plantIds = [
      ...new Set(
        proposals
          .map((proposal) => proposal.plantId)
          .filter((id): id is string => !!id),
      ),
    ];
    const plants = plantIds.length
      ? await this.plantRepo.find({ where: { id: In(plantIds) } })
      : [];
    const plantName = new Map(plants.map((plant) => [plant.id, plant.name]));

    return proposals.map((proposal) => {
      const price = BigInt(proposal.price);
      // Trước khi khách đồng ý, phí chưa chốt vào DB → hiện sẵn 6% để khách thấy đúng số sẽ phải chuyển.
      const customerFee =
        BigInt(proposal.customerFee) > 0n
          ? BigInt(proposal.customerFee)
          : customerFeeFor(price);
      return {
        id: proposal.id,
        orderId: proposal.serviceOrderId,
        addonCode: proposal.addonCode,
        title: proposal.title,
        reason: proposal.reason,
        photoUrls: proposal.photoUrls,
        plant: proposal.plantId
          ? {
              id: proposal.plantId,
              name: plantName.get(proposal.plantId) ?? null,
            }
          : null,
        price: price.toString(),
        customerFee: customerFee.toString(),
        amountDue: (price + customerFee).toString(),
        status: proposal.status,
        respondDueAt: proposal.respondDueAt,
        decidedAt: proposal.decidedAt,
        customerNote: proposal.customerNote,
        paymentDueAt: proposal.paymentDueAt,
        paidAt: proposal.paidAt,
        doneAt: proposal.doneAt,
        donePhotoUrls: proposal.donePhotoUrls,
        doneNote: proposal.doneNote,
        expiredReason: proposal.expiredReason,
        expiredAt: proposal.expiredAt,
        createdAt: proposal.createdAt,
      };
    });
  }
}
