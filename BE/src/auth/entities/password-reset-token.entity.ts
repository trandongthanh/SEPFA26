import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';

// Token đặt lại mật khẩu (POST /auth/forgot-password → /auth/reset-password).
// Lưu SHA-256 của token (token thô chỉ nằm trong link gửi qua mail), dùng 1 lần, hạn ngắn.
// Tên index cố định: prod không chạy synchronize, bảng tạo bằng SQL tay (sql/2026-10-05-auth.sql).
@Entity({ name: 'password_reset_tokens' })
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_password_reset_tokens_account_id')
  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @Index('IDX_password_reset_tokens_token_hash', { unique: true })
  @Column({ type: 'varchar', length: 64, name: 'token_hash' })
  tokenHash!: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  // Đặt khi token đã được dùng để đổi mật khẩu — dùng lại → 400 RESET_TOKEN_INVALID.
  @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
  usedAt!: Date | null;

  @Column({
    type: 'timestamptz',
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
