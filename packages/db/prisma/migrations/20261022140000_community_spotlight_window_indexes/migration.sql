-- Story 6.6: every spotlight read is driven by an index at each level.
--
-- The cohort count always reads at country scope, and a country- or
-- region-level ranking leaves the deeper components unconstrained. The city
-- index from 20261022120000 cannot range on `published_at` there, so these two
-- lead with the level's own components and then the window. Their INCLUDE
-- columns let the cohort and rank filters run on index tuples.
CREATE INDEX "LookbookPost_spotlight_country_window_idx"
  ON "LookbookPost" (area_country, published_at DESC)
  INCLUDE (area_region, area_city, user_id, reaction_generation)
  WHERE status = 'published' AND published_at IS NOT NULL
    AND erasure_requested_at IS NULL AND anonymized_at IS NULL
    AND area_country IS NOT NULL;

CREATE INDEX "LookbookPost_spotlight_region_window_idx"
  ON "LookbookPost" (area_country, area_region, published_at DESC)
  INCLUDE (area_city, user_id, reaction_generation)
  WHERE status = 'published' AND published_at IS NOT NULL
    AND erasure_requested_at IS NULL AND anonymized_at IS NULL
    AND area_region IS NOT NULL;

-- Non-author reaction counts per windowed post become index-only probes; the
-- existing (post_id, selection) index needs a heap visit for `user_id`.
CREATE INDEX "CommunityReaction_spotlight_post_idx"
  ON "CommunityReaction" (post_id) INCLUDE (user_id)
  WHERE selection IS NOT NULL;
