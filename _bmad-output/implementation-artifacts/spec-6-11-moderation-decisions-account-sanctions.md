---
title: 'CC-6.11 Moderation decisions and account sanctions'
type: 'feature'
created: '2026-11-04'
status: 'done'
review: 'none'
review_source: 'coordinator: TEA per commit, Codex after handoff'
lenses_ran: []
baseline_commit: '6337dc8cbe5fdae4fe9a8f35f05798031293da36'
baseline_revision: '6337dc8cbe5fdae4fe9a8f35f05798031293da36'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-10-moderator-queue-case-detail.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-06.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A moderator can read every case since 6.10 and can change none of them.
`CommunityModerationActionsService` has no HTTP path, covers post reports only, and has no callers outside one Playwright helper.
Comment cases have no operator action, posts the screener flagged never reach the queue, and no account can be sanctioned, so repeat abuse has no consequence.

**Approach:** Add one moderator-only write route that applies a decision to a whole case in one transaction: resolve, release, takedown, escalate or ban.
Extend the existing operator service for the content effects, add an append-only `ModerationDecision` record and a `CommunitySanction` record, and enforce an active ban at the existing community access boundary.
Add the decision panel to the 6.10 console and a localized banned notice to the web community page.
The route sits behind a new flag that is off in production.

Decisions (coordinator delegated planning, owner unavailable, 2026-11-04):

- D1 Route and contract.
  - `POST /api/v1/moderation/cases/:caseId/decisions` applies a decision. `POST /api/v1/moderation/sanctions/:sanctionId/appeal` records an appeal step. Both answer `Cache-Control: private, no-store`.
  - The decision body is a strict discriminated union on `action`, with `reason`, `mutationId` (UUID) and `expectedRevision` on every arm. The `ban` arm adds `ban: {kind:'temporary', durationDays:1|7|30|90} | {kind:'permanent'}`.
  - The body has no moderator field. A body with `moderatorId` or any other unknown key is a 400 `invalid_decision`.
  - `reason` is required plain text, trimmed, 3 to 1000 characters. It never enters a log, `AuditLog`, analytics or an error body.
  - `POST /api/v1/moderation/actions` stays exactly as it is. It is analytics only, no client calls it, and it is not a decision path.
- D2 Authorization and identity.
  - `RequestAuthGuard` plus `RolesGuard` with `@Roles('moderator', 'admin')`. Check order is bearer, role, flags, input, so a non-moderator learns nothing about flags or cases.
  - The moderator id and role come from `auth` only.
  - Role matrix: moderator and admin may resolve, release, takedown, escalate, apply a temporary ban and record `requested` on an appeal. Admin only may apply a permanent ban, record an appeal outcome, or apply a terminal decision to an escalated case. A moderator attempt is 403 `admin_required`.
  - `viewerConflict` from 6.10 is enforced here: the author of the target or anyone who filed a report on it, admins included, gets 403 `self_review_refused` for every action.
  - An operator with an active sanction gets 403 `operator_sanctioned`.
  - The subject's own operator role is invisible to the API, because roles live in Supabase `app_metadata`. A ban on an operator's account is allowed and audited, and it closes their community access only.
- D3 Flag. `moderation_decisions_enabled`, default false, seed true. Both it and `moderation_console_enabled` must be on, evaluated per moderator after the role check, and any flag read failure closes the route with 503 `moderation_decisions_disabled`. A flag off never lifts a ban: enforcement in D9 has no flag.
- D4 Action semantics. Availability follows current state, so a resolved case can still be taken down or banned on new evidence.

  | Action     | Available when                                                                                                                                                                                       | Target effect                                                                                             | Open reports | Terminal |
  | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------ | -------- |
  | `resolve`  | The case has an open report                                                                                                                                                                          | None. A held target stays held, which is how a moderator upholds a screening verdict                      | Stamped      | Yes      |
  | `release`  | Post is `flagged`, or comment is `held_for_review`, `blocked` or `screening_failed`; target live; author eligible under `assertCommunityDatabaseAccess`; `community_write_enabled` on for the author | Post becomes `published`, comment becomes `published` with a publication sequence kept or newly allocated | Stamped      | Yes      |
  | `takedown` | Target is `published`                                                                                                                                                                                | Post becomes `flagged` (existing rule), comment becomes `blocked` with its body kept as evidence          | Stamped      | Yes      |
  | `escalate` | The case has an open report and is not currently escalated                                                                                                                                           | None                                                                                                      | Unchanged    | No       |
  | `ban`      | Target is live with a known author; author has no active ban, or has an active temporary ban and the request is permanent                                                                            | Sanction per D8, and the target is taken down when `published`                                            | Stamped      | Yes      |
  - An unavailable action is 409 `action_not_applicable` with a closed `detail`: `no_open_reports`, `target_not_held`, `target_not_published`, `already_escalated`, `target_erased`, `subject_banned`, `already_banned`, `author_ineligible`, `community_writes_closed`.
  - A case is escalated while its newest `escalate` decision is newer than its newest terminal decision. Escalation changes no SLA value, ordering or filter.
  - The detail returns `allowedActions` and `banKinds` computed for the viewer by one function, the same function the decision path enforces. Conflict, an escalated case for a moderator, or flags off give an empty list.

- D5 Serialization.
  - The detail returns an opaque `revision`: the first 16 hex characters of a SHA-256 over the case's newest decision sequence, its sorted open report ids and the target status. A new report, an author withdrawal or another decision therefore all move it.
  - The transaction takes `pg_advisory_xact_lock(hashtext('moderation_case:' || caseKey))` first, then the idempotency check, then recomputes the revision. A mismatch is 409 `case_conflict` with `currentRevision`, and no write happens.
  - `UNIQUE (case_key, sequence)` is the database backstop. A violation maps to the same 409.
  - A case whose target was erased re-keys per 6.10 D1 and answers 404 `case_not_found`, and the console shows the 6.10 not-found state.
  - Lock order after the case lock: `guardCommunitySubject` for `ban` and appeal outcomes, otherwise `guardCommunityPost`, then the `community_member` advisory lock, then the post row `FOR UPDATE`. A comment case locks its parent post, which is what comment report intake locks.
  - The transaction uses `communityPrivacyTransaction` (READ COMMITTED, retries on 40001, 40P01, 55P03).
- D6 Idempotency.
  - `UNIQUE (moderator_id, mutation_id)` with a `payload_hash`. The idempotency check runs before the revision check and before case resolution, so a retry succeeds after the case moved or re-keyed.
  - The same id and payload returns the stored response with `replayed:true` and writes nothing.
  - The same id with a different payload is 409 `idempotency_mismatch`.
  - The stored response holds no signed URL and no reason.
- D7 First effective decision and the record.
  - `ModerationDecision` is the source of truth: `id`, `case_key`, `sequence`, `source`, `post_id?`, `comment_id?` (both SetNull), `report_ids text[]` (GIN index), `action`, `reason`, `moderator_id?` (SetNull), `moderator_role`, `subject_user_id?` (SetNull), `subject_alias?`, `mutation_id`, `payload_hash`, `response jsonb`, `is_terminal`, `decided_at`.
  - `firstDecisionAt` is the smallest `decided_at` of a terminal decision whose `case_key` matches or whose `report_ids` overlap the case's reports. It is derived from rows that no code path updates, so a retry, a later decision or a re-key cannot move it.
  - `escalate`, refused requests and replays never set it, so an escalation cannot make a late resolution look punctual.
  - `resolved_at` is only ever stamped where it is null, for every open report of the case, with one `decided_at` read after the case lock.
  - No code path updates or deletes a decision row. The database enforcement is CC-6.13.
- D8 Ban effects.

  | Effect           | Temporary (1, 7, 30 or 90 days)                                                                                                                                                                                                        | Permanent (admin)                                                                                                   |
  | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
  | Sessions         | The member stays signed in for wardrobe, ritual, billing and privacy routes. Community authorization fails on the next request, and a live realtime socket receives `denied` at its next revalidation, which runs every 4 to 6 seconds | Same                                                                                                                |
  | New engagement   | Post allocation and publication, comment, reaction, report and share-card export are refused with 403 `community_banned`. Push sends stop through the existing send guard                                                              | Same                                                                                                                |
  | Community reads  | Feed, comments, spotlight and home teaser are refused with the same 403                                                                                                                                                                | Same                                                                                                                |
  | Existing content | The case target is taken down. Other published content stays. Unpublished `pending_review` posts and `pending_screening` comments are held with a ban marker                                                                           | Every `published` or pending post and comment is hidden with a ban marker, and the member's reactions are withdrawn |
  | End              | Ends by itself at `expires_at`, checked per request with no worker. Content the ban held stays held                                                                                                                                    | Ends only by an overturned appeal                                                                                   |
  | Appeal status    | Starts `not_requested`. A step is refused once the ban expired                                                                                                                                                                         | Starts `not_requested`                                                                                              |
  - Rejected: a whole-account lock. It would cut a paying member off paid features and privacy rights, and Supabase offers no revoke-by-user-id for another member's sessions. `UserSessionService.invalidateUserSessions`, today an empty boundary, is still called after commit, so a future session store is covered.
  - Rejected: `community_forget_subject(member, false)` on a ban. It deletes `PushToken` rows, which silently ends weather alerts for a member who only lost community access.
  - Rejected: `preferences.compliance.accountStatus` as the ban store. `GuardianConsentStateService` blocks every teen request on it, and consent flows overwrite it to `active`.
  - The ban marker is `community_ban:<sanctionId>` in `LookbookPost.moderation_reason` or `CommunityComment.screening_reason`. It never leaves the API, the queue never shows it as `operatorNote`, and it is not a finding.
  - Withdrawing one's own post and deleting one's own comment stay open during a ban, because retraction is the author's right. Both are API paths the closed community page does not reach, and the notice directs the member to support.
  - Hiding a root comment hides its replies, because the thread read needs a visible root. The replies keep their own status and return when the root does.

- D9 Enforcement point. `assertCommunityMemberNotSanctioned(tx, member)` reads `CommunitySanction` from the primary database with no cache.
  - It runs inside `assertCommunityDatabaseReadAccess`, which covers `authorize`, read eligibility, realtime, send guard, share cards, publication and both processors.
  - It is added directly where those paths are bypassed: comment create and report (`CommunityCommentsRepository`), reaction set and remove (`CommunityService.setReaction`) and post report (`CommunityService.reportPost`).
  - The refusal is a `ForbiddenException` with `{statusCode:403, code:'community_banned', message, sanction:{kind, expiresAt, appealStatus}}`. It holds no reason, moderator or case.
  - Both processors already convert a `ForbiddenException` at publication into `consent_suspended`. The ban transaction moves pending content first under the member lock, so the processors match zero rows for it.
- D10 Appeal status. `not_requested`, then `requested`, then `upheld` or `overturned`.
  - Steps are operator-recorded on the appeal route with a required reason and `mutationId`. Any other transition is 409 `appeal_transition_invalid`. An unknown id is 404 `sanction_not_found`.
  - `overturned` sets `lifted_at`, ends the ban immediately and restores content carrying that sanction's marker whose `published_at` is set. Reactions stay withdrawn. A taken-down case target carries the operator's reason, stays down, and can be released from its case.
  - Member self-service appeal intake is not in this story. The banned notice names the state and directs the member to support.
- D11 Screening intake, resolving the seam in 6.10 D2. A release needs a case, and PRD line 227 says moderation queues flagged posts.
  - `CommunityModerationProcessor.flagPost` writes a `CommunityPostReport` with null `reporter_id`, reason `inappropriate_content`, the snapshot, the object path and a 24-hour `sla_due_at`, in the transaction that flags the post. This matches what `CommunityCommentsProcessor.intake` already does for comments.
  - No third queue source and no case id kind are added, and the 6.10 queue SQL is unchanged.
  - New column `origin CommunityReportOrigin @default(member)` on both report tables. The migration backfills `screening` on comment reports whose audit row is a screening action, and inserts a screening report for each `flagged` post with a `flagged` `ModerationEvent` and no report, due 24 hours after that event.
  - A screening report reads as identity state `screening` and an erased reporter keeps `erased`. A screening audit row reads as actor kind `screening`, where 6.10 labelled it `operator`.
  - `review_failed` posts stay with the retry workers.
- D12 Public caches. The inventory at this commit is the spotlight Redis read model. Feed, comment and teaser reads are `private, no-store` and query the primary.
  - The existing triggers record `post.removed` and `comment.removed` in the decision transaction.
  - After commit, the request bumps the affected spotlight areas (the epoch for a permanent ban or an overturned appeal) and calls `CommunityStreamRepository.assist()`, each in a bounded, non-throwing step, so connected clients and the next read see the change with no worker running.
  - The response carries `cacheInvalidation: 'completed' | 'deferred'`. On `deferred` the decision stands, the durable stream cursor replays the bump, and `currentSnapshot` already rebuilds any snapshot holding a hidden post.
  - Known bound: a signed image URL issued before the decision lives up to its 900-second feed lifetime. No new URL is signed.
- D13 Attributed audit.
  - Inside the transaction: one `ModerationDecision`, one `AuditLog` row (`event_type` `moderation_decision_applied` or `moderation_appeal_recorded`, `user_id` the moderator, `event_data {decisionId, caseId, action, role, banKind?}`), and the prior-action rows: `ModerationEvent` for post cases (`released_by_operator`, `taken_down_by_operator`, `report_resolved`, plus new `escalated_by_operator` and `banned_by_operator`) and `CommunityCommentAudit` per affected report for comment cases.
  - An insert failure rolls everything back and answers 503 `audit_unavailable`, including a moderator id with no `User` row.
  - `AuditLog` is immutable and outlives erasure, so its `event_data` never holds a subject id, an alias or the reason. `ModerationDecision` holds those and is the row CC-6.13 anonymizes.
  - Orphan-post cases read prior actions from `ModerationDecision`, because their `ModerationEvent` rows have lost `post_id`.
- D14 Author-side privacy. `CommunityService.buildAuthorStates` sends `post.moderation_reason` to the author today, which would expose an operator's words and the ban marker. It passes the value only when `communityModerationReasonCategories` recognizes it, and sends null otherwise.
- D15 Console, added to the 6.10 detail view.
  - One decision panel renders only `allowedActions`, a required reason with a live character count, ban kind and duration when `ban` is chosen, and an in-page confirmation for `takedown` and `ban`. No browser dialog.
  - A `mutationId` is minted per intent and reused on every retry of the same payload.
  - States: idle, submitting, applied (polite announcement of the localized outcome, then one detail reload), conflict (keeps the typed reason, offers reload), not applicable, forbidden, admin required, self-review, disabled, audit unavailable, offline retry, cache deferred.
  - The detail shows `firstDecisionAt`, the escalated marker and an account standing section (sanction, expiry, appeal status, prior ban count, appeal controls). The queue row shows the escalated marker.
  - The web community page renders a localized banned notice from the 403 body. Mobile treats `community_banned` as its existing denied state and adds no strings: the 20 mobile catalog files would break the file budget, and CC-6.11's AC asks for localized operator outcomes. Mobile banned copy is a named follow-up.
  - Light and dark, desktop and mobile widths, WCAG 2.2 AA, 44-pixel targets, visible focus.
- D16 One PR under 100 changed files, generated files included. The budget table in Design Notes is the plan.

## Boundaries & Constraints

**Always:**

- One decision is one transaction: target change, every report stamp, sanction, decision row, prior-action rows and audit row commit together or not at all.
- Contracts start as strict shared Zod schemas in `packages/api-client/src/contracts/http/moderation-decisions.ts`. Controller, OpenAPI, generated SDK and web client derive from them.
- Errors use the existing Nest bodies plus a closed `code`.
- The existing methods `releaseFlaggedPost`, `takeDownPublishedPost` and `resolveReport` keep their signatures and behavior, because `playwright/support/helpers/community-engagement.ts` calls one. New logic composes transaction-scoped forms they share.
- `ModerationDecision` and `CommunitySanction` are API-only: RLS enabled, zero policies, zero grants, covered by the RLS suite through `MODERATION_QUEUE_READ_TABLES`.
- A sanction row cascades with its `User`, and decision rows keep only `subject_alias` after erasure.
- Every user-authored string in the console renders through `PlainText`.
- All ten web locales, catalog parity, and a localized label for every action, outcome, error, detail code, sanction kind and appeal status.
- Machine time comes from one injected clock, read once after the case lock for `decided_at` and `expires_at`.

**Never:**

- SLA timers, alerts or escalation delivery. `escalate` records the decision and notifies nobody. That is CC-6.12.
- A database-level append-only trigger, retention change, anonymization change or evidence export. That is CC-6.13.
- Member self-service appeal, guardian or member email about a sanction, ban-evasion detection, or a mobile moderator surface.
- A moderator identity taken from a body, query or header.
- A decision read or write from a Supabase client, an RLS policy or a Next.js server action.
- Changes to `POST /api/v1/moderation/actions`, `community_read_enabled` semantics, production flag values, or `bmad/`.
- A browser `alert`, `confirm` or `prompt`.

## I/O & Edge-Case Matrix

| Scenario                   | Input / State                                                                    | Expected Output / Behavior                                                                                                    | Error Handling                        |
| -------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Resolve grouped post       | Three open reports, moderator resolves                                           | All three stamped with one time, target unchanged, one decision, three `report_resolved` events, one audit row                | N/A                                   |
| Resolve orphan             | `orphan-post.<id>` open                                                          | Report stamped; no target effect                                                                                              | N/A                                   |
| Release screener flag      | Flagged post with its screening report                                           | Post published, original `published_at` kept if any, engine version kept, report stamped                                      | N/A                                   |
| Release held comment       | `held_for_review`, first publication                                             | `published`, next sequence allocated, engagement recorded once, report stamped                                                | N/A                                   |
| Release, writes closed     | `community_write_enabled` off for the author                                     | 409 `action_not_applicable`, `community_writes_closed`                                                                        | Nothing written                       |
| Takedown post              | Published post                                                                   | `flagged`, `post.removed` recorded, spotlight bumped, open reports stamped, erasure clock untouched                           | N/A                                   |
| Takedown comment           | Published comment on a visible post                                              | `blocked`, body kept, gone from the thread and from the public count, `comment.removed` recorded                              | N/A                                   |
| Takedown twice             | Second decision after the first, with the new revision                           | 409 `action_not_applicable`, `target_not_published`                                                                           | First timestamp unchanged             |
| Concurrent conflict        | Two moderators, same revision, different actions                                 | One 200, one 409 `case_conflict` with `currentRevision`                                                                       | One decision row at that sequence     |
| New report during review   | A report lands between read and submit                                           | 409 `case_conflict`; the reload shows the new report                                                                          | N/A                                   |
| Network retry              | Same `mutationId` and payload, response lost                                     | 200 stored response, `replayed:true`, no new row, timestamps unchanged                                                        | N/A                                   |
| Retry after a move         | Same `mutationId` after another decision or a re-key                             | 200 stored response                                                                                                           | Idempotency precedes conflict and 404 |
| Key reuse                  | Same `mutationId`, different action or reason                                    | 409 `idempotency_mismatch`                                                                                                    | N/A                                   |
| Same key, other moderator  | Another moderator sends the same UUID                                            | Treated as a new decision                                                                                                     | Scoped per moderator                  |
| First decision preserved   | Resolve at T1, new report, takedown at T2                                        | `firstDecisionAt` stays T1; the new report's `resolved_at` is T2                                                              | N/A                                   |
| Escalate first             | Escalate at T1, resolve at T2 by an admin                                        | `firstDecisionAt` is T2; SLA values unchanged at T1                                                                           | N/A                                   |
| Escalated, moderator acts  | Moderator sends a terminal action on an escalated case                           | 403 `admin_required`; `allowedActions` empty                                                                                  | N/A                                   |
| Forged identity            | Body has `moderatorId` of someone else                                           | 400 `invalid_decision`                                                                                                        | Nothing written                       |
| Missing reason             | Empty, whitespace or over 1000 characters                                        | 400 `invalid_decision`                                                                                                        | Closed code, input not echoed         |
| Wrong role                 | Guardian or teen, any case id, flag on or off                                    | 403 `Insufficient role`, identical body for real and unknown ids                                                              | N/A                                   |
| Self review                | Moderator authored the target or filed a report                                  | 403 `self_review_refused`                                                                                                     | N/A                                   |
| Flags off                  | Either flag off, moderator                                                       | 503 `moderation_decisions_disabled` or `moderation_console_disabled`; console renders read-only                               | No write                              |
| Audit fails                | `AuditLog` insert errors or the moderator has no `User` row                      | 503 `audit_unavailable`, full rollback                                                                                        | Closed code                           |
| Temporary ban              | `durationDays:7` on a post case with a published target                          | Sanction expires in 7 days, target hidden, other posts stay, member gets 403 `community_banned` on feed, comment and reaction | N/A                                   |
| Temporary ban expires      | Clock past `expires_at`                                                          | Community access returns on the next request with no write                                                                    | N/A                                   |
| Upgrade to permanent       | Admin, active temporary ban                                                      | Old row lifted, new permanent row, all content hidden, reactions withdrawn, spotlight epoch bumped                            | N/A                                   |
| Moderator permanent        | Moderator sends `kind:'permanent'`                                               | 403 `admin_required`                                                                                                          | N/A                                   |
| Second ban                 | Active permanent, or active temporary with a temporary request                   | 409 `action_not_applicable`, `already_banned`                                                                                 | N/A                                   |
| Ban, author erased         | Orphan case                                                                      | 409 `action_not_applicable`, `target_erased`                                                                                  | N/A                                   |
| Ban during pending content | Member has `pending_review` and `pending_screening` items                        | Held with the marker; processors match zero rows and publish nothing                                                          | N/A                                   |
| Ban during a live socket   | Banned member connected to realtime                                              | `denied` control message at the next revalidation, feed clears                                                                | N/A                                   |
| Banned member retracts     | Banned member withdraws a post or deletes a comment through the API              | Allowed                                                                                                                       | N/A                                   |
| Banned teen                | Teen with active consent is banned; guardian later changes consent               | Sanction survives every consent change; consent state untouched by the ban                                                    | N/A                                   |
| Banned member's alerts     | Member with `PushToken` rows and weather alerts                                  | Tokens and non-community routes unaffected                                                                                    | N/A                                   |
| Appeal overturned          | Admin, permanent ban `requested`, then `overturned`                              | Ban ends now, marked published content returns, reactions stay withdrawn, target stays down, epoch bumped                     | N/A                                   |
| Appeal, bad step           | `upheld` from `not_requested`, a step on an expired ban, moderator sends outcome | 409 `appeal_transition_invalid`; moderator sending an outcome is 403 `admin_required`                                         | N/A                                   |
| Redis down                 | Takedown while Redis is unavailable                                              | 200, `cacheInvalidation:'deferred'`; next spotlight read excludes the post                                                    | One closed-code log line              |
| Author view after takedown | Author reads their post state                                                    | `moderationReason` null, generic localized state, no operator words or marker                                                 | N/A                                   |
| Screening intake           | Screener flags a post                                                            | Case `post.<id>` in the queue on the next read, `reportCount` 1, reporter identity `screening`, due in 24 hours               | N/A                                   |
| Hostile reason             | Reason holds markup or very long unbroken text                                   | Stored as text, rendered inert and wrapped, absent from logs and `AuditLog`                                                   | N/A                                   |

</frozen-after-approval>

## Code Map

Verified against `main` at `6337dc8c`.

- `apps/api/src/modules/community/community-moderation.actions.ts`: the existing operator service. `releaseFlaggedPost` (:77), `takeDownPublishedPost` (:163), `resolveReport` (:231), `lockPost` (private). Provided and exported by `CommunityModule`. Its header comment says 6.11 owns the write path, so update it.
- `apps/api/src/modules/community/community-privacy.ts`: `guardCommunityPost`, `guardCommunitySubject`, `communityPrivacyTransaction`. The privacy trigger refuses a status change from `published` without the guard (`community_privacy_assert_post`, `community_privacy_assert_comment` in `20261020120000_community_realtime`).
- `20261020120000_community_realtime/migration.sql`: `community_prepare_subject_privacy` (:455) takes member guard, post guards, `community_member`, `community_report` and `community_submission` locks and the post rows, which is all a ban needs. `community_forget_subject` (:470) deletes `PushToken`, so a ban never calls it. `community_post_invalidation` and `community_comment_invalidation` record stream invalidations from status changes.
- `apps/api/src/modules/community/community-access.service.ts`: `assertCommunityDatabaseReadAccess` (:104) is the choke point for D9. `assertCommunityDatabaseAccess` (:126) adds participation.
- `apps/api/src/modules/community/community-comments.service.ts`: `eligibility` (:62) reads the profile only, so comment create and report bypass the choke point.
- `apps/api/src/modules/community/community-comments.repository.ts`: `report` (:456), `visibleComment` (:544), `publicStates` (:51). `blocked` and `held_for_review` are already absent from `publicStates`.
- `apps/api/src/modules/community/community-comments.processor.ts`: `intake` (:197) writes the null-reporter report for held, blocked and failed comments. Publication at :125 shows the sequence allocation a release must match.
- `apps/api/src/modules/community/community-moderation.processor.ts`: `flagPost` (:493) gains the screening report. Publication catches `ForbiddenException` at :393.
- `apps/api/src/modules/community/community.service.ts`: `setReaction` `assertEligible` (:185), `reportPost` (:1282), `withdrawPost` (:1358, stays open), `buildAuthorStates` (:732, `moderationReason` at :757, D14).
- `apps/api/src/modules/community/community-spotlight.service.ts`: `currentSnapshot` (:229) re-checks visibility on every read. `community-spotlight-cache.ts`: `bumpAreas` (:231), `bumpEpoch` (:243). `community-spotlight-area.ts`: `areaHashesOf`, `storedAreaComponents`. `CommunityModule` provides `CommunitySpotlightService` and does not export it yet.
- `apps/api/src/modules/community/community-stream.repository.ts`: `assist` (:94). Exported by `CommunityModule`.
- `apps/api/src/modules/community/community-send-guard.ts`: push sends already call `assertCommunityDatabaseAccess` (:427, :468).
- `apps/api/src/realtime/community-realtime.server.ts`: revalidates each socket every 4 to 6 seconds (:42) and sends `denied` on `ForbiddenException` (:210).
- `apps/api/src/modules/share-cards/share-card-source.repository.ts`: export already calls `assertCommunityDatabaseAccess` (:55, :59).
- `apps/api/src/modules/auth/user-session.service.ts`: empty `invalidateUserSessions`, called from `guardian.service.ts:948`. `access-token-identity.service.ts`: role from `app_metadata`, app user id from `app_user_id` or verified email.
- `apps/api/src/modules/guardian/guardian.service.ts`: `revokeConsent` (:725, hide pattern :828 to :853). No restore-on-consent path exists, so consent changes cannot republish banned content.
- `apps/api/src/modules/moderation/moderation-queue.{controller,service,repository}.ts`, `moderation-queue-tables.ts`, `moderation-queue-cache-headers.middleware.ts`, `moderation.module.ts`: the 6.10 seams. `buildDetail` computes `viewerConflict` (:272). `loadCommentCase` labels every audit row `operator` (repository, near its final return), corrected by D11. `recordCaseView` shows the audit row shape.
- `packages/db/prisma/schema.prisma`: `LookbookPost` (:593), `CommunityPostReport` (:724), `ModerationEvent` (:958), `AuditLog` (:998), `CommunityComment` (:1600), `CommunityCommentReport` (:1655), `CommunityCommentAudit` (:1674, no actor column, so `ModerationDecision` holds attribution). `User` needs the new relations.
- `packages/db/prisma/migrations/20260420160000_harden_audit_log_immutability`: `AuditLog` is immutable and `user_id` is RESTRICT.
- `packages/db/test/rls/moderation-queue.spec.ts`, `rls/harness.ts:90-110`, `migration-hygiene.spec.ts`: RLS and partial-index guards.
- `packages/api-client/src/contracts/http/moderation-queue.ts`: `moderationAliasStateSchema`, `moderationCaseSummarySchema`, `moderationCaseDetailSchema` (:300). `openapi.ts:125` is where moderation contracts register. Register new contracts right after `registerModerationQueueContracts` and compare removed model names after regenerating (6.10 note).
- `packages/config/src/flags.ts:148`, `packages/db/prisma/seeds/feature-flags.ts:65`, `packages/db/test/moderation-console-flag-seed.spec.ts`, and the counts in `feature-flags.service.spec.ts`.
- `apps/web/src/lib/moderation.ts`, `apps/web/src/app/components/moderation-case-detail.tsx`, `moderation-queue.tsx`: console client and view. `apps/web/src/lib/community.ts:201` and `apps/mobile/src/lib/community.ts:156`: 403 classification by message. Both must classify `community_banned` by `code` as denied.
- `apps/web/src/app/components/community-lookbook-grid.tsx`: community page, denied handling near :2815.
- `playwright/support/helpers/community-engagement.ts:485`: comment says production has no operator route; update it.
- `apps/api/src/modules/community/community-comments.privacy.ts`: comment erasure keeps the row with status `erased` and a null author, so a comment case keeps its key (TEA-10).
- `apps/api/src/modules/guardian/guardian.service.ts:838`: the reaction withdrawal form a permanent ban reuses (TEA-19).
- `apps/api/src/modules/moderation/moderation-queue.repository.ts:116-124,168`: finding predicates changed by TEA-04. Line 221 already counts a null reporter once.
- `apps/api/src/modules/community/community.service.ts:954`: `assertPublicPostReadable` checks only the flag (TEA-17).

## Tasks & Acceptance

**Execution:**

- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml`, `epic-6-context.md`: set 6-11 to `in-progress` and name it the current story when the build starts; `review` when it ends.
- [ ] `packages/db/prisma/schema.prisma`, one new migration: `ModerationDecision`, `CommunitySanction`, their enums, `origin` on both report tables, the D11 backfill, RLS and zero grants, `UNIQUE (case_key, sequence)`, `UNIQUE (moderator_id, mutation_id)`, GIN on `report_ids`, a `CHECK` tying `kind` to `expires_at`, a hand-authored partial unique index for one unlifted permanent sanction per member. D5, D6, D7, D8, D11.
- [ ] `packages/config/src/flags.ts`, flag spec, `seeds/feature-flags.ts`, seed spec, service count spec: `moderation_decisions_enabled`. D3.
- [ ] `packages/api-client/src/contracts/http/moderation-decisions.ts` (new), `moderation-queue.ts`, `index.ts`, `openapi.ts`: request and response schemas, closed error and detail codes, `community_banned` body, `deriveAllowedActions`, detail additions (`revision`, `allowedActions`, `banKinds`, `escalated`, `firstDecisionAt`, `subjectStanding`), summary `escalated`, identity state `screening`. D1, D4, D5, D15.
- [ ] `packages/api-client/docs/http.openapi.json`, `src/generated/apis/ModerationApi.ts`, `src/generated/models/index.ts`: regenerate with `npm run generate:api-client`; no hand edits.
- [ ] `apps/api/src/modules/community/community-moderation.actions.ts`: transaction-scoped post forms shared with the existing methods, new comment forms (release, takedown), bulk report resolution for both tables. D4, D13.
- [ ] `apps/api/src/modules/community/community-access.service.ts`, `community-comments.service.ts` or `community-comments.repository.ts`, `community.service.ts`: `assertCommunityMemberNotSanctioned` and its call sites, `assertPublicPostReadable` included (TEA-17), retraction exempt; D14 projection. D9, D14.
- [ ] `apps/api/src/modules/community/community-moderation.processor.ts`, `community-comments.processor.ts`: screening report on flag; `origin: 'screening'` on comment intake. D11.
- [ ] `apps/api/src/modules/community/community-spotlight.service.ts`, `community.module.ts`: a public invalidation method for a post's areas and for the epoch; export the service. D12.
- [ ] `apps/api/src/modules/moderation/moderation-decisions.repository.ts`, `moderation-decisions.service.ts`, `moderation-sanctions.service.ts`, `moderation-decisions.controller.ts` (new), `moderation.module.ts`, cache-header middleware routes: D1 to D10, D12, D13. The middleware must cover the new controller.
- [ ] `apps/api/src/modules/moderation/moderation-queue.service.ts`, `moderation-queue.repository.ts`, `moderation-queue-tables.ts`: detail additions, screening identity and actor kind, orphan prior actions, marker excluded from `operatorNote`, finding predicates per TEA-04, page-level `escalated` read after paging, new tables in `MODERATION_QUEUE_READ_TABLES`. D4, D7, D8, D11, D13.
- [ ] `apps/web/src/lib/moderation.ts`, `apps/web/src/app/components/moderation-decision-panel.tsx`, `moderation-account-standing.tsx` (new), `moderation-case-detail.tsx`, `moderation-queue.tsx`: D15.
- [ ] `apps/web/src/lib/community.ts`, `community-lookbook-grid.tsx`, `apps/web/src/app/components/community-banned-notice.tsx` (new), `apps/mobile/src/lib/community.ts`: classify and render `community_banned`. D15.
- [ ] 10 files `apps/web/src/i18n/locales/*.json`, `moderation-locales.spec.ts`: `moderation.decision.*`, `moderation.standing.*`, `community.banned.*`, enum coverage from the contract. D15.
- [ ] `pact/http/consumer/interactions/moderation.ts`, `web-api-client.pacttest.ts`, `provider/state-handlers.ts`, `provider/doubles/moderation.ts`: applied, conflict, 403, 503 interactions.
- [ ] `playwright/tests/moderation-decisions.spec.ts` (new), `api/auth-moderation-security.spec.ts`, `support/helpers/community-engagement.ts`: role matrix on both routes, keyboard path, ban journey from decision to member notice, light and dark, 375 and 1280 widths, axe.
- [ ] Tests per the Test Design (TEA) section, written first against the contract and watched fail.

**Acceptance Criteria:**

- Given a moderator or admin, when any of the five actions is sent with a reason, then it applies through the canonical contract and the operator service, attributed to the session identity only, and one audit row and one decision row name that identity.
- Given a guardian, teen, anonymous or unknown caller or a direct database role, then no decision or appeal can be written, the 403 body is identical for real and unknown ids, and the flag state is not revealed.
- Given two conflicting reviews, then exactly one applies and the other receives `case_conflict` with no partial effect.
- Given a retry with the same `mutationId` and payload, then the stored response returns and no row changes.
- Given any sequence of decisions, retries and new reports, then `firstDecisionAt` equals the first terminal decision time and no stamped `resolved_at` moves.
- Given a takedown, a ban or an overturned appeal, then with no worker running the next spotlight, teaser, feed and comment read reflects it, and a Redis outage changes only `cacheInvalidation`.
- Given a temporary or permanent ban, then session, engagement, read, content and appeal effects match the D8 table on every listed route, the realtime socket included, and non-community routes and push tokens are untouched.
- Given every outcome and refusal, then the console shows a localized message in all ten web locales, announced once, with the typed reason kept on a recoverable failure.
- Given the console and banned notice on desktop and mobile in light and dark, then every state renders, focus order is logical and axe reports no serious or critical violation.
- Given the PR, then it changes fewer than 100 files, generated files included, and every PR job stays under 20 minutes.

## Implementation Notes

Decisions taken during the build under the owner's delegated approval:

- The clock token `MODERATION_QUEUE_CLOCK` and the revision, hash and audit functions live in `moderation-decision-rules.ts`, so the decision and queue services share them with no import cycle.
- `ModerationAfterCommit` runs the bounded spotlight and stream steps for both routes, and every 200, replay included, runs it (TEA-13).
- The standing section reads `allowedAppealSteps` from `deriveAllowedAppealSteps`, the appeal counterpart of `deriveAllowedActions`, so the console and the route share one rule.
- `writeModerationRecord` in `community-moderation.actions.ts` turns a failed record insert into 503 `audit_unavailable`.
  Unique violations and retryable lock errors pass through to their own handlers.
- The D11 backfill also skips canary, erasure-requested and anonymized posts, because a report row on them would open a case nobody can act on.
- TEA-08 wins over the U-A wording in the test design, as the spec's change log says.
- The target status now has localized labels under `moderation.targetStatus`, and an operator note has its own section in the case view.
- A banned member's page drops the filter nav, its heading, the notifications link and the spotlight, and the grid lifts the state to the layout through `onBannedChange`.
  A member whose ban ends while the page stays open sees the feed on the next reload or session change.
- The banned notice uses the light lookbook surface it sits on, because that surface has no dark variant.

File budget:

- The story passed the 90-file trigger in Design Notes.
  The banned notice stayed in, because the AC and the user-facing verification both name it, and TEA agreed.
- At 101 files the pre-existing Sign in and Sign out fix on `notification-settings/page.tsx` moved to the local branch `fix/notification-settings-auth-links` (`84307904`), and the factory email fix left with it.
  It has no dependency on this story.

Manual walk:

- Local stack: built API on `cc611_walk`, `next dev` with `WEB_NEXT_DIST_DIR=.next-walk`, a mock storage origin, and the `NEXT_PUBLIC_E2E_AUTH` fixture token.
- `E2E_CALLER_OWNED_ENV_KEYS` must name `DATABASE_URL`, because `TEST_ENV=local` otherwise lets `.env.local` override it.
  `COMMUNITY_FLAG_FIXTURE_MODE=true` is needed for community reads.
- Each decision, a temporary ban and a permanent ban were applied in Chromium, and the rows were read back.
  The notice was checked for both ban kinds in light and dark at 1280 and 375 pixels.
  Screenshots are under `_bmad-output/test-artifacts/story-6-11/` and stay out of git.

Matrix test audit (row, then the test that covers it): resolve grouped `I-D-RESOLVE-GROUP`; resolve orphan `I-D-RESOLVE-ORPHAN`; release screener flag `I-D-RELEASE-POST`; release held comment `I-D-RELEASE-COMMENT`; writes closed `I-D-RELEASE-REFUSALS`; takedowns `I-D-TAKEDOWN-POST`, `I-D-TAKEDOWN-COMMENT`, `I-D-TAKEDOWN-TWICE`; concurrent conflict `I-C-CONFLICT`; new report `I-C-REPORT-RACE`; network retry `I-C-RETRY`; retry after a move `I-C-RETRY-MOVED`, `I-C-REKEY`; key reuse `I-C-KEY-REUSE`; other moderator `I-C-KEY-SCOPE`; first decision `I-C-FIRST-DECISION`; escalate first `I-C-FIRST-ESCALATE`; escalated moderator `I-D-ESCALATE`; forged identity `U-D-CTRL-IDENTITY`; missing reason `U-D-REASON`; wrong role `U-D-CTRL-NO-ORACLE`, `P-D-ROLES`; self review `I-D-SELF-REVIEW`; flags off `U-D-CTRL-ORDER`, `P-D-DISABLED`; audit fails `I-D-ATOMIC`; temporary ban `I-B-CONTENT-TEMP`; expiry `I-B-EXPIRY`; upgrade `I-B-UPGRADE`; moderator permanent `U-D-ALLOWED-RULES`, `I-B-SECOND`; second ban `I-B-SECOND`; author erased `I-B-ERASED`; pending content `I-B-PENDING`; live socket `I-B-REALTIME`; retraction `I-B-RETRACT`; banned teen `I-B-TEEN`; alerts `I-B-NONCOMMUNITY`; overturned `I-A-OVERTURN`; bad step `I-A-BAD-STEP`; Redis down `I-K-REDIS-DOWN`; author view `U-B-D14`; screening intake `I-S-INTAKE`; hostile reason `I-D-HOSTILE`.

## Spec Change Log

Added by TEA on 2026-11-04 after reading the spec against the code at `6337dc8c`.
The frozen block is unchanged. Read these entries with the decision each one names; each wins over the frozen wording where they differ, until the owner renegotiates.
Entries marked (intent) tighten or extend frozen intent and were sent to the builder and coordinator as default rulings, since the owner is unavailable.

- TEA-01 (D5, ruling). The transaction order is case lock, idempotency check, case resolution, privacy guard, `community_member` lock, post row lock, revision check. Report intake holds only the post row lock, so a revision read before that lock can miss a report and stamp it unseen. The revision read supplies the stamped report ids.
- TEA-02 (D10, intent). `overturned` always ends the ban. Restoration runs only when `assertCommunityDatabaseAccess` passes under the subject guard. Otherwise markers stay and nothing is republished, because `guardian.service.ts` hides a teen's content on lapsed consent and deliberately has no restore path.
- TEA-03 (D1, intent, closes 6.10 residual RG4). `reason` is also refused with 400 `invalid_decision` when `communityModerationReasonCategories` recognizes it or when it begins with `community_ban:`.
- TEA-04 (D4, D8, ruling). A comment takedown writes the closed value `operator_takedown` to `screening_reason`, and the operator's words stay on the decision and audit rows. Both finding predicates (`moderation-queue.repository.ts:168`, `hasFinding` in `moderation-queue.service.ts`) exclude `operator_takedown` and `community_ban:%`. The D11 "queue SQL is unchanged" sentence covers the queue source arms.
- TEA-05 (D8, fixed from code). Hold statuses: a published or `pending_review` post becomes `flagged`; a published comment becomes `blocked`; a `pending_screening` comment becomes `held_for_review`. Bodies, `published_at` and `publication_sequence` stay. The marker goes in the D8 columns.
- TEA-06 (D6, D7, D10, ruling). An appeal step writes a `ModerationDecision` row with `action` `appeal_requested`, `appeal_upheld` or `appeal_overturned`, `is_terminal=false`, on the originating `case_key` under that case's lock. `CommunitySanction` columns: `id`, `user_id` (Cascade), `decision_id` (unique), `case_key`, `kind`, `expires_at`, `lifted_at`, `appeal_status`, `created_at`. The sanction row is locked `FOR UPDATE` for a step.
- TEA-07 (D2, intent). On the appeal route, `self_review_refused` covers the sanction's subject and the author and every reporter of the originating case.
- TEA-08 (D2, D4, ruling). Refusal order after the input check: replay or mismatch, `case_not_found` or `sanction_not_found`, `operator_sanctioned`, `self_review_refused`, `admin_required`, `case_conflict`, `action_not_applicable`.
- TEA-09 (D4, fixed from code). A release on an author with an active ban answers `subject_banned`, and other ineligibility answers `author_ineligible`. `target_erased` covers an orphan, `anonymized_at`, `erasure_requested_at` on a release, comment status `erased` and a null author.
- TEA-10 (D4, intent). `ban` needs a target row with a known author. A `withdrawn` post or `author_deleted` comment still allows it, with no target effect, so retraction cannot escape a ban. An erased comment keeps its row and its `comment.<id>` key, so it answers `target_erased` where D5 says 404. Only a post erasure re-keys.
- TEA-11 (D4, fixed from code). `allowedActions` is also empty for an operator with an active sanction. A flag read failure on the detail GET gives an empty list with a 200, and the POST still answers 503.
- TEA-12 (D5, D6, ruling). `payload_hash` covers route, case or sanction id, action, trimmed reason and ban. `expectedRevision` is excluded, so a lost-response retry after a reload replays. A violation of `UNIQUE (moderator_id, mutation_id)` re-reads in a new transaction and answers replay or `idempotency_mismatch`.
- TEA-13 (D6, D12, ruling). The stored response omits `cacheInvalidation`. Every 200, replay included, runs the bounded after-commit steps and reports its own outcome, so a crash after commit is repaired by the retry. The decision rows do not change.
- TEA-14 (D4, D7, ruling). `report_ids` holds every report of the case at decision time. Stamps touch only the open ones. `escalated` reads by `case_key` or `report_ids` overlap, as `firstDecisionAt` does.
- TEA-15 (D11, D13, ruling). Comment audit rows reuse the post action names. The target action writes one row on the case's newest report, and `report_resolved` writes one row per stamped report. A row reads as actor kind `screening` only for `held_for_review`, `blocked` and `screening_failed`.
- TEA-16 (D11, fixed from code). The backfill requires `flagged` to be the post's newest status-changing `ModerationEvent`. `flagPost` copies an existing `CommunityAlias` into `subject_alias` and never creates one; the read falls back to the live alias.
- TEA-17 (D8, D9, intent). `POST posts/:postId/opened` gains the sanction check, because it reveals post visibility and records an open. `notification-preferences` routes refuse a banned member through `access.assert`, and sends have already stopped. Share-card export is refused for both community and outfit sources, since `share-card-source.repository.ts:59` shares the choke point and D8 lists export with no source limit. The owner can narrow outfit export later.
- TEA-18 (D8, D9, fixed from code). The comment check goes in repository `create` and `report`. The `eligibility` closure in `community-comments.service.ts` is shared with delete and must stay free of it. Delete keeps the visible-post rule in `withThread`, so a comment on a hidden post answers 404 for every member. Author delete nulls a `blocked` comment's body, and a member report's snapshot keeps the evidence.
- TEA-19 (D8, fixed from code). Reaction withdrawal sets `selection: null` and increments `revision`, as `guardian.service.ts:838` does. Rows are not deleted.
- TEA-20 (D8, fixed from code). Enforcement binds `new Date()` as a query parameter, so `pinClock` reaches it. Active means `lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now)`.
- TEA-21 (D12, fixed from code). A release runs the same after-commit step for the post's areas. `resolve` and `escalate` skip the bump and report `completed`.
- TEA-22 (D15, fixed from code). Both clients read `code` ahead of every message rule, and the `community_banned` message stays distinct from the rollout copy.

- Build-02 (D11, Optic on PR 195). A screening report reads as identity state `unknown` with `origin: screening` on the reporter, where D11 said identity state `screening`. Adding that enum value is a breaking response change under `api-versioning.md`, and the one exemption the repo has is for deliberately open sets, which this closed set is not. The console shows the same Automated screening label from `origin`.
- Build-01 (TEA-01, D2, review C2). The transaction order gains one step: case lock, replay check, case read, sanction eligibility locks, privacy guard, member lock, post row lock, then the re-read and revision check.

Residuals RG1 to RG8 are in the test design under Assumptions.

## Review Triage Log

The bmad-build lens fan-out did not run: TEA reviewed every commit as the independent reader, and the coordinator runs the Codex review after this log.
C1 to C6 are the Codex review of `4cf4b128`, each checked against the code before its fix.
R2-1 is the Codex re-review of `1d49278a`, which confirmed the other five fixed.
All rows below were real and fixed.

| Id           | Sev    | Finding                                                                                                                                                | Fix                                                                                                                                                                                    |
| ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1           | high   | The foreign-key handler read `meta.field_name`, and Prisma reports `meta.constraint`, so a moderator with no `User` row got a 500                      | `writeModerationRecord`                                                                                                                                                                |
| F2           | high   | Non-audit record inserts answered 500 with the audit promise broken                                                                                    | Same wrapper covers every record insert                                                                                                                                                |
| F3           | high   | The appeal route computed its own viewer conflict                                                                                                      | `appealViewerConflict` is shared                                                                                                                                                       |
| F4 to F6     | high   | The ban check sat behind allocate and publish replays and missed some reads                                                                            | Check moved ahead of every replay and into `assertPublicPostReadable`                                                                                                                  |
| F7           | high   | A banned actor's engagement dropped other members' notifications                                                                                       | The banned actor drops alone in the send guard                                                                                                                                         |
| F8           | high   | `key={detail.revision}` remounted the panel and lost the reason and focus                                                                              | Key removed                                                                                                                                                                            |
| F9, F10      | medium | The panel kept a chosen action or ban kind that a reload no longer offered                                                                             | Effective action and kind through `stillOffered`                                                                                                                                       |
| F11 to F13   | medium | Focus fell to the body after a conflict reload, outcome text survived a case change, and the SLA announcement talked over the outcome                  | `focusSubmit` ref, outcome reset per case, `announceSla`                                                                                                                               |
| F14          | medium | The mutation key survived an idempotency mismatch                                                                                                      | Keeper cleared on mismatch                                                                                                                                                             |
| F15 to F17   | medium | A banned member kept author states, the challenge and `canAct`, and non-JSON refusal bodies lost the code                                              | Banned state clears them, tolerant code read                                                                                                                                           |
| F18 to F20   | low    | The form lacked `aria-required`, `aria-invalid` and `noValidate`, and the notice announced through `role=status` on mount                              | Attributes added, one live region                                                                                                                                                      |
| F21          | low    | Timer `unref` typing, and prettier merged two lines through ASI                                                                                        | Explicit cast and statement separation                                                                                                                                                 |
| F22          | medium | `moderationDecisionReasonSchema` refined with no published description, so the invariants gate failed                                                  | `.openapi({ description })`, client regenerated                                                                                                                                        |
| F23          | medium | The case snapshot called `$transaction` directly, which skips the pldbgapi2 retry and fails `prisma-client.guard.spec.ts`                              | `interactiveTransaction` with RepeatableRead                                                                                                                                           |
| UI-A         | medium | The notice was a black card on the light page in dark mode                                                                                             | Light surface classes only                                                                                                                                                             |
| UI-B         | medium | The case view printed the raw status enum in every locale                                                                                              | `moderation.targetStatus`                                                                                                                                                              |
| UI-C         | medium | Banned page filters stayed live and fired three 403 reads per click                                                                                    | Nav leaves the page through `closed`, zero reads                                                                                                                                       |
| UI-D         | low    | The notifications link stayed on the banned page, and settings showed Sign in with Sign out                                                            | Link hidden; the settings fix moved to `fix/notification-settings-auth-links`                                                                                                          |
| UI-E         | low    | Operator words sat under the Machine findings heading                                                                                                  | Own section                                                                                                                                                                            |
| UI-F         | low    | 44-pixel global rule stretched radios, three Resolved labels stacked, and Reload stretched across the failure notice                                   | `min-h-0 min-w-0`, header reduced, `self-start`                                                                                                                                        |
| UI-G1, UI-G2 | medium | Closed chips kept a selected look, with their heading stranded from the notice                                                                         | Same `closed` nav                                                                                                                                                                      |
| UI-G3        | low    | The chip row clipped mid-word, on main too                                                                                                             | Wrap from 768 pixels, a right edge fade below                                                                                                                                          |
| UI-G4        | low    | The section label sat against the divider once the link left                                                                                           | `pt-6` when banned                                                                                                                                                                     |
| UI-G5        | medium | The spotlight said it was unavailable beside the notice                                                                                                | Its `available` follows `feedVisible`                                                                                                                                                  |
| C1           | high   | The case GET built its evidence and its revision from two reads, so a report committing between them was covered by a revision the moderator never saw | `describeCase` runs the visible read in its own RepeatableRead snapshot, and flags resolve after it closes                                                                             |
| C2           | high   | Two operators banning each other could both pass the actor check and both apply                                                                        | `lockSanctionEligibility`: shared on the operator, exclusive on the ban subject, in id order, ahead of the guards; the appeal route takes the shared lock                              |
| C3           | high   | A banned member's sanction stayed on screen after sign-out, erasure or an account switch                                                               | `clearScope` clears the sanction and its announcement, and a late socket probe checks the scope                                                                                        |
| C4           | medium | Try again sent changed ban terms with no confirmation                                                                                                  | Try again leaves once the form differs from the failed attempt, and Apply goes through confirmation                                                                                    |
| C5           | medium | A ban learned from the socket left the weekly challenge and its dead button                                                                            | `closeForBan` is the one cleanup for both paths                                                                                                                                        |
| C6           | medium | Erasure during lock acquisition answered the legacy 404 with no closed code, so the panel offered retries                                              | `takeTargetLocks` maps it to `case_not_found`                                                                                                                                          |
| R2-1         | medium | A delayed realtime rebuild restored the weekly challenge after the ban cleanup                                                                         | `closeForBan` bumps the feed generation, so reads in flight cannot land                                                                                                                |
| CI-1         | high   | Optic refused the new `screening` value of the alias state as a breaking response enum change                                                          | The enum returns to its main values, and reporters gain `origin`, with no exemption                                                                                                    |
| CR-1         | low    | Decision history replayed rows by time, so clock skew could leave a resolved case escalated                                                            | `inDecisionOrder` lets the sequence decide inside one case key                                                                                                                         |
| CR-2         | none   | Content a temporary ban held stays held after it expires                                                                                               | Kept: D8 says so in its End row. Reply on the thread, and raised with the coordinator as a product question                                                                            |
| CR-3         | low    | Overturning a permanent ban clears `moderation_reason` on a post it hid                                                                                | Kept: the post's `ModerationEvent` rows hold the original reason, and an operator can read them under Prior actions                                                                    |
| CR-4         | high   | An upgrade left content under the replaced temporary marker, which no appeal could reach                                                               | `createSanction` moves those rows to the new marker                                                                                                                                    |
| CR-5         | high   | A ban left the detail, report and compose dialogs open and interactive                                                                                 | `closeForBan` closes them                                                                                                                                                              |
| CR-6         | medium | A ban on a later spotlight page only offered a retry                                                                                                   | The hook hands the sanction to `closeForBan`                                                                                                                                           |
| CR-7         | medium | The home teaser stayed beside the notice for up to four minutes                                                                                        | The layout hands the slot no value while banned                                                                                                                                        |
| CR-8         | medium | Appeal retry resent an edited note under a new mutation id                                                                                             | Retry leaves once the note differs from the failed attempt                                                                                                                             |
| CR-9         | medium | An open confirmation sent terms edited after it opened                                                                                                 | Any change to the action, terms or reason closes it                                                                                                                                    |
| CR-10        | medium | `operator_takedown` passed as a reason, which then read as a hold marker                                                                               | The reason schema refuses it                                                                                                                                                           |
| CR-11        | medium | Community 403s did not name the `community_banned` body in OpenAPI                                                                                     | `community-banned.ts` breaks the import cycle, and every enforced operation names `CommunityBannedError` in its 403; feed, post read and opened gain the 403 they could already answer |
| CR-12        | low    | `routeIsOpen` probed flags for one identity only                                                                                                       | TEA: per identity                                                                                                                                                                      |
| CR-13        | medium | `moderationSanctionSchema` accepted a kind and expiry the database forbids                                                                             | Discriminated union on `kind`, also on the banned body                                                                                                                                 |
| CR-14        | low    | The engine version disappeared for held comments with no codes                                                                                         | The row renders whenever the version is set                                                                                                                                            |
| CR-15        | low    | The banned-feed Pact double never read the forwarded member                                                                                            | TEA: the double asserts it                                                                                                                                                             |

## Design Notes

**Seams for the next stories (not built here):**

| Story | What it needs from 6.11                                                                                                                                                                   | Where it plugs in                                                                  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 6.12  | `escalate` decision rows and `escalated`; `firstDecisionAt`; `resolved_at` stamped only once; screening reports now carry a real `sla_due_at`                                             | The worker reads them. Alert delivery on escalation is its own outbox, added there |
| 6.13  | `ModerationDecision` written by insert only; `AuditLog` events with no subject identity; `moderator_id`, `subject_user_id`, `subject_alias` and `reason` as the fields erasure must treat | An append-only trigger on the table, retention, anonymization and evidence export  |
| Later | `community_banned` body with kind, expiry and appeal status; `appeal_status` state machine                                                                                                | Mobile banned copy and member self-service appeal intake                           |

**Why a decision row is the record.**
Comment audit rows have no actor column and post events cannot express escalation or a ban.
An append-only row gives attribution, serialization through its sequence, idempotency through its key and the first decision time through a plain minimum, with no mutable case row to keep in sync.
6.10 D1 stays intact: a case remains derived from reports.

**Why screening intake uses a report row.**
Comments already do this, so the queue, keyset, SLA, risk and erasure re-key apply unchanged.
The rejected option, a third queue source, needed a case id kind, a third SQL arm, a substitute due time and a way to close a case with no report.
One consequence stays visible: a screening report counts once toward the three-reporter risk bump, as comment intake already does.

**Revision (golden example).**

```
revision = sha256(`${newestSequence}|${sortedOpenReportIds.join(',')}|${targetStatus}`).slice(0, 16)
case with no decision, reports r1 r2, post published: sha256("0|r1,r2|published")
```

**File budget (target under 100, plan about 83).**

| Area                                                                                                              | Files |
| ----------------------------------------------------------------------------------------------------------------- | ----- |
| Spec, sprint status, epic context, TEA test design                                                                | 4     |
| Prisma schema, migration                                                                                          | 2     |
| Flag, flag spec, seed, seed spec, service count spec                                                              | 5     |
| Contract: new, queue, index, openapi                                                                              | 4     |
| Generated: openapi json, `ModerationApi.ts`, `models/index.ts`                                                    | 3     |
| API community: actions, access, comments, service, two processors, spotlight, module                              | 8     |
| API moderation: repository, two services, controller, module, middleware, queue service, queue repository, tables | 9     |
| API specs and integration (TEA plan)                                                                              | 12    |
| Contract unit spec, DB RLS spec, migration backfill spec                                                          | 3     |
| Pact: interaction, pacttest, state handlers, double                                                               | 4     |
| Web: client, panel, standing, detail, queue, community client, grid, notice                                       | 8     |
| Web tests (TEA plan)                                                                                              | 5     |
| Web locales (10) and parity spec                                                                                  | 11    |
| Mobile: community client and its test                                                                             | 2     |
| Playwright: spec, role matrix, helper                                                                             | 3     |
| Headroom for review fixes                                                                                         | 3     |

Mobile catalogs are excluded by D15, because 20 more files would leave no headroom.
If review fixes push the count past 90, move the web banned notice and its strings to a stacked follow-up PR and keep the 403 classified as denied.
Do not trim tests.

## Test Design (TEA)

Full plan, reconciled to this spec (this spec wins on any disagreement):
`_bmad-output/test-artifacts/test-design/cc611-moderation-decisions-test-design.md`.
22 risks (13 high, 3 at score 9); 143 scenarios: P0 85, P1 49, P2 9 (Unit 36, Integration 74, DB 5, Contract 2, Component 11, E2E 13, Manual 2).
136 are red-first, 5 are green guards and 2 are manual.
14 seeded-defect proofs (S-1 to S-14) run in a throwaway worktree and are recorded under `_bmad-output/test-artifacts/story-6-11/`.
Review findings TEA-01 to TEA-22 are in the Spec Change Log.

Red-first order for the build:

1. Migration, with `D-CONSTRAINTS`, `D-BACKFILL`, `D-RLS-DENIED` red.
2. Contract schemas, with `U-D-CONTRACT-STRICT`, `U-D-REASON`, `U-D-REVISION`, `U-D-ALLOWED-RULES`, `U-D-RESPONSE-STRICT` red.
3. `seedDecisionCases` (one seed for integration, Playwright, pact states and the manual check), then `I-D-RESOLVE-GROUP`, `I-D-HTTP`, `I-C-CONFLICT`, `I-C-RETRY`, `I-C-FIRST-DECISION`, `I-B-ROUTES`, `I-K-TAKEDOWN-READS`, `I-S-INTAKE` red against missing routes.
4. `U-B-ROUTE-MATRIX` red, then the sanction check and its call sites. `U-B-D14` red, then the projection.
5. Controller and service units red, then implementation to green. `I-C-REPORT-RACE` and `I-A-OVERTURN-CONSENT` come before the code they guard.
6. Component tests red against contract fixtures, then the panel and notice.
7. Pact and Playwright last.

Green guards that start passing: `I-D-DETAIL-READONLY`, `U-D-CTRL-ACTIONS-KEPT`, `I-D-ACTIONS-COMPAT`, `I-K-NO-PUBLIC`, `D-RLS-AUDIT`.

Build rules the tests rely on:

- The service takes an injectable clock and reads it once after the case lock.
- Race tests hold a real lock and confirm the waiter through `pg_locks`, so the code must take the locks in the TEA-01 order.
- One function builds `AuditLog.event_data`, and one function computes viewer conflict for detail, decision and appeal.
- `deriveAllowedActions` is the only source of `allowedActions` and availability refusals.
- 6.10 specs change in three named ways: `C-WEB-Q-NO-ACTIONS` is retired, `U-Q-SVC-PRIOR-ACTIONS` and `I-Q-DETAIL` gain the `screening` actor kind, and `I-Q-RISK-PARITY` gains the new finding exclusions.

## Verification

**Commands:**

- `npm exec -w apps/api -- vitest run moderation` and the integration specs `apps/api/integration/moderation-decisions*.integration.spec.ts` and `moderation-sanctions.integration.spec.ts`: pass.
- `npm exec -w apps/api -- vitest run community-moderation community-access community.service community-comments`: pass.
- `npm exec -w packages/api-client -- vitest run moderation`: pass.
- `npm exec -w apps/web -- vitest run moderation community`: pass.
- `npm exec -w apps/mobile -- vitest run community`: pass.
- `npm run generate:http-openapi && npm run generate:api-client`: no diff after the committed regeneration, and no existing model renamed.
- `npm run test:pact`: pass.
- RLS suite in `packages/db/test/rls`, `migration-hygiene.spec.ts` and the new migration backfill spec against an isolated database: pass.
- Playwright with an isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true`: `npx playwright test playwright/tests/moderation-decisions.spec.ts`: pass.
- `node scripts/ci/node-test-gate.mjs` for every gate the changed paths touch: pass.
- tsc in `apps/api`, `apps/web`, `apps/mobile` and `packages/api-client`, counted by code (only the symlink TS2742 is ignorable), and lint: clean.
- `git grep` every changed export across `scripts/`, `package.json`, Dockerfile CMD and `apps/api/api/`: no broken caller.
- `git diff --name-only main... | wc -l`: below 100.

**Manual checks:**

- Seed one case per action on an isolated database, sign in as moderator and as admin, and apply each decision at 1280 and 375 widths in light and dark. Check the panel states, conflict with two tabs, offline retry, the standing section, and the banned notice as the member. Screenshots go under `_bmad-output/test-artifacts/story-6-11/`.
