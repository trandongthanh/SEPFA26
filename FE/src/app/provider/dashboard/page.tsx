'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AppstoreOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ContainerOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  RightOutlined,
  SyncOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Spin, Tag, message } from 'antd';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import {
  CareReportItem,
  OrderItem,
  ProviderProfileResponse,
  ServicePackageItem,
  providerApi,
} from '@/lib/provider.api';
import ProviderHeader from '../components/ProviderHeader';
import ProviderSidebar from '../components/ProviderSidebar';

export default function ProviderDashboardPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Auth State
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);

  // Real BE DB States
  const [profile, setProfile] = useState<ProviderProfileResponse | null>(null);
  const [pendingOrders, setPendingOrders] = useState<OrderItem[]>([]);
  const [inCareOrders, setInCareOrders] = useState<OrderItem[]>([]);
  const [myPackages, setMyPackages] = useState<ServicePackageItem[]>([]);
  const [careReports, setCareReports] = useState<CareReportItem[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Guard: Redirect to Login if unauthenticated
  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated) {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, router]);

  // Load Real Data from BE Database APIs
  const fetchData = async () => {
    setLoading(true);
    try {
      const profData = await providerApi.getProfile();
      setProfile(profData);
    } catch {
      setProfile(null);
    }

    try {
      const ordersRes = await providerApi.listOrders('PENDING_PROVIDER');
      if (ordersRes && Array.isArray(ordersRes.items)) {
        setPendingOrders(ordersRes.items);
      } else {
        setPendingOrders([]);
      }
    } catch {
      setPendingOrders([]);
    }

    try {
      const inCareRes = await providerApi.listOrders('IN_CARE');
      if (inCareRes && Array.isArray(inCareRes.items)) {
        setInCareOrders(inCareRes.items);
      } else {
        setInCareOrders([]);
      }
    } catch {
      setInCareOrders([]);
    }

    try {
      const packagesRes = await providerApi.listMyPackages();
      if (Array.isArray(packagesRes)) {
        setMyPackages(packagesRes);
      } else {
        setMyPackages([]);
      }
    } catch {
      setMyPackages([]);
    }

    try {
      const reportsRes = await providerApi.listCareReports();
      if (Array.isArray(reportsRes)) {
        setCareReports(reportsRes);
      } else if (reportsRes && Array.isArray((reportsRes as any).items)) {
        setCareReports((reportsRes as any).items);
      } else {
        setCareReports([]);
      }
    } catch {
      setCareReports([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted && isAuthenticated) {
      fetchData();
    }
  }, [mounted, isAuthenticated]);

  // Handler: Accept / Reject Booking Request
  const handleRespondOrder = async (orderId: string, action: 'ACCEPT' | 'REJECT') => {
    setActionLoading(orderId);
    try {
      await providerApi.respondNegotiation(orderId, action);
      message.success(
        action === 'ACCEPT'
          ? 'Đã chấp nhận yêu cầu đặt lịch đơn hàng!'
          : 'Đã từ chối yêu cầu đặt lịch.'
      );
      fetchData();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || 'Có lỗi xảy ra khi xử lý đơn hàng.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setActionLoading(null);
    }
  };

  if (!mounted || !isAuthenticated) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F6F4FC] font-sans">
      <ProviderSidebar profile={profile} />

      <div className="flex-1 h-screen flex flex-col min-w-0 overflow-hidden">
        <ProviderHeader profile={profile} pendingCount={pendingOrders.length} />

        {/* DASHBOARD BODY */}
        <main className="flex-1 p-6 overflow-y-auto">
          {/* WELCOME BANNER */}
          <div
            className="w-full rounded-2xl p-6 mb-6 bg-cover bg-right bg-no-repeat border border-[#ECE7FA] shadow-xs relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-h-[140px]"
            style={{ backgroundImage: "url('/WelcomeBanner.png')" }}
          >
            <div className="z-10">
              <h2 className="text-2xl font-bold text-[#1E1B2E]">
                Xin chào, {profile?.displayName || user?.fullName || 'Provider'}
              </h2>
              <p className="text-sm text-[#4B4764] mt-1 font-medium">
                Chúc bạn có một ngày quản lý nhà vườn và chăm sóc lan thật hiệu quả!
              </p>
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/90 border border-[#ECE7FA] text-xs font-semibold text-[#6027D2] shadow-xs mt-3 backdrop-blur-xs">
                <CheckCircleOutlined className="text-sm text-[#6027D2]" />
                <span>
                  Trạng thái hồ sơ: {profile?.verificationStatus === 'APPROVED' ? 'Đã duyệt' : 'Đang xử lý'}
                </span>
              </div>
            </div>

            <div className="z-10 self-start sm:self-auto flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/95 border border-[#ECE7FA] text-xs font-semibold text-[#6027D2] shadow-xs backdrop-blur-xs">
              <CalendarOutlined className="text-base text-[#6027D2]" />
              <span>Hôm nay, {dayjs().format('DD/MM/YYYY')}</span>
            </div>
          </div>

          {loading ? (
            <div className="py-20 text-center">
              <Spin size="large" />
              <p className="mt-3 text-sm text-[#6E6A8A]">Đang tải dữ liệu Bảng điều khiển...</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* 4 STATISTIC CARDS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div
                  onClick={() => router.push('/provider/packages')}
                  className="bg-white rounded-2xl p-5 border border-[#ECE7FA] hover:border-[#6027D2] shadow-[0_4px_16px_rgba(96,39,210,0.04)] cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-9 h-9 rounded-full bg-[#F3E8FF] text-[#6027D2] flex items-center justify-center text-base">
                      <EnvironmentOutlined />
                    </div>
                  </div>
                  <p className="text-xs text-[#6E6A8A] font-medium">Gói dịch vụ của tôi</p>
                  <h3 className="text-2xl font-bold text-[#1E1B2E] mt-1 leading-none">
                    {myPackages.length}
                  </h3>
                  <p className="text-xs text-[#8B86A4] mt-1 font-normal">gói đang hoạt động</p>
                </div>

                <div
                  onClick={() => router.push('/provider/orders?tab=IN_CARE')}
                  className="bg-white rounded-2xl p-5 border border-[#ECE7FA] hover:border-[#6027D2] shadow-[0_4px_16px_rgba(96,39,210,0.04)] cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-9 h-9 rounded-full bg-[#F3E8FF] text-[#6027D2] flex items-center justify-center text-base">
                      <SyncOutlined />
                    </div>
                  </div>
                  <p className="text-xs text-[#6E6A8A] font-medium">Đang chăm sóc</p>
                  <h3 className="text-2xl font-bold text-[#1E1B2E] mt-1 leading-none">
                    {inCareOrders.length}
                  </h3>
                  <p className="text-xs text-[#8B86A4] mt-1 font-normal">đơn dịch vụ</p>
                </div>

                <div
                  onClick={() => router.push('/provider/orders?tab=PENDING_PROVIDER')}
                  className="bg-white rounded-2xl p-5 border border-[#ECE7FA] hover:border-[#6027D2] shadow-[0_4px_16px_rgba(96,39,210,0.04)] cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-9 h-9 rounded-full bg-[#FEF3C7] text-[#D97706] flex items-center justify-center text-base">
                      <ClockCircleOutlined />
                    </div>
                  </div>
                  <p className="text-xs text-[#6E6A8A] font-medium">Chờ duyệt</p>
                  <h3 className="text-2xl font-bold text-[#1E1B2E] mt-1 leading-none">
                    {pendingOrders.length}
                  </h3>
                  <p className="text-xs text-[#8B86A4] mt-1 font-normal">yêu cầu đặt lịch</p>
                </div>

                <div
                  onClick={() => router.push('/provider/reports')}
                  className="bg-white rounded-2xl p-5 border border-[#ECE7FA] hover:border-[#6027D2] shadow-[0_4px_16px_rgba(96,39,210,0.04)] cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-9 h-9 rounded-full bg-[#E0F2FE] text-[#0284C7] flex items-center justify-center text-base">
                      <FileTextOutlined />
                    </div>
                  </div>
                  <p className="text-xs text-[#6E6A8A] font-medium">Báo cáo đã nộp</p>
                  <h3 className="text-2xl font-bold text-[#1E1B2E] mt-1 leading-none">
                    {careReports.length}
                  </h3>
                  <p className="text-xs text-[#8B86A4] mt-1 font-normal">báo cáo nhật ký</p>
                </div>
              </div>

              {/* MAIN SECTIONS GRID */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Section 1: Yêu cầu đặt lịch chờ duyệt */}
                <div className="bg-white rounded-2xl p-6 border border-[#ECE7FA] shadow-[0_4px_16px_rgba(96,39,210,0.04)] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#F3E8FF] text-[#6027D2] flex items-center justify-center text-sm">
                          <CalendarOutlined />
                        </div>
                        <h3 className="font-bold text-[#1E1B2E] text-base">
                          Yêu cầu đặt lịch gần đây
                        </h3>
                      </div>
                      <button
                        onClick={() => router.push('/provider/orders?tab=PENDING_PROVIDER')}
                        className="text-xs font-semibold text-[#6E6A8A] hover:text-[#6027D2] flex items-center gap-1 transition-colors"
                      >
                        Xem tất cả <RightOutlined className="text-[10px]" />
                      </button>
                    </div>

                    {pendingOrders.length === 0 ? (
                      <div className="py-12 text-center flex flex-col items-center justify-center">
                        <div className="w-16 h-16 rounded-full bg-[#F3E8FF] text-[#6027D2] flex items-center justify-center text-3xl mb-3">
                          <CalendarOutlined />
                        </div>
                        <h4 className="font-bold text-[#1E1B2E] text-sm">Chưa có yêu cầu đặt lịch mới</h4>
                        <p className="text-xs text-[#6E6A8A] mt-1">
                          Khi có khách hàng đăng ký gửi chăm sóc, thông tin sẽ xuất hiện ở đây.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {pendingOrders.map((req) => (
                          <div
                            key={req.id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-[#ECE7FA] hover:border-[#6027D2] transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <Avatar size={40} icon={<UserOutlined />} className="!bg-[#6027D2]" />
                              <div>
                                <h4 className="font-bold text-[#1E1B2E] text-sm">
                                  {req.customer?.account?.fullName || 'Khách hàng đặt đơn'}
                                </h4>
                                <p className="text-xs text-[#6E6A8A] mt-0.5">
                                  Mã đơn: <strong className="text-[#1E1B2E]">{req.orderCode}</strong>
                                </p>
                                <p className="text-xs text-[#6027D2] font-medium mt-0.5">
                                  Gói: {req.servicePackage?.name || 'Gói dịch vụ chăm sóc'}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 justify-end">
                              <Button
                                onClick={() => handleRespondOrder(req.id, 'REJECT')}
                                loading={actionLoading === req.id}
                                className="!h-9 !px-4 !rounded-xl !bg-[#F6F4FC] !border-none !text-[#4B4764] hover:!bg-[#ECE7FA] !font-medium text-xs"
                              >
                                Từ chối
                              </Button>
                              <Button
                                type="primary"
                                onClick={() => handleRespondOrder(req.id, 'ACCEPT')}
                                loading={actionLoading === req.id}
                                className="!h-9 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold text-xs shadow-sm"
                              >
                                Chấp nhận
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 2: Đơn đang trong quá trình chăm sóc */}
                <div className="bg-white rounded-2xl p-6 border border-[#ECE7FA] shadow-[0_4px_16px_rgba(96,39,210,0.04)] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#F3E8FF] text-[#6027D2] flex items-center justify-center text-sm">
                          <CheckCircleOutlined />
                        </div>
                        <h3 className="font-bold text-[#1E1B2E] text-base">
                          Đơn đang trong quá trình chăm sóc
                        </h3>
                      </div>
                      <button
                        onClick={() => router.push('/provider/orders?tab=IN_CARE')}
                        className="text-xs font-semibold text-[#6E6A8A] hover:text-[#6027D2] flex items-center gap-1 transition-colors"
                      >
                        Xem tất cả <RightOutlined className="text-[10px]" />
                      </button>
                    </div>

                    {inCareOrders.length === 0 ? (
                      <div className="py-12 text-center flex flex-col items-center justify-center">
                        <div className="w-16 h-16 rounded-2xl bg-[#F6F4FC] border border-[#ECE7FA] text-[#8B86A4] flex items-center justify-center text-3xl mb-3">
                          <ContainerOutlined />
                        </div>
                        <p className="text-xs text-[#6E6A8A]">
                          Chưa có đơn hàng nào đang trong quá trình chăm sóc
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {inCareOrders.map((order) => (
                          <div
                            key={order.id}
                            className="flex items-center justify-between p-4 rounded-xl border border-[#ECE7FA] hover:border-[#6027D2] transition-colors"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-[#1E1B2E]">
                                  {order.orderCode}
                                </span>
                                <Tag color="purple">Đang chăm sóc</Tag>
                              </div>
                              <p className="text-xs text-[#6E6A8A] mt-1">
                                Khách hàng: {order.customer?.account?.fullName || 'Khách hàng'}
                              </p>
                            </div>
                            <Button
                              type="default"
                              size="small"
                              onClick={() => router.push(`/provider/reports?orderId=${order.id}`)}
                              className="!rounded-lg !text-xs !border-[#6027D2] !text-[#6027D2]"
                            >
                              Nộp báo cáo
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 3: Gói dịch vụ của nhà vườn */}
                <div className="bg-white rounded-2xl p-6 border border-[#ECE7FA] shadow-[0_4px_16px_rgba(96,39,210,0.04)] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#F6F4FC] text-[#6E6A8A] flex items-center justify-center text-sm">
                          <AppstoreOutlined />
                        </div>
                        <h3 className="font-bold text-[#1E1B2E] text-base">
                          Gói dịch vụ của nhà vườn
                        </h3>
                      </div>
                      <button
                        onClick={() => router.push('/provider/packages')}
                        className="text-xs font-semibold text-[#6E6A8A] hover:text-[#6027D2] flex items-center gap-1 transition-colors"
                      >
                        Quản lý <RightOutlined className="text-[10px]" />
                      </button>
                    </div>

                    {myPackages.length === 0 ? (
                      <div className="py-12 text-center flex flex-col items-center justify-center">
                        <div className="w-16 h-16 rounded-2xl bg-[#F6F4FC] border border-[#ECE7FA] text-[#8B86A4] flex items-center justify-center text-3xl mb-3">
                          <AppstoreOutlined />
                        </div>
                        <p className="text-xs text-[#6E6A8A]">
                          Bạn chưa đăng ký gói dịch vụ nào
                        </p>
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => router.push('/provider/packages?create=true')}
                          className="mt-3 !rounded-lg !bg-[#6027D2] !text-xs"
                        >
                          Tạo gói ngay
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {myPackages.slice(0, 3).map((pkg) => (
                          <div
                            key={pkg.id}
                            className="p-3.5 rounded-xl border border-[#ECE7FA] flex items-center justify-between"
                          >
                            <div>
                              <h4 className="font-bold text-sm text-[#1E1B2E]">{pkg.name}</h4>
                              {pkg.description && (
                                <p className="text-xs text-[#6E6A8A] line-clamp-1 mt-0.5">
                                  {pkg.description}
                                </p>
                              )}
                            </div>
                            <span className="text-xs font-bold text-[#6027D2]">
                              {Number(pkg.basePrice || pkg.pricePerMonth || 0).toLocaleString('vi-VN')}đ
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 4: Báo cáo chăm sóc gần đây */}
                <div className="bg-white rounded-2xl p-6 border border-[#ECE7FA] shadow-[0_4px_16px_rgba(96,39,210,0.04)] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#F6F4FC] text-[#6E6A8A] flex items-center justify-center text-sm">
                          <FileTextOutlined />
                        </div>
                        <h3 className="font-bold text-[#1E1B2E] text-base">
                          Báo cáo chăm sóc gần đây
                        </h3>
                      </div>
                      <button
                        onClick={() => router.push('/provider/reports')}
                        className="text-xs font-semibold text-[#6E6A8A] hover:text-[#6027D2] flex items-center gap-1 transition-colors"
                      >
                        Xem tất cả <RightOutlined className="text-[10px]" />
                      </button>
                    </div>

                    {careReports.length === 0 ? (
                      <div className="py-12 text-center flex flex-col items-center justify-center">
                        <div className="w-16 h-16 rounded-2xl bg-[#F6F4FC] border border-[#ECE7FA] text-[#8B86A4] flex items-center justify-center text-3xl mb-3">
                          <FileTextOutlined />
                        </div>
                        <p className="text-xs text-[#6E6A8A]">
                          Chưa có nhật ký báo cáo chăm sóc nào
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {careReports.slice(0, 3).map((rpt, idx) => (
                          <div
                            key={rpt.id || idx}
                            className="p-3.5 rounded-xl border border-[#ECE7FA] flex items-center justify-between"
                          >
                            <div>
                              <p className="text-xs font-semibold text-[#1E1B2E]">
                                {rpt.notes || rpt.plantNameSnapshot || 'Báo cáo chăm sóc định kỳ'}
                              </p>
                              {rpt.createdAt && (
                                <p className="text-[11px] text-[#6E6A8A] mt-0.5">
                                  Ngày nộp: {new Date(rpt.createdAt).toLocaleDateString('vi-VN')}
                                </p>
                              )}
                            </div>
                            <CheckCircleOutlined className="text-[#6027D2] text-base" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
