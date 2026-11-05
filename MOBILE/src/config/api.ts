import axios from 'axios';
import { Platform } from 'react-native';
import { storage } from '../utils/storage';
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

apiClient.interceptors.request.use(
  async (config) => {
    try {
      const token = await storage.getToken();
      if (token && config.headers) {
        if (typeof (config.headers as any).set === 'function') {
          (config.headers as any).set('Authorization', `Bearer ${token}`);
        }
        config.headers['Authorization'] = `Bearer ${token}`;
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (e) {
      console.error('Failed to attach token to request:', e);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

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
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((newToken) => {
            if (originalRequest.headers) {
              originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
            }
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await storage.getRefreshToken();
        if (refreshToken) {
          const res = await axios.post(`${API_BASE_URL}/auth/refresh`, {
            refreshToken,
          });
          const { accessToken, refreshToken: newRefresh } = res.data;
          await storage.setToken(accessToken, newRefresh || refreshToken);
          if (originalRequest.headers) {
            originalRequest.headers['Authorization'] = `Bearer ${accessToken}`;
          }
          processQueue(null, accessToken);
          return apiClient(originalRequest);
        } else {
          processQueue(new Error('No refresh token available'), null);
        }
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        // Refresh token expired or invalid -> clear tokens and redirect to Login
        try {
          await storage.clearAll();
          if (navigationRef.isReady()) {
            navigationRef.reset({
              index: 0,
              routes: [{ name: 'Login' }],
            });
          }
        } catch (e) {}
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

