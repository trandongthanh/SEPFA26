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
import { ProviderProfile } from './provider-profile.entity';

@Entity({ name: 'service_packages' })
// Chặn giá trị vô lý ngay ở DB (số ngày/cây/giá không được âm hoặc <= 0).
@Check(`"duration_days" > 0`)
@Check(`"report_frequency_days" > 0`)
@Check(`"max_plants" > 0`)
@Check(`"base_price" >= 0`)
export class ServicePackage extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // KHÔNG unique → nhiều gói cùng 1 provider (quan hệ 1-nhiều).
  @Index()
  @Column({ type: 'uuid', name: 'provider_id' })
  providerId!: string;

  @ManyToOne(() => ProviderProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider!: ProviderProfile;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'integer', name: 'duration_days' })
  durationDays!: number;

  @Column({ type: 'integer', name: 'report_frequency_days' })
  reportFrequencyDays!: number;

  @Column({ type: 'integer', name: 'max_plants' })
  maxPlants!: number;

  // Tiền: bigint, đơn vị đồng (số nguyên). Trả về string để tránh mất chính xác (như ratingAvg).
  @Column({ type: 'bigint', name: 'base_price' })
  basePrice!: string;

  @Column({ type: 'bigint', name: 'min_declared_value', nullable: true })
  minDeclaredValue!: string | null;

  @Column({ type: 'bigint', name: 'max_declared_value', nullable: true })
  maxDeclaredValue!: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ type: 'varchar', length: 20, name: 'approval_status', default: 'PENDING' })
  approvalStatus!: 'PENDING' | 'APPROVED' | 'REJECTED';

  @Column({ type: 'text', name: 'rejection_reason', nullable: true })
  rejectionReason!: string | null;
}
