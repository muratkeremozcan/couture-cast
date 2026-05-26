# Story 0.14: Expand test infrastructure for auth-session, burn-in, contracts, performance, and PR review automation

Updated: 2026-04-22 — add incident-driven secret rotation and secret-classification follow-up after the Vercel April 2026 security bulletin

Status: in progress

## Story

As the master test architect,
I want deferred test-infrastructure work packaged into a sequenced follow-up story,
so that Playwright, Maestro, CI burn-in, contract checks, and performance baselines mature
without blocking current feature delivery.

## Acceptance Criteria

1. Document and implement burn-in hardening in `.github/workflows/rwf-burn-in.yml`:
   fix SHA step ordering, stabilize base-ref handling, and add deterministic reporting for
   changed-spec burn-in outcomes.
2. Define and implement auth-session rollout boundaries for Playwright:
   enable auth-session for real login/session-backed journeys while leaving synthetic
   unauthorized/role-contract tests unauthenticated.
3. Add contract-testing baseline for API surfaces:
   OpenAPI/schema validation gates plus Pact-based consumer/provider verification path in CI
   (initially non-blocking until stabilized).
4. Add performance-testing baseline:
   k6-style baseline scenarios for critical APIs/queues with threshold reporting and
   non-blocking execution mode (nightly or dedicated workflow).
5. Add Maestro mobile analytics journey coverage and promotion criteria:
   document when mobile smoke can move from manual/local-only to PR optional gating.
6. Set up CodeRabbit PR review automation:
   add repository-level CodeRabbit configuration and review scope for test/CI-risk changes,
   starting as advisory before tightening policy.
7. Add unit test coverage reporting to CI:
   publish merged monorepo coverage metrics as sticky PR comments, generate step summaries,
   and maintain a shields.io coverage badge via a GitHub gist for cross-project visibility.
8. Add a post-incident secret-rotation runbook and execution task:
   inventory the Vercel-exposed variables, classify true secrets versus identifiers/public config,
   rotate all real secrets across Vercel, GitHub CI, local `.env*` files, and the upstream vendor
   consoles, then record redeploy and verification evidence.

## Insertion map for deferred items

- Burn-in hardening:
  track and implement in this story (`Task 1`), with Story 0.6 kept as baseline history since
  `.github/workflows/rwf-burn-in.yml` already exists there.
- Maestro mobile analytics coverage:
  execute through this story (`Task 5`) and align with Story 0.7 (`Task 9`) plus Story 0.12
  (`Task 9`) where analytics validation and cross-surface environment smoke checks are defined.
- Auth-session rollout:
  execute in this story (`Task 2`) only after Story 0.11 login/session-backed guardian/teen
  journeys are in place; keep current auth-header contract tests unchanged.
- Contract/perf/PR-review expansion:
  execute as dedicated tasks in this Story 0.14 (`Task 3`, `Task 4`, `Task 6`) to avoid
  overloading 0.6/0.7 implementation scope and to keep quality gates explicit.
- Coverage reporting and badges:
  execute in this story (`Task 7`), extending the CI quality gate model from Story 0.6 with
  visible coverage metrics in PRs and a persistent badge on the README.
- Incident-driven secret rotation:
  execute in this story (`Task 8`) as an operational hardening follow-up; scope only the real
  secrets/credentials exposed in Vercel and treat identifiers, URLs, and publishable keys as
  inventory-only unless a coupled vendor rotation forces their update.

## Sequencing

1. Burn-in hardening in Story 0.14 Task 1 (immediate).
2. Complete pending Story 0.7 analytics/observability work.
3. Auth-session rollout in Story 0.14 Task 2 within the Story 0.11 test implementation phase.
4. Maestro analytics journey expansion in Story 0.14 Task 5 with Story 0.12 environments.
5. Contract (OpenAPI + Pact) and performance baseline tasks in Story 0.14.
6. CodeRabbit advisory rollout and policy tuning in Story 0.14 Task 6.
7. Coverage reporting, PR comments, and badge in Story 0.14 Task 7 (immediate, parallel with Task 1).
8. Incident-driven secret rotation and verification in Story 0.14 Task 8 (immediate operational follow-up).

## Tasks / Subtasks

- [x] Task 1: Harden burn-in workflow behavior (AC: #1)
  - [x] Move SHA capture before burn-in command in `.github/workflows/rwf-burn-in.yml`.
  - [x] Ensure `EXPECTED_SHA` and `GITHUB_SHA` are exported from the captured SHA.
  - [x] Add `if: always()` to artifact upload, URL resolve, and PR comment steps in `rwf-burn-in.yml`
        so the sticky burn-in PR comment is posted even when burn-in fails (was silently skipped before).
  - [x] Replace `peter-evans/find-comment@v3` + `peter-evans/create-or-update-comment@v4` third-party
        actions in `.github/actions/playwright-merge-report-comment/action.yml` with inline
        `actions/github-script@v7` using direct `github.rest.issues` API — aligns with playwright-utils
        pattern, eliminates third-party dependency.
  - [x] Add diff coverage (new/changed code coverage) to `.github/actions/unit-test-coverage-comment`:
        new `Merge workspace lcov files` step concatenates per-workspace `lcov.info` into `coverage/lcov.info`;
        new `Compute diff coverage` step parses lcov + `git diff --diff-filter=AMR` to measure line coverage
        on PR-changed lines only; PR comment and step summary updated to show diff % with threshold badge;
        `Fail if diff coverage below threshold` step enforces the gate.
  - [x] Wire `diff-coverage-threshold: '50'` in `pr-checks.yml` to activate the new gate.
  - [x] Added `coverage.include` to all 5 workspace Vitest configs (`apps/api`, `apps/web`,
        `apps/mobile`, `packages/api-client`, `packages/config`) so untested source files appear
        in `lcov`.

- [x] Task 2: Roll out auth-session as the standard Playwright fixture path (AC: #2)
  - [x] Add auth-session provider/fixture wiring to the standard merged Playwright fixture.
  - [x] Keep explicit signed-out/conflicting-browser-auth specs as narrow opt-outs.
  - [x] Document narrow opt-out and `authOptions.userIdentifier` usage.

- [x] Task 3: Maestro analytics journey expansion (AC: #5)
  - [x] Add mobile analytics validation flows for core events (ritual, upload, alerts):
        `maestro/analytics.yaml` exercises diagnostics-mode assertions for
        `ritual_created`, `wardrobe_upload_started`, and `alert_received`.
  - [x] Capture Maestro logs/screenshots for analytics assertions:
        `scripts/run-maestro.mjs` now writes JUnit, flow Maestro logs, command JSON, and screenshot
        artifacts under `maestro/artifacts/` when run with `--ci`; the flow captures screenshots
        after each core event assertion.
  - [x] Define reliability criteria for PR optional gating enablement:
        `_bmad-output/test-artifacts/maestro-analytics-promotion.md` documents repeatability,
        flake-rate, runtime, artifact, diagnostics, and ownership thresholds.
  - [x] Keep required gating disabled until criteria are met:
        `.github/workflows/pr-mobile-e2e.yml` remains `workflow_dispatch`-only with
        `continue-on-error: true` and a `flow=analytics` advisory run option.

- [x] Task 4: Contract-testing baseline (AC: #3)
  - [x] Add API schema contract checks to CI for critical endpoints:
        `.github/workflows/contract-testing.yml` runs `npm run test:pact`, which
        executes `generate:http-openapi` plus `optic:lint` before Pact verification.
  - [x] Set up Pact consumer contracts for Next/BFF-to-API boundaries and critical API
        integrations.
        `pact/http/consumer/web-api-client.pacttest.ts` and
        `pact/http/consumer/mobile-api-client.pacttest.ts` define local web and
        mobile contracts for health and realtime fallback event polling.
  - [x] Add Pact provider verification path for backend contract conformance:
        `pact/http/provider/api-provider.pacttest.ts` boots a local Nest provider with
        mocked infrastructure and verifies the generated web and mobile pact files.
  - [x] Publish contract validation artifacts and failure diagnostics:
        the blocking contract workflow uploads OpenAPI output, generated pacts, and
        `pact/artifacts/` diagnostics on every run.
  - [x] Start as non-blocking, then promote to blocking after stability threshold:
        superseded by 2026-05-16 direction to make Pact CI blocking immediately; the
        workflow now fails on schema or Pact failures.
  - [x] Add local brokerless Pact runner:
        root scripts `test:pact`, `test:pact:consumer`, and `test:pact:provider`
        provide local/CI parity
        without Pact Broker dependency.

- [x] Task 5: Performance baseline harness (AC: #4)
  - [x] Add baseline k6 scenarios for critical API endpoints and queue load.
  - [x] Define thresholds and output reports for latency/error budgets.
  - [x] Add workflow trigger (nightly/manual) and artifact retention.
  - [x] Document promotion criteria from non-blocking to gate.
  - Note: smoke profile runs 1 VU / 1 iteration **per scenario** (5 scenarios = 5 named-export
    executor slots). Total VUs across the run = 5, each executing exactly one function once.
  - Required GitHub Secrets for `.github/workflows/k6-load.yml` (must be provisioned before
    load workflow can run against remote environments):
    - `API_PREVIEW_BASE_URL` — base URL for the preview API deployment
    - `API_PRODUCTION_BASE_URL` — base URL for the production API deployment
  - Write-path note: `testGuardianWritePath` and `testProfileAndModeration` create user
    accounts and moderation records that are not deleted after the test. Acceptable for
    1-iteration smoke in CI. For load profiles against preview, schedule periodic
    `db:reset` or scope the write-path scenarios to local only (gate on `TEST_ENV=local`).

- [x] Task 5.5: Resolve write-path preview E2E promotion debt
  - [x] Resolve preview deploy-path parity for write-path API E2E before promoting
        `playwright/tests/api/guardian-consent-lifecycle.spec.ts` beyond local-only runs:
        verify preview API deploys apply Prisma migrations and surface compatible env/schema
        state for guardian invitation flows.

- [x] Task 6: Add CodeRabbit PR review automation (AC: #6)
  - [x] Add `.coderabbit.yaml` configuration using the same baseline style as the reference
        BMAD repository profile.
  - [x] Scope path instructions for high-risk areas first (`playwright/**`, `.github/workflows/**`,
        `apps/api/**`, `_bmad-output/test-artifacts/**`).
  - [x] Keep review checks advisory initially (no merge blocking) while noise/false positives
        are tuned.
  - [x] Add PR/rollout support artifacts for the advisory-first setup:
        `.github/PULL_REQUEST_TEMPLATE.md` and CI/CD documentation notes in
        `_bmad-output/test-artifacts/ci-cd-pipeline.md`.
  - [x] CodeRabbit GitHub App status: installed/enabled on `muratkeremozcan/couture-cast`;
        first live review verified on PR `#42`.
  - [x] Document promotion criteria for stricter review policy after initial noise tuning.

- [x] Task 7: Unit test coverage reporting and badges (AC: #7)
  - [x] Create `unit-test-coverage-comment` composite action in `.github/actions/` with security
        hardening (env blocks for script injection prevention, `set -euo pipefail`).
  - [x] Add `json-summary` coverage reporter to all five vitest workspace configs
        (`apps/api`, `apps/web`, `apps/mobile`, `packages/api-client`, `packages/config`).
  - [x] Add `test:coverage` scripts to all workspaces and root `package.json`.
  - [x] Wire monorepo coverage merging (inline Node script sums all workspace summaries), sticky
        PR comment, step summary, and badge update in `.github/workflows/pr-checks.yml`.
  - [x] Create GitHub gist for shields.io dynamic badge
        ([`64348ebdc6e662b93ade9f40bdc03442`](https://gist.github.com/muratkeremozcan/64348ebdc6e662b93ade9f40bdc03442)).
  - [x] Add coverage badge to `README.md`.
  - [x] Configure `COVERAGE_GIST_TOKEN` repo secret for badge updates on push to main.
  - [x] Verify badge updates after first merge to main.

## Dev Notes

- This story is intentionally a follow-up to 0.13 and should not replace or rewrite the
  completed baseline scaffolding work.
- Keep burn-in hardening and auth-session rollout as separate implementation tracks even when
  executed in the same sprint window.
- Mobile native E2E remains Maestro-first; Playwright stays web/API-focused.
- CodeRabbit rollout starts advisory-first to avoid blocking delivery while path rules stabilize.
- CodeRabbit GitHub App status: installed/enabled on `muratkeremozcan/couture-cast`; first live
  review verified on PR `#42`.
- Task 7 coverage action is a local composite action in `.github/actions/unit-test-coverage-comment/`.
  Monorepo coverage merging sums workspace-level `coverage-summary.json` files into one aggregate.
- Task 5.5 preview write-path promotion evidence:
  the Vercel API project build command runs `prisma migrate deploy`, and the missing Preview runtime
  env vars were added to `couture-cast-api` on 2026-05-18:
  `GUARDIAN_INVITE_JWT_SECRET` (`sensitive`) and `GUARDIAN_INVITE_WEB_BASE_URL` (`plain`).
  After redeploy of Vercel deployment `dpl_HtVxq1pjsvjKUQnCk8ba7RqTajew`
  ([dashboard](https://vercel.com/muratkeremozcans-projects/couture-cast-api/HtVxq1pjsvjKUQnCk8ba7RqTajew),
  created `2026-05-18T15:45:50.082Z`), a targeted Preview probe against
  `https://couture-cast-api-git-main-muratkeremozcans-projects.vercel.app` returned:
  health `200` for SHA `6bf10a0832b9623ab7ba11636da23022bf7bfe12`, teen signup `201`,
  guardian invitation `201`, and invitation accept `200`.
  `playwright/tests/api/guardian-consent-lifecycle.spec.ts` now runs in Local and Preview while
  cleaning its guardian lifecycle records and continuing to skip Production write paths.
  `playwright/global-teardown.ts` now refuses to run
  `db:reset` unless `TEST_ENV=local` and `DATABASE_URL` points at localhost, preventing remote
  Preview/Production database resets during local verification.
- Maestro analytics Task 3 gate posture:
  diagnostics-mode mobile analytics coverage now exists for ritual, upload, and alert events, but
  the gate decision is `CONCERNS` until the flow reaches the documented repeatability thresholds in
  `_bmad-output/test-artifacts/maestro-analytics-promotion.md`; do not add it to required PR checks
  before those thresholds are met.
- Maestro Task 3 local verification:
  Android emulator runs passed through `npm run test:mobile:e2e:android` after simplifying
  the npm surface to explicit platform commands, fixing the Android Expo URL, Maestro env
  injection, Expo Go SDK install pinning, Expo Go notification import behavior, and stable
  tab selection.
- Contract Task 4 local verification:
  `npm run test:pact` passed on 2026-05-16. The command validates the generated
  OpenAPI document with Optic, runs the Pact consumer determinism gate three times, and
  verifies the generated local web and mobile pacts against a Nest provider with in-memory
  state. Pact CI is blocking by explicit implementation direction.
- Secret-classification baseline for Task 8:
  the repo currently uses a mix of true secrets (`VERCEL_TOKEN`, `EXPO_TOKEN`,
  `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `REDIS_URL`, `UPSTASH_REDIS_REST_TOKEN`,
  `GRAFANA_API_KEY`, `GUARDIAN_INVITE_JWT_SECRET`) and non-secret/public config
  (`VERCEL_*_SLUG`, `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `REDIS_TLS`,
  `UPSTASH_REDIS_REST_URL`, `POSTHOG_API_KEY`, `POSTHOG_HOST`,
  `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID`).
  Keep the rotation scope focused on the first group unless an upstream provider forces a coupled
  replacement of the second group.

## Dev Agent Record

### Debug Log

- 2026-05-18: Built `@couture/k6-utils`, typechecked the package and `k6/`, and bundled
  `k6/tests/couture-api-baseline.k6test.ts` with esbuild.
- 2026-05-18: Ran root `npm run typecheck` successfully after adding the k6 typecheck path.
- 2026-05-18: Validated shell syntax for the k6 runner scripts and Prettier formatting for the
  changed k6/package/workflow files.
- 2026-05-18: Local k6 execution was not run because the `k6` CLI is not installed on this
  workstation; GitHub workflows install it with `grafana/setup-k6-action@v1`.

### Completion Notes

- Added a workspace-local k6 utility package with config/profile loading, summary output,
  request helpers, data helpers, and the shared TypeScript k6 runner.
- Added Couture Cast k6 baseline coverage for API health, realtime polling, queue health,
  guardian write path, profile read, and moderation action flows.
- Added PR smoke coverage using the smoke profile and manual load execution with profile,
  environment, QPS, duration, summary, and artifact support.

### File List

- `.github/workflows/k6-load.yml`
- `.github/workflows/k6-smoke-prs.yml`
- `k6/helpers/config.ts`
- `k6/helpers/http.ts`
- `k6/scripts/run-k6-env.sh`
- `k6/scripts/run-k6-tests.sh`
- `k6/tests/couture-api-baseline.k6test.ts`
- `k6/tsconfig.json`
- `k6/types.d.ts`
- `package-lock.json`
- `package.json`
- `packages/k6-utils/package.json`
- `packages/k6-utils/scripts/run-k6-tests.sh`
- `packages/k6-utils/src/api-request.ts`
- `packages/k6-utils/src/config.ts`
- `packages/k6-utils/src/crypto.ts`
- `packages/k6-utils/src/distributions.ts`
- `packages/k6-utils/src/handle-summary.ts`
- `packages/k6-utils/src/index.ts`
- `packages/k6-utils/src/infra-delay.ts`
- `packages/k6-utils/src/jwt.ts`
- `packages/k6-utils/src/random-data.ts`
- `packages/k6-utils/src/time.ts`
- `packages/k6-utils/src/types.d.ts`
- `packages/k6-utils/templates/load-profiles/constant-rate.json`
- `packages/k6-utils/templates/load-profiles/ramp-up.json`
- `packages/k6-utils/templates/load-profiles/smoke.json`
- `packages/k6-utils/templates/load-profiles/soak.json`
- `packages/k6-utils/templates/load-profiles/spike.json`
- `packages/k6-utils/tsconfig.build.json`
- `packages/k6-utils/tsconfig.json`

## Change Log

| Date       | Author                       | Change                                                                                                                                                                                                                                                                                            |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-04 | Codex (Test Architect)       | Added follow-up story for deferred testing infrastructure: burn-in hardening, auth-session rollout, contract testing, and performance baseline                                                                                                                                                    |
| 2026-03-04 | Codex (Test Architect)       | Expanded 0.14 scope with CodeRabbit PR review automation and explicit Pact setup in contract-testing tasks                                                                                                                                                                                        |
| 2026-03-27 | Codex                        | Recorded partial completion of Task 6: added `.coderabbit.yaml`, PR template, CI/CD notes, and PR `#42`                                                                                                                                                                                           |
| 2026-03-27 | Codex                        | Removed redundant CodeRabbit ready-for-review workflow after review feedback; automatic review remains configured in `.coderabbit.yaml`                                                                                                                                                           |
| 2026-04-14 | Murat + Claude               | Added Task 7: unit test coverage reporting — composite action, monorepo coverage merge, sticky PR comments, shields.io badge via gist                                                                                                                                                             |
| 2026-04-21 | Codex                        | Recorded preview deploy-parity debt for guardian write-path Playwright coverage and kept the lifecycle contract spec local-only                                                                                                                                                                   |
| 2026-04-22 | Codex                        | Added Task 8 for incident-driven secret classification and cross-vendor rotation after the Vercel April 2026 security bulletin                                                                                                                                                                    |
| 2026-05-04 | Murat + Claude (Murat/TEA)   | Completed Task 1: added `always()` to rwf-burn-in steps, replaced peter-evans actions with inline github-script in playwright-merge-report-comment, added diff coverage feature (lcov merge + git diff gate) to unit-test-coverage-comment action                                                 |
| 2026-05-05 | Codex (Murat/TEA)            | Completed Task 2: auth-session now lives in merged fixtures; opt-outs stay narrow; alternate users use `authOptions.userIdentifier`.                                                                                                                                                              |
| 2026-05-05 | Codex (Murat/TEA)            | Completed Task 3: added diagnostics-mode Maestro analytics flow, local/manual scripts, CI artifact capture, and promotion criteria while keeping mobile analytics gating advisory-only.                                                                                                           |
| 2026-05-05 | Codex (Murat/TEA)            | Verified and fixed Task 3 Maestro execution on Android emulator: analytics and sanity flows now pass locally with JUnit, command logs, and screenshots.                                                                                                                                           |
| 2026-05-18 | Codex (Dev + Test Architect) | Completed Task 5.5: added missing API Preview guardian invitation env vars in Vercel, redeployed the API preview, verified signup/invite/accept write-path parity, promoted the lifecycle spec to Preview while keeping Production skipped, and blocked remote `db:reset` in Playwright teardown. |
| 2026-05-18 | Codex                        | Completed Task 5: added k6 utility package, baseline API/queue scenarios, PR smoke workflow, manual load workflow, thresholds, summaries, and retained artifacts.                                                                                                                                 |
