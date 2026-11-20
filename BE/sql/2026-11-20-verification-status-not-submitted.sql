-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung)
-- Sửa lỗi trạng thái mặc định hồ sơ khách hàng: thêm 'NOT_SUBMITTED' cho customer_profiles
-- khi khách vừa tạo tài khoản và chưa nộp đủ thông tin / chưa làm eKYC.
--
-- Chạy (thư mục BE): psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-20-verification-status-not-submitted.sql
-- =====================================================================================

BEGIN;

-- 1. Xoá mọi CHECK constraint cũ liên quan tới verification_status trên customer_profiles
--    (tránh phụ thuộc tên hash tự sinh CHK_... của TypeORM, an toàn khi chạy lại nhiều lần)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'customer_profiles'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%verification_status%'
  LOOP
    EXECUTE format('ALTER TABLE "public"."customer_profiles" DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 2. Gắn CHECK constraint mới có trạng thái NOT_SUBMITTED và đặt DEFAULT = 'NOT_SUBMITTED'
ALTER TABLE "customer_profiles"
  ADD CONSTRAINT "CHK_customer_profiles_verification_status"
  CHECK ("verification_status" IN ('NOT_SUBMITTED','PENDING','APPROVED','REJECTED'));

ALTER TABLE "customer_profiles"
  ALTER COLUMN "verification_status" SET DEFAULT 'NOT_SUBMITTED';

-- 3. Cập nhật các hồ sơ khách cũ đang ở PENDING nhưng thực chất chưa nộp đủ 5 trường định danh
--    (accounts.full_name, accounts.phone, address, date_of_birth, place_of_origin) về NOT_SUBMITTED
UPDATE "customer_profiles" cp
SET "verification_status" = 'NOT_SUBMITTED'
FROM "accounts" a
WHERE cp."account_id" = a."id"
  AND cp."verification_status" = 'PENDING'
  AND (
    NULLIF(BTRIM(a."full_name"), '') IS NULL
    OR NULLIF(BTRIM(a."phone"), '') IS NULL
    OR NULLIF(BTRIM(cp."address"), '') IS NULL
    OR NULLIF(BTRIM(cp."date_of_birth"), '') IS NULL
    OR NULLIF(BTRIM(cp."place_of_origin"), '') IS NULL
  );

COMMIT;
