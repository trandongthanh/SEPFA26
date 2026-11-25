import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { SecurityDeposit } from '../payments/entities/security-deposit.entity';
import { settleOrder } from '../payments/settle-order';
import {
  type CancelCode,
  type CancelRefund,
  NO_SHOW_AUTO_CANCEL_MS,
} from './cancel-rules';
import { DisputesService } from './disputes.service';
import { Dispute } from './entities/dispute.entity';
import { Handover } from './entities/handover.entity';
import { ServiceOrder } from './entities/service-order.entity';
import { HandoverService } from './handover.service';
import { OrderCancelService } from './order-cancel.service';
import { OrderStateService } from './order-state.service';

// Mỗi lượt quét chỉ lấy tối đa 50 dòng cho mỗi loại hạn: lượt sau (5 phút nữa) lấy tiếp, không để một
// lượt ôm cả nghìn transaction. Dòng tới hạn sớm nhất được xử trước.
export const SWEEP_BATCH_SIZE = 50;

// Lý do ghi vào đơn + phiên nhận cây khi hệ thống tự huỷ (vườn tự bấm huỷ thì ghi lý do vườn nhập).
export const UNPAID_DEPOSIT_EXPIRED_REASON =
  'Hết hạn 2 giờ vườn chưa nộp tiền bảo đảm — hệ thống tự huỷ đơn';

// Lý do ghi vào đơn khi hệ thống tự đóng (cancel_reason); mã cố định nằm ở cancel_code.
export const SYSTEM_CANCEL_REASONS = {
  SIGN_TIMEOUT: 'Quá hạn ký hợp đồng — hệ thống tự huỷ đơn',
  PAYMENT_TIMEOUT: 'Quá hạn thanh toán — hệ thống tự huỷ đơn',
  PROVIDER_NO_SHOW:
    'Quá giờ hẹn lấy cây 24 giờ, vườn chưa chốt biên bản nhận cây — hệ thống tự huỷ đơn',
  CONFIRM_TIMEOUT:
    'Hết hạn 2 giờ khách chưa trả lời biên bản nhận cây — hệ thống tự huỷ đơn',
} as const;

/**
 * Bộ quét hạn tự chạy (5 phút/lần). Ba hạn có từ 14/11:
 *   1. vườn không nộp tiền bảo đảm trong 2 giờ → huỷ đơn, hoàn khách 100%;
 *   2. khách im lặng 48 giờ sau khi vườn chốt trả cây → đơn tự hoàn tất, chia tiền như đơn bình thường;
 *   3. hai bên không thoả thuận xong trong 3 ngày → tranh chấp chuyển admin.
 * Năm hạn thêm 17/11 (đơn đứng yên trước khi vào kỳ chăm):
 *   4. vườn không trả lời đơn trước hạn → EXPIRED (không tính là lần huỷ của vườn);
 *   5. quá hạn ký → CANCELLED;  6. quá hạn thanh toán → CANCELLED (cả hai chưa có tiền);
 *   7. quá giờ hẹn 24 giờ mà vườn chưa chốt biên bản (chưa tới, hoặc mở phiên rồi bỏ dở) → huỷ, hoàn khách 100%;
 *   8. khách không trả lời biên bản nhận cây trong 2 giờ → huỷ như khách không giao cây (vườn giữ phí lấy cây).
 * Hạn 7 và 8 chỉ xét đơn có `payment_due_at` (đơn đi qua bước ký SAU khi có luật hạn) — đơn cũ không bị tự huỷ.
 * Nguyên tắc: MỖI dòng một transaction riêng; trong transaction khoá dòng rồi KIỂM LẠI trạng thái + hạn
 * (câu lọc ban đầu chạy ngoài transaction nên chỉ là danh sách ứng viên). Người dùng bấm cùng lúc hoặc hai
 * lượt quét chồng nhau → chỉ một bên thắng, bên kia bỏ qua êm. Lỗi ở một dòng chỉ ghi log rồi đi tiếp.
 * Ba hàm công khai nhận `now` để test tua giờ; các route vẫn tự kiểm hạn, không trông vào bộ quét.
 * Bộ hẹn giờ chỉ chạy khi OrdersModule nạp ScheduleModule (tắt ở NODE_ENV=test) — xem orders.module.ts.
 */
@Injectable()
export class OrderDeadlinesService {
  private readonly logger = new Logger(OrderDeadlinesService.name);
  // Lượt trước chưa xong (DB chậm, nhiều dòng) mà đã tới giờ lượt sau → lượt sau bỏ qua.
  private running = false;

  constructor(
    @InjectRepository(SecurityDeposit)
    private readonly depositRepo: Repository<SecurityDeposit>,
    @InjectRepository(Handover)
    private readonly handoverRepo: Repository<Handover>,
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    private readonly dataSource: DataSource,
    private readonly orderState: OrderStateService,
    private readonly handovers: HandoverService,
    private readonly disputes: DisputesService,
    @InjectRepository(ServiceOrder)
    private readonly orderRepo: Repository<ServiceOrder>,
    private readonly orderCancel: OrderCancelService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Một lượt quét. Ba hạn độc lập: hạn này lỗi (kể cả lỗi câu lọc) không chặn hạn kia.
   * Trả `null` khi bỏ qua vì lượt trước còn đang chạy.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(now: Date = new Date()): Promise<{
    expiredDeposits: number;
    autoConfirmedReturns: number;
    escalatedDisputes: number;
    expiredOrders: number;
    cancelledUnsigned: number;
    cancelledUnpaid: number;
    cancelledNoShows: number;
    cancelledUnconfirmed: number;
  } | null> {
    if (this.running) {
      return null;
    }
    this.running = true;
    try {
      return {
        expiredDeposits: await this.runStep('expireUnpaidDeposits', () =>
          this.expireUnpaidDeposits(now),
        ),
        autoConfirmedReturns: await this.runStep('autoConfirmReturns', () =>
          this.autoConfirmReturns(now),
        ),
        escalatedDisputes: await this.runStep('escalateDisputes', () =>
          this.escalateDisputes(now),
        ),
        expiredOrders: await this.runStep('expireUnansweredOrders', () =>
          this.expireUnansweredOrders(now),
        ),
        cancelledUnsigned: await this.runStep('cancelUnsignedOrders', () =>
          this.cancelUnsignedOrders(now),
        ),
        cancelledUnpaid: await this.runStep('cancelUnpaidOrders', () =>
          this.cancelUnpaidOrders(now),
        ),
        cancelledNoShows: await this.runStep('cancelProviderNoShows', () =>
          this.cancelProviderNoShows(now),
        ),
        cancelledUnconfirmed: await this.runStep(
          'cancelUnconfirmedHandovers',
          () => this.cancelUnconfirmedHandovers(now),
        ),
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * Hạn 2 giờ nộp tiền bảo đảm: khoản còn PENDING mà đã quá `due_at` → đơn CANCELLED, khách nhận lại 100%
   * kể cả phí lấy cây (đơn mẫu: lệnh chi REFUND 484.000), khoản bảo đảm + phiên nhận cây CANCELLED.
   * Vườn vừa nộp đủ (webhook) hoặc vừa tự bấm huỷ đúng lúc này → bỏ qua, không tính.
   * Trả số đơn đã huỷ.
   */
  async expireUnpaidDeposits(now: Date = new Date()): Promise<number> {
    const candidates = await this.depositRepo
      .createQueryBuilder('d')
      .select(['d.id', 'd.serviceOrderId'])
      .where('d.status = :status', { status: 'PENDING' })
      .andWhere('d.dueAt <= :now', { now })
      .orderBy('d.dueAt', 'ASC')
      .limit(SWEEP_BATCH_SIZE)
      .getMany();

    return this.processEach(
      'Tự huỷ đơn vì quá hạn nộp tiền bảo đảm',
      candidates.map((deposit) => ({
        id: deposit.id,
        orderId: deposit.serviceOrderId,
      })),
      async (manager, { id, orderId }) => {
        // Khoá ĐƠN trước, khoản bảo đảm sau — cùng thứ tự với webhook nộp tiền và nút huỷ của vườn.
        const order = await this.orderState.lock(manager, orderId);
        const deposit = order
          ? await manager.findOne(SecurityDeposit, {
              where: { id, status: 'PENDING' },
              lock: { mode: 'pessimistic_write' },
            })
          : null;
        if (!order || !deposit || deposit.dueAt.getTime() > now.getTime()) {
          return false;
        }
        await this.handovers.cancelForUnpaidDeposit(
          manager,
          orderId,
          UNPAID_DEPOSIT_EXPIRED_REASON,
          'SYSTEM',
        );
        return () =>
          this.notifyOrderSystemCancelled(
            order,
            'DEPOSIT_UNPAID',
            UNPAID_DEPOSIT_EXPIRED_REASON,
          );
      },
    );
  }

  /**
   * Hạn 48 giờ khách xác nhận nhận lại cây: phiên trả cây còn AWAITING_CUSTOMER mà đã quá
   * `customer_confirm_due_at` → đơn COMPLETED, phiên AUTO_CONFIRMED, chia tiền R = 0, C = 0
   * (đơn mẫu: sổ đơn khách 0 / vườn 412.000 / nền tảng 72.000; sổ bảo đảm trả vườn 3.400.000).
   * Khách vừa bấm xác nhận, hoặc vừa mở tranh chấp (đơn DISPUTED, phiên DISPUTED) → bỏ qua.
   * Trả số đơn đã tự hoàn tất.
   */
  async autoConfirmReturns(now: Date = new Date()): Promise<number> {
    const candidates = await this.handoverRepo
      .createQueryBuilder('h')
      .innerJoin(ServiceOrder, 'o', 'o.id = h.serviceOrderId')
      .select(['h.id', 'h.serviceOrderId'])
      .where('h.handoverType = :type', { type: 'OUT' })
      .andWhere('h.status = :status', { status: 'AWAITING_CUSTOMER' })
      .andWhere('h.customerConfirmDueAt <= :now', { now })
      .andWhere('o.status = :orderStatus', {
        orderStatus: 'RETURN_AWAITING_CONFIRM',
      })
      .orderBy('h.customerConfirmDueAt', 'ASC')
      .limit(SWEEP_BATCH_SIZE)
      .getMany();

    return this.processEach(
      'Tự hoàn tất đơn vì khách không xác nhận trong 48 giờ',
      candidates.map((handover) => ({
        id: handover.id,
        orderId: handover.serviceOrderId,
      })),
      async (manager, { id, orderId }) => {
        // Khoá đơn rồi kiểm lại: khách xác nhận / mở tranh chấp cũng khoá dòng đơn trước nên hai bên xếp hàng.
        const order = await this.orderState.lock(manager, orderId);
        if (!order || order.status !== 'RETURN_AWAITING_CONFIRM') {
          return false;
        }
        const handover = await manager.findOne(Handover, {
          where: { id, handoverType: 'OUT', status: 'AWAITING_CUSTOMER' },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !handover ||
          !handover.customerConfirmDueAt ||
          handover.customerConfirmDueAt.getTime() > now.getTime()
        ) {
          return false;
        }
        await this.orderState.apply(manager, order, 'COMPLETED');
        await this.handovers.finalizeReturn(
          manager,
          handover.id,
          'AUTO_CONFIRMED',
        );
        // Không tranh chấp → không hoàn công, không đền; cả hai sổ chia hết về 0.
        await settleOrder(manager, order, now);
        return async () => {
          await this.notifications?.notifyOrderPartiesSafe(order, {
            customer: {
              type: 'ORDER_COMPLETED',
              title: `Đơn ${order.orderCode} đã tự động hoàn tất`,
              body: `Đã hết 48 giờ xác nhận trả cây cho đơn ${order.orderCode}. Đơn hàng đã tự động hoàn tất.`,
              refEntity: 'ORDER',
              refId: order.id,
              metadata: {
                orderId: order.id,
                orderCode: order.orderCode,
                autoConfirmed: true,
              },
            },
            provider: {
              type: 'ORDER_COMPLETED',
              title: `Đơn ${order.orderCode} đã tự động hoàn tất`,
              body: `Đã hết 48 giờ xác nhận trả cây cho đơn ${order.orderCode}. Đơn hàng đã hoàn tất và tạo lệnh chi theo lịch đối soát.`,
              refEntity: 'ORDER',
              refId: order.id,
              metadata: {
                orderId: order.id,
                orderCode: order.orderCode,
                autoConfirmed: true,
              },
            },
          });
        };
      },
    );
  }

  /**
   * Hạn 3 ngày thương lượng: tranh chấp còn NEGOTIATING mà đã quá `negotiation_due_at` → ADMIN_REVIEW,
   * `admin_due_at` = +5 ngày, đề nghị còn treo → SUPERSEDED (DisputesService.escalateDispute tự khoá + kiểm lại).
   * Không đụng đơn, không đụng tiền. Trả số tranh chấp đã chuyển admin.
   */
  async escalateDisputes(now: Date = new Date()): Promise<number> {
    const candidates = await this.disputeRepo
      .createQueryBuilder('d')
      .select(['d.id', 'd.serviceOrderId'])
      .where('d.status = :status', { status: 'NEGOTIATING' })
      .andWhere('d.negotiationDueAt <= :now', { now })
      .orderBy('d.negotiationDueAt', 'ASC')
      .limit(SWEEP_BATCH_SIZE)
      .getMany();

    return this.processEach(
      'Chuyển tranh chấp quá hạn thương lượng sang admin',
      candidates.map((dispute) => ({
        id: dispute.id,
        orderId: dispute.serviceOrderId,
      })),
      async (manager, { id, orderId }) => {
        const escalated = await this.disputes.escalateDispute(manager, id, now);
        if (!escalated) {
          return false;
        }
        const order = await manager.findOne(ServiceOrder, {
          where: { id: orderId },
          select: { id: true, orderCode: true, customerId: true, providerId: true },
        });
        return async () => {
          const orderLabel = order?.orderCode ?? orderId;
          const payload = {
            type: 'DISPUTE_ESCALATED' as const,
            title: `Tranh chấp đơn ${orderLabel} đã chuyển quản trị viên`,
            body: `Đã hết hạn 3 ngày thương lượng cho tranh chấp đơn ${orderLabel}. Hồ sơ đã được chuyển tới quản trị viên xem xét.`,
            refEntity: 'DISPUTE' as const,
            refId: id,
            metadata: {
              disputeId: id,
              orderId,
              orderCode: order?.orderCode,
            },
          };
          if (order) {
            await this.notifications?.notifyOrderPartiesSafe(order, {
              customer: payload,
              provider: payload,
            });
          }
          await this.notifications?.notifyAdminsSafe({
            ...payload,
            title: `Có tranh chấp cần phân xử (${orderLabel})`,
            body: `Tranh chấp đơn ${orderLabel} đã quá 3 ngày thương lượng và được chuyển sang hàng chờ Admin.`,
          });
        };
      },
    );
  }

  /**
   * Hạn vườn trả lời đơn: đơn còn PENDING_PROVIDER mà đã quá `provider_respond_due_at` → EXPIRED.
   * Chưa có tiền, chưa có hợp đồng; không ghi cancelled_by / cancel_code (tên trạng thái đã nói rõ lý do) và
   * KHÔNG cộng lần huỷ cho vườn (vườn chưa nhận đơn). Vườn vừa trả lời đúng lúc này → bỏ qua. Trả số đơn hết hạn.
   */
  async expireUnansweredOrders(now: Date = new Date()): Promise<number> {
    const candidates = await this.overdueOrders(
      'PENDING_PROVIDER',
      'providerRespondDueAt',
      now,
    );
    return this.processEach(
      'Chuyển đơn sang Hết hạn vì vườn không trả lời',
      candidates,
      async (manager, { orderId }) => {
        const order = await this.orderState.lock(manager, orderId);
        if (
          !order ||
          order.status !== 'PENDING_PROVIDER' ||
          !order.providerRespondDueAt ||
          order.providerRespondDueAt.getTime() > now.getTime()
        ) {
          return false;
        }
        await this.orderState.apply(manager, order, 'EXPIRED');
        return async () => {
          const payload = {
            type: 'ORDER_EXPIRED' as const,
            title: `Đơn ${order.orderCode} đã hết hạn phản hồi`,
            body: `Đơn ${order.orderCode} đã hết hạn do nhà vườn không phản hồi đúng thời gian quy định.`,
            refEntity: 'ORDER' as const,
            refId: order.id,
            metadata: { orderId: order.id, orderCode: order.orderCode },
          };
          await this.notifications?.notifyOrderPartiesSafe(order, {
            customer: payload,
            provider: payload,
          });
        };
      },
    );
  }

  /** Hạn ký hợp đồng: đơn còn AGREEMENT_PENDING mà đã quá `agreement_due_at` → CANCELLED (SYSTEM, SIGN_TIMEOUT). */
  async cancelUnsignedOrders(now: Date = new Date()): Promise<number> {
    return this.cancelOverdue(
      'AGREEMENT_PENDING',
      'agreementDueAt',
      'SIGN_TIMEOUT',
      now,
    );
  }

  /**
   * Hạn thanh toán: đơn còn AWAITING_PAYMENT mà đã quá `payment_due_at` → CANCELLED (SYSTEM, PAYMENT_TIMEOUT),
   * các dòng hoá đơn chờ trả → CANCELLED. Tiền về sau đó không được ghi nhận (webhook tự kiểm hạn).
   */
  async cancelUnpaidOrders(now: Date = new Date()): Promise<number> {
    return this.cancelOverdue(
      'AWAITING_PAYMENT',
      'paymentDueAt',
      'PAYMENT_TIMEOUT',
      now,
    );
  }

  /**
   * Vườn không tới / mở phiên rồi bỏ dở: đơn PAID hoặc HANDOVER_IN_PROGRESS mà đã quá giờ hẹn lấy cây 24 giờ →
   * CANCELLED (SYSTEM, PROVIDER_NO_SHOW), khách nhận lại 100% kể cả phí lấy cây (đơn mẫu 484.000), phiên đang mở
   * → CANCELLED, vườn +1 lần huỷ. Vườn vừa chốt biên bản / khách vừa tự huỷ đúng lúc này → bỏ qua.
   */
  async cancelProviderNoShows(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - NO_SHOW_AUTO_CANCEL_MS);
    const orders = await this.orderRepo
      .createQueryBuilder('o')
      .select(['o.id'])
      .where('o.status IN (:...statuses)', {
        statuses: ['PAID', 'HANDOVER_IN_PROGRESS'],
      })
      .andWhere('o.scheduledPickupAt <= :cutoff', { cutoff })
      // Đơn cũ (thanh toán trước khi có luật hạn) không có hạn thanh toán → không tự huỷ.
      .andWhere('o.paymentDueAt IS NOT NULL')
      .orderBy('o.scheduledPickupAt', 'ASC')
      .limit(SWEEP_BATCH_SIZE)
      .getMany();

    return this.processEach(
      'Tự huỷ đơn vì vườn không tới lấy cây',
      orders.map((order) => ({ id: order.id, orderId: order.id })),
      async (manager, { orderId }) => {
        const order = await this.orderState.lock(manager, orderId);
        if (
          !order ||
          (order.status !== 'PAID' &&
            order.status !== 'HANDOVER_IN_PROGRESS') ||
          order.scheduledPickupAt.getTime() > cutoff.getTime()
        ) {
          return false;
        }
        await this.orderCancel.closeOrder(manager, order, {
          by: 'SYSTEM',
          code: 'PROVIDER_NO_SHOW',
          reason: SYSTEM_CANCEL_REASONS.PROVIDER_NO_SHOW,
          refund: 'FULL',
          countsAgainstProvider: true,
          now,
        });
        return () =>
          this.notifyOrderSystemCancelled(
            order,
            'PROVIDER_NO_SHOW',
            SYSTEM_CANCEL_REASONS.PROVIDER_NO_SHOW,
          );
      },
    );
  }

  /**
   * Hạn 2 giờ khách trả lời biên bản nhận cây: phiên nhận cây còn AWAITING_CUSTOMER mà đã quá
   * `customer_confirm_due_at` → đơn CANCELLED (SYSTEM, CONFIRM_TIMEOUT), chia tiền như khách không giao cây
   * (đơn mẫu: khách 424.000, vườn giữ phí lấy cây 60.000). Khách vừa đồng ý / vừa bấm không giao cây → bỏ qua.
   */
  async cancelUnconfirmedHandovers(now: Date = new Date()): Promise<number> {
    const candidates = await this.handoverRepo
      .createQueryBuilder('h')
      .innerJoin(ServiceOrder, 'o', 'o.id = h.serviceOrderId')
      .select(['h.id', 'h.serviceOrderId'])
      .where('h.handoverType = :type', { type: 'IN' })
      .andWhere('h.status = :status', { status: 'AWAITING_CUSTOMER' })
      .andWhere('h.customerConfirmDueAt <= :now', { now })
      .andWhere('o.status = :orderStatus', {
        orderStatus: 'HANDOVER_AWAITING_CONFIRM',
      })
      // Đơn cũ (biên bản chốt theo hạn 48 giờ trước khi có luật mới) không tự huỷ.
      .andWhere('o.paymentDueAt IS NOT NULL')
      .orderBy('h.customerConfirmDueAt', 'ASC')
      .limit(SWEEP_BATCH_SIZE)
      .getMany();

    return this.processEach(
      'Tự huỷ đơn vì khách không trả lời biên bản nhận cây',
      candidates.map((handover) => ({
        id: handover.id,
        orderId: handover.serviceOrderId,
      })),
      async (manager, { id, orderId }) => {
        const order = await this.orderState.lock(manager, orderId);
        if (!order || order.status !== 'HANDOVER_AWAITING_CONFIRM') {
          return false;
        }
        const handover = await manager.findOne(Handover, {
          where: { id, handoverType: 'IN', status: 'AWAITING_CUSTOMER' },
          lock: { mode: 'pessimistic_write' },
        });
        if (
          !handover ||
          !handover.customerConfirmDueAt ||
          handover.customerConfirmDueAt.getTime() > now.getTime()
        ) {
          return false;
        }
        await this.orderCancel.closeOrder(manager, order, {
          by: 'SYSTEM',
          code: 'CONFIRM_TIMEOUT',
          reason: SYSTEM_CANCEL_REASONS.CONFIRM_TIMEOUT,
          refund: 'KEEP_PICKUP_FEE',
          countsAgainstProvider: false,
          now,
        });
        return () =>
          this.notifyOrderSystemCancelled(
            order,
            'CONFIRM_TIMEOUT',
            SYSTEM_CANCEL_REASONS.CONFIRM_TIMEOUT,
          );
      },
    );
  }

  // Ứng viên của một hạn chờ trước thanh toán: đơn đang ở `status` và cột hạn đã qua (dòng hạn rỗng bị loại).
  private async overdueOrders(
    status: 'PENDING_PROVIDER' | 'AGREEMENT_PENDING' | 'AWAITING_PAYMENT',
    dueColumn: 'providerRespondDueAt' | 'agreementDueAt' | 'paymentDueAt',
    now: Date,
  ): Promise<{ id: string; orderId: string }[]> {
    const orders = await this.orderRepo
      .createQueryBuilder('o')
      .select(['o.id'])
      .where('o.status = :status', { status })
      .andWhere(`o.${dueColumn} <= :now`, { now })
      .orderBy(`o.${dueColumn}`, 'ASC')
      .limit(SWEEP_BATCH_SIZE)
      .getMany();
    return orders.map((order) => ({ id: order.id, orderId: order.id }));
  }

  // Hạn ký và hạn thanh toán giống nhau: khoá đơn, kiểm lại trạng thái + hạn, đóng đơn không có tiền.
  private async cancelOverdue(
    status: 'AGREEMENT_PENDING' | 'AWAITING_PAYMENT',
    dueColumn: 'agreementDueAt' | 'paymentDueAt',
    code: Extract<CancelCode, 'SIGN_TIMEOUT' | 'PAYMENT_TIMEOUT'>,
    now: Date,
  ): Promise<number> {
    const refund: CancelRefund = 'NONE';
    return this.processEach(
      `Tự huỷ đơn (${code})`,
      await this.overdueOrders(status, dueColumn, now),
      async (manager, { orderId }) => {
        const order = await this.orderState.lock(manager, orderId);
        const dueAt = order?.[dueColumn];
        if (
          !order ||
          order.status !== status ||
          !dueAt ||
          dueAt.getTime() > now.getTime()
        ) {
          return false;
        }
        await this.orderCancel.closeOrder(manager, order, {
          by: 'SYSTEM',
          code,
          reason: SYSTEM_CANCEL_REASONS[code],
          refund,
          countsAgainstProvider: false,
          now,
        });
        return () =>
          this.notifyOrderSystemCancelled(
            order,
            code,
            SYSTEM_CANCEL_REASONS[code],
          );
      },
    );
  }

  // Câu lọc ứng viên hỏng (mất kết nối DB...) → ghi log, coi như hạn này xử 0 dòng, hạn sau vẫn chạy.
  private async runStep(
    name: string,
    step: () => Promise<number>,
  ): Promise<number> {
    try {
      return await step();
    } catch (error) {
      this.logger.error(
        `Bộ quét hạn: bước ${name} lỗi`,
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }

  /**
   * Mỗi dòng một transaction. `work` trả true = đã xử lý, false = bỏ qua êm (bên khác đã làm trước).
   * Ném lỗi → transaction của RIÊNG dòng đó huỷ, ghi log kèm id rồi đi tiếp dòng sau; lượt quét 5 phút
   * sau sẽ thử lại dòng lỗi (ví dụ sổ lệch tiền → ESCROW_BALANCE_INSUFFICIENT, chờ admin xử tay).
   */
  private async notifyOrderSystemCancelled(
    order: { id: string; orderCode: string; customerId: string; providerId: string },
    cancelCode: CancelCode,
    reason: string,
  ): Promise<void> {
    const payload = {
      type: 'ORDER_CANCELLED' as const,
      title: `Đơn ${order.orderCode} đã tự động huỷ`,
      body: reason,
      refEntity: 'ORDER' as const,
      refId: order.id,
      metadata: {
        orderId: order.id,
        orderCode: order.orderCode,
        cancelCode,
        cancelledBy: 'SYSTEM',
      },
    };
    await this.notifications?.notifyOrderPartiesSafe(order, {
      customer: payload,
      provider: payload,
    });
  }

  private async processEach(
    label: string,
    rows: { id: string; orderId: string }[],
    work: (
      manager: EntityManager,
      row: { id: string; orderId: string },
    ) => Promise<boolean | (() => Promise<void>)>,
  ): Promise<number> {
    let done = 0;
    for (const row of rows) {
      try {
        const result = await this.dataSource.transaction((manager) =>
          work(manager, row),
        );
        if (result) {
          done += 1;
          if (typeof result === 'function') {
            try {
              await result();
            } catch (notifyError) {
              this.logger.warn(
                `${label} — lỗi gửi thông báo ở dòng ${row.id} (đơn ${row.orderId}): ${String(notifyError)}`,
              );
            }
          }
        }
      } catch (error) {
        this.logger.error(
          `${label} — lỗi ở dòng ${row.id} (đơn ${row.orderId})`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return done;
  }
}
