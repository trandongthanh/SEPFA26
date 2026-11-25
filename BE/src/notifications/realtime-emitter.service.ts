import { Injectable, Logger } from '@nestjs/common';
import type { Namespace } from 'socket.io';

export const realtimeAccountRoom = (accountId: string): string =>
  `account:${accountId}`;

/**
 * Cầu nối phát sự kiện real-time qua namespace `/ws` (dùng chung kết nối Socket.IO với VideoCallsGateway).
 * Gửi theo room `account:<accountId>` để mọi thiết bị của tài khoản cùng nhận.
 * Lỗi phát socket chỉ log cảnh báo, KHÔNG bao giờ ném lỗi làm hỏng luồng nghiệp vụ chính.
 */
@Injectable()
export class RealtimeEmitter {
  private server: Namespace | null = null;
  private readonly logger = new Logger(RealtimeEmitter.name);

  attachServer(server: Namespace): void {
    this.server = server;
  }

  emitToAccount(accountId: string, event: string, payload: unknown): void {
    this.emitToAccounts([accountId], event, payload);
  }

  emitToAccounts(
    accountIds: readonly string[],
    event: string,
    payload: unknown,
  ): void {
    if (!this.server || accountIds.length === 0) {
      return;
    }
    const uniqueRooms = [...new Set(accountIds)].map(realtimeAccountRoom);
    try {
      this.server.to(uniqueRooms).emit(event, payload);
    } catch (err) {
      this.logger.warn(
        `Không phát được sự kiện socket ${event} tới ${uniqueRooms.join(',')}: ${String(err)}`,
      );
    }
  }
}
