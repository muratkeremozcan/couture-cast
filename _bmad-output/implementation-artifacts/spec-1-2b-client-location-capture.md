---
title: 'Story 1.2b: Client location capture'
type: 'feature'
created: '2026-10-22'
status: 'in-progress'
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
