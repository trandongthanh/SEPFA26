'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  StreamVideo,
  StreamCall,
  StreamTheme,
  useCallStateHooks,
} from '@stream-io/video-react-sdk';
import '@stream-io/video-react-sdk/dist/css/styles.css';

import { useVideoCall } from './useVideoCall';
import ParticipantGrid from './ParticipantGrid';
import CallControls from './CallControls';
import { videoCallApi, type CallInfoResponse } from '@/lib/video-call.api';
import { useAuthStore } from '@/lib/auth.store';

interface VideoCallRoomProps {
  callType: string;
  callId: string;
}

/**
 * Component phòng video call chính — full-screen, dark theme.
 *
 * Flow & Tối ưu:
 * 1. Timer chuẩn Google Meet: chỉ bắt đầu đếm khi CẢ 2 NGƯỜI CÙNG Ở TRONG PHÒNG
 *    -> Không bị nhảy lên 400+ phút do phòng cũ từ trước
 *    -> 2 bên cùng đếm từ 00:00 đồng bộ từng giây
 * 2. Tự động kết thúc khi bên kia tắt (call.ended)
 * 3. Không gọi /join gây 403 đỏ lòm console
 */
export default function VideoCallRoom({ callType, callId }: VideoCallRoomProps) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [callInfo, setCallInfo] = useState<CallInfoResponse | null>(null);
  const [callInfoLoading, setCallInfoLoading] = useState(true);

  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);

  const onCallEnded = useCallback(() => {
    // Xóa session timer khi cuộc gọi kết thúc
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(`lancare_call_started_${callId}`);
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      routerRef.current.back();
    } else {
      routerRef.current.push('/');
    }
  }, [callId]);

  const {
    client,
    call,
    isJoining,
    isJoined,
    error,
    userInfo,
    joinCall,
    leaveCall,
  } = useVideoCall({ callType, callId, onCallEnded });

  // Load call info từ BE
  useEffect(() => {
    if (!isAuthenticated) {
      setCallInfoLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const info = await videoCallApi.getCallInfo(callId);
        if (!cancelled) setCallInfo(info);
      } catch (err) {
        console.error('[VideoCallRoom] Failed to load call info:', err);
      } finally {
        if (!cancelled) setCallInfoLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [callId, isAuthenticated]);

  // Auto-join khi mount
  useEffect(() => {
    if (isAuthenticated) {
      joinCall();
    }
  }, [joinCall, isAuthenticated]);

  const handleLeave = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(`lancare_call_started_${callId}`);
    }
    await leaveCall();
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  };

  // ===== Not authenticated =====
  if (!isAuthenticated) {
    return (
      <div className="h-screen w-screen bg-[#0f0e1a] flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-20 h-20 rounded-full bg-[#6027D2]/20 flex items-center justify-center mx-auto mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <h2 className="text-white text-lg font-semibold mb-2">Yêu cầu đăng nhập</h2>
          <p className="text-white/50 text-sm mb-6">
            Bạn cần đăng nhập tài khoản LanCare Hub để tham gia vào cuộc gọi này.
          </p>
          <button
            onClick={() => {
              const redirectPath = typeof window !== 'undefined' ? window.location.pathname : `/calls/${callType}/${callId}`;
              router.push(`/auth/login?redirect=${encodeURIComponent(redirectPath)}`);
            }}
            className="px-6 py-2.5 rounded-full bg-gradient-to-r from-[#6027D2] to-[#8B5CF6] hover:opacity-90 text-white text-sm font-medium transition-all shadow-lg shadow-[#6027D2]/30 cursor-pointer"
          >
            Đăng nhập để tham gia
          </button>
        </div>
      </div>
    );
  }

  // ===== Loading state =====
  if (isJoining || callInfoLoading) {
    return (
      <div className="h-screen w-screen bg-[#0f0e1a] flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-[#6027D2]/20" />
            <div className="absolute inset-0 rounded-full border-4 border-t-[#6027D2] animate-spin" />
            <div className="absolute inset-3 rounded-full bg-gradient-to-br from-[#6027D2] to-[#8B5CF6] flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
          </div>
          <h2 className="text-white text-lg font-semibold mb-2">Đang kết nối cuộc gọi...</h2>
          <p className="text-white/50 text-sm">
            {callInfo?.providerName
              ? `Phòng của ${callInfo.providerName}`
              : 'Vui lòng đợi trong giây lát'}
          </p>
        </div>
      </div>
    );
  }

  // ===== Error state =====
  if (error) {
    return (
      <div className="h-screen w-screen bg-[#0f0e1a] flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h2 className="text-white text-lg font-semibold mb-2">Không thể tham gia cuộc gọi</h2>
          <p className="text-white/50 text-sm mb-6">{error}</p>
          <button
            onClick={() => router.back()}
            className="px-6 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
          >
            Quay lại
          </button>
        </div>
      </div>
    );
  }

  // ===== Call not ready =====
  if (!client || !call) {
    return (
      <div className="h-screen w-screen bg-[#0f0e1a] flex items-center justify-center">
        <p className="text-white/50 text-sm">Đang khởi tạo...</p>
      </div>
    );
  }

  // ===== Main call UI =====
  return (
    <StreamVideo client={client}>
      <StreamCall call={call}>
        <StreamTheme className="h-screen w-screen flex flex-col bg-[#0f0e1a] overflow-hidden">
          {/* Header với đồng hồ đồng bộ chuẩn Google Meet */}
          <CallTopBar callInfo={callInfo} callId={callId} />

          {/* Participant grid */}
          <ParticipantGrid />

          {/* Bottom controls */}
          <CallControls onLeave={handleLeave} />
        </StreamTheme>
      </StreamCall>
    </StreamVideo>
  );
}

// ===== Call Header Component =====

function CallTopBar({
  callInfo,
  callId,
}: {
  callInfo: CallInfoResponse | null;
  callId: string;
}) {
  const { useParticipants } = useCallStateHooks();
  const participants = useParticipants();

  const [copied, setCopied] = useState(false);
  const [duration, setDuration] = useState(0);

  // Đếm số người thực sự trong phòng (lọc theo userId)
  const uniqueCount = useMemo(() => {
    const ids = new Set(participants.map((p) => p.userId));
    return ids.size;
  }, [participants]);

  const hasTwoOrMore = uniqueCount >= 2;

  // Timer đồng bộ chuẩn Google Meet:
  // - Khi < 2 người: chưa đếm cuộc gọi, hiển thị "Chờ đối phương"
  // - Khi >= 2 người: cuộc gọi thực sự bắt đầu, cả 2 bên cùng đếm từ 00:00!
  useEffect(() => {
    if (!hasTwoOrMore) return;

    const storageKey = `lancare_call_started_${callId}`;
    let startTime = Number(sessionStorage.getItem(storageKey));
    if (!startTime || isNaN(startTime)) {
      startTime = Date.now();
      sessionStorage.setItem(storageKey, String(startTime));
    }

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setDuration(elapsed > 0 ? elapsed : 0);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [hasTwoOrMore, callId]);

  const formattedDuration = useMemo(() => {
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, [duration]);

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-[#0f0e1a]/80 backdrop-blur-xl border-b border-white/5">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6027D2] to-[#8B5CF6] flex items-center justify-center shadow-md shadow-[#6027D2]/25">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </div>
        <div>
          <h1 className="text-white text-sm font-semibold leading-tight">
            {callInfo?.providerName
              ? `Cuộc gọi với ${callInfo.providerName}`
              : 'Cuộc gọi Video'}
          </h1>
          {callInfo?.orderId && (
            <p className="text-white/40 text-xs">
              Đơn hàng #{callInfo.orderId.slice(0, 8)}...
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Sao chép link mời */}
        <button
          onClick={handleCopyLink}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 active:bg-white/20 text-white text-xs font-medium transition-all border border-white/10 cursor-pointer shadow-sm"
          title="Sao chép liên kết phòng gọi để mời khách hàng tham gia"
        >
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="text-green-400 font-semibold">Đã chép link!</span>
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Sao chép link gọi</span>
            </>
          )}
        </button>

        {/* Trạng thái cuộc gọi & Thời lượng */}
        {hasTwoOrMore ? (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-white/5 border border-white/5">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-white/70 text-xs font-mono tabular-nums">
              {formattedDuration}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="text-amber-300 text-xs font-medium">
              Đang chờ kết nối...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
