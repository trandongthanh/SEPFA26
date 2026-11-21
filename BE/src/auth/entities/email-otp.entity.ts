import {
  Check,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const EMAIL_OTP_PURPOSES = [
  'REGISTER',
  'VERIFY_EMAIL',
  'RESET_PASSWORD',
] as const;

export type EmailOtpPurpose = (typeof EMAIL_OTP_PURPOSES)[number];

/**
 * Bảng lưu mã OTP 6 chữ số gửi qua email (đăng ký, xác thực email, quên mật khẩu).
 * Lưu SHA-256 của `${purpose}:${email}:${otp}` trong `code_hash` — tuyệt đối KHÔNG lưu OTP thô.
 * Tên constraint & index cố định để khớp file SQL trên Production (sql/2026-11-20-auth-otp-and-sessions.sql).
 */
@Entity({ name: 'email_otps' })
@Check(`"purpose" IN ('REGISTER','VERIFY_EMAIL','RESET_PASSWORD')`)
@Index('IDX_email_otps_email_purpose', ['email', 'purpose'])
@Index('IDX_email_otps_expires_at', ['expiresAt'])
export class EmailOtp {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 30 })
  purpose!: EmailOtpPurpose;

  @Column({ type: 'varchar', length: 64, name: 'code_hash' })
  codeHash!: string;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'consumed_at', nullable: true })
  consumedAt!: Date | null;

  @Column({
    type: 'timestamptz',
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;
}
