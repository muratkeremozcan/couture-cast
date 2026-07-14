-- Story 1.3 follow-up: backfill safe rule-specific defaults before enforcing
-- the non-null threshold invariant in the database.

UPDATE public."AlertRule"
SET "threshold" = CASE "rule_type"
  WHEN 'temperature' THEN 5
  WHEN 'precipitation' THEN 0.5
  WHEN 'severe' THEN 2
  ELSE "threshold"
END
WHERE "threshold" IS NULL;

ALTER TABLE public."AlertRule"
  ALTER COLUMN "threshold" SET NOT NULL;
