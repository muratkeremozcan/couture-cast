# Deployment guide

Updated: 2026-07-17 - Brownfield deep scan of deployment and operational configuration.
Updated: 2026-10-16 (Story 6.2b): community worker container, canary, restart drill and rollback.
Updated: 2026-10-16 - preview readiness wait shared by PR and manual e2e, resolvers poll for the
expected commit, prod waits on both health SHAs, preview runs have no database secret, CI Supabase
pulls from ghcr.io.

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
| Workers       | Community worker container, Northflank (pending)     | `apps/api/Dockerfile.community-worker`; general and wardrobe: none    | Build-time model self-test, readiness log, `community:screening:canary`      |
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

When `EXPECTED_SHA` is set, both resolvers poll the Vercel API until the deployment for that commit
is listed (`RESOLVE_SHA_TIMEOUT_SECONDS`, default 600; `RESOLVE_SHA_INTERVAL_SECONDS`, default 15),
because right after a push the newest listed deployment still belongs to the previous commit. The
web resolver never falls back to another commit's canonical URL in that mode, since such a URL never
starts serving the expected SHA. The fallback resolution inside the reusable Playwright workflow caps
the poll at 120 seconds.

[Manual E2E](../../.github/workflows/pw-e2e-trigger.yml) runs the same readiness wait for the
dispatched commit unless `custom_base_url` or `custom_api_base_url` names the target explicitly.

CI starts local Supabase through
[its composite action](../../.github/actions/start-local-supabase/action.yml), which pulls images from
`ghcr.io` with the job token (the CLI default, `public.ecr.aws`, rate-limits anonymous data per
runner IP) and skips containers no test uses.

The SHA wait is implemented by
[the Vercel waiter](../../.github/workflows/vercel-wait-for-deployment.yml). It retries for up to the
configured limit, rejects non-JSON responses, rejects missing SHA metadata, and fails if the final
SHA differs from the expected commit.

The reusable [Playwright workflow](../../.github/workflows/rwf-e2e.yml) checks out that same SHA,
leaves `DATABASE_URL` unset for preview (no preview database secret exists, so specs that need
direct database access skip themselves), pins the URLs resolved by the caller, and uploads Playwright
artifacts. The PR path and the manual trigger both resolve and wait through
[the preview readiness workflow](../../.github/workflows/rwf-vercel-preview-ready.yml). The
[web health test](../../playwright/tests/web-health-sha.spec.ts) independently checks health
metadata and the expected SHA. The [API smoke test](../../playwright/tests/api/api-health.spec.ts)
checks the API root response but does not assert API health metadata.

## Production deployment verification

[Production E2E](../../.github/workflows/pw-e2e-prod.yml) runs on pushes to `main` and manually. It
uses fixed Vercel production domains and the
[generic deployment waiter](../../.github/workflows/rwf-wait-for-deployment.yml).

Both projects are held to the pushed commit before tests start:

- The web `/api/health` must report `status: ok` and match the pushed SHA.
- The API `/api/health` must report `status: ok` and match the pushed SHA.
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
- GitHub Actions holds `DATABASE_URL_PROD` for production runs. Preview runs have no database
  secret.
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

[PR checks](../../.github/workflows/pr-checks.yml) run integration tests against an ephemeral
PostgreSQL service container. The reusable E2E workflow maps its database URL according to
`TEST_ENV`: the local stack, `DATABASE_URL_PROD` for prod only, and none for preview. Manual
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

The smart-tagging migration replaces a PostgreSQL enum and clears legacy tag values outside the
canonical sets. Before Preview or production deployment:

1. Export `GarmentItem` and record total rows plus rows with non-canonical category, material, or
   comfort values.
2. Verify the backup can be restored into an isolated database.
3. Pause API writes and every wardrobe worker.
4. Apply the migration, validate the recorded counts, then deploy the compatible API and worker.
5. If validation fails, keep writers paused and restore the backup. An application rollback alone
   cannot reverse this migration.

## Worker deployment and operations

The dedicated BullMQ process starts through `npm run start:workers` or
`npm run start:workers:prod` in [the API package](../../apps/api/package.json).

### Dedicated wardrobe worker deployment sequence

Wardrobe color extraction and FashionCLIP tagging run in their own required process. The general
worker does not consume the wardrobe queue. Deploy the wardrobe process in this order:

1. Set `GARMENT_TAGGING_ENGINE=fashion-clip` and an absolute
   `GARMENT_TAGGING_MODEL_DIR` on the wardrobe worker.
2. Run `npm run prepare:tagging-model --workspace api` in the deploy image.
3. Run `npm run verify:tagging-model --workspace api` after the image is mounted on the target.
4. Complete the migration backup checkpoint above, then run
   `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`.
5. Start the general workers with `npm run start:workers:prod --workspace api`.
6. Start the separate wardrobe consumer with
   `npm run start:workers:wardrobe:prod --workspace api`.
7. Require structured `Garment tagging engine is ready` and
   `Dedicated wardrobe worker started` logs before enabling API writes.

The general [bootstrap](../../apps/api/src/workers/bootstrap.ts):

- loads root environment files;
- creates the configured queues and Redis clients;
- registers the weather refresh scheduler;
- starts weather, alert fan-out, and moderation workers;
- awaits community screening readiness before constructing the community consumer;
- logs startup failure and exits nonzero; and
- handles `SIGTERM` and `SIGINT` by closing workers, queues, the community runtime, Redis, PostHog,
  and Prisma.

The dedicated [wardrobe bootstrap](../../apps/api/src/workers/wardrobe.bootstrap.ts) verifies the
engine selection, rejects fixture mode outside test environments, loads the pinned model, and
consumes `color-extraction` at concurrency one.

### Community content screening (ADR-013)

Two processes can consume `community-moderation`, and both compose it through the one
[community worker runtime](../../apps/api/src/modules/community/community-worker-runtime.ts):

- `npm run start:workers:prod --workspace api` runs the general
  [bootstrap](../../apps/api/src/workers/bootstrap.ts), which also carries weather, alert fan-out,
  billing reconciliation and the maintenance sweeps.
- `npm run start:workers:community:prod --workspace api` runs the narrow
  [community bootstrap](../../apps/api/src/workers/community.bootstrap.ts) and nothing else. It
  pre-flights `verify:community-screening-model`. The hosted container runs the same bootstrap
  through [the production launcher](../../scripts/start-community-worker-production.mjs); see
  "Hosted community worker" below.

Run exactly one of them against a given Redis. BullMQ splits jobs across every worker subscribed to
a queue name regardless of process, so running both would spread screening across two process groups
and only one of them would be the one being measured.

Set on whichever process consumes the queue:

| Variable                              | Values                                 | Notes                                                                           |
| ------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| `COMMUNITY_NSFW_SCREENER`             | `tensorflow`, `fixture`, `unavailable` | Required. Absent or unrecognised exits before the consumer starts.              |
| `COMMUNITY_NSFW_INCIDENT_MODE`        | `unavailable`                          | Required in production only when the selector is `unavailable`.                 |
| `COMMUNITY_NSFW_INCIDENT_REFERENCE`   | non-empty incident identifier          | Required alongside the incident mode. Appears in the readiness log.             |
| `COMMUNITY_NSFW_INFERENCE_TIMEOUT_MS` | positive integer, below 30000          | Defaults to 10000. Bounds one inference; the 30s pipeline ceiling is unchanged. |

There is no model directory, no remote model host and no policy path variable. The model travels
inside the pinned `nsfwjs` package and the policy is a committed file, both hash-pinned by the
manifest.

Deploy sequence:

1. Set `COMMUNITY_NSFW_SCREENER=tensorflow` on the consuming process.
2. Run `npm run verify:community-screening-model --workspace api` and
   `npm run verify:community-screening-supply-chain --workspace api` against the built image. Both
   exit nonzero on a hash, threshold, class-name or licence mismatch.
3. Complete the migration checkpoint above.
4. Start the process. Require the structured `community_moderation_screener_ready` log, carrying
   the selector, engine version, policy version, model hash, backend and startup duration, before
   enabling community writes.
5. Leave `community_read_enabled` and `community_write_enabled` disabled. Model readiness authorizes
   one gate signature and Story 6.2b records it; seven other signatures remain open.

Startup rejects a missing artifact, a changed hash, a diverging threshold, an unexpected class-name
set, an unapproved policy, or an unusable selector before the BullMQ consumer is constructed. That
check lives in the process rather than only in the npm pre-hook, so it holds for `tsx`, for the
compiled entrypoint, and for any launcher added later.

Screening concurrency is one job per process
(`COMMUNITY_MODERATION_CONCURRENCY`), because one process holds one supervised model. Throughput
comes from adding replicas.

#### Degraded mode: running without a working model

`COMMUNITY_NSFW_SCREENER=unavailable` starts queue consumption, returns the deterministic
`screening_unavailable` refusal for every submission, routes each one to human review, and performs
no model retry because no model is constructed. Posts reach `flagged`, not `published`, and the
existing five-minute moderation alert and 24-hour review SLA apply to all of them.

In production it additionally requires `COMMUNITY_NSFW_INCIDENT_MODE=unavailable` and a non-empty
`COMMUNITY_NSFW_INCIDENT_REFERENCE`. Both together are the authorization: `unavailable` on its own
is indistinguishable from a half-finished deployment, and the process refuses to start without them.

**Authorizing.** The incident owner records the incident, sets all three variables, and restarts the
consuming process. The startup log line `community_moderation_screener_incident_mode` carries the
incident reference and is emitted at error level so it is visible under production's `warn` floor.
Expect the moderation review queue to grow at the full rate of community submissions for the
duration, and staff for it.

**Restoring.** Set `COMMUNITY_NSFW_SCREENER=tensorflow`, clear both incident variables, run the two
verify commands, and restart. Require `community_moderation_screener_ready` before treating
screening as restored.

**Replaying retained jobs.** Jobs that ran during the incident completed rather than failed, so
BullMQ will not retry them. `community-moderation` retains completed and failed jobs for seven days
and `queue.add` with an existing job id returns the existing job instead of creating one, so
re-arming an outbox row alone is a silent no-op inside that window. To genuinely re-screen a post,
remove the retained job first (`queue.getJob(<postId>__<uploadSessionId>)` then `job.remove()`) and
re-arm its outbox row by clearing `dispatched_at`, or give the post a new upload session, which
changes the object path and therefore the job id. The processor screens only a post in
`pending_review` and skips every other status, so a replayed job leaves a post that is already
`flagged` or `review_failed` as it is. No operator action moves a post back to `pending_review`
yet, and the admin retry of a `JobFailure` row (`AdminService.retryFailedJob`) does not either:
it adds a new job with a generated id, the job skips the post, and the row is deleted. Both are
recorded in deferred work.

**Draining the review queue.** Posts refused during the incident carry
`moderation_reason = 'screening_unavailable'` and
`moderation_engine_version = '<text engine>;adr013-nsfw-unavailable'`, which is the query that
separates them from posts a real model refused. Release or take down each one through the operator
actions. The replay above re-screens only posts still in `pending_review`.

The community worker has a container image and the runbook below, and no hosted target runs it
yet: the Northflank service is created once the owner adds `NORTHFLANK_API_TOKEN`. The general
bootstrap (`start:workers:prod`) and the wardrobe worker still have no hosted target at all: no
Docker image, Vercel function, GitHub deployment workflow or process manifest starts either of
them, and the Vercel API function does not start the dedicated workers.

#### Hosted community worker (Story 6.2b)

**Image.** [`apps/api/Dockerfile.community-worker`](../../apps/api/Dockerfile.community-worker)
builds from the repository root (`npm run community:screening:image:build`). The build stage
installs the API workspaces and compiles them; the assemble stage runs
[`scripts/prune-community-worker-deps.mjs`](../../scripts/prune-community-worker-deps.mjs), which
derives the worker's dependency tree from its compiled import graph and fails the build when
`node_modules` passes 150 MB (the measured size is in the evidence payload's `image` section); the
runtime stage runs as the unprivileged `node` user under `tini`, and the build itself runs the
launcher's `--self-test`, which verifies the pinned model artifacts, loads the model, screens the
committed safe fixture and requires it to publish, validates the term lists, and loads the whole
consumer graph. A dependency the trace misses fails the build rather than the first job.

The build takes two arguments, which `npm run community:screening:image:build` sets and a hosted
builder must set too: `COMMIT_SHA`, the commit being built, and `INPUT_SET_HASH`, the output of
`node scripts/lib/community-screening-input-set.mjs` at that commit. The worker names itself
`community-worker@<COMMIT_SHA>` in BullMQ, which is how the hosted canary proves which build
consumed its job. An image built without them is named `community-worker@unset`, and the hosted
canary refuses it.

**Process.** The container's command is
[`scripts/start-community-worker-production.mjs`](../../scripts/start-community-worker-production.mjs).
It refuses an unset, unknown or `fixture` selector, runs `verify:community-screening-model`,
starts the compiled community bootstrap in-process, and turns `SIGTERM` and `SIGINT` into the
bootstrap's graceful shutdown: the consumer stops taking jobs and waits for the active one under a
20-second deadline, and the launcher exits at 25 seconds whatever happens. Northflank sends
`SIGKILL` 30 seconds after `SIGTERM` by default (`gracePeriodSeconds`, 15 to 1,800 seconds,
northflank.com/docs/v1/application/scale/scale-instances, read 2026-10-17); leave it at 30 or
above. One screening may take up to 30 seconds, so a deploy can cut off a slow job. That job is
abandoned, as is a job whose worker crashed: it neither completes nor fails, its 30-second lock
expires, and a stalled check returns it to `waiting`. The check runs every 120 seconds across all
workers and when a worker starts, and it requeues a job an earlier check marked, so the job is
back at most two checks after the crash or the restart, whichever is later: 300 seconds with a
three-minute restart. Counting the attempts the job may already have spent and the redelivered
attempt, recovery takes at most 423 seconds, inside the 15-minute window after which the
stale-review sweep fails a post (`communityCrashRecoveryMs` in `community-moderation.worker.ts`;
`community-moderation-crash-recovery.integration.spec.ts` kills a worker mid-screening against
real Redis). A post the sweep does fail moves to `review_failed` with a `JobFailure` row, the
redelivered job skips it, and the admin retry of that row does not re-screen it (see the replay
section above). Production otherwise logs at `warn`; the image
sets `LOG_LEVEL=info` so the readiness line is visible, and `NO_COLOR=1` so the Nest logger writes
no escape codes.

**Variables the host injects** (values from the same stores the Vercel API uses; nothing is
baked into the image):

| Variable                    | Value                                                   |
| --------------------------- | ------------------------------------------------------- |
| `NODE_ENV`                  | `production`                                            |
| `COMMUNITY_NSFW_SCREENER`   | `tensorflow`                                            |
| `DATABASE_URL`              | production Supabase connection string, verified (below) |
| `REDIS_URL`                 | production Upstash `rediss://` URL                      |
| `REDIS_TLS`                 | `true`                                                  |
| `SUPABASE_URL`              | production Supabase project URL                         |
| `SUPABASE_SERVICE_ROLE_KEY` | production service role key                             |
| `ANALYTICS_ID_SECRET`       | the API's value; the worker exits at startup without it |
| `POSTHOG_API_KEY`           | the API's value; publication and refusal events         |
| `POSTHOG_HOST`              | the API's value                                         |

The worker verifies the database's certificate. Prisma's `sslmode=require` alone encrypts without
checking who answers, so the image carries the Supabase Root 2021 CA
([`apps/api/certs/supabase-root-2021-ca.pem`](../../apps/api/certs/supabase-root-2021-ca.pem),
SHA-256 fingerprint `80:70:25:AD:...:E6:CA:FA`, valid to 2031-04-26) at
`/app/apps/api/certs/supabase-root-2021-ca.pem`, and the hosted `DATABASE_URL` ends in:

```text
?sslmode=require&sslcert=/app/apps/api/certs/supabase-root-2021-ca.pem&sslaccept=strict
```

`sslaccept=strict` makes Prisma verify the chain and the host name; without it Prisma accepts any
certificate. Prisma resolves a relative `sslcert` against the generated client's directory
(`/app/node_modules/.prisma/client`), so the path is absolute. Both behaviours were checked
against the worker image and a TLS PostgreSQL with a test CA: the right CA connects, another CA
fails `unable to get local issuer certificate`, an IP address fails `IP address mismatch`, and
without `sslaccept=strict` the connection succeeds unverified. Under `NODE_ENV=production` the
launcher refuses to start when a non-local `DATABASE_URL` lacks `sslmode=require` or
`sslaccept=strict`, or its `sslcert` is relative or names a missing file
(`community_worker_database_tls_refused`). Local container runs against
`host.docker.internal` are exempt.

The Vercel API verifies the same certificate with its configured `DATABASE_URL` unchanged.
`createPrismaClient` ([`database-tls.ts`](../../apps/api/src/prisma/database-tls.ts)) completes
every non-local URL with `sslmode=require`, `sslaccept=strict` and an absolute `sslcert` naming the
CA, which `includeFiles` in `apps/api/vercel.json` bundles into both functions. `pgbouncer`,
`connection_limit` and the credentials stay as configured. When the CA is missing or the URL does
not parse, the client throws `DatabaseTlsRefusedError` at startup. `prisma migrate deploy` applies
the same rules to its `DIRECT_URL` connection through `scripts/lib/database-tls.mjs`.

The canary, which reaches production from an operator's machine, verifies the certificate chain
(`verify-full`) against the same committed CA (`--db-ca` names another). It strips every `ssl*`
parameter from the connection string first, because `pg` lets those parameters replace the
verified TLS settings.

The canary's synthetic account (`canary-user-` prefix) is excluded from analytics in code
(`isCommunityCanaryUser` in `community-analytics.ts`), so real posts report to PostHog and the
canary's publication does not.

`GRAFANA_OTLP_ENDPOINT` and its credentials are deliberately absent. The worker image does not
start the OpenTelemetry SDK: `@opentelemetry/sdk-node` and its exporters would push `node_modules`
past the 150 MB budget, so the variables would do nothing there. Until Story 6.12 adds an external
alert on the oldest `pending_review` age, worker liveness rests on the host's restart policy, the
readiness log line and the hosted canary.

**Resource profile.** One replica at concurrency one, 512 MiB memory limit, the sandbox's
fractional vCPU. Latency is measured inside the worker image at 0.2 vCPU and 512 MiB
(`npm run community:screening:measure:container`). Memory is the running container's cgroup
`memory.peak`, the number the out-of-memory killer acts on: start the worker container fresh under
`--memory=512m`, then run `npm run community:screening:measure:memory`, which drives the canary
with a generated 4096x4096 JPEG, the largest accepted upload, through the real pipeline. It uses the
container's own `DATABASE_URL`, `REDIS_URL` and Supabase settings, and requires the job to be
processed by the container's worker (`community-worker@<baked commit>`). Replicas of one image share
that name, so the canary also runs in sole-consumer mode (`--sole-consumer`): exactly one consumer
heartbeat (below), named for the container's commit, before the job is enqueued and again after it
completes, from the same worker process. Stop every other consumer of that Redis first, including a
local `start:workers` or E2E stack. The product records both observations as `soleConsumer`, and the
gate rejects a peak without that identity and that proof. The latency gate requires the recorded cgroup limits to equal the 0.2 vCPU
and 512 MiB profile and at least 1,000 warm samples after warmup. The numbers and their gates are in the evidence payload's `runtime` section and in the rendered
evidence. Re-measure inside the hosted container after the first deploy.

**Deploy on Northflank** (Developer Sandbox, free, always-on):

1. The owner signs up with the GitHub account that owns the repository, picks the Developer
   Sandbox, authorises the Northflank GitHub app for `couture-cast` only, and adds
   `NORTHFLANK_API_TOKEN` to `.env.local`. The remaining steps can be driven through the
   Northflank API from there.
2. Create a project in the region closest to the Supabase project.
3. Create a combined service on `couture-cast`, branch `main`, build type Dockerfile, Dockerfile
   path `/apps/api/Dockerfile.community-worker`, build context `/`. Northflank injects
   `NF_GIT_SHA`, which `COMMIT_SHA` defaults to; `INPUT_SET_HASH` stays `unset` on the hosted
   image, because only the local measurement products record it.
4. Leave ports empty: the worker serves no HTTP, and a port would add a health check that can
   never pass.
5. Add the variables above as runtime secrets and deploy.
6. Require `community_moderation_screener_ready` (selector, engine version, policy version, model
   hash, backend, startup duration) and `Dedicated community worker started` in the runtime log.
7. Run the hosted canary (below).

Fallbacks, in order: Oracle Cloud Always Free (an ARM VM with headroom; install Docker, run the
same image under a restart policy, and patch the VM) if the sandbox memory envelope proves too
small, then Railway (paid, from 5 USD a month, same Dockerfile) if neither free option is worth
the time. Vercel cannot host it: it runs no long-running process.

Run exactly one consumer per Redis. Once the hosted worker runs, nothing else may consume
`community-moderation` against production Redis, including a local `start:workers` pointed at
it.

**Worker presence: the heartbeat, because Upstash `CLIENT LIST` is per node.** BullMQ's
`queue.getWorkers()` finds consumers with `CLIENT LIST`, and Upstash answers `CLIENT LIST` from the
node that took the connection, listing only that node's clients. Measured against the production
database on 2026-10-17 (Story 6.2b review, RF15): of 12 fresh connections, 5 listed the hosted
worker's named BullMQ connection and 7 did not, while the worker stayed connected throughout. The
hosted canary failed `worker_absent` twice against a healthy worker that way, and the same blind
spot would hide a second consumer on another node from the sole-consumer proof. A local Redis is one
node, so local measurements never showed it. Do not use `CLIENT LIST` or `queue.getWorkers()` to
decide who consumes production Redis.

Every community worker process therefore writes a heartbeat key, which every node answers the same
([`community-worker-heartbeat.ts`](../../apps/api/src/modules/community/community-worker-heartbeat.ts)):

- Key `community-worker:heartbeat:<worker name>:<instance id>`, where the instance id is a random
  UUID per process, so two replicas of one image are two keys. The value is JSON: `name`,
  `commitSha`, `startedAt`, `pid`.
- Written when the worker starts, on the worker's own BullMQ connection, with a 90-second TTL,
  refreshed every 30 seconds. Two refreshes in a row can be lost before the worker reads as absent.
  A missed refresh is logged at `warn` (`community_worker_heartbeat_refresh_failed`) and never stops
  the worker.
- Removed on a graceful shutdown before the worker stops taking jobs and closes its connection,
  within 2 of the 20 seconds of the shutdown deadline (`community_worker_heartbeat_removed`). A
  worker killed with `SIGKILL` or out of memory removes nothing, and reads as present until the TTL
  passes, at most 90 seconds.
- Cost: one `SET` per refresh, 120 commands an hour, part of the measured idle figure below.

The canary, the restart drill, the memory measurement and the idle Redis measurement count live
heartbeat keys with `SCAN` and a `MATCH` pattern in a bounded loop
([`scripts/lib/community-worker-heartbeat.mjs`](../../scripts/lib/community-worker-heartbeat.mjs));
a scan that does not finish is reported as unknown, never as a count. A local run also records
`CLIENT LIST` beside the heartbeats as a cross-check (`clientList`, `clientListAgrees`); the
heartbeats decide. To see what consumes production Redis by hand:

```bash
redis-cli --tls -u "$REDIS_URL" --scan --pattern 'community-worker:heartbeat:*'
```

**Canary.** [`scripts/community-screening-canary.mjs`](../../scripts/community-screening-canary.mjs)
creates a namespaced canary account and one `pending_review` post carrying a committed,
manifest-pinned safe fixture, enqueues one screening job exactly as the outbox dispatcher would,
polls until the post leaves `pending_review`, and then removes every row, object and job it
created. It reports queue latency (BullMQ `processedOn - timestamp`), screening duration
(`finishedOn - processedOn`: download, re-encode, inference, text screening and the publish
transaction), the persisted engine identity and the worker that processed the job. It exits nonzero
when no worker heartbeat is live, when a job stays `waiting`, when the identity carries a `fixture`,
`unavailable` or `unresolved` marker, when the safe fixture does not publish, or when the wait
expires. `--target` is checked against the database host, so a `local` canary cannot write to a
hosted database and a `hosted` one cannot run against a laptop. A hosted run also requires exactly
one consumer heartbeat, named `community-worker@<sha>` for the commit given by `--expect-sha`
(default: `HEAD`), before it enqueues the job and again after the job completes, from the same worker
process (instance id), checks that this worker processed the job, and verifies the database
certificate against the Supabase CA. The evidence counts a hosted run only when no input-set file
differs between `--expect-sha` and the evidence commit (`git diff --quiet`). Cleanup problems
fail the run: the report records `ok: false` and the readiness gate fails.

Every wait is bounded. One absolute deadline (`--timeout-ms`, default 120 seconds) covers
connecting, the consumer check, the upload, the writes, the enqueue, polling and the closing job
reads; PostgreSQL connects within 10 seconds and each query answers within 15, and Redis gives up
a connect after 10 seconds, a command after 15 and reconnecting after three attempts. When the
deadline passes, the canary force-closes its connections, removes what it created on fresh
connections under a separate cleanup deadline (`--cleanup-timeout-ms`, default 30 seconds), writes
a failure report naming the stalled stage and any data cleanup could not remove, and exits
nonzero.

A write the canary stopped waiting for can still commit on the server, after cleanup has deleted
it. The canary records every write cut off by a deadline or a client timeout, every upload that
ended without a storage answer, and every job a worker was still processing at cleanup, as having an
unknown outcome, and then cleans up on fresh connections. An empty lookup never resolves an unknown
outcome on its own:

- A database write: the canary records its connection's server process (`pg_backend_pid()`) when
  it connects, and every canary statement starts with a comment naming the run. Cleanup cancels the
  write with `pg_cancel_backend` and polls `pg_stat_activity` until that process is gone, idle or
  running another statement, within two thirds of the cleanup deadline. Only then does it delete and
  look again. A refused cancel, a process `pg_stat_activity` does not describe, the write showing
  on another process, or the budget running out leaves the write unresolved. Production connects
  through Supabase's session pooler (port 5432), which keeps one server process per client
  session; the transaction pooler (port 6543) does not, and the canary reports that mismatch.
- An upload: storage cannot cancel one, so it is resolved only when a lookup finds the object and
  removes it. Only a 4xx carrying the storage server's error body counts as a rejection; a
  transport failure (`StorageUnknownError`, `fetch failed`), a 5xx and a bare 4xx leave the
  outcome unknown. The report keeps the original storage error under `details.storageError`.
- An enqueue or an active job: cleanup waits a settle window (`--cleanup-settle-ms`, default 10
  seconds or a third of the cleanup deadline, whichever is less) before it looks.

Cleanup then looks the canary's identifiers up again (the job, the account, its posts, the
moderation events about the post, and the post's storage folder) and removes whatever it finds,
until a lookup finds nothing. Every run ends with that lookup. The report's `cleanup.status` is
`clean` only when the lookup came back empty and every unknown outcome was resolved, `failed` when
something could not be removed, and `uncertain` when a write's outcome was unknown and no clean
state was established within the cleanup deadline. `cleanup.databaseWrite` records what cleanup saw
of a cut-off database write. Anything but `clean` lists every affected identifier in
`cleanup.unresolved`, sets `ok: false`, and fails the readiness gate. Remove what an `uncertain`
report names by hand before the next run.

The canary's safe fixture publishes. The API never serves it: every public read (the feed query,
the single-post read, the card-open record and the report path) excludes accounts whose id starts
with `canary-user-`, in the same predicate that keeps withdrawn, hidden and unscreened posts out
(`PUBLICLY_VISIBLE_POST_WHERE` in `community.repository.ts`). That holds whatever the flags say,
including a PostHog cohort that sees the feed while the code default and the flag cache both read
`false`. As defence in depth, the hosted canary still runs only while the feed is closed: it
refuses to start when `community_read_enabled` defaults to anything but `false` in
`packages/config/src/flags.ts`, or when the production flag cache (`feature_flags`) holds anything
else.

```bash
npm run community:screening:canary:local
npm run community:screening:canary -- --target hosted --env-file <hosted env file> \
  --json-out apps/api/.cache/community-screening/canary-hosted.json
```

The canary is the deploy's acceptance check: run it after every deploy and every rollback.

**Restart drill.** Stop the worker (gracefully, so its heartbeat is removed), start
`npm run community:screening:canary:restart-drill` (`--restart-drill`, local only), then start the
worker within three minutes. The drill refuses to enqueue unless Redis holds zero worker
heartbeats, observes zero again after the enqueue with the job still `waiting`, then polls until a
heartbeat comes back and the job completes. The report's `restartDrill` block records those observations and the observed
downtime (from the first zero-consumer observation to the last, a lower bound on the outage), and
the readiness gate re-judges them: an ordinary canary result carries no such observations and is
not restart evidence. The payload's `canary.restart` section holds the result.

**Rollback.** Leave both rollout flags disabled; they are disabled now. Redeploy the previous
build on the host, or stop the service: queued jobs wait in Redis and the stale-review sweep moves
anything pending past its window to `review_failed`. If the model is the problem, switch to the
degraded mode above. Run the hosted canary after any rollback, then re-screen posts refused during
the incident through the operator actions (the replay re-screens only posts still in
`pending_review`).

**Redis cost.** The production Upstash database (`couturecast-prod`) is on the Pay as You Go plan,
which bills 0.20 USD per 100K commands and includes no free commands once a database is on a paid
plan (upstash.com/pricing/redis, read 2026-10-17). An idle BullMQ consumer polls Redis
continuously. With BullMQ's defaults (a 5-second idle block and a 30-second stalled check) an idle
worker spent about 4.8 million commands a month, about 9.50 USD (the payload's
`redis.beforeTuning`). The community worker now blocks for 300 seconds while idle and checks for
stalled jobs every 120 seconds (`community-moderation.worker.ts`); a new job still wakes it at
once. The stalled check was 600 seconds until Story 6.2b review RF13 shortened it so a crashed
worker's job recovers before the stale-review sweep; the measured idle cost includes it. `npm run community:screening:measure:redis` measures the idle cost against a local Redis only the worker uses, sampling the worker heartbeats every 15 seconds
to prove one process of the container's named worker held its heartbeat for the whole window (`CLIENT LIST`
is sampled beside it as a cross-check, and the samples' own commands are subtracted), and
`node scripts/measure-community-worker-redis.mjs --canary-runs 5 --idle-baseline <idle product>`
measures the cost of one screened post. Both count every command Redis records, including those
BullMQ's Lua scripts run inside `EVALSHA`, because Upstash does not document whether a script
counts once. The release gate prices the projected month at the assumed daily volume, idle plus
traffic, and passes at or below 5 USD. The idle and per-post components, their cost, and the daily
volume above which the worker alone crosses 5 USD are in the evidence payload's `redis` section.

The production Upstash database is shared: the worker uses the same database the API already uses
for its own queues, so one bill covers both, and the measurement above covers the worker alone.
After the first day, read the provider's command count and month-to-date cost, which cover both. If
the month projects past 5 USD, set a maximum monthly budget on the database in the Upstash console
and revisit the polling settings. Upstash hibernates a database after a long stretch with no traffic
(this one answered "rate-limited" after 60 idle days until it was reactivated); a connected worker
keeps it active. The worker's one-second outbox dispatch reads PostgreSQL: about 86,400 small
queries a day against Supabase, which its plan does not meter per query.

**Evidence.** `npm run community:screening:evidence` writes
`_bmad-output/test-artifacts/community-content-screening-model-readiness.{json,md}` from the run
products the commands above leave in `apps/api/.cache/community-screening`, and from
`_bmad-output/test-artifacts/community-safe-corpus-holdout-triage.json`, which describes every
withheld or blocked holdout photograph after a person has looked at it. The verdict fails closed:
every run product records the input-set hash, and a product measured against other inputs, a
missing or partial measurement, or an uncommitted working tree keeps the verdict from `pass`. The
order is: commit the code, run the products, describe the withheld photographs, generate the
evidence, commit the evidence.

The repository owner records one verdict against the payload's SHA-256 with
`npm run community:screening:sign`, interactively. When the owner delegates it,
`npm run community:screening:sign -- --delegated` may run from an agent session: it is refused
under CI and unless the payload's verdict is `pass`, records only an approval, and marks the record
`mode: "delegated-by-owner"`. Either way, an approval is refused unless the payload carries every
mandatory gate the generator builds exactly once and no other (`MANDATORY_GATE_IDS`), and the
generator's rule over those gates also gives `pass`. `npm run community:screening:verify-signature` exits 0 only for a
current signature that approves, and reports a signature as stale once the payload changes.

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

No rollback command or workflow is present for Vercel, EAS, Supabase/Prisma, or configuration.
The community worker's rollback is a documented procedure (see "Hosted community worker"), not
an automated command. The repository does not encode deployment promotion, traffic shifting, previous
deployment selection, database restore, release tagging, or rollback verification. Any
provider-console rollback capability is outside the evidence in this scan and must not be treated
as a repository procedure.

## Concrete gaps

1. **Workers have no deployment target yet.** The community worker has a container image, a
   canary and a runbook; its hosted service waits on the owner's Northflank account. The general
   and wardrobe workers have no image or hosted target, and no process verifies worker liveness
   continuously.
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

### Story 6.5 engagement dispatch controls

Production community rollout remains frozen. `COMMUNITY_DISPATCH_ENABLED` defaults off.
When an isolated approved lane enables it, `COMMUNITY_ENGAGEMENT_OWNER` must select
`general` or `community`. The selected composition alone allocates the dedicated guard pool
with36 connections and32 send slots. The general-only deployment selects `general`; the
standalone community composition selects `community`. Other compositions report `standby`.
These configured limits require the story's actual capacity and timing evidence before use.

`COMMUNITY_GUARD_DATABASE_URL` must identify the same primary host/database as `DATABASE_URL`.
Dispatch additionally verifies PG17+, the privacy capability and effective server guard timeouts.
No credential value or database URL belongs in readiness logs.

The runtime returns `dispatch.status`: `disabled`, `standby`, `ready` or `degraded`.
`community_dispatch_readiness` logs that status, role and a sanitized reason. Degraded reasons
are `owner_unconfigured`, `guard_unconfigured`, `guard_mismatch` and `capability_unavailable`.
A dispatch preflight failure closes its owned guard pool and starts no dispatch/provider loop.
Moderation, append, stream/detail retention and operational telemetry continue independently in
both compositions. The runtime's close hook retains ownership of all its timers and connections.

Operators investigate degraded dispatch while keeping community rollout off, verify the selected
owner and existing primary's measured capabilities, then restart the assigned process after the
configuration is corrected. This startup preflight does not automatically enable dispatch later.
No guard/pool/privacy limit may be weakened to clear readiness. Preserve original overdue work
and eligibility clocks for the required recovery proof; a readiness log establishes no acceptance.
