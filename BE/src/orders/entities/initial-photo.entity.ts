import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import { Plant } from './plant.entity';

/**
 * Ảnh hiện trạng ban đầu của TỪNG cây — bằng chứng gốc khi tranh chấp (trụ T2).
 * Append-only: ghi 1 lần, không UPDATE/DELETE (chỉ có createdAt).
 */
@Entity({ name: 'initial_photos' })
export class InitialPhoto extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'plant_id' })
  plantId!: string;

  @ManyToOne(() => Plant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plant_id' })
  plant!: Plant;

  // Client tự upload storage ngoài rồi gửi URL (storage = mục CHƯA CHỐT của SPEC_MASTER).
  @Column({ type: 'varchar', length: 500, name: 'photo_url' })
  photoUrl!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  caption!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  analysis!: Record<string, unknown> | null;
}
