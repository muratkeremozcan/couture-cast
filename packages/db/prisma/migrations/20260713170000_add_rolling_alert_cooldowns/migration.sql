-- Story 1.3 follow-up: replace fixed UTC buckets with a concurrency-safe,
-- rolling 60-minute reservation per alert fingerprint.

CREATE TABLE public."AlertCooldownReservation" (
  "deduplication_key" TEXT NOT NULL,
  "next_eligible_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AlertCooldownReservation_pkey" PRIMARY KEY ("deduplication_key")
);

-- Preserve active cooldowns at deployment using the envelope trigger time,
-- which is more precise than the legacy fixed bucket stored on the outbox row.
INSERT INTO public."AlertCooldownReservation" (
  "deduplication_key",
  "next_eligible_at",
  "created_at",
  "updated_at"
)
SELECT
  outbox."deduplication_key",
  MAX(envelope."created_at" + INTERVAL '1 hour'),
  MIN(envelope."created_at"),
  CURRENT_TIMESTAMP
FROM public."AlertDeliveryOutbox" AS outbox
INNER JOIN public."EventEnvelope" AS envelope
  ON envelope."id" = outbox."event_id"
GROUP BY outbox."deduplication_key";

DROP INDEX public."AlertDeliveryOutbox_deduplication_key_cooldown_bucket_key";

ALTER TABLE public."AlertDeliveryOutbox"
  RENAME COLUMN "cooldown_bucket" TO "reservation_started_at";

UPDATE public."AlertDeliveryOutbox" AS outbox
SET "reservation_started_at" = envelope."created_at"
FROM public."EventEnvelope" AS envelope
WHERE envelope."id" = outbox."event_id";

-- This index name was edited on 2026-09-05, after this migration had already
-- been applied everywhere. Editing an applied migration is normally forbidden,
-- so here is why this one is safe, for whoever finds it next.
--
-- The name originally written here was
-- `AlertDeliveryOutbox_deduplication_key_reservation_started_at_idx`, which is
-- 64 bytes. PostgreSQL truncates identifiers at 63 and does not warn, so what
-- it actually created -- in every database that ever ran this migration --
-- was `..._reservation_started_at_id`, one byte shorter, with the `_idx`
-- suffix cut off. The name below is that truncated name, spelled out.
--
-- So the edit is a catalog no-op: applying either text produces the
-- byte-identical index, and every environment that applied the old text is
-- already in exactly the state the new text produces. That is a fact about
-- PostgreSQL rather than about any tool, and it is what makes this safe
-- independent of how a future Prisma version treats a changed checksum. (For
-- the record, 6.19.0 tolerates it: `migrate deploy` and `migrate status` both
-- exit 0 against a database holding the old checksum, verified against an
-- isolated database seeded with the pre-edit history.)
--
-- It was edited rather than left alone because the two truncations disagreed.
-- Prisma derives its own 63-byte form of the same logical name and keeps the
-- `_idx` suffix instead of dropping it, so `prisma migrate diff` reported a
-- phantom rename on every clean checkout. `schema.prisma` now pins the real
-- name with `map:`, and `packages/db/test/migration-hygiene.spec.ts`
-- (DB-HYGIENE-01) fails on any future identifier over 63 bytes so this cannot
-- recur silently.
CREATE INDEX "AlertDeliveryOutbox_deduplication_key_reservation_started_at_id"
  ON public."AlertDeliveryOutbox"("deduplication_key", "reservation_started_at");

REVOKE ALL ON TABLE public."AlertCooldownReservation" FROM PUBLIC, anon, authenticated;
ALTER TABLE public."AlertCooldownReservation" ENABLE ROW LEVEL SECURITY;
