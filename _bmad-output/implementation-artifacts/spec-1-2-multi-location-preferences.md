---
title: 'Story 1.2: Multi-location preferences'
type: 'feature'
created: '2026-07-07T00:00:00-05:00'
status: 'blocked'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/1-1-weather-api-ingestion-service.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Story 1.2 asks users to save and switch between several cities so home,
office, and commuter planning can share one active forecast context. The current codebase has
provider adapters only; it does not yet have the Story 1.1 weather persistence, target source,
latest-weather query, or widget/watch surfaces required to complete the story end to end.

**Approach:** Add a user-scoped saved-location preference model, canonical HTTP contracts, and a
thin authenticated API module only after the missing Story 1.1 integration contracts exist. The
implementation must make primary-location switching transactionally durable and ready to feed
weather ingestion/query surfaces without duplicating provider logic.

## Boundaries & Constraints

**Always:** Keep public REST contracts Zod-first in `@couture/api-client`; keep Nest controllers thin
over service methods; enforce user ownership and max-three saved locations server-side; persist one
primary location per user transactionally; store metric/UTC-compatible canonical location metadata
without raw provider payloads or secrets.

**Block If:** Story 1.1 still lacks `WeatherTargetSource`, normalized `WeatherSnapshot.location_key`
persistence, and `/api/v1/weather/:locationKey`; widget/watch refresh surfaces remain absent; no
decision exists for how a saved active location should trigger ingestion refresh versus only reading
the latest cached snapshot.

**Never:** Do not implement outfit generation, alert rules, weather provider calls, mobile widgets,
watch UI, or local client-only location state in this story. Do not bypass RLS/ownership checks or
embed API keys, exact user identity details, or raw provider payloads in logs.

## I/O & Edge-Case Matrix

| Scenario           | Input / State                                                                                       | Expected Output / Behavior                                                                                        | Error Handling                                             |
| ------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| SAVE_LOCATION      | Authenticated user has fewer than three saved places and submits label plus canonical city metadata | Location is stored for that user, returned in sorted order, and becomes primary if it is the first saved location | Validation errors return 400 through shared error envelope |
| MAX_LOCATIONS      | Authenticated user already has three saved places                                                   | No fourth location is persisted                                                                                   | Return 400 with a user-safe max-locations message          |
| SWITCH_PRIMARY     | Authenticated user switches to one of their saved locations                                         | Exactly that location is primary for the user and preference persists across reads                                | Unknown or foreign location returns 404                    |
| DELETE_PRIMARY     | Authenticated user deletes the primary location while other locations exist                         | Deleted location is removed and the next lowest `sort_order` location becomes primary                             | Unknown or foreign location returns 404                    |
| DUPLICATE_LOCATION | Authenticated user saves the same canonical `locationKey` twice                                     | Existing location is not duplicated                                                                               | Return 400 with a duplicate-location message               |

</intent-contract>

## Code Map

- `packages/db/prisma/schema.prisma` -- Add a user-scoped saved-location model once Story 1.1's
  weather-location schema is available.
- `packages/db/prisma/migrations/` -- Add forward migration, partial unique index for one primary
  location per user, and RLS policy SQL.
- `packages/api-client/src/contracts/http/locations.ts` -- Define saved-location request/response
  schemas and OpenAPI path registrations.
- `packages/api-client/src/contracts/http/openapi.ts` -- Register the location contract slice.
- `packages/api-client/src/contracts/http/index.ts` -- Export the location contracts.
- `apps/api/src/contracts/http.ts` -- Bridge location contracts into the API package.
- `apps/api/src/modules/location-preferences/` -- New Nest module for controller, service, and tests.
- `apps/api/src/app.module.ts` -- Register the location-preferences module.
- `packages/testing/src/factories/` -- Add saved-location fixtures after Prisma model generation.
- `packages/testing/src/cleanup.ts` -- Delete saved locations before users during cleanup.
- `packages/db/test/rls-policies.spec.ts` -- Cover user isolation for saved locations.
- `apps/api/integration/http-contract-parity.integration.spec.ts` -- Prove live routes match canonical
  contracts.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/db/prisma/schema.prisma` -- Add the saved-location model with user relation,
      canonical location metadata, `is_primary`, `sort_order`, timestamps, and uniqueness rules --
      required for persisted preferences.
- [ ] `packages/db/prisma/migrations/<timestamp>_add_saved_locations/migration.sql` -- Add table,
      indexes, one-primary-per-user constraint, and RLS policies -- required for tenant isolation.
- [ ] `packages/api-client/src/contracts/http/locations.ts` -- Add list/create/update/delete/set-primary
      contracts and OpenAPI registrations -- required before controller code.
- [ ] `apps/api/src/modules/location-preferences/` -- Implement authenticated controller/service with
      max-three, duplicate, ownership, primary-switch, and delete-primary behavior -- required for
      Story 1.2 API behavior.
- [ ] `packages/testing/src/factories/` and `packages/testing/src/cleanup.ts` -- Add saved-location
      fixtures and cleanup ordering -- required for deterministic tests.
- [ ] `packages/db/test/rls-policies.spec.ts`, `apps/api/src/modules/location-preferences/*.spec.ts`,
      and `apps/api/integration/http-contract-parity.integration.spec.ts` -- Test the I/O matrix,
      RLS isolation, and contract parity -- required for regression protection.
- [ ] Story 1.1 integration files -- Wire primary saved locations into `WeatherTargetSource`,
      latest-weather query context, and widget/watch refresh behavior after those surfaces exist --
      required for full acceptance of Epic AC #2 and #3.

**Acceptance Criteria:**

- Given an authenticated user with no saved locations, when they create a valid first location, then
  it is persisted as primary and returned by subsequent list calls.
- Given an authenticated user with three saved locations, when they attempt to add another, then no
  record is persisted and the API returns a shared 400 error response.
- Given an authenticated user with multiple saved locations, when they set one as primary, then all
  other locations for that user are non-primary in the same transaction.
- Given a saved primary location and the Story 1.1 weather query surface, when the user switches
  primary location, then the primary forecast context reads from the selected `locationKey`.
- Given widget/watch surfaces exist, when the primary saved location changes, then those surfaces
  refresh from the selected location within five minutes.

## Spec Change Log

## Review Triage Log

## Auto Run Result

Status: blocked
Blocking condition: intent gaps

Unanswered requirements that block unattended implementation:

- Story 1.1 is still `in-progress` and lacks the normalized weather persistence migration required
  for `WeatherSnapshot.location_key`.
- No `WeatherTargetSource` exists for Story 1.2 to replace with saved active locations.
- No `WeatherQueryService` or authenticated `/api/v1/weather/:locationKey` endpoint exists, so
  switching cannot update the primary forecast context end to end.
- No widget/watch implementation surface exists, so the five-minute refresh acceptance criterion
  cannot be implemented or verified.
- No product/architecture decision currently says whether switching a primary location should enqueue
  immediate ingestion or only update persisted preference for the next scheduled weather refresh.

Evidence gathered:

- `_bmad-output/implementation-artifacts/1-1-weather-api-ingestion-service.md` lists Story 1.1
  Tasks 2-7 as incomplete, including persistence, query service, scheduler/target source, controller,
  telemetry, and verification.
- `apps/api/src/modules/weather/providers/` contains provider adapters and schemas only.
- `packages/db/prisma/schema.prisma` contains legacy global `WeatherSnapshot` and `ForecastSegment`
  models but no saved-location or user-location preference model.
- Repository search found no widget/watch app surface for weather refresh behavior.
