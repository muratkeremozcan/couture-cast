-- Story 4.1: private garment upload lifecycle and idempotent processing handoff.
CREATE TYPE "GarmentUploadStatus" AS ENUM (
  'pending_upload',
  'bytes_uploaded',
  'processing',
  'ready',
  'failed'
);

CREATE TYPE "GarmentRetentionStatus" AS ENUM (
  'active',
  'deletion_pending',
  'legal_hold'
);

ALTER TABLE "GarmentItem"
  ALTER COLUMN "category" DROP NOT NULL,
  ADD COLUMN "object_path" TEXT,
  ADD COLUMN "upload_session_id" TEXT,
  ADD COLUMN "upload_idempotency_key" TEXT,
  ADD COLUMN "commit_idempotency_key" TEXT,
  ADD COLUMN "commit_payload_hash" TEXT,
  ADD COLUMN "file_size_bytes" INTEGER,
  ADD COLUMN "mime_type" TEXT,
  ADD COLUMN "content_sha256" TEXT,
  ADD COLUMN "width_px" INTEGER,
  ADD COLUMN "height_px" INTEGER,
  ADD COLUMN "upload_status" "GarmentUploadStatus" NOT NULL DEFAULT 'pending_upload',
  ADD COLUMN "retention_status" "GarmentRetentionStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "upload_expires_at" TIMESTAMP(3),
  ADD COLUMN "committed_at" TIMESTAMP(3),
  ADD COLUMN "consent_checked_at" TIMESTAMP(3),
  ADD COLUMN "has_cropping" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "has_bg_cleanup" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "completion_telemetry_emitted_at" TIMESTAMP(3),
  ADD COLUMN "processing_job_enqueued_at" TIMESTAMP(3),
  ADD COLUMN "failure_code" TEXT,
  ADD COLUMN "retention_trigger" TEXT,
  ADD COLUMN "deletion_requested_at" TIMESTAMP(3);

-- Rows that predate the upload lifecycle already represent committed garments.
UPDATE "GarmentItem"
SET
  "upload_status" = 'ready',
  "committed_at" = "created_at";

CREATE UNIQUE INDEX "GarmentItem_object_path_key"
  ON "GarmentItem"("object_path");
CREATE UNIQUE INDEX "GarmentItem_upload_session_id_key"
  ON "GarmentItem"("upload_session_id");
CREATE UNIQUE INDEX "GarmentItem_user_id_upload_idempotency_key_key"
  ON "GarmentItem"("user_id", "upload_idempotency_key");
CREATE UNIQUE INDEX "GarmentItem_user_id_commit_idempotency_key_key"
  ON "GarmentItem"("user_id", "commit_idempotency_key");
CREATE INDEX "GarmentItem_user_id_upload_status_upload_expires_at_idx"
  ON "GarmentItem"("user_id", "upload_status", "upload_expires_at");
CREATE INDEX "GarmentItem_retention_status_deletion_requested_at_idx"
  ON "GarmentItem"("retention_status", "deletion_requested_at");

-- Supabase Storage is provisioned only when the Storage schema is installed.
DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    )
    VALUES (
      'wardrobe-images',
      'wardrobe-images',
      false,
      10485760,
      ARRAY['image/jpeg', 'image/png', 'image/webp']
    )
    ON CONFLICT (id) DO UPDATE SET
      public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END
$storage$;

DO $storage_policy$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS wardrobe_read_authorized ON storage.objects;
    CREATE POLICY wardrobe_read_authorized
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'wardrobe-images'
        AND private.can_read_shared_user_row((storage.foldername(name))[2])
      );
  END IF;
END
$storage_policy$;
