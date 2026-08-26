-- Story 5.4: color palette & beauty/accessory advisor.
--
-- Three things are load-bearing here:
--
--   * `PaletteProfile` and `AdvisorRecommendationState` are owner-only
--     (selfOnlyTables), the same posture CommercePreference and
--     PremiumThemePreference took. A derived skin-tone/depth characteristic is
--     not something this story has a mandate to expose to a guardian, even
--     though the neighboring PaletteInsights (garment colour, not skin) is
--     guardian-shared. See Decision 11 / the story's open question 1.
--   * `AffiliateOffer` is extended, not forked, to carry beauty/accessory
--     advisor offers alongside its existing garment offers. `garment_category`
--     becomes nullable and two new nullable columns are added; the
--     `num_nonnulls` check constraint below is what keeps every row
--     unambiguously a garment offer XOR an advisor offer.
--   * The selfie upload lifecycle columns on `PaletteProfile` mirror
--     `SilhouetteProfile.my_form_*` exactly, except there is no retention
--     column: the selfie is purged on every terminal analysis status, never
--     retained (Decision 8), so `selfie_purged_at` replaces
--     `my_form_retention_status`/`my_form_moderation_flagged_at`.

-- CreateEnum
CREATE TYPE "PaletteSource" AS ENUM ('selfie', 'wardrobe');

-- CreateEnum
CREATE TYPE "SkinUndertone" AS ENUM ('warm', 'cool', 'neutral', 'olive');

-- CreateEnum
CREATE TYPE "SkinDepth" AS ENUM ('fair', 'light', 'medium', 'tan', 'deep');

-- CreateEnum
CREATE TYPE "PaletteAnalysisStatus" AS ENUM ('pending_upload', 'bytes_uploaded', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "PaletteAnalysisFailureReason" AS ENUM ('no_face', 'low_quality', 'privacy_violation', 'insufficient_wardrobe', 'timeout', 'storage_error');

-- CreateEnum
CREATE TYPE "AdvisorSlot" AS ENUM ('foundation', 'blush', 'jewelry', 'bag', 'eyewear');

-- CreateEnum
CREATE TYPE "AdvisorAction" AS ENUM ('saved', 'dismissed');

-- AlterTable: AffiliateOffer gains two nullable advisor columns and relaxes
-- garment_category to nullable so an advisor-only row has an honest value.
ALTER TABLE "AffiliateOffer"
  ADD COLUMN "advisor_slot" "AdvisorSlot",
  ADD COLUMN "advisor_undertone" "SkinUndertone",
  ALTER COLUMN "garment_category" DROP NOT NULL;

-- Every row is unambiguously a garment offer or an advisor offer, never both
-- and never neither. This is what keeps AffiliateOfferService.resolveShopThisLook
-- (which filters on garment_category equality) and the new advisor selection
-- (which filters on advisor_slot equality) from ever selecting each other's rows
-- by construction, independent of the NULL-semantics guarantee documented in
-- commerce.repository.ts.
ALTER TABLE "AffiliateOffer"
  ADD CONSTRAINT "AffiliateOffer_garment_category_advisor_slot_check"
  CHECK (num_nonnulls("garment_category", "advisor_slot") = 1);

-- CreateTable
CREATE TABLE "PaletteProfile" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "consent_granted_at" TIMESTAMP(3),
    "consent_revoked_at" TIMESTAMP(3),
    "source" "PaletteSource",
    "undertone" "SkinUndertone",
    "depth" "SkinDepth",
    "confidence" DOUBLE PRECISION,
    "analysis_version" TEXT,
    "analyzed_at" TIMESTAMP(3),
    "status" "PaletteAnalysisStatus",
    "failure_reason" "PaletteAnalysisFailureReason",
    "selfie_object_path" TEXT,
    "selfie_upload_session_id" TEXT,
    "selfie_upload_idempotency_key" TEXT,
    "selfie_commit_idempotency_key" TEXT,
    "selfie_commit_payload_hash" TEXT,
    "selfie_file_size_bytes" INTEGER,
    "selfie_mime_type" TEXT,
    "selfie_content_sha256" TEXT,
    "selfie_width_px" INTEGER,
    "selfie_height_px" INTEGER,
    "selfie_upload_expires_at" TIMESTAMP(3),
    "selfie_committed_at" TIMESTAMP(3),
    "selfie_purged_at" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaletteProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvisorRecommendationState" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slot" "AdvisorSlot" NOT NULL,
    "item_key" TEXT NOT NULL,
    "action" "AdvisorAction" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvisorRecommendationState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaletteProfile_user_id_key" ON "PaletteProfile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "PaletteProfile_selfie_object_path_key" ON "PaletteProfile"("selfie_object_path");

-- CreateIndex
CREATE UNIQUE INDEX "PaletteProfile_selfie_upload_session_id_key" ON "PaletteProfile"("selfie_upload_session_id");

-- CreateIndex
CREATE INDEX "PaletteProfile_user_id_idx" ON "PaletteProfile"("user_id");

-- CreateIndex
CREATE INDEX "PaletteProfile_user_id_status_selfie_upload_expires_at_idx" ON "PaletteProfile"("user_id", "status", "selfie_upload_expires_at");

-- CreateIndex
CREATE INDEX "AdvisorRecommendationState_user_id_idx" ON "AdvisorRecommendationState"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "AdvisorRecommendationState_user_id_slot_item_key_key" ON "AdvisorRecommendationState"("user_id", "slot", "item_key");

-- CreateIndex: the advisor lookup's own index, parallel to the existing
-- garment index just above it. The garment index is untouched. PARTIAL on
-- advisor_slot IS NOT NULL: the CHECK constraint above guarantees every row
-- is a garment offer XOR an advisor offer, so this predicate is the exact
-- complement of the garment index's rows. Without it, a garment-only query
-- (whose garment_category OR-list cannot be expressed as an index condition
-- on either index and falls back to a Filter) sees two structurally tied
-- (status, locale_region) prefixes and the planner can pick either one,
-- which regressed integration/commerce-affiliate-offers-query-plan's
-- 5.1-PLAN-03 to a BitmapOr across this index instead of the garment index.
-- The predicate also shrinks this index to only the rows it actually serves.
CREATE INDEX "AffiliateOffer_status_locale_region_advisor_slot_priority_idx" ON "AffiliateOffer"("status", "locale_region", "advisor_slot", "priority" DESC) WHERE "advisor_slot" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "PaletteProfile" ADD CONSTRAINT "PaletteProfile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvisorRecommendationState" ADD CONSTRAINT "AdvisorRecommendationState_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS: owner-only tables.
-- can_manage_self_row grants the owner and an admin actor, and nobody else.
-- Both guardian consent levels resolve to false through it, which is the
-- intended outcome here (open question 1) and is asserted by the AC 9 actor
-- matrix in packages/db/test/rls/palette-advisor.spec.ts.
--
-- The four policy names below are not decorative: palette-advisor-schema.spec.ts
-- asserts that each table carries exactly this set, so a renamed policy is a
-- failing test rather than a silent drift.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PaletteProfile" TO authenticated;
ALTER TABLE public."PaletteProfile" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_user_data ON public."PaletteProfile";
CREATE POLICY authenticated_read_own_user_data
  ON public."PaletteProfile"
  FOR SELECT
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."PaletteProfile";
CREATE POLICY authenticated_insert_own_user_data
  ON public."PaletteProfile"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."PaletteProfile";
CREATE POLICY authenticated_update_own_user_data
  ON public."PaletteProfile"
  FOR UPDATE
  TO authenticated
  USING (private.can_manage_self_row("user_id"))
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."PaletteProfile";
CREATE POLICY authenticated_delete_own_user_data
  ON public."PaletteProfile"
  FOR DELETE
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."AdvisorRecommendationState" TO authenticated;
ALTER TABLE public."AdvisorRecommendationState" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_user_data ON public."AdvisorRecommendationState";
CREATE POLICY authenticated_read_own_user_data
  ON public."AdvisorRecommendationState"
  FOR SELECT
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."AdvisorRecommendationState";
CREATE POLICY authenticated_insert_own_user_data
  ON public."AdvisorRecommendationState"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."AdvisorRecommendationState";
CREATE POLICY authenticated_update_own_user_data
  ON public."AdvisorRecommendationState"
  FOR UPDATE
  TO authenticated
  USING (private.can_manage_self_row("user_id"))
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."AdvisorRecommendationState";
CREATE POLICY authenticated_delete_own_user_data
  ON public."AdvisorRecommendationState"
  FOR DELETE
  TO authenticated
  USING (private.can_manage_self_row("user_id"));
