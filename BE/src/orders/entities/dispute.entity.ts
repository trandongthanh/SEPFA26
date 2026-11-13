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
import type { DisputeOutcome, DisputeStatus } from '../dispute-rules';
import { ServiceOrder } from './service-order.entity';

/**
 * Tranh chấp của đơn — chỉ KHÁCH mở, trong 48 giờ sau khi vườn chốt trả cây. Mỗi đơn tối đa một dòng.
 * NEGOTIATING (hai bên tự thoả thuận 3 ngày) → RESOLVED (đồng ý / khách rút) hoặc → ADMIN_REVIEW
 * (hết 3 ngày, admin phân xử từng cây, hạn mềm 5 ngày) → RESOLVED.
 * Lúc RESOLVED ghi hai số đã chốt: refund_amount (R — tiền công hoàn, lấy từ sổ đơn) và
 * compensation_amount (C — tiền đền, lấy từ sổ bảo đảm); chia tiền thật do settle-order.ts làm
 * trong cùng transaction. Đơn mẫu, thoả thuận: R 100.000, C 1.000.000 → khách nhận 1.106.000.
 * Tên ràng buộc cố định để DB synchronize và DB chạy SQL tay giống nhau.
 */
@Entity({ name: 'disputes' })
@Check(
  'CHK_disputes_status',
  `"status" IN ('NEGOTIATING','ADMIN_REVIEW','RESOLVED')`,
)
@Check(
  'CHK_disputes_outcome',
  `"outcome" IS NULL OR "outcome" IN ('AGREED','WITHDRAWN','ADJUDICATED')`,
)
@Check(
  'CHK_disputes_refund_amount',
  `"refund_amount" IS NULL OR "refund_amount" >= 0`,
)
@Check(
  'CHK_disputes_compensation_amount',
  `"compensation_amount" IS NULL OR "compensation_amount" >= 0`,
)
// Mỗi đơn tối đa một tranh chấp.
@Index('UQ_disputes_service_order_id', ['serviceOrderId'], { unique: true })
// Bộ quét hạn 3 ngày: lọc NEGOTIATING theo negotiation_due_at.
@Index('IDX_disputes_status_negotiation_due', ['status', 'negotiationDueAt'])
export class Dispute extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @ManyToOne(() => ServiceOrder, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  // FK người-hành-động trỏ ACCOUNT (quy ước toàn hệ thống) — luôn là tài khoản khách của đơn.
  @Column({ type: 'uuid', name: 'opened_by_account_id' })
  openedByAccountId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'opened_by_account_id' })
  openedBy!: Account;

  @Column({ type: 'varchar', length: 100 })
  reason!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 20, default: 'NEGOTIATING' })
  status!: DisputeStatus;

  @Column({ type: 'varchar', length: 20, nullable: true })
  outcome!: DisputeOutcome | null;

  // Mở + 3 ngày. Quá hạn mà chưa xong → bộ quét chuyển ADMIN_REVIEW.
  @Column({ type: 'timestamptz', name: 'negotiation_due_at' })
  negotiationDueAt!: Date;

  @Column({ type: 'timestamptz', name: 'escalated_at', nullable: true })
  escalatedAt!: Date | null;

  // Hạn MỀM cho admin (chuyển admin + 5 ngày): hai bên thấy là ngày dự kiến có kết quả.
  @Column({ type: 'timestamptz', name: 'admin_due_at', nullable: true })
  adminDueAt!: Date | null;

  @Column({ type: 'bigint', name: 'refund_amount', nullable: true })
  refundAmount!: string | null;

  @Column({ type: 'bigint', name: 'compensation_amount', nullable: true })
  compensationAmount!: string | null;

  @Column({ type: 'timestamptz', name: 'resolved_at', nullable: true })
  resolvedAt!: Date | null;

  // Chỉ có khi admin phân xử (outcome ADJUDICATED).
  @Column({ type: 'uuid', name: 'resolved_by_account_id', nullable: true })
  resolvedByAccountId!: string | null;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'resolved_by_account_id' })
  resolvedBy!: Account | null;

  @Column({ type: 'text', name: 'resolution_note', nullable: true })
  resolutionNote!: string | null;
}
