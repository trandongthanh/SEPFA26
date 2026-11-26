'use client';

import React from 'react';
import Link from 'next/link';
import { Avatar } from 'antd';
import NotificationBell from '@/features/notifications/NotificationBell';
import { ProviderProfileResponse } from '@/lib/provider.api';
import { useAuthStore } from '@/lib/auth.store';

interface ProviderHeaderProps {
  profile: ProviderProfileResponse | null;
  pendingCount?: number;
}

export default function ProviderHeader({ profile, pendingCount = 0 }: ProviderHeaderProps) {
  const user = useAuthStore((state) => state.user);

  return (
    <header className="h-16 bg-white border-b border-[#ECE7FA] px-6 flex items-center justify-end gap-4 flex-shrink-0 z-10">
      {/* Ô tìm kiếm chung đã bỏ (chưa từng hoạt động) — mỗi trang danh sách có ô tìm kiếm riêng. */}
      {/* Right Header Controls */}
      <div className="flex items-center gap-4">
        <NotificationBell />

        {/* Profile User Avatar */}
        <div className="flex items-center gap-2 pl-2 border-l border-[#ECE7FA]">
          <Link
            href="/provider/profile"
            title="Hồ sơ nhà vườn"
            className="rounded-full transition-all hover:ring-2 hover:ring-[#DDD6FE]"
          >
            <Avatar size={36} className="!bg-[#6027D2] text-white font-semibold shrink-0 cursor-pointer">
              {profile?.displayName?.charAt(0) || user?.fullName?.charAt(0) || 'P'}
            </Avatar>
          </Link>
        </div>
      </div>
    </header>
  );
}
