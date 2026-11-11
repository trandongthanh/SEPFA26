-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/order-return
-- Chặng trả cây: handovers thêm cột note (lý do vườn huỷ phiên trả) + unique
-- (service_order_id, handover_type) cho phiên còn sống (status khác CANCELLED).
-- Tên index khớp @Index('UQ_handovers_order_type_active') trong handover.entity.ts
-- → synchronize sau này không drop/tạo lại.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-11-order-return.sql
-- Chạy TRƯỚC khi deploy BE mới. Chạy lại nhiều lần không lỗi.
-- =====================================================================================

BEGIN;

ALTER TABLE "handovers"
  ADD COLUMN IF NOT EXISTS "note" text;

-- Kiểm dữ liệu trùng trước khi tạo unique: có thì dừng, in danh sách để xử lý tay.
DO $$
DECLARE
  dup text;
BEGIN
  SELECT string_agg(service_order_id::text || '/' || handover_type, ', ')
    INTO dup
  FROM (
    SELECT service_order_id, handover_type
    FROM "handovers"
    WHERE "status" <> 'CANCELLED'
    GROUP BY service_order_id, handover_type
    HAVING COUNT(*) > 1
  ) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'handovers trùng phiên còn sống (đơn/chiều): %', dup;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_handovers_order_type_active"
  ON "handovers" ("service_order_id", "handover_type")
  WHERE "status" <> 'CANCELLED';

COMMIT;
