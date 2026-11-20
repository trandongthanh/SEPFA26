'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeftOutlined,
  BankOutlined,
  CalendarOutlined,
  CheckOutlined,
  CloseOutlined,
  EnvironmentOutlined,
  HomeOutlined,
  MailOutlined,
  MinusOutlined,
  PhoneOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { App, Spin, Tag } from 'antd';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import { adminApi } from '@/lib/admin.api';
import type { AdminCustomerItem, CustomerVerificationStatus } from '@/lib/admin.api';
import AdminSidebar from '../../../components/AdminSidebar';
import AdminHeader from '../../../components/AdminHeader';
import { CUSTOMER_STATUS } from '../customer-status';

// Trang chỉ để xem: khách tự xác thực bằng eKYC trên app, hệ thống không lưu ảnh hay số CCCD.
const VERIFY_ICON: Record<CustomerVerificationStatus, { icon: React.ReactNode; className: string }> = {
  APPROVED: { icon: <CheckOutlined />, className: 'bg-[#E8F7EE] text-[#12A150]' },
  NOT_SUBMITTED: { icon: <MinusOutlined />, className: 'bg-[#F2F1F6] text-[#6E6A8A]' },
  PENDING: { icon: <MinusOutlined />, className: 'bg-[#FFF6E5] text-[#B7791F]' },
  REJECTED: { icon: <CloseOutlined />, className: 'bg-[#FEECEB] text-[#D92D20]' },
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

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || user?.role !== 'ADMIN') {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, user, router]);

  useEffect(() => {
    if (!mounted || !isAuthenticated || !customerId) return;
    const fetchDetail = async () => {
      setLoading(true);
      try {
        setCustomer(await adminApi.getCustomerDetail(customerId));
      } catch {
        message.error('Không thể tải thông tin khách hàng.');
      } finally {
        setLoading(false);
      }
    };
    void fetchDetail();
  }, [mounted, isAuthenticated, customerId, message]);

  if (!mounted) return null;

  const status = customer ? CUSTOMER_STATUS[customer.verificationStatus] : null;
  const fullName = customer?.fullName || customer?.account?.fullName || '';
  const hasBank = Boolean(customer?.bankName && customer?.bankAccount && customer?.bankHolder);
  // BE ghi lý do eKYC không đạt vào verificationNote → hiện thay cho mô tả chung.
  const verifyDescription =
    customer?.verificationStatus === 'REJECTED' && customer.verificationNote
      ? customer.verificationNote
      : status?.description;

  return (
    <div className="flex h-screen bg-[#F6F4FC]">
      <AdminSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader searchPlaceholder="Tìm kiếm..." />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-[1200px] mx-auto">
            <button
              onClick={() => router.push('/admin/verify/customers')}
              className="flex items-center gap-2 text-sm text-[#6E6A8A] hover:text-[#6027D2] transition-colors mb-4"
            >
              <ArrowLeftOutlined />
              <span>Chi tiết khách hàng</span>
            </button>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Spin size="large" />
              </div>
            ) : customer && status ? (
              <>
                <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6 mb-6">
                  <div className="flex items-start gap-5">
                    <div className="w-16 h-16 rounded-full bg-[#F3E8FF] flex items-center justify-center text-[#6027D2] text-2xl font-bold shrink-0">
                      {fullName.charAt(0).toUpperCase() || 'K'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-xl font-bold text-[#1E1B2E]">{fullName || 'Chưa có tên'}</h2>
                        <Tag color={status.color}>{status.label}</Tag>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm text-[#6E6A8A] flex-wrap">
                        <span className="flex items-center gap-1">
                          <EnvironmentOutlined /> {customer.address || 'Chưa có địa chỉ thường trú'}
                        </span>
                        <span className="flex items-center gap-1">
                          <CalendarOutlined /> Ngày đăng ký: {dayjs(customer.createdAt).format('DD/MM/YYYY')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6">
                      <h3 className="text-base font-semibold text-[#1E1B2E] mb-4 flex items-center gap-2">
                        <UserOutlined className="text-[#6027D2]" /> Thông tin cơ bản
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                        <InfoRow icon={<UserOutlined />} label="Họ và tên" value={fullName} />
                        <InfoRow icon={<PhoneOutlined />} label="Số điện thoại" value={customer.phone} />
                        <InfoRow icon={<MailOutlined />} label="Email" value={customer.email || customer.account?.email} />
                        <InfoRow icon={<CalendarOutlined />} label="Ngày sinh" value={customer.dateOfBirth} />
                        <InfoRow icon={<HomeOutlined />} label="Quê quán" value={customer.placeOfOrigin} wide />
                        <InfoRow icon={<EnvironmentOutlined />} label="Địa chỉ thường trú" value={customer.address} wide />
                        <InfoRow icon={<EnvironmentOutlined />} label="Địa chỉ nhận cây" value={customer.defaultPickupAddress} wide />
                      </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6">
                      <h3 className="text-base font-semibold text-[#1E1B2E] mb-4 flex items-center gap-2">
                        <BankOutlined className="text-[#6027D2]" /> Tài khoản nhận hoàn tiền
                      </h3>
                      {hasBank ? (
                        <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                          <dt className="text-[#6E6A8A]">Ngân hàng</dt>
                          <dd className="font-medium text-[#1E1B2E] break-words">
                            {customer.bankName}
                            {customer.bankBin && <span className="text-xs font-normal text-[#6E6A8A]"> · BIN {customer.bankBin}</span>}
                          </dd>
                          <dt className="text-[#6E6A8A]">Số tài khoản</dt>
                          <dd className="font-medium text-[#1E1B2E] break-words">{customer.bankAccount}</dd>
                          <dt className="text-[#6E6A8A]">Chủ tài khoản</dt>
                          <dd className="font-medium text-[#1E1B2E] break-words">{customer.bankHolder}</dd>
                          <dt className="text-[#6E6A8A]">Thua tranh chấp</dt>
                          <dd className="font-medium text-[#1E1B2E]">{customer.lostDisputeCount} lần</dd>
                        </dl>
                      ) : (
                        <p className="text-sm italic text-[#A098C2]">Khách chưa khai tài khoản ngân hàng.</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6">
                      <h3 className="text-base font-semibold text-[#1E1B2E] mb-4 flex items-center gap-2">
                        <SafetyCertificateOutlined className="text-[#6027D2]" /> Xác thực danh tính
                      </h3>
                      <div className="flex items-start gap-3">
                        <span
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${VERIFY_ICON[customer.verificationStatus].className}`}
                        >
                          {VERIFY_ICON[customer.verificationStatus].icon}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#1E1B2E]">{status.title}</p>
                          <p className="text-xs text-[#6E6A8A] mt-0.5 break-words">{verifyDescription}</p>
                        </div>
                      </div>
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

function InfoRow({
  icon,
  label,
  value,
  wide = false,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  wide?: boolean;
}) {
  return (
    <div className={`min-w-0 ${wide ? 'md:col-span-2' : ''}`}>
      <p className="text-xs text-[#6E6A8A] mb-0.5 flex items-center gap-1">{icon} {label}</p>
      {value ? (
        <p className="text-sm font-medium text-[#1E1B2E] break-words">{value}</p>
      ) : (
        <p className="text-sm italic text-[#A098C2]">Chưa cung cấp</p>
      )}
    </div>
  );
}
