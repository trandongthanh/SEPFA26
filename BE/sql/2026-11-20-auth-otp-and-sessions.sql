-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung)
-- Bổ sung:
--   1. accounts.email_verified_at: ghi nhận thời điểm xác thực email (qua OTP hoặc Google Sign-In)
--   2. email_otps: bảng lưu mã OTP 6 chữ số (dạng SHA-256 hash) cho đăng ký, xác thực email, quên mật khẩu
--
-- Chạy (thư mục BE): psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-20-auth-otp-and-sessions.sql
-- =====================================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Thêm cột email_verified_at trên accounts & backfill các tài khoản hiện hữu
ALTER TABLE "accounts"
  ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP WITH TIME ZONE;

UPDATE "accounts"
SET "email_verified_at" = COALESCE("created_at", now())
WHERE "email_verified_at" IS NULL;

-- 2. Tạo bảng email_otps lưu OTP dạng băm SHA-256 (không lưu OTP thô)
CREATE TABLE IF NOT EXISTS "email_otps" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "email" character varying(255) NOT NULL,
  "purpose" character varying(30) NOT NULL,
  "code_hash" character varying(64) NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "consumed_at" TIMESTAMP WITH TIME ZONE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PK_email_otps_id" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_email_otps_purpose" CHECK ("purpose" IN ('REGISTER','VERIFY_EMAIL','RESET_PASSWORD'))
);

CREATE INDEX IF NOT EXISTS "IDX_email_otps_email_purpose"
  ON "email_otps" ("email", "purpose");

CREATE INDEX IF NOT EXISTS "IDX_email_otps_expires_at"
  ON "email_otps" ("expires_at");

COMMIT;
