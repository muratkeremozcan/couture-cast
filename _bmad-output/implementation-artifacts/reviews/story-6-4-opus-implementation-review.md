<!-- Archived peer review before the review fixes. -->

# Story 6.4 implementation review (Claude Code, Opus 5.5)

- **Reviewer:** Claude Code, model Opus 5.5 (`claude-opus-5-5`). Date: 2026-10-19.
- **Scope:** the complete staged diff since `989d1017` (91 files), reviewed against `spec-6-4-threaded-comments.md`, `6-4-threaded-comments-design.md` and `epic-6-context.md`.
- **Method:**
  - I reviewed the backend (schema, migrations, repository, service, worker, outbox, guardian, erasure, telemetry) directly.
  - Two read-only sub-reviewers covered the web and shared client, and the mobile, E2E, Pact, OpenAPI and RevenueCat changes.
  - I re-verified every blocker and high finding against the working tree. Sub-reviewer reproductions ran from scratchpad scripts; `git status` is unchanged.
- **Constraints observed:** read-only throughout. No source edits, commits, pushes, PRs, deploys or flag changes.

**Verdict: not ready to merge.** There are three blockers and one high finding. Everything else is medium or low.

## Blockers

### B1. Worker publication depends on the global fallback flag cache, which breaks the documented cohort rollout

- **Location:**
  - `apps/api/src/modules/community/community-comments.processor.ts:43-48` and `:60-65`
  - `community-comments.service.ts:29-33`
  - `apps/api/src/modules/feature-flags/feature-flags.service.ts:77-101`
  - `packages/config/src/flags.ts:60-62`
- **Trigger:**
  - The request path evaluates both flags per member through PostHog.
  - The worker additionally requires the `feature_flags` DB rows for both keys to equal `true`, read before the transaction and again `FOR SHARE` inside it.
  - Those rows are a fallback cache that `syncFlags` fills by evaluating a synthetic distinct ID.
  - `flags.ts` states the beta "needs to open reading to a cohort". Under a cohort or percentage rollout, the synthetic ID evaluates false.
- **Impact:**
  - Cohort members create comments successfully, but every job throws `community_comment_publication_frozen`.
  - After 3 attempts the job reaches `markFailed`, which sets `screening_failed` and writes a moderation intake row.
  - No comment publishes during the beta.
  - The integration tests always seed both DB rows true (`apps/api/integration/community-comments.integration.spec.ts:96`), so this divergence is untested.
- **Fix:**
  - Use one rollout authority: the per-author `FeatureFlagsService` value, resolved before locks. It already falls back to the DB cache when PostHog is unavailable.
  - Remove the global `feature_flags` checks, or replace them with a dedicated global kill-switch key whose semantics are documented.
  - Add a test with remote flags true for the author and DB cache false.

### B2. A posting freeze or a brief flag outage permanently fails queued comments and floods moderation intake

- **Location:**
  - `apps/api/src/modules/community/community-moderation.worker.ts:237-245`, `:115-117`
  - `community-comments.processor.ts:32,48,65,134-171`
- **Trigger:**
  - "Frozen" is thrown as a normal job failure.
  - The job has 3 attempts with about 3s of total backoff, and the last attempt calls `markFailed`.
- **Impact:**
  - A freeze longer than a few seconds turns every queued comment into terminal `screening_failed`; recovery requires delete and resubmit.
  - Each one also creates a `CommunityCommentReport` intake row with reason `inappropriate_content` and a 24h SLA.
  - This contradicts the design: "A queued comment observed during a posting freeze stays private, retryable through bounded recovery".
  - The freeze tests (`integration.spec.ts:858-970`) call `processor.process` directly and never exhaust job attempts.
- **Fix:**
  - Treat a freeze as a deferral: keep `pending_screening`, re-arm the outbox (bump `generation`, clear `dispatched_at`), and return without throwing.
  - Exempt or extend frozen rows in the 15-minute stale sweep.
  - Write intake only for real screening outcomes.
  - Add a test where the freeze outlasts all attempts.

### B3. CI mobile E2E crashes before any flow runs

- **Location:** `scripts/run-maestro.mjs:37`, `.github/workflows/pr-mobile-e2e.yml`, `scripts/ci-mobile-e2e.sh`
- **Trigger:**
  - The new top-level `require('@couture/testing')` resolves to `packages/testing/dist/index.js` (`package.json` main/exports).
  - `dist` is gitignored (`.gitignore:17`).
  - The PR mobile workflow runs only `npm ci`, `npm run db:reset` (`prisma migrate reset` plus a tsx seed), the Maestro install and `ci-mobile-e2e.sh` before the script. None of these builds `@couture/testing` or its `@couture/api-client` dependency.
- **Impact:**
  - Every Maestro shard fails with `MODULE_NOT_FOUND`, the comments flow included.
  - Local runs pass only because a stale `dist` exists on this machine.
  - I verified this by static trace; it has not run in CI.
- **Fix:** do one of:
  - Inline the small cleanup in `run-maestro.mjs`.
  - Import it lazily after a build.
  - Add `npm run build --workspace @couture/testing` (which builds its shared deps) to `ci-mobile-e2e.sh` before `node ./scripts/run-maestro.mjs`.

## High

### H1. A definitive create rejection wedges the composer for that post on both platforms

- **Location:** `packages/api-client/src/community-comments-state.ts:309-344`; rendered in `apps/web/src/app/components/community-comments.tsx` and `apps/mobile/components/community/community-comments-sheet.tsx:334-350`.
- **Trigger:**
  - `state.unresolved` is set before sending and cleared only on success (`:336`). `failed()` never clears it.
  - A member replies to a root, the root's author deletes it, and the server returns 400 "Reply target is unavailable." (`community-comments.repository.ts:326`). The same happens for a 403 age/consent refusal, 409 or 429.
- **Impact:**
  - Every later Send or Retry replays the same UUID, body and dead `parentId`. Editing the draft or cancelling the reply has no effect.
  - `unresolved` survives closing the sheet, so the user is stuck until sign-out or a reload.
  - Both sub-reviewers reproduced this independently. I confirmed it at `:309-344`.
  - The state spec (`community-comments-state.spec.ts:272-288`) covers only `unknown` failures.
- **Fix:**
  - Retain `unresolved` only for transport-uncertain outcomes: network, timeout or 5xx.
  - Clear it on definitive 4xx, keep the draft, and show a specific error.
  - Add a state test per failure class.

## Medium

### M1. Age and consent refusals on comment create reach users as "Try again"

- **Location:** `community-comments.service.ts:41-45`, `community-comments-state.ts:152-168`.
- **Trigger:**
  - The age gate throws `'Community requires age 13 or older.'`.
  - The guardian refusal surfaces as an untranslated `GUARDIAN_CONSENT_REQUIRED`.
  - The shared state maps both to `community.comments.failed`.
- **Impact:**
  - A 13-15 year old without consent is told to retry. Combined with H1, they also get stuck.
  - `community.service.ts:336-363` documents this exact defect for posts and fixes it by rewriting to `COMMUNITY_AGE_GATE_DENIED_MESSAGE`.
- **Fix:**
  - Rewrite `ForbiddenException` to `COMMUNITY_AGE_GATE_DENIED_MESSAGE` here as well.
  - Map 403 `age_gate` to `community.error.ageGate` in the shared state.
  - Add HTTP and rendered tests.

### M2. Author deletion wipes report snapshots, so the author can erase the evidence of reported abuse

- **Location:** `community-comments.repository.ts:417-420`.
- **Trigger:** a reported comment is deleted by its author.
- **Impact:**
  - `content_snapshot` and the body are both cleared, so the future moderator has no evidence.
  - Post reports deliberately keep their snapshot through withdrawal and erasure (`community.repository.ts:707-712`, `community-maintenance.service.ts:145-153`).
  - The 6.4 design scrubs snapshots on erasure; author deletion is absent from that list.
- **Fix:** keep the snapshot on author deletion and scrub it only on erasure and consent suppression. Otherwise record an explicit product decision.

### M3. Web focus falls to `<body>` when the focused control unmounts, so Escape and Tab trapping stop working

- **Location:** `community-comments.tsx` at `:241-251` (private Delete), `:116-146` (report form), `:279-290` (reply Cancel), `:194-205` and `:211-222` (last-page "More"); `accessible-modal.tsx:89-126,134`.
- **Trigger:** the modal handles keys on the dialog's own `onKeyDown`. Once focus is on `<body>`, keydown never reaches it.
- **Impact:**
  - Keyboard and screen-reader users lose their place.
  - Escape no longer closes the dialog, and Tab can leave it.
  - The lookbook page has no `[data-app-shell]`, so the page behind is never made inert (see L-web-4).
  - The sub-reviewer reproduced this with a rendered test.
- **Fix:** move focus deliberately to the nearest stable target: the item or status region after delete, the Report trigger after the form closes, the composer after Cancel, the new items after paging.

### M4. Status polling announces every failure repeatedly, never clears the error, and runs unconditionally

- **Location:** `community-comments.tsx:44-50,341-345`, `community-comments-state.ts:294-303`.
- **Trigger:**
  - A poll runs every 3s while the dialog is open, even with no pending submissions.
  - Each failure calls `announce()` with a new id and also renders `role="alert"`.
  - A successful poll never resets `state.error`.
- **Impact:**
  - During a network blip, screen-reader users hear the error every 3s, and the stale alert persists after recovery.
  - Every viewer with the dialog open costs a locked, authenticated API transaction every 3s.
- **Fix:**
  - Announce background failures only on a state transition, and clear the error on poll success.
  - Use a single announcement channel.
  - Poll only while a submission is `pending_screening`, with backoff.

### M5. A successful delete discards unrelated in-flight create and report results for the post

- **Location:** `community-comments-state.ts:360` (post-wide fence bump), which invalidates tickets from `:325` and `:391`.
- **Trigger:** a Send is in flight while the member deletes another of their comments.
- **Impact:**
  - The committed create result is dropped: no private status, `unresolved` remains, and the UI offers "Retry submission" for an accepted comment.
  - The report confirmation is suppressed.
  - The sub-reviewer reproduced this.
- **Fix:** fence only reads that could carry the deleted text, or check per item. Leave mutation tickets unaffected.

### M6. Announcements persist and replay on both platforms; mobile renders them as visible stale text

- **Location:**
  - `apps/mobile/components/community/community-comments-sheet.tsx:27-40,76-80,351-359`
  - `community-comments.tsx:52-55`
  - `community-comments-state.ts:149-168`
- **Trigger:** the screen-owned `announcement` is never cleared.
- **Impact:**
  - On mobile:
    - The live-region text is visible, so "Comment submitted for screening." remains beside "Published." after refresh. The iOS/Android Maestro screenshots `community-comments-submitted.png` and `community-comments-discussion.png` show this.
    - Errors render twice.
  - On both platforms, closing and reopening the thread re-announces the last message and moves focus to the private status region, overriding the intended title or heading focus.
- **Fix:** hide the mobile live text visually, and track the last consumed announcement id per post (or clear it on consume and on `load()`).

### M7. Comment outbox failures are swallowed without any operator signal

- **Location:** `community-comments.outbox.ts:29-34,104-106`.
- **Impact:** a missing `captureAcknowledged` transport or repeated sink rejection leaves events pending without any log. This repeats 6.3 finding BH10, which 6.3 fixed.
- **Fix:** reuse the reaction outbox's safe failure logging: reason, attempt and age, with no identifiers.

### M8. New comment sweeps can block existing post and reaction sweeps

- **Location:** `community-worker-runtime.ts:419-430`.
- **Impact:**
  - An exception from `comments.dispatchPending()` skips reaction dispatch for that tick.
  - An exception from `comments.sweepStale()` skips the post `sweepStalePendingReview`.
  - Comment analytics delivery also consumes up to 1s of the tick before reactions run.
- **Fix:** isolate each step with `Promise.allSettled` or per-step try/log, and run existing work first.

### M9. Verification gaps in the matrix evidence

- **Review versus block is never pinned.**
  - Location: `playwright/tests/community-comments.spec.ts:160-183`, `apps/api/integration/community-comments.integration.spec.ts:772-776`.
  - Both accept `held_for_review|blocked` for both texts, and no test asserts an exact `held_for_review`.
  - The Playwright case is API-only, so it never checks how private status renders in the UI.
  - Fix: pin each disposition and its intake/audit row, and drive one withheld case through the UI.
- **Pact covers only happy paths and a 404.**
  - Location: `pact/http/consumer/interactions/community/comments.ts:94-168`.
  - Missing:
    - 409 idempotency mismatch and report reason change
    - 429 with Retry-After
    - 400 cursor/validation
    - 403 age gate and self-report
    - 503 disabled
  - There is no paginated request, and bodies are exact literals where sibling interactions use matchers.
  - The clients classify failures by these envelopes (`apps/mobile/src/lib/community.ts:132-157`).
- **No E2E layer exercises report or consent.** The integration spec is their only coverage. Maestro covers only the publish path.
- **Mobile mocks are never asserted.** `announceForAccessibility` and `setAccessibilityFocus` are mocked but unchecked (`community-comments-sheet.test.tsx:30-41`). No screen test covers Comments-button focus restoration, session reset, or evict-on-404 closing the sheet.
- **One web test cannot fail.** `community-comments.test.tsx:358-359` passes without its guard, because `waitFor` resolves before the refresh lands.

### M10. The supertest IPv6 wrong-responder hazard remains in the new suite

- **Location:** `apps/api/integration/premium-revenuecat-webhook.integration.spec.ts:245-248` (fixed), `community-comments.integration.spec.ts:139-140,224-225,605-610` (still exposed).
- **Trigger:** supertest's implicit listen binds `::` on port 0 but connects to 127.0.0.1. The sub-reviewer confirmed that macOS lets a `::` listener share a port already held on 127.0.0.1, which reproduces the logged 404 and empty-body 401 failures.
- **Assessment:**
  - The RevenueCat change is a legitimate fix that hides no product bug.
  - The new comments spec and 14 other suites keep the hazard.
  - The suite-long RevenueCat listener can itself become the wrong responder for them.
- **Fix:** add a shared helper that listens on `127.0.0.1:0` and passes the URL to supertest in every HTTP integration suite.

## Low and suggestions

### Backend

- **Wrong status when publication becomes ineligible.** `community-comments.processor.ts:87-92` records every publication-time ineligibility (post hidden, root deleted, consent lost) as `consent_suspended`. An adult's reply under a deleted root is recorded as a consent suppression. Use a distinct private terminal status or record the cause.
- **Technical failures look like content reports.** `community-comments.processor.ts:161-169` files technical `screening_failed` intake as `inappropriate_content` with a 24h SLA. Use a distinct action or reason, or skip intake for technical failures.
- **Receipt hash allows text confirmation.** The receipt keeps an unsalted SHA-256 of `[postId, parentId, body, locale]` after author deletion (`community-comments.repository.ts:307-309`), so short deleted texts can be confirmed by guessing. Use an HMAC with an existing server secret.
- **Audit FK conflicts with append-only.** `CommunityCommentAudit.report_id ON DELETE SET NULL` contradicts the append-only trigger, so any report delete raises (`20261019000000_threaded_comments/migration.sql:169`; `..._invariants/migration.sql:82-85`). Use `ON DELETE RESTRICT` to state that intent.
- **Guardian extraction lost its comment.** `guardian-participation.ts` behaves the same as before (I verified this), but it dropped the load-bearing comment on the order of the age-before-compliance checks and duplicates the compliance parser. Restore the comment and reuse the helper.
- **Read lock contention.** Reads take `FOR SHARE` on the post row (`community-comments.repository.ts:116-118`), so on a hot post, readers and writers queue behind each other. This is acceptable at beta scale; revisit it with polling (M4).

### Web

- **Invisible fillers pass validation.** `contracts/http/community.ts:1065` accepts U+3164, U+FFA0, U+115F, U+034F, U+FE0F and U+2800 alone as visible text, and the DB function mirrors that. The screener treats Default_Ignorable code points as invisible (`community-text-screener.ts:325`). Align both checks.
- **Private submissions flicker or duplicate.** A non-append poll in flight when a create resolves wipes the fresh pending item. A replayed `published` result is prepended without the `publicIds` filter and shows twice.
- **No erasure event producer.** Nothing dispatches `couture:account-erased` (`community-lookbook-grid.tsx:1825`).
- **Page behind the dialog is not inert.** The lookbook page lacks `[data-app-shell]`, so it is never inert behind the detail dialog. This predates 6.4. The portal move did not regress other `AccessibleModal` callers.
- **Smaller UI issues:**
  - There is no delete confirmation.
  - "Close comments" closes the whole look dialog.
  - "Replies (n)" sets `aria-expanded` but never collapses.
  - Repeated Reply/Delete/Report buttons lack per-item accessible names.
  - The report form closes on failure and loses the chosen reason.

### Mobile and E2E

- **Report form closes on failure.** `state.report()` never rejects, so the form closes on failure and the reason carries over to the next item (`community-comments-sheet.tsx:165-167`).
- **404 closes the wrong sheet.** `setCommentsPostId(null)` on a deep-link or highlighted 404 closes a sheet open on a different post (`community-screen.tsx:319-321,400-402`).
- **Focus restores to the wrong card copy.** The highlighted card and the feed card share one `commentsButtonRefs` key, so focus restore can target an offscreen or null node (`community-screen.tsx:908-911,999-1002`).
- **Session sync can reject every second.** It polls `resolveMobileAccessToken()` every second without a catch (`community-screen.tsx:186-200`).
- **Accessibility gaps on mobile:**
  - The selected report reason is conveyed by colour alone (WCAG 1.4.1).
  - Action labels are identical across items.
  - The reply target is never named.
- **Maestro taps are unscoped.** The flow taps "Reply" and "Replies (1)" on shared `lookbook-5` without scoping to an entry, so leftover data misdirects it (`maestro/community-comments.yaml:72,100-105`).
- **Retained roots are not scrubbed.** The Maestro cleanup does not scrub retained roots, and the later user delete under `session_replication_role = 'replica'` bypasses the scrub trigger (`scripts/run-maestro.mjs:1563-1570`). No cross-user reply exists today; reuse the Playwright helper sequence anyway.
- **Mobile tests depend on root build order.** The mobile test imports `@couture/testing` dist, which apps/mobile never builds, so `npm test -w apps/mobile` fails on a clean checkout.

## Verified correct

- **Schema and data invariants:**
  - The same-post, one-level reply trigger and immutable parent fields.
  - DB body validation at parity with JS trim code points, NFC and UTF-16 units, plus a lone-surrogate 400.
  - The publication sequence is assigned under the post lock.
  - Snapshot cursors are scoped by kind, post and parent.
  - Receipts are payload-bound; replays bypass quota and survive deletion.
- **Privacy and consent:**
  - Guardian revocation locks commented posts and suspends published and pending comments.
  - Erasure through `requestErasureForUser` (reached from `community.service.ts:1347`) and through the direct User delete trigger scrubs body, receipts, outbox, analytics subject and report snapshots.
  - BullMQ jobs carry identifiers only, and retained jobs are removed on re-enqueue.
- **Boundaries and concurrency:**
  - The request import boundary is unaffected.
  - The report lock order cannot deadlock against post reports.
  - The 6.3 reaction generation trigger is column-scoped and does not fire on sequence bumps.
- **Contracts and clients:**
  - OpenAPI changes are purely additive. After key sort, the file is byte-identical to baseline once the new comment paths and schemas are removed; the large deletion count is a diff artifact.
  - All ten web and mobile locale catalogs have complete key parity and no untranslated strings.
  - Strict contracts.
  - All six client operations forward `RequestInit`.
- **Test hygiene:**
  - Playwright uses no hard waits, real worker publication and tombstone coverage.
  - The scoped fixture cleanup is safe.

## Recommended order

1. **B1 and B2.** Fix together: give rollout one authority, and make a freeze a deferral.
2. **B3.** Fix the CI build of `@couture/testing`.
3. **H1 and M1.** Fix together: separate definitive failures from uncertain ones, and add age-gate copy.
4. **M2.** Make the product decision on the report snapshot.
5. **M3 to M8.** UI focus and announcement fixes, plus outbox and sweep robustness.
6. **M9 and M10.** Close the evidence gaps and add a shared loopback listener helper.

## Delivery follow-up

This is the unchanged review snapshot from the user-owned Claude Code Opus 5.5 session.
Its verified peer reply arrived at 2026-10-19T16:33:48.068Z.
The parent classified each finding independently in [the story triage log](../spec-6-4-threaded-comments.md#review-triage-log), including the refuted cold-CI claim.
That log and the TEA review record the subsequent repairs and executed verification.
