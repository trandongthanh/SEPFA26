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
  initialPhotos?: OrderPlantPhoto[];
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
  customerNote?: string;
  createdAt: string;
  servicePackage?: ServicePackageInfo;
  provider?: ProviderProfileInfo;
  plants?: OrderPlantItem[];
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
};
