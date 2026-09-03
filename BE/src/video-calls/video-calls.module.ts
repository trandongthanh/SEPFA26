import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { VideoCall } from './entities/video-call.entity';
import { VideoCallEvent } from './entities/video-call-event.entity';
import { VideoCallsController } from './video-calls.controller';
import { VideoCallsService } from './video-calls.service';
import { VideoCallsGateway } from './video-calls.gateway';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Account } from '../accounts/entities/account.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VideoCall,
      VideoCallEvent,
      ProviderProfile,
      ServiceOrder,
      CustomerProfile,
      Account,
    ]),
    AuthModule,
  ],
  controllers: [VideoCallsController],
  providers: [VideoCallsService, VideoCallsGateway],
  exports: [VideoCallsService, VideoCallsGateway],
})
export class VideoCallsModule { }
