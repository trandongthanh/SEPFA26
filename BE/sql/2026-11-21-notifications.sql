-- =====================================================================================
-- SQL cho DB KHÔNG chạy synchronize (prod / DB dùng chung)
-- Tạo bảng `notifications` + ràng buộc CHECK + các index phục vụ truy vấn hộp thư & đếm chưa đọc.
--
-- Chạy (thư mục BE): psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/2026-11-21-notifications.sql
-- =====================================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "account_id" uuid NOT NULL,
  "type" character varying(60) NOT NULL,
  "title" character varying(200) NOT NULL,
  "body" text NOT NULL,
  "ref_entity" character varying(40),
  "ref_id" uuid,
  "metadata" jsonb,
  "is_read" boolean NOT NULL DEFAULT false,
  "read_at" TIMESTAMP WITH TIME ZONE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_notifications_id" PRIMARY KEY ("id"),
  CONSTRAINT "FK_notifications_account_id"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE,
  CONSTRAINT "CHK_notifications_type"
    CHECK ("type" IN (
      'ORDER_SUBMITTED',
      'ORDER_ACCEPTED',
      'ORDER_REJECTED',
      'ORDER_EXPIRED',
      'AGREEMENT_SIGNED_BY_PARTNER',
      'AGREEMENT_COMPLETED',
      'ORDER_PAID',
      'HANDOVER_STARTED',
      'HANDOVER_AWAITING_CONFIRM',
      'HANDOVER_CONFIRMED',
      'SECURITY_DEPOSIT_PAID',
      'ORDER_CANCELLED',
      'RETURN_STARTED',
      'RETURN_AWAITING_CONFIRM',
      'RETURN_CANCELLED',
      'ORDER_COMPLETED',
      'CARE_REPORT_SUBMITTED',
      'ADDON_PROPOSED',
      'ADDON_ACCEPTED',
      'ADDON_REJECTED',
      'ADDON_PAID',
      'ADDON_COMPLETED',
      'DISPUTE_OPENED',
      'DISPUTE_EVIDENCE_ADDED',
      'DISPUTE_OFFER_CREATED',
      'DISPUTE_OFFER_ACCEPTED',
      'DISPUTE_WITHDRAWN',
      'DISPUTE_ESCALATED',
      'DISPUTE_RESOLVED',
      'DISBURSEMENT_PAID',
      'PROVIDER_VERIFIED',
      'CUSTOMER_VERIFIED',
      'PACKAGE_VERIFIED',
      'PROFILE_SUBMITTED_FOR_REVIEW',
      'VIDEO_CALL_MISSED',
      'SYSTEM_ANNOUNCEMENT'
    )),
  CONSTRAINT "CHK_notifications_ref_entity"
    CHECK ("ref_entity" IS NULL OR "ref_entity" IN (
      'ORDER',
      'DISPUTE',
      'ADDON',
      'CARE_REPORT',
      'DISBURSEMENT',
      'PROVIDER_PROFILE',
      'CUSTOMER_PROFILE',
      'SERVICE_PACKAGE',
      'VIDEO_CALL',
      'SYSTEM'
    )),
  CONSTRAINT "CHK_notifications_read_state"
    CHECK (
      ("is_read" = false AND "read_at" IS NULL)
      OR ("is_read" = true AND "read_at" IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS "IDX_notifications_account_created"
  ON "notifications" ("account_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "IDX_notifications_account_unread"
  ON "notifications" ("account_id")
  WHERE "is_read" = false;

CREATE INDEX IF NOT EXISTS "IDX_notifications_ref"
  ON "notifications" ("ref_entity", "ref_id");

COMMIT;
