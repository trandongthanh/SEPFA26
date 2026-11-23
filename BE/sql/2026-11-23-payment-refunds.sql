-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/payment-refunds
-- Hoàn tiền đợt 1: thối tiền chuyển dư, admin hoàn tiền chưa khớp, vườn trả lại add-on.
--   escrow_ledger    = entry_type thêm OVERPAY_RETURN (thối tiền dư, sổ ORDER hoặc SECURITY)
--   disbursements    = type thêm OVERPAY_RETURN, UNMATCHED_REFUND; service_order_id cho NULL;
--                      thêm source_transaction_id (UNIQUE); CHECK người nhận nới cho UNMATCHED_REFUND
--   transactions     = thêm unmatched_reason, refund_disbursement_id (UNIQUE), resolved_by_account_id,
--                      resolved_at, resolution_note
--   addon_proposals  = status thêm REFUNDED; thêm refunded_at, refunded_by_account_id, refund_reason
--   payment_webhook_logs = đánh dấu processed cho log của tiền đã vào "hộp chờ" (chặn gửi lại)
-- Tên CHECK / index khớp entity của nhánh này → sau khi chạy, synchronize không drop/tạo lại.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-23-payment-refunds.sql
-- Chạy TRƯỚC khi deploy BE mới (thiếu cột → webhook, chi tiết đơn, danh sách lệnh chi lỗi 500).
-- Chạy lại nhiều lần không lỗi. KHÔNG sửa tiền / sổ cũ. Hai câu SELECT ở cuối chỉ ĐỌC (đang comment).
-- =====================================================================================

BEGIN;

-- 1. Sổ ký quỹ: bút toán thối tiền dư.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'escrow_ledger'::regclass
      AND conname = 'CHK_escrow_ledger_entry_type'
      AND pg_get_constraintdef(oid) LIKE '%OVERPAY_RETURN%'
  ) THEN
    ALTER TABLE "escrow_ledger" DROP CONSTRAINT IF EXISTS "CHK_escrow_ledger_entry_type";
    ALTER TABLE "escrow_ledger" ADD CONSTRAINT "CHK_escrow_ledger_entry_type"
      CHECK ("entry_type" IN ('DEPOSIT','REFUND','PAYOUT','PLATFORM_FEE','SECURITY_IN','SECURITY_RETURN','COMPENSATION','DECLARED_IN','DECLARED_RETURN','DECLARED_FORFEIT','OVERPAY_RETURN'));
  END IF;
END $$;

-- 2. Tiền vào: lý do chưa khớp + vết admin hoàn.
ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "unmatched_reason" varchar(40),
  ADD COLUMN IF NOT EXISTS "refund_disbursement_id" uuid,
  ADD COLUMN IF NOT EXISTS "resolved_by_account_id" uuid,
  ADD COLUMN IF NOT EXISTS "resolved_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "resolution_note" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'transactions'::regclass AND conname = 'CHK_transactions_unmatched_reason'
  ) THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "CHK_transactions_unmatched_reason"
      CHECK ("unmatched_reason" IS NULL OR "unmatched_reason" IN ('NO_CODE','CODE_NOT_FOUND','ORDER_NOT_AWAITING_PAYMENT','PAYMENT_DEADLINE_PASSED','INSUFFICIENT_AMOUNT','ADDON_NOT_PAYABLE','ADDON_INSUFFICIENT','DEPOSIT_NOT_PENDING','DEPOSIT_EXPIRED','DEPOSIT_INSUFFICIENT'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_transactions_refund_disbursement"
  ON "transactions" ("refund_disbursement_id");

-- 3. Lệnh chi: 2 loại mới, cho phép không gắn đơn, gắn khoản tiền vào được hoàn.
ALTER TABLE "disbursements" ALTER COLUMN "service_order_id" DROP NOT NULL;
ALTER TABLE "disbursements" ADD COLUMN IF NOT EXISTS "source_transaction_id" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_disbursements_source_transaction"
  ON "disbursements" ("source_transaction_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'disbursements'::regclass
      AND conname = 'CHK_disbursements_type'
      AND pg_get_constraintdef(oid) LIKE '%UNMATCHED_REFUND%'
  ) THEN
    ALTER TABLE "disbursements" DROP CONSTRAINT IF EXISTS "CHK_disbursements_type";
    ALTER TABLE "disbursements" ADD CONSTRAINT "CHK_disbursements_type"
      CHECK ("type" IN ('PAYOUT','REFUND','SECURITY_RETURN','COMPENSATION','DECLARED_RETURN','DECLARED_FORFEIT','OVERPAY_RETURN','UNMATCHED_REFUND'));
  END IF;

  -- Loại khác: đúng 1 người nhận (như cũ). UNMATCHED_REFUND: 0 hoặc 1 người nhận, bắt buộc có tài khoản đích.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'disbursements'::regclass
      AND conname = 'CHK_disbursements_recipient'
      AND pg_get_constraintdef(oid) LIKE '%UNMATCHED_REFUND%'
  ) THEN
    ALTER TABLE "disbursements" DROP CONSTRAINT IF EXISTS "CHK_disbursements_recipient";
    ALTER TABLE "disbursements" ADD CONSTRAINT "CHK_disbursements_recipient"
      CHECK (("type" <> 'UNMATCHED_REFUND' AND ("customer_id" IS NULL) <> ("provider_id" IS NULL)) OR ("type" = 'UNMATCHED_REFUND' AND ("customer_id" IS NULL OR "provider_id" IS NULL) AND "bank_account" IS NOT NULL));
  END IF;
END $$;

-- 4. Khoá ngoại tên cố định (tạo sau khi cả hai bảng đã có cột).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_transactions_refund_disbursement') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "FK_transactions_refund_disbursement"
      FOREIGN KEY ("refund_disbursement_id") REFERENCES "disbursements"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_transactions_resolved_by') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "FK_transactions_resolved_by"
      FOREIGN KEY ("resolved_by_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_disbursements_source_transaction') THEN
    ALTER TABLE "disbursements" ADD CONSTRAINT "FK_disbursements_source_transaction"
      FOREIGN KEY ("source_transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT;
  END IF;
END $$;

-- 5. Add-on: vườn trả lại add-on đã thu tiền.
ALTER TABLE "addon_proposals"
  ADD COLUMN IF NOT EXISTS "refunded_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "refunded_by_account_id" uuid,
  ADD COLUMN IF NOT EXISTS "refund_reason" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'addon_proposals'::regclass
      AND conname = 'CHK_addon_proposals_status'
      AND pg_get_constraintdef(oid) LIKE '%REFUNDED%'
  ) THEN
    ALTER TABLE "addon_proposals" DROP CONSTRAINT IF EXISTS "CHK_addon_proposals_status";
    ALTER TABLE "addon_proposals" ADD CONSTRAINT "CHK_addon_proposals_status"
      CHECK ("status" IN ('PENDING','ACCEPTED','PAID','DONE','REJECTED','EXPIRED','REFUNDED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_addon_proposals_refunded_by') THEN
    ALTER TABLE "addon_proposals" ADD CONSTRAINT "FK_addon_proposals_refunded_by"
      FOREIGN KEY ("refunded_by_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT;
  END IF;
END $$;

-- 6. Chặn "phong bì gửi lại": log của tiền đã vào hộp chờ (transactions PENDING) coi như đã xử lý xong,
--    SePay gửi lại cùng mã thì trả duplicated thay vì xét lại từ đầu và nâng lên SUCCESS.
UPDATE "payment_webhook_logs" AS l
SET "processed" = true
WHERE l."processed" = false
  AND EXISTS (
    SELECT 1 FROM "transactions" t
    WHERE t."sepay_txn_id" = l."sepay_txn_id" AND t."status" = 'PENDING'
  );

COMMIT;

-- ---- CHỈ ĐỌC, chạy tay sau khi deploy (bỏ comment) ----
-- (a) B23: đơn có giá công chốt lúc nhận cây lớn hơn tiền công khách đã trả → chia tiền sẽ lỗi, xử tay.
-- SELECT o.order_code, o.status, o.final_total, c.amount AS package_paid
-- FROM service_orders o JOIN payment_components c
--   ON c.service_order_id = o.id AND c.component_type = 'PACKAGE_PRICE'
-- WHERE o.final_total IS NOT NULL AND o.final_total > c.amount;
--
-- (b) Đơn đã kết thúc mà sổ ORDER còn dư (tiền chuyển dư trước khi có thối tiền) → admin hoàn tay.
-- SELECT o.order_code, o.status, SUM(l.amount) AS order_book_balance
-- FROM service_orders o JOIN escrow_ledger l ON l.service_order_id = o.id AND l.book = 'ORDER'
-- WHERE o.status IN ('COMPLETED','CANCELLED')
-- GROUP BY o.order_code, o.status HAVING SUM(l.amount) <> 0;
