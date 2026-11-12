import axios from 'axios';
import { Platform } from 'react-native';
import { storage, onTokenChange } from '../utils/storage';
import { navigationRef } from '../navigation/navigationRef';

// @ts-ignore
import Constants from 'expo-constants';

// Tự động lấy IP máy tính từ Expo Host URI để điện thoại thật kết nối Backend chuẩn xác
function getAutoDevApiUrl(): string {
  // 1. Ưu tiên biến môi trường EXPO_PUBLIC_API_URL nếu có (ví dụ trỏ tới Backend Render)
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // 2. Nếu đang chạy trên Expo Go / Dev Client: Lấy IP động từ Metro Bundler
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any).manifest?.debuggerHost;
  if (hostUri) {
    const hostIp = hostUri.split(':')[0];
    if (hostIp && hostIp !== 'localhost' && hostIp !== '127.0.0.1') {
      return `http://${hostIp}:3001/api/v1`;
    }
  }

  // 3. Backend Render đã deploy chính thức
  return 'https://lancare-hub-api.onrender.com/api/v1';
}

const rawBaseUrl = getAutoDevApiUrl();
export const API_BASE_URL = rawBaseUrl.endsWith('/api/v1')
  ? rawBaseUrl
  : `${rawBaseUrl.replace(/\/$/, '')}/api/v1`;

// Backend WebSocket URL (namespace /ws cho Video Call & Notifications)
export const BACKEND_WS_URL = API_BASE_URL.replace(/\/api\/v1\/?$/, '') + '/ws';

// FE Web URL for Video Calls room
export const FE_WEB_URL =
  process.env.EXPO_PUBLIC_FE_URL ||
  'https://lancare-hub-xi.vercel.app';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

function applyAuthHeader(headers: any, token: string) {
  if (!headers) return;
  if (typeof headers.set === 'function') {
    headers.set('Authorization', `Bearer ${token}`);
  }
  headers['Authorization'] = `Bearer ${token}`;
  headers.Authorization = `Bearer ${token}`;
}

function extractBearerToken(headers: any): string | null {
  if (!headers) return null;
  const raw =
    typeof headers.get === 'function'
      ? headers.get('Authorization') || headers.get('authorization')
      : headers['Authorization'] || headers.Authorization || headers['authorization'];
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

onTokenChange((token) => {
  if (token) {
    applyAuthHeader(apiClient.defaults.headers.common, token);
  } else {
    delete (apiClient.defaults.headers.common as any)['Authorization'];
  }
});

apiClient.interceptors.request.use(
  async (config) => {
    try {
      const token = await storage.getToken();
      if (token && config.headers) {
        applyAuthHeader(config.headers, token);
      }
    } catch (e) {
      console.error('Failed to attach token to request:', e);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ===== Mutex dùng chung cho cả REST & WebSocket: tránh gọi /auth/refresh song song làm xoay vòng token =====
let refreshPromise: Promise<string> | null = null;

export async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const refreshToken = await storage.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }
    const res = await axios.post(`${API_BASE_URL}/auth/refresh`, {
      refreshToken,
    });
    const { accessToken, refreshToken: newRefresh } = res.data;
    await storage.setToken(accessToken, newRefresh || refreshToken);
    return accessToken as string;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

// Chuyển đổi các mã lỗi kỹ thuật / lỗi phần mềm sang thông báo tiếng Việt thân thiện cho người dùng
const ERROR_CODE_MAP: Record<string, string> = {
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
  CCCD_NUMBER_EXISTS: 'Số Căn cước công dân này đã được đăng ký trên hệ thống.',
  IDENTITY_LOCKED_AFTER_APPROVAL: 'Thông tin định danh đã được phê duyệt nên không thể tự ý chỉnh sửa.',
  CUSTOMER_IDENTITY_DOCUMENTS_REQUIRED: 'Vui lòng cung cấp đầy đủ số CCCD, ảnh 2 mặt và ảnh chân dung.',
  PROVIDER_PROFILE_NOT_SUBMITTED: 'Hồ sơ nhà vườn chưa đủ thông tin định danh (SĐT, số CCCD và ảnh giấy tờ).',
  PROVIDER_PROFILE_FIELDS_REQUIRED: 'Vui lòng nhập đầy đủ tên hiển thị và loại hình nhà vườn.',
  PROVIDER_IDENTITY_INCOMPLETE: 'Vui lòng bổ sung đầy đủ Số điện thoại và Số CCCD trong Hồ sơ trước khi thực hiện.',
  PROFILE_NOT_FOUND: 'Vui lòng hoàn thiện hồ sơ trước khi thực hiện thao tác này.',
  PROFILE_NOT_APPROVED: 'Hồ sơ của bạn cần được quản trị viên phê duyệt trước khi thực hiện thao tác này.',
  CUSTOMER_PROFILE_NOT_FOUND: 'Vui lòng cập nhật thông tin hồ sơ cá nhân trước.',
  PROVIDER_PROFILE_NOT_FOUND: 'Chưa tìm thấy thông tin hồ sơ nhà vườn.',
  GPS_PAIR_REQUIRED: 'Vui lòng chọn vị trí tọa độ trên bản đồ.',
  PROVIDER_GPS_MISSING: 'Nhà vườn này chưa cập nhật vị trí nhận cây. Vui lòng chọn nhà vườn khác.',
  DISTANCE_SERVICE_UNAVAILABLE: 'Hệ thống tính khoảng cách đang tạm bận. Vui lòng thử lại sau giây lát.',
  OSRM_NOT_CONFIGURED: 'Hệ thống định tuyến đang bảo trì. Vui lòng thử lại sau.',
  PICKUP_TIME_IN_PAST: 'Thời gian hẹn lấy cây phải lớn hơn thời điểm hiện tại.',
  PLANT_COUNT_EXCEEDS_PACKAGE: 'Số lượng chậu cây vượt quá giới hạn tối đa của gói dịch vụ.',
  MISSING_INITIAL_PHOTO: 'Vui lòng chụp ít nhất 1 ảnh hiện trạng ban đầu cho mỗi chậu cây.',
  DECLARED_VALUE_REQUIRED: 'Vui lòng nhập giá trị khai báo cho chậu cây.',
  DECLARED_VALUE_OUT_OF_RANGE: 'Giá trị khai báo của cây nằm ngoài phạm vi nhận chăm sóc của gói dịch vụ này.',
  DECLARED_VALUE_RANGE_INVALID: 'Khoảng giá trị khai báo tối thiểu và tối đa chưa hợp lệ.',
  INVALID_STATE_TRANSITION: 'Trạng thái đơn hàng vừa được cập nhật. Vui lòng tải lại trang.',
  ORDER_NOT_FOUND: 'Không tìm thấy thông tin đơn hàng.',
  SERVICE_ORDER_NOT_FOUND: 'Không tìm thấy thông tin đơn hàng.',
  ORDER_NOT_EDITABLE: 'Đơn hàng đã gửi nên không thể chỉnh sửa thêm.',
  ORDER_NOT_IN_CARE: 'Chỉ có thể thực hiện thao tác này khi đơn hàng đang trong giai đoạn chăm sóc.',
  CARE_NOT_DUE: 'Gói chăm sóc chưa đến hạn trả cây.',
  CARE_REPORT_NOT_FOUND: 'Không tìm thấy báo cáo chăm sóc.',
  CUSTOMER_NOT_ALLOWED: 'Bạn không có quyền xem báo cáo này.',
  ORDER_NOT_CALLABLE: 'Đơn hàng ở trạng thái hiện tại không hỗ trợ gọi video.',
  VIDEO_CALL_IN_PROGRESS: 'Đang có một cuộc gọi video khác diễn ra trên đơn hàng này.',
  VIDEO_CALL_ENDED: 'Cuộc gọi video này đã kết thúc.',
  VIDEO_CALL_NOT_RINGING: 'Cuộc gọi không còn đổ chuông.',
  VIDEO_PROVIDER_UNAVAILABLE: 'Dịch vụ gọi video đang tạm bận. Vui lòng thử lại sau.',
  EKYC_ALREADY_VERIFIED: 'Tài khoản của bạn đã hoàn tất xác thực định danh trước đó.',
  EKYC_OCR_FAILED: 'Không thể đọc thông tin trên thẻ CCCD. Vui lòng chụp lại rõ nét và đủ ánh sáng.',
  EKYC_OCR_NOT_COMPLETED: 'Vui lòng thực hiện bước quét mặt trước thẻ CCCD trước.',
  EKYC_FACE_MATCH_API_ERROR: 'Hệ thống nhận diện khuôn mặt đang bận. Vui lòng thử lại hoặc gửi duyệt thủ công.',
  EKYC_NOT_FOUND: 'Chưa tìm thấy thông tin phiên xác thực.',
  EKYC_IMAGE_NOT_FOUND: 'Không tìm thấy hình ảnh giấy tờ.',
  IMAGE_FILE_REQUIRED: 'Vui lòng chọn hình ảnh để tải lên.',
  IMAGE_FILE_INVALID: 'Định dạng ảnh không hợp lệ (chỉ hỗ trợ JPG, PNG, WEBP).',
  IMAGE_FILE_TOO_LARGE: 'Kích thước ảnh quá lớn (tối đa 5MB). Vui lòng chọn ảnh nhẹ hơn.',
};

export function toFriendlyUserMessage(raw: unknown): string {
  if (!raw) return 'Hệ thống đang bận, vui lòng thử lại sau.';
  const text = Array.isArray(raw) ? raw.join('\n') : String(raw).trim();

  // Giữ nguyên mã đặc biệt cho luồng Google Sign-In chưa đăng ký
  if (text === 'GOOGLE_ACCOUNT_NOT_REGISTERED') return text;

  if (ERROR_CODE_MAP[text]) return ERROR_CODE_MAP[text];

  // Nếu là lỗi nghiệp vụ từ AI (ví dụ: chụp nhầm mặt sau CCCD, không phát hiện được khuôn mặt), bỏ tiền tố kỹ thuật và giữ nguyên thông báo tiếng Việt
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

  // Làm sạch các lý do từ chối eKYC có chứa thông số nội bộ (similarity=..., fraud_score=..., liveness...)
  if (/Khuôn mặt không khớp.*similarity=|không trùng khớp.*độ tương đồng:/i.test(text)) {
    return 'Khuôn mặt trên ảnh chân dung chưa khớp với ảnh trên thẻ CCCD. Vui lòng chụp lại rõ mặt nơi đủ ánh sáng.';
  }
  if (/thẻ giả mạo.*fraud_score=|chụp lại từ màn hình.*điểm rủi ro:/i.test(text)) {
    return 'Ảnh thẻ CCCD chưa đạt yêu cầu (có thể bị mờ, chói sáng hoặc chụp qua màn hình). Vui lòng chụp trực tiếp thẻ CCCD gốc rõ nét.';
  }
  if (/selfie giả mạo|liveness_score=|kiểm tra người thật.*liveness=/i.test(text)) {
    return 'Ảnh chân dung chưa rõ nét hoặc chưa chụp trực tiếp. Vui lòng tự chụp lại khuôn mặt thật tại nơi đủ ánh sáng.';
  }

  // Ẩn các câu thông báo kỹ thuật / dev (localhost, python main.py, AI Service, Cloudinary, SQL, Axios...)
  if (
    /localhost|127\.0\.0\.1|python\s+main\.py|AI Service|AI_SERVICE_URL|ECONNREFUSED|fetch failed/i.test(text)
  ) {
    return 'Hệ thống nhận diện tự động đang tạm bảo trì. Bạn vui lòng thử lại sau hoặc gửi ảnh xác minh tại mục Hồ sơ cá nhân nhé!';
  }
  if (/CLOUDINARY|UploadApi|stream/i.test(text)) {
    return 'Không thể xử lý hình ảnh lúc này. Vui lòng thử lại sau giây lát.';
  }
  if (/Request failed with status code|Network Error|timeout of|Internal server error|Bad Gateway|Service Unavailable/i.test(text)) {
    return 'Kết nối đến máy chủ bị gián đoạn hoặc hệ thống đang bận. Vui lòng thử lại sau.';
  }
  // Nếu là mã lỗi IN_HOA_CÓ_GẠCH_DƯỚI chưa có trong map
  if (/^[A-Z0-9_]{5,}$/.test(text)) {
    return 'Không thể thực hiện yêu cầu lúc này. Vui lòng kiểm tra lại thông tin và thử lại.';
  }

  return text;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh') &&
      !originalRequest.url?.includes('/auth/login')
    ) {
      originalRequest._retry = true;
      const sentToken = extractBearerToken(originalRequest.headers);
      const currentToken = await storage.getToken();

      // Nếu trong lúc request chạy đã có token mới (vừa đăng nhập lại hoặc vừa refresh xong), dùng luôn token mới
      if (currentToken && currentToken !== sentToken) {
        applyAuthHeader(originalRequest.headers, currentToken);
        return apiClient(originalRequest);
      }

      try {
        const newAccessToken = await refreshAccessToken();
        applyAuthHeader(originalRequest.headers, newAccessToken);
        return apiClient(originalRequest);
      } catch (refreshErr) {
        // Chỉ xóa phiên nếu không có phiên đăng nhập mới nào vừa được ghi đè trong lúc refresh
        try {
          const latestToken = await storage.getToken();
          if (!latestToken || latestToken === sentToken) {
            await storage.clearAll();
            if (navigationRef.isReady()) {
              navigationRef.reset({
                index: 0,
                routes: [{ name: 'Login' }],
              });
            }
          }
        } catch (e) {}
      }
    }

    // Làm sạch thông báo lỗi trước khi trả về cho các màn hình hiển thị
    if (error?.response?.data && typeof error.response.data === 'object') {
      const rawMsg = error.response.data.message;
      if (rawMsg && rawMsg !== 'GOOGLE_ACCOUNT_NOT_REGISTERED') {
        error.response.data.rawCode = rawMsg;
        error.response.data.message = toFriendlyUserMessage(rawMsg);
      }
    }
    if (error?.message && error.message !== 'GOOGLE_ACCOUNT_NOT_REGISTERED') {
      error.message = toFriendlyUserMessage(error.message);
    }

    return Promise.reject(error);
  }
);

