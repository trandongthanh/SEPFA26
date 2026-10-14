export const ROLES = ['CUSTOMER', 'PROVIDER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

// ADMIN không bao giờ tự đăng ký qua API public (thường hay Google).
export const SELF_REGISTER_ROLES = ['CUSTOMER', 'PROVIDER'] as const;
export type SelfRegisterRole = (typeof SELF_REGISTER_ROLES)[number];

export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'PENDING'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
