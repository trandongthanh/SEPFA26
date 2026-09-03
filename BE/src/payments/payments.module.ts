import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { OrdersModule } from '../orders/orders.module';
import { EscrowLedger } from './entities/escrow-ledger.entity';
import { PaymentComponent } from './entities/payment-component.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentWebhookLog } from './entities/payment-webhook-log.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WebhooksController } from './webhooks.controller';

// Module tiền tách riêng (vòng 3): 4 bảng theo spec, không bảng PAYMENT cha.
// Import OrdersModule/CustomersModule chỉ để lấy repo (2 module đó export TypeOrmModule).
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentComponent,
      PaymentTransaction,
      EscrowLedger,
      PaymentWebhookLog,
    ]),
    OrdersModule,
    CustomersModule,
  ],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsService],
  exports: [TypeOrmModule],
})
export class PaymentsModule {}
