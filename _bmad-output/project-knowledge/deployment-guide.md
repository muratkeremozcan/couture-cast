# Deployment guide

Updated: 2026-07-17 - Brownfield deep scan of deployment and operational configuration.
Updated: 2026-10-16 (Story 6.2b): community worker container, canary, restart drill and rollback.
Updated: 2026-11-05 (Story 6.12): the community worker is hosted on Northflank, SLA sweep rollout.
Updated: 2026-11-05 (Story 6.13): append-only moderation history, its limits, retention and account erasure.
Updated: 2026-11-11: the web production rewrite variable, and operator commands that verify TLS from macOS.
Updated: 2026-11-10 (Story 6.14): complimentary full access, its operator command, kill switch and push enablement.
Updated: 2026-11-12: CI creates previews and Vercel's git integration deploys production.
Updated: 2026-11-10 (database egress): the community worker's idle backoff, parked analytics delivery and session pooler.
Updated: 2026-11-11 (X-DISPATCH): PostHog production project split, flag drift guard, third dispatch attempt and record.
Updated: 2026-11-11 (append): community append runs in one database statement; the stalled-append alert.
Updated: 2026-11-13 (Story 6.15 Step 0): release hold, Test Store isolation, debug signing and the macOS nightly shape.
Updated: 2026-11-12 (preview deployments): branch pushes create no Vercel deployment; CI creates or reuses a preview only when the preview checks need it.
Updated: 2026-11-11 (production analytics): PostHog project map, privacy policy, post-merge key step.
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

| Surface       | Current target                                       | Trigger in the repository                                                | Verification present                                                         |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Web           | Separate Vercel project                              | Previews: CI (preview workflow); production: Vercel git deploy of `main` | Preview web health/SHA, production web health/SHA, Playwright                |
| API           | Separate Vercel project and Node serverless function | Previews: CI (preview workflow); production: Vercel git deploy of `main` | Preview API health/SHA; production only checks a secondary API route         |
| Mobile        | Expo EAS Android production build                    | Manual GitHub `workflow_dispatch` or local npm command                   | EAS authentication and build submission only; Maestro is separate and manual |
| Workers       | Community worker container, Northflank               | `apps/api/Dockerfile.community-worker`; general and wardrobe: none       | Build-time model self-test, readiness log, `community:screening:canary`      |
| Database      | Supabase PostgreSQL through `DATABASE_URL`           | API Vercel build and local/API E2E startup paths                         | Prisma command exit status; no post-migration deployment probe               |
| Observability | Optional Grafana OTLP endpoint; local LGTM stack     | API process startup when OTLP configuration is complete                  | OTEL bootstrap log, integration test, dashboards and local manual checks     |

The preview workflow creates the web and API preview deployments; Vercel's git integration
deploys production from each push to `main`, and the production workflow verifies it. Separate
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
- The `couture-cast-web` production project must set `PROD_API_BASE_URL`
  (`https://couture-cast-api.vercel.app`). With no API variable the rewrite is never registered,
  so every API call from the site, signup included, answers 404 from the web origin while both
  health checks stay green. Production ran that way until 2026-11-11.
  `playwright/tests/web-api-proxy.spec.ts` now runs in every lane, the production run included,
  and fails on that 404.
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

**Preview deployments.** Pushes to any branch other than `main` create no Vercel deployment:
each project's `vercel.json` sets `git.deploymentEnabled` to `{"main": true, "**": false}` (a
branch matching several rules deploys when any is true, so `main` keeps its production
deployments). On the Hobby plan every deployment counts toward 100 a day, a build canceled by an
ignored build step included, and on 2026-11-11 pushes no preview check needed used them up and
blocked two merges for hours. An ignored build step cannot help: Vercel's build clone has no git
remote and ten commits of history (probe, 2026-11-12), and its canceled builds still count.

When [the preview scope](../../scripts/vercel-preview-inputs.mjs) says the preview checks read the
branch's changes against main, one job per project (`deploy-web`, `deploy-api`, 20 minutes each,
since Hobby builds one deployment at a time) runs
[the deploy script](../../scripts/vercel-preview-deploy.mjs). It adopts a preview deployment it
created itself (marked `ccPreviewSource`, preview target only) on this branch with the same build
inputs (a hash of every tracked file the project builds from: the repository less the other app,
tests, workflows and load scripts) and the same configuration (the ids and update times of the
preview variables that apply to the branch, and the build settings: framework, install, build and
output commands, root directory, files outside it, system variable exposure, Node version, Git LFS,
region and resources), the newest ready one first, else one still building. Otherwise it creates
one from the exact commit through the Vercel API with `forceNew=1`, since nothing matched and an
earlier deployment of the same commit could carry other inputs or configuration. A variable's
target counts whether Vercel lists it or gives it as one string. It never cancels a deployment: another run may
be using it, and two runs racing to create cost one duplicate build at most.

One deadline 45 s inside each job's 20 minutes covers setup, every request (each also bounded at
30 s) and the 15 s polls. A poll that fails with a rate limit, a server error, a timeout or a
lost connection is retried while the deadline allows, since the build carries on; any other 4xx
answer fails at once, even when its body stalls after the status arrived. A `Retry-After`
(counted from when the headers arrived) sets the next poll on any answer; after a 429 the
quota reset Vercel announces (`X-RateLimit-Reset` or the error's `limit.reset`/`resetMs`) does
too. A reset past the deadline fails the job at once with that reason. `ERROR`, `CANCELED`, a refused creation (the rate limit answers on
creation) or the deadline fails the job; a build still `QUEUED` at the deadline says it waits
behind another build, since Hobby builds one deployment at a time, so rerun once that build
finishes. The health waits, the e2e URLs and the web health test (`EXPECTED_WEB_SHA`) use that
deployment's own URL and commit.

Opening or reopening a PR provides its previews, as does each push to it. A manual run always
provides each preview it names no custom URL for, even on a branch no preview check reads. Changing a preview variable or a build setting changes the
configuration identity, so the next run builds fresh. To rebuild with nothing changed (an empty
commit keeps the same inputs), add the `PREVIEW-REBUILD` label to the PR, or run Manual E2E Tests
with `force_preview_build`. Adding the label forces that one run; later pushes reuse as usual, so
remove and add it again to force another build. A forced build skips adoption. Production deployments from `main` are untouched by all of this.

`VERCEL_TOKEN` reaches the deploy jobs, which run the PR's own script at its exact commit, as it
already reached the e2e job's test code. GitHub withholds repository secrets from pull requests
opened from forks, so only same-repository branches can use it; a fork PR skips the preview
and e2e jobs. Nothing in the repository limits what the token may do; its scope, owner
and expiry live in the Vercel account (repository secret last set 2025-12-15) and are not
verified here, so treat it as able to deploy to production.

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
- builds load the `production` EAS environment (see [Production analytics](#production-analytics));
- Android produces an app bundle;
- iOS requests the `m-medium` resource class;
- an empty production submit profile exists.

[Deploy mobile](../../.github/workflows/deploy-mobile.yml) is manual only. It verifies `EXPO_TOKEN`,
runs the Story 6.15 release hold
([mobile-release-hold.mjs](../../scripts/ci/mobile-release-hold.mjs)), checks EAS identity, and
starts an Android production build with `--no-wait`. The hold refuses the build while
`apps/mobile/release-hold.json` holds the app's SDK (SDK 56's Hermes memory regression) and no
committed measurement lifts it; the file is required from SDK 56 on. It does not:

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

### Story 6.15 upgrade path (Expo SDK 54 to 58)

Story 6.15 moves the app one Expo SDK per pull request, each merged green before the next opens.
Step 0 (PR #226) stays on SDK 54 and readies the app and CI:

- **Background refresh.** The ritual refresh runs on `expo-background-task` under a new task name;
  the old `expo-background-fetch` task is unregistered tolerantly on first launch after the update.
- **RevenueCat Test Store.** The Test Store lives in its own RevenueCat project. Its public key is
  in `.env.local` and `.env.preview` only. Its secret key and webhook auth are Vercel preview
  variables on the API, with `TEST_ENV=preview`, and are absent from production. The API applies a
  `test_store` entitlement only when `TEST_ENV` is `local` or `preview`; elsewhere such a row is
  no paid access. Preview uses its own Supabase database. A release export is scanned on every
  mobile pull request for any Test Store key, in production and preview modes.
- **Debug signing.** A committed test-only keystore
  (`apps/mobile/plugins/test-signing/couturecast-test-only.keystore`) signs the Android `debug` and
  `minifiedDebuggable` builds so paid over-installs keep their certificate. A development client
  installed before this change needs one uninstall. The Release signing key is unchanged.
- **`minifiedDebuggable`.** An Android build type derived from `release`, minified by R8 and
  debuggable, runs the Test Store journey under R8. Release itself runs no R8 on SDK 54; Step 4
  turns on `android.enableMinifyInReleaseBuilds`.
- **macOS CI shape.** No macOS job runs on a pull request or a merge. iOS and watchOS native run
  nightly (`ios-native.yml` at 03:23 UTC, with the `ios-live-font` live font-scale proof on the
  Release test build) and on manual dispatch; the iOS 26.5 canary runs at 06:37 UTC. Pre-merge iOS
  evidence is a recorded local run on the pull request's exact head SHA.

### Story 6.15 Test Store journey and preview webhook (D15)

`scripts/run-test-store-journey.mjs` runs the RevenueCat Test Store journey on an emulator or
simulator in a debuggable build (Android `debug` and `minifiedDebuggable`, iOS Debug). It signs up a
fresh plain member, puts a loopback proxy in front of the API, starts Metro with that member's
mobile E2E bearer, the proxy origin and the Test Store public key, and drives
`maestro/test-store/`. Every evidence record names its server leg and the delivery path it proves
(TEA-18): `local-reconciliation` or `preview-webhook`. Each installed artifact gets a `test-store`
evidence manifest.

```bash
# Local leg: API on 127.0.0.1:4000 with TEST_ENV=local and the Test Store project's
# REVENUECAT_SECRET_API_KEY (both from .env.local). Purchase, then the lost-mirror restore.
node scripts/run-test-store-journey.mjs --platform android --device emulator-5554 \
  --build debug --server local --artifact apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk \
  --over-install apps/mobile/android/app/build/outputs/apk/minifiedDebuggable/app-minifiedDebuggable.apk \
  --over-install-build minifiedDebuggable --out /tmp/test-store-android-debug
node scripts/run-test-store-journey.mjs --platform android --device emulator-5554 \
  --build debug --server local --scenario restore --artifact <same apk> --out /tmp/test-store-restore
# minifiedDebuggable adds the native debuggable and R8 record (minified-debuggable-evidence.mjs).
node scripts/run-test-store-journey.mjs --platform android --device emulator-5554 \
  --build minifiedDebuggable --server local --artifact <app-minifiedDebuggable.apk> --out <dir>
node scripts/run-test-store-journey.mjs --platform ios --device <udid> --build debug \
  --server local --artifact <CoutureCast.app> --out <dir>
```

The proxy logs each request's method, path and status. It drops headers, query strings and
bodies, and writes id-shaped path segments as `:id` (`:subscriber` after `subscribers`). The
report names the member only by a hash; the user id sits in a private `.member.private.json`
beside it. On the local leg the entitlement must come from the app's refresh (the API's ledger
pull), since no RevenueCat webhook reaches a loopback API. On the preview leg the proxy refuses
every refresh, so an entitlement that still arrives came by webhook.

The purchase scenario runs cancel, then failure, then success, and ends with TD-04's sign-in
recovery: after a reinstall the app shows the server's entitlement on sign-in, and the paywall
offers no restore while entitled. The restore scenario is TD-04's restore assertion: a purchase
the server never hears of (every refresh refused), a reinstall, and a restore from the paywall.
The restore's own refresh is the only one that reaches the API, so the entitlement it brings
back is the restore's result.

Preview webhook setup, done once by an operator (the scripts change nothing on Vercel or
RevenueCat):

1. Vercel, API project, Settings, Deployment Protection, Protection Bypass for Automation: add a
   secret noted `revenuecat-test-store-webhook`. Store it as
   `REVENUECAT_TEST_STORE_WEBHOOK_BYPASS_SECRET` in `.env.preview`. It is separate from
   `VERCEL_AUTOMATION_BYPASS_SECRET`, so it can be revoked without touching CI.
2. Confirm the API preview environment names `TEST_ENV=preview`, `REVENUECAT_WEBHOOK_AUTH` and
   `REVENUECAT_SECRET_API_KEY`.
3. RevenueCat, the Test Store project only, Integrations, Webhooks: URL
   `https://<api-project>-git-<branch-slug>-<team>.vercel.app/api/v1/commerce/subscription/webhooks/revenuecat?x-vercel-protection-bypass=<REVENUECAT_TEST_STORE_WEBHOOK_BYPASS_SECRET>`;
   Authorization header value: the preview `REVENUECAT_WEBHOOK_AUTH`. RevenueCat sends one
   Authorization value, which the handler still checks, so the Vercel bypass rides in the query.
4. `node scripts/test-store-preview-webhook.mjs probe --api-url <preview API origin>`: two
   unauthenticated POSTs through the bypass must get the handler's own JSON 401.
5. `node scripts/run-test-store-journey.mjs --server preview --api-url <origin> ...`, then
   `node scripts/test-store-preview-webhook.mjs verify --report <run report> --member-file
   <run .member.private.json> --api-url <origin>` re-reads the member on the preview API's read endpoints and checks the run's proxy log.

`scripts/test-store-preview-webhook.mjs steps --api-url <origin>` prints these steps for an origin.

### Root Expo configuration conflict

The repository also contains a root [app.json](../../app.json) with a different EAS project ID from
`apps/mobile/app.json`. Current npm and GitHub build commands change into `apps/mobile`, so that app
configuration is expected to win on those paths. Running Expo or EAS from the repository root can
select the competing root configuration. The repo does not explain or test the intended ownership
of the root file.

## Production analytics

Web and mobile read one variable, `POSTHOG_API_KEY`: web inlines it at build time through
[next.config.ts](../../apps/web/next.config.ts), and mobile reads it through
[app.config.ts](../../apps/mobile/app.config.ts) into `extra.posthogApiKey`. Without it each client
stays inert.

| PostHog project           | Used by                             | Where the key lives                                                                             |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| 329012 `couturecast-prod` | Production API, worker, web, mobile | Vercel `couture-cast-api` Production, Northflank, `.env.prod`; web and EAS after the step below |
| 327096 `couturecast-dev`  | Local and Preview                   | `.env.local`, `.env.preview`, Vercel `couture-cast-api` Preview and Development                 |

CoutureCast has members aged 13 to 15 with guardian consent, and members upload wardrobe photos.
The clients therefore send explicit events, pageviews or screens, and exceptions only, and every
boundary where data leaves the device is a closed allowlist:

- Autocapture is off in every environment: web turns off autocapture, rage clicks, dead clicks and
  heatmaps; mobile passes `autocapture={false}`. Feature code sends named events, and the mobile
  root layout sends screens.
- Session recording, surveys, product tours and conversations are off.
- No feature flag or remote config request is made: neither app reads a PostHog flag, so web sets
  `advanced_disable_flags` and mobile sets `preloadFeatureFlags: false` and
  `disableRemoteConfig: true`. A `/flags` request would otherwise carry the initial URL in person
  properties outside `before_send`. Web also stores no initial URL, referrer or campaign
  properties (`save_referrer` and `save_campaign_params` are off), and masks `token`,
  `focusToken` and `email` in the session entry URL posthog-js keeps in localStorage.
- posthog-js may load only its exception autocapture script from `/ingest/static/`, so no remote
  setting can start console logs (whose exporter bypasses `before_send`), replay, surveys,
  toolbar, web vitals or site apps.
- Every web response carries `Referrer-Policy: strict-origin`, so no request from a page (to our
  API, PostHog or a partner) carries its path or query as Referer. Nothing in the web app or the
  API reads a same-origin Referer path.
- `/ingest` is served by a route handler
  ([posthog-ingest-proxy.ts](../../apps/web/src/lib/posthog-ingest-proxy.ts)) that forwards
  only the method, the exact path and query, the body, `Content-Type` and `Accept`, and only for
  the event endpoints and the exception autocapture script; any other path answers 404. Referer, cookies, the client IP and every other header stay on our origin, so
  PostHog sees our server's address and derives no member location from it. Each proxied
  request, upstream response body included, ends when the browser leaves or after 5 seconds
  (the route's `maxDuration` of 10 seconds is the platform backstop), and an event body over
  1 MB answers 413.
- Person profiles are created for identified users only, and the clients never identify.
- Every event either client sends carries `$geoip_disable: true`, `$ip: null` and
  `$process_person_profile: false`, set by the privacy filter after its copy, and the mobile
  SDK runs with `disableGeoip: true`, so PostHog adds no location. PostHog fills a null `$ip`
  from the request, and mobile requests reach it directly from the device, so production
  project 329012 must also have Discard client IP data (`anonymize_ips`) on: turned on
  2026-11-12, and the hourly PostHog flag drift check fails if it is ever off.
- `webAnalyticsPrivacyFilter` and `mobileAnalyticsPrivacyFilter` in
  [@couture/api-client](../../packages/api-client/src/analytics-privacy.ts) run first in the
  `before_send` chains:
  - an event outside `ANALYTICS_EVENT_PROPERTIES` or the platform's SDK events is dropped;
  - each event keeps only its listed properties, and a string survives only as an enum member, a
    route template, an origin, a host, an SDK identifier or version, or a timestamp. Reasons are
    fixed codes; ids, labels, titles and free text are dropped. Affiliate `partner_id`,
    `offer_id` and `recommendation_id` are the one exception: server-issued catalog ids, kept
    when they match a strict id pattern;
  - SDK properties are limited to browser, OS, device, library, app version, screen size,
    timestamps, session and anonymous ids, and the route-reduced page fields;
  - paths, URLs and screens are matched against the routes in
    [analytics-routes.ts](../../packages/api-client/src/analytics-routes.ts): a known route keeps
    its static segments and sends `:param` for dynamic ones, anything else is `/:unknown`, and
    external URLs and referrers keep their origin only. A test derives the route lists from
    `apps/web/src/app` and `apps/mobile/app` and fails when a route is added without updating
    them, and another fails when client code captures an event that has no allowlist entry;
  - exceptions keep their type and in-app frames as file basename, line and column; the message
    is replaced with `redacted`. Web stack frames therefore lose the full script URL that
    PostHog uses for source map lookup;
  - `$set` and `$set_once` never leave.

The configuration lives in [browser-analytics.ts](../../apps/web/src/analytics/browser-analytics.ts)
and [posthog.ts](../../apps/mobile/src/config/posthog.ts). The `U-ANALYTICS-PRIVACY-WEB` and
`U-ANALYTICS-PRIVACY-MOBILE` wire tests start a fresh client on the guardian invitation link,
decode every request the real SDKs make (event batches and any base64 `data=` body), and assert
that no flags or config request happens and that no token, email, name, birth date, personal
UUID or personal path segment appears. They also assert that a remote config asking for console
logs never loads the logs extension. `npm run test:analytics-privacy --workspace apps/web` runs
the web app (`next dev`, production analytics init) in real Chromium with a local receiver in
place of PostHog, opens the invitation link, and asserts no request line, header or decoded body
the receiver gets carries the token, the email or the fragment. It needs no database and runs in
the PR Lighthouse job, which already installs Chromium.

### Post-merge step: add the production keys

Web Production and the EAS `production` environment hold no PostHog key until the privacy policy
above is on `main`, so no production build ships an older client with a key. After the PR that
adds it merges, add the key for project 329012 (the `POSTHOG_API_KEY` value in `.env.prod`) to:

```bash
# Vercel couture-cast-web, Production only; preview and development stay without a key.
vercel env add POSTHOG_API_KEY -e production --no-sensitive \
  --project couture-cast-web --scope muratkeremozcans-projects < key-file
# EAS production environment, from apps/mobile. env:set creates or updates; env:create is
# deprecated.
eas env:set --environment production --name POSTHOG_API_KEY --value <phc key for 329012> \
  --visibility plaintext --scope project --type string --non-interactive
```

Then redeploy production web. Vercel fixes a deployment's environment variables when the
deployment is created, so adding a key changes nothing the current production deployment serves.
After #207, production web shipped an empty PostHog token until a redeploy. The same holds for
every Vercel environment key added or changed:

```bash
# The newest Ready production deployment of couture-cast-web.
vercel ls couture-cast-web --environment production --status READY \
  --scope muratkeremozcans-projects
vercel redeploy <that deployment's URL> --environment production \
  --scope muratkeremozcans-projects
```

Then confirm the deployed client carries the key, for example by loading the production site and
checking that PostHog requests leave the browser. Mobile binaries read the key at build time, so a
shipped binary starts sending analytics only from its next production EAS build.

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
   one gate signature and Story 6.2b records it. The current state of every signature is in the
   [Community Beta gate record](../test-artifacts/community-beta-gate-signatures.md).

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

The community worker runs on Northflank as `couture-cast/community-worker`, one instance, confirmed
through the Northflank API on 2026-11-05. The general bootstrap (`start:workers:prod`) and the
wardrobe worker still have no hosted target at all: no Docker image, Vercel function, GitHub
deployment workflow or process manifest starts either of them, and the Vercel API function does not
start the dedicated workers.

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
| `DATABASE_URL`              | production session pooler URL, verified (below)         |
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

**The worker connects through the session pooler.**
It is one long-lived process, so its `DATABASE_URL` names Supabase's session pooler: the pooler host on port 5432, with no `pgbouncer=true`.
Through the transaction pooler (port 6543) Prisma needs `pgbouncer=true`, and in that mode it runs every query in a transaction of its own and resets the server's prepared statements when the transaction ends.
One query then costs four statements: `BEGIN`, the query, `DEALLOCATE ALL` and `COMMIT`.
That reset is the `DEALLOCATE ALL` that production's `pg_stat_statements` counted 9.7 million times between mid-October and 2026-11-10.
The session pooler gives each client connection its own server connection, so prepared statements survive and a query is one statement.
The worker holds its three (`connection_limit=3`) server connections while it runs.
Both ports present the same `*.pooler.supabase.com` certificate, issued by the Supabase Intermediate 2021 CA (checked 2026-11-10), so the TLS settings above apply unchanged.
The Vercel API stays on the transaction pooler, which suits short-lived functions.

The canary, which reaches production from an operator's machine, verifies the certificate chain
(`verify-full`) against the same committed CA (`--db-ca` names another). It strips every `ssl*`
parameter from the connection string first, because `pg` lets those parameters replace the
verified TLS settings.

The canary's synthetic account (`canary-user-` prefix) is excluded from analytics in code
(`isCommunityCanaryUser` in `community-analytics.ts`), so real posts report to PostHog and the
canary's publication does not.

`GRAFANA_OTLP_ENDPOINT` and its credentials are deliberately absent. The worker image does not
start the OpenTelemetry SDK: `@opentelemetry/sdk-node` and its exporters would push `node_modules`
past the 150 MB budget, so the variables would do nothing there. Worker liveness rests on the host's
restart policy, the readiness log line and the hosted canary. Since Story 6.12 the `/moderation/sla`
page, served by the API with no worker running, shows the oldest `pending_review` time and a stale
monitor once the flag is on. See the [moderation SLA runbook](./moderation-sla-runbook.md) for which
push path exists.

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
keeps it active.

**Database cost while idle.**
Supabase meters database egress, and every statement's reply counts toward it.
From mid-October to 2026-11-10 the hosted worker polled PostgreSQL nonstop with the community closed and pushed production past its 5 GB egress quota.
Every polling loop now backs off while it finds nothing ([`community-idle-backoff.ts`](../../apps/api/src/modules/community/community-idle-backoff.ts)): an idle tick doubles the delay up to a cap chosen from the loop's latency bound, and the first tick that moves work returns it to the busy cadence.
An idle tick asks one cheap question before it does anything costly, and that question matches only rows the loop could move now.
Progress means rows that changed state: a pass that moves any row keeps the busy cadence even when other rows in it failed, so one rejected send cannot slow a quiet-hour herd, and a pass that moves nothing backs off, failures included.
Shutdown waits for a tick in flight before it closes the queue, PostHog and Prisma.

| Loop                                             | Busy cadence | Idle cap    | Idle tick                                          |
| ------------------------------------------------ | ------------ | ----------- | -------------------------------------------------- |
| Outbox dispatch (posts, comments, analytics)     | 1 s          | 10 s        | one probe across every dispatch outbox             |
| Stale review, upload expiry, erasure, ban expiry | 30 s         | 5 min       | the sweep's own reads                              |
| Moderation SLA sweep                             | 60 s         | fixed       | flag read while the flag is off                    |
| Moderation history retention                     | 24 h         | fixed       | runs once at start                                 |
| Stream append and spotlight invalidation         | 0.5 s        | 10 s        | two probes                                         |
| Stream retention, detail retention               | 10 s         | 10 min      | the sweep's own reads                              |
| Backlog observation                              | 60 s         | fixed       | one read; an idle lane is written hourly           |
| Operational telemetry delivery                   | 1 s          | 60 s        | one lease; none while the sink is unset            |
| Push lanes (grouping, policy, fanout, dispatch)  | 50 to 250 ms | 5 s         | fanout and dispatch wake at their earliest due row |
| Push recovery, receipts                          | 1 s, 30 s    | 30 s, 5 min | the sweep's own reads                              |

The caps keep each story's bound.
A post or comment published to an idle worker waits at most 10 seconds for dispatch, inside the one-minute dispatch the general worker was designed with and the 15-minute stale-review window.
The API appends on every sync and realtime tick (`assist`), so the worker's append loop is the backstop for Story 6.5's 10-second realtime bound.
The push lanes run only where `COMMUNITY_DISPATCH_ENABLED=true`; grouping wakes fanout and fanout wakes dispatch inside the process, so a new intent sees at most the 5-second cap, and a quiet-hour exit herd starts when it falls due.
The maintenance caps match or beat the general worker's crons for the same sweeps.
Only a test stack (`NODE_ENV=test`) may lower the maintenance cap, with `COMMUNITY_MAINTENANCE_IDLE_CAP_MS` from 30 s to 5 min; the end-to-end stack sets 30 s so its erasure journey sees the real sweep within its wait. Production never sets it, and a worker that finds it outside a test stack refuses to start.

Two deliveries used to be leased forever.
PostHog's `/i/v0/e/` answers an accepted event with `{"status": "Ok"}`, and the acknowledgement check accepted only `{"status": 1}`, so every operational telemetry row failed and was re-leased about hourly: 57,025 rows, attempts up to 197, on 2026-11-10.
The check now accepts both shapes.
When `POSTHOG_API_KEY` is unset, the reaction, comment and operational telemetry outboxes park their rows: no lease, attempts unchanged, one `*_delivery_parked` warning per process.
Parked reaction and comment analytics wait for a configured process to deliver them; their 30-day retention removes only delivered rows.
Parked operational telemetry is content-free metrics, and the 30-day detail retention removes it delivered or not, so a sink unset for a month loses those readings.

Measured against an isolated PostgreSQL 17 with `pg_stat_statements`, the worker idle with the sink answering like PostHog, five-minute windows after a one-minute warm-up (bytes are what the database sent the worker):

| Build and pooler                                      | Statements a minute | `BEGIN`/`COMMIT`/`DEALLOCATE ALL` a minute | Bytes to the worker, per 30 days |
| ----------------------------------------------------- | ------------------: | -----------------------------------------: | -------------------------------: |
| Polling, transaction pooler, empty outboxes           |               4,364 |                                      2,864 |                          13.8 GB |
| Polling, transaction pooler, production's 57,025 rows |              11,987 |                                      8,579 |                          51.9 GB |
| Idle backoff, transaction pooler                      |                 125 |                                         89 |                           323 MB |
| Idle backoff, session pooler (production)             |                  38 |                                          3 |                            97 MB |

The remaining 38 a minute are the three dispatch, append and spotlight probes at their caps, the SLA flag read, the backlog read and the telemetry lease.
The measurement scripts are throwaway; repeat the measurement with a counting TCP proxy between the worker and an isolated PostgreSQL with `pg_stat_statements` loaded.

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
- [Contract testing](../../.github/workflows/contract-testing.yml): one job with the gitleaks
  secrets scan, generated OpenAPI and Optic lint/diff, and Pact consumer/provider checks.
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

## Story 6.11 moderation decisions rollout

The screening protocol from migration `20261104140000_community_pending_image_declaration` cannot fence a worker running the previous build.
While an old worker can still upload, a recovered post can end up declaring bytes that are not stored, and an erased image can come back through its service-role upload.
Confirmed shutdown of every old process carries this guarantee, and nothing else does.

`moderation_decisions_enabled` narrows the exposure and proves nothing about it:

- Decision and appeal routes evaluate it per moderator, so a targeted rule can open them for one person while the default is off.
- `sweepExpiredBanHolds` runs with no flag lookup, so an ended sanction returns content to screening while the flag is off.
- No production path creates a sanction except the decision route, so with the flag off for everyone no new one appears. Turning the flag off does not remove sanctions that already exist.

Steps:

1. Stop every process group consuming `community-moderation` before starting the new build, for this release only.
   That is the general worker or the hosted community worker, whichever runs against this Redis, including any replica.
2. Get authoritative confirmation that each old process exited: the host's own record of the instance stopping, with its active jobs ended. A worker missing from Redis is unknown, because a disconnected process can still hold an upload in memory.
3. Apply the migration, then start the new build.
4. Cross-check each running worker's release identity:
   - For every entry `getWorkers()` returns, `rawname` carries `community-worker@<COMMIT_SHA>` with the release SHA. Its `name` is only the queue name.
   - Every `community-worker:heartbeat:*` key has that `commitSha`, and a `startedAt` after the old processes' confirmed exit.
5. Enable `moderation_console_enabled` and `moderation_decisions_enabled` only after steps 2 and 4 pass.

## Story 6.12 SLA monitoring rollout

`moderation-sla-sweep` runs in two places, and they share `CommunitySweeps.sweepModerationSla`:

- The general bootstrap runs it every minute as a Job Scheduler on the `maintenance` queue.
- `community.bootstrap.ts` runs it on a 60-second interval, because that process does not subscribe
  to `maintenance`. This is the path that runs in production.

The migration `20261105120000_moderation_sla_monitoring` is additive.
The sweep reads its flags first, so a worker that starts before the migration does nothing while the
flag is off.
Follow the rollout and rollback steps in the [moderation SLA runbook](./moderation-sla-runbook.md).

## Concrete gaps

1. **Most workers have no deployment target yet.** The community worker runs on Northflank. The
   general and wardrobe workers have no image or hosted target, and no process verifies worker
   liveness continuously.
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
    operational signals. The moderation SLA dashboard has real metrics locally, and its hosted
    panels stay empty because neither hosted runtime starts the OpenTelemetry SDK.
11. **No moderation alert reaches a person in production yet.** `MODERATION_OPS_WEBHOOK_URL` has no
    production destination, so alerts stop at `/moderation/sla` (Story 6.12 D8). The owner signed off
    staffing on 2026-11-05, and no roster or schedule exists
    ([gate record](../test-artifacts/community-beta-gate-signatures.md)).

### Story 6.13 moderation history

Migration `20261105150000_immutable_moderation_history` goes live on deploy, with no flag.
It makes the role `moderation_history_owner` the owner of `ModerationDecision`.
The application role keeps `SELECT` and `INSERT`, and `anon`, `authenticated` and `service_role` hold nothing.
Three triggers refuse `UPDATE`, `DELETE` and `TRUNCATE` for everyone, and the one exception removes identity: a foreign key `SET NULL` action, or `private.moderation_history_anonymize`, which needs the privacy guard and an erasure request row.
The migrating role needs `CREATEROLE` and `BYPASSRLS`, and without them the build fails and leaves nothing behind.
The application role reads this table through `BYPASSRLS`, now that it does not own it.

Check it with `npm run moderation:history:verify`, which reads the catalog through `DATABASE_URL` and prints check names only.
The daily retention job runs the same checks and logs `moderation_history_enforcement_drift`.

**What this does not stop.** Every DML statement, every non-DDL path and every role other than the migration role is refused.
A session running arbitrary DDL as the migration role can defeat enforcement: it holds `ADMIN` on the owner role, so it can `GRANT` itself access, and as schema owner it can `DROP TABLE` or `DROP FUNCTION ... CASCADE`, or put code in an object the definer function touches.
That takes a compromise of the same class as a reviewed migration.
A superuser under `session_replication_role = replica` skips the triggers too.
The Supabase image lets the application role set that parameter (measured on `supabase/postgres:17.6.1.054`).
In that mode its `UPDATE`, `DELETE` and `TRUNCATE` on `ModerationDecision` are still refused, because the privilege layer does not depend on triggers.
`AuditLog` and `CommunityCommentAudit` have no such layer: the application role owns both and their enforcement is trigger-only, so in that mode it can update and delete their rows, `moderation_evidence_exported` included.
Story 6.13 keeps that enforcement as it was, by its frozen scope.
A role that can call the function can also forge a request row and strip identity from real rows, and that cannot alter what any decision says.

**A later migration that changes `ModerationDecision`** follows this sequence, and `packages/db/test/migration-hygiene.spec.ts` enforces the revoke:

```sql
DO $$ BEGIN
  EXECUTE format('GRANT moderation_history_owner TO %I WITH SET TRUE, INHERIT FALSE', current_user);
END $$;
SET ROLE moderation_history_owner;
-- the change
RESET ROLE;
DO $$ BEGIN
  EXECUTE format('REVOKE moderation_history_owner FROM %I', current_user);
END $$;
```

**Never write `GRANT ... TO CURRENT_USER`, `TO SESSION_USER` or `REVOKE ... FROM CURRENT_USER` in a migration.**
On Supabase those keywords segfault the backend in `supautils` and restart the whole server, which drops every connection (measured on `supabase/postgres:17.6.1.054`).
A plain Postgres image does not show this, so a migration that changes roles has to run on the Supabase image before it merges.

**Retention.**

| Table                                                          | Rule                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ModerationDecision`, `AuditLog`                               | Never pruned, and the database refuses it                                                   |
| `ModerationEvent`, `CommunityCommentAudit`, both report tables | Never pruned by any job. They change only through erasure and foreign keys                  |
| `ModerationSlaAlert`, terminal                                 | Deleted 400 days after `detected_at`, 500 rows a run, unless it still owes a failure record |
| `ModerationSlaAlert`, `pending`                                | Never pruned                                                                                |

**Account erasure.** An admin starts it with `POST /api/v1/moderation/erasure-requests` on a request received through support.
Identity leaves moderation records in that transaction, and the community sweep deletes the member's purged post rows and stamps `completed_at` within 72 hours.
`moderation_erasure_overdue` logs a count when a request passes that.
It covers community and moderation data only: no member self-service exists, and the account-deletion story owns the `User` row, wardrobe and billing.

`moderation_history_enabled` defaults off, and gates both routes, the console controls and the alert prune.
The erasure extension has no flag, because it is a privacy duty on the established path.

### Story 6.5 engagement dispatch controls

Production community rollout remains frozen. `COMMUNITY_DISPATCH_ENABLED` defaults off.
When an isolated approved lane enables it, `COMMUNITY_ENGAGEMENT_OWNER` must select
`general` or `community`. The general-only deployment selects `general`; the standalone
community composition selects `community`. Other compositions report `standby`. Only the
selected composition allocates the dedicated guard pool.

**Send slots.** `COMMUNITY_DISPATCH_SEND_SLOTS` sets how many sends run at once: default 10,
1 to 32, and an invalid value keeps dispatch off with `send_slots_invalid`. The guard pool holds
one connection per slot plus four for control work, 14 by default. Production keeps the default:
its Nano transaction pooler serves about 15 connections at a time, shared with the API, and 32
slots (36 connections) are the setting for a compute plan whose pooler serves them (Story 6.5
D10 amendment, 2026-11-11). The arithmetic assumes one dispatching worker instance: each
instance has its own slots, so a second one, a rolling deploy's overlap included, doubles the
demand on the pooler.

**Guard pool.** It runs on node-postgres through Prisma's driver adapter with the operator
client's TLS (the committed Supabase root CA, host name checked). An acquisition, opening a
connection included, may take 5 seconds: opening one through the pooler measured 0.6 to 0.7 s
on the hosted worker while idle, 1.0 to 1.2 s with its two vCPUs busy and up to about 4 s with
both saturated. One query may wait 5 seconds for its answer, ten times the server's 500 ms
statement bound; a query that runs out destroys its connection, so a connection that stops
answering is closed and replaced instead of held. A connection lost under a query (the pooler
closed it, the network reset it) is named `connection_lost`, apart from a SQL error. Opened
connections stay open while idle.

**Preflight and warm-up.** The preflight retries only failures to get or use a guard connection,
1, 2 and 4 seconds apart, and reports `guard_unreachable` when the fourth attempt fails. Each
attempt and the warm-up must finish within 10 seconds, and closing a pool that failed takes at
most 2 seconds. The warm-up holds every guard connection at once, each in an open transaction,
until all are held or the deadline passes, then commits them all and counts only the ones held
together whose COMMIT succeeded within 2 seconds: a connection whose COMMIT failed or was never
answered cannot serve a send. Sends get the connections it proved, less the four control ones: a shortfall lowers `sendSlots`, and too few for one send
reports `guard_unreachable` (`GuardCapacityShortfall`). A send waits at most 2 s from its claim
to its provider call, and the server-side guard bounds are unchanged.

**Readiness.** `community_dispatch_readiness` logs `disabled`, `standby`, `ready` or `degraded`
with the role. Degraded reasons are `owner_unconfigured`, `guard_unconfigured`, `guard_mismatch`,
`guard_unreachable`, `capability_unavailable` and `send_slots_invalid`. A degraded line names the
error class, the Prisma error code and, for `capability_unavailable`, the failed check
(`server_version`, `privacy_version` or `guard_timeouts`), never the error message. A ready line
gives `preflightAttempts`, `guardConnections` (held at once), `sendSlots` (in use) and
`configuredSendSlots`. `COMMUNITY_GUARD_DATABASE_URL` must name the same primary host and
database as `DATABASE_URL`, and no credential value or database URL appears in a log.

**While dispatching.** A pass selects at most `sendSlots` due deliveries and passes never overlap,
so a herd waits in the database, due. `community_dispatch_at_capacity` and
`community_dispatch_below_capacity` mark a stretch of full passes. `community_dispatch_behind`
(warn) fires when the oldest outstanding delivery is more than 60 seconds past its original
eligibility, the herd acceptance bound, and `community_dispatch_caught_up` when it no longer
is: that is the slow-provider envelope, and eligibility times are never rewritten to hide it.
A send that fails before the guard settles it moves its delivery 2 seconds on, in a transaction
bounded at 100 ms of lock wait and 500 ms per statement that skips a row another transaction
holds, so one held delivery cannot stall the loop or shutdown. An attempt that could not get or
use a guard connection before the provider call ends `no_call:guard_unreachable`; any other
failure before it ends `no_call:guard_failure`, and one after it `handoff_uncertain`.

**Append.** The worker appends committed outbox rows to the public and private streams in one
statement, `community_append_batch` (migration `20261111120000`): a batch costs four round
trips whatever its size, about 125 ms plus server work at the 31 ms measured from the worker.
Before 2026-11-11 each candidate took about 16 round trips from TypeScript, every batch ran past
its 500 ms bound, and production append never succeeded (public head sequence 0). Signals:
`community_append_retry` rows name `head_contention`, `budget_pressure` or `pool_wait` (no pool
connection freed up within 250 ms, so the batch keeps its size); the `community_backlog`
row for lane `append` carries the oldest unappended age; past five minutes the worker logs
`Community append stalled` and records `community_append_stalled` once every five minutes,
which the PostHog alert on project 329012 watches. A stall means rows are not appending: read
the worker's `Community append deferred` lines for the reason before anything else.

The alert is `Community append stalled` (insight `Fp43bJIe`, hourly, current hour included,
fires above 0, emails the owner). Production record for #208 (merge `7c592b31`, 2026-11-12 UTC):
migration `20261111120000_community_append_batch` finished 03:10:08, the three functions are in
`pg_proc` (SECURITY INVOKER, `search_path=public, pg_temp`), the worker started on `7c592b31`
at 03:11:09 and the API was READY at 03:11:49. Before the proof the public head sequence was 0,
the outbox and stream empty. One identity-free public `resync` outbox row inserted at 03:15:57
was appended 1.7 s later as public sequence 1, with no new `community_append_retry` row and no
worker warning or error.

Capacity on the production project (free plan, Nano compute, measured 2026-11-11): Postgres
`max_connections` is 60 with 3 reserved, and Supavisor admits 200 clients with the plan's default
pool size (the pooler config returns null for both). Idle guard connections are Supavisor clients
only: 36 of them left Supavisor's server connections at 21 before and after, and 36 one-second
transactions through them took 3.4 s, about 15 at a time. Over 180-second windows, 36 idle guard
connections added no statement calls or network bytes against a control window (96 against 255
calls, 75 KB against 87 KB received). With dispatch on at the default 10 slots, the clients are
14 guard, 3 for the worker's main pool and 5 per API function instance, which leaves 183 for
about 36 concurrent API instances.

Operators investigate degraded dispatch while keeping community rollout off, verify the selected
owner and existing primary's measured capabilities, then restart the assigned process after the
configuration is corrected. This startup preflight does not automatically enable dispatch later.
No guard/pool/privacy limit may be weakened to clear readiness. Preserve original overdue work
and eligibility clocks for the required recovery proof; a readiness log establishes no acceptance.

## Story 6.14 complimentary access

The owner can give a chosen member every premium capability and the community rollout without
payment. A grant lives in `ComplimentaryAccessGrant`, beside the RevenueCat mirror. Webhooks,
refresh and the reconciliation sweep never read or write it, so they cannot expire, overwrite
or bill it.

**Grant, revoke and list.** Only the owner can run these: they need the production database
credentials and an admin actor.

```sh
npm run access:complimentary -- grant --env-file .env.prod --confirm-target <project ref> \
  --actor-email <admin email> --member-email <member email> --reason "<why>"
npm run access:complimentary -- revoke --env-file .env.prod --confirm-target <project ref> \
  --actor-email <admin email> --member-email <member email> --reason "<why>"
npm run access:complimentary -- list --env-file .env.prod --confirm-target <project ref> \
  --actor-email <admin email>
```

`--dry-run` runs every check and writes nothing. The command reaches a remote database through
node-postgres, which verifies the certificate against the committed Supabase root CA with Node's
OpenSSL; the Prisma engine's TLS on macOS rejects Supabase's pooler certificate, so this is what
lets it run from a laptop. `community:sponsorship` connects the same way. The actor must be an auth user whose
`app_metadata.app_role` is `admin`, with no pending erasure request. Each grant and revoke
writes one `AuditLog` row, `complimentary_access_granted` or `complimentary_access_revoked`,
holding the actor and the grant id only. The member, reason and times live on the grant row,
which account erasure deletes. A revoke takes effect on the member's next request, and the paid
or free state they had before is what they get.

**What a grant opens.** Premium (themes, palette advisor, planner) and these flags, for that
member only: `premium_themes_enabled`, `color_analysis_enabled`, `premium_planner_enabled`,
`community_read_enabled`, `community_write_enabled`, `share_card_native_share_enabled`. Age,
guardian consent, sanctions, erasure and screening still apply. Web checkout refuses a grantee
with 409. Mobile hides purchase controls for a grantee and never configures RevenueCat for
them; a store purchase made through another client cannot be refused by the server.

**Kill switch.** `complimentary_access_enabled` defaults on, because it can only widen access
for members the owner granted. It is evaluated for the fixed subject
`complimentary-access-kill-switch`. Off removes every complimentary effect: premium and five
flags on the next request, community read, realtime and push once each member's 60-second
cache row expires. Closing a community flag for an incident does not close it for
complimentary members, so also turn the switch off:

1. In PostHog, create or edit the boolean flag `complimentary_access_enabled` and set it to
   false for everyone. This holds within 60 seconds while PostHog answers.
2. When PostHog is slow or down, the API falls back to the `feature_flags` row, which the flag
   sync refreshes every 5 minutes. For an immediate stop, also set the row. The row may not
   exist before the first sync, so the statement upserts it:

   ```sql
   INSERT INTO feature_flags (key, value, updated_at)
   VALUES ('complimentary_access_enabled', to_jsonb(false), now())
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
   ```

   A PostHog flag still set to true overwrites the row on the next sync, so do step 1 too.

**Push.** Push reaches a grantee only when the hosted community worker dispatches. Enable it on
the Northflank `couture-cast/community-worker` service:

1. Before the change, record a read-only count of pending `CommunityTokenDelivery` rows by
   status and expiry, so any backlog the switch would release is known.
2. Set `COMMUNITY_DISPATCH_ENABLED=true`, `COMMUNITY_ENGAGEMENT_OWNER=community` and
   `COMMUNITY_GUARD_DATABASE_URL` (same primary as `DATABASE_URL`), then restart.
3. Confirm `community_dispatch_readiness` logs `ready`.
4. Confirm a non-grantee's delivery ends `suppressed` with zero attempts. Every other member's
   `community_read_enabled` is false in production, so dispatch suppresses them before any
   attempt; `no_call:read_disabled` appears only when the in-transaction recheck flips. The
   flag must exist in the production PostHog project (the drift check below): until
   2026-11-11 it did not, and every non-grantee delivery re-deferred instead.
5. If readiness is not `ready`, set `COMMUNITY_DISPATCH_ENABLED` back off, fix the cause and
   record the outcome here. No credential value is printed in logs or committed.

**Production record, 2026-11-11 UTC (`1fa40089`).**

- Step 1: zero `CommunityTokenDelivery` rows of any status, so the switch had no backlog to
  release.
- Steps 2 and 3: the three variables were set at 00:27:23, and the worker logged
  `community_dispatch_readiness` `degraded`, reason `capability_unavailable`, at 00:27:41.
  `COMMUNITY_DISPATCH_ENABLED` went back to `false` at 00:27:55 and readiness logged
  `disabled` at 00:28:08. `COMMUNITY_ENGAGEMENT_OWNER` and `COMMUNITY_GUARD_DATABASE_URL` stay
  set, so the next attempt needs only the flag.
- Cause: `CommunityRuntimeCapability.privacy_version` is 0 in production and dispatch requires
  1. Raising it enables `community_require_guard` enforcement for every community privacy
     write, so it is an owner decision with its own rollout check, made before the next attempt.
- Step 4 did not run, because nothing dispatches.

**Second attempt, 2026-11-11 UTC (`143b3438`).** The worker was back at one instance after the
idle-egress fix (#203).

- Step 1 at 10:23:23: zero `CommunityTokenDelivery`, `CommunityNotificationGroup`, `PushToken`,
  `NotificationPreference` and `CommunityNotificationIntent` rows; one
  `ComplimentaryAccessGrant`.
- At 10:24:05 one `UPDATE` raised `privacy_version` from 0 to 1, which read back as 1 and
  stays. The production API logged no request and no error from 10:20 to 10:30.
- Steps 2 and 3: `COMMUNITY_DISPATCH_ENABLED=true` at 10:24:20; readiness logged `degraded`,
  `capability_unavailable`, at 10:24:39. The flag went back to `false` at 10:25:09 and readiness
  logged `disabled` at 10:25:24. The instance count stayed at one.
- Cause: the guard pool, not the capability. Run inside the live worker with its own guard URL,
  the deployed `createPrismaClient` and `CommunitySendGuard.verifyRuntime` passed in 1.2 s while
  idle. With CPU load the first connection took 1.0 to 1.2 s and Prisma failed it with `Timed
out fetching a new connection from the connection pool` (pool timeout 1); with both vCPUs
  saturated it failed 12 of 12. At boot the preflight runs while Redis, the engagement loops
  and the main pool open their own TLS connections, and its catch reported every failure as
  `capability_unavailable`.
- The same worker, 64 send-shaped guard operations at concurrency 16 with both vCPUs saturated:
  the 1 s pool completed 0 of 64, twice; the pool described above completed 58 and 64 of 64.
  The six misses were the claim's own 500 ms `transaction_timeout` under full starvation.
  Kept idle, the 36 connections answered together in 377 ms after 10 s and 768 ms after 400 s;
  with Prisma's default 300-second idle lifetime they were reopened (1570 ms).
- The fix is the pool budget, preflight retry and readiness detail above.

**`privacy_version` 1 rollout check, 2026-11-11.** Run on stock `postgres:17` with every
migration and the capability at 1, before any production change:

- Audit mode, where the guard logs each unguarded statement instead of raising, over all 141
  `apps/api` integration files: 2399 tests passed, and the 1629 logged statements fall into 24
  shapes, every one a test fixture, cleanup or race injection. Every product writer of a guarded
  table (consent revoke, comment erasure, post anonymize, takedown, sanctions, push registration,
  preferences) holds the guard. The four Story 6.5 acceptance specs passed 7 of 7 with no
  unguarded statement.
- With the guard raising, the same suites fail only where fixtures write guarded rows directly
  (72 tests); at 0 those files pass 561 of 561. The integration tier now runs at 1 so CI keeps
  production semantics.
- Production stays at 0. The flip and the next dispatch attempt wait until the community worker
  polls without the idle egress that exceeded the Supabase quota on 2026-11-10 (worker scaled to
  0), then run in this order: one `UPDATE` with the value recorded before and after, dispatch
  enabled, readiness `ready`, a non-grantee delivery suppressed with zero attempts, and both
  rolled back if anything degrades.

**First grant, blocked.** Production `auth.users` holds no rows, so no admin actor exists: the
owner signs in on production once and gets `app_metadata.app_role` `admin`. The rows were missing
because production web had none of the API rewrite targets `next.config.ts` reads, so every
`/api/v1` call from the web app, signup included, answered 404; `PROD_API_BASE_URL` on web
production fixed it on 2026-11-10. From macOS the
command cannot open its connection: the committed Supabase Root 2021 CA verifies both poolers
with `openssl`, but Prisma on macOS rejects the chain with `The certificate was not trusted`,
and `community:sponsorship` shares that client. Run the command from Linux until the operator
client verifies the CA through Node's TLS. The targeting guard held on production: without
`--confirm-target` the command refused and named the project, and nothing was written.

**Third attempt, X-DISPATCH, 2026-11-11 UTC (`c6da9ace`, PR #205).** The guard pool fix was
deployed to the worker at 17:35:19. Synthetic members only: `example.test` emails with no
`auth.users` login, the owner admin as actor, grants and revokes only through
`access:complimentary` with `--confirm-target`, erasure through the product path, leftovers
deleted by tag. The owner's own grant `cmwbf7als0001jpx5ifbuuo51` was not touched.

- Before counts over all 83 public tables at 17:35:52. `COMMUNITY_DISPATCH_ENABLED=true` at
  17:37:22; readiness `ready` at 17:37:40 with `preflightAttempts` 1, `guardConnections` 14,
  `sendSlots` 10 and `configuredSendSlots` 10. The instance count stayed at one.
- Grantee leg, tag `tea-xdispatch-9c2551bc`: seeded at 17:38:02, granted at 17:38:14 (grant
  `cmwcek6ew0001jpbxybfjvshp`), reacted at 17:38:22. The grantee's delivery made one attempt,
  17:38:33.988 to 17:38:36.074, which Expo answered `DeviceNotRegistered` for the synthetic
  token: the token was pruned, the delivery ended `failed` and nothing retried. Pass.
- Non-grantee leg, same tag: the delivery stayed `deferred` with zero attempts and re-deferred
  about every 47 s (17:39:22, 17:40:09). Cause: the PostHog project production read defined no
  `community_read_enabled`, and community evaluation treated the missing key as unavailable.
  See "PostHog projects and flag drift" below.
- Revoked at 17:41:12. `AuditLog` rows `cmwcek6g90003jpbxch33oswh`
  (`complimentary_access_granted`, 17:38:15) and `cmwceo1000001jpf2yb3yfum1`
  (`complimentary_access_revoked`, 17:41:14). Reasons: "X-DISPATCH synthetic grantee
  tea-xdispatch-9c2551bc, removed after the check" on the grant and "..., check done" on the revoke.
- Erasure requested at 17:41:34 and 17:41:35 (requests `21a59963-0366-46fd-ba0b-c716aa533634`,
  `570300a3-11f2-4538-9759-3382d14f8f35`), members deleted at 17:42:01, leftovers purged to none.
  After counts at 17:42:30: `AuditLog` 1 to 3 (the two immutable rows), `CommunityDomainOutbox`
  0 to 10 (identity-free public resync rows), `CommunityEngagementTelemetry` 57043 to 57168,
  `telemetry_events` 84 to 89 (three `api_error_occurred` 401s from the probe and two anonymous
  `community_reaction_added`).
- The 11 missing flags were created in the production PostHog project at 17:48 and production
  was moved to that project (below). Non-grantee rerun, tag `tea-xdispatch-ba16aae6`, two fresh
  non-grantees: before counts at 17:55:34, seeded at 17:55:36, reacted at 17:55:39, both
  deliveries `suppressed` at 17:55:47 with zero attempts. Pass. Erasure requested at 17:56:16
  and 17:56:17 (requests `d7ab9e32-2aa3-44b8-afe4-1b61b8d82c42`,
  `6d8de50a-38b4-415c-8b64-048f8d237b84`), members deleted, leftovers purged. Erasure removes
  the notification group's recipient, so the two groups, their deliveries and eligibility rows
  no longer match the tag; they were deleted by id from the status read. After counts at
  17:57:47: `CommunityDomainOutbox` 10 to 20, `CommunityEngagementTelemetry` 57475 to 57530,
  `telemetry_events` 89 to 91 (anonymous reactions).
- The 20 outbox rows never appended: the public stream head sequence is 0, so production append
  has never succeeded. Every batch aborted `budget_pressure` at batch limit 1, about 25 retry
  telemetry rows a minute from 17:38, and an unappended row is never pruned. The 20 synthetic
  resync rows (no subject links) were deleted at 17:58:50 and the retries stopped. The append
  fix is its own change.
- Dispatch stays enabled.

## PostHog projects and flag drift

Production reads the PostHog project `couturecast-prod` (329012). Local development and Vercel
preview read `couturecast-dev` (327096), where a seeded `feature_flags` row can turn a feature on
for testing. Until 2026-11-11 every environment read 327096, which defined 4 of the 14 declared
flags (with `color_analysis_enabled` at 100 percent), while the moderation SLA dashboard, its
heartbeat alert and the warehouse source already pointed at 329012, which had never received an
event.

| Consumer                                           | Production key | Since                         |
| -------------------------------------------------- | -------------- | ----------------------------- |
| Vercel `couture-cast-api`, production target       | 329012         | redeploy at 17:54, 2026-11-11 |
| Vercel `couture-cast-api`, development and preview | 327096         | unchanged                     |
| Northflank `couture-cast/community-worker`         | 329012         | 17:50:24, 2026-11-11          |
| `.env.prod`                                        | 329012         | 2026-11-11                    |
| Vercel `couture-cast-web`, production target       | 329012         | post-merge step, PR #207      |
| Vercel `couture-cast-web`, development and preview | none           | unchanged                     |
| EAS `production` environment                       | 329012         | post-merge step, PR #207      |

- Event history before the switch stays in 327096. Worker events reach 329012 from 17:50:38;
  327096 received no production event after 17:50.
- The owner turned on web and mobile production analytics on 2026-11-11, in the privacy-safe
  configuration under "Production analytics". Their keys are added only after that configuration
  is on `main` (see "Post-merge step: add the production keys").
  A mobile binary keeps whatever key it was built with until its next build; `app.config.ts`
  loads `.env.local` before `.env.prod`, so a production build made on a laptop takes the local
  key.
- In 329012 every declared flag exists. Created 2026-11-11 at 0 percent: `community_read_enabled`,
  `community_write_enabled`, `commerce_affiliate_enabled`, `commerce_subscription_enabled`,
  `premium_planner_enabled`, `share_card_native_share_enabled`, `moderation_console_enabled`,
  `moderation_decisions_enabled`, `moderation_sla_monitoring_enabled`,
  `moderation_history_enabled`; at 100 percent, matching its declared default:
  `complimentary_access_enabled`. Already present with the same values production read before:
  `premium_themes_enabled` 0, `color_analysis_enabled` 100, `weather_alerts_enabled` 100 and the
  undeclared `community_feed_enabled` 0. Production `feature_flags` rows held the declared
  defaults, so the switch changed no answer.

**Drift check.** The `PostHog flag drift` workflow runs `scripts/ci/posthog-flag-drift.mjs`
hourly, on every push to main and on any pull request that edits `packages/config/src/flags.ts`.
Each declared key must pass two checks, and the expected value is its declared default unless
the script's `INTENTIONAL_OVERRIDES` pins another with its reason. Today that is only
`color_analysis_enabled` at `true` (owner decision 2026-11-11: color analysis stays on in
production, and the code default stays `false` so a degraded PostHog fails closed).

- Definition, read through the PostHog API with the repository secret `POSTHOG_FLAG_READ_KEY`
  (a personal API key limited to `feature_flag:read` and `project:read` on 329012): the flag
  exists, is active,
  boolean, evaluated server-side, and released to everyone at the expected value. Every release
  group has no property or cohort filter and a 0 or 100 percent rollout, with no super group,
  early exit, holdout, early-access enrollment, group aggregation or remote configuration. This is what
  proves a rollout is uniform; probes cannot see a cohort or a 1 percent rollout they miss.
- Project settings, read with the same key: Discard client IP data (`anonymize_ips`) must be on,
  since the analytics privacy boundary depends on it (see the PostHog privacy section).
- Runtime: `/flags` with the project token in the repository variable
  `POSTHOG_PROD_PROJECT_TOKEN` and the API adapter's server User-Agent, for 12 synthetic
  subjects. It fails when PostHog omits a key (missing, inactive or not evaluated server-side),
  answers a variant, or answers any subject other than the expected value.

The job fails closed when either input is missing. An evaluation error, quota limit or HTTP
error on the probes is retried three times and then fails as unavailable, never as drift. A pull
request that declares a new flag stays red until the flag exists in 329012 as an active boolean
released to everyone at its declared default (0 percent for `false`, 100 for `true`), or carries
a pinned override.

**A key PostHog omits.** An omission does not prove the flag is missing: PostHog also omits an
inactive flag and one filtered from the server runtime. Community evaluation resolves it closed
to the declared default (`false` for `community_read_enabled`), cached for one 60-second claim,
and never reads the `feature_flags` row, whose stale `true` could otherwise renew a
non-grantee's access. A grantee is still granted before PostHog is asked. An unreachable
PostHog, an evaluation error or a quota limit still caches nothing and defers the delivery,
bounded by its group's expiry, as is a delivery whose send keeps throwing.
