'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth.store';

// Trang gốc / chỉ làm nhiệm vụ điều hướng:
// - Đã đăng nhập → /coming-soon
// - Chưa đăng nhập → /auth/login
// Dùng mounted để chờ Zustand hydrate xong từ localStorage trước khi quyết định.
export default function RootPage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    router.replace(isAuthenticated ? '/coming-soon' : '/auth/login');
  }, [mounted, isAuthenticated, router]);

  return null;
}
