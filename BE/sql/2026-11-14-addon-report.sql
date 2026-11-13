-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/addon-report
-- Báo cáo add-on: lúc vườn báo xong phải ghi mô tả việc đã làm (cột done_note đã có sẵn)
-- và tình trạng cây sau khi làm:
--   addon_proposals.done_plant_health = GOOD / AVERAGE / POOR (cùng thang với báo cáo chăm sóc);
--                                       NULL = chưa xong hoặc add-on cho cả đơn       [CỘT MỚI]
-- Tên CHECK khớp entity src/orders/entities/addon-proposal.entity.ts
-- → sau khi chạy, synchronize không drop/tạo lại.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-14-addon-report.sql
-- Chạy SAU sql/2026-11-13-addons.sql và TRƯỚC khi deploy BE mới (thiếu cột → mọi route add-on lỗi 500).
-- Chạy lại nhiều lần không lỗi. Không xoá / sửa dữ liệu cũ (add-on đã DONE trước đó giữ NULL).
-- =====================================================================================

BEGIN;

ALTER TABLE "addon_proposals"
  ADD COLUMN IF NOT EXISTS "done_plant_health" varchar(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'CHK_addon_proposals_done_plant_health'
       AND conrelid = '"addon_proposals"'::regclass
  ) THEN
    ALTER TABLE "addon_proposals"
      ADD CONSTRAINT "CHK_addon_proposals_done_plant_health"
      CHECK ("done_plant_health" IS NULL OR "done_plant_health" IN ('GOOD','AVERAGE','POOR'));
  END IF;
END $$;

COMMIT;
