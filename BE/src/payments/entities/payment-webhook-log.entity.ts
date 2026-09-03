import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import { ServiceOrder } from '../../orders/entities/service-order.entity';

/**
 * Log webhook SePay — ghi TRƯỚC khi xử lý nghiệp vụ; UNIQUE sepay_txn_id là
 * chốt idempotency: webhook trùng → INSERT conflict → trả 200, không hiệu ứng kép.
 * Append-only về nghiệp vụ (chỉ UPDATE 2 cột đối soát matched/processed).
 */
@Entity({ name: 'payment_webhook_logs' })
export class PaymentWebhookLog extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100, name: 'sepay_txn_id' })
  sepayTxnId!: string;

  @Column({ type: 'jsonb', name: 'raw_payload' })
  rawPayload!: Record<string, unknown>;

  // Đơn khớp được từ nội dung CK (null = không parse ra — admin đối soát tay).
  @Column({ type: 'uuid', name: 'matched_order_id', nullable: true })
  matchedOrderId!: string | null;

  @ManyToOne(() => ServiceOrder, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'matched_order_id' })
  matchedOrder!: ServiceOrder | null;

  @Column({ type: 'boolean', default: false })
  processed!: boolean;
}
