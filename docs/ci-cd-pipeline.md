# CI/CD pipeline

## Overview

This repo uses GitHub Actions for CI (checks + E2E) and controlled deployments.

```mermaid
flowchart TD
  PR[Pull request] --> PRChecks[pr-checks.yml]
  PR --> PRE2E[pr-pw-e2e.yml]
  PR --> VercelPreview[Vercel Preview deploy]
  VercelPreview --> PreviewSmoke[vercel-preview-smoke.yml (web-health-sha)]
  PRChecks --> Merge[Merge to main]
  PRE2E --> Merge
  Merge --> VercelProd[Vercel Production deploy (main)]
```

## Environments

Vercel has two deploy environments:

- Preview = treated as "dev" in this repo
- Production = production

Playwright environment selection uses `TEST_ENV`:

- `TEST_ENV=dev` uses `DEV_WEB_E2E_BASE_URL` (defaults to `https://dev.couturecast.app`)
- `TEST_ENV=prod` uses `PROD_WEB_E2E_BASE_URL`

## Workflows

### CI (PR)

- `.github/workflows/pr-checks.yml`: lint/typecheck/unit tests/build on PRs.
- `.github/workflows/pr-pw-e2e.yml`: Playwright E2E sharded on PRs (includes burn-in gate).
- `.github/workflows/gitleaks-check.yml`: secret scanning.
- `.github/workflows/vercel-preview-smoke.yml`: runs Playwright smoke against the Vercel Preview URL once Vercel reports a successful deployment status.

### Deploy (mobile)

- `.github/workflows/deploy-mobile.yml`: EAS build on `main` (requires `EXPO_TOKEN`).

### Manual E2E

- `.github/workflows/pw-e2e-trigger.yml`: manual dispatch for `dev`/`prod` E2E runs.
- `.github/workflows/dev-pw-e2e.yml`: manual dispatch for `dev` E2E runs.

## Vercel configuration (manual)

Production Deployment Protection (Vercel Settings -> Deployment Protection) is a paid feature and not required
for this setup.

To run smoke tests against Vercel Preview deploys, Vercel must be posting GitHub Deployment Status events.
This is controlled in Vercel Project -> Settings -> Git.

To prevent accidental production deploys from `main` via Vercel Git integration, use one of these options:

1. Vercel Project → Settings → Git
2. If you see a Production Branch setting, set it to a non-`main` branch (for example `production`).

If you do not see a Production Branch setting (or you want to keep PR preview deploys but stop `main` deploys):

1. Vercel Project → Settings → Git → Ignored Build Step
2. Set Behavior to Custom
3. Use this command and save:
   - `if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 0; else exit 1; fi`

If you do not need Vercel Git deployments at all, you can instead disconnect the repo:

1. Vercel Project → Settings → Git → Connected Git Repository
2. Click Disconnect

If you want a stable dev URL:

1. Add `dev.couturecast.app` as a domain on the Vercel project
2. Manually assign the domain to the desired branch/deployment in Vercel

## Required secrets and variables

GitHub repo secrets:

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (reserved; only needed if later using Vercel CLI in Actions)
- `EXPO_TOKEN` (mobile deploy)
- `SLACK_WEBHOOK_URL` (reserved; not wired in current workflows)
- `PAGERDUTY_INTEGRATION_KEY` (reserved; not wired in current workflows)
- `DOPPLER_TOKEN` (reserved; only needed once Doppler sync is implemented)
- `FLY_API_TOKEN` (legacy; API deploy target is Vercel, not Fly.io)

GitHub repo variables:

- `VERCEL_DEV_DOMAIN` (legacy; used only when deploying via Vercel CLI in GitHub Actions)

## Troubleshooting

- Vercel deploy fails with missing secrets: set `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` in repo secrets.
- Dev smoke fails with SHA mismatch: check `/api/health` on the deployment; it must report the commit being deployed.
- Playwright hits the wrong base URL: set `DEV_WEB_E2E_BASE_URL` / `PROD_WEB_E2E_BASE_URL` for the workflow/job.

## Run locally

- CI checks: `npm run validate`
- Playwright smoke (dev): `TEST_ENV=dev npx playwright test playwright/tests/web-health-sha.spec.ts`
- Playwright smoke (prod): `TEST_ENV=prod npx playwright test playwright/tests/web-health-sha.spec.ts`
