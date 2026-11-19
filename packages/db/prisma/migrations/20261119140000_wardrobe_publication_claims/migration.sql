-- Production follow-up 2026-11-19 (review round 3, Codex findings 1, 5, 6 and 11).
--
-- 1. Publication ownership. Before any storage I/O, a commit claims its upload session's
--    publication: the attempt id and its start time. Only that attempt downloads, verifies,
--    publishes and claims the row; a concurrent commit answers UPLOAD_IN_PROGRESS without
--    touching storage. Erasure, purge and replacement that meet an unfinished publication defer
--    the session's keys in the deletion outbox past the claim's lease, so a publish that lands
--    late is deleted after it lands.
--
-- 2. Job handoff markers on both profiles, like GarmentItem.processing_job_enqueued_at: commit
--    sets processing and enqueues with a deterministic job id; a replay or the maintenance job
--    re-enqueues a processing row whose marker is missing.
--
-- 3. PaletteProfile.analysis_attempt_id names the analysis a profile is processing, so a job
--    for an older attempt (wardrobe or selfie) exits without writing.
--
-- 4. WardrobeMaintenanceState keeps the staging sweep's listing continuation across runs.
--    API-only: RLS on, no policies, no client grants.
ALTER TABLE public."GarmentItem"
  ADD COLUMN "publish_attempt_id" TEXT,
  ADD COLUMN "publish_started_at" TIMESTAMP(3);

ALTER TABLE public."SilhouetteProfile"
  ADD COLUMN "my_form_publish_attempt_id" TEXT,
  ADD COLUMN "my_form_publish_started_at" TIMESTAMP(3),
  ADD COLUMN "my_form_processing_job_enqueued_at" TIMESTAMP(3);

ALTER TABLE public."PaletteProfile"
  ADD COLUMN "selfie_publish_attempt_id" TEXT,
  ADD COLUMN "selfie_publish_started_at" TIMESTAMP(3),
  ADD COLUMN "analysis_attempt_id" TEXT,
  ADD COLUMN "processing_job_enqueued_at" TIMESTAMP(3);

-- Rows already processing keep a null job handoff marker: a process before this deploy could
-- have stopped between the processing update and the queue delivery, and nothing records which
-- did. A null marker lets a same-key replay and the hourly maintenance handoff enqueue them under
-- their deterministic job ids; where the original job still exists, that enqueue is a no-op.
--
-- Each processing palette analysis gets an attempt. A selfie analysis's attempt is its session,
-- the suffix its job id has always carried. A wardrobe analysis from before this deploy has no
-- recoverable attempt, so it gets the known legacy attempt 'legacy-wardrobe-analysis': the
-- maintenance handoff enqueues `<profileId>__legacy-wardrobe-analysis` for it, and the worker
-- lets only a job with that attempt finish or fail it, so an unrelated older job for the same
-- profile exits without writing.
UPDATE public."PaletteProfile"
  SET "analysis_attempt_id" = CASE
        WHEN "source" = 'selfie' THEN "selfie_upload_session_id"
        ELSE 'legacy-wardrobe-analysis'
      END
  WHERE "status" = 'processing';

CREATE TABLE public."WardrobeMaintenanceState" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WardrobeMaintenanceState_pkey" PRIMARY KEY ("key")
);

REVOKE ALL ON TABLE public."WardrobeMaintenanceState" FROM anon, authenticated;
ALTER TABLE public."WardrobeMaintenanceState" ENABLE ROW LEVEL SECURITY;
