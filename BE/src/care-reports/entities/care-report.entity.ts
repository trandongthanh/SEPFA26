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
import { BaseEntity } from '../../common/entities/base.entity';
import { ServiceOrder } from '../../orders/entities/service-order.entity';
import { numericColumn } from '../care-report.constants';
import { CareReportPlant } from './care-report-plant.entity';

/**
 * Báo cáo chăm sóc mỗi kỳ — phần CHUNG của đơn: môi trường vườn + hoạt động chăm.
 * Sức khỏe, ảnh, chỉ số đo của từng cây nằm ở `care_report_plants`.
 * Kỳ do server tính (`care-period.ts`); mỗi đơn mỗi kỳ đúng 1 báo cáo. Chỉ thêm, không sửa.
 */
@Entity({ name: 'care_reports' })
@Index('UQ_CARE_REPORT_ORDER_PERIOD', ['serviceOrderId', 'periodIndex'], {
  unique: true,
})
@Check('CHK_care_reports_period_index', `"period_index" >= 1`)
@Check('CHK_care_reports_humidity', `"air_humidity" BETWEEN 0 AND 100`)
@Check('CHK_care_reports_light', `"light_intensity" >= 0`)
@Check(
  'CHK_care_reports_watering',
  `("watered" AND "water_amount_ml" > 0) OR (NOT "watered" AND "water_amount_ml" IS NULL)`,
)
@Check(
  'CHK_care_reports_fertilizing',
  `("fertilized" AND "fertilizer_type" IS NOT NULL) OR (NOT "fertilized" AND "fertilizer_type" IS NULL)`,
)
export class CareReport extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @ManyToOne(() => ServiceOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  /** Kỳ thứ n, bắt đầu từ 1. */
  @Column({ type: 'integer', name: 'period_index' })
  periodIndex!: number;

  @Column({ type: 'timestamptz', name: 'period_start' })
  periodStart!: Date;

  @Column({ type: 'timestamptz', name: 'period_end' })
  periodEnd!: Date;

  @Column({ type: 'timestamptz', name: 'submitted_at' })
  submittedAt!: Date;

  /** Nộp sau period_end — dùng cho điểm tuân thủ sau này. */
  @Column({ type: 'boolean', name: 'is_late', default: false })
  isLate!: boolean;

  // --- Môi trường (°C, %RH, Lux) ---
  @Column({
    type: 'numeric',
    precision: 4,
    scale: 1,
    name: 'air_temperature',
    transformer: numericColumn,
  })
  airTemperature!: number;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 1,
    name: 'air_humidity',
    transformer: numericColumn,
  })
  airHumidity!: number;

  @Column({ type: 'integer', name: 'light_intensity' })
  lightIntensity!: number;

  // --- Hoạt động chăm sóc ---
  @Column({ type: 'boolean' })
  watered!: boolean;

  @Column({ type: 'integer', name: 'water_amount_ml', nullable: true })
  waterAmountMl!: number | null;

  @Column({ type: 'boolean' })
  fertilized!: boolean;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'fertilizer_type',
    nullable: true,
  })
  fertilizerType!: string | null;

  /** Cắt tỉa, vệ sinh, xử lý sâu bệnh... */
  @Column({ type: 'text', name: 'other_care_note', nullable: true })
  otherCareNote!: string | null;

  // --- Bổ sung: nước tưới (dùng chung cả vườn) ---
  @Column({
    type: 'numeric',
    precision: 3,
    scale: 1,
    name: 'water_ph',
    nullable: true,
    transformer: numericColumn,
  })
  waterPh!: number | null;

  /** mS/cm. */
  @Column({
    type: 'numeric',
    precision: 6,
    scale: 2,
    name: 'water_ec',
    nullable: true,
    transformer: numericColumn,
  })
  waterEc!: number | null;

  @OneToMany(() => CareReportPlant, (plant) => plant.careReport, {
    cascade: ['insert'],
  })
  plants!: CareReportPlant[];
}
