import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Account } from '../../accounts/entities/account.entity';

@Entity({ name: 'provider_profiles' })
// Ràng buộc giá trị hợp lệ ngay ở tầng DB (lớp bảo vệ ngoài DTO).
@Check(`"provider_type" IN ('NURSERY','EXPERT')`)
@Check(`"verification_status" IN ('PENDING','APPROVED','REJECTED')`)
export class ProviderProfile extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // UNIQUE = ép 1-1: mỗi account chỉ 1 hồ sơ provider.
  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @OneToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @Column({ type: 'varchar', length: 20, name: 'provider_type' })
  providerType!: 'NURSERY' | 'EXPERT';

  @Column({ type: 'varchar', length: 255, name: 'display_name' })
  displayName!: string;

  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  @Column({ type: 'text', name: 'license_info', nullable: true })
  licenseInfo!: string | null;

  @Column({
    type: 'varchar',
    length: 500,
    name: 'portfolio_url',
    nullable: true,
  })
  portfolioUrl!: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'verification_status',
    default: 'PENDING',
  })
  verificationStatus!: 'PENDING' | 'APPROVED' | 'REJECTED';

  // Lý do admin duyệt/từ chối (nhất là khi REJECTED, provider cần biết vì sao).
  @Column({ type: 'text', name: 'verification_note', nullable: true })
  verificationNote!: string | null;

  // Rating là số phi-tiền → numeric (cột tiền mới dùng bigint).
  @Column({
    type: 'numeric',
    precision: 3,
    scale: 2,
    name: 'rating_avg',
    nullable: true,
  })
  ratingAvg!: string | null;

  // Địa chỉ chữ CHỈ để hiển thị; tính phí ship luôn dùng GPS do provider tự ghim trên bản đồ.
  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

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

  // ===== CÁC CỘT DỮ LIỆU ĐĂNG KÝ BỔ SUNG TỪ REGISTER-PROVIDER.DTO =====
  @Column({ type: 'varchar', length: 100, name: 'experience', nullable: true })
  experience!: string | null;

  @Column({ type: 'text', name: 'specialties', nullable: true })
  specialties!: string | null;

  @Column({ type: 'text', name: 'service_areas', nullable: true })
  serviceAreas!: string | null;

  @Column({ type: 'text', name: 'certificates', nullable: true })
  certificates!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'bank_name', nullable: true })
  bankName!: string | null;

  @Column({ type: 'varchar', length: 50, name: 'bank_account', nullable: true })
  bankAccount!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'bank_holder', nullable: true })
  bankHolder!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'cccd_front_url', nullable: true })
  cccdFrontUrl!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'cccd_back_url', nullable: true })
  cccdBackUrl!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'selfie_url', nullable: true })
  selfieUrl!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'business_license_url', nullable: true })
  businessLicenseUrl!: string | null;
}
