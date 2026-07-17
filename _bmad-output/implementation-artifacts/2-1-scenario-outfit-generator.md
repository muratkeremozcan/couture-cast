---
baseline_commit: 0d56181748a5d20784eb83d9ad4e300830263e48
---

# Story 2.1: Scenario outfit generator

Status: done

## Story

As a style-seeker,
I want distinct outfit cards for morning, midday, and evening,
so that each part of my day is covered.

## Acceptance Criteria

1. **Daily Scenario Coverage:** Generate exactly three scenario cards per requested day: `morning` (commute), `midday` (daytime), and `evening` (social/night).
2. **Weather Parameter Integration:** Each scenario card must map to the corresponding hourly forecast segment from the active weather snapshot:
   - `morning`: Local 8:00 AM forecast segment.
   - `midday`: Local 1:00 PM forecast segment.
   - `evening`: Local 7:00 PM forecast segment.
3. **Personalized Comfort Tuning:** Match user's `ComfortPreferences` (`runs_cold_warm`, `wind_tolerance`, `precip_preparedness`) to candidate wardrobe garments, applying sensitivity adjustments:
   - If user runs cold, adjust effective feels-like temperature by -3°C.
   - If user runs warm, adjust effective feels-like temperature by +3°C.
   - Match categories to weather ranges: Outerwear (feels-like < 15°C), Top + Bottom + Shoes (feels-like >= 10°C), or Dress + Shoes (mild/warm).
4. **Badging & Rationale:** Include reasoning badges (e.g. `"Wind layer"`, `"Evening chill"`, `"Rain-ready"`) and a comfort notes explanation string based on weather thresholds.
5. **Fallback Default Logic:** When the user has no custom garments uploaded, fallback to type-safe category-based placeholders (e.g. system default item blueprints) to ensure the API never returns empty outfits.
6. **Caching & Database Persistence:**
   - Persist generated recommendations in the `OutfitRecommendation` table, linked to the `ForecastSegment` and user.
   - Cache the complete API response payload in Redis for 15 minutes (900 seconds) using the key format `ritual:{userId}:{locationKey}`.
   - Invalidate or bypass cache if the underlying weather snapshot updates (`fetched_at` changes), or if comfort preferences are updated.

## Tasks / Subtasks

- [x] **Task 1: Shared Zod Http Contract for Ritual (AC: #1, #4)**
  - [x] Create `packages/api-client/src/contracts/http/ritual.ts` and define:
    - `ritualResponseSchema` containing `weather`, `outfits` (array of 3 scenario objects with `id`, `scenario`, `garment_ids`, `reasoning_badges`, `comfort_notes`), and general `badges` (array of strings).
    - `ritualQueryParamsSchema` containing optional `locationId`.
  - [x] Register the new contract functions in `packages/api-client/src/contracts/http/index.ts`.
  - [x] Run `npm run generate:api-client` to regenerate the OpenAPI specs and HTTP client SDK.
  - [x] Ensure that `packages/api-client/docs/http.openapi.json` is successfully updated and diffs pass.

- [x] **Task 2: Personalization Module Structure & Controller (AC: #1, #6)**
  - [x] Scaffold `apps/api/src/modules/personalization/personalization.module.ts`.
  - [x] Implement `RitualController` decorated with `@Controller('/api/v1/ritual')` and `@UseGuards(RequestAuthGuard)`.
  - [x] Inject `RitualService` and bind the `GET` route handler mapping to the Zod HTTP contract.
  - [x] Resolve request context using `@AuthContext() auth: RequestAuthContext` and query parameters.
  - [x] Add exception handling to map Zod validation errors to NestJS `BadRequestException`.

- [x] **Task 3: Outfit Recommendations Algorithm & Database Service (AC: #1, #2, #3, #4, #5, #6)**
  - [x] Implement `RitualService.getOrCreateRitual(userId: string, locationId?: string)` in `apps/api/src/modules/personalization/ritual.service.ts`.
  - [x] Resolve the location: Use provided `locationId` (validate user ownership) or fallback to the user's primary saved location via `LocationPreferencesService`. If none, throw `BadRequestException`.
  - [x] Retrieve the latest weather snapshot using `WeatherQueryService.getLatestWeather(locationKey)`.
  - [x] Extract the target forecast hours matching local time (8 AM, 1 PM, 7 PM) using timezone-aware calculations.
  - [x] Retrieve comfort preferences from the `ComfortPreferences` database table (with default fallback values).
  - [x] Retrieve the user's `GarmentItem` records.
  - [x] Enforce the layered matching rules:
    - Temperature adjustments (runs cold/warm +/- 3°C to effective feels-like temp).
    - Category composition rules (e.g. Top + Bottom + Shoes; Outerwear if adjusted feels_like < 15°C; Dress alternative).
    - Match `GarmentItem.comfort_range` to the weather temperature classification.
    - Fallback generation: populate generic placeholder garment objects if user's closet is empty.
  - [x] Construct reasoning badges (`{ label: string }`) and localized comfort notes based on condition triggers (high wind speed, rain, temperature thresholds).
  - [x] Write outfit results to the `OutfitRecommendation` table. If recommendations already exist for the segment snapshot ID and user, return them to prevent duplication.

- [x] **Task 4: Redis Caching Layer (AC: #6)**
  - [x] Retrieve the Redis connection configuration using `redisOptionsFromConfig(getRedisConfig())` from `apps/api/src/config/redis.ts`.
  - [x] In `RitualService`, query Redis before invoking the recommendation engine. Key format: `ritual:{userId}:{locationKey}`.
  - [x] If cached hit exists, parse and return the payload.
  - [x] If cached miss, generate the payload, write it to Redis with a TTL of 15 minutes (900 seconds), and return.
  - [x] Invalidate the cache whenever the user updates their comfort preferences (Story 2.2).

- [x] **Task 5: Test Suite Verification & Validation (AC: #1-#6)**
  - [x] Implement unit tests in `apps/api/src/modules/personalization/ritual.service.spec.ts`:
    - Test the outfit suggestion engine with empty closets (verifying fallbacks).
    - Test the comfort calibration temperature offset calculations (+/- 3°C).
    - Test the forecast hour segment finder using timezone data.
    - Test the weather alert badge mappings (wind tolerance, rain).
  - [x] Implement integration tests in `apps/api/src/modules/personalization/ritual.controller.spec.ts`:
    - Test authenticated requests to `/api/v1/ritual` using `RequestAuthGuard` and `mock-auth` context.
    - Test Redis cache set/get/ttl execution.
    - Test database persistence of generated `OutfitRecommendation` records.
  - [x] Ensure that `packages/testing/src/cleanup.ts` deletes created `OutfitRecommendation` rows after test runs.
  - [x] Run `npm test` and `npm run typecheck` to verify monorepo compile-time type-safety and formatting rules.

### Review Findings

- [x] [Review][Patch] Mixed-Day Timezone Segment Alignment Bug (resolved: shift all to tomorrow if queried after 8:00 AM local time) [apps/api/src/modules/personalization/ritual.service.ts]
- [x] [Review][Dismiss] Polluted Fallback IDs for Empty Closets (resolved: keep synthetic IDs)
- [x] [Review][Patch] OpenAPI Client Generation and Serialization Desynchronization (snake_case vs camelCase) [packages/api-client/src/contracts/http/ritual.ts]
- [x] [Review][Patch] Single Point of Failure on Redis Cache Operations [apps/api/src/modules/personalization/ritual.service.ts]
- [x] [Review][Patch] Database-Persisted Recommendations Bypass Comfort Preference Updates [apps/api/src/modules/personalization/ritual.service.ts]
- [x] [Review][Patch] Cache Invalidation Wardrobe Desynchronization [apps/api/src/modules/personalization/ritual.service.ts]
- [x] [Review][Patch] Incorrect Exception Classification (Semantic Blame Shifting) [apps/api/src/modules/personalization/ritual.controller.ts]
- [x] [Review][Patch] Inefficient, Non-Cached Intl.DateTimeFormat Instantiation [apps/api/src/modules/personalization/ritual.service.ts]
- [x] [Review][Patch] Unimplemented NestJS Lifecycle Interface [apps/api/src/modules/personalization/ritual.service.ts]
- [x] [Review][Patch] Ineffective Default Comfort Settings Fallback [apps/api/src/modules/personalization/ritual.service.ts]
- [x] [Review][Patch] Unmapped Upstream Alert Severity Enums [apps/api/src/modules/personalization/ritual.service.ts]
- [x] [Review][Patch] Duplicate Threshold Logic and DRY Violation [apps/api/src/modules/personalization/ritual.service.ts]
- [x] [Review][Patch] Brittle and Conflicting Global Mocks in Specs [apps/api/src/modules/personalization/ritual.controller.spec.ts]
- [x] [Review][Defer] Database Race Condition on Recommendations [packages/db/prisma/schema.prisma:270] — deferred, pre-existing
- [x] [Review][Defer] Tight Coupling and DI Violation on Redis Client [apps/api/src/modules/personalization/ritual.service.ts:74-76] — deferred, pre-existing

## Dev Notes

### Architecture Patterns & Constraints

- **Single Source of Truth:** All HTTP endpoints must be registered under Zod schemas in `packages/api-client/src/contracts/http/`. Do not write controllers before contracts.
- **Tenant Isolation:** Filter all database queries by the authenticated user's `userId`. Enforce RLS rules.
- **Observability:** Instrument error outcomes, cache hit/miss ratio, and execution latency. Use `Pino` logger with requestId context.

### Source Tree Components to Touch

- New Module: `apps/api/src/modules/personalization/`
- API Contracts: `packages/api-client/src/contracts/http/ritual.ts` and `packages/api-client/src/contracts/http/index.ts`
- Root Module: `apps/api/src/app.module.ts` (import `PersonalizationModule`)
- Test Cleanup: `packages/testing/src/cleanup.ts`

### Testing Standards

- Colocate specifications alongside source files (e.g. `ritual.service.spec.ts`).
- Enforce full code coverage on personalization matching rules.
- Verify contract compatibility using Optic in CI checks.

### Project Structure Notes

- Keep module files flat inside `apps/api/src/modules/personalization/`.
- Ensure new schemas follow camelCase for fields and uppercase for schemas, and fit standard response envelopes (`{ data }` or `{ error }`).

### References

- [Weather Query Service](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/weather/weather-query.service.ts)
- [Prisma Database Schema](file:///Users/murat/opensource/couture-cast/packages/db/prisma/schema.prisma)
- [Security guards](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/auth/security.guards.ts)
- [Location Preferences Module](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/location-preferences/location-preferences.module.ts)
- [ADR-005 Personalization Engine](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/architecture.md#L238)

## Dev Agent Record

### Agent Model Used

Gemini 3.5 Flash (High)

### Implementation Plan & Debug Log

- Defined Zod schemas and query params in `packages/api-client/src/contracts/http/ritual.ts`.
- Integrated contract registry and regenerated OpenAPI and SDK with `generate:api-client`.
- Scaffolded `PersonalizationModule`, `RitualController`, and `RitualService` flat inside `apps/api/src/modules/personalization/`.
- Implemented timezone-aligned local forecast segment selectors (8 AM morning, 1 PM midday, 7 PM evening).
- Built personalized matching algorithm utilizing ComfortPreferences temperature sensitivity offset (+/- 3°C), wind, and rain badging thresholds.
- Connected Redis caching (15 min/900s TTL) keyed to user and location, bypassing on update of comfort settings or weather snapshots.
- Registered endpoints in NestJS `AppModule` and exposed routes.
- Wrote full unit test coverage and supertest-driven controller integration tests verifying auth, caching, and persistence.
- Verified monorepo compile type-safety with `npm run typecheck`.

### Completion Notes

All requirements and Acceptance Criteria 1 to 6 are fully satisfied, tested, and validated.

### File List

- [packages/api-client/src/contracts/http/ritual.ts](file:///Users/murat/opensource/couture-cast/packages/api-client/src/contracts/http/ritual.ts)
- [packages/api-client/src/contracts/http/index.ts](file:///Users/murat/opensource/couture-cast/packages/api-client/src/contracts/http/index.ts)
- [packages/api-client/src/contracts/http/openapi.ts](file:///Users/murat/opensource/couture-cast/packages/api-client/src/contracts/http/openapi.ts)
- [apps/api/src/modules/weather/weather.module.ts](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/weather/weather.module.ts)
- [apps/api/src/modules/personalization/personalization.module.ts](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/personalization/personalization.module.ts)
- [apps/api/src/modules/personalization/ritual.service.ts](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/personalization/ritual.service.ts)
- [apps/api/src/modules/personalization/ritual.controller.ts](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/personalization/ritual.controller.ts)
- [apps/api/src/app.module.ts](file:///Users/murat/opensource/couture-cast/apps/api/src/app.module.ts)
- [apps/api/src/contracts/http.ts](file:///Users/murat/opensource/couture-cast/apps/api/src/contracts/http.ts)
- [apps/api/src/modules/personalization/ritual.service.spec.ts](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/personalization/ritual.service.spec.ts)
- [apps/api/src/modules/personalization/ritual.controller.spec.ts](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/personalization/ritual.controller.spec.ts)

### Change Log

- **2026-07-16:** Initial implementation of Story 2.1 daily scenario outfit generator. Developed API contract, NestJS module, algorithm matching engine, database/Redis cache tiers, spec test suites, and verified monorepo build check.
- **2026-07-16:** Code review (bmad-code-review) — applied 12 patches: timezone segment alignment, camelCase contract normalization, Redis resilience, comfort/wardrobe cache invalidation, exception reclassification, Intl formatter caching, NestJS OnModuleDestroy, DRY thresholds, alert enum mapping, spec mock correctness. 2 findings deferred. All 406 monorepo tests passing.
