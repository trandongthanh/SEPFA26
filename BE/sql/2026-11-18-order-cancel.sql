-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/order-cancel
-- Huỷ đơn trước khi nhận cây + các hạn tự chạy. Đưa DB đang ở schema develop (68bf65a) lên schema nhánh này:
--   service_orders         = thêm 3 cột hạn (provider_respond_due_at, agreement_due_at, payment_due_at)
--                            + cancel_code; cancelled_by thêm giá trị SYSTEM (CHECK đổi sang tên cố định)
--   provider_profiles      = thêm cancelled_order_count (số lần vườn "nhận đơn rồi bỏ")
--   payment_components     = status thêm CANCELLED (CHECK đổi sang tên cố định)
--   handover_cancel_photos = ảnh vườn chụp khi báo "khách vắng nhà", kèm toạ độ + khoảng cách   [BẢNG MỚI]
-- Tên PK/FK/index/CHECK lấy từ TypeORM synchronize trên DB test theo entity của nhánh này
-- → sau khi chạy, synchronize không drop/tạo lại.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-18-order-cancel.sql
-- Chạy TRƯỚC khi deploy BE mới (thiếu cột → gửi đơn, nhận đơn, ký, chi tiết đơn, bộ quét hạn lỗi 500).
-- Chạy lại nhiều lần không lỗi.
-- KHÔNG sửa, KHÔNG xoá dữ liệu cũ. Cố ý KHÔNG điền hạn cho đơn cũ: cột hạn rỗng = "không có hạn",
-- bộ quét và các route bỏ qua; hai bước quét có tiền (vườn không tới, khách im lặng với biên bản) chỉ xét đơn
-- có payment_due_at, tức đơn đi qua bước ký SAU khi deploy → không đơn cũ nào bị tự huỷ / tự hoàn tiền.
-- Đơn cũ đang treo thì liệt kê bằng câu SELECT trong docs/huy-don-ban-giao.md rồi xử tay từng đơn.
-- =====================================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Đơn: ba hạn chờ trước thanh toán + mã lý do huỷ.
ALTER TABLE "service_orders"
  ADD COLUMN IF NOT EXISTS "provider_respond_due_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "agreement_due_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "payment_due_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "cancel_code" varchar(40);

-- 2. Đơn: cancelled_by thêm SYSTEM (hệ thống tự huỷ). CHECK cũ do TypeORM tự đặt tên theo biểu thức
--    → gỡ mọi CHECK trên cancelled_by chưa mang tên cố định, rồi tạo lại CHECK tên cố định.
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'service_orders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%cancelled_by%'
      AND conname <> 'CHK_service_orders_cancelled_by'
  LOOP
    EXECUTE format('ALTER TABLE "service_orders" DROP CONSTRAINT %I', c);
  END LOOP;

  ALTER TABLE "service_orders"
    DROP CONSTRAINT IF EXISTS "CHK_service_orders_cancelled_by";
  ALTER TABLE "service_orders" ADD CONSTRAINT "CHK_service_orders_cancelled_by"
    CHECK ("cancelled_by" IS NULL OR "cancelled_by" IN ('CUSTOMER','PROVIDER','SYSTEM'));
END $$;

-- 3. Hồ sơ vườn: số lần nhận đơn rồi bỏ (ghi chú nội bộ cho admin, chưa phạt tiền).
ALTER TABLE "provider_profiles"
  ADD COLUMN IF NOT EXISTS "cancelled_order_count" integer NOT NULL DEFAULT 0;

-- 4. Hoá đơn: status thêm CANCELLED (dòng chưa trả của đơn bị huỷ trước khi thanh toán).
--    Chỉ gỡ CHECK nói về "status" — CHECK của component_type và amount giữ nguyên.
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'payment_components'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
      AND conname <> 'CHK_payment_components_status'
  LOOP
    EXECUTE format('ALTER TABLE "payment_components" DROP CONSTRAINT %I', c);
  END LOOP;

  ALTER TABLE "payment_components"
    DROP CONSTRAINT IF EXISTS "CHK_payment_components_status";
  ALTER TABLE "payment_components" ADD CONSTRAINT "CHK_payment_components_status"
    CHECK ("status" IN ('PENDING','PAID','REFUNDED','RELEASED','CANCELLED'));
END $$;

-- 5. Ảnh vườn chụp khi báo "khách vắng nhà" (chỉ ghi thêm). Toạ độ là vị trí điện thoại của vườn lúc chụp,
--    được rỗng; distance_m = khoảng cách đường chim bay tới điểm lấy cây của đơn, chỉ để tham khảo.
CREATE TABLE IF NOT EXISTS "handover_cancel_photos" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "handover_id" uuid NOT NULL,
  "photo_url" varchar(500) NOT NULL,
  "gps_lat" numeric(9,6),
  "gps_lng" numeric(9,6),
  "distance_m" integer,
  CONSTRAINT "PK_73c0a0335dfcac587d9c04bc745" PRIMARY KEY ("id"),
  CONSTRAINT "FK_bfaaffd3fc3966de1c3d9fc77f8" FOREIGN KEY ("handover_id")
    REFERENCES "handovers"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "IDX_bfaaffd3fc3966de1c3d9fc77f"
  ON "handover_cancel_photos" ("handover_id");

COMMIT;
