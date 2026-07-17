# Deployment guide

Updated: 2026-07-17 - Brownfield deep scan of deployment and operational configuration.

## Scope and evidence boundary

This guide describes only deployment behavior supported by repository code and configuration. It
does not assume undocumented Vercel project settings, Supabase projects, Grafana Cloud rules,
provider-side rollback procedures, or app-store credentials.

The scan covered Vercel and Expo configuration, GitHub Actions, environment loading, Prisma and
Supabase configuration, health/SHA checks, worker startup, observability, and deployment-related
tests.

## Deployment map

| Surface       | Current target                                       | Trigger in the repository                                             | Verification present                                                         |
| ------------- | ---------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Web           | Separate Vercel project                              | Vercel Git integration is expected; no deploy workflow is stored here | Preview web health/SHA, production web health/SHA, Playwright                |
| API           | Separate Vercel project and Node serverless function | Vercel Git integration is expected; no deploy workflow is stored here | Preview API health/SHA; production only checks a secondary API route         |
| Mobile        | Expo EAS Android production build                    | Manual GitHub `workflow_dispatch` or local npm command                | EAS authentication and build submission only; Maestro is separate and manual |
| Workers       | None recorded                                        | Local or manually started process only                                | Startup logging and automated unit/integration coverage                      |
| Database      | Supabase PostgreSQL through `DATABASE_URL`           | API Vercel build and local/API E2E startup paths                      | Prisma command exit status; no post-migration deployment probe               |
| Observability | Optional Grafana OTLP endpoint; local LGTM stack     | API process startup when OTLP configuration is complete               | OTEL bootstrap log, integration test, dashboards and local manual checks     |

The workflows verify deployments but do not create the web or API Vercel deployments. Separate
project names and production URLs are encoded in
[the Preview workflow](../../.github/workflows/pr-pw-e2e-vercel-preview.yml),
[the production workflow](../../.github/workflows/pw-e2e-prod.yml), and the
[Playwright environment resolver](../../playwright/config/environments.ts). Vercel project linkage,
root directories, production branches, domains, and provider environment variables remain
provider-side configuration.

## Web deployment

The web surface is a Next.js application under [apps/web](../../apps/web/). There is no web
`vercel.json`; the repository relies on Vercel's Next.js behavior and project settings. Its build
script prepares shared packages and runs `next build`; Vercel deployment itself is not invoked by
GitHub Actions.

[Next configuration](../../apps/web/next.config.ts) performs deployment-relevant work at build
time:

- It loads the first available root environment files in the order `.env.local`, `.env.prod` when
  `NODE_ENV=production` or `.env.preview` otherwise, then `.env`.
- Existing process variables win, so provider-injected values are not overwritten.
- It embeds the resolved build SHA and branch for `/api/health`.
- It proxies `/api/v1/*` to a separately configured API origin.
- Under `NODE_ENV=production`, production API variables are preferred before preview variables.
- TypeScript and ESLint build failures are ignored by Next itself. The separate PR quality workflow
  is therefore the repository's build-quality guard.

The public deployment probe is
[`GET /api/health`](../../apps/web/src/app/api/health/route.ts). It returns `status`, service,
environment, Git SHA, branch, deployment URL when available, and a timestamp. Git metadata prefers
build/Vercel variables and falls back to local Git through
[the web metadata resolver](../../apps/web/git-metadata.ts).

## API deployment

The API is configured as a Vercel Node serverless function by
[apps/api/vercel.json](../../apps/api/vercel.json):

- `api/index.ts` is the only configured function.
- The function has a 25-second maximum duration and 1024 MB memory.
- Every path is rewritten to that function.

The API package's `vercel:build` script, defined in
[apps/api/package.json](../../apps/api/package.json), runs these steps in order:

1. Generate Prisma Client from the repository schema.
2. Apply committed migrations with `prisma migrate deploy`.
3. Build the NestJS API.

The serverless [request handler](../../apps/api/api/index.ts) creates an Express adapter, initializes
Nest once per warm function instance, caches the Express server promise, and forwards each request.
It does not call `listen()`.

### Serverless and long-running bootstrap differences

The serverless handler is not equivalent to the long-running
[API bootstrap](../../apps/api/src/main.ts). The long-running path:

- imports the root environment loader;
- initializes OpenTelemetry before loading Nest and framework modules;
- installs request context and request logging middleware;
- installs the global telemetry-aware exception filter;
- optionally mounts OpenAPI;
- emits startup analytics; and
- listens on `PORT`.

The serverless handler imports `AppModule` directly and only creates and initializes Nest. It does
not import the environment loader or OTEL bootstrap and does not install the middleware, exception
filter, OpenAPI setup, or startup analytics from `main.ts`. Provider-injected variables are
therefore required for the serverless path, and the documented API OTEL/request-log behavior is not
established by this entry point.

The API health probe is
[`GET /api/health`](../../apps/api/src/controllers/api-health.controller.ts). It reports status,
service, environment, Git SHA, branch, deployment URL, and timestamp. The
[API metadata resolver](../../apps/api/src/git-metadata.ts) prefers deployment variables, including
`VERCEL_GIT_COMMIT_SHA`, before local Git.

The probe is a process/deployment identity check, not a readiness check for PostgreSQL, Redis,
Supabase, weather providers, queues, or OTLP export. It returns `status: ok` without testing those
dependencies.

## Preview deployment verification

[Vercel Preview E2E](../../.github/workflows/pr-pw-e2e-vercel-preview.yml) runs when a pull request
is synchronized or receives the `PREVIEW` label. It:

1. Resolves separate web and API Preview URLs for the PR branch.
2. Polls each surface's `/api/health` independently.
3. Requires each response to report `status: ok` and the first seven characters of the PR SHA.
4. Uses the Vercel protection bypass header and retained cookie for protected previews.
5. Passes the exact resolved web and API URLs to the reusable Playwright workflow.

The [web URL resolver](../../scripts/resolve-vercel-preview-url.mjs) accepts an explicit override,
tries branch aliases, GitHub deployment statuses, and the Vercel API, and may fall back to a recent
Preview unless strict mode is enabled. The
[API URL resolver](../../scripts/resolve-api-preview-url.mjs) first prefers a Vercel deployment with
the expected commit SHA, then a mutable branch alias, then a deterministic alias.

The SHA wait is implemented by
[the Vercel waiter](../../.github/workflows/vercel-wait-for-deployment.yml). It retries for up to the
configured limit, rejects non-JSON responses, rejects missing SHA metadata, and fails if the final
SHA differs from the expected commit.

The reusable [Playwright workflow](../../.github/workflows/rwf-e2e.yml) checks out that same SHA,
maps `DATABASE_URL_PREVIEW` into `DATABASE_URL`, pins the URLs resolved by the caller, and uploads
Playwright artifacts. The
[web health test](../../playwright/tests/web-health-sha.spec.ts) independently checks health
metadata and the expected SHA. The [API smoke test](../../playwright/tests/api/api-health.spec.ts)
checks the API root response but does not assert API health metadata.

## Production deployment verification

[Production E2E](../../.github/workflows/pw-e2e-prod.yml) runs on pushes to `main` and manually. It
uses fixed Vercel production domains and the
[generic deployment waiter](../../.github/workflows/rwf-wait-for-deployment.yml).

Current checks are asymmetric:

- The web `/api/health` must report `status: ok` and match the pushed SHA.
- The API `/api/v1/events/poll` must return HTTP 200.
- The API production deployment is not required to report the expected SHA before tests start.
- Playwright uses `DATABASE_URL_PROD` and fixed production web/API defaults unless overridden.

The production workflow is a post-push verifier, not a deployment job or promotion gate. It does
not control whether Vercel has promoted either project.

## Mobile build and delivery

The mobile app is configured under [apps/mobile](../../apps/mobile/). Its
[EAS configuration](../../apps/mobile/eas.json) defines one `production` profile:

- the app version source is local;
- native version numbers auto-increment;
- Android produces an app bundle;
- iOS requests the `m-medium` resource class;
- an empty production submit profile exists.

[Deploy mobile](../../.github/workflows/deploy-mobile.yml) is manual only. It verifies `EXPO_TOKEN`,
checks EAS identity, and starts an Android production build with `--no-wait`. It does not:

- build iOS;
- wait for the Android build result;
- run Maestro first;
- submit the artifact to Google Play; or
- promote or roll back an EAS update.

The root [npm scripts](../../package.json) provide separate interactive Android build and
non-interactive submit commands. Those commands are not chained by the workflow. Consequently, the
repository supports an Android EAS build request and a separate Android submit command, but not an
automated end-to-end mobile release.

[Mobile E2E](../../.github/workflows/pr-mobile-e2e.yml) is also manual, Android-only, and
`continue-on-error`. It builds a local debug APK and runs Maestro on an emulator. It does not verify
the EAS production artifact.

The native identity and active EAS project are recorded in
[apps/mobile/app.json](../../apps/mobile/app.json). Dynamic
[app configuration](../../apps/mobile/app.config.ts) loads root environment files and exposes
PostHog settings. API calls require `EXPO_PUBLIC_API_BASE_URL` or `API_BASE_URL`, as enforced by the
[mobile API client](../../apps/mobile/src/lib/api-client.ts); the EAS profile does not define that
value in the repository, so it must come from the build environment.

### Root Expo configuration conflict

The repository also contains a root [app.json](../../app.json) with a different EAS project ID from
`apps/mobile/app.json`. Current npm and GitHub build commands change into `apps/mobile`, so that app
configuration is expected to win on those paths. Running Expo or EAS from the repository root can
select the competing root configuration. The repo does not explain or test the intended ownership
of the root file.

## Environment separation

The implemented environment model has local, Preview, and production lanes:

- Populated `.env`, `.env.local`, `.env.preview`, and `.env.prod` files are expected to remain
  gitignored.
- [`.env.example`](../../.env.example) provides placeholders only.
- GitHub Actions uses separate `DATABASE_URL_PREVIEW` and `DATABASE_URL_PROD` secrets.
- Hosted secrets are expected in provider-native stores, as summarized in
  [secrets management](secrets-management.md).
- Playwright has explicit `local`, `preview`, and `prod` configurations in
  [its environment resolver](../../playwright/config/environments.ts).
- Local E2E starts local Supabase and resets only the local database.

The API, web, migration wrapper, and mobile app config choose `.env.prod` whenever
`NODE_ENV=production`; otherwise they choose `.env.preview`, after `.env.local`. Because hosted
build systems commonly set `NODE_ENV=production` for both Preview and production builds, separation
on hosted builds depends on provider-injected variables winning over files. No populated env files
should be shipped with the repository.

[PR checks](../../.github/workflows/pr-checks.yml) use the Preview database secret. The reusable E2E
workflow maps its database URL according to `TEST_ENV`. Manual
[k6 load testing](../../.github/workflows/k6-load.yml) similarly requires distinct Preview and
production API URL secrets or an explicit URL.

The repository cannot prove that provider-side Vercel, Supabase, Upstash, Expo, Grafana, and GitHub
values refer to distinct resources. That remains an external configuration check.

## Supabase and database migrations

[Supabase configuration](../../supabase/config.toml) defines a local stack:

- PostgreSQL 17 on port 54322;
- API, Auth, Storage, Realtime, Studio, Inbucket, and Analytics enabled;
- migrations enabled; and
- seed SQL enabled for database reset.

It does not declare remote Preview or production project provisioning. Remote selection is through
URLs and keys supplied outside version control.

Committed database changes live under
[packages/db/prisma/migrations](../../packages/db/prisma/migrations/). Development uses
`prisma migrate dev`; reset drops/recreates the target and seeds it. The
[migration wrapper](../../scripts/prisma-migrate-deploy.mjs) uses `prisma migrate deploy`, which
applies committed migrations without creating new migrations or seeding.

Migration deployment currently occurs:

- during every API Vercel build through `vercel:build`;
- before local `start:api`;
- before the compiled API E2E startup path; and
- during explicit local database commands.

The target is whichever `DATABASE_URL` is present for that build or process. A migration failure
fails the API build/start command. There is no separate migration workflow, approval gate,
post-migration database probe, backup command, down migration, or automated schema rollback in the
repository. Reverting application code does not revert a migration that has already been applied.

## Worker deployment and operations

The dedicated BullMQ process starts through `npm run start:workers` or
`npm run start:workers:prod` in [the API package](../../apps/api/package.json). Its
[bootstrap](../../apps/api/src/workers/bootstrap.ts):

- loads root environment files;
- creates the configured queues and Redis clients;
- registers the weather refresh scheduler;
- starts weather, alert fan-out, color extraction, and moderation workers;
- logs startup failure and exits nonzero; and
- handles `SIGTERM` and `SIGINT` by closing workers, queues, Redis, PostHog, and Prisma.

No Docker image, Vercel function, GitHub deployment workflow, process manifest, or other hosted
worker target starts this command. The Vercel API function does not start the dedicated workers.
Queue producers and scheduling code exist, but the repository does not currently deploy a
long-running consumer.

[`GET /api/v1/health/queues`](../../apps/api/src/controllers/health.controller.ts) only reports
configured queue names. Queue depth, failure count, latency, worker liveness, and Redis reachability
are TODOs, so this route cannot verify that deployed workers are running.

## Observability

[API instrumentation](../../apps/api/src/instrumentation.ts) exports traces and periodic metrics
over OTLP/HTTP when:

- `GRAFANA_OTLP_ENDPOINT` is set;
- either a usable direct authorization header or Grafana instance/API credentials are set;
- `NODE_ENV` is not `test`; and
- `OTEL_SDK_DISABLED` is not `true`.

It labels the service and deployment environment and enables Node auto-instrumentation with W3C
trace propagation. Missing or incomplete configuration safely disables the SDK. The long-running
API emits an `otel_bootstrap` JSON line describing whether initialization occurred.

The optional [local LGTM stack](../../infra/grafana/local/README.md) and
[Compose file](../../infra/grafana/local/docker-compose.yml) provide Grafana, OTLP/HTTP, Prometheus,
and provisioned dashboards for local inspection. Repository dashboards are under
[infra/grafana/dashboards](../../infra/grafana/dashboards/).

Current supported signals and gaps are detailed in [observability](observability.md):

- HTTP, Node, and V8 traces/metrics are implemented for the long-running API path.
- Queue, Redis, Socket.io, and database metrics are not implemented.
- Loki is not wired as the application log source of truth.
- Repository docs define interpretation thresholds, but no paging or notification policy is
  configured.
- The Vercel serverless entry point does not initialize this OTEL path.

Automated evidence includes
[the observability integration test](../../apps/api/integration/observability.integration.spec.ts).
It validates OTLP trace export and structured request logs against a local capture server; it does
not test a hosted Grafana deployment.

## CI and test gates

Deployment-adjacent controls supported by the repository include:

- [PR checks](../../.github/workflows/pr-checks.yml): Prisma generation, typecheck, lint, build,
  unit coverage, and coverage reporting.
- [Schema validation](../../.github/workflows/schema-validation.yml): generated OpenAPI and Optic
  lint/diff.
- [Contract testing](../../.github/workflows/contract-testing.yml): Pact consumer/provider checks.
- [Local Playwright](../../.github/workflows/pr-pw-e2e-local.yml): local Supabase reset, two shards,
  optional changed-test burn-in, and artifacts.
- [Preview Playwright](../../.github/workflows/pr-pw-e2e-vercel-preview.yml): independent web/API
  SHA waits before hosted E2E.
- [Production Playwright](../../.github/workflows/pw-e2e-prod.yml): production web SHA wait, API
  secondary-route check, and hosted E2E.
- [k6 PR smoke](../../.github/workflows/k6-smoke-prs.yml): local Supabase/API smoke for relevant
  changes.
- [Manual k6 load](../../.github/workflows/k6-load.yml): selectable Preview or production load
  target with retained summaries.
- [Gitleaks](../../.github/workflows/gitleaks-check.yml): pull-request secret scanning.
- [Static deployment tests](../../apps/api/integration/deployment-workflows.spec.ts): presence and
  selected content of Vercel/mobile configuration.

The [PR Gate](../../.github/workflows/pr-gate.yml) is intended to wait for other jobs, but its push
trigger names `master` while the rest of the repository deploy/test configuration uses `main`.
Actual branch protection and required-check settings are external and cannot be confirmed here.

## Rollback and operational checks

Repository-supported operational checks are:

- poll web or API health for an exact Git SHA;
- require HTTP 200 from a secondary endpoint;
- run Playwright against explicit local, Preview, or production origins;
- run local or hosted k6 checks;
- inspect API startup and structured logs;
- inspect OTEL traces and available metrics;
- inspect durable worker failure records through the implemented admin API; and
- stop workers gracefully on process signals.

No rollback command or workflow is present for Vercel, EAS, Supabase/Prisma, workers, or
configuration. The repository does not encode deployment promotion, traffic shifting, previous
deployment selection, database restore, release tagging, or rollback verification. Any
provider-console rollback capability is outside the evidence in this scan and must not be treated
as a repository procedure.

## Concrete gaps

1. **Workers have no deployment target.** Production scripts exist, but no hosted process starts
   them or verifies worker liveness.
2. **Root Expo configuration conflicts with the mobile app.** Two `app.json` files name different
   EAS projects, and root invocation behavior is undocumented.
3. **Mobile delivery is Android-only and manual.** The workflow queues a build without waiting or
   submitting; iOS is explicitly disabled and Maestro does not gate the EAS artifact.
4. **Serverless API bootstrap differs materially from `main.ts`.** OTEL, env-file loading, request
   middleware, global exception telemetry, OpenAPI, and startup analytics are absent.
5. **Production API identity is not verified.** Production waits for a web SHA but only an API
   route's HTTP 200, unlike Preview's independent API SHA check.
6. **Health is shallow.** Neither primary health endpoint checks database, Redis, queues, providers,
   or telemetry; queue health is a configuration stub.
7. **Migrations run inside API builds.** There is no separate approval, backup, post-migration
   readiness check, or rollback path.
8. **Hosted infrastructure is not declarative here.** Vercel project settings, remote Supabase
   projects, Upstash, Grafana Cloud, EAS credentials, domains, and secret separation cannot be
   reconstructed from the repository.
9. **No automated application rollback exists.** Deployment verification can detect a bad rollout
   but cannot revert it.
10. **Observability does not cover the deployed serverless bootstrap or critical dependencies.**
    Current custom queue/cache/realtime/database dashboards are placeholders rather than live
    operational signals.
