import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { Account } from '../accounts/entities/account.entity';
import { AuthModule } from '../auth/auth.module';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { VideoCall } from './entities/video-call.entity';
import { StreamVideoClient } from './stream-video.client';
import { VideoCallsWebhookController } from './video-calls-webhook.controller';
import { VideoCallsController } from './video-calls.controller';
import { VideoCallsGateway } from './video-calls.gateway';
import { VideoCallsService } from './video-calls.service';

// Cuộc gọi video 1-1 theo đơn (bản chốt: BE/docs/video-call-ban-chot.md).
@Module({
  imports: [
    TypeOrmModule.forFeature([
      VideoCall,
      ServiceOrder,
      CustomerProfile,
      ProviderProfile,
      Account,
    ]),
    AuthModule, // TokenService.verifyAccess cho socket
    AccountsModule, // AccountsService.findAuthenticatableById (luật ACTIVE/PENDING)
  ],
  // Plan S6a: webhook đăng ký TRƯỚC controller chính — route tĩnh /webhook luôn khớp trước
  // nếu sau này controller chính thêm route có tham số cùng dạng.
  controllers: [VideoCallsWebhookController, VideoCallsController],
  providers: [StreamVideoClient, VideoCallsGateway, VideoCallsService],
})
export class VideoCallsModule {}
