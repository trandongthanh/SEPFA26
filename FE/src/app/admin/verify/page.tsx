'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminVerifyIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/verify/providers');
  }, [router]);

  return null;
}
