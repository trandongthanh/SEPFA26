import { ConflictException } from '@nestjs/common';
import { randomBytes } from 'crypto';

/**
 * Luật của đề xuất add-on (dịch vụ phát sinh lúc đang chăm) — toán thuần, không chạm DB.
 * Vòng đời: PENDING → ACCEPTED → PAID → DONE; PENDING → REJECTED; PENDING / ACCEPTED → EXPIRED.
 * Ví dụ đơn mẫu: vườn đề xuất "Thay giá thể" 100.000 → khách đồng ý trong 48 giờ → chuyển 106.000
 * (thêm 6%) trong 24 giờ → vườn làm, báo xong → tiền chia cùng đơn khi COMPLETED.
 */
export const ADDON_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'PAID',
  'DONE',
  'REJECTED',
  'EXPIRED',
] as const;
export type AddonStatus = (typeof ADDON_STATUSES)[number];

// Đề xuất còn "đang mở" — tính vào giới hạn số đề xuất và chấm báo trên chi tiết đơn.
export const ADDON_OPEN_STATUSES: readonly AddonStatus[] = [
  'PENDING',
  'ACCEPTED',
  'PAID',
];

// NO_RESPONSE: khách im lặng quá 48 giờ. NOT_PAID: đồng ý nhưng quá 24 giờ chưa chuyển tiền.
// ORDER_RETURNING: vườn bắt đầu trả cây khi đề xuất còn chưa trả tiền.
export const ADDON_EXPIRED_REASONS = [
  'NO_RESPONSE',
  'NOT_PAID',
  'ORDER_RETURNING',
] as const;
export type AddonExpiredReason = (typeof ADDON_EXPIRED_REASONS)[number];

const HOUR_MS = 60 * 60 * 1000;
export const ADDON_RESPOND_HOURS = 48;
export const ADDON_PAYMENT_HOURS = 24;
export const ADDON_MIN_PRICE = 1_000n;
export const ADDON_MAX_PRICE = 50_000_000n;
export const ADDON_MAX_OPEN_PER_ORDER = 3;
export const ADDON_MAX_PHOTOS = 5;

export const ADDON_TRANSITIONS: Record<AddonStatus, readonly AddonStatus[]> = {
  PENDING: ['ACCEPTED', 'REJECTED', 'EXPIRED'],
  ACCEPTED: ['PAID', 'EXPIRED'],
  PAID: ['DONE'],
  DONE: [],
  REJECTED: [],
  EXPIRED: [],
};

// Mọi lần đổi trạng thái đề xuất phải qua hàm này; ngoài bảng → 409.
export function assertAddonTransition(from: AddonStatus, to: AddonStatus) {
  if (!ADDON_TRANSITIONS[from].includes(to)) {
    throw new ConflictException('ADDON_INVALID_STATE');
  }
}

export function respondDueAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + ADDON_RESPOND_HOURS * HOUR_MS);
}

export function paymentDueAt(acceptedAt: Date): Date {
  return new Date(acceptedAt.getTime() + ADDON_PAYMENT_HOURS * HOUR_MS);
}

/**
 * Đề xuất đã quá hạn chưa? Trả lý do hết hạn, hoặc null nếu còn hạn / không còn chờ ai.
 * Chưa có tác vụ hẹn giờ nên mọi route và webhook gọi hàm này lúc chạm vào đề xuất.
 */
export function overdueReason(
  proposal: {
    status: AddonStatus;
    respondDueAt: Date;
    paymentDueAt: Date | null;
  },
  now: Date,
): AddonExpiredReason | null {
  if (
    proposal.status === 'PENDING' &&
    now.getTime() > proposal.respondDueAt.getTime()
  ) {
    return 'NO_RESPONSE';
  }
  if (
    proposal.status === 'ACCEPTED' &&
    proposal.paymentDueAt &&
    now.getTime() > proposal.paymentDueAt.getTime()
  ) {
    return 'NOT_PAID';
  }
  return null;
}

/**
 * Mã add-on = nội dung chuyển khoản của riêng đề xuất đó: ADDON + 8 hex hoa.
 * Cố ý không trùng mẫu mã đơn LANCARE + 8 hex (chữ O không phải hex) → webhook chỉ cần
 * nhìn nội dung chuyển khoản là biết tiền của đơn hay của add-on.
 */
export const ADDON_CODE_PREFIX = 'ADDON';

export function generateAddonCode(): string {
  return ADDON_CODE_PREFIX + randomBytes(4).toString('hex').toUpperCase();
}

// Ngân hàng hay thêm tiền tố / hậu tố và đổi chữ thường → tìm mã ở bất kỳ đâu trong nội dung.
export function extractAddonCode(content: string): string | null {
  const match = /ADDON[0-9A-F]{8}/i.exec(content);
  return match ? match[0].toUpperCase() : null;
}
