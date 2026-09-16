'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/auth.store';

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
    if (user?.role === 'ADMIN') {
      router.replace('/admin/verify/providers');
    } else if (user?.role === 'PROVIDER') {
      router.replace('/provider/dashboard');
    } else {
      router.replace('/coming-soon');
    }
  }, [mounted, isAuthenticated, user, router]);

  return null;
}

