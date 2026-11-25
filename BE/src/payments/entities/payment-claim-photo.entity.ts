import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import { PaymentClaim } from './payment-claim.entity';

/**
 * Ảnh sao kê kèm phiếu báo đã chuyển tiền — append-only (chỉ thêm dòng, không sửa/xoá) để bằng chứng
 * admin xem không bị đổi sau khi nộp. URL lấy từ route tải ảnh có sẵn.
 */
@Entity({ name: 'payment_claim_photos' })
@Index('IDX_payment_claim_photos_claim_id', ['claimId'])
export class PaymentClaimPhoto extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'claim_id' })
  claimId!: string;

  @ManyToOne(() => PaymentClaim, (claim) => claim.photos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'claim_id' })
  claim!: PaymentClaim;

  @Column({ type: 'varchar', length: 500, name: 'photo_url' })
  photoUrl!: string;
}
