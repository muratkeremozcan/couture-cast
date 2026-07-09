---
baseline_commit: 01eb236dadae7e886be82a94daa0358263733550
---

# Story 1.2: Multi-location preferences

Status: done

Updated: 2026-07-09 - created from completed Story 1.1 weather foundation

## Story

As a commuter,
I want to save and switch between several cities,
so that I can plan home and office outfits easily.

## Acceptance Criteria

1. Location store supports at least three saved places with friendly labels.
2. Switching updates the primary forecast context within two taps.
3. Widgets and watch surfaces can refresh from the selected location within
   5 minutes.

## Tasks / Subtasks

- [x] Task 1: Add saved-location persistence and tenant isolation (AC: #1, #2)
  - [x] Add a `SavedLocation` Prisma model related to `User`.
  - [x] Include `user_id`, `label`, `location_key`, rounded coordinates,
        `timezone`, city/region/country display fields, `is_primary`,
        `sort_order`, `created_at`, and `updated_at`.
  - [x] Add a migration for the table, indexes, per-user uniqueness, and a
        partial unique index for one primary location per user.
  - [x] Add RLS policies using existing user-scope helpers.
  - [x] Add `SavedLocation` to `User` and regenerate Prisma Client.
  - [x] Keep `location_key` lowercase, canonical, and provider-safe.

- [x] Task 2: Define canonical HTTP contracts first (AC: #1, #2)
  - [x] Add `packages/api-client/src/contracts/http/locations.ts`.
  - [x] Define schemas for list, create, update, set-primary, and delete.
  - [x] Register routes in the OpenAPI registry and export the slice.
  - [x] Use the existing `{ data }` envelope and shared error schemas.
  - [x] Include bearer-auth metadata on every locations operation.
  - [x] Regenerate checked-in OpenAPI and generated SDK artifacts.

- [x] Task 3: Implement the authenticated API module (AC: #1, #2)
  - [x] Add `apps/api/src/modules/location-preferences/`.
  - [x] Include controller, service, repository, module, and focused tests.
  - [x] Register the module in `apps/api/src/app.module.ts`.
  - [x] Export contract schemas and types from `apps/api/src/contracts/http.ts`.
  - [x] Use `RequestAuthGuard` plus `@AuthContext()`.
  - [x] Scope every operation by `auth.userId`.
  - [x] Never accept a client-supplied `userId`.
  - [x] Enforce max three saved locations server-side.
  - [x] Reject duplicate `location_key` values per user with 400.
  - [x] Make the first saved location primary automatically.
  - [x] Set primary inside one transaction.
  - [x] Delete-primary must promote the lowest remaining `sort_order`.
  - [x] Return 404 for unknown or foreign location IDs.

- [x] Task 4: Connect saved locations to weather (AC: #2, #3)
  - [x] Add Prisma-backed `SavedLocationWeatherTargetSource`.
  - [x] Return unique primary saved locations as `WeatherIngestionTarget[]`.
  - [x] Preserve `ConfiguredWeatherTargetSource` for explicit bootstrap use.
  - [x] Do not change provider adapters, retry/failover, scheduler IDs,
        weather job IDs, freshness classification, or weather telemetry.
  - [x] Keep public `GET /api/v1/weather/{locationKey}` unchanged.
  - [x] Make primary switching update the user's active forecast context.
  - [x] Resolve the Story 1.1 deferred display-name cleanup.

- [x] Task 5: Add fixtures, cleanup, and RLS coverage (AC: #1, #2)
  - [x] Add saved-location factory helpers in `packages/testing/src/`.
  - [x] Export the factory from `packages/testing/src/factories/index.ts`.
  - [x] Update `packages/testing/src/cleanup.ts`.
  - [x] Delete saved locations before users during cleanup.
  - [x] Extend `packages/db/test/rls-policies.spec.ts`.
  - [x] Prove users cannot read or mutate other users' saved locations.
  - [x] Cover guardian/admin behavior matching the chosen RLS policy.
  - [x] Add API integration coverage for max-three and duplicate location.
  - [x] Cover set-primary, delete-primary promotion, and foreign ownership.

- [x] Task 6: Validate contracts, DB, and weather integration (AC: #1-#3)
  - [x] Add API-client contract tests for locations schemas.
  - [x] Add OpenAPI path registration tests.
  - [x] Add Nest unit tests for controller and service behavior.
  - [x] Add live authenticated API integration tests.
  - [x] Add target-source tests for primary saved-location fan-out.
  - [x] Prove duplicate primary locations do not duplicate weather jobs.
  - [x] Run targeted tests first, then API generation and Optic checks.
  - [x] Run typecheck, lint, API tests, DB tests when available, and build.

### Review Findings

- [x] \[Review\]\[Patch\] Primary-location refresh does not meet the 5-minute
      widget/watch requirement [apps/api/src/modules/weather/providers/weather.config.ts:9]
- [x] \[Review\]\[Patch\] Max-three saved-location limit is vulnerable to
      concurrent creates [apps/api/src/modules/location-preferences/location-preferences.service.ts:76]
- [x] \[Review\]\[Patch\] Duplicate saved-location races can surface as raw Prisma
      conflicts instead of 400 responses [apps/api/src/modules/location-preferences/location-preferences.repository.ts:76]
- [x] \[Review\]\[Patch\] Whitespace-only timezone can be persisted before response
      validation fails [packages/api-client/src/contracts/http/locations.ts:38]
- [x] \[Review\]\[Patch\] Partial `locationKey` updates can leave coordinates and
      timezone for the old place [apps/api/src/modules/location-preferences/location-preferences.service.ts:118]
- [x] \[Review\]\[Patch\] `PATCH isPrimary` is not atomic with other update fields
      [apps/api/src/modules/location-preferences/location-preferences.service.ts:151]
- [x] \[Review\]\[Patch\] Database only enforces lowercase `location_key`, not
      provider-safe canonical keys [packages/db/prisma/migrations/20260709120000_add_saved_locations/migration.sql:23]
- [x] \[Review\]\[Patch\] Configured weather bootstrap targets are no longer wired
      into worker startup [apps/api/src/workers/bootstrap.ts:57]
- [x] \[Review\]\[Patch\] API integration coverage uses an in-memory repository
      instead of the live Prisma path [apps/api/integration/location-preferences.integration.spec.ts:35]
- [x] \[Review\]\[Patch\] RLS coverage does not prove foreign saved-location
      updates or deletes are denied [packages/db/test/rls-policies.spec.ts:741]
- [x] \[Review\]\[Patch\] `sortOrder` accepts values outside the PostgreSQL integer
      range [packages/api-client/src/contracts/http/locations.ts:56]

## Dev Notes

### Current weather foundation to extend

- Story 1.1 is complete. It delivered ingestion, normalized persistence,
  latest-weather reads, BullMQ scheduling, provider failover, telemetry, and the
  public weather contract.
- `WeatherTargetSource` is the intended seam for this story.
- `ConfiguredWeatherTargetSource` currently reads
  `WEATHER_INGESTION_TARGETS_JSON` through weather config.
- `createWeatherJobProcessor()` coalesces by `locationKey` and enqueues stable
  interval-bucketed jobs. Preserve that behavior.
- `WeatherRepository.findLatestByLocationKey()` normalizes keys and returns the
  latest live-provider snapshot.
- `WeatherController` exposes authenticated
  `GET /api/v1/weather/:locationKey`. Keep it thin.

### Contract and API conventions

- Public REST contracts start in `packages/api-client/src/contracts/http/`.
- Nest controllers, OpenAPI docs, and generated SDK files are downstream.
- `packages/api-client/src/contracts/http/openapi.ts` composes slices.
- `apps/api/src/contracts/http.ts` bridges shared contracts into the API.
- Authenticated user-owned controllers should use `@AuthContext()`.
- Do not create controller-local DTOs as the source of truth.

### Persistence and ownership requirements

- Existing `WeatherSnapshot` rows are global by canonical `location_key`.
- The new saved-location table is user-scoped.
- Saved locations own labels, display metadata, primary selection, and order.
- The API must never trust client-provided ownership fields.
- All reads and writes filter by the authenticated user ID.
- Use a transaction for primary switching and primary deletion promotion.
- Do not implement primary switching through non-transactional updates.
- Enforce max-three in the service and back it with tests.
- Database constraints must still protect uniqueness and primary invariants.
- If the last saved location is deleted, no primary exists.

### Scope boundaries

- This story does not build outfit generation, alert rules, push notifications,
  mobile widget UI, watch UI, or local client-only location state.
- This story does not change provider adapters, normalization, retry timing,
  failover behavior, or telemetry event semantics.
- Widget/watch acceptance is satisfied by persisted primary context plus
  backend read and target-source behavior.
- Epic 3 owns the visual widget and watch implementations.
- Story 1.3 depends on this story's active location context.

### Expected file map

- `packages/db/prisma/schema.prisma`
  - Add `SavedLocation` and `User.saved_locations`.
- `packages/db/prisma/migrations/<timestamp>_add_saved_locations/`
  - Add table, indexes, primary constraint, and RLS policies.
- `packages/api-client/src/contracts/http/locations.ts`
  - Add canonical request and response schemas.
- `packages/api-client/src/contracts/http/openapi.ts`
  - Register locations contracts.
- `packages/api-client/src/contracts/http/index.ts`
  - Export locations contracts.
- `apps/api/src/contracts/http.ts`
  - Export locations schemas and types to the API package.
- `apps/api/src/modules/location-preferences/**`
  - Add controller, service, repository, module, and tests.
- `apps/api/src/app.module.ts`
  - Register the module.
- `apps/api/src/modules/weather/weather-target-source.ts`
  - Add saved-location target source.
- `apps/api/src/workers/bootstrap.ts`
  - Wire the production target source.
- `packages/testing/src/factories/saved-location.factory.ts`
  - Add saved-location fixtures.
- `packages/testing/src/factories/index.ts`
  - Export the new factory.
- `packages/testing/src/cleanup.ts`
  - Delete saved locations before users.
- `packages/db/test/rls-policies.spec.ts`
  - Add saved-location tenant isolation coverage.
- `apps/api/integration/location-preferences.integration.spec.ts`
  - Add live API behavior coverage.
- `packages/api-client/testing/locations-contract.spec.ts`
  - Add contract and OpenAPI coverage.

### Testing standards

- Start with failing tests for user-visible behavior and persistence invariants.
- Add unit tests around service transaction logic.
- Add integration tests around live HTTP behavior.
- Add DB/RLS tests against the migrated local Supabase target.
- If the DB is unavailable, record it in the Dev Agent Record.
- Regenerate and validate API client artifacts after contract changes.
- Run `npm run optic:lint` and `npm run optic:diff`.
- Keep ordered lists deterministic.
- Sort by `sort_order`, then `created_at`, then `id`.

### Previous story intelligence

- Story 1.1 established `fresh`, `cached`, `stale`, and `unavailable`.
- Exactly 60 minutes old is not stale.
- Story 1.1 created `WeatherTargetSource` for this handoff.
- Replace configured bootstrap targets without modifying scheduler internals.
- Story 1.1 deferred one cleanup item to this story:
  `WeatherSnapshot.location` currently stores `location_key`.
- Saved location display metadata should become the human label source.
- Final Story 1.1 validation passed after local Supabase started.
- Recorded pass counts: API 239/239, mobile 26/26, web 24/24, api-client 6/6,
  config 7/7, db 16/16, testing 7/7, utils 8/8, and k6 typecheck.

### References

- [Epic 1 context](./epic-1-context.md)
- [Story 1.1 weather foundation](./1-1-weather-api-ingestion-service.md)
- [Deferred work ledger](./deferred-work.md)
- [Epic source](../planning-artifacts/epics.md)
- [PRD FR1](../planning-artifacts/prd.md)
- [Architecture API contracts](../planning-artifacts/architecture.md)
- [Architecture ADR-012](../planning-artifacts/architecture.md)
- [UX widgets and wearables](../planning-artifacts/ux-design-specification.md)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-07-09: Confirmed red phase with failing location contract and API
  tests before implementation.
- 2026-07-09: Ran `npm run db:generate`,
  `npm run generate:api-client`, `npm run optic:lint`, and
  `npm run optic:diff`.
- 2026-07-09: Ran focused and full API, api-client, web, mobile, testing,
  config, utils, lint, typecheck, and build gates.
- 2026-07-09: After Docker started, applied saved-location migrations to local
  Supabase and ran `npm run test --workspace @couture/db`.
- 2026-07-09: Applied all code-review patch findings, regenerated the API
  client, and reran focused API, real Prisma integration, DB, typecheck, lint,
  build, and Optic gates.

### Completion Notes List

- Added user-scoped saved-location persistence with canonical lowercase
  provider-safe keys, rounded coordinates, per-user uniqueness, one-primary
  database protection, and self/admin RLS policies.
- Added authenticated `/api/v1/locations` contracts and Nest module for list,
  create, update, set-primary, and delete, with max-three enforcement,
  duplicate rejection, first-location primary selection, transactional primary
  switching, primary delete promotion, and foreign ownership 404s.
- Added Prisma-backed weather ingestion fan-out from unique primary saved
  locations while preserving the configured weather target source for explicit
  bootstrap use and keeping `GET /api/v1/weather/{locationKey}` unchanged.
- Added saved-location factories, cleanup ordering, RLS coverage, contract
  coverage, API integration coverage, generated OpenAPI/SDK artifacts, and a
  deterministic root build script to prevent shared package build races.
- Hardened the review pass with transaction-serialized saved-location creates,
  provider-safe DB key checks, stricter update contracts, live Prisma HTTP
  integration coverage, five-minute weather refresh cadence, and combined saved
  plus configured weather ingestion targets.

### File List

- `_bmad-output/implementation-artifacts/1-2-multi-location-preferences.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/integration/location-preferences.integration.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/contracts/http.ts`
- `apps/api/src/modules/location-preferences/location-preferences.controller.spec.ts`
- `apps/api/src/modules/location-preferences/location-preferences.controller.ts`
- `apps/api/src/modules/location-preferences/location-preferences.module.ts`
- `apps/api/src/modules/location-preferences/location-preferences.repository.ts`
- `apps/api/src/modules/location-preferences/location-preferences.service.spec.ts`
- `apps/api/src/modules/location-preferences/location-preferences.service.ts`
- `apps/api/src/modules/weather/providers/weather.config.spec.ts`
- `apps/api/src/modules/weather/providers/weather.config.ts`
- `apps/api/src/modules/weather/weather-target-source.spec.ts`
- `apps/api/src/modules/weather/weather-target-source.ts`
- `apps/api/src/workers/bootstrap.ts`
- `package.json`
- `packages/api-client/docs/http.openapi.json`
- `packages/api-client/src/contracts/http/index.ts`
- `packages/api-client/src/contracts/http/locations.ts`
- `packages/api-client/src/contracts/http/openapi.ts`
- `packages/api-client/src/generated/apis/LocationsApi.ts`
- `packages/api-client/src/generated/apis/index.ts`
- `packages/api-client/src/generated/default-api.ts`
- `packages/api-client/src/generated/models/index.ts`
- `packages/api-client/testing/http-openapi.spec.ts`
- `packages/api-client/testing/locations-contract.spec.ts`
- `packages/db/prisma/migrations/20260709120000_add_saved_locations/migration.sql`
- `packages/db/prisma/migrations/20260709123000_harden_saved_location_key_format/migration.sql`
- `packages/db/prisma/schema.prisma`
- `packages/db/test/rls-policies.spec.ts`
- `packages/testing/src/cleanup.ts`
- `packages/testing/src/factories/index.ts`
- `packages/testing/src/factories/registry.ts`
- `packages/testing/src/factories/saved-location.factory.ts`
- `packages/testing/templates/test-template.spec.ts`
- `packages/testing/test/cleanup.spec.ts`

### Change Log

- 2026-07-09: Implemented Story 1.2 multi-location preferences and moved to
  review.
- 2026-07-09: Applied all code-review patch findings and moved Story 1.2 to
  done.
