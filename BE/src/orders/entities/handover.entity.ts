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

/**
 * Phiên bàn giao — khoảnh khắc "quyền kiểm soát cây" chuyển sang provider.
 * Giờ chỉ IN (nhận cây); OUT khai sẵn cho check-out Phase 2.
 * customerConfirmDueAt ghi sẵn hạn 48h — cron auto-confirm HOÃN (teammate thêm
 * @Cron sau, không phải sửa schema); AUTO_CONFIRMED vẫn nằm trong CHECK.
 */
@Entity({ name: 'handovers' })
@Check(`"handover_type" IN ('IN','OUT')`)
@Check(
  `"status" IN ('IN_PROGRESS','AWAITING_CUSTOMER','CONFIRMED','AUTO_CONFIRMED','CANCELLED')`,
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
  status!:
    | 'IN_PROGRESS'
    | 'AWAITING_CUSTOMER'
    | 'CONFIRMED'
    | 'AUTO_CONFIRMED'
    | 'CANCELLED';

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
}
