-- Story 6.6 cache contract: reads remain uncached in Story 6.3.
-- A future public aggregate cache must include post_id and reaction_generation;
-- viewer choice/revision must additionally be scoped to the authenticated member.
-- Consumers must recheck public visibility and the generation before serving cached
-- data. Visibility/erasure triggers and reaction cascades advance it atomically.
-- Generation is monotonic per surviving post. Deleted post IDs must never be reused.
-- Story 6.3. API-only reaction state with durable tombstone revisions.
ALTER TABLE "LookbookPost" ADD COLUMN reaction_generation INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "CommunityReaction" (
 user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
 post_id TEXT NOT NULL REFERENCES "LookbookPost"(id) ON DELETE CASCADE,
 selection TEXT CHECK(selection IN ('applause','love','inspiration')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,post_id)
);
CREATE INDEX "CommunityReaction_post_id_selection_idx" ON "CommunityReaction"(post_id,selection);
CREATE TABLE "CommunityReactionReceipt" (
 user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
 mutation_id UUID NOT NULL,
 post_id TEXT NOT NULL REFERENCES "LookbookPost"(id) ON DELETE CASCADE,
 selection TEXT CHECK(selection IN ('applause','love','inspiration')),
 base_revision INTEGER NOT NULL CHECK(base_revision >= 0),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,mutation_id)
);
CREATE INDEX "CommunityReactionReceipt_user_id_created_at_idx" ON "CommunityReactionReceipt"(user_id,created_at);
CREATE INDEX "CommunityReactionReceipt_post_id_idx" ON "CommunityReactionReceipt"(post_id);
CREATE INDEX "CommunityReactionReceipt_created_at_idx" ON "CommunityReactionReceipt"(created_at);
CREATE TABLE "CommunityReactionOutbox" (
 id UUID PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
 post_id TEXT NOT NULL REFERENCES "LookbookPost"(id) ON DELETE CASCADE,
 event_type TEXT NOT NULL,
 payload JSONB NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 delivered_at TIMESTAMP(3),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CommunityReactionOutbox_delivered_at_next_attempt_at_idx" ON "CommunityReactionOutbox"(delivered_at,next_attempt_at);
CREATE INDEX "CommunityReactionOutbox_post_id_idx" ON "CommunityReactionOutbox"(post_id);
ALTER TABLE "CommunityReaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommunityReactionReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommunityReactionOutbox" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CommunityReaction", "CommunityReactionReceipt", "CommunityReactionOutbox" FROM anon, authenticated;
GRANT ALL ON "CommunityReaction", "CommunityReactionReceipt", "CommunityReactionOutbox" TO service_role;

-- Every write and cascade advances the post generation inside its transaction.
CREATE FUNCTION community_reaction_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "LookbookPost" SET reaction_generation = reaction_generation + 1
 WHERE id = COALESCE(NEW.post_id, OLD.post_id);
 RETURN NULL;
END $$;
CREATE TRIGGER community_reaction_generation AFTER INSERT OR UPDATE OR DELETE ON "CommunityReaction"
 FOR EACH ROW EXECUTE FUNCTION community_reaction_generation();

-- Visibility and erasure are cross-feature paths, so invalidation lives at the DB boundary.
CREATE FUNCTION community_post_reaction_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status OR NEW.published_at IS DISTINCT FROM OLD.published_at
 OR NEW.erasure_requested_at IS DISTINCT FROM OLD.erasure_requested_at
 OR NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at THEN
  NEW.reaction_generation := OLD.reaction_generation + 1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER community_post_reaction_invalidation BEFORE UPDATE OF status,published_at,erasure_requested_at,anonymized_at ON "LookbookPost"
 FOR EACH ROW EXECUTE FUNCTION community_post_reaction_invalidation();

CREATE FUNCTION community_post_reaction_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.erasure_requested_at IS NOT NULL OR NEW.anonymized_at IS NOT NULL THEN
  DELETE FROM "CommunityReaction" WHERE post_id = OLD.id;
  DELETE FROM "CommunityReactionReceipt" WHERE post_id = OLD.id;
  DELETE FROM "CommunityReactionOutbox" WHERE post_id = OLD.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER community_post_reaction_erasure AFTER UPDATE OF erasure_requested_at,anonymized_at ON "LookbookPost"
 FOR EACH ROW EXECUTE FUNCTION community_post_reaction_erasure();
