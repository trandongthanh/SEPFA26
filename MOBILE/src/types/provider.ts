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

export interface ServicePackage {
  id: string;
  providerId: string;
  name: string;
  description?: string;
  price: number;
  durationDays?: number;
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
