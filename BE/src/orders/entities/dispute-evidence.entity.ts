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
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import type { DisputeParty } from '../dispute-rules';
import { Dispute } from './dispute.entity';
import { Plant } from './plant.entity';

/**
 * Ảnh bằng chứng của một bên trong tranh chấp — append-only (chỉ thêm dòng, không sửa/xoá) để chuỗi
 * bằng chứng admin xem không bị đổi sau khi nộp. `party` suy từ vai trò người nộp, không nhận từ client.
 * `plant_id` tuỳ chọn: ảnh nói về cây nào (null = nói chung cả đơn).
 * `note`: ghi chú đi kèm một lần nộp (POST …/dispute/evidence) — chép vào mọi ảnh của lần nộp đó;
 * ảnh nộp lúc mở tranh chấp thì null (lời của khách đã nằm ở disputes.description).
 */
@Entity({ name: 'dispute_evidences' })
@Check('CHK_dispute_evidences_party', `"party" IN ('CUSTOMER','PROVIDER')`)
@Index('IDX_dispute_evidences_dispute_id', ['disputeId'])
export class DisputeEvidence extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'dispute_id' })
  disputeId!: string;

  @ManyToOne(() => Dispute, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispute_id' })
  dispute!: Dispute;

  @Column({ type: 'varchar', length: 10 })
  party!: DisputeParty;

  @Column({ type: 'uuid', name: 'uploaded_by_account_id' })
  uploadedByAccountId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'uploaded_by_account_id' })
  uploadedBy!: Account;

  @Column({ type: 'uuid', name: 'plant_id', nullable: true })
  plantId!: string | null;

  @ManyToOne(() => Plant, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'plant_id' })
  plant!: Plant | null;

  @Column({ type: 'varchar', length: 500, name: 'photo_url' })
  photoUrl!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  caption!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}
