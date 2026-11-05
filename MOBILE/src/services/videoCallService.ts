import { apiClient } from '../config/api';

// ===== Response types khớp 1:1 với BE DTO (video-call-response.dto.ts) =====

export type VideoCallStatus = 'RINGING' | 'ACTIVE' | 'ENDED';

export type VideoCallEndReason =
  | 'COMPLETED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'MISSED'
  | 'DROPPED'
  | 'TIMEOUT';

export type VideoCallRole = 'CALLER' | 'CALLEE';

export const CALLABLE_ORDER_STATUSES = [
  'PENDING_PROVIDER',
  'AGREEMENT_PENDING',
  'AWAITING_PAYMENT',
  'PAID',
  'HANDOVER_IN_PROGRESS',
  'HANDOVER_AWAITING_CONFIRM',
  'IN_CARE',
] as const;

export interface VideoCallPartyDto {
  accountId: string;
  fullName: string;
}

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
  ringExpiresAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
}

export interface ActiveVideoCallResponseDto {
  call: VideoCallResponseDto | null;
}

export interface VideoCallStreamCredentialsDto {
  apiKey: string;
  callType: string;
  callId: string;
  token: string;
  userId: string;
}

export interface VideoCallSessionResponseDto {
  call: VideoCallResponseDto;
  stream: VideoCallStreamCredentialsDto;
  deviceSessionId: string;
}

// ===== Payloads cho 4 socket events (bản chốt BE §5.3) =====

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

// ===== Video Call API Service =====

export const videoCallService = {
  /**
   * Gọi video cho bên còn lại của đơn (bắt đầu đổ chuông).
   * POST /video-calls  body: { orderId }
   */
  createCall: async (orderId: string): Promise<VideoCallSessionResponseDto> => {
    const res = await apiClient.post<VideoCallSessionResponseDto>('/video-calls', { orderId });
    return res.data;
  },

  /**
   * Cuộc gọi đang diễn ra của đơn (null nếu không có).
   * GET /video-calls/active?orderId=...
   */
  getActive: async (orderId: string): Promise<ActiveVideoCallResponseDto> => {
    const res = await apiClient.get<ActiveVideoCallResponseDto>('/video-calls/active', {
      params: { orderId },
    });
    return res.data;
  },

  /**
   * Lịch sử các cuộc gọi của đơn (mới nhất trước, tối đa 50).
   * GET /video-calls?orderId=...
   */
  listHistory: async (orderId: string): Promise<VideoCallResponseDto[]> => {
    const res = await apiClient.get<VideoCallResponseDto[]>('/video-calls', {
      params: { orderId },
    });
    return res.data;
  },

  /**
   * Nghe máy / vào lại cuộc gọi (đang đổ chuông hoặc đang nói).
   * POST /video-calls/:id/join
   */
  joinCall: async (callId: string): Promise<VideoCallSessionResponseDto> => {
    const res = await apiClient.post<VideoCallSessionResponseDto>(`/video-calls/${callId}/join`);
    return res.data;
  },

  /**
   * Người nhận từ chối cuộc gọi đang đổ chuông.
   * POST /video-calls/:id/decline
   */
  declineCall: async (callId: string): Promise<VideoCallResponseDto> => {
    const res = await apiClient.post<VideoCallResponseDto>(`/video-calls/${callId}/decline`);
    return res.data;
  },

  /**
   * Người gọi hủy (đang đổ chuông) hoặc cúp máy (đang nói).
   * POST /video-calls/:id/end
   */
  endCall: async (callId: string): Promise<VideoCallResponseDto> => {
    const res = await apiClient.post<VideoCallResponseDto>(`/video-calls/${callId}/end`);
    return res.data;
  },
};
