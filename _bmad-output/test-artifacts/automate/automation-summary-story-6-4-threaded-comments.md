---
runScope: 'story'
runKey: 'story-6-4-threaded-comments'
testMode: 'expand'
testEntry: 'bmad-tea-automate'
test_mode: 'expand'
test_operation: 'create'
auto_validate: true
auto_heal_failures: true
max_healing_iterations: 3
use_mcp_healing: true
healing_rounds_used: 2
workflowStatus: 'completed'
stepsCompleted:
  [
    'step-01-preflight-and-context',
    'step-02-identify-targets',
    'step-03-generate-tests',
    'step-03c-aggregate',
    'step-04-validate-and-summarize',
  ]
lastStep: 'step-04-validate-and-summarize'
lastSaved: '2026-10-19T22:40:00Z'
inputDocuments:
  - _bmad-output/implementation-artifacts/spec-6-4-threaded-comments.md
  - _bmad-output/implementation-artifacts/6-4-threaded-comments-design.md
  - _bmad-output/test-artifacts/test-review/test-review-story-6-4-threaded-comments.md
  - .agents/skills/bmod-tea/knowledge/test-levels-framework.md
  - .agents/skills/bmod-tea/knowledge/test-priorities-matrix.md
  - .agents/skills/bmod-tea/knowledge/data-factories.md
  - .agents/skills/bmod-tea/knowledge/test-quality.md
  - .agents/skills/bmod-tea/knowledge/playwright-utils-mandate.md
  - .agents/skills/bmod-tea/knowledge/test-healing-patterns.md
  - .agents/skills/bmod-tea/knowledge/selector-resilience.md
  - .agents/skills/bmod-tea/knowledge/timing-debugging.md
---

# Automation summary: Story 6.4 threaded comments (expand)

## Preflight

- Mode: expand, selected explicitly by the requesting session (TA expand after RV). Operation: create.
- Stack: Expo mobile app with `maestro/`, Next.js web with Playwright, NestJS API. Treated as fullstack plus mobile; the run scope is decided by file ownership below, not by stack detection.
- Execution context: BMad-integrated (spec, design, RV report). No ATDD checklist exists for this story.
- Frameworks: Vitest for `packages/api-client`, `apps/web` (jsdom) and `apps/mobile`; Playwright with `@seontechnologies/playwright-utils` (mandate binds); Pact files are out of scope this round (owned by the implementation agent).
- Worker execution mode: subagent.

## Ownership and constraints for this round

Released to TEA by root on 2026-10-19 (STORY64 SOURCE READY, client/web/native):

- `packages/api-client/testing/community-comments-state.spec.ts`, `community-comments-client.spec.ts`
- Web rendered tests: `community-comments.test.tsx`, `accessible-modal.test.tsx`, `community-lookbook-grid.*.test.tsx`
- Native rendered tests: `community-comments-sheet.test.tsx`, `apps/mobile/src/screens/community-screen.test.tsx`, `apps/mobile/src/test-utils/community-screen/*.cases.tsx`
- `playwright/tests/community-comments.spec.ts` (edit and typecheck only; no browser run until root opens a harness window)

Still owned by the implementation agent: API integration, backend, Pact, `packages/testing`, Maestro, scripts, root `package.json`.
Production source is read-only. No DB, RLS, browser or device harness runs.

## Baseline execution (before any TA edit)

| Scope         | Command                                                                                                                                                                                                                                                                                 | Result                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Shared client | `cd packages/api-client && npx vitest run --config vitest.config.ts testing/community-comments-state.spec.ts testing/community-comments-client.spec.ts`                                                                                                                                 | 2 files, 57 passed           |
| Web           | `cd apps/web && npx vitest run --config vitest.config.ts src/app/components/community-comments.test.tsx src/app/components/accessible-modal.test.tsx src/app/components/community-lookbook-grid.request-ownership.test.tsx src/app/components/community-lookbook-grid.compose.test.tsx` | 4 files, 59 passed, 4 failed |
| Native        | `cd apps/mobile && npx vitest run --config vitest.config.ts components/community/community-comments-sheet.test.tsx src/screens/community-screen.test.tsx`                                                                                                                               | 2 files, 79 passed           |

Baseline web failures, all in `community-lookbook-grid.request-ownership.test.tsx`: `getByRole('button', { name: 'Close this look' })` now matches two buttons (the header close and the in-thread close that reuses the label after O-LW5b). Classified as a selector defect in an owned test file.

## Coverage plan

| Priority | Level           | Target file             | Scenario                                                                                                                                                                                                                                                                          | Risk addressed                                |
| -------- | --------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| P0       | Unit            | state spec              | `watchSubmissions`: polls only while pending work exists, bounded backoff on failure, recovery clears error, stop on unsubscribe/reset/eviction                                                                                                                                   | O-M4 unconditional polling; zero direct tests |
| P0       | Unit            | state spec              | `consumeAnnouncement` consumed once, not replayed across reopen                                                                                                                                                                                                                   | O-M6 stale announcements                      |
| P0       | Unit            | state spec              | definite rejection (400/403/409/429) releases unresolved intent; uncertain (5xx, timeout, network) keeps the exact UUID and payload                                                                                                                                               | B1/E2/O-H1                                    |
| P0       | Unit            | state spec              | exact error keys, including `age_gate` to `community.error.ageGate`; remove conditional assertion                                                                                                                                                                                 | RV H3; O-M1                                   |
| P1       | Unit            | state spec              | fence tests use non-evicting failures so the fence lines are proven; suppression for author_deleted, erased and consent_suspended on roots and expanded replies; public read preserved during confirmed create; snapshot change on append                                         | B2-B4; RV gap                                 |
| P1       | Unit            | client spec             | describe block; exact private-field rejection                                                                                                                                                                                                                                     | RV M4, H10                                    |
| P0       | Component       | web lookbook tests      | scope the header close so the 6.3 ownership tests pass again                                                                                                                                                                                                                      | baseline red                                  |
| P1       | Component       | web comments test       | focus after report open/cancel/send, delete, reply cancel, More; Escape still closes the dialog afterwards; contextual names; withheld status and recovery copy; age-gate alert copy; poll error announced once and cleared; stale 404 barrier                                    | B9, O-M3, O-LW5d, O-M1, O-M4, O-M9e           |
| P1       | Component       | accessible-modal test   | background inert while open, prior inert/aria-hidden restored on close                                                                                                                                                                                                            | O-LW4                                         |
| P1       | Component       | native sheet and screen | distinct focus handles prove status vs title focus; announcement once; no visible duplicate announcement; withheld recovery; screen focus restore to the invoking card, unrelated 404 keeps the sheet, token read failure handled, sign-out reset; report reason reset per target | O-M9d, O-LM1-O-LM4, O-M6                      |
| P1       | E2E (edit only) | Playwright spec         | pin review vs block per body, feed observer before navigation, unique per-run texts, drop unjustified serial mode, withheld status in UI, report journey with focus                                                                                                               | RV H10, M1, isolation advisories, O-M9a/c     |

Quota and limit expectations use literals for the accepted contract, never production constants.

## Round 1 results: client, web and native (backend handoff pending)

Execution status: **failed (product defect)**. Every TEA-owned failure was healed; 3 client tests stay red on a verified production defect.

### Generated or updated files (frozen ownership manifest)

- `packages/api-client/testing/community-comments-state.spec.ts`
- `packages/api-client/testing/community-comments-client.spec.ts`
- `apps/web/src/app/components/community-comments.test.tsx`
- `apps/web/src/app/components/accessible-modal.test.tsx`
- `apps/web/src/app/components/community-lookbook-grid.request-ownership.test.tsx`
- `apps/web/src/app/components/community-lookbook-grid.reactions.test.tsx`
- `apps/mobile/components/community/community-comments-sheet.test.tsx`
- `apps/mobile/src/test-utils/community-screen/feed.cases.tsx`
- `playwright/tests/community-comments.spec.ts` (edited, not executed)

Production source was not modified.

### Fresh final execution

| Scope                                        | Command                                                                                                                                                                                          | Baseline                             | Final                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------ |
| Shared client                                | `cd packages/api-client && npx vitest run --config vitest.config.ts testing/community-comments-state.spec.ts testing/community-comments-client.spec.ts`                                          | 57 passed                            | 101 tests: 98 passed, 3 failed (product defect)                    |
| Web comments, modal, all lookbook grid files | `cd apps/web && npx vitest run --config vitest.config.ts src/app/components/community-comments.test.tsx src/app/components/accessible-modal.test.tsx src/app/components/community-lookbook-grid` | 59 passed, 4 failed (scoped 4 files) | 9 files, 147 passed                                                |
| Native sheet and screen                      | `cd apps/mobile && npx vitest run --config vitest.config.ts components/community/community-comments-sheet.test.tsx src/screens/community-screen.test.tsx`                                        | 79 passed                            | 87 passed                                                          |
| Full web suite (fallout check)               | `cd apps/web && npx vitest run --config vitest.config.ts`                                                                                                                                        | n/a                                  | 54 files, 801 passed                                               |
| Full mobile suite (fallout check)            | `cd apps/mobile && npx vitest run --config vitest.config.ts`                                                                                                                                     | n/a                                  | 81 files, 893 passed                                               |
| Playwright spec                              | `npx tsc --noEmit -p playwright/tsconfig.json`; eslint; `--list`                                                                                                                                 | n/a                                  | clean; 7 tests registered; browser run pending root harness window |
| Lint on all edited files                     | `npx eslint <edited files> --max-warnings=0`                                                                                                                                                     | n/a                                  | clean                                                              |

### Healed failures

| File                                                                             | Class    | Evidence                                                                                            | Change                                                                                          |
| -------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `community-lookbook-grid.request-ownership.test.tsx` (closing detail during PUT) | Selector | Two buttons named "Close this look" after O-LW5b (intended, confirmed by root)                      | `detailHeaderClose()` picks the dialog close outside `community-detail` and asserts exactly one |
| same file, 6.3-WEB-026 and both 6.3-WEB-025 rows                                 | Selector | `AccessibleModal` now hides body siblings from assistive tech (`accessible-modal.tsx:51-71`, O-LW4) | Card image behind the open look is queried with `{ hidden: true }`                              |
| `community-lookbook-grid.reactions.test.tsx` labeled toggles                     | Selector | Same modal change                                                                                   | Same scoped hidden query                                                                        |
| state spec polling (round 1)                                                     | Data     | Mock kept returning pending work after reset/evict, unlike a real server                            | Mock answers per event as the server would                                                      |
| native screen feed invoker focus (round 1)                                       | Timing   | Deep-link focus fires on the next animation frame and landed after the close restore                | Await the deep-link focus before opening the sheet                                              |

No assertion operator, business value, threshold or coverage was reduced.

### Product defect (reported to root with reproduction)

`watchSubmissions` issues one more private status request after a session reset, account switch or eviction.
Repro: `cd packages/api-client && npx vitest run --config vitest.config.ts testing/community-comments-state.spec.ts -t 'sends no further polls'` (3 rows: `submissions` called 2 times, requirement 1).
Cause: `community-comments-state.ts:190-209` keeps the armed timer through `reset()`/`evict()` and the callback calls `statuses()` without rechecking pending work.

### Product question (not encoded)

Native O-LM3 edge: `community-screen.tsx:708-711` removes the highlighted post from the feed, so a feed card opened before the deep link resolves unmounts and close restores focus to a detached node (`:1017`, `:1064`). Needs a product decision (for example fall back to the highlighted copy).

### Playwright Utils deviations

None. One-shot failures use `interceptNetworkCall` with a documented `handler` that aborts only the first attempt; `fulfillResponse` registers a persistent route in 4.4.1 and would also trip the network error monitor.

### Pending root harness runs

- `npm run test:pw-local -- playwright/tests/community-comments.spec.ts` (API stack with workers): expect 7 passed. Highest-signal cases: create retry replay (server must replay the same id), exact dispositions (`damn`/`fuck` held, `kys` blocked), report routing within 5 minutes.
- Native device check: 280-character reply-root context with the software keyboard open (footer height).

### Remaining gaps

- `community-comments-state.spec.ts` is 1097 lines (RV H5); split of polling/classification describes into a sibling spec awaits root approval.
- Browser coverage for "More comments"/"More replies" paging and `screening_failed`/`consent_suspended` private rows.
- Backend-owned items await the backend handoff: integration spec, RLS, Pact, `packages/testing` cleanup, Maestro, measurement runner script.

## Round 2 and final results (backend, follow-on defects, final rescore)

Execution status: **passed** for every TEA-executed scope. Browser and device journeys are unrun by TEA and conditional on root's harness runs.

### Additional generated or updated files

- `packages/api-client/testing/community-comments-state-outcomes.spec.ts` (new, split from the state spec)
- `packages/api-client/testing/community-comments-state-fixtures.ts` (new)
- `apps/api/integration/community-comments-{http,threads,replay-quota,reports,privacy,recovery,rollout-cleanup,measurement}.integration.spec.ts` (new; replace the deleted 1266-line `community-comments.integration.spec.ts`)
- `apps/api/integration/helpers/community-comments-context.ts` (new shared context; reuses `isolatedCommunityDatabase` unchanged)
- `apps/api/integration/community-comments-worker.integration.spec.ts`, `community-comments-delivery.integration.spec.ts` (edited)
- `pact/http/consumer/interactions/community/comments.ts` (exact 404 and Retry-After assertions)
- Root `package.json`: `community:screening:measure:comments` (test-only opt-in runner; needs a DB env)

Production source was never modified by TEA.

### Executed results (TEA)

| Scope                                       | Command                                                                                                                                                                                                   | Result                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Shared client                               | `cd packages/api-client && npx vitest run --config vitest.config.ts testing/community-comments-state.spec.ts testing/community-comments-state-outcomes.spec.ts testing/community-comments-client.spec.ts` | 3 files, 107 passed                                                                             |
| Full web                                    | `cd apps/web && npx vitest run --config vitest.config.ts`                                                                                                                                                 | 54 files, 802 passed                                                                            |
| Full mobile (after T4)                      | `cd apps/mobile && npx vitest run --config vitest.config.ts`                                                                                                                                              | 81 files, 894 passed; root's later coverage run 895 passed including the T5 repro after its fix |
| Comment integration (real PostgreSQL/Redis) | `node /tmp/story64-run-review-gate.cjs npx --prefix apps/api cross-env NODE_OPTIONS=--conditions=development vitest run --root apps/api integration/community-comments-`                                  | 10 files, 85 passed, 1 skipped (opt-in measurement)                                             |
| Worker spec after hard-wait removal         | same wrapper, `integration/community-comments-worker.integration.spec.ts`                                                                                                                                 | 5 passed, 3 consecutive runs                                                                    |
| RLS (read-only run)                         | `node /tmp/story64-run-review-gate.cjs npx --prefix packages/db vitest run --root packages/db test/rls/community-posts.spec.ts`                                                                           | 11 passed                                                                                       |
| Playwright spec                             | `npx tsc --noEmit -p playwright/tsconfig.json`; eslint `--max-warnings=0`; `--list`                                                                                                                       | clean; 8 tests registered                                                                       |

Root-executed after TEA edits: recovery spec 3/3 passed (`/tmp/story64-postreview-recovery-final.log`); workspace coverage thresholds passed; production build passed. Pact (`/tmp/story64-postreview-pact.log`) was executing at publication.

### Healed failures (round 2)

| File                          | Class                 | Evidence                                                                                                                 | Change                                                                                       |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| measurement spec              | Setup                 | Worker built without `featureFlags`; processor fails closed (`processor.ts:163-165`), so "10 published" could never pass | Passes `flags`                                                                               |
| worker spec freeze case       | Hard wait             | 3200ms sleep proved absence of retries                                                                                   | Exact `getJobCounts` equals all-zero (including `paused`)                                    |
| `feed.cases.tsx` O-LM3 case   | Data                  | Feed item without reactions fenced the held detail read                                                                  | Zero reaction summary, as in `reactions.cases.tsx`                                           |
| recovery analytics retry case | Timing (clock domain) | Pinned JS clock earlier than PostgreSQL `now()` made the backoff eligible at once (root log, outbox count 0 at :150)     | Restored moving clock with a comment naming both clock domains; stale-only cases stay pinned |

No assertion operator, business value, threshold or coverage was reduced.

### Product defects found and fixed by the implementation agent

| ID  | Defect                                                                                          | TEA red proof                                                              | Status                |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------- |
| T2  | `watchSubmissions` sent one more private status request after reset, account switch or eviction | `community-comments-state.spec.ts` `-t 'sends no further polls'` (3 rows)  | fixed, green          |
| T3  | After an account switch the mounted watch never polled the next account's pending work          | `-t 'resumes polling on the same watch'`                                   | fixed, green          |
| T4  | An older accepted report closed a newer report form (web also moved focus)                      | web `-t "keeps a newer report form open"`, native `-t "newer report form"` | fixed, green          |
| T5  | Close focus went to a detached feed Comments node after the highlighted copy replaced it        | mobile `-t "live highlighted copy"`                                        | fixed, green per root |

### Mutation evidence

`_bmad-output/test-artifacts/automate/story-6-4-evidence/mutation-client.{py,md,json}`: copies the package to scratch, mutates the copy only, runs the real specs. Final source sha256 prefix `8daf88b7f169`: 31 of 42 killed, 11 equivalent survivors (each removes one half of a redundant guard pair), 0 real gaps.

### Conditional on root harness runs (not executed by TEA)

- `npm run test:pw-local -- playwright/tests/community-comments.spec.ts`: 8 tests expected to pass, including the held comment UI, lost create response retried with the same `mutationId`, the end-user report with routing within 5 minutes, and teen consent revocation suppression with owned cleanup.
- Maestro iOS and Android flows (root reports unique per-run texts and anchored IDs), including the 273-unit reply-root context with the software keyboard.
- Full Pact consumer and provider gate including the tightened comment assertions.

### Remaining findings

See the final RV report (`_bmad-output/test-artifacts/test-review/test-review-story-6-4-threaded-comments.md`): 2 High (live-clock stale boundaries in the worker and recovery analytics cases, accepted by root for clock-domain reasons), 7 Medium and 10 Low maintainability items.
