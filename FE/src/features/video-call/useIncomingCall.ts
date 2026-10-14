'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/lib/auth.store';
import type { IncomingCallEvent } from './IncomingCallModal';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

/**
 * Hook kết nối WebSocket tới namespace /ws để lắng nghe event incoming_call
 */
export function useIncomingCall() {
  const [incomingCall, setIncomingCall] = useState<IncomingCallEvent | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const socketRef = useRef<Socket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<any>(null);

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

    // Connect to /ws namespace
    const socket = io(`${API_BASE}/ws`, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 3000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      // Connected successfully
    });

    socket.on('incoming_call', (data: IncomingCallEvent) => {
      setIncomingCall(data);
      startRingtone();
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
