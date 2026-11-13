import { ConflictException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ServiceOrder } from './entities/service-order.entity';
import { assertTransition, type OrderStatus } from './order-status';

/**
 * Nơi DUY NHẤT được đổi `service_orders.status` (nguyên tắc T4: tiền đi theo trạng thái đơn,
 * mọi thay đổi tiền nằm chung transaction với lần đổi trạng thái).
 * Mọi hàm nhận EntityManager của transaction nghiệp vụ đang mở — service này không tự mở transaction,
 * để nơi gọi ghi tiếp các bảng đi kèm (hợp đồng, sổ ký quỹ, bàn giao...) rồi commit một lần.
 */
@Injectable()
export class OrderStateService {
  /** Khóa dòng đơn (SELECT ... FOR UPDATE): request khác cùng đơn phải chờ transaction này xong. */
  lock(manager: EntityManager, orderId: string): Promise<ServiceOrder | null> {
    return manager.findOne(ServiceOrder, {
      where: { id: orderId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * Ghi trạng thái mới cho đơn ĐÃ khóa. Nơi gọi tự kiểm trạng thái hiện tại sau khi khóa
   * (vd webhook cần `return false` thay vì ném lỗi). Bảng chuyển cấm → 409.
   */
  async apply(
    manager: EntityManager,
    locked: ServiceOrder,
    to: OrderStatus,
  ): Promise<ServiceOrder> {
    assertTransition(locked.status, to);
    locked.status = to;
    return manager.save(locked);
  }

  /**
   * Khóa + kiểm lại + ghi trong một lần gọi. Đơn không có, hoặc trạng thái sau khi khóa không thuộc `from`
   * (request khác đã đổi trước) → 409 INVALID_STATE_TRANSITION, nơi gọi rollback cả transaction.
   * Trả entity đã khóa để nơi gọi gán tiếp cột khác rồi save trong cùng transaction.
   */
  async transition(
    manager: EntityManager,
    orderId: string,
    from: OrderStatus | readonly OrderStatus[],
    to: OrderStatus,
  ): Promise<ServiceOrder> {
    const locked = await this.lock(manager, orderId);
    const expected: readonly OrderStatus[] =
      typeof from === 'string' ? [from] : from;
    if (!locked || !expected.includes(locked.status)) {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }
    return this.apply(manager, locked, to);
  }
}
