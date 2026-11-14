-- Story 6.15: the drift sweep records here when it met a ledger entitlement this API cannot
-- represent and left the row as it was. synced_at keeps meaning a confirmed ledger sync, so the
-- status and refresh responses never report a settled row as freshly synced.
-- Additive and nullable: no backfill, no grant, no policy. The table's worker-only posture
-- covers the new column.

ALTER TABLE "PremiumEntitlement" ADD COLUMN "drift_settled_at" TIMESTAMP(3);
