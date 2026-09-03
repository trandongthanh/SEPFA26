import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { ServiceOrder } from '../../orders/entities/service-order.entity';
import { CareReportEvidence } from './care-report-evidence.entity';

@Entity({ name: 'care_reports' })
@Index('UQ_CARE_REPORT_ORDER_PERIOD', ['serviceOrderId', 'periodStart', 'periodEnd'], {
  unique: true,
})
export class CareReport extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @ManyToOne(() => ServiceOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  @Column({ type: 'timestamptz', name: 'period_start' })
  periodStart!: Date;

  @Column({ type: 'timestamptz', name: 'period_end' })
  periodEnd!: Date;

  @Column({ type: 'varchar', length: 255, name: 'plant_name_snapshot' })
  plantNameSnapshot!: string;

  @Column({ type: 'varchar', length: 255, name: 'plant_code_snapshot' })
  plantCodeSnapshot!: string;

  @Column({ type: 'text', name: 'plot_position_snapshot' })
  plotPositionSnapshot!: string;

  @Column({ type: 'varchar', length: 50, name: 'weather' })
  weather!: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, name: 'temperature_min' })
  temperatureMin!: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, name: 'temperature_max' })
  temperatureMax!: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, name: 'humidity_min' })
  humidityMin!: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, name: 'humidity_max' })
  humidityMax!: number;

  @Column({ type: 'varchar', length: 80, name: 'substrate_status' })
  substrateStatus!: string;

  @Column({ type: 'varchar', length: 80, name: 'root_status' })
  rootStatus!: string;

  @Column({ type: 'integer', name: 'root_affected_count', nullable: true })
  rootAffectedCount!: number | null;

  @Column({ type: 'varchar', length: 80, name: 'leaf_status' })
  leafStatus!: string;

  @Column({ type: 'varchar', length: 80, name: 'shoot_status' })
  shootStatus!: string;

  @Column({ type: 'integer', name: 'watering_count', default: 0 })
  wateringCount!: number;

  @Column({ type: 'text', name: 'nutrition_note', nullable: true })
  nutritionNote!: string | null;

  @Column({ type: 'varchar', length: 80, name: 'disease_prevention' })
  diseasePrevention!: string;

  @Column({ type: 'varchar', length: 30, default: 'SUBMITTED' })
  status!: string;

  @Column({ type: 'timestamptz', name: 'submitted_at', nullable: true })
  submittedAt!: Date | null;

  @OneToMany(() => CareReportEvidence, (evidence) => evidence.careReport, {
    cascade: ['insert'],
  })
  evidences!: CareReportEvidence[];
}
