---
stepsCompleted:
  - step-01-load-context
  - step-02-discover-tests
  - step-03-quality-evaluation
  - step-03f-aggregate-scores
  - step-04-generate-report
lastStep: step-04-generate-report
lastSaved: 2026-04-27
workflowType: testarch-test-review
inputDocuments:
  - playwright/tests/guardian-consent-ui.spec.ts
  - playwright/support/helpers/browser-api-proxy.ts
  - playwright/support/helpers/guardian-consent.ts
  - playwright/support/fixtures/merged-fixtures.ts
  - _bmad/tea/config.yaml
---

# Test quality review: guardian-consent-ui.spec.ts

Review date: 2026-04-27
Review scope: single browser spec plus helper surface
Reviewer: Murat / TEA

Note: This review audits test quality. Coverage mapping and coverage gates are out of
scope; use `trace` for coverage decisions.

## Executive summary

Overall score: 96/100, grade A
Recommendation: Approve with one execution caveat

The new browser smoke spec follows the intended `playwright-utils` direction: API
traffic is synchronized through `interceptNetworkCall`, response bodies are contract
validated with shared schemas, and browser interactions use accessible locators and
test ids. No hard waits, serial mode, or hidden browser assertions were found.

Runtime execution could not complete because local Docker/Postgres was unavailable.
Static validation passed, but the full browser/API write path still needs one green
run after Docker Desktop and Supabase are running.

## Quality criteria assessment

| Criterion             | Status | Notes                                                             |
| --------------------- | ------ | ----------------------------------------------------------------- |
| Priority markers      | Pass   | Both tests are marked P0.                                         |
| Hard waits            | Pass   | No `waitForTimeout` or sleep pattern found.                       |
| Network-first pattern | Pass   | Intercepts are created before the triggering click/navigation.    |
| Explicit assertions   | Pass   | API status, schema, body, and UI feedback assertions are visible. |
| Fixture patterns      | Pass   | Uses merged `playwright-utils` fixtures and local pure helpers.   |
| Selector resilience   | Pass   | Uses roles, labels, and test ids instead of CSS selectors.        |
| Test length           | Pass   | Spec is 231 lines, under the 300-line file limit.                 |
| Isolation             | Pass   | Write-path data is unique and cleaned up in `finally`.            |
| Runtime evidence      | Warn   | Full Playwright run blocked by missing local DB.                  |

Dimension scores:

| Dimension       | Score | Rationale                                                            |
| --------------- | ----: | -------------------------------------------------------------------- |
| Determinism     |    98 | Deterministic waits and unique generated data; no hard waits.        |
| Isolation       |    97 | Unique data prevents collisions, and cleanup removes created rows.   |
| Maintainability |    94 | Clear flow and helper extraction; proxy helper is focused.           |
| Performance     |    92 | No sleeps; real API setup is appropriate for P0 smoke but not cheap. |

Weighted score: 96/100.

## Findings

No open test-quality findings remain after review fixes.

## Resolved during review

### 1. Write-path test data cleanup

Prior severity: P2
Location: `playwright/tests/guardian-consent-ui.spec.ts:33`,
`playwright/tests/guardian-consent-ui.spec.ts:118`

The tests now register expected teen/guardian identities before creating records and
call `cleanupGuardianConsentTestData` from `finally`. The cleanup removes event
envelopes, audit logs, consent rows, invitations, comfort preferences, profiles, and
created users for the test-owned identities.

The spec is also local-only until equivalent cleanup isolation exists for remote
environments.

### 2. Cross-origin preflight route ordering

Prior severity: P2
Location: `playwright/support/helpers/browser-api-proxy.ts:113`,
`playwright/tests/guardian-consent-ui.spec.ts:61`

The proxy now installs one route layer for browser-origin API proxying and preflight
handling. `proxyApiCall` uses `interceptNetworkCall` as the observe/assert boundary,
so endpoint-specific interception no longer competes with preflight handling.

## Best practices found

### Network-first browser/API assertions

Location: `playwright/tests/guardian-consent-ui.spec.ts:61`,
`playwright/tests/guardian-consent-ui.spec.ts:85`,
`playwright/tests/guardian-consent-ui.spec.ts:109`,
`playwright/tests/guardian-consent-ui.spec.ts:155`,
`playwright/tests/guardian-consent-ui.spec.ts:181`

Each network promise is created before the click or navigation that triggers it. That
is the right anti-flake shape for this browser smoke layer.

### Contract-backed UI smoke checks

Location: `playwright/tests/guardian-consent-ui.spec.ts:70`,
`playwright/tests/guardian-consent-ui.spec.ts:94`,
`playwright/tests/guardian-consent-ui.spec.ts:118`,
`playwright/tests/guardian-consent-ui.spec.ts:168`,
`playwright/tests/guardian-consent-ui.spec.ts:196`

The test parses live API responses with shared HTTP contract schemas before asserting
UI feedback. That gives failures a useful boundary: backend contract, proxy plumbing,
or browser rendering.

### Focused proxy helper

Location: `playwright/support/helpers/browser-api-proxy.ts:127`

The proxy helper keeps raw route handling out of the spec while preserving
`interceptNetworkCall` as the test-facing synchronization API.

## Validation run

Passed:

- `npx tsc --noEmit -p playwright/tsconfig.json`
- `npx eslint --max-warnings=0 playwright/tests/guardian-consent-ui.spec.ts playwright/support/helpers/browser-api-proxy.ts playwright/support/helpers/guardian-consent.ts`
- `git diff --check -- playwright/tests/guardian-consent-ui.spec.ts playwright/support/helpers/browser-api-proxy.ts playwright/support/helpers/guardian-consent.ts _bmad-output/test-artifacts/test-reviews/guardian-consent-ui-test-review-2026-04-27.md`

Blocked:

- `npm run test:pw-local -- playwright/tests/guardian-consent-ui.spec.ts`

Blocker: API web server startup failed because local Postgres was unreachable at
`127.0.0.1:54322`. `npm run supabase:start` also failed because Docker Desktop was
not running.
