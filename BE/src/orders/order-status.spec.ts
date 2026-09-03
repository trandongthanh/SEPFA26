import { ConflictException } from '@nestjs/common';
import {
  assertTransition,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  OrderStatus,
} from './order-status';

describe('ORDER_TRANSITIONS', () => {
  it('khai đủ 10 trạng thái', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual(
      [...ORDER_STATUSES].sort(),
    );
  });

  // Đường chính (happy path) — đúng thứ tự nghiệp vụ.
  const HAPPY_PATH: [OrderStatus, OrderStatus][] = [
    ['DRAFT', 'PENDING_PROVIDER'],
    ['PENDING_PROVIDER', 'AGREEMENT_PENDING'],
    ['AGREEMENT_PENDING', 'AWAITING_PAYMENT'],
    ['AWAITING_PAYMENT', 'PAID'],
    ['PAID', 'HANDOVER_IN_PROGRESS'],
    ['HANDOVER_IN_PROGRESS', 'HANDOVER_AWAITING_CONFIRM'],
    ['HANDOVER_AWAITING_CONFIRM', 'IN_CARE'],
  ];
  it.each(HAPPY_PATH)('cho phép %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  // Nhánh kết thúc sớm.
  const EARLY_EXIT: [OrderStatus, OrderStatus][] = [
    ['PENDING_PROVIDER', 'REJECTED'],
    ['PENDING_PROVIDER', 'CANCELLED'],
    ['AGREEMENT_PENDING', 'CANCELLED'],
    ['AWAITING_PAYMENT', 'CANCELLED'],
    ['PAID', 'CANCELLED'],
    ['HANDOVER_IN_PROGRESS', 'CANCELLED'],
  ];
  it.each(EARLY_EXIT)('cho phép %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  // Đường cấm tiêu biểu — mỗi ca là 1 lỗ hổng nghiệp vụ nếu lọt.
  const FORBIDDEN: [OrderStatus, OrderStatus][] = [
    ['DRAFT', 'CANCELLED'], // DRAFT không hủy — chưa ai thấy đơn
    ['DRAFT', 'PAID'], // nhảy cóc qua ký + thanh toán
    ['PENDING_PROVIDER', 'PAID'], // chưa ký đã có tiền
    ['PENDING_PROVIDER', 'AWAITING_PAYMENT'], // bỏ qua bước ký
    ['AWAITING_PAYMENT', 'HANDOVER_IN_PROGRESS'], // chưa trả tiền đã đi lấy cây
    ['PAID', 'IN_CARE'], // bỏ qua bàn giao thẩm định
    ['HANDOVER_AWAITING_CONFIRM', 'CANCELLED'], // thẩm định xong chỉ được confirm
    ['IN_CARE', 'CANCELLED'], // terminal scope Phase 1
    ['REJECTED', 'PENDING_PROVIDER'], // terminal không mở lại
    ['CANCELLED', 'DRAFT'], // terminal không mở lại
    ['PAID', 'AWAITING_PAYMENT'], // không đi lùi
  ];
  it.each(FORBIDDEN)('chặn %s → %s (409)', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(ConflictException);
  });

  it('terminal (IN_CARE/REJECTED/CANCELLED) không đi được đâu nữa', () => {
    for (const terminal of ['IN_CARE', 'REJECTED', 'CANCELLED'] as const) {
      for (const to of ORDER_STATUSES) {
        expect(() => assertTransition(terminal, to)).toThrow(ConflictException);
      }
    }
  });
});
