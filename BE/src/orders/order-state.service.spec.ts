import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ServiceOrder } from './entities/service-order.entity';
import { OrderStateService } from './order-state.service';
import type { OrderStatus } from './order-status';

describe('OrderStateService', () => {
  const service = new OrderStateService();
  let findOne: jest.Mock;
  let save: jest.Mock;
  let manager: EntityManager;

  const order = (status: OrderStatus) =>
    Object.assign(new ServiceOrder(), { id: 'order-1', status });

  beforeEach(() => {
    findOne = jest.fn();
    save = jest.fn((entity: ServiceOrder) => Promise.resolve(entity));
    manager = { findOne, save } as unknown as EntityManager;
  });

  it('khóa dòng đơn bằng pessimistic_write', async () => {
    findOne.mockResolvedValue(order('DRAFT'));
    await service.transition(manager, 'order-1', 'DRAFT', 'PENDING_PROVIDER');
    expect(findOne).toHaveBeenCalledWith(ServiceOrder, {
      where: { id: 'order-1' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('đúng trạng thái → ghi trạng thái mới và trả entity đã khóa', async () => {
    findOne.mockResolvedValue(order('IN_CARE'));
    const result = await service.transition(
      manager,
      'order-1',
      'IN_CARE',
      'RETURN_IN_PROGRESS',
    );
    expect(result.status).toBe('RETURN_IN_PROGRESS');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'RETURN_IN_PROGRESS' }),
    );
  });

  it('nhận nhiều trạng thái nguồn', async () => {
    findOne.mockResolvedValue(order('DISPUTED'));
    const result = await service.transition(
      manager,
      'order-1',
      ['RETURN_AWAITING_CONFIRM', 'DISPUTED'],
      'COMPLETED',
    );
    expect(result.status).toBe('COMPLETED');
  });

  it('request khác đã đổi trạng thái trước → 409, không ghi gì', async () => {
    findOne.mockResolvedValue(order('PENDING_PROVIDER'));
    await expect(
      service.transition(manager, 'order-1', 'DRAFT', 'PENDING_PROVIDER'),
    ).rejects.toThrow(new ConflictException('INVALID_STATE_TRANSITION'));
    expect(save).not.toHaveBeenCalled();
  });

  it('không có đơn → 409', async () => {
    findOne.mockResolvedValue(null);
    await expect(
      service.transition(manager, 'order-1', 'DRAFT', 'PENDING_PROVIDER'),
    ).rejects.toThrow(ConflictException);
    expect(save).not.toHaveBeenCalled();
  });

  it('trạng thái nguồn khớp nhưng bảng chuyển cấm → 409', async () => {
    findOne.mockResolvedValue(order('IN_CARE'));
    await expect(
      service.transition(manager, 'order-1', 'IN_CARE', 'COMPLETED'),
    ).rejects.toThrow(ConflictException);
    expect(save).not.toHaveBeenCalled();
  });

  it('apply trên đơn đã khóa: kiểm bảng chuyển rồi ghi', async () => {
    const locked = order('AWAITING_PAYMENT');
    await service.apply(manager, locked, 'PAID');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PAID' }),
    );
    await expect(
      service.apply(manager, order('PAID'), 'AWAITING_PAYMENT'),
    ).rejects.toThrow(ConflictException);
  });
});
