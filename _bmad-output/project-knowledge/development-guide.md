# Development guide

Updated: 2026-07-17 - Brownfield deep scan of current manifests, scripts, configuration,
and active READMEs.

## Command authority

Run commands from the repository root unless a section says otherwise. The executable
source of truth is the current root [`package.json`](../../package.json), workspace
manifests, and scripts under [`scripts/`](../../scripts/). The root
[`README.md`](../../README.md) is useful context, but some descriptions have drifted:

- `npm run dev` only runs workspaces that currently define a `dev` script. At present,
  that is the web workspace; it does not start API or mobile.
- `npm run start:all` starts local Supabase, resets its database, and then starts API and
  web. It is destructive to local database contents.
- [`apps/web/README.md`](../../apps/web/README.md) and most of
  [`apps/api/README.md`](../../apps/api/README.md) are framework starter text. Use the
  root and workspace manifests instead of their generic `yarn`, `pnpm`, `bun`, or
  workspace-local examples.
- BMAD planning and implementation artifacts describe intended or historical behavior.
  A command in those documents is not considered available until it exists in a current
  manifest or script.

Installed versions come from [`package-lock.json`](../../package-lock.json), not version
numbers repeated in planning documents or older README tables.

## Prerequisites

Required for the normal application path:

- Node.js 24.x, as pinned by [`.nvmrc`](../../.nvmrc). The install hook rejects any
  other Node major.
- npm 10.8.1, as declared by the root manifest.
- Docker with Compose support, for local Supabase, Redis, and Grafana LGTM.
- Git, because change-scoped validation inspects the working tree.

Required for specific workflows:

- Playwright browser binaries for browser E2E.
- The k6 CLI on `PATH` for performance tests.
- Xcode plus an installed iOS Simulator runtime for iOS Maestro runs.
- Android Studio, an SDK, and an AVD or attached device for Android Maestro runs.
- Homebrew or the supported installer path used by `npm run maestro:install`.
- `gh` authenticated to GitHub and Vercel access variables when automatic Preview URL
  discovery is needed.

## First-time setup

```bash
nvm install 24
nvm use 24
npm ci
npx playwright install --with-deps
```

`npm ci` uses the checked-in lockfile and runs the repository's Node-version check and
Husky preparation. Start Docker before using Supabase, Redis, Grafana, local Playwright,
or local k6 workflows.

Optional tool setup:

```bash
npm run maestro:install
k6 version
docker compose version
```

Create only the environment files needed for the target environment. Use
[`.env.example`](../../.env.example) as a variable inventory, not as working
credentials. All `.env*` files except `.env.example` are ignored by Git.

## Environment files and precedence

The repository recognizes root `.env`, `.env.local`, `.env.preview`, and `.env.prod`
files. Do not put real values in documentation, committed files, shell history, or test
artifacts.

API runtime and migration startup load:

1. `.env.local`
2. `.env.prod` when `NODE_ENV=production`, otherwise `.env.preview`
3. `.env`

Normally an inherited shell variable wins, then the first file defining a key wins.
When `TEST_ENV=local`, `.env.local` deliberately overrides inherited values so local
smoke tests cannot accidentally retain remote database or service targets.

Web and mobile app configuration use the same file order, with inherited variables
always winning. This means `.env.local` is consulted even for production-mode builds;
keep it local-only and do not reuse a cloud credentials file under that name.

Playwright has two entry paths:

- `npm run test:pw-local` lets `.env.local` override inherited and generic `.env`
  values, then falls back to the existing process environment.
- `npm run test:pw-preview` first loads `.env.preview` through the Preview wrapper, so
  precedence is inherited shell, `.env.preview`, then `.env`.
- A direct `TEST_ENV=preview npx playwright test` loads `.env` before the environment
  resolver. For predictable Preview behavior, use the npm wrapper.
- Production tests select `.env.prod`, but remote production runs should rely on
  explicitly injected, least-privilege variables rather than shared local files.

k6 loads only the selected `.env.local`, `.env.preview`, or `.env.prod` file. Its shell
loader exports file entries, so a value in that file can replace an inherited value.
Use one target per file and review the selected target before any load run.

Environment variable groups used by current code include:

- Database and Supabase: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- App and test origins: `API_BASE_URL`, `WEB_BASE_URL`, `WEB_E2E_BASE_URL`,
  `NEXT_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_API_BASE_URL`,
  `PREVIEW_WEB_E2E_BASE_URL`, `PREVIEW_WEB_BASE_URL`, `PREVIEW_API_BASE_URL`,
  `PROD_WEB_E2E_BASE_URL`, `PROD_WEB_BASE_URL`, `PROD_API_BASE_URL`.
- Preview discovery: `VERCEL_TOKEN`, `VERCEL_WEB_PROJECT_SLUG`,
  `VERCEL_API_PROJECT_SLUG`, `VERCEL_TEAM_SLUG`,
  `VERCEL_AUTOMATION_BYPASS_SECRET`.
- Auth and guardian flows: `AUTH_USERNAME`, `AUTH_PASSWORD`,
  `PREVIEW_AUTH_USERNAME`, `PREVIEW_AUTH_PASSWORD`, `PROD_AUTH_USERNAME`,
  `PROD_AUTH_PASSWORD`, `GUARDIAN_INVITE_WEB_BASE_URL`,
  `GUARDIAN_INVITE_JWT_SECRET`, `GUARDIAN_EMANCIPATION_REVOKE_CONSENTS`.
- Redis and integrations: `REDIS_URL`, `REDIS_TLS`, `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`, `POSTHOG_API_KEY`, `POSTHOG_HOST`, `EXPO_TOKEN`,
  `OPENWEATHER_API_KEY`, `WEATHERAPI_API_KEY`, `WEATHER_REFRESH_MINUTES`,
  `WEATHER_PROVIDER_MODE`, `WEATHER_INGESTION_TARGETS_JSON`.
- Local telemetry: `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_OTLP_AUTH_HEADER`,
  `OTEL_SERVICE_NAME`.

## Local services

Local Supabase provides PostgreSQL, Auth, Storage, and Studio:

```bash
npm run supabase:start
npm run supabase:stop
```

Prisma remains the schema, migration, and seed owner. Supabase is the local host, not a
replacement migration system.

Redis is a separate Compose service:

```bash
docker compose up -d redis
docker compose logs -f redis
docker compose down
```

Start BullMQ workers separately from the API:

```bash
npm run start:workers --workspace api
```

The HTTP API does not run the durable weather worker scheduler. Redis degradation is
handled by application fallbacks, but queue behavior requires Redis and the worker
process.

## Start applications and workspaces

Start all three development surfaces explicitly in separate terminals:

```bash
npm run start:api
npm run dev --workspace web
npm run start --workspace mobile
```

`start:api` generates Prisma, applies committed migrations with `migrate deploy`, then
watches and restarts compiled API output. The API uses port 4000 by default. The direct
web development command uses Next's default development port. Expo chooses its normal
Metro port.

For the built web and API pair used by local E2E:

```bash
npm run start:all
```

This command starts Supabase, runs `db:reset`, then starts API on port 4000 and the built
web app on port 3005. Do not use it against a database containing data you need.

Useful single-surface commands:

```bash
npm run start:web
npm run start:api
npm run start:mobile:server
npm run dev --workspace web
npm run android --workspace mobile
npm run ios --workspace mobile
```

The root `npm run dev` currently reaches only the web workspace. Workspace pre-hooks
build required shared packages before web, mobile, and API operations.

## Database tasks

All Prisma commands require `DATABASE_URL`. The schema is
[`packages/db/prisma/schema.prisma`](../../packages/db/prisma/schema.prisma), and
generated Prisma client output must not be edited.

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:reset
npm run db:studio --workspace packages/db
```

- `db:generate` regenerates the Prisma client.
- `db:migrate` runs `prisma migrate dev`; use it while authoring a migration.
- `db:seed` runs the TypeScript seed entry point.
- `db:reset` force-resets the selected database, reapplies migrations, and seeds it.
- API startup uses `prisma migrate deploy`, which applies committed migrations without
  creating a new migration.

Always inspect the target behind `DATABASE_URL` before `db:migrate`, `db:seed`, or
`db:reset`. Local Playwright and local k6 are designed for the local Supabase database.

## Contract and SDK generation

Human-authored HTTP contracts live under
[`packages/api-client/src/contracts/http/`](../../packages/api-client/src/contracts/http/).
The OpenAPI document and generated SDK are outputs.

For a contract change:

```bash
npm run generate:http-openapi
npm test --workspace @couture/api-client
npm run optic:lint
npm run optic:diff
npm run generate:api-client
```

`generate:api-client` regenerates the HTTP OpenAPI document before running OpenAPI
Generator and the repository postprocessor. Commit canonical contract changes, the
updated OpenAPI artifact, and generated SDK changes together. Never hand-edit
`packages/api-client/src/generated/` or `packages/api-client/docs/http.openapi.json`.

## Focused validation

Use the narrowest current workspace gate while iterating:

```bash
npm run verify:api
npm run verify:web
npm run verify:mobile
npm run test --workspace api
npm run test:integration --workspace api
npm run test --workspace web
npm run test --workspace mobile
npm test --workspace @couture/api-client
```

For another package:

```bash
npm run lint --workspace <workspace-name>
npm run typecheck --workspace <workspace-name>
npm run test --workspace <workspace-name>
npm run build --workspace <workspace-name>
```

Change-scoped validation examines uncommitted and untracked paths reported by
`git status`; it does not compare committed branch history with `main`:

```bash
npm run verify:changed:list
npm run verify:changed
```

It ignores documentation and environment files and warns about unmapped root changes.
Run broader checks when root scripts, shared configuration, E2E, Pact, or k6 files
change.

## Full validation

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run validate
npm run test:coverage
```

`npm run validate` runs typecheck, lint, workspace tests, and build sequentially. It does
not include integration suites, Playwright, Pact, k6, Maestro, Optic diff, or a Markdown
link checker; run the relevant specialized gate as well.

## Playwright

See the active suite notes in [`playwright/README.md`](../../playwright/README.md).
Install browser binaries once, then use manifest-backed wrappers:

```bash
npm run test:pw-local
npm run test:pw-local-ui
npm run test:pw-preview
npm run test:pw-preview-ui
npm run test:pw-prod
npm run test:pw-prod-ui
```

Local Playwright builds shared packages and starts/reuses API and web through its
`webServer` configuration. Failures retain traces, screenshots, and video under
`playwright/artifacts/`; HTML reports go under `playwright/playwright-report/`.

Run one spec or a title match by forwarding Playwright arguments:

```bash
npm run test:pw-local -- playwright/tests/api/api-health.spec.ts
npm run test:pw-local -- --grep "health"
```

Burn-in options:

```bash
npm run test:pw:burn-in
npm run test:pw:burn-in-changed
npm run test:pw:burn-in-changed-classic
```

Production tests can affect real systems. Run only approved read-safe scenarios with
explicit production authorization and least-privilege credentials.

## Pact

[`pact/README.md`](../../pact/README.md) matches the current local workflow:

```bash
npm run test:pact
npm run test:pact:consumer
npm run test:pact:provider
```

The full command regenerates and lints HTTP OpenAPI, generates consumer pacts three
times to detect nondeterminism, then verifies the provider. Run the consumer command
before provider-only verification when `pacts/` is absent. There is no configured Pact
Broker; `npm run test:pact` is the local deployability gate.

## k6

Install the k6 binary separately and review [`k6/README.md`](../../k6/README.md):

```bash
npm run test:k6
npm run test:k6:local
npm run test:k6:preview
npm run test:k6:prod
```

Local k6 starts the API E2E runtime and runs smoke profiles. Select a non-smoke profile
with `TEST_CONFIG`; current templates are under
[`packages/k6-utils/templates/load-profiles/`](../../packages/k6-utils/templates/load-profiles/).

```bash
TEST_CONFIG=packages/k6-utils/templates/load-profiles/constant-rate.json \
  npm run test:k6:local
```

Remote commands do not start a server. Confirm `BASE_URL` resolution and authorization
before running them. Never point a load profile at production without an approved test
window, traffic limits, monitoring, and rollback ownership.

## Maestro

The repository runner installs or reuses Maestro, selects an explicit platform, starts
or reuses Expo, ensures Expo Go is available, and runs `maestro/sanity.yaml` followed by
`maestro/analytics.yaml`.

```bash
npm run maestro:install
npm run test:mobile:e2e:android
npm run test:mobile:e2e:ios
```

Android can auto-boot an AVD and install the expected Expo Go build. Set `AVD_NAME` when
the default emulator cannot be selected. iOS requires macOS, Xcode, an installed
Simulator runtime, and a usable simulator. Artifacts are written under
`maestro/artifacts/`.

To run a specific flow while retaining repository orchestration:

```bash
MOBILE_E2E_PLATFORM=ios node scripts/run-maestro.mjs maestro/sanity.yaml --artifacts
```

## Observability

The local LGTM stack supports API traces and metrics, not application log ingestion:

```bash
npm run observability:local:up
npm run observability:local:api
npm run observability:local:logs
npm run observability:local:down
```

Grafana is exposed on port 3300, OTLP/HTTP on 4318, and Prometheus on 9090. Structured
API logs remain in the API terminal. The startup command prepares local-only dashboard
copies, starts the pinned LGTM image, and configures the API's OTLP exporter. See
[`infra/grafana/local/README.md`](../../infra/grafana/local/README.md) for current
dashboard verification steps.

## Troubleshooting

### Install exits before dependency resolution

The preinstall script requires Node major 24. Run `nvm install 24 && nvm use 24`, verify
`node --version`, then rerun `npm ci`.

### Root `npm run dev` does not start every app

This is current manifest behavior, not a Turbo failure. Use `npm run start:api`,
`npm run dev --workspace web`, and `npm run start --workspace mobile` in separate
terminals, or use `npm run start:all` for the destructive local E2E pair.

### API startup fails during migration

Check that Docker and local Supabase are running, then inspect which environment file
or inherited `DATABASE_URL` won. `start:api` runs migrate deploy before boot and stops
on migration failure.

### Prisma client or shared package imports are stale

```bash
npm run db:generate
npm run build:packages
```

Workspace pre-hooks normally build shared dependencies. After switching branches, also
consider `npm run typecheck:clear-cache`.

### Redis or queue health is degraded

Start `docker compose up -d redis`, confirm port 6379 is free, then start workers with
`npm run start:workers --workspace api`. The API process alone does not consume durable
jobs.

### Playwright cannot find a browser

Run `npx playwright install --with-deps`. If ports 3005 or 4000 are occupied, stop the
old process or verify that it is the intended reusable server. Review retained
Playwright artifacts instead of rerunning with retries first.

### Preview tests resolve the wrong deployment

Push the branch and confirm Vercel has a ready deployment. Run the Preview npm wrapper,
not direct Playwright. Set explicit `PREVIEW_WEB_E2E_BASE_URL` and
`PREVIEW_API_BASE_URL` when automatic GitHub/Vercel discovery is ambiguous. Use
`DEBUG=true` only for URL-resolution diagnostics and do not paste token-bearing output.

### Maestro cannot find a target

For Android, ensure `adb devices` shows a usable target or set `AVD_NAME`; run
`npm run mobile:expo-go` if automatic Expo Go installation failed. For iOS, install a
Simulator runtime in Xcode and verify `xcrun simctl list runtimes -j` responds.

### k6 reports `command not found`

The npm install supplies TypeScript bundling support, not the k6 executable. Install k6
for the host platform and verify `k6 version` before rerunning.

### Grafana is up but application logs are absent

That is expected. The local stack currently receives OTEL traces and metrics; API logs
remain in the API terminal. Generate API traffic and inspect the trace datasource.

## Safety notes

- Never commit `.env`, credentials, tokens, production data, wardrobe media, or
  identifiable fixtures.
- Treat `db:reset`, `start:all`, remote k6, production Playwright, Prisma migrations,
  seeds, and deployment commands as target-sensitive or destructive.
- Verify the database host and remote base URLs before every mutating or load workflow.
- Keep local and Preview services isolated from production Supabase, Redis, storage,
  analytics, notifications, and weather-provider resources.
- Do not bypass JWT validation, authorization guards, row-level security, consent
  checks, or Vercel protection except through the documented least-privilege test path.
- Do not log service keys, JWTs, contact details, wardrobe payloads, or provider secrets.
- Change public contracts at their canonical Zod source and regenerate outputs; do not
  patch generated artifacts to make validation pass.
