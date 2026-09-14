'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, App } from 'antd';
import { DashboardOutlined, LogoutOutlined, RocketOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/lib/auth.store';
import { authApi } from '@/lib/api';

export default function ComingSoonPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { message } = App.useApp();

  const user = useAuthStore((state) => state.user);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  // Chờ Zustand hydrate xong trước khi kiểm tra auth
  useEffect(() => {
    setMounted(true);
  }, []);

  // Guard: chưa đăng nhập → về trang login; nếu là Provider → về /provider/dashboard
  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated) {
      router.replace('/auth/login');
      return;
    }
    if (user?.role === 'PROVIDER') {
      router.replace('/provider/dashboard');
    }
  }, [mounted, isAuthenticated, user, router]);

  const handleLogout = async () => {
    try {
      setLoading(true);
      await authApi.logout(refreshToken ?? undefined);
    } catch {
      // API lỗi (token hết hạn,...) vẫn xóa state cục bộ
    } finally {
      clearAuth();
      message.success('Đã đăng xuất thành công.');
      router.push('/auth/login');
    }
  };

  // Hiển thị trống trong khi chờ hydrate / đang redirect
  if (!mounted || !isAuthenticated) return null;

  return (
    <main className="min-h-screen w-full flex items-center justify-center p-4 bg-[#F6F4FC]">
      <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center shadow-[0_10px_30px_rgba(96,39,210,0.06)] border border-[#ECE7FA]">
        <img
          src="/logo_app.png"
          alt="LanCare Hub Logo"
          className="w-20 h-20 object-contain mx-auto mb-3"
        />

        <h1 className="text-2xl font-bold text-[#1E1B2E] mb-2">
          Coming Soon
        </h1>
        <p className="text-sm text-[#6E6A8A] mb-6">
          Chào mừng {user?.fullName ? <strong className="text-[#6027D2]">{user.fullName}</strong> : 'bạn'}! Tính năng đang được hoàn thiện.
        </p>

        <div className="flex flex-col gap-3">
          {user?.role === 'PROVIDER' && (
            <Button
              type="primary"
              icon={<DashboardOutlined />}
              onClick={() => router.push('/provider/dashboard')}
              className="!h-11 !px-6 !rounded-xl !bg-[#6027D2] !font-bold"
            >
              Vào Bảng điều khiển Provider
            </Button>
          )}

          <Button
            type="default"
            icon={<LogoutOutlined />}
            onClick={handleLogout}
            loading={loading}
            className="!h-10 !px-6 !rounded-xl"
          >
            Đăng xuất
          </Button>
        </div>
      </div>
    </main>
  );
}

