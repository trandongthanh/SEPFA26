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
import { CustomerProfile } from '../../customers/entities/customer-profile.entity';
import { ServiceOrder } from '../../orders/entities/service-order.entity';
import { ProviderProfile } from '../../providers/entities/provider-profile.entity';
import { PaymentTransaction } from './payment-transaction.entity';

/**
 * Lệnh chi — tiền thật phải chuyển ra khỏi tài khoản nền tảng. Mỗi dòng có ĐÚNG MỘT người nhận:
 * vườn (`provider_id`) hoặc khách (`customer_id`).
 * PAYOUT (vườn): sinh lúc chia tiền cuối đơn (cùng transaction với bút toán PAYOUT trong escrow_ledger),
 * chờ `eligible_at` (+3 ngày để admin đối soát) rồi admin chuyển khoản tay và bấm "đã chuyển".
 * REFUND (khách): tiền sổ đơn hoàn cho khách — phần chênh cây bị từ chối lúc nhận, tiền công hoàn
 * khi vườn có lỗi — kèm 6% tương ứng; chi được ngay (`eligible_at` = lúc chia tiền).
 * COMPENSATION (khách) / SECURITY_RETURN (vườn): hai dòng của sổ bảo đảm, khai sẵn kiểu, ghi từ
 * đợt tiền bảo đảm.
 * DECLARED_RETURN (khách, chi ngay) / DECLARED_FORFEIT (vườn, chờ 3 ngày): hai dòng của sổ bảo đảm khai giá.
 * OVERPAY_RETURN (khách hoặc vườn, chi ngay): trả lại tiền chuyển dư (overpay.ts).
 * UNMATCHED_REFUND (chi ngay): admin hoàn một khoản tiền chưa khớp (transactions PENDING) — có thể không gắn
 * đơn, không gắn người nhận (admin nhập tài khoản đích); tiền này chưa từng vào sổ nên không có bút toán.
 * Tên ràng buộc cố định để DB synchronize và DB chạy SQL tay giống nhau.
 */
@Entity({ name: 'disbursements' })
@Check(
  'CHK_disbursements_type',
  `"type" IN ('PAYOUT','REFUND','SECURITY_RETURN','COMPENSATION','DECLARED_RETURN','DECLARED_FORFEIT','OVERPAY_RETURN','UNMATCHED_REFUND')`,
)
// Đúng một trong hai có giá trị: lệnh chi không người nhận hoặc hai người nhận đều là lỗi.
// Riêng UNMATCHED_REFUND: 0 hoặc 1 người nhận (người lạ / người nhà chuyển hộ) nhưng BẮT BUỘC có tài khoản đích.
@Check(
  'CHK_disbursements_recipient',
  `("type" <> 'UNMATCHED_REFUND' AND ("customer_id" IS NULL) <> ("provider_id" IS NULL)) OR ("type" = 'UNMATCHED_REFUND' AND ("customer_id" IS NULL OR "provider_id" IS NULL) AND "bank_account" IS NOT NULL)`,
)
@Check('CHK_disbursements_status', `"status" IN ('PENDING','PAID')`)
@Check('CHK_disbursements_amount', `"amount" > 0`)
// Mỗi đơn chỉ được trả vườn đúng 1 lần (bấm 2 lần / cron chạy chồng → DB chặn).
@Index('UQ_disbursements_order_payout', ['serviceOrderId'], {
  unique: true,
  where: `"type" = 'PAYOUT'`,
})
// Danh sách admin: lọc PENDING, xếp theo ngày được chi.
@Index('IDX_disbursements_status_eligible', ['status', 'eligibleAt'])
export class Disbursement extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Null chỉ với UNMATCHED_REFUND của tiền không khớp đơn nào.
  @Column({ type: 'uuid', name: 'service_order_id', nullable: true })
  serviceOrderId!: string | null;

  @ManyToOne(() => ServiceOrder, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder | null;

  // UNMATCHED_REFUND: hoàn khoản tiền vào nào. UNIQUE → một khoản chỉ hoàn được một lần.
  @Index('UQ_disbursements_source_transaction', { unique: true })
  @Column({ type: 'uuid', name: 'source_transaction_id', nullable: true })
  sourceTransactionId!: string | null;

  @ManyToOne(() => PaymentTransaction, {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({ name: 'source_transaction_id' })
  sourceTransaction!: PaymentTransaction | null;

  @Column({ type: 'uuid', name: 'provider_id', nullable: true })
  providerId!: string | null;

  @ManyToOne(() => ProviderProfile, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'provider_id' })
  provider!: ProviderProfile | null;

  @Column({ type: 'uuid', name: 'customer_id', nullable: true })
  customerId!: string | null;

  @ManyToOne(() => CustomerProfile, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer!: CustomerProfile | null;

  @Column({ type: 'varchar', length: 20 })
  type!:
    | 'PAYOUT'
    | 'REFUND'
    | 'SECURITY_RETURN'
    | 'COMPENSATION'
    | 'DECLARED_RETURN'
    | 'DECLARED_FORFEIT'
    | 'OVERPAY_RETURN'
    | 'UNMATCHED_REFUND';

  @Column({ type: 'bigint' })
  amount!: string;

  @Column({ type: 'timestamptz', name: 'eligible_at' })
  eligibleAt!: Date;

  // Bản chụp tài khoản nhận tiền lúc tạo lệnh chi — người nhận đổi hồ sơ sau đó không làm lệch lệnh chi.
  @Column({ type: 'varchar', length: 100, name: 'bank_name', nullable: true })
  bankName!: string | null;

  @Column({ type: 'varchar', length: 50, name: 'bank_account', nullable: true })
  bankAccount!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'bank_holder', nullable: true })
  bankHolder!: string | null;

  @Column({ type: 'varchar', length: 6, name: 'bank_bin', nullable: true })
  bankBin!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: 'PENDING' | 'PAID';

  @Column({
    type: 'varchar',
    length: 100,
    name: 'transfer_code',
    nullable: true,
  })
  transferCode!: string | null;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'uuid', name: 'paid_by_account_id', nullable: true })
  paidByAccountId!: string | null;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'paid_by_account_id' })
  paidBy!: Account | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  // Ảnh biên lai admin đính lúc bấm "Đã chuyển" (không bắt buộc) — người nhận xem lại được.
  @Column({ type: 'varchar', length: 500, name: 'receipt_url', nullable: true })
  receiptUrl!: string | null;
}
