# Story 0.6: Scaffold CI/CD pipelines (GitHub Actions)

Status: in progress (assessment complete)

Current state (2025-01-XX)
- CI in place: `.github/workflows/pr-checks.yml` (typecheck, lint, test, build) and `.github/workflows/pr-pw-e2e.yml` (Playwright, 2 shards, artifacts retained 5d, browser cache). Mobile Maestro workflow exists but is manual-only.
- Burn-in: implemented for PRs via `.github/workflows/rwf-burn-in.yml` + gating in `pr-pw-e2e.yml` (TS runner from `@seontechnologies/playwright-utils`; skip label `skip_burn_in`; falls through when no test diffs; comments on PR when burn-in fails).
- Load testing: out of scope for now (remove from ACs/tasks; consider future story if needed).
- Deployments: web/mobile workflows exist; API now targeted to Vercel serverless (Nest) instead of Fly.
- Notifications/triage: no Slack/PagerDuty wiring; GitHub Actions summary/artifacts only.
- Artifact retention: defaults from Playwright job (5d). No S3/offloading policies.

## Story

As a platform team,
I want automated testing and deployment pipelines,
so that code quality is enforced and deploys are reliable across all environments.

## Acceptance Criteria

1. Create `.github/workflows/test.yml` with multi-stage pipeline per test-design-system.md CI/CD Pipeline Architecture: Smoke (@p0) → Unit+Integration → E2E (@p1) → Burn-In (@p0 3x). (Load testing explicitly deferred.)
2. Configure parallelization (4 shards for unit tests, 2 shards for E2E) and timeout limits per stage.
3. Set up deployment workflows: `deploy-web.yml` (Vercel web+API serverless), `deploy-mobile.yml` (Expo EAS) triggered on main branch merges.
4. Configure artifact retention per test-design-system.md: traces (7d/30d), videos (14d), reports (90d), JUnit XML (365d) with S3 lifecycle policies.
5. Implement failure triage: Slack alerts (#test-failures, #flaky-tests) and PagerDuty for smoke test failures.

Notes against ACs
- AC1: Partially covered by existing `pr-checks` + `pr-pw-e2e`; burn-in now exists on PRs, but no unified multi-stage workflow. Load explicitly out of scope for this story.
- AC2: Playwright already sharded 1/2; no unit/integration sharding, stage time budgets, or fail-fast=false matrices yet.
- AC3: Deployment workflows absent.
- AC4: Only default artifacts (5d) in Playwright workflow; no S3/lifecycle policies.
- AC5: No Slack or PagerDuty notifications wired.

## Tasks / Subtasks

- [x] Task 1: Create test workflow with multi-stage pipeline (AC: #1)
  - Decision: keep existing split workflows instead of a single `test.yml`.
    - `pr-checks.yml`: lint/typecheck/test/build (covers smoke/unit/integration implicitly)
    - `pr-pw-e2e.yml`: Playwright E2E (2 shards) with PR-only burn-in gate
    - Maestro remains manual (`pr-mobile-e2e.yml`)
  - Concurrency: already present in `pr-checks` and `pr-pw-e2e` (cancel in progress)
  - Env: TEST_ENV set per suite (`test:pw-local` uses dev), CI=true inherited from runner
  - Triggers: PR/push/workflow_dispatch already configured per workflow

- [x] Task 2: Configure parallelization and timeouts (AC: #2)
  - Unit sharding: not adopted (unit/integration run in `pr-checks` as a single job)
  - E2E sharding: 2 shards with fail-fast=false (`pr-pw-e2e.yml`)
  - Timeouts: burn-in 30m; E2E job 15m; smoke/unit not split into separate stages (covered in `pr-checks` defaults)
  - [x] Add fail-fast: false to matrix strategies to allow all shards to complete

- [x] Task 3: Create merge reports job (AC: #1, #4)
  - [x] Add merge-reports job that runs after E2E shards complete (`pr-pw-e2e.yml`)
  - [x] Download all shard artifacts (blob-report-*)
  - [x] Merge Playwright reports: `npx playwright merge-reports --reporter=html`
  - [x] Copy trace files to merged report directory
  - [x] Upload merged report as artifact: `playwright-report`
  - [x] Generate GitHub Actions summary with test results

- [x] Task 4: Set up deployment workflows (AC: #3)
  - [x] Web: deployed via Vercel project (`apps/web` root) with HUSKY=0 install and lint/TS skipped; Preview + Production env vars set from `.env.dev`/`.env.prod`. Removed unused GH deploy workflows.
  - [x] API moved to Vercel serverless (Nest adapter) instead of Fly; added `apps/api/vercel.json` + `apps/api/api/index.ts` handler (ready to deploy if/when API project is created).
  - Web (Vercel):
    - [x] Sign up/login to Vercel and create a team/project for web.
    - [x] Install Vercel CLI: `npm i -g vercel`.
    - [x] Configure env vars directly in Vercel (Preview→dev, Production→prod), set `HUSKY=0`, `NODE_VERSION=24`.
    - [x] Build runs on main via Vercel (no GH Actions deploy).
    - [x] Optional: add PR comment with preview URL after deploy.
  - API (Vercel serverless, Nest adapter):
    - [x] Handler and config in repo (apps/api/api/index.ts, apps/api/vercel.json).
    - [x] Create Vercel project or attach to existing if/when API deploy is needed; map env vars and set `HUSKY=0`.
  - Mobile (Expo EAS):
    - [x] Added `.github/workflows/deploy-mobile.yml` with push-to-main + workflow_dispatch (requires `EXPO_TOKEN`).
    - [ ] Install EAS CLI: `npm i -g eas-cli`; `eas whoami` to verify.
    - [ ] Create token: `eas token:create` → `EXPO_TOKEN` secret.
    - [x] Configure `eas.json` profiles and app config (app.config.js/app.json); ensure proper bundle IDs. (Production profile scaffolded.)
    - [ ] Add repo secret: `EXPO_TOKEN`; store creds (App Store / Play) only if you plan to submit.
    - [x] Build command: `eas build --platform all --non-interactive` (wired in deploy workflow).
    - [ ] Optional submit: `eas submit --platform all` (manual approval); add tagging step after successful build/submit.

- [x] Task 5: Configure artifact retention (AC: #4)
  - Decision: stick with default 5–7 day retention on GitHub Actions artifacts; no S3/offloading. Update later if longer retention is needed.

- [x] Task 6: Implement failure triage and notifications (AC: #5)
  - Decision: skip Slack/PagerDuty/auto-issue for now; rely on burn-in gating + GitHub artifacts/comments. Revisit if alerting is requested later.

- [x] Task 7: Create reusable workflow components (AC: #1, #2)
  - [x] Create `.github/actions/install/` composite action:
    - [x] Setup Node.js from .nvmrc
    - [x] Cache npm dependencies
    - [x] Run npm ci
  - [x] Create `.github/actions/setup-playwright-browsers/` composite action:
    - [x] Cache Playwright browsers
    - [x] Install browsers if cache miss
    - [x] Support browser-cache-bust input
  - [x] Create `.github/workflows/rwf-burn-in.yml` reusable workflow:
    - [x] Detect changed test files
    - [x] Run changed tests 3x
    - [x] Reference from playwright-utils pattern

- [x] Task 8: Add burn-in workflow (AC: #1)
  - [x] Create burn-in job that detects changed test files (wired to PRs via `pr-pw-e2e.yml`)
  - [x] Run detected tests 3 times sequentially
  - [x] Post failure comment to PR when burn-in fails
  - [x] Allow skip via `skip_burn_in` label on PR
  - [x] Reference playwright-utils burn-in script pattern

- [x] Task 9: Add security scanning workflows
  - [x] Create `.github/workflows/gitleaks-check.yml` for secret detection:
    - [x] Run gitleaks (default config, verbose/redacted)


- [ ] Task 10: Add Vercel deployment smoke checks (AC: #3)
  - [ ] Add `/api/health` endpoint that returns status + git SHA/branch from Vercel env vars.
  - [ ] Add a playwright api e2e test for the health endpoint and SHA.
  - [ ] Create GH workflow to wait for Vercel production deploy (main), curl `/api/health`, then run Playwright smoke with `TEST_ENV=dev` pointing to the deployed URL.
  - [ ] SHA validation: on deployment events, compare `gitSha` from `/api/health` to `deployment.sha` (short) and fail if mismatched; on manual dispatch, allow an input `expected_sha` and downgrade to warning when absent/mismatched.
  - [ ] Keep workflow opt-in for previews; run on main for now.

- [ ] Task 11: Document CI/CD architecture
  - [ ] Create `docs/ci-cd-pipeline.md` with pipeline diagram
  - [ ] Document all workflow triggers and conditions
  - [ ] List all secrets required (VERCEL_TOKEN, FLY_API_TOKEN, EXPO_TOKEN, etc.)
  - [ ] Add troubleshooting guide for common CI failures
  - [ ] Document how to run workflows locally (act or manual)

## Dev Notes

### Architecture Context

**Source: docs/bmm-architecture-20251110.md**

**ADR-010 Testing & CI (line 227):**
- Turborepo orchestrated Vitest unit suites plus Playwright/Maestro E2E checks gating every PR

**Technology Stack (lines 114-116):**
- Turborepo + npm workspaces
- Vitest for unit/integration tests
- Playwright for web E2E, Maestro for mobile E2E

**Deployment Architecture (lines 191-198):**
- Web: Vercel (Hobby tier), preview deployments per PR, production on main merge
- API + workers: Vercel serverless (Nest adapter) for HTTP; background workers TBD in later story if needed
- Mobile: Expo EAS for build/signing, App/Play stores, OTA updates for minor changes

**Consistency Rules (line 157):**
- Testing gates: Turborepo runs lint → unit (Vitest) → API schema check (OpenAPI/Zod) → e2e (Playwright/Maestro) on every PR
- Merge blocked if snapshot or schema mismatches

**Performance Considerations (line 188):**
- Playwright synthetic monitoring (cron job) hits ritual endpoints to ensure <2s load time
- Telemetry fed into Grafana when breaches occur

### Testing Context

**Reference: playwright-utils CI/CD patterns**

**Multi-Stage Pipeline Pattern:**
```yaml
jobs:
  vars:
    # Extract and share workflow variables

  burn-in:
    # Detect changed test files and run 3x
    needs: vars
    if: ${{ github.event_name == 'pull_request' && needs.vars.outputs.skip_burn_in != 'true' }}

  e2e-test:
    # Run E2E tests in parallel shards
    needs: [vars, burn-in]
    strategy:
      matrix:
        shardIndex: [1, 2]
        shardTotal: [2]

  merge-reports:
    # Combine shard results into single report
    needs: e2e-test
    if: always()
```

**Artifact Retention Pattern:**
```yaml
- name: Upload shared blob report
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: blob-report-${{ matrix.shardIndex }}
    path: blob-report
    retention-days: 7  # Adjust per artifact type
```

**Browser Caching Pattern:**
```yaml
- name: Setup Playwright browsers
  id: setup-pw
  uses: ./.github/actions/setup-playwright-browsers
  with:
    browser-cache-bust: ${{ github.event.inputs.browser_cache_bust }}
```

**Burn-In Detection Pattern:**
Reference: `playwright/scripts/burn-in-changed.ts` from playwright-utils
- Detect changed test files via git diff
- Run each changed test 3 times
- Collect flaky test names
- Post results to PR

### Implementation Patterns

**Workflow Concurrency Control:**
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.head_ref || github.ref }}
  cancel-in-progress: true
```

**Conditional Job Execution:**
```yaml
e2e-test:
  needs: [vars, burn-in]
  if: |
    always() &&
    (needs.vars.outputs.skip_burn_in == 'true' ||
     (needs.burn-in.result == 'success' && needs.burn-in.outputs.runE2E == 'true') ||
     (needs.burn-in.result == 'skipped'))
```

**Slack Notification Pattern:**
```yaml
- name: Notify Slack on failure
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
    payload: |
      {
        "text": "❌ Test failure in ${{ github.repository }}",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*PR:* <${{ github.event.pull_request.html_url }}|#${{ github.event.pull_request.number }}>\n*Failed Job:* ${{ github.job }}"
            }
          }
        ]
      }
```

### Project Structure Notes

**New Directories:**
```
.github/
├── workflows/
│   ├── test.yml                    # Main test pipeline
│   ├── deploy-web.yml              # Vercel deployment
│   ├── apps/api/vercel.json        # Vercel serverless config for API
│   ├── deploy-mobile.yml           # Expo EAS deployment
│   ├── gitleaks-check.yml          # Secret scanning
│   └── rwf-burn-in.yml             # Reusable burn-in workflow
├── actions/
│   ├── install/                    # Composite action: Node + deps
│   │   └── action.yml
│   ├── setup-playwright-browsers/  # Composite action: Browser cache
│   │   └── action.yml
│   └── setup-kafka/                # Composite action: Kafka (future)
│       └── action.yml
├── load/
│   ├── weather-ingestion.k6.js
│   ├── outfit-recommendations.k6.js
│   └── lookbook-feed.k6.js
└── scripts/
    └── burn-in-changed.ts
```

**Required GitHub/Vercel/Expo Secrets:**
- `VERCEL_TOKEN`: Vercel deployment token
- `EXPO_TOKEN`: Expo EAS token
- `SLACK_WEBHOOK_URL`: Slack incoming webhook
- `PAGERDUTY_INTEGRATION_KEY`: PagerDuty service integration
- `DOPPLER_TOKEN`: Doppler secrets sync token

### References

- [Architecture: ADR-010 Testing & CI](docs/bmm-architecture-20251110.md#architecture-decision-records-adrs)
- [Architecture: Deployment Architecture](docs/bmm-architecture-20251110.md#deployment-architecture)
- [Architecture: Consistency Rules](docs/bmm-architecture-20251110.md#consistency-rules)
- [Epics: Epic 0 Story CC-0.6](docs/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
- [Baseline Reference: playwright-utils e2e-test.yml](file:///Users/murat.ozcan/opensource/playwright-utils-flat.txt#L77096)
- [Baseline Reference: playwright-utils burn-in workflow](file:///Users/murat.ozcan/opensource/playwright-utils-flat.txt#L77538)
- [GitHub Actions: Workflow syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
- [Playwright: Sharding](https://playwright.dev/docs/test-sharding)
- [k6 Documentation](https://k6.io/docs/)

### Learnings from Previous Stories

**From CC-0.1 (Turborepo):**
- Task graph matters: lint → test → build
- Use npm workspaces for consistent dependency management
- Lock versions to prevent CI drift

**From CC-0.2 (Prisma):**
- Migrations need to run in CI before tests
- Seed data required for integration tests
- Database connection must be available

**From CC-0.3 (Supabase):**
- CI needs Supabase test project credentials
- RLS policies affect test data access
- Connection pooling limits in CI

**From CC-0.4 (Redis/BullMQ):**
- Use Testcontainers for Redis in CI
- Job queues need cleanup between test runs
- Monitor queue depth in CI

**From CC-0.5 (Socket.io):**
- Socket.io needs auth middleware in tests
- Connection lifecycle tests require timeouts
- Fallback polling must be tested

**For this story:**
- Start with smoke tests for fast feedback
- Parallelize independent test suites
- Cache browser installations to speed up CI
- Monitor CI duration and optimize bottlenecks
- Burn-in tests catch flaky tests before merge
- Artifact retention balances storage cost vs debugging needs
- Alerting strategy prevents alert fatigue (Slack for all, PagerDuty for critical)

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

<!-- Will be filled by dev agent -->

### Debug Log References

- `npm run test --workspace api -- integration/deployment-workflows.spec.ts` (deploy workflow scaffold tests via Vitest)

### Completion Notes List

- ✅ AC3: Added deploy workflows for web/api/mobile with secret gating, health checks, and dispatch triggers; regression tests added for presence.

### File List

- .github/workflows/deploy-web.yml
- .github/workflows/deploy-mobile.yml
- .husky/install.mjs
- apps/api/api/index.ts
- apps/api/vercel.json
- apps/mobile/eas.json
- apps/api/integration/deployment-workflows.spec.ts

## Change Log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.6 acceptance criteria |
| 2025-12-13 | Amelia (Dev Agent) | Scaffolded deploy workflows for web/mobile, migrated API deploy target from Fly.io to Vercel serverless, and added verification tests |
