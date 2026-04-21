-- Story 0.11 Task 6: when a teen loses the last active guardian consent link,
-- block their authenticated self-access until a guardian restores consent.

CREATE OR REPLACE FUNCTION private.user_requires_guardian_consent(target_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT (
        lower(COALESCE(profile."preferences" -> 'compliance' ->> 'accountStatus', '')) = 'pending_guardian_consent'
        AND lower(COALESCE(profile."preferences" -> 'compliance' ->> 'guardianConsentRequired', 'false')) = 'true'
      )
      FROM public."UserProfile" AS profile
      WHERE profile."user_id" = target_user_id
      LIMIT 1
    ),
    FALSE
  );
$$;

REVOKE ALL ON FUNCTION private.user_requires_guardian_consent(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.user_requires_guardian_consent(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION private.can_read_shared_user_row(target_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (
      target_user_id = private.current_app_user_id()
      AND NOT private.user_requires_guardian_consent(target_user_id)
    )
    OR private.is_admin_actor()
    OR private.has_active_guardian_consent(target_user_id, 'read_only'),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION private.can_write_shared_user_row(target_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (
      target_user_id = private.current_app_user_id()
      AND NOT private.user_requires_guardian_consent(target_user_id)
    )
    OR private.is_admin_actor()
    OR private.has_active_guardian_consent(target_user_id, 'full_access'),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION private.can_manage_self_row(target_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    (
      target_user_id = private.current_app_user_id()
      AND NOT private.user_requires_guardian_consent(target_user_id)
    )
    OR private.is_admin_actor(),
    FALSE
  );
$$;
