import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoCall } from './entities/video-call.entity';
import { toVideoCallResponse } from './video-call.mapper';
import { VideoCallsService } from './video-calls.service';

// Mốc mặc định bản chốt §5.4.
const ENV = {
  VIDEO_CALL_RING_TIMEOUT_SECONDS: 45,
  VIDEO_CALL_RECONNECT_GRACE_SECONDS: 300,
  VIDEO_CALL_MAX_DURATION_SECONDS: 3600,
};
const T = { ringSeconds: 45, graceSeconds: 300, maxDurationSeconds: 3600 };

// Id cố ý để người nhận (b…) nhỏ hơn người gọi (c…) → kiểm khóa theo id tăng dần.
const CALLER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CALLEE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ORDER_ID = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const OTHER_ORDER = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';

const liveCall = (overrides: Partial<VideoCall> = {}): VideoCall =>
  ({
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    orderId: ORDER_ID,
    callerAccountId: CALLEE,
    calleeAccountId: CALLER,
    status: 'RINGING',
    endReason: null,
    endedBy: null,
    createdAt: new Date(),
    answeredAt: null,
    endedAt: null,
    shortHandedSince: null,
    callerDeviceSessionId: 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0',
    calleeDeviceSessionId: null,
    ...overrides,
  }) as VideoCall;

describe('VideoCallsService', () => {
  let manager: {
    query: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let calls: { find: jest.Mock };
  let orders: { findOne: jest.Mock };
  let customers: { findOne: jest.Mock };
  let providers: { findOne: jest.Mock };
  let accounts: { find: jest.Mock };
  let stream: {
    apiKey: string;
    callType: string;
    createCall: jest.Mock;
    endCall: jest.Mock;
    generateCallToken: jest.Mock;
    listPresentUserIds: jest.Mock;
  };
  let gateway: { emitToAccounts: jest.Mock };
  let service: VideoCallsService;

  beforeEach(() => {
    manager = {
      query: jest.fn().mockResolvedValue([]),
      find: jest.fn().mockResolvedValue([]),
      // Mặc định: không có cuộc gọi; đơn IN_CARE (settleExpiry đọc trạng thái đơn — K14).
      findOne: jest.fn((entity: unknown) =>
        Promise.resolve(
          entity === VideoCall ? null : { id: ORDER_ID, status: 'IN_CARE' },
        ),
      ),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
      save: jest.fn((entity: object) => Promise.resolve(entity)),
    };
    dataSource = {
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };
    calls = { find: jest.fn().mockResolvedValue([]) };
    // Đơn: khách = CALLEE (profile cust-1), provider = CALLER (profile prov-1).
    orders = {
      findOne: jest.fn().mockResolvedValue({
        id: ORDER_ID,
        customerId: 'cust-1',
        providerId: 'prov-1',
        status: 'IN_CARE',
      }),
    };
    customers = {
      findOne: jest.fn().mockResolvedValue({ id: 'cust-1', accountId: CALLEE }),
    };
    providers = {
      findOne: jest.fn().mockResolvedValue({ id: 'prov-1', accountId: CALLER }),
    };
    accounts = {
      find: jest.fn().mockResolvedValue([
        { id: CALLER, fullName: 'Vườn Lan' },
        { id: CALLEE, fullName: 'Khách Hoa' },
      ]),
    };
    stream = {
      apiKey: 'unit-key',
      callType: 'lancare_call',
      createCall: jest.fn().mockResolvedValue(undefined),
      endCall: jest.fn().mockResolvedValue(undefined),
      generateCallToken: jest.fn().mockReturnValue('call-token'),
      listPresentUserIds: jest.fn().mockResolvedValue([]),
    };
    gateway = { emitToAccounts: jest.fn() };
    service = new VideoCallsService(
      dataSource as never,
      calls as never,
      orders as never,
      customers as never,
      providers as never,
      accounts as never,
      stream as never,
      gateway as never,
      new ConfigService(ENV),
    );
  });

  // Tên các sự kiện socket đã gửi, theo thứ tự.
  const emittedEvents = () =>
    (gateway.emitToAccounts.mock.calls as [string[], string][]).map(
      ([, event]) => event,
    );

  // manager.findOne: VideoCall → cuộc gọi; ServiceOrder → đơn với trạng thái cho trước.
  const arrangeFindOne = (call: VideoCall | null, orderStatus = 'IN_CARE') =>
    manager.findOne.mockImplementation((entity: unknown) =>
      Promise.resolve(
        entity === VideoCall ? call : { id: ORDER_ID, status: orderStatus },
      ),
    );

  // Dòng cuộc gọi mới được insert (manager.save với status RINGING).
  const insertedCalls = () =>
    manager.save.mock.calls
      .map(([entity]) => entity as VideoCall)
      .filter((call) => call.status === 'RINGING');

  it('tạo thành công: GetStream đúng tham số, insert RINGING, đổ chuông người nhận, trả session', async () => {
    const session = await service.create(CALLER, ORDER_ID);

    expect(stream.createCall).toHaveBeenCalledWith(expect.any(String), {
      members: [
        { id: CALLER, name: 'Vườn Lan' },
        { id: CALLEE, name: 'Khách Hoa' },
      ],
      maxDurationSeconds: 3705, // P20: 3600 + 45 + 60
    });
    const [callId] = stream.createCall.mock.calls[0] as [string];
    const [inserted] = insertedCalls();
    expect(inserted).toMatchObject({
      id: callId,
      orderId: ORDER_ID,
      callerAccountId: CALLER,
      calleeAccountId: CALLEE,
      status: 'RINGING',
      endReason: null,
      endedBy: null,
      answeredAt: null,
      calleeDeviceSessionId: null,
    });
    expect(inserted.callerDeviceSessionId).toEqual(expect.any(String));

    expect(gateway.emitToAccounts).toHaveBeenCalledTimes(1);
    expect(gateway.emitToAccounts).toHaveBeenCalledWith(
      [CALLEE],
      'video_call.ringing',
      {
        callId,
        orderId: ORDER_ID,
        caller: { accountId: CALLER, fullName: 'Vườn Lan' },
        ringExpiresAt: new Date(
          inserted.createdAt.getTime() + 45_000,
        ).toISOString(),
      },
    );
    // K6, P20: token hiệu lực 45 + 3600 + 300.
    expect(stream.generateCallToken).toHaveBeenCalledWith(CALLER, callId, 3945);
    expect(session).toEqual({
      call: toVideoCallResponse(
        inserted,
        CALLER,
        new Map([
          [CALLER, 'Vườn Lan'],
          [CALLEE, 'Khách Hoa'],
        ]),
        T,
      ),
      stream: {
        apiKey: 'unit-key',
        callType: 'lancare_call',
        callId,
        token: 'call-token',
        userId: CALLER,
      },
      deviceSessionId: inserted.callerDeviceSessionId,
    });
  });

  it('P5/K13: created_at = lúc GetStream tạo xong (không phải lúc bắt đầu)', async () => {
    let doneAt = 0;
    stream.createCall.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      doneAt = Date.now();
    });
    await service.create(CALLER, ORDER_ID);
    const [inserted] = insertedCalls();
    expect(inserted.createdAt.getTime()).toBeGreaterThanOrEqual(doneAt);
  });

  it('P14: khóa advisory từng người theo id tăng dần, khóa dòng FOR UPDATE theo id', async () => {
    await service.create(CALLER, ORDER_ID);
    const lockCalls = manager.query.mock.calls as [string, string[]][];
    expect(lockCalls.map(([, params]) => params[0])).toEqual([CALLEE, CALLER]);
    expect(lockCalls[0][0]).toContain(
      "pg_advisory_xact_lock(hashtextextended('video_call:account:' || $1",
    );
    const [, findOptions] = manager.find.mock.calls[0] as [unknown, object];
    expect(findOptions).toMatchObject({
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    // Khóa người trước, đọc dòng sau.
    expect(manager.query.mock.invocationCallOrder[1]).toBeLessThan(
      manager.find.mock.invocationCallOrder[0],
    );
  });

  describe('404 / 409 trước transaction (P9 bước 1, 2)', () => {
    it('đơn không tồn tại → 404 ORDER_NOT_FOUND', async () => {
      orders.findOne.mockResolvedValue(null);
      await expect(service.create(CALLER, ORDER_ID)).rejects.toThrow(
        new NotFoundException('ORDER_NOT_FOUND'),
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('không phải bên của đơn → 404 ORDER_NOT_FOUND (kể cả đơn DRAFT — kiểm bên trước)', async () => {
      orders.findOne.mockResolvedValue({
        id: ORDER_ID,
        customerId: 'cust-1',
        providerId: 'prov-1',
        status: 'DRAFT',
      });
      await expect(service.create(OTHER, ORDER_ID)).rejects.toThrow(
        new NotFoundException('ORDER_NOT_FOUND'),
      );
    });

    it.each(['DRAFT', 'CANCELLED', 'REJECTED'])(
      'đơn %s → 409 ORDER_NOT_CALLABLE, không mở transaction',
      async (status) => {
        orders.findOne.mockResolvedValue({
          id: ORDER_ID,
          customerId: 'cust-1',
          providerId: 'prov-1',
          status,
        });
        await expect(service.create(CALLER, ORDER_ID)).rejects.toThrow(
          new ConflictException('ORDER_NOT_CALLABLE'),
        );
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it.each([
      'PENDING_PROVIDER',
      'AGREEMENT_PENDING',
      'AWAITING_PAYMENT',
      'PAID',
      'HANDOVER_IN_PROGRESS',
      'HANDOVER_AWAITING_CONFIRM',
      'IN_CARE',
    ])(
      'đơn %s (B2) → gọi được, khách gọi provider cũng được',
      async (status) => {
        orders.findOne.mockResolvedValue({
          id: ORDER_ID,
          customerId: 'cust-1',
          providerId: 'prov-1',
          status,
        });
        await service.create(CALLEE, ORDER_ID);
        expect(insertedCalls()[0]).toMatchObject({
          callerAccountId: CALLEE,
          calleeAccountId: CALLER,
        });
      },
    );
  });

  describe('409 trong transaction (P9 bước 3) — không gọi GetStream, không insert, không đổ chuông', () => {
    it.each<[string, VideoCall[], string]>([
      [
        'đơn đang có cuộc gọi sống',
        [liveCall({ orderId: ORDER_ID })],
        'VIDEO_CALL_IN_PROGRESS',
      ],
      [
        'người gọi đang ở cuộc gọi khác',
        [
          liveCall({
            orderId: OTHER_ORDER,
            callerAccountId: CALLER,
            calleeAccountId: OTHER,
          }),
        ],
        'CALLER_BUSY',
      ],
      [
        'người nhận đang ở cuộc gọi khác',
        [
          liveCall({
            orderId: OTHER_ORDER,
            callerAccountId: OTHER,
            calleeAccountId: CALLEE,
            status: 'ACTIVE',
            answeredAt: new Date(),
          }),
        ],
        'CALLEE_BUSY',
      ],
      [
        'thứ tự: đơn này có cuộc sống + 2 người bận → VIDEO_CALL_IN_PROGRESS',
        [
          liveCall({
            id: '1',
            orderId: OTHER_ORDER,
            callerAccountId: CALLER,
            calleeAccountId: OTHER,
          }),
          liveCall({ id: '2', orderId: ORDER_ID }),
        ],
        'VIDEO_CALL_IN_PROGRESS',
      ],
      [
        'thứ tự: cả 2 người bận ở 2 đơn khác → CALLER_BUSY',
        [
          liveCall({
            id: '1',
            orderId: OTHER_ORDER,
            callerAccountId: OTHER,
            calleeAccountId: CALLEE,
          }),
          liveCall({
            id: '2',
            orderId: OTHER_ORDER,
            callerAccountId: CALLER,
            calleeAccountId: OTHER,
          }),
        ],
        'CALLER_BUSY',
      ],
    ])('%s → 409 %s', async (_name, live, code) => {
      manager.find.mockResolvedValue(live);
      await expect(service.create(CALLER, ORDER_ID)).rejects.toThrow(
        new ConflictException(code),
      );
      expect(stream.createCall).not.toHaveBeenCalled();
      expect(insertedCalls()).toHaveLength(0);
      expect(gateway.emitToAccounts).not.toHaveBeenCalled();
    });
  });

  describe('dọn hết hạn trước khi kiểm (K10, K12, P13)', () => {
    it('cuộc cũ của đơn đổ chuông quá 45s → đóng MISSED tại mốc, rồi tạo cuộc mới; sau commit end GetStream + báo ended', async () => {
      const created = new Date(Date.now() - 46_000);
      const old = liveCall({ createdAt: created });
      manager.find.mockResolvedValue([old]);

      await service.create(CALLER, ORDER_ID);

      expect(old).toMatchObject({
        status: 'ENDED',
        endReason: 'MISSED',
        endedBy: null,
        endedAt: new Date(created.getTime() + 45_000),
      });
      expect(manager.save).toHaveBeenCalledWith(old);
      expect(insertedCalls()).toHaveLength(1);
      expect(stream.endCall).toHaveBeenCalledWith(old.id);
      expect(gateway.emitToAccounts).toHaveBeenCalledWith(
        [old.callerAccountId, old.calleeAccountId],
        'video_call.ended',
        {
          callId: old.id,
          endReason: 'MISSED',
          endedAt: new Date(created.getTime() + 45_000).toISOString(),
        },
      );
      // ended gửi trước ringing của cuộc mới.
      expect(emittedEvents()).toEqual([
        'video_call.ended',
        'video_call.ringing',
      ]);
    });

    it('người gọi đang nói quá 60 phút ở đơn khác → đóng TIMEOUT, không còn bận', async () => {
      const answered = new Date(Date.now() - 3601_000);
      const old = liveCall({
        orderId: OTHER_ORDER,
        callerAccountId: CALLER,
        calleeAccountId: OTHER,
        status: 'ACTIVE',
        answeredAt: answered,
      });
      manager.find.mockResolvedValue([old]);
      await service.create(CALLER, ORDER_ID);
      expect(old).toMatchObject({
        status: 'ENDED',
        endReason: 'TIMEOUT',
        endedAt: new Date(answered.getTime() + 3600_000),
      });
      expect(insertedCalls()).toHaveLength(1);
    });

    it('P13: vừa đóng cuộc hết hạn mà vẫn bận vì cuộc khác → phần đóng vẫn được hậu xử lý, rồi mới 409', async () => {
      const expired = liveCall({
        id: '1',
        orderId: OTHER_ORDER,
        callerAccountId: OTHER,
        calleeAccountId: CALLER,
        createdAt: new Date(Date.now() - 60_000),
      });
      const busy = liveCall({
        id: '2',
        orderId: OTHER_ORDER,
        callerAccountId: OTHER,
        calleeAccountId: CALLEE,
      });
      manager.find.mockResolvedValue([expired, busy]);
      await expect(service.create(CALLER, ORDER_ID)).rejects.toThrow(
        new ConflictException('CALLEE_BUSY'),
      );
      expect(expired.status).toBe('ENDED');
      expect(stream.endCall).toHaveBeenCalledWith('1');
      expect(gateway.emitToAccounts).toHaveBeenCalledWith(
        [OTHER, CALLER],
        'video_call.ended',
        expect.objectContaining({ callId: '1', endReason: 'MISSED' }),
      );
    });

    it('S6b: người gọi rớt ở đơn khác quá 5 phút, GetStream xác nhận vẫn thiếu → DROPPED tại mốc + 300s, hết bận', async () => {
      const mark = new Date(Date.now() - 900_000);
      const old = liveCall({
        orderId: OTHER_ORDER,
        callerAccountId: CALLER,
        calleeAccountId: OTHER,
        status: 'ACTIVE',
        answeredAt: new Date(Date.now() - 1000_000),
        shortHandedSince: mark,
      });
      manager.find.mockResolvedValue([old]);
      stream.listPresentUserIds.mockResolvedValue([OTHER]);
      await service.create(CALLER, ORDER_ID);
      expect(old).toMatchObject({
        status: 'ENDED',
        endReason: 'DROPPED',
        endedAt: new Date(mark.getTime() + 300_000),
      });
      expect(insertedCalls()).toHaveLength(1);
    });

    it('S6b: mốc thiếu người quá hạn nhưng GetStream báo đủ 2 bên → xóa mốc, không đóng → vẫn bận', async () => {
      const old = liveCall({
        orderId: OTHER_ORDER,
        callerAccountId: CALLER,
        calleeAccountId: OTHER,
        status: 'ACTIVE',
        answeredAt: new Date(Date.now() - 1000_000),
        shortHandedSince: new Date(Date.now() - 900_000),
      });
      manager.find.mockResolvedValue([old]);
      stream.listPresentUserIds.mockResolvedValue([CALLER, OTHER]);
      await expect(service.create(CALLER, ORDER_ID)).rejects.toThrow(
        new ConflictException('CALLER_BUSY'),
      );
      expect(old.status).toBe('ACTIVE');
      expect(old.shortHandedSince).toBeNull();
      expect(manager.save).toHaveBeenCalledWith(old);
    });

    it('P21: end GetStream lỗi khi hậu xử lý → chỉ log, vẫn tạo cuộc mới', async () => {
      stream.endCall.mockRejectedValue(new Error('network'));
      manager.find.mockResolvedValue([
        liveCall({ createdAt: new Date(Date.now() - 46_000) }),
      ]);
      await expect(service.create(CALLER, ORDER_ID)).resolves.toBeDefined();
      expect(insertedCalls()).toHaveLength(1);
    });
  });

  it('GetStream lỗi → 502 VIDEO_PROVIDER_UNAVAILABLE, không insert, không đổ chuông; phần dọn vẫn hậu xử lý', async () => {
    stream.createCall.mockRejectedValue(new Error('timeout'));
    const old = liveCall({ createdAt: new Date(Date.now() - 46_000) });
    manager.find.mockResolvedValue([old]);
    await expect(service.create(CALLER, ORDER_ID)).rejects.toThrow(
      new BadGatewayException('VIDEO_PROVIDER_UNAVAILABLE'),
    );
    expect(insertedCalls()).toHaveLength(0);
    expect(emittedEvents()).toEqual(['video_call.ended']);
  });

  it('vướng unique index (23505) → 409 VIDEO_CALL_IN_PROGRESS, không hậu xử lý gì', async () => {
    dataSource.transaction.mockRejectedValue(
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );
    await expect(service.create(CALLER, ORDER_ID)).rejects.toThrow(
      new ConflictException('VIDEO_CALL_IN_PROGRESS'),
    );
    expect(gateway.emitToAccounts).not.toHaveBeenCalled();
    expect(stream.endCall).not.toHaveBeenCalled();
  });

  it('lỗi DB khác → ném nguyên lỗi (Nest trả 500)', async () => {
    dataSource.transaction.mockRejectedValue(new Error('connection lost'));
    await expect(service.create(CALLER, ORDER_ID)).rejects.toThrow(
      'connection lost',
    );
  });

  // ===================== S4b — xem =====================
  describe('getActive (S4b)', () => {
    it('đơn không có cuộc sống → { call: null }', async () => {
      await expect(service.getActive(CALLER, ORDER_ID)).resolves.toEqual({
        call: null,
      });
      expect(manager.findOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('đang đổ chuông → trả cuộc gọi nhìn từ người hỏi (người nhận: myRole CALLEE)', async () => {
      const call = liveCall({
        callerAccountId: CALLER,
        calleeAccountId: CALLEE,
      });
      arrangeFindOne(call);
      const res = await service.getActive(CALLEE, ORDER_ID);
      expect(res.call).toMatchObject({
        id: call.id,
        status: 'RINGING',
        myRole: 'CALLEE',
      });
    });

    it('K10: cuộc sống đã quá hạn → đóng MISSED, trả null, hậu xử lý (end + ended)', async () => {
      const call = liveCall({ createdAt: new Date(Date.now() - 50_000) });
      arrangeFindOne(call);
      await expect(service.getActive(CALLER, ORDER_ID)).resolves.toEqual({
        call: null,
      });
      expect(call).toMatchObject({ status: 'ENDED', endReason: 'MISSED' });
      expect(stream.endCall).toHaveBeenCalledWith(call.id);
      expect(emittedEvents()).toEqual(['video_call.ended']);
    });

    it('người ngoài đơn → 404 ORDER_NOT_FOUND', async () => {
      await expect(service.getActive(OTHER, ORDER_ID)).rejects.toThrow(
        new NotFoundException('ORDER_NOT_FOUND'),
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('listHistory (S4b)', () => {
    it('P15: mọi cuộc gọi của đơn, created_at giảm dần, tối đa 50; dọn cuộc sống trước khi đọc', async () => {
      const older = liveCall({
        id: '1',
        callerAccountId: CALLER,
        calleeAccountId: CALLEE,
        status: 'ENDED',
        endReason: 'DECLINED',
        endedBy: CALLEE,
        endedAt: new Date(),
      });
      const newer = liveCall({
        id: '2',
        callerAccountId: CALLEE,
        calleeAccountId: CALLER,
      });
      calls.find.mockResolvedValue([newer, older]);
      const res = await service.listHistory(CALLER, ORDER_ID);
      expect(calls.find).toHaveBeenCalledWith({
        where: { orderId: ORDER_ID },
        order: { createdAt: 'DESC' },
        take: 50,
      });
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(
        calls.find.mock.invocationCallOrder[0],
      );
      expect(res.map((c) => [c.id, c.myRole, c.endedBy])).toEqual([
        ['2', 'CALLEE', null],
        ['1', 'CALLER', 'CALLEE'],
      ]);
    });

    it('người ngoài đơn → 404 ORDER_NOT_FOUND', async () => {
      await expect(service.listHistory(OTHER, ORDER_ID)).rejects.toThrow(
        new NotFoundException('ORDER_NOT_FOUND'),
      );
      expect(calls.find).not.toHaveBeenCalled();
    });
  });

  // ===================== S5a — nghe, vào lại, chuyển máy =====================
  describe('join (S5a)', () => {
    // manager.findOne: VideoCall → cuộc gọi đang khóa; ServiceOrder → đơn (trạng thái).
    const arrange = (call: VideoCall | null, orderStatus = 'IN_CARE') => {
      manager.findOne.mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === VideoCall ? call : { id: ORDER_ID, status: orderStatus },
        ),
      );
    };
    const ringingCall = () =>
      liveCall({
        callerAccountId: CALLER,
        calleeAccountId: CALLEE,
        callerDeviceSessionId: 'caller-old',
      });
    const activeCall = () =>
      liveCall({
        callerAccountId: CALLER,
        calleeAccountId: CALLEE,
        status: 'ACTIVE',
        answeredAt: new Date(Date.now() - 60_000),
        callerDeviceSessionId: 'caller-old',
        calleeDeviceSessionId: 'callee-old',
      });

    it.each<[string, VideoCall | null, string]>([
      ['cuộc gọi không tồn tại', null, CALLER],
      ['người ngoài cuộc gọi', ringingCall(), OTHER],
    ])('%s → 404 VIDEO_CALL_NOT_FOUND', async (_name, call, who) => {
      arrange(call);
      await expect(service.join(who, 'any-id')).rejects.toThrow(
        new NotFoundException('VIDEO_CALL_NOT_FOUND'),
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('P6: người nhận nghe → ACTIVE, answered_at = short_handed_since = now, phiên người nhận mới; accepted tới 2 room (P8)', async () => {
      const call = ringingCall();
      arrange(call);
      const before = Date.now();
      const session = await service.join(CALLEE, call.id);

      expect(call.status).toBe('ACTIVE');
      expect(call.answeredAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(call.shortHandedSince).toEqual(call.answeredAt);
      expect(call.calleeDeviceSessionId).toBe(session.deviceSessionId);
      expect(call.callerDeviceSessionId).toBe('caller-old');
      expect(manager.save).toHaveBeenCalledWith(call);
      expect(gateway.emitToAccounts).toHaveBeenCalledTimes(1);
      expect(gateway.emitToAccounts).toHaveBeenCalledWith(
        [CALLER, CALLEE],
        'video_call.accepted',
        { callId: call.id, deviceSessionId: session.deviceSessionId },
      );
      expect(session.call).toMatchObject({
        status: 'ACTIVE',
        myRole: 'CALLEE',
      });
      expect(stream.generateCallToken).toHaveBeenCalledWith(
        CALLEE,
        call.id,
        3945,
      );
    });

    it.each<['CALLER' | 'CALLEE', string, string]>([
      ['CALLER', CALLER, 'caller-old'],
      ['CALLEE', CALLEE, 'callee-old'],
    ])(
      'L6: %s vào lại lúc đang nói → phiên mới, vẫn ACTIVE, moved chỉ tới room người đó (P7)',
      async (role, who, oldSession) => {
        const call = activeCall();
        const answeredAt = call.answeredAt;
        arrange(call);
        const session = await service.join(who, call.id);

        expect(session.deviceSessionId).not.toBe(oldSession);
        expect(
          role === 'CALLER'
            ? call.callerDeviceSessionId
            : call.calleeDeviceSessionId,
        ).toBe(session.deviceSessionId);
        expect(call.status).toBe('ACTIVE');
        expect(call.answeredAt).toBe(answeredAt);
        expect(gateway.emitToAccounts).toHaveBeenCalledTimes(1);
        expect(gateway.emitToAccounts).toHaveBeenCalledWith(
          [who],
          'video_call.moved',
          { callId: call.id, deviceSessionId: session.deviceSessionId },
        );
      },
    );

    it('P7: người gọi vào lại lúc còn đổ chuông → REJOIN (vẫn RINGING), moved tới room người gọi', async () => {
      const call = ringingCall();
      arrange(call);
      const session = await service.join(CALLER, call.id);
      expect(call.status).toBe('RINGING');
      expect(call.answeredAt).toBeNull();
      expect(call.callerDeviceSessionId).toBe(session.deviceSessionId);
      expect(emittedEvents()).toEqual(['video_call.moved']);
    });

    it('P7: chưa có phiên cũ → không gửi moved', async () => {
      const call = Object.assign(activeCall(), {
        calleeDeviceSessionId: null,
      });
      arrange(call);
      await service.join(CALLEE, call.id);
      expect(gateway.emitToAccounts).not.toHaveBeenCalled();
    });

    it('L9: cuộc đã kết thúc → 409 VIDEO_CALL_ENDED, không ghi gì', async () => {
      const call = Object.assign(activeCall(), {
        status: 'ENDED',
        endReason: 'COMPLETED',
        endedAt: new Date(),
      });
      arrange(call);
      await expect(service.join(CALLEE, call.id)).rejects.toThrow(
        new ConflictException('VIDEO_CALL_ENDED'),
      );
      expect(manager.save).not.toHaveBeenCalled();
      expect(gateway.emitToAccounts).not.toHaveBeenCalled();
    });

    it('P16: cuộc vừa hết hạn (đổ chuông quá 45s) → đóng MISSED, hậu xử lý, rồi 409 VIDEO_CALL_ENDED', async () => {
      const call = Object.assign(ringingCall(), {
        createdAt: new Date(Date.now() - 50_000),
      });
      arrange(call);
      await expect(service.join(CALLEE, call.id)).rejects.toThrow(
        new ConflictException('VIDEO_CALL_ENDED'),
      );
      expect(call).toMatchObject({ status: 'ENDED', endReason: 'MISSED' });
      expect(stream.endCall).toHaveBeenCalledWith(call.id);
      expect(emittedEvents()).toEqual(['video_call.ended']);
    });

    it('L7: đơn đã đóng lúc đang nói → 409 ORDER_NOT_CALLABLE, cuộc gọi vẫn ACTIVE, không cấp phiên', async () => {
      const call = activeCall();
      arrange(call, 'CANCELLED');
      await expect(service.join(CALLER, call.id)).rejects.toThrow(
        new ConflictException('ORDER_NOT_CALLABLE'),
      );
      expect(call.status).toBe('ACTIVE');
      expect(call.callerDeviceSessionId).toBe('caller-old');
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  // ===================== S5b — từ chối, cúp =====================
  describe('decline / end (S5b)', () => {
    const arrange = (call: VideoCall | null) => {
      manager.findOne.mockImplementation((entity: unknown) =>
        Promise.resolve(
          entity === VideoCall ? call : { id: ORDER_ID, status: 'IN_CARE' },
        ),
      );
    };
    const ringingCall = () =>
      liveCall({ callerAccountId: CALLER, calleeAccountId: CALLEE });
    const activeCall = () =>
      liveCall({
        callerAccountId: CALLER,
        calleeAccountId: CALLEE,
        status: 'ACTIVE',
        answeredAt: new Date(Date.now() - 125_000),
      });

    // Hậu xử lý đúng 1 lần: end GetStream + ended tới 2 room.
    const expectEndedOnce = (call: VideoCall) => {
      expect(stream.endCall).toHaveBeenCalledTimes(1);
      expect(stream.endCall).toHaveBeenCalledWith(call.id);
      expect(gateway.emitToAccounts).toHaveBeenCalledTimes(1);
      expect(gateway.emitToAccounts).toHaveBeenCalledWith(
        [CALLER, CALLEE],
        'video_call.ended',
        {
          callId: call.id,
          endReason: call.endReason,
          endedAt: call.endedAt!.toISOString(),
        },
      );
    };

    it('decline: người nhận từ chối lúc đổ chuông → DECLINED, ended_by = người nhận, ended tới 2 bên', async () => {
      const call = ringingCall();
      arrange(call);
      const res = await service.decline(CALLEE, call.id);
      expect(call).toMatchObject({
        status: 'ENDED',
        endReason: 'DECLINED',
        endedBy: CALLEE,
      });
      expect(res).toMatchObject({
        status: 'ENDED',
        endReason: 'DECLINED',
        endedBy: 'CALLEE',
        myRole: 'CALLEE',
      });
      expectEndedOnce(call);
    });

    it('decline: người gọi → 403 ONLY_CALLEE_CAN_DECLINE, không đóng', async () => {
      const call = ringingCall();
      arrange(call);
      await expect(service.decline(CALLER, call.id)).rejects.toThrow(
        new ForbiddenException('ONLY_CALLEE_CAN_DECLINE'),
      );
      expect(call.status).toBe('RINGING');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('decline: cuộc đang nói → 409 VIDEO_CALL_NOT_RINGING', async () => {
      const call = activeCall();
      arrange(call);
      await expect(service.decline(CALLEE, call.id)).rejects.toThrow(
        new ConflictException('VIDEO_CALL_NOT_RINGING'),
      );
      expect(call.status).toBe('ACTIVE');
    });

    it('P16: decline cuộc vừa hết hạn → đóng MISSED (hậu xử lý) rồi 409 VIDEO_CALL_NOT_RINGING', async () => {
      const call = Object.assign(ringingCall(), {
        createdAt: new Date(Date.now() - 50_000),
      });
      arrange(call);
      await expect(service.decline(CALLEE, call.id)).rejects.toThrow(
        new ConflictException('VIDEO_CALL_NOT_RINGING'),
      );
      expect(call).toMatchObject({ endReason: 'MISSED', endedBy: null });
      expectEndedOnce(call);
    });

    it('decline: người ngoài → 404', async () => {
      arrange(ringingCall());
      await expect(service.decline(OTHER, 'x')).rejects.toThrow(
        new NotFoundException('VIDEO_CALL_NOT_FOUND'),
      );
    });

    it.each<[string, () => VideoCall, string, string, 'CALLER' | 'CALLEE']>([
      [
        'người gọi hủy lúc đổ chuông',
        ringingCall,
        CALLER,
        'CANCELLED',
        'CALLER',
      ],
      [
        'người nhận bấm kết thúc lúc đổ chuông',
        ringingCall,
        CALLEE,
        'DECLINED',
        'CALLEE',
      ],
      ['người gọi cúp lúc đang nói', activeCall, CALLER, 'COMPLETED', 'CALLER'],
      [
        'người nhận cúp lúc đang nói',
        activeCall,
        CALLEE,
        'COMPLETED',
        'CALLEE',
      ],
    ])(
      'end: %s → %s, ended_by đúng người, ended_at = now',
      async (_name, factory, who, reason, endedByRole) => {
        const call = factory();
        arrange(call);
        const before = Date.now();
        const res = await service.end(who, call.id);
        expect(call).toMatchObject({
          status: 'ENDED',
          endReason: reason,
          endedBy: who,
        });
        expect(call.endedAt!.getTime()).toBeGreaterThanOrEqual(before);
        expect(res).toMatchObject({ endReason: reason, endedBy: endedByRole });
        expectEndedOnce(call);
      },
    );

    it('end: cúp lúc đang nói → durationSeconds = ended − answered', async () => {
      const call = activeCall();
      arrange(call);
      const res = await service.end(CALLER, call.id);
      expect(res.durationSeconds).toBeGreaterThanOrEqual(125);
      expect(res.durationSeconds).toBeLessThan(130);
    });

    it('P16: end cuộc đã ENDED → trả nguyên trạng 200, không ghi, không hậu xử lý', async () => {
      const endedAt = new Date(Date.now() - 10_000);
      const call = Object.assign(activeCall(), {
        status: 'ENDED',
        endReason: 'COMPLETED',
        endedBy: CALLEE,
        endedAt,
      });
      arrange(call);
      const res = await service.end(CALLER, call.id);
      expect(res).toMatchObject({
        status: 'ENDED',
        endReason: 'COMPLETED',
        endedBy: 'CALLEE',
        endedAt: endedAt.toISOString(),
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(stream.endCall).not.toHaveBeenCalled();
      expect(gateway.emitToAccounts).not.toHaveBeenCalled();
    });

    it('P16: end cuộc vừa hết hạn trong request này → đóng TIMEOUT tại mốc, trả 200 nguyên trạng mới', async () => {
      const answeredAt = new Date(Date.now() - 3700_000);
      const call = Object.assign(activeCall(), { answeredAt });
      arrange(call);
      const res = await service.end(CALLER, call.id);
      expect(res).toMatchObject({
        endReason: 'TIMEOUT',
        endedBy: null,
        endedAt: new Date(answeredAt.getTime() + 3600_000).toISOString(),
      });
      expectEndedOnce(call);
    });

    it('P21: end GetStream lỗi → vẫn trả 200 + vẫn báo ended', async () => {
      stream.endCall.mockRejectedValue(new Error('network'));
      const call = activeCall();
      arrange(call);
      await expect(service.end(CALLER, call.id)).resolves.toMatchObject({
        endReason: 'COMPLETED',
      });
      expect(emittedEvents()).toEqual(['video_call.ended']);
    });
  });

  // ===================== S6a — webhook: ai còn trong cuộc gọi =====================
  describe('syncPresence (S6a)', () => {
    const OLD_MARK = new Date(Date.now() - 60_000);
    const activeCall = (shortHandedSince: Date | null) =>
      liveCall({
        callerAccountId: CALLER,
        calleeAccountId: CALLEE,
        status: 'ACTIVE',
        answeredAt: new Date(Date.now() - 120_000),
        shortHandedSince,
      });

    it.each<[string, Date | null, string[], 'null' | 'now' | 'old']>([
      ['đủ 2 bên, đang có mốc → xóa mốc', OLD_MARK, [CALLER, CALLEE], 'null'],
      [
        '1 người 2 máy + bên kia → đủ 2 bên',
        OLD_MARK,
        [CALLER, CALLER, CALLEE],
        'null',
      ],
      ['thiếu 1 bên, chưa có mốc → bật mốc = now', null, [CALLER], 'now'],
      ['không còn ai, chưa có mốc → bật mốc', null, [], 'now'],
      [
        'thiếu 1 bên, đã có mốc → giữ mốc cũ (không dời)',
        OLD_MARK,
        [CALLEE],
        'old',
      ],
      ['user lạ không tính là 1 bên', null, [CALLER, 'stranger'], 'now'],
    ])('%s', async (_name, mark, present, expected) => {
      const call = activeCall(mark);
      arrangeFindOne(call);
      stream.listPresentUserIds.mockResolvedValue(present);
      const before = Date.now();
      await service.syncPresence(call.id);

      expect(stream.listPresentUserIds).toHaveBeenCalledWith(call.id);
      if (expected === 'null') {
        expect(call.shortHandedSince).toBeNull();
      } else if (expected === 'old') {
        expect(call.shortHandedSince).toBe(OLD_MARK);
      } else {
        expect(call.shortHandedSince!.getTime()).toBeGreaterThanOrEqual(before);
      }
      // Chỉ ghi khi mốc đổi.
      expect(manager.save).toHaveBeenCalledTimes(expected === 'old' ? 0 : 1);
    });

    it('đủ 2 bên và chưa có mốc → không ghi gì', async () => {
      const call = activeCall(null);
      arrangeFindOne(call);
      stream.listPresentUserIds.mockResolvedValue([CALLER, CALLEE]);
      await service.syncPresence(call.id);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it.each<[string, VideoCall | null]>([
      ['cuộc gọi không tồn tại', null],
      ['cuộc RINGING', liveCall({ status: 'RINGING' })],
      [
        'cuộc ENDED',
        liveCall({ status: 'ENDED', endReason: 'MISSED', endedAt: new Date() }),
      ],
    ])('P17: %s → bỏ qua, không hỏi GetStream', async (_name, call) => {
      arrangeFindOne(call);
      await service.syncPresence('x');
      expect(stream.listPresentUserIds).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('P19: GetStream lỗi + chưa có mốc → bật mốc = now (không bỏ qua webhook)', async () => {
      const call = activeCall(null);
      arrangeFindOne(call);
      stream.listPresentUserIds.mockRejectedValue(new Error('timeout'));
      await service.syncPresence(call.id);
      expect(call.shortHandedSince).toBeInstanceOf(Date);
      expect(manager.save).toHaveBeenCalledWith(call);
    });

    it('P19: GetStream lỗi + đã có mốc → giữ mốc, không ghi', async () => {
      const call = activeCall(OLD_MARK);
      arrangeFindOne(call);
      stream.listPresentUserIds.mockRejectedValue(new Error('timeout'));
      await service.syncPresence(call.id);
      expect(call.shortHandedSince).toBe(OLD_MARK);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('K10: cuộc đã quá 60 phút → đóng TIMEOUT tại mốc + hậu xử lý, không hỏi GetStream', async () => {
      const answeredAt = new Date(Date.now() - 3700_000);
      const call = Object.assign(activeCall(null), { answeredAt });
      arrangeFindOne(call);
      await service.syncPresence(call.id);
      expect(call).toMatchObject({
        status: 'ENDED',
        endReason: 'TIMEOUT',
        endedAt: new Date(answeredAt.getTime() + 3600_000),
      });
      expect(stream.listPresentUserIds).not.toHaveBeenCalled();
      expect(emittedEvents()).toEqual(['video_call.ended']);
    });
  });

  // ===================== S6b — rớt / quá giờ / đơn bị đóng =====================
  describe('settleExpiry mở rộng (S6b)', () => {
    const active = (opts: { answeredAgo: number; markAgo: number | null }) =>
      liveCall({
        callerAccountId: CALLER,
        calleeAccountId: CALLEE,
        status: 'ACTIVE',
        answeredAt: new Date(Date.now() - opts.answeredAgo * 1000),
        shortHandedSince:
          opts.markAgo === null
            ? null
            : new Date(Date.now() - opts.markAgo * 1000),
      });

    afterEach(() => jest.restoreAllMocks());

    it('L3: thiếu người quá 300s, GetStream xác nhận vẫn thiếu → DROPPED, ended_at = mốc + 300s', async () => {
      const call = active({ answeredAgo: 400, markAgo: 301 });
      arrangeFindOne(call);
      stream.listPresentUserIds.mockResolvedValue([CALLER]);
      await expect(service.getActive(CALLER, ORDER_ID)).resolves.toEqual({
        call: null,
      });
      expect(call).toMatchObject({
        status: 'ENDED',
        endReason: 'DROPPED',
        endedBy: null,
        endedAt: new Date(call.shortHandedSince!.getTime() + 300_000),
      });
      expect(emittedEvents()).toEqual(['video_call.ended']);
    });

    it('chưa tới 300s → không hỏi GetStream, không đóng', async () => {
      const call = active({ answeredAgo: 400, markAgo: 299 });
      arrangeFindOne(call);
      await service.getActive(CALLER, ORDER_ID);
      expect(stream.listPresentUserIds).not.toHaveBeenCalled();
      expect(call.status).toBe('ACTIVE');
    });

    it('K10b-1: GetStream lỗi → không đóng DROPPED (giữ mốc), nhưng vẫn đóng TIMEOUT nếu quá giờ', async () => {
      stream.listPresentUserIds.mockRejectedValue(new Error('timeout'));
      const notYet = active({ answeredAgo: 400, markAgo: 350 });
      arrangeFindOne(notYet);
      await service.getActive(CALLER, ORDER_ID);
      expect(notYet.status).toBe('ACTIVE');
      expect(notYet.shortHandedSince).not.toBeNull();

      const overtime = active({ answeredAgo: 3700, markAgo: 3650 });
      arrangeFindOne(overtime);
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 20_000); // qua thời gian nghỉ
      await service.getActive(CALLER, ORDER_ID);
      expect(overtime).toMatchObject({ status: 'ENDED', endReason: 'TIMEOUT' });
    });

    it('P18: hỏi GetStream lỗi → 10 giây sau không hỏi lại cuộc đó (coi như không biết); quá 10 giây thì hỏi lại', async () => {
      const call = active({ answeredAgo: 400, markAgo: 350 });
      arrangeFindOne(call);
      stream.listPresentUserIds.mockRejectedValueOnce(new Error('timeout'));
      const t0 = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(t0);
      await service.getActive(CALLER, ORDER_ID);
      clock.mockReturnValue(t0 + 9_999);
      await service.getActive(CALLER, ORDER_ID);
      expect(stream.listPresentUserIds).toHaveBeenCalledTimes(1);
      expect(call.status).toBe('ACTIVE');

      stream.listPresentUserIds.mockResolvedValue([CALLEE]);
      clock.mockReturnValue(t0 + 10_000);
      await service.getActive(CALLER, ORDER_ID);
      expect(stream.listPresentUserIds).toHaveBeenCalledTimes(2);
      expect(call.endReason).toBe('DROPPED');
    });

    it('P18 + P19: webhook trong lúc nghỉ hỏi → không hỏi GetStream, bật mốc nếu chưa có', async () => {
      const failing = active({ answeredAgo: 400, markAgo: 350 });
      arrangeFindOne(failing);
      stream.listPresentUserIds.mockRejectedValueOnce(new Error('timeout'));
      await service.getActive(CALLER, ORDER_ID);

      const sameCall = Object.assign(failing, { shortHandedSince: null });
      arrangeFindOne(sameCall);
      await service.syncPresence(sameCall.id);
      expect(stream.listPresentUserIds).toHaveBeenCalledTimes(1);
      expect(sameCall.shortHandedSince).toBeInstanceOf(Date);
    });

    it('L7 (P11): đơn đã đóng lúc đang nói, có người rời, GetStream xác nhận → DROPPED ngay, ended_at = mốc rời', async () => {
      const call = active({ answeredAgo: 400, markAgo: 5 });
      arrangeFindOne(call, 'CANCELLED');
      stream.listPresentUserIds.mockResolvedValue([CALLER]);
      await service.getActive(CALLER, ORDER_ID);
      expect(call).toMatchObject({
        status: 'ENDED',
        endReason: 'DROPPED',
        endedAt: call.shortHandedSince,
      });
    });

    it('L7: đơn đã đóng, đủ 2 bên → cuộc tiếp tục (xóa mốc); vào lại → 409 ORDER_NOT_CALLABLE', async () => {
      const call = active({ answeredAgo: 400, markAgo: 5 });
      arrangeFindOne(call, 'CANCELLED');
      stream.listPresentUserIds.mockResolvedValue([CALLER, CALLEE]);
      await expect(service.join(CALLER, call.id)).rejects.toThrow(
        new ConflictException('ORDER_NOT_CALLABLE'),
      );
      expect(call.status).toBe('ACTIVE');
      expect(call.shortHandedSince).toBeNull();
    });

    it('L7: đơn đã đóng vẫn giới hạn 60 phút → TIMEOUT', async () => {
      const call = active({ answeredAgo: 3601, markAgo: null });
      arrangeFindOne(call, 'CANCELLED');
      await service.getActive(CALLER, ORDER_ID);
      expect(call.endReason).toBe('TIMEOUT');
    });

    it('L8 (P12): đơn đóng lúc đổ chuông, chưa quá 45s → CANCELLED, ended_by null, ended_at = now; 2 bên nhận ended', async () => {
      const call = liveCall({
        callerAccountId: CALLER,
        calleeAccountId: CALLEE,
        createdAt: new Date(Date.now() - 10_000),
      });
      arrangeFindOne(call, 'REJECTED');
      const before = Date.now();
      await expect(service.getActive(CALLEE, ORDER_ID)).resolves.toEqual({
        call: null,
      });
      expect(call).toMatchObject({
        status: 'ENDED',
        endReason: 'CANCELLED',
        endedBy: null,
      });
      expect(call.endedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(gateway.emitToAccounts).toHaveBeenCalledWith(
        [CALLER, CALLEE],
        'video_call.ended',
        expect.objectContaining({ endReason: 'CANCELLED' }),
      );
    });

    it('P12: đơn đóng lúc đổ chuông mà chuông đã quá 45s → MISSED tại mốc (mốc thật ưu tiên)', async () => {
      const created = new Date(Date.now() - 60_000);
      const call = liveCall({ createdAt: created });
      arrangeFindOne(call, 'CANCELLED');
      await service.getActive(CALLER, ORDER_ID);
      expect(call).toMatchObject({
        endReason: 'MISSED',
        endedAt: new Date(created.getTime() + 45_000),
      });
    });

    it('L8: người nhận bấm nghe sau khi đơn bị đóng → đóng CANCELLED rồi 409 ORDER_NOT_CALLABLE', async () => {
      const call = liveCall({
        callerAccountId: CALLER,
        calleeAccountId: CALLEE,
      });
      arrangeFindOne(call, 'CANCELLED');
      await expect(service.join(CALLEE, call.id)).rejects.toThrow(
        new ConflictException('ORDER_NOT_CALLABLE'),
      );
      expect(call).toMatchObject({ status: 'ENDED', endReason: 'CANCELLED' });
      expect(emittedEvents()).toEqual(['video_call.ended']);
    });

    it('L8: cuộc đang đổ chuông ở đơn khác đã bị đóng → được dọn khi tạo cuộc mới, không còn bận', async () => {
      const old = liveCall({
        orderId: OTHER_ORDER,
        callerAccountId: CALLER,
        calleeAccountId: OTHER,
      });
      manager.find.mockResolvedValue([old]);
      manager.findOne.mockImplementation((_entity: unknown, opts: unknown) =>
        Promise.resolve({
          id: OTHER_ORDER,
          status:
            (opts as { where: { id: string } }).where.id === OTHER_ORDER
              ? 'CANCELLED'
              : 'IN_CARE',
        }),
      );
      await service.create(CALLER, ORDER_ID);
      expect(old.endReason).toBe('CANCELLED');
      expect(insertedCalls()).toHaveLength(1);
    });
  });
});

describe('toVideoCallResponse (mapper)', () => {
  const names = new Map([
    [CALLER, 'Vườn Lan'],
    [CALLEE, 'Khách Hoa'],
  ]);

  it('đúng field §5.2, không lộ field thừa (device session, short_handed_since, version…)', () => {
    const created = new Date('2026-10-14T10:00:00.000Z');
    const call = Object.assign(
      liveCall({
        callerAccountId: CALLER,
        calleeAccountId: CALLEE,
        status: 'ENDED',
        endReason: 'COMPLETED',
        endedBy: CALLEE,
        createdAt: created,
        answeredAt: new Date('2026-10-14T10:00:10.000Z'),
        endedAt: new Date('2026-10-14T10:02:15.500Z'),
        shortHandedSince: new Date('2026-10-14T10:01:00.000Z'),
      }),
      { version: 3, deletedAt: null, updatedAt: created },
    );
    expect(toVideoCallResponse(call, CALLER, names, T)).toStrictEqual({
      id: call.id,
      orderId: ORDER_ID,
      status: 'ENDED',
      endReason: 'COMPLETED',
      myRole: 'CALLER',
      endedBy: 'CALLEE',
      caller: { accountId: CALLER, fullName: 'Vườn Lan' },
      callee: { accountId: CALLEE, fullName: 'Khách Hoa' },
      createdAt: '2026-10-14T10:00:00.000Z',
      ringExpiresAt: '2026-10-14T10:00:45.000Z',
      answeredAt: '2026-10-14T10:00:10.000Z',
      endedAt: '2026-10-14T10:02:15.500Z',
      durationSeconds: 125,
    });
  });

  it('nhìn từ người nhận: myRole CALLEE; hệ thống đóng → endedBy null', () => {
    const call = liveCall({
      callerAccountId: CALLER,
      calleeAccountId: CALLEE,
      status: 'ENDED',
      endReason: 'MISSED',
      endedBy: null,
      endedAt: new Date(),
    });
    expect(toVideoCallResponse(call, CALLEE, names, T)).toMatchObject({
      myRole: 'CALLEE',
      endedBy: null,
      durationSeconds: null,
    });
  });
});
