-- Story 6.11: moderation decisions, community sanctions and screening intake.

CREATE TYPE "CommunityReportOrigin" AS ENUM ('member', 'screening');

CREATE TYPE "ModerationDecisionAction" AS ENUM (
  'resolve',
  'release',
  'takedown',
  'escalate',
  'ban',
  'appeal_requested',
  'appeal_upheld',
  'appeal_overturned'
);

CREATE TYPE "CommunitySanctionKind" AS ENUM ('temporary', 'permanent');

CREATE TYPE "CommunitySanctionAppealStatus" AS ENUM (
  'not_requested',
  'requested',
  'upheld',
  'overturned'
);

ALTER TABLE "CommunityPostReport"
  ADD COLUMN "origin" "CommunityReportOrigin" NOT NULL DEFAULT 'member';

ALTER TABLE "CommunityCommentReport"
  ADD COLUMN "origin" "CommunityReportOrigin" NOT NULL DEFAULT 'member';

CREATE TABLE "ModerationDecision" (
  "id" TEXT NOT NULL,
  "case_key" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "post_id" TEXT,
  "comment_id" TEXT,
  "report_ids" TEXT[],
  "action" "ModerationDecisionAction" NOT NULL,
  "reason" TEXT NOT NULL,
  "moderator_id" TEXT,
  "moderator_role" TEXT NOT NULL,
  "subject_user_id" TEXT,
  "subject_alias" TEXT,
  "mutation_id" UUID NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "is_terminal" BOOLEAN NOT NULL,
  "decided_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ModerationDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModerationDecision_case_key_sequence_key"
  ON "ModerationDecision"("case_key", "sequence");
CREATE UNIQUE INDEX "ModerationDecision_moderator_id_mutation_id_key"
  ON "ModerationDecision"("moderator_id", "mutation_id");
CREATE INDEX "ModerationDecision_post_id_idx" ON "ModerationDecision"("post_id");
CREATE INDEX "ModerationDecision_comment_id_idx" ON "ModerationDecision"("comment_id");
CREATE INDEX "ModerationDecision_subject_user_id_idx" ON "ModerationDecision"("subject_user_id");
CREATE INDEX "ModerationDecision_report_ids_idx" ON "ModerationDecision" USING GIN ("report_ids");

ALTER TABLE "ModerationDecision"
  ADD CONSTRAINT "ModerationDecision_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "LookbookPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationDecision"
  ADD CONSTRAINT "ModerationDecision_comment_id_fkey"
  FOREIGN KEY ("comment_id") REFERENCES "CommunityComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationDecision"
  ADD CONSTRAINT "ModerationDecision_moderator_id_fkey"
  FOREIGN KEY ("moderator_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationDecision"
  ADD CONSTRAINT "ModerationDecision_subject_user_id_fkey"
  FOREIGN KEY ("subject_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CommunitySanction" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "decision_id" TEXT NOT NULL,
  "case_key" TEXT NOT NULL,
  "kind" "CommunitySanctionKind" NOT NULL,
  "expires_at" TIMESTAMP(3),
  "lifted_at" TIMESTAMP(3),
  "appeal_status" "CommunitySanctionAppealStatus" NOT NULL DEFAULT 'not_requested',
  "created_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CommunitySanction_pkey" PRIMARY KEY ("id"),
  -- A temporary ban always ends, and a permanent one ends only when lifted.
  CONSTRAINT "CommunitySanction_kind_matches_expiry" CHECK (
    ("kind" = 'permanent' AND "expires_at" IS NULL)
    OR ("kind" = 'temporary' AND "expires_at" IS NOT NULL AND "expires_at" > "created_at")
  )
);

CREATE UNIQUE INDEX "CommunitySanction_decision_id_key" ON "CommunitySanction"("decision_id");
CREATE INDEX "CommunitySanction_user_id_lifted_at_expires_at_idx"
  ON "CommunitySanction"("user_id", "lifted_at", "expires_at");
-- An expired temporary row keeps a null `lifted_at`, so only the permanent kind can be unique here.
-- The API serializes the temporary case under the subject guard.
CREATE UNIQUE INDEX "CommunitySanction_one_unlifted_permanent_idx"
  ON "CommunitySanction"("user_id")
  WHERE "kind" = 'permanent' AND "lifted_at" IS NULL;

ALTER TABLE "CommunitySanction"
  ADD CONSTRAINT "CommunitySanction_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunitySanction"
  ADD CONSTRAINT "CommunitySanction_decision_id_fkey"
  FOREIGN KEY ("decision_id") REFERENCES "ModerationDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- API only: RLS on with zero policies, and no client role grants.
ALTER TABLE "ModerationDecision" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ModerationDecision" FROM anon, authenticated;
ALTER TABLE "CommunitySanction" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CommunitySanction" FROM anon, authenticated;

-- Comment intake already files a null-reporter report. Its first audit row says it was the screener,
-- and a member's report starts with `reported`, which keeps an erased member reporter as `member`.
UPDATE "CommunityCommentReport" r
SET "origin" = 'screening'
WHERE r."reporter_id" IS NULL
  AND EXISTS (
    SELECT 1 FROM "CommunityCommentAudit" a
    WHERE a."report_id" = r."id"
      AND a."action" IN ('held_for_review', 'blocked', 'screening_failed')
  );

-- A post the screener flagged had no queue entry. Give each one the report `flagPost` now writes.
-- `flagged` must be the newest status-changing event: a post flagged, released by script and then
-- taken down holds an operator's verdict, and it must not read as the screener's.
-- Canary posts stay out because they never reach the public or a human reviewer.
INSERT INTO "CommunityPostReport" (
  "id", "post_id", "reason", "content_snapshot", "subject_alias", "image_object_path",
  "sla_due_at", "created_at", "origin"
)
SELECT
  gen_random_uuid()::text,
  p."id",
  'inappropriate_content',
  e."content_snapshot",
  al."alias",
  e."image_object_path",
  e."created_at" + interval '24 hours',
  e."created_at",
  'screening'
FROM "LookbookPost" p
JOIN LATERAL (
  SELECT ev."action", ev."content_snapshot", ev."image_object_path", ev."created_at"
  FROM "ModerationEvent" ev
  WHERE ev."post_id" = p."id"
    AND ev."action" IN (
      'flagged', 'screening_passed', 'released_by_operator', 'taken_down_by_operator'
    )
  ORDER BY ev."created_at" DESC, ev."id" DESC
  LIMIT 1
) e ON e."action" = 'flagged'
LEFT JOIN "CommunityAlias" al ON al."user_id" = p."user_id"
WHERE p."status" = 'flagged'
  AND p."erasure_requested_at" IS NULL
  AND p."anonymized_at" IS NULL
  AND p."user_id" NOT LIKE 'canary-user-%'
  AND NOT EXISTS (SELECT 1 FROM "CommunityPostReport" r WHERE r."post_id" = p."id");
