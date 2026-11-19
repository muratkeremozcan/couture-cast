-- Production follow-up 2026-11-19 (review round 4, Codex findings 2, 5 and 6).
--
-- 1. GarmentItem.upload_ended_at ends a rejected garment session explicitly while the row keeps
--    its upload_session_id, so the deletion outbox and the staging sweep still find the garment
--    a staging key belongs to and keep it while the garment is under legal hold. A commit claim
--    requires it to be null.
--
-- 2. GarmentItem.held_source_sha256 and held_source_captured_at record the server's immutable
--    copy of a held pending garment's staged source, held/<userId>/<garmentId>.<ext>, written once
--    by the hourly maintenance job with bytes whose sha256 matched the declaration.
--
-- 3. WardrobeObjectDeletion.repeat_until makes a removal repeat. Erasure, deletion, purge and
--    replacement that meet a publication still in flight remove the keys at once and keep the
--    row: the removal repeats every 15 minutes (not_before is the next attempt) until 24 hours
--    after the publication's lease started, so a remote write that completes late is removed
--    whenever it lands. The row settles only after that horizon.
ALTER TABLE public."GarmentItem"
  ADD COLUMN "upload_ended_at" TIMESTAMP(3),
  ADD COLUMN "held_source_sha256" TEXT,
  ADD COLUMN "held_source_captured_at" TIMESTAMP(3);

ALTER TABLE public."WardrobeObjectDeletion"
  ADD COLUMN "repeat_until" TIMESTAMP(3);

