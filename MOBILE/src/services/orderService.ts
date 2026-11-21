import { apiClient } from '../config/api';

export interface CreateOrderPlantDto {
  name: string;
  speciesName?: string;
  isValueDeclared?: boolean;
  declaredValue?: string; // Digits string, e.g. "500000"
}

export interface CreateOrderDto {
  servicePackageId: string;
  scheduledPickupAt: string; // ISO 8601 with TZ (e.g. 2026-09-15T09:00:00+07:00)
  pickupAddress?: string;
  pickupGpsLat: number;
  pickupGpsLng: number;
  customerNote?: string;
  plants: CreateOrderPlantDto[];
}

export interface AddInitialPhotoDto {
  photoUrl: string;
  caption?: string;
}

export interface OrderPlantPhoto {
  id: string;
  photoUrl: string;
  caption?: string;
}

export interface OrderPlantItem {
  id: string;
  name: string;
  speciesName?: string;
  isValueDeclared?: boolean;
  declaredValue?: string;
  declaredDeposit?: string;
  handoverDecision?: string | null;
  initialPhotos?: OrderPlantPhoto[];
}

export interface CareReportSchedule {
  nextReportDueAt: string | null;
  isReportOverdue: boolean;
  submittedCount: number;
  expectedCount: number;
  totalPeriods: number;
}

export interface ServicePackageInfo {
  id: string;
  name: string;
  durationDays: number;
  reportFrequencyDays: number;
  maxPlants: number;
  basePrice: string;
  maxDeclaredValue?: string;
}

export interface ProviderProfileInfo {
  id: string;
  gardenName: string;
  address?: string;
  phone?: string;
  avatarUrl?: string;
  gpsLat?: string | null;
  gpsLng?: string | null;
}

export interface OrderItem {
  id: string;
  orderCode: string;
  status: string;
  plantCount: number;
  basePriceSnapshot: string;
  pickupFeeSnapshot: string;
  durationDaysSnapshot: number;
  reportFrequencySnapshot: number;
  provisionalTotal: string;
  finalTotal?: string | null;
  scheduledPickupAt: string;
  pickupAddress?: string;
  pickupGpsLat?: number | string | null;
  pickupGpsLng?: number | string | null;
  customerNote?: string;
  createdAt: string;
  servicePackage?: ServicePackageInfo;
  provider?: ProviderProfileInfo;
  plants?: OrderPlantItem[];
  agreement?: {
    id: string;
    agreementNo: string;
    status: string;
    signatures?: { id?: string; signerRole: string; signedAt: string }[];
  } | null;
  handover?: {
    status: string;
    customerConfirmDueAt?: string;
  } | null;
  handoverStatus?: string | null;
  returnHandover?: {
    status: string;
    customerConfirmDueAt?: string;
    confirmedAt?: string | null;
    assessments?: Array<{
      id: string;
      plantId: string;
      checklist?: Record<string, any>;
      note?: string | null;
      photos?: Array<{ id?: string; photoUrl: string; caption?: string | null }>;
    }>;
  } | null;
  isReturnOverdue?: boolean;
  careReportSchedule?: CareReportSchedule | null;
  declaredDepositTotal?: string;
  settlement?: CustomerSettlement | null;
}

export interface CustomerSettlement {
  packageAmount: string;
  customerFee: string;
  pickupFee: string;
  addonAmount: string;
  customerTotal: string;
  refundAmount: string;
  compensationAmount: string;
  declaredDeposit: string;
  declaredDepositReturned: string;
  declaredDepositForfeited: string;
}

export interface PaginatedOrdersResponse {
  items: OrderItem[];
  meta: {
    itemCount: number;
    totalItems: number;
    itemsPerPage: number;
    totalPages: number;
    currentPage: number;
  };
}

export const orderService = {
  /**
   * Xem trước phí lấy cây qua Google Routes (GET /orders/pickup-fee-quote)
   */
  async quotePickupFee(params: {
    servicePackageId: string;
    pickupGpsLat: number;
    pickupGpsLng: number;
  }): Promise<{ distanceKm: number; pickupFee: string }> {
    const response = await apiClient.get<{ distanceKm: number; pickupFee: string }>(
      '/orders/pickup-fee-quote',
      { params }
    );
    return response.data;
  },

  /**
   * Khách tạo đơn nháp (POST /orders)
   */
  async createOrder(data: CreateOrderDto): Promise<OrderItem> {
    const response = await apiClient.post<OrderItem>('/orders', data);
    return response.data;
  },

  /**
   * Khách thêm ảnh hiện trạng cây vào đơn nháp (POST /orders/:orderId/plants/:plantId/initial-photos)
   */
  async addInitialPhoto(
    orderId: string,
    plantId: string,
    data: AddInitialPhotoDto
  ): Promise<any> {
    const response = await apiClient.post(
      `/orders/${orderId}/plants/${plantId}/initial-photos`,
      data
    );
    return response.data;
  },

  /**
   * Khách gửi đơn cho nhà vườn (POST /orders/:orderId/submit)
   */
  async submitOrder(orderId: string): Promise<OrderItem> {
    const response = await apiClient.post<OrderItem>(`/orders/${orderId}/submit`);
    return response.data;
  },

  /**
   * Danh sách đơn hàng phía mình (GET /orders)
   */
  async listOrders(status?: string): Promise<PaginatedOrdersResponse> {
    const params: Record<string, any> = { limit: 50 };
    if (status && status !== 'ALL') {
      params.status = status;
    }
    const response = await apiClient.get<any>('/orders', { params });
    const raw = response.data;
    const items: OrderItem[] = Array.isArray(raw)
      ? raw
      : raw?.items
      ? raw.items
      : raw?.data
      ? raw.data
      : [];
    return {
      items,
      meta: raw?.meta || {
        itemCount: items.length,
        totalItems: raw?.total ?? items.length,
        itemsPerPage: 50,
        totalPages: 1,
        currentPage: 1,
      },
    };
  },

  /**
   * Chi tiết đơn hàng (GET /orders/:orderId)
   */
  async getOrderDetail(orderId: string): Promise<OrderItem> {
    const response = await apiClient.get<OrderItem>(`/orders/${orderId}`);
    return response.data;
  },

  /**
   * Ký hợp đồng điện tử online (POST /orders/:orderId/agreement/sign)
   */
  async signAgreement(orderId: string): Promise<any> {
    const response = await apiClient.post(`/orders/${orderId}/agreement/sign`, {});
    return response.data;
  },

  /**
   * Xem hợp đồng điện tử đầy đủ (GET /orders/:orderId/agreement/contract)
   */
  async getContract(orderId: string): Promise<any> {
    const response = await apiClient.get(`/orders/${orderId}/agreement/contract`);
    return response.data;
  },

  /**
   * Lấy mã VietQR thanh toán (POST /orders/:orderId/payment/qr)
   */
  async getPaymentQr(orderId: string): Promise<{
    qrImageUrl: string;
    bankBin: string;
    bankAccountNumber: string;
    bankAccountName: string;
    amount: string | number;
    transferContent: string;
  }> {
    const response = await apiClient.post(`/orders/${orderId}/payment/qr`);
    return response.data;
  },

  /**
   * Khách xác nhận bàn giao cây (POST /orders/:orderId/handover/confirm)
   */
  async confirmHandover(orderId: string): Promise<any> {
    const response = await apiClient.post(`/orders/${orderId}/handover/confirm`, {});
    return response.data;
  },

  /**
   * Khách xác nhận đã nhận lại cây (POST /orders/:orderId/return/confirm)
   */
  async confirmReturn(orderId: string): Promise<any> {
    const response = await apiClient.post(`/orders/${orderId}/return/confirm`, {});
    return response.data;
  },

  /**
   * Danh sách tranh chấp của đơn (GET /orders/:orderId/disputes)
   */
  /**
   * Xem hồ sơ tranh chấp của đơn (GET /orders/:orderId/dispute)
   */
  async getDispute(orderId: string): Promise<DisputeDetail | null> {
    try {
      const response = await apiClient.get<DisputeDetail>(`/orders/${orderId}/dispute`);
      return response.data;
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  },

  /**
   * Khách mở tranh chấp trong 48 giờ sau khi trả cây (POST /orders/:orderId/dispute)
   */
  async openDispute(
    orderId: string,
    payload: {
      reason: string;
      description: string;
      plantIds: string[];
      evidence: Array<{ photoUrl: string; caption?: string; plantId?: string }>;
    }
  ): Promise<DisputeDetail> {
    const response = await apiClient.post<DisputeDetail>(`/orders/${orderId}/dispute`, payload);
    return response.data;
  },

  /**
   * Nộp thêm bằng chứng tranh chấp (POST /orders/:orderId/dispute/evidence)
   */
  async addDisputeEvidence(
    orderId: string,
    payload: {
      photos: Array<{ photoUrl: string; caption?: string; plantId?: string }>;
      note?: string;
    }
  ): Promise<any> {
    const response = await apiClient.post(`/orders/${orderId}/dispute/evidence`, payload);
    return response.data;
  },

  /**
   * Tạo đề nghị thương lượng tranh chấp (POST /orders/:orderId/dispute/offers)
   */
  async createDisputeOffer(
    orderId: string,
    payload: {
      refundAmount: string;
      compensationAmount: string;
      message?: string;
    }
  ): Promise<any> {
    const response = await apiClient.post(`/orders/${orderId}/dispute/offers`, payload);
    return response.data;
  },

  /**
   * Đồng ý một đề nghị thương lượng (POST /orders/:orderId/dispute/offers/:offerId/accept)
   */
  async acceptDisputeOffer(orderId: string, offerId: string): Promise<any> {
    const response = await apiClient.post(`/orders/${orderId}/dispute/offers/${offerId}/accept`, {});
    return response.data;
  },

  /**
   * Khách rút khiếu nại (POST /orders/:orderId/dispute/withdraw)
   */
  async withdrawDispute(orderId: string): Promise<any> {
    const response = await apiClient.post(`/orders/${orderId}/dispute/withdraw`, {});
    return response.data;
  },

  /**
   * Danh sách đề xuất add-on (dịch vụ thêm) của đơn (GET /orders/:orderId/addons)
   */
  async listAddons(orderId: string): Promise<AddonItem[]> {
    const response = await apiClient.get<AddonItem[]>(`/orders/${orderId}/addons`);
    return Array.isArray(response.data) ? response.data : [];
  },

  /**
   * Khách đồng ý hoặc từ chối đề xuất add-on (POST /orders/:orderId/addons/:addonId/respond)
   */
  async respondAddon(
    orderId: string,
    addonId: string,
    payload: { decision: 'ACCEPT' | 'REJECT'; note?: string }
  ): Promise<AddonItem> {
    const response = await apiClient.post<AddonItem>(
      `/orders/${orderId}/addons/${addonId}/respond`,
      payload
    );
    return response.data;
  },

  /**
   * Khách lấy VietQR thanh toán cho add-on (POST /orders/:orderId/addons/:addonId/payment/qr)
   */
  async getAddonPaymentQr(
    orderId: string,
    addonId: string
  ): Promise<AddonPaymentQrResponse> {
    const response = await apiClient.post<AddonPaymentQrResponse>(
      `/orders/${orderId}/addons/${addonId}/payment/qr`,
      {}
    );
    return response.data;
  },
};

export type AddonStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PAID'
  | 'DONE'
  | 'REJECTED'
  | 'EXPIRED';

export interface AddonItem {
  id: string;
  orderId: string;
  addonCode: string;
  title: string;
  reason: string;
  photoUrls: string[];
  plant: { id: string; name: string | null } | null;
  price: string;
  customerFee: string;
  amountDue: string;
  status: AddonStatus;
  respondDueAt: string;
  decidedAt: string | null;
  customerNote: string | null;
  paymentDueAt: string | null;
  paidAt: string | null;
  doneAt: string | null;
  donePhotoUrls: string[] | null;
  doneNote: string | null;
  donePlantHealth?: 'GOOD' | 'AVERAGE' | 'POOR' | null;
  expiredReason: 'NO_RESPONSE' | 'NOT_PAID' | 'ORDER_RETURNING' | null;
  expiredAt: string | null;
  createdAt: string;
}

export interface AddonPaymentQrResponse {
  qrImageUrl: string;
  bankBin: string;
  bankAccountNumber: string;
  bankAccountName: string;
  amount: string;
  transferContent: string;
}

export type DisputeStatus = 'NEGOTIATING' | 'ADMIN_REVIEW' | 'RESOLVED';
export type DisputeOutcome = 'OFFER_ACCEPTED' | 'WITHDRAWN' | 'ADMIN_RESOLVED';

export interface DisputeEvidenceItem {
  id: string;
  plantId: string | null;
  photoUrl: string;
  caption: string | null;
  note: string | null;
  createdAt: string;
}

export interface DisputeOfferItem {
  id: string;
  proposedBy: 'CUSTOMER' | 'PROVIDER';
  refundAmount: string;
  compensationAmount: string;
  customerReceives: string;
  message: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';
  respondedAt: string | null;
  createdAt: string;
}

export interface DisputePlantItem {
  plantId: string;
  name: string | null;
  compensationCap: string | null;
  verdict: 'UPHELD' | 'DISMISSED' | null;
}

export interface DisputeDetail {
  id: string;
  orderId: string;
  status: DisputeStatus;
  outcome: DisputeOutcome | null;
  reason: string;
  description: string;
  openedAt: string;
  negotiationDueAt: string;
  escalatedAt: string | null;
  adminDueAt: string | null;
  resolvedAt: string | null;
  plants: DisputePlantItem[];
  evidence: {
    customer: DisputeEvidenceItem[];
    provider: DisputeEvidenceItem[];
  };
  handoverObjection: {
    note: string | null;
    photos: Array<{ photoUrl: string; caption: string | null; createdAt: string }>;
  } | null;
  offers: DisputeOfferItem[];
  caps: {
    refundCap: string;
    compensationCap: string;
  } | null;
  refundAmount: string | null;
  compensationAmount: string | null;
  customerReceives: string | null;
  declaredForfeitAmount?: string | null;
}

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

