---
title: 'Story 1.2b: Client location capture'
type: 'feature'
created: '2026-10-22'
status: 'done'
baseline_commit: '1d4ad0c2c549abd52541d2c6e12a6af24878e5f9'
route: 'dispatch'
story_key: '1-2b-client-location-capture'
review_loop_iteration: 3
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-2-multi-location-preferences.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-6-community-city-spotlight.md'
---

<frozen-after-approval reason="owner delegated delivery and phased peer approval">

## Intent

**Problem:** No web or mobile screen saves a location. Every real member has zero saved locations, so
the daily ritual answers 400 "No location preferences found for user", the community climate band
stays unresolved, and City Spotlight never stamps an area.

**Approach:** Add a server-side city search backed by the configured weather provider's geocoding,
a signed search candidate that the server turns into a canonical saved location, and localized,
accessible location management on web and mobile settings, with guided entry points wherever a
missing location blocks the member today.

## Boundaries & Constraints

**Always:**

- Search: `GET /api/v1/locations/search?q=&locale=` (authenticated, 2 to 80 characters) returns at
  most 5 candidates from the configured provider's geocoding: OpenWeather Geocoding `direct` when
  `WEATHER_PROVIDER_MODE` is `openweather`, WeatherAPI `search.json` when it is `weatherapi`, using
  the existing API keys. No new provider, key or paid plan.
- Each candidate carries the provider's default (locale-independent) `name` as city, its `state` or
  `region` as region (null when absent), the ISO 3166-1 alpha-2 country (OpenWeather returns it;
  WeatherAPI country names go through `canonicalCountryCode`, and candidates that resolve to null are
  dropped), rounded coordinates, a display label localized where the provider offers `local_names`
  (display only, outside the signed fields), and a `candidateToken`: an HMAC-signed, 15-minute,
  identity-free token over the canonical fields, signed with `LOCATION_CANDIDATE_SECRET` like the
  existing signed tokens. A missing secret in a deployed environment fails closed with 503 on both
  endpoints. The client never supplies coordinates, timezone or country for this path.
- Save: `POST /api/v1/locations/from-search` with `{ candidateToken, label }` verifies the token, then
  makes one forecast call for the candidate coordinates through the existing weather provider path
  (One Call or WeatherAPI forecast, 3-second timeout). That call supplies the IANA timezone (One Call
  `timezone` or WeatherAPI `location.tz_id`, validated against `Intl`) and is persisted through the
  existing ingestion persistence as the location's snapshot with daily summaries, so a saved location
  is weather-ready when the request returns. If the forecast call fails, times out or returns an
  invalid timezone, nothing is saved and the endpoint returns a typed retryable 503.
- `locationKey` is derived from server-held fields only: ASCII-folded (NFKD, marks removed, Turkish
  dotted and dotless I folded) default name, region and ISO country joined as a slug, always followed by the
  coordinates at the same three-decimal precision the service already stores, encoded with hemisphere
  letters (for example `41.871n-87.631w`), so stored coordinates, forecast targets, the key and the
  duplicate rule share one precision: distinct stored places never share a key and the same provider
  candidate always yields the same key. Name parts are shortened, never the coordinates, to keep the key
  within the existing 120-character `locationKeySchema` limit. The duplicate rule is keyed on it, so same-name cities in
  different regions stay distinct and every display locale produces the same key. Storage follows the
  existing repository rules (max 3, first saved becomes primary, duplicate key refused). The existing
  `POST /api/v1/locations` stays unchanged for installed clients and tests.
- A valid token replayed by another member saves only into the authenticated caller's collection.
  A bad signature, a token from another environment's secret, or an expired token returns 400.
- Country is stored as the ISO alpha-2 code; city and region as the provider's names. The Story 6.6
  canonical folding then resolves them without change.
- Switching primary, and the primary promoted by deleting the current one, enqueue the existing
  `weather-refresh-location` job for that key when its snapshot is absent or older than 5 minutes; until
  it lands, the ritual serves the existing stale-data fallback, or its existing weather-unavailable
  state when a legacy location has no snapshot at all.
- When OpenWeather omits `state`, the saved region is null and City Spotlight resolves at country level.
- Search queries are never logged or sent to analytics. Analytics records `location_saved` and
  `location_search_failed` with HMAC subject, outcome, platform and result count only. The existing
  `location_switched` event becomes pseudonymous and drops its place-key properties, since this story
  ships its first caller. Search is
  limited to 30 requests per member per minute through the shared rate-limit contract.
- Provider failure, timeout (3 seconds) or a missing key returns a typed 503 with a localized
  retryable message.
- Web: a Locations section on `/settings` and mobile: a Locations screen pushed from Settings. Both
  list saved locations (label, city, primary marker), add through search, set primary, rename and
  delete, and explain the three-location limit. Switching primary takes at most two taps. While a
  save request runs the form shows a busy state; a 503 keeps the chosen candidate and offers retry.
- Guided entry: the mobile hero no-location state, and the web and mobile community `no_location`
  band state, show a localized action that opens location add. After saving, the originating surface
  reloads and the hero shows a ritual.
- Acceptance harness: the Playwright local lane (`pr-pw-e2e-local.yml`) and the Android and iOS Maestro runs point the E2E API at
  a local deterministic double for geocoding and forecast through provider base-URL configuration
  (no live provider traffic), use a fresh member with zero saved locations and no snapshot for the
  target key, and prove the ritual consumed the persisted double forecast (a sentinel value) with the
  test-env ritual weather fallback disabled for that journey. The real-database location suites run in
  CI with their opt-in flag set and fail, never skip, on a schema probe failure. Provider base-URL
  overrides are honored only outside production. The location capture spec is tagged out of the
  preview and production Playwright runs, which never call live geocoding or write locations.
- Search input is debounced (300 ms), keyboard and screen-reader operable (combobox with listbox,
  result count announced, errors announced), 44 px targets on mobile, all ten locales on web and
  mobile with parity tests passing.

**Never:**

- No device GPS or browser geolocation, and no new OS permission in this story.
- No change to ritual ranking, weather ingestion cadence, spotlight rules or the existing locations
  contract shapes.
- No free-text country, coordinates or timezone accepted on the new save path.

## I/O & Edge-Case Matrix

| Scenario                                         | Input / State                                                    | Expected Output / Behavior                                        | Error Handling      |
| ------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------- |
| Search hit                                       | `q=Chicago`                                                      | Up to 5 candidates with ISO country and token                     | N/A                 |
| Short or empty query                             | `q=C`                                                            | No provider call                                                  | 400 validation      |
| Provider down or slow                            | Timeout over 3 s                                                 | Localized retryable error                                         | 503 typed           |
| Save first location                              | Valid token, no saved locations                                  | Saved as primary with its snapshot, hero shows ritual             | N/A                 |
| Save with three saved                            | Fourth location                                                  | Not saved, limit explained                                        | 400 max-locations   |
| Duplicate city                                   | Same `locationKey`                                               | Not duplicated                                                    | 400 duplicate       |
| Tampered or expired token                        | Edited payload, other environment's secret, or older than 15 min | Not saved                                                         | 400 invalid token   |
| Token from another member                        | Replayed valid token                                             | Saved for the caller only; issuer's locations unchanged           | N/A                 |
| Forecast call fails at save                      | Provider down or invalid timezone                                | Nothing saved, candidate kept                                     | 503 typed retryable |
| Same name, two regions                           | Springfield IL and Springfield MO                                | Two distinct keys, both savable                                   | N/A                 |
| Non-Latin display locale                         | ja-JP-style localized label for Moscow                           | Same `locationKey` as an en-US save                               | N/A                 |
| Unresolvable WeatherAPI country                  | Country name with no ISO mapping                                 | Candidate dropped                                                 | N/A                 |
| Same name, region and country, different places  | Two candidates with distinct coordinates                         | Two distinct keys                                                 | N/A                 |
| Legacy location without snapshot becomes primary | Switch to a location saved before this story                     | Refresh enqueued; ritual shows weather-unavailable until it lands | N/A                 |
| Missing region                                   | OpenWeather result without `state`                               | Saved with null region; spotlight at country level                | N/A                 |
| Switch primary                                   | Second location tapped                                           | Primary moves, ritual and community band follow on next load      | 404 for foreign id  |
| Delete primary                                   | Other locations exist                                            | Next location becomes primary                                     | N/A                 |
| Unicode city                                     | `İstanbul`, `São Paulo`                                          | Stored with provider names, ISO country; spotlight area resolves  | N/A                 |
| Search rate limit                                | 31st search in a minute                                          | Refused                                                           | 429 shared contract |

</frozen-after-approval>

## Code Map

- `packages/api-client/src/contracts/http/locations.ts`: existing strict schemas and routes; add search and from-search contracts and register them for OpenAPI.
- `apps/api/src/modules/location-preferences/` controller, service (`:23-41` slug and rounding, `:149-173` create, `:214-235` setPrimary telemetry), repository (`:49` max 3, `:86-127` create under advisory lock, `:127` first primary).
- `apps/api/src/modules/weather/providers/openweather.provider.ts`, `weatherapi.provider.ts`, `weather.config.ts:17-23`: base URLs, keys, mode; add geocoding clients beside them. `network-blocker.spec.ts` and provider fixtures for doubles.
- `apps/api/src/modules/weather/weather-scheduler.ts:4` `weather-refresh-location` job; `weather-target-source.ts:46-80` primary-only ingestion.
- `apps/api/src/modules/personalization/ritual.service.ts:230-242`: the 400 a member sees today.
- `packages/utils/src/spotlight-area.ts:200-226`: canonical country and area folding the stored values must satisfy.
- Web: `apps/web/src/app/settings/page.tsx` (accessibility contract `:11-24`), community `no_location` text in `community-lookbook-grid.tsx:1560-1565`.
- Mobile: `apps/mobile/app/(tabs)/settings.tsx:393-517`, stack registration `apps/mobile/app/_layout.tsx:225-237`, hero no-location state `apps/mobile/app/(tabs)/index.tsx:88-100,721-732`, community `no_location` in `community-screen.tsx`.
- Patterns: wardrobe onboarding (web `wardrobe/onboarding`, mobile `wardrobe-onboarding-screen.tsx`), community rate-limit exception, community HMAC analytics helpers.
- Tests: `packages/testing/src/factories/saved-location.factory.ts`, `pact/http/consumer/interactions/` (no locations file yet), `playwright/tests/api/ritual-daily-outfits.spec.ts:63-79`, `scripts/run-maestro.mjs:1481-1495`, `maestro/hero-experience.yaml`, `maestro/subflows/open-settings.yaml`, `apps/mobile/src/screens/hero-no-location.test.tsx`.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/api-client/src/contracts/http/locations.ts`, `openapi.ts` -- search and from-search contracts; regenerate OpenAPI and SDK; Optic diff clean.
- [ ] New geocoding client(s) beside the weather providers -- provider calls, timeouts, response validation, ISO country, timezone resolution.
- [ ] `apps/api/src/modules/location-preferences/` -- search and from-search endpoints, candidate token signing and verification, rate limit, refresh enqueue, analytics.
- [ ] `apps/web/src/app/settings/` and a location components module, `apps/web/src/lib/` wrappers -- Locations section, search combobox, primary, rename, delete, guided entry from community.
- [ ] `apps/mobile/app/` Locations screen and settings entry, `apps/mobile/src/lib/` wrappers, hero and community guided entry.
- [ ] All 20 locale catalogs -- location keys and parity.
- [ ] Unit, real-database integration with provider doubles, Pact (search, from-search, list, primary, delete), Playwright with axe, Maestro flow registered in `run-maestro.mjs` and durations, plus an end-to-end proof that a location saved through the UI yields a ritual, a resolved community band and a stamped spotlight area.

**Acceptance Criteria:**

- Given a member with no saved location, when they follow the guided action and save a searched city, then the hero shows a ritual and the community band resolves without a manual reload of any other screen.
- Given a saved location from search, when the member submits a community post, then the post carries a canonical spotlight area.
- Given a saved location, when the save request returns, then its snapshot with daily summaries exists
  and the next ritual read uses it without the test-env fallback.
- Given keyboard or screen-reader users, when they search, save, switch primary and delete, then every step is operable and announced once.
- Given any search, save, primary switch or delete, when analytics events and the new code's log lines are inspected, then no query text, coordinates or place names appear, and analytics carries no location keys or raw member ids. Existing request logging is unchanged.

## Implementation Notes

- 2026-10-22: both independent story reviews READY on iteration 3, spec SHA-256
  `eb75e88da42e839f3f0031364c94b2c4ab87cd055ecc8007e0a46e92c4bc9fae` (before this administrative update):
  [Opus rereview 3](../test-artifacts/story-1-2b/reviews/cc12b-opus-story-rereview-3.md) and
  [Astra TEA rereview 3](../test-artifacts/story-1-2b/reviews/cc12b-astra-story-rereview-3.md). Approval
  delegated by the owner to the coordinator.
- Build note: the key example `41.871n-87.631w` becomes `41-871n-87-631w` after `normalizeLocationKey`;
  a unit test asserts the final slug against `locationKeySchema`, including a long name at the 120-character cap.
- 2026-10-22, implementation (cc12b-impl). Decisions the spec left open:
  - Analytics: `location_saved` outcomes are `saved`, `limit_reached`, `duplicate`, `invalid_candidate`,
    `forecast_unavailable` and `service_unavailable`, with `resultCount` the member's saved count after
    the attempt; `location_search_failed` outcomes are `no_results`, `provider_unavailable`,
    `provider_timeout`, `provider_unconfigured` and `service_unavailable`. `location_switched` carries
    the HMAC subject and no properties. Platform comes from a required `x-couture-platform` header on
    the two new routes only, so the existing location routes keep their shapes.
  - Typed errors: 400 bodies carry `code` (`invalid_request`, `invalid_candidate`,
    `location_limit_reached`, `location_duplicate`); 503 bodies carry `code` (`provider_unavailable`,
    `location_service_unavailable`) and `retryable: true`. Clients localize by code.
  - Search rate limit: a `LocationSearchWindow` row per member (fixed one-minute window, atomic upsert,
    cascades with the user, API-only RLS); the 31st search answers the shared 429 with `Retry-After`.
  - Save: duplicate and limit are checked before the provider call, then one forecast call to the
    provider `WEATHER_PROVIDER_MODE` selects (no failover, 3 seconds) is persisted through
    `WeatherRepository.persistForecast` before the location row is created.
  - Provider base URLs: `OPENWEATHER_API_ORIGIN` and `WEATHERAPI_API_ORIGIN`, ignored whenever
    `isProductionRuntime` holds.
  - The ritual's test-env weather fallback never applies to a key that ends in the search coordinate
    suffix, in every test environment, so a search-saved location always reads its persisted forecast.
  - Primary refresh: `WeatherRefreshQueue`, a lazy BullMQ producer on `weather-ingestion` with the
    worker's bucketed job id; the enqueue is bounded to 1 second and never fails the request.
  - Display labels name a repeated part once (Monaco, Moscow).
  - Guided entry: web Community links to `/settings?addLocation=1&returnTo=%2F#locations` and a save
    returns there; mobile hero and Community push `/locations?guided=1`, a save goes back, and an
    `onLocationsChanged` emitter reloads the hero and the Community tab.
  - Harness: `scripts/weather-provider-double.mjs` (data in `scripts/lib/weather-provider-double-data.mjs`)
    starts inside `start-api-e2e-with-workers.mjs`; the Playwright spec is tagged `@local-lane`, which
    the preview and production configs `grepInvert`; the Maestro flow is user-scoped and its
    `FLOW_STATE_HOOKS` clear the member's locations before it and restore the baseline after it, with a
    per-run sentinel query.
- 2026-10-22, defects fixed outside the story surface:
  - Weather location job ids contained colons (`name:key:iso`), which BullMQ 5 rejects ("Custom Id
    cannot contain :"), so every sweep enqueue failed. Ids are now `name__key__bucketMs`, proven
    against real Redis.
  - `apps/api/src/load-env.ts` re-applied the `.env.local` override in every E2E child, discarding the
    launcher's explicit `DATABASE_URL`; the launcher now passes its caller-owned keys in
    `E2E_CALLER_OWNED_ENV_KEYS` (a loopback `REDIS_URL` included) and load-env keeps them.
  - The web settings heading was English on every locale; it reads `settings.title` in all ten.
- External prerequisite: `LOCATION_CANDIDATE_SECRET` (32 characters or more, one value per
  environment) must be set on the preview and production API; until then those deployments answer
  the fail-closed 503 on search and save from search.
- 2026-10-23, code review rounds 1 to 4 (cc12b-impl), decisions that change the notes above:
  - Save (supersedes the save bullet above): the forecast must hold the climate band's minimum usable
    days, read back exactly as Community reads them, or nothing is saved and the typed retryable 503
    answers. The snapshot is written inside the location's own transaction
    (`WeatherRepository.persistForecastWithin`), so a save that loses the limit or duplicate race leaves
    no snapshot behind (INT-17).
  - One injected `LOCATION_CLOCK` feeds both location services: search windows, token expiry,
    snapshot staleness and the refresh job bucket.
  - Production detection: any of `APP_ENV`, `DEPLOY_ENV` or `VERCEL_ENV` saying `production` (or
    `prod`) wins, so a Vercel production deployment always refuses provider origin overrides.
  - Location response schemas strip unknown keys so installed clients survive an additive server
    field; request bodies and the search query stay strict, and the integration suite pins the exact
    server output with `.strict()`.
  - A save-time forecast outage has its own copy (`locations.errors.save_unavailable`, all 20
    catalogs). Mobile location errors are announced once, through the announcer only. The web
    locations-changed event had no listener and was removed; web surfaces reload on navigation.
  - Mobile ritual cache: a saved, switched or deleted primary drops the latest-location pointer in
    every locale and the hero refetches without cache fallback. Cache mutations are serialized per
    member, each holds the queue until every native write it started settles, and an invalidation
    bumps a generation that makes a save queued before it skip its pointer (MOB-CACHE-01 to 05).
  - Maestro: the runner signs up until its member is on the community `auto` arm, the only arm that
    names the viewer's band; a random signup made the band proof a coin flip (CI job 120178429887).
- 2026-10-23, where each acceptance lane runs (corrects the harness claim above): CI runs the
  Playwright local lane and the Android Maestro shards, which include `location-capture.yaml`. CI has
  no iOS Maestro lane. iOS `location-capture.yaml` was run locally on an iPhone 17 simulator (iOS 26.1)
  with run-evidence; it needs `MOBILE_E2E_EXPO_NO_OPEN=1` on this machine because its Xcode ships no
  Simulator.app for `expo start --ios` to open, and it cannot run inside the agent sandbox (Expo's
  osascript lookup and the XCTest driver are blocked there).
- 2026-10-23, API test tier flakes, root causes and fixes:
  - Connection exhaustion: Prisma sizes each client's pool from the core count (`num_cpus * 2 + 1`),
    29 per client on a 14-core machine against 9 on CI's 4 vCPU, and the full tier then exhausted the
    100-connection local Postgres (`remaining connection slots are reserved for roles with the
SUPERUSER attribute`; 4 to 7 files red per run). `apps/api/vitest.config.ts` pins
    `connection_limit=9` on the integration URL.
  - Wall-clock budget overruns: the DB-backed suites assert real budgets (the 1 s interactive
    transaction in community fan-out, the 1950 ms community authorization budget, provider barrier
    deadlines, 5 s and 10 s test timeouts) while each file also runs child processes, servers and
    BullMQ workers against the one shared Postgres and Redis. Vitest's one worker per core put 13
    files on that database at once; measured 1 to 15 failures per full run (expired transactions,
    `CommunityUnavailableException` from the spent budget, hook timeouts, and assertions downstream
    of them), each file green alone. The config now caps workers at four (CI keeps three): three
    consecutive full runs green from load average 23, and two more green with four extra CPU burners.
- 2026-10-23, code review rounds 5 and later (TEA phase 2 and Opus rescore), fixed in this PR:
  - R16: INT-17 holds both saves at a barrier inside the forecast call, after both passed preflight
    and before either commits, so it fails on the pre-R11 order every time.
  - R17: Try again after a failed web search announces the retried result once, never "no cities".
  - R18: on sign-out the community no-location notice leaves together with its add-location action.
  - R19 and community follow-up: busy Locations and Community actions expose `aria-busy` on the
    mobile web build, which react-native-web 0.21 does not map from `accessibilityState`.
  - R20: `community-feed.yaml` stops swiping once the post's author row is in view, so its walk down
    the card no longer depends on where the last swipe landed.
  - R21: after Delete, keyboard focus lands on the confirmation, which renders in its own slot.
  - R22 and R22b: the migrate script, the Playwright runner and its workers keep the launcher's
    caller-owned env keys, so an isolated loopback stack is never redirected to the default local
    database by `.env.local`.
  - iOS `location-capture.yaml` passed at `40a4cf79` outside the sandbox, including its iOS-only
    keyboard guards.
- 2026-10-23, R24 (Android Maestro flake, CI job 120258320163): Expo Go 54 raises its developer-menu
  onboarding by itself two seconds after an experience loads whenever onboarding is unfinished
  (`DevMenuManager.maybeShowWithOnboarding`), and Maestro's `clearState` resets that before every
  flow. When the sheet's open animation never ran, its backdrop stayed over the app with the sheet
  parked below the screen and swallowed every tap, and each relaunch raised it again. A launch
  intent carrying `EXKernelDisableNuxDefaultsKey` turns the onboarding off for the process, so on
  Android every deep link now goes through a runner endpoint that sends the VIEW intent over adb on
  the device Maestro names (`scripts/lib/expo-go-link-endpoint.mjs`,
  `maestro/subflows/open-link.yaml`); iOS keeps `openLink`. A CI experiment (run 39914110811, 40
  cold launches per arm) showed the onboarding on every launch without the extra under both
  animation settings and on none of 80 with it, so the animation-scale lead was ruled out and
  animations stay disabled (13.1 s against 17.0 s per launch). The Android-only 15 s wait for a
  sheet that can no longer rise was removed from `open-app.yaml`.
- 2026-10-23, R25 (CI job 120315875135, `wardrobe-onboarding-flow.yaml`): the R24 endpoint's new 30 s
  bound answered 504 because `am start -W` never returned. The device log showed Android killing
  Expo Go's fresh process right after `clearState` ("Destroy timeout of remove-task"), so the
  launched activity never drew and `-W`, which waits for the draw, waited forever. Maestro's
  `openLink` never waited for a draw, and `open-app.yaml` already recovers such a launch by opening
  the link again. The endpoint now runs `am start` without `-W`: it returns once the intent is
  delivered, and the bound still catches a wedged adb.
- 2026-10-23, R26 (CI, quality-gate on cb3d07b8): `6.1-MOB-022` read 2 of 3 feed requests. The card
  shows its image fallback in the same tick it starts its last refetch, and that request reaches
  MSW only after the async access-token lookup, so a loaded coverage run could assert before it
  arrived. Not a product defect: the budget allows exactly two refetches. The test now slows the
  token lookup on purpose, waits for the third request and then checks no fourth follows; with
  the old synchronous assertion it fails every time (3 of 3), fixed it passed 25 of 25 under six
  CPU burners.
- 2026-10-23, found while proving R25 locally: `premium-planner.yaml` and `palette-advisor.yaml`
  scrolled to their Settings rows with `centerElement: true`, but both rows sit at the end of the
  list and can never reach the middle. Maestro then makes five more settling swipes before it
  accepts a visible row, and on a slow emulator those outlasted the 15 s timeout, so the step
  reported a row it was showing as not found. Both steps now wait for the row to be fully visible.
  R27: iOS judges that visibility from unclipped XCUI frames, so each step is followed by a `scroll`
  that pins the list end, where the row clears the tab bar on both platforms.

## Spec Change Log

- 2026-10-22, iteration 3: key coordinates use the stored three-decimal precision with hemisphere
  letters and fit the 120-character key limit.
- 2026-10-22, iteration 2: key always carries two-decimal coordinates; refresh also when no snapshot
  exists; log clause scoped to new code and analytics; harness names the local lane, keeps the spec out of
  preview and production runs, and honors base-URL overrides only outside production; matrix row aligned.
- 2026-10-22, iteration 1: weather-ready save through a synchronous forecast call (timezone and snapshot
  in one call, 503 on failure); locale-independent stored names and folded `locationKey` with region or
  coordinates; ISO country for both providers; identity-free token replay rule and named secret;
  delete-promoted primary refresh; pseudonymous `location_switched`; deterministic provider doubles and
  disabled ritual fallback in the acceptance harness; real-database opt-in flag in CI.

## Review Triage Log

- 2026-10-22, story review 1 on SHA `821f6840...4a76`: cc12b-opus CHANGES_REQUIRED (6), cc12b-astra (TEA)
  CHANGES_REQUIRED (3). All 9 accepted; none refuted. Reviews under `_bmad-output/test-artifacts/story-1-2b/reviews/`.
- 2026-10-22, rereview 1 on SHA `b9189bd7...d9a0`: all 9 prior findings resolved. New: Opus 3, Astra 2; all
  accepted and amended in iteration 2.
- 2026-10-22, rereview 2 on SHA `be6f6f45...99a7`: Opus READY; Astra one remaining precision finding,
  amended in iteration 3.

## Verification

**Commands:**

- `cd apps/api && NODE_OPTIONS=--conditions=development npx vitest run src/modules/location-preferences src/modules/weather` -- expected: pass.
- `cd apps/api && INTEGRATION_TEST_DATABASE_URL=<isolated db> LOCATION_PREFERENCES_REAL_DB_INTEGRATION=true NODE_OPTIONS=--conditions=development npx vitest run integration/location` -- expected: pass; fails, never skips, on a schema probe failure in CI.
- `npm exec -w apps/web -- vitest run src/i18n` and `npm exec -w apps/mobile -- vitest run src/i18n` -- expected: pass.
- `npm run test:pact` and `npm run optic:diff` -- expected: pass.
- `npx playwright test playwright/tests/location-capture.spec.ts` -- expected: pass with axe clean.
- `node scripts/run-maestro.mjs maestro/location-capture.yaml` -- expected: pass on Android and iOS.
