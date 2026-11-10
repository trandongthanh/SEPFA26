import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';

// Postgres unique_violation.
export const PG_UNIQUE_VIOLATION = '23505';

// SĐT di động Việt Nam: 0/84/+84 + đầu số 3|5|7|8|9 + 8 số.
export const VN_PHONE_REGEX = /^(?:\+84|84|0)(?:3|5|7|8|9)\d{8}$/;

// Số căn cước công dân: đúng 12 chữ số.
export const CCCD_REGEX = /^\d{12}$/;

// Chuẩn hoá SĐT trước khi mã hoá/băm: cùng 1 số viết nhiều kiểu (+84, 84, có dấu cách/chấm/gạch)
// phải ra CÙNG 1 chuỗi — nếu không, hash khác nhau và lọt qua check trùng.
// Mọi nơi ghi accounts.phone/phone_hash (auth, customers, providers) BẮT BUỘC đi qua hàm này.
export function normalizePhone(phone: string): string {
  return phone
    .replace(/[\s.()-]/g, '')
    .replace(/^\+84/, '0')
    .replace(/^84/, '0');
}

// SHA-256 (hex) dùng cho cột *_hash check trùng (phone_hash, cccd_number_hash).
// Hash KHÔNG khoá → dò ngược được (SĐT/CCCD ít khả năng) → tuyệt đối không trả ra API.
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Check trùng bằng findOne có khe đua (2 request cùng SĐT/CCCD song song) — UNIQUE index là chốt
// cuối. Đổi lỗi 23505 trên phone_hash / cccd_number_hash thành 409 cùng mã với nhánh check trước.
// Áp cho cả INSERT lẫn UPDATE (Postgres trả 23505 cho cả hai). Lỗi khác → trả nguyên để caller xử lý.
export function mapIdentityUniqueViolation(err: unknown): unknown {
  const pg = err as { code?: string; detail?: string };
  if (pg.code !== PG_UNIQUE_VIOLATION) {
    return err;
  }
  if (pg.detail?.includes('phone_hash')) {
    return new ConflictException('PHONE_EXISTS');
  }
  if (pg.detail?.includes('cccd_number_hash')) {
    return new ConflictException('CCCD_NUMBER_EXISTS');
  }
  return err;
}
