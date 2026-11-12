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
  async listDisputes(orderId: string): Promise<OrderDisputeItem[]> {
    const response = await apiClient.get<OrderDisputeItem[]>(`/orders/${orderId}/disputes`);
    return Array.isArray(response.data) ? response.data : [];
  },

  /**
   * Mở tranh chấp mới (POST /orders/:orderId/disputes)
   */
  async openDispute(
    orderId: string,
    payload: {
      reason: DisputeReason;
      description: string;
      evidence: Array<{ photoUrl: string; caption?: string }>;
    }
  ): Promise<OrderDisputeItem> {
    const response = await apiClient.post<OrderDisputeItem>(`/orders/${orderId}/disputes`, payload);
    return response.data;
  },
};

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

