-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/addon
-- Add-on (việc phát sinh ngoài gói trong lúc đang chăm):
--   addon_proposals = đề xuất của vườn: PENDING → ACCEPTED → PAID → DONE,
--                     hoặc REJECTED / EXPIRED (khách im lặng 48 giờ, đồng ý mà 24 giờ chưa trả,
--                     hoặc vườn bắt đầu trả cây khi đề xuất còn dở)                  [BẢNG MỚI]
-- Không đổi bảng cũ: dòng hoá đơn add-on dùng payment_components.component_type = 'ADD_ON'
-- và cột addon_id đã có sẵn.
-- Tên PK/FK/index/CHECK lấy từ TypeORM synchronize trên DB test theo entity của nhánh này
-- → sau khi chạy, synchronize không drop/tạo lại.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-13-addons.sql
-- Chạy TRƯỚC khi deploy BE mới (thiếu bảng → chi tiết đơn và bắt đầu trả cây lỗi 500).
-- Chạy lại nhiều lần không lỗi. Không xoá / sửa dữ liệu cũ.
-- =====================================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS "addon_proposals" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "service_order_id" uuid NOT NULL,
  "plant_id" uuid,
  "addon_code" varchar(20) NOT NULL,
  "title" varchar(120) NOT NULL,
  "reason" text NOT NULL,
  "price" bigint NOT NULL,
  "customer_fee" bigint NOT NULL DEFAULT '0',
  "photo_urls" jsonb NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "respond_due_at" timestamptz NOT NULL,
  "decided_at" timestamptz,
  "customer_note" text,
  "payment_due_at" timestamptz,
  "paid_at" timestamptz,
  "done_at" timestamptz,
  "done_photo_urls" jsonb,
  "done_note" text,
  "expired_reason" varchar(20),
  "expired_at" timestamptz,
  "created_by_account_id" uuid NOT NULL,
  CONSTRAINT "PK_27f9d1524023eaa28039becd5a4" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_addon_proposals_status"
    CHECK ("status" IN ('PENDING','ACCEPTED','PAID','DONE','REJECTED','EXPIRED')),
  CONSTRAINT "CHK_addon_proposals_price" CHECK ("price" > 0),
  CONSTRAINT "CHK_addon_proposals_expired_reason"
    CHECK ("expired_reason" IS NULL OR "expired_reason" IN ('NO_RESPONSE','NOT_PAID','ORDER_RETURNING')),
  CONSTRAINT "FK_fa41530cc9bfa58b5164cea1072" FOREIGN KEY ("service_order_id")
    REFERENCES "service_orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "FK_f99c66866ac8b32855c8c90c7f2" FOREIGN KEY ("plant_id")
    REFERENCES "plants"("id") ON DELETE RESTRICT,
  CONSTRAINT "FK_f7071533b3ef94a335c226556cb" FOREIGN KEY ("created_by_account_id")
    REFERENCES "accounts"("id") ON DELETE RESTRICT
);

-- Mã add-on = nội dung chuyển khoản của riêng đề xuất → webhook SePay khớp tiền theo mã này.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_addon_proposals_addon_code"
  ON "addon_proposals" ("addon_code");
-- Danh sách đề xuất của một đơn + đếm đề xuất đang mở.
CREATE INDEX IF NOT EXISTS "IDX_addon_proposals_order_status"
  ON "addon_proposals" ("service_order_id", "status");

COMMIT;
