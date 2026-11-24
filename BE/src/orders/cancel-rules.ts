import { ConflictException } from '@nestjs/common';
import type { HandoverStatus } from './entities/handover.entity';
import type { OrderStatus } from './order-status';

/**
 * Luật huỷ đơn trước khi nhận cây + các hạn chờ — toán thuần (không chạm DB) để unit-test đủ mọi mốc.
 * Mốc DUY NHẤT của luật huỷ là giờ hẹn lấy cây khách chọn lúc tạo đơn (`scheduled_pickup_at`).
 * Giờ mẫu: khách gửi đơn 07:00, hẹn 18:00 cùng ngày →
 *   mốc đóng (hết miễn phí huỷ, cũng là trần của ba hạn chờ) 15:00 · hết ân hạn 18:30 · tự huỷ 18:00 hôm sau.
 */
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// Khách huỷ đơn đã thanh toán miễn phí tới trước giờ hẹn 3 giờ; cũng là trần của ba hạn chờ trước thanh toán.
export const FREE_CANCEL_BEFORE_PICKUP_MS = 3 * HOUR_MS;
// Ân hạn sau giờ hẹn: qua mốc này khách mới báo được "vườn không tới", vườn mới báo được "khách vắng nhà".
export const PICKUP_GRACE_MS = 30 * MINUTE_MS;
// Mỗi hạn chờ trước thanh toán (vườn trả lời, ký, thanh toán) tối đa 24 giờ.
export const WAIT_WINDOW_MS = 24 * HOUR_MS;
// Quá giờ hẹn 24 giờ mà vườn chưa chốt biên bản nhận cây → hệ thống tự huỷ.
export const NO_SHOW_AUTO_CANCEL_MS = 24 * HOUR_MS;
// Khách có 2 giờ để trả lời biên bản nhận cây (hai bên đang gặp nhau).
export const HANDOVER_CONFIRM_WINDOW_MS = 2 * HOUR_MS;

// Mã lý do huỷ cố định (cột service_orders.cancel_code) — FE hiện đúng câu, đếm được theo lý do.
export const CANCEL_CODES = [
  'CUSTOMER_WITHDREW', // khách rút đơn khi chưa thanh toán
  'CUSTOMER_CANCELLED_FREE', // khách huỷ đơn đã thanh toán, sớm hơn 3 giờ trước giờ hẹn → hoàn 100%
  'CUSTOMER_CANCELLED_LATE', // khách huỷ trong 3 giờ cuối (tới hết ân hạn) → vườn giữ phí lấy cây
  'PROVIDER_NO_SHOW', // vườn không tới (khách báo sau ân hạn, hoặc hệ thống tự huỷ sau 24 giờ)
  'PROVIDER_CANCELLED', // vườn huỷ đơn đã nhận, trước khi tới nhà khách
  'CUSTOMER_ABSENT', // vườn tới nơi, khách vắng nhà → vườn giữ phí lấy cây
  'PROVIDER_CANNOT_SERVE', // vườn tới nơi nhưng không nhận (từ chối hết cây, tự bỏ)
  'CUSTOMER_DECLINED', // khách không giao cây sau khi xem biên bản (BR-117)
  'DEPOSIT_UNPAID', // vườn không nộp tiền bảo đảm (BR-118)
  'SIGN_TIMEOUT', // quá hạn ký hợp đồng
  'PAYMENT_TIMEOUT', // quá hạn thanh toán
  'CONFIRM_TIMEOUT', // khách im lặng với biên bản nhận cây quá 2 giờ
] as const;
export type CancelCode = (typeof CANCEL_CODES)[number];

// Lý do viết cho người đọc sổ — ghi vào ghi chú bút toán hoàn tiền (chỉ các mã có tiền di chuyển mới dùng tới).
export const CANCEL_LABELS: Record<CancelCode, string> = {
  CUSTOMER_WITHDREW: 'khách rút đơn khi chưa thanh toán',
  CUSTOMER_CANCELLED_FREE: 'khách huỷ sớm hơn 3 giờ trước giờ hẹn',
  CUSTOMER_CANCELLED_LATE: 'khách huỷ trong 3 giờ cuối trước giờ hẹn',
  PROVIDER_NO_SHOW: 'vườn không tới lấy cây',
  PROVIDER_CANCELLED: 'vườn huỷ đơn đã nhận',
  CUSTOMER_ABSENT: 'khách vắng nhà',
  PROVIDER_CANNOT_SERVE: 'vườn không nhận cây',
  CUSTOMER_DECLINED: 'khách không giao cây',
  DEPOSIT_UNPAID: 'vườn không nộp tiền bảo đảm',
  SIGN_TIMEOUT: 'quá hạn ký hợp đồng',
  PAYMENT_TIMEOUT: 'quá hạn thanh toán',
  CONFIRM_TIMEOUT: 'khách không trả lời biên bản nhận cây trong 2 giờ',
};

export const CANCELLED_BY = ['CUSTOMER', 'PROVIDER', 'SYSTEM'] as const;
// Ai BẤM huỷ (không phải lỗi của ai — lỗi của ai đọc ở cancel_code). Hệ thống tự làm → SYSTEM.
export type CancelledBy = (typeof CANCELLED_BY)[number];

/**
 * Tiền của đơn đi đâu khi huỷ:
 *   NONE            — đơn chưa thanh toán, không có gì để chia;
 *   FULL            — khách nhận lại 100%, kể cả phí lấy cây (đơn mẫu 484.000);
 *   KEEP_PICKUP_FEE — vườn giữ phí lấy cây, khách nhận lại giá gói + 6% (đơn mẫu 424.000 / 60.000).
 * Tiền bảo đảm khai giá của khách trả đủ ở cả FULL lẫn KEEP_PICKUP_FEE.
 */
export type CancelRefund = 'NONE' | 'FULL' | 'KEEP_PICKUP_FEE';

export interface CancelDecision {
  code: CancelCode;
  refund: CancelRefund;
  // true = cộng một lần "nhận đơn rồi bỏ" cho vườn (provider_profiles.cancelled_order_count).
  countsAgainstProvider: boolean;
}

/** Hạn của một trạng thái chờ = sớm hơn trong (lúc vào + 24 giờ) và (giờ hẹn − 3 giờ). */
export function waitDueAt(enteredAt: Date, pickupAt: Date): Date {
  return new Date(
    Math.min(
      enteredAt.getTime() + WAIT_WINDOW_MS,
      pickupAt.getTime() - FREE_CANCEL_BEFORE_PICKUP_MS,
    ),
  );
}

/** Mốc hết miễn phí huỷ của khách (giờ hẹn − 3 giờ). */
export function freeCancelUntil(pickupAt: Date): Date {
  return new Date(pickupAt.getTime() - FREE_CANCEL_BEFORE_PICKUP_MS);
}

/** Mốc hết ân hạn (giờ hẹn + 30 phút): từ đây mới báo được "vườn không tới" / "khách vắng nhà". */
export function noShowFrom(pickupAt: Date): Date {
  return new Date(pickupAt.getTime() + PICKUP_GRACE_MS);
}

/** Mốc hệ thống tự huỷ vì vườn không tới / mở phiên rồi bỏ dở (giờ hẹn + 24 giờ). */
export function noShowAutoCancelAt(pickupAt: Date): Date {
  return new Date(pickupAt.getTime() + NO_SHOW_AUTO_CANCEL_MS);
}

/** Gửi đơn: giờ hẹn phải còn HƠN 3 giờ, không thì ba hạn chờ hết ngay lúc gửi. */
export function isPickupTooSoon(pickupAt: Date, now: Date): boolean {
  return pickupAt.getTime() - now.getTime() <= FREE_CANCEL_BEFORE_PICKUP_MS;
}

/** Hạn đã qua chưa. Hạn rỗng (đơn tạo trước khi có luật này) = không có hạn. */
export function isPastDue(dueAt: Date | null | undefined, now: Date): boolean {
  return !!dueAt && dueAt.getTime() <= now.getTime();
}

/**
 * Khách còn bấm được "Không giao cây" không — đúng các điều kiện route POST /orders/:id/handover/decline kiểm,
 * để màn xem trước (declinePreview) chỉ hiện số khi bấm thật sẽ thành công:
 * đơn HANDOVER_AWAITING_CONFIRM + phiên nhận cây AWAITING_CUSTOMER (chưa đồng ý biên bản) + chưa quá hạn 2 giờ.
 * Khách đã đồng ý (phiên AWAITING_DEPOSIT) hoặc quá hạn (bộ quét chưa kịp huỷ) → false.
 */
export function isDeclineOpen(input: {
  orderStatus: OrderStatus;
  handoverStatus: HandoverStatus | null | undefined;
  customerConfirmDueAt: Date | null | undefined;
  now: Date;
}): boolean {
  return (
    input.orderStatus === 'HANDOVER_AWAITING_CONFIRM' &&
    input.handoverStatus === 'AWAITING_CUSTOMER' &&
    !isPastDue(input.customerConfirmDueAt, input.now)
  );
}

const PRE_PAYMENT: readonly OrderStatus[] = [
  'PENDING_PROVIDER',
  'AGREEMENT_PENDING',
  'AWAITING_PAYMENT',
];

/**
 * Khách hoặc vườn bấm huỷ đơn (POST /orders/:id/cancel) — quyết định mã lý do + tiền đi đâu.
 * Tổ hợp không có ở đây là bị cấm → 409 INVALID_STATE_TRANSITION:
 *   - đơn Nháp (khách cứ bỏ đó) và đơn đã kết thúc;
 *   - vườn với đơn đang chờ vườn trả lời (dùng nút Từ chối);
 *   - mọi vai khi vườn đã mở phiên nhận cây (dùng các nút của chặng nhận cây).
 */
export function decideCancel(input: {
  role: 'CUSTOMER' | 'PROVIDER';
  status: OrderStatus;
  now: Date;
  pickupAt: Date;
}): CancelDecision {
  const { role, status, now, pickupAt } = input;
  if (role === 'CUSTOMER') {
    if (PRE_PAYMENT.includes(status)) {
      return {
        code: 'CUSTOMER_WITHDREW',
        refund: 'NONE',
        countsAgainstProvider: false,
      };
    }
    if (status === 'PAID') {
      if (now.getTime() < freeCancelUntil(pickupAt).getTime()) {
        return {
          code: 'CUSTOMER_CANCELLED_FREE',
          refund: 'FULL',
          countsAgainstProvider: false,
        };
      }
      if (now.getTime() < noShowFrom(pickupAt).getTime()) {
        return {
          code: 'CUSTOMER_CANCELLED_LATE',
          refund: 'KEEP_PICKUP_FEE',
          countsAgainstProvider: false,
        };
      }
      return {
        code: 'PROVIDER_NO_SHOW',
        refund: 'FULL',
        countsAgainstProvider: true,
      };
    }
  } else {
    if (status === 'AGREEMENT_PENDING' || status === 'AWAITING_PAYMENT') {
      return {
        code: 'PROVIDER_CANCELLED',
        refund: 'NONE',
        countsAgainstProvider: true,
      };
    }
    if (status === 'PAID') {
      return {
        code: 'PROVIDER_CANCELLED',
        refund: 'FULL',
        countsAgainstProvider: true,
      };
    }
  }
  throw new ConflictException('INVALID_STATE_TRANSITION');
}

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Khoảng cách đường chim bay giữa hai toạ độ (mét, công thức haversine). */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Khoảng cách (mét, làm tròn) từ nơi vườn chụp ảnh "khách vắng" tới điểm lấy cây của đơn.
 * Thiếu một trong các toạ độ (vườn tắt định vị) → null. CHỈ để tham khảo: GPS điện thoại lệch 5–50 m,
 * ghim địa chỉ của khách cũng lệch, nên không đặt ngưỡng chặn.
 */
export function distanceToPickupMeters(
  photo: { gpsLat?: number | null; gpsLng?: number | null },
  pickup: { gpsLat: string | number; gpsLng: string | number },
): number | null {
  if (
    photo.gpsLat === undefined ||
    photo.gpsLat === null ||
    photo.gpsLng === undefined ||
    photo.gpsLng === null
  ) {
    return null;
  }
  const pickupLat = Number(pickup.gpsLat);
  const pickupLng = Number(pickup.gpsLng);
  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
    return null;
  }
  return Math.round(
    haversineMeters(photo.gpsLat, photo.gpsLng, pickupLat, pickupLng),
  );
}
