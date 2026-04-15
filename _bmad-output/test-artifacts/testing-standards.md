# Testing standards

Updated: 2026-04-15 - Added shared factory, cleanup, and review-checklist expectations for Story
0.10.

Status: active

## Purpose

These standards define the minimum bar for automated test setup, fixture construction, cleanup, and
review in CoutureCast.

## Core standards

1. Use shared factories for CoutureCast domain data.
   Prefer `@couture/testing` over hand-built teen, guardian, wardrobe, ritual, or weather objects.
2. Keep fixture setup explicit and local to the test.
   Override only the fields the test asserts on so intent stays readable.
3. Keep assertions deterministic.
   Never assert on random Faker output unless the asserted fields were overridden first.
4. Clean up any created entities.
   Persisted fixtures already register themselves; direct Prisma setup must call
   `registerForCleanup()` and finish with `afterEach(async () => cleanup({ prisma }))`.
5. Reset shared cleanup state in non-persistent suites.
   If a suite imports shared factories or cleanup helpers, clear the registry in `afterEach` so
   fixture registration cannot leak across tests.

## Test quality checklist

Reviewers should apply this checklist to any PR that adds or edits automated tests:

- [ ] No hardcoded test data (use factories)
- [ ] Tests clean up created entities (registerForCleanup)
- [ ] Factories used for all test fixtures
- [ ] Test data is deterministic (no random data in assertions)

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
