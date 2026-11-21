export const NOTIFICATION_TYPES = [
  // Vòng đời đơn hàng (Order lifecycle)
  'ORDER_SUBMITTED',
  'ORDER_ACCEPTED',
  'ORDER_REJECTED',
  'ORDER_EXPIRED',
  'AGREEMENT_SIGNED_BY_PARTNER',
  'AGREEMENT_COMPLETED',
  'ORDER_PAID',
  'HANDOVER_STARTED',
  'HANDOVER_AWAITING_CONFIRM',
  'HANDOVER_CONFIRMED',
  'SECURITY_DEPOSIT_PAID',
  'ORDER_CANCELLED',
  'RETURN_STARTED',
  'RETURN_AWAITING_CONFIRM',
  'RETURN_CANCELLED',
  'ORDER_COMPLETED',
  // Báo cáo chăm sóc
  'CARE_REPORT_SUBMITTED',
  // Add-on phát sinh
  'ADDON_PROPOSED',
  'ADDON_ACCEPTED',
  'ADDON_REJECTED',
  'ADDON_PAID',
  'ADDON_COMPLETED',
  // Tranh chấp
  'DISPUTE_OPENED',
  'DISPUTE_EVIDENCE_ADDED',
  'DISPUTE_OFFER_CREATED',
  'DISPUTE_OFFER_ACCEPTED',
  'DISPUTE_WITHDRAWN',
  'DISPUTE_ESCALATED',
  'DISPUTE_RESOLVED',
  // Lệnh chi / Giải ngân
  'DISBURSEMENT_PAID',
  // Xác minh hồ sơ / Gói dịch vụ
  'PROVIDER_VERIFIED',
  'CUSTOMER_VERIFIED',
  'PACKAGE_VERIFIED',
  'PROFILE_SUBMITTED_FOR_REVIEW',
  // Cuộc gọi video
  'VIDEO_CALL_MISSED',
  // Thông báo hệ thống / Admin phát
  'SYSTEM_ANNOUNCEMENT',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_REF_ENTITIES = [
  'ORDER',
  'DISPUTE',
  'ADDON',
  'CARE_REPORT',
  'DISBURSEMENT',
  'PROVIDER_PROFILE',
  'CUSTOMER_PROFILE',
  'SERVICE_PACKAGE',
  'VIDEO_CALL',
  'SYSTEM',
] as const;

export type NotificationRefEntity = (typeof NOTIFICATION_REF_ENTITIES)[number];

export const NOTIFICATION_WS_EVENTS = {
  NEW: 'notification.new',
  READ: 'notification.read',
  READ_ALL: 'notification.read_all',
  DELETED: 'notification.deleted',
} as const;

/** Định dạng số tiền VNĐ bằng dấu chấm phân cách hàng nghìn (ví dụ 484000 -> "484.000"), độc lập ICU locale của Node. */
export function formatVnd(amount: string | bigint | number): string {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
