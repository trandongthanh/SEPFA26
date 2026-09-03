import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import { CareReport } from './care-report.entity';

@Entity({ name: 'care_report_evidence' })
export class CareReportEvidence extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'care_report_id' })
  careReportId!: string;

  @ManyToOne(() => CareReport, (report) => report.evidences, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'care_report_id' })
  careReport!: CareReport;

  @Column({ type: 'varchar', length: 30, name: 'evidence_type' })
  evidenceType!: 'OVERVIEW' | 'ROOT' | 'LEAF_OR_SHOOT';

  @Column({ type: 'varchar', length: 500, name: 'photo_url' })
  photoUrl!: string;

  @Column({ type: 'text', nullable: true })
  caption!: string | null;
}
