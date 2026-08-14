---
stepsCompleted:
  [
    'step-01-load-context',
    'step-02-discover-tests',
    'step-03-quality-evaluation',
    'step-03f-aggregate-scores',
    'step-04-generate-report',
  ]
lastStep: 'step-04-generate-report'
lastSaved: '2026-08-13'
reviewScope: 'directory'
reviewer: 'Murat (Master Test Architect)'
subject: 'Story 5.2 premium subscription lifecycle — 34 test files on feat/epic5-story2'
inputDocuments:
  - '_bmad-output/implementation-artifacts/5-2-premium-subscription-lifecycle.md'
  - '_bmad-output/project-context.md'
  - '.claude/skills/bmad-testarch-test-review/steps-c/criteria-registry.md'
  - 'resources/knowledge/test-quality.md'
  - 'resources/knowledge/test-levels-framework.md'
  - 'resources/knowledge/data-factories.md'
---

# Test Quality Review — Story 5.2 Premium Subscription Lifecycle

**Overall: 90/100 (A)** across 34 test files.

| Dimension       | Score | Grade | Weight |
| --------------- | ----- | ----- | ------ |
| Determinism     | 100   | A     | 30%    |
| Isolation       | 100   | A     | 30%    |
| Maintainability | 61    | D     | 25%    |
| Performance     | 100   | A     | 15%    |

Coverage is deliberately out of scope for `test-review` (it belongs to `trace`),
but a traceability sweep was run anyway because it was cheap; results below.

## Verdict

The reliability half of this suite is genuinely strong and needed no
remediation. Every time-dependent behaviour in the story — the mobile and web
activation polls, the refresh throttle, the retention cutoff — is driven with
virtual time, so the story's own "no wall-clock sleeps anywhere" rule held
across all 34 files. Isolation is equally disciplined: file-private namespaces,
factory-tracked cleanup, rolled-back transactions for the schema and RLS
suites, and a reconciliation sweep that engineers around a shared database with
a settling window and a scoped ledger rather than assuming it owns the table.

Maintainability was the weak dimension, and its findings were real. Five of the
eight violations were the same defect: the four premium integration suites and
one unit spec hand-rolled fixture rows that **this story's own factories
already build**, re-hardcoding the factory's pinned instants and, worse,
re-stating the Decision 6 payload allowlist that `5.2-FACTORY-05` exists to
pin. That is how a projection change becomes a five-file edit and how one of
those files silently drifts.

All eight violations and both actionable prose findings were fixed. The single
HIGH is deferred with reasons stated below.

## What was fixed

**Factory bypass (5 × MEDIUM).** The premium factory was the only factory in
`packages/testing` without the repo's `build*CreateInput` convention, which is
why four suites reached past it. Added
`buildPremiumEntitlementCreateInput`, `buildBillingEventCreateInput`, and
`buildBillingCustomerCreateInput` (matching `buildAlertRuleCreateInput` and its
siblings), refactored `persist*` onto them, and routed every inline fixture in
`premium-subscription`, `premium-stripe-rail`, `premium-revenuecat-webhook`,
and `premium-reconciliation` through them. The upsert-based seeds now derive
both branches from one factory row instead of restating a nine-field literal
twice. The reconciliation suite's hand-rolled `BillingEvent` payload now
spreads the factory's allowlisted projection and sets only `fetchToken`, the
forward trigger's one genuine addition.

**Repeated stub (1 × MEDIUM).** `billing-reconciliation.service.spec.ts` built
the same due-forward row inline five times, each varying one field. Extracted a
`dueForwardRow({ userId?, fetchToken? })` builder so the call sites show the
variation and nothing else.

**Magic values (2 × LOW).** The Stripe lifecycle fixture's `1_893_456_000` is
now `PERIOD_END_EPOCH_SECONDS`, derived from the same `PERIOD_END` Date the
other fixtures use, so the two representations cannot drift and nobody decodes
an epoch by hand. In the mobile screen suite, the health-timeout advance now
imports the screen's real `API_HEALTH_TIMEOUT_MS` (newly exported) instead of
mirroring `5_000`, and the overflow slack is a named
`SUBPIXEL_ROUNDING_SLACK_PX` with the jsdom integer-rounding reason stated.

**Over-broad cleanup (prose).** `premium-subscription.integration.spec.ts`
deleted **all** premium telemetry rows by `event_type` globally. The reviewer
recommended scoping it by user id — **that fix would have been wrong and
silently disabling**: both premium entitlement events are in
`PSEUDONYMOUS_EVENT_TYPES`, so `TelemetryService` persists them with
`user_id: null` by design, and a user filter would match zero rows forever.
Scoped instead by a suite-start time anchor, the same compromise
`cleanupScopeStartedAt` makes in `packages/testing/src/cleanup.ts` for exactly
this class of unowned row.

**Latent env restore (prose).** `stripe-client.spec.ts` restored `NODE_ENV`
with a bare assignment, which would write the literal string `"undefined"` if
it had been unset — a value that reads as production to
`allowsTestOnlySecrets()` and would hand every later suite in the process the
real Stripe client. Now delete-or-assign, matching the two vars beside it.

**Traceability (prose).** The ordering quartet and the signature quartet
carried their range on the `describe` (`5.2-INT-010..013`) while member tests
were titled `011:`, `012:`, `021:` and so on, so a trace join on full IDs found
only the first of each. All eight members now carry their full plan IDs.

## Traceability sweep (bonus, not part of the review score)

Expanding the story's ID ranges gives **42 planned test IDs; all 42 are claimed
by tests.** No plan row is unimplemented. The suite additionally claims 30+ IDs
beyond the plan (`5.2-DB-011..016`, `5.2-FACTORY-01..09`, `5.2-CONTRACT-01..16`,
`5.2-INT-003..005`, `5.2-MOB-003..006`, `5.2-API-015`), which is supplementary
coverage rather than drift.

## Deferred, with reasons

**HIGH — `packages/db/test/rls-policies.spec.ts` is 2868 lines**, nearly 3× the
1000-line limit. It carries the RLS matrices of four stories (4.3, 4.4, 5.1,
5.2) plus guardian-consent, telemetry, and alert-delivery coverage in one
describe, and its ~110-line `SeededScenario` type and ~410-line
seed/cleanup pair grow with every story. Story 5.2 added roughly 90 lines to it.

Not fixed here, deliberately: splitting it is a cross-story refactor of the
repo's most security-critical test file, where a mistake weakens RLS coverage
silently rather than loudly. It should be done as its own change with a
before/after test-count assertion proving the split is behaviour-preserving.
Logged to `deferred-work.md` with that verification recipe rather than left
implicit.

**Prose, not fixed:** the locale-parity scaffolding is duplicated across four
i18n specs (~80 lines each), and the `databaseUrl`/`probeSchema`/`requireSchema`
trio plus the auth-guard override block are duplicated across the four premium
integration suites. Both are genuine consolidation opportunities and neither
has a registry row. They are cross-cutting harness work that would touch files
owned by three different story surfaces; recorded for a follow-up.

**Prose, judged correct as-is:** the deliberate non-deletion of namespaced
synthetic users (immutable `AuditLog` rows + RESTRICT FK make them undeletable
by design, and the suites document it), and the raw-SQL fixtures in the RLS and
schema suites (role switching and rolled-back transactions need direct
`PoolClient` control, so the factory-bypass prong deliberately does not apply).

## Reviewer's note on method

The determinism worker terminated on a session limit and was rerun by hand. Its
first scan pass produced a false all-clear because BSD `xargs` rejects `-a`, so
the file list never reached `grep` and every pattern "passed" by matching
nothing. The scan was rerun with `tr`/`xargs -0` and 34 resolved files were
confirmed before any conclusion was drawn. A green result whose input was empty
is worse than a red one, and it is the same failure mode the criteria registry
warns about when it says a file no rule can attach to is not a passing file.

## Verification after remediation

- `npm run typecheck -w apps/api` — 0 errors
- `npm run typecheck -w apps/mobile` — 0 errors
- `npm run lint` (api, mobile, packages/testing) — clean at `--max-warnings=0`
- `npm run test -w apps/api` — 1718 passed, 5 pre-existing skips
- `npm run test -w apps/mobile` — 582 passed
- `npm run test -w packages/testing` — 76 passed
