import { Logger } from '@nestjs/common';
import type { Namespace, Socket } from 'socket.io';
import type { AccountsService } from '../accounts/accounts.service';
import type { TokenService } from '../auth/token.service';
import {
  socketCorsOrigin,
  SOCKET_UNAUTHORIZED,
  VideoCallsGateway,
} from './video-calls.gateway';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const ALLOWED_ORIGIN = 'https://lancare.vn';

describe('VideoCallsGateway', () => {
  const tokens = { verifyAccess: jest.fn() };
  const accounts = { findAuthenticatableById: jest.fn() };
  let gateway: VideoCallsGateway;
  let middleware: (socket: Socket, next: (err?: Error) => void) => void;
  const savedCorsOrigin = process.env.CORS_ORIGIN;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CORS_ORIGIN = `${ALLOWED_ORIGIN},http://localhost:3002`;
    gateway = new VideoCallsGateway(
      tokens as unknown as TokenService,
      accounts as unknown as AccountsService,
    );
    const server = {
      use: jest.fn((fn: typeof middleware) => {
        middleware = fn;
      }),
    };
    gateway.afterInit(server as unknown as Namespace);
    tokens.verifyAccess.mockReturnValue({
      sub: ACCOUNT_ID,
      role: 'CUSTOMER',
      type: 'access',
      jti: 'j',
    });
    accounts.findAuthenticatableById.mockResolvedValue({ id: ACCOUNT_ID });
  });

  afterAll(() => {
    process.env.CORS_ORIGIN = savedCorsOrigin;
  });

  // Socket giả: chỉ những phần gateway đọc/ghi.
  interface FakeSocket {
    handshake: {
      auth: Record<string, unknown>;
      headers: { origin?: string; authorization?: string };
    };
    data: { accountId?: string };
    join: jest.Mock;
  }
  const makeSocket = (opts: {
    origin?: string;
    authToken?: unknown;
    authorization?: string;
  }): FakeSocket => ({
    handshake: {
      auth: opts.authToken === undefined ? {} : { token: opts.authToken },
      headers: { origin: opts.origin, authorization: opts.authorization },
    },
    data: {},
    join: jest.fn().mockResolvedValue(undefined),
  });

  // Chạy middleware như socket.io, trả lỗi truyền cho next (undefined = được nhận).
  const connect = (socket: FakeSocket) =>
    new Promise<Error | undefined>((resolve) =>
      middleware(socket as unknown as Socket, resolve),
    );

  it('không có Origin + access token đúng → được nhận, vào đúng room account:<id>', async () => {
    const socket = makeSocket({ authToken: 'good' });
    await expect(connect(socket)).resolves.toBeUndefined();
    expect(tokens.verifyAccess).toHaveBeenCalledWith('good');
    expect(accounts.findAuthenticatableById).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(socket.join).toHaveBeenCalledWith(`account:${ACCOUNT_ID}`);
    expect(socket.data.accountId).toBe(ACCOUNT_ID);
  });

  it('Origin trong CORS_ORIGIN + token → được nhận', async () => {
    const socket = makeSocket({ origin: ALLOWED_ORIGIN, authToken: 'good' });
    await expect(connect(socket)).resolves.toBeUndefined();
  });

  it('token từ header Authorization: Bearer → được nhận', async () => {
    const socket = makeSocket({ authorization: 'Bearer good' });
    await expect(connect(socket)).resolves.toBeUndefined();
    expect(tokens.verifyAccess).toHaveBeenCalledWith('good');
  });

  const rejected: [string, () => FakeSocket, () => void][] = [
    ['thiếu token', () => makeSocket({}), () => undefined],
    [
      'token rỗng / không phải chuỗi',
      () => makeSocket({ authToken: 123, authorization: 'Bearer   ' }),
      () => undefined,
    ],
    [
      'token sai (verifyAccess ném lỗi)',
      () => makeSocket({ authToken: 'bad' }),
      () =>
        tokens.verifyAccess.mockImplementation(() => {
          throw new Error('invalid signature');
        }),
    ],
    [
      'refresh token (type khác access)',
      () => makeSocket({ authToken: 'refresh' }),
      () =>
        tokens.verifyAccess.mockReturnValue({
          sub: ACCOUNT_ID,
          role: 'CUSTOMER',
          type: 'refresh',
          jti: 'j',
        }),
    ],
    [
      'tài khoản không còn được đăng nhập (SUSPENDED → null)',
      () => makeSocket({ authToken: 'good' }),
      () => accounts.findAuthenticatableById.mockResolvedValue(null),
    ],
    [
      'Origin lạ (dù token đúng)',
      () => makeSocket({ origin: 'https://evil.example', authToken: 'good' }),
      () => undefined,
    ],
  ];
  it.each(rejected)(
    '%s → connect_error UNAUTHORIZED, không vào room',
    async (_name, socketFactory, arrange) => {
      arrange();
      const socket = socketFactory();
      const err = await connect(socket);
      expect(err).toBeInstanceOf(Error);
      expect(err?.message).toBe(SOCKET_UNAUTHORIZED);
      expect(socket.join).not.toHaveBeenCalled();
    },
  );

  it('lỗi bất ngờ khi xác thực (DB lỗi) → UNAUTHORIZED + log cảnh báo', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    accounts.findAuthenticatableById.mockRejectedValue(new Error('db down'));
    const err = await connect(makeSocket({ authToken: 'good' }));
    expect(err?.message).toBe(SOCKET_UNAUTHORIZED);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
    warn.mockRestore();
  });

  describe('emitToAccounts', () => {
    it('gửi tới room của từng tài khoản', () => {
      const emit = jest.fn();
      const to = jest.fn(() => ({ emit }));
      gateway.server = { to } as unknown as Namespace;
      const payload = {
        callId: 'c1',
        endReason: 'COMPLETED' as const,
        endedAt: '2026-10-14T10:00:00.000Z',
      };
      gateway.emitToAccounts(['a', 'b'], 'video_call.ended', payload);
      expect(to).toHaveBeenCalledWith(['account:a', 'account:b']);
      expect(emit).toHaveBeenCalledWith('video_call.ended', payload);
    });

    it('gửi lỗi → log cảnh báo kèm callId, không ném (P21)', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      gateway.server = {
        to: () => {
          throw new Error('adapter down');
        },
      } as unknown as Namespace;
      expect(() =>
        gateway.emitToAccounts(['a'], 'video_call.moved', {
          callId: 'c1',
          deviceSessionId: 'd1',
        }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('c1'));
      warn.mockRestore();
    });
  });
});

describe('socketCorsOrigin (CORS lượt polling — P1)', () => {
  const saved = process.env.CORS_ORIGIN;
  afterAll(() => {
    process.env.CORS_ORIGIN = saved;
  });

  it.each<[string | undefined, boolean]>([
    [undefined, true],
    [ALLOWED_ORIGIN, true],
    ['https://evil.example', false],
  ])('Origin %p → cho phép = %p', (origin, expected) => {
    process.env.CORS_ORIGIN = ALLOWED_ORIGIN;
    const callback = jest.fn();
    socketCorsOrigin(origin, callback);
    expect(callback).toHaveBeenCalledWith(null, expected);
  });
});
