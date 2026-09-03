import { Check, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

/**
 * Bảng giá phí đi lấy cây theo khoảng cách (bậc thang). Mỗi dòng là 1 bậc km.
 * Phí 1 đơn = base_fee của bậc chứa khoảng cách + (km − min_km) × per_km_fee.
 * Bậc cuối để max_km = null (không giới hạn trên).
 *
 * Tính liền mạch giữa các bậc: chỉ nhân per_km_fee cho phần km VƯỢT mốc đầu bậc,
 * không nhân toàn bộ km → phí không giật cục khi qua ranh giới bậc.
 *
 * Bảng cấu hình độc lập (không FK tới order/provider) — admin sửa giá không cần deploy.
 * Ràng buộc "các bậc không chồng lấn / không hở" là quan hệ GIỮA các dòng nên không
 * ép được bằng CHECK trên 1 dòng; validate ở tầng service khi admin thêm/sửa bậc.
 */
@Entity({ name: 'shipping_rates' })
@Check(`"min_km" >= 0`)
@Check(`"max_km" IS NULL OR "max_km" > "min_km"`)
@Check(`"base_fee" >= 0`)
@Check(`"per_km_fee" >= 0`)
export class ShippingRate extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'numeric', precision: 6, scale: 2, name: 'min_km' })
  minKm!: string;

  // null = bậc cuối, không giới hạn trên.
  @Column({
    type: 'numeric',
    precision: 6,
    scale: 2,
    name: 'max_km',
    nullable: true,
  })
  maxKm!: string | null;

  // Tiền: bigint đơn vị đồng, trả string tránh mất chính xác (đồng bộ cách làm ở ServicePackage).
  @Column({ type: 'bigint', name: 'base_fee' })
  baseFee!: string;

  // Phí cộng thêm mỗi km trong bậc; 0 = phí phẳng cho cả bậc.
  @Column({ type: 'bigint', name: 'per_km_fee' })
  perKmFee!: string;

  // null/0 = cộng theo từng km; > 0 = cộng trọn một block km (ví dụ 5 km).
  @Column({
    type: 'numeric',
    precision: 6,
    scale: 2,
    name: 'billing_unit_km',
    nullable: true,
  })
  billingUnitKm!: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;
}
