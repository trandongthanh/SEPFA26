import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { TokenService } from '../auth/token.service';

/**
 * WebSocket gateway for video-call notifications. Clients must connect with
 * an access token in the socket handshake auth: { token }
 */
@WebSocketGateway({ namespace: '/ws', cors: { origin: true } })
@Injectable()
export class VideoCallsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(VideoCallsGateway.name);

  // Map accountId -> Set(socket.id)
  private readonly clients = new Map<string, Set<string>>();

  constructor(private readonly tokenService: TokenService) {}

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth && (client.handshake.auth as any).token) ||
        (client.handshake.headers && (client.handshake.headers as any).authorization);

      if (!token) {
        this.logger.warn('Socket connection rejected: no token');
        client.disconnect(true);
        return;
      }

      // Authorization header may be "Bearer <token>"
      const raw = String(token).replace(/^Bearer\s+/i, '');
      const payload = this.tokenService.verifyAccess(raw);
      const accountId = payload.sub as string;

      // store mapping
      const existing = this.clients.get(accountId) ?? new Set<string>();
      existing.add(client.id);
      this.clients.set(accountId, existing);

      // join rooms for convenience
      client.join(`user_${accountId}`);
      client.join(`account_${accountId}`);

      this.logger.log(`Socket connected: ${client.id} for account ${accountId}`);

      // attach accountId for quick lookup
      (client as any).accountId = accountId;
    } catch (e) {
      this.logger.warn('Socket connection rejected: token invalid');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const accountId = (client as any).accountId;
    if (!accountId) return;

    const set = this.clients.get(accountId);
    if (set) {
      set.delete(client.id);
      if (set.size === 0) this.clients.delete(accountId);
    }
    this.logger.log(`Socket disconnected: ${client.id} for account ${accountId}`);
  }

  /**
   * Notify a specific provider/account about an incoming call event.
   */
  notifyAccount(accountId: string, event: any) {
    this.logger.log(`Notifying account ${accountId} event ${event?.eventType || 'incoming_call'}`);
    try {
      this.server.to(`account_${accountId}`).emit('incoming_call', event);
    } catch (e) {
      this.logger.warn(`Failed to notify account ${accountId}: ${e}`);
    }
  }
}
