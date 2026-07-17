# CoutureCast project knowledge index

Updated: 2026-07-17 - Removed redundant API and transitional ADR placeholders.

## Scan record

- Generated: 2026-07-17
- Scan mode: initial scan, deep brownfield analysis
- Repository: npm/Turborepo monorepo with five logical parts
- Primary language: TypeScript
- Scan window: 2026-07-17 05:17-05:47 UTC-5
- Completion: all expected deep-scan documents were generated

Start with the [project overview](./project-overview.md), then use the part-specific architecture
and inventory links below. For implementation work, also load the
[AI project context](../project-context.md).

## Project overview

CoutureCast is a TypeScript npm-workspaces monorepo orchestrated by Turborepo. Its implemented
architecture is a NestJS modular monolith with a companion BullMQ worker, a Next.js App Router web
client, an Expo Router mobile client, a Supabase PostgreSQL/Prisma data layer, and shared TypeScript
libraries. Web and mobile communicate with the API over HTTPS; the API and worker use PostgreSQL,
Redis, external weather providers, Expo Push, PostHog, and OpenTelemetry.

The repository contains substantial backend and platform foundations, but it is not yet a
production-complete end-user product. In particular, client authentication, hosted workers, and
several planned product surfaces remain incomplete. See the
[integration architecture](./integration-architecture.md) for implemented boundaries and the
[source tree analysis](./source-tree-analysis.md) for current ownership.

## Five-part quick reference

### API

- Type: backend application
- Stack: Node.js 24, TypeScript 5.9, NestJS 11, Prisma 6.19, BullMQ 5, Redis, and Socket.io 4
- Root: [`apps/api`](../../apps/api/)
- Entry points: [`src/main.ts`](../../apps/api/src/main.ts),
  [`api/index.ts`](../../apps/api/api/index.ts), and
  [`src/workers/bootstrap.ts`](../../apps/api/src/workers/bootstrap.ts)
- Composition root: [`src/app.module.ts`](../../apps/api/src/app.module.ts)
- Architecture: [API architecture](./architecture-api.md)

### Web

- Type: web application
- Stack: Next.js 15 App Router, React 19, TypeScript 5.9, Tailwind CSS 3.4, and PostHog
- Root: [`apps/web`](../../apps/web/)
- Entry points: [`src/app/layout.tsx`](../../apps/web/src/app/layout.tsx),
  [`src/app/page.tsx`](../../apps/web/src/app/page.tsx), and
  [`instrumentation-client.ts`](../../apps/web/instrumentation-client.ts)
- Client boundary: [`src/lib/api-client.ts`](../../apps/web/src/lib/api-client.ts)
- Architecture: [web architecture](./architecture-web.md)

### Mobile

- Type: mobile application
- Stack: Expo 54, Expo Router 6, React Native 0.81, React 19, TypeScript 5.9, and PostHog
- Root: [`apps/mobile`](../../apps/mobile/)
- Entry points: [`app/_layout.tsx`](../../apps/mobile/app/_layout.tsx) and
  [`app/(tabs)/index.tsx`](<../../apps/mobile/app/(tabs)/index.tsx>)
- Package entry: `expo-router/entry` in [`package.json`](../../apps/mobile/package.json)
- Client boundary: [`src/lib/api-client.ts`](../../apps/mobile/src/lib/api-client.ts)
- Architecture: [mobile architecture](./architecture-mobile.md)

### Database

- Type: backend data layer
- Stack: Supabase PostgreSQL, Prisma 6.19, ordered SQL migrations, RLS, and TypeScript seeds
- Root: [`packages/db`](../../packages/db/)
- Entry points: [`prisma/schema.prisma`](../../packages/db/prisma/schema.prisma),
  [`prisma/seeds/index.ts`](../../packages/db/prisma/seeds/index.ts), and
  [`package.json`](../../packages/db/package.json)
- Migration boundary:
  [`scripts/prisma-migrate-deploy.mjs`](../../scripts/prisma-migrate-deploy.mjs)
- Architecture: [database architecture](./architecture-database.md)

### Shared packages

- Type: internal library workspaces
- Stack: TypeScript, Zod, OpenAPI, generated Fetch SDK, test factories, k6 helpers, and ESLint
- Root: [`packages`](../../packages/)
- Entry points: [`api-client/src/index.ts`](../../packages/api-client/src/index.ts),
  [`config/src/index.ts`](../../packages/config/src/index.ts),
  [`utils/src/index.ts`](../../packages/utils/src/index.ts), and
  [`testing/src/index.ts`](../../packages/testing/src/index.ts)
- Additional entries: [`k6-utils/src/index.ts`](../../packages/k6-utils/src/index.ts) and
  [`eslint-config/index.js`](../../packages/eslint-config/index.js)
- Architecture: [shared packages architecture](./architecture-shared.md)

## Generated brownfield documentation

These files describe the repository state captured by the completed deep scan.

### Overview

- [Project overview](./project-overview.md) - system summary, implemented scope, risks, and setup
- [Source tree analysis](./source-tree-analysis.md) - current ownership, entry points, and boundaries
- [Integration architecture](./integration-architecture.md) - cross-part and external data flows

### Architecture

- [API architecture](./architecture-api.md) - NestJS HTTP, serverless, worker, and module design
- [Web architecture](./architecture-web.md) - Next.js rendering, routes, data access, and delivery
- [Mobile architecture](./architecture-mobile.md) - Expo routing, screens, integrations, and release
- [Database architecture](./architecture-database.md) - Prisma, migrations, RLS, and authorization
- [Shared packages architecture](./architecture-shared.md) - package boundaries and contract pipeline

### Contracts and data

- [API contracts](./api-contracts-api.md) - implemented HTTP, authentication, and event surfaces
- [Database models](./data-models-database.md) - models, constraints, migrations, RLS, and seeds

### Components

- [Web component inventory](./component-inventory-web.md) - routes, components, clients, and tests
- [Mobile component inventory](./component-inventory-mobile.md) - routes, screens, services, and tests

### Packages

- [Shared package inventory](./shared-packages.md) - exports, consumers, commands, and caveats

### Workflow

- [Development guide](./development-guide.md) - setup, commands, validation, and troubleshooting
- [Deployment guide](./deployment-guide.md) - targets, CI verification, migrations, and runtime gaps
- [Contribution guide](./contribution-guide.md) - repository boundaries and change expectations

## Machine metadata and AI context

- [Scan report](./project-scan-report.json) - workflow version, timestamps, scan findings, and outputs
- [Project parts](./project-parts.json) - machine-readable parts, entry points, and integrations
- [AI project context](../project-context.md) - concise implementation rules and anti-patterns

## Curated existing project knowledge

### Product and learning

- [Product brief](./couturecast_brief.md) - vision, audience, value proposition, and success metrics
- [Product roadmap](./couturecast_roadmap.md) - authoritative phase order and release priorities
- [Step-by-step learning path](./learning-path-step-by-step.md) - story-to-code learning sequence
- [Morning ritual diagram](./diagrams/morning-ritual.mmd) - planned UX interaction flow

### Contracts, policy, and operations

- [API versioning](./api-versioning.md) - REST compatibility and deprecation policy
- [Analytics events](./analytics-events.md) - typed event catalog and validation notes
- [Feature flags](./feature-flags.md) - keys, fallback order, synchronization, and usage
- [Observability](./observability.md) - implemented signals, dashboards, and local Grafana guidance
- [Secrets management](./secrets-management.md) - local, CI, hosted, and rotation practices
- [Guardian invitation environment setup](./guardian-invitation-env-setup.md) - invite URL and secret
  placement

### Compliance and documentation governance

- [COPPA compliance](./coppa-compliance.md) - engineering compliance model pending legal approval
- [Terms of Service draft](./terms-of-service.md) - guardian and age-policy legal draft
- [Owner-anchor exceptions](./owner-anchor-exceptions.md) - learning-path anchors for non-code files

## Planning, delivery, test, and runbook links

### Planning intent

- [PRD](../planning-artifacts/prd.md) - product requirements and planned scope
- [Architecture plan](../planning-artifacts/architecture.md) - historical target architecture
- [Epics and stories](../planning-artifacts/epics.md) - planned delivery decomposition
- [UX design specification](../planning-artifacts/ux-design-specification.md) - target experience
- [Implementation readiness report](../planning-artifacts/refs/implementation-readiness-report-2025-11-13.md)
  - historical planning gate

### Delivery status

- [Sprint status](../implementation-artifacts/sprint-status.yaml) - story progress by epic
- [Deferred work ledger](../implementation-artifacts/deferred-work.md) - review deferrals; verify each
  item against current code before acting

### Test strategy and evidence

- [System-level test design](../test-artifacts/test-design-system.md) - legacy strategic baseline
- [Testing standards](../test-artifacts/testing-standards.md) - current fixture and quality rules
- [Test environments](../test-artifacts/test-environments.md) - local, Preview, production, and mobile
  runbook
- [CI/CD pipeline](../test-artifacts/ci-cd-pipeline.md) - current workflow and deployment map
- [Maestro promotion criteria](../test-artifacts/maestro-analytics-promotion.md) - mobile gate thresholds
- [Weather ingestion test review](../test-artifacts/test-reviews/weather-ingestion-test-architect-evaluation-2026-07-08.md)
  - current backend test-scope decision
- [Guardian consent UI test review](../test-artifacts/test-reviews/guardian-consent-ui-test-review-2026-04-27.md)
  - Playwright quality review and runtime caveat

### Operational runbooks

- [Development and local services](./development-guide.md)
- [Deployment and runtime topology](./deployment-guide.md)
- [Secrets and rotation](./secrets-management.md)
- [Guardian invitation environment setup](./guardian-invitation-env-setup.md)
- [Observability and local Grafana](./observability.md)
- [Test environment safety](../test-artifacts/test-environments.md)

## Getting started by part

Use Node.js 24 and npm 10.8.1. From the repository root, install dependencies with `npm ci`. Use
[`.env.example`](../../.env.example) only as a variable inventory.

### API

1. Start local Supabase with `npm run supabase:start`.
2. Start Redis with `docker compose up -d redis`.
3. Start the API with `npm run start:api`.
4. Start workers separately with `npm run start:workers --workspace api`.
5. Validate with `npm run verify:api` and the relevant API integration tests.

### Web

1. Ensure the API origin and required public variables are configured.
2. Start the app with `npm run dev --workspace web`.
3. Validate with `npm run verify:web`.
4. Use `npm run test:pw-local` for assembled browser/API behavior.

### Mobile

1. Configure an API origin reachable from the simulator or device.
2. Start Expo with `npm run start --workspace mobile`.
3. Use `npm run ios --workspace mobile` or `npm run android --workspace mobile`.
4. Validate with `npm run verify:mobile`; run Maestro only on a prepared local device target.

### Database

1. Start local Supabase and confirm the selected `DATABASE_URL`.
2. Generate Prisma Client with `npm run db:generate`.
3. Author migrations with `npm run db:migrate`; seed with `npm run db:seed`.
4. Treat `npm run db:reset` as destructive and use it only against disposable local data.

### Shared packages

1. Build all shared workspaces with `npm run build:packages`.
2. Run `lint`, `typecheck`, `test`, and `build` against the changed workspace.
3. For HTTP contract changes, edit canonical Zod modules, then run
   `npm run generate:api-client`, Optic checks, package tests, and Pact.
4. Never hand-edit generated SDK, OpenAPI, Prisma Client, or build output.

## Authority and recency guidance

Use current executable evidence before narrative plans:

1. Current source code, package manifests, configuration, and committed database migrations.
2. [`package-lock.json`](../../package-lock.json) for installed dependency versions.
3. Canonical human-authored contracts: shared Zod modules for public APIs and Prisma plus SQL
   migrations for data behavior.
4. Generated artifacts as evidence of the latest successful generation, not as editable sources.
5. This 2026-07-17 brownfield documentation for current-state navigation and synthesis.
6. Product brief and roadmap for product intent and phase ordering.
7. Planning, implementation, test-review, and older README documents for historical intent.

When documents disagree, manifests and current code beat stale planning versions. Controllers decide
which HTTP routes exist; shared Zod schemas define canonical shapes where adopted. The Prisma schema
defines the logical model, while committed SQL migrations define physical constraints, grants, RLS,
functions, and triggers. Re-check delivery ledgers and old readiness reports against the working
tree before treating a planned, deferred, or historically completed item as current behavior.
