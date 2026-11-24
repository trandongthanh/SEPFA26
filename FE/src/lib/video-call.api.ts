import { api } from './api';

// ===== Response types — khớp 1:1 với BE DTO (video-call-response.dto.ts) =====

/** Một bên của cuộc gọi */
export interface VideoCallPartyDto {
  accountId: string;
  fullName: string;
}

/** Trạng thái cuộc gọi: đổ chuông → đang nói → kết thúc */
export type VideoCallStatus = 'RINGING' | 'ACTIVE' | 'ENDED';

/** Lý do kết thúc cuộc gọi */
export type VideoCallEndReason =
  | 'COMPLETED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'MISSED'
  | 'DROPPED'
  | 'TIMEOUT';

/** Vai trò trong cuộc gọi */
export type VideoCallRole = 'CALLER' | 'CALLEE';

/** Thông tin một cuộc gọi (GET, POST trả về) */
export interface VideoCallResponseDto {
  id: string;
  orderId: string;
  status: VideoCallStatus;
  endReason: VideoCallEndReason | null;
  myRole: VideoCallRole;
  endedBy: VideoCallRole | null;
  caller: VideoCallPartyDto;
  callee: VideoCallPartyDto;
  createdAt: string;
  /** Mốc hết giờ đổ chuông (ISO) — FE đếm ngược theo mốc này */
  ringExpiresAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  /** Giây đã nói (chỉ khi đã nghe và đã kết thúc, còn lại null) */
  durationSeconds: number | null;
}

/** GET /video-calls/active — cuộc gọi đang diễn ra của đơn */
export interface ActiveVideoCallResponseDto {
  call: VideoCallResponseDto | null;
}

/** Thông tin để FE kết nối GetStream */
export interface VideoCallStreamCredentialsDto {
  apiKey: string;
  callType: string;
  callId: string;
  token: string;
  userId: string;
}

/** POST /video-calls, POST /video-calls/:id/join — cuộc gọi + thông tin vào GetStream */
export interface VideoCallSessionResponseDto {
  call: VideoCallResponseDto;
  stream: VideoCallStreamCredentialsDto;
  deviceSessionId: string;
}

// ===== Socket event payloads — khớp BE gateway (video-calls.gateway.ts §5.3) =====

export interface VideoCallRingingPayload {
  callId: string;
  orderId: string;
  caller: { accountId: string; fullName: string };
  ringExpiresAt: string;
}

export interface VideoCallAcceptedPayload {
  callId: string;
  deviceSessionId: string;
}

export interface VideoCallMovedPayload {
  callId: string;
  deviceSessionId: string;
}

export interface VideoCallEndedPayload {
  callId: string;
  endReason: VideoCallEndReason;
  endedAt: string;
}

/**
 * Tên window event để useIncomingCall (giữ socket global) chuyển tiếp sự kiện socket
 * cho phòng gọi đang mở — tránh mở thêm một kết nối socket thứ hai.
 * detail: payload tương ứng của socket event.
 */
export const VIDEO_CALL_MOVED_EVENT = 'lancare:video_call.moved';
export const VIDEO_CALL_ENDED_EVENT = 'lancare:video_call.ended';

// ===== Video Call API functions =====

export const videoCallApi = {
  /**
   * Gọi video bên còn lại của đơn (bắt đầu đổ chuông).
   * POST /api/v1/video-calls  body: { orderId }
   * Trả về: cuộc gọi + thông tin GetStream (apiKey, callType, callId, token, userId).
   */
  createCall: async (orderId: string): Promise<VideoCallSessionResponseDto> => {
    const res = await api.post<VideoCallSessionResponseDto>(
      '/api/v1/video-calls',
      { orderId },
    );
    return res.data;
  },

  /**
   * Cuộc gọi đang diễn ra của đơn (mở lại app, lỡ sự kiện socket) — null nếu không có.
   * GET /api/v1/video-calls/active?orderId=...
   */
  getActive: async (orderId: string): Promise<ActiveVideoCallResponseDto> => {
    const res = await api.get<ActiveVideoCallResponseDto>(
      '/api/v1/video-calls/active',
      { params: { orderId } },
    );
    return res.data;
  },

  /**
   * Lịch sử cuộc gọi của đơn (mới nhất trước, tối đa 50).
   * GET /api/v1/video-calls?orderId=...
   */
  listHistory: async (orderId: string): Promise<VideoCallResponseDto[]> => {
    const res = await api.get<VideoCallResponseDto[]>(
      '/api/v1/video-calls',
      { params: { orderId } },
    );
    return res.data;
  },

  /**
   * Nghe cuộc gọi (đang đổ chuông) / vào lại, chuyển máy (đang nói).
   * POST /api/v1/video-calls/:id/join
   * Trả về: cuộc gọi + thông tin GetStream.
   */
  joinCall: async (callId: string): Promise<VideoCallSessionResponseDto> => {
    const res = await api.post<VideoCallSessionResponseDto>(
      `/api/v1/video-calls/${callId}/join`,
    );
    return res.data;
  },

  /**
   * Người nhận từ chối cuộc gọi đang đổ chuông.
   * POST /api/v1/video-calls/:id/decline
   */
  declineCall: async (callId: string): Promise<VideoCallResponseDto> => {
    const res = await api.post<VideoCallResponseDto>(
      `/api/v1/video-calls/${callId}/decline`,
    );
    return res.data;
  },

  /**
   * Hủy (đang đổ chuông) / cúp (đang nói); đã kết thúc thì trả nguyên trạng.
   * POST /api/v1/video-calls/:id/end
   */
  endCall: async (callId: string): Promise<VideoCallResponseDto> => {
    const res = await api.post<VideoCallResponseDto>(
      `/api/v1/video-calls/${callId}/end`,
    );
    return res.data;
  },
};
