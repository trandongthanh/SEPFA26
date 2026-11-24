'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AppstoreAddOutlined,
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
  EyeOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  FormOutlined,
  InfoCircleOutlined,
  LockOutlined,
  PictureOutlined,
  PrinterOutlined,
  SafetyCertificateFilled,
  SafetyCertificateOutlined,
  StopOutlined,
  ToolOutlined,
  UploadOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Checkbox, Empty, Image, Input, Modal, Pagination, Radio, Select, Spin, Tag, message } from 'antd';
import { useAuthStore } from '@/lib/auth.store';
import { AddonItem, AddonStatus, DisputeDetail, DisputeReason, OrderDisputeItem, OrderItem, ProviderProfileResponse, providerApi } from '@/lib/provider.api';
import { videoCallApi } from '@/lib/video-call.api';
import ProviderHeader from '../components/ProviderHeader';
import ProviderSidebar from '../components/ProviderSidebar';
import ListToolbar, { NoResults } from '../components/ListToolbar';
import Highlight from '../components/Highlight';
import HandoverCancelModal, { HANDOVER_CANCEL_ORDER_STATUSES } from '../components/HandoverCancelModal';
import OrderDeadline from '../components/OrderDeadline';
import OrderCancelModal, { PROVIDER_CANCELLABLE_STATUSES } from '../components/OrderCancelModal';
import { matchesQuery, useUrlParam } from '@/lib/search';

const ORDERS_PAGE_SIZE = 10;
const ORDER_TABS = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'PENDING_PROVIDER', label: 'Chờ duyệt đặt lịch' },
  { value: 'AGREEMENT_PENDING', label: 'Chờ ký hợp đồng' },
  { value: 'PAID', label: 'Đã thanh toán' },
  { value: 'HANDOVER_IN_PROGRESS', label: 'Đang bàn giao cây' },
  { value: 'HANDOVER_AWAITING_CONFIRM', label: 'Chờ khách xác nhận' },
  { value: 'IN_CARE', label: 'Đang chăm sóc' },
  { value: 'COMPLETED', label: 'Hoàn thành' },
];

function OrdersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [videoCallLoading, setVideoCallLoading] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProviderProfileResponse | null>(null);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  // Đơn đang mở hộp thoại "Không nhận được cây" (huỷ ở chặng nhận cây).
  const [cancelHandoverOrderId, setCancelHandoverOrderId] = useState<string | null>(null);
  // Đơn đang mở hộp thoại "Huỷ đơn" (trước khi bắt đầu nhận cây).
  const [cancelOrderTarget, setCancelOrderTarget] = useState<{ id: string; orderCode: string; status: string } | null>(null);
  const [activeTab, setActiveTab] = useState<string>('ALL');

  // State for Handover Assessment Modal
  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [handoverOrder, setHandoverOrder] = useState<any | null>(null);
  const [handoverTargetOrderId, setHandoverTargetOrderId] = useState<string | null>(null);
  const [handoverError, setHandoverError] = useState<string | null>(null);
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
  const [uploadingPlantId, setUploadingPlantId] = useState<string | null>(null);
  const [completingHandover, setCompletingHandover] = useState(false);

  // State for Return Handover Modal (IN_CARE -> RETURN_IN_PROGRESS -> RETURN_AWAITING_CONFIRM)
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnOrder, setReturnOrder] = useState<any | null>(null);
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
  const [cancellingReturn, setCancellingReturn] = useState(false);
  const [cancelReturnReason, setCancelReturnReason] = useState('');

  // State for Contract Modal
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractData, setContractData] = useState<any | null>(null);
  const [currentContractOrderId, setCurrentContractOrderId] = useState<string | null>(null);

  // State for Sign Confirmation Modal
  const [signConfirmModalOpen, setSignConfirmModalOpen] = useState(false);
  const [orderToSign, setOrderToSign] = useState<{ id: string; agreementNo?: string; orderCode?: string } | null>(null);
  const [hasAgreedTerms, setHasAgreedTerms] = useState(false);

  // State for Dispute Modal (Dispute Room)
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);
  const [disputeOrder, setDisputeOrder] = useState<OrderItem | null>(null);
  const [disputeDetail, setDisputeDetail] = useState<DisputeDetail | null>(null);
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputeEvidenceUploading, setDisputeEvidenceUploading] = useState(false);
  const [disputeOfferSubmitting, setDisputeOfferSubmitting] = useState(false);
  const [disputeOfferRefund, setDisputeOfferRefund] = useState('');
  const [disputeOfferCompensation, setDisputeOfferCompensation] = useState('');
  const [disputeOfferMessage, setDisputeOfferMessage] = useState('');
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null);

  const handleOpenDisputeModal = async (order: OrderItem) => {
    setDisputeOrder(order);
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
    if (!file || !disputeOrder) return;
    setDisputeEvidenceUploading(true);
    try {
      const uploaded = await providerApi.uploadDocument(file);
      await providerApi.addDisputeEvidence(disputeOrder.id, {
        photos: [{ photoUrl: uploaded.url }],
      });
      message.success('Đã nộp thêm ảnh bằng chứng.');
      const data = await providerApi.getDispute(disputeOrder.id);
      setDisputeDetail(data);
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Không thể nộp ảnh bằng chứng.');
    } finally {
      setDisputeEvidenceUploading(false);
    }
  };

  const handleSubmitOffer = async () => {
    if (!disputeOrder || !disputeDetail) return;
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
      await providerApi.createDisputeOffer(disputeOrder.id, {
        refundAmount: refNum.toString(),
        compensationAmount: compNum.toString(),
        message: disputeOfferMessage.trim() || undefined,
      });
      message.success('Đã gửi đề xuất thương lượng mới.');
      setDisputeOfferRefund('');
      setDisputeOfferCompensation('');
      setDisputeOfferMessage('');
      const data = await providerApi.getDispute(disputeOrder.id);
      setDisputeDetail(data);
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Gửi đề xuất thương lượng thất bại.');
    } finally {
      setDisputeOfferSubmitting(false);
    }
  };

  const handleAcceptOffer = async (offerId: string) => {
    if (!disputeOrder) return;
    setAcceptingOfferId(offerId);
    try {
      await providerApi.acceptDisputeOffer(disputeOrder.id, offerId);
      message.success('Đã chấp nhận đề xuất thương lượng. Tranh chấp đã được giải quyết!');
      const data = await providerApi.getDispute(disputeOrder.id);
      setDisputeDetail(data);
      loadData();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Chấp nhận đề xuất thất bại.');
    } finally {
      setAcceptingOfferId(null);
    }
  };

  // State for Addon (Dịch vụ thêm ngoài gói)
  const [addonModalOpen, setAddonModalOpen] = useState(false);
  const [addonOrder, setAddonOrder] = useState<OrderItem | null>(null);
  const [addons, setAddons] = useState<AddonItem[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [addonSubmitting, setAddonSubmitting] = useState(false);
  const [addonUploading, setAddonUploading] = useState(false);

  // Form create addon
  const [addonTitle, setAddonTitle] = useState('');
  const [addonReason, setAddonReason] = useState('');
  const [addonPrice, setAddonPrice] = useState('');
  const [addonPlantId, setAddonPlantId] = useState<string | undefined>(undefined);
  const [addonPhotoUrls, setAddonPhotoUrls] = useState<string[]>([]);

  // Complete addon modal
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [selectedAddonForComplete, setSelectedAddonForComplete] = useState<AddonItem | null>(null);
  const [completePhotoUrls, setCompletePhotoUrls] = useState<string[]>([]);
  const [completeNote, setCompleteNote] = useState('');
  const [completePlantHealth, setCompletePlantHealth] = useState<'GOOD' | 'AVERAGE' | 'POOR'>('GOOD');
  const [completeUploading, setCompleteUploading] = useState(false);
  const [completeSubmitting, setCompleteSubmitting] = useState(false);

  const handleOpenAddonModal = async (order: OrderItem) => {
    setAddonOrder(order);
    setAddonModalOpen(true);
    setAddonTitle('');
    setAddonReason('');
    setAddonPrice('');
    setAddonPlantId(undefined);
    setAddonPhotoUrls([]);
    setAddonsLoading(true);
    try {
      const list = await providerApi.listAddons(order.id);
      setAddons(list);
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Không thể tải danh sách dịch vụ thêm.');
      setAddons([]);
    } finally {
      setAddonsLoading(false);
    }
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
    if (!addonOrder) return;
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
    if (addonPhotoUrls.length === 0) {
      message.warning('Vui lòng tải lên ít nhất 1 ảnh minh chứng tình trạng cây.');
      return;
    }
    setAddonSubmitting(true);
    try {
      await providerApi.createAddon(addonOrder.id, {
        title: addonTitle.trim(),
        reason: addonReason.trim(),
        price: Math.round(numPrice).toString(),
        photoUrls: addonPhotoUrls,
        plantId: addonPlantId || undefined,
      });
      message.success('Đã gửi đề xuất dịch vụ thêm cho khách hàng.');
      setAddonTitle('');
      setAddonReason('');
      setAddonPrice('');
      setAddonPhotoUrls([]);
      setAddonPlantId(undefined);
      const list = await providerApi.listAddons(addonOrder.id);
      setAddons(list);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Gửi đề xuất dịch vụ thêm thất bại.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setAddonSubmitting(false);
    }
  };

  const handleOpenCompleteModal = (addon: AddonItem, orderObj?: any) => {
    if (orderObj) setAddonOrder(orderObj);
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
    const targetOrderId = addonOrder?.id || selectedAddonForComplete?.orderId;
    if (!targetOrderId || !selectedAddonForComplete) return;

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
      await providerApi.completeAddon(targetOrderId, selectedAddonForComplete.id, {
        photoUrls: completePhotoUrls,
        note: trimmedNote,
        plantHealthAfter: hasPlant ? completePlantHealth : undefined,
      });
      message.success('Đã báo hoàn tất dịch vụ thêm.');
      setCompleteModalOpen(false);
      setSelectedAddonForComplete(null);
      const list = await providerApi.listAddons(targetOrderId);
      setAddons(list);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Báo hoàn tất thất bại.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setCompleteSubmitting(false);
    }
  };

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

  // Tải HẾT đơn một lần; đổi tab / tìm / sắp xếp / sang trang đều lọc tại chỗ, không gọi lại BE.
  // (Trước đây gọi theo từng tab và không truyền limit → BE chỉ trả 10 đơn mới nhất.)
  const loadData = async () => {
    setLoading(true);
    try {
      const prof = await providerApi.getProfile();
      setProfile(prof);
    } catch {
      setProfile(null);
    }

    try {
      setOrders(await providerApi.listAllOrders());
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted && isAuthenticated) {
      loadData();
    }
  }, [mounted, isAuthenticated]);

  // ===== Tìm kiếm + lọc + sắp xếp + phân trang (phía FE) =====
  const [searchQuery, setSearchQuery] = useUrlParam('q');
  const [sortBy, setSortBy] = useState<'NEWEST' | 'PICKUP_SOON' | 'OLDEST'>('NEWEST');
  const [currentPage, setCurrentPage] = useState(1);

  // Về trang 1 mỗi khi đổi điều kiện lọc.
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, sortBy]);

  const searchedOrders = orders.filter((order) =>
    matchesQuery(
      searchQuery,
      order.orderCode,
      order.customer?.account?.fullName,
      order.servicePackage?.name,
    ),
  );
  const tabCounts = ORDER_TABS.reduce<Record<string, number>>((acc, tab) => {
    acc[tab.value] =
      tab.value === 'ALL'
        ? searchedOrders.length
        : searchedOrders.filter((o) => o.status === tab.value).length;
    return acc;
  }, {});
  const time = (value?: string | null) => (value ? new Date(value).getTime() : 0);
  const visibleOrders = searchedOrders
    .filter((o) => activeTab === 'ALL' || o.status === activeTab)
    .sort((a, b) => {
      if (sortBy === 'OLDEST') return time(a.createdAt) - time(b.createdAt);
      if (sortBy === 'PICKUP_SOON') return time(a.scheduledPickupAt) - time(b.scheduledPickupAt);
      return time(b.createdAt) - time(a.createdAt);
    });
  const pagedOrders = visibleOrders.slice(
    (currentPage - 1) * ORDERS_PAGE_SIZE,
    currentPage * ORDERS_PAGE_SIZE,
  );
  const resetFilters = () => {
    setSearchQuery('');
    setActiveTab('ALL');
  };

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
      loadData();
    } catch (err: any) {
      const rawMsg =
        err?.response?.data?.message || err?.message || 'Không thể xử lý đơn hàng lúc này.';
      const msgText = Array.isArray(rawMsg) ? rawMsg.join(', ') : String(rawMsg);
      // Mã lỗi khác (vd PROVIDER_IDENTITY_INCOMPLETE) đã được lib/api.ts dịch sẵn sang tiếng Việt.
      if (msgText.includes('INVALID_STATE_TRANSITION')) {
        message.warning('Trạng thái đơn hàng vừa thay đổi. Đang làm mới danh sách...');
        loadData();
      } else {
        message.error(msgText);
      }
    } finally {
      setActionLoading(null);
    }
  };

  // Yêu cầu mở popup xác nhận ký hợp đồng
  const handlePromptSignAgreement = (orderId: string, agreementNo?: string, orderCode?: string) => {
    setOrderToSign({ id: orderId, agreementNo, orderCode });
    setHasAgreedTerms(false);
    setSignConfirmModalOpen(true);
  };

  // Xác nhận ký hợp đồng từ popup
  const handleConfirmSignAgreement = async () => {
    if (!orderToSign) return;
    const orderId = orderToSign.id;
    setActionLoading(orderId);
    try {
      await providerApi.signAgreement(orderId);
      message.success('Đã ký hợp đồng dịch vụ trực tuyến thành công!');
      setSignConfirmModalOpen(false);
      setOrderToSign(null);
      loadData();
      if (contractModalOpen && currentContractOrderId === orderId) {
        handleOpenContractModal(orderId);
      }
    } catch (err: any) {
      const rawMsg = err?.response?.data?.message || err?.message || 'Không thể ký hợp đồng lúc này.';
      const msgText = Array.isArray(rawMsg) ? rawMsg.join(', ') : String(rawMsg);
      if (msgText.includes('INVALID_STATE_TRANSITION')) {
        message.warning('Trạng thái đơn hàng vừa thay đổi. Đang làm mới dữ liệu...');
        setSignConfirmModalOpen(false);
        loadData();
      } else {
        message.error(msgText);
      }
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
      loadData();
    } catch (err: any) {
      const rawMsg = err?.response?.data?.message || err?.message || 'Không thể bắt đầu bàn giao.';
      const msgText = Array.isArray(rawMsg) ? rawMsg.join(', ') : String(rawMsg);
      if (msgText.includes('INVALID_STATE_TRANSITION')) {
        message.warning('Trạng thái đơn hàng vừa thay đổi. Đang làm mới danh sách...');
        loadData();
      } else {
        message.error(msgText);
      }
    } finally {
      setActionLoading(null);
    }
  };

  // Mở modal thẩm định bàn giao
  const handleOpenHandoverModal = async (orderId: string) => {
    setHandoverTargetOrderId(orderId);
    setHandoverModalOpen(true);
    setHandoverLoading(true);
    setHandoverError(null);
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
      const errMsg = err?.response?.data?.message || err?.message || 'Không thể tải chi tiết đơn hàng để thẩm định.';
      const msgStr = Array.isArray(errMsg) ? errMsg.join(', ') : String(errMsg);
      setHandoverError(msgStr);
      message.error(msgStr);
    } finally {
      setHandoverLoading(false);
    }
  };

  // Tải ảnh thẩm định lên Cloudinary (không hiển thị URL thô cho người dùng)
  const handleUploadAssessmentPhoto = async (plantId: string, file?: File) => {
    if (!file) return;
    setUploadingPlantId(plantId);
    try {
      const uploaded = await providerApi.uploadDocument(file);
      setPlantForms((prev) => ({
        ...prev,
        [plantId]: {
          ...prev[plantId],
          photoUrl: uploaded.url,
          saved: false,
        },
      }));
      message.success('Đã tải ảnh thẩm định thành công!');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Không thể tải ảnh lên.';
      message.error(msg);
    } finally {
      setUploadingPlantId(null);
    }
  };

  // Lưu thẩm định cho 1 cây
  const handleSavePlantAssessment = async (plantId: string) => {
    if (!handoverOrder) return;
    const form = plantForms[plantId];
    if (!form) return;
    if (!form.photoUrl || !form.photoUrl.trim()) {
      message.warning('Vui lòng tải lên ảnh hiện trạng thẩm định.');
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
      loadData();
    } catch (err: any) {
      const rawMsg = err?.response?.data?.message || err?.message || 'Không thể hoàn tất thẩm định bàn giao.';
      const msgText = Array.isArray(rawMsg) ? rawMsg.join(', ') : String(rawMsg);
      if (msgText.includes('INVALID_STATE_TRANSITION')) {
        message.warning('Trạng thái đơn hàng vừa thay đổi. Đang làm mới dữ liệu...');
        setHandoverModalOpen(false);
        loadData();
      } else {
        message.error(msgText);
      }
    } finally {
      setCompletingHandover(false);
    }
  };

  // === Trả cây (IN_CARE -> RETURN_IN_PROGRESS -> RETURN_AWAITING_CONFIRM) ===
  const handleStartReturn = async (orderId: string) => {
    setActionLoading(orderId);
    try {
      await providerApi.startReturn(orderId);
      message.success('Đã bắt đầu phiên bàn giao trả cây! Vui lòng ghi nhận tình trạng từng cây.');
      await loadData();
      handleOpenReturnModal(orderId);
    } catch (err: any) {
      const rawCode = err?.response?.data?.rawCode;
      const msg = err?.response?.data?.message || err?.message || 'Không thể bắt đầu trả cây lúc này.';
      const displayMsg = Array.isArray(msg) ? msg.join(', ') : String(msg);
      message.error(displayMsg);
      Modal.warning({
        title: rawCode === 'CARE_NOT_DUE' ? 'Chưa đến hạn trả cây' : 'Không thể bắt đầu trả cây',
        content: displayMsg,
        okText: 'Đã hiểu',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenReturnModal = async (orderId: string) => {
    setReturnModalOpen(true);
    setReturnLoading(true);
    setCancelReturnReason('');
    try {
      const data = await providerApi.getOrderDetail(orderId);
      setReturnOrder(data);
      const existingAssessments: any[] = data?.returnHandover?.assessments || [];
      const assessedSet = new Set(existingAssessments.map((a: any) => a.plantId));
      const forms: Record<string, any> = {};
      (data?.plants || [])
        .filter((p: any) => p.handoverDecision !== 'REJECT')
        .forEach((p: any) => {
          const prev = existingAssessments.find((a: any) => a.plantId === p.id);
          forms[p.id] = {
            leafCondition: prev?.checklist?.leaf || 'Tốt',
            rootCondition: prev?.checklist?.root || 'Chắc khỏe',
            hasPest: Boolean(prev?.checklist?.pest),
            note: prev?.note || '',
            photoUrl: prev?.photos?.[0]?.photoUrl || '',
            saved: assessedSet.has(p.id),
          };
        });
      setReturnPlantForms(forms);
    } catch {
      message.error('Không thể tải chi tiết đơn hàng để trả cây.');
      setReturnModalOpen(false);
    } finally {
      setReturnLoading(false);
    }
  };

  const handleUploadReturnPhoto = async (plantId: string, file?: File) => {
    if (!file) return;
    setUploadingReturnPlantId(plantId);
    try {
      const uploaded = await providerApi.uploadDocument(file);
      setReturnPlantForms((prev) => ({
        ...prev,
        [plantId]: { ...prev[plantId], photoUrl: uploaded.url, saved: false },
      }));
      message.success('Đã tải ảnh trả cây thành công!');
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || 'Không thể tải ảnh lên.');
    } finally {
      setUploadingReturnPlantId(null);
    }
  };

  const handleSaveReturnPlantAssessment = async (plantId: string) => {
    if (!returnOrder) return;
    const form = returnPlantForms[plantId];
    if (!form || !form.photoUrl?.trim()) {
      message.warning('Vui lòng tải lên ảnh tình trạng cây lúc trả.');
      return;
    }
    setSavingReturnPlantId(plantId);
    try {
      await providerApi.assessReturnPlant(returnOrder.id, plantId, {
        checklist: {
          leaf: form.leafCondition,
          root: form.rootCondition,
          pest: form.hasPest,
        },
        note: form.note.trim() || undefined,
        photos: [
          {
            photoUrl: form.photoUrl.trim(),
            caption: 'Ảnh tình trạng cây lúc bàn giao trả',
          },
        ],
      });
      message.success('Đã lưu tình trạng trả cho chậu cây này!');
      setReturnPlantForms((prev) => ({
        ...prev,
        [plantId]: { ...prev[plantId], saved: true },
      }));
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Không thể lưu tình trạng trả cây.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setSavingReturnPlantId(null);
    }
  };

  const handleCompleteReturn = async () => {
    if (!returnOrder) return;
    setCompletingReturn(true);
    try {
      await providerApi.completeReturn(returnOrder.id);
      message.success('Đã hoàn tất bàn giao trả cây! Đơn hàng đang chờ khách hàng xác nhận nhận lại.');
      setReturnModalOpen(false);
      loadData();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Vui lòng đánh giá đủ tất cả cây đang chăm trước khi hoàn tất.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setCompletingReturn(false);
    }
  };

  const handleCancelReturn = async () => {
    if (!returnOrder) return;
    if (!cancelReturnReason.trim()) {
      message.warning('Vui lòng nhập lý do hủy phiên trả để hẹn lại khách.');
      return;
    }
    setCancellingReturn(true);
    try {
      await providerApi.cancelReturn(returnOrder.id, cancelReturnReason.trim());
      message.info('Đã hủy phiên trả và đưa đơn về trạng thái Đang chăm sóc để hẹn lại.');
      setReturnModalOpen(false);
      loadData();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Không thể hủy phiên trả.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setCancellingReturn(false);
    }
  };

  // Mở modal xem chi tiết hợp đồng điện tử
  const handleOpenContractModal = async (orderId: string) => {
    setCurrentContractOrderId(orderId);
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
    'RETURN_IN_PROGRESS',
    'RETURN_AWAITING_CONFIRM',
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

  const handleOpenDetail = (orderId: string) => {
    router.push(`/provider/orders/${orderId}`);
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
      case 'RETURN_IN_PROGRESS':
        return (
          <Tag color="geekblue" icon={<EnvironmentOutlined />}>
            Đang bàn giao trả cây
          </Tag>
        );
      case 'RETURN_AWAITING_CONFIRM':
        return (
          <Tag color="volcano" icon={<ClockCircleOutlined />}>
            Chờ khách nghiệm thu cây
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
      case 'EXPIRED':
        return (
          <Tag color="default" icon={<ClockCircleOutlined />}>
            Quá hạn phản hồi
          </Tag>
        );
      case 'CANCELLED':
        return (
          <Tag color="red" icon={<CloseCircleOutlined />}>
            Đã hủy
          </Tag>
        );
      case 'DISPUTED':
        return (
          <Tag color="magenta" icon={<InfoCircleOutlined />}>
            Đang tranh chấp
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

          {/* Tìm kiếm + lọc nhanh theo trạng thái + sắp xếp */}
          <div className="mb-3">
            <ListToolbar
              query={searchQuery}
              onQueryChange={setSearchQuery}
              placeholder="Tìm mã đơn, tên khách hoặc tên gói…"
              chips={ORDER_TABS.map((tab) => ({ ...tab, count: tabCounts[tab.value] ?? 0 }))}
              activeChip={activeTab}
              onChipChange={setActiveTab}
              extra={
                <Select
                  size="large"
                  value={sortBy}
                  onChange={setSortBy}
                  aria-label="Sắp xếp đơn"
                  className="w-48"
                  options={[
                    { value: 'NEWEST', label: 'Mới nhất trước' },
                    { value: 'PICKUP_SOON', label: 'Giờ hẹn gần nhất' },
                    { value: 'OLDEST', label: 'Cũ nhất trước' },
                  ]}
                />
              }
            />
          </div>
          {!loading && orders.length > 0 && (
            <p className="mb-4 text-xs text-[#6E6A8A]">
              {searchQuery || activeTab !== 'ALL' ? (
                <>
                  <b className="text-[#1E1B2E] tabular-nums">{visibleOrders.length}</b> kết quả
                </>
              ) : (
                <>
                  Tổng <b className="text-[#1E1B2E] tabular-nums">{orders.length}</b> đơn
                </>
              )}
            </p>
          )}

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
                Khi khách đặt lịch chăm sóc tại nhà vườn, đơn sẽ hiện ở đây.
              </p>
            </div>
          ) : visibleOrders.length === 0 ? (
            <NoResults
              label={searchQuery || ORDER_TABS.find((t) => t.value === activeTab)?.label || activeTab}
              onReset={resetFilters}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {pagedOrders.map((order) => {
                const firstPlantPhoto =
                  (order as any).plants?.[0]?.initialPhotos?.[0]?.photoUrl ||
                  (order as any).plants?.[0]?.photos?.[0]?.photoUrl ||
                  '';

                return (
                  <div
                    key={order.id}
                    className="bg-white rounded-2xl p-5 border border-[#ECE7FA] hover:border-[#C4B5FD] shadow-[0_4px_20px_rgba(96,39,210,0.04)] transition-all"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start gap-5">
                      {/* Left: Plant Thumbnail + User Badge */}
                      <div className="relative w-24 h-24 rounded-2xl bg-[#F5F3FF] border border-[#ECE7FA] overflow-hidden shrink-0 flex items-center justify-center">
                        {firstPlantPhoto ? (
                          <Image
                            src={firstPlantPhoto}
                            alt={order.orderCode}
                            width={96}
                            height={96}
                            className="w-full h-full object-cover cursor-pointer"
                          />
                        ) : (
                          <PictureOutlined className="text-3xl text-[#A78BFA]" />
                        )}
                        <div className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full bg-[#6027D2] border-2 border-white flex items-center justify-center text-white text-[11px] shadow-xs pointer-events-none">
                          <UserOutlined />
                        </div>
                      </div>

                      {/* Right Content */}
                      <div className="flex-1 min-w-0">
                        {/* Top Row: Order Code + Status + Price */}
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <h3 className="font-bold text-base text-[#1E1B2E] flex items-center gap-1.5">
                              <span>Mã đơn:</span>
                              <span className="text-[#6027D2] font-extrabold tracking-tight">
                                <Highlight text={order.orderCode} query={searchQuery} />
                              </span>
                            </h3>
                            <button
                              type="button"
                              title="Sao chép mã đơn"
                              onClick={() => {
                                navigator.clipboard?.writeText(order.orderCode);
                                message.success('Đã sao chép mã đơn');
                              }}
                              className="text-[#8B86A4] hover:text-[#6027D2] p-1 rounded-md hover:bg-[#F5F3FF] transition-colors"
                            >
                              <CopyOutlined className="text-xs" />
                            </button>
                            {getStatusBadge(order.status)}
                          </div>

                          <div className="sm:text-right shrink-0">
                            <span className="block text-[10px] text-[#8B86A4] uppercase font-bold tracking-wider">
                              TẠM TÍNH
                            </span>
                            <p className="text-xl font-extrabold text-[#4E1BA8] leading-tight">
                              {Number(order.finalTotal || order.provisionalTotal || 0).toLocaleString(
                                'vi-VN'
                              )}{' '}
                              VNĐ
                            </p>
                          </div>
                        </div>

                        {/* Middle Row: 3 Info Pills */}
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div className="bg-[#F6F4FC] rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
                            <UserOutlined className="text-[#7C3AED] text-base shrink-0" />
                            <div className="min-w-0">
                              <span className="block text-[11px] text-[#8B86A4] leading-tight">
                                Khách hàng
                              </span>
                              <span className="block text-xs font-bold text-[#1E1B2E] truncate mt-0.5">
                                <Highlight
                                  text={order.customer?.account?.fullName || 'Khách hàng ẩn danh'}
                                  query={searchQuery}
                                />
                              </span>
                            </div>
                          </div>

                          <div className="bg-[#F6F4FC] rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
                            <CalendarOutlined className="text-[#7C3AED] text-base shrink-0" />
                            <div className="min-w-0">
                              <span className="block text-[11px] text-[#8B86A4] leading-tight">
                                Gói dịch vụ
                              </span>
                              <span className="block text-xs font-bold text-[#6027D2] truncate mt-0.5">
                                <Highlight
                                  text={order.servicePackage?.name || 'Gói chăm sóc lan tiêu chuẩn'}
                                  query={searchQuery}
                                />
                              </span>
                            </div>
                          </div>

                          <div className="bg-[#F6F4FC] rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
                            <CalendarOutlined className="text-[#7C3AED] text-base shrink-0" />
                            <div className="min-w-0">
                              <span className="block text-[11px] text-[#8B86A4] leading-tight">
                                Hẹn tiếp nhận
                              </span>
                              <span className="block text-xs font-bold text-[#1E1B2E] truncate mt-0.5">
                                {order.scheduledPickupAt
                                  ? new Date(order.scheduledPickupAt).toLocaleDateString('vi-VN')
                                  : 'Chưa hẹn'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Hạn chót của bước hiện tại (trả lời đơn / ký HĐ / thanh toán / tới lấy cây) */}
                        <OrderDeadline order={order} className="mt-3" />

                        {/* Bottom Row: Action Buttons */}
                        <div className="mt-4 pt-3 border-t border-[#F3EFFA] flex items-center gap-2 flex-wrap">
                          <Button
                            icon={<EyeOutlined />}
                            onClick={() => handleOpenDetail(order.id)}
                            className="!h-9 !px-4 !rounded-xl !bg-[#F3EFFF] !border-none !text-[#5B21B6] hover:!bg-[#E9D8FD] !font-semibold text-xs flex items-center gap-1.5"
                          >
                            Xem chi tiết
                          </Button>

                          {['AGREEMENT_PENDING', 'AWAITING_PAYMENT', 'PAID', 'HANDOVER_IN_PROGRESS', 'HANDOVER_AWAITING_CONFIRM', 'IN_CARE', 'RETURN_IN_PROGRESS', 'RETURN_AWAITING_CONFIRM', 'COMPLETED', 'DISPUTED'].includes(order.status) && (
                            <Button
                              icon={<FileProtectOutlined />}
                              onClick={() => handleOpenContractModal(order.id)}
                              className="!h-9 !px-4 !rounded-xl !bg-[#F6F4FC] !border-none !text-[#1E1B2E] hover:!bg-[#ECE7FA] !font-semibold text-xs flex items-center gap-1.5"
                            >
                              Xem Hợp đồng
                            </Button>
                          )}

                          <span className="hidden sm:inline-block w-px h-6 bg-[#ECE7FA] mx-1" />

                          {order.status === 'PENDING_PROVIDER' && (
                            <Button
                              onClick={() => handleRespondOrder(order.id, 'REJECT')}
                              loading={actionLoading === order.id}
                              className="!h-9 !px-4 !rounded-xl !bg-white !border !border-red-200 !text-red-600 hover:!bg-red-50 !font-semibold text-xs flex items-center gap-1"
                            >
                              <CloseCircleOutlined />
                              Từ chối
                            </Button>
                          )}

                          {order.status === 'DISPUTED' && (
                            <Button
                              danger
                              type="primary"
                              icon={<ExclamationCircleOutlined />}
                              onClick={() => handleOpenDisputeModal(order)}
                              className="!h-9 !px-4 !rounded-xl !bg-rose-600 hover:!bg-rose-700 !font-semibold text-xs flex items-center gap-1.5 shadow-sm"
                            >
                              Hồ sơ tranh chấp
                            </Button>
                          )}

                          {CALL_ELIGIBLE_STATUSES.has(order.status) && (
                            <Button
                              icon={<VideoCameraOutlined />}
                              loading={videoCallLoading === order.id}
                              onClick={() => handleStartVideoCall(order.id)}
                              className="!h-9 !px-4 !rounded-xl !bg-emerald-50/80 !border !border-emerald-200 !text-emerald-700 hover:!bg-emerald-100 !font-semibold text-xs flex items-center gap-1"
                            >
                              Gọi Video
                            </Button>
                          )}

                          {['IN_CARE', 'RETURN_IN_PROGRESS', 'RETURN_AWAITING_CONFIRM', 'COMPLETED', 'DISPUTED'].includes(order.status) && (
                            <Button
                              icon={<AppstoreAddOutlined />}
                              onClick={() => handleOpenAddonModal(order)}
                              className="!h-9 !px-4 !rounded-xl !bg-[#F5F3FF] !border !border-[#DDD6FE] !text-[#6027D2] hover:!bg-[#EDE9FE] !font-semibold text-xs flex items-center gap-1"
                            >
                              Dịch vụ thêm
                            </Button>
                          )}

                          {order.status === 'IN_CARE' && (
                            <Button
                              icon={<EnvironmentOutlined />}
                              loading={actionLoading === order.id}
                              onClick={() => handleStartReturn(order.id)}
                              className="!h-9 !px-4 !rounded-xl !bg-[#F3EFFF] !border !border-[#DDD6FE] !text-[#6027D2] hover:!bg-[#E9D8FD] !font-semibold text-xs"
                            >
                              Bắt đầu trả cây
                            </Button>
                          )}

                          {/* Huỷ đơn trước khi bắt đầu nhận cây (chờ ký HĐ / chờ thanh toán / đã thanh toán). */}
                          {PROVIDER_CANCELLABLE_STATUSES.includes(order.status) && (
                            <Button
                              danger
                              type="text"
                              icon={<StopOutlined />}
                              onClick={() =>
                                setCancelOrderTarget({ id: order.id, orderCode: order.orderCode, status: order.status })
                              }
                              className="!h-9 !px-3 !rounded-xl !font-semibold text-xs"
                            >
                              Huỷ đơn
                            </Button>
                          )}

                          {/* Huỷ ở chặng nhận cây — hộp thoại tự tải chi tiết đơn để biết đúng bước của phiên nhận cây. */}
                          {HANDOVER_CANCEL_ORDER_STATUSES.includes(order.status) && (
                            <Button
                              danger
                              icon={<StopOutlined />}
                              onClick={() => setCancelHandoverOrderId(order.id)}
                              className="!h-9 !px-4 !rounded-xl !font-semibold text-xs sm:ml-auto"
                            >
                              Không nhận được cây
                            </Button>
                          )}

                          {order.status === 'HANDOVER_AWAITING_CONFIRM' && (
                            <Tag color="volcano" className="!h-9 !px-3 !rounded-xl flex items-center font-semibold text-xs">
                              Chờ khách xác nhận bàn giao
                            </Tag>
                          )}

                          {order.status === 'RETURN_AWAITING_CONFIRM' && (
                            <Tag color="gold" className="!h-9 !px-3 !rounded-xl flex items-center font-semibold text-xs sm:ml-auto">
                              Chờ khách xác nhận nhận lại cây
                            </Tag>
                          )}

                          {/* Primary Right-aligned CTA */}
                          {order.status === 'PENDING_PROVIDER' && (
                            <Button
                              type="primary"
                              icon={<CheckCircleOutlined />}
                              onClick={() => handleRespondOrder(order.id, 'ACCEPT')}
                              loading={actionLoading === order.id}
                              className="!h-9 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold text-xs shadow-sm sm:ml-auto"
                            >
                              Duyệt đặt lịch
                            </Button>
                          )}

                          {order.status === 'AGREEMENT_PENDING' && (
                            <Button
                              type="primary"
                              icon={<FileProtectOutlined />}
                              onClick={() => handleOpenContractModal(order.id)}
                              loading={actionLoading === order.id}
                              className="!h-9 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold text-xs shadow-sm sm:ml-auto text-white"
                            >
                              Ký hợp đồng ngay
                            </Button>
                          )}

                          {order.status === 'PAID' && (
                            <Button
                              type="primary"
                              icon={<EnvironmentOutlined />}
                              onClick={() => handleStartHandover(order.id)}
                              loading={actionLoading === order.id}
                              className="!h-9 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold text-xs shadow-sm sm:ml-auto text-white"
                            >
                              Bắt đầu bàn giao cây
                            </Button>
                          )}

                          {order.status === 'HANDOVER_IN_PROGRESS' && (
                            <Button
                              type="primary"
                              icon={<AuditOutlined />}
                              onClick={() => handleOpenHandoverModal(order.id)}
                              className="!h-9 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold text-xs shadow-sm sm:ml-auto text-white"
                            >
                              Thẩm định & Bàn giao cây
                            </Button>
                          )}

                          {order.status === 'IN_CARE' && (
                            <Button
                              type="primary"
                              icon={<FileTextOutlined />}
                              onClick={() => router.push(`/provider/reports/new?orderId=${order.id}`)}
                              className="!h-9 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold text-xs shadow-sm sm:ml-auto"
                            >
                              Nộp báo cáo chăm sóc
                            </Button>
                          )}

                          {order.status === 'RETURN_IN_PROGRESS' && (
                            <Button
                              type="primary"
                              icon={<AuditOutlined />}
                              onClick={() => handleOpenReturnModal(order.id)}
                              className="!h-9 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold text-xs shadow-sm sm:ml-auto text-white"
                            >
                              Ghi nhận & Hoàn tất trả cây
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {visibleOrders.length > ORDERS_PAGE_SIZE && (
                <div className="flex justify-end pt-2">
                  <Pagination
                    current={currentPage}
                    pageSize={ORDERS_PAGE_SIZE}
                    total={visibleOrders.length}
                    onChange={(page) => {
                      setCurrentPage(page);
                      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    showSizeChanger={false}
                    showTotal={(total, [from, to]) => `${from}–${to} / ${total} đơn`}
                  />
                </div>
              )}
            </div>
          )}
        </main>

        <OrderCancelModal
          order={cancelOrderTarget}
          onClose={() => setCancelOrderTarget(null)}
          onCancelled={() => loadData()}
        />

        <HandoverCancelModal
          orderId={cancelHandoverOrderId}
          onClose={() => setCancelHandoverOrderId(null)}
          onCancelled={() => loadData()}
        />
      </div>

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
                disabled={!handoverOrder || !handoverOrder.plants?.length}
                className="!rounded-xl !bg-[#2563EB] hover:!bg-[#1D4ED8] !font-bold disabled:!opacity-50"
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
        ) : !handoverOrder ? (
          <div className="py-12 text-center space-y-4">
            <Empty
              description={
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#1E1B2E]">
                    {handoverError || 'Không thể tải chi tiết chậu cây của đơn hàng.'}
                  </p>
                  <p className="text-xs text-[#6E6A8A]">
                    Vui lòng kiểm tra lại kết nối mạng hoặc thử tải lại.
                  </p>
                </div>
              }
            />
            {handoverTargetOrderId && (
              <Button
                type="primary"
                onClick={() => handleOpenHandoverModal(handoverTargetOrderId)}
                className="!rounded-xl !bg-[#2563EB]"
              >
                Thử tải lại
              </Button>
            )}
          </div>
        ) : (
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

                      {/* Ảnh chụp thẩm định hiện trạng (chỉ upload & xem trước, không hiện URL thô) */}
                      <div>
                        <label className="block text-xs font-bold text-[#4B4764] mb-1.5">
                          Ảnh chụp thẩm định hiện trạng (bắt buộc):
                        </label>
                        {form.photoUrl ? (
                          <div className="flex items-center gap-3 flex-wrap">
                            <Image
                              src={form.photoUrl}
                              alt="Ảnh thẩm định"
                              width={84}
                              height={84}
                              className="rounded-xl object-cover border border-[#ECE7FA]"
                              fallback="https://placehold.co/84x84?text=Ảnh+lỗi"
                            />
                            <div className="flex items-center gap-2">
                              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#DDD6FE] text-xs font-semibold text-[#6027D2] hover:bg-[#EDE9FE]">
                                {uploadingPlantId === plant.id ? <Spin size="small" /> : <UploadOutlined />}
                                <span>Đổi ảnh khác</span>
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  style={{ display: 'none' }}
                                  onChange={(e) => handleUploadAssessmentPhoto(plant.id, e.target.files?.[0])}
                                />
                              </label>
                              <Button
                                size="small"
                                danger
                                onClick={() =>
                                  setPlantForms((prev) => ({
                                    ...prev,
                                    [plant.id]: { ...prev[plant.id], photoUrl: '', saved: false },
                                  }))
                                }
                              >
                                Xóa ảnh
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-dashed border-[#C4B5FD] text-xs font-semibold text-[#6027D2] hover:bg-[#F5F3FF]">
                            {uploadingPlantId === plant.id ? <Spin size="small" /> : <UploadOutlined />}
                            <span>Chọn & tải ảnh hiện trạng lên</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={(e) => handleUploadAssessmentPhoto(plant.id, e.target.files?.[0])}
                            />
                          </label>
                        )}
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
        )}
      </Modal>

      {/* Contract Detail Modal */}
      <Modal
        title={
          <div className="flex items-center justify-between w-full pr-6">
            <div className="flex items-center gap-2 text-base font-bold text-[#1E1B2E]">
              <FileProtectOutlined className="text-[#6027D2] text-lg" />
              <span>Văn bản Hợp đồng Dịch vụ Chăm sóc Hoa Lan Điện tử</span>
            </div>
            <Button
              size="small"
              icon={<PrinterOutlined />}
              onClick={() => {
                if (typeof window !== 'undefined') window.print();
              }}
              className="!rounded-lg text-xs"
            >
              In / Lưu PDF
            </Button>
          </div>
        }
        open={contractModalOpen}
        onCancel={() => setContractModalOpen(false)}
        width={860}
        centered
        styles={{ body: { maxHeight: '78vh', overflowY: 'auto', paddingRight: '6px' } }}
        footer={
          (() => {
            const contractOrderStatus = orders.find((o) => o.id === currentContractOrderId)?.status || '';
            const isProviderSigned = contractData?.signatures?.some(
              (s: any) =>
                (s.role === 'PROVIDER' || s.signerRole === 'PROVIDER') &&
                (s.signedAt || s.signatureHash)
            );
            const canProviderSign = contractOrderStatus === 'AGREEMENT_PENDING' && !isProviderSigned;
            const agreementNumber =
              contractData?.agreementNo ||
              contractData?.agreement?.agreementNo ||
              'N/A';
            const orderCode =
              contractData?.orderSummary?.orderCode ||
              contractData?.orderCode ||
              'N/A';

            return (
              <div className="flex items-center justify-between w-full pt-2">
                <div className="text-xs text-[#6E6A8A] flex items-center gap-1.5">
                  <LockOutlined className="text-[#6027D2]" />
                  <span>Xác thực & Bảo mật bởi LanCare Hub</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={() => setContractModalOpen(false)} className="!rounded-xl">
                    Đóng
                  </Button>
                  {contractData && canProviderSign && (
                    <Button
                      type="primary"
                      icon={<FormOutlined />}
                      onClick={() => {
                        const ordId = currentContractOrderId || contractData.orderSummary?.orderId || contractData.serviceOrderId;
                        if (ordId) {
                          handlePromptSignAgreement(ordId, agreementNumber, orderCode);
                        }
                      }}
                      className="!bg-[#6027D2] hover:!bg-[#4E1BA8] !rounded-xl !font-semibold text-white shadow-md shadow-[#6027D2]/30"
                    >
                      Ký hợp đồng ngay
                    </Button>
                  )}
                </div>
              </div>
            );
          })()
        }
      >
        {contractLoading ? (
          <div className="py-20 text-center">
            <Spin size="large" />
            <p className="mt-3 text-sm text-[#6E6A8A]">Đang tải dữ liệu hợp đồng điện tử...</p>
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
            // BE (snapshot v3) không còn số CCCD — chỉ Họ tên, Ngày sinh, Quê quán, Địa chỉ, SĐT.
            const customerDob = customerParty.dateOfBirth || 'Chưa cung cấp';
            const customerOrigin = customerParty.placeOfOrigin || 'Chưa cung cấp';

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
            // BE (snapshot v3) không còn số CCCD — chỉ Họ tên, Ngày sinh, Quê quán, Địa chỉ, SĐT.
            const providerDob = providerParty.dateOfBirth || 'Chưa cung cấp';
            const providerOrigin = providerParty.placeOfOrigin || 'Chưa cung cấp';

            const agreementNumber =
              contractData.agreementNo ||
              contractData.agreement?.agreementNo ||
              'N/A';
            const orderCode =
              contractData.orderSummary?.orderCode ||
              contractData.orderCode ||
              'N/A';
            const agreementDate =
              contractData.createdAt ||
              contractData.agreement?.createdAt ||
              new Date().toISOString();

            const contractOrderStatus = orders.find((o) => o.id === currentContractOrderId)?.status || '';
            const isPastAgreementPending = [
              'AWAITING_PAYMENT',
              'PAID',
              'HANDOVER_IN_PROGRESS',
              'HANDOVER_AWAITING_CONFIRM',
              'IN_CARE',
              'RETURN_IN_PROGRESS',
              'RETURN_AWAITING_CONFIRM',
              'COMPLETED',
              'DISPUTED',
            ].includes(contractOrderStatus);

            const isCustomerSigned =
              contractData.signatures?.some(
                (s: any) =>
                  (s.role === 'CUSTOMER' || s.signerRole === 'CUSTOMER') &&
                  (s.signedAt || s.signatureHash)
              ) || isPastAgreementPending;
            const isProviderSigned =
              contractData.signatures?.some(
                (s: any) =>
                  (s.role === 'PROVIDER' || s.signerRole === 'PROVIDER') &&
                  (s.signedAt || s.signatureHash)
              ) || isPastAgreementPending;

            const customerSig = contractData.signatures?.find(
              (s: any) => s.role === 'CUSTOMER' || s.signerRole === 'CUSTOMER'
            );
            const providerSig = contractData.signatures?.find(
              (s: any) => s.role === 'PROVIDER' || s.signerRole === 'PROVIDER'
            );

            const pricing = contractData.pricing || {};
            const orderSummary = contractData.orderSummary || {};
            const compensationPolicy = contractData.compensationPolicy || {};

            // Fallback 9 standard clauses if empty
            const defaultClauses = [
              'Điều 1 – Phạm vi dịch vụ: Bên B (Nhà vườn) cam kết thực hiện dịch vụ chăm sóc hoa lan theo đúng quy trình gói dịch vụ đã chọn, bao gồm tưới nước, bón phân, điều chỉnh ánh sáng, phòng trừ sâu bệnh và các kỹ thuật chuyên sâu theo từng dòng lan.',
              'Điều 2 – Xác nhận tiếp nhận cây tại địa điểm bàn giao: Bên B (Nhà vườn) xác nhận tiếp nhận cây từ Bên A (Khách hàng) theo đúng hình ảnh chụp ban đầu và kết quả khảo sát qua video call, bao gồm số lượng, loài lan và tình trạng thực tế tại thời điểm bàn giao.',
              'Điều 3 – Trách nhiệm trong quá trình vận chuyển: Nếu xảy ra tình trạng cây bị thất lạc hoặc hư hỏng dẫn đến hậu quả nghiêm trọng trong quá trình vận chuyển giao nhận, Bên B cam kết bồi thường tối đa 100% giá trị khai báo của cây (cây không khai giá: tối đa 2 lần giá gói).',
              'Điều 4 – Trách nhiệm trong quá trình chăm sóc: Trong suốt thời gian chăm sóc tại nhà vườn, nếu cây bị suy yếu nặng, chết hoặc thất lạc do lỗi chăm sóc kỹ thuật, Bên B chịu trách nhiệm bồi thường cho Bên A mức tối đa bằng 100% giá trị khai báo của cây đã thống nhất (cây không khai giá: tối đa 2 lần giá gói).',
              'Điều 5 – Cam kết của Bên A: Bên A cam kết thông tin về cây, chủng loại, số lượng, giá trị khai báo và ảnh chụp ban đầu là hoàn toàn trung thực, chính xác.',
              'Điều 6 – Quyền từ chối nhận cây: Nếu tình trạng thực tế cây khác biệt đáng kể so với ảnh ban đầu hoặc nội dung đã trao đổi qua video call, Bên B có quyền từ chối nhận cây và hủy đơn theo quy trình.',
              'Điều 7 – Báo cáo định kỳ: Bên B có nghĩa vụ gửi báo cáo tình trạng cây định kỳ đúng tần suất thỏa thuận kèm hình ảnh minh chứng cụ thể qua Hệ thống LanCare Hub.',
              'Điều 8 – Giải quyết tranh chấp: Mọi tranh chấp được ưu tiên đối soát, hòa giải dựa trên hình ảnh ban đầu, video call và biên bản bàn giao lưu giữ trên LanCare Hub.',
              'Điều 9 – Hiệu lực hợp đồng: Hợp đồng điện tử có hiệu lực kể từ khi cả hai bên hoàn tất ký xác nhận điện tử trên hệ thống và có giá trị pháp lý theo Luật Giao dịch điện tử số 20/2023/QH15.',
            ];
            const clausesToRender = (contractData.clauses && contractData.clauses.length > 0)
              ? contractData.clauses
              : defaultClauses;

            return (
              <div className="bg-white p-6 sm:p-8 rounded-2xl border border-gray-200 text-[#1E1B2E] space-y-6">
                {/* Header Quốc hiệu & Tiêu ngữ */}
                <div className="text-center pb-6 border-b-2 border-double border-[#6027D2]/30">
                  <h4 className="text-xs font-bold tracking-widest text-[#1E1B2E] uppercase">
                    CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
                  </h4>
                  <p className="text-xs font-semibold text-[#1E1B2E] mt-1">
                    Độc lập – Tự do – Hạnh phúc
                  </p>
                  <div className="w-24 h-0.5 bg-[#6027D2]/40 mx-auto my-2.5" />
                  <h2 className="text-xl font-extrabold text-[#1E1B2E] uppercase mt-3 tracking-wide">
                    HỢP ĐỒNG DỊCH VỤ CHĂM SÓC HOA LAN ĐIỆN TỬ
                  </h2>
                  <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-[#1E1B2E] mt-2 font-medium">
                    <span>Số HĐ: <strong className="font-mono">{agreementNumber}</strong></span>
                    <span>•</span>
                    <span>Mã đơn: <strong className="font-mono">{orderCode}</strong></span>
                    <span>•</span>
                    <span>Ngày lập: <strong>{new Date(agreementDate).toLocaleDateString('vi-VN')}</strong></span>
                  </div>
                </div>

                {/* Căn cứ pháp lý */}
                <div className="text-[11px] text-gray-500 italic space-y-1 bg-gray-50 p-3.5 rounded-xl border border-gray-100">
                  <p>• Căn cứ Bộ luật Dân sự số 91/2015/QH13 ngày 24/11/2015 của Quốc hội Nước CHXHCN Việt Nam;</p>
                  <p>• Căn cứ Luật Giao dịch điện tử số 20/2023/QH15 ngày 22/06/2023 và các văn bản hướng dẫn thi hành;</p>
                  <p>• Căn cứ thỏa thuận tự nguyện và biên bản khảo sát trực tuyến qua video call giữa hai bên trên Nền tảng LanCare Hub;</p>
                  <p className="font-semibold text-gray-700 not-italic pt-1">
                    Hôm nay, hai bên thống nhất ký kết Hợp đồng dịch vụ chăm sóc hoa lan điện tử với các điều khoản chi tiết như sau:
                  </p>
                </div>

                {/* I. THÔNG TIN CÁC BÊN */}
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#6027D2] mb-3 flex items-center gap-1.5">
                    <UserOutlined /> I. THÔNG TIN CÁC BÊN GIAO KẾT
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Bên A */}
                    <div className="p-4 bg-[#F8F6FC] rounded-xl border border-[#ECE7FA]">
                      <span className="text-[10px] font-extrabold text-[#6027D2] uppercase tracking-wider px-2 py-0.5 rounded bg-white border border-[#ECE7FA]">
                        BÊN A (Bên thuê dịch vụ / Khách hàng)
                      </span>
                      <h5 className="font-bold text-sm text-[#1E1B2E] mt-2">{customerName}</h5>
                      <div className="space-y-1 text-xs text-[#4B4764] mt-1.5">
                        <p><span className="text-gray-400">Số điện thoại:</span> {customerPhone}</p>
                        <p><span className="text-gray-400">Địa chỉ:</span> {customerAddress}</p>
                        <p><span className="text-gray-400">Ngày sinh:</span> {customerDob}</p>
                        <p><span className="text-gray-400">Quê quán:</span> {customerOrigin}</p>
                      </div>
                    </div>

                    {/* Bên B */}
                    <div className="p-4 bg-[#F0FDF4] rounded-xl border border-[#DCFCE7]">
                      <span className="text-[10px] font-extrabold text-[#16A34A] uppercase tracking-wider px-2 py-0.5 rounded bg-white border border-[#DCFCE7]">
                        BÊN B (Bên cung cấp dịch vụ / Nhà vườn)
                      </span>
                      <h5 className="font-bold text-sm text-[#1E1B2E] mt-2">{providerName}</h5>
                      <div className="space-y-1 text-xs text-[#4B4764] mt-1.5">
                        <p><span className="text-gray-400">Số điện thoại:</span> {providerPhone}</p>
                        <p><span className="text-gray-400">Địa chỉ vườn:</span> {providerAddress}</p>
                        <p><span className="text-gray-400">Ngày sinh:</span> {providerDob}</p>
                        <p><span className="text-gray-400">Quê quán:</span> {providerOrigin}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* II. THÔNG TIN GÓI DỊCH VỤ */}
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#6027D2] mb-3 flex items-center gap-1.5">
                    <CalendarOutlined /> II. THÔNG TIN GÓI DỊCH VỤ & LỊCH TRÌNH THỰC HIỆN
                  </h4>
                  <div className="bg-[#FAF9FD] rounded-xl border border-[#ECE7FA] p-4 text-xs space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <span className="text-gray-400">Gói dịch vụ:</span>{' '}
                        <strong className="text-[#1E1B2E]">{orderSummary.servicePackageName || 'Chăm sóc hoa lan chuyên sâu'}</strong>
                      </div>
                      <div>
                        <span className="text-gray-400">Thời hạn chăm sóc:</span>{' '}
                        <strong className="text-[#6027D2]">{orderSummary.durationDays || 30} ngày</strong>
                      </div>
                      <div>
                        <span className="text-gray-400">Tần suất gửi báo cáo:</span>{' '}
                        <strong className="text-[#1E1B2E]">Mỗi {orderSummary.reportFrequencyDays || 7} ngày / lần</strong> (kèm ảnh & video hiện trạng)
                      </div>
                      <div>
                        <span className="text-gray-400">Ngày hẹn lấy/tiếp nhận:</span>{' '}
                        <strong className="text-[#1E1B2E]">
                          {orderSummary.scheduledPickupAt ? new Date(orderSummary.scheduledPickupAt).toLocaleDateString('vi-VN') : 'Theo lịch hẹn'}
                        </strong>
                      </div>
                    </div>
                    {orderSummary.pickupAddress && (
                      <div className="pt-2 border-t border-gray-100">
                        <span className="text-gray-400">Địa chỉ giao nhận cây:</span>{' '}
                        <strong className="text-[#1E1B2E]">{orderSummary.pickupAddress}</strong>
                      </div>
                    )}
                  </div>
                </div>

                {/* III. DANH MỤC CÂY & ĐỊNH GIÁ BỒI THƯỜNG */}
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#6027D2] mb-3 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <PictureOutlined /> III. DANH MỤC CÂY GIAO NHẬN & MỨC ĐỀN BÙ
                    </span>
                    <span className="text-[11px] font-semibold text-gray-500 lowercase">
                      ({contractData.plants?.length || 0} chậu cây)
                    </span>
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-[#ECE7FA]">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#6027D2] text-white font-semibold">
                          <th className="py-2.5 px-3 w-12 text-center">STT</th>
                          <th className="py-2.5 px-3">Tên chậu lan</th>
                          <th className="py-2.5 px-3">Giống / Loài</th>
                          <th className="py-2.5 px-3 text-right">Giá trị khai báo</th>
                          <th className="py-2.5 px-3 text-right text-yellow-200">Mức đền tối đa (100%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#ECE7FA]">
                        {contractData.plants?.map((p: any, idx: number) => {
                          const declared = p.declaredValue ? Number(p.declaredValue) : 0;
                          // Mức đền theo luật đền thật của BE (orders/compensation-cap.ts): 100% giá khai; không khai = 2 × giá gói.
                          const comp = p.isValueDeclared && declared > 0
                            ? declared
                            : 2 * Number(pricing.basePricePerPlant || 0);

                          return (
                            <tr key={idx} className="hover:bg-[#F8F6FC] transition-colors">
                              <td className="py-2.5 px-3 text-center text-gray-400 font-medium">#{idx + 1}</td>
                              <td className="py-2.5 px-3 font-semibold text-[#1E1B2E]">
                                {p.name}
                                {p.initialPhotos && p.initialPhotos.length > 0 && (
                                  <div className="mt-1">
                                    <Image
                                      src={p.initialPhotos[0]}
                                      alt={p.name}
                                      width={40}
                                      height={40}
                                      className="rounded-lg object-cover border border-gray-200"
                                    />
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-gray-600 italic">
                                {p.speciesName || 'Chưa định danh'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-medium text-gray-700">
                                {declared > 0 ? `${declared.toLocaleString('vi-VN')} VNĐ` : 'Không khai báo'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-[#DC2626]">
                                {comp > 0 ? `${comp.toLocaleString('vi-VN')} VNĐ` : 'Theo giá gói mặc định'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* IV. CHI PHÍ DỊCH VỤ & BẢO CHỨNG ESCROW */}
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#6027D2] mb-3 flex items-center gap-1.5">
                    <DollarOutlined /> IV. CHI PHÍ DỊCH VỤ & QUY ĐỊNH BẢO CHỨNG THANH TOÁN (ESCROW)
                  </h4>
                  <div className="bg-[#FAF9FD] rounded-xl border border-[#ECE7FA] p-4 text-xs space-y-2">
                    <div className="flex justify-between items-center py-1">
                      <span className="text-gray-500">Phí dịch vụ chăm sóc:</span>
                      <span className="font-semibold text-gray-800">
                        {Number(pricing.provisionalTotal || contractData.provisionalTotal || 0).toLocaleString('vi-VN')} VNĐ
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-gray-500">Phí vận chuyển giao nhận:</span>
                      <span className="font-semibold text-gray-800">
                        {Number(pricing.pickupFee || contractData.pickupFeeSnapshot || 0).toLocaleString('vi-VN')} VNĐ
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-t border-dashed border-[#ECE7FA] text-sm">
                      <span className="font-bold text-[#1E1B2E]">TỔNG GIÁ TRỊ HỢP ĐỒNG:</span>
                      <span className="font-extrabold text-[#6027D2] text-base">
                        {Number(
                          pricing.grandTotal ||
                          (Number(pricing.provisionalTotal || contractData.provisionalTotal || 0) +
                           Number(pricing.pickupFee || contractData.pickupFeeSnapshot || 0))
                        ).toLocaleString('vi-VN')}{' '}
                        VNĐ
                      </span>
                    </div>
                    <div className="p-2.5 bg-blue-50/70 rounded-lg border border-blue-100 text-[11px] text-blue-800 flex items-start gap-2 mt-2">
                      <SafetyCertificateFilled className="text-blue-600 mt-0.5 text-xs flex-shrink-0" />
                      <span>
                        <strong>Cơ chế bảo vệ LanCare Escrow:</strong> Toàn bộ chi phí dịch vụ được tạm giữ an toàn trong tài khoản trung gian của LanCare Hub. Nhà vườn chỉ được giải ngân sau khi hoàn tất quy trình bàn giao cây và Khách hàng đã kiểm tra, ký xác nhận nghiệm thu đạt yêu cầu.
                      </span>
                    </div>
                  </div>
                </div>

                {/* V. CHÍNH SÁCH BỒI THƯỜNG 100% */}
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#6027D2] mb-3 flex items-center gap-1.5">
                    <SafetyCertificateFilled /> V. CHÍNH SÁCH BỒI THƯỜNG THIỆT HẠI (TỐI ĐA 100%)
                  </h4>
                  <div className="p-4 bg-[#FAF8FE] border border-[#ECE7FA] rounded-xl space-y-3">
                    <p className="text-xs text-[#1E1B2E] font-semibold">
                      Mức bồi thường: <span className="text-[#6027D2]">tối đa 100% giá trị khai báo của cây</span> (cây không khai giá: tối đa 2 lần giá gói), đã được hai bên thống nhất tại thời điểm ký hợp đồng.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-[#4B4764]">
                      <div className="bg-white p-3 rounded-lg border border-[#ECE7FA]">
                        <p className="font-bold text-[#1E1B2E] mb-1">Trong quá trình chăm sóc:</p>
                        <ul className="list-disc list-inside space-y-0.5 text-[11.5px]">
                          <li>Cây suy yếu nghiêm trọng so với biên bản bàn giao ban đầu</li>
                          <li>Cây chết do lỗi kỹ thuật chăm sóc của Nhà vườn</li>
                          <li>Cây bị thất lạc trong thời gian lưu giữ tại vườn</li>
                        </ul>
                      </div>
                      <div className="bg-white p-3 rounded-lg border border-[#ECE7FA]">
                        <p className="font-bold text-[#1E1B2E] mb-1">Trong quá trình vận chuyển:</p>
                        <ul className="list-disc list-inside space-y-0.5 text-[11.5px]">
                          <li>Cây bị dập gãy ngọn, hư hỏng nặng khi giao nhận</li>
                          <li>Cây bị thất lạc trong quá trình vận chuyển</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                {/* VI. ĐIỀU KHOẢN HỢP ĐỒNG */}
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#6027D2] mb-3 flex items-center gap-1.5">
                    <AuditOutlined /> VI. CÁC ĐIỀU KHOẢN THỎA THUẬN CHUNG
                  </h4>
                  <div className="space-y-2.5 bg-gray-50/70 p-4 rounded-xl border border-gray-100 text-xs text-gray-700 leading-relaxed">
                    {clausesToRender.map((clause: string, cIdx: number) => (
                      <p key={cIdx} className="text-[11.5px]">
                        <strong>{clause.split(':')[0]}:</strong>{clause.includes(':') ? clause.substring(clause.indexOf(':') + 1) : clause}
                      </p>
                    ))}
                  </div>
                </div>

                {/* VII. CHỮ KÝ ĐIỆN TỬ */}
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#6027D2] mb-3 flex items-center gap-1.5">
                    <FormOutlined /> VII. XÁC NHẬN CHỮ KÝ ĐIỆN TỬ CỦA HAI BÊN
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-center">
                    {/* Chữ ký Bên A */}
                    <div className={`p-4 rounded-xl border-2 transition-all ${
                      isCustomerSigned ? 'bg-[#F0FDF4] border-[#16A34A]/50' : 'bg-gray-50 border-gray-200'
                    }`}>
                      <p className="text-xs font-bold text-[#6027D2] uppercase tracking-wider">ĐẠI DIỆN BÊN A (KHÁCH HÀNG)</p>
                      <p className="text-sm font-semibold text-[#1E1B2E] mt-2 mb-3">
                        {customerSig?.signerName || customerName}
                      </p>
                      {isCustomerSigned ? (
                        <div className="space-y-1">
                          <Tag color="green" className="font-extrabold px-3 py-1 text-xs uppercase tracking-wide">
                            ✓ ĐÃ KÝ ĐIỆN TỬ
                          </Tag>
                          <p className="text-[10px] text-gray-400 mt-1">
                            Ký lúc: {customerSig?.signedAt ? new Date(customerSig.signedAt).toLocaleString('vi-VN') : 'Đã ghi nhận'}
                          </p>
                        </div>
                      ) : (
                        <Tag color="default" className="text-xs italic py-0.5">
                          Đang chờ Bên A ký điện tử
                        </Tag>
                      )}
                    </div>

                    {/* Chữ ký Bên B */}
                    <div className={`p-4 rounded-xl border-2 transition-all ${
                      isProviderSigned ? 'bg-[#F0FDF4] border-[#16A34A]/50' : 'bg-gray-50 border-gray-200'
                    }`}>
                      <p className="text-xs font-bold text-[#16A34A] uppercase tracking-wider">ĐẠI DIỆN BÊN B (NHÀ VƯỜN)</p>
                      <p className="text-sm font-semibold text-[#1E1B2E] mt-2 mb-3">
                        {providerSig?.signerName || providerName}
                      </p>
                      {isProviderSigned ? (
                        <div className="space-y-1">
                          <Tag color="green" className="font-extrabold px-3 py-1 text-xs uppercase tracking-wide">
                            ✓ ĐÃ KÝ ĐIỆN TỬ
                          </Tag>
                          <p className="text-[10px] text-gray-400 mt-1">
                            {providerSig?.signedAt
                              ? `Ký lúc: ${new Date(providerSig.signedAt).toLocaleString('vi-VN')}`
                              : 'Đã ký hợp đồng điện tử'}
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

                <div className="text-center pt-2 text-[11px] text-gray-400 border-t border-gray-100">
                  Hợp đồng điện tử này được tạo lập và bảo chứng an toàn bởi Hệ thống LanCare Hub theo quy định của pháp luật Việt Nam.
                </div>
              </div>
            );
          })()
        ) : null}
      </Modal>

      {/* Sign Confirmation Modal */}
      <Modal
        title={
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#F6F4FC] flex items-center justify-center text-[#6027D2] text-xl flex-shrink-0">
              <FormOutlined />
            </div>
            <div>
              <h4 className="text-base font-extrabold text-[#1E1B2E] leading-tight">
                Xác nhận Ký Hợp đồng Dịch vụ
              </h4>
              <p className="text-xs text-[#6E6A8A] font-normal mt-0.5">
                Ký kết điện tử dịch vụ chăm sóc hoa lan LanCare
              </p>
            </div>
          </div>
        }
        open={signConfirmModalOpen}
        onCancel={() => {
          if (actionLoading === null) setSignConfirmModalOpen(false);
        }}
        width={520}
        centered
        footer={
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              onClick={() => setSignConfirmModalOpen(false)}
              disabled={actionLoading !== null}
              className="!rounded-xl"
            >
              Hủy / Xem lại
            </Button>
            <Button
              type="primary"
              loading={actionLoading === orderToSign?.id}
              disabled={!hasAgreedTerms}
              onClick={handleConfirmSignAgreement}
              className="!rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold text-white shadow-md shadow-[#6027D2]/30"
            >
              Xác nhận & Ký điện tử ngay
            </Button>
          </div>
        }
      >
        <div className="py-2 space-y-4 text-xs text-[#4B4764]">
          <div className="p-3 bg-[#F8F6FC] rounded-xl border border-[#ECE7FA] flex items-center justify-between">
            <div>
              <span className="text-[11px] text-gray-400">Mã đơn hàng:</span>
              <p className="font-bold text-sm text-[#1E1B2E] font-mono">
                {orderToSign?.orderCode || 'N/A'}
              </p>
            </div>
            {orderToSign?.agreementNo && (
              <div className="text-right">
                <span className="text-[11px] text-gray-400">Số hợp đồng:</span>
                <p className="font-bold text-xs text-[#6027D2] font-mono">
                  {orderToSign.agreementNo}
                </p>
              </div>
            )}
          </div>

          <div className="p-3.5 bg-amber-50/80 rounded-xl border border-amber-200 text-amber-900 space-y-1.5 leading-relaxed">
            <p className="font-bold text-xs flex items-center gap-1.5 text-amber-800">
              <SafetyCertificateFilled className="text-amber-600" /> Cam kết và Trách nhiệm pháp lý:
            </p>
            <p className="text-[11.5px]">
              • Nhà vườn xác nhận đã đọc, hiểu rõ và đồng thuận thực hiện đúng quy trình chăm sóc kỹ thuật, nộp báo cáo định kỳ đúng hạn.
            </p>
            <p className="text-[11.5px]">
              • Cam kết chịu trách nhiệm bồi thường tối đa <strong>100% giá trị khai báo</strong> của cây (cây không khai giá: tối đa 2 lần giá gói) nếu phát sinh hư hại do lỗi chăm sóc theo điều khoản hợp đồng.
            </p>
            <p className="text-[11px] text-amber-700 italic pt-1">
              * Chữ ký điện tử này có hiệu lực pháp lý ràng buộc theo quy định của Luật Giao dịch điện tử số 20/2023/QH15.
            </p>
          </div>

          <div className="pt-2">
            <Checkbox
              checked={hasAgreedTerms}
              onChange={(e) => setHasAgreedTerms(e.target.checked)}
              className="text-xs text-[#1E1B2E] font-medium leading-normal"
            >
              Tôi xác nhận là đại diện Nhà vườn, đã đọc kỹ toàn bộ điều khoản và đồng ý ký kết hợp đồng dịch vụ điện tử này.
            </Checkbox>
          </div>
        </div>
      </Modal>

      {/* Return Handover Assessment Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-[#1E1B2E]">
            <AuditOutlined className="text-[#6027D2]" />
            <span>
              Ghi nhận & Bàn giao trả cây{' '}
              {returnOrder?.orderCode ? `- ${returnOrder.orderCode}` : ''}
            </span>
          </div>
        }
        open={returnModalOpen}
        onCancel={() => setReturnModalOpen(false)}
        footer={
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Button
              onClick={() => setReturnModalOpen(false)}
              className="!rounded-xl"
            >
              Đóng
            </Button>
            <Button
              type="primary"
              loading={completingReturn}
              onClick={handleCompleteReturn}
              className="!rounded-xl !bg-[#10B981] hover:!bg-[#059669] !font-semibold text-white"
            >
              Hoàn tất bàn giao trả cây
            </Button>
          </div>
        }
        width={760}
      >
        {returnLoading ? (
          <div className="py-12 text-center">
            <Spin size="large" />
            <p className="mt-3 text-xs text-[#6E6A8A]">Đang tải danh sách cây đang chăm...</p>
          </div>
        ) : returnOrder ? (
          <div className="space-y-4 max-h-[72vh] overflow-y-auto pr-1 pt-2">
            <div className="p-3 rounded-xl bg-[#F6F4FC] border border-[#ECE7FA] text-xs text-[#4B4764]">
              Ghi nhận tình trạng thực tế và tải ít nhất 1 ảnh cho mỗi chậu cây đang chăm trước khi bấm <strong>Hoàn tất bàn giao trả cây</strong>.
            </div>

            {(returnOrder.plants || [])
              .filter((p: any) => p.handoverDecision !== 'REJECT')
              .map((plant: any, idx: number) => {
                const form = returnPlantForms[plant.id] || {
                  leafCondition: 'Tốt',
                  rootCondition: 'Chắc khỏe',
                  hasPest: false,
                  note: '',
                  photoUrl: '',
                  saved: false,
                };

                return (
                  <div
                    key={plant.id}
                    className="p-4 rounded-2xl border border-[#ECE7FA] bg-white space-y-3"
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <p className="font-bold text-sm text-[#1E1B2E]">
                          #{idx + 1}. {plant.name}
                        </p>
                        {plant.speciesName && (
                          <p className="text-xs text-[#6E6A8A]">Giống: {plant.speciesName}</p>
                        )}
                      </div>
                      {form.saved ? (
                        <Tag color="green">Đã lưu tình trạng trả</Tag>
                      ) : (
                        <Tag color="orange">Chưa lưu</Tag>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#4B4764] mb-1">
                          Tình trạng lá:
                        </label>
                        <Input
                          value={form.leafCondition}
                          onChange={(e) =>
                            setReturnPlantForms((prev) => ({
                              ...prev,
                              [plant.id]: { ...prev[plant.id], leafCondition: e.target.value, saved: false },
                            }))
                          }
                          placeholder="VD: Xanh tốt"
                          className="!rounded-xl text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#4B4764] mb-1">
                          Tình trạng rễ:
                        </label>
                        <Input
                          value={form.rootCondition}
                          onChange={(e) =>
                            setReturnPlantForms((prev) => ({
                              ...prev,
                              [plant.id]: { ...prev[plant.id], rootCondition: e.target.value, saved: false },
                            }))
                          }
                          placeholder="VD: Chắc khỏe"
                          className="!rounded-xl text-xs"
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        <Checkbox
                          checked={form.hasPest}
                          onChange={(e) =>
                            setReturnPlantForms((prev) => ({
                              ...prev,
                              [plant.id]: { ...prev[plant.id], hasPest: e.target.checked, saved: false },
                            }))
                          }
                          className="text-xs font-semibold text-[#4B4764]"
                        >
                          Có dấu hiệu sâu bệnh
                        </Checkbox>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#4B4764] mb-1.5">
                        Ảnh chụp tình trạng lúc trả (bắt buộc):
                      </label>
                      {form.photoUrl ? (
                        <div className="flex items-center gap-3 flex-wrap">
                          <Image
                            src={form.photoUrl}
                            alt="Ảnh trả cây"
                            width={84}
                            height={84}
                            className="rounded-xl object-cover border border-[#ECE7FA]"
                            fallback="https://placehold.co/84x84?text=Ảnh+lỗi"
                          />
                          <div className="flex items-center gap-2">
                            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#DDD6FE] text-xs font-semibold text-[#6027D2] hover:bg-[#EDE9FE]">
                              {uploadingReturnPlantId === plant.id ? <Spin size="small" /> : <UploadOutlined />}
                              <span>Đổi ảnh khác</span>
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                style={{ display: 'none' }}
                                onChange={(e) => handleUploadReturnPhoto(plant.id, e.target.files?.[0])}
                              />
                            </label>
                            <Button
                              size="small"
                              danger
                              onClick={() =>
                                setReturnPlantForms((prev) => ({
                                  ...prev,
                                  [plant.id]: { ...prev[plant.id], photoUrl: '', saved: false },
                                }))
                              }
                            >
                              Xóa ảnh
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-dashed border-[#C4B5FD] text-xs font-semibold text-[#6027D2] hover:bg-[#F5F3FF]">
                          {uploadingReturnPlantId === plant.id ? <Spin size="small" /> : <UploadOutlined />}
                          <span>Chọn & tải ảnh trả cây lên</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            style={{ display: 'none' }}
                            onChange={(e) => handleUploadReturnPhoto(plant.id, e.target.files?.[0])}
                          />
                        </label>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#4B4764] mb-1">
                        Ghi chú bàn giao trả (tuỳ chọn):
                      </label>
                      <Input.TextArea
                        rows={2}
                        value={form.note}
                        onChange={(e) =>
                          setReturnPlantForms((prev) => ({
                            ...prev,
                            [plant.id]: { ...prev[plant.id], note: e.target.value, saved: false },
                          }))
                        }
                        placeholder="VD: Cây khỏe mạnh, đã ra thêm ngồng hoa mới..."
                        className="!rounded-xl text-xs"
                      />
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="primary"
                        size="small"
                        loading={savingReturnPlantId === plant.id}
                        onClick={() => handleSaveReturnPlantAssessment(plant.id)}
                        className="!rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold text-xs"
                      >
                        Lưu tình trạng trả cây này
                      </Button>
                    </div>
                  </div>
                );
              })}

            {/* Hủy phiên trả để hẹn lại */}
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
              <p className="text-xs font-bold text-amber-800">
                Khách vắng nhà hoặc chưa giao trả được?
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={cancelReturnReason}
                  onChange={(e) => setCancelReturnReason(e.target.value)}
                  placeholder="Nhập lý do hủy phiên trả để hẹn lại..."
                  className="!rounded-xl text-xs bg-white"
                />
                <Button
                  danger
                  loading={cancellingReturn}
                  onClick={handleCancelReturn}
                  className="!rounded-xl text-xs font-semibold shrink-0"
                >
                  Hủy phiên trả
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Dispute Room Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <ExclamationCircleOutlined className="text-rose-600 text-lg" />
            <span className="font-bold text-[#1E1B2E]">Hồ sơ tranh chấp — Đơn #{disputeOrder?.orderCode || '---'}</span>
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
                      Kết quả: <strong>{disputeDetail.outcome === 'AGREED' ? 'Hai bên đã thống nhất đề xuất' : disputeDetail.outcome === 'WITHDRAWN' ? 'Khách hàng đã rút khiếu nại' : 'Admin đã ra quyết định'}</strong>
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

      {/* Addon Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2.5">
            <AppstoreAddOutlined className="text-[#6027D2] text-lg" />
            <span className="font-bold text-[#1E1B2E]">
              Dịch vụ phát sinh (Add-on) — Đơn #{addonOrder?.orderCode || '---'}
            </span>
          </div>
        }
        open={addonModalOpen}
        onCancel={() => {
          if (!addonSubmitting) setAddonModalOpen(false);
        }}
        footer={null}
        width={760}
        centered
      >
        <div className="space-y-5 pt-2">
          {/* List of existing addons */}
          <div>
            <h5 className="text-xs font-bold uppercase tracking-wider text-[#6E6A8A] mb-2.5">
              Danh sách đề xuất dịch vụ phát sinh ({addons.length})
            </h5>

            {addonsLoading ? (
              <div className="py-8 text-center">
                <Spin size="small" />
              </div>
            ) : addons.length === 0 ? (
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 text-xs text-gray-500 text-center">
                Đơn hàng này chưa có đề xuất dịch vụ phát sinh nào.
              </div>
            ) : (
              <div className="space-y-3.5 max-h-80 overflow-y-auto pr-1">
                {addons.map((ad) => {
                  const statusMap: Record<string, { color: string; label: string }> = {
                    PENDING: { color: 'gold', label: 'Chờ khách duyệt (48h)' },
                    ACCEPTED: { color: 'blue', label: 'Khách đã duyệt - Chờ thanh toán' },
                    PAID: { color: 'purple', label: 'Khách đã thanh toán - Sẵn sàng làm' },
                    DONE: { color: 'green', label: 'Đã hoàn thành' },
                    REJECTED: { color: 'red', label: 'Khách từ chối' },
                    EXPIRED: { color: 'default', label: 'Đã hết hạn' },
                    REFUNDED: { color: 'blue', label: 'Đã trả lại khách' },
                  };
                  const st = statusMap[ad.status] || { color: 'default', label: ad.status };

                  return (
                    <div
                      key={ad.id}
                      className="p-3.5 rounded-2xl border border-[#ECE7FA] bg-[#FAF8FE] space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-[#1E1B2E]">{ad.title}</span>
                            <span className="font-mono text-[11px] text-[#6027D2] font-semibold">
                              #{ad.addonCode}
                            </span>
                            <Tag color={st.color} className="!rounded-md text-[11px]">
                              {st.label}
                            </Tag>
                          </div>
                          <p className="text-[11.5px] text-[#8B86A4] mt-0.5">
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
                          <span className="text-sm font-extrabold text-[#4E1BA8]">
                            {Number(ad.amountDue || ad.price).toLocaleString('vi-VN')} VNĐ
                          </span>
                          <span className="text-[10px] text-[#8B86A4] block">
                            (Gốc: {Number(ad.price).toLocaleString('vi-VN')} đ + 6% phí)
                          </span>
                        </div>
                      </div>

                      {/* Reason & Photos */}
                      <div className="p-2.5 rounded-xl bg-white border border-[#ECE7FA] text-xs space-y-1.5">
                        <p className="text-[#4B4764] whitespace-pre-wrap leading-relaxed">
                          <strong>Lý do phát sinh:</strong> {ad.reason}
                        </p>
                        {Array.isArray(ad.photoUrls) && ad.photoUrls.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {ad.photoUrls.map((url, idx) => (
                              <Image
                                key={`${ad.id}-photo-${idx}`}
                                src={url}
                                alt="Ảnh phát sinh"
                                width={60}
                                height={60}
                                className="rounded-lg object-cover border border-gray-200"
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Customer feedback if rejected */}
                      {ad.customerNote && (
                        <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                          <strong>Ghi chú từ khách hàng:</strong> {ad.customerNote}
                        </div>
                      )}

                      {/* Vườn đã trả lại add-on: khách được hoàn giá + 6% */}
                      {ad.status === 'REFUNDED' && (
                        <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 space-y-1">
                          <p className="font-bold">
                            Đã trả lại khách · hoàn {Number(ad.amountDue || 0).toLocaleString('vi-VN')} đ
                          </p>
                          {ad.refundReason && (
                            <p>
                              <strong>Lý do:</strong> {ad.refundReason}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Done section if completed */}
                      {ad.status === 'DONE' && (
                        <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1.5">
                          <div className="flex items-center justify-between gap-1.5 flex-wrap">
                            <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                              <CheckCircleOutlined />
                              <span>Đã hoàn tất dịch vụ thêm</span>
                            </div>
                            {ad.donePlantHealth && (
                              <div className="flex items-center gap-1">
                                <span className="text-[11px] text-emerald-800 font-semibold">Tình trạng cây:</span>
                                <Tag
                                  color={
                                    ad.donePlantHealth === 'GOOD'
                                      ? 'green'
                                      : ad.donePlantHealth === 'AVERAGE'
                                      ? 'gold'
                                      : 'red'
                                  }
                                  className="!m-0 !text-[11px]"
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
                          {ad.doneNote && <p className="text-xs text-emerald-800">{ad.doneNote}</p>}
                          {Array.isArray(ad.donePhotoUrls) && ad.donePhotoUrls.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {ad.donePhotoUrls.map((url, idx) => (
                                <Image
                                  key={`${ad.id}-done-${idx}`}
                                  src={url}
                                  alt="Ảnh hoàn thành"
                                  width={60}
                                  height={60}
                                  className="rounded-lg object-cover border border-emerald-200"
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Action for PAID status: Mark Complete */}
                      {ad.status === 'PAID' && (
                        <div className="flex justify-end pt-1">
                          <Button
                            type="primary"
                            icon={<CheckCircleOutlined />}
                            onClick={() => handleOpenCompleteModal(ad)}
                            className="!h-8 !px-3.5 !rounded-xl !bg-[#059669] hover:!bg-[#047857] !border-none !font-semibold text-xs text-white"
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

          {/* Create new addon form when IN_CARE */}
          {addonOrder && addonOrder.status === 'IN_CARE' && (
            <div className="pt-4 border-t border-gray-100 space-y-3.5">
              <h5 className="text-xs font-bold uppercase tracking-wider text-[#6027D2] flex items-center gap-1.5">
                <ToolOutlined /> Tạo đề xuất dịch vụ phát sinh mới
              </h5>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1E1B2E] mb-1">
                    Cây cần áp dụng
                  </label>
                  <Select
                    value={addonPlantId || 'ALL'}
                    onChange={(val) => setAddonPlantId(val === 'ALL' ? undefined : val)}
                    className="w-full"
                    options={[
                      { value: 'ALL', label: 'Toàn bộ đơn hàng' },
                      ...(addonOrder.plants || []).map((p, idx) => ({
                        value: p.id,
                        label: `Chậu #${idx + 1}: ${p.name || 'Cây lan'}`,
                      })),
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1E1B2E] mb-1">
                    Tiêu đề dịch vụ <span className="text-red-500">*</span>
                  </label>
                  <Input
                    maxLength={120}
                    placeholder="Ví dụ: Thay giá thể dớn mới, Phun thuốc trị rệp sáp..."
                    value={addonTitle}
                    onChange={(e) => setAddonTitle(e.target.value)}
                    className="!rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1E1B2E] mb-1">
                  Lý do đề xuất dịch vụ <span className="text-red-500">*</span>
                </label>
                <Input.TextArea
                  rows={2}
                  maxLength={2000}
                  placeholder="Mô tả hiện trạng thực tế phát sinh và lý do cần thực hiện..."
                  value={addonReason}
                  onChange={(e) => setAddonReason(e.target.value)}
                  className="!rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1E1B2E] mb-1">
                  Giá dịch vụ đề xuất (VNĐ) <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  min={1000}
                  max={50000000}
                  placeholder="Từ 1.000 đến 50.000.000 VNĐ"
                  value={addonPrice}
                  onChange={(e) => setAddonPrice(e.target.value)}
                  className="!rounded-xl"
                  addonAfter="VNĐ"
                />
                <span className="text-[11px] text-[#8B86A4] mt-1 block">
                  Lưu ý: Khách hàng sẽ thanh toán thêm 6% phí dịch vụ nền tảng trên số tiền này.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1E1B2E] mb-1">
                  Ảnh minh chứng hiện trạng (tối thiểu 1 ảnh, tối đa 5 ảnh){' '}
                  <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {addonPhotoUrls.map((url, idx) => (
                    <div key={`addon-new-${idx}`} className="relative">
                      <Image
                        src={url}
                        alt="Ảnh minh chứng"
                        width={64}
                        height={64}
                        className="rounded-lg object-cover border border-gray-200"
                      />
                      <button
                        type="button"
                        onClick={() => setAddonPhotoUrls((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {addonPhotoUrls.length < 5 && (
                    <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-[#6027D2] text-[#6027D2] text-xs font-semibold cursor-pointer hover:bg-[#F8F6FC]">
                      <UploadOutlined />
                      <span>{addonUploading ? 'Đang tải...' : 'Tải ảnh minh chứng'}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={addonUploading}
                        onChange={handleUploadAddonPhoto}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button onClick={() => setAddonModalOpen(false)} disabled={addonSubmitting}>
                  Đóng
                </Button>
                <Button
                  type="primary"
                  loading={addonSubmitting}
                  onClick={handleCreateAddon}
                  className="!rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold text-white"
                >
                  Gửi đề xuất cho khách hàng
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Complete Addon Modal */}
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
        width={560}
        centered
      >
        <div className="space-y-4 pt-2">
          <p className="text-xs text-[#4B4764]">
            Tải lên ảnh kết quả sau khi thực hiện dịch vụ thêm để làm bằng chứng nghiệm thu gửi cho khách hàng.
          </p>

          <div>
            <label className="block text-xs font-semibold text-[#1E1B2E] mb-1">
              Mô tả công việc đã làm <span className="text-red-500">* (tối thiểu 10 ký tự)</span>
            </label>
            <Input.TextArea
              rows={3}
              maxLength={1000}
              showCount
              placeholder="Ví dụ: Đã thay dớn mới, cắt tỉa và xử lý rễ úng, bổ sung phân tan chậm kích rễ..."
              value={completeNote}
              onChange={(e) => setCompleteNote(e.target.value)}
              className="!rounded-xl"
            />
          </div>

          {selectedAddonForComplete?.plant && (
            <div className="p-3 rounded-xl bg-purple-50/70 border border-purple-100 space-y-2">
              <label className="block text-xs font-semibold text-[#1E1B2E]">
                Tình trạng cây sau khi hoàn thành <span className="text-red-500">*</span>
                <span className="text-purple-700 font-normal ml-1">
                  ({selectedAddonForComplete.plant.name || 'Cây trong đề xuất'})
                </span>
              </label>
              <Radio.Group
                value={completePlantHealth}
                onChange={(e) => setCompletePlantHealth(e.target.value)}
                className="w-full flex gap-2 sm:gap-4"
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
            <label className="block text-xs font-semibold text-[#1E1B2E] mb-1">
              Ảnh sau khi thực hiện (tối thiểu 1 ảnh, tối đa 5 ảnh){' '}
              <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {completePhotoUrls.map((url, idx) => (
                <div key={`comp-new-${idx}`} className="relative">
                  <Image
                    src={url}
                    alt="Ảnh nghiệm thu"
                    width={64}
                    height={64}
                    className="rounded-lg object-cover border border-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => setCompletePhotoUrls((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow"
                  >
                    ×
                  </button>
                </div>
              ))}
              {completePhotoUrls.length < 5 && (
                <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-emerald-600 text-emerald-700 text-xs font-semibold cursor-pointer hover:bg-emerald-50">
                  <UploadOutlined />
                  <span>{completeUploading ? 'Đang tải...' : 'Tải ảnh kết quả'}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={completeUploading}
                    onChange={handleUploadCompletePhoto}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <Button onClick={() => setCompleteModalOpen(false)} disabled={completeSubmitting}>
              Hủy
            </Button>
            <Button
              type="primary"
              loading={completeSubmitting}
              onClick={handleSubmitCompleteAddon}
              className="!rounded-xl !bg-[#059669] hover:!bg-[#047857] !border-none !font-semibold text-white"
            >
              Xác nhận hoàn thành
            </Button>
          </div>
        </div>
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
