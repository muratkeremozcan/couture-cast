---
project_name: 'couture-cast'
user_name: 'Murat'
date: '2026-07-17'
sections_completed:
  [
    'technology_stack',
    'language_rules',
    'framework_rules',
    'testing_rules',
    'quality_rules',
    'workflow_rules',
    'anti_patterns',
  ]
existing_patterns_found: 15
status: 'complete'
rule_count: 43
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- Runtime/workspaces: Node.js >=24, npm 10.8.1, Turborepo 2.6.1
- Language: TypeScript 5.9.3 with `strict`, `noUncheckedIndexedAccess`,
  `useUnknownInCatchVariables`, and `isolatedModules`
- API: NestJS 11.1.9, Prisma 6.19.0, Zod 3.x, BullMQ 5.x, Socket.io 4.x
- Web: Next.js 15.5.9, React 19.1.0, Tailwind CSS 3.4.18
- Mobile: Expo 54, Expo Router 6.0.23, React Native 0.81.5, React 19.1.0
- Data/platform: Supabase PostgreSQL, Supabase Auth/Storage, Redis
- Testing/contracts: Vitest 4.0.9, Playwright 1.58.2, Pact 16.4.0,
  OpenAPI 3.1, Optic 1.0.9, Maestro
- Formatting/linting: ESLint 8.57.1, typescript-eslint 8.46.x, Prettier 3.6.2
- Treat package manifests and lockfile as authoritative for installed versions;
  architecture documents may describe older planned versions.

## Critical Implementation Rules

### Language-Specific Rules

- Preserve strict TypeScript guarantees; do not suppress
  `noUncheckedIndexedAccess`, `useUnknownInCatchVariables`, or
  `isolatedModules` errors with broad casts.
- Use `import type` and `export type` for type-only symbols; ESLint enforces both.
- Never leave promises floating. Await them, return them, or explicitly handle
  rejection.
- Narrow caught `unknown` values with `instanceof`, Zod checks, or a focused
  type guard before reading properties.
- In the NestJS NodeNext workspace, include `.js` on relative imports so
  compiled ESM resolves correctly. Follow each app's resolver conventions;
  web uses bundler resolution and mobile supports `@/*`.
- Validate external input and output at runtime with canonical Zod schemas;
  TypeScript types alone are not a trust boundary.
- Prefix intentionally unused parameters with `_`; do not disable the
  unused-variable rule.

### Framework-Specific Rules

- Organize NestJS work feature-first under `apps/api/src/modules/<feature>`;
  keep transport in controllers, business logic in services, and persistence in
  repositories.
- Define every public REST operation first in
  `packages/api-client/src/contracts/http/*`. Controllers, OpenAPI JSON, live
  docs, and generated SDK code are downstream artifacts.
- Keep public endpoints under `/api/v1`; use the shared `{ data }` response
  envelope and validate controller responses against their Zod schema.
- Consume APIs from web/mobile through `@couture/api-client` wrappers. Do not
  add app-local handwritten contract types or fetch clients for public APIs.
- Respect Next.js App Router server/client boundaries. Add `'use client'` only
  where hooks or browser APIs require it; keep route pages server-renderable
  when possible.
- Follow Expo Router file-based routing and use app-local client factories for
  base URL/auth resolution; do not import generated SDK internals directly.
- Register NestJS providers through feature modules and constructor injection;
  avoid cross-feature singleton state.

### Testing Rules

- Colocate API/package unit tests as `*.spec.ts`; colocate web/mobile component
  tests as `*.test.tsx`. Keep Playwright under `playwright/`, Pact under `pact/`,
  k6 under `k6/`, and mobile E2E flows in the Maestro suite.
- Add or update tests in the same change as behavior. Cover controller contract
  parsing, service logic, repository behavior, and failure paths at their
  appropriate boundaries.
- Use shared deterministic factories and cleanup helpers from
  `@couture/testing`; test data must be synthetic, namespaced/idempotent, and
  safe outside production.
- Mock external boundaries, not the unit's internal implementation. Use MSW for
  web/mobile HTTP tests and Nest testing utilities for API units.
- Contract changes require regenerated OpenAPI/SDK artifacts plus Optic and Pact
  validation; never update snapshots/spec artifacts as a substitute for changing
  the canonical Zod contract.
- Run the narrow workspace test while developing, then `npm run verify:changed`;
  use the relevant integration, Playwright, Maestro, Pact, or k6 command when
  the changed boundary requires it.
- Never commit focused tests (`.only`); ESLint rejects them.

### Code Quality & Style Rules

- Use lowercase kebab-case filenames; React components/classes use PascalCase,
  functions and variables use camelCase, and database identifiers use
  snake_case.
- Follow repository Prettier settings: 90-column width, 2 spaces, single quotes,
  no semicolons, and ES5 trailing commas. Do not hand-format around the formatter.
- Keep imports inside declared workspace/package boundaries and use package
  exports or stable wrappers; do not reach into another workspace's private
  implementation.
- Prefer small focused functions and modules; ESLint warns above cyclomatic
  complexity 15. Extract domain decisions instead of suppressing lint rules.
- Export intentional package APIs from the package entry point. Avoid adding
  duplicate utility implementations to apps.
- Keep BMAD-owned documentation under `_bmad-output/`. When product vision,
  personas, or success metrics change, update the brief first and roadmap next,
  retaining their `Updated: YYYY-MM-DD - reason` lines.
- Preserve established owner-anchor comments. If a stable comment cannot live
  in JSON, generated, or environment files, record the exception in
  `owner-anchor-exceptions.md`.

### Development Workflow Rules

- Use Node.js 24+ and npm workspaces. Build required shared packages before
  directly invoking app tools; prefer repository/workspace scripts because
  their `pre*` hooks prepare dependencies.
- Respect the Turbo dependency graph: lint precedes tests and tests precede
  builds. Do not bypass failed prerequisite tasks.
- Use `npm run verify:changed` for change-scoped validation and `npm run validate`
  for the full typecheck, lint, test, and build gate.
- For Prisma changes, edit the schema/migrations in `packages/db`, run the
  repository database generation/migration scripts, and commit required
  migration artifacts. Never hand-edit generated Prisma client output.
- Use Conventional Commits and keep commits scoped. Do not commit secrets,
  production data, personal wardrobe data, or identifiable test fixtures.
- Change installer-managed BMAD configuration through `_bmad/custom/*.toml`;
  direct edits to `_bmad/config.toml` are overwritten on installation.
- Preserve environment separation. Preview/tests must never target production
  Supabase, Redis, storage, analytics, or notification resources.

### Critical Don't-Miss Rules

- Never hand-edit `packages/api-client/src/generated/**` or treat checked-in
  OpenAPI JSON as the source. Change shared Zod contracts, then run
  `npm run generate:api-client` and validate the resulting diff.
- Do not create controller-local DTOs or duplicate public contract schemas.
  Breaking API changes require `/api/v2`; `/api/v1` deprecations remain
  available and documented for at least 90 days.
- Never bypass Supabase JWT validation, NestJS authorization guards, Postgres
  RLS, or guardian-consent checks. Under-16 upload/community functionality must
  remain consent-gated.
- Never log JWTs, service keys, contact details, wardrobe media, or other
  sensitive payloads. Preserve immutable audit events for authentication,
  consent, moderation, and data-export decisions.
- Store timestamps in UTC and expose ISO 8601. Keep canonical weather data in
  metric/°C and convert only at display boundaries.
- Keep queue jobs, webhooks, analytics ingestion, and test setup idempotent.
  Retries must not duplicate notifications, recommendations, or audit records.
- Tests must not make unmocked calls to weather providers or production
  services. Fail closed when environment/resource identity is ambiguous.
- Feature-flagged behavior must include the established fallback path; degraded
  Redis, provider, Socket.io, or analytics dependencies must not break the core
  ritual.

---

## Usage Guidelines

**For AI agents:**

- Read this file before implementing code and follow all applicable rules.
- When rules conflict, prefer current code/configuration and the more restrictive
  security or compatibility requirement.
- Update this file when a new unobvious implementation pattern becomes established.

**For humans:**

- Keep this file lean and focused on agent implementation needs.
- Update it when the stack or project conventions change.
- Review periodically and remove stale or redundant rules.

Last Updated: 2026-07-17
