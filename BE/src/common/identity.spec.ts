import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  CCCD_REGEX,
  VN_PHONE_REGEX,
  mapIdentityUniqueViolation,
  normalizePhone,
  sha256Hex,
} from './identity';

describe('identity helpers', () => {
  describe('mapIdentityUniqueViolation', () => {
    const pgErr = (detail: string) => ({ code: '23505', detail });

    it('23505 trên phone_hash → 409 PHONE_EXISTS', () => {
      const mapped = mapIdentityUniqueViolation(
        pgErr('Key (phone_hash)=(abc) already exists.'),
      );
      expect(mapped).toBeInstanceOf(ConflictException);
      expect((mapped as ConflictException).message).toBe('PHONE_EXISTS');
    });

    it('23505 trên cccd_number_hash → 409 CCCD_NUMBER_EXISTS', () => {
      const mapped = mapIdentityUniqueViolation(
        pgErr('Key (cccd_number_hash)=(abc) already exists.'),
      );
      expect((mapped as ConflictException).message).toBe('CCCD_NUMBER_EXISTS');
    });

    it('23505 cột khác (vd account_id) hoặc lỗi khác → trả nguyên lỗi', () => {
      const other = pgErr('Key (account_id)=(x) already exists.');
      expect(mapIdentityUniqueViolation(other)).toBe(other);
      const boom = new Error('boom');
      expect(mapIdentityUniqueViolation(boom)).toBe(boom);
    });
  });

  describe('normalizePhone', () => {
    it.each([
      ['0909123456', '0909123456'],
      ['+84909123456', '0909123456'],
      ['84909123456', '0909123456'],
      ['+84 909 123 456', '0909123456'],
      ['0909.123.456', '0909123456'],
      ['(090) 912-3456', '0909123456'],
      [' 0909123456 ', '0909123456'],
    ])('%s → %s', (input, expected) => {
      expect(normalizePhone(input)).toBe(expected);
    });

    it('các cách viết của cùng 1 số → cùng 1 hash (check trùng không lọt)', () => {
      const hashes = ['+84 909 123 456', '84909123456', '0909.123.456'].map(
        (p) => sha256Hex(normalizePhone(p)),
      );
      expect(new Set(hashes).size).toBe(1);
    });
  });

  describe('sha256Hex', () => {
    it('khớp createHash sha256 hex (tương thích hash đã lưu trong DB)', () => {
      expect(sha256Hex('001234567890')).toBe(
        createHash('sha256').update('001234567890').digest('hex'),
      );
      expect(sha256Hex('x')).toHaveLength(64);
    });
  });

  describe('regex', () => {
    it('VN_PHONE_REGEX nhận số hợp lệ, chặn số sai đầu số/độ dài', () => {
      expect(VN_PHONE_REGEX.test('0909123456')).toBe(true);
      expect(VN_PHONE_REGEX.test('+84389123456')).toBe(true);
      expect(VN_PHONE_REGEX.test('0109123456')).toBe(false);
      expect(VN_PHONE_REGEX.test('090912345')).toBe(false);
    });

    it('CCCD_REGEX chỉ nhận đúng 12 chữ số', () => {
      expect(CCCD_REGEX.test('001234567890')).toBe(true);
      expect(CCCD_REGEX.test('00123456789')).toBe(false);
      expect(CCCD_REGEX.test('00123456789a')).toBe(false);
    });
  });
});
