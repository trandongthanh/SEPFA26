-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/provider-identity
-- Provider khai số CCCD (giống customer_profiles): cột mã hoá AES + cột hash SHA-256 UNIQUE.
-- Tên index khớp @Index('IDX_provider_profiles_cccd_number_hash') trong provider-profile.entity.ts
-- → synchronize sau này không drop/tạo lại.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-09-provider-cccd.sql
-- Chạy TRƯỚC khi deploy BE mới (thiếu cột → mọi query provider_profiles lỗi 500).
-- Cột mới đều nullable → không cần backfill; vườn cũ tự khai qua PUT /providers/me/profile.
-- =====================================================================================

BEGIN;

-- Số CCCD đã mã hoá: base64(IV|authTag|ciphertext) ~56 ký tự; 500 cho đồng bộ customer_profiles.
ALTER TABLE "provider_profiles"
  ADD COLUMN IF NOT EXISTS "cccd_number" character varying(500);

-- SHA-256 hex (64 ký tự) của số CCCD gốc — chỉ để check trùng, không trả ra API.
ALTER TABLE "provider_profiles"
  ADD COLUMN IF NOT EXISTS "cccd_number_hash" character varying(64);

-- UNIQUE: 2 vườn không khai trùng 1 CCCD (NULL không tính trùng nhau).
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_profiles_cccd_number_hash"
  ON "provider_profiles" ("cccd_number_hash");

COMMIT;
