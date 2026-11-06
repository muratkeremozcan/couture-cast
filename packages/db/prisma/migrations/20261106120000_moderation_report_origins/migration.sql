-- Story 6.13 owner: the ids that let erasure and the conflict rule still find a target after it has gone.

-- A report's target is nulled when erasure deletes it, and then only a decision could tie its sibling reports
-- together. These keep the target with no foreign key, set by the database so no writer can miss them, and hold
-- only the ids `ModerationDecision.case_key` already keeps. A report orphaned before this has no origin.
ALTER TABLE "CommunityPostReport" ADD COLUMN "origin_post_id" TEXT;
UPDATE "CommunityPostReport" SET "origin_post_id" = "post_id" WHERE "post_id" IS NOT NULL;
CREATE INDEX "CommunityPostReport_origin_post_id_idx" ON "CommunityPostReport"("origin_post_id");
CREATE FUNCTION set_post_report_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.origin_post_id := NEW.post_id;
  RETURN NEW;
END $$;
CREATE TRIGGER post_report_origin BEFORE INSERT ON "CommunityPostReport"
  FOR EACH ROW EXECUTE FUNCTION set_post_report_origin();

ALTER TABLE "CommunityCommentReport" ADD COLUMN "origin_comment_id" TEXT;
UPDATE "CommunityCommentReport" SET "origin_comment_id" = "comment_id" WHERE "comment_id" IS NOT NULL;
CREATE INDEX "CommunityCommentReport_origin_comment_id_idx" ON "CommunityCommentReport"("origin_comment_id");
CREATE FUNCTION set_comment_report_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.origin_comment_id := NEW.comment_id;
  RETURN NEW;
END $$;
CREATE TRIGGER comment_report_origin BEFORE INSERT ON "CommunityCommentReport"
  FOR EACH ROW EXECUTE FUNCTION set_comment_report_origin();

-- A prior-action row loses post_id when erasure deletes the post, so nothing would pair an operator's words
-- on that row with their target. This keeps the target, set by the database so no writer can miss it.
ALTER TABLE "ModerationEvent" ADD COLUMN "origin_post_id" TEXT;
UPDATE "ModerationEvent" SET "origin_post_id" = "post_id" WHERE "post_id" IS NOT NULL;
CREATE INDEX "ModerationEvent_origin_post_id_idx" ON "ModerationEvent"("origin_post_id");
CREATE FUNCTION set_moderation_event_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.origin_post_id := NEW.post_id;
  RETURN NEW;
END $$;
CREATE TRIGGER moderation_event_origin BEFORE INSERT ON "ModerationEvent"
  FOR EACH ROW EXECUTE FUNCTION set_moderation_event_origin();
