# Couture Cast Monorepo

Thin Turborepo for Couture Cast apps and smoke tests. Keep it lean: shared lint config, root Playwright, and a minimal Maestro sanity.

## Prerequisites

| Tool               | Required version    | Notes                                                                                               |
| ------------------ | ------------------- | --------------------------------------------------------------------------------------------------- |
| Node.js            | 24.x (per `.nvmrc`) | `nvm install 24 && nvm use 24` keeps local dev aligned with the repo’s engines field and CI images. |
| npm                | 10.5.3+             | Bundled with Node 24; verify via `npm --version`.                                                   |
| Expo Go (optional) | Latest store build  | Handy for validating `apps/mobile` during `npm run dev`.                                            |

> CI runs on Node 24 to match `.nvmrc`. Use that baseline unless an architecture decision explicitly requests a lower version.

## Repository layout

| Path                     | Purpose                                                                           |
| ------------------------ | --------------------------------------------------------------------------------- |
| `apps/web`               | Next.js 15.5.6 App Router surface (React 19.1).                                   |
| `apps/mobile`            | Expo Router SDK 54 project (tabs template, React Native 0.81).                    |
| `apps/api`               | NestJS 11 monolith wired to Vitest 4.                                             |
| `maestro/`               | Minimal Maestro smoke flow for mobile sanity checks (URL load + screenshot).      |
| `playwright/`            | Root-level Playwright smoke suite (fixtures + README) shared by web + API teams.  |
| `packages/eslint-config` | Shared ESLint config consumed across workspaces.                                  |
| `.github/workflows`      | GitHub Actions quality gates (PR checks today, burn-in soon).                     |
| `docs/`                  | Product brief, architecture, epics/stories—**source of truth** for what we build. |

## Getting started

```bash
nvm use 24        # installs via `nvm install 24` the first time
npm install
npm run dev       # turbo spins up mobile, web, and api concurrently
```

### Mobile Testing

**CI**: Mobile e2e is disabled on GitHub-hosted runners due to emulator instability and long runtimes. Use self-hosted/device cloud or trigger the manual workflow if needed.

**Local**: iOS + Android testing supported (see `npm run test:mobile:e2e` and docs/sprint-artifacts/0-13-scaffold-cross-surface-e2e-automation.md)

```bash
npm run dev        # Turborepo parallel dev servers (Expo / Next / Nest)
npm run build      # Build graph-respecting artifacts (.next, dist, etc.)
npm run typecheck  # TypeScript project references across every workspace

# optional: clear ts build caches when switching branches
npm run typecheck:clear-cache
```

| Command                            | What it does                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run dev`                      | Runs all workspace `dev` scripts via Turborepo (parallel).                                 |
| `npm run build`                    | Builds all workspaces respecting dependency graph.                                         |
| `npm run typecheck`                | Composite TypeScript check (per package via Turborepo).                                    |
| `npm run typecheck:clear-cache`    | Deletes `*.tsbuildinfo` + TS cache folders.                                                |
| `npm run lint`                     | Runs all workspace lint targets, shared root config, and a Prettier check for docs/config. |
| `npm run lint:fix`                 | Runs lint across workspaces + root with `--fix`, then formats via Prettier.                |
| `npm run lint:staged`              | Lints + formats staged files via `lint-staged`. Wire into your git hooks if desired.       |
| `npm run start:web`                | Starts the built Next.js app on port 3005 (used by Playwright’s webServer hook).           |
| `npm run start:api`                | Boots the NestJS API in watch mode so local smoke tests can exercise server flows.         |
| `npm run start:mobile:server`      | Starts Expo dev server on 19000/19001 for Maestro smoke runs.                              |
| `npm run start:mobile:e2e`         | One-shot mobile smoke: boots a simulator (android→iOS), starts Expo, runs Maestro.         |
| `npm run mobile:sim:ios`           | Boots the default iOS simulator (`IOS_SIM_DEVICE` override) and shows booted devices.      |
| `npm run mobile:sim:android`       | Boots the default Android AVD (`AVD_NAME` override) and waits for `adb` ready.             |
| `npm run mobile:device`            | Convenience opener for a simulator/emulator (launch one manually if this no-ops).          |
| `npm run mobile:expo-go`           | Installs Expo Go APK onto the connected emulator/device.                                   |
| `npm run start:all`                | Starts both API + web servers concurrently (mirrors Playwright’s `webServer` config).      |
| `npm run test:pw`                  | Runs the Playwright smoke suite using the current `TEST_ENV` (defaults to `local`).        |
| `npm run test:pw-local`            | Convenience wrapper that sets `TEST_ENV=local` and runs the smoke suite.                   |
| `npm run test:pw-dev`              | Targets the dev deployment (`TEST_ENV=dev`).                                               |
| `npm run test:pw-stage`            | Targets the stage deployment (`TEST_ENV=stage`).                                           |
| `npm run test:pw-prod`             | Targets the prod deployment (`TEST_ENV=prod`).                                             |
| `npm run maestro:install`          | Installs the Maestro CLI (brew/curl on macOS; npx fallback on CI).                         |
| `npm run test:mobile:e2e`          | Starts Expo (if needed) and runs the Maestro smoke flow against the dev server it spawns.  |
| `npm run test:mobile:e2e:ios`      | Boots the default iOS simulator and runs the Maestro smoke flow against Expo dev server.   |
| `npm run validate`                 | Runs typecheck, lint (workspace + root), and tests in parallel—reference flow.             |
| `npm run clean`                    | Cleans each workspace’s build outputs.                                                     |
| `npm run clean:install`            | Nukes every `node_modules` (root/apps/packages) and performs a fresh `npm install`.        |

> Pre-commit guardrails: `.husky/pre-commit` already runs `npm run lint` and `npm run lint:staged`. Extend that file if you need extra checks.

## E2E smoke (Playwright + Maestro)

**One-time setup:** https://github.com/murat/opensource/couture-cast/blob/main/docs/sprint-artifacts/0-13-scaffold-cross-surface-e2e-automation.md#maestro-setup--operational-notes

- Xcode + CLI tools on macOS (`sudo xcode-select --switch /Applications/Xcode.app`).
- Android Studio SDK + AVD (e.g., Pixel 8 API 34) booted once.
- Install Maestro CLI: `npm run maestro:install --silent`.
- Install Expo Go on your emulator: boot it, then `npm run mobile:expo-go`.

**Per-run defaults:** web `http://localhost:3005`, API `http://localhost:4000`, Expo `exp://127.0.0.1:8081/--/`.

- Web smoke: `npm run test:pw-local` (overrides: `WEB_E2E_BASE_URL`, `API_BASE_URL`, `TEST_ENV`).
- Mobile smoke: `npm run start:mobile:e2e` (one-shot: boots simulator, starts Expo if needed, runs Maestro).  
  Overrides: `AVD_NAME`, `IOS_SIM_DEVICE`, `MOBILE_E2E_APP_URL`, `MOBILE_E2E_HEALTH_URL`, `MAESTRO_DEVICE`, `MAESTRO_CLOUD_*`.

## Quality & CI alignment

- `.nvmrc` pins Node 24, matching `actions/setup-node` in `.github/workflows/pr-checks.yml`.
- ESLint, Prettier, and `lint-staged` configs match the reference repo’s rules (no-only-tests, consistent type imports, formatting).
- `docs/epics.md` Epic 0 stories describe these guardrails explicitly so all Sprint 0 tasks stay tied to product strategy.
- CI currently executes: install → typecheck → lint (workspace + root) → build → tests. Burn-in/Selective runners plug into the same workflow after CC-0.6.

### CI at a glance

| Workflow | What it runs | Notes |
| --- | --- | --- |
| `.github/workflows/pr-checks.yml` | Typecheck → Lint → Build → Tests (workspace graph) | Required on PRs; matches Node 24 baseline. |
| `.github/workflows/pr-pw-e2e.yml` | Playwright smoke (Chromium) with HTML/trace artifacts | Web-only e2e gate; uses webServer hook on port 3005. |
| `.github/workflows/pr-mobile-e2e.yml` | Manual-only Maestro Android smoke (build + emulator) | Not run on PRs: GitHub-hosted Android emulators are slow/flaky (30–40m, boot failures). Trigger via `workflow_dispatch` or run locally/self-hosted. |

**Playwright coverage:** web landing smoke with API health ping, hero/nav assertions, axe-core check, traces/artifacts uploaded in CI.  
**Mobile e2e:** Maestro sanity (Expo tabs) is local-only; CI disabled due to GitHub-hosted emulator instability and long runtimes. Run via `npm run test:mobile:e2e` on your machine or on a self-hosted/device cloud runner if needed.

## Helpful references

- [docs/couturecast_brief.md](docs/couturecast_brief.md) for positioning & personas.
- [docs/epics.md](docs/epics.md) for Epic 0 (platform enablement) + feature backlogs.
- [`playwright-utils` repo](../playwright-utils) if you need deeper examples of test tooling wiring.

Questions? Tag Murat (TEA) for quality gates or Amelia (dev agent) for implementation details.
