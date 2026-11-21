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
import type { DisputeOfferStatus, DisputeParty } from '../dispute-rules';
import { Dispute } from './dispute.entity';

/**
 * Đề nghị thương lượng — mỗi đề nghị có HAI số: hoàn tiền công (sổ đơn, khách được thêm 6% tương ứng)
 * và tiền đền (sổ bảo đảm, không dính phí). Chỉ thêm dòng và đổi status:
 * PENDING → ACCEPTED (bên kia đồng ý) hoặc → SUPERSEDED (có đề nghị mới thay, khách rút, hết 3 ngày).
 * Ví dụ: khách đề nghị 200.000 + 3.000.000 (SUPERSEDED) → vườn đề nghị 100.000 + 1.000.000 (ACCEPTED).
 */
@Entity({ name: 'dispute_offers' })
@Check(
  'CHK_dispute_offers_proposed_by',
  `"proposed_by" IN ('CUSTOMER','PROVIDER')`,
)
@Check(
  'CHK_dispute_offers_status',
  `"status" IN ('PENDING','ACCEPTED','SUPERSEDED')`,
)
@Check('CHK_dispute_offers_refund_amount', `"refund_amount" >= 0`)
@Check('CHK_dispute_offers_compensation_amount', `"compensation_amount" >= 0`)
@Index('IDX_dispute_offers_dispute_id', ['disputeId'])
// Mỗi tranh chấp chỉ MỘT đề nghị đang chờ: đề nghị mới luôn thay đề nghị cũ.
@Index('UQ_dispute_offers_dispute_pending', ['disputeId'], {
  unique: true,
  where: `"status" = 'PENDING'`,
})
export class DisputeOffer extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'dispute_id' })
  disputeId!: string;

  @ManyToOne(() => Dispute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispute_id' })
  dispute!: Dispute;

  @Column({ type: 'varchar', length: 10, name: 'proposed_by' })
  proposedBy!: DisputeParty;

  @Column({ type: 'bigint', name: 'refund_amount' })
  refundAmount!: string;

  @Column({ type: 'bigint', name: 'compensation_amount' })
  compensationAmount!: string;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: DisputeOfferStatus;

  // Lúc bên kia bấm đồng ý (chỉ có ở dòng ACCEPTED).
  @Column({ type: 'timestamptz', name: 'responded_at', nullable: true })
  respondedAt!: Date | null;
}
