import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from './auth.store';

// ===== Kiểu dữ liệu khớp với BE DTO =====

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  role?: 'CUSTOMER' | 'PROVIDER';
  providerType?: 'NURSERY' | 'EXPERT';
  gpsLat?: number;
  gpsLng?: number;
}

export interface AccountSummary {
  id: string;
  fullName: string;
  role: string;
}

export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  account?: AccountSummary;
}

export interface RegisterResponse {
  accountId: string;
  email: string;
  role: string;
  status: string;
}

export interface GoogleLoginPayload {
  idToken: string;
  role?: 'CUSTOMER' | 'PROVIDER';
}

export interface GoogleAuthResponse extends AuthTokensResponse {
  isNewAccount?: boolean;
}

// ===== Axios instance duy nhất =====

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://lancare-hub-api.onrender.com',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// ===== Mutex: tránh nhiều request cùng lúc đều gọi /auth/refresh =====

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token!);
  });
  failedQueue = [];
}

// ===== Request interceptor: tự động gắn Bearer token (chủ động refresh nếu reload trang) =====

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  let { accessToken } = useAuthStore.getState();
  const { refreshToken, setTokens, clearAuth } = useAuthStore.getState();

  // Khi reload trang (F5): accessToken trong RAM bị mất nhưng refreshToken vẫn còn trong localStorage.
  // Chủ động gọi refresh trước khi gửi request để tránh bị lỗi 401 trên console trình duyệt.
  if (!accessToken && refreshToken && !config.url?.includes('/auth/')) {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const baseURL = config.baseURL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://lancare-hub-api.onrender.com';
        const res = await axios.post<AuthTokensResponse>(`${baseURL}/api/v1/auth/refresh`, { refreshToken });
        accessToken = res.data.accessToken;
        setTokens({ accessToken: res.data.accessToken, refreshToken: res.data.refreshToken });
        processQueue(null, accessToken);
      } catch (err) {
        processQueue(err, null);
        clearAuth();
      } finally {
        isRefreshing = false;
      }
    } else {
      accessToken = await new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      });
    }
  }

  if (accessToken && config.headers) {
    config.headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return config;
});

// ===== Response interceptor: silent-refresh khi nhận 401 & chuẩn hóa thông báo lỗi người dùng =====

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

const FE_ERROR_CODE_MAP: Record<string, string> = {
  Unauthorized: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  INVALID_REFRESH_TOKEN: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  REFRESH_TOKEN_REUSED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  Forbidden: 'Bạn không có quyền thực hiện thao tác này.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu không chính xác.',
  ACCOUNT_SUSPENDED: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.',
  ACCOUNT_INACTIVE: 'Tài khoản của bạn đang chờ phê duyệt.',
  ACCOUNT_NOT_FOUND: 'Không tìm thấy thông tin tài khoản.',
  CURRENT_PASSWORD_INCORRECT: 'Mật khẩu hiện tại không chính xác.',
  EMAIL_EXISTS: 'Email này đã được sử dụng bởi tài khoản khác.',
  PHONE_EXISTS: 'Số điện thoại này đã được sử dụng bởi tài khoản khác.',
  CCCD_NUMBER_EXISTS: 'Số Căn cước công dân này đã được đăng ký bởi nhà vườn khác.',
  IDENTITY_LOCKED_AFTER_APPROVAL: 'Thông tin định danh đã được phê duyệt nên không thể chỉnh sửa.',
  CUSTOMER_IDENTITY_DOCUMENTS_REQUIRED: 'Hồ sơ khách hàng chưa đủ số CCCD và 3 ảnh xác minh.',
  PROVIDER_PROFILE_NOT_SUBMITTED: 'Hồ sơ nhà vườn chưa đủ điều kiện phê duyệt (Cần đủ: Số điện thoại, Số CCCD 12 chữ số, ảnh CCCD 2 mặt và ảnh chân dung).',
  PROVIDER_PROFILE_FIELDS_REQUIRED: 'Vui lòng nhập đầy đủ Loại hình đối tác và Tên nhà vườn hiển thị.',
  PROVIDER_IDENTITY_INCOMPLETE: 'Vui lòng cập nhật đầy đủ Số điện thoại và Số CCCD (12 chữ số) tại mục Hồ sơ nhà vườn trước khi chấp nhận đơn và tạo hợp đồng!',
  PROFILE_NOT_FOUND: 'Vui lòng hoàn thiện và lưu Hồ sơ nhà vườn trước khi thực hiện thao tác này.',
  PROFILE_NOT_APPROVED: 'Chỉ nhà vườn đã được Admin phê duyệt hồ sơ mới có thể thực hiện thao tác này.',
  GPS_PAIR_REQUIRED: 'Vui lòng nhập đầy đủ cả Vĩ độ (Latitude) và Kinh độ (Longitude).',
  DECLARED_VALUE_RANGE_INVALID: 'Giá trị khai báo tối thiểu phải nhỏ hơn hoặc bằng giá trị tối đa.',
  UNASSESSED_PLANTS: 'Vui lòng thẩm định đầy đủ tất cả các chậu cây trước khi hoàn tất bàn giao.',
  ALL_PLANTS_REJECTED: 'Không thể hoàn tất bàn giao khi tất cả chậu cây đều bị từ chối.',
  FINAL_TOTAL_REQUIRED: 'Vui lòng nhập tổng chi phí điều chỉnh cuối cùng.',
  FINAL_TOTAL_EXCEEDS_CAP: 'Chi phí điều chỉnh vượt quá mức trần cho phép.',
  ORDER_NOT_FOUND: 'Không tìm thấy thông tin đơn hàng.',
  SERVICE_ORDER_NOT_FOUND: 'Không tìm thấy thông tin đơn hàng.',
  ORDER_NOT_IN_CARE: 'Chỉ có thể gửi báo cáo cho đơn hàng đang trong giai đoạn chăm sóc.',
  CARE_NOT_DUE: 'Gói chăm sóc chưa đến hạn trả cây.',
  PLANT_NOT_IN_CARE: 'Chậu cây này không thuộc danh sách đang chăm sóc.',
  REPORT_PLANTS_MISMATCH: 'Danh sách cây trong báo cáo không khớp với các cây đang chăm sóc của đơn hàng.',
  PLANT_PHOTO_REQUIRED: 'Mỗi cây cần ảnh toàn cảnh (OVERVIEW); bộ phận đánh giá Kém hoặc có sâu bệnh cần thêm ảnh cận tương ứng.',
  CARE_ACTIVITY_INVALID: 'Vui lòng nhập đầy đủ lượng nước khi đã tưới hoặc loại phân khi đã bón.',
  REPORT_PERIOD_NOT_STARTED: 'Kỳ báo cáo kế tiếp chưa bắt đầu nên chưa thể nộp.',
  ALL_PERIODS_SUBMITTED: 'Đơn hàng này đã hoàn tất nộp đủ tất cả các kỳ báo cáo.',
  CARE_REPORT_DUPLICATE: 'Báo cáo cho kỳ này đã được nộp trước đó.',
  CARE_REPORT_NOT_FOUND: 'Không tìm thấy báo cáo chăm sóc.',
  PROVIDER_NOT_ALLOWED: 'Chỉ nhà vườn đã được phê duyệt của đơn hàng mới có quyền thực hiện.',
  CUSTOMER_NOT_ALLOWED: 'Bạn không có quyền xem báo cáo này.',
  ORDER_NOT_CALLABLE: 'Đơn hàng ở trạng thái hiện tại không hỗ trợ gọi video.',
  VIDEO_CALL_IN_PROGRESS: 'Đang có một cuộc gọi video khác diễn ra trên đơn hàng này.',
  VIDEO_CALL_ENDED: 'Cuộc gọi video này đã kết thúc.',
  VIDEO_PROVIDER_UNAVAILABLE: 'Dịch vụ gọi video đang tạm bận. Vui lòng thử lại sau.',
  IMAGE_FILE_REQUIRED: 'Vui lòng chọn tệp hình ảnh.',
  IMAGE_FILE_INVALID: 'Định dạng ảnh không hợp lệ (chỉ hỗ trợ JPG, PNG, WEBP).',
  IMAGE_FILE_TOO_LARGE: 'Kích thước ảnh vượt quá giới hạn 5MB.',
  CLOUDINARY_NOT_CONFIGURED: 'Dịch vụ lưu trữ hình ảnh đang bảo trì. Vui lòng thử lại sau.',
};

function sanitizeFeErrorMessage(raw: unknown): string {
  if (!raw) return 'Hệ thống đang bận, vui lòng thử lại sau.';
  const text = Array.isArray(raw) ? raw.join(', ') : String(raw).trim();

  // Giữ nguyên các mã cần xử lý nhánh riêng ở UI (như GOOGLE_ACCOUNT_NOT_REGISTERED, INVALID_STATE_TRANSITION)
  if (text === 'GOOGLE_ACCOUNT_NOT_REGISTERED' || text === 'INVALID_STATE_TRANSITION') {
    return text;
  }

  if (FE_ERROR_CODE_MAP[text]) return FE_ERROR_CODE_MAP[text];

  const ocrHttp400Match = text.match(/^AI Service OCR lỗi HTTP 400:\s*(.+)$/i);
  if (ocrHttp400Match) {
    let detail = ocrHttp400Match[1].trim();
    try {
      const parsed = JSON.parse(detail);
      if (parsed && typeof parsed.detail === 'string') {
        detail = parsed.detail.trim();
      }
    } catch (_) {}
    if (/[\u00C0-\u1EF9]/.test(detail) && !/DeepFace|EasyOCR|OpenCV|Traceback|Exception/i.test(detail)) {
      return detail;
    }
    return 'Không nhận diện được ảnh mặt trước thẻ CCCD hợp lệ. Vui lòng chụp rõ nét mặt trước thẻ CCCD.';
  }

  if (/^AI Service FaceMatch:\s*/i.test(text)) {
    const cleaned = text.replace(/^AI Service FaceMatch:\s*/i, '').trim();
    if (/[\u00C0-\u1EF9]/.test(cleaned) && !/DeepFace|OpenCV|HTTP\s+\d+|Traceback|Exception/i.test(cleaned)) {
      return cleaned;
    }
    return 'Không thể nhận diện khuôn mặt rõ nét để đối chiếu. Vui lòng chụp lại rõ mặt và đủ ánh sáng.';
  }
  if (/Khuôn mặt không khớp.*similarity=|không trùng khớp.*độ tương đồng:/i.test(text)) {
    return 'Khuôn mặt trên ảnh chân dung chưa khớp với ảnh trên thẻ CCCD. Vui lòng chụp lại rõ mặt nơi đủ ánh sáng.';
  }
  if (/thẻ giả mạo.*fraud_score=|chụp lại từ màn hình.*điểm rủi ro:/i.test(text)) {
    return 'Ảnh thẻ CCCD chưa đạt yêu cầu (có thể bị mờ, chói sáng hoặc chụp qua màn hình). Vui lòng chụp trực tiếp thẻ CCCD gốc rõ nét.';
  }
  if (/selfie giả mạo|liveness_score=|kiểm tra người thật.*liveness=/i.test(text)) {
    return 'Ảnh chân dung chưa rõ nét hoặc chưa chụp trực tiếp. Vui lòng tự chụp lại khuôn mặt thật tại nơi đủ ánh sáng.';
  }

  if (/localhost|127\.0\.0\.1|python\s+main\.py|AI Service|AI_SERVICE_URL|ECONNREFUSED|fetch failed/i.test(text)) {
    return 'Dịch vụ xử lý tự động đang tạm bảo trì. Vui lòng thử lại sau.';
  }
  if (/Request failed with status code|Network Error|timeout of|Internal server error|Bad Gateway|Service Unavailable/i.test(text)) {
    return 'Kết nối đến máy chủ bị gián đoạn hoặc hệ thống đang bận. Vui lòng thử lại sau.';
  }
  if (/^[A-Z0-9_]{5,}$/.test(text)) {
    return 'Không thể thực hiện thao tác lúc này. Vui lòng kiểm tra lại thông tin và thử lại.';
  }

  return text;
}

function attachFriendlyError(error: AxiosError): AxiosError {
  const data = error.response?.data as Record<string, any> | undefined;
  if (data && typeof data === 'object' && data.message) {
    const rawMsg = data.message;
    if (rawMsg !== 'GOOGLE_ACCOUNT_NOT_REGISTERED' && rawMsg !== 'INVALID_STATE_TRANSITION') {
      data.rawCode = rawMsg;
      data.message = sanitizeFeErrorMessage(rawMsg);
    }
  }
  if (error.message && error.message !== 'GOOGLE_ACCOUNT_NOT_REGISTERED') {
    error.message = sanitizeFeErrorMessage(error.message);
  }
  return error;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableConfig;

    // Bỏ qua nếu không phải 401, hoặc đã retry, hoặc chính là endpoint refresh/login
    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      originalRequest.url?.includes('/auth/refresh') ||
      originalRequest.url?.includes('/auth/login')
    ) {
      return Promise.reject(attachFriendlyError(error));
    }

    const { refreshToken, setTokens, clearAuth } = useAuthStore.getState();

    if (!refreshToken) {
      clearAuth();
      if (typeof window !== 'undefined') window.location.href = '/auth/login';
      return Promise.reject(error);
    }

    // Có request khác đang refresh → đợi kết quả
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((newToken) => {
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
        return api(originalRequest);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const res = await api.post<AuthTokensResponse>('/api/v1/auth/refresh', { refreshToken });
      const { accessToken: newAccess, refreshToken: newRefresh } = res.data;
      setTokens({ accessToken: newAccess, refreshToken: newRefresh });
      processQueue(null, newAccess);
      originalRequest.headers['Authorization'] = `Bearer ${newAccess}`;
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      clearAuth();
      if (typeof window !== 'undefined') window.location.href = '/auth/login';
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

// ===== Các hàm gọi API auth (khớp đúng với BE endpoints) =====

export const authApi = {
  login: async (payload: LoginPayload) => {
    const res = await api.post<AuthTokensResponse>('/api/v1/auth/login', payload);
    return res.data;
  },

  register: async (payload: RegisterPayload) => {
    const res = await api.post<RegisterResponse>('/api/v1/auth/register', {
      ...payload,
      role: payload.role ?? 'CUSTOMER',
    });
    return res.data;
  },

  // Không gọi trực tiếp từ UI — chỉ dùng bởi interceptor
  refreshToken: async (refreshToken: string) => {
    const res = await api.post<AuthTokensResponse>('/api/v1/auth/refresh', { refreshToken });
    return res.data;
  },

  // refreshToken không bắt buộc: có → revoke 1 thiết bị; không có → revoke toàn bộ thiết bị
  logout: async (refreshToken?: string) => {
    const res = await api.post<{ success: boolean }>(
      '/api/v1/auth/logout',
      refreshToken ? { refreshToken } : {}
    );
    return res.data;
  },

  loginGoogle: async (payload: GoogleLoginPayload) => {
    const res = await api.post<GoogleAuthResponse>('/api/v1/auth/google', payload);
    return res.data;
  },
};
