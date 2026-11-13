import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';
import { BaseEntity } from '../../common/entities/base.entity';
import type { OverallHealth } from '../../care-reports/care-report.constants';
import type { AddonExpiredReason, AddonStatus } from '../addon-rules';
import { Plant } from './plant.entity';
import { ServiceOrder } from './service-order.entity';

/**
 * Đề xuất add-on — việc phát sinh ngoài gói mà vườn đề nghị làm trong lúc đang chăm (đơn IN_CARE).
 * Khách đồng ý thì trả tiền riêng qua `addon_code`; vườn chỉ làm khi tiền đã về (PAID) rồi báo xong (DONE).
 * Đề xuất bị từ chối / hết hạn KHÔNG xoá: là bằng chứng vườn đã cảnh báo nếu sau này cây xấu đi.
 * Tên ràng buộc khớp sql/2026-11-13-addons.sql để DB synchronize và DB chạy SQL tay giống nhau.
 */
@Entity({ name: 'addon_proposals' })
@Check(
  'CHK_addon_proposals_status',
  `"status" IN ('PENDING','ACCEPTED','PAID','DONE','REJECTED','EXPIRED')`,
)
@Check('CHK_addon_proposals_price', `"price" > 0`)
@Check(
  'CHK_addon_proposals_expired_reason',
  `"expired_reason" IS NULL OR "expired_reason" IN ('NO_RESPONSE','NOT_PAID','ORDER_RETURNING')`,
)
@Check(
  'CHK_addon_proposals_done_plant_health',
  `"done_plant_health" IS NULL OR "done_plant_health" IN ('GOOD','AVERAGE','POOR')`,
)
// Danh sách đề xuất của một đơn + đếm đề xuất đang mở.
@Index('IDX_addon_proposals_order_status', ['serviceOrderId', 'status'])
@Index('UQ_addon_proposals_addon_code', ['addonCode'], { unique: true })
export class AddonProposal extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @ManyToOne(() => ServiceOrder, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  // Tuỳ chọn: cây được làm. Null = việc cho cả đơn.
  @Column({ type: 'uuid', name: 'plant_id', nullable: true })
  plantId!: string | null;

  @ManyToOne(() => Plant, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'plant_id' })
  plant!: Plant | null;

  // Nội dung chuyển khoản của riêng đề xuất này (ADDON + 8 hex) — webhook khớp tiền theo mã này.
  @Column({ type: 'varchar', length: 20, name: 'addon_code' })
  addonCode!: string;

  @Column({ type: 'varchar', length: 120 })
  title!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'bigint' })
  price!: string;

  // Phí dịch vụ 6% khách trả thêm — chốt lúc khách đồng ý, trước đó là 0.
  @Column({ type: 'bigint', name: 'customer_fee', default: '0' })
  customerFee!: string;

  @Column({ type: 'jsonb', name: 'photo_urls' })
  photoUrls!: string[];

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: AddonStatus;

  @Column({ type: 'timestamptz', name: 'respond_due_at' })
  respondDueAt!: Date;

  @Column({ type: 'timestamptz', name: 'decided_at', nullable: true })
  decidedAt!: Date | null;

  @Column({ type: 'text', name: 'customer_note', nullable: true })
  customerNote!: string | null;

  @Column({ type: 'timestamptz', name: 'payment_due_at', nullable: true })
  paymentDueAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'done_at', nullable: true })
  doneAt!: Date | null;

  @Column({ type: 'jsonb', name: 'done_photo_urls', nullable: true })
  donePhotoUrls!: string[] | null;

  @Column({ type: 'text', name: 'done_note', nullable: true })
  doneNote!: string | null;

  // Tình trạng cây sau khi làm (cùng thang với báo cáo chăm sóc). Null = chưa xong hoặc add-on cho cả đơn.
  @Column({
    type: 'varchar',
    length: 10,
    name: 'done_plant_health',
    nullable: true,
  })
  donePlantHealth!: OverallHealth | null;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'expired_reason',
    nullable: true,
  })
  expiredReason!: AddonExpiredReason | null;

  @Column({ type: 'timestamptz', name: 'expired_at', nullable: true })
  expiredAt!: Date | null;

  @Column({ type: 'uuid', name: 'created_by_account_id' })
  createdByAccountId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_account_id' })
  createdBy!: Account;
}
