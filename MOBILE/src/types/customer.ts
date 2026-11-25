// Khớp CustomersService.toOwnerView của BE (GET/PATCH /customers/me).
// BE không còn lưu số CCCD / ảnh giấy tờ — eKYC đạt thì BE tự điền ngày sinh, quê quán, địa chỉ.
export type VerificationStatus = 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface CustomerProfileResponse {
  id: string;
  accountId: string;
  address: string | null;
  defaultPickupAddress: string | null;
  gpsLat: string | null;
  gpsLng: string | null;
  dateOfBirth?: string | null;
  placeOfOrigin?: string | null;
  verificationStatus: VerificationStatus;
  verificationNote?: string | null;
  phone?: string | null;
  fullName?: string | null;
  email?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  bankHolder?: string | null;
}

// Đúng các field UpsertCustomerProfileDto nhận — gửi field lạ BE trả 400 (forbidNonWhitelisted).
// Ngày sinh / quê quán bị khoá khi đã APPROVED (IDENTITY_LOCKED_AFTER_APPROVAL).
export interface UpdateCustomerProfilePayload {
  fullName?: string;
  phone?: string;
  dateOfBirth?: string;
  placeOfOrigin?: string;
  address?: string;
  defaultPickupAddress?: string;
  gpsLat?: number;
  gpsLng?: number;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
  bankBin?: string;
}
