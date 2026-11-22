-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh fix/order-paid-at-decline-preview
-- Ghi lúc tiền đơn về, để app phân biệt đơn đã thanh toán với đơn huỷ trước khi trả
-- (settlement.customerTotal chỉ là số phải trả, đơn huỷ lúc chờ thanh toán vẫn hiện 784.000):
--   service_orders = thêm paid_at (timestamptz, null = chưa từng trả)
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-22-order-paid-at.sql
-- Chạy TRƯỚC khi deploy BE mới (thiếu cột → mọi câu đọc/ghi service_orders lỗi 500).
-- Chạy lại nhiều lần không lỗi. KHÔNG xoá dữ liệu cũ.
--
-- Điền ngược đơn cũ: paid_at = giờ của bút toán DEPOSIT ĐẦU TIÊN ở sổ đơn (ORDER).
--   Tiền add-on cũng ghi DEPOSIT vào sổ đơn nhưng chỉ trả được trong kỳ chăm → luôn sau tiền đơn.
--   Đơn chưa từng có tiền về (huỷ lúc chờ thanh toán, đơn đang chờ) → không có DEPOSIT → giữ NULL.
-- Kiểm sau khi chạy (phải ra 0 dòng — đơn đã có tiền mà chưa có paid_at):
--   SELECT o.id, o.status FROM service_orders o
--   WHERE o.paid_at IS NULL
--     AND EXISTS (SELECT 1 FROM escrow_ledgers l WHERE l.service_order_id = o.id
--                 AND l.book = 'ORDER' AND l.entry_type = 'DEPOSIT');
-- =====================================================================================

BEGIN;

ALTER TABLE "service_orders" ADD COLUMN IF NOT EXISTS "paid_at" timestamptz;

UPDATE "service_orders" o
SET "paid_at" = first_deposit.created_at
FROM (
  SELECT "service_order_id", MIN("created_at") AS created_at
  FROM "escrow_ledgers"
  WHERE "book" = 'ORDER' AND "entry_type" = 'DEPOSIT'
  GROUP BY "service_order_id"
) AS first_deposit
WHERE first_deposit."service_order_id" = o."id"
  AND o."paid_at" IS NULL;

COMMIT;
