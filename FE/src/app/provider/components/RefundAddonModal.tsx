'use client';

import React, { useEffect, useState } from 'react';
import { App, Input, Modal } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { getApiErrorCode } from '@/lib/api';
import { AddonItem, providerApi } from '@/lib/provider.api';

/**
 * Vườn trả lại add-on khách đã trả tiền mà vườn không làm được —
 * POST /orders/:orderId/addons/:addonId/refund (BE addons.service → refund).
 * Chỉ khi add-on PAID và đơn IN_CARE. Khách nhận lại đủ giá + 6% (amountDue), lệnh chi tạo ngay.
 * Không tính vi phạm cho vườn. Lý do 5–500 ký tự, khách đọc được.
 */

const REASON_MIN = 5;
const REASON_MAX = 500;

const REFUND_ERRORS: Record<string, string> = {
  ADDON_INVALID_STATE: 'Add-on này không còn ở trạng thái trả lại được (chưa thanh toán, đã báo xong hoặc đã trả lại).',
  INVALID_STATE_TRANSITION: 'Đơn không còn đang chăm sóc nên không trả lại add-on được.',
  ADDON_NOT_FOUND: 'Không tìm thấy add-on này. Hãy tải lại trang.',
  ORDER_NOT_FOUND: 'Không tìm thấy đơn hàng. Hãy tải lại trang.',
  PROFILE_NOT_APPROVED: 'Hồ sơ nhà vườn chưa được duyệt.',
};

interface Props {
  orderId: string | null;
  addon: AddonItem | null;
  onClose: () => void;
  // Gọi sau khi trả lại thành công để trang tải lại danh sách add-on.
  onRefunded: (updated: AddonItem) => void;
}

export default function RefundAddonModal({ orderId, addon, onClose, onRefunded }: Props) {
  const { message } = App.useApp();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (addon) setReason('');
  }, [addon]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;
  const price = Number(addon?.price || 0);
  const fee = Number(addon?.customerFee || 0);
  const refundAmount = Number(addon?.amountDue || price + fee);

  const handleSubmit = async () => {
    if (!orderId || !addon || !valid) return;
    setSubmitting(true);
    try {
      const updated = await providerApi.refundAddon(orderId, addon.id, trimmed);
      message.success(`Đã trả lại add-on. Khách sẽ được hoàn ${refundAmount.toLocaleString('vi-VN')} đ.`);
      onRefunded(updated);
    } catch (err) {
      const code = getApiErrorCode(err);
      message.error((code && REFUND_ERRORS[code]) || 'Không trả lại được add-on. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={Boolean(addon)}
      onCancel={() => !submitting && onClose()}
      title="Trả lại add-on cho khách?"
      okText="Xác nhận trả lại"
      cancelText="Huỷ"
      onOk={handleSubmit}
      confirmLoading={submitting}
      okButtonProps={{ danger: true, disabled: !valid, className: '!font-semibold' }}
      destroyOnClose
      width={480}
    >
      {addon && (
        <div className="space-y-4 pt-1">
          <div className="rounded-xl bg-[#FAF8FE] border border-[#ECE7FA] p-3 text-xs text-[#4B4764] space-y-1">
            <div className="font-bold text-sm text-[#1E1B2E]">{addon.title}</div>
            {addon.plant?.name && <div>Chậu: {addon.plant.name}</div>}
            <div>
              Khách được hoàn <b className="text-[#1E1B2E]">{refundAmount.toLocaleString('vi-VN')} đ</b> (giá{' '}
              {price.toLocaleString('vi-VN')} đ + phí 6% {fee.toLocaleString('vi-VN')} đ).
            </div>
          </div>

          <p className="text-xs text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-2.5 flex gap-2">
            <WarningOutlined className="mt-0.5" />
            <span>
              Không hoàn tác được. Dùng khi vườn không làm được dịch vụ này. Không tính là vi phạm của vườn.
            </span>
          </p>

          <div className="space-y-1">
            <label htmlFor="refund-addon-reason" className="text-xs font-semibold text-[#1E1B2E]">
              Lý do trả lại (khách sẽ đọc được)
            </label>
            <Input.TextArea
              id="refund-addon-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={REASON_MAX}
              showCount
              placeholder="VD: Cây đang yếu, thay chậu lúc này dễ sốc rễ."
            />
            {trimmed.length > 0 && trimmed.length < REASON_MIN && (
              <p className="text-[11px] text-[#DC2626]">Lý do cần ít nhất {REASON_MIN} ký tự.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
