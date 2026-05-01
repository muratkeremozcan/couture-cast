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
2. `cp .env.example .env` and add secrets. Only
   `SUPABASE_SERVICE_ROLE_KEY` is needed; all URLs and credentials are
   in `playwright/support/config/environments.ts`.
3. `npx playwright install --with-deps`
4. `npm run test:pw-local` (automatically sets `TEST_ENV=local`)
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
