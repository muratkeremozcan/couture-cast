-- Create CapsuleOccasion enum
CREATE TYPE "CapsuleOccasion" AS ENUM (
  'work',
  'casual',
  'formal',
  'sport',
  'travel',
  'evening',
  'outdoor',
  'home'
);

-- Add capsule_revision to UserProfile
ALTER TABLE "UserProfile" ADD COLUMN "capsule_revision" INTEGER NOT NULL DEFAULT 0;

-- Add unique constraint on GarmentItem(id, user_id)
CREATE UNIQUE INDEX "GarmentItem_id_user_id_key" ON "GarmentItem"("id", "user_id");

-- Create OutfitCapsule table
CREATE TABLE "OutfitCapsule" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "occasions" "CapsuleOccasion"[] NOT NULL,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT,
    "idempotency_payload_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutfitCapsule_pkey" PRIMARY KEY ("id")
);

-- Create OutfitCapsuleGarment table
CREATE TABLE "OutfitCapsuleGarment" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "capsule_id" TEXT NOT NULL,
    "garment_id" TEXT NOT NULL,
    "garment_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutfitCapsuleGarment_pkey" PRIMARY KEY ("id")
);

-- Add garment_order database check constraint (0 to 9)
ALTER TABLE "OutfitCapsuleGarment"
  ADD CONSTRAINT "OutfitCapsuleGarment_garment_order_check"
  CHECK ("garment_order" >= 0 AND "garment_order" <= 9);

-- Add capsule_id and capsule_revision to OutfitRecommendation
ALTER TABLE "OutfitRecommendation" ADD COLUMN "capsule_id" TEXT;
ALTER TABLE "OutfitRecommendation" ADD COLUMN "capsule_revision" INTEGER NOT NULL DEFAULT 0;

-- Create Indexes and Unique Constraints for OutfitCapsule
CREATE UNIQUE INDEX "OutfitCapsule_id_user_id_key" ON "OutfitCapsule"("id", "user_id");
CREATE UNIQUE INDEX "OutfitCapsule_user_id_idempotency_key_key" ON "OutfitCapsule"("user_id", "idempotency_key");
CREATE INDEX "OutfitCapsule_user_id_idx" ON "OutfitCapsule"("user_id");
CREATE INDEX "OutfitCapsule_user_id_is_favorite_updated_at_id_idx" ON "OutfitCapsule"("user_id", "is_favorite" DESC, "updated_at" DESC, "id" ASC);
CREATE INDEX "OutfitCapsule_user_id_updated_at_idx" ON "OutfitCapsule"("user_id", "updated_at" DESC);
CREATE INDEX "OutfitCapsule_user_id_name_idx" ON "OutfitCapsule"("user_id", "name");

-- Create Indexes and Unique Constraints for OutfitCapsuleGarment
CREATE UNIQUE INDEX "OutfitCapsuleGarment_capsule_id_garment_id_key" ON "OutfitCapsuleGarment"("capsule_id", "garment_id");
CREATE UNIQUE INDEX "OutfitCapsuleGarment_capsule_id_garment_order_key" ON "OutfitCapsuleGarment"("capsule_id", "garment_order");
CREATE INDEX "OutfitCapsuleGarment_user_id_idx" ON "OutfitCapsuleGarment"("user_id");
CREATE INDEX "OutfitCapsuleGarment_garment_id_idx" ON "OutfitCapsuleGarment"("garment_id");
CREATE INDEX "OutfitCapsuleGarment_capsule_id_garment_order_idx" ON "OutfitCapsuleGarment"("capsule_id", "garment_order");

-- Create Index for OutfitRecommendation
CREATE INDEX "OutfitRecommendation_capsule_id_idx" ON "OutfitRecommendation"("capsule_id");

-- Foreign key constraints
ALTER TABLE "OutfitCapsule" ADD CONSTRAINT "OutfitCapsule_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutfitCapsuleGarment" ADD CONSTRAINT "OutfitCapsuleGarment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutfitCapsuleGarment" ADD CONSTRAINT "OutfitCapsuleGarment_capsule_id_user_id_fkey" FOREIGN KEY ("capsule_id", "user_id") REFERENCES "OutfitCapsule"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutfitCapsuleGarment" ADD CONSTRAINT "OutfitCapsuleGarment_garment_id_user_id_fkey" FOREIGN KEY ("garment_id", "user_id") REFERENCES "GarmentItem"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutfitRecommendation" ADD CONSTRAINT "OutfitRecommendation_capsule_id_fkey" FOREIGN KEY ("capsule_id") REFERENCES "OutfitCapsule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS policies and grants for OutfitCapsule and OutfitCapsuleGarment
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."OutfitCapsule" TO authenticated;
ALTER TABLE public."OutfitCapsule" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_shared_user_data ON public."OutfitCapsule";
CREATE POLICY authenticated_read_shared_user_data ON public."OutfitCapsule" FOR SELECT TO authenticated USING (private.can_read_shared_user_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_shared_user_data ON public."OutfitCapsule";
CREATE POLICY authenticated_insert_shared_user_data ON public."OutfitCapsule" FOR INSERT TO authenticated WITH CHECK (private.can_write_shared_user_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_shared_user_data ON public."OutfitCapsule";
CREATE POLICY authenticated_update_shared_user_data ON public."OutfitCapsule" FOR UPDATE TO authenticated USING (private.can_write_shared_user_row("user_id")) WITH CHECK (private.can_write_shared_user_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_shared_user_data ON public."OutfitCapsule";
CREATE POLICY authenticated_delete_shared_user_data ON public."OutfitCapsule" FOR DELETE TO authenticated USING (private.can_write_shared_user_row("user_id"));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."OutfitCapsuleGarment" TO authenticated;
ALTER TABLE public."OutfitCapsuleGarment" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_shared_user_data ON public."OutfitCapsuleGarment";
CREATE POLICY authenticated_read_shared_user_data ON public."OutfitCapsuleGarment" FOR SELECT TO authenticated USING (private.can_read_shared_user_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_shared_user_data ON public."OutfitCapsuleGarment";
CREATE POLICY authenticated_insert_shared_user_data ON public."OutfitCapsuleGarment" FOR INSERT TO authenticated WITH CHECK (private.can_write_shared_user_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_shared_user_data ON public."OutfitCapsuleGarment";
CREATE POLICY authenticated_update_shared_user_data ON public."OutfitCapsuleGarment" FOR UPDATE TO authenticated USING (private.can_write_shared_user_row("user_id")) WITH CHECK (private.can_write_shared_user_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_shared_user_data ON public."OutfitCapsuleGarment";
CREATE POLICY authenticated_delete_shared_user_data ON public."OutfitCapsuleGarment" FOR DELETE TO authenticated USING (private.can_write_shared_user_row("user_id"));

-- ---------------------------------------------------------------------------
-- Same-owner integrity for the recommendation -> capsule reference.
-- Every other capsule relation is bound by a composite (id, user_id) key. The
-- single-column reference left nothing at the database level to stop a
-- recommendation owned by one user from pointing at another user's capsule.
--
-- NO ACTION rather than SET NULL: a composite SET NULL would also null the
-- required user_id, and PostgreSQL's column-specific form cannot be expressed
-- in schema.prisma while user_id stays required, which would leave permanent
-- migrate-diff drift. `deleteCapsule` already clears capsule_id inside the same
-- transaction before removing the capsule, so observable behaviour is
-- unchanged; any other path that deletes a capsule without clearing the
-- reference now fails loudly instead of silently.
-- ---------------------------------------------------------------------------
ALTER TABLE "OutfitRecommendation" DROP CONSTRAINT "OutfitRecommendation_capsule_id_fkey";
ALTER TABLE "OutfitRecommendation"
  ADD CONSTRAINT "OutfitRecommendation_capsule_id_user_id_fkey"
  FOREIGN KEY ("capsule_id", "user_id") REFERENCES "OutfitCapsule"("id", "user_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Search indexes.
-- Keyword search compiles to a leading-wildcard case-insensitive LIKE, which a
-- btree index cannot serve, and occasion filtering uses an array containment
-- operator that needs GIN. Without these the 1,000-capsule performance profile
-- sequential-scans on every keyword and occasion query.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "OutfitCapsule_name_trgm_idx" ON "OutfitCapsule" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "OutfitCapsule_description_trgm_idx" ON "OutfitCapsule" USING GIN ("description" gin_trgm_ops);
CREATE INDEX "OutfitCapsule_occasions_idx" ON "OutfitCapsule" USING GIN ("occasions");

-- ---------------------------------------------------------------------------
-- Durable telemetry claims.
-- A state-changing capsule mutation persists exactly one claim inside its own
-- transaction. Delivery to the analytics sink happens after commit and is
-- retried from this table, so a crash between commit and delivery cannot lose
-- the event and a retry cannot duplicate it. The unique mutation key is what
-- defines one logical event across retries and concurrent callers.
--
-- This table holds no user-authored content and is never exposed to end users,
-- so RLS is enabled with no grants to the authenticated role.
-- ---------------------------------------------------------------------------
CREATE TABLE "CapsuleTelemetryClaim" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "capsule_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "event_name" TEXT NOT NULL,
    "mutation_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "CapsuleTelemetryClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CapsuleTelemetryClaim_mutation_key_key" ON "CapsuleTelemetryClaim"("mutation_key");
CREATE INDEX "CapsuleTelemetryClaim_delivered_at_claimed_at_idx" ON "CapsuleTelemetryClaim"("delivered_at", "claimed_at");
CREATE INDEX "CapsuleTelemetryClaim_user_id_idx" ON "CapsuleTelemetryClaim"("user_id");

ALTER TABLE "CapsuleTelemetryClaim"
  ADD CONSTRAINT "CapsuleTelemetryClaim_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."CapsuleTelemetryClaim" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CapsuleTelemetryClaim" FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- Purge idempotency.
-- purgeGarment never advanced retention_status past 'deletion_pending', and the
-- hourly sweep re-selects that status unconditionally. Every pass therefore
-- re-purged the same garment and incremented the revision of every capsule
-- containing it, churning list order, invalidating every client ETag, and
-- forcing a full recommendation regeneration once an hour indefinitely.
-- ---------------------------------------------------------------------------
ALTER TABLE "GarmentItem" ADD COLUMN "retention_purged_at" TIMESTAMP(3);

CREATE INDEX "GarmentItem_retention_purge_sweep_idx"
  ON "GarmentItem"("retention_status", "retention_purged_at", "created_at");
