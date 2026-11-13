import { ConflictException } from '@nestjs/common';

/**
 * Máy trạng thái SERVICE_ORDER — đủ 15 trạng thái theo ERD (docs/diagrams/erd/lancare-physical.dbml).
 * Toán thuần (không chạm DB) để unit-test toàn bộ đường đi hợp lệ/cấm.
 * Đổi trạng thái thật trong DB chỉ đi qua OrderStateService (khóa dòng + kiểm lại).
 * Trạng thái mới chưa có route dùng: RETURN_* / COMPLETED (chặng trả cây), EXPIRED (vườn im lặng 24 giờ),
 * DISPUTED (tranh chấp) — khai sẵn để các chặng sau chỉ việc gọi.
 */
export const ORDER_STATUSES = [
  'DRAFT',
  'PENDING_PROVIDER',
  'AGREEMENT_PENDING',
  'AWAITING_PAYMENT',
  'PAID',
  'HANDOVER_IN_PROGRESS',
  'HANDOVER_AWAITING_CONFIRM',
  'IN_CARE',
  'RETURN_IN_PROGRESS',
  'RETURN_AWAITING_CONFIRM',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'DISPUTED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// DRAFT không hủy được (khách cứ bỏ đó — chưa ai thấy đơn); trạng thái cuối không đi đâu nữa.
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ['PENDING_PROVIDER'],
  PENDING_PROVIDER: ['AGREEMENT_PENDING', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  AGREEMENT_PENDING: ['AWAITING_PAYMENT', 'CANCELLED'],
  AWAITING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['HANDOVER_IN_PROGRESS', 'CANCELLED'],
  HANDOVER_IN_PROGRESS: ['HANDOVER_AWAITING_CONFIRM', 'CANCELLED'],
  // CANCELLED: khách không giao cây, hoặc vườn không nộp tiền bảo đảm (tự bấm huỷ / quá 2 giờ).
  HANDOVER_AWAITING_CONFIRM: ['IN_CARE', 'CANCELLED'],
  IN_CARE: ['RETURN_IN_PROGRESS'],
  // Về lại IN_CARE khi vườn hủy phiên trả (khách vắng nhà) để hẹn lại.
  RETURN_IN_PROGRESS: ['RETURN_AWAITING_CONFIRM', 'IN_CARE'],
  RETURN_AWAITING_CONFIRM: ['COMPLETED', 'DISPUTED'],
  // Phân xử xong thì đơn hoàn tất, kết quả ghi ở bảng tranh chấp.
  DISPUTED: ['COMPLETED'],
  COMPLETED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

// Mọi chuyển trạng thái trong service PHẢI qua hàm này — client không bao giờ set status trực tiếp.
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!ORDER_TRANSITIONS[from].includes(to)) {
    throw new ConflictException('INVALID_STATE_TRANSITION');
  }
}
