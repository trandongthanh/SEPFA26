import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccountsService } from '../../accounts/accounts.service';
import type { JwtPayload } from '../token.service';
import type { CurrentUserData } from '../types/current-user.type';

// Xác minh access token cho JwtAuthGuard. Passport tự verify chữ ký + hạn; validate() thêm check nghiệp vụ.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly accounts: AccountsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  // Giá trị trả về được gắn vào request.user (đọc bằng @CurrentUser()).
  async validate(payload: JwtPayload): Promise<CurrentUserData> {
    // Chặn refresh token bị đem dùng như access token.
    if (payload.type !== 'access') {
      throw new UnauthorizedException('INVALID_TOKEN_TYPE');
    }
    // Tra DB mỗi request → khoá (SUSPENDED) / xoá account có hiệu lực ngay, không chờ token hết hạn.
    const account = await this.accounts.findAuthenticatableById(payload.sub);
    if (!account) {
      throw new UnauthorizedException('ACCOUNT_INACTIVE');
    }
    return { accountId: account.id, role: account.role };
  }
}
