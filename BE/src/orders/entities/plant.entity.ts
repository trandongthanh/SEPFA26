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
import { ServiceOrder } from './service-order.entity';

/**
 * PLANT = dòng-cây-trong-đơn, không phải hồ sơ cây trọn đời — cây chỉ tồn tại
 * trong phạm vi 1 đơn (ranh giới hệ thống, LANCARE_HUB_BUSINESS_CONTEXT §3).
 */
@Entity({ name: 'plants' })
@Check(
  `"handover_decision" IS NULL OR "handover_decision" IN ('ACCEPT','ACCEPT_HIGH_RISK','ADJUST','REJECT')`,
)
export class Plant extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @ManyToOne(() => ServiceOrder, (order) => order.plants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  // Text tự do — đã bỏ bảng SPECIES (hệ thống không đoán giá theo loài).
  @Column({
    type: 'varchar',
    length: 255,
    name: 'species_name',
    nullable: true,
  })
  speciesName!: string | null;

  // Khách TỰ khai giá trị cây quý (tùy chọn) — nền của định giá 2 tầng + trần đền bù.
  @Column({ type: 'boolean', name: 'is_value_declared', default: false })
  isValueDeclared!: boolean;

  @Column({ type: 'bigint', name: 'declared_value', nullable: true })
  declaredValue!: string | null;

  // Trần đền bù — set tại bàn giao (vòng handover), không phải lúc tạo đơn.
  @Column({ type: 'bigint', name: 'protection_cap', nullable: true })
  protectionCap!: string | null;

  // Quyết định của provider khi thẩm định từng cây tại bàn giao.
  @Column({
    type: 'varchar',
    length: 25,
    name: 'handover_decision',
    nullable: true,
  })
  handoverDecision!: 'ACCEPT' | 'ACCEPT_HIGH_RISK' | 'ADJUST' | 'REJECT' | null;

  @Column({ type: 'boolean', name: 'is_high_risk', default: false })
  isHighRisk!: boolean;
}
