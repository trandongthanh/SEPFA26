import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerProfile } from './entities/customer-profile.entity';
import { Account } from '../accounts/entities/account.entity';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerProfile, Account])],
  controllers: [CustomersController],
  providers: [CustomersService],
  // Export TypeOrmModule để auth (transaction register) và orders inject repository.
  exports: [TypeOrmModule],
})
export class CustomersModule {}
