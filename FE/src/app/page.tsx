'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth.store';
import { homePathForRole } from '@/features/auth/homePath';

export default function RootPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated) {
      router.replace('/auth/login');
      return;
    }
    if (user?.role === 'ADMIN' || user?.role === 'PROVIDER') {
      router.replace(homePathForRole(user.role));
    } else {
      // Khách hàng không dùng web (dùng app điện thoại). Trước đây chuyển sang /coming-soon
      // (trang không tồn tại → 404); giờ xoá phiên và về trang đăng nhập, tránh vòng lặp chuyển trang.
      clearAuth();
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, user, router, clearAuth]);

  return null;
}

