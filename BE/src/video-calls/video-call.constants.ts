import type { OrderStatus } from '../orders/order-status';

/**
 * Cuộc gọi video 1-1 giữa khách và provider của một đơn.
 * Nguồn quyết định: BE/docs/video-call-ban-chot.md (mã B/L/K trong comment trỏ tới file đó).
 * RINGING (đang đổ chuông) → ACTIVE (đã nghe) → ENDED (kết thúc, lý do ở end_reason).
 */
export const VIDEO_CALL_STATUSES = ['RINGING', 'ACTIVE', 'ENDED'] as const;
export type VideoCallStatus = (typeof VIDEO_CALL_STATUSES)[number];

// Cuộc gọi "đang sống": còn chiếm máy của hai người; mỗi đơn tối đa 1 cuộc (L4, B9).
export const LIVE_VIDEO_CALL_STATUSES = [
  'RINGING',
  'ACTIVE',
] as const satisfies readonly VideoCallStatus[];

// L1, L2: COMPLETED cúp lúc đang nói · DECLINED người nhận từ chối · CANCELLED người gọi hủy
// (hoặc hệ thống hủy khi đơn bị đóng lúc đổ chuông — L8) · MISSED hết giờ đổ chuông ·
// DROPPED thiếu người quá thời gian chờ · TIMEOUT quá thời lượng tối đa.
export const VIDEO_CALL_END_REASONS = [
  'COMPLETED',
  'DECLINED',
  'CANCELLED',
  'MISSED',
  'DROPPED',
  'TIMEOUT',
] as const;
export type VideoCallEndReason = (typeof VIDEO_CALL_END_REASONS)[number];

// Vai trong cuộc gọi: người bấm gọi / bên còn lại của đơn.
export const VIDEO_CALL_ROLES = ['CALLER', 'CALLEE'] as const;
export type VideoCallRole = (typeof VIDEO_CALL_ROLES)[number];

// B2: đơn gọi được từ lúc gửi cho provider tới khi đang chăm cây.
// DRAFT (chưa ai thấy đơn), REJECTED, CANCELLED → không gọi được.
export const CALLABLE_ORDER_STATUSES = [
  'PENDING_PROVIDER',
  'AGREEMENT_PENDING',
  'AWAITING_PAYMENT',
  'PAID',
  'HANDOVER_IN_PROGRESS',
  'HANDOVER_AWAITING_CONFIRM',
  'IN_CARE',
] as const satisfies readonly OrderStatus[];

// Bản chốt §5.3: 4 sự kiện socket (namespace /ws, room theo tài khoản).
export const VIDEO_CALL_EVENTS = [
  'video_call.ringing',
  'video_call.accepted',
  'video_call.moved',
  'video_call.ended',
] as const;
export type VideoCallEventName = (typeof VIDEO_CALL_EVENTS)[number];

// ===== GetStream =====

// K5: role toàn app của user LanCare, không có grant nào trên các call type có sẵn
// → call token bị lộ cũng không tạo được cuộc gọi né BE.
export const STREAM_APP_ROLE = 'lancare_user';

// K1: role của hai bên trong cuộc gọi (role member + claim role trong call token).
export const STREAM_CALL_MEMBER_ROLE = 'call_member';

// K1: quyền duy nhất của hai bên — vào cuộc gọi, xem cuộc gọi, gửi tiếng, gửi hình.
// Kết thúc/kick/mute/ghi hình/sửa cài đặt chỉ BE làm bằng server key.
export const STREAM_CALL_MEMBER_GRANTS = [
  'join-call',
  'read-call',
  'send-audio',
  'send-video',
] as const;

// K1b: khai rõ các role này KHÔNG có quyền gì trên call type riêng
// (không khai thì GetStream tự gán quyền mặc định).
export const STREAM_EMPTY_GRANT_ROLES = [
  'user',
  'guest',
  STREAM_APP_ROLE,
] as const;

// K4: tên hiển thị của user hệ thống đứng tên mọi cuộc gọi.
export const STREAM_SYSTEM_USER_NAME = 'LanCare Hub';

// K10b-1 (P18): hỏi danh sách người có mặt lỗi → nghỉ hỏi 10 giây cho cuộc gọi đó.
export const PRESENCE_RETRY_AFTER_MS = 10_000;

// K3b (P20): thời lượng tối đa phía GetStream = tối đa + đổ chuông + 60 giây dự phòng.
export const STREAM_DURATION_BUFFER_SECONDS = 60;

// K6: call token hiệu lực = đổ chuông + tối đa + 300 giây.
export const CALL_TOKEN_BUFFER_SECONDS = 300;

// P26 (bản chốt "Mặc định khác" [14/10 tối]): chỉ script setup dùng timeout SDK 15 giây
// (PUT call type tốn > 3 giây). BE lúc chạy giữ mặc định 3000 ms vì đang giữ khóa transaction.
export const STREAM_SETUP_TIMEOUT_MS = 15_000;
