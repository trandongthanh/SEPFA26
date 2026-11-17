import { api } from './api';

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
  phone?: string | null;
  cccdNumber?: string | null;
  cccdFrontUrl: string | null;
  cccdBackUrl: string | null;
  selfieUrl: string | null;
  businessLicenseUrl: string | null;
  canVerify: boolean;
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

export interface AdminCustomerItem {
  id: string;
  accountId: string;
  address: string | null;
  defaultPickupAddress: string | null;
  gpsLat: string | null;
  gpsLng: string | null;
  cccdNumber: string | null;
  cccdFrontUrl: string | null;
  cccdBackUrl: string | null;
  selfieWithIdUrl: string | null;
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  verificationNote: string | null;
  phone: string | null;
  account: AdminAccountInfo;
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

  verifyCustomer: async (customerId: string, payload: VerifyDecisionPayload) => {
    const res = await api.post(`/api/v1/customers/admin/${customerId}/verify`, payload);
    return res.data;
  },

  // --- Khung API cập nhật trạng thái người dùng (ACTIVE / SUSPENDED) ---
  // Ảnh eKYC của khách lưu trên Cloudinary ở chế độ bảo mật — DB chỉ giữ public_id,
  // phải xin link có chữ ký (sống 10 phút) mới xem được.
  getEkycDocumentUrl: async (field: EkycDocumentField, targetAccountId: string) => {
    const res = await api.get<EkycDocumentUrlResponse>(`/api/v1/ekyc/documents/${field}`, {
      params: { targetAccountId },
    });
    return res.data;
  },

  updateUserStatus: async (userId: string, status: 'ACTIVE' | 'SUSPENDED') => {
    const res = await api.patch(`/api/v1/admin/users/${userId}/status`, { status });
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

export interface DisbursementItem {
  id: string;
  orderId: string;
  orderCode: string;
  providerId: string;
  providerName: string;
  type: 'PAYOUT' | 'REFUND';
  amount: string | number;
  eligibleAt: string;
  isEligible: boolean;
  status: DisbursementStatus;
  bank: {
    bankName: string;
    bankAccount: string;
    bankHolder: string;
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

// ===== Ảnh eKYC bảo mật — GET /ekyc/documents/:field?targetAccountId= =====

export type EkycDocumentField = 'front' | 'back' | 'selfie';

export interface EkycDocumentUrlResponse {
  // null với hồ sơ eKYC cũ (trước khi có Cloudinary) — kèm message giải thích.
  url: string | null;
  expiresInSeconds: number;
  message: string;
}
