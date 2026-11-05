'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  FileProtectOutlined,
  IdcardOutlined,
  MailOutlined,
  PhoneOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { App, Button, Image, Input, Spin, Tag } from 'antd';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import { adminApi } from '@/lib/admin.api';
import type { AdminCustomerItem } from '@/lib/admin.api';
import AdminSidebar from '../../../components/AdminSidebar';
import AdminHeader from '../../../components/AdminHeader';

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'warning', label: 'Chờ duyệt' },
  APPROVED: { color: 'success', label: 'Đã duyệt' },
  REJECTED: { color: 'error', label: 'Đã từ chối' },
};

export default function AdminCustomerDetailPage() {
  const router = useRouter();
  const params = useParams();
  const customerId = params.id as string;

  const [mounted, setMounted] = useState(false);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const { message } = App.useApp();

  const [customer, setCustomer] = useState<AdminCustomerItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || user?.role !== 'ADMIN') {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, user, router]);

  useEffect(() => {
    if (!mounted || !isAuthenticated || !customerId) return;
    fetchDetail();
  }, [mounted, isAuthenticated, customerId]);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const data = await adminApi.getCustomerDetail(customerId);
      setCustomer(data);
    } catch {
      message.error('Không thể tải thông tin khách hàng.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (decision: 'APPROVED' | 'REJECTED') => {
    if (decision === 'REJECTED' && !note.trim()) {
      message.warning('Vui lòng nhập lý do từ chối.');
      return;
    }
    setSubmitting(true);
    try {
      await adminApi.verifyCustomer(customerId, {
        decision,
        note: note.trim() || undefined,
      });
      message.success(decision === 'APPROVED' ? 'Đã phê duyệt thành công!' : 'Đã từ chối hồ sơ.');
      fetchDetail();
      setNote('');
    } catch {
      message.error('Thao tác thất bại. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="flex h-screen bg-[#F6F4FC]">
      <AdminSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader searchPlaceholder="Tìm kiếm..." />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-[1200px] mx-auto">
            {/* Back Button */}
            <button
              onClick={() => router.push('/admin/verify/customers')}
              className="flex items-center gap-2 text-sm text-[#6E6A8A] hover:text-[#6027D2] transition-colors mb-4"
            >
              <ArrowLeftOutlined />
              <span>Chi tiết xét duyệt Khách hàng</span>
            </button>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Spin size="large" />
              </div>
            ) : customer ? (
              <>
                {/* Profile Header Card */}
                <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6 mb-6">
                  <div className="flex items-start gap-5">
                    <div className="w-16 h-16 rounded-full bg-[#F3E8FF] flex items-center justify-center text-[#6027D2] text-2xl font-bold shrink-0">
                      {customer.account?.fullName?.charAt(0)?.toUpperCase() || 'C'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-xl font-bold text-[#1E1B2E]">{customer.account?.fullName}</h2>
                        {customer.verificationStatus === 'APPROVED' && (
                          <CheckCircleOutlined className="text-green-500 text-lg" />
                        )}
                        <Tag color={STATUS_TAG[customer.verificationStatus]?.color}>
                          {STATUS_TAG[customer.verificationStatus]?.label}
                        </Tag>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm text-[#6E6A8A] flex-wrap">
                        {customer.address && (
                          <span className="flex items-center gap-1">
                            <EnvironmentOutlined /> {customer.address}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <CalendarOutlined /> Ngày đăng ký: {dayjs(customer.createdAt).format('DD/MM/YYYY')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2-Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column — 2/3 */}
                  <div className="lg:col-span-2 space-y-6">
                    {/* Thông tin cơ bản */}
                    <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6">
                      <h3 className="text-base font-semibold text-[#1E1B2E] mb-4 flex items-center gap-2">
                        <UserOutlined className="text-[#6027D2]" /> Thông tin cơ bản
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                        <InfoRow icon={<UserOutlined />} label="Họ và tên" value={customer.account?.fullName} />
                        <InfoRow icon={<PhoneOutlined />} label="Số điện thoại" value={customer.phone} />
                        <InfoRow icon={<MailOutlined />} label="Email" value={customer.account?.email} />
                        <InfoRow icon={<IdcardOutlined />} label="Số CCCD" value={customer.cccdNumber} />
                        <InfoRow icon={<EnvironmentOutlined />} label="Địa chỉ" value={customer.address} />
                        <InfoRow icon={<EnvironmentOutlined />} label="Địa chỉ nhận cây" value={customer.defaultPickupAddress} />
                      </div>
                    </div>

                    {/* Tài liệu pháp lý */}
                    <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6">
                      <h3 className="text-base font-semibold text-[#1E1B2E] mb-4 flex items-center gap-2">
                        <FileProtectOutlined className="text-[#6027D2]" /> Tài liệu xác minh danh tính
                      </h3>
                      <Image.PreviewGroup>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                          <DocumentCard label="CCCD (Mặt trước)" url={customer.cccdFrontUrl} />
                          <DocumentCard label="CCCD (Mặt sau)" url={customer.cccdBackUrl} />
                          <DocumentCard label="Ảnh chân dung + CCCD" url={customer.selfieWithIdUrl} />
                        </div>
                      </Image.PreviewGroup>
                    </div>
                  </div>

                  {/* Right Column — 1/3 */}
                  <div className="space-y-6">
                    {/* Admin Checklist */}
                    <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6">
                      <h3 className="text-base font-semibold text-[#1E1B2E] mb-4">Admin Checklist</h3>
                      <div className="space-y-3">
                        <ChecklistItem
                          label="CCCD mặt trước"
                          description="Hình ảnh rõ ràng, không bị che"
                          checked={Boolean(customer.cccdFrontUrl)}
                        />
                        <ChecklistItem
                          label="CCCD mặt sau"
                          description="Hình ảnh rõ ràng, không bị che"
                          checked={Boolean(customer.cccdBackUrl)}
                        />
                        <ChecklistItem
                          label="Ảnh chân dung kèm CCCD"
                          description="Người và CCCD cùng khung hình"
                          checked={Boolean(customer.selfieWithIdUrl)}
                        />
                        <ChecklistItem
                          label="Số CCCD"
                          description="Đã nhập và khớp với ảnh"
                          checked={Boolean(customer.cccdNumber)}
                        />
                      </div>
                      <div className="mt-4 pt-3 border-t border-[#ECE7FA] flex items-center justify-between">
                        <span className="text-xs text-[#6E6A8A]">Tiến độ kiểm tra</span>
                        <span className="text-xs font-semibold text-[#6027D2]">
                          {[customer.cccdFrontUrl, customer.cccdBackUrl, customer.selfieWithIdUrl, customer.cccdNumber].filter(Boolean).length}/4
                        </span>
                      </div>
                    </div>

                    {/* Quyết định xét duyệt */}
                    <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6">
                      <h3 className="text-base font-semibold text-[#1E1B2E] mb-4">Quyết định xét duyệt</h3>
                      <div className="mb-4">
                        <label className="text-xs text-[#6E6A8A] mb-1.5 block">
                          Ghi chú / Lý do (bắt buộc khi từ chối)
                        </label>
                        <Input.TextArea
                          rows={3}
                          placeholder="Nhập ghi chú nội bộ hoặc lý do yêu cầu bổ sung..."
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          className="!rounded-xl !border-[#ECE7FA] !bg-[#F9F8FD]"
                        />
                      </div>
                      <div className="flex gap-3">
                        <Button
                          type="primary"
                          icon={<CheckCircleOutlined />}
                          loading={submitting}
                          onClick={() => handleVerify('APPROVED')}
                          className="!flex-1 !h-10 !rounded-xl !bg-[#10B981] hover:!bg-[#059669] !border-none !font-semibold"
                        >
                          Phê duyệt
                        </Button>
                        <Button
                          danger
                          icon={<CloseCircleOutlined />}
                          loading={submitting}
                          onClick={() => handleVerify('REJECTED')}
                          className="!flex-1 !h-10 !rounded-xl !font-semibold"
                        >
                          Từ chối
                        </Button>
                      </div>
                      {customer.verificationNote && (
                        <div className="mt-4 p-3 rounded-xl bg-[#FEF3C7] border border-[#FCD34D]">
                          <p className="text-xs font-medium text-[#92400E] mb-1">Ghi chú trước đó:</p>
                          <p className="text-xs text-[#78350F]">{customer.verificationNote}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-20 text-[#6E6A8A]">Không tìm thấy thông tin khách hàng.</div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ===== Sub-components =====

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs text-[#6E6A8A] mb-0.5 flex items-center gap-1">{icon} {label}</p>
      <p className="text-sm font-medium text-[#1E1B2E]">{value || '—'}</p>
    </div>
  );
}

function DocumentCard({ label, url }: { label: string; url: string | null }) {
  return (
    <div className="bg-white rounded-xl border border-[#ECE7FA] overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-md hover:border-[#6027D2]/40 transition-all flex flex-col group">
      {/* Header bar */}
      <div className="px-3.5 py-2.5 bg-[#FAF9FD] border-b border-[#ECE7FA] flex items-center justify-between">
        <span className="text-xs font-semibold text-[#1E1B2E] flex items-center gap-1.5 truncate">
          <IdcardOutlined className="text-[#6027D2]" />
          {label}
        </span>
        {url && (
          <span className="text-[11px] text-[#6027D2] font-medium opacity-80 group-hover:opacity-100 flex items-center gap-1 shrink-0 ml-1">
            <EyeOutlined /> Phóng to
          </span>
        )}
      </div>

      {/* Image container: chuẩn KYC, cao 192px, nền xám dịu, ôm trọn ảnh không cắt mép */}
      <div className="relative w-full h-48 bg-[#F8F7FC] flex items-center justify-center p-2.5 overflow-hidden">
        {url ? (
          <Image
            src={url}
            alt={label}
            rootClassName="!w-full !h-full !flex !items-center !justify-center"
            className="!max-w-full !max-h-full !w-auto !h-auto !object-contain rounded-md drop-shadow transition-transform duration-200 group-hover:scale-[1.02]"
            preview={{
              mask: (
                <div className="flex items-center gap-1.5 text-white font-medium text-xs bg-black/65 px-3 py-1.5 rounded-full backdrop-blur-sm shadow-md">
                  <EyeOutlined /> Phóng to & Xoay
                </div>
              ),
            }}
            fallback="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' viewBox='0 0 200 120'><rect width='200' height='120' fill='%23F3F4F6'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%239CA3AF' font-size='12' font-family='sans-serif'>Kh%C3%B4ng%20t%E1%BA%A3i%20%C4%91%C6%B0%E1%BB%A3c%20%E1%BA%A3nh</text></svg>"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-[#A098C2] py-8">
            <IdcardOutlined className="text-3xl mb-1.5 opacity-60" />
            <span className="text-xs font-medium">Chưa tải lên</span>
          </div>
        )}
      </div>

      {/* Footer bar */}
      <div className="px-3 py-1.5 bg-[#FCFCFD] border-t border-[#ECE7FA]/70 text-[11px] text-[#6E6A8A] flex items-center justify-between">
        <span className={url ? 'text-[#10B981] font-medium' : 'text-[#9CA3AF]'}>
          {url ? '● Đã tải lên' : '○ Chưa có ảnh'}
        </span>
        {url && <span className="text-[10px] text-[#A098C2]">Hỗ trợ xoay / phóng to</span>}
      </div>
    </div>
  );
}

function ChecklistItem({ label, description, checked }: { label: string; description: string; checked: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-all ${
        checked
          ? 'bg-[#10B981] text-white shadow-[0_1px_4px_rgba(16,185,129,0.3)]'
          : 'border border-[#D1D5DB] bg-[#F9FAFB]'
      }`}>
        {checked && <CheckOutlined className="text-[11px] font-bold" />}
      </div>
      <div>
        <p className={`text-sm font-medium ${checked ? 'text-[#1E1B2E]' : 'text-[#6E6A8A]'}`}>{label}</p>
        <p className="text-xs text-[#A098C2]">{description}</p>
      </div>
    </div>
  );
}
