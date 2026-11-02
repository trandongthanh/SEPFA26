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
  REJECTED: { label: 'Nhà vườn từ chối', color: '#E53E3E', bg: '#FED7D7' },
  CANCELLED: { label: 'Đã hủy', color: '#A0AEC0', bg: '#E2E8F0' },
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

  // Payment Modal state
  const [paymentModalVisible, setPaymentModalVisible] = useState<boolean>(false);
  const [paymentLoading, setPaymentLoading] = useState<boolean>(false);
  const [paymentQrData, setPaymentQrData] = useState<any | null>(null);
  const [checkingPayment, setCheckingPayment] = useState<boolean>(false);

  // Handover confirmation state
  const [confirmingHandover, setConfirmingHandover] = useState<boolean>(false);

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

  // Ký hợp đồng online
  const handleSignContract = () => {
    Alert.alert(
      'Xác nhận ký hợp đồng',
      'Bạn xác nhận đồng ý với các điều khoản trong hợp đồng dịch vụ chăm sóc lan và cam kết thực hiện đúng nghĩa vụ?',
      [
        { text: 'Xem lại', style: 'cancel' },
        {
          text: 'Đồng ý ký',
          onPress: async () => {
            setSigningLoading(true);
            try {
              await orderService.signAgreement(orderId);
              Alert.alert('Thành công', 'Bạn đã ký hợp đồng online thành công!');
              setContractModalVisible(false);
              fetchDetail();
            } catch (err: any) {
              console.error('Sign agreement failed:', err);
              const msg = err?.response?.data?.message || 'Ký hợp đồng thất bại.';
              Alert.alert('Lỗi', Array.isArray(msg) ? msg.join('\n') : msg);
            } finally {
              setSigningLoading(false);
            }
          },
        },
      ]
    );
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
              Alert.alert('Thành công', 'Đã xác nhận bàn giao thành công! Cây của bạn đã chính thức chuyển sang giai đoạn chăm sóc (IN_CARE).');
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
        {['PAID', 'HANDOVER_IN_PROGRESS', 'HANDOVER_AWAITING_CONFIRM', 'IN_CARE'].includes(order.status) && (
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
            <Text style={styles.infoLabel}>Phí vận chuyển:</Text>
            <Text style={styles.infoValue}>
              {Number(order.pickupFeeSnapshot || 0).toLocaleString('vi-VN')} VNĐ
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.totalLabel}>Tổng cộng:</Text>
            <Text style={styles.totalValue}>
              {Number(order.provisionalTotal || 0).toLocaleString('vi-VN')} VNĐ
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

              return (
                <View style={{ flex: 1 }}>
                  <ScrollView style={styles.modalScrollView} contentContainerStyle={styles.modalScrollContent}>
                    {/* Header card */}
                    <View style={styles.contractCard}>
                      <Text style={styles.contractDocTitle}>HỢP ĐỒNG DỊCH VỤ CHĂM SÓC HOA LAN</Text>
                      <Text style={styles.contractNumber}>
                        Số HĐ: {agreementNumber}
                      </Text>
                      <Text style={styles.contractDate}>
                        Ngày lập: {new Date(agreementDate).toLocaleDateString('vi-VN')}
                      </Text>
                    </View>

                    {/* Parties info */}
                    <View style={styles.contractCard}>
                      <Text style={styles.contractSectionTitle}>1. CÁC BÊN THAM GIA</Text>
                      <View style={styles.partyBox}>
                        <Text style={styles.partyRole}>BÊN A (Khách hàng / Chủ sở hữu cây):</Text>
                        <Text style={styles.partyName}>{customerName}</Text>
                        <Text style={styles.partyDetail}>SĐT: {customerPhone}</Text>
                        <Text style={styles.partyDetail}>Địa chỉ: {customerAddress}</Text>
                      </View>

                      <View style={[styles.partyBox, { marginTop: 10 }]}>
                        <Text style={styles.partyRole}>BÊN B (Nhà vườn cung cấp dịch vụ):</Text>
                        <Text style={styles.partyName}>{providerName}</Text>
                        <Text style={styles.partyDetail}>SĐT: {providerPhone}</Text>
                        <Text style={styles.partyDetail}>Địa chỉ: {providerAddress}</Text>
                      </View>
                    </View>

                    {/* Plants info */}
                    <View style={styles.contractCard}>
                      <Text style={styles.contractSectionTitle}>2. DANH SÁCH CÂY GỬI CHĂM SÓC ({contractData.plants?.length || 0} cây)</Text>
                      {contractData.plants?.map((plant: any, index: number) => (
                        <View key={index} style={styles.contractPlantItem}>
                          <Text style={styles.contractPlantName}>
                            {index + 1}. {plant.name} {plant.speciesName ? `(${plant.speciesName})` : ''}
                          </Text>
                          <Text style={styles.contractPlantValue}>
                            Giá trị khai báo:{' '}
                            {plant.isValueDeclared && plant.declaredValue
                              ? `${Number(plant.declaredValue).toLocaleString('vi-VN')} VNĐ`
                              : 'Không khai báo'}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {/* Compensation & Clauses */}
                    <View style={styles.contractCard}>
                      <Text style={styles.contractSectionTitle}>3. ĐIỀU KHOẢN TRỌNG YẾU & BỒI THƯỜNG</Text>
                      <View style={styles.clauseHighlight}>
                        <Ionicons name="shield-checkmark" size={20} color="#059669" />
                        <Text style={styles.clauseHighlightText}>
                          Chính sách bồi thường: Nhà vườn cam kết bồi thường tối đa 120% giá trị khai báo hợp lệ nếu phát sinh hư hại do lỗi chăm sóc theo thỏa thuận.
                        </Text>
                      </View>
                      <Text style={styles.clauseSummary}>
                        • Thời gian chăm sóc: {order.durationDaysSnapshot || 30} ngày{'\n'}
                        • Tần suất nộp báo cáo: {order.reportFrequencySnapshot || 7} ngày/lần kèm ảnh hiện trạng{'\n'}
                        • Chi phí dịch vụ tạm tính: {Number(order.provisionalTotal || 0).toLocaleString('vi-VN')} VNĐ
                      </Text>
                    </View>

                    {/* Signatures status */}
                    <View style={styles.contractCard}>
                      <Text style={styles.contractSectionTitle}>4. TÌNH TRẠNG CHỮ KÝ ĐIỆN TỬ</Text>
                      <View style={styles.signatureRow}>
                        <View style={styles.signatureBlock}>
                          <Text style={styles.sigRole}>Bên A (Khách hàng)</Text>
                          {isCustomerSigned ? (
                            <View style={styles.signedBadge}>
                              <Ionicons name="checkmark-circle" size={16} color="#059669" />
                              <Text style={styles.signedText}>ĐÃ KÝ</Text>
                            </View>
                          ) : (
                            <Text style={styles.unsignedText}>Chưa ký</Text>
                          )}
                        </View>
                        <View style={styles.signatureBlock}>
                          <Text style={styles.sigRole}>Bên B (Nhà vườn)</Text>
                          {isProviderSigned ? (
                            <View style={styles.signedBadge}>
                              <Ionicons name="checkmark-circle" size={16} color="#059669" />
                              <Text style={styles.signedText}>ĐÃ KÝ</Text>
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
                        onPress={handleSignContract}
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
});

