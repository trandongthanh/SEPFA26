import { ConflictException } from '@nestjs/common';

/**
 * Máy trạng thái SERVICE_ORDER — 10 trạng thái, nguồn chuẩn: docs/state-machines.md §1.
 * Toán thuần (không chạm DB) để unit-test toàn bộ đường đi hợp lệ/cấm.
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
  'REJECTED',
  'CANCELLED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// DRAFT không hủy được (khách cứ bỏ đó — chưa ai thấy đơn); terminal không đi đâu nữa.
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ['PENDING_PROVIDER'],
  PENDING_PROVIDER: ['AGREEMENT_PENDING', 'REJECTED', 'CANCELLED'],
  AGREEMENT_PENDING: ['AWAITING_PAYMENT', 'CANCELLED'],
  AWAITING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['HANDOVER_IN_PROGRESS', 'CANCELLED'],
  HANDOVER_IN_PROGRESS: ['HANDOVER_AWAITING_CONFIRM', 'CANCELLED'],
  HANDOVER_AWAITING_CONFIRM: ['IN_CARE'],
  IN_CARE: [],
  REJECTED: [],
  CANCELLED: [],
};

// Mọi chuyển trạng thái trong service PHẢI qua hàm này — client không bao giờ set status trực tiếp.
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!ORDER_TRANSITIONS[from].includes(to)) {
    throw new ConflictException('INVALID_STATE_TRANSITION');
  }
}
