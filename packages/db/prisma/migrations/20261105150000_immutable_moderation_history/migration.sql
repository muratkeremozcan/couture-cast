-- Story 6.13: append-only moderation decisions, and the one exception account erasure uses.
--
-- This file runs as one implicit transaction. A role that cannot do all of it fails the deploy and
-- leaves nothing behind. It requires CREATEROLE and BYPASSRLS, the attributes of Supabase's `postgres`.
--
-- A LATER MIGRATION THAT CHANGES "ModerationDecision" FOLLOWS THE SAME SEQUENCE, because the role that
-- runs migrations no longer owns the table: grant SET on the owner role to itself, SET ROLE, change,
-- RESET ROLE, revoke. `packages/db/test/migration-hygiene.spec.ts` enforces the revoke, and refuses a role
-- keyword in either statement, which crashes Supabase's server.

ALTER TABLE "ModerationDecision" ADD COLUMN "anonymized_at" TIMESTAMP(3);

-- A comment report outlives its comment row, because erasing the parent post's author deletes that row.
-- This link is how the commenter's own later erasure still finds the words the report holds.
ALTER TABLE "CommunityCommentReport" ADD COLUMN "comment_author_id" TEXT;
UPDATE "CommunityCommentReport" r
SET "comment_author_id" = c."user_id"
FROM "CommunityComment" c
WHERE c."id" = r."comment_id" AND c."user_id" IS NOT NULL;
CREATE INDEX "CommunityCommentReport_comment_author_id_idx"
  ON "CommunityCommentReport"("comment_author_id");
ALTER TABLE "CommunityCommentReport"
  ADD CONSTRAINT "CommunityCommentReport_comment_author_id_fkey"
  FOREIGN KEY ("comment_author_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A direct account delete updates these rows from this trigger, and again when the comment's author is set
-- null. That second update rechecks the foreign key after the parent row has gone, unless the link is already
-- null here, and it also has to clear the words of an author whose comment row no longer exists.
CREATE OR REPLACE FUNCTION scrub_comment_reports_on_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "CommunityCommentReport"
    SET content_snapshot = NULL,
        comment_author_id = NULLIF(comment_author_id, OLD.id)
    WHERE reporter_id = OLD.id
      OR comment_author_id = OLD.id
      OR comment_id IN (SELECT id FROM "CommunityComment" WHERE user_id = OLD.id);
  RETURN OLD;
END $$;

-- `member_id` is the one identity this story keeps, until the `User` row goes: a replay and the null
-- subject rule read it. Both keys set null so neither account's removal is blocked by this record.
CREATE TABLE "ModerationErasureRequest" (
  "id" TEXT NOT NULL,
  "member_id" TEXT,
  "requested_by" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),

  CONSTRAINT "ModerationErasureRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModerationErasureRequest_member_id_key"
  ON "ModerationErasureRequest"("member_id");
CREATE INDEX "ModerationErasureRequest_requested_by_idx"
  ON "ModerationErasureRequest"("requested_by");
CREATE INDEX "ModerationErasureRequest_completed_at_requested_at_idx"
  ON "ModerationErasureRequest"("completed_at", "requested_at");

ALTER TABLE "ModerationErasureRequest"
  ADD CONSTRAINT "ModerationErasureRequest_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationErasureRequest"
  ADD CONSTRAINT "ModerationErasureRequest_requested_by_fkey"
  FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- API only: RLS on with zero policies, and no client role grants.
ALTER TABLE "ModerationErasureRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ModerationErasureRequest" FROM PUBLIC, anon, authenticated, service_role;

-- A comment decision copies the moderator's words here, and erasure has to remove them with the decision's.
-- This admits that one change and nothing else, so the audit row stays append-only in every other way.
CREATE OR REPLACE FUNCTION enforce_comment_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.reason = '[erased]'
    AND OLD.reason <> '[erased]'
    AND (to_jsonb(NEW) - 'reason') = (to_jsonb(OLD) - 'reason')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'comment audit is append-only' USING ERRCODE = '23514';
END $$;

-- A role is global to the cluster, so another database may already have created it, or be creating it now.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'moderation_history_owner') THEN
    BEGIN
      CREATE ROLE moderation_history_owner NOLOGIN BYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;
END $$;

-- Temporary, and revoked below. GRANT holds a lock on the role until this transaction ends, so migrations
-- of other databases in the cluster wait here and cannot revoke this grant underneath this one.
-- The role is named through format(): on Supabase, `GRANT ... TO CURRENT_USER` and `REVOKE ... FROM
-- CURRENT_USER` segfault the backend in supautils and restart the server (measured on 17.6.1.054).
DO $$
BEGIN
  EXECUTE format('GRANT moderation_history_owner TO %I WITH SET TRUE, INHERIT FALSE', current_user);
END $$;

-- The function reads tables with RLS on and no policy, and writes `AuditLog`, which forces RLS. Policies
-- for this role would give the application role expressions that run as the owner, so it bypasses RLS.
-- This repairs a role an earlier database left without the attribute.
ALTER ROLE moderation_history_owner BYPASSRLS;

GRANT USAGE, CREATE ON SCHEMA public TO moderation_history_owner;
GRANT USAGE, CREATE ON SCHEMA private TO moderation_history_owner;
GRANT SELECT ON "CommunityPostReport", "CommunityCommentReport", "ModerationErasureRequest", "CommunityAlias"
  TO moderation_history_owner;
GRANT INSERT ON "AuditLog" TO moderation_history_owner;

ALTER TABLE "ModerationDecision" OWNER TO moderation_history_owner;

SET ROLE moderation_history_owner;

-- Refuses every change except removal of identity by the owner role. Postgres runs as that role in two
-- cases only: a foreign key ON DELETE SET NULL action, and the definer function below. `current_user` is
-- the one signal here that the caller cannot set. Comparing with the allowed columns removed refuses any
-- column added later until a migration decides what it may do.
CREATE OR REPLACE FUNCTION private.moderation_history_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR current_user <> 'moderation_history_owner' THEN
    RAISE EXCEPTION 'ModerationDecision rows are immutable; % is not allowed', TG_OP
      USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['post_id', 'comment_id', 'moderator_id', 'subject_user_id', 'reason', 'anonymized_at'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['post_id', 'comment_id', 'moderator_id', 'subject_user_id', 'reason', 'anonymized_at'])
     OR (NEW.post_id IS NOT NULL AND NEW.post_id IS DISTINCT FROM OLD.post_id)
     OR (NEW.comment_id IS NOT NULL AND NEW.comment_id IS DISTINCT FROM OLD.comment_id)
     OR (NEW.moderator_id IS NOT NULL AND NEW.moderator_id IS DISTINCT FROM OLD.moderator_id)
     OR (NEW.subject_user_id IS NOT NULL AND NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id)
     OR (NEW.reason IS DISTINCT FROM OLD.reason AND (NEW.reason <> '[erased]' OR NEW.anonymized_at IS NULL))
     OR (OLD.anonymized_at IS NOT NULL AND NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at)
  THEN
    RAISE EXCEPTION 'ModerationDecision rows are immutable; only erasure may remove identity'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS moderation_decision_block_update ON public."ModerationDecision";
CREATE TRIGGER moderation_decision_block_update
BEFORE UPDATE ON public."ModerationDecision"
FOR EACH ROW
EXECUTE FUNCTION private.moderation_history_guard();

DROP TRIGGER IF EXISTS moderation_decision_block_delete ON public."ModerationDecision";
CREATE TRIGGER moderation_decision_block_delete
BEFORE DELETE ON public."ModerationDecision"
FOR EACH ROW
EXECUTE FUNCTION private.moderation_history_guard();

DROP TRIGGER IF EXISTS moderation_decision_block_truncate ON public."ModerationDecision";
CREATE TRIGGER moderation_decision_block_truncate
BEFORE TRUNCATE ON public."ModerationDecision"
FOR EACH STATEMENT
EXECUTE FUNCTION private.moderation_history_guard();

-- Same test as `community_has_exclusive_guard`, with no version switch and no routine the application
-- role owns, because that role could replace one and have it run as the owner.
CREATE OR REPLACE FUNCTION private.moderation_history_require_guard(member text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF member IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks
    WHERE pid = pg_catalog.pg_backend_pid()
      AND locktype = 'advisory'
      AND classid = 65001::oid
      AND objid::bigint = (pg_catalog.hashtext(member)::bigint & 4294967295)
      AND objsubid = 2
      AND mode = 'ExclusiveLock'
      AND granted
  ) THEN
    RAISE EXCEPTION 'community privacy entry point required' USING ERRCODE = '23514';
  END IF;
END;
$$;

-- The exception. It needs the member's privacy guard and an erasure request row, it can remove identity
-- and nothing else, and when an operator asked for it each use that changes rows leaves an immutable
-- trace. It reads the member's reports and alias, so it runs before the erasure clears them. Rerunning it
-- changes nothing and returns 0, because the sweep repeats it for each open request.
CREATE OR REPLACE FUNCTION private.moderation_history_anonymize(member text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  request_id text;
  requester text;
  member_alias text;
  reported text[];
  changed integer;
BEGIN
  PERFORM private.moderation_history_require_guard(member);

  SELECT r."id", r."requested_by" INTO request_id, requester
  FROM public."ModerationErasureRequest" r
  WHERE r."member_id" = member;
  IF request_id IS NULL THEN
    RAISE EXCEPTION 'no erasure request for this member' USING ERRCODE = '42501';
  END IF;

  SELECT a."alias" INTO member_alias FROM public."CommunityAlias" a WHERE a."user_id" = member;

  SELECT coalesce(array_agg(ids.id), ARRAY[]::text[]) INTO reported
  FROM (
    SELECT p."id" FROM public."CommunityPostReport" p WHERE p."reporter_id" = member
    UNION ALL
    SELECT c."id" FROM public."CommunityCommentReport" c WHERE c."reporter_id" = member
  ) AS ids;

  UPDATE public."ModerationDecision" d
  SET
    "subject_user_id" = CASE WHEN d."subject_user_id" = member THEN NULL ELSE d."subject_user_id" END,
    "moderator_id" = CASE WHEN d."moderator_id" = member THEN NULL ELSE d."moderator_id" END,
    "reason" = CASE
      WHEN d."subject_user_id" = member
        OR d."subject_alias" = member_alias
        OR d."report_ids" && reported
      THEN '[erased]'
      ELSE d."reason"
    END,
    "anonymized_at" = coalesce(d."anonymized_at", now() AT TIME ZONE 'UTC')
  WHERE d."subject_user_id" = member
    OR d."moderator_id" = member
    OR (d."reason" <> '[erased]' AND (d."subject_alias" = member_alias OR d."report_ids" && reported));
  GET DIAGNOSTICS changed = ROW_COUNT;

  IF changed > 0 AND requester IS NOT NULL THEN
    INSERT INTO public."AuditLog" ("id", "user_id", "event_type", "event_data", "timestamp")
    VALUES (
      gen_random_uuid()::text,
      requester,
      'moderation_history_anonymized',
      jsonb_build_object('erasureRequestId', request_id, 'decisions', changed),
      now() AT TIME ZONE 'UTC'
    );
  END IF;

  RETURN changed;
END;
$$;

REVOKE ALL ON FUNCTION private.moderation_history_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.moderation_history_require_guard(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.moderation_history_anonymize(text) FROM PUBLIC, anon, authenticated, service_role;

-- Removes whatever default privileges gave anyone, Supabase's `service_role` included, and then grants the
-- login running this migration, which is the application role in every environment, exactly two privileges.
DO $$
DECLARE
  grantee_role text;
BEGIN
  FOR grantee_role IN
    SELECT DISTINCT
      CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_catalog.pg_get_userbyid(acl.grantee)) END
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS acl
    WHERE c.oid = 'public."ModerationDecision"'::regclass
      AND acl.grantee <> c.relowner
  LOOP
    EXECUTE format('REVOKE ALL ON public."ModerationDecision" FROM %s', grantee_role);
  END LOOP;
  EXECUTE format('GRANT SELECT, INSERT ON public."ModerationDecision" TO %I', session_user);
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION private.moderation_history_anonymize(text) TO %I',
    session_user
  );
END $$;

RESET ROLE;

REVOKE CREATE ON SCHEMA public FROM moderation_history_owner;
REVOKE CREATE ON SCHEMA private FROM moderation_history_owner;
DO $$
BEGIN
  EXECUTE format('REVOKE moderation_history_owner FROM %I', current_user);
END $$;
