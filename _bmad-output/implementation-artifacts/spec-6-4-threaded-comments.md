---
title: 'Story 6.4: Threaded comments'
type: 'feature'
created: '2026-10-19'
status: 'in-review'
baseline_commit: '989d101785d2fdec203e63d05213862442475e4c'
route: 'dispatch'
story_key: '6-4-threaded-comments'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/6-4-threaded-comments-design.md'
---

<!-- prettier-ignore-start -->

<frozen-after-approval reason="human-owned intent">

## Intent

Members can discuss public looks through screened comments and one reply level.
Deliver persistent threads with deletion tombstones, reporting, and accessible web/mobile controls.

## Boundaries & Constraints

Comments contain 1-280 trimmed characters and a supported locale.
Roots/replies appear oldest first with independent bounded keyset pages.
Creation requires authentication, both community flags, age 13+, and existing under-16 consent.
Read, report, and author deletion require the read flag; deletion survives consent loss.
Every operation checks parent-post visibility and applicable ownership.
The standalone worker screens before publication; pending status stays author-private.
Deletion clears text/attribution and preserves replies through tombstones.
Consent revocation hides affected contributions atomically; erasure scrubs personal content within 72 hours.
Every visible comment exposes reporting; accepted reports reach durable moderation intake within five minutes.
Preserve strict feed/detail contracts and disabled production flags.
Realtime, notifications, and moderator UI belong to later stories.

## I/O & Edge-Case Matrix

| Input/state                         | Result                                                               |
| ----------------------------------- | -------------------------------------------------------------------- |
| Root/reply to root                  | Private pending; passing screening publishes once                    |
| Deeper reply or invalid text/cursor | Validation error; unchanged thread                                   |
| Retried create UUID                 | Same submission; changed payload conflicts; deletion survives replay |
| Concurrent publish/pages            | Scoped snapshot cursor prevents gaps/duplicates                      |
| Review/block/screening failure      | Withheld text; private status/recovery; moderation record            |
| Author deletion                     | Idempotent tombstone; replies survive                                |
| Report/retry                        | Durable case/audit; dedupe and shared abuse limits                   |
| Consent loss/hidden post/erasure    | Content disappears; delayed responses cannot restore it              |
| Network failure/close               | Confirmed state, draft and retry identity survive                    |

</frozen-after-approval>

<!-- prettier-ignore-end -->

## Code Map

Paths below are relative to `apps/api/src/modules/community/` unless prefixed otherwise.

- `community.repository.ts`: canonical visibility predicate, member-before-post locks, report transactions.
- `community.module.ts`: enforced request import boundary excludes screening code.
- `community-text-screener.ts`: multilingual obfuscation-aware screening; caption ceiling 280.
- `community-moderation.worker.ts`: worker lifecycle and pinned screening policy.
- `apps/api/src/modules/guardian/guardian.service.ts`: consent and revocation transaction.
- Web `community-lookbook-grid.tsx`: screen-owned state, detail dialog and modal announcements.
- Mobile `community-screen.tsx`: screen-owned state; add a dedicated comments sheet.

## Tasks & Acceptance

**Execution:**

- [x] `packages/db/prisma/schema.prisma`, new migration: comments, same-post root constraint, publication order, payload-bound receipts, screening/analytics outboxes and report/audit records; API-only RLS, indexes, tombstone/erasure cleanup.
- [x] `packages/api-client/src/contracts/http/community.ts`, `packages/api-client/src/client.ts`: separate root/reply pages, private submission status, create/delete/report endpoints; post/parent/snapshot-bound cursors; regenerate SDK/OpenAPI.
- [x] New `community-comments.repository.ts`, `community-comments.service.ts`, existing controller/module: eligibility under shared locks, paging, replay protection, bounded submission/report rates and transactional moderation intake with a five-minute deadline.
- [x] Community queue/outbox/worker and `apps/api/src/workers/community.bootstrap.ts`: text-only jobs, existing policy, conditional publication, bounded retries and stale-job recovery; preserve request import boundary.
- [x] Guardian service, community maintenance/analytics and `packages/api-client/src/types/analytics-events.ts`: atomic consent suppression, erasure, durable deduplicated create/delete/report telemetry; exclude text/raw identities/canaries.
- [x] New `packages/api-client/src/community-comments-state.ts`, `apps/web/src/lib/community.ts`, `apps/mobile/src/lib/community.ts`: shared request/draft/retry ownership, page merge and late-response visibility fences.
- [x] `apps/web/src/app/components/community-lookbook-grid.tsx`, new adjacent `community-comments.tsx`; mobile screen/card and new `apps/mobile/components/community/community-comments-sheet.tsx`: Comments action, root/reply compose, private status, report/delete/tombstones, load-more, focus/announcements, 44px targets and theme contrast.
- [x] Web/mobile locale catalogs and `packages/testing/src/factories/community.factory.ts`: all ten translations, deterministic thread fixtures and cleanup.
- [x] Colocated API/client/component tests, `apps/api/integration/community-comments.integration.spec.ts`, `packages/db/test/rls/community-posts.spec.ts`, Pact interactions/provider doubles, new `playwright/tests/community-comments.spec.ts` and `maestro/community-comments.yaml`: matrix, real worker, concurrency, consent races, privacy, report timing, accessibility and recovery.

**Acceptance Criteria:**

- Given concurrent submissions, when screening and traversal finish, then every eligible published item appears once within its snapshot and nesting stays one level deep.
- Given deletion, consent change, or erasure, when committed/refreshed, then safe thread shape survives and ineligible content disappears.
- Given an accepted report, when its response succeeds, then durable moderation intake exists with a routing deadline within five minutes.
- Given either platform and supported locales, when using keyboard/screen reader, then all thread actions and recovery are usable.

## Implementation Notes

- 2026-10-19: User approved handling the Opus spec findings and continuing the requested delivery workflow.
- The supporting design records the resolved review details. Complete local implementation and validation before remote delivery.

- Schema, API, worker, shared client, web and mobile thread surfaces are implemented. Read paths use shared member/post locks with batched aliases and reply counts; writes retain exclusive member-before-post order.
- Database text checks match NFC UTF-16 validation, including supplementary emoji, invisible-only format characters and Unicode line/paragraph separators. Direct User erasure scrubs report JSON and pending analytics.
- Shared report quota returns the earliest expiry from the combined post/comment ledger; guarded HTTP tests pin the clock and cover both routes.
- Shared state fences stale failures, invalidates cached replies on refresh and reconciles all loaded private pages through serialized polling. Web Comments focuses the thread heading; native uses keyboard avoidance and localized close controls.
- Latest source additions include PostHog-backed worker flag wiring, accurate shared quota Retry-After, dedicated Comments focus, native keyboard avoidance/primary Send styling, a fixed composer footer for reply keyboard access, and scoped synthetic fixture cleanup. Final validation and fresh browser/iOS/Android evidence below include these additions.

- Final own-review regressions reproduced and fixed: first reply expansions finishing after reopen, own unavailable placeholder deletion, and deep-link network failures clearing discussion drafts. Focused rendered evidence is retained in `/tmp/story64-inflight-reply-repro.log`, `/tmp/story64-own-delete-web-repro.log`, `/tmp/story64-own-delete-mobile-repro.log` and `/tmp/story64-deep-link-repro.log`; fixed journeys pass.
- All six shared comment operations now forward RequestInit cancellation. Mobile uses the existing 15-second request timeout; web uses its existing 15-second AbortSignal deadline pattern. A deferred generated-fetch regression proves pending releases, drafts survive, and the immutable retry payload is retained. Logs: `/tmp/story64-deadline-repro.log` and `/tmp/story64-deadline-fixed.log`.
- Restored four unrelated commerce FK relations to Restrict and regenerated the first comment migration with Prisma from the baseline schema. Fresh disposable migration/API verification passed 36 tests; custom invariant migration is preserved.

- Analytics secret rotation reproduced a guarded HTTP create 500 for a returning member. Outbox events now use the durable actor returned from the subject upsert. Regression log `/tmp/story64-rotation-repro.log`; fixed full integration evidence `/tmp/story64-comments-integration-final.log`.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | ------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1      | medium  | patch  | Shared submit retains unresolved after a definite HTTP rejection. A deleted reply root returns 400; editing the draft or cancelling reply still resends the rejected body/parent. Clear only confirmed rejected attempts; preserve transport-uncertain identity.                                                                                                                                                                  |
| B2      | medium  | patch  | delete increments the post fence after its response. Two deletes started under the same ticket both succeed at the API, but the second response fails valid() and leaves its text cached. Invalidate outstanding reads without invalidating independent mutations.                                                                                                                                                                |
| B3      | medium  | patch  | readStatuses captures a request before submit completes and replaces submissions with its older empty result. The successful create does not invalidate that private read, so its confirmed submission disappears.                                                                                                                                                                                                                |
| B4      | high    | patch  | reconcileSubmissions drops every item whose ID is already public. An author_deleted or consent_suspended private status therefore leaves cached public body and alias visible. Apply authoritative suppression before public-ID deduplication and fence older reads.                                                                                                                                                              |
| B5      | high    | patch  | deliverAnalytics leases a row into memory, then invokes captureCommentEvent after erasure may delete the subject/outbox. The capture upserts TelemetryEvent and sends the erased actor. Serialize delivery with live subject deletion and verify both race orderings.                                                                                                                                                             |
| B6      | medium  | patch  | Worker DB checks reject author-targeted true when the synthetic fallback identity is false. Opus traced syncFlags and the documented cohort rollout: these rows are a fallback cache. Remove the extra cache-as-global-switch checks and retain the per-author FeatureFlagsService authority. This corrects the initial proposed triage fix after tracing the cache owner.                                                        |
| B7      | false   | reject | The alleged committed freeze is an update to the synthetic fallback cache, which does not establish that the caller's per-user flag is false. FeatureFlagsService intentionally evaluates remote per user and the design resolves external calls before locks. Using cache rows as an authoritative switch would break cohort rollout; O-B1 supplies that concrete counterexample. Initial proposed global-gate fix is withdrawn. |
| B8      | medium  | patch  | report catches transport rejection and resolves void. Both platform forms close in then() after a failed report, losing the selected recovery surface. Return an explicit accepted result and close only on acceptance.                                                                                                                                                                                                           |
| B9      | medium  | patch  | The inline web report form neither focuses its reason selector on open nor restores the originating Report control after cancel/success. Removing the focused Cancel button sends focus to body. Retain and restore the actual invoking control.                                                                                                                                                                                  |
| B10     | medium  | patch  | Comment Pact interactions cover success and unavailable reads only. Invalid input, eligibility, changed mutation/report intent and shared quota Retry-After lack consumer/provider contract assertions. Add deterministic negative interactions to the existing contract path.                                                                                                                                                    |
| E1      | medium  | patch  | Independent edge tracing confirms the B2 two-delete race: the first response changes the whole-post fence and rejects the second successful mutation response. Each finding is retained separately before grouping.                                                                                                                                                                                                               |
| E2      | medium  | patch  | Independent edge tracing confirms B1: a definitive rejected reply remains the immutable unresolved payload after reply cancellation and draft editing.                                                                                                                                                                                                                                                                            |
| E3      | high    | patch  | Independent edge tracing confirms B4: author-private suppression is ignored for already-public IDs, preserving cached body and attribution.                                                                                                                                                                                                                                                                                       |
| E4      | high    | patch  | Independent edge tracing confirms B5: a leased in-memory analytics row remains deliverable after erasure commits and deletes its durable subject/outbox.                                                                                                                                                                                                                                                                          |
| V1      | medium  | patch  | Pre-verified gap: integration recovery mocks the entire captureCommentEvent method. Removing its acknowledged sink call still passes. Exercise the real TelemetryService with PostgreSQL and an acknowledged fail/retry sink; assert stable dedupe ID, snake_case properties and durable receipts.                                                                                                                                |
| V2      | medium  | patch  | Pre-verified gap: failure coverage calls processor.markFailed directly and the real Redis worker case covers success only. Removing the worker exhaustion branch still passes. Exercise actual comment retries through Redis and assert private pending until exhaustion, then one screening_failed intake/audit.                                                                                                                 |
| O-B1    | high    | patch  | Verified syncFlags uses FEATURE_FLAG_SYNC_DISTINCT_ID and request flags resolve per member. Worker adds an incompatible global cache check. A targeted true member with false synthetic fallback cannot publish; remove only the redundant DB checks and retain per-author evaluation.                                                                                                                                            |
| O-B2    | high    | patch  | Worker catch invokes markFailed after three generic thrown freeze errors. Outbox stale sweep also fails every old pending row regardless of rollout. Existing generation/dispatched fields can defer frozen work without content failure/intake; test a freeze spanning retries and stale age, then recovery.                                                                                                                     |
| O-B3    | false   | reject | Mobile CI runs root db:reset at pr-mobile-e2e.yml:288. That invokes the db workspace predb:reset hook, whose prepare:shared-deps builds testing, client and utils before Maestro starts; baseline package scripts and .npmrc preserve lifecycle execution. This directly refutes the claimed clean-CI missing dist. O-LM8 standalone mobile tests remain a separate real build-order gap.                                         |
| O-H1    | medium  | patch  | Verified same definite-rejection unresolved-payload defect as B1/E2. The retained exact retry is appropriate for uncertain outcomes; confirmed 4xx requires release of the rejected attempt.                                                                                                                                                                                                                                      |
| O-M1    | medium  | patch  | Comment service throws raw age/guardian refusals while platform classifiers recognize COMMUNITY_AGE_GATE_DENIED_MESSAGE. The rendered state maps age_gate to generic failure. Reuse the established surface message and translation.                                                                                                                                                                                              |
| O-M2    | medium  | patch  | Author delete explicitly clears every report snapshot. Reports already accepted before deletion lose their moderation evidence; the design requires scrubbing on erasure and consent. Preserve accepted snapshots through ordinary author deletion; retain erasure scrubbing.                                                                                                                                                     |
| O-M3    | medium  | patch  | Private Delete, report close, reply cancellation and completed pagination remove focused controls. AccessibleModal handles keys on its subtree; body focus bypasses Escape/Tab handling. Focus stable existing status/composer/item or trigger targets after these actions.                                                                                                                                                       |
| O-M4    | medium  | patch  | Both components poll every three seconds even without pending screening. Each rejected poll creates a new announcement and success leaves stale error. Poll active pending work with bounded backoff, announce error transitions once and clear recovered errors.                                                                                                                                                                 |
| O-M5    | medium  | patch  | The delete post fence also invalidates concurrent create/report tickets, leaving accepted creates unresolved and suppressing report confirmations. This shares the B2/E1 fence root cause.                                                                                                                                                                                                                                        |
| O-M6    | medium  | patch  | Screen-owned announcement persists after close. Mount effects replay it and native renders the stale live text visibly beside newer status. Consume announcement IDs once and use one accessible announcement channel without persistent duplicate visual copy.                                                                                                                                                                   |
| O-M7    | medium  | patch  | Both comment enqueue and analytics catches only mutate attempts/backoff. An unavailable acknowledged sink has no operator signal. Reuse content-free reason/attempt/age logging from the reaction outbox.                                                                                                                                                                                                                         |
| O-M8    | medium  | patch  | Runtime sequentially awaits comment dispatch before reaction dispatch and comment stale sweep before post stale sweep. A comment exception skips existing work. Isolate steps and retain existing-work progress when comments fail.                                                                                                                                                                                               |
| O-M9a   | medium  | patch  | Review/block tests accept either state for both samples. Pin exact engine disposition and matching intake/audit, and exercise withheld status in a rendered browser journey.                                                                                                                                                                                                                                                      |
| O-M9b   | medium  | patch  | Pact lacks negative envelopes and paginated requests. Same negative-contract root as B10, with additional disabled and pagination cases. Extend existing utility-based interactions and provider states.                                                                                                                                                                                                                          |
| O-M9c   | medium  | patch  | Report and consent have real HTTP/DB tests but no browser/device path. Add an end-user report journey and consent suppression refresh/recovery with real worker/API boundaries.                                                                                                                                                                                                                                                   |
| O-M9d   | medium  | patch  | Mobile tests replace announcement/focus APIs without assertions, and omit screen-level close/reset/404 ownership. Assert observable focus/announcements and screen ownership during the corresponding fixes.                                                                                                                                                                                                                      |
| O-M9e   | medium  | patch  | The private-paging refresh assertion can pass against pre-refresh text before the request lands. Wait for a controlled response boundary and assert retained second-page content after reconciliation.                                                                                                                                                                                                                            |
| O-M10   | medium  | patch  | The comments suite still passes an unbound Nest server to supertest, whose implicit dual-stack port may collide with a live IPv4 fixture on macOS. Bind once to 127.0.0.1:0 using a shared helper; migrate the observed HTTP fixtures so one suite cannot answer another.                                                                                                                                                         |
| O-LB1   | low     | reject | Publication ineligibility uses consent_suspended for hidden post/deleted root too. Public placeholders intentionally hide cause; private copy is generic recovery. A distinct status adds schema/contract branches for rare cause detail with negligible everyday harm.                                                                                                                                                           |
| O-LB2   | low     | reject | Technical failure intake uses inappropriate_content as the report reason, but audit.action=screening_failed and reason=screening_unavailable already distinguish the actual outcome for the future operator query. A new reason expands shared contracts for negligible current harm.                                                                                                                                             |
| O-LB3   | low     | reject | Payload receipts retain a SHA-256 after author deletion, allowing a database reader to test candidate text. Erasure already deletes receipts and the hash is never exposed publicly. HMAC introduces secret lifetime/rotation coupling for an unlikely privileged confirmation scenario.                                                                                                                                          |
| O-LB4   | low     | reject | Deleting a report with audit would attempt SET NULL and is rejected by the append-only trigger. Reports have no deletion path; audited retention is enforced. A regenerated schema migration to change the FK action adds work without changing reachable behavior.                                                                                                                                                               |
| O-LB5   | low     | patch  | The guardian extraction preserved behavior but dropped explanation for the age-before-compliance order. Restore a short affirmative rationale at the shared rule; do not duplicate policy.                                                                                                                                                                                                                                        |
| O-LB6   | low     | reject | Shared post reads serialize against writes as required for coherent visibility snapshots; batched read locks already allow readers together. Alternative lock protocols add complexity for an unmeasured hot-post issue, and active-only polling reduces load.                                                                                                                                                                    |
| O-LW1   | medium  | patch  | The visible-text refinement excludes whitespace/Cf but allows Default_Ignorable fillers and braille blank as sole body. These yield blank-looking published comments. Extend the existing JS and DB visible-text tests consistently, preserving ordinary international/emoji text.                                                                                                                                                |
| O-LW2a  | medium  | patch  | A pre-create private poll wipes a confirmed create, matching B3. Keep a separate row before grouping.                                                                                                                                                                                                                                                                                                                             |
| O-LW2b  | medium  | patch  | submit prepends a replayed published result even when publicIds already contains it, so one contribution renders twice. Apply the existing public-ID dedup rule to accepted create results.                                                                                                                                                                                                                                       |
| O-LW3   | false   | reject | There is no account-erasure UI/action producer in this application. The listener is an observation hook; session polling resets on sign-out and observed 401 resets state, while private/public refresh suppresses erased content. The cited absence alone does not demonstrate an erased account operation being observed and ignored.                                                                                           |
| O-LW4   | medium  | defer  | Pre-existing AccessibleModal app-shell lookup finds no matching lookbook ancestor, so background content remains interactive behind its portal. The source predates Story 6.4. User engineering instructions authorize fixing the observed accessibility defect during this delivery; record it as pre-existing and handle alongside focus verification.                                                                          |
| O-LW5a  | low     | reject | Delete is a single author action with an explicit tombstone result. A confirmation UI adds a new interaction and focus state for accidental-click prevention beyond the current requested flow; no defective deletion behavior is demonstrated.                                                                                                                                                                                   |
| O-LW5b  | low     | patch  | Close comments closes the entire look detail dialog, so its label understates the action. Reuse the existing localized dialog Close label; preserve the established dialog close/focus behavior.                                                                                                                                                                                                                                  |
| O-LW5c  | low     | reject | Replies accurately reports that its requested content is expanded; another click refreshes that content. Collapsing would add an interaction and request-ownership state with negligible everyday harm from the existing refresh behavior.                                                                                                                                                                                        |
| O-LW5d  | medium  | patch  | Repeated action labels provide no item context to assistive users. Give existing controls contextual accessible names while retaining visible translations and tests.                                                                                                                                                                                                                                                             |
| O-LW5e  | medium  | patch  | Web report failure closes the reason form, matching B8. Keep the chosen reason and report surface available for retry.                                                                                                                                                                                                                                                                                                            |
| O-LM1   | medium  | patch  | Native report failure closes the form and reason carries between targets. Same outcome as B8; reset default on a newly selected report target, preserve selection during failure retry.                                                                                                                                                                                                                                           |
| O-LM2   | medium  | patch  | Deep-link/highlight 404 calls unconditional setCommentsPostId(null) after the scoped evict callback, closing a sheet for another post. Remove the unconditional close and test active-post ownership.                                                                                                                                                                                                                             |
| O-LM3   | medium  | patch  | Highlighted and feed copies share a post-keyed ref map and overwrite each other; unmount can clear the actual invoking control. Capture the actual Comments trigger instance when opening and restore that node on close.                                                                                                                                                                                                         |
| O-LM4   | medium  | patch  | The one-second session sync awaits token resolution without a catch. A storage rejection becomes an unhandled promise and repeats. Handle failure safely while keeping existing state/session ownership.                                                                                                                                                                                                                          |
| O-LM5a  | false   | reject | Selected report reasons already expose accessibilityRole=radio and accessibilityState.checked in the cited native JSX. The selection is conveyed beyond colour; preserve these semantics.                                                                                                                                                                                                                                         |
| O-LM5b  | medium  | patch  | Native Reply/Delete/Report labels repeat across entries without item context, matching the web action-naming gap. Add contextual accessible labels to existing controls.                                                                                                                                                                                                                                                          |
| O-LM5c  | medium  | patch  | Replying copy omits the selected root context, making the destination ambiguous after scrolling. Name the existing selected root in the accessible reply context on both surfaces.                                                                                                                                                                                                                                                |
| O-LM6   | medium  | patch  | Maestro selects Reply/Replies by shared text on seeded lookbook-5. Other roots can redirect the test. Scope actions to the submitted root via stable item/test identifiers.                                                                                                                                                                                                                                                       |
| O-LM7   | medium  | patch  | Fixture cleanup retains roots referenced by other members but leaves their body/user intact; later replica-mode user cleanup bypasses erasure triggers. Scrub retained owned roots before identity deletion, preserving other replies.                                                                                                                                                                                            |
| O-LM8   | medium  | patch  | Mobile pretest builds utils/client but new factory import resolves testing/dist. Cold standalone mobile tests fail before execution. Build the existing shared testing dependency in the prepare hook or resolve the factory from its established source convention.                                                                                                                                                              |
| P1      | medium  | patch  | Parent audit of the first review patch found confirmed create invalidated all public reads, leaving an initial roots request ignored and roots null until refresh. Limit the new acceptance fence to private polling; retain public-read ownership and add the explicit ordering regression.                                                                                                                                      |
| P2      | medium  | patch  | Parent audit found token-storage rejection was treated as resolved sign-out, clearing draft/sheet on a transient storage failure. Catch the rejection while retaining the last confirmed identity; clear on resolved null or changed identity, and assert both outcomes.                                                                                                                                                          |
| T1      | medium  | patch  | TEA traced comment response registration: it omits the required Retry-After header on create/report 429s and advertises 409/429 on read operations that cannot emit them. Correct operation-specific metadata and regenerate the tool-owned OpenAPI/SDK; Pact negatives verify the real envelopes.                                                                                                                                |
| P3      | medium  | patch  | Parent backend audit found worker exhaustion does not pass the job generation to markFailed. A held final old-generation attempt can reject after a freeze sweep rearms and rollout reopens, terminal-failing the new generation. Carry and transactionally compare expected generation before failure settlement; reproduce with a controlled final attempt and defer/reopen.                                                    |
| P4      | medium  | patch  | Parent audit found sweepStale repeatedly selects the oldest 100 frozen pending comments by immutable created_at. Their deferrals leave later eligible stale rows unexamined. Apply the existing outbox freshness predicate during candidate selection as well as locked settlement; prove progress past 100 frozen rows in a second bounded sweep.                                                                                |
| T2      | medium  | patch  | TEA executed three failing lifecycle cases: an armed watchSubmissions timer survives account switch, reset or eviction and sends a second request for the old post. Clear/recheck pending work before the callback sends; preserve the failing tests and verify stop/reset/eviction all cancel further polling.                                                                                                                   |
| T3      | medium  | patch  | TEA executed a red follow-on: the watch-level ticket captured by the T2 patch stays invalid after account switch, so a mounted web thread never polls the next account's new pending work. Derive timer ownership per scheduling cycle while rejecting old timer/completion work; retain cancellation and resume regressions together.                                                                                            |
| T4      | medium  | patch  | TEA reproduced on web and native: hold report A, open report B and select its reason, then accept A. A's callback closes B's newer form; web also targets A for focus. Close/restore only when the accepted request still owns the current report target, preserving B and A's receipt announcement.                                                                                                                              |
| P5      | medium  | patch  | Parent requested delayed deep-link success reproduction. TEA rendered test and parent full mobile gate prove the feed invoker unmounts when the same highlighted post appears; close focuses stale handle 501 instead of live same-post handle 502. Keep actual invocation when live and fall back to the current same-post Comments control after replacement.                                                                   |
| T5      | medium  | patch  | TEA separately confirmed the same delayed-success focus replacement with the detached feed node disconnected and exactly one live Comments control. This is grouped with P5 for the same source repair; the rendered regression remains unchanged.                                                                                                                                                                                |
| RV1     | low     | patch  | Worker stale-backlog fixtures derive Date.now although these cases test freeze/generation/fairness, not the exact cutoff. A fixed ancient backlog timestamp removes that setup clock dependency while real BullMQ scheduling remains live.                                                                                                                                                                                        |
| RV2     | low     | patch  | Recovery mixes deterministic stale cutoff and real database analytics scheduling. Pin Date only for the sweep phase, then restore live time before dispatch; keep the retry assertions.                                                                                                                                                                                                                                           |
| RV3     | medium  | patch  | Worker member/comment payloads duplicate existing factory shapes. Reuse shared builders so compliance defaults and accepted contract values evolve consistently.                                                                                                                                                                                                                                                                  |
| RV4     | medium  | patch  | Delivery repeats the worker member/comment seed shape. Share the builder and keep its isolated database lifecycle.                                                                                                                                                                                                                                                                                                                |
| RV5     | medium  | patch  | Web repeats report receipts and submissions envelopes. Reuse named local builders so report deadlines and envelope changes update every case.                                                                                                                                                                                                                                                                                     |
| RV6     | medium  | patch  | Client contract tests duplicate item/submission shapes already provided by sibling fixture helpers. Reuse those helpers without introducing a testing-to-client dependency cycle.                                                                                                                                                                                                                                                 |
| RV7     | medium  | patch  | State tests repeat private pages and deferred page types despite importing the existing builders/types. Apply those imports consistently.                                                                                                                                                                                                                                                                                         |
| RV8     | low     | patch  | Web rendered journey combines paging, composer cancellation and report cancellation/submission. Separate the independent subjects while preserving every assertion.                                                                                                                                                                                                                                                               |
| RV9     | low     | patch  | Native rendered journey combines the same independent subjects. Separate cases for clearer regression failures while preserving behavior coverage.                                                                                                                                                                                                                                                                                |
| RV10    | low     | patch  | HTTP page maximum plus one is an unnamed boundary. Name the accepted maximum locally and derive the refused request.                                                                                                                                                                                                                                                                                                              |
| RV11    | low     | patch  | HTTP report Retry-After3600 lacks a named derivation. Derive it from the existing hour/second constants and explain the accepted window.                                                                                                                                                                                                                                                                                          |
| RV12    | low     | patch  | Database Unicode parity uses unnamed140/141emoji boundaries. Name the local accepted UTF16 cap and derive the probes.                                                                                                                                                                                                                                                                                                             |
| RV13    | low     | patch  | Worker16minute fixture age is unnamed. Covered by the fixed stale-backlog timestamp in RV1; remove the redundant moving boundary.                                                                                                                                                                                                                                                                                                 |
| RV14    | low     | patch  | Worker fairness case encodes sweep batch100 in several places. Name the bounded batch and derive count/index expectations.                                                                                                                                                                                                                                                                                                        |
| RV15    | low     | patch  | Client schema emoji probes encode unnamed limits. Name and derive the local accepted UTF16 cap as in the parity suite.                                                                                                                                                                                                                                                                                                            |
| RV16    | low     | patch  | Browser focus-contrast assertion uses unnamed WCAG threshold3. Name it locally with the criterion reference after the active browser run.                                                                                                                                                                                                                                                                                         |
| RV17    | low     | patch  | HTTP status assertions mix supertest and Vitest styles. Use consistent Vitest response status assertions while keeping exact error bodies.                                                                                                                                                                                                                                                                                        |
| RV18    | low     | patch  | Web live-region text assertions mix raw textContent and semantic text matchers. Standardize exact text matching.                                                                                                                                                                                                                                                                                                                  |
| RV19    | low     | patch  | Native absence and disabled-state assertions mix DOM attribute access and semantic matchers. Use the existing semantic matcher style consistently.                                                                                                                                                                                                                                                                                |

Review provenance: the existing user-owned Claude Code session `couture-cast-cd` used `claude-opus-5-5`; its verified peer-origin reply arrived 2026-10-19T16:33:48.068Z. Full report: [archived Opus review](reviews/story-6-4-opus-implementation-review.md). Findings above are classified individually before grouping.

Groups: immutable rejected intent (B1/E2/O-H1); read/mutation ownership (B2/E1/O-M5); private poll ordering (B3/O-LW2a); suppression reconciliation (B4/E3); erasure/delivery serialization (B5/E4); rollout authority (B6/O-B1); report acceptance (B8/O-LW5e/O-LM1); report focus (B9/O-M3 report subset); negative contracts (B10/O-M9b). Other surviving rows retain separate root causes. All patch rows use existing state, endpoints, rollout authority or fixture mechanisms.

## Design Notes

Assign publication order under the post lock and capture a cursor watermark to prevent delayed screening from inserting behind traversed pages.
Keep owner-only submissions separate from public pagination.
Create moderation intake inside the report transaction for queue-outage resilience.
Apply the supporting design loaded through `context` for lifecycle, privacy, rates, and verification details.

## Verification

### Executed local evidence as of 2026-10-19

- Complete `npm run typecheck` passed, including workspace, Playwright, Pact and k6 boundaries. Log: `/tmp/story64-typecheck-final.log`.
- Full `npm run validate` exited 0: typecheck, lint/format, coverage and production builds. Log: `/tmp/story64-validate.log`. API 3331 passed/11 skipped, native 881 passed, web 786 passed, client 864 passed, config 23 passed, database 223 passed/1 skipped, testing 97 passed and utils 188 passed. Original coverage thresholds are unchanged.
- The first full validation failure is preserved at `/tmp/story64-validate-coverage-blockers.log`. Added meaningful rendered root/reply/private paging and report reason/cancel/send journeys to clear the web/native function ratchets. Migration hygiene uses a freshly migrated disposable UUID-named database; shared developer databases were preserved.
- Final API comment integration: 36 passed, 1 optional workload measurement skipped. Includes real guarded HTTP consent/read/report/delete, lone surrogate 400/emoji success, shared report Retry-After, durable analytics identity through secret rotation, real PostgreSQL/Redis worker, publication locks, Unicode parity, erasure and analytics recovery. Log: `/tmp/story64-comments-integration-final.log`.
- Complete API suite passed twice after binding the RevenueCat HTTP fixture once for its suite lifetime. Original wrong-responder failures remain in `/tmp/story64-revenuecat-broad-failure.txt`, `/tmp/story64-verify-changed-revenuecat-cancellation.log` and `/tmp/story64-revenuecat-repro.log`; passing logs `/tmp/story64-api-full-bound-server.log` and `/tmp/story64-api-full-bound-server-repeat.log`. Final validation also passed the complete API suite.
- Database RLS community suite: 11 passed, including direct anon/authenticated denial on every comment table. API-client coverage: 864 passed; 99.86% statements, 98.47% branches, 100% functions, 99.86% lines.
- Rendered MSW comment journeys: web 8 passed and native 4 passed; deep-link draft recovery passed. Stale replies, old 404 ordering, unavailable-own deletion, unresolved retry identity, cancellation, NFC/IME counters, report selection/cancellation and pagination are covered.
- Final Pact command exited 0, including generation, Optic lint, three deterministic consumer runs (123 mobile and 132 web interactions), and complete provider verification. Log: `/tmp/story64-pact-final.log`.
- Fresh browser real-worker journey: 2 passed after modal viewport containment and dark-scheme text contrast fixes. Light/dark axe scans and desktop/narrow heading, Close and Send viewport assertions passed. Log: `/tmp/story64-browser-final.log`; screenshots in `playwright/artifacts/community-comments-Story-6-85070-covery-in-the-detail-dialog-chromium/`: `comments-tombstone-replies.png`, `comments-dark-viewport.png`, `comments-mobile-viewport.png`.
- Pixel inspection reproduced transformed-ancestor clipping and dark text contrast 1.06:1. AccessibleModal now portals outside the transformed/inert page, retains SSR/focus restoration, and pairs the look detail panel with theme card foreground/background. Evidence: `/tmp/story64-modal-viewport-repro.log`, `/tmp/story64-browser-dark-repro.log`, `/tmp/story64-browser-dark-repro.png`. Latest complete web coverage after these changes: 789 passed, with focused lint/types green. Log: `/tmp/story64-web-modal-final-coverage.log`. Actual dark-scheme Tab reproduction measured keyboard outline contrast 1.08884:1. Theme panels now use the existing light-surface focus token. Reproduction: `/tmp/story64-browser-focus-repro.log` and PNG. Final real browser keyboard rerun passed with 17.34:1 outline contrast; final web production build passed. Logs: `/tmp/story64-browser-final.log`, `/tmp/story64-web-build-final.log`, `/tmp/story64-modal-typecheck.log`, `/tmp/story64-modal-focused-lint.log`.
- iOS complete Maestro flow passed on iPhone 17/iOS 26.1. Verified draft reopen, private screening, published root/reply, primary Send above the software keyboard and independent readable controls. Log `/tmp/story64-maestro-ios.log`; JUnit `/tmp/story64-maestro-ios-report.xml`. Inspected screenshots: `maestro/artifacts/2026-10-19_110617/Screened community comments/takeScreenshot/maestro/artifacts/community-comments-reply-keyboard.png` and `community-comments-discussion.png`.
- Android complete Maestro flow passed on Pixel 9 Pro XL, including draft reopen, publication, reply submission with Gboard open, and root/reply traversal. Log `/tmp/story64-maestro-android.log`; JUnit `/tmp/story64-maestro-android-report.xml`. Inspected screenshots: `maestro/artifacts/2026-10-19_111332/Screened community comments/takeScreenshot/maestro/artifacts/community-comments-reply-keyboard.png` and `community-comments-discussion.png`. Native and browser harnesses ran sequentially from fresh bootstraps.
- Mixed workload measurement passed using the real pinned TensorFlow model, real Redis and PostgreSQL: one image then ten comments on concurrency 1; image 75ms processing, comments 8-15ms processing and 104-182ms end-to-end. Pending comment jobs used 312 Redis bytes each with 56-byte identifier-only payloads. Process peak RSS was 702.83 MiB including Vitest/model; CPU was 201.67ms user and 12.99ms system. No extra worker processes or queue connections were introduced. This developer-machine sample does not certify the 512 MiB hosted container envelope. Evidence: `apps/api/.cache/community-screening/comments-mixed-workload.json`.
- `verify:changed` exited 0 before final focused audit fixes. Log `/tmp/story64-verify-changed.log`. Full validation and the scoped checks above cover later source changes.
- Production community flags remain disabled. Previous screening readiness signature predates these inputs and does not certify this change.

### Reusable local verification commands

The current disposable database environment is in `/tmp/story64-review-verification-env.json` (mode 0600; only DATABASE_URL, RLS_TEST_DATABASE_URL and INTEGRATION_TEST_DATABASE_URL). `/tmp/story64-run-review-gate.cjs` applies that freshly migrated environment without printing it. Commands run from the repository root, sequentially:

```sh
node /tmp/story64-run-review-gate.cjs npm run validate
npm run test:pact
npm run test:pw-local -- playwright/tests/community-comments.spec.ts
env MOBILE_E2E_PLATFORM=ios MOBILE_E2E_EXPO_NO_OPEN=1 node scripts/run-maestro.mjs maestro/community-comments.yaml --artifacts
env PATH="/Users/murat/Library/Android/sdk/platform-tools:/Users/murat/Library/Android/sdk/emulator:$PATH" MOBILE_E2E_PLATFORM=android MOBILE_E2E_EXPO_NO_OPEN=1 node scripts/run-maestro.mjs maestro/community-comments.yaml --artifacts
```

### Delivery owned by the parent build workflow

Complete own review, Claude Code Opus 5.5 peer review, then separate `bmad-tea` peer testing review/enhancements. Open concise PR, address CodeRabbit, and finish with green CI.

### Review repair verification, 2026-10-19

The initial full-gate and device evidence above predates peer-review repairs. Source remains
in progress for parent verification and delivery. Only focused checks were run for this batch.

- Rendered MSW red evidence: `/tmp/story64-review-rendered-red.log` (three failures),
  `/tmp/story64-review-state-red.log` (six deferred-state failures),
  `/tmp/story64-review-inert-red.log` and `/tmp/story64-review-screen-red.log`.
  Before TEA enhancements, the repaired state suite passed 53 tests; rendered web comments/modal
  passed 35 tests; native sheet/screen passed 79 tests. Logs:
  `/tmp/story64-review-state-green.log`, `/tmp/story64-review-rendered-green.log`,
  `/tmp/story64-review-native-green.log`. TEA owns subsequent test enhancements and final counts.
- TEA lifecycle regressions were reproduced and fixed in source. Armed polls cancel on account
  change/reset/eviction, and the same watch resumes for current-session pending work.
  Combined targeted run: five passed. Logs `/tmp/story64-review-poll-lifecycle-red.log` and
  `/tmp/story64-review-poll-lifecycle-session-green.log`.
- Real PostgreSQL erasure-before-delivery reproduction captured a leased erased event:
  `/tmp/story64-review-analytics-erasure-red.log`. Live subject/lease ownership repair passed
  both race orderings and real acknowledged fail/retry telemetry: three passed,
  `/tmp/story64-review-analytics-green.log`. Persisted event properties are snake_case,
  content-free and deduplicated; a delivered receipt requires sink acknowledgement.
- Main comments integration: 36 passed, one resource-measurement skip. Real Redis worker:
  four passed, covering frozen work beyond retries/stale age, once-only unfreeze publication,
  real engine exhaustion with one intake/audit, generation rearm ownership, and bounded stale
  backlog progress. Logs `/tmp/story64-review-comments-api.log` and
  `/tmp/story64-review-worker.log`. These files are released to TEA for test enhancements.
- Actual pinned text engine corpus, unchanged policy: `Beautiful layers.` passes; `damn` and
  `fuck` route to review; `kill yourself` blocks. `/tmp/story64-review-corpus.log`.
- Shared IPv4 lifetime listener fixture is used by all integration HTTP request suites.
  Focused edited suites: ten files, 65 passed/two existing skips, then five files, 81 passed.
  Logs `/tmp/story64-review-http-fixtures.log`, `/tmp/story64-review-http-remaining.log`.
  Guard/status/body assertions remain strict.
- Safe outbox warnings and returned runtime sweep wiring: 12 passed,
  `/tmp/story64-review-sweep-logging.log`. Telemetry/runtime/PostHog focused checks previously
  passed 96 tests: `/tmp/story64-review-runtime-telemetry.log`.
- Cleanup reproduction and repair: `/tmp/story64-review-cleanup-red.log`,
  `/tmp/story64-review-cleanup-green.log` (two passed). Retained synthetic roots lose body,
  author and screening attribution; other members' replies remain. Cold standalone mobile
  preparation builds all shared dependencies in an owned temporary copy without removing
  local outputs: `/tmp/story64-review-cold-mobile.log`.
- Focused comment Pact consumers: 38 interactions passed, including deterministic refusals and
  scoped public/reply/private pagination for both consumers. Provider verified both generated
  comment pacts. Logs `/tmp/story64-review-pact-consumer.log`,
  `/tmp/story64-review-pact-provider-green.log`. Local pacts currently contain the focused
  interactions; parent full consumer verification regenerates complete consumer files.
- Fresh custom-invariant database: migrated and seeded without changing shared or prior owned
  databases. Env `/tmp/story64-review-verification-env.json` (0600) contains only database URLs;
  wrapper `/tmp/story64-run-review-gate.cjs` applies it without printing credentials.
  Provision log `/tmp/story64-review-fresh-db.log`. Focused DB schema/RLS: 39 passed, one
  storage-schema skip, `/tmp/story64-review-db.log`.
- Pact/client/testing typechecks and production/backend/Pact/cleanup/runner lint passed.
  API typecheck currently reports only an untyped fake in the released worker test;
  TEA owns that correction. Logs `/tmp/story64-review-{api,pact,client,testing}-types.log`,
  `/tmp/story64-review-final-lint.log`, `/tmp/story64-review-lint-corrections.log`.
- Maestro now selects Reply/Replies using stable IDs plus the submitted root's current visible
  text, and asserts real private status. Its post-review device run awaits the parent-granted
  sequential harness window. Browser/device evidence above remains the earlier baseline.

No commits or pushes were made. Parent owns complete validation, browser/native final sequencing,
peer acceptance, PR and CI. The frozen approved intent and all thresholds remain unchanged.

### Test architect backend enhancements, 2026-10-19

The separate Claude Code Opus 5.5 TEA peer returned its real backend execution window.
Ten comment integration files passed 85 tests, with one documented opt-in resource measurement
skipped. Community RLS passed 11 tests, and the five worker cases passed three additional runs.
The original large integration file was split into concern files sharing the isolated database
harness. Added exact quota boundaries, changed-payload replay conflicts and concurrent receipts,
consent/erasure paths, publication snapshots, locked freshness and actual producer dispatch cases.
The test architect's final review and complete parent gates remain pending.

T4 report ownership was reproduced red and repaired on both rendered surfaces. Both named tests
pass, along with source lint and web/native types. Logs `/tmp/story64-t4-{web,native}-{red,green}.log`
and `/tmp/story64-t4-{lint,web-types,native-types}.log`. Broader TEA reruns follow the source repair.

### Parent post-review verification, 2026-10-19

- Full workspace and boundary typechecks and all ESLint checks passed. The validation command then
  stopped on formatting in four TEA artifacts; the peer owns their final formatter pass.
  `/tmp/story64-postreview-validate.log`.
- Complete coverage passed API 3383/11 documented skips, web 802, client 933, config 23,
  database 223/one storage-schema skip, testing 97 and utils 188. The new delayed-success native
  focus regression failed in this run, then the same implementation agent repaired the source.
  `/tmp/story64-postreview-coverage-build.log`.
- Mobile full coverage after the focus repair passed 895 tests with original thresholds.
  `/tmp/story64-postreview-mobile-coverage.log`. The three focused close-focus cases passed,
  alongside source lint and mobile types. The original invoking node is used while live;
  replacing it with the same highlighted post restores focus to its current Comments control.
- Production package, API and web builds passed. `/tmp/story64-postreview-build.log`.
- Recovery tests after TEA's clock-domain correction passed all three cases.
  `/tmp/story64-postreview-recovery-final.log`. Date-only pinned stale checks remain deterministic;
  the analytics lease/backoff test uses the live clock shared with PostgreSQL.
- Maestro uses a unique 273-unit root and unique reply for each run, with anchored contextual
  selectors. Fresh device execution will exercise the long reply context with the keyboard open.

- Full post-review Pact passed: three deterministic complete consumer runs, valid OpenAPI and
  provider verification of both consumer files. `/tmp/story64-postreview-pact.log`.
- Real browser post-review suite passed all eight journeys in 46 seconds. This includes the real
  worker's private dispositions, immutable create retry, durable report/retry/focus and routing,
  guardian revocation with neutral suppression, root/reply tombstones, and light/dark/phone
  accessibility. `/tmp/story64-postreview-browser.log`. Parent visually inspected fresh
  `comments-light-viewport.png`, `comments-dark-viewport.png` and `comments-mobile-viewport.png`
  in the current Playwright artifact directory. Controls, text and primary action are visible.
- The separate TEA review identified additional test-maintenance corrections after its first
  final rescore. RV1-RV19 record each finding independently; the peer is applying test-only
  fixture/clock/assertion corrections and focused-case splits before its updated verdict.
