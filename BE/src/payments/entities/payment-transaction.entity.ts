import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';
import { BaseEntity } from '../../common/entities/base.entity';
import { ServiceOrder } from '../../orders/entities/service-order.entity';
import { UnmatchedReason } from '../unmatched-reasons';
import { Disbursement } from './disbursement.entity';

/**
 * Giao dịch tiền thật (từ webhook SePay). Bảng TRANSACTION trong data-dictionary —
 * class đặt PaymentTransaction để khỏi trùng khái niệm transaction của TypeORM.
 * sepay_txn_id UNIQUE = lớp idempotency thứ 2 (lớp 1 là payment_webhook_logs).
 */
@Entity({ name: 'transactions' })
@Check(`"direction" IN ('IN','OUT')`)
@Check(`"status" IN ('PENDING','SUCCESS','FAILED')`)
@Check(`"amount" > 0`)
// Tên cố định để SQL tay đổi được danh sách về sau (mảng ở unmatched-reasons.ts).
@Check(
  'CHK_transactions_unmatched_reason',
  `"unmatched_reason" IS NULL OR "unmatched_reason" IN ('NO_CODE','CODE_NOT_FOUND','ORDER_NOT_AWAITING_PAYMENT','PAYMENT_DEADLINE_PASSED','INSUFFICIENT_AMOUNT','ADDON_NOT_PAYABLE','ADDON_INSUFFICIENT','DEPOSIT_NOT_PENDING','DEPOSIT_EXPIRED','DEPOSIT_INSUFFICIENT')`,
)
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

  // ---- Tiền chưa khớp (status PENDING) — "hộp tiền" admin xử lý ----
  // Vì sao tiền không vào đơn được; webhook ghi lúc tiền về. Null = tiền vào đơn bình thường, hoặc dữ liệu cũ.
  @Column({
    type: 'varchar',
    length: 40,
    name: 'unmatched_reason',
    nullable: true,
  })
  unmatchedReason!: UnmatchedReason | null;

  // Lệnh chi trả lại khoản này. Có giá trị = ĐÃ XỬ LÝ (status vẫn PENDING: tiền chưa từng vào sổ đơn).
  @Index('UQ_transactions_refund_disbursement', { unique: true })
  @Column({ type: 'uuid', name: 'refund_disbursement_id', nullable: true })
  refundDisbursementId!: string | null;

  @ManyToOne(() => Disbursement, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'refund_disbursement_id' })
  refundDisbursement!: Disbursement | null;

  @Column({ type: 'uuid', name: 'resolved_by_account_id', nullable: true })
  resolvedByAccountId!: string | null;

  @ManyToOne(() => Account, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'resolved_by_account_id' })
  resolvedBy!: Account | null;

  @Column({ type: 'timestamptz', name: 'resolved_at', nullable: true })
  resolvedAt!: Date | null;

  // Bằng chứng admin ghi khi hoàn (bắt buộc khi không gắn đơn hoặc đổi tài khoản nhận).
  @Column({ type: 'text', name: 'resolution_note', nullable: true })
  resolutionNote!: string | null;
}
