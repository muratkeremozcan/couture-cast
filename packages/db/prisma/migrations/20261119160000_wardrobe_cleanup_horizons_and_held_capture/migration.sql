-- Production follow-up 2026-11-19 (review round 5, Codex C5-2 to C5-7).
--
-- 1. Cleanup horizons (C5-2). Every publication claim records until when a write it started
--    could still land: claim start plus 24 hours. The column is never cleared by lease expiry,
--    takeover or success, and a later claim only moves it later. Erasure, purge, replacement,
--    the selfie processor's terminal removal and garment deletion read it and repeat their
--    removal until then, even after the lease ran out or the publication succeeded.
--
-- 2. Held source capture (C5-3, C5-4, C5-5). held_source_object_path is the obligation the
--    hourly capture records, under the garment row lock, before it writes the immutable
--    held/<userId>/<garmentId>.<ext> copy: a purge or a release removes that key whether or not
--    the digest marker was recorded. held_source_capture_outcome is the operator-visible result
--    of the last capture attempt (captured, missing, digest_mismatch, copy_mismatch, invalid,
--    failed); held_source_checked_at orders capture so rows that cannot be captured rotate
--    behind the others instead of filling every batch.
--
-- 3. processing_deferred_at (C5-7). The color worker declines to process a garment under legal
--    hold; it records this and clears the job handoff marker, so after release the maintenance
--    handoff (or a commit replay) enqueues a fresh job id derived from it. The original job id
--    is retained as completed for seven days and would make a plain re-enqueue a no-op.
ALTER TABLE public."GarmentItem"
  ADD COLUMN "publish_cleanup_until" TIMESTAMP(3),
  ADD COLUMN "held_source_object_path" TEXT,
  ADD COLUMN "held_source_capture_outcome" TEXT,
  ADD COLUMN "held_source_checked_at" TIMESTAMP(3),
  ADD COLUMN "processing_deferred_at" TIMESTAMP(3);

ALTER TABLE public."SilhouetteProfile"
  ADD COLUMN "my_form_publish_cleanup_until" TIMESTAMP(3);

ALTER TABLE public."PaletteProfile"
  ADD COLUMN "selfie_publish_cleanup_until" TIMESTAMP(3);

-- A claim taken before this deploy keeps the horizon its start implies.
UPDATE public."GarmentItem"
  SET "publish_cleanup_until" = "publish_started_at" + INTERVAL '24 hours'
  WHERE "publish_started_at" IS NOT NULL;

UPDATE public."SilhouetteProfile"
  SET "my_form_publish_cleanup_until" = "my_form_publish_started_at" + INTERVAL '24 hours'
  WHERE "my_form_publish_started_at" IS NOT NULL;

UPDATE public."PaletteProfile"
  SET "selfie_publish_cleanup_until" = "selfie_publish_started_at" + INTERVAL '24 hours'
  WHERE "selfie_publish_started_at" IS NOT NULL;
