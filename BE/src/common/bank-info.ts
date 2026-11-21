import { BadRequestException } from '@nestjs/common';

// Tài khoản nhận tiền (tiền hoàn của khách, tiền công + tiền bảo đảm của vườn).
// bankBin (mã BIN 6 số của ngân hàng) không bắt buộc, chỉ đi kèm bộ 3 trường.
export interface BankInfo {
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  bankBin: string | null;
}

export interface BankFields {
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
  bankBin: string | null;
}

// Phần ngân hàng trong DTO hồ sơ: undefined = không gửi; null/'' = muốn xoá.
export interface BankPatch {
  bankName?: string | null;
  bankAccount?: string | null;
  bankHolder?: string | null;
  bankBin?: string | null;
}

// Đủ cả 3 trường mới coi là có tài khoản nhận tiền (thiếu 1 trường thì admin không chuyển được).
export function pickBank(source: BankFields): BankInfo | null {
  const { bankName, bankAccount, bankHolder, bankBin } = source;
  return bankName && bankAccount && bankHolder
    ? { bankName, bankAccount, bankHolder, bankBin: bankBin || null }
    : null;
}

export function hasBankInfo(source: BankFields): boolean {
  return pickBank(source) !== null;
}

const REQUIRED_KEYS = ['bankName', 'bankAccount', 'bankHolder'] as const;

/**
 * Ghi phần ngân hàng của hồ sơ — cho sửa, cấm xoá (chốt 21/11).
 * - Không gửi trường nào → giữ nguyên.
 * - Gửi rỗng/null một trường bắt buộc → 400 BANK_INFO_CANNOT_BE_CLEARED.
 * - Gửi thiếu trường bắt buộc, hoặc bankBin một mình → 400 BANK_INFO_INCOMPLETE.
 * - Đủ bộ 3 → ghi đè cả bộ; bankBin không gửi thì về null (đổi ngân hàng thì BIN cũ sai).
 */
export function applyBankPatch(target: BankFields, patch: BankPatch): void {
  const sent = REQUIRED_KEYS.filter((key) => patch[key] !== undefined);
  if (sent.length === 0 && patch.bankBin === undefined) return;

  if (sent.some((key) => !patch[key])) {
    throw new BadRequestException('BANK_INFO_CANNOT_BE_CLEARED');
  }
  if (sent.length < REQUIRED_KEYS.length) {
    throw new BadRequestException('BANK_INFO_INCOMPLETE');
  }

  target.bankName = patch.bankName!;
  target.bankAccount = patch.bankAccount!;
  target.bankHolder = patch.bankHolder!;
  target.bankBin = patch.bankBin || null;
}
