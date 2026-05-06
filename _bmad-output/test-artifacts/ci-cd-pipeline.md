# CI/CD pipeline

<!-- markdownlint-configure-file {"MD013": false} -->

Updated: 2026-05-01 - document Preview and Production as the deployed Vercel targets

## Overview

This repo uses GitHub Actions for CI and uses Vercel Git integration for web deployments:

- PR branches → Vercel Preview deployments
- `main` → Vercel Production deployments

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

### Advisory PR review

- CodeRabbit is intentionally advisory-first in this repository. The required merge check remains
  `PR Gate`; CodeRabbit is not part of that required status policy.
- Automatic review behavior is configured in `.coderabbit.yaml`; this repository does not rely on
  a separate GitHub Actions workflow to summon CodeRabbit on draft transitions.
- Initial review guidance is concentrated on higher-risk paths:
  `.github/workflows/**`, `playwright/**`, `apps/api/**`, and
  `_bmad-output/test-artifacts/**`.
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
