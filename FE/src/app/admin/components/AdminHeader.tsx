'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { App, Avatar, Drawer, Input } from 'antd';
import { MenuOutlined, SearchOutlined } from '@ant-design/icons';
import NotificationBell from '@/features/notifications/NotificationBell';
import { useAuthStore } from '@/lib/auth.store';
import AdminSidebar from './AdminSidebar';

interface AdminHeaderProps {
  searchPlaceholder?: string;
}

export default function AdminHeader({ searchPlaceholder = 'Tìm kiếm giao dịch, người dùng...' }: AdminHeaderProps) {
  const user = useAuthStore((state) => state.user);
  const { message } = App.useApp();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Chọn một mục trong menu (đổi trang) thì đóng ngăn kéo.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header className="h-16 bg-white border-b border-[#ECE7FA] px-4 lg:px-6 flex items-center justify-between gap-3 flex-shrink-0 z-10">
      <div className="flex items-center gap-3 min-w-0">
        {/* Màn hình nhỏ: sidebar ẩn, mở bằng nút menu */}
        <button
          type="button"
          aria-label="Mở menu"
          onClick={() => setMenuOpen(true)}
          className="lg:hidden w-9 h-9 rounded-xl bg-[#F6F4FC] text-[#6027D2] flex items-center justify-center hover:bg-[#ECE7FA] transition-colors shrink-0"
        >
          <MenuOutlined className="text-lg" />
        </button>

        {/* Search Bar */}
        <div className="hidden md:block md:w-72 lg:w-96">
          <Input
            prefix={<SearchOutlined className="text-[#A098C2] mr-1" />}
            placeholder={searchPlaceholder}
            className="!rounded-xl !bg-[#F6F4FC] !border-none !py-2 text-sm text-[#1E1B2E]"
          />
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        <NotificationBell />

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

      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="left"
        width={272}
        closable={false}
        styles={{ body: { padding: 0 } }}
      >
        <AdminSidebar variant="drawer" />
      </Drawer>
    </header>
  );
}
