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
import { ProviderProfile } from '../../providers/entities/provider-profile.entity';
import { PaymentTransaction } from './payment-transaction.entity';

/**
 * Khoản tiền bảo đảm vườn phải nộp lúc nhận cây = tổng mức đền của các cây vườn nhận.
 * Sinh lúc khách đồng ý biên bản nhận cây (PENDING, hạn 2 giờ); SePay báo tiền về đủ → PAID và đơn
 * mới sang IN_CARE; vườn bấm huỷ hoặc quá hạn → CANCELLED, đơn huỷ, hoàn khách 100%.
 * Đơn mẫu: cây A khai 3.000.000 + cây B không khai (2 × 200.000) → amount 3.400.000,
 * nội dung chuyển khoản `BAODAM5E6F7A8B`.
 * Tiền đã nộp nằm ở sổ bảo đảm (escrow_ledger, book SECURITY) — bảng này chỉ là "phiếu phải nộp".
 * Tên ràng buộc cố định để DB synchronize và DB chạy SQL tay giống nhau.
 */
@Entity({ name: 'security_deposits' })
@Check(
  'CHK_security_deposits_status',
  `"status" IN ('PENDING','PAID','CANCELLED')`,
)
@Check('CHK_security_deposits_amount', `"amount" >= 0`)
// Mỗi đơn chỉ một khoản còn sống (PENDING hoặc PAID); khoản đã huỷ không tính.
@Index('UQ_security_deposits_order_active', ['serviceOrderId'], {
  unique: true,
  where: `"status" <> 'CANCELLED'`,
})
// Bộ quét hạn 2 giờ: lọc PENDING theo due_at.
@Index('IDX_security_deposits_status_due', ['status', 'dueAt'])
export class SecurityDeposit extends BaseEntity {
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

  @Column({ type: 'bigint' })
  amount!: string;

  // Nội dung chuyển khoản của riêng khoản này: BAODAM + 8 hex hoa (order-code.ts).
  @Index('UQ_security_deposits_deposit_code', { unique: true })
  @Column({ type: 'varchar', length: 20, name: 'deposit_code' })
  depositCode!: string;

  @Column({ type: 'timestamptz', name: 'due_at' })
  dueAt!: Date;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: 'PENDING' | 'PAID' | 'CANCELLED';

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt!: Date | null;

  // Giao dịch SePay đã nộp khoản này (null khi chưa nộp).
  @Column({ type: 'uuid', name: 'transaction_id', nullable: true })
  transactionId!: string | null;

  @ManyToOne(() => PaymentTransaction, {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({ name: 'transaction_id' })
  transaction!: PaymentTransaction | null;
}
