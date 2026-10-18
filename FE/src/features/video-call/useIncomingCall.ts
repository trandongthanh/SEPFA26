'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/lib/auth.store';
import {
  VIDEO_CALL_ENDED_EVENT,
  VIDEO_CALL_MOVED_EVENT,
  type VideoCallRingingPayload,
  type VideoCallEndedPayload,
  type VideoCallAcceptedPayload,
  type VideoCallMovedPayload,
} from '@/lib/video-call.api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

/**
 * Hook kết nối WebSocket tới namespace /ws để lắng nghe sự kiện cuộc gọi video (§5.3 bản chốt).
 *
 * Sự kiện:
 * - video_call.ringing  : cuộc gọi đến → hiện popup
 * - video_call.ended    : cuộc gọi kết thúc (hủy/từ chối/hết giờ) → tắt popup
 * - video_call.accepted : ai đó đã nghe máy (trên thiết bị khác) → tắt popup
 * - video_call.moved    : cuộc gọi chuyển sang thiết bị khác → chuyển tiếp cho VideoCallRoom
 * - video_call.ended cũng được chuyển tiếp cho VideoCallRoom qua window event
 */
export function useIncomingCall() {
  const [incomingCall, setIncomingCall] = useState<VideoCallRingingPayload | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const socketRef = useRef<Socket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Play gentle ringing chime using Web Audio API
  const startRingtone = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const playChime = () => {
        if (ctx.state === 'suspended') {
          ctx.resume();
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3); // A5

        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      };

      playChime();
      ringIntervalRef.current = setInterval(playChime, 2000);
    } catch {
      // Audio autoplay policy might prevent sound before user gesture
    }
  }, []);

  const stopRingtone = useCallback(() => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch { /* ignore */ }
      audioContextRef.current = null;
    }
  }, []);

  const dismissCall = useCallback(() => {
    stopRingtone();
    setIncomingCall(null);
  }, [stopRingtone]);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Connect to /ws namespace (khớp BE gateway: namespace '/ws', auth: { token })
    const socket = io(`${API_BASE}/ws`, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 3000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      // Connected successfully — đã vào room account, sẵn sàng nhận sự kiện
    });

    // §5.3 event 1: cuộc gọi đến (đổ chuông)
    socket.on('video_call.ringing', (data: VideoCallRingingPayload) => {
      setIncomingCall(data);
      startRingtone();
    });

    // §5.3 event 4: cuộc gọi kết thúc → tắt popup chuông nếu đang hiện
    socket.on('video_call.ended', (data: VideoCallEndedPayload) => {
      setIncomingCall((prev) => {
        if (prev && prev.callId === data.callId) {
          return null; // Cuộc gọi đang hiện popup bị kết thúc → tắt
        }
        return prev;
      });
      stopRingtone();
      // Báo cho phòng gọi đang mở (nếu có) để rời phòng
      window.dispatchEvent(new CustomEvent(VIDEO_CALL_ENDED_EVENT, { detail: data }));
    });

    // §5.3 event 3: cuộc gọi chuyển sang thiết bị khác → thiết bị cũ rời phòng
    socket.on('video_call.moved', (data: VideoCallMovedPayload) => {
      window.dispatchEvent(new CustomEvent(VIDEO_CALL_MOVED_EVENT, { detail: data }));
    });

    // §5.3 event 2: ai đó đã nghe máy → tắt popup chuông ở các thiết bị khác
    socket.on('video_call.accepted', (_data: VideoCallAcceptedPayload) => {
      setIncomingCall(null);
      stopRingtone();
    });

    socket.on('disconnect', () => {
      // Disconnected
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      stopRingtone();
    };
  }, [isAuthenticated, accessToken, startRingtone, stopRingtone]);

  return {
    incomingCall,
    dismissCall,
  };
}
