'use client';

import React from 'react';
import { CloseCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

/**
 * Khối "Đơn đã huỷ" cho vườn — vì sao huỷ, ai huỷ, có tính lỗi cho vườn không, tiền đi đâu.
 * Đọc cancelCode / cancelledBy / cancelReason / cancelledAt + settlement của chi tiết đơn (BE orders.service
 * getOrderDetail), không gọi API thêm. Đơn huỷ thì settlement là phần của khách (customer-settlement.ts).
 * Vườn giữ = tiền đơn khách đã trả (gói + 6% + phí lấy cây) − tiền đã hoàn từ sổ đơn → ra phí lấy cây hoặc 0.
 */

// [tiêu đề, giải thích, tính lỗi cho vườn] — khớp countsAgainstProvider của BE (cancel-rules.ts, handover.service.ts,
// order-deadlines.service.ts).
const PROVIDER_COPY: Record<string, [string, string, boolean]> = {
  CUSTOMER_WITHDREW: ['Khách rút đơn trước khi thanh toán', 'Không tính lỗi cho vườn.', false],
  SIGN_TIMEOUT: ['Khách không ký hợp đồng đúng hạn', 'Hệ thống tự huỷ. Không tính lỗi cho vườn.', false],
  PAYMENT_TIMEOUT: ['Khách không thanh toán đúng hạn', 'Hệ thống tự huỷ. Không tính lỗi cho vườn.', false],
  CUSTOMER_CANCELLED_FREE: [
    'Khách huỷ sớm (trước giờ hẹn hơn 3 tiếng)',
    'Khách được hoàn đủ. Không tính lỗi cho vườn.',
    false,
  ],
  CUSTOMER_CANCELLED_LATE: [
    'Khách huỷ muộn (trong 3 tiếng trước giờ hẹn)',
    'Vườn giữ phí lấy cây. Không tính lỗi cho vườn.',
    false,
  ],
  PROVIDER_CANCELLED: ['Vườn huỷ đơn', 'Vườn bị tính 1 lần bỏ đơn.', true],
  CUSTOMER_ABSENT: ['Khách vắng nhà', 'Vườn giữ phí lấy cây. Không tính lỗi cho vườn.', false],
  PROVIDER_CANNOT_SERVE: ['Vườn không nhận cây nào', 'Khách được hoàn đủ. Vườn bị tính 1 lần bỏ đơn.', true],
  CUSTOMER_DECLINED: [
    'Khách không giao cây sau khi xem biên bản',
    'Vườn giữ phí lấy cây. Không tính lỗi cho vườn.',
    false,
  ],
  CONFIRM_TIMEOUT: [
    'Khách không trả lời biên bản trong 2 giờ',
    'Hệ thống tự huỷ. Vườn giữ phí lấy cây.',
    false,
  ],
  DEPOSIT_UNPAID: [
    'Vườn không nộp tiền bảo đảm trong 2 giờ',
    'Khách được hoàn đủ. Vườn bị tính 1 lần bỏ đơn.',
    true,
  ],
};

const noShowCopy = (by?: string | null): [string, string, boolean] =>
  by === 'SYSTEM'
    ? ['Quá giờ hẹn 24 giờ chưa chốt biên bản nhận cây', 'Hệ thống tự huỷ. Vườn bị tính 1 lần bỏ đơn.', true]
    : ['Vườn không tới lấy cây (khách báo)', 'Khách được hoàn đủ. Vườn bị tính 1 lần bỏ đơn.', true];

const WHO: Record<string, string> = {
  CUSTOMER: 'Khách huỷ',
  PROVIDER: 'Vườn huỷ',
  SYSTEM: 'Hệ thống tự huỷ',
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const vnd = (v: number) => `${v.toLocaleString('vi-VN')} VNĐ`;

export interface CancelledOrderSource {
  status?: string;
  cancelCode?: string | null;
  cancelledBy?: 'CUSTOMER' | 'PROVIDER' | 'SYSTEM' | null;
  cancelReason?: string | null;
  cancelledAt?: string | null;
  paidAt?: string | null;
  settlement?: {
    packageAmount?: string;
    customerFee?: string;
    pickupFee?: string;
    refundAmount?: string;
    declaredDepositReturned?: string;
  } | null;
}

export default function CancelledOrderInfo({ order }: { order: CancelledOrderSource }) {
  if (order.status !== 'CANCELLED') return null;

  const code = order.cancelCode ?? '';
  const known = code === 'PROVIDER_NO_SHOW' ? noShowCopy(order.cancelledBy) : PROVIDER_COPY[code];
  const [title, detail, fault] = known ?? ['Đơn đã bị huỷ', '', false];
  const meta = [
    order.cancelledAt ? dayjs(order.cancelledAt).format('HH:mm DD/MM/YYYY') : null,
    order.cancelledBy ? WHO[order.cancelledBy] : null,
    code || null,
  ].filter(Boolean);
  // Câu hệ thống ghi đã có trong tiêu đề → chỉ hiện ghi chú người bấm huỷ tự gõ.
  const note = order.cancelledBy && order.cancelledBy !== 'SYSTEM' ? order.cancelReason?.trim() : null;
  const noteOwner = order.cancelledBy === 'PROVIDER' ? 'vườn' : 'khách';

  const s = order.settlement;
  const paid = !!order.paidAt && !!s;
  const refund = num(s?.refundAmount);
  const customerBack = refund + num(s?.declaredDepositReturned);
  const kept = Math.max(0, num(s?.packageAmount) + num(s?.customerFee) + num(s?.pickupFee) - refund);

  return (
    <div className="rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden shadow-xs">
      <div className="px-4 py-3 bg-[#EDF2F7] flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <CloseCircleOutlined className="text-[#4A5568]" />
          <span className="font-extrabold text-sm text-[#1E1B2E]">Đơn đã huỷ</span>
          {known &&
            (fault ? (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
                Tính 1 lần bỏ đơn
              </span>
            ) : (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                Không tính lỗi cho vườn
              </span>
            ))}
        </div>
        {meta.length > 0 && <span className="text-xs text-[#6E6A8A]">{meta.join(' · ')}</span>}
      </div>

      <div className="p-4 flex flex-col gap-3 text-xs">
        <div>
          <span className="block text-[11px] text-[#8B86A4]">Lý do</span>
          <span className="block font-bold text-sm text-[#1E1B2E]">{title}</span>
          {detail && <span className="block text-[#4B4764] mt-0.5">{detail}</span>}
          {!known && order.cancelReason && <span className="block text-[#4B4764] mt-0.5">{order.cancelReason}</span>}
        </div>

        {note && (
          <p className="border-l-[3px] border-[#ECE7FA] pl-2.5 italic text-[#6E6A8A]">
            Ghi chú của {noteOwner}: &ldquo;{note}&rdquo;
          </p>
        )}

        {paid ? (
          <div className="flex flex-col gap-1">
            <div className="rounded-xl bg-[#FAF8FE] p-3 flex flex-col gap-1.5">
              <div className="flex justify-between gap-3">
                <span className="text-[#8B86A4]">Khách được hoàn</span>
                <span className="font-semibold text-[#1E1B2E]">{vnd(customerBack)}</span>
              </div>
              <div className="flex justify-between gap-3 border-t border-[#ECE7FA] pt-1.5">
                <span className="font-bold text-[#1E1B2E]">Vườn giữ phí lấy cây</span>
                <span className="font-extrabold text-[#1E1B2E]">{vnd(kept)}</span>
              </div>
            </div>
            {kept > 0 && (
              <span className="text-[11px] text-[#8B86A4]">Phí lấy cây được chuyển cho vườn sau 3 ngày đối soát.</span>
            )}
          </div>
        ) : (
          <p className="rounded-xl bg-[#FAF8FE] p-3 text-[#6E6A8A]">Đơn chưa thanh toán nên không có tiền.</p>
        )}
      </div>
    </div>
  );
}
