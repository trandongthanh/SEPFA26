import { UnauthorizedException, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { StreamVideoClient } from './stream-video.client';
import { VideoCallsWebhookController } from './video-calls-webhook.controller';
import type { VideoCallsService } from './video-calls.service';

const CALL_ID = '6f1c1a1e-8a51-4c2b-9d3e-2f6a7b8c9d0e';

describe('VideoCallsWebhookController (K9, P17, P22)', () => {
  const stream = { verifyWebhook: jest.fn(), parseCallCid: jest.fn() };
  const videoCalls = { syncPresence: jest.fn() };
  const controller = new VideoCallsWebhookController(
    stream as unknown as StreamVideoClient,
    videoCalls as unknown as VideoCallsService,
  );

  const req = (body: unknown) =>
    ({
      rawBody: Buffer.from(JSON.stringify(body)),
      body,
    }) as unknown as RawBodyRequest<Request>;

  beforeEach(() => {
    jest.clearAllMocks();
    stream.verifyWebhook.mockReturnValue(true);
    stream.parseCallCid.mockReturnValue(CALL_ID);
    videoCalls.syncPresence.mockResolvedValue(undefined);
  });

  it('sai/thiếu chữ ký → 401 WEBHOOK_UNAUTHORIZED, không đồng bộ gì', async () => {
    stream.verifyWebhook.mockReturnValue(false);
    const body = { type: 'call.session_participant_left' };
    await expect(controller.handle(req(body), undefined)).rejects.toThrow(
      new UnauthorizedException('WEBHOOK_UNAUTHORIZED'),
    );
    expect(stream.verifyWebhook).toHaveBeenCalledWith(
      Buffer.from(JSON.stringify(body)),
      undefined,
    );
    expect(videoCalls.syncPresence).not.toHaveBeenCalled();
  });

  it.each([
    'call.session_participant_joined',
    'call.session_participant_left',
    'call.session_ended',
  ])(
    '%s + cid hợp lệ → syncPresence(callId), 200 { ok: true }',
    async (type) => {
      const body = { type, call_cid: `lancare_call:${CALL_ID}` };
      await expect(controller.handle(req(body), 'sig')).resolves.toEqual({
        ok: true,
      });
      expect(stream.parseCallCid).toHaveBeenCalledWith(body.call_cid);
      expect(videoCalls.syncPresence).toHaveBeenCalledWith(CALL_ID);
    },
  );

  it.each<[string, unknown]>([
    ['loại sự kiện khác', { type: 'call.created', call_cid: 'x' }],
    ['không có type', { call_cid: 'x' }],
    ['body không phải object', null],
  ])('%s → 200, bỏ qua', async (_name, body) => {
    await expect(controller.handle(req(body), 'sig')).resolves.toEqual({
      ok: true,
    });
    expect(videoCalls.syncPresence).not.toHaveBeenCalled();
  });

  it('cid lạ / call type khác (parseCallCid → null) → 200, bỏ qua', async () => {
    stream.parseCallCid.mockReturnValue(null);
    await expect(
      controller.handle(
        req({ type: 'call.session_participant_left', call_cid: 'default:x' }),
        'sig',
      ),
    ).resolves.toEqual({ ok: true });
    expect(videoCalls.syncPresence).not.toHaveBeenCalled();
  });

  it('lỗi bất ngờ (DB) → ném lên để Nest trả 500 (GetStream gửi lại)', async () => {
    videoCalls.syncPresence.mockRejectedValue(new Error('db down'));
    await expect(
      controller.handle(
        req({
          type: 'call.session_participant_left',
          call_cid: `lancare_call:${CALL_ID}`,
        }),
        'sig',
      ),
    ).rejects.toThrow('db down');
  });
});
