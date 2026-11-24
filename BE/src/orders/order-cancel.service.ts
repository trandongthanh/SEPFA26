import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import {
  type CancelRefundMode,
  computeCancelRefund,
  refundCancelledOrder,
} from '../payments/cancel-order-refund';
import { PaymentComponent } from '../payments/entities/payment-component.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import {
  CANCEL_LABELS,
  type CancelCode,
  type CancelledBy,
  type CancelRefund,
  decideCancel,
  isDeclineOpen,
} from './cancel-rules';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { Handover } from './entities/handover.entity';
import { ServiceAgreement } from './entities/service-agreement.entity';
import { ServiceOrder } from './entities/service-order.entity';
import { OrderStateService } from './order-state.service';

export interface CloseOrderOptions {
  by: CancelledBy;
  code: CancelCode;
  // Chữ tự do người huỷ nhập; hệ thống tự huỷ thì là câu cố định.
  reason: string;
  refund: CancelRefund;
  countsAgainstProvider: boolean;
  now: Date;
}

/**
 * Huỷ đơn TRƯỚC khi vào kỳ chăm (mọi đường trừ hai nhánh có sẵn ở handover.service.ts: khách không giao cây,
 * vườn không nộp tiền bảo đảm). Luật nằm ở cancel-rules.ts (toán thuần); file này chỉ khoá dòng, ghi DB và
 * gọi hoàn tiền — tất cả trong MỘT transaction với lần đổi trạng thái (nguyên tắc T4).
 */
@Injectable()
export class OrderCancelService {
  constructor(
    @InjectRepository(ServiceOrder)
    private readonly orderRepo: Repository<ServiceOrder>,
    @InjectRepository(CustomerProfile)
    private readonly customerRepo: Repository<CustomerProfile>,
    @InjectRepository(ProviderProfile)
    private readonly providerRepo: Repository<ProviderProfile>,
    private readonly dataSource: DataSource,
    private readonly orderState: OrderStateService,
  ) {}

  /**
   * POST /orders/:id/cancel — khách hoặc vườn huỷ đơn khi vườn CHƯA mở phiên nhận cây.
   * Client chỉ gửi lý do; mã lý do và tiền hoàn do server quyết theo vai, trạng thái SAU khi khoá và giờ hẹn:
   *   khách, đơn chưa thanh toán        → rút đơn, không có tiền;
   *   khách, đơn đã thanh toán          → trước giờ hẹn 3 giờ: 100% · 3 giờ cuối tới hết ân hạn 30 phút:
   *                                       vườn giữ phí lấy cây · sau ân hạn (vườn không tới): 100%, vườn +1 lần huỷ;
   *   vườn, đơn đã nhận (chờ ký / chờ trả / đã thanh toán) → khách nhận lại 100% nếu đã trả, vườn +1 lần huỷ.
   * Đơn mẫu 484.000: 100% = 484.000; vườn giữ phí lấy cây = khách 424.000, vườn 60.000 (chờ 3 ngày).
   * Vườn vừa mở phiên cùng lúc → hai bên xếp hàng trên khoá dòng đơn, bên sau nhận 409.
   */
  async cancel(
    accountId: string,
    role: string,
    orderId: string,
    dto: CancelOrderDto,
  ) {
    const actor: 'CUSTOMER' | 'PROVIDER' =
      role === 'CUSTOMER' ? 'CUSTOMER' : 'PROVIDER';
    const order =
      actor === 'CUSTOMER'
        ? await this.getOrderAsCustomer(accountId, orderId)
        : await this.getOrderAsProvider(accountId, orderId);

    return this.dataSource.transaction(async (manager) => {
      const locked = await this.orderState.lock(manager, order.id);
      if (!locked) {
        throw new ConflictException('INVALID_STATE_TRANSITION');
      }
      const now = new Date();
      const decision = decideCancel({
        role: actor,
        status: locked.status,
        now,
        pickupAt: locked.scheduledPickupAt,
      });
      const { customerRefund, declaredReturn } = await this.closeOrder(
        manager,
        locked,
        { by: actor, reason: dto.reason, now, ...decision },
      );
      // Route chung: KHÁCH thấy số mình nhận lại; vườn không thấy số tiền của khách.
      return actor === 'CUSTOMER'
        ? {
            status: locked.status,
            cancelCode: decision.code,
            refundAmount: customerRefund.toString(),
            declaredDepositReturned: declaredReturn.toString(),
          }
        : { status: locked.status, cancelCode: decision.code };
    });
  }

  /**
   * Lõi đóng đơn — gọi BÊN TRONG transaction, với dòng đơn ĐÃ khoá và nơi gọi đã kiểm trạng thái + hạn.
   * Dùng chung cho route huỷ, vườn huỷ tại cửa và bộ quét hạn. Làm đủ một lượt:
   *   đơn → CANCELLED + ai bấm / mã lý do / lý do / giờ huỷ; hợp đồng → CANCELLED; dòng hoá đơn còn chờ trả →
   *   CANCELLED; phiên nhận cây đang mở (chưa tới bước nộp tiền bảo đảm) → CANCELLED; chia tiền nếu đơn đã có tiền;
   *   cộng một lần huỷ cho vườn nếu là "nhận đơn rồi bỏ".
   * Bảng chuyển trạng thái cấm → 409 (OrderStateService.apply), nơi gọi rollback.
   */
  async closeOrder(
    manager: EntityManager,
    locked: ServiceOrder,
    options: CloseOrderOptions,
  ): Promise<{ customerRefund: bigint; declaredReturn: bigint }> {
    locked.cancelledBy = options.by;
    locked.cancelCode = options.code;
    locked.cancelReason = options.reason;
    locked.cancelledAt = options.now;
    await this.orderState.apply(manager, locked, 'CANCELLED');

    await manager.update(
      ServiceAgreement,
      { serviceOrderId: locked.id },
      { status: 'CANCELLED' },
    );
    await manager.update(
      PaymentComponent,
      { serviceOrderId: locked.id, status: 'PENDING' },
      { status: 'CANCELLED' },
    );
    await manager.update(
      Handover,
      {
        serviceOrderId: locked.id,
        handoverType: 'IN',
        status: In(['IN_PROGRESS', 'AWAITING_CUSTOMER']),
      },
      { status: 'CANCELLED', note: options.reason },
    );

    let result = { customerRefund: 0n, declaredReturn: 0n };
    if (options.refund !== 'NONE') {
      result = await refundCancelledOrder(
        manager,
        locked,
        options.now,
        options.refund,
        CANCEL_LABELS[options.code],
      );
    }
    if (options.countsAgainstProvider) {
      await this.countProviderCancel(manager, locked.providerId);
    }
    return result;
  }

  /** Cộng một lần "nhận đơn rồi bỏ" cho vườn (UPDATE ... SET count = count + 1, không đọc-rồi-ghi). */
  async countProviderCancel(
    manager: EntityManager,
    providerId: string,
  ): Promise<void> {
    await manager.increment(
      ProviderProfile,
      { id: providerId },
      'cancelledOrderCount',
      1,
    );
  }

  /**
   * "Huỷ bây giờ thì nhận lại bao nhiêu" cho màn chi tiết đơn của KHÁCH — chỉ khi đơn đã thanh toán và vườn
   * chưa mở phiên. Dùng đúng luật + đúng hàm tính của lúc huỷ thật nên hai số luôn khớp.
   * Sổ lệch (không tính được) → null, không làm hỏng cả màn chi tiết.
   */
  async previewCancel(order: ServiceOrder, now: Date) {
    if (order.status !== 'PAID') {
      return null;
    }
    const decision = decideCancel({
      role: 'CUSTOMER',
      status: order.status,
      now,
      pickupAt: order.scheduledPickupAt,
    });
    try {
      const amounts = await computeCancelRefund(
        this.dataSource.manager,
        order,
        decision.refund as CancelRefundMode,
      );
      return {
        cancelCode: decision.code,
        refundAmount: amounts.customerRefund.toString(),
        declaredDepositReturned: amounts.declaredReturn.toString(),
        // Phần vườn giữ (phí lấy cây) nếu huỷ lúc này; huỷ miễn phí → "0".
        pickupFeeKept: amounts.providerReceives.toString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * "Không giao cây thì nhận lại bao nhiêu" cho màn chi tiết đơn của KHÁCH ở bước xem biên bản nhận cây.
   * Chỉ có số khi khách bấm thật sẽ thành công (isDeclineOpen); dùng đúng cách chia của route
   * POST /orders/:id/handover/decline (vườn giữ phí lấy cây) nên hai số luôn khớp.
   * Đơn mẫu: { refundAmount 424.000, declaredDepositReturned 300.000, pickupFeeKept 60.000 }.
   * `handover` = phiên NHẬN cây mới nhất (chi tiết đơn đã đọc sẵn). Sổ lệch → null.
   */
  async previewDecline(
    order: ServiceOrder,
    handover: Handover | null,
    now: Date,
  ) {
    if (
      !isDeclineOpen({
        orderStatus: order.status,
        handoverStatus: handover?.status,
        customerConfirmDueAt: handover?.customerConfirmDueAt,
        now,
      })
    ) {
      return null;
    }
    try {
      const amounts = await computeCancelRefund(
        this.dataSource.manager,
        order,
        'KEEP_PICKUP_FEE',
      );
      return {
        refundAmount: amounts.customerRefund.toString(),
        declaredDepositReturned: amounts.declaredReturn.toString(),
        pickupFeeKept: amounts.providerReceives.toString(),
      };
    } catch {
      return null;
    }
  }

  // Load đơn với tư cách CHỦ đơn — sai chủ / không có → 404, không lộ đơn tồn tại.
  private async getOrderAsCustomer(accountId: string, orderId: string) {
    const customer = await this.customerRepo.findOne({ where: { accountId } });
    const order = customer
      ? await this.orderRepo.findOne({
          where: { id: orderId, customerId: customer.id },
        })
      : null;
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    return order;
  }

  // Load đơn với tư cách vườn của đơn — vườn chưa duyệt → 403, vườn khác → 404 (giống handover.service.ts).
  private async getOrderAsProvider(accountId: string, orderId: string) {
    const provider = await this.providerRepo.findOne({ where: { accountId } });
    if (!provider) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    if (provider.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException('PROFILE_NOT_APPROVED');
    }
    const order = await this.orderRepo.findOne({
      where: { id: orderId, providerId: provider.id },
    });
    // Đơn nháp là không gian riêng của khách — vườn không được biết nó tồn tại.
    if (!order || order.status === 'DRAFT') {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    return order;
  }
}
