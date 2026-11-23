import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { OrdersModule } from '../orders/orders.module';
import { ProvidersModule } from '../providers/providers.module';
import { AdminDisbursementsController } from './admin-disbursements.controller';
import { AdminUnmatchedTransactionsController } from './admin-unmatched-transactions.controller';
import { DisbursementsService } from './disbursements.service';
import { Disbursement } from './entities/disbursement.entity';
import { EscrowLedger } from './entities/escrow-ledger.entity';
import { PaymentComponent } from './entities/payment-component.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentWebhookLog } from './entities/payment-webhook-log.entity';
import { SecurityDeposit } from './entities/security-deposit.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { UnmatchedTransactionsService } from './unmatched-transactions.service';
import { WebhooksController } from './webhooks.controller';

// Module tiền tách riêng (vòng 3): 4 bảng theo spec, không bảng PAYMENT cha.
// Import OrdersModule/CustomersModule/ProvidersModule chỉ để lấy repo (các module đó export TypeOrmModule);
// OrdersModule còn cho OrderStateService (webhook tiền bảo đảm đưa đơn sang IN_CARE).
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentComponent,
      PaymentTransaction,
      EscrowLedger,
      PaymentWebhookLog,
      Disbursement,
      SecurityDeposit,
    ]),
    OrdersModule,
    CustomersModule,
    ProvidersModule,
  ],
  controllers: [
    PaymentsController,
    WebhooksController,
    AdminDisbursementsController,
    AdminUnmatchedTransactionsController,
  ],
  providers: [
    PaymentsService,
    DisbursementsService,
    UnmatchedTransactionsService,
  ],
  exports: [TypeOrmModule],
})
export class PaymentsModule {}
