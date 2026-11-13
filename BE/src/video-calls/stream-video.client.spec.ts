import { createHmac } from 'crypto';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { StreamClient } from '@stream-io/node-sdk';
import type * as StreamSdk from '@stream-io/node-sdk';
import { STREAM_SETUP_TIMEOUT_MS } from './video-call.constants';
import {
  buildCallTypeGrants,
  buildCallTypeSettings,
  checkCallTypeGrants,
  STREAM_CLIENT_TIMEOUT_MS,
  StreamVideoClient,
} from './stream-video.client';

// SDK giả: ghi lại lời gọi, không ra mạng (tên bắt đầu bằng "mock" để jest.mock dùng được).
const mockCall = {
  getOrCreate: jest.fn(),
  end: jest.fn(),
  get: jest.fn(),
};
const mockSdk = {
  upsertUsers: jest.fn(),
  listRoles: jest.fn(),
  createRole: jest.fn(),
  generateCallToken: jest.fn(),
  verifyWebhook: jest.fn(),
  video: {
    call: jest.fn(() => mockCall),
    listCallTypes: jest.fn(),
    createCallType: jest.fn(),
    updateCallType: jest.fn(),
    getCallType: jest.fn(),
  },
};
jest.mock('@stream-io/node-sdk', () => ({
  StreamClient: jest.fn(() => mockSdk),
}));

// Ký token / kiểm HMAC bằng thuật toán THẬT của SDK (hàm thuần, không ra mạng).
const { StreamClient: RealStreamClient } = jest.requireActual<typeof StreamSdk>(
  '@stream-io/node-sdk',
);
const SECRET = 'unit-stream-secret';
const realSdk = new RealStreamClient('unit-key', SECRET);

const CALL_ID = '6f1c1a1e-8a51-4c2b-9d3e-2f6a7b8c9d0e';
const ENV = {
  STREAM_API_KEY: 'unit-key',
  STREAM_API_SECRET: SECRET,
  STREAM_CALL_TYPE: 'lancare_call',
  STREAM_SYSTEM_USER_ID: 'lancare-system',
};
const makeClient = () => new StreamVideoClient(new ConfigService(ENV));

describe('StreamVideoClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSdk.generateCallToken.mockImplementation(
      (payload: Parameters<StreamClient['generateCallToken']>[0]) =>
        realSdk.generateCallToken(payload),
    );
    mockSdk.verifyWebhook.mockImplementation(
      (body: string | Buffer, signature: string) =>
        realSdk.verifyWebhook(body, signature),
    );
  });

  it('tạo SDK chỉ với key/secret — không truyền timeout (giữ mặc định 3000 ms)', () => {
    const client = makeClient();
    expect(StreamClient).toHaveBeenCalledTimes(1);
    expect(jest.mocked(StreamClient).mock.calls[0]).toEqual([
      'unit-key',
      SECRET,
    ]);
    expect(client.apiKey).toBe('unit-key');
    expect(client.callType).toBe('lancare_call');
    expect(client.systemUserId).toBe('lancare-system');
    expect(client.callCid(CALL_ID)).toBe(`lancare_call:${CALL_ID}`);
  });

  // P26: dựng qua DI của Nest để kiểm cả @Optional() @Inject(STREAM_CLIENT_TIMEOUT_MS).
  describe('timeout SDK qua DI (P26)', () => {
    const resolve = async (extraProviders: Provider[]) => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          StreamVideoClient,
          { provide: ConfigService, useValue: new ConfigService(ENV) },
          ...extraProviders,
        ],
      }).compile();
      return moduleRef.get(StreamVideoClient);
    };

    it('module không cung cấp token (như module BE) → StreamClient đúng 2 tham số, không option timeout', async () => {
      await resolve([]);
      expect(jest.mocked(StreamClient).mock.calls).toEqual([
        ['unit-key', SECRET],
      ]);
    });

    it('module cung cấp token 15000 (như script setup) → option { timeout: 15000 }', async () => {
      await resolve([
        {
          provide: STREAM_CLIENT_TIMEOUT_MS,
          useValue: STREAM_SETUP_TIMEOUT_MS,
        },
      ]);
      expect(STREAM_SETUP_TIMEOUT_MS).toBe(15000);
      expect(jest.mocked(StreamClient).mock.calls).toEqual([
        ['unit-key', SECRET, { timeout: 15000 }],
      ]);
    });
  });

  describe('createCall', () => {
    it('upsert user hệ thống (admin) + 2 bên (lancare_user, tên thật), rồi getOrCreate do user hệ thống đứng tên', async () => {
      await makeClient().createCall(CALL_ID, {
        members: [
          { id: 'acc-a', name: 'Khách A' },
          { id: 'acc-b', name: 'Vườn B' },
        ],
        maxDurationSeconds: 3705,
      });

      expect(mockSdk.upsertUsers).toHaveBeenCalledWith([
        { id: 'lancare-system', name: 'LanCare Hub', role: 'admin' },
        { id: 'acc-a', name: 'Khách A', role: 'lancare_user' },
        { id: 'acc-b', name: 'Vườn B', role: 'lancare_user' },
      ]);
      expect(mockSdk.video.call).toHaveBeenCalledWith('lancare_call', CALL_ID);
      // toStrictEqual: không có field nào khác (vd max_participants — P3).
      expect(mockCall.getOrCreate.mock.calls).toStrictEqual([
        [
          {
            data: {
              created_by_id: 'lancare-system',
              members: [
                { user_id: 'acc-a', role: 'call_member' },
                { user_id: 'acc-b', role: 'call_member' },
              ],
              settings_override: { limits: { max_duration_seconds: 3705 } },
            },
          },
        ],
      ]);
      // Đăng ký user trước rồi mới tạo cuộc gọi.
      expect(mockSdk.upsertUsers.mock.invocationCallOrder[0]).toBeLessThan(
        mockCall.getOrCreate.mock.invocationCallOrder[0],
      );
    });

    it('upsert lỗi → không tạo cuộc gọi, lỗi ném lên cho service', async () => {
      mockSdk.upsertUsers.mockRejectedValueOnce(new Error('network'));
      await expect(
        makeClient().createCall(CALL_ID, {
          members: [{ id: 'acc-a', name: 'A' }],
          maxDurationSeconds: 3705,
        }),
      ).rejects.toThrow('network');
      expect(mockCall.getOrCreate).not.toHaveBeenCalled();
    });
  });

  it('generateCallToken: claims đúng user, role call_member, chỉ 1 call cid, hiệu lực đúng ttl', () => {
    const token = makeClient().generateCallToken('acc-a', CALL_ID, 4245);
    const claims = new JwtService().verify<Record<string, unknown>>(token, {
      secret: SECRET,
    });
    expect(claims).toMatchObject({
      user_id: 'acc-a',
      role: 'call_member',
      call_cids: [`lancare_call:${CALL_ID}`],
    });
    expect((claims.exp as number) - (claims.iat as number)).toBe(4245);
  });

  it('endCall gọi end() trên đúng cuộc gọi', async () => {
    await makeClient().endCall(CALL_ID);
    expect(mockSdk.video.call).toHaveBeenCalledWith('lancare_call', CALL_ID);
    expect(mockCall.end).toHaveBeenCalledTimes(1);
  });

  describe('listPresentUserIds', () => {
    it('gộp nhiều phiên của cùng 1 user (2 máy) → id không trùng', async () => {
      mockCall.get.mockResolvedValueOnce({
        call: {
          session: {
            participants: [
              { user: { id: 'acc-a' } },
              { user: { id: 'acc-a' } },
              { user: { id: 'acc-b' } },
            ],
          },
        },
      });
      await expect(makeClient().listPresentUserIds(CALL_ID)).resolves.toEqual([
        'acc-a',
        'acc-b',
      ]);
    });

    it('chưa ai vào (session null) → []', async () => {
      mockCall.get.mockResolvedValueOnce({ call: { session: null } });
      await expect(makeClient().listPresentUserIds(CALL_ID)).resolves.toEqual(
        [],
      );
    });

    it('GetStream lỗi → ném lên cho service', async () => {
      mockCall.get.mockRejectedValueOnce(new Error('timeout'));
      await expect(makeClient().listPresentUserIds(CALL_ID)).rejects.toThrow(
        'timeout',
      );
    });
  });

  describe('parseCallCid', () => {
    it.each<[string, unknown, string | null]>([
      ['đúng call type + uuid', `lancare_call:${CALL_ID}`, CALL_ID],
      [
        'uuid chữ hoa → trả chữ thường',
        `lancare_call:${CALL_ID.toUpperCase()}`,
        CALL_ID,
      ],
      ['call type lạ', `default:${CALL_ID}`, null],
      ['call type có tiền tố giống', `lancare_call_x:${CALL_ID}`, null],
      ['không phải uuid', 'lancare_call:abc', null],
      ['thiếu id', 'lancare_call:', null],
      ['không có dấu :', CALL_ID, null],
      ['không phải chuỗi', 123, null],
      ['undefined', undefined, null],
    ])('%s → %p', (_name, cid, expected) => {
      expect(makeClient().parseCallCid(cid)).toBe(expected);
    });
  });

  describe('verifyWebhook', () => {
    const body = Buffer.from('{"type":"call.session_participant_left"}');
    const sign = (raw: Buffer, secret: string) =>
      createHmac('sha256', secret).update(raw).digest('hex');

    it('chữ ký HMAC đúng trên raw body → true', () => {
      expect(makeClient().verifyWebhook(body, sign(body, SECRET))).toBe(true);
    });

    it.each<[string, Buffer | undefined, string | undefined]>([
      ['ký bằng secret khác', body, sign(body, 'other-secret')],
      ['body bị sửa sau khi ký', Buffer.from('{}'), sign(body, SECRET)],
    ])('%s → false', (_name, raw, signature) => {
      expect(makeClient().verifyWebhook(raw, signature)).toBe(false);
    });

    it.each<[string, Buffer | undefined, string | undefined]>([
      ['thiếu body', undefined, 'abc'],
      ['body rỗng', Buffer.alloc(0), 'abc'],
      ['thiếu chữ ký', body, undefined],
      ['chữ ký rỗng', body, ''],
    ])('%s → false, không gọi SDK', (_name, raw, signature) => {
      expect(makeClient().verifyWebhook(raw, signature)).toBe(false);
      expect(mockSdk.verifyWebhook).not.toHaveBeenCalled();
    });
  });

  describe('ensureCallType', () => {
    const SAVED_GRANTS = { call_member: ['join-call'], user: [] };

    beforeEach(() => {
      mockSdk.video.getCallType.mockResolvedValue({ grants: SAVED_GRANTS });
    });

    it('app mới: tạo role lancare_user + tạo call type (grants K1b, settings K3), đăng ký user hệ thống, trả grants đọc lại', async () => {
      mockSdk.listRoles.mockResolvedValueOnce({
        roles: [{ name: 'user' }, { name: 'admin' }],
      });
      mockSdk.video.listCallTypes.mockResolvedValueOnce({
        call_types: { default: {}, audio_room: {} },
      });

      const result = await makeClient().ensureCallType(3705);

      expect(mockSdk.createRole).toHaveBeenCalledWith({ name: 'lancare_user' });
      expect(mockSdk.video.createCallType).toHaveBeenCalledWith({
        name: 'lancare_call',
        grants: buildCallTypeGrants(),
        settings: buildCallTypeSettings(3705),
      });
      expect(mockSdk.video.updateCallType).not.toHaveBeenCalled();
      expect(mockSdk.upsertUsers).toHaveBeenCalledWith([
        { id: 'lancare-system', name: 'LanCare Hub', role: 'admin' },
      ]);
      expect(mockSdk.video.getCallType).toHaveBeenCalledWith({
        name: 'lancare_call',
      });
      expect(result).toEqual({
        appRoleCreated: true,
        callTypeCreated: true,
        grants: SAVED_GRANTS,
      });
    });

    it('chạy lại: đã có role + call type → không tạo role, cập nhật call type', async () => {
      mockSdk.listRoles.mockResolvedValueOnce({
        roles: [{ name: 'user' }, { name: 'lancare_user' }],
      });
      mockSdk.video.listCallTypes.mockResolvedValueOnce({
        call_types: { default: {}, lancare_call: {} },
      });

      const result = await makeClient().ensureCallType(3705);

      expect(mockSdk.createRole).not.toHaveBeenCalled();
      expect(mockSdk.video.createCallType).not.toHaveBeenCalled();
      expect(mockSdk.video.updateCallType).toHaveBeenCalledWith({
        name: 'lancare_call',
        grants: buildCallTypeGrants(),
        settings: buildCallTypeSettings(3705),
      });
      expect(result).toEqual({
        appRoleCreated: false,
        callTypeCreated: false,
        grants: SAVED_GRANTS,
      });
    });
  });
});

describe('buildCallTypeGrants', () => {
  it('call_member đúng 4 quyền; user, guest, lancare_user khai rõ là rỗng (K1, K1b)', () => {
    expect(buildCallTypeGrants()).toStrictEqual({
      call_member: ['join-call', 'read-call', 'send-audio', 'send-video'],
      user: [],
      guest: [],
      lancare_user: [],
    });
  });
});

describe('checkCallTypeGrants (P27)', () => {
  const MEMBER = ['join-call', 'read-call', 'send-audio', 'send-video'];
  const LANCARE_ABSENT =
    'OK lancare_user: (GetStream không lưu dòng rỗng — xem kiểm quyền)';

  it('đúng như GetStream thật lưu (vắng dòng lancare_user) → 4 dòng OK', () => {
    expect(
      checkCallTypeGrants({ call_member: MEMBER, user: [], guest: [] }),
    ).toEqual([
      {
        ok: true,
        line: 'OK call_member: [join-call, read-call, send-audio, send-video]',
      },
      { ok: true, line: 'OK user: []' },
      { ok: true, line: 'OK guest: []' },
      { ok: true, line: LANCARE_ABSENT },
    ]);
  });

  it('lancare_user có dòng rỗng → OK; thứ tự quyền khác vẫn OK; role khác bị bỏ qua', () => {
    const result = checkCallTypeGrants({
      call_member: [...MEMBER].reverse(),
      user: [],
      guest: [],
      lancare_user: [],
      admin: ['create-call'],
    });
    expect(result.every((r) => r.ok)).toBe(true);
    expect(result.map((r) => r.line)).toContain('OK lancare_user: []');
  });

  it.each<[string, Record<string, string[]>, string]>([
    [
      'lancare_user có quyền',
      { call_member: MEMBER, user: [], guest: [], lancare_user: ['join-call'] },
      'LỆCH lancare_user: [join-call]',
    ],
    [
      'vắng dòng user (GetStream tự gán quyền mặc định)',
      { call_member: MEMBER, guest: [] },
      'LỆCH user: (vắng)',
    ],
    [
      'vắng dòng guest',
      { call_member: MEMBER, user: [] },
      'LỆCH guest: (vắng)',
    ],
    [
      'guest có quyền',
      { call_member: MEMBER, user: [], guest: ['join-call'] },
      'LỆCH guest: [join-call]',
    ],
    [
      'call_member thiếu 1 quyền',
      { call_member: MEMBER.slice(1), user: [], guest: [] },
      'LỆCH call_member: [read-call, send-audio, send-video]',
    ],
    [
      'call_member thừa quyền end-call',
      { call_member: [...MEMBER, 'end-call'], user: [], guest: [] },
      'LỆCH call_member: [end-call, join-call, read-call, send-audio, send-video]',
    ],
    [
      'vắng dòng call_member',
      { user: [], guest: [] },
      'LỆCH call_member: (vắng)',
    ],
  ])('%s → LỆCH', (_name, saved, expectedLine) => {
    const result = checkCallTypeGrants(saved);
    expect(result).toContainEqual({ ok: false, line: expectedLine });
    expect(result.filter((r) => !r.ok)).toHaveLength(1);
  });
});

describe('buildCallTypeSettings', () => {
  it('đúng danh sách K3, không có field nào khác; thời lượng tối đa theo tham số', () => {
    expect(buildCallTypeSettings(3705)).toStrictEqual({
      audio: {
        default_device: 'speaker',
        mic_default_on: true,
        access_request_enabled: false,
      },
      video: {
        enabled: true,
        camera_default_on: true,
        camera_facing: 'front',
        access_request_enabled: false,
        target_resolution: { width: 1280, height: 720, bitrate: 1500000 },
      },
      screensharing: {
        enabled: false,
        access_request_enabled: false,
        target_resolution: { width: 1920, height: 1080, bitrate: 1500000 },
      },
      recording: { mode: 'disabled' },
      backstage: { enabled: false },
      limits: { max_duration_seconds: 3705 },
    });
  });
});
