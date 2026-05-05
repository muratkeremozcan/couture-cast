# Testing standards

Updated: 2026-05-05 - Made auth-session the standard Playwright fixture path for Story 0.14
Task 2.

Status: active

## Purpose

These standards define the minimum bar for automated test setup, fixture construction, cleanup, and
review in CoutureCast.

## Core standards

| Topic                         | Summary                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| Use shared factories          | Prefer `@couture/testing` over hand-built domain objects                    |
| Keep fixture setup explicit   | Override only the fields the test actually asserts on                       |
| Keep assertions deterministic | Never assert on random Faker output without explicit overrides              |
| Clean up any created entities | Persisted fixtures auto-register; direct Prisma setup must register cleanup |
| Reset shared cleanup state    | Clear the registry in `afterEach` when a suite uses shared cleanup helpers  |

Detailed guidance:

- `Use shared factories`: Default to `@couture/testing` for teen, guardian, wardrobe, ritual, and
  weather fixtures so schema changes update one place instead of many copied objects.
- `Keep fixture setup explicit`: Make the scenario readable from the override block instead of
  hiding intent in large copied payloads.
- `Keep assertions deterministic`: If a test checks an ID, timestamp, or user-facing field, set it
  explicitly before asserting on it.
- `Clean up any created entities`: Persisted fixtures already track themselves; direct Prisma setup
  must call `registerForCleanup()` and finish with `afterEach(async () => cleanup({ prisma }))`.
- `Reset shared cleanup state`: Non-persistent suites that import cleanup helpers should still clear
  the registry in `afterEach` so registration cannot leak across tests.

## Playwright auth-session standards

| Scenario                             | Standard                                                       |
| ------------------------------------ | -------------------------------------------------------------- |
| Browser specs                        | Use `playwright/support/fixtures/merged-fixtures`              |
| Signed-out or conflicting auth specs | Use `authSessionEnabled: false` with a comment explaining why  |
| API/synthetic contracts              | Keep using `authHeaders(...)`; no auth-session opt-out needed  |
| Alternate persisted users            | Override `authOptions.userIdentifier` in the relevant describe |

Keep `.auth/` and `playwright/.auth/` out of git; never log token contents.

## Test quality checklist

| Topic                                | Summary                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| No hardcoded test data               | Replace copied domain literals with shared factories                           |
| Tests clean up created entities      | Verify persisted rows register or participate in shared cleanup                |
| Factories used for all test fixtures | Keep new test setup on the factory path unless a contract test needs otherwise |
| Test data is deterministic           | Assert only on overridden values, not random fixture output                    |

Apply this checklist to every PR that adds or edits automated tests. If a suite intentionally keeps
inline data for a contract edge case, the diff should make that reason obvious.

## Usage notes

- Starter template: `packages/testing/templates/test-template.spec.ts`
- Factory and cleanup guide: `packages/testing/README.md`
- Cleanup registration import: `@couture/testing/cleanup`
- Package root imports: `@couture/testing`

## Reviewer guidance

- Treat repeated inline teen/guardian literals as a refactor target unless there is a strong
  contract-test reason to keep them inline.
- Favor one shared fixture helper over multiple copied object literals inside the same suite.
- If a test persists data, verify the teardown path in the same diff.
