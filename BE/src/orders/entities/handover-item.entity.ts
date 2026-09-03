import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import { Handover } from './handover.entity';
import { Plant } from './plant.entity';

/**
 * Chốt từng cây trong phiên bàn giao — insert lúc complete (append-only):
 * high_risk_flag đóng băng tại thời điểm chốt, là căn cứ trách nhiệm sau này
 * (PLANT.isHighRisk có thể đổi qua re-assess, dòng này thì không).
 */
@Entity({ name: 'handover_items' })
export class HandoverItem extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'handover_id' })
  handoverId!: string;

  @ManyToOne(() => Handover, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'handover_id' })
  handover!: Handover;

  @Column({ type: 'uuid', name: 'plant_id' })
  plantId!: string;

  @ManyToOne(() => Plant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plant_id' })
  plant!: Plant;

  @Column({ type: 'boolean', name: 'high_risk_flag' })
  highRiskFlag!: boolean;
}
