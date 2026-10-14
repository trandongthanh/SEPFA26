'use client';

import React, { useState, useCallback } from 'react';
import {
  useCallStateHooks,
  OwnCapability,
} from '@stream-io/video-react-sdk';

interface CallControlsProps {
  onLeave: () => void;
}

/**
 * Control bar phía dưới màn hình call.
 * Các nút: Toggle Mic, Toggle Camera, Screen Share, End Call.
 * Style tối giản, premium, hiện đại.
 */
export default function CallControls({ onLeave }: CallControlsProps) {
  const { useMicrophoneState, useCameraState, useScreenShareState, useCallSettings } =
    useCallStateHooks();

  const { microphone, isMute: isMicMuted } = useMicrophoneState();
  const { camera, isMute: isCamOff } = useCameraState();
  const { screenShare, isMute: isScreenShareOff } = useScreenShareState();

  const [isLeavingAnimation, setIsLeavingAnimation] = useState(false);

  const toggleMic = useCallback(async () => {
    try {
      await microphone.toggle();
    } catch (err) {
      console.error('Toggle mic failed:', err);
    }
  }, [microphone]);

  const toggleCamera = useCallback(async () => {
    try {
      await camera.toggle();
    } catch (err) {
      console.error('Toggle camera failed:', err);
    }
  }, [camera]);

  const toggleScreenShare = useCallback(async () => {
    try {
      await screenShare.toggle();
    } catch (err) {
      console.error('Toggle screen share failed:', err);
    }
  }, [screenShare]);

  const handleLeave = useCallback(() => {
    setIsLeavingAnimation(true);
    setTimeout(() => onLeave(), 300);
  }, [onLeave]);

  return (
    <div className="shrink-0 bg-[#0f0e1a]/90 backdrop-blur-xl border-t border-white/5">
      <div className="flex items-center justify-center gap-3 px-6 py-4">
        {/* Mic toggle */}
        <ControlButton
          active={!isMicMuted}
          icon={isMicMuted ? <MicOffIcon /> : <MicOnIcon />}
          label={isMicMuted ? 'Bật mic' : 'Tắt mic'}
          onClick={toggleMic}
          activeColor="bg-white/10"
          inactiveColor="bg-red-500/80"
        />

        {/* Camera toggle */}
        <ControlButton
          active={!isCamOff}
          icon={isCamOff ? <CamOffIcon /> : <CamOnIcon />}
          label={isCamOff ? 'Bật camera' : 'Tắt camera'}
          onClick={toggleCamera}
          activeColor="bg-white/10"
          inactiveColor="bg-red-500/80"
        />

        {/* Screen share */}
        <ControlButton
          active={!isScreenShareOff}
          icon={<ScreenShareIcon />}
          label={isScreenShareOff ? 'Chia sẻ màn hình' : 'Dừng chia sẻ'}
          onClick={toggleScreenShare}
          activeColor="bg-[#6027D2]"
          inactiveColor="bg-white/10"
        />

        {/* Divider */}
        <div className="w-px h-8 bg-white/10 mx-1" />

        {/* Leave button */}
        <button
          onClick={handleLeave}
          className={`group flex items-center gap-2 h-12 px-6 rounded-full
            bg-red-500 hover:bg-red-600 active:scale-95
            transition-all duration-200 shadow-lg shadow-red-500/25
            ${isLeavingAnimation ? 'scale-90 opacity-50' : ''}`}
          title="Rời cuộc gọi"
        >
          <LeaveIcon />
          <span className="text-white font-semibold text-sm">Kết thúc</span>
        </button>
      </div>
    </div>
  );
}

// ===== Control Button =====

function ControlButton({
  active,
  icon,
  label,
  onClick,
  activeColor,
  inactiveColor,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  activeColor: string;
  inactiveColor: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative w-12 h-12 rounded-full flex items-center justify-center
        transition-all duration-200 hover:scale-105 active:scale-95
        ${active ? activeColor + ' hover:bg-white/20 text-white' : inactiveColor + ' hover:bg-red-600 text-white'}`}
      title={label}
    >
      {icon}
      {/* Tooltip */}
      <span className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 rounded-lg
        bg-black/80 text-white text-xs font-medium whitespace-nowrap
        opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {label}
      </span>
    </button>
  );
}

// ===== Icons =====

function MicOnIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.12 1.49-.34 2.18" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function CamOnIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function CamOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56" />
    </svg>
  );
}

function ScreenShareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function LeaveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
