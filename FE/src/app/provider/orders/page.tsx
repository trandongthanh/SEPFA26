'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ContainerOutlined,
  FileTextOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Segmented, Spin, Tag, message } from 'antd';
import { useAuthStore } from '@/lib/auth.store';
import { OrderItem, ProviderProfileResponse, providerApi } from '@/lib/provider.api';
import ProviderHeader from '../components/ProviderHeader';
import ProviderSidebar from '../components/ProviderSidebar';

export default function OrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProviderProfileResponse | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [activeTab, setActiveTab] = useState<string>('PENDING_PROVIDER');

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Guard authentication
  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated) {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, router]);

  // Set active tab from query param if available
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const loadData = async (status?: string) => {
    setLoading(true);
    try {
      const prof = await providerApi.getProfile();
      setProfile(prof);
    } catch {
      setProfile(null);
    }

    try {
      const queryStatus = status === 'ALL' ? undefined : status;
      const res = await providerApi.listOrders(queryStatus);
      if (res && Array.isArray(res.items)) {
        setOrders(res.items);
      } else {
        setOrders([]);
      }
    } catch (err: any) {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted && isAuthenticated) {
      loadData(activeTab);
    }
  }, [mounted, isAuthenticated, activeTab]);

  // Handle Accept / Reject Order Negotiation
  const handleRespondOrder = async (orderId: string, action: 'ACCEPT' | 'REJECT') => {
    setActionLoading(orderId);
    try {
      await providerApi.respondNegotiation(orderId, action);
      message.success(
        action === 'ACCEPT'
          ? 'Đã chấp nhận đơn hàng thành công!'
          : 'Đã từ chối đơn hàng.'
      );
      loadData(activeTab);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || 'Không thể xử lý đơn hàng lúc này.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING_PROVIDER':
        return (
          <Tag color="orange" icon={<ClockCircleOutlined />}>
            Chờ duyệt đặt lịch
          </Tag>
        );
      case 'IN_CARE':
        return (
          <Tag color="purple" icon={<SyncOutlinedSpin />}>
            Đang chăm sóc
          </Tag>
        );
      case 'COMPLETED':
        return (
          <Tag color="green" icon={<CheckCircleOutlined />}>
            Hoàn thành
          </Tag>
        );
      case 'CANCELLED':
        return (
          <Tag color="red" icon={<CloseCircleOutlined />}>
            Đã hủy
          </Tag>
        );
      default:
        return <Tag color="blue">{status}</Tag>;
    }
  };

  if (!mounted || !isAuthenticated) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F6F4FC] font-sans">
      <ProviderSidebar profile={profile} />

      <div className="flex-1 h-screen flex flex-col min-w-0 overflow-hidden">
        <ProviderHeader profile={profile} />

        <main className="flex-1 p-6 overflow-y-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#1E1B2E]">Đơn hàng dịch vụ chăm sóc</h1>
              <p className="text-xs text-[#6E6A8A] mt-1 font-medium">
                Xác nhận các yêu cầu gửi chăm sóc lan và cập nhật tiến độ chăm sóc thực tế
              </p>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="mb-6 bg-white p-2 rounded-2xl border border-[#ECE7FA] shadow-xs inline-block">
            <Segmented
              value={activeTab}
              onChange={(val) => setActiveTab(val as string)}
              options={[
                { label: 'Chờ duyệt đặt lịch', value: 'PENDING_PROVIDER' },
                { label: 'Đang chăm sóc', value: 'IN_CARE' },
                { label: 'Hoàn thành', value: 'COMPLETED' },
                { label: 'Tất cả đơn', value: 'ALL' },
              ]}
              className="!bg-[#F6F4FC] font-semibold text-xs text-[#1E1B2E]"
            />
          </div>

          {loading ? (
            <div className="py-20 text-center">
              <Spin size="large" />
              <p className="mt-3 text-sm text-[#6E6A8A]">Đang tải danh sách đơn hàng...</p>
            </div>
          ) : orders.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-[#ECE7FA] flex flex-col items-center justify-center">
              <div className="w-20 h-20 rounded-full bg-[#F3E8FF] text-[#6027D2] flex items-center justify-center text-4xl mb-4">
                <ContainerOutlined />
              </div>
              <h3 className="font-bold text-[#1E1B2E] text-base">Không có đơn hàng nào</h3>
              <p className="text-xs text-[#6E6A8A] mt-1">
                {activeTab === 'PENDING_PROVIDER'
                  ? 'Hiện tại nhà vườn không có yêu cầu đặt lịch chờ duyệt nào.'
                  : 'Chưa có đơn hàng nào trong trạng thái này.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl p-5 border border-[#ECE7FA] hover:border-[#6027D2] shadow-[0_4px_16px_rgba(96,39,210,0.04)] transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-4">
                    <Avatar
                      size={44}
                      icon={<UserOutlined />}
                      className="!bg-[#6027D2] shrink-0 mt-1"
                    />
                    <div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-bold text-base text-[#1E1B2E]">
                          Mã đơn: <span className="text-[#6027D2]">{order.orderCode}</span>
                        </h3>
                        {getStatusBadge(order.status)}
                      </div>

                      <div className="mt-2 space-y-1 text-xs text-[#6E6A8A]">
                        <p>
                          Khách hàng:{' '}
                          <strong className="text-[#1E1B2E]">
                            {order.customer?.account?.fullName || 'Khách hàng ẩn danh'}
                          </strong>
                        </p>
                        <p>
                          Gói dịch vụ:{' '}
                          <strong className="text-[#6027D2]">
                            {order.servicePackage?.name || 'Gói chăm sóc lan tiêu chuẩn'}
                          </strong>
                        </p>
                        {order.scheduledPickupAt && (
                          <p className="flex items-center gap-1.5 text-[#8B86A4]">
                            <CalendarOutlined /> Hẹn tiếp nhận:{' '}
                            {new Date(order.scheduledPickupAt).toLocaleDateString('vi-VN')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right side: Price & Action Buttons */}
                  <div className="flex flex-col md:items-end justify-between border-t md:border-t-0 pt-3 md:pt-0 border-[#ECE7FA] gap-3">
                    <div className="md:text-right">
                      <span className="text-[10px] text-[#8B86A4] uppercase font-semibold">
                        Tạm tính
                      </span>
                      <p className="text-lg font-bold text-[#6027D2] leading-tight">
                        {Number(order.finalTotal || order.provisionalTotal || 0).toLocaleString(
                          'vi-VN'
                        )}{' '}
                        VNĐ
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {order.status === 'PENDING_PROVIDER' && (
                        <>
                          <Button
                            onClick={() => handleRespondOrder(order.id, 'REJECT')}
                            loading={actionLoading === order.id}
                            className="!h-9 !px-4 !rounded-xl !bg-[#F6F4FC] !border-none !text-[#4B4764] hover:!bg-[#ECE7FA] !font-medium text-xs"
                          >
                            Từ chối
                          </Button>
                          <Button
                            type="primary"
                            onClick={() => handleRespondOrder(order.id, 'ACCEPT')}
                            loading={actionLoading === order.id}
                            className="!h-9 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold text-xs shadow-sm"
                          >
                            Chấp nhận đơn
                          </Button>
                        </>
                      )}

                      {order.status === 'IN_CARE' && (
                        <Button
                          type="primary"
                          icon={<FileTextOutlined />}
                          onClick={() => router.push(`/provider/reports?orderId=${order.id}`)}
                          className="!h-9 !px-4 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold text-xs"
                        >
                          Nộp báo cáo chăm sóc
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function SyncOutlinedSpin() {
  return (
    <span className="inline-block animate-spin mr-1">
      <ClockCircleOutlined />
    </span>
  );
}
