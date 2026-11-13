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
import { ProviderProfile } from '../../providers/entities/provider-profile.entity';

/**
 * Lệnh chi — tiền thật phải chuyển ra khỏi tài khoản nền tảng.
 * PAYOUT: sinh lúc đơn COMPLETED (cùng transaction với bút toán PAYOUT trong escrow_ledger),
 * chờ `eligible_at` (COMPLETED + 3 ngày) rồi admin chuyển khoản tay và bấm "đã chuyển" (CP4).
 * REFUND: để dành cho hoàn tiền khách sau này, đợt này chưa ghi.
 * Tên ràng buộc khớp sql/2026-11-13-payout.sql để DB synchronize và DB chạy SQL tay giống nhau.
 */
@Entity({ name: 'disbursements' })
@Check('CHK_disbursements_type', `"type" IN ('PAYOUT','REFUND')`)
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

  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @ManyToOne(() => ServiceOrder, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  @Column({ type: 'uuid', name: 'provider_id' })
  providerId!: string;

  @ManyToOne(() => ProviderProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'provider_id' })
  provider!: ProviderProfile;

  @Column({ type: 'varchar', length: 20 })
  type!: 'PAYOUT' | 'REFUND';

  @Column({ type: 'bigint' })
  amount!: string;

  @Column({ type: 'timestamptz', name: 'eligible_at' })
  eligibleAt!: Date;

  // Bản chụp tài khoản nhận tiền lúc tạo lệnh chi — vườn đổi hồ sơ sau đó không làm lệch lệnh chi.
  @Column({ type: 'varchar', length: 100, name: 'bank_name', nullable: true })
  bankName!: string | null;

  @Column({ type: 'varchar', length: 50, name: 'bank_account', nullable: true })
  bankAccount!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'bank_holder', nullable: true })
  bankHolder!: string | null;

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
}
