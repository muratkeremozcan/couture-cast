---
baseline_commit: e7e94a756051fe3be327818d2244eeb061b15382
status: in-progress
---

<!-- markdownlint-disable MD013 MD024 MD036 -->

# Story 5.5: Premium 7-day outfit planner

Status: in-progress

**Story key:** `5-5-premium-7-day-outfit-planner`
**Epic:** 5, Commerce & Premium Enhancements, Phase 2
**Baseline commit:** `e7e94a75` on `feat/epic5-story5`
**Prepared:** 2026-09-04

## Story

As a Premium subscriber,
I want to preview outfits for the week
so that I can plan ahead.

Source: `_bmad-output/planning-artifacts/epics.md:456-463`.

## Source contract and scope

| Source requirement                                                 | Story coverage         |
| ------------------------------------------------------------------ | ---------------------- |
| Seven scrollable daily cards with a scenario summary per day       | AC 1, AC 2, AC 3       |
| Reshuffle recommendations while respecting wardrobe availability   | AC 4                   |
| Premium entitlement gate and analytics                             | AC 5, AC 6             |
| PRD daily weather ingestion and graceful degradation               | AC 2                   |
| Project localization, accessibility, RLS, flag, and contract rules | AC 5, AC 7, AC 8, AC 9 |

The epic's "scenario summary" and prerequisite CC-2.1 establish three scenarios per day:
`morning`, `midday`, and `evening`.
The PRD's shorter phrase, "an outfit per day," describes the weekly feature at summary level.

This story delivers the generated seven-day planner, per-day reshuffle, web drawer, and mobile
screen.
Calendar sync, manual slot editing, share/export, planner widgets, watch surfaces, whole-week
reshuffle, occasion selection, and planner affiliate CTAs remain deferred.

## Acceptance Criteria

1. **Seven consecutive local dates.** An authenticated Premium user can fetch a planner window for
   an owned saved location.
   The service resolves the requested `locationId`, then the user's primary or first saved location.
   The anchor follows the existing ritual cutoff: the current local date before 08:00, then the next
   local date from 08:00 onward.
   The response contains exactly seven unique, consecutive `YYYY-MM-DD` dates in chronological order.
   Every ready date contains exactly one `morning`, `midday`, and `evening` outfit.
   Calendar arithmetic operates on date-only values, so daylight-saving transitions cannot skip or
   duplicate a date.

2. **Weather-aware generation with honest degradation.** The planner uses exact 08:00, 13:00, and
   19:00 hourly segments when all three exist for a date.
   It uses the provider's daily summary through the projection in Decision 3 when hourly coverage is
   incomplete.
   Cached or stale summaries remain usable and carry visible freshness metadata.
   A date with no usable weather still receives a wardrobe and comfort-preference baseline with
   `confidence: 'unavailable'` and no weather-derived badge or precision claim.
   Provider failure continues through the existing retry, failover, and last-known snapshot path.

3. **Two usable surfaces with isolated day failures.** Web replaces the static `PlannerRail` cards
   with the live seven-date response.
   The planner opens from an ordinary Plan week control at every supported web viewport.
   Mobile adds a dedicated planner route and settings entry.
   Initial load uses a week skeleton.
   The wire contract represents each date as `ready` or `error`, so a failed date leaves every ready
   date visible.
   Reshuffle loading and error state belong to the affected date.

4. **Atomic per-day reshuffle.** Each ready card has one reshuffle control.
   A reshuffle regenerates only that date and prefers capsules and garments absent from the current
   result.
   When a fully disjoint result is unavailable, the engine maximizes changed slots.
   The response sets `unchanged: true` only when the three scenario garment sets and capsule choices
   are identical.
   The request carries the displayed plan version.
   A concurrent update returns `409 PLANNER_DAY_CHANGED_MESSAGE`; the client refreshes that date.
   The three scenarios, version, source, and reshuffle count change atomically.

5. **Ordered access and availability gates.** `RequestAuthGuard` and
   `PremiumEntitlementGuard` protect GET and reshuffle.
   Missing or invalid authentication returns `401`.
   An authenticated caller without Premium returns `403 PREMIUM_REQUIRED_MESSAGE`.
   An entitled caller reaches the `premium_planner_enabled` check and receives
   `503 PREMIUM_PLANNER_DISABLED_MESSAGE` when the flag is off.
   The clients classify and localize all three outcomes.

6. **Pseudonymous usage analytics.** Successful GET requests emit `premium_planner_viewed` with
   `{ platform, daysReady }`.
   Successful reshuffles emit `premium_planner_day_reshuffled` with
   `{ platform, dayOffset, unchanged }`.
   `platform` comes from the required, contract-declared `x-couture-platform` header.
   `dayOffset` is an integer from 0 through 6.
   Both events use `TelemetryService`, strict property allowlists, HMAC subject IDs, negative
   fixtures, and registry set-equality checks.
   The clients fetch once per explicit open or screen focus and perform no planner polling.

7. **Localized, themed, accessible interaction.** All planner copy, weekday/date formatting,
   weather conditions, units, locked state, loading, retry, errors, and reshuffle announcements work
   in the ten existing locales on both surfaces.
   Temperature remains Celsius in the contract and converts at the display boundary.
   Both surfaces consume the existing premium theme tokens.
   Interactive targets are at least 44 by 44 pixels.
   Keyboard order follows date order and each scenario's visual order.
   The web drawer restores focus to its opener and traps focus only while rendered as an overlay.
   Busy state prevents double activation.
   Polite live regions announce success and no-alternative outcomes; errors use alert semantics.
   Automated checks target WCAG 2.2 AA.
   Native evidence includes semantic component assertions plus manual VoiceOver and TalkBack checks.

8. **Owner isolation and bounded retention.** `PlannerDayPlan` is owner-only in RLS and passes the
   full actor matrix.
   Every non-starter garment and capsule referenced by a stored plan is owned by the acting user and
   remains eligible.
   Account deletion and saved-location deletion cascade to planner rows.
   Reads prune the acting user's rows before the current anchor date and malformed stored payloads.
   Cleanup helpers and factories include the new table.

9. **Stable cached results with explicit invalidation.** An unchanged dependency fingerprint returns
   the persisted day without running generation again.
   The fingerprint covers location, weather snapshot revision, comfort preferences, locale, the
   sorted eligible wardrobe inputs, and capsule revision.
   Any change regenerates the affected ready dates before response.
   A deleted or newly ineligible garment can never remain in a returned plan.
   Concurrent cold reads may compute twice, while the unique key permits one persisted winner and all
   callers return that winner.

## Implementation decisions

### Decision 1: Extract one locale-aware generation engine

`RitualService.getOrCreateRitual` currently combines location resolution, date selection, Redis and
database caching, weather selection, garment loading, capsule scoring, generation, persistence, and
presentation.
Extract the pure generation path into
`apps/api/src/modules/personalization/ritual-generation.engine.ts`.

The engine accepts:

- acting user id;
- explicit target local date;
- locale;
- comfort preferences;
- eligible garments and capsules;
- three `ScenarioWeatherInput` values or an unavailable-weather marker;
- optional capsule and garment exclusions.

The engine returns three canonical scenario results.
It keeps the current comfort thresholds, capsule scoring, starter-wardrobe fallback, reasoning badge
rules, and deterministic ordering.
`RitualService` retains its current cache and `OutfitRecommendation` persistence wrapper.
Its existing test suite must pass without assertion changes.

The planner calls the engine directly for each date.
Calling `getOrCreateRitual` seven times is outside the design because its cache and persistence identity
represent one ritual date and one forecast segment.

### Decision 2: Resolve location, date, and freshness once

Add pure helpers beside the engine:

```ts
resolveRitualAnchorDate(now: Date, timezone: string): string
resolvePlannerDateWindow(anchorDate: string): readonly [string, string, string, string, string, string, string]
toDatabaseDate(localDate: string): Date
```

`resolvePlannerDateWindow` performs UTC date-part arithmetic on validated date-only strings.
`toDatabaseDate` stores the local calendar label as UTC midnight in the Prisma `@db.Date` field.
Clients format `planDate` as a date-only value through an explicit UTC formatter.
They never pass it through an implicit local `Date` constructor.

GET accepts optional `locationId` and `locale`, following the ritual contract.
The service validates location ownership and resolves its IANA timezone.
Reshuffle accepts the same optional `locationId` so its unique identity matches GET.
The response returns the resolved location id and timezone.

The engine input builder computes a SHA-256 dependency fingerprint from canonical, sorted inputs.
Raw ids stay server-side.
The stored locale joins the fingerprint because current comfort notes are localized during generation.

### Decision 3: Add daily weather without changing the hourly contract

Extend the provider and normalized schemas with an optional daily array of at most eight entries.
Each normalized entry uses a validated local `YYYY-MM-DD` date and contains:

```ts
{
  localDate: string
  condition: WeatherCondition
  temperatureMin: number
  temperatureMax: number
  feelsLikeMin?: number
  feelsLikeMax?: number
  precipitationProbability: number
  precipitationAmount: number
  windSpeed: number
}
```

OpenWeather One Call 3.0 returns eight daily forecasts in the same current and forecast response.
Remove `daily` from its `exclude` parameter and map `temp`, `feels_like`, `pop`, rain or snow totals,
wind, and condition.

WeatherAPI accepts a `days` value from 1 through 14, with plan-dependent depth.
Add validated `WEATHERAPI_FORECAST_DAYS`, defaulting to the currently safe value `3` and capped at `8`.
Set deployed environments to `8` only after confirming the provisioned plan.
Map every returned `forecastday.day` entry.
The provider still makes one request per scheduled refresh.
Shorter responses remain valid and leave uncovered dates unavailable.

Persist the daily array in nullable `WeatherSnapshot.daily_summaries Json?`.
Serialize dates as strings and parse database JSON with the canonical Zod schema on every read.
Malformed entries are discarded and logged without taking down hourly weather.
The current 48-hour `hourly` schema, `ForecastSegment`, refresh cadence, failover, and alert paths keep
their existing behavior.

Build the scenario weather inputs as follows:

| Available source     | Morning           | Midday            | Evening                         | Confidence    |
| -------------------- | ----------------- | ----------------- | ------------------------------- | ------------- |
| Complete hourly date | 08:00 segment     | 13:00 segment     | 19:00 segment                   | `hourly`      |
| Daily summary        | minimum           | maximum           | midpoint of minimum and maximum | `daily`       |
| No usable summary    | wardrobe baseline | wardrobe baseline | wardrobe baseline               | `unavailable` |

For daily inputs, use provider feels-like bounds when present and temperature bounds otherwise.
Use the daily wind and precipitation fields for all three scenarios and label their reasoning as daily
summary evidence.
The unavailable branch selects a deterministic all-season base from eligible wardrobe or starter
items, applies the user's general run-cold or run-warm preference, and emits zero weather badges.

Official references:

- [OpenWeather One Call 3.0](https://openweathermap.org/api/one-call-3)
- [WeatherAPI forecast parameters and fields](https://www.weatherapi.com/docs/)
- [WeatherAPI plan forecast depth](https://www.weatherapi.com/pricing.aspx)

### Decision 4: Persist one atomic plan per user, location, and date

Use one disposable cache row per daily card.
The JSON payload follows an internal strict Zod schema and is parsed on every read.

```prisma
enum PlannerOutfitSource {
  generated
  reshuffled
}

model PlannerDayPlan {
  id                     String               @id @default(cuid())
  user                   User                 @relation(fields: [user_id], references: [id], onDelete: Cascade)
  user_id                String
  location               SavedLocation        @relation(fields: [location_id, user_id], references: [id, user_id], onDelete: Cascade, onUpdate: NoAction)
  location_id            String
  plan_date              DateTime             @db.Date
  locale                 String
  dependency_fingerprint String
  plan_payload           Json
  source                 PlannerOutfitSource  @default(generated)
  version                Int                  @default(1)
  reshuffle_count        Int                  @default(0)
  generated_at           DateTime             @default(now())
  created_at             DateTime             @default(now())
  updated_at             DateTime             @updatedAt

  @@unique([user_id, location_id, plan_date])
  @@index([user_id, plan_date])
  @@map("PlannerDayPlan")
}
```

Add `SavedLocation @@unique([id, user_id])` plus the `User` and `SavedLocation` back-relations.
The migration mirrors the owner grant and policy block used by `PaletteProfile`.
Schema tests pin grants, policies, unique keys, and both cascades.

The stored payload contains scenario, garment ids, reasoning badges, comfort notes, capsule id and
name, auto-filled garment ids, starter-wardrobe marker, and weather summary.
It omits signed image access and affiliate offers.
The response layer performs one batched lookup for all real garment ids and adds category plus fresh
image access metadata.
Every planner scenario returns `shopThisLook: null`.
This preserves the shared scenario contract while keeping planner affiliate behavior outside scope.

GET validates the stored payload, dependency fingerprint, and ownership of all real garment and
capsule ids.
Invalid rows are deleted and regenerated.
Cold-read races resolve through the unique key and loser reread pattern already used by ritual
recommendations.

Reshuffle accepts `{ expectedVersion }`.
The service generates against the current row, then updates with a version predicate inside a
transaction.
Zero updated rows produce the documented `409`.

### Decision 5: Publish a partial-week contract

Create `packages/api-client/src/contracts/http/planner.ts` first.
Register it in the HTTP barrel and OpenAPI registry, then bump the additive API version from `1.4.0`
to `1.5.0`.

GET contract:

```ts
query: { locationId?: string; locale?: SupportedLocale }
headers: { 'x-couture-platform': 'web' | 'mobile' }
data: {
  locationId: string
  timezone: string
  anchorDate: string
  daysReady: number
  days: PlannerDayResult[7]
}
```

`PlannerDayResult` is a discriminated union:

- `ready`: `planDate`, `version`, weather summary, starter-wardrobe marker, and exactly three distinct
  scenario outfits;
- `error`: `planDate`, `errorCode: 'generation_failed'`, and `retryable: true`.

The seven-item response schema uses `.min(7).max(7)` plus refinements for unique consecutive dates and
chronological order.
The ready outfit collection uses `.min(3).max(3)` plus distinct-scenario validation.
`plannerScenarioOutfitSchema` extends `scenarioOutfitSchema` with display garment descriptors and
constrains `shopThisLook` to `null`.

Reshuffle contract:

```ts
params: { planDate: 'YYYY-MM-DD' }
query: { locationId?: string; locale?: SupportedLocale }
headers: { 'x-couture-platform': 'web' | 'mobile' }
body: { expectedVersion: number }
data: { day: PlannerReadyDay; unchanged: boolean }
```

Validate real calendar dates, location ownership, current-window membership, and version before
mutation.
Publish `400`, `401`, `403`, `409`, `500`, and `503` response schemas as applicable.
Controllers parse every success response through the published schema.
Run `npm run generate:api-client` and `npm run optic:lint`; generated files remain generator-owned.

### Decision 6: Keep the dependency direction acyclic

Place `PlannerController`, `PlannerService`, and `RitualGenerationEngine` in
`apps/api/src/modules/personalization/`.
Register them in `PersonalizationModule`.

`PersonalizationModule` already imports `CommerceModule`, which exports the entitlement guard.
Add direct imports of `FeatureFlagsModule` and `TelemetryModule` because `CommerceModule` does not
export their providers.
Preserve the existing `AnalyticsModule`, weather, location, Prisma, auth, and Redis wiring.

Use `@Controller('api/v1/commerce/premium/planner')`.
The commerce-prefixed path inherits `CommerceCacheHeadersMiddleware` and its
`Cache-Control: private, no-store` behavior even though the controller belongs to
`PersonalizationModule`.
Add a short controller comment recording that dependency decision.
Update the stale `PremiumEntitlementGuard` comment that still calls Story 5.5 its first production
consumer.

### Decision 7: Make the web and mobile surfaces reachable

Web keeps `PlannerRail` as the planner component.
Default it closed and add an ordinary Plan week control near the hero actions.
At 1440 pixels and wider, render it as the third-column rail from the UX specification.
Below 1440 pixels, render the same component as an overlay drawer or full-height sheet.
Track the opener and restore focus on close.

Replace the boolean entitlement prop with `checking | entitled | locked | error`.
`checking` renders a neutral skeleton, and `error` offers a localized retry.
Fetch the planner only after entitlement resolves to `entitled`.
Abort an in-flight request when the drawer closes.

Mobile adds:

- `apps/mobile/app/planner.tsx` as the thin Expo Router route;
- `apps/mobile/src/features/premium/planner-screen.tsx`;
- `apps/mobile/src/lib/planner.ts`;
- a Premium settings row with link role, accessible label, and stable test id.

Both clients use the generated contract types and existing auth/base URL helpers.
Mobile reuses `withRequestTimeout` from `apps/mobile/src/lib/commerce.ts`.
No new UI, state, date, or data-fetching dependency is needed.

### Decision 8: Follow existing analytics, flag, locale, and theme registries

Add `premium_planner_enabled` to `packages/config/src/flags.ts` with registry default `false`.
Seed it `true` in eligible local and preview environments.
Update the flag registry and service specs.

Register both analytics events at the seven points documented by Story 5.4:

1. event name enum;
2. event input schema;
3. event schema map;
4. strict provider-property schema and builder;
5. analytics assertion registry;
6. both `TelemetryService` input maps;
7. pseudonymous membership and builder maps.

Add `commerce.premium.planner.*` to all ten catalogs on web and mobile.
The subtree covers section and day labels, conditions, weather confidence and freshness, scenario
labels, starter wardrobe, open, close, loading, retry, reshuffle states, disabled state, error state,
and live announcements.
Add `commerce.premium.plannerLocked.*` to mobile and remove its stale deliberate-absence exclusion.
Each surface gets a dedicated planner parity spec and excludes the planner subtree from its parent
premium parity spec.

Both surfaces use existing semantic premium theme tokens and high-contrast behavior.
Hardcoded planner colors stay confined to legacy code removed during this story.

## Prerequisites

- CC-2.1: scenario recommendation and weather matching, done.
- CC-2.2: comfort calibration and invalidation behavior, done.
- CC-5.2: Premium entitlement service, guard, and client status helpers, done.
- CC-4.1 through CC-4.3: eligible wardrobe items and capsules, done.
- CC-5.3 and CC-5.4: premium theme, locale parity, analytics registry, and RLS conventions, done.

## Tasks / Subtasks

- [x] **Task 1: Daily weather ingestion and persistence** (AC 2, 9)
  - [x] Add normalized and provider daily schemas with strict range and date validation.
  - [x] Map OpenWeather daily data and remove it from `exclude`.
  - [x] Add safe, configurable WeatherAPI forecast depth and map returned daily summaries.
  - [x] Add `WeatherSnapshot.daily_summaries`, migration, repository serialization, and guarded read parsing.
  - [x] Preserve all hourly, failover, freshness, alert, and refresh behavior in existing tests.

- [x] **Task 2: Shared generation engine** (AC 1, 2, 4, 9)
  - [x] Extract the locale-aware generation core and date helpers from `RitualService`.
  - [x] Add hourly, daily-projection, and unavailable-weather adapters.
  - [x] Add exclusion and deterministic fallback behavior.
  - [x] Keep `ritual.service.spec.ts` assertions unchanged and green.
  - [x] Test DST boundaries, leap day, month and year end, daily projection fields, unavailable weather, and exclusions.

- [x] **Task 3: Planner schema, RLS, factories, and cleanup** (AC 8, 9)
  - [x] Add `PlannerOutfitSource`, `PlannerDayPlan`, relations, indexes, and migration.
  - [x] Mirror owner-only grants and policies; add schema and actor-matrix tests.
  - [x] Extend `selfOnlyTables`, `SeededScenario`, seed cleanup, testing factories, public exports, registry, and global cleanup.
  - [x] Test cascades, cross-user denial, authenticated owner insert, and malformed payload cleanup.

- [x] **Task 4: Contracts and generated client** (AC 1, 3, 4, 5)
  - [x] Create the strict GET and reshuffle contracts from Decision 5.
  - [x] Add exact collection invariants, message constants, the API contract bridge export, and all error responses.
  - [x] Register the contract, bump OpenAPI to `1.5.0`, regenerate the client, and run Optic.
  - [x] Add contract tests for duplicate dates, duplicate scenarios, invalid dates, missing platform, and non-null planner affiliate data.

- [x] **Task 5: Flag and analytics registries** (AC 5, 6)
  - [x] Add `premium_planner_enabled` to all four flag touchpoints.
  - [x] Add both analytics events to all seven registration points.
  - [x] Add strict negative fixtures and registry set-equality tests.

- [x] **Task 6: Planner API** (AC 1 through 6, AC 8, AC 9)
  - [x] Add `PlannerService` with owned-location resolution, window calculation, fingerprinting, partial-day generation, pruning, and batched garment enrichment.
  - [x] Add atomic, versioned reshuffle with preference exclusions and `unchanged` calculation.
  - [x] Register controller, service, engine, direct flag module, and direct telemetry module imports.
  - [x] Parse success payloads through contracts and preserve private no-store headers.
  - [x] Test gate order, flag off, partial success, stable reread, invalidation, cold-read races, transactional rollback, version conflicts, location switching, and cross-user input.

- [x] **Task 7: Web planner** (AC 3, 5, 7)
  - [x] Add generated-client wrapper and failure classification.
  - [x] Add the normal Plan week control, closed default, responsive rail or overlay behavior, entitlement state machine, and request abort.
  - [x] Render exact seven-date results, starter wardrobe, weather freshness, per-date errors, and per-date reshuffle state.
  - [x] Update the existing layout and accessibility tests pinned to the static rail.
  - [x] Add component tests with MSW for all access, partial-week, retry, close, focus, and concurrency states.

- [x] **Task 8: Mobile planner** (AC 3, 5, 7)
  - [x] Add client wrapper, thin route, screen, and Premium settings link.
  - [x] Render the same contract states with `ScrollView`, themed tokens, 44-pixel controls, and live announcements.
  - [x] Add screen tests with MSW for locked, checking, entitlement error, ready week, partial week, retry, reshuffle, unchanged, conflict, and double-tap protection.
  - [x] Update existing settings rendering suites for the new router dependency and row.

- [ ] **Task 9: Localization and accessibility evidence** (AC 7)
  - [ ] Add the planner and mobile locked keys to all ten catalogs.
  - [ ] Add subtree parity and placeholder tests on both surfaces.
  - [ ] Add web axe checks at desktop and phone widths, signed out and entitled.
  - [ ] Record manual keyboard, VoiceOver, and TalkBack results in the story Dev Agent Record.

- [ ] **Task 10: Cross-boundary verification** (all ACs)
  - [ ] Add web and mobile Pact interactions for GET, partial GET, reshuffle, conflict, entitlement failure, and flag failure.
  - [ ] Add PostgreSQL integration tests for invalidation, pruning, race winner, location cascade, malformed JSON, and reshuffle conflict.
  - [ ] Add Playwright flow for open, week load, one-day reshuffle, reload persistence, partial-day retry, focus restore, and axe.
  - [ ] Add a Maestro locked-state and navigation flow with the established honest-scope header and duration entry.
  - [ ] Run changed-workspace tests, `npm run verify:changed`, root lint, root typecheck, Optic, Pact, integration, Playwright, and relevant Maestro tiers.
  - [ ] Record deferred UX features, WeatherAPI deployed depth, lack of planner affiliate CTAs, and explicit test limits in `deferred-work.md`.

## Test plan

| AC  | Merge-blocking evidence                                                       | Additional evidence                  |
| --- | ----------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Seven-date and three-scenario contract tests; DST helper tests; stable reread | Playwright chronological render      |
| 2   | Both provider mappers; daily projection; stale and unavailable branches       | Provider failover integration        |
| 3   | Web and mobile partial-week component tests                                   | Playwright partial retry             |
| 4   | Atomic reshuffle, exact unchanged calculation, version conflict               | Reload persistence                   |
| 5   | HTTP `401`, `403`, then entitled `503` ordering                               | Locked and disabled UI tests         |
| 6   | Seven-point registry equality and strict negative fixtures                    | Request-count semantics test         |
| 7   | Locale parity, responsive interaction, axe, semantic native tests             | Manual keyboard, VoiceOver, TalkBack |
| 8   | Schema grants, RLS actor matrix, cascades, cleanup                            | Account-erasure integration          |
| 9   | Fingerprint invalidation for weather, comfort, locale, wardrobe, capsule      | Concurrent cold-read integration     |

### Explicit test limits

The Maestro harness proves navigation and the locked state because its standard account lacks Premium.
Provider plan depth is covered through configured fixtures; production WeatherAPI entitlement remains an
operator verification.
Long-term pruning is tested at the window boundary and through cascades.
The story adds no k6 scenario because planner reads are Premium-only, user-scoped, and outside the
existing hot-path performance budget.

## Dev Notes

### Existing files that require full reads before modification

- `apps/api/src/modules/personalization/ritual.service.ts`: preserve location fallback, locale choice,
  Redis keys, stale dependency checks, test-environment weather self-healing, capsule scoring, starter
  garments, badge rules, persistence, and analytics behavior.
- `apps/api/src/modules/personalization/personalization.module.ts`: preserve the one-way import from
  personalization to commerce and existing Redis invalidator wiring.
- `apps/api/src/modules/weather/providers/openweather.provider.ts` and
  `weatherapi.provider.ts`: preserve the 48-hour contiguous hourly validation and one-call refresh path.
- `apps/api/src/modules/weather/providers/weather.schemas.ts`, `weather.types.ts`,
  `weather-provider.interface.ts`, `weather.repository.ts`, `weather-query.service.ts`, and
  `weather-ingestion.service.ts`: extend daily data additively and keep freshness unions stable.
- Both provider fixtures and specs: extend raw payloads and pin shorter daily responses.
- `apps/api/src/modules/commerce/premium-entitlement.guard.ts`: update its stale consumer comment while
  preserving `401` wiring-error and `403` entitlement behavior.
- `apps/web/src/app/components/planner-rail.tsx` and `lookbook-prism-layout.tsx`: replace the static data,
  make the planner reachable, preserve the responsive Lookbook layout, and retain signed-out access.
- `packages/api-client/src/contracts/http/ritual.ts`: reuse its scenario schema and collection invariant.
  Planner constrains `shopThisLook` to null and adds display garment descriptors.
- `packages/config/src/flags.ts`, both premium locale parity specs, all locale catalogs, RLS harness,
  testing registry and exports, and cleanup helpers: follow their current owner comments and ordering.

### Previous-story and git intelligence

Story 5.2 supplies the entitlement guard, client status helpers, and static locked web rail.
It identified the rail tests that must change when real planner data arrives.

Story 5.4 supplies the freshest owner-only schema, premium surface, locale subtree, generated contract,
strict analytics, MSW, Pact, Playwright, and Maestro patterns.
Its implementation review found missing generated headers, unreachable seeded journeys, duplicate test
ids, and UI timing races.
Apply those lessons while defining the contract and fixtures.

Relevant commits:

- `e7e94a75`: Story 5.4 implementation and current baseline.
- `0c348585`: Story 5.2 entitlement and planner-shell primitives.

### Project structure

New API files belong in `apps/api/src/modules/personalization/`.
New client wrappers belong at `apps/web/src/lib/planner.ts` and
`apps/mobile/src/lib/planner.ts`.
The mobile route remains thin, with screen behavior under `src/features/premium/`.
The canonical contract belongs in `packages/api-client/src/contracts/http/planner.ts`.
Migration files belong under `packages/db/prisma/migrations/`.
Generated API client files change only through the generator.

### References

- Epic 5 and Story 5.5: `_bmad-output/planning-artifacts/epics.md:414-463`.
- Sequencing: `_bmad-output/planning-artifacts/epics.md:547-566`.
- PRD planner and wardrobe availability: `_bmad-output/planning-artifacts/prd.md:163-181`.
- PRD daily weather: `_bmad-output/planning-artifacts/prd.md:152-160`.
- PRD scalability, accessibility, and failover: `_bmad-output/planning-artifacts/prd.md:244-280`.
- Architecture module and contract rules: `_bmad-output/planning-artifacts/architecture.md:101-126,144-204`.
- ADR-005 and ADR-015: `_bmad-output/planning-artifacts/architecture.md:232-248`.
- UX weekly planner: `_bmad-output/planning-artifacts/ux-design-specification.md:172-192`.
- Planner Day Card and accessibility: `_bmad-output/planning-artifacts/ux-design-specification.md:252-318,371-395`.
- Project implementation rules: `_bmad-output/project-context.md`.
- Previous stories: `_bmad-output/implementation-artifacts/5-2-premium-subscription-lifecycle.md` and
  `_bmad-output/implementation-artifacts/5-4-color-palette-beauty-accessory-advisor.md`.

## Open questions

None block implementation.
Confirm the deployed WeatherAPI plan before setting `WEATHERAPI_FORECAST_DAYS=8`.
Record the deployed value and manual native accessibility evidence in the Dev Agent Record.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (Tasks 1 through 8)

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed. Comprehensive developer guide created.
- Tasks 1 through 6 complete: daily weather ingestion, the shared `ritual-generation.engine.ts`
  extraction (zero assertion changes to the existing 50-test `ritual.service.spec.ts`), the
  `PlannerDayPlan` schema with owner-only RLS verified against an isolated Postgres instance, the
  `planner.ts` HTTP contract and generated client at OpenAPI `1.5.0`, the `premium_planner_enabled`
  flag and both planner analytics events across every registration touchpoint, and the
  `PlannerController` / `PlannerService` API surface itself.
- `GET /api/v1/commerce/premium/planner` and `POST /api/v1/commerce/premium/planner/:planDate/reshuffle`
  both live in `PersonalizationModule` behind `RequestAuthGuard` then `PremiumEntitlementGuard` (401,
  then 403, then per-day `generation_failed`/503 handling), require `x-couture-platform: web|mobile`,
  and parse every response through the published `plannerResponseSchema` /
  `plannerReshuffleResponseSchema` before it leaves the controller.
- Per-day generation failures degrade to that date's own `error` result (`generation_failed`,
  retryable) instead of failing the whole seven-day window; a stale or invalid stored row regenerates
  in place (update-by-id, not delete-then-create) so a mid-request failure cannot leave a date with no
  row at all.
- Reshuffle excludes the caller's disliked garment as a soft preference, not a hard filter: the engine
  falls back to an excluded garment only when it is the sole eligible option for a category, rather
  than forcing a starter-wardrobe placeholder over real wardrobe coverage.
- `npm run verify:changed`, root `npm run typecheck`, and root `npm run lint` are all green as of this
  record. `apps/api`'s own suite is 164 files / 2040 tests passing (3 skipped, unrelated to this
  story). Full command output is not reproduced here; rerun the three commands above to reverify.
- One pre-existing test outside this story's stated scope needed a fix as a direct consequence of Task
  5's new flag: `feature-flags.service.spec.ts` hardcoded the registry's key count (6) and the exact
  `upsertMany` payload; adding `premium_planner_enabled` made the registry's true size 7. Updated both
  assertions in that spec rather than leaving the suite red.
- Local Postgres migration authoring used `prisma migrate diff --from-schema-datamodel ... --to-schema-datamodel ... --script`
  against the schema files directly (no live database needed) to avoid pulling in unrelated drift from
  the shared local dev database, then hand-wrote each migration file from that clean diff.
- RLS policies for `PlannerDayPlan` were verified against an isolated `postgres:16-alpine` Docker
  container bootstrapped to match `.github/workflows/pr-checks.yml` exactly (roles, `auth.jwt()`,
  full migration history applied via `scripts/prisma-migrate-deploy.mjs`), not against the shared local
  dev database, and not merely asserted from schema text.
- Task 7 (web planner) complete: `PlannerRail` (`apps/web/src/app/components/planner-rail.tsx`)
  replaces the static Story 3.5/5.2 shell with the live seven-day surface. It is
  self-contained rather than parent-fed -- following `palette-advisor-panel.tsx`'s
  architecture over the old boolean-`isEntitled`-prop shape -- and owns its own
  `checking | entitled | locked | error` state (Decision 7's exact literal type) plus the
  planner data fetch, both driven by a single effect keyed on `isOpen`. One request settles
  both entitlement and data: the planner `GET` itself carries the 401/403/503
  classification (via `apps/web/src/lib/planner.ts`'s `plannerFailureReason`), so there is
  no separate subscription pre-check to keep in sync with it, and no request at all fires
  for a rail nobody opened (AC 6).
- `LookbookPrismLayout` (`apps/web/src/app/components/lookbook-prism-layout.tsx`) now
  defaults the planner closed, adds a persistent "Plan week" control near the hero header
  (in addition to the existing one inside the severe-weather-alert banner, which now
  shares the same localized label), and decides `rail` vs `overlay` variant from actual
  `window.innerWidth` at the 1440px boundary rather than CSS alone, so exactly one
  `PlannerRail` instance ever mounts (no duplicate fetch). The file now wraps its return in
  an `I18nextProvider` -- it previously had none, since `/` never has -- but the
  component's own top-level copy still reads `getI18n().t(...)` directly rather than the
  `useTranslation()` hook: a component's own render happens before the `I18nextProvider`
  it returns takes effect for its own hooks, only for descendants'.
- Focus handling: `rail` variant is ordinary in-page content (no trap, stays in normal Tab
  order); `overlay` variant traps focus and closes on Escape, mirroring
  `accessible-modal.tsx`'s `handleKeyDown` exactly, and restores focus to the opener (or
  the previously active element) on close, mirroring the same file's restore effect.
- Reshuffle is atomic per date, keyed by `expectedVersion`; a `409` (`PLANNER_DAY_CHANGED_MESSAGE`)
  shows a per-date alert and silently re-fetches the whole window (there is no single-date
  `GET`). Busy state is tracked per `planDate`, not globally, so one date's in-flight
  reshuffle does not block another's, while a second click on the same date's button is a
  no-op both at the DOM level (a `disabled` button dispatches no click) and in
  `handleReshuffle`'s own re-entrancy guard.
- `commerce.premium.planner.*` was added to all ten web locale catalogs (47 leaf keys,
  covering exactly Decision 8's list: section/day labels, conditions, weather confidence
  and freshness, scenario labels, starter wardrobe, open, close, loading, retry, reshuffle
  states, the disabled state, the error state, and live announcements) plus a dedicated
  `planner-locales.spec.ts` parity spec and the matching `premium-locales.spec.ts`
  exclusion, following Decision 15's rule and Story 5.4's precedent exactly. `en-CA` is a
  deliberate literal copy of `en-US` for this subtree: unlike 5.4's "colour"-heavy palette
  copy, nothing here has a Canadian/American spelling divergence. Non-English values are
  machine-translation drafts pending human review before release, matching every other
  parity spec's stated posture.
- Temperature display has no prior web utility to reuse (mobile has one,
  `apps/mobile/src/lib/formatters.ts`, never shared into `packages/utils`); `lib/planner.ts`
  ports its exact `en-US`-sees-Fahrenheit / else-Celsius logic so both platforms show a
  reader the same number. Weekday/date labels use a local `Intl.DateTimeFormat` helper with
  `timeZone: 'UTC'`, which is load-bearing: `planDate` is a date-only calendar label, and
  formatting it in the reader's local zone would roll it back a day for negative UTC
  offsets.
- `commerce.premium.planner.*` copy uses Decision 8's existing semantic premium theme
  tokens (`--theme-card-bg`, `--theme-card-text`, `--theme-card-border`, `--theme-primary`,
  `--theme-secondary` from `globals.css`) rather than the old component's hardcoded hex
  values, matching `premium-theme-section.tsx`'s own opt-in pattern.
- Updated the three pinned tests Decision 7/Dev Notes named for the move from a static
  shell to live data: `lookbook-prism-layout.test.tsx` (four planner-specific `it` blocks
  rewritten around the new open-then-assert flow and a real MSW-backed planner fixture, one
  test renamed from "expired subscription" to "non-entitled caller" since there is no
  longer a separate subscription check to mock), `playwright/tests/lookbook-prism.spec.ts`
  (opens the planner explicitly at both the narrow and 1440px+ breakpoints instead of
  asserting default visibility), and `playwright/tests/accessibility-hardening.spec.ts`
  (opens the planner before the reduced-motion assertion, and scopes the severe-alert
  focus-contrast check's `Plan week` locator to the alert panel now that a second control
  with the same accessible name exists on the page).
- Added `apps/web/src/app/components/planner-rail.test.tsx`, 17 component tests with MSW
  covering: closed renders nothing; signed-out locked with zero requests; the checking
  skeleton; a full ready week (weather, scenarios, starter-wardrobe marker, Fahrenheit
  conversion at `en-US`); the `unavailable`-confidence weather note; an isolated day error
  beside otherwise-ready days plus its retry; the not-entitled-vs-disabled 403/503 split;
  an unclassified failure's retry; reshuffle success, `unchanged`, and `409` conflict paths;
  double-activation prevention; abort-on-close; overlay focus trap, Escape, and
  restore-focus; and a full `axe-core` WCAG 2.1/2.2 A/AA pass on the entitled state.
- `npm run verify:changed` (workspace `apps/web`: lint, typecheck, the full 45-file/644-test
  vitest suite including the new planner files, and the production `next build`), the
  workspace's own `lint` and `typecheck` scripts run standalone, and every touched file
  passed `eslint --max-warnings=0` and `prettier --check` individually. `packages/utils`
  and `packages/api-client` needed `npm run build` once in this worktree before any of the
  above would resolve `@couture/utils` / `@couture/api-client/contracts/http` --the
  worktree had never had its workspace packages built; `packages/testing`'s own build still
  fails here on missing generated Prisma types, but nothing in this task's scope depends on
  it. Full command output is not reproduced here; rerun `npm run verify:changed` to
  reverify.
- The two updated Playwright specs were not executed in this environment (no running
  API/DB/web stack), matching `verify:changed`'s own explicit warning that it does not cover
  non-workspace files under `playwright/`. Task 10 owns running the full Playwright suite;
  this session verified the edits by reading them against the component's actual runtime
  behavior and by running every equivalent assertion at the component-test layer instead.
- Out of scope for the web and mobile sessions by the requesting session's explicit instruction: Task 9
  (localization/accessibility evidence beyond what Tasks 7/8 already closed for their own AC 7 scope --
  the remaining scope is the web axe matrix at desktop/phone widths signed-out and entitled, plus manual
  keyboard/VoiceOver/TalkBack evidence) and Task 10 (cross-boundary Pact/integration/Playwright/Maestro
  verification and `deferred-work.md`).
- Task 8 (mobile planner) complete: `apps/mobile/src/lib/planner.ts` (client wrapper, following
  `premium-theme.ts`/`palette-advisor.ts`'s `readAccessToken` pre-check and status-to-reason mapping
  exactly), `apps/mobile/src/features/premium/planner-screen.tsx` (the screen itself), the thin
  `apps/mobile/app/planner.tsx` route, and a `PlannerLinkRow` settings entry following
  `PaletteAdvisorLinkRow`'s established pattern (link role, accessible label, stable `testID`, not
  entitlement-gated at the entry point).
- The screen consumes `useAppTheme()`'s premium palette on each day card (`cardBg`/`cardBorder`/
  `cardText`), the one existing consumer of that hook before this story was `PremiumThemeSection` in
  settings; a degraded weather confidence (`unavailable`) renders only its own label, with no
  temperature range, condition, or freshness badge, so a starter-wardrobe baseline day never implies a
  precision it does not have.
- Reshuffle is per-day: a busy card disables its own button and ignores a second press
  (`busyDate` gates `handleReshuffle`), a `409` conflict re-fetches the whole week (there is no
  single-day GET) and shows the conflict notice on that date, and `unchanged: true` renders its own
  "no different outfits" notice rather than being conflated with a real reshuffle.
- Added `commerce.premium.planner.*` (35 keys) and `commerce.premium.plannerLocked.*` (2 keys, mirroring
  the web catalogs' existing `plannerLocked.title`/`.cta`) to all ten mobile locale catalogs, and a new
  `apps/mobile/src/i18n/planner-locales.spec.ts` parity spec; `premium-locales.spec.ts` now excludes both
  subtrees the same way it already excludes `theme`/`palette`, and its stale "web-only, deliberately
  absent" comment about `plannerLocked.*` is corrected since mobile ships it now.
- Garment category captions on planner cards reuse the existing `wardrobe.tagging.options.category.*`
  keys for the accessibility label only (screen-reader text on each garment thumbnail), rather than
  adding a duplicate translated key set inside the planner subtree, since Decision 8's enumerated
  planner copy list does not include garment category names.
- `apps/mobile/src/screens/planner-screen.test.tsx` covers loading, signed-out locked, not-entitled
  locked (403), disabled (503), unclassified load failure with retry, a full seven-date ready week,
  degraded (`unavailable`) weather, an isolated per-date error card beside six ready dates, whole-week
  retry from a failed date, reshuffle success, reshuffle `unchanged`, a `409` version conflict, and
  double-tap protection during an in-flight reshuffle -- 13 tests, all real network round trips through
  MSW rather than a stubbed `src/lib/planner`.
- `apps/mobile/src/screens/settings-premium-section.test.tsx`, `settings-premium-theme-section.test.tsx`,
  and `tab-two-screen.test.tsx` needed no new assertions: they already mock `expo-router` for
  `PaletteAdvisorLinkRow`'s pre-existing `router.push` dependency, and the new `PlannerLinkRow` uses the
  same mocked singleton.
- Building `packages/api-client` (`npm run build --workspace @couture/api-client`) was required before
  `apps/mobile`'s lint passed clean: its `./testing/*` subpath export resolves through `dist/`, and two
  pre-existing test files (`wardrobe-hub-screen.test.tsx`, `deep-link-handling.test.tsx`, and others)
  import from it. This worktree's lint script has no `pretypecheck`-style hook to build shared packages
  first the way `typecheck`/`test` do, so a bare `npm run lint` here failed on `import/no-unresolved`
  until the package was built once; `npm run verify:changed` builds it itself and was fully green with
  no code changes needed.
- `npm run verify:changed` (root) is green: mobile's own 69 files / 699 tests, mobile lint, mobile
  typecheck, and the widget/watchOS prebuild suites all pass.

### File List

**Task 1 — Daily weather ingestion and persistence**

- `apps/api/src/modules/weather/providers/weather.types.ts` (M)
- `apps/api/src/modules/weather/providers/weather.schemas.ts` (M)
- `apps/api/src/modules/weather/providers/weather.config.ts` (M)
- `apps/api/src/modules/weather/providers/weather.config.spec.ts` (M)
- `apps/api/src/modules/weather/providers/weather-date.util.ts` (A)
- `apps/api/src/modules/weather/providers/openweather.provider.ts` (M)
- `apps/api/src/modules/weather/providers/openweather.provider.spec.ts` (M)
- `apps/api/src/modules/weather/providers/weatherapi.provider.ts` (M)
- `apps/api/src/modules/weather/providers/weatherapi.provider.spec.ts` (M)
- `apps/api/src/modules/weather/providers/fixtures/openweather.fixtures.ts` (M)
- `apps/api/src/modules/weather/weather.repository.ts` (M)
- `apps/api/src/modules/weather/weather.repository.spec.ts` (M)
- `apps/api/src/modules/weather/weather.controller.spec.ts` (M)
- `packages/db/prisma/schema.prisma` (M, shared with Task 3)
- `packages/db/prisma/migrations/20260904090000_add_weather_daily_summaries/migration.sql` (A)

**Task 2 — Shared generation engine**

- `apps/api/src/modules/personalization/ritual-generation.engine.ts` (A)
- `apps/api/src/modules/personalization/ritual-generation.engine.spec.ts` (A)
- `apps/api/src/modules/personalization/ritual.service.ts` (M)

**Task 3 — Planner schema, RLS, factories, and cleanup**

- `packages/db/prisma/schema.prisma` (M, shared with Task 1)
- `packages/db/prisma/migrations/20260904091500_add_planner_day_plan/migration.sql` (A)
- `packages/db/test/rls/harness.ts` (M)
- `packages/db/test/rls/planner.spec.ts` (A)
- `packages/db/test/planner-schema.spec.ts` (A)
- `packages/testing/src/cleanup.ts` (M)
- `packages/testing/src/factories/registry.ts` (M)
- `packages/testing/src/factories/planner.factory.ts` (A)
- `packages/testing/src/factories/index.ts` (M)
- `packages/testing/test/planner.factory.spec.ts` (A)
- `packages/testing/templates/test-template.spec.ts` (M)
- `packages/testing/test/cleanup.spec.ts` (M)

**Task 4 — Contracts and generated client**

- `packages/api-client/src/contracts/http/planner.ts` (A)
- `packages/api-client/src/contracts/http/index.ts` (M)
- `packages/api-client/src/contracts/http/openapi.ts` (M)
- `packages/api-client/docs/http.openapi.json` (M, generated)
- `packages/api-client/src/generated/apis/PlannerApi.ts` (A, generated)
- `packages/api-client/src/generated/**` (M, generated — version-string ripple only; see the
  `f3e89717` commit diff for full file list)
- `apps/api/src/contracts/http.ts` (M)
- `packages/api-client/testing/planner-contract.spec.ts` (A)

**Task 5 — Flag and analytics registries**

- `packages/config/src/flags.ts` (M)
- `packages/config/src/flags.spec.ts` (M)
- `packages/db/prisma/seeds/feature-flags.ts` (M)
- `packages/api-client/src/types/analytics-events.ts` (M)
- `packages/api-client/src/testing/analytics-event-assertions.ts` (M)
- `apps/api/src/modules/telemetry/telemetry.service.ts` (M)
- `apps/api/src/modules/telemetry/telemetry.service.spec.ts` (M)

**Task 6 — Planner API**

- `apps/api/src/modules/personalization/planner-payload.schema.ts` (A)
- `apps/api/src/modules/personalization/planner.service.ts` (A)
- `apps/api/src/modules/personalization/planner.service.spec.ts` (A)
- `apps/api/src/modules/personalization/planner.controller.ts` (A)
- `apps/api/src/modules/personalization/planner.controller.spec.ts` (A)
- `apps/api/src/modules/personalization/personalization.module.ts` (M)
- `apps/api/src/modules/commerce/premium-entitlement.guard.ts` (M, stale comment only)
- `apps/api/src/contracts/http.ts` (M, shared with Task 4 — added the previously-missing
  `weatherConditionSchema` value export)
- `apps/api/src/modules/feature-flags/feature-flags.service.spec.ts` (M, unrelated pre-existing test
  fixed as a direct consequence of Task 5's new registry key; see Completion Notes)

**Task 7 — Web planner**

- `apps/web/src/lib/planner.ts` (A)
- `apps/web/src/app/components/planner-rail.tsx` (M, replaced the Story 3.5/5.2 static shell)
- `apps/web/src/app/components/planner-rail.test.tsx` (A)
- `apps/web/src/app/components/lookbook-prism-layout.tsx` (M)
- `apps/web/src/app/components/lookbook-prism-layout.test.tsx` (M)
- `apps/web/src/i18n/locales/en-US.json` (M)
- `apps/web/src/i18n/locales/en-CA.json` (M)
- `apps/web/src/i18n/locales/de-DE.json` (M)
- `apps/web/src/i18n/locales/es-419.json` (M)
- `apps/web/src/i18n/locales/fr-CA.json` (M)
- `apps/web/src/i18n/locales/fr-FR.json` (M)
- `apps/web/src/i18n/locales/it-IT.json` (M)
- `apps/web/src/i18n/locales/pt-BR.json` (M)
- `apps/web/src/i18n/locales/pt-PT.json` (M)
- `apps/web/src/i18n/locales/tr-TR.json` (M)
- `apps/web/src/i18n/planner-locales.spec.ts` (A)
- `apps/web/src/i18n/premium-locales.spec.ts` (M, planner subtree exclusion per Decision 15)
- `playwright/tests/lookbook-prism.spec.ts` (M)
- `playwright/tests/accessibility-hardening.spec.ts` (M)

**Task 8 — Mobile planner**

- `apps/mobile/src/lib/planner.ts` (A)
- `apps/mobile/src/features/premium/planner-screen.tsx` (A)
- `apps/mobile/app/planner.tsx` (A)
- `apps/mobile/app/(tabs)/settings.tsx` (M — `PlannerLinkRow`)
- `apps/mobile/src/screens/planner-screen.test.tsx` (A)
- `apps/mobile/src/i18n/planner-locales.spec.ts` (A)
- `apps/mobile/src/i18n/premium-locales.spec.ts` (M — excludes `planner`/`plannerLocked`, corrects the
  stale "web-only" comment)
- `apps/mobile/assets/locales/{en-US,en-CA,de-DE,es-419,fr-CA,fr-FR,it-IT,pt-BR,pt-PT,tr-TR}.json` (M —
  `commerce.premium.planner.*` and `commerce.premium.plannerLocked.*`)
