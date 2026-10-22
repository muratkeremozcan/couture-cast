---
title: 'Story 6.6: Community City Spotlight'
type: 'feature'
created: '2026-10-22'
status: 'in-review'
baseline_commit: 'a9215495c792e4153713f952c5052c4a5e5c815e'
route: 'dispatch'
story_key: '6-6-community-city-spotlight'
review_loop_iteration: 2
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-3-curated-reactions.md'
---

<frozen-after-approval reason="owner delegated delivery and phased peer approval">

## Intent

**Problem:** Members cannot see which recent looks stand out near them; the community feed orders by
climate band and recency only.

**Approach:** Rank eligible published posts from the viewer's coarse area with a deterministic
reaction and recency score, serve the ranking from a Redis read model that engagement and moderation
invalidate, and show it as a localized, paginated City Spotlight module on web and mobile Community
surfaces with privacy-safe impression and open analytics.

## Boundaries & Constraints

**Always:**

- Area identity is hierarchical: city = `(country, region, city)`, region = `(country, region)`,
  country = `(country)`. Country is canonical ISO 3166-1 alpha-2, resolved from the saved text by a
  reverse `Intl.DisplayNames` lookup over the ten supported locales plus a short alias table; text that
  does not resolve counts as null. Region and city are trimmed, NFKD with combining marks removed,
  Turkish dotted and dotless I folded, then lowercased. A level exists only when it and every parent
  component are non-null. Same-named cities or regions under different parents never merge.
- Location choice for author and viewer: the first `SavedLocation` in `findViewerLocations` order
  (`is_primary desc, created_at asc`) whose `country` is non-null. None means level `none`.
- At submission, stamp the post's three components from the author's chosen location. Coordinates,
  `location_key`, labels and timezone never reach the post. Anonymization and erasure clear the
  components in the same update that clears `location_key`. Author withdrawal and guardian
  `consent_suspended` keep them; the visibility predicate already excludes those posts.
- Eligibility: `PUBLICLY_VISIBLE_POST_WHERE`, level components present, `as_of - 7 days < published_at
<= as_of`, and at least one current reaction from a member other than the author.
- `as_of` is the injected clock's time truncated to the minute. `community-spotlight.service.ts`
  takes a `Clock` provider; tests set it directly. No HTTP or production clock override exists.
- Score: `non_author_reactions / (age_hours + 2)^1.5`, `age_hours = (as_of - published_at)` in hours,
  all three palette reactions weighted equally. Order: score desc, non-author reactions desc,
  `published_at` desc, `id` desc. A snapshot holds at most 60 posts. Threshold, window, exponent and
  cap are exported constants pinned by tests.
- Minimum privacy cohort: 5 distinct authors of eligible posts at that level. Pick the narrowest
  available level meeting it (city, region, country); otherwise level `none` with no items. Level
  enum: `city | region | country | none`. The response never exposes cohort size.
- The response label is the viewer's own place name at the chosen level (null for `none`), never
  derived from authors.
- Read authorization, rollout flags, consent, age, erasure and canary rules match the feed exactly.
  Reaction projections negotiate through `x-couture-reactions` like the feed and are always computed
  live per request. Responses stay `private, no-store`.
- Snapshot: ordered post IDs plus `as_of`, level and area hash. Snapshot ID = SHA-256 of
  `(as_of, level, area hash, ordered IDs)`. Stored immutable in Redis under its ID for 600 seconds.
  A rebuild that yields the same ID refreshes the stored generations; the ordered IDs are identical
  by construction. An area pointer key (embedding the global spotlight epoch, level and area hash) names the current
  snapshot and the area version it was built at.
- Invalidation: a spotlight invalidator consumes appended public `CommunityStreamEvent` rows by its
  own durable cursor, after their commit, at least once. An event whose post still has area
  components increments the version of its city, region and country areas. `resync`, a null
  `post_id`, a missing post, or a post with `anonymized_at` or `erasure_requested_at` set increments
  the global epoch. An event on a live post that was never stamped changes nothing. The cursor advances
  only after Redis succeeds; Redis failure never blocks the append loop. It runs in the same runtime
  tick after `append()`.
- Rebuild race: a builder reads the area version before its database read and publishes its pointer
  only through a compare-and-set on that version (Lua). Readers treat a pointer whose version differs
  from the current area version as absent.
- Page one: resolve the viewer's level by a live cohort count at the current `as_of` before any
  pointer lookup, then load that level's current snapshot or build one. Any snapshot
  entry that fails live visibility, or whose `reaction_generation` differs from the snapshot's
  recorded value, forces a rebuild before serving.
- Cursor: HMAC-signed like the feed cursor, binding member, level, area hash, `as_of`, snapshot ID and
  next index. Decode returns `invalid_cursor` when member, level or area hash differ from the viewer's
  fresh resolution. Later pages read the pinned snapshot by ID, or recompute at the cursor's `as_of`
  when it is missing (Redis down or expired); a recomputed ID mismatch returns `invalid_cursor`.
  Each later page rechecks the cohort live at the snapshot's level and `as_of` and returns
  `invalid_cursor` below 5. Entries failing live visibility are skipped by index, so no entry
  repeats or shifts. Limit default 6, max 12.
- Key lifetimes: snapshots and pointers expire after 600 seconds; version and epoch counters never
  expire. A missing version or epoch counter is created with `SET NX` at a random 63-bit value, so a
  reset never re-matches an old pointer. When the invalidator cursor falls below the stream retention
  floor, it increments the global epoch and resumes from the current head.
- Redis client reuses the ritual options (`connectTimeout: 1000`, `maxRetriesPerRequest: 1`,
  `enableOfflineQueue: false`) plus `commandTimeout: 500`; unavailability or a stalled server falls
  back to direct database ranking capped at 60. The invalidator is bounded so Redis never stalls
  `append()`.
- Privacy model: coarse canonical area, 5-author cohort, the viewer's own label, and at most 30
  spotlight reads (page one and cursor pages) per member per minute through the community
  rate-limit contract.
- Web: module heads the community section on `/`; mobile: header of the Community tab list. Show a
  heading with the area label, ranked cards reusing existing card and detail components, loading,
  empty, disabled and error states, and a View more button that appends the next page, moves focus to
  the first new card and announces once through the surface's live region. Mobile heading uses the
  header accessibility role.
- Analytics: server records `community_spotlight_viewed` on page-one reads (10-second dedupe bucket
  like feed view). The opened endpoint gains a discriminated body branch `{ surface: 'spotlight',
rank: 1..60, level }` without `experimentVariant`, where `level` is the served level other than
  `none`; the server validates and records these and runs no cohort query on open; that branch emits only `community_spotlight_opened`
  with its own post-viewer-surface dedupe. Requests without `surface` keep today's
  `community_card_opened` behavior byte-identical. Properties: HMAC subject, dedupe key, platform,
  level, item count or rank. No area names, captions, media, coordinates or raw IDs.
- Tests: spotlight seeds and factories publish relative to one captured seed time (the feed seed
  epoch stays fixed for feed stability). Each E2E test that mutates reactions owns a unique area
  tuple with its own 5-author cohort; read-only tests may share the seeded cohort. Integration tests
  drive `append()` and the invalidator explicitly and never sleep. E2E asserts cross-post
  invalidation only on a lane that runs the engagement runtime.
- All ten locales on web and mobile with parity tests passing.

**Never:**

- No production rollout enablement, new paid service or new feature flag default on.
- No sponsorship CTA, Home teaser, following graph, moderator UI or new realtime push (Stories 6.7+).
- No backfill of area components onto existing posts; unstamped posts are ineligible.
- No change to existing feed ordering, cursor, opened default path or legacy strict response shapes.

## I/O & Edge-Case Matrix

| Scenario                                 | Input / State                                          | Expected Output / Behavior                                                                                  | Error Handling               |
| ---------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------- |
| City cohort met                          | 5+ authors in viewer city tuple                        | `city` ranking, viewer's label                                                                              | N/A                          |
| City thin, region met                    | 3 city authors, 7 region                               | `region` ranking                                                                                            | N/A                          |
| Same city name, two regions              | 3 + 3 authors, one country, nothing else               | Cities and regions each fail; `country` ranking holds all 6                                                 | N/A                          |
| Viewer city null, region set             | Partial location                                       | Starts at `region`                                                                                          | N/A                          |
| Spelling variants                        | `USA` and `United States`; `Sao Paulo` and `São Paulo` | One area each                                                                                               | N/A                          |
| Reaction on never-stamped post           | Live post with null components                         | No version or epoch change                                                                                  | N/A                          |
| No cohort anywhere                       | Under 5 at country                                     | `none`, no items, empty state                                                                               | N/A                          |
| No usable location                       | No location with country                               | `none`                                                                                                      | N/A                          |
| Window edges                             | Published exactly at `as_of - 7d` / `as_of`            | Excluded / included                                                                                         | N/A                          |
| Equal scores                             | Same score and counts                                  | `published_at` desc then `id` desc                                                                          | N/A                          |
| Only self reactions                      | Author reacted to own post                             | Ineligible                                                                                                  | N/A                          |
| Reaction on snapshot post                | Generation advanced                                    | Next page one rebuilds immediately                                                                          | N/A                          |
| Reaction outside snapshot                | Post gains first reaction                              | Reflected on first page one after invalidator processes its event                                           | Retry on Redis failure       |
| Rebuild races invalidation               | Build started before commit                            | Stale pointer never published                                                                               | CAS refusal                  |
| Takedown or withdrawal                   | Status leaves published                                | Absent from every later response                                                                            | Live visibility check        |
| Fifth author erased, post outside top 60 | City falls to 4                                        | Next page one picks `region` by its live cohort count, with or without the invalidator; old cursors invalid | `invalid_cursor`             |
| Invalidator behind retention floor       | Cursor older than 48h stream floor                     | Global epoch bump, resume at head                                                                           | N/A                          |
| `resync` event                           | No post                                                | Global epoch bump                                                                                           | N/A                          |
| Redis down, page one and two             | Connection refused                                     | Database ranking; page two recompute matches ID                                                             | `invalid_cursor` on mismatch |
| Foreign or stale cursor                  | Other member, or viewer moved area                     | Refused                                                                                                     | `invalid_cursor`             |
| Spotlight open                           | `surface: 'spotlight'`, rank                           | Only `community_spotlight_opened`                                                                           | 400 on bad rank              |
| Installed client open                    | No `surface`                                           | Exactly the old `community_card_opened`                                                                     | N/A                          |
| Flag off or ineligible viewer            | Read rollout disabled                                  | Same refusal as feed                                                                                        | Localized disabled state     |

</frozen-after-approval>

## Code Map

- `packages/db/prisma/schema.prisma:569-650` `LookbookPost`: add coarse area columns and a partial
  index for windowed eligible reads. `:390` `SavedLocation` holds city/region/country.
- `packages/db/prisma/migrations/20261018090000_add_community_reactions/migration.sql:1-6`: Story 6.6
  cache contract (generation plus visibility recheck). `20261020120000_community_realtime/migration.sql:324-393`:
  triggers emitting the invalidations above.
- `apps/api/src/modules/community/community.service.ts:207-296` `getFeed`, `:396-424`
  `readAuthorized`, `:510-560` `resolveViewerBand`, `:1095-1125` submission stamping.
- `apps/api/src/modules/community/community.repository.ts:116-139` visibility predicate, `:194-219`
  `reactionSummaries`, `:351-401` keyset paging. `community-cursor.ts` HMAC cursor pattern.
- `apps/api/src/modules/community/community-engagement.runtime.ts:47-48` and
  `community-stream.repository.ts` `append()`: outbox loop to hook cache invalidation.
- `apps/api/src/modules/community/community-maintenance.service.ts:253-266`: anonymization and erasure
  clear area components with `location_key`. `community.repository.ts:506-515` withdrawal and
  `guardian.service.ts:827-843` consent suspension keep them.
- `community-stream.repository.ts:171-243`: `writeBatch` marks rows appended; unavailable removed
  sources become `resync` with null `post_id`. `community-cursor.ts:14,44`: member-bound cursor decode.
- `community.service.ts:896-935` opened path and `community_card_opened` (beta-gate lift by arm);
  `packages/api-client/src/types/analytics-events.ts:740-755`.
- `packages/db/prisma/seeds/rituals.ts:11-19`: fixed feed seed epoch; spotlight seeds must not use it.
- `apps/api/src/modules/personalization/personalization.module.ts:56-68`, `ritual-cache.ts`,
  `ritual.service.ts:701-711`: Redis client options, key prefixes and soft-failure precedent.
- `apps/api/src/modules/community/community-analytics.ts`, `modules/telemetry/telemetry.service.ts`,
  `packages/api-client/src/types/analytics-events.ts:723-755`: HMAC subjects, dedupe, strict event schemas.
- `packages/api-client/src/contracts/http/community.ts` (feed `:605-611`, opened `:755-767`),
  `contracts/http/openapi.ts`: contract-first routes; regenerate OpenAPI and SDK.
- Web: `apps/web/src/app/components/lookbook-prism-layout.tsx:569-577`, `community-lookbook-grid.tsx`
  (live region `:2994`, detail `:877`, load more `:1647`), `apps/web/src/lib/community.ts`.
- Mobile: `apps/mobile/src/features/community/community-screen.tsx` (FlatList `:1507`, open `:1043`),
  `apps/mobile/components/community/community-card.tsx`, `apps/mobile/src/lib/community.ts`,
  `apps/mobile/src/lib/accessibility-focus.ts`.
- Locales: `apps/web/src/i18n/locales/*.json`, `apps/mobile/assets/locales/*.json`, parity specs in both apps.
- Tests: `apps/api/integration/`, `packages/testing/src/factories/community.factory.ts`, `pact/http/`,
  `playwright/tests/community-feed.spec.ts`, `maestro/community-feed.yaml`, `scripts/run-maestro.mjs`,
  `scripts/maestro-flow-durations.json`, seeds in `packages/db/prisma/seeds/`.

## Tasks & Acceptance

**Execution:**

- [x] `packages/db/prisma/schema.prisma` and new migration -- area columns, index, anonymization
      clearing, API-only invalidator cursor row with RLS -- area source, privacy, durable invalidation.
- [x] `apps/api/src/modules/community/` submission and maintenance paths -- stamp and clear area keys.
- [x] New `community-spotlight.repository.ts`, `community-spotlight.service.ts`, `community-spotlight-cache.ts`,
      `community-spotlight-invalidator.ts` -- clock seam, eligibility, level selection, scoring, snapshots,
      CAS pointers, versions and epoch, cursor, Redis fallback; wire the invalidator into
      `community-engagement.runtime.ts` after `append()`.
- [x] `packages/api-client/src/contracts/http/community.ts` and `openapi.ts` -- `GET /api/v1/community/spotlight`
      and optional opened `surface`/`rank`; regenerate OpenAPI/SDK; Optic diff clean.
- [x] `community.controller.ts`, `community.module.ts` -- route, headers, authorization wiring.
- [x] Telemetry service and analytics event registry -- two strict spotlight events and privacy tests.
- [x] Web and mobile wrappers, spotlight module components, View more, focus and announcements.
- [x] All 20 locale catalogs -- `community.spotlight.*` keys.
- [x] Seeds and factories -- deterministic spotlight cohort fixtures for local, Playwright and Maestro.
- [ ] Unit tests (pure scorer, constants, cursor) and real-database plus owned-Redis integration tests
      covering every I/O matrix row; Pact interactions for spotlight and both opened branches;
      Playwright spotlight spec with axe on `pr-pw-e2e-local`; Maestro flow registered in
      `run-maestro.mjs` and `maestro-flow-durations.json`.

**Acceptance Criteria:**

- Given identical data and `as_of`, when ranking runs twice, then order and scores are identical.
- Given any response, when served, then every entry passes live visibility and the cohort holds at
  its level.
- Given a reaction, takedown, erasure or consent change commits, when the invalidator has processed
  its appended stream event, then the next page-one read reflects it; changes to posts already in the
  snapshot are reflected on the next page-one read with no wait.
- Given keyboard or screen-reader users on web and mobile, when they use View more and open a card,
  then focus lands on the first new card or the detail and the change is announced once.
- Given any spotlight interaction, when analytics events are captured, then they pass strict schemas
  and contain no area names, content, coordinates or raw identifiers.
- Given all ten locales, when parity specs run, then every spotlight key and placeholder matches.

## Implementation Notes

- 2026-10-22: both independent story reviews READY on iteration 2, spec SHA-256
  `b7da18fe8775854715eb51175635584e9cf2668d7e8ee3eb8040064aa3e5a7fc` (before this administrative
  update): [Opus rereview 2](../test-artifacts/story-6-6/reviews/cc66-opus-story-rereview-2.md) and
  [TEA rereview 2](../test-artifacts/story-6-6/reviews/cc66-tea-story-rereview-2.md). Approval
  delegated by the owner to the coordinator.
- Build note from TEA: random 63-bit counter seeds exceed JS safe integers and Lua doubles, so
  versions and epochs are compared as strings everywhere, pinned by a unit test.
- 2026-10-22, implementation. Changes outside the story's own surface, each with the defect it
  fixed:
  - Web feed reads retry once on the read gate's retryable 503 (`retryOnceWhenCommunityUnavailable`,
    shared with mobile): under browser-test contention the gate's authorization budget answered a
    transient 503 that left the feed in its error state.
  - Web and mobile clients classify the read gate's rollout 403 (it carries the disabled message)
    as `disabled`; before, it fell through to a generic failure, so a member outside the rollout saw
    the error state on the feed and the spotlight instead of the localized disabled state.
  - Prisma schema: two telemetry id defaults now say `dbgenerated("gen_random_uuid()")`, matching
    their migrations; `prisma migrate diff` reported drift on a clean database.
  - Lookbook Prism layout: grid tracks use `minmax(0, 1fr)` and the columns `min-w-0`; plain `1fr`
    let the image column's intrinsic width crush the community column to about 160 px at 1440 px.
  - Playwright community journeys wait for completed feed reads and record transient comment alerts;
    they raced superseded reads and alerts that cleared before the assertion ran.
  - Mobile feed footer and empty state render as elements; passed as functions they were rebuilt on
    every render and dropped screen-reader focus from Load more. 6.1-MOB-022 waits for the first
    image load before expiring the image; the late load reset the retry budget.
- 2026-10-22, privacy model (R24, R29). The spotlight exposes a coarse canonical area (ISO
  country, folded region and city), never coordinates or a location key; ranks only levels with at
  least 5 distinct eligible authors and never returns the cohort size; labels with the viewer's own
  saved place name; and allows at most 30 spotlight reads per member per minute, counted in
  `CommunitySpotlightReadWindow` (one row per member, fixed minute window, atomic upsert, deleted
  with the community subject on erasure, cascading with the user) and refused with the community
  429 and `Retry-After`. Code review round 2 (R29) made cursor pages count too, because each later
  page rechecks the cohort live and a replayed cursor would otherwise probe it without limit; the
  frozen Privacy model bullet still says page-one and needs the coordinator's amendment.
- 2026-10-22, erasure (R26): `forgetCommunitySubject(erase=true)` deletes the read window row in
  the transaction that forgets the community subject.
- 2026-10-22, canonical areas (R22). `canonicalCountryCode` lives in `@couture/utils` because the
  API and the spotlight fixtures must agree; it builds its table lazily from `Intl.DisplayNames`
  long and short names in the ten locales, the 249 ISO codes plus `XK`, and an alias table. Region
  codes ICU treats as aliases (`UK` to `GB`) and non-country regions (`EU`, `UN`, `ZZ`,
  exceptional reservations) never resolve. Fixture areas take real countries, one per call per
  process, by English name.
- 2026-10-22, query plans (R21), PG17 with 50,000 posts over 60 days (half in one country) and
  529,466 reactions; plans and load script in
  `_bmad-output/test-artifacts/story-6-6/runs/r21-explain/`. Before: both country-level queries
  hash-joined a parallel sequential scan of every reaction, with posts from the generic
  `(status, published_at, id)` index; cohort 34.9 ms, rank 51.6 ms. Migration
  `20261022140000_community_spotlight_window_indexes` adds partial window indexes led by the country
  and by the region, and a covering partial reaction index. After: nested loops driven by
  `LookbookPost_spotlight_country_window_idx` with index-only reaction probes (zero heap fetches);
  cohort 18.2 ms, country rank 34.6 ms, region rank 2.9 ms, city rank 0.4 ms.
- 2026-10-22, opened dedupe (R2): `community_spotlight_opened:<subject token>:<post token>:spotlight`,
  both tokens 16-hex HMACs under the analytics id secret.
- 2026-10-22, image expiry on spotlight cards re-reads that one post on both platforms and replaces
  only its copy; a page-one refresh would drop later pages and close a detail opened from one.
- 2026-10-22, layout (R42, owner decision through the coordinator). Six stacked full cards put
  the first feed card about 11,000 px down on mobile and below the first viewport on web. Both
  platforms now show one horizontal row of the reused card with View more as its trailing item;
  the R11 focus and announcement rules hold, and focus scrolls the first appended look into view.
  Mobile uses a snapping horizontal ScrollView (item `min(85% of the window, 420)`, so about 58 pt
  of the next card peeks at 390 pt) rather than a virtualized list, so every loaded look stays on
  the accessibility tree; each rank badge reads `Rank N, Position P of C` through the new
  `community.spotlight.position` key. Web uses an ordered list with `aria-posinset` and
  `aria-setsize`, cards `85cqw` wide on narrow screens and a column wide from 768 px, with scroll
  snap and no sideways page scroll; Playwright asserts one row and a module one card tall at
  390 px and 1280 px. Below 1280 px the hero sits above the community section, so at 390 px the
  first feed card stays below the first viewport for reasons outside the spotlight; the module now
  adds one card height there.
- 2026-10-22, Maestro (R18, R19): feed cards are taller than the space between the sticky chips
  and the tab bar, so flows reach a card by half of it, then walk its parts top to bottom. Two
  harness defects surfaced when the new flow reshuffled shards and were fixed: Settings scrolls to
  a locale-stable `settings-language-title` because Android counts a clipped chip sliver as
  visible, and the wardrobe onboarding card tap retries after a relaunch when Expo Go's invisible
  developer-sheet backdrop swallows it.
- 2026-10-22, Story 6.5 defect found and fixed here (R43, coordinator decision). After a socket
  drop the verification window keeps content for 2 s, and the shared sync state reported every
  untyped request failure, including its own 2 s client abort of a request the server had answered
  200, as `unavailable`. Both hid the feed and emptied the list, so members lost their scroll
  position and could see "temporarily unavailable" with every call succeeding; Maestro surfaced it
  on a slow Android emulator. Failures with no server status now report `recovering`, so the
  unchanged 8 s privacy window decides; any server status stays `unavailable` and 401/403 stay
  `denied`. The HTTP fallback starts every 5.0 to 5.5 s, so a poll plus its 2 s budget completes
  inside the window. When content must hide and the same items return, web and mobile restore the
  reader's scroll position; content still unmounts while unverified.

## Spec Change Log

- 2026-10-22, iteration 1: hierarchical area tuples and partial-null rules; exact clearing
  transitions; injected clock and relative spotlight seeds with per-test areas; versioned Redis areas,
  global epoch for unmappable events, durable at-least-once invalidator cursor, CAS rebuild; pinned
  snapshot ID by digest, member-bound cursor, live cohort recheck on later pages, index skipping;
  Redis-down recompute; discriminated opened branch that never emits `community_card_opened`;
  level enum and window inclusivity; AC2 restated against the invalidator boundary. KEEP: owner
  delegated cohort 5, 7-day window, score formula, submission stamping, no backfill.
- 2026-10-22, iteration 4 (code review round 2, coordinator under owner delegation): the read
  limit counts every spotlight read, cursor pages included (R29); region and city also transliterate
  letters NFKD cannot split, such as ß, ł, đ, ø, æ (R32).
- 2026-10-22, iteration 3 (code review round 1, coordinator under owner delegation): canonical
  ISO country and folded region and city; epoch only for unmappable, erased or anonymized posts; open
  body carries served level; same-ID rebuild refreshes generations; Redis `commandTimeout` and
  bounded invalidator; per-member page-one read limit. Triage:
  `_bmad-output/test-artifacts/story-6-6/reviews/code-triage-1.md`.
- 2026-10-22, iteration 2: live cohort count on page one before pointer lookup; cursor carries
  `as_of`; determinate same-name row; erasure row independent of event form; counter lifetimes,
  `SET NX` random seeds and retention-floor epoch bump.

## Review Triage Log

- 2026-10-22, story review 1 on SHA `9d38e1a0...db12`: cc66-opus CHANGES_REQUIRED (7), cc66-tea
  CHANGES_REQUIRED (7). All 14 accepted as valid; none refuted. Reviews:
  `_bmad-output/test-artifacts/story-6-6/reviews/cc66-{opus,tea}-story-review.md`.
- 2026-10-22, rereview 1 on SHA `87b49725...2eb04`: all 14 prior findings resolved. New: Opus 2 minor,
  TEA 1 major and 3 minor, overlapping on cursor `as_of`. All accepted and amended in iteration 2.

## Design Notes

Level selection and scoring run in one SQL statement per level inside a repeatable-read read so the
cohort count and ranked rows come from one snapshot. Example scoring fragment:

```sql
count(r.*) FILTER (WHERE r.selection IS NOT NULL AND r.user_id <> p.user_id) AS reactions,
reactions / power(extract(epoch FROM ($as_of - p.published_at)) / 3600 + 2, 1.5) AS score
```

The cohort threshold, window and exponent are exported constants with tests pinning them.

## Verification

**Commands:**

- `cd apps/api && NODE_OPTIONS=--conditions=development npx vitest run src/modules/community` -- expected: pass.
- `cd apps/api && INTEGRATION_TEST_DATABASE_URL=<isolated db> NODE_OPTIONS=--conditions=development npx vitest run integration/community-spotlight` -- expected: pass; the suite must fail, never skip, when its schema probe fails in CI.
- `npm exec -w apps/web -- vitest run src/i18n` and `npm exec -w apps/mobile -- vitest run src/i18n` -- expected: pass.
- `npm run test:pact` and `npm run optic:diff` -- expected: pass.
- `npx playwright test playwright/tests/community-spotlight.spec.ts` -- expected: pass with axe clean.
- `node scripts/run-maestro.mjs maestro/community-spotlight.yaml` -- expected: pass on an emulator.
