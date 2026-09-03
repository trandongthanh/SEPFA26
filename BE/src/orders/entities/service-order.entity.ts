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
import { CustomerProfile } from '../../customers/entities/customer-profile.entity';
import { ProviderProfile } from '../../providers/entities/provider-profile.entity';
import { ServicePackage } from '../../providers/entities/service-package.entity';
import { OrderStatus } from '../order-status';
import { Plant } from './plant.entity';

@Entity({ name: 'service_orders' })
@Check(
  `"status" IN ('DRAFT','PENDING_PROVIDER','AGREEMENT_PENDING','AWAITING_PAYMENT','PAID','HANDOVER_IN_PROGRESS','HANDOVER_AWAITING_CONFIRM','IN_CARE','REJECTED','CANCELLED')`,
)
@Check(`"plant_count" > 0`)
@Check(`"cancelled_by" IS NULL OR "cancelled_by" IN ('CUSTOMER','PROVIDER')`)
export class ServiceOrder extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Vừa mã tra cứu, vừa nội dung chuyển khoản để webhook map tiền về đúng đơn.
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 30, name: 'order_code' })
  orderCode!: string;

  // FK chủ-thể-nghiệp-vụ trỏ PROFILE (không phải ACCOUNT) — quy ước FK toàn hệ thống.
  @Index()
  @Column({ type: 'uuid', name: 'customer_id' })
  customerId!: string;

  @ManyToOne(() => CustomerProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer!: CustomerProfile;

  @Index()
  @Column({ type: 'uuid', name: 'provider_id' })
  providerId!: string;

  @ManyToOne(() => ProviderProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'provider_id' })
  provider!: ProviderProfile;

  @Column({ type: 'uuid', name: 'service_package_id' })
  servicePackageId!: string;

  // RESTRICT: gói đã có đơn thì không xóa cứng được (xóa mềm vẫn ok) — đơn cần đọc lại gói gốc.
  @ManyToOne(() => ServicePackage, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_package_id' })
  servicePackage!: ServicePackage;

  @Column({ type: 'varchar', length: 40, default: 'DRAFT' })
  status!: OrderStatus;

  @Column({ type: 'integer', name: 'plant_count' })
  plantCount!: number;

  // 4 snapshot chụp từ gói lúc TẠO đơn — mọi tính toán sau này dùng snapshot, không đọc live gói.
  @Column({ type: 'bigint', name: 'base_price_snapshot' })
  basePriceSnapshot!: string;

  // Phí đi lấy cây theo km (Google Distance Matrix × SHIPPING_RATE) — đóng băng lúc tạo đơn.
  @Column({ type: 'bigint', name: 'pickup_fee_snapshot' })
  pickupFeeSnapshot!: string;

  @Column({ type: 'integer', name: 'duration_days_snapshot' })
  durationDaysSnapshot!: number;

  @Column({ type: 'integer', name: 'report_frequency_snapshot' })
  reportFrequencySnapshot!: number;

  // Giá dịch vụ TẠM = basePrice × plantCount (KHÔNG gồm ship — ship là payment component riêng).
  @Column({ type: 'bigint', name: 'provisional_total' })
  provisionalTotal!: string;

  // Khóa giá tạm khi đủ 2 chữ ký online (thay bảng VALUATION đã bỏ).
  @Column({
    type: 'timestamptz',
    name: 'provisional_locked_at',
    nullable: true,
  })
  provisionalLockedAt!: Date | null;

  // Giá CHÍNH THỨC chốt tại bàn giao (định giá 2 tầng).
  @Column({ type: 'bigint', name: 'final_total', nullable: true })
  finalTotal!: string | null;

  @Column({ type: 'timestamptz', name: 'final_locked_at', nullable: true })
  finalLockedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'care_started_at', nullable: true })
  careStartedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'care_due_at', nullable: true })
  careDueAt!: Date | null;

  // Giờ hẹn lấy cây khách chọn lúc tạo đơn — mốc DUY NHẤT của luật hủy 1 mốc.
  @Column({ type: 'timestamptz', name: 'scheduled_pickup_at' })
  scheduledPickupAt!: Date;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'pickup_address',
    nullable: true,
  })
  pickupAddress!: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, name: 'pickup_gps_lat' })
  pickupGpsLat!: string;

  @Column({ type: 'numeric', precision: 9, scale: 6, name: 'pickup_gps_lng' })
  pickupGpsLng!: string;

  @Column({ type: 'text', name: 'customer_note', nullable: true })
  customerNote!: string | null;

  @Column({ type: 'varchar', length: 10, name: 'cancelled_by', nullable: true })
  cancelledBy!: 'CUSTOMER' | 'PROVIDER' | null;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt!: Date | null;

  @Column({
    type: 'varchar',
    length: 500,
    name: 'cancel_reason',
    nullable: true,
  })
  cancelReason!: string | null;

  @OneToMany(() => Plant, (plant) => plant.serviceOrder, {
    cascade: ['insert'],
  })
  plants!: Plant[];
}
