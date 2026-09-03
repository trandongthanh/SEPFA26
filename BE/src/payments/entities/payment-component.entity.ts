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
import { ServiceOrder } from '../../orders/entities/service-order.entity';

/**
 * Thành phần thanh toán của đơn — sinh tại thời điểm ĐỦ 2 chữ ký ONLINE
 * (trước đó đơn có thể REJECT/hủy, chưa có nghĩa vụ trả tiền).
 * Tách PACKAGE_PRICE / PICKUP_FEE vì vòng đời tiền độc lập: luật hủy 1 mốc
 * hoàn dịch vụ nhưng có thể mất ship; payout Phase 2 chỉ tính phí 18% trên dịch vụ.
 */
@Entity({ name: 'payment_components' })
@Check(`"component_type" IN ('PACKAGE_PRICE','PICKUP_FEE','ADD_ON')`)
@Check(`"status" IN ('PENDING','PAID','REFUNDED','RELEASED')`)
@Check(`"amount" >= 0`)
export class PaymentComponent extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @ManyToOne(() => ServiceOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  // Null trừ khi là component của add-on (Phase 2 — bảng ADDON_PROPOSAL chưa có).
  @Column({ type: 'uuid', name: 'addon_id', nullable: true })
  addonId!: string | null;

  @Column({ type: 'varchar', length: 20, name: 'component_type' })
  componentType!: 'PACKAGE_PRICE' | 'PICKUP_FEE' | 'ADD_ON';

  @Column({ type: 'bigint' })
  amount!: string;

  // Phí nền tảng 2 phía — Phase 2 dùng (P1 luôn 0, khai sẵn đúng dictionary).
  @Column({ type: 'bigint', name: 'customer_fee', default: '0' })
  customerFee!: string;

  @Column({ type: 'bigint', name: 'provider_fee', default: '0' })
  providerFee!: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: 'PENDING' | 'PAID' | 'REFUNDED' | 'RELEASED';

  @Column({
    type: 'timestamptz',
    name: 'disburse_buffer_until_at',
    nullable: true,
  })
  disburseBufferUntilAt!: Date | null;
}
