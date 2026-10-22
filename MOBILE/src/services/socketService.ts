import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { BACKEND_WS_URL, API_BASE_URL } from '../config/api';
import { storage } from '../utils/storage';
import {
  VideoCallRingingPayload,
  VideoCallAcceptedPayload,
  VideoCallMovedPayload,
  VideoCallEndedPayload,
} from './videoCallService';

type RingingListener = (data: VideoCallRingingPayload) => void;
type AcceptedListener = (data: VideoCallAcceptedPayload) => void;
type MovedListener = (data: VideoCallMovedPayload) => void;
type EndedListener = (data: VideoCallEndedPayload) => void;

class SocketService {
  private socket: Socket | null = null;
  private currentToken: string | null = null;

  private ringingListeners: Set<RingingListener> = new Set();
  private acceptedListeners: Set<AcceptedListener> = new Set();
  private movedListeners: Set<MovedListener> = new Set();
  private endedListeners: Set<EndedListener> = new Set();
  private isRefreshing: boolean = false;

  /**
   * Kết nối WebSocket tới BE namespace /ws
   */
  connect(token: string) {
    if (this.socket && this.currentToken === token && this.socket.connected) {
      return;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.currentToken = token;

    // Handshake auth: { token } và extraHeaders origin: http://localhost:8081 để khớp với CORS_ORIGIN của BE
    const s = io(BACKEND_WS_URL, {
      auth: { token },
      extraHeaders: {
        origin: 'http://localhost:8081',
        Origin: 'http://localhost:8081',
      },
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 3000,
    });

    this.socket = s;

    s.on('connect', () => {
      console.log('[SocketService] Connected to backend /ws');
    });

    s.on('connect_error', async (err: any) => {
      console.warn('[SocketService] Connect error:', err?.message || err);
      // Nếu lỗi UNAUTHORIZED do token hết hạn, chỉ refresh 1 lần duy nhất để tránh 429
      if (err?.message === 'UNAUTHORIZED' || err?.message?.includes('unauthorized')) {
        if (this.isRefreshing) return;
        this.isRefreshing = true;

        try {
          if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
          }
          const refreshToken = await storage.getRefreshToken();
          if (refreshToken) {
            const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
            const { accessToken, refreshToken: newRefresh } = res.data;
            await storage.setToken(accessToken, newRefresh || refreshToken);
            this.connect(accessToken);
          }
        } catch (refreshErr) {
          console.warn('[SocketService] Auto-refresh token failed:', refreshErr);
        } finally {
          this.isRefreshing = false;
        }
      }
    });

    // 1. Cuộc gọi đến (bắt đầu đổ chuông)
    s.on('video_call.ringing', (data: VideoCallRingingPayload) => {
      console.log('[SocketService] Event video_call.ringing:', data);
      this.ringingListeners.forEach((listener) => {
        try {
          listener(data);
        } catch (e) {
          console.error(e);
        }
      });
    });

    // 2. Cuộc gọi đã được nghe máy trên thiết bị khác
    s.on('video_call.accepted', (data: VideoCallAcceptedPayload) => {
      console.log('[SocketService] Event video_call.accepted:', data);
      this.acceptedListeners.forEach((listener) => {
        try {
          listener(data);
        } catch (e) {
          console.error(e);
        }
      });
    });

    // 3. Cuộc gọi chuyển sang thiết bị khác
    s.on('video_call.moved', (data: VideoCallMovedPayload) => {
      console.log('[SocketService] Event video_call.moved:', data);
      this.movedListeners.forEach((listener) => {
        try {
          listener(data);
        } catch (e) {
          console.error(e);
        }
      });
    });

    // 4. Cuộc gọi kết thúc (cúp máy, từ chối, hết giờ, hủy)
    s.on('video_call.ended', (data: VideoCallEndedPayload) => {
      console.log('[SocketService] Event video_call.ended:', data);
      this.endedListeners.forEach((listener) => {
        try {
          listener(data);
        } catch (e) {
          console.error(e);
        }
      });
    });

    s.on('disconnect', (reason: any) => {
      console.log('[SocketService] Disconnected:', reason);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.currentToken = null;
  }

  // ===== Đăng ký / Hủy đăng ký listener =====

  onRinging(listener: RingingListener): () => void {
    this.ringingListeners.add(listener);
    return () => this.ringingListeners.delete(listener);
  }

  onAccepted(listener: AcceptedListener): () => void {
    this.acceptedListeners.add(listener);
    return () => this.acceptedListeners.delete(listener);
  }

  onMoved(listener: MovedListener): () => void {
    this.movedListeners.add(listener);
    return () => this.movedListeners.delete(listener);
  }

  onEnded(listener: EndedListener): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }
}

export const socketService = new SocketService();
