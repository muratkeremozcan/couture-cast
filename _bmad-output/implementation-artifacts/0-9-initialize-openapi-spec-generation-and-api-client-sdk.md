# Story 0.9: Initialize OpenAPI spec generation and API client SDK

Status: in-progress

## Story

As a frontend developer,
I want type-safe API clients,
so that I can call backend endpoints without manual typing errors and catch breaking changes early.

## Acceptance Criteria

1. Canonical request/response contracts live in shared Zod schemas, and both the checked-in spec
   (`packages/api-client/docs/http.openapi.json`) and the live API contract endpoint
   (`/api/v1/openapi.json`) are derived from those contracts rather than controller decorators.
2. Generate a TypeScript SDK in `packages/api-client/` from the validated canonical contract-derived
   spec, with a stable human-authored wrapper surface for consumers.
3. Implement automated OpenAPI validation and diff checks in CI from the canonical spec file (fail
   PR if breaking changes are introduced without a versioning decision).
4. Web and mobile consume the workspace SDK for at least one real HTTP flow using the generated
   client/types rather than handwritten request typing.
5. Document API versioning and contract authoring rules: `/api/v1` stable; `/api/v2` for breaking
   changes; 90-day deprecation notice; shared Zod contracts are the only source of truth for public
   REST endpoints.

## Simplified target end state

- Author public REST contracts only in `@couture/api-client/src/contracts/http/*`.
- Derive inferred TypeScript types, OpenAPI metadata, and runtime validation from those same Zod
  schemas.
- Generate one canonical spec file from code and validate it before SDK generation.
- Serve `/api/v1/openapi.json` and `/api/docs` from that canonical contract output, not from
  `SwaggerModule.createDocument(...)`.
- Keep Nest controllers/services as thin adapters that parse inputs and shape outputs with shared
  schemas.
- Generate SDKs, docs, and CI diffs only from the canonical spec pipeline above.

## Tasks / Subtasks

- [x] Task 1: Keep Nest Swagger bootstrap as temporary Story 0 scaffolding (supports AC: #1 during migration)
  - [x] Install Swagger dependencies: `npm install @nestjs/swagger swagger-ui-express --workspace apps/api`
  - [x] Initialize Swagger in `apps/api/src/main.ts`:
    ```typescript
    const config = new DocumentBuilder()
      .setTitle('CoutureCast API')
      .setDescription('Weather-intelligent outfit recommendation API')
      .setVersion('1.0')
      .addBearerAuth()
      .build()
    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup('api/docs', app, document)
    ```
  - [x] Add decorators to example controller (health check):
    ```typescript
    @ApiTags('health')
    @ApiOperation({ summary: 'Health check endpoint' })
    @ApiResponse({ status: 200, description: 'Service is healthy' })
    ```
  - [x] Test Swagger UI: navigate to `http://localhost:3001/api/docs`
  - [x] Export OpenAPI JSON: `GET http://localhost:3001/api/v1/openapi.json`
  - Note: This is temporary Story 0 scaffolding so the repo has a live docs surface while the canonical Zod-first contract layer is introduced. It is not the desired long-term source of truth.

- [x] Task 2: Establish Zod-first REST contract foundation (AC: #1, #2)
  - [x] Define shared HTTP contract modules in `packages/api-client/src/contracts/http/` for:
    - common success/error envelopes
    - health endpoints as the initial migration slice
    - at least one non-trivial feature endpoint used by a real client flow
  - [x] Reuse `zod` + `@asteasolutions/zod-to-openapi` so each contract module provides:
    - runtime validation schemas
    - inferred TypeScript types
    - OpenAPI metadata/examples
  - [x] Create `packages/api-client/scripts/generate-http-openapi.ts` that registers the contract modules and writes a canonical spec file (for example `packages/api-client/docs/http.openapi.json`)
  - [x] Add validation coverage that the generated spec is valid OpenAPI and includes the initial migrated contract slice
  - [x] Document the migration rule: new REST endpoints start with shared Zod contracts first, and existing Swagger decorators are transitional until replaced
  - [x] Initial migration slice implemented for:
    - `GET /api/health`
    - `GET /api/v1/health/queues`
    - `GET /api/v1/events/poll`

- [x] Task 3: Generate SDK from the canonical contract-derived spec and add wrapper exports (AC: #2, #4)
  - [x] Install generator tooling only after the canonical Zod-first spec file exists
  - [x] Create `openapitools.json` config pointing at the canonical contract-derived spec
  - [x] Add root generation script(s) so SDK generation does not require a manually running API server
  - [x] Generate TypeScript SDK into `packages/api-client/src/generated/`
  - [x] Create `packages/api-client/src/index.ts`:
    ```typescript
    export * from './generated'
    export { createApiClient } from './client'
    ```
  - [x] Create `packages/api-client/src/client.ts`:

    ```typescript
    import { Configuration, DefaultApi } from './generated'

    export function createApiClient(baseURL: string, accessToken?: string) {
      const config = new Configuration({
        basePath: baseURL,
        accessToken,
      })
      return new DefaultApi(config)
    }
    ```

  - [x] Add runtime dependencies only where the generated client actually requires them

- [x] Task 4: Replace Swagger-authored live docs with the canonical contract output (AC: #1, #2)
  - [x] Update `apps/api/src/openapi.ts` so `/api/v1/openapi.json` serves the canonical
        Zod-generated contract output rather than `SwaggerModule.createDocument(...)`
  - [x] Keep `/api/docs` as a human-friendly viewer, but make it render that same canonical spec
        instead of rebuilding a second spec from decorators
  - [x] Verify the live `/api/v1/openapi.json` output matches the canonical generated document for
        the migrated routes
  - [x] Treat the current Nest Swagger decorator path as scaffolding only; do not extend it to new
        REST endpoints

- [x] Task 5: Finish migrating public REST slices to shared contracts and thin Nest adapters (AC: #1)
  - [x] Create contract modules for the remaining Epic 0 REST slices, including at least:
    - `auth`
    - `user`
    - any additional public REST slice needed before Epic 0 exit
  - [x] Co-locate request schemas, response schemas, error envelopes, inferred types, and OpenAPI
        metadata in those modules
  - [x] Update controllers/services so they parse inputs and shape outputs with shared schemas
        instead of ad hoc DTOs or handwritten response types
  - [x] Remove REST Swagger decorators and doc-only DTOs as each slice migrates
  - [x] Exit criterion: no public REST endpoint used by web/mobile depends on
        decorator-authored schema generation

- [ ] Task 6: Add canonical contract parity tests for the live API (AC: #1, #3)
  - [ ] Keep the package-level canonical spec validation gate in `packages/api-client/testing/`
  - [ ] Add API integration coverage that hits live endpoints and validates response bodies against
        the shared Zod schemas
  - [ ] Add an API-side test that proves the served `/api/v1/openapi.json` contract matches the
        canonical contract builder output
  - [ ] Fail tests when implementation drift appears between controller behavior and shared schemas

- [ ] Task 7: Integrate the generated SDK into real web and mobile runtime paths (AC: #4)
  - [ ] Create app-local client factories that wrap `createApiClient(...)` with each surface's
        environment-driven base URL and auth behavior
  - [ ] Replace at least one handwritten HTTP flow in `apps/web` with the generated client
  - [ ] Replace at least one handwritten HTTP flow in `apps/mobile` with the generated client
  - [ ] Add tests proving those flows compile and execute against the generated client surface

- [ ] Task 8: Implement canonical OpenAPI diff checks in CI (AC: #3)
  - [ ] Install a breaking-change diff tool at the workspace root
  - [ ] Generate base and head specs from the canonical contract code path, not from a manually
        running API server
  - [ ] Run breaking-change detection against `packages/api-client/docs/http.openapi.json`
  - [ ] Fail the PR when breaking changes land without an explicit versioning decision

- [ ] Task 9: Document versioning, contract ownership, and regeneration workflow (AC: #4, #5)
  - [ ] Create `_bmad-output/project-knowledge/api-versioning.md`
  - [ ] Document breaking vs non-breaking contract changes and the 90-day deprecation policy
  - [ ] Define how deprecation metadata is expressed in canonical contract modules and surfaced in
        the generated OpenAPI document
  - [ ] Document contract ownership in architecture docs: shared Zod schemas are canonical and new
        public REST endpoints must start there
  - [ ] Create `packages/api-client/README.md` with SDK usage, auth/error handling, and the exact
        regeneration workflow (`generate:http-openapi` -> validate -> `generate:api-client`)

## Dev Notes

### Architecture Context

**Source: \_bmad-output/planning-artifacts/architecture.md**

**ADR-003 API Contracts (line 220):**

- REST + Next.js BFF with OpenAPI + typed SDK

**API Contracts (lines 166-173):**

- All public endpoints prefixed `/api/v1`
- Authentication via Supabase JWT
- Canonical REST contracts live in shared Zod schemas; the current Swagger route is temporary scaffolding
- Published to `packages/api-client` for typed SDK generation
- Schema drift caught via automated OpenAPI diff checks in CI

**Implementation Patterns (line 146):**

- REST success payloads always `{ data }`, lists add `{ meta: { total, page, pageSize } }`, errors `{ error: { code, message, detail? } }`

**Consistency Rules (line 157):**

- Testing gates: Turborepo runs lint → unit → API schema check (OpenAPI/Zod) → e2e on every PR

### Implementation Patterns

**Temporary Swagger decorator pattern (migration scaffold only):**

```typescript
// apps/api/src/modules/auth/auth.controller.ts
@Controller('auth')
@ApiTags('auth')
export class AuthController {
  @Post('login')
  @ApiOperation({ summary: 'Authenticate user and return JWT' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(loginDto)
  }
}
```

**Target Zod-first client usage pattern:**

```typescript
// apps/web/app/auth/login.tsx
import { createApiClient } from '@couture/api-client'

const apiClient = createApiClient(process.env.NEXT_PUBLIC_API_URL)

async function handleLogin(email: string, password: string) {
  try {
    const response = await apiClient.authLogin({ email, password })
    console.log('Access token:', response.data.accessToken)
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('Invalid credentials')
    }
  }
}
```

### Project Structure Notes

**New Directories:**

```
packages/api-client/
├── src/
│   ├── contracts/
│   │   └── http/               # Canonical Zod request/response contracts
│   ├── generated/              # Auto-generated from the canonical contract-derived spec
│   ├── client.ts               # Wrapper for convenience
│   └── index.ts                # Public exports
├── README.md
└── package.json
apps/api/src/
└── openapi.test.ts             # Validation test
packages/api-client/scripts/
└── generate-http-openapi.ts    # Contract-derived OpenAPI writer
openapitools.json               # Generator config (added after canonical spec exists)
_bmad-output/
└── project-knowledge/
    └── api-versioning.md       # Versioning strategy
.github/workflows/
└── openapi-diff.yml            # Breaking change detection
```

### References

- [Architecture: ADR-003 API Contracts](../planning-artifacts/architecture.md#architecture-decision-records-adrs)
- [Architecture: API Contracts](../planning-artifacts/architecture.md#api-contracts)
- [Epics: Epic 0 Story CC-0.9](../planning-artifacts/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
- [NestJS Swagger](https://docs.nestjs.com/openapi/introduction)
- [OpenAPI Generator](https://openapi-generator.tech/docs/generators/typescript-axios)
- [oasdiff](https://github.com/Tufin/oasdiff)

### Learnings from Previous Stories

**For this story:**

- Canonical HTTP contracts must stay in sync with implementation
- Shared Zod schemas should drive validation, typing, and OpenAPI generation
- SDK regeneration should be automated from the canonical spec, not a manually running server
- Breaking change detection prevents accidental API breakage
- Versioning strategy prevents production disruptions

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm test --workspace api -- openapi.spec.ts` (failed: missing `configureOpenApi`)
- `npm test --workspace api -- openapi.spec.ts` (passed after Swagger wiring)
- `npm test --workspace api`
- `npm run lint --workspace api`
- `npm run typecheck --workspace api`
- `npm uninstall @openapitools/openapi-generator-cli --save-dev`
- `npm uninstall axios --workspace @couture/api-client --workspace web --workspace mobile`
- `npm install --workspace @couture/api-client --save-dev @apidevtools/swagger-parser`
- `npm run gen:openapi:http --workspace @couture/api-client`
- `npm run typecheck --workspace @couture/api-client`
- `npm run lint --workspace @couture/api-client`
- `npm test --workspace @couture/api-client`
- `npm test --workspace api -- openapi.spec.ts api-health.controller.spec.ts events.controller.spec.ts`
- `npm test --workspace @couture/api-client -- --test-name-pattern='generated DefaultApi client'` (failed before wrapper exports existed)
- `npm install --save-dev --save-exact @openapitools/openapi-generator-cli`
- `npm run generate:api-client`
- `npm run build --workspace @couture/api-client`
- `npm run typecheck --workspace web`
- `npm run typecheck --workspace mobile`
- `npm run build --workspace @couture/api-client`
- `npm test --workspace @couture/api-client`
- `npm run typecheck --workspace api` (failed: canonical OpenAPI handoff needed Swagger type normalization)
- `npm test --workspace api` (failed: Swagger UI HTML assertion was stricter than the actual viewer shell)
- `npm run typecheck --workspace api`
- `npm test --workspace api -- openapi.spec.ts`
- `npm run lint --workspace api`
- `npm test --workspace api`
- `npm run typecheck --workspace @couture/api-client`
- `npm run typecheck --workspace api` (failed: API bridge was missing exported GuardianConsentInput/ModerationActionInput types)
- `npm run typecheck --workspace api`
- `npm run gen:openapi:http --workspace @couture/api-client`
- `npm run generate:api-client`
- `npm run build --workspace @couture/api-client`
- `npm run lint --workspace @couture/api-client`
- `npm test --workspace @couture/api-client`
- `npm run lint --workspace api`
- `npm test --workspace api`
- `npm run typecheck --workspace web`
- `npm run typecheck --workspace mobile`
- `npm run typecheck` (failed: generated API files imported unused response model types)
- `npm run generate:api-client`
- `npm run typecheck`
- `npm run lint` (failed: Prettier wanted the touched generated files and story record normalized)
- `npx prettier --write _bmad-output/implementation-artifacts/0-9-initialize-openapi-spec-generation-and-api-client-sdk.md packages/api-client/src/generated/apis/AuthApi.ts packages/api-client/src/generated/apis/EventsApi.ts packages/api-client/src/generated/apis/HealthApi.ts packages/api-client/src/generated/apis/index.ts packages/api-client/src/generated/apis/ModerationApi.ts packages/api-client/src/generated/apis/UserApi.ts packages/api-client/src/generated/default-api.ts packages/api-client/src/generated/index.ts packages/api-client/src/generated/models/index.ts packages/api-client/src/generated/runtime.ts`
- `npm run lint`
- `npm run test`

### Completion Notes List

- Task 1 complete.
- Configured Swagger UI at `/api/docs` and exposed OpenAPI JSON at `/api/v1/openapi.json` via `configureOpenApi`.
- Annotated the two existing health endpoints with Swagger decorators so the document contains tagged health operations.
- Included OpenAPI integration coverage for Swagger UI and JSON export.
- Rolled back the Swagger-derived SDK generation spike after reviewing Zod-first alternatives for a greenfield/reference-quality foundation.
- Rewrote Task 2 onward so shared Zod contracts become the canonical REST contract layer and the current Swagger route is treated as temporary scaffolding only.
- Task 2 complete for the initial migration slice: shared HTTP contracts now cover `/api/health`, `/api/v1/health/queues`, and `/api/v1/events/poll`.
- Added `packages/api-client/scripts/generate-http-openapi.ts` and committed the canonical contract-derived spec at `packages/api-client/docs/http.openapi.json`.
- API controllers/services now validate and shape the migrated health/events responses through shared contract schemas instead of local ad hoc schemas.
- `npm install` emitted Node engine warnings under local Node `v22.12.0`, but install and validations succeeded.
- Task 3 complete.
- Installed `@openapitools/openapi-generator-cli` after the canonical contract-derived spec existed and pinned generator settings in `openapitools.json`.
- Added root `generate:http-openapi` and `generate:api-client` scripts so SDK generation runs from checked-in contracts without a manually running API server.
- Generated the TypeScript SDK into `packages/api-client/src/generated/` and added a postprocess step that normalizes the OpenAPI 3.1 `null` type bug and exposes a `DefaultApi` compatibility wrapper.
- Added `packages/api-client/src/client.ts` plus root exports in `packages/api-client/src/index.ts`, while preserving the existing analytics and realtime exports already consumed by web and mobile.
- No extra runtime dependency was required for the generated client because the selected generator uses platform `fetch`.
- Refined the remaining story tasks so the end state is a single Zod-native contract pipeline:
  contracts author the spec, the API serves that same canonical spec, SDK/CI consume it, and
  Swagger decorator authoring is treated as temporary scaffolding to be removed.
- Task 4 complete.
- `apps/api/src/openapi.ts` now publishes the canonical document from `@couture/api-client/contracts/http` to both `/api/v1/openapi.json` and `/api/docs`, instead of rebuilding a Swagger decorator-authored spec in-process.
- Added API integration assertions that the live `/api/v1/openapi.json` response exactly matches the canonical generated document for `/api/health`, `/api/v1/health/queues`, and `/api/v1/events/poll`.
- Task 5 complete.
- Added shared `auth`, `user`, and `moderation` HTTP contract modules under `packages/api-client/src/contracts/http/`, including request/response schemas, inferred types, documented error payloads, and OpenAPI path registration.
- Added a real authenticated `GET /api/v1/user/profile` API slice backed by Prisma so the first `user` REST contract is DB-backed rather than stubbed.
- Updated auth and moderation controllers/services to consume shared contract schemas instead of local ad hoc Zod definitions, and expanded the request auth role union to include `teen` for authenticated user-profile access.
- Removed the leftover health Swagger decorators now that the live OpenAPI publication path is fully canonical-contract driven.
- Regenerated `packages/api-client/docs/http.openapi.json` and the generated SDK so the checked-in contract, live API publication, and client surface now include `/api/v1/auth/guardian-consent`, `/api/v1/user/profile`, and `/api/v1/moderation/actions`.
- Left `/api/v1/admin/*` out of the canonical public contract set because it remains an operator-only DLQ surface, not a web/mobile client contract.
- Hardened `packages/api-client/scripts/postprocess-generated-sdk.ts` so generated API files drop unused model-type imports, which keeps the repo-level `npm run typecheck` green after regeneration.
- Re-ran the repo-level validation surface after the SDK postprocess fix; `npm run typecheck`, `npm run lint`, and `npm run test` all passed.

### File List

- \_bmad-output/implementation-artifacts/0-9-initialize-openapi-spec-generation-and-api-client-sdk.md
- \_bmad-output/planning-artifacts/architecture.md
- \_bmad-output/planning-artifacts/epics.md
- apps/api/package.json
- apps/api/src/app.module.ts
- apps/api/src/contracts/http.ts
- apps/api/src/controllers/api-health.controller.ts
- apps/api/src/controllers/health.controller.ts
- apps/api/src/modules/auth/auth.controller.ts
- apps/api/src/modules/auth/auth.service.ts
- apps/api/src/modules/auth/security.types.ts
- apps/api/src/modules/events/events.controller.ts
- apps/api/src/modules/events/events.service.ts
- apps/api/src/modules/moderation/moderation.controller.ts
- apps/api/src/modules/moderation/moderation.service.ts
- apps/api/src/modules/user/user.controller.spec.ts
- apps/api/src/modules/user/user.controller.ts
- apps/api/src/modules/user/user.module.ts
- apps/api/src/modules/user/user.service.spec.ts
- apps/api/src/modules/user/user.service.ts
- apps/api/src/main.ts
- apps/api/src/openapi.spec.ts
- apps/api/src/openapi.ts
- package-lock.json
- package.json
- packages/api-client/package.json
- packages/api-client/docs/http.openapi.json
- packages/api-client/scripts/generate-http-openapi.ts
- openapitools.json
- packages/api-client/scripts/postprocess-generated-sdk.ts
- packages/api-client/src/client.ts
- packages/api-client/src/contracts/http/common.ts
- packages/api-client/src/contracts/http/auth.ts
- packages/api-client/src/contracts/http/events.ts
- packages/api-client/src/contracts/http/health.ts
- packages/api-client/src/contracts/http/index.ts
- packages/api-client/src/contracts/http/moderation.ts
- packages/api-client/src/contracts/http/openapi.ts
- packages/api-client/src/contracts/http/user.ts
- packages/api-client/src/generated/apis/AuthApi.ts
- packages/api-client/src/generated/apis/EventsApi.ts
- packages/api-client/src/generated/apis/HealthApi.ts
- packages/api-client/src/generated/apis/index.ts
- packages/api-client/src/generated/apis/ModerationApi.ts
- packages/api-client/src/generated/apis/UserApi.ts
- packages/api-client/src/generated/default-api.ts
- packages/api-client/src/generated/index.ts
- packages/api-client/src/generated/models/index.ts
- packages/api-client/src/generated/runtime.ts
- packages/api-client/src/index.ts
- packages/api-client/testing/generated-client.spec.ts
- packages/api-client/testing/http-openapi.spec.ts

## Change Log

| Date       | Author             | Change                                                                                                         |
| ---------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.9 acceptance criteria                                                          |
| 2026-03-31 | Amelia             | Completed Task 1 Swagger wiring and validation.                                                                |
| 2026-04-01 | Amelia             | Corrected Story 0.9 toward a Zod-first contract architecture and rolled back the Swagger-derived SDK spike.    |
| 2026-04-01 | Amelia             | Completed Task 2 initial Zod-first contract slice for health and polling endpoints.                            |
| 2026-04-03 | Amelia             | Completed Task 3 canonical SDK generation, wrapper exports, and downstream validation for web/mobile.          |
| 2026-04-03 | Amelia             | Refined remaining Story 0.9 tasks to converge on a fully Zod-native end state.                                 |
| 2026-04-06 | Amelia             | Completed Task 4 so live OpenAPI JSON and Swagger UI both publish the canonical contract-derived spec.         |
| 2026-04-06 | Amelia             | Completed Task 5 by migrating auth/user/moderation REST slices into shared contracts and regenerating the SDK. |
| 2026-04-06 | Amelia             | Hardened generated SDK postprocessing to remove unused model imports and revalidated root typecheck/lint/test. |
