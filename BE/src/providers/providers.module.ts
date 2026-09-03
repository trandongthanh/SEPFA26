import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProviderProfile } from './entities/provider-profile.entity';
import { ServicePackage } from './entities/service-package.entity';
import { Account } from '../accounts/entities/account.entity';
import { ProvidersController } from './providers.controller';
import { AdminProvidersController } from './admin-providers.controller';
import { ProvidersService } from './providers.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProviderProfile, ServicePackage, Account])],
  controllers: [ProvidersController, AdminProvidersController],
  providers: [ProvidersService],
  // Export để OrdersModule inject repo ProviderProfile/ServicePackage (tạo đơn cần đọc gói + GPS vườn).
  exports: [TypeOrmModule],
})
export class ProvidersModule {}
