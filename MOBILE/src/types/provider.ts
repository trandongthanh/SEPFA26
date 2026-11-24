export type ProviderType = 'NURSERY' | 'EXPERT';

export interface ProviderItem {
  id: string;
  displayName: string;
  providerType: ProviderType;
  bio?: string | null;
  portfolioUrl?: string | null;
  address?: string | null;
  gpsLat?: string | null;
  gpsLng?: string | null;
  ratingAvg?: number | string | null;
  packageCount: number;
}

export interface QueryProviderParams {
  type?: ProviderType;
  minRating?: number;
  keyword?: string;
  page?: number;
  limit?: number;
}

export interface ProviderListResponse {
  data: ProviderItem[];
  total: number;
  page: number;
  limit: number;
}

// Khớp entity ServicePackage của BE (GET /providers/:id/packages trả nguyên entity).
// Cột tiền là bigint → BE trả CHUỖI số (vd "1200000"). BE không có field `price` —
// đọc `price` từng làm giá hiện "NaN ₫".
export interface ServicePackage {
  id: string;
  providerId: string;
  name: string;
  description?: string | null;
  basePrice: string;
  durationDays?: number;
  reportFrequencyDays?: number;
  maxPlants?: number;
  minDeclaredValue?: string | null;
  maxDeclaredValue?: string | null;
  isActive: boolean;
  approvalStatus: string;
  imageUrl?: string;
}

export interface ProviderDetail extends ProviderItem {
  licenseInfo?: string;
  experience?: string;
  specialties?: string;
  serviceAreas?: string;
  createdAt?: string;
}
