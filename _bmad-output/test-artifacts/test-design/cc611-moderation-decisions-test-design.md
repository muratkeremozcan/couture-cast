---
runScope: 'epic'
runKey: 'epic-6-story-6.11'
workflowStatus: 'complete'
totalSteps: 5
stepsCompleted:
  [
    'step-01-detect-mode',
    'step-02-load-context',
    'step-03-risk-and-testability',
    'step-04-coverage-plan',
    'step-05-generate-output',
  ]
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-11-04'
---

# Test Design: Epic 6, Story CC-6.11 Moderation decisions and account sanctions

**Date:** 2026-11-04
**Author:** Murat (TEA), non-interactive run, owner unavailable, decisions recorded in the spec
**Status:** Task 1 plan, built and executed. Fix round 1 confirmed at `5cbf216f`, results under Execution results and Fix round 1. Reconciled to the spec and its Spec Change Log entries TEA-01 to TEA-22.

**Precedence:** the spec at `_bmad-output/implementation-artifacts/spec-6-11-moderation-decisions-account-sanctions.md` wins wherever this document and the spec disagree.
The frozen block is byte-identical to the builder's draft.
Where this plan found a frozen sentence that needs tightening, the finding sits in the Spec Change Log with a default ruling and a message to the builder and coordinator.

Inputs read in full:

- Spec (frozen block, Boundaries, I/O matrix, Code Map, Tasks, Acceptance, Design Notes, Verification).
- `epics.md` CC-6.11 acceptance criteria E1 to E3, PRD lines 227, 228 and 257.
- Prior example `cc610-moderator-queue-test-design.md` and the Test Design (TEA) section of spec 6.10.
- Code at `6337dc8c`: `community-moderation.actions.ts`, `community-access.service.ts`, `community-privacy.ts`, `community-comments.{service,repository,processor,privacy}.ts`, `community.service.ts`, `community.repository.ts` `recordReport`, `community-moderation.{processor,outbox}.ts`, `community-send-guard.ts`, `community-spotlight.service.ts`, `community-spotlight-cache.ts`, `community-targets.service.ts`, `community-availability.ts`, `community-realtime.server.ts`, `share-card-source.repository.ts`, `guardian.service.ts` consent revocation, `moderation-queue.{service,repository}.ts`, `moderation-queue-tables.ts`, the cache-header middleware, `api-exception.filter.ts`, `schema.prisma` models, `20261020120000_community_realtime/migration.sql`, RLS harness and `moderation-queue.spec.ts`, `migration-hygiene.spec.ts`, `moderation-queue-seed.ts`, `apps/web/src/lib/community.ts`, `apps/mobile/src/lib/community.ts`.

Workflow decisions taken without a halt:

- Mode: Create. Level: epic-level, scoped to one story. The completed progress frontmatter above replaces a checkpoint file, and the output path follows the coordinator's brief and the 6.10 precedent.
- Level vocabulary: Unit, Integration (real Postgres, Nest app), DB (RLS and constraints), Contract (Pact and OpenAPI), Component (Vitest and Testing Library), E2E (Playwright), Manual.
- `tea_use_playwright_utils` and `tea_use_pactjs_utils` are true and both packages are installed.
  Playwright specs use `apiRequest`, `recurse` and the merged fixtures.
  Pact interactions use `createProviderState`, `setJsonContent` and `buildVerifierOptions`.
  A deviation from either library carries a stated reason in the test.
- Nothing was executed. This is design only.

---

## Spec review: findings against the real code

Each finding says what the code shows, the disposition, and the test that guards it.
"Fixed" means a non-frozen spec section is edited now because the code settles the answer.
"Ruling" means a default decision is recorded in the Spec Change Log and the builder is told.
Intent-level rulings are marked **(intent)**.

| ID     | Finding                                                                                                                                                                                                                                                                                                                                            | Disposition                                                                                                                                                                                                                                                                                                                      | Guard                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| TEA-01 | D5 reads as case lock, idempotency, revision, then target locks. Report intake takes only the post row lock (`community.repository.ts:726-741`, `community-comments.repository.ts:469-470`) and never the case lock, so a report can commit after the revision check and before the stamp.                                                         | Ruling. Order is case lock, idempotency, case resolution, privacy guard, member lock, post row lock, revision check. The revision read supplies the report ids that get stamped.                                                                                                                                                 | I-C-REPORT-RACE, S-3                         |
| TEA-02 | D10 restores marked content on `overturned` with no eligibility check. `guardian.service.ts:820-853` hides a teen's content when consent lapses and states that no restore-on-consent path exists. A guardian revocation during a ban followed by an overturn would republish a minor's content without consent.                                   | Ruling **(intent)**. The ban always ends. Restoration runs only when `assertCommunityDatabaseAccess` passes under the subject guard. Otherwise markers stay and nothing is republished.                                                                                                                                          | I-A-OVERTURN-CONSENT, S-10                   |
| TEA-03 | 6.10 residual RG4 assigned reason constraints to 6.11 and D1 sets none. A takedown reason of `unsafe_class` parses as a machine finding (`moderation-queue.repository.ts:116-124`), adds a risk step and reaches the author through D14. A reason beginning `community_ban:` looks like a ban marker.                                              | Ruling **(intent)**. The contract refuses a reason that parses under `communityModerationReasonCategories` or begins with `community_ban:`, as 400 `invalid_decision`.                                                                                                                                                           | U-D-REASON                                   |
| TEA-04 | D8 says the ban marker is not a finding. The queue reads every `blocked` and `held_for_review` comment as a finding (`moderation-queue.repository.ts:168`, `moderation-queue.service.ts:334`), so a ban-hidden comment and an operator takedown both read as a machine verdict and gain a risk step.                                               | Ruling. Comment takedown writes the closed value `operator_takedown` to `screening_reason`. Both finding predicates, SQL and TypeScript, exclude it and `community_ban:%`. The D11 "queue SQL unchanged" sentence covers the queue source arms, and this predicate edit is outside it.                                           | I-S-FINDING-PARITY                           |
| TEA-05 | D8 says "held" and "hidden" and names no status. The code settles it: `flagged` leaves the feed with no erasure clock, `withdrawn` starts one, and `consent_suspended` means consent. `blocked` and `held_for_review` are outside `publicStates`; both keep the body.                                                                              | Fixed. Published post and pending post become `flagged`. Published comment becomes `blocked`. Pending comment becomes `held_for_review`. `published_at` and `publication_sequence` stay, which is what the D10 restore needs.                                                                                                    | I-B-CONTENT-TEMP, I-B-CONTENT-PERM           |
| TEA-06 | D10 requires a `mutationId` and D6 stores idempotency on `ModerationDecision`, whose action list is the five decisions. `CommunitySanction` has no column list.                                                                                                                                                                                    | Ruling. An appeal step writes a `ModerationDecision` row with `action` in `appeal_requested`, `appeal_upheld`, `appeal_overturned`, `is_terminal=false`, on the originating `case_key`. Sanction columns: `id`, `user_id`, `decision_id` (unique), `case_key`, `kind`, `expires_at`, `lifted_at`, `appeal_status`, `created_at`. | I-A-HAPPY, I-A-IDEMPOTENT, I-A-FIRST-UNMOVED |
| TEA-07 | D2 applies `self_review_refused` "for every action" in case terms. The appeal route has a sanction and no case, so a reporter could rule on the ban their report caused.                                                                                                                                                                           | Ruling **(intent)**. The conflict set on the appeal route is the sanction's subject plus the author and every reporter of the originating case.                                                                                                                                                                                  | I-A-SELF                                     |
| TEA-08 | The spec names every refusal and fixes no order among them after the input check, so the same request could answer differently across code paths.                                                                                                                                                                                                  | Ruling. Order: replay or mismatch, `case_not_found`, `operator_sanctioned`, `self_review_refused`, `admin_required`, `case_conflict`, `action_not_applicable`.                                                                                                                                                                   | U-D-SVC-PRECEDENCE                           |
| TEA-09 | The closed `detail` list includes `subject_banned` and no row in D4 produces it. `target_erased` has no definition for a flagged post with `erasure_requested_at` or an erased comment.                                                                                                                                                            | Fixed. Release with an active ban on the author gives `subject_banned`, other ineligibility gives `author_ineligible`. `target_erased` covers an orphan, `anonymized_at`, `erasure_requested_at` on release, comment status `erased`, and a null author.                                                                         | I-D-RELEASE-REFUSALS, I-B-ERASED             |
| TEA-10 | D4 `ban` requires a "live" target, and D8 keeps withdrawal and deletion open. If withdrawn means not live, an author escapes any ban by retracting first.                                                                                                                                                                                          | Ruling **(intent)**. `ban` needs a row with a known author. A `withdrawn` post or `author_deleted` comment still allows it, with no target effect. Comment erasure keeps its row (`community-comments.privacy.ts`), so it never re-keys: `ban` answers `target_erased` and `resolve` stays available.                            | I-B-ERASED                                   |
| TEA-11 | D4 lists three reasons for an empty `allowedActions` and D2 adds a fourth refusal, `operator_sanctioned`. A read failure on the decisions flag during a detail GET has no stated result.                                                                                                                                                           | Fixed. A sanctioned operator gets an empty list. A flag read failure on GET gives an empty list and leaves the read working. The POST still answers 503.                                                                                                                                                                         | U-D-ALLOWED-RULES, I-D-ALLOWED-PARITY        |
| TEA-12 | "The same payload" is undefined, and D5 maps only `UNIQUE (case_key, sequence)` violations. Two concurrent retries can also collide on `UNIQUE (moderator_id, mutation_id)`.                                                                                                                                                                       | Ruling. `payload_hash` covers route, case id or sanction id, action, trimmed reason and ban. `expectedRevision` stays out, so a lost-response retry after a reload replays. A key violation re-reads in a new transaction and answers replay or mismatch.                                                                        | U-D-SVC-HASH, I-C-REPLAY-RACE                |
| TEA-13 | The stored response is written inside the transaction and `cacheInvalidation` is known only after commit. A crash after commit leaves the bump unrun, and a retry that "writes nothing" never runs it.                                                                                                                                             | Ruling. The stored response omits `cacheInvalidation`. Every 200, replay included, runs the bounded after-commit steps and reports its own outcome.                                                                                                                                                                              | U-D-SVC-POSTCOMMIT, I-K-REPLAY-RERUN         |
| TEA-14 | `report_ids` has no stated membership. A takedown on a fully resolved case would hold an empty array, and D4's escalated rule names no key, so a re-key could lose the first decision time or the escalation.                                                                                                                                      | Ruling. `report_ids` holds every report of the case at decision time, while stamps touch only open ones. `escalated`, like `firstDecisionAt`, reads by `case_key` or `report_ids` overlap.                                                                                                                                       | I-C-REKEY                                    |
| TEA-15 | D11 labels comment audit rows as screening by action name, and D13 writes "per affected report". A comment takedown that writes action `blocked` reads as the screener. A decision on a case with no open report writes no row at all.                                                                                                             | Ruling. Comment rows reuse the post names (`released_by_operator` and so on). The target action writes one row on the newest report of the case, and `report_resolved` writes one row per stamped report. Screening actions are `held_for_review`, `blocked`, `screening_failed`.                                                | I-D-PRIOR-ACTIONS, D-BACKFILL                |
| TEA-16 | The D11 backfill matches a `flagged` post with a `flagged` event and no report. A post flagged, released by script and then taken down matches too, and would read as a screening verdict. Screening post reports also have no `subject_alias`.                                                                                                    | Fixed. Backfill requires `flagged` to be the newest status-changing event. `flagPost` copies an existing alias row and never creates one, and the read falls back to the live alias (`moderation-queue.service.ts:288-291`).                                                                                                     | D-BACKFILL, I-S-IDENTITY                     |
| TEA-17 | Route sweep past D9's list. `POST posts/:id/opened` checks only the flag (`community.service.ts:954`), so a banned member records opens and learns which posts are visible. Notification preference routes reach `access.assert`, so they refuse a banned member. Outfit share cards reach the choke point (`share-card-source.repository.ts:59`). | Ruling **(intent)**. `opened` gains the check. Preferences stay refused: sends already stop. Both share-card sources are refused, because D8 lists export with no source limit. A route matrix built by reflection forces a decision for every future route.                                                                     | U-B-ROUTE-MATRIX, I-B-ROUTES, I-B-SHARE-CARD |
| TEA-18 | Comment delete, list and report share one `eligible` closure (`community-comments.service.ts:144-168`), so a sanction check placed there refuses retraction. `withThread` also requires a visible post, so delete on a hidden post answers 404 for any member. Delete nulls the body with no status filter.                                        | Fixed. The check sits in repository `create` and `report`. The 404 and the evidence limit are recorded as RG3 and RG4.                                                                                                                                                                                                           | I-B-RETRACT, S-8                             |
| TEA-19 | D8 says reactions are "withdrawn". The only existing pattern (`guardian.service.ts:838`) sets `selection: null` and bumps `revision`. A delete would break receipts and the reaction generation that spotlight compares.                                                                                                                           | Fixed. Withdrawal updates, as consent revocation does.                                                                                                                                                                                                                                                                           | I-B-CONTENT-PERM                             |
| TEA-20 | `pinClock` fakes JavaScript `Date` only, so an expiry predicate on SQL `now()` cannot be tested at its boundary.                                                                                                                                                                                                                                   | Fixed. Enforcement binds `new Date()` as a parameter. Active means `lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now)`.                                                                                                                                                                                             | U-B-ACTIVE, I-B-EXPIRY                       |
| TEA-21 | D12 names removals only. A released post waits for the snapshot to rebuild before spotlight shows it.                                                                                                                                                                                                                                              | Fixed. Release runs the same after-commit step for the post's areas. `resolve` and `escalate` skip the bump and report `completed`.                                                                                                                                                                                              | I-K-RELEASE                                  |
| TEA-22 | Both clients classify a 403 by message (`apps/web/src/lib/community.ts:201`, `apps/mobile/src/lib/community.ts:156`) and fall through to `unknown`. The spec already says classify by `code`, and the new message must stay distinct from the rollout copy.                                                                                        | Fixed. `code` is read first on both clients, and a test pins that `community_banned` beats the message rules.                                                                                                                                                                                                                    | U-WEB-D-CLIENT, U-MOB-D-DENIED               |

Informational, verified, no spec change:

- D12 inventory holds. No `public` or `s-maxage` response exists in the community module or web routes, and feed, comment and teaser reads hit the primary.
- `api-exception.filter.ts` only adds telemetry and delegates, so `code` and `sanction` survive to the wire. I-B-BODY still asserts it on the real stack.
- `community_prepare_subject_privacy` guards posts the member authored, reacted to or commented on, so hiding a comment on a third party's post passes `community_privacy_assert_comment`.
- A set change during the guard raises `40001`, which `communityPrivacyTransaction` retries.
- `dispatchOne` stamps `dispatched_at` after enqueue, and both processors return when the row left its pending state, so a held item costs one no-op job and publishes nothing.
- `recordCommunityEngagement` and `commentAnalytics` have no dedupe for a second publication, so the release form must record them only when `publication_sequence` was null.
- A flagged post reaches `withdraw` (`WITHDRAWABLE_STATUSES`), so an author can retract a taken-down post. D8 allows it, and the `ModerationEvent` snapshot keeps the evidence.
- `sharedCommunityReportRetryAfter` counts by reporter, and null-reporter screening rows hit no limit and no `UNIQUE (post_id, reporter_id)` collision.
- The queue already counts a null reporter once (`moderation-queue.repository.ts:221`), which matches the spec's design note.

---

## Executive Summary

**Scope:** two moderator write routes, `POST /api/v1/moderation/cases/:caseId/decisions` and `POST /api/v1/moderation/sanctions/:sanctionId/appeal`, behind `moderation_decisions_enabled`.
Five actions apply in one transaction with an append-only `ModerationDecision`, an attributed audit row, `CommunitySanction` enforcement at the community access boundary, screening intake for flagged posts, after-commit cache invalidation, a decision panel in the 6.10 console and a localized banned notice.

**Risk summary:**

- Total risks: 22
- High (score >= 6): 13, of which 3 score 9 (R-003 serialization, R-008 enforcement bypass, R-010 republish after consent lapse)
- Critical categories: SEC (authorization, identity, private reason text), DATA (atomicity, idempotency, first decision time, content restoration), BUS (ban reach in both directions, public visibility)

**Coverage summary:** 143 scenarios: P0 85, P1 49, P2 9. Totals by level are in the Test Catalog. 14 seeded-defect proofs (S-1 to S-14) sit outside the count.

**Effort:** roughly 90 to 150 hours (12 to 19 days) including the concurrency harness, the ban route matrix and the Playwright theme and width matrix.

---

## Not in Scope

| Item                                                           | Reasoning                 | Mitigation                                                               |
| -------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| SLA timers, alerts, escalation delivery                        | CC-6.12                   | I-D-ESCALATE pins that `escalate` changes no SLA value and sends nothing |
| Database append-only trigger, retention, anonymization, export | CC-6.13                   | U-D-SVC-INSERT-ONLY pins that no code updates or deletes a decision row  |
| Member self-service appeal                                     | Spec Never list           | C-WEB-D-BANNED-NOTICE pins the directive to support                      |
| Mobile moderator surface and mobile banned copy                | Spec Never list and D15   | U-MOB-D-DENIED pins the existing denied state                            |
| Ban-evasion detection, member or guardian email                | Spec Never list           | None                                                                     |
| Revoking another member's Supabase session                     | No API exists (D8)        | U-D-SVC-POSTCOMMIT pins the `invalidateUserSessions` call                |
| Production flag values                                         | Spec Never list           | U-D-FLAG pins default false and seed true                                |
| Real Supabase Auth OTP for a moderator                         | Needs a live auth project | U-D-CTRL-ROLES covers claim handling                                     |

---

## Risk Assessment

Score = probability (1 to 3) x impact (1 to 3). Each description opens with the source words.

### High-Priority Risks (Score >= 6)

| Risk ID | Category | Description                                                                                                                                                                                                                                                     | Probability | Impact | Score | Mitigation                                                                                                          | Tests                                                                                          |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| R-001   | SEC      | "The moderator id and role come from `auth` only" (D2). A body field, a query value, a missing `@Roles` or a bypass token in production lets a non-moderator act or forges attribution on a safety decision.                                                    | 2           | 3      | 6     | Strict union, guard pair identical to `ModerationController`, identity read in one place. Owner: builder.           | U-D-CONTRACT-STRICT, U-D-CTRL-ROLES, -IDENTITY, -NO-ORACLE, P-D-ROLES, S-1                     |
| R-002   | SEC      | "The author of the target or anyone who filed a report ... gets 403 `self_review_refused`" (D2). A moderator rules on their own content, or an admin overturns a ban their own report caused.                                                                   | 2           | 3      | 6     | One conflict function shared by detail, decision and appeal. Owner: builder.                                        | I-D-SELF-REVIEW, I-A-SELF, U-D-SVC-PRECEDENCE                                                  |
| R-003   | DATA     | "Exactly one applies and the other receives `case_conflict` with no partial effect" (AC). Report intake holds no case lock, so a revision check before the target locks stamps a report nobody reviewed. Lost updates give two decisions on one reading.        | 3           | 3      | 9     | TEA-01 order, `UNIQUE (case_key, sequence)` backstop, lock-gated race tests with no sleeps. Owner: builder and TEA. | I-C-CONFLICT, I-C-REPORT-RACE, I-C-WITHDRAW-RACE, I-C-DB-BACKSTOP, S-3                         |
| R-004   | DATA     | "The same id and payload returns the stored response with `replayed:true` and writes nothing" (D6). A retry double-applies, a retry after a move fails with 409 or 404, or a stored response leaks a reason.                                                    | 2           | 3      | 6     | Idempotency precedes revision and case lookup, canonical hash, key violation re-reads. Owner: builder.              | I-C-RETRY, I-C-RETRY-MOVED, I-C-KEY-REUSE, I-C-REPLAY-RACE, U-D-SVC-STORED-RESPONSE, S-4       |
| R-005   | DATA     | "`firstDecisionAt` ... cannot move" (D7), and "`resolved_at` is only ever stamped where it is null". A later decision or an `escalate` makes a late resolution look punctual, which CC-6.12 and the 24-hour SLA read directly.                                  | 2           | 3      | 6     | Derived minimum over terminal rows, null-only stamp, one clock read after the lock. Owner: builder.                 | I-C-FIRST-DECISION, I-C-FIRST-ESCALATE, I-C-RESOLVED-AT, I-C-REKEY, U-D-SVC-CLOCK, S-5         |
| R-006   | DATA     | "One decision is one transaction: target change, every report stamp, sanction, decision row, prior-action rows and audit row commit together or not at all" (Boundaries). A partial commit leaves a hidden post with no record, or a record with no effect.     | 2           | 3      | 6     | Fault injection at every insert, `audit_unavailable` mapping limited to the moderator FK. Owner: builder.           | I-D-ATOMIC, I-D-AUDIT-SHAPE, U-D-SVC-ERRORMAP, S-6                                             |
| R-007   | SEC      | "`reason` ... never enters a log, `AuditLog`, analytics or an error body" (D1), and "`buildAuthorStates` sends `post.moderation_reason` to the author today" (D14). Operator words or the ban marker reach the author, a log sink or the immutable audit table. | 2           | 3      | 6     | D14 projection, recursive forbidden-key scan, captured-log scan, audit `event_data` allowlist. Owner: builder.      | U-D-SVC-LOGGING, U-B-D14, I-D-AUDIT-SHAPE, I-B-BODY, U-D-RESPONSE-STRICT, S-7                  |
| R-008   | BUS      | "Enforcement ... is added directly where those paths are bypassed" (D9). The community layer has paths around the choke point, so a missed route lets a banned member keep engaging. PRD line 228 makes ban a named capability.                                 | 3           | 3      | 9     | Route matrix by reflection, real-stack matrix for both kinds, primary read with no cache. Owner: builder.           | U-B-ROUTE-MATRIX, I-B-ROUTES, I-B-REALTIME, I-B-SEND-GUARD, I-B-FLAG-OFF, P-D-BAN-JOURNEY, S-8 |
| R-009   | BUS      | "Rejected: a whole-account lock. It would cut a paying member off paid features and privacy rights" (D8). A check in the wrong place blocks wardrobe, billing, privacy or retraction, and `community_forget_subject` silently ends weather alerts.              | 2           | 3      | 6     | Negative matrix on non-community routes, token and consent checksums. Owner: builder.                               | I-B-NONCOMMUNITY, I-B-RETRACT, I-B-TEEN, S-9                                                   |
| R-010   | DATA     | "`overturned` sets `lifted_at`, ends the ban immediately and restores content" (D10), with no eligibility check. A minor's content returns after a guardian revoked consent. Forged or stale markers restore the wrong content.                                 | 3           | 3      | 9     | TEA-02 eligibility gate, exact marker match, erasure exclusion. Owner: builder. P0 by compliance consequence.       | I-A-OVERTURN, I-A-OVERTURN-CONSENT, S-10                                                       |
| R-011   | TECH     | "Unpublished `pending_review` posts and `pending_screening` comments are held with a ban marker" (D8). A wrong status, an unmarked row or a race with a processor publishes during a ban or loses a body.                                                       | 2           | 3      | 6     | TEA-05 status table, processor run after hold, member lock ordering. Owner: builder.                                | I-B-CONTENT-TEMP, I-B-CONTENT-PERM, I-B-PENDING, D-CONSTRAINTS                                 |
| R-012   | BUS      | "Invalidate public caches immediately" (E2). A taken-down post stays in spotlight or the teaser with no worker running, or a Redis outage fails a decision that already stands.                                                                                 | 2           | 3      | 6     | After-commit step, `visiblePosts` recheck, Redis failure as `deferred`. Owner: builder.                             | I-K-TAKEDOWN-READS, I-K-BAN-EPOCH, I-K-REDIS-DOWN, P-D-TAKEDOWN-PUBLIC, S-11                   |
| R-013   | TECH     | "`hasFinding`" treats any held or blocked comment as a machine verdict, and D8 says the marker "is not a finding". Operator actions distort queue risk order and the reader's account of what the screener decided.                                             | 3           | 2      | 6     | TEA-03 and TEA-04, parity test over the new values. Owner: builder.                                                 | I-S-FINDING-PARITY, U-D-REASON, S-12                                                           |

### Medium-Priority Risks (Score 3 to 4)

| Risk ID | Category | Description                                                                                                                                                                                        | Probability | Impact | Score | Mitigation                                                       | Tests                                                 |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| R-014   | TECH     | "A publication sequence kept or newly allocated" (D4). A release skips the post sequence counter, a second release fires engagement again, or a reply returns under a hidden root.                 | 2           | 2      | 4     | Counter use as in the processor, engagement on first publication | I-D-RELEASE-COMMENT, I-B-REPLIES                      |
| R-015   | DATA     | "The migration backfills `screening` ... and inserts a screening report for each `flagged` post" (D11). A null reporter is ambiguous with an erased reporter, and the backlog is due in the past.  | 2           | 2      | 4     | Discriminate by audit action, newest-event rule                  | D-BACKFILL, I-S-INTAKE                                |
| R-016   | TECH     | "The same function the decision path enforces" (D4). The panel offers an action the route refuses, or hides one it allows.                                                                         | 2           | 2      | 4     | Matrix parity across real states                                 | U-D-ALLOWED-RULES, I-D-ALLOWED-PARITY, S-13           |
| R-017   | TECH     | "A case whose target was erased re-keys" (D5). A re-key loses the first decision, the escalated marker or prior actions, or a retry fails.                                                         | 2           | 2      | 4     | Overlap reads, retry after re-key                                | I-C-REKEY, I-C-RETRY-MOVED                            |
| R-018   | TECH     | "Controller, OpenAPI, generated SDK and web client derive from" the schemas (Boundaries). Registration order renames generated models, as the 6.10 note warned.                                    | 2           | 2      | 4     | Removed-model diff, regeneration check, Pact matchers            | C-D-OPENAPI, C-D-PACT, U-D-ENUM-COVERAGE              |
| R-019   | A11Y     | "Polite announcement of the localized outcome, then one detail reload" (D15). A double announcement, a lost reason on conflict, focus lost after reload, or a target under 44 pixels.              | 2           | 2      | 4     | Component assertions plus axe with 2.2 tags on all states        | C-WEB-D-ANNOUNCE, C-WEB-D-A11Y, P-D-AXE, P-D-KEYBOARD |
| R-020   | OPS      | "It changes fewer than 100 files ... every PR job stays under 20 minutes" (AC). Twelve API test files, ten locales and regenerated clients eat the headroom.                                       | 2           | 2      | 4     | File plan below, split rule at 90 files                          | V-D-BUDGET                                            |
| R-021   | PERF     | "`community_prepare_subject_privacy`" takes one advisory lock per related post inside a 7-second transaction (`community-privacy.ts:58`). A heavy reactor's ban times out or exhausts lock memory. | 2           | 2      | 4     | Scale test at 2,000 related posts, budget recorded               | I-B-SCALE                                             |

### Low-Priority Risks (Score 1 to 2)

| Risk ID | Category | Description                                                                                                                                                     | Probability | Impact | Score | Mitigation                            | Tests                              |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | ------------------------------------- | ---------------------------------- |
| R-022   | BUS      | "A localized label for every action, outcome, error, detail code, sanction kind and appeal status" (Boundaries). A raw enum value or English-only string shows. | 2           | 1      | 2     | Parity spec with enum-derived key set | U-WEB-D-LOCALES, U-D-ENUM-COVERAGE |

### Risk Category Legend

SEC security and privacy. DATA integrity and audit. TECH correctness. BUS business promise. PERF query cost. A11Y accessibility. OPS delivery and CI.

---

## NFR Planning

| NFR           | Target                                                                                                                                      | Evidence                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Security      | Zero writes from non-moderators; no moderator identity accepted from a request; zero forbidden keys in a body                               | U-D-CTRL-\*, U-D-CONTRACT-STRICT, U-D-RESPONSE-STRICT, P-D-ROLES, D-RLS-DENIED |
| Privacy       | Reason absent from logs, `AuditLog`, analytics, errors and stored responses; marker absent from every body                                  | U-D-SVC-LOGGING, U-D-SVC-STORED-RESPONSE, U-B-D14, I-D-AUDIT-SHAPE             |
| Integrity     | Exactly one decision per serialized read; full rollback on any insert failure                                                               | I-C-CONFLICT, I-D-ATOMIC                                                       |
| Freshness     | Next spotlight, teaser, feed and comment read reflects a decision with no worker running                                                    | I-K-TAKEDOWN-READS, I-K-BAN-EPOCH                                              |
| Enforcement   | Next community request refused after commit; live socket receives `denied` within 8 seconds (existing D1 bound)                             | I-B-ROUTES, I-B-REALTIME                                                       |
| Performance   | UNKNOWN threshold for a ban on a heavy member. The only hard bound is the 7-second transaction timeout. I-B-SCALE records a measured budget | I-B-SCALE                                                                      |
| Accessibility | axe 2.2 AA clean on every panel state, light and dark, 375 and 1280                                                                         | P-D-AXE                                                                        |
| Localization  | Ten catalogs, enum-derived key parity                                                                                                       | U-WEB-D-LOCALES                                                                |
| CI time       | Each PR job under 20 minutes; Playwright file under 6 minutes                                                                               | Lane budgets below                                                             |

---

## Entry Criteria

- The contract file `moderation-decisions.ts` exists with schemas, so tests are written against it and watched fail.
- The seed helper `seedDecisionCases` exists (see Test data), with unique ids per run.
- No peer is mid-commit. Tests run with `npm exec -- vitest run` and `npm exec -- tsc --noEmit -p`, never `npm run`, while other peers are active.

## Exit Criteria

- Every P0 and P1 test passes. P2 failures are triaged in the PR.
- Every seeded-defect proof S-1 to S-14 went red in a throwaway worktree and is recorded with its commit in `_bmad-output/test-artifacts/story-6-11/`.
- Verification commands in the spec pass; `git diff --name-only main... | wc -l` is below 100.
- No flake in three consecutive CI runs of the new specs.
- Screenshots for the Manual checks exist under `_bmad-output/test-artifacts/story-6-11/`.

---

## Test Catalog

Columns: **AC** maps to the epics criteria E1 (actions through canonical contracts, reason, identity), E2 (serialization, idempotency, cache invalidation, first decision time), E3 (ban effects, localized outcomes, attributed audit) and the spec bullets:

- S1 five actions, session identity, one audit row and one decision row.
- S2 unauthorized and direct database callers, identical 403, flag hidden.
- S3 conflicting reviews.
- S4 idempotent retry.
- S5 first decision time and `resolved_at`.
- S6 public caches with no worker, Redis outage.
- S7 ban effects on every route, non-community routes untouched.
- S8 localized outcomes.
- S9 rendered states and accessibility.
- S10 PR budget.

**Red** is `R` for red-first (written before the implementation and watched fail for the right reason), `G` for a green guard (passes before the build and protects against regression), `M` for manual.

### Contract package units (`packages/api-client/testing/moderation-decisions-contract.spec.ts`)

`U-D-REVISION` runs in the API unit spec for `moderation-decision-rules.ts`, because the contract ships in browser bundles and cannot import `node:crypto`.

| ID                  | Level | Pri | AC     | Red | Scenario                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----- | --- | ------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-D-CONTRACT-STRICT | Unit  | P0  | E1, S1 | R   | Each arm rejects `moderatorId`, `userId`, `role` and any unknown key; `durationDays` 1, 7, 30, 90 pass; 0, 2, -1, 365, 7.5, "7" fail; `permanent` with `durationDays` fails; a non-ban arm with `ban` fails; a non-UUID `mutationId` and a missing `expectedRevision` fail                               |
| U-D-REASON          | Unit  | P0  | E1, S1 | R   | Trim before length: 2 fail, 3 pass, 1000 pass, 1001 fail; whitespace only fails; `unsafe_class`, `unsafe_class, low_confidence` and `community_ban:x` fail (TEA-03); markup, emoji and very long unbroken text within the limit pass unchanged; the failure carries `invalid_decision` and no input echo |
| U-D-REVISION        | Unit  | P0  | E2, S3 | R   | The golden example from Design Notes; report order does not change the value; sequence, each report id and target status each change it; 16 lowercase hex                                                                                                                                                |
| U-D-ALLOWED-RULES   | Unit  | P0  | E1, S1 | R   | `deriveAllowedActions` table: role x each target state x open reports x escalated x conflict x operator sanctioned x flags x subject ban. Pins `banKinds` (moderator temporary only, active temporary allows permanent to admin) and the empty-list cases (TEA-11)                                       |
| U-D-RESPONSE-STRICT | Unit  | P0  | S1, S2 | R   | Strict response, detail additions and `community_banned` body; recursive scan of a maximal fixture for `moderatorId`, `subjectUserId`, `reason` (outside prior actions), `userId`, `email`, `community_ban:`, `caseKey`, `objectPath`, signed URL                                                        |
| U-D-ERRORS-CLOSED   | Unit  | P1  | E1, S1 | R   | Every code and `detail` is in the closed arrays; the OpenAPI enums equal them; `community_banned.sanction` holds exactly `kind`, `expiresAt`, `appealStatus`                                                                                                                                             |
| U-D-ENUM-COVERAGE   | Unit  | P1  | E3, S8 | R   | Exported action, outcome, error, detail, sanction kind and appeal status arrays drive the locale key set                                                                                                                                                                                                 |

### API units (`apps/api/src/modules/moderation/moderation-decisions*.spec.ts`, `moderation-sanctions.service.spec.ts`, `community-access.service.spec.ts`)

| ID                      | Level | Pri | AC     | Red | Scenario                                                                                                                                                                                                                                                                                             |
| ----------------------- | ----- | --- | ------ | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-D-CTRL-ROLES          | Unit  | P0  | E1, S2 | R   | Both routes: guardian, teen, consent-suspended teen, anonymous, malformed bearer, unknown role, `user_metadata.role=moderator`; moderator and admin pass; with `TEST_ENV` unset and `VERCEL_ENV=production` every bypass token gives 401; the role set equals the 6.10 read and write controllers    |
| U-D-CTRL-ORDER          | Unit  | P0  | E1, S2 | R   | Bearer, role, flags, input. Guardian with a flag off and an invalid body gets 403; moderator with a flag off and an invalid body gets 503; a thrown flag read gives 503 `moderation_decisions_disabled`; console flag off gives `moderation_console_disabled`                                        |
| U-D-CTRL-NO-ORACLE      | Unit  | P0  | S2     | R   | 403 body byte-identical for real, unknown and malformed case and sanction ids                                                                                                                                                                                                                        |
| U-D-CTRL-IDENTITY       | Unit  | P0  | E1, S1 | R   | The service receives only `auth.userId` and `auth.role`; `x-user-id`, `?moderatorId=` and a forged body change nothing and the forged body is 400 (S-1)                                                                                                                                              |
| U-D-CTRL-HEADERS        | Unit  | P0  | S2     | R   | `Cache-Control: private, no-store` on 200, 400, 401, 403, 404, 409 and 503 for both routes; the middleware route list holds `moderation/sanctions`; `POST /actions` headers unchanged                                                                                                                |
| U-D-CTRL-VALIDATION     | Unit  | P1  | E1, S1 | R   | 400 `invalid_decision` for a body and an appeal step outside the closed set, with no input echo                                                                                                                                                                                                      |
| U-D-CTRL-ACTIONS-KEPT   | Unit  | P1  | E1     | G   | `POST /actions` keeps its contract and analytics event; `GET /cases/:id` keeps one audit row per read; other verbs on `/cases/:id` stay 404                                                                                                                                                          |
| U-D-CTRL-MALFORMED      | Unit  | P2  | S2     | R   | Malformed JSON answers the generic parser 400 and an oversized body 413, for every caller, with no case or flag information                                                                                                                                                                          |
| U-D-FLAG                | Unit  | P1  | S2     | R   | `moderation_decisions_enabled` in registry order, default false, seed true; fallback returns false when PostHog fails (`flags.spec.ts`, `feature-flags.service.spec.ts`, seed spec)                                                                                                                  |
| U-D-MODULE-WIRING       | Unit  | P1  | E1     | R   | `ModerationModule` compiles with the exported `CommunitySpotlightService`, `CommunityStreamRepository` and `UserSessionService`; `CommunityModule` has no new cycle                                                                                                                                  |
| U-D-SVC-PRECEDENCE      | Unit  | P0  | E1, S1 | R   | The TEA-08 order over a table of states that trigger two refusals at once, including replay ahead of every refusal and moderator `permanent` on an unavailable case giving `admin_required`                                                                                                          |
| U-D-SVC-HASH            | Unit  | P0  | E2, S4 | R   | Canonical hash: reason whitespace and key order do not change it; `expectedRevision` does not; action, reason, ban, case id and route each do (TEA-12)                                                                                                                                               |
| U-D-SVC-CLOCK           | Unit  | P0  | E2, S5 | R   | One clock read after the case lock supplies `decided_at`, `expires_at`, every `resolved_at`, every event `created_at`; `durationDays:7` equals exactly 7 days from it; a retried transaction reads again                                                                                             |
| U-D-SVC-LOGGING         | Unit  | P0  | S2, E3 | R   | Captured logs and analytics for each outcome and refusal hold no reason, marker, subject id, alias or signed URL; the Redis failure log is one closed-code line                                                                                                                                      |
| U-D-SVC-STORED-RESPONSE | Unit  | P0  | E2, S4 | R   | The stored JSON holds no reason, no signed URL and no `cacheInvalidation`; the replay response equals it plus `replayed:true` and a fresh `cacheInvalidation`                                                                                                                                        |
| U-D-SVC-POSTCOMMIT      | Unit  | P0  | E2, S6 | R   | Bump, `assist` and `invalidateUserSessions` run after commit, on replays too, never inside the transaction, each under a bound, and a throw or a hang gives `deferred` with a 200                                                                                                                    |
| U-D-SVC-ERRORMAP        | Unit  | P1  | E1, S1 | R   | P2002 on `(case_key, sequence)` gives `case_conflict`; on `(moderator_id, mutation_id)` it re-reads; a moderator FK or `AuditLog` insert error gives `audit_unavailable`; an unknown database error stays a generic 500 with no reason                                                               |
| U-D-SVC-INSERT-ONLY     | Unit  | P1  | E2, S5 | R   | Static scan of `apps/api/src`: `moderationDecision` has no update or delete call and raw SQL has no `UPDATE "ModerationDecision"`                                                                                                                                                                    |
| U-D-READSET             | Unit  | P1  | S2     | R   | Table names in the decision and sanction repositories' raw SQL are a subset of `MODERATION_QUEUE_READ_TABLES`, which now holds both new tables                                                                                                                                                       |
| U-B-ACTIVE              | Unit  | P0  | S7     | R   | Temporary at `expires_at - 1 ms` active, at `expires_at` ended; permanent always active until `lifted_at`; lifted never active; a row for another member ignored; the read uses `tx` and no cache (TEA-20)                                                                                           |
| U-B-BODY                | Unit  | P0  | S7     | R   | `ForbiddenException` body is exactly `{statusCode, code, message, sanction}` for both kinds with `expiresAt` null on permanent; no reason, moderator, case or sanction id                                                                                                                            |
| U-B-ROUTE-MATRIX        | Unit  | P0  | S7     | R   | Reflection lists every handler on `CommunityController`, `CommunityCommentsController` and `CommunitySyncController`, and the test fails on a handler with no row in the expected-result table. Withdraw and comment delete are the only exempt member routes; admin challenge routes are outside it |
| U-B-D14                 | Unit  | P0  | S2     | R   | `buildAuthorStates` passes a recognized code, a joined code list and null, and sends null for operator words and `community_ban:<id>`                                                                                                                                                                |
| U-A-TRANSITIONS         | Unit  | P0  | E3, S7 | R   | Full 4 x 4 appeal state table for moderator and admin: only the three legal steps pass, each other is `appeal_transition_invalid`; an unknown id is `sanction_not_found` ahead of `admin_required`, as TEA-08 orders it                                                                              |
| U-S-FLAG-REPORT         | Unit  | P1  | S1     | R   | `flagPost` writes one report only when the status update matched one row, with null reporter, `inappropriate_content`, `origin: screening`, snapshot, object path, due in 24 hours and any existing alias; a lost race writes none                                                                   |

### Integration: decisions (`apps/api/integration/moderation-decisions.integration.spec.ts`, real Postgres)

| ID                      | Level       | Pri | AC     | Red | Scenario                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ----------- | --- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I-D-RESOLVE-GROUP       | Integration | P0  | E1, S1 | R   | Three open reports: all stamped with one time, target unchanged, one decision, three `report_resolved` events, one audit row naming the session moderator                                                                                                                                                                            |
| I-D-RESOLVE-ORPHAN      | Integration | P1  | E1, S1 | R   | `orphan-post.<id>` and `orphan-comment.<id>`: report stamped, no target effect, prior action read from the decision row                                                                                                                                                                                                              |
| I-D-RELEASE-POST        | Integration | P0  | E1, S1 | R   | Flagged post with its screening report: `published`, original `published_at` kept when present, engine version and reason kept, `overridden_engine_version` set, report stamped, `post.published` recorded                                                                                                                           |
| I-D-RELEASE-COMMENT     | Integration | P0  | E1, S1 | R   | Held comment, first publication: next counter value on the post, `screening_reason` null, `screening_version` kept, engagement and analytics once. Blocked comment with a kept sequence: same sequence and no second engagement. A release on a hidden post or under a hidden root is `author_ineligible`, as publication refuses it |
| I-D-RELEASE-REFUSALS    | Integration | P0  | E1, S1 | R   | Each detail from a real state: `target_not_held`, `target_erased`, `subject_banned`, `author_ineligible` (teen, consent lapsed), `community_writes_closed`, and a read failure on the write flag. Nothing written in any case (TEA-09)                                                                                               |
| I-D-TAKEDOWN-POST       | Integration | P0  | E1, S1 | R   | Published post: `flagged`, `post.removed` recorded, `erasure_requested_at` untouched, open reports stamped, event carries the snapshot. A resolved case can still be taken down                                                                                                                                                      |
| I-D-TAKEDOWN-COMMENT    | Integration | P0  | E1, S1 | R   | Published comment: `blocked`, body kept, `screening_reason` `operator_takedown`, absent from thread and from the parent's `replyCount`, `comment.removed` recorded, no privacy trigger failure                                                                                                                                       |
| I-D-TAKEDOWN-TWICE      | Integration | P1  | E1, S5 | R   | Second takedown with the new revision: 409 `target_not_published`, first timestamp unchanged                                                                                                                                                                                                                                         |
| I-D-ESCALATE            | Integration | P0  | E1, S1 | R   | Decision row only, reports open, no target change, SLA fields and queue order unchanged, no outbox or push row; marker on detail and queue page; a later terminal decision clears it; a second escalate is `already_escalated`; a moderator's terminal action is `admin_required`, an admin's passes                                 |
| I-D-ALLOWED-PARITY      | Integration | P0  | E1, S1 | R   | For the seeded state matrix and both roles, `allowedActions` from a real detail read equals the set of actions the POST accepts, each tried in a rolled-back transaction                                                                                                                                                             |
| I-D-DETAIL-READONLY     | Integration | P0  | S1     | G   | The 6.10 read-only checksum still holds with the new fields: exactly one audit row, no alias insert, no sanction write; a decisions flag read failure leaves the GET at 200 with an empty list                                                                                                                                       |
| I-D-ATOMIC              | Integration | P0  | E1, S1 | R   | Fail each insert in turn with a transaction-scoped trigger (decision, event, comment audit, sanction, `AuditLog`, content hide): full rollback across every table, 503 `audit_unavailable` or generic 500 as mapped, and no after-commit step ran                                                                                    |
| I-D-AUDIT-SHAPE         | Integration | P0  | E3, S1 | R   | `AuditLog` `event_type`, `user_id` equal to the moderator, `event_data` keys exactly `decisionId`, `caseId`, `action`, `role`, optional `banKind`; moderator with no `User` row gives 503 and no rows; reason, alias and subject id absent by a text scan of the row                                                                 |
| I-D-PRIOR-ACTIONS       | Integration | P1  | E3, S1 | R   | Post and comment cases show every decision once with the right `actorKind`; a comment takedown reads `operator` and a screener block reads `screening`; a case with zero open reports still shows the action (TEA-15); the marker never appears as `operatorNote`                                                                    |
| I-D-HTTP                | Integration | P0  | S2     | R   | Nest app with real guards and real `FeatureFlagsService`: 401, 403, 400, 404, 409, 503 bodies and headers on both routes                                                                                                                                                                                                             |
| I-D-SELF-REVIEW         | Integration | P0  | E1, S1 | R   | Author and reporter, moderator and admin, every action: `self_review_refused` with nothing written; a resolved report still counts; `allowedActions` empty                                                                                                                                                                           |
| I-D-OPERATOR-SANCTIONED | Integration | P1  | E1, S1 | R   | A moderator with an active ban gets `operator_sanctioned` on both routes and an empty list; after expiry the same moderator can act; the 6.10 read routes stay open to them                                                                                                                                                          |
| I-D-HOSTILE             | Integration | P1  | E3, S2 | R   | Markup and 1,000 unbroken characters are stored verbatim on the decision row and event, absent from `AuditLog`, and returned only through prior actions                                                                                                                                                                              |
| I-D-ACTIONS-COMPAT      | Integration | P1  | E1     | G   | `releaseFlaggedPost`, `takeDownPublishedPost`, `resolveReport` keep signature, results and log events; `takeDownCommunityLook` in the Playwright helper still works                                                                                                                                                                  |

### Integration: concurrency and idempotency (`apps/api/integration/moderation-decisions-concurrency.integration.spec.ts`)

Interleavings are forced with a held advisory or row lock, and `pg_locks` confirms the waiter before release. No sleeps.

| ID                 | Level       | Pri | AC     | Red | Scenario                                                                                                                                                                                                                           |
| ------------------ | ----------- | --- | ------ | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-C-CONFLICT       | Integration | P0  | E2, S3 | R   | Two moderators, same revision, every action pair across resolve, takedown and ban: one 200, one `case_conflict` with `currentRevision`, one decision row, no partial effect from the loser                                         |
| I-C-REPORT-RACE    | Integration | P0  | E2, S3 | R   | Hold the post row with an open report transaction, start a decision, commit the report: the decision answers `case_conflict` and the new report stays open (TEA-01, S-3). Run for a post and a comment case                        |
| I-C-WITHDRAW-RACE  | Integration | P1  | E2, S3 | R   | Author withdrawal and comment deletion between read and submit move the revision; the result is `case_conflict`                                                                                                                    |
| I-C-REPLAY-RACE    | Integration | P0  | E2, S4 | R   | Ten parallel sends of one `mutationId`: one row, nine `replayed:true` with equal bodies, no 500                                                                                                                                    |
| I-C-RETRY          | Integration | P0  | E2, S4 | R   | Same key and payload: stored response, full-table checksum unchanged, timestamps unchanged                                                                                                                                         |
| I-C-RETRY-MOVED    | Integration | P0  | E2, S4 | R   | Same key after another moderator's decision, after a stale revision, after an author erasure re-key and after the role lost its conflict: 200 stored response ahead of 409, 404 and 403                                            |
| I-C-KEY-REUSE      | Integration | P0  | E2, S4 | R   | Same key with a different action, reason, ban, case or route: `idempotency_mismatch`, nothing written; a whitespace-only reason difference replays                                                                                 |
| I-C-KEY-SCOPE      | Integration | P1  | E2, S4 | R   | Another moderator with the same UUID is a new decision. A refused or conflicted request stores nothing, so the same key can apply after a reload                                                                                   |
| I-C-FIRST-DECISION | Integration | P0  | E2, S5 | R   | Resolve at T1, new report, takedown at T2, retry, ban at T3: `firstDecisionAt` stays T1, first reports keep T1, the new report has T2                                                                                              |
| I-C-FIRST-ESCALATE | Integration | P0  | E2, S5 | R   | Escalate at T1, refused request, replay, resolve at T2: `firstDecisionAt` is T2                                                                                                                                                    |
| I-C-RESOLVED-AT    | Integration | P0  | E2, S5 | R   | Property run over 200 random sequences of decisions, retries and new reports with a seeded generator: no stamped `resolved_at` changes, `firstDecisionAt` equals the first terminal time                                           |
| I-C-REKEY          | Integration | P1  | E2, S5 | R   | Decide on `post.<id>`, escalate, erase the author: each `orphan-post.<id>` keeps `firstDecisionAt`, `escalated` and prior actions by overlap; the old id is `case_not_found`; a new decision starts its own sequence with no clash |
| I-C-BAN-RACE       | Integration | P0  | S3, S7 | R   | Two moderators ban one member from two different cases at once: the subject guard serializes them, one 200 and one `already_banned`, one active row, content hidden once                                                           |
| I-C-DB-BACKSTOP    | Integration | P1  | E2, S3 | R   | With the case lock stubbed out, a forced duplicate sequence maps to `case_conflict`                                                                                                                                                |
| I-C-DEADLOCK       | Integration | P2  | S3     | R   | Mixed load on one member: 10 decisions, 10 reports, withdrawal, erasure. No hang; every result is a closed code; `40P01` retries stay inside three attempts                                                                        |

### Integration: bans and appeals (`apps/api/integration/moderation-sanctions.integration.spec.ts`)

| ID                   | Level       | Pri | AC     | Red | Scenario                                                                                                                                                                                                                                                                                                                               |
| -------------------- | ----------- | --- | ------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-B-ROUTES           | Integration | P0  | E3, S7 | R   | Real HTTP, both kinds, every row of the route matrix: feed, post read, spotlight with both surfaces, comments, replies, submissions, events, targets, preferences, allocate, publish, comment, reaction set and remove with and without a receipt, both reports, `opened`: 403 `community_banned`                                      |
| I-B-BODY             | Integration | P0  | S7     | R   | The body survives the global filter on the wire; schema parse passes; a text scan finds no reason, marker, moderator or case                                                                                                                                                                                                           |
| I-B-CONTENT-TEMP     | Integration | P0  | E3, S7 | R   | Temporary on a post case and a comment case: target taken down with the operator's reason, other published content stays, reactions stay, reports stamped                                                                                                                                                                              |
| I-B-CONTENT-PERM     | Integration | P0  | E3, S7 | R   | Permanent: every published and pending post and comment moves per TEA-05 with `community_ban:<id>`, bodies kept, `published_at` and sequence kept; a comment on a third party's post passes the privacy trigger; reactions set `selection:null` with `revision` bumped; drafts untouched                                               |
| I-B-PENDING          | Integration | P0  | E3, S7 | R   | Hold, then run `dispatchPending`, the post processor and the comment processor: zero publications, the marker stays, comment body kept, no `consent_suspended` conversion                                                                                                                                                              |
| I-B-EXPIRY           | Integration | P0  | E3, S7 | R   | Pin the clock past `expires_at`: access returns on the next request with no write. A banned reader at the boundary minus 1 ms is refused. Held content stays held, unpublished content stays hidden, and an appeal step is refused                                                                                                     |
| I-B-UPGRADE          | Integration | P0  | E3, S7 | R   | Admin upgrades an active temporary: old row lifted, new permanent, full hide, epoch bumped, standing shows prior count 1; only one unlifted permanent; temporary markers survive and the overturn restores only the new marker                                                                                                         |
| I-B-SECOND           | Integration | P1  | E3, S7 | R   | Active permanent, or active temporary with a temporary request: `already_banned`. Temporary after an expired one passes. Moderator `permanent`: `admin_required`. An operator's account can be banned, is audited and loses community access only                                                                                      |
| I-B-ERASED           | Integration | P1  | E3, S7 | R   | Orphan, anonymized post and erased comment: `target_erased`. Withdrawn post and `author_deleted` comment: ban passes with no target effect (TEA-10)                                                                                                                                                                                    |
| I-B-REALTIME         | Integration | P0  | E3, S7 | R   | A real socket through `community-realtime.server` with the real access path: banned mid-connection, `denied` control at the next revalidation within the 8-second bound; a reconnect is refused; a temporary ban's expiry admits a new connection                                                                                      |
| I-B-SEND-GUARD       | Integration | P1  | E3, S7 | R   | Pending delivery to a banned recipient suppressed; a banned actor drops from a group while another actor's intent survives; `PushToken` rows unchanged                                                                                                                                                                                 |
| I-B-RETRACT          | Integration | P0  | E3, S7 | R   | During both kinds: withdraw own post, including one the ban hid, and delete own comment succeed; a marked comment delete clears the marker and an overturn leaves it deleted; other members' content still refused                                                                                                                     |
| I-B-NONCOMMUNITY     | Integration | P0  | E3, S7 | R   | With an active permanent ban: wardrobe, ritual, weather alerts, user profile, commerce preferences and push registration answer as before (no account-deletion or privacy-export route exists at this commit); `PushToken`, `UserProfile.preferences` and `GuardianConsent` checksums unchanged; `community_forget_subject` not called |
| I-B-TEEN             | Integration | P0  | E3, S7 | R   | Banned teen: guardian revokes and grants consent, and the sanction row is unchanged and still enforced; consent state is untouched by the ban                                                                                                                                                                                          |
| I-B-FLAG-OFF         | Integration | P0  | E3, S7 | R   | Both decision flags off: a ban keeps refusing every route; a temporary ban still expires                                                                                                                                                                                                                                               |
| I-B-REPLIES          | Integration | P1  | E3, S7 | R   | Hidden root: replies unreachable by thread and by `targets/resolve`, statuses unchanged; they return when the root does                                                                                                                                                                                                                |
| I-B-SHARE-CARD       | Integration | P1  | E3, S7 | R   | Export refused for both a community post and an outfit source; an unbanned member's outfit export is unchanged (TEA-17)                                                                                                                                                                                                                |
| I-B-ERASURE-CASCADE  | Integration | P1  | E3, S7 | R   | Member erasure while banned: sanction row gone, decision rows keep `subject_alias` with `subject_user_id` null, moderator FK intact                                                                                                                                                                                                    |
| I-B-RACE-ENGAGE      | Integration | P2  | S7     | R   | A comment and a report held open while the ban transaction waits, for the banned member: either the row commits first and is held by the ban, or the request gets 403. No published row survives                                                                                                                                       |
| I-B-SCALE            | Integration | P2  | S7     | R   | Permanent ban on a member with 2,000 related posts inside the 7-second timeout; record duration and lock count in the PR (R-021)                                                                                                                                                                                                       |
| I-A-HAPPY            | Integration | P0  | E3, S7 | R   | `requested` by moderator, `upheld` by admin; decision row and `moderation_appeal_recorded` audit row each step; the member's 403 shows the new `appealStatus`; `upheld` changes nothing else                                                                                                                                           |
| I-A-OVERTURN         | Integration | P0  | E3, S7 | R   | Admin overturns: access returns on the next request; marked content with `published_at` returns; never-published held content stays held; the case target stays down and is releasable from its case; reactions stay withdrawn; withdrawn and erasure-requested rows stay out; epoch bumped                                            |
| I-A-OVERTURN-CONSENT | Integration | P0  | E3, S7 | R   | Teen banned, guardian revokes, admin overturns: sanction lifted, zero rows return to `published`, markers stay. Same for an under-age profile (TEA-02, S-10)                                                                                                                                                                           |
| I-A-BAD-STEP         | Integration | P0  | E3, S7 | R   | `upheld` from `not_requested`; a step on an expired or lifted ban: `appeal_transition_invalid`; unknown id: `sanction_not_found`; a moderator sending an outcome: `admin_required`                                                                                                                                                     |
| I-A-SELF             | Integration | P0  | E1, S1 | R   | The subject, the case author and a reporter of the originating case, all admins: `self_review_refused`, or `operator_sanctioned` while actively banned (TEA-07)                                                                                                                                                                        |
| I-A-IDEMPOTENT       | Integration | P1  | E2, S4 | R   | Retry returns the stored step; a different step with the same key is `idempotency_mismatch`; a key used on the decisions route is a mismatch here                                                                                                                                                                                      |
| I-A-RACE             | Integration | P1  | S3     | R   | Two admins, `upheld` and `overturned`: one applies and the other is `appeal_transition_invalid`; restoration runs at most once                                                                                                                                                                                                         |
| I-A-FIRST-UNMOVED    | Integration | P1  | E2, S5 | R   | An appeal step moves the case revision and leaves `firstDecisionAt` and `escalated` unchanged                                                                                                                                                                                                                                          |

### Integration: public caches and screening intake (`apps/api/integration/moderation-decisions-cache.integration.spec.ts`)

| ID                 | Level       | Pri | AC     | Red | Scenario                                                                                                                                                                                                                                                            |
| ------------------ | ----------- | --- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-K-TAKEDOWN-READS | Integration | P0  | E2, S6 | R   | Prime the spotlight snapshot and a second member's reads. Take down with no worker running: the next spotlight, teaser, feed, post and comment reads exclude it; the area counter moved; `cacheInvalidation:'completed'`; the public stream cursor sees the removal |
| I-K-BAN-EPOCH      | Integration | P0  | E2, S6 | R   | Permanent ban across three areas: epoch moved, all three rebuild, no entry from the member. Temporary ban bumps only the target's areas                                                                                                                             |
| I-K-REDIS-DOWN     | Integration | P0  | E2, S6 | R   | Redis failing or hanging past the bound: 200 inside the budget, `deferred`, the decision stands, one closed-code log line, the next spotlight read excludes the post, and the bump replays from the cursor when Redis returns                                       |
| I-K-OVERTURN       | Integration | P1  | E2, S6 | R   | Overturn with no worker: epoch moved and restored content returns on the next read                                                                                                                                                                                  |
| I-K-REPLAY-RERUN   | Integration | P1  | E2, S6 | R   | Commit, kill the after-commit step, retry: stored response, no new decision row, the bump runs and reports its result (TEA-13)                                                                                                                                      |
| I-K-NO-PUBLIC      | Integration | P1  | E2, S6 | G   | Feed, comments, spotlight and teaser responses are `private, no-store`, so the D12 inventory stays true                                                                                                                                                             |
| I-K-COMMENT-STREAM | Integration | P1  | E2, S6 | R   | Comment takedown and overturn record `comment.removed` and `comment.published` in the transaction and reach a connected client with no worker                                                                                                                       |
| I-K-RELEASE        | Integration | P2  | S6     | R   | A released post appears on the next spotlight read for its area, and `resolve` and `escalate` run no bump (TEA-21)                                                                                                                                                  |
| I-S-INTAKE         | Integration | P0  | S1     | R   | Screener flags through the real processor: `post.<id>` on the next queue read, `reportCount` 1, identity `screening`, due in 24 hours, actor kind `screening`, `release` offered                                                                                    |
| I-S-LOOP           | Integration | P0  | E1, S1 | R   | Upload, screen, flag, queue, release, feed: the first path out of a flagged post with no script. The same for a held comment                                                                                                                                        |
| I-S-IDENTITY       | Integration | P1  | S1     | R   | Erased member reporter stays `erased`; a live screening report reads `screening`; alias fallback per TEA-16; `review_failed` stays absent from the queue                                                                                                            |
| I-S-FINDING-PARITY | Integration | P0  | S1     | R   | Extend `I-Q-RISK-PARITY`: `operator_takedown` and `community_ban:<id>` on comments and posts read no finding in SQL and in TypeScript, at the same rank; an unrelated `blocked` still reads a finding                                                               |

### Database (`packages/db/test/rls/`, `packages/db/test/moderation-decisions-backfill.spec.ts`)

| ID            | Level | Pri | AC     | Red | Scenario                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ----- | --- | ------ | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-RLS-DENIED  | DB    | P0  | S2     | R   | `anon` and `authenticated` hold no SELECT, INSERT, UPDATE, DELETE or TRUNCATE on `ModerationDecision` and `CommunitySanction`, RLS is enabled with zero policies, and a live INSERT and SELECT give `42501`; both tables sit in `MODERATION_QUEUE_READ_TABLES` and the harness API-only list                                                                                                              |
| D-CONSTRAINTS | DB    | P0  | S3, S4 | R   | `UNIQUE (case_key, sequence)`, `UNIQUE (moderator_id, mutation_id)`, unique `decision_id`, the `kind` to `expires_at` CHECK and the partial index for one unlifted permanent each refuse a raw insert; a lifted permanent allows a new one; `origin` defaults `member`                                                                                                                                    |
| D-BACKFILL    | DB    | P0  | S1     | R   | Migration on seeded rows: comment reports with screening audit actions become `screening`; an erased member reporter with `reported` stays `member`; a flagged post with a newest `flagged` event gains one report due 24 hours after it; a post with a report, a `review_failed` post, a canary post, a post with erasure requested, an anonymized post and a post with a newer operator event gain none |
| D-HYGIENE     | DB    | P1  | S10    | R   | `migration-hygiene.spec.ts` passes with the hand-authored partial index and GIN index, and the Prisma diff is empty                                                                                                                                                                                                                                                                                       |
| D-RLS-AUDIT   | DB    | P1  | S2     | G   | `authenticated` cannot insert a forged `moderation_decision_applied` row; UPDATE, DELETE and TRUNCATE raise                                                                                                                                                                                                                                                                                               |

### Contract (`pact/http/`, OpenAPI)

| ID          | Level    | Pri | AC  | Red | Scenario                                                                                                                                                                                                                                                                        |
| ----------- | -------- | --- | --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-D-PACT    | Contract | P1  | E1  | R   | Decision applied, replayed, `case_conflict`, `action_not_applicable`, `self_review_refused`, `admin_required`, 503 disabled; appeal applied; `community_banned` on the feed. `createProviderState` per state, matchers on revision, times and ids, three-run determinism passes |
| C-D-OPENAPI | Contract | P1  | E1  | R   | `generate:http-openapi` and `generate:api-client` leave no diff; no existing model renamed (6.10 note); optic lint passes; both paths list 200, 400, 401, 403, 404, 409, 503                                                                                                    |

### Web and mobile units and components

| ID                    | Level     | Pri | AC     | Red | Scenario                                                                                                                                                                                                                                                           |
| --------------------- | --------- | --- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U-WEB-D-CLIENT        | Unit      | P0  | E3, S8 | R   | Every closed code and detail maps to one panel state; `cacheInvalidation` is passed on; the `community.ts` classifier reads `code` first, so `community_banned` reaches the banned state from every read route including the teaser, ahead of the message rules    |
| U-WEB-D-LOCALES       | Unit      | P1  | E3, S8 | R   | Ten catalogs hold the same `moderation.decision.*`, `moderation.standing.*`, `community.banned.*` keys; enum-derived key set; no English-only value in non-English catalogs                                                                                        |
| U-WEB-D-NO-DIRECT     | Unit      | P1  | S2     | R   | Static scan: panel and notice sources import no Supabase table client, Prisma or server action, and hold no `alert`, `confirm` or `prompt`                                                                                                                         |
| U-MOB-D-DENIED        | Unit      | P1  | E3, S7 | R   | `apps/mobile/src/lib/community.ts` classifies `community_banned` by code as the existing denied state, with no retry loop and no new string                                                                                                                        |
| C-WEB-D-PANEL         | Component | P0  | E1, S8 | R   | Renders exactly `allowedActions`; empty renders no form; ban kinds from `banKinds`; durations 1, 7, 30, 90; `permanent` absent for a moderator; live character count at 3 and 1000 with submit disabled outside the range                                          |
| C-WEB-D-MUTATION      | Component | P0  | E2, S4 | R   | One id per intent. A retry of the same payload reuses it, an edited reason or action mints a new one, a double click sends once, and `expectedRevision` comes from the last read                                                                                   |
| C-WEB-D-STATES        | Component | P0  | E3, S8 | R   | Idle, submitting, applied, conflict, not applicable with each detail, forbidden, admin required, self review, disabled, audit unavailable, offline retry, cache deferred, operator sanctioned, idempotency mismatch: localized text and the right recovery control |
| C-WEB-D-KEEP-REASON   | Component | P0  | S8     | R   | Conflict, offline, audit unavailable and 5xx keep the typed reason; reload after conflict fetches once and keeps it; applied clears it                                                                                                                             |
| C-WEB-D-CONFIRM       | Component | P0  | E1, S8 | R   | `takedown` and `ban` require the in-page confirmation, with cancel returning focus and sending nothing; `resolve`, `release` and `escalate` skip it; no browser dialog                                                                                             |
| C-WEB-D-ANNOUNCE      | Component | P0  | S8     | R   | One polite announcement per outcome under strict mode, including across the reload that follows                                                                                                                                                                    |
| C-WEB-D-RELOAD-ONE    | Component | P0  | S8     | R   | Applied triggers exactly one detail GET, conflict triggers none until the user asks, and replay triggers one (each GET is one audit row)                                                                                                                           |
| C-WEB-D-HOSTILE       | Component | P0  | S9     | R   | The hostile corpus from 6.10 in reason, prior actions and subject alias renders through `PlainText`, inert and wrapped                                                                                                                                             |
| C-WEB-D-BANNED-NOTICE | Component | P0  | E3, S8 | R   | Temporary with a localized expiry, permanent with none, each appeal status, support directive, no retry control, no reason or moderator; replaces the feed and clears cached cards; a `denied` socket control reaches the same state on next read                  |
| C-WEB-D-STANDING      | Component | P1  | E3, S8 | R   | Sanction, expiry, appeal status, prior ban count, appeal controls per role; expired and no-sanction states; `firstDecisionAt` and the escalated marker on the detail and the queue row                                                                             |
| C-WEB-D-A11Y          | Component | P1  | S9     | R   | Focus order, visible focus, 44-pixel targets, labels on reason, kind and duration, one live region, focus on the outcome after reload                                                                                                                              |

### End to end (`playwright/tests/moderation-decisions.spec.ts`, `playwright/tests/api/auth-moderation-security.spec.ts`)

| ID                  | Level | Pri | AC     | Red | Scenario                                                                                                                                                                                                                                                            |
| ------------------- | ----- | --- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-D-ROLES           | E2E   | P0  | S2     | R   | API role matrix on both routes through `apiRequest`: no token 401; guardian and teen 403 with one body for real and unknown ids; a forged `moderatorId` 400 and nothing written                                                                                     |
| P-D-JOURNEY         | E2E   | P0  | E1, S1 | R   | Moderator opens a case in the console, resolves, reads the outcome, sees `firstDecisionAt` and the prior action. Same for release and takedown from seeded cases                                                                                                    |
| P-D-CONFLICT        | E2E   | P0  | E2, S3 | R   | Two browser contexts on one case: the second submit shows the conflict state with the reason kept; reload and resubmit gives `action_not_applicable` or applies per the new state                                                                                   |
| P-D-BAN-JOURNEY     | E2E   | P0  | E3, S7 | R   | Moderator bans for 7 days. In the member's open community page the socket closes, the banned notice shows localized copy, comment and reaction fail, and wardrobe still loads. A second member no longer sees the post                                              |
| P-D-AXE             | E2E   | P0  | S9     | R   | axe with `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa` on panel idle, confirm, conflict, applied, standing and banned notice, in light and dark, at 375 and 1280                                                                                |
| P-D-TAKEDOWN-PUBLIC | E2E   | P1  | E2, S6 | R   | A second member's feed, spotlight and teaser lose the post on one read after a takedown, with no polling; only a `deferred` answer may wait for the worker                                                                                                          |
| P-D-KEYBOARD        | E2E   | P1  | S9     | R   | Whole decision by keyboard with real Tab presses: action, reason, confirm, outcome, with focus visible at each step                                                                                                                                                 |
| P-D-THEMES-WIDTHS   | E2E   | P1  | S9     | R   | Panel and notice at 375 and 1280, light and dark: no horizontal overflow, targets at 44 px; screenshots saved under `story-6-11/`                                                                                                                                   |
| P-D-OFFLINE-RETRY   | E2E   | P1  | E2, S4 | R   | Commit, drop the response by routing, retry from the offline state: `replayed:true`, one decision row, one announcement                                                                                                                                             |
| P-D-APPEAL          | E2E   | P1  | E3, S7 | R   | Moderator records `requested`; admin overturns; the member's community page returns on reload                                                                                                                                                                       |
| P-D-PREVIEW-CLOSED  | E2E   | P1  | S2     | R   | Live on a preview with no database: flags closed, moderator gets 503 `moderation_console_disabled` (the controller reads the console flag first) with `private, no-store`; guardian, teen and anonymous stay 403 and 401; the detail stays read-only in the browser |
| P-D-LOCALE          | E2E   | P2  | S8     | R   | `es-419` and the locale with the longest strings render the panel and notice with no overflow and no raw enum                                                                                                                                                       |
| P-D-DISABLED        | E2E   | P2  | S8     | R   | A routed 503 renders the read-only console (RG5)                                                                                                                                                                                                                    |

### Manual and process

| ID         | Level  | Pri | AC  | Red | Scenario                                                                                                                                               |
| ---------- | ------ | --- | --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| X-D-PIXEL  | Manual | P2  | S9  | M   | The Verification manual check: one case per action at 1280 and 375, light and dark; pixel review of spacing, truncation, focus ring and icon alignment |
| V-D-BUDGET | Manual | P2  | S10 | M   | File count below 100 and every PR job below 20 minutes, recorded in the PR description                                                                 |

### Generated totals

<!-- TOTALS-START -->

| Level       | P0  | P1  | P2  | Total |
| ----------- | --- | --- | --- | ----- |
| Unit        | 22  | 13  | 1   | 36    |
| Integration | 46  | 24  | 4   | 74    |
| DB          | 3   | 2   | 0   | 5     |
| Contract    | 0   | 2   | 0   | 2     |
| Component   | 9   | 2   | 0   | 11    |
| E2E         | 5   | 6   | 2   | 13    |
| Manual      | 0   | 0   | 2   | 2     |
| **Total**   | 85  | 49  | 9   | 143   |

<!-- TOTALS-END -->

---

## Test Coverage Plan (risk-linked)

Priority criteria used here:

- P0: critical business, security, data-integrity or compliance impact with no safe workaround.
- P1: core or complex behavior with material reach and a limited workaround.
- P2: secondary behavior with narrower reach and an acceptable workaround.
- P3: none in this story, because rare or cosmetic items sit in the Manual review.

### P0 (Critical)

Run on every PR. Pass rate 100 percent.
These cover R-001 to R-013 and the three epics criteria.

- Authorization and identity: U-D-CONTRACT-STRICT, U-D-CTRL-ROLES, -ORDER, -NO-ORACLE, -IDENTITY, -HEADERS, I-D-HTTP, I-D-SELF-REVIEW, I-A-SELF, D-RLS-DENIED, P-D-ROLES.
- Serialization and idempotency: U-D-REVISION, U-D-SVC-HASH, -PRECEDENCE, -STORED-RESPONSE, I-C-CONFLICT, -REPORT-RACE, -REPLAY-RACE, -RETRY, -RETRY-MOVED, -KEY-REUSE, -BAN-RACE, D-CONSTRAINTS, P-D-CONFLICT.
- First decision: U-D-SVC-CLOCK, I-C-FIRST-DECISION, -FIRST-ESCALATE, -RESOLVED-AT.
- Atomic record and audit: I-D-ATOMIC, I-D-AUDIT-SHAPE, I-D-RESOLVE-GROUP, I-D-ESCALATE, U-D-SVC-LOGGING.
- Actions: I-D-RELEASE-POST, -RELEASE-COMMENT, -RELEASE-REFUSALS, -TAKEDOWN-POST, -TAKEDOWN-COMMENT, I-D-ALLOWED-PARITY, U-D-ALLOWED-RULES, I-S-INTAKE, I-S-LOOP, I-S-FINDING-PARITY, D-BACKFILL.
- Ban reach: U-B-ACTIVE, U-B-BODY, U-B-ROUTE-MATRIX, U-B-D14, I-B-ROUTES, -BODY, -CONTENT-TEMP, -CONTENT-PERM, -PENDING, -EXPIRY, -UPGRADE, -REALTIME, -RETRACT, -NONCOMMUNITY, -TEEN, -FLAG-OFF, P-D-BAN-JOURNEY.
- Appeals: U-A-TRANSITIONS, I-A-HAPPY, -OVERTURN, -OVERTURN-CONSENT, -BAD-STEP.
- Caches: U-D-SVC-POSTCOMMIT, I-K-TAKEDOWN-READS, -BAN-EPOCH, -REDIS-DOWN.
- Console: C-WEB-D-PANEL, -MUTATION, -STATES, -KEEP-REASON, -CONFIRM, -ANNOUNCE, -RELOAD-ONE, -HOSTILE, -BANNED-NOTICE, U-WEB-D-CLIENT, P-D-JOURNEY, P-D-AXE.

Consequence and workaround on the primary rows:

- R-003, R-004, R-005, R-006: a false moderation record has no recovery, since rows are append-only and CC-6.13 relies on them.
- R-008, R-009: a missed route leaves abuse live, and an over-reach cuts a paying member off with no self-service path.
- R-010: republishing a minor's content without consent is a compliance failure with no safe workaround.
- R-012: public harm continues while the cache lags, and D12 only offers a bound when Redis itself is down.

### P1 (High)

Run on every PR. Pass rate at least 95 percent, failures triaged before merge.
Validation, flag registry, re-key continuity, appeal races, operator sanction, replies, share cards, send guard, stream delivery, pact, OpenAPI, locales, keyboard, theme and width matrix, offline retry, deployed preview.

### P2 (Medium)

Run on the PR when cheap, otherwise nightly.
Malformed bodies, deadlock load, engagement race, scale budget, release bump, locale overflow, routed disabled state, pixel review, budget record.

---

## Explicit negative tests

| Negative                                                         | Test                                      |
| ---------------------------------------------------------------- | ----------------------------------------- |
| Guardian, teen or anonymous writes a decision or an appeal step  | U-D-CTRL-ROLES, P-D-ROLES                 |
| Moderator identity taken from a body, query or header            | U-D-CTRL-IDENTITY, U-D-CONTRACT-STRICT    |
| Direct database role reads or writes either new table            | D-RLS-DENIED                              |
| Flag state visible to a non-moderator                            | U-D-CTRL-ORDER                            |
| A second decision on a stale revision                            | I-C-CONFLICT, I-C-REPORT-RACE             |
| A retry that writes a row or moves a timestamp                   | I-C-RETRY, I-C-RESOLVED-AT                |
| `escalate`, a refusal or a replay setting `firstDecisionAt`      | I-C-FIRST-ESCALATE                        |
| `escalate` sending anything or changing an SLA value             | I-D-ESCALATE                              |
| Partial commit                                                   | I-D-ATOMIC                                |
| Reason in a log, `AuditLog`, analytics or an error body          | U-D-SVC-LOGGING, I-D-AUDIT-SHAPE          |
| Marker or operator words reaching the author                     | U-B-D14                                   |
| Marker shown as `operatorNote` or read as a finding              | I-D-PRIOR-ACTIONS, I-S-FINDING-PARITY     |
| A reason forged to read as a screening code or a marker          | U-D-REASON                                |
| A banned member using any community route                        | U-B-ROUTE-MATRIX, I-B-ROUTES              |
| A flag off lifting a ban                                         | I-B-FLAG-OFF                              |
| A ban blocking wardrobe, billing, privacy or weather alerts      | I-B-NONCOMMUNITY                          |
| A ban deleting `PushToken` rows or changing consent state        | I-B-NONCOMMUNITY, I-B-TEEN                |
| A ban blocking withdrawal or comment deletion                    | I-B-RETRACT                               |
| A processor publishing held content                              | I-B-PENDING                               |
| Overturn republishing content after consent lapsed               | I-A-OVERTURN-CONSENT                      |
| Moderator applying a permanent ban or an appeal outcome          | U-A-TRANSITIONS, I-B-SECOND               |
| Author, reporter or subject ruling on their own case or appeal   | I-D-SELF-REVIEW, I-A-SELF                 |
| A worker being required for a takedown to take effect            | I-K-TAKEDOWN-READS                        |
| A Redis outage failing or reversing a decision                   | I-K-REDIS-DOWN                            |
| A browser dialog                                                 | U-WEB-D-NO-DIRECT, C-WEB-D-CONFIRM        |
| Action control outside `allowedActions`                          | C-WEB-D-PANEL, I-D-ALLOWED-PARITY         |
| Detail reload on focus, or more than one reload after applied    | C-WEB-D-RELOAD-ONE                        |
| A code path updating a decision row                              | U-D-SVC-INSERT-ONLY                       |
| Behavior change on `POST /actions` or the three existing methods | U-D-CTRL-ACTIONS-KEPT, I-D-ACTIONS-COMPAT |

---

## Test data and harness

- **Seed helper** `seedDecisionCases(prisma, { runId, now })` in `apps/api/integration/helpers/moderation-decisions-seed.ts` composes `seedModerationQueue` and adds one case per row of the D4 table, a member with mixed content on three posts, a teen with active consent, and active, expired and lifted sanctions.
  The same function seeds Playwright, Pact states and the Manual check. One source, four consumers.
- **Unique ids per run.** `AuditLog` is immutable and RESTRICT on `user_id`, so moderators stay. Every moderator, member and post id includes the run id. Cleanup deletes content in dependency order and leaves users and audit rows.
- **Clock.** `pinClock` fakes `Date` only. The service takes an injectable clock and enforcement binds `new Date()`, so both follow the pin. Never assert against SQL `now()`.
- **Forced interleaving.** A helper opens a second connection, holds the row or advisory lock, starts the request, polls `pg_locks` until the request waits, then releases. A fixed timeout on the poll fails the test with the lock dump. No sleeps.
- **Fault injection.** I-D-ATOMIC uses a test-only trigger scoped by a `SET LOCAL` setting, so production code gains no seam and parallel specs are unaffected.
- **Redis.** Integration uses `community-spotlight-context.ts`. The outage case injects a failing client and a hanging client through the module override.
- **Identity.** Integration HTTP tests stub `AccessTokenIdentityService` as 6.10 does. Playwright uses `authHeaders` and `localE2EAccessToken` with role `moderator` or `admin`, with a `User` row present.
- **Realtime.** I-B-REALTIME uses a real socket on an ephemeral port and the real access path. The wait is event-driven on the control message with an 8-second cap.
- **Pact.** Provider state handlers call the same seed helper with fixed ids. Volatile fields use matchers.
- **Database isolation.** Playwright runs only with an isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true`. The flags stay at the seeded value in shared databases (RG5).

### File plan against the budget

The spec budgets 8 API test files, 4 web test files and 8 for review fixes.
This plan uses 12 API files: controller, service and sanctions units; edits to the access, comments, actions and processor specs; four integration specs; one seed helper.
It uses 5 web files: client, panel, standing, notice and the `community.ts` classifier test.
That spends 5 of the 8 headroom files and brings the plan to 83, under the 90 split trigger.
If the count passes 90, the spec's split rule moves the web banned notice to a stacked PR. Tests stay.

---

## Execution Strategy

| Lane               | Content                                                                     | Budget                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pr-checks`        | api-client, API and web units, components, API integration, locales, RLS    | Under 12 minutes added: seed once per file; I-C-RESOLVED-AT is 200 sequences on one case set; I-B-SCALE inserts with `generate_series` |
| `contract-testing` | C-D-PACT with determinism, C-D-OPENAPI                                      | Under 4 minutes added                                                                                                                  |
| `pr-pw-e2e-local`  | P-D-\* in one file, chromium, 375 and 1280 as two projects reusing the seed | Under 6 minutes added                                                                                                                  |
| Local              | S-1 to S-14 seeded-defect proofs, X-D-PIXEL                                 | Before PR review                                                                                                                       |

Commands follow the spec Verification list. During multi-peer work: `npm exec -- vitest run` and `npm exec -- tsc --noEmit -p`, announced before any `npm run`.

---

## Red-first plan and seeded-defect proofs

**Order of work for the builder.**

1. Migration, then D-CONSTRAINTS, D-BACKFILL, D-RLS-DENIED red against missing tables.
2. Contract schemas, then U-D-CONTRACT-STRICT, U-D-REASON, U-D-REVISION, U-D-ALLOWED-RULES, U-D-RESPONSE-STRICT red.
3. `seedDecisionCases`, then I-D-RESOLVE-GROUP, I-D-HTTP, I-C-CONFLICT, I-C-RETRY, I-C-FIRST-DECISION, I-B-ROUTES, I-K-TAKEDOWN-READS, I-S-INTAKE red against missing routes (404 is the right failure).
4. U-B-ROUTE-MATRIX red, then `assertCommunityMemberNotSanctioned` and its call sites. U-B-D14 red, then the projection.
5. Controller and service units red, then implementation until green. I-C-REPORT-RACE and I-A-OVERTURN-CONSENT before the code they guard, since both encode a ruling.
6. Component tests red against contract fixtures, then the panel and notice.
7. Pact and Playwright last, red because the routes and panel do not exist.

`G` rows (I-D-DETAIL-READONLY, U-D-CTRL-ACTIONS-KEPT, I-D-ACTIONS-COMPAT, I-K-NO-PUBLIC, D-RLS-AUDIT) start green and stay green.

**Seeded-defect proofs.**
Each proof breaks the finished implementation in a throwaway `git worktree` (node_modules symlinked), confirms the named test goes red for the stated reason, and records the commit and output in `_bmad-output/test-artifacts/story-6-11/seeded-defects.md`.
No stash, checkout of paths or reset in the shared checkout.

| ID   | Defect injected                                                       | Must go red                            |
| ---- | --------------------------------------------------------------------- | -------------------------------------- |
| S-1  | Read the moderator id from the body when present                      | U-D-CTRL-IDENTITY, U-D-CONTRACT-STRICT |
| S-2  | Remove `RolesGuard` from the appeal route                             | U-D-CTRL-ROLES, I-D-HTTP, P-D-ROLES    |
| S-3  | Check the revision before the post row lock                           | I-C-REPORT-RACE                        |
| S-4  | Run the idempotency check after the revision check                    | I-C-RETRY-MOVED                        |
| S-5  | Overwrite `resolved_at` on every report of the case                   | I-C-FIRST-DECISION, I-C-RESOLVED-AT    |
| S-6  | Write `AuditLog` after commit                                         | I-D-ATOMIC                             |
| S-7  | Remove the D14 projection                                             | U-B-D14                                |
| S-8  | Move the sanction check into the shared comment `eligibility` closure | I-B-RETRACT                            |
| S-9  | Store the ban in `preferences.compliance.accountStatus`               | I-B-NONCOMMUNITY, I-B-TEEN             |
| S-10 | Drop the eligibility gate from the overturn restore                   | I-A-OVERTURN-CONSENT                   |
| S-11 | Await the Redis bump inside the transaction                           | I-K-REDIS-DOWN, U-D-SVC-POSTCOMMIT     |
| S-12 | Restore the queue's plain `blocked` finding predicate                 | I-S-FINDING-PARITY                     |
| S-13 | Let the panel offer `permanent` to a moderator                        | I-D-ALLOWED-PARITY, C-WEB-D-PANEL      |
| S-14 | Remove the `setReaction` sanction check                               | U-B-ROUTE-MATRIX, I-B-ROUTES           |

---

### Seeded-defect results

Run in a throwaway `git worktree` at commit `5da755c1` with `node_modules` symlinked, then removed.
Every defect turned the named tests red for the stated reason, except the two S-17 comment forms, which exposed a real test gap.

| ID   | Defect injected                                                                      | Red tests (failed count)                                                       |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| S-1  | Optional `moderatorId` in the body, used as the moderator                            | U-D-CONTRACT-STRICT (1), U-D-CTRL-IDENTITY (1)                                 |
| S-2  | `RolesGuard` only on `decide`, leaving the appeal route open                         | U-D-CTRL-ROLES (4), I-D-HTTP (2). P-D-ROLES not run for this proof             |
| S-3  | The decision reuses the case read taken before the locks                             | I-C-REPORT-RACE (4)                                                            |
| S-4  | Replay check moved after the refusal checks                                          | I-C-RETRY-MOVED (6)                                                            |
| S-5  | `resolved_at` stamped on every report of the case                                    | I-C-FIRST-DECISION (1), I-C-RESOLVED-AT (1)                                    |
| S-6  | `AuditLog` written after commit                                                      | I-D-ATOMIC (1)                                                                 |
| S-7  | D14 projection removed                                                               | U-B-D14 (3)                                                                    |
| S-8  | Sanction check moved into the shared comment `eligibility` closure                   | I-B-RETRACT (3)                                                                |
| S-9  | The ban also writes `compliance.accountStatus`                                       | I-B-NONCOMMUNITY (1), I-B-TEEN (1)                                             |
| S-10 | Eligibility gate removed from the overturn restore                                   | I-A-OVERTURN-CONSENT (2)                                                       |
| S-11 | Unbounded spotlight bump inside the transaction                                      | U-D-SVC-POSTCOMMIT (6), I-K-REDIS-DOWN (2)                                     |
| S-12 | Plain `blocked` finding predicate, in SQL and in TypeScript separately               | I-S-FINDING-PARITY (2 each)                                                    |
| S-13 | `banKinds` computed as admin; panel hardcodes both kinds                             | I-D-ALLOWED-PARITY (1), U-D-ALLOWED-RULES (9); C-WEB-D-PANEL (1)               |
| S-14 | Sanction check removed from `setReaction`                                            | U-B-ROUTE-MATRIX (1), I-B-ROUTES (8), I-B-FLAG-OFF (4)                         |
| S-15 | Check removed from `assertPublicPostReadable`, allocate and publish, each separately | U-B-ROUTE-MATRIX (3, 1), I-B-ROUTES (6, 2, 2), I-B-FLAG-OFF (3, 1, 1)          |
| S-16 | A banned actor link makes the group ineligible again                                 | I-B-SEND-GUARD (1)                                                             |
| S-17 | Restore matches any `community_ban:` prefix                                          | I-B-UPGRADE (1) for posts. Comments survived and gained a test in I-A-OVERTURN |

S-2 is the closest form the code allows, because the guard sits on the class.
S-9 keeps the sanction row and adds the rejected store, because removing the row would fail every ban test for an unrelated reason.
The concurrency author also ran 19 mutations of its own, all red. Its attempt-limit mutation for I-C-DEADLOCK was never run, and that row cannot force `40P01`.

---

### Execution results (2026-11-04, Chicago time)

Three consecutive full runs at commit `3a23e2cc`, serial, every tier, on a migrated stock Postgres 17 with no failure, retry or flake.

| Suite                                                                 | Result on each of three runs              |
| --------------------------------------------------------------------- | ----------------------------------------- |
| `apps/api` whole tier, units and integration                          | 7879 passed, 28 skipped, 362 of 365 files |
| `packages/api-client`                                                 | 1580 passed                               |
| `packages/config`                                                     | 29 passed                                 |
| `packages/db`, RLS, constraints and backfill                          | 266 passed, 1 skipped                     |
| `apps/web`                                                            | 1807 passed                               |
| `apps/mobile`                                                         | 1905 passed                               |
| Pact consumer and provider                                            | 444 passed and verification passed        |
| Playwright: `moderation-decisions`, `moderation-console`, role matrix | 62 passed, 1 skipped                      |

The Playwright skip is the P-D-PREVIEW-CLOSED browser test, which needs the flags off, while a local stack has them on.
No moderation or sanction test is among the API or database skips.
TypeScript is clean in `apps/api`, `apps/web`, `apps/mobile`, `packages/api-client`, `packages/db`, `pact` and `playwright`.
ESLint is clean on every changed source and test file. All five `node-test-gate` suites pass.
The PR changes 99 files, under the limit of 100 with none to spare.

Measured on the final code:

- I-B-SCALE: a permanent ban with 2,000 related posts took 479 to 531 ms, with a peak of 2,006 advisory locks, far inside the 7-second transaction.
- I-B-REALTIME: a live socket received `denied` in about 2 seconds, inside the 8-second bound.

Known limits of this evidence:

- Nothing ran against a deployed preview. P-D-PREVIEW-CLOSED ran only on a local stack with TEST_ENV=preview and flipped flags, and its expected code is inferred from the 6.10 preview run. The PR's preview job is its first real run.
- I-C-DEADLOCK cannot force `40P01`. `community-privacy.spec.ts` proves that retry.
- S-2 was not run against P-D-ROLES. Its unit and integration tests went red.
- I-B-REALTIME proves the live denial for a temporary ban, and a permanent ban at the handshake.
- I-B-SEND-GUARD runs on real time, because its rows use the database clock.
- Test review finding 22 was declined: splitting files over 1,000 lines would add paths the file limit does not allow.

Defects these tests found and the builder fixed: F1 to F7 and F21 to F22 in the API and contract, F8 to F20 and G1 to G6 in the console and the banned page.

Outside this PR, for the coordinator:

- None remain: the owner ruling below moved the auth link fix, the `epic-6-context.md` update, the chip pills, the x=0 line and the factory emails into this PR.

---

### Fix round 1: independent review of `4cf4b128`

Codex found six defects that the plan's tests missed, and each now has a regression test that was red before its fix.
All six reproduced, including C2 on a real database, which the review had only traced.

| Finding | Red at `4cf4b128`                                                                    | Regression tests                                                                  |
| ------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| C1      | A resolve stamped a report the GET never displayed, on post and comment cases        | I-C-SPLIT-READ (2)                                                                |
| C2      | `[200, 200]` on reciprocal bans, on the first unforced round; an appeal did not wait | I-C-RECIPROCAL-BAN (3)                                                            |
| C3      | The sanction and its announcement stayed after sign-out, erasure and account switch  | "a change of identity while the notice shows" (4), "a probe still out" (3)        |
| C4      | A retry sent changed terms with a new id and no confirmation                         | C-WEB-D-CONFIRM "a retry once the confirmed terms have changed" (8 plus 2 guards) |
| C5      | The weekly challenge stayed beside a ban learned from the socket                     | "takes the weekly challenge and its Participate button with it"                   |
| C6      | Erasure during locking answered the legacy 404 with no closed code                   | I-C-ERASE-IN-FLIGHT (3)                                                           |

The first fix for C3 left the ban announcement in the live region, and a late socket probe could restore the notice; both were fixed in `82ea15b6`, with the probe red at `6687e258`.
The sign-out probe case passed before that fix, so it is a guard, shown able to fail by removing the `!active` check.
The full-tier rerun then caught F23: the C1 fix called `$transaction` directly, which `prisma-client.guard.spec.ts` refuses.

Three consecutive full runs at `5cbf216f`, with no failure, retry or flake:

| Suite                                                                 | Result on each of three runs              |
| --------------------------------------------------------------------- | ----------------------------------------- |
| `apps/api` whole tier, units and integration                          | 7887 passed, 28 skipped, 362 of 365 files |
| `packages/api-client`                                                 | 1580 passed                               |
| `packages/config`                                                     | 29 passed                                 |
| `packages/db`, RLS, constraints and backfill                          | 266 passed, 1 skipped                     |
| `apps/web`                                                            | 1825 passed                               |
| `apps/mobile`                                                         | 1905 passed                               |
| Pact consumer and provider                                            | 444 passed and verification passed        |
| Playwright: `moderation-decisions`, `moderation-console`, role matrix | 62 passed, 1 skipped                      |

TypeScript is clean in every workspace, ESLint is clean on the changed files, and all five `node-test-gate` suites pass.
The earlier limits still apply: nothing has run on a deployed preview.
One new limit: `couture:account-erased` has no dispatcher in `apps/` or `packages/`, so production may never reach the erasure path C3's erasure tests cover.

### Review round 2 on PR 195

R2-1: a realtime feed read still in flight when the ban lands restored the page, and the Participate challenge came back.
`community-banned-notice.test.tsx` holds that read across the ban cleanup in a new block, "a realtime rebuild still out when the ban lands".
Both cases went red at `1d49278a` and green with the fix in `10295495`.

A builder run failed once in the block "a change of identity while the notice shows" while the R2-1 test was being edited.
12 serial runs and 24 runs under four parallel processes passed all 33 cases, so no flake is recorded.

GitGuardian flagged the `Basic` header fixture in `moderation-decisions.controller.spec.ts`.
The value decoded to `mod:mod`, a made-up pair, and the fixture now reads `Basic abc`, as the queue spec does.
The old literal stays in commit `d4b420f4`, since no credential needs removing from history.

Burn-in failed 6.1-API-01 on `10295495`, missing `lookbook-1`, then 1 and 2, then 1 to 3, across three repeats.
Seven spotlight rows and five lookbook rows fill the feed's first page of 12 exactly, and P-D-ROLES left one published look per repeat.
P-D-ROLES now seeds a flagged look, and `moderation-decisions.spec.ts` and `moderation-console.spec.ts` withdraw theirs at teardown.
On a fresh seeded database, P-D-ROLES and 6.1-API-01 at `--repeat-each=3` passed 87 of 87 and left 12 published rows.
My sign-off ran only the moderation browser specs, which is why the three runs missed this.

Later fixes pinned in existing files: the `origin` field and the alias state enum, sanction kind against expiry, the takedown marker as a reason, decision order by sequence, the engine row without codes, a confirmation closed by changed terms, the appeal retry after an edited note, an open dialog closed by a ban, and a ban on a later spotlight page.

### No deferrals: owner ruling of 2026-11-04

The file limit no longer applies to PR 195, so the items below moved into it.

| Item                                         | Test                                                               | Proof                                                                   |
| :------------------------------------------- | :----------------------------------------------------------------- | :---------------------------------------------------------------------- |
| Teaser on screen when the feed refuses a ban | `home-spotlight-teaser.test.tsx`, TEA-22                           | Red with the layout passing the teaser through                          |
| 6.1-API-01 assumed a first page              | `community-feed.api.spec.ts` walks the feed                        | Status below                                                            |
| Permanent ban on a live socket               | I-B-REALTIME, `moderation-sanctions.integration.spec.ts`           | Red with the sanction read ignoring permanent bans                      |
| Factory emails collide                       | `packages/testing/test/user.factory.spec.ts`, 5000 distinct emails | Red on the faker email                                                  |
| Chip labels overrun their pills at 375       | 3.6-E2E-005                                                        | Red at 1.33 px right padding, green with `shrink-0`                     |
| Column 0 seam at odd widths                  | 3.6-E2E-006 at 375 and 393                                         | Red at a difference of 124 between columns, green with the margin bleed |

The seam came from `left-1/2 -translate-x-1/2` in `apps/web/src/app/page.tsx`, a transform of -187.5 px at 375.
Column 0 read 132 where its neighbours read 255, the half blend of the white lookbook and the dark page.

P-D-PREVIEW-CLOSED passed on the deployed preview in run 41854295529, so the local-only limit above no longer applies to it.
S-2 now also ran against P-D-ROLES: with the guard on the decide route only, 3 of the 6 role tests went red on the appeal route.
The I-C-DEADLOCK attempt limit mutation went red in `community-privacy.spec.ts`, as that row states.

### CR-2: content a ban held returns to screening

I-B-END-RESTORE and I-C-END-RESTORE pin the owner ruling on D8, with the sweep at `CommunityMaintenanceService.sweepExpiredBanHolds`.
All 18 went red on the missing method and passed with `6ee348f3`.
Every seeded defect went red for its own reason:

| Defect                              | Red test                                                  |
| :---------------------------------- | :-------------------------------------------------------- |
| No active ban check inside the lock | waits on the member eligibility lock                      |
| No eligibility lock                 | waits on the member eligibility lock                      |
| No subject guard                    | leaves content that erasure took                          |
| No marker filter on posts           | touches only rows held by that marker, and two others     |
| No marker filter on comments        | touches only rows held by that marker                     |
| No erasure filter                   | leaves a withdrawn post, leaves content that erasure took |
| Stale `updated_at`                  | gives a returned post a fresh stall clock                 |
| Post outbox not re-armed            | takes the returned content through real screening         |
| Comment outbox not re-armed         | takes the returned content through real screening         |
| Job id ignores the generation       | both queue tests                                          |

A re-armed comment waits out the outbox's 30-second pause before it dispatches, which the test states.

### Coordinator rulings on the left items

An overturn of any ban returns rows held only by its marker to screening, an upgraded temporary ban's rows included: `an overturn of a permanent ban` in I-B-END-RESTORE.
A member retracts their own comment on a hidden post with no reveal: `a member retracts their own comment on a hidden post (RG3)` in I-B-RETRACT.
A foreign comment, an unknown comment and an unknown post give one 404 there, and a read, a report and an erased comment stay closed.
`couture:account-erased` had no dispatcher in the web app, so the listeners and their tests went, and the photo draft cleanup moved to the sign-out path.

### Codex round 3

| Finding                                            | Test                                                       | Red at `9f8f6615`                                                          |
| :------------------------------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------------- |
| R3-1 An old dispatch settles a newer generation    | R3-1 in I-B-END-RESTORE, expiry and overturn               | Both red                                                                   |
| R3-2 Cleanup deletes a re-armed outbox row         | R3-2 in I-C-END-RESTORE, a real blocked delete             | Red                                                                        |
| R3-3 A ban during normalization removes the object | R3-3 in I-B-END-RESTORE, expiry and overturn               | Both red; erasure, anonymizing and withdrawal still remove the late object |
| R3-4 Mobile stays closed after a good refresh      | R3-4 in `availability-restore.cases.tsx`                   | See below                                                                  |
| R3-5 Generated 403 types reject both bodies        | `moderation-decisions-contract.spec.ts`, compiled by `tsc` | Four compile errors, and the `oneOf` test red                              |

Codex round 4: R4-1 is the P, ineligible overturn, sweep, passing screen, Q, overturn lifecycle.
R4-2 makes the rollback test assert the first sweep rejects.
R4-3 runs an ineligible permanent overturn through the fallback sweep and checks statuses, markers, outboxes and the hold-release stamp.

### Codex round 5

Returning content to pending made old screening work look current, because only the job id carried the generation.
The fix makes generation ownership explicit, so these tests pin the result on real databases.

| Finding                                                   | Test                                                                                   | Red at `391c8828`                                |
| :-------------------------------------------------------- | :------------------------------------------------------------------------------------- | :----------------------------------------------- |
| R5-1 A late upload removes a newer generation's image     | Round 5 in I-B-END-RESTORE                                                             | Red: image gone                                  |
| R5-2 An old final failure takes the new generation        | Round 5 in I-B-END-RESTORE                                                             | Red: `review_failed`                             |
| An old passing verdict publishes over the new generation  | Round 5 in I-B-END-RESTORE                                                             | Red: published                                   |
| A job with the old payload shape screens a recovered post | Round 5 in I-B-END-RESTORE                                                             | Red: published                                   |
| R5-3 A stale post sweep held across recovery              | R5-3 in I-C-END-RESTORE, a real blocked update                                         | Red: `review_failed`                             |
| R5-4 Real 403 bodies against the published 403            | R5-4 in `moderation-sanctions.integration.spec.ts`, real requests against the document | Red on comments, replies and comment-submissions |

The comment path was already fenced on generation, so its verdict, final failure and stale tests passed before the fix and stay as guards.
An old `block` verdict on a post also passed before the fix.
R5-4 first reported a missing 403 on the publish route, which was a bug in my route matcher: `/posts/publish` matched the `/posts/{postId}` template.

The full API tier passes at the round 5 source: 7988 passed, 28 skipped.

Reading the full diff found one more: an upload that landed before recovery left normalized bytes against the original checksum, so generation 1 failed the post.
A crash in the same window would fail a retry the same way, which predates this story.
Builder fixed it with a pending declaration recorded before the write, in `02c8c35e`, and `R5-1 an upload that landed before recovery` went red at `32a03b73` and passes on it.
`the pending declaration around an object write` pins a worker lost before the write, a worker lost after it, bytes matching neither declaration, and no second encode by a later generation.

### Codex round 6

R6-1 adds Codex's exact schedule: the old worker is past its check and paused before writing, recovery runs, the old upload finishes, and only then does the current worker start.
R6-2: the old block verdict test threw a TypeError on a mis-shaped engine result, and a `.catch(() => undefined)` on the call under test hid it, so it never reached the fence.
It now uses a real fixture engine with a flagged verdict, requires the old process to resolve, and requires the new generation to complete.
That catch pattern is gone from every call under test in the moderation suites, and the callers state whether old work resolves or rejects.
R6-3 runs an existing report through the fallback sweep to a second ban before screening finishes, and the response, replay and detail revision must agree.

Every seeded defect now goes red on top of R6-3, which is red without its source fix:

| Defect                                    | Further tests red                                                             |
| :---------------------------------------- | :---------------------------------------------------------------------------- |
| `flagPost` ownership check removed        | 1, the old flag verdict                                                       |
| Pending column trusted with no hash match | 1, which now requires `IMAGE_CHECKSUM_MISMATCH` on bytes of the declared size |
| `image_normalized_at` branch skipped      | 1, on a noisy JPEG the test proves is not idempotent                          |
| No reservation before the write           | 5                                                                             |

Both defects that survived the first image tests die here.

### Codex round 7

R7-1 in I-B-END-RESTORE runs reserve, complete erasure, late write, lost worker, retry and sweep.
It went red at `8f9b3945`: the late write survived with the path already null.
It also pins the obligation staying open until the 6-hour window ends, a failed final delete counted overdue past 72 hours, and the kept path absent from the queue, the case detail, the feed, the post read and the author's own states.
R7-3 counts encoder calls on `sharp.prototype.toFormat`: one to normalize, none on a pending or normalized retry.
A type or size out of range still fails with a hash matching pending.
Logs and share cards have no test for the kept path: the erasure log records only the post id, and a share card needs a published post.
R7-2 is a rollout precondition builder records, with no test here.

Seeded defects at `0eca2d75`, each run against the R7 tests in a throwaway worktree:

| Seeded defect                         | Red tests                                                  |
| :------------------------------------ | :--------------------------------------------------------- |
| Author state read signs the kept path | 1: never shows the kept path                               |
| Late-write window of zero             | 4, among them the window and the full reserve-to-sweep run |
| Validation encodes again              | 1: encodes once, and not on a retry                        |

### Codex round 8

R8-1 lives in `community-storage-capability.integration.spec.ts`, run by `npm run test:community-storage -w apps/api` in the real-session job, the one with local Supabase.
It uses the real adapter, real local Storage v1.32.0 and a real migrated Postgres.
Local Storage mints a fixed 2 hour token and ignores a requested expiry.
So expiry cases re-sign a token storage really minted, changing only its times, and a control with a future expiry must pass.
Sweeps take an injected clock, so 6 hours and 73 hours pass without a real wait.

| Probe on local Storage                 | Result                                                                 |
| :------------------------------------- | :--------------------------------------------------------------------- |
| Expired token, through Kong and direct | 400 InvalidJWT, nothing written                                        |
| Token for another path                 | 400 InvalidSignature, nothing written                                  |
| Upsert token used twice                | Overwrites                                                             |
| Same token after a delete              | Recreates the object, which is why the final delete waits              |
| 8 s body on a 3 s token, through Kong  | Refused: Kong buffers, and Storage checks on arrival                   |
| Same slow body, direct to port 5000    | 200, written after expiry: Storage checks once at request start        |
| 70 s gap inside the body, through Kong | Connection closed, nothing written                                     |
| 320 s gaps, direct to port 5000        | 200 after 640 s, written after expiry: Storage sets no request timeout |

The 6 hour window therefore rests on the gateway for a stalled request: 2 hours of token lifetime and 4 hours of margin.
Not exercised: hosted Supabase, its gateway, and a real 2 hour wait.
The adapter failing closed on a token above 2 hours is unit tested, because local Storage cannot mint one.

R8-2 has a noisy 512 by 640 JPEG cut to a quarter, half and 98 percent, each with a readable header and a matching declaration.
Each returns IMAGE_DECODE_FAILED with no call to `toFormat`, `jpeg`, `png` or `webp`.

The late client upload runs in the same suite: past the old 15 minute sweep point the row stays, the client's real token writes, erasure removes the object, and a second write inside the window goes at the final delete.
With no erasure the draft and its object go once the token is dead, and a replay renewal keeps the row for the token it mints.
Publish refusal past the 15 minute expiry stays pinned by the two boundary tests in `community.service.publishing.spec.ts`.

Seeded defects at `61d635c6`, in a throwaway worktree, with the real suite 10 of 10 green as the control:

| Seeded defect                               | Red tests                                                        |
| :------------------------------------------ | :--------------------------------------------------------------- |
| Source at `0eca2d75`, service-role upload   | 8, among them the full schedule                                  |
| Adapter uploads with service role           | 3: expired token, path binding, full schedule                    |
| Overwrite token without upsert              | 4                                                                |
| Window shorter than the token, 1 hour       | 1: the numbers test, since the schedule runs on a 2 second token |
| Sweep eligibility back to the client expiry | 1: the late client upload                                        |
| Renewal ignores erasure                     | 1                                                                |
| Mint after the reservation                  | 1: the mint order pin                                            |
| No full decode                              | 3: every truncated fixture                                       |
| Decode by encoding                          | 4                                                                |
| Replay does not renew                       | 2                                                                |
| Replay mints for an erased row              | 1                                                                |

At `f8370db3` a full run left the Playwright database at 12 published rows after the moderation browser specs, which proves their teardown.
That first full run also showed I wiped my own databases: `migrate-db.cjs` creates them empty, so the database tier and three API suites failed until `prisma migrate deploy` ran.
Those failures were my setup, and the rerun below is the evidence.

---

## Quality Gate Criteria

### Pass/Fail Thresholds

- P0: 100 percent pass.
- P1: 95 percent pass at merge, every failure triaged.
- Flake: zero tolerated. A race test that flakes is a harness defect and blocks merge.
- All fourteen seeded-defect proofs recorded.
- High-risk mitigations complete before the PR leaves review.

### Coverage Targets

- Every acceptance criterion (E1 to E3, S1 to S10) maps to at least one P0 or P1 test (see Traceability).
- Every closed code and detail in the contract has a test that produces it from real state.
- Every community route has a row in the ban matrix.
- NFR status stays with `bmad-tea-nfr`, which reads the evidence named above once it exists.

### Non-Negotiable Requirements

- No moderator identity from a request.
- No reason outside the decision record, the prior-action rows and the operator's own console.
- One decision per serialized read, and one transaction per decision.
- `firstDecisionAt` and a stamped `resolved_at` never move.
- A ban survives every flag and consent change, and cuts nothing outside community.

---

## Traceability

| Criterion | Statement                                                                                                    | Tests                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1 / S1   | Five actions through the contract and operator service, reason, session identity, one audit and decision row | U-D-CONTRACT-STRICT, U-D-REASON, U-D-ALLOWED-RULES, U-D-CTRL-IDENTITY, U-D-SVC-PRECEDENCE, I-D-RESOLVE-GROUP, -RELEASE-POST, -RELEASE-COMMENT, -TAKEDOWN-POST, -TAKEDOWN-COMMENT, -ESCALATE, -AUDIT-SHAPE, -SELF-REVIEW, I-S-LOOP, P-D-JOURNEY |
| S2        | Unauthorized and direct database callers, identical 403, flag hidden                                         | U-D-CTRL-ROLES, -ORDER, -NO-ORACLE, -HEADERS, I-D-HTTP, D-RLS-DENIED, D-RLS-AUDIT, P-D-ROLES, P-D-PREVIEW-CLOSED                                                                                                                               |
| E2 / S3   | Exactly one conflicting review applies                                                                       | U-D-REVISION, I-C-CONFLICT, -REPORT-RACE, -WITHDRAW-RACE, -BAN-RACE, -DB-BACKSTOP, D-CONSTRAINTS, P-D-CONFLICT                                                                                                                                 |
| E2 / S4   | Idempotent retry                                                                                             | U-D-SVC-HASH, -STORED-RESPONSE, I-C-RETRY, -RETRY-MOVED, -KEY-REUSE, -KEY-SCOPE, -REPLAY-RACE, C-WEB-D-MUTATION, P-D-OFFLINE-RETRY                                                                                                             |
| E2 / S5   | First decision time and `resolved_at` hold                                                                   | U-D-SVC-CLOCK, -INSERT-ONLY, I-C-FIRST-DECISION, -FIRST-ESCALATE, -RESOLVED-AT, -REKEY, I-A-FIRST-UNMOVED                                                                                                                                      |
| E2 / S6   | Public caches invalidated with no worker; Redis outage                                                       | U-D-SVC-POSTCOMMIT, I-K-TAKEDOWN-READS, -BAN-EPOCH, -REDIS-DOWN, -OVERTURN, -REPLAY-RERUN, -NO-PUBLIC, -COMMENT-STREAM, P-D-TAKEDOWN-PUBLIC                                                                                                    |
| E3 / S7   | Ban effects on sessions, engagement, reads, content, appeals                                                 | U-B-ACTIVE, -BODY, -ROUTE-MATRIX, U-A-TRANSITIONS, I-B-\*, I-A-\*, U-MOB-D-DENIED, P-D-BAN-JOURNEY, P-D-APPEAL                                                                                                                                 |
| E3 / S8   | Localized outcomes in ten locales, announced once, reason kept                                               | U-WEB-D-CLIENT, -LOCALES, C-WEB-D-STATES, -KEEP-REASON, -ANNOUNCE, -PANEL, -CONFIRM, -BANNED-NOTICE, -STANDING, P-D-LOCALE                                                                                                                     |
| S9        | Every state renders, focus order, axe                                                                        | C-WEB-D-A11Y, -HOSTILE, P-D-AXE, P-D-KEYBOARD, P-D-THEMES-WIDTHS, X-D-PIXEL                                                                                                                                                                    |
| S10       | Under 100 files, jobs under 20 minutes                                                                       | D-HYGIENE, V-D-BUDGET                                                                                                                                                                                                                          |

Attributed audit (E3) is carried by I-D-AUDIT-SHAPE, I-D-PRIOR-ACTIONS and D-RLS-AUDIT, and screening intake (D11, PRD line 227) by U-S-FLAG-REPORT, I-S-INTAKE, I-S-LOOP, I-S-IDENTITY and D-BACKFILL.

### Gap status

No uncovered criterion.
Every planned P0 and P1 scenario has a test that passed three consecutive runs at `3a23e2cc`, except the one local skip named under Execution results.
The criteria rows above list executed tests.

---

## Mitigation Plans

### R-003 Serialization (9)

Hold to the TEA-01 order and take the revision read after the post row lock, so report intake and the decision cannot interleave.
The stamped report ids come from that same read.
I-C-REPORT-RACE proves it with a held lock and a `pg_locks` check, so the test has one possible interleaving.

### R-008 Enforcement bypass (9)

Enforcement lives in one function with a named list of direct call sites.
U-B-ROUTE-MATRIX reflects over the three controllers, so a new handler fails the test until someone decides its row.
I-B-ROUTES then proves each row on the real stack, reaction replay included.

### R-010 Republish after consent lapse (9)

The overturn splits in two: the sanction update always commits, and the restore runs only after `assertCommunityDatabaseAccess` passes under the subject guard.
Restoration matches `community_ban:<sanctionId>` exactly, and the reason constraint from TEA-03 keeps operators from producing that string.

### R-001 and R-002 Authorization (6)

Same guard pair as the 6.10 controllers, and one conflict function shared by the read path, the decision path and the appeal route.
The role matrix is a table, so a new role in `API_ROLES` forces a decision.

### R-004 Idempotency (6)

The check runs first in the transaction and the hash is canonical.
A key violation from a true race re-reads in a fresh transaction, because Postgres aborted the first one.

### R-005 First decision (6)

Nothing stores `firstDecisionAt`, so nothing can overwrite it.
The stamp predicate is `resolved_at IS NULL`, and the property test runs both across random sequences.

### R-006 Atomicity (6)

No after-commit write carries record data.
Everything after commit is cache work that a replay can repeat.

### R-007 Reason privacy (6)

`AuditLog` receives an allowlisted `event_data` object built in one function, and tests scan the whole row as text.

### R-009 Over-reach (6)

Enforcement sits in community access functions only, and I-B-NONCOMMUNITY checks both responses and row checksums.

### R-011 Content effects (6)

The TEA-05 table is the single source for statuses, and I-B-PENDING runs the real processors after the hold.

### R-012 Caches (6)

Three layers: the trigger records the invalidation in the transaction, the request bumps and assists after commit, and `currentSnapshot` rechecks visibility on every read.
I-K-REDIS-DOWN removes the second layer and proves the third.

### R-013 Findings (6)

SQL and TypeScript predicates change together, and I-S-FINDING-PARITY compares them on real rows.

---

## Assumptions and Dependencies

### Assumptions

- RG1: A signed image URL issued before a decision lives up to 900 seconds (D12). No test tries to shorten it.
- RG2: Content held by a ban that never published stays held after expiry and after an overturn, and has no case, so no operator can release it. The author can still withdraw or delete it. A later story can add a resubmission path.
- RG3: Comment delete keeps the existing visible-post rule, so a member cannot delete a comment on a hidden post. Withdrawing the member's own post is unaffected. This matches every other member today.
- RG4: Author delete nulls the body of a `blocked` comment. A member report's `content_snapshot` keeps the evidence and a screening report has none. CC-6.13 owns evidence retention.
- RG5: The Playwright flags stay at the seeded value. The disabled-state proof uses a routed 503 in the browser and the real flag in API integration.
- RG6: A post's machine reason is overwritten by the ban marker and comes back null on restore. The `ModerationEvent` trail keeps it, and the post loses its risk step if a later report opens a case.
- RG7: `firstDecisionAt` uses app-server time, so clock skew between instances can reorder two decisions by a few milliseconds. The minimum stays a real decision time.
- RG8: A `review_failed` post is outside the hold list. If a retry worker re-drives it during a ban, the existing `ForbiddenException` branch moves it to `consent_suspended` and publishes nothing. I-B-PENDING pins the safe outcome.
- RG9: `CommunityStreamRepository.assist` claims for one second, so a second decision inside that second appends nothing and still reports `completed`. Its event waits for the next assist, which a connected socket's own tick supplies, and the durable cursor covers the rest. No connected client means nobody is waiting.

### Dependencies

- `@couture/testing` factories, `seedModerationQueue`, `community-spotlight-context.ts`, `community-comments-context.ts`.
- `@seontechnologies/playwright-utils` and `@seontechnologies/pactjs-utils`, already installed.
- CC-1.4 `AuditLog` and its immutability triggers, CC-6.5 realtime and the privacy guards, CC-6.10 queue and console.

### Risks to Plan

- Race tests depend on `pg_locks` visibility, which needs the same database role as the harness. The local stack allows it.
- Shared databases make flag toggling a cross-test hazard. See RG5.
- Ten locale files and the API test files dominate the file count. The spec's split rule applies at 90 files.

---

## Interworking and Regression

- `POST /api/v1/moderation/actions` keeps its contract, role check and analytics event (U-D-CTRL-ACTIONS-KEPT).
- `releaseFlaggedPost`, `takeDownPublishedPost` and `resolveReport` keep signature and behavior (I-D-ACTIONS-COMPAT).
- `community_read_enabled` semantics stay untouched, and enforcement has no flag (I-B-FLAG-OFF).
- Every 6.10 spec stays green. `I-Q-READONLY` and `C-WEB-Q-DETAIL-ONE-READ` keep their rules, and `C-WEB-Q-NO-ACTIONS` is retired because this story adds the controls: C-WEB-D-PANEL replaces it.
- `U-Q-SVC-PRIOR-ACTIONS` and `I-Q-DETAIL` change for the `screening` actor kind (D11), and the change is deliberate.
- `I-Q-ORDER` asserts a flagged post with no report is absent: it stays true, since a flagged post now gains a report at flag time, and its fixture must seed the flagged row directly.

## Follow-on Workflows (Manual)

- After the build: `bmad-tea-test-review` on the new specs (flake, determinism, fixtures).
- Before the release gate: `bmad-tea-trace` for the traceability matrix and gate decision.
- For 6.12 and 6.13: reuse `seedDecisionCases`, the `escalate` rows and the insert-only scan.
