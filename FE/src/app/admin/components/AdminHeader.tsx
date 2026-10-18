'use client';

import { App, Avatar, Input } from 'antd';
import { BellOutlined, SearchOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/lib/auth.store';

interface AdminHeaderProps {
  searchPlaceholder?: string;
}

export default function AdminHeader({ searchPlaceholder = 'Tìm kiếm giao dịch, người dùng...' }: AdminHeaderProps) {
  const user = useAuthStore((state) => state.user);
  const { message } = App.useApp();

  return (
    <header className="h-16 bg-white border-b border-[#ECE7FA] px-6 flex items-center justify-between gap-4 flex-shrink-0 z-10">
      {/* Search Bar */}
      <div className="w-96">
        <Input
          prefix={<SearchOutlined className="text-[#A098C2] mr-1" />}
          placeholder={searchPlaceholder}
          className="!rounded-xl !bg-[#F6F4FC] !border-none !py-2 text-sm text-[#1E1B2E]"
        />
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => message.info('Thông báo hệ thống')}
          className="w-9 h-9 rounded-xl bg-[#F6F4FC] text-[#6E6A8A] flex items-center justify-center hover:bg-[#ECE7FA] transition-colors"
        >
          <BellOutlined className="text-lg" />
        </button>

        {/* Admin Avatar */}
        <div className="flex items-center gap-2 pl-3 border-l border-[#ECE7FA]">
          <Avatar size={36} className="!bg-[#6027D2] text-white font-semibold shrink-0">
            {user?.fullName?.charAt(0)?.toUpperCase() || 'A'}
          </Avatar>
          <span className="text-sm font-medium text-[#1E1B2E] hidden lg:block">
            {user?.fullName || 'Admin'}
          </span>
        </div>
      </div>
    </header>
  );
}
