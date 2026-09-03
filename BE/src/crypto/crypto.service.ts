import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Mã hóa cột nhạy cảm (phone, sau này là TT ngân hàng). Định dạng lưu: base64([IV|authTag|ciphertext]).
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const hexKey = config.get<string>('DATA_ENCRYPTION_KEY');
    if (!hexKey) {
      throw new Error('DATA_ENCRYPTION_KEY chưa được cấu hình');
    }
    const key = Buffer.from(hexKey, 'hex');
    if (key.length !== 32) {
      throw new Error(
        `DATA_ENCRYPTION_KEY phải là 32 byte (hex 64 ký tự), nhận được ${key.length} byte`,
      );
    }
    this.key = key;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_LENGTH); // GCM: IV không được tái dùng với cùng key
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  // Ném lỗi nếu authTag không khớp (dữ liệu bị sửa hoặc sai key).
  decrypt(stored: string): string {
    const buf = Buffer.from(stored, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
