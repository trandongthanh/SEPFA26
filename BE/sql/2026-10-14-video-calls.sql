-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/video-call-rewrite
-- Module video call 1-1 viết lại (bản chốt BE/docs/video-call-ban-chot.md §4):
--   - bỏ bảng video_call_events (không lưu nhật ký vào/rời — B6);
--   - thay bảng video_calls cấu trúc cũ (mô hình "phòng họp", có cột call_id) bằng bảng mới
--     theo entity src/video-calls/entities/video-call.entity.ts.
-- Tên PK/FK/CHECK/index = đúng tên TypeORM sinh (đọc từ DB e2e sau synchronize, ngày 14/10/2026).
-- Đã kiểm: áp file này lên bản sao DB theo develop → cột/ràng buộc/index giống hệt TypeORM;
-- chạy lại lần 2 không mất dữ liệu mới.
--
-- ⚠️ MẤT DỮ LIỆU CUỘC GỌI CŨ: video_calls cấu trúc cũ và video_call_events bị xóa hẳn
--    (cấu trúc khác hoàn toàn, không chuyển đổi được). Chỉ chạy trên DB chung khi
--    anh Thạnh / leader đã đồng ý.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-10-14-video-calls.sql
-- Chạy TRƯỚC khi deploy BE mới (thiếu bảng mới → mọi API /video-calls lỗi 500).
-- Chạy lại an toàn: chỉ xóa video_calls khi còn cấu trúc cũ; tạo bảng/index đều IF NOT EXISTS.
-- =====================================================================================

BEGIN;

-- 1. Bảng nhật ký sự kiện cuộc gọi cũ — bỏ hẳn (B6).
DROP TABLE IF EXISTS "video_call_events";

-- 2. Bảng video_calls cấu trúc cũ (còn cột call_id) → xóa để tạo lại.
--    Đã là cấu trúc mới thì giữ nguyên (chạy lại file không mất dữ liệu).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'video_calls'
      AND column_name = 'call_id'
  ) THEN
    DROP TABLE "video_calls";
  END IF;
END
$$;

-- 3. Bảng video_calls mới — mỗi cuộc gọi 1 dòng; id do app sinh (= id cuộc gọi trên GetStream).
CREATE TABLE IF NOT EXISTS "video_calls" (
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMP WITH TIME ZONE,
  "version" integer NOT NULL DEFAULT 1,
  "id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "caller_account_id" uuid NOT NULL,
  "callee_account_id" uuid NOT NULL,
  "status" character varying(20) NOT NULL,
  "end_reason" character varying(20),
  "ended_by" uuid,
  "answered_at" TIMESTAMP WITH TIME ZONE,
  "ended_at" TIMESTAMP WITH TIME ZONE,
  "short_handed_since" TIMESTAMP WITH TIME ZONE,
  "caller_device_session_id" uuid,
  "callee_device_session_id" uuid,
  CONSTRAINT "PK_a57b6d74bf1422edbcf00e61aa6" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_1e8a9387d60d015d1898a1e5ff"
    CHECK ("status" IN ('RINGING','ACTIVE','ENDED')),
  CONSTRAINT "CHK_fca7de4ae9b5aeff1ed84f338f"
    CHECK ("end_reason" IS NULL OR "end_reason" IN ('COMPLETED','DECLINED','CANCELLED','MISSED','DROPPED','TIMEOUT')),
  CONSTRAINT "CHK_c669ec20c7d5d2fb891192ab65"
    CHECK ("caller_account_id" <> "callee_account_id"),
  -- Đã kết thúc ⇔ có đủ lý do và giờ kết thúc.
  CONSTRAINT "CHK_2593bfb065db873a6e7ccde4b5"
    CHECK (("status" = 'ENDED') = ("end_reason" IS NOT NULL AND "ended_at" IS NOT NULL)),
  -- Đang đổ chuông thì chưa có giờ nghe; đang nói thì phải có.
  CONSTRAINT "CHK_f5ea05beca0c8388cd09f27029"
    CHECK (("status" <> 'RINGING' OR "answered_at" IS NULL) AND ("status" <> 'ACTIVE' OR "answered_at" IS NOT NULL)),
  CONSTRAINT "FK_8e6fefc8d415cea11f7507e0a14" FOREIGN KEY ("order_id")
    REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "FK_5f0a2087e83ab963c735a895cbf" FOREIGN KEY ("caller_account_id")
    REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "FK_717272f3d55154209e4ff3be1e7" FOREIGN KEY ("callee_account_id")
    REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- 4. Index.
-- Mỗi đơn tối đa 1 cuộc gọi đang sống (L4) — lưới cuối khi hai request tạo cùng lúc.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_video_calls_order_live"
  ON "video_calls" ("order_id") WHERE "status" IN ('RINGING','ACTIVE');
-- Tra máy bận theo từng vai (L5).
CREATE INDEX IF NOT EXISTS "IDX_video_calls_caller_status"
  ON "video_calls" ("caller_account_id", "status");
CREATE INDEX IF NOT EXISTS "IDX_video_calls_callee_status"
  ON "video_calls" ("callee_account_id", "status");
-- Lịch sử cuộc gọi của đơn, mới nhất trước.
CREATE INDEX IF NOT EXISTS "IDX_video_calls_order_created"
  ON "video_calls" ("order_id", "created_at");

COMMIT;
