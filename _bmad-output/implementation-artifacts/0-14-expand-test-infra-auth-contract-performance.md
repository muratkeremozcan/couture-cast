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

- [ ] Task 1: Harden burn-in workflow behavior (AC: #1)
  - [ ] Move SHA capture before burn-in command in `.github/workflows/rwf-burn-in.yml`.
  - [ ] Ensure `EXPECTED_SHA` and `GITHUB_SHA` are exported from the captured SHA.
  - [ ] Add summary/artifact output for changed-spec list and burn-in result matrix.
  - [ ] Add regression check that no-change PRs bypass burn-in correctly.

- [ ] Task 2: Roll out auth-session where real auth exists (AC: #2)
  - [ ] Add auth-session provider/fixture wiring for login-backed Playwright specs only.
  - [ ] Keep explicit unauthenticated/security-negative specs out of auth-session.
  - [ ] Add test guidelines: when to use `authSessionEnabled: false` and when to use
        persisted auth state.
  - [ ] Add parallel user-isolation pattern for auth-session-driven tests.

- [ ] Task 3: Contract-testing baseline (AC: #3)
  - [ ] Add API schema contract checks to CI for critical endpoints.
  - [ ] Set up Pact consumer contracts for Next/BFF-to-API boundaries and critical API
        integrations.
  - [ ] Add Pact provider verification path for backend contract conformance.
  - [ ] Publish contract validation artifacts and failure diagnostics.
  - [ ] Start as non-blocking, then promote to blocking after stability threshold.
  - [ ] Resolve preview deploy-path parity for write-path API E2E before promoting
        `playwright/tests/api/guardian-consent-lifecycle.spec.ts` beyond local-only runs:
        verify preview API deploys apply Prisma migrations and surface compatible env/schema
        state for guardian invitation flows.

- [ ] Task 4: Performance baseline harness (AC: #4)
  - [ ] Add baseline k6 scenarios for critical API endpoints and queue load.
  - [ ] Define thresholds and output reports for latency/error budgets.
  - [ ] Add workflow trigger (nightly/manual) and artifact retention.
  - [ ] Document promotion criteria from non-blocking to gate.

- [ ] Task 5: Maestro analytics journey expansion (AC: #5)
  - [ ] Add mobile analytics validation flows for core events (ritual, upload, alerts).
  - [ ] Capture Maestro logs/screenshots for analytics assertions.
  - [ ] Define reliability criteria for PR optional gating enablement.
  - [ ] Keep required gating disabled until criteria are met.

- [ ] Task 6: Add CodeRabbit PR review automation (AC: #6)
  - [x] Add `.coderabbit.yaml` configuration using the same baseline style as the reference
        BMAD repository profile.
  - [x] Scope path instructions for high-risk areas first (`playwright/**`, `.github/workflows/**`,
        `apps/api/**`, `_bmad-output/test-artifacts/**`).
  - [x] Keep review checks advisory initially (no merge blocking) while noise/false positives
        are tuned.
  - [x] Add PR/rollout support artifacts for the advisory-first setup:
        `.github/PULL_REQUEST_TEMPLATE.md` and CI/CD documentation notes in
        `_bmad-output/test-artifacts/ci-cd-pipeline.md`.
  - [ ] Install/enable the CodeRabbit GitHub App on `muratkeremozcan/couture-cast` and verify the
        first live review on PR `#42`.
  - [ ] Document promotion criteria for stricter review policy after initial noise tuning.

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
  - [ ] Configure `COVERAGE_GIST_TOKEN` repo secret for badge updates on push to main.
  - [ ] Verify badge updates after first merge to main.

- [ ] Task 8: Rotate Vercel-exposed secrets and document exact cross-vendor scope (AC: #8)
  - [ ] Build the authoritative incident inventory for every Vercel variable currently in scope
        (Production + Pre-Production) and classify each as:
        `real secret`, `credential embedded in URL`, `identifier`, `public endpoint/config`, or
        `public/publishable client key`.
  - [ ] Treat the following as real secrets/credentials that must be rotated because they either
        authenticate to a provider or sign privileged traffic:
        `VERCEL_AUTOMATION_BYPASS_SECRET`, `VERCEL_TOKEN`, `EXPO_TOKEN`,
        `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `REDIS_URL`,
        `UPSTASH_REDIS_REST_TOKEN`, `GRAFANA_API_KEY`, and `GUARDIAN_INVITE_JWT_SECRET`.
  - [ ] Treat the following as inventory-only / no urgent rotation for this incident unless a
        coupled upstream rotation changes them:
        `VERCEL_WEB_PROJECT_SLUG`, `VERCEL_API_PROJECT_SLUG`, `VERCEL_TEAM_SLUG`,
        `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `REDIS_TLS`,
        `UPSTASH_REDIS_REST_URL`, `POSTHOG_HOST`, `GRAFANA_OTLP_ENDPOINT`,
        `GRAFANA_INSTANCE_ID`.
  - [ ] Treat the following as intentionally public or publishable values:
        `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `POSTHOG_API_KEY`;
        verify their public exposure is intentional and do not block incident response on them
        unless a coupled vendor rotation or product-spam concern requires replacement.
  - [ ] Rotate Vercel-owned secrets in the Vercel dashboard:
        create a new `VERCEL_AUTOMATION_BYPASS_SECRET` for Preview/Production protection flows,
        generate a new `VERCEL_TOKEN`, update the Vercel team/project env stores, mark all true
        secrets as `Sensitive`, and remove/revoke the old values after redeploy verification.
  - [ ] Rotate Expo credentials in the Expo dashboard:
        create a new robot/access token for `EXPO_TOKEN`, update the mirror locations in
        Vercel env vars (where present), GitHub Actions repo secrets, and local
        `.env.local/.env.dev/.env.prod`, then revoke the old Expo token.
  - [ ] Rotate Supabase privileged credentials in both dev and prod Supabase projects:
        update `SUPABASE_SERVICE_ROLE_KEY` and rotate any Vercel-hosted `DATABASE_URL` values by
        changing the underlying database password/connection secret, then update the mirrored
        values in Vercel API env vars, GitHub Actions secrets (`DATABASE_URL_DEV`,
        `DATABASE_URL_PROD`), local `.env.local/.env.dev/.env.prod`, and `packages/db/.env`.
  - [ ] Record the legacy-Supabase-key coupling risk explicitly:
        this repo still uses legacy `anon` / `service_role` keys, so if the chosen Supabase
        rotation path requires JWT-secret rotation or a migration to publishable/secret keys,
        update `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in every runtime that
        mirrors them after the privileged-key cutover.
  - [ ] Rotate Redis / Upstash credentials:
        change the upstream Upstash/Redis password or token so `REDIS_URL` is replaced, generate a
        new `UPSTASH_REDIS_REST_TOKEN`, update the mirrors in Vercel Preview/Production and local
        `.env.dev/.env.prod` (plus any GitHub secret store if added later), and leave
        `UPSTASH_REDIS_REST_URL` untouched unless the provider issues a new endpoint.
  - [ ] Rotate Grafana Cloud credentials:
        create a new `GRAFANA_API_KEY`, update its mirrors in Vercel env vars, GitHub Actions
        secrets, and local `.env.local/.env.dev/.env.prod`, and confirm `GRAFANA_INSTANCE_ID` and
        `GRAFANA_OTLP_ENDPOINT` remain unchanged identifiers/endpoints.
  - [ ] Rotate the app-local signing secret:
        mint unique replacement values for `GUARDIAN_INVITE_JWT_SECRET` in local `.env*`, GitHub
        Actions secrets, and the Vercel API project’s Preview/Production env stores; after
        rotation, confirm pending guardian invitation links signed with the old secret are
        intentionally invalidated and that new invitations succeed.
  - [ ] Confirm whether any of the PostHog or Grafana values are also mirrored in GitHub secrets
        outside the current workflow set, and if so, rotate/update the mirrors only where the
        upstream value actually changed.
  - [ ] Redeploy every project/environment linked to a rotated value:
        Vercel API Preview/Production, Vercel Web if it consumes the changed variable, local
        dev shells, GitHub CI jobs that read the secret, and mobile build flows that depend on
        `EXPO_TOKEN`.
  - [ ] Validate completion with evidence:
        capture a redacted matrix showing each rotated var, its upstream vendor, every mirror
        location updated, the redeploy identifiers/timestamps, and smoke-test proof that local CI,
        Preview/Production deploys, guardian invitation signing, mobile push/auth, Redis queues,
        and observability exports all work on the new credentials.

## Dev Notes

- This story is intentionally a follow-up to 0.13 and should not replace or rewrite the
  completed baseline scaffolding work.
- Keep burn-in hardening and auth-session rollout as separate implementation tracks even when
  executed in the same sprint window.
- Mobile native E2E remains Maestro-first; Playwright stays web/API-focused.
- CodeRabbit rollout starts advisory-first to avoid blocking delivery while path rules stabilize.
- Task 7 coverage action is a local composite action in `.github/actions/unit-test-coverage-comment/`.
  Monorepo coverage merging sums workspace-level `coverage-summary.json` files into one aggregate.
- Current partial implementation status for Task 6:
  repo-side config/workflow/template work is complete; GitHub App installation still requires
  authenticated GitHub interaction before the first live review can be verified.
- Current preview debt for Task 3:
  guardian consent lifecycle Playwright coverage remains local-only because preview PR deploys
  still return `500` on `POST /api/v1/guardian/invitations` even after local CI burn-in passes.
  Treat preview deploy-path verification (migration execution plus runtime parity) as a separate
  contract-infra follow-up before re-enabling preview gating for this write-path journey.
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

## Change Log

| Date       | Author                 | Change                                                                                                                                         |
| ---------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-04 | Codex (Test Architect) | Added follow-up story for deferred testing infrastructure: burn-in hardening, auth-session rollout, contract testing, and performance baseline |
| 2026-03-04 | Codex (Test Architect) | Expanded 0.14 scope with CodeRabbit PR review automation and explicit Pact setup in contract-testing tasks                                     |
| 2026-03-27 | Codex                  | Recorded partial completion of Task 6: added `.coderabbit.yaml`, PR template, CI/CD notes, and PR `#42`                                        |
| 2026-03-27 | Codex                  | Removed redundant CodeRabbit ready-for-review workflow after review feedback; automatic review remains configured in `.coderabbit.yaml`        |
| 2026-04-14 | Murat + Claude         | Added Task 7: unit test coverage reporting — composite action, monorepo coverage merge, sticky PR comments, shields.io badge via gist          |
| 2026-04-21 | Codex                  | Recorded preview deploy-parity debt for guardian write-path Playwright coverage and kept the lifecycle contract spec local-only                |
| 2026-04-22 | Codex                  | Added Task 8 for incident-driven secret classification and cross-vendor rotation after the Vercel April 2026 security bulletin                 |
