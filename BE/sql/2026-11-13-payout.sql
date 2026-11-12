-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/payout (CP3)
-- Tiền ra khi đơn COMPLETED:
--   disbursements  = lệnh chi cho vườn (PENDING → PAID khi admin chuyển khoản tay)  [BẢNG MỚI]
--   escrow_ledger  = thêm loại bút toán PLATFORM_FEE (nền tảng giữ 6% khách + 12% vườn);
--                    CHECK entry_type đổi sang tên cố định CHK_escrow_ledger_entry_type.
-- Tên PK/FK/index/CHECK lấy từ TypeORM synchronize trên DB test theo entity của nhánh này
-- → sau khi chạy, synchronize không drop/tạo lại.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-13-payout.sql
-- Chạy TRƯỚC khi deploy BE mới (thiếu bảng → khách xác nhận nhận lại cây lỗi 500).
-- Chạy lại nhiều lần không lỗi. Không xoá / sửa dữ liệu cũ.
-- =====================================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Lệnh chi
CREATE TABLE IF NOT EXISTS "disbursements" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "service_order_id" uuid NOT NULL,
  "provider_id" uuid NOT NULL,
  "type" varchar(20) NOT NULL,
  "amount" bigint NOT NULL,
  "eligible_at" timestamptz NOT NULL,
  "bank_name" varchar(100),
  "bank_account" varchar(50),
  "bank_holder" varchar(100),
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "transfer_code" varchar(100),
  "paid_at" timestamptz,
  "paid_by_account_id" uuid,
  "note" text,
  CONSTRAINT "PK_2f9ea0e5b8382113aaa3e51cdfa" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_disbursements_type" CHECK ("type" IN ('PAYOUT','REFUND')),
  CONSTRAINT "CHK_disbursements_status" CHECK ("status" IN ('PENDING','PAID')),
  CONSTRAINT "CHK_disbursements_amount" CHECK ("amount" > 0),
  CONSTRAINT "FK_00fd5088d6915ec1f147873de45" FOREIGN KEY ("service_order_id")
    REFERENCES "service_orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "FK_057a9d1bfcb52d4774c5089f4a0" FOREIGN KEY ("provider_id")
    REFERENCES "provider_profiles"("id") ON DELETE RESTRICT,
  CONSTRAINT "FK_c10b0ad95dd589b3327acdc09cf" FOREIGN KEY ("paid_by_account_id")
    REFERENCES "accounts"("id") ON DELETE RESTRICT
);

-- Mỗi đơn chỉ được trả vườn 1 lần.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_disbursements_order_payout"
  ON "disbursements" ("service_order_id") WHERE "type" = 'PAYOUT';
-- Danh sách admin: lọc PENDING, xếp theo ngày được chi.
CREATE INDEX IF NOT EXISTS "IDX_disbursements_status_eligible"
  ON "disbursements" ("status", "eligible_at");

-- 2. escrow_ledger: xoá CHECK entry_type cũ (tên tự sinh, mỗi DB một tên) rồi tạo lại có tên + PLATFORM_FEE.
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'escrow_ledger'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%entry_type%'
      AND conname <> 'CHK_escrow_ledger_entry_type'
  LOOP
    EXECUTE format('ALTER TABLE "escrow_ledger" DROP CONSTRAINT %I', c);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'escrow_ledger'::regclass
      AND conname = 'CHK_escrow_ledger_entry_type'
  ) THEN
    ALTER TABLE "escrow_ledger" ADD CONSTRAINT "CHK_escrow_ledger_entry_type"
      CHECK ("entry_type" IN ('DEPOSIT','REFUND','PAYOUT','PLATFORM_FEE'));
  END IF;
END $$;

COMMIT;
