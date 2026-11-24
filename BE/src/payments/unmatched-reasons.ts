/**
 * Lý do tiền thật đã vào tài khoản nền tảng nhưng KHÔNG ghi nhận được vào đơn (dòng `transactions`
 * PENDING, "hộp tiền chưa khớp"). Admin đọc lý do để biết trả lại cho ai.
 * Tên ràng buộc `CHK_transactions_unmatched_reason` khớp sql/2026-11-23-payment-refunds.sql.
 */
export const UNMATCHED_REASONS = [
  // Nội dung chuyển khoản không có mã đơn / mã add-on / mã bảo đảm nào.
  'NO_CODE',
  // Có mã nhưng không khớp đơn / đề xuất add-on / khoản bảo đảm nào.
  'CODE_NOT_FOUND',
  // Đơn chưa tới bước trả tiền, đã trả rồi (trả 2 lần) hoặc đã huỷ.
  'ORDER_NOT_AWAITING_PAYMENT',
  // Tiền về sau hạn thanh toán (luôn hoàn, BR-147).
  'PAYMENT_DEADLINE_PASSED',
  // Chuyển thiếu tiền đơn (không nhận một phần, hoàn nguyên khoản).
  'INSUFFICIENT_AMOUNT',
  // Add-on quá hạn trả / đã trả / đã đóng.
  'ADDON_NOT_PAYABLE',
  'ADDON_INSUFFICIENT',
  // Tiền bảo đảm của vườn: khoản đã nộp / đã huỷ, về trễ sau 2 giờ, nộp thiếu.
  'DEPOSIT_NOT_PENDING',
  'DEPOSIT_EXPIRED',
  'DEPOSIT_INSUFFICIENT',
] as const;
export type UnmatchedReason = (typeof UNMATCHED_REASONS)[number];

// Lý do ở nhánh add-on: transaction nội bộ trả mã ngắn, đổi sang mã lưu DB.
export function addonUnmatchedReason(
  ignored: 'ADDON_NOT_PAYABLE' | 'INSUFFICIENT_AMOUNT',
): UnmatchedReason {
  return ignored === 'INSUFFICIENT_AMOUNT'
    ? 'ADDON_INSUFFICIENT'
    : 'ADDON_NOT_PAYABLE';
}

// Lý do ở nhánh tiền bảo đảm của vườn.
export function depositUnmatchedReason(
  ignored:
    | 'SECURITY_DEPOSIT_NOT_PENDING'
    | 'SECURITY_DEPOSIT_EXPIRED'
    | 'INSUFFICIENT_AMOUNT',
): UnmatchedReason {
  if (ignored === 'SECURITY_DEPOSIT_EXPIRED') {
    return 'DEPOSIT_EXPIRED';
  }
  if (ignored === 'INSUFFICIENT_AMOUNT') {
    return 'DEPOSIT_INSUFFICIENT';
  }
  return 'DEPOSIT_NOT_PENDING';
}

// Tiền của vườn (nộp bảo đảm) thì trả vườn; còn lại là tiền khách (đơn, add-on).
export function isProviderMoney(reason: UnmatchedReason | null): boolean {
  return (
    reason === 'DEPOSIT_NOT_PENDING' ||
    reason === 'DEPOSIT_EXPIRED' ||
    reason === 'DEPOSIT_INSUFFICIENT'
  );
}
