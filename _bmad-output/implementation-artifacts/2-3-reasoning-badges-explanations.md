---
baseline_commit: 797023c843217874eb7c4e89628f85ed2cf1343d
---

# Story 2.3: Reasoning badges & explanations

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to understand why an outfit is suggested,
so that I trust the recommendation.

## Acceptance Criteria

1. **Weather Trigger Badge Generation:** Display reasoning badges mapped to weather and scenario triggers using these canonical keys:
   - `wind_layer` (Wind layer): Triggered if wind speed exceeds user wind tolerance threshold.
   - `rain_ready` (Rain-ready): Triggered if precipitation probability or precipitation amount exceeds user precipitation preparedness threshold.
   - `evening_chill` (Evening chill): Triggered if scenario is `evening` and adjusted feels-like temperature is < 15°C.
   - Fallback temperature/scenario badges when no alerts trigger:
     - `commute_warmth` (Commute warmth): Triggered if scenario is `morning` and adjusted feels-like temp is < 12°C.
     - `sun_protection` (Sun protection): Triggered if clear skies and adjusted feels-like temp is >= 22°C.
     - `light_layers` (Light layers): Triggered if adjusted feels-like temp is between 15°C and 22°C.
     - `breathable_comfort` (Breathable comfort): Triggered if adjusted feels-like temp is >= 25°C.
     - `daily_base` (Daily base): Default fallback condition.
2. **Structured Explanation Bullets (Rationale):** Each badge must provide a list of dynamic explanation bullet strings (served via `bullets` array in API) to feed the quick explanation tooltip/modal on the UI.
   - Interpolate forecast parameters and user settings dynamically (e.g. "Wind speed is 8.5 m/s, which exceeds your wind tolerance threshold of 6 m/s").
3. **API Contract Alignment (Shared Zod Contract):** Update the canonical REST contract `scenarioOutfitSchema` in `packages/api-client/src/contracts/http/ritual.ts` so that `reasoningBadges` is represented as an array of objects matching `{ key: string, label: string, bullets: string[] }`.
4. **Internationalization Readiness:** Badge text (using the `key` property) must support the localization system, enabling translations via client-side translation JSON files once the localization infrastructure (CC-3.2) is built.

## Tasks / Subtasks

- [x] **Task 1: Shared Zod Http Contract Update (AC: #3, #4)**
  - [x] Update `packages/api-client/src/contracts/http/ritual.ts`:
    - Redefine `reasoningBadges` property of `scenarioOutfitSchema` to:
      ```typescript
      reasoningBadges: z.array(
        z.object({
          key: nonEmptyStringSchema.describe('Unique key for the badge.'),
          label: nonEmptyStringSchema.describe('Localized default label for the badge.'),
          bullets: z
            .array(z.string())
            .describe('Explanatory bullet points explaining why the badge triggered.'),
        })
      )
      ```
  - [x] Run `npm run generate:api-client` in the project root to rebuild contracts/OpenAPI specs and the HTTP client SDK.
  - [x] Verify that `packages/api-client/docs/http.openapi.json` is regenerated with the new schema definition.

- [x] **Task 2: API Personalization Module & Seed Updates (AC: #1, #2, #4)**
  - [x] Update `apps/api/src/modules/personalization/ritual.service.ts`:
    - Refactor the badge generation logic inside `getOrCreateRitual` method to produce the new structured badge shape `{ key, label, bullets }`.
    - Dynamically interpolate values into the bullet strings (such as actual wind speed, precipitation probability, adjusted feels-like temperature, and the user's specific tolerance thresholds).
    - Ensure that the compiled general `badges` array returned at the root level of `ritualResponseSchema` (derived via `new Set(...)` over all outfit badges) continues to return simple string values or array of strings, conforming to the contract.
  - [x] Refactor `packages/testing/src/factories/ritual.factory.ts` (Ritual Factory):
    - Update `RitualReasoningBadge` interface to include `key: string`, `label: string`, `bullets: string[]`.
    - Update `buildDefaultReasoningBadges` to return structured array values.
  - [x] Refactor `packages/db/prisma/seeds/rituals.ts` (Prisma Seed):
    - Update seed data calls to `createRitual` to provide structured badge objects.

- [x] **Task 3: Pact Consumer & Provider Interaction Verification (AC: #3)**
  - [x] Update consumer interactions in `pact/http/consumer/api-contract-interactions.ts` to expect the structured `{ key, label, bullets }` objects in `reasoningBadges` array.
  - [x] Update provider state mocks in `pact/http/provider/provider-helper.ts` to return the structured `reasoningBadges` JSON payload.
  - [x] Verify contract validation by running consumer and provider tests (e.g. `npm run test:pact`).

- [x] **Task 4: Test Suite Validation & Verification (AC: #1, #2, #3)**
  - [x] Update unit tests in `apps/api/src/modules/personalization/ritual.service.spec.ts`:
    - Adjust assertion expectations from `{ label: 'Wind layer' }` to expect the complete object `{ key: 'wind_layer', label: 'Wind layer', bullets: expect.any(Array) }`, etc.
    - Add unit tests verifying that bullets contain the correct interpolated values for temperature sensitivity adjustments, wind thresholds, and precipitation conditions.
  - [x] Update integration tests in `apps/api/src/modules/personalization/ritual.controller.spec.ts`:
    - Ensure `/api/v1/ritual` GET handler successfully returns the structured payload conforming to the updated contract.
  - [x] Run changed workspace validation using `npm run verify:changed` or `npm run validate` to verify typechecks and that formatting rules are clean.

### Review Findings

- [x] [Review][Patch] Unsafe Prisma JSON Field Mapping (Prisma DbNull/JsonNull) [apps/api/src/modules/personalization/ritual.service.ts:763]
- [x] [Review][Patch] Unsafe Array Element Mapping (Null/Invalid Array Elements) [apps/api/src/modules/personalization/ritual.service.ts:769]
- [x] [Review][Patch] Inconsistent Key Derivation for Kebab-Case Labels [apps/api/src/modules/personalization/ritual.service.ts:771]
- [x] [Review][Patch] Faulty Fallback Label for Custom Keys [apps/api/src/modules/personalization/ritual.service.ts:772]
- [x] [Review][Patch] Redundant User-Facing Output in daily_base Badge [apps/api/src/modules/personalization/ritual.service.ts:656]
- [x] [Review][Patch] Boundary Rounding Contradictions in Temperature Explanations [apps/api/src/modules/personalization/ritual.service.ts:590]
- [x] [Review][Patch] Floating-Point Exposure in Weather Metrics [apps/api/src/modules/personalization/ritual.service.ts:540]
- [x] [Review][Patch] Missing String Type Enforcement on Bullets [apps/api/src/modules/personalization/ritual.service.ts:773]
- [x] [Review][Patch] Non-canonical badge keys used in seed data and testing factories [packages/db/prisma/seeds/rituals.ts:33]
- [x] [Review][Patch] Incomplete Assertions in Contract Verification [pact/http/consumer/api-contract-interactions.ts:258]
- [x] [Review][Patch] Undertested Trigger Paths in Service Spec [apps/api/src/modules/personalization/ritual.service.spec.ts:417]
- [x] [Review][Patch] Zod schema description block removed from reasoningBadges array definition [packages/api-client/src/contracts/http/ritual.ts:16]
- [x] [Review][Patch] Explicit assertions for reasoningBadges in integration tests [apps/api/src/modules/personalization/ritual.controller.spec.ts:283]

## Dev Notes

### Architecture Patterns & Constraints

- **Single Source of Truth:** All HTTP endpoints must be registered under Zod schemas in `packages/api-client/src/contracts/http/`. Do not write controllers before contracts.
- **Tenant Isolation:** Filter all database queries by the authenticated user's `userId`. Enforce RLS rules.
- **Observability:** Instrument error outcomes, cache hit/miss ratio, and execution latency. Use `Pino` logger with requestId context.
- **Redis Cache Serialization:** Ensure cache payloads containing the new structured JSON are serialized and deserialized cleanly. Cache keys match `ritual:{userId}:{locationKey}`.
- **Database Schema & Migrations:** Since `OutfitRecommendation.reasoning_badges` is a `Json` column in the Prisma schema, **no schema modification or database migration is required** for this story.
- **Strict Response Validation:** Because the NestJS controller strictly validates output using `ritualResponseSchema.parse()`, mock factories and seed scripts must be updated synchronously to prevent database validation failures and runtime `InternalServerErrorException` crashes.

### Source Tree Components to Touch

- API Contracts: [ritual.ts](file:///Users/murat/opensource/couture-cast/packages/api-client/src/contracts/http/ritual.ts)
- Business Logic: [ritual.service.ts](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/personalization/ritual.service.ts)
- Unit Tests: [ritual.service.spec.ts](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/personalization/ritual.service.spec.ts)
- Integration Tests: [ritual.controller.spec.ts](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/personalization/ritual.controller.spec.ts)
- Mock Factories: [ritual.factory.ts](file:///Users/murat/opensource/couture-cast/packages/testing/src/factories/ritual.factory.ts)
- Prisma Seed Script: [seeds/rituals.ts](file:///Users/murat/opensource/couture-cast/packages/db/prisma/seeds/rituals.ts)
- Pact Interactions:
  - Consumer: [api-contract-interactions.ts](file:///Users/murat/opensource/couture-cast/pact/http/consumer/api-contract-interactions.ts)
  - Provider: [provider-helper.ts](file:///Users/murat/opensource/couture-cast/pact/http/provider/provider-helper.ts)

### Testing Standards

- Colocate specifications alongside source files (e.g. `ritual.service.spec.ts`).
- Enforce full code coverage on personalization matching rules.
- Verify contract compatibility using Optic in CI checks.
- Avoid `.only` in tests.

### Project Structure Notes

- Keep module files flat inside `apps/api/src/modules/personalization/`.
- Ensure new schemas follow camelCase for fields and uppercase for schemas, and fit standard response envelopes (`{ data }` or `{ error }`).
- Formatting: Follow repository Prettier rules (90-column line width limit, 2-space indents, no semicolons, single quotes).

### References

- Prisma Schema: [schema.prisma](file:///Users/murat/opensource/couture-cast/packages/db/prisma/schema.prisma#L270-L284)
- Previous Story: [2-2-comfort-calibration-settings.md](file:///Users/murat/opensource/couture-cast/_bmad-output/implementation-artifacts/2-2-comfort-calibration-settings.md)
- Epics Document: [epics.md](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/epics.md#L270-L278)

## Dev Agent Record

### Agent Model Used

Gemini 3.5 Flash (High)

### Debug Log References

- Run command verification succeeded with all unit, integration, and Pact contract tests passing successfully.
- Code formatter checks auto-resolved formatting styles in all workspaces.

### Completion Notes List

- Updated Zod HTTP contract `scenarioOutfitSchema` in `packages/api-client/src/contracts/http/ritual.ts` so `reasoningBadges` is represented as `{ key: string, label: string, bullets: string[] }[]`.
- Rebuilt client SDK using `npm run generate:api-client`.
- Refactored badge generation logic inside `getOrCreateRitual` in `apps/api/src/modules/personalization/ritual.service.ts` to construct badges and dynamic rationales.
- Refactored test factory `RitualReasoningBadge` interface and mock generator in `packages/testing/src/factories/ritual.factory.ts`.
- Refactored database seeding mock structures in `packages/db/prisma/seeds/rituals.ts`.
- Updated contract interactions in `pact/http/consumer/api-contract-interactions.ts` and `pact/http/provider/provider-helper.ts`.
- Added unit tests checking the key/label/bullet trigger rules in `apps/api/src/modules/personalization/ritual.service.spec.ts`.

### File List

- `packages/api-client/src/contracts/http/ritual.ts`
- `apps/api/src/generated/models/index.ts`
- `packages/api-client/docs/http.openapi.json`
- `apps/api/src/modules/personalization/ritual.service.ts`
- `packages/testing/src/factories/ritual.factory.ts`
- `packages/db/prisma/seeds/rituals.ts`
- `pact/http/consumer/api-contract-interactions.ts`
- `pact/http/provider/provider-helper.ts`
- `apps/api/src/modules/personalization/ritual.service.spec.ts`
