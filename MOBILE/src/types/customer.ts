export interface CustomerProfileResponse {
  id: string;
  accountId: string;
  address: string | null;
  defaultPickupAddress: string | null;
  gpsLat: string | null;
  gpsLng: string | null;
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  verificationNote?: string | null;
  cccdFrontUrl?: string | null;
  cccdBackUrl?: string | null;
  selfieWithIdUrl?: string | null;
  phone?: string | null;
  fullName?: string | null;
  email?: string | null;
}
