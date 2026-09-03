export const ROLES = ['CUSTOMER', 'PROVIDER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'PENDING'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
