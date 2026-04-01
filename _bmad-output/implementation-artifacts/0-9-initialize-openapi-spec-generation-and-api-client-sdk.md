# Story 0.9: Initialize OpenAPI spec generation and API client SDK

Status: in-progress

## Story

As a frontend developer,
I want type-safe API clients,
so that I can call backend endpoints without manual typing errors and catch breaking changes early.

## Acceptance Criteria

1. Define canonical request/response contracts as shared Zod schemas and derive the OpenAPI spec at `/api/v1/openapi.json` from those contracts rather than controller decorators.
2. Generate a TypeScript SDK in `packages/api-client/` from the canonical contract-derived spec.
3. Implement automated OpenAPI diff checks in CI (fail PR if breaking changes are introduced without a versioning decision).
4. Publish SDK to npm workspace so web and mobile apps can import typed client.
5. Document API versioning strategy: `/api/v1` stable; `/api/v2` for breaking changes; 90-day deprecation notice; shared Zod contracts are the source of truth.

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

- [ ] Task 3: Generate SDK from the canonical contract-derived spec and add wrapper exports (AC: #2, #4)
  - [ ] Install generator tooling only after the canonical Zod-first spec file exists
  - [ ] Create `openapitools.json` config pointing at the canonical contract-derived spec
  - [ ] Add root generation script(s) so SDK generation does not require a manually running API server
  - [ ] Generate TypeScript SDK into `packages/api-client/src/generated/`
  - [ ] Create `packages/api-client/src/index.ts`:
    ```typescript
    export * from './generated'
    export { createApiClient } from './client'
    ```
  - [ ] Create `packages/api-client/src/client.ts`:

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

  - [ ] Add runtime dependencies only where the generated client actually requires them

- [ ] Task 4: Implement OpenAPI diff check in CI (AC: #3)
  - [ ] Install diff tool: `npm install oasdiff --save-dev --workspace-root`
  - [ ] Create `.github/workflows/openapi-diff.yml`:
    ```yaml
    name: OpenAPI Breaking Change Detection
    on: pull_request
    jobs:
      diff:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
            with:
              fetch-depth: 0
          - name: Setup Node
            uses: actions/setup-node@v4
            with:
              node-version-file: '.nvmrc'
          - name: Install dependencies
            run: npm ci
          - name: Generate current spec
            run: |
              npm run generate:http-openapi
              cp packages/api-client/docs/http.openapi.json packages/api-client/docs/http.openapi.new.json
          - name: Checkout base branch
            run: git checkout ${{ github.base_ref }}
          - name: Generate base spec
            run: |
              npm run generate:http-openapi
              cp packages/api-client/docs/http.openapi.json packages/api-client/docs/http.openapi.base.json
          - name: Run diff check
            run: |
              npx oasdiff breaking \
                packages/api-client/docs/http.openapi.base.json \
                packages/api-client/docs/http.openapi.new.json
              if [ $? -ne 0 ]; then
                echo "::error::Breaking changes detected. Bump API version or fix compatibility."
                exit 1
              fi
    ```
  - [ ] Test workflow: make breaking change, verify CI fails

- [ ] Task 5: Document API versioning strategy (AC: #5)
  - [ ] Create `_bmad-output/project-knowledge/api-versioning.md`:
    - **Version Strategy**: `/api/v1` for current stable, `/api/v2` for breaking changes
    - **Breaking Change**: Remove endpoint, change required field, change response structure
    - **Non-Breaking**: Add optional field, add new endpoint, deprecate endpoint (with 90-day notice)
    - **Deprecation Policy**: Announce in canonical contract metadata / `/api/v1/openapi.json`, log warnings, remove after 90 days
  - [ ] Define how deprecation metadata is expressed in the canonical contract modules and surfaced in `/api/v1/openapi.json`
  - [ ] Document contract ownership in architecture doc: shared Zod schemas are canonical; controller decorators are transitional until migration completes

- [ ] Task 6: Migrate planned REST endpoints to canonical Zod contracts and thin Nest adapters (AC: #1)
  - [ ] Create contract modules for the planned Epic 0 slices:
    - `health`
    - `auth`
    - `user`
  - [ ] Co-locate request/response schemas, inferred types, and OpenAPI metadata in those contract modules
  - [ ] Update controllers/services so they consume shared contract schemas instead of ad hoc request/response typing
  - [ ] Keep Swagger decorators only where needed temporarily until the controller surface is fully migrated

- [ ] Task 7: Integrate SDK in web and mobile apps (AC: #4)
  - [ ] Update `apps/web/package.json` to depend on `@couture/api-client`
  - [ ] Update `apps/mobile/package.json` to depend on `@couture/api-client`
  - [ ] Create API client instance in web app:
    ```typescript
    // apps/web/lib/api.ts
    import { createApiClient } from '@couture/api-client'
    export const apiClient = createApiClient(process.env.NEXT_PUBLIC_API_URL)
    ```
  - [ ] Create API client instance in mobile app:
    ```typescript
    // apps/mobile/services/api.ts
    import { createApiClient } from '@couture/api-client'
    export const apiClient = createApiClient(process.env.EXPO_PUBLIC_API_URL)
    ```
  - [ ] Test API call: `await apiClient.healthCheck()`

- [ ] Task 8: Add OpenAPI validation in tests (AC: #3)
  - [ ] Install validation library: `npm install swagger-parser --save-dev --workspace apps/api`
  - [ ] Create test `apps/api/src/openapi.test.ts`:

    ```typescript
    import SwaggerParser from 'swagger-parser'

    it('should generate valid OpenAPI 3.0 spec', async () => {
      const spec = await readFile(
        'packages/api-client/docs/http.openapi.json',
        'utf8'
      ).then(JSON.parse)
      await expect(SwaggerParser.validate(spec)).resolves.toBeDefined()
    })
    ```

  - [ ] Run test in CI after contract-generation step

- [ ] Task 9: Document SDK usage patterns (AC: #4, #5)
  - [ ] Create `packages/api-client/README.md` with examples:
    - Installation
    - Creating client instance
    - Making authenticated requests
    - Error handling
    - TypeScript type inference
  - [ ] Add example usage in `_bmad-output/project-knowledge/api-versioning.md`
  - [ ] Document how to regenerate the canonical spec and SDK after contract changes

- [ ] Task 10: Set up automatic SDK regeneration (AC: #2)
  - [ ] Add npm script(s) to regenerate contracts/spec/SDK on demand:
    ```json
    {
      "scripts": {
        "generate:http-openapi": "tsx packages/api-client/scripts/generate-http-openapi.ts",
        "generate:api-client": "npm run generate:http-openapi && openapi-generator-cli generate --generator-key api-client"
      }
    }
    ```
  - [ ] Document regeneration workflow in `packages/api-client/README.md`

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

### File List

- \_bmad-output/implementation-artifacts/0-9-initialize-openapi-spec-generation-and-api-client-sdk.md
- \_bmad-output/planning-artifacts/architecture.md
- \_bmad-output/planning-artifacts/epics.md
- apps/api/package.json
- apps/api/src/contracts/http.ts
- apps/api/src/controllers/api-health.controller.ts
- apps/api/src/controllers/health.controller.ts
- apps/api/src/modules/events/events.controller.ts
- apps/api/src/modules/events/events.service.ts
- apps/api/src/main.ts
- apps/api/src/openapi.spec.ts
- apps/api/src/openapi.ts
- package-lock.json
- package.json
- packages/api-client/package.json
- packages/api-client/docs/http.openapi.json
- packages/api-client/scripts/generate-http-openapi.ts
- packages/api-client/src/contracts/http/common.ts
- packages/api-client/src/contracts/http/events.ts
- packages/api-client/src/contracts/http/health.ts
- packages/api-client/src/contracts/http/index.ts
- packages/api-client/src/contracts/http/openapi.ts
- packages/api-client/src/index.ts
- packages/api-client/testing/http-openapi.spec.ts

## Change Log

| Date       | Author             | Change                                                                                                      |
| ---------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.9 acceptance criteria                                                       |
| 2026-03-31 | Amelia             | Completed Task 1 Swagger wiring and validation.                                                             |
| 2026-04-01 | Amelia             | Corrected Story 0.9 toward a Zod-first contract architecture and rolled back the Swagger-derived SDK spike. |
| 2026-04-01 | Amelia             | Completed Task 2 initial Zod-first contract slice for health and polling endpoints.                         |
