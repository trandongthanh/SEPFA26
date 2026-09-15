'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth.store';

// Trang gốc / chỉ làm nhiệm vụ điều hướng:
// - Provider → /provider/dashboard
// - Khách hàng / Khác → /coming-soon
// - Chưa đăng nhập → /auth/login
export default function RootPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
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
    if (user?.role === 'PROVIDER') {
      router.replace('/provider/dashboard');
    } else {
      router.replace('/coming-soon');
    }
  }, [mounted, isAuthenticated, user, router]);

  return null;
}

