-- Create new enums
CREATE TYPE "GarmentCategory" AS ENUM (
  'top',
  'bottom',
  'outerwear',
  'dress',
  'shoes',
  'accessory'
);

CREATE TYPE "GarmentMaterial" AS ENUM (
  'cotton',
  'wool',
  'linen',
  'leather',
  'denim',
  'fleece',
  'synthetic',
  'down',
  'silk'
);

CREATE TYPE "GarmentComfortRange" AS ENUM (
  'cold',
  'cool',
  'mild',
  'warm',
  'hot'
);

-- IRREVERSIBLE CHECKPOINT: back up GarmentItem and record row counts before deployment.
-- PostgreSQL enum replacement drops GarmentUploadStatus and has no automatic down migration.
-- Restore requires the pre-deployment backup plus an application rollback coordinated with workers.
-- Update GarmentUploadStatus enum to include awaiting_tags
CREATE TYPE "GarmentUploadStatus_new" AS ENUM (
  'pending_upload',
  'bytes_uploaded',
  'processing',
  'awaiting_tags',
  'ready',
  'failed'
);

ALTER TABLE "GarmentItem" ALTER COLUMN "upload_status" DROP DEFAULT;
ALTER TABLE "GarmentItem" ALTER COLUMN "upload_status" TYPE "GarmentUploadStatus_new" USING ("upload_status"::text::"GarmentUploadStatus_new");
DROP TYPE "GarmentUploadStatus";
ALTER TYPE "GarmentUploadStatus_new" RENAME TO "GarmentUploadStatus";
ALTER TABLE "GarmentItem" ALTER COLUMN "upload_status" SET DEFAULT 'pending_upload'::"GarmentUploadStatus";

-- Add smart tagging metadata columns
ALTER TABLE "GarmentItem"
  ADD COLUMN "tag_suggestions" JSONB,
  ADD COLUMN "tagging_model_version" TEXT,
  ADD COLUMN "tag_suggested_at" TIMESTAMP(3),
  ADD COLUMN "tags_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "tagging_failure_code" TEXT,
  ADD COLUMN "tagging_telemetry_emitted_at" TIMESTAMP(3);

-- DATA-LOSS CHECKPOINT: the following normalization clears unknown legacy tag values.
-- Review and export every affected row before applying this migration outside development.
-- Normalize legacy string values before casting
UPDATE "GarmentItem" SET "category" = NULL WHERE "category" IS NOT NULL AND "category" NOT IN ('top', 'bottom', 'outerwear', 'dress', 'shoes', 'accessory');
UPDATE "GarmentItem" SET "material" = NULL WHERE "material" IS NOT NULL AND "material" NOT IN ('cotton', 'wool', 'linen', 'leather', 'denim', 'fleece', 'synthetic', 'down', 'silk');
UPDATE "GarmentItem" SET "comfort_range" = NULL WHERE "comfort_range" IS NOT NULL AND "comfort_range" NOT IN ('cold', 'cool', 'mild', 'warm', 'hot');

-- Move ready garments missing category or comfort_range to awaiting_tags with LEGACY_TAGS_REQUIRED
UPDATE "GarmentItem"
SET "upload_status" = 'awaiting_tags',
    "tagging_failure_code" = 'LEGACY_TAGS_REQUIRED'
WHERE "upload_status" = 'ready'
  AND ("category" IS NULL OR "comfort_range" IS NULL);

-- Cast columns to enum types
ALTER TABLE "GarmentItem"
  ALTER COLUMN "category" TYPE "GarmentCategory" USING ("category"::"GarmentCategory"),
  ALTER COLUMN "material" TYPE "GarmentMaterial" USING ("material"::"GarmentMaterial"),
  ALTER COLUMN "comfort_range" TYPE "GarmentComfortRange" USING ("comfort_range"::"GarmentComfortRange");

-- Add database check constraint requiring non-null category and comfort when status is ready
ALTER TABLE "GarmentItem"
  ADD CONSTRAINT "GarmentItem_ready_tags_check"
  CHECK ("upload_status" != 'ready' OR ("category" IS NOT NULL AND "comfort_range" IS NOT NULL));
