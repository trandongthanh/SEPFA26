-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung) — nhánh feature/care-report-v2
-- Báo cáo chăm sóc theo bộ chỉ số mới (leader gửi 12/11/2026): báo cáo 2 tầng
--   care_reports         = phần chung của đơn mỗi kỳ (môi trường, tưới/bón, nước tưới, kỳ, trễ hạn)
--   care_report_plants   = từng cây (giá thể, lá/rễ/thân, sâu bệnh, sức khỏe, chỉ số đo)  [BẢNG MỚI]
--   care_report_evidence = ảnh gắn vào dòng cây (OVERVIEW/LEAF/STEM/ROOT)
--
-- ⚠ XÓA DỮ LIỆU BÁO CÁO CŨ: cấu trúc cũ không chuyển đổi được — Thạnh chốt xoá (12/11/2026).
-- Tên PK/FK/index/CHECK sinh bằng TypeORM synchronize trên DB tạm theo entity của nhánh này
-- → sau khi chạy, createSchemaBuilder().log() không còn câu nào thuộc 3 bảng.
--
-- Chạy (thư mục BE):  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-12-care-reports-v2.sql
-- Chạy lại nhiều lần không lỗi (mỗi lần đều xoá sạch báo cáo chăm sóc).
-- =====================================================================================

-- 0. Đếm trước để ghi vào biên bản (số dòng sẽ mất).
SELECT 'care_reports' AS bang, count(*) FROM care_reports
UNION ALL SELECT 'care_report_evidence', count(*) FROM care_report_evidence;

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP TABLE IF EXISTS care_report_evidence, care_report_plants, care_reports CASCADE;

-- 1. Phần chung của đơn mỗi kỳ
CREATE TABLE IF NOT EXISTS "care_reports" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "service_order_id" uuid NOT NULL,
  "period_index" integer NOT NULL,
  "period_start" timestamptz NOT NULL,
  "period_end" timestamptz NOT NULL,
  "submitted_at" timestamptz NOT NULL,
  "is_late" boolean NOT NULL DEFAULT false,
  "air_temperature" numeric(4,1) NOT NULL,
  "air_humidity" numeric(4,1) NOT NULL,
  "light_intensity" integer NOT NULL,
  "watered" boolean NOT NULL,
  "water_amount_ml" integer,
  "fertilized" boolean NOT NULL,
  "fertilizer_type" varchar(255),
  "other_care_note" text,
  "water_ph" numeric(3,1),
  "water_ec" numeric(6,2),
  CONSTRAINT "PK_0bfcd691cb32d739bd67cf08ba1" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_care_reports_period_index" CHECK ("period_index" >= 1),
  CONSTRAINT "CHK_care_reports_humidity" CHECK ("air_humidity" BETWEEN 0 AND 100),
  CONSTRAINT "CHK_care_reports_light" CHECK ("light_intensity" >= 0),
  CONSTRAINT "CHK_care_reports_watering"
    CHECK (("watered" AND "water_amount_ml" > 0) OR (NOT "watered" AND "water_amount_ml" IS NULL)),
  CONSTRAINT "CHK_care_reports_fertilizing"
    CHECK (("fertilized" AND "fertilizer_type" IS NOT NULL) OR (NOT "fertilized" AND "fertilizer_type" IS NULL)),
  CONSTRAINT "FK_f40356f334236876b496d37c2fa" FOREIGN KEY ("service_order_id")
    REFERENCES "service_orders"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "IDX_f40356f334236876b496d37c2f" ON "care_reports" ("service_order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_CARE_REPORT_ORDER_PERIOD" ON "care_reports" ("service_order_id", "period_index");

-- 2. Từng cây trong mỗi kỳ
CREATE TABLE IF NOT EXISTS "care_report_plants" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "care_report_id" uuid NOT NULL,
  "plant_id" uuid NOT NULL,
  "substrate_moisture" varchar(10) NOT NULL,
  "leaf_condition" varchar(10) NOT NULL,
  "root_condition" varchar(10) NOT NULL,
  "stem_condition" varchar(10) NOT NULL,
  "has_pest_disease" boolean NOT NULL,
  "overall_health" varchar(10) NOT NULL,
  "note" text,
  "leaf_length_cm" numeric(5,1),
  "leaf_count" integer,
  "new_root_length_cm" numeric(5,1),
  "new_shoot_count" integer,
  "flower_spike_count" integer,
  "bud_count" integer,
  "flower_count" integer,
  CONSTRAINT "PK_27d04951d136e8a0883df397080" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_care_report_plants_substrate" CHECK ("substrate_moisture" IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT "CHK_care_report_plants_parts" CHECK (
    "leaf_condition" IN ('GOOD','NORMAL','POOR') AND "root_condition" IN ('GOOD','NORMAL','POOR')
    AND "stem_condition" IN ('GOOD','NORMAL','POOR')),
  CONSTRAINT "CHK_care_report_plants_overall" CHECK ("overall_health" IN ('GOOD','AVERAGE','POOR')),
  CONSTRAINT "FK_0e5c416dbc10e1aff27180e1990" FOREIGN KEY ("care_report_id")
    REFERENCES "care_reports"("id") ON DELETE CASCADE,
  CONSTRAINT "FK_87f973de32b6527b6ca6c5e01a6" FOREIGN KEY ("plant_id")
    REFERENCES "plants"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "IDX_0e5c416dbc10e1aff27180e199" ON "care_report_plants" ("care_report_id");
CREATE INDEX IF NOT EXISTS "IDX_87f973de32b6527b6ca6c5e01a" ON "care_report_plants" ("plant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_CARE_REPORT_PLANT" ON "care_report_plants" ("care_report_id", "plant_id");

-- 3. Ảnh của từng cây
CREATE TABLE IF NOT EXISTS "care_report_evidence" (
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "care_report_plant_id" uuid NOT NULL,
  "evidence_type" varchar(10) NOT NULL,
  "photo_url" varchar(500) NOT NULL,
  "caption" text,
  CONSTRAINT "PK_7c27bfa240a803b65991d82e369" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_care_report_evidence_type" CHECK ("evidence_type" IN ('OVERVIEW','LEAF','STEM','ROOT')),
  CONSTRAINT "FK_cbc068f06facca8d9cc335939fb" FOREIGN KEY ("care_report_plant_id")
    REFERENCES "care_report_plants"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "IDX_cbc068f06facca8d9cc335939f" ON "care_report_evidence" ("care_report_plant_id");

COMMIT;
