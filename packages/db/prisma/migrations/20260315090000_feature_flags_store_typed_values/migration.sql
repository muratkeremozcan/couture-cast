-- Task 8 future-proofing: store typed fallback values instead of booleans only.
ALTER TABLE "feature_flags"
ADD COLUMN "value" JSONB;

UPDATE "feature_flags"
SET "value" = to_jsonb("enabled");

ALTER TABLE "feature_flags"
ALTER COLUMN "value" SET NOT NULL;

ALTER TABLE "feature_flags"
DROP COLUMN "enabled";
