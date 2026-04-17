-- Add guardian consent access levels used by future RLS policies.
CREATE TYPE "ConsentLevel" AS ENUM ('read_only', 'full_access');

-- Extend the existing guardian consent table instead of recreating it so
-- earlier signup/profile work keeps working while later consent flows add
-- richer policy handling.
ALTER TABLE "GuardianConsent"
ADD COLUMN "consent_level" "ConsentLevel" NOT NULL DEFAULT 'read_only',
ADD COLUMN "revoked_at" TIMESTAMP(3);

-- Preserve revoked state for any historical rows that were already marked
-- revoked before the dedicated timestamp existed.
UPDATE "GuardianConsent"
SET "revoked_at" = COALESCE("consent_granted_at", CURRENT_TIMESTAMP)
WHERE "status" = 'revoked'
  AND "revoked_at" IS NULL;

-- Keep the story-required lookup indexes present in case this migration is
-- applied against a database that predates the current init migration.
CREATE INDEX IF NOT EXISTS "GuardianConsent_guardian_id_idx"
ON "GuardianConsent"("guardian_id");

CREATE INDEX IF NOT EXISTS "GuardianConsent_teen_id_idx"
ON "GuardianConsent"("teen_id");
