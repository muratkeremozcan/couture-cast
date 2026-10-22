-- Story 6.6: the spotlight privacy model allows at most 30 page-one reads per
-- member per minute. One row per member holds the current fixed window, so the
-- table never grows past the member count and erasure cascades with the user.
CREATE TABLE "CommunitySpotlightReadWindow" (
  "user_id" TEXT NOT NULL,
  "window_start" TIMESTAMPTZ(6) NOT NULL,
  "reads" INTEGER NOT NULL,
  CONSTRAINT "CommunitySpotlightReadWindow_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "CommunitySpotlightReadWindow_reads_positive" CHECK ("reads" > 0)
);

ALTER TABLE "CommunitySpotlightReadWindow"
  ADD CONSTRAINT "CommunitySpotlightReadWindow_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunitySpotlightReadWindow" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CommunitySpotlightReadWindow" FROM anon, authenticated;
