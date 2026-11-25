-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/payment-proofs
-- Ảnh minh chứng thanh toán: phiếu báo đã chuyển tiền + ảnh biên lai lệnh chi.
--   payment_claims        = phiếu khách / vườn báo "đã chuyển nhưng chưa được ghi nhận"       [BẢNG MỚI]
--   payment_claim_photos  = ảnh sao kê kèm phiếu, chỉ thêm dòng                                [BẢNG MỚI]
--   disbursements         = thêm receipt_url (ảnh biên lai admin đính lúc bấm "Đã chuyển")
-- Tên PK / FK / index / CHECK lấy từ TypeORM synchronize (schema builder log) trên DB test theo entity
-- của nhánh này → sau khi chạy, synchronize không drop/tạo lại.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-25-payment-claims.sql
-- Chạy TRƯỚC khi deploy BE mới (thiếu bảng/cột → nộp phiếu, danh sách lệnh chi lỗi 500).
-- Chạy lại nhiều lần không lỗi. Chỉ thêm bảng / thêm cột, không sửa dữ liệu cũ, không đổi ràng buộc cũ.
-- =====================================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Phiếu báo đã chuyển tiền. party suy từ người gọi; amount là số người nộp khai (không ghi sổ).
CREATE TABLE IF NOT EXISTS "payment_claims" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "service_order_id" uuid NOT NULL,
  "party" varchar(10) NOT NULL,
  "submitted_by_account_id" uuid NOT NULL,
  "amount" bigint NOT NULL,
  "transferred_at" timestamptz,
  "note" text,
  "status" varchar(20) NOT NULL DEFAULT 'OPEN',
  "transaction_id" uuid,
  "handled_by_account_id" uuid,
  "handled_at" timestamptz,
  "reject_reason" text,
  CONSTRAINT "CHK_payment_claims_amount" CHECK ("amount" > 0),
  CONSTRAINT "CHK_payment_claims_status" CHECK ("status" IN ('OPEN','RESOLVED','REJECTED')),
  CONSTRAINT "CHK_payment_claims_party" CHECK ("party" IN ('CUSTOMER','PROVIDER')),
  CONSTRAINT "PK_acad236b0cb5d8556b90c7998a3" PRIMARY KEY ("id")
);

-- Một khoản tiền tối đa một phiếu (NULL không đụng nhau).
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payment_claims_transaction"
  ON "payment_claims" ("transaction_id");
-- Danh sách admin: lọc trạng thái, mới nhất lên đầu.
CREATE INDEX IF NOT EXISTS "IDX_payment_claims_status_created"
  ON "payment_claims" ("status", "created_at");
-- Đếm phiếu mở của một bên trên đơn (tối đa 3) + danh sách phiếu của bên gọi.
CREATE INDEX IF NOT EXISTS "IDX_payment_claims_order_party_status"
  ON "payment_claims" ("service_order_id", "party", "status");

-- 2. Ảnh sao kê kèm phiếu — chỉ thêm dòng, xoá phiếu thì xoá theo.
CREATE TABLE IF NOT EXISTS "payment_claim_photos" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "claim_id" uuid NOT NULL,
  "photo_url" varchar(500) NOT NULL,
  CONSTRAINT "PK_ce7320c81b0baa3f586cb4b875c" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "IDX_payment_claim_photos_claim_id"
  ON "payment_claim_photos" ("claim_id");

-- 3. Lệnh chi: ảnh biên lai (không bắt buộc).
ALTER TABLE "disbursements"
  ADD COLUMN IF NOT EXISTS "receipt_url" varchar(500);

-- 4. Khoá ngoại (tên do TypeORM sinh — giữ nguyên để synchronize nhận ra).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_bd857e7bac70cb552cbd1a9b630') THEN
    ALTER TABLE "payment_claims" ADD CONSTRAINT "FK_bd857e7bac70cb552cbd1a9b630"
      FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_046416c9c4397990d3d42d72050') THEN
    ALTER TABLE "payment_claims" ADD CONSTRAINT "FK_046416c9c4397990d3d42d72050"
      FOREIGN KEY ("submitted_by_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_235e2509f95f37cb5008212d2de') THEN
    ALTER TABLE "payment_claims" ADD CONSTRAINT "FK_235e2509f95f37cb5008212d2de"
      FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_e6c8d6bd4ad9793c1fd47014449') THEN
    ALTER TABLE "payment_claims" ADD CONSTRAINT "FK_e6c8d6bd4ad9793c1fd47014449"
      FOREIGN KEY ("handled_by_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_461cace12210996ec048bf0b426') THEN
    ALTER TABLE "payment_claim_photos" ADD CONSTRAINT "FK_461cace12210996ec048bf0b426"
      FOREIGN KEY ("claim_id") REFERENCES "payment_claims"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

COMMIT;
