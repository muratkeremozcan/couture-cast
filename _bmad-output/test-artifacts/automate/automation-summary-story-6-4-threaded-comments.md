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
lastSaved: '2026-10-19T19:20:20Z'
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

At the end of the Claude review, 2 High, 7 Medium and 10 Low maintenance findings remained.
The continuation below repairs and verifies all 19. The historical report is preserved at
`../test-review/story-6-4-evidence/claude-quality-review-before-maintenance.md`.

## Codex continuation: final maintenance and verification

The user requested a Codex peer to conserve the Claude allowance. The separate Claude Opus 5.5
TEA session completed the original review, test expansion and most final repairs, then returned
ownership in verified message `d4c47cfa-a9f5-4e7f-b719-888b1b692f64` from `story64-tea` at
`2026-10-19T17:46:28.651Z`. Codex finished the test-only cleanup, scoped execution and sequential
rescore. Production source remained read-only throughout the TEA work.

Execution status: **passed** for all continuation-owned checks. Final root-owned iOS and Android
flows and manual pixel checks also passed. Root owns CI and PR review resolution.

### Maintenance repairs

The numbers below match the 19 findings in the historical Claude report.

| Finding                         | Repair                                                                                                                 | Evidence                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1: worker stale clock           | `STALE_BACKLOG_AT` fixes backlog at 2000-01-01 while Redis scheduling keeps live timers                                | Real worker suite: 5 passed                                     |
| 2: recovery stale clock         | Age from fixed `NOW`, pin Date only for the sweep, restore in `finally`, assert failure before live analytics delivery | Recovery suite: 3 passed                                        |
| 3: worker payload duplication   | Reuse `persistCommentFixture` and `commentInput` from the shared integration helper                                    | Worker: 5 passed                                                |
| 4: delivery payload duplication | Reuse the same member/post/request builders                                                                            | Delivery: 3 passed                                              |
| 5: web payload duplication      | Reuse `reportReceipt` and `submissionsPage`                                                                            | Web comments: 20 passed                                         |
| 6: client payload duplication   | Reuse `item` and `own` from package-local fixtures, preserving the dependency direction                                | Client: 107 passed                                              |
| 7: state payload duplication    | Reuse `ownPage` and `SubmissionsPage`                                                                                  | Client: 107 passed                                              |
| 8: web mixed journey            | Separate paging, reply cancellation and report cancellation/submission cases                                           | Web comments: 20 passed                                         |
| 9: native mixed journey         | Separate the same concerns with all original checks retained                                                           | Native sheet: 14 passed                                         |
| 10: HTTP page boundary          | Name `PAGE_LIMIT` and derive the invalid request from it                                                               | HTTP: 15 passed                                                 |
| 11: HTTP retry expiry           | Name the one-hour Retry-After calculation                                                                              | HTTP: 15 passed                                                 |
| 12: integration text boundary   | Name UTF-16 cap and derive accepted/over-cap emoji strings                                                             | Threads: 28 passed                                              |
| 13: worker stale-age literal    | Replace moving 16-minute setup with the documented fixed backlog date                                                  | Worker: 5 passed                                                |
| 14: worker sweep boundary       | Use `STALE_SWEEP_PAGE` for setup size, pending count and final row index                                               | Worker: 5 passed                                                |
| 15: schema text boundary        | Name UTF-16 cap and derive emoji test strings locally                                                                  | Client: 107 passed                                              |
| 16: focus contrast boundary     | Name `MIN_FOCUS_CONTRAST` and cite WCAG 2.2 SC 1.4.11                                                                  | Root browser: 8 passed; the final edit names the same threshold |
| 17: HTTP assertion dialect      | Use Vitest assertions for HTTP status throughout the file                                                              | HTTP: 15 passed                                                 |
| 18: web live-region dialect     | Use exact `toHaveTextContent` checks                                                                                   | Web comments: 20 passed                                         |
| 19: native matcher dialect      | Use DOM absence and attribute matchers consistently                                                                    | Native sheet: 14 passed                                         |

The worker cases exercise an already-stale backlog; the precise stale cutoff stays in the recovery
suite. The final setup removes the moving boundary without introducing a production clock seam.
Analytics retry uses its live application/database clock after the controlled sweep finishes.

Additional advisories repaired: exact nonempty root identities accompany the `.every` assertion;
quota fixtures share a pinned service clock and explicit factory date; Pact comment blocks identify
Story 6.4 and every operation's provider endpoint. No assertion, threshold or expected value was
weakened. The Pact edits after the full gate change comments only.

### Fresh continuation execution

| Scope                                                  | Result                                           | Log                                              |
| ------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| Client state, outcomes and transport                   | 3 files, 107 passed                              | `/tmp/story64-codex-tea-client-final.log`        |
| Web comments                                           | 1 file, 20 passed                                | `/tmp/story64-codex-tea-web-final.log`           |
| Native comments sheet                                  | 1 file, 14 passed                                | `/tmp/story64-codex-tea-mobile-final.log`        |
| Full mobile coverage after the P6 fix                  | 81 files, 897 passed; existing thresholds passed | `/tmp/story64-postreview-mobile-p6-coverage.log` |
| Recovery first, with real PostgreSQL                   | 3 passed                                         | `/tmp/story64-codex-tea-recovery-final.log`      |
| Other comment integration files, real PostgreSQL/Redis | 82 passed, 1 documented opt-in measurement skip  | `/tmp/story64-codex-tea-api-final.log`           |
| API types                                              | Passed                                           | `/tmp/story64-codex-tea-api-types.log`           |
| Scoped lint                                            | Passed with zero warnings                        | `/tmp/story64-codex-tea-lint.log`                |
| Edited-file formatting                                 | Passed                                           | `/tmp/story64-codex-tea-format.log`              |

The 10 integration files total **85 passed, 1 documented opt-in measurement skip**. Each uses its
own database; worker queues have unique names. The root-owned DB/Redis window was returned before
Android preparation. No additional harness ran during native execution.

Root-executed evidence inspected by the continuation: full Pact consumer determinism and provider
gate passed (`/tmp/story64-postreview-pact.log`); browser journeys passed **8/8**
(`/tmp/story64-postreview-browser.log`). Root reports the final iOS flow passed 1/1 in 2m44s with
the 273-unit reply-root context and software keyboard visible. The final Android flow after P6
passed 1/1 in 2m28s, exited 0 and completed teardown
(`/tmp/story64-postreview-maestro-android-p6.log`,
`/tmp/story64-postreview-maestro-android-report.xml`). Device runs were executed by the
implementation session and assessed visually by root.

### P6 keyboard evidence: automated and visual checks

The first Android automated flow passed while Gboard partly covered Send. Root's manual pixel
inspection found the defect, then the implementation agent corrected the Android modal's keyboard
offset using the native status-bar height. iOS retains its existing offset. The targeted sheet suite
passed 14/14, types and lint passed, and the fresh full mobile coverage run passed 897 tests across
81 files with unchanged thresholds.

The final automated Android flow proves the root and reply can be composed, submitted, published
and read with a real keyboard. Its `assertVisible` and successful taps establish discoverability
and interaction. Full pixel visibility is assessed separately: root personally inspected the fresh
root-keyboard, reply-keyboard and discussion images under
`maestro/artifacts/2026-10-19_130157/Screened community comments/takeScreenshot/maestro/artifacts/`.
Root confirmed the entire Send label and bottom edge clear Gboard in both keyboard images, and the
header, Close, long context, Cancel, composer and counter remain readable. Discussion indentation
and controls also render correctly. The earlier iOS images are under the `2026-10-19_125148` run.

No browser or mocked component assertion was added for native IME geometry. Those environments do
not model Gboard occlusion. Existing component interaction checks, real device flows and fresh
manual pixel inspection provide the relevant evidence. TEA reviewed the small follow-up and found
no additional concrete issue; the source fix belongs to the implementation agent.

### P7 and P8: CI setup race and reaction selector regression

P7 was the observed Expo Go installer setup race in Android CI. The implementation agent supplied
a controlled CLI red reproduction with the same ENOENT stack and a five-case passing regression
after fixing final-response file ownership. TEA inspected the small pipeline change and the new
`playwright/support/helpers/install-expo-go.spec.ts`. The tests exercise the real CLI, HTTP
response streams, isolated cache files and selected-device command arguments through a synthetic
ADB executable. They assert exact cache bytes, cache reuse without a second request, failure exit
codes, cleaned partial files, refusal to invoke ADB on failure, and bounded relative redirects.
The local named redirect limit preserves the accepted five-redirect contract.

The five cases passed in `/tmp/story64-installer-green.log`; the implementation agent also supplied
green scoped lint, Playwright types and Node syntax checks in
`/tmp/story64-installer-{lint,types,syntax}.log`. TEA found no additional behavioral test gap and did
not repeat the passing runs. This is a Vitest CLI test; its local HTTP transport exercises Node
streams directly. Playwright browser request fixtures do not apply to that runner.

P8 was reproduced locally before editing: the existing Story 6.3 reaction browser journey failed
with the same strict selector error as CI because two valid controls share `Close this look`.
All three close queries now use the explicitly labelled dialog header control. Each close asserts
that the dialog is dismissed. The reaction counts, persistence, retry, accessibility and keyboard
assertions remain intact, and both UI close controls retain their accessible names.

| Scope                                           | Result                                                    | Evidence                                       |
| ----------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| Focused existing reaction journey before repair | Exact CI strict-selector failure reproduced               | `/tmp/story64-ci-reactions-selector-red.log`   |
| Full real reaction browser suite after repair   | 6/6 passed, including the previously blocked serial cases | `/tmp/story64-ci-reactions-selector-green.log` |
| Playwright types and reaction-spec lint         | Passed with zero warnings                                 | `/tmp/story64-ci-reactions-{types,lint}.log`   |
| Edited-file formatting                          | Passed                                                    | `/tmp/story64-ci-maintenance-format.log`       |

The browser/API/DB/Redis window completed teardown and was returned before further work. These
local repairs have fresh regression evidence; the final CI rerun and PR review remain root-owned.

### Current quality result

[The current RV report](../test-review/test-review-story-6-4-threaded-comments.md) scores **100/100
(A), Approve**, with 0 Critical, 0 High, 0 Medium and 0 Low findings. This is a sequential repair
rescore against Claude's four-dimension review. It preserves the original review provenance and
deduction ledger. Test quality approval and local execution evidence are separate from the final
CI and PR review gates owned by root.

### Library integrations

Both configured utility packages remain in use. No new library deviations were introduced. Pact
broker MCP tools were unreachable in the original review; contract scrutiny used provider source
and generated OpenAPI. Codex preserved that limitation and made no broker verification claim.

## CodeRabbit regressions and final CI flake maintenance

Root triaged the archived backend review in
`_bmad-output/implementation-artifacts/reviews/story-6-4-coderabbit-backend-review.md`.
The implementation agent owned source/Pact changes; Codex TEA owned regressions. Source stayed
unchanged until the red runs completed. Execution status: **passed locally**. Remote CI and final
PR review resolution remain root-owned.

| Finding | Red proof before repair                                                         | Green regression                                                                                                         |
| ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| CR1     | Real outbox/SQL retried a failed generation-0 enqueue at 29.999 seconds         | Fresh initial dispatch is immediate; retry waits until exactly 30 seconds; persisted attempts/dispatched state checked   |
| CR2     | Guarded HTTP returned post-specific text for a changed comment report           | Exact comment-specific 409 envelope and accepted replay pass                                                             |
| CR3     | Final `markFailed` rejection replaced the screening error                       | Exact original error identity and safe secondary warning pass, alongside successful settlement and remaining-retry cases |
| CR4     | Over-cap post-only, comment-only and mixed histories returned early Retry-After | Guarded HTTP selects the limit-th newest receipt across both ledgers                                                     |
| CR5     | Sweep runner and runtime composition resolved after failures                    | All steps run, safe per-step warnings remain, then rejection contains only failed step names                             |
| CR6     | Four deferred root/reply reads lost ownership after a no-cursor append          | First loads and cached last-page refreshes accept data and clear loading, with no additional fetch                       |
| CR7     | Six comment operations lacked reachable 500 metadata                            | Exact standard description and internal-error schema reference pass for each operation                                   |
| CR8     | Both platform wrappers classified new comment 409/403 messages as `unknown`     | Comment and existing post classifications pass; real HTTP and Pact preserve accepted refusal text                        |

CR6's demonstrated boundary is the exported shared client. Both UIs disable More while loading and
omit it without a cursor. These regressions directly exercise stale pager calls. The over-cap
fixtures seed 75 post reports, 75 comment reports, or both. The 50 newest receipts govern expiry.
Date-only control fixes time while the real database exercises selection and truncation.

| Scope                     | Red                                                  | Green                                                | Logs                                                                                    |
| ------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Client races and OpenAPI  | 10 failed, 40 passed                                 | Four files, 123 passed                               | `/tmp/story64-cr-tea-client-{red,green}.log`                                            |
| Worker/runtime            | 3 failed, 11 passed                                  | Three files, 16 passed                               | `/tmp/story64-cr-tea-api-unit-{red,green}.log`                                          |
| Guarded HTTP/recovery SQL | All five new cases failed for intended behavior      | Both complete files, 23 passed                       | `/tmp/story64-cr-tea-http-recovery-{red,green}.log`                                     |
| Web transport             | Two new classifiers failed; unrelated cases filtered | Comments plus post-moderation, 41 passed             | `/tmp/story64-cr-tea-web-classifier-red.log`, `/tmp/story64-cr-tea-web-green.log`       |
| Native transport          | Two new classifiers failed; unrelated cases filtered | Sheet plus screen/client cases, 93 passed            | `/tmp/story64-cr-tea-native-classifier-red.log`, `/tmp/story64-cr-tea-native-green.log` |
| Comment Pact              | Existing assertions retained                         | 38 consumer cases and 1 provider verification passed | `/tmp/story64-cr-pact-{consumer,provider}.log`                                          |

The implementation agent ran filtered Pact, source lint and type checks; TEA independently ran the
other rows. Scoped test lint passed after one formatting-only indentation repair. Shared generation
and builds passed. No assertion, accepted threshold or private-data safeguard was weakened.

### Current-source mutation proof

The original `story-6-4-evidence/mutation-client.{json,md}` stays unchanged: 42 variants on state
source `8daf88b7f169`, with 31 killed and 11 explained equivalent survivors. This is historical
evidence for that snapshot.

The separate `story-6-4-evidence/mutation-client-cr6.{json,md}` records state source
**`9c1b4a4526a2`** and contract source **`dab6fbbd07c5`**. The scratch baseline passes 111/111 tests.
One mutation reintroduces request invalidation in the no-cursor return; all four new race cases
kill it. The historical 42-variant batch was not rerun.

```sh
python3 -I _bmad-output/test-artifacts/automate/story-6-4-evidence/mutation-client.py --only-cr6
```

The runner resolves the repo from its own path, requires a passing baseline, mutates a scratch copy
and removes it in `finally`. Production source stays unchanged.
Log: `/tmp/story64-cr-tea-mutation-cr6.log`.

### P9 and P10 device maintenance

The original CI My Form overlay did not recur spontaneously in the clean local baseline. P9 keeps
destination/editor/ready/removal checks mandatory. Normal My Form passed in 1m51s; an injected
first-navigation failure exercised the actual state-preserving relaunch and passed in 2m33s. Root
inspected its clean recovery screenshot.

P10's trace showed `Visibility Percent: 1.0` while centering a capsule reorder control at the scroll
boundary timed out. Only that search changes to `centerElement: false`; checkbox centering and
subsequent tap/save/reopen/cleanup checks remain. The real capsule flow passed in 3m33s. It verifies
the saved capsule identity and restored reorder list; it does not compare the exact garment order.

All execution windows returned to root. The RV remains **100/100 (A), Approve**, with zero remaining
test-quality findings in the reviewed changes.

## P11 and P12: Community entry and visible action recovery

Actual Android CI run `39310429421`, shard 5, job `118258269076`, failed at the first
`community-screen` assertion before any comment action. TEA independently inspected the CI
screenshot and command trace: Home remained under a uniform gray scrim after the enabled Community
tab tap completed. The exact unattached developer-sheet mechanism is inferred from the matching
documented Expo Go recovery incidents. The actual failure evidence is
`/tmp/story64-ci-22b9-android5.log` and its downloaded artifacts.

P11 replaces the single entry tap/wait with `maestro/subflows/open-community-tab.yaml`. It resets
its own attempt counter, allows two retries, and requires the real tab tap plus the 15-second
destination assertion on every attempt. After a failed attempt it uses the existing
`clearState: false` relaunch and developer-sheet absorber. P12 changes only the initial Comments
action search to `centerElement: false`. Its exact ID, 15-second search, real tap and all remaining
compose, draft, publication, reply, discussion and close assertions stay unchanged. Parsed command
comparison confirms that scope in `/tmp/story64-p11-yaml-static.log`.

| Attempt                               | Result                                                                                                                                            | Evidence                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Unpatched Pixel full flow             | Entry passed; later failed during unchanged 273-unit input with a 120-second `DeviceServerDiedException` deadline                                 | `/tmp/story64-p11-comments-baseline.log`, `/tmp/story64-p11-baseline-report.xml`          |
| Patched Pixel full flow               | Entry passed; later failed with the same input transport deadline                                                                                 | `/tmp/story64-p11-comments-green.log`, `/tmp/story64-p11-pixel-input-failure-report.xml`  |
| Injected missed-tap entry probe       | 1/1 passed in 3m34s; failed first destination check, actual state-preserving relaunch, second real tab tap and required destination/filter checks | `/tmp/story64-p11-entry-probe-report.xml`, `/tmp/story64-p11-entry-trace-proof.log`       |
| Medium full flow before P12           | Entry and Every climate passed; centering search failed with the exact Comments target fully visible, enabled and clickable                       | `/tmp/story64-p11-medium-comments.log`, `/tmp/story64-p11-medium-report.xml`              |
| Final visible-action prefix on Medium | 1/1 passed in 1m1s; final entry helper, exact Comments search/tap, sheet opening, real close and return to Community                              | `/tmp/story64-p11-visible-action-green.log`, `/tmp/story64-p11-visible-action-report.xml` |

The missed-tap probe lives outside the repository. It deliberately omits the first tab tap and
retains the actual destination assertion, then executes the real recovery path. It does not
recreate the invisible CI overlay. TEA independently inspected its source, completed trace and
passing JUnit. Its recovered Community screenshot is clear and readable under
`maestro/artifacts/2026-10-19_144805/Community entry injected recovery/`.

P12 has separate real-device red evidence. The measured Maestro log reports
`Visibility Percent: 1.0`, distinct from the configured visibility requirement. The initial target
bounds `[563,2029][814,2144]` fit the 1080x2400 screen; the failure screenshot and hierarchy show
the exact target at `[563,893][814,1008]`. TEA independently inspected that visible control and
the final centering-only diff. The final short prefix uses the real helper and Comments action,
then closes the sheet and requires Community again. TEA inspected its screenshot under
`maestro/artifacts/2026-10-19_145922/Community entry and visible Comments action/`: header,
Close, Refresh, composer, counter and Send are readable. This image has no open keyboard.

The implementation agent completed both probes and full harness teardown. TEA ran no additional
builds, backend suites or mutation batch for these flow-only repairs. The existing source/API
regressions and historical device evidence retain their original scopes. The two Pixel input
failures and Medium centering failure remain failed local attempts; the short probes establish
entry recovery and visible-action behavior only. **A complete comments journey on the new remote
head remains required.** RV test quality remains **100/100 (A), Approve**, with zero remaining
findings; remote CI and PR review are separate pending gates owned by root.

## CR9 and CR10: frontend measurement and cold runner bootstrap

The actual frontend CodeRabbit review `5577131745` identified two valid issues. The implementation
agent owned source fixes; Codex TEA owned durable tests. CR9 production stayed unchanged until the
real browser reproduced the unwanted request. CR10's isolated actual-runner reproduction preceded
its source fix. An initial browser test-construction mismatch used the older feed schema; TEA
corrected it to the actual shared reaction-feed schema before the intended red run.

CR9's added browser journey opens Comments against the real API and waits for both thread reads.
It observes every `/opened` POST, so server event deduplication cannot hide an extra producer.
Before repair, the opened/focused thread also sent a successful measurement request with
`experimentVariant: auto`, failing the zero-request assertion. After repair, Comments opening and
reopening produce no measurement request. The positive control opens the regular look and checks
exactly one real 200/tracked response with the experiment arm returned by the actual feed. This
guards the measurement-producing HTTP boundary; it makes no separate analytics-sink persistence
claim. The complete comments and reactions suites passed **15/15 in 43.3 seconds**.

CR10's original isolated CLI run failed with `MODULE_NOT_FOUND` for the testing package's cold
`dist/index.js` before startup preparation. The source now calls the existing shared preparation
chain before Prisma/testing imports and fails closed if that command fails. The new
`playwright/support/helpers/run-maestro-bootstrap.spec.ts` runs copies of the actual runner and
its pure imports inside temporary workspace skeletons. Synthetic npm writes only isolated
dependency outputs; synthetic pkill prevents host process changes. The cases prove cold outputs
are prepared, stale warm outputs are replaced, preparation runs once before both imports, and a
failed preparation prevents imports/platform work. Successful cases stop at the real explicit
invalid-platform boundary. These three CLI cases passed; they exercise neither devices nor a real
workspace build, API or database.

| Scope                                                       | Result                                                                       | Evidence                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| CR9 real-browser prepatch reproduction                      | Intended zero-request assertion failed with one successful card-open request | `/tmp/story64-cr9-browser-red.log`            |
| CR9 complete comments and reaction suites                   | 15/15 passed, including the regular-look positive control                    | `/tmp/story64-cr9-browser-green.log`          |
| CR10 isolated actual-runner reproduction                    | Cold package import failed before preparation                                | `/tmp/story64-cr10-cold-red.log`              |
| CR10 implementation-agent CLI probes                        | Cold, stale and failed-preparation boundaries passed                         | `/tmp/story64-cr10-cold-green.log`            |
| CR10 durable CLI regressions                                | 3/3 passed                                                                   | `/tmp/story64-cr10-bootstrap-tests-green.log` |
| Complete Playwright helper suite during browser preparation | 7 files, 53 tests passed                                                     | `/tmp/story64-cr9-browser-green.log`          |
| Edited test ESLint and Playwright types                     | Both exit 0                                                                  | `/tmp/story64-cr9-cr10-test-{lint,types}.log` |

The implementation agent independently reviewed both test deltas and found no additional gap.
Its source lint, web types, Node syntax and formatting checks passed as recorded in
`/tmp/story64-cr9-cr10-implementation-handoff.md`. TEA's browser run completed API/worker/web
teardown and returned the execution window. No further native flow or historical mutation batch
was rerun for these fixes. RV remains **100/100 (A), Approve**, with zero test-quality findings.
Complete remote CI on the final head, including the pending full comments device journey, remains
required before the user's completion definition is met.
