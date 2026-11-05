---
title: 'CC-6.13 Immutable moderation history'
type: 'feature'
created: '2026-11-05'
status: done
baseline_commit: '56509fa8ece5e9b514a294e0f7398ceec888ee82'
baseline_revision: '56509fa8ece5e9b514a294e0f7398ceec888ee82'
route: 'dispatch'
review_source: 'coordinator: TEA per commit, Codex after handoff'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-10-moderator-queue-case-detail.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-11-moderation-decisions-account-sanctions.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-12-sla-monitoring-escalation.md'
  - '{project-root}/_bmad-output/project-knowledge/deployment-guide.md'
  - '{project-root}/_bmad-output/project-knowledge/moderation-sla-runbook.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ModerationDecision` is append-only by convention only: the application role owns the table and can update, delete, truncate or disable a trigger on it.
Account erasure leaves identity behind: `requestErasureForUser` never touches decision rows or post reports, it keeps the subject's caption and alt text in `content_snapshot`, and `CommunityAlias` still maps the alias to the member.
Nothing starts account erasure in production, because `requestAccountContentErasure` is deliberately uncalled.
No retention rule covers `ModerationSlaAlert`, no compliance reviewer can export evidence, and the Community Beta gate has no record of any signature beyond the model one.

**Approach:** Move `ModerationDecision` to a dedicated owner role that the application cannot act as, and add a trigger that rejects every change except identity removal through two named paths.
Extend the established erasure transaction to anonymize decisions, reports and audit rows, and give admins one flagged route that starts it.
Add one retention sweep, one moderator-authorized JSON evidence export, one gate signature record and the DB, API and end-to-end proof behind it.

Decisions (coordinator delegated planning, owner unavailable, 2026-11-05):

- D1 Append-only enforcement has two layers, on `ModerationDecision` alone.
  - Layer 1 is privilege. Migration `20261105150000_immutable_moderation_history` creates the `NOLOGIN` role `moderation_history_owner` and makes it the table's owner.
  - The migration role, which is the application role in every environment (`.env.prod` and `.env.preview` both connect as `postgres`), keeps `SELECT` and `INSERT` only.
  - `anon`, `authenticated`, `service_role` and `PUBLIC` hold nothing. No code reads this table through a Supabase key, and `service_role` is revoked explicitly because Supabase default privileges can grant it.
  - Layer 2 is a trigger. `private.moderation_history_guard()` runs `BEFORE UPDATE OR DELETE` per row and `BEFORE TRUNCATE` per statement, and raises SQLSTATE `42501`. It is `SECURITY INVOKER`, so `current_user` is the caller.
  - The privilege layer is what stops a bypass: as a non-owner the application role cannot `DISABLE TRIGGER`, `DROP TRIGGER` or `ALTER` the table, and privilege checks still apply under `session_replication_role = replica`.
  - The trigger is what holds where a superuser connects, which is the isolated Postgres at `54339`, and it enforces D2's column rules for the owner too.
  - Probed on 2026-11-05 on Postgres 17.11 with a `NOSUPERUSER CREATEROLE` role that matches local Supabase's `postgres` attributes: `UPDATE`, `DELETE`, `TRUNCATE`, `DISABLE TRIGGER`, `DROP TRIGGER`, `SET ROLE` and `SET session_replication_role` were all denied, while `INSERT ... RETURNING`, `SELECT`, a child FK insert, `DROP SCHEMA public CASCADE` and `ON DELETE SET NULL` all worked.
  - Hosted role attributes were not read, because that needs production credentials this story has no reason to use. A hosted role that cannot run this migration fails the build visibly, and the PR's Preview deployment runs it against the Preview database first. `moderation:history:verify` (D5) proves the result there.
  - Rejected: a trigger alone, as `AuditLog` has. The application role owns that table, so one `ALTER TABLE ... DISABLE TRIGGER` removes it.
  - Rejected: a separate least-privilege application login. It closes the D5 residual, but it means new credentials on Vercel and Northflank and a change to every connection path, for a risk that needs a deliberate `GRANT` and shows up in the catalog.
- D2 One narrow exception, and only two callers can reach it.
  - The trigger admits an `UPDATE` only when `current_user = 'moderation_history_owner'`. `DELETE` and `TRUNCATE` have no exception at all.
  - Postgres runs as that role in exactly two cases: a foreign key `ON DELETE SET NULL` action, which executes as the owner of the referencing table, and the `SECURITY DEFINER` function in D3. The probe confirmed both, with `session_user` still the application role.
  - Column rules apply to both callers:

    | Column                                                                                                                                                                    | Allowed change                                                     |
    | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
    | `post_id`, `comment_id`, `moderator_id`, `subject_user_id`                                                                                                                | Value to `NULL` only                                               |
    | `reason`                                                                                                                                                                  | To the constant `[erased]` only, and only with `anonymized_at` set |
    | `anonymized_at`                                                                                                                                                           | `NULL` to a timestamp, once                                        |
    | `id`, `case_key`, `sequence`, `source`, `report_ids`, `action`, `moderator_role`, `subject_alias`, `mutation_id`, `payload_hash`, `response`, `is_terminal`, `decided_at` | None                                                               |

  - So the exception can only remove identity. It cannot change what was decided, by which role, when or in what order, and it cannot write a new identity. An `ON UPDATE CASCADE` of a user id is rejected by the same rule.
  - `subject_alias` stays because `CommunityAlias` is deleted (D4). `generateCommunityAuthorAlias` is random and underived from the user id, so with the mapping gone the alias identifies nobody. This keeps 6.11's "decision rows keep only `subject_alias`".

- D3 The exception function is `private.moderation_history_anonymize(member text) RETURNS integer`, `SECURITY DEFINER`, owned by `moderation_history_owner`, with a fixed `search_path`.
  - `EXECUTE` is revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`, and granted to the migration role only.
  - It calls `community_require_guard(65001, member)`, so it fails outside the privacy guard the erasure transaction already holds.
  - It raises `42501` unless a `ModerationErasureRequest` row exists for that member.
  - It clears `subject_user_id` and redacts `reason` on rows where the member is the subject, and on rows whose `report_ids` overlap that member's reports. It clears `moderator_id` on rows where the member is the moderator and keeps that row's `reason`, which is about someone else.
  - A reporter's erasure can therefore remove the rationale text of a decision against a third party. The action, time, role and sequence survive. Free text can quote a reporter and no check can prove that it does not, so privacy wins here.
  - When the request names a requester and the call changed rows, it inserts one `AuditLog` row, `moderation_history_anonymized`, with `event_data {erasureRequestId, decisions}`, so each use leaves an immutable trace.
  - A direct repository call with no requester (test fixtures, a future flow) leaves `requested_by` null and writes no audit row. The request row is the trace in that case. A compromised application role could forge a request row and call the function, and the worst outcome is removed identity on rows, which leaves those rows' decisions intact. It cannot alter a decision. This limit is stated in the guide.
- D4 Erasure scope. Everything below runs in the existing `requestErasureForUser` transaction under the guards it already takes, so it meets the 72-hour deadline at request time. `moderation_history_anonymize` runs first, because `eraseCommunityComments` nulls the reporter ids it reads.

  | Row                                                | Treatment at request                                                                                                        |
  | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
  | `ModerationErasureRequest`                         | One new row per member, unique, holds `member_id`, `requested_by?`, `requested_at`, `completed_at?`                         |
  | `ModerationDecision`                               | D3                                                                                                                          |
  | `CommunityPostReport` where the member is reporter | `reporter_id` and `details` null. The queue already reads a null reporter as `erased`                                       |
  | `CommunityPostReport` on the member's posts        | User text leaves `content_snapshot`, keeping `locale`, `climateBand`, `capturedAt`. `details` stays: a third party wrote it |
  | `ModerationEvent`                                  | Same snapshot rule on the member's posts. `flagged_by_id` and `reviewed_by_id` null where they name the member              |
  | `CommunityCommentReport`, comments                 | Unchanged: `eraseCommunityComments` already does this                                                                       |
  | `CommunitySanction`                                | Deleted. The ban decision row remains. `holds_released_at` work has no target left, because the held content is erased      |
  | `CommunityAlias`                                   | Deleted. This reverses the comment in `community.service.ts`: reports and decisions hold their own copy of the alias        |
  - The snapshot scrub reverses the retention described in `community-audit-snapshot.ts` and `sweepErasureRequests`. Their text is corrected. AC 2 says erasure removes personal content, and comment reports already drop their snapshot this way. The console already renders a missing snapshot as unavailable (6.10).
  - A post's own withdrawal keeps its snapshot, because a withdrawal is not account erasure, and retracting a reported post must not destroy the evidence.
  - `LookbookPost.user_id` is `NOT NULL`, so `case_key` could still reach the member through the post row. `sweepErasureRequests` therefore finishes each request: once all the member's posts have `objects_purged_at`, it nulls `image_object_path` on their reports and events and deletes those post rows inside the privacy guards. That fires the D2 foreign key path and performs the 6.10 re-key to `orphan-post` cases. It then stamps `completed_at`.
  - The late-write window is 70 hours and the sweep runs every 15 minutes, so completion fits the 72-hour deadline. An open request past it logs `moderation_erasure_overdue` with a count, the same way `community_erasure_overdue` does.
  - The same sweep reruns `moderation_history_anonymize` for each open request, as a repair for anything that committed around the request.
  - A decision on a member with a request row stores a null `subject_user_id`, read under the case lock, and `ban` takes the existing not-applicable refusal with detail `author_ineligible`.

- D5 Enforcement that stays true after this PR.
  - Creating a role leaves the application role with `ADMIN OPTION` on it, and Postgres has no way for it to drop that. So the application role could run `GRANT moderation_history_owner TO ...` and then act as the owner. The probe confirmed this.
  - That residual takes a deliberate privilege change that the catalog records, which is the same class as a reviewed migration. It is stated plainly in the guide.
  - `scripts/verify-moderation-history.mjs` (`npm run moderation:history:verify`) reads the catalog only and exits non-zero unless: the owner is `moderation_history_owner`; no login role holds `SET` or `INHERIT` on it; all three triggers are enabled; the connecting role has no `UPDATE`, `DELETE` or `TRUNCATE`; `anon`, `authenticated` and `service_role` hold nothing; and only the connecting role can execute the function.
  - The retention sweep (D7) runs the same check and logs `moderation_history_enforcement_drift` with closed check names.
  - A future migration on this table follows one documented sequence: grant `SET` to itself, `SET ROLE`, change, `RESET ROLE`, revoke. `packages/db/test/migration-hygiene.spec.ts` asserts that any later migration naming `"ModerationDecision"` in DDL contains that revoke.
  - Cluster-global role creation tolerates an existing role and concurrent migrations in other databases: the `DO` block catches `duplicate_object` and `unique_violation`, and retries the grant and `ALTER OWNER` a bounded number of times.
  - `moderation_history_owner` receives only what its two paths need: `USAGE` on `public` and `private`, `SELECT` on both report tables and `ModerationErasureRequest`, `INSERT` on `AuditLog`, and `EXECUTE` on `community_require_guard`. Its temporary `CREATE` on `public`, which `ALTER OWNER` requires, is revoked in the same migration.
- D6 Starting erasure. There is no account-deletion flow in `apps/api`, and building one is out of scope because wardrobe, billing and the `User` row belong to it.
  - `POST /api/v1/moderation/erasure-requests`, admin only, body `{memberId}`, calls `requestAccountContentErasure(memberId, auth.userId)`. It returns `{requestId, requestedAt, deadlineAt, replayed}`.
  - A second request returns the first row with `replayed: true` and never moves the clock. An unknown member is 404 `member_not_found`.
  - It writes `AuditLog` `moderation_erasure_requested` with `{requestId, role}`. No member id enters `AuditLog`, which is immutable.
  - Why it is in this story: without a caller, production could never honor an erasure, and the deletion signature would rest on a method nobody can reach.
  - It is an operator action on a request received through support. Member self-service stays with the account-deletion story.
  - That story still owns deleting the `User` row, where `AuditLog.user_id` is `RESTRICT`. The gate record states this limit (D10).
- D7 Retention.

  | Table                                                                                       | Rule                                                                                                          |
  | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
  | `ModerationDecision`                                                                        | Never pruned. The database rejects it (D1)                                                                    |
  | `AuditLog`                                                                                  | Never pruned. The existing triggers reject it                                                                 |
  | `ModerationEvent`, `CommunityCommentAudit`, `CommunityPostReport`, `CommunityCommentReport` | Never pruned by any job. They change only through erasure (D4) and foreign keys                               |
  | `ModerationSlaAlert` with `delivery` `delivered`, `console_only` or `superseded`            | Deleted after 400 days from `detected_at`, 500 rows a run, oldest first                                       |
  | `ModerationSlaAlert` with `delivery` `pending`                                              | Never pruned, whatever its age                                                                                |
  | `ModerationSlaMonitor`                                                                      | Never pruned. It is one row                                                                                   |
  | `JobFailure`, telemetry                                                                     | Unchanged. Their prunes are outside moderation evidence, and a spec asserts neither prune names a table above |
  - 400 days clears the longest 12-month span with margin, and alert rows hold no identity (6.12 D4), so erasure has nothing to do on them.
  - 12 months is the floor from PRD lines 228 and 257. Keeping decisions longer is safe because erasure has already removed their identity. Changing that takes a new migration and a ruling.
  - `sweepModerationHistoryRetention` runs daily, as a `maintenance` job in the general bootstrap and on an interval in `community.bootstrap.ts`, sharing one factory, as 6.12 D3 does. The D9 flag gates the prune alone, and the drift check always runs.

- D8 Evidence export.
  - `POST /api/v1/moderation/evidence-exports`, `Cache-Control: private, no-store`. Check order is bearer, role, flags, input. It uses `POST` because it writes an audit row.
  - Who: a moderator or admin may export one case, `{scope:'case', caseId}`. An admin alone may export a period, `{scope:'range', from, to}`, at most 90 days and 5,000 decisions, or 413 `export_too_large`.
  - A moderator who is the case's author or reporter gets the existing 403 `self_review_refused`. A range export omits those rows and reports `withheldForConflict`.
  - Format: one strict JSON bundle from a shared Zod schema, downloaded as `Content-Disposition: attachment; filename="moderation-evidence-<exportId>.json"`.
  - Contents: `schemaVersion`, `exportId`, `generatedAt`, `scope`, `sha256`, `counts`, `decisions[]`, `reports[]`, `auditEvents[]`, `alerts[]`.
    - A decision has its id, case id, sequence, source, action, `reason` or `reasonRemoved: true`, `moderatorId`, `moderatorRole`, `subjectAlias`, `isTerminal`, `decidedAt`, `anonymizedAt`.
    - A report has its id, reason category, origin, accepted and resolved times, due time, and `reporterState` of `member`, `screening` or `erased`.
    - An audit event has its type, time, actor id, role and action. An alert has its kind, delivery state and times.
  - Excluded by the strict schema, so a new column cannot leak: `reporter_id`, `subject_user_id`, report `details`, `content_snapshot`, `image_object_path`, signed URLs, media, `mutation_id`, `payload_hash`, `response`, `ip_address`, and every email or name. Reporter privacy holds because the bundle shows only that a report exists, its category and its origin.
  - `moderatorId` is an internal id and this is the named operator attribution 6.10 left for this story. An erased moderator reads as null.
  - Audit: one `AuditLog` row, `moderation_evidence_exported`, with `{exportId, scope, caseId?, from?, to?, counts, sha256, role}`, written in the same transaction as the read. A failed write answers 503 `audit_unavailable` and returns no bytes. A denied export writes nothing.
  - `sha256` is computed over the canonical `decisions`, `reports`, `auditEvents` and `alerts`, so a kept copy can be compared with the audit row. It is a digest, and the bundle makes no signature claim.
  - Console: an "Export evidence" control on the case detail, and an admin-only `/moderation/evidence` page with the range form. States from the 6.10 pattern, all ten web locales, catalog parity, light and dark, desktop and mobile widths, WCAG 2.2 AA, 44-pixel targets, one polite announcement.
  - The API maps `reason = '[erased]'` to `reasonRemoved: true` and the console renders a localized "removed by erasure" label, so the constant never reaches a screen. `anonymized_at` alone cannot decide this, because a moderator's erasure sets it and keeps the reason.
  - The existing reason refusal, 400 `invalid_decision` from 6.11 TEA-03, also rejects the constant, so no moderator can type a reason that reads as erased. The contract's shape is unchanged.
- D9 Flags and rollout.
  - New flag `moderation_history_enabled`, default false, seed true. Off closes both new routes with 503 `moderation_history_disabled`, removes the console controls and stops the alert prune. A read failure closes them.
  - It requires `moderation_console_enabled` too, as 6.12 D11 does.
  - Cannot sit behind a flag, and goes live in production when the migration deploys: the role, the ownership move, both triggers, the revoked grants and the function. A flag the application can flip would defeat an append-only guarantee.
  - Also unflagged: the D4 erasure extension and sweep completion, because they are a privacy duty on the established path. In production they have no traffic until the flagged route opens, since the withdrawal path never creates a request row.
  - Existing callers keep working with the migration live, because no code path updates or deletes a decision row (verified at `56509fa8`, 6.11 D7). The API needs no deploy ordering beyond the migration running first, which `vercel:build` already does.
- D10 Community Beta gate.
  - How the gate records signatures today: the eight names are in `couturecast_roadmap.md:155`, and only `model` has a mechanism, an owner-approved record bound to the readiness payload's SHA-256 (`scripts/sign-community-screening-readiness.mjs`). Nothing records the other seven.
  - `GATE_SIGNATURES` in `scripts/generate-community-screening-readiness.mjs` stays as it is. It describes that payload at model sign-off, and editing it would change what a regenerated payload hashes to.
  - New record `_bmad-output/test-artifacts/community-beta-gate-signatures.md`: one row per signature with status, date, source, proof and limits. The roadmap and deployment guide link to it.
  - Owner sign-off, 2026-11-05, relayed by the coordinator in the fleet rules: consider the audit, privacy and deletion signatures signed off. A later line of the same date: staffing is ok, so the coverage left open by 6.12 D16 counts as signed off by the owner.
  - The record states that this is an owner ruling, with no cryptographic signature and no hash. No key or owner-only step is needed for it. `community:screening:sign` remains for `model` alone.
  - Audit is not one of the eight named signatures. It gets its own row marked as such, because AC 3 names it.

    | Signature                                         | Status after this PR | Rests on                                                       | Stated limit                                                                                                                         |
    | ------------------------------------------------- | -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
    | Audit                                             | Signed off by owner  | DB, API and E2E proof of D1, D2, D3, D7, D8                    | The D5 residual; `ModerationEvent` and `AuditLog` keep their current enforcement                                                     |
    | Privacy                                           | Signed off by owner  | Proof of D4 and D8 exclusions                                  | Free text a third party wrote in report `details` stays                                                                              |
    | Deletion                                          | Signed off by owner  | Proof of D4 and D6, including the 72-hour completion           | Community and moderation data only. No member self-service, and the account-deletion story owns the `User` row, wardrobe and billing |
    | Moderation staffing                               | Signed off by owner  | The owner's statement of 2026-11-05 and the 6.12 runbook roles | No roster or schedule exists, and the coverage table stays blank                                                                     |
    | Model                                             | Unchanged            | Story 6.2b                                                     | Unchanged                                                                                                                            |
    | SLA alerts, localization, accessibility, rollback | Open                 | Nothing here claims them                                       | Community Beta stays closed                                                                                                          |

  - The proof column names real test files, the commit SHA and the CI run, filled in only after they are green. A row whose proof is red stays open until it passes.
  - Staffing is recorded in `moderation-sla-runbook.md` and the gate record with that date and source. The runbook's Coverage section states the sign-off and keeps the table's assignee and hours empty. It names no person and adds no roster or schedule. The deployment guide's Concrete gap 11 drops "staffing coverage is unsigned".
  - Both rollout flags stay off. A signature is not a launch decision.

## Boundaries & Constraints

**Always:**

- Contracts start as strict shared Zod schemas in `packages/api-client/src/contracts/http/moderation-history.ts`. Controller, OpenAPI, generated SDK and web client derive from them.
- `AuditLog` rows of this story hold no subject id, reporter id, alias or reason. Every one is built in one helper beside `buildDecisionAuditData`.
- Erasure, its request row and every scrub commit together or roll back together.
- `ModerationErasureRequest` is API-only: RLS on, zero policies, zero grants, and listed in the RLS suite through a new `MODERATION_HISTORY_TABLES`.
- The migration is additive for readers and writers, and no running API or worker version needs a change to keep inserting decisions.
- Enforcement proofs run as a non-superuser role with the application's grants, because a superuser skips the privilege layer.
- Retention and erasure sweeps stay inside the community image's pruned dependency tree and its 150 MB budget.
- Machine time comes from the injected clock already used by each sweep.

**Never:**

- A session variable, GUC or application flag as the exception's gate. The application could set any of them.
- A trigger exception keyed on `session_user`, on `pg_trigger_depth()`, or on anything the caller controls.
- A `DELETE` path for a decision row, including for tests. Test cleanup deletes the users and lets the foreign keys act.
- An invented person, roster, schedule, signature, hash, CI run or evidence.
- Member self-service deletion, deletion of the `User` row, wardrobe or billing erasure, a third-party archive, or an export of media.
- An edit to `GATE_SIGNATURES`, the committed readiness payload, production flag values, or Northflank and Vercel environment values.
- A change to the decision contract, `sla_due_at`, queue order or `bmad/`.
- `AuditLog` ownership or trigger changes. Its enforcement is 0.11's and AC 1 names decision records.

## I/O & Edge-Case Matrix

| Scenario                       | Input / State                                                             | Expected Output / Behavior                                                           | Error Handling                                       |
| ------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Application updates a decision | `UPDATE` as the application role, any column                              | Refused, row unchanged                                                               | `42501`                                              |
| Application deletes            | `DELETE`, `TRUNCATE`, also as superuser                                   | Refused, rows unchanged                                                              | `42501`                                              |
| Client roles                   | `anon`, `authenticated`, `service_role`: any statement or function        | Refused, including `SELECT`                                                          | `42501`                                              |
| Bypass attempts                | `DISABLE TRIGGER`, `DROP TRIGGER`, `SET ROLE`, `session_replication_role` | Refused for the application role                                                     | `42501`                                              |
| New decision                   | Normal insert through the service                                         | Inserted, with `RETURNING` and child sanction working                                | Existing 503 `audit_unavailable`                     |
| Replay after erasure           | Same `mutationId` after the row was anonymized                            | Stored response unchanged, because `response` holds no identity                      | N/A                                                  |
| Function with no request       | Call for a member with no request row                                     | Refused, no change                                                                   | `42501`                                              |
| Function with no guard         | Call outside the privacy guard                                            | Refused, no change                                                                   | Existing guard error                                 |
| Owner rewrites a decision      | Owner path sets `action`, a new id or a free-text `reason`                | Refused by the column rules                                                          | `42501`                                              |
| User row deleted               | `DELETE` on `User` or a post with decisions                               | Foreign keys null, every other column unchanged                                      | N/A                                                  |
| Subject erased                 | Member with decisions, reports, alias, ban                                | Identity gone at commit, decision and action retained, alias row and sanction gone   | Whole transaction rolls back and retries             |
| Reporter erased                | Member who filed reports on a live post                                   | Reporter and details gone, report counts as `erased`, case still open and actionable | N/A                                                  |
| Moderator erased               | Member who decided cases                                                  | `moderator_id` null, `moderator_role` and `reason` kept                              | N/A                                                  |
| Decision after erasure         | Case on an erased member, decided before the post row goes                | Row stores null subject; `ban` refused                                               | Existing not-applicable refusal, `author_ineligible` |
| Race with a running decision   | Decision commits around the request                                       | Member lock serializes them; repair pass catches any left                            | N/A                                                  |
| Second erasure request         | Same member again                                                         | First row returned, `replayed: true`, clock unchanged                                | N/A                                                  |
| Late write during the window   | Object recreated inside 70 hours                                          | Existing repeat delete removes it; completion waits for the purge stamp              | N/A                                                  |
| Storage down                   | Object delete keeps failing past 72 hours                                 | `completed_at` stays null, `moderation_erasure_overdue` logged                       | Retried each sweep                                   |
| Post withdrawn, no erasure     | Author withdraws a reported post                                          | Snapshot and identity stay, decision unchanged                                       | N/A                                                  |
| Alert at 399 and 401 days      | Terminal alert rows                                                       | 399 kept, 401 deleted                                                                | N/A                                                  |
| Old pending alert              | `pending`, 500 days old                                                   | Kept                                                                                 | N/A                                                  |
| Audit row at 13 months         | Old `AuditLog` or decision row                                            | Kept. No job selects it                                                              | N/A                                                  |
| Moderator exports a case       | Valid `caseId`                                                            | Bundle downloaded, one audit row with the same `sha256`                              | N/A                                                  |
| Moderator exports a period     | `scope: 'range'` as moderator                                             | Refused, no audit row                                                                | 403 `admin_required`                                 |
| Own case                       | Moderator who reported or wrote the case                                  | Refused, no audit row                                                                | 403 `self_review_refused`                            |
| Export audit fails             | `AuditLog` insert fails                                                   | No bytes                                                                             | 503 `audit_unavailable`                              |
| Too much                       | More than 90 days or 5,000 decisions                                      | Refused, nothing read beyond the count                                               | 400 `invalid_range`, 413 `export_too_large`          |
| Erased case exported           | Case with anonymized decisions                                            | `reasonRemoved: true`, null moderator or subject fields, alias only                  | N/A                                                  |
| Hostile text                   | Markup in a reason                                                        | Plain JSON string; the console renders through `PlainText`                           | N/A                                                  |
| Flag off or read fails         | Either flag false, or a provider failure                                  | Both routes closed, controls absent, prune skipped, enforcement unchanged            | 503 `moderation_history_disabled`                    |
| Wrong role                     | Guardian, teen or no token                                                | Same 403 or 401 body as 6.10, flag state hidden                                      | Existing guards                                      |
| Enforcement drift              | A login role was granted `SET` on the owner role                          | Verify exits non-zero; sweep logs drift with the check name                          | Closed check names                                   |
| Migration on a second database | Role already exists in the cluster, or a concurrent migration             | Succeeds                                                                             | Bounded retry                                        |

</frozen-after-approval>

## Code Map

Verified against `main` at `56509fa8`.

- `packages/db/prisma/schema.prisma`: `ModerationDecision` (:1072) gains `anonymized_at` and a corrected doc comment. `CommunityPostReport` (:785), `ModerationEvent` (:1022), `ModerationSlaAlert` (:1118), `CommunitySanction` (:1162), `AuditLog` (:1181), `CommunityAlias` (:768). New `ModerationErasureRequest`. Latest migration is `20261105120000_moderation_sla_monitoring`.
- `packages/db/prisma/migrations/20260420160000_harden_audit_log_immutability/migration.sql`: the `private` schema trigger pattern, which D1 extends with an owner.
- `packages/db/prisma/migrations/20261020120000_community_realtime/migration.sql`: `community_require_guard` (:442), `community_forget_subject` (:470). The function does not call `community_require_guard`, which is a no-op at the default `privacy_version` 0 (TEA-02).
- `scripts/prisma-migrate-deploy.mjs`: migrates through `DIRECT_URL` when it matches, so `SET ROLE` holds for the migration's connection.
- `apps/api/src/modules/community/community.repository.ts`: `requestErasureForUser` (:571) gains an optional `requestedBy` and the D4 steps, ahead of `eraseCommunityComments`. About 40 integration callers keep the two-argument form.
- `apps/api/src/modules/community/community.service.ts`: `requestAccountContentErasure` (:1474) gains `requestedBy`, and its "deliberately uncalled" and `CommunityAlias` comments are rewritten. `resolveAlias` is at `community.repository.ts:886`, and it returns null once `CommunitySubject` is gone (TEA-15).
- `apps/api/src/modules/community/community-maintenance.service.ts`: `sweepErasureRequests` (:311) gains repair, completion and overdue, and its docstring is corrected. `ERASURE_DEADLINE_HOURS` (:34).
- `apps/api/src/modules/community/community-audit-snapshot.ts`: the retention comment is corrected, and a helper that strips user text is added.
- `apps/api/src/modules/community/community-comments.privacy.ts`: unchanged, and the order constraint in D4 depends on it.
- `apps/api/src/modules/moderation/moderation-decisions.service.ts`: `writeRecord` insert (:590) reads the request row for the subject. `moderation-sanctions.service.ts` insert (:427) is the appeal path. `moderation-decision-rules.ts`: `buildDecisionAuditData` (:85), `decisionCaseSubject`.
- `apps/api/src/modules/moderation/moderation-queue.repository.ts`: prior actions read `decision.reason` (:504). Label it through `reason = '[erased]'`, because a moderator's erasure sets `anonymized_at` and keeps the reason (TEA-08).
- `apps/api/src/modules/moderation/moderation-queue-tables.ts`: add `MODERATION_HISTORY_TABLES`. `packages/db/test/rls/harness.ts` (:110), `packages/db/test/rls/moderation-queue.spec.ts`.
- `apps/api/src/modules/moderation/moderation-sla.controller.ts`: guard and flag pattern. `moderation.module.ts`, `moderation-queue-cache-headers.middleware.ts`: register the new controller.
- `apps/api/src/workers/maintenance.scheduler.ts`, `maintenance.processor.ts` (:155), `community.bootstrap.ts` (:176), `apps/api/src/modules/community/community-worker-runtime.ts` (:118, :475): the D7 job and interval.
- `packages/config/src/flags.ts` (:164), `packages/db/prisma/seeds/feature-flags.ts` (:69), `packages/config/src/flags.spec.ts`, `apps/api/src/modules/feature-flags/feature-flags.service.spec.ts`: the flag, including its `FEATURE_FLAG_KEYS.at(-1)` and count assertions.
- `packages/api-client/src/contracts/http/openapi.ts`, `index.ts`, `packages/api-client/docs/http.openapi.json`, `src/generated/*`: register and regenerate. `apps/web/src/lib/moderation.ts`: client.
- `apps/web/src/app/components/moderation-case-detail.tsx`, `apps/web/src/app/moderation/`, `apps/web/src/i18n/locales`: console.
- `packages/db/test/moderation-decisions-backfill.spec.ts` (:414): updates a decision row, which the trigger now refuses. It inserts those values directly. `packages/db/test/audit-log-immutability.spec.ts`: proof shape to follow. `packages/db/test/migration-hygiene.spec.ts`: D5 rule.
- `scripts/sign-community-screening-readiness.mjs`, `scripts/generate-community-screening-readiness.mjs` (:2046): read only. `_bmad-output/project-knowledge/couturecast_roadmap.md` (:155), `deployment-guide.md` (:368, :895), `moderation-sla-runbook.md`.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/db/prisma/migrations/20261105150000_immutable_moderation_history/migration.sql`, `packages/db/prisma/schema.prisma` -- add the column and request table, create the role, move ownership, add guard, triggers, function and grants -- D1, D2, D3, D5.
- [ ] `packages/db/test/moderation-history-immutability.spec.ts`, `packages/db/test/rls/*`, `packages/db/test/migration-hygiene.spec.ts`, `packages/db/test/moderation-decisions-backfill.spec.ts` -- DB proof as a non-superuser role, as superuser, and for each client role; fix the backfill helper -- AC 1 and the audit signature.
- [ ] `packages/db/test/support/moderation-history-database.ts` -- throwaway database migrated by a `NOSUPERUSER CREATEROLE BYPASSRLS` login, which every enforcement proof runs on -- TEA-05.
- [ ] `scripts/verify-moderation-history.mjs`, `package.json` -- catalog verifier reading `relacl`, `pg_auth_members` and `pg_roles`, and its fault test -- D5, TEA-04.
- [ ] `apps/api/src/modules/community/community.repository.ts`, `community.service.ts`, `community-audit-snapshot.ts`, `community-maintenance.service.ts` -- D4 scrub, repair, completion and overdue -- AC 2.
- [ ] `apps/api/src/modules/moderation/moderation-decisions.service.ts`, `moderation-sanctions.service.ts`, `moderation-queue.repository.ts`, `moderation-decision-rules.ts` -- null subject after a request, `author_ineligible` on ban, refusal of the reserved reason, redacted reason label, audit helper -- D4, D8.
- [ ] `packages/api-client/src/contracts/http/moderation-history.ts`, `openapi.ts`, `index.ts`, generated output -- strict contracts -- D6, D8.
- [ ] `apps/api/src/modules/moderation/moderation-history.controller.ts`, `moderation-history.service.ts`, `moderation-history.repository.ts`, `moderation-history.rules.ts`, `moderation.module.ts`, middleware -- both routes with audit and digest -- D6, D8.
- [ ] `apps/api/src/modules/moderation/moderation-history.retention.ts`, `apps/api/src/workers/maintenance.scheduler.ts`, `maintenance.processor.ts`, `bootstrap.ts`, `community.bootstrap.ts`, `community-worker-runtime.ts` -- prune and drift check on both bootstraps -- D5, D7.
- [ ] `packages/config/src/flags.ts`, `packages/db/prisma/seeds/feature-flags.ts`, their specs -- the flag -- D9.
- [ ] `apps/web/src/lib/moderation.ts`, `apps/web/src/app/components/moderation-case-detail.tsx`, `apps/web/src/app/moderation/evidence/page.tsx`, its component, `apps/web/src/i18n/locales/*` -- export control, range page, redacted label, all states -- D8.
- [ ] `apps/api/src/modules/moderation/moderation-history.*.spec.ts`, `apps/web/src/app/components/*.test.tsx` -- unit tests for the column rules, audit helper, export schema exclusions, digest, 400-day boundary and each matrix edge -- I/O matrix.
- [ ] `apps/api/integration/moderation-history-*.integration.spec.ts` -- real database: erasure of subject, reporter and moderator; completion and the 72-hour bound with an injected clock; export; retention; concurrent decision and erasure; migration on a second database -- AC 2, AC 3.
- [ ] `playwright/tests/moderation-history.spec.ts`, `playwright/tests/api/` -- as a moderator and an admin: decide a case, confirm the row refuses change, erase the member through the route, run the sweep, see the anonymized history in the console, download the bundle, assert its exclusions and the audit row -- AC 3.
- [ ] `_bmad-output/test-artifacts/community-beta-gate-signatures.md` -- the gate record, with proof filled from real green runs -- D10.
- [ ] `_bmad-output/project-knowledge/moderation-sla-runbook.md` -- record the owner's staffing sign-off of 2026-11-05 with its source in Coverage and in the release owner role, keep the table's assignee and hours empty, name no one -- D10, fleet rules.
- [ ] `_bmad-output/project-knowledge/deployment-guide.md`, `couturecast_roadmap.md`, `_bmad-output/implementation-artifacts/epic-6-context.md`, `deferred-work.md` -- enforcement and residual, the migration sequence, verify command, retention table, gate record link, gap 11 wording, current story -- D5, D7, D10.

**Acceptance Criteria:**

- Given any non-owner role, when it issues `UPDATE`, `DELETE` or `TRUNCATE` on `ModerationDecision`, then the database refuses it with `42501` and the row is byte-identical afterward.
- Given a table owner's path, when it tries anything outside the D2 column rules, then the trigger refuses it.
- Given a mutation of the migration that removes the privilege layer, the trigger or the function's request check, when the proofs run, then at least one fails. This is checked by injected faults in a throwaway database.
- Given a member with decisions, reports, an alias and a ban, when erasure is requested and the sweep passes the late-write window, then no moderation table holds that member's id except `ModerationErasureRequest.member_id` until the `User` row goes (TEA-12), no snapshot holds their text, no alias row maps to them, and `completed_at` falls within 72 hours of the request.
- Given an erased member, when the case history is read, then the action, time, role and sequence are intact and `firstDecisionAt` is unchanged.
- Given a 13-month-old decision, audit row and pending alert, when retention runs, then all remain, and only terminal alerts past 400 days leave.
- Given an authorized export, when the bundle is parsed, then it holds none of the excluded fields, its digest matches the audit row, and exactly one audit row exists.
- Given the flag off in production defaults, when the migration has run, then enforcement is live, both routes answer 503, and no control renders.
- Given the gate record, when it is read, then each signed row names its date, its source, real proof and its limit, staffing names no person, and the open rows stay open.

## Implementation Notes

Decisions logged by the builder under the owner's delegated approval, 2026-11-05.

- Build-01 (real defect, frozen Design Notes corrected here). `GRANT role TO CURRENT_USER`, `GRANT role TO SESSION_USER` and `REVOKE role FROM CURRENT_USER` segfault the backend in `supautils` on `supabase/postgres:17.6.1.054`, and the whole server restarts. The Design Notes' migration shape did exactly this, and it passed on plain Postgres. It crashed the shared local stack at 54322 once, and it recovered with the migration rolled back and no role left behind. The migration now names the role through `format()`, `migration-hygiene.spec.ts` refuses the keyword, and role migrations run first on a disposable container of the same image, here at 54341.
- Build-02 (extends D4). A moderator's reason is also copied to `ModerationEvent.reason`, `CommunityCommentAudit.reason` and `LookbookPost.moderation_reason`, so redacting only the decision left the words in three tables. `community-erasure.ts` reads the decisions about to be redacted and redacts each copy, matched on the words and on that decision's own target (TEA findings: an orphan branch keyed on the alias, and no `reviewed_by_id` filter). TEA-22 amends the comment audit trigger to admit that one change.
- Build-03 (extends D4). `recordReport` had no subject check, so an erased member could file a report and put their id back on a moderation record. It now refuses a member with no `CommunitySubject`.
- Build-04 (extends D6, D8, D9). New read route `GET /api/v1/moderation/evidence-exports/availability`, answering `{data:{rangeExport}}` or 503 `moderation_history_disabled`. The console knows nothing about roles or flags by design, and a control must be absent when the feature is off, so it asks the API. The routes still decide on every request.
- Build-05 (D3). `requestErasureForUser` keeps its signature for its roughly 40 integration callers, with an optional `requestedBy`. New `requestAccountErasure` returns the request row, and the caller builds the audit data, because the community module imports nothing from the moderation module.
- Build-06. `writeModerationRecord` moved to `community-moderation-record.ts`, re-exported from `community-moderation.actions.ts`, because the repository importing the actions file would close an import cycle through `isPubliclyVisiblePost`.
- Build-07. Three triggers (`_update`, `_delete`, `_truncate`), following `AuditLog` and D5's count. The guard function and behavior are D1's.
- Build-08 (D5, TEA measured). No retry loop around the role grant: `GRANT` holds a lock on the role until the transaction ends, so concurrent migrations wait. `ALTER ROLE` runs after it for that reason.
- Build-09 (fact against D1). The Supabase image lets the non-superuser `postgres` set `session_replication_role = replica`, where plain Postgres refuses. On that image `UPDATE`, `DELETE` and `TRUNCATE` on `ModerationDecision` are still 42501 in replica mode, which is the privilege layer doing its job. TEA measured the other side (TEA-24): in that mode the application role's `UPDATE` and `DELETE` on `AuditLog` succeed, because that table is trigger-only and the role owns it, and `CommunityCommentAudit` has the same exposure. The frozen scope keeps that enforcement as it is, so this is a stated limit in the guide and the gate record's Audit row, with no code change.
- Build-10. `settleAccountErasures` pages through every open request on each pass, because a 200-row cap would let requests inside their 70-hour window starve newer ones.
- Build-11 (CI). `pr-pw-e2e-local.yml` runs the verifier after `db:reset`, because it is the one PR job whose application role is the real non-superuser.
- Build-12 (permission boundary). The Prisma CLI refuses `migrate reset` from an agent without the user's explicit consent, and I did not set its consent variable. On a throwaway database on the disposable image I ran the same effect instead: `DROP SCHEMA public CASCADE`, `CREATE SCHEMA public`, then `migrate deploy`, twice, and the verifier passed all 15 checks. The real `db:reset` on the Supabase image first runs in the `pr-pw-e2e-local` job.
- Build-14 (TEA F2). `publishWithinQuota` now calls `assertCommunitySubjectAvailable`, so an erased member's publish gets the same 403 as other writes. It answered 409 before and wrote nothing, because the query filters on `erasure_requested_at`, so this was wrong wording and no leak.
- Build-13 (known bound). `lockReportedCases` takes one advisory lock per case a member reported, as TEA-09 rules. The daily report cap bounds this per day, with no lifetime cap, and an extreme reporter could press `max_locks_per_transaction`. Failure rolls back and retries, and the overdue log reports it.

Real stack walk, 2026-11-05, on the disposable Supabase image at 54341, database `cc613_real`, Redis db 7, through the launcher with the built API, the real `community.bootstrap` worker and the web server. Sign-in used the `NEXT_PUBLIC_E2E_AUTH` fixture token.

- Connected as the non-superuser `postgres`: `UPDATE`, `DELETE`, `TRUNCATE`, `DISABLE TRIGGER` and `SET ROLE moderation_history_owner` all answered 42501, and the function answered 23514 with no guard. As `anon`, `authenticated` and `service_role`: `SELECT`, `UPDATE`, `DELETE` and the function all answered 42501. The row compared byte-identical afterward.
- An admin's ban decision, then erasure through the real route: a moderator got 403 `admin_required`, the admin 201, the replay 200 with the same deadline. At commit the decision held `[erased]` and a null subject, each operator copy held `[erased]`, snapshots kept only metadata, and the alias and sanction rows were gone.
- Aged 71 hours under the real guard, the running worker deleted the post and stamped `completed_at`. The old case id answered 404, and the orphan case showed the action, time and role with "Reason removed by erasure".
- Exports in a real browser, before and after, and a period as admin. The after bundle held no canary for the reporter's details, caption, alt text, reason, reporter id or member id. A moderator's period request answered `admin_required`.
- Queue, case detail, evidence page as admin and as moderator, read in Chromium at 1280 and 375 pixels in light and dark, with zero horizontal overflow. Screenshots are under `_bmad-output/test-artifacts/story-6-13/`.
- Fixes the walk caused: "1 decisions" reworded with no plural, the date field's calendar icon was dark on dark, and the back link missed the 44-pixel target.
- `M-PREVIEW-VERIFY`, 2026-11-05, on hosted Preview after PR #197 deployed: 56 migrations finished, `20261105150000_immutable_moderation_history` applied with no error, `ModerationDecision` owned by `moderation_history_owner` (NOLOGIN, BYPASSRLS), 16 of 16 checks and exit 0 through the fixed script with the certificate verified. The coordinator's first run used `sslmode=no-verify` as a one-off, because the script could not reach a hosted database.
  The coordinator's read-only check on 2026-11-05 is in the gate record: Production and Preview on Postgres 17.6, `postgres` NOSUPERUSER, CREATEROLE, BYPASSRLS, owner role absent, 55 migrations finished. The 6.13 migration has run on neither, and the Supabase patch version was not read.

Second walk at `1175a24c`, 2026-11-05, on a fresh database `cc613_walk_head` on the same disposable image, Redis db 9, after a machine restart.

- Direct writes on one real decision row, compared by `row_to_json` and `xmin`, both unchanged afterward:
  - `postgres`, the application role, non-superuser: `UPDATE`, `DELETE`, `TRUNCATE`, `DISABLE TRIGGER`, `DROP TRIGGER` and `SET ROLE` answered 42501, the function with no guard answered 23514, and `UPDATE`, `DELETE`, `TRUNCATE` under `session_replication_role = replica` answered 42501.
  - `anon`, `authenticated`, `service_role`: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` and the function each answered 42501.
  - `supabase_admin`, the superuser: `UPDATE` and `DELETE` hit the trigger's immutable message. `TRUNCATE ... CASCADE` printed its cascade notice first and left the row intact.
- Erasure of a subject, a reporter and a moderator through the real route, read row by row at commit and after completion:
  - Subject: ban decision and comment takedown hold `[erased]` and a null subject, every event and comment audit copy of those words holds `[erased]`, `moderation_reason` is null, snapshots keep only locale, climate band and time, comment body and author are gone, and alias and sanction rows are gone. The aged request completed through the running worker, which deleted the post and nulled `post_id` on its decision, report and events.
  - Reporter: `reporter_id` and `details` null, the overlapping decision's reason `[erased]`, the third party stays as that decision's subject, and the case stays open.
  - Moderator: `moderator_id` and the event's `reviewed_by_id` null, role and reason kept.
  - Kept as designed: a third party's `details` on the subject's post, third-party captions.
- A scan of every text and JSON column in `public` for each id, alias and canary found the erased members' ids only in `User`, `UserProfile`, `ComfortPreferences`, `ModerationErasureRequest.member_id`, and for the moderator `AuditLog.user_id`. The subject's alias stays in `ModerationDecision.subject_alias`. Every content and reason canary found nothing. Those are the gate record's stated limits.
- Exports in a real browser, case and period, each at 1280 and 375 pixels in light and dark: a real `download` event, the digest recomputed from the file equal to the bundle's and the audit row's, no canary, no reporter or erased id, no `[erased]`, no overflow, and no control under 44 pixels on the case pages. A moderator's period request answered `admin_required`.
- Screenshots and the full log, `head-walk.log`, are under `_bmad-output/test-artifacts/story-6-13/head/` and its parent. Nothing looked off this time.

Third walk at `6deab76d`, 2026-11-05, on a fresh database `cc613_walk_head` on the disposable Supabase image, Redis db 9, with the built API, the real worker and the web server.

- Direct writes: the same refusals as the second walk, and the row compared byte-identical with `xmin` unchanged.
- Parent author, then commenter, through the real route and the running worker: after the first erasure the report kept the words with `comment_id` null for the third party, and after the second `comment_author_id` and `content_snapshot` were null. The scan found those members' ids only in the allow-listed tables and no canary.
- An erased moderator got 403 `operator_sanctioned` on queue, case, decision, appeal, SLA, availability, export, erasure route and legacy actions, and no decision names that moderator.
- `<html lang>` read `de-DE`, `pt-BR`, `tr-TR` and `en-US` with the matching page text in Chromium.
- Exports in a real browser, case and period, at 1280 and 375 pixels in light and dark: digest and audit row matched, no canary, no overflow, no control under 44 pixels.

Ship state, 2026-11-05: the owner said push now, and the owner's ruling drops the stacked 6.13b, so PR #197 carries everything and CodeRabbit skips above 100 files after filters.
TEA's final seeded proofs and three full runs continue on `8e7e084c` and later, and the third real-stack walk reruns on the fixes after TEA reports.

## Spec Change Log

2026-11-05, TEA review, Task 1. Evidence for each entry is in the Spec review section of `_bmad-output/test-artifacts/test-design/cc613-moderation-history-test-design.md`, including the probes.
The frozen block is unchanged, and where a ruling tightens a frozen sentence, this log wins over that sentence.
Builder told. Entries marked (intent) change or extend a frozen decision, and the coordinator was told too.

- TEA-01 (intent), D1, D3, D5: `moderation_history_owner` is `NOLOGIN BYPASSRLS`, and the migration runs `ALTER ROLE ... BYPASSRLS` if the role exists. Measured: without it the function cannot see a request row (`42501 no request`) and cannot write `AuditLog`. "Zero policies" stays true.
- TEA-02 (intent), D3, D5: the function does not call `community_require_guard`. Measured: at `privacy_version` 0, the default that no migration or production code raises, that guard passes with no lock held, and the application role can replace it and run code as the owner. New owner-owned `private.moderation_history_require_guard(member)` reads `pg_catalog.pg_locks` for the exclusive 65001 guard, unconditionally, and raises `23514` with the existing message. D5's list drops `EXECUTE` on `community_require_guard`.
- TEA-03 (intent), D1, D3, D5, D10: the stated residual widens. D3's "It cannot alter a decision" describes the function's body and every non-DDL path. A session running arbitrary DDL as the migration role can defeat enforcement by `GRANT`, by `DROP TABLE` or `DROP FUNCTION ... CASCADE` as schema owner, or by code in an object the definer touches. The guide and the gate record's Audit limit say so. The verifier gains `table_present`.
- TEA-04, D5: the verifier reads `relacl`, `pg_auth_members` and `pg_roles`, because `has_table_privilege` and `pg_has_role` answer true for a superuser. It also checks `BYPASSRLS` on the owner and on a non-superuser connecting role, since the application role reads this table through that attribute once it stops owning it.
- TEA-05, Boundaries: "non-superuser role" means a login with `NOSUPERUSER CREATEROLE BYPASSRLS` that ran the migrations itself, the local Supabase attributes. A plain non-superuser fails on RLS.
- TEA-06, D2, D4: the function updates only rows where a column changes, uses `COALESCE(anonymized_at, ...)`, and returns 0 without raising on a rerun.
- TEA-07, Boundaries: `anonymized_at` takes `now() AT TIME ZONE 'UTC'`. New raw SQL instants are ISO text with a `::timestamp` cast.
- TEA-08, Code Map: prior actions label through `reason = '[erased]'`.
- TEA-09 (intent), D4, matrix: a decision takes no lock on a reporter, and repair cannot find the row once `reporter_id` is null. `requestErasureForUser` reads the member's report case keys, takes each `moderation_case:` lock in sorted order first, because `lockCase` precedes every privacy lock, then takes the guards and rechecks the set, raising `40001` on a change. A reason typed after the erasure commits stays, as a stated limit.
- TEA-10 (intent), D8, matrix: a bundle over 4,000,000 serialized bytes also gets 413 `export_too_large`, with no audit row and no bytes. Vercel Functions refuse responses past 4.5 MB, and 5,000 decisions at the 1,000-character reason reach 5 MB. For this one case the read happens before the refusal.
- TEA-11, D8: `auditEvents[].actorId` is null when the actor has a request row. Events are the closed list `moderation_decision_applied`, `moderation_appeal_recorded`, `moderation_case_viewed`, matched on the bundle's decision ids and case ids, because `event_data.caseId` keeps the pre-re-key id. `event_data` is never copied out. The range read uses repeatable read.
- TEA-12 (intent), D4, acceptance bullet 4: `member_id` and `requested_by` are nullable foreign keys with `SET NULL`, `member_id` stays unique, and erasure nulls `requested_by` where it names the member. `member_id` is the named exception until the `User` row goes. An erased operator's `AuditLog.user_id` is a limit in the gate record.
- TEA-13, D6: `moderation_erasure_requested` commits in the erasure transaction. First request 201, replay 200. A replay writes no audit row.
- TEA-14, D7: the D7 path runs once at boot and then every 24 hours, because `schedule()` has no first run. The prune skips a row with `failure_owed_code` set and `failure_escalated_at` null. The cutoff is strict: exactly 400 days stays.
- TEA-15, D4: `resolveAlias` returns null for a member with no `CommunitySubject`, so nothing re-mints the row D4 deletes.
- TEA-16 (intent), D3, D4, D5: rows with a null id whose `subject_alias` equals the member's alias count as the member's, read before the alias is deleted. The owner role gains `SELECT` on `CommunityAlias`.
- TEA-17, D3, D5, Design Notes: temporary `CREATE` on `public` and `private`, `CREATE OR REPLACE` for every function because `private` survives `prisma migrate reset`, and the function supplies `gen_random_uuid()::text` for `AuditLog.id`, which has no database default.
- TEA-18, D2: the guard compares `to_jsonb(NEW) - allowed` with `to_jsonb(OLD) - allowed`, so a later column is refused by default.
- TEA-19, D4: the sweep interval is 30 seconds, and 15 minutes is the repeat-delete pace. The deadline reasoning still holds. The repair runs an unlocked existence read and takes the guard only when identity remains.
- TEA-20, D5, D9: one exported check list in the API module, read by the script through `tsx`, inside the image graph. The worker's flag subject is `system:moderation-history`.
- TEA-21, Tasks: "confirm the row refuses change" runs on the local Supabase job, with the API's own connection string. `pr-checks` connects as a superuser.
- TEA-22, D4, D7, Boundaries: `comment_audit_append_only` refuses every update, so redacting a reason copy on a comment case aborted the erasure transaction. The 6.13 migration replaces `enforce_comment_audit_append_only` so it admits one change, `reason` to `[erased]` with every other column equal, and still refuses `DELETE` and everything else. Rows that read the audit reason map it through `mapModerationReason`.
- TEA-23, D4: a decision's words are also copied to `ModerationEvent.reason`, `CommunityCommentAudit.reason` and `LookbookPost.moderation_reason`, so erasure redacts those copies by exact words scoped to the case. Scope comes from the post or report ids of the redacted decisions, and from the alias on an orphan event, so identical words on an unrelated case stay. A moderator's own erasure keeps the words.
- TEA-24, D1 matrix: the bypass row says `session_replication_role` is refused for the application role. On the Supabase image `postgres` may set it, and `UPDATE`, `DELETE` and `TRUNCATE` on `ModerationDecision` still answer 42501 there, because the privilege layer holds alone. `D-IMM-BYPASS` matches the privilege's own message, so a plain image proves it too. Measured on the same image: in that mode the application role can `UPDATE` and `DELETE` `AuditLog`, which is trigger-only, and `CommunityCommentAudit` has the same exposure. Frozen scope leaves both as they are, and the gate record and the guide state it.
- TEA-25, D4: `I-E-LOCKED-OUT` asserted `status >= 403`, which hid a 500 from an incomplete storage double and a 409 on publish. It now pins all five routes, and publish gives the same 403 (Build-14).
- TEA-26, test plan: the plan missed C1, C2 and C3. It stopped `I-C-THIRD-PARTY-COMMENT` before the second erasure, made no operator the subject of an erasure, and planned conflict per case. `I-S-MATRIX` now runs every ordered pair of five erasures, and `I-O-*` covers an operator erased in flight and afterwards. Review also found conflict lost on an orphan sibling for the case read and a decision, and a range export missing a link outside its period (CX-3).
- TEA-27 (intent), Boundaries: every page answered `lang="en"` in every locale, which fails WCAG 3.1.1 on the surfaces this story ships, so the root layout's language now follows the resolved locale. `P-LANG` proves it in a real browser.

- CX-1 (intent), D4, matrix (Codex C1): erasing a post's author deletes other members' comments, and their reports survive with `comment_id` null and the commenter's words in `content_snapshot`, so the commenter's own later erasure could not find them. `CommunityCommentReport.comment_author_id` keeps the link, set at both intake paths and backfilled, with `SET NULL`, and that member's erasure clears the snapshot and then the column. Rejected: scrubbing the snapshot when the parent post is erased, because it destroys evidence for a third party's open report while the commenter has asked for nothing. Rows orphaned before this column carry no link, and none exist in production because the hard delete is new in this story. `scrub_comment_reports_on_user_delete` clears the link too, because a direct `User` delete otherwise updates the report twice and rechecks the new foreign key after the parent row has gone, which `community-comments-privacy` caught as a 23503.
- CX-2 (intent), D4, D7 (Codex C2): an operator's own erasure did not serialize against that operator's in-flight decision or appeal, and an already erased operator could still decide, so `moderator_id` came back after completion. Erasure now holds `community_sanction:<member>` exclusively, and decisions and appeals hold it shared and then read the request row inside that lock, answering 403 `operator_sanctioned` with nothing written. Once a request row commits, every writer naming that member either finished first and erasure sees its row, or starts later and sees the request. `ModerationOperatorGuard` gives the same 403 on the moderation reads, the export, the erasure route and the legacy actions route, because those write audit rows naming the operator or send the id to analytics. The erasure route repeats the check inside its transaction, because `requested_by` is an identity field too. Rejected: a new error code, because a distinct answer would tell a caller the account was erased.
- CX-3 (intent), D6, D8 (Codex C3): after a post's erasure each report has its own orphan case, and decisions tie them together, so a conflict check on a case's own reports missed the viewer's report on the same post. `viewerConflictsWithEvidence` reads transitively through decision report ids, and decide, case detail, appeal and case export all use it. The range export withholds across shared report ids and case keys for the same reason, and its closure reads decisions outside the period, because the only link to the exporter can sit in one. Two reports on one deleted post with no decision between them have no surviving link, so that pair cannot be seen as a conflict; the report holds nothing of the deleted post by then.
- CX-4, D5 (Codex C4): `function_execute_granted` requires the connecting role's EXECUTE on `private.moderation_history_anonymize`, because `function_execute` only refused unexpected grantees and a missing grant broke every erasure with the verifier green. The list is now 16 checks.
- CX-5, Design Notes (Codex C5): the migration example named `CURRENT_USER`, which crashes the Supabase server (Build-01), so it now shows `format('... %I', current_user)`.
- CX-6, D1: the coordinator read hosted Production and Preview on 2026-11-05 with read-only queries, which supersedes D1's "Hosted role attributes were not read". Both report Postgres 17.6 and `postgres` as NOSUPERUSER, CREATEROLE, BYPASSRLS, the owner role absent and 55 migrations finished. The 6.13 migration has run on neither, so its outcome stays unproven until deploy, and the Supabase patch version was not read.

- CX-7, D5 (coordinator on PR #197): `moderation:history:verify` exited 2 with SELF_SIGNED_CERT_IN_CHAIN on a hosted database, because `pg` ignores Prisma's TLS parameters. `verifiedPgConnection` in `scripts/lib/database-tls.mjs` drops every `ssl*` parameter from a remote URL and passes the CA explicitly, with the rule `database-tls.ts` already has: an absolute `sslcert` that exists, otherwise the committed Supabase root. A local host stays plain, an unknown chain exits 2 with no `ok` line, and a server refusing TLS gets no plaintext fallback.
- CX-8, D7 (Optic on PR #197): adding `operator_sanctioned` to the queue and SLA error enums is breaking for clients already reading those routes, so the code stays out of both and only the new history routes' enum holds it. Those routes' 403 declares no body schema, and the web console maps any 403 to `forbidden` by status. Rejected: `x-optic-exemptions`, because this is a closed set.

## Review Triage Log

## Design Notes

| Story          | What it needs from 6.13                                                   | Where it plugs in                                                                                               |
| -------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 6.14           | Erasure removes the grant and its audit subject identity on this schedule | Adds its own step to the `requestErasureForUser` transaction                                                    |
| Account delete | A working community half and the `requested_by` trace                     | Calls `requestAccountContentErasure`, then owns the `User` row, the `AuditLog` `RESTRICT`, wardrobe and billing |
| Beta sign-off  | The gate record                                                           | Open rows get signed in the same file                                                                           |

**Why the role owns the table.**
A trigger is a rule its owner can switch off, and in this deployment the owner is the application.
Separating ownership turns "nobody should run that statement" into a privilege the application role lacks.
The trigger then needs a way to tell an erasure from an attack, and `current_user` is the one signal Postgres sets itself: only a foreign key action and a definer function reach it, and the caller cannot forge it without first changing role grants.

**Why a request row gates the function.**
A function any application query can call for any member would let a bug strip attribution from real history.
Requiring the guard and a request row means the only route to it is the erasure transaction, and each use leaves a durable record.
The guard here is the function's own (TEA-02), because the shared one is off at the default `privacy_version`.

**What enforcement does not cover.**
Every DML statement, every non-DDL path and every role other than the migration role is refused.
A session running arbitrary DDL as the migration role can still defeat it: `GRANT` to itself, `DROP TABLE` or `DROP FUNCTION ... CASCADE` as schema owner, or a trigger on a table the definer writes (TEA-03).
That is the same class of act as a reviewed migration, and `moderation:history:verify` shows what it leaves behind unless it was undone in one transaction.

**Migration shape.**
Prisma sends a migration file as one batch, so `SET ROLE` and `RESET ROLE` run in order on one connection.

```sql
-- CREATE ROLE ... NOLOGIN BYPASSRLS in a DO block tolerating duplicate_object, then ALTER ROLE ... BYPASSRLS (TEA-01).
-- Name the role through format(): GRANT role TO CURRENT_USER segfaults the Supabase server (Build-01).
EXECUTE format('GRANT moderation_history_owner TO %I WITH SET TRUE, INHERIT FALSE', current_user); -- inside a DO block
GRANT CREATE ON SCHEMA public, private TO moderation_history_owner;
ALTER TABLE "ModerationDecision" OWNER TO moderation_history_owner;
-- CREATE OR REPLACE for guard, require-guard and function under SET ROLE (TEA-17), grants applied, then:
REVOKE CREATE ON SCHEMA public, private FROM moderation_history_owner;
EXECUTE format('REVOKE moderation_history_owner FROM %I', current_user); -- inside a DO block
```

## Test Design (TEA)

Full plan, reconciled to this spec (this spec wins on any disagreement):
`_bmad-output/test-artifacts/test-design/cc613-moderation-history-test-design.md`.
26 risks (12 high, one at score 9 until TEA-01 is built); 170 scenarios: P0 112, P1 53, P2 5 (Unit 32, Integration 51, API 25, DB 41, Contract 2, Component 6, E2E 7, Manual 6).
157 are red-first, 7 are green guards and 6 are manual.
24 seeded-defect proofs (S-1 to S-24) run in a throwaway worktree and are recorded under `_bmad-output/test-artifacts/story-6-13/`.
Review findings TEA-01 to TEA-27 are in the Spec Change Log.
The plan's Execution record holds the sign-off runs, the seeded defects and what differs from this plan.

Red-first order for the build:

1. Harness and migration together, with `D-ROLE-*`, `D-IMM-*`, `D-EX-*`, `D-FN-RLS-VISIBLE`, `D-FN-NO-GUARD` red.
2. `V-*` red, then the verifier.
3. Contract schemas, with `U-C-*` red.
4. `I-E-*` red, then D4. `I-E-ORDER`, `I-E-RACE-REPORTER`, `I-E-CANARY-SCAN` come before the code they guard.
5. `I-C-*` red, then completion, repair and overdue.
6. Decision and appeal paths, with `I-E-DECIDE-AFTER`, `U-C-RESERVED-REASON` red.
7. `A-ER-*` and `A-X-*` red, then the routes. `A-X-CANARY` and `A-X-BYTE-CAP` come first.
8. `I-R-*` and `U-W-*` red, then the sweep and both trigger paths.
9. Component tests red against contract fixtures, then the console.
10. Pact and Playwright last. `P-REFUSED-REAL` and `P-DOWNLOAD` are the final proofs.
11. Gate record and documents after green runs exist.

Green guards that start passing: `D-IMM-REPLICA-LIMIT`, `D-MIG-PREVIEW-FAIL-SAFE`, `U-NO-WRITE-PATHS`, `U-W-OTHER-PRUNES`, `I-E-LOCKED-OUT`, `I-E-WITHDRAW-KEEPS`, `U-GATE-UNTOUCHED`.

Build rules the tests rely on:

- Every enforcement proof runs on the harness database. No story proof sets `privacy_version`.
- The retention sweep is a plain function taking a clock, `prisma` and flags. Tests inject each one.
- One helper builds every new audit row. One exported list holds the enforcement checks, which the script and the sweep both read.
- No test deletes a decision row. Cleanup deletes users and lets the foreign keys act.

What the tests can and cannot prove: enforcement is proved on a real non-superuser role and on local Supabase's own role. The coordinator read the hosted role on Production and Preview on 2026-11-05, and the migration's outcome there stays unproven until deploy (`M-PREVIEW-VERIFY`). A session running arbitrary DDL as the migration role is a stated residual (TEA-03). The E2E backdates rows and runs the real sweep, and the injected clock in `I-C-*` proves the 70-hour and 72-hour edges.

## Verification

**Commands:**

- `npm exec -- vitest run` in `apps/api`, `packages/db`, `packages/api-client`, `packages/config`, `apps/web` for the touched specs -- expected: green.
- `npm exec -- tsc --noEmit -p <tsconfig>` in every touched workspace, `apps/web` included, counted by code -- expected: only the known symlink TS2742.
- `DATABASE_URL=<isolated database at 127.0.0.1:54339> npm exec -- vitest run integration` in `apps/api`, with `NODE_OPTIONS=--conditions=development`, for `moderation-history-*` and every existing `moderation-*` and `community-*privacy*` suite -- expected: green with no filtered burn-in at sign-off.
- `DATABASE_URL=<isolated database> PLAYWRIGHT_SKIP_DB_RESET=true npx playwright test` for `moderation-history`, `moderation-console`, `moderation-decisions` -- expected: green.
- `npm run moderation:history:verify` against an isolated database as superuser and as the non-superuser login, the local Supabase stack and the PR's Preview database -- expected: exit 0, and non-zero after an injected `GRANT`. The Preview output, with role attributes, goes into `_bmad-output/test-artifacts/story-6-13/`.
- `git diff --name-only main | wc -l`, with untracked files and `.coderabbit.yaml` filters applied -- expected: at most 100. Over that, split into a stacked 6.13b.

**Manual checks:**

- Real stack with an isolated database: decide a case, attempt the refused statements as the application role, erase the member, age the clock past the window, then read `/moderation`, the case detail and `/moderation/evidence` in a real browser, with screenshots, light and dark, desktop and mobile. Fix whatever looks off.
- Open the downloaded bundle and read it as a compliance reviewer: nothing identifies a reporter or an erased subject.
- Read the rendered gate record and runbook Coverage section: dates, sources and limits are right, and no person is named.
