---
workflowType: 'testarch-test-review'
runScope: 'story'
runKey: 'story-6-3-curated-reactions'
---

# Test quality review: Story 6.3 independent Codex peer

**Quality Score**: 0/100 (F)
**Raw Deduction Score**: 0/100
**Score Cap**: 79/100
**Score Override Rule**: Highest severity High caps the effective score at 79; min(0, 79) = 0.
**Review Date**: 2026-10-19
**Review Mode**: full-file
**Reviewer**: Codex independent peer

## Executive Summary

**Overall Assessment**: Needs Improvement
**Recommendation**: Request Changes
**Verdict Rule**: Critical = 0 and High > 0 => Request Changes (18 High).
**Context Basis**: pr_diff
**Context Waivers Applied**: 0
**Execution Mode**: sequential

### Summary

The implementation has substantive behavioral tests and the three selected real-database checks
passed. The strongest immediate improvements are deterministic response-completion evidence and
outbox test isolation. No new production defect was demonstrated during this read-only run.
The score applies to the complete supplied files, including inherited timers, clock fixtures,
and files exceeding the length limit. It is a test-quality result; release coverage and ship
gates require the trace workflow. Source, tests, generated files, flags and approved spec content
were left untouched. Only this report was written. The requested report-only boundary also kept
sequential dimension analysis in this report, with no worker JSON files or additional agents.

The reviewed revision is `22338e8b3a1848053dad55ecda3c395f0084befe` against baseline
`427b26c7772bcf157afcd3ec3b26273968543cd2`. Both supplied context files were read. Production callers,
shared schemas, migration triggers, runtime composition and test configuration were consulted to
check the assertions' meaning. No additional story or planning artifacts were discovered.

Pact broker: unreachable (SmartBear MCP tools not available). Provider states derived from
provider source. Both configured utility packages are installed. New Pact reaction interactions
use createProviderState and setJsonContent, invoke the real generated client, and retain the
serialized consumer configuration. Existing broker or CI results were not inferred.

playwright-utils is installed and `tea_use_playwright_utils` is true; 0 of 8 sampled files
outside the review set use it. The closest-first sample is entirely API integration tests;
that sample does not measure adoption in the browser corpus. Future Playwright additions should
use the configured utilities. The one-shot transport abort may need a documented deviation when
the utility cannot express aborting the connection.

### Advisory Observations

1. **Repair the web delayed-detail proof before expanding the suite.** At
   `apps/web/src/app/components/community-lookbook-grid.test.tsx:2962`, the test releases
   the old detail response, then waits for one `Applaud, 1` button. That condition already
   holds before release because the preceding mutation created it. The final assertion reads
   the same retained controls. Concrete counterexample: omit gate.release() at line 2982; the asserted DOM
   condition remains true while the detail response is unresolved. A future reconciliation failure
   can occur after this test has finished. This was established by control-flow inspection;
   a mutation run was not performed. Return a unique detail caption and await that caption
   before checking the pressed state and all counts. Give the stale feed/detail fixtures
   different aggregate and metadata values so they prove which response was consumed.
   The positive completion witness follows [Playwright's observable-state guidance](https://playwright.dev/docs/best-practices#use-web-first-assertions).

2. **Add two-worker lease ownership proof.** The real-database test at
   `apps/api/integration/community-reactions.integration.spec.ts:780` verifies sequential
   recovery of an expired lease. The dispatcher settlement at
   `apps/api/src/modules/community/community-reaction.outbox.ts:85` requires the claim's
   lease_id, but no reviewed test observes competing settlement. Hold worker A after claim,
   expire its owned row, let worker B reclaim with a second gate, then settle A as both success
   and failure variants while B still owns the row. Assert A cannot clear B's lease, mark it
   delivered, or replace B's backoff; release B and assert the final state and stable event ID.
   A separate two-worker simultaneous-claim case should observe one delivery before expiry.
   Keep a one-connection variant. Real row locking and SKIP LOCKED need PostgreSQL evidence;
   the relevant [PostgreSQL locking rules](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
   and [Prisma v6 transaction guidance](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions)
   support using that boundary. This is an unverified regression gap, with no claimed current
   lease defect.

3. **Add privacy headers through the actual module wiring.** The guarded HTTP cases at
   `apps/api/integration/community-reactions.integration.spec.ts:530` and `:600` construct
   CommunityController directly. They never install CommunityModule's middleware.
   `community.module.ts:79` wires CommunityCacheHeadersMiddleware, which is the protection
   that runs before a guard refuses a request. Add a real module HTTP test for successful
   negotiated and legacy feed/detail, mutation 409 with its viewer summary, and 401/403/404/429
   refusals. Assert Cache-Control contains private and no-store, and Vary includes
   x-couture-reactions, x-couture-platform and Authorization. Verify the legacy response with
   its strict schema and verify each viewer receives only their own viewerReaction/revision.
   Removing the middleware should fail the refusal assertions; success-only controller header
   checks cannot observe that wiring loss.

4. **Extend direct-role protection to writes on the three new reaction tables.** At
   `packages/db/test/rls/community-posts.spec.ts:262`, both client roles are tested only for
   SELECT against CommunityReaction, CommunityReactionReceipt and CommunityReactionOutbox.
   Add authenticated and anon INSERT, UPDATE and DELETE refusals with exact SQLSTATE 42501.
   Include valid and absent post IDs for INSERT and assert identical refusal so foreign keys
   cannot become a hidden-post oracle. Use seeded owned rows and the existing transaction
   harness, then verify privileged state is unchanged. Current SQL revokes all privileges;
   this addition would detect a future accidental write grant.

5. **Strengthen the wire contract where clients branch on refusals.** New Pact reaction
   cases at `pact/http/consumer/interactions/community.ts:1667` cover three 200 mutations and
   negotiated detail. They do not exercise reaction 409 data or 429 Retry-After through the
   generated clients. Add isolated interactions for those outcomes on both consumers, plus a
   negotiated feed with a populated reaction summary. Use real client ResponseError handling,
   provider-sourced envelopes, createProviderState and setJsonContent. Keep each interaction in
   its own test. [Pact provider-state guidance](https://docs.pact.io/getting_started/provider_states)
   requires each precondition to stand on its own. Service doubles cannot establish database
   idempotency or eligibility; retain the existing real-database checks for those properties.

## Quality Criteria Assessment

| Criterion                 | Status       | Violations | Basis                                            | Notes                                                                           |
| ------------------------- | ------------ | ---------: | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Disabled or Focused Tests | PASS         |          0 | Absolute                                         | No unexplained committed focus or skip found                                    |
| Hard Waits                | FAIL         |          4 | Absolute                                         | Grouped once per affected file; locations below                                 |
| Determinism               | FAIL         |          6 | Applicability: expiry and scheduling fixtures    | Live clocks control validity windows                                            |
| Isolation                 | FAIL         |          1 | Absolute                                         | Unrelated pending outbox work is modified                                       |
| Fixture Patterns          | WARN         |          3 | Applicability: user interaction API installed    | Raw click dispatches bypass the interaction sequence                            |
| Network-First Pattern     | WARN         |          1 | Applicability: browser navigation and feed data  | Feed readiness is not registered before navigation                              |
| Pact.js Utils Adoption    | PASS         |          0 | Applicability: Pact artifacts; package installed | New interactions use the configured helpers                                     |
| Explicit Assertions       | PASS         |          0 | Absolute                                         | Meaningful assertions present; completion-proof advisory above                  |
| Test Length               | FAIL         |          7 | Absolute                                         | Exact full-file lengths below                                                   |
| Test Duration             | Not measured |          - | Not measured                                     | Only selected database cases were timed                                         |
| Flakiness Patterns        | FAIL         |         11 | Absolute + Applicability                         | Four waits, six clock-fixture groups and one isolation issue                    |
| Test concern boundaries   | WARN         |          1 | Absolute                                         | One journey includes state, accessibility and layout subjects                   |
| Mobile Flow Patterns      | PASS         |          0 | Applicability: Maestro                           | Parent flow clears state and asserts transitions; sheet fallbacks are explained |

**Total Violations**: 0 Critical, 18 High, 5 Medium, 0 Low
**Convention Baseline**: 8 test files sampled outside the review set

The eligible corpus contains 448 files. The closest 40 formed the candidate pool; eight evenly
spaced files were read. Observed conventions: priorityMarkers 0/8, testIds 0/8,
networkFirst 0/8, playwrightUtils 0/8, dataFactories 7/8, fixtures 0/8,
assertionStyle 8/8 (expect and Vitest matchers). The sample comprises API integration files:
alert-pipeline-latency, commerce-affiliate-offers-query-plan, community-feed-query-plan,
community-submission-limits, guardian-emancipation, palette-advisor, premium-subscription,
and wardrobe-silhouette, each under apps/api/integration with the integration.spec.ts suffix.
No priority or test-ID deduction was inferred from the reviewed files.

## Quality Score Breakdown

```text
Starting Score:          100
Critical Violations:     -0 × 10 = -0
High Violations:         -18 × 5 = -90
Medium Violations:       -5 × 2 = -10
Low Violations:          -0 × 1 = -0

Bonus Points:
  Comprehensive Fixtures: +0
  Data Factories:        +0
  Network-First:         +0
  Perfect Isolation:     +0
  All Test IDs:          +0
                         --------
Total Bonus:             +0

Raw Deduction Score:     0/100
Score Cap:               79/100 (High)
Effective Score:         0/100
Grade:                   F
```

## Critical Issues (Must Fix)

No critical issues detected.

## Recommendations (Should Fix)

### 1. Outbox isolation changes unrelated durable work

**Severity**: P1 (High)
**Location**: `apps/api/integration/community-reactions.integration.spec.ts:715`
**Row**: H4

**Issue**: The retention test updates every undelivered outbox row, including other members and earlier scenarios, to defer delivery by 60 seconds. The one-connection test repeats this at line 787. Neither restores the original schedule. A pending row seeded by another suite or a failed earlier run changes which work this dispatcher observes; these tests also change that other work. The afterAll cleanup only reaches this file's member namespace.

**Fix**: Run dispatcher scenarios in an isolated test database or isolated schema. At minimum, scope mutations and expiry cleanup to owned IDs, assert the due-work precondition, and restore any deliberately modified external rows in finally. Add an unrelated sentinel row and assert its next_attempt_at, attempts, lease and delivery state are unchanged. Playwright's [isolation guidance](https://playwright.dev/docs/best-practices#make-tests-as-isolated-as-possible) also requires tests to control their database data.

### 2. Web race checks settle by elapsed time

**Severity**: P1 (High)
**Location**: `apps/web/src/app/components/community-lookbook-grid.test.tsx:2867`
**Row**: H1

**Issue**: Several new race checks sleep for 80 ms after the MSW handler sets returned. That marker precedes response parsing, coordinator reconciliation and React rendering. The same pattern appears at 2892, 2924, 2955 and 3090. A delayed response can reach the application after the negative assertion and test cleanup.

**Fix**: Replace elapsed-time sleeps with a response carrying a unique observable caption, then await that caption or a feed-loading transition before checking the retained counts or absence. For 404 cases, return an additional visible sentinel post from the old response and await its application before asserting the evicted post stays absent.

### 3. Native race checks settle by elapsed time

**Severity**: P1 (High)
**Location**: `apps/mobile/src/screens/community-screen.test.tsx:1449`
**Row**: H1

**Issue**: Native screen race tests use 80 or 100 ms sleeps after releasing responses. Other new occurrences are 1482, 1504, 1540, 1705 and 1748. The expiry and filter helpers can still be processing those responses when the test asserts.

**Fix**: Await an observable post-response transition. Use a distinct caption or sentinel row for stale feeds, highlighted-card appearance for detail reads, and the new filter cursor request for metadata checks. Release gates in finally so failures cannot leave pending handlers.

### 4. Sweep deadline probes use real-time sleeps

**Severity**: P1 (High)
**Location**: `apps/api/integration/community-reactions.integration.spec.ts:732`
**Row**: H1

**Issue**: The retention sink sleeps for 1050 ms per delivery, and line 832 sleeps 1100 ms before releasing a held sink. These encode the one-second sweep deadline through host scheduling and add real waiting to each test.

**Fix**: Keep real PostgreSQL and the one-connection gate. Control Date.now for the sweep deadline and advance that clock from the sink double after the first delivery starts; use promises to prove connection acquisition and release. Do not fake PostgreSQL transaction behavior.

### 5. Community polling helper sleeps between reads

**Severity**: P1 (High)
**Location**: `playwright/support/helpers/community-session.ts:348`
**Row**: H1

**Issue**: The shared terminal-author-state helper polls with a hand-written 500 ms timer. A request can finish immediately after an iteration and still wait the full interval.

**Fix**: Replace the loop with the composed recurse utility and preserve its bounded deadline, terminal-state predicate and final diagnostic. Use apiRequest for the API observations when this helper is updated.

### 6. Control the clock for community-reactions.integration.spec.ts

**Severity**: P1 (High)
**Location**: `apps/api/integration/community-reactions.integration.spec.ts:692`
**Row**: H2

**Issue**: Retention fixtures derive expiry and cutoff from separate live-clock reads. The same file derives future due-work dates and an expired lease at lines 717, 789 and 848. These values govern retention, scheduling and lease eligibility.

**Fix**: Use one controlled sweep clock and explicit retained/expired offsets. Keep the database clock relationship explicit for SQL now(); avoid moving unrelated rows to make a scenario eligible.

### 7. Control the clock for community.repository.spec.ts

**Severity**: P1 (High)
**Location**: `apps/api/src/modules/community/community.repository.spec.ts:464`
**Row**: H2

**Issue**: Submission quota retry fixtures derive the oldest accepted submission from the live clock. Another quota fixture uses Date.now at line 746. Neither scenario fixes the clock while calculating retry windows.

**Fix**: Pin the clock for the quota cases and assert the exact retry interval at the chosen boundary. Restore it after each case. Vitest supports [mocking Date through setSystemTime](https://vitest.dev/api/vi.html#vi-setsystemtime), which can keep database I/O on real timers.

### 8. Control the clock for community.service.spec.ts

**Severity**: P1 (High)
**Location**: `apps/api/src/modules/community/community.service.spec.ts:373`
**Row**: H2

**Issue**: The shared storage double creates a live-clock signed-URL expiry. Publish fixtures at 1289, 1335 and 2122 also derive upload deadlines from the clock. Most tests have no fixed clock.

**Fix**: Supply a stable reference time through the fixture and pin the service clock for expiry-sensitive cases. Keep explicit expired and valid variants.

### 9. Control the clock for guardian.service.spec.ts

**Severity**: P1 (High)
**Location**: `apps/api/src/modules/guardian/guardian.service.spec.ts:615`
**Row**: H2

**Issue**: Guardian invitations default to a 60-second expiry from Date.now, and token payloads derive iat and exp separately at 647-648. Ordinary invitation tests run with real timers; the fixed-clock age suite does not cover those invitation tests.

**Fix**: Give invitation and token helpers a common fixed reference time, pin the clock in their test scope, and derive all lifetime fields from that time.

### 10. Control the clock for community-screen.test.tsx

**Severity**: P1 (High)
**Location**: `apps/mobile/src/screens/community-screen.test.tsx:163`
**Row**: H2

**Issue**: The imageAccess fixture derives signed-URL expiry from the host clock. New visibility-refresh tests use 250 ms and 300 ms lifetimes at 1651 and 1690, creating a narrow real-time window for arranging the next response.

**Fix**: Control the image-expiry clock or trigger the observed image error directly where expiry timing is outside the scenario. Keep a dedicated expiry test with explicit clock advancement.

### 11. Control the clock for community-lookbook-grid.test.tsx

**Severity**: P1 (High)
**Location**: `apps/web/src/app/components/community-lookbook-grid.test.tsx:80`
**Row**: H2

**Issue**: The shared expiry helper derives every signed-URL lifetime from Date.now without a fixed clock. It feeds behavior that refetches expired community images.

**Fix**: Fix the test clock in expiry-focused scenarios and use explicit expiry values elsewhere. Advance the clock for the refresh transition and restore it in cleanup.

### 12. Split community.repository.spec.ts

**Severity**: P1 (High)
**Location**: `apps/api/src/modules/community/community.repository.spec.ts:1`
**Row**: H5

**Issue**: This reviewed file has 1509 lines, exceeding the 1000-line limit. Its full-file review includes this existing structural issue.

**Fix**: Split by behavior and keep shared builders in a helper module. For reaction work, extract a focused Story 6.3 suite while retaining the existing assertions and fixtures.

### 13. Split community.service.spec.ts

**Severity**: P1 (High)
**Location**: `apps/api/src/modules/community/community.service.spec.ts:1`
**Row**: H5

**Issue**: This reviewed file has 2529 lines, exceeding the 1000-line limit. Its full-file review includes this existing structural issue.

**Fix**: Split by behavior and keep shared builders in a helper module. For reaction work, extract a focused Story 6.3 suite while retaining the existing assertions and fixtures.

### 14. Split guardian.service.spec.ts

**Severity**: P1 (High)
**Location**: `apps/api/src/modules/guardian/guardian.service.spec.ts:1`
**Row**: H5

**Issue**: This reviewed file has 2525 lines, exceeding the 1000-line limit. Its full-file review includes this existing structural issue.

**Fix**: Split by behavior and keep shared builders in a helper module. For reaction work, extract a focused Story 6.3 suite while retaining the existing assertions and fixtures.

### 15. Split community-screen.test.tsx

**Severity**: P1 (High)
**Location**: `apps/mobile/src/screens/community-screen.test.tsx:1`
**Row**: H5

**Issue**: This reviewed file has 1991 lines, exceeding the 1000-line limit. Its full-file review includes this existing structural issue.

**Fix**: Split by behavior and keep shared builders in a helper module. For reaction work, extract a focused Story 6.3 suite while retaining the existing assertions and fixtures.

### 16. Split community-lookbook-grid.test.tsx

**Severity**: P1 (High)
**Location**: `apps/web/src/app/components/community-lookbook-grid.test.tsx:1`
**Row**: H5

**Issue**: This reviewed file has 3135 lines, exceeding the 1000-line limit. Its full-file review includes this existing structural issue.

**Fix**: Split by behavior and keep shared builders in a helper module. For reaction work, extract a focused Story 6.3 suite while retaining the existing assertions and fixtures.

### 17. Split community-contract.spec.ts

**Severity**: P1 (High)
**Location**: `packages/api-client/testing/community-contract.spec.ts:1`
**Row**: H5

**Issue**: This reviewed file has 1074 lines, exceeding the 1000-line limit. Its full-file review includes this existing structural issue.

**Fix**: Split by behavior and keep shared builders in a helper module. For reaction work, extract a focused Story 6.3 suite while retaining the existing assertions and fixtures.

### 18. Split community.ts

**Severity**: P1 (High)
**Location**: `pact/http/consumer/interactions/community.ts:1`
**Row**: H5

**Issue**: This reviewed file has 1760 lines, exceeding the 1000-line limit. Its full-file review includes this existing structural issue.

**Fix**: Split by behavior and keep shared builders in a helper module. For reaction work, extract a focused Story 6.3 suite while retaining the existing assertions and fixtures.

### 19. Exercise the disabled load-more control through a user action

**Severity**: P2 (Medium)
**Location**: `apps/web/src/app/components/community-lookbook-grid.test.tsx:952`
**Row**: M5

**Issue**: This test uses fireEvent.click while userEvent is already installed and used in the same case. The raw dispatch bypasses the interaction sequence that reaches the disabled control.

**Fix**: Use user.click for the screen behavior. Test any internal duplicate-call guard separately at its owning boundary.

### 20. Dismiss the native notice through the existing user API

**Severity**: P2 (Medium)
**Location**: `apps/mobile/src/screens/community-screen.test.tsx:444`
**Row**: M5

**Issue**: Dismiss banner is activated with fireEvent.click even though browserUser is the established interaction API in this browser-rendered native screen suite.

**Fix**: Use browserUser.click and await the notice disappearing. Testing Library documents the [user interaction event sequence](https://testing-library.com/docs/user-event/intro/) that a raw click dispatch omits.

### 21. Close capture through a user action

**Severity**: P2 (Medium)
**Location**: `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.test.tsx:247`
**Row**: M5

**Issue**: The revised polling regression clicks the capture completion control with fireEvent.click. The workspace already depends on userEvent.

**Fix**: Use a user-level click and keep the explicit held polling response and processing-state assertions.

### 22. Separate layout evidence from the reaction journey

**Severity**: P2 (Medium)
**Location**: `playwright/tests/community-reactions.spec.ts:43`
**Row**: M3

**Issue**: The first journey proves reaction state transitions, performs an accessibility audit, and checks the unrelated ritual/feed height relationship. A failure can require investigating three different subjects.

**Fix**: Keep reaction transitions together. Move layout geometry and accessibility checks into focused cases using the same community session fixture.

### 23. Observe feed readiness before taking count baselines

**Severity**: P2 (Medium)
**Location**: `playwright/tests/community-reactions.spec.ts:48`
**Row**: M1

**Issue**: Navigation is followed by feed interaction and a count baseline. The only pre-navigation route is events/poll; it does not observe the feed request supplying those counts.

**Fix**: Register interceptNetworkCall for the feed before navigation and await it before taking the baseline. Preserve the real application response. This matches [Playwright's guidance on waiting for observable state](https://playwright.dev/docs/best-practices#use-web-first-assertions).

## Executed evidence

After the root session confirmed the shared database was idle, this peer ran one narrow,
sequential command without package rebuilds:

```sh
cd /Users/murat/opensource/couture-cast/apps/api
env NODE_OPTIONS=--conditions=development ../../node_modules/.bin/vitest run integration/community-reactions.integration.spec.ts -t 'serializes competing|caps indexed retention|releases a one-connection'
```

Result on 2026-10-19: one file passed; three selected tests passed; sixteen cases were filtered
out by the command. Runner duration was 5.44 seconds. The retention case took 3240 ms and the
one-connection lease case took 1273 ms. These timings describe this selected execution only.
The expected unavailable-sink warning contained a safe failure category, attempt and age.
No full validation, full integration suite, browser journey, Maestro flow, broker query,
GitHub write or source mutation was performed.

## Decision

**Recommendation**: Request Changes

## Reviewed Files

- apps/api/integration/community-reactions.integration.spec.ts
- apps/api/src/modules/auth/security.guards.spec.ts
- apps/api/src/modules/community/community-worker-runtime.spec.ts
- apps/api/src/modules/community/community.controller.spec.ts
- apps/api/src/modules/community/community.repository.spec.ts
- apps/api/src/modules/community/community.service.spec.ts
- apps/api/src/modules/guardian/guardian.service.spec.ts
- apps/api/src/posthog/posthog.service.spec.ts
- apps/mobile/src/features/wardrobe/wardrobe-hub-screen.test.tsx
- apps/mobile/src/screens/community-screen.test.tsx
- apps/web/src/app/components/community-lookbook-grid.test.tsx
- maestro/community-feed.yaml
- maestro/subflows/absorb-expo-dev-sheet.yaml
- packages/api-client/src/testing/analytics-event-assertions.ts
- packages/api-client/testing/community-analytics.spec.ts
- packages/api-client/testing/community-contract.spec.ts
- packages/api-client/testing/community-reaction-state.spec.ts
- packages/api-client/testing/community-reactions.spec.ts
- packages/db/test/rls/community-posts.spec.ts
- packages/testing/src/factories/community.factory.ts
- packages/testing/src/factories/index.ts
- pact/http/consumer/interactions/community.ts
- pact/http/consumer/interactions/shared.ts
- pact/http/consumer/mobile-api-client.pacttest.ts
- pact/http/consumer/web-api-client.pacttest.ts
- pact/http/provider/doubles/community.ts
- playwright/support/helpers/community-session.ts
- playwright/tests/community-reactions.spec.ts

## Review Context

- \_bmad-output/implementation-artifacts/spec-6-3-curated-reactions.md
- \_bmad-output/implementation-artifacts/epic-6-context.md

## Excluded From Review Set

- packages/testing/package.json — format not scorable by the ledger
