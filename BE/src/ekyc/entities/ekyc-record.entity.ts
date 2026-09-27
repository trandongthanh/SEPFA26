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

  // ===== Thông tin OCR bóc tách từ CCCD qua FPT.AI =====
  @Column({ name: 'id_doc_type', type: 'varchar', length: 50, nullable: true })
  idDocType!: string | null;

  // Số CCCD — mã hóa AES-256-GCM, không bao giờ trả ra API dạng thô.
  @Column({ name: 'id_doc_number_enc', type: 'varchar', length: 500, nullable: true })
  idDocNumberEnc!: string | null;

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

  // ===== Kết quả Face Matching =====
  @Column({ name: 'face_match', type: 'boolean', nullable: true })
  faceMatch!: boolean | null;

  @Column({ name: 'face_similarity', type: 'numeric', precision: 5, scale: 2, nullable: true })
  faceSimilarity!: string | null;

  // ===== Lý do từ chối (nếu có) =====
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason!: string | null;

  // URL ảnh CCCD mặt trước, mặt sau, selfie — lưu trên Cloudinary/S3 của hệ thống.
  @Column({ name: 'front_image_url', type: 'varchar', length: 500, nullable: true })
  frontImageUrl!: string | null;

  @Column({ name: 'back_image_url', type: 'varchar', length: 500, nullable: true })
  backImageUrl!: string | null;

  @Column({ name: 'selfie_image_url', type: 'varchar', length: 500, nullable: true })
  selfieImageUrl!: string | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;
}
