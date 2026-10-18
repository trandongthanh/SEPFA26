import axios from 'axios';
import { Platform } from 'react-native';

// @ts-ignore
import Constants from 'expo-constants';

// Tự động lấy IP máy tính từ Expo Host URI để điện thoại thật kết nối Backend chuẩn xác
function getAutoDevApiUrl(): string {
  // 1. Nếu đang chạy trên Expo Go / Dev Client: Lấy IP động từ Metro Bundler
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any).manifest?.debuggerHost;
  if (hostUri) {
    const hostIp = hostUri.split(':')[0];
    if (hostIp && hostIp !== 'localhost' && hostIp !== '127.0.0.1') {
      return `http://${hostIp}:3001/api/v1`;
    }
  }

  // 2. Nếu là bản build độc lập (APK), đọc từ biến môi trường
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // 3. IP LAN hiện tại của máy tính
  const defaultHost = '192.168.88.128';
  return `http://${defaultHost}:3001/api/v1`;
}

const rawBaseUrl = getAutoDevApiUrl();
export const API_BASE_URL = rawBaseUrl.endsWith('/api/v1')
  ? rawBaseUrl
  : `${rawBaseUrl.replace(/\/$/, '')}/api/v1`;

// Backend WebSocket URL (namespace /ws cho Video Call & Notifications)
export const BACKEND_WS_URL = API_BASE_URL.replace(/\/api\/v1\/?$/, '') + '/ws';

// FE Web URL for Video Calls room
// LƯU Ý: Android WebView CHỈ hỗ trợ navigator.mediaDevices.getUserMedia trên HTTPS hoặc localhost (Secure Context).
// Kết nối qua HTTPS Cloudflare Tunnel giúp bật Camera & Micro 100% không bị lỗi undefined getUserMedia.
export const FE_WEB_URL =
  process.env.EXPO_PUBLIC_FE_URL ||
  'https://discussed-gale-hiring-elizabeth.trycloudflare.com';

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
      const { storage } = await import('../utils/storage');
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

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest?._retry) {
      originalRequest._retry = true;
      try {
        const { storage } = await import('../utils/storage');
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
          return apiClient(originalRequest);
        }
      } catch (refreshErr) {
        // Refresh token expired or invalid
      }
    }
    return Promise.reject(error);
  }
);

