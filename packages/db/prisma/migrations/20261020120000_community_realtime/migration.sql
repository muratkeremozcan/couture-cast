-- AlterTable
ALTER TABLE "LookbookPost" ADD COLUMN     "community_revision" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PushToken" ADD COLUMN     "binding_generation" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "installation_id" TEXT,
ADD COLUMN     "permission" TEXT NOT NULL DEFAULT 'unknown';

-- CreateTable
CREATE TABLE "CommunitySubject" (
    "member_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "private_revision" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunitySubject_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "CommunityArtifactSubject" (
    "artifact_kind" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,

    CONSTRAINT "CommunityArtifactSubject_pkey" PRIMARY KEY ("artifact_kind","artifact_id","member_id","role")
);

-- CreateTable
CREATE TABLE "CommunityStreamHead" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT,
    "epoch" UUID NOT NULL,
    "sequence" BIGINT NOT NULL DEFAULT 0,
    "retention_floor" BIGINT NOT NULL DEFAULT 0,
    "last_assist_at" TIMESTAMP(3),

    CONSTRAINT "CommunityStreamHead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityDomainOutbox" (
    "id" UUID NOT NULL,
    "stream_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "post_id" TEXT,
    "comment_id" TEXT,
    "parent_id" TEXT,
    "revision" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appended_at" TIMESTAMP(3),

    CONSTRAINT "CommunityDomainOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityStreamEvent" (
    "id" UUID NOT NULL,
    "source_outbox_id" UUID NOT NULL,
    "stream_id" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "revision" BIGINT NOT NULL,
    "post_id" TEXT,
    "comment_id" TEXT,
    "parent_id" TEXT,
    "appended_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityStreamEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityNotificationPreference" (
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityNotificationPreference_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "CommunityFlagEvaluation" (
    "member_id" TEXT NOT NULL,
    "flag_key" TEXT NOT NULL,
    "remote_value" BOOLEAN,
    "remote_evaluated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "next_claim_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refresh_owner" UUID,
    "refresh_until" TIMESTAMP(3),
    "subject_generation" INTEGER NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityFlagEvaluation_pkey" PRIMARY KEY ("member_id","flag_key")
);

-- CreateTable
CREATE TABLE "CommunityNotificationIntent" (
    "id" UUID NOT NULL,
    "source_kind" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "comment_id" TEXT,
    "actor_id" TEXT,
    "recipient_id" TEXT,
    "preference_generation" INTEGER NOT NULL,
    "deliverable" BOOLEAN NOT NULL,
    "qualification_recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "group_id" UUID,

    CONSTRAINT "CommunityNotificationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityNotificationGroup" (
    "id" UUID NOT NULL,
    "recipient_id" TEXT,
    "post_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "eligible_at" TIMESTAMP(3) NOT NULL,
    "next_attempt_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "snapshot_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityNotificationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityTokenDelivery" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "registration_id" TEXT NOT NULL,
    "binding_generation" INTEGER NOT NULL,
    "owner_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "next_attempt_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityTokenDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityDeliveryAttempt" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "lease_owner" UUID NOT NULL,
    "lease_until" TIMESTAMP(3) NOT NULL,
    "guard_until" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "ticket_id" TEXT,
    "reason" TEXT,

    CONSTRAINT "CommunityDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityDeliveryReceipt" (
    "attempt_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "next_attempt_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "lookup_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CommunityDeliveryReceipt_pkey" PRIMARY KEY ("attempt_id")
);

-- CreateIndex
CREATE INDEX "CommunityArtifactSubject_member_id_artifact_kind_idx" ON "CommunityArtifactSubject"("member_id", "artifact_kind");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityStreamHead_owner_id_key" ON "CommunityStreamHead"("owner_id");

-- CreateIndex
CREATE INDEX "CommunityStreamHead_owner_id_idx" ON "CommunityStreamHead"("owner_id");

-- CreateIndex
CREATE INDEX "CommunityDomainOutbox_appended_at_created_at_id_idx" ON "CommunityDomainOutbox"("appended_at", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityStreamEvent_source_outbox_id_key" ON "CommunityStreamEvent"("source_outbox_id");

-- CreateIndex
CREATE INDEX "CommunityStreamEvent_appended_at_idx" ON "CommunityStreamEvent"("appended_at");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityStreamEvent_stream_id_sequence_key" ON "CommunityStreamEvent"("stream_id", "sequence");

-- CreateIndex
CREATE INDEX "CommunityFlagEvaluation_last_used_at_idx" ON "CommunityFlagEvaluation"("last_used_at");

-- CreateIndex
CREATE INDEX "CommunityNotificationIntent_group_id_idx" ON "CommunityNotificationIntent"("group_id");

-- CreateIndex
CREATE INDEX "CommunityNotificationIntent_recipient_id_deliverable_qualif_idx" ON "CommunityNotificationIntent"("recipient_id", "deliverable", "qualification_recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityNotificationIntent_source_kind_post_id_actor_id_re_key" ON "CommunityNotificationIntent"("source_kind", "post_id", "actor_id", "recipient_id", "comment_id");

-- CreateIndex
CREATE INDEX "CommunityNotificationGroup_status_next_attempt_at_eligible__idx" ON "CommunityNotificationGroup"("status", "next_attempt_at", "eligible_at");

-- CreateIndex
CREATE INDEX "CommunityTokenDelivery_status_next_attempt_at_idx" ON "CommunityTokenDelivery"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityTokenDelivery_group_id_registration_id_binding_gen_key" ON "CommunityTokenDelivery"("group_id", "registration_id", "binding_generation");

-- CreateIndex
CREATE INDEX "CommunityDeliveryAttempt_status_lease_until_idx" ON "CommunityDeliveryAttempt"("status", "lease_until");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityDeliveryAttempt_delivery_id_ordinal_key" ON "CommunityDeliveryAttempt"("delivery_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_installation_id_key" ON "PushToken"("installation_id");

-- AddForeignKey
ALTER TABLE "CommunityStreamEvent" ADD CONSTRAINT "CommunityStreamEvent_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "CommunityStreamHead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityNotificationIntent" ADD CONSTRAINT "CommunityNotificationIntent_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "CommunityNotificationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityTokenDelivery" ADD CONSTRAINT "CommunityTokenDelivery_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "CommunityNotificationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityDeliveryAttempt" ADD CONSTRAINT "CommunityDeliveryAttempt_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "CommunityTokenDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityDeliveryReceipt" ADD CONSTRAINT "CommunityDeliveryReceipt_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "CommunityDeliveryAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Story 6.5: API-only durable streams. Counter allocation occurs under row locks.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['CommunitySubject','CommunityArtifactSubject',
    'CommunityStreamHead','CommunityDomainOutbox','CommunityStreamEvent',
    'CommunityNotificationPreference','CommunityFlagEvaluation','CommunityNotificationIntent',
    'CommunityNotificationGroup','CommunityTokenDelivery','CommunityDeliveryAttempt',
    'CommunityDeliveryReceipt'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
  END LOOP;
END $$;

ALTER TABLE "CommunitySubject" ADD CONSTRAINT community_subject_user_fk
  FOREIGN KEY (member_id) REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityNotificationPreference" ADD CONSTRAINT community_preference_user_fk
  FOREIGN KEY (user_id) REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityFlagEvaluation" ADD CONSTRAINT community_flag_subject_fk
  FOREIGN KEY (member_id) REFERENCES "CommunitySubject"(member_id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityArtifactSubject" ADD CONSTRAINT community_artifact_subject_fk
  FOREIGN KEY (member_id) REFERENCES "CommunitySubject"(member_id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityStreamHead" ADD CONSTRAINT community_stream_owner_fk
  FOREIGN KEY (owner_id) REFERENCES "CommunitySubject"(member_id) ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX community_reaction_notification_identity ON "CommunityNotificationIntent"
  (post_id, actor_id, recipient_id) WHERE source_kind = 'reaction';
CREATE UNIQUE INDEX community_comment_notification_identity ON "CommunityNotificationIntent"
  (comment_id, recipient_id) WHERE source_kind = 'comment';
ALTER TABLE "CommunityStreamHead" ADD CONSTRAINT community_stream_bounds CHECK
  (sequence >= retention_floor AND retention_floor >= 0);
ALTER TABLE "PushToken" ADD CONSTRAINT push_permission_valid CHECK
  (permission IN ('unknown','granted','denied','undetermined'));

INSERT INTO "CommunitySubject" (member_id) SELECT id FROM "User";
INSERT INTO "CommunityStreamHead" (id, epoch) VALUES ('public', gen_random_uuid());
INSERT INTO "CommunityStreamHead" (id,owner_id,epoch)
  SELECT gen_random_uuid()::text,member_id,gen_random_uuid() FROM "CommunitySubject";
CREATE FUNCTION community_create_subject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "CommunitySubject" (member_id) VALUES (NEW.id);
  INSERT INTO "CommunityStreamHead" (id,owner_id,epoch)
    VALUES (gen_random_uuid()::text,NEW.id,gen_random_uuid());
  RETURN NEW;
END $$;
CREATE TRIGGER community_subject_created AFTER INSERT ON "User"
  FOR EACH ROW EXECUTE FUNCTION community_create_subject();

-- These nullable member slots deliberately have no identity FK: accepted/unknown delivery
-- tombstones survive subject erasure, and community_forget_subject removes their identifying
-- linkage under privacy guards. A canonical User.id rename must still preserve identity
-- continuity, without adding any delete action or changing unrelated members' rows.
CREATE FUNCTION community_cascade_member_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "CommunityNotificationIntent" SET actor_id = NEW.id WHERE actor_id = OLD.id;
  UPDATE "CommunityNotificationIntent" SET recipient_id = NEW.id WHERE recipient_id = OLD.id;
  UPDATE "CommunityNotificationGroup" SET recipient_id = NEW.id WHERE recipient_id = OLD.id;
  UPDATE "CommunityTokenDelivery" SET owner_id = NEW.id WHERE owner_id = OLD.id;
  RETURN NEW;
END $$;
CREATE TRIGGER community_member_identity_updated AFTER UPDATE OF id ON "User"
  FOR EACH ROW WHEN (OLD.id IS DISTINCT FROM NEW.id)
  EXECUTE FUNCTION community_cascade_member_identity();
REVOKE ALL ON FUNCTION community_cascade_member_identity() FROM PUBLIC;

-- Guard namespaces use two integer keys; ordinary engagement uses one bigint.
-- Sorted *computed* keys keep hash collisions conservative and acquisition ordered.
CREATE FUNCTION community_privacy_guards(members text[], posts text[], exclusive boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE k integer;
BEGIN
  FOR k IN SELECT DISTINCT hashtext(m) FROM unnest(members) m WHERE m IS NOT NULL ORDER BY 1 LOOP
    IF exclusive THEN PERFORM pg_advisory_xact_lock(65001,k);
    ELSE PERFORM pg_advisory_xact_lock_shared(65001,k); END IF;
  END LOOP;
  FOR k IN SELECT DISTINCT hashtext(p) FROM unnest(posts) p WHERE p IS NOT NULL ORDER BY 1 LOOP
    IF exclusive THEN PERFORM pg_advisory_xact_lock(65002,k);
    ELSE PERFORM pg_advisory_xact_lock_shared(65002,k); END IF;
  END LOOP;
END $$;

CREATE FUNCTION community_link_subject(artifact text, artifact_id text, member text, subject_role text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO "CommunityArtifactSubject" (artifact_kind,artifact_id,member_id,role,generation)
    SELECT artifact,artifact_id,member_id,subject_role,generation FROM "CommunitySubject"
      WHERE member_id = member
    ON CONFLICT DO NOTHING;
$$;

CREATE FUNCTION community_record_invalidation(event_kind text, post text, comment text DEFAULT NULL,
  parent text DEFAULT NULL, private_owner text DEFAULT NULL, actor text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE rev bigint; stream text; oid uuid := gen_random_uuid(); author text; parent_author text;
BEGIN
  IF private_owner IS NOT NULL THEN
    UPDATE "CommunitySubject" SET private_revision = private_revision + 1
      WHERE member_id = private_owner RETURNING private_revision INTO rev;
    IF rev IS NULL OR private_owner LIKE 'canary-user-%' THEN RETURN; END IF;
    SELECT id INTO stream FROM "CommunityStreamHead" WHERE owner_id = private_owner;
  ELSE
    -- UPDATE acquires the affected post lock before allocating its revision.
    UPDATE "LookbookPost" SET community_revision = community_revision + 1
      WHERE id = post RETURNING community_revision,user_id INTO rev,author;
    IF rev IS NULL OR author LIKE 'canary-user-%' THEN RETURN; END IF;
    stream := 'public';
  END IF;
  INSERT INTO "CommunityDomainOutbox" (id,stream_id,kind,post_id,comment_id,parent_id,revision)
    VALUES (oid,stream,event_kind,post,comment,parent,rev);
  PERFORM community_link_subject('outbox',oid::text,private_owner,'owner');
  PERFORM community_link_subject('outbox',oid::text,author,'post_author');
  PERFORM community_link_subject('outbox',oid::text,actor,'actor');
  IF parent IS NOT NULL THEN
    SELECT user_id INTO parent_author FROM "CommunityComment" WHERE id = parent;
    PERFORM community_link_subject('outbox',oid::text,parent_author,'parent_author');
  END IF;
END $$;

CREATE FUNCTION community_post_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE post text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- An anonymous marker survives physical source removal.
    IF OLD.status = 'published' AND OLD.user_id NOT LIKE 'canary-user-%' THEN
      INSERT INTO "CommunityDomainOutbox" (id,stream_id,kind,revision)
        VALUES (gen_random_uuid(),'public','resync',0);
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'published' THEN PERFORM community_record_invalidation('post.published',NEW.id); END IF;
  ELSIF (NEW.status,NEW.published_at,NEW.erasure_requested_at,NEW.anonymized_at,NEW.user_id)
    IS DISTINCT FROM (OLD.status,OLD.published_at,OLD.erasure_requested_at,OLD.anonymized_at,OLD.user_id) THEN
    IF NEW.status = 'published' AND NEW.erasure_requested_at IS NULL AND NEW.anonymized_at IS NULL THEN
      PERFORM community_record_invalidation('post.published',NEW.id);
    ELSIF OLD.status = 'published' THEN
      PERFORM community_record_invalidation('post.removed',NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER community_post_events AFTER INSERT OR UPDATE OR DELETE ON "LookbookPost"
  FOR EACH ROW EXECUTE FUNCTION community_post_invalidation();

CREATE FUNCTION community_reaction_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.selection IS NOT NULL THEN
      PERFORM community_record_invalidation('reactions.changed',OLD.post_id,NULL,NULL,NULL,OLD.user_id);
    END IF;
    RETURN OLD;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.selection IS NOT NULL) OR
    (TG_OP = 'UPDATE' AND NEW.selection IS DISTINCT FROM OLD.selection) THEN
    PERFORM community_record_invalidation('reactions.changed',NEW.post_id,NULL,NULL,NULL,NEW.user_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER community_reaction_events AFTER INSERT OR UPDATE OR DELETE ON "CommunityReaction"
  FOR EACH ROW EXECUTE FUNCTION community_reaction_invalidation();

CREATE FUNCTION community_comment_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.publication_sequence IS NOT NULL THEN
      PERFORM community_record_invalidation('comment.removed',OLD.post_id,OLD.id,OLD.parent_id);
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'published' THEN
      PERFORM community_record_invalidation('comment.published',NEW.post_id,NEW.id,NEW.parent_id,NULL,NEW.user_id);
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
      PERFORM community_record_invalidation('comment.removed',NEW.post_id,NEW.id,NEW.parent_id,NULL,OLD.user_id);
    END IF;
    IF NEW.user_id IS NOT NULL THEN
      PERFORM community_record_invalidation('comment.status',NEW.post_id,NEW.id,NEW.parent_id,NEW.user_id,NEW.user_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER community_comment_events AFTER INSERT OR UPDATE OR DELETE ON "CommunityComment"
  FOR EACH ROW EXECUTE FUNCTION community_comment_invalidation();

REVOKE ALL ON FUNCTION community_privacy_guards(text[],text[],boolean),
  community_link_subject(text,text,text,text),
  community_record_invalidation(text,text,text,text,text,text) FROM PUBLIC;

ALTER TABLE "NotificationPreference" ADD COLUMN policy_revision integer NOT NULL DEFAULT 0;
CREATE FUNCTION community_policy_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.policy_revision := OLD.policy_revision + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER community_policy_changed BEFORE UPDATE ON "NotificationPreference"
  FOR EACH ROW EXECUTE FUNCTION community_policy_revision();
-- Dispatch remains disabled until the deployment capability fence is deliberately advanced.
CREATE TABLE "CommunityRuntimeCapability" (id integer PRIMARY KEY CHECK (id = 1), privacy_version integer NOT NULL DEFAULT 0);
INSERT INTO "CommunityRuntimeCapability" (id) VALUES (1);
ALTER TABLE "CommunityRuntimeCapability" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CommunityRuntimeCapability" FROM anon, authenticated;

CREATE FUNCTION community_has_exclusive_guard(namespace integer, subject text) RETURNS boolean
LANGUAGE sql VOLATILE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'
    AND classid = namespace::oid AND objid::bigint = (hashtext(subject)::bigint & 4294967295)
    AND objsubid = 2 AND mode = 'ExclusiveLock' AND granted);
$$;
CREATE FUNCTION community_require_guard(namespace integer, subject text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF subject IS NOT NULL AND (SELECT privacy_version FROM "CommunityRuntimeCapability" WHERE id = 1) >= 1
    AND NOT community_has_exclusive_guard(namespace,subject) THEN
    RAISE EXCEPTION 'community privacy entry point required' USING ERRCODE = '23514';
  END IF;
END $$;

CREATE FUNCTION community_member_posts(member text) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::text[]) FROM "LookbookPost"
    WHERE user_id = member OR id IN (SELECT post_id FROM "CommunityReaction" WHERE user_id = member)
      OR id IN (SELECT post_id FROM "CommunityComment" WHERE user_id = member);
$$;
CREATE FUNCTION community_prepare_subject_privacy(member text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE posts text[];
BEGIN
  PERFORM community_privacy_guards(ARRAY[member],ARRAY[]::text[],true);
  posts := community_member_posts(member);
  PERFORM community_privacy_guards(ARRAY[]::text[],posts,true);
  PERFORM pg_advisory_xact_lock(hashtext('community_member:' || member));
  IF posts IS DISTINCT FROM community_member_posts(member) THEN
    RAISE EXCEPTION 'community privacy set changed' USING ERRCODE = '40001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('community_report:' || member));
  PERFORM pg_advisory_xact_lock(hashtext('community_submission:' || member));
  PERFORM id FROM "LookbookPost" WHERE id = ANY(posts) ORDER BY id FOR UPDATE;
END $$;

CREATE FUNCTION community_forget_subject(member text, erase boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a record;
BEGIN
  PERFORM community_require_guard(65001,member);
  UPDATE "CommunitySubject" SET generation = generation + 1 WHERE member_id = member;
  DELETE FROM "CommunityFlagEvaluation" WHERE member_id = member;
  DELETE FROM "CommunityStreamEvent" WHERE stream_id IN (SELECT id FROM "CommunityStreamHead" WHERE owner_id = member);
  DELETE FROM "CommunityDomainOutbox" WHERE stream_id IN (SELECT id FROM "CommunityStreamHead" WHERE owner_id = member);
  UPDATE "CommunityNotificationPreference" SET enabled = false, generation = generation + 1,
    revision = revision + 1, updated_at = clock_timestamp() WHERE user_id = member;
  -- Remove identity from public work before source cleanup; the anonymous resync survives.
  FOR a IN SELECT DISTINCT artifact_kind,artifact_id FROM "CommunityArtifactSubject" WHERE member_id = member LOOP
    IF a.artifact_kind = 'outbox' THEN
      UPDATE "CommunityDomainOutbox" SET kind = 'resync',post_id = NULL,comment_id = NULL,parent_id = NULL WHERE id::text = a.artifact_id AND stream_id = 'public';
    ELSIF a.artifact_kind = 'event' THEN
      UPDATE "CommunityStreamEvent" SET kind = 'resync',post_id = NULL,comment_id = NULL,parent_id = NULL WHERE id::text = a.artifact_id AND stream_id = 'public';
    ELSIF a.artifact_kind = 'attempt' THEN
      UPDATE "CommunityDeliveryAttempt" SET status = CASE WHEN status = 'sending' THEN 'unknown' ELSE status END,
        ticket_id = NULL,reason = 'subject_removed' WHERE id::text = a.artifact_id;
      DELETE FROM "CommunityDeliveryReceipt" WHERE attempt_id::text = a.artifact_id;
    ELSIF a.artifact_kind = 'receipt' THEN
      DELETE FROM "CommunityDeliveryReceipt" WHERE attempt_id::text = a.artifact_id;
    ELSIF a.artifact_kind = 'delivery' THEN
      UPDATE "CommunityTokenDelivery" SET status = CASE WHEN status = 'sending' THEN 'unknown' ELSE status END,
        owner_id = CASE WHEN owner_id = member THEN NULL ELSE owner_id END WHERE id::text = a.artifact_id;
    ELSIF a.artifact_kind = 'intent' THEN
      UPDATE "CommunityNotificationIntent" SET deliverable = false,actor_id = CASE WHEN erase AND actor_id = member THEN NULL ELSE actor_id END,
        recipient_id = CASE WHEN erase AND recipient_id = member THEN NULL ELSE recipient_id END WHERE id::text = a.artifact_id;
    END IF;
  END LOOP;
  UPDATE "CommunityNotificationGroup" SET status = CASE WHEN status IN ('pending','deferred') THEN 'suppressed' ELSE status END,
    recipient_id = NULL,post_id = NULL WHERE recipient_id = member;
  UPDATE "CommunityTokenDelivery" SET status = CASE WHEN status IN ('pending','deferred','retryable_rejection') THEN 'suppressed' ELSE status END,
    owner_id = NULL WHERE owner_id = member;
  DELETE FROM "PushToken" WHERE user_id = member;
  -- Consent restoration must retain first-occurrence identities for the source lifetime.
  -- Account erasure removes that identifying linkage immediately.
  DELETE FROM "CommunityArtifactSubject" WHERE member_id = member AND (erase OR artifact_kind <> 'intent');
  UPDATE "CommunityArtifactSubject" SET generation = (SELECT generation FROM "CommunitySubject" WHERE member_id = member)
    WHERE member_id = member AND artifact_kind = 'intent' AND NOT erase;
  IF erase THEN
    DELETE FROM "CommunityNotificationPreference" WHERE user_id = member;
    -- No later async callback can recreate a deleted subject generation.
    DELETE FROM "CommunitySubject" WHERE member_id = member;
  END IF;
END $$;

CREATE FUNCTION community_privacy_assert_post() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (NEW.status IS DISTINCT FROM OLD.status AND OLD.status = 'published')
    OR (NEW.erasure_requested_at IS DISTINCT FROM OLD.erasure_requested_at)
    OR (NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at) THEN
    PERFORM community_require_guard(65002,OLD.id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER community_post_privacy_entry BEFORE UPDATE OR DELETE ON "LookbookPost"
  FOR EACH ROW EXECUTE FUNCTION community_privacy_assert_post();
CREATE FUNCTION community_privacy_assert_comment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.status = 'published' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM community_require_guard(65002,OLD.post_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER community_comment_privacy_entry BEFORE UPDATE OR DELETE ON "CommunityComment"
  FOR EACH ROW EXECUTE FUNCTION community_privacy_assert_comment();
CREATE FUNCTION community_privacy_assert_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM community_require_guard(65001,OLD.id);
  PERFORM community_forget_subject(OLD.id,true);
  RETURN OLD;
END $$;
CREATE TRIGGER community_user_privacy_entry BEFORE DELETE ON "User"
  FOR EACH ROW EXECUTE FUNCTION community_privacy_assert_user();
CREATE FUNCTION community_privacy_assert_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.status = 'granted' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)) THEN
    PERFORM community_require_guard(65001,OLD.teen_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER community_consent_privacy_entry BEFORE UPDATE OR DELETE ON "GuardianConsent"
  FOR EACH ROW EXECUTE FUNCTION community_privacy_assert_consent();
CREATE FUNCTION community_privacy_assert_token() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.user_id,OLD.token,OLD.permission,OLD.binding_generation,OLD.installation_id)
    IS DISTINCT FROM (NEW.user_id,NEW.token,NEW.permission,NEW.binding_generation,NEW.installation_id) THEN
    PERFORM community_require_guard(65001,OLD.user_id);
    IF TG_OP <> 'DELETE' THEN PERFORM community_require_guard(65001,NEW.user_id); END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER community_token_privacy_entry BEFORE UPDATE OR DELETE ON "PushToken"
  FOR EACH ROW EXECUTE FUNCTION community_privacy_assert_token();
CREATE FUNCTION community_privacy_assert_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM community_require_guard(65001,OLD.user_id); RETURN OLD; END IF;
  PERFORM community_require_guard(65001,NEW.user_id);
  RETURN NEW;
END $$;
CREATE TRIGGER community_account_policy_privacy_entry BEFORE INSERT OR UPDATE OR DELETE ON "NotificationPreference"
  FOR EACH ROW EXECUTE FUNCTION community_privacy_assert_policy();
CREATE TRIGGER community_optin_privacy_entry BEFORE INSERT OR UPDATE OR DELETE ON "CommunityNotificationPreference"
  FOR EACH ROW EXECUTE FUNCTION community_privacy_assert_policy();
REVOKE ALL ON FUNCTION community_has_exclusive_guard(integer,text),community_require_guard(integer,text),
  community_prepare_subject_privacy(text),community_forget_subject(text,boolean),community_member_posts(text) FROM PUBLIC;

-- Anonymous operational facts have no member/target/token identifiers or free-form payload.
CREATE TABLE "CommunityEngagementTelemetry" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text NOT NULL, outcome text NOT NULL,
  reason text, elapsed_ms integer NOT NULL DEFAULT 0, eligible_latency_ms integer NOT NULL DEFAULT 0,
  attempt_ordinal integer NOT NULL DEFAULT 0, backlog_count integer NOT NULL DEFAULT 0,
  oldest_age_ms integer NOT NULL DEFAULT 0, build_identity text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, delivered_at timestamp(3),
  next_attempt_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, attempts integer NOT NULL DEFAULT 0,
  lease_owner uuid, lease_until timestamp(3)
);
CREATE INDEX "CommunityEngagementTelemetry_delivered_at_next_attempt_at_idx"
  ON "CommunityEngagementTelemetry"(delivered_at,next_attempt_at);
CREATE INDEX "CommunityEngagementTelemetry_created_at_idx" ON "CommunityEngagementTelemetry"(created_at);
ALTER TABLE "CommunityEngagementTelemetry" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CommunityEngagementTelemetry" FROM anon, authenticated;

-- Policy changes are auditably distinct from worker/provider retries.
CREATE TABLE "CommunityEligibilityChange" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES "CommunityNotificationGroup"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  recorded_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  policy_revision integer NOT NULL,
  previous_eligible_at timestamp(3) NOT NULL,
  eligible_at timestamp(3) NOT NULL,
  reason text NOT NULL
);
CREATE INDEX "CommunityEligibilityChange_group_id_recorded_at_idx" ON "CommunityEligibilityChange"(group_id,recorded_at);
ALTER TABLE "CommunityEligibilityChange" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CommunityEligibilityChange" FROM anon, authenticated;
GRANT ALL ON "CommunityEligibilityChange" TO service_role;

ALTER TABLE "CommunityNotificationGroup" ADD COLUMN policy_revision integer NOT NULL DEFAULT 0;

-- Existing legacy policy rows preserve their chosen zone. Enabled-only community defaults
-- explicitly set false until a member configures a device-suggested or chosen zone.
ALTER TABLE "NotificationPreference" ADD COLUMN timezone_configured boolean NOT NULL DEFAULT true;
