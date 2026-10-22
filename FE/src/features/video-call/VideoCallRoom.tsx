'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  StreamVideo,
  StreamCall,
  StreamTheme,
  useCallStateHooks,
  ParticipantsAudio,
} from '@stream-io/video-react-sdk';
import '@stream-io/video-react-sdk/dist/css/styles.css';

import { useVideoCall } from './useVideoCall';
import ParticipantGrid from './ParticipantGrid';
import CallControls from './CallControls';
import {
  videoCallApi,
  VIDEO_CALL_ENDED_EVENT,
  VIDEO_CALL_MOVED_EVENT,
  type VideoCallSessionResponseDto,
  type VideoCallEndedPayload,
  type VideoCallMovedPayload,
} from '@/lib/video-call.api';
import { useAuthStore } from '@/lib/auth.store';

/** Xóa session + mốc giờ bắt đầu của cuộc gọi khỏi sessionStorage */
function clearCallStorage(callId: string) {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(`lancare_call_started_${callId}`);
  sessionStorage.removeItem(`lancare_call_session_${callId}`);
}

/** Đọc session từ mọi nguồn có thể: URL Hash -> URL Query -> sessionStorage */
function resolveInitialSession(callId: string): VideoCallSessionResponseDto | null {
  if (typeof window === 'undefined') return null;

  // 1. Đọc từ URL Hash (#session=...) — hỗ trợ tốt nhất và tức thì cho Mobile WebView
  try {
    if (window.location.hash) {
      const hashStr = window.location.hash.startsWith('#')
        ? window.location.hash.substring(1)
        : window.location.hash;
      const hashParams = new URLSearchParams(hashStr);
      const rawSession = hashParams.get('session');
      if (rawSession) {
        let parsed: any;
        try {
          parsed = JSON.parse(rawSession);
        } catch {
          parsed = JSON.parse(decodeURIComponent(rawSession));
        }
        if (parsed?.stream?.token && parsed?.stream?.apiKey) {
          try {
            sessionStorage.setItem(`lancare_call_session_${callId}`, JSON.stringify(parsed));
          } catch {}
          return parsed;
        }
      }
    }
  } catch (e) {
    console.warn('[VideoCallRoom] Parse session from hash failed:', e);
  }

  // 2. Đọc từ URL Search params (?session=... hoặc ?sessionData=...)
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const rawQuery = searchParams.get('session') || searchParams.get('sessionData');
    if (rawQuery) {
      let parsed: any;
      try {
        parsed = JSON.parse(rawQuery);
      } catch {
        parsed = JSON.parse(decodeURIComponent(rawQuery));
      }
      if (parsed?.stream?.token && parsed?.stream?.apiKey) {
        try {
          sessionStorage.setItem(`lancare_call_session_${callId}`, JSON.stringify(parsed));
        } catch {}
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[VideoCallRoom] Parse session from query failed:', e);
  }

  // 3. Đọc từ sessionStorage đã lưu trước đó (Web flow bình thường)
  try {
    const cached = sessionStorage.getItem(`lancare_call_session_${callId}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed?.stream?.token && parsed?.stream?.apiKey) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[VideoCallRoom] Parse cached session error:', e);
  }

  return null;
}

interface VideoCallRoomProps {
  callType: string;
  callId: string;
}

/**
 * Component phòng video call chính — full-screen, dark theme.
 *
 * Hỗ trợ đa nền tảng (Web desktop/mobile & Mobile App WebView):
 * - Đọc session tức thì từ URL Hash (#session=...) hoặc sessionStorage
 * - Tự động nhận diện Mobile mode (?isMobile=true) để tối ưu layout tràn viền
 * - Đăng ký window.lancareToggleMic / window.lancareToggleCam / window.lancareEndCall
 */
export default function VideoCallRoom({ callType, callId }: VideoCallRoomProps) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const initialSession = useMemo(() => resolveInitialSession(callId), [callId]);
  const [session, setSession] = useState<VideoCallSessionResponseDto | null>(initialSession);
  const [loading, setLoading] = useState<boolean>(!initialSession);
  const [initError, setInitError] = useState<string | null>(null);
  /** Cuộc gọi đã được chuyển sang thiết bị khác của chính mình */
  const [movedAway, setMovedAway] = useState(false);

  // Nhận diện xem có đang chạy trong Mobile WebView hay không
  const isMobile = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const sp = new URLSearchParams(window.location.search);
    return sp.get('isMobile') === 'true' || sp.get('embedded') === 'true' || sp.has('isMobile');
  }, []);

  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const onCallEnded = useCallback(() => {
    // Xóa session timer khi cuộc gọi kết thúc
    clearCallStorage(callId);
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
    joinCall,
    leaveCall,
    disconnect,
  } = useVideoCall({ session, onCallEnded });

  // Expose các action điều khiển cho Mobile WebView (App native bấm nút là Web chạy ngay)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    (window as any).lancareToggleMic = async () => {
      try {
        if (call) {
          await call.microphone.toggle();
        } else {
          const btn = document.querySelector('[data-testid="mute-mic-button"]') as HTMLButtonElement;
          if (btn) btn.click();
        }
      } catch (e: any) {
        console.warn('lancareToggleMic error:', e);
        try {
          (window as any).ReactNativeWebView?.postMessage(
            JSON.stringify({
              type: 'TOGGLE_ERROR',
              device: 'mic',
              name: e?.name,
              message: e?.message || String(e),
            })
          );
        } catch {}
      }
    };

    (window as any).lancareToggleCam = async () => {
      try {
        if (call) {
          await call.camera.toggle();
        } else {
          const btn = document.querySelector('[data-testid="toggle-cam-button"]') as HTMLButtonElement;
          if (btn) btn.click();
        }
      } catch (e: any) {
        console.warn('lancareToggleCam error:', e);
        try {
          (window as any).ReactNativeWebView?.postMessage(
            JSON.stringify({
              type: 'TOGGLE_ERROR',
              device: 'camera',
              name: e?.name,
              message: e?.message || String(e),
            })
          );
        } catch {}
      }
    };

    (window as any).lancareEnableMedia = async () => {
      if (!call) return;
      try {
        await call.camera.enable();
      } catch (e: any) {
        console.warn('lancareEnableMedia camera error:', e);
        try {
          (window as any).ReactNativeWebView?.postMessage(
            JSON.stringify({
              type: 'INIT_MEDIA_ERROR',
              device: 'camera',
              name: e?.name,
              message: e?.message || String(e),
            })
          );
        } catch {}
      }
      try {
        await call.microphone.enable();
      } catch (e: any) {
        console.warn('lancareEnableMedia mic error:', e);
        try {
          (window as any).ReactNativeWebView?.postMessage(
            JSON.stringify({
              type: 'INIT_MEDIA_ERROR',
              device: 'mic',
              name: e?.name,
              message: e?.message || String(e),
            })
          );
        } catch {}
      }
    };

    (window as any).lancareEndCall = async () => {
      try {
        await handleLeave();
      } catch (e) {
        console.warn('lancareEndCall error:', e);
      }
    };
  }, [call]);

  // Khởi tạo session: (1) hash/storage nếu có, (2) window message từ Mobile, (3) token API
  useEffect(() => {
    let cancelled = false;

    // 1. Lắng nghe window message (dành cho Mobile WebView postMessage)
    const handleWindowMessage = (e: any) => {
      try {
        let data = e.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch {}
        }
        if (data?.type === 'LANCARE_CALL_SESSION' && data?.session?.stream?.token) {
          if (!cancelled) {
            setSession((prev) => {
              if (prev?.stream?.token === data.session.stream.token) return prev;
              return data.session;
            });
            setLoading(false);
          }
          try {
            sessionStorage.setItem(`lancare_call_session_${callId}`, JSON.stringify(data.session));
          } catch {}
        }
      } catch {}
    };

    window.addEventListener('message', handleWindowMessage);
    document.addEventListener('message', handleWindowMessage as any);

    // 2. Nếu đã có session rồi (từ URL Hash hoặc sessionStorage)
    if (session) {
      setLoading(false);
      return () => {
        cancelled = true;
        window.removeEventListener('message', handleWindowMessage);
        document.removeEventListener('message', handleWindowMessage as any);
      };
    }

    // 3. Kiểm tra xem có token đính kèm trong query (?token=...) không
    const searchParams = new URLSearchParams(window.location.search);
    const urlToken = searchParams.get('token');
    if (urlToken && !isAuthenticated) {
      useAuthStore.getState().setTokens({ accessToken: urlToken, refreshToken: '' });
    }

    // 4. Đọc lại session một lần nữa
    const foundSession = resolveInitialSession(callId);
    if (foundSession) {
      if (!cancelled) {
        setSession(foundSession);
        setLoading(false);
      }
      return () => {
        cancelled = true;
        window.removeEventListener('message', handleWindowMessage);
        document.removeEventListener('message', handleWindowMessage as any);
      };
    }

    // 5. Nếu là Mobile app nhưng chưa thấy session, đợi một nhịp cho WebView nạp script thay vì văng ra login
    if (isMobile && !isAuthenticated && !urlToken) {
      const timer = setTimeout(() => {
        if (!cancelled && !session) {
          const reCheck = resolveInitialSession(callId);
          if (reCheck) {
            setSession(reCheck);
          }
          setLoading(false);
        }
      }, 1500);

      return () => {
        cancelled = true;
        clearTimeout(timer);
        window.removeEventListener('message', handleWindowMessage);
        document.removeEventListener('message', handleWindowMessage as any);
      };
    }

    // 6. Không có session cache và cũng chưa đăng nhập web → dừng, báo cần đăng nhập
    if (!isAuthenticated && !urlToken) {
      setLoading(false);
      return () => {
        cancelled = true;
        window.removeEventListener('message', handleWindowMessage);
        document.removeEventListener('message', handleWindowMessage as any);
      };
    }

    // 7. Đã có auth (hoặc urlToken) → gọi joinCall API lấy session
    (async () => {
      try {
        const joinSession = await videoCallApi.joinCall(callId);
        if (!cancelled) {
          setSession(joinSession);
        }
      } catch (err: any) {
        console.error('[VideoCallRoom] Init session failed:', err);
        if (!cancelled) {
          const msg =
            err?.response?.data?.message || err?.message || 'Không thể tham gia cuộc gọi.';
          setInitError(Array.isArray(msg) ? msg.join(', ') : msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('message', handleWindowMessage);
      document.removeEventListener('message', handleWindowMessage as any);
    };
  }, [callId, isAuthenticated, isMobile, session]);

  // Khi đã có session → tự động join vào phòng GetStream (chỉ 1 lần, lỗi thì dừng — không retry vô hạn)
  useEffect(() => {
    if (session && !isJoined && !isJoining && !error && !movedAway) {
      joinCall();
    }
  }, [session, isJoined, isJoining, error, movedAway, joinCall]);

  // Sự kiện socket của cuộc gọi hiện tại (được useIncomingCall phát lại qua window event)
  useEffect(() => {
    const currentCallId = session?.call.id;
    if (!currentCallId) return;

    const handleMoved = (e: Event) => {
      const data = (e as CustomEvent<VideoCallMovedPayload>).detail;
      // Thiết bị khác của chính mình vừa vào cuộc gọi → thiết bị này rời phòng (không end cuộc gọi)
      if (data.callId !== currentCallId || data.deviceSessionId === session.deviceSessionId) return;
      clearCallStorage(callId);
      setMovedAway(true);
      disconnect();
    };

    const handleEnded = (e: Event) => {
      const data = (e as CustomEvent<VideoCallEndedPayload>).detail;
      if (data.callId !== currentCallId) return;
      // Đối phương cúp / hết giờ → rời phòng; nếu chính mình vừa bấm Kết thúc thì bỏ qua
      disconnect().then((didLeave) => {
        if (didLeave) onCallEnded();
      });
    };

    window.addEventListener(VIDEO_CALL_MOVED_EVENT, handleMoved);
    window.addEventListener(VIDEO_CALL_ENDED_EVENT, handleEnded);
    return () => {
      window.removeEventListener(VIDEO_CALL_MOVED_EVENT, handleMoved);
      window.removeEventListener(VIDEO_CALL_ENDED_EVENT, handleEnded);
    };
  }, [session, callId, disconnect, onCallEnded]);

  const handleLeave = async () => {
    clearCallStorage(callId);
    await leaveCall();
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  };

  // ===== Loading state (Chỉ hiện khi chưa vào được phòng và đang tải/kết nối) =====
  if (!isJoined && (loading || isJoining)) {
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
            {session?.call.caller.fullName
              ? `Cuộc gọi với ${session.call.myRole === 'CALLER' ? session.call.callee.fullName : session.call.caller.fullName}`
              : 'Vui lòng đợi trong giây lát'}
          </p>
        </div>
      </div>
    );
  }

  // ===== Not authenticated (chỉ hiện khi đã load xong và chắc chắn không có session) =====
  if (!isAuthenticated && !session) {
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
              const redirectPath =
                typeof window !== 'undefined'
                  ? window.location.pathname
                  : `/calls/${callType}/${callId}`;
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

  // ===== Cuộc gọi đã chuyển sang thiết bị khác =====
  if (movedAway) {
    return (
      <div className="h-screen w-screen bg-[#0f0e1a] flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-20 h-20 rounded-full bg-[#6027D2]/20 flex items-center justify-center mx-auto mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <h2 className="text-white text-lg font-semibold mb-2">Cuộc gọi đã chuyển sang thiết bị khác</h2>
          <p className="text-white/50 text-sm mb-6">
            Bạn đã tham gia cuộc gọi này từ một thiết bị hoặc tab khác.
          </p>
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

  // ===== Error state =====
  const displayError = initError || error;
  if (displayError) {
    return (
      <div className="h-screen w-screen bg-[#0f0e1a] flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>
          <h2 className="text-white text-lg font-semibold mb-2">Không thể tham gia cuộc gọi</h2>
          <p className="text-white/50 text-sm mb-6">{displayError}</p>
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
          {/* Tự động phát âm thanh của đối phương trên cả Web và Mobile WebView */}
          <RemoteAudioHelper />

          {/* Header với đồng hồ đồng bộ chuẩn Google Meet (ẩn trên Mobile WebView vì Mobile đã có header native) */}
          {!isMobile && <CallTopBar session={session} callId={callId} />}

          {/* Participant grid */}
          <ParticipantGrid />

          {/* Bottom controls (ẩn trên Mobile WebView vì Mobile đã có thanh control native) */}
          {!isMobile && <CallControls onLeave={handleLeave} />}
        </StreamTheme>
      </StreamCall>
    </StreamVideo>
  );
}

function RemoteAudioHelper() {
  const { useParticipants } = useCallStateHooks();
  const participants = useParticipants();
  const remoteParticipants = useMemo(
    () => participants.filter((p) => !p.isLocalParticipant),
    [participants]
  );
  return <ParticipantsAudio participants={remoteParticipants} />;
}

// ===== Call Header Component =====

function CallTopBar({
  session,
  callId,
}: {
  session: VideoCallSessionResponseDto | null;
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

  // Tên người đối diện
  const otherPartyName = session
    ? session.call.myRole === 'CALLER'
      ? session.call.callee.fullName
      : session.call.caller.fullName
    : null;

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
            {otherPartyName
              ? `Cuộc gọi với ${otherPartyName}`
              : 'Cuộc gọi Video'}
          </h1>
          {session?.call.orderId && (
            <p className="text-white/40 text-xs">
              Đơn hàng #{session.call.orderId.slice(0, 8)}...
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
