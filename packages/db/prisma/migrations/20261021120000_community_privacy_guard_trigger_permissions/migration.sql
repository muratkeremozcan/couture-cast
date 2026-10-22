-- Preserve the applied realtime migration checksum. Invoker RLS still governs
-- token and preference writes; these triggers inspect private guard metadata.
-- CREATE OR REPLACE preserves the existing trigger bindings and function ACLs.

CREATE OR REPLACE FUNCTION community_privacy_assert_token() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.user_id,OLD.token,OLD.permission,OLD.binding_generation,OLD.installation_id)
    IS DISTINCT FROM (NEW.user_id,NEW.token,NEW.permission,NEW.binding_generation,NEW.installation_id) THEN
    PERFORM community_require_guard(65001,OLD.user_id);
    IF TG_OP <> 'DELETE' THEN PERFORM community_require_guard(65001,NEW.user_id); END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION community_privacy_assert_policy() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM community_require_guard(65001,OLD.user_id); RETURN OLD; END IF;
  PERFORM community_require_guard(65001,NEW.user_id);
  RETURN NEW;
END $$;
