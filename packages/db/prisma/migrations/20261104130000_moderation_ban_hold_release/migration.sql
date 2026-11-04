-- Story 6.11: content a temporary ban held returns to screening when the ban ends.
-- `holds_released_at` records that a ban's held rows were handled, so the sweep is retry-safe and
-- never rescans a finished ban.
ALTER TABLE "CommunitySanction" ADD COLUMN "holds_released_at" TIMESTAMP(3);

CREATE INDEX "CommunitySanction_pending_hold_release_idx"
  ON "CommunitySanction" ("expires_at")
  WHERE "holds_released_at" IS NULL;

-- A retained BullMQ job under the same id swallows a re-enqueue, so a re-armed post gets a new id.
ALTER TABLE "CommunityModerationOutbox" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0;

-- A ban's marker overwrites the machine reason a released row kept. It comes back on overturn.
ALTER TABLE "LookbookPost" ADD COLUMN "ban_prior_reason" TEXT;
ALTER TABLE "CommunityComment" ADD COLUMN "ban_prior_reason" TEXT;
