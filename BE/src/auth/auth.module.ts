import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AccountsModule } from '../accounts/accounts.module';
import { CustomersModule } from '../customers/customers.module';
import { ProvidersModule } from '../providers/providers.module';
import { RefreshToken } from './entities/refresh-token.entity';
import { TokenService } from './token.service';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken, Account]),
    PassportModule,
    // JwtModule rỗng: secret + expiry truyền theo từng lần ký/xác minh trong TokenService
    // (vì access và refresh dùng 2 secret khác nhau).
    JwtModule.register({}),
    AccountsModule, // JwtStrategy cần AccountsService để tra DB kiểm status.
    CustomersModule, // repository CustomerProfile — auto-provision khi register.
    ProvidersModule, // repository ProviderProfile — auto-provision khi register.
  ],
  controllers: [AuthController],
  providers: [TokenService, AuthService, JwtStrategy],
  exports: [TokenService, TypeOrmModule],
})
export class AuthModule {}
