import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  AddonItem,
  AddonPaymentQrResponse,
  AddonStatus,
  DisputeDetail,
  DisputeReason,
  OrderDisputeItem,
  OrderItem,
  orderService,
} from '../services/orderService';
import { customerService } from '../services/customerService';
import { uploadService } from '../services/uploadService';
import {
  CareEvidenceType,
  CareReportItem,
  OverallHealth,
  PartCondition,
  SubstrateMoisture,
  careReportService,
} from '../services/careReportService';
import { providerService } from '../services/providerService';
import { calculateRoadDistanceKm } from '../utils/distance';
import { CustomerCancelSection } from '../components/order/CustomerCancelSection';
import { CancelledOrderCard } from '../components/order/CancelledOrderCard';
import { DisputeResultCard } from '../components/order/DisputeResultCard';
import { SettlementCard, isSettlementShown } from '../components/order/SettlementCard';
import { customerFeeFor, formatVnd, toNumber } from '../components/order/orderMoney';
import {
  videoCallService,
  VideoCallResponseDto,
  CALLABLE_ORDER_STATUSES,
} from '../services/videoCallService';

interface OrderDetailScreenProps {
  navigation: any;
  route: {
    params: {
      orderId: string;
    };
  };
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: 'Đơn nháp', color: '#718096', bg: '#EDF2F7' },
  PENDING_PROVIDER: { label: 'Chờ nhà vườn duyệt', color: '#D69E2E', bg: '#FEFCBF' },
  AGREEMENT_PENDING: { label: 'Chờ ký hợp đồng', color: '#DD6B20', bg: '#FEEBC8' },
  AWAITING_PAYMENT: { label: 'Chờ thanh toán', color: '#3182CE', bg: '#EBF8FF' },
  PAID: { label: 'Đã thanh toán', color: '#38A169', bg: '#C6F6D5' },
  HANDOVER_IN_PROGRESS: { label: 'Đang bàn giao', color: '#805AD5', bg: '#E9D8FD' },
  HANDOVER_AWAITING_CONFIRM: { label: 'Chờ xác nhận bàn giao', color: '#D97706', bg: '#FEF3C7' },
  IN_CARE: { label: 'Đang chăm sóc', color: '#6027D2', bg: '#F3E8FF' },
  RETURN_IN_PROGRESS: { label: 'Đang bàn giao trả cây', color: '#805AD5', bg: '#E9D8FD' },
  RETURN_AWAITING_CONFIRM: { label: 'Chờ nghiệm thu cây', color: '#D97706', bg: '#FEF3C7' },
  COMPLETED: { label: 'Hoàn thành', color: '#2F855A', bg: '#C6F6D5' },
  REJECTED: { label: 'Nhà vườn từ chối', color: '#E53E3E', bg: '#FED7D7' },
  EXPIRED: { label: 'Quá hạn phản hồi', color: '#718096', bg: '#EDF2F7' },
  CANCELLED: { label: 'Đã hủy', color: '#A0AEC0', bg: '#E2E8F0' },
  DISPUTED: { label: 'Đang tranh chấp', color: '#C53030', bg: '#FED7D7' },
};

const CALL_END_REASON_MAP: Record<string, { label: string; color: string; bg: string }> = {
  COMPLETED: { label: 'Thành công', color: '#10B981', bg: '#D1FAE5' },
  MISSED: { label: 'Cuộc gọi nhỡ', color: '#F59E0B', bg: '#FEF3C7' },
  DECLINED: { label: 'Đã từ chối', color: '#EF4444', bg: '#FEE2E2' },
  CANCELLED: { label: 'Đã hủy', color: '#6B7280', bg: '#F3F4F6' },
  TIMEOUT: { label: 'Hết giờ', color: '#D97706', bg: '#FEF3C7' },
  DROPPED: { label: 'Mất kết nối', color: '#6B7280', bg: '#F3F4F6' },
};

export const OrderDetailScreen: React.FC<OrderDetailScreenProps> = ({
  navigation,
  route,
}) => {
  const { orderId } = route.params;

  const [order, setOrder] = useState<OrderItem | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Video call state
  const [callLoading, setCallLoading] = useState<boolean>(false);
  const [activeCall, setActiveCall] = useState<VideoCallResponseDto | null>(null);
  const [callHistory, setCallHistory] = useState<VideoCallResponseDto[]>([]);

  // Contract Modal state
  const [contractModalVisible, setContractModalVisible] = useState<boolean>(false);
  const [contractLoading, setContractLoading] = useState<boolean>(false);
  const [contractData, setContractData] = useState<any | null>(null);
  const [signingLoading, setSigningLoading] = useState<boolean>(false);

  // Sign Confirmation Modal state
  const [signConfirmModalVisible, setSignConfirmModalVisible] = useState<boolean>(false);
  const [customerAgreedTerms, setCustomerAgreedTerms] = useState<boolean>(false);

  // Payment Modal state
  const [paymentModalVisible, setPaymentModalVisible] = useState<boolean>(false);
  const [paymentLoading, setPaymentLoading] = useState<boolean>(false);
  const [paymentQrData, setPaymentQrData] = useState<any | null>(null);
  const [checkingPayment, setCheckingPayment] = useState<boolean>(false);

  // Handover confirmation state
  const [confirmingHandover, setConfirmingHandover] = useState<boolean>(false);
  const [confirmingReturn, setConfirmingReturn] = useState<boolean>(false);

  // Provider coordinates for transparent distance calculation
  const [providerCoords, setProviderCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Care reports v2 (2-tier)
  const [careReports, setCareReports] = useState<CareReportItem[]>([]);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'care' | 'addons' | 'support'>('overview');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Addons state (Dịch vụ thêm ngoài gói)
  const [addons, setAddons] = useState<AddonItem[]>([]);
  const [addonPaymentModalVisible, setAddonPaymentModalVisible] = useState<boolean>(false);
  const [addonQrLoading, setAddonQrLoading] = useState<boolean>(false);
  const [selectedAddonQr, setSelectedAddonQr] = useState<AddonPaymentQrResponse | null>(null);
  const [selectedAddonForPayment, setSelectedAddonForPayment] = useState<AddonItem | null>(null);
  const [checkingAddonPayment, setCheckingAddonPayment] = useState<boolean>(false);
  const [respondingAddonId, setRespondingAddonId] = useState<string | null>(null);
  const [addonNotes, setAddonNotes] = useState<Record<string, string>>({});

  // Dispute state (PR #37 Dispute Room & Open Dispute)
  const [disputeRoomVisible, setDisputeRoomVisible] = useState<boolean>(false);
  const [openDisputeModalVisible, setOpenDisputeModalVisible] = useState<boolean>(false);
  const [disputeDetail, setDisputeDetail] = useState<DisputeDetail | null>(null);
  const [disputeLoading, setDisputeLoading] = useState<boolean>(false);
  const [selectedDisputePlantIds, setSelectedDisputePlantIds] = useState<string[]>([]);
  const [disputeReasonText, setDisputeReasonText] = useState<string>('Cây bị hư hại sau khi chăm sóc');
  const [disputeDescription, setDisputeDescription] = useState<string>('');
  const [disputeEvidence, setDisputeEvidence] = useState<Array<{ photoUrl: string; caption?: string; plantId?: string }>>([]);
  const [disputeSubmitting, setDisputeSubmitting] = useState<boolean>(false);
  const [disputeUploading, setDisputeUploading] = useState<boolean>(false);
  const [offerRefund, setOfferRefund] = useState<string>('');
  const [offerCompensation, setOfferCompensation] = useState<string>('');
  const [offerMessage, setOfferMessage] = useState<string>('');
  const [offerSubmitting, setOfferSubmitting] = useState<boolean>(false);
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null);
  const [disputeBankName, setDisputeBankName] = useState<string>('');
  const [disputeBankAccount, setDisputeBankAccount] = useState<string>('');
  const [disputeBankHolder, setDisputeBankHolder] = useState<string>('');
  const [hasDisputeBankInfo, setHasDisputeBankInfo] = useState<boolean>(false);

  const handleOpenDisputeRoom = async () => {
    setDisputeRoomVisible(true);
    setDisputeLoading(true);
    try {
      const data = await orderService.getDispute(orderId);
      setDisputeDetail(data);
    } catch (err: any) {
      Alert.alert('Lỗi', err?.response?.data?.message || 'Không thể tải hồ sơ tranh chấp.');
      setDisputeDetail(null);
    } finally {
      setDisputeLoading(false);
    }
  };

  const handleStartOpenDispute = async () => {
    const defaultPlantIds = (order?.plants || []).map((p: any) => p.id);
    setSelectedDisputePlantIds(defaultPlantIds.slice(0, 1));
    setDisputeReasonText('Cây bị hư hại sau thời gian gửi chăm sóc');
    setDisputeDescription('');
    setDisputeEvidence([]);

    try {
      const prof = await customerService.getMyProfile();
      if (prof.bankName && prof.bankAccount && prof.bankHolder) {
        setDisputeBankName(prof.bankName);
        setDisputeBankAccount(prof.bankAccount);
        setDisputeBankHolder(prof.bankHolder);
        setHasDisputeBankInfo(true);
      } else {
        setDisputeBankName(prof.bankName || '');
        setDisputeBankAccount(prof.bankAccount || '');
        setDisputeBankHolder(prof.bankHolder || '');
        setHasDisputeBankInfo(false);
      }
    } catch (_) {
      setHasDisputeBankInfo(false);
    }

    setOpenDisputeModalVisible(true);
  };

  const handlePickDisputePhoto = async (forExistingDispute = false) => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Thiếu quyền', 'Vui lòng cấp quyền camera để chụp ảnh bằng chứng.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setDisputeUploading(true);
      const url = await uploadService.uploadDocumentImage(result.assets[0].uri);
      if (forExistingDispute) {
        await orderService.addDisputeEvidence(orderId, {
          photos: [{ photoUrl: url }],
        });
        Alert.alert('Thành công', 'Đã nộp thêm ảnh bằng chứng.');
        const data = await orderService.getDispute(orderId);
        setDisputeDetail(data);
      } else {
        setDisputeEvidence((prev) => [...prev, { photoUrl: url }]);
      }
    } catch (err: any) {
      Alert.alert('Lỗi', err?.response?.data?.message || 'Không thể tải ảnh bằng chứng.');
    } finally {
      setDisputeUploading(false);
    }
  };

  const handleSubmitOpenDispute = async () => {
    if (selectedDisputePlantIds.length === 0) {
      Alert.alert('Chưa chọn cây', 'Vui lòng chọn ít nhất 1 cây lan bị khiếu nại.');
      return;
    }
    if (!disputeDescription.trim()) {
      Alert.alert('Thiếu thông tin', 'Vui lòng mô tả cụ thể tình trạng hư hại của cây.');
      return;
    }
    if (disputeEvidence.length === 0) {
      Alert.alert('Thiếu ảnh bằng chứng', 'Vui lòng chụp hoặc tải lên ít nhất 1 ảnh bằng chứng (tối đa 10 ảnh).');
      return;
    }
    if (!disputeBankName.trim() || !disputeBankAccount.trim() || !disputeBankHolder.trim()) {
      Alert.alert(
        'Thiếu thông tin ngân hàng',
        'Vui lòng điền đầy đủ Tên ngân hàng, Số tài khoản và Tên chủ tài khoản để nhận tiền hoàn / bồi thường khi mở khiếu nại.',
      );
      return;
    }
    setDisputeSubmitting(true);
    try {
      // Cập nhật thông tin ngân hàng vào hồ sơ khách hàng nếu chưa có hoặc có thay đổi
      await customerService.updateMyProfile({
        bankName: disputeBankName.trim(),
        bankAccount: disputeBankAccount.trim(),
        bankHolder: disputeBankHolder.trim().toUpperCase(),
      });

      await orderService.openDispute(orderId, {
        reason: disputeReasonText.trim(),
        description: disputeDescription.trim(),
        plantIds: selectedDisputePlantIds,
        evidence: disputeEvidence,
      });
      Alert.alert('Đã mở tranh chấp', 'Hồ sơ tranh chấp đã được mở. Hai bên có 3 ngày để tự thương lượng.');
      setOpenDisputeModalVisible(false);
      fetchDetail();
    } catch (err: any) {
      Alert.alert('Lỗi', err?.response?.data?.message || 'Không thể mở tranh chấp.');
    } finally {
      setDisputeSubmitting(false);
    }
  };

  const handleCustomerCreateOffer = async () => {
    const refNum = parseInt(offerRefund || '0', 10);
    const compNum = parseInt(offerCompensation || '0', 10);
    if (isNaN(refNum) || isNaN(compNum) || (refNum === 0 && compNum === 0)) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập số tiền hoàn công hoặc bồi thường lớn hơn 0.');
      return;
    }
    if (disputeDetail?.caps) {
      const maxRef = parseInt(disputeDetail.caps.refundCap, 10);
      const maxComp = parseInt(disputeDetail.caps.compensationCap, 10);
      if (refNum > maxRef) {
        Alert.alert('Vượt hạn mức', `Tiền hoàn công không được vượt quá trần ${maxRef.toLocaleString('vi-VN')} đ.`);
        return;
      }
      if (compNum > maxComp) {
        Alert.alert('Vượt hạn mức', `Tiền bồi thường không được vượt quá trần ${maxComp.toLocaleString('vi-VN')} đ.`);
        return;
      }
    }
    setOfferSubmitting(true);
    try {
      await orderService.createDisputeOffer(orderId, {
        refundAmount: refNum.toString(),
        compensationAmount: compNum.toString(),
        message: offerMessage.trim() || undefined,
      });
      Alert.alert('Thành công', 'Đã gửi đề xuất thương lượng mới cho nhà vườn.');
      setOfferRefund('');
      setOfferCompensation('');
      setOfferMessage('');
      const data = await orderService.getDispute(orderId);
      setDisputeDetail(data);
    } catch (err: any) {
      Alert.alert('Lỗi', err?.response?.data?.message || 'Gửi đề xuất thương lượng thất bại.');
    } finally {
      setOfferSubmitting(false);
    }
  };

  const handleCustomerAcceptOffer = async (offerId: string) => {
    Alert.alert(
      'Xác nhận đồng ý',
      'Bạn có chắc chắn đồng ý với phương án thương lượng này? Tranh chấp sẽ kết thúc và tiền sẽ được thanh toán cho bạn.',
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Đồng ý',
          onPress: async () => {
            setAcceptingOfferId(offerId);
            try {
              await orderService.acceptDisputeOffer(orderId, offerId);
              Alert.alert('Thành công', 'Đã đồng ý đề xuất thương lượng. Tranh chấp đã hoàn tất!');
              const data = await orderService.getDispute(orderId);
              setDisputeDetail(data);
              fetchDetail();
            } catch (err: any) {
              Alert.alert('Lỗi', err?.response?.data?.message || 'Chấp nhận đề xuất thất bại.');
            } finally {
              setAcceptingOfferId(null);
            }
          },
        },
      ]
    );
  };

  const handleCustomerWithdrawDispute = async () => {
    Alert.alert(
      'Xác nhận rút khiếu nại',
      'Bạn có chắc chắn muốn rút khiếu nại tranh chấp này? Đơn hàng sẽ hoàn tất và quyết toán bình thường.',
      [
        { text: 'Quay lại', style: 'cancel' },
        {
          text: 'Rút khiếu nại',
          style: 'destructive',
          onPress: async () => {
            try {
              await orderService.withdrawDispute(orderId);
              Alert.alert('Đã rút khiếu nại', 'Bạn đã rút khiếu nại tranh chấp thành công.');
              setDisputeRoomVisible(false);
              fetchDetail();
            } catch (err: any) {
              Alert.alert('Lỗi', err?.response?.data?.message || 'Không thể rút khiếu nại.');
            }
          },
        },
      ]
    );
  };

  const handleRespondAddon = async (addonId: string, decision: 'ACCEPT' | 'REJECT') => {
    const note = addonNotes[addonId]?.trim();
    setRespondingAddonId(addonId);
    try {
      await orderService.respondAddon(orderId, addonId, {
        decision,
        note: note || undefined,
      });
      Alert.alert(
        decision === 'ACCEPT' ? 'Đã đồng ý' : 'Đã từ chối',
        decision === 'ACCEPT'
          ? 'Bạn đã đồng ý đề xuất. Vui lòng chuyển khoản trong 24 giờ để nhà vườn tiến hành.'
          : 'Bạn đã từ chối đề xuất dịch vụ thêm.'
      );
      const updatedAddons = await orderService.listAddons(orderId);
      setAddons(updatedAddons);
    } catch (err: any) {
      Alert.alert('Lỗi', err?.response?.data?.message || 'Không thể phản hồi đề xuất.');
    } finally {
      setRespondingAddonId(null);
    }
  };

  const handleOpenAddonPayment = async (addon: AddonItem) => {
    setSelectedAddonForPayment(addon);
    setSelectedAddonQr(null);
    setAddonPaymentModalVisible(true);
    setAddonQrLoading(true);
    try {
      const qr = await orderService.getAddonPaymentQr(orderId, addon.id);
      setSelectedAddonQr(qr);
    } catch (err: any) {
      Alert.alert('Lỗi', err?.response?.data?.message || 'Không thể lấy mã QR thanh toán.');
      setAddonPaymentModalVisible(false);
    } finally {
      setAddonQrLoading(false);
    }
  };

  const handleCheckAddonPaymentStatus = async () => {
    if (!selectedAddonForPayment) return;
    setCheckingAddonPayment(true);
    try {
      const updatedAddons = await orderService.listAddons(orderId);
      setAddons(updatedAddons);
      const target = updatedAddons.find((a) => a.id === selectedAddonForPayment.id);
      if (target?.status === 'PAID' || target?.status === 'DONE') {
        Alert.alert('Thành công', 'Thanh toán dịch vụ thêm đã được xác nhận!');
        setAddonPaymentModalVisible(false);
      } else {
        Alert.alert('Chờ xác nhận', 'Hệ thống đang chờ ngân hàng đối soát. Vui lòng thử lại sau giây lát.');
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể kiểm tra trạng thái thanh toán.');
    } finally {
      setCheckingAddonPayment(false);
    }
  };

  const fetchDetail = async (silent = false) => {
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      const [orderData, historyData, activeData, reportsData, addonsData] = await Promise.all([
        orderService.getOrderDetail(orderId),
        videoCallService.listHistory(orderId).catch(() => []),
        videoCallService.getActive(orderId).catch(() => ({ call: null })),
        careReportService.listByOrder(orderId).catch(() => []),
        orderService.listAddons(orderId).catch(() => []),
      ]);

      setOrder(orderData);
      setCallHistory(historyData || []);
      setActiveCall(activeData?.call || null);
      setCareReports(reportsData || []);
      setAddons(addonsData || []);
    } catch (err: any) {
      console.error('Failed to load order detail:', err);
      setErrorMsg('Không thể tải thông tin đơn hàng.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDetail(true);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchDetail();
  }, [orderId]);

  // Fetch provider GPS if not on order object
  useEffect(() => {
    const pId = (order as any)?.providerId || order?.provider?.id;
    if (pId && !order?.provider?.gpsLat && !providerCoords) {
      providerService
        .getProviderById(pId)
        .then((p) => {
          if (p?.gpsLat != null && p?.gpsLng != null) {
            setProviderCoords({ lat: Number(p.gpsLat), lng: Number(p.gpsLng) });
          }
        })
        .catch(() => {});
    }
  }, [order?.id, (order as any)?.providerId]);

  // Compute road distance
  const pLat = (order?.provider as any)?.gpsLat ?? providerCoords?.lat;
  const pLng = (order?.provider as any)?.gpsLng ?? providerCoords?.lng;
  const cLat = (order as any)?.pickupGpsLat ?? (order as any)?.pickupLat;
  const cLng = (order as any)?.pickupGpsLng ?? (order as any)?.pickupLng;

  const orderDistanceKm = calculateRoadDistanceKm(cLat, cLng, pLat, pLng);

  const handleStartVideoCall = async () => {
    setCallLoading(true);
    try {
      let session;
      if (activeCall) {
        // Có cuộc gọi đang diễn ra -> tham gia luôn
        session = await videoCallService.joinCall(activeCall.id);
      } else {
        // Tạo cuộc gọi mới cho đơn
        session = await videoCallService.createCall(orderId);
      }

      navigation.navigate('VideoCall', {
        callId: session.call.id,
        session,
        orderId,
      });
    } catch (err: any) {
      console.error('Start video call failed:', err);
      const msg =
        err?.response?.data?.message || err?.message || 'Không thể bắt đầu cuộc gọi.';
      Alert.alert('Cuộc gọi video', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setCallLoading(false);
    }
  };

  // Mở modal xem hợp đồng
  const handleOpenContract = async () => {
    setContractModalVisible(true);
    setContractLoading(true);
    try {
      const data = await orderService.getContract(orderId);
      setContractData(data);
    } catch (err: any) {
      console.error('Failed to load contract:', err);
      const msg = err?.response?.data?.message || 'Không thể tải chi tiết hợp đồng.';
      Alert.alert('Hợp đồng', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setContractLoading(false);
    }
  };

  // Yêu cầu mở popup xác nhận ký hợp đồng cho Customer
  const handlePromptSignContract = () => {
    setCustomerAgreedTerms(false);
    setSignConfirmModalVisible(true);
  };

  // Xác nhận ký hợp đồng từ popup
  const handleConfirmSignContract = async () => {
    setSigningLoading(true);
    try {
      await orderService.signAgreement(orderId);
      setSignConfirmModalVisible(false);
      setContractModalVisible(false);
      Alert.alert('Thành công', 'Bạn đã ký hợp đồng online thành công!');
      fetchDetail();
    } catch (err: any) {
      console.error('Sign agreement failed:', err);
      const msg = err?.response?.data?.message || 'Ký hợp đồng thất bại.';
      Alert.alert('Lỗi', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setSigningLoading(false);
    }
  };

  // Mở modal thanh toán VietQR
  const handleOpenPayment = async () => {
    setPaymentModalVisible(true);
    setPaymentLoading(true);
    try {
      const data = await orderService.getPaymentQr(orderId);
      setPaymentQrData(data);
    } catch (err: any) {
      console.error('Failed to get payment QR:', err);
      const msg = err?.response?.data?.message || 'Không thể tải mã VietQR thanh toán.';
      Alert.alert('Thanh toán', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setPaymentLoading(false);
    }
  };

  // Kiểm tra trạng thái thanh toán sau khi chuyển tiền
  const handleCheckPaymentStatus = async () => {
    setCheckingPayment(true);
    try {
      const updated = await orderService.getOrderDetail(orderId);
      setOrder(updated);
      if (updated.status === 'PAID') {
        Alert.alert('Thành công 🎉', 'Hệ thống SePay đã ghi nhận thanh toán thành công! Nhà vườn sẽ sớm liên hệ nhận bàn giao cây.');
        setPaymentModalVisible(false);
      } else {
        Alert.alert(
          'Đang chờ giao dịch',
          'Hệ thống chưa nhận được tiền từ SePay. Thông thường ngân hàng sẽ xử lý trong vòng 30s - 1 phút. Vui lòng bấm thử lại sau giây lát!'
        );
      }
    } catch (err: any) {
      Alert.alert('Lỗi', 'Không thể kiểm tra trạng thái.');
    } finally {
      setCheckingPayment(false);
    }
  };

  // Xác nhận bàn giao cây
  const handleConfirmHandover = () => {
    Alert.alert(
      'Xác nhận bàn giao cây',
      'Bạn xác nhận đã bàn giao cây cho nhà vườn và đồng ý với kết quả thẩm định hiện trạng để bắt đầu chu kỳ chăm sóc?',
      [
        { text: 'Kiểm tra lại', style: 'cancel' },
        {
          text: 'Xác nhận bàn giao',
          onPress: async () => {
            setConfirmingHandover(true);
            try {
              await orderService.confirmHandover(orderId);
              Alert.alert(
                'Thành công',
                'Đã xác nhận bàn giao thành công! Bạn đã hoàn tất phần việc của mình. Đang chờ nhà vườn nộp tiền bảo lãnh trách nhiệm để chính thức kích hoạt chu kỳ chăm sóc.'
              );
              setOrder((prev) =>
                prev
                  ? {
                      ...prev,
                      handoverStatus: 'AWAITING_DEPOSIT',
                      handover: prev.handover
                        ? { ...prev.handover, status: 'AWAITING_DEPOSIT' }
                        : { status: 'AWAITING_DEPOSIT' },
                    }
                  : prev
              );
              fetchDetail();
            } catch (err: any) {
              console.warn('Confirm handover failed:', err);
              const msg =
                err?.response?.data?.message ||
                err?.message ||
                'Xác nhận bàn giao thất bại.';
              Alert.alert('Lỗi', Array.isArray(msg) ? msg.join('\n') : msg);
            } finally {
              setConfirmingHandover(false);
            }
          },
        },
      ]
    );
  };

  // Xác nhận đã nhận lại cây (RETURN_AWAITING_CONFIRM -> COMPLETED)
  const handleConfirmReturn = () => {
    Alert.alert(
      'Xác nhận đã nhận lại cây',
      'Bạn xác nhận đã nhận lại đầy đủ cây lan từ nhà vườn và hoàn tất đơn hàng?',
      [
        { text: 'Kiểm tra lại', style: 'cancel' },
        {
          text: 'Xác nhận đã nhận cây',
          onPress: async () => {
            setConfirmingReturn(true);
            try {
              await orderService.confirmReturn(orderId);
              Alert.alert('Hoàn tất', 'Cảm ơn bạn đã xác nhận nhận lại cây! Đơn hàng đã hoàn thành.');
              fetchDetail();
            } catch (err: any) {
              console.error('Confirm return failed:', err);
              const msg = err?.response?.data?.message || 'Xác nhận nhận lại cây thất bại.';
              Alert.alert('Lỗi', Array.isArray(msg) ? msg.join('\n') : msg);
            } finally {
              setConfirmingReturn(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingArea}>
        <ActivityIndicator size="large" color="#6027D2" />
        <Text style={styles.loadingText}>Đang tải chi tiết đơn hàng...</Text>
      </SafeAreaView>
    );
  }

  if (errorMsg || !order) {
    return (
      <SafeAreaView style={styles.errorArea}>
        <Ionicons name="alert-circle-outline" size={48} color="#E53E3E" />
        <Text style={styles.errorText}>{errorMsg || 'Không tìm thấy đơn hàng.'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => fetchDetail()}>
          <Text style={styles.retryButtonText}>Thử lại</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  let statusInfo = STATUS_MAP[order.status] || {
    label: order.status,
    color: '#4A5568',
    bg: '#EDF2F7',
  };

  const isAwaitingDeposit =
    order.status === 'HANDOVER_AWAITING_CONFIRM' &&
    (order.handoverStatus === 'AWAITING_DEPOSIT' || order.handover?.status === 'AWAITING_DEPOSIT');

  if (isAwaitingDeposit) {
    statusInfo = {
      label: 'Chờ vườn nộp tiền bảo lãnh',
      color: '#2563EB',
      bg: '#EFF6FF',
    };
  }

  const formattedPickupDate = order.scheduledPickupAt
    ? new Date(order.scheduledPickupAt).toLocaleString('vi-VN')
    : 'Chưa sắp xếp';

  const isCallable = CALLABLE_ORDER_STATUSES.includes(order.status as any);

  const formatSeconds = (sec: number | null) => {
    if (!sec || sec <= 0) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#1A202C" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Đơn hàng #{order.orderCode || '---'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#6027D2']} />
        }
      >
        {/* Status Banner */}
        <View style={[styles.statusBanner, { backgroundColor: statusInfo.bg }]}>
          <Ionicons name="information-circle-outline" size={20} color={statusInfo.color} />
          <Text style={[styles.statusBannerText, { color: statusInfo.color }]}>
            Trạng thái: {statusInfo.label}
          </Text>
        </View>

        {/* Đơn đã huỷ: vì sao, ai huỷ, được hoàn bao nhiêu — tự ẩn với trạng thái khác */}
        <CancelledOrderCard order={order} />

        {/* Dynamic Action Section based on Order Status */}
        {order.status === 'AGREEMENT_PENDING' && (
          <View style={[styles.actionBannerCard, { borderColor: '#DD6B20', backgroundColor: '#FFFAF0' }]}>
            <View style={styles.actionBannerHeader}>
              <View style={[styles.actionIconCircle, { backgroundColor: '#FEEBC8' }]}>
                <Ionicons name="document-text" size={22} color="#C05621" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionBannerTitle, { color: '#C05621' }]}>
                  Hợp đồng chờ bạn ký
                </Text>
                <Text style={styles.actionBannerSub}>
                  Nhà vườn đã chấp nhận đơn. Vui lòng xem và ký hợp đồng điện tử để chuyển sang bước thanh toán.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.primaryActionBtn, { backgroundColor: '#DD6B20' }]}
              onPress={handleOpenContract}
              activeOpacity={0.85}
            >
              <Ionicons name="create-outline" size={18} color="#FFFFFF" />
              <Text style={styles.primaryActionBtnText}>Xem & Ký hợp đồng online</Text>
            </TouchableOpacity>
          </View>
        )}

        {order.status === 'AWAITING_PAYMENT' && (
          <View style={[styles.actionBannerCard, { borderColor: '#3182CE', backgroundColor: '#F7FAFC' }]}>
            <View style={styles.actionBannerHeader}>
              <View style={[styles.actionIconCircle, { backgroundColor: '#EBF8FF' }]}>
                <Ionicons name="qr-code" size={22} color="#2B6CB0" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionBannerTitle, { color: '#2B6CB0' }]}>
                  Chờ thanh toán phí chăm sóc
                </Text>
                <Text style={styles.actionBannerSub}>
                  Hợp đồng đã hoàn tất ký 2 bên. Quét mã VietQR chuyển khoản (tự động kích hoạt đơn qua SePay).
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.primaryActionBtn, { backgroundColor: '#3182CE' }]}
              onPress={handleOpenPayment}
              activeOpacity={0.85}
            >
              <Ionicons name="card-outline" size={18} color="#FFFFFF" />
              <Text style={styles.primaryActionBtnText}>Thanh toán ngay bằng VietQR</Text>
            </TouchableOpacity>
          </View>
        )}

        {order.status === 'HANDOVER_AWAITING_CONFIRM' && (
          isAwaitingDeposit ? (
            <View style={[styles.actionBannerCard, { borderColor: '#3B82F6', backgroundColor: '#EFF6FF' }]}>
              <View style={styles.actionBannerHeader}>
                <View style={[styles.actionIconCircle, { backgroundColor: '#DBEAFE' }]}>
                  <Ionicons name="time" size={22} color="#2563EB" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionBannerTitle, { color: '#1D4ED8' }]}>
                    Đã xác nhận bàn giao cây
                  </Text>
                  <Text style={styles.actionBannerSub}>
                    Bạn đã xác nhận bàn giao thành công. Hệ thống đang chờ nhà vườn nộp tiền bảo lãnh trách nhiệm (trong vòng 2 giờ) để chính thức kích hoạt chu kỳ chăm sóc.
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={[styles.actionBannerCard, { borderColor: '#D97706', backgroundColor: '#FFFBEB' }]}>
              <View style={styles.actionBannerHeader}>
                <View style={[styles.actionIconCircle, { backgroundColor: '#FEF3C7' }]}>
                  <Ionicons name="shield-checkmark" size={22} color="#D97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionBannerTitle, { color: '#B45309' }]}>
                    Xác nhận bàn giao cây
                  </Text>
                  <Text style={styles.actionBannerSub}>
                    Nhà vườn đã hoàn tất thẩm định hiện trạng cây tại vườn. Vui lòng xác nhận để kích hoạt chu kỳ chăm sóc.
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.primaryActionBtn, { backgroundColor: '#6027D2' }]}
                onPress={handleConfirmHandover}
                disabled={confirmingHandover}
                activeOpacity={0.85}
              >
                {confirmingHandover ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={18} color="#FFFFFF" />
                    <Text style={styles.primaryActionBtnText}>Xác nhận bàn giao cây</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )
        )}

        {order.status === 'RETURN_AWAITING_CONFIRM' && (
          <View style={[styles.actionBannerCard, { borderColor: '#10B981', backgroundColor: '#ECFDF5' }]}>
            <View style={styles.actionBannerHeader}>
              <View style={[styles.actionIconCircle, { backgroundColor: '#D1FAE5' }]}>
                <Ionicons name="leaf" size={22} color="#059669" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionBannerTitle, { color: '#065F46' }]}>
                  Xác nhận đã nhận lại cây
                </Text>
                <Text style={styles.actionBannerSub}>
                  Nhà vườn đã hoàn tất bàn giao trả cây. Vui lòng kiểm tra cây và bấm xác nhận hoàn tất đơn hàng.
                </Text>
                {order.returnHandover?.customerConfirmDueAt && (
                  <Text style={{ fontSize: 11, color: '#047857', marginTop: 4, fontWeight: '600' }}>
                    Hạn xác nhận:{' '}
                    {new Date(order.returnHandover.customerConfirmDueAt).toLocaleString('vi-VN')}
                  </Text>
                )}
              </View>
            </View>

            {order.returnHandover?.assessments && order.returnHandover.assessments.length > 0 && (
              <View style={{ marginTop: 8, marginBottom: 8 }}>
                {order.returnHandover.assessments.map((a, idx) => (
                  <View
                    key={a.id || idx}
                    style={{
                      backgroundColor: '#FFFFFF',
                      borderRadius: 10,
                      padding: 10,
                      marginBottom: 6,
                      borderWidth: 1,
                      borderColor: '#A7F3D0',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#065F46' }}>
                      Tình trạng trả cây #{idx + 1}
                    </Text>
                    {a.note ? (
                      <Text style={{ fontSize: 11, color: '#374151', marginTop: 2 }}>{a.note}</Text>
                    ) : null}
                    {a.photos && a.photos.length > 0 && (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                        {a.photos.map((ph, pIdx) => (
                          <TouchableOpacity
                            key={ph.id || pIdx}
                            activeOpacity={0.85}
                            onPress={() => setPreviewImageUrl(ph.photoUrl)}
                          >
                            <Image source={{ uri: ph.photoUrl }} style={styles.photoThumb} />
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={[styles.primaryActionBtn, { backgroundColor: '#059669' }]}
              onPress={handleConfirmReturn}
              disabled={confirmingReturn}
              activeOpacity={0.85}
            >
              {confirmingReturn ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryActionBtnText}>Xác nhận đã nhận lại cây</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Khách rút / huỷ đơn / không giao cây — tự ẩn ở trạng thái BE không cho huỷ */}
        <CustomerCancelSection order={order} onChanged={() => fetchDetail()} />

        {/* Compact Quick Action Bar */}
        {(isCallable ||
          ['PAID', 'HANDOVER_IN_PROGRESS', 'HANDOVER_AWAITING_CONFIRM', 'IN_CARE', 'RETURN_IN_PROGRESS', 'RETURN_AWAITING_CONFIRM', 'COMPLETED', 'DISPUTED'].includes(order.status)) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {isCallable && (
              <TouchableOpacity
                onPress={handleStartVideoCall}
                disabled={callLoading}
                activeOpacity={0.85}
                style={{
                  flex: 1,
                  minWidth: 110,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  backgroundColor: activeCall ? '#059669' : '#6027D2',
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                }}
              >
                {callLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Ionicons name={activeCall ? 'enter-outline' : 'videocam'} size={16} color="#FFFFFF" />
                    <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 12 }}>
                      {activeCall ? 'Vào cuộc gọi' : 'Gọi Video'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {['PAID', 'HANDOVER_IN_PROGRESS', 'HANDOVER_AWAITING_CONFIRM', 'IN_CARE', 'RETURN_IN_PROGRESS', 'RETURN_AWAITING_CONFIRM', 'COMPLETED', 'DISPUTED'].includes(order.status) && (
              <TouchableOpacity
                onPress={handleOpenContract}
                activeOpacity={0.8}
                style={{
                  flex: 1,
                  minWidth: 105,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  backgroundColor: '#FFFFFF',
                  borderWidth: 1,
                  borderColor: '#DDD6FE',
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                }}
              >
                <Ionicons name="document-text-outline" size={16} color="#6027D2" />
                <Text style={{ color: '#6027D2', fontWeight: '700', fontSize: 12 }}>Hợp đồng</Text>
              </TouchableOpacity>
            )}

            {order.status === 'RETURN_AWAITING_CONFIRM' && (
              <TouchableOpacity
                onPress={handleStartOpenDispute}
                activeOpacity={0.8}
                style={{
                  flex: 1,
                  minWidth: 105,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  backgroundColor: '#FFFFFF',
                  borderWidth: 1,
                  borderColor: '#F87171',
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                }}
              >
                <Ionicons name="alert-circle-outline" size={16} color="#DC2626" />
                <Text style={{ color: '#DC2626', fontWeight: '700', fontSize: 12 }}>Khiếu nại</Text>
              </TouchableOpacity>
            )}

            {order.status === 'DISPUTED' && (
              <TouchableOpacity
                onPress={handleOpenDisputeRoom}
                activeOpacity={0.8}
                style={{
                  flex: 1,
                  minWidth: 105,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  backgroundColor: '#FEE2E2',
                  borderWidth: 1,
                  borderColor: '#EF4444',
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                }}
              >
                <Ionicons name="alert-circle" size={16} color="#DC2626" />
                <Text style={{ color: '#DC2626', fontWeight: '700', fontSize: 12 }}>Tranh chấp</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Addon Notifications if pending or accepted */}
        {addons.some((a) => a.status === 'PENDING') && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setActiveTab('addons')}
            style={{
              backgroundColor: '#FEF3C7',
              borderWidth: 1,
              borderColor: '#F59E0B',
              borderRadius: 12,
              padding: 12,
              marginBottom: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Ionicons name="sparkles" size={22} color="#D97706" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#92400E' }}>
                Có {addons.filter((a) => a.status === 'PENDING').length} đề xuất dịch vụ phát sinh từ nhà vườn
              </Text>
              <Text style={{ fontSize: 11, color: '#B45309', marginTop: 2 }}>
                Bấm để xem lý do, ảnh minh chứng & phản hồi đồng ý / từ chối
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#D97706" />
          </TouchableOpacity>
        )}

        {addons.some((a) => a.status === 'ACCEPTED') && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setActiveTab('addons')}
            style={{
              backgroundColor: '#EFF6FF',
              borderWidth: 1,
              borderColor: '#3B82F6',
              borderRadius: 12,
              padding: 12,
              marginBottom: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Ionicons name="qr-code-outline" size={22} color="#2563EB" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#1E40AF' }}>
                Có {addons.filter((a) => a.status === 'ACCEPTED').length} dịch vụ đã duyệt chờ thanh toán
              </Text>
              <Text style={{ fontSize: 11, color: '#1D4ED8', marginTop: 2 }}>
                Bấm để lấy mã VietQR chuyển khoản trong 24 giờ
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#2563EB" />
          </TouchableOpacity>
        )}

        {/* Segmented Tabs */}
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: '#EDF2F7',
            borderRadius: 12,
            padding: 4,
            marginBottom: 14,
          }}
        >
          {(
            [
              { key: 'overview', label: 'Thông tin' },
              {
                key: 'care',
                label: careReports.length > 0 ? `Báo cáo (${careReports.length})` : 'Báo cáo',
              },
              {
                key: 'addons',
                label: addons.length > 0 ? `Dịch vụ thêm (${addons.length})` : 'Dịch vụ thêm',
              },
              { key: 'support', label: 'Hỗ trợ' },
            ] as Array<{ key: 'overview' | 'care' | 'addons' | 'support'; label: string }>
          ).map((tab) => {
            const active = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={{
                  flex: 1,
                  paddingVertical: 9,
                  borderRadius: 9,
                  backgroundColor: active ? '#FFFFFF' : 'transparent',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: active ? '700' : '600',
                    color: active ? '#6027D2' : '#4A5568',
                  }}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {activeTab === 'overview' && (
          <>
        {/* Tranh chấp đã xong — giữ đường vào xem lại hồ sơ */}
        <DisputeResultCard order={order} onOpen={handleOpenDisputeRoom} />

        {/* Package Info */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Thông tin gói dịch vụ</Text>
          <Text style={styles.packageName}>
            {order.servicePackage?.name || 'Gói chăm sóc lan'}
          </Text>
          {order.provider?.gardenName ? (
            <Text style={styles.gardenName}>Nhà vườn: {order.provider.gardenName}</Text>
          ) : null}

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Thời hạn chăm sóc:</Text>
            <Text style={styles.infoValue}>
              {order.durationDaysSnapshot || order.servicePackage?.durationDays || 30} ngày
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Tần suất báo cáo:</Text>
            <Text style={styles.infoValue}>
              {order.reportFrequencySnapshot || 7} ngày/lần
            </Text>
          </View>
        </View>

        {/* Pickup & Address */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Thời gian & Địa điểm lấy cây</Text>
          <View style={styles.iconInfoRow}>
            <Ionicons name="calendar-outline" size={18} color="#6027D2" />
            <Text style={styles.iconInfoText}>{formattedPickupDate}</Text>
          </View>
          <View style={styles.iconInfoRow}>
            <Ionicons name="location-outline" size={18} color="#6027D2" />
            <Text style={styles.iconInfoText}>
              {order.pickupAddress || 'Chưa cập nhật địa chỉ'}
            </Text>
          </View>
          {order.customerNote ? (
            <View style={styles.iconInfoRow}>
              <Ionicons name="create-outline" size={18} color="#6027D2" />
              <Text style={styles.iconInfoText}>Ghi chú: {order.customerNote}</Text>
            </View>
          ) : null}
        </View>

        {/* Tạm tính — chỉ khi khối Quyết toán không hiện (BE chưa có hoá đơn / đơn huỷ trước khi trả tiền) */}
        {!isSettlementShown(order) && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Chi tiết giá (tạm tính)</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>
              Giá gói ({formatVnd(order.basePriceSnapshot)} × {order.plantCount || 0} cây):
            </Text>
            <Text style={styles.infoValue}>{formatVnd(order.provisionalTotal)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Phí dịch vụ 6%:</Text>
            <Text style={styles.infoValue}>{formatVnd(customerFeeFor(toNumber(order.provisionalTotal)))}</Text>
          </View>
          <View style={styles.infoRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoLabel}>Phí vận chuyển lấy cây:</Text>
              {orderDistanceKm !== null ? (
                <Text style={{ fontSize: 11, color: '#6027D2', marginTop: 2, fontWeight: '600' }}>
                  📍 Quãng đường định vị: ~{orderDistanceKm} km
                </Text>
              ) : null}
            </View>
            <Text style={styles.infoValue}>{formatVnd(order.pickupFeeSnapshot)}</Text>
          </View>
          {toNumber(order.declaredDepositTotal) > 0 && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Tiền bảo đảm khai giá:</Text>
              <Text style={styles.infoValue}>{formatVnd(order.declaredDepositTotal)}</Text>
            </View>
          )}
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.totalLabel}>Tổng cộng:</Text>
            <Text style={styles.totalValue}>
              {formatVnd(
                toNumber(order.provisionalTotal) +
                  customerFeeFor(toNumber(order.provisionalTotal)) +
                  toNumber(order.pickupFeeSnapshot) +
                  toNumber(order.declaredDepositTotal),
              )}
            </Text>
          </View>
        </View>
        )}

        {/* Quyết toán đơn — đọc nguyên settlement của BE */}
        <SettlementCard order={order} />
          </>
        )}

        {activeTab === 'care' && (
          <>
        {/* Plants List */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Danh sách cây lan ({order.plantCount || 0})</Text>

          {order.plants && order.plants.length > 0 ? (
            order.plants.map((plant, index) => (
              <View key={plant.id} style={styles.plantItem}>
                <Text style={styles.plantName}>
                  #{index + 1}. {plant.name}
                </Text>
                {plant.speciesName ? (
                  <Text style={styles.plantSpecies}>Giống: {plant.speciesName}</Text>
                ) : null}

                {/* Photos */}
                {plant.initialPhotos && plant.initialPhotos.length > 0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.photosScroll}
                  >
                    {plant.initialPhotos.map((p) => (
                      <TouchableOpacity
                        key={p.id}
                        activeOpacity={0.85}
                        onPress={() => setPreviewImageUrl(p.photoUrl)}
                      >
                        <Image source={{ uri: p.photoUrl }} style={styles.photoThumb} />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.noPhotoText}>Chưa có ảnh hiện trạng</Text>
                )}
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>Chưa có thông tin cây lan.</Text>
          )}
        </View>

        {/* Care Progress & 2-Tier Care Reports */}
        {(order.careReportSchedule ||
          careReports.length > 0 ||
          ['IN_CARE', 'RETURN_IN_PROGRESS', 'RETURN_AWAITING_CONFIRM', 'COMPLETED', 'DISPUTED'].includes(order.status)) && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nhật ký & Tiến độ chăm sóc</Text>

            {order.careReportSchedule && (
              <View
                style={[
                  styles.careScheduleBox,
                  order.careReportSchedule.isReportOverdue && styles.careScheduleBoxOverdue,
                ]}
              >
                <View style={styles.careScheduleHeader}>
                  <Text style={styles.careScheduleTitle}>
                    Đã nộp {order.careReportSchedule.submittedCount}/{order.careReportSchedule.totalPeriods} kỳ báo cáo
                  </Text>
                  <View
                    style={[
                      styles.careScheduleBadge,
                      {
                        backgroundColor: order.careReportSchedule.isReportOverdue
                          ? '#FEE2E2'
                          : '#DCFCE7',
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        color: order.careReportSchedule.isReportOverdue ? '#DC2626' : '#16A34A',
                      }}
                    >
                      {order.careReportSchedule.isReportOverdue ? 'Trễ hạn kỳ' : 'Đúng tiến độ'}
                    </Text>
                  </View>
                </View>
                {order.careReportSchedule.nextReportDueAt && (
                  <Text style={styles.careScheduleSub}>
                    Hạn kỳ tiếp theo:{' '}
                    {new Date(order.careReportSchedule.nextReportDueAt).toLocaleDateString('vi-VN')}
                  </Text>
                )}
              </View>
            )}

            {careReports.length === 0 ? (
              <Text style={styles.emptyText}>Chưa có báo cáo chăm sóc nào cho đơn này.</Text>
            ) : (
              careReports.map((rpt) => {
                const SUBSTRATE_MAP: Record<SubstrateMoisture, string> = {
                  LOW: 'Thấp',
                  MEDIUM: 'Vừa',
                  HIGH: 'Cao',
                };
                const PART_MAP: Record<PartCondition, string> = {
                  GOOD: 'Tốt',
                  NORMAL: 'Bình thường',
                  POOR: 'Xấu',
                };
                const HEALTH_MAP: Record<OverallHealth, string> = {
                  GOOD: 'Tốt',
                  AVERAGE: 'Trung bình',
                  POOR: 'Kém',
                };
                const EVIDENCE_MAP: Record<CareEvidenceType, string> = {
                  OVERVIEW: 'Toàn cảnh',
                  LEAF: 'Lá',
                  STEM: 'Thân',
                  ROOT: 'Rễ',
                };

                return (
                  <View key={rpt.id} style={styles.careReportCard}>
                    <View style={styles.careReportHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={styles.periodPill}>
                          <Text style={styles.periodPillText}>Kỳ {rpt.periodIndex}</Text>
                        </View>
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: '700',
                            color: rpt.isLate ? '#D97706' : '#16A34A',
                          }}
                        >
                          {rpt.isLate ? 'Nộp trễ' : 'Đúng hạn'}
                        </Text>
                      </View>
                      <Text style={styles.careReportDate}>
                        {new Date(rpt.submittedAt).toLocaleDateString('vi-VN')}
                      </Text>
                    </View>

                    <Text style={styles.careEnvText}>
                      Môi trường: {rpt.airTemperature}°C · {rpt.airHumidity}% · {rpt.lightIntensity} Lux
                    </Text>
                    <Text style={styles.careActivityText}>
                      Tưới: {rpt.watered ? `${rpt.waterAmountMl} ml` : 'Không'} · Bón:{' '}
                      {rpt.fertilized ? rpt.fertilizerType : 'Không'}
                      {rpt.waterPh != null ? ` · pH ${rpt.waterPh}` : ''}
                      {rpt.waterEc != null ? ` · EC ${rpt.waterEc}` : ''}
                    </Text>
                    {rpt.otherCareNote ? (
                      <Text style={styles.careNoteText}>Ghi chú: {rpt.otherCareNote}</Text>
                    ) : null}

                    {(rpt.plants ?? []).map((entry, pIdx) => (
                      <View key={entry.id || pIdx} style={styles.carePlantItem}>
                        <View style={styles.carePlantHeader}>
                          <Text style={styles.carePlantName}>
                            {entry.plant?.name || `Chậu cây #${pIdx + 1}`}
                          </Text>
                          <Text style={styles.carePlantHealth}>
                            Tổng thể: {HEALTH_MAP[entry.overallHealth] || entry.overallHealth}
                            {entry.hasPestDisease ? ' · Có sâu bệnh' : ''}
                          </Text>
                        </View>
                        <Text style={styles.carePlantMeta}>
                          Giá thể: {SUBSTRATE_MAP[entry.substrateMoisture]} · Lá:{' '}
                          {PART_MAP[entry.leafCondition]} · Thân: {PART_MAP[entry.stemCondition]} · Rễ:{' '}
                          {PART_MAP[entry.rootCondition]}
                        </Text>
                        {entry.note ? (
                          <Text style={styles.careNoteText}>{entry.note}</Text>
                        ) : null}
                        {(entry.photos ?? []).length > 0 && (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={styles.photosScroll}
                          >
                            {entry.photos.map((photo, phIdx) => (
                              <View key={photo.id || phIdx} style={{ marginRight: 8, alignItems: 'center' }}>
                                <TouchableOpacity
                                  activeOpacity={0.85}
                                  onPress={() => setPreviewImageUrl(photo.photoUrl)}
                                >
                                  <Image
                                    source={{ uri: photo.photoUrl }}
                                    style={styles.photoThumb}
                                  />
                                </TouchableOpacity>
                                <Text style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
                                  {EVIDENCE_MAP[photo.evidenceType] || photo.evidenceType}
                                </Text>
                              </View>
                            ))}
                          </ScrollView>
                        )}
                      </View>
                    ))}
                  </View>
                );
              })
            )}
          </View>
        )}
          </>
        )}

        {activeTab === 'addons' && (
          <>
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="sparkles" size={18} color="#6027D2" />
                  <Text style={styles.cardTitle}>Dịch vụ phát sinh ngoài gói ({addons.length})</Text>
                </View>
              </View>

              {addons.length === 0 ? (
                <View style={{ padding: 16, alignItems: 'center' }}>
                  <Text style={styles.emptyText}>
                    Đơn hàng hiện chưa có dịch vụ phát sinh nào.
                  </Text>
                  <Text style={{ fontSize: 11, color: '#A0AEC0', textAlign: 'center', marginTop: 4 }}>
                    Nếu trong lúc chăm sóc phát sinh vấn đề (thay chậu, trị bệnh...), nhà vườn sẽ gửi đề xuất tại đây.
                  </Text>
                </View>
              ) : (
                addons.map((ad) => {
                  const statusInfo =
                    ad.status === 'PENDING'
                      ? { label: 'Chờ bạn duyệt (48h)', color: '#D97706', bg: '#FEF3C7' }
                      : ad.status === 'ACCEPTED'
                        ? { label: 'Chờ thanh toán (24h)', color: '#2563EB', bg: '#EFF6FF' }
                        : ad.status === 'PAID'
                          ? { label: 'Đã thanh toán - Đang làm', color: '#6027D2', bg: '#F3E8FF' }
                          : ad.status === 'DONE'
                            ? { label: 'Đã hoàn tất', color: '#059669', bg: '#ECFDF5' }
                            : ad.status === 'REJECTED'
                              ? { label: 'Bạn đã từ chối', color: '#DC2626', bg: '#FEF2F2' }
                              : ad.status === 'REFUNDED'
                                ? { label: 'Vườn đã trả lại', color: '#2563EB', bg: '#EFF6FF' }
                                : { label: 'Đã hết hạn', color: '#6B7280', bg: '#F3F4F6' };

                  const isResponding = respondingAddonId === ad.id;

                  return (
                    <View
                      key={ad.id}
                      style={{
                        backgroundColor: '#FFFFFF',
                        borderRadius: 12,
                        padding: 14,
                        marginBottom: 14,
                        borderWidth: 1,
                        borderColor: '#E2E8F0',
                      }}
                    >
                      {/* Top Header */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#1A202C' }}>
                            {ad.title}
                          </Text>
                          <Text style={{ fontSize: 11, color: '#6027D2', fontWeight: '600', marginTop: 2 }}>
                            Mã đề xuất: #{ad.addonCode}
                          </Text>
                          <Text style={{ fontSize: 11, color: '#718096', marginTop: 1 }}>
                            Áp dụng: {ad.plant?.name ? `Chậu ${ad.plant.name}` : 'Toàn bộ đơn hàng'}
                          </Text>
                        </View>
                        <View style={{ backgroundColor: statusInfo.bg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: statusInfo.color }}>
                            {statusInfo.label}
                          </Text>
                        </View>
                      </View>

                      {/* Pricing Breakdown */}
                      <View style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, marginVertical: 8 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={{ fontSize: 12, color: '#4A5568' }}>Giá dịch vụ đề xuất:</Text>
                          <Text style={{ fontSize: 12, fontWeight: '600', color: '#1A202C' }}>
                            {Number(ad.price || 0).toLocaleString('vi-VN')} VNĐ
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={{ fontSize: 11, color: '#718096' }}>Phí nền tảng (6%):</Text>
                          <Text style={{ fontSize: 11, color: '#718096' }}>
                            +{Number(ad.customerFee || 0).toLocaleString('vi-VN')} VNĐ
                          </Text>
                        </View>
                        <View style={{ height: 1, backgroundColor: '#E2E8F0', marginVertical: 4 }} />
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A202C' }}>Tổng thanh toán:</Text>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: '#6027D2' }}>
                            {Number(ad.amountDue || ad.price).toLocaleString('vi-VN')} VNĐ
                          </Text>
                        </View>
                      </View>

                      {/* Reason & Photos */}
                      <Text style={{ fontSize: 12, color: '#4A5568', lineHeight: 18, marginTop: 4 }}>
                        <Text style={{ fontWeight: '700' }}>Lý do phát sinh: </Text>
                        {ad.reason}
                      </Text>

                      {Array.isArray(ad.photoUrls) && ad.photoUrls.length > 0 && (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                          {ad.photoUrls.map((url, pIdx) => (
                            <TouchableOpacity
                              key={`${ad.id}-p-${pIdx}`}
                              activeOpacity={0.85}
                              onPress={() => setPreviewImageUrl(url)}
                            >
                              <Image source={{ uri: url }} style={styles.photoThumb} />
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      )}

                      {/* If Customer Note exists */}
                      {ad.customerNote ? (
                        <View style={{ marginTop: 8, padding: 8, borderRadius: 8, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' }}>
                          <Text style={{ fontSize: 11, color: '#991B1B' }}>
                            <Text style={{ fontWeight: '700' }}>Ghi chú của bạn: </Text>
                            {ad.customerNote}
                          </Text>
                        </View>
                      ) : null}

                      {/* Vườn trả lại add-on đã thu tiền: lý do + số tiền hoàn (giá + 6%, BE tạo lệnh chi ngay) */}
                      {ad.status === 'REFUNDED' && (
                        <View style={{ marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' }}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#1E40AF', marginBottom: 4 }}>
                            Vườn đã trả lại dịch vụ này
                            {ad.refundedAt ? ` (${new Date(ad.refundedAt).toLocaleDateString('vi-VN')})` : ''}
                          </Text>
                          {ad.refundReason ? (
                            <Text style={{ fontSize: 12, color: '#1E3A8A', lineHeight: 18 }}>
                              <Text style={{ fontWeight: '700' }}>Lý do: </Text>
                              {ad.refundReason}
                            </Text>
                          ) : null}
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                            <Text style={{ fontSize: 12, color: '#1E3A8A' }}>Bạn được hoàn:</Text>
                            <Text style={{ fontSize: 13, fontWeight: '800', color: '#1E40AF' }}>
                              {Number(ad.amountDue || 0).toLocaleString('vi-VN')} VNĐ
                            </Text>
                          </View>
                          <Text style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                            LanCare sẽ chuyển khoản vào tài khoản ngân hàng trong hồ sơ của bạn.
                          </Text>
                        </View>
                      )}

                      {/* Completed Result Photos & Note */}
                      {ad.status === 'DONE' && (
                        <View style={{ marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 4 }}>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#065F46' }}>
                              ✓ Đã hoàn thành ({ad.doneAt ? new Date(ad.doneAt).toLocaleDateString('vi-VN') : ''})
                            </Text>
                            {ad.donePlantHealth ? (
                              <View style={{
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: 4,
                                backgroundColor:
                                  ad.donePlantHealth === 'GOOD'
                                    ? '#DEF7EC'
                                    : ad.donePlantHealth === 'AVERAGE'
                                    ? '#FEF08A'
                                    : '#FDE8E8',
                              }}>
                                <Text style={{
                                  fontSize: 10,
                                  fontWeight: '700',
                                  color:
                                    ad.donePlantHealth === 'GOOD'
                                      ? '#03543F'
                                      : ad.donePlantHealth === 'AVERAGE'
                                      ? '#713F12'
                                      : '#9B1C1C',
                                }}>
                                  {ad.donePlantHealth === 'GOOD'
                                    ? '🌿 Cây tốt'
                                    : ad.donePlantHealth === 'AVERAGE'
                                    ? '🌱 Trung bình'
                                    : '🥀 Cây kém'}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          {ad.doneNote ? (
                            <Text style={{ fontSize: 11, color: '#047857', marginBottom: 6 }}>
                              {ad.doneNote}
                            </Text>
                          ) : null}
                          {Array.isArray(ad.donePhotoUrls) && ad.donePhotoUrls.length > 0 && (
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                              {ad.donePhotoUrls.map((url, dIdx) => (
                                <TouchableOpacity
                                  key={`${ad.id}-done-${dIdx}`}
                                  activeOpacity={0.85}
                                  onPress={() => setPreviewImageUrl(url)}
                                >
                                  <Image source={{ uri: url }} style={styles.photoThumb} />
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                          )}
                        </View>
                      )}

                      {/* Actions for PENDING status */}
                      {ad.status === 'PENDING' && (
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EDF2F7' }}>
                          <Text style={{ fontSize: 11, color: '#D97706', marginBottom: 8 }}>
                            Hạn phản hồi: {new Date(ad.respondDueAt).toLocaleString('vi-VN')}
                          </Text>

                          <TextInput
                            value={addonNotes[ad.id] || ''}
                            onChangeText={(text) =>
                              setAddonNotes((prev) => ({ ...prev, [ad.id]: text }))
                            }
                            placeholder="Ghi chú phản hồi (tuỳ chọn)..."
                            style={{
                              borderWidth: 1,
                              borderColor: '#E2E8F0',
                              borderRadius: 8,
                              padding: 8,
                              fontSize: 12,
                              color: '#1A202C',
                              marginBottom: 10,
                              backgroundColor: '#FFFFFF',
                            }}
                          />

                          <View style={{ flexDirection: 'row', gap: 10 }}>
                            <TouchableOpacity
                              disabled={isResponding}
                              onPress={() => handleRespondAddon(ad.id, 'REJECT')}
                              style={{
                                flex: 1,
                                paddingVertical: 10,
                                borderRadius: 8,
                                borderWidth: 1,
                                borderColor: '#CBD5E0',
                                backgroundColor: '#FFFFFF',
                                alignItems: 'center',
                              }}
                            >
                              <Text style={{ fontSize: 13, fontWeight: '700', color: '#4A5568' }}>
                                Từ chối
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              disabled={isResponding}
                              onPress={() => handleRespondAddon(ad.id, 'ACCEPT')}
                              style={{
                                flex: 1.5,
                                paddingVertical: 10,
                                borderRadius: 8,
                                backgroundColor: '#6027D2',
                                alignItems: 'center',
                              }}
                            >
                              {isResponding ? (
                                <ActivityIndicator size="small" color="#FFFFFF" />
                              ) : (
                                <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>
                                  Đồng ý đề xuất
                                </Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}

                      {/* Action for ACCEPTED status: Pay via QR */}
                      {ad.status === 'ACCEPTED' && (
                        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EDF2F7' }}>
                          <Text style={{ fontSize: 11, color: '#2563EB', marginBottom: 8 }}>
                            Hạn chuyển khoản: {ad.paymentDueAt ? new Date(ad.paymentDueAt).toLocaleString('vi-VN') : '24 giờ'}
                          </Text>

                          <TouchableOpacity
                            onPress={() => handleOpenAddonPayment(ad)}
                            style={{
                              backgroundColor: '#2563EB',
                              paddingVertical: 11,
                              borderRadius: 8,
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 6,
                            }}
                          >
                            <Ionicons name="qr-code-outline" size={18} color="#FFFFFF" />
                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>
                              Quét VietQR thanh toán ({Number(ad.amountDue).toLocaleString('vi-VN')}đ)
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}

        {activeTab === 'support' && (
          <>
        {/* Call History Section */}
        {callHistory.length > 0 && (
          <View style={styles.card}>
            <View style={styles.historyHeader}>
              <Ionicons name="time-outline" size={18} color="#6027D2" />
              <Text style={styles.cardTitle}>Lịch sử cuộc gọi ({callHistory.length})</Text>
            </View>

            {callHistory.map((call) => {
              const reasonInfo =
                (call.endReason && CALL_END_REASON_MAP[call.endReason]) || {
                  label: call.endReason || 'Kết thúc',
                  color: '#6B7280',
                  bg: '#F3F4F6',
                };
              const roleText = call.myRole === 'CALLER' ? 'Bạn gọi đi' : 'Cuộc gọi đến';

              return (
                <View key={call.id} style={styles.historyItem}>
                  <View style={styles.historyLeft}>
                    <Ionicons
                      name={call.myRole === 'CALLER' ? 'call-outline' : 'videocam-outline'}
                      size={18}
                      color="#6027D2"
                    />
                    <View>
                      <Text style={styles.historyRole}>{roleText}</Text>
                      <Text style={styles.historyDate}>
                        {new Date(call.createdAt).toLocaleString('vi-VN')}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.historyRight}>
                    <View
                      style={[
                        styles.reasonBadge,
                        { backgroundColor: reasonInfo.bg },
                      ]}
                    >
                      <Text style={[styles.reasonText, { color: reasonInfo.color }]}>
                        {reasonInfo.label}
                      </Text>
                    </View>
                    {call.durationSeconds ? (
                      <Text style={styles.historyDuration}>
                        {formatSeconds(call.durationSeconds)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {order.status === 'RETURN_AWAITING_CONFIRM' && (
          <View style={[styles.card, { borderColor: '#FCA5A5', borderWidth: 1, backgroundColor: '#FEF2F2' }]}>
            <Text style={[styles.cardTitle, { color: '#991B1B', marginBottom: 6 }]}>
              Kiểm tra cây & Khiếu nại (trong 48h)
            </Text>
            <Text style={{ fontSize: 13, color: '#7F1D1D', marginBottom: 12, lineHeight: 18 }}>
              Nếu cây nhận lại bị hư hại, thối rễ hoặc không đúng mô tả, bạn có quyền mở tranh chấp để yêu cầu hoàn tiền công và bồi thường cây.
            </Text>
            <TouchableOpacity
              onPress={handleStartOpenDispute}
              style={{
                backgroundColor: '#DC2626',
                paddingVertical: 11,
                borderRadius: 10,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Ionicons name="alert-circle-outline" size={18} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>
                Mở khiếu nại / Tranh chấp
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {order.status === 'DISPUTED' && (
          <View style={[styles.card, { borderColor: '#DDD6FE', borderWidth: 1, backgroundColor: '#FAF8FE' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={[styles.cardTitle, { color: '#6027D2', marginBottom: 0 }]}>
                Đang giải quyết tranh chấp (3 ngày)
              </Text>
              <View style={{ backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: '700' }}>DISPUTED</Text>
              </View>
            </View>
            <Text style={{ fontSize: 13, color: '#4B4764', marginBottom: 12, lineHeight: 18 }}>
              Đơn hàng đang trong quá trình tự thương lượng giữa bạn và nhà vườn. Bạn có thể xem đề xuất bồi thường, gửi đề xuất mới hoặc rút khiếu nại.
            </Text>
            <TouchableOpacity
              onPress={handleOpenDisputeRoom}
              style={{
                backgroundColor: '#6027D2',
                paddingVertical: 11,
                borderRadius: 10,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Ionicons name="chatbubbles-outline" size={18} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>
                Xem hồ sơ tranh chấp & Thương lượng
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {callHistory.length === 0 &&
          !['HANDOVER_IN_PROGRESS', 'HANDOVER_AWAITING_CONFIRM', 'IN_CARE', 'DISPUTED'].includes(order.status) && (
            <View style={styles.card}>
              <Text style={styles.emptyText}>Chưa có lịch sử cuộc gọi hoặc khiếu nại nào.</Text>
            </View>
          )}
          </>
        )}
      </ScrollView>

      {/* Contract Modal */}
      <Modal
        visible={contractModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setContractModalVisible(false)}
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => setContractModalVisible(false)}
              style={styles.modalCloseBtn}
            >
              <Ionicons name="close" size={24} color="#1A202C" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Hợp đồng dịch vụ</Text>
            <View style={{ width: 40 }} />
          </View>

          {contractLoading ? (
            <View style={styles.modalLoadingArea}>
              <ActivityIndicator size="large" color="#6027D2" />
              <Text style={styles.loadingText}>Đang tải hợp đồng...</Text>
            </View>
          ) : contractData ? (
            (() => {
              const customerParty =
                contractData.parties?.customer ||
                contractData.customerParty ||
                {};
              const providerParty =
                contractData.parties?.provider ||
                contractData.providerParty ||
                {};

              const customerName =
                customerParty.fullName && customerParty.fullName !== 'Chưa cung cấp'
                  ? customerParty.fullName
                  : order.customerNote || 'Khách hàng';
              const customerPhone =
                customerParty.phone && customerParty.phone !== 'Chưa cung cấp'
                  ? customerParty.phone
                  : 'Chưa cập nhật SĐT';
              const customerAddress =
                customerParty.address && customerParty.address !== 'Chưa cung cấp'
                  ? customerParty.address
                  : order.pickupAddress || 'Chưa cập nhật địa chỉ';

              const providerName =
                providerParty.fullName && providerParty.fullName !== 'Chưa cung cấp'
                  ? providerParty.fullName
                  : order.provider?.gardenName || 'Nhà vườn';
              const providerPhone =
                providerParty.phone && providerParty.phone !== 'Chưa cung cấp'
                  ? providerParty.phone
                  : order.provider?.phone || 'Chưa cập nhật SĐT';
              const providerAddress =
                providerParty.address && providerParty.address !== 'Chưa cung cấp'
                  ? providerParty.address
                  : order.provider?.address || 'Chưa cập nhật địa chỉ';

              const agreementNumber =
                contractData.agreementNo ||
                contractData.agreement?.agreementNo ||
                `HĐ-${order.orderCode}`;

              const agreementDate =
                contractData.createdAt ||
                contractData.agreement?.createdAt ||
                order.createdAt;

              // BE getContractDetail ưu tiên trả chữ ký HANDOVER (chỉ có Customer ký lúc bàn giao),
              // nên khi đơn đã qua giai đoạn AGREEMENT_PENDING thì cả 2 bên đều đã ký hợp đồng điện tử trước đó.
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
              ].includes(order.status);

              const isCustomerSigned =
                Boolean(
                  contractData.signatures?.some(
                    (s: any) =>
                      (s.role === 'CUSTOMER' || s.signerRole === 'CUSTOMER') &&
                      (s.signedAt || s.signatureHash)
                  )
                ) || isPastAgreementPending;
              const isProviderSigned =
                Boolean(
                  contractData.signatures?.some(
                    (s: any) =>
                      (s.role === 'PROVIDER' || s.signerRole === 'PROVIDER') &&
                      (s.signedAt || s.signatureHash)
                  )
                ) || isPastAgreementPending;

              const customerSig = contractData.signatures?.find(
                (s: any) => s.role === 'CUSTOMER' || s.signerRole === 'CUSTOMER'
              );
              const providerSig = contractData.signatures?.find(
                (s: any) => s.role === 'PROVIDER' || s.signerRole === 'PROVIDER'
              );

              const pricing = contractData.pricing || {};
              const orderSummary = contractData.orderSummary || {};

              const defaultClauses = [
                'Điều 1 – Phạm vi dịch vụ: Bên B (Nhà vườn) cam kết thực hiện dịch vụ chăm sóc hoa lan theo đúng quy trình gói dịch vụ đã chọn, bao gồm tưới nước, bón phân, điều chỉnh ánh sáng, phòng trừ sâu bệnh và các kỹ thuật chuyên sâu theo từng dòng lan.',
                'Điều 2 – Tiếp nhận bàn giao: Bên B (Nhà vườn) xác nhận tiếp nhận cây từ Bên A (Khách hàng) theo đúng hình ảnh chụp ban đầu và kết quả khảo sát qua video call, bao gồm số lượng, loài lan và hiện trạng thực tế.',
                'Điều 3 – Trách nhiệm vận chuyển: Nếu xảy ra tình trạng cây bị thất lạc hoặc hư hỏng dẫn đến hậu quả nghiêm trọng trong quá trình vận chuyển giao nhận, Bên B cam kết bồi thường tối đa 100% giá trị khai báo của cây (cây không khai giá: tối đa 2 lần giá gói).',
                'Điều 4 – Trách nhiệm chăm sóc: Trong suốt thời gian chăm sóc tại nhà vườn, nếu cây bị suy yếu nặng, chết hoặc thất lạc do lỗi chăm sóc kỹ thuật, Bên B chịu trách nhiệm bồi thường cho Bên A mức tối đa bằng 100% giá trị khai báo của cây (cây không khai giá: tối đa 2 lần giá gói).',
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
                <View style={{ flex: 1 }}>
                  <ScrollView style={styles.modalScrollView} contentContainerStyle={styles.modalScrollContent}>
                    {/* Header Quốc hiệu & Tiêu ngữ */}
                    <View style={styles.contractCard}>
                      <View style={styles.nationHeaderBox}>
                        <Text style={styles.nationTitle}>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</Text>
                        <Text style={styles.nationSubtitle}>Độc lập – Tự do – Hạnh phúc</Text>
                        <View style={styles.nationDivider} />
                      </View>

                      <Text style={styles.contractDocTitle}>HỢP ĐỒNG DỊCH VỤ CHĂM SÓC HOA LAN ĐIỆN TỬ</Text>
                      <Text style={styles.contractNumber}>Số HĐ: {agreementNumber}</Text>
                      <Text style={styles.contractDate}>
                        Mã đơn: {order.orderCode} • Ngày lập: {new Date(agreementDate).toLocaleDateString('vi-VN')}
                      </Text>

                      {/* Legal basis */}
                      <View style={styles.legalBasisBox}>
                        <Text style={styles.legalBasisText}>
                          • Căn cứ Bộ luật Dân sự số 91/2015/QH13 ngày 24/11/2015;{'\n'}
                          • Căn cứ Luật Giao dịch điện tử số 20/2023/QH15 ngày 22/06/2023;{'\n'}
                          • Căn cứ thỏa thuận tự nguyện và khảo sát trực tuyến trên Nền tảng LanCare Hub.
                        </Text>
                      </View>
                    </View>

                    {/* Parties info */}
                    <View style={styles.contractCard}>
                      <Text style={styles.contractSectionTitle}>I. CÁC BÊN GIAO KẾT</Text>
                      <View style={styles.partyBox}>
                        <Text style={styles.partyRole}>BÊN A (BÊN THUÊ DỊCH VỤ / KHÁCH HÀNG):</Text>
                        <Text style={styles.partyName}>{customerName}</Text>
                        <Text style={styles.partyDetail}>SĐT: {customerPhone}</Text>
                        <Text style={styles.partyDetail}>Địa chỉ: {customerAddress}</Text>
                        <Text style={styles.partyDetail}>
                          Số CCCD: {customerParty.identityNumber && customerParty.identityNumber !== 'Chưa cung cấp' ? customerParty.identityNumber : 'Chưa cập nhật'}
                        </Text>
                      </View>

                      <View style={[styles.partyBox, { marginTop: 10, borderLeftColor: '#16A34A' }]}>
                        <Text style={[styles.partyRole, { color: '#16A34A' }]}>BÊN B (BÊN CUNG CẤP DỊCH VỤ / NHÀ VƯỜN):</Text>
                        <Text style={styles.partyName}>{providerName}</Text>
                        <Text style={styles.partyDetail}>SĐT: {providerPhone}</Text>
                        <Text style={styles.partyDetail}>Địa chỉ vườn: {providerAddress}</Text>
                        <Text style={styles.partyDetail}>
                          Định danh/GPKD: {providerParty.identityNumber && providerParty.identityNumber !== 'Chưa cung cấp' ? providerParty.identityNumber : 'Đã xác minh'}
                        </Text>
                      </View>
                    </View>

                    {/* Service & Schedule info */}
                    <View style={styles.contractCard}>
                      <Text style={styles.contractSectionTitle}>II. GÓI DỊCH VỤ & LỊCH TRÌNH THỰC HIỆN</Text>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Gói dịch vụ:</Text>
                        <Text style={styles.infoValue}>{orderSummary.servicePackageName || 'Chăm sóc hoa lan chuyên sâu'}</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Thời gian chăm sóc:</Text>
                        <Text style={[styles.infoValue, { color: '#6027D2', fontWeight: '700' }]}>
                          {orderSummary.durationDays || order.durationDaysSnapshot || 30} ngày
                        </Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Tần suất báo cáo:</Text>
                        <Text style={styles.infoValue}>
                          Mỗi {orderSummary.reportFrequencyDays || order.reportFrequencySnapshot || 7} ngày/lần kèm ảnh hiện trạng
                        </Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Hẹn lấy cây:</Text>
                        <Text style={styles.infoValue}>
                          {orderSummary.scheduledPickupAt ? new Date(orderSummary.scheduledPickupAt).toLocaleDateString('vi-VN') : 'Theo lịch hẹn'}
                        </Text>
                      </View>
                      <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                        <Text style={styles.infoLabel}>Địa chỉ lấy:</Text>
                        <Text style={[styles.infoValue, { flex: 1, textAlign: 'right' }]}>
                          {orderSummary.pickupAddress || order.pickupAddress || customerAddress}
                        </Text>
                      </View>
                    </View>

                    {/* Plants list */}
                    <View style={styles.contractCard}>
                      <Text style={styles.contractSectionTitle}>
                        III. DANH MỤC CÂY GIAO NHẬN ({contractData.plants?.length || 0} chậu)
                      </Text>
                      {contractData.plants?.map((plant: any, index: number) => {
                        const declared = plant.declaredValue ? Number(plant.declaredValue) : 0;
                        // Mức đền theo luật đền thật của BE (orders/compensation-cap.ts): 100% giá khai; không khai = 2 × giá gói.
                        const comp = plant.isValueDeclared && declared > 0
                          ? declared
                          : 2 * Number(pricing.basePricePerPlant || 0);

                        return (
                          <View key={index} style={styles.contractPlantItem}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Text style={styles.contractPlantName}>
                                {index + 1}. {plant.name}
                              </Text>
                              <Text style={{ fontSize: 11, color: '#718096', fontStyle: 'italic' }}>
                                {plant.speciesName || 'Chưa định danh'}
                              </Text>
                            </View>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                              <Text style={styles.contractPlantValue}>
                                Giá trị: {declared > 0 ? `${declared.toLocaleString('vi-VN')} VNĐ` : 'Không khai báo'}
                              </Text>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#DC2626' }}>
                                Đền tối đa (100%): {comp > 0 ? `${comp.toLocaleString('vi-VN')} VNĐ` : 'Theo giá gói'}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>

                    {/* Pricing & Escrow */}
                    <View style={styles.contractCard}>
                      <Text style={styles.contractSectionTitle}>IV. CHI PHÍ DỊCH VỤ & LANCARE ESCROW</Text>
                      <View style={styles.pricingRow}>
                        <Text style={styles.pricingLabel}>Phí chăm sóc tạm tính:</Text>
                        <Text style={styles.pricingValue}>
                          {Number(pricing.provisionalTotal || order.provisionalTotal || 0).toLocaleString('vi-VN')} VNĐ
                        </Text>
                      </View>
                      <View style={styles.pricingRow}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={styles.pricingLabel}>Phí vận chuyển giao nhận:</Text>
                          {orderDistanceKm !== null ? (
                            <Text style={{ fontSize: 11, color: '#6027D2', marginTop: 1, fontWeight: '500' }}>
                              (Khoảng cách định vị: ~{orderDistanceKm} km)
                            </Text>
                          ) : null}
                        </View>
                        <Text style={styles.pricingValue}>
                          {Number(pricing.pickupFee || order.pickupFeeSnapshot || 0).toLocaleString('vi-VN')} VNĐ
                        </Text>
                      </View>
                      <View style={[styles.pricingRow, { borderBottomWidth: 0, paddingTop: 8 }]}>
                        <Text style={[styles.pricingLabel, { fontWeight: '700', color: '#1A202C' }]}>TỔNG CỘNG:</Text>
                        <Text style={[styles.pricingValue, { fontSize: 15, fontWeight: '800', color: '#6027D2' }]}>
                          {Number(
                            pricing.grandTotal ||
                            (Number(pricing.provisionalTotal || order.provisionalTotal || 0) +
                             Number(pricing.pickupFee || order.pickupFeeSnapshot || 0))
                          ).toLocaleString('vi-VN')} VNĐ
                        </Text>
                      </View>
                      <View style={[styles.clauseHighlight, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', marginTop: 8 }]}>
                        <Ionicons name="shield-checkmark" size={18} color="#2563EB" />
                        <Text style={[styles.clauseHighlightText, { color: '#1E40AF', fontSize: 11 }]}>
                          Bảo chứng LanCare Escrow: Toàn bộ chi phí được hệ thống tạm giữ an toàn và chỉ thanh toán cho Nhà vườn sau khi bạn kiểm tra và xác nhận bàn giao nhận lại cây đạt yêu cầu.
                        </Text>
                      </View>
                    </View>

                    {/* Compensation policy */}
                    <View style={styles.contractCard}>
                      <Text style={styles.contractSectionTitle}>V. CHÍNH SÁCH BỒI THƯỜNG THIỆT HẠI (TỐI ĐA 100%)</Text>
                      <View style={styles.clauseHighlight}>
                        <Ionicons name="shield-checkmark" size={20} color="#059669" />
                        <Text style={styles.clauseHighlightText}>
                          Cam kết bồi thường tối đa 100% giá trị khai báo của cây (cây không khai giá: tối đa 2 lần giá gói) nếu xảy ra rủi ro trong suốt quá trình chăm sóc hoặc vận chuyển theo thỏa thuận.
                        </Text>
                      </View>
                      <Text style={styles.clauseSummary}>
                        • Áp dụng khi cây chết, thối ngọn/thối rễ nghiêm trọng do lỗi kỹ thuật chăm sóc của Nhà vườn{'\n'}
                        • Áp dụng khi cây bị dập nát, gãy hỏng nặng hoặc thất lạc trong quá trình vận chuyển giao nhận
                      </Text>
                    </View>

                    {/* Clauses */}
                    <View style={styles.contractCard}>
                      <Text style={styles.contractSectionTitle}>VI. CÁC ĐIỀU KHOẢN THỎA THUẬN CHUNG</Text>
                      {clausesToRender.map((clause: string, cIdx: number) => (
                        <View key={cIdx} style={{ marginBottom: 8 }}>
                          <Text style={{ fontSize: 11.5, color: '#2D3748', lineHeight: 18 }}>
                            <Text style={{ fontWeight: '700', color: '#1A202C' }}>{clause.split(':')[0]}:</Text>
                            {clause.includes(':') ? clause.substring(clause.indexOf(':') + 1) : clause}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {/* Signatures status */}
                    <View style={styles.contractCard}>
                      <Text style={styles.contractSectionTitle}>VII. TÌNH TRẠNG CHỮ KÝ ĐIỆN TỬ</Text>
                      <View style={styles.signatureRow}>
                        <View style={[styles.signatureBlock, isCustomerSigned && { borderColor: '#10B981', backgroundColor: '#F0FDF4' }]}>
                          <Text style={styles.sigRole}>Bên A (Khách hàng)</Text>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#1A202C', marginBottom: 4 }}>
                            {customerSig?.signerName || customerName}
                          </Text>
                          {isCustomerSigned ? (
                            <View style={styles.signedBadge}>
                              <Ionicons name="checkmark-circle" size={14} color="#059669" />
                              <Text style={styles.signedText}>ĐÃ KÝ ĐIỆN TỬ</Text>
                            </View>
                          ) : (
                            <Text style={styles.unsignedText}>Chưa ký</Text>
                          )}
                        </View>
                        <View style={[styles.signatureBlock, isProviderSigned && { borderColor: '#10B981', backgroundColor: '#F0FDF4' }]}>
                          <Text style={styles.sigRole}>Bên B (Nhà vườn)</Text>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#1A202C', marginBottom: 4 }}>
                            {providerSig?.signerName || providerName}
                          </Text>
                          {isProviderSigned ? (
                            <View style={styles.signedBadge}>
                              <Ionicons name="checkmark-circle" size={14} color="#059669" />
                              <Text style={styles.signedText}>ĐÃ KÝ ĐIỆN TỬ</Text>
                            </View>
                          ) : (
                            <Text style={styles.unsignedText}>Chưa ký</Text>
                          )}
                        </View>
                      </View>
                    </View>
                  </ScrollView>

                  {/* Bottom sign button inside modal if not yet signed */}
                  {order.status === 'AGREEMENT_PENDING' && !isCustomerSigned ? (
                    <View style={styles.modalBottomBar}>
                      <TouchableOpacity
                        style={styles.modalSignBtn}
                        onPress={handlePromptSignContract}
                        disabled={signingLoading}
                        activeOpacity={0.85}
                      >
                        {signingLoading ? (
                          <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                          <>
                            <Ionicons name="finger-print" size={20} color="#FFFFFF" />
                            <Text style={styles.modalSignBtnText}>Tôi đồng ý & Ký hợp đồng điện tử</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              );
            })()
          ) : (
            <View style={styles.modalLoadingArea}>
              <Text style={styles.errorText}>Không thể hiển thị thông tin hợp đồng.</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* Signature Confirmation Modal */}
      <Modal
        visible={signConfirmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!signingLoading) setSignConfirmModalVisible(false);
        }}
      >
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmHeader}>
              <View style={styles.confirmIconCircle}>
                <Ionicons name="document-text" size={26} color="#6027D2" />
              </View>
              <Text style={styles.confirmTitle}>Xác nhận Ký Hợp đồng</Text>
              <Text style={styles.confirmSub}>Hợp đồng dịch vụ chăm sóc hoa lan LanCare</Text>
            </View>

            <View style={styles.confirmSummaryBox}>
              <View style={styles.confirmSummaryRow}>
                <Text style={styles.confirmSummaryLabel}>Mã đơn hàng:</Text>
                <Text style={styles.confirmSummaryVal}>{order?.orderCode || 'N/A'}</Text>
              </View>
              <View style={styles.confirmSummaryRow}>
                <Text style={styles.confirmSummaryLabel}>Khách hàng:</Text>
                <Text style={styles.confirmSummaryVal}>
                  {contractData?.parties?.customer?.fullName || (order as any)?.customer?.fullName || 'Khách hàng'}
                </Text>
              </View>
              <View style={styles.confirmSummaryRow}>
                <Text style={styles.confirmSummaryLabel}>Nhà vườn:</Text>
                <Text style={styles.confirmSummaryVal}>
                  {contractData?.parties?.provider?.fullName || order?.provider?.gardenName || 'Nhà vườn'}
                </Text>
              </View>
              {Number(order?.pickupFeeSnapshot || 0) > 0 ? (
                <View style={styles.confirmSummaryRow}>
                  <Text style={styles.confirmSummaryLabel}>Phí vận chuyển:</Text>
                  <Text style={styles.confirmSummaryVal}>
                    {Number(order?.pickupFeeSnapshot || 0).toLocaleString('vi-VN')} VNĐ
                    {orderDistanceKm !== null ? ` (~${orderDistanceKm} km)` : ''}
                  </Text>
                </View>
              ) : null}
              <View style={[styles.confirmSummaryRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
                <Text style={styles.confirmSummaryLabel}>Tổng chi phí:</Text>
                <Text style={[styles.confirmSummaryVal, { color: '#6027D2', fontWeight: '800' }]}>
                  {(
                    Number(order?.provisionalTotal || 0) +
                    Number(order?.pickupFeeSnapshot || 0)
                  ).toLocaleString('vi-VN')} VNĐ
                </Text>
              </View>
            </View>

            <View style={styles.confirmLegalBox}>
              <Ionicons name="shield-checkmark" size={18} color="#C05621" style={{ marginTop: 2 }} />
              <Text style={styles.confirmLegalText}>
                Quý khách xác nhận giao cây cho nhà vườn theo gói dịch vụ đã chọn và cam kết tuân thủ các điều khoản thanh toán, nhận bàn giao theo hợp đồng điện tử. Chữ ký này có giá trị pháp lý ràng buộc.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setCustomerAgreedTerms(!customerAgreedTerms)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={customerAgreedTerms ? 'checkbox' : 'square-outline'}
                size={22}
                color={customerAgreedTerms ? '#6027D2' : '#A0AEC0'}
              />
              <Text style={styles.checkboxLabel}>
                Tôi đã đọc kỹ, hiểu rõ và đồng ý với tất cả điều khoản hợp đồng & chính sách bồi thường tối đa 100%.
              </Text>
            </TouchableOpacity>

            <View style={styles.confirmActionRow}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setSignConfirmModalVisible(false)}
                disabled={signingLoading}
              >
                <Text style={styles.confirmCancelText}>Xem lại</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.confirmSubmitBtn,
                  (!customerAgreedTerms || signingLoading) && { opacity: 0.5 },
                ]}
                onPress={handleConfirmSignContract}
                disabled={!customerAgreedTerms || signingLoading}
              >
                {signingLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.confirmSubmitText}>Xác nhận & Ký ngay</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* VietQR Payment Modal */}
      <Modal
        visible={paymentModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPaymentModalVisible(false)}
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => setPaymentModalVisible(false)}
              style={styles.modalCloseBtn}
            >
              <Ionicons name="close" size={24} color="#1A202C" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Thanh toán VietQR</Text>
            <View style={{ width: 40 }} />
          </View>

          {paymentLoading ? (
            <View style={styles.modalLoadingArea}>
              <ActivityIndicator size="large" color="#3182CE" />
              <Text style={styles.loadingText}>Đang tạo mã VietQR thanh toán...</Text>
            </View>
          ) : paymentQrData ? (
            <ScrollView style={styles.modalScrollView} contentContainerStyle={styles.paymentScrollContent}>
              {/* QR Image Box */}
              <View style={styles.qrContainer}>
                <Image
                  source={{ uri: paymentQrData.qrImageUrl }}
                  style={styles.qrImage}
                  resizeMode="contain"
                />
                <Text style={styles.qrScanGuide}>Quét mã QR bằng ứng dụng ngân hàng bất kỳ</Text>
              </View>

              {/* Transfer Details Card */}
              <View style={styles.paymentCard}>
                <Text style={styles.paymentCardTitle}>Thông tin chuyển khoản</Text>

                <View style={styles.payInfoRow}>
                  <Text style={styles.payInfoLabel}>Ngân hàng nhận:</Text>
                  <Text style={styles.payInfoValue}>{paymentQrData.bankBin || 'Hệ thống Napas'}</Text>
                </View>

                <View style={styles.payInfoRow}>
                  <Text style={styles.payInfoLabel}>Số tài khoản:</Text>
                  <Text style={[styles.payInfoValue, styles.highlightValue]} selectable>
                    {paymentQrData.bankAccountNumber}
                  </Text>
                </View>

                <View style={styles.payInfoRow}>
                  <Text style={styles.payInfoLabel}>Chủ tài khoản:</Text>
                  <Text style={styles.payInfoValue} selectable>
                    {paymentQrData.bankAccountName}
                  </Text>
                </View>

                <View style={styles.payInfoRow}>
                  <Text style={styles.payInfoLabel}>Số tiền cần chuyển:</Text>
                  <Text style={[styles.payInfoValue, styles.amountHighlight]} selectable>
                    {Number(paymentQrData.amount || 0).toLocaleString('vi-VN')} VNĐ
                  </Text>
                </View>

                {Number(order?.pickupFeeSnapshot || 0) > 0 ? (
                  <View style={styles.payBreakdownBox}>
                    <Ionicons name="information-circle" size={16} color="#6027D2" />
                    <Text style={styles.payBreakdownText}>
                      Gồm: Gói chăm sóc ({Number(order?.provisionalTotal || 0).toLocaleString('vi-VN')}đ) + Phí lấy cây ({Number(order?.pickupFeeSnapshot || 0).toLocaleString('vi-VN')}đ{orderDistanceKm !== null ? ` cho ~${orderDistanceKm} km` : ''})
                    </Text>
                  </View>
                ) : null}

                <View style={[styles.payInfoRow, styles.memoBox]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memoLabel}>Nội dung chuyển khoản (bắt buộc):</Text>
                    <Text style={styles.memoValue} selectable>
                      {paymentQrData.transferContent}
                    </Text>
                    <Text style={styles.memoWarning}>
                      * Vui lòng giữ nguyên nội dung này để SePay tự động xác nhận đơn.
                    </Text>
                  </View>
                </View>
              </View>

              {/* Check Payment Button */}
              <TouchableOpacity
                style={styles.checkPaymentBtn}
                onPress={handleCheckPaymentStatus}
                disabled={checkingPayment}
                activeOpacity={0.85}
              >
                {checkingPayment ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Ionicons name="refresh-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.checkPaymentBtnText}>Tôi đã chuyển khoản - Kiểm tra trạng thái</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          ) : (
            <View style={styles.modalLoadingArea}>
              <Text style={styles.errorText}>Không thể tạo thông tin thanh toán.</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* Addon VietQR Payment Modal */}
      <Modal
        visible={addonPaymentModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAddonPaymentModalVisible(false)}
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => setAddonPaymentModalVisible(false)}
              style={styles.modalCloseBtn}
            >
              <Ionicons name="close" size={24} color="#1A202C" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Thanh toán dịch vụ thêm</Text>
            <View style={{ width: 40 }} />
          </View>

          {addonQrLoading ? (
            <View style={styles.modalLoadingArea}>
              <ActivityIndicator size="large" color="#6027D2" />
              <Text style={styles.loadingText}>Đang tạo mã VietQR dịch vụ thêm...</Text>
            </View>
          ) : selectedAddonQr ? (
            <ScrollView style={styles.modalScrollView} contentContainerStyle={styles.paymentScrollContent}>
              {/* QR Image Box */}
              <View style={styles.qrContainer}>
                <Image
                  source={{ uri: selectedAddonQr.qrImageUrl }}
                  style={styles.qrImage}
                  resizeMode="contain"
                />
                <Text style={styles.qrScanGuide}>Quét mã QR bằng ứng dụng ngân hàng bất kỳ</Text>
              </View>

              {/* Transfer Details Card */}
              <View style={styles.paymentCard}>
                <Text style={styles.paymentCardTitle}>
                  {selectedAddonForPayment?.title || 'Thông tin chuyển khoản'}
                </Text>

                <View style={styles.payInfoRow}>
                  <Text style={styles.payInfoLabel}>Ngân hàng nhận:</Text>
                  <Text style={styles.payInfoValue}>{selectedAddonQr.bankBin || 'Hệ thống Napas'}</Text>
                </View>

                <View style={styles.payInfoRow}>
                  <Text style={styles.payInfoLabel}>Số tài khoản:</Text>
                  <Text style={[styles.payInfoValue, styles.highlightValue]} selectable>
                    {selectedAddonQr.bankAccountNumber}
                  </Text>
                </View>

                <View style={styles.payInfoRow}>
                  <Text style={styles.payInfoLabel}>Chủ tài khoản:</Text>
                  <Text style={styles.payInfoValue} selectable>
                    {selectedAddonQr.bankAccountName}
                  </Text>
                </View>

                <View style={styles.payInfoRow}>
                  <Text style={styles.payInfoLabel}>Số tiền cần chuyển:</Text>
                  <Text style={[styles.payInfoValue, styles.amountHighlight]} selectable>
                    {Number(selectedAddonQr.amount || 0).toLocaleString('vi-VN')} VNĐ
                  </Text>
                </View>

                <View style={styles.payBreakdownBox}>
                  <Ionicons name="information-circle" size={16} color="#6027D2" />
                  <Text style={styles.payBreakdownText}>
                    Gồm: Giá dịch vụ ({Number(selectedAddonForPayment?.price || 0).toLocaleString('vi-VN')}đ) + Phí nền tảng 6% ({Number(selectedAddonForPayment?.customerFee || 0).toLocaleString('vi-VN')}đ)
                  </Text>
                </View>

                <View style={[styles.payInfoRow, styles.memoBox]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memoLabel}>Nội dung chuyển khoản (bắt buộc):</Text>
                    <Text style={styles.memoValue} selectable>
                      {selectedAddonQr.transferContent}
                    </Text>
                    <Text style={styles.memoWarning}>
                      * Vui lòng giữ nguyên mã {selectedAddonQr.transferContent} để SePay tự động xác nhận tiền add-on.
                    </Text>
                  </View>
                </View>
              </View>

              {/* Check Payment Button */}
              <TouchableOpacity
                style={[styles.checkPaymentBtn, { backgroundColor: '#6027D2' }]}
                onPress={handleCheckAddonPaymentStatus}
                disabled={checkingAddonPayment}
                activeOpacity={0.85}
              >
                {checkingAddonPayment ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Ionicons name="refresh-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.checkPaymentBtnText}>Tôi đã chuyển khoản - Kiểm tra trạng thái</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          ) : (
            <View style={styles.modalLoadingArea}>
              <Text style={styles.errorText}>Không thể tạo thông tin thanh toán.</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* Modal 1: Mở tranh chấp mới (dành cho Khách hàng lúc nhận lại cây) */}
      <Modal
        visible={openDisputeModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!disputeSubmitting) setOpenDisputeModalVisible(false);
        }}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F8F9FA' }}>
          <View style={styles.modalHeader}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A202C' }}>
              Mở khiếu nại tranh chấp
            </Text>
            <TouchableOpacity
              onPress={() => !disputeSubmitting && setOpenDisputeModalVisible(false)}
              style={{ padding: 6 }}
            >
              <Ionicons name="close" size={24} color="#4A5568" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <View style={{ backgroundColor: '#FEF2F2', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#FCA5A5', marginBottom: 16 }}>
              <Text style={{ fontSize: 12, color: '#991B1B', lineHeight: 18 }}>
                ⚠️ Bạn có 48 giờ sau khi nhận lại cây để mở tranh chấp nếu cây bị hư hại, chết hoặc không đúng chậu. Sau khi gửi, hai bên sẽ có 3 ngày để tự thương lượng bồi hoàn.
              </Text>
            </View>

            {/* Chọn cây bị khiếu nại */}
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A202C', marginBottom: 8 }}>
              1. Chọn cây lan bị khiếu nại (tối thiểu 1 cây) *
            </Text>
            <View style={{ marginBottom: 14 }}>
              {(order.plants || []).map((pl: any, idx: number) => {
                const isSelected = selectedDisputePlantIds.includes(pl.id);
                return (
                  <TouchableOpacity
                    key={pl.id || idx}
                    onPress={() => {
                      if (isSelected) {
                        if (selectedDisputePlantIds.length > 1) {
                          setSelectedDisputePlantIds((prev) => prev.filter((id) => id !== pl.id));
                        }
                      } else {
                        setSelectedDisputePlantIds((prev) => [...prev, pl.id]);
                      }
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 12,
                      backgroundColor: isSelected ? '#EFF6FF' : '#FFFFFF',
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: isSelected ? '#3B82F6' : '#E2E8F0',
                      marginBottom: 8,
                    }}
                  >
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={isSelected ? '#2563EB' : '#A0AEC0'}
                      style={{ marginRight: 10 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A202C' }}>
                        🌿 {pl.name || `Chậu lan #${idx + 1}`}
                      </Text>
                      {pl.customNote ? (
                        <Text style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>{pl.customNote}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Lý do khiếu nại */}
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A202C', marginBottom: 6 }}>
              2. Tiêu đề / Lý do khiếu nại *
            </Text>
            <TextInput
              value={disputeReasonText}
              onChangeText={setDisputeReasonText}
              placeholder="VD: Cây bị thối rễ, héo lá không cứu được..."
              style={{
                backgroundColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: '#CBD5E0',
                borderRadius: 10,
                padding: 12,
                fontSize: 13,
                color: '#1A202C',
                marginBottom: 14,
              }}
            />

            {/* Mô tả chi tiết */}
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A202C', marginBottom: 6 }}>
              3. Mô tả chi tiết vấn đề gặp phải *
            </Text>
            <TextInput
              multiline
              numberOfLines={4}
              value={disputeDescription}
              onChangeText={setDisputeDescription}
              placeholder="Mô tả cụ thể tình trạng lúc nhận cây, đối chiếu với ảnh ban đầu để làm căn cứ thương lượng..."
              style={{
                backgroundColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: '#CBD5E0',
                borderRadius: 10,
                padding: 12,
                minHeight: 90,
                textAlignVertical: 'top',
                fontSize: 13,
                color: '#1A202C',
                marginBottom: 14,
              }}
            />

            {/* Ảnh bằng chứng */}
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A202C', marginBottom: 6 }}>
              4. Ảnh chụp bằng chứng thực tế (tối thiểu 1 ảnh, tối đa 10 ảnh) *
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {disputeEvidence.map((ev, idx) => (
                <View key={`ev-${idx}`} style={{ position: 'relative' }}>
                  <Image
                    source={{ uri: ev.photoUrl }}
                    style={{ width: 72, height: 72, borderRadius: 8, backgroundColor: '#EDF2F7' }}
                  />
                  <TouchableOpacity
                    onPress={() => setDisputeEvidence((prev) => prev.filter((_, i) => i !== idx))}
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: '#DC2626',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}

              {disputeEvidence.length < 10 && (
                <TouchableOpacity
                  onPress={() => handlePickDisputePhoto(false)}
                  disabled={disputeUploading}
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderStyle: 'dashed',
                    borderColor: '#DC2626',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#FEF2F2',
                  }}
                >
                  {disputeUploading ? (
                    <ActivityIndicator size="small" color="#DC2626" />
                  ) : (
                    <>
                      <Ionicons name="camera-outline" size={22} color="#DC2626" />
                      <Text style={{ fontSize: 10, color: '#DC2626', fontWeight: '600', marginTop: 2 }}>
                        Chụp ảnh
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {/* 5. Thông tin tài khoản ngân hàng nhận tiền bồi hoàn */}
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A202C', marginBottom: 6 }}>
              5. Tài khoản ngân hàng nhận tiền bồi hoàn *
            </Text>
            <View
              style={{
                backgroundColor: '#F8FAFC',
                padding: 14,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: '#E2E8F0',
                marginBottom: 20,
              }}
            >
              <Text style={{ fontSize: 12, color: '#64748B', lineHeight: 17, marginBottom: 12 }}>
                ℹ️ Hệ thống sẽ chuyển tiền hoàn gói hoặc tiền bồi thường (nếu có) vào tài khoản này sau khi kết thúc thương lượng hoặc có phán quyết từ Admin.
              </Text>

              <View style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#334155', marginBottom: 4 }}>
                  Tên ngân hàng *:
                </Text>
                <TextInput
                  value={disputeBankName}
                  onChangeText={setDisputeBankName}
                  placeholder="Ví dụ: Vietcombank, MB Bank, Techcombank..."
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderWidth: 1,
                    borderColor: '#CBD5E1',
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    fontSize: 13,
                    color: '#1A202C',
                  }}
                />
              </View>

              <View style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#334155', marginBottom: 4 }}>
                  Số tài khoản *:
                </Text>
                <TextInput
                  value={disputeBankAccount}
                  onChangeText={setDisputeBankAccount}
                  keyboardType="numeric"
                  placeholder="Ví dụ: 0123456789"
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderWidth: 1,
                    borderColor: '#CBD5E1',
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    fontSize: 13,
                    color: '#1A202C',
                  }}
                />
              </View>

              <View>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#334155', marginBottom: 4 }}>
                  Tên chủ tài khoản (in hoa không dấu) *:
                </Text>
                <TextInput
                  value={disputeBankHolder}
                  onChangeText={setDisputeBankHolder}
                  autoCapitalize="characters"
                  placeholder="Ví dụ: NGUYEN VAN A"
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderWidth: 1,
                    borderColor: '#CBD5E1',
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    fontSize: 13,
                    color: '#1A202C',
                  }}
                />
              </View>
            </View>

            <TouchableOpacity
              onPress={handleSubmitOpenDispute}
              disabled={disputeSubmitting}
              style={{
                backgroundColor: '#DC2626',
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: 'center',
              }}
            >
              {disputeSubmitting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 15 }}>
                  Xác nhận mở khiếu nại tranh chấp
                </Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Modal 2: Hồ sơ tranh chấp & Phòng thương lượng (Dispute Room) */}
      <Modal
        visible={disputeRoomVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDisputeRoomVisible(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F8F9FA' }}>
          <View style={styles.modalHeader}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A202C' }}>
              Hồ sơ tranh chấp #{order.orderCode || '---'}
            </Text>
            <TouchableOpacity onPress={() => setDisputeRoomVisible(false)} style={{ padding: 6 }}>
              <Ionicons name="close" size={24} color="#4A5568" />
            </TouchableOpacity>
          </View>

          {disputeLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color="#6027D2" />
              <Text style={{ marginTop: 10, color: '#718096', fontSize: 13 }}>Đang tải hồ sơ tranh chấp...</Text>
            </View>
          ) : !disputeDetail ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
              <Text style={{ color: '#718096', fontSize: 13 }}>Chưa có thông tin tranh chấp.</Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              {/* Status Banner */}
              <View
                style={{
                  padding: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  backgroundColor:
                    disputeDetail.status === 'NEGOTIATING'
                      ? '#FEF3C7'
                      : disputeDetail.status === 'ADMIN_REVIEW'
                      ? '#F3E8FF'
                      : '#D1FAE5',
                  borderColor:
                    disputeDetail.status === 'NEGOTIATING'
                      ? '#FCD34D'
                      : disputeDetail.status === 'ADMIN_REVIEW'
                      ? '#D8B4FE'
                      : '#6EE7B7',
                  marginBottom: 14,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color:
                      disputeDetail.status === 'NEGOTIATING'
                        ? '#92400E'
                        : disputeDetail.status === 'ADMIN_REVIEW'
                        ? '#6B21A8'
                        : '#065F46',
                    marginBottom: 4,
                  }}
                >
                  Trạng thái:{' '}
                  {disputeDetail.status === 'NEGOTIATING'
                    ? '⚡ Đang trong 3 ngày tự thương lượng'
                    : disputeDetail.status === 'ADMIN_REVIEW'
                    ? '⚖️ Đang chờ Ban quản trị phân xử'
                    : '✓ Tranh chấp đã được giải quyết'}
                </Text>
                {disputeDetail.status === 'NEGOTIATING' && disputeDetail.negotiationDueAt ? (
                  <Text style={{ fontSize: 11, color: '#92400E' }}>
                    Hạn chót: {new Date(disputeDetail.negotiationDueAt).toLocaleString('vi-VN')}. Quá hạn sẽ chuyển lên Admin phân xử.
                  </Text>
                ) : null}
                {disputeDetail.status === 'RESOLVED' && disputeDetail.customerReceives ? (
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#065F46', marginTop: 2 }}>
                    Bạn nhận bồi hoàn: {Number(disputeDetail.customerReceives).toLocaleString('vi-VN')} VNĐ
                  </Text>
                ) : null}
                {disputeDetail.status === 'RESOLVED' && disputeDetail.declaredForfeitAmount && Number(disputeDetail.declaredForfeitAmount) > 0 ? (
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#B91C1C', marginTop: 3 }}>
                    🛡️ Tiền bảo đảm khai giá bị phạt (chuyển cho vườn do khiếu nại sai): -{Number(disputeDetail.declaredForfeitAmount).toLocaleString('vi-VN')} VNĐ
                  </Text>
                ) : null}
              </View>

              {/* Thông tin khiếu nại */}
              <View style={{ backgroundColor: '#FFFFFF', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 14 }}>
                <Text style={{ fontSize: 11, color: '#718096', textTransform: 'uppercase', fontWeight: '700', marginBottom: 4 }}>
                  Lý do khiếu nại của bạn:
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#1A202C', marginBottom: 6 }}>
                  {disputeDetail.reason}
                </Text>
                {disputeDetail.description ? (
                  <Text style={{ fontSize: 13, color: '#4A5568', lineHeight: 18, backgroundColor: '#F8FAFC', padding: 10, borderRadius: 8 }}>
                    {disputeDetail.description}
                  </Text>
                ) : null}
              </View>

              {/* Hạn mức trần */}
              {disputeDetail.caps ? (
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                  <View style={{ flex: 1, backgroundColor: '#EFF6FF', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#BFDBFE' }}>
                    <Text style={{ fontSize: 11, color: '#1D4ED8', fontWeight: '600' }}>Trần hoàn công:</Text>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E40AF', marginTop: 2 }}>
                      {Number(disputeDetail.caps.refundCap).toLocaleString('vi-VN')} đ
                    </Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: '#FEF2F2', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#FECACA' }}>
                    <Text style={{ fontSize: 11, color: '#DC2626', fontWeight: '600' }}>Trần đền bù cây:</Text>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#991B1B', marginTop: 2 }}>
                      {Number(disputeDetail.caps.compensationCap).toLocaleString('vi-VN')} đ
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* Bằng chứng 2 bên */}
              <View style={{ backgroundColor: '#FFFFFF', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A202C' }}>
                    Bằng chứng hình ảnh
                  </Text>
                  {disputeDetail.status !== 'RESOLVED' ? (
                    <TouchableOpacity
                      onPress={() => handlePickDisputePhoto(true)}
                      disabled={disputeUploading}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    >
                      <Ionicons name="camera-outline" size={16} color="#6027D2" />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#6027D2' }}>
                        {disputeUploading ? 'Đang nộp...' : '+ Nộp thêm ảnh'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Ảnh từ khách */}
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#DC2626', marginBottom: 6 }}>
                  Ảnh từ bạn ({disputeDetail.evidence?.customer?.length || 0}):
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                  {(disputeDetail.evidence?.customer || []).map((ev, i) => (
                    <TouchableOpacity key={i} onPress={() => setPreviewImageUrl(ev.photoUrl)}>
                      <Image source={{ uri: ev.photoUrl }} style={{ width: 68, height: 68, borderRadius: 8, marginRight: 8, backgroundColor: '#F1F5F9' }} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Ảnh từ vườn */}
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#059669', marginBottom: 6 }}>
                  Ảnh từ nhà vườn ({disputeDetail.evidence?.provider?.length || 0}):
                </Text>
                {disputeDetail.evidence?.provider?.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {disputeDetail.evidence.provider.map((ev, i) => (
                      <TouchableOpacity key={i} onPress={() => setPreviewImageUrl(ev.photoUrl)}>
                        <Image source={{ uri: ev.photoUrl }} style={{ width: 68, height: 68, borderRadius: 8, marginRight: 8, backgroundColor: '#F1F5F9' }} />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={{ fontSize: 11, color: '#A0AEC0', fontStyle: 'italic' }}>Nhà vườn chưa nộp thêm ảnh.</Text>
                )}
              </View>

              {/* Lịch sử đề xuất thương lượng */}
              <View style={{ backgroundColor: '#FFFFFF', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 14 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A202C', marginBottom: 10 }}>
                  Đề xuất thương lượng ({disputeDetail.offers?.length || 0})
                </Text>

                {(disputeDetail.offers || []).length === 0 ? (
                  <Text style={{ fontSize: 12, color: '#A0AEC0', fontStyle: 'italic' }}>Chưa có đề xuất nào được đưa ra.</Text>
                ) : (
                  disputeDetail.offers.map((off) => (
                    <View
                      key={off.id}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: off.status === 'ACCEPTED' ? '#6EE7B7' : off.status === 'PENDING' ? '#DDD6FE' : '#E2E8F0',
                        backgroundColor: off.status === 'ACCEPTED' ? '#ECFDF5' : off.status === 'PENDING' ? '#FAF8FE' : '#F8FAFC',
                        marginBottom: 10,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#1A202C' }}>
                          {off.proposedBy === 'PROVIDER' ? '🏡 Nhà vườn đề xuất' : '👤 Bạn đề xuất'}
                        </Text>
                        <View style={{ backgroundColor: off.status === 'ACCEPTED' ? '#D1FAE5' : off.status === 'PENDING' ? '#FEF3C7' : '#E2E8F0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: off.status === 'ACCEPTED' ? '#065F46' : off.status === 'PENDING' ? '#92400E' : '#718096' }}>
                            {off.status === 'ACCEPTED' ? 'Đã chấp nhận' : off.status === 'PENDING' ? 'Chờ duyệt' : 'Bị thay thế'}
                          </Text>
                        </View>
                      </View>

                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#FFFFFF', padding: 8, borderRadius: 6, marginBottom: 6 }}>
                        <Text style={{ fontSize: 11, color: '#4A5568' }}>
                          Hoàn công: <Text style={{ fontWeight: '700' }}>{Number(off.refundAmount).toLocaleString('vi-VN')} đ</Text>
                        </Text>
                        <Text style={{ fontSize: 11, color: '#4A5568' }}>
                          Đền bù: <Text style={{ fontWeight: '700' }}>{Number(off.compensationAmount).toLocaleString('vi-VN')} đ</Text>
                        </Text>
                      </View>

                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#059669', marginBottom: 4 }}>
                        Tổng bạn nhận: {Number(off.customerReceives).toLocaleString('vi-VN')} đ
                      </Text>

                      {off.message ? (
                        <Text style={{ fontSize: 11, color: '#718096', fontStyle: 'italic', marginBottom: 6 }}>
                          &ldquo;{off.message}&rdquo;
                        </Text>
                      ) : null}

                      {/* Nút chấp nhận nếu là đề xuất từ nhà vườn */}
                      {off.proposedBy === 'PROVIDER' && off.status === 'PENDING' && disputeDetail.status === 'NEGOTIATING' ? (
                        <TouchableOpacity
                          onPress={() => handleCustomerAcceptOffer(off.id)}
                          disabled={acceptingOfferId === off.id}
                          style={{
                            backgroundColor: '#059669',
                            paddingVertical: 9,
                            borderRadius: 8,
                            alignItems: 'center',
                            marginTop: 4,
                          }}
                        >
                          {acceptingOfferId === off.id ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>
                              Đồng ý nhận tiền & Kết thúc tranh chấp
                            </Text>
                          )}
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ))
                )}
              </View>

              {/* Form gửi đề xuất mới */}
              {disputeDetail.status === 'NEGOTIATING' ? (
                <View style={{ backgroundColor: '#FFFFFF', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#DDD6FE', marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#6027D2', marginBottom: 10 }}>
                    Gửi đề xuất thương lượng mới cho nhà vườn
                  </Text>
                  <Text style={{ fontSize: 11, color: '#4A5568', fontWeight: '600', marginBottom: 4 }}>
                    Số tiền hoàn công muốn nhận (VNĐ):
                  </Text>
                  <TextInput
                    value={offerRefund}
                    onChangeText={(t) => setOfferRefund(t.replace(/\D/g, ''))}
                    placeholder="VD: 200000"
                    keyboardType="numeric"
                    style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E0', borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 10 }}
                  />

                  <Text style={{ fontSize: 11, color: '#4A5568', fontWeight: '600', marginBottom: 4 }}>
                    Số tiền bồi thường cây muốn nhận (VNĐ):
                  </Text>
                  <TextInput
                    value={offerCompensation}
                    onChangeText={(t) => setOfferCompensation(t.replace(/\D/g, ''))}
                    placeholder="VD: 500000"
                    keyboardType="numeric"
                    style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E0', borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 10 }}
                  />

                  <Text style={{ fontSize: 11, color: '#4A5568', fontWeight: '600', marginBottom: 4 }}>
                    Lời nhắn gửi nhà vườn:
                  </Text>
                  <TextInput
                    multiline
                    numberOfLines={2}
                    value={offerMessage}
                    onChangeText={setOfferMessage}
                    placeholder="VD: Đề nghị nhà vườn bồi thường phần rễ úng và hoàn lại tiền công..."
                    style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E0', borderRadius: 8, padding: 10, fontSize: 13, minHeight: 60, textAlignVertical: 'top', marginBottom: 12 }}
                  />

                  <TouchableOpacity
                    onPress={handleCustomerCreateOffer}
                    disabled={offerSubmitting}
                    style={{ backgroundColor: '#6027D2', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
                  >
                    {offerSubmitting ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>
                        Gửi đề xuất thương lượng
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Rút khiếu nại nếu còn thương lượng */}
              {disputeDetail.status === 'NEGOTIATING' ? (
                <TouchableOpacity
                  onPress={handleCustomerWithdrawDispute}
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderWidth: 1,
                    borderColor: '#CBD5E0',
                    paddingVertical: 12,
                    borderRadius: 10,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#718096', fontWeight: '600', fontSize: 13 }}>
                    Rút khiếu nại (bỏ qua tranh chấp)
                  </Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Fullscreen Image Preview Modal */}
      <Modal
        visible={Boolean(previewImageUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImageUrl(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.92)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <TouchableOpacity
            onPress={() => setPreviewImageUrl(null)}
            style={{
              position: 'absolute',
              top: 48,
              right: 20,
              zIndex: 10,
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(255,255,255,0.18)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          {previewImageUrl ? (
            <Image
              source={{ uri: previewImageUrl }}
              resizeMode="contain"
              style={{ width: '94%', height: '78%' }}
            />
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F7FAFC',
  },
  loadingArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#718096',
  },
  errorArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 14,
    color: '#4A5568',
    marginTop: 12,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: '#6027D2',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    padding: 6,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A202C',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  statusBannerText: {
    fontSize: 14,
    fontWeight: '700',
  },
  callCard: {
    backgroundColor: '#FAF5FF',
    borderWidth: 1.5,
    borderColor: '#E9D8FD',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  callCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  callIconBg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  callCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A202C',
  },
  callCardSub: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
  },
  videoCallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6027D2',
    paddingVertical: 13,
    borderRadius: 12,
    gap: 8,
    shadowColor: '#6027D2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  videoCallBtnActive: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
  },
  videoCallBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A202C',
    marginBottom: 10,
  },
  packageName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6027D2',
  },
  gardenName: {
    fontSize: 13,
    color: '#718096',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  infoLabel: {
    fontSize: 13,
    color: '#718096',
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3748',
  },
  iconInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 6,
  },
  iconInfoText: {
    fontSize: 13,
    color: '#2D3748',
    flex: 1,
  },
  plantItem: {
    backgroundColor: '#F7FAFC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  plantName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2D3748',
  },
  plantSpecies: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
  },
  photosScroll: {
    marginTop: 8,
  },
  photoThumb: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 8,
  },
  noPhotoText: {
    fontSize: 11,
    color: '#A0AEC0',
    fontStyle: 'italic',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 13,
    color: '#A0AEC0',
    fontStyle: 'italic',
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyRole: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3748',
  },
  historyDate: {
    fontSize: 11,
    color: '#718096',
    marginTop: 2,
  },
  historyRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  reasonBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  reasonText: {
    fontSize: 11,
    fontWeight: '700',
  },
  historyDuration: {
    fontSize: 11,
    color: '#718096',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A202C',
  },
  totalValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#6027D2',
  },

  // Action Banner Cards
  actionBannerCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  actionBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  actionIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  actionBannerSub: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
    lineHeight: 16,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 4,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  viewContractRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  viewContractRowText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6027D2',
  },

  // Modals common
  modalSafeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E1B2E',
  },
  modalLoadingArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalScrollView: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // Contract Modal styles
  nationHeaderBox: {
    alignItems: 'center',
    marginBottom: 8,
  },
  nationTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6027D2',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  nationSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4A5568',
    textAlign: 'center',
    marginTop: 2,
  },
  nationDivider: {
    width: 60,
    height: 1.5,
    backgroundColor: '#CBD5E0',
    marginTop: 6,
    marginBottom: 4,
  },
  legalBasisBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  legalBasisText: {
    fontSize: 10.5,
    color: '#718096',
    fontStyle: 'italic',
    lineHeight: 15,
  },
  pricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  pricingLabel: {
    fontSize: 12,
    color: '#718096',
  },
  pricingValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1A202C',
  },
  contractCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  contractDocTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A202C',
    textAlign: 'center',
  },
  contractNumber: {
    fontSize: 12,
    color: '#718096',
    textAlign: 'center',
    marginTop: 4,
    fontWeight: '600',
  },
  contractDate: {
    fontSize: 11,
    color: '#A0AEC0',
    textAlign: 'center',
    marginTop: 2,
  },
  contractSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2D3748',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  partyBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#6027D2',
  },
  partyRole: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6027D2',
  },
  partyName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A202C',
    marginTop: 2,
  },
  partyDetail: {
    fontSize: 12,
    color: '#4A5568',
    marginTop: 2,
  },
  contractPlantItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  contractPlantName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D3748',
  },
  contractPlantValue: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
  },
  clauseHighlight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#ECFDF5',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    marginBottom: 10,
  },
  clauseHighlightText: {
    flex: 1,
    fontSize: 12,
    color: '#065F46',
    fontWeight: '600',
    lineHeight: 18,
  },
  clauseSummary: {
    fontSize: 12,
    color: '#4A5568',
    lineHeight: 20,
  },
  signatureRow: {
    flexDirection: 'row',
    gap: 12,
  },
  signatureBlock: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sigRole: {
    fontSize: 11,
    fontWeight: '600',
    color: '#718096',
    marginBottom: 6,
    textAlign: 'center',
  },
  signedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  signedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  unsignedText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#E53E3E',
    fontStyle: 'italic',
  },
  modalBottomBar: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  modalSignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6027D2',
    paddingVertical: 14,
    borderRadius: 12,
  },
  modalSignBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Confirm Modal styles
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  confirmHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  confirmIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F6F4FC',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1A202C',
  },
  confirmSub: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
  },
  confirmSummaryBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  confirmSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  confirmSummaryLabel: {
    fontSize: 12,
    color: '#718096',
  },
  confirmSummaryVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1A202C',
  },
  confirmLegalBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  confirmLegalText: {
    flex: 1,
    fontSize: 11,
    color: '#92400E',
    lineHeight: 16,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 12,
    color: '#2D3748',
    lineHeight: 17,
  },
  confirmActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  confirmCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4A5568',
  },
  confirmSubmitBtn: {
    flex: 1.5,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#6027D2',
    alignItems: 'center',
  },
  confirmSubmitText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Payment Modal styles
  paymentScrollContent: {
    padding: 16,
    paddingBottom: 40,
    alignItems: 'center',
  },
  qrContainer: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 16,
  },
  qrImage: {
    width: 250,
    height: 250,
    borderRadius: 12,
  },
  qrScanGuide: {
    marginTop: 10,
    fontSize: 12,
    color: '#718096',
    fontWeight: '600',
  },
  paymentCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  paymentCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A202C',
    marginBottom: 12,
  },
  payInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  payInfoLabel: {
    fontSize: 13,
    color: '#718096',
  },
  payInfoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A202C',
  },
  highlightValue: {
    color: '#3182CE',
    fontSize: 14,
    fontWeight: '700',
  },
  amountHighlight: {
    color: '#DC2626',
    fontSize: 15,
    fontWeight: '800',
  },
  memoBox: {
    backgroundColor: '#FEF3C7',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginTop: 8,
  },
  memoLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },
  memoValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#B45309',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  memoWarning: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 4,
    fontStyle: 'italic',
  },
  checkPaymentBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#10B981',
    paddingVertical: 14,
    borderRadius: 12,
  },
  checkPaymentBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  payBreakdownBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3E8FF',
    padding: 10,
    borderRadius: 10,
    marginTop: 8,
    marginBottom: 4,
  },
  payBreakdownText: {
    fontSize: 11,
    color: '#6027D2',
    fontWeight: '600',
    flex: 1,
  },
  careScheduleBox: {
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  careScheduleBoxOverdue: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  careScheduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  careScheduleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E1B2E',
  },
  careScheduleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  careScheduleSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 4,
  },
  careReportCard: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#FAFAFC',
  },
  careReportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  periodPill: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  periodPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6027D2',
  },
  careReportDate: {
    fontSize: 11,
    color: '#64748B',
  },
  careEnvText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E1B2E',
    marginBottom: 2,
  },
  careActivityText: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 4,
  },
  careNoteText: {
    fontSize: 11,
    color: '#64748B',
    fontStyle: 'italic',
    marginBottom: 4,
  },
  carePlantItem: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  carePlantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  carePlantName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E1B2E',
  },
  carePlantHealth: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6027D2',
  },
  carePlantMeta: {
    fontSize: 11,
    color: '#475569',
    marginBottom: 4,
  },
});

