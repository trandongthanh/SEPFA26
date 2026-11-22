import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OrderItem } from '../../services/orderService';
import { formatVnd, toNumber } from './orderMoney';

interface Props {
  order: OrderItem;
}

/**
 * Khối "Quyết toán đơn" — đọc nguyên `settlement` BE trả trong chi tiết đơn (payments/customer-settlement.ts),
 * không tính lại. BE trả null khi chưa có hoá đơn (chưa đủ 2 chữ ký) → ẩn.
 */
// Khối có hiện không. settlement.customerTotal chỉ là số PHẢI trả (BE trả cả với đơn huỷ trước khi trả),
// nên "đã trả" đọc từ `paidAt` của BE: có → đã trả; chưa có mà đang chờ thanh toán → "Cần thanh toán"; còn lại ẩn.
export const isSettlementShown = (order: OrderItem): boolean => {
  if (!order.settlement) return false;
  return !!order.paidAt || order.status === 'AWAITING_PAYMENT';
};

export const SettlementCard: React.FC<Props> = ({ order }) => {
  const s = order.settlement;
  if (!s || !isSettlementShown(order)) return null;

  const awaitingPayment = !order.paidAt;

  const payRows: Array<[string, string]> = [
    ['Giá gói', s.packageAmount],
    ['Phí dịch vụ 6%', s.customerFee],
    ['Phí lấy cây', s.pickupFee],
  ];
  if (toNumber(s.addonAmount) > 0) payRows.push(['Dịch vụ thêm', s.addonAmount]);
  if (toNumber(s.declaredDeposit) > 0) payRows.push(['Tiền bảo đảm khai giá', s.declaredDeposit]);

  const backRows: Array<[string, string]> = [];
  if (toNumber(s.refundAmount) > 0) backRows.push(['Tiền hoàn (đã gồm 6%)', s.refundAmount]);
  if (toNumber(s.compensationAmount) > 0) backRows.push(['Tiền đền giá trị cây', s.compensationAmount]);
  if (toNumber(s.declaredDepositReturned) > 0)
    backRows.push(['Tiền bảo đảm khai giá đã trả lại', s.declaredDepositReturned]);
  const backTotal = backRows.reduce((sum, [, v]) => sum + toNumber(v), 0);
  const forfeited = toNumber(s.declaredDepositForfeited);

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Ionicons name="receipt-outline" size={18} color="#6027D2" />
        <Text style={styles.title}>Quyết toán đơn</Text>
      </View>

      <Text style={styles.sub}>{awaitingPayment ? 'Cần thanh toán' : 'Bạn đã trả'}</Text>
      {payRows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value}>{formatVnd(value)}</Text>
        </View>
      ))}
      <View style={[styles.row, styles.totalRow]}>
        <Text style={styles.totalLabel}>{awaitingPayment ? 'Tổng cần thanh toán' : 'Tổng đã trả'}</Text>
        <Text style={styles.totalValue}>{formatVnd(s.customerTotal)}</Text>
      </View>

      {!awaitingPayment &&
        (backRows.length > 0 ? (
          <>
            <Text style={[styles.sub, { marginTop: 12 }]}>Bạn nhận lại</Text>
            {backRows.map(([label, value]) => (
              <View key={label} style={styles.row}>
                <Text style={styles.label}>{label}</Text>
                <Text style={[styles.value, { color: '#15803D' }]}>{formatVnd(value)}</Text>
              </View>
            ))}
            <View style={[styles.row, styles.totalRow]}>
              <Text style={styles.totalLabel}>Tổng nhận lại</Text>
              <Text style={[styles.totalValue, { color: '#15803D' }]}>{formatVnd(backTotal)}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.note}>Chưa có khoản nào được hoàn. Phần này cập nhật khi đơn kết thúc.</Text>
        ))}

      {forfeited > 0 && (
        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={[styles.label, { color: '#C2410C', flex: 1 }]}>Tiền bảo đảm khai giá chuyển cho vườn</Text>
          <Text style={[styles.value, { color: '#C2410C' }]}>{formatVnd(forfeited)}</Text>
        </View>
      )}

      <Text style={styles.note}>Số đọc từ hoá đơn và sổ ký quỹ của hệ thống.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  title: { fontSize: 15, fontWeight: '700', color: '#1A202C' },
  sub: {
    fontSize: 11,
    fontWeight: '700',
    color: '#718096',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
    marginBottom: 2,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginVertical: 3 },
  label: { fontSize: 13, color: '#718096' },
  value: { fontSize: 13, fontWeight: '600', color: '#2D3748' },
  totalRow: { borderTopWidth: 1, borderTopColor: '#EDF2F7', paddingTop: 8, marginTop: 6 },
  totalLabel: { fontSize: 14, fontWeight: '700', color: '#1A202C' },
  totalValue: { fontSize: 14, fontWeight: '700', color: '#6027D2' },
  note: { fontSize: 11, color: '#718096', marginTop: 8, lineHeight: 16 },
});
