import type { ExecutionContext } from '@nestjs/common';
import { bodyEmail, THROTTLERS } from './throttle';

// Lớp `account` của rate limit: đếm theo IP + email trong body (xem throttle.ts).
const account = THROTTLERS.find((t) => t.name === 'account')!;

const contextOf = (body: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  }) as unknown as ExecutionContext;

// getTracker được phép trả string hoặc Promise<string> → bọc lại để test thống nhất.
const trackerOf = (ip: string, body: unknown) =>
  Promise.resolve(account.getTracker!({ ip, body }, contextOf(body)));

describe('rate limit lớp account (IP + email)', () => {
  const original = process.env.THROTTLE_DISABLED;
  afterEach(() => {
    // Gán undefined vào process.env thành chuỗi 'undefined' → phải delete.
    if (original === undefined) delete process.env.THROTTLE_DISABLED;
    else process.env.THROTTLE_DISABLED = original;
  });

  describe('bodyEmail', () => {
    it('chuẩn hoá trim + lowercase giống toNormalizedEmail', () => {
      expect(bodyEmail({ body: { email: '  Lan@Example.COM ' } })).toBe(
        'lan@example.com',
      );
    });

    it.each([
      ['mảng', ['a@x.com']],
      ['object', { a: 1 }],
      ['số', 123],
      ['chuỗi rỗng', ''],
      ['toàn khoảng trắng', '   '],
      ['thiếu', undefined],
    ])('email là %s → null (không đếm ở lớp account)', (_label, email) => {
      expect(bodyEmail({ body: { email } })).toBeNull();
    });

    it('không có body → null', () => {
      expect(bodyEmail({})).toBeNull();
    });

    it('email quá dài bị cắt 255 ký tự (khoá bộ đếm không phình)', () => {
      expect(bodyEmail({ body: { email: 'a'.repeat(1000) } })).toHaveLength(
        255,
      );
    });
  });

  describe('getTracker', () => {
    it('cùng IP + cùng email (khác hoa/thường) → cùng bộ đếm', async () => {
      await expect(
        trackerOf('203.0.113.7', { email: 'Lan@Example.com' }),
      ).resolves.toBe(
        await trackerOf('203.0.113.7', { email: ' lan@example.com' }),
      );
    });

    it('cùng IP, khác email → khác bộ đếm (người chung Wi-Fi không vạ lây)', async () => {
      await expect(
        trackerOf('203.0.113.7', { email: 'a@x.com' }),
      ).resolves.not.toBe(await trackerOf('203.0.113.7', { email: 'b@x.com' }));
    });

    it('IPv6 cùng dải /64 → cùng bộ đếm (không lách bằng cách đổi địa chỉ trong dải)', async () => {
      await expect(
        trackerOf('2001:db8:1:2::aaaa', { email: 'a@x.com' }),
      ).resolves.toBe(
        await trackerOf('2001:db8:1:2::bbbb', { email: 'a@x.com' }),
      );
    });
  });

  describe('skipIf', () => {
    it('có email hợp lệ → đếm', () => {
      delete process.env.THROTTLE_DISABLED;
      expect(account.skipIf!(contextOf({ email: 'a@x.com' }))).toBe(false);
    });

    it('không có email (refresh, google, reset) → bỏ qua lớp này', () => {
      delete process.env.THROTTLE_DISABLED;
      expect(account.skipIf!(contextOf({ refreshToken: 'x' }))).toBe(true);
      expect(account.skipIf!(contextOf({ email: ['a@x.com'] }))).toBe(true);
    });

    it('THROTTLE_DISABLED=true → bỏ qua (skipIf riêng thay skipIf chung nên phải tự kiểm)', () => {
      process.env.THROTTLE_DISABLED = 'true';
      expect(account.skipIf!(contextOf({ email: 'a@x.com' }))).toBe(true);
    });
  });
});
