import { api } from './api';
import type { CareReportItem } from './provider.api';

// ===== TypeScript Interfaces (khớp với BE entity + service response) =====

export interface AdminAccountInfo {
  id: string;
  email: string;
  fullName: string;
  role: 'CUSTOMER' | 'PROVIDER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
  phone: string | null;
}

export interface AdminProviderItem {
  id: string;
  accountId: string;
  providerType: 'NURSERY' | 'EXPERT';
  displayName: string;
  bio: string | null;
  licenseInfo: string | null;
  portfolioUrl: string | null;
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  verificationNote: string | null;
  ratingAvg: string | null;
  address: string | null;
  gpsLat: string | null;
  gpsLng: string | null;
  experience: string | null;
  specialties: string | null;
  serviceAreas: string | null;
  certificates: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
  // Mã BIN 6 số của ngân hàng (không bắt buộc).
  bankBin: string | null;
  phone?: string | null;
  // Người đại diện — không thu số CCCD hay ảnh giấy tờ tuỳ thân.
  dateOfBirth: string | null;
  placeOfOrigin: string | null;
  businessLicenseUrl: string | null;
  cancelledOrderCount?: number;
  // Chỉ có ở GET /admin/providers (danh sách).
  canVerify?: boolean;
  account: AdminAccountInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProviderDetailResponse {
  provider: AdminProviderItem;
  packages: AdminServicePackage[];
}

export interface AdminServicePackage {
  id: string;
  providerId: string;
  name: string;
  description: string | null;
  durationDays: number;
  reportFrequencyDays: number;
  maxPlants: number;
  basePrice: string;
  minDeclaredValue: string | null;
  maxDeclaredValue: string | null;
  isActive: boolean;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string | null;
  createdAt: string;
}

// GET /admin/providers/packages — mỗi gói kèm hồ sơ nhà vườn (relation provider).
export interface AdminPackageWithProvider extends AdminServicePackage {
  provider: Pick<AdminProviderItem, 'id' | 'displayName' | 'verificationStatus'> | null;
}

// NOT_SUBMITTED: chưa làm eKYC · APPROVED: eKYC đạt · REJECTED: eKYC không đạt.
// PENDING chỉ còn ở dữ liệu cũ (hồ sơ tự khai trước khi chốt xác thực bằng eKYC).
export type CustomerVerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';

// GET /customers/admin(/:id) — không còn số CCCD hay ảnh; danh tính lấy từ eKYC.
export interface AdminCustomerItem {
  id: string;
  accountId: string;
  // Địa chỉ thường trú (eKYC đọc từ thẻ).
  address: string | null;
  defaultPickupAddress: string | null;
  gpsLat: string | null;
  gpsLng: string | null;
  dateOfBirth: string | null;
  placeOfOrigin: string | null;
  verificationStatus: CustomerVerificationStatus;
  verificationNote: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
  bankBin: string | null;
  lostDisputeCount: number;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  account: AdminAccountInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface VerifyDecisionPayload {
  decision: 'APPROVED' | 'REJECTED';
  note?: string;
}

// ===== Admin API Functions =====

export const adminApi = {
  // --- Provider ---
  listProviders: async () => {
    const res = await api.get<AdminProviderItem[]>('/api/v1/admin/providers');
    return res.data;
  },

  getProviderDetail: async (providerId: string) => {
    const res = await api.get<AdminProviderDetailResponse>(`/api/v1/admin/providers/${providerId}`);
    return res.data;
  },

  verifyProvider: async (providerId: string, payload: VerifyDecisionPayload) => {
    const res = await api.post(`/api/v1/admin/providers/${providerId}/verify`, payload);
    return res.data;
  },

  listAllPackages: async () => {
    const res = await api.get<AdminPackageWithProvider[]>('/api/v1/admin/providers/packages');
    return res.data;
  },

  verifyPackage: async (
    packageId: string,
    payload: { isActive?: boolean; decision?: 'APPROVED' | 'REJECTED'; note?: string },
  ) => {
    const res = await api.post(`/api/v1/admin/providers/packages/${packageId}/verify`, payload);
    return res.data;
  },

  // --- Customer ---
  listCustomers: async () => {
    const res = await api.get<AdminCustomerItem[]>('/api/v1/customers/admin');
    return res.data;
  },

  getCustomerDetail: async (customerId: string) => {
    const res = await api.get<AdminCustomerItem>(`/api/v1/customers/admin/${customerId}`);
    return res.data;
  },

  resetProviderPassword: async (providerId: string) => {
    const res = await api.post<{ tempPassword: string }>(
      `/api/v1/admin/providers/${providerId}/reset-password`,
    );
    return res.data;
  },

  deleteProvider: async (providerId: string) => {
    const res = await api.delete<{ success: boolean; message: string }>(
      `/api/v1/admin/providers/${providerId}`,
    );
    return res.data;
  },

  // --- Bảng phí lấy cây (Shipping rates) ---
  listShippingRates: async () => {
    const res = await api.get<ShippingRate[]>('/api/v1/admin/shipping-rates');
    return res.data;
  },

  replaceShippingRates: async (rates: ShippingRateInput[]) => {
    const res = await api.put<ShippingRate[]>('/api/v1/admin/shipping-rates', { rates });
    return res.data;
  },

  // --- Bằng chứng của đơn: báo cáo chăm sóc + add-on (admin được xem mọi đơn) ---
  listOrderCareReports: async (serviceOrderId: string) => {
    const res = await api.get<CareReportItem[]>('/api/v1/care-reports', {
      params: { serviceOrderId },
    });
    return res.data;
  },

  listOrderAddons: async (orderId: string) => {
    const res = await api.get<OrderAddonItem[]>(`/api/v1/orders/${orderId}/addons`);
    return res.data;
  },

  // --- Tranh chấp (Disputes) ---
  listDisputes: async (params?: {
    status?: DisputeStatus;
    page?: number;
    limit?: number;
  }) => {
    const res = await api.get<DisputeListResponse>('/api/v1/admin/disputes', { params });
    return res.data;
  },

  getDispute: async (disputeId: string) => {
    const res = await api.get<AdminDisputeDetail>(`/api/v1/admin/disputes/${disputeId}`);
    return res.data;
  },

  resolveDispute: async (disputeId: string, payload: ResolveDisputePayload) => {
    const res = await api.post<ResolveDisputeResult>(
      `/api/v1/admin/disputes/${disputeId}/resolve`,
      payload,
    );
    return res.data;
  },

  // --- Giải ngân cho nhà vườn (Disbursements) ---
  listDisbursements: async (params?: {
    status?: 'PENDING' | 'PAID';
    page?: number;
    limit?: number;
  }) => {
    const res = await api.get<DisbursementListResponse>('/api/v1/admin/disbursements', {
      params,
    });
    return res.data;
  },

  markDisbursementPaid: async (
    id: string,
    payload: { transferCode: string; note?: string },
  ) => {
    const res = await api.post<DisbursementItem>(
      `/api/v1/admin/disbursements/${id}/mark-paid`,
      payload,
    );
    return res.data;
  },
};

export type DisbursementStatus = 'PENDING' | 'PAID';

// Loại lệnh chi BE tạo khi đơn kết thúc (payments/settle-order.ts).
export type DisbursementType =
  | 'PAYOUT' // tiền công còn lại → vườn
  | 'SECURITY_RETURN' // trả lại tiền bảo đảm → vườn
  | 'DECLARED_FORFEIT' // tiền bảo đảm khai giá của khách → vườn (khách khiếu nại sai)
  | 'REFUND' // hoàn tiền công + 6% → khách
  | 'COMPENSATION' // đền giá trị cây → khách
  | 'DECLARED_RETURN'; // trả lại tiền bảo đảm khai giá → khách

export type DisbursementRecipient = 'CUSTOMER' | 'PROVIDER';

export interface DisbursementItem {
  id: string;
  orderId: string;
  orderCode: string;
  recipient: DisbursementRecipient;
  // Tên người nhận đúng bên: tên vườn hoặc họ tên khách.
  recipientName: string | null;
  customerId: string | null;
  // Lệnh của khách thì providerId / providerName là null.
  providerId: string | null;
  providerName: string | null;
  type: DisbursementType;
  amount: string | number;
  eligibleAt: string;
  isEligible: boolean;
  status: DisbursementStatus;
  bank: {
    bankName: string;
    bankAccount: string;
    bankHolder: string;
    bankBin: string | null;
  } | null;
  transferCode: string | null;
  paidAt: string | null;
  note: string | null;
}

export interface DisbursementListResponse {
  data: DisbursementItem[];
  total: number;
  page: number;
  limit: number;
}

// ===== Tranh chấp (Disputes) — khớp BE disputes.service listForAdmin / getForAdmin / resolve =====

export type DisputeStatus = 'NEGOTIATING' | 'ADMIN_REVIEW' | 'RESOLVED';
export type DisputeOutcome = 'AGREED' | 'WITHDRAWN' | 'ADJUDICATED';
export type DisputeVerdict = 'NOT_AT_FAULT' | 'SERVICE_FAULT' | 'VALUE_LOST';
export type DisputeParty = 'CUSTOMER' | 'PROVIDER';

export interface DisputeListItem {
  id: string;
  orderId: string;
  orderCode: string;
  status: DisputeStatus;
  outcome: DisputeOutcome | null;
  reason: string;
  openedAt: string;
  negotiationDueAt: string;
  escalatedAt: string | null;
  adminDueAt: string | null;
  resolvedAt: string | null;
  refundAmount: string | null;
  compensationAmount: string | null;
  isOverdue: boolean;
}

export interface DisputeListResponse {
  data: DisputeListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface DisputeEvidenceItem {
  id: string;
  plantId: string | null;
  photoUrl: string;
  caption: string | null;
  note: string | null;
  createdAt: string;
}

export interface DisputeOfferItem {
  id: string;
  proposedBy: DisputeParty;
  refundAmount: string;
  compensationAmount: string;
  customerReceives: string;
  message: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'SUPERSEDED';
  respondedAt: string | null;
  createdAt: string;
}

export interface DisputeHandoverView {
  status: string;
  customerConfirmDueAt: string | null;
  confirmedAt: string | null;
  assessments: {
    id: string;
    plantId: string | null;
    checklist: Record<string, unknown>;
    note: string | null;
    assessedAt: string;
    photos: { photoUrl: string; caption: string | null }[];
  }[];
}

export interface AdminDisputeDetail {
  id: string;
  orderId: string;
  status: DisputeStatus;
  outcome: DisputeOutcome | null;
  reason: string;
  description: string;
  openedAt: string;
  negotiationDueAt: string;
  escalatedAt: string | null;
  adminDueAt: string | null;
  resolvedAt: string | null;
  isOverdue: boolean;
  plants: {
    plantId: string;
    name: string | null;
    compensationCap: string | null;
    verdict: DisputeVerdict | null;
  }[];
  evidence: { customer: DisputeEvidenceItem[]; provider: DisputeEvidenceItem[] };
  handoverObjection: {
    note: string | null;
    photos: { photoUrl: string; caption: string | null; createdAt: string }[];
  } | null;
  offers: DisputeOfferItem[];
  caps: { refundCap: string; compensationCap: string } | null;
  refundAmount: string | null;
  compensationAmount: string | null;
  customerReceives: string | null;
  // Tiền bảo đảm khai giá của khách chuyển sang vườn (admin phán vườn không lỗi); chưa xong → null, không có → "0".
  declaredForfeitAmount?: string | null;
  resolvedByAccountId: string | null;
  resolutionNote: string | null;
  order: {
    id: string;
    orderCode: string;
    status: string;
    basePrice: string | null;
    finalTotal: string | null;
    pickupFee: string | null;
    careStartedAt: string | null;
    careDueAt: string | null;
  };
  customer: { id: string; fullName: string | null; lostDisputeCount: number };
  provider: { id: string; displayName: string | null };
  orderPlants: {
    plantId: string;
    name: string;
    speciesName: string | null;
    isValueDeclared: boolean;
    declaredValue: string | null;
    compensationCap: string | null;
    handoverDecision: 'ACCEPT' | 'ACCEPT_HIGH_RISK' | 'REJECT' | null;
    isHighRisk: boolean;
  }[];
  handoverIn: DisputeHandoverView | null;
  handoverOut: DisputeHandoverView | null;
  careReports: {
    submittedCount: number;
    reports: {
      id: string;
      periodIndex: number;
      periodStart: string;
      periodEnd: string;
      submittedAt: string | null;
    }[];
  };
}

export interface ResolveDisputePayload {
  plants: { plantId: string; verdict: DisputeVerdict }[];
  note: string;
}

export interface ResolveDisputeResult {
  status: DisputeStatus;
  outcome: DisputeOutcome | null;
  refundAmount: string | null;
  compensationAmount: string | null;
}

// ===== Bảng phí lấy cây — khớp BE ShippingRate entity / ReplaceShippingRatesDto =====
// Số trả về là string (numeric/bigint của Postgres); gửi lên là number.

export interface ShippingRate {
  id: string;
  minKm: string;
  maxKm: string | null;
  baseFee: string;
  perKmFee: string;
  billingUnitKm: string | null;
  isActive: boolean;
}

export interface ShippingRateInput {
  minKm: number;
  maxKm: number | null;
  baseFee: number;
  perKmFee: number;
  billingUnitKm: number | null;
  isActive?: boolean;
}

// ===== Add-on của đơn — GET /orders/:orderId/addons (khớp BE addons.service toViews) =====

export type AddonStatus = 'PENDING' | 'ACCEPTED' | 'PAID' | 'DONE' | 'REJECTED' | 'EXPIRED';

export interface OrderAddonItem {
  id: string;
  orderId: string;
  addonCode: string;
  title: string;
  reason: string | null;
  photoUrls: string[] | null;
  plant: { id: string; name: string | null } | null;
  price: string;
  customerFee: string;
  amountDue: string;
  status: AddonStatus;
  respondDueAt: string | null;
  decidedAt: string | null;
  customerNote: string | null;
  paymentDueAt: string | null;
  paidAt: string | null;
  doneAt: string | null;
  donePhotoUrls: string[] | null;
  doneNote: string | null;
  donePlantHealth: 'GOOD' | 'AVERAGE' | 'POOR' | null;
  expiredReason: 'NO_RESPONSE' | 'NOT_PAID' | 'ORDER_RETURNING' | null;
  expiredAt: string | null;
  createdAt: string;
}
