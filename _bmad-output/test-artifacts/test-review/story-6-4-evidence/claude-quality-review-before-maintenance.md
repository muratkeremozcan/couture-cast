---
workflowType: 'testarch-test-review'
runScope: 'story'
runKey: 'story-6-4-threaded-comments'
workflowStatus: 'completed'
stepsCompleted:
  [
    'step-01-load-context',
    'step-02-discover-tests',
    'step-03-quality-evaluation',
    'step-03f-aggregate-scores',
    'step-04-generate-report',
  ]
lastStep: 'step-04-generate-report'
lastSaved: '2026-10-19T22:30:00Z'
inputDocuments:
  - _bmad-output/implementation-artifacts/spec-6-4-threaded-comments.md
  - _bmad-output/implementation-artifacts/6-4-threaded-comments-design.md
  - /tmp/story64-opus-implementation-review.md
  - /tmp/story64-review-patch-brief.txt
  - .agents/skills/bmod-tea/knowledge/test-quality.md
  - .agents/skills/bmod-tea/knowledge/library-integration-mandate.md
  - .agents/skills/bmod-tea/knowledge/playwright-utils-mandate.md
  - .agents/skills/bmod-tea/knowledge/pactjs-utils-mandate.md
  - .agents/skills/bmod-tea/knowledge/maestro-flows.md
  - .agents/skills/bmod-tea/knowledge/mobile-test-strategy.md
---

# Test Quality Review: Story 6.4 threaded comments

**Quality Score**: 66/100 (D - Needs Improvement)
**Raw Deduction Score**: 66/100
**Score Cap**: 79/100
**Score Override Rule**: Highest severity HIGH caps effective score at 79: min(raw deduction score 66, 79) = 66.
**Review Date**: 2026-10-19
**Review Mode**: pr
**Reviewer**: Murat (TEA peer session)

---

Note: This review audits existing tests; it does not generate tests.
Coverage mapping and coverage gates are out of scope here. Use `trace` for coverage decisions.

## Executive Summary

**Overall Assessment**: Needs Improvement

**Recommendation**: Request Changes
**Verdict Rule**: Critical = 0 and High > 0 => Request Changes (2 High).

**Context Basis**: pr_diff

**Context Waivers Applied**: 0

**Execution Mode**: subagent

### Key Strengths

✅ Every behavior in the frozen matrix now has a test at a real boundary: guarded HTTP, isolated PostgreSQL per file, real Redis worker, MSW-rendered web and native, Pact, Playwright and Maestro.
✅ Assertions are exact: dispositions pinned to the verified engine corpus, exact Retry-After values, exact error keys, exact contextual accessible names, distinct native focus handles. Client mutation run: 31 of 42 killed, 11 equivalent, 0 real gaps.
✅ Isolation and performance are clean: per-file databases with a shared context that restores timers and flags, no file over 1000 lines, network-first intercepts throughout the Playwright spec.

### Advisory Observations

ℹ️ `maestro/community-comments.yaml` previously reused fixed text on shared `lookbook-5`; root reports the flow now uses unique per-run texts and anchored IDs.
ℹ️ Both Pact consumer files place the 6.4 block under a "Story 5.4" comment, and the failure and page helpers lack the `// Provider endpoint:` comment the other interactions carry.
ℹ️ `packages/api-client/testing/community-comments-state.spec.ts:428` uses `.every(...)` which also passes on an empty list.
ℹ️ `apps/api/integration/community-comments-reports.integration.spec.ts:144-154` seeds quota rows from the factory's live clock against a 24-hour window.

### Summary

Request Changes, on two High findings that are both clock-domain limits rather than weak assertions: two worker and recovery cases age rows on a live clock against a 15-minute cutoff with a 60-second margin, because a pinned JS clock disagrees with the Redis scheduler and with PostgreSQL `now()`. Root accepts both margins; the rubric records them. Everything else is Medium and Low maintainability: inline payloads, two multi-concern rendered journeys, unnamed boundary values and mixed assertion dialects. The preliminary review's Critical and eleven High findings are resolved.

---

## Quality Criteria Assessment

| Criterion                            | Status          | Violations | Basis                                      | Notes                                             |
| ------------------------------------ | --------------- | ---------- | ------------------------------------------ | ------------------------------------------------- |
| Disabled or Focused Tests            | ✅ PASS         | 0          | Absolute                                   | opt-in measurement has a reason and a root script |
| Hard Waits (sleep, waitForTimeout)   | ✅ PASS         | 0          | Absolute                                   | worker freeze wait replaced by exact job counts   |
| Determinism (assertions always run)  | ⚠️ WARN         | 2          | Absolute                                   | two live-clock stale boundaries, documented       |
| Isolation (cleanup, no shared state) | ✅ PASS         | 0          | Absolute                                   | per-file databases, restored flags and timers     |
| Data Factories                       | ⚠️ WARN         | 5          | Convention: dataFactories (3 of 8 sampled) | inline User and payload literals                  |
| Network-First Pattern                | ✅ PASS         | 0          | Applicability: Playwright navigation       | intercepts before every trigger                   |
| Playwright Utils Adoption            | ✅ PASS         | 0          | Applicability: Playwright runner           | mandate holds                                     |
| Pact.js Utils Adoption               | ✅ PASS         | 0          | Applicability: Pact consumer/provider      | mandate holds                                     |
| Explicit Assertions                  | ⚠️ WARN         | 2          | Absolute                                   | two multi-concern rendered journeys               |
| Test Length (≤1000 lines)            | ✅ PASS         | 0          | Absolute                                   | largest 925 lines                                 |
| Test Duration (≤1.5 min)             | ➖ Not measured | -          | Not measured                               | A static read cannot time a run                   |
| Flakiness Patterns                   | ⚠️ WARN         | 2          | Absolute                                   | same two clock boundaries                         |

**Total Violations**: 0 Critical, 2 High, 7 Medium, 10 Low

**Convention Baseline**: 8 test files sampled outside the review set

---

## Quality Score Breakdown

```text
Starting Score:          100
Critical Violations:     -0 × 10 = -0
High Violations:         -2 × 5 = -10
Medium Violations:       -7 × 2 = -14
Low Violations:          -10 × 1 = -10

Bonus Points:
  Comprehensive Fixtures: +0
  Data Factories:        +0
  Network-First:         +0
  Perfect Isolation:     +0
  All Test IDs:          +0
                         --------
Total Bonus:             +0

Raw Deduction Score:     66/100
Score Cap:               79/100 (HIGH)
Effective Score:         66/100
Grade:                   D
```

Rescore history: preliminary run (staged tree) scored 0/100 with 1 Critical, 11 High, 21 Medium,
9 Low. Final run on the source-ready tree, after the TA expand pass. Three findings the final
workers raised were fixed in the tree before publication and are excluded: Pact
`verifyCommunityCommentMissing` now asserts status and body (H10), Pact refusals assert
`Retry-After` presence or absence for every case (H3), and the two stale-only recovery cases run on
a pinned clock (H2). Root ran the recovery file 3 of 3 passed
(`/tmp/story64-postreview-recovery-final.log`); the Pact changes run in root's full Pact gate
(`/tmp/story64-postreview-pact.log`), not observed by TEA at publication.

---

## Critical Issues (Must Fix)

No critical issues detected. ✅

---

## Recommendations (Should Fix)

### 1. H2 time-dependency

**Severity**: P1 (High)
**Location**: `apps/api/integration/community-comments-worker.integration.spec.ts:30`
**Row**: H2
**Provenance**: introduced

**Issue**: Case found: governs a scheduling boundary. `const old = () => new Date(Date.now() - 16 * 60_000)` sets `created_at` and the outbox `updated_at` (L67, L70, L165, L340, L344) one minute past the 15-minute stale cutoff that `sweepStale` reads from its own live clock (community-comments.outbox.ts:58/63). The file has no fake timers. The assertions that depend on it are `generation` 1 at L254, the `pending_screening` outcomes at L155-157 and L260-262, and the count of 100 pending at L352-354 next to the single `screening_failed` at L355-357.

**Fix**: Import `pinClock` from helpers/community-comments-context.js, build `old` from a fixed `NOW`, and pin `NOW` before each `sweepStale()` and `dispatchPending()` call. The helper fakes only `Date`, so BullMQ and Prisma keep real timers.

### 2. H2 time-dependency

**Severity**: P1 (High)
**Location**: `apps/api/integration/community-comments-recovery.integration.spec.ts:132`
**Row**: H2
**Provenance**: introduced

**Issue**: The analytics retry case ages its row from live `Date.now()` against the 15-minute stale cutoff that `sweepStale` evaluates on the live JS clock (`community-comments.outbox.ts:58`). A pinned clock was tried and failed in root's run (`/tmp/story64-postreview-recovery-final.log`, pending outbox count 0 at :150): the analytics backoff compares JS Date with PostgreSQL `now()`, so a JS clock pinned in the past makes the retry eligible at once and the dispatcher drains it.

**Fix**: Kept on a moving clock by decision, with a 60-second margin over a sub-second test and an adjacent comment naming both clock domains. A durable fix needs one injectable clock shared by the outbox cutoff and the backoff query, which is a production seam outside this review.

### 3. M2 repeated-literal-payload

**Severity**: P2 (Medium)
**Location**: `apps/api/integration/community-comments-worker.integration.spec.ts:39`
**Row**: M2
**Provenance**: introduced

**Issue**: Factory bypass. `pending()` hand-builds the User create payload (`prisma.user.create({ data: { email: `${randomUUID()}@synthetic.test`, profile: { create: { birthdate: new Date('1990-01-01') } } } })`, lines 39-44) and the comment input (`createCommunityCommentInputSchema.parse({ body: 'Beautiful layers.', locale: 'en-US', mutationId: randomUUID() })`, lines 59-63). `createUser` and `persistUser` already exist in @couture/testing (packages/testing/src/factories/user.factory.ts:157,182), and `commentsTestContext()` already provides `fixture()` and `input()` that build exactly these shapes (apps/api/integration/helpers/community-comments-context.ts:84-103).

**Fix**: Build the member with `persistUser(prisma, createUser({ profilePreferences: { compliance: { accountStatus: 'active' } } }))`, or take `fixture`/`create` from `commentsTestContext()` the way the eight sibling comment specs do. If the file must keep its own database lifecycle, export the member builder from the context helper and import it here.

### 4. M2 repeated-literal-payload

**Severity**: P2 (Medium)
**Location**: `apps/api/integration/community-comments-delivery.integration.spec.ts:31`
**Row**: M2
**Provenance**: introduced

**Issue**: Factory bypass, the same shape as the worker spec. `seed()` hand-builds the User create payload (lines 31-36) and the comment input (lines 51-55). `createUser`/`persistUser` exist in @couture/testing, and `commentsTestContext()` exposes `fixture()`/`input()` for exactly this setup. The worker and delivery specs now carry two private copies of one member-plus-post-plus-pending-comment builder.

**Fix**: Replace the inline user payload with `persistUser(prisma, createUser(...))`, and share one exported builder with the worker spec. Do not maintain a third copy.

### 5. M2 repeated-literal-payload

**Severity**: P2 (Medium)
**Location**: `apps/web/src/app/components/community-comments.test.tsx:157`
**Row**: M2
**Provenance**: introduced

**Issue**: The report-acceptance payload `{ reported: true, acceptedAt: '2026-10-19T12:00:00.000Z', routedAt: '2026-10-19T12:00:00.000Z', reviewDueAt: '2026-10-20T12:00:00.000Z' }` is constructed inline three times (lines 157-162, 254-259, 777-782). The mobile sibling spec already folds the same shape into `reportReceipt()` (apps/mobile/components/community/community-comments-sheet.test.tsx:73-80). The submissions envelope `{ data: { items: [...], nextCursor } }` also repeats inline here (lines 80, 145-151, 291-303, 359-371, 595-597, 644-656, 684, 732), and the mobile spec covers it with `submissionsPage()`.

**Fix**: Add `const reportReceipt = () => ({ data: { reported: true, acceptedAt, routedAt, reviewDueAt } })` and `submissionsPage(items, nextCursor)` next to the existing `page()` helper on line 36, matching the mobile spec. Better still, add `createCommunityCommentReportReceipt` to @couture/testing beside `createCommunityCommentSubmission` so web, mobile and pact (pact/http/consumer/interactions/community/comments.ts:37-42) share one payload.

### 6. M2 repeated-literal-payload

**Severity**: P2 (Medium)
**Location**: `packages/api-client/testing/community-comments-client.spec.ts:8`
**Row**: M2
**Provenance**: introduced

**Issue**: Factory bypass. The file hand-writes a full CommunityCommentSubmission literal (`const submission = { id: 'comment', postId: 'post', parentId: null, status: 'pending_screening', ... }`, lines 8-16) and a full CommunityComment literal (`const comment = { id: 'comment', postId: 'post', ... replyCount: 0 }`, lines 85-96). The same package already ships builders for both shapes in packages/api-client/testing/community-comments-state-fixtures.ts:11-31 (`item()`, `own()`, same postId 'post' and alias format), and the two state specs import them. @couture/testing cannot be imported here because it depends on @couture/api-client, so the sibling fixtures module is the right source.

**Fix**: Import `item` and `own` from './community-comments-state-fixtures' and write `const submission = { ...own('comment'), body: 'Hello' }` and `const comment = { ...item('comment'), body: 'Hello' }`.

### 7. M2 repeated-literal-payload

**Severity**: P2 (Medium)
**Location**: `packages/api-client/testing/community-comments-state.spec.ts:182`
**Row**: M2
**Provenance**: introduced

**Issue**: Factory bypass. The file imports `ownPage` (line 17) and uses it from line 568 on, but builds the same submissions-page shape inline about a dozen times before that (lines 156, 182-183, 187-188, 205, 209, 223, 264-267, 293-296, 317, 452, 462-472, 541-544). The `deferred<{ items: CommunityCommentSubmission[]; nextCursor: string | null }>` type is also spelled out four times (lines 143-146, 199-202, 216-219, 349-352) although `SubmissionsPage` is imported on line 20.

**Fix**: Replace each `{ items: [own('a')], nextCursor: 'next' }` with `ownPage([own('a')], 'next')`, and each inline deferred type with `deferred<SubmissionsPage>()`.

### 8. M3 multi-concern-test

**Severity**: P2 (Medium)
**Location**: `apps/web/src/app/components/community-comments.test.tsx:86`
**Row**: M3
**Provenance**: introduced

**Issue**: 'pages through the discussion and submits the selected report after cancelling a draft report' asserts against five unrelated subjects: root paging (`findByText('Next root page')`, line 169), reply-composer cancel (lines 172-176), reply paging (line 179), private-submission paging (line 181), and the report cancel-then-submit flow (lines 185-189). When the report request body is wrong, the failure is reported under a test named for paging. Each subject already has a seam: `page()`, the replies handler and the submissions handler are independent.

**Fix**: Split it into three tests: root/reply/private paging, reply-composer cancel, and report cancel-then-submit. The focused report tests at lines 245 and 762 show the right shape for the third.

### 9. M3 multi-concern-test

**Severity**: P2 (Medium)
**Location**: `apps/mobile/components/community/community-comments-sheet.test.tsx:134`
**Row**: M3
**Provenance**: introduced

**Issue**: The native copy of the same journey asserts five unrelated subjects: root paging (line 204), reply-composer cancel (lines 207-211), reply paging (line 214), private-submission paging (line 216), and report cancel-then-submit (lines 220-226). The test name puts paging first, so a report-payload regression is reported under it.

**Fix**: Split it as in the web spec. The file already has focused report tests at lines 229, 270 and 327, so the report half can be dropped from this test.

### 10. L6 magic-value

**Severity**: P3 (Low)
**Location**: `apps/api/integration/community-comments-http.integration.spec.ts:50`
**Row**: L6
**Provenance**: introduced

**Issue**: `limit=51` encodes 'page maximum (50) plus one', but nothing names or comments it. The same file names its other contract boundaries (`REPORT_LIMIT = 50`, `COMMENT_MINUTE_LIMIT = 60`, lines 24-26), so this literal breaks the file's own convention.

**Fix**: Add `const PAGE_LIMIT = 50` under the existing contract comment on line 24 and request `limit=${PAGE_LIMIT + 1}`.

### 11. L6 magic-value

**Severity**: P3 (Low)
**Location**: `apps/api/integration/community-comments-http.integration.spec.ts:226`
**Row**: L6
**Provenance**: introduced

**Issue**: `'3600'` is the Retry-After derived from reports accepted 23 hours ago in a 24-hour window. It has no name and no comment. Line 161-162 of this file shows the house pattern for this value: a comment plus `String((DAY_MS - HOUR_MS) / SECOND_MS)`.

**Fix**: Write `expect(result.headers['retry-after']).toBe(String(HOUR_MS / SECOND_MS))` and add a one-line comment that the oldest of the 50 counted reports expires in one hour.

### 12. L6 magic-value

**Severity**: P3 (Low)
**Location**: `apps/api/integration/community-comments-threads.integration.spec.ts:60`
**Row**: L6
**Provenance**: introduced

**Issue**: `'😀'.repeat(141)` (line 60) and `'😀'.repeat(140)` (line 97) probe the comment length cap (140 emoji = 280 UTF-16 units) as bare literals with no name or comment. The contract exports no constant for the cap (packages/api-client/src/contracts/http/community.ts exports only COMMUNITY_COMMENT_PAGE_SIZE).

**Fix**: Export the body cap from the contract (for example `COMMUNITY_COMMENT_MAX_UTF16 = 280`) and derive both probes from it, or at minimum name `const MAX_EMOJI = 140` with a comment.

### 13. L6 magic-value

**Severity**: P3 (Low)
**Location**: `apps/api/integration/community-comments-worker.integration.spec.ts:30`
**Row**: L6
**Provenance**: introduced

**Issue**: `16 * 60_000` is 'one minute past the 15-minute stale-screening cutoff', with no name or comment. The recovery spec names the same contract value (`STALE_SCREENING_MS = 15 * MINUTE_MS` with an 'Accepted contract value' comment, community-comments-recovery.integration.spec.ts:12-13).

**Fix**: Import MINUTE_MS from the context helper and declare `const STALE_SCREENING_MS = 15 * MINUTE_MS` with the same comment, then `old = () => new Date(Date.now() - STALE_SCREENING_MS - MINUTE_MS)`.

### 14. L6 magic-value

**Severity**: P3 (Low)
**Location**: `apps/api/integration/community-comments-worker.integration.spec.ts:333`
**Row**: L6
**Provenance**: introduced

**Issue**: The test 'advances past one bounded page of frozen stale work' depends on the sweep page size, but expresses it only as the bare literals `{ length: 101 }` (line 333), `.toBe(100)` (line 354) and `rows[100]` (line 356). Nothing names the bound or says where it comes from.

**Fix**: Declare `const SWEEP_PAGE_SIZE = 100 // outbox sweep batch bound` (or import it from the outbox if it is exported) and write `length: SWEEP_PAGE_SIZE + 1`, `.toBe(SWEEP_PAGE_SIZE)`, `rows[SWEEP_PAGE_SIZE]`.

### 15. L6 magic-value

**Severity**: P3 (Low)
**Location**: `packages/api-client/testing/community-comments-state.spec.ts:44`
**Row**: L6
**Provenance**: introduced

**Issue**: `'😀'.repeat(141)` probes the length cap with no name or comment. The over-cap meaning can only be recovered by reading line 67 (`repeat(140)` ... `toHaveLength(280)`) in a different test.

**Fix**: Use the same named cap proposed for the threads spec, so the schema test and the database-parity test state the boundary once.

### 16. L6 magic-value

**Severity**: P3 (Low)
**Location**: `playwright/tests/community-comments.spec.ts:425`
**Row**: L6
**Provenance**: introduced

**Issue**: `3` is the WCAG 2.2 SC 1.4.11 non-text contrast minimum, but nothing names it or cites the criterion. Other specs use the same bare literal (community-reactions.spec.ts:283, accessibility-hardening.spec.ts:399-424). L6 is an Absolute row, so that repo habit does not waive it.

**Fix**: Export `WCAG_NON_TEXT_CONTRAST_MIN = 3` from playwright/support/helpers/accessibility.ts next to `contrastRatio` and assert `toBeGreaterThanOrEqual(WCAG_NON_TEXT_CONTRAST_MIN)`.

### 17. L7 inconsistent-assertion-style

**Severity**: P3 (Low)
**Location**: `apps/api/integration/community-comments-http.integration.spec.ts:37`
**Row**: L7
**Provenance**: introduced

**Issue**: The file checks HTTP status in supertest's chained `.expect(<status>)` dialect (lines 37, 49-53, 73, 90, 116-125, 155-160, 225, 245-247, 266, 301-305, 355, 372, 379) and checks everything else with vitest `expect`. The baseline house style is established at 8/8 ('expect + vitest matchers'), and 24 of the 56 neighboring integration specs assert status as `expect(response.status).toBe(n)`. Only one other file (community-reaction-http.integration.spec.ts) uses the supertest dialect.

**Fix**: Capture the response and assert `expect(response.status).toBe(401)`, matching premium-revenuecat-webhook.integration.spec.ts:304. A message argument, as in that file's lines 305-311, keeps the body in the failure output.

### 18. L7 inconsistent-assertion-style

**Severity**: P3 (Low)
**Location**: `apps/web/src/app/components/community-comments.test.tsx:701`
**Row**: L7
**Provenance**: introduced

**Issue**: The file uses two matcher styles for the same check (the exact text of a live region). The alert is asserted with `.textContent).toBe(...)` (lines 226, 271, 701) and the status region with `toHaveTextContent(/^...$/)` (lines 702, 710, 748, 759, 815). Lines 701 and 702 sit next to each other.

**Fix**: Use `toHaveTextContent(/^Comments could not be updated\. Try again\.$/)` (or `toHaveTextContent('...', { normalizeWhitespace: false })`) for the alert too, so every exact-text check reads the same way.

### 19. L7 inconsistent-assertion-style

**Severity**: P3 (Low)
**Location**: `apps/mobile/components/community/community-comments-sheet.test.tsx:450`
**Row**: L7
**Provenance**: introduced

**Issue**: The file uses two matcher styles for the same checks. Absence is asserted with `.toBeNull()` (lines 450, 453, 466, 487, 532, 533, 588, 640) and also with `.not.toBeInTheDocument()` (lines 211, 220, 258, 262, 364). Attribute state is asserted with `expect(x.getAttribute('aria-disabled')).not.toBe('true')` (lines 586, 596) and also with `toHaveAttribute('aria-checked', ...)` (lines 246-253, 318-319, 351-358).

**Fix**: Use `.not.toBeInTheDocument()` for every absence check and `not.toHaveAttribute('aria-disabled', 'true')` for the disabled check. The web sibling spec already does both consistently.

---

## Decision

**Recommendation**: Request Changes

---

## Reviewed Files

- apps/api/integration/community-comments-http.integration.spec.ts
- apps/api/integration/community-comments-threads.integration.spec.ts
- apps/api/integration/community-comments-replay-quota.integration.spec.ts
- apps/api/integration/community-comments-reports.integration.spec.ts
- apps/api/integration/community-comments-privacy.integration.spec.ts
- apps/api/integration/community-comments-recovery.integration.spec.ts
- apps/api/integration/community-comments-rollout-cleanup.integration.spec.ts
- apps/api/integration/community-comments-measurement.integration.spec.ts
- apps/api/integration/community-comments-worker.integration.spec.ts
- apps/api/integration/community-comments-delivery.integration.spec.ts
- apps/api/integration/premium-revenuecat-webhook.integration.spec.ts
- apps/api/src/modules/community/community-worker-runtime.spec.ts
- apps/mobile/components/community/community-comments-sheet.test.tsx
- apps/mobile/src/screens/community-screen.test.tsx
- apps/web/src/app/components/accessible-modal.test.tsx
- apps/web/src/app/components/community-comments.test.tsx
- apps/web/src/app/components/community-lookbook-grid.compose.test.tsx
- apps/web/src/app/components/community-lookbook-grid.request-ownership.test.tsx
- apps/web/src/app/components/community-lookbook-grid.reactions.test.tsx
- packages/api-client/testing/community-comments-client.spec.ts
- packages/api-client/testing/community-comments-state.spec.ts
- packages/api-client/testing/community-comments-state-outcomes.spec.ts
- packages/db/test/rls/community-posts.spec.ts
- packages/testing/test/community-comments-fixtures.spec.ts
- pact/http/consumer/web-api-client.pacttest.ts
- pact/http/consumer/mobile-api-client.pacttest.ts
- pact/http/consumer/interactions/community/comments.ts
- pact/http/provider/doubles/community-comments.ts
- playwright/tests/community-comments.spec.ts
- maestro/community-comments.yaml

## Review Context

- \_bmad-output/implementation-artifacts/spec-6-4-threaded-comments.md
- \_bmad-output/implementation-artifacts/6-4-threaded-comments-design.md
