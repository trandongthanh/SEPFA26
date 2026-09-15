'use client';

import React from 'react';
import { Avatar, Input, message } from 'antd';
import { BellOutlined, MailOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { ProviderProfileResponse } from '@/lib/provider.api';
import { useAuthStore } from '@/lib/auth.store';

interface ProviderHeaderProps {
  profile: ProviderProfileResponse | null;
  pendingCount?: number;
}

export default function ProviderHeader({ profile, pendingCount = 0 }: ProviderHeaderProps) {
  const user = useAuthStore((state) => state.user);

  return (
    <header className="h-16 bg-white border-b border-[#ECE7FA] px-6 flex items-center justify-between gap-4 flex-shrink-0 z-10">
      {/* Search Bar */}
      <div className="w-96">
        <Input
          prefix={<SearchOutlined className="text-[#A098C2] mr-1" />}
          placeholder="Tìm kiếm gói dịch vụ, đơn hàng..."
          className="!rounded-xl !bg-[#F6F4FC] !border-none !py-2 text-sm text-[#1E1B2E]"
        />
      </div>

      {/* Right Header Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => message.info('Thông báo hệ thống')}
          className="w-9 h-9 rounded-xl bg-[#F6F4FC] text-[#6E6A8A] flex items-center justify-center hover:bg-[#ECE7FA] transition-colors relative"
        >
          <BellOutlined className="text-lg" />
          {pendingCount > 0 && (
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#E53E3E]" />
          )}
        </button>

        <button
          onClick={() => message.info('Tin nhắn khách hàng')}
          className="w-9 h-9 rounded-xl bg-[#F6F4FC] text-[#6E6A8A] flex items-center justify-center hover:bg-[#ECE7FA] transition-colors"
        >
          <MailOutlined className="text-lg" />
        </button>

        <button
          onClick={() => message.info('Cài đặt hệ thống')}
          className="w-9 h-9 rounded-xl bg-[#F6F4FC] text-[#6E6A8A] flex items-center justify-center hover:bg-[#ECE7FA] transition-colors"
        >
          <SettingOutlined className="text-lg" />
        </button>

        {/* Profile User Avatar */}
        <div className="flex items-center gap-2 pl-2 border-l border-[#ECE7FA]">
          <Avatar size={36} className="!bg-[#6027D2] text-white font-semibold shrink-0">
            {profile?.displayName?.charAt(0) || user?.fullName?.charAt(0) || 'P'}
          </Avatar>
        </div>
      </div>
    </header>
  );
}
