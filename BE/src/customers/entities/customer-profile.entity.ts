import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Check,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Account } from '../../accounts/entities/account.entity';

@Entity({ name: 'customer_profiles' })
@Check(`"verification_status" IN ('PENDING','APPROVED','REJECTED')`)
export class CustomerProfile extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // UNIQUE = ép 1-1: mỗi account chỉ 1 hồ sơ khách.
  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @OneToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'default_pickup_address',
    nullable: true,
  })
  defaultPickupAddress!: string | null;

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

  @Column({ type: 'varchar', length: 20, name: 'verification_status', default: 'PENDING' })
  verificationStatus!: 'PENDING' | 'APPROVED' | 'REJECTED';

  @Column({ type: 'text', name: 'verification_note', nullable: true })
  verificationNote!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'cccd_front_url', nullable: true })
  cccdFrontUrl!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'cccd_back_url', nullable: true })
  cccdBackUrl!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'selfie_with_id_url', nullable: true })
  selfieWithIdUrl!: string | null;
}
