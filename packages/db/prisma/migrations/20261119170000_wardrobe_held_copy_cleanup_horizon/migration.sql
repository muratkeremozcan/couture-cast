-- Production follow-up 2026-11-19 (final upload review, F-4 and F-5).
--
-- held_source_cleanup_until is the held copy's cleanup horizon: the hourly capture records it
-- with the held key obligation, under the garment row lock and before it dispatches the write
-- of held/<userId>/<garmentId>.<ext>, as the capture's start plus 24 hours (only ever moved
-- later). The capture write runs inside a 30-second transaction; when that transaction times
-- out or the worker stops while storage is still applying the write, the copy can land after a
-- release or purge removed the key. The deletion outbox repeats a held key's removal until this
-- horizon, whoever recorded it, so such a write is removed whenever it lands.
--
-- held_source_object_path now stays on the garment until the outbox settles the key's removal
-- (the outbox clears it then), so a hold reapplied before settlement no longer loses the only
-- record of the copy.
ALTER TABLE public."GarmentItem"
  ADD COLUMN "held_source_cleanup_until" TIMESTAMP(3);

-- An obligation recorded before this column existed may belong to a write still landing.
UPDATE public."GarmentItem"
  SET "held_source_cleanup_until" = now() + INTERVAL '24 hours'
  WHERE "held_source_object_path" IS NOT NULL;
