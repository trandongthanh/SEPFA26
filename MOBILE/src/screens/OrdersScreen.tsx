import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { OrderItem, orderService } from '../services/orderService';

interface OrdersScreenProps {
  navigation: any;
}

const TABS = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'PENDING_PROVIDER', label: 'Chờ duyệt' },
  { key: 'IN_CARE', label: 'Đang chăm sóc' },
  { key: 'PAID', label: 'Đã thanh toán' },
];

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: 'Đơn nháp', color: '#718096', bg: '#EDF2F7' },
  PENDING_PROVIDER: { label: 'Chờ duyệt', color: '#D69E2E', bg: '#FEFCBF' },
  AGREEMENT_PENDING: { label: 'Ký hợp đồng', color: '#DD6B20', bg: '#FEEBC8' },
  AWAITING_PAYMENT: { label: 'Chờ thanh toán', color: '#3182CE', bg: '#EBF8FF' },
  PAID: { label: 'Đã thanh toán', color: '#38A169', bg: '#C6F6D5' },
  HANDOVER_IN_PROGRESS: { label: 'Bàn giao', color: '#805AD5', bg: '#E9D8FD' },
  IN_CARE: { label: 'Đang chăm sóc', color: '#6027D2', bg: '#F3E8FF' },
  REJECTED: { label: 'Từ chối', color: '#E53E3E', bg: '#FED7D7' },
  CANCELLED: { label: 'Đã hủy', color: '#A0AEC0', bg: '#E2E8F0' },
};

export const OrdersScreen: React.FC<OrdersScreenProps> = ({ navigation }) => {
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('ALL');

  const fetchOrders = async (statusTab = activeTab) => {
    try {
      const res = await orderService.listOrders(statusTab);
      setOrders(res.items || []);
    } catch (err: any) {
      console.error('Error fetching orders:', err);
      setOrders([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchOrders(activeTab);
    }, [activeTab])
  );

  const handleTabChange = (tabKey: string) => {
    setActiveTab(tabKey);
    setLoading(true);
    fetchOrders(tabKey);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchOrders(activeTab);
  };

  const renderOrderItem = ({ item }: { item: OrderItem }) => {
    const statusInfo = STATUS_MAP[item.status] || {
      label: item.status,
      color: '#4A5568',
      bg: '#EDF2F7',
    };

    const formattedDate = item.scheduledPickupAt
      ? new Date(item.scheduledPickupAt).toLocaleDateString('vi-VN')
      : '';

    return (
      <TouchableOpacity
        style={styles.orderCard}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
      >
        <View style={styles.cardHeader}>
          <View style={styles.codeRow}>
            <Ionicons name="receipt-outline" size={16} color="#6027D2" />
            <Text style={styles.orderCode}>#{item.orderCode}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
            <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>
              {statusInfo.label}
            </Text>
          </View>
        </View>

        <View style={styles.cardBody}>
          <Text style={styles.packageName}>
            {item.servicePackage?.name || 'Gói chăm sóc tiêu chuẩn'}
          </Text>
          {item.provider?.gardenName ? (
            <Text style={styles.gardenName}>
              <Ionicons name="storefront-outline" size={12} color="#718096" />{' '}
              {item.provider.gardenName}
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            <Text style={styles.metaText}>Số chậu: {item.plantCount || 1} chậu</Text>
            {formattedDate ? (
              <Text style={styles.metaText}>Hẹn lấy: {formattedDate}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.priceLabel}>Tổng tiền:</Text>
          <Text style={styles.priceValue}>
            {Number(item.provisionalTotal || 0).toLocaleString('vi-VN')} VNĐ
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Đơn hàng của tôi</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={TABS}
          keyExtractor={(t) => t.key}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.tabButton, activeTab === item.key && styles.tabButtonActive]}
              onPress={() => handleTabChange(item.key)}
            >
              <Text
                style={[
                  styles.tabButtonText,
                  activeTab === item.key && styles.tabButtonTextActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.tabContent}
        />
      </View>

      {loading ? (
        <View style={styles.loadingArea}>
          <ActivityIndicator size="large" color="#6027D2" />
          <Text style={styles.loadingText}>Đang tải danh sách đơn hàng...</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={renderOrderItem}
          contentContainerStyle={orders.length === 0 ? styles.emptyListContent : styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={['#6027D2']}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="receipt-outline" size={60} color="#CBD5E0" />
              <Text style={styles.emptyTitle}>Chưa có đơn hàng nào</Text>
              <Text style={styles.emptySubtext}>
                Các gói dịch vụ bạn đã đặt sẽ hiển thị danh sách và tiến độ tại đây.
              </Text>
              <TouchableOpacity
                style={styles.exploreButton}
                onPress={() => navigation.navigate('Home')}
              >
                <Text style={styles.exploreButtonText}>Duyệt gói dịch vụ ngay</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F4FC',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A202C',
  },
  tabContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
    paddingVertical: 8,
  },
  tabContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  tabButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F7FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tabButtonActive: {
    backgroundColor: '#F3E8FF',
    borderColor: '#6027D2',
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#718096',
  },
  tabButtonTextActive: {
    color: '#6027D2',
    fontWeight: '700',
  },
  loadingArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#718096',
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  orderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F7FAFC',
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  orderCode: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2D3748',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardBody: {
    paddingVertical: 10,
  },
  packageName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A202C',
  },
  gardenName: {
    fontSize: 12,
    color: '#718096',
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  metaText: {
    fontSize: 12,
    color: '#4A5568',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F7FAFC',
  },
  priceLabel: {
    fontSize: 12,
    color: '#718096',
  },
  priceValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#6027D2',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4A5568',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#718096',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  exploreButton: {
    marginTop: 20,
    backgroundColor: '#6027D2',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  exploreButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
