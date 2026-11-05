import { createHmac } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import {
  createVideoCallsTestApp,
  type VideoCallsTestApp,
} from './video-calls-test-app';
import { VideoCallSeed, type SeededUser } from './video-call-seed';

const API = '/api/v1';

// Chạy: npm run test:e2e -- --runInBand (suite này và auth dùng chung DB test).
describe('Video calls (e2e)', () => {
  let ctx: VideoCallsTestApp;
  let seed: VideoCallSeed;

  beforeAll(async () => {
    ctx = await createVideoCallsTestApp();
    seed = new VideoCallSeed(ctx);
  });

  afterAll(async () => {
    seed?.closeSockets();
    await ctx?.app.close();
  });

  beforeEach(async () => {
    seed.closeSockets();
    await ctx.reset();
  });

  const createCall = (user: SeededUser, orderId: unknown) =>
    request(seed.http)
      .post(`${API}/video-calls`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ orderId });

  const countCalls = async () => {
    const [{ count }] = (await ctx.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM video_calls',
    )) as { count: number }[];
    return count;
  };

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  // ===================== POST /video-calls (S4a) =====================
  describe('POST /video-calls', () => {
    it('201: provider gọi khách → session đúng §5.2, khách nhận ringing, provider không', async () => {
      const { customer, provider, orderId } = await seed.pair();
      const customerSocket = await seed.socket(customer.accessToken);
      const providerSocket = await seed.socket(provider.accessToken);

      const res = await createCall(provider, orderId).expect(201);
      const body = res.body as {
        call: Record<string, unknown> & { id: string; createdAt: string };
        stream: Record<string, string>;
        deviceSessionId: string;
      };

      expect(body.call).toEqual({
        id: expect.any(String),
        orderId,
        status: 'RINGING',
        endReason: null,
        myRole: 'CALLER',
        endedBy: null,
        caller: { accountId: provider.accountId, fullName: 'Vườn Lan' },
        callee: { accountId: customer.accountId, fullName: 'Khách Hoa' },
        createdAt: expect.any(String),
        ringExpiresAt: new Date(
          new Date(body.call.createdAt).getTime() + 45_000,
        ).toISOString(),
        answeredAt: null,
        endedAt: null,
        durationSeconds: null,
      });
      expect(body.stream).toEqual({
        apiKey: 'e2e-stream-key',
        callType: 'lancare_call',
        callId: body.call.id,
        token: expect.any(String),
        userId: provider.accountId,
      });
      expect(body.deviceSessionId).toEqual(expect.any(String));

      // K6: call token ký bằng secret e2e, đúng 1 cuộc gọi, role call_member, hiệu lực 3945s.
      const claims = new JwtService().verify<Record<string, unknown>>(
        body.stream.token,
        { secret: 'e2e-stream-secret' },
      );
      expect(claims).toMatchObject({
        user_id: provider.accountId,
        role: 'call_member',
        call_cids: [`lancare_call:${body.call.id}`],
      });
      expect((claims.exp as number) - (claims.iat as number)).toBe(3945);

      const ringing = await customerSocket.waitFor('video_call.ringing');
      expect(ringing).toEqual({
        callId: body.call.id,
        orderId,
        caller: { accountId: provider.accountId, fullName: 'Vườn Lan' },
        ringExpiresAt: body.call.ringExpiresAt,
      });
      await sleep(200);
      expect(providerSocket.events).toEqual([]);

      const [row] = (await ctx.dataSource.query(
        'SELECT status, caller_account_id, callee_account_id, caller_device_session_id FROM video_calls',
      )) as Record<string, unknown>[];
      expect(row).toEqual({
        status: 'RINGING',
        caller_account_id: provider.accountId,
        callee_account_id: customer.accountId,
        caller_device_session_id: body.deviceSessionId,
      });
    });

    it('201: khách gọi provider → provider nhận ringing', async () => {
      const { customer, provider, orderId } = await seed.pair();
      const providerSocket = await seed.socket(provider.accessToken);
      const res = await createCall(customer, orderId).expect(201);
      const ringing = await providerSocket.waitFor('video_call.ringing');
      expect(ringing).toMatchObject({
        callId: (res.body as { call: { id: string } }).call.id,
        caller: { accountId: customer.accountId, fullName: 'Khách Hoa' },
      });
    });

    it('GetStream nhận đúng: call type lancare_call, user hệ thống, 2 member có tên, tối đa 3705s', async () => {
      const { customer, provider, orderId } = await seed.pair();
      const res = await createCall(provider, orderId).expect(201);
      expect(ctx.stream.callType).toBe('lancare_call');
      expect(ctx.stream.systemUserId).toBe('lancare-system');
      expect(ctx.stream.created).toEqual([
        {
          callId: (res.body as { call: { id: string } }).call.id,
          members: [
            { id: provider.accountId, name: 'Vườn Lan' },
            { id: customer.accountId, name: 'Khách Hoa' },
          ],
          maxDurationSeconds: 3705,
        },
      ]);
    });

    it('404 ORDER_NOT_FOUND: người ngoài đơn, đơn không tồn tại; 400: orderId không phải uuid', async () => {
      const { orderId } = await seed.pair();
      const stranger = await seed.customer('Người Lạ');
      const outsider = await createCall(stranger, orderId).expect(404);
      expect((outsider.body as { message: string }).message).toBe(
        'ORDER_NOT_FOUND',
      );
      const missing = await createCall(
        stranger,
        '00000000-0000-4000-8000-000000000000',
      ).expect(404);
      expect((missing.body as { message: string }).message).toBe(
        'ORDER_NOT_FOUND',
      );
      await createCall(stranger, 'not-a-uuid').expect(400);
      await createCall(stranger, undefined).expect(400);
      expect(await countCalls()).toBe(0);
    });

    it('401: không đăng nhập', async () => {
      const { orderId } = await seed.pair();
      await request(seed.http)
        .post(`${API}/video-calls`)
        .send({ orderId })
        .expect(401);
    });

    it.each(['DRAFT', 'CANCELLED', 'REJECTED'])(
      '409 ORDER_NOT_CALLABLE: đơn %s',
      async (status) => {
        const { provider, orderId } = await seed.pair(status);
        const res = await createCall(provider, orderId).expect(409);
        expect((res.body as { message: string }).message).toBe(
          'ORDER_NOT_CALLABLE',
        );
        expect(await countCalls()).toBe(0);
      },
    );

    it('409 VIDEO_CALL_IN_PROGRESS: đơn đang đổ chuông, bên kia bấm gọi', async () => {
      const { customer, provider, orderId } = await seed.pair();
      await createCall(provider, orderId).expect(201);
      const res = await createCall(customer, orderId).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'VIDEO_CALL_IN_PROGRESS',
      );
      expect(await countCalls()).toBe(1);
    });

    it('L4: hai bên bấm gọi cùng lúc → đúng 1 cái 201, cái kia 409, chỉ 1 dòng', async () => {
      const { customer, provider, orderId } = await seed.pair();
      ctx.stream.createDelayMs = 300; // nới khoảng chồng lấn
      const responses = await Promise.all([
        createCall(provider, orderId),
        createCall(customer, orderId),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      const loser = responses.find((r) => r.status === 409);
      expect((loser?.body as { message: string }).message).toBe(
        'VIDEO_CALL_IN_PROGRESS',
      );
      expect(await countCalls()).toBe(1);
      expect(ctx.stream.created).toHaveLength(1);
    });

    it('L5: máy bận theo người (1 provider, 2 đơn, 2 khách) → CALLEE_BUSY / CALLER_BUSY, không lưu dòng', async () => {
      const provider = await seed.provider();
      const customerA = await seed.customer('Khách A');
      const customerB = await seed.customer('Khách B');
      const orderA = await seed.order(customerA, provider);
      const orderB = await seed.order(customerB, provider);

      await createCall(provider, orderA).expect(201);
      const calleeBusy = await createCall(customerB, orderB).expect(409);
      expect((calleeBusy.body as { message: string }).message).toBe(
        'CALLEE_BUSY',
      );
      const callerBusy = await createCall(provider, orderB).expect(409);
      expect((callerBusy.body as { message: string }).message).toBe(
        'CALLER_BUSY',
      );
      expect(await countCalls()).toBe(1);
    });

    it('P14: 2 đơn khác nhau cùng lúc (provider gọi khách A, khách B gọi provider) → đúng 1 cái 201', async () => {
      const provider = await seed.provider();
      const customerA = await seed.customer('Khách A');
      const customerB = await seed.customer('Khách B');
      const orderA = await seed.order(customerA, provider);
      const orderB = await seed.order(customerB, provider);
      ctx.stream.createDelayMs = 300; // không có khóa theo người thì cả 2 cùng lọt
      const responses = await Promise.all([
        createCall(provider, orderA),
        createCall(customerB, orderB),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await countCalls()).toBe(1);
    });

    it('K13: GetStream chậm 1500ms → created_at ≥ lúc gửi + 1500ms (chuông đủ 45s)', async () => {
      const { provider, orderId } = await seed.pair();
      ctx.stream.createDelayMs = 1500;
      const sentAt = Date.now();
      const res = await createCall(provider, orderId).expect(201);
      const [{ created_at }] = (await ctx.dataSource.query(
        'SELECT created_at FROM video_calls',
      )) as { created_at: Date }[];
      expect(created_at.getTime()).toBeGreaterThanOrEqual(sentAt + 1500);
      expect((res.body as { call: { createdAt: string } }).call.createdAt).toBe(
        created_at.toISOString(),
      );
    });

    it('502 VIDEO_PROVIDER_UNAVAILABLE: GetStream lỗi → không dòng, không socket', async () => {
      const { customer, provider, orderId } = await seed.pair();
      const customerSocket = await seed.socket(customer.accessToken);
      ctx.stream.failCreate = true;
      const res = await createCall(provider, orderId).expect(502);
      expect((res.body as { message: string }).message).toBe(
        'VIDEO_PROVIDER_UNAVAILABLE',
      );
      expect(await countCalls()).toBe(0);
      await sleep(200);
      expect(customerSocket.events).toEqual([]);
      // GetStream hồi lại → gọi được ngay.
      ctx.stream.failCreate = false;
      await createCall(provider, orderId).expect(201);
    });
  });

  // ===================== GET /video-calls/active, GET /video-calls (S4b) =====================
  describe('GET /video-calls/active, GET /video-calls', () => {
    const getActive = (user: SeededUser, orderId: unknown) =>
      request(seed.http)
        .get(`${API}/video-calls/active`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ orderId });
    const getHistory = (user: SeededUser, orderId: unknown) =>
      request(seed.http)
        .get(`${API}/video-calls`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ orderId });

    it('active: chưa có cuộc gọi → { call: null }; đang đổ chuông → cuộc gọi, myRole theo người hỏi', async () => {
      const { customer, provider, orderId } = await seed.pair();
      const empty = await getActive(customer, orderId).expect(200);
      expect(empty.body).toEqual({ call: null });

      const created = await createCall(provider, orderId).expect(201);
      const callId = (created.body as { call: { id: string } }).call.id;
      const asCallee = await getActive(customer, orderId).expect(200);
      expect((asCallee.body as { call: unknown }).call).toMatchObject({
        id: callId,
        status: 'RINGING',
        myRole: 'CALLEE',
        caller: { accountId: provider.accountId, fullName: 'Vườn Lan' },
      });
      const asCaller = await getActive(provider, orderId).expect(200);
      expect((asCaller.body as { call: unknown }).call).toEqual(
        (created.body as { call: unknown }).call,
      );
    });

    it('lịch sử: mới nhất trước, hai bên thấy như nhau (trừ myRole), tối đa 50', async () => {
      const { customer, provider, orderId } = await seed.pair();
      // 52 cuộc đã kết thúc, cách nhau 1 phút (lùi về quá khứ).
      for (let i = 0; i < 52; i++) {
        await ctx.dataSource.query(
          `INSERT INTO video_calls (id, order_id, caller_account_id, callee_account_id, status,
             end_reason, ended_at, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 'ENDED', 'MISSED',
                   now() - make_interval(mins => $4) + interval '45 seconds',
                   now() - make_interval(mins => $4))`,
          [orderId, provider.accountId, customer.accountId, 100 - i],
        );
      }
      const res = await getHistory(customer, orderId).expect(200);
      const list = res.body as { createdAt: string; myRole: string }[];
      expect(list).toHaveLength(50);
      const times = list.map((c) => new Date(c.createdAt).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      expect(list.every((c) => c.myRole === 'CALLEE')).toBe(true);

      const asProvider = await getHistory(provider, orderId).expect(200);
      const providerList = asProvider.body as { id: string; myRole: string }[];
      expect(providerList.map((c) => c.id)).toEqual(
        (res.body as { id: string }[]).map((c) => c.id),
      );
      expect(providerList.every((c) => c.myRole === 'CALLER')).toBe(true);
      // Cuộc cũ nhất (100 phút trước) và kế đó (99 phút) bị cắt.
      const oldest = times[times.length - 1];
      expect(Date.now() - oldest).toBeLessThan(99 * 60_000);
    });

    it('lịch sử đơn chưa gọi lần nào → []', async () => {
      const { customer, orderId } = await seed.pair();
      const res = await getHistory(customer, orderId).expect(200);
      expect(res.body).toEqual([]);
    });

    it('404 ORDER_NOT_FOUND cho người ngoài đơn; 400 orderId sai định dạng / thiếu', async () => {
      const { orderId } = await seed.pair();
      const stranger = await seed.customer('Người Lạ');
      for (const send of [getActive, getHistory]) {
        const res = await send(stranger, orderId).expect(404);
        expect((res.body as { message: string }).message).toBe(
          'ORDER_NOT_FOUND',
        );
        await send(stranger, 'abc').expect(400);
        await send(stranger, undefined).expect(400);
      }
    });
  });

  // ===================== POST /video-calls/:id/join (S5a) =====================
  describe('POST /video-calls/:id/join', () => {
    const join = (user: SeededUser, callId: string) =>
      request(seed.http)
        .post(`${API}/video-calls/${callId}/join`)
        .set('Authorization', `Bearer ${user.accessToken}`);

    // Provider gọi khách; trả callId.
    const ring = async (provider: SeededUser, orderId: string) => {
      const res = await createCall(provider, orderId).expect(201);
      return (res.body as { call: { id: string } }).call.id;
    };

    it('L6/P6/P8: khách nghe ở 1 máy → ACTIVE; người gọi + cả 2 máy khách nhận accepted cùng deviceSessionId', async () => {
      const { customer, provider, orderId } = await seed.pair();
      const providerSocket = await seed.socket(provider.accessToken);
      const phone = await seed.socket(customer.accessToken);
      const tablet = await seed.socket(customer.accessToken);
      const callId = await ring(provider, orderId);

      const res = await join(customer, callId).expect(200);
      const body = res.body as {
        call: { status: string; myRole: string; answeredAt: string };
        deviceSessionId: string;
        stream: { userId: string; callId: string };
      };
      expect(body.call).toMatchObject({ status: 'ACTIVE', myRole: 'CALLEE' });
      expect(body.stream).toMatchObject({
        userId: customer.accountId,
        callId,
      });

      for (const probe of [providerSocket, phone, tablet]) {
        const accepted = await probe.waitFor('video_call.accepted');
        expect(accepted).toEqual({
          callId,
          deviceSessionId: body.deviceSessionId,
        });
      }

      const [row] = (await ctx.dataSource.query(
        `SELECT status, answered_at, short_handed_since, callee_device_session_id
         FROM video_calls WHERE id = $1`,
        [callId],
      )) as {
        status: string;
        answered_at: Date;
        short_handed_since: Date;
        callee_device_session_id: string;
      }[];
      expect(row.status).toBe('ACTIVE');
      expect(row.answered_at.toISOString()).toBe(body.call.answeredAt);
      // P6: chưa chắc 2 bên đã vào hình → bật mốc thiếu người ngay lúc nghe.
      expect(row.short_handed_since).toEqual(row.answered_at);
      expect(row.callee_device_session_id).toBe(body.deviceSessionId);
    });

    it('L6/P7: khách vào lại lần 2 → phiên mới, vẫn ACTIVE; moved chỉ tới room khách', async () => {
      const { customer, provider, orderId } = await seed.pair();
      const providerSocket = await seed.socket(provider.accessToken);
      const phone = await seed.socket(customer.accessToken);
      const callId = await ring(provider, orderId);
      const first = await join(customer, callId).expect(200);
      const second = await join(customer, callId).expect(200);

      const firstSession = (first.body as { deviceSessionId: string })
        .deviceSessionId;
      const secondSession = (second.body as { deviceSessionId: string })
        .deviceSessionId;
      expect(secondSession).not.toBe(firstSession);
      expect((second.body as { call: { status: string } }).call.status).toBe(
        'ACTIVE',
      );
      const moved = await phone.waitFor('video_call.moved');
      expect(moved).toEqual({ callId, deviceSessionId: secondSession });
      await sleep(200);
      expect(
        providerSocket.events.filter((e) => e.event === 'video_call.moved'),
      ).toEqual([]);
    });

    it('P7: người gọi vào lại lúc còn đổ chuông → vẫn RINGING, phiên người gọi mới, moved tới người gọi', async () => {
      const { provider, orderId } = await seed.pair();
      const providerSocket = await seed.socket(provider.accessToken);
      const created = await createCall(provider, orderId).expect(201);
      const createdBody = created.body as {
        call: { id: string };
        deviceSessionId: string;
      };
      const res = await join(provider, createdBody.call.id).expect(200);
      const body = res.body as {
        call: { status: string; myRole: string };
        deviceSessionId: string;
      };
      expect(body.call).toMatchObject({ status: 'RINGING', myRole: 'CALLER' });
      expect(body.deviceSessionId).not.toBe(createdBody.deviceSessionId);
      const moved = await providerSocket.waitFor('video_call.moved');
      expect(moved).toEqual({
        callId: createdBody.call.id,
        deviceSessionId: body.deviceSessionId,
      });
    });

    it('L9: cuộc đã kết thúc → 409 VIDEO_CALL_ENDED', async () => {
      const { customer, provider, orderId } = await seed.pair();
      const callId = await ring(provider, orderId);
      await ctx.dataSource.query(
        `UPDATE video_calls SET status = 'ENDED', end_reason = 'CANCELLED', ended_at = now(),
           ended_by = caller_account_id WHERE id = $1`,
        [callId],
      );
      const res = await join(customer, callId).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'VIDEO_CALL_ENDED',
      );
    });

    it('P16: đổ chuông đã quá 45s → đóng MISSED tại mốc + ended tới 2 bên, rồi 409 VIDEO_CALL_ENDED', async () => {
      const { customer, provider, orderId } = await seed.pair();
      const providerSocket = await seed.socket(provider.accessToken);
      const callId = await ring(provider, orderId);
      await ctx.dataSource.query(
        `UPDATE video_calls SET created_at = created_at - interval '46 seconds' WHERE id = $1`,
        [callId],
      );
      const res = await join(customer, callId).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'VIDEO_CALL_ENDED',
      );
      const [row] = (await ctx.dataSource.query(
        `SELECT status, end_reason, ended_by,
                (ended_at = created_at + interval '45 seconds') AS at_deadline
         FROM video_calls WHERE id = $1`,
        [callId],
      )) as Record<string, unknown>[];
      expect(row).toEqual({
        status: 'ENDED',
        end_reason: 'MISSED',
        ended_by: null,
        at_deadline: true,
      });
      expect(ctx.stream.ended).toEqual([callId]);
      const ended = await providerSocket.waitFor('video_call.ended');
      expect(ended).toMatchObject({ callId, endReason: 'MISSED' });
    });

    it('404 VIDEO_CALL_NOT_FOUND: người ngoài, id không tồn tại; 400: id không phải uuid', async () => {
      const { provider, orderId } = await seed.pair();
      const stranger = await seed.customer('Người Lạ');
      const callId = await ring(provider, orderId);
      for (const id of [callId, '00000000-0000-4000-8000-000000000000']) {
        const res = await join(stranger, id).expect(404);
        expect((res.body as { message: string }).message).toBe(
          'VIDEO_CALL_NOT_FOUND',
        );
      }
      await join(stranger, 'abc').expect(400);
    });
  });

  // ===================== POST /:id/decline, POST /:id/end (S5b) =====================
  describe('POST /video-calls/:id/decline, /:id/end', () => {
    const action = (
      user: SeededUser,
      callId: string,
      verb: 'decline' | 'end' | 'join',
    ) =>
      request(seed.http)
        .post(`${API}/video-calls/${callId}/${verb}`)
        .set('Authorization', `Bearer ${user.accessToken}`);

    // Provider gọi khách; trả callId + socket của cả hai.
    const ringing = async () => {
      const { customer, provider, orderId } = await seed.pair();
      const providerSocket = await seed.socket(provider.accessToken);
      const customerSocket = await seed.socket(customer.accessToken);
      const res = await createCall(provider, orderId).expect(201);
      const callId = (res.body as { call: { id: string } }).call.id;
      return {
        customer,
        provider,
        orderId,
        callId,
        providerSocket,
        customerSocket,
      };
    };

    it('decline: khách từ chối → 200 DECLINED, endedBy CALLEE; GetStream end; cả hai nhận ended', async () => {
      const { customer, callId, providerSocket, customerSocket } =
        await ringing();
      const res = await action(customer, callId, 'decline').expect(200);
      expect(res.body).toMatchObject({
        id: callId,
        status: 'ENDED',
        endReason: 'DECLINED',
        endedBy: 'CALLEE',
        myRole: 'CALLEE',
        durationSeconds: null,
      });
      const endedAt = (res.body as { endedAt: string }).endedAt;
      for (const probe of [providerSocket, customerSocket]) {
        expect(await probe.waitFor('video_call.ended')).toEqual({
          callId,
          endReason: 'DECLINED',
          endedAt,
        });
      }
      expect(ctx.stream.ended).toEqual([callId]);
    });

    it('decline: người gọi → 403 ONLY_CALLEE_CAN_DECLINE; cuộc đang nói → 409 VIDEO_CALL_NOT_RINGING', async () => {
      const { customer, provider, callId } = await ringing();
      const forbidden = await action(provider, callId, 'decline').expect(403);
      expect((forbidden.body as { message: string }).message).toBe(
        'ONLY_CALLEE_CAN_DECLINE',
      );
      await action(customer, callId, 'join').expect(200);
      const notRinging = await action(customer, callId, 'decline').expect(409);
      expect((notRinging.body as { message: string }).message).toBe(
        'VIDEO_CALL_NOT_RINGING',
      );
    });

    it('end: người gọi hủy lúc đổ chuông → CANCELLED, endedBy CALLER', async () => {
      const { provider, callId, customerSocket } = await ringing();
      const res = await action(provider, callId, 'end').expect(200);
      expect(res.body).toMatchObject({
        status: 'ENDED',
        endReason: 'CANCELLED',
        endedBy: 'CALLER',
      });
      expect(await customerSocket.waitFor('video_call.ended')).toMatchObject({
        callId,
        endReason: 'CANCELLED',
      });
    });

    it('end: cúp lúc đang nói → COMPLETED + endedBy + thời lượng; cúp lặp lại → 200 nguyên trạng', async () => {
      const { customer, provider, callId } = await ringing();
      await action(customer, callId, 'join').expect(200);
      await ctx.dataSource.query(
        `UPDATE video_calls SET answered_at = answered_at - interval '90 seconds' WHERE id = $1`,
        [callId],
      );
      const first = await action(customer, callId, 'end').expect(200);
      expect(first.body).toMatchObject({
        status: 'ENDED',
        endReason: 'COMPLETED',
        endedBy: 'CALLEE',
        myRole: 'CALLEE',
      });
      const duration = (first.body as { durationSeconds: number })
        .durationSeconds;
      expect(duration).toBeGreaterThanOrEqual(90);
      expect(duration).toBeLessThan(95);

      // Bên kia bấm cúp sau (hoặc bấm 2 lần) → trả nguyên trạng, không đổi ai cúp.
      const again = await action(provider, callId, 'end').expect(200);
      expect(again.body).toMatchObject({
        endReason: 'COMPLETED',
        endedBy: 'CALLEE',
        myRole: 'CALLER',
        endedAt: (first.body as { endedAt: string }).endedAt,
      });
      expect(ctx.stream.ended).toEqual([callId]);
      // Gọi lại được ngay (L9).
      await createCall(
        provider,
        (first.body as { orderId: string }).orderId,
      ).expect(201);
    });

    it('P21: GetStream end lỗi → vẫn 200, DB đã ENDED, vẫn báo ended', async () => {
      const { provider, callId, customerSocket } = await ringing();
      ctx.stream.failEnd = true;
      await action(provider, callId, 'end').expect(200);
      const [row] = (await ctx.dataSource.query(
        'SELECT status FROM video_calls WHERE id = $1',
        [callId],
      )) as { status: string }[];
      expect(row.status).toBe('ENDED');
      await customerSocket.waitFor('video_call.ended');
    });

    it('404 VIDEO_CALL_NOT_FOUND cho người ngoài; 400 id sai', async () => {
      const { callId } = await ringing();
      const stranger = await seed.customer('Người Lạ');
      for (const verb of ['decline', 'end'] as const) {
        const res = await action(stranger, callId, verb).expect(404);
        expect((res.body as { message: string }).message).toBe(
          'VIDEO_CALL_NOT_FOUND',
        );
        await action(stranger, 'abc', verb).expect(400);
      }
    });
  });

  // ===================== POST /video-calls/webhook (S6a) =====================
  describe('POST /video-calls/webhook', () => {
    // Ký HMAC-SHA256 thật bằng STREAM_API_SECRET của e2e (như GetStream ký).
    const sendWebhook = (payload: unknown, signature?: string) => {
      const raw = JSON.stringify(payload);
      const req = request(seed.http)
        .post(`${API}/video-calls/webhook`)
        .set('Content-Type', 'application/json');
      return req
        .set(
          'x-signature',
          signature ??
            createHmac('sha256', 'e2e-stream-secret').update(raw).digest('hex'),
        )
        .send(raw);
    };
    const event = (
      type: string,
      callId: string,
      callType = 'lancare_call',
    ) => ({
      type,
      call_cid: `${callType}:${callId}`,
      created_at: new Date().toISOString(),
    });
    const markOf = async (callId: string) => {
      const [row] = (await ctx.dataSource.query(
        'SELECT short_handed_since FROM video_calls WHERE id = $1',
        [callId],
      )) as { short_handed_since: Date | null }[];
      return row.short_handed_since;
    };

    // Cuộc gọi ACTIVE (khách đã nghe) — mốc thiếu người đang bật (P6).
    const activeCall = async () => {
      const { customer, provider, orderId } = await seed.pair();
      const created = await createCall(provider, orderId).expect(201);
      const callId = (created.body as { call: { id: string } }).call.id;
      await request(seed.http)
        .post(`${API}/video-calls/${callId}/join`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      return { customer, provider, callId };
    };

    it('401 WEBHOOK_UNAUTHORIZED: sai chữ ký / thiếu chữ ký', async () => {
      const { callId } = await activeCall();
      const wrong = await sendWebhook(
        event('call.session_participant_left', callId),
        'deadbeef',
      ).expect(401);
      expect((wrong.body as { message: string }).message).toBe(
        'WEBHOOK_UNAUTHORIZED',
      );
      await request(seed.http)
        .post(`${API}/video-calls/webhook`)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(event('call.session_participant_left', callId)))
        .expect(401);
    });

    it('không cần đăng nhập; đủ 2 bên có mặt → xóa mốc thiếu người', async () => {
      const { customer, provider, callId } = await activeCall();
      expect(await markOf(callId)).not.toBeNull(); // P6
      ctx.stream.participants.set(callId, [
        provider.accountId,
        customer.accountId,
        customer.accountId, // khách 2 máy vẫn là 1 bên
      ]);
      const res = await sendWebhook(
        event('call.session_participant_joined', callId),
      ).expect(200);
      expect(res.body).toEqual({ ok: true });
      expect(await markOf(callId)).toBeNull();
    });

    it('thiếu 1 bên → bật mốc; webhook sau không dời mốc cũ', async () => {
      const { customer, provider, callId } = await activeCall();
      ctx.stream.participants.set(callId, [
        provider.accountId,
        customer.accountId,
      ]);
      await sendWebhook(
        event('call.session_participant_joined', callId),
      ).expect(200);
      expect(await markOf(callId)).toBeNull();

      ctx.stream.participants.set(callId, [provider.accountId]);
      const before = Date.now();
      await sendWebhook(event('call.session_participant_left', callId)).expect(
        200,
      );
      const mark = await markOf(callId);
      expect(mark?.getTime()).toBeGreaterThanOrEqual(before - 1000);

      await sleep(50);
      await sendWebhook(event('call.session_ended', callId)).expect(200);
      expect(await markOf(callId)).toEqual(mark);
    });

    it('cuộc RINGING → bỏ qua (200, không bật mốc)', async () => {
      const { provider, orderId } = await seed.pair();
      const created = await createCall(provider, orderId).expect(201);
      const callId = (created.body as { call: { id: string } }).call.id;
      await sendWebhook(event('call.session_participant_left', callId)).expect(
        200,
      );
      expect(await markOf(callId)).toBeNull();
    });

    it('cid lạ / call type khác / loại sự kiện khác / cuộc không tồn tại → 200 { ok: true }, không đổi gì', async () => {
      const { customer, provider, callId } = await activeCall();
      ctx.stream.participants.set(callId, [
        provider.accountId,
        customer.accountId,
      ]);
      const before = await markOf(callId);
      for (const payload of [
        { type: 'call.session_participant_left', call_cid: 'rác' },
        event('call.session_participant_left', callId, 'default'),
        event('call.created', callId),
        event(
          'call.session_participant_left',
          '00000000-0000-4000-8000-000000000000',
        ),
      ]) {
        const res = await sendWebhook(payload).expect(200);
        expect(res.body).toEqual({ ok: true });
      }
      expect(await markOf(callId)).toEqual(before);
    });

    it('P19: GetStream lỗi + chưa có mốc → bật mốc', async () => {
      const { customer, provider, callId } = await activeCall();
      ctx.stream.participants.set(callId, [
        provider.accountId,
        customer.accountId,
      ]);
      await sendWebhook(
        event('call.session_participant_joined', callId),
      ).expect(200);
      expect(await markOf(callId)).toBeNull();
      ctx.stream.failPresence = true;
      await sendWebhook(event('call.session_participant_left', callId)).expect(
        200,
      );
      expect(await markOf(callId)).not.toBeNull();
    });
  });

  // ===================== Hết hạn + đơn bị đóng (S6b) =====================
  describe('Hết hạn (K10) + đơn bị đóng (L7, L8)', () => {
    const asUser = (user: SeededUser) => ({
      active: (orderId: string) =>
        request(seed.http)
          .get(`${API}/video-calls/active`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .query({ orderId }),
      history: (orderId: string) =>
        request(seed.http)
          .get(`${API}/video-calls`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .query({ orderId }),
      join: (callId: string) =>
        request(seed.http)
          .post(`${API}/video-calls/${callId}/join`)
          .set('Authorization', `Bearer ${user.accessToken}`),
    });
    const row = async (callId: string) => {
      const [r] = (await ctx.dataSource.query(
        `SELECT status, end_reason, ended_by, ended_at, created_at, answered_at,
                short_handed_since FROM video_calls WHERE id = $1`,
        [callId],
      )) as {
        status: string;
        end_reason: string | null;
        ended_by: string | null;
        ended_at: Date | null;
        created_at: Date;
        answered_at: Date | null;
        short_handed_since: Date | null;
      }[];
      return r;
    };
    const shift = (callId: string, column: string, seconds: number) =>
      ctx.dataSource.query(
        `UPDATE video_calls SET ${column} = ${column} - make_interval(secs => $2) WHERE id = $1`,
        [callId, seconds],
      );
    const setOrderStatus = (orderId: string, status: string) =>
      ctx.dataSource.query(
        'UPDATE service_orders SET status = $2 WHERE id = $1',
        [orderId, status],
      );

    // Cuộc gọi provider → khách; answered = khách đã nghe.
    const setup = async (answered: boolean) => {
      const { customer, provider, orderId } = await seed.pair();
      const res = await createCall(provider, orderId).expect(201);
      const callId = (res.body as { call: { id: string } }).call.id;
      if (answered) {
        await asUser(customer).join(callId).expect(200);
      }
      return { customer, provider, orderId, callId };
    };

    it('MISSED: đổ chuông quá 45s → ended_at = created_at + 45s; gọi lại được ngay', async () => {
      const { provider, orderId, callId } = await setup(false);
      await shift(callId, 'created_at', 46);
      const res = await asUser(provider).active(orderId).expect(200);
      expect(res.body).toEqual({ call: null });
      const r = await row(callId);
      expect(r.end_reason).toBe('MISSED');
      expect(r.ended_by).toBeNull();
      expect(r.ended_at!.getTime()).toBe(r.created_at.getTime() + 45_000);
      await createCall(provider, orderId).expect(201);
    });

    it('DROPPED: thiếu người quá 300s, GetStream báo thiếu → ended_at = mốc + 300s', async () => {
      const { provider, orderId, callId } = await setup(true);
      ctx.stream.participants.set(callId, [provider.accountId]);
      await shift(callId, 'short_handed_since', 301);
      await asUser(provider).active(orderId).expect(200);
      const r = await row(callId);
      expect(r.end_reason).toBe('DROPPED');
      expect(r.ended_at!.getTime()).toBe(
        r.short_handed_since!.getTime() + 300_000,
      );
    });

    it('không DROPPED khi GetStream báo đủ 2 bên → mốc bị xóa, vẫn ACTIVE', async () => {
      const { customer, provider, orderId, callId } = await setup(true);
      ctx.stream.participants.set(callId, [
        provider.accountId,
        customer.accountId,
      ]);
      await shift(callId, 'short_handed_since', 301);
      const res = await asUser(provider).active(orderId).expect(200);
      expect((res.body as { call: { status: string } }).call.status).toBe(
        'ACTIVE',
      );
      const r = await row(callId);
      expect(r.status).toBe('ACTIVE');
      expect(r.short_handed_since).toBeNull();
    });

    it('GetStream lỗi → không DROPPED; quá 60 phút → vẫn TIMEOUT tại answered_at + 3600s', async () => {
      const { provider, orderId, callId } = await setup(true);
      ctx.stream.failPresence = true;
      await shift(callId, 'short_handed_since', 400);
      await asUser(provider).active(orderId).expect(200);
      expect((await row(callId)).status).toBe('ACTIVE');

      await shift(callId, 'answered_at', 3601);
      const res = await asUser(provider).active(orderId).expect(200);
      expect(res.body).toEqual({ call: null });
      const r = await row(callId);
      expect(r.end_reason).toBe('TIMEOUT');
      expect(r.ended_at!.getTime()).toBe(r.answered_at!.getTime() + 3600_000);
    });

    it('TIMEOUT: đang nói quá 60 phút (đủ người) → ended_at = answered_at + 3600s, 2 bên nhận ended', async () => {
      const { customer, provider, orderId, callId } = await setup(true);
      const customerSocket = await seed.socket(customer.accessToken);
      ctx.stream.participants.set(callId, [
        provider.accountId,
        customer.accountId,
      ]);
      await shift(callId, 'answered_at', 3601);
      await asUser(provider).history(orderId).expect(200);
      const r = await row(callId);
      expect(r.end_reason).toBe('TIMEOUT');
      expect(r.ended_at!.getTime()).toBe(r.answered_at!.getTime() + 3600_000);
      expect(await customerSocket.waitFor('video_call.ended')).toMatchObject({
        callId,
        endReason: 'TIMEOUT',
      });
    });

    it('L7: đơn đóng lúc đang nói → vào lại 409, cuộc vẫn ACTIVE; một bên rời → DROPPED ngay, ended_at = mốc rời', async () => {
      const { customer, provider, orderId, callId } = await setup(true);
      ctx.stream.participants.set(callId, [
        provider.accountId,
        customer.accountId,
      ]);
      await setOrderStatus(orderId, 'CANCELLED');
      const rejoin = await asUser(provider).join(callId).expect(409);
      expect((rejoin.body as { message: string }).message).toBe(
        'ORDER_NOT_CALLABLE',
      );
      expect((await row(callId)).status).toBe('ACTIVE');

      // Khách rời: webhook bật mốc; request kế tiếp đóng DROPPED với thời gian chờ 0.
      ctx.stream.participants.set(callId, [provider.accountId]);
      const raw = JSON.stringify({
        type: 'call.session_participant_left',
        call_cid: `lancare_call:${callId}`,
      });
      await request(seed.http)
        .post(`${API}/video-calls/webhook`)
        .set('Content-Type', 'application/json')
        .set(
          'x-signature',
          createHmac('sha256', 'e2e-stream-secret').update(raw).digest('hex'),
        )
        .send(raw)
        .expect(200);
      const marked = await row(callId);
      expect(marked.short_handed_since).not.toBeNull();

      await asUser(provider).active(orderId).expect(200);
      const r = await row(callId);
      expect(r.end_reason).toBe('DROPPED');
      expect(r.ended_at).toEqual(marked.short_handed_since);
    });

    it('L8: đơn đóng lúc đổ chuông → active null, lịch sử CANCELLED + endedBy null, 2 bên nhận ended', async () => {
      const { customer, provider, orderId, callId } = await setup(false);
      const providerSocket = await seed.socket(provider.accessToken);
      const customerSocket = await seed.socket(customer.accessToken);
      await setOrderStatus(orderId, 'REJECTED');
      const res = await asUser(customer).active(orderId).expect(200);
      expect(res.body).toEqual({ call: null });
      const history = await asUser(customer).history(orderId).expect(200);
      expect((history.body as unknown[])[0]).toMatchObject({
        id: callId,
        status: 'ENDED',
        endReason: 'CANCELLED',
        endedBy: null,
      });
      for (const probe of [providerSocket, customerSocket]) {
        expect(await probe.waitFor('video_call.ended')).toMatchObject({
          callId,
          endReason: 'CANCELLED',
        });
      }
    });

    it('L8: khách bấm nghe sau khi đơn bị đóng → 409 ORDER_NOT_CALLABLE, cuộc đã CANCELLED', async () => {
      const { customer, orderId, callId } = await setup(false);
      await setOrderStatus(orderId, 'CANCELLED');
      const res = await asUser(customer).join(callId).expect(409);
      expect((res.body as { message: string }).message).toBe(
        'ORDER_NOT_CALLABLE',
      );
      expect((await row(callId)).end_reason).toBe('CANCELLED');
    });
  });

  // ===================== Socket /ws (K8, P1, P2) =====================
  describe('Socket /ws', () => {
    it('không Origin + access token đúng → kết nối được', async () => {
      const customer = await seed.customer();
      const probe = await seed.socket(customer.accessToken);
      expect(probe.socket.connected).toBe(true);
    });

    it('Origin nằm trong CORS_ORIGIN → kết nối được', async () => {
      const customer = await seed.customer();
      const probe = await seed.socket(customer.accessToken, {
        origin: 'http://localhost:3002',
      });
      expect(probe.socket.connected).toBe(true);
    });

    it('không token → connect_error UNAUTHORIZED', async () => {
      const err = await seed.socketError();
      expect(err.message).toBe('UNAUTHORIZED');
    });

    it('refresh token → connect_error UNAUTHORIZED', async () => {
      const customer = await seed.customer();
      const err = await seed.socketError(customer.refreshToken);
      expect(err.message).toBe('UNAUTHORIZED');
    });

    it('tài khoản SUSPENDED → connect_error UNAUTHORIZED', async () => {
      const customer = await seed.customer();
      await ctx.dataSource.query(
        `UPDATE accounts SET status = 'SUSPENDED' WHERE id = $1`,
        [customer.accountId],
      );
      const err = await seed.socketError(customer.accessToken);
      expect(err.message).toBe('UNAUTHORIZED');
    });

    it('Origin lạ (dù token đúng) → connect_error UNAUTHORIZED', async () => {
      const customer = await seed.customer();
      const err = await seed.socketError(customer.accessToken, {
        origin: 'https://evil.example',
      });
      expect(err.message).toBe('UNAUTHORIZED');
    });
  });
});
