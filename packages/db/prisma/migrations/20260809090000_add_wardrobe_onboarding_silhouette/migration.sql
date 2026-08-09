-- Story 4.4: wardrobe onboarding state machine and silhouette profile
-- (mannequin sliders or a private "My Form" photo pipeline).

CREATE TYPE "WardrobeOnboardingStatus" AS ENUM (
  'not_started',
  'in_progress',
  'completed'
);

CREATE TYPE "WardrobeOnboardingStep" AS ENUM (
  'permission',
  'capture',
  'tagging',
  'silhouette',
  'complete'
);

CREATE TYPE "SilhouetteMode" AS ENUM (
  'default_mannequin',
  'my_form'
);

CREATE TYPE "SilhouettePhotoStatus" AS ENUM (
  'pending_upload',
  'bytes_uploaded',
  'processing',
  'ready',
  'failed'
);

CREATE TYPE "SilhouettePhotoFailureReason" AS ENUM (
  'contrast',
  'privacy_violation',
  'timeout',
  'storage_error'
);

-- ---------------------------------------------------------------------------
-- WardrobeOnboardingState: one row per user, created only once the flow
-- actually starts. Absent means the client renders the virtual not_started
-- default (decision 3, Task 3).
-- ---------------------------------------------------------------------------
CREATE TABLE "WardrobeOnboardingState" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "WardrobeOnboardingStatus" NOT NULL DEFAULT 'not_started',
    "current_step" "WardrobeOnboardingStep" NOT NULL DEFAULT 'permission',
    "used_starter_wardrobe" BOOLEAN NOT NULL DEFAULT false,
    "garments_captured_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WardrobeOnboardingState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WardrobeOnboardingState_user_id_key" ON "WardrobeOnboardingState"("user_id");
CREATE INDEX "WardrobeOnboardingState_user_id_idx" ON "WardrobeOnboardingState"("user_id");

ALTER TABLE "WardrobeOnboardingState"
  ADD CONSTRAINT "WardrobeOnboardingState_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- SilhouetteProfile: one row per user. Sliders and the "My Form" photo
-- lifecycle coexist so switching mode never discards the other (decision 5).
-- The my_form_* columns mirror GarmentItem's upload lifecycle exactly.
-- ---------------------------------------------------------------------------
CREATE TABLE "SilhouetteProfile" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mode" "SilhouetteMode" NOT NULL DEFAULT 'default_mannequin',
    "height_slider" INTEGER,
    "build_slider" INTEGER,
    "my_form_object_path" TEXT,
    "my_form_upload_session_id" TEXT,
    "my_form_upload_idempotency_key" TEXT,
    "my_form_commit_idempotency_key" TEXT,
    "my_form_commit_payload_hash" TEXT,
    "my_form_file_size_bytes" INTEGER,
    "my_form_mime_type" TEXT,
    "my_form_content_sha256" TEXT,
    "my_form_width_px" INTEGER,
    "my_form_height_px" INTEGER,
    "my_form_upload_expires_at" TIMESTAMP(3),
    "my_form_committed_at" TIMESTAMP(3),
    "my_form_consent_checked_at" TIMESTAMP(3),
    "my_form_status" "SilhouettePhotoStatus",
    "my_form_failure_reason" "SilhouettePhotoFailureReason",
    "my_form_moderation_flagged_at" TIMESTAMP(3),
    "my_form_retention_status" "GarmentRetentionStatus" NOT NULL DEFAULT 'active',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SilhouetteProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SilhouetteProfile_user_id_key" ON "SilhouetteProfile"("user_id");
CREATE UNIQUE INDEX "SilhouetteProfile_my_form_object_path_key" ON "SilhouetteProfile"("my_form_object_path");
CREATE UNIQUE INDEX "SilhouetteProfile_my_form_upload_session_id_key" ON "SilhouetteProfile"("my_form_upload_session_id");
CREATE INDEX "SilhouetteProfile_user_id_idx" ON "SilhouetteProfile"("user_id");
CREATE INDEX "SilhouetteProfile_user_id_my_form_status_my_form_upload_exp_idx" ON "SilhouetteProfile"("user_id", "my_form_status", "my_form_upload_expires_at");

ALTER TABLE "SilhouetteProfile"
  ADD CONSTRAINT "SilhouetteProfile_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ModerationEvent gains an optional silhouette_profile_id, mirroring the
-- existing optional garment_item_id (decision 10). A privacy_violation
-- verdict on a teen's "My Form" photo (Task 4) writes a row here.
-- ---------------------------------------------------------------------------
ALTER TABLE "ModerationEvent" ADD COLUMN "silhouette_profile_id" TEXT;

ALTER TABLE "ModerationEvent"
  ADD CONSTRAINT "ModerationEvent_silhouette_profile_id_fkey"
  FOREIGN KEY ("silhouette_profile_id") REFERENCES "SilhouetteProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS: identical guardian-shared boundary already proven for GarmentItem and
-- OutfitCapsule (decision 10). A guardian overseeing a teen's account needs
-- the same visibility into onboarding progress and a body photo that they
-- already have into wardrobe photos.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."WardrobeOnboardingState" TO authenticated;
ALTER TABLE public."WardrobeOnboardingState" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_shared_user_data ON public."WardrobeOnboardingState";
CREATE POLICY authenticated_read_shared_user_data ON public."WardrobeOnboardingState" FOR SELECT TO authenticated USING (private.can_read_shared_user_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_shared_user_data ON public."WardrobeOnboardingState";
CREATE POLICY authenticated_insert_shared_user_data ON public."WardrobeOnboardingState" FOR INSERT TO authenticated WITH CHECK (private.can_write_shared_user_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_shared_user_data ON public."WardrobeOnboardingState";
CREATE POLICY authenticated_update_shared_user_data ON public."WardrobeOnboardingState" FOR UPDATE TO authenticated USING (private.can_write_shared_user_row("user_id")) WITH CHECK (private.can_write_shared_user_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_shared_user_data ON public."WardrobeOnboardingState";
CREATE POLICY authenticated_delete_shared_user_data ON public."WardrobeOnboardingState" FOR DELETE TO authenticated USING (private.can_write_shared_user_row("user_id"));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."SilhouetteProfile" TO authenticated;
ALTER TABLE public."SilhouetteProfile" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_shared_user_data ON public."SilhouetteProfile";
CREATE POLICY authenticated_read_shared_user_data ON public."SilhouetteProfile" FOR SELECT TO authenticated USING (private.can_read_shared_user_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_shared_user_data ON public."SilhouetteProfile";
CREATE POLICY authenticated_insert_shared_user_data ON public."SilhouetteProfile" FOR INSERT TO authenticated WITH CHECK (private.can_write_shared_user_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_shared_user_data ON public."SilhouetteProfile";
CREATE POLICY authenticated_update_shared_user_data ON public."SilhouetteProfile" FOR UPDATE TO authenticated USING (private.can_write_shared_user_row("user_id")) WITH CHECK (private.can_write_shared_user_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_shared_user_data ON public."SilhouetteProfile";
CREATE POLICY authenticated_delete_shared_user_data ON public."SilhouetteProfile" FOR DELETE TO authenticated USING (private.can_write_shared_user_row("user_id"));
