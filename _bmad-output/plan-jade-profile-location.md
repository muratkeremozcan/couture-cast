---
title: 'Jade follow-up: Profile tab, Use my location, and the web Locations session race'
type: 'bugfix'
ticket: ''
created: '2026-11-19'
status: 'built'
baseline_revision: 'f913ce6f2c62f760ac5529a67cbcdf24a3729de4'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'codex']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Jade (new web member, 2026-11-19) could not find a profile, got "City search is temporarily unavailable" three times on /settings, and the app never offered to use her location. City search failed because the production API had no weather provider keys (fixed in infra, see Implementation Notes); a reload of /settings also shows "Sign in to manage your locations" to a signed-in member because LocationsSection checks the session once, before web-session re-stores the token.

**Approach:** Rename the Settings tab to Profile on web and mobile with an account header; add a "Use my location" action that asks for permission only on tap, resolves the device position to a city on the API, and saves through the existing signed-candidate path; make the web Locations section follow session changes and fetch once per load.

## Boundaries & Constraints

**Always:** permission is requested only when the member taps Use my location; denial, timeout, unsupported device or API failure leaves manual city search working with clear localized copy; only the resolved city (provider place coordinates) is stored; raw device coordinates are rounded to 2 decimals on the client, sent only in a POST body, never logged, never stored, never in analytics; every new string is localized in all ten locales with parity tests; everything Settings had stays reachable; /settings stays the route (Profile is the label and title).

**Decision (coordinator, 2026-11-19):** the 2-decimal coordinates may reach OpenWeather/WeatherAPI in their GET query string, since both providers only take query parameters; they stay out of our own URLs, logs, events, DB and trace spans. Outbound query strings are redacted in `apps/api/src/instrumentation.ts` with a test that fails on a full URL; the request logger and error reporting (PostHog exceptions, console) are checked for the same leak. After the redaction deploys, rotate the OpenWeather and WeatherAPI keys.

**Never:** no background location, no precise/fine location permission (Android coarse only, iOS when-in-use), no coordinates in URLs, query strings, logs, PostHog events or error messages; no change to the from-search save contract, the candidate token format, ritual ranking or weather ingestion.

## I/O & Edge-Case Matrix

| Scenario                           | Input / State                                                                        | Expected Output / Behavior                                  | Error Handling                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------- |
| Reverse hit                        | POST /api/v1/locations/from-coordinates `{latitude:41.88, longitude:-87.63, locale}` | 200 `{data:[candidate]}` same shape as search, token signed | N/A                                                      |
| Out of range                       | latitude 91 or non-number                                                            | No provider call                                            | 400 invalid_request                                      |
| Provider down or unconfigured      | geocoder throws                                                                      | No candidate                                                | 503 provider_unavailable, member sees manual search copy |
| No place                           | provider returns []                                                                  | 200 `{data:[]}`                                             | UI says no city found, manual search stays               |
| Permission denied                  | browser/OS denies                                                                    | No API call                                                 | Localized denial copy, search input focused/usable       |
| Geolocation unsupported or timeout | no `navigator.geolocation` / timeout                                                 | No API call                                                 | Localized unavailable copy                               |
| Rate limit                         | over shared search limit                                                             | 429 with Retry-After                                        | Same handling as search                                  |
| Signed-in reload of /settings      | token re-stored after verify                                                         | Section reaches ready, exactly one GET /api/v1/locations    | load_failed path unchanged                               |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/location-preferences/location-preferences.controller.ts:105-155` -- search and from-search handlers; add `@Post('from-coordinates')` beside them.
- `apps/api/src/modules/location-preferences/location-capture.service.ts:139-195` -- `search()`: rate limit, secret check, geocoder call, candidate loop; extract the candidate loop and reuse for reverse. `recordSearchFailure` analytics carries platform/outcome only.
- `apps/api/src/modules/weather/providers/location-geocoding.ts:17-29` -- `GeocodedPlace`, `ILocationGeocoder` (add `reverse(lat, lon, language, signal)`).
- `apps/api/src/modules/weather/providers/openweather-geocoding.client.ts` -- `/geo/1.0/direct`; reverse uses `/geo/1.0/reverse` with the same entry schema and mapping.
- `apps/api/src/modules/weather/providers/weatherapi-geocoding.client.ts` -- `search.json?q=lat,lon` serves reverse.
- `packages/api-client/src/contracts/http/locations.ts:142-200,246-252,311` -- add `locationsFromCoordinatesInputSchema` (strict, finite ranges) reusing `locationSearchResponseSchema`; register route.
- `apps/web/src/app/components/locations/locations-section.tsx:50,80-92,190-194` -- one-shot `hasWebSession()`; subscribe to `couture:session` (see `community-lookbook-grid.tsx:2683-2697`) or await `resolveWebSessionToken()` (`apps/web/src/lib/web-session.ts:223`); exactly one list fetch per load.
- `apps/web/src/app/components/locations/location-search-form.tsx:91,155` and `apps/web/src/lib/locations.ts:128,144` -- web search/save; add Use my location here.
- `apps/mobile/src/features/locations/locations-screen.tsx:175,238`, `apps/mobile/src/lib/locations.ts:134,153` -- mobile equivalents.
- `apps/web/src/app/components/sticky-bottom-nav.tsx:20-23` -- hardcoded English labels; localize all four, settings becomes Profile.
- `apps/web/src/app/settings/page.tsx:28-50` -- title `settings.title`; add account header from `getUserProfileFromWeb` (`apps/web/src/lib/user.ts`), `displayName ?? email`.
- `apps/mobile/app/(tabs)/_layout.tsx:54-57,189-197`, `apps/mobile/app/(tabs)/settings.tsx` -- tab label, header.
- `apps/mobile/app.json:19,31-36,42-80,90-100`, `apps/mobile/locales/*.json` -- expo-location plugin, iOS when-in-use string localized, Android fine location blocked.
- i18n: `apps/web/src/i18n/locales/*.json`, `apps/mobile/assets/locales/*.json`, parity specs `apps/{web,mobile}/src/i18n/*-locales.spec.ts`; `apps/mobile/src/screens/localization.test.tsx` asserts `tabs.settings`.
- Maestro flows tapping the Settings tab: `maestro/story65/open-settings-tab.yaml` and others found by `git grep -ln Settings -- maestro`.
- TEA-owned, do not edit: `playwright/tests/settings-locations-real-session.spec.ts`, `scripts/e2e-real-session/harness.mjs`, its harness spec; `playwright/tests/api/location-search.api.spec.ts`.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/api-client/src/contracts/http/locations.ts` -- from-coordinates input schema and route -- shared contract; rebuild dist.
- [ ] geocoding clients + `location-geocoding.ts` -- `reverse()` on both providers, unit specs with fetch doubles -- provider parity.
- [ ] `location-capture.service.ts` + controller -- `fromCoordinates()` sharing rate limit, secret check and candidate loop; no coordinate in logs or events; specs incl. log/analytics redaction assertions.
- [ ] `locations-section.tsx` + test -- session subscription, single fetch -- the race.
- [ ] web Use my location in the search form + `lib/locations.ts` -- getCurrentPosition on tap only, low accuracy, round to 2 dp, show candidates through the existing pick-and-save flow; vitest for denied/unsupported/timeout/503.
- [ ] mobile: add `expo-location` via `npx expo install`, app.json plugin and blocked fine permission, Use my location in `locations-screen.tsx` with `requestForegroundPermissionsAsync` on tap, `Accuracy.Lowest`; jest tests.
- [ ] web nav + settings page, mobile tab + settings screen -- Profile label/title, account header -- all strings in ten locales, parity specs, update `localization.test.tsx`, nav tests, Maestro flows.
- [ ] `location-capture.service.ts` `displayLabel` -- when the provider city name is entirely lowercase (seen live: "chicago, Mombasa County, Kenya"), upper-case the first letter of each word with the member's locale; leave mixed-case names untouched -- label polish from TEA's prod probe.
- [ ] `_bmad-output/project-knowledge/learning-path-step-by-step.md` -- "Production follow-ups after the project close" under Step 58 with test cross-links.

Working rules: never git stash, git checkout -- or git reset; never touch /Users/murat/opensource/cc/couture-cast; load the bmad-tea skill before editing any test; never run npx playwright without an isolated DATABASE_URL and PLAYWRIGHT_SKIP_DB_RESET=true; run tsc via `npm exec` per workspace (rebuild `packages/api-client` dist after the contract edit); do not commit.

**Acceptance Criteria:**

- Given a signed-in web member, when they open the app, then the bottom nav shows Profile and the page header shows their name or email above locations, premium, subscription and commerce sections.
- Given a member who taps Use my location and allows it, when the API resolves the city, then the city appears as a pick and saving it lists it under saved locations with no device coordinate persisted.
- Given any server log line, PostHog event or URL produced by the from-coordinates path, then it contains no latitude or longitude value.

## Implementation Notes

- 2026-11-19 infra: couture-cast-api on Vercel had no `OPENWEATHER_API_KEY`, `WEATHERAPI_API_KEY` or `WEATHER_PROVIDER_MODE` in any target, so `OpenWeatherGeocodingClient` threw `invalid_configuration` (PostHog `location_search_failed` outcome `provider_unconfigured`, Jade 7:40-7:41 CT). Set all three on production and preview from `.env.prod`/`.env.preview` (keys Sensitive), redeployed production (aliased couture-cast-api.vercel.app) and preview couture-cast-lcxry2btw. TEA red: `playwright/tests/api/location-search.api.spec.ts` 503 on preview before the change.

## Plan Change Log

## Review Triage Log

Round 1 (quick lens + Codex early finding + TEA unit review). Verdicts: high 1, medium 5, low 3, false 1.

- high, patch: outbound fetch spans (undici auto-instrumentation) export url.full and url.query to Grafana in prod; reverse calls put lat/lon there, and every provider call already leaks the OpenWeather appid and city search text. Confirmed in node_modules/@opentelemetry/instrumentation-undici/build/src/undici.js:177-179 and GRAFANA_OTLP_ENDPOINT set on all API targets. Fix: startSpanHook overrides url.full/url.query without the query; same for outgoing http; test fails on a full URL. Coordinator: rotate both provider keys after deploy.
- medium, patch: in-app copy still says "Settings" (sponsored links, Subscribe to Premium, terms billing portal) in all ten locales on web and mobile, asserted by maestro/palette-advisor.yaml:112 and playwright/tests/palette-advisor.spec.ts:213.
- medium, patch: use-web-session treats a rejected verification (5 s profile timeout, cold start) as settled, so a signed-in member with a stored session sees signed_out with no retry (web-session.ts verifySession clears the bearer on changed and rethrows).
- medium, patch: Use my location does not yield to typing (web location-search-form onChange never aborts locateRef; mobile onChangeText never bumps locateAttemptRef), so a late nearby city replaces the typed query's results.
- medium, patch: web locateMe is not blocked while a save is in flight (mobile is), clearing selected and breaking Try again.
- medium, patch: mobile has no parity spec for tabs.profile and settings.account.label; localization.test.tsx misses en-CA, es-419, fr-FR; settings.tsx calls t('settings.account.label') without defaultValue.
- low, patch: home header nav-profile link text is hardcoded English; nav.profile exists.
- low, patch: learning path Step 58 says analytics keeps one English label (true on web only; mobile trackTabPress gets the localized label as before) and lists a node:test file under mobile Vitest.
- low, patch (TEA): device-position.test.ts LOC-POS-WEB-01 title uses %d; mobile ULM-MOB-01 asserts accuracy 1 instead of Location.Accuracy.Lowest. TEA is making these edits.
- false: TEA-owned files in the diff were authored by profile-tea (it reported creating them and bumping the harness count).

Round 1 Codex (/Users/murat/opensource/cc/jade-issues/profile-codex-review-1.md), merged with the quick lens above. Verdicts: high 3, medium 3, low 3.

- C1 high, patch (partial): provider query carrying the rounded position is accepted by the coordinator; the trace export is fixed above; privacy page (apps/web/src/app/privacy/page.tsx:118) must disclose that Use my location sends an approximate position (about 1 km) to the weather provider. Local-dataset alternative rejected by coordinator decision.
- C2 high, patch: locations-section reloads after save/rename/delete (lines ~128, ~176) and the status message are not owner-scoped; a late response can show member A's places to B or after sign-out. Fix: an owner generation ref checked by every async completion; clear list, status and form state on owner change.
- C3 high, patch: same as quick-lens verification rejection; Codex reproduced checking -> signed_out.
- C4 high, patch: iOS prompt defaults to precise; set NSLocationDefaultAccuracyReduced true in app.json infoPlist and assert it.
- C5 medium, patch: same as quick-lens typing vs locate.
- C6 medium, TEA: real-session spec counts responses only through first ready; TEA owns the fix.
- C7 low, patch: same as quick-lens hardcoded header link; add a non-English assertion.
- C8 low, patch: same as quick-lens Settings copy.
- C9 low, patch: Step 58 overstates; attribute the reload symptom to our reproduction, name outcome provider_unconfigured and that the deployed search spec skips prod (prod verified by a manual Chrome probe).

Round 3 Codex (/Users/murat/opensource/cc/jade-issues/profile-codex-review-3.md, product at b394c455). Verdicts: high 2, medium 6, low 1.

- R3-1 high, patch: mobile locate not bound to the member (identity epoch); A's position can go under B's bearer.
- R3-2 high, patch: use-web-session accepts any leftover sessionStorage bearer as the fixture; restrict to the E2E flag plus test-token prefix.
- R3-3 medium, patch: rename/delete completion after an owner switch writes B's UI and reloads as B before checking ownership.
- R3-4 medium, patch: profile 401/403/404 loops on Try again; denial must mean signed_out.
- R3-5 medium, patch: Express JSON parse errors forward body-derived text; normalize to a fixed 400 for all routes.
- R3-6 medium, patch: Vercel api/index.ts never starts the OTel SDK (only src/main.ts and src/workers/bootstrap.ts), so the trace claim is scoped to the standalone API and the hosted workers; weather ingestion on the workers still sends the OpenWeather key in its query, so the redaction and key rotation stand.
- R3-7 medium, patch: privacy page must name WeatherAPI too and say CoutureCast stores only the picked place.
- R3-8 medium, TEA: native flow state requires rounded values to equal the injected Maestro fix, which reduced accuracy can change.
- R3-9 low, patch: Step 58 anchors and "every city search" wording.

Coordinator decision (2026-11-19, after product round 8): member-owned UI is keyed by the signed-in member (S1) and operations pin the owner, not the bearer (S2). Fix the two user-facing bugs (third save loses its confirmation and focus; Locations stuck loading when sign-in lands mid-mount) with tests, run one Codex round on the structural change, address it, then report ready for PR. Findings outside this change go to the report as follow-ups.

Final structural review (Codex, /Users/murat/opensource/cc/jade-issues/profile-codex-review-9.md, a06be412): no production or security blocker. Five in-change test-coverage items, all fixed (c842e5d3, d6145dfd); the credentials comment follow-up fixed in d6145dfd. Nothing deferred.

## Design Notes

POST with body keeps coordinates out of Vercel request logs and browser history. The client rounds to 2 decimals (about 1 km) to match the PRD's "approximate" auto-detect. The candidate the API returns carries the provider's place coordinates, which the existing from-search save already stores, so the save path and token stay unchanged.

## Verification

**Commands:**

- `npm exec --workspace apps/api -- tsc --noEmit -p tsconfig.json`, same for apps/web, apps/mobile, packages/api-client -- expected: no errors besides known symlink TS2742.
- `npm exec --workspace apps/api -- vitest run src/modules/location-preferences src/modules/weather/providers` -- expected: pass.
- `npm exec --workspace apps/web -- vitest run src/app/components/locations src/app/components/sticky-bottom-nav.test.tsx src/app/settings src/i18n` -- expected: pass.
- `npm exec --workspace apps/mobile -- jest src/features/locations src/screens/localization.test.tsx src/i18n` -- expected: pass.
- `REDIS_URL=redis://127.0.0.1:6390 npm run test:pw-real-session -- playwright/tests/settings-locations-real-session.spec.ts` (isolated DB, PLAYWRIGHT_SKIP_DB_RESET=true) -- expected: PL-1, PL-2 green.
