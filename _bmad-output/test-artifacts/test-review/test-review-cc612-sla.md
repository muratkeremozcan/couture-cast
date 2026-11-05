---
workflowType: 'testarch-test-review'
runScope: 'story'
runKey: 'story-spec-6-12-sla-monitoring-escalation'
storyId: 'CC-6.12'
storyKey: 'spec-6-12-sla-monitoring-escalation'
ticketRef: null
storyFile: '_bmad-output/implementation-artifacts/spec-6-12-sla-monitoring-escalation.md'
---

# Test Quality Review: Story CC-6.12 SLA monitoring and escalation

**Quality Score**: 45/100 (F: Critical Issues)
**Raw Deduction Score**: 45/100
**Score Cap**: 69/100
**Score Override Rule**: Highest severity CRITICAL caps effective score at 69: min(raw deduction score 45, 69) = 45.
**Review Date**: 2026-11-05
**Review Mode**: full-file
**Reviewer**: TEA independent reviewer, reading commit bb8491d5

---

Note: This review audits existing tests.
Coverage mapping and coverage gates are out of scope here.
Use `trace` for coverage decisions.

## Executive Summary

**Overall Assessment**: Critical Issues

**Recommendation**: Block
**Verdict Rule**: Critical > 0 => Block (1 Critical).

**Context Basis**: pr_diff

**Context Waivers Applied**: 0

**Execution Mode**: sequential

### Key Strengths

✅ The delivery specs talk to a real socket, and the crash spec kills a real child process with SIGKILL and compares the resend byte for byte.

✅ The reviewed files hold no hard wait, no focused test and no undocumented skip, so the sleep-free design holds at HEAD.

✅ The injected clock pins lease, backoff and budget boundaries to the millisecond.

### Advisory Observations

These carry no severity and no deduction, because no registry row describes them.
Several are the most consequential defects in this review.

ℹ️ **A1. A stale-monitor test that exercises nothing.** `apps/api/integration/moderation-sla-route.integration.spec.ts:530`
The test title promises that opening the route for one viewer leaves a stale monitor stale.
No sweep runs in the test, so the flag double at line 532 is never consulted for the system subject, and `key !== key` is a spelled-out `false`.
The monitor row is absent because `beforeEach` deleted it, so `stale` is true whatever the sweep does.
Fix: run a real `ModerationSlaSweep` with that same flag double, assert `moderationSlaMonitor.findFirst()` is null, assert the route reads stale, then flip the system subject on and assert `stale` turns false.

ℹ️ **A2. The snapshot privacy check reads the wrong event.** `apps/api/integration/moderation-sla-delivery.integration.spec.ts:590`
`const [event]` takes the first captured call, which is `moderation_sla_alert_recorded` from detection.
The snapshot body is never inspected in the reviewed files.
Mutation proof: replacing the whole snapshot body with `{ mutated_reporter_id }` left all 118 tests of four spec files green.
Fix: read `snapshots()[0]` and `toEqual` the full event, with distinct id and the five named properties.

ℹ️ **A3. The concurrent escalation guard is unproven.** `apps/api/integration/moderation-sla-delivery.integration.spec.ts:177`
The plan row says two concurrent escalations add one row.
The lease stops the second worker from claiming, so it never reaches `escalateFailure`.
Mutation proof: removing the `failure_escalated_at: null` guard and the count check left the test and the suite green.
Fix: claim once, then call `escalateFailure` twice through two clients in `Promise.all`, and assert one `true`, one `false` and one `JobFailure`.

ℹ️ **A4. The byte-order tiebreak is unproven.** `apps/api/integration/moderation-sla.integration.spec.ts:129`
The seeded ids end in `-0`, `-1`, `-2`, so byte order, locale order and insertion order all agree.
Mutation proof: removing `COLLATE "C"` from the anchor aggregate left the test and the suite green.
Fix: seed ids whose byte order and locale order differ, such as `...-Zb` and `...-aa`, and insert them out of order.

ℹ️ **A5. I-D-BULLMQ tests a configuration production does not use.** `apps/api/integration/moderation-sla-concurrency.integration.spec.ts:484`
The test hardcodes `attempts: 3` and a fixed backoff on `queue.add`, so a production queue with no retries would still pass.
It builds a plain `Worker`, so the `createWorker` failed hook that writes `JobFailure` never runs, although the plan row requires that row.
The canary at line 494 scans a Prisma connection error raised before the channel is touched, so that message has no path to the webhook URL.
Fix: use `queueConfigs` job options and `createWorker` on a namespaced queue, then scan `prisma.jobFailure.findMany()` and `logs.text()` for the canary.

ℹ️ **A6. P-SLA-STABLE cannot see a transient announcement.** `playwright/tests/moderation-sla.spec.ts:391`
`toHaveText('')` retries until it matches, so a brief "Refreshing" announcement passes.
HEAD has that exact code path at `apps/web/src/app/components/moderation-sla-dashboard.tsx:106`.
`reads` increments at line 374 before the fulfill, so lines 391 and 392 can also run before the refresh renders, and the plan asks for two sweeps where the test runs one.
Fix: record live region text with a `MutationObserver` from an init script, assert the recorded list equals `['']`, and vary one rendered silent field so the test can wait for the refresh to land.

ℹ️ **A7. C-WEB-TIME proves no instant.** `apps/web/src/app/components/moderation-sla-dashboard.test.tsx:324`
No web config or CI workflow sets `TZ`, so on a UTC runner the two clocks are simply one hour apart.
Under Chicago both format to the same string, so swapped rows still pass.
The oracle copies the formatter of the component, so the assertion restates the implementation.
Fix: pin `TZ=America/Chicago` for this file, add a time zone name to the rendered value so the two instants differ, and assert literal strings or a `dateTime` attribute.

ℹ️ **A8. "Announces once" counts nothing.** `apps/web/src/app/components/moderation-sla-dashboard.test.tsx:268`
The test checks the final text only, so a repeated announcement on every refresh passes.
The sibling silent test at lines 253 and 254 waits on handler entry and one zero-millisecond tick, which may end before the response renders.
Fix: count observer mutations across a third refresh, and wait on a rendered change before reading the live region.

ℹ️ **A9. I-P-CANARY scans less than its title.** `apps/api/integration/moderation-sla-delivery.integration.spec.ts:676`
`capture().reset()` erases the failing requests before the scan, so the receiver surface holds only the last successful sweep, and nothing asserts it holds any request.
Lines 667 to 669 collect post reporters only, so the comment reporter id goes unscanned.
Fix: snapshot `received` before the reset, assert its length, and add the comment reporter ids.

ℹ️ **A10. Further weak oracles.**
`apps/api/integration/moderation-sla-route.integration.spec.ts:573` compares two sibling routes, so both can break together, and the plan says pinned; assert a literal status.
`packages/api-client/testing/moderation-sla-contract.spec.ts:124` scans a body the test wrote, so a new optional private field stays invisible; walk the keys of the OpenAPI component.
`apps/api/integration/moderation-sla-concurrency.integration.spec.ts:102` ignores the run result, and by reading the source a waiting claim ends at the 5-second transaction timeout, so the test catches it only when the held row sorts first; assert `{ delivered: 2, errors: 0 }` and hold the row that sorts last.
`apps/api/src/modules/moderation/moderation-sla.rules.spec.ts:171` misses a multi-column `SET`; widen the pattern to any `SET` list.
`playwright/tests/moderation-sla.spec.ts:232` scans launcher text although the plan asks for the process list; have the launcher write a process manifest and read it.
`playwright/tests/moderation-sla.spec.ts:500` passes on any permanent box shadow; compare computed style before and after focus.
`apps/api/integration/moderation-sla-delivery.integration.spec.ts:244` releases a port that a parallel file can reuse; use a server that destroys each socket.
`apps/api/integration/moderation-sla.integration.spec.ts:452` is filler, and `apps/api/integration/moderation-sla-delivery.integration.spec.ts:270` is a dead call; delete both.

### Summary

The suite is strong at its core, with real sockets, real Postgres and a real process kill.
The verdict comes from one assertion that cannot fail, plus state written in tests with no hook to reset it.
The advisory list holds the sharper problem: several tests carry a title their body does not exercise, and three of those were proven by mutation.
Findings describe commit bb8491d5, and a peer holds uncommitted edits to reviewed files during this review.

---

## Quality Criteria Assessment

| Criterion                            | Status          | Violations | Basis                                              | Notes                                               |
| ------------------------------------ | --------------- | ---------- | -------------------------------------------------- | --------------------------------------------------- |
| Disabled or Focused Tests            | ✅ PASS         | 0          | Absolute                                           | Two conditional skips carry a documented reason     |
| Hard Waits (sleep, waitForTimeout)   | ✅ PASS         | 0          | Absolute                                           | No match in any reviewed file at HEAD               |
| Determinism (assertions always run)  | ❌ FAIL         | 3          | Absolute + Applicability                           | H3 twice, H2 once                                   |
| Isolation (cleanup, no shared state) | ❌ FAIL         | 4          | Absolute                                           | H4 four times                                       |
| Fixture Patterns                     | ⚠️ WARN         | 1          | Applicability: the file constructs domain payloads | The M2 finding, counted once in the total           |
| Data Factories                       | ⚠️ WARN         | 1          | Applicability: the file constructs domain payloads | The same M2 finding                                 |
| Network-First Pattern                | ⚠️ WARN         | 1          | Applicability: the file navigates and reads data   | M1                                                  |
| Explicit Assertions                  | ❌ FAIL         | 2          | Absolute                                           | C3 once, H10 once                                   |
| Test Length (≤1000 lines)            | ✅ PASS         | 0          | Absolute                                           | 753 lines at most                                   |
| Test Duration (≤1.5 min)             | ➖ Not measured | -          | Not measured                                       | A static read cannot time a run                     |
| Flakiness Patterns                   | ❌ FAIL         | 8          | Absolute + Applicability                           | The H2, H3, H4 and M1 findings above, counted above |

**Total Violations**: 1 Critical, 8 High, 2 Medium, 1 Low

**Convention Baseline**: 8 test files sampled outside the review set

The corpus holds 944 test files, the closest 40 were ranked, and 8 were read.
All 8 are Vitest integration specs, so `priorityMarkers`, `testIds`, `networkFirst`, `fixtures` and `playwrightUtils` each measured 0 of 8 and their rows are closed.
playwright-utils is installed and `tea_use_playwright_utils` is true; 0 of 8 sampled files outside the review set use it.
Adoption has not spread past the reviewed set.
A wider scan of the corpus finds 30 files that import the package, so this zero reflects the closest-first sample.

---

## Quality Score Breakdown

```text
Starting Score:          100
Critical Violations:     -1 × 10 = -10
High Violations:         -8 × 5 = -40
Medium Violations:       -2 × 2 = -4
Low Violations:          -1 × 1 = -1

Bonus Points:
  Comprehensive Fixtures: +0
  Data Factories:        +0
  Network-First:         +0
  Perfect Isolation:     +0
  All Test IDs:          +0
                         --------
Total Bonus:             +0

Raw Deduction Score:     45/100
Score Cap:               69/100 (CRITICAL)
Effective Score:         45/100
Grade:                   F
```

---

## Critical Issues (Must Fix)

### 1. "Sends only GETs" reads a list only a GET handler can fill

**Severity**: P0 (Critical)
**Location**: `apps/web/src/app/components/moderation-sla-dashboard.test.tsx:199`
**Row**: C3
**Provenance**: introduced

**Issue**: `calls` is filled only inside `http.get`, so `call.method` can only be `GET`.
A POST misses that handler, reaches the unhandled-request hook in `vitest.setup.ts`, and the component swallows the rejected fetch, so the test stays green.
The test also clicks nothing, so it observes the page load alone.

**Fix**: Register a catch-all `http.all('*/api/*')` recorder, click Refresh, and assert the recorded method list equals `['GET', 'GET']`.

---

## Recommendations (Should Fix)

### 1. The allowed-keys check skips any event missing from its own list

**Severity**: P1 (High)
**Location**: `apps/api/integration/moderation-sla-delivery.integration.spec.ts:746`
**Row**: H3
**Provenance**: introduced

**Issue**: `if (allowed[event.event])` skips key checks for an unlisted event, and `moderation_sla_snapshot` is unlisted.
Mutation proof: a snapshot carrying `mutated_reporter_id` left this privacy test green.

**Fix**: Add the snapshot keys to `allowed`, and replace the `if` with `expect(Object.keys(event.properties ?? {}).sort()).toEqual(allowed[event.event])`, which fails on an unknown event.

### 2. A restore replaces the shared flag double with a different one

**Severity**: P1 (High)
**Location**: `apps/api/integration/moderation-sla-route.integration.spec.ts:537`
**Row**: H4
**Provenance**: introduced

**Issue**: The `finally` installs a hand-written implementation that drops the `failingFlags` branch of `moderation-decisions-seed.ts`.
From this test on, `failFlag` does nothing, so any test running later that relies on it gets a 200.

**Fix**: Use `mockImplementationOnce` for the override, or save and restore `getMockImplementation()`.

### 3. Route flag state is cleared inline

**Severity**: P1 (High)
**Location**: `apps/api/integration/moderation-sla-route.integration.spec.ts:219`
**Row**: H4
**Provenance**: introduced

**Issue**: Lines 206 to 209, 219 to 221 and 257 to 259 write `flagValues` and clear it after an `expect`.
No hook in the spec or its helpers clears the map, so one failure turns every later route test into a 503 and hides the real cause.

**Fix**: Add `flagValues.clear()` to the `beforeEach` at line 100, and delete the inline clears.

### 4. The escalate spec leaves monitoring off on failure

**Severity**: P1 (High)
**Location**: `apps/api/integration/moderation-sla-escalate.integration.spec.ts:294`
**Row**: H4
**Provenance**: introduced

**Issue**: The flag is set at line 294 and removed at line 308, with assertions between them and no hook.
A failure there makes each later sweep in the file a no-op, which fails unrelated tests.

**Fix**: Add a `beforeEach` that clears `flagValues` and resets `receiver`.

### 5. Playwright cleanup runs only when the test passes

**Severity**: P1 (High)
**Location**: `playwright/tests/moderation-sla.spec.ts:228`
**Row**: H4
**Provenance**: introduced

**Issue**: `closeCase` at lines 228 and 281 and the alert delete at line 282 sit at the end of test bodies.
The `fx` teardown only withdraws posts, so a failed run leaves open cases in the shared database, where the live sweep keeps alerting on them and later queue specs meet them.
The journey alert is dated one hour ahead, so a leaked row also tops Recent alerts.

**Fix**: Track seeded post ids in `fx`, and close reports and delete alerts for that run in its teardown.

### 6. The flag-order test asserts only that a result exists

**Severity**: P1 (High)
**Location**: `apps/api/integration/moderation-sla-delivery.integration.spec.ts:572`
**Row**: H10
**Provenance**: introduced

**Issue**: `resolves.toBeDefined()` is the only claim about a predictable result.
The explosive proxy catches an early database touch, while any wrong result object still passes.

**Fix**: Assert `.resolves.toMatchObject({ skipped: 1, recorded: 0, delivered: 0 })`.

### 7. The target-size loop can run zero times and checks one axis

**Severity**: P1 (High)
**Location**: `playwright/tests/moderation-sla.spec.ts:422`
**Row**: H3
**Provenance**: introduced

**Issue**: `controls.all()` does not wait and may return nothing, so the loop asserts nothing on an empty `main`.
Line 424 checks height only, so a 20-pixel-wide control passes a 44-pixel target test.

**Fix**: Assert `await expect(controls).not.toHaveCount(0)` first, and assert width beside height.

### 8. Due times come from the live clock

**Severity**: P1 (High)
**Location**: `playwright/tests/moderation-sla.spec.ts:179`
**Row**: H2
**Provenance**: introduced

**Issue**: Lines 179 to 181, 252 and 272 derive SLA due times and a detection time from `Date.now()` on the test host.
The worker runs on a real clock, so the margins of an hour or more keep the live flake risk low, and this is the least urgent High here.

**Fix**: Read `serverNow` from `GET /api/v1/moderation/sla` and derive seeds from it, so host clock skew has no effect.

### 9. Navigation reads data with no readiness signal

**Severity**: P2 (Medium)
**Location**: `playwright/tests/moderation-sla.spec.ts:215`
**Row**: M1
**Provenance**: introduced

**Issue**: The receiver records the request before the worker writes `delivered`, so the page fetched here can read `pending` and hold it until the 60-second refresh.
Lines 184, 276 and 292 share the shape with less risk.

**Fix**: Register `interceptNetworkCall` for the SLA route before navigating, and use `recurse` on that read until all three rows report delivered.

### 10. Two tests bypass the report factory

**Severity**: P2 (Medium)
**Location**: `apps/api/integration/moderation-sla.integration.spec.ts:288`
**Row**: M2
**Provenance**: introduced

**Issue**: Lines 288 and 311 build a report inline although `seedPostReport` exists and is already imported by the harness.

**Fix**: Call `seedPostReport`, or add a `laterReport` helper to the harness.

### 11. A failure state is located by its copy

**Severity**: P3 (Low)
**Location**: `playwright/tests/moderation-sla.spec.ts:321`
**Row**: L1
**Provenance**: introduced

**Issue**: `getByText` with an English sentence breaks on a copy edit, and the catalog already holds that text.

**Fix**: Read the expected text from `en-US.json`, as the locale test in this file does, or scope it through a role.

---

## Decision

**Recommendation**: Block

---

## Reviewed Files

- apps/api/integration/helpers/moderation-sla-harness.ts
- apps/api/integration/moderation-sla.integration.spec.ts
- apps/api/integration/moderation-sla-concurrency.integration.spec.ts
- apps/api/integration/moderation-sla-delivery.integration.spec.ts
- apps/api/integration/moderation-sla-escalate.integration.spec.ts
- apps/api/integration/moderation-sla-route.integration.spec.ts
- apps/api/integration/moderation-sla-drill.spec.ts
- apps/api/integration/moderation-sla-docs.spec.ts
- apps/api/integration/support/moderation-sla-crash-worker.ts
- apps/api/src/modules/moderation/moderation-sla.rules.spec.ts
- apps/api/src/modules/moderation/moderation-sla.channel.spec.ts
- apps/api/src/modules/moderation/moderation-sla.controller.spec.ts
- apps/api/src/modules/moderation/moderation-sla.scheduler.spec.ts
- packages/api-client/testing/moderation-sla-contract.spec.ts
- packages/db/test/moderation-sla-schema.spec.ts
- apps/web/src/app/components/moderation-sla-dashboard.test.tsx
- playwright/tests/moderation-sla.spec.ts
- playwright/support/moderation-ops-capture.mjs

## Review Context

- \_bmad-output/implementation-artifacts/spec-6-12-sla-monitoring-escalation.md
- \_bmad-output/test-artifacts/test-design/cc612-sla-monitoring-test-design.md
- apps/api/src/modules/moderation/moderation-sla.sweep.ts
- apps/api/src/modules/moderation/moderation-sla.channel.ts
- apps/api/src/modules/moderation/moderation-sla.rules.ts
- apps/api/src/modules/moderation/moderation-sla.repository.ts
- apps/api/src/modules/moderation/moderation-sla.scheduler.ts
- apps/api/src/modules/moderation/moderation-sla.controller.ts
- apps/api/src/modules/moderation/moderation-sla.service.ts
- apps/api/src/modules/moderation/moderation-queue.repository.ts
- apps/api/src/workers/base.worker.ts
- apps/api/src/workers/bootstrap.ts
- apps/api/src/workers/community.bootstrap.ts
- apps/api/src/config/queues.ts
- apps/api/integration/helpers/moderation-queue-seed.ts
- apps/api/integration/helpers/moderation-queue-context.ts
- apps/api/integration/helpers/moderation-decisions-seed.ts
- apps/api/vitest.config.ts
- apps/web/vitest.config.ts
- apps/web/vitest.setup.ts
- apps/web/src/app/components/moderation-sla-dashboard.tsx
- scripts/start-api-e2e-with-workers.mjs

---

## Resolution

Fixed at `eee9c4b0` and `89288e62`, and proved by seeded defects S-21 to S-27 in the test design's Execution record.
This score describes `bb8491d5` and was not recomputed.

| Finding                                        | Outcome                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard no-write check                       | A catch-all recorder and a real refresh click. S-24 is red.                                                                                                |
| Analytics allow-list                           | An unlisted event now fails, and the snapshot keys are listed. S-21 is red.                                                                                |
| Snapshot body                                  | Compared whole against the snapshot event. S-21 is red.                                                                                                    |
| Two workers at the escalation guard            | A new test calls `escalateFailure` twice on two clients. S-22 is red.                                                                                      |
| Anchor tie order                               | Ids sort differently by byte and by locale, and the columns take an ICU collation during the test, because the Alpine default sorts by bytes. S-23 is red. |
| Stale monitor for one viewer                   | Runs a real sweep with the system subject off, then on. S-27 is red.                                                                                       |
| I-D-BULLMQ                                     | Production queue options and `createWorker`, scanning `JobFailure` and logs. S-26 is red.                                                                  |
| P-SLA-STABLE                                   | A `MutationObserver` from first paint, and a rendered count to wait on.                                                                                    |
| C-WEB-TIME                                     | Pinned zone and literal text. It exposed identical times in the repeated hour, fixed at `26ffaf5f`.                                                        |
| C-WEB-ANNOUNCE                                 | Counts announcements, and holds a response so the in-flight state renders. S-25 is red.                                                                    |
| I-P-CANARY                                     | Keeps the failing sends, asserts they exist, and scans comment reporter ids.                                                                               |
| Flag-order result                              | Asserts the exact counts.                                                                                                                                  |
| P-SLA-THEMES-WIDTHS                            | Asserts controls exist, and checks width too.                                                                                                              |
| Restored flag implementation and cleared flags | The route restores the original implementation, and route and escalate clear flags in `beforeEach`.                                                        |
| Playwright cleanup                             | Moved to `fx` teardown.                                                                                                                                    |
| Delivered row race                             | `recurse` on the rows before the page opens.                                                                                                               |
| Report factory bypass                          | Both now call `seedPostReport`.                                                                                                                            |
| English locator                                | Reads the catalog.                                                                                                                                         |
| I-R-SANCTIONED                                 | Pins status 200 on both routes.                                                                                                                            |
| Private field scan                             | Walks the published OpenAPI schema.                                                                                                                        |
| I-D-SKIP-LOCKED result                         | Asserts `delivered: 2, errors: 0`.                                                                                                                         |
| Reopen scan                                    | Matches a multi-column `SET`.                                                                                                                              |
| P-SLA-HOSTED-PATH                              | Reads the process tree under this run's launcher.                                                                                                          |
| Focus ring                                     | Compares the focused look with the resting look.                                                                                                           |
| Closed port                                    | Replaced by a dropped connection, so no parallel file can take the port.                                                                                   |
| Filler assertion, dead call, bare poll         | Removed.                                                                                                                                                   |

Declined, with the reason recorded:

- Live-clock due times in `moderation-sla.spec.ts`, rubric row H2. The real worker reads the real clock and cannot take an injected one, so a due time has to come from that same clock. Margins are an hour or more against a 60-second sweep, and the review rated the real risk low. Three burn-in runs showed no drift.
