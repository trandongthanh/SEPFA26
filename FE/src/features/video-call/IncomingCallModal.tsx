'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { PhoneOutlined, VideoCameraOutlined, CloseOutlined } from '@ant-design/icons';

export interface IncomingCallEvent {
  eventType: string;
  callId: string;
  callType: string;
  orderId: string;
  createdBy?: string;
}

interface IncomingCallModalProps {
  call: IncomingCallEvent | null;
  onClose: () => void;
}

export default function IncomingCallModal({ call, onClose }: IncomingCallModalProps) {
  const router = useRouter();

  if (!call) return null;

  const handleAccept = () => {
    onClose();
    router.push(`/calls/${call.callType || 'default'}/${call.callId}`);
  };

  const handleDecline = () => {
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-[#13111C] border border-white/10 shadow-2xl p-6 text-center text-white">
        {/* Glow ambient background */}
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-48 h-48 bg-[#6027D2]/40 rounded-full blur-3xl pointer-events-none" />

        {/* Pulsing Avatar with rings */}
        <div className="relative w-24 h-24 mx-auto my-4 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-[#6027D2]/30 animate-ping opacity-75" />
          <div className="absolute -inset-2 rounded-full border border-[#8B5CF6]/40 animate-pulse" />
          <div className="relative w-20 h-20 rounded-full bg-gradient-to-tr from-[#6027D2] to-[#8B5CF6] flex items-center justify-center shadow-lg shadow-[#6027D2]/40">
            <VideoCameraOutlined className="text-3xl text-white" />
          </div>
        </div>

        {/* Call Info */}
        <div className="mb-6 space-y-1">
          <p className="text-xs uppercase tracking-wider font-semibold text-[#8B5CF6]">
            Cuộc gọi video đến
          </p>
          <h3 className="text-lg font-bold text-white">
            Nhà vườn LanCare
          </h3>
          <p className="text-xs text-white/60">
            Đơn hàng #{call.orderId ? call.orderId.slice(0, 8).toUpperCase() : '---'}
          </p>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-center gap-4 pt-2">
          {/* Decline */}
          <button
            onClick={handleDecline}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-white/10 hover:bg-red-500/20 text-white hover:text-red-400 border border-white/10 hover:border-red-500/30 font-medium text-sm transition-all"
          >
            <CloseOutlined />
            <span>Từ chối</span>
          </button>

          {/* Accept */}
          <button
            onClick={handleAccept}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-[#6027D2] hover:bg-[#7134E5] text-white font-medium text-sm shadow-lg shadow-[#6027D2]/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <PhoneOutlined className="rotate-[135deg]" />
            <span>Tham gia</span>
          </button>
        </div>
      </div>
    </div>
  );
}
