# Couture Cast Learning Path (step by step)

Updated: 2026-03-05 - synthesized from docs + code agent scan

## LLM collaborator prompt

Use this prompt when asking an LLM to improve this document and apply the same in-code comment
style:

```text
You are improving Couture Cast learning docs and code commentary.

Goals:
1) Improve docs/learning-path-step-by-step.md with clearer teaching content.
2) For each step touched, explicitly list impacted files in the step section.
3) Add/adjust in-file educational comments for impacted code using this style:
   - brief "what it is / problem solved / alternatives"
   - numbered setup steps `1) 2) 3) ...`
   - "where we did this" anchor comments near actual implementation
   - searchable step text appears in two places in the same file:
     a) overview list, b) implementation anchor

Rules:
- Keep behavior unchanged unless asked.
- Keep comments concise and ASCII.
- Preserve existing Story/Task mapping in docs.
- After edits, run formatting/lint checks and report changed files.
```

## How to use this

1. Follow steps in order.
2. For each step, read the story first, then open the evidence files.
3. Complete the exercise before moving on.

## Step 1 - Understand product-to-engineering traceability

User/business impact:

Clear traceability from brief to implementation keeps the team building features users actually
need, not speculative work. The business avoids scope drift and costly rework by tying every
delivery decision to defined goals and KPIs.

Key takeaways:

1. Traceability: `docs/couturecast_brief.md` defines vision/KPIs, and downstream planning docs
  must map back to it.
2. Sequencing: `couturecast_roadmap.md` phase order drives `prd.md` scope and `epics.md` story
  decomposition.
3. Delivery alignment: implementation stories in `docs/implementation-artifacts/` should be
  explainable as outcomes of PRD + architecture decisions.

Story/Task mapping:

- Pre-story planning artifacts (source of truth before implementation stories)

Read first:

- `docs/couturecast_brief.md`
- `docs/couturecast_roadmap.md`
- `docs/planning-artifacts/prd.md`
- `docs/planning-artifacts/architecture.md`
- `docs/planning-artifacts/epics.md`

Architecture diagram:

```mermaid
flowchart TD
  BRIEF[docs/couturecast_brief.md<br/>vision, personas, success metrics]
  ROADMAP[docs/couturecast_roadmap.md<br/>phase order and launch gates]
  PRD[docs/planning-artifacts/prd.md<br/>functional requirements]
  ARCH[docs/planning-artifacts/architecture.md<br/>technical decisions + ADRs]
  EPICS[docs/planning-artifacts/epics.md<br/>epics and stories]
  STORIES[docs/implementation-artifacts/0-*.md<br/>execution stories]
  CODE[apps/* + packages/*]

  BRIEF --> ROADMAP --> PRD --> ARCH --> EPICS --> STORIES --> CODE
```



## Step 2 - Monorepo and app boundaries

User/business impact:

Strong app/package boundaries reduce cross-surface breakage, so users get more consistent behavior
across web, mobile, and API. The business gets faster parallel delivery because teams can ship
independently with fewer integration surprises.

Key takeaways:

1. Boundary clarity: `apps/web`, `apps/mobile`, and `apps/api` are separate runtime surfaces with
  distinct entrypoints.
2. Shared contracts: common logic/types flow through workspace packages (not cross-app direct
  imports), especially `packages/api-client` and `packages/db`.
3. Monorepo operations: root npm workspaces + `turbo.json` coordinate consistent `dev`, `test`,
  and `build` behavior.

Story/Task mapping:

- Story 0.1
- Task 2 (mobile app init), Task 3 (web app init), Task 4 (API app init), Task 5 (workspace
config)

Story reference:

- `docs/implementation-artifacts/0-1-initialize-turborepo-monorepo.md`

Code evidence:

- `apps/web/src/app/layout.tsx`
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/(tabs)/_layout.tsx`
- `apps/api/src/main.ts`

Architecture diagram:

```mermaid
flowchart TD
  ROOT[Root workspace<br/>package.json workspaces + turbo.json]
  TURBO[Turbo task graph<br/>dev / test / build]

  ROOT --> WEB[apps/web<br/>Next.js App Router]
  ROOT --> MOBILE[apps/mobile<br/>Expo Router]
  ROOT --> API[apps/api<br/>NestJS bootstrap]
  ROOT --> APICLIENT[packages/api-client<br/>shared API/event contracts]
  ROOT --> DB[packages/db<br/>Prisma schema + client]
  ROOT --> ESLINT[packages/eslint-config]

  ROOT --> TURBO
  TURBO --> WEB
  TURBO --> MOBILE
  TURBO --> API

  WEB --> APICLIENT
  MOBILE --> APICLIENT
  APICLIENT --> API
  API --> DB
```



## Step 3 - Data model and deterministic seeds

User/business impact:

A stable schema plus deterministic seeds makes user-facing logic like recommendations and lookbook
flows predictable in every environment. The business gains safer releases and faster debugging
because test data and migrations are reproducible.

Key takeaways:

1. Schema-first modeling: `packages/db/prisma/schema.prisma` is the single source for relational
  models, enums, and user-scoped tables.
2. Deterministic seeding: seeds use stable IDs and seeded randomness (`faker.seed(4242)`) with
  `upsert` to keep reruns reproducible.
3. Dependency-safe order: `seedUsers -> seedWardrobe -> seedWeather -> seedRituals` ensures
  foreign-key-ready data for recommendations and lookbook flows.

Story/Task mapping:

- Story 0.2
- Task 2 (core schema tables), Task 5 (seed scripts), Task 7 (validation/testing)

Story reference:

- `docs/implementation-artifacts/0-2-configure-prisma-schema-migrations-and-seed-data.md`

Code evidence:

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/seeds/index.ts`
- `packages/db/prisma/seeds/weather.ts`

Architecture diagram:

```mermaid
flowchart TD
  SCHEMA[schema.prisma]
  MIGRATE[Prisma migrate/generate]
  SEEDINDEX[prisma/seeds/index.ts]

  USERS[seedUsers<br/>guardian/teen users + consent]
  WARDROBE[seedWardrobe<br/>garments + palette insights]
  WEATHER[seedWeather<br/>wx-1..wx-10 snapshots + segments]
  RITUALS[seedRituals<br/>outfits, lookbook, engagement, audit]
  DB[(Postgres via Prisma)]

  SCHEMA --> MIGRATE --> SEEDINDEX
  SEEDINDEX --> USERS
  SEEDINDEX --> WARDROBE
  SEEDINDEX --> WEATHER
  SEEDINDEX --> RITUALS

  USERS --> DB
  WARDROBE --> DB
  WEATHER --> DB
  RITUALS --> DB

  USERS --> RITUALS
  WARDROBE --> RITUALS
  WEATHER --> RITUALS
```



## Step 4 - Environment setup and Supabase operations

Supabase is the managed backend platform in this repo that provides PostgreSQL, Auth, and Storage.

User/business impact:

Disciplined Supabase environment and secret management reduces auth, storage, and database
misconfiguration issues that users experience as outages or login failures. The business gets more
reliable deployments and cleaner recovery operations across dev and prod.

Key takeaways:

1. Supabase env isolation is explicit: local/CI stacks plus cloud `couturecast-dev` and
  `couturecast-prod`, with staging deferred until plan/budget allows.
2. Reliability depends on env-aware operations: `npx supabase start/link/db push`, pool targets
  (dev 50, prod 100), and plan-gated PITR/backups.
3. Config hygiene is a core skill: keep `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_KEY`, and `DATABASE_URL` aligned across `.env.local`, `.env.dev`, `.env.prod`,
   and secrets manager.

Story/Task mapping:

- Story 0.3
- Task 3 (Supabase CLI), Task 4 (pooling/backups), Task 5 (env configuration)

Story reference:

- `docs/implementation-artifacts/0-3-set-up-supabase-projects-dev-staging-prod.md`

Code and config evidence:

- `packages/db/prisma/schema.prisma`
- root env conventions in implementation docs

Architecture diagram:

```mermaid
flowchart TD
  DEV[Developer + CI] --> ENV[Env files and secrets<br/>.env.local .env.dev .env.prod]
  ENV --> CLI[Supabase CLI<br/>start link db push]
  CLI --> LOCAL[Local Supabase stack]
  LOCAL --> PRISMA[Prisma schema + seeds]

  CLI --> DEVSB[Supabase cloud<br/>couturecast-dev]
  CLI --> PRODSB[Supabase cloud<br/>couturecast-prod]
  CLI -. deferred .-> STAGE[staging env]

  DEVSB --> AUTH[Auth + RLS scaffolding]
  PRODSB --> AUTH
  DEVSB --> BUCKETS[Storage buckets<br/>wardrobe-images derived-assets community-uploads]
  PRODSB --> BUCKETS
```



## Step 5 - Queueing and worker reliability

BullMQ is the Redis-backed job queue system in this repo for background work like weather ingestion,
alert fan-out, and moderation processing. It separates slow/retryable workloads from request
handling so the API stays responsive under load.

User/business impact:

Queue retries, backoff, and failure replay ensure critical async tasks still complete during spikes
or transient failures, so users do not miss core updates. The business protects engagement and
operations by preventing silent job loss and shortening incident recovery.

Key takeaways:

1. Parallelization: workers process jobs concurrently outside request threads.
2. Resiliency: retries, backoff, and DLQ-style failure capture prevent job loss.
3. Debuggability/operability: persisted failures + admin replay/prune flows make incidents
  traceable and recoverable.

Story/Task mapping:

- Story 0.4
- Task 2 (BullMQ queues), Task 3 (DLQ), Task 4 (concurrency), Task 5 (worker process group)

Story reference:

- `docs/implementation-artifacts/0-4-configure-redis-upstash-and-bullmq-queues.md`

Code evidence:

- `apps/api/src/config/queues.ts`
- `apps/api/src/workers/base.worker.ts`
- `apps/api/src/workers/bootstrap.ts`
- `apps/api/src/admin/admin.service.ts`
- `apps/api/src/admin/admin.controller.ts`

Architecture diagram:

```mermaid
flowchart TD
  API[API producers] --> Q[BullMQ queues]

  Q --> WQ[weather-ingestion]
  Q --> AQ[alert-fanout]
  Q --> CQ[color-extraction]
  Q --> MQ[moderation-review]

  subgraph WG[Worker process group]
    WW[weather worker<br/>concurrency: 10]
    AW[alert worker<br/>concurrency: 20]
    CW[color worker<br/>concurrency: 5]
    MW[moderation worker<br/>concurrency: 10]
  end

  WQ --> WW
  AQ --> AW
  CQ --> CW
  MQ --> MW

  WW -->|failed| DLQ[(Postgres jobFailure)]
  AW -->|failed| DLQ
  CW -->|failed| DLQ
  MW -->|failed| DLQ

  ADM[Admin API<br/>failed-jobs / retry] --> DLQ
  ADM -->|re-enqueue| Q
```



## Step 6 - Realtime and push delivery

User/business impact:

For users, Step 6 means faster ritual updates and more reliable alerts even when connectivity is
unstable. For the business, it protects engagement and retention by reducing missed notifications
and delivery-related churn.

Ritual context:

- In Couture Cast, a ritual is the daily outfit + weather decision loop a user follows.
- Available ritual-related streams are `ritual:update`, `alert:weather`, and `lookbook:new`.
- They exist to keep recommendations timely, alerts trustworthy, and daily engagement high.

Key takeaways:

1. Delivery is intentionally redundant with Socket+Push+Polling so alerts survive disconnects and
  degraded networks.
2. Shared payload contracts keep channels aligned: `lookbook:new`, `ritual:update`, and
  `alert:weather` all use `{ version, timestamp, userId, data }`.
3. Runtime fallback is deterministic: reconnect backoff (1s/3s/9s, max 5) then polling
  `GET /api/v1/events/poll` until socket recovery.

Story/Task mapping:

- Story 0.5
- Task 1 (Socket.io server), Task 2 (connection lifecycle), Task 3 (Expo Push), Task 4 (shared
payload schema), Task 5 (fallback)

Story reference:

- `docs/implementation-artifacts/0-5-initialize-socketio-gateway-and-expo-push-api.md`

Code evidence:

- `apps/api/src/modules/gateway/gateway.gateway.ts`
- `apps/api/src/modules/gateway/connection-manager.service.ts`
- `apps/api/src/modules/events/events.service.ts`
- `apps/api/src/modules/notifications/push-token.repository.ts`
- `apps/api/src/modules/notifications/push-notification.service.ts`
- `packages/api-client/src/realtime/polling-service.ts`

Architecture diagram:

```mermaid
flowchart TD
  ES[Events service] --> GW[Socket gateway namespaces]
  GW --> LB[lookbook:new]
  GW --> RU[ritual:update]
  GW --> AW[alert:weather]

  ES --> PUSH[Push notification service]
  PUSH --> EXPO[Expo Push API]
  EXPO --> DEVICE[Mobile device notifications]

  CM[Connection manager<br/>retry/backoff] --> GW
  CM --> FALLBACK[Fallback switch]
  FALLBACK --> POLL[Polling service]
  POLL --> API[GET /api/v1/events/poll]
  API --> DEVICE
  GW --> DEVICE
```



## Step 7 - CI/CD and automated quality gates

User/business impact:

Automated CI/CD quality gates catch regressions before merge and release, so users encounter fewer
broken core flows. The business lowers hotfix load and ships faster with predictable release
confidence.

Key takeaways:

1. PR quality gates are split intentionally: `pr-checks.yml` blocks typecheck/lint/test/build,
  while `pr-pw-e2e.yml` runs sharded Playwright and enforces the required E2E gate.
2. Flake control is explicit: `rwf-burn-in.yml` reruns changed Playwright specs 3x (with
  `SKIP_BURN_IN` override) before full E2E proceeds.
3. Deployment confidence is surface-aware: Vercel Preview smoke runs from `deployment_status`
  (`pr-pw-e2e-vercel-preview.yml`), while mobile deploy remains manual via `deploy-mobile.yml`.

Story/Task mapping:

- Story 0.6 (status: review)
- Task 1 (test workflow), Task 2 (parallelization), Task 12 (PR preview smoke), Task 13 (API
deployment prep)

Story reference:

- `docs/implementation-artifacts/0-6-scaffold-cicd-pipelines-github-actions.md`

Code evidence:

- `.github/workflows/pr-checks.yml`
- `.github/workflows/pr-pw-e2e.yml`
- `.github/workflows/rwf-burn-in.yml`
- `.github/workflows/pr-pw-e2e-vercel-preview.yml`
- `.github/workflows/gitleaks-check.yml`
- `.github/workflows/deploy-mobile.yml`
- `.github/actions/install/action.yml`
- `.github/actions/setup-playwright-browsers/action.yml`

Supporting docs:

- `docs/test-artifacts/ci-cd-pipeline.md`

Architecture diagram:

```mermaid
flowchart TD
  PR[Pull request] --> PRCHECKS[pr-checks.yml<br/>typecheck + lint + test + build]
  PR --> GITLEAKS[gitleaks-check.yml]
  PR --> E2E[pr-pw-e2e.yml]

  E2E --> BURNIN[rwf-burn-in.yml<br/>changed Playwright specs x3]
  BURNIN --> SHARDS[Playwright shards<br/>1/2 + 2/2]
  SHARDS --> MERGE_REPORTS[merge-reports<br/>artifact + summary]
  MERGE_REPORTS --> E2E_GATE[E2E required gate]

  PR --> PREVIEW[Vercel Preview deployment]
  PREVIEW --> PREVIEW_SMOKE[pr-pw-e2e-vercel-preview.yml<br/>web-health-sha smoke]

  PRCHECKS --> READY{Ready to merge?}
  GITLEAKS --> READY
  E2E_GATE --> READY
  PREVIEW_SMOKE --> READY

  READY --> MAIN[Merge to main]
  MAIN --> PROD[Vercel Production deploy<br/>web + API serverless target]
  MAIN --> MOBILE[deploy-mobile.yml<br/>manual Android EAS build]
```



## Step 8 - Shared analytics contracts and event tracking

PostHog is the product analytics and feature-flag platform in this repo, used to capture behavior
events consistently across web, mobile, and API. It gives the team reliable funnel and retention
signals for product decisions and experiment rollout control.

User/business impact:

Shared analytics contracts keep event names and payloads consistent across web, mobile, and API,  
reducing tracking bugs that can affect user journeys. The business gets trustworthy funnel and  
retention data for faster, higher-confidence product decisions.

Key takeaways:

1. Analytics contracts are centralized in `packages/api-client/src/types/analytics-events.ts` to
  prevent event-name and payload drift.
2. Contract wrappers validate inputs, normalize to snake_case PostHog properties, and emit
  consistent payloads across web, mobile, and API.
3. Governance comes from integration checks that enforce the five core events and catch schema
  regressions early.

Story/Task mapping:

- Story 0.7
- Task 2 (event schema), Task 3 (event tracking in apps)

Story reference:

- `docs/implementation-artifacts/0-7-configure-posthog-opentelemetry-and-grafana-cloud.md`

Code evidence:

- `packages/api-client/src/types/analytics-events.ts`
- `apps/mobile/src/analytics/track-events.ts`
- `apps/web/src/app/components/analytics-event-actions.tsx`
- `apps/web/src/app/components/posthog-click-tracker.tsx`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/integration/analytics-tracking.integration.spec.ts`

Architecture diagram:

```mermaid
flowchart TD
  web["Web tracking actions"] --> contracts["Analytics contracts\nZod schemas and event names"]
  mobile["Mobile tracking wrappers"] --> contracts
  api_services["API tracking services auth and moderation"] --> contracts
  contracts --> wrappers["Track helpers\nsnake_case mapping"]
  wrappers --> ph_dev["PostHog dev project"]
  wrappers --> ph_prod["PostHog prod project"]
  tests["Analytics integration tests"] --> contracts
  tests --> wrappers
```



## Step 9 - Observability bootstrap with OpenTelemetry

User/business impact:

OpenTelemetry from process startup gives full-path visibility, enabling faster detection and
diagnosis when user-impacting issues occur. The business reduces downtime and MTTR with
standardized traces and metrics flowing to one observability backend.

Key takeaways:

1. Bootstrap order is the control point: OpenTelemetry starts before Nest app creation so startup
  and request paths are instrumented from the first tick.
2. Guardrails prevent noisy telemetry: missing `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID`, or
  `GRAFANA_API_KEY`, `NODE_ENV=test`, `OTEL_SDK_DISABLED=true`, or prior SDK init all no-op
  safely.
3. Root env loading is part of the local contract: the API now reads root `.env.local`, `.env.dev`
  / `.env.prod`, and `.env` before OTEL startup, so env changes require a full API restart.
  Hosted Vercel deployments do not read those repo files at runtime; they must be configured in
  Vercel project environment variables separately.
4. Exported identity matters: set a stable OpenTelemetry `service.name` so Grafana shows
  `couturecast-api` instead of `unknown_service:node`.
5. Vendor-neutral observability is explicit: W3C trace propagation + Node auto-instrumentations +
  OTLP exporters stream metrics/traces to Grafana with minimal app-level coupling.

Environment setup:

- Put the OTLP endpoint into `GRAFANA_OTLP_ENDPOINT`.
- Put the Grafana OTLP `Instance ID` into `GRAFANA_INSTANCE_ID`.
- Put the generated Grafana token into `GRAFANA_API_KEY`.
- Add all three keys to the root `.env.local`, `.env.dev`, and `.env.prod` files.
- Add matching GitHub Actions repository secrets named `GRAFANA_OTLP_ENDPOINT`,
  `GRAFANA_INSTANCE_ID`, and `GRAFANA_API_KEY`.
- Add the same three keys to the Vercel API project environment variables:
  Preview should mirror `.env.dev`, and Production should mirror `.env.prod`.
- In this repo there is no separate hosted Vercel Development environment in active use:
  PRs deploy to Vercel Preview, and merges to `main` deploy to Vercel Production.
- The API exports `service.name = couturecast-api` by default; use `OTEL_SERVICE_NAME` only if you
  intentionally need to override that.

Story/Task mapping:

- Story 0.7
- Task 4 (OpenTelemetry setup in NestJS)

Story reference:

- `docs/implementation-artifacts/0-7-configure-posthog-opentelemetry-and-grafana-cloud.md`

Code evidence:

- `apps/api/src/instrumentation.ts`
- `apps/api/src/main.ts`
- `apps/api/src/instrumentation.spec.ts`
- `apps/api/src/load-env.ts`
- `apps/api/src/load-env.spec.ts`

Architecture diagram:

```mermaid
flowchart TD
  env["Process env"] --> skip{"Test env, SDK disabled, or already initialized?"}
  skip -- Yes --> noop["Skip OTEL bootstrap"]
  skip -- No --> creds{"OTLP endpoint, instance ID, and token present?"}
  creds -- No --> noop
  creds -- Yes --> cfg["Build OTLP exporter config"]
  cfg --> exporters["Create trace and metric exporters"]
  exporters --> sdk_cfg["Configure NodeSDK with W3C trace context"]
  sdk_cfg --> start["initializeOpenTelemetry()"]
  start --> nest["Bootstrap Nest app"]
  nest --> app["Handle HTTP requests and worker activity"]
  app --> otlp["Export spans and metrics via OTLP"]
  otlp --> grafana["GRAFANA_OTLP_ENDPOINT"]
  start --> tests["instrumentation.spec.ts validates init behavior"]
```



## Step 10 - Grafana Cloud account and OTLP credential setup

User/business impact:

A working Grafana Cloud stack turns local OpenTelemetry instrumentation into an actual
observability workflow the team can use. The business gets faster debugging and safer rollout
decisions once traces and metrics can be verified in a shared hosted backend instead of only in
local code.

Key takeaways:

1. Grafana Cloud account setup is part of the implementation, not an external prerequisite:
  without a stack and OTLP credentials, the API's OpenTelemetry bootstrap safely no-ops.
2. This repository uses three exact placeholders for Grafana OTLP setup:
  `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID`, and `GRAFANA_API_KEY`.
3. Those same three names must be used across local root env files, GitHub Actions repository
  secrets, and Vercel API project environment variables so local, CI, Preview, and Production all
  read the same contract.
4. Grafana Cloud usually provisions the core stack data sources already, including Tempo
  (traces), Loki (logs), and Prometheus/Mimir (metrics), and it may also add other
  Grafana-managed sources such as alert history, profiles, or usage views. First-time setup
  should verify those built-in data sources before creating duplicates.

First-time setup flow:

1. Create a Grafana Cloud account and open the Grafana Cloud Portal.
2. Create stack `couturecastobservability`.
  Grafana stack names must be lowercase alphanumeric, start with a letter, and cannot contain
  dots, dashes, underscores, or spaces.
3. Open the stack `Configure` page and copy the stack OTLP endpoint.
4. On the stack OTLP connection details page, copy the `Instance ID`.
5. On the stack OTLP connection details page, under `Password / API Token`, click `Generate now`.
  Grafana pre-fills the OTLP write policy for this stack; confirm it includes `traces:write` and
  `metrics:write`. `logs:write` can stay enabled if logs may be exported later.
6. Put the endpoint, instance ID, and token into the root env files:
  `.env.local`, `.env.dev`, `.env.prod`.
7. Use these exact entries in each root env file:

```bash
GRAFANA_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-2.grafana.net/otlp
GRAFANA_INSTANCE_ID=1555123
GRAFANA_API_KEY=<paste-the-token-you-generated-in-grafana>
```

8. In GitHub, go to `Settings` -> `Secrets and variables` -> `Actions` and create repository
  secrets with those same exact names:
  `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID`, and `GRAFANA_API_KEY`.
  Set `GRAFANA_OTLP_ENDPOINT` to `https://otlp-gateway-prod-us-east-2.grafana.net/otlp`.
  Set `GRAFANA_INSTANCE_ID` to `1555123`.
  Set `GRAFANA_API_KEY` to the same API token you just generated in Grafana Cloud.
9. In the Vercel API project, add those same three keys to environment variables.
  Use `All Pre-Production Environments` for the values that mirror `.env.dev`.
  Use `Production` for the values that mirror `.env.prod`.
  This repo currently uses Vercel Preview for PRs and Vercel Production for `main`; there is no
  separate hosted Vercel Development environment to keep in sync.
10. Start the API with `npm run start:dev --workspace api`, hit
  `http://localhost:3000/api/v1/health/queues`, then verify traces in Grafana `Explore` using
  Tempo and metrics using Prometheus. On the Prometheus screen, an empty graph with no selected
  metric does not prove metrics are broken yet; first click the `Metric` selector and choose an
  available metric before judging the result.
11. If Grafana still shows no traces, add `OTEL_LOG_LEVEL=debug` to `.env.local`, restart the API,
  and inspect the API terminal for OpenTelemetry patching or OTLP export/auth errors before making
  more code changes.
12. Successful verification should show traces under service `couturecast-api`, not
  `unknown_service:node`.

Story/Task mapping:

- Story 0.7
- Task 6 (Grafana Cloud account setup)

Story reference:

- `docs/implementation-artifacts/0-7-configure-posthog-opentelemetry-and-grafana-cloud.md`

Impacted files:

- `docs/implementation-artifacts/0-7-configure-posthog-opentelemetry-and-grafana-cloud.md`
- `docs/learning-path-step-by-step.md`
- `apps/api/src/instrumentation.ts`
- `.env.local`
- `.env.dev`
- `.env.prod`

Supporting references:

- `https://grafana.com/docs/grafana-cloud/get-started/create-account/`
- `https://grafana.com/docs/grafana-cloud/security-and-account-management/cloud-stacks/create-update-stacks/`
- `https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/`
- `https://grafana.com/docs/grafana-cloud/security-and-account-management/authentication-and-permissions/access-policies/create-access-policies/`

Architecture diagram:

```mermaid
flowchart TD
  portal["Grafana Cloud Portal"] --> stack["Create stack couturecastobservability"]
  stack --> configure["Stack Configure page"]
  configure --> endpoint["Copy OTLP endpoint"]
  configure --> token["Create stack-scoped access policy token"]
  endpoint --> envfiles[".env.local .env.dev .env.prod"]
  id --> envfiles
  token --> envfiles
  endpoint --> gh["GitHub Actions secret: GRAFANA_OTLP_ENDPOINT"]
  id["GRAFANA_INSTANCE_ID"] --> gh2["GitHub Actions secret: GRAFANA_INSTANCE_ID"]
  token --> gh3["GitHub Actions secret: GRAFANA_API_KEY"]
  endpoint --> vercelPreview["Vercel Preview env vars<br/>mirrors .env.dev"]
  id --> vercelPreview
  token --> vercelPreview
  endpoint --> vercelProd["Vercel Production env vars<br/>mirrors .env.prod"]
  id --> vercelProd
  token --> vercelProd
  envfiles --> api["apps/api/src/instrumentation.ts"]
  gh --> ci["CI jobs"]
  gh2 --> ci
  gh3 --> ci
  api --> grafana["Grafana Explore: Tempo and Prometheus"]
```

Quick translation cheat sheet:

| Grafana term | Plain English | What it means in this project | Rough DataDog equivalent | Rough AWS equivalent |
| --- | --- | --- | --- | --- |
| Tempo / `-traces` | Distributed traces | Request flows, spans, and timing for API calls such as `GET /api/v1/health/queues` | APM Traces / Trace Explorer | AWS X-Ray traces |
| Prometheus / Mimir / `-prom` | Metrics store | Numeric time-series data such as request duration, process metrics, and exporter metrics | Metrics Explorer / custom metrics | CloudWatch Metrics |
| Loki / `-logs` | Log store | Centralized application logs; for this story it may exist before log ingestion is wired up | Log Explorer / Log Management | CloudWatch Logs |
| Profiles | Continuous profiling | CPU and runtime profiling for deeper performance debugging; not the main focus of Story 0.7 | Continuous Profiler | CodeGuru Profiler |
| Alertmanager / alert state history | Alert routing and alert history | Where alert notifications and state transitions live after dashboards and alerts are added | Monitors / monitor state history | CloudWatch Alarms plus SNS notification flow |
| Usage / usage insights | Grafana account usage data | Grafana's own billing or platform usage views, not your app telemetry | Usage / billing views | Cost Explorer or service usage dashboards |

Quick way to think about it:

- `Tempo` answers: "What happened during this request?"
- `Prometheus` answers: "How much, how often, how long?"
- `Loki` answers: "What did the app log?"
- `Profiles` answers: "Where is the CPU or runtime time going?"



## Step 11 - API observability with structured logging

User/business impact:

Structured request logging makes production failures diagnosable without guesswork across API,
trace, and queue activity. The business gets faster incident response and stronger release
confidence because every request can be tied to a request ID, user context, feature area, and
OpenTelemetry trace.

Key takeaways:

1. Structured logs are part of the contract: API logs emit stable JSON fields including
  `timestamp`, `requestId`, `userId`, `feature`, `level`, and `message`.
2. Request context survives the full request lifecycle: middleware generates or reuses
  `x-request-id`, auth guards enrich `userId`, and later logs inherit that context automatically.
3. Trace correlation is built into the logger: active OpenTelemetry span IDs are attached so logs
  and traces line up in Grafana during debugging.
4. Environment policy matters: local defaults to `debug`, dev to `info`, and prod to `warn`,
  keeping signal-to-noise appropriate per environment.

Story/Task mapping:

- Story 0.7
- Task 5 (Pino structured logging)

Story reference:

- `docs/implementation-artifacts/0-7-configure-posthog-opentelemetry-and-grafana-cloud.md`

Code evidence:

- `apps/api/src/main.ts`
- `apps/api/src/logger/pino.config.ts`
- `apps/api/src/logger/request-context.ts`
- `apps/api/src/logger/request-logger.middleware.ts`
- `apps/api/src/logger/pino.config.spec.ts`
- `apps/api/src/logger/request-context.spec.ts`
- `apps/api/src/logger/request-logger.middleware.spec.ts`

Architecture diagram:

```mermaid
flowchart LR
  client["Client request"] --> reqid["Request-context middleware<br/>generate or reuse x-request-id"]
  reqid --> httplog["pino-http middleware<br/>request_received / request_completed"]
  httplog --> nest["Nest guards + handlers"]
  nest --> auth["Auth guard enriches userId"]
  auth --> svc["Shared Pino logger in services"]
  svc --> trace["Active OTEL span context"]
  trace --> grafana["Grafana / OTLP correlation"]

  reqid --> context["AsyncLocalStorage request context"]
  context --> httplog
  context --> svc
```



## Step 12 - Cross-surface E2E confidence

User/business impact:

Cross-surface smoke E2E coverage catches critical web and mobile regressions before users hit them
in production. The business can release more frequently with less manual QA effort and clearer
pass/fail evidence.

Key takeaways:

1. Cross-surface execution is standardized at the root: Playwright (`test:pw-local`) and Maestro
  (`test:mobile:e2e`) run from shared workspace scripts.
2. Smoke coverage is purpose-built by surface: web validates API health, core hero rendering, and
  accessibility; mobile validates Expo launch/connect and basic tab navigation flow.
3. Confidence comes from artifacts plus policy: Playwright HTML/trace outputs and Maestro
  screenshots/logs support fast triage, while web is PR-gated and mobile remains manual/local by
   default.

Story/Task mapping:

- Story 0.13
- Task 1 (Playwright harness), Task 2 (Maestro harness), Task 4 (CI integration)

Story reference:

- `docs/implementation-artifacts/0-13-scaffold-cross-surface-e2e-automation.md`

Supporting docs:

- `docs/test-artifacts/test-design-system.md`

Code evidence:

- `playwright/config/base.config.ts`
- `playwright/config/local.config.ts`
- `playwright/tests/home.spec.ts`
- `playwright/tests/web-health-sha.spec.ts`
- `maestro/sanity.yaml`
- `scripts/run-maestro.mjs`
- `.github/workflows/pr-pw-e2e.yml`
- `.github/workflows/pr-mobile-e2e.yml`

Architecture diagram:

```mermaid
flowchart LR
  trigger["Developer or CI run"] --> pick{"Select surface"}
  pick --> web_e2e["Web E2E test:pw-local"]
  pick --> mobile_e2e["Mobile E2E test:mobile:e2e"]
  web_e2e --> web_server["Start API and Web test servers"]
  web_server --> web_smoke["Run Chromium smoke tests"]
  web_smoke --> web_artifacts["HTML report, traces, screenshots"]
  web_artifacts --> web_gate["PR gating checks"]
  mobile_e2e --> maestro_install["Install Maestro CLI"]
  maestro_install --> metro["Start or reuse Metro and Expo URL"]
  metro --> mobile_smoke["Run maestro sanity flow"]
  mobile_smoke --> mobile_artifacts["Maestro screenshots and logs"]
  mobile_artifacts --> mobile_policy["Local manual default, non gating CI"]
```
