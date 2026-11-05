'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ProviderPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/provider/dashboard');
  }, [router]);

  return null;
}
