-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/order-state-service
-- Máy trạng thái đơn đủ 15 trạng thái: thêm RETURN_IN_PROGRESS, RETURN_AWAITING_CONFIRM,
-- COMPLETED, EXPIRED, DISPUTED vào CHECK của service_orders.status.
-- Tên constraint khớp @Check('CHK_service_orders_status') trong service-order.entity.ts
-- → synchronize sau này không drop/tạo lại.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-11-order-status-15.sql
-- Chạy lại nhiều lần không lỗi. Dữ liệu cũ không cần sửa (chỉ mở rộng tập giá trị).
-- =====================================================================================

BEGIN;

-- Drop mọi CHECK cũ trên service_orders.status (tên do TypeORM sinh hash → tìm theo nội dung, không hard-code).
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'service_orders'
      AND con.contype = 'c'
      -- pg_get_constraintdef viết lại thành status::text = ANY(ARRAY[...]) → nhận theo giá trị đặc trưng.
      AND pg_get_constraintdef(con.oid) LIKE '%PENDING_PROVIDER%'
  LOOP
    EXECUTE format('ALTER TABLE "service_orders" DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE "service_orders"
  ADD CONSTRAINT "CHK_service_orders_status" CHECK ("status" IN (
    'DRAFT','PENDING_PROVIDER','AGREEMENT_PENDING','AWAITING_PAYMENT','PAID',
    'HANDOVER_IN_PROGRESS','HANDOVER_AWAITING_CONFIRM','IN_CARE',
    'RETURN_IN_PROGRESS','RETURN_AWAITING_CONFIRM','COMPLETED',
    'REJECTED','EXPIRED','CANCELLED','DISPUTED'
  ));

COMMIT;
