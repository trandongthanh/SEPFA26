import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { ServiceOrder } from './service-order.entity';

/**
 * Hợp đồng dịch vụ — 1-1 với đơn, tạo lúc provider ACCEPT (status PENDING),
 * đủ 2 chữ ký ONLINE → SIGNED. termsSnapshot chụp toàn bộ điều khoản tại thời
 * điểm ACCEPT: về sau gói/hồ sơ đổi cũng không ảnh hưởng bản đã ký.
 */
@Entity({ name: 'service_agreements' })
@Check(`"status" IN ('PENDING','SIGNED','CANCELLED')`)
export class ServiceAgreement extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @OneToOne(() => ServiceOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  // Mã hợp đồng tham chiếu pháp lý (AGR + 8 hex hoa).
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40, name: 'agreement_no' })
  agreementNo!: string;

  @Column({ type: 'jsonb', name: 'terms_snapshot' })
  termsSnapshot!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: 'PENDING' | 'SIGNED' | 'CANCELLED';
}
