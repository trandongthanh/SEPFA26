-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/bank-info-required
-- Bắt buộc lưu tài khoản ngân hàng trước + mã BIN. Đưa DB đang ở schema develop (18325e4) lên schema nhánh này:
--   customer_profiles = thêm bank_bin (mã BIN 6 số, không bắt buộc)
--   provider_profiles = thêm bank_bin
--   disbursements     = thêm bank_bin (bản chụp lúc tạo lệnh chi)
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-21-bank-info.sql
-- Chạy TRƯỚC khi deploy BE mới (thiếu cột → xem/sửa hồ sơ, chia tiền cuối đơn, lệnh chi lỗi 500).
-- Chạy lại nhiều lần không lỗi. KHÔNG sửa, KHÔNG xoá dữ liệu cũ.
--
-- Luật mới không đổi dữ liệu nhưng có tác động với dữ liệu cũ:
--   - Khách chưa khai ngân hàng: không đặt được đơn mới (409 REFUND_BANK_ACCOUNT_REQUIRED). Đơn đang chạy không bị ảnh hưởng.
--   - Vườn ĐÃ DUYỆT mà chưa khai ngân hàng: vẫn APPROVED nhưng không nhận đơn được (409 PROVIDER_BANK_INFO_REQUIRED).
--     Liệt kê để báo vườn bổ sung:
--       SELECT p.id, p.display_name, a.email FROM provider_profiles p JOIN accounts a ON a.id = p.account_id
--       WHERE p.verification_status = 'APPROVED'
--         AND (p.bank_name IS NULL OR p.bank_account IS NULL OR p.bank_holder IS NULL
--              OR p.bank_name = '' OR p.bank_account = '' OR p.bank_holder = '');
-- =====================================================================================

BEGIN;

ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "bank_bin" varchar(6);
ALTER TABLE "provider_profiles" ADD COLUMN IF NOT EXISTS "bank_bin" varchar(6);
ALTER TABLE "disbursements" ADD COLUMN IF NOT EXISTS "bank_bin" varchar(6);

COMMIT;
