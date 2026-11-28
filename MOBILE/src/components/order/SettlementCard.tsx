import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OrderItem } from '../../services/orderService';
import { formatDateTime, formatVnd, toNumber } from './orderMoney';

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
  // Chuyển dư: tiền thừa so với số phải trả, LanCare trả lại ngay khi tiền về (không chờ hết đơn).
  // Không nằm trong "Tổng đã trả" nên hiện riêng, không cộng vào "Tổng nhận lại".
  const overpay = toNumber(s.overpayReturned);

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

      {overpay > 0 && (
        <View style={styles.overpayBox}>
          <View style={styles.row}>
            <Text style={[styles.label, { color: '#1E40AF', flex: 1 }]}>Tiền chuyển dư đã trả lại</Text>
            <Text style={[styles.value, { color: '#1E40AF' }]}>{formatVnd(overpay)}</Text>
          </View>
          <Text style={styles.overpayNote}>
            Bạn đã chuyển nhiều hơn số cần trả. LanCare trả lại phần dư vào tài khoản ngân hàng trong hồ sơ của bạn.
          </Text>
        </View>
      )}

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

      {order.customerDisbursements && order.customerDisbursements.length > 0 && (
        <View style={styles.disbBox}>
          <Text style={styles.disbBoxTitle}>Trạng thái chuyển tiền</Text>
          {order.customerDisbursements.map((d) => {
            const isPaid = d.status === 'PAID';
            const typeLabel =
              d.type === 'DECLARED_RETURN'
                ? 'Tiền khai giá'
                : d.type === 'COMPENSATION'
                ? 'Tiền bồi thường'
                : d.type === 'OVERPAY_RETURN'
                ? 'Tiền chuyển dư'
                : 'Tiền hoàn đơn';
            return (
              <View key={d.id} style={styles.disbRow}>
                <View style={styles.row}>
                  <Text style={styles.disbTypeLabel}>{typeLabel}</Text>
                  <Text style={styles.disbAmountText}>{formatVnd(d.amount)}</Text>
                </View>
                <View style={styles.disbStatusRow}>
                  <Ionicons
                    name={isPaid ? 'checkmark-circle' : 'time-outline'}
                    size={13}
                    color={isPaid ? '#059669' : '#D97706'}
                  />
                  <Text style={[styles.disbStatusText, { color: isPaid ? '#059669' : '#D97706' }]}>
                    {isPaid
                      ? `Đã chuyển lúc ${formatDateTime(d.paidAt)}`
                      : 'Đang chờ chuyển về tài khoản'}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

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
  overpayBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  overpayNote: { fontSize: 11, color: '#1E3A8A', lineHeight: 16, marginTop: 2 },
  disbBox: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    gap: 6,
  },
  disbBoxTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 2,
  },
  disbRow: {
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: '#DCFCE7',
  },
  disbTypeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
  },
  disbAmountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  disbStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  disbStatusText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
