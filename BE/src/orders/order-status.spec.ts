import { ConflictException } from '@nestjs/common';
import {
  assertTransition,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  OrderStatus,
} from './order-status';

describe('ORDER_TRANSITIONS', () => {
  it('khai đủ 15 trạng thái theo ERD', () => {
    expect(ORDER_STATUSES).toHaveLength(15);
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual(
      [...ORDER_STATUSES].sort(),
    );
  });

  // Đường chính (happy path) — đúng thứ tự nghiệp vụ, từ nháp tới hoàn tất.
  const HAPPY_PATH: [OrderStatus, OrderStatus][] = [
    ['DRAFT', 'PENDING_PROVIDER'],
    ['PENDING_PROVIDER', 'AGREEMENT_PENDING'],
    ['AGREEMENT_PENDING', 'AWAITING_PAYMENT'],
    ['AWAITING_PAYMENT', 'PAID'],
    ['PAID', 'HANDOVER_IN_PROGRESS'],
    ['HANDOVER_IN_PROGRESS', 'HANDOVER_AWAITING_CONFIRM'],
    ['HANDOVER_AWAITING_CONFIRM', 'IN_CARE'],
    ['IN_CARE', 'RETURN_IN_PROGRESS'],
    ['RETURN_IN_PROGRESS', 'RETURN_AWAITING_CONFIRM'],
    ['RETURN_AWAITING_CONFIRM', 'COMPLETED'],
  ];
  it.each(HAPPY_PATH)('cho phép %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  // Nhánh phụ: kết thúc sớm, hủy phiên trả, tranh chấp.
  const SIDE_BRANCHES: [OrderStatus, OrderStatus][] = [
    ['PENDING_PROVIDER', 'REJECTED'],
    ['PENDING_PROVIDER', 'EXPIRED'],
    ['PENDING_PROVIDER', 'CANCELLED'],
    ['AGREEMENT_PENDING', 'CANCELLED'],
    ['AWAITING_PAYMENT', 'CANCELLED'],
    ['PAID', 'CANCELLED'],
    ['HANDOVER_IN_PROGRESS', 'CANCELLED'],
    ['HANDOVER_AWAITING_CONFIRM', 'CANCELLED'], // khách không giao cây / vườn không nộp bảo đảm
    ['RETURN_IN_PROGRESS', 'IN_CARE'], // vườn hủy phiên trả, hẹn lại
    ['RETURN_AWAITING_CONFIRM', 'DISPUTED'],
    ['DISPUTED', 'COMPLETED'],
  ];
  it.each(SIDE_BRANCHES)('cho phép %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  // Đường cấm tiêu biểu — mỗi ca là 1 lỗ hổng nghiệp vụ nếu lọt.
  const FORBIDDEN: [OrderStatus, OrderStatus][] = [
    ['DRAFT', 'CANCELLED'], // DRAFT không hủy — chưa ai thấy đơn
    ['DRAFT', 'PAID'], // nhảy cóc qua ký + thanh toán
    ['PENDING_PROVIDER', 'PAID'], // chưa ký đã có tiền
    ['PENDING_PROVIDER', 'AWAITING_PAYMENT'], // bỏ qua bước ký
    ['AGREEMENT_PENDING', 'EXPIRED'], // hết hạn 24 giờ chỉ áp lúc chờ vườn trả lời
    ['AWAITING_PAYMENT', 'HANDOVER_IN_PROGRESS'], // chưa trả tiền đã đi lấy cây
    ['PAID', 'IN_CARE'], // bỏ qua bàn giao thẩm định
    ['HANDOVER_AWAITING_CONFIRM', 'RETURN_IN_PROGRESS'], // chưa nộp bảo đảm thì chưa có kỳ chăm
    ['IN_CARE', 'COMPLETED'], // bỏ qua trả cây
    ['IN_CARE', 'CANCELLED'], // đã nhận cây thì dừng giữa chừng, không hủy
    ['IN_CARE', 'DISPUTED'], // tranh chấp chỉ mở sau khi trả cây
    ['RETURN_IN_PROGRESS', 'COMPLETED'], // khách chưa xem kết quả trả cây
    ['RETURN_AWAITING_CONFIRM', 'IN_CARE'], // đã chốt trả thì không quay lại chăm
    ['DISPUTED', 'IN_CARE'], // tranh chấp không mở lại kỳ chăm
    ['PAID', 'AWAITING_PAYMENT'], // không đi lùi
  ];
  it.each(FORBIDDEN)('chặn %s → %s (409)', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(ConflictException);
  });

  it('trạng thái cuối (COMPLETED/REJECTED/EXPIRED/CANCELLED) không đi được đâu nữa', () => {
    for (const terminal of [
      'COMPLETED',
      'REJECTED',
      'EXPIRED',
      'CANCELLED',
    ] as const) {
      for (const to of ORDER_STATUSES) {
        expect(() => assertTransition(terminal, to)).toThrow(ConflictException);
      }
    }
  });
});
