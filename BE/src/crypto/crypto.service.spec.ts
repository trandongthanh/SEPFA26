import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

// Khóa GIẢ 32 byte (hex 64 ký tự) — chỉ dùng trong test, KHÔNG liên quan khóa thật ở .env.
const TEST_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const makeService = (key = TEST_KEY): CryptoService => {
  const config = {
    get: (name: string) => (name === 'DATA_ENCRYPTION_KEY' ? key : undefined),
  } as unknown as ConfigService;
  return new CryptoService(config);
};

describe('CryptoService', () => {
  let crypto: CryptoService;

  beforeEach(() => {
    crypto = makeService();
  });

  it('encrypt -> decrypt trả lại đúng bản gốc (round-trip)', () => {
    const plain = '0909123456';
    const encrypted = crypto.encrypt(plain);
    expect(encrypted).not.toBe(plain); // đã được mã hóa, không còn là bản rõ
    expect(crypto.decrypt(encrypted)).toBe(plain);
  });

  it('hai lần encrypt cùng input ra ciphertext khác nhau (IV ngẫu nhiên)', () => {
    const plain = '0909123456';
    const a = crypto.encrypt(plain);
    const b = crypto.encrypt(plain);
    expect(a).not.toBe(b);
    // nhưng cả hai vẫn giải mã về cùng bản gốc
    expect(crypto.decrypt(a)).toBe(plain);
    expect(crypto.decrypt(b)).toBe(plain);
  });

  it('sửa dữ liệu (ciphertext) -> decrypt ném lỗi (authTag không khớp)', () => {
    const encrypted = crypto.encrypt('0909123456');
    const buf = Buffer.from(encrypted, 'base64');
    // Lật 1 bit ở byte cuối (trong vùng ciphertext) để mô phỏng dữ liệu bị sửa.
    buf[buf.length - 1] ^= 0x01;
    const tampered = buf.toString('base64');
    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('giải mã bằng khóa khác -> ném lỗi', () => {
    const encrypted = crypto.encrypt('0909123456');
    const otherKey =
      'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    const otherService = makeService(otherKey);
    expect(() => otherService.decrypt(encrypted)).toThrow();
  });

  it('xử lý được chuỗi unicode (tiếng Việt)', () => {
    const plain = 'Nguyễn Văn Lan — 0909 123 456';
    expect(crypto.decrypt(crypto.encrypt(plain))).toBe(plain);
  });
});
