'use client';

import React, { useEffect, useState } from 'react';
import { App, Button, Input, Modal } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { providerApi } from '@/lib/provider.api';

/**
 * Vườn huỷ đơn TRƯỚC khi mở phiên nhận cây — POST /orders/:id/cancel, body chỉ { reason } (CancelOrderDto).
 * Luật lấy theo BE (orders/cancel-rules.ts → decideCancel, vai PROVIDER):
 *   AGREEMENT_PENDING / AWAITING_PAYMENT → PROVIDER_CANCELLED, không có tiền để hoàn, vườn +1 lần bỏ đơn;
 *   PAID                                 → PROVIDER_CANCELLED, khách hoàn 100% (kể cả phí lấy cây), vườn +1 lần bỏ đơn;
 *   PENDING_PROVIDER → không dùng route này (vườn bấm "Từ chối"); trạng thái khác → 409.
 */
export const PROVIDER_CANCELLABLE_STATUSES = ['AGREEMENT_PENDING', 'AWAITING_PAYMENT', 'PAID'];
const REASON_MAX = 500;

interface Props {
  order: { id: string; orderCode: string; status: string } | null;
  onClose: () => void;
  onCancelled: () => void;
}

export default function OrderCancelModal({ order, onClose, onCancelled }: Props) {
  const { message } = App.useApp();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (order) setReason('');
  }, [order]);

  const paid = order?.status === 'PAID';
  const trimmed = reason.trim();

  const handleSubmit = async () => {
    if (!order || !trimmed) return;
    setSubmitting(true);
    try {
      await providerApi.cancelOrder(order.id, trimmed);
      message.success(paid ? 'Đã huỷ đơn. Khách sẽ được hoàn lại toàn bộ tiền.' : 'Đã huỷ đơn.');
      onCancelled();
      onClose();
    } catch (err: any) {
      const raw = err?.response?.data?.message || err?.message || 'Huỷ đơn thất bại.';
      const text = Array.isArray(raw) ? raw.join(', ') : String(raw);
      message.error(
        text === 'INVALID_STATE_TRANSITION'
          ? 'Đơn không còn huỷ được ở bước này (có thể bạn đã bắt đầu nhận cây hoặc đơn vừa đổi trạng thái). Vui lòng tải lại trang.'
          : text,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={!!order}
      onCancel={() => !submitting && onClose()}
      width={520}
      destroyOnHidden
      title={
        <div>
          <div className="text-base font-extrabold text-[#1E1B2E]">Huỷ đơn{order ? ` · ${order.orderCode}` : ''}</div>
          <div className="text-xs font-normal text-[#6E6A8A] mt-0.5">
            {paid
              ? 'Khách đã thanh toán, bạn chưa bắt đầu nhận cây.'
              : 'Đơn chưa thanh toán (đang chờ ký hợp đồng hoặc chờ khách trả tiền).'}
          </div>
        </div>
      }
      footer={[
        <Button key="back" onClick={onClose} disabled={submitting} className="!rounded-xl">
          Quay lại
        </Button>,
        <Button
          key="ok"
          danger
          type="primary"
          loading={submitting}
          disabled={!trimmed}
          onClick={handleSubmit}
          className="!rounded-xl !font-semibold"
        >
          Xác nhận huỷ đơn
        </Button>,
      ]}
    >
      <div className="flex flex-col gap-4 pt-1">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="order-cancel-reason" className="text-[12.5px] font-bold text-[#4B4764]">
            Lý do huỷ (gửi cho khách và Admin) <span className="text-red-500">*</span>
          </label>
          <Input.TextArea
            id="order-cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={REASON_MAX}
            showCount
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder="Ví dụ: Vườn đột xuất kín chỗ, không nhận thêm cây trong tuần này."
          />
        </div>

        <div className="rounded-[14px] border px-3.5 py-3 flex flex-col gap-1.5 text-[13px] bg-[#FEF2F2] border-[#FECACA]">
          <b className="text-[12.5px] text-[#4B4764]">Sau khi huỷ</b>
          <div className="flex justify-between gap-3">
            <span className="text-[#6E6A8A]">Vườn nhận</span>
            <b className="text-[#DC2626] tabular-nums">0 ₫</b>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[#6E6A8A] shrink-0">Khách</span>
            <b className="text-right text-[12.5px]">
              {paid
                ? 'Được hoàn toàn bộ: giá gói + phí 6% + phí lấy cây + tiền bảo đảm khai giá'
                : 'Chưa trả tiền nên không có khoản hoàn'}
            </b>
          </div>
          <div className="flex gap-1.5 items-start text-xs text-[#991B1B]">
            <WarningOutlined className="mt-0.5" />
            <span>Đơn này được tính là 1 lần vườn nhận đơn rồi bỏ. Admin thấy số lần này khi xét hồ sơ.</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
