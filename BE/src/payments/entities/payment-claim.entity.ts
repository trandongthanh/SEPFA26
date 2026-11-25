import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';
import { BaseEntity } from '../../common/entities/base.entity';
import { ServiceOrder } from '../../orders/entities/service-order.entity';
import type {
  PaymentClaimParty,
  PaymentClaimStatus,
} from '../payment-claim-rules';
import { PaymentClaimPhoto } from './payment-claim-photo.entity';
import { PaymentTransaction } from './payment-transaction.entity';

/**
 * Phiếu báo đã chuyển tiền — khách / vườn của đơn báo "tôi đã chuyển nhưng chưa được ghi nhận",
 * kèm 1–3 ảnh sao kê. `party` suy từ người gọi, không nhận từ client. `amount` là số người nộp KHAI,
 * không phải tiền đã vào — không ghi sổ ký quỹ.
 * Admin hoàn khoản tiền chưa khớp kèm phiếu → RESOLVED + `transaction_id`; phiếu sai → REJECTED + lý do.
 * Tên ràng buộc cố định để DB synchronize và DB chạy SQL tay giống nhau.
 */
@Entity({ name: 'payment_claims' })
@Check('CHK_payment_claims_party', `"party" IN ('CUSTOMER','PROVIDER')`)
@Check(
  'CHK_payment_claims_status',
  `"status" IN ('OPEN','RESOLVED','REJECTED')`,
)
@Check('CHK_payment_claims_amount', `"amount" > 0`)
// Đếm phiếu đang mở của một bên trên đơn (giới hạn 3) + danh sách phiếu của bên gọi.
@Index('IDX_payment_claims_order_party_status', [
  'serviceOrderId',
  'party',
  'status',
])
// Danh sách admin: lọc theo trạng thái, mới nhất lên đầu.
@Index('IDX_payment_claims_status_created', ['status', 'createdAt'])
export class PaymentClaim extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @ManyToOne(() => ServiceOrder, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  @Column({ type: 'varchar', length: 10 })
  party!: PaymentClaimParty;

  @Column({ type: 'uuid', name: 'submitted_by_account_id' })
  submittedByAccountId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'submitted_by_account_id' })
  submittedBy!: Account;

  @Column({ type: 'bigint' })
  amount!: string;

  // Giờ người nộp nói đã chuyển (không bắt buộc) — admin đối chiếu với giờ tiền về.
  @Column({ type: 'timestamptz', name: 'transferred_at', nullable: true })
  transferredAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status!: PaymentClaimStatus;

  // Khoản tiền chưa khớp admin đã hoàn kèm phiếu. UNIQUE → một khoản tối đa một phiếu.
  @Index('UQ_payment_claims_transaction', { unique: true })
  @Column({ type: 'uuid', name: 'transaction_id', nullable: true })
  transactionId!: string | null;

  @ManyToOne(() => PaymentTransaction, {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({ name: 'transaction_id' })
  transaction!: PaymentTransaction | null;

  @Column({ type: 'uuid', name: 'handled_by_account_id', nullable: true })
  handledByAccountId!: string | null;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'handled_by_account_id' })
  handledBy!: Account | null;

  @Column({ type: 'timestamptz', name: 'handled_at', nullable: true })
  handledAt!: Date | null;

  @Column({ type: 'text', name: 'reject_reason', nullable: true })
  rejectReason!: string | null;

  @OneToMany(() => PaymentClaimPhoto, (photo) => photo.claim)
  photos!: PaymentClaimPhoto[];
}
