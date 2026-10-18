'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { StreamVideoClient, Call } from '@stream-io/video-react-sdk';
import { videoCallApi, type VideoCallSessionResponseDto } from '@/lib/video-call.api';

interface UseVideoCallOptions {
  /** Session đã có sẵn (người nhận bấm nghe từ IncomingCallModal, hoặc người gọi vừa tạo) */
  session: VideoCallSessionResponseDto | null;
  /** Callback khi cuộc gọi kết thúc (đối phương cúp / bị hệ thống đóng) */
  onCallEnded?: () => void;
}

interface UseVideoCallReturn {
  client: StreamVideoClient | null;
  call: Call | null;
  isJoining: boolean;
  isJoined: boolean;
  error: string | null;
  /** Kết nối vào phòng gọi GetStream bằng stream credentials từ BE */
  joinCall: () => Promise<void>;
  /** Cúp máy — báo BE kết thúc cuộc gọi */
  leaveCall: () => Promise<void>;
  /**
   * Chỉ rời phòng GetStream, KHÔNG báo BE end (cuộc gọi đã kết thúc / chuyển thiết bị).
   * Trả về false nếu đã rời trước đó (vd: chính mình vừa bấm Kết thúc).
   */
  disconnect: () => Promise<boolean>;
}

/**
 * Custom hook quản lý lifecycle video call.
 *
 * Luồng mới (khớp bản chốt BE §5.1):
 * 1. Không gọi /token riêng — BE trả stream credentials kèm theo khi create hoặc join.
 * 2. Dùng apiKey, callType, callId, token, userId từ session.stream để kết nối GetStream.
 * 3. Kết thúc cuộc gọi qua POST /video-calls/:id/end (không phải /leave).
 */
export function useVideoCall({
  session,
  onCallEnded,
}: UseVideoCallOptions): UseVideoCallReturn {
  const [client, setClient] = useState<StreamVideoClient | null>(null);
  const [call, setCall] = useState<Call | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<StreamVideoClient | null>(null);
  const callRef = useRef<Call | null>(null);
  const hasLeftRef = useRef(false);
  const onCallEndedRef = useRef(onCallEnded);

  useEffect(() => {
    onCallEndedRef.current = onCallEnded;
  }, [onCallEnded]);

  const joinCall = useCallback(async () => {
    if (!session) {
      setError('Không có thông tin phiên cuộc gọi.');
      return;
    }

    const { stream } = session;
    if (!stream.apiKey || !stream.callId || !stream.token || !stream.userId) {
      setError('Thông tin kết nối GetStream không đầy đủ.');
      return;
    }

    setIsJoining(true);
    setError(null);
    hasLeftRef.current = false;

    try {
      // 1) Khởi tạo client bằng thông tin BE cung cấp (apiKey + token + userId)
      const streamClient = StreamVideoClient.getOrCreateInstance({
        apiKey: stream.apiKey,
        user: { id: stream.userId },
        token: stream.token,
      });
      clientRef.current = streamClient;
      setClient(streamClient);

      // 2) Tạo Call instance với callType và callId từ BE
      const streamCall = streamClient.call(stream.callType, stream.callId);
      callRef.current = streamCall;
      setCall(streamCall);

      // 3) Lắng nghe sự kiện call.ended từ GetStream (bên kia cúp hoặc hệ thống đóng)
      const handleCallEnded = () => {
        if (!hasLeftRef.current) {
          console.log('[useVideoCall] call.ended — cuộc gọi đã kết thúc');
          onCallEndedRef.current?.();
        }
      };
      streamCall.on('call.ended', handleCallEnded);

      // 4) Tham gia phòng — create: false vì BE đã tạo cuộc gọi trên GetStream
      await streamCall.join({ create: false });
      setIsJoined(true);
    } catch (err: any) {
      console.error('[useVideoCall] Tham gia cuộc gọi thất bại:', err);
      setError(
        err?.response?.data?.message || err?.message || 'Không thể tham gia cuộc gọi.',
      );

      if (callRef.current) {
        try {
          await callRef.current.leave();
        } catch {
          /* ignore */
        }
        callRef.current = null;
        setCall(null);
      }
    } finally {
      setIsJoining(false);
    }
  }, [session]);

  /** Rời phòng GetStream + disconnect client (dùng chung cho leaveCall và disconnect) */
  const teardown = useCallback(async () => {
    if (callRef.current) {
      try {
        await callRef.current.leave();
      } catch {
        /* ignore */
      }
      callRef.current = null;
      setCall(null);
    }

    if (clientRef.current) {
      try {
        await clientRef.current.disconnectUser();
      } catch {
        /* ignore */
      }
      clientRef.current = null;
      setClient(null);
    }

    setIsJoined(false);
  }, []);

  const leaveCall = useCallback(async () => {
    if (hasLeftRef.current) return;
    hasLeftRef.current = true;

    // Báo BE kết thúc cuộc gọi: POST /video-calls/:id/end
    if (session?.call.id) {
      videoCallApi.endCall(session.call.id).catch(() => {
        /* ignore — fire-and-forget */
      });
    }

    await teardown();
  }, [session?.call.id, teardown]);

  const disconnect = useCallback(async () => {
    if (hasLeftRef.current) return false;
    hasLeftRef.current = true;
    await teardown();
    return true;
  }, [teardown]);

  // Cleanup khi unmount
  useEffect(() => {
    return () => {
      if (!hasLeftRef.current) {
        const currentCall = callRef.current;
        const currentClient = clientRef.current;

        // Báo BE kết thúc (fire-and-forget)
        if (session?.call.id) {
          videoCallApi.endCall(session.call.id).catch(() => {});
        }

        if (currentCall) currentCall.leave().catch(() => {});
        if (currentClient) {
          try {
            currentClient.disconnectUser();
          } catch {
            /* ignore */
          }
        }
      }
    };
  }, [session?.call.id]);

  return { client, call, isJoining, isJoined, error, joinCall, leaveCall, disconnect };
}
