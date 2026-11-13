import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import { Plant } from '../../orders/entities/plant.entity';
import {
  numericColumn,
  type OverallHealth,
  type PartCondition,
  type SubstrateMoisture,
} from '../care-report.constants';
import { CareReport } from './care-report.entity';
import { CareReportEvidence } from './care-report-evidence.entity';

/**
 * Phần RIÊNG của từng cây trong một kỳ báo cáo: độ ẩm giá thể (đo trong chậu),
 * sức khỏe lá/rễ/thân, sâu bệnh, sức khỏe tổng thể, chỉ số đo đếm (tùy chọn) và ảnh.
 * Mỗi cây đang chăm có đúng 1 dòng trong mỗi báo cáo. Chỉ thêm, không sửa.
 */
@Entity({ name: 'care_report_plants' })
@Index('UQ_CARE_REPORT_PLANT', ['careReportId', 'plantId'], { unique: true })
@Check(
  'CHK_care_report_plants_substrate',
  `"substrate_moisture" IN ('LOW','MEDIUM','HIGH')`,
)
@Check(
  'CHK_care_report_plants_parts',
  `"leaf_condition" IN ('GOOD','NORMAL','POOR') AND "root_condition" IN ('GOOD','NORMAL','POOR') AND "stem_condition" IN ('GOOD','NORMAL','POOR')`,
)
@Check(
  'CHK_care_report_plants_overall',
  `"overall_health" IN ('GOOD','AVERAGE','POOR')`,
)
export class CareReportPlant extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'care_report_id' })
  careReportId!: string;

  @ManyToOne(() => CareReport, (report) => report.plants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'care_report_id' })
  careReport!: CareReport;

  @Index()
  @Column({ type: 'uuid', name: 'plant_id' })
  plantId!: string;

  @ManyToOne(() => Plant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plant_id' })
  plant!: Plant;

  @Column({ type: 'varchar', length: 10, name: 'substrate_moisture' })
  substrateMoisture!: SubstrateMoisture;

  @Column({ type: 'varchar', length: 10, name: 'leaf_condition' })
  leafCondition!: PartCondition;

  @Column({ type: 'varchar', length: 10, name: 'root_condition' })
  rootCondition!: PartCondition;

  @Column({ type: 'varchar', length: 10, name: 'stem_condition' })
  stemCondition!: PartCondition;

  @Column({ type: 'boolean', name: 'has_pest_disease' })
  hasPestDisease!: boolean;

  @Column({ type: 'varchar', length: 10, name: 'overall_health' })
  overallHealth!: OverallHealth;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  // --- Chỉ số bổ sung (tùy chọn) ---
  /** Lá dài nhất (cm) — tạm hiểu, chờ leader xác nhận. */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 1,
    name: 'leaf_length_cm',
    nullable: true,
    transformer: numericColumn,
  })
  leafLengthCm!: number | null;

  @Column({ type: 'integer', name: 'leaf_count', nullable: true })
  leafCount!: number | null;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 1,
    name: 'new_root_length_cm',
    nullable: true,
    transformer: numericColumn,
  })
  newRootLengthCm!: number | null;

  @Column({ type: 'integer', name: 'new_shoot_count', nullable: true })
  newShootCount!: number | null;

  @Column({ type: 'integer', name: 'flower_spike_count', nullable: true })
  flowerSpikeCount!: number | null;

  @Column({ type: 'integer', name: 'bud_count', nullable: true })
  budCount!: number | null;

  @Column({ type: 'integer', name: 'flower_count', nullable: true })
  flowerCount!: number | null;

  @OneToMany(() => CareReportEvidence, (photo) => photo.careReportPlant, {
    cascade: ['insert'],
  })
  photos!: CareReportEvidence[];
}
