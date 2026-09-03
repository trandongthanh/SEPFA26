/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';

// Secret GIẢ cho test (access != refresh), không liên quan .env thật.
const ACCESS_SECRET = 'test-access-secret-0123456789abcdef0123';
const REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef012';

const makeService = (): TokenService => {
  const config = {
    get: (name: string, def?: unknown) => {
      const map: Record<string, string> = {
        JWT_ACCESS_SECRET: ACCESS_SECRET,
        JWT_ACCESS_EXPIRES: '15m',
        JWT_REFRESH_SECRET: REFRESH_SECRET,
        JWT_REFRESH_EXPIRES: '7d',
      };
      return map[name] ?? def;
    },
  } as unknown as ConfigService;
  // JwtService thật (không mock) — test cả việc ký/xác minh thực sự.
  return new TokenService(new JwtService({}), config);
};

describe('TokenService', () => {
  let tokens: TokenService;
  const input = { sub: 'acc-1', role: 'CUSTOMER' as const };

  beforeEach(() => {
    tokens = makeService();
  });

  it('ký rồi xác minh access token ra lại đúng payload', () => {
    const token = tokens.signAccess(input);
    const payload = tokens.verifyAccess(token);
    expect(payload.sub).toBe('acc-1');
    expect(payload.role).toBe('CUSTOMER');
    expect(payload.type).toBe('access');
  });

  it('ký rồi xác minh refresh token ra lại đúng payload', () => {
    const token = tokens.signRefresh(input);
    const payload = tokens.verifyRefresh(token);
    expect(payload.type).toBe('refresh');
  });

  it('access token KHÔNG verify được bằng secret refresh (chống dùng nhầm)', () => {
    const access = tokens.signAccess(input);
    expect(() => tokens.verifyRefresh(access)).toThrow();
  });

  it('refresh token KHÔNG verify được bằng secret access', () => {
    const refresh = tokens.signRefresh(input);
    expect(() => tokens.verifyAccess(refresh)).toThrow();
  });

  it('token bị sửa -> verify ném lỗi', () => {
    const token = tokens.signAccess(input);
    const tampered = token.slice(0, -2) + 'xx';
    expect(() => tokens.verifyAccess(tampered)).toThrow();
  });

  // Bug thực tế: ký 2 lần liên tiếp trong cùng 1 giây (iat trùng) với cùng
  // sub/role/type cho ra payload giống hệt -> chữ ký HMAC cũng giống hệt.
  // jti (random mỗi lần ký) đảm bảo token luôn khác nhau dù ký cùng giây.
  it('2 lần ký liên tiếp cho cùng account ra 2 token KHÁC nhau (jti chống trùng)', () => {
    const refresh1 = tokens.signRefresh(input);
    const refresh2 = tokens.signRefresh(input);
    expect(refresh1).not.toBe(refresh2);

    const access1 = tokens.signAccess(input);
    const access2 = tokens.signAccess(input);
    expect(access1).not.toBe(access2);
  });
});
