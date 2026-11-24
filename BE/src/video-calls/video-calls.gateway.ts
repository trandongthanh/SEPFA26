import { Logger } from '@nestjs/common';
import {
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { AccountsService } from '../accounts/accounts.service';
import { TokenService } from '../auth/token.service';
import type {
  VideoCallEndReason,
  VideoCallEventName,
} from './video-call.constants';
import { isOriginAllowed, parseAllowedOrigins } from './video-call-origin';

// K8: mỗi tài khoản 1 room — mọi thiết bị đang mở app của người đó cùng nhận sự kiện.
export const accountRoom = (accountId: string): string =>
  `account:${accountId}`;

// P2: mã lỗi client nhận ở `connect_error` (err.message) khi bị từ chối kết nối.
export const SOCKET_UNAUTHORIZED = 'UNAUTHORIZED';

// ===== Payload 4 sự kiện (bản chốt §5.3) — contract cho FE/Mobile =====
export interface VideoCallRingingPayload {
  callId: string;
  orderId: string;
  caller: { accountId: string; fullName: string };
  ringExpiresAt: string; // ISO
}
// Gửi room người gọi + room người nhận: máy không khớp deviceSessionId thì tắt chuông.
export interface VideoCallAcceptedPayload {
  callId: string;
  deviceSessionId: string;
}
// Gửi room người vừa chuyển máy: máy cũ không khớp deviceSessionId mới thì tự thoát.
export interface VideoCallMovedPayload {
  callId: string;
  deviceSessionId: string;
}
export interface VideoCallEndedPayload {
  callId: string;
  endReason: VideoCallEndReason;
  endedAt: string; // ISO
}
export interface VideoCallEventPayloads {
  'video_call.ringing': VideoCallRingingPayload;
  'video_call.accepted': VideoCallAcceptedPayload;
  'video_call.moved': VideoCallMovedPayload;
  'video_call.ended': VideoCallEndedPayload;
}

// P1: CORS của socket.io (lượt polling) — cùng luật với middleware (lượt websocket).
// Đọc CORS_ORIGIN lúc chạy (ConfigModule đã nạp .env vào process.env).
export function socketCorsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  callback(
    null,
    isOriginAllowed(origin, parseAllowedOrigins(process.env.CORS_ORIGIN)),
  );
}

/**
 * K8: kênh báo sự kiện cuộc gọi (chỉ server → client; thao tác của client đi qua REST).
 * Kết nối: io(`${BE}/ws`, { auth: { token: <access token> } }) hoặc header Authorization: Bearer.
 */
@WebSocketGateway({
  namespace: '/ws',
  cors: { origin: socketCorsOrigin, credentials: true },
})
export class VideoCallsGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new Logger(VideoCallsGateway.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly accounts: AccountsService,
  ) {}

  // P2: xác thực bằng middleware — bị từ chối trước khi vào room; được nhận thì lúc client thấy
  // `connect` socket đã ở trong room, không lỡ `ringing` gửi ngay sau đó.
  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      this.authenticate(socket)
        .then((ok) => next(ok ? undefined : new Error(SOCKET_UNAUTHORIZED)))
        .catch((err: unknown) => {
          this.logger.warn(`Xác thực socket lỗi: ${String(err)}`);
          next(new Error(SOCKET_UNAUTHORIZED));
        });
    });
  }

  /**
   * K8: kiểm origin (P1) → access token hợp lệ (không nhận refresh token) → tài khoản còn được
   * đăng nhập (ACTIVE/PENDING — cùng luật JWT) → gắn accountId + vào room của tài khoản.
   */
  async authenticate(socket: Socket): Promise<boolean> {
    const allowed = parseAllowedOrigins(process.env.CORS_ORIGIN);
    if (!isOriginAllowed(socket.handshake.headers.origin, allowed)) {
      return false;
    }
    const token = extractToken(socket);
    if (!token) {
      return false;
    }
    let payload: ReturnType<TokenService['verifyAccess']>;
    try {
      payload = this.tokens.verifyAccess(token);
    } catch {
      return false;
    }
    if (payload.type !== 'access') {
      return false;
    }
    const account = await this.accounts.findAuthenticatableById(payload.sub);
    if (!account) {
      return false;
    }
    (socket.data as { accountId?: string }).accountId = account.id;
    await socket.join(accountRoom(account.id));
    return true;
  }

  // Gửi sự kiện tới mọi thiết bị của các tài khoản. Lỗi gửi chỉ log (P21) — DB đã ghi xong,
  // client vẫn đồng bộ được bằng GET /video-calls/active.
  emitToAccounts<E extends VideoCallEventName>(
    accountIds: readonly string[],
    event: E,
    payload: VideoCallEventPayloads[E],
  ): void {
    try {
      this.server.to(accountIds.map(accountRoom)).emit(event, payload);
    } catch (err) {
      this.logger.warn(
        `Không gửi được ${event} (callId ${payload.callId}): ${String(err)}`,
      );
    }
  }
}

// Token lấy từ handshake.auth.token (web/mobile) hoặc header Authorization: Bearer (client Node).
function extractToken(socket: Socket): string | null {
  const auth = socket.handshake.auth as Record<string, unknown> | undefined;
  const fromAuth = typeof auth?.token === 'string' ? auth.token : '';
  const header = socket.handshake.headers.authorization ?? '';
  const raw = (fromAuth || header).replace(/^Bearer\s+/i, '').trim();
  return raw.length > 0 ? raw : null;
}
