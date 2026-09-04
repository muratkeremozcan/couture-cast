-- Story 5.5: premium 7-day outfit planner.
--
-- `PlannerDayPlan` is a disposable cache row, one per user/location/date
-- (Decision 4). It mirrors PaletteProfile's owner-only RLS posture exactly:
-- a planner day is a personal, derived recommendation, not something a
-- guardian has a mandate to read or write (same reasoning as Decision 11 in
-- the palette-advisor story). The composite FK to SavedLocation(id, user_id)
-- is what makes it structurally impossible for a planner row to reference
-- another user's saved location, mirroring OutfitCapsuleGarment's FK to
-- GarmentItem(id, user_id).

-- CreateEnum
CREATE TYPE "PlannerOutfitSource" AS ENUM ('generated', 'reshuffled');

-- CreateTable
CREATE TABLE "PlannerDayPlan" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "plan_date" DATE NOT NULL,
    "locale" TEXT NOT NULL,
    "dependency_fingerprint" TEXT NOT NULL,
    "plan_payload" JSONB NOT NULL,
    "source" "PlannerOutfitSource" NOT NULL DEFAULT 'generated',
    "version" INTEGER NOT NULL DEFAULT 1,
    "reshuffle_count" INTEGER NOT NULL DEFAULT 0,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannerDayPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlannerDayPlan_user_id_plan_date_idx" ON "PlannerDayPlan"("user_id", "plan_date");

-- CreateIndex
CREATE UNIQUE INDEX "PlannerDayPlan_user_id_location_id_plan_date_key" ON "PlannerDayPlan"("user_id", "location_id", "plan_date");

-- CreateIndex: lets PlannerDayPlan carry a composite FK to (id, user_id),
-- the same pattern GarmentItem/OutfitCapsule already use.
CREATE UNIQUE INDEX "SavedLocation_id_user_id_key" ON "SavedLocation"("id", "user_id");

-- AddForeignKey
ALTER TABLE "PlannerDayPlan" ADD CONSTRAINT "PlannerDayPlan_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannerDayPlan" ADD CONSTRAINT "PlannerDayPlan_location_id_user_id_fkey" FOREIGN KEY ("location_id", "user_id") REFERENCES "SavedLocation"("id", "user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- RLS: owner-only. Mirrors PaletteProfile's grant/policy block exactly
-- (packages/db/prisma/migrations/20260825090000_add_palette_advisor).
--
-- The four policy names below are not decorative: planner-schema.spec.ts
-- asserts that this table carries exactly this set, so a renamed policy is
-- a failing test rather than a silent drift.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PlannerDayPlan" TO authenticated;
ALTER TABLE public."PlannerDayPlan" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_own_user_data ON public."PlannerDayPlan";
CREATE POLICY authenticated_read_own_user_data
  ON public."PlannerDayPlan"
  FOR SELECT
  TO authenticated
  USING (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public."PlannerDayPlan";
CREATE POLICY authenticated_insert_own_user_data
  ON public."PlannerDayPlan"
  FOR INSERT
  TO authenticated
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_update_own_user_data ON public."PlannerDayPlan";
CREATE POLICY authenticated_update_own_user_data
  ON public."PlannerDayPlan"
  FOR UPDATE
  TO authenticated
  USING (private.can_manage_self_row("user_id"))
  WITH CHECK (private.can_manage_self_row("user_id"));

DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public."PlannerDayPlan";
CREATE POLICY authenticated_delete_own_user_data
  ON public."PlannerDayPlan"
  FOR DELETE
  TO authenticated
  USING (private.can_manage_self_row("user_id"));
