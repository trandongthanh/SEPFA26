import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { MailModule } from '../mail/mail.module';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { EkycRecord } from '../ekyc/entities/ekyc-record.entity';
import { EkycModule } from '../ekyc/ekyc.module';
import { CryptoModule } from '../crypto/crypto.module';
import { RefreshToken } from './entities/refresh-token.entity';
import { TokenService } from './token.service';
import { AuthService } from './auth.service';
import { GoogleIdTokenVerifier } from './google-id-token.verifier';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken, CustomerProfile, EkycRecord]),
    PassportModule,
    // JwtModule rỗng: secret + expiry truyền theo từng lần ký/xác minh trong TokenService
    // (vì access và refresh dùng 2 secret khác nhau).
    JwtModule.register({}),
    AccountsModule, // repo Account + AccountsService (luật được đăng nhập).
    MailModule,
    CryptoModule,
    EkycModule,
  ],
  controllers: [AuthController],
  providers: [TokenService, AuthService, GoogleIdTokenVerifier, JwtStrategy],
  exports: [TokenService], // video-calls.gateway dùng verifyAccess cho socket.
})
export class AuthModule {}
