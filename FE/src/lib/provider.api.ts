import { api } from './api';

export interface ProviderProfileResponse {
  id: string;
  accountId: string;
  providerType: 'NURSERY' | 'EXPERT';
  displayName: string;
  bio?: string;
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  ratingAvg?: string;
  address?: string;
  gpsLat?: string;
  gpsLng?: string;
}

export interface OrderItem {
  id: string;
  orderCode: string;
  status: string;
  provisionalTotal: string;
  finalTotal?: string;
  scheduledPickupAt: string;
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

export interface CareReportItem {
  id: string;
  serviceOrderId?: string;
  orderId?: string;
  notes?: string;
  plantNameSnapshot?: string;
  plantCodeSnapshot?: string;
  weather?: string;
  substrateStatus?: string;
  rootStatus?: string;
  leafStatus?: string;
  createdAt?: string;
}

export interface CreateCareReportPayload {
  serviceOrderId: string;
  periodStart: string;
  periodEnd: string;
  plantNameSnapshot: string;
  plantCodeSnapshot: string;
  plotPositionSnapshot: string;
  weather: 'SUNNY' | 'RAINY' | 'OVERCAST' | 'NORMAL';
  temperatureMin: number;
  temperatureMax: number;
  humidityMin: number;
  humidityMax: number;
  substrateStatus: 'DRY_READY_TO_WATER' | 'MOIST_GOOD' | 'WATERLOGGED_RISK';
  rootStatus: 'ROOTS_HEALTHY_GROWING' | 'ROOTS_STABLE' | 'ROOTS_AFFECTED';
  rootAffectedCount?: number;
  leafStatus: 'LEAVES_FIRM_AND_HEALTHY' | 'STEM_TURGID_GOOD' | 'BASE_LEAVES_YELLOW_REMOVED' | 'LEAF_ROT_BLACKSPOT_BURN';
  shootStatus: 'SHOOTS_UNIFORM' | 'FLOWERS_UNIFORM';
  wateringCount: number;
  nutritionNote?: string;
  diseasePrevention: 'DISINFECT_GARDEN' | 'SPRAY_BACTERIA_FUNGUS' | 'SNAIL_TREATMENT' | 'NONE';
  evidences: {
    evidenceType: 'OVERVIEW' | 'ROOT' | 'LEAF_OR_SHOOT';
    photoUrl: string;
    caption?: string;
  }[];
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
    const res = await api.get<{ items: OrderItem[]; total: number }>('/api/v1/orders', { params });
    return res.data;
  },

  // Quyết định đơn hàng (Chấp nhận / Từ chối)
  respondNegotiation: async (orderId: string, action: 'ACCEPT' | 'REJECT', note?: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/negotiation/respond`, {
      action,
      note,
    });
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
  listCareReports: async () => {
    const res = await api.get<{ items?: CareReportItem[]; total?: number } | CareReportItem[]>('/api/v1/care-reports');
    return res.data;
  },

  // Nộp báo cáo chăm sóc mới
  createCareReport: async (payload: CreateCareReportPayload) => {
    const res = await api.post<CareReportItem>('/api/v1/care-reports', payload);
    return res.data;
  },
};


