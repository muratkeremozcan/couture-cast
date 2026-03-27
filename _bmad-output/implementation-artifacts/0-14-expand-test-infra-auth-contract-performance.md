# Story 0.14: Expand test infrastructure for auth-session, burn-in, contracts, performance, and PR review automation

Updated: 2026-03-27 — record partial completion of CodeRabbit advisory rollout setup

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

## Sequencing

1. Burn-in hardening in Story 0.14 Task 1 (immediate).
2. Complete pending Story 0.7 analytics/observability work.
3. Auth-session rollout in Story 0.14 Task 2 within the Story 0.11 test implementation phase.
4. Maestro analytics journey expansion in Story 0.14 Task 5 with Story 0.12 environments.
5. Contract (OpenAPI + Pact) and performance baseline tasks in Story 0.14.
6. CodeRabbit advisory rollout and policy tuning in Story 0.14 Task 6.

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
        `.github/workflows/coderabbit-review.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, and CI/CD
        documentation notes in `_bmad-output/test-artifacts/ci-cd-pipeline.md`.
  - [ ] Install/enable the CodeRabbit GitHub App on `muratkeremozcan/couture-cast` and verify the
        first live review on PR `#42`.
  - [ ] Document promotion criteria for stricter review policy after initial noise tuning.

## Dev Notes

- This story is intentionally a follow-up to 0.13 and should not replace or rewrite the
  completed baseline scaffolding work.
- Keep burn-in hardening and auth-session rollout as separate implementation tracks even when
  executed in the same sprint window.
- Mobile native E2E remains Maestro-first; Playwright stays web/API-focused.
- CodeRabbit rollout starts advisory-first to avoid blocking delivery while path rules stabilize.
- Current partial implementation status for Task 6:
  repo-side config/workflow/template work is complete; GitHub App installation still requires
  authenticated GitHub interaction before the first live review can be verified.

## Change Log

| Date       | Author                 | Change                                                                                                                                         |
| ---------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-04 | Codex (Test Architect) | Added follow-up story for deferred testing infrastructure: burn-in hardening, auth-session rollout, contract testing, and performance baseline |
| 2026-03-04 | Codex (Test Architect) | Expanded 0.14 scope with CodeRabbit PR review automation and explicit Pact setup in contract-testing tasks                                     |
| 2026-03-27 | Codex                  | Recorded partial completion of Task 6: added `.coderabbit.yaml`, advisory review trigger workflow, PR template, CI/CD notes, and PR `#42`      |
