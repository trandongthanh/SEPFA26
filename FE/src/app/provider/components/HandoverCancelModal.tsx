'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Image, Input, Modal, Spin, Upload } from 'antd';
import {
  CameraOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  LoadingOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  CancelHandoverPayload,
  HANDOVER_CANCEL_MAX_PHOTOS,
  HANDOVER_CANCEL_REASON_MAX,
  HandoverCancelReasonCode,
  providerApi,
} from '@/lib/provider.api';

/**
 * Vườn huỷ ở chặng nhận cây — POST /orders/:id/handover/cancel. Luật lấy đúng theo BE
 * (handover.service.ts → cancelHandover), dựa trên trạng thái PHIÊN NHẬN CÂY của chi tiết đơn:
 *   IN_PROGRESS       (đang kiểm tra cây)        → "Khách vắng nhà" (từ giờ hẹn + 30 phút, 1–5 ảnh)
 *                                                  hoặc "Vườn không nhận được cây";
 *   AWAITING_CUSTOMER (đã chốt biên bản, chờ khách) → chỉ "Vườn không nhận được cây";
 *   AWAITING_DEPOSIT  (khách đã đồng ý, chờ bảo đảm) → "Không nộp được tiền bảo đảm" (không gửi reasonCode).
 * Tiền (payments/cancel-order-refund.ts): khách vắng → vườn giữ phí lấy cây (chi sau 3 ngày), khách nhận
 * giá gói + phí 6% + tiền khai giá; hai lý do còn lại → khách nhận lại toàn bộ, vườn +1 lần bỏ đơn.
 */

type Stage = 'IN_PROGRESS' | 'AWAITING_CUSTOMER' | 'AWAITING_DEPOSIT';
type Choice = HandoverCancelReasonCode | 'DEPOSIT_UNPAID';

interface OrderForCancel {
  id: string;
  orderCode: string;
  pickupFeeSnapshot?: string | null;
  handoverStatus?: string | null;
  handover?: { status?: string; customerConfirmDueAt?: string | null } | null;
  deadlines?: { noShowFrom?: string | null } | null;
  securityDeposit?: { status?: string; dueAt?: string | null } | null;
}

interface Photo {
  photoUrl: string;
  gpsLat?: number;
  gpsLng?: number;
}

const STAGES: Stage[] = ['IN_PROGRESS', 'AWAITING_CUSTOMER', 'AWAITING_DEPOSIT'];

/** Vườn có được bấm "Không nhận được cây" không — dùng để hiện/ẩn nút (chi tiết đơn có handoverStatus). */
export function canCancelHandover(order: { status?: string; handoverStatus?: string | null }) {
  return STAGES.includes(order.handoverStatus as Stage);
}

/** Danh sách đơn không có handoverStatus → hiện nút theo trạng thái đơn, hộp thoại tự tải chi tiết để kiểm lại. */
export const HANDOVER_CANCEL_ORDER_STATUSES = ['HANDOVER_IN_PROGRESS', 'HANDOVER_AWAITING_CONFIRM'];

const vnd = (value: string | number | null | undefined) =>
  `${Number(value || 0).toLocaleString('vi-VN')} ₫`;
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
function remaining(ms: number) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} giờ ${m} phút` : `${m} phút`;
}

/** Vị trí điện thoại lúc chụp — BE cho phép bỏ trống (tắt định vị, mất sóng). */
function readGps(): Promise<{ gpsLat?: number; gpsLng?: number }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          gpsLat: Number(pos.coords.latitude.toFixed(6)),
          gpsLng: Number(pos.coords.longitude.toFixed(6)),
        }),
      () => resolve({}),
      { timeout: 8000, maximumAge: 60000 },
    );
  });
}

const OPTION_TEXT: Record<Choice, { title: string; desc: string; placeholder: string }> = {
  CUSTOMER_ABSENT: {
    title: 'Khách vắng nhà',
    desc: 'Bạn đã tới đúng địa chỉ nhưng không gặp được khách.',
    placeholder: 'Ví dụ: Gọi 3 cuộc lúc 14:05, 14:15, 14:28 không nghe máy, bấm chuông không ai ra.',
  },
  PROVIDER_CANNOT_SERVE: {
    title: 'Vườn không nhận được cây',
    desc: 'Ví dụ: cây khác xa ảnh ban đầu, vườn không đủ chỗ hoặc không chăm được loại này.',
    placeholder: 'Ví dụ: Cây Hồ Điệp bị thối gốc, khác ảnh ban đầu.',
  },
  DEPOSIT_UNPAID: {
    title: 'Không nộp được tiền bảo đảm',
    desc: 'Bạn không nộp kịp hoặc không đủ tiền bảo đảm cho các cây đã nhận.',
    placeholder: 'Ví dụ: Không xoay kịp tiền bảo đảm trong 2 giờ.',
  },
};

interface Props {
  orderId: string | null;
  onClose: () => void;
  onCancelled: () => void;
}

export default function HandoverCancelModal({ orderId, onClose, onCancelled }: Props) {
  const { message } = App.useApp();
  const [order, setOrder] = useState<OrderForCancel | null>(null);
  const [loading, setLoading] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Luôn tải lại chi tiết đơn khi mở: danh sách đơn không có trạng thái phiên nhận cây và các mốc giờ.
  useEffect(() => {
    if (!orderId) return;
    setOrder(null);
    setChoice(null);
    setReason('');
    setPhotos([]);
    setLoading(true);
    providerApi
      .getOrderDetail(orderId)
      .then((data: OrderForCancel) => setOrder(data))
      .catch((err: any) => {
        message.error(err?.response?.data?.message || 'Không tải được thông tin đơn.');
        onClose();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Đồng hồ cho mốc "khách vắng" / hạn trả lời / hạn nộp bảo đảm.
  useEffect(() => {
    if (!orderId) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [orderId]);

  const stage = (order?.handoverStatus ?? null) as Stage | null;
  const validStage = stage !== null && STAGES.includes(stage);
  const noShowFrom = order?.deadlines?.noShowFrom ?? null;
  const absentOpen = !!noShowFrom && now >= new Date(noShowFrom).getTime();

  const options = useMemo(() => {
    if (stage === 'IN_PROGRESS') {
      return [
        {
          value: 'CUSTOMER_ABSENT' as Choice,
          disabledWhy: absentOpen
            ? null
            : noShowFrom
              ? `Mở lúc ${hhmm(noShowFrom)} (giờ hẹn + 30 phút)`
              : 'Chưa tới giờ hẹn + 30 phút',
        },
        { value: 'PROVIDER_CANNOT_SERVE' as Choice, disabledWhy: null },
      ];
    }
    if (stage === 'AWAITING_CUSTOMER') {
      return [
        { value: 'CUSTOMER_ABSENT' as Choice, disabledWhy: 'Không dùng được sau khi đã chốt biên bản' },
        { value: 'PROVIDER_CANNOT_SERVE' as Choice, disabledWhy: null },
      ];
    }
    if (stage === 'AWAITING_DEPOSIT') {
      return [{ value: 'DEPOSIT_UNPAID' as Choice, disabledWhy: null }];
    }
    return [];
  }, [stage, absentOpen, noShowFrom]);

  // Chọn sẵn lựa chọn hợp lệ đầu tiên; lựa chọn đang chọn bị khoá (vd đồng hồ chưa tới) thì bỏ chọn.
  useEffect(() => {
    const enabled = options.filter((o) => !o.disabledWhy);
    if (!choice || !enabled.some((o) => o.value === choice)) {
      setChoice(enabled[0]?.value ?? null);
    }
  }, [options, choice]);

  const timerLine = (() => {
    if (!order) return null;
    if (stage === 'IN_PROGRESS' && noShowFrom) {
      return absentOpen
        ? { tone: 'ok', text: 'Đã quá giờ hẹn 30 phút. Khách không có mặt thì bạn có thể báo khách vắng nhà.' }
        : {
            tone: 'warn',
            text: `Tới ${hhmm(noShowFrom)} mới báo được khách vắng nhà. Còn ${remaining(new Date(noShowFrom).getTime() - now)}.`,
          };
    }
    if (stage === 'AWAITING_CUSTOMER') {
      const due = order.handover?.customerConfirmDueAt;
      return {
        tone: 'warn',
        text: `Đã chốt biên bản${due ? `, khách còn ${remaining(new Date(due).getTime() - now)} để trả lời` : ''}. Khách im lặng quá hạn thì hệ thống tự huỷ và vườn giữ phí lấy cây.`,
      };
    }
    if (stage === 'AWAITING_DEPOSIT') {
      const due = order.securityDeposit?.dueAt;
      return {
        tone: 'warn',
        text: `Khách đã đồng ý biên bản${due ? `. Còn ${remaining(new Date(due).getTime() - now)} để nộp tiền bảo đảm` : ''}, quá hạn hệ thống tự huỷ đơn.`,
      };
    }
    return null;
  })();

  const handleUpload = async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      message.error('Chỉ hỗ trợ ảnh JPG, PNG hoặc WEBP.');
      return false;
    }
    if (file.size > 5 * 1024 * 1024) {
      message.error('Ảnh tối đa 5 MB.');
      return false;
    }
    if (photos.length >= HANDOVER_CANCEL_MAX_PHOTOS) {
      message.warning(`Tối đa ${HANDOVER_CANCEL_MAX_PHOTOS} ảnh.`);
      return false;
    }
    setUploading(true);
    try {
      const [uploaded, gps] = await Promise.all([providerApi.uploadDocument(file), readGps()]);
      setPhotos((prev) => [...prev, { photoUrl: uploaded.url, ...gps }].slice(0, HANDOVER_CANCEL_MAX_PHOTOS));
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Tải ảnh thất bại, vui lòng thử lại.');
    } finally {
      setUploading(false);
    }
    return false;
  };

  const trimmedReason = reason.trim();
  const needsPhotos = choice === 'CUSTOMER_ABSENT';
  const canSubmit =
    !!choice && trimmedReason.length > 0 && (!needsPhotos || photos.length > 0) && !uploading;

  const handleSubmit = async () => {
    if (!order || !choice || !canSubmit) return;
    const payload: CancelHandoverPayload = { reason: trimmedReason };
    if (choice !== 'DEPOSIT_UNPAID') payload.reasonCode = choice;
    if (choice === 'CUSTOMER_ABSENT') payload.photos = photos;
    setSubmitting(true);
    try {
      await providerApi.cancelHandover(order.id, payload);
      message.success(
        choice === 'CUSTOMER_ABSENT'
          ? 'Đã báo khách vắng nhà và huỷ đơn. Phí lấy cây sẽ được chuyển cho vườn sau 3 ngày.'
          : 'Đã huỷ đơn. Khách sẽ được hoàn lại toàn bộ tiền.',
      );
      onCancelled();
      onClose();
    } catch (err: any) {
      const raw = err?.response?.data?.message || err?.message || 'Huỷ đơn thất bại.';
      const text = Array.isArray(raw) ? raw.join(', ') : String(raw);
      message.error(
        text === 'INVALID_STATE_TRANSITION'
          ? 'Trạng thái đơn vừa thay đổi. Vui lòng tải lại trang rồi thử lại.'
          : text,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const pickupFee = Number(order?.pickupFeeSnapshot || 0);
  const isFullRefund = choice === 'PROVIDER_CANNOT_SERVE' || choice === 'DEPOSIT_UNPAID';

  return (
    <Modal
      open={!!orderId}
      onCancel={() => !submitting && onClose()}
      title={
        <div>
          <div className="text-base font-extrabold text-[#1E1B2E]">
            Không nhận được cây{order ? ` · ${order.orderCode}` : ''}
          </div>
          <div className="text-xs font-normal text-[#6E6A8A] mt-0.5">
            {stage === 'IN_PROGRESS' && 'Bạn đang ở chỗ khách, chưa chốt biên bản nhận cây.'}
            {stage === 'AWAITING_CUSTOMER' && 'Hai bên đã gặp nhau nên không chọn được "khách vắng nhà".'}
            {stage === 'AWAITING_DEPOSIT' && 'Khách đã đồng ý biên bản, đang chờ bạn nộp tiền bảo đảm.'}
          </div>
        </div>
      }
      width={560}
      destroyOnHidden
      footer={
        validStage
          ? [
              <Button key="back" onClick={onClose} disabled={submitting} className="!rounded-xl">
                Quay lại
              </Button>,
              <Button
                key="ok"
                danger
                type="primary"
                loading={submitting}
                disabled={!canSubmit}
                onClick={handleSubmit}
                className="!rounded-xl !font-semibold"
              >
                {choice === 'CUSTOMER_ABSENT' ? 'Báo khách vắng & huỷ đơn' : 'Xác nhận huỷ đơn'}
              </Button>,
            ]
          : [
              <Button key="close" onClick={onClose} className="!rounded-xl">
                Đóng
              </Button>,
            ]
      }
    >
      {loading || !order ? (
        <div className="py-10 text-center">
          <Spin />
        </div>
      ) : !validStage ? (
        <p className="text-sm text-[#4B4764] py-4 m-0">
          Đơn này không còn ở chặng nhận cây nên không huỷ được từ đây. Vui lòng tải lại trang.
        </p>
      ) : (
        <div className="flex flex-col gap-4 pt-1">
          {timerLine && (
            <div
              className={`flex gap-2.5 items-start rounded-xl border px-3 py-2.5 text-[12.5px] ${
                timerLine.tone === 'ok'
                  ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
                  : 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
              }`}
            >
              <ClockCircleOutlined className="mt-0.5" />
              <span>{timerLine.text}</span>
            </div>
          )}

          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Lý do huỷ">
            <span className="text-[12.5px] font-bold text-[#4B4764]">Lý do</span>
            {options.map((opt) => {
              const text = OPTION_TEXT[opt.value];
              const selected = choice === opt.value;
              const disabled = !!opt.disabledWhy;
              return (
                <label
                  key={opt.value}
                  className={`flex gap-3 items-start rounded-[14px] border-[1.5px] px-3.5 py-3 ${
                    disabled
                      ? 'cursor-not-allowed bg-[#F6F4FC] opacity-75 border-[#ECE7FA]'
                      : selected
                        ? 'cursor-pointer border-[#6027D2] bg-[#FBF8FF]'
                        : 'cursor-pointer border-[#ECE7FA] bg-white hover:border-[#C4B5FD]'
                  }`}
                >
                  <input
                    type="radio"
                    name="handover-cancel-reason"
                    value={opt.value}
                    checked={selected}
                    disabled={disabled}
                    onChange={() => setChoice(opt.value)}
                    className="mt-1 w-4 h-4 accent-[#6027D2] shrink-0"
                  />
                  <span className="min-w-0">
                    <b className="block text-sm text-[#1E1B2E]">{text.title}</b>
                    <small className="block text-xs text-[#6E6A8A] mt-0.5">{text.desc}</small>
                    {opt.disabledWhy && (
                      <span className="inline-block mt-1.5 text-[11.5px] font-semibold text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-full px-2.5">
                        {opt.disabledWhy}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          {needsPhotos && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-[#4B4764]">
                Ảnh chụp tại chỗ (1–{HANDOVER_CANCEL_MAX_PHOTOS} ảnh) <span className="text-red-500">*</span>
              </span>
              <div className="flex flex-wrap gap-2 items-center">
                <Image.PreviewGroup>
                  {photos.map((photo, index) => (
                    <div key={photo.photoUrl} className="relative w-[76px] h-[76px]">
                      <Image
                        src={photo.photoUrl}
                        alt={`Ảnh tại chỗ ${index + 1}`}
                        width={76}
                        height={76}
                        className="!w-[76px] !h-[76px] object-cover rounded-[10px]"
                      />
                      {photo.gpsLat !== undefined && (
                        <span className="absolute left-1 bottom-1 text-[10px] font-semibold bg-white/90 rounded px-1 text-[#4B4764] pointer-events-none">
                          <EnvironmentOutlined /> có vị trí
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Xoá ảnh ${index + 1}`}
                        onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== index))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white grid place-items-center text-[10px] shadow"
                      >
                        <DeleteOutlined />
                      </button>
                    </div>
                  ))}
                </Image.PreviewGroup>
                {photos.length < HANDOVER_CANCEL_MAX_PHOTOS && (
                  <Upload
                    showUploadList={false}
                    accept="image/png,image/jpeg,image/webp"
                    beforeUpload={(file) => handleUpload(file)}
                    disabled={uploading}
                  >
                    <button
                      type="button"
                      className="w-[76px] h-[76px] rounded-[10px] border-[1.5px] border-dashed border-[#C4B5FD] bg-[#FBF8FF] text-[#6027D2] text-[11px] font-semibold flex flex-col items-center justify-center gap-1 cursor-pointer"
                    >
                      {uploading ? <LoadingOutlined /> : <CameraOutlined className="text-base" />}
                      {photos.length ? 'Chụp thêm' : 'Chụp ảnh'}
                    </button>
                  </Upload>
                )}
              </div>
              <span className="text-[11.5px] text-[#6E6A8A]">
                Chụp cổng nhà, số nhà. Vị trí điện thoại được gửi kèm nếu bạn cho phép (không bắt buộc).
              </span>
            </div>
          )}

          {choice && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="handover-cancel-note" className="text-[12.5px] font-bold text-[#4B4764]">
                Ghi chú cho khách và Admin <span className="text-red-500">*</span>
              </label>
              <Input.TextArea
                id="handover-cancel-note"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={HANDOVER_CANCEL_REASON_MAX}
                showCount
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder={OPTION_TEXT[choice].placeholder}
              />
            </div>
          )}

          {choice && (
            <div
              className={`rounded-[14px] border px-3.5 py-3 flex flex-col gap-1.5 text-[13px] ${
                isFullRefund ? 'bg-[#FEF2F2] border-[#FECACA]' : 'bg-[#F6F4FC] border-[#ECE7FA]'
              }`}
            >
              <b className="text-[12.5px] text-[#4B4764]">Sau khi huỷ</b>
              {isFullRefund ? (
                <>
                  <div className="flex justify-between gap-3">
                    <span className="text-[#6E6A8A]">Vườn nhận</span>
                    <b className="text-[#DC2626] tabular-nums">0 ₫</b>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[#6E6A8A] shrink-0">Khách được hoàn</span>
                    <b className="text-right text-[12.5px]">Toàn bộ: giá gói + phí 6% + phí lấy cây + tiền bảo đảm khai giá</b>
                  </div>
                  <div className="flex gap-1.5 items-start text-xs text-[#991B1B]">
                    <WarningOutlined className="mt-0.5" />
                    <span>Đơn này được tính là 1 lần vườn nhận đơn rồi bỏ. Admin thấy số lần này khi xét hồ sơ.</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between gap-3">
                    <span className="text-[#6E6A8A]">
                      Vườn nhận phí lấy cây{pickupFee > 0 ? ' (chuyển sau 3 ngày)' : ''}
                    </span>
                    <b className="text-[#059669] tabular-nums">{vnd(pickupFee)}</b>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[#6E6A8A] shrink-0">Khách được hoàn</span>
                    <b className="text-right text-[12.5px]">Giá gói + phí dịch vụ 6% + tiền bảo đảm khai giá</b>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
