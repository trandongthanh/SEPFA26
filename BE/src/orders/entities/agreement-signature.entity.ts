import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import { Account } from '../../accounts/entities/account.entity';
import { ServiceAgreement } from './service-agreement.entity';

/**
 * Chữ ký hợp đồng — append-only (chữ ký là bằng chứng, không sửa/xóa).
 * Ký 2 giai đoạn: ONLINE (khóa giá tạm) và HANDOVER (khóa giá chính thức).
 * UNIQUE (agreement, role, phase): mỗi bên ký đúng 1 lần/giai đoạn — kể cả
 * race 2 request cùng lúc cũng chỉ 1 dòng được ghi (ràng buộc nằm ở DB).
 */
@Entity({ name: 'agreement_signatures' })
@Unique(['agreementId', 'signerRole', 'signPhase'])
@Check(`"signer_role" IN ('CUSTOMER','PROVIDER')`)
@Check(`"sign_phase" IN ('ONLINE','HANDOVER')`)
export class AgreementSignature extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'agreement_id' })
  agreementId!: string;

  @ManyToOne(() => ServiceAgreement, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agreement_id' })
  agreement!: ServiceAgreement;

  @Column({ type: 'uuid', name: 'signer_id' })
  signerId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'signer_id' })
  signer!: Account;

  @Column({ type: 'varchar', length: 20, name: 'signer_role' })
  signerRole!: 'CUSTOMER' | 'PROVIDER';

  @Column({ type: 'varchar', length: 20, name: 'sign_phase' })
  signPhase!: 'ONLINE' | 'HANDOVER';

  @Column({ type: 'timestamptz', name: 'signed_at' })
  signedAt!: Date;

  // SHA-256(agreementId|signerId|signPhase|signedAtISO) — chống chối bỏ mức đồ án.
  @Column({ type: 'varchar', length: 255, name: 'signature_hash' })
  signatureHash!: string;

  // 45 ký tự đủ cho IPv6 — bằng chứng phụ lúc ký.
  @Column({ type: 'varchar', length: 45, name: 'ip_address', nullable: true })
  ipAddress!: string | null;
}
