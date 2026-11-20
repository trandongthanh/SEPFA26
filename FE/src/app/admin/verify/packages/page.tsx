'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Drawer, Input, Segmented, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import { AdminPackageWithProvider, adminApi } from '@/lib/admin.api';
import { getApiErrorCode } from '@/lib/api';
import AdminSidebar from '../../components/AdminSidebar';
import AdminHeader from '../../components/AdminHeader';

// Trạng thái hiển thị = approvalStatus + isActive.
// APPROVED + isActive=false là "Tạm ngưng" (không phải từ chối).
type PackageState = 'PENDING' | 'LIVE' | 'PAUSED' | 'REJECTED';
type Filter = PackageState | 'ALL';

const stateOf = (p: AdminPackageWithProvider): PackageState =>
  p.approvalStatus === 'PENDING'
    ? 'PENDING'
    : p.approvalStatus === 'REJECTED'
      ? 'REJECTED'
      : p.isActive
        ? 'LIVE'
        : 'PAUSED';

const STATE_TAG: Record<PackageState, { color: string; label: string; icon: React.ReactNode }> = {
  PENDING: { color: 'warning', label: 'Chờ duyệt', icon: <ClockCircleOutlined /> },
  LIVE: { color: 'success', label: 'Đang bán', icon: <CheckCircleOutlined /> },
  PAUSED: { color: 'default', label: 'Tạm ngưng', icon: <PauseCircleOutlined /> },
  REJECTED: { color: 'error', label: 'Đã từ chối', icon: <CloseCircleOutlined /> },
};

const vnd = (v: string | number | null | undefined) => `${Number(v || 0).toLocaleString('vi-VN')} VNĐ`;
const declaredRange = (p: AdminPackageWithProvider) =>
  p.minDeclaredValue || p.maxDeclaredValue
    ? `${vnd(p.minDeclaredValue)} – ${vnd(p.maxDeclaredValue)}`
    : 'Không giới hạn';

type Action = 'approve' | 'reject' | 'pause' | 'resume';

export default function AdminPackagesPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState<AdminPackageWithProvider[]>([]);
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<AdminPackageWithProvider | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || user?.role !== 'ADMIN') {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, user, router]);

  const isAdmin = mounted && isAuthenticated && user?.role === 'ADMIN';

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    try {
      setPackages(await adminApi.listAllPackages());
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Không thể tải danh sách gói dịch vụ.');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (isAdmin) fetchPackages();
  }, [isAdmin, fetchPackages]);

  const counts = useMemo(() => {
    const c: Record<PackageState, number> = { PENDING: 0, LIVE: 0, PAUSED: 0, REJECTED: 0 };
    packages.forEach((p) => {
      c[stateOf(p)] += 1;
    });
    return c;
  }, [packages]);

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return packages.filter(
      (p) =>
        (filter === 'ALL' || stateOf(p) === filter) &&
        (!kw || `${p.name} ${p.provider?.displayName ?? ''}`.toLowerCase().includes(kw))
    );
  }, [packages, filter, keyword]);

  const openDrawer = (pkg: AdminPackageWithProvider, startReject = false) => {
    setSelected(pkg);
    setRejecting(startReject);
    setReason('');
  };

  const closeDrawer = () => {
    if (busyId) return;
    setSelected(null);
    setRejecting(false);
  };

  const runAction = async (pkg: AdminPackageWithProvider, action: Action) => {
    setBusyId(pkg.id);
    try {
      const payload =
        action === 'reject'
          ? { decision: 'REJECTED' as const, isActive: false, note: reason.trim() }
          : { decision: 'APPROVED' as const, isActive: action !== 'pause' };
      await adminApi.verifyPackage(pkg.id, payload);
      const done: Record<Action, string> = {
        approve: `Đã duyệt "${pkg.name}". Gói bắt đầu hiện cho khách.`,
        reject: `Đã từ chối "${pkg.name}".`,
        pause: `Đã tạm ngưng "${pkg.name}". Khách không đặt được gói này nữa.`,
        resume: `Đã mở bán lại "${pkg.name}".`,
      };
      message.success(done[action]);
      setSelected(null);
      setRejecting(false);
      await fetchPackages();
    } catch (err: any) {
      const code = getApiErrorCode(err);
      message.error(
        code === 'PACKAGE_NOT_FOUND' ? 'Gói này không còn tồn tại.' : 'Thao tác thất bại. Vui lòng thử lại.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const rowActions = (pkg: AdminPackageWithProvider) => {
    const state = stateOf(pkg);
    const loading = busyId === pkg.id;
    const stop = (fn: () => void) => (e: React.MouseEvent) => {
      e.stopPropagation();
      fn();
    };
    if (state === 'PENDING') {
      return (
        <div style={{ display: 'flex', flexWrap: 'nowrap', justifyContent: 'flex-end', gap: 6 }}>
          <Button
            size="small"
            type="primary"
            loading={loading}
            onClick={stop(() => runAction(pkg, 'approve'))}
            className="!bg-[#10B981] hover:!bg-[#059669] !border-none !rounded-lg !text-xs !font-semibold whitespace-nowrap shrink-0"
          >
            Duyệt
          </Button>
          <Button size="small" danger onClick={stop(() => openDrawer(pkg, true))} className="!rounded-lg !text-xs whitespace-nowrap shrink-0">
            Từ chối
          </Button>
        </div>
      );
    }
    if (state === 'LIVE') {
      return (
        <Button size="small" loading={loading} onClick={stop(() => runAction(pkg, 'pause'))} className="!rounded-lg !text-xs">
          Tạm ngưng
        </Button>
      );
    }
    if (state === 'PAUSED') {
      return (
        <Button
          size="small"
          type="primary"
          loading={loading}
          onClick={stop(() => runAction(pkg, 'resume'))}
          className="!bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !rounded-lg !text-xs"
        >
          Mở bán lại
        </Button>
      );
    }
    return (
      <Button size="small" onClick={stop(() => openDrawer(pkg))} className="!rounded-lg !text-xs">
        Xem lý do
      </Button>
    );
  };

  const columns: ColumnsType<AdminPackageWithProvider> = [
    {
      title: 'Gói dịch vụ',
      key: 'name',
      render: (_, p) => (
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#1E1B2E]">{p.name}</div>
          <div className="text-[11px] text-[#6E6A8A]">Tạo {dayjs(p.createdAt).format('DD/MM/YYYY')}</div>
        </div>
      ),
    },
    {
      title: 'Nhà vườn',
      key: 'provider',
      render: (_, p) => (
        <div className="text-xs">
          <div className="font-semibold text-[#1E1B2E]">{p.provider?.displayName || '—'}</div>
          {p.provider && p.provider.verificationStatus !== 'APPROVED' && (
            <div className="text-[11px] text-[#B45309]">Nhà vườn chưa được duyệt</div>
          )}
        </div>
      ),
    },
    {
      title: 'Thời gian',
      key: 'duration',
      render: (_, p) => (
        <div className="text-xs">
          <div className="text-[#1E1B2E]">{p.durationDays} ngày</div>
          <div className="text-[11px] text-[#6E6A8A]">Báo cáo mỗi {p.reportFrequencyDays} ngày</div>
        </div>
      ),
    },
    {
      title: 'Số cây',
      dataIndex: 'maxPlants',
      key: 'maxPlants',
      render: (n: number) => <span className="text-xs">Tối đa {n}</span>,
    },
    {
      title: 'Giá cơ bản',
      dataIndex: 'basePrice',
      key: 'basePrice',
      render: (v: string) => <span className="text-sm font-bold text-[#4E1BA8]">{vnd(v)}</span>,
    },
    {
      title: 'Giá trị cây nhận',
      key: 'declared',
      render: (_, p) => <span className="text-xs text-[#4B4764]">{declaredRange(p)}</span>,
    },
    {
      title: 'Trạng thái',
      key: 'state',
      render: (_, p) => {
        const tag = STATE_TAG[stateOf(p)];
        return (
          <Tag color={tag.color} icon={tag.icon} className="!rounded-lg">
            {tag.label}
          </Tag>
        );
      },
    },
    { title: 'Thao tác', key: 'action', align: 'right', width: 190, render: (_, p) => rowActions(p) },
  ];

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  const stat = (label: string, value: number, tone: string) => (
    <div className="bg-white p-4 rounded-2xl border border-[#ECE7FA]">
      <p className="text-xs text-[#6E6A8A] m-0">{label}</p>
      <p className={`text-xl font-extrabold m-0 ${tone}`}>{loading ? '—' : value}</p>
    </div>
  );

  const sel = selected;
  const selState = sel ? stateOf(sel) : null;
  const selBusy = sel ? busyId === sel.id : false;

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AdminHeader />

        <main className="flex-1 p-6 space-y-6 overflow-y-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#1E1B2E]">Gói dịch vụ</h1>
              <p className="text-xs text-[#6E6A8A] mt-1">
                Mọi gói chăm sóc nhà vườn tạo ra. Gói chỉ hiện cho khách khi đã được duyệt và đang bán.
              </p>
            </div>
            <Button
              icon={<ReloadOutlined />}
              onClick={fetchPackages}
              className="!rounded-xl !border-[#ECE7FA] text-[#6027D2] font-semibold"
            >
              Làm mới
            </Button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {stat('Chờ duyệt', counts.PENDING, 'text-[#D97706]')}
            {stat('Đang bán', counts.LIVE, 'text-[#059669]')}
            {stat('Tạm ngưng', counts.PAUSED, 'text-[#1E1B2E]')}
            {stat('Đã từ chối', counts.REJECTED, 'text-[#C0262D]')}
          </div>

          <div className="bg-white rounded-2xl border border-[#ECE7FA] p-5 shadow-xs space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="max-w-full overflow-x-auto">
                <Segmented
                  value={filter}
                  onChange={(v) => setFilter(v as Filter)}
                  options={[
                    { label: `Chờ duyệt (${counts.PENDING})`, value: 'PENDING' },
                    { label: `Đang bán (${counts.LIVE})`, value: 'LIVE' },
                    { label: `Tạm ngưng (${counts.PAUSED})`, value: 'PAUSED' },
                    { label: `Từ chối (${counts.REJECTED})`, value: 'REJECTED' },
                    { label: `Tất cả (${packages.length})`, value: 'ALL' },
                  ]}
                  className="!bg-[#F6F4FC] font-semibold text-xs"
                />
              </div>
              <Input
                allowClear
                prefix={<SearchOutlined className="text-[#8B86A4]" />}
                placeholder="Tìm theo tên gói hoặc nhà vườn"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="!rounded-xl lg:!w-72"
              />
            </div>

            <Table
              rowKey="id"
              columns={columns}
              dataSource={rows}
              loading={loading}
              scroll={{ x: 960 }}
              rowClassName="cursor-pointer"
              onRow={(p) => ({ onClick: () => openDrawer(p) })}
              pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
              locale={{
                emptyText: filter === 'PENDING' && !keyword ? 'Không có gói nào đang chờ duyệt.' : 'Không có gói nào phù hợp.',
              }}
            />
          </div>
        </main>
      </div>

      <Drawer
        open={!!sel}
        onClose={closeDrawer}
        width={460}
        title={
          sel && (
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-base font-bold text-[#1E1B2E] truncate">{sel.name}</div>
                <div className="text-xs font-normal text-[#6E6A8A]">{sel.provider?.displayName}</div>
              </div>
              {selState && (
                <Tag color={STATE_TAG[selState].color} className="!rounded-lg !m-0">
                  {STATE_TAG[selState].label}
                </Tag>
              )}
            </div>
          )
        }
        footer={
          sel && (
            <div className="flex justify-end gap-2 flex-wrap">
              <Button onClick={closeDrawer} className="!rounded-xl">Đóng</Button>
              {selState === 'PENDING' &&
                (rejecting ? (
                  <Button
                    danger
                    type="primary"
                    loading={selBusy}
                    disabled={!reason.trim()}
                    onClick={() => runAction(sel, 'reject')}
                    className="!rounded-xl"
                  >
                    Xác nhận từ chối
                  </Button>
                ) : (
                  <>
                    <Button danger onClick={() => setRejecting(true)} className="!rounded-xl">Từ chối</Button>
                    <Button
                      type="primary"
                      loading={selBusy}
                      onClick={() => runAction(sel, 'approve')}
                      className="!bg-[#10B981] hover:!bg-[#059669] !border-none !rounded-xl !font-semibold"
                    >
                      Duyệt gói
                    </Button>
                  </>
                ))}
              {selState === 'LIVE' && (
                <Button loading={selBusy} onClick={() => runAction(sel, 'pause')} className="!rounded-xl">
                  Tạm ngưng bán
                </Button>
              )}
              {selState === 'PAUSED' && (
                <Button
                  type="primary"
                  loading={selBusy}
                  onClick={() => runAction(sel, 'resume')}
                  className="!bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !rounded-xl"
                >
                  Mở bán lại
                </Button>
              )}
            </div>
          )
        }
      >
        {sel && (
          <div className="space-y-4">
            {sel.provider && sel.provider.verificationStatus !== 'APPROVED' && (
              <Alert
                type="warning"
                showIcon
                message="Nhà vườn này chưa được duyệt hồ sơ. Nên duyệt hồ sơ nhà vườn trước khi duyệt gói."
              />
            )}
            {selState === 'REJECTED' && (
              <Alert type="error" showIcon message={<><b>Lý do từ chối:</b> {sel.rejectionReason || '(không ghi lý do)'}</>} />
            )}
            <p className="text-sm text-[#1E1B2E] bg-[#F6F4FC] rounded-xl p-3 m-0 whitespace-pre-line leading-relaxed">
              {sel.description || <i className="text-[#8B86A4]">Không có mô tả</i>}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm m-0">
              <dt className="text-[#6E6A8A]">Thời gian chăm</dt>
              <dd className="m-0 font-medium">{sel.durationDays} ngày</dd>
              <dt className="text-[#6E6A8A]">Báo cáo</dt>
              <dd className="m-0 font-medium">
                Mỗi {sel.reportFrequencyDays} ngày (≈ {Math.ceil(sel.durationDays / sel.reportFrequencyDays)} kỳ)
              </dd>
              <dt className="text-[#6E6A8A]">Số cây tối đa</dt>
              <dd className="m-0 font-medium">{sel.maxPlants} cây</dd>
              <dt className="text-[#6E6A8A]">Giá cơ bản</dt>
              <dd className="m-0 font-bold text-[#4E1BA8]">{vnd(sel.basePrice)}</dd>
              <dt className="text-[#6E6A8A]">Giá trị cây nhận</dt>
              <dd className="m-0 font-medium">{declaredRange(sel)}</dd>
              <dt className="text-[#6E6A8A]">Ngày tạo</dt>
              <dd className="m-0 font-medium">{dayjs(sel.createdAt).format('DD/MM/YYYY HH:mm')}</dd>
            </dl>
            {sel.provider && (
              <Button
                type="link"
                className="!px-0 !text-[#6027D2]"
                onClick={() => router.push(`/admin/verify/providers/${sel.provider!.id}`)}
              >
                Xem hồ sơ nhà vườn →
              </Button>
            )}
            {selState === 'PENDING' && rejecting && (
              <div className="space-y-1">
                <label htmlFor="reject-reason" className="text-sm font-semibold text-[#1E1B2E]">
                  Lý do từ chối <span className="text-[#C0262D]">*</span>
                </label>
                <Input.TextArea
                  id="reject-reason"
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  placeholder="VD: Mô tả chưa nêu rõ công việc chăm sóc; giá chưa hợp lý cho số cây tối đa."
                />
                <p className="text-[11px] text-[#6E6A8A] m-0">Nhà vườn sẽ thấy lý do này để sửa gói.</p>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
