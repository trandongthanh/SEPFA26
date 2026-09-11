import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccountSummary } from './api';

interface AuthState {
  user: AccountSummary | null;
  // accessToken KHÔNG persist — chỉ tồn tại trong RAM (15 phút, không cần lưu localStorage).
  // Sau khi reload trang, interceptor sẽ tự dùng refreshToken để lấy lại.
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;

  // Dùng sau khi đăng nhập lần đầu (có user + token)
  setAuth: (user: AccountSummary | undefined, tokens: { accessToken: string; refreshToken: string }) => void;
  // Dùng khi silent-refresh thành công (chỉ cập nhật token, không thay đổi user)
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setAuth: (user, tokens) =>
        set({
          user: user ?? null,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          isAuthenticated: true,
        }),

      setTokens: (tokens) =>
        set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        }),

      clearAuth: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'lancare-auth',
      // accessToken CỐ Ý không nằm ở đây — giảm thiểu rủi ro XSS đọc được token từ localStorage.
      partialize: (state) => ({
        user: state.user,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
