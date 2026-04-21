-- Preserve the original consent grant IP address while capturing revoke metadata
-- separately for guardian consent lifecycle audits and diagnostics.
ALTER TABLE "GuardianConsent"
ADD COLUMN "revoked_ip_address" TEXT;
