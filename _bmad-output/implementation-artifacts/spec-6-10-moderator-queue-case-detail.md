---
title: 'CC-6.10 Moderator queue and case detail'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: 'b959e4c6a300c37d5d97c8fd4519c63b6a20fd8e'
baseline_revision: 'b959e4c6a300c37d5d97c8fd4519c63b6a20fd8e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-4-threaded-comments.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-06.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Members can report posts and comments, and every accepted report lands in `CommunityPostReport` or `CommunityCommentReport` with a content snapshot and a 24-hour `sla_due_at`.
No moderator can read them.
`ModerationController` exposes one write-only analytics endpoint, `CommunityPostReport.resolved_at` has no reader, and an operator needs a REPL against the production database to learn what was reported.

**Approach:** Add two moderator-only, read-only API routes: a keyset-paginated case queue and a case detail.
Add a Next.js moderator console on web that renders both with safe media, machine findings, reporter context, prior actions and time remaining.
Nothing in this story changes a report, a post, a comment or a member.
The routes sit behind a new flag that is off in production.

Decisions (owner delegated planning, 2026-11-03):

- D1 A case is one reported target, not one report.
  - Open reports on the same post form one case with `reportCount` and the union of reasons.
  - Open reports on the same comment form one case.
  - A report whose target was erased (`post_id` or `comment_id` is null) is its own case, because the snapshot is all that survives.
  - Case ids are opaque: `post.<postId>`, `comment.<commentId>`, `orphan-post.<reportId>`, `orphan-comment.<reportId>`.
  - A case id is stable until its target is erased. Erasure re-keys `post.<postId>` into one `orphan-post.<reportId>` case per report, and the old id returns 404 `case_not_found`. This is the single documented re-key, and 6.11 treats a decision against a re-keyed case as stale. (Amended 2026-11-03, TEA-09, coordinator ruling.)
  - The one re-key event is erasure of the target. `post.<postId>` then becomes one `orphan-post.<reportId>` case per report, and the old id returns 404 `case_not_found`. The console shows the not-found state with a link back. 6.11 treats a decision against a re-keyed case as stale. (Amended 2026-11-03, TEA-09, coordinator ruling.)
  - A case is `open` while any of its reports has `resolved_at` null, and `resolved` otherwise.
  - 6.11 decides the whole case at once, so the grouping is the unit it needs.
- D2 The queue is built from the two existing report tables only, as epics.md CC-6.10 AC1 says.
  - Posts the screener flagged with no member report, and comments in `held_for_review`, are not queue items in this story.
  - Seam for 6.11: a third source `screening` would add them. The release action (`CommunityModerationActionsService.releaseFlaggedPost`) needs a case to attach to, so 6.11 must either add that source or accept that release stays script-only.
- D3 Routes, both under `/api/v1/moderation`, both `GET`, both `Cache-Control: private, no-store`:
  - `GET /cases?source=&locale=&risk=&status=&sla=&limit=&cursor=` returns `{data:{items, nextCursor, serverNow}}`.
  - `GET /cases/:caseId` returns `{data:<CaseDetail>}`.
  - `limit` defaults to 25, maximum 50.
  - `status` defaults to `open`.
  - Every filter accepts one value.
  - An invalid filter, limit or cursor is a 400 with a closed code.
- D4 Authorization.
  - `RequestAuthGuard` plus `RolesGuard` with `@Roles('moderator', 'admin')`, the same pair `ModerationController` already uses.
  - `ApiRole` comes from Supabase `app_metadata.app_role` or `role` (`access-token-identity.service.ts`), so a member cannot self-assign it.
  - Guardians and teens get 403 with the existing `Insufficient role` body, identical for existing and unknown case ids, so the routes are no oracle.
  - The flag `moderation_console_enabled` (default false, true in the dev seed) is evaluated after the role check. Off means 503 with code `moderation_console_disabled`.
  - The flag is separate from `community_read_enabled`, because an incident can close the feed while reports still need review.
- D5 Risk is derived, never stored. It is the pure function `deriveCaseRisk` in `@couture/api-client`.
  - Base from the strongest open report reason: `hate_speech` and `violence` are `high`, `harassment` and `inappropriate_content` are `medium`, `spam` and `other` are `low`.
  - A machine finding on the target raises the base one level. A finding is a post with a non-null `moderation_reason` made only of known screening codes, or a comment in `held_for_review` or `blocked`.
  - Three or more distinct open reporters raise it one level more. The maximum is `high`.
  - SQL and TypeScript must agree. The query computes the numeric rank, and the service maps the rank to the enum. A parity test runs every combination through both.
- D6 SLA state is derived from `sla_due_at` and one server clock read per request.
  - `resolved` when the case is resolved. Otherwise `breached` when `now >= dueAt`, `at_risk` when the remaining time is at most `SLA_AT_RISK_WINDOW_MS` (6 hours, a quarter of the 24-hour SLA), and `on_track` otherwise.
  - A case uses its earliest open `sla_due_at`.
  - The constant and `deriveSlaState` live in `@couture/api-client`, so 6.12 reuses them for scheduled alerts without a second definition.
  - Responses carry `serverNow` and `slaDueAt`. The client counts down from the server offset and never from its own clock alone.
- D7 Queue order and keyset: `risk_rank` descending, earliest open `sla_due_at` ascending, `case_key` ascending.
  - The cursor is HMAC-signed with the `requireAnalyticsIdSecret` pattern of `community-cursor.ts`, versioned, and bound to the exact filter set. A cursor minted under other filters is a 400 `invalid_cursor`.
  - Rows that change risk or SLA state between pages may move. The cursor stores the last sort tuple, so an unchanged row appears exactly once across pages and is never skipped. A changed row may appear zero times or once more, and the web client dedupes by `caseId`. (Amended 2026-11-03, TEA-06, coordinator ruling.)
  - The open set is read through the existing `(resolved_at, sla_due_at)` index on both report tables. No schema change and no migration.
- D8 Media is signed on read and never stored in a response cache.
  - The detail route signs `image_object_path` through `SupabaseCommunityStorageAdapter.signReadUrl` with a 120-second lifetime. This is shorter than the 900 seconds the public feed uses, because the viewer is a moderator opening one case.
  - Responses carry the signed URL and its `expiresAt` and no object path or bucket name.
  - The URL is omitted when the post is anonymized or `objects_purged_at` is set, when the report has no image path, or when signing fails. The detail then returns `media:{state:'unavailable', reason}` with a closed reason, and the case stays readable.
  - The web console renders the image with `referrerPolicy="no-referrer"` and without the Next image optimizer, so the signed URL never reaches an intermediary cache.
  - Signed URLs never enter logs, audit rows, analytics or error bodies.
- D9 Reporter and subject privacy.
  - Reporters appear as their `CommunityAlias.alias`, or `erased` when `reporter_id` is null. No email, user id or HMAC token leaves the API.
  - Post reporter `details` (maximum 500 characters) is returned as plain text and rendered as plain text. It is untrusted content and is never interpreted as markdown or HTML.
  - The subject appears as `subject_alias` from the report row.
  - Prior actions report an `actorKind` of `screening`, `reporter` or `operator`. Named operator attribution belongs to the immutable history in 6.13.
- D10 Reads are audited.
  - Every successful detail read writes one `AuditLog` row (CC-1.4) with `event_type: 'moderation_case_viewed'`, the moderator as `user_id`, and `event_data:{caseId, source, role}`.
  - Queue pages write no audit row. They write one structured log line with the moderator ref, filter names and result count, and no content.
  - A failed or denied read writes none.
  - Seam for 6.13: the row shape is the one 6.13 ingests into the immutable history.
- D11 Intake visibility needs no cache and no queue copy.
  - The queue reads the report tables directly at READ COMMITTED, so an accepted report is visible on the next queue read.
  - The five-minute proof is an integration test: file a report through the real report route, read the queue as a moderator, and assert the case is present and that `now - acceptedAt` is under 300 seconds.
  - Seam for 6.12: monitoring may add a derived `intakeLagSeconds` to the case, and nothing here prevents it.
- D12 The console is a Next.js route tree under `/moderation`, using the existing web session bridge and `createWebApiClient`.
  - The browser holds the same bearer token it uses for every other route. The console decides nothing about roles. A 403 renders a neutral "not available for this account" state with no case data, and a 503 renders the disabled state.
  - The web app never reads these tables or Supabase storage directly.
  - All strings come from the ten web catalogs under a new `moderation` namespace.
  - Light and dark, desktop and mobile widths, WCAG 2.2 AA, 44-pixel targets, visible focus, logical focus order, one polite live-region announcement per result change.
  - Countdown text updates once per minute in the DOM, announces only SLA state changes, and honors `prefers-reduced-motion`.
- D13 One PR under 100 changed files, generated files included. The budget table in Design Notes is the plan, and Verification asserts the count.

## Boundaries & Constraints

**Always:**

- Read-only. No handler in this story writes `CommunityPostReport`, `CommunityCommentReport`, `LookbookPost`, `CommunityComment`, `ModerationEvent`, `CommunityCommentAudit` or any member row. The only write is the D10 audit row.
- Contracts start as shared Zod schemas in `packages/api-client/src/contracts/http/moderation-queue.ts`. Controller, OpenAPI, generated SDK and web client derive from them. Response schemas are strict.
- Use the shared envelope `{data: ...}`. Errors use the existing Nest error bodies plus a closed `code`.
- Case projections come from the stored `content_snapshot` (what the reporter saw) plus the current target state (what is live now). The detail shows both and labels them, so a moderator can tell that a post was already withdrawn.
- Orphaned and anonymized targets stay readable from the snapshot. Missing snapshot fields render as unavailable, never as an error.
- Filters and ordering run in SQL. No handler loads the full open set into memory.
- All ten web locales, catalog parity, and one localized label for every enum the console renders (source, risk, status, SLA state, report reason, finding category, action kind, media reason).
- Queue and detail states: loading, empty, filtered-empty, error, forbidden, disabled, stale (a refresh failed after a good load).

**Never:**

- Decision actions, reasons, takedown, release, resolve, escalate, ban or any sanction. That is CC-6.11. The detail renders no action control and no disabled placeholder for one.
- SLA timers, alerting, schedulers, workers or dashboards. That is CC-6.12.
- Append-only guarantees, evidence export or retention changes. That is CC-6.13.
- A new table, column, enum or migration.
- A queue source other than the two report tables (D2).
- A mobile moderator surface.
- Returning user ids, emails, raw object paths, report ids that are not case-scoped, IP addresses or HMAC tokens.
- Reading these tables from a Supabase client, an RLS policy, or a Next.js server action that bypasses the API.
- Changing `POST /api/v1/moderation/actions`, its contract, or `community_read_enabled` semantics.
- Production flag values, or edits to `bmad/`.

## I/O & Edge-Case Matrix

| Scenario                          | Input / State                                                           | Expected Output / Behavior                                                                                        | Error Handling                          |
| --------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Default queue                     | Moderator, no filters, mixed open reports                               | Open cases ordered by risk, then earliest due, then case key; `nextCursor` null on the last page                  | N/A                                     |
| Fresh intake                      | Member reports a post, moderator reads the queue within 5 minutes       | The case is present, `reportCount` counts it, `acceptedAt` is under 300 s old                                     | N/A                                     |
| Grouped post                      | Three members report one post for different reasons                     | One case, `reportCount` 3, `reasons` has the three, risk uses the strongest, reporter bump applies                | N/A                                     |
| Orphan                            | Author erased; `post_id` null, snapshot kept                            | Own case `orphan-post.<id>`, snapshot text shown, media unavailable `target_erased`                               | Never 500                               |
| Filter combination                | `source=comment&locale=es-419&risk=high&sla=at_risk`                    | Only matching cases; locale from snapshot, then live row, else `unknown`                                          | N/A                                     |
| Pagination under change           | A case resolves or changes risk between page 1 and page 2               | Unchanged cases appear exactly once and are not skipped; a changed case may repeat once, the client dedupes       | N/A                                     |
| Bad cursor                        | Tampered, wrong filters, wrong version                                  | 400 `invalid_cursor`                                                                                              | Closed code                             |
| Bad filter                        | `risk=critical`, `limit=500`                                            | 400 `invalid_filter`                                                                                              | Closed code                             |
| Wrong role                        | Guardian or teen token, any case id                                     | 403 `Insufficient role`, same body for real and unknown ids                                                       | N/A                                     |
| No token                          | Missing or malformed bearer                                             | 401                                                                                                               | Existing guard                          |
| Flag off                          | Moderator, `moderation_console_enabled` false                           | 503 `moderation_console_disabled`, console shows the disabled state                                               | No case data in body                    |
| Unknown case                      | Moderator, malformed or unknown id                                      | 404 `case_not_found`                                                                                              | Same body for malformed and unknown ids |
| Detail, post with machine finding | Flagged post with `moderation_reason` `text_policy_match` plus a report | `findings` has the code, its category and `engineVersion`; risk raised one level                                  | N/A                                     |
| Operator-written reason           | `moderation_reason` is free text from a takedown                        | Shown as `operatorNote`, not as a screening code, no risk bump                                                    | N/A                                     |
| Comment case                      | Report on a published comment                                           | Snapshot body and locale, current status, parent context when live, `CommunityCommentAudit` rows as prior actions | N/A                                     |
| Snapshot unavailable              | Comment report with `{unavailable:true}`                                | Content block says unavailable; case still ordered and openable                                                   | N/A                                     |
| Media signing fails               | Storage returns an error                                                | `media:{state:'unavailable', reason:'signing_failed'}`, rest of the detail intact                                 | One closed-code log line, no URL        |
| Already resolved                  | All reports have `resolved_at`                                          | `status:'resolved'`, `slaState:'resolved'`, hidden from the default queue, visible with `status=resolved`         | N/A                                     |
| Moderator is party                | Moderator authored the target or filed a report                         | `viewerConflict:true`; the console shows a notice                                                                 | Read still allowed; 6.11 enforces       |
| Hostile reporter text             | `details` contains markup or very long unbroken text                    | Rendered as inert plain text, wrapped, no layout break                                                            | N/A                                     |
| Clock skew                        | Client clock 10 minutes ahead                                           | Countdown uses `serverNow` offset and shows the true remaining time                                               | N/A                                     |
| Audit write fails                 | `AuditLog` insert errors on a detail read                               | The read fails closed with 503 `audit_unavailable`; no case data returned                                         | Closed code                             |

</frozen-after-approval>

## Code Map

Verified against `main` at `b959e4c6`.

- `packages/db/prisma/schema.prisma`
  - `CommunityPostReport` (:724): `post_id?`, `reporter_id?`, `reason`, `details?`, `content_snapshot` (`{caption, altText, locale, climateBand, capturedAt}` from `buildCommunityContentSnapshot`), `subject_alias`, `image_object_path`, `sla_due_at`, `created_at`, `resolved_at`. Unique `(post_id, reporter_id)`, index `(resolved_at, sla_due_at)`.
  - `CommunityCommentReport` (:1655): `comment_id?`, `reporter_id?`, `reason`, `content_snapshot` (`{body, locale}` or `{unavailable:true}`), `accepted_at`, `routed_at`, `sla_due_at`, `resolved_at`. Same unique and index shape. No `details` column.
  - `LookbookPost` (:593): `status`, `moderation_reason`, `moderation_engine_version`, `image_object_path`, `locale`, `climate_band`, `anonymized_at`, `erasure_requested_at`, `objects_purged_at`.
  - `CommunityComment` (:1600): `status`, `screening_reason`, `screening_version`, `body`, `locale`, `parent_id`.
  - `ModerationEvent` (:958): post-scoped prior actions (`flagged`, `released_by_operator`, takedown, `reported`). `CommunityCommentAudit` (:1674): comment-scoped actions by `report_id`.
  - `CommunityAlias` (:707): reporter and subject pseudonym. `AuditLog` (:998): CC-1.4 audit row.
- `apps/api/src/modules/community/community.repository.ts` -- `recordReport` (:712) writes the post report, the snapshot (`buildCommunityContentSnapshot`, :791) and a `reported` `ModerationEvent`. The queue must exclude `reported` events from prior actions, because they duplicate reports.
- `apps/api/src/modules/community/community-comments.repository.ts` -- `report` (:456) writes the comment report, its snapshot and the first audit row `reported`.
- `apps/api/src/modules/community/community.service.ts` -- `REPORT_SLA_HOURS = 24` (:121). 6.10 reads `sla_due_at` and never recomputes the 24 hours.
- `apps/api/src/modules/community/community-audit-snapshot.ts` -- snapshot shape and the privacy rule that it holds no user id or location.
- `apps/api/src/modules/community/community-moderation.processor.ts` -- writes `moderation_reason` (joined codes, or `flagged_by_screening`) and `moderation_engine_version` on flag (:500-:520).
- `apps/api/src/modules/community/community-moderation.actions.ts` -- operator actions with no HTTP path. Its header comment names this story's predecessor and the missing console. Update that comment to point at 6.10 for reads and 6.11 for writes.
- `apps/api/src/modules/community/community-cursor.ts` -- signed cursor pattern to copy (HMAC via `requireAnalyticsIdSecret`, `timingSafeEqual`, closed `invalid_cursor`).
- `apps/api/src/modules/community/community-storage.adapter.ts` -- `signReadUrl(path, seconds)` (:75); exported by `CommunityModule` as `SupabaseCommunityStorageAdapter`.
- `apps/api/src/modules/moderation/moderation.{controller,service,module}.ts` -- existing `@Roles('moderator','admin')` write-only controller. Add the two read routes here, with a separate service and repository so `recordAction` stays untouched. The module must import `CommunityModule` for storage, `FeatureFlagsModule`, and Prisma.
- `apps/api/src/modules/auth/{security.guards,security.decorators,security.types}.ts` -- `RequestAuthGuard`, `RolesGuard`, `Roles`, `ApiRole`. `access-token-identity.service.ts:resolveVerifiedIdentity` reads the role from `app_metadata`.
- `apps/api/src/modules/commerce/community-sponsorship-operator.service.ts` -- precedent for operator audit rows (`tx.auditLog.create`, :168, :231).
- `packages/api-client/src/contracts/http/{moderation,community,index,openapi}.ts` -- existing moderation contract, `COMMUNITY_MODERATION_REASON_CATEGORY` and `communityModerationReasonCategories()` (reuse for finding categories), `communityReportReasonSchema`, registry wiring. `docs/http.openapi.json` and `src/generated/{apis,models}` regenerate.
- `packages/config/src/flags.ts`, `packages/db/prisma/seeds/feature-flags.ts`, `apps/api/src/modules/feature-flags/feature-flags.service.ts` -- flag declaration, dev seed, evaluation (`getFeatureFlag(flag, userId)`).
- `packages/db/test/rls/community-posts.spec.ts` (:66 and :359-:361) and `harness.ts:98-100` -- existing proof that `anon` and `authenticated` cannot touch `CommunityPostReport`, `CommunityCommentReport`, `CommunityCommentAudit`, `ModerationEvent` and `CommunityAlias`. `ModerationEvent` is already enumerated. The repository exports `MODERATION_QUEUE_READ_TABLES` and the RLS spec iterates it (TEA-02).
- `AuditLog` (`20260420160000_harden_audit_log_immutability`) -- `user_id` is a RESTRICT foreign key to `User`, rows are immutable (UPDATE, DELETE, TRUNCATE raise), `authenticated` holds SELECT only. A moderator id with no `User` row fails the insert and surfaces as `audit_unavailable` (TEA-12).
- Comment reports have no `subject_alias` and no `details` column. The comment subject alias comes from the live author's `CommunityAlias`, `erased` when the author is gone (TEA-03). Reporter aliases are created lazily and a read never writes one, so a reporter with no alias row reads `unknown` (TEA-04).
- `CommunityCommentAudit` starts every report with an `reported` row. Exclude it from prior actions exactly like the `ModerationEvent` `reported` rows (TEA-05).
- `apps/web/src/app/{guardian/dashboard,community}`, `src/lib/{api-client,web-session}.ts`, `src/app/components/session-bridge.tsx`, `src/i18n/{index.ts,locales/*.json,community-locales.spec.ts}` -- page, session and catalog patterns. `apps/web` has no admin or moderation route today.
- `pact/http/consumer/interactions/*`, `consumer/web-api-client.pacttest.ts`, `provider/state-handlers.ts`, `provider/doubles/*` -- contract tests.
- `playwright/tests/api/auth-moderation-security.spec.ts` -- role-matrix precedent for the moderation route.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/config/src/flags.ts`, `packages/config/src/flags.spec.ts`, `packages/db/prisma/seeds/feature-flags.ts` -- flag `moderation_console_enabled`, default false, seed true -- D4.
- [ ] `packages/api-client/src/contracts/http/moderation-queue.ts` (new), `index.ts`, `openapi.ts` -- strict schemas: filters, cursor, case summary, case detail, closed error codes; `deriveCaseRisk`, `deriveSlaState`, `SLA_AT_RISK_WINDOW_MS`; register both paths with 200, 400, 401, 403, 404, 503 -- D3, D5, D6.
- [ ] `packages/api-client/docs/http.openapi.json`, `src/generated/apis/ModerationApi.ts`, `src/generated/models/index.ts` -- regenerate with `npm run generate:api-client`; no hand edits -- contract.
- [ ] `apps/api/src/modules/moderation/moderation-queue.repository.ts` (new) -- one SQL path per D1 and D7: union of the two report tables grouped by case key, computed `risk_rank`, earliest open due, filters and keyset in the query; detail loader for snapshot, live target, findings, alias, prior actions -- D1, D5, D7.
- [ ] `apps/api/src/modules/moderation/moderation-queue.service.ts` (new) -- risk and SLA mapping with one clock read, finding parsing through `communityModerationReasonCategories`, media signing and its closed failure reasons, reporter alias mapping, `viewerConflict`, the D10 audit write in the same request, fail closed on audit failure -- D6, D8, D9, D10.
- [ ] `apps/api/src/modules/moderation/moderation-queue-cursor.ts` (new) -- signed, versioned, filter-bound cursor -- D7.
- [ ] `apps/api/src/modules/moderation/moderation-queue.controller.ts` (new), `moderation.module.ts` -- the two routes, guards, role set, flag check after the role check, `Cache-Control: private, no-store`, imports of `CommunityModule` and `FeatureFlagsModule` -- D3, D4.
- [ ] `apps/api/src/modules/community/community-moderation.actions.ts` -- update the header comment only -- keep the repo's record truthful.
- [ ] `apps/web/src/lib/moderation.ts` (new) -- typed client over the generated SDK with the session token, closed-state mapping (forbidden, disabled, not found, unavailable), server-clock offset -- D12.
- [ ] `apps/web/src/app/moderation/page.tsx`, `apps/web/src/app/moderation/cases/[caseId]/page.tsx`, `apps/web/src/app/components/moderation-queue.tsx`, `moderation-filters.tsx`, `moderation-case-detail.tsx`, `moderation-sla-countdown.tsx` (new) -- queue with filter bar, load-more keyset paging, case view with content, media, findings, reporters, prior actions and countdown -- D12.
- [ ] 10 files `apps/web/src/i18n/locales/*.json`, `apps/web/src/i18n/moderation-locales.spec.ts` (new) -- `moderation` namespace and parity, including enum coverage from the contract -- D12.
- [ ] Tests (every test ID below, written first against the contract and watched fail).
- [ ] `apps/api/src/modules/moderation/moderation-queue.repository.ts` exports `MODERATION_QUEUE_READ_TABLES`; `packages/db/test/rls/community-posts.spec.ts` iterates it for `anon` and `authenticated` (`ModerationEvent` is already enumerated, so no list edit is needed) -- AC3, TEA-02.
- [ ] `pact/http/consumer/interactions/moderation.ts` (new), `shared.ts`, `web-api-client.pacttest.ts`, `provider/state-handlers.ts`, `provider/doubles/moderation.ts` (new) -- queue, detail, 403, 503 interactions -- contract.
- [ ] `playwright/tests/moderation-console.spec.ts` (new), `playwright/tests/api/auth-moderation-security.spec.ts` -- role matrix on the new routes, keyboard path, light and dark, 375 and 1280 widths, axe -- AC2, AC3.
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- set `6-10-moderator-queue-case-detail: in-progress` when the build starts, `review` when it ends.
- [ ] `_bmad-output/implementation-artifacts/epic-6-context.md` -- say 6.10 is the current story when the build starts.

**Test IDs (TEA refined these; the Test Design (TEA) section below and the test design file hold the full 78-scenario list and win on any disagreement):**

| IDs                                                                                                      | Level       | Pri | File                                                                                  |
| -------------------------------------------------------------------------------------------------------- | ----------- | --- | ------------------------------------------------------------------------------------- |
| U-Q-RISK-RULES, U-Q-SLA-STATES (U-Q-RISK-PARITY moved to the integration row, TEA-01)                    | Unit        | P0  | `packages/api-client/testing/moderation-queue-contract.spec.ts`                       |
| U-Q-CURSOR (tamper, filters, version)                                                                    | Unit        | P0  | `apps/api/src/modules/moderation/moderation-queue-cursor.spec.ts`                     |
| U-Q-SVC-FINDINGS, -MEDIA, -ALIAS, -AUDIT-FAILCLOSED, -CONFLICT                                           | Unit        | P0  | `apps/api/src/modules/moderation/moderation-queue.service.spec.ts`                    |
| U-Q-CTRL-ROLES, -FLAG-ORDER, -HEADERS, -NO-ORACLE                                                        | Unit        | P0  | `apps/api/src/modules/moderation/moderation-queue.controller.spec.ts`                 |
| I-Q-ORDER, I-Q-GROUP, I-Q-ORPHAN, I-Q-FILTERS, I-Q-KEYSET-TIES, I-Q-PAGING-UNDER-CHANGE, I-Q-RISK-PARITY | Integration | P0  | `apps/api/integration/moderation-queue.integration.spec.ts` (new)                     |
| I-Q-INTAKE-5MIN (real report route to queue read)                                                        | Integration | P0  | same                                                                                  |
| I-Q-READONLY (row counts and `updated_at` unchanged except one audit row)                                | Integration | P0  | same                                                                                  |
| I-Q-PLAN (`EXPLAIN` uses the `resolved_at, sla_due_at` index at 5,000 open reports)                      | Integration | P1  | same                                                                                  |
| D-RLS-DENIED (anon, authenticated)                                                                       | DB          | P0  | `packages/db/test/rls/community-posts.spec.ts`                                        |
| C-Q-PACT (queue, detail, 403, 503)                                                                       | Contract    | P1  | `pact/http/consumer/interactions/moderation.ts`                                       |
| U-WEB-Q-CLIENT (clock offset, closed states)                                                             | Unit        | P1  | `apps/web/src/lib/moderation.test.ts`                                                 |
| C-WEB-Q-QUEUE, C-WEB-Q-DETAIL, C-WEB-Q-STATES, C-WEB-Q-HOSTILE-TEXT                                      | Component   | P0  | `apps/web/src/app/components/moderation-*.test.tsx`                                   |
| C-WEB-Q-A11Y (focus order, live region, reduced motion)                                                  | Component   | P1  | same                                                                                  |
| U-WEB-Q-LOCALES                                                                                          | Unit        | P1  | `apps/web/src/i18n/moderation-locales.spec.ts`                                        |
| P-Q-ROLES, P-Q-KEYBOARD, P-Q-THEMES-WIDTHS, P-Q-AXE                                                      | E2E         | P0  | `playwright/tests/moderation-console.spec.ts`, `api/auth-moderation-security.spec.ts` |

**Acceptance Criteria:**

- Given a moderator or admin token, when the queue is requested, then it returns cases ordered by risk, earliest due and case key, filtered by source, locale, risk, status and SLA state, with a signed keyset cursor and `serverNow`.
- Given a guardian, teen, anonymous or unknown caller, when either route is requested, then no case data is returned, the 403 body is identical for real and unknown case ids, and the flag state is not revealed to non-moderators.
- Given a case detail, then it returns the snapshot and the live state of the target, machine findings with category and engine version, reporter aliases with reason and details, prior actions with kind and time, the SLA state with time remaining, and short-lived media.
- Given a member report accepted at time T, when a moderator reads the queue before T + 5 minutes, then the case is present.
- Given the whole story, then no moderation read path uses a direct database client: the web console calls only the API, and `anon` and `authenticated` database roles are denied on every table the routes read.
- Given any detail read, then exactly one `moderation_case_viewed` audit row exists for it, and an audit failure returns no case data.
- Given the console on desktop and mobile in light and dark, then every state in the Always list renders, focus order is logical, the countdown never floods assistive technology, and axe reports no serious or critical violation.
- Given the PR, then it changes fewer than 100 files, generated files included, and every PR job stays under 20 minutes.

## Implementation Notes

- Cases are grouped in one SQL statement in `moderation-queue.repository.ts`: a union of the two report tables, aggregated by case key, scored, filtered and paged with the keyset.
  An open case aggregates only its open reports.
  A resolved listing aggregates all reports of cases that have no open report.
  `reportCount` follows the same rule.
- The risk rank in SQL is built from `MODERATION_REASON_RISK_RANK` and `MODERATION_REPORTER_BUMP_THRESHOLD`, the constants `deriveCaseRisk` uses, so the two cannot drift.
  A post finding is a `moderation_reason` whose every code is a key of `COMMUNITY_MODERATION_REASON_CATEGORY`.
- The cursor stores the exact Postgres microsecond text of the due time (`dueKey`), so a tie on the millisecond never skips or repeats a row.
- `MODERATION_QUEUE_CLOCK` is a `Symbol` token whose value is a `() => Date`.
  The service reads it once per request and binds that instant as a SQL parameter.
- The controller owns query parsing (`invalid_filter`) and the flag read, which fails closed to 503 `moderation_console_disabled` when the flag service throws.
  `ModerationQueueCacheHeadersMiddleware` sets `Cache-Control: private, no-store` and `Vary: Authorization` before the guards, so every response carries them.
- Stored values are clamped to the contract bounds before the output parse, so legitimate data can never answer 500 after the audit row is written.
- `MODERATION_QUEUE_READ_TABLES` lives in the import-free `moderation-queue-tables.ts` so the RLS suite in `packages/db` can iterate it without loading Nest.
- The web console binds `useTranslation` to `getI18n()` through `useModerationTranslation` in `apps/web/src/lib/moderation.ts`.
  A bare `useTranslation` crashed the first real browser render (SSR has no i18n instance).
- Real-stack walk (2026-11-03): an isolated Postgres database migrated and seeded with the TEA seed, the built API with a mock storage origin, `next dev` with `NEXT_PUBLIC_E2E_AUTH=true`, and a Playwright Chromium run for light and dark at 1280 and 375 widths.
  Fixes found there: the first-render crash above, filter labels that wrapped the select (accessible name included every option), five stacked filters on a phone (now two columns), a duplicate alt text under the image, and the vague "Now" label (now "Current state" in English).
  Screenshots are under `_bmad-output/test-artifacts/story-6-10/builder-*.png`, which the repo's `.gitignore` keeps out of commits (local evidence).
- The generated SDK diff is additive.
  Regenerating at the baseline commit reproduces the committed files exactly, so the churn came from this story.
  Registered in the middle of the path list, the moderation schemas changed the order openapi-generator meets inline schemas.
  It then renamed 13 existing community inline models (for example `CommunityReactionFeedResponseData` and `ApiV1CommunityPostsPostIdGet200ResponseAnyOfData`), which showed as 571 deleted lines in `http.openapi.json` and 994 in `models/index.ts`.
  `registerModerationQueueContracts` now runs right after `registerCommunitySyncContracts` in `openapi.ts`, which keeps every existing model name, and with `git diff --patience` the document and the models show 0 removed lines (`ModerationApi.ts` rewrites one import line).
  The default diff still counts some deletions, because Myers aligns the repeated inline-model blocks against the old ones, but a semantic comparison of `paths` and `components.schemas` shows two paths and three schemas added and nothing changed.
  Register new contracts at the end of the list in `openapi.ts` and check the removed model names after regenerating.
- The two flag counts in `feature-flags.service.spec.ts` moved from 9 to 10 with the new flag.

## Spec Change Log

2026-11-03, TEA (Murat), Task 1 review against the code at `b959e4c6`. The frozen block is unchanged.
Entries marked **Fixed** edit non-frozen text because the code settles the answer.
Entries marked **Ruling** are default decisions the builder implements unless the coordinator overrides.
Entries marked **Intent-level** touch a sentence in the frozen block and need the coordinator's confirmation.
Full reasoning and guards sit in `_bmad-output/test-artifacts/test-design/cc610-moderator-queue-test-design.md`.

- TEA-01 **Fixed.** `U-Q-RISK-PARITY` needs SQL, so it moves from the api-client unit row to the integration row. `U-Q-RISK-RULES` stays pure.
- TEA-02 **Fixed.** `ModerationEvent` is already in the RLS enumeration. The repository exports `MODERATION_QUEUE_READ_TABLES` and the RLS spec iterates it.
- TEA-03 **Fixed.** Comment reports have no `subject_alias`. The comment subject alias comes from the live author's `CommunityAlias`, or `erased`.
- TEA-04 **Fixed.** Reporter alias states are `alias`, `erased` (null `reporter_id`) and `unknown` (no alias row). A read never creates an alias.
- TEA-05 **Fixed.** Prior actions exclude the `reported` row of `CommunityCommentAudit` as well as `ModerationEvent`.
- TEA-06 **Intent-level, confirmed by the coordinator 2026-11-03; D7 and the matrix row amended.** D7 and the "Pagination under change" row say a changed case is never repeated. A stateless keyset cannot guarantee that for a case whose tuple moves behind the cursor. Default ruling: unchanged cases appear exactly once, a changed case appears at most once more, and the web client dedupes by `caseId`. If the owner wants the stronger promise, the cursor needs a snapshot token and a new story.
- TEA-07 **Ruling.** The service reads `serverNow` once and binds it as a SQL parameter, so the `sla` filter and the item `slaState` share one clock. D6 stands.
- TEA-08 **Ruling.** The keyset predicate is an OR chain (or a negated rank) because the sort mixes directions. `case_key` sorts with `COLLATE "C"` in both `ORDER BY` and the predicate.
- TEA-09 **Intent-level, confirmed by the coordinator 2026-11-03; D1 amended.** D1 calls case ids stable. Author erasure nulls `post_id`, so `post.<postId>` becomes one `orphan-post.<reportId>` case per report and the old id returns 404 `case_not_found`. Default ruling: that is the single documented re-key. The console shows the not-found state with a link back. 6.11 treats a decision against a re-keyed case as stale.
- TEA-10 **Ruling.** D12's "a 503 renders the disabled state" applies to `moderation_console_disabled`. `audit_unavailable` and any other 503 render a retryable error state. The web client maps by `code`.
- TEA-11 **Ruling.** Detail order is load, audit insert, sign media, respond. An audit failure never mints a signed URL.
- TEA-12 **Ruling.** `AuditLog.user_id` is a RESTRICT foreign key and the table is immutable. A moderator id with no `User` row gives 503 `audit_unavailable`. Tests use unique moderators and never delete audit rows or users.
- TEA-13 **Fixed.** The closed media reasons are `target_erased`, `anonymized`, `purged`, `no_image`, `signing_failed`. Comment cases use `no_image`.
- TEA-14 **Ruling.** The signed URL lives 120 s. At `expiresAt` (server offset) the console shows an expired-media state with a Reload control. Reload re-reads the detail and writes a new audit row by design.
- TEA-15 **Ruling.** The detail view loads once per navigation. Focus, visibility, online, timer and strict-mode effects never refetch it. The stale state applies to the queue, and a failed user-initiated detail refresh keeps the last good detail with the stale marker.
- TEA-16 **Ruling.** The inert plain-text rendering of D9 covers every user-authored string: reporter details, snapshot caption and alt text, comment body, `operatorNote` and aliases.
- TEA-17 **Ruling.** `content_snapshot` is projected through an allowlist (`caption`, `altText`, `locale`, `climateBand`, `capturedAt`, `body`, `unavailable`). Unknown keys never leave the API. Malformed JSON renders as unavailable.
- TEA-18 **Ruling.** A teen without guardian consent receives the `RequestAuthGuard` 403 `Guardian consent required before continuing`. The I/O row "Wrong role" accepts either 403 body for a teen. The body must still be identical across case ids. Test-token bypass must give 401 in production.
- Defaults RG1 to RG7 (cursor ignores `limit`, released post keeps its finding bump, takedown reason equal to a screening code parses as a finding, resolved listing unindexed, flag stays at the seeded value in shared Playwright databases, case `acceptedAt` is the earliest open report) are listed in the test design.

## Review Triage Log

- 2026-11-03, independent review of `8d6dec34` (13 findings, no blocker). Source findings fixed in `ec279615`, each with a test:
  - 1 major, fixed: a failed reload or refresh kept stale case data whatever the failure. 401, 403, `moderation_console_disabled` and a 404 on a case now clear the data and render the terminal state. Only `unavailable`, `audit_unavailable` and `rate_limited` keep the stale banner.
  - 2 major, fixed: a `<p>` inside the findings `<dl>` failed axe. The held-with-no-code message renders outside the list, and the a11y suite covers empty, full and unknown-category findings.
  - 4 minor, fixed: Load more, Refresh and Reload use `aria-disabled` so focus stays put, and focus moves to the first new case after Load more.
  - 5 minor, fixed: Refresh shows `Refreshing`, ignores a second click and says the list restarted from the first page.
  - 6 minor, fixed: U+200E, U+200F and U+061C show as markers, and a marker an author typed gets an extra backslash so a bare `<U+XXXX>` always means a real control.
  - 7 minor, fixed: an empty alt text reads "No description provided".
  - 8 minor, fixed: 429 is `rate_limited`, an invalid filter keeps the filters visible, an invalid cursor on Load more offers a refresh, a signed-out moderator gets a sign-in link, a 404 on the queue reads as unavailable, a 400 on a case read is a server fault, and the client drops keys a newer server added instead of failing the parse.
  - 9 minor, fixed: the countdown fires at each state boundary as well as each minute, and resyncs when the tab becomes visible or focused.
  - 10 minor, fixed: a new case id clears the old case, and an answer for a case the view has left is dropped.
  - 11 minor, fixed: the service clamps the excerpt to the contract bound without splitting a surrogate pair.
  - 12 minor, fixed: the list and the detail both take the locale of the earliest report (its snapshot locale, else the live target's), and an unusable locale reads as none in both.
  - 3 and 13 belong to TEA.
- 2026-11-03, review round 2 of `e884d62a` (4 new minors, no blocker). Fixed in `9b9435ce` and `ec9afad2`, each with a test:
  - N1: the case Reload control is one element in one place, so keyboard focus survives the stale banner appearing and clearing.
  - N2: the Try again of a failed first load shows `Trying again`, sets `aria-busy` and ignores a second click.
  - N3 and N4 (TEA): the flag independence check and the disabled-body stub can now fail.
  - Design notes: when Load more returns only known cases and the list ends, focus moves to Refresh. `operatorNote` and finding codes are cut without splitting a surrogate pair.
- Decision: finding 8's version-skew item overrides TEA's earlier rule that an extra key makes the console unavailable. The console renders only declared fields, so a dropped key leaks nothing.

## Test Design (TEA)

Full plan, reconciled to this spec (this spec wins on any disagreement):
`_bmad-output/test-artifacts/test-design/cc610-moderator-queue-test-design.md`.
18 risks (8 high); 78 scenarios: P0 40, P1 31, P2 7 (Unit 28, Integration 18, DB 3, Contract 2, Component 13, E2E 12, Manual 2).
10 seeded-defect proofs (S-1 to S-10) run in a throwaway worktree and are recorded under `_bmad-output/test-artifacts/story-6-10/`.
Review findings TEA-01 to TEA-18 are in the Spec Change Log.

Red-first order for the build:

1. Contract schemas and pure derivations, with `U-Q-RISK-RULES`, `U-Q-SLA-STATES`, `U-Q-CONTRACT-STRICT`, `U-Q-CURSOR` red.
2. `seedModerationQueue` helper (one seed for integration, Playwright, pact states and the manual check), then `I-Q-ORDER`, `-GROUP`, `-ORPHAN`, `-FILTERS`, `-KEYSET-TIES`, `-INTAKE-5MIN`, `-READONLY`, `-AUDIT`, `-HTTP`, `-RISK-PARITY` red against missing routes.
3. Controller and service units red, then implementation to green.
4. Component tests red against contract fixtures, then the console.
5. Pact and Playwright last.

Green guards that start passing: `D-RLS-DENIED`, `D-RLS-AUDIT`, `D-NO-MIGRATION`, and the unchanged `POST /api/v1/moderation/actions` role matrix.

Build rules the tests rely on:

- The service takes an injectable clock and reads it once per request.
- Detail order: load, audit insert, sign media, respond.
- One `PlainText` component renders every user-authored string, and one `CaseMedia` component owns the image element.
- The repository exports `MODERATION_QUEUE_READ_TABLES`.
- Pact matchers cover `serverNow`, `expiresAt`, cursors and signed URLs.
- Console axe runs pass the `wcag22a` and `wcag22aa` tags next to the helper defaults.

Lanes: `pr-checks` (units, components, integration, RLS), `contract-testing` (pact, OpenAPI), `pr-pw-e2e-local` (one console spec), local (seeded-defect proofs, manual pixel review).

## Design Notes

**Seams for the next stories (not built here):**

| Story | What it needs from 6.10                                                                                                                                                                       | Where it plugs in                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 6.11  | Stable `caseId` and `reportIds` per case to resolve all open reports at once; `viewerConflict` to refuse self-review; the `screening` source decision (D2); an action area in the detail view | New `POST /cases/:caseId/decisions` beside the read routes, reusing `CommunityModerationActionsService` |
| 6.11  | `resolved_at` is the only status signal today; decisions will need a first-decision timestamp                                                                                                 | 6.11 owns that column or table; the case `status` derivation reads whatever it adds                     |
| 6.12  | `SLA_AT_RISK_WINDOW_MS` and `deriveSlaState` as the single definition; the `(resolved_at, sla_due_at)` index                                                                                  | The scheduled worker imports both; no copy of the thresholds                                            |
| 6.13  | `moderation_case_viewed` audit rows with actor, role, case and source                                                                                                                         | Ingested into the append-only history; named operator attribution is added there                        |

**Why a case groups reports.**
The queue answers "what should I review next".
Seven reports on one post are one decision, so seven rows would push other work out of view and make the highest-risk ordering meaningless.
Orphan reports stay separate because no live target exists to group them under.

**Why risk and SLA are derived on read.**
Both change with time and with new reports.
Storing them adds a writer that 6.11 and 6.12 must keep in sync.
The open set is bounded by the 24-hour SLA, so computing per request is cheap, and `I-Q-PLAN` guards the index use.

**Risk rank (golden example).**

```
base  = max(reason): hate_speech|violence -> 2, harassment|inappropriate_content -> 1, spam|other -> 0
+1 if the target has a screening finding
+1 if distinct open reporters >= 3
rank  = min(base + bumps, 2)        -> low | medium | high
```

**File budget (target under 100, plan about 62).**

| Area                                                                  | Files |
| --------------------------------------------------------------------- | ----- |
| Spec, sprint status, epic context                                     | 3     |
| Flag, seed, flag spec                                                 | 3     |
| Contract, index, openapi                                              | 3     |
| Generated: openapi json, `ModerationApi.ts`, `models/index.ts`        | 3     |
| API: repository, service, cursor, controller, module, actions comment | 6     |
| API specs and integration                                             | 5     |
| Contract unit spec                                                    | 1     |
| DB RLS spec                                                           | 1     |
| Pact: interaction, shared, pacttest, state handlers, double           | 5     |
| Web: client, 2 pages, 4 components                                    | 7     |
| Web tests                                                             | 6     |
| Web locales (10) and parity spec                                      | 11    |
| Playwright: console spec, role matrix                                 | 2     |
| TEA test design                                                       | 1     |
| Headroom for review fixes                                             | 5     |

The ten locale files are the largest block. If review fixes push the count past 90, split the locale catalogs into a stacked follow-up PR and keep English plus the parity spec behind the flag. Do not trim tests.

## Verification

**Commands:**

- `npm exec -w apps/api -- vitest run moderation-queue` and the integration spec `moderation-queue.integration.spec.ts` -- pass.
- `npm exec -w packages/api-client -- vitest run moderation-queue` -- pass.
- `npm exec -w apps/web -- vitest run moderation` -- pass.
- `npm run generate:http-openapi && npm run generate:api-client` -- no diff after the committed regeneration.
- `npm run test:pact` -- pass.
- Playwright with an isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true`: `npx playwright test playwright/tests/moderation-console.spec.ts` -- pass.
- `node scripts/ci/node-test-gate.mjs` for every gate the changed paths touch -- pass.
- tsc in `apps/api`, `apps/web` and `packages/api-client`, counted by code (only the symlink TS2742 is ignorable), and lint -- clean.
- `git diff --name-only main... | wc -l` -- below 100.

**Manual checks:**

- Seed reports (post, comment, orphan, flagged post, three-reporter post), sign in as a moderator, and open `/moderation` at 1280 and 375 widths in light and dark. Check ordering, filters, paging, countdown, media, hostile text, and the forbidden and disabled states. Screenshots go under `_bmad-output/test-artifacts/story-6-10/`.
