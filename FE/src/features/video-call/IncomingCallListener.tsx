'use client';

import React from 'react';
import { useIncomingCall } from './useIncomingCall';
import IncomingCallModal from './IncomingCallModal';

/**
 * Component lắng nghe WebSocket global và tự động bật popup cuộc gọi đến
 */
export default function IncomingCallListener() {
  const { incomingCall, dismissCall } = useIncomingCall();

  if (!incomingCall) return null;

  return <IncomingCallModal call={incomingCall} onClose={dismissCall} />;
}
