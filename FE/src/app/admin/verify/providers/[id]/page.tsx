'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeftOutlined,
  BankOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  FileProtectOutlined,
  HistoryOutlined,
  HomeOutlined,
  LinkOutlined,
  MailOutlined,
  PhoneOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { App, Button, Image, Input, Spin, Tag } from 'antd';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import { adminApi } from '@/lib/admin.api';
import type { AdminProviderItem, AdminServicePackage } from '@/lib/admin.api';
import AdminSidebar from '../../../components/AdminSidebar';
import AdminHeader from '../../../components/AdminHeader';
import ProviderAccountActions from '../../../components/ProviderAccountActions';
import {
  PROVIDER_REQUIREMENT_COUNT,
  hasProviderBank,
  missingProviderRequirements,
  providerPhone,
} from '../provider-identity';

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'warning', label: 'Chờ duyệt' },
  APPROVED: { color: 'success', label: 'Đã duyệt' },
  REJECTED: { color: 'error', label: 'Đã từ chối' },
};

const PROVIDER_TYPE_LABEL: Record<AdminProviderItem['providerType'], string> = {
  NURSERY: 'Nhà vườn',
  EXPERT: 'Chuyên gia',
};

// Interceptor axios đã đổi mã lỗi BE thành câu tiếng Việt trong data.message.
function errorText(err: unknown): string {
  const msg = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  const text = Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : '';
  return text || 'Thao tác thất bại. Vui lòng thử lại.';
}

export default function AdminProviderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const providerId = params.id as string;

  const [mounted, setMounted] = useState(false);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const { message } = App.useApp();

  const [provider, setProvider] = useState<AdminProviderItem | null>(null);
  const [packages, setPackages] = useState<AdminServicePackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoadingPkg, setActionLoadingPkg] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || user?.role !== 'ADMIN') {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, user, router]);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.getProviderDetail(providerId);
      setProvider(data.provider);
      setPackages(data.packages);
    } catch {
      message.error('Không thể tải thông tin nhà cung cấp.');
    } finally {
      setLoading(false);
    }
  }, [providerId, message]);

  useEffect(() => {
    if (!mounted || !isAuthenticated || !providerId) return;
    void fetchDetail();
  }, [mounted, isAuthenticated, providerId, fetchDetail]);

  const handleVerifyPackage = async (packageId: string, decision: 'APPROVED' | 'REJECTED') => {
    setActionLoadingPkg(packageId);
    try {
      await adminApi.verifyPackage(packageId, { decision, isActive: decision === 'APPROVED' });
      message.success(
        decision === 'APPROVED'
          ? 'Đã phê duyệt gói dịch vụ! Gói hiện đã hiển thị cho Khách hàng.'
          : 'Đã từ chối gói dịch vụ.',
      );
      void fetchDetail();
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setActionLoadingPkg(null);
    }
  };

  // Tạm ngưng / mở bán lại gói đã duyệt: giữ approvalStatus = APPROVED, chỉ đổi isActive.
  const handleTogglePackage = async (packageId: string, nextActive: boolean) => {
    setActionLoadingPkg(packageId);
    try {
      await adminApi.verifyPackage(packageId, { decision: 'APPROVED', isActive: nextActive });
      message.success(nextActive ? 'Đã mở bán lại gói dịch vụ.' : 'Đã tạm ngưng gói dịch vụ.');
      void fetchDetail();
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setActionLoadingPkg(null);
    }
  };

  const handleVerify = async (decision: 'APPROVED' | 'REJECTED') => {
    if (decision === 'REJECTED' && !note.trim()) {
      message.warning('Vui lòng nhập lý do từ chối.');
      return;
    }
    setSubmitting(true);
    try {
      await adminApi.verifyProvider(providerId, { decision, note: note.trim() || undefined });
      message.success(decision === 'APPROVED' ? 'Đã phê duyệt thành công!' : 'Đã từ chối hồ sơ.');
      setNote('');
      void fetchDetail();
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted) return null;

  const missing = provider ? missingProviderRequirements(provider) : [];
  const hasBank = provider ? hasProviderBank(provider) : false;
  const gps = provider?.gpsLat && provider?.gpsLng ? `${provider.gpsLat}, ${provider.gpsLng}` : null;

  return (
    <div className="flex h-screen bg-[#F6F4FC]">
      <AdminSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader searchPlaceholder="Tìm kiếm..." />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-[1200px] mx-auto">
            <button
              onClick={() => router.push('/admin/verify/providers')}
              className="flex items-center gap-2 text-sm text-[#6E6A8A] hover:text-[#6027D2] transition-colors mb-4"
            >
              <ArrowLeftOutlined />
              <span>Chi tiết nhà cung cấp</span>
            </button>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Spin size="large" />
              </div>
            ) : provider ? (
              <>
                <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6 mb-6">
                  <div className="flex items-start gap-5">
                    <div className="w-16 h-16 rounded-full bg-[#F3E8FF] flex items-center justify-center text-[#6027D2] text-2xl font-bold shrink-0">
                      {provider.displayName?.charAt(0)?.toUpperCase() || 'P'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-bold text-[#1E1B2E]">{provider.displayName}</h2>
                        <Tag color={STATUS_TAG[provider.verificationStatus]?.color}>
                          {STATUS_TAG[provider.verificationStatus]?.label}
                        </Tag>
                        <Tag color="purple">{PROVIDER_TYPE_LABEL[provider.providerType]}</Tag>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm text-[#6E6A8A] flex-wrap">
                        {provider.account?.email && (
                          <span className="flex items-center gap-1 break-all">
                            <MailOutlined /> {provider.account.email}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <CalendarOutlined /> Ngày gửi: {dayjs(provider.createdAt).format('DD/MM/YYYY')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-6 min-w-0">
                    <Section icon={<UserOutlined />} title="Người đại diện" hint="(* bắt buộc để duyệt)">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                        <InfoRow icon={<UserOutlined />} label="Họ và tên" required value={provider.account?.fullName} />
                        <InfoRow icon={<PhoneOutlined />} label="Số điện thoại" required value={providerPhone(provider)} />
                        <InfoRow icon={<CalendarOutlined />} label="Ngày sinh" required value={provider.dateOfBirth} />
                        <InfoRow icon={<HomeOutlined />} label="Quê quán" required value={provider.placeOfOrigin} />
                        <InfoRow icon={<EnvironmentOutlined />} label="Địa chỉ thường trú" required value={provider.address} wide />
                        <InfoRow icon={<MailOutlined />} label="Email đăng nhập" value={provider.account?.email} wide />
                      </div>
                    </Section>

                    <Section icon={<FileProtectOutlined />} title="Cơ sở kinh doanh">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                        <InfoRow icon={<ShopOutlined />} label="Tên hiển thị" value={provider.displayName} />
                        <InfoRow icon={<ShopOutlined />} label="Loại hình" value={PROVIDER_TYPE_LABEL[provider.providerType]} />
                        <InfoRow icon={<FileProtectOutlined />} label="Số giấy phép kinh doanh" value={provider.licenseInfo} />
                        <InfoRow icon={<EnvironmentOutlined />} label="Vị trí vườn (GPS)" value={gps} />
                      </div>
                      <div className="mt-4">
                        {provider.businessLicenseUrl ? (
                          <Image
                            src={provider.businessLicenseUrl}
                            alt="Giấy phép kinh doanh"
                            width={260}
                            className="!rounded-xl !border !border-[#ECE7FA] !object-contain"
                            preview={{
                              mask: (
                                <span className="flex items-center gap-1.5 text-xs">
                                  <EyeOutlined /> Xem giấy phép kinh doanh
                                </span>
                              ),
                            }}
                          />
                        ) : (
                          <p className="text-sm italic text-[#A098C2]">Chưa tải ảnh giấy phép kinh doanh.</p>
                        )}
                      </div>
                      <p className="text-xs text-[#6E6A8A] mt-3">
                        Địa chỉ thường trú cũng là địa chỉ dùng để tính khoảng cách lấy cây.
                      </p>
                    </Section>

                    <Section icon={<SafetyCertificateOutlined />} title="Năng lực chăm lan">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                        <InfoRow label="Giới thiệu" value={provider.bio} wide />
                        <InfoRow label="Kinh nghiệm" value={provider.experience} />
                        <InfoRow label="Chuyên môn" value={provider.specialties} />
                        <InfoRow label="Khu vực phục vụ" value={provider.serviceAreas} />
                        <InfoRow label="Chứng chỉ" value={provider.certificates} />
                        <div className="min-w-0 md:col-span-2">
                          <p className="text-xs text-[#6E6A8A] mb-0.5 flex items-center gap-1">
                            <LinkOutlined /> Portfolio / trang giới thiệu
                          </p>
                          {provider.portfolioUrl ? (
                            <a
                              href={provider.portfolioUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-[#6027D2] break-all hover:underline"
                            >
                              {provider.portfolioUrl}
                            </a>
                          ) : (
                            <p className="text-sm italic text-[#A098C2]">Chưa cung cấp</p>
                          )}
                        </div>
                      </div>
                    </Section>

                    <Section icon={<ShopOutlined />} title={`Gói dịch vụ đã tạo (${packages.length})`}>
                      {packages.length === 0 ? (
                        <p className="text-sm italic text-[#A098C2]">Nhà vườn chưa tạo gói nào.</p>
                      ) : (
                        <div className="space-y-3">
                          {packages.map((pkg) => (
                            <div
                              key={pkg.id}
                              className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-[#F6F4FC] border border-[#ECE7FA]"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-[#1E1B2E] truncate">{pkg.name}</p>
                                <p className="text-xs text-[#6E6A8A]">
                                  {pkg.durationDays} ngày · Tối đa {pkg.maxPlants} cây · Báo cáo {pkg.reportFrequencyDays} ngày/lần ·{' '}
                                  {Number(pkg.basePrice).toLocaleString('vi-VN')}đ/cây
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Tag
                                  color={pkg.approvalStatus === 'APPROVED' ? 'success' : pkg.approvalStatus === 'REJECTED' ? 'error' : 'warning'}
                                  className="!text-xs"
                                >
                                  {pkg.approvalStatus === 'APPROVED' ? 'Đã duyệt' : pkg.approvalStatus === 'REJECTED' ? 'Từ chối' : 'Chờ duyệt'}
                                </Tag>
                                {pkg.approvalStatus === 'PENDING' && (
                                  <>
                                    <Button
                                      size="small"
                                      type="primary"
                                      className="!bg-[#10B981] hover:!bg-[#059669] !rounded-lg !text-xs font-medium"
                                      onClick={() => handleVerifyPackage(pkg.id, 'APPROVED')}
                                      loading={actionLoadingPkg === pkg.id}
                                    >
                                      Duyệt gói
                                    </Button>
                                    <Button
                                      size="small"
                                      danger
                                      className="!rounded-lg !text-xs font-medium"
                                      onClick={() => handleVerifyPackage(pkg.id, 'REJECTED')}
                                      loading={actionLoadingPkg === pkg.id}
                                    >
                                      Từ chối
                                    </Button>
                                  </>
                                )}
                                {pkg.approvalStatus === 'APPROVED' && (
                                  <Button
                                    size="small"
                                    type={pkg.isActive ? 'default' : 'primary'}
                                    className={pkg.isActive ? '!text-xs !rounded-lg' : '!bg-[#6027D2] !text-xs !rounded-lg'}
                                    onClick={() => handleTogglePackage(pkg.id, !pkg.isActive)}
                                    loading={actionLoadingPkg === pkg.id}
                                  >
                                    {pkg.isActive ? 'Tạm ngưng gói' : 'Kích hoạt bán'}
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Section>
                  </div>

                  <div className="space-y-6 min-w-0">
                    <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6">
                      <h3 className="text-base font-semibold text-[#1E1B2E] mb-4">Quyết định xét duyệt</h3>
                      {missing.length > 0 && (
                        <div className="mb-4 p-3 rounded-xl bg-[#FFF6E5] border border-[#F5DDAE] text-[#7A4E0E]">
                          <p className="text-sm font-semibold">
                            Chưa duyệt được: thiếu {missing.length}/{PROVIDER_REQUIREMENT_COUNT} điều kiện bắt buộc
                          </p>
                          <ul className="list-disc pl-5 mt-1 text-sm">
                            {missing.map((m) => <li key={m}>{m}</li>)}
                          </ul>
                          <p className="text-xs mt-1">Có thể Từ chối kèm lý do để nhà vườn bổ sung.</p>
                        </div>
                      )}
                      <label htmlFor="verify-note" className="text-xs text-[#6E6A8A] mb-1.5 block">
                        Ghi chú / Lý do (bắt buộc khi từ chối)
                      </label>
                      <Input.TextArea
                        id="verify-note"
                        rows={3}
                        placeholder="Nhập ghi chú nội bộ hoặc lý do yêu cầu bổ sung..."
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="!rounded-xl !border-[#ECE7FA] !bg-[#F9F8FD] !mb-4"
                      />
                      <div className="flex gap-3">
                        <Button
                          type="primary"
                          icon={<CheckCircleOutlined />}
                          loading={submitting}
                          disabled={missing.length > 0}
                          onClick={() => handleVerify('APPROVED')}
                          className="!flex-1 !h-10 !rounded-xl !bg-[#10B981] hover:!bg-[#059669] !border-none !font-semibold disabled:!opacity-50 disabled:!text-white"
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
                    </div>

                    <Section icon={<BankOutlined />} title="Tài khoản nhận tiền" hint="(* bắt buộc để duyệt)">
                      {hasBank ? (
                        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                          <dt className="text-[#6E6A8A]">Ngân hàng</dt>
                          <dd className="font-medium text-[#1E1B2E] break-words">
                            {provider.bankName}
                            {provider.bankBin && <span className="text-xs font-normal text-[#6E6A8A]"> · BIN {provider.bankBin}</span>}
                          </dd>
                          <dt className="text-[#6E6A8A]">Số tài khoản</dt>
                          <dd className="font-medium text-[#1E1B2E] break-words">{provider.bankAccount}</dd>
                          <dt className="text-[#6E6A8A]">Chủ tài khoản</dt>
                          <dd className="font-medium text-[#1E1B2E] break-words">{provider.bankHolder}</dd>
                        </dl>
                      ) : (
                        <p className="text-sm italic text-[#B7791F]">
                          Chưa khai. Bắt buộc để duyệt và để nhà vườn nhận đơn; nhà vườn bổ sung ở trang Hồ sơ.
                        </p>
                      )}
                    </Section>

                    <Section icon={<HistoryOutlined />} title="Lịch sử trên nền tảng">
                      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                        <dt className="text-[#6E6A8A]">Đánh giá TB</dt>
                        <dd className="font-medium text-[#1E1B2E]">
                          {provider.ratingAvg ? `${Number(provider.ratingAvg).toFixed(1)} / 5` : 'Chưa có'}
                        </dd>
                        <dt className="text-[#6E6A8A]">Nhận đơn rồi bỏ</dt>
                        <dd className="font-medium text-[#1E1B2E]">{provider.cancelledOrderCount ?? 0} lần</dd>
                        <dt className="text-[#6E6A8A]">Ghi chú lần trước</dt>
                        <dd className="font-medium text-[#1E1B2E] break-words">
                          {provider.verificationNote || <span className="italic font-normal text-[#A098C2]">Chưa có</span>}
                        </dd>
                      </dl>
                    </Section>

                    <ProviderAccountActions
                      providerId={provider.id}
                      displayName={provider.displayName}
                      email={provider.account?.email}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-20 text-[#6E6A8A]">Không tìm thấy thông tin nhà cung cấp.</div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6">
      <h3 className="text-base font-semibold text-[#1E1B2E] mb-4 flex items-center gap-2 flex-wrap">
        <span className="text-[#6027D2]">{icon}</span> {title}
        {hint && <span className="text-xs font-normal text-[#6E6A8A]">{hint}</span>}
      </h3>
      {children}
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  required = false,
  wide = false,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string | null;
  required?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`min-w-0 ${wide ? 'md:col-span-2' : ''}`}>
      <p className="text-xs text-[#6E6A8A] mb-0.5 flex items-center gap-1">
        {icon} {label}
        {required && <span className="text-[#D92D20]">*</span>}
      </p>
      {value?.trim() ? (
        <p className="text-sm font-medium text-[#1E1B2E] break-words whitespace-pre-line">{value}</p>
      ) : (
        <p className={`text-sm italic ${required ? 'text-[#B7791F]' : 'text-[#A098C2]'}`}>Chưa cung cấp</p>
      )}
    </div>
  );
}
