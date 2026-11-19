-- Production follow-up 2026-11-19: SLA alerts can reach moderator devices by Expo push when no
-- operations webhook is configured. The monitor row records which channel the sweep resolved.
ALTER TABLE "ModerationSlaMonitor" DROP CONSTRAINT "ModerationSlaMonitor_channel_check";
ALTER TABLE "ModerationSlaMonitor"
  ADD CONSTRAINT "ModerationSlaMonitor_channel_check" CHECK ("channel" IN ('webhook', 'push', 'console'));

-- Expo receipts for accepted SLA alert pushes, read by the sweep until they report or expire.
CREATE TABLE "ModerationSlaPushReceipt" (
  "ticket_id" TEXT NOT NULL,
  "alert_id" TEXT NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL,
  "check_after" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "outcome" TEXT,
  "error" TEXT,
  "checked_at" TIMESTAMP(3),
  CONSTRAINT "ModerationSlaPushReceipt_pkey" PRIMARY KEY ("ticket_id"),
  CONSTRAINT "ModerationSlaPushReceipt_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('ok', 'failed', 'unknown')),
  -- Deleted with its alert, so the 400-day ModerationSlaAlert retention prunes receipts too.
  CONSTRAINT "ModerationSlaPushReceipt_alert_id_fkey" FOREIGN KEY ("alert_id")
    REFERENCES "ModerationSlaAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ModerationSlaPushReceipt_alert_id_idx" ON "ModerationSlaPushReceipt"("alert_id");
CREATE INDEX "ModerationSlaPushReceipt_outcome_check_after_idx"
  ON "ModerationSlaPushReceipt"("outcome", "check_after");

-- API-only: RLS on, zero policies, zero grants.
ALTER TABLE "ModerationSlaPushReceipt" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ModerationSlaPushReceipt" FROM anon, authenticated;
