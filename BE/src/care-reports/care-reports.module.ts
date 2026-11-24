import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CareReport } from './entities/care-report.entity';
import { CareReportPlant } from './entities/care-report-plant.entity';
import { CareReportEvidence } from './entities/care-report-evidence.entity';
import { CareReportsController } from './care-reports.controller';
import { CareReportsService } from './care-reports.service';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { Plant } from '../orders/entities/plant.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CareReport,
      CareReportPlant,
      CareReportEvidence,
      ServiceOrder,
      Plant,
      ProviderProfile,
      CustomerProfile,
    ]),
  ],
  controllers: [CareReportsController],
  providers: [CareReportsService],
  exports: [TypeOrmModule],
})
export class CareReportsModule {}
