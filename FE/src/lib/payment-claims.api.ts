import { api } from './api';

export type PaymentClaimStatus = 'OPEN' | 'RESOLVED' | 'REJECTED';
export type PaymentClaimParty = 'CUSTOMER' | 'PROVIDER';

export interface PaymentClaimPhoto {
  id: string;
  photoUrl: string;
}

export interface PaymentClaimItem {
  id: string;
  serviceOrderId: string;
  party: PaymentClaimParty;
  amount: string | number;
  transferredAt: string | null;
  note: string | null;
  status: PaymentClaimStatus;
  rejectReason: string | null;
  createdAt: string;
  handledAt: string | null;
  transactionId: string | null;
  photos: PaymentClaimPhoto[];
  refund: {
    status: 'PENDING' | 'PAID' | null;
    paidAt: string | null;
    receiptUrl: string | null;
  } | null;
  // Các field chỉ có trong danh sách admin:
  orderCode?: string | null;
  orderStatus?: string | null;
  submittedBy?: {
    accountId: string;
    fullName: string | null;
  };
}

export interface CreatePaymentClaimPayload {
  amount: number;
  transferredAt?: string;
  note?: string;
  photos: { photoUrl: string }[];
}

export interface QueryPaymentClaimParams {
  status?: PaymentClaimStatus;
  amount?: number;
  page?: number;
  limit?: number;
}

export interface PaymentClaimListResponse {
  data: PaymentClaimItem[];
  total: number;
  page: number;
  limit: number;
}

export const paymentClaimsApi = {
  // Người dùng (khách / vườn) nộp phiếu báo chuyển tiền trên đơn
  create: async (orderId: string, payload: CreatePaymentClaimPayload): Promise<PaymentClaimItem> => {
    const res = await api.post<PaymentClaimItem>(`/api/v1/orders/${orderId}/payment-claims`, payload);
    return res.data;
  },

  // Người dùng xem các phiếu đã nộp trên đơn của mình
  listForOrder: async (orderId: string): Promise<PaymentClaimItem[]> => {
    const res = await api.get<PaymentClaimItem[]>(`/api/v1/orders/${orderId}/payment-claims`);
    return res.data;
  },

  // Admin xem danh sách phiếu báo chuyển tiền
  listForAdmin: async (params?: QueryPaymentClaimParams): Promise<PaymentClaimListResponse> => {
    const res = await api.get<PaymentClaimListResponse>('/api/v1/admin/payment-claims', { params });
    return res.data;
  },

  // Admin từ chối phiếu kèm lý do
  reject: async (id: string, reason: string): Promise<PaymentClaimItem> => {
    const res = await api.post<PaymentClaimItem>(`/api/v1/admin/payment-claims/${id}/reject`, {
      reason,
    });
    return res.data;
  },

  // Admin tải ảnh biên lai chuyển khoản khi bấm Đã chuyển
  uploadDisbursementReceipt: async (file: File): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post<{ url: string }>('/api/v1/admin/disbursements/receipt-upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data;
  },
};

