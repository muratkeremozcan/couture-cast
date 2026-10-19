-- Story 6.4 owner: API-only isolation and cross-row privacy invariants.
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['CommunityComment','CommunityCommentReceipt',
    'CommunityCommentScreeningOutbox','CommunityCommentReport','CommunityCommentAudit',
    'CommunityCommentAnalyticsOutbox','CommunityCommentAnalyticsSubject'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', table_name);
  END LOOP;
END $$;

ALTER TABLE "CommunityComment" ADD CONSTRAINT comment_locale_supported CHECK
  (locale IN ('en-US','en-CA','es-419','fr-CA','de-DE','it-IT','pt-BR','pt-PT','tr-TR','fr-FR'));
CREATE FUNCTION valid_comment_body(body text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE cp integer; units integer := 0; visible boolean := false; ch text;
  trim_points integer[] := ARRAY[9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279];
BEGIN
  IF body <> normalize(body, NFC) OR body = '' THEN RETURN false; END IF;
  IF ascii(left(body,1)) = ANY(trim_points) OR ascii(right(body,1)) = ANY(trim_points) THEN RETURN false; END IF;
  FOREACH ch IN ARRAY regexp_split_to_array(body, '') LOOP
    cp := ascii(ch);
    IF cp < 32 OR cp BETWEEN 127 AND 159 OR cp IN (8232,8233) THEN RETURN false; END IF;
    units := units + CASE WHEN cp > 65535 THEN 2 ELSE 1 END;
    IF units > 280 THEN RETURN false; END IF;
    IF NOT (cp = ANY(trim_points) OR cp = 173 OR cp BETWEEN 1536 AND 1541
      OR cp IN (1564,1757,1807,2274,6158) OR cp BETWEEN 2192 AND 2193
      OR cp BETWEEN 8203 AND 8207 OR cp BETWEEN 8234 AND 8238
      OR cp BETWEEN 8288 AND 8292 OR cp BETWEEN 8294 AND 8303
      OR cp IN (847,10240,12644,65440) OR cp BETWEEN 4447 AND 4448
      OR cp BETWEEN 6068 AND 6069 OR cp BETWEEN 6155 AND 6159
      OR cp BETWEEN 65024 AND 65039 OR cp BETWEEN 65520 AND 65528
      OR cp BETWEEN 917504 AND 921599 OR cp = 8293
      OR cp IN (65279,69821,69837) OR cp BETWEEN 65529 AND 65531
      OR cp BETWEEN 78896 AND 78911 OR cp BETWEEN 113824 AND 113827
      OR cp BETWEEN 119155 AND 119162 OR cp = 917505 OR cp BETWEEN 917536 AND 917631)
    THEN visible := true; END IF;
  END LOOP;
  RETURN visible;
END $$;
ALTER TABLE "CommunityComment" ADD CONSTRAINT comment_body_valid CHECK (body IS NULL OR valid_comment_body(body));
ALTER TABLE "CommunityComment" ADD CONSTRAINT comment_publication_consistent CHECK
  ((publication_sequence IS NULL) = (published_at IS NULL) AND
   (publication_sequence IS NULL OR publication_sequence > 0) AND
   (status <> 'published' OR (body IS NOT NULL AND user_id IS NOT NULL AND publication_sequence IS NOT NULL)));
ALTER TABLE "CommunityComment" ADD CONSTRAINT comment_hidden_body_cleared CHECK
  (status NOT IN ('author_deleted','consent_suspended','erased') OR body IS NULL);
ALTER TABLE "CommunityCommentReport" ADD CONSTRAINT comment_report_routing_deadline CHECK
  (routed_at >= accepted_at AND routed_at <= accepted_at + interval '5 minutes'
   AND sla_due_at = accepted_at + interval '24 hours');

CREATE FUNCTION enforce_comment_thread() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root_post text; root_parent text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.post_id IS DISTINCT FROM OLD.post_id OR
    NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
    RAISE EXCEPTION 'comment thread is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT post_id,parent_id INTO root_post,root_parent FROM "CommunityComment"
      WHERE id = NEW.parent_id FOR KEY SHARE;
    IF root_post IS DISTINCT FROM NEW.post_id OR root_parent IS NOT NULL THEN
      RAISE EXCEPTION 'comment parent must be a same-post root' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- SET NULL from direct account deletion must scrub content in the same statement.
  IF TG_OP = 'UPDATE' AND NEW.user_id IS NULL AND OLD.user_id IS NOT NULL THEN
    NEW.body := NULL; NEW.status := 'erased'; NEW.screening_reason := NULL;
    DELETE FROM "CommunityCommentScreeningOutbox" WHERE comment_id = NEW.id;
    UPDATE "CommunityCommentReport" SET content_snapshot = NULL WHERE comment_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER comment_thread_invariant BEFORE INSERT OR UPDATE ON "CommunityComment"
  FOR EACH ROW EXECUTE FUNCTION enforce_comment_thread();

CREATE FUNCTION scrub_comment_reports_on_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "CommunityCommentReport" SET content_snapshot = NULL
    WHERE reporter_id = OLD.id OR comment_id IN
      (SELECT id FROM "CommunityComment" WHERE user_id = OLD.id);
  RETURN OLD;
END $$;
CREATE TRIGGER user_comment_privacy BEFORE DELETE ON "User" FOR EACH ROW
  EXECUTE FUNCTION scrub_comment_reports_on_user_delete();

CREATE FUNCTION enforce_comment_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'comment audit is append-only' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER comment_audit_append_only BEFORE UPDATE OR DELETE ON "CommunityCommentAudit"
  FOR EACH ROW EXECUTE FUNCTION enforce_comment_audit_append_only();
