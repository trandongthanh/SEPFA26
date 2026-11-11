import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { OrderItem, orderService } from '../services/orderService';
import { providerService } from '../services/providerService';
import { calculateRoadDistanceKm } from '../utils/distance';
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

  // Provider coordinates for transparent distance calculation
  const [providerCoords, setProviderCoords] = useState<{ lat: number; lng: number } | null>(null);

  const fetchDetail = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [orderData, historyData, activeData] = await Promise.all([
        orderService.getOrderDetail(orderId),
        videoCallService.listHistory(orderId).catch(() => []),
        videoCallService.getActive(orderId).catch(() => ({ call: null })),
      ]);

      setOrder(orderData);
      setCallHistory(historyData || []);
      setActiveCall(activeData?.call || null);
    } catch (err: any) {
      console.error('Failed to load order detail:', err);
      setErrorMsg('Không thể tải thông tin đơn hàng.');
    } finally {
      setLoading(false);
    }
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
              Alert.alert('Thành công', 'Đã xác nhận bàn giao thành công! Cây của bạn đã chính thức chuyển sang giai đoạn chăm sóc.');
              fetchDetail();
            } catch (err: any) {
              console.error('Confirm handover failed:', err);
              const msg = err?.response?.data?.message || 'Xác nhận bàn giao thất bại.';
              Alert.alert('Lỗi', Array.isArray(msg) ? msg.join('\n') : msg);
            } finally {
              setConfirmingHandover(false);
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
        <TouchableOpacity style={styles.retryButton} onPress={fetchDetail}>
          <Text style={styles.retryButtonText}>Thử lại</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const statusInfo = STATUS_MAP[order.status] || {
    label: order.status,
    color: '#4A5568',
    bg: '#EDF2F7',
  };

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

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Status Banner */}
        <View style={[styles.statusBanner, { backgroundColor: statusInfo.bg }]}>
          <Ionicons name="information-circle-outline" size={20} color={statusInfo.color} />
          <Text style={[styles.statusBannerText, { color: statusInfo.color }]}>
            Trạng thái: {statusInfo.label}
          </Text>
        </View>

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
        )}

        {/* View Contract Link if Contract exists */}
        {['PAID', 'HANDOVER_IN_PROGRESS', 'HANDOVER_AWAITING_CONFIRM', 'IN_CARE', 'RETURN_IN_PROGRESS', 'RETURN_AWAITING_CONFIRM', 'COMPLETED', 'DISPUTED'].includes(order.status) && (
          <TouchableOpacity
            style={styles.viewContractRow}
            onPress={handleOpenContract}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Ionicons name="document-text-outline" size={18} color="#6027D2" />
              <Text style={styles.viewContractRowText}>Xem chi tiết hợp đồng điện tử đã ký</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#A0AEC0" />
          </TouchableOpacity>
        )}

        {/* Video Call Action Section */}
        {isCallable && (
          <View style={styles.callCard}>
            <View style={styles.callCardHeader}>
              <View style={styles.callIconBg}>
                <Ionicons name="videocam" size={22} color="#6027D2" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.callCardTitle}>Video Call với Nhà vườn</Text>
                <Text style={styles.callCardSub}>
                  {activeCall
                    ? 'Cuộc gọi đang diễn ra, bạn có thể tham gia ngay'
                    : 'Trao đổi trực tiếp tình trạng cây qua video call'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.videoCallBtn,
                activeCall ? styles.videoCallBtnActive : null,
              ]}
              onPress={handleStartVideoCall}
              disabled={callLoading}
              activeOpacity={0.85}
            >
              {callLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Ionicons
                    name={activeCall ? 'enter-outline' : 'videocam'}
                    size={20}
                    color="#FFFFFF"
                  />
                  <Text style={styles.videoCallBtnText}>
                    {activeCall ? 'Tham gia cuộc gọi đang diễn ra' : 'Gọi video cho nhà vườn'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

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
                      <Image key={p.id} source={{ uri: p.photoUrl }} style={styles.photoThumb} />
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

        {/* Pricing Summary */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Chi tiết giá</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Giá gói snapshot:</Text>
            <Text style={styles.infoValue}>
              {Number(order.basePriceSnapshot || 0).toLocaleString('vi-VN')} VNĐ
            </Text>
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
            <Text style={styles.infoValue}>
              {Number(order.pickupFeeSnapshot || 0).toLocaleString('vi-VN')} VNĐ
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.totalLabel}>Tổng cộng:</Text>
            <Text style={styles.totalValue}>
              {(
                Number(order.provisionalTotal || 0) +
                Number(order.pickupFeeSnapshot || 0)
              ).toLocaleString('vi-VN')} VNĐ
            </Text>
          </View>
        </View>
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
                'Điều 3 – Trách nhiệm vận chuyển: Nếu xảy ra tình trạng cây bị thất lạc hoặc hư hỏng dẫn đến hậu quả nghiêm trọng trong quá trình vận chuyển giao nhận, Bên B cam kết bồi thường 120% giá trị định giá của cây.',
                'Điều 4 – Trách nhiệm chăm sóc: Trong suốt thời gian chăm sóc tại nhà vườn, nếu cây bị suy yếu nặng, chết hoặc thất lạc do lỗi chăm sóc kỹ thuật, Bên B chịu trách nhiệm bồi thường cho Bên A mức bằng 120% giá trị khai báo của cây.',
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
                        const comp = plant.compensationAmount
                          ? Number(plant.compensationAmount)
                          : (declared > 0 ? declared * 1.2 : 0);

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
                                Đền bù (120%): {comp > 0 ? `${comp.toLocaleString('vi-VN')} VNĐ` : 'Theo giá gói'}
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
                      <Text style={styles.contractSectionTitle}>V. CHÍNH SÁCH BỒI THƯỜNG THIỆT HẠI (120%)</Text>
                      <View style={styles.clauseHighlight}>
                        <Ionicons name="shield-checkmark" size={20} color="#059669" />
                        <Text style={styles.clauseHighlightText}>
                          Cam kết bồi thường tối đa 120% giá trị định giá của cây nếu xảy ra rủi ro trong suốt quá trình chăm sóc hoặc vận chuyển theo thỏa thuận.
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
                Tôi đã đọc kỹ, hiểu rõ và đồng ý với tất cả điều khoản hợp đồng & chính sách bồi thường 120%.
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
});

