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
  minDeclaredValue: string;
  maxDeclaredValue: string;
  isActive: boolean;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
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
  updateUserStatus: async (userId: string, status: 'ACTIVE' | 'SUSPENDED') => {
    const res = await api.patch(`/api/v1/admin/users/${userId}/status`, { status });
    return res.data;
  },
};
