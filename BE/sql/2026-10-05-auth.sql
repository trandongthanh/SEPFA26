-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/auth-completion
-- Sinh bằng TypeORM: synchronize DB tạm theo entity của origin/develop (79ff37f), rồi
-- createSchemaBuilder().log() với entity của nhánh này (ngày 05/10/2026).
-- Đã kiểm: áp file này lên DB theo develop → log() không còn câu nào thuộc auth.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-10-05-auth.sql
-- Quy ước BE/sql/: dự án chưa có migrations → mỗi thay đổi schema cho DB không synchronize
-- là 1 file <ngày>-<chủ-đề>.sql, chạy theo thứ tự tên file.
-- Chạy TRƯỚC khi deploy BE mới (thiếu bảng → POST /auth/forgot-password lỗi 500).
-- =====================================================================================

-- 0. Kiểm trước: phải KHÔNG trả dòng nào, nếu không index UNIQUE ở bước 2 sẽ lỗi.
--    (token_hash là SHA-256 của refresh token có jti ngẫu nhiên → thực tế không trùng.)
SELECT token_hash, count(*) FROM refresh_tokens GROUP BY token_hash HAVING count(*) > 1;

BEGIN;

-- uuid_generate_v4() cho cột id (DB đã có các bảng uuid khác thì extension đã có sẵn).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Bảng token đặt lại mật khẩu (POST /auth/forgot-password, /auth/reset-password)
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "account_id" uuid NOT NULL,
  "token_hash" character varying(64) NOT NULL,
  "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "used_at" TIMESTAMP WITH TIME ZONE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_d16bebd73e844c48bca50ff8d3d" PRIMARY KEY ("id"),
  CONSTRAINT "FK_f6c2a117a0876bbb6530165b505" FOREIGN KEY ("account_id")
    REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "IDX_password_reset_tokens_account_id"
  ON "password_reset_tokens" ("account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_password_reset_tokens_token_hash"
  ON "password_reset_tokens" ("token_hash");

-- 2. Tra refresh token theo hash (POST /auth/refresh, /auth/logout) không quét cả bảng.
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_refresh_tokens_token_hash"
  ON "refresh_tokens" ("token_hash");

COMMIT;

-- Ghi chú: log() trên develop còn 4 câu về video_calls / video_call_events (đổi DEFAULT
-- của video_calls.id, drop/add lại FK). Đó là lệch schema CÓ SẴN của module video-call,
-- không thuộc nhánh này — KHÔNG có trong file.
