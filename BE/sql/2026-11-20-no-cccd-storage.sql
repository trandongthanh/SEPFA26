-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung)
-- Tuân thủ quy định bảo vệ dữ liệu cá nhân: KHÔNG thu giữ/lưu trữ số CCCD, ảnh CCCD, ảnh chân dung.
-- Chỉ lưu giữ: Họ tên (accounts.full_name), SĐT (accounts.phone mã hoá),
-- Địa chỉ thường trú (address), Ngày tháng năm sinh (date_of_birth), Quê quán (place_of_origin).
--
-- Chạy (thư mục BE): psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-20-no-cccd-storage.sql
-- =====================================================================================

BEGIN;

-- 1. customer_profiles: thêm date_of_birth, place_of_origin; xoá các cột CCCD/ảnh
ALTER TABLE "customer_profiles"
  ADD COLUMN IF NOT EXISTS "date_of_birth" character varying(20),
  ADD COLUMN IF NOT EXISTS "place_of_origin" character varying(255);

DROP INDEX IF EXISTS "IDX_customer_profiles_cccd_number_hash";

ALTER TABLE "customer_profiles"
  DROP COLUMN IF EXISTS "cccd_number",
  DROP COLUMN IF EXISTS "cccd_number_hash",
  DROP COLUMN IF EXISTS "cccd_front_url",
  DROP COLUMN IF EXISTS "cccd_back_url",
  DROP COLUMN IF EXISTS "selfie_with_id_url";

-- 2. provider_profiles: thêm date_of_birth, place_of_origin; xoá các cột CCCD/ảnh chân dung
ALTER TABLE "provider_profiles"
  ADD COLUMN IF NOT EXISTS "date_of_birth" character varying(20),
  ADD COLUMN IF NOT EXISTS "place_of_origin" character varying(255);

DROP INDEX IF EXISTS "IDX_provider_profiles_cccd_number_hash";

ALTER TABLE "provider_profiles"
  DROP COLUMN IF EXISTS "cccd_number",
  DROP COLUMN IF EXISTS "cccd_number_hash",
  DROP COLUMN IF EXISTS "cccd_front_url",
  DROP COLUMN IF EXISTS "cccd_back_url",
  DROP COLUMN IF EXISTS "selfie_url";

-- 3. ekyc_records: thêm place_of_residence; xoá số CCCD và URL ảnh CCCD/selfie
ALTER TABLE "ekyc_records"
  ADD COLUMN IF NOT EXISTS "place_of_residence" character varying(255);

ALTER TABLE "ekyc_records"
  DROP COLUMN IF EXISTS "id_doc_number_enc",
  DROP COLUMN IF EXISTS "id_doc_number_hash",
  DROP COLUMN IF EXISTS "front_image_url",
  DROP COLUMN IF EXISTS "back_image_url",
  DROP COLUMN IF EXISTS "selfie_image_url";

COMMIT;
