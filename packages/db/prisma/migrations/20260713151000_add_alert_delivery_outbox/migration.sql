-- Story 1.3: make persisted alert fanout recoverable independently of BullMQ state.

UPDATE public."AlertRule"
SET "threshold" = 2
WHERE "rule_type" = 'severe'
  AND "threshold" IS NULL;

ALTER TABLE public."AlertRule"
  DROP CONSTRAINT IF EXISTS "AlertRule_threshold_check";

ALTER TABLE public."AlertRule"
  ADD CONSTRAINT "AlertRule_threshold_check"
  CHECK (
    ("rule_type" = 'temperature' AND "threshold" > 0 AND "threshold" <= 100)
    OR ("rule_type" = 'precipitation' AND "threshold" >= 0 AND "threshold" <= 1)
    OR ("rule_type" = 'severe' AND "threshold" IN (1, 2, 3))
  );

CREATE TABLE public."AlertDeliveryOutbox" (
  "id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "deduplication_key" TEXT NOT NULL,
  "cooldown_bucket" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "dispatched_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AlertDeliveryOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AlertDeliveryOutbox_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES public."EventEnvelope"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AlertDeliveryOutbox_event_id_key"
  ON public."AlertDeliveryOutbox"("event_id");

CREATE UNIQUE INDEX "AlertDeliveryOutbox_deduplication_key_cooldown_bucket_key"
  ON public."AlertDeliveryOutbox"("deduplication_key", "cooldown_bucket");

CREATE INDEX "AlertDeliveryOutbox_dispatched_at_created_at_idx"
  ON public."AlertDeliveryOutbox"("dispatched_at", "created_at");

REVOKE ALL ON TABLE public."AlertDeliveryOutbox" FROM anon, authenticated;
ALTER TABLE public."AlertDeliveryOutbox" ENABLE ROW LEVEL SECURITY;
