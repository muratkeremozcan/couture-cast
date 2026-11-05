-- Story 6.12: the operations alert record and outbox, and the monitor's own stamp. Additive.

CREATE TYPE "ModerationSlaAlertKind" AS ENUM ('at_risk', 'breached', 'escalated');

CREATE TYPE "ModerationSlaAlertDelivery" AS ENUM (
  'pending',
  'delivered',
  'console_only',
  'superseded'
);

CREATE TABLE "ModerationSlaAlert" (
  "id" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "kind" "ModerationSlaAlertKind" NOT NULL,
  "case_key" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "anchor_report_id" TEXT NOT NULL,
  "risk" TEXT NOT NULL,
  "sla_due_at" TIMESTAMP(3) NOT NULL,
  "decision_id" TEXT,
  "detected_at" TIMESTAMP(3) NOT NULL,
  "delivery" "ModerationSlaAlertDelivery" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL,
  "lease_until" TIMESTAMP(3),
  "last_error_code" TEXT,
  "delivered_at" TIMESTAMP(3),
  "failure_escalated_at" TIMESTAMP(3),
  CONSTRAINT "ModerationSlaAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModerationSlaAlert_source_check" CHECK ("source" IN ('post', 'comment')),
  CONSTRAINT "ModerationSlaAlert_risk_check" CHECK ("risk" IN ('low', 'medium', 'high')),
  CONSTRAINT "ModerationSlaAlert_last_error_code_check" CHECK (
    "last_error_code" IS NULL OR "last_error_code" IN (
      'timeout', 'network', 'http_3xx', 'http_4xx', 'http_5xx', 'invalid_config', 'interrupted'
    )
  )
);

CREATE UNIQUE INDEX "ModerationSlaAlert_dedupe_key_key" ON "ModerationSlaAlert"("dedupe_key");
CREATE INDEX "ModerationSlaAlert_detected_at_id_idx"
  ON "ModerationSlaAlert"("detected_at" DESC, "id" DESC);
-- Partial, so Prisma cannot declare it. Only `pending` rows can still send, and they are few.
CREATE INDEX "ModerationSlaAlert_deliverable_idx"
  ON "ModerationSlaAlert"("next_attempt_at", "id")
  WHERE "delivery" = 'pending';

CREATE TABLE "ModerationSlaMonitor" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "last_sweep_at" TIMESTAMP(3) NOT NULL,
  "channel" TEXT NOT NULL,
  CONSTRAINT "ModerationSlaMonitor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModerationSlaMonitor_channel_check" CHECK ("channel" IN ('webhook', 'console'))
);

-- API-only: RLS on, zero policies, zero grants.
ALTER TABLE "ModerationSlaAlert" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ModerationSlaAlert" FROM anon, authenticated;
ALTER TABLE "ModerationSlaMonitor" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ModerationSlaMonitor" FROM anon, authenticated;
