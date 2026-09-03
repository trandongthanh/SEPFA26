import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccountsService } from '../../accounts/accounts.service';
import type { JwtPayload } from '../token.service';
import type { CurrentUserData } from '../types/current-user.type';

// Xác minh access token. Passport tự verify chữ ký + hạn; validate() thêm check nghiệp vụ.
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

  // Giá trị trả về được gắn vào request.user.
  async validate(payload: JwtPayload): Promise<CurrentUserData> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('INVALID_TOKEN_TYPE');
    }
    // Tra DB để token bị thu hồi sớm khi account bị suspend/xóa.
    const account = await this.accounts.findAuthenticatableById(payload.sub);
    if (!account) {
      throw new UnauthorizedException('ACCOUNT_INACTIVE');
    }
    return { accountId: account.id, role: account.role };
  }
}
