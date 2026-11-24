import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { StreamVideoClient } from './stream-video.client';
import { VideoCallsService } from './video-calls.service';

// K9: chỉ 3 loại sự kiện này làm thay đổi "ai còn trong cuộc gọi".
const PRESENCE_EVENTS: readonly string[] = [
  'call.session_participant_joined',
  'call.session_participant_left',
  'call.session_ended',
];

/**
 * K9, P22: POST /api/v1/video-calls/webhook — chỉ GetStream gọi (ẩn khỏi Swagger).
 * Không JWT (kiểm chữ ký x-signature trên raw body — cần rawBody: true, X1), không rate limit.
 * KHÔNG khai @Body: ValidationPipe toàn cục (forbidNonWhitelisted) sẽ 400 với payload GetStream.
 */
@ApiExcludeController()
@Controller('video-calls')
export class VideoCallsWebhookController {
  constructor(
    private readonly stream: StreamVideoClient,
    private readonly videoCalls: VideoCallsService,
  ) {}

  @SkipThrottle({ default: true, account: true })
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature: string | undefined,
  ): Promise<{ ok: true }> {
    if (!this.stream.verifyWebhook(req.rawBody, signature)) {
      throw new UnauthorizedException('WEBHOOK_UNAUTHORIZED');
    }
    const event = (req.body ?? {}) as { type?: unknown; call_cid?: unknown };
    // P17: chữ ký đúng mà sự kiện không liên quan / cuộc gọi lạ → 200 (GetStream không gửi lại).
    if (
      typeof event.type !== 'string' ||
      !PRESENCE_EVENTS.includes(event.type)
    ) {
      return { ok: true };
    }
    const callId = this.stream.parseCallCid(event.call_cid);
    if (!callId) {
      return { ok: true };
    }
    // Lỗi bất ngờ (DB) → để Nest trả 500 → GetStream gửi lại (P17).
    await this.videoCalls.syncPresence(callId);
    return { ok: true };
  }
}
