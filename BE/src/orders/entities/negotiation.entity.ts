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
 * Phiên provider quyết định nhận/từ chối đơn — 1-1 với đơn, tạo lúc submit.
 * Trạng thái suy từ providerResponse (null = chờ, ACCEPT, REJECT) — không có cột status riêng.
 * KHÔNG có COUNTER (đã bỏ trả giá online — giá chốt thật ở bàn giao).
 * createdAt = lúc khách submit; updatedAt = lúc provider trả lời (mốc bằng chứng).
 */
@Entity({ name: 'negotiations' })
@Check(
  `"provider_response" IS NULL OR "provider_response" IN ('ACCEPT','REJECT')`,
)
export class Negotiation extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @OneToOne(() => ServiceOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'provider_response',
    nullable: true,
  })
  providerResponse!: 'ACCEPT' | 'REJECT' | null;

  @Column({ type: 'bigint', name: 'proposed_total', nullable: true })
  proposedTotal!: string | null;

  @Column({ type: 'varchar', length: 1000, name: 'pickup_location', nullable: true })
  pickupLocation!: string | null;

  @Column({ type: 'text', name: 'provider_note', nullable: true })
  providerNote!: string | null;
}
