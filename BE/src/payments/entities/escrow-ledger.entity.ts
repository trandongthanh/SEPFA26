import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import { ServiceOrder } from '../../orders/entities/service-order.entity';
import { PaymentTransaction } from './payment-transaction.entity';

/**
 * Sổ cái ký quỹ — append-only, mỗi dòng 1 bút toán, balance_after cộng dồn
 * để kiểm toán tái dựng dòng tiền. DEPOSIT tại PAID = nạp ĐỦ toàn bộ tiền đơn
 * (KHÔNG phải cọc); REFUND khi hủy theo luật 1 mốc; PAYOUT Phase 2.
 * Đây là sổ LOGIC — tiền thật nằm ở tài khoản ngân hàng nhận, admin đối soát tay.
 */
@Entity({ name: 'escrow_ledger' })
@Check(`"entry_type" IN ('DEPOSIT','REFUND','PAYOUT')`)
export class EscrowLedger extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @ManyToOne(() => ServiceOrder, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  @Column({ type: 'uuid', name: 'transaction_id', nullable: true })
  transactionId!: string | null;

  @ManyToOne(() => PaymentTransaction, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transaction_id' })
  transaction!: PaymentTransaction | null;

  @Column({ type: 'varchar', length: 20, name: 'entry_type' })
  entryType!: 'DEPOSIT' | 'REFUND' | 'PAYOUT';

  // Dương = tiền vào escrow, âm = tiền ra.
  @Column({ type: 'bigint' })
  amount!: string;

  @Column({ type: 'bigint', name: 'balance_after' })
  balanceAfter!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}
