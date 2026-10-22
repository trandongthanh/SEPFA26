export interface CustomerProfileResponse {
  id: string;
  accountId: string;
  address: string | null;
  defaultPickupAddress: string | null;
  gpsLat: string | null;
  gpsLng: string | null;
  cccdNumber?: string | null;
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  verificationNote?: string | null;
  cccdFrontUrl?: string | null;
  cccdBackUrl?: string | null;
  selfieWithIdUrl?: string | null;
  phone?: string | null;
  fullName?: string | null;
  email?: string | null;
}

export interface UpdateCustomerProfilePayload {
  phone?: string;
  address?: string;
  defaultPickupAddress?: string;
  gpsLat?: number;
  gpsLng?: number;
  cccdNumber?: string;
  cccdFrontUrl?: string;
  cccdBackUrl?: string;
  selfieWithIdUrl?: string;
}

