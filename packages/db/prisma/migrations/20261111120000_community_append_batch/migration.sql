-- Story 6.5 fix, 2026-11-11: community append runs server-side in one statement.
--
-- Production append had never succeeded. From the hosted worker each statement costs about
-- 31 ms, and preparing one outbox candidate in TypeScript took about 16 round trips, so every
-- batch ran past its own 500 ms transaction budget, even at a batch limit of 1, and retried
-- forever. This function does the same preparation and write in the database: a batch costs
-- the same four round trips (BEGIN, settings, this call, COMMIT) whatever its size, and the
-- 150 ms preparation window and 400 ms completion budget now measure server work only.
--
-- Semantics are the TypeScript appender's, statement for statement:
-- * candidates are the 100 oldest unappended outbox rows, by created_at then id;
-- * each candidate runs in a subtransaction (the savepoint it replaces): shared guard locks are
--   only tried, members then posts, each set in sorted hashtext order, the same order
--   community_privacy_guards takes them for erasure and the push send guard; a miss, a row
--   another appender holds, or subject links that changed roll the subtransaction back, which
--   releases its locks, and count the candidate busy;
-- * a private row whose subjects are erased or regenerated is deleted with its links (busy);
-- * a public row whose subjects are no longer valid, or whose post is gone, unpublished,
--   erased, anonymized, a canary's, or a removal, appends as an identifier-free resync;
-- * heads are locked NOWAIT in sorted order, so a busy head raises 55P03 (head contention);
-- * the batch is trimmed to what the remaining budget fits at the caller's measured write cost.
-- It never waits on a lock it can skip: every advisory and row lock it takes is tried.
-- A candidate's subject links in a fixed order, the identity the batch compares before and
-- after locking.
CREATE FUNCTION community_append_subjects(candidate_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_array(member_id, generation, role)
      ORDER BY member_id, role), '[]'::jsonb)
  FROM "CommunityArtifactSubject"
  WHERE artifact_kind = 'outbox' AND artifact_id = candidate_id::text
$$;

-- One candidate, in its own subtransaction. `seen` is the candidate's subject links as the batch
-- read them before taking any lock; links that differ after the row lock mean a concurrent
-- change won, so the candidate is skipped. Returns the row to append (rewritten to a resync
-- where the public source is gone), or NULL when the candidate is busy, changed or deleted.
CREATE FUNCTION community_append_prepare(candidate_id uuid, seen jsonb)
RETURNS "CommunityDomainOutbox"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  owned "CommunityDomainOutbox"%ROWTYPE;
  source "LookbookPost"%ROWTYPE;
  valid boolean;
  k integer;
BEGIN
  BEGIN
    -- Shared guards are only tried, members then posts, each in sorted hashtext order: the
    -- order community_privacy_guards uses for erasure and the push send guard.
    FOR k IN SELECT DISTINCT hashtext(s ->> 0) FROM jsonb_array_elements(seen) s ORDER BY 1 LOOP
      IF NOT pg_try_advisory_xact_lock_shared(65001, k) THEN
        RAISE EXCEPTION USING ERRCODE = 'CCAB1';
      END IF;
    END LOOP;
    FOR k IN SELECT DISTINCT hashtext(o.post_id) FROM "CommunityDomainOutbox" o
        WHERE o.id = candidate_id AND o.post_id IS NOT NULL ORDER BY 1 LOOP
      IF NOT pg_try_advisory_xact_lock_shared(65002, k) THEN
        RAISE EXCEPTION USING ERRCODE = 'CCAB1';
      END IF;
    END LOOP;
    SELECT * INTO owned FROM "CommunityDomainOutbox"
      WHERE id = candidate_id AND appended_at IS NULL FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR seen IS DISTINCT FROM community_append_subjects(candidate_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'CCAB1';
    END IF;
    SELECT NOT EXISTS (
        SELECT 1 FROM "CommunityArtifactSubject" a
        LEFT JOIN "CommunitySubject" s ON s.member_id = a.member_id
        WHERE a.artifact_kind = 'outbox' AND a.artifact_id = owned.id::text
          AND (s.member_id IS NULL OR s.generation <> a.generation))
      INTO valid;
    IF NOT valid AND owned.stream_id <> 'public' THEN
      DELETE FROM "CommunityDomainOutbox" WHERE id = owned.id;
      DELETE FROM "CommunityArtifactSubject"
        WHERE artifact_kind = 'outbox' AND artifact_id = owned.id::text;
      RETURN NULL;
    END IF;
    IF owned.post_id IS NOT NULL THEN
      SELECT * INTO source FROM "LookbookPost" WHERE id = owned.post_id;
    END IF;
    IF owned.stream_id = 'public' AND (NOT valid OR source.id IS NULL
        OR source.status <> 'published' OR source.erasure_requested_at IS NOT NULL
        OR source.anonymized_at IS NOT NULL OR source.user_id LIKE 'canary-user-%'
        OR owned.kind LIKE '%.removed') THEN
      owned.kind := 'resync';
      owned.post_id := NULL;
      owned.comment_id := NULL;
      owned.parent_id := NULL;
    END IF;
    RETURN owned;
  EXCEPTION WHEN SQLSTATE 'CCAB1' THEN
    -- The subtransaction rolled back: the guards it tried and the row it locked are released.
    RETURN NULL;
  END;
END $$;

CREATE FUNCTION community_append_batch(ready_limit integer, write_cost_ms double precision)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  started timestamptz := clock_timestamp();
  candidate "CommunityDomainOutbox"%ROWTYPE;
  owned "CommunityDomainOutbox"%ROWTYPE;
  ids uuid[] := ARRAY[]::uuid[];
  kinds text[] := ARRAY[]::text[];
  post_ids text[] := ARRAY[]::text[];
  comment_ids text[] := ARRAY[]::text[];
  parent_ids text[] := ARRAY[]::text[];
  streams text[] := ARRAY[]::text[];
  revisions bigint[] := ARRAY[]::bigint[];
  busy integer := 0;
  stop text := 'drained';
  prepared_ms double precision;
  remaining double precision;
  fit integer;
  selected integer;
  write_started timestamptz;
  stream text;
BEGIN
  FOR candidate IN
    SELECT * FROM "CommunityDomainOutbox" WHERE appended_at IS NULL
    ORDER BY created_at, id LIMIT 100
  LOOP
    -- Reserve the remaining budget for head allocation, events and commit.
    IF extract(epoch FROM clock_timestamp() - started) * 1000 >= 150 THEN
      stop := 'window';
      EXIT;
    END IF;
    IF cardinality(ids) >= ready_limit THEN
      stop := 'limit';
      EXIT;
    END IF;
    owned := community_append_prepare(candidate.id, community_append_subjects(candidate.id));
    IF owned.id IS NULL THEN
      busy := busy + 1;
      CONTINUE;
    END IF;
    ids := ids || owned.id;
    kinds := kinds || owned.kind;
    post_ids := post_ids || owned.post_id;
    comment_ids := comment_ids || owned.comment_id;
    parent_ids := parent_ids || owned.parent_id;
    streams := streams || owned.stream_id;
    revisions := revisions || owned.revision;
  END LOOP;
  prepared_ms := extract(epoch FROM clock_timestamp() - started) * 1000;

  IF busy > 0 THEN
    INSERT INTO "CommunityEngagementTelemetry"
      (event_type, outcome, reason, backlog_count, elapsed_ms, build_identity)
    VALUES ('community_append_contention', 'skipped', 'busy_or_changed_candidate', busy,
      ceil(extract(epoch FROM clock_timestamp() - started) * 1000)::integer,
      coalesce(current_setting('community.build_identity', true), 'unknown'));
  END IF;

  -- A busy head aborts this bounded batch with 55P03; its holder supplies progress.
  FOR stream IN SELECT DISTINCT unnest(streams) ORDER BY 1 LOOP
    PERFORM 1 FROM "CommunityStreamHead" WHERE id = stream FOR UPDATE NOWAIT;
  END LOOP;

  remaining := 400 - extract(epoch FROM clock_timestamp() - started) * 1000;
  IF cardinality(ids) > 0 AND remaining < 30 THEN
    RETURN jsonb_build_object('budgetExhausted', true, 'ready', cardinality(ids),
      'limit', ready_limit, 'preparedMs', prepared_ms, 'remainingMs', remaining);
  END IF;
  fit := greatest(1, floor(remaining / write_cost_ms)::integer);
  selected := least(fit, cardinality(ids));
  IF selected = 0 THEN
    RETURN jsonb_build_object('count', 0, 'stop', stop, 'ready', 0, 'limit', ready_limit,
      'preparedMs', prepared_ms, 'selected', 0, 'selectedReason', 'all',
      'remainingMs', remaining, 'writeCostMs', write_cost_ms, 'writeMs', 0);
  END IF;

  write_started := clock_timestamp();
  WITH input AS (
    SELECT u.id, u.stream_id, u.kind, u.revision, u.post_id, u.comment_id, u.parent_id, u.ordinal
    FROM unnest(ids[1:selected], streams[1:selected], kinds[1:selected], revisions[1:selected],
      post_ids[1:selected], comment_ids[1:selected], parent_ids[1:selected])
      WITH ORDINALITY AS u(id, stream_id, kind, revision, post_id, comment_id, parent_id, ordinal)
  ),
  counts AS (SELECT stream_id, count(*) AS total FROM input GROUP BY stream_id),
  heads AS (
    UPDATE "CommunityStreamHead" h SET sequence = h.sequence + c.total FROM counts c
    WHERE h.id = c.stream_id RETURNING h.id, h.sequence - c.total AS base
  ),
  numbered AS (
    SELECT i.*, row_number() OVER (PARTITION BY stream_id ORDER BY ordinal) AS "offset"
    FROM input i
  ),
  events AS (
    INSERT INTO "CommunityStreamEvent"
      (id, source_outbox_id, stream_id, sequence, revision, kind, post_id, comment_id, parent_id)
    SELECT gen_random_uuid(), i.id, i.stream_id, h.base + i."offset", i.revision, i.kind,
      i.post_id, i.comment_id, i.parent_id
    FROM numbered i JOIN heads h ON h.id = i.stream_id
    RETURNING id, source_outbox_id, kind
  ),
  links AS (
    INSERT INTO "CommunityArtifactSubject" (artifact_kind, artifact_id, member_id, role, generation)
    SELECT 'event', e.id::text, a.member_id, a.role, a.generation
    FROM events e JOIN "CommunityArtifactSubject" a
      ON a.artifact_kind = 'outbox' AND a.artifact_id = e.source_outbox_id::text
    WHERE e.kind <> 'resync'
  )
  UPDATE "CommunityDomainOutbox" o SET appended_at = clock_timestamp()
  FROM events e WHERE o.id = e.source_outbox_id;

  RETURN jsonb_build_object('count', selected, 'stop', stop, 'ready', cardinality(ids),
    'limit', ready_limit, 'preparedMs', prepared_ms, 'selected', selected,
    'selectedReason', CASE WHEN selected < cardinality(ids) THEN 'budget' ELSE 'all' END,
    'remainingMs', remaining, 'writeCostMs', write_cost_ms,
    'writeMs', extract(epoch FROM clock_timestamp() - write_started) * 1000);
END $$;

-- The community worker connects as the database owner, which keeps EXECUTE as the function's
-- owner; no client role may call it.
REVOKE ALL ON FUNCTION community_append_batch(integer, double precision),
  community_append_prepare(uuid, jsonb), community_append_subjects(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
