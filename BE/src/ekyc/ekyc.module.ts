import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EkycRecord } from './entities/ekyc-record.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Account } from '../accounts/entities/account.entity';
import { EkycController } from './ekyc.controller';
import { EkycService } from './ekyc.service';

@Module({
  imports: [TypeOrmModule.forFeature([EkycRecord, CustomerProfile, Account])],
  controllers: [EkycController],
  providers: [EkycService],
  exports: [EkycService],
})
export class EkycModule {}
