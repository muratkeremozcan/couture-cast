# Playwright smoke suite

Updated: 2025-11-17 — Initial Playwright framework scaffolding for
Story 13, anchored at repo root to serve multiple projects including
NestJS API E2E coverage.

## Tooling baseline

- Node 24.x everywhere (`.nvmrc` enforces it); run `nvm use` before
  installing dependencies.
- Core dev deps live at the repo root so every workspace consumes the
  same Playwright, Faker, Dotenv, and TSX versions.
- `npx playwright install --with-deps` must run once per machine or CI
  runner to download the browsers declared in `playwright.config.ts`.

## Quick start

1. `nvm use && npm install`
2. No `.env` is required for a local run. `DATABASE_URL` defaults to the
   local Supabase container (`scripts/local-e2e-database.mjs`), and an
   explicit value in the environment always wins. Create one only if you
   need `SUPABASE_SERVICE_ROLE_KEY`; all URLs and credentials are in
   `playwright/config/environments.ts`.

   If you do copy `.env.example`, leave
   `COMMERCE_PARTNER_SAMPLE_PARTNER_WEBHOOK_SECRET` commented out. See the
   note in that file: setting it to the placeholder makes every valid
   affiliate webhook return 401 while the rejection matrix still passes.

3. `npx playwright install --with-deps`
4. `npm run test:pw-local` (automatically sets `TEST_ENV=local`)

   Startup runs `prisma migrate deploy` and then the seed, so a database
   that has never been seeded still comes up with the fixtures the specs
   read, including the affiliate `sample-partner` catalog and the
   `commerce_affiliate_enabled` flag row. Every seed is an upsert and none
   delete. Pass `SKIP_E2E_SEED=true` to skip it on a fast re-run.

   Teardown runs `db:reset`, which drops and rebuilds the database. Only this
   script opts in (`PLAYWRIGHT_DB_RESET=true`); a raw `npx playwright test`
   never resets anything. Set `PLAYWRIGHT_SKIP_DB_RESET=true` if something
   else is using the database.

5. Use the other helpers, `npm run test:pw-preview` or
   `npm run test:pw-prod`, when remote deployments are ready, or run
   `TEST_ENV=<env> npm run test:pw` directly to target a custom
   environment.

Recent additions:

- Playwright-utils fixtures are now merged into
  `support/fixtures/merged-fixtures.ts`. This adds
  `interceptNetworkCall`, `recurse`, `log`, `networkRecorder`, and
  related helpers.
- New realtime fallback check:
  `npm run test:pw-local -- playwright/tests/realtime-fallback.spec.ts`
  covers disconnect, polling, and reconnect (P1).
- Live poll endpoint check: set
  `LIVE_POLL_BASE_URL=https://<api-host>` or rely on local `webServer`
  auto-start, then run
  `npx playwright test playwright/tests/realtime-poll-live.spec.ts`.
  The spec uses the default config, starts API and web for
  `TEST_ENV=local`, and skips automatically if the endpoint is
  unreachable.

## Directory layout

```text
playwright/
├── tests/                  # Specs using merged fixtures
├── config/                 # Base + environment-specific Playwright configs
├── support/
│   ├── config/             # Environment map + shared constants
│   ├── fixtures/           # mergeTests-based fixtures
│   └── helpers/            # Project helpers + factories
└── README.md               # This file
```

## Starting local services

- `npm run start:all` spins up both the NestJS API
  (`npm run start:api`) and the built Next.js site
  (`npm run start:web`) just like the Playwright `webServer` hook.
  Use it when you want to inspect the smoke environment manually before
  or after running `npm run test:pw-local`.

## Real-session community E2E

`tests/community-real-session.spec.ts` and
`tests/community-real-session-identity.spec.ts` sign in through the product
sign-in UI with a real local Supabase Auth OTP: real `verifyOtp`, refresh,
account switch, offline sign-out and the identity-mapping denials. They skip in
every normal run, because they need a stack nothing else starts.
`scripts/e2e-real-session/run.mjs` owns that stack:

1. An isolated `tea_community_<32 hex>` database on the local Supabase Postgres,
   bootstrapped like `apps/api/integration/helpers/isolated-community-database.ts`.
   The default `postgres` database is never written, so no reset is involved.
2. The OTP Auth proxy (`auth-proxy.mjs`, port 53051). It forwards every Auth call
   to local Supabase Auth and issues an OTP only for an address the specs recorded
   in `created-identities.json`. In `generated` mode it mints the code with the
   Auth Admin API into a 0700 temp directory; in `real-email` mode local Auth
   sends a real email and the spec reads the code from Mailpit (54324).
3. A web build with `NEXT_PUBLIC_E2E_AUTH=false` and the proxy as its Supabase
   URL, in `apps/web/.next-real-session` so the fixture-auth build stays intact,
   served on `127.0.0.1:3077`.
4. The API stack (`scripts/start-api-e2e-with-workers.mjs`) on `127.0.0.1:4077`
   against the isolated database: migrate deploy, seed, API and both workers.
5. Playwright through `config/real-session.config.ts`: these two specs only, one
   worker, no retries, no web server, no global setup or teardown, and no
   trace, video, screenshot or HTML report. Output is held until the Supabase
   keys, every OTP code and anything shaped like a JWT are redacted.
6. Always, at the end: the Auth users the run recorded are deleted
   (`cleanup-users.mjs`, which refuses to delete anything if a recorded row is
   not a `story65-real-<uuid>@example.test` user), every process stops, the
   artifacts are redacted and the database is dropped.

CI runs it as the **Real-session community E2E** job in
`.github/workflows/pr-pw-e2e-local.yml`, on the same commits as the local
Playwright lane. The job starts Supabase with Mailpit included, sets
`STORY65_REAL_SESSION_OTP_MODE=real-email` (a Mailpit that did not start fails
the run instead of downgrading it), prints the mode in its log and step
summary, runs `cleanup-users.mjs` again in an `always()` step, scans the
artifacts with `scripts/check-artifact-secrets.mjs` and uploads them as
`real-session-e2e`. PR Gate picks the job up like every other check.

To run it locally:

```bash
npm run supabase:start   # Mailpit included; or set STORY65_REAL_SESSION_OTP_MODE=generated
docker run -d --rm --name real-session-redis -p 127.0.0.1:6390:6379 redis:7-alpine
REDIS_URL=redis://127.0.0.1:6390 npm run test:pw-real-session
docker stop real-session-redis
```

Ports 4077, 3077, 4087 and 53051 must be free. Pass `-- --skip-web-build` to
reuse the last real-auth web build, and any Playwright arguments after `--`.
State lives in `.real-session-e2e/` (or `STORY65_REAL_SESSION_DIR`); only its
`artifacts/` folder holds redacted output. The run reads the Supabase URL and keys
from `supabase status` when the shell does not export them, and refuses a
non-local Supabase, Postgres or Redis.

## Fixture set (merge-friendly)

- `support/fixtures/api-client.ts`: wraps the pure `apiRequest` helper
  and injects Playwright's `APIRequestContext`, defaulting to the
  `apiBaseUrl` for the active environment.
- `support/fixtures/network.ts`: implements the network-first
  safeguards with route-before-action registration, promise-based
  waits, and automatic cleanup.
- `support/fixtures/auth.ts`: shared login and logout helpers that read
  default credentials from `.env` and keep selectors wired to
  `data-testid`.
- `support/fixtures/merged-fixtures.ts`: composes the base test,
  exposes `test` and `expect`, and keeps fixture imports ergonomic.

## Auth-session

Auth-session is part of `support/fixtures/merged-fixtures.ts`; use the standard
`test` import. Override `authOptions.userIdentifier` only when a spec needs a
different persisted user.

Use `authSessionEnabled: false` only for signed-out browser assertions or specs
that intentionally manage browser auth themselves. Add a short local comment
when disabling it.

Local runs synthesize `.auth/<environment>/<userIdentifier>/storage-state.json`.
Add a real provider before enabling auth-session outside `TEST_ENV=local`.

## Helpers + factories

- `support/helpers/api-client.ts`: pure function for HTTP verbs that
  returns structured responses and surfaces failures with body
  snippets.
- `support/helpers/factories/user.ts`: Faker-driven factories with
  overrides and cleanup hooks so specs never rely on static fixtures.
- Extend this folder with additional domain entities such as outfits
  and wardrobes before specs need them.

## Environment management

- `support/config/environments.ts` centralizes environment metadata for
  web and API origins, auth defaults, and headers.
- `TEST_ENV` chooses between `local`, `preview`, and `prod`; missing or
  invalid values throw early.
- `.env` holds all environment URLs and credentials so helpers and
  fixtures remain stateless functional helpers.

## Reporting + artifacts

- `playwright/artifacts/` collects traces, screenshots, and JUnit XML
  for CI upload.
- `playwright/playwright-report/` stores HTML reports.
  `npm run test:pw-local` prints the path when failures occur.

## Next steps

- Wire the Playwright job into CI via the upcoming `*ci` workflow with
  a dedicated job, Node 24 image, and cached
  `npx playwright install --with-deps`.
- Decide when to broaden coverage to Firefox and WebKit. The config
  currently pins Chromium while we stabilize Story 13 deliverables.

## Shared package alignment

- Network interception, logging, recursion, file utilities, schema
  validation, and API request fixtures already come from
  `@seontechnologies/playwright-utils` via
  `support/fixtures/merged-fixtures.ts`.
- Keep `playwright/support/helpers/**` reserved for project-specific
  helpers only. If a helper duplicates the shared package, remove the
  local copy instead of maintaining a fork.
