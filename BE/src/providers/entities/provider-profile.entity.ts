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

  // Số lần vườn "nhận đơn rồi bỏ": tự huỷ đơn đã nhận, không tới lấy cây, tới nơi mà không nhận,
  // không nộp tiền bảo đảm. Ghi chú nội bộ cho admin (chưa phạt tiền); đơn Hết hạn vì im lặng KHÔNG tính.
  @Column({ type: 'integer', name: 'cancelled_order_count', default: 0 })
  cancelledOrderCount!: number;

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

  // Ngày tháng năm sinh và Quê quán phục vụ xác minh pháp lý & hợp đồng điện tử
  // (KHÔNG thu giữ/lưu trữ số CCCD, ảnh CCCD và ảnh chân dung).
  @Column({ type: 'varchar', length: 20, name: 'date_of_birth', nullable: true })
  dateOfBirth!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'place_of_origin', nullable: true })
  placeOfOrigin!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'business_license_url', nullable: true })
  businessLicenseUrl!: string | null;
}
