-- Story 6.6: Community City Spotlight.
--
-- Coarse area components are stamped on a post at submission from the author's
-- chosen saved location. They are already normalized (trimmed, NFKC,
-- lowercased) and hold only a hierarchical prefix: a region only under a
-- country, a city only under a region. Coordinates, location keys, labels and
-- time zones never reach the post. Existing posts are not backfilled, so an
-- unstamped post is never eligible for a spotlight.
ALTER TABLE "LookbookPost"
  ADD COLUMN "area_country" TEXT,
  ADD COLUMN "area_region" TEXT,
  ADD COLUMN "area_city" TEXT;

-- Same-named cities or regions under different parents never merge because a
-- level exists only with every parent component present.
ALTER TABLE "LookbookPost" ADD CONSTRAINT "LookbookPost_area_hierarchical"
  CHECK (
    ("area_city" IS NULL OR "area_region" IS NOT NULL)
    AND ("area_region" IS NULL OR "area_country" IS NOT NULL)
  );

-- Anonymization clears the components in the same update that clears
-- `location_key`, so an anonymized row can never keep an area.
ALTER TABLE "LookbookPost" ADD CONSTRAINT "LookbookPost_area_cleared_when_anonymized"
  CHECK ("anonymized_at" IS NULL OR "area_country" IS NULL);

-- Windowed eligible reads. Partial, so Prisma does not declare it; see the
-- LookbookPost model comment. The predicate mirrors PUBLICLY_VISIBLE_POST_WHERE
-- minus the canary prefix, which the query applies as a residual filter.
CREATE INDEX "LookbookPost_spotlight_area_window_idx"
  ON "LookbookPost" ("area_country", "area_region", "area_city", "published_at" DESC)
  WHERE "status" = 'published'
    AND "published_at" IS NOT NULL
    AND "erasure_requested_at" IS NULL
    AND "anonymized_at" IS NULL
    AND "area_country" IS NOT NULL;

-- The spotlight invalidator's durable cursor over the public community stream.
-- API-only: RLS on with zero policies, and no client role grants.
CREATE TABLE "CommunitySpotlightCursor" (
  "id" TEXT NOT NULL,
  "epoch" UUID NOT NULL,
  "position" BIGINT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunitySpotlightCursor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunitySpotlightCursor_position_nonnegative" CHECK ("position" >= 0)
);

ALTER TABLE "CommunitySpotlightCursor" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CommunitySpotlightCursor" FROM anon, authenticated;
