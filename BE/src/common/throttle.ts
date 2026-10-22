import type { ExecutionContext } from '@nestjs/common';
import {
  DEFAULT_IPV6_SUBNET_PREFIX,
  normalizeIp,
  type ThrottlerOptions,
} from '@nestjs/throttler';

// Rate limit 2 lớp (cửa sổ 60 giây):
// - `default`: đếm theo IP — áp cho MỌI route, chống 1 máy spam.
// - `account`: đếm theo IP + email trong body — chỉ chạy khi body có `email` (register, login,
//   forgot-password). Chặn dò mật khẩu của 1 email mà KHÔNG chặn người khác dùng chung IP
//   (cả phòng chung Wi-Fi/NAT, mạng 4G CGNAT khi demo).
export const RATE_LIMIT_WINDOW_MS = 60_000;

// Đọc process.env MỖI request (không qua ConfigService đã cache) để e2e bật lại rate limit
// trong đúng 1 test. Production cấm 'true' (env.validation.ts).
const isThrottleDisabled = (): boolean =>
  process.env.THROTTLE_DISABLED === 'true';

// Guard chạy TRƯỚC ValidationPipe → body còn thô: tự chuẩn hoá giống toNormalizedEmail.
// Email không phải chuỗi / rỗng → null (lớp account bỏ qua; @IsEmail sau đó trả 400).
export function bodyEmail(req: { body?: unknown }): string | null {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase().slice(0, 255);
  return normalized || null;
}

export const THROTTLERS: ThrottlerOptions[] = [
  { name: 'default', ttl: RATE_LIMIT_WINDOW_MS, limit: 100 },
  {
    name: 'account',
    ttl: RATE_LIMIT_WINDOW_MS,
    limit: 10,
    // IP chuẩn hoá giống lớp `default` (IPv6 gom theo dải /64) — không thì đổi địa chỉ trong
    // dải /64 của mình là có bộ đếm email mới, lách được giới hạn 5/phút.
    getTracker: (req: { ip?: string; body?: unknown }) =>
      `${normalizeIp(req.ip ?? '', DEFAULT_IPV6_SUBNET_PREFIX)}|${bodyEmail(req)}`,
    // skipIf riêng THAY skipIf chung của module → phải tự kiểm lại THROTTLE_DISABLED.
    skipIf: (context: ExecutionContext) =>
      isThrottleDisabled() ||
      bodyEmail(context.switchToHttp().getRequest<{ body?: unknown }>()) ===
        null,
  },
];

export const throttlerSkipIf = isThrottleDisabled;
