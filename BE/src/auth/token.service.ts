import { createHash, randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import type { Role } from '../common/constants/roles';

type ExpiresIn = JwtSignOptions['expiresIn'];

// Không để dữ liệu nhạy cảm trong payload — JWT chỉ ký, không mã hóa (ai cũng đọc được).
export interface JwtPayload {
  sub: string;
  role: Role;
  type: 'access' | 'refresh';
  // jti (JWT ID, RFC 7519): định danh duy nhất mỗi token. Không có thì 2 lần ký
  // trong cùng 1 giây (iat trùng) với cùng sub/role/type sẽ ra payload giống hệt
  // → chữ ký HMAC cũng giống hệt → 2 token trùng nhau (đã xảy ra thực tế khi login
  // 2 thiết bị liên tiếp nhanh).
  jti: string;
  // JWT tự thêm khi ký (giây kể từ epoch). Đọc exp để biết hạn token.
  iat?: number;
  exp?: number;
}

type SignInput = Pick<JwtPayload, 'sub' | 'role'>;

// Access và refresh dùng 2 secret KHÁC nhau → secret/expiry truyền theo từng lần ký/xác minh.
@Injectable()
export class TokenService {
  private readonly accessSecret: string;
  private readonly accessExpires: ExpiresIn;
  private readonly refreshSecret: string;
  private readonly refreshExpires: ExpiresIn;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessSecret = config.get<string>('JWT_ACCESS_SECRET')!;
    this.accessExpires = config.get<string>(
      'JWT_ACCESS_EXPIRES',
      '15m',
    ) as ExpiresIn;
    this.refreshSecret = config.get<string>('JWT_REFRESH_SECRET')!;
    this.refreshExpires = config.get<string>(
      'JWT_REFRESH_EXPIRES',
      '7d',
    ) as ExpiresIn;
  }

  signAccess(input: SignInput): string {
    return this.jwt.sign(
      { sub: input.sub, role: input.role, type: 'access', jti: randomUUID() },
      { secret: this.accessSecret, expiresIn: this.accessExpires },
    );
  }

  signRefresh(input: SignInput): string {
    return this.jwt.sign(
      { sub: input.sub, role: input.role, type: 'refresh', jti: randomUUID() },
      { secret: this.refreshSecret, expiresIn: this.refreshExpires },
    );
  }

  verifyAccess(token: string): JwtPayload {
    return this.jwt.verify<JwtPayload>(token, { secret: this.accessSecret });
  }

  verifyRefresh(token: string): JwtPayload {
    return this.jwt.verify<JwtPayload>(token, { secret: this.refreshSecret });
  }

  // Băm refresh token bằng SHA-256 (toàn bộ chuỗi) trước khi lưu/so khớp DB.
  // KHÔNG dùng bcrypt: bcrypt chỉ băm 72 byte đầu → các JWT chung prefix bị khớp nhầm.
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
