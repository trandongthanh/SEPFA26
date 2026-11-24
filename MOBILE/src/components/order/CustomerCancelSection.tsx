import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  CANCEL_REASON_MAX,
  CUSTOMER_WITHDRAW_STATUSES,
  CancelPreview,
  DeclinePreview,
  OrderItem,
  orderService,
} from '../../services/orderService';
import { formatDateTime, formatVnd, toNumber } from './orderMoney';

/**
 * Khách huỷ đơn — khớp BE:
 *  - POST /orders/:id/cancel {reason}: chờ vườn nhận / chờ ký / chờ thanh toán → rút đơn, không có tiền;
 *    đã thanh toán → BE tự quyết theo giờ hẹn (cancel-rules decideCancel), số tiền xem trước lấy từ `cancelPreview`.
 *  - POST /orders/:id/handover/decline {reason}: chờ khách trả lời biên bản nhận cây (phiên AWAITING_CUSTOMER,
 *    trong hạn customerConfirmDueAt) → vườn giữ phí lấy cây.
 * Từ khi vườn mở phiên nhận cây thì không còn nút huỷ (BE trả 409).
 */
type Kind = 'withdraw' | 'paid' | 'decline';

const PAID_COPY = {
  CUSTOMER_CANCELLED_FREE: {
    button: 'Huỷ đơn',
    title: 'Huỷ đơn?',
    tone: 'ok' as const,
    box: 'Còn trong thời gian huỷ miễn phí. Bạn nhận lại toàn bộ.',
  },
  CUSTOMER_CANCELLED_LATE: {
    button: 'Huỷ đơn',
    title: 'Huỷ đơn?',
    tone: 'warn' as const,
    box: 'Huỷ trong 3 giờ trước giờ hẹn: vườn giữ phí lấy cây.',
  },
  PROVIDER_NO_SHOW: {
    button: 'Báo vườn không tới',
    title: 'Báo vườn không tới?',
    tone: 'ok' as const,
    box: 'Lỗi của vườn. Bạn nhận lại toàn bộ, vườn bị tính 1 lần bỏ đơn.',
  },
};

const TONES = {
  ok: { fg: '#15803D', bg: '#EAF7EF' },
  warn: { fg: '#B45309', bg: '#FFF6E5' },
  bad: { fg: '#C2410C', bg: '#FDEEE7' },
};

interface Props {
  order: OrderItem;
  onChanged: () => void;
}

const kindOf = (order: OrderItem): Kind | null => {
  if (CUSTOMER_WITHDRAW_STATUSES.includes(order.status)) return 'withdraw';
  if (order.status === 'PAID') return 'paid';
  // BE chỉ trả declinePreview khi bấm "Không giao cây" sẽ thành công (isDeclineOpen).
  if (order.declinePreview) return 'decline';
  // Dự phòng khi sổ lệch (BE trả null): cùng điều kiện isDeclineOpen, hộp xác nhận không có số.
  const handoverStatus = order.handover?.status ?? order.handoverStatus;
  const dueAt = order.handover?.customerConfirmDueAt;
  if (
    order.status === 'HANDOVER_AWAITING_CONFIRM' &&
    handoverStatus === 'AWAITING_CUSTOMER' &&
    !(dueAt && new Date(dueAt).getTime() <= Date.now())
  ) {
    return 'decline';
  }
  return null;
};

export const CustomerCancelSection: React.FC<Props> = ({ order, onChanged }) => {
  const [visible, setVisible] = useState(false);
  const [opening, setOpening] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<CancelPreview | null>(order.cancelPreview ?? null);
  const [declinePrev, setDeclinePrev] = useState<DeclinePreview | null>(order.declinePreview ?? null);

  const kind = kindOf(order);
  if (!kind) return null;

  const paidCopy = order.cancelPreview ? PAID_COPY[order.cancelPreview.cancelCode] : null;
  const buttonLabel =
    kind === 'withdraw' ? 'Rút đơn' : kind === 'decline' ? 'Không giao cây' : paidCopy?.button ?? 'Huỷ đơn';

  const open = async () => {
    setReason('');
    if (kind === 'paid' || kind === 'decline') {
      // Lấy lại chi tiết đơn để số tiền xem trước đúng với thời điểm bấm.
      setOpening(true);
      try {
        const fresh = await orderService.getOrderDetail(order.id);
        if (fresh.status !== order.status || (kind === 'decline' && kindOf(fresh) !== 'decline')) {
          onChanged();
          Alert.alert('Đơn đã thay đổi', 'Trạng thái đơn vừa được cập nhật. Vui lòng xem lại.');
          return;
        }
        setPreview(fresh.cancelPreview ?? null);
        setDeclinePrev(fresh.declinePreview ?? null);
      } catch {
        setPreview(order.cancelPreview ?? null);
        setDeclinePrev(order.declinePreview ?? null);
      } finally {
        setOpening(false);
      }
    }
    setVisible(true);
  };

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      Alert.alert('Thiếu lý do', 'Vui lòng nhập lý do.');
      return;
    }
    setSubmitting(true);
    try {
      const res =
        kind === 'decline'
          ? await orderService.declineHandover(order.id, trimmed)
          : await orderService.cancelOrder(order.id, trimmed);
      setVisible(false);
      const refund = toNumber(res.refundAmount);
      const declared = toNumber(res.declaredDepositReturned);
      let msg = kind === 'withdraw' ? 'Đã rút đơn.' : 'Đã huỷ đơn.';
      if (refund > 0 || declared > 0) {
        msg += `\nBạn nhận lại ${formatVnd(refund)}`;
        if (declared > 0) msg += ` và ${formatVnd(declared)} tiền bảo đảm khai giá`;
        msg += '.';
      }
      Alert.alert('Thành công', msg);
      onChanged();
    } catch (err: any) {
      const m = err?.response?.data?.message || err?.message || 'Không huỷ được đơn.';
      Alert.alert('Lỗi', Array.isArray(m) ? m.join('\n') : m);
    } finally {
      setSubmitting(false);
    }
  };

  // ----- Nội dung thẻ trên màn chi tiết -----
  let hint: React.ReactNode = null;
  if (kind === 'withdraw') {
    hint = <Text style={styles.note}>Bạn chưa thanh toán nên rút đơn không mất tiền.</Text>;
  } else if (kind === 'paid') {
    const code = order.cancelPreview?.cancelCode;
    if (code === 'CUSTOMER_CANCELLED_LATE') {
      hint = (
        <Box tone="warn">
          Đã qua {formatDateTime(order.deadlines?.freeCancelUntil)}. Huỷ lúc này vườn giữ phí lấy cây.
        </Box>
      );
    } else if (code === 'PROVIDER_NO_SHOW') {
      hint = <Box tone="bad">Đã quá giờ hẹn 30 phút mà vườn chưa bắt đầu nhận cây.</Box>;
    } else if (order.deadlines?.freeCancelUntil) {
      hint = (
        <Text style={styles.note}>Huỷ miễn phí tới {formatDateTime(order.deadlines.freeCancelUntil)}.</Text>
      );
    }
  } else {
    hint = order.handover?.customerConfirmDueAt ? (
      <Text style={styles.note}>
        Hạn trả lời biên bản: {formatDateTime(order.handover.customerConfirmDueAt)}. Không giao cây thì vườn giữ
        phí lấy cây.
      </Text>
    ) : null;
  }

  // ----- Nội dung hộp xác nhận -----
  const modalTitle =
    kind === 'withdraw'
      ? 'Rút đơn?'
      : kind === 'decline'
        ? 'Không giao cây?'
        : preview
          ? PAID_COPY[preview.cancelCode].title
          : 'Huỷ đơn?';

  const renderModalBody = () => {
    if (kind === 'withdraw') {
      return <Box tone="ok">Bạn chưa thanh toán nên không mất tiền.</Box>;
    }
    if (kind === 'decline' && declinePrev) {
      const refund = toNumber(declinePrev.refundAmount);
      const declared = toNumber(declinePrev.declaredDepositReturned);
      const kept = toNumber(declinePrev.pickupFeeKept);
      return (
        <>
          <Box tone="warn">Vườn đã tới nơi và khám cây nên vườn giữ phí lấy cây.</Box>
          <Row label="Hoàn tiền đơn" value={formatVnd(refund)} />
          {declared > 0 && <Row label="Trả lại tiền bảo đảm khai giá" value={formatVnd(declared)} />}
          {kept > 0 && <Row label="Vườn giữ (phí lấy cây)" value={formatVnd(kept)} />}
          <Row label="Tổng nhận lại" value={formatVnd(refund + declared)} total />
        </>
      );
    }
    if (kind === 'decline') {
      const declared = toNumber(order.declaredDepositTotal);
      return (
        <>
          <Box tone="warn">
            Vườn đã tới nơi và khám cây nên vườn giữ phí lấy cây
            {order.settlement ? ` (${formatVnd(order.settlement.pickupFee)})` : ''}. Phần còn lại hoàn cho bạn.
          </Box>
          {declared > 0 && (
            <Text style={styles.note}>Tiền bảo đảm khai giá {formatVnd(declared)} được trả lại đủ.</Text>
          )}
          <Text style={styles.note}>Số tiền hoàn chính xác hiện ngay sau khi bạn xác nhận.</Text>
        </>
      );
    }
    if (!preview) {
      return <Text style={styles.note}>Số tiền hoàn do hệ thống tính theo giờ hẹn lấy cây.</Text>;
    }
    const copy = PAID_COPY[preview.cancelCode];
    const refund = toNumber(preview.refundAmount);
    const declared = toNumber(preview.declaredDepositReturned);
    const kept = toNumber(preview.pickupFeeKept);
    return (
      <>
        <Box tone={copy.tone}>{copy.box}</Box>
        <Row label="Hoàn tiền đơn" value={formatVnd(refund)} />
        {declared > 0 && <Row label="Trả lại tiền bảo đảm khai giá" value={formatVnd(declared)} />}
        {kept > 0 && <Row label="Vườn giữ (phí lấy cây)" value={formatVnd(kept)} />}
        <Row label="Tổng nhận lại" value={formatVnd(refund + declared)} total />
      </>
    );
  };

  const reasonLabel =
    kind === 'withdraw'
      ? 'Lý do rút đơn'
      : kind === 'decline'
        ? 'Lý do không giao cây'
        : preview?.cancelCode === 'PROVIDER_NO_SHOW'
          ? 'Mô tả ngắn'
          : 'Lý do huỷ';

  return (
    <View style={styles.card}>
      {hint}
      <TouchableOpacity style={styles.dangerBtn} onPress={open} disabled={opening} activeOpacity={0.85}>
        {opening ? (
          <ActivityIndicator size="small" color="#C2410C" />
        ) : (
          <>
            <Ionicons name="close-circle-outline" size={18} color="#C2410C" />
            <Text style={styles.dangerBtnText}>{buttonLabel}</Text>
          </>
        )}
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{modalTitle}</Text>
              <TouchableOpacity onPress={() => setVisible(false)} disabled={submitting}>
                <Ionicons name="close-circle" size={24} color="#A0AEC0" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
              {renderModalBody()}
              <Text style={styles.inputLabel}>{reasonLabel} (bắt buộc)</Text>
              <TextInput
                style={styles.input}
                value={reason}
                onChangeText={setReason}
                placeholder="Nhập lý do"
                multiline
                maxLength={CANCEL_REASON_MAX}
              />
              <Text style={styles.counter}>
                {reason.length}/{CANCEL_REASON_MAX}
              </Text>
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setVisible(false)}
                disabled={submitting}
              >
                <Text style={styles.cancelBtnText}>Quay lại</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, !reason.trim() && { opacity: 0.5 }]}
                onPress={submit}
                disabled={submitting || !reason.trim()}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmBtnText}>Xác nhận</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const Box: React.FC<{ tone: keyof typeof TONES; children: React.ReactNode }> = ({ tone, children }) => (
  <View style={[styles.box, { backgroundColor: TONES[tone].bg }]}>
    <Text style={[styles.boxText, { color: TONES[tone].fg }]}>{children}</Text>
  </View>
);

const Row: React.FC<{ label: string; value: string; total?: boolean }> = ({ label, value, total }) => (
  <View style={[styles.row, total && styles.totalRow]}>
    <Text style={total ? styles.totalLabel : styles.rowLabel}>{label}</Text>
    <Text style={total ? styles.totalValue : styles.rowValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    gap: 10,
  },
  note: { fontSize: 12, color: '#4A5568', lineHeight: 17 },
  box: { borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 },
  boxText: { fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F3B49B',
    backgroundColor: '#FDEEE7',
  },
  dangerBtnText: { color: '#C2410C', fontWeight: '700', fontSize: 14 },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '85%',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#1A202C' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  rowLabel: { fontSize: 13, color: '#718096' },
  rowValue: { fontSize: 13, fontWeight: '600', color: '#2D3748' },
  totalRow: { borderTopWidth: 1, borderTopColor: '#EDF2F7', paddingTop: 8 },
  totalLabel: { fontSize: 14, fontWeight: '700', color: '#1A202C' },
  totalValue: { fontSize: 14, fontWeight: '700', color: '#15803D' },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#2D3748', marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: 14,
    color: '#1A202C',
  },
  counter: { fontSize: 11, color: '#A0AEC0', textAlign: 'right' },
  footer: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#EDF2F7',
    alignItems: 'center',
  },
  cancelBtnText: { fontWeight: '700', color: '#4A5568' },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#C2410C',
    alignItems: 'center',
  },
  confirmBtnText: { fontWeight: '700', color: '#FFFFFF' },
});
