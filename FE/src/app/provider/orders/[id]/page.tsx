'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AppstoreAddOutlined,
  ArrowLeftOutlined,
  AuditOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ContainerOutlined,
  CopyOutlined,
  DollarOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  FormOutlined,
  PictureOutlined,
  PrinterOutlined,
  ToolOutlined,
  UploadOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Checkbox, Image, Input, Modal, Radio, Select, Spin, Tag, message } from 'antd';
import { useAuthStore } from '@/lib/auth.store';
import {
  AddonItem,
  AddonStatus,
  DisputeDetail,
  ProviderProfileResponse,
  providerApi,
} from '@/lib/provider.api';
import { videoCallApi } from '@/lib/video-call.api';
import ProviderHeader from '../../components/ProviderHeader';
import ProviderSidebar from '../../components/ProviderSidebar';

const CALL_ELIGIBLE_STATUSES = new Set([
  'PENDING_PROVIDER',
  'AGREEMENT_PENDING',
  'AWAITING_PAYMENT',
  'PAID',
  'HANDOVER_IN_PROGRESS',
  'HANDOVER_AWAITING_CONFIRM',
  'IN_CARE',
  'RETURN_IN_PROGRESS',
  'RETURN_AWAITING_CONFIRM',
  'COMPLETED',
  'DISPUTED',
]);

export default function ProviderOrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params?.id as string;

  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<ProviderProfileResponse | null>(null);
  const [order, setOrder] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [videoCallLoading, setVideoCallLoading] = useState(false);

  // Addons state
  const [addons, setAddons] = useState<AddonItem[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(false);

  // State for Addon Proposal Modal
  const [addonModalOpen, setAddonModalOpen] = useState(false);
  const [addonTitle, setAddonTitle] = useState('');
  const [addonReason, setAddonReason] = useState('');
  const [addonPrice, setAddonPrice] = useState('');
  const [addonPlantId, setAddonPlantId] = useState<string | undefined>(undefined);
  const [addonPhotoUrls, setAddonPhotoUrls] = useState<string[]>([]);
  const [addonUploading, setAddonUploading] = useState(false);
  const [addonSubmitting, setAddonSubmitting] = useState(false);

  // State for Complete Addon Modal
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [selectedAddonForComplete, setSelectedAddonForComplete] = useState<AddonItem | null>(null);
  const [completePhotoUrls, setCompletePhotoUrls] = useState<string[]>([]);
  const [completeNote, setCompleteNote] = useState('');
  const [completePlantHealth, setCompletePlantHealth] = useState<'GOOD' | 'AVERAGE' | 'POOR'>('GOOD');
  const [completeUploading, setCompleteUploading] = useState(false);
  const [completeSubmitting, setCompleteSubmitting] = useState(false);

  // State for Contract Modal
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractData, setContractData] = useState<any | null>(null);
  const [signingContract, setSigningContract] = useState(false);
  const [confirmSignChecked, setConfirmSignChecked] = useState(false);

  // State for Return Handover Modal
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnPlantForms, setReturnPlantForms] = useState<
    Record<
      string,
      {
        leafCondition: string;
        rootCondition: string;
        hasPest: boolean;
        note: string;
        photoUrl: string;
        saved?: boolean;
      }
    >
  >({});
  const [savingReturnPlantId, setSavingReturnPlantId] = useState<string | null>(null);
  const [uploadingReturnPlantId, setUploadingReturnPlantId] = useState<string | null>(null);
  const [completingReturn, setCompletingReturn] = useState(false);

  // State for Security Deposit Modal (Nhà vườn nộp tiền bảo lãnh)
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositQrData, setDepositQrData] = useState<any | null>(null);

  const handleOpenDepositModal = async () => {
    if (!order) return;
    setDepositModalOpen(true);
    setDepositLoading(true);
    try {
      const data = await providerApi.getSecurityDepositQr(order.id);
      setDepositQrData(data);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Không thể lấy mã QR nộp tiền bảo lãnh lúc này.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setDepositLoading(false);
    }
  };

  // Dispute Room state
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);
  const [disputeDetail, setDisputeDetail] = useState<DisputeDetail | null>(null);
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputeEvidenceUploading, setDisputeEvidenceUploading] = useState(false);
  const [disputeOfferSubmitting, setDisputeOfferSubmitting] = useState(false);
  const [disputeOfferRefund, setDisputeOfferRefund] = useState('');
  const [disputeOfferCompensation, setDisputeOfferCompensation] = useState('');
  const [disputeOfferMessage, setDisputeOfferMessage] = useState('');
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null);

  const handleOpenDisputeModal = async () => {
    if (!order) return;
    setDisputeModalOpen(true);
    setDisputeOfferRefund('');
    setDisputeOfferCompensation('');
    setDisputeOfferMessage('');
    setDisputeLoading(true);
    try {
      const data = await providerApi.getDispute(order.id);
      setDisputeDetail(data);
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Không thể tải hồ sơ tranh chấp.');
      setDisputeDetail(null);
    } finally {
      setDisputeLoading(false);
    }
  };

  const handleUploadProviderEvidence = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !order) return;
    setDisputeEvidenceUploading(true);
    try {
      const uploaded = await providerApi.uploadDocument(file);
      await providerApi.addDisputeEvidence(order.id, {
        photos: [{ photoUrl: uploaded.url }],
      });
      message.success('Đã nộp thêm ảnh bằng chứng.');
      const data = await providerApi.getDispute(order.id);
      setDisputeDetail(data);
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Không thể nộp ảnh bằng chứng.');
    } finally {
      setDisputeEvidenceUploading(false);
    }
  };

  const handleSubmitOffer = async () => {
    if (!order || !disputeDetail) return;
    const refNum = parseInt(disputeOfferRefund || '0', 10);
    const compNum = parseInt(disputeOfferCompensation || '0', 10);
    if (isNaN(refNum) || isNaN(compNum) || (refNum === 0 && compNum === 0)) {
      message.warning('Vui lòng nhập số tiền hoàn công hoặc bồi thường lớn hơn 0.');
      return;
    }
    if (disputeDetail.caps) {
      const maxRef = parseInt(disputeDetail.caps.refundCap, 10);
      const maxComp = parseInt(disputeDetail.caps.compensationCap, 10);
      if (refNum > maxRef) {
        message.warning(`Tiền hoàn công không được vượt trần ${maxRef.toLocaleString('vi-VN')} VNĐ.`);
        return;
      }
      if (compNum > maxComp) {
        message.warning(`Tiền bồi thường không được vượt trần ${maxComp.toLocaleString('vi-VN')} VNĐ.`);
        return;
      }
    }
    setDisputeOfferSubmitting(true);
    try {
      await providerApi.createDisputeOffer(order.id, {
        refundAmount: refNum.toString(),
        compensationAmount: compNum.toString(),
        message: disputeOfferMessage.trim() || undefined,
      });
      message.success('Đã gửi đề xuất thương lượng mới.');
      setDisputeOfferRefund('');
      setDisputeOfferCompensation('');
      setDisputeOfferMessage('');
      const data = await providerApi.getDispute(order.id);
      setDisputeDetail(data);
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Gửi đề xuất thương lượng thất bại.');
    } finally {
      setDisputeOfferSubmitting(false);
    }
  };

  const handleAcceptOffer = async (offerId: string) => {
    if (!order) return;
    setAcceptingOfferId(offerId);
    try {
      await providerApi.acceptDisputeOffer(order.id, offerId);
      message.success('Đã chấp nhận đề xuất thương lượng. Tranh chấp đã được giải quyết!');
      const data = await providerApi.getDispute(order.id);
      setDisputeDetail(data);
      loadData();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Chấp nhận đề xuất thất bại.');
    } finally {
      setAcceptingOfferId(null);
    }
  };

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  useEffect(() => {
    setMounted(true);
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  const loadData = async () => {
    if (!orderId) return;
    setLoading(true);
    setAddonsLoading(true);
    try {
      const [profData, orderData, addonList] = await Promise.all([
        providerApi.getProfile().catch(() => null),
        providerApi.getOrderDetail(orderId),
        providerApi.listAddons(orderId).catch(() => []),
      ]);
      setProfile(profData);
      setOrder(orderData);
      setAddons(addonList || []);
    } catch (err: any) {
      message.error('Không thể tải chi tiết đơn hàng.');
      router.push('/provider/orders');
    } finally {
      setLoading(false);
      setAddonsLoading(false);
    }
  };

  useEffect(() => {
    if (mounted && isAuthenticated && orderId) {
      loadData();
    }
  }, [mounted, isAuthenticated, orderId]);

  const handleRespondOrder = async (action: 'ACCEPT' | 'REJECT') => {
    if (!order) return;
    setActionLoading(action);
    try {
      await providerApi.respondNegotiation(order.id, action);
      message.success(action === 'ACCEPT' ? 'Đã chấp nhận đơn hàng!' : 'Đã từ chối đơn hàng.');
      await loadData();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Thao tác thất bại.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartVideoCall = async () => {
    if (!order) return;
    setVideoCallLoading(true);
    try {
      const session = await videoCallApi.createCall(order.id);
      const callId = session.call.id;
      const callType = session.stream?.callType || 'default';
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(`lancare_call_session_${callId}`, JSON.stringify(session));
      }
      router.push(`/calls/${callType}/${callId}`);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Không thể bắt đầu cuộc gọi.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setVideoCallLoading(false);
    }
  };

  // === Add-on methods ===
  const handleOpenAddonModal = () => {
    setAddonModalOpen(true);
    setAddonTitle('');
    setAddonReason('');
    setAddonPrice('');
    setAddonPlantId(undefined);
    setAddonPhotoUrls([]);
  };

  const handleUploadAddonPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (addonPhotoUrls.length >= 5) {
      message.warning('Tối đa 5 ảnh minh chứng.');
      return;
    }
    setAddonUploading(true);
    try {
      const uploaded = await providerApi.uploadDocument(file);
      setAddonPhotoUrls((prev) => [...prev, uploaded.url]);
      message.success('Đã tải ảnh minh chứng.');
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Tải ảnh thất bại.');
    } finally {
      setAddonUploading(false);
    }
  };

  const handleCreateAddon = async () => {
    if (!order) return;
    if (!addonTitle.trim()) {
      message.warning('Vui lòng nhập tiêu đề dịch vụ phát sinh.');
      return;
    }
    if (!addonReason.trim()) {
      message.warning('Vui lòng nhập lý do đề xuất.');
      return;
    }
    const numPrice = Number(addonPrice);
    if (!addonPrice || isNaN(numPrice) || numPrice < 1000 || numPrice > 50000000) {
      message.warning('Giá dịch vụ từ 1.000 đến 50.000.000 VNĐ.');
      return;
    }

    setAddonSubmitting(true);
    try {
      await providerApi.createAddon(order.id, {
        title: addonTitle.trim(),
        reason: addonReason.trim(),
        price: Math.round(numPrice).toString(),
        photoUrls: addonPhotoUrls,
        plantId: addonPlantId || undefined,
      });
      message.success('Đã gửi đề xuất dịch vụ thêm cho khách hàng.');
      setAddonModalOpen(false);
      const list = await providerApi.listAddons(order.id);
      setAddons(list);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Gửi đề xuất dịch vụ thêm thất bại.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setAddonSubmitting(false);
    }
  };

  const handleOpenCompleteModal = (addon: AddonItem) => {
    setSelectedAddonForComplete(addon);
    setCompletePhotoUrls([]);
    setCompleteNote('');
    setCompletePlantHealth('GOOD');
    setCompleteModalOpen(true);
  };

  const handleUploadCompletePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (completePhotoUrls.length >= 5) {
      message.warning('Tối đa 5 ảnh sau khi làm.');
      return;
    }
    setCompleteUploading(true);
    try {
      const uploaded = await providerApi.uploadDocument(file);
      setCompletePhotoUrls((prev) => [...prev, uploaded.url]);
      message.success('Đã tải ảnh hoàn tất.');
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Tải ảnh thất bại.');
    } finally {
      setCompleteUploading(false);
    }
  };

  const handleSubmitCompleteAddon = async () => {
    if (!order || !selectedAddonForComplete) return;

    const trimmedNote = completeNote.trim();
    if (!trimmedNote || trimmedNote.length < 10) {
      message.warning('Vui lòng nhập mô tả công việc đã làm (tối thiểu 10 ký tự).');
      return;
    }
    if (trimmedNote.length > 1000) {
      message.warning('Mô tả công việc không được vượt quá 1000 ký tự.');
      return;
    }

    if (completePhotoUrls.length === 0) {
      message.warning('Vui lòng tải lên ít nhất 1 ảnh nghiệm thu sau khi hoàn thành.');
      return;
    }

    const hasPlant = Boolean(selectedAddonForComplete.plant?.id);

    setCompleteSubmitting(true);
    try {
      await providerApi.completeAddon(order.id, selectedAddonForComplete.id, {
        photoUrls: completePhotoUrls,
        note: trimmedNote,
        plantHealthAfter: hasPlant ? completePlantHealth : undefined,
      });
      message.success('Đã báo hoàn tất dịch vụ thêm.');
      setCompleteModalOpen(false);
      setSelectedAddonForComplete(null);
      const list = await providerApi.listAddons(order.id);
      setAddons(list);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Báo hoàn tất thất bại.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setCompleteSubmitting(false);
    }
  };

  // === Contract methods ===
  const handleOpenContractModal = async () => {
    if (!order) return;
    setContractModalOpen(true);
    setContractLoading(true);
    try {
      const data = await providerApi.getContract(order.id);
      setContractData(data);
    } catch (err: any) {
      message.error('Không thể tải dữ liệu hợp đồng.');
      setContractModalOpen(false);
    } finally {
      setContractLoading(false);
    }
  };

  const handleSignContract = async () => {
    if (!order) return;
    if (!confirmSignChecked) {
      message.warning('Vui lòng xác nhận bạn đã đọc và đồng ý các điều khoản.');
      return;
    }
    setSigningContract(true);
    try {
      await providerApi.signAgreement(order.id);
      message.success('Đã ký hợp đồng điện tử thành công!');
      setContractModalOpen(false);
      await loadData();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Ký hợp đồng thất bại.');
    } finally {
      setSigningContract(false);
    }
  };

  // === Return handover methods ===
  const handleStartReturn = async () => {
    if (!order) return;
    setActionLoading('RETURN');
    try {
      await providerApi.startReturn(order.id);
      message.success('Đã bắt đầu phiên bàn giao trả cây!');
      await loadData();
      handleOpenReturnModal();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Không thể bắt đầu trả cây lúc này.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenReturnModal = () => {
    if (!order) return;
    const initialForms: Record<string, any> = {};
    const existingAssessments = order.returnHandover?.assessments || [];
    order.plants?.forEach((p: any) => {
      const prev = existingAssessments.find((a: any) => a.plantId === p.id);
      initialForms[p.id] = {
        leafCondition: prev?.leafCondition || '',
        rootCondition: prev?.rootCondition || '',
        hasPest: prev?.hasPest ?? false,
        note: prev?.note || '',
        photoUrl: prev?.photoUrl || '',
        saved: !!prev,
      };
    });
    setReturnPlantForms(initialForms);
    setReturnModalOpen(true);
  };

  const handleSaveReturnPlant = async (plantId: string) => {
    const form = returnPlantForms[plantId];
    if (!form) return;
    if (!form.leafCondition || !form.rootCondition) {
      message.warning('Vui lòng điền tình trạng lá và rễ trước khi lưu.');
      return;
    }
    setSavingReturnPlantId(plantId);
    try {
      await providerApi.assessReturnPlant(order.id, plantId, {
        checklist: {
          leaf: form.leafCondition,
          root: form.rootCondition,
          pest: form.hasPest,
        },
        note: form.note?.trim() || undefined,
        photos: form.photoUrl?.trim()
          ? [{ photoUrl: form.photoUrl.trim(), caption: 'Ảnh tình trạng cây lúc bàn giao trả' }]
          : [],
      });
      message.success('Đã lưu kết quả thẩm định chậu cây.');
      setReturnPlantForms((prev) => ({
        ...prev,
        [plantId]: { ...prev[plantId], saved: true },
      }));
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Không thể lưu thẩm định.');
    } finally {
      setSavingReturnPlantId(null);
    }
  };

  const handleCompleteReturn = async () => {
    if (!order) return;
    setCompletingReturn(true);
    try {
      await providerApi.completeReturn(order.id);
      message.success('Đã gửi thông tin bàn giao trả cây cho khách xác nhận!');
      setReturnModalOpen(false);
      await loadData();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Hoàn tất bàn giao thất bại.');
    } finally {
      setCompletingReturn(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <Tag color="default">Bản nháp</Tag>;
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
          <Tag color="purple" icon={<AuditOutlined />}>
            Đang nhận bàn giao cây
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
          <Tag color="processing" icon={<ClockCircleOutlined />}>
            Đang chăm sóc
          </Tag>
        );
      case 'RETURN_IN_PROGRESS':
        return (
          <Tag color="magenta" icon={<EnvironmentOutlined />}>
            Đang bàn giao trả cây
          </Tag>
        );
      case 'RETURN_AWAITING_CONFIRM':
        return (
          <Tag color="gold" icon={<ClockCircleOutlined />}>
            Chờ khách xác nhận trả cây
          </Tag>
        );
      case 'COMPLETED':
        return (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            Hoàn thành
          </Tag>
        );
      case 'DISPUTED':
        return (
          <Tag color="error" icon={<ExclamationCircleOutlined />}>
            Khiếu nại / Tranh chấp
          </Tag>
        );
      case 'CANCELLED':
        return (
          <Tag color="default" icon={<CloseCircleOutlined />}>
            Đã hủy
          </Tag>
        );
      default:
        return <Tag color="default">{status}</Tag>;
    }
  };

  if (!mounted || loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#FAF8FE]">
        <Spin size="large" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#FAF8FE] gap-4">
        <p className="text-[#6E6A8A]">Không tìm thấy thông tin đơn hàng.</p>
        <Button type="primary" onClick={() => router.push('/provider/orders')}>
          Quay lại danh sách
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#F6F4FC] font-sans antialiased text-[#1E1B2E] overflow-hidden">
      {/* Sidebar */}
      <ProviderSidebar profile={profile} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <ProviderHeader profile={profile} />

        <main className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto w-full pb-16">
          {/* Breadcrumb & Navigation */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => router.push('/provider/orders')}
                className="!h-9 !px-3.5 !rounded-xl !bg-white !border-[#ECE7FA] !text-[#4B4764] hover:!text-[#6027D2] hover:!border-[#6027D2] font-semibold text-xs flex items-center gap-1.5 shadow-xs"
              >
                Quay lại danh sách
              </Button>
              <div className="hidden sm:flex items-center gap-2 text-xs text-[#8B86A4]">
                <span>Đơn hàng chăm sóc</span>
                <span>/</span>
                <span className="font-semibold text-[#6027D2]">#{order.orderCode}</span>
              </div>
            </div>

            {/* Top Quick Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              {order.agreement && (
                <Button
                  icon={<FileProtectOutlined />}
                  onClick={handleOpenContractModal}
                  className="!h-9 !px-3.5 !rounded-xl !bg-white !border-[#ECE7FA] !text-[#1E1B2E] hover:!bg-[#F8F6FC] font-semibold text-xs shadow-xs"
                >
                  Xem Hợp đồng
                </Button>
              )}

              {CALL_ELIGIBLE_STATUSES.has(order.status) && (
                <Button
                  icon={<VideoCameraOutlined />}
                  loading={videoCallLoading}
                  onClick={handleStartVideoCall}
                  className="!h-9 !px-4 !rounded-xl !bg-emerald-50 !border-emerald-200 !text-emerald-700 hover:!bg-emerald-100 font-semibold text-xs"
                >
                  Gọi Video
                </Button>
              )}

              {order.status === 'PENDING_PROVIDER' && (
                <>
                  <Button
                    onClick={() => handleRespondOrder('REJECT')}
                    loading={actionLoading === 'REJECT'}
                    className="!h-9 !px-4 !rounded-xl !bg-[#F6F4FC] !border-none !text-[#4B4764] font-semibold text-xs"
                  >
                    Từ chối
                  </Button>
                  <Button
                    type="primary"
                    onClick={() => handleRespondOrder('ACCEPT')}
                    loading={actionLoading === 'ACCEPT'}
                    className="!h-9 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold text-xs"
                  >
                    Chấp nhận đơn
                  </Button>
                </>
              )}

              {(order.handoverStatus === 'AWAITING_DEPOSIT' || order.status === 'HANDOVER_AWAITING_CONFIRM') && (
                <Button
                  type="primary"
                  icon={<DollarOutlined />}
                  onClick={handleOpenDepositModal}
                  className="!h-9 !px-4 !rounded-xl !bg-[#D97706] hover:!bg-[#B45309] !text-white !border-none font-semibold text-xs shadow-xs"
                >
                  Nộp tiền bảo lãnh nhận cây
                </Button>
              )}

              {order.status === 'IN_CARE' && (
                <>
                  <Button
                    icon={<AppstoreAddOutlined />}
                    onClick={handleOpenAddonModal}
                    className="!h-9 !px-4 !rounded-xl !bg-[#F5F3FF] !border !border-[#DDD6FE] !text-[#6027D2] hover:!bg-[#EDE9FE] font-semibold text-xs"
                  >
                    + Đề xuất dịch vụ thêm
                  </Button>
                  <Button
                    icon={<FormOutlined />}
                    onClick={() => router.push(`/provider/reports?orderId=${order.id}`)}
                    className="!h-9 !px-4 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !text-white !border-none font-semibold text-xs shadow-xs"
                  >
                    Nộp báo cáo
                  </Button>
                  <Button
                    icon={<EnvironmentOutlined />}
                    loading={actionLoading === 'RETURN'}
                    onClick={handleStartReturn}
                    className="!h-9 !px-4 !rounded-xl !bg-[#F3EFFF] !border !border-[#DDD6FE] !text-[#6027D2] hover:!bg-[#E9D8FD] font-semibold text-xs"
                  >
                    Bắt đầu trả cây
                  </Button>
                </>
              )}

              {order.status === 'RETURN_IN_PROGRESS' && (
                <Button
                  type="primary"
                  icon={<AuditOutlined />}
                  onClick={handleOpenReturnModal}
                  className="!h-9 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none font-semibold text-xs text-white shadow-xs"
                >
                  Ghi nhận & Hoàn tất trả cây
                </Button>
              )}

              {order.status === 'DISPUTED' && (
                <Button
                  danger
                  type="primary"
                  icon={<ExclamationCircleOutlined />}
                  onClick={handleOpenDisputeModal}
                  className="!h-9 !px-4 !rounded-xl !bg-rose-600 hover:!bg-rose-700 font-semibold text-xs text-white shadow-sm"
                >
                  Hồ sơ tranh chấp
                </Button>
              )}
            </div>
          </div>

          {/* Alert banner if AWAITING_DEPOSIT */}
          {(order.handoverStatus === 'AWAITING_DEPOSIT' || (order.status === 'HANDOVER_AWAITING_CONFIRM' && !order.handoverStatus)) && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-3">
                <DollarOutlined className="text-amber-600 text-xl shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-amber-950">Khách hàng đã đồng ý biên bản nhận cây</h4>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Khách đã xác nhận bàn giao. Vui lòng nộp tiền bảo lãnh trách nhiệm (trong vòng 2 giờ) để kích hoạt chu kỳ chăm sóc.
                  </p>
                </div>
              </div>
              <Button
                type="primary"
                onClick={handleOpenDepositModal}
                className="!rounded-xl !bg-[#D97706] hover:!bg-[#B45309] text-xs font-semibold shrink-0"
              >
                Quét VietQR nộp tiền bảo lãnh →
              </Button>
            </div>
          )}

          {/* Alert banner if DISPUTED */}
          {order.status === 'DISPUTED' && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-3">
                <ExclamationCircleOutlined className="text-rose-600 text-xl shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-rose-950">Đơn hàng đang có tranh chấp khiếu nại</h4>
                  <p className="text-xs text-rose-800 mt-0.5">
                    Khách hàng đã mở khiếu nại sau khi nhận lại cây. Hai bên có 3 ngày tự thương lượng trước khi Admin phân xử.
                  </p>
                </div>
              </div>
              <Button
                type="primary"
                danger
                onClick={handleOpenDisputeModal}
                className="!rounded-xl !bg-rose-600 hover:!bg-rose-700 text-xs font-semibold shrink-0"
              >
                Mở phòng thương lượng →
              </Button>
            </div>
          )}

          {/* 1. Overview Banner Card */}
          <div className="bg-white rounded-3xl p-6 border border-[#ECE7FA] shadow-xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#F3EFFA]">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-xl font-black text-[#1E1B2E]">
                    Đơn hàng #{order.orderCode}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(order.orderCode);
                      message.success('Đã sao chép mã đơn: ' + order.orderCode);
                    }}
                    className="text-[#6027D2] hover:text-[#4E1BA8] text-sm p-1 rounded-md hover:bg-[#F3EFFF] transition inline-flex items-center gap-1"
                    title="Sao chép mã đơn"
                  >
                    <CopyOutlined />
                  </button>
                  {getStatusBadge(order.status)}
                </div>
                <p className="text-xs text-[#8B86A4] mt-1">
                  Khởi tạo lúc: {order.createdAt ? new Date(order.createdAt).toLocaleString('vi-VN') : '--'}
                </p>
              </div>

              <div className="text-left md:text-right">
                <span className="text-[11px] uppercase tracking-wider text-[#8B86A4] font-semibold block">
                  Tổng thanh toán gói
                </span>
                <p className="text-2xl font-black text-[#6027D2]">
                  {Number(order.finalTotal || order.provisionalTotal || 0).toLocaleString('vi-VN')} VNĐ
                </p>
              </div>
            </div>

            {/* Customer & Delivery Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="p-4 rounded-2xl bg-[#FAF8FE] border border-[#ECE7FA] space-y-2">
                <span className="text-[11px] font-bold text-[#6027D2] uppercase tracking-wider flex items-center gap-1.5">
                  <UserOutlined /> Thông tin khách hàng
                </span>
                <div className="flex items-center gap-3">
                  <Avatar
                    size={40}
                    className="bg-[#6027D2] text-white font-bold shrink-0"
                  >
                    {order.customer?.account?.fullName?.charAt(0) || 'K'}
                  </Avatar>
                  <div>
                    <h4 className="font-bold text-sm text-[#1E1B2E]">
                      {order.customer?.account?.fullName || 'Khách hàng'}
                    </h4>
                    <p className="text-xs text-[#6E6A8A]">
                      {order.customer?.account?.phone ? `📞 ${order.customer.account.phone}` : 'Chưa có SĐT'}
                      {order.customer?.account?.email ? ` | ✉️ ${order.customer.account.email}` : ''}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[#FAF8FE] border border-[#ECE7FA] space-y-2">
                <span className="text-[11px] font-bold text-[#6027D2] uppercase tracking-wider flex items-center gap-1.5">
                  <EnvironmentOutlined /> Địa chỉ tiếp nhận & Hẹn lấy cây
                </span>
                <p className="text-xs text-[#1E1B2E] font-medium leading-relaxed">
                  {order.pickupAddress || 'Chưa cung cấp'}
                </p>
                {order.scheduledPickupAt && (
                  <p className="text-[11.5px] text-[#6E6A8A] flex items-center gap-1">
                    <CalendarOutlined className="text-[#6027D2]" /> Hẹn tiếp nhận:{' '}
                    <strong className="text-[#1E1B2E]">
                      {new Date(order.scheduledPickupAt).toLocaleDateString('vi-VN')}
                    </strong>
                  </p>
                )}
                {order.customerNote && (
                  <p className="text-xs text-[#DD6B20] bg-[#FFFBEB] p-2 rounded-xl border border-[#FDE68A]">
                    💬 <strong>Ghi chú:</strong> "{order.customerNote}"
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* 2. Care Plan & Schedule */}
          <div className="bg-white rounded-3xl p-6 border border-[#ECE7FA] shadow-xs space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-base font-bold text-[#1E1B2E] flex items-center gap-2">
                <CalendarOutlined className="text-[#6027D2]" />
                Kế hoạch & Tiến trình chăm sóc
              </h3>
              {order.isReturnOverdue && (
                <Tag color="error" className="!rounded-md font-semibold text-xs">
                  ⚠️ Đã quá hạn chăm sóc
                </Tag>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#FAF8FE] p-4 rounded-2xl border border-[#ECE7FA] text-xs">
              <div>
                <span className="text-[#8B86A4] block text-[11px] font-medium">Gói dịch vụ</span>
                <span className="font-bold text-[#1E1B2E] text-sm mt-0.5 block">
                  {order.servicePackage?.name || 'Gói tiêu chuẩn'}
                </span>
              </div>
              <div>
                <span className="text-[#8B86A4] block text-[11px] font-medium">Thời hạn chăm sóc</span>
                <span className="font-bold text-[#1E1B2E] text-sm mt-0.5 block">
                  {order.durationDaysSnapshot || order.servicePackage?.durationDays || '--'} ngày
                </span>
              </div>
              <div>
                <span className="text-[#8B86A4] block text-[11px] font-medium">Ngày bắt đầu</span>
                <span className="font-semibold text-[#1E1B2E] text-sm mt-0.5 block">
                  {order.careStartedAt ? new Date(order.careStartedAt).toLocaleDateString('vi-VN') : 'Chưa tiếp nhận'}
                </span>
              </div>
              <div>
                <span className="text-[#8B86A4] block text-[11px] font-medium">Ngày dự kiến xong</span>
                <span className={`font-bold text-sm mt-0.5 block ${order.isReturnOverdue ? 'text-rose-600' : 'text-[#6027D2]'}`}>
                  {order.careDueAt ? new Date(order.careDueAt).toLocaleDateString('vi-VN') : '--'}
                </span>
              </div>
            </div>

            {/* Reports Tracking Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-[#F6F4FC] border border-[#DDD6FE] text-xs">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <FileTextOutlined className="text-[#6027D2]" />
                  <span className="font-bold text-[#1E1B2E]">
                    Báo cáo định kỳ ({order.reportFrequencySnapshot || order.servicePackage?.reportFrequencyDays || '--'} ngày/lần):
                  </span>
                  <span className="font-semibold text-[#6027D2]">
                    {order.careReportSchedule ? `${order.careReportSchedule.submittedCount || 0} / ${order.careReportSchedule.expectedCount || '--'} kỳ đã nộp` : 'Theo dõi qua app'}
                  </span>
                </div>
                {order.careReportSchedule?.nextDueAt && (
                  <p className="text-[11.5px] text-[#6E6A8A]">
                    Hạn nộp kỳ tiếp theo: <strong className={order.careReportSchedule.isNextOverdue ? 'text-red-600 font-bold' : 'text-[#1E1B2E]'}>
                      {new Date(order.careReportSchedule.nextDueAt).toLocaleDateString('vi-VN')}
                    </strong>
                    {order.careReportSchedule.isNextOverdue && ' (Đã đến hạn nộp)'}
                  </p>
                )}
              </div>

              {order.status === 'IN_CARE' && (
                <Button
                  size="small"
                  icon={<FormOutlined />}
                  onClick={() => router.push(`/provider/reports?orderId=${order.id}`)}
                  className="!h-8 !px-3.5 !rounded-xl !bg-[#6027D2] !text-white hover:!bg-[#4E1BA8] !border-none !font-semibold text-xs shrink-0 shadow-xs"
                >
                  Nộp báo cáo ngay
                </Button>
              )}
            </div>
          </div>

          {/* 3. Financial Breakdown Card */}
          <div className="bg-white rounded-3xl p-6 border border-[#ECE7FA] shadow-xs space-y-3">
            <h3 className="text-base font-bold text-[#1E1B2E] flex items-center gap-2">
              <DollarOutlined className="text-[#6027D2]" />
              Bảng kê chi phí gói & Thanh toán
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-4 rounded-2xl bg-[#FAF8FE] border border-[#ECE7FA] text-xs">
              <div>
                <span className="text-[#8B86A4] block text-[11px]">Phí gói chăm sóc:</span>
                <span className="font-bold text-sm text-[#1E1B2E] mt-0.5 block">
                  {Number(order.basePriceSnapshot || 0).toLocaleString('vi-VN')} VNĐ
                </span>
              </div>
              <div>
                <span className="text-[#8B86A4] block text-[11px]">Phí lấy cây & ship:</span>
                <span className="font-bold text-sm text-[#1E1B2E] mt-0.5 block">
                  {Number(order.pickupFeeSnapshot || 0).toLocaleString('vi-VN')} VNĐ
                </span>
              </div>
              <div>
                <span className="text-[#8B86A4] block text-[11px]">Giảm giá voucher:</span>
                <span className="font-bold text-sm text-emerald-600 mt-0.5 block">
                  {Number(order.discountAmountSnapshot || 0) > 0 ? `-${Number(order.discountAmountSnapshot).toLocaleString('vi-VN')} VNĐ` : '0 VNĐ'}
                </span>
              </div>
              <div>
                <span className="text-[#8B86A4] block text-[11px]">Tổng cộng gói:</span>
                <span className="font-extrabold text-base text-[#6027D2] mt-0.5 block">
                  {Number(order.finalTotal || order.provisionalTotal || 0).toLocaleString('vi-VN')} VNĐ
                </span>
              </div>
            </div>
          </div>

          {/* 4. Add-on Services Section (Dịch vụ phát sinh ngoài gói) */}
          <div className="bg-white rounded-3xl p-6 border border-[#ECE7FA] shadow-xs space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-[#F3EFFA]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#F5F3FF] flex items-center justify-center text-[#6027D2]">
                  <AppstoreAddOutlined className="text-base" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#1E1B2E]">
                    Dịch vụ phát sinh ngoài gói (Add-on)
                  </h3>
                  <p className="text-xs text-[#8B86A4]">
                    Tổng cộng: <strong>{addons.length}</strong> đề xuất dịch vụ
                  </p>
                </div>
              </div>

              {order.status === 'IN_CARE' && (
                <Button
                  type="primary"
                  icon={<AppstoreAddOutlined />}
                  onClick={handleOpenAddonModal}
                  className="!h-9 !px-4 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold text-xs shadow-xs"
                >
                  + Đề xuất dịch vụ thêm
                </Button>
              )}
            </div>

            {addonsLoading ? (
              <div className="py-8 text-center">
                <Spin size="small" />
                <p className="mt-2 text-xs text-[#8B86A4]">Đang tải danh sách dịch vụ thêm...</p>
              </div>
            ) : addons.length === 0 ? (
              <div className="p-6 rounded-2xl bg-[#FAF8FE] border border-dashed border-[#DDD6FE] text-center space-y-1.5">
                <p className="text-sm font-semibold text-[#4B4764]">
                  Đơn hàng này chưa có dịch vụ phát sinh ngoài gói nào.
                </p>
                {order.status === 'IN_CARE' && (
                  <p className="text-xs text-[#8B86A4] max-w-lg mx-auto">
                    Trong quá trình chăm sóc nếu phát hiện cây bị nấm bệnh, cần thay chậu, phun thuốc đặc trị... nhà vườn hãy bấm nút <strong>"+ Đề xuất dịch vụ thêm"</strong> để gửi báo giá cho khách duyệt.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {addons.map((ad) => {
                  const statusMap: Record<string, { color: string; label: string }> = {
                    PENDING: { color: 'gold', label: 'Chờ khách duyệt (48h)' },
                    ACCEPTED: { color: 'blue', label: 'Khách đã duyệt - Chờ thanh toán' },
                    PAID: { color: 'purple', label: 'Đã thanh toán - Cần thực hiện' },
                    DONE: { color: 'green', label: 'Đã hoàn thành' },
                    REJECTED: { color: 'red', label: 'Khách từ chối' },
                    EXPIRED: { color: 'default', label: 'Đã hết hạn' },
                  };
                  const st = statusMap[ad.status] || { color: 'default', label: ad.status };

                  return (
                    <div
                      key={ad.id}
                      className="p-5 rounded-2xl border border-[#ECE7FA] bg-[#FAF8FE] space-y-3 transition hover:shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-base text-[#1E1B2E]">{ad.title}</span>
                            <span className="font-mono text-xs text-[#6027D2] font-semibold bg-[#F3EFFF] px-2 py-0.5 rounded-md">
                              #{ad.addonCode}
                            </span>
                            <Tag color={st.color} className="!rounded-md text-xs font-medium">
                              {st.label}
                            </Tag>
                          </div>
                          <p className="text-xs text-[#8B86A4] mt-1">
                            Áp dụng cho:{' '}
                            <strong className="text-[#1E1B2E]">
                              {ad.plant?.name ? `Chậu: ${ad.plant.name}` : 'Toàn bộ đơn hàng'}
                            </strong>
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-[10px] uppercase text-[#8B86A4] font-semibold block">
                            Khách thanh toán
                          </span>
                          <span className="text-base font-black text-[#4E1BA8]">
                            {Number(ad.amountDue || ad.price).toLocaleString('vi-VN')} VNĐ
                          </span>
                          <span className="text-[11px] text-[#8B86A4] block">
                            (Vườn nhận: {Number(ad.price).toLocaleString('vi-VN')} đ + 6% phí)
                          </span>
                        </div>
                      </div>

                      {/* Reason & Photos */}
                      <div className="p-4 rounded-xl bg-white border border-[#ECE7FA] text-xs space-y-2.5">
                        <p className="text-[#4B4764] leading-relaxed">
                          <strong>Lý do phát sinh:</strong> {ad.reason}
                        </p>
                        {Array.isArray(ad.photoUrls) && ad.photoUrls.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold text-[#8B86A4] mb-1.5 flex items-center gap-1">
                              <PictureOutlined /> Ảnh hiện trạng lúc phát sinh:
                            </p>
                            <Image.PreviewGroup>
                              <div className="flex flex-wrap gap-2.5">
                                {ad.photoUrls.map((url, i) => (
                                  <Image
                                    key={i}
                                    src={url}
                                    alt={`Addon evidence ${i + 1}`}
                                    width={72}
                                    height={72}
                                    className="rounded-xl object-cover border border-[#ECE7FA]"
                                  />
                                ))}
                              </div>
                            </Image.PreviewGroup>
                          </div>
                        )}
                        {ad.customerNote && (
                          <div className="text-xs text-[#DD6B20] bg-[#FFFBEB] p-2.5 rounded-xl border border-[#FDE68A]">
                            💬 <strong>Phản hồi từ khách:</strong> "{ad.customerNote}"
                          </div>
                        )}
                      </div>

                      {/* Completed result banner if DONE */}
                      {ad.status === 'DONE' && (
                        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-sm">
                              <CheckCircleOutlined />
                              <span>Đã hoàn thành dịch vụ phát sinh</span>
                            </div>
                            {ad.donePlantHealth && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-emerald-800 font-semibold">Tình trạng cây sau khi làm:</span>
                                <Tag
                                  color={
                                    ad.donePlantHealth === 'GOOD'
                                      ? 'green'
                                      : ad.donePlantHealth === 'AVERAGE'
                                      ? 'gold'
                                      : 'red'
                                  }
                                  className="!m-0 !text-xs !font-medium"
                                >
                                  {ad.donePlantHealth === 'GOOD'
                                    ? '🌿 Tốt'
                                    : ad.donePlantHealth === 'AVERAGE'
                                    ? '🌱 Trung bình'
                                    : '🥀 Kém'}
                                </Tag>
                              </div>
                            )}
                          </div>
                          {ad.doneNote && (
                            <p className="text-emerald-900 leading-relaxed">
                              <strong>Ghi chú hoàn tất:</strong> {ad.doneNote}
                            </p>
                          )}
                          {Array.isArray(ad.donePhotoUrls) && ad.donePhotoUrls.length > 0 && (
                            <div>
                              <p className="text-[11px] font-semibold text-emerald-800 mb-1.5">
                                Ảnh nghiệm thu sau khi hoàn thành:
                              </p>
                              <Image.PreviewGroup>
                                <div className="flex flex-wrap gap-2.5">
                                  {ad.donePhotoUrls.map((url: string, i: number) => (
                                    <Image
                                      key={i}
                                      src={url}
                                      alt={`Addon completion ${i + 1}`}
                                      width={72}
                                      height={72}
                                      className="rounded-xl object-cover border border-emerald-300"
                                    />
                                  ))}
                                </div>
                              </Image.PreviewGroup>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Actions for Paid addon */}
                      {(ad.status === 'PAID' || ad.status === 'ACCEPTED') && (
                        <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                          <span className="text-xs text-[#6E6A8A]">
                            {ad.status === 'PAID'
                              ? 'Khách đã thanh toán. Nhà vườn hãy tiến hành xử lý và nộp ảnh nghiệm thu.'
                              : 'Khách đã duyệt đề xuất.'}
                          </span>
                          <Button
                            type="primary"
                            icon={<CheckCircleOutlined />}
                            onClick={() => handleOpenCompleteModal(ad)}
                            className="!h-9 !px-4 !rounded-xl !bg-[#059669] hover:!bg-[#047857] !border-none !font-semibold text-xs text-white shadow-xs"
                          >
                            Báo đã hoàn tất
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 5. Plants List with Assessment */}
          <div className="bg-white rounded-3xl p-6 border border-[#ECE7FA] shadow-xs space-y-4">
            <h3 className="text-base font-bold text-[#1E1B2E] flex items-center gap-2">
              <ToolOutlined className="text-[#6027D2]" />
              Danh sách chậu lan gửi chăm sóc ({order.plants?.length || 0})
            </h3>

            <div className="space-y-4">
              {order.plants?.map((plant: any, idx: number) => {
                const assessment = order.handover?.assessments?.find((a: any) => a.plantId === plant.id);

                return (
                  <div key={plant.id || idx} className="p-5 rounded-2xl bg-[#FAF8FE] border border-[#ECE7FA] space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h4 className="font-bold text-base text-[#1E1B2E]">
                        Chậu #{idx + 1}: {plant.name}
                      </h4>
                      {plant.isValueDeclared && plant.declaredValue && (
                        <Tag color="gold" className="!rounded-md font-semibold text-xs">
                          Giá trị khai báo: {Number(plant.declaredValue).toLocaleString('vi-VN')} VNĐ
                        </Tag>
                      )}
                    </div>

                    {plant.speciesName && (
                      <p className="text-xs text-[#6E6A8A]">
                        Giống lan / Tình trạng ban đầu: <span className="text-[#1E1B2E] font-medium">{plant.speciesName}</span>
                      </p>
                    )}

                    {/* Handover Assessment */}
                    {assessment && (
                      <div className="p-3.5 rounded-xl bg-white border border-[#ECE7FA] text-xs space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[#6027D2]">Thẩm định lúc nhận cây:</span>
                          <Tag color={assessment.isHighRisk ? 'orange' : 'green'} className="!rounded-md text-[11px]">
                            {assessment.decision === 'ACCEPT_HIGH_RISK' ? 'Nhận rủi ro cao' : 'Tiếp nhận an toàn'}
                          </Tag>
                        </div>
                        <p className="text-[#4B4764]">
                          Tình trạng lá: <strong>{assessment.leafCondition || '--'}</strong> | Tình trạng rễ: <strong>{assessment.rootCondition || '--'}</strong>
                          {assessment.hasPest ? ' | ⚠️ Phát hiện sâu bệnh' : ''}
                        </p>
                        {assessment.note && <p className="text-[#6E6A8A] italic">Ghi chú thẩm định: {assessment.note}</p>}
                      </div>
                    )}

                    {/* Plant Photos */}
                    {(() => {
                      const plantPhotos = plant.initialPhotos || plant.photos || [];
                      return plantPhotos.length > 0 ? (
                        <div>
                          <p className="text-[11px] font-semibold text-[#8B86A4] mb-1.5 flex items-center gap-1">
                            <PictureOutlined /> Ảnh chụp ban đầu từ khách hàng:
                          </p>
                          <Image.PreviewGroup>
                            <div className="flex flex-wrap gap-2.5">
                              {plantPhotos.map((photo: any) => (
                                <Image
                                  key={photo.id}
                                  src={photo.photoUrl}
                                  alt={photo.caption || plant.name}
                                  width={80}
                                  height={80}
                                  className="rounded-xl object-cover border border-[#ECE7FA]"
                                />
                              ))}
                            </div>
                          </Image.PreviewGroup>
                        </div>
                      ) : (
                        <p className="text-xs text-[#A0AEC0] italic">Chưa có ảnh chụp gửi kèm.</p>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </div>

      {/* Modal: Create Addon Proposal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-[#1E1B2E]">
            <AppstoreAddOutlined className="text-[#6027D2]" />
            <span>Đề xuất dịch vụ thêm ngoài gói</span>
          </div>
        }
        open={addonModalOpen}
        onCancel={() => {
          if (!addonSubmitting) setAddonModalOpen(false);
        }}
        footer={null}
        width={720}
        centered
      >
        <div className="space-y-4 pt-3">
          <p className="text-xs text-[#6E6A8A]">
            Gửi đề xuất bổ sung dịch vụ (phun thuốc trị nấm, thay giá thể, phân bón vi lượng...). Khách hàng sẽ nhận thông báo trên App để duyệt và thanh toán.
          </p>

          <div>
            <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
              Chậu lan áp dụng
            </label>
            <Select
              className="w-full"
              placeholder="Toàn bộ đơn hàng (hoặc chọn chậu cụ thể)"
              value={addonPlantId}
              onChange={(val) => setAddonPlantId(val)}
              allowClear
              options={[
                { value: '', label: 'Toàn bộ đơn hàng' },
                ...(order?.plants || []).map((p: any) => ({
                  value: p.id,
                  label: `Chậu: ${p.name || 'Không tên'} (${p.speciesName || 'Lan'})`,
                })),
              ]}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
              Tiêu đề dịch vụ phát sinh <span className="text-rose-500">*</span>
            </label>
            <Input
              placeholder="VD: Thay giá thể chống úng rễ, Phun nano bạc trị đốm lá..."
              value={addonTitle}
              onChange={(e) => setAddonTitle(e.target.value)}
              className="!rounded-xl"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
              Lý do đề xuất & Hiện trạng phát hiện <span className="text-rose-500">*</span>
            </label>
            <Input.TextArea
              rows={3}
              placeholder="Mô tả chi tiết nguyên nhân phát sinh dịch vụ, tình trạng của cây hiện tại..."
              value={addonReason}
              onChange={(e) => setAddonReason(e.target.value)}
              className="!rounded-xl"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
                Giá dịch vụ nhà vườn nhận (VNĐ) <span className="text-rose-500">*</span>
              </label>
              <Input
                type="number"
                placeholder="VD: 150000"
                value={addonPrice}
                onChange={(e) => setAddonPrice(e.target.value)}
                className="!rounded-xl"
              />
              <span className="text-[11px] text-[#8B86A4] mt-0.5 block">
                Khách sẽ thanh toán thêm 6% phí nền tảng
              </span>
            </div>

            <div className="bg-[#FAF8FE] p-3 rounded-xl border border-[#ECE7FA] text-xs">
              <span className="text-[#8B86A4] block text-[11px]">Dự tính khách thanh toán:</span>
              <p className="text-base font-bold text-[#6027D2] mt-1">
                {addonPrice && !isNaN(Number(addonPrice))
                  ? `${Math.round(Number(addonPrice) * 1.06).toLocaleString('vi-VN')} VNĐ`
                  : '-- VNĐ'}
              </p>
            </div>
          </div>

          {/* Photo Upload */}
          <div>
            <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
              Ảnh minh chứng hiện trạng (tối đa 5 ảnh)
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {addonPhotoUrls.map((url, idx) => (
                <div key={idx} className="relative group">
                  <Image
                    src={url}
                    alt={`Photo ${idx}`}
                    width={70}
                    height={70}
                    className="rounded-lg object-cover border border-[#ECE7FA]"
                  />
                  <button
                    type="button"
                    onClick={() => setAddonPhotoUrls((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-sm"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {addonPhotoUrls.length < 5 && (
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-dashed border-[#DDD6FE] text-[#6027D2] bg-[#FAF8FE] hover:bg-[#F3EFFF] cursor-pointer text-xs font-semibold">
                <UploadOutlined />
                <span>{addonUploading ? 'Đang tải ảnh...' : 'Tải thêm ảnh'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUploadAddonPhoto}
                  disabled={addonUploading}
                />
              </label>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[#ECE7FA]">
            <Button onClick={() => setAddonModalOpen(false)} disabled={addonSubmitting}>
              Hủy
            </Button>
            <Button
              type="primary"
              loading={addonSubmitting}
              onClick={handleCreateAddon}
              className="!rounded-xl !bg-[#6027D2]"
            >
              Gửi đề xuất
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Complete Addon */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-[#1E1B2E]">
            <CheckCircleOutlined className="text-emerald-600" />
            <span>Nghiệm thu hoàn tất: {selectedAddonForComplete?.title}</span>
          </div>
        }
        open={completeModalOpen}
        onCancel={() => {
          if (!completeSubmitting) setCompleteModalOpen(false);
        }}
        footer={null}
        width={680}
        centered
      >
        <div className="space-y-4 pt-3">
          <p className="text-xs text-[#6E6A8A]">
            Tải lên ít nhất 1 ảnh chụp kết quả sau khi đã hoàn thành dịch vụ thêm để khách hàng nghiệm thu.
          </p>

          <div>
            <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
              Mô tả công việc đã làm <span className="text-rose-500">* (tối thiểu 10 ký tự)</span>
            </label>
            <Input.TextArea
              rows={3}
              maxLength={1000}
              showCount
              placeholder="VD: Đã thay xong giá thể thông thoáng, cắt tỉa và khử trùng rễ úng, bổ sung phân kích rễ..."
              value={completeNote}
              onChange={(e) => setCompleteNote(e.target.value)}
              className="!rounded-xl"
            />
          </div>

          {selectedAddonForComplete?.plant && (
            <div className="p-3 rounded-xl bg-purple-50/70 border border-purple-100 space-y-2">
              <label className="block text-xs font-semibold text-[#1E1B2E]">
                Tình trạng cây sau khi hoàn thành <span className="text-rose-500">*</span>
                <span className="text-purple-700 font-normal ml-1">
                  ({selectedAddonForComplete.plant.name || 'Cây trong đề xuất'})
                </span>
              </label>
              <Radio.Group
                value={completePlantHealth}
                onChange={(e) => setCompletePlantHealth(e.target.value)}
                className="w-full flex gap-3"
              >
                <Radio.Button value="GOOD" className="!rounded-lg !text-xs !font-medium">
                  🌿 Tốt
                </Radio.Button>
                <Radio.Button value="AVERAGE" className="!rounded-lg !text-xs !font-medium">
                  🌱 Trung bình
                </Radio.Button>
                <Radio.Button value="POOR" className="!rounded-lg !text-xs !font-medium">
                  🥀 Kém
                </Radio.Button>
              </Radio.Group>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
              Ảnh nghiệm thu kết quả <span className="text-rose-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {completePhotoUrls.map((url, idx) => (
                <div key={idx} className="relative group">
                  <Image
                    src={url}
                    alt={`Complete photo ${idx}`}
                    width={70}
                    height={70}
                    className="rounded-lg object-cover border border-[#ECE7FA]"
                  />
                  <button
                    type="button"
                    onClick={() => setCompletePhotoUrls((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-sm"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {completePhotoUrls.length < 5 && (
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-dashed border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 cursor-pointer text-xs font-semibold">
                <UploadOutlined />
                <span>{completeUploading ? 'Đang tải ảnh...' : 'Tải ảnh nghiệm thu'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUploadCompletePhoto}
                  disabled={completeUploading}
                />
              </label>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[#ECE7FA]">
            <Button onClick={() => setCompleteModalOpen(false)} disabled={completeSubmitting}>
              Đóng
            </Button>
            <Button
              type="primary"
              loading={completeSubmitting}
              onClick={handleSubmitCompleteAddon}
              className="!rounded-xl !bg-[#059669]"
            >
              Xác nhận hoàn tất
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: View Contract */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-[#1E1B2E]">
            <FileProtectOutlined className="text-[#6027D2]" />
            <span>Hợp đồng dịch vụ chăm sóc {contractData?.agreementNo ? `- ${contractData.agreementNo}` : ''}</span>
          </div>
        }
        open={contractModalOpen}
        onCancel={() => setContractModalOpen(false)}
        width={840}
        centered
        footer={
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-[#8B86A4]">
              Trạng thái: <strong>{contractData?.status || 'Chưa xác định'}</strong>
            </span>
            <Button onClick={() => setContractModalOpen(false)} className="!rounded-xl">
              Đóng
            </Button>
          </div>
        }
      >
        {contractLoading ? (
          <div className="py-12 text-center">
            <Spin size="large" />
            <p className="mt-3 text-xs text-[#8B86A4]">Đang tải hợp đồng...</p>
          </div>
        ) : contractData ? (
          (() => {
            const customerParty =
              contractData.parties?.customer ||
              contractData.customerParty ||
              contractData.termsSnapshot?.parties?.customer ||
              order?.customer?.account ||
              {};
            const providerParty =
              contractData.parties?.provider ||
              contractData.providerParty ||
              contractData.termsSnapshot?.parties?.provider ||
              profile ||
              {};

            const isSignedStatus =
              contractData?.status === 'SIGNED' ||
              [
                'AWAITING_PAYMENT',
                'PAID',
                'HANDOVER_IN_PROGRESS',
                'HANDOVER_AWAITING_CONFIRM',
                'IN_CARE',
                'RETURN_IN_PROGRESS',
                'RETURN_AWAITING_CONFIRM',
                'COMPLETED',
                'DISPUTED',
              ].includes(order?.status);

            const customerSig = contractData.signatures?.find(
              (s: any) => s.role === 'CUSTOMER' || s.signerRole === 'CUSTOMER'
            );
            const isCustomerSigned =
              Boolean(customerSig?.signedAt || customerSig?.signatureHash) || isSignedStatus;

            const providerSig = contractData.signatures?.find(
              (s: any) => s.role === 'PROVIDER' || s.signerRole === 'PROVIDER'
            );
            const isProviderSigned =
              Boolean(providerSig?.signedAt || providerSig?.signatureHash) || isSignedStatus;

            return (
              <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1 text-xs text-[#4B4764] leading-relaxed">
                <div className="bg-[#FAF8FE] p-4 rounded-2xl border border-[#ECE7FA]">
                  <h4 className="font-bold text-sm text-[#1E1B2E] text-center uppercase tracking-wider mb-2">
                    HỢP ĐỒNG DỊCH VỤ CHĂM SÓC HOA LAN ĐIỆN TỬ
                  </h4>
                  <p className="text-center text-xs text-[#6E6A8A]">
                    Số HĐ: <strong className="text-[#6027D2] font-mono">{contractData.agreementNo}</strong>
                  </p>
                </div>

                {/* Parties */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl bg-white border border-[#ECE7FA] space-y-1">
                    <span className="font-bold text-[#6027D2] block">BÊN GỬI CHĂM SÓC (BÊN A)</span>
                    <p>Khách hàng: <strong>{customerParty.fullName || 'Khách hàng'}</strong></p>
                    <p>SĐT: {customerParty.phone || order?.customer?.account?.phone || '--'}</p>
                    <p>CCCD: {customerParty.identityNumber || customerParty.cccdNumber || '--'}</p>
                    {customerParty.address && <p>Địa chỉ: {customerParty.address}</p>}
                  </div>

                  <div className="p-3.5 rounded-xl bg-white border border-[#ECE7FA] space-y-1">
                    <span className="font-bold text-[#6027D2] block">BÊN NHẬN CHĂM SÓC (BÊN B)</span>
                    <p>Nhà vườn: <strong>{providerParty.fullName || providerParty.displayName || profile?.displayName || 'Nhà vườn'}</strong></p>
                    <p>SĐT: {providerParty.phone || profile?.phone || '--'}</p>
                    <p>Địa chỉ vườn: {providerParty.address || profile?.address || '--'}</p>
                  </div>
                </div>

                {/* Clauses */}
                <div className="p-4 rounded-xl bg-white border border-[#ECE7FA] space-y-3">
                  <h5 className="font-bold text-xs uppercase tracking-wider text-[#1E1B2E]">Các điều khoản chính:</h5>
                  <div className="space-y-2 text-[#4B4764]">
                    <p><strong>1. Trách nhiệm chăm sóc:</strong> Bên B cam kết thực hiện đúng quy trình chuyên môn, bảo quản chậu lan của Bên A trong điều kiện tiêu chuẩn.</p>
                    <p><strong>2. Báo cáo định kỳ:</strong> Bên B có nghĩa vụ chụp ảnh và gửi báo cáo tiến độ chăm sóc đúng tần suất đã thỏa thuận trên hệ thống LanCare.</p>
                    <p><strong>3. Dịch vụ phát sinh:</strong> Bất kỳ dịch vụ nào ngoài gói phải được Bên B đề xuất và Bên A phê duyệt thanh toán thông qua hệ thống trước khi thực hiện.</p>
                    <p><strong>4. Cam kết bồi thường 120%:</strong> Trong trường hợp chậu lan bị chết, mất hoặc hư hại do lỗi bên chăm sóc, Bên B chịu trách nhiệm bồi thường lên tới 120% giá trị đã khai báo.</p>
                  </div>
                </div>

                {/* Signatures */}
                <div className="p-4 rounded-xl bg-white border border-[#ECE7FA]">
                  <h5 className="font-bold text-xs uppercase tracking-wider text-[#1E1B2E] mb-3">Chữ ký điện tử:</h5>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-center">
                    <div
                      className={`p-4 rounded-xl border-2 transition-all ${
                        isCustomerSigned
                          ? 'bg-[#F0FDF4] border-[#16A34A]/40'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <span className="text-[11px] font-bold text-[#6027D2] uppercase tracking-wider block">
                        ĐẠI DIỆN BÊN A (KHÁCH HÀNG)
                      </span>
                      <p className="font-bold text-sm text-[#1E1B2E] mt-2 mb-2">
                        {customerSig?.fullName || customerParty.fullName || 'Khách hàng'}
                      </p>
                      {isCustomerSigned ? (
                        <div className="space-y-1">
                          <Tag color="green" className="font-extrabold px-3 py-1 text-xs uppercase tracking-wide">
                            ✓ ĐÃ KÝ ĐIỆN TỬ
                          </Tag>
                          <p className="text-[11px] text-gray-500 mt-1">
                            {customerSig?.signedAt
                              ? `Ký lúc: ${new Date(customerSig.signedAt).toLocaleString('vi-VN')}`
                              : 'Đã xác nhận ký trực tuyến'}
                          </p>
                        </div>
                      ) : (
                        <Tag color="default" className="text-xs italic py-0.5">
                          Đang chờ Bên A ký điện tử
                        </Tag>
                      )}
                    </div>

                    <div
                      className={`p-4 rounded-xl border-2 transition-all ${
                        isProviderSigned
                          ? 'bg-[#F0FDF4] border-[#16A34A]/40'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <span className="text-[11px] font-bold text-[#16A34A] uppercase tracking-wider block">
                        ĐẠI DIỆN BÊN B (NHÀ VƯỜN)
                      </span>
                      <p className="font-bold text-sm text-[#1E1B2E] mt-2 mb-2">
                        {providerSig?.fullName || providerParty.fullName || profile?.displayName || 'Nhà vườn'}
                      </p>
                      {isProviderSigned ? (
                        <div className="space-y-1">
                          <Tag color="green" className="font-extrabold px-3 py-1 text-xs uppercase tracking-wide">
                            ✓ ĐÃ KÝ ĐIỆN TỬ
                          </Tag>
                          <p className="text-[11px] text-gray-500 mt-1">
                            {providerSig?.signedAt
                              ? `Ký lúc: ${new Date(providerSig.signedAt).toLocaleString('vi-VN')}`
                              : 'Đã xác nhận ký điện tử'}
                          </p>
                        </div>
                      ) : (
                        <Tag color="warning" className="text-xs font-medium py-0.5">
                          Chưa ký điện tử
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

      {/* Modal: Return Handover */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-[#1E1B2E]">
            <AuditOutlined className="text-[#6027D2]" />
            <span>Thẩm định hiện trạng & Bàn giao trả cây</span>
          </div>
        }
        open={returnModalOpen}
        onCancel={() => setReturnModalOpen(false)}
        width={800}
        centered
        footer={
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-[#8B86A4]">
              * Bấm <strong>"Lưu thẩm định chậu này"</strong> cho từng cây trước khi hoàn tất.
            </span>
            <div className="flex items-center gap-2">
              <Button onClick={() => setReturnModalOpen(false)}>Đóng</Button>
              <Button
                type="primary"
                loading={completingReturn}
                onClick={handleCompleteReturn}
                className="!rounded-xl !bg-[#6027D2]"
              >
                Hoàn tất & Gửi khách xác nhận
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1 pt-2">
          {order.plants?.map((plant: any, idx: number) => {
            const form = returnPlantForms[plant.id] || {
              leafCondition: '',
              rootCondition: '',
              hasPest: false,
              note: '',
              photoUrl: '',
              saved: false,
            };

            return (
              <div key={plant.id} className="p-4 rounded-2xl bg-[#FAF8FE] border border-[#ECE7FA] space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="font-bold text-sm text-[#1E1B2E]">
                    Chậu #{idx + 1}: {plant.name}
                  </h5>
                  {form.saved && (
                    <Tag color="success" icon={<CheckCircleOutlined />}>
                      Đã lưu thẩm định
                    </Tag>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
                      Tình trạng lá <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      placeholder="VD: Lá xanh tốt, không bị vàng..."
                      value={form.leafCondition}
                      onChange={(e) =>
                        setReturnPlantForms((prev) => ({
                          ...prev,
                          [plant.id]: { ...prev[plant.id], leafCondition: e.target.value, saved: false },
                        }))
                      }
                      className="!rounded-xl"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
                      Tình trạng rễ <span className="text-rose-500">*</span>
                    </label>
                    <Input
                      placeholder="VD: Rễ phát triển mạnh, đầu rễ xanh..."
                      value={form.rootCondition}
                      onChange={(e) =>
                        setReturnPlantForms((prev) => ({
                          ...prev,
                          [plant.id]: { ...prev[plant.id], rootCondition: e.target.value, saved: false },
                        }))
                      }
                      className="!rounded-xl"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
                    Ghi chú thêm
                  </label>
                  <Input
                    placeholder="Ghi chú thêm về chậu lan khi bàn giao lại cho khách..."
                    value={form.note}
                    onChange={(e) =>
                      setReturnPlantForms((prev) => ({
                        ...prev,
                        [plant.id]: { ...prev[plant.id], note: e.target.value, saved: false },
                      }))
                    }
                    className="!rounded-xl"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <Checkbox
                    checked={form.hasPest}
                    onChange={(e) =>
                      setReturnPlantForms((prev) => ({
                        ...prev,
                        [plant.id]: { ...prev[plant.id], hasPest: e.target.checked, saved: false },
                      }))
                    }
                  >
                    <span className="text-xs text-rose-600 font-medium">Có dấu hiệu sâu bệnh</span>
                  </Checkbox>

                  <Button
                    size="small"
                    type="primary"
                    loading={savingReturnPlantId === plant.id}
                    onClick={() => handleSaveReturnPlant(plant.id)}
                    className="!rounded-xl !bg-[#6027D2] text-xs font-semibold"
                  >
                    Lưu thẩm định chậu này
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* Dispute Room Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <ExclamationCircleOutlined className="text-rose-600 text-lg" />
            <span className="font-bold text-[#1E1B2E]">Hồ sơ tranh chấp — Đơn #{order?.orderCode || '---'}</span>
          </div>
        }
        open={disputeModalOpen}
        onCancel={() => setDisputeModalOpen(false)}
        footer={null}
        width={720}
        centered
      >
        <div className="space-y-4 pt-2 max-h-[75vh] overflow-y-auto pr-1">
          {disputeLoading ? (
            <div className="py-12 text-center">
              <Spin />
              <p className="text-xs text-[#8B86A4] mt-2">Đang tải hồ sơ tranh chấp...</p>
            </div>
          ) : !disputeDetail ? (
            <div className="p-6 rounded-2xl bg-gray-50 border border-gray-100 text-center text-xs text-gray-500">
              Chưa có dữ liệu tranh chấp cho đơn hàng này.
            </div>
          ) : (
            <>
              {/* Status Banner */}
              <div
                className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                  disputeDetail.status === 'NEGOTIATING'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : disputeDetail.status === 'ADMIN_REVIEW'
                    ? 'bg-purple-50 border-purple-200 text-purple-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                <div className="flex items-center justify-between font-bold">
                  <span>
                    Trạng thái:{' '}
                    {disputeDetail.status === 'NEGOTIATING'
                      ? '⚡ Đang trong thời gian 3 ngày tự thương lượng'
                      : disputeDetail.status === 'ADMIN_REVIEW'
                      ? '⚖️ Đang chờ Ban quản trị (Admin) phân xử'
                      : '✓ Tranh chấp đã được giải quyết'}
                  </span>
                  <Tag
                    color={
                      disputeDetail.status === 'NEGOTIATING'
                        ? 'orange'
                        : disputeDetail.status === 'ADMIN_REVIEW'
                        ? 'purple'
                        : 'green'
                    }
                  >
                    {disputeDetail.status}
                  </Tag>
                </div>
                {disputeDetail.status === 'NEGOTIATING' && disputeDetail.negotiationDueAt && (
                  <p className="text-[11px] text-amber-800">
                    Hạn tự thương lượng: <strong>{new Date(disputeDetail.negotiationDueAt).toLocaleString('vi-VN')}</strong>.
                    Nếu quá hạn không đạt thoả thuận, hệ thống sẽ tự chuyển hồ sơ lên Admin phân xử.
                  </p>
                )}
                {disputeDetail.status === 'ADMIN_REVIEW' && (
                  <p className="text-[11px] text-purple-800">
                    Hồ sơ đã chuyển lên Ban quản trị xem xét. Dự kiến kết quả:{' '}
                    <strong>{disputeDetail.adminDueAt ? new Date(disputeDetail.adminDueAt).toLocaleString('vi-VN') : 'Sớm nhất'}</strong>.
                  </p>
                )}
                {disputeDetail.status === 'RESOLVED' && (
                  <div className="space-y-1 text-[11px] text-emerald-800">
                    <p>
                      Kết quả: <strong>{disputeDetail.outcome === 'OFFER_ACCEPTED' ? 'Hai bên đã thống nhất đề xuất' : disputeDetail.outcome === 'WITHDRAWN' ? 'Khách hàng đã rút khiếu nại' : 'Admin đã ra quyết định'}</strong>
                      {disputeDetail.customerReceives && (
                        <span> · Khách nhận bồi hoàn: <strong>{Number(disputeDetail.customerReceives).toLocaleString('vi-VN')} VNĐ</strong></span>
                      )}
                    </p>
                    {disputeDetail.declaredForfeitAmount && Number(disputeDetail.declaredForfeitAmount) > 0 && (
                      <p className="text-amber-800 font-medium">
                        🛡️ Nhà vườn được nhận tiền bảo đảm khai giá (do khách khiếu nại sai): <strong className="text-amber-900">+{Number(disputeDetail.declaredForfeitAmount).toLocaleString('vi-VN')} VNĐ</strong>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Dispute Reason & Details */}
              <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-2 text-xs">
                <div>
                  <span className="text-gray-500 font-medium">Lý do khiếu nại từ khách hàng:</span>
                  <p className="font-bold text-[#1E1B2E] text-sm mt-0.5">{disputeDetail.reason}</p>
                </div>
                {disputeDetail.description && (
                  <div>
                    <span className="text-gray-500 font-medium">Chi tiết phản ánh:</span>
                    <p className="text-[#333] whitespace-pre-wrap mt-0.5 bg-white p-2.5 rounded-lg border border-gray-100">
                      {disputeDetail.description}
                    </p>
                  </div>
                )}
                {disputeDetail.plants && disputeDetail.plants.length > 0 && (
                  <div>
                    <span className="text-gray-500 font-medium">Cây bị khiếu nại:</span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {disputeDetail.plants.map((p, idx) => (
                        <div key={idx} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs flex items-center gap-2">
                          <span className="font-semibold text-rose-700">🌿 {p.name || `Cây #${idx + 1}`}</span>
                          {p.compensationCap && (
                            <span className="text-[11px] text-gray-500">
                              (Trần đền: {Number(p.compensationCap).toLocaleString('vi-VN')} đ)
                            </span>
                          )}
                          {p.verdict && (
                            <Tag color={p.verdict === 'UPHELD' ? 'red' : 'default'} className="!m-0 !text-[10px]">
                              {p.verdict === 'UPHELD' ? 'Chấp nhận lỗi' : 'Bác bỏ'}
                            </Tag>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Caps Info */}
              {disputeDetail.caps && (
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                    <span className="text-blue-700 font-medium block">Trần hoàn tiền công tối đa:</span>
                    <strong className="text-base font-bold text-blue-900 mt-0.5 block">
                      {Number(disputeDetail.caps.refundCap).toLocaleString('vi-VN')} VNĐ
                    </strong>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                    <span className="text-rose-700 font-medium block">Trần đền bù giá trị cây tối đa:</span>
                    <strong className="text-base font-bold text-rose-900 mt-0.5 block">
                      {Number(disputeDetail.caps.compensationCap).toLocaleString('vi-VN')} VNĐ
                    </strong>
                  </div>
                </div>
              )}

              {/* Evidence Section */}
              <div className="space-y-3">
                <h5 className="text-xs font-bold uppercase tracking-wider text-[#6E6A8A]">
                  Bằng chứng & Hình ảnh hai bên
                </h5>

                {/* Customer Evidence */}
                <div>
                  <span className="text-xs font-semibold text-rose-700 block mb-1.5">
                    Ảnh bằng chứng từ Khách hàng ({disputeDetail.evidence?.customer?.length || 0}):
                  </span>
                  {disputeDetail.evidence?.customer?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {disputeDetail.evidence.customer.map((ev, i) => (
                        <div key={i} className="space-y-1">
                          <Image
                            src={ev.photoUrl}
                            alt="Ảnh khách"
                            width={72}
                            height={72}
                            className="rounded-lg object-cover border border-rose-200"
                          />
                          {ev.caption && <p className="text-[10px] text-gray-500 max-w-[72px] truncate">{ev.caption}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400 italic">Chưa có ảnh từ khách.</p>
                  )}
                </div>

                {/* Handover objection if any */}
                {disputeDetail.handoverObjection && (
                  <div className="p-2.5 rounded-lg bg-orange-50 border border-orange-200 text-xs">
                    <span className="font-semibold text-orange-900 block">Ý kiến khách ghi lúc nhận cây:</span>
                    {disputeDetail.handoverObjection.note && (
                      <p className="text-orange-800 italic mt-0.5">&ldquo;{disputeDetail.handoverObjection.note}&rdquo;</p>
                    )}
                    {disputeDetail.handoverObjection.photos?.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {disputeDetail.handoverObjection.photos.map((ph, idx) => (
                          <Image key={idx} src={ph.photoUrl} width={60} height={60} className="rounded-lg object-cover" />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Provider Evidence */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-emerald-800">
                      Ảnh bằng chứng từ Nhà vườn ({disputeDetail.evidence?.provider?.length || 0}):
                    </span>
                    {disputeDetail.status !== 'RESOLVED' && (
                      <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6027D2] cursor-pointer hover:underline">
                        <UploadOutlined />
                        <span>{disputeEvidenceUploading ? 'Đang nộp...' : '+ Nộp thêm ảnh bằng chứng'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          disabled={disputeEvidenceUploading}
                          onChange={handleUploadProviderEvidence}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                  {disputeDetail.evidence?.provider?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {disputeDetail.evidence.provider.map((ev, i) => (
                        <div key={i} className="space-y-1">
                          <Image
                            src={ev.photoUrl}
                            alt="Ảnh nhà vườn"
                            width={72}
                            height={72}
                            className="rounded-lg object-cover border border-emerald-200"
                          />
                          {ev.caption && <p className="text-[10px] text-gray-500 max-w-[72px] truncate">{ev.caption}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400 italic">Vườn chưa nộp thêm ảnh bằng chứng.</p>
                  )}
                </div>
              </div>

              {/* Negotiation Offers History */}
              <div className="space-y-3 pt-3 border-t border-gray-100">
                <h5 className="text-xs font-bold uppercase tracking-wider text-[#6E6A8A]">
                  Lịch sử đề xuất thương lượng ({disputeDetail.offers?.length || 0})
                </h5>
                {disputeDetail.offers?.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Chưa có đề xuất thương lượng nào.</p>
                ) : (
                  <div className="space-y-2.5">
                    {disputeDetail.offers.map((off) => (
                      <div
                        key={off.id}
                        className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                          off.status === 'ACCEPTED'
                            ? 'bg-emerald-50 border-emerald-200'
                            : off.status === 'PENDING'
                            ? 'bg-white border-[#6027D2]/30 shadow-xs'
                            : 'bg-gray-50 border-gray-200 opacity-70'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#1E1B2E]">
                            {off.proposedBy === 'PROVIDER' ? '🏡 Đề xuất từ Nhà vườn' : '👤 Đề xuất từ Khách hàng'}
                          </span>
                          <Tag
                            color={
                              off.status === 'ACCEPTED'
                                ? 'green'
                                : off.status === 'PENDING'
                                ? 'gold'
                                : 'default'
                            }
                            className="!m-0"
                          >
                            {off.status === 'ACCEPTED'
                              ? 'Đã đồng ý'
                              : off.status === 'PENDING'
                              ? 'Đang chờ duyệt'
                              : 'Đã bị thay thế'}
                          </Tag>
                        </div>
                        <div className="grid grid-cols-3 gap-2 py-1 bg-white/70 p-2 rounded-lg border border-gray-100">
                          <div>
                            <span className="text-[11px] text-gray-500 block">Hoàn tiền công:</span>
                            <strong className="text-gray-900">{Number(off.refundAmount).toLocaleString('vi-VN')} đ</strong>
                          </div>
                          <div>
                            <span className="text-[11px] text-gray-500 block">Tiền bồi thường:</span>
                            <strong className="text-gray-900">{Number(off.compensationAmount).toLocaleString('vi-VN')} đ</strong>
                          </div>
                          <div>
                            <span className="text-[11px] text-[#6027D2] font-semibold block">Khách nhận tổng:</span>
                            <strong className="text-emerald-700">{Number(off.customerReceives).toLocaleString('vi-VN')} đ</strong>
                          </div>
                        </div>
                        {off.message && (
                          <p className="text-gray-600 italic text-[11px]">&ldquo;{off.message}&rdquo;</p>
                        )}
                        {/* Action to Accept Customer Offer */}
                        {off.proposedBy === 'CUSTOMER' && off.status === 'PENDING' && disputeDetail.status === 'NEGOTIATING' && (
                          <div className="flex justify-end pt-1">
                            <Button
                              type="primary"
                              size="small"
                              loading={acceptingOfferId === off.id}
                              onClick={() => handleAcceptOffer(off.id)}
                              className="!rounded-lg !bg-emerald-600 hover:!bg-emerald-700 !font-semibold text-xs"
                            >
                              Đồng ý đề xuất này & Kết thúc tranh chấp
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Form to submit a new offer */}
              {disputeDetail.status === 'NEGOTIATING' && (
                <div className="pt-3 border-t border-gray-100 space-y-3 bg-[#FAF8FE] p-3.5 rounded-xl border border-[#ECE7FA]">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-[#6027D2]">
                    Gửi đề xuất thương lượng mới cho khách hàng
                  </h5>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
                        Hoàn lại tiền công (VNĐ)
                      </label>
                      <Input
                        placeholder="VD: 200000"
                        value={disputeOfferRefund}
                        onChange={(e) => setDisputeOfferRefund(e.target.value.replace(/\D/g, ''))}
                        className="!rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
                        Tiền đền bù hoa lan (VNĐ)
                      </label>
                      <Input
                        placeholder="VD: 500000"
                        value={disputeOfferCompensation}
                        onChange={(e) => setDisputeOfferCompensation(e.target.value.replace(/\D/g, ''))}
                        className="!rounded-xl"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#1E1B2E] block mb-1">
                      Lời nhắn / Thuyết minh đề xuất
                    </label>
                    <Input.TextArea
                      rows={2}
                      maxLength={500}
                      placeholder="VD: Nhà vườn xin lỗi vì sơ suất và xin hỗ trợ đền bù phần giá trị cây kèm hoàn tiền công chăm sóc..."
                      value={disputeOfferMessage}
                      onChange={(e) => setDisputeOfferMessage(e.target.value)}
                      className="!rounded-xl"
                    />
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button
                      type="primary"
                      loading={disputeOfferSubmitting}
                      onClick={handleSubmitOffer}
                      className="!rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold text-xs"
                    >
                      Gửi đề xuất thương lượng
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* Modal: VietQR Security Deposit */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-[#1E1B2E]">
            <DollarOutlined className="text-[#D97706]" />
            <span>Nộp tiền bảo lãnh trách nhiệm (Ký quỹ nhận cây)</span>
          </div>
        }
        open={depositModalOpen}
        onCancel={() => setDepositModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setDepositModalOpen(false)} className="!rounded-xl">
            Đóng
          </Button>,
          <Button
            key="refresh"
            type="primary"
            onClick={async () => {
              await loadData();
              setDepositModalOpen(false);
            }}
            className="!rounded-xl !bg-[#6027D2]"
          >
            Tôi đã chuyển khoản xong
          </Button>,
        ]}
        width={460}
      >
        <div className="py-2">
          {depositLoading ? (
            <div className="py-12 text-center">
              <Spin size="small" />
              <p className="mt-2 text-xs text-[#8B86A4]">Đang khởi tạo mã VietQR bảo lãnh...</p>
            </div>
          ) : depositQrData ? (
            <div className="space-y-4 text-center">
              <div className="p-4 bg-white rounded-2xl border border-[#ECE7FA] inline-block shadow-xs">
                <img
                  src={depositQrData.qrImageUrl}
                  alt="VietQR nộp tiền bảo lãnh"
                  className="w-56 h-56 mx-auto object-contain rounded-xl"
                />
                <p className="text-[11px] text-[#8B86A4] mt-2">
                  Quét mã QR bằng App ngân hàng bất kỳ để chuyển khoản tự động
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#FAF8FE] border border-[#ECE7FA] text-left text-xs space-y-2">
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-[#6E6A8A]">Số tiền bảo lãnh:</span>
                  <strong className="text-[#6027D2] text-sm">
                    {Number(depositQrData.amount || 0).toLocaleString('vi-VN')} VNĐ
                  </strong>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-[#6E6A8A]">Ngân hàng:</span>
                  <span className="font-semibold text-[#1E1B2E]">{depositQrData.bankBin || 'Hệ thống Napas'}</span>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-[#6E6A8A]">Số tài khoản:</span>
                  <strong className="font-mono text-[#1E1B2E]">{depositQrData.bankAccountNumber}</strong>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-[#6E6A8A]">Chủ tài khoản:</span>
                  <span className="font-semibold text-[#1E1B2E]">{depositQrData.bankAccountName}</span>
                </div>
                <div className="pt-1.5 border-t border-[#ECE7FA]">
                  <span className="text-[#6E6A8A] block mb-0.5">Nội dung chuyển khoản (bắt buộc):</span>
                  <div className="p-2 rounded-lg bg-white border border-[#DDD6FE] font-mono font-bold text-xs text-[#6027D2] select-all">
                    {depositQrData.transferContent}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-[#92400E] bg-amber-50 p-2.5 rounded-xl border border-amber-200 text-left">
                💡 <strong>Lưu ý:</strong> Khoản tiền bảo lãnh này được hệ thống tạm giữ an toàn trong suốt thời gian chăm sóc và sẽ được hoàn trả lại 100% cho nhà vườn khi hoàn tất bàn giao trả cây.
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-[#8B86A4] py-6">Chưa có thông tin VietQR.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
