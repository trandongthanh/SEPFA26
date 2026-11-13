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
import { ServiceOrder } from './service-order.entity';

export const HANDOVER_STATUSES = [
  'IN_PROGRESS',
  'AWAITING_CUSTOMER',
  'AWAITING_DEPOSIT',
  'CONFIRMED',
  'AUTO_CONFIRMED',
  'DISPUTED',
  'CANCELLED',
] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

/**
 * Phiên bàn giao — khoảnh khắc "quyền kiểm soát cây" đổi tay.
 * IN = vườn nhận cây (PAID → IN_CARE); OUT = vườn trả cây (IN_CARE → COMPLETED).
 * customerConfirmDueAt = hạn 48h khách xác nhận; quá hạn thì tự xác nhận (AUTO_CONFIRMED).
 * Phiên IN sau khi khách đồng ý biên bản chờ vườn nộp tiền bảo đảm (AWAITING_DEPOSIT, tối đa 2 giờ);
 * tiền về mới CONFIRMED. Khách không giao cây / vườn không nộp → CANCELLED (đơn huỷ theo).
 * DISPUTED: phiên OUT khi khách mở tranh chấp (dừng đồng hồ 48h) — khai sẵn cho đợt tranh chấp.
 * Mỗi đơn tối đa 1 phiên IN và 1 phiên OUT còn sống (phiên CANCELLED không tính),
 * để bấm đúp "bắt đầu trả cây" không mở 2 phiên.
 */
@Entity({ name: 'handovers' })
@Index('UQ_handovers_order_type_active', ['serviceOrderId', 'handoverType'], {
  unique: true,
  where: `"status" <> 'CANCELLED'`,
})
@Check(`"handover_type" IN ('IN','OUT')`)
@Check(
  `"status" IN ('IN_PROGRESS','AWAITING_CUSTOMER','AWAITING_DEPOSIT','CONFIRMED','AUTO_CONFIRMED','DISPUTED','CANCELLED')`,
)
export class Handover extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @ManyToOne(() => ServiceOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  @Column({ type: 'varchar', length: 10, name: 'handover_type' })
  handoverType!: 'IN' | 'OUT';

  @Column({ type: 'varchar', length: 25, default: 'IN_PROGRESS' })
  status!: HandoverStatus;

  @Column({
    type: 'timestamptz',
    name: 'customer_confirm_due_at',
    nullable: true,
  })
  customerConfirmDueAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'confirmed_at', nullable: true })
  confirmedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'locked_at', nullable: true })
  lockedAt!: Date | null;

  // Lý do huỷ phiên: vườn huỷ phiên trả cây (khách vắng nhà, hẹn lại), khách không giao cây,
  // vườn không nộp tiền bảo đảm.
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  // Ý kiến phản đối của khách với biên bản nhận cây (khách vẫn giao cây) — ảnh kèm ở
  // handover_objection_photos. Null = khách đồng ý không có ý kiến.
  @Column({ type: 'text', name: 'customer_objection_note', nullable: true })
  customerObjectionNote!: string | null;
}
