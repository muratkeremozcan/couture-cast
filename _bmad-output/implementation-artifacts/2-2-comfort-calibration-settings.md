---
baseline_commit: d85ef5faca1b59fd303720c80af706c2818a5305
---

# Story 2.2: Comfort calibration settings

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user who "runs cold or warm,"
I want to tweak comfort preferences,
so that outfits feel accurate.

## Acceptance Criteria

1. **Slider/Toggle Preferences:** Provide API endpoints to GET and PUT user comfort preferences for:
   - Temperature sensitivity: `runsColdWarm` (enum: `cold`, `neutral`, `warm`)
   - Wind tolerance: `windTolerance` (enum: `low`, `medium`, `high`)
   - Precipitation preparedness: `precipPreparedness` (enum: `low`, `medium`, `high`)
2. **Persistence and Retrieval:**
   - Persist these comfort preferences in the database `ComfortPreferences` table linked to the user's `user_id`.
   - On GET, if no preferences exist for the user, return default values (`neutral` for runsColdWarm, `medium` for windTolerance, and `medium` for precipPreparedness).
3. **Caching & Live Updates:**
   - Updating comfort preferences must invalidate the user's daily outfits recommendations cache in Redis. The cache key pattern is `ritual:{userId}:*`.
   - Ensure `RitualService` correctly detects database updates to `ComfortPreferences` by utilizing the `updated_at` field in its staleness verification, forcing a regeneration of outfit cards.

## Tasks / Subtasks

- [x] **Task 1: Shared Zod HTTP Contract for Comfort Preferences (AC: #1, #2)**
  - [x] Create `packages/api-client/src/contracts/http/comfort.ts` and define:
    - Enums for `comfortRunSchema` (`cold`, `neutral`, `warm`), `windToleranceSchema` (`low`, `medium`, `high`), and `precipPreparednessSchema` (`low`, `medium`, `high`).
    - `comfortPreferencesSchema` containing `runsColdWarm`, `windTolerance`, and `precipPreparedness`.
    - `comfortPreferencesResponseSchema` wrapped in the standard `{ data }` envelope.
    - `updateComfortPreferencesInputSchema` (body matches preferences schema) and `updateComfortPreferencesResponseSchema` wrapped in `{ data }`.
  - [x] Register new contracts in `packages/api-client/src/contracts/http/index.ts`.
  - [x] Register paths (`GET /api/v1/personalization/comfort`, `PUT /api/v1/personalization/comfort`) in `packages/api-client/src/contracts/http/openapi.ts`.
  - [x] Run `npm run generate:api-client` to regenerate OpenAPI specs and HTTP client SDK. Verify `packages/api-client/docs/http.openapi.json` compiles cleanly.
  - [x] Expose the generated types and schemas in the NestJS API contract bridge: `apps/api/src/contracts/http.ts`.

- [x] **Task 2: Comfort Preferences Controller and Service (AC: #1, #2, #3)**
  - [x] Create `apps/api/src/modules/personalization/comfort.service.ts`:
    - `getComfortPreferences(userId: string): Promise<ComfortPreferences>`: Queries `this.prisma.comfortPreferences` by `user_id`, falling back to default enums if null.
    - `updateComfortPreferences(userId: string, data: UpdateComfortPreferencesInput): Promise<ComfortPreferences>`: Upserts the user's settings record and returns the updated state.
  - [x] Add Redis cache invalidation helper:
    - Implement `RitualService.invalidateUserCache(userId: string)` in `apps/api/src/modules/personalization/ritual.service.ts` to scan and delete all keys matching the user pattern `ritual:{userId}:*`.
    - Call this invalidation helper from `updateComfortPreferences` inside the transaction or immediately after DB update.
  - [x] Create `apps/api/src/modules/personalization/comfort.controller.ts`:
    - Define `ComfortController` decorated with `@Controller('/api/v1/personalization/comfort')` and `@UseGuards(RequestAuthGuard)`.
    - Bind `GET` and `PUT` route handlers mapping to the Zod contracts.
    - Handle auth contexts using `@AuthContext() auth: RequestAuthContext` and validate payloads.
  - [x] Register `ComfortController` and `ComfortService` in `apps/api/src/modules/personalization/personalization.module.ts`.

- [x] **Task 3: Unit and Integration Test Verification (AC: #1-#3)**
  - [x] Implement unit tests in `apps/api/src/modules/personalization/comfort.service.spec.ts`:
    - Test default fallback behavior when no preference record exists in DB.
    - Test upsert functionality mapping properties (`runsColdWarm` -> `runs_cold_warm`, etc.).
    - Test Redis cache keys invalidation logic (mocking the Redis client).
  - [x] Implement integration tests in `apps/api/src/modules/personalization/comfort.controller.spec.ts`:
    - Test `GET /api/v1/personalization/comfort` returns 200 with user settings.
    - Test `PUT /api/v1/personalization/comfort` updates settings and returns 200.
    - Verify auth guard returns 401 on unauthenticated calls.
    - Verify request payload validation returns 400 on malformed payloads.
  - [x] Run verification tests locally: `npm run verify:changed` or `npm run validate` to ensure full type-safety and check monorepo compile gates.

## Dev Notes

- **Single Source of Truth:** All HTTP endpoints must be registered under Zod schemas in `packages/api-client/src/contracts/http/`. Always regenerate the API client package before implementing controller logic.
- **Tenant Isolation:** Filter all database queries by the authenticated user's `userId`.
- **Cache Staleness Integrity:** The recommendation engine relies on `ComfortPreferences.updated_at` to invalidate cache records. Make sure the database upsert updates the timestamp correctly.
- **Redis Resilience:** Do not crash the application if Redis connection errors occur during cache invalidation; log the failure using NestJS Logger.

### Project Structure Notes

- Follow flat file structures inside `apps/api/src/modules/personalization/`.
- File naming conventions require lowercase kebab-case (e.g. `comfort.controller.ts`, `comfort.service.ts`).

### References

- [Story 2.1 Scenario Outfit Generator Specification](file:///Users/murat/opensource/couture-cast/_bmad-output/implementation-artifacts/2-1-scenario-outfit-generator.md)
- [Prisma Database Schema](file:///Users/murat/opensource/couture-cast/packages/db/prisma/schema.prisma#L223-L232)
- [Ritual Service Cache & Staleness Logic](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/personalization/ritual.service.ts#L278-L334)
- [Personalization Module](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/personalization/personalization.module.ts)
- [User Fixture Seeding Factory](file:///Users/murat/opensource/couture-cast/packages/testing/src/factories/user.factory.ts#L17)

## Dev Agent Record

### Agent Model Used

Gemini 3.5 Flash (High)

### Debug Log References

- Run command verification succeeded with all 412 unit/integration tests passing.
- Custom linter check auto-fixed formatting and resolved all type issues.

### Completion Notes List

- Implemented Task 1: Defined Zod contract for comfort preferences, registered it, regenerated the API client, and exposed types/schemas in NestJS bridge.
- Implemented Task 2: Created ComfortService and ComfortController. Integrated database persistence (mapping runsColdWarm to runs_cold_warm, etc.). Implemented cache invalidation for the daily outfit recommendation cache (ritual:userId:\*) in RitualService.
- Implemented Task 3: Created full unit tests for ComfortService and integration tests for ComfortController. Validated all endpoints against authentication and request body constraints. All tests passing successfully (19/19 personalization module tests passing; full change-scoped verification runs cleanly).

### File List

- `packages/api-client/src/contracts/http/comfort.ts`
- `packages/api-client/src/contracts/http/index.ts`
- `packages/api-client/src/contracts/http/openapi.ts`
- `apps/api/src/contracts/http.ts`
- `apps/api/src/modules/personalization/comfort.service.ts`
- `apps/api/src/modules/personalization/comfort.controller.ts`
- `apps/api/src/modules/personalization/personalization.module.ts`
- `apps/api/src/modules/personalization/ritual.service.ts`
- `apps/api/src/modules/personalization/comfort.service.spec.ts`
- `apps/api/src/modules/personalization/comfort.controller.spec.ts`
