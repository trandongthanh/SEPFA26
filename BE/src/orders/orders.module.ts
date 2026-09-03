import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { EscrowLedger } from '../payments/entities/escrow-ledger.entity';
import { PaymentComponent } from '../payments/entities/payment-component.entity';
import { ProvidersModule } from '../providers/providers.module';
import { VideoCallsModule } from '../video-calls/video-calls.module';
import { DistanceService } from './distance.service';
import { AgreementSignature } from './entities/agreement-signature.entity';
import { AssessmentPhoto } from './entities/assessment-photo.entity';
import { Handover } from './entities/handover.entity';
import { HandoverItem } from './entities/handover-item.entity';
import { InitialPhoto } from './entities/initial-photo.entity';
import { Negotiation } from './entities/negotiation.entity';
import { Plant } from './entities/plant.entity';
import { PlantAssessment } from './entities/plant-assessment.entity';
import { ServiceAgreement } from './entities/service-agreement.entity';
import { ServiceOrder } from './entities/service-order.entity';
import { ShippingRate } from './entities/shipping-rate.entity';
import { OrderDispute } from './entities/order-dispute.entity';
import { DisputesController } from './disputes.controller';
import { AdminShippingRatesController } from './admin-shipping-rates.controller';
import { DisputesService } from './disputes.service';
import { HandoverService } from './handover.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PlantRecognitionService } from './plant-recognition.service';

// Import Customers/Providers module để lấy repo profile + package (2 module đó export TypeOrmModule).
// PaymentComponent/EscrowLedger đăng ký thẳng ở đây (sinh khoản phải trả lúc ký + bút toán REFUND
// lúc confirm bàn giao đều phải CÙNG transaction với đơn) — không import PaymentsModule để tránh
// phụ thuộc vòng (PaymentsModule đã import OrdersModule).
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceOrder,
      Plant,
      InitialPhoto,
      Negotiation,
      ServiceAgreement,
      AgreementSignature,
      Handover,
      HandoverItem,
      PlantAssessment,
      AssessmentPhoto,
      PaymentComponent,
      EscrowLedger,
      ShippingRate,
      OrderDispute,
    ]),
    CustomersModule,
    ProvidersModule,
    VideoCallsModule,
  ],
  controllers: [OrdersController, DisputesController, AdminShippingRatesController],
  providers: [OrdersService, HandoverService, DistanceService, DisputesService, PlantRecognitionService],
  exports: [TypeOrmModule, DistanceService],
})
export class OrdersModule {}
