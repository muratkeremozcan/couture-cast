# CI/CD pipeline

<!-- markdownlint-configure-file {"MD013": false} -->

Updated: 2026-11-12 - lane selection on pull requests, and production deployments from CI
Updated: 2026-11-12 - PR job ceilings at 20 minutes and CI's local Supabase ports
Updated: 2026-05-01 - document Preview and Production as the deployed Vercel targets

## Overview

This repo uses GitHub Actions for CI, and CI creates every Vercel deployment (no git push does,
`git.deploymentEnabled: false` in each `vercel.json`):

- PR branches → Vercel Preview deployments, when the preview lane runs
- `main` → Vercel Production deployments from `pw-e2e-prod.yml`, when web or API inputs changed

In CI, Vercel Preview URLs are the `preview` Playwright target. PRs use Preview and `main` uses
Production.

```mermaid
flowchart TD
  PR[Pull request] --> PRChecks[pr-checks.yml]
  PR --> PRE2E[pr-pw-e2e-local.yml]
  PR --> VercelPreview[Vercel Preview deploy]
  VercelPreview --> PreviewSmoke[pr-pw-e2e-vercel-preview.yml (web-health-sha)]
  PRChecks --> Merge[Merge to main]
  PRE2E --> Merge
  Merge --> VercelProd[Vercel Production deploy (main)]
```

## Environments

Playwright environment selection uses `TEST_ENV`:

- `TEST_ENV=preview` uses `PREVIEW_WEB_E2E_BASE_URL` (CI sets this to the Vercel Preview URL)
- `TEST_ENV=prod` uses `PROD_WEB_E2E_BASE_URL` (set to your production domain)

## Workflows

### CI (PR)

- `.github/workflows/pr-checks.yml`: lint/typecheck/unit tests/build on PRs.
- `.github/workflows/pr-pw-e2e-local.yml`: Playwright E2E sharded on PRs (includes burn-in gate).
- `.github/workflows/gitleaks-check.yml`: secret scanning.
- `CodeRabbit` GitHub App: advisory PR review on `main`-bound pull requests once the app is
  installed; repo guidance lives in `.coderabbit.yaml`.

### Job ceilings and local Supabase in CI

- No job a pull request runs may take longer than 20 minutes. Each ceiling comes from the last
  20 runs, and `scripts/ci/pr-job-ceilings.test.mjs` fails any PR job, reusable workflows
  followed, whose `timeout-minutes` is over 20 or unset. The same test pins the lanes skipped on
  pull requests (the share-card device lanes and the iOS release build), so none is skipped
  silently.
- CI's local Supabase binds the ports in `.github/supabase-ci-ports.env` (2432x), below 32768
  and so outside the Linux and macOS ephemeral ranges: the runner's own connection once held
  54322 for a whole job. `configure-ci-supabase-ports`, the first step after checkout, exports
  them with `LOCAL_DATABASE_URL`; `scripts/lib/local-supabase-ports.mjs` resolves them in every
  script and guard. Developers keep `supabase/config.toml`'s 5432x.
- Every command on the start path runs under a limit (`start-local-supabase`), an attempt runs
  at most 170 s, and the 360 s budget is an absolute deadline: login, status, diagnostics and
  stop all get at most what is left of it. Each caller stops the step at 10 minutes, keeps its
  log on failure and then stops the containers a failed start left
  (`scripts/ci/supabase-start-bounds.test.mjs`).
- The share-card browser matrix runs on one Playwright worker. Three workers (one fixture set
  per browser and spec) took 1.4 minutes locally against 3.4 serial, but 6.4 minutes on the
  4-vCPU runner against 5.4 serial: three browsers, the web server, the API and Postgres
  saturate it, so each case ran three times slower. The parallel matrix was reverted.
- `actions-cache-prune.yml` keeps the 10 GB Actions cache clear of closed pull requests and
  keys unread for 48 hours (`scripts/ci/prune-actions-cache.mjs`), daily and when a pull request
  closes, so GitHub's own eviction never pushes out a live key.

### Lane selection on pull requests

- `scripts/ci/lanes.mjs` is the one input map: each lane names the files it builds, runs or reads
  (workspaces with their `@couture` dependencies, plus extra paths). A `lanes` job at the head of
  each pull request workflow reads the PR's changed files from the API and gates the lane's jobs
  with `fromJSON(needs.lanes.outputs.plan)['<lane>']`. PR Gate counts a skipped job as passing;
  the lanes job summary names each skipped lane and why.
- Workflows, actions, scripts, root configuration, the lockfile and any path no lane claims run
  every lane. Docs run none, unless a test reads them (`DOC_INPUTS`). Lint, the secrets scan and
  burn-in of changed specs run on every pull request.
- Push to `main`, the schedules, manual runs and the `ALL-LANES` label run every lane. The label
  is read when the lanes job runs, so add it and rerun the workflows.
- `scripts/ci/lanes.test.mjs` replays the last 60 merged PRs and checks that every repository
  file a test names wakes the lanes that run that test; `lanes-wiring.test.mjs` holds the
  workflows to the map.
- `node scripts/ci/node-test-gate.mjs --local` runs every gate suite locally after checking each
  suite's declared setup (install, Android prebuild, API build), and names what is missing.

### Production deployments

- `pw-e2e-prod.yml` runs `scripts/vercel-preview-deploy.mjs <web|api> --production` on each push
  to `main`. It creates a production deployment only when the project's build inputs or its
  production configuration differ from the deployment production serves, so a CI or docs merge
  spends none of Hobby's 100 deployments a day. The health waits and the production e2e run
  expect the commit the deploy step reports. A manual run with `force_deploy` builds both.

### Advisory PR review

- CodeRabbit is intentionally advisory-first in this repository. The required merge check remains
  `PR Gate`; CodeRabbit is not part of that required status policy.
- Automatic review behavior is configured in `.coderabbit.yaml`; this repository does not rely on
  a separate GitHub Actions workflow to summon CodeRabbit on draft transitions.
- Review guidance covers application, CI, database, Playwright, Pact, k6, Maestro, infrastructure,
  and API-contract paths. Incremental review runs after each push.
- Generated outputs, binary artifacts, lockfiles, and `_bmad-output/**` are excluded so review
  attention stays on executable code, contracts, tests, and operational documentation.
- Manual commands remain available in any PR comment:
  `@coderabbitai review`, `@coderabbitai full review`, `@coderabbitai pause`,
  `@coderabbitai resume`.

### Vercel Preview smoke

- `.github/workflows/pr-pw-e2e-vercel-preview.yml`: runs Playwright smoke against the Vercel Preview URL once Vercel reports a successful deployment status.

### Deploy (mobile)

- `.github/workflows/deploy-mobile.yml`: Manual dispatch only (no auto-run on main); EAS build for Android-only to avoid iOS Apple Developer enrollment (requires `EXPO_TOKEN`).
- Local helper scripts (root):
  - `npm run mobile:build` → `eas build --profile production --platform android` (uses `apps/mobile/eas.json`, `appVersionSource: local`)
  - `npm run mobile:submit` → `eas submit --profile production --platform android --non-interactive`
- Project linking & config:
  - `apps/mobile/app.json`: name/slug `couture-cast`, owner `muratkerem` (linked to EAS project `@muratkerem/couture-cast`)
  - `apps/mobile/eas.json`: production profile (autoIncrement, Android app-bundle, iOS m-medium), `appVersionSource: local`
- Credentials:
  - Android keystore generated once via `eas credentials:configure-build --platform android --profile production` (interactive)
  - iOS disabled for now (would require paid Apple Developer enrollment and interactive first build to create certs/profiles)
- EXPO_TOKEN: create via Expo UI (Account → Access Tokens), add as repo secret and export locally before running scripts

### Manual E2E

- `.github/workflows/pw-e2e-trigger.yml`: manual dispatch for `preview`/`prod` E2E runs.
- `.github/workflows/pr-mobile-e2e.yml`: manual-only Maestro mobile runs. The `flow` dispatch
  input supports `sanity` and `analytics`; the analytics flow enables
  `MOBILE_ANALYTICS_DIAGNOSTICS=1`, stores JUnit/debug output under `maestro/artifacts/`, and stays
  advisory via `continue-on-error: true`.

### Mobile analytics advisory path

- Android command: `npm run test:mobile:e2e:android`.
- iOS command: `npm run test:mobile:e2e:ios`.
- Flows: `maestro/sanity.yaml` and `maestro/analytics.yaml`.
- Promotion criteria: `_bmad-output/test-artifacts/maestro-analytics-promotion.md`.
- Required PR gating remains disabled until the reliability thresholds in that artifact are met.

## Vercel configuration (manual)

1. Ensure Vercel posts GitHub Deployment Status events:
   - Vercel Project → Settings → Git → enable `deployment_status Events`

2. If Vercel Preview deployments are protected (health check returns 401):
   - Create a Protection Bypass token in Vercel (Project → Settings → Deployment Protection → Protection Bypass)
   - Add it to GitHub repo secrets as `VERCEL_AUTOMATION_BYPASS_SECRET`

`playwright/tests/web-health-sha.spec.ts` automatically adds the bypass headers when the secret is present.

## Required secrets

GitHub repo secrets:

- `EXPO_TOKEN` (mobile deploy)
- `VERCEL_AUTOMATION_BYPASS_SECRET` (optional; only needed if Preview deployments are protected)
- `VERCEL_TOKEN` (for Vercel API Preview resolution)

Vercel project/team slugs are non-secret configuration. The reusable E2E workflow accepts
`vercel_web_project_slug`, `vercel_api_project_slug`, and `vercel_team_slug` inputs with repo
defaults.

## Troubleshooting

- Preview smoke workflow never runs: confirm `deployment_status Events` is enabled in Vercel Git settings.
- Health check returns 401: set `VERCEL_AUTOMATION_BYPASS_SECRET` or disable Preview protection in Vercel.
- SHA mismatch: `/api/health.gitSha` must match the deployed commit (`VERCEL_GIT_COMMIT_SHA`).
- Playwright hits the wrong base URL: set `PREVIEW_WEB_E2E_BASE_URL` / `PROD_WEB_E2E_BASE_URL`, or run `npm run test:pw-preview` to
  auto-resolve the current branch's Preview URL (requires branch pushed, `gh` auth, and Vercel CLI token). If Vercel uses a shortened or
  custom preview hostname, set `VERCEL_BRANCH_ALIAS_URL=https://<your-preview>.vercel.app` to force it.

## Run locally

- CI checks: `npm run validate`
- Playwright smoke (preview): `TEST_ENV=preview npx playwright test playwright/tests/web-health-sha.spec.ts`
- Playwright smoke (prod): `TEST_ENV=prod npx playwright test playwright/tests/web-health-sha.spec.ts`
