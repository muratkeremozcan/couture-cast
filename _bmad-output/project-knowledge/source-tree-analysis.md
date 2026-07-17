# Source tree analysis

Updated: 2026-07-17 - BMAD deep brownfield scan of the current repository tree.

<!-- markdownlint-disable MD013 -->

## Scope and notation

This document describes directories and files that exist in the working tree now. It distinguishes
human-authored source from generated or ignored local output; it does not treat the older planned
architecture as implemented.

- **Entry**: runtime or tool entry point.
- **Contract**: canonical shared schema or externally checked interface.
- **Generated**: derived output; regenerate rather than hand-edit.
- **Ignored**: excluded by a repository or directory `.gitignore`.
- **Boundary**: connection to another application, package, data store, provider, or test runtime.

## Annotated repository tree

```text
couture-cast/
├── apps/                         npm application workspaces
│   ├── api/                      NestJS HTTP, Socket.io, schedulers, and BullMQ workers
│   ├── web/                      Next.js App Router application
│   └── mobile/                   Expo Router application
├── packages/                     internal npm library workspaces
│   ├── api-client/               canonical contracts plus generated HTTP SDK
│   ├── config/                   canonical feature-flag definitions and fallback logic
│   ├── db/                       database ownership: Prisma, SQL migrations, and seeds
│   ├── eslint-config/            shared lint policy
│   ├── k6-utils/                 k6-runtime-only helpers and load profiles
│   ├── testing/                  Prisma-aware synthetic factories and cleanup
│   └── utils/                    shared age and birthdate policy
├── playwright/                   web/API cross-surface browser and HTTP E2E tests
├── pact/                         HTTP consumer/provider contract harness
├── k6/                           load-test entry points and environment launchers
├── maestro/                      mobile E2E flows; artifacts/ is generated and ignored
├── infra/                        local Grafana/LGTM configuration and dashboards
├── scripts/                      repository orchestration and validation tools
├── .github/                      CI workflows and composite actions
├── supabase/                     local Supabase CLI config; runtime state is ignored
├── _bmad-output/                 BMAD knowledge, planning, delivery, and QA artifacts
├── _bmad/                        vendor-managed BMAD framework; mostly ignored
├── docs/                         additional project documentation
├── package.json                  workspace graph and canonical repository commands
├── package-lock.json             installed dependency resolution
├── turbo.json                    lint, test, and build task graph
├── playwright.config.ts          Playwright root configuration
├── openapitools.json             generated SDK target and generator settings
├── docker-compose.yml            root local service composition
└── node_modules/, dist/, .turbo/ generated/installed local state; ignored
```

The npm workspace boundary is `apps/*` plus `packages/*`. Applications depend on package exports;
they should not import another application's private source. The root
[`package.json`](../../package.json) sequences shared builds and exposes the cross-cutting test,
database, generation, mobile, and observability commands.

Ignored state currently present in the checkout includes dependency trees, build output, Turbo and
framework caches, local environment files, reports, traces, Pact files, k6 summaries, Maestro
artifacts, and Supabase CLI state. The authoritative ignore rules are
[the root `.gitignore`](../../.gitignore) plus app- and tool-local ignore files.

## `apps/api`

```text
apps/api/
├── api/
│   └── index.ts                  Entry: Vercel/serverless adapter
├── src/
│   ├── main.ts                   Entry: long-running NestJS HTTP process
│   ├── app.module.ts             root dependency composition
│   ├── openapi.ts                publishes shared OpenAPI JSON and Swagger UI
│   ├── load-env.ts               root environment loading
│   ├── modules/
│   │   ├── auth/                 signup, JWT identity, role/consent guards, sessions
│   │   ├── guardian/             invitation, acceptance, revocation, expiry scheduling
│   │   ├── user/                 profile read model
│   │   ├── location-preferences/ saved-location HTTP/service/repository boundary
│   │   ├── weather/              provider adapters, ingestion, query, scheduler, repository
│   │   │   └── providers/        Boundary: OpenWeather and WeatherAPI
│   │   ├── personalization/      ritual/outfit recommendation endpoint and service
│   │   ├── alerts/               rules, preferences, evaluation, outbox, fanout, Redis relay
│   │   ├── events/               persisted event polling endpoint and repository
│   │   ├── notifications/        Boundary: Expo Push API and push-token persistence
│   │   ├── gateway/              Boundary: authenticated Socket.io namespaces and Redis relay
│   │   ├── moderation/           moderation action endpoint and audit behavior
│   │   ├── telemetry/            telemetry persistence service
│   │   └── feature-flags/        Boundary: PostHog remote flags and database fallback
│   ├── workers/
│   │   └── bootstrap.ts          Entry: standalone BullMQ worker process
│   ├── admin/                    failed-job listing/replay and cleanup scheduling
│   ├── analytics/                PostHog-facing analytics module/service
│   ├── posthog/                  PostHog client adapter
│   ├── prisma/                   Prisma provider module; client comes from packages/db schema
│   ├── config/                   Redis and queue names/connections
│   ├── contracts/http.ts         compatibility re-export, not canonical contract ownership
│   ├── filters/                  global HTTP exception telemetry
│   └── logger/                   Pino configuration and request context
├── integration/                  API/database/provider-boundary integration suites
├── test/                         app test factories
├── package.json                  scripts and app dependency boundary
├── nest-cli.json                 Nest build layout
├── vercel.json                  serverless deployment routing/configuration
└── dist/, .turbo/, .vercel/     generated or provider-local state; ignored
```

The API has three runtime entry points: [`src/main.ts`](../../apps/api/src/main.ts) for HTTP and
Socket.io, [`api/index.ts`](../../apps/api/api/index.ts) for serverless hosting, and
[`src/workers/bootstrap.ts`](../../apps/api/src/workers/bootstrap.ts) for background workers.
[`src/app.module.ts`](../../apps/api/src/app.module.ts) is the composition root shared by the HTTP
bootstraps.

Public HTTP ownership crosses into
[`packages/api-client/src/contracts/http`](../../packages/api-client/src/contracts/http): those Zod
modules are the canonical request/response definitions for registered routes. Controllers are the
implemented transport boundary; generated OpenAPI and SDK files are downstream. API repositories
cross the database boundary through Prisma, but schema and migration ownership remains in
`packages/db`. Redis/BullMQ, weather providers, PostHog, Supabase Auth, Expo Push, and Socket.io are
explicit external or process boundaries.

Colocated `*.spec.ts` files test units; `integration/` exercises assembled boundaries. Build output
under `dist/` mirrors source and must not be used as source.

## `apps/web`

```text
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx            Entry: root App Router layout
│   │   ├── page.tsx              Entry: `/`
│   │   ├── signup/               `/signup` server page and client form
│   │   ├── guardian/
│   │   │   ├── accept/           `/guardian/accept`
│   │   │   └── dashboard/        `/guardian/dashboard`
│   │   ├── teen/dashboard/       `/teen/dashboard`
│   │   ├── api/health/route.ts   Entry: Next.js `GET /api/health`
│   │   ├── components/           landing analytics client leaves
│   │   ├── lib/fallback.ts       dormant Socket.io-to-polling fallback adapter
│   │   ├── error.tsx             client error boundary
│   │   ├── not-found.tsx         route fallback
│   │   └── globals.css           global Tailwind layer
│   ├── lib/
│   │   ├── api-client.ts         Boundary: configured shared generated-client factory
│   │   ├── events-client.ts      event-poll operation adapter
│   │   ├── signup.ts             direct fetch using shared Zod contracts
│   │   ├── guardian.ts           direct fetch using shared Zod contracts
│   │   └── user.ts               direct fetch using shared Zod contracts
│   ├── analytics/                Boundary: browser PostHog wrapper
│   └── test-utils/msw/           HTTP mock boundary for Vitest
├── instrumentation-client.ts     Entry: browser analytics initialization
├── next.config.ts                env loading, PostHog rewrites, optional API proxy
├── git-metadata.ts               build/deployment identity adapter
├── public/                       static assets and generated MSW worker
├── vitest*.ts                    unit/browser test configurations and setup
├── package.json                  Next.js workspace scripts/dependencies
└── .next/, coverage/, build/     generated framework/test output; ignored
```

App Router route files are runtime entries discovered by Next.js. Most pages are server components
that mount client leaves; browser data access starts in `src/lib`. The API integration boundary is
`@couture/api-client`: shared Zod contracts validate handwritten adapters, while event polling uses
the generated client factory. `next.config.ts` may proxy same-origin `/api/v1/*` traffic to the API.

No app-local canonical API contract exists. Tests next to components/modules are Vitest tests;
cross-service browser behavior belongs under root `playwright/`. `public/mockServiceWorker.js` is
generated by MSW even though it is checked in for browser test use.

## `apps/mobile`

```text
apps/mobile/
├── app/
│   ├── _layout.tsx               Entry: root Expo Router stack/provider layout
│   ├── (tabs)/
│   │   ├── _layout.tsx           tab navigator
│   │   ├── index.tsx             Entry: `/`
│   │   └── two.tsx               Entry: `/two`
│   ├── signup.tsx                Entry: `/signup`
│   ├── guardian-accept.tsx       Entry: `/guardian-accept`
│   ├── guardian-dashboard.tsx    Entry: `/guardian-dashboard`
│   ├── teen-dashboard.tsx        Entry: `/teen-dashboard`
│   ├── modal.tsx                 Entry: `/modal`
│   ├── +not-found.tsx            unmatched-route boundary
│   └── +html.tsx                 Expo web HTML shell
├── src/
│   ├── features/                 signup, guardian, and teen screen implementations
│   ├── lib/
│   │   ├── api-client.ts         Boundary: configured shared generated-client factory
│   │   ├── api-health.ts         generated-client health adapter
│   │   ├── signup.ts             direct fetch using shared Zod contracts
│   │   ├── guardian.ts           direct fetch using shared Zod contracts
│   │   └── user.ts               direct fetch using shared Zod contracts
│   ├── analytics/                Boundary: PostHog provider, diagnostics, typed events
│   ├── config/posthog.ts         PostHog/environment client configuration
│   ├── realtime/                 dormant polling fallback controller
│   ├── screens/                  extracted Tab Two diagnostics screen/test
│   └── test-utils/msw/           HTTP mock boundary
├── components/                   mostly Expo starter-derived reusable components
├── constants/                    starter light/dark color palette
├── assets/                       fonts and starter application images
├── package.json                  Entry declaration: `expo-router/entry`
├── app.json, app.config.ts       Expo identity, plugins, env, and typed-route config
├── eas.json                      production EAS build profile
├── vitest.config.ts              component/unit test configuration
└── .expo/, ios/, android/, dist/ generated local/native output; ignored
```

Expo Router discovers route entries beneath `app/`; the package-level runtime entry is
`expo-router/entry`. Route wrappers delegate product behavior to `src/features`. API ownership
again remains in the shared contract package. The health screen uses the generated client, while
signup/profile/guardian flows use direct fetch wrappers validated by shared schemas.

Native device integration boundaries include Expo notifications, image picker, linking, EAS, and
PostHog. No generated `ios/` or `android/` directory is checked in; Expo prebuild output is ignored.
`.expo/` is generated local state and includes derived typed-route declarations. Root `maestro/`
owns mobile E2E rather than the app workspace.

## `packages/db`

```text
packages/db/
├── prisma/
│   ├── schema.prisma             Database owner: logical Prisma model and client generator
│   ├── migrations/
│   │   ├── */migration.sql       Physical schema, constraints, grants, RLS, functions, triggers
│   │   └── migration_lock.toml   Prisma migration provider lock
│   └── seeds/
│       ├── index.ts              Entry: deterministic database seed orchestration
│       ├── users.ts              identity/profile/consent seed slice
│       ├── wardrobe.ts           garment/palette seed slice
│       ├── weather.ts            snapshot/forecast seed slice
│       ├── rituals.ts            recommendations/social/audit seed slice
│       ├── feature-flags.ts      canonical flag records
│       └── interop.ts            supplemental interoperability data
├── test/                         static SQL checks and live PostgreSQL/RLS suites
├── package.json                  Prisma generation, migration, reset, seed, and test commands
├── vitest.config.ts              serialized database test configuration
├── tsconfig.json
├── .env                          local ignored secret/config file; never documentation input
└── node_modules/, *.tsbuildinfo  installed/generated local state; ignored
```

[`prisma/schema.prisma`](../../packages/db/prisma/schema.prisma) owns the logical model. Committed
[`prisma/migrations`](../../packages/db/prisma/migrations) own physical behavior that Prisma cannot
express, including partial indexes, checks, row-level security, grants, security-definer functions,
and immutable-audit triggers. Both must be reviewed for database changes.

Prisma Client is generated into `@prisma/client` under installed dependency state, not into this
workspace. API repositories and `@couture/testing` consume that generated client; neither owns the
schema. Root [`scripts/prisma-migrate-deploy.mjs`](../../scripts/prisma-migrate-deploy.mjs) is the
deployment boundary that applies committed migrations.

## Shared packages

```text
packages/
├── api-client/
│   ├── src/
│   │   ├── contracts/http/       Contract: canonical public REST Zod schemas and registry
│   │   │   └── openapi.ts        Entry: OpenAPI 3.1 composition
│   │   ├── types/                Contract: analytics and Socket.io event schemas
│   │   ├── client.ts             stable configured generated-client factory
│   │   ├── realtime/             polling fallback implementation
│   │   ├── testing/              framework-neutral assertion helpers
│   │   ├── generated/            Generated HTTP SDK; do not hand-edit
│   │   └── index.ts              public package root
│   ├── scripts/                  OpenAPI/event generation and SDK post-processing
│   ├── docs/
│   │   ├── http.openapi.json     Generated, checked-in HTTP contract artifact
│   │   └── socket-events.openapi.json
│   ├── testing/                  contract and generated-client validation suites
│   └── dist/                     generated package build; ignored
├── config/
│   └── src/                      feature-flag definitions, evaluation, tests, public barrel
├── utils/
│   └── src/                      age/birthdate policy, tests, public barrel
├── testing/
│   ├── src/factories/            synthetic builders, optional Prisma persistence, registry
│   ├── src/cleanup.ts            dependency-aware test-data cleanup
│   └── test/                     package tests
├── k6-utils/
│   ├── src/                      k6/goja-compatible HTTP, config, crypto, JWT, and summary helpers
│   └── templates/load-profiles/  reusable load-scenario JSON
└── eslint-config/
    ├── index.js                  shared ESLint configuration entry
    └── .eslintrc.cjs             package-local lint configuration
```

The main contract pipeline is:

```text
human-authored Zod modules
  -> contracts/http/openapi.ts
  -> docs/http.openapi.json [generated, checked in]
  -> OpenAPI Generator
  -> src/generated/ [generated, checked in]
  -> client.ts and public package exports
  -> API, web, mobile, Playwright, and Pact consumers
```

The generated SDK has TypeScript types but disables generated runtime checks; canonical Zod schemas
remain the trust boundary. Socket and analytics schemas under `src/types` are canonical shared
contracts but use a separate event-OpenAPI generation path.

`@couture/config` owns flag keys/defaults, `@couture/utils` owns age policy, `@couture/testing` owns
shared synthetic test data and teardown, `@couture/k6-utils` owns k6-specific helpers, and
`@couture/eslint-config` owns cross-workspace lint policy. Their `dist/` directories and TypeScript
build-info files are generated and ignored.

## Cross-cutting test, operations, and documentation tree

```text
playwright/
├── config/                        local, preview, production, and burn-in configurations
├── tests/
│   ├── api/                       assembled API/auth/weather/ritual/realtime flows
│   └── *.spec.ts                  web, auth-session, analytics, consent, and fallback flows
├── support/
│   ├── fixtures/                  merged test fixtures
│   ├── auth-session/              custom auth provider boundary
│   └── helpers/                   generated client, proxy, factories, and consent helpers
├── scripts/burn-in-changed.ts     changed-test burn-in entry
├── global-teardown.ts             suite cleanup entry
└── artifacts/, playwright-report/ generated ignored reports/traces

pact/
├── http/consumer/                 web/mobile consumer interaction definitions
├── http/provider/                 API provider verifier and state handlers
├── http/vitest.*.config.mts       consumer/provider test entries
├── artifacts/                     generated ignored verifier logs
└── README.md

k6/
├── tests/*.k6test.ts              Entry: load scenarios
├── helpers/                       suite-local API/config/HTTP adapters
├── scripts/run-k6-env.sh          Entry: environment-aware launcher
├── scripts/run-k6-tests.sh        Entry: test runner
└── summary-*.json                 generated ignored summaries

maestro/
├── sanity.yaml                    Entry: mobile smoke flow
├── analytics.yaml                 Entry: mobile analytics flow
└── artifacts/                     generated ignored screenshots/logs/reports

infra/
└── grafana/
    ├── dashboards/                checked-in dashboard sources
    └── local/
        ├── docker-compose.yml      Entry: local LGTM stack
        ├── provisioning/          Grafana dashboard/datasource provisioning
        └── generated-dashboards/  generated and locally ignored copies

scripts/
├── verify-changed.mjs             change-to-workspace verification planner
├── verify-workspace.mjs           workspace quality-gate runner
├── prisma-migrate-deploy.mjs      committed migration deployment boundary
├── start-api-watch.mjs            API development entry
├── set-preview-e2e-base-url.mjs   preview Playwright URL resolver
├── resolve-*-preview-url.mjs      deployment lookup adapters
├── check-pact-determinism.sh      Pact repeatability gate
├── prepare-local-grafana-*.mjs    generated local dashboard preparation
├── run-maestro.mjs                mobile E2E orchestration entry
└── install/start/reset helpers    Node, Expo Go, Maestro, emulator, and simulator setup

.github/
├── actions/                       reusable install, environment, test, and report actions
├── workflows/                     PR, contract, Playwright, k6, schema, mobile, and deploy CI
└── PULL_REQUEST_TEMPLATE.md

_bmad-output/
├── project-context.md             concise implementation rules for agents
├── project-knowledge/             current scan and durable project/domain knowledge
│   ├── project-scan-report.json   generated scan-resume state
│   ├── api-contracts-api.md       current API inventory
│   ├── component-inventory-*.md   current web/mobile inventories
│   ├── data-models-database.md    current database inventory
│   ├── shared-packages.md         current package inventory
│   └── source-tree-analysis.md    this current-tree map
├── planning-artifacts/            product, UX, epic, and architecture plans
├── implementation-artifacts/      stories, sprint state, and delivery records
└── test-artifacts/                test strategy, CI, reviews, and traceability
```

Playwright is the integrated web/API system boundary; Pact checks generated-client consumers
against the API provider; k6 executes in its own `goja` runtime and consumes `@couture/k6-utils`;
Maestro drives packaged mobile UI. Their generated evidence directories are disposable outputs,
not test source.

CI in [`.github/workflows`](../../.github/workflows) composes repository scripts and local composite
actions. Grafana dashboard sources are checked in under `infra/grafana/dashboards`; local prepared
copies are generated. `_bmad-output` is a checked-in collaboration surface, while `_bmad` is
installer-managed framework payload and is mostly ignored except configured customization files.

## Important planned-but-absent directories

The older [architecture plan](../planning-artifacts/architecture.md) names several targets that do
not exist in the current tree: `packages/tokens`, `packages/ui-web`, `infra/vercel`, `infra/eas`,
and `tools`. Current automation lives in `scripts`, and deployment configuration is app-local or
in `.github`.

It also anticipates product areas that are not yet directories: API `lookbook`, `community`,
`commerce`, and color-analysis modules; a web admin/moderation route; dedicated ritual route groups;
and mobile watch/widget surfaces. Existing database models or shared event schemas for some of
these concepts do not mean the application directories or runtime flows are implemented.
