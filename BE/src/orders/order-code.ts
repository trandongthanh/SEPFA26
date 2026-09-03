import { randomBytes } from 'crypto';

/**
 * Mã đơn LANCARE + 8 hex hoa — vừa là mã tra cứu, vừa là NỘI DUNG CHUYỂN KHOẢN
 * để webhook SePay map tiền về đúng đơn (docs/sequence-diagrams/payments-sepay-webhook.md).
 * Toán thuần để unit-test không cần DB.
 */
export const ORDER_CODE_PREFIX = 'LANCARE';

// 4 byte ngẫu nhiên = 8 hex ≈ 4,3 tỷ mã — trùng cực hiếm; đã có UNIQUE ở DB + retry ở service.
export function generateOrderCode(): string {
  return ORDER_CODE_PREFIX + randomBytes(4).toString('hex').toUpperCase();
}

// Tìm mã đơn trong nội dung CK thật (ngân hàng thêm tiền tố/hậu tố, có thể viết thường).
export function extractOrderCode(content: string): string | null {
  const match = /LANCARE[0-9A-F]{8}/i.exec(content);
  return match ? match[0].toUpperCase() : null;
}

// Mã hợp đồng — cùng cơ chế mã đơn, tiền tố AGR (tham chiếu pháp lý trên bản ký).
export function generateAgreementNo(): string {
  return 'AGR' + randomBytes(4).toString('hex').toUpperCase();
}
