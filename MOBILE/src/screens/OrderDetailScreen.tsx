import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { OrderItem, orderService } from '../services/orderService';

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
  IN_CARE: { label: 'Đang chăm sóc', color: '#6027D2', bg: '#F3E8FF' },
  REJECTED: { label: 'Nhà vườn từ chối', color: '#E53E3E', bg: '#FED7D7' },
  CANCELLED: { label: 'Đã hủy', color: '#A0AEC0', bg: '#E2E8F0' },
};

export const OrderDetailScreen: React.FC<OrderDetailScreenProps> = ({
  navigation,
  route,
}) => {
  const { orderId } = route.params;

  const [order, setOrder] = useState<OrderItem | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchDetail = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await orderService.getOrderDetail(orderId);
      setOrder(data);
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
});
