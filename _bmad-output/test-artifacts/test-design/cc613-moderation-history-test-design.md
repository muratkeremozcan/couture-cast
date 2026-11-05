---
runScope: 'epic'
runKey: 'epic-6-story-6.13'
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
lastSaved: '2026-11-05'
---

# Test Design: Epic 6, Story CC-6.13 Immutable moderation history

**Date:** 2026-11-05
**Author:** Murat (TEA), non-interactive run, owner unavailable, decisions recorded in the spec
**Status:** Planned. No test is written yet. Task 1 of the story.

**Precedence:** the spec at `_bmad-output/implementation-artifacts/spec-6-13-immutable-moderation-history.md` wins wherever this document and the spec disagree.
The frozen block stays byte-identical to the coordinator's draft.
Where a frozen sentence needs tightening, the ruling sits in the Spec Change Log and the builder is told.

Inputs read:

- Spec, every section. `epics.md` CC-6.13 criteria 1 to 3. Fleet rules.
- Prior example `cc612-sla-monitoring-test-design.md` and the Test Design (TEA) section of spec 6.12.
- Code at `56509fa8`: `community.repository.ts` `requestErasureForUser` and `resolveAlias`, `community.service.ts` `requestAccountContentErasure`, `community-maintenance.service.ts` `sweepErasureRequests`, `community-privacy.ts`, `community-access.service.ts`, `community-comments.privacy.ts`, `community-audit-snapshot.ts`, `community.bootstrap.ts`, `moderation-decisions.service.ts`, `moderation-decisions.repository.ts`, `moderation-sanctions.service.ts`, `moderation-queue.repository.ts`, `moderation-decision-rules.ts`, `moderation-sla.controller.ts`, the contract `moderation-decisions.ts`, `schema.prisma`, migrations `20260420160000`, `20261020120000`, `20261104120000`, `pr-checks.yml`, `pr-pw-e2e-local.yml`, `rls/harness.ts`, `audit-log-immutability.spec.ts`, `migration-hygiene.spec.ts`.
- Knowledge fragments, read for their scales and priority rules: `risk-governance.md`, `probability-impact.md`, `test-priorities-matrix.md`, `test-levels-framework.md`.
- Vercel Functions limits page, `https://vercel.com/docs/functions/limitations`, last updated 2026-08-24.

Workflow decisions taken without a halt:

- Mode: Create. Level: epic-level, scoped to one story. The completed frontmatter above replaces a checkpoint file, and the output path follows the coordinator's brief and the 6.10 to 6.12 precedent.
- Level vocabulary: Unit, Integration (real Postgres, real Nest where stated), API (real HTTP on a real Nest app), DB (privileges, triggers and catalog through a real connection), Contract (Pact and OpenAPI), Component (Vitest and Testing Library), E2E (Playwright), Manual.
- `tea_use_playwright_utils` and `tea_use_pactjs_utils` are true. Playwright specs use `apiRequest`, `recurse`, `interceptNetworkCall` and the merged fixtures. Pact interactions use `createProviderState`, `setJsonContent` and `buildVerifierOptions`, one interaction per `it`. `tea_pact_mcp` is `mcp`, and no broker tool is reachable, so the plan uses local verification and invents no broker data.
- Browser exploration was skipped, because the new page and control do not exist yet. `M-VISUAL` covers the rendered page.

Probes run for this plan, on a throwaway database at `127.0.0.1:54339`, dropped afterward with its roles. The whole migration chain at `56509fa8` applied as a `NOSUPERUSER CREATEROLE CREATEDB BYPASSRLS` login. The D1, D2, D3 and D5 migration was then applied as written under a test role name. Read-only catalog reads on local Supabase at `54322` gave the role attributes. The hosted database was not touched.

| Probe                                                                                                                                                                               | Result                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local Supabase `postgres`                                                                                                                                                           | `rolsuper` false, `rolcreaterole` true, `rolbypassrls` true, owner of `public` and `private`, `createrole_self_grant` empty, Postgres 17.6                                                                      |
| Application role: `UPDATE`, `DELETE`, `TRUNCATE`, `DISABLE TRIGGER`, `DROP TRIGGER`, `ALTER OWNER`, `RENAME`, `SET ROLE`, `SET session_replication_role`, `TRUNCATE "User" CASCADE` | All `42501`. D1 holds for these                                                                                                                                                                                 |
| Membership after `REVOKE ... FROM CURRENT_USER`                                                                                                                                     | One row, `admin_option` true, `inherit_option` and `set_option` false, as D5 says                                                                                                                               |
| Login role with the same grants and no `BYPASSRLS`                                                                                                                                  | `SELECT` sees 0 rows, `INSERT` gives `new row violates row-level security policy`                                                                                                                               |
| Function with the D5 grants                                                                                                                                                         | `permission denied for table CommunityRuntimeCapability`                                                                                                                                                        |
| Same, with `SELECT` on that table added                                                                                                                                             | `42501 no request`, inside the guard, with a request row present                                                                                                                                                |
| Same, with a policy added on the request table, `privacy_version` 1, no guard held                                                                                                  | Passes the guard check, then `new row violates row-level security policy for table "AuditLog"`. The guard failed open on a hidden row                                                                           |
| Owner altered to `BYPASSRLS` by the application role                                                                                                                                | Allowed. The function then works inside the guard and sees rows and writes audit                                                                                                                                |
| `privacy_version` 0, no guard held                                                                                                                                                  | Function runs and changes rows. At 1: `23514`, as designed                                                                                                                                                      |
| Application role replaces `community_require_guard`, then calls the function                                                                                                        | The replaced body ran as the owner, disabled the triggers, wrote `action = release` and `reason = REWRITTEN`, and re-enabled them. Rolled back                                                                  |
| Application role as schema owner                                                                                                                                                    | `DROP FUNCTION private.guard() CASCADE` and `DROP TABLE "ModerationDecision" CASCADE` both succeed. `ALTER SCHEMA private RENAME` succeeds. Rolled back. With the triggers gone, `UPDATE` still answers `42501` |
| Foreign key `SET NULL` from a `User` delete under the guard                                                                                                                         | Row keeps `reason`, loses the id                                                                                                                                                                                |
| Superuser                                                                                                                                                                           | `has_table_privilege(..., 'DELETE')` and `pg_has_role(..., 'SET')` both true                                                                                                                                    |
| Second session `GRANT` while the first transaction is open                                                                                                                          | Waits (`55P03` under a lock timeout). A commit by another session's `REVOKE` then denies a session's later `SET ROLE`                                                                                           |
| `now()::timestamp(3)` on a Chicago session                                                                                                                                          | Stored `18:33` where UTC was `00:33` the next day                                                                                                                                                               |

---

## Spec review: findings against the real code

Each finding says what the code or probe shows, the disposition and the test that guards it.
"Fixed" means a non-frozen spec section is edited now because the code settles the answer.
"Ruling" means a default decision is recorded in the Spec Change Log and the builder is told.
Intent-level rulings are marked **(intent)**.

| ID     | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Guard                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| TEA-01 | D1 creates a plain `NOLOGIN` role, and D3's definer function reads `ModerationErasureRequest`, both report tables and writes `AuditLog` as that role. All have RLS on with no policy for it, and `AuditLog` forces RLS. The owner role is no table owner there and has no bypass, so the request row is invisible and the function always raises `no request`.                                                                                                                              | **Ruling (intent).** The role is `NOLOGIN BYPASSRLS`. The migration runs `ALTER ROLE` when it already exists. Frozen "zero policies" stays true. Rejected: policies for the owner on four tables, which breaks that boundary and lets the application role edit policy expressions that run as the owner.                                                                                                                                                                                                                                                    | `D-FN-RLS-VISIBLE`, `D-ROLE-ATTRS`                              |
| TEA-02 | D3 relies on `community_require_guard`. Its check is `privacy_version >= 1`, the column defaults to 0, and no migration, script or production code raises it. Only integration specs set it to 1, so a green spec there says nothing about production. D5's grants also omit `CommunityRuntimeCapability`, and the function fails on it. A hidden row reads as NULL and the guard passes. The application role owns the function and can replace it, and the replacement runs as the owner. | **Ruling (intent).** New `private.moderation_history_require_guard(member)`, owned by the owner role, reads `pg_catalog.pg_locks` for the exclusive 65001 guard, unconditionally, and raises `23514` with the existing message. D5's list drops `EXECUTE` on `community_require_guard`. Matrix outcome is unchanged and now true at version 0.                                                                                                                                                                                                               | `D-FN-NO-GUARD`, `D-FN-WRONG-GUARD`, `D-FN-REPLACED-DEPENDENCY` |
| TEA-03 | D1 says the privilege layer stops a bypass, D3 says a compromised role "cannot alter a decision", and D5 names one residual. Probes show two more routes: `DROP TABLE` and `DROP FUNCTION ... CASCADE` as owner of the schema, and code injected through an application-owned object the definer touches, such as a trigger on `AuditLog`. `GRANT` then `REVOKE` in one transaction leaves no catalog trace.                                                                                | **Ruling (intent).** Accepted, stated plainly. The guarantee: every DML statement, every non-DDL path and every role other than the migration role is refused. A session running arbitrary DDL as the migration role can defeat it, and that takes a compromise of the same class as a reviewed migration. The guide and the gate record's Audit limit carry this sentence. The verifier adds `table_present`. Rejected: moving the table to a schema the owner role holds, because Prisma would need `multiSchema` and the `GRANT` route stays open anyway. | `D-RESIDUAL-SCHEMA-OWNER`, `V-FAULTS`, `U-GUIDE-LIMITS`         |
| TEA-04 | D5 checks "the connecting role", and Verification expects exit 0 on the isolated database, where the login is a superuser. `has_table_privilege` and `pg_has_role` answer true for a superuser, so that run could never exit 0, and a naive check is vacuous elsewhere.                                                                                                                                                                                                                     | **Fixed.** The verifier reads `relacl` with `aclexplode`, `pg_auth_members` and `pg_roles`. It adds checks for `BYPASSRLS` on the owner and on any non-superuser connecting role, since the application role now reads this table by that attribute.                                                                                                                                                                                                                                                                                                         | `V-CLEAN-NONSUPER`, `V-CLEAN-SUPER`, `V-FAULTS`                 |
| TEA-05 | Boundaries require non-superuser proofs. `pr-checks` runs `postgres:17-alpine` as superuser, and a plain `NOSUPERUSER` test role fails on RLS, which reads as a false defect. A role created by a superuser migration elsewhere in the cluster gives a non-superuser no `ADMIN` on it, so its `GRANT` fails.                                                                                                                                                                                | **Fixed.** Harness below: a throwaway database migrated by a `NOSUPERUSER CREATEROLE BYPASSRLS` login. The harness grants that login `ADMIN` on the role if it exists. The chain applied in seconds in the probe.                                                                                                                                                                                                                                                                                                                                            | `D-MIG-NONSUPER` and every `D-*`                                |
| TEA-06 | D2 allows `anonymized_at` to move once, and D4 reruns the function on every sweep. A plain `SET anonymized_at = now()` raises `42501` on the second run, every sweep fails, and completion never lands.                                                                                                                                                                                                                                                                                     | **Fixed.** The function updates only rows where a column actually changes, uses `COALESCE(anonymized_at, ...)`, returns 0 and raises nothing on a rerun.                                                                                                                                                                                                                                                                                                                                                                                                     | `D-FN-IDEMPOTENT`, `D-FN-CROSS-MEMBER`, `I-C-REPAIR-SPAM`       |
| TEA-07 | `now()` into `timestamp(3)` follows the session time zone (measured). 6.12 TEA-15 is the same class.                                                                                                                                                                                                                                                                                                                                                                                        | **Fixed.** `anonymized_at` takes `now() AT TIME ZONE 'UTC'`. New raw SQL instants are ISO text with a `::timestamp` cast.                                                                                                                                                                                                                                                                                                                                                                                                                                    | `D-FN-UTC`, `I-C-TZ`, `I-R-TZ`, `A-X-TZ`                        |
| TEA-08 | The Code Map said to label prior actions through `anonymized_at`, which contradicts D8: a moderator's erasure sets that column and keeps the reason.                                                                                                                                                                                                                                                                                                                                        | **Fixed.** Code Map now reads `reason = '[erased]'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `U-MAP-REASON`, `W-REMOVED-LABEL`                               |
| TEA-09 | The matrix says the member lock serializes a race and repair catches the rest. That holds for a subject. A reporter's lock is not taken by a decision (`takeTargetLocks` locks the post and the author), and repair cannot find the row later, because `reporter_id` is already null.                                                                                                                                                                                                       | **Ruling (intent).** `requestErasureForUser` reads the member's report case keys, takes each `moderation_case:` lock in sorted order, first, because `lockCase` documents that it precedes every privacy lock, then takes the guards and rechecks the set, raising `40001` on a change. `communityPrivacyTransaction` retries that. A reason typed after the erasure commits stays and is a stated limit: the row was written with no reporter visible.                                                                                                      | `I-E-RACE-REPORTER`                                             |
| TEA-10 | D8 allows 5,000 decisions. `MODERATION_REASON_MAX_LENGTH` is 1000, so reasons alone can reach 5 MB. The API runs on Vercel, and the limits page gives a 4.5 MB response limit with 413 `FUNCTION_PAYLOAD_TOO_LARGE`. The audit row would commit and the bytes would never arrive.                                                                                                                                                                                                           | **Ruling (intent).** Also refuse when the serialized bundle exceeds 4,000,000 bytes, with 413 `export_too_large`, before the audit row commits. Rejected: streaming, because the digest and audit row must exist before the first byte and the limits page does not state a streaming exemption.                                                                                                                                                                                                                                                             | `A-X-BYTE-CAP`                                                  |
| TEA-11 | D8 says an erased moderator reads as null, for `moderatorId`. `AuditLog.user_id` is immutable, so `auditEvents[].actorId` would still print that id. `event_data.caseId` keeps `post.<id>` after the re-key, so matching on the orphan id finds nothing.                                                                                                                                                                                                                                    | **Fixed.** `actorId` is null when the actor has a request row. Events are the closed list `moderation_decision_applied`, `moderation_appeal_recorded`, `moderation_case_viewed`, matched on the bundle's decision ids and on its case ids. `event_data` is never copied out.                                                                                                                                                                                                                                                                                 | `U-MAP-ACTOR`, `A-X-MOD-ERASED`, `A-X-REKEY`                    |
| TEA-12 | The acceptance bullet says no moderation table holds the member's id, and D4 stores `member_id` and `requested_by` on the request row. A later-erased admin stays in `requested_by`.                                                                                                                                                                                                                                                                                                        | **Ruling (intent).** Both columns are nullable foreign keys with `SET NULL`, `member_id` stays unique. Erasure nulls `requested_by` where it names the member. `member_id` is the one named exception until the `User` row goes, because the replay and the null-subject rule read it. The acceptance bullet is amended. An erased operator's `AuditLog.user_id` is a named limit in the gate record.                                                                                                                                                        | `I-E-REQUESTED-BY`, `I-E-CANARY-SCAN`, `D-SCHEMA`               |
| TEA-13 | D6 does not say where `moderation_erasure_requested` commits, what status answers, or whether a replay audits.                                                                                                                                                                                                                                                                                                                                                                              | **Fixed.** Same transaction as the erasure. 201 first, 200 on replay. A replay writes no audit row, and the idempotent scrub may rerun.                                                                                                                                                                                                                                                                                                                                                                                                                      | `A-ER-AUDIT`, `A-ER-REPLAY`                                     |
| TEA-14 | `schedule()` in `community.bootstrap.ts` is a bare `setInterval`, so at 24 hours a worker that restarts daily never runs the prune or the drift check. `failure_owed_code` on a terminal alert still owes a record (6.12), and D7 would delete it.                                                                                                                                                                                                                                          | **Fixed.** The D7 path runs once at boot, then every 24 hours. The prune skips a row with `failure_owed_code` set and `failure_escalated_at` null.                                                                                                                                                                                                                                                                                                                                                                                                           | `U-W-BOOT-RUN`, `I-R-OWED`                                      |
| TEA-15 | `resolveAlias` mints on first use, and `community.service.ts:632` and `:780` call it. A report or feed read after erasure recreates the row D4 deleted.                                                                                                                                                                                                                                                                                                                                     | **Fixed.** `resolveAlias` returns null for a member with no `CommunitySubject`, which erasure deleted, and callers already map null to `unknown`.                                                                                                                                                                                                                                                                                                                                                                                                            | `I-E-NO-REMINT`                                                 |
| TEA-16 | D3 and D4 find a subject by id. A decision or report on an orphan case has a null id and only the alias. Once `CommunityAlias` is deleted, that link is gone for good.                                                                                                                                                                                                                                                                                                                      | **Ruling (intent).** Inside the transaction, ahead of deleting the alias, rows whose `subject_alias` equals the member's alias count as the member's. The owner role gains `SELECT` on `CommunityAlias`.                                                                                                                                                                                                                                                                                                                                                     | `D-FN-ALIAS-MATCH`                                              |
| TEA-17 | D5 lists temporary `CREATE` on `public` only, and the Design Note creates functions under `SET ROLE` in `private`. `prisma migrate reset` drops `public` and leaves `private`, so a second run finds the owner's functions there. `AuditLog.id` has no database default, because `@default(cuid())` lives in Prisma.                                                                                                                                                                        | **Fixed.** Temporary `CREATE` on both schemas, `CREATE OR REPLACE` for all functions, and the function supplies `gen_random_uuid()::text` for the audit id.                                                                                                                                                                                                                                                                                                                                                                                                  | `D-MIG-RESET`, `D-ROLE-GRANTS`, `D-FN-AUDIT`                    |
| TEA-18 | D2's table is a list of columns. A guard that compares listed columns admits any column a later migration adds.                                                                                                                                                                                                                                                                                                                                                                             | **Fixed.** The guard compares `to_jsonb(NEW) - allowed` with `to_jsonb(OLD) - allowed`, so a new column is refused by default.                                                                                                                                                                                                                                                                                                                                                                                                                               | `D-EX-NEW-COLUMN`                                               |
| TEA-19 | D4 says the sweep runs every 15 minutes. `SWEEP_INTERVAL_MS` is 30 seconds, and 15 minutes is the repeat-delete pace. A guarded repair per open request every 30 seconds for 70 hours is needless lock traffic. Completion still fits the deadline.                                                                                                                                                                                                                                         | **Fixed.** The repair first runs an unlocked existence read and takes the guard only when identity remains. The frozen wording stays, and this log corrects the fact.                                                                                                                                                                                                                                                                                                                                                                                        | `U-S-REPAIR-NO-WORK`, `I-C-REPAIR-CATCH`                        |
| TEA-20 | D5 shares a check between a script and the sweep, and the sweep must stay inside the community image. D9 leaves the worker's flag subject unstated, and 6.12 TEA-06 showed a moderator-keyed rule leaves a system subject off.                                                                                                                                                                                                                                                              | **Fixed.** One exported check list in the API module, read by the script through `tsx` as `moderation:sla:drill` does. Subject `system:moderation-history`.                                                                                                                                                                                                                                                                                                                                                                                                  | `V-SAME-SOURCE`, `U-W-IMAGE-GRAPH`, `U-W-FLAG-PRUNE`            |
| TEA-21 | The Task says "confirm the row refuses change" in Playwright without saying as whom. `pr-pw-e2e-local.yml` runs local Supabase, whose `postgres` is the non-superuser application role, so that is the honest place for it. `pr-checks` is a superuser. Preview secrets are absent from `pr-checks`.                                                                                                                                                                                        | **Fixed.** `P-REFUSED-REAL` uses the API's own connection string on the local Supabase job. The Preview read is the manual step `M-PREVIEW-VERIFY`, with its output as evidence.                                                                                                                                                                                                                                                                                                                                                                             | `P-REFUSED-REAL`, `M-PREVIEW-VERIFY`                            |

Reviewed and confirmed with no change:

- No production code updates, deletes or locks a decision row. `moderation-queue.repository.ts:345` only reads, and `FOR UPDATE` in the module targets other tables. No test or script runs `TRUNCATE` on a table with a decision foreign key, and `AuditLog` already refused that.
- `moderationStoredDecisionResultSchema` holds no user id, so the replay after erasure is safe. `sanction` is a kind and dates.
- `buildCommunityObjectPath(postId, ...)` puts no user id in `image_object_path`.
- `community_forget_subject(member, true)` deletes `CommunitySubject`, and `assertCommunitySubjectPresent` then denies the member. A member behind a request cannot post or report, and deleting the sanction opens no door. `I-E-LOCKED-OUT` keeps this true.
- `CommunityCommentAudit` hangs off the report with `SET NULL`, so a post cascade leaves it. Every `LookbookPost` foreign key is cascade or `SET NULL`, so the D4 delete cannot be restricted.
- `User.id` renames exist only in integration specs, on members with no decisions. `D-EX-RENAME` pins both sides.
- `AuditLog` has `FORCE ROW LEVEL SECURITY` and no `INSERT` policy, and the API inserts into it in production. That is the available evidence that the hosted role holds `BYPASSRLS` with no production read. `M-PREVIEW-VERIFY` confirms it on Preview.
- The whole migration runs in one implicit transaction, so the second `GRANT` in a cluster waits. `D-MIG-CONCURRENT` proves it with real runs.

---

## Executive Summary

**Scope:** one role, one trigger guard and one definer function on `ModerationDecision`, the D4 erasure extension and its completion, one flagged erasure route, one retention sweep with a drift check, one catalog verifier, one evidence export with a console, and a gate record, behind `moderation_history_enabled`. Enforcement itself goes live with the migration.

**Risk summary:**

- Total risks: 26
- High (score >= 6): 12, of which 1 at score 9
- Medium (score 3 to 4): 9
- Low (score 1 to 2): 5
- R-002 at 9 blocks by definition until TEA-01 is built and `D-FN-RLS-VISIBLE` is green.

**Coverage summary:** 170 scenarios: P0 112, P1 53, P2 5, P3 0. By level: Unit 32, Integration 51, API 25, DB 41, Contract 2, Component 6, E2E 7, Manual 6. Twenty-four seeded-defect proofs sit outside the count.

**Red-first:** 157 red-first, 7 green guards, 6 manual.

**Effort:** roughly 60 to 100 hours (8 to 13 days), including the non-superuser harness, the race harness and the export fixtures.

---

## Not in Scope

| Item                                                                   | Reasoning                                  | Mitigation                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Member self-service, `User` row deletion, wardrobe and billing erasure | Spec Never list, account-deletion story    | `I-E-CANARY-SCAN` allow-list names these tables, and the gate record states the limit |
| `AuditLog` and `ModerationEvent` ownership                             | Spec Never list, AC names decision records | Existing triggers, `audit-log-immutability.spec.ts` stays green                       |
| A separate least-privilege login                                       | Rejected by D1                             | TEA-03 residual stated                                                                |
| Reading hosted production role attributes                              | Needs production credentials               | `M-PREVIEW-VERIFY`, and the migration fails visibly                                   |
| Third-party text in a report's `details`                               | D4 and D10 stated limit                    | `I-E-THIRD-PARTY-TEXT`                                                                |
| A reason typed after the erasure commits                               | No check can read intent                   | TEA-09 stated limit                                                                   |
| Load testing past 5,000 decisions                                      | Refused by the route                       | `A-X-LOAD`, `A-X-BYTE-CAP`                                                            |
| SLA alerts, localization, accessibility, rollback signatures           | D10 keeps them open                        | `U-GATE-RECORD` asserts they stay open                                                |

---

## Risk Assessment

Scores use probability and impact from 1 to 3, and each description opens with the source statement of the gap.

### High-Priority Risks (Score >= 6)

| Risk ID | Category | Description                                                                                                                                                                                                                                     | Probability | Impact | Score | Mitigation                                                                                                                                    |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R-001   | DATA     | Append-only by convention only: the application role owns `ModerationDecision` and can update, delete, truncate or disable a trigger on it. A rewritten decision destroys the evidence AC 1 protects.                                           | 2           | 3      | 6     | D1, D2. Owner: builder. Proof: `D-IMM-*`, `D-EX-*`, `D-ROLE-*`, `U-NO-WRITE-PATHS`.                                                           |
| R-002   | TECH     | The exception function reads tables with RLS on and zero policies as a role that has no RLS bypass, so it never finds a request row and erasure fails every time (measured, TEA-01).                                                            | 3           | 3      | 9     | TEA-01 `BYPASSRLS`. Owner: builder. Proof: `D-FN-RLS-VISIBLE`, `D-ROLE-ATTRS`.                                                                |
| R-003   | SEC      | The guard the function relies on is a no-op at `privacy_version` 0, the production default, fails open on a hidden capability row, and is owned by the application role, which can replace it and run code as the owner (all measured, TEA-02). | 3           | 2      | 6     | TEA-02 owner-owned unconditional guard. Owner: builder. Proof: `D-FN-NO-GUARD`, `D-FN-REPLACED-DEPENDENCY`.                                   |
| R-004   | SEC      | Bypass by a role running arbitrary DDL stays possible: `GRANT` and `REVOKE` in one transaction, `DROP TABLE` and `DROP FUNCTION ... CASCADE` as schema owner (measured, TEA-03). The guarantee reads stronger than it is if unstated.           | 2           | 3      | 6     | Accepted residual, stated in the guide and gate record. Owner: coordinator. Proof: `D-RESIDUAL-SCHEMA-OWNER`, `U-GUIDE-LIMITS`, `V-FAULTS`.   |
| R-005   | DATA     | Account erasure leaves identity behind in decision rows, reports, snapshots and the alias map. A table the D4 list misses keeps the member after the 72-hour deadline.                                                                          | 2           | 3      | 6     | D3, D4, TEA-12, TEA-16. Owner: builder. Proof: `I-E-CANARY-SCAN`, `I-E-SUBJECT`, `D-FN-*`.                                                    |
| R-007   | DATA     | The repair pass reruns the function on every sweep against a rule that allows `anonymized_at` once, so a careless update raises forever and blocks completion (TEA-06).                                                                         | 2           | 3      | 6     | TEA-06. Owner: builder. Proof: `D-FN-IDEMPOTENT`, `I-C-REPAIR-SPAM`.                                                                          |
| R-008   | BUS      | Erasure misses the 72-hour deadline, or `completed_at` never lands, with nothing telling an operator.                                                                                                                                           | 2           | 3      | 6     | D4 completion and overdue log. Owner: builder. Proof: `I-C-*`, `P-ERASE-JOURNEY`.                                                             |
| R-009   | TECH     | Hosted role attributes were not read, so the migration or a normal decision insert can fail on the hosted role. Local evidence: an application role without `BYPASSRLS` loses `SELECT` and `INSERT` once it stops owning the table (measured).  | 2           | 3      | 6     | Preview runs it first, and the verifier checks attributes. Owner: builder. Proof: `D-MIG-NONSUPER`, `D-MIG-LACKS-BYPASS`, `M-PREVIEW-VERIFY`. |
| R-012   | SEC      | No compliance reviewer can export evidence today, and a new export can leak reporter identity, an erased subject or an erased operator through a new column or an audit actor (TEA-11).                                                         | 2           | 3      | 6     | D8 strict schema, TEA-11. Owner: builder. Proof: `A-X-CANARY`, `U-C-EXPORT-EXCLUDED`, `P-DOWNLOAD`.                                           |
| R-014   | BUS      | An export with no audit row, two audit rows, or a digest that disagrees with the bundle makes the evidence unprovable.                                                                                                                          | 2           | 3      | 6     | D8, TEA-13. Owner: builder. Proof: `A-X-AUDIT-ONE`, `A-X-AUDIT-FAIL`, `P-DOWNLOAD`.                                                           |
| R-015   | PERF     | The 5,000-decision limit allows about 5 MB of reasons alone, past the 4.5 MB Vercel Functions response limit, so a legal export dies at the platform after its audit row commits (TEA-10).                                                      | 3           | 2      | 6     | TEA-10 byte cap. Owner: builder. Proof: `A-X-BYTE-CAP`, `A-X-RANGE-LIMITS`, `A-X-LOAD`.                                                       |
| R-016   | TECH     | Proofs can be vacuous: CI integration runs as a superuser that skips the privilege layer, and `has_table_privilege` and `pg_has_role` answer true for a superuser (measured, TEA-04, TEA-05).                                                   | 3           | 2      | 6     | TEA-04, TEA-05, TEA-21. Owner: TEA. Proof: `V-*`, `P-REFUSED-REAL`, `M-LOCAL-SUPABASE`.                                                       |

### Medium-Priority Risks (Score 3 to 4)

| Risk ID | Category | Description                                                                                                                                                                                    | Probability | Impact | Score | Mitigation                                                                                           |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | ---------------------------------------------------------------------------------------------------- |
| R-006   | DATA     | A decision can commit around a reporter erasure with nothing serializing them, and repair cannot recover it because `reporter_id` is already null (TEA-09). Narrow window, free text retained. | 1           | 3      | 3     | TEA-09 case locks first. Owner: builder. Proof: `I-E-RACE-REPORTER`, `I-E-RACE-SUBJECT`.             |
| R-010   | TECH     | Cluster-global role creation meets concurrent migrations, an existing role and `private` surviving a reset.                                                                                    | 2           | 2      | 4     | TEA-17. Owner: builder. Proof: `D-MIG-*`.                                                            |
| R-011   | DATA     | No retention rule covers `ModerationSlaAlert`. A prune or cascade could remove evidence inside 12 months, or a row that still owes an escalation.                                              | 2           | 2      | 4     | D7, TEA-14. Owner: builder. Proof: `I-R-*`, `I-C-THIRD-PARTY-COMMENT`.                               |
| R-013   | SEC      | An export or erasure route reached by the wrong role or by a moderator on their own case.                                                                                                      | 1           | 3      | 3     | D6, D8 guards. Owner: builder. Proof: `A-ER-ROLES`, `A-X-SELF`, `A-X-RANGE-ROLE`, `P-SECURITY-LIST`. |
| R-017   | OPS      | The drift check and prune sit behind a 24-hour `setInterval` with no first run, so a worker that restarts daily never runs them (TEA-14).                                                      | 2           | 2      | 4     | TEA-14 boot run. Owner: builder. Proof: `U-W-BOOT-RUN`, `I-R-DRIFT-LOG`.                             |
| R-018   | DATA     | `resolveAlias` mints on first use, so a read after erasure recreates the alias map (TEA-15).                                                                                                   | 2           | 2      | 4     | TEA-15. Owner: builder. Proof: `I-E-NO-REMINT`.                                                      |
| R-019   | BUS      | The Community Beta gate has no record of any signature beyond the model one, and a record could claim proof that does not exist.                                                               | 1           | 3      | 3     | D10. Owner: builder. Proof: `U-GATE-RECORD`, `U-GATE-UNTOUCHED`, `M-GATE-READ`.                      |
| R-020   | TECH     | New raw SQL instants bind by session time zone, which moves a boundary by hours (measured on a Chicago session, TEA-07).                                                                       | 2           | 2      | 4     | TEA-07. Owner: builder. Proof: `D-FN-UTC`, `I-C-TZ`, `I-R-TZ`, `A-X-TZ`.                             |
| R-026   | BUS      | A deleted sanction or a null subject breaks the case detail, appeal or ban paths for a case still open.                                                                                        | 2           | 2      | 4     | D4. Owner: builder. Proof: `I-E-SANCTION`, `I-E-DECIDE-AFTER`, `I-E-CONSOLE-AFTER`.                  |

### Low-Priority Risks (Score 1 to 2)

| Risk ID | Category | Description                                                                                                | Probability | Impact | Score | Mitigation                                                         |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | ------------------------------------------------------------------ |
| R-021   | BUS      | Flag and contract drift: a route open with the flag off, or web code that diverges from the shared schema. | 1           | 2      | 2     | D9. Owner: builder. Proof: `A-FLAG-OFF`, `W-FLAG-OFF`, `C-PACT-*`. |
| R-022   | BUS      | The console shows `[erased]` raw, or a new control misses a locale or an accessibility rule.               | 1           | 2      | 2     | D8. Owner: builder. Proof: `W-*`, `M-VISUAL`.                      |
| R-023   | OPS      | New sweep code escapes the community image pruned tree or its 150 MB budget.                               | 1           | 2      | 2     | Boundary. Owner: builder. Proof: `U-W-IMAGE-GRAPH`.                |
| R-024   | OPS      | New suites lengthen a CI job past its limit, or a flake reaches sign-off.                                  | 1           | 2      | 2     | Execution Strategy. Owner: TEA. Proof: `M-SIGNOFF-BURN`.           |
| R-025   | BUS      | A moderator types a reason that reads as erased.                                                           | 1           | 2      | 2     | D8. Owner: builder. Proof: `U-C-RESERVED-REASON`.                  |

### Risk Category Legend

TECH technical, SEC security and privacy, PERF performance, DATA integrity and retention, BUS business logic, OPS operations.

---

## NFR Planning

Thresholds below come from the spec, the epic and platform docs. Final PASS or FAIL waits for `nfr-assess` on evidence.

| Category      | Threshold                                                                                                                                                                          | Source        | Evidence                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------- |
| Security      | `42501` on every refused statement, zero client grants, no owner login                                                                                                             | Epic AC 1, D1 | `D-IMM-*`, `V-*`                      |
| Privacy       | Identity gone at commit, content gone by completion                                                                                                                                | Epic AC 2, D4 | `I-E-CANARY-SCAN`, `A-X-CANARY`       |
| Reliability   | `completed_at` within 72 hours, overdue logged past it                                                                                                                             | Epic AC 2     | `I-C-WINDOW`, `I-C-STORAGE-DOWN`      |
| Retention     | Audit metadata at least 12 months, alerts 400 days                                                                                                                                 | Epic AC 2, D7 | `I-R-*`                               |
| Performance   | Bundle at most 4,000,000 bytes, 5,000 decisions, 90 days. Route latency target is UNKNOWN, so `A-X-LOAD` records a measured value and sets the route's transaction timeout from it | D8, TEA-10    | `A-X-LOAD`, `A-X-BYTE-CAP`            |
| CI            | Every job under 20 minutes. Build measures new suite time, and `Workspace coverage (api)` has a 15-minute limit                                                                    | Fleet rules   | CI run durations recorded at sign-off |
| Accessibility | WCAG 2.2 AA, 44-pixel targets, one polite announcement                                                                                                                             | D8            | `W-A11Y`, `M-VISUAL`                  |

---

## Entry Criteria

- Spec rulings TEA-01 to TEA-21 acknowledged by the builder.
- Isolated Postgres at `127.0.0.1:54339` and local Supabase available.
- `moderation_history_owner` created only through the migration.

## Exit Criteria

- All P0 and P1 green. No filtered burn-in at sign-off.
- All seeded-defect proofs recorded under `_bmad-output/test-artifacts/story-6-13/`.
- `M-PREVIEW-VERIFY` and `M-LOCAL-SUPABASE` output recorded.
- The gate record's proof column filled from real green runs only.

---

## Test Catalog

AC keys: E1 to E3 are the epic's criteria 1 to 3. S1 to S9 are the nine acceptance bullets of the spec, in order.

### Database: enforcement (`packages/db/test/moderation-history-immutability.spec.ts`, throwaway database migrated by a non-superuser, TEA-05)

| ID                        | P   | Level       | Scenario                                                                                                                                                                                                                                                                                 | AC     | Risk  | Mode        |
| ------------------------- | --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- | ----------- |
| `D-IMM-UPDATE`            | P0  | DB          | `UPDATE` of every column as the application role answers `42501`, and `row_to_json` plus `xmin` are identical afterward.                                                                                                                                                                 | E1, S1 | R-001 | Red         |
| `D-IMM-DELETE`            | P0  | DB          | `DELETE` as the application role answers `42501`, and the row is byte-identical.                                                                                                                                                                                                         | E1, S1 | R-001 | Red         |
| `D-IMM-TRUNCATE`          | P0  | DB          | `TRUNCATE` as the application role answers `42501`, and the row count is unchanged.                                                                                                                                                                                                      | E1, S1 | R-001 | Red         |
| `D-IMM-CLIENT-ROLES`      | P0  | DB          | `SET ROLE` to `anon`, `authenticated`, `service_role` in turn: `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` and `EXECUTE` of the function all answer `42501`. The harness applies Supabase default privileges first, so the revokes have something to remove.                      | E1, S1 | R-001 | Red         |
| `D-IMM-SUPERUSER`         | P0  | DB          | As a superuser, `UPDATE`, `DELETE` and `TRUNCATE` hit the trigger and answer `42501`.                                                                                                                                                                                                    | E1, S1 | R-001 | Red         |
| `D-IMM-BYPASS`            | P0  | DB          | As the application role: `DISABLE TRIGGER`, `DROP TRIGGER`, `ALTER OWNER`, `RENAME`, `ADD COLUMN`, `DROP CONSTRAINT`, `CREATE RULE`, `CREATE POLICY`, `SET ROLE`, `SET session_replication_role` each answer `42501`.                                                                    | E1, S1 | R-001 | Red         |
| `D-IMM-CASCADE-TRUNCATE`  | P0  | DB          | `TRUNCATE "User" CASCADE` and `TRUNCATE "LookbookPost" CASCADE` answer `42501` and every decision row stays.                                                                                                                                                                             | E1, S1 | R-001 | Red         |
| `D-IMM-INSERT`            | P0  | DB          | The application role inserts with `RETURNING`, reads the row, and a `CommunitySanction` child insert passes its foreign key.                                                                                                                                                             | E1     | R-009 | Red         |
| `D-IMM-PRISMA`            | P0  | Integration | A real Prisma client connected as the application role runs `moderationDecision.create` and `findMany`, which proves the ORM's statement shape survives the grants.                                                                                                                      | E1     | R-009 | Red         |
| `D-IMM-REPLICA-LIMIT`     | P2  | DB          | A superuser under `session_replication_role = replica` skips the trigger. The test pins this limit so the guide's statement stays true.                                                                                                                                                  | E1     | R-004 | Green guard |
| `D-RESIDUAL-SCHEMA-OWNER` | P1  | DB          | The application role as schema owner can run `DROP FUNCTION private.moderation_history_guard() CASCADE` and `DROP TABLE`. The test pins both in a rolled-back transaction, asserts `UPDATE` stays refused with the triggers gone, and asserts `moderation:history:verify` fails on each. | E1     | R-004 | Red         |
| `D-EX-FK-USER`            | P0  | DB          | `DELETE` of a subject's `User` row under the guard nulls `subject_user_id`, leaves every other column identical, and leaves `reason` and `anonymized_at` untouched.                                                                                                                      | E1, S2 | R-001 | Red         |
| `D-EX-FK-MOD`             | P0  | DB          | Same for a moderator's `User` row and `moderator_id`.                                                                                                                                                                                                                                    | E1, S2 | R-001 | Red         |
| `D-EX-FK-TARGET`          | P0  | DB          | Same for `post_id` and `comment_id` when the post or comment row goes.                                                                                                                                                                                                                   | E1, S2 | R-001 | Red         |
| `D-EX-RENAME`             | P1  | DB          | `UPDATE "User" SET id` is refused for a member with a decision row and still works for one with none, so `community_member_identity_updated` keeps its behavior.                                                                                                                         | S2     | R-001 | Red         |
| `D-EX-OWNER-FROZEN`       | P0  | DB          | Table-driven, as the owner: a change to each of `id`, `case_key`, `sequence`, `source`, `report_ids`, `action`, `moderator_role`, `subject_alias`, `mutation_id`, `payload_hash`, `response`, `is_terminal`, `decided_at` answers `42501`.                                               | S2     | R-001 | Red         |
| `D-EX-OWNER-IDENTITY`     | P0  | DB          | As the owner: a new value in an identity column, or `NULL` to a value, answers `42501`.                                                                                                                                                                                                  | S2     | R-001 | Red         |
| `D-EX-OWNER-REASON`       | P0  | DB          | As the owner: free text in `reason`, `[erased]` with `anonymized_at` null, and `[erased]` back to text answer `42501`. `[erased]` with `anonymized_at` set passes.                                                                                                                       | S2     | R-001 | Red         |
| `D-EX-OWNER-TIMESTAMP`    | P0  | DB          | As the owner: `NULL` to a timestamp passes. Timestamp to another timestamp and timestamp to `NULL` answer `42501`.                                                                                                                                                                       | S2     | R-001 | Red         |
| `D-EX-OWNER-DELETE`       | P0  | DB          | As the owner: `DELETE` and `TRUNCATE` answer `42501`.                                                                                                                                                                                                                                    | S2     | R-001 | Red         |
| `D-EX-NEW-COLUMN`         | P1  | DB          | A column added in the throwaway database is refused for the owner, which proves the guard denies by default (TEA-18).                                                                                                                                                                    | S2     | R-001 | Red         |
| `D-EX-NO-SPOOF`           | P0  | DB          | `set_config` of any name, and a nested trigger, grant nothing. A source read of the guard's `prosrc` finds no `current_setting`, `session_user` or `pg_trigger_depth`.                                                                                                                   | S2     | R-001 | Red         |

### Database: exception function (same file)

| ID                         | P   | Level | Scenario                                                                                                                                                                                                      | AC     | Risk  | Mode |
| -------------------------- | --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- | ---- |
| `D-FN-NO-REQUEST`          | P0  | DB    | Inside the guard with no request row: `42501`, no row changes.                                                                                                                                                | S2, S3 | R-002 | Red  |
| `D-FN-NO-GUARD`            | P0  | DB    | With a request row and no guard, at `privacy_version` 0 and at 1: `23514`, no row changes. Version 0 is the production default, so this is the row that fails against `community_require_guard` (TEA-02).     | S2, S3 | R-003 | Red  |
| `D-FN-WRONG-GUARD`         | P0  | DB    | Holding the guard of another member: `23514`.                                                                                                                                                                 | S2     | R-003 | Red  |
| `D-FN-ACL`                 | P0  | DB    | `EXECUTE` is held only by the migrating role, the owner is `moderation_history_owner`, `prosecdef` is true and `proconfig` pins `search_path`.                                                                | S2     | R-003 | Red  |
| `D-FN-REPLACED-DEPENDENCY` | P0  | DB    | The application role replaces `community_require_guard` with a body that rewrites `action`, then calls the function. The row is unchanged, because the function no longer calls an application-owned routine. | S2     | R-003 | Red  |
| `D-FN-RLS-VISIBLE`         | P0  | DB    | With RLS on and zero policies on the report tables and the request table, the function sees their rows and returns the true count. This is the case that fails without TEA-01.                                | E2, S4 | R-002 | Red  |
| `D-FN-SUBJECT`             | P0  | DB    | Subject rows: `subject_user_id` null, `reason` `[erased]`, `anonymized_at` set, every other column identical.                                                                                                 | E2, S4 | R-005 | Red  |
| `D-FN-REPORTER`            | P0  | DB    | A reporter's post report and a reporter's comment report each redact the overlapping decision. The subject column of that row, naming a third party, stays.                                                   | E2, S4 | R-005 | Red  |
| `D-FN-MODERATOR`           | P0  | DB    | Moderator rows: `moderator_id` null, `reason` kept, `moderator_role` kept.                                                                                                                                    | E2     | R-005 | Red  |
| `D-FN-ALIAS-MATCH`         | P1  | DB    | A decision with a null `subject_user_id` and the member's alias is treated as the member's, and a report in that state has its snapshot scrubbed (TEA-16).                                                    | E2, S4 | R-005 | Red  |
| `D-FN-CROSS-MEMBER`        | P0  | DB    | A row anonymized by a moderator's erasure and later touched by its subject's erasure keeps the first `anonymized_at` and takes `[erased]`.                                                                    | E2, S2 | R-007 | Red  |
| `D-FN-IDEMPOTENT`          | P0  | DB    | A second call returns 0, changes no row and raises nothing (TEA-06).                                                                                                                                          | E2, S4 | R-007 | Red  |
| `D-FN-AUDIT`               | P0  | DB    | With a requester and changed rows: one `moderation_history_anonymized` row with exactly `{erasureRequestId, decisions}`. Zero changed rows or no requester: none.                                             | E3     | R-005 | Red  |
| `D-FN-UTC`                 | P1  | DB    | On a session at `America/Chicago`, `anonymized_at` is within a minute of UTC now (TEA-07).                                                                                                                    | E2     | R-020 | Red  |

### Database: role, schema, migration (`packages/db/test/moderation-history-immutability.spec.ts`, `migration-hygiene.spec.ts`, `rls/moderation-queue.spec.ts`, `moderation-decisions-backfill.spec.ts`)

| ID                        | P   | Level       | Scenario                                                                                                                                                                                                      | AC  | Risk  | Mode        |
| ------------------------- | --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- | ----------- |
| `D-ROLE-ATTRS`            | P0  | DB          | `moderation_history_owner` is `NOLOGIN`, `BYPASSRLS`, `NOSUPERUSER`, `NOCREATEROLE`, `NOCREATEDB`.                                                                                                            | E1  | R-002 | Red         |
| `D-ROLE-MEMBERS`          | P0  | DB          | After the migration the migrating role's only `pg_auth_members` row is `admin_option` true with `set_option` and `inherit_option` false, and no login role holds `SET` or `INHERIT`.                          | E1  | R-001 | Red         |
| `D-ROLE-GRANTS`           | P0  | DB          | `aclexplode` gives the owner's exact grants from D5 as amended by TEA-02 and TEA-16, and no `CREATE` on `public` or `private` remains.                                                                        | E1  | R-001 | Red         |
| `D-RLS`                   | P0  | DB          | `ModerationErasureRequest` has RLS on, zero policies and zero client grants, and sits in `MODERATION_HISTORY_TABLES`. `ModerationDecision` stays in the API-only list.                                        | E1  | R-005 | Red         |
| `D-SCHEMA`                | P1  | DB          | `anonymized_at` and the request table match `schema.prisma`, `prisma migrate diff` is empty, and `requested_by` and `member_id` are `SET NULL` (TEA-12).                                                      | E2  | R-009 | Red         |
| `D-HYGIENE-RULE`          | P1  | Unit        | Fixture strings: a later migration with DDL on `"ModerationDecision"` and no revoke fails the rule, one that only reads it in a backfill passes, and the 6.13 migration passes.                               | E1  | R-001 | Red         |
| `D-BACKFILL-FIX`          | P1  | DB          | `moderation-decisions-backfill.spec.ts:414` inserts its values directly, and its assertions stay green.                                                                                                       | E1  | R-009 | Red         |
| `D-MIG-NONSUPER`          | P0  | Integration | The whole chain applies as `NOSUPERUSER CREATEROLE BYPASSRLS`, the local Supabase attributes.                                                                                                                 | E1  | R-009 | Red         |
| `D-MIG-LACKS-BYPASS`      | P0  | Integration | A migrating role without `BYPASSRLS` fails the migration visibly and leaves no partial state, because the file is one transaction.                                                                            | E1  | R-009 | Red         |
| `D-MIG-ROLE-EXISTS`       | P1  | Integration | A second database in the cluster migrates with the role present, including a role left without `BYPASSRLS`, which the migration repairs.                                                                      | E1  | R-010 | Red         |
| `D-MIG-CONCURRENT`        | P1  | Integration | Two real `prisma migrate deploy` runs on two databases in one cluster both finish and both end with correct owners and no leftover `SET` grant. Measured: the second `GRANT` waits for the first transaction. | E1  | R-010 | Red         |
| `D-MIG-RESET`             | P1  | Integration | `prisma migrate reset` twice on one database. `private` survives it, so the second run proves `CREATE OR REPLACE` under the owner (TEA-17).                                                                   | E1  | R-010 | Red         |
| `D-MIG-PREVIEW-FAIL-SAFE` | P2  | Integration | `scripts/prisma-migrate-deploy.mjs` on a pooled URL path keeps `SET ROLE` and `RESET ROLE` on one connection, read from the wrapper's resolved URL.                                                           | E1  | R-010 | Green guard |

### Verifier (`scripts/verify-moderation-history.spec.mjs` or the repo's script spec home)

| ID                 | P   | Level       | Scenario                                                                                                                                                                                                                                                                                                                                                                                                                                   | AC     | Risk  | Mode |
| ------------------ | --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ----- | ---- |
| `V-CLEAN-NONSUPER` | P0  | Integration | Exit 0 connected as the non-superuser application role.                                                                                                                                                                                                                                                                                                                                                                                    | E1, S1 | R-016 | Red  |
| `V-CLEAN-SUPER`    | P0  | Integration | Exit 0 connected as a superuser, which fails if the checks use `has_table_privilege` or `pg_has_role` (TEA-04).                                                                                                                                                                                                                                                                                                                            | E1, S1 | R-016 | Red  |
| `V-FAULTS`         | P0  | Integration | Table-driven, one fault per closed check name: a login role granted `SET`, a login role granted `INHERIT`, each trigger disabled, each trigger dropped, `UPDATE`, `DELETE`, `TRUNCATE` granted to the application role, `SELECT` granted to each client role, `EXECUTE` to `PUBLIC`, owner changed, owner lost `BYPASSRLS`, application role lost `BYPASSRLS`, table dropped and recreated. Each exits non-zero and prints the check name. | E1, S3 | R-016 | Red  |
| `V-READ-ONLY`      | P1  | Integration | Every statement the script sends is a catalog `SELECT`, and output holds no row data.                                                                                                                                                                                                                                                                                                                                                      | E1     | R-016 | Red  |
| `V-SAME-SOURCE`    | P1  | Unit        | The script and the sweep import one exported check list.                                                                                                                                                                                                                                                                                                                                                                                   | E1     | R-017 | Red  |

### Contract units (`packages/api-client/testing/moderation-history-contract.spec.ts`)

| ID                    | P   | Level | Scenario                                                                                                                                                                                                                                                                         | AC     | Risk  | Mode |
| --------------------- | --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- | ---- |
| `U-C-EXPORT-EXCLUDED` | P0  | Unit  | Table-driven: `reporter_id`, `subject_user_id`, `details`, `content_snapshot`, `image_object_path`, a signed URL, `mutation_id`, `payload_hash`, `response`, `ip_address`, `email`, `name` each make the strict bundle schema reject, on the envelope and on each nested object. | E3, S7 | R-012 | Red  |
| `U-C-ERASURE-STRICT`  | P1  | Unit  | Request and response schemas are strict, and `memberId` has the existing id shape.                                                                                                                                                                                               | E3     | R-013 | Red  |
| `U-C-RESERVED-REASON` | P0  | Unit  | `[erased]` and `[erased]` are refused by both the decision and the appeal schema, and a reason that only contains the text passes.                                                                                                                                               | E2     | R-025 | Red  |
| `U-C-RANGE`           | P0  | Unit  | `from` before `to`, exactly 90 days passes, 90 days plus 1 ms is `invalid_range`, a non-UTC offset parses to the right instant.                                                                                                                                                  | E3     | R-015 | Red  |
| `U-C-OPENAPI`         | P1  | Unit  | OpenAPI and generated SDK regenerate with no diff, and the decision contract's shape is unchanged.                                                                                                                                                                               | E3     | R-021 | Red  |

### API units (`apps/api/src/modules/moderation/moderation-history.*.spec.ts`)

| ID                 | P   | Level | Scenario                                                                                                                                                                                                                                           | AC     | Risk  | Mode        |
| ------------------ | --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- | ----------- |
| `U-AUDIT-HELPER`   | P0  | Unit  | The one helper emits exact keys for each of the four event types, and a subject id, reporter id, alias or reason cannot reach it.                                                                                                                  | E3     | R-012 | Red         |
| `U-DIGEST`         | P0  | Unit  | `sha256` is stable across key order, changes on any field of any of the four arrays, ignores the envelope, and matches a golden value.                                                                                                             | E3, S7 | R-014 | Red         |
| `U-MAP-REASON`     | P0  | Unit  | `[erased]` maps to `reasonRemoved: true`, and a moderator-erased row with `anonymized_at` set keeps its reason.                                                                                                                                    | E3     | R-012 | Red         |
| `U-MAP-REPORTER`   | P0  | Unit  | `reporterState`: a reporter id gives `member`, null with origin `screening` gives `screening`, null with origin `member` gives `erased`. No id is present in any output.                                                                           | E2, E3 | R-012 | Red         |
| `U-MAP-ACTOR`      | P0  | Unit  | An audit actor with a request row reads as null (TEA-11).                                                                                                                                                                                          | E3     | R-012 | Red         |
| `U-SNAPSHOT-STRIP` | P0  | Unit  | The helper keeps `locale`, `climateBand`, `capturedAt`, drops every other key including an unknown one, and passes null through.                                                                                                                   | E2     | R-005 | Red         |
| `U-RET-CUTOFF`     | P1  | Unit  | Cutoff arithmetic from the injected clock at 399, 400 and 401 days.                                                                                                                                                                                | E2, S6 | R-011 | Red         |
| `U-R-ORDER`        | P0  | Unit  | Check order bearer, role, flags, input: a guardian with a bad body gets the 403, and a moderator with a bad body and the flag off gets the 503.                                                                                                    | E3     | R-013 | Red         |
| `U-R-FLAG`         | P0  | Unit  | Either flag false, or a thrown read, gives 503 `moderation_history_disabled`, and a non-moderator never learns it.                                                                                                                                 | S8     | R-021 | Red         |
| `U-R-HEADERS`      | P1  | Unit  | `Cache-Control: private, no-store`, and `Content-Disposition` with a server-built file name.                                                                                                                                                       | E3     | R-012 | Red         |
| `U-NO-WRITE-PATHS` | P0  | Unit  | A source scan across `apps/`, `scripts/` and `packages/db/prisma/seeds` finds no `moderationDecision.update`, `.delete`, `.upsert`, and no raw `UPDATE`, `DELETE` or `TRUNCATE` on the table. Extends `moderation-decisions.service.spec.ts:1512`. | E1     | R-001 | Green guard |
| `U-FLAG-REGISTRY`  | P1  | Unit  | `moderation_history_enabled` default false, seed true, `FEATURE_FLAG_KEYS.at(-1)` and count assertions.                                                                                                                                            | S8     | R-021 | Red         |

### Worker wiring units (`maintenance.processor.spec.ts`, `maintenance.scheduler.spec.ts`, `community.bootstrap.spec.ts`, `community-worker-runtime.spec.ts`, `community-worker-release-gate.spec.ts`)

| ID                   | P   | Level | Scenario                                                                                                                              | AC  | Risk  | Mode        |
| -------------------- | --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- | ----------- |
| `U-W-BOTH-PATHS`     | P0  | Unit  | The `maintenance` job and the community interval both call one factory.                                                               | S6  | R-017 | Red         |
| `U-W-BOOT-RUN`       | P0  | Unit  | The community path runs once at boot and then every 24 hours, so a worker that restarts daily still prunes and still checks (TEA-14). | S6  | R-017 | Red         |
| `U-W-FLAG-PRUNE`     | P0  | Unit  | Flag off skips the prune and still runs the drift check, evaluated for subject `system:moderation-history`.                           | S8  | R-017 | Red         |
| `U-W-OVERLAP`        | P1  | Unit  | A slow run blocks the next on that process, and a thrown error logs a closed message with no row data.                                | S6  | R-017 | Red         |
| `U-W-IMAGE-GRAPH`    | P0  | Unit  | The community image's pruned graph resolves the sweep, the check list and the erasure additions, inside the 150 MB budget.            | E2  | R-023 | Red         |
| `U-W-OTHER-PRUNES`   | P1  | Unit  | The `JobFailure` and telemetry prunes name none of the D7 tables.                                                                     | S6  | R-011 | Green guard |
| `U-S-REPAIR-NO-WORK` | P2  | Unit  | With no identity left for a member, the repair pass takes no guard (TEA-19).                                                          | E2  | R-008 | Red         |
| `U-S-OVERDUE-LOG`    | P1  | Unit  | `moderation_erasure_overdue` holds a count and hours, and no id.                                                                      | E2  | R-008 | Red         |

### Integration: erasure (`apps/api/integration/moderation-history-erasure.integration.spec.ts`)

| ID                     | P   | Level       | Scenario                                                                                                                                                                                                                                                                                                                                                                         | AC     | Risk  | Mode        |
| ---------------------- | --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- | ----------- |
| `I-E-SUBJECT`          | P0  | Integration | A member with decisions, reports, alias and ban: at commit no decision, report or event names them, no snapshot holds their text, alias and sanction rows are gone.                                                                                                                                                                                                              | E2, S4 | R-005 | Red         |
| `I-E-REPORTER`         | P0  | Integration | A member who filed post and comment reports on a live post: `reporter_id` and `details` null, the report reads `erased`, the case stays open and actionable.                                                                                                                                                                                                                     | E2, S4 | R-005 | Red         |
| `I-E-MODERATOR`        | P0  | Integration | A member who decided cases: `moderator_id` null, role and reason kept, and third-party rows untouched.                                                                                                                                                                                                                                                                           | E2     | R-005 | Red         |
| `I-E-CANARY-SCAN`      | P0  | Integration | A catalog walk over every `public` table and text or JSON column, after completion, for the member id, the alias, a caption canary and an alt text canary. The allow-list is exact: `ModerationErasureRequest.member_id` until the `User` row goes, `AuditLog.user_id` of an erased operator, and the tables the account-deletion story owns. A new table fails this by default. | E2, S4 | R-005 | Red         |
| `I-E-HISTORY-INTACT`   | P0  | Integration | After erasure: action, time, role, sequence, `is_terminal` identical to a pre-erasure capture, `firstDecisionAt` unchanged, on the real read path.                                                                                                                                                                                                                               | E2, S5 | R-005 | Red         |
| `I-E-ATOMIC`           | P0  | Integration | A fault injected at each D4 step in turn rolls everything back, including the request row, and a retry succeeds.                                                                                                                                                                                                                                                                 | E2     | R-005 | Red         |
| `I-E-ORDER`            | P0  | Integration | The reporter lookup runs ahead of `eraseCommunityComments`: a comment-report overlap is still redacted.                                                                                                                                                                                                                                                                          | E2     | R-005 | Red         |
| `I-E-REPLAY`           | P0  | Integration | A second request returns the first row, keeps `requested_at`, writes no audit row, and is harmless to rerun.                                                                                                                                                                                                                                                                     | E2     | R-008 | Red         |
| `I-E-REQUESTED-BY`     | P1  | Integration | An admin who requested erasures and is later erased: their `requested_by` values become null (TEA-12).                                                                                                                                                                                                                                                                           | E2, S4 | R-005 | Red         |
| `I-E-NO-REMINT`        | P0  | Integration | After erasure, `resolveAlias`, `resolveAliases`, a report on that post and a feed read create no alias row (TEA-15).                                                                                                                                                                                                                                                             | E2, S4 | R-018 | Red         |
| `I-E-LOCKED-OUT`       | P0  | Integration | After erasure the member's allocate, publish, report, comment and react answer the existing denial and write nothing, so no new identity appears behind the request.                                                                                                                                                                                                             | E2     | R-005 | Green guard |
| `I-E-WITHDRAW-KEEPS`   | P0  | Integration | A post withdrawal with no account erasure keeps snapshot, identity and decision.                                                                                                                                                                                                                                                                                                 | E2     | R-005 | Green guard |
| `I-E-THIRD-PARTY-TEXT` | P1  | Integration | A third party's `details` on the member's post stays, and another member's post snapshot is untouched.                                                                                                                                                                                                                                                                           | E2     | R-005 | Red         |
| `I-E-SANCTION`         | P1  | Integration | An active ban: sanction gone, ban decision kept, `sweepExpiredBanHolds` has nothing to do and logs no error.                                                                                                                                                                                                                                                                     | E2     | R-026 | Red         |
| `I-E-DECIDE-AFTER`     | P0  | Integration | Before the post row goes: a non-ban decision stores null `subject_user_id`, `ban` is refused with `author_ineligible`, and no sanction is created.                                                                                                                                                                                                                               | E2     | R-026 | Red         |
| `I-E-CONSOLE-AFTER`    | P1  | Integration | Case detail after erasure: `subjectStanding` is sound with no sanction, prior actions carry the removed marker, and no appeal step is offered.                                                                                                                                                                                                                                   | E2, S5 | R-026 | Red         |
| `I-E-MUTATION-REPLAY`  | P0  | Integration | The same `mutationId` after anonymization returns the stored response unchanged, and the parsed `response` holds no user id.                                                                                                                                                                                                                                                     | E1, E2 | R-009 | Red         |
| `I-E-RACE-SUBJECT`     | P0  | Integration | Real concurrent decision and subject erasure, both orders, with a barrier: no row leaves the subject behind after the transaction or the first repair, and neither side surfaces `40P01`.                                                                                                                                                                                        | E2     | R-006 | Red         |
| `I-E-RACE-REPORTER`    | P0  | Integration | Real concurrent decision and reporter erasure, both orders: a decision that committed first is redacted, and repair is never relied on (TEA-09). Fails with no case lock in erasure.                                                                                                                                                                                             | E2     | R-006 | Red         |
| `I-E-SWEEP-GUARD-GONE` | P1  | Integration | Repair runs after `CommunitySubject` is deleted and still takes the guard.                                                                                                                                                                                                                                                                                                       | E2     | R-007 | Red         |

### Integration: completion (`apps/api/integration/moderation-history-completion.integration.spec.ts`, injected clock, real Postgres, fake storage only at the object boundary)

| ID                        | P   | Level       | Scenario                                                                                                                                                                               | AC         | Risk  | Mode |
| ------------------------- | --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----- | ---- |
| `I-C-WINDOW`              | P0  | Integration | Clock at 69h59m: open. At 70h: posts purged and deleted, `completed_at` stamped, and `completed_at` minus `requested_at` is at most 72 hours.                                          | E2, S4     | R-008 | Red  |
| `I-C-NO-POSTS`            | P1  | Integration | A member with no posts completes on the first sweep.                                                                                                                                   | E2         | R-008 | Red  |
| `I-C-LATE-WRITE`          | P1  | Integration | An object recreated inside the window is deleted again, and completion waits for the purge stamp.                                                                                      | E2         | R-008 | Red  |
| `I-C-STORAGE-DOWN`        | P0  | Integration | Deletes keep failing: `completed_at` stays null, at exactly 72 hours no overdue log, past it `moderation_erasure_overdue`, and recovery then completes.                                | E2         | R-008 | Red  |
| `I-C-REKEY`               | P0  | Integration | After post deletion the case re-keys to `orphan-post`, decision history is reached through `report_ids`, and `post_id`, `image_object_path` are null on decisions, reports and events. | E2, S4, S5 | R-008 | Red  |
| `I-C-THIRD-PARTY-COMMENT` | P0  | Integration | Deleting the post cascades a third party's comment. Its report re-keys, `CommunityCommentAudit` survives through the report, and its decision row keeps that person's subject id.      | E2, S6     | R-011 | Red  |
| `I-C-REPAIR-CATCH`        | P0  | Integration | A decision naming the member, inserted past the request as if it committed around it, is cleared by the next sweep.                                                                    | E2         | R-007 | Red  |
| `I-C-REPAIR-SPAM`         | P0  | Integration | Many sweeps after completion or with nothing to do write no audit row and raise nothing.                                                                                               | E2         | R-007 | Red  |
| `I-C-BATCH`               | P1  | Integration | More posts than `MAX_SWEEP_BATCH`: completion waits for all of them, in one 7-second privacy transaction per step.                                                                     | E2         | R-008 | Red  |
| `I-C-EARLIER-WITHDRAWAL`  | P1  | Integration | A post withdrawn before the request keeps its own window and still blocks completion until purged.                                                                                     | E2         | R-008 | Red  |
| `I-C-TZ`                  | P1  | Integration | On a `TimeZone=America/Chicago` session the 70-hour and 72-hour bounds land on the same instants.                                                                                      | E2         | R-020 | Red  |

### Integration: retention (`apps/api/integration/moderation-history-retention.integration.spec.ts`)

| ID               | P   | Level       | Scenario                                                                                                                                                                                                 | AC     | Risk  | Mode |
| ---------------- | --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- | ---- |
| `I-R-BOUNDARY`   | P0  | Integration | Terminal alerts at 399 days, exactly 400 days and 401 days, for each of the three deliveries: only 401 goes.                                                                                             | E2, S6 | R-011 | Red  |
| `I-R-PENDING`    | P0  | Integration | A `pending` alert at 500 days stays.                                                                                                                                                                     | E2, S6 | R-011 | Red  |
| `I-R-OWED`       | P0  | Integration | A terminal alert with `failure_owed_code` set and `failure_escalated_at` null stays at 500 days (TEA-14).                                                                                                | E2     | R-011 | Red  |
| `I-R-13-MONTH`   | P0  | Integration | At 13 months a decision, audit row, `ModerationEvent`, `CommunityCommentAudit`, post report and comment report all stay, compared by row hash, after a real run of the sweep and of the existing prunes. | E2, S6 | R-011 | Red  |
| `I-R-BATCH`      | P1  | Integration | 600 eligible rows: one run removes the 500 oldest, the next removes the rest.                                                                                                                            | S6     | R-011 | Red  |
| `I-R-TZ`         | P1  | Integration | The 400-day boundary holds on a Chicago session.                                                                                                                                                         | S6     | R-020 | Red  |
| `I-R-DRIFT-LOG`  | P0  | Integration | A real injected `GRANT`: the sweep logs `moderation_history_enforcement_drift` with the check name, and the flag off still logs it.                                                                      | E1, S8 | R-017 | Red  |
| `I-R-REALERT`    | P2  | Integration | A case still open past a pruned alert raises a new alert under the same dedupe key, and the old row is gone.                                                                                             | S6     | R-011 | Red  |
| `I-R-CONCURRENT` | P2  | Integration | Two workers at once delete each row once and raise nothing.                                                                                                                                              | S6     | R-011 | Red  |

### Integration: routes (`apps/api/integration/moderation-history-route.integration.spec.ts`, real Nest over real HTTP, real Postgres)

| ID                    | P   | Level | Scenario                                                                                                                                                                                                      | AC         | Risk  | Mode |
| --------------------- | --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----- | ---- |
| `A-ER-ADMIN`          | P0  | API   | Admin, valid member: 201 with `requestId`, `requestedAt`, `deadlineAt` exactly 72 hours later, `replayed: false`.                                                                                             | E2, E3     | R-013 | Red  |
| `A-ER-ROLES`          | P0  | API   | Moderator gets 403 `admin_required`; guardian, teen and no token get the same 403 or 401 body as 6.10, with no write.                                                                                         | E2, E3     | R-013 | Red  |
| `A-ER-UNKNOWN`        | P1  | API   | Unknown member: 404 `member_not_found`, no request row, no audit row.                                                                                                                                         | E3         | R-013 | Red  |
| `A-ER-AUDIT`          | P0  | API   | One `moderation_erasure_requested` with `{requestId, role}`, committed with the erasure. A forced `AuditLog` failure rolls the whole request back (TEA-13). The member id is absent from every new audit row. | E2, E3     | R-014 | Red  |
| `A-ER-REPLAY`         | P0  | API   | Second call: 200, first row, `replayed: true`, same `deadlineAt`.                                                                                                                                             | E2         | R-008 | Red  |
| `A-X-CASE`            | P0  | API   | Moderator exports a real case: 200, attachment, parses under the strict schema, and holds the decision, its reports, audit events and alerts.                                                                 | E3, S7     | R-012 | Red  |
| `A-X-CANARY`          | P0  | API   | Seed a distinct canary in every excluded column, including an email and a reporter id. The raw response bytes contain none of them, for case and range.                                                       | E2, E3, S7 | R-012 | Red  |
| `A-X-AUDIT-ONE`       | P0  | API   | Exactly one `moderation_evidence_exported` row, with digest equal to the bundle's and recomputed from its arrays, and holding no subject, reporter, alias or reason.                                          | E3, S7     | R-014 | Red  |
| `A-X-AUDIT-FAIL`      | P0  | API   | A failing `AuditLog` insert answers 503 `audit_unavailable` with no bundle bytes.                                                                                                                             | E3         | R-014 | Red  |
| `A-X-DENIED-NO-AUDIT` | P0  | API   | Every refusal (401, 403, 400, 404, 413, 503) leaves the audit count unchanged.                                                                                                                                | E3, S7     | R-014 | Red  |
| `A-X-SELF`            | P0  | API   | A moderator who wrote or reported the case: 403 `self_review_refused`, for a live case and for a case whose author reference is on the post row only.                                                         | E3         | R-013 | Red  |
| `A-X-RANGE-ROLE`      | P0  | API   | `scope: range` as moderator: 403 `admin_required`.                                                                                                                                                            | E3         | R-013 | Red  |
| `A-X-RANGE-CONFLICT`  | P0  | API   | An admin who reported a case in the range: those rows and their reports, audit events and alerts are omitted, `withheldForConflict` counts them, and the digest covers what is present.                       | E3         | R-012 | Red  |
| `A-X-RANGE-LIMITS`    | P0  | API   | 5,000 decisions pass. 5,001 give 413 `export_too_large` with the count query alone. 90 days plus 1 ms gives 400 `invalid_range`. `from` and `to` bounds are pinned at the instant, both ends.                 | E3         | R-015 | Red  |
| `A-X-BYTE-CAP`        | P0  | API   | 5,000 decisions at the 1,000-character reason exceed the cap: 413 `export_too_large`, no audit row. A bundle just under 4,000,000 bytes passes (TEA-10).                                                      | E3         | R-015 | Red  |
| `A-X-LOAD`            | P1  | API   | 5,000 decisions with reports and audit rows finish inside the transaction timeout set for this route, measured.                                                                                               | E3         | R-015 | Red  |
| `A-X-ERASED`          | P0  | API   | A case with anonymized decisions: `reasonRemoved: true`, null moderator, alias only, and the reporter reads `erased`.                                                                                         | E2, E3, S7 | R-012 | Red  |
| `A-X-REKEY`           | P0  | API   | An orphaned case exports through its `orphan-post` id with its decisions and audit events, and audit events match on decision id and case id (TEA-11).                                                        | E2, E3     | R-012 | Red  |
| `A-X-MOD-ERASED`      | P0  | API   | An erased moderator: `moderatorId` null, `reason` kept, audit `actorId` null, while `AuditLog.user_id` stays.                                                                                                 | E2, E3     | R-012 | Red  |
| `A-X-HOSTILE`         | P1  | API   | Markup in a reason comes back as a plain JSON string.                                                                                                                                                         | E3         | R-012 | Red  |
| `A-X-SNAPSHOT`        | P1  | API   | A decision committed during a range read never leaves `counts` different from the arrays, or the digest different from the audit row (repeatable read).                                                       | E3         | R-014 | Red  |
| `A-X-UNKNOWN`         | P1  | API   | Unknown case: existing 404, no audit row.                                                                                                                                                                     | E3         | R-013 | Red  |
| `A-X-TZ`              | P1  | API   | Range bounds on a Chicago session select the same rows as on a UTC session.                                                                                                                                   | E3         | R-020 | Red  |
| `A-FLAG-OFF`          | P0  | API   | Production defaults on a migrated database: both routes 503, enforcement live on the same database.                                                                                                           | S8         | R-021 | Red  |

### Contract (`pact/http/`, OpenAPI)

| ID               | P   | Level    | Scenario                                                                                                                           | AC  | Risk  | Mode |
| ---------------- | --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | --- | ----- | ---- |
| `C-PACT-EXPORT`  | P1  | Contract | Consumer and provider interactions for case export and for each refusal code the web client branches on, one interaction per `it`. | E3  | R-021 | Red  |
| `C-PACT-ERASURE` | P1  | Contract | Same for the erasure route.                                                                                                        | E3  | R-021 | Red  |

### Web units and components (`apps/web`)

| ID                 | P   | Level     | Scenario                                                                                                                                                   | AC     | Risk  | Mode |
| ------------------ | --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- | ---- |
| `W-EXPORT-CONTROL` | P1  | Component | Case detail control states: idle, working, success with download, `self_review_refused`, `audit_unavailable`, disabled, each with one polite announcement. | E3     | R-022 | Red  |
| `W-RANGE-FORM`     | P1  | Component | `/moderation/evidence` validates range client side, shows `export_too_large` and `withheldForConflict`, and admin-only access.                             | E3     | R-022 | Red  |
| `W-REMOVED-LABEL`  | P0  | Component | A prior action with the removed marker renders the localized label, and `[erased]` never reaches the DOM.                                                  | E2, E3 | R-022 | Red  |
| `W-FLAG-OFF`       | P0  | Component | Flag off: no control, no nav entry, page unavailable.                                                                                                      | S8     | R-021 | Red  |
| `W-LOCALES`        | P1  | Component | Catalog parity across all ten web locales for every new key.                                                                                               | E3     | R-022 | Red  |
| `W-A11Y`           | P1  | Component | WCAG 2.2 AA axe pass, 44-pixel targets, label association, focus return.                                                                                   | E3     | R-022 | Red  |
| `W-CLIENT`         | P1  | Unit      | `apps/web/src/lib/moderation.ts` sends the bearer, reads the blob, names the file from `exportId` when CORS hides the header.                              | E3     | R-021 | Red  |

### End to end (`playwright/tests/moderation-history.spec.ts`, real browser, real API and workers, real local Supabase where the application role is the non-superuser `postgres`)

| ID                  | P   | Level | Scenario                                                                                                                                                                                                                                                                                                                                        | AC         | Risk  | Mode |
| ------------------- | --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----- | ---- |
| `P-REFUSED-REAL`    | P0  | E2E   | Decide a case in the browser, then with the same connection string the API uses, `UPDATE`, `DELETE`, `TRUNCATE` answer `42501`, and the row compares byte-identical. This is the one proof on the real Supabase role.                                                                                                                           | E1, E3, S1 | R-016 | Red  |
| `P-ERASE-JOURNEY`   | P0  | E2E   | Admin calls the real route for a real seeded member with a post, a report, an alias and a ban. The helper takes the guard and backdates `requested_at` and `erasure_requested_at` past 70 hours, the running worker's real 30-second sweep completes it, polled with `recurse`. The database then holds no identity, and `completed_at` is set. | E2, E3, S4 | R-008 | Red  |
| `P-CONSOLE-AFTER`   | P0  | E2E   | As a moderator, `/moderation` and case detail show the anonymized history, the localized removed label, and the action, time, role and order from before.                                                                                                                                                                                       | E2, E3, S5 | R-005 | Red  |
| `P-DOWNLOAD`        | P0  | E2E   | Press Export evidence, take the real `download` event, parse the file, assert exclusions on raw bytes, recompute the digest, and match the one audit row.                                                                                                                                                                                       | E3, S7     | R-014 | Red  |
| `P-RANGE`           | P0  | E2E   | As an admin use `/moderation/evidence`: download works. As a moderator the page and the route refuse, and no audit row is written.                                                                                                                                                                                                              | E3         | R-013 | Red  |
| `P-REPORTER-ERASED` | P1  | E2E   | A reporter erased on a live post: the case stays actionable, a moderator resolves it in the browser, and the report reads erased.                                                                                                                                                                                                               | E2         | R-005 | Red  |
| `P-SECURITY-LIST`   | P0  | API   | `playwright/tests/api/auth-moderation-security.spec.ts` covers both routes for no token, wrong role and tampered token.                                                                                                                                                                                                                         | E3         | R-013 | Red  |
| `P-FLAG-OFF`        | P1  | E2E   | With the flag off the control and page are gone and the route answers 503, under an isolated flag state.                                                                                                                                                                                                                                        | S8         | R-021 | Red  |

### Documents and process

| ID                   | P   | Level  | Scenario                                                                                                                                                                                                                                                                                                                                                                    | AC     | Risk  | Mode        |
| -------------------- | --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- | ----------- |
| `U-GATE-RECORD`      | P0  | Unit   | Parses `community-beta-gate-signatures.md`: one row per signature, every signed row has a date, source, limit and a proof naming a real file and a 40-character commit that `git cat-file` resolves. Audit, privacy, deletion, staffing are signed by the owner. Model is unchanged. SLA alerts, localization, accessibility and rollback are open. No roster, no schedule. | E3, S9 | R-019 | Red         |
| `U-GATE-UNTOUCHED`   | P0  | Unit   | `GATE_SIGNATURES` and the committed readiness payload hash are unchanged, and `community:screening:sign` still verifies.                                                                                                                                                                                                                                                    | S9     | R-019 | Green guard |
| `U-RUNBOOK-STAFFING` | P1  | Unit   | Runbook Coverage states the sign-off with date and source, the table's assignee and hours are empty, and gap 11 drops its wording.                                                                                                                                                                                                                                          | S9     | R-019 | Red         |
| `U-GUIDE-LIMITS`     | P1  | Unit   | The deployment guide names the TEA-03 residual, the migration sequence, `moderation:history:verify` and the retention table.                                                                                                                                                                                                                                                | E1, E2 | R-004 | Red         |
| `M-PREVIEW-VERIFY`   | P0  | Manual | `moderation:history:verify` against the PR Preview database after its deployment migrated it. Exit 0 and the role attributes go into the evidence. This is the one hosted proof.                                                                                                                                                                                            | E1, S1 | R-009 | Manual      |
| `M-LOCAL-SUPABASE`   | P0  | Manual | `moderation:history:verify` against local Supabase: exit 0, then non-zero after an injected `GRANT`, then the grant removed.                                                                                                                                                                                                                                                | E1     | R-016 | Manual      |
| `M-VISUAL`           | P1  | Manual | Case detail and `/moderation/evidence` in a real browser with screenshots, light and dark, desktop and mobile, with a long reason, an erased case and each locale's longest label.                                                                                                                                                                                          | E3     | R-022 | Manual      |
| `M-BUNDLE-READ`      | P1  | Manual | Read a downloaded bundle as a compliance reviewer: nothing identifies a reporter or an erased subject.                                                                                                                                                                                                                                                                      | E3, S7 | R-012 | Manual      |
| `M-GATE-READ`        | P1  | Manual | Read the rendered gate record and runbook: dates, sources and limits are right, and no person is named.                                                                                                                                                                                                                                                                     | S9     | R-019 | Manual      |
| `M-SIGNOFF-BURN`     | P0  | Manual | Whole `moderation-*` and `community-*privacy*` suites, unfiltered, three times, at sign-off. Injected faults and the rendered console are checked, per the 6.12 lesson.                                                                                                                                                                                                     | E2, E3 | R-024 | Manual      |

### Generated totals

| Level       | Count   |
| ----------- | ------- |
| Unit        | 32      |
| Integration | 51      |
| API         | 25      |
| DB          | 41      |
| Contract    | 2       |
| Component   | 6       |
| E2E         | 7       |
| Manual      | 6       |
| **Total**   | **170** |

---

## Test Coverage Plan (risk-linked)

Priority criteria:

- P0: critical business, security, data-integrity or compliance impact with no safe workaround.
- P1: core, frequent or complex behavior with material user reach and a limited workaround.
- P2: secondary behavior with narrower reach and an acceptable workaround.
- P3: rare, cosmetic or experimental behavior. None here.

A risk's row sits under the highest priority among its scenarios. Each scenario has its own priority in the catalog.

### P0 (Critical)

| Requirement         | Test Level  | Priority | Risk Link | Test Count | Owner   | Notes                                                                                                                                                                  |
| ------------------- | ----------- | -------- | --------- | ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-001 control holds | Integration | P0       | R-001     | 22         | Builder | `D-IMM-UPDATE`, `D-IMM-DELETE`, `D-IMM-TRUNCATE`, `D-IMM-CLIENT-ROLES`, `D-IMM-SUPERUSER` and more. Consequence: see the risk row. Workaround: none in the product.    |
| R-002 control holds | Integration | P0       | R-002     | 3          | Builder | `D-FN-NO-REQUEST`, `D-FN-RLS-VISIBLE`, `D-ROLE-ATTRS`. Consequence: see the risk row. Workaround: none in the product.                                                 |
| R-003 control holds | Integration | P0       | R-003     | 4          | Builder | `D-FN-NO-GUARD`, `D-FN-WRONG-GUARD`, `D-FN-ACL`, `D-FN-REPLACED-DEPENDENCY`. Consequence: see the risk row. Workaround: none in the product.                           |
| R-005 control holds | Integration | P0       | R-005     | 20         | Builder | `D-FN-SUBJECT`, `D-FN-REPORTER`, `D-FN-MODERATOR`, `D-FN-ALIAS-MATCH`, `D-FN-AUDIT` and more. Consequence: see the risk row. Workaround: none in the product.          |
| R-006 control holds | Integration | P0       | R-006     | 2          | Builder | `I-E-RACE-SUBJECT`, `I-E-RACE-REPORTER`. Consequence: see the risk row. Workaround: none in the product.                                                               |
| R-007 control holds | Integration | P0       | R-007     | 5          | Builder | `D-FN-CROSS-MEMBER`, `D-FN-IDEMPOTENT`, `I-E-SWEEP-GUARD-GONE`, `I-C-REPAIR-CATCH`, `I-C-REPAIR-SPAM`. Consequence: see the risk row. Workaround: none in the product. |
| R-008 control holds | Integration | P0       | R-008     | 12         | Builder | `U-S-REPAIR-NO-WORK`, `U-S-OVERDUE-LOG`, `I-E-REPLAY`, `I-C-WINDOW`, `I-C-NO-POSTS` and more. Consequence: see the risk row. Workaround: none in the product.          |
| R-009 control holds | Integration | P0       | R-009     | 8          | Builder | `D-IMM-INSERT`, `D-IMM-PRISMA`, `D-SCHEMA`, `D-BACKFILL-FIX`, `D-MIG-NONSUPER` and more. Consequence: see the risk row. Workaround: none in the product.               |
| R-011 control holds | Integration | P0       | R-011     | 10         | Builder | `U-RET-CUTOFF`, `U-W-OTHER-PRUNES`, `I-C-THIRD-PARTY-COMMENT`, `I-R-BOUNDARY`, `I-R-PENDING` and more. Consequence: see the risk row. Workaround: none in the product. |
| R-012 control holds | API         | P0       | R-012     | 14         | Builder | `U-C-EXPORT-EXCLUDED`, `U-AUDIT-HELPER`, `U-MAP-REASON`, `U-MAP-REPORTER`, `U-MAP-ACTOR` and more. Consequence: see the risk row. Workaround: none in the product.     |
| R-013 control holds | API         | P0       | R-013     | 10         | Builder | `U-C-ERASURE-STRICT`, `U-R-ORDER`, `A-ER-ADMIN`, `A-ER-ROLES`, `A-ER-UNKNOWN` and more. Consequence: see the risk row. Workaround: none in the product.                |
| R-014 control holds | API         | P0       | R-014     | 7          | Builder | `U-DIGEST`, `A-ER-AUDIT`, `A-X-AUDIT-ONE`, `A-X-AUDIT-FAIL`, `A-X-DENIED-NO-AUDIT` and more. Consequence: see the risk row. Workaround: none in the product.           |
| R-015 control holds | API         | P0       | R-015     | 4          | Builder | `U-C-RANGE`, `A-X-RANGE-LIMITS`, `A-X-BYTE-CAP`, `A-X-LOAD`. Consequence: see the risk row. Workaround: none in the product.                                           |
| R-016 control holds | Integration | P0       | R-016     | 6          | TEA     | `V-CLEAN-NONSUPER`, `V-CLEAN-SUPER`, `V-FAULTS`, `V-READ-ONLY`, `P-REFUSED-REAL` and more. Consequence: see the risk row. Workaround: none in the product.             |
| R-017 control holds | Unit        | P0       | R-017     | 6          | Builder | `V-SAME-SOURCE`, `U-W-BOTH-PATHS`, `U-W-BOOT-RUN`, `U-W-FLAG-PRUNE`, `U-W-OVERLAP` and more. Consequence: see the risk row. Workaround: none in the product.           |
| R-018 control holds | Integration | P0       | R-018     | 1          | Builder | `I-E-NO-REMINT`. Consequence: see the risk row. Workaround: none in the product.                                                                                       |
| R-019 control holds | Unit        | P0       | R-019     | 4          | Builder | `U-GATE-RECORD`, `U-GATE-UNTOUCHED`, `U-RUNBOOK-STAFFING`, `M-GATE-READ`. Consequence: see the risk row. Workaround: none in the product.                              |
| R-021 control holds | Unit        | P0       | R-021     | 9          | Builder | `U-C-OPENAPI`, `U-R-FLAG`, `U-FLAG-REGISTRY`, `A-FLAG-OFF`, `C-PACT-EXPORT` and more. Consequence: see the risk row. Workaround: none in the product.                  |
| R-022 control holds | Component   | P0       | R-022     | 6          | Builder | `W-EXPORT-CONTROL`, `W-RANGE-FORM`, `W-REMOVED-LABEL`, `W-LOCALES`, `W-A11Y` and more. Consequence: see the risk row. Workaround: none in the product.                 |
| R-023 control holds | Unit        | P0       | R-023     | 1          | Builder | `U-W-IMAGE-GRAPH`. Consequence: see the risk row. Workaround: none in the product.                                                                                     |
| R-024 control holds | E2E         | P0       | R-024     | 1          | TEA     | `M-SIGNOFF-BURN`. Consequence: see the risk row. Workaround: none in the product.                                                                                      |
| R-025 control holds | Unit        | P0       | R-025     | 1          | Builder | `U-C-RESERVED-REASON`. Consequence: see the risk row. Workaround: none in the product.                                                                                 |
| R-026 control holds | Integration | P0       | R-026     | 3          | Builder | `I-E-SANCTION`, `I-E-DECIDE-AFTER`, `I-E-CONSOLE-AFTER`. Consequence: see the risk row. Workaround: none in the product.                                               |

### P1 (High)

| Requirement         | Test Level  | Priority | Risk Link | Test Count | Owner   | Notes                                                                                                                                              |
| ------------------- | ----------- | -------- | --------- | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-004 control holds | Integration | P1       | R-004     | 3          | Builder | `D-IMM-REPLICA-LIMIT`, `D-RESIDUAL-SCHEMA-OWNER`, `U-GUIDE-LIMITS`. Consequence: see the risk row. Workaround: none in the product.                |
| R-010 control holds | Integration | P1       | R-010     | 4          | Builder | `D-MIG-ROLE-EXISTS`, `D-MIG-CONCURRENT`, `D-MIG-RESET`, `D-MIG-PREVIEW-FAIL-SAFE`. Consequence: see the risk row. Workaround: none in the product. |
| R-020 control holds | Integration | P1       | R-020     | 4          | Builder | `D-FN-UTC`, `I-C-TZ`, `I-R-TZ`, `A-X-TZ`. Consequence: see the risk row. Workaround: none in the product.                                          |

### P2 (Medium)

No risk has P2 as its highest priority.

### P3 (Low)

None.

---

## Does each Community Beta proof exercise real paths?

| Signature | Database proof                                                                                               | API proof                                    | End-to-end proof                                                                                          | Honest gap                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Audit     | `D-IMM-*`, `D-EX-*`, `D-FN-*`, `V-*` on a real non-superuser role, and `P-REFUSED-REAL` on the Supabase role | `A-X-AUDIT-ONE`, `A-ER-AUDIT` over real HTTP | `P-DOWNLOAD` with a real download                                                                         | Hosted role seen on Preview only. TEA-03 residual                                                                               |
| Privacy   | `I-E-CANARY-SCAN` over the live catalog, `D-FN-*`                                                            | `A-X-CANARY` on raw bytes                    | `P-CONSOLE-AFTER`, `P-DOWNLOAD`                                                                           | Third-party `details` stays                                                                                                     |
| Deletion  | `I-C-*` with an injected clock on real Postgres                                                              | `A-ER-*`                                     | `P-ERASE-JOURNEY`: real route, real worker, real 30-second sweep, with rows backdated by a guarded helper | The clock is backdated in E2E, and the injected clock proves the 70-hour and 72-hour edges. Storage in E2E is the local stack's |

Fakes allowed: the object store at the boundary in `I-C-STORAGE-DOWN`, flags in unit tests, the clock in `I-C-*`.
Nothing else in a signature's proof may be a fake, and no proof may set `privacy_version` to make a guard hold, except `D-FN-NO-GUARD`, which runs both values on purpose.

---

## Explicit negative tests

- Refused for every role: `D-IMM-UPDATE`, `D-IMM-DELETE`, `D-IMM-TRUNCATE`, `D-IMM-CLIENT-ROLES`, `D-IMM-SUPERUSER`, `D-IMM-BYPASS`, `D-IMM-CASCADE-TRUNCATE`.
- Exception cannot write identity or rewrite history: `D-EX-OWNER-*`, `D-EX-NO-SPOOF`, `D-EX-NEW-COLUMN`.
- Function refused: `D-FN-NO-REQUEST`, `D-FN-NO-GUARD`, `D-FN-WRONG-GUARD`, `D-FN-ACL`, `D-FN-REPLACED-DEPENDENCY`.
- Export refused and silent: `A-X-DENIED-NO-AUDIT`, `A-X-SELF`, `A-X-RANGE-ROLE`, `A-X-RANGE-LIMITS`, `A-X-BYTE-CAP`, `A-X-AUDIT-FAIL`.
- Excluded data absent: `U-C-EXPORT-EXCLUDED`, `A-X-CANARY`, `P-DOWNLOAD`, `M-BUNDLE-READ`.
- Retention keeps: `I-R-PENDING`, `I-R-OWED`, `I-R-13-MONTH`.

---

## Test data and harness

- **Non-superuser database (`packages/db/test/support/moderation-history-database.ts`).** Connects with the suite's admin URL. Creates a uniquely named database and the login `moderation_app_probe` as `NOSUPERUSER CREATEROLE CREATEDB BYPASSRLS`. Makes it owner of `public`, `private` and `auth`, to match local Supabase. Applies Supabase default privileges for `anon`, `authenticated`, `service_role`, as `pr-checks` does for the RLS suite, so revokes are not vacuous. If `moderation_history_owner` exists, grants the login `ADMIN` on it, so a shared cluster works. Runs real `prisma migrate deploy` as the login. Drops the database afterward. The role name is cluster-global and stays.
- **Owner-path tests.** A superuser connection issues `SET ROLE moderation_history_owner`, because `current_user` is what the guard reads. The harness never gives the application login `SET`.
- **Guard helper.** Takes the real guard through `community_privacy_guards`, in a transaction, and leaves `privacy_version` at the migration default.
- **`seedModerationHistoryCase`.** Through real writes where a route exists, with the member, a reporter, a moderator, an admin, a post, a report, a decision and a ban, each carrying distinct canaries in every free-text column.
- **Canary scan.** Walks `information_schema.columns` for `text`, `varchar`, `json`, `jsonb` and text arrays in `public`, and reports `table.column` hits against the exact allow-list.
- **E2E aging helper.** Under the guard, backdates `ModerationErasureRequest.requested_at` and the post's `erasure_requested_at`, `image_delete_attempted_at`. Then `recurse` waits for `completed_at` from the real worker, up to 90 seconds.
- **Race harness.** Two real transactions and a barrier from an advisory lock, both orders, as 6.11 and 6.12 did.
- **Red proofs.** Throwaway worktree with `node_modules` symlinked, per the fleet rules. Isolated databases only, and never `cc610_tea_e2e` or `cc610_tea_rls`.
- **Playwright.** `DATABASE_URL` isolated with `PLAYWRIGHT_SKIP_DB_RESET=true`.

### File plan against the budget

New spec files: `packages/db/test/moderation-history-immutability.spec.ts`, its support file, `packages/api-client/testing/moderation-history-contract.spec.ts`, `apps/api/src/modules/moderation/moderation-history.*.spec.ts`, four `apps/api/integration/moderation-history-*.integration.spec.ts`, `playwright/tests/moderation-history.spec.ts`, one verifier spec, one gate-record spec, and web tests.
That is about 15 new files on top of edits to existing specs, inside the 100-file limit on its own. The builder tracks the total.

---

## Execution Strategy

- **PR, `pr-checks`, superuser Postgres:** Unit, Contract, Component, and the DB and Integration suites, with the harness creating its own non-superuser database. New API integration time goes into `Workspace coverage (api)`, which has a 15-minute limit, and the builder records the delta.
- **PR, `pr-pw-e2e-local`, local Supabase:** `moderation-history` Playwright spec, and `moderation:history:verify` as a step before it. This is the real role.
- **Before merge, manual:** `M-PREVIEW-VERIFY`, `M-VISUAL`, `M-BUNDLE-READ`, `M-GATE-READ`, `M-SIGNOFF-BURN`.
- **Nightly or weekly:** nothing new. No suite here needs it.

---

## Red-first plan and seeded-defect proofs

Order for the build:

1. Harness and migration together, with `D-ROLE-*`, `D-IMM-*`, `D-EX-*`, `D-FN-RLS-VISIBLE`, `D-FN-NO-GUARD` red first. `D-IMM-UPDATE` is red today at `56509fa8`, because the application role owns the table.
2. `V-*` red, then the verifier.
3. Contract schemas, with `U-C-*` red.
4. `I-E-*` red, then D4. `I-E-ORDER`, `I-E-RACE-REPORTER` and `I-E-CANARY-SCAN` come before the code they guard.
5. `I-C-*` red, then completion, repair and overdue.
6. Decision and appeal paths: `I-E-DECIDE-AFTER`, `U-C-RESERVED-REASON`.
7. `A-ER-*` and `A-X-*` red, then the routes. `A-X-CANARY` and `A-X-BYTE-CAP` come first.
8. `I-R-*` and `U-W-*` red, then the sweep and both trigger paths.
9. Component tests red against contract fixtures, then the console.
10. Pact and Playwright last. `P-REFUSED-REAL` and `P-DOWNLOAD` are the final proofs.
11. Gate record and documents after green runs exist.

Green guards that start passing: `D-IMM-REPLICA-LIMIT`, `D-MIG-PREVIEW-FAIL-SAFE`, `U-NO-WRITE-PATHS`, `U-W-OTHER-PRUNES`, `I-E-LOCKED-OUT`, `I-E-WITHDRAW-KEEPS`, `U-GATE-UNTOUCHED`.

Seeded defects, each injected in a throwaway worktree on a throwaway database, expected to turn at least the named test red. AC S3 requires S-1 to S-5.

| ID   | Mutation                                                                  | Must turn red                          |
| ---- | ------------------------------------------------------------------------- | -------------------------------------- |
| S-1  | Remove `ALTER TABLE ... OWNER` from the migration                         | `D-IMM-BYPASS`, `V-FAULTS`             |
| S-2  | Remove the `BEFORE UPDATE` trigger                                        | `D-IMM-SUPERUSER`, `D-EX-OWNER-FROZEN` |
| S-3  | Remove the `BEFORE TRUNCATE` trigger                                      | `D-IMM-SUPERUSER`                      |
| S-4  | Remove the function's request check                                       | `D-FN-NO-REQUEST`                      |
| S-5  | Remove the function's guard call                                          | `D-FN-NO-GUARD`                        |
| S-6  | Drop `BYPASSRLS` from the role                                            | `D-FN-RLS-VISIBLE`, `D-ROLE-ATTRS`     |
| S-7  | Leave `service_role` grants in place                                      | `D-IMM-CLIENT-ROLES`                   |
| S-8  | Key the guard on `session_user`                                           | `D-EX-FK-USER`, `D-EX-NO-SPOOF`        |
| S-9  | Allow `action` to change on the owner path                                | `D-EX-OWNER-FROZEN`                    |
| S-10 | Set `anonymized_at` unconditionally                                       | `D-FN-IDEMPOTENT`, `I-C-REPAIR-SPAM`   |
| S-11 | Call the function after `eraseCommunityComments`                          | `I-E-ORDER`                            |
| S-12 | Skip the snapshot scrub                                                   | `I-E-CANARY-SCAN`                      |
| S-13 | Keep `CommunityAlias`                                                     | `I-E-SUBJECT`, `I-E-CANARY-SCAN`       |
| S-14 | Remove the case locks                                                     | `I-E-RACE-REPORTER`                    |
| S-15 | Stamp `completed_at` before the purge                                     | `I-C-WINDOW`, `I-C-LATE-WRITE`         |
| S-16 | Write the export audit row after the response                             | `A-X-AUDIT-FAIL`                       |
| S-17 | Make the bundle schema `passthrough`, and add `reporter_id` to the select | `U-C-EXPORT-EXCLUDED`, `A-X-CANARY`    |
| S-18 | Copy `AuditLog.user_id` with no erasure check                             | `A-X-MOD-ERASED`                       |
| S-19 | Remove the byte cap                                                       | `A-X-BYTE-CAP`                         |
| S-20 | Include `pending` in the prune                                            | `I-R-PENDING`                          |
| S-21 | Use a 365-day cutoff                                                      | `I-R-BOUNDARY`                         |
| S-22 | Allow `range` for a moderator                                             | `A-X-RANGE-ROLE`, `P-RANGE`            |
| S-23 | Render `reason` raw in the console                                        | `W-REMOVED-LABEL`, `P-CONSOLE-AFTER`   |
| S-24 | Use `has_table_privilege` in the verifier                                 | `V-CLEAN-SUPER`                        |

---

## Quality Gate Criteria

### Pass/Fail Thresholds

- P0 pass rate 100 percent. P1 pass rate at least 95 percent, and any miss is fixed in this story, per the fleet rule.
- Every score 6 or higher mitigation done and proved.
- Every seeded defect turns its named test red.

### Coverage Targets

- Line coverage on new `moderation-history.*` code at least 80 percent. Every matrix row in the spec maps to a scenario, in Traceability below.

### Non-Negotiable Requirements

- Enforcement proofs run as a non-superuser with `BYPASSRLS`, and one runs on the real Supabase role.
- No test deletes a decision row. Cleanup deletes users and lets foreign keys act.
- No gate row names a commit or CI run that is not real and green.
- No suite sets `privacy_version` to 1 to make a story proof pass.

---

## Traceability

| AC  | Criterion                                                                                                       | Scenarios                                                                                                                  | P0 count | Notes                 |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------- |
| E1  | Epic AC 1: append-only at the database boundary, refused for application and authenticated roles                | `D-IMM-UPDATE`, `D-IMM-DELETE`, `D-IMM-TRUNCATE`, `D-IMM-CLIENT-ROLES`, `D-IMM-SUPERUSER`, `D-IMM-BYPASS` and 32 more      | 27       | 38 scenarios in total |
| E2  | Epic AC 2: audit metadata kept 12 months, personal content removed, subject and reporter anonymized in 72 hours | `D-FN-RLS-VISIBLE`, `D-FN-SUBJECT`, `D-FN-REPORTER`, `D-FN-MODERATOR`, `D-FN-ALIAS-MATCH`, `D-FN-CROSS-MEMBER` and 59 more | 47       | 65 scenarios in total |
| E3  | Epic AC 3: moderator-authorized export plus DB, API and E2E proof for the three signatures                      | `D-FN-AUDIT`, `U-C-EXPORT-EXCLUDED`, `U-C-ERASURE-STRICT`, `U-C-RANGE`, `U-C-OPENAPI`, `U-AUDIT-HELPER` and 46 more        | 34       | 52 scenarios in total |
| S1  | Spec: non-owner `UPDATE`, `DELETE`, `TRUNCATE` give `42501`, row byte-identical                                 | `D-IMM-UPDATE`, `D-IMM-DELETE`, `D-IMM-TRUNCATE`, `D-IMM-CLIENT-ROLES`, `D-IMM-SUPERUSER`, `D-IMM-BYPASS` and 5 more       | 11       | 11 scenarios in total |
| S2  | Spec: owner path outside the column rules refused                                                               | `D-EX-FK-USER`, `D-EX-FK-MOD`, `D-EX-FK-TARGET`, `D-EX-RENAME`, `D-EX-OWNER-FROZEN`, `D-EX-OWNER-IDENTITY` and 11 more     | 15       | 17 scenarios in total |
| S3  | Spec: migration mutations fail at least one proof                                                               | `D-FN-NO-REQUEST`, `D-FN-NO-GUARD`, `V-FAULTS`                                                                             | 3        | 3 scenarios in total  |
| S4  | Spec: erased member gone from moderation tables, `completed_at` inside 72 hours                                 | `D-FN-RLS-VISIBLE`, `D-FN-SUBJECT`, `D-FN-REPORTER`, `D-FN-ALIAS-MATCH`, `D-FN-IDEMPOTENT`, `I-E-SUBJECT` and 7 more       | 11       | 13 scenarios in total |
| S5  | Spec: action, time, role, sequence, `firstDecisionAt` intact                                                    | `I-E-HISTORY-INTACT`, `I-E-CONSOLE-AFTER`, `I-C-REKEY`, `P-CONSOLE-AFTER`                                                  | 3        | 4 scenarios in total  |
| S6  | Spec: 13-month rows stay, only terminal alerts past 400 days leave                                              | `U-RET-CUTOFF`, `U-W-BOTH-PATHS`, `U-W-BOOT-RUN`, `U-W-OVERLAP`, `U-W-OTHER-PRUNES`, `I-C-THIRD-PARTY-COMMENT` and 7 more  | 6        | 13 scenarios in total |
| S7  | Spec: bundle exclusions, digest matches, one audit row                                                          | `U-C-EXPORT-EXCLUDED`, `U-DIGEST`, `A-X-CASE`, `A-X-CANARY`, `A-X-AUDIT-ONE`, `A-X-DENIED-NO-AUDIT` and 3 more             | 8        | 9 scenarios in total  |
| S8  | Spec: flag off, enforcement live, routes 503, no control                                                        | `U-R-FLAG`, `U-FLAG-REGISTRY`, `U-W-FLAG-PRUNE`, `I-R-DRIFT-LOG`, `A-FLAG-OFF`, `W-FLAG-OFF` and 1 more                    | 5        | 7 scenarios in total  |
| S9  | Spec: gate record names date, source, proof, limit, no person, open rows open                                   | `U-GATE-RECORD`, `U-GATE-UNTOUCHED`, `U-RUNBOOK-STAFFING`, `M-GATE-READ`                                                   | 2        | 4 scenarios in total  |

### I/O matrix rows

| Matrix row                          | Scenario                                                        |
| ----------------------------------- | --------------------------------------------------------------- |
| Application updates a decision      | `D-IMM-UPDATE`                                                  |
| Application deletes, also superuser | `D-IMM-DELETE`, `D-IMM-TRUNCATE`, `D-IMM-SUPERUSER`             |
| Client roles                        | `D-IMM-CLIENT-ROLES`                                            |
| Bypass attempts                     | `D-IMM-BYPASS`                                                  |
| New decision                        | `D-IMM-INSERT`, `D-IMM-PRISMA`                                  |
| Replay after erasure                | `I-E-MUTATION-REPLAY`                                           |
| Function with no request            | `D-FN-NO-REQUEST`                                               |
| Function with no guard              | `D-FN-NO-GUARD`                                                 |
| Owner rewrites a decision           | `D-EX-OWNER-FROZEN`, `D-EX-OWNER-IDENTITY`, `D-EX-OWNER-REASON` |
| User row deleted                    | `D-EX-FK-USER`, `D-EX-FK-MOD`, `D-EX-FK-TARGET`                 |
| Subject erased                      | `I-E-SUBJECT`, `I-E-ATOMIC`                                     |
| Reporter erased                     | `I-E-REPORTER`, `P-REPORTER-ERASED`                             |
| Moderator erased                    | `I-E-MODERATOR`, `A-X-MOD-ERASED`                               |
| Decision after erasure              | `I-E-DECIDE-AFTER`                                              |
| Race with a running decision        | `I-E-RACE-SUBJECT`, `I-E-RACE-REPORTER`                         |
| Second erasure request              | `I-E-REPLAY`, `A-ER-REPLAY`                                     |
| Late write during the window        | `I-C-LATE-WRITE`                                                |
| Storage down                        | `I-C-STORAGE-DOWN`                                              |
| Post withdrawn, no erasure          | `I-E-WITHDRAW-KEEPS`                                            |
| Alert at 399 and 401 days           | `I-R-BOUNDARY`                                                  |
| Old pending alert                   | `I-R-PENDING`                                                   |
| Audit row at 13 months              | `I-R-13-MONTH`                                                  |
| Moderator exports a case            | `A-X-CASE`, `A-X-AUDIT-ONE`, `P-DOWNLOAD`                       |
| Moderator exports a period          | `A-X-RANGE-ROLE`, `P-RANGE`                                     |
| Own case                            | `A-X-SELF`                                                      |
| Export audit fails                  | `A-X-AUDIT-FAIL`                                                |
| Too much                            | `A-X-RANGE-LIMITS`, `A-X-BYTE-CAP`                              |
| Erased case exported                | `A-X-ERASED`                                                    |
| Hostile text                        | `A-X-HOSTILE`, `W-EXPORT-CONTROL`                               |
| Flag off or read fails              | `U-R-FLAG`, `A-FLAG-OFF`, `W-FLAG-OFF`, `U-W-FLAG-PRUNE`        |
| Wrong role                          | `U-R-ORDER`, `A-ER-ROLES`, `P-SECURITY-LIST`                    |
| Enforcement drift                   | `V-FAULTS`, `I-R-DRIFT-LOG`                                     |
| Migration on a second database      | `D-MIG-ROLE-EXISTS`, `D-MIG-CONCURRENT`                         |

### Gap status

No acceptance criterion or matrix row is uncovered.
Stated residuals with no test that could close them: TEA-03 (arbitrary DDL as the migration role), the hosted production role itself, and a reason typed after an erasure commits.

---

## Execution record

Sign-off runs at `743f179ab544ddac55358cf1748e9e540f122309`, 2026-11-05.
Three consecutive full unfiltered runs, one suite at a time, each count identical across all three.
No test failed, none was retried, and none was flaky.

| Lane                                                                                                                               | Passed in each run | Skipped in each run |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------- |
| `packages/db`, plain Postgres at 54339                                                                                             | 441                | 1                   |
| `packages/db`, Supabase image at 54341                                                                                             | 441                | 1                   |
| `apps/api`, every unit and integration suite, plain Postgres                                                                       | 8565               | 38                  |
| `moderation-history` sequential, route, erasure and completion, Supabase image                                                     | 120                | 0                   |
| `packages/api-client`                                                                                                              | 1757               | 0                   |
| `packages/config`                                                                                                                  | 31                 | 0                   |
| `apps/web`                                                                                                                         | 1931               | 0                   |
| Pact consumer                                                                                                                      | 456                | 0                   |
| Pact provider                                                                                                                      | 1                  | 0                   |
| Playwright: `moderation-history`, `-console`, `-decisions`, `-sla`, `auth-moderation-security`, real browser on the Supabase image | 85                 | 1                   |

13828 tests passed in each run.
`moderation:history:verify` passed 16 of 16 checks on the Playwright database in each run.
`node --test` for `coverage-shards`, `workflow-step-shadowing` and `prisma-migrate-connection` passed in each run.

None of the skips is a planned scenario of this story.
`6.1-DB-015` needs a storage schema these databases do not have.
`P-Q-DISABLED-REAL` needs an environment with the console off.
The `apps/api` skips are in `location-capture`, `location-capture.lifecycle`, `community-storage-capability`, `community-comments-measurement`, `integration-schema-required`, `location-preferences` and `weather`.

### Red proofs

A throwaway worktree at `5f611865`, before the fixes for the independent review, on the Supabase image: 17 tests failed against the unfixed source.
C1 4, C2 6, C3 1, C4 1, conflict on an orphan sibling 2, an erased operator on the staff routes 3.
The first database proof at the baseline `56509fa8`: 71 failed and 42 passed.

### Seeded defects

Each ran in a throwaway worktree at `743f179a`, one mutation at a time, against the named tests.
44 of 44 were caught.
`S-1b` shows `0/0` because the migration itself refuses, and no test assertion runs.
`P-LANG` has no seed: it was red against the shipped source before its fix.

| Seed  | Defect                                                                      | Failed / ran |
| ----- | --------------------------------------------------------------------------- | ------------ |
| S-1   | Application role left holding every privilege on the table                  | 1/11         |
| S-1b  | Ownership move removed                                                      | 0/0          |
| S-2   | BEFORE UPDATE trigger removed                                               | 14/16        |
| S-3   | BEFORE TRUNCATE trigger removed                                             | 1/3          |
| S-4   | Function request check removed                                              | 1/1          |
| S-5   | Function guard call removed                                                 | 3/4          |
| S-6   | Owner role left without BYPASSRLS                                           | 2/2          |
| S-7   | service_role grants left in place                                           | 5/19         |
| S-8   | Guard keyed on session_user                                                 | 2/2          |
| S-9   | Owner path may change action                                                | 1/13         |
| S-10  | anonymized_at set unconditionally, and redacted rows reselected             | 1/2          |
| S-11  | Function called after eraseCommunityComments                                | 1/1          |
| S-12  | Snapshot scrub skipped                                                      | 1/2          |
| S-13  | CommunityAlias kept                                                         | 1/2          |
| S-14  | Case locks removed from erasure                                             | 2/2          |
| S-15  | completed_at stamped before the purge                                       | 1/2          |
| S-16  | Export audit row removed                                                    | 1/1          |
| S-17a | Report schema loses strict                                                  | 38/118       |
| S-17b | Reporter id added to the report mapping                                     | 2/2          |
| S-18  | Audit actor copied with no erasure check                                    | 1/1          |
| S-19  | Byte cap removed                                                            | 1/2          |
| S-20  | Pending included in the prune                                               | 1/1          |
| S-21  | 365-day cutoff                                                              | 4/8          |
| S-22  | Range open to a moderator                                                   | 1/1          |
| S-23a | Queue shows the constant raw                                                | 1/1          |
| S-23b | Console ignores the removed marker                                          | 1/1          |
| S-24  | Verifier uses has_table_privilege                                           | 1/2          |
| S-25  | A service updates a decision row                                            | 1/1          |
| S-26  | Role creation no longer tolerates the concurrent winner                     | 1/1          |
| S-27  | Queue link rendered without the admin answer                                | 1/4          |
| S-28  | A raw prune of ModerationEvent                                              | 1/1          |
| S-29  | Publish loses the subject gate                                              | 1/1          |
| S-30  | Decision row re-granted to the application role, triggers kept              | 1/10         |
| S-31  | Member report stores no comment author                                      | 5/6          |
| S-32  | Erasure ignores the author link                                             | 3/5          |
| S-33  | Erasure takes no sanction lock                                              | 4/4          |
| S-34  | Decision does not check its operator                                        | 1/2          |
| S-35  | Appeal does not check its operator                                          | 1/2          |
| S-36  | Queue controller loses the operator guard                                   | 1/3          |
| S-37  | Decision and read ignore joined reports                                     | 2/2          |
| S-38  | Case export ignores the final evidence set                                  | 1/1          |
| S-39  | Range closure stops after one pass                                          | 2/2          |
| S-40  | Verifier loses the granted check                                            | 1/27         |
| S-41  | Erased operator reads the evidence page: history controller loses the guard | 2/3          |

The reworked `scrub_comment_reports_on_user_delete` has no seed, because the API suite runs on an already migrated database.
The builder saw the 23503 it fixes in `community-comments-privacy`, and `I-S-COMMENT-LINK` proves the direct delete.

### Differences from the plan

| Scenario                  | What happened                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `C-PACT-ERASURE`          | Dropped. The erasure route has no web caller, so no consumer exists to pin it. `A-ER-*` and `http-openapi.spec.ts` cover its contract |
| `C-PACT-EXPORT`           | The two evidence export interactions, plus the refusals, in `web-api-client.pacttest.ts`, and a second interaction pins live rows     |
| `U-R-FLAG`, `U-R-HEADERS` | Run through the real module as `A-FLAG-OFF` and `A-X-CASE`, which is stronger than the planned unit                                   |
| `U-FLAG-REGISTRY`         | `packages/config/src/flags.spec.ts` and `feature-flags.service.spec.ts`                                                               |
| `U-S-OVERDUE-LOG`         | `I-C-STORAGE-DOWN` in the completion suite reads the real logger                                                                      |
| `U-C-OPENAPI`             | `packages/api-client/testing/http-openapi.spec.ts`, and `schema-validation.yml` regenerates the SDK                                   |
| `W-CLIENT`                | The real client under `moderation-evidence-export.test.tsx` and the Pact consumer                                                     |
| `D-HYGIENE-RULE`          | `DB-HYGIENE-04` in `migration-hygiene.spec.ts`                                                                                        |
| `D-BACKFILL-FIX`          | `moderation-decisions-backfill.spec.ts`                                                                                               |
| `D-MIG-PREVIEW-FAIL-SAFE` | `scripts/lib/prisma-migrate-connection.test.mjs`                                                                                      |

Added after the plan, because review found the gaps it did not name:

- `I-S-MATRIX`: every ordered pair of five erasures, scanned for ids and for authored words.
- `I-S-COMMENT-LINK`, `I-S-CONCURRENT`, `I-O-RACE-DECISION`, `I-O-RACE-APPEAL`, `I-O-AFTER`, `I-O-SUBJECT`, `I-O-SIBLING-CONFLICT`.
- `A-X-ORPHAN-SIBLING`, `A-X-RANGE-CLOSURE`, `A-X-APPEAL`, `A-AVAILABILITY`, `I-E-OPERATOR-COPIES`, `D-COMMENT-AUDIT`, `D-MIG-ROLE-RACE`, `P-LANG`.

This plan missed C1, C2 and C3, which an independent Codex review found.
`I-C-THIRD-PARTY-COMMENT` stopped before the second erasure, no scenario made an operator the subject of an erasure, and conflict was planned per case.
The sequential matrix and the `I-O` set exist to close that kind of gap.

### Manual checks

| Check              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M-SIGNOFF-BURN`   | Done: the three runs above, with injected faults through `V-FAULTS` and the seeded defects                                                                                                                                                                                                                                                                                                                                             |
| `M-LOCAL-SUPABASE` | Done on the disposable Supabase image: the verifier exits 0 in `V-CLEAN` and in each run, and exits non-zero after each injected fault, including a `GRANT`, in `V-FAULTS`                                                                                                                                                                                                                                                             |
| `M-VISUAL`         | Done. At `7cc95652`: case detail and `/moderation/evidence` in light and dark, at 1280 and 320 pixels, in de-DE and pt-BR, which hold the longest labels, with a long unbroken reason and no horizontal overflow. An erased case at 1280 and 375 pixels at `104ef810`, and in the builder's second walk at `1175a24c`. Only `lang` handling changed on the web after `7cc95652`. This pass found the `lang` defect `P-LANG` now covers |
| `M-BUNDLE-READ`    | Done: a downloaded bundle read as a compliance reviewer holds no reporter id or erased subject id. It keeps the alias, moderator ids of members who are not erased, and the post id inside `caseId`, as D2 and D8 rule. `P-DOWNLOAD` proves it on raw bytes in each run                                                                                                                                                                |
| `M-GATE-READ`      | Done: dates, sources and limits are right, no person is named, and the proof commit named there exists in this repository                                                                                                                                                                                                                                                                                                              |
| `M-PREVIEW-VERIFY` | **Open.** It needs this PR's Preview deployment, and this brief forbids a push. The coordinator read the hosted role on 2026-11-05 (spec CX-6), which is not the same proof. Run `moderation:history:verify` against the Preview database once the PR deploys                                                                                                                                                                          |

### Traceability: acceptance criterion to test file

| AC             | Test files                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1, S1, S2, S3 | `packages/db/test/moderation-history-immutability.spec.ts`, `-function.spec.ts`, `-migration.spec.ts`, `-verifier.spec.ts`, `playwright/tests/moderation-history.spec.ts`                                                                                                                                                                                                           |
| E2, S4, S5     | `apps/api/integration/moderation-history-erasure.integration.spec.ts`, `-completion`, `-sequential`, `packages/db/test/moderation-history-function.spec.ts`, `playwright/tests/moderation-history.spec.ts`                                                                                                                                                                          |
| E3, S7         | `apps/api/integration/moderation-history-route.integration.spec.ts`, `-route-period`, `packages/api-client/testing/moderation-history-contract.spec.ts`, `apps/web/src/app/components/moderation-evidence-export.test.tsx`, `pact/http/consumer/web-api-client.pacttest.ts`, `playwright/tests/moderation-history.spec.ts`, `playwright/tests/api/auth-moderation-security.spec.ts` |
| S6             | `apps/api/integration/moderation-history-retention.integration.spec.ts`, `apps/api/src/modules/moderation/moderation-history.retention.spec.ts`, `apps/api/src/workers/community.bootstrap.spec.ts`, `apps/api/integration/community-worker-release-gate.spec.ts`                                                                                                                   |
| S8             | `apps/api/integration/moderation-history-route-period.integration.spec.ts`, `apps/web/src/app/components/moderation-evidence-export.test.tsx`, `packages/config/src/flags.spec.ts`, `playwright/tests/moderation-history.spec.ts`                                                                                                                                                   |
| S9             | `apps/api/integration/moderation-history-gate.spec.ts`, `apps/api/integration/moderation-sla-operations.spec.ts`                                                                                                                                                                                                                                                                    |

The scenario-level map is the Traceability section above.
Every planned scenario outside the Differences table and the manual checks appears by name in a test that passed in the third run.

### Limits of these proofs

- The hosted Preview outcome is open, as `M-PREVIEW-VERIFY` says.
- `I-D-ATOMIC` and `I-R-DRIFT-LOG` add triggers or grants the Supabase image's `postgres` cannot, so the whole `apps/api` lane runs on plain Postgres, and the erasure, completion, route and sequential suites also run on the image.
- `AuditLog` and `CommunityCommentAudit` stay trigger-only by the frozen scope, and the Supabase application role can skip those triggers with `session_replication_role = replica` (TEA-24). The gate record states this.

---

## Mitigation Plans

- **R-001 Convention only (6).** Build D1 and D2. Verified by `D-IMM-*`, `D-EX-*`.
- **R-002 Owner blind under RLS (9).** Build TEA-01. Verified by `D-FN-RLS-VISIBLE`, and by S-6.
- **R-003 Guard a no-op in production (6).** Build TEA-02. Verified by `D-FN-NO-GUARD` at version 0, and by `D-FN-REPLACED-DEPENDENCY`.
- **R-004 DDL residual (6).** Accepted by ruling TEA-03 and stated. `D-RESIDUAL-SCHEMA-OWNER` keeps the statement true, and `V-FAULTS` proves the catalog shows the damage.
- **R-005 Identity left behind (6).** Build D3, D4, TEA-12, TEA-16. The catalog walk in `I-E-CANARY-SCAN` fails on a new table by default.
- **R-007 Repair loop (6).** Build TEA-06. Verified by `D-FN-IDEMPOTENT` and `I-C-REPAIR-SPAM`, and by S-10.
- **R-008 Deadline missed (6).** Build completion and overdue. Verified by `I-C-WINDOW`, `I-C-STORAGE-DOWN`, `P-ERASE-JOURNEY`.
- **R-009 Hosted role differs (6).** The Preview deployment runs the migration first. `M-PREVIEW-VERIFY` reads the attributes.
- **R-012 Export leak (6).** Strict schema, TEA-11. Verified on raw bytes by `A-X-CANARY`.
- **R-014 Unprovable export (6).** Audit in the transaction with the read. Verified by `A-X-AUDIT-ONE`, `A-X-AUDIT-FAIL`, `A-X-SNAPSHOT`.
- **R-015 Platform limit (6).** Build TEA-10. Verified by `A-X-BYTE-CAP`.
- **R-016 Vacuous proofs (6).** TEA-04, TEA-05, TEA-21. Verified by `V-CLEAN-SUPER`, `P-REFUSED-REAL`, and by S-24.
