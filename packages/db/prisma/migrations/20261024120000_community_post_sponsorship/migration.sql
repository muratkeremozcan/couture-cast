-- Story 6.7b: sponsored community highlights.
--
-- One row links one community post to one garment affiliate offer for an
-- effective window. Only the owner writes it, through the audited operator
-- command `npm run community:sponsorship`; no HTTP route and no client role
-- reaches the table.
--
--   * `starts_at` is inclusive and `ends_at` exclusive, NULL meaning
--     open-ended. Both are `timestamp(3)` like the offer window, and every read
--     compares them with `now() AT TIME ZONE 'UTC'`.
--   * Ending stamps `ended_at`, `ended_by_id` and `end_reason` together and
--     never deletes the row. Erasing the post deletes its links (the FK cascade
--     for a hard delete, the erasure sweep for an anonymized post); the
--     `AuditLog` rows written beside every change stay.
--   * Reasons are closed codes, never free text, so no column can hold an
--     author name or a contact detail. The CHECK lists below must match
--     `COMMUNITY_SPONSORSHIP_LINK_REASONS` and `COMMUNITY_SPONSORSHIP_END_REASONS`
--     in apps/api/src/modules/commerce/community-sponsorship.constants.ts.
CREATE TABLE "CommunityPostSponsorship" (
  "id" TEXT NOT NULL,
  "post_id" TEXT NOT NULL,
  "offer_id" TEXT NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3),
  "created_by_id" TEXT NOT NULL,
  "create_reason" TEXT NOT NULL,
  "ended_at" TIMESTAMP(3),
  "ended_by_id" TEXT,
  "end_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityPostSponsorship_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityPostSponsorship_window_check"
    CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT "CommunityPostSponsorship_create_reason_check"
    CHECK ("create_reason" IN ('partner_campaign', 'owner_pick')),
  CONSTRAINT "CommunityPostSponsorship_end_reason_check"
    CHECK (
      "end_reason" IS NULL
      OR "end_reason" IN ('campaign_ended', 'author_withdrew', 'partner_inactive', 'correction')
    ),
  CONSTRAINT "CommunityPostSponsorship_end_state_check"
    CHECK (
      ("ended_at" IS NULL AND "ended_by_id" IS NULL AND "end_reason" IS NULL)
      OR ("ended_at" IS NOT NULL AND "ended_by_id" IS NOT NULL AND "end_reason" IS NOT NULL)
    )
);

CREATE INDEX "CommunityPostSponsorship_post_id_idx" ON "CommunityPostSponsorship"("post_id");
CREATE INDEX "CommunityPostSponsorship_offer_id_idx" ON "CommunityPostSponsorship"("offer_id");
CREATE INDEX "CommunityPostSponsorship_created_by_id_idx" ON "CommunityPostSponsorship"("created_by_id");
CREATE INDEX "CommunityPostSponsorship_ended_by_id_idx" ON "CommunityPostSponsorship"("ended_by_id");

-- At most one non-ended link per post. Partial, so Prisma does not declare it;
-- see the CommunityPostSponsorship model comment.
CREATE UNIQUE INDEX "CommunityPostSponsorship_open_post_key"
  ON "CommunityPostSponsorship" ("post_id")
  WHERE "ended_at" IS NULL;

ALTER TABLE "CommunityPostSponsorship"
  ADD CONSTRAINT "CommunityPostSponsorship_post_id_fkey"
  FOREIGN KEY ("post_id") REFERENCES "LookbookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityPostSponsorship"
  ADD CONSTRAINT "CommunityPostSponsorship_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "AffiliateOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommunityPostSponsorship"
  ADD CONSTRAINT "CommunityPostSponsorship_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommunityPostSponsorship"
  ADD CONSTRAINT "CommunityPostSponsorship_ended_by_id_fkey"
  FOREIGN KEY ("ended_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- API and operator only: RLS on with zero policies, and no client role grants.
ALTER TABLE "CommunityPostSponsorship" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CommunityPostSponsorship" FROM anon, authenticated;
