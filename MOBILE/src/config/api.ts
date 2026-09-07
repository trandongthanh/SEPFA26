import axios from 'axios';
import { Platform } from 'react-native';

// Tự động xác định IP phù hợp cho môi trường chạy Expo/React Native:
// - Android Emulator: 10.0.2.2
// - iOS Simulator / Web: localhost
// - Thiết bị thật: đổi IP thành IP máy tính trong cùng mạng Wi-Fi (ví dụ: http://192.168.1.10:3001)
const DEV_API_URL = Platform.select({
  android: 'http://10.0.2.2:3001/api/v1',
  ios: 'http://localhost:3001/api/v1',
  default: 'http://localhost:3001/api/v1',
});

const rawBaseUrl = process.env.EXPO_PUBLIC_API_URL || DEV_API_URL;
export const API_BASE_URL = rawBaseUrl.endsWith('/api/v1')
  ? rawBaseUrl
  : `${rawBaseUrl.replace(/\/$/, '')}/api/v1`;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});
