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

// ===== Axios instance duy nhất =====

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
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

// ===== Request interceptor: tự động gắn Bearer token =====

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken && config.headers) {
    config.headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return config;
});

// ===== Response interceptor: silent-refresh khi nhận 401 =====

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

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
      return Promise.reject(error);
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
};
