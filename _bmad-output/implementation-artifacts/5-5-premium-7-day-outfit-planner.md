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

- [ ] **Task 4: Contracts and generated client** (AC 1, 3, 4, 5)
  - [ ] Create the strict GET and reshuffle contracts from Decision 5.
  - [ ] Add exact collection invariants, message constants, the API contract bridge export, and all error responses.
  - [ ] Register the contract, bump OpenAPI to `1.5.0`, regenerate the client, and run Optic.
  - [ ] Add contract tests for duplicate dates, duplicate scenarios, invalid dates, missing platform, and non-null planner affiliate data.

- [ ] **Task 5: Flag and analytics registries** (AC 5, 6)
  - [ ] Add `premium_planner_enabled` to all four flag touchpoints.
  - [ ] Add both analytics events to all seven registration points.
  - [ ] Add strict negative fixtures and registry set-equality tests.

- [ ] **Task 6: Planner API** (AC 1 through 6, AC 8, AC 9)
  - [ ] Add `PlannerService` with owned-location resolution, window calculation, fingerprinting, partial-day generation, pruning, and batched garment enrichment.
  - [ ] Add atomic, versioned reshuffle with preference exclusions and `unchanged` calculation.
  - [ ] Register controller, service, engine, direct flag module, and direct telemetry module imports.
  - [ ] Parse success payloads through contracts and preserve private no-store headers.
  - [ ] Test gate order, flag off, partial success, stable reread, invalidation, cold-read races, transactional rollback, version conflicts, location switching, and cross-user input.

- [ ] **Task 7: Web planner** (AC 3, 5, 7)
  - [ ] Add generated-client wrapper and failure classification.
  - [ ] Add the normal Plan week control, closed default, responsive rail or overlay behavior, entitlement state machine, and request abort.
  - [ ] Render exact seven-date results, starter wardrobe, weather freshness, per-date errors, and per-date reshuffle state.
  - [ ] Update the existing layout and accessibility tests pinned to the static rail.
  - [ ] Add component tests with MSW for all access, partial-week, retry, close, focus, and concurrency states.

- [ ] **Task 8: Mobile planner** (AC 3, 5, 7)
  - [ ] Add client wrapper, thin route, screen, and Premium settings link.
  - [ ] Render the same contract states with `ScrollView`, themed tokens, 44-pixel controls, and live announcements.
  - [ ] Add screen tests with MSW for locked, checking, entitlement error, ready week, partial week, retry, reshuffle, unchanged, conflict, and double-tap protection.
  - [ ] Update existing settings rendering suites for the new router dependency and row.

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

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed. Comprehensive developer guide created.

### File List
