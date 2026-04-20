-- Story 0.11 Task 4: enforce guardian-aware row-level security on private
-- user-scoped tables.
--
-- The current application schema still uses text/cuid identifiers for "User".id,
-- while Supabase Auth emits UUID subjects. Until the auth bridge starts minting a
-- dedicated app_user_id claim, policies resolve the current app user through JWT
-- claims first and then fall back to the signed email claim.

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.current_app_user_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'app_user_id', ''),
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'app_user_id', ''),
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'app_user_id', ''),
    (
      SELECT "id"
      FROM public."User"
      WHERE lower("email") = lower(NULLIF(auth.jwt() ->> 'email', ''))
      LIMIT 1
    ),
    NULLIF(auth.jwt() ->> 'sub', '')
  );
$$;

CREATE OR REPLACE FUNCTION private.current_app_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT lower(
    COALESCE(
      NULLIF(auth.jwt() ->> 'app_role', ''),
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'app_role', ''),
      NULLIF(auth.jwt() -> 'app_metadata' ->> 'role', ''),
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'app_role', ''),
      NULLIF(auth.jwt() -> 'user_metadata' ->> 'role', ''),
      NULLIF(auth.jwt() ->> 'role', '')
    )
  );
$$;

CREATE OR REPLACE FUNCTION private.is_admin_actor()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(private.current_app_role() IN ('admin', 'moderator'), FALSE);
$$;

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
  SELECT EXISTS (
    SELECT 1
    FROM public."GuardianConsent" AS consent
    WHERE consent."guardian_id" = private.current_app_user_id()
      AND consent."teen_id" = target_user_id
      AND consent."status" = 'granted'
      AND consent."revoked_at" IS NULL
      AND (
        minimum_level = 'read_only'
        OR consent."consent_level" = 'full_access'
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.can_read_shared_user_row(target_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT COALESCE(
    target_user_id = private.current_app_user_id()
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
    target_user_id = private.current_app_user_id()
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
    target_user_id = private.current_app_user_id()
    OR private.is_admin_actor(),
    FALSE
  );
$$;

REVOKE ALL ON FUNCTION private.current_app_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_app_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_admin_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.has_active_guardian_consent(TEXT, "ConsentLevel") FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_read_shared_user_row(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_write_shared_user_row(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_manage_self_row(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin_actor() TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_active_guardian_consent(TEXT, "ConsentLevel") TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_read_shared_user_row(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_write_shared_user_row(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_manage_self_row(TEXT) TO authenticated;

DO $$
DECLARE
  guardian_shared_tables TEXT[] := ARRAY[
    'UserProfile',
    'ComfortPreferences',
    'GarmentItem',
    'PaletteInsights',
    'OutfitRecommendation'
  ];
  self_only_tables TEXT[] := ARRAY[
    'LookbookPost',
    'EngagementEvent'
  ];
  table_name TEXT;
BEGIN
  -- Private teen data tables support guardian reads and optionally guardian
  -- mutations when consent has escalated to full access.
  FOREACH table_name IN ARRAY guardian_shared_tables LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
      table_name
    );
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      table_name
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS authenticated_read_shared_user_data ON public.%I',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY authenticated_read_shared_user_data ON public.%I FOR SELECT TO authenticated USING (private.can_read_shared_user_row("user_id"))',
      table_name
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS authenticated_insert_shared_user_data ON public.%I',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY authenticated_insert_shared_user_data ON public.%I FOR INSERT TO authenticated WITH CHECK (private.can_write_shared_user_row("user_id"))',
      table_name
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS authenticated_update_shared_user_data ON public.%I',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY authenticated_update_shared_user_data ON public.%I FOR UPDATE TO authenticated USING (private.can_write_shared_user_row("user_id")) WITH CHECK (private.can_write_shared_user_row("user_id"))',
      table_name
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS authenticated_delete_shared_user_data ON public.%I',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY authenticated_delete_shared_user_data ON public.%I FOR DELETE TO authenticated USING (private.can_write_shared_user_row("user_id"))',
      table_name
    );
  END LOOP;

  -- Community-facing records stay self/admin scoped until Story 6 formalizes
  -- public-feed sharing semantics.
  FOREACH table_name IN ARRAY self_only_tables LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
      table_name
    );
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      table_name
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS authenticated_read_own_user_data ON public.%I',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY authenticated_read_own_user_data ON public.%I FOR SELECT TO authenticated USING (private.can_manage_self_row("user_id"))',
      table_name
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS authenticated_insert_own_user_data ON public.%I',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY authenticated_insert_own_user_data ON public.%I FOR INSERT TO authenticated WITH CHECK (private.can_manage_self_row("user_id"))',
      table_name
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS authenticated_update_own_user_data ON public.%I',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY authenticated_update_own_user_data ON public.%I FOR UPDATE TO authenticated USING (private.can_manage_self_row("user_id")) WITH CHECK (private.can_manage_self_row("user_id"))',
      table_name
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS authenticated_delete_own_user_data ON public.%I',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY authenticated_delete_own_user_data ON public.%I FOR DELETE TO authenticated USING (private.can_manage_self_row("user_id"))',
      table_name
    );
  END LOOP;
END
$$;

GRANT SELECT ON TABLE public."GuardianConsent" TO authenticated;
ALTER TABLE public."GuardianConsent" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read_guardian_consent ON public."GuardianConsent";
CREATE POLICY authenticated_read_guardian_consent
ON public."GuardianConsent"
FOR SELECT
TO authenticated
USING (
  private.is_admin_actor()
  OR private.current_app_user_id() IN ("guardian_id", "teen_id")
);
