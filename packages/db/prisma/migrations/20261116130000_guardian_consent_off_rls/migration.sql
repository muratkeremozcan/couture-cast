-- Guardian consent is off (owner ruling 2026-11-16). A granted GuardianConsent row stays for
-- audit and grants nothing, in the database as in the API: no row-level read or write of the
-- teen's shared rows and no wardrobe image read through Storage. Nobody can revoke a row while
-- consent is off (the revoke route answers 409), and teen-path finding B-1 let a teen grant
-- one to any adult address, so the rows that exist cannot be trusted.
--
-- Turning consent back on restores the body from
-- 20260420113000_add_guardian_shared_rls_policies in the same PR that lifts the boot refusal
-- (re-enable checklist, _bmad-output/test-artifacts/test-design/cc617-google-sign-in-test-design.md).
CREATE OR REPLACE FUNCTION private.has_active_guardian_consent(
  target_user_id TEXT,
  minimum_level "ConsentLevel" DEFAULT 'read_only'
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT FALSE;
$$;
