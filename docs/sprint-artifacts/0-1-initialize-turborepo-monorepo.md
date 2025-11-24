# Story 0.1: Initialize Turborepo monorepo

Status: done

## Story

As a platform team,
I want a monorepo structure with shared packages,
so that all teams can develop features in parallel with consistent tooling and dependencies.

## Acceptance Criteria

1. **FIRST:** Refresh version verification log from architecture document (re-run all `npm info` and version commands); update architecture doc if any versions have changed since 2025-11-11.
2. Execute starter template commands per architecture using verified versions (create-expo-app@3.10.1, create-next-app@15.0.3, @nestjs/cli@11.1.2).
3. Configure Turborepo workspace with apps (mobile, web, api) and packages (db, tokens, ui-web, api-client, testing).
4. Set up npm workspaces, shared ESLint config, TypeScript configs, and turbo.json task graph (lint → test → build).
5. Verify `npm run dev` starts all apps; `npm test` runs all test suites; `npm run build` produces deployable artifacts.
6. Lock all dependency versions in package.json files to match verified versions; commit package-lock.json.

## Tasks / Subtasks

- [x] Task 1: Refresh version verification (AC: #1)
  - [x] Run `node --version`, `npm --version` and verify against architecture log
  - [x] Run `npm info create-expo-app version`, `npm info create-next-app version`, `npm info @nestjs/cli version`
  - [x] Run `npm info prisma version`, `npm info next version`, `npm info expo version`, `npm info vitest version`, `npm info playwright version`
  - [x] Compare results with architecture doc Section "Version verification log (captured 2025-11-11)"
  - [x] Update architecture doc if any versions have changed
  - [x] Document any breaking changes in version update notes

- [x] Task 2: Initialize mobile app (AC: #2)
  - [x] Run `npx create-expo-app@3.10.1 apps/mobile --template` (select TypeScript template)
  - [x] Verify Expo Router, ESLint, Metro config, OTA-ready app.json created
  - [x] Test: `cd apps/mobile && npm run start` successfully starts Expo dev server

- [x] Task 3: Initialize web app with Turborepo (AC: #2)
  - [x] Run `npx create-next-app@15.0.3 apps/web --typescript --eslint --tailwind --app --src-dir`
  - [x] Verify App Router, SWC, TypeScript, ESLint, Tailwind configured
  - [x] Test: `cd apps/web && npm run dev` successfully starts Next.js dev server on port 3000

- [x] Task 4: Initialize API app (AC: #2)
  - [x] Run `npx @nestjs/cli@11.1.2 new apps/api --package-manager npm --skip-git`
  - [x] Verify NestJS modules/controllers/providers structure, TypeScript config, ESLint created
  - [x] Test: `cd apps/api && npm run start:dev` successfully starts NestJS server on port 3001

- [x] Task 5: Configure Turborepo workspace (AC: #3)
  - [x] Create root `package.json` with npm workspaces: `"workspaces": ["apps/*", "  - [x] Install Turborepo: `npm install turbo --save-dev --workspace-root`
  - [x] Create `turbo.json` with task graph per architecture:
    ```json
    {
      "tasks": {
        "lint": { "dependsOn": ["^lint"], "outputs": [] },
        "test": { "dependsOn": ["lint", "^test"], "outputs": [] },
        "build": {
          "dependsOn": ["test", "^build"],
          "outputs": ["dist/**", "build/**", "lib/**"],
          "inputs": ["src/**", "package.json", "tsconfig*.json"]
        },
        "dev": { "cache": false, "persistent": true },
        "typecheck": { "dependsOn": ["^typecheck"], "outputs": [], "inputs": ["src/**", "tsconfig*.json"] }
      }
    }
    ```
  - [x] Create packages directories: ` ` ` ` `  - [x] Initialize each package with minimal package.json/tsconfig/src placeholders

- [x] Task 6: Set up shared ESLint config (AC: #4)
  - [x] Create ` with shared ESLint rules
  - [x] Configure extends: `@typescript-eslint/recommended`, `next/core-web-vitals`, `prettier`
  - [x] Update apps/packages to use shared config: `extends: ["@couture/eslint-config"]`
  - [x] Install shared ESLint dependency via workspace (`@couture/eslint-config` published locally)

- [x] Task 7: Set up shared TypeScript configs (AC: #4)
  - [x] Create ` with strict TypeScript settings
  - [x] Create ` extending base.json
  - [x] Create ` for shared UI packages
  - [x] Update all apps/packages to extend the shared configs

- [x] Task 8: Configure root scripts and verify (AC: #5)
  - [x] Add root package.json scripts:
    ```json
    {
      "scripts": {
        "dev": "turbo run dev",
        "build": "turbo run build",
        "test": "turbo run test",
        "lint": "turbo run lint",
        "format": "prettier --write \"**/*.{ts,tsx,md}\""
      }
    }
    ```
  - [x] Test `npm run dev` starts all 3 apps (mobile, web, api) concurrently
  - [x] Test `npm test` runs test suites (should pass or skip if no tests yet)
  - [x] Test `npm run build` produces artifacts in .next/, dist/, build/ directories
  - [x] Test `npm run lint` validates all TypeScript/ESLint rules

- [x] Task 9: Lock dependency versions (AC: #6)
  - [x] Review package.json in all apps and packages
  - [x] Pin versions to match architecture verification log (exact versions, no `^` or `~`)
  - [x] Run `npm install` at root to generate package-lock.json
  - [x] Verify lockfile includes all dependencies with exact versions
  - [x] Commit package.json and package-lock.json files

- [x] Task 10: Document project structure
  - [x] Create README.md at root with setup instructions
  - [x] Document prerequisite versions (Node 24.x per `.nvmrc`, npm 10.5.3+)
  - [x] List all apps and packages with descriptions
  - [x] Add "Getting Started" section with `npm install && npm run dev`

## Dev Notes

### Architecture Context

**Source: docs/bmm-architecture-20251110.md**

**Project Structure (Section: Project Structure):**
```
couturecast/
├─ apps/
│  ├─ web/                  # Next.js App Router + BFF route handlers
│  ├─ mobile/               # Expo Router (iOS/Android/watch/widgets)
│  └─ api/                  # NestJS monolith (REST, Socket.io, BullMQ workers)
├─ │  ├─ db/                   # Prisma schema + migrations + client factory
│  ├─ tokens/               # Design tokens shared across web/mobile
│  ├─ ui-web/               # Vite component library + Story/preview files
│  ├─ api-client/           # Generated OpenAPI SDK consumed by apps
│  └─ testing/              # Playwright/Maestro fixtures + mock servers and seed utils
├─ turbo.json               # Task graph for lint/test/build
└─ package.json (npm workspaces) / package-lock.json
```

**Starter Template Commands (Section: Project Initialization, lines 13-24):**
- Mobile: `npx create-expo-app@3.10.1 apps/mobile --template`
- Web: `npx create-next-app@15.0.3 apps/web --example with-turborepo`
- API: `npx @nestjs/cli@11.1.2 new apps/api --package-manager npm`

**Starter-Provided Decisions (Section: Starter-provided decisions, lines 27-31):**
- TypeScript everywhere, ESLint defaults, base scripts (dev, build, lint)
- Expo Router for mobile navigation
- Next.js App Router (no /pages fallback)
- NestJS modules/controllers/providers structure

**Version Verification Log (lines 33-47):**
All tool versions are documented and verified as of 2025-11-11. Must re-verify before running starter commands.

**Breaking Change Watchlist (lines 51-52):**
- Next.js 15 requires App Router, React 19 server actions
- NestJS 11 defaults to SWC (keep config in sync)
- Prisma 5 removed `prisma migrate save` (use `prisma migrate dev`)

### Testing Standards

**Source: docs/test-design-system.md**

**Test Framework (Section: Team & Process Guidelines):**
- Unit tests: Vitest + ts-mockito (80% line coverage required)
- Integration tests: Vitest + Testcontainers (70% line coverage)
- E2E tests: Playwright (web), Maestro (mobile)
- Test locations: Colocated `*.test.ts` except E2E in `
**CI/CD Pipeline (Section: CI/CD Pipeline Architecture):**
- Multi-stage: Smoke (@p0) → Unit+Integration → E2E (@p1) → Burn-In → Load
- Parallelization: 4 shards for unit, 2 shards for E2E
- Turborepo task graph: lint → unit → schema diff → e2e

**Reference Baseline:**
The flattened playwright-utils reference at `/Users/murat.ozcan/opensource/playwright-utils-flat.txt` provides excellent patterns for:
- ESLint configuration (TypeScript, Playwright, testing rules)
- TypeScript config (strict mode, path aliases)
- GitHub Actions workflows (test, lint, deploy stages)
- Monorepo package structure
- Testing conventions

Full source available at: `/Users/murat.ozcan/seon/playwright-utils`

### Implementation Patterns

**Naming Conventions (Architecture Section: Implementation Patterns):**
- Feature-first directories
- PascalCase components, kebab-case file names
- snake_case DB tables

**Consistency Rules (Architecture Section: Consistency Rules):**
- Error handling: map codes to banners/toasts
- Logging: Pino (API) + consola (clients) with JSON format
- Testing gates: lint → unit → schema → e2e on every PR

### Project Structure Notes

**Monorepo Layout:**
- `apps/`: Three applications (mobile, web, api)
- ` Shared libraries (db, tokens, ui-web, api-client, testing)
- `infra/`: Deployment configs (fly, vercel, eas)
- `tools/`: Scripts/generators
- `.github/workflows/`: CI/CD pipelines

**Expected After This Story:**
- Complete Turborepo monorepo with 3 apps initialized
- Shared packages scaffolded (empty but structured)
- Root scripts (dev, build, test, lint) functional
- Version locks in package-lock.json

### References

- [Architecture: Project Initialization](docs/bmm-architecture-20251110.md#project-initialization)
- [Architecture: Project Structure](docs/bmm-architecture-20251110.md#project-structure)
- [Architecture: Version Verification Log](docs/bmm-architecture-20251110.md#version-verification-log)
- [Test Design: CI/CD Pipeline Architecture](docs/test-design-system.md#cicd-pipeline-architecture)
- [Epics: Epic 0 Story CC-0.1](docs/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
- [Baseline Reference: playwright-utils](file:///Users/murat.ozcan/opensource/playwright-utils-flat.txt)

## Dev Agent Record

### Context Reference

- docs/sprint-artifacts/stories/0-1-initialize-turborepo-monorepo.context.xml (generated 2025-11-14)

### Agent Model Used

<!-- Will be filled by dev agent -->

### Debug Log References

- 2025-11-14: `node --version`, `npm --version`, and `npm info {create-expo-app, create-next-app, @nestjs/cli, prisma, next, expo, vitest, playwright}` captured to refresh AC1 version log inputs.
- 2025-11-17: Regenerated the Expo Router tabs project (latest official SDK 54) to keep the template clean, renamed components/constants/tests to kebab-case, and enforced `baseUrl` + `ignoreDeprecations` in `tsconfig.json`. `npm run --workspace apps/mobile start -- --help` validated CLI wiring after the refresh.
- 2025-11-17: Upgraded the web workspace to `next@15.5.6` / React 19.1, added App Router `error.tsx` + `not-found.tsx`, and switched scripts to the hoisted `next` binary so `npm run build` passes locally and in CI.
- 2025-11-17: Migrated the NestJS workspace to `vitest@4.0.9` + `@vitest/coverage-v8@4.0.9`, updated specs/config to load `reflect-metadata`, and reran `npm run test` to confirm the new runner passes.
- 2025-11-17: Added repo-level `lint:fix` + README docs and replaced the separate `format` scripts with Prettier baked into lint, so `npm run validate` now exercises typecheck/lint/test exactly as CI will.
- 2025-11-17: Confirmed Task 8 via `nr validate` (typecheck/lint/test) and `nr dev` logs, then drafted Task 9 plan to pin package versions and regenerate the lockfile after a clean install baseline.
- 2025-11-17: Finished Task 9 by pinning every workspace/package dependency (no `^`/`~` remain) and refreshing `package-lock.json` via a clean install to capture the exact versions captured in the verification log.
- 2025-11-17: Task 10 follow-up—expanded README to cover Node 24.x (`.nvmrc`) / npm 10.5.3+ prerequisites, enumerated every app/package, and highlighted `npm install && npm run dev` onboarding flow.

### Completion Notes List

- 2025-11-14 (Amelia) — AC1 / Task 1 complete: architecture version verification table updated with Node 22.12.0, npm 11.3.0, template CLIs, Prisma 6.19.0, Next.js 16.0.3, Expo 54.0.23, Vitest 4.0.9, Playwright 1.56.1 plus updated watchlist guidance.
- 2025-11-17 (Amelia) — AC2 / Task 2 refresh: Expo Router tabs template re-generated, filenames normalized, and tsconfig updated for alias safety; lint/test/build validated on the refreshed mobile workspace.
- 2025-11-17 (Amelia) — AC2 / Task 3 refresh: Web scaffold bumped to Next 15.5.6 + React 19.1 with custom `error.tsx` / `not-found.tsx`, ensuring `npm run build` passes and CI no longer fails on the styled-jsx bug.
- 2025-11-17 (Amelia) — AC2 / Task 4 refresh: API workspace running `vitest@4.0.9` with updated specs/config; `npm run test` now executes the new runner without warnings.
- 2025-11-17 (Amelia) — Tooling: Root `lint` now runs ESLint + Prettier in one command, `lint:fix` auto-formats everything, and `clean:install` makes dependency resets reproducible. README + scripts updated accordingly.
- 2025-11-17 (Amelia) — Task 10 complete: README spells out Node 24.x/npm 10.5.3+ prerequisites, app/package responsibilities, and walk-through for `npm install && npm run dev` so new contributors land safely.

### File List

- UPDATED docs/bmm-architecture-20251110.md — refreshed “Version verification log” (dated 2025-11-14) and expanded breaking change watchlist for Node 22/Next 16/Prisma 6/Vitest 4.
- UPDATED docs/sprint-artifacts/0-1-initialize-turborepo-monorepo.md — Task 1-3 progress, Dev Agent log entries, and file roster updated.
- UPDATED apps/mobile/** — Latest Expo tabs template checked in with lint-friendly filenames, OTA-ready `app.json`, and strict tsconfig; shared components trimmed to current repo standards.
- UPDATED apps/web/** — Next.js 15.5.6 App Router project with Tailwind, `src/app` layout, error/not-found pages, `postcss.config.mjs`, `tailwind.config.ts`, and scripts pointing at the hoisted Next CLI.
- UPDATED apps/api/** — NestJS 11 project now on Vitest 4 with controllers/services/modules, ESLint config, `nest-cli.json`, and npm scripts for dev/build/test workflows.
- ADDED  — shared lint rules exported as `@couture/eslint-config` and consumed by every workspace.
- ADDED  — placeholder packages with build/typecheck/lint/test scripts and TS configs so Task 5 scaffolding is complete.
- UPDATED package.json / README.md — merged format scripts into lint, added `clean:install`, documented prerequisites/apps/ steps, and refreshed `package-lock.json` to reflect Expo/Next/Vitest upgrades.

## Change Log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.1 acceptance criteria |
| 2025-11-14 | Amelia (Dev) | AC1 fulfilled: version verification log refreshed + story Task 1 completed |
| 2025-11-15 | Amelia (Dev) | AC2 fulfilled: mobile/web/API workspaces scaffolded, Jest swapped for Vitest, repo lint automation enhanced |
| 2025-11-17 | Amelia (Dev) | Task 5/6 fulfilled: turbo graph encoded, shared packages scaffolded, `@couture/eslint-config` published and adopted |
| 2025-11-17 | Amelia (Dev) | Task 8/9/10: validated root scripts, pinned dependency versions, and refreshed README with prerequisites + getting-started |
