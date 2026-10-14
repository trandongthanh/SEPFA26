import { api } from './api';

// ===== Response types khớp với BE DTO =====

export interface TokenResponse {
  token: string;
}

export interface CreateCallPayload {
  orderId: string;
  type?: 'default' | 'livestream' | 'audio_room';
  providerId?: string;
}

export interface CreateCallResponse {
  callId: string;
  joinUrl: string;
  createdBy: string;
  callType: string;
}

export interface CallMember {
  userId: string;
  role?: string;
}

export interface CallInfoResponse {
  callId: string;
  createdBy: string;
  providerId: string | null;
  providerName: string | null;
  orderId: string | null;
  members: CallMember[];
}

export interface JoinCallResponse {
  callId: string;
  token: string;
  userId: string;
  userName: string;
}

export interface CurrentOrderCallResponse {
  call: {
    callId: string;
    callType: string;
    status: string;
  } | null;
  canCreate: boolean;
}

// ===== Video Call API functions =====

export const videoCallApi = {
  /** Lấy GetStream user token cho account hiện tại */
  getToken: async (): Promise<TokenResponse> => {
    const res = await api.post<TokenResponse>('/api/v1/video-calls/token');
    return res.data;
  },

  /** Tạo phòng call mới (chỉ Provider) */
  createCall: async (payload: CreateCallPayload): Promise<CreateCallResponse> => {
    const res = await api.post<CreateCallResponse>('/api/v1/video-calls', payload);
    return res.data;
  },

  /** Kiểm tra order có đang mở phòng call không */
  getCurrentOrderCall: async (orderId: string): Promise<CurrentOrderCallResponse> => {
    const res = await api.get<CurrentOrderCallResponse>(
      `/api/v1/video-calls/orders/${orderId}/current`
    );
    return res.data;
  },

  /** Lấy thông tin call (members, provider name...) */
  getCallInfo: async (callId: string): Promise<CallInfoResponse> => {
    const res = await api.get<CallInfoResponse>(`/api/v1/video-calls/${callId}`);
    return res.data;
  },

  /** Join vào call — trả về token + userId + userName */
  joinCall: async (callId: string): Promise<JoinCallResponse> => {
    const res = await api.post<JoinCallResponse>(`/api/v1/video-calls/${callId}/join`);
    return res.data;
  },

  /** Rời call */
  leaveCall: async (callId: string): Promise<{ status: string }> => {
    const res = await api.post<{ status: string }>(`/api/v1/video-calls/${callId}/leave`);
    return res.data;
  },
};
