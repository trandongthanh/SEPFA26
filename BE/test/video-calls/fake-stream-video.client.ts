import type { ConfigService } from '@nestjs/config';
import {
  StreamVideoClient,
  type EnsureCallTypeResult,
  type StreamCallMember,
} from '../../src/video-calls/stream-video.client';

/**
 * GetStream giả cho e2e (K15, P23) — KẾ THỪA client thật với ConfigService env e2e:
 * verifyWebhook (HMAC thật), generateCallToken (ký JWT thật), parseCallCid chạy đúng code thật.
 * Chỉ thay các lời gọi mạng: tạo/kết thúc cuộc gọi, hỏi ai đang có mặt, setup call type.
 */
export class FakeStreamVideoClient extends StreamVideoClient {
  // Đúng những gì service truyền vào createCall.
  readonly created: {
    callId: string;
    members: StreamCallMember[];
    maxDurationSeconds: number;
  }[] = [];
  readonly ended: string[] = [];
  // callId → user id đang có mặt (test tự đặt để giả lập vào/rời).
  readonly participants = new Map<string, string[]>();
  failCreate = false;
  failEnd = false;
  failPresence = false;
  // Giả lập GetStream chậm khi tạo cuộc gọi (ms).
  createDelayMs = 0;

  constructor(config: ConfigService) {
    super(config);
  }

  async createCall(
    callId: string,
    input: { members: StreamCallMember[]; maxDurationSeconds: number },
  ): Promise<void> {
    if (this.createDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.createDelayMs));
    }
    if (this.failCreate) {
      throw new Error('GetStream giả: tạo cuộc gọi lỗi');
    }
    this.created.push({ callId, ...input });
  }

  endCall(callId: string): Promise<void> {
    if (this.failEnd) {
      return Promise.reject(new Error('GetStream giả: kết thúc lỗi'));
    }
    this.ended.push(callId);
    return Promise.resolve();
  }

  listPresentUserIds(callId: string): Promise<string[]> {
    if (this.failPresence) {
      return Promise.reject(new Error('GetStream giả: không hỏi được'));
    }
    return Promise.resolve([...new Set(this.participants.get(callId) ?? [])]);
  }

  ensureCallType(): Promise<EnsureCallTypeResult> {
    return Promise.reject(new Error('e2e không setup call type'));
  }

  reset(): void {
    this.created.length = 0;
    this.ended.length = 0;
    this.participants.clear();
    this.failCreate = false;
    this.failEnd = false;
    this.failPresence = false;
    this.createDelayMs = 0;
  }
}
