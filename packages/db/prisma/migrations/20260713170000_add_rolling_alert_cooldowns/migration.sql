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

CREATE INDEX "AlertDeliveryOutbox_deduplication_key_reservation_started_at_idx"
  ON public."AlertDeliveryOutbox"("deduplication_key", "reservation_started_at");

REVOKE ALL ON TABLE public."AlertCooldownReservation" FROM PUBLIC, anon, authenticated;
ALTER TABLE public."AlertCooldownReservation" ENABLE ROW LEVEL SECURITY;
