import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import type { EvidenceType } from '../care-report.constants';
import { CareReportPlant } from './care-report-plant.entity';

/** Ảnh minh chứng của một cây trong một kỳ báo cáo (toàn cảnh / lá / thân / rễ). */
@Entity({ name: 'care_report_evidence' })
@Check(
  'CHK_care_report_evidence_type',
  `"evidence_type" IN ('OVERVIEW','LEAF','STEM','ROOT')`,
)
export class CareReportEvidence extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'care_report_plant_id' })
  careReportPlantId!: string;

  @ManyToOne(() => CareReportPlant, (plant) => plant.photos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'care_report_plant_id' })
  careReportPlant!: CareReportPlant;

  @Column({ type: 'varchar', length: 10, name: 'evidence_type' })
  evidenceType!: EvidenceType;

  @Column({ type: 'varchar', length: 500, name: 'photo_url' })
  photoUrl!: string;

  @Column({ type: 'text', nullable: true })
  caption!: string | null;
}
