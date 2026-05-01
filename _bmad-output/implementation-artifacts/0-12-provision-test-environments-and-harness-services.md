# Story 0.12: Validate Preview-based test environment and E2E harness

<!-- markdownlint-configure-file {"MD013": false} -->

Updated: 2026-05-01 - Rewrite around Vercel Preview as the PR validation target and
remove unsupported extra deployment scope.

Status: in progress

## Story

As an engineering team,
we need a documented and verified test environment model using Local, Vercel Preview, and
Production,
so that PR-level E2E validation runs against realistic non-production services without inventing
unsupported staging infrastructure.

## Acceptance Criteria

1. Document the supported test/deployment topology in
   `_bmad-output/test-artifacts/test-environments.md`:
   - Local development and local CI use local services for fast, resettable validation.
   - Vercel Preview is the PR deployed validation target.
   - Vercel Production is created from `main` after required PR gates pass.
   - Only Vercel Preview and Vercel Production are deployed by Vercel in the current plan.
   - Mobile deployment remains manual unless a later story changes that posture.
2. Confirm existing Local and Preview E2E entry points and document their purpose:
   - `npm run test:pw-local` validates the local app/services path.
   - `npm run test:pw-preview` validates the active Vercel Preview URL.
   - `npm run test:pw-prod` validates Production with smoke-safe specs only.
   - `.github/workflows/pr-pw-e2e-local.yml` remains the local PR E2E gate.
   - `.github/workflows/pr-pw-e2e-vercel-preview.yml` remains the Preview smoke/E2E gate.
3. Preview E2E runs against real non-production services by default, without broad stubbing, with
   documented risk controls:
   - Preview must not target production Supabase, production Redis, production storage, or
     production write-capable secrets.
   - Test users, fixtures, and generated data must be synthetic, anonymized, or otherwise safe.
   - Tests that create data must be idempotent, namespaced, or have cleanup guidance.
   - Destructive or data-mutating flows that are not Preview-safe stay local-only until parity is
     proven.
   - External integrations are stubbed only when unsafe, costly, rate-limited, flaky, or outside
     team control.
4. Review and document Preview/Production secret boundaries:
   - Preview uses non-production credentials and provider keys.
   - Production uses production credentials only.
   - No shared write-capable production secret is exposed to Preview or local PR CI.
   - Any Vercel protection bypass secret is documented as Preview access control, not an app
     runtime credential.
5. Capture current readiness evidence and remaining gaps in the story and the environment
   runbook:
   - Already satisfied workflow/script evidence is listed with file references.
   - Remaining gaps are explicit tasks, not hidden behind the old six-environment model.
   - Known Preview/Production parity risks are recorded with ownership or follow-up story links.
6. Keep Story 0.12 scoped to environment model validation and E2E harness hardening:
   - Do not add OpenAPI/schema, Pact, formal contract gates, k6, load testing, or performance
     thresholds here.
   - Do not add broad Grafana/dashboard work here.
   - Defer contract/performance expansion to Story 0.14.

## Tasks / Subtasks

- [x] Task 1: Audit and record already-satisfied Local/Preview E2E evidence (AC: #2, #5)
  - [x] Reference root scripts in `package.json`:
        `test:pw-local`, `test:pw-preview`, and `test:pw-prod`.
  - [x] Reference `.github/workflows/pr-pw-e2e-local.yml` as the sharded local PR E2E gate
        with burn-in.
  - [x] Reference `.github/workflows/pr-pw-e2e-vercel-preview.yml` as the Vercel Preview
        validation gate that resolves exact web/API Preview URLs and waits for matching SHAs.
  - [x] Reference `.github/workflows/rwf-e2e.yml` as the reusable Playwright runner that maps
        `TEST_ENV=preview` to Preview and `TEST_ENV=prod` to Production.
  - [x] Reference `playwright/config/preview.config.ts` and
        `playwright/config/environments.ts` for Preview base URL and API URL resolution.

- [x] Task 2: Rewrite `_bmad-output/test-artifacts/test-environments.md` around current topology
      (AC: #1, #3, #4, #5)
  - [x] Define Local, Vercel Preview, and Production as the supported topology.
  - [x] State explicitly that `TEST_ENV=preview` is the Playwright target for Vercel Preview.
  - [x] Document which workflows run against Local, Preview, and Production.
  - [x] Document mobile E2E/manual deployment posture and link Story 0.14 Task 5 for Maestro
        analytics journey expansion.
  - [x] Add a quick reference table for base URL variables:
        `WEB_E2E_BASE_URL`, `PREVIEW_WEB_E2E_BASE_URL`, `PREVIEW_API_BASE_URL`,
        `PROD_WEB_E2E_BASE_URL`, and `PROD_API_BASE_URL`.

- [ ] Task 3: Verify non-production resource and secret boundaries (AC: #3, #4)
  - [ ] Confirm Preview Vercel env vars point to non-production Supabase/database resources.
  - [ ] Confirm Preview does not expose production write-capable Supabase, Redis, storage, or
        provider secrets.
  - [x] Document required GitHub secrets for Preview E2E:
        `VERCEL_TOKEN` and optional `VERCEL_AUTOMATION_BYPASS_SECRET`.
  - [x] Document Vercel project/team slugs as non-secret Preview URL resolution
        configuration.
  - [x] Document any local `.env.preview` requirements without storing secret values in the repo.
  - [x] Record unresolved or unverifiable secret-boundary items as follow-up risks.

- [x] Task 4: Define Preview fixture, data, and cleanup policy (AC: #3, #5)
  - [x] Prefer synthetic or factory-created users and fixture data for Preview E2E.
  - [x] Require generated test data to be idempotent, namespaced by test run, or safe to leave
        until scheduled cleanup.
  - [x] Keep destructive/data-mutating tests local-only unless Preview parity and cleanup are
        proven.
  - [x] Reference `packages/testing` factories and cleanup standards where applicable.
  - [x] Document how existing local-only write-path tests are intentionally scoped.

- [x] Task 5: Clarify real-service vs stub policy (AC: #3, #6)
  - [x] State that Preview E2E may use real non-production services by default.
  - [x] Define when stubs are required: unsafe side effects, paid/rate-limited providers,
        unstable third-party systems, or missing/non-deterministic dependencies.
  - [x] Record the weather-provider posture for current tests:
        Preview can use approved non-production weather behavior; deterministic provider
        contracts and broader consumer-driven coverage belong to Story 0.14.
  - [x] Remove the old requirement that all CI/Preview testing must use a weather harness by
        default.

- [x] Task 6: Confirm minimal Preview smoke/regression coverage (AC: #2, #5)
  - [x] Confirm `playwright/tests/web-health-sha.spec.ts` verifies Preview health and deployed
        SHA.
  - [x] Confirm at least one representative data-backed or API-backed flow is covered in local
        E2E.
  - [x] Identify which flows are intentionally skipped outside local runs and why.
  - [x] Add only the smallest missing Preview-safe smoke check if the audit finds no
        representative Preview coverage beyond health/SHA.

- [x] Task 7: Record follow-up boundaries for Story 0.14 (AC: #6)
  - [x] Link Story 0.14 for OpenAPI/schema validation and Pact consumer/provider verification.
  - [x] Link Story 0.14 for performance baseline, k6 scenarios, and threshold reporting.
  - [x] Link Story 0.14 for Maestro analytics journey expansion and promotion criteria.
  - [x] Link Story 0.14 for known Preview deploy-path parity debt on write-path API E2E.

## Dev Notes

### Test-deployment stance

Preview tests without broad stubs are acceptable when Preview is bounded to non-production
resources. The control is not "stub everything." The control is that Preview must be disposable,
non-production, and unable to trigger irreversible production side effects.

Use stubs where they lower real risk: unsafe writes, paid/rate-limited dependencies, flaky external
providers, or unavailable services. Prefer real non-production services for Preview E2E when they
increase confidence without risking production data or accounts.

### Current evidence to preserve

- `README.md` documents that `npm run test:pw-preview` targets Vercel Preview, while `main`
  deploys to Production.
- `_bmad-output/test-artifacts/ci-cd-pipeline.md` documents the current CI/CD topology:
  PR branches to Vercel Preview and `main` to Vercel Production.
- `package.json` maps `test:pw-preview` to Preview URL resolution before running Playwright.
- `.github/workflows/pr-pw-e2e-local.yml` runs local Playwright E2E with local Supabase services,
  database reset, sharding, and burn-in behavior.
- `.github/workflows/pr-pw-e2e-vercel-preview.yml` resolves exact web/API Preview URLs, waits for
  matching deployed SHAs, and passes those URLs to the reusable E2E runner.
- `.github/workflows/rwf-e2e.yml` maps `TEST_ENV=preview` to Preview URL variables and `TEST_ENV=prod`
  to production URL variables.
- `playwright/tests/web-health-sha.spec.ts` validates health metadata and deployed SHA for Preview
  and Production-style targets.
- `playwright/tests/api/guardian-consent-lifecycle.spec.ts` intentionally skips non-local runs
  because the write-path creates users, invitations, queue records, and audit rows until Preview
  deploy-path parity is proven.

### Explicitly removed from this story

The previous draft described a six-environment provisioning effort and included malformed
placeholder paths. That model is no longer accurate for the current Vercel setup.

Removed/deferred scope:

- Any additional hosted deployment tier beyond Vercel Preview and Production.
- Mandatory weather harness for every CI/Preview run.
- Broad Expo/watch emulator matrix as a Story 0.12 deliverable.
- Health dashboard creation.
- Formal OpenAPI/schema/Pact contract gates.
- k6/performance baseline and thresholds.

Story 0.14 owns contract testing, performance baseline, Maestro analytics expansion, and current
Preview deploy-path parity debt.

### References

- [CI/CD pipeline](../test-artifacts/ci-cd-pipeline.md)
- [Test design system](../test-artifacts/test-design-system.md)
- [Testing standards](../test-artifacts/testing-standards.md)
- [Story 0.14](0-14-expand-test-infra-auth-contract-performance.md)
- [README](../../README.md)

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

Codex GPT-5

### Debug Log References

- `sed -n '1,260p' _bmad-output/implementation-artifacts/0-12-provision-test-environments-and-harness-services.md`
- `sed -n '1,220p' _bmad-output/test-artifacts/test-environments.md`
- `sed -n '35,70p' package.json`
- `sed -n '1,180p' .github/workflows/pr-pw-e2e-vercel-preview.yml`
- `sed -n '1,230p' .github/workflows/pr-pw-e2e-local.yml`
- `sed -n '1,240p' .github/workflows/rwf-e2e.yml`
- `sed -n '1,180p' playwright/tests/web-health-sha.spec.ts`
- `sed -n '1,180p' playwright/tests/api/guardian-consent-lifecycle.spec.ts`

### Completion Notes List

- Replaced the placeholder test-environments runbook with the supported Local, Vercel Preview,
  Production, and Mobile test topology.
- Documented that `TEST_ENV=preview` and `npm run test:pw-preview` target Vercel Preview, not a
  separate hosted deployment target.
- Captured current repo evidence for local PR E2E, Preview E2E, reusable E2E environment mapping,
  Preview URL resolution, deployed SHA checks, and local-only write-path guardrails.
- Documented Preview fixture/data policy and the real-service-vs-stub stance: Preview can use real
  non-production services, while stubs are reserved for unsafe, costly, flaky, rate-limited, or
  unavailable dependencies.
- Renamed Playwright Preview conventions to `TEST_ENV=preview`, `test:pw-preview`,
  `PREVIEW_WEB_E2E_BASE_URL`, `PREVIEW_API_BASE_URL`, and `DATABASE_URL_PREVIEW`.
- Removed the obsolete compatibility wrappers and environment fallbacks from scripts, workflows,
  and Playwright configuration.
- Left live secret-store confirmation open because this implementation did not inspect Vercel,
  GitHub, Supabase, Redis, storage, or provider dashboard secret values.

### File List

- ADDED: `playwright/config/preview.config.ts`
- ADDED: `scripts/set-preview-e2e-base-url.mjs`
- MODIFIED:
  `_bmad-output/implementation-artifacts/0-12-provision-test-environments-and-harness-services.md`
- MODIFIED: `_bmad-output/test-artifacts/ci-cd-pipeline.md`
- MODIFIED: `_bmad-output/test-artifacts/test-environments.md`
- MODIFIED: `.env.example`
- MODIFIED: `.github/workflows/pr-checks.yml`
- MODIFIED: `.github/workflows/pr-pw-e2e-local.yml`
- MODIFIED: `.github/workflows/pr-pw-e2e-vercel-preview.yml`
- MODIFIED: `.github/workflows/pw-e2e-trigger.yml`
- MODIFIED: `.github/workflows/rwf-burn-in.yml`
- MODIFIED: `.github/workflows/rwf-e2e.yml`
- MODIFIED: `README.md`
- MODIFIED: `package.json`
- MODIFIED: `playwright.config.ts`
- MODIFIED: `playwright/README.md`
- MODIFIED: `playwright/config/environments.ts`
- MODIFIED: `scripts/prisma-migrate-deploy.mjs`
- MODIFIED: `scripts/resolve-api-preview-url.mjs`
- MODIFIED: `scripts/resolve-vercel-preview-url.mjs`
- MODIFIED: `scripts/verify-changed.mjs`

## Change Log

| Date       | Author                         | Change                                                                                   |
| ---------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| 2025-11-13 | Bob (Scrum Master)             | Story drafted from Epic 0, CC-0.12 acceptance criteria                                   |
| 2026-05-01 | Murat (Test Architect) + Codex | Rewrote around Preview validation and removed stale scope                                |
| 2026-05-01 | Codex                          | Implemented runbook and checked off repo-evidenced Story 0.12 tasks                      |
| 2026-05-01 | Codex                          | Standardized Playwright Preview terminology and removed obsolete compatibility fallbacks |
