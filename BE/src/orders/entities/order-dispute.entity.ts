import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { ServiceOrder } from './service-order.entity';

@Entity({ name: 'order_disputes' })
export class OrderDispute extends BaseEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column({ name: 'service_order_id', type: 'uuid' }) serviceOrderId!: string;
  @ManyToOne(() => ServiceOrder, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'service_order_id' }) serviceOrder!: ServiceOrder;
  @Index() @Column({ name: 'opened_by_account_id', type: 'uuid' }) openedByAccountId!: string;
  @Column({ type: 'varchar', length: 40 }) status!: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED';
  @Column({ type: 'varchar', length: 100 }) reason!: string;
  @Column({ type: 'text' }) description!: string;
  @Column({ type: 'jsonb', default: () => "'[]'" }) evidence!: Array<{ photoUrl: string; caption?: string }>;
  @Column({ type: 'text', nullable: true }) resolution!: string | null;
  @Column({ name: 'resolved_by_account_id', type: 'uuid', nullable: true }) resolvedByAccountId!: string | null;
}
