'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AppstoreOutlined,
  ContainerOutlined,
  CustomerServiceOutlined,
  DashboardOutlined,
  HistoryOutlined,
  LogoutOutlined,
  PlusOutlined,
  SettingOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Dropdown, message } from 'antd';
import { useAuthStore } from '@/lib/auth.store';
import { authApi } from '@/lib/api';
import { ProviderProfileResponse } from '@/lib/provider.api';

interface ProviderSidebarProps {
  profile: ProviderProfileResponse | null;
  onOpenCreatePackageModal?: () => void;
}

export default function ProviderSidebar({
  profile,
  onOpenCreatePackageModal,
}: ProviderSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const user = useAuthStore((state) => state.user);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  const handleLogout = async () => {
    try {
      await authApi.logout(refreshToken ?? undefined);
    } catch {
      // Ignore API logout error if token expired
    } finally {
      clearAuth();
      message.success('Đã đăng xuất thành công.');
      router.push('/auth/login');
    }
  };

  const navItems = [
    {
      key: '/provider/dashboard',
      label: 'Bảng điều khiển',
      icon: <DashboardOutlined className="text-base" />,
    },
    {
      key: '/provider/packages',
      label: 'Gói chăm sóc',
      icon: <AppstoreOutlined className="text-base" />,
    },
    {
      key: '/provider/orders',
      label: 'Đơn hàng chăm sóc',
      icon: <ContainerOutlined className="text-base" />,
    },
    {
      key: '/provider/reports',
      label: 'Báo cáo chăm sóc',
      icon: <HistoryOutlined className="text-base" />,
    },
  ];

  return (
    <aside
      className="w-72 h-screen border-r border-[#ECE7FA] flex flex-col justify-between p-4 flex-shrink-0 relative overflow-y-auto bg-cover bg-bottom bg-no-repeat bg-white z-20"
      style={{ backgroundImage: "url('/image_sidebar1.png')" }}
    >
      <div>
        {/* Brand Header */}
        <div
          onClick={() => router.push('/provider/dashboard')}
          className="flex items-center gap-2.5 px-1 py-2 mb-6 cursor-pointer group"
        >
          <img
            src="/logo_app.png"
            alt="LanCare Hub Logo"
            className="w-16 h-16 object-contain shrink-0 drop-shadow-sm group-hover:scale-105 transition-transform"
          />
          <div className="flex flex-col justify-center">
            <h1 className="font-logo-script text-[27px] font-bold leading-tight tracking-wide flex items-center">
              <span className="text-[#1E1B2E]">LanCare</span>
              <span className="text-[#6027D2] ml-1.5">Hub</span>
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="h-[1px] w-3 bg-[#C4B5FD]" />
              <span className="text-[10px] text-[#6E6A8A] tracking-[0.12em] font-medium whitespace-nowrap">
                Quản lý lan cao cấp
              </span>
              <span className="h-[1px] w-3 bg-[#C4B5FD]" />
            </div>
          </div>
        </div>

        {/* Primary Navigation Links */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.key;
            return (
              <button
                key={item.key}
                onClick={() => router.push(item.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 ${
                  isActive
                    ? 'bg-[#F3E8FF] text-[#6027D2] shadow-xs backdrop-blur-xs'
                    : 'text-[#4B4764] hover:bg-[#F8F6FE] hover:text-[#6027D2]'
                }`}
              >
                <span className={isActive ? 'text-[#6027D2]' : 'text-[#8B86A4]'}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}

          <button
            onClick={() => message.info('Hồ sơ nhà vườn liên kết')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm text-[#4B4764] hover:bg-[#F8F6FE] transition-colors"
          >
            <ShopOutlined className="text-base text-[#8B86A4]" />
            Hồ sơ nhà vườn
          </button>

          <button
            onClick={() => message.info('Kênh Hỗ trợ chuyên gia LanCare')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm text-[#4B4764] hover:bg-[#F8F6FE] transition-colors"
          >
            <CustomerServiceOutlined className="text-base text-[#8B86A4]" />
            Hỗ trợ chuyên gia
          </button>
        </nav>
      </div>

      {/* Sidebar Bottom Actions */}
      <div className="space-y-3 pt-4 border-t border-[#ECE7FA] bg-white/80 backdrop-blur-xs -mx-4 -mb-4 p-4">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            if (onOpenCreatePackageModal) {
              onOpenCreatePackageModal();
            } else {
              router.push('/provider/packages?create=true');
            }
          }}
          className="w-full !h-11 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold text-sm shadow-[0_4px_12px_rgba(96,39,210,0.25)]"
        >
          Đăng ký gói dịch vụ
        </Button>

        {/* User Profile Card Dropdown */}
        <Dropdown
          menu={{
            items: [
              {
                key: 'settings',
                icon: <SettingOutlined />,
                label: 'Cài đặt tài khoản',
                onClick: () => message.info('Trang cài đặt tài khoản'),
              },
              {
                type: 'divider',
              },
              {
                key: 'logout',
                icon: <LogoutOutlined />,
                label: 'Đăng xuất',
                danger: true,
                onClick: handleLogout,
              },
            ],
          }}
          placement="topRight"
          trigger={['click']}
        >
          <div className="w-full flex items-center justify-between p-2 rounded-xl bg-white/95 hover:bg-white border border-[#ECE7FA] cursor-pointer transition-all shadow-xs backdrop-blur-xs group">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar
                size={36}
                className="!bg-[#6027D2] text-white font-semibold shrink-0"
              >
                {profile?.displayName?.charAt(0)?.toUpperCase() ||
                  user?.fullName?.charAt(0)?.toUpperCase() ||
                  'P'}
              </Avatar>
              <div className="flex flex-col min-w-0 text-left">
                <span className="font-semibold text-xs text-[#1E1B2E] truncate group-hover:text-[#6027D2] transition-colors">
                  {profile?.displayName || user?.fullName || 'Nhà vườn Provider'}
                </span>
                <span className="text-[11px] text-[#6E6A8A] truncate">
                  {profile?.providerType === 'NURSERY'
                    ? 'Nhà vườn liên kết'
                    : 'Chuyên gia chăm sóc'}
                </span>
              </div>
            </div>
            <SettingOutlined className="text-base text-[#8B86A4] group-hover:text-[#6027D2] transition-colors shrink-0 ml-1" />
          </div>
        </Dropdown>
      </div>
    </aside>
  );
}
