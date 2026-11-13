import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { Disbursement } from '../payments/entities/disbursement.entity';
import { EscrowLedger } from '../payments/entities/escrow-ledger.entity';
import { PaymentComponent } from '../payments/entities/payment-component.entity';
import { SecurityDeposit } from '../payments/entities/security-deposit.entity';
import { ProvidersModule } from '../providers/providers.module';
import { VideoCallsModule } from '../video-calls/video-calls.module';
import { AddonsController } from './addons.controller';
import { AddonsService } from './addons.service';
import { DistanceService } from './distance.service';
import { AddonProposal } from './entities/addon-proposal.entity';
import { AgreementSignature } from './entities/agreement-signature.entity';
import { AssessmentPhoto } from './entities/assessment-photo.entity';
import { Handover } from './entities/handover.entity';
import { HandoverItem } from './entities/handover-item.entity';
import { HandoverObjectionPhoto } from './entities/handover-objection-photo.entity';
import { InitialPhoto } from './entities/initial-photo.entity';
import { Negotiation } from './entities/negotiation.entity';
import { Plant } from './entities/plant.entity';
import { PlantAssessment } from './entities/plant-assessment.entity';
import { ServiceAgreement } from './entities/service-agreement.entity';
import { ServiceOrder } from './entities/service-order.entity';
import { ShippingRate } from './entities/shipping-rate.entity';
import { Dispute } from './entities/dispute.entity';
import { DisputeEvidence } from './entities/dispute-evidence.entity';
import { DisputeOffer } from './entities/dispute-offer.entity';
import { DisputePlant } from './entities/dispute-plant.entity';
import { AdminDisputesController } from './admin-disputes.controller';
import { DisputesController } from './disputes.controller';
import { AdminShippingRatesController } from './admin-shipping-rates.controller';
import { DisputesService } from './disputes.service';
import { HandoverService } from './handover.service';
import { OrdersController } from './orders.controller';
import { OrderDeadlinesService } from './order-deadlines.service';
import { OrderStateService } from './order-state.service';
import { OrdersService } from './orders.service';
import { PlantRecognitionService } from './plant-recognition.service';
import { ContractTemplateService } from './contract-template.service';

// Import Customers/Providers module để lấy repo profile + package (2 module đó export TypeOrmModule).
// PaymentComponent/EscrowLedger đăng ký thẳng ở đây (sinh khoản phải trả lúc ký + các bút toán
// chia tiền cuối đơn đều phải CÙNG transaction với đơn) — không import PaymentsModule để tránh
// phụ thuộc vòng (PaymentsModule đã import OrdersModule). Disbursement cũng vậy: lệnh chi tạo
// cùng transaction khách xác nhận nhận lại cây (settle-order.ts). SecurityDeposit: khoản tiền bảo đảm
// sinh cùng transaction khách đồng ý biên bản nhận cây (handover.service.ts).
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
      HandoverObjectionPhoto,
      PlantAssessment,
      AssessmentPhoto,
      PaymentComponent,
      EscrowLedger,
      Disbursement,
      SecurityDeposit,
      ShippingRate,
      Dispute,
      DisputePlant,
      DisputeEvidence,
      DisputeOffer,
      AddonProposal,
    ]),
    CustomersModule,
    ProvidersModule,
    VideoCallsModule,
    // Bộ hẹn giờ cho bộ quét ba hạn (order-deadlines.service.ts, 5 phút/lần).
    // KHÔNG nạp khi NODE_ENV=test (jest unit + e2e): thiếu ScheduleModule thì @Cron chỉ là metadata,
    // không có timer nào chạy ngầm làm đổi dữ liệu giữa các ca test hay giữ tiến trình jest —
    // test gọi thẳng các hàm công khai của OrderDeadlinesService.
    ...(process.env.NODE_ENV === 'test' ? [] : [ScheduleModule.forRoot()]),
  ],
  controllers: [
    OrdersController,
    DisputesController,
    AdminDisputesController,
    AdminShippingRatesController,
    AddonsController,
  ],
  providers: [OrdersService, HandoverService, DistanceService, DisputesService, PlantRecognitionService, ContractTemplateService, OrderStateService, AddonsService, OrderDeadlinesService],
  // OrderStateService export sẵn cho module khác (webhook thanh toán chuyển sang dùng ở đợt sau).
  exports: [TypeOrmModule, DistanceService, OrderStateService],
})
export class OrdersModule {}
