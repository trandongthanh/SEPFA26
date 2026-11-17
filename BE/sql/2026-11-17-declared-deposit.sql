-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/declared-deposit
-- Tiền bảo đảm khai giá: khách khai giá cây vượt 2 × giá gói thì nộp thêm 10% giá khai cùng tiền đơn,
-- có hoàn; chỉ mất (sang vườn) khi admin phán cây đó vườn không lỗi.
--   plants              = thêm declared_deposit (số khách phải nộp cho cây, chốt lúc tạo đơn)
--   payment_components  = component_type thêm DECLARED_DEPOSIT; CHECK đổi sang tên cố định
--   escrow_ledger       = book thêm DECLARED; entry_type thêm DECLARED_IN, DECLARED_RETURN, DECLARED_FORFEIT
--   disbursements       = type thêm DECLARED_RETURN (khách), DECLARED_FORFEIT (vườn)
--   disputes            = thêm declared_forfeit_amount
-- Tên CHECK khớp entity của nhánh này → sau khi chạy, synchronize không drop/tạo lại.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-17-declared-deposit.sql
-- Chạy TRƯỚC khi deploy BE mới (thiếu cột → tạo đơn, chi tiết đơn, chia tiền cuối đơn lỗi 500).
-- Chạy lại nhiều lần không lỗi. KHÔNG sửa / xoá dữ liệu cũ: đơn cũ declared_deposit = 0, sổ DECLARED trống.
-- =====================================================================================

BEGIN;

-- 1. Cây: tiền bảo đảm khai giá khách phải nộp cho cây này. Cây cũ = 0.
ALTER TABLE "plants"
  ADD COLUMN IF NOT EXISTS "declared_deposit" bigint NOT NULL DEFAULT 0;

-- 2. Hoá đơn: thêm loại dòng DECLARED_DEPOSIT. CHECK cũ do TypeORM tự đặt tên theo biểu thức
--    → gỡ mọi CHECK trên component_type chưa mang tên cố định, rồi tạo CHECK tên cố định.
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'payment_components'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%component_type%'
      AND conname <> 'CHK_payment_components_component_type'
  LOOP
    EXECUTE format('ALTER TABLE "payment_components" DROP CONSTRAINT %I', c);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'payment_components'::regclass
      AND conname = 'CHK_payment_components_component_type'
      AND pg_get_constraintdef(oid) LIKE '%DECLARED_DEPOSIT%'
  ) THEN
    ALTER TABLE "payment_components"
      DROP CONSTRAINT IF EXISTS "CHK_payment_components_component_type";
    ALTER TABLE "payment_components" ADD CONSTRAINT "CHK_payment_components_component_type"
      CHECK ("component_type" IN ('PACKAGE_PRICE','PICKUP_FEE','ADD_ON','DECLARED_DEPOSIT'));
  END IF;
END $$;

-- 3. Sổ cái: sổ thứ ba DECLARED + 3 loại bút toán.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'escrow_ledger'::regclass
      AND conname = 'CHK_escrow_ledger_book'
      AND pg_get_constraintdef(oid) LIKE '%DECLARED%'
  ) THEN
    ALTER TABLE "escrow_ledger" DROP CONSTRAINT IF EXISTS "CHK_escrow_ledger_book";
    ALTER TABLE "escrow_ledger" ADD CONSTRAINT "CHK_escrow_ledger_book"
      CHECK ("book" IN ('ORDER','SECURITY','DECLARED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'escrow_ledger'::regclass
      AND conname = 'CHK_escrow_ledger_entry_type'
      AND pg_get_constraintdef(oid) LIKE '%DECLARED_IN%'
  ) THEN
    ALTER TABLE "escrow_ledger" DROP CONSTRAINT IF EXISTS "CHK_escrow_ledger_entry_type";
    ALTER TABLE "escrow_ledger" ADD CONSTRAINT "CHK_escrow_ledger_entry_type"
      CHECK ("entry_type" IN ('DEPOSIT','REFUND','PAYOUT','PLATFORM_FEE','SECURITY_IN','SECURITY_RETURN','COMPENSATION','DECLARED_IN','DECLARED_RETURN','DECLARED_FORFEIT'));
  END IF;
END $$;

-- 4. Lệnh chi: thêm 2 loại của sổ khai giá.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'disbursements'::regclass
      AND conname = 'CHK_disbursements_type'
      AND pg_get_constraintdef(oid) LIKE '%DECLARED_RETURN%'
  ) THEN
    ALTER TABLE "disbursements" DROP CONSTRAINT IF EXISTS "CHK_disbursements_type";
    ALTER TABLE "disbursements" ADD CONSTRAINT "CHK_disbursements_type"
      CHECK ("type" IN ('PAYOUT','REFUND','SECURITY_RETURN','COMPENSATION','DECLARED_RETURN','DECLARED_FORFEIT'));
  END IF;
END $$;

-- 5. Tranh chấp: số tiền bảo đảm khai giá của khách chuyển sang vườn khi admin phân xử.
ALTER TABLE "disputes"
  ADD COLUMN IF NOT EXISTS "declared_forfeit_amount" bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'disputes'::regclass
      AND conname = 'CHK_disputes_declared_forfeit_amount'
  ) THEN
    ALTER TABLE "disputes" ADD CONSTRAINT "CHK_disputes_declared_forfeit_amount"
      CHECK ("declared_forfeit_amount" IS NULL OR "declared_forfeit_amount" >= 0);
  END IF;
END $$;

COMMIT;
