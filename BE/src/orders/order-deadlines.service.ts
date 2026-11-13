import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';
import { SecurityDeposit } from '../payments/entities/security-deposit.entity';
import { settleOrder } from '../payments/settle-order';
import { DisputesService } from './disputes.service';
import { Dispute } from './entities/dispute.entity';
import { Handover } from './entities/handover.entity';
import { ServiceOrder } from './entities/service-order.entity';
import { HandoverService } from './handover.service';
import { OrderStateService } from './order-state.service';

// Mỗi lượt quét chỉ lấy tối đa 50 dòng cho mỗi loại hạn: lượt sau (5 phút nữa) lấy tiếp, không để một
// lượt ôm cả nghìn transaction. Dòng tới hạn sớm nhất được xử trước.
export const SWEEP_BATCH_SIZE = 50;

// Lý do ghi vào đơn + phiên nhận cây khi hệ thống tự huỷ (vườn tự bấm huỷ thì ghi lý do vườn nhập).
export const UNPAID_DEPOSIT_EXPIRED_REASON =
  'Hết hạn 2 giờ vườn chưa nộp tiền bảo đảm — hệ thống tự huỷ đơn';

/**
 * Bộ quét ba hạn tự chạy (5 phút/lần):
 *   1. vườn không nộp tiền bảo đảm trong 2 giờ → huỷ đơn, hoàn khách 100%;
 *   2. khách im lặng 48 giờ sau khi vườn chốt trả cây → đơn tự hoàn tất, chia tiền như đơn bình thường;
 *   3. hai bên không thoả thuận xong trong 3 ngày → tranh chấp chuyển admin.
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
        if (!deposit || deposit.dueAt.getTime() > now.getTime()) {
          return false;
        }
        await this.handovers.cancelForUnpaidDeposit(
          manager,
          orderId,
          UNPAID_DEPOSIT_EXPIRED_REASON,
        );
        return true;
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
        return true;
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
      (manager, { id }) => this.disputes.escalateDispute(manager, id, now),
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
  private async processEach(
    label: string,
    rows: { id: string; orderId: string }[],
    work: (
      manager: EntityManager,
      row: { id: string; orderId: string },
    ) => Promise<boolean>,
  ): Promise<number> {
    let done = 0;
    for (const row of rows) {
      try {
        const handled = await this.dataSource.transaction((manager) =>
          work(manager, row),
        );
        if (handled) {
          done += 1;
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
