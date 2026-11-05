import { ConflictException } from '@nestjs/common';
import type { VideoCall } from './entities/video-call.entity';
import type { VideoCallEndReason, VideoCallRole } from './video-call.constants';

/**
 * Luật thuần của cuộc gọi 1-1 (không chạm DB/mạng, kiểu orders/order-status.ts) để unit-test
 * mọi nhánh. Service gọi các hàm này rồi mới ghi DB.
 */

// 3 mốc thời gian (giây) đọc từ env VIDEO_CALL_* (bản chốt §5.4).
export interface VideoCallTimeouts {
  ringSeconds: number;
  graceSeconds: number;
  maxDurationSeconds: number;
}

export type VideoCallParties = Pick<
  VideoCall,
  'callerAccountId' | 'calleeAccountId'
>;

export type VideoCallTimeline = Pick<
  VideoCall,
  'status' | 'createdAt' | 'answeredAt' | 'shortHandedSince'
>;

export type ExpiryEndReason = Extract<
  VideoCallEndReason,
  'MISSED' | 'DROPPED' | 'TIMEOUT'
>;

export interface DueExpiry {
  endReason: ExpiryEndReason;
  // L10: đúng mốc hết hạn, không phải lúc hệ thống phát hiện.
  endedAt: Date;
}

const addSeconds = (date: Date, seconds: number): Date =>
  new Date(date.getTime() + seconds * 1000);

// Lúc hết giờ đổ chuông (FE đếm ngược theo mốc này).
export function ringExpiresAt(
  call: Pick<VideoCall, 'createdAt'>,
  t: VideoCallTimeouts,
): Date {
  return addSeconds(call.createdAt, t.ringSeconds);
}

// Vai của tài khoản trong cuộc gọi; null = người ngoài.
export function roleOf(
  call: VideoCallParties,
  accountId: string,
): VideoCallRole | null {
  if (call.callerAccountId === accountId) return 'CALLER';
  if (call.calleeAccountId === accountId) return 'CALLEE';
  return null;
}

/**
 * POST /:id/join làm gì:
 * - ANSWER: người nhận bấm nghe lúc đang đổ chuông → ACTIVE.
 * - REJOIN: vào lại / chuyển máy (cuộc đang nói, hoặc người gọi mở lại lúc còn đổ chuông — L6)
 *   → chỉ cấp phiên thiết bị + token mới, không đổi trạng thái.
 * - Cuộc đã kết thúc không vào lại được (L9).
 */
export function resolveJoin(
  call: Pick<VideoCall, 'status'>,
  role: VideoCallRole,
): 'ANSWER' | 'REJOIN' {
  if (call.status === 'RINGING') {
    return role === 'CALLEE' ? 'ANSWER' : 'REJOIN';
  }
  if (call.status === 'ACTIVE') {
    return 'REJOIN';
  }
  throw new ConflictException('VIDEO_CALL_ENDED');
}

/**
 * Bấm kết thúc thì đóng với lý do gì (L1, L2). Cuộc đã kết thúc → null
 * (service trả nguyên trạng, không đóng lần nữa).
 */
export function resolveEndReason(
  call: Pick<VideoCall, 'status'>,
  role: VideoCallRole,
): Extract<VideoCallEndReason, 'CANCELLED' | 'DECLINED' | 'COMPLETED'> | null {
  if (call.status === 'RINGING') {
    return role === 'CALLER' ? 'CANCELLED' : 'DECLINED';
  }
  if (call.status === 'ACTIVE') {
    return 'COMPLETED';
  }
  return null;
}

/**
 * Cuộc gọi đã quá hạn chưa (tính tới `now`)? Đúng bằng mốc = đã hết hạn.
 * - RINGING: quá giờ đổ chuông → MISSED (L1).
 * - ACTIVE: quá thời lượng tính từ lúc nghe → TIMEOUT (L2); thiếu người quá thời gian chờ
 *   → DROPPED (L3). Đơn đã đóng (`orderCallable = false`) thì thời gian chờ = 0 (L7, P11).
 *   Lấy mốc SỚM NHẤT đã qua; hai mốc trùng nhau → TIMEOUT (P10).
 *   DROPPED chỉ là ứng viên: service hỏi lại GetStream trước khi đóng (K10).
 * - ENDED: không bao giờ hết hạn lại.
 */
export function findDueExpiry(
  call: VideoCallTimeline,
  now: Date,
  t: VideoCallTimeouts,
  options: { orderCallable: boolean },
): DueExpiry | null {
  const nowMs = now.getTime();
  if (call.status === 'RINGING') {
    const due = ringExpiresAt(call, t);
    return due.getTime() <= nowMs
      ? { endReason: 'MISSED', endedAt: due }
      : null;
  }
  if (call.status !== 'ACTIVE') {
    return null;
  }

  let earliest: DueExpiry | null = null;
  if (call.answeredAt) {
    const due = addSeconds(call.answeredAt, t.maxDurationSeconds);
    if (due.getTime() <= nowMs) {
      earliest = { endReason: 'TIMEOUT', endedAt: due };
    }
  }
  if (call.shortHandedSince) {
    const grace = options.orderCallable ? t.graceSeconds : 0;
    const due = addSeconds(call.shortHandedSince, grace);
    // Chỉ thắng khi SỚM HƠN hẳn mốc quá giờ — trùng mốc thì giữ TIMEOUT.
    if (
      due.getTime() <= nowMs &&
      (!earliest || due.getTime() < earliest.endedAt.getTime())
    ) {
      earliest = { endReason: 'DROPPED', endedAt: due };
    }
  }
  return earliest;
}

// K9: đếm theo BÊN (người gọi / người nhận), không theo thiết bị; user lạ bị bỏ qua.
export function countPresentParties(
  call: VideoCallParties,
  userIds: readonly string[],
): number {
  const present = new Set(userIds);
  return (
    Number(present.has(call.callerAccountId)) +
    Number(present.has(call.calleeAccountId))
  );
}

/**
 * Mốc thiếu người sau khi biết số bên đang có mặt (L3):
 * đủ 2 bên → null (xóa mốc); thiếu → giữ mốc cũ nếu đã có (không dời — rời/vào liên tục không
 * kéo dài được thời gian chờ), chưa có thì bắt đầu từ `now`.
 */
export function nextShortHandedSince(
  current: Date | null,
  presentParties: number,
  now: Date,
): Date | null {
  if (presentParties >= 2) {
    return null;
  }
  return current ?? now;
}

// P15: thời lượng đã nói (giây, làm tròn xuống) — chỉ khi đã nghe và đã kết thúc.
export function durationSeconds(
  call: Pick<VideoCall, 'answeredAt' | 'endedAt'>,
): number | null {
  if (!call.answeredAt || !call.endedAt) {
    return null;
  }
  return Math.floor(
    (call.endedAt.getTime() - call.answeredAt.getTime()) / 1000,
  );
}
