'use client';

import React, { useEffect, useState } from 'react';
import { ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

/**
 * Hạn chót của đơn ở các bước chờ — luật lấy theo BE (orders/order-deadlines.service.ts):
 *   PENDING_PROVIDER  providerRespondDueAt → quá hạn: đơn Hết hạn (không tính vườn bỏ đơn);
 *   AGREEMENT_PENDING agreementDueAt       → quá hạn: hệ thống tự huỷ (SIGN_TIMEOUT);
 *   AWAITING_PAYMENT  paymentDueAt         → quá hạn: hệ thống tự huỷ (PAYMENT_TIMEOUT);
 *   PAID              giờ hẹn + 24 giờ      → quá hạn: tự huỷ PROVIDER_NO_SHOW, khách hoàn 100%, vườn +1 lần bỏ đơn.
 * Các mốc lấy thẳng từ đơn (danh sách và chi tiết đều có cột *_due_at). Riêng mốc "vườn không tới" BE
 * không trả sẵn → tính giờ hẹn + 24 giờ, khớp NO_SHOW_AUTO_CANCEL_MS (orders/cancel-rules.ts).
 */
const NO_SHOW_AUTO_CANCEL_MS = 24 * 60 * 60 * 1000;
const URGENT_MS = 2 * 60 * 60 * 1000; // còn dưới 2 giờ → tô đỏ

export interface OrderDeadlineSource {
  status?: string;
  scheduledPickupAt?: string | null;
  providerRespondDueAt?: string | null;
  agreementDueAt?: string | null;
  paymentDueAt?: string | null;
  deadlines?: {
    providerRespondDueAt?: string | null;
    agreementDueAt?: string | null;
    paymentDueAt?: string | null;
  } | null;
}

function remaining(ms: number) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} ngày ${h} giờ`;
  if (h > 0) return `${h} giờ ${m} phút`;
  return `${m} phút`;
}

function describe(order: OrderDeadlineSource): { dueAt: string; text: (when: string) => string } | null {
  const pick = (key: 'providerRespondDueAt' | 'agreementDueAt' | 'paymentDueAt') =>
    order.deadlines?.[key] ?? order[key] ?? null;
  switch (order.status) {
    case 'PENDING_PROVIDER': {
      const dueAt = pick('providerRespondDueAt');
      return dueAt ? { dueAt, text: (w) => `Trả lời đơn trước ${w}. Quá hạn đơn tự hết hạn.` } : null;
    }
    case 'AGREEMENT_PENDING': {
      const dueAt = pick('agreementDueAt');
      return dueAt
        ? { dueAt, text: (w) => `Hai bên cần ký hợp đồng trước ${w}. Quá hạn hệ thống tự huỷ đơn.` }
        : null;
    }
    case 'AWAITING_PAYMENT': {
      const dueAt = pick('paymentDueAt');
      return dueAt
        ? { dueAt, text: (w) => `Khách cần thanh toán trước ${w}. Quá hạn hệ thống tự huỷ đơn.` }
        : null;
    }
    case 'PAID': {
      // BE chỉ tự huỷ đơn có hạn thanh toán (đơn cũ không có thì bỏ qua) — giữ đúng điều kiện đó.
      if (!order.scheduledPickupAt || !pick('paymentDueAt')) return null;
      const dueAt = new Date(new Date(order.scheduledPickupAt).getTime() + NO_SHOW_AUTO_CANCEL_MS).toISOString();
      return {
        dueAt,
        text: (w) =>
          `Tới lấy cây trước ${w} (giờ hẹn + 24 giờ). Quá hạn hệ thống tự huỷ, khách được hoàn 100% và tính 1 lần vườn bỏ đơn.`,
      };
    }
    default:
      return null;
  }
}

/** Dòng nhắc hạn chót; không có hạn ở trạng thái hiện tại thì không hiện gì. */
export default function OrderDeadline({ order, className = '' }: { order: OrderDeadlineSource; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const info = describe(order);
  if (!info) return null;
  const left = new Date(info.dueAt).getTime() - now;
  const urgent = left < URGENT_MS;
  const when = dayjs(info.dueAt).format('HH:mm DD/MM');

  return (
    <div
      className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
        urgent ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]' : 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
      } ${className}`}
    >
      <ClockCircleOutlined className="mt-0.5 shrink-0" />
      <span>
        {info.text(when)}{' '}
        <b className="tabular-nums">{left > 0 ? `Còn ${remaining(left)}.` : 'Đã quá hạn, đang chờ hệ thống xử lý.'}</b>
      </span>
    </div>
  );
}
