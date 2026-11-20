import type { CustomerVerificationStatus } from '@/lib/admin.api';

// Khách chỉ được xác thực bằng eKYC (AI tự duyệt) — admin không duyệt tay.
// PENDING chỉ còn ở dữ liệu cũ: hồ sơ khách tự khai trước khi chốt xác thực bằng eKYC.
export const CUSTOMER_STATUS: Record<
  CustomerVerificationStatus,
  { color: string; label: string; title: string; description: string }
> = {
  APPROVED: {
    color: 'success',
    label: 'Đã xác thực',
    title: 'Đã xác thực bằng AI eKYC',
    description: 'Đọc thẻ, kiểm tra người thật và so khớp khuôn mặt đều đạt.',
  },
  NOT_SUBMITTED: {
    color: 'default',
    label: 'Chưa xác thực',
    title: 'Chưa xác thực danh tính',
    description: 'Khách chưa làm eKYC trên app nên chưa đặt được gói.',
  },
  REJECTED: {
    color: 'error',
    label: 'eKYC không đạt',
    title: 'eKYC chưa đạt',
    description: 'Khách có thể làm lại eKYC trên app.',
  },
  PENDING: {
    color: 'warning',
    label: 'Tự khai, chưa eKYC',
    title: 'Hồ sơ tự khai, chưa qua eKYC',
    description: 'Khách cần làm eKYC trên app để được xác thực.',
  },
};
