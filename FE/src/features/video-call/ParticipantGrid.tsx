'use client';

import React, { useMemo } from 'react';
import {
  useCallStateHooks,
  ParticipantView,
  StreamVideoParticipant,
  hasScreenShare,
  hasVideo,
  hasAudio,
} from '@stream-io/video-react-sdk';

/**
 * Grid layout thông minh cho participants — kiểu Google Meet.
 *
 * Layout rules:
 * - 1 người: full screen + banner "chờ người khác"
 * - 2 người: luôn 2 ô cạnh nhau (kiểu Google Meet)
 * - 3-4 người: 2x2 grid
 * - 5+ người: 3 cột grid
 * - Khi có screen share: spotlight + sidebar
 *
 * Fixes:
 * - ParticipantViewUI={EmptyUI}: tắt hoàn toàn UI mặc định của Stream SDK để KHÔNG bị đè 2 lần tên
 * - hasVideo / hasAudio từ SDK phản ánh chính xác trạng thái
 * - Dedup participants theo userId (tránh duplicate tile)
 * - Tile luôn nằm gọn trong khung (grid h-full, không dùng aspect-video full width):
 *   Stream SDK theo dõi tile bằng IntersectionObserver (ngưỡng 35%). Nếu tile bị tràn/cắt
 *   bởi overflow-hidden → SDK đánh dấu INVISIBLE → ẩn video + ngừng subscribe video đối phương
 *   → nhìn như cả hai bên "tự tắt cam".
 */
const EmptyUI = () => null;

export default function ParticipantGrid() {
  const { useParticipants, useLocalParticipant } = useCallStateHooks();
  const allParticipants = useParticipants();
  const localParticipant = useLocalParticipant();

  // Lọc bỏ session trùng lặp của chính local user
  const uniqueParticipants = useMemo(() => {
    const seenUsers = new Set<string>();
    const result: StreamVideoParticipant[] = [];

    // Ưu tiên local participant trước
    if (localParticipant) {
      result.push(localParticipant);
      seenUsers.add(localParticipant.userId);
    }

    for (const p of allParticipants) {
      if (p.isLocalParticipant) continue;
      if (localParticipant && p.userId === localParticipant.userId) continue;
      if (!seenUsers.has(p.userId)) {
        seenUsers.add(p.userId);
        result.push(p);
      }
    }

    return result.length > 0 ? result : allParticipants;
  }, [allParticipants, localParticipant]);

  // Phát hiện screen share
  const screenShareParticipant = useMemo(
    () => uniqueParticipants.find((p) => hasScreenShare(p)),
    [uniqueParticipants],
  );

  if (uniqueParticipants.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/60">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <p className="text-sm font-medium">Đang chờ người khác tham gia...</p>
        </div>
      </div>
    );
  }

  // Layout khi có screen share
  if (screenShareParticipant) {
    const otherParticipants = uniqueParticipants.filter((p) => p !== screenShareParticipant);
    return (
      <div className="flex-1 flex gap-3 p-3 overflow-hidden">
        {/* Spotlight */}
        <div className="flex-1 rounded-2xl overflow-hidden bg-[#1a1a2e] relative">
          <ParticipantView
            participant={screenShareParticipant}
            trackType="screenShareTrack"
            className="h-full w-full"
            ParticipantViewUI={EmptyUI}
          />
          <ParticipantLabel participant={screenShareParticipant} isScreenShare />
        </div>

        {/* Sidebar */}
        {otherParticipants.length > 0 && (
          <div className="w-56 flex flex-col gap-2 overflow-y-auto">
            {uniqueParticipants.map((p) => (
              <div
                key={p.sessionId}
                className="aspect-video rounded-xl overflow-hidden bg-[#1a1a2e] relative shrink-0"
              >
                <ParticipantView
                  participant={p}
                  className="h-full w-full"
                  ParticipantViewUI={EmptyUI}
                />
                <ParticipantLabel participant={p} compact />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Tính grid layout
  const count = uniqueParticipants.length;
  const isSingle = count === 1;
  const isTwo = count === 2;

  // Grid có số hàng cố định để tile chia đều chiều cao, không bao giờ tràn khỏi khung
  const gridClass = isSingle
    ? 'grid-cols-1 grid-rows-1'
    : isTwo
    ? 'grid-cols-2 grid-rows-1'
    : count <= 4
    ? 'grid-cols-2 grid-rows-2'
    : 'grid-cols-3 auto-rows-fr';

  return (
    <div className="flex-1 min-h-0 p-3 overflow-hidden relative">
      {/* Banner khi chỉ có 1 mình trong phòng */}
      {isSingle && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white/80 text-xs flex items-center gap-2 shadow-lg">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>Đang đợi người khác... Bạn có thể sao chép link mời ở góc trên.</span>
        </div>
      )}

      <div className={`grid w-full h-full gap-3 ${gridClass}`}>
        {uniqueParticipants.map((participant) => (
          <div
            key={participant.sessionId}
            className={`w-full h-full min-h-0 min-w-0 rounded-2xl overflow-hidden bg-[#1a1a2e] relative group transition-all flex items-center justify-center shadow-xl
              ${
                participant.isSpeaking
                  ? 'ring-2 ring-green-400 shadow-[0_0_20px_rgba(74,222,128,0.25)]'
                  : participant.isLocalParticipant
                  ? 'ring-1 ring-[#6027D2]/50'
                  : 'border border-white/10'
              }`}
          >
            {/* Tắt built-in UI của ParticipantView bằng ParticipantViewUI={EmptyUI} */}
            <ParticipantView
              participant={participant}
              className="h-full w-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover"
              ParticipantViewUI={EmptyUI}
              VideoPlaceholder={NoVideoFallback}
            />
            {/* Duy nhất custom label của chúng ta hiển thị */}
            <ParticipantLabel
              participant={participant}
              isLocal={participant.isLocalParticipant}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== Sub-components =====

function ParticipantLabel({
  participant,
  isLocal = false,
  isScreenShare = false,
  compact = false,
}: {
  participant: StreamVideoParticipant;
  isLocal?: boolean;
  isScreenShare?: boolean;
  compact?: boolean;
}) {
  const micMuted = !hasAudio(participant);

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 z-10
        bg-gradient-to-t from-black/85 via-black/40 to-transparent
        flex items-center justify-between pointer-events-none
        ${compact ? 'p-1.5' : 'p-3'}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Speaking indicator */}
        {participant.isSpeaking ? (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/20 border border-green-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-300 text-[10px] font-semibold">Nói</span>
          </div>
        ) : (
          <div className="text-white/60">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
          </div>
        )}

        <span className={`text-white font-medium truncate ${compact ? 'text-xs' : 'text-sm'}`}>
          {participant.name || participant.userId}
        </span>

        {isLocal && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#6027D2] text-white shadow-sm">
            Bạn
          </span>
        )}

        {isScreenShare && (
          <span className="shrink-0 text-white/70 text-xs">
            — Chia sẻ màn hình
          </span>
        )}
      </div>

      {/* Mic muted indicator */}
      {micMuted && (
        <div className="w-6 h-6 rounded-full bg-red-500/90 flex items-center justify-center shrink-0 shadow-sm" title="Mic đang tắt">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.12 1.49-.34 2.18" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
        </div>
      )}
    </div>
  );
}

/**
 * Component ổn định (không khai báo inline) để SDK không remount placeholder mỗi lần render.
 * Nhận `style` (position: absolute) từ SDK để phủ lên video thay vì đẩy layout.
 * Chỉ ghi "Camera tắt" khi đối phương thật sự không publish video — còn lại là đang tải.
 */
const NoVideoFallback = React.forwardRef<
  HTMLDivElement,
  { participant: StreamVideoParticipant; style?: React.CSSProperties }
>(function NoVideoFallback({ participant, style }, ref) {
  const initials = getInitials(participant.name || participant.userId || '?');
  const isCamOff = !hasVideo(participant);

  return (
    <div
      ref={ref}
      style={style}
      className="inset-0 h-full w-full flex items-center justify-center bg-gradient-to-br from-[#1E1B2E] to-[#2d2654]"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#6027D2] to-[#8B5CF6] flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-[#6027D2]/30">
          {initials}
        </div>
        <span className="text-white/70 text-sm font-medium">
          {participant.name || participant.userId}
        </span>
        {isCamOff ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 border border-white/10">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56" />
            </svg>
            <span className="text-white/50 text-[10px]">Camera tắt</span>
          </div>
        ) : (
          <span className="text-white/40 text-[10px]">Đang tải video...</span>
        )}
      </div>
    </div>
  );
});

// ===== Helpers =====

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
