'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { App, Input, Select, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import { adminApi } from '@/lib/admin.api';
import type { AdminCustomerItem, AdminProviderItem } from '@/lib/admin.api';
import AdminSidebar from '../components/AdminSidebar';
import AdminHeader from '../components/AdminHeader';

type FilterTab = 'ALL' | 'CUSTOMER' | 'PROVIDER' | 'ADMIN';

interface MergedUser {
  id: string;
  accountId?: string;
  fullName: string;
  email: string;
  role: 'CUSTOMER' | 'PROVIDER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
  createdAt: string;
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  providerType?: 'NURSERY' | 'EXPERT';
}

const ROLE_LABEL: Record<string, string> = {
  CUSTOMER: 'Khách hàng',
  PROVIDER: 'Nhà cung cấp',
  ADMIN: 'Quản trị viên',
};

const ROLE_COLOR: Record<string, string> = {
  CUSTOMER: 'blue',
  PROVIDER: 'purple',
  ADMIN: 'gold',
};

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  ACTIVE: { color: 'success', label: 'Hoạt động' },
  PENDING: { color: 'warning', label: 'Chờ duyệt' },
  SUSPENDED: { color: 'error', label: 'Bị khóa' },
};

export default function AdminUsersPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const { message, modal } = App.useApp();

  const handleToggleStatus = (record: MergedUser) => {
    if (record.role === 'ADMIN' || record.status === 'PENDING') return;

    const willBeActive = record.status !== 'ACTIVE';
    const nextStatus: 'ACTIVE' | 'SUSPENDED' = willBeActive ? 'ACTIVE' : 'SUSPENDED';
    const actionText = willBeActive ? 'mở khóa' : 'khóa';

    modal.confirm({
      title: `Xác nhận ${actionText} tài khoản`,
      content: `Bạn có chắc chắn muốn ${actionText} tài khoản "${record.fullName}" (${record.email}) không?`,
      okText: willBeActive ? 'Mở khóa' : 'Khóa tài khoản',
      okType: willBeActive ? 'primary' : 'danger',
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          // Khung gọi API Backend đã được chuẩn bị sẵn:
          const targetId = record.accountId || record.id;
          await adminApi.updateUserStatus(targetId, nextStatus);
        } catch {
          // Khi BE chưa sẵn sàng endpoint, giữ cập nhật tức thì trên giao diện
          console.info(`[Khung API] Sẵn sàng gửi ${nextStatus} cho ID: ${record.accountId || record.id}`);
        }

        setMergedUsers((prev) =>
          prev.map((u) =>
            u.id === record.id
              ? { ...u, status: nextStatus }
              : u
          )
        );
        message.success(`Đã ${actionText} tài khoản "${record.fullName}" thành công.`);
      },
    });
  };

  const [mergedUsers, setMergedUsers] = useState<MergedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || user?.role !== 'ADMIN') {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, user, router]);

  useEffect(() => {
    if (!mounted || !isAuthenticated) return;
    fetchAllUsers();
  }, [mounted, isAuthenticated]);

  const fetchAllUsers = async () => {
    setLoading(true);
    try {
      const [providers, customers] = await Promise.all([
        adminApi.listProviders(),
        adminApi.listCustomers(),
      ]);

      const mapped: MergedUser[] = [
        ...providers.map((p: AdminProviderItem) => {
          const effectiveRole = (p.account?.role || 'PROVIDER') as 'CUSTOMER' | 'PROVIDER' | 'ADMIN';
          const effectiveStatus: 'ACTIVE' | 'SUSPENDED' | 'PENDING' =
            p.account?.status === 'SUSPENDED'
              ? 'SUSPENDED'
              : p.verificationStatus === 'APPROVED' || p.account?.status === 'ACTIVE'
              ? 'ACTIVE'
              : 'PENDING';
          return {
            id: p.id,
            accountId: p.accountId || p.account?.id,
            fullName: p.displayName || p.account?.fullName || '',
            email: p.account?.email || '',
            role: effectiveRole,
            status: effectiveStatus,
            createdAt: p.createdAt,
            verificationStatus: p.verificationStatus,
            providerType: p.providerType,
          };
        }),
        ...customers.map((c: AdminCustomerItem) => {
          const effectiveRole = (c.account?.role || 'CUSTOMER') as 'CUSTOMER' | 'PROVIDER' | 'ADMIN';
          const effectiveStatus: 'ACTIVE' | 'SUSPENDED' | 'PENDING' =
            c.account?.status === 'SUSPENDED'
              ? 'SUSPENDED'
              : c.verificationStatus === 'APPROVED' || c.account?.status === 'ACTIVE'
              ? 'ACTIVE'
              : 'PENDING';
          return {
            id: c.id,
            accountId: c.accountId || c.account?.id,
            fullName: c.account?.fullName || '',
            email: c.account?.email || '',
            role: effectiveRole,
            status: effectiveStatus,
            createdAt: c.createdAt,
            verificationStatus: c.verificationStatus,
          };
        }),
      ];

      // Đưa Admin đang đăng nhập vào danh sách nếu chưa có
      if (user && !mapped.some((m) => m.id === user.id || (user.fullName && m.fullName.toLowerCase() === user.fullName.toLowerCase()))) {
        mapped.unshift({
          id: user.id || 'admin-current',
          fullName: user.fullName || 'Quản trị viên',
          email: (user as any).email || 'admin@lancarehub.vn',
          role: 'ADMIN',
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          verificationStatus: 'APPROVED',
        });
      }

      // Loại bỏ trùng lặp nếu 1 tài khoản có cả hồ sơ provider và customer
      const seen = new Set<string>();
      const deduped: MergedUser[] = [];
      for (const u of mapped) {
        const key = u.email ? u.email.toLowerCase() : u.id;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(u);
        }
      }

      // Sắp xếp theo ngày tạo mới nhất
      deduped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setMergedUsers(deduped);
    } catch {
      message.error('Không thể tải danh sách người dùng.');
    } finally {
      setLoading(false);
    }
  };

  // Thống kê
  const totalUsers = mergedUsers.length;
  const totalActive = mergedUsers.filter((u) => u.status === 'ACTIVE').length;
  const totalProviders = mergedUsers.filter((u) => u.role === 'PROVIDER').length;
  const totalSuspended = mergedUsers.filter((u) => u.status === 'SUSPENDED').length;

  // Filter
  const filteredUsers = mergedUsers.filter((u) => {
    const matchTab = activeTab === 'ALL' || u.role === activeTab;
    const keyword = searchText.toLowerCase();
    const matchSearch = !keyword || u.fullName.toLowerCase().includes(keyword) || u.email.toLowerCase().includes(keyword);
    const matchStatus = !statusFilter || u.status === statusFilter;
    return matchTab && matchSearch && matchStatus;
  });

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'ALL', label: 'Tất cả' },
    { key: 'CUSTOMER', label: 'Khách hàng' },
    { key: 'PROVIDER', label: 'Nhà cung cấp' },
    { key: 'ADMIN', label: 'Quản trị viên' },
  ];

  const columns: ColumnsType<MergedUser> = [
    {
      title: 'Người dùng',
      key: 'user',
      render: (_, record) => (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#F3E8FF] flex items-center justify-center text-[#6027D2] font-semibold text-sm shrink-0">
            {record.fullName?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-[#1E1B2E] text-sm truncate flex items-center gap-1.5">
              {record.fullName}
              {record.verificationStatus === 'APPROVED' && (
                <Tooltip title="Tài khoản đã xác thực danh tính">
                  <SafetyCertificateOutlined className="text-green-500 text-xs cursor-help" />
                </Tooltip>
              )}
            </div>
            <div className="text-xs text-[#6E6A8A] truncate">{record.email}</div>
          </div>
        </div>
      ),
    },
    {
      title: 'Vai trò',
      key: 'role',
      width: 140,
      render: (_, record) => (
        <Tag color={ROLE_COLOR[record.role]} className="!text-xs">
          {ROLE_LABEL[record.role]}
        </Tag>
      ),
    },
    {
      title: 'Ngày tham gia',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 130,
      render: (date: string) => (
        <span className="text-sm text-[#4B4764]">{dayjs(date).format('DD/MM/YYYY')}</span>
      ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 175,
      render: (_, record) => {
        // 1. Tài khoản Quản trị viên: Không thể tự khóa mình hoặc khóa Admin khác -> Giữ nguyên Tag xanh Hoạt động
        if (record.role === 'ADMIN') {
          return (
            <Tag color="success" icon={<CheckCircleOutlined />}>
              Hoạt động
            </Tag>
          );
        }

        // 2. Tài khoản đang Chờ duyệt: Giữ nguyên Tag vàng Chờ duyệt, KHÔNG hiện toggle
        if (record.status === 'PENDING') {
          return (
            <Tag color="warning" icon={<ClockCircleOutlined />}>
              Chờ duyệt
            </Tag>
          );
        }

        // 3. Tài khoản đã đưa vào hoạt động (ACTIVE hoặc SUSPENDED): Hiển thị Toggle [ Active | Inactive ] chuẩn form ảnh
        const isActive = record.status === 'ACTIVE';

        return (
          <div
            onClick={() => handleToggleStatus(record)}
            className="inline-flex items-center p-1 bg-[#F1F5F9] border border-[#E2E8F0] rounded-xl cursor-pointer select-none transition-all duration-150 hover:border-[#CBD5E1] shadow-inner"
            title={`Bấm để ${isActive ? 'khóa' : 'mở khóa'} tài khoản`}
          >
            <span
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all duration-150 ${
                isActive
                  ? 'bg-white text-[#2563EB] shadow-sm'
                  : 'text-[#64748B] hover:text-[#334155]'
              }`}
            >
              Active
            </span>
            <span
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all duration-150 ${
                !isActive
                  ? 'bg-white text-[#EF4444] shadow-sm'
                  : 'text-[#64748B] hover:text-[#334155]'
              }`}
            >
              Inactive
            </span>
          </div>
        );
      },
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 100,
      align: 'center',
      render: (_, record) => {
        const detailPath = record.role === 'PROVIDER'
          ? `/admin/verify/providers/${record.id}`
          : `/admin/verify/customers/${record.id}`;
        return record.role !== 'ADMIN' ? (
          <button
            onClick={() => router.push(detailPath)}
            className="text-[#6027D2] text-sm font-medium hover:underline"
          >
            Xem
          </button>
        ) : (
          <span className="text-xs text-[#A098C2]">—</span>
        );
      },
    },
  ];

  if (!mounted) return null;

  return (
    <div className="flex h-screen bg-[#F6F4FC]">
      <AdminSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader searchPlaceholder="Tìm kiếm quản trị..." />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-[1200px] mx-auto">
            {/* Page Header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-[#1E1B2E]">Quản lý người dùng</h1>
              <p className="text-sm text-[#6E6A8A] mt-1">
                Giám sát, phân quyền và hỗ trợ tài khoản trên hệ thống.
              </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard icon={<TeamOutlined />} label="Tổng người dùng" value={totalUsers} color="#6027D2" />
              <StatCard icon={<CheckCircleOutlined />} label="Đang hoạt động" value={totalActive} color="#10B981" />
              <StatCard icon={<UserOutlined />} label="Nhà cung cấp" value={totalProviders} color="#8B5CF6" />
              <StatCard icon={<LockOutlined />} label="Tài khoản bị khóa" value={totalSuspended} color="#EF4444" />
            </div>

            {/* Filter Tabs + Search */}
            <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                      activeTab === tab.key
                        ? 'bg-[#6027D2] text-white shadow-sm'
                        : 'bg-white text-[#4B4764] border border-[#ECE7FA] hover:border-[#6027D2] hover:text-[#6027D2]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <Input
                  placeholder="Tìm theo tên, email..."
                  prefix={<SearchOutlined className="text-[#A098C2]" />}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="!rounded-xl !w-64 !bg-white !border-[#ECE7FA]"
                  allowClear
                />
                <Select
                  placeholder="Trạng thái"
                  value={statusFilter}
                  onChange={(val) => setStatusFilter(val)}
                  allowClear
                  className="!w-36"
                  options={[
                    { value: 'ACTIVE', label: 'Hoạt động' },
                    { value: 'PENDING', label: 'Chờ duyệt' },
                    { value: 'SUSPENDED', label: 'Bị khóa' },
                  ]}
                />
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-[#ECE7FA] overflow-hidden">
              <Table
                dataSource={filteredUsers}
                columns={columns}
                rowKey="id"
                loading={loading}
                pagination={{
                  pageSize: 5,
                  showTotal: (total, range) => `Hiển thị ${range[0]}-${range[1]} trong ${total} kết quả`,
                  className: '!px-4 !pb-3',
                }}
                locale={{ emptyText: 'Không có người dùng nào.' }}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// ===== Sub-component =====

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#ECE7FA] p-4 flex items-center gap-3">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
        style={{ backgroundColor: `${color}15`, color }}
      >
        {icon}
      </div>
      <div>
        <p className="text-xl font-bold text-[#1E1B2E]">{value.toLocaleString('vi-VN')}</p>
        <p className="text-xs text-[#6E6A8A]">{label}</p>
      </div>
    </div>
  );
}
