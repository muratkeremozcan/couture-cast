# Test environments

<!-- markdownlint-configure-file {"MD013": false} -->

Updated: 2026-05-01 - Align runbook with the Vercel Preview and Production deployment model.

Status: active

## Purpose

This runbook defines the supported CoutureCast test topology, how Playwright maps
environment names to URLs, which workflows exercise each target, and which controls keep PR tests
from affecting production resources.

## Supported topology

| Environment    | Purpose                                                       | Deployment/source                                                       | Test posture                                                                    |
| -------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Local          | Fast validation with resettable services                      | Engineer machine or GitHub runner using local Supabase/API/web services | Required for PR E2E via `pr-pw-e2e-local.yml`                                   |
| Vercel Preview | PR deployed validation against branch web and API deployments | Vercel Preview deployments for pull-request branches                    | Required Preview smoke/E2E when the `PREVIEW` label or synchronize trigger runs |
| Production     | Live runtime created from `main`                              | Vercel Production deployment                                            | Manual or scheduled smoke only; destructive tests are excluded                  |
| Mobile         | Expo app validation                                           | Local Expo/Simulator or manual EAS build                                | Manual/local-only unless Story 0.14 promotes Maestro coverage                   |

Only two Vercel deployment classes are supported: Preview and Production. PR branches validate in
Preview; after merge, `main` deploys to Production. Playwright names those targets
`TEST_ENV=preview` and `TEST_ENV=prod`.

## Workflow map

| Workflow or command                              | Target                  | Notes                                                                            |
| ------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------- |
| `npm run test:pw-local`                          | Local                   | Builds shared packages, sets `TEST_ENV=local`, and runs Playwright.              |
| `npm run test:pw-preview`                        | Vercel Preview          | Resolves current branch Preview URLs before running Playwright.                  |
| `npm run test:pw-prod`                           | Production              | Runs Playwright with `TEST_ENV=prod`; use only smoke-safe specs.                 |
| `.github/workflows/pr-pw-e2e-local.yml`          | Local PR gate           | Starts local Supabase, resets the database, runs burn-in and sharded Playwright. |
| `.github/workflows/pr-pw-e2e-vercel-preview.yml` | Vercel Preview          | Resolves exact web/API Preview URLs, waits for matching SHAs, then runs E2E.     |
| `.github/workflows/rwf-e2e.yml`                  | Reusable E2E runner     | Maps `local`, `preview`, and `prod` to the correct URL and database variables.   |
| `.github/workflows/pw-e2e-trigger.yml`           | Manual preview/prod E2E | Manual dispatch for targeted deployed-environment checks.                        |
| `.github/workflows/pr-mobile-e2e.yml`            | Mobile manual smoke     | Manual-only Maestro Android smoke until reliability criteria are met.            |

## URL and environment variables

| Variable                          | Used by                              | Meaning                                                                    |
| --------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `WEB_E2E_BASE_URL`                | Local Playwright                     | Local web origin override; defaults to `http://localhost:3005`.            |
| `API_BASE_URL`                    | Local Playwright                     | Local API origin override; defaults to `http://localhost:4000`.            |
| `PREVIEW_WEB_E2E_BASE_URL`        | Preview Playwright                   | Exact Vercel web Preview URL passed by CI or local override.               |
| `PREVIEW_WEB_BASE_URL`            | Preview Playwright                   | Optional general Preview web origin fallback.                              |
| `PREVIEW_API_BASE_URL`            | Preview Playwright                   | Exact Vercel API Preview URL passed by CI or local override.               |
| `PROD_WEB_E2E_BASE_URL`           | Production Playwright                | Production web origin override.                                            |
| `PROD_WEB_BASE_URL`               | Production Playwright                | Optional general Production web origin fallback.                           |
| `PROD_API_BASE_URL`               | Production Playwright                | Production API origin override.                                            |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Preview/Production protected deploys | Optional Vercel deployment-protection bypass for health and smoke checks.  |
| `DATABASE_URL_PREVIEW`            | Reusable E2E workflow                | Non-production database URL for Preview-oriented tests.                    |
| `DATABASE_URL_PROD`               | Reusable E2E workflow                | Production database URL; never use for destructive or data-mutating tests. |

Local `.env.preview` may contain Preview secrets and Vercel discovery configuration. `VERCEL_TOKEN`
and `VERCEL_AUTOMATION_BYPASS_SECRET` are secrets. `VERCEL_WEB_PROJECT_SLUG`,
`VERCEL_API_PROJECT_SLUG`, and `VERCEL_TEAM_SLUG` are non-secret project identifiers used for URL
resolution. Keep secret values gitignored and never paste them into this document.

## Secret and resource boundaries

Preview tests may use real non-production services. The control is that Preview is bounded and
disposable, not that every integration is stubbed.

Rules:

- Preview must not target production Supabase, production Redis, production storage buckets, or
  production write-capable provider credentials.
- Preview credentials must be scoped to non-production data and provider accounts.
- Production credentials are available only to Production runtime and production-safe smoke paths.
- `VERCEL_AUTOMATION_BYPASS_SECRET` is a deployment access-control secret, not an app runtime
  credential.
- No doc, screenshot, test artifact, or PR comment should include raw secret values.

Manual verification still required:

| Item                                                                            | Status                        | Owner/action                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| Vercel Preview env vars point to non-production Supabase/database resources     | Pending dashboard check       | Verify in Vercel project settings without copying values.                           |
| Preview does not expose production write-capable Redis/storage/provider secrets | Pending dashboard check       | Compare variable names and scopes in Vercel Preview vs Production.                  |
| GitHub repo secrets mirror the intended Preview/Production split                | Pending GitHub settings check | Confirm `DATABASE_URL_PREVIEW` and `DATABASE_URL_PROD` point to distinct resources. |

## Data and fixture policy

Preview E2E data must be synthetic, anonymized, or generated for the test run.

Accepted patterns:

- Use factory-generated identities from Playwright helpers or `@couture/testing`.
- Namespace generated IDs/emails by worker, retry, run ID, or branch when possible.
- Make data-mutating tests idempotent, self-cleaning, or safe to leave until scheduled cleanup.
- Keep local-only destructive tests guarded with environment checks.
- Use shared cleanup helpers from `packages/testing` for persisted fixture data when available.

Current local-only example:

- `playwright/tests/api/guardian-consent-lifecycle.spec.ts` skips non-local environments because it
  creates users, guardian invitations, consent links, queue records, and audit rows. Keep it
  local-only until Preview deploy-path parity and cleanup are proven.

## Real services vs stubs

Default posture:

- Local and Preview E2E should use real non-production app services when doing so improves release
  confidence without risking production data.
- Stubs are required for unsafe, costly, rate-limited, flaky, or unavailable dependencies.
- Production smoke must avoid destructive flows and should verify only health and read-safe paths.

Current examples:

- `playwright/tests/home.spec.ts` stubs the events poll endpoint so homepage smoke is deterministic
  while still validating the deployed app surface and health endpoint.
- `playwright/tests/web-health-sha.spec.ts` validates the deployed web health endpoint and matching
  commit SHA.
- `playwright/tests/api/api-health.spec.ts` validates the API root smoke path.

Weather-provider note:

Preview can use approved non-production weather behavior. Deterministic provider contracts,
consumer-driven contract verification, and broader provider-drift coverage belong to Story 0.14.

## Smoke and regression coverage

Minimum local PR evidence:

- `.github/workflows/pr-pw-e2e-local.yml` starts local Supabase, resets the database, runs burn-in
  for changed Playwright specs, and executes the sharded local suite.
- Local API and write-path tests may create data because the database is resettable.

Minimum Preview evidence:

- `.github/workflows/pr-pw-e2e-vercel-preview.yml` resolves exact web and API Preview deployments.
- The workflow waits for both deployments to report the PR commit SHA before Playwright starts.
- `playwright/tests/web-health-sha.spec.ts` fails if the deployed SHA does not match the expected
  commit.
- Preview should include at least one representative smoke path beyond health/SHA when a
  Preview-safe flow exists for the changed surface.

Known gap:

- Guardian consent lifecycle write-path coverage remains local-only until Preview deploy-path
  parity is proven. Story 0.14 tracks this as contract/deploy-path parity debt.

## Runbooks

### Run local E2E

```bash
npm run test:pw-local
```

Use this for the required local app/services path. CI starts local Supabase and resets the database
before running the suite.

### Run Preview E2E locally

```bash
npm run test:pw-preview
```

The helper resolves the active branch's Vercel Preview web and API URLs. If automatic resolution
fails, set `PREVIEW_WEB_E2E_BASE_URL` and `PREVIEW_API_BASE_URL` in `.env.preview`.

### Run Production smoke manually

```bash
npm run test:pw-prod -- playwright/tests/web-health-sha.spec.ts
```

Use smoke-safe specs only. Do not run destructive or data-mutating suites against Production.

### Troubleshoot Preview URL resolution

1. Confirm the branch is pushed and Vercel has built both web and API Preview deployments.
2. Confirm `VERCEL_TOKEN` is available in the relevant local or CI secret store.
3. Confirm `VERCEL_WEB_PROJECT_SLUG`, `VERCEL_API_PROJECT_SLUG`, and `VERCEL_TEAM_SLUG` are
   available as local env vars or reusable workflow inputs.
4. If Preview protection returns `401`, configure `VERCEL_AUTOMATION_BYPASS_SECRET`.
5. If the wrong deployment is selected, set `PREVIEW_WEB_E2E_BASE_URL` and `PREVIEW_API_BASE_URL`
   manually for the current run.

### Add a Preview-safe smoke test

1. Prefer read-safe checks or synthetic, namespaced data.
2. Register network intercepts before the user action that triggers them.
3. Use explicit assertions and avoid hard waits.
4. Guard local-only write paths with environment checks until cleanup and Preview parity are
   proven.

## Follow-up boundaries

Story 0.14 owns:

- OpenAPI/schema validation.
- Pact consumer/provider verification.
- Performance baseline, k6 scenarios, and thresholds.
- Maestro analytics journey expansion and promotion criteria.
- Preview deploy-path parity for write-path API E2E.
