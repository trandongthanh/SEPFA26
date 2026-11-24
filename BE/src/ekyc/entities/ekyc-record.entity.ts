import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Check,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Account } from '../../accounts/entities/account.entity';

@Entity('ekyc_records')
@Check(`"status" IN ('PENDING', 'PROCESSING', 'VERIFIED', 'REJECTED')`)
export class EkycRecord extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @OneToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'PENDING' })
  status!: string;

  // ===== Thông tin OCR bóc tách từ CCCD trong RAM (KHÔNG lưu số CCCD & ảnh) =====
  @Column({ name: 'id_doc_type', type: 'varchar', length: 50, nullable: true })
  idDocType!: string | null;

  @Column({ name: 'full_name_extracted', type: 'varchar', length: 255, nullable: true })
  fullNameExtracted!: string | null;

  @Column({ name: 'date_of_birth', type: 'varchar', length: 20, nullable: true })
  dateOfBirth!: string | null;

  @Column({ name: 'gender', type: 'varchar', length: 10, nullable: true })
  gender!: string | null;

  @Column({ name: 'nationality', type: 'varchar', length: 100, nullable: true })
  nationality!: string | null;

  @Column({ name: 'place_of_origin', type: 'varchar', length: 255, nullable: true })
  placeOfOrigin!: string | null;

  @Column({ name: 'place_of_residence', type: 'varchar', length: 255, nullable: true })
  placeOfResidence!: string | null;

  // ===== Kết quả Face Matching =====
  @Column({ name: 'face_match', type: 'boolean', nullable: true })
  faceMatch!: boolean | null;

  @Column({ name: 'face_similarity', type: 'numeric', precision: 5, scale: 2, nullable: true })
  faceSimilarity!: string | null;

  // ===== Lý do từ chối (nếu có) =====
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  // ===== Anti-Fraud Detection Results (Self-hosted AI Service) =====
  @Column({ name: 'fraud_score', type: 'numeric', precision: 5, scale: 2, nullable: true })
  fraudScore!: string | null;

  @Column({ name: 'liveness_score', type: 'numeric', precision: 5, scale: 2, nullable: true })
  livenessScore!: string | null;

  @Column({ name: 'antifraud_details', type: 'jsonb', nullable: true })
  antifraudDetails!: Record<string, unknown> | null;
}
