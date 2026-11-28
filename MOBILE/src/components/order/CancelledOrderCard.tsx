import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OrderItem } from '../../services/orderService';
import { formatDateTime, formatVnd, toNumber } from './orderMoney';

interface Props {
  order: OrderItem;
}

// Câu cho KHÁCH theo mã huỷ (BE orders/cancel-rules.ts CANCEL_CODES). [tiêu đề, giải thích]
const CUSTOMER_COPY: Record<string, [string, string]> = {
  CUSTOMER_WITHDREW: ['Bạn đã rút đơn', 'Đơn chưa thanh toán nên không phát sinh tiền.'],
  SIGN_TIMEOUT: [
    'Quá hạn ký hợp đồng',
    'Bạn chưa ký hợp đồng trong thời hạn nên đơn tự huỷ. Chưa có khoản tiền nào bị trừ.',
  ],
  PAYMENT_TIMEOUT: ['Quá hạn thanh toán', 'Bạn chưa thanh toán trong thời hạn nên đơn tự huỷ.'],
  CUSTOMER_CANCELLED_FREE: [
    'Bạn huỷ trước giờ hẹn hơn 3 tiếng',
    'Huỷ sớm nên được hoàn đủ, kể cả phí lấy cây.',
  ],
  CUSTOMER_CANCELLED_LATE: [
    'Bạn huỷ trong 3 tiếng trước giờ hẹn',
    'Vườn có thể đã lên đường nên được giữ phí lấy cây. Phần còn lại được hoàn đủ.',
  ],
  PROVIDER_CANCELLED: ['Nhà vườn đã huỷ đơn', 'Bạn được hoàn đủ, kể cả phí lấy cây.'],
  CUSTOMER_ABSENT: [
    'Vườn tới nhưng không gặp bạn',
    'Vườn đã tới đúng hẹn và gửi ảnh tại chỗ. Vườn giữ phí lấy cây, phần còn lại được hoàn đủ.',
  ],
  PROVIDER_CANNOT_SERVE: [
    'Vườn không nhận được cây',
    'Vườn khám xong và không nhận cây nào. Bạn được hoàn đủ, kể cả phí lấy cây.',
  ],
  CUSTOMER_DECLINED: [
    'Bạn không giao cây',
    'Bạn không đồng ý biên bản nhận cây. Vườn giữ phí lấy cây, phần còn lại được hoàn đủ.',
  ],
  CONFIRM_TIMEOUT: [
    'Bạn chưa trả lời biên bản nhận cây',
    'Quá 2 giờ bạn chưa đồng ý hay từ chối biên bản nên đơn tự huỷ. Vườn giữ phí lấy cây, phần còn lại được hoàn đủ.',
  ],
  DEPOSIT_UNPAID: [
    'Vườn không hoàn tất thủ tục nhận cây',
    'Vườn chưa nộp tiền bảo đảm đúng hạn nên đơn bị huỷ. Bạn được hoàn đủ, kể cả phí lấy cây.',
  ],
};

// PROVIDER_NO_SHOW có 2 đường: khách tự báo (CUSTOMER) hoặc bộ quét tự huỷ sau 24 giờ (SYSTEM).
const noShowCopy = (by: OrderItem['cancelledBy']): [string, string] =>
  by === 'SYSTEM'
    ? [
        'Nhà vườn không tới lấy cây',
        'Quá giờ hẹn 24 giờ mà vườn chưa nhận cây nên hệ thống tự huỷ. Bạn được hoàn đủ, kể cả phí lấy cây.',
      ]
    : [
        'Nhà vườn không tới lấy cây',
        'Bạn đã báo vườn không tới sau giờ hẹn 30 phút. Bạn được hoàn đủ, kể cả phí lấy cây.',
      ];

const WHO: Record<string, string> = {
  CUSTOMER: 'Bạn huỷ',
  PROVIDER: 'Nhà vườn huỷ',
  SYSTEM: 'Hệ thống tự huỷ',
};

/**
 * Khối "Đơn đã huỷ" — vì sao huỷ, ai huỷ, lúc nào, và bạn được hoàn bao nhiêu.
 * Đọc cancelCode / cancelledBy / cancelReason / cancelledAt + settlement của chi tiết đơn, không gọi API thêm.
 * Phần tiền chỉ hiện khi đơn đã từng thanh toán (paidAt); vườn giữ = tiền đơn đã trả − tiền đã hoàn từ sổ đơn.
 */
export const CancelledOrderCard: React.FC<Props> = ({ order }) => {
  if (order.status !== 'CANCELLED') return null;

  const code = order.cancelCode ?? '';
  const [title, detail] =
    code === 'PROVIDER_NO_SHOW'
      ? noShowCopy(order.cancelledBy)
      : CUSTOMER_COPY[code] ?? ['Đơn đã bị huỷ', ''];
  const by = order.cancelledBy ? WHO[order.cancelledBy] : null;
  const meta = [formatDateTime(order.cancelledAt), by].filter(Boolean).join(' · ');
  // Câu hệ thống ghi đã nằm trong tiêu đề → chỉ hiện ghi chú người bấm huỷ tự gõ.
  const note = order.cancelledBy && order.cancelledBy !== 'SYSTEM' ? order.cancelReason?.trim() : null;
  const noteOwner = order.cancelledBy === 'CUSTOMER' ? 'bạn' : 'nhà vườn';

  const s = order.settlement;
  const paid = !!order.paidAt && !!s;
  const orderPaid = s ? toNumber(s.packageAmount) + toNumber(s.customerFee) + toNumber(s.pickupFee) : 0;
  const refund = s ? toNumber(s.refundAmount) : 0;
  const declaredBack = s ? toNumber(s.declaredDepositReturned) : 0;
  const pickupKept = Math.max(0, orderPaid - refund);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <Ionicons name="close-circle-outline" size={18} color="#4A5568" />
          <Text style={styles.headTitle}>Đơn đã huỷ</Text>
        </View>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>

      <View style={styles.body}>
        <Text style={styles.lbl}>Lý do</Text>
        <Text style={styles.reasonTitle}>{title}</Text>
        {detail ? <Text style={styles.reasonText}>{detail}</Text> : null}
        {!CUSTOMER_COPY[code] && code !== 'PROVIDER_NO_SHOW' && order.cancelReason ? (
          <Text style={styles.reasonText}>{order.cancelReason}</Text>
        ) : null}

        {note ? (
          <View style={styles.quote}>
            <Text style={styles.quoteText}>
              Ghi chú của {noteOwner}: "{note}"
            </Text>
          </View>
        ) : null}

        {paid ? (
          <>
            <View style={styles.money}>
              <View style={styles.row}>
                <Text style={styles.label}>Tiền gói + phí sàn 6%</Text>
                <Text style={styles.value}>{formatVnd(toNumber(s!.packageAmount) + toNumber(s!.customerFee))}</Text>
              </View>
              {toNumber(s!.pickupFee) > 0 && (
                <View style={styles.row}>
                  <Text style={styles.label}>Phí lấy cây</Text>
                  <Text style={[styles.value, pickupKept > 0 && { color: '#D97706' }]}>
                    {pickupKept > 0 ? 'Vườn giữ' : formatVnd(s!.pickupFee)}
                  </Text>
                </View>
              )}
              {declaredBack > 0 && (
                <View style={styles.row}>
                  <Text style={styles.label}>Phí khai giá trả lại</Text>
                  <Text style={styles.value}>{formatVnd(declaredBack)}</Text>
                </View>
              )}
              <View style={[styles.row, styles.totalRow]}>
                <Text style={styles.totalLabel}>Bạn được hoàn</Text>
                <Text style={styles.totalValue}>{formatVnd(refund + declaredBack)}</Text>
              </View>
            </View>
            {order.customerDisbursements && order.customerDisbursements.length > 0 ? (
              <View style={styles.disbBox}>
                <Text style={styles.disbBoxTitle}>Trạng thái chuyển tiền hoàn</Text>
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
                      <View style={{ flex: 1 }}>
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
                              : 'Đang chờ chuyển về tài khoản của bạn'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.foot}>Tiền hoàn chuyển về tài khoản ngân hàng bạn đã khai.</Text>
            )}
          </>
        ) : (
          <Text style={styles.noMoney}>Đơn chưa thanh toán nên không có khoản hoàn tiền.</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  head: { backgroundColor: '#EDF2F7', paddingHorizontal: 16, paddingVertical: 12, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headTitle: { fontSize: 15, fontWeight: '800', color: '#1A202C' },
  meta: { fontSize: 12, color: '#718096' },
  body: { padding: 16, gap: 4 },
  lbl: { fontSize: 11, color: '#718096' },
  reasonTitle: { fontSize: 14, fontWeight: '700', color: '#1A202C' },
  reasonText: { fontSize: 13, color: '#4A5568', lineHeight: 19 },
  quote: { borderLeftWidth: 3, borderLeftColor: '#E2E8F0', paddingLeft: 10, marginTop: 6 },
  quoteText: { fontSize: 12, color: '#718096', fontStyle: 'italic', lineHeight: 18 },
  money: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, marginTop: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginVertical: 3 },
  label: { fontSize: 13, color: '#718096', flexShrink: 1 },
  value: { fontSize: 13, fontWeight: '600', color: '#2D3748' },
  totalRow: { borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 8, marginTop: 6 },
  totalLabel: { fontSize: 14, fontWeight: '800', color: '#1A202C' },
  totalValue: { fontSize: 14, fontWeight: '800', color: '#059669' },
  foot: { fontSize: 11, color: '#718096', marginTop: 6 },
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
  noMoney: {
    fontSize: 13,
    color: '#718096',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
});
