# Couture Cast Monorepo

![statements](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/muratkeremozcan/64348ebdc6e662b93ade9f40bdc03442/raw/couture-cast-statements.json)
![branches](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/muratkeremozcan/64348ebdc6e662b93ade9f40bdc03442/raw/couture-cast-branches.json)
![functions](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/muratkeremozcan/64348ebdc6e662b93ade9f40bdc03442/raw/couture-cast-functions.json)
![lines](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/muratkeremozcan/64348ebdc6e662b93ade9f40bdc03442/raw/couture-cast-lines.json)

Thin Turborepo for Couture Cast apps and smoke tests. Keep it lean: shared lint config, root Playwright, and a minimal Maestro sanity.

> **Usage notice:** All rights reserved. No use, reproduction, or distribution without explicit permission from Couture Cast authors.

## Prerequisites

| Tool               | Required version    | Notes                                                                                               |
| ------------------ | ------------------- | --------------------------------------------------------------------------------------------------- |
| Node.js            | 24.x (per `.nvmrc`) | `nvm install 24 && nvm use 24` keeps local dev aligned with the repo’s engines field and CI images. |
| npm                | 10.5.3+             | Bundled with Node 24; verify via `npm --version`.                                                   |
| Expo Go (optional) | Latest store build  | Handy for validating `apps/mobile` during `npm run dev`.                                            |

> CI runs on Node 24 to match `.nvmrc`. Use that baseline unless an architecture decision explicitly requests a lower version.
> `npm install` now fails fast if your active Node major version does not match `.nvmrc`,
> so setup errors surface before workspace scripts drift.

## Repository layout

| Path                     | Purpose                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `apps/web`               | Next.js 15.5.6 App Router surface (React 19.1).                                                            |
| `apps/mobile`            | Expo Router SDK 54 project (tabs template, React Native 0.81).                                             |
| `apps/api`               | NestJS 11 monolith wired to Vitest 4.                                                                      |
| `maestro/`               | Minimal Maestro smoke flow for mobile sanity checks (URL load + screenshot).                               |
| `playwright/`            | Root-level Playwright smoke suite (fixtures + README) shared by web + API teams.                           |
| `playwright/scripts`     | Utility scripts for Playwright (burn-in variants).                                                         |
| `packages/eslint-config` | Shared ESLint config consumed across workspaces.                                                           |
| `.github/workflows`      | GitHub Actions quality gates (PR checks, Playwright E2E with burn-in, Vercel Preview smoke).               |
| `_bmad-output/`          | Product knowledge plus planning, implementation, and test artifacts—**source of truth** for what we build. |
| `docs/`                  | Lightweight compatibility pointer to `_bmad-output/`.                                                      |

## Getting started

```bash
nvm use 24        # installs via `nvm install 24` the first time
npm install
npm run dev       # turbo spins up mobile, web, and api concurrently
```

### Mobile Testing

**CI**: Mobile e2e is disabled on GitHub-hosted runners due to emulator instability and long runtimes. Use self-hosted/device cloud or trigger the manual workflow if needed.

**Local**: iOS + Android testing supported (see `npm run test:mobile:e2e` and \_bmad-output/implementation-artifacts/0-13-scaffold-cross-surface-e2e-automation.md)

```bash
npm run dev        # Turborepo parallel dev servers (Expo / Next / Nest)
npm run build      # Build graph-respecting artifacts (.next, dist, etc.)
npm run typecheck  # TypeScript project references across every workspace

# optional: clear ts build caches when switching branches
npm run typecheck:clear-cache
```

| Command                                   | What it does                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | Runs all workspace `dev` scripts via Turborepo (parallel).                                                                                      |
| `npm run build`                           | Builds all workspaces respecting dependency graph.                                                                                              |
| `npm run verify:api`                      | Runs API lint, typecheck, tests, and build in sequence without the API lint step auto-fixing files.                                             |
| `npm run verify:web`                      | Runs web lint, typecheck, tests, and build in sequence.                                                                                         |
| `npm run verify:mobile`                   | Runs mobile lint, typecheck, and tests in sequence; mobile has no workspace build script.                                                       |
| `npm run verify:changed`                  | Detects changed workspaces from the working tree via `git status` and runs each workspace’s local non-E2E gate, including build when available. |
| `npm run verify:changed:list`             | Prints which workspaces `verify:changed` would verify, without running the checks.                                                              |
| `npm run typecheck`                       | Composite TypeScript check (per package via Turborepo).                                                                                         |
| `npm run typecheck:clear-cache`           | Deletes `*.tsbuildinfo` + TS cache folders.                                                                                                     |
| `npm run lint`                            | Runs all workspace lint targets, shared root config, and a Prettier check for `_bmad-output`/config.                                            |
| `npm run lint:fix`                        | Runs lint across workspaces + root with `--fix`, then formats via Prettier.                                                                     |
| `npm run lint:staged`                     | Lints + formats staged files via `lint-staged`. Wire into your git hooks if desired.                                                            |
| `npm run generate:http-openapi`           | Regenerates the canonical HTTP OpenAPI spec at `packages/api-client/docs/http.openapi.json` from shared Zod contracts.                          |
| `npm run generate:api-client`             | Regenerates the canonical HTTP OpenAPI spec, then rebuilds the generated TypeScript SDK surface.                                                |
| `npm run optic:lint`                      | Validates the checked-in canonical HTTP OpenAPI spec with Optic.                                                                                |
| `npm run optic:diff`                      | Compares the canonical HTTP OpenAPI spec against `main` and fails on breaking changes unless versioning is explicit.                            |
| `npm run start:web`                       | Starts the built Next.js app on port 3005 (used by Playwright’s webServer hook).                                                                |
| `npm run start:api`                       | Runs `db:generate` + Prisma migrate deploy, then starts Nest API in watch mode on port 4000.                                                    |
| `npm run start:mobile:server`             | Starts Expo dev server on 19000/19001 for Maestro smoke runs.                                                                                   |
| `npm run start:mobile:e2e`                | One-shot mobile smoke: boots a simulator (android→iOS), starts Expo, runs Maestro.                                                              |
| `npm run mobile:sim:ios`                  | Boots the default iOS simulator (`IOS_SIM_DEVICE` override) and shows booted devices.                                                           |
| `npm run mobile:sim:android`              | Boots the default Android AVD (`AVD_NAME` override) and waits for `adb` ready.                                                                  |
| `npm run mobile:device`                   | Convenience opener for a simulator/emulator (launch one manually if this no-ops).                                                               |
| `npm run mobile:expo-go`                  | Installs Expo Go APK onto the connected emulator/device.                                                                                        |
| `npm run start:all`                       | Starts both API + web servers concurrently (mirrors Playwright’s `webServer` config).                                                           |
| `npm run test:pw-local`                   | Convenience wrapper that sets `TEST_ENV=local` and runs the smoke suite.                                                                        |
| `npm run test:pw-preview`                 | Targets the current Vercel Preview deployment (`TEST_ENV=preview`).                                                                             |
| `npm run test:pw-prod`                    | Targets the prod deployment (`TEST_ENV=prod`).                                                                                                  |
| `npm run test:pw:burn-in`                 | Burn-in all specs locally (`PW_BURN_IN=true`, repeat-each=3, retries=0).                                                                        |
| `npm run test:pw:burn-in-changed-classic` | Playwright built-in `--only-changed` burn-in vs main (3x, retries=0) — can overrun.                                                             |
| `npm run test:pw:burn-in-changed`         | Smart burn-in via `@seontechnologies/playwright-utils` (config-driven, respects skip/percentage).                                               |
| `npm run maestro:install`                 | Installs the Maestro CLI (brew/curl on macOS; npx fallback on CI).                                                                              |
| `npm run test:mobile:e2e`                 | Starts Expo (if needed) and runs the Maestro smoke flow against the dev server it spawns.                                                       |
| `npm run test:mobile:e2e:ios`             | Boots the default iOS simulator and runs the Maestro smoke flow against Expo dev server.                                                        |
| `npm run validate`                        | Runs `typecheck`, then `lint`, then `test`, then `build` sequentially. This is the full local non-E2E gate.                                     |
| `npm run clean`                           | Cleans each workspace’s build outputs.                                                                                                          |
| `npm run clean:install`                   | Nukes every `node_modules` (root/apps/packages) and performs a fresh `npm install`.                                                             |
| `npm run db:migrate`                      | Runs Prisma migrate in `packages/db` (requires `DATABASE_URL`).                                                                                 |
| `npm run db:seed`                         | Runs Prisma seed in `packages/db` (requires `DATABASE_URL`).                                                                                    |
| `npm run db:reset`                        | Resets DB (migrate reset + seed) in `packages/db` (requires `DATABASE_URL`).                                                                    |
| `npm run supabase:start`                  | Starts local Supabase stack (Postgres/auth/storage/Studio) via Docker.                                                                          |
| `npm run supabase:stop`                   | Stops the local Supabase stack.                                                                                                                 |

> `npm run verify:changed` is implemented in [scripts/verify-changed.mjs](scripts/verify-changed.mjs) and
> uses `git status` on the working tree. It does not compare your current branch against `main`
> or another base branch, so committed-only branch diffs are intentionally out of scope.

> Pre-commit guardrails: `.husky/pre-commit` already runs `npm run lint` and `npm run lint:staged`. Extend that file if you need extra checks.

### Database (Prisma)

Environment for DB scripts:

- set `DATABASE_URL` (e.g., `postgresql://murat@localhost:5432/couture_cast?schema=public`)
- ensure Postgres is running (macOS: `brew services start postgresql@15`)
- if needed locally, add `PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"` when running scripts

Local E2E with clean DB:

1. `PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH" DATABASE_URL=... npm run db:reset`
2. `npm run test:pw-local`
3. optional cleanup after tests: `npm run db:reset`

### Supabase vs Prisma/db scripts (short version)

- Supabase CLI (`npm run supabase:start/stop`) brings up the local stack (Postgres + auth + storage + Studio) via Docker.
- Prisma and the `db:*` scripts still own schema/migrations/seeds; Supabase is just the Postgres host (local via CLI, cloud via project refs).
- Env files: `.env.local` for local Supabase, `.env.preview`/`.env.prod` for cloud. Playwright auto-loads `.env.<TEST_ENV>` if present.

### Queues & cache (BullMQ/Redis)

- Upstash: managed Redis for Preview/Production; we use it to back BullMQ queues and the cache without running our own Redis in cloud environments.
- Why: Offload slow/CPU-bound or rate-limited work (weather ingest, alert fan-out, color extraction, moderation) from HTTP requests; retry with backoff; keep a dead-letter trail.
- Components: BullMQ queues/workers using Redis; DLQ persisted to Postgres (`job_failures`); Redis cache for short-lived personalization payloads.
- Local: `docker-compose up redis` then `npm run start:workers` (apps/api) to run workers. Redis defaults to `redis://localhost:6379` (see `.env.example`).
- Cloud: Upstash Redis for Preview/Production (`REDIS_URL`, `REDIS_TLS=true`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`); store real tokens in gitignored env files and CI/deployment secret stores.

### Common local flow (DX)

1. Start app services: `npm run start:all` (API + web).
2. Start local Supabase: `npm run supabase:start` (Docker; first run pulls images).
3. Env: set `TEST_ENV=local` (Playwright uses `.env.local`) or copy `.env.local` → `.env`.
4. Run tests: `npm run test:pw-local`.
5. Schema changes: use Prisma (`db:migrate`/`db:seed`), then `supabase db push --local` to sync into the local Supabase DB. Push to the Preview cloud project later via `supabase db push`.

## E2E smoke (Playwright + Maestro)

**One-time setup:** https://github.com/murat/opensource/couture-cast/blob/main/_bmad-output/implementation-artifacts/0-13-scaffold-cross-surface-e2e-automation.md#maestro-setup--operational-notes

- Xcode + CLI tools on macOS (`sudo xcode-select --switch /Applications/Xcode.app`).
- Android Studio SDK + AVD (e.g., Pixel 8 API 34) booted once.
- Install Maestro CLI: `npm run maestro:install --silent`.
- Install Expo Go on your emulator: boot it, then `npm run mobile:expo-go`.

**Per-run defaults:** web `http://localhost:3005`, API `http://localhost:4000`, Expo `exp://127.0.0.1:8081/--/`.

- Web smoke: `npm run test:pw-local` (overrides: `WEB_E2E_BASE_URL`, `API_BASE_URL`, `TEST_ENV`).
- Mobile smoke: `npm run start:mobile:e2e` (one-shot: boots simulator, starts Expo if needed, runs Maestro).  
  Overrides: `AVD_NAME`, `IOS_SIM_DEVICE`, `MOBILE_E2E_APP_URL`, `MOBILE_E2E_HEALTH_URL`, `MAESTRO_DEVICE`, `MAESTRO_CLOUD_*`.

### Mobile build/deploy (Expo EAS)

- Scripts (Android-only):
  - `npm run mobile:build` → EAS build `--profile production --platform android`
  - `npm run mobile:submit` → EAS submit `--platform android` (non-interactive; requires Play Console creds configured)
- CI workflow: `.github/workflows/deploy-mobile.yml` is manual (`workflow_dispatch` only), Android-only. Requires `EXPO_TOKEN` secret.
- Credentials:
  - Expo access token: create in Expo UI (Account → Access Tokens) → set `EXPO_TOKEN` locally/CI.
  - Android keystore already generated via `eas credentials:configure-build --platform android --profile production`.
  - iOS disabled until Apple Developer enrollment and Apple credentials are set up. When ready for iOS: enroll in Apple Developer Program, run one interactive `eas build --profile production --platform ios` to create certs/profiles, then you can flip scripts/workflow back to `--platform all` for dual-platform builds.
- After a build: download from the EAS dashboard or run `npm run mobile:submit` if Play Store creds are in place; otherwise upload manually to Play Console.

## Quality & CI alignment

- `.nvmrc` pins Node 24, matching `actions/setup-node` in `.github/workflows/pr-checks.yml`.
- ESLint, Prettier, and `lint-staged` configs match the reference repo’s rules (no-only-tests, consistent type imports, formatting).
- `_bmad-output/planning-artifacts/epics.md` Epic 0 stories describe these guardrails explicitly so all Sprint 0 tasks stay tied to product strategy.
- CI currently executes: install → schema validation for the canonical HTTP OpenAPI spec → typecheck → lint (workspace + root) → build → tests. Burn-in/Selective runners plug into the same workflow after CC-0.6.

### API contract tooling

- Public HTTP contracts are generated from shared Zod schemas under `packages/api-client/src/contracts/http/`.
- `npm run generate:http-openapi` rewrites the canonical checked-in contract file at `packages/api-client/docs/http.openapi.json`.
- `npm run optic:lint` and `npm run optic:diff` operate on that same canonical file; they do not require a manually running API server.
- A breaking contract change is expected to be paired with an explicit versioning decision before merge.

### CI at a glance

| Workflow                                         | What it runs                                          | Notes                                                                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/schema-validation.yml`        | Canonical OpenAPI generation + Optic lint/diff        | Separate schema gate modeled after the reference repo. Generates `packages/api-client/docs/http.openapi.json`, fetches `main`, then runs Optic.     |
| `.github/workflows/pr-checks.yml`                | Typecheck → Lint → Build → Tests (workspace graph)    | Required on PRs; matches Node 24 baseline.                                                                                                          |
| `.github/workflows/pr-pw-e2e-local.yml`          | Playwright smoke (Chromium) with HTML/trace artifacts | Web-only e2e gate; uses webServer hook on port 3005.                                                                                                |
| `.github/workflows/pr-pw-e2e-vercel-preview.yml` | Playwright smoke against Vercel Preview               | Triggered by Vercel `deployment_status`; runs `npm run test:pw-preview` against the Preview URL via `PREVIEW_WEB_E2E_BASE_URL`.                     |
| `.github/workflows/pr-mobile-e2e.yml`            | Manual-only Maestro Android smoke (build + emulator)  | Not run on PRs: GitHub-hosted Android emulators are slow/flaky (30–40m, boot failures). Trigger via `workflow_dispatch` or run locally/self-hosted. |

**Playwright coverage:** web landing smoke with API health ping, hero/nav assertions, axe-core check, traces/artifacts uploaded in CI.  
**Mobile e2e:** Maestro sanity (Expo tabs) is local-only; CI disabled due to GitHub-hosted emulator instability and long runtimes. Run via `npm run test:mobile:e2e` on your machine or on a self-hosted/device cloud runner if needed.

### Vercel Preview testing

On our current Vercel setup (Hobby plan), `main` is the Production branch and PR branches get Preview deployments. In CI, `pr-pw-e2e-vercel-preview.yml` reads the Preview URL from the GitHub `deployment_status` event and sets `PREVIEW_WEB_E2E_BASE_URL`, so `npm run test:pw-preview` runs against that Preview deployment.

If your Preview deployments are protected (health check returns 401), set `VERCEL_AUTOMATION_BYPASS_SECRET` locally (in `.env.preview`) and
in CI (GitHub repo secret). See `_bmad-output/test-artifacts/ci-cd-pipeline.md`.

#### Local Preview testing

`npm run test:pw-preview` automatically resolves Preview URLs and runs Playwright against them. The resolution chain:

1. **Manual override** (highest priority): Set `PREVIEW_WEB_E2E_BASE_URL` and/or `PREVIEW_API_BASE_URL` in `.env.preview`
2. **Vercel REST API**: Queries Vercel deployments API for your branch's latest READY deployment
3. **GitHub Deployments API**: Queries GitHub for deployment URLs (fallback if Vercel API fails)
4. **Deterministic URL**: Constructs `https://{project}-git-{branch-slug}-{team}.vercel.app` as last resort

**Prerequisites for automatic resolution:**

- Branch is pushed to GitHub (Vercel needs to create deployments)
- `gh` CLI installed and authenticated (`gh auth status`)
- `.env.preview` with Vercel access:
  ```bash
  VERCEL_TOKEN=your_token_here                          # Team token from Vercel dashboard
  VERCEL_WEB_PROJECT_SLUG=couture-cast-web              # Web app project
  VERCEL_API_PROJECT_SLUG=couture-cast-api              # API project (separate deployment)
  VERCEL_TEAM_SLUG=muratkeremozcans-projects            # Team slug
  VERCEL_AUTOMATION_BYPASS_SECRET=your_bypass_secret    # For protected previews
  ```

**Note:** Web and API have separate Vercel projects with different deployment URLs (different hashes). The scripts query both projects independently via REST API.

**Manual override (when auto-resolution fails):**

```bash
# Find your Preview URLs in Vercel dashboard → Deployments, then:
echo 'PREVIEW_WEB_E2E_BASE_URL=https://couture-cast-web-git-...' >> .env.preview
echo 'PREVIEW_API_BASE_URL=https://couture-cast-api-git-...' >> .env.preview
npm run test:pw-preview
```

**Troubleshooting preview URL resolution:**

| Problem                                  | Solution                                                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"No deployment found"**                | Push your branch first! Vercel only creates deployments for pushed branches. `git push` then wait ~30s for Vercel to build.                                                       |
| **404 / DEPLOYMENT_NOT_FOUND**           | The resolved URL points to an old/deleted deployment. Check Vercel dashboard → find your branch → copy the actual Preview URL → set `PREVIEW_WEB_E2E_BASE_URL` manually.          |
| **403 Forbidden from Vercel API**        | `VERCEL_TOKEN` doesn't have team access. Create a new token in Vercel dashboard → Team Settings → Tokens (not personal tokens).                                                   |
| **ENOTFOUND / DNS errors**               | URL is wrong or deployment doesn't exist. Verify the URL in your browser first. Check branch name matches (slugified: `test/foo` → `test-foo`).                                   |
| **"Could not resolve team ID"**          | `VERCEL_TEAM_SLUG` is wrong or token lacks access. Verify slug matches your Vercel team URL: `vercel.com/teams/<this-slug>`.                                                      |
| **Tests run but hit wrong deployment**   | Scripts might be using cached/fallback URLs. Run with `DEBUG=true node scripts/resolve-vercel-preview-url.mjs` to see what's happening. If it returns garbage, set URLs manually. |
| **"Unknown option: --json" (old error)** | You're running old script version. Pull latest changes: `git pull origin main`.                                                                                                   |

**Quick bypass (when you just want to run tests):**

```bash
# Open Vercel dashboard, find your Preview URLs, then:
PREVIEW_WEB_E2E_BASE_URL=https://your-web-url.vercel.app \
PREVIEW_API_BASE_URL=https://your-api-url.vercel.app \
npm run test:pw-preview
```

## Helpful references

- [\_bmad-output/project-knowledge/couturecast_brief.md](_bmad-output/project-knowledge/couturecast_brief.md) for positioning & personas.
- [\_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) for Epic 0 (platform enablement) + feature backlogs.
- [`playwright-utils` repo](../playwright-utils) if you need deeper examples of test tooling wiring.

Questions? Tag Murat (TEA) for quality gates or Amelia (dev agent) for implementation details.
