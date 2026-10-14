'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { StreamVideoClient, Call } from '@stream-io/video-react-sdk';
import { videoCallApi } from '@/lib/video-call.api';
import { useAuthStore } from '@/lib/auth.store';

const STREAM_API_KEY = process.env.NEXT_PUBLIC_STREAM_API_KEY ?? '';

interface UseVideoCallOptions {
  callType: string;
  callId: string;
  /** Callback khi bên kia kết thúc cuộc gọi */
  onCallEnded?: () => void;
}

interface UseVideoCallReturn {
  client: StreamVideoClient | null;
  call: Call | null;
  isJoining: boolean;
  isJoined: boolean;
  error: string | null;
  userInfo: { userId: string; userName: string } | null;
  joinCall: () => Promise<void>;
  leaveCall: () => Promise<void>;
}

/**
 * Custom hook quản lý toàn bộ lifecycle của video call.
 *
 * Tối ưu & Sạch sẽ:
 * 1. Gọi trực tiếp /token (tránh bị 403 đỏ lòm từ /join do Stream update settings ở BE)
 * 2. Dùng StreamVideoClient.getOrCreateInstance để tránh warning "client already exists"
 * 3. Lắng nghe call.on('call.ended') để tự động ngắt kết nối cả 2 bên đồng bộ
 */
export function useVideoCall({
  callType,
  callId,
  onCallEnded,
}: UseVideoCallOptions): UseVideoCallReturn {
  const [client, setClient] = useState<StreamVideoClient | null>(null);
  const [call, setCall] = useState<Call | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<{ userId: string; userName: string } | null>(null);

  const clientRef = useRef<StreamVideoClient | null>(null);
  const callRef = useRef<Call | null>(null);
  const hasLeftRef = useRef(false);
  const onCallEndedRef = useRef(onCallEnded);

  useEffect(() => {
    onCallEndedRef.current = onCallEnded;
  }, [onCallEnded]);

  const joinCall = useCallback(async () => {
    if (!STREAM_API_KEY) {
      setError('Cấu hình Stream API Key chưa được thiết lập.');
      return;
    }
    if (!callId || !callType) {
      setError('Thông tin cuộc gọi không hợp lệ.');
      return;
    }

    setIsJoining(true);
    setError(null);
    hasLeftRef.current = false;

    try {
      // 1) Lấy token từ BE qua endpoint /token — không gọi /join để tránh 403 đỏ console
      const tokenRes = await videoCallApi.getToken();
      const currentUser = useAuthStore.getState().user;
      const userId = currentUser?.id || 'guest_' + Math.random().toString(36).slice(2, 8);
      const userName = currentUser?.fullName || 'Người dùng LanCare';

      setUserInfo({ userId, userName });

      // 2) Khởi tạo client dùng getOrCreateInstance chuẩn SDK (không bị warning trùng client)
      const streamClient = StreamVideoClient.getOrCreateInstance({
        apiKey: STREAM_API_KEY,
        user: { id: userId, name: userName },
        token: tokenRes.token,
      });
      clientRef.current = streamClient;
      setClient(streamClient);

      // 3) Tạo Call instance
      const streamCall = streamClient.call(callType, callId);
      callRef.current = streamCall;
      setCall(streamCall);

      // 4) Lắng nghe sự kiện call.ended từ bên kia
      const handleCallEnded = () => {
        if (!hasLeftRef.current) {
          console.log('[useVideoCall] call.ended nhận được — đối phương đã kết thúc cuộc gọi');
          onCallEndedRef.current?.();
        }
      };
      streamCall.on('call.ended', handleCallEnded);

      // 5) Tham gia phòng (create: true nếu phòng chưa có)
      await streamCall.join({ create: true });
      setIsJoined(true);
    } catch (err: any) {
      console.error('[useVideoCall] Tham gia cuộc gọi thất bại:', err);
      setError(err?.response?.data?.message || err?.message || 'Không thể tham gia cuộc gọi.');

      if (callRef.current) {
        try { await callRef.current.leave(); } catch { /* ignore */ }
        callRef.current = null;
        setCall(null);
      }
    } finally {
      setIsJoining(false);
    }
  }, [callType, callId]);

  const leaveCall = useCallback(async () => {
    if (hasLeftRef.current) return;
    hasLeftRef.current = true;

    // 1) Kết thúc cuộc gọi trên Stream (để gửi signal call.ended cho đối phương)
    if (callRef.current) {
      try {
        await callRef.current.endCall();
      } catch {
        try { await callRef.current.leave(); } catch { /* ignore */ }
      }
      callRef.current = null;
      setCall(null);
    }

    // 2) Báo BE (fire-and-forget)
    try { await videoCallApi.leaveCall(callId); } catch { /* ignore */ }

    // 3) Disconnect client
    if (clientRef.current) {
      try { clientRef.current.disconnectUser(); } catch { /* ignore */ }
      clientRef.current = null;
      setClient(null);
    }

    setIsJoined(false);
    setUserInfo(null);
  }, [callId]);

  useEffect(() => {
    return () => {
      if (!hasLeftRef.current) {
        const currentCall = callRef.current;
        const currentClient = clientRef.current;
        videoCallApi.leaveCall(callId).catch(() => {});
        if (currentCall) currentCall.leave().catch(() => {});
        if (currentClient) { try { currentClient.disconnectUser(); } catch { /* ignore */ } }
      }
    };
  }, [callId]);

  return { client, call, isJoining, isJoined, error, userInfo, joinCall, leaveCall };
}
