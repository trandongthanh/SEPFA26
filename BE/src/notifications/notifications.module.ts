import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { AdminNotificationsController } from './admin-notifications.controller';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RealtimeEmitter } from './realtime-emitter.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      Account,
      CustomerProfile,
      ProviderProfile,
    ]),
  ],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [RealtimeEmitter, NotificationsService],
  exports: [NotificationsService, RealtimeEmitter, TypeOrmModule],
})
export class NotificationsModule {}
