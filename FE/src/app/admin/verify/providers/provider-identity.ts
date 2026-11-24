import type { AdminProviderItem } from '@/lib/admin.api';

// Điều kiện BE bắt buộc để duyệt nhà vườn (providers.service verifyProvider):
// 5 thông tin cơ bản (hasCompleteIdentity) + tài khoản ngân hàng đủ 3 trường (hasBankInfo, luật 21/11).
// Không thu số CCCD hay ảnh giấy tờ tuỳ thân.
export const providerPhone = (p: AdminProviderItem) => p.phone || p.account?.phone || null;

export const hasProviderBank = (p: AdminProviderItem) =>
  Boolean(p.bankName?.trim() && p.bankAccount?.trim() && p.bankHolder?.trim());

export const PROVIDER_REQUIREMENT_COUNT = 6;

export function missingProviderRequirements(p: AdminProviderItem): string[] {
  const fields: [string, boolean][] = [
    ['Họ và tên', Boolean(p.account?.fullName?.trim())],
    ['Số điện thoại', Boolean(providerPhone(p)?.trim())],
    ['Địa chỉ thường trú', Boolean(p.address?.trim())],
    ['Ngày sinh', Boolean(p.dateOfBirth?.trim())],
    ['Quê quán', Boolean(p.placeOfOrigin?.trim())],
    ['Tài khoản ngân hàng', hasProviderBank(p)],
  ];
  return fields.filter(([, ok]) => !ok).map(([label]) => label);
}
