import { api } from './api';

export interface ProviderProfileResponse {
  id: string;
  accountId: string;
  providerType: 'NURSERY' | 'EXPERT';
  displayName: string;
  bio?: string | null;
  licenseInfo?: string | null;
  portfolioUrl?: string | null;
  selfieUrl?: string | null;
  cccdFrontUrl?: string | null;
  cccdBackUrl?: string | null;
  businessLicenseUrl?: string | null;
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  verificationNote?: string | null;
  ratingAvg?: string | null;
  address?: string | null;
  gpsLat?: string | null;
  gpsLng?: string | null;
  experience?: string | null;
  specialties?: string | null;
  serviceAreas?: string | null;
  certificates?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  bankHolder?: string | null;
  phone?: string | null;
  cccdNumber?: string | null;
  account?: {
    id: string;
    fullName: string;
    email: string;
    phone?: string;
    role: string;
  } | null;
}

export interface UpsertProfilePayload {
  providerType?: 'NURSERY' | 'EXPERT';
  displayName?: string;
  bio?: string;
  licenseInfo?: string;
  portfolioUrl?: string;
  phone?: string;
  cccdNumber?: string;
  selfieUrl?: string;
  cccdFrontUrl?: string;
  cccdBackUrl?: string;
  businessLicenseUrl?: string;
  address?: string;
  gpsLat?: number;
  gpsLng?: number;
  experience?: string;
  specialties?: string;
  serviceAreas?: string;
  certificates?: string;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
}

export type OrderStatus =
  | 'DRAFT'
  | 'PENDING_PROVIDER'
  | 'AGREEMENT_PENDING'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'HANDOVER_IN_PROGRESS'
  | 'HANDOVER_AWAITING_CONFIRM'
  | 'IN_CARE'
  | 'RETURN_IN_PROGRESS'
  | 'RETURN_AWAITING_CONFIRM'
  | 'COMPLETED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'DISPUTED';

export interface CareReportSchedule {
  nextReportDueAt: string | null;
  isReportOverdue: boolean;
  submittedCount: number;
  expectedCount: number;
  totalPeriods: number;
}

export interface OrderPlantSummary {
  id: string;
  name: string;
  speciesName?: string | null;
  handoverDecision?: string | null;
}

export interface OrderItem {
  id: string;
  orderCode: string;
  status: OrderStatus | string;
  provisionalTotal: string;
  finalTotal?: string;
  scheduledPickupAt: string;
  careDueAt?: string | null;
  careReportSchedule?: CareReportSchedule | null;
  plants?: OrderPlantSummary[];
  customer?: {
    account?: {
      fullName?: string;
    };
  };
  servicePackage?: {
    name?: string;
  };
  createdAt: string;
}

export interface ServicePackageItem {
  id: string;
  name: string;
  description?: string;
  durationDays: number;
  reportFrequencyDays: number;
  maxPlants: number;
  basePrice: string | number;
  minDeclaredValue: string | number;
  maxDeclaredValue: string | number;
  isActive?: boolean;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  pricePerMonth?: string;
  status?: string;
  createdAt?: string;
}

export interface CreatePackagePayload {
  name: string;
  description: string;
  durationDays: number;
  reportFrequencyDays: number;
  maxPlants: number;
  basePrice: number;
  minDeclaredValue: number;
  maxDeclaredValue: number;
  isActive?: boolean;
}

export type SubstrateMoisture = 'LOW' | 'MEDIUM' | 'HIGH';
export type PartCondition = 'GOOD' | 'NORMAL' | 'POOR';
export type OverallHealth = 'GOOD' | 'AVERAGE' | 'POOR';
export type CareEvidenceType = 'OVERVIEW' | 'LEAF' | 'STEM' | 'ROOT';

export interface CareReportPhotoItem {
  id?: string;
  evidenceType: CareEvidenceType;
  photoUrl: string;
  caption?: string | null;
}

export interface CareReportPlantItem {
  id?: string;
  plant: {
    id: string;
    name: string | null;
    speciesName: string | null;
  };
  substrateMoisture: SubstrateMoisture;
  leafCondition: PartCondition;
  rootCondition: PartCondition;
  stemCondition: PartCondition;
  hasPestDisease: boolean;
  overallHealth: OverallHealth;
  note?: string | null;
  leafLengthCm?: number | null;
  leafCount?: number | null;
  newRootLengthCm?: number | null;
  newShootCount?: number | null;
  flowerSpikeCount?: number | null;
  budCount?: number | null;
  flowerCount?: number | null;
  photos: CareReportPhotoItem[];
}

export interface CareReportItem {
  id: string;
  serviceOrderId: string;
  periodIndex: number;
  periodStart: string;
  periodEnd: string;
  submittedAt: string;
  isLate: boolean;
  airTemperature: number;
  airHumidity: number;
  lightIntensity: number;
  watered: boolean;
  waterAmountMl?: number | null;
  fertilized: boolean;
  fertilizerType?: string | null;
  otherCareNote?: string | null;
  waterPh?: number | null;
  waterEc?: number | null;
  plants: CareReportPlantItem[];
}

export interface CreateCareReportPhotoPayload {
  evidenceType: CareEvidenceType;
  photoUrl: string;
  caption?: string;
}

export interface CreateCareReportPlantPayload {
  plantId: string;
  substrateMoisture: SubstrateMoisture;
  leafCondition: PartCondition;
  rootCondition: PartCondition;
  stemCondition: PartCondition;
  hasPestDisease: boolean;
  overallHealth: OverallHealth;
  note?: string;
  leafLengthCm?: number;
  leafCount?: number;
  newRootLengthCm?: number;
  newShootCount?: number;
  flowerSpikeCount?: number;
  budCount?: number;
  flowerCount?: number;
  photos: CreateCareReportPhotoPayload[];
}

export interface CreateCareReportPayload {
  serviceOrderId: string;
  airTemperature: number;
  airHumidity: number;
  lightIntensity: number;
  watered: boolean;
  waterAmountMl?: number;
  fertilized: boolean;
  fertilizerType?: string;
  otherCareNote?: string;
  waterPh?: number;
  waterEc?: number;
  plants: CreateCareReportPlantPayload[];
}

export interface CreateCareReportResponse {
  id: string;
  serviceOrderId: string;
  periodIndex: number;
  periodStart: string;
  periodEnd: string;
  isLate: boolean;
  submittedAt: string;
}

export const providerApi = {
  // Lấy hồ sơ Provider hiện tại
  getProfile: async () => {
    const res = await api.get<ProviderProfileResponse>('/api/v1/providers/me');
    return res.data;
  },

  // Danh sách đơn hàng phía Provider
  listOrders: async (status?: string) => {
    const params = status ? { status } : {};
    const res = await api.get<any>('/api/v1/orders', { params });
    const raw = res.data;
    const items: OrderItem[] = Array.isArray(raw)
      ? raw
      : raw?.items
      ? raw.items
      : raw?.data
      ? raw.data
      : [];
    return {
      items,
      total: raw?.total ?? items.length,
    };
  },

  // Chi tiết đơn hàng phía Provider
  getOrderDetail: async (orderId: string) => {
    const res = await api.get<any>(`/api/v1/orders/${orderId}`);
    return res.data;
  },

  // Quyết định đơn hàng (Chấp nhận / Từ chối)
  respondNegotiation: async (orderId: string, action: 'ACCEPT' | 'REJECT', note?: string) => {
    const payload: { response: 'ACCEPT' | 'REJECT'; providerNote?: string } = {
      response: action,
    };
    if (note && note.trim()) {
      payload.providerNote = note.trim();
    }
    const res = await api.post(`/api/v1/orders/${orderId}/negotiation/respond`, payload);
    return res.data;
  },

  // Ký hợp đồng dịch vụ (POST /api/v1/orders/:orderId/agreement/sign)
  signAgreement: async (orderId: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/agreement/sign`, {});
    return res.data;
  },

  // Danh sách gói dịch vụ của tôi
  listMyPackages: async () => {
    const res = await api.get<ServicePackageItem[]>('/api/v1/providers/me/packages');
    return res.data;
  },

  // Tạo mới gói dịch vụ
  createPackage: async (payload: CreatePackagePayload) => {
    const res = await api.post<ServicePackageItem>('/api/v1/providers/me/packages', payload);
    return res.data;
  },

  // Xóa gói dịch vụ
  deletePackage: async (packageId: string) => {
    await api.delete(`/api/v1/providers/me/packages/${packageId}`);
  },

  // Danh sách báo cáo chăm sóc
  listCareReports: async (serviceOrderId?: string) => {
    const params = serviceOrderId ? { serviceOrderId } : undefined;
    const res = await api.get<CareReportItem[] | { items?: CareReportItem[] }>('/api/v1/care-reports', { params });
    return Array.isArray(res.data) ? res.data : res.data?.items ?? [];
  },

  // Chi tiết báo cáo chăm sóc
  getCareReport: async (id: string) => {
    const res = await api.get<CareReportItem>(`/api/v1/care-reports/${id}`);
    return res.data;
  },

  // Nộp báo cáo chăm sóc mới
  createCareReport: async (payload: CreateCareReportPayload) => {
    const res = await api.post<CreateCareReportResponse>('/api/v1/care-reports', payload);
    return res.data;
  },

  // Cập nhật hoặc tạo mới hồ sơ Provider (PUT /api/v1/providers/me/profile)
  upsertProfile: async (payload: UpsertProfilePayload) => {
    const res = await api.put<ProviderProfileResponse>('/api/v1/providers/me/profile', payload);
    return res.data;
  },

  // Upload tài liệu / CCCD lên Cloudinary (POST /api/v1/uploads/provider-document)
  uploadDocument: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post<{ url: string; publicId: string }>('/api/v1/uploads/provider-document', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data;
  },

  // Bắt đầu phiên bàn giao cây (POST /api/v1/orders/:orderId/handover/start)
  startHandover: async (orderId: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/handover/start`);
    return res.data;
  },

  // Thẩm định cây tại vườn (POST /api/v1/orders/:orderId/handover/plants/:plantId/assess)
  assessPlant: async (
    orderId: string,
    plantId: string,
    payload: {
      checklist: Record<string, unknown>;
      decision: 'ACCEPT' | 'ACCEPT_HIGH_RISK' | 'ADJUST' | 'REJECT';
      isHighRisk: boolean;
      photos: { photoUrl: string; caption?: string; gpsLat?: number; gpsLng?: number }[];
      note?: string;
    }
  ) => {
    const res = await api.post(`/api/v1/orders/${orderId}/handover/plants/${plantId}/assess`, payload);
    return res.data;
  },

  // Hoàn tất thẩm định bàn giao (POST /api/v1/orders/:orderId/handover/complete)
  completeHandover: async (orderId: string, payload?: { proposedFinalTotal?: string }) => {
    const res = await api.post(`/api/v1/orders/${orderId}/handover/complete`, payload || {});
    return res.data;
  },

  // Bắt đầu phiên trả cây (POST /api/v1/orders/:orderId/return/start)
  startReturn: async (orderId: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/return/start`);
    return res.data;
  },

  // Ghi nhận tình trạng từng cây lúc trả (POST /api/v1/orders/:orderId/return/plants/:plantId/assess)
  assessReturnPlant: async (
    orderId: string,
    plantId: string,
    payload: {
      checklist: Record<string, unknown>;
      note?: string;
      photos: { photoUrl: string; caption?: string; gpsLat?: number; gpsLng?: number }[];
    }
  ) => {
    const res = await api.post(`/api/v1/orders/${orderId}/return/plants/${plantId}/assess`, payload);
    return res.data;
  },

  // Hoàn tất bàn giao trả cây (POST /api/v1/orders/:orderId/return/complete)
  completeReturn: async (orderId: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/return/complete`);
    return res.data;
  },

  // Huỷ phiên trả để hẹn lại (POST /api/v1/orders/:orderId/return/cancel)
  cancelReturn: async (orderId: string, reason: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/return/cancel`, { reason });
    return res.data;
  },

  // Xem hợp đồng điện tử đầy đủ (GET /api/v1/orders/:orderId/agreement/contract)
  getContract: async (orderId: string) => {
    const res = await api.get(`/api/v1/orders/${orderId}/agreement/contract`);
    return res.data;
  },

  // Danh sách tranh chấp của đơn (GET /api/v1/orders/:orderId/disputes)
  listDisputes: async (orderId: string) => {
    const res = await api.get<OrderDisputeItem[]>(`/api/v1/orders/${orderId}/disputes`);
    return Array.isArray(res.data) ? res.data : [];
  },

  // Mở tranh chấp mới (POST /api/v1/orders/:orderId/disputes)
  openDispute: async (
    orderId: string,
    payload: {
      reason: DisputeReason;
      description: string;
      evidence: Array<{ photoUrl: string; caption?: string }>;
    },
  ) => {
    const res = await api.post<OrderDisputeItem>(`/api/v1/orders/${orderId}/disputes`, payload);
    return res.data;
  },
};

export type DisputeReason = 'MISMATCHED_PLANT' | 'DAMAGE' | 'PICKUP' | 'OTHER';

export interface OrderDisputeItem {
  id: string;
  serviceOrderId: string;
  openedByAccountId: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED';
  reason: DisputeReason | string;
  description: string;
  evidence: Array<{ photoUrl: string; caption?: string }>;
  resolution: string | null;
  resolvedByAccountId: string | null;
  createdAt: string;
  updatedAt: string;
}


