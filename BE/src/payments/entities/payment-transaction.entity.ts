import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { ServiceOrder } from '../../orders/entities/service-order.entity';

/**
 * Giao dịch tiền thật (từ webhook SePay). Bảng TRANSACTION trong data-dictionary —
 * class đặt PaymentTransaction để khỏi trùng khái niệm transaction của TypeORM.
 * sepay_txn_id UNIQUE = lớp idempotency thứ 2 (lớp 1 là payment_webhook_logs).
 */
@Entity({ name: 'transactions' })
@Check(`"direction" IN ('IN','OUT')`)
@Check(`"status" IN ('PENDING','SUCCESS','FAILED')`)
@Check(`"amount" > 0`)
export class PaymentTransaction extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // NULL = tiền thật đã vào nhưng chưa khớp được đơn nào (nội dung CK sai/thiếu
  // mã) — admin đối soát tay rồi gán sau. Nhờ vậy tiền vô danh vẫn có dấu vết.
  @Index()
  @Column({ type: 'uuid', name: 'service_order_id', nullable: true })
  serviceOrderId!: string | null;

  @ManyToOne(() => ServiceOrder, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder | null;

  // Giờ chỉ IN (tiền vào); OUT khai sẵn cho payout Phase 2.
  @Column({ type: 'varchar', length: 10 })
  direction!: 'IN' | 'OUT';

  @Column({ type: 'bigint' })
  amount!: string;

  @Index({ unique: true })
  @Column({
    type: 'varchar',
    length: 100,
    name: 'sepay_txn_id',
    nullable: true,
  })
  sepayTxnId!: string | null;

  // Nội dung CK thực nhận — đối soát với orderCode.
  @Column({
    type: 'varchar',
    length: 255,
    name: 'transfer_content',
    nullable: true,
  })
  transferContent!: string | null;

  @Column({ type: 'varchar', length: 20 })
  status!: 'PENDING' | 'SUCCESS' | 'FAILED';

  @Column({ type: 'jsonb', name: 'raw_payload', nullable: true })
  rawPayload!: Record<string, unknown> | null;
}
