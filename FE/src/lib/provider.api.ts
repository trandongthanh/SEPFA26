import { api } from './api';

export interface ProviderProfileResponse {
  id: string;
  accountId: string;
  providerType: 'NURSERY' | 'EXPERT';
  displayName: string;
  bio?: string | null;
  licenseInfo?: string | null;
  portfolioUrl?: string | null;
  businessLicenseUrl?: string | null;
  // Người đại diện — in vào hợp đồng. BE KHÔNG thu số CCCD hay ảnh giấy tờ/chân dung.
  dateOfBirth?: string | null;
  placeOfOrigin?: string | null;
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  verificationNote?: string | null;
  ratingAvg?: string | null;
  address?: string | null;
  gpsLat?: string | null;
  gpsLng?: string | null;
  experience?: string | null;
  specialties?: string | null;
  serviceAreas?: string | null;
  certificates?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  bankHolder?: string | null;
  bankBin?: string | null;
  phone?: string | null;
  account?: {
    id: string;
    fullName: string;
    email: string;
    phone?: string;
    role: string;
  } | null;
}

export interface UpsertProfilePayload {
  providerType?: 'NURSERY' | 'EXPERT';
  displayName?: string;
  bio?: string;
  licenseInfo?: string;
  portfolioUrl?: string;
  phone?: string;
  // Không gửi field nào ngoài DTO: BE bật forbidNonWhitelisted → field lạ (vd cccdNumber cũ) bị 400.
  fullName?: string;
  dateOfBirth?: string;
  placeOfOrigin?: string;
  businessLicenseUrl?: string;
  address?: string;
  gpsLat?: number;
  gpsLng?: number;
  experience?: string;
  specialties?: string;
  serviceAreas?: string;
  certificates?: string;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
}

// Body POST /orders/:id/handover/cancel (BE: orders/dto/cancel-handover.dto.ts).
export type HandoverCancelReasonCode = 'CUSTOMER_ABSENT' | 'PROVIDER_CANNOT_SERVE';
export const HANDOVER_CANCEL_MAX_PHOTOS = 5;
export const HANDOVER_CANCEL_REASON_MAX = 500;
export interface CancelHandoverPayload {
  reason: string; // bắt buộc, tối đa 500 ký tự
  reasonCode?: HandoverCancelReasonCode;
  photos?: { photoUrl: string; gpsLat?: number; gpsLng?: number }[]; // tối đa 5
}

export type OrderStatus =
  | 'DRAFT'
  | 'PENDING_PROVIDER'
  | 'AGREEMENT_PENDING'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'HANDOVER_IN_PROGRESS'
  | 'HANDOVER_AWAITING_CONFIRM'
  | 'IN_CARE'
  | 'RETURN_IN_PROGRESS'
  | 'RETURN_AWAITING_CONFIRM'
  | 'COMPLETED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'DISPUTED';

export interface CareReportSchedule {
  nextReportDueAt: string | null;
  isReportOverdue: boolean;
  submittedCount: number;
  expectedCount: number;
  totalPeriods: number;
}

export interface OrderPlantSummary {
  id: string;
  name: string;
  speciesName?: string | null;
  handoverDecision?: string | null;
}

export interface OrderItem {
  id: string;
  orderCode: string;
  status: OrderStatus | string;
  provisionalTotal: string;
  finalTotal?: string;
  scheduledPickupAt: string;
  // Hạn chờ của từng bước (cột của đơn, có trong cả danh sách và chi tiết).
  providerRespondDueAt?: string | null;
  agreementDueAt?: string | null;
  paymentDueAt?: string | null;
  careDueAt?: string | null;
  careReportSchedule?: CareReportSchedule | null;
  handoverStatus?: string | null;
  plants?: OrderPlantSummary[];
  customer?: {
    account?: {
      fullName?: string;
    };
  };
  servicePackage?: {
    name?: string;
  };
  createdAt: string;
}

export interface ServicePackageItem {
  id: string;
  name: string;
  description?: string;
  durationDays: number;
  reportFrequencyDays: number;
  maxPlants: number;
  basePrice: string | number;
  minDeclaredValue: string | number;
  maxDeclaredValue: string | number;
  isActive?: boolean;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  // Lý do admin ghi khi từ chối gói (null khi chưa từng bị từ chối).
  rejectionReason?: string | null;
  pricePerMonth?: string;
  status?: string;
  createdAt?: string;
}

export interface CreatePackagePayload {
  name: string;
  description: string;
  durationDays: number;
  reportFrequencyDays: number;
  maxPlants: number;
  basePrice: number;
  minDeclaredValue: number;
  maxDeclaredValue: number;
  // Không gửi isActive: BE bỏ qua, chỉ Admin bật/tắt mở bán (tạo/sửa gói luôn isActive=false).
}

export type SubstrateMoisture = 'LOW' | 'MEDIUM' | 'HIGH';
export type PartCondition = 'GOOD' | 'NORMAL' | 'POOR';
export type OverallHealth = 'GOOD' | 'AVERAGE' | 'POOR';
export type CareEvidenceType = 'OVERVIEW' | 'LEAF' | 'STEM' | 'ROOT';

export interface CareReportPhotoItem {
  id?: string;
  evidenceType: CareEvidenceType;
  photoUrl: string;
  caption?: string | null;
}

export interface CareReportPlantItem {
  id?: string;
  plant: {
    id: string;
    name: string | null;
    speciesName: string | null;
  };
  substrateMoisture: SubstrateMoisture;
  leafCondition: PartCondition;
  rootCondition: PartCondition;
  stemCondition: PartCondition;
  hasPestDisease: boolean;
  overallHealth: OverallHealth;
  note?: string | null;
  leafLengthCm?: number | null;
  leafCount?: number | null;
  newRootLengthCm?: number | null;
  newShootCount?: number | null;
  flowerSpikeCount?: number | null;
  budCount?: number | null;
  flowerCount?: number | null;
  photos: CareReportPhotoItem[];
}

// GET /orders — sort: newest (mặc định) | oldest | pickupSoon (giờ hẹn lấy cây gần nhất trước).
export type OrderListSort = 'newest' | 'oldest' | 'pickupSoon';

export interface OrderSearchParams {
  status?: string;
  q?: string; // tìm không dấu trong mã đơn, tên khách, tên gói, tên cây
  sort?: OrderListSort;
  page?: number;
  limit?: number; // BE tối đa 50
}

export interface OrderSearchResult {
  data: OrderItem[];
  total: number;
  // Số đơn theo từng trạng thái (đã lọc theo q, không lọc theo status).
  statusCounts: Record<string, number>;
}

export interface CareReportListParams {
  serviceOrderId?: string;
  q?: string;
  late?: boolean;
  page?: number;
  limit?: number; // BE tối đa 50
}

export interface CareReportPage {
  data: CareReportItem[];
  total: number;
  page: number;
  limit: number;
}

export interface CareReportItem {
  id: string;
  serviceOrderId: string;
  periodIndex: number;
  periodStart: string;
  periodEnd: string;
  submittedAt: string;
  isLate: boolean;
  airTemperature: number;
  airHumidity: number;
  lightIntensity: number;
  watered: boolean;
  waterAmountMl?: number | null;
  fertilized: boolean;
  fertilizerType?: string | null;
  otherCareNote?: string | null;
  waterPh?: number | null;
  waterEc?: number | null;
  plants: CareReportPlantItem[];
}

export interface CreateCareReportPhotoPayload {
  evidenceType: CareEvidenceType;
  photoUrl: string;
  caption?: string;
}

export interface CreateCareReportPlantPayload {
  plantId: string;
  substrateMoisture: SubstrateMoisture;
  leafCondition: PartCondition;
  rootCondition: PartCondition;
  stemCondition: PartCondition;
  hasPestDisease: boolean;
  overallHealth: OverallHealth;
  note?: string;
  leafLengthCm?: number;
  leafCount?: number;
  newRootLengthCm?: number;
  newShootCount?: number;
  flowerSpikeCount?: number;
  budCount?: number;
  flowerCount?: number;
  photos: CreateCareReportPhotoPayload[];
}

export interface CreateCareReportPayload {
  serviceOrderId: string;
  airTemperature: number;
  airHumidity: number;
  lightIntensity: number;
  watered: boolean;
  waterAmountMl?: number;
  fertilized: boolean;
  fertilizerType?: string;
  otherCareNote?: string;
  waterPh?: number;
  waterEc?: number;
  plants: CreateCareReportPlantPayload[];
}

export interface CreateCareReportResponse {
  id: string;
  serviceOrderId: string;
  periodIndex: number;
  periodStart: string;
  periodEnd: string;
  isLate: boolean;
  submittedAt: string;
}

export const providerApi = {
  // Lấy hồ sơ Provider hiện tại
  getProfile: async () => {
    const res = await api.get<ProviderProfileResponse>('/api/v1/providers/me');
    return res.data;
  },

  // Danh sách đơn hàng phía Provider — BE phân trang, KHÔNG truyền limit thì BE chỉ trả 10 đơn.
  listOrders: async (status?: string, page = 1, limit = 10) => {
    const params: Record<string, string | number> = { page, limit };
    if (status) params.status = status;
    const res = await api.get<any>('/api/v1/orders', { params });
    const raw = res.data;
    const items: OrderItem[] = Array.isArray(raw)
      ? raw
      : raw?.items
      ? raw.items
      : raw?.data
      ? raw.data
      : [];
    return {
      items,
      total: raw?.total ?? items.length,
    };
  },

  // Danh sách đơn có tìm / lọc / sắp xếp / phân trang làm ở BE (GET /orders?q&status&sort&page&limit).
  // statusCounts đếm theo q nhưng KHÔNG theo status → dùng thẳng cho số trên các tab.
  searchOrders: async (params: OrderSearchParams): Promise<OrderSearchResult> => {
    const query: Record<string, string | number> = {
      page: params.page ?? 1,
      limit: params.limit ?? 10,
    };
    if (params.status) query.status = params.status;
    if (params.q?.trim()) query.q = params.q.trim();
    if (params.sort) query.sort = params.sort;
    const res = await api.get<{
      data?: OrderItem[];
      total?: number;
      page?: number;
      limit?: number;
      statusCounts?: Record<string, number>;
    }>('/api/v1/orders', { params: query });
    const body = res.data;
    return {
      data: Array.isArray(body?.data) ? body.data : [],
      total: Number(body?.total ?? 0),
      statusCounts: body?.statusCounts ?? {},
    };
  },

  // Tải HẾT đơn (mỗi lần 50 — mức tối đa BE cho). Chỉ dùng khi cần tra mã đơn / tên khách theo id
  // (trang báo cáo); danh sách đơn thì dùng searchOrders để BE tìm và chia trang.
  listAllOrders: async (status?: string) => {
    const PAGE_SIZE = 50;
    const MAX_PAGES = 40; // chặn vòng lặp vô hạn nếu BE trả total sai (tối đa 2.000 đơn)
    const all: OrderItem[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { items, total } = await providerApi.listOrders(status, page, PAGE_SIZE);
      all.push(...items);
      if (items.length < PAGE_SIZE || all.length >= total) break;
    }
    return all;
  },

  // Chi tiết đơn hàng phía Provider
  getOrderDetail: async (orderId: string) => {
    const res = await api.get<any>(`/api/v1/orders/${orderId}`);
    return res.data;
  },

  // Quyết định đơn hàng (Chấp nhận / Từ chối)
  respondNegotiation: async (orderId: string, action: 'ACCEPT' | 'REJECT', note?: string) => {
    const payload: { response: 'ACCEPT' | 'REJECT'; providerNote?: string } = {
      response: action,
    };
    if (note && note.trim()) {
      payload.providerNote = note.trim();
    }
    const res = await api.post(`/api/v1/orders/${orderId}/negotiation/respond`, payload);
    return res.data;
  },

  // Ký hợp đồng dịch vụ (POST /api/v1/orders/:orderId/agreement/sign)
  signAgreement: async (orderId: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/agreement/sign`, {});
    return res.data;
  },

  // Lấy QR nộp tiền bảo lãnh trách nhiệm (POST /api/v1/orders/:orderId/security-deposit/qr)
  getSecurityDepositQr: async (orderId: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/security-deposit/qr`, {});
    return res.data;
  },

  // Danh sách gói dịch vụ của tôi
  listMyPackages: async () => {
    const res = await api.get<ServicePackageItem[]>('/api/v1/providers/me/packages');
    return res.data;
  },

  // Tạo mới gói dịch vụ
  createPackage: async (payload: CreatePackagePayload) => {
    const res = await api.post<ServicePackageItem>('/api/v1/providers/me/packages', payload);
    return res.data;
  },

  // Sửa gói (PUT /api/v1/providers/me/packages/:packageId). DTO bắt buộc gửi đủ 8 trường.
  // BE: sửa xong gói luôn về "Chờ duyệt" và TẠM NGƯNG bán (isActive=false) tới khi Admin duyệt lại.
  updatePackage: async (packageId: string, payload: CreatePackagePayload) => {
    const res = await api.put<ServicePackageItem>(`/api/v1/providers/me/packages/${packageId}`, payload);
    return res.data;
  },

  // Xóa gói dịch vụ
  deletePackage: async (packageId: string) => {
    await api.delete(`/api/v1/providers/me/packages/${packageId}`);
  },

  // Danh sách báo cáo chăm sóc — BE luôn phân trang, trả { data, total, page, limit }.
  // Có serviceOrderId → xếp theo kỳ 1→n; không có → mới nộp trước. q tìm không dấu, late=true chỉ lấy nộp trễ.
  listCareReports: async (params: CareReportListParams = {}): Promise<CareReportPage> => {
    const query: Record<string, string | number | boolean> = {};
    if (params.serviceOrderId) query.serviceOrderId = params.serviceOrderId;
    if (params.q?.trim()) query.q = params.q.trim();
    if (params.late) query.late = true;
    if (params.page) query.page = params.page;
    if (params.limit) query.limit = params.limit;
    const res = await api.get<CareReportPage>('/api/v1/care-reports', { params: query });
    const body = res.data;
    return {
      data: Array.isArray(body?.data) ? body.data : [],
      total: Number(body?.total ?? 0),
      page: Number(body?.page ?? params.page ?? 1),
      limit: Number(body?.limit ?? params.limit ?? 10),
    };
  },

  // Chi tiết báo cáo chăm sóc
  getCareReport: async (id: string) => {
    const res = await api.get<CareReportItem>(`/api/v1/care-reports/${id}`);
    return res.data;
  },

  // Nộp báo cáo chăm sóc mới
  createCareReport: async (payload: CreateCareReportPayload) => {
    const res = await api.post<CreateCareReportResponse>('/api/v1/care-reports', payload);
    return res.data;
  },

  // Cập nhật hoặc tạo mới hồ sơ Provider (PUT /api/v1/providers/me/profile)
  upsertProfile: async (payload: UpsertProfilePayload) => {
    const res = await api.put<ProviderProfileResponse>('/api/v1/providers/me/profile', payload);
    return res.data;
  },

  // Upload ảnh giấy phép kinh doanh / chứng chỉ lên Cloudinary (POST /api/v1/uploads/provider-document)
  uploadDocument: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post<{ url: string; publicId: string }>('/api/v1/uploads/provider-document', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data;
  },

  // Bắt đầu phiên bàn giao cây (POST /api/v1/orders/:orderId/handover/start)
  startHandover: async (orderId: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/handover/start`);
    return res.data;
  },

  // Thẩm định cây tại vườn (POST /api/v1/orders/:orderId/handover/plants/:plantId/assess)
  assessPlant: async (
    orderId: string,
    plantId: string,
    payload: {
      checklist: Record<string, unknown>;
      decision: 'ACCEPT' | 'ACCEPT_HIGH_RISK' | 'ADJUST' | 'REJECT';
      isHighRisk: boolean;
      photos: { photoUrl: string; caption?: string; gpsLat?: number; gpsLng?: number }[];
      note?: string;
    }
  ) => {
    const res = await api.post(`/api/v1/orders/${orderId}/handover/plants/${plantId}/assess`, payload);
    return res.data;
  },

  // Hoàn tất thẩm định bàn giao (POST /api/v1/orders/:orderId/handover/complete)
  completeHandover: async (orderId: string, payload?: { proposedFinalTotal?: string }) => {
    const res = await api.post(`/api/v1/orders/${orderId}/handover/complete`, payload || {});
    return res.data;
  },

  // Vườn huỷ đơn trước khi mở phiên nhận cây (POST /api/v1/orders/:orderId/cancel) — body chỉ { reason },
  // mã lý do và tiền hoàn do BE tự quyết theo trạng thái đơn.
  cancelOrder: async (orderId: string, reason: string) => {
    const res = await api.post<{ status: 'CANCELLED'; cancelCode: string }>(`/api/v1/orders/${orderId}/cancel`, {
      reason,
    });
    return res.data;
  },

  // Vườn huỷ ở chặng nhận cây (POST /api/v1/orders/:orderId/handover/cancel) — khớp CancelHandoverDto:
  //  - phiên AWAITING_DEPOSIT (chờ vườn nộp bảo đảm): chỉ cần `reason`;
  //  - phiên IN_PROGRESS / AWAITING_CUSTOMER: bắt buộc `reasonCode`; CUSTOMER_ABSENT bắt buộc 1–5 ảnh.
  cancelHandover: async (orderId: string, payload: CancelHandoverPayload) => {
    const res = await api.post<{ status: 'CANCELLED'; cancelCode: string }>(
      `/api/v1/orders/${orderId}/handover/cancel`,
      payload,
    );
    return res.data;
  },

  // Bắt đầu phiên trả cây (POST /api/v1/orders/:orderId/return/start)
  startReturn: async (orderId: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/return/start`);
    return res.data;
  },

  // Ghi nhận tình trạng từng cây lúc trả (POST /api/v1/orders/:orderId/return/plants/:plantId/assess)
  assessReturnPlant: async (
    orderId: string,
    plantId: string,
    payload: {
      checklist: Record<string, unknown>;
      note?: string;
      photos: { photoUrl: string; caption?: string; gpsLat?: number; gpsLng?: number }[];
    }
  ) => {
    const res = await api.post(`/api/v1/orders/${orderId}/return/plants/${plantId}/assess`, payload);
    return res.data;
  },

  // Hoàn tất bàn giao trả cây (POST /api/v1/orders/:orderId/return/complete)
  completeReturn: async (orderId: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/return/complete`);
    return res.data;
  },

  // Huỷ phiên trả để hẹn lại (POST /api/v1/orders/:orderId/return/cancel)
  cancelReturn: async (orderId: string, reason: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/return/cancel`, { reason });
    return res.data;
  },

  // Xem hợp đồng điện tử đầy đủ (GET /api/v1/orders/:orderId/agreement/contract)
  getContract: async (orderId: string) => {
    const res = await api.get(`/api/v1/orders/${orderId}/agreement/contract`);
    return res.data;
  },

  // Tranh chấp của đơn (GET /api/v1/orders/:orderId/dispute)
  getDispute: async (orderId: string) => {
    try {
      const res = await api.get<DisputeDetail>(`/api/v1/orders/${orderId}/dispute`);
      return res.data;
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  },

  // Nộp thêm bằng chứng tranh chấp (POST /api/v1/orders/:orderId/dispute/evidence)
  addDisputeEvidence: async (
    orderId: string,
    payload: {
      photos: Array<{ photoUrl: string; caption?: string; plantId?: string }>;
      note?: string;
    },
  ) => {
    const res = await api.post(`/api/v1/orders/${orderId}/dispute/evidence`, payload);
    return res.data;
  },

  // Tạo đề nghị thương lượng tranh chấp (POST /api/v1/orders/:orderId/dispute/offers)
  createDisputeOffer: async (
    orderId: string,
    payload: {
      refundAmount: string;
      compensationAmount: string;
      message?: string;
    },
  ) => {
    const res = await api.post(`/api/v1/orders/${orderId}/dispute/offers`, payload);
    return res.data;
  },

  // Đồng ý một đề nghị thương lượng (POST /api/v1/orders/:orderId/dispute/offers/:offerId/accept)
  acceptDisputeOffer: async (orderId: string, offerId: string) => {
    const res = await api.post(`/api/v1/orders/${orderId}/dispute/offers/${offerId}/accept`, {});
    return res.data;
  },

  // Danh sách dịch vụ thêm (Add-on) của đơn (GET /api/v1/orders/:orderId/addons)
  listAddons: async (orderId: string) => {
    const res = await api.get<AddonItem[]>(`/api/v1/orders/${orderId}/addons`);
    return Array.isArray(res.data) ? res.data : [];
  },

  // Vườn tạo đề xuất add-on mới (POST /api/v1/orders/:orderId/addons)
  createAddon: async (
    orderId: string,
    payload: {
      title: string;
      reason: string;
      price: string;
      photoUrls: string[];
      plantId?: string;
    },
  ) => {
    const res = await api.post<AddonItem>(`/api/v1/orders/${orderId}/addons`, payload);
    return res.data;
  },

  // Vườn báo đã làm xong add-on (POST /api/v1/orders/:orderId/addons/:addonId/complete)
  // Vườn trả lại add-on khách đã trả tiền mà vườn không làm được (chỉ khi add-on PAID và đơn IN_CARE).
  // Khách nhận lại đủ giá + 6%, BE tạo lệnh chi ngay. Lý do 5–500 ký tự, khách đọc được.
  refundAddon: async (orderId: string, addonId: string, reason: string) => {
    const res = await api.post<AddonItem>(`/api/v1/orders/${orderId}/addons/${addonId}/refund`, {
      reason: reason.trim(),
    });
    return res.data;
  },

  completeAddon: async (
    orderId: string,
    addonId: string,
    payload: {
      photoUrls: string[];
      note: string;
      plantHealthAfter?: 'GOOD' | 'AVERAGE' | 'POOR';
    },
  ) => {
    const res = await api.post<AddonItem>(
      `/api/v1/orders/${orderId}/addons/${addonId}/complete`,
      payload,
    );
    return res.data;
  },
};

export type AddonStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PAID'
  | 'DONE'
  | 'REJECTED'
  | 'EXPIRED'
  | 'REFUNDED'; // vườn trả lại add-on khách đã trả tiền → khách được hoàn giá + 6%

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
  refundedAt?: string | null;
  refundReason?: string | null;
  createdAt: string;
}

export type DisputeStatus = 'NEGOTIATING' | 'ADMIN_REVIEW' | 'RESOLVED';
// Đúng mã BE (orders/dispute-rules.ts DISPUTE_OUTCOMES).
export type DisputeOutcome = 'AGREED' | 'WITHDRAWN' | 'ADJUDICATED';

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

// Giữ lại type cũ để tránh compile break nếu còn tham chiếu
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


