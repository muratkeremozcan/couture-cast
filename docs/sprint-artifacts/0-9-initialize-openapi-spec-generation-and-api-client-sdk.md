# Story 0.9: Initialize OpenAPI spec generation and API client SDK

Status: drafted

## Story

As a frontend developer,
I want type-safe API clients,
so that I can call backend endpoints without manual typing errors and catch breaking changes early.

## Acceptance Criteria

1. Add NestJS Swagger decorators to all API controllers; generate OpenAPI spec at `/api/v1/openapi.json`.
2. Configure `@openapitools/openapi-generator-cli` to produce TypeScript SDK in `packages/api-client/`.
3. Implement automated OpenAPI diff checks in CI (fail PR if breaking changes detected without version bump).
4. Publish SDK to npm workspace so web and mobile apps can import typed client.
5. Document API versioning strategy: `/api/v1` stable; `/api/v2` for breaking changes; deprecation policy (90-day notice).

## Tasks / Subtasks

- [ ] Task 1: Add NestJS Swagger decorators (AC: #1)
  - [ ] Install Swagger dependencies: `npm install @nestjs/swagger swagger-ui-express --workspace apps/api`
  - [ ] Initialize Swagger in `apps/api/src/main.ts`:
    ```typescript
    const config = new DocumentBuilder()
      .setTitle('CoutureCast API')
      .setDescription('Weather-intelligent outfit recommendation API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    ```
  - [ ] Add decorators to example controller (health check):
    ```typescript
    @ApiTags('health')
    @ApiOperation({ summary: 'Health check endpoint' })
    @ApiResponse({ status: 200, description: 'Service is healthy' })
    ```
  - [ ] Test Swagger UI: navigate to `http://localhost:3001/api/docs`
  - [ ] Export OpenAPI JSON: `GET http://localhost:3001/api/v1/openapi.json`

- [ ] Task 2: Configure OpenAPI generator CLI (AC: #2)
  - [ ] Install generator: `npm install @openapitools/openapi-generator-cli --save-dev --workspace-root`
  - [ ] Create `openapitools.json` config:
    ```json
    {
      "generator-cli": {
        "version": "7.2.0",
        "generators": {
          "typescript-axios": {
            "inputSpec": "http://localhost:3001/api/v1/openapi.json",
            "output": "packages/api-client/src/generated",
            "generatorName": "typescript-axios"
          }
        }
      }
    }
    ```
  - [ ] Add generation script to root `package.json`:
    ```json
    {
      "scripts": {
        "generate:api-client": "openapi-generator-cli generate"
      }
    }
    ```
  - [ ] Run generator: `npm run generate:api-client`
  - [ ] Verify generated files in `packages/api-client/src/generated/`

- [ ] Task 3: Create typed API client wrapper (AC: #4)
  - [ ] Create `packages/api-client/src/index.ts`:
    ```typescript
    export * from './generated';
    export { createApiClient } from './client';
    ```
  - [ ] Create `packages/api-client/src/client.ts`:
    ```typescript
    import { Configuration, DefaultApi } from './generated';

    export function createApiClient(baseURL: string, accessToken?: string) {
      const config = new Configuration({
        basePath: baseURL,
        accessToken,
      });
      return new DefaultApi(config);
    }
    ```
  - [ ] Add `packages/api-client/package.json`:
    ```json
    {
      "name": "@couture-cast/api-client",
      "version": "0.1.0",
      "main": "src/index.ts",
      "dependencies": {
        "axios": "^1.6.0"
      }
    }
    ```

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
          - name: Start API server
            run: npm run dev:api &
          - name: Wait for API
            run: npx wait-on http://localhost:3001/api/health
          - name: Download current spec
            run: curl http://localhost:3001/api/v1/openapi.json > openapi-new.json
          - name: Checkout base branch
            run: git checkout ${{ github.base_ref }}
          - name: Start API server (base)
            run: npm run dev:api &
          - name: Wait for API
            run: npx wait-on http://localhost:3001/api/health
          - name: Download base spec
            run: curl http://localhost:3001/api/v1/openapi.json > openapi-base.json
          - name: Run diff check
            run: |
              npx oasdiff breaking openapi-base.json openapi-new.json
              if [ $? -ne 0 ]; then
                echo "::error::Breaking changes detected. Bump API version or fix compatibility."
                exit 1
              fi
    ```
  - [ ] Test workflow: make breaking change, verify CI fails

- [ ] Task 5: Document API versioning strategy (AC: #5)
  - [ ] Create `docs/api-versioning.md`:
    - **Version Strategy**: `/api/v1` for current stable, `/api/v2` for breaking changes
    - **Breaking Change**: Remove endpoint, change required field, change response structure
    - **Non-Breaking**: Add optional field, add new endpoint, deprecate endpoint (with 90-day notice)
    - **Deprecation Policy**: Announce in `/api/v1/openapi.json` metadata, log warnings, remove after 90 days
  - [ ] Add deprecation decorator:
    ```typescript
    @ApiOperation({ deprecated: true, summary: 'Use /v2/endpoint instead' })
    ```
  - [ ] Document in architecture doc

- [ ] Task 6: Add OpenAPI decorators to all planned controllers (AC: #1)
  - [ ] Create placeholder controllers for Epic 0:
    - `HealthController` (already done)
    - `AuthController` (login, register, refresh token)
    - `UserController` (profile, preferences)
  - [ ] Add decorators to each endpoint:
    ```typescript
    @ApiTags('auth')
    @ApiOperation({ summary: 'User login' })
    @ApiBody({ type: LoginDto })
    @ApiResponse({ status: 200, type: AuthResponseDto })
    @ApiResponse({ status: 401, description: 'Invalid credentials' })
    ```
  - [ ] Create DTOs with validation decorators:
    ```typescript
    export class LoginDto {
      @ApiProperty()
      @IsEmail()
      email: string;

      @ApiProperty()
      @IsString()
      password: string;
    }
    ```

- [ ] Task 7: Integrate SDK in web and mobile apps (AC: #4)
  - [ ] Update `apps/web/package.json` to depend on `@couture-cast/api-client`
  - [ ] Update `apps/mobile/package.json` to depend on `@couture-cast/api-client`
  - [ ] Create API client instance in web app:
    ```typescript
    // apps/web/lib/api.ts
    import { createApiClient } from '@couture-cast/api-client';
    export const apiClient = createApiClient(process.env.NEXT_PUBLIC_API_URL);
    ```
  - [ ] Create API client instance in mobile app:
    ```typescript
    // apps/mobile/services/api.ts
    import { createApiClient } from '@couture-cast/api-client';
    export const apiClient = createApiClient(process.env.EXPO_PUBLIC_API_URL);
    ```
  - [ ] Test API call: `await apiClient.healthCheck()`

- [ ] Task 8: Add OpenAPI validation in tests (AC: #3)
  - [ ] Install validation library: `npm install swagger-parser --save-dev --workspace apps/api`
  - [ ] Create test `apps/api/src/openapi.test.ts`:
    ```typescript
    import SwaggerParser from 'swagger-parser';

    it('should generate valid OpenAPI 3.0 spec', async () => {
      const spec = await fetch('http://localhost:3001/api/v1/openapi.json').then(r => r.json());
      await expect(SwaggerParser.validate(spec)).resolves.toBeDefined();
    });
    ```
  - [ ] Run test in CI after API starts

- [ ] Task 9: Document SDK usage patterns (AC: #4, #5)
  - [ ] Create `packages/api-client/README.md` with examples:
    - Installation
    - Creating client instance
    - Making authenticated requests
    - Error handling
    - TypeScript type inference
  - [ ] Add example usage in `docs/api-versioning.md`
  - [ ] Document how to regenerate SDK after API changes

- [ ] Task 10: Set up automatic SDK regeneration (AC: #2)
  - [ ] Add `postinstall` script to root `package.json`:
    ```json
    {
      "scripts": {
        "postinstall": "npm run generate:api-client || echo 'API not running, skipping SDK generation'"
      }
    }
    ```
  - [ ] Add npm script to regenerate on API changes:
    ```json
    {
      "scripts": {
        "dev:api:watch": "concurrently \"npm run dev:api\" \"nodemon --watch apps/api/src --exec npm run generate:api-client\""
      }
    }
    ```
  - [ ] Document regeneration workflow in `packages/api-client/README.md`

## Dev Notes

### Architecture Context

**Source: docs/bmm-architecture-20251110.md**

**ADR-003 API Contracts (line 220):**
- REST + Next.js BFF with OpenAPI + typed SDK

**API Contracts (lines 166-173):**
- All public endpoints prefixed `/api/v1`
- Authentication via Supabase JWT
- OpenAPI spec generated from NestJS decorators
- Published to `packages/api-client` for typed SDK generation
- Schema drift caught via automated OpenAPI diff checks in CI

**Implementation Patterns (line 146):**
- REST success payloads always `{ data }`, lists add `{ meta: { total, page, pageSize } }`, errors `{ error: { code, message, detail? } }`

**Consistency Rules (line 157):**
- Testing gates: Turborepo runs lint → unit → API schema check (OpenAPI/Zod) → e2e on every PR

### Implementation Patterns

**Swagger Decorator Pattern:**
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
    return this.authService.login(loginDto);
  }
}
```

**Client Usage Pattern:**
```typescript
// apps/web/app/auth/login.tsx
import { createApiClient } from '@couture-cast/api-client';

const apiClient = createApiClient(process.env.NEXT_PUBLIC_API_URL);

async function handleLogin(email: string, password: string) {
  try {
    const response = await apiClient.authLogin({ email, password });
    console.log('Access token:', response.data.accessToken);
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('Invalid credentials');
    }
  }
}
```

### Project Structure Notes

**New Directories:**
```
packages/api-client/
├── src/
│   ├── generated/              # Auto-generated by OpenAPI generator
│   │   ├── api.ts
│   │   ├── models.ts
│   │   └── configuration.ts
│   ├── client.ts               # Wrapper for convenience
│   └── index.ts                # Public exports
├── README.md
└── package.json
apps/api/src/
├── dto/                        # DTOs with decorators
│   ├── login.dto.ts
│   ├── auth-response.dto.ts
│   └── ...
└── openapi.test.ts             # Validation test
openapitools.json               # Generator config
docs/
└── api-versioning.md           # Versioning strategy
.github/workflows/
└── openapi-diff.yml            # Breaking change detection
```

### References

- [Architecture: ADR-003 API Contracts](docs/bmm-architecture-20251110.md#architecture-decision-records-adrs)
- [Architecture: API Contracts](docs/bmm-architecture-20251110.md#api-contracts)
- [Epics: Epic 0 Story CC-0.9](docs/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
- [NestJS Swagger](https://docs.nestjs.com/openapi/introduction)
- [OpenAPI Generator](https://openapi-generator.tech/docs/generators/typescript-axios)
- [oasdiff](https://github.com/Tufin/oasdiff)

### Learnings from Previous Stories

**For this story:**
- OpenAPI spec must stay in sync with implementation
- SDK regeneration should be automated
- Breaking change detection prevents accidental API breakage
- Type-safe clients catch errors at compile time
- Versioning strategy prevents production disruptions

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

<!-- Will be filled by dev agent -->

### Debug Log References

<!-- Will be filled by dev agent during implementation -->

### Completion Notes List

<!-- Will be filled by dev agent upon completion -->

### File List

<!-- Will be filled by dev agent with NEW/MODIFIED/DELETED files -->

## Change Log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.9 acceptance criteria |
