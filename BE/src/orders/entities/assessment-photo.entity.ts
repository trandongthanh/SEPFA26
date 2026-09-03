import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import { PlantAssessment } from './plant-assessment.entity';

/**
 * Ảnh bằng chứng thẩm định — append-only, bắt buộc ≥1/cây (service check),
 * đối xứng với INITIAL_PHOTO của khách lúc tạo đơn: trách nhiệm đổi tay phải
 * có bằng chứng 2 phía. GPS chống gian lận chụp sai chỗ; perceptualHash
 * (chống tái sử dụng ảnh cũ) để null Phase 1 — cần xử lý ảnh.
 */
@Entity({ name: 'assessment_photos' })
export class AssessmentPhoto extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'assessment_id' })
  assessmentId!: string;

  @ManyToOne(() => PlantAssessment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assessment_id' })
  assessment!: PlantAssessment;

  @Column({ type: 'varchar', length: 500, name: 'photo_url' })
  photoUrl!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  caption!: string | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    name: 'gps_lat',
    nullable: true,
  })
  gpsLat!: string | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    name: 'gps_lng',
    nullable: true,
  })
  gpsLng!: string | null;

  @Column({
    type: 'varchar',
    length: 64,
    name: 'perceptual_hash',
    nullable: true,
  })
  perceptualHash!: string | null;
}
