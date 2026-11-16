-- Story 6.17 follow-up, owner ruling 2026-11-16: guardian consent is off
-- (GUARDIAN_CONSENT_POLICY, packages/utils/src/age.ts). Every teen still waiting on a guardian,
-- revoked consent included, becomes active. Only the profile's compliance status changes:
-- GuardianConsent rows and invitations stay as they are for audit, and the time of this change
-- is recorded as guardianConsentWaivedAt. Re-running changes nothing, since no row is pending
-- afterwards.

UPDATE "UserProfile"
SET "preferences" = jsonb_set(
  jsonb_set(
    jsonb_set("preferences", '{compliance,accountStatus}', '"active"'),
    '{compliance,guardianConsentRequired}',
    'false'
  ),
  '{compliance,guardianConsentWaivedAt}',
  to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
)
WHERE jsonb_typeof("preferences" -> 'compliance') = 'object'
  AND "preferences" -> 'compliance' ->> 'accountStatus' = 'pending_guardian_consent';
