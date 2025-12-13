# CI/CD pipeline

Updated: 2025-12-13 — run Playwright smoke on Vercel Preview deployments

## Overview

This repo uses GitHub Actions for CI and uses Vercel Git integration for web deployments:

- PR branches → Vercel Preview deployments
- `main` → Vercel Production deployments

In CI, we treat Vercel Preview URLs as the "dev" target for `npm run test:pw-dev`.

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

Playwright environment selection uses `TEST_ENV`:

- `TEST_ENV=dev` uses `DEV_WEB_E2E_BASE_URL` (CI sets this to the Vercel Preview URL)
- `TEST_ENV=prod` uses `PROD_WEB_E2E_BASE_URL` (set to your production domain)

## Workflows

### CI (PR)

- `.github/workflows/pr-checks.yml`: lint/typecheck/unit tests/build on PRs.
- `.github/workflows/pr-pw-e2e.yml`: Playwright E2E sharded on PRs (includes burn-in gate).
- `.github/workflows/gitleaks-check.yml`: secret scanning.

### Vercel Preview smoke

- `.github/workflows/vercel-preview-smoke.yml`: runs Playwright smoke against the Vercel Preview URL once Vercel reports a successful deployment status.

### Deploy (mobile)

- `.github/workflows/deploy-mobile.yml`: EAS build on `main` (requires `EXPO_TOKEN`).

### Manual E2E

- `.github/workflows/pw-e2e-trigger.yml`: manual dispatch for `dev`/`prod` E2E runs.

## Vercel configuration (manual)

1. Ensure Vercel posts GitHub Deployment Status events:
   - Vercel Project → Settings → Git → enable `deployment_status Events`

2. If Vercel Preview deployments are protected (health check returns 401):
   - Create a Protection Bypass token in Vercel (Project → Settings → Deployment Protection → Protection Bypass)
   - Add it to GitHub repo secrets as `VERCEL_PROTECTION_BYPASS`

`playwright/tests/web-health-sha.spec.ts` automatically adds the bypass headers when the secret is present.

## Required secrets

GitHub repo secrets:

- `EXPO_TOKEN` (mobile deploy)
- `VERCEL_PROTECTION_BYPASS` (optional; only needed if Preview deployments are protected)

## Troubleshooting

- Preview smoke workflow never runs: confirm `deployment_status Events` is enabled in Vercel Git settings.
- Health check returns 401: set `VERCEL_PROTECTION_BYPASS` or disable Preview protection in Vercel.
- SHA mismatch: `/api/health.gitSha` must match the deployed commit (`VERCEL_GIT_COMMIT_SHA`).
- Playwright hits the wrong base URL: set `DEV_WEB_E2E_BASE_URL` / `PROD_WEB_E2E_BASE_URL`.

## Run locally

- CI checks: `npm run validate`
- Playwright smoke (dev): `TEST_ENV=dev npx playwright test playwright/tests/web-health-sha.spec.ts`
- Playwright smoke (prod): `TEST_ENV=prod npx playwright test playwright/tests/web-health-sha.spec.ts`
