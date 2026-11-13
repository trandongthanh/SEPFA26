'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';

// Dynamic import — SSR bị disable vì Stream SDK cần browser APIs (WebRTC, MediaDevices)
const VideoCallRoom = dynamic(
  () => import('@/features/video-call/VideoCallRoom'),
  {
    ssr: false,
    loading: () => (
      <div className="h-screen w-screen bg-[#0f0e1a] flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-16 h-16 mx-auto mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-[#6027D2]/20" />
            <div className="absolute inset-0 rounded-full border-4 border-t-[#6027D2] animate-spin" />
          </div>
          <p className="text-white/50 text-sm">Đang tải phòng gọi video...</p>
        </div>
      </div>
    ),
  },
);

interface PageProps {
  params: Promise<{ type: string; id: string }>;
}

/**
 * Route: /calls/[type]/[id]
 * Ví dụ: /calls/default/order_abc123_xyz456
 *
 * URL này khớp với `buildJoinUrl` trong BE service:
 *   `${APP_BASE_URL}/calls/${callType}/${callId}`
 */
export default function VideoCallPage({ params }: PageProps) {
  const { type, id } = use(params);

  if (!type || !id) {
    return (
      <div className="h-screen w-screen bg-[#0f0e1a] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-white text-lg font-semibold mb-2">Link cuộc gọi không hợp lệ</h2>
          <p className="text-white/50 text-sm">Thiếu thông tin callType hoặc callId.</p>
        </div>
      </div>
    );
  }

  return <VideoCallRoom callType={type} callId={id} />;
}
