'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  CarOutlined,
  AuditOutlined,
  InteractionOutlined,
  LogoutOutlined,
  SettingOutlined,
  ShoppingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { App, Avatar, Dropdown, Menu } from 'antd';
import type { MenuProps } from 'antd';
import { useAuthStore } from '@/lib/auth.store';
import { authApi } from '@/lib/api';
import { useState } from 'react';
import { KeyOutlined } from '@ant-design/icons';
import ChangePasswordModal from '@/features/auth/components/ChangePasswordModal';

// variant "fixed": cột trái cố định, chỉ hiện từ màn hình lg (≥1024px).
// variant "drawer": nội dung menu đặt trong ngăn kéo do AdminHeader mở ở màn hình nhỏ.
export default function AdminSidebar({ variant = 'fixed' }: { variant?: 'fixed' | 'drawer' }) {
  const router = useRouter();
  const pathname = usePathname();
  const { message } = App.useApp();

  const user = useAuthStore((state) => state.user);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  const handleLogout = async () => {
    try {
      await authApi.logout(refreshToken ?? undefined);
    } catch {
      // Ignore
    } finally {
      clearAuth();
      message.success('Đã đăng xuất thành công.');
      router.push('/auth/login');
    }
  };

  const [passwordOpen, setPasswordOpen] = useState(false);

  // Xác định selectedKeys và openKeys dựa trên pathname
  const getSelectedKeys = (): string[] => {
    if (pathname.startsWith('/admin/verify/providers')) return ['/admin/verify/providers'];
    if (pathname.startsWith('/admin/verify/customers')) return ['/admin/verify/customers'];
    if (pathname.startsWith('/admin/verify/packages')) return ['/admin/verify/packages'];
    if (pathname.startsWith('/admin/users')) return ['/admin/users'];
    if (pathname.startsWith('/admin/disputes')) return ['/admin/disputes'];
    return [pathname];
  };

  const getOpenKeys = (): string[] => {
    if (pathname.startsWith('/admin/verify')) return ['verify-submenu'];
    return [];
  };

  // Chỉ giữ các mục đã có trang thật. "Tổng quan" và "Báo cáo" đã bỏ vì BE chưa có API.
  const menuItems: MenuProps['items'] = [
    {
      key: 'verify-submenu',
      icon: <AuditOutlined />,
      label: 'Danh sách chờ duyệt',
      children: [
        {
          key: '/admin/verify/providers',
          label: 'Nhà cung cấp',
          onClick: () => router.push('/admin/verify/providers'),
        },
        {
          key: '/admin/verify/customers',
          label: 'Khách hàng',
          onClick: () => router.push('/admin/verify/customers'),
        },
        {
          key: '/admin/verify/packages',
          label: 'Gói dịch vụ',
          onClick: () => router.push('/admin/verify/packages'),
        },
      ],
    },
    {
      key: '/admin/disputes',
      icon: <InteractionOutlined />,
      label: 'Tranh chấp',
      onClick: () => router.push('/admin/disputes'),
    },
    {
      key: '/admin/disbursements',
      icon: <ShoppingOutlined />,
      label: 'Giải ngân',
      onClick: () => router.push('/admin/disbursements'),
    },
    {
      key: '/admin/shipping-rates',
      icon: <CarOutlined />,
      label: 'Phí lấy cây',
      onClick: () => router.push('/admin/shipping-rates'),
    },
    {
      key: '/admin/users',
      icon: <TeamOutlined />,
      label: 'Người dùng',
      onClick: () => router.push('/admin/users'),
    },
  ];

  return (
    <aside
      className={
        variant === 'drawer'
          ? 'w-full h-full flex flex-col justify-between bg-white overflow-hidden'
          : 'w-64 h-screen border-r border-[#ECE7FA] hidden lg:flex flex-col justify-between flex-shrink-0 bg-white z-20 overflow-hidden sticky top-0'
      }
    >
      {/* Top Section */}
      <div className="flex flex-col flex-1 overflow-y-auto">
        {/* Brand Header */}
        <div
          onClick={() => router.push('/admin/verify/providers')}
          className="flex items-center gap-2.5 px-4 py-4 cursor-pointer group border-b border-[#ECE7FA]"
        >
          <img
            src="/logo_app.png"
            alt="LanCare Hub Logo"
            className="w-12 h-12 object-contain shrink-0 drop-shadow-sm group-hover:scale-105 transition-transform"
          />
          <div className="flex flex-col justify-center">
            <h1 className="font-logo-script text-[22px] font-bold leading-tight tracking-wide flex items-center">
              <span className="text-[#1E1B2E]">LanCare</span>
              <span className="text-[#6027D2] ml-1">Hub</span>
            </h1>
            <span className="text-[10px] text-[#6E6A8A] tracking-[0.1em] font-medium">
              Admin Console
            </span>
          </div>
        </div>

        {/* Navigation Menu */}
        <Menu
          mode="inline"
          selectedKeys={getSelectedKeys()}
          defaultOpenKeys={getOpenKeys()}
          items={menuItems}
          className="!border-none flex-1 mt-2"
          style={{ background: 'transparent' }}
        />
      </div>

      {/* Bottom Section: đổi mật khẩu và đăng xuất nằm trong menu của thẻ admin */}
      <div className="border-t border-[#ECE7FA] pt-3">
        <Dropdown
          menu={{
            items: [
              {
                key: 'change-password',
                icon: <KeyOutlined />,
                label: 'Đổi mật khẩu',
                onClick: () => setPasswordOpen(true),
              },
              { type: 'divider' },
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
          <div className="mx-3 mb-3 flex items-center justify-between p-2 rounded-xl bg-[#F6F4FC] hover:bg-[#ECE7FA] cursor-pointer transition-all group">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar size={36} className="!bg-[#6027D2] text-white font-semibold shrink-0">
                {user?.fullName?.charAt(0)?.toUpperCase() || 'A'}
              </Avatar>
              <div className="flex flex-col min-w-0 text-left">
                <span className="font-semibold text-xs text-[#1E1B2E] truncate group-hover:text-[#6027D2] transition-colors">
                  {user?.fullName || 'Admin'}
                </span>
                <span className="text-[11px] text-[#6E6A8A] truncate">Quản trị viên</span>
              </div>
            </div>
            <SettingOutlined className="text-sm text-[#8B86A4] group-hover:text-[#6027D2] transition-colors shrink-0 ml-1" />
          </div>
        </Dropdown>
      </div>
      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </aside>
  );
}
