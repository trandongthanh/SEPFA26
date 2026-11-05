'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  IdcardOutlined,
} from '@ant-design/icons';
import { App, Button, Input, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import { adminApi } from '@/lib/admin.api';
import type { AdminProviderItem } from '@/lib/admin.api';
import AdminSidebar from '../../components/AdminSidebar';
import AdminHeader from '../../components/AdminHeader';

type FilterTab = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED';

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'warning', label: 'Chờ duyệt' },
  APPROVED: { color: 'success', label: 'Đã duyệt' },
  REJECTED: { color: 'error', label: 'Đã từ chối' },
};

const PROVIDER_TYPE_LABEL: Record<string, string> = {
  NURSERY: 'Nhà vườn',
  EXPERT: 'Chuyên gia',
};

export default function AdminVerifyProvidersPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const { message } = App.useApp();

  const [providers, setProviders] = useState<AdminProviderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');
  const [searchText, setSearchText] = useState('');

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || user?.role !== 'ADMIN') {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, user, router]);

  useEffect(() => {
    if (!mounted || !isAuthenticated) return;
    fetchProviders();
  }, [mounted, isAuthenticated]);

  const fetchProviders = async () => {
    setLoading(true);
    try {
      const data = await adminApi.listProviders();
      setProviders(data);
    } catch {
      message.error('Không thể tải danh sách nhà cung cấp.');
    } finally {
      setLoading(false);
    }
  };

  // Filter data
  const filteredProviders = providers.filter((p) => {
    // Không hiển thị tài khoản đã chuyển sang role ADMIN trong danh sách chờ duyệt
    if (p.account?.role === 'ADMIN') return false;

    const matchTab = activeTab === 'ALL' || p.verificationStatus === activeTab;
    const keyword = searchText.toLowerCase();
    const matchSearch =
      !keyword ||
      p.displayName.toLowerCase().includes(keyword) ||
      p.account?.email?.toLowerCase().includes(keyword) ||
      p.account?.fullName?.toLowerCase().includes(keyword);
    return matchTab && matchSearch;
  });

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'ALL', label: 'Tất cả' },
    { key: 'PENDING', label: 'Chờ duyệt' },
    { key: 'APPROVED', label: 'Đã duyệt' },
    { key: 'REJECTED', label: 'Đã từ chối' },
  ];

  const hasDocument = (p: AdminProviderItem) =>
    Boolean(p.cccdFrontUrl || p.cccdBackUrl || p.selfieUrl || p.businessLicenseUrl);

  const columns: ColumnsType<AdminProviderItem> = [
    {
      title: 'Tên nhà vườn/Chuyên gia',
      dataIndex: 'displayName',
      key: 'displayName',
      render: (_, record) => (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#F3E8FF] flex items-center justify-center text-[#6027D2] font-semibold text-sm shrink-0">
            {record.displayName?.charAt(0)?.toUpperCase() || 'P'}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-[#1E1B2E] text-sm truncate">{record.displayName}</div>
            <div className="text-xs text-[#6E6A8A] truncate">{record.account?.email}</div>
          </div>
        </div>
      ),
    },
    {
      title: 'Loại',
      dataIndex: 'providerType',
      key: 'providerType',
      width: 120,
      render: (type: string) => (
        <span className="text-sm text-[#4B4764]">{PROVIDER_TYPE_LABEL[type] || type}</span>
      ),
    },
    {
      title: 'Ngày gửi',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 130,
      render: (date: string) => (
        <span className="text-sm text-[#4B4764]">{dayjs(date).format('DD/MM/YYYY')}</span>
      ),
    },
    {
      title: 'Tài liệu',
      key: 'documents',
      width: 100,
      align: 'center',
      render: (_, record) => (
        <div className="flex items-center justify-center gap-1.5">
          {record.cccdFrontUrl && <IdcardOutlined className="text-[#6027D2]" title="CCCD mặt trước" />}
          {record.cccdBackUrl && <IdcardOutlined className="text-[#6027D2]" title="CCCD mặt sau" />}
          {record.businessLicenseUrl && <FileImageOutlined className="text-[#6027D2]" title="Giấy phép KD" />}
          {!hasDocument(record) && <span className="text-xs text-[#A098C2]">—</span>}
        </div>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'verificationStatus',
      key: 'verificationStatus',
      width: 130,
      render: (status: string) => {
        const cfg = STATUS_TAG[status] || { color: 'default', label: status };
        return <Tag color={cfg.color} icon={status === 'APPROVED' ? <CheckCircleOutlined /> : status === 'REJECTED' ? <CloseCircleOutlined /> : undefined}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 120,
      align: 'center',
      render: (_, record) => (
        <Button
          type="primary"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => router.push(`/admin/verify/providers/${record.id}`)}
          className="!rounded-lg !bg-[#6027D2] hover:!bg-[#4E1BA8] !text-xs !font-medium"
        >
          Xét duyệt
        </Button>
      ),
    },
  ];

  if (!mounted) return null;

  return (
    <div className="flex h-screen bg-[#F6F4FC]">
      <AdminSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader searchPlaceholder="Tìm kiếm nhà cung cấp..." />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-[1200px] mx-auto">
            {/* Page Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-[#1E1B2E]">Duyệt Provider</h1>
                <p className="text-sm text-[#6E6A8A] mt-1">
                  Quản lý và xét duyệt hồ sơ đăng ký nhà cung cấp mới.
                </p>
              </div>
              <Button icon={<DownloadOutlined />} className="!rounded-xl !border-[#ECE7FA] !text-[#4B4764] !font-medium">
                Xuất danh sách
              </Button>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-2 mb-4">
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

            {/* Search */}
            <div className="mb-4">
              <Input
                placeholder="Tìm theo tên, email..."
                prefix={<EyeOutlined className="text-[#A098C2]" />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="!rounded-xl !w-80 !bg-white !border-[#ECE7FA]"
                allowClear
              />
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-[#ECE7FA] overflow-hidden">
              <Table
                dataSource={filteredProviders}
                columns={columns}
                rowKey="id"
                loading={loading}
                pagination={{
                  pageSize: 5,
                  showTotal: (total, range) => `Hiển thị ${range[0]}-${range[1]} trong ${total} kết quả`,
                  className: '!px-4 !pb-3',
                }}
                className="admin-table"
                locale={{ emptyText: 'Không có nhà cung cấp nào.' }}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
