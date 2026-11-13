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
import type { DisputeVerdict } from '../dispute-rules';
import { Dispute } from './dispute.entity';
import { Plant } from './plant.entity';

/**
 * Cây bị khiếu nại trong một tranh chấp — khách tick lúc mở. `verdict` null cho tới khi admin phân xử:
 * NOT_AT_FAULT vườn không lỗi · SERVICE_FAULT vườn lỗi, chỉ hoàn tiền công cây đó (200.000) ·
 * VALUE_LOST vườn lỗi và cây mất giá trị: hoàn tiền công + đền trọn mức đền (cây A: 3.000.000).
 * Tranh chấp kết thúc bằng thoả thuận / khách rút thì verdict vẫn null.
 */
@Entity({ name: 'dispute_plants' })
@Check(
  'CHK_dispute_plants_verdict',
  `"verdict" IS NULL OR "verdict" IN ('NOT_AT_FAULT','SERVICE_FAULT','VALUE_LOST')`,
)
@Index('UQ_dispute_plants_dispute_plant', ['disputeId', 'plantId'], {
  unique: true,
})
export class DisputePlant extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'dispute_id' })
  disputeId!: string;

  @ManyToOne(() => Dispute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispute_id' })
  dispute!: Dispute;

  @Column({ type: 'uuid', name: 'plant_id' })
  plantId!: string;

  @ManyToOne(() => Plant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plant_id' })
  plant!: Plant;

  @Column({ type: 'varchar', length: 20, nullable: true })
  verdict!: DisputeVerdict | null;
}
