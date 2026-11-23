import { BadRequestException } from '@nestjs/common';
import { BankInfo } from '../common/bank-info';
import { isProviderMoney, UnmatchedReason } from './unmatched-reasons';

/**
 * Luật admin hoàn một khoản tiền chưa khớp — hàm thuần, không chạm DB.
 * Ví dụ: khách chuyển thiếu 400.000 cho đơn LANCARE7A2B9C1D → gợi ý trả khách, TK trong hồ sơ khách;
 * admin bấm Hoàn không sửa gì → lệnh chi gắn khách, không cần ghi chú.
 * Tiền không mã 250.000 → không có gợi ý → admin PHẢI nhập TK + ghi chú bằng chứng.
 */

export type RecipientType = 'CUSTOMER' | 'PROVIDER';

// Ai nhiều khả năng là người chuyển: tiền bảo đảm → vườn của đơn; tiền đơn / add-on → khách; không có đơn → không biết.
export function suggestedRecipientType(
  reason: UnmatchedReason | null,
  hasOrder: boolean,
): RecipientType | null {
  if (!hasOrder) return null;
  return isProviderMoney(reason) ? 'PROVIDER' : 'CUSTOMER';
}

export interface RefundTargetInput {
  hasOrder: boolean;
  // Người nhận gợi ý + tài khoản trong hồ sơ của họ (null nếu hồ sơ chưa đủ bộ 3).
  suggested: { type: RecipientType; id: string; bank: BankInfo | null } | null;
  // Tài khoản admin nhập tay (đủ bộ 3) — null = dùng tài khoản gợi ý.
  requestedBank: BankInfo | null;
  note: string | null;
}

export interface RefundTarget {
  bank: BankInfo;
  customerId: string | null;
  providerId: string | null;
  // Admin đổi tài khoản khác tài khoản gợi ý.
  overridden: boolean;
}

function sameAccount(a: BankInfo, b: BankInfo): boolean {
  return (
    a.bankName === b.bankName &&
    a.bankAccount === b.bankAccount &&
    a.bankHolder === b.bankHolder
  );
}

/**
 * Chọn tài khoản đích + người nhận cho lệnh UNMATCHED_REFUND.
 * - Không có TK nào (không gợi ý, admin không nhập) → 400 REFUND_BANK_INFO_REQUIRED.
 * - Không gắn đơn, hoặc admin đổi TK khác gợi ý → bắt buộc ghi chú (400 RESOLUTION_NOTE_REQUIRED):
 *   ca rủi ro (người lạ, chiêu "chuyển nhầm") phải có bằng chứng.
 * - Chỉ gắn khách/vườn vào lệnh khi dùng đúng TK trong hồ sơ của họ.
 */
export function resolveRefundTarget(input: RefundTargetInput): RefundTarget {
  const suggestedBank = input.suggested?.bank ?? null;
  const bank = input.requestedBank ?? suggestedBank;
  if (!bank) {
    throw new BadRequestException('REFUND_BANK_INFO_REQUIRED');
  }
  const overridden =
    input.requestedBank !== null &&
    (suggestedBank === null ||
      !sameAccount(input.requestedBank, suggestedBank));
  if ((!input.hasOrder || overridden) && !input.note) {
    throw new BadRequestException('RESOLUTION_NOTE_REQUIRED');
  }
  const linked = overridden ? null : input.suggested;
  return {
    bank,
    customerId: linked?.type === 'CUSTOMER' ? linked.id : null,
    providerId: linked?.type === 'PROVIDER' ? linked.id : null,
    overridden,
  };
}
