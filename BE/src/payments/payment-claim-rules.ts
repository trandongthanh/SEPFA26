import { ConflictException } from '@nestjs/common';
import { suggestedRecipientType } from './unmatched-refund-rules';
import { UnmatchedReason } from './unmatched-reasons';

/**
 * Luật phiếu báo đã chuyển tiền — hàm thuần, không chạm DB.
 * Ví dụ: chị Lan chuyển 530.000 quên ghi mã đơn → nộp phiếu (bên CUSTOMER) kèm 2 ảnh sao kê;
 * admin hoàn khoản tiền chưa khớp kèm phiếu đó → phiếu RESOLVED.
 * Tên CHECK `CHK_payment_claims_status` / `CHK_payment_claims_party` khớp sql/2026-11-25-payment-claims.sql.
 */

export const PAYMENT_CLAIM_STATUSES = ['OPEN', 'RESOLVED', 'REJECTED'] as const;
export type PaymentClaimStatus = (typeof PAYMENT_CLAIM_STATUSES)[number];

// Khách nộp cho tiền đơn / add-on; vườn nộp cho tiền bảo đảm.
export const PAYMENT_CLAIM_PARTIES = ['CUSTOMER', 'PROVIDER'] as const;
export type PaymentClaimParty = (typeof PAYMENT_CLAIM_PARTIES)[number];

// Mỗi bên trên một đơn tối đa 3 phiếu đang mở — chặn spam, vẫn đủ cho vài lần chuyển lỗi.
export const PAYMENT_CLAIM_MAX_OPEN = 3;
export const PAYMENT_CLAIM_MAX_PHOTOS = 3;

/** Người gọi là khách hay vườn của đơn; null = người ngoài đơn (service trả 404 để không lộ đơn). */
export function claimPartyOf(input: {
  accountId: string;
  customerAccountId: string | null;
  providerAccountId: string | null;
}): PaymentClaimParty | null {
  if (input.customerAccountId && input.accountId === input.customerAccountId) {
    return 'CUSTOMER';
  }
  if (input.providerAccountId && input.accountId === input.providerAccountId) {
    return 'PROVIDER';
  }
  return null;
}

/**
 * Phiếu có dùng được để hoàn một khoản tiền chưa khớp không (admin bấm Hoàn kèm phiếu).
 * - Phiếu không còn OPEN → 409 PAYMENT_CLAIM_NOT_OPEN.
 * - Tiền gắn đơn: phiếu phải cùng đơn và đúng bên đã chuyển khoản đó (tiền bảo đảm → vườn,
 *   tiền đơn / add-on → khách), lệch → 409 PAYMENT_CLAIM_MISMATCH.
 * - Tiền không gắn đơn: chỉ cần OPEN — admin đối chiếu ảnh và ghi chú bằng chứng.
 */
export function assertClaimUsableForTransaction(input: {
  claim: {
    status: PaymentClaimStatus;
    serviceOrderId: string;
    party: PaymentClaimParty;
  };
  transaction: {
    serviceOrderId: string | null;
    unmatchedReason: UnmatchedReason | null;
  };
}): void {
  const { claim, transaction } = input;
  if (claim.status !== 'OPEN') {
    throw new ConflictException('PAYMENT_CLAIM_NOT_OPEN');
  }
  if (transaction.serviceOrderId === null) {
    return;
  }
  const expectedParty = suggestedRecipientType(
    transaction.unmatchedReason,
    true,
  );
  if (
    claim.serviceOrderId !== transaction.serviceOrderId ||
    claim.party !== expectedParty
  ) {
    throw new ConflictException('PAYMENT_CLAIM_MISMATCH');
  }
}
