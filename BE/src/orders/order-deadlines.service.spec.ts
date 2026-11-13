import { Logger } from '@nestjs/common';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { SecurityDeposit } from '../payments/entities/security-deposit.entity';
import { settleOrder } from '../payments/settle-order';
import type { DisputesService } from './disputes.service';
import type { Dispute } from './entities/dispute.entity';
import type { Handover } from './entities/handover.entity';
import type { HandoverService } from './handover.service';
import {
  OrderDeadlinesService,
  SWEEP_BATCH_SIZE,
  UNPAID_DEPOSIT_EXPIRED_REASON,
} from './order-deadlines.service';
import type { OrderStateService } from './order-state.service';

// Chia tiền đã có test riêng (settlement.spec.ts + e2e) — ở đây chỉ kiểm bộ quét có gọi hay không.
jest.mock('../payments/settle-order', () => ({ settleOrder: jest.fn() }));

const NOW = new Date('2026-11-18T09:00:00Z');
const PAST = new Date(NOW.getTime() - 60_000);
const FUTURE = new Date(NOW.getTime() + 60_000);

// Repo giả: createQueryBuilder().…().getMany() trả danh sách ứng viên cho trước.
function repoReturning(rows: object[]) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of [
    'select',
    'innerJoin',
    'where',
    'andWhere',
    'orderBy',
    'limit',
  ]) {
    builder[method] = jest.fn().mockReturnValue(builder);
  }
  builder.getMany = jest.fn().mockResolvedValue(rows);
  return { repo: { createQueryBuilder: jest.fn(() => builder) }, builder };
}

function build(
  rows: {
    deposits?: object[];
    handovers?: object[];
    disputes?: object[];
  } = {},
) {
  const deposits = repoReturning(rows.deposits ?? []);
  const handovers = repoReturning(rows.handovers ?? []);
  const disputes = repoReturning(rows.disputes ?? []);
  const manager = { findOne: jest.fn() };
  // Mỗi lần gọi transaction = một transaction riêng; callback ném lỗi thì transaction ném lại y như TypeORM.
  const dataSource = {
    transaction: jest.fn((work: (m: EntityManager) => Promise<unknown>) =>
      work(manager as unknown as EntityManager),
    ),
  };
  const orderState = { lock: jest.fn(), apply: jest.fn() };
  const handoverService = {
    cancelForUnpaidDeposit: jest.fn().mockResolvedValue(undefined),
    finalizeReturn: jest.fn().mockResolvedValue(NOW),
  };
  const disputesService = {
    escalateDispute: jest.fn<Promise<boolean>, [unknown, string, Date]>(),
  };
  const service = new OrderDeadlinesService(
    deposits.repo as unknown as Repository<SecurityDeposit>,
    handovers.repo as unknown as Repository<Handover>,
    disputes.repo as unknown as Repository<Dispute>,
    dataSource as unknown as DataSource,
    orderState as unknown as OrderStateService,
    handoverService as unknown as HandoverService,
    disputesService as unknown as DisputesService,
  );
  return {
    service,
    manager,
    dataSource,
    orderState,
    handoverService,
    disputesService,
    builders: {
      deposits: deposits.builder,
      handovers: handovers.builder,
      disputes: disputes.builder,
    },
  };
}

describe('OrderDeadlinesService', () => {
  let logError: jest.SpyInstance<void, unknown[]>;

  beforeEach(() => {
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    (settleOrder as jest.Mock).mockReset();
  });

  afterEach(() => {
    logError.mockRestore();
  });

  describe('escalateDisputes', () => {
    it('mỗi tranh chấp một transaction; lỗi ở một dòng chỉ ghi log, dòng sau vẫn chạy; chỉ đếm dòng thật sự chuyển', async () => {
      const t = build({
        disputes: [
          { id: 'd1', serviceOrderId: 'o1' },
          { id: 'd2', serviceOrderId: 'o2' },
          { id: 'd3', serviceOrderId: 'o3' },
          { id: 'd4', serviceOrderId: 'o4' },
        ],
      });
      t.disputesService.escalateDispute
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('deadlock detected'))
        // Hai bên vừa đồng ý đúng lúc quét → bỏ qua êm, không tính.
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await expect(t.service.escalateDisputes(NOW)).resolves.toBe(2);

      expect(t.dataSource.transaction).toHaveBeenCalledTimes(4);
      expect(
        t.disputesService.escalateDispute.mock.calls.map((call) => [
          call[1],
          call[2],
        ]),
      ).toEqual([
        ['d1', NOW],
        ['d2', NOW],
        ['d3', NOW],
        ['d4', NOW],
      ]);
      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0][0]).toContain('d2');
      expect(logError.mock.calls[0][0]).toContain('o2');
    });

    it('lọc NEGOTIATING đã quá hạn theo `now` truyền vào, giới hạn mỗi lượt', async () => {
      const t = build();
      await expect(t.service.escalateDisputes(NOW)).resolves.toBe(0);
      const b = t.builders.disputes;
      expect(b.where).toHaveBeenCalledWith('d.status = :status', {
        status: 'NEGOTIATING',
      });
      expect(b.andWhere).toHaveBeenCalledWith('d.negotiationDueAt <= :now', {
        now: NOW,
      });
      expect(b.limit).toHaveBeenCalledWith(SWEEP_BATCH_SIZE);
      expect(t.dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('expireUnpaidDeposits', () => {
    it('khoá đơn → kiểm lại khoản còn PENDING + đã quá hạn → huỷ với lý do hết hạn 2 giờ', async () => {
      const t = build({ deposits: [{ id: 'dep1', serviceOrderId: 'o1' }] });
      t.orderState.lock.mockResolvedValue({ id: 'o1' });
      t.manager.findOne.mockResolvedValue({ id: 'dep1', dueAt: PAST });

      await expect(t.service.expireUnpaidDeposits(NOW)).resolves.toBe(1);

      expect(t.handoverService.cancelForUnpaidDeposit).toHaveBeenCalledWith(
        t.manager,
        'o1',
        UNPAID_DEPOSIT_EXPIRED_REASON,
      );
      expect(UNPAID_DEPOSIT_EXPIRED_REASON).toContain('2 giờ');
      // Khoá đơn TRƯỚC khoản bảo đảm (cùng thứ tự với webhook / nút huỷ → không khoá chéo).
      expect(t.orderState.lock.mock.invocationCallOrder[0]).toBeLessThan(
        t.manager.findOne.mock.invocationCallOrder[0],
      );
    });

    it('vườn vừa nộp / vừa huỷ (không còn PENDING), hoặc hạn bị dời về sau → bỏ qua êm, không ghi lỗi', async () => {
      const t = build({
        deposits: [
          { id: 'dep1', serviceOrderId: 'o1' },
          { id: 'dep2', serviceOrderId: 'o2' },
          { id: 'dep3', serviceOrderId: 'o3' },
        ],
      });
      t.orderState.lock
        .mockResolvedValueOnce({ id: 'o1' })
        .mockResolvedValueOnce({ id: 'o2' })
        .mockResolvedValueOnce(null);
      t.manager.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'dep2', dueAt: FUTURE });

      await expect(t.service.expireUnpaidDeposits(NOW)).resolves.toBe(0);

      expect(t.handoverService.cancelForUnpaidDeposit).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it('huỷ một đơn ném lỗi → ghi log kèm id, đơn kế tiếp vẫn được huỷ', async () => {
      const t = build({
        deposits: [
          { id: 'dep1', serviceOrderId: 'o1' },
          { id: 'dep2', serviceOrderId: 'o2' },
        ],
      });
      t.orderState.lock.mockImplementation((_m: unknown, id: string) =>
        Promise.resolve({ id }),
      );
      t.manager.findOne.mockResolvedValue({ dueAt: PAST });
      t.handoverService.cancelForUnpaidDeposit
        .mockRejectedValueOnce(new Error('ESCROW_BALANCE_INSUFFICIENT'))
        .mockResolvedValueOnce(undefined);

      await expect(t.service.expireUnpaidDeposits(NOW)).resolves.toBe(1);

      expect(t.handoverService.cancelForUnpaidDeposit).toHaveBeenCalledTimes(2);
      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0][0]).toContain('dep1');
    });
  });

  describe('autoConfirmReturns', () => {
    const candidate = [{ id: 'h1', serviceOrderId: 'o1' }];

    it('đơn còn chờ khách + phiên quá 48 giờ → COMPLETED, phiên AUTO_CONFIRMED, chia tiền không hoàn không đền', async () => {
      const t = build({ handovers: candidate });
      const order = { id: 'o1', status: 'RETURN_AWAITING_CONFIRM' };
      t.orderState.lock.mockResolvedValue(order);
      t.manager.findOne.mockResolvedValue({
        id: 'h1',
        customerConfirmDueAt: PAST,
      });

      await expect(t.service.autoConfirmReturns(NOW)).resolves.toBe(1);

      expect(t.orderState.apply).toHaveBeenCalledWith(
        t.manager,
        order,
        'COMPLETED',
      );
      expect(t.handoverService.finalizeReturn).toHaveBeenCalledWith(
        t.manager,
        'h1',
        'AUTO_CONFIRMED',
      );
      // Không truyền R / C → mặc định 0 / 0.
      expect(settleOrder).toHaveBeenCalledWith(t.manager, order, NOW);
    });

    it.each([
      ['khách vừa mở tranh chấp (đơn DISPUTED)', 'DISPUTED', null],
      ['khách vừa bấm xác nhận (đơn COMPLETED)', 'COMPLETED', null],
      ['phiên không còn AWAITING_CUSTOMER', 'RETURN_AWAITING_CONFIRM', null],
      [
        'chưa tới hạn 48 giờ',
        'RETURN_AWAITING_CONFIRM',
        { id: 'h1', customerConfirmDueAt: FUTURE },
      ],
    ])('%s → bỏ qua êm, không đổi gì', async (_name, status, handover) => {
      const t = build({ handovers: candidate });
      t.orderState.lock.mockResolvedValue({ id: 'o1', status });
      t.manager.findOne.mockResolvedValue(handover);

      await expect(t.service.autoConfirmReturns(NOW)).resolves.toBe(0);

      expect(t.orderState.apply).not.toHaveBeenCalled();
      expect(t.handoverService.finalizeReturn).not.toHaveBeenCalled();
      expect(settleOrder).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it('chia tiền lỗi ở đơn đầu → ghi log, đơn sau vẫn tự hoàn tất', async () => {
      const t = build({
        handovers: [
          { id: 'h1', serviceOrderId: 'o1' },
          { id: 'h2', serviceOrderId: 'o2' },
        ],
      });
      t.orderState.lock.mockImplementation((_m: unknown, id: string) =>
        Promise.resolve({ id, status: 'RETURN_AWAITING_CONFIRM' }),
      );
      t.manager.findOne.mockResolvedValue({
        id: 'h',
        customerConfirmDueAt: PAST,
      });
      (settleOrder as jest.Mock)
        .mockRejectedValueOnce(new Error('ESCROW_BALANCE_INSUFFICIENT'))
        .mockResolvedValueOnce(undefined);

      await expect(t.service.autoConfirmReturns(NOW)).resolves.toBe(1);

      expect(settleOrder).toHaveBeenCalledTimes(2);
      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0][0]).toContain('h1');
    });
  });

  describe('sweep (tác vụ 5 phút)', () => {
    it('gọi lần lượt ba hạn với cùng một `now`, trả số dòng từng hạn', async () => {
      const t = build();
      const order: string[] = [];
      const deposits = jest
        .spyOn(t.service, 'expireUnpaidDeposits')
        .mockImplementation(() => {
          order.push('deposits');
          return Promise.resolve(1);
        });
      const returns = jest
        .spyOn(t.service, 'autoConfirmReturns')
        .mockImplementation(() => {
          order.push('returns');
          return Promise.resolve(2);
        });
      const disputes = jest
        .spyOn(t.service, 'escalateDisputes')
        .mockImplementation(() => {
          order.push('disputes');
          return Promise.resolve(3);
        });

      await expect(t.service.sweep(NOW)).resolves.toEqual({
        expiredDeposits: 1,
        autoConfirmedReturns: 2,
        escalatedDisputes: 3,
      });
      expect(order).toEqual(['deposits', 'returns', 'disputes']);
      expect(deposits).toHaveBeenCalledWith(NOW);
      expect(returns).toHaveBeenCalledWith(NOW);
      expect(disputes).toHaveBeenCalledWith(NOW);
    });

    it('cờ running: lượt trước chưa xong thì lượt sau bỏ qua (null); xong rồi thì chạy lại được', async () => {
      const t = build();
      let release!: (value: number) => void;
      const first = jest
        .spyOn(t.service, 'expireUnpaidDeposits')
        .mockImplementationOnce(
          () => new Promise<number>((resolve) => (release = resolve)),
        );

      const running = t.service.sweep(NOW);
      await expect(t.service.sweep(NOW)).resolves.toBeNull();
      expect(first).toHaveBeenCalledTimes(1);

      release(0);
      await expect(running).resolves.toEqual({
        expiredDeposits: 0,
        autoConfirmedReturns: 0,
        escalatedDisputes: 0,
      });
      await expect(t.service.sweep(NOW)).resolves.not.toBeNull();
      expect(first).toHaveBeenCalledTimes(2);
    });

    it('một hạn hỏng ngay từ câu lọc (mất kết nối) → ghi log, hai hạn còn lại vẫn chạy, cờ running được nhả', async () => {
      const t = build();
      jest
        .spyOn(t.service, 'expireUnpaidDeposits')
        .mockRejectedValue(new Error('connection terminated'));
      const returns = jest
        .spyOn(t.service, 'autoConfirmReturns')
        .mockResolvedValue(1);
      const disputes = jest
        .spyOn(t.service, 'escalateDisputes')
        .mockResolvedValue(1);

      await expect(t.service.sweep(NOW)).resolves.toEqual({
        expiredDeposits: 0,
        autoConfirmedReturns: 1,
        escalatedDisputes: 1,
      });
      expect(returns).toHaveBeenCalledTimes(1);
      expect(disputes).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledTimes(1);
      await expect(t.service.sweep(NOW)).resolves.not.toBeNull();
    });
  });
});
