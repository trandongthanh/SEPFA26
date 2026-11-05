export type UserRole = 'CUSTOMER' | 'PROVIDER';
export type ProviderType = 'NURSERY' | 'EXPERT';

export interface RegisterPayload {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  role: UserRole;
  providerType?: ProviderType;
  gpsLat?: number;
  gpsLng?: number;
  address?: string;
}

export interface RegisterResponse {
  accountId: string;
  email: string;
  role: UserRole;
  status: string;
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export interface GoogleLoginPayload {
  idToken: string;
  role?: UserRole;
}

export interface GoogleLoginResponse {
  accessToken: string;
  refreshToken: string;
  account: {
    id: string;
    fullName: string;
    role: UserRole;
    email?: string;
  };
  isNewAccount?: boolean;
}
