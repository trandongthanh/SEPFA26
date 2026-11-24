-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/dispute
-- Tranh chấp + tiền bảo đảm. Đưa DB đang ở schema develop (e3053f7) lên schema nhánh này:
--   security_deposits          = khoản tiền bảo đảm vườn phải nộp lúc nhận cây          [BẢNG MỚI]
--   handover_objection_photos  = ảnh khách kèm ý kiến phản đối biên bản nhận cây        [BẢNG MỚI]
--   disputes, dispute_plants, dispute_evidences, dispute_offers = tranh chấp viết lại   [BẢNG MỚI]
--   order_disputes             = bảng tranh chấp cũ, chỉ có dữ liệu thử                 [XOÁ]
--   escrow_ledger              = thêm cột book (ORDER | SECURITY); entry_type thêm
--                                SECURITY_IN, SECURITY_RETURN, COMPENSATION
--   disbursements              = thêm customer_id; provider_id cho phép null; mỗi lệnh chi đúng
--                                một người nhận; type thêm SECURITY_RETURN, COMPENSATION
--   handovers                  = status thêm AWAITING_DEPOSIT, DISPUTED; thêm customer_objection_note
--   plants                     = bỏ ADJUST khỏi handover_decision (dòng cũ ADJUST đổi thành ACCEPT)
--   customer_profiles          = thêm bank_name, bank_account, bank_holder, lost_dispute_count
-- service_orders không đổi cột, không đổi CHECK (vẫn 15 trạng thái).
-- Tên PK/FK/index/CHECK lấy từ TypeORM synchronize trên DB test theo entity của nhánh này
-- → sau khi chạy, synchronize không drop/tạo lại.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-14-disputes.sql
-- Chạy TRƯỚC khi deploy BE mới (thiếu bảng/cột → khách xác nhận biên bản nhận cây, chi tiết đơn,
-- chia tiền cuối đơn lỗi 500).
-- Chạy lại nhiều lần không lỗi.
-- CÓ sửa / xoá dữ liệu cũ, đúng 2 chỗ:
--   1. plants.handover_decision = 'ADJUST' → 'ACCEPT' (final_total của đơn cũ giữ nguyên).
--   2. DROP TABLE order_disputes (mất các dòng tranh chấp thử kiểu cũ).
-- =====================================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Hồ sơ khách: tài khoản nhận tiền hoàn / tiền đền + số lần thua tranh chấp.
ALTER TABLE "customer_profiles"
  ADD COLUMN IF NOT EXISTS "bank_name" varchar(100),
  ADD COLUMN IF NOT EXISTS "bank_account" varchar(50),
  ADD COLUMN IF NOT EXISTS "bank_holder" varchar(100),
  ADD COLUMN IF NOT EXISTS "lost_dispute_count" integer NOT NULL DEFAULT 0;

-- 2. Cây: bỏ ADJUST. Đổi dữ liệu cũ TRƯỚC, rồi mới thay CHECK (tên CHECK do TypeORM tự sinh theo
--    biểu thức nên biểu thức đổi thì tên đổi).
UPDATE "plants" SET "handover_decision" = 'ACCEPT' WHERE "handover_decision" = 'ADJUST';

DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'plants'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%handover_decision%'
      AND conname <> 'CHK_6b283ef712d331389edf8bbba0'
  LOOP
    EXECUTE format('ALTER TABLE "plants" DROP CONSTRAINT %I', c);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'plants'::regclass
      AND conname = 'CHK_6b283ef712d331389edf8bbba0'
  ) THEN
    ALTER TABLE "plants" ADD CONSTRAINT "CHK_6b283ef712d331389edf8bbba0"
      CHECK ("handover_decision" IS NULL OR "handover_decision" IN ('ACCEPT','ACCEPT_HIGH_RISK','REJECT'));
  END IF;
END $$;

-- 3. Phiên nhận / trả cây: ý kiến phản đối của khách + 2 trạng thái mới.
ALTER TABLE "handovers"
  ADD COLUMN IF NOT EXISTS "customer_objection_note" text;

DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'handovers'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%(status)::text%'
      AND conname <> 'CHK_b9a010b4e420e6abde0fa5a4fd'
  LOOP
    EXECUTE format('ALTER TABLE "handovers" DROP CONSTRAINT %I', c);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'handovers'::regclass
      AND conname = 'CHK_b9a010b4e420e6abde0fa5a4fd'
  ) THEN
    ALTER TABLE "handovers" ADD CONSTRAINT "CHK_b9a010b4e420e6abde0fa5a4fd"
      CHECK ("status" IN ('IN_PROGRESS','AWAITING_CUSTOMER','AWAITING_DEPOSIT','CONFIRMED','AUTO_CONFIRMED','DISPUTED','CANCELLED'));
  END IF;
END $$;

-- Ảnh khách đính kèm ý kiến phản đối — chỉ thêm dòng.
CREATE TABLE IF NOT EXISTS "handover_objection_photos" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "handover_id" uuid NOT NULL,
  "photo_url" varchar(500) NOT NULL,
  "caption" varchar(500),
  CONSTRAINT "PK_cff66e3d7e4899ee49a92b1426c" PRIMARY KEY ("id"),
  CONSTRAINT "FK_5b186574bfe6e419f931fbde39d" FOREIGN KEY ("handover_id")
    REFERENCES "handovers"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "IDX_5b186574bfe6e419f931fbde39"
  ON "handover_objection_photos" ("handover_id");

-- 4. Sổ cái: tách hai sổ cho mỗi đơn. Dòng cũ thuộc sổ đơn (mặc định ORDER).
ALTER TABLE "escrow_ledger"
  ADD COLUMN IF NOT EXISTS "book" varchar(10) NOT NULL DEFAULT 'ORDER';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'escrow_ledger'::regclass
      AND conname = 'CHK_escrow_ledger_book'
  ) THEN
    ALTER TABLE "escrow_ledger" ADD CONSTRAINT "CHK_escrow_ledger_book"
      CHECK ("book" IN ('ORDER','SECURITY'));
  END IF;

  -- entry_type: cùng tên CHECK nhưng thêm 3 loại bút toán → chỉ tạo lại khi bản đang có còn thiếu.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'escrow_ledger'::regclass
      AND conname = 'CHK_escrow_ledger_entry_type'
      AND pg_get_constraintdef(oid) LIKE '%SECURITY_IN%'
  ) THEN
    ALTER TABLE "escrow_ledger" DROP CONSTRAINT IF EXISTS "CHK_escrow_ledger_entry_type";
    ALTER TABLE "escrow_ledger" ADD CONSTRAINT "CHK_escrow_ledger_entry_type"
      CHECK ("entry_type" IN ('DEPOSIT','REFUND','PAYOUT','PLATFORM_FEE','SECURITY_IN','SECURITY_RETURN','COMPENSATION'));
  END IF;
END $$;

-- 5. Lệnh chi: thêm người nhận là khách. Mỗi dòng đúng một người nhận (vườn hoặc khách).
ALTER TABLE "disbursements"
  ADD COLUMN IF NOT EXISTS "customer_id" uuid;
ALTER TABLE "disbursements"
  ALTER COLUMN "provider_id" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'disbursements'::regclass
      AND conname = 'FK_72a0f769938c20595581abd6da0'
  ) THEN
    ALTER TABLE "disbursements" ADD CONSTRAINT "FK_72a0f769938c20595581abd6da0"
      FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'disbursements'::regclass
      AND conname = 'CHK_disbursements_recipient'
  ) THEN
    ALTER TABLE "disbursements" ADD CONSTRAINT "CHK_disbursements_recipient"
      CHECK (("customer_id" IS NULL) <> ("provider_id" IS NULL));
  END IF;

  -- type: cùng tên CHECK nhưng thêm 2 loại → chỉ tạo lại khi bản đang có còn thiếu.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'disbursements'::regclass
      AND conname = 'CHK_disbursements_type'
      AND pg_get_constraintdef(oid) LIKE '%SECURITY_RETURN%'
  ) THEN
    ALTER TABLE "disbursements" DROP CONSTRAINT IF EXISTS "CHK_disbursements_type";
    ALTER TABLE "disbursements" ADD CONSTRAINT "CHK_disbursements_type"
      CHECK ("type" IN ('PAYOUT','REFUND','SECURITY_RETURN','COMPENSATION'));
  END IF;
END $$;

-- 6. Khoản tiền bảo đảm vườn phải nộp lúc nhận cây (PENDING → PAID | CANCELLED).
CREATE TABLE IF NOT EXISTS "security_deposits" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "service_order_id" uuid NOT NULL,
  "provider_id" uuid NOT NULL,
  "amount" bigint NOT NULL,
  "deposit_code" varchar(20) NOT NULL,
  "due_at" timestamptz NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "paid_at" timestamptz,
  "transaction_id" uuid,
  CONSTRAINT "PK_75a1c7ef6b1fae74e66e812920c" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_security_deposits_status" CHECK ("status" IN ('PENDING','PAID','CANCELLED')),
  CONSTRAINT "CHK_security_deposits_amount" CHECK ("amount" >= 0),
  CONSTRAINT "FK_17d9098491c4de4b1692a963896" FOREIGN KEY ("service_order_id")
    REFERENCES "service_orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "FK_33c7fd65ea9399b18df35d2f080" FOREIGN KEY ("provider_id")
    REFERENCES "provider_profiles"("id") ON DELETE RESTRICT,
  CONSTRAINT "FK_40f941c2945934d7df0e0ac713e" FOREIGN KEY ("transaction_id")
    REFERENCES "transactions"("id") ON DELETE RESTRICT
);

-- Mỗi đơn chỉ một khoản còn sống (PENDING hoặc PAID); khoản đã huỷ không tính.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_security_deposits_order_active"
  ON "security_deposits" ("service_order_id") WHERE "status" <> 'CANCELLED';
-- Mã BAODAM… = nội dung chuyển khoản của riêng khoản này → webhook SePay khớp tiền theo mã.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_security_deposits_deposit_code"
  ON "security_deposits" ("deposit_code");
-- Bộ quét hạn 2 giờ: lọc PENDING theo due_at.
CREATE INDEX IF NOT EXISTS "IDX_security_deposits_status_due"
  ON "security_deposits" ("status", "due_at");

-- 7. Tranh chấp: xoá bảng cũ, tạo 4 bảng mới.
DROP TABLE IF EXISTS "order_disputes";

CREATE TABLE IF NOT EXISTS "disputes" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "service_order_id" uuid NOT NULL,
  "opened_by_account_id" uuid NOT NULL,
  "reason" varchar(100) NOT NULL,
  "description" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'NEGOTIATING',
  "outcome" varchar(20),
  "negotiation_due_at" timestamptz NOT NULL,
  "escalated_at" timestamptz,
  "admin_due_at" timestamptz,
  "refund_amount" bigint,
  "compensation_amount" bigint,
  "resolved_at" timestamptz,
  "resolved_by_account_id" uuid,
  "resolution_note" text,
  CONSTRAINT "PK_3c97580d01c1a4b0b345c42a107" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_disputes_status" CHECK ("status" IN ('NEGOTIATING','ADMIN_REVIEW','RESOLVED')),
  CONSTRAINT "CHK_disputes_outcome"
    CHECK ("outcome" IS NULL OR "outcome" IN ('AGREED','WITHDRAWN','ADJUDICATED')),
  CONSTRAINT "CHK_disputes_refund_amount" CHECK ("refund_amount" IS NULL OR "refund_amount" >= 0),
  CONSTRAINT "CHK_disputes_compensation_amount"
    CHECK ("compensation_amount" IS NULL OR "compensation_amount" >= 0),
  CONSTRAINT "FK_80efcf98b36387e052958a8cee9" FOREIGN KEY ("service_order_id")
    REFERENCES "service_orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "FK_7af96d15fe1a3558a4743f68a8c" FOREIGN KEY ("opened_by_account_id")
    REFERENCES "accounts"("id") ON DELETE RESTRICT,
  CONSTRAINT "FK_eb00b8758b3c1fc4c6f2743daac" FOREIGN KEY ("resolved_by_account_id")
    REFERENCES "accounts"("id") ON DELETE RESTRICT
);

-- Mỗi đơn tối đa một tranh chấp.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_disputes_service_order_id"
  ON "disputes" ("service_order_id");
-- Bộ quét hạn 3 ngày: lọc NEGOTIATING theo negotiation_due_at.
CREATE INDEX IF NOT EXISTS "IDX_disputes_status_negotiation_due"
  ON "disputes" ("status", "negotiation_due_at");

-- Cây bị khiếu nại; verdict null cho tới khi admin phân xử.
CREATE TABLE IF NOT EXISTS "dispute_plants" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "dispute_id" uuid NOT NULL,
  "plant_id" uuid NOT NULL,
  "verdict" varchar(20),
  CONSTRAINT "PK_f71e20eff3fe696dac3d787850d" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_dispute_plants_verdict"
    CHECK ("verdict" IS NULL OR "verdict" IN ('NOT_AT_FAULT','SERVICE_FAULT','VALUE_LOST')),
  CONSTRAINT "FK_61501f82436f147f9d286eacaea" FOREIGN KEY ("dispute_id")
    REFERENCES "disputes"("id") ON DELETE CASCADE,
  CONSTRAINT "FK_5948ff238dc04921af3286ed4f5" FOREIGN KEY ("plant_id")
    REFERENCES "plants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_dispute_plants_dispute_plant"
  ON "dispute_plants" ("dispute_id", "plant_id");

-- Ảnh bằng chứng của hai bên — chỉ thêm dòng.
CREATE TABLE IF NOT EXISTS "dispute_evidences" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "dispute_id" uuid NOT NULL,
  "party" varchar(10) NOT NULL,
  "uploaded_by_account_id" uuid NOT NULL,
  "plant_id" uuid,
  "photo_url" varchar(500) NOT NULL,
  "caption" varchar(500),
  "note" text,
  CONSTRAINT "PK_5303a0ad975cf37cc0303bc831e" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_dispute_evidences_party" CHECK ("party" IN ('CUSTOMER','PROVIDER')),
  CONSTRAINT "FK_1d4faf331cb51aaec4f6573caf6" FOREIGN KEY ("dispute_id")
    REFERENCES "disputes"("id") ON DELETE CASCADE,
  CONSTRAINT "FK_5e3b760d014800727f7d06d4caa" FOREIGN KEY ("uploaded_by_account_id")
    REFERENCES "accounts"("id") ON DELETE RESTRICT,
  CONSTRAINT "FK_a29bbd861fcdc4b435aa6ee9816" FOREIGN KEY ("plant_id")
    REFERENCES "plants"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IDX_dispute_evidences_dispute_id"
  ON "dispute_evidences" ("dispute_id");

-- Đề nghị thương lượng: hai số (hoàn tiền công, tiền đền).
CREATE TABLE IF NOT EXISTS "dispute_offers" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "dispute_id" uuid NOT NULL,
  "proposed_by" varchar(10) NOT NULL,
  "refund_amount" bigint NOT NULL,
  "compensation_amount" bigint NOT NULL,
  "message" text,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "responded_at" timestamptz,
  CONSTRAINT "PK_06769885275d9de018fc923a080" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_dispute_offers_proposed_by" CHECK ("proposed_by" IN ('CUSTOMER','PROVIDER')),
  CONSTRAINT "CHK_dispute_offers_status" CHECK ("status" IN ('PENDING','ACCEPTED','SUPERSEDED')),
  CONSTRAINT "CHK_dispute_offers_refund_amount" CHECK ("refund_amount" >= 0),
  CONSTRAINT "CHK_dispute_offers_compensation_amount" CHECK ("compensation_amount" >= 0),
  CONSTRAINT "FK_37d3ea1e1344d5c719bc50f7d5b" FOREIGN KEY ("dispute_id")
    REFERENCES "disputes"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IDX_dispute_offers_dispute_id"
  ON "dispute_offers" ("dispute_id");
-- Mỗi tranh chấp chỉ một đề nghị đang chờ: đề nghị mới luôn thay đề nghị cũ.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_dispute_offers_dispute_pending"
  ON "dispute_offers" ("dispute_id") WHERE "status" = 'PENDING';

COMMIT;
