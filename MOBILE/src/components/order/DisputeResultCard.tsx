import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DISPUTE_OUTCOME_LABELS, DisputeOutcome, OrderItem } from '../../services/orderService';

const OUTCOME_TONE: Record<DisputeOutcome, { fg: string; bg: string }> = {
  AGREED: { fg: '#15803D', bg: '#EAF7EF' },
  ADJUDICATED: { fg: '#B45309', bg: '#FFF6E5' },
  WITHDRAWN: { fg: '#C2410C', bg: '#FDEEE7' },
};

interface Props {
  order: OrderItem;
  onOpen: () => void;
}

/**
 * Tranh chấp đã xong (dispute.status RESOLVED) thì đơn rời trạng thái DISPUTED — khối này giữ đường
 * vào xem lại hồ sơ. Dữ liệu từ `dispute {status, outcome}` trong chi tiết đơn.
 */
export const DisputeResultCard: React.FC<Props> = ({ order, onOpen }) => {
  const dispute = order.dispute;
  if (!dispute || dispute.status !== 'RESOLVED' || order.status === 'DISPUTED') return null;

  const tone = dispute.outcome ? OUTCOME_TONE[dispute.outcome] : { fg: '#4A5568', bg: '#EDF2F7' };
  const label = dispute.outcome ? DISPUTE_OUTCOME_LABELS[dispute.outcome] : 'Đã kết thúc';

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Ionicons name="scale-outline" size={18} color="#6027D2" />
        <Text style={styles.title}>Kết quả tranh chấp</Text>
      </View>
      <View style={[styles.box, { backgroundColor: tone.bg }]}>
        <Text style={[styles.boxText, { color: tone.fg }]}>Kết quả: {label}</Text>
      </View>
      <Text style={styles.note}>
        Kết luận từng cây xem trong hồ sơ tranh chấp. Số tiền hoàn và tiền đền xem ở mục Quyết toán đơn.
      </Text>
      <TouchableOpacity style={styles.btn} onPress={onOpen} activeOpacity={0.85}>
        <Text style={styles.btnText}>Xem hồ sơ tranh chấp</Text>
        <Ionicons name="chevron-forward" size={16} color="#6027D2" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FAF8FE',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '700', color: '#1A202C' },
  box: { borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 },
  boxText: { fontSize: 13, fontWeight: '700' },
  note: { fontSize: 12, color: '#4B4764', marginTop: 8, lineHeight: 17 },
  btn: {
    marginTop: 12,
    backgroundColor: '#F1EBFF',
    borderRadius: 10,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  btnText: { color: '#6027D2', fontWeight: '700', fontSize: 14 },
});
