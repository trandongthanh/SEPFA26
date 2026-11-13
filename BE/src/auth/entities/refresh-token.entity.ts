import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';

@Entity({ name: 'refresh_tokens' })
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  // UNIQUE: /auth/refresh + /auth/logout tra theo token_hash → cần index (trước đây quét cả bảng).
  // SHA-256 hex dài 64 nhưng GIỮ length 255: đổi length thì synchronize DROP + tạo lại cột
  // (mất dữ liệu phiên trên DB dev). DB không chạy synchronize (prod): tạo index bằng SQL tay,
  // xem sql/2026-10-05-auth.sql. Tên index CỐ ĐỊNH để SQL tay trên prod khớp với synchronize ở dev.
  @Index('IDX_refresh_tokens_token_hash', { unique: true })
  @Column({ type: 'varchar', length: 255, name: 'token_hash' })
  tokenHash!: string;

  @Index()
  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'varchar', length: 255, name: 'user_agent', nullable: true })
  userAgent!: string | null;

  @Column({
    type: 'timestamptz',
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
