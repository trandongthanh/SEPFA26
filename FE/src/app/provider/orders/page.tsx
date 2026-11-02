'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AuditOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ContainerOutlined,
  DollarOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  PictureOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Image, Input, Modal, Radio, Segmented, Select, Spin, Tag, message } from 'antd';
import { useAuthStore } from '@/lib/auth.store';
import { OrderItem, ProviderProfileResponse, providerApi } from '@/lib/provider.api';
import { videoCallApi } from '@/lib/video-call.api';
import ProviderHeader from '../components/ProviderHeader';
import ProviderSidebar from '../components/ProviderSidebar';

function OrdersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [videoCallLoading, setVideoCallLoading] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProviderProfileResponse | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [activeTab, setActiveTab] = useState<string>('PENDING_PROVIDER');

  // State for Order Detail Modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [orderDetail, setOrderDetail] = useState<any | null>(null);

  // State for Handover Assessment Modal
  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [handoverOrder, setHandoverOrder] = useState<any | null>(null);
  const [plantForms, setPlantForms] = useState<
    Record<
      string,
      {
        decision: 'ACCEPT' | 'ACCEPT_HIGH_RISK' | 'ADJUST' | 'REJECT';
        isHighRisk: boolean;
        note: string;
        photoUrl: string;
        caption: string;
        saved?: boolean;
      }
    >
  >({});
  const [savingPlantId, setSavingPlantId] = useState<string | null>(null);
  const [completingHandover, setCompletingHandover] = useState(false);

  // State for Contract Modal
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractData, setContractData] = useState<any | null>(null);

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
          ? 'Đã chấp nhận đơn đặt lịch thành công! Đơn chuyển sang giai đoạn ký hợp đồng.'
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

  // Handle Provider Sign Service Agreement
  const handleSignAgreement = async (orderId: string) => {
    setActionLoading(orderId);
    try {
      await providerApi.signAgreement(orderId);
      message.success('Đã ký hợp đồng dịch vụ trực tuyến thành công!');
      loadData(activeTab);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Không thể ký hợp đồng lúc này.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setActionLoading(null);
    }
  };

  // Bắt đầu phiên bàn giao cây (PAID -> HANDOVER_IN_PROGRESS)
  const handleStartHandover = async (orderId: string) => {
    setActionLoading(orderId);
    try {
      await providerApi.startHandover(orderId);
      message.success('Đã mở phiên tiếp nhận bàn giao cây! Vui lòng tiến hành thẩm định từng cây.');
      loadData(activeTab);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Không thể bắt đầu bàn giao.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setActionLoading(null);
    }
  };

  // Mở modal thẩm định bàn giao
  const handleOpenHandoverModal = async (orderId: string) => {
    setHandoverModalOpen(true);
    setHandoverLoading(true);
    try {
      const detail = await providerApi.getOrderDetail(orderId);
      setHandoverOrder(detail);
      const forms: Record<string, any> = {};
      detail.plants?.forEach((p: any) => {
        forms[p.id] = {
          decision: p.handoverDecision || 'ACCEPT',
          isHighRisk: p.isHighRisk || false,
          note: p.handoverNote || '',
          photoUrl: p.initialPhotos?.[0]?.photoUrl || '',
          caption: 'Ảnh thẩm định hiện trạng tại vườn',
          saved: !!p.handoverDecision,
        };
      });
      setPlantForms(forms);
    } catch (err: any) {
      message.error('Không thể tải chi tiết đơn hàng để thẩm định.');
    } finally {
      setHandoverLoading(false);
    }
  };

  // Lưu thẩm định cho 1 cây
  const handleSavePlantAssessment = async (plantId: string) => {
    if (!handoverOrder) return;
    const form = plantForms[plantId];
    if (!form) return;
    if (!form.photoUrl || !form.photoUrl.trim()) {
      message.warning('Vui lòng cung cấp link ảnh hiện trạng thẩm định.');
      return;
    }

    setSavingPlantId(plantId);
    try {
      await providerApi.assessPlant(handoverOrder.id, plantId, {
        checklist: {
          visualCheck: 'PASSED',
          rootCondition: 'CHECKED',
        },
        decision: form.decision,
        isHighRisk: form.decision === 'ACCEPT_HIGH_RISK',
        note: form.note || undefined,
        photos: [
          {
            photoUrl: form.photoUrl.trim(),
            caption: form.caption || 'Ảnh thẩm định hiện trạng tại vườn',
          },
        ],
      });
      message.success('Đã lưu kết quả thẩm định chậu cây này!');
      setPlantForms((prev) => ({
        ...prev,
        [plantId]: { ...prev[plantId], saved: true },
      }));
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Không thể lưu thẩm định cây.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setSavingPlantId(null);
    }
  };

  // Hoàn tất thẩm định và bàn giao (HANDOVER_IN_PROGRESS -> HANDOVER_AWAITING_CONFIRM)
  const handleCompleteHandover = async () => {
    if (!handoverOrder) return;
    setCompletingHandover(true);
    try {
      await providerApi.completeHandover(handoverOrder.id);
      message.success('Đã hoàn tất thẩm định! Đơn hàng đang chờ khách hàng xác nhận bàn giao.');
      setHandoverModalOpen(false);
      loadData(activeTab);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Không thể hoàn tất thẩm định bàn giao.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setCompletingHandover(false);
    }
  };

  // Mở modal xem chi tiết hợp đồng điện tử
  const handleOpenContractModal = async (orderId: string) => {
    setContractModalOpen(true);
    setContractLoading(true);
    try {
      const data = await providerApi.getContract(orderId);
      setContractData(data);
    } catch (err: any) {
      message.error('Không thể tải chi tiết hợp đồng.');
    } finally {
      setContractLoading(false);
    }
  };

  // === Video Call ===
  const CALL_ELIGIBLE_STATUSES = new Set([
    'PENDING_PROVIDER',
    'AGREEMENT_PENDING',
    'AWAITING_PAYMENT',
    'PAID',
    'HANDOVER_IN_PROGRESS',
    'HANDOVER_AWAITING_CONFIRM',
    'IN_CARE',
  ]);

  const handleStartVideoCall = async (orderId: string) => {
    setVideoCallLoading(orderId);
    try {
      // 1. Kiểm tra xem đã có cuộc gọi đang diễn ra của đơn này không
      try {
        const active = await videoCallApi.getActive(orderId);
        if (active?.call) {
          const session = await videoCallApi.joinCall(active.call.id);
          if (typeof window !== 'undefined') {
            sessionStorage.setItem(
              `lancare_call_session_${active.call.id}`,
              JSON.stringify(session),
            );
          }
          router.push(`/calls/${session.stream.callType}/${active.call.id}`);
          return;
        }
      } catch {
        // Bỏ qua lỗi getActive, tiếp tục tạo cuộc gọi mới
      }

      // 2. Tạo cuộc gọi mới qua BE API
      const session = await videoCallApi.createCall(orderId);
      const callId = session.call.id;
      const callType = session.stream?.callType || 'default';

      if (typeof window !== 'undefined') {
        sessionStorage.setItem(
          `lancare_call_session_${callId}`,
          JSON.stringify(session),
        );
      }

      router.push(`/calls/${callType}/${callId}`);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Không thể bắt đầu cuộc gọi.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setVideoCallLoading(null);
    }
  };

  const handleOpenDetail = async (orderId: string) => {
    setDetailModalOpen(true);
    setDetailLoading(true);
    try {
      const data = await providerApi.getOrderDetail(orderId);
      setOrderDetail(data);
    } catch (err: any) {
      message.error('Không thể tải thông tin chi tiết đơn hàng.');
      setDetailModalOpen(false);
    } finally {
      setDetailLoading(false);
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
      case 'AGREEMENT_PENDING':
        return (
          <Tag color="gold" icon={<FileProtectOutlined />}>
            Chờ ký hợp đồng
          </Tag>
        );
      case 'AWAITING_PAYMENT':
        return (
          <Tag color="cyan" icon={<DollarOutlined />}>
            Chờ khách thanh toán
          </Tag>
        );
      case 'PAID':
        return (
          <Tag color="blue" icon={<CheckCircleOutlined />}>
            Đã thanh toán
          </Tag>
        );
      case 'HANDOVER_IN_PROGRESS':
        return (
          <Tag color="geekblue" icon={<EnvironmentOutlined />}>
            Đang bàn giao cây
          </Tag>
        );
      case 'HANDOVER_AWAITING_CONFIRM':
        return (
          <Tag color="volcano" icon={<ClockCircleOutlined />}>
            Chờ khách xác nhận bàn giao
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
      case 'REJECTED':
        return (
          <Tag color="default" icon={<CloseCircleOutlined />}>
            Đã từ chối
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
                { label: 'Chờ ký hợp đồng', value: 'AGREEMENT_PENDING' },
                { label: 'Đã thanh toán', value: 'PAID' },
                { label: 'Đang bàn giao cây', value: 'HANDOVER_IN_PROGRESS' },
                { label: 'Chờ khách xác nhận', value: 'HANDOVER_AWAITING_CONFIRM' },
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

                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        icon={<EyeOutlined />}
                        onClick={() => handleOpenDetail(order.id)}
                        className="!h-9 !px-4 !rounded-xl !bg-[#F3E8FF] !border-none !text-[#6027D2] hover:!bg-[#E9D8FD] !font-semibold text-xs flex items-center gap-1"
                      >
                        Xem chi tiết
                      </Button>

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

                      {order.status === 'AGREEMENT_PENDING' && (
                        <Button
                          type="primary"
                          icon={<FileProtectOutlined />}
                          onClick={() => handleSignAgreement(order.id)}
                          loading={actionLoading === order.id}
                          className="!h-9 !px-4 !rounded-xl !bg-[#D97706] hover:!bg-[#B45309] !font-semibold text-xs shadow-sm flex items-center gap-1 text-white"
                        >
                          Ký hợp đồng online
                        </Button>
                      )}

                      {order.status === 'PAID' && (
                        <Button
                          type="primary"
                          icon={<EnvironmentOutlined />}
                          onClick={() => handleStartHandover(order.id)}
                          loading={actionLoading === order.id}
                          className="!h-9 !px-4 !rounded-xl !bg-[#805AD5] hover:!bg-[#6B46C1] !font-semibold text-xs shadow-sm flex items-center gap-1 text-white"
                        >
                          Bắt đầu bàn giao cây
                        </Button>
                      )}

                      {order.status === 'HANDOVER_IN_PROGRESS' && (
                        <Button
                          type="primary"
                          icon={<AuditOutlined />}
                          onClick={() => handleOpenHandoverModal(order.id)}
                          className="!h-9 !px-4 !rounded-xl !bg-[#2563EB] hover:!bg-[#1D4ED8] !font-semibold text-xs shadow-sm flex items-center gap-1 text-white"
                        >
                          Thẩm định & Bàn giao cây
                        </Button>
                      )}

                      {order.status === 'HANDOVER_AWAITING_CONFIRM' && (
                        <Tag color="volcano" className="!h-9 !px-3 !rounded-xl flex items-center font-semibold text-xs">
                          Chờ khách xác nhận bàn giao
                        </Tag>
                      )}

                      {['AGREEMENT_PENDING', 'AWAITING_PAYMENT', 'PAID', 'HANDOVER_IN_PROGRESS', 'HANDOVER_AWAITING_CONFIRM', 'IN_CARE'].includes(order.status) && (
                        <Button
                          icon={<FileProtectOutlined />}
                          onClick={() => handleOpenContractModal(order.id)}
                          className="!h-9 !px-3 !rounded-xl text-xs flex items-center gap-1 !border-[#ECE7FA] text-[#6E6A8A] hover:!text-[#6027D2]"
                        >
                          Xem Hợp đồng
                        </Button>
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

                      {/* Nút Gọi Video cho các trạng thái eligible */}
                      {CALL_ELIGIBLE_STATUSES.has(order.status) && (
                        <Button
                          icon={<VideoCameraOutlined />}
                          loading={videoCallLoading === order.id}
                          onClick={() => handleStartVideoCall(order.id)}
                          className="!h-9 !px-4 !rounded-xl !bg-emerald-50 !border-emerald-200 !text-emerald-700 hover:!bg-emerald-100 !font-semibold text-xs flex items-center gap-1"
                        >
                          Gọi Video
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

      {/* Order Detail Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-[#1E1B2E]">
            <ContainerOutlined className="text-[#6027D2]" />
            <span>Chi tiết đơn hàng {orderDetail?.orderCode ? `- ${orderDetail.orderCode}` : ''}</span>
          </div>
        }
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={
          <div className="flex items-center justify-end gap-2 pt-2">
            {orderDetail?.status === 'PENDING_PROVIDER' && (
              <>
                <Button
                  onClick={() => {
                    handleRespondOrder(orderDetail.id, 'REJECT');
                    setDetailModalOpen(false);
                  }}
                  loading={actionLoading === orderDetail?.id}
                  className="!rounded-xl !bg-[#F6F4FC] !border-none !text-[#4B4764]"
                >
                  Từ chối
                </Button>
                <Button
                  type="primary"
                  onClick={() => {
                    handleRespondOrder(orderDetail.id, 'ACCEPT');
                    setDetailModalOpen(false);
                  }}
                  loading={actionLoading === orderDetail?.id}
                  className="!rounded-xl !bg-[#6027D2]"
                >
                  Chấp nhận đơn
                </Button>
              </>
            )}
            {orderDetail && CALL_ELIGIBLE_STATUSES.has(orderDetail.status) && (
              <Button
                icon={<VideoCameraOutlined />}
                loading={videoCallLoading === orderDetail?.id}
                onClick={() => {
                  handleStartVideoCall(orderDetail.id);
                  setDetailModalOpen(false);
                }}
                className="!rounded-xl !bg-emerald-50 !border-emerald-200 !text-emerald-700 hover:!bg-emerald-100"
              >
                Gọi Video
              </Button>
            )}
            <Button onClick={() => setDetailModalOpen(false)} className="!rounded-xl">
              Đóng
            </Button>
          </div>
        }
        width={720}
        centered
      >
        {detailLoading ? (
          <div className="py-12 text-center">
            <Spin size="large" />
            <p className="mt-3 text-sm text-[#6E6A8A]">Đang tải chi tiết đơn hàng...</p>
          </div>
        ) : orderDetail ? (
          <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
            {/* Overview Card */}
            <div className="bg-[#F8F6FC] rounded-2xl p-4 border border-[#ECE7FA] flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#1E1B2E] text-sm">Mã đơn: {orderDetail.orderCode}</span>
                  {getStatusBadge(orderDetail.status)}
                </div>
                <p className="text-xs text-[#6E6A8A] mt-1">
                  Khách hàng: <strong className="text-[#1E1B2E]">{orderDetail.customer?.account?.fullName || 'Khách hàng'}</strong>
                  {orderDetail.customer?.account?.phone ? ` (${orderDetail.customer.account.phone})` : ''}
                </p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-[#8B86A4] uppercase font-semibold">Tạm tính</span>
                <p className="text-lg font-bold text-[#6027D2]">
                  {Number(orderDetail.finalTotal || orderDetail.provisionalTotal || 0).toLocaleString('vi-VN')} VNĐ
                </p>
              </div>
            </div>

            {/* Package & Logistics Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-xl border border-[#ECE7FA]">
                <h4 className="font-bold text-xs text-[#6027D2] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ContainerOutlined /> Gói dịch vụ chăm sóc
                </h4>
                <p className="text-sm font-bold text-[#1E1B2E]">{orderDetail.servicePackage?.name || 'Gói chăm sóc tiêu chuẩn'}</p>
                <p className="text-xs text-[#6E6A8A] mt-1">
                  Thời hạn chăm sóc: {orderDetail.durationDaysSnapshot || orderDetail.servicePackage?.durationDays || '--'} ngày
                </p>
                <p className="text-xs text-[#6E6A8A] mt-0.5">
                  Tần suất gửi báo cáo: {orderDetail.reportFrequencySnapshot || orderDetail.servicePackage?.reportFrequencyDays || '--'} ngày/lần
                </p>
              </div>

              <div className="bg-white p-4 rounded-xl border border-[#ECE7FA]">
                <h4 className="font-bold text-xs text-[#6027D2] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <EnvironmentOutlined /> Địa chỉ & Hẹn giao cây
                </h4>
                {orderDetail.scheduledPickupAt && (
                  <p className="text-xs text-[#1E1B2E] font-medium flex items-center gap-1 mb-1">
                    <CalendarOutlined className="text-[#6027D2]" /> Ngày hẹn tiếp nhận: {new Date(orderDetail.scheduledPickupAt).toLocaleDateString('vi-VN')}
                  </p>
                )}
                <p className="text-xs text-[#6E6A8A]">
                  Địa chỉ: <strong className="text-[#1E1B2E]">{orderDetail.pickupAddress || 'Chưa cung cấp'}</strong>
                </p>
                {orderDetail.customerNote && (
                  <p className="text-xs text-[#DD6B20] mt-1 bg-[#FFFAF0] p-2 rounded-lg border border-[#FEEBC8]">
                    💬 Ghi chú từ khách: "{orderDetail.customerNote}"
                  </p>
                )}
              </div>
            </div>

            {/* Plants List */}
            <div>
              <h4 className="font-bold text-sm text-[#1E1B2E] mb-3">
                Danh sách chậu lan gửi chăm sóc ({orderDetail.plants?.length || 0})
              </h4>
              
              <div className="space-y-3">
                {orderDetail.plants?.map((plant: any, idx: number) => (
                  <div key={plant.id || idx} className="bg-white p-4 rounded-xl border border-[#ECE7FA]">
                    <div className="flex items-center justify-between gap-2">
                      <h5 className="font-bold text-sm text-[#1E1B2E]">
                        Chậu #{idx + 1}: {plant.name}
                      </h5>
                      {plant.isValueDeclared && plant.declaredValue && (
                        <Tag color="gold" className="!rounded-md font-medium">
                          Giá trị khai báo: {Number(plant.declaredValue).toLocaleString('vi-VN')} VNĐ
                        </Tag>
                      )}
                    </div>

                    {plant.speciesName && (
                      <p className="text-xs text-[#6E6A8A] mt-1">
                        Giống lan / Tình trạng: <span className="text-[#1E1B2E] font-medium">{plant.speciesName}</span>
                      </p>
                    )}

                    {/* Photos */}
                    {(() => {
                      const plantPhotos = plant.initialPhotos || plant.photos || [];
                      return plantPhotos.length > 0 ? (
                        <div className="mt-3">
                          <p className="text-[11px] font-semibold text-[#8B86A4] mb-1.5 flex items-center gap-1">
                            <PictureOutlined /> Ảnh chụp hiện trạng ban đầu (từ camera khách):
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {plantPhotos.map((photo: any) => (
                              <div key={photo.id} className="relative group">
                                <Image
                                  src={photo.photoUrl}
                                  alt={photo.caption || plant.name}
                                  width={80}
                                  height={80}
                                  className="rounded-lg object-cover border border-[#ECE7FA]"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-[#A0AEC0] italic mt-2">Chưa có ảnh hiện trạng gửi kèm.</p>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Handover Assessment Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-[#1E1B2E]">
            <AuditOutlined className="text-[#2563EB]" />
            <span>
              Thẩm định hiện trạng & Bàn giao nhận cây{' '}
              {handoverOrder?.orderCode ? `- ${handoverOrder.orderCode}` : ''}
            </span>
          </div>
        }
        open={handoverModalOpen}
        onCancel={() => setHandoverModalOpen(false)}
        width={820}
        centered
        footer={
          <div className="flex items-center justify-between pt-3 border-t border-[#ECE7FA]">
            <span className="text-xs text-[#6E6A8A]">
              * Bấm <strong>"Lưu thẩm định chậu này"</strong> cho từng cây trước khi hoàn tất.
            </span>
            <div className="flex items-center gap-2">
              <Button onClick={() => setHandoverModalOpen(false)} className="!rounded-xl">
                Đóng
              </Button>
              <Button
                type="primary"
                onClick={handleCompleteHandover}
                loading={completingHandover}
                className="!rounded-xl !bg-[#2563EB] hover:!bg-[#1D4ED8] !font-bold"
              >
                Hoàn tất thẩm định & Chốt bàn giao
              </Button>
            </div>
          </div>
        }
      >
        {handoverLoading ? (
          <div className="py-16 text-center">
            <Spin size="large" />
            <p className="mt-3 text-sm text-[#6E6A8A]">Đang tải danh sách cây cần bàn giao...</p>
          </div>
        ) : handoverOrder ? (
          <div className="space-y-5 max-h-[72vh] overflow-y-auto pr-1">
            {/* Guide Banner */}
            <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <SafetyCertificateOutlined className="text-[#2563EB] text-lg mt-0.5" />
                <div>
                  <h4 className="font-bold text-[#1E3A8A] text-sm">Quy trình thẩm định tiếp nhận tại vườn</h4>
                  <p className="text-xs text-[#3B82F6] mt-0.5 leading-relaxed">
                    Nhà vườn đối chiếu hiện trạng thực tế của từng chậu cây lúc nhận từ shipper/khách hàng. 
                    Mỗi chậu cây <strong>bắt buộc có ít nhất 1 ảnh chụp thẩm định</strong> làm bằng chứng pháp lý khi trách nhiệm chuyển giao sang nhà vườn.
                  </p>
                </div>
              </div>
            </div>

            {/* Plants Assessment List */}
            <div className="space-y-4">
              {handoverOrder.plants?.map((plant: any, idx: number) => {
                const form = plantForms[plant.id] || {
                  decision: 'ACCEPT',
                  isHighRisk: false,
                  note: '',
                  photoUrl: '',
                  caption: '',
                };

                return (
                  <div
                    key={plant.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      form.saved
                        ? 'bg-[#F0FDF4] border-[#BBF7D0]'
                        : 'bg-white border-[#ECE7FA]'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-3 border-b border-[#F1F5F9]">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-[#2563EB] text-white flex items-center justify-center text-xs font-bold">
                          {idx + 1}
                        </span>
                        <h5 className="font-bold text-sm text-[#1E1B2E]">
                          {plant.name} {plant.speciesName ? `(${plant.speciesName})` : ''}
                        </h5>
                        {plant.isValueDeclared && plant.declaredValue && (
                          <Tag color="gold" className="!rounded-md text-[11px]">
                            Giá trị khai báo: {Number(plant.declaredValue).toLocaleString('vi-VN')} VNĐ
                          </Tag>
                        )}
                      </div>

                      {form.saved ? (
                        <Tag color="success" icon={<CheckCircleOutlined />} className="!rounded-md">
                          Đã lưu thẩm định
                        </Tag>
                      ) : (
                        <Tag color="warning" icon={<ClockCircleOutlined />} className="!rounded-md">
                          Chưa lưu thẩm định
                        </Tag>
                      )}
                    </div>

                    <div className="space-y-3">
                      {/* Decision Radio Group */}
                      <div>
                        <label className="block text-xs font-bold text-[#4B4764] mb-1.5">
                          Quyết định thẩm định tiếp nhận:
                        </label>
                        <Radio.Group
                          value={form.decision}
                          onChange={(e) =>
                            setPlantForms((prev) => ({
                              ...prev,
                              [plant.id]: {
                                ...prev[plant.id],
                                decision: e.target.value,
                                saved: false,
                              },
                            }))
                          }
                          size="small"
                          className="flex flex-wrap gap-2"
                        >
                          <Radio.Button value="ACCEPT" className="!rounded-lg">
                            ✅ Đồng ý nhận (Bình thường)
                          </Radio.Button>
                          <Radio.Button value="ACCEPT_HIGH_RISK" className="!rounded-lg">
                            ⚠️ Nhận (Rủi ro cao)
                          </Radio.Button>
                          <Radio.Button value="ADJUST" className="!rounded-lg">
                            🔄 Điều chỉnh yêu cầu
                          </Radio.Button>
                          <Radio.Button value="REJECT" className="!rounded-lg">
                            ❌ Từ chối chậu này
                          </Radio.Button>
                        </Radio.Group>
                      </div>

                      {/* Photo URL */}
                      <div>
                        <label className="block text-xs font-bold text-[#4B4764] mb-1">
                          Link ảnh chụp thẩm định hiện trạng (bắt buộc):
                        </label>
                        <Input
                          value={form.photoUrl}
                          onChange={(e) =>
                            setPlantForms((prev) => ({
                              ...prev,
                              [plant.id]: {
                                ...prev[plant.id],
                                photoUrl: e.target.value,
                                saved: false,
                              },
                            }))
                          }
                          placeholder="https://res.cloudinary.com/... hoặc link ảnh hiện trạng tiếp nhận"
                          className="!rounded-xl text-xs"
                        />
                        {form.photoUrl ? (
                          <div className="mt-2 flex items-center gap-3">
                            <Image
                              src={form.photoUrl}
                              alt="Ảnh thẩm định"
                              width={70}
                              height={70}
                              className="rounded-lg object-cover border border-[#ECE7FA]"
                              fallback="https://placehold.co/70x70?text=Ảnh+lỗi"
                            />
                            <span className="text-[11px] text-[#6E6A8A]">Xem trước ảnh hiện trạng bàn giao</span>
                          </div>
                        ) : null}
                      </div>

                      {/* Note */}
                      <div>
                        <label className="block text-xs font-bold text-[#4B4764] mb-1">
                          Ghi chú thẩm định hiện trạng cây (lá, ngọn, rễ, giá thể):
                        </label>
                        <Input.TextArea
                          rows={2}
                          value={form.note}
                          onChange={(e) =>
                            setPlantForms((prev) => ({
                              ...prev,
                              [plant.id]: {
                                ...prev[plant.id],
                                note: e.target.value,
                                saved: false,
                              },
                            }))
                          }
                          placeholder="Ví dụ: Rễ khỏe, lá dưới hơi vàng đã xử lý, giá thể ẩm tốt..."
                          className="!rounded-xl text-xs"
                        />
                      </div>

                      <div className="flex justify-end pt-1">
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => handleSavePlantAssessment(plant.id)}
                          loading={savingPlantId === plant.id}
                          className="!rounded-xl !bg-[#6027D2] !font-semibold text-xs"
                        >
                          Lưu thẩm định chậu #{idx + 1}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Contract Detail Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-[#1E1B2E]">
            <FileProtectOutlined className="text-[#D97706]" />
            <span>Chi tiết Hợp đồng dịch vụ chăm sóc hoa lan</span>
          </div>
        }
        open={contractModalOpen}
        onCancel={() => setContractModalOpen(false)}
        width={750}
        centered
        footer={
          <Button onClick={() => setContractModalOpen(false)} className="!rounded-xl">
            Đóng
          </Button>
        }
      >
        {contractLoading ? (
          <div className="py-16 text-center">
            <Spin size="large" />
            <p className="mt-3 text-sm text-[#6E6A8A]">Đang tải nội dung hợp đồng điện tử...</p>
          </div>
        ) : contractData ? (
          (() => {
            const customerParty =
              contractData.parties?.customer || contractData.customerParty || {};
            const providerParty =
              contractData.parties?.provider || contractData.providerParty || {};

            const customerName =
              customerParty.fullName && customerParty.fullName !== 'Chưa cung cấp'
                ? customerParty.fullName
                : 'Khách hàng';
            const customerPhone =
              customerParty.phone && customerParty.phone !== 'Chưa cung cấp'
                ? customerParty.phone
                : 'Chưa cập nhật SĐT';
            const customerAddress =
              customerParty.address && customerParty.address !== 'Chưa cung cấp'
                ? customerParty.address
                : 'Chưa cập nhật địa chỉ';

            const providerName =
              providerParty.fullName && providerParty.fullName !== 'Chưa cung cấp'
                ? providerParty.fullName
                : providerParty.displayName || providerParty.gardenName || 'Nhà vườn';
            const providerPhone =
              providerParty.phone && providerParty.phone !== 'Chưa cung cấp'
                ? providerParty.phone
                : 'Chưa cập nhật SĐT';
            const providerAddress =
              providerParty.address && providerParty.address !== 'Chưa cung cấp'
                ? providerParty.address
                : 'Chưa cập nhật địa chỉ';

            const agreementNumber =
              contractData.agreementNo ||
              contractData.agreement?.agreementNo ||
              'N/A';

            const isCustomerSigned = contractData.signatures?.some(
              (s: any) =>
                (s.role === 'CUSTOMER' || s.signerRole === 'CUSTOMER') &&
                (s.signedAt || s.signatureHash)
            );
            const isProviderSigned = contractData.signatures?.some(
              (s: any) =>
                (s.role === 'PROVIDER' || s.signerRole === 'PROVIDER') &&
                (s.signedAt || s.signatureHash)
            );

            return (
              <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                <div className="text-center p-3 bg-[#F8F6FC] rounded-xl border border-[#ECE7FA]">
                  <h3 className="font-extrabold text-base text-[#1E1B2E]">HỢP ĐỒNG DỊCH VỤ CHĂM SÓC HOA LAN</h3>
                  <p className="text-xs text-[#6027D2] font-semibold mt-1">
                    Số HĐ: {agreementNumber}
                  </p>
                </div>

                {/* Parties */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 bg-white rounded-xl border border-[#ECE7FA]">
                    <span className="text-[10px] font-bold text-[#6027D2] uppercase tracking-wider">
                      BÊN A (Khách hàng)
                    </span>
                    <h5 className="font-bold text-sm text-[#1E1B2E] mt-1">{customerName}</h5>
                    <p className="text-xs text-[#6E6A8A] mt-0.5">SĐT: {customerPhone}</p>
                    <p className="text-xs text-[#6E6A8A]">Địa chỉ: {customerAddress}</p>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-[#ECE7FA]">
                    <span className="text-[10px] font-bold text-[#6027D2] uppercase tracking-wider">
                      BÊN B (Nhà vườn)
                    </span>
                    <h5 className="font-bold text-sm text-[#1E1B2E] mt-1">{providerName}</h5>
                    <p className="text-xs text-[#6E6A8A] mt-0.5">SĐT: {providerPhone}</p>
                    <p className="text-xs text-[#6E6A8A]">Địa chỉ: {providerAddress}</p>
                  </div>
                </div>

                {/* Compensation Policy */}
                <div className="p-3 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl">
                  <h5 className="font-bold text-xs text-[#065F46] flex items-center gap-1.5 mb-1">
                    <SafetyCertificateOutlined /> Điều khoản bồi thường thiệt hại (Tối đa 120%)
                  </h5>
                  <p className="text-xs text-[#047857] leading-relaxed">
                    Nhà vườn cam kết bồi thường lên đến <strong>120% giá trị khai báo hợp lệ</strong> trong trường hợp chậu lan bị chết, thất lạc hoặc hư hỏng nặng do lỗi chăm sóc của nhà vườn trong suốt thời gian nhận chăm sóc.
                  </p>
                </div>

                {/* Plants list */}
                <div>
                  <h5 className="font-bold text-xs text-[#4B4764] mb-2">
                    Danh sách cây trong hợp đồng ({contractData.plants?.length || 0}):
                  </h5>
                  <div className="space-y-2">
                    {contractData.plants?.map((p: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-2.5 bg-[#F8F9FA] rounded-lg text-xs">
                        <span className="font-medium text-[#1E1B2E]">
                          {i + 1}. {p.name} {p.speciesName ? `(${p.speciesName})` : ''}
                        </span>
                        <span className="font-bold text-[#6027D2]">
                          {p.isValueDeclared && p.declaredValue
                            ? `Giá trị khai báo: ${Number(p.declaredValue).toLocaleString('vi-VN')} VNĐ`
                            : 'Không khai báo giá trị'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Signatures status */}
                <div className="p-3 bg-[#F8F6FC] rounded-xl border border-[#ECE7FA]">
                  <h5 className="font-bold text-xs text-[#4B4764] mb-2">Tình trạng chữ ký điện tử:</h5>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="p-2 bg-white rounded-lg border border-[#ECE7FA]">
                      <p className="text-[11px] text-[#6E6A8A]">Đại diện Bên A (Khách hàng)</p>
                      {isCustomerSigned ? (
                        <Tag color="green" className="mt-1 font-bold">
                          ĐÃ KÝ ĐIỆN TỬ
                        </Tag>
                      ) : (
                        <Tag color="default" className="mt-1 font-medium italic">
                          Chưa ký
                        </Tag>
                      )}
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-[#ECE7FA]">
                      <p className="text-[11px] text-[#6E6A8A]">Đại diện Bên B (Nhà vườn)</p>
                      {isProviderSigned ? (
                        <Tag color="green" className="mt-1 font-bold">
                          ĐÃ KÝ ĐIỆN TỬ
                        </Tag>
                      ) : (
                        <Tag color="default" className="mt-1 font-medium italic">
                          Chưa ký
                        </Tag>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()
        ) : null}
      </Modal>
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

export default function OrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
          <Spin size="large" />
        </div>
      }
    >
      <OrdersPageContent />
    </Suspense>
  );
}
