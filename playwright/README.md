# Playwright smoke suite

Updated: 2025-11-17 — Initial Playwright framework scaffolding for Story 13 (anchored at repo root to serve multiple projects including NestJS API E2E coverage).

## Tooling baseline

- Node 24.x everywhere (`.nvmrc` enforces it); run `nvm use` before installing dependencies.
- Core dev deps live at the repo root so every workspace consumes the same Playwright, Faker, Dotenv, and TSX versions.
- `npx playwright install --with-deps` must run once per machine/CI runner to download the browsers declared in `playwright.config.ts`.

## Quick start

1. `nvm use && npm install`
2. `cp .env.example .env` and add secrets (only `SUPABASE_SERVICE_ROLE_KEY` needed; all URLs/credentials are in code at `playwright/support/config/environments.ts`)
3. `npx playwright install --with-deps`
4. `npm run test:pw-local` (automatically sets `TEST_ENV=local`)
5. Use the other helpers—`npm run test:pw-dev` or `npm run test:pw-prod`—when remote deployments are ready, or run `TEST_ENV=<env> npm run test:pw` directly to target a custom environment.

Recent additions:

- Playwright-utils fixtures are now merged into `support/fixtures/merged-fixtures.ts` (adds `interceptNetworkCall`, `recurse`, `log`, `networkRecorder`, etc.).
- New realtime fallback check: `npm run test:pw-local -- playwright/tests/realtime-fallback.spec.ts` covers disconnect → polling → reconnect (P1).
- Live poll endpoint check: set `LIVE_POLL_BASE_URL=https://<api-host>` (or rely on local webServer auto-start) and run `npx playwright test playwright/tests/realtime-poll-live.spec.ts`; the spec uses the default config (starts API/web for TEST_ENV=local) and skips automatically if the endpoint is unreachable.

## Directory layout

```
playwright/
├── tests/                  # Specs (import fixtures from support/fixtures/merged-fixtures)
├── config/                 # Base + environment-specific Playwright configs
├── support/
│   ├── config/             # Environment map + shared constants
│   ├── fixtures/           # mergeTests-based fixtures (auth, apiClient, network, etc.)
│   └── helpers/            # Pure helper functions + factories (Faker-powered data, API utils)
└── README.md               # This file
```

## Starting local services

- `npm run start:all` spins up both the NestJS API (`npm run start:api`) and the built Next.js site (`npm run start:web`) just like the Playwright `webServer` hook does. Use it when you want to poke around the smoke environment manually before or after running `npm run test:pw-local`.

## Fixture set (merge-friendly)

- `support/fixtures/api-client.ts`: wraps the pure `apiRequest` helper and injects Playwright's `APIRequestContext`, defaulting to the `apiBaseUrl` for the active environment.
- `support/fixtures/network.ts`: implements the network-first safeguards (register route before action, promise-based waits, automatic cleanup).
- `support/fixtures/auth.ts`: shared login/logout helpers that read default credentials from `.env` and keep selectors wired to `data-testid`.
- `support/fixtures/merged-fixtures.ts`: composes the base test, exposes `test`/`expect`, and keeps fixture imports ergonomic.

## Helpers + factories

- `support/helpers/api-client.ts`: pure function for HTTP verbs that returns structured responses and surfaces failures with body snippets.
- `support/helpers/intercept-network.ts`: composable helper (ported from the internal Playwright utils repo) that observes or fulfills requests with glob/RegExp matching and response capture.
- `support/helpers/factories/user.ts`: Faker-driven factories with overrides + cleanup hooks so specs never rely on static fixtures.
- Extend this folder with additional domain entities (e.g., outfits, wardrobes) before specs need them.

## Environment management

- `support/config/environments.ts` centralizes environment metadata (web/API origins, auth defaults, headers).
- `TEST_ENV` chooses between `local`, `dev`, and `prod`; missing or invalid values throw early.
- `.env` holds all environment URLs + credentials so helpers/fixtures remain stateless functional helpers.

## Reporting + artifacts

- `playwright/artifacts/` collects traces, screenshots, and JUnit XML for CI upload.
- `playwright/playwright-report/` stores HTML reports (`npm run test:pw-local` prints the path when failures occur).

## Next steps

- Wire the Playwright job into CI via the upcoming `*ci` workflow (dedicated job, Node 24 image, `npx playwright install --with-deps` cache).
- Decide when to broaden coverage to Firefox/WebKit; config currently pins Chromium while we stabilize Story 13 deliverables.

## Future migration to playwright-utils

- If the internal `seontechnologies-playwright-utils` package becomes open source, we can replace the locally copied helpers (`support/helpers/api-client.ts`, `support/helpers/intercept-network.ts`, fixture compositions) with the upstream exports.
- Migration path:
  1. Add the published package to root `devDependencies`.
  2. Remove local helper implementations in `playwright/support/helpers/**` that duplicate the library.
  3. Update fixtures (e.g., `network.ts`, `api-client.ts`) to re-export the library’s fixtures/helpers instead of the local versions.
  4. Keep `playwright/README.md` updated so contributors know whether helpers are sourced locally or from the shared package.
