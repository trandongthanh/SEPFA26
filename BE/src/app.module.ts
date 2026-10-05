import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { THROTTLERS, throttlerSkipIf } from './common/throttle';
import { envValidationSchema } from './config/env.validation';
import { buildTypeOrmOptions } from './config/typeorm.config';
import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './crypto/crypto.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { VideoCallsModule } from './video-calls/video-calls.module';
import { ProvidersModule } from './providers/providers.module';
import { CustomersModule } from './customers/customers.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { CareReportsModule } from './care-reports/care-reports.module';
import { UploadsModule } from './uploads/uploads.module';
import { EkycModule } from './ekyc/ekyc.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildTypeOrmOptions,
    }),
    // Rate limit 2 lớp: theo IP (mọi route) + theo IP+email (route có email) — xem
    // common/throttle.ts. main.ts bật trust proxy → req.ip là IP client thật sau Vercel.
    // Route nhạy cảm siết riêng bằng @Throttle ở controller. Storage in-memory: mỗi instance
    // serverless đếm riêng — đủ chặn brute-force đơn giản, muốn chặt hơn thì storage Redis.
    ThrottlerModule.forRoot({
      throttlers: THROTTLERS,
      skipIf: throttlerSkipIf,
    }),
    CryptoModule,
    AccountsModule,
    AuthModule,
    ProvidersModule,
    CustomersModule,
    OrdersModule,
    PaymentsModule,
    VideoCallsModule,
    CareReportsModule,
    UploadsModule,
    EkycModule,
  ],
  providers: [
    // Thứ tự guard = thứ tự khai báo: rate limit chạy TRƯỚC xác thực.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
