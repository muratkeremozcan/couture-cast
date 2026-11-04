---
runScope: 'epic'
runKey: 'epic-6-story-6.10'
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
lastSaved: '2026-11-03'
---

# Test Design: Epic 6, Story CC-6.10 Moderator queue and case detail

**Date:** 2026-11-03
**Author:** Murat (TEA), non-interactive run, owner unavailable, decisions recorded in the spec
**Status:** Task 1 plan. No tests written. Reconciled to the spec and its Spec Change Log entries TEA-01 to TEA-18.

**Precedence:** the spec at `_bmad-output/implementation-artifacts/spec-6-10-moderator-queue-case-detail.md` wins wherever this document and the spec disagree.
The frozen block is untouched.
Where this plan found a frozen sentence that cannot hold, the finding sits in the Spec Change Log with a default ruling and a message to the builder and coordinator.

Inputs read in full:

- Spec (frozen block, Boundaries, I/O matrix, Code Map, Tasks, Acceptance, Design Notes, Verification).
- `epics.md` CC-6.10 acceptance criteria E1 to E3 and the CC-6.11 to CC-6.13 prerequisites.
- Prior example `cc69-native-platform-sharing-test-design.md` and the Test Design (TEA) section of spec 6.9.
- Code on `feat/cc-6-10-moderator-queue` at `b959e4c6`: `ModerationController` and module, `RequestAuthGuard`, `RolesGuard`, `AccessTokenIdentityService`, `community-cursor.ts`, `community.repository.ts` `recordReport`, `community-comments.repository.ts` `report`, `community-audit-snapshot.ts`, `community-moderation.processor.ts` `flagPost`, `community-moderation.actions.ts`, `community-storage.adapter.ts`, `FeatureFlagsService`, `flags.ts`, flag seed, `schema.prisma` models and the report migrations, RLS `community-posts.spec.ts` and `harness.ts`, `AuditLog` immutability migration, `web-session.ts`, `next.config.ts`, `auth-moderation-security.spec.ts`, `playwright/support/helpers/{accessibility,community-session}.ts`, pact interaction style, CI workflow names.

Workflow decisions taken without a halt:

- Mode: Create. Level: epic-level, scoped to one story. The completed progress frontmatter above replaces a checkpoint file.
- Level vocabulary: Unit, Integration (real Postgres, Nest app), DB (RLS against the policy matrix), Contract (Pact and OpenAPI), Component (Vitest and Testing Library), E2E (Playwright), Manual.
- `tea_use_playwright_utils` and `tea_use_pactjs_utils` are true and both packages are installed.
  Playwright specs use `apiRequest`, `recurse` and the merged fixtures.
  Pact interactions use `createProviderState`, `setJsonContent` and `buildVerifierOptions`.
  A deviation from either library carries a stated reason in the test.
- Nothing was executed. This is design only.

---

## Spec review: findings against the real code

Each finding says what the code shows, the disposition, and the test that guards it.
"Fixed" means the spec is edited now because the code settles the answer.
"Ruling" means a default decision is recorded in the Spec Change Log and the builder is told.

| ID     | Finding                                                                                                                                                                                                                                                                   | Disposition                                                                                                                                      | Guard                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| TEA-01 | `U-Q-RISK-PARITY` sits at Unit level in `packages/api-client`, which has no database. SQL and TypeScript parity needs the real query.                                                                                                                                     | Fixed. Test table splits into `U-Q-RISK-RULES` (pure) and `I-Q-RISK-PARITY` (DB).                                                                | I-Q-RISK-PARITY                         |
| TEA-02 | `ModerationEvent` is already in the denied-table enumeration (`community-posts.spec.ts:359`, `harness.ts:100`). The spec task "add if absent" is a no-op, and a hand list drifts when the repository gains a table.                                                       | Fixed. The repository exports `MODERATION_QUEUE_READ_TABLES`, the RLS spec iterates it, a unit test pins the SQL.                                | D-RLS-DENIED, U-Q-READSET               |
| TEA-03 | `CommunityCommentReport` has no `subject_alias` and no `details` column. D9 reads the subject from "the report row", which only post reports can supply.                                                                                                                  | Fixed. Comment subject alias comes from the live comment author's `CommunityAlias`, `erased` when the author is gone.                            | U-Q-SVC-IDENTITY, I-Q-DETAIL            |
| TEA-04 | `CommunityAlias` rows are created lazily and a read route must not write. A reporter with no alias row has no value under D9's `alias` or `erased`.                                                                                                                       | Fixed. Third reporter state `unknown`.                                                                                                           | U-Q-SVC-IDENTITY                        |
| TEA-05 | Comment report intake writes a first `CommunityCommentAudit` row `reported`. The spec excludes `reported` only for `ModerationEvent`.                                                                                                                                     | Fixed. Exclude `reported` in both sources.                                                                                                       | U-Q-SVC-PRIOR-ACTIONS                   |
| TEA-06 | D7 and the "Pagination under change" row promise a changed row is never repeated. A stateless keyset cannot promise that: a row whose tuple moves behind the cursor (risk drops after a release, a reporter erasure) shows on a later page.                               | Ruling. API guarantees unchanged rows appear exactly once. Web client dedupes by `caseId`. Confirmed by the coordinator 2026-11-03; D7 amended.  | I-Q-PAGING-UNDER-CHANGE, C-WEB-Q-DEDUPE |
| TEA-07 | The `sla` filter runs in SQL and the item state runs in TypeScript. Two clocks disagree at the boundary, so a row can show `at_risk` and be absent from `sla=at_risk`.                                                                                                    | Ruling. The service reads `serverNow` once and binds it as a SQL parameter. D6 stays satisfied.                                                  | U-Q-SVC-CLOCK, I-Q-FILTERS              |
| TEA-08 | Order is `risk_rank` DESC, `sla` ASC, `case_key` ASC. A row-value comparison `(a,b,c) > (x,y,z)` assumes one direction and silently skips or repeats rows.                                                                                                                | Ruling. Expand to an OR chain or negate the rank. The tie test covers every branch.                                                              | I-Q-KEYSET-TIES                         |
| TEA-09 | Author erasure nulls `post_id`. Case `post.<postId>` becomes one `orphan-post.<reportId>` case per report, so a three-report case splits into three and the old id returns 404. D1 calls ids stable.                                                                      | Ruling. Documented as the one re-key event. Console shows not-found with a link back. 6.11 treats it as stale. Confirmed 2026-11-03; D1 amended. | I-Q-ERASURE-REKEY                       |
| TEA-10 | D12 says a 503 renders the disabled state. The API has two 503 codes with different meaning: `moderation_console_disabled` and `audit_unavailable`.                                                                                                                       | Ruling. The console maps by `code`. Audit failure renders a retryable error.                                                                     | U-WEB-Q-CLIENT, C-WEB-Q-STATES          |
| TEA-11 | D10 fails closed on audit failure, but signing before the audit write mints a media URL for a read that returns nothing.                                                                                                                                                  | Ruling. Order is load, audit write, sign, respond.                                                                                               | U-Q-SVC-AUDIT-FAILCLOSED                |
| TEA-12 | `AuditLog.user_id` is a RESTRICT foreign key to `User`, and migration `20260420160000` makes rows immutable (UPDATE, DELETE and TRUNCATE raise). A moderator token whose id has no `User` row fails the audit insert. Tests cannot clean audit rows or delete test users. | Ruling. Tests use unique moderator users and never delete. A missing user row is the `audit_unavailable` case.                                   | I-Q-AUDIT                               |
| TEA-13 | D8 says "a closed reason" without listing it.                                                                                                                                                                                                                             | Fixed. `target_erased`, `anonymized`, `purged`, `no_image`, `signing_failed`. Comment cases use `no_image`.                                      | U-Q-SVC-MEDIA                           |
| TEA-14 | The signed URL lives 120 s. A moderator who keeps a case open sees a dead image, and re-reading the detail writes another audit row by design.                                                                                                                            | Ruling. Console shows an expired-media state at `expiresAt` (server offset) with a Reload control.                                               | C-WEB-Q-MEDIA                           |
| TEA-15 | Any automatic detail refetch (focus, visibility, online, interval, React strict-mode double effect) multiplies audit rows.                                                                                                                                                | Ruling. Detail loads once per navigation. Refresh is user-initiated. Stale state applies to the queue.                                           | C-WEB-Q-DETAIL-ONE-READ                 |
| TEA-16 | D9 renders reporter `details` as plain text. Snapshot caption, alt text, comment body, `operatorNote` and aliases are user-authored too.                                                                                                                                  | Ruling. The same inert rendering covers every user-authored string.                                                                              | C-WEB-Q-HOSTILE-TEXT                    |
| TEA-17 | `content_snapshot` is `Json`. A future writer can add keys, and a stored value can be malformed.                                                                                                                                                                          | Ruling. Allowlist projection. Unknown keys never leave the API. Malformed JSON renders as unavailable, never 500.                                | U-Q-SVC-SNAPSHOT                        |
| TEA-18 | The I/O row "Wrong role" says `Insufficient role` for guardian and teen. A teen without guardian consent gets `Guardian consent required before continuing` from `RequestAuthGuard`. Test-token bypass is also live when `VERCEL_ENV=preview`.                            | Ruling. Both 403 bodies are acceptable for a teen, identical across case ids. Production must reject bypass tokens.                              | U-Q-CTRL-ROLES, P-Q-ROLES               |

Informational, no spec change:

- `releaseFlaggedPost` keeps `moderation_reason`, so a released post still counts as a machine finding under D5 and the risk bump stays. Pinned as default RG3.
- `takeDownPublishedPost` writes free text into `moderation_reason`. A takedown reason that equals a known screening code parses as a finding. Residual RG4, 6.11 constrains reasons.
- Only `resolveReport` writes `resolved_at`, and only for post reports. Comment cases cannot reach `resolved` without direct seeding until 6.11.
- The resolved listing has no index support for the risk sort and grows without bound. `I-Q-PLAN-RESOLVED` records a budget. Residual RG5.
- `acceptedAt` on a case is the earliest accepted time among its open reports (post: `created_at`, comment: `accepted_at`). It lines up with the earliest due time that drives order.
- Pact determinism runs the consumer three times (`check-pact-determinism.sh`). `serverNow`, `expiresAt`, cursors and signed URLs need matchers.
- The shared axe helper defaults to WCAG 2.1 tags. The console specs pass `wcag22a` and `wcag22aa` explicitly.

---

## Executive Summary

**Scope:** two read-only moderator routes (`GET /api/v1/moderation/cases`, `GET /api/v1/moderation/cases/:caseId`) behind `moderation_console_enabled`, shared Zod contracts with pure `deriveCaseRisk` and `deriveSlaState`, and a Next.js console under `/moderation`.
The only write is one `AuditLog` row per detail read.

**Risk summary:**

- Total risks: 18
- High (score >= 6): 8
- Critical categories: SEC (authorization, reporter and media privacy, untrusted text), DATA (audit integrity, read-only guarantee), TECH (keyset correctness, SQL and TypeScript parity), BUS (intake visibility)

**Coverage summary:** 78 scenarios: P0 40, P1 31, P2 7. Totals by level are in the Test Catalog. 10 seeded-defect proofs (S-1 to S-10) sit outside the count.

**Effort:** roughly 70 to 120 hours (9 to 15 days) including the seed harness, the 5,000-row plan test and the Playwright theme and width matrix.

---

## Not in Scope

| Item                                                      | Reasoning                                  | Mitigation                                                           |
| --------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| Decision actions, sanctions, release, takedown            | CC-6.11                                    | C-WEB-Q-NO-ACTIONS asserts no action control renders                 |
| SLA timers, alerting, workers, dashboards                 | CC-6.12                                    | Only the shared `deriveSlaState` constants are tested                |
| Append-only history, evidence export, retention           | CC-6.13                                    | D10 audit row shape is pinned for ingestion                          |
| Mobile moderator surface                                  | Spec Never list                            | None                                                                 |
| `screening` queue source (flagged posts without a report) | D2                                         | I-Q-FILTERS pins that a flagged, unreported post is absent           |
| Real Supabase Auth OTP for a moderator                    | Needs a live auth project and mailbox      | Role comes from `app_metadata`; U-Q-CTRL-ROLES covers claim handling |
| Production flag values                                    | Spec Never list                            | U-Q-FLAG pins default false; seed-only true                          |
| Load beyond 5,000 open reports                            | The open set is bounded by the 24-hour SLA | I-Q-PLAN at 5,000, residual RG5 for the resolved listing             |

---

## Risk Assessment

Score = probability (1 to 3) x impact (1 to 3). Each description opens with the source words.

### High-Priority Risks (Score >= 6)

| Risk ID | Category | Description                                                                                                                                                                                                                                            | P   | I   | Score | Mitigation                                                                                                                            | Tests                                                                            |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| R-001   | SEC      | "Guardians and teens get 403" (D4). A missing `@Roles`, a role read from `user_metadata`, a bypass token accepted in production, or flag-before-role ordering lets a non-moderator read cases or learn the flag state.                                 | 2   | 3   | 6     | Same guard pair as `ModerationController`; role claim matrix; flag check after role check; byte-identical 403 bodies                  | U-Q-CTRL-ROLES, -FLAG-ORDER, -NO-ORACLE, I-Q-HTTP, P-Q-ROLES, S-1                |
| R-002   | SEC      | "No email, user id or HMAC token leaves the API" (D9). Strict schemas hold only for declared keys. A raw `reporter_id`, report id, object path, bucket, IP or unknown snapshot key leaks through a spread or a `Json` pass-through.                    | 2   | 3   | 6     | Strict response schemas; allowlist snapshot projection; maximal-fixture forbidden-key scan; log scan                                  | U-Q-CONTRACT-STRICT, U-Q-SVC-SNAPSHOT, -IDENTITY, -LOGGING, I-Q-DETAIL, S-2      |
| R-003   | DATA     | "Exactly one `moderation_case_viewed` audit row" and "fails closed" (D10). Fail-open on error, a second row from a refetch, a skipped row on the signed-URL path, or an FK failure for a moderator with no `User` row.                                 | 2   | 3   | 6     | Audit write before signing; user-initiated refresh only; unique test moderators                                                       | U-Q-SVC-AUDIT-FAILCLOSED, I-Q-AUDIT, C-WEB-Q-DETAIL-ONE-READ, P-Q-AUDIT-ONE, S-3 |
| R-004   | TECH     | "A row is never repeated and an unchanged row is never skipped" (D7). Mixed-direction row comparison, a ms-precision cursor tuple, collation drift between `ORDER BY` and the comparison, or the cursor binding too few filters.                       | 3   | 2   | 6     | OR-chain keyset; `COLLATE "C"` on `case_key`; tie fixture of 60 identical rank and due; filter-bound cursor                           | U-Q-CURSOR, I-Q-KEYSET-TIES, I-Q-PAGING-UNDER-CHANGE, S-4                        |
| R-005   | BUS      | "A report accepted at time T is visible before T + 5 minutes" (AC3). A cache, a filter on `routed_at`, a default that hides the case, or grouping that hides a new report on an old case defeats the one measurable promise of the story.              | 2   | 3   | 6     | No cache anywhere on the read path; primed-queue test; clock-advance test; `routed_at` edge row                                       | I-Q-INTAKE-5MIN, P-Q-INTAKE-E2E, S-5                                             |
| R-006   | SEC      | "Never interpreted as markdown or HTML" (D9). Stored XSS or UI spoofing through reporter details, caption, alt text, comment body, `operatorNote` or alias: markup, `javascript:` text, bidi override, zero-width characters, 500 unbroken characters. | 2   | 3   | 6     | Text-node rendering only; wrapping CSS; hostile corpus asserted in component and browser                                              | C-WEB-Q-HOSTILE-TEXT, P-Q-HOSTILE, S-6                                           |
| R-007   | TECH     | "SQL and TypeScript must agree" (D5) and "at most 6 hours" (D6). Drift or an off-by-one at the boundary buries the highest-risk work, which is the purpose of the queue.                                                                               | 2   | 3   | 6     | Golden table; 63 reason subsets x 2 x 2 through SQL and TypeScript; boundary table at 6 h, 6 h + 1 ms, 0, -1 ms                       | U-Q-RISK-RULES, U-Q-SLA-STATES, I-Q-RISK-PARITY, I-Q-ORDER, S-7                  |
| R-008   | SEC      | "Signed URLs never enter logs, audit rows, analytics or error bodies" (D8). A leak through Referer, an optimizer cache, browser history, an error body, or a dead URL that tempts a second signing path.                                               | 2   | 3   | 6     | `referrerPolicy="no-referrer"`, plain `<img>`, no URL in logs and audit, expiry state with Reload, no URL on the signing-failure path | U-Q-SVC-MEDIA, -LOGGING, C-WEB-Q-MEDIA, P-Q-MEDIA, S-8                           |

### Medium-Priority Risks (Score 3 to 4)

| Risk ID | Category | Description                                                                                                                                                             | P   | I   | Score | Mitigation                                                               | Tests                                                  |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ----- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| R-009   | TECH     | "A case is one reported target" (D1). Wrong grouping, an erased reporter dropped from the distinct count, a partly resolved case, or the re-key on erasure.             | 2   | 2   | 4     | Group, orphan, resolved and erasure fixtures                             | I-Q-GROUP, I-Q-ORPHAN, I-Q-RESOLVED, I-Q-ERASURE-REKEY |
| R-010   | PERF     | "The open set is read through the existing index" (D7). Plan flips to a sequential scan at the wrong size, or the resolved listing grows without bound.                 | 2   | 2   | 4     | Plan test with `ANALYZE`, index-usable proof, latency budget             | I-Q-PLAN, I-Q-PLAN-RESOLVED                            |
| R-011   | DATA     | "Read-only. No handler writes ..." (Boundaries). A lazy alias insert, a touched `updated_at`, or a resolved stamp slips in during the read.                             | 1   | 3   | 3     | Table checksum before and after every read type                          | I-Q-READONLY, U-Q-CTRL-READONLY                        |
| R-012   | TECH     | "Separate from `community_read_enabled`" (D4). Flag read failure fails open, registry order or seed drifts, PostHog outage returns the wrong value.                     | 2   | 2   | 4     | Fail-closed on flag error; registry and seed assertions                  | U-Q-FLAG, U-Q-CTRL-FLAG-ORDER                          |
| R-013   | A11Y     | "WCAG 2.2 AA, 44-pixel targets, one polite announcement per result change" (D12). Countdown floods assistive technology, focus order breaks, motion ignores preference. | 2   | 2   | 4     | Component assertions plus axe with 2.2 tags on all states                | C-WEB-Q-COUNTDOWN, C-WEB-Q-A11Y, P-Q-AXE, P-Q-KEYBOARD |
| R-014   | TECH     | "Controller, OpenAPI, generated SDK and web client derive from [the schemas]" (Boundaries). Generated drift, Pact non-determinism, unmatched error codes.               | 2   | 2   | 4     | Regeneration diff check; matchers for volatile fields                    | C-Q-OPENAPI, C-Q-PACT, U-Q-ENUM-COVERAGE               |
| R-015   | OPS      | "Fewer than 100 files ... every PR job stays under 20 minutes" (AC). The 5,000-row seed, the theme and width matrix, and ten locale files push size or time.            | 2   | 2   | 4     | Budgeted seed, one Playwright file, parallel lanes, locale split trigger | D-NO-MIGRATION, V-Q-BUDGET                             |
| R-016   | TECH     | Case ids contain dots (`post.<id>`). Dynamic route, URL encoding, reload and bookmark handling can fail, and a malformed id must stay a 404 with one body.              | 2   | 2   | 4     | Deep-link tests at API and browser                                       | U-Q-CASEID, P-Q-DEEPLINK, U-Q-CTRL-NO-ORACLE           |
| R-017   | DATA     | "Snapshot (what the reporter saw) plus current state" (Boundaries). Mislabeling snapshot and live, unavailable snapshot, anonymized or withdrawn target.                | 2   | 2   | 4     | Labeled blocks asserted for every target state                           | I-Q-DETAIL, U-Q-SVC-SNAPSHOT, C-WEB-Q-DETAIL           |

### Low-Priority Risks (Score 1 to 2)

| Risk ID | Category | Description                                                                                                 | P   | I   | Score | Mitigation                            | Tests                              |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------- | --- | --- | ----- | ------------------------------------- | ---------------------------------- |
| R-018   | BUS      | "All ten web locales, catalog parity" (Boundaries). Missing or English-only strings, raw enum values shown. | 2   | 1   | 2     | Parity spec with enum-derived key set | U-WEB-Q-LOCALES, U-Q-ENUM-COVERAGE |

### Risk Category Legend

SEC security and privacy. DATA integrity and audit. TECH correctness. BUS business promise. PERF query cost. A11Y accessibility. OPS delivery and CI.

---

## NFR Planning

| NFR           | Target                                                                                                             | Evidence                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Security      | Zero case data to non-moderators; zero forbidden keys in any body                                                  | U-Q-CTRL-\*, U-Q-CONTRACT-STRICT, P-Q-ROLES, P-Q-FORBIDDEN |
| Privacy       | No signed URL, content, details or id in logs or audit rows                                                        | U-Q-SVC-LOGGING, I-Q-AUDIT                                 |
| Performance   | Queue page at 5,000 open reports uses the `(resolved_at, sla_due_at)` index and answers within the I-Q-PLAN budget | I-Q-PLAN                                                   |
| Freshness     | Accepted report visible on the next queue read, under 300 s                                                        | I-Q-INTAKE-5MIN, P-Q-INTAKE-E2E                            |
| Accessibility | axe 2.2 AA clean on every state, light and dark, 375 and 1280                                                      | P-Q-AXE                                                    |
| Localization  | Ten catalogs, enum-derived key parity                                                                              | U-WEB-Q-LOCALES                                            |
| CI time       | Each PR job under 20 minutes; Playwright console file under 6 minutes                                              | Lane budgets below                                         |

---

## Entry Criteria

- The contract file `moderation-queue.ts` exists with schemas, so tests are written against it and watched fail.
- The seed helper `seedModerationQueue` exists (see Test data), with unique ids per run.
- A local Supabase with the `community-images` bucket is reachable for the media E2E, or the fake storage adapter is selected explicitly.
- No peer is mid-commit. Tests run with `npm exec -- vitest run` and `npm exec -- tsc --noEmit -p`, never `npm run`, while other peers are active.

## Exit Criteria

- Every P0 and P1 test passes. P2 failures are triaged in the PR.
- Every seeded-defect proof S-1 to S-10 went red in a throwaway worktree and is recorded with its commit in `_bmad-output/test-artifacts/story-6-10/`.
- Verification commands in the spec pass; `git diff --name-only main... | wc -l` is below 100.
- No flake in three consecutive CI runs of the new specs.
- Screenshots for the Manual checks exist under `_bmad-output/test-artifacts/story-6-10/`.

---

## Test Catalog

Columns: **AC** maps to the epics criteria E1 (contracts), E2 (console), E3 (authorization, no direct database, five-minute intake) and the spec bullets S1 to S8 (S1 queue, S2 authorization and no oracle, S3 detail, S4 intake, S5 no direct database, S6 audit, S7 console states and accessibility, S8 PR budget).
**Red** is `R` for red-first (written before the implementation and watched fail for the right reason), `G` for a green guard (passes before the build and protects against regression), `M` for manual.

### Contract package units (`packages/api-client/testing/moderation-queue-contract.spec.ts`)

| ID                  | Level | Pri | AC     | Red | Scenario                                                                                                                                                                                                |
| ------------------- | ----- | --- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-Q-RISK-RULES      | Unit  | P0  | E1, S1 | R   | Golden table: 6 reasons x finding x 3 or more reporters (24 cells), mixed-reason sets use the strongest, cap at `high`, threshold exactly 2 vs 3, the spec's golden example                             |
| U-Q-SLA-STATES      | Unit  | P0  | E1, S3 | R   | `breached` at `now >= due`, `at_risk` at remaining 6 h inclusive and 6 h + 1 ms `on_track`, `resolved` overrides, earliest open due wins, skewed client clock changes nothing                           |
| U-Q-CONTRACT-STRICT | Unit  | P0  | E3, S5 | R   | Strict schemas reject extra keys; a maximal fixture is scanned for `userId`, `email`, `reporterId`, raw `reportId`, `objectPath`, `bucket`, `ip`, `token`, `hmac`; media and reporter unions are closed |
| U-Q-FILTER-SCHEMA   | Unit  | P1  | E1, S1 | R   | One value per filter; repeated key, empty string, wrong case, `risk=critical`; `limit` 1, 25, 50 accepted, 0, -1, 51, 25.5, `1e1`, `abc` rejected; `status` defaults `open`                             |
| U-Q-CASEID          | Unit  | P1  | E1, S1 | R   | Four id forms parse; malformed, empty, 10,000 characters, encoded slash and Unicode fail through one path                                                                                               |
| U-Q-ENUM-COVERAGE   | Unit  | P1  | E2, S7 | R   | Exported enum arrays (source, risk, status, SLA state, report reason, finding category, action kind, actor kind, media reason) equal the OpenAPI enums                                                  |

### API units (`apps/api/src/modules/moderation/*.spec.ts`)

| ID                       | Level | Pri | AC     | Red | Scenario                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ----- | --- | ------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-Q-CURSOR               | Unit  | P0  | E1, S1 | R   | Tampered payload and signature, wrong version, a cursor minted under each of the five filters replayed under another value, 10 KB cursor, extra segments, non-base64, payload holds only version, tuple and filters, missing secret never yields an unsigned cursor, a changed `limit` is accepted (RG1) |
| U-Q-SVC-FINDINGS         | Unit  | P0  | E2, S3 | R   | Known codes map to categories with `engineVersion`; `flagged_by_screening` maps to `incomplete`; free text, mixed known and unknown, null and empty become `operatorNote` with no bump; comment `held_for_review` and `blocked` are findings                                                             |
| U-Q-SVC-MEDIA            | Unit  | P0  | E2, S3 | R   | Sign called with exactly 120; `expiresAt` equals `serverNow` + 120 s; anonymized, purged, no path, orphan, comment and signing error each give the pinned closed reason; no path or bucket in output; no URL in the thrown or logged error                                                               |
| U-Q-SVC-IDENTITY         | Unit  | P0  | E2, S3 | R   | Reporter `alias`, `erased` (null id), `unknown` (no alias row); post subject from the report row; comment subject from the live author alias or `erased`; no user id anywhere; `details` passes through unchanged and capped at 500                                                                      |
| U-Q-SVC-AUDIT-FAILCLOSED | Unit  | P0  | E3, S6 | R   | Insert error (any, including FK) gives 503 `audit_unavailable`, no case data, `signReadUrl` never called; success writes exactly one row with `event_data` keys `caseId`, `source`, `role` only; 404, 403, flag-off and 400 write none                                                                   |
| U-Q-SVC-CLOCK            | Unit  | P0  | E1, S1 | R   | One clock read per request: `serverNow`, SLA states, `expiresAt` and the SQL parameter share a value; the queue filter and the item state agree at the 6 h boundary                                                                                                                                      |
| U-Q-SVC-SNAPSHOT         | Unit  | P0  | E2, S3 | R   | Allowlist projection drops unknown keys; `{unavailable:true}`, `null`, an array, a string and missing fields render as unavailable fields; never throws                                                                                                                                                  |
| U-Q-SVC-LOGGING          | Unit  | P0  | E3, S5 | R   | Captured log output for queue, detail, denial and error paths holds no signed URL, caption, details, body, alias, email or raw object path; queue line carries moderator ref, filter names, count                                                                                                        |
| U-Q-SVC-PRIOR-ACTIONS    | Unit  | P1  | E2, S3 | R   | `reported` rows excluded from `ModerationEvent` and comment audit; `actorKind` for `flagged_by_id`, `reviewed_by_id`, neither; unknown or null `action` maps to `other`; `reason` passes through as capped plain text; no operator id returned                                                           |
| U-Q-SVC-CONFLICT         | Unit  | P1  | E3, S3 | R   | `viewerConflict` true for author or reporter (moderator and admin), false for orphans and strangers; only a boolean leaves the API                                                                                                                                                                       |
| U-Q-CTRL-ROLES           | Unit  | P0  | E3, S2 | R   | Guardian, teen, consent-suspended teen, anonymous, malformed bearer, unknown role string, `user_metadata.role=moderator`; moderator and admin pass; with `TEST_ENV` unset and `VERCEL_ENV=production` every bypass token gives 401                                                                       |
| U-Q-CTRL-FLAG-ORDER      | Unit  | P0  | E3, S2 | R   | Guardian with flag off gets 403 (never 503); moderator with flag off gets 503 `moderation_console_disabled`; a thrown flag read gives 503 disabled; flag is read after the role check                                                                                                                    |
| U-Q-CTRL-HEADERS         | Unit  | P0  | E3, S2 | R   | `Cache-Control: private, no-store` on 200, 400, 401, 403, 404 and 503 for both routes                                                                                                                                                                                                                    |
| U-Q-CTRL-NO-ORACLE       | Unit  | P0  | E3, S2 | R   | 403 body byte-identical for real, unknown and malformed case ids and across the queue route; 404 body identical for malformed and unknown ids                                                                                                                                                            |
| U-Q-CTRL-VALIDATION      | Unit  | P1  | E1, S1 | R   | 400 `invalid_filter` and `invalid_cursor` carry closed codes and no echo of the input                                                                                                                                                                                                                    |
| U-Q-CTRL-READONLY        | Unit  | P1  | E3, S5 | R   | POST, PUT, PATCH and DELETE on `/cases` and `/cases/:id` return 404; `POST /actions` behavior and contract unchanged (G)                                                                                                                                                                                 |
| U-Q-READSET              | Unit  | P1  | E3, S5 | R   | Table names extracted from every raw SQL string in the repository are a subset of `MODERATION_QUEUE_READ_TABLES`                                                                                                                                                                                         |
| U-Q-FLAG                 | Unit  | P1  | E3, S2 | R   | `moderation_console_enabled` in registry order, default false, seed true; fallback cache returns false when PostHog fails (`flags.spec.ts`, `feature-flags.service.spec.ts`)                                                                                                                             |
| U-Q-MODULE-WIRING        | Unit  | P1  | S2     | R   | `ModerationModule` compiles with `CommunityModule` and `FeatureFlagsModule` imported and resolves the storage adapter                                                                                                                                                                                    |

### Integration (`apps/api/integration/moderation-queue*.integration.spec.ts`, real Postgres)

| ID                      | Level       | Pri | AC     | Red | Scenario                                                                                                                                                                                                                                                    |
| ----------------------- | ----------- | --- | ------ | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-Q-ORDER               | Integration | P0  | E1, S1 | R   | Mixed matrix returns risk DESC, earliest open due ASC, case key ASC; a flagged post with no report and a `held_for_review` comment with no report are absent (D2)                                                                                           |
| I-Q-GROUP               | Integration | P0  | E1, S1 | R   | Three reporters, three reasons on one post: one case, `reportCount` 3, three reasons, strongest-reason risk plus the reporter bump; a second report on an old post raises `reportCount` of the existing case                                                |
| I-Q-ORPHAN              | Integration | P0  | E1, S3 | R   | Post and comment orphans are separate cases with snapshot text and media `target_erased`; erased reporter gives `erased` and is excluded from the distinct count; never 500                                                                                 |
| I-Q-FILTERS             | Integration | P0  | E1, S1 | R   | Each filter alone and `source=comment&locale=es-419&risk=high&sla=at_risk`; locale falls back snapshot, live row, null (filter value `unknown`); a stored locale outside the ten reads null; `status` default `open`; boundary row agrees with `sla`        |
| I-Q-KEYSET-TIES         | Integration | P0  | E1, S1 | R   | 60 cases with identical rank and due: walk with `limit` 1, 25 and 50, no duplicate, no skip; each OR-chain branch hit; mixed `post.`, `comment.`, `orphan-post.`, `orphan-comment.` keys order the same in `ORDER BY` and the cursor                        |
| I-Q-PAGING-UNDER-CHANGE | Integration | P0  | E1, S1 | R   | Between pages: a case resolves (absent from the open set), a case gains a reporter and rises, a case loses a finding and drops. Unchanged cases appear exactly once. The dropped case appears at most once more (RG2)                                       |
| I-Q-INTAKE-5MIN         | Integration | P0  | E3, S4 | R   | Prime the queue first. File a post report and a comment report through the real report routes. Next queue read shows both. `now - acceptedAt` under 300 s. Advance the clock to T + 299 s with no cache. Row with `routed_at` = accepted + 5 min is visible |
| I-Q-RISK-PARITY         | Integration | P0  | E1, S1 | R   | All 63 non-empty reason subsets x finding x reporters >= 3 seeded as real rows. SQL `risk_rank` mapped to the enum equals `deriveCaseRisk` for every case                                                                                                   |
| I-Q-READONLY            | Integration | P0  | E3, S5 | R   | Checksum of every community, moderation and user table before and after queue, post detail, comment detail and orphan detail reads: unchanged except exactly one new `AuditLog` row per detail read; no alias insert                                        |
| I-Q-DETAIL              | Integration | P0  | E2, S3 | R   | Post with finding and released event; operator takedown reason as `operatorNote`; withdrawn target; comment with live parent context; `{unavailable:true}` snapshot; snapshot and live blocks labeled; prior actions complete and ordered                   |
| I-Q-AUDIT               | Integration | P0  | E3, S6 | R   | Real `AuditLog` row shape (`event_type`, moderator `user_id`, `event_data`); two reads give two rows; moderator with no `User` row gives 503 `audit_unavailable` and no data; no row on 403, 404, 503 flag                                                  |
| I-Q-HTTP                | Integration | P0  | E3, S2 | R   | Nest app with the real guards, both routes: 401, 403, 400, 404, 503 bodies and headers; real `FeatureFlagsService` with a repository value                                                                                                                  |
| I-Q-RESOLVED            | Integration | P1  | E1, S1 | R   | Real `resolveReport` on 2 of 3 reports keeps the case `open`; on 3 of 3 gives `resolved`, SLA `resolved`, hidden by default, visible with `status=resolved`                                                                                                 |
| I-Q-ERASURE-REKEY       | Integration | P1  | E1, S3 | R   | Author erasure turns `post.<id>` into one orphan case per report; the old id returns 404 `case_not_found`; a cursor minted before erasure still decodes and the walk completes                                                                              |
| I-Q-SQL-SAFETY          | Integration | P1  | E3, S2 | R   | Quotes, `;`, `%`, null bytes and 5,000-character strings in filters, cursor and case id return 400 or 404, never 500, and drop no table                                                                                                                     |
| I-Q-PLAN                | Integration | P1  | E1, S1 | R   | 5,000 open reports after `ANALYZE`: with `enable_seqscan=off` the plan uses `(resolved_at, sla_due_at)` on both tables; default-planner run stays under the latency budget; rows removed by filter near zero                                                |
| I-Q-PLAN-RESOLVED       | Integration | P2  | E1, S1 | R   | 5,000 resolved cases with `status=resolved`: latency budget recorded, no timeout (RG5)                                                                                                                                                                      |
| I-Q-CONCURRENCY         | Integration | P2  | E3, S6 | R   | Report intake running while 20 parallel detail reads and 20 queue reads: no error, no lock wait on intake, exactly 20 audit rows                                                                                                                            |

### Database (`packages/db/test/rls/`)

| ID             | Level | Pri | AC     | Red | Scenario                                                                                                                                                                                                                             |
| -------------- | ----- | --- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-RLS-DENIED   | DB    | P0  | E3, S5 | G   | `anon` and `authenticated` get `42501` on SELECT, INSERT, UPDATE for every table in `MODERATION_QUEUE_READ_TABLES` (report tables, `ModerationEvent`, `CommunityAlias`, `LookbookPost`, `CommunityComment`, `CommunityCommentAudit`) |
| D-RLS-AUDIT    | DB    | P1  | E3, S6 | G   | `authenticated` cannot INSERT a forged `moderation_case_viewed` row; sees only own rows; UPDATE, DELETE and TRUNCATE raise                                                                                                           |
| D-NO-MIGRATION | DB    | P2  | S8     | G   | `git diff --name-only main... -- packages/db/prisma/migrations` is empty (script check in Verification)                                                                                                                              |

### Contract (`pact/http/`, OpenAPI)

| ID          | Level    | Pri | AC     | Red | Scenario                                                                                                                                                                                                                      |
| ----------- | -------- | --- | ------ | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-Q-PACT    | Contract | P1  | E1, E3 | R   | Queue 200 (items, empty), detail 200 (media available, media unavailable), 403, 404, 503 disabled; `createProviderState` per state; matchers on `serverNow`, `expiresAt`, cursor and signed URL; three-run determinism passes |
| C-Q-OPENAPI | Contract | P1  | E1     | R   | `generate:http-openapi` and `generate:api-client` leave no diff; optic lint passes; both paths list 200, 400, 401, 403, 404, 503                                                                                              |

### Web units and components (`apps/web`)

| ID                        | Level     | Pri | AC     | Red | Scenario                                                                                                                                                                                     |
| ------------------------- | --------- | --- | ------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-WEB-Q-CLIENT            | Unit      | P1  | E2, S7 | R   | Server-offset math with client skew of +/- 10 minutes; 401, 403, 404, 400, 503 by `code` (`moderation_console_disabled` vs `audit_unavailable`) map to closed states; cursor passed verbatim |
| U-WEB-Q-LOCALES           | Unit      | P1  | E2, S7 | R   | Ten catalogs hold the same `moderation.*` keys; enum-derived key set from the contract; no English-only value among the non-English catalogs                                                 |
| U-WEB-Q-NO-DIRECT         | Unit      | P1  | E3, S5 | R   | Static scan: `/moderation` sources import no Supabase table client, Prisma, server action or storage client                                                                                  |
| C-WEB-Q-QUEUE             | Component | P0  | E2, S7 | R   | Order, risk and SLA labels from catalogs, filter bar, load-more appends keyset pages, result count announced once per change                                                                 |
| C-WEB-Q-DETAIL            | Component | P0  | E2, S3 | R   | Snapshot and live blocks labeled, findings with category and engine version, reporters with aliases and details, prior actions, countdown, `viewerConflict` notice                           |
| C-WEB-Q-STATES            | Component | P0  | E2, S7 | R   | Loading, empty, filtered-empty, error, forbidden, disabled, stale for queue and detail; audit failure renders a retryable error, never the disabled state                                    |
| C-WEB-Q-HOSTILE-TEXT      | Component | P0  | E2, S7 | R   | Markup, `javascript:` text, markdown, bidi override, zero-width, newlines and 500 unbroken characters in details, caption, alt text, body, `operatorNote`, alias render inert and wrapped    |
| C-WEB-Q-FORBIDDEN-NO-DATA | Component | P0  | E3, S2 | R   | 403 renders the neutral state; the DOM holds no case string; no second request fires                                                                                                         |
| C-WEB-Q-NO-ACTIONS        | Component | P0  | E2, S3 | R   | Detail exposes only navigation and Reload; no resolve, release, takedown, escalate or ban control and no disabled placeholder                                                                |
| C-WEB-Q-DETAIL-ONE-READ   | Component | P0  | E3, S6 | R   | Mount issues one GET under strict mode; focus, visibility, online and timer events issue none                                                                                                |
| C-WEB-Q-MEDIA             | Component | P0  | E2, S3 | R   | `<img>` with `referrerPolicy="no-referrer"`, no optimizer, no `srcset`; expired state at `expiresAt` by server offset with Reload; unavailable reasons localized; URL absent from `href`     |
| C-WEB-Q-DEDUPE            | Component | P1  | E1, S1 | R   | A case returned on two pages renders once                                                                                                                                                    |
| C-WEB-Q-COUNTDOWN         | Component | P1  | E2, S7 | R   | DOM text changes once per minute; announcement only on SLA state change; reduced motion honored; skew handled; overdue shown after breach                                                    |
| C-WEB-Q-A11Y              | Component | P1  | E2, S7 | R   | Logical focus order, visible focus, 44-pixel targets, one polite live region, headings and landmarks                                                                                         |
| C-WEB-Q-FILTERS           | Component | P1  | E2, S7 | R   | A filter change resets the cursor and the list, one value per filter, state survives a detail round trip                                                                                     |
| C-WEB-Q-CONFLICT-NOTICE   | Component | P2  | E2, S3 | R   | Notice text and placement when `viewerConflict` is true; absent otherwise                                                                                                                    |

### End to end (`playwright/tests/moderation-console.spec.ts`, `playwright/tests/api/auth-moderation-security.spec.ts`)

| ID                | Level | Pri | AC     | Red | Scenario                                                                                                                                                                                 |
| ----------------- | ----- | --- | ------ | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-Q-ROLES         | E2E   | P0  | E3, S2 | R   | API role matrix on both new routes through `apiRequest`: no token 401; guardian and teen 403 with the same body for real and unknown ids; moderator and admin 200; unknown id 404        |
| P-Q-CONSOLE       | E2E   | P0  | E2, S3 | R   | Moderator with no `UserProfile` row signs in, sees the ordered queue, filters, loads more, opens a case, sees the image load (`naturalWidth` > 0), the countdown and every labeled block |
| P-Q-FORBIDDEN     | E2E   | P0  | E3, S2 | R   | Guardian opens `/moderation`: neutral state, the network log shows 403 and no case JSON                                                                                                  |
| P-Q-AXE           | E2E   | P0  | E2, S7 | R   | axe with `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa` on queue, detail, empty, forbidden, disabled, light and dark, 375 and 1280                                    |
| P-Q-INTAKE-E2E    | E2E   | P1  | E3, S4 | R   | A member files a report through the web app; the moderator reloads `/moderation` and finds the case. This is the path a real moderator walks                                             |
| P-Q-AUDIT-ONE     | E2E   | P1  | E3, S6 | R   | Opening a case in the UI writes one audit row; a reload writes a second (database read)                                                                                                  |
| P-Q-KEYBOARD      | E2E   | P1  | E2, S7 | R   | Queue to detail and back with keyboard only; focus lands on the heading after navigation and on the list after Back                                                                      |
| P-Q-THEMES-WIDTHS | E2E   | P1  | E2, S7 | R   | Queue and detail at 375 and 1280, light and dark: no horizontal overflow, targets 44 px, contrast via axe; screenshots saved under `story-6-10/`                                         |
| P-Q-HOSTILE       | E2E   | P1  | E2, S7 | R   | Hostile reporter text in a real browser: no dialog, no injected node, no overflow at 375                                                                                                 |
| P-Q-MEDIA         | E2E   | P1  | E2, S3 | R   | The image request carries no `Referer`; the signed URL appears in no page link and no stored session data; detail response is `no-store`                                                 |
| P-Q-DEEPLINK      | E2E   | P1  | E2, S3 | R   | Reload and bookmark of `/moderation/cases/post.<id>` and `orphan-post.<id>` render; a malformed id renders the not-found state                                                           |
| P-Q-DISABLED      | E2E   | P2  | E2, S7 | R   | A routed 503 `moderation_console_disabled` renders the disabled state (flag toggling in a shared database is avoided, RG6)                                                               |

### Manual and process

| ID         | Level  | Pri | AC     | Red | Scenario                                                                                                                                                                                        |
| ---------- | ------ | --- | ------ | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X-Q-PIXEL  | Manual | P2  | E2, S7 | M   | The Verification manual check: seeded post, comment, orphan, flagged post, three-reporter post at 1280 and 375, light and dark; pixel review of spacing, truncation, focus ring, icon alignment |
| V-Q-BUDGET | Manual | P2  | S8     | M   | File count below 100 and every PR job below 20 minutes, recorded in the PR description                                                                                                          |

### Generated totals

<!-- TOTALS-START -->

| Level       | P0  | P1  | P2  | Total |
| ----------- | --- | --- | --- | ----- |
| Unit        | 15  | 13  | 0   | 28    |
| Integration | 12  | 4   | 2   | 18    |
| DB          | 1   | 1   | 1   | 3     |
| Contract    | 0   | 2   | 0   | 2     |
| Component   | 8   | 4   | 1   | 13    |
| E2E         | 4   | 7   | 1   | 12    |
| Manual      | 0   | 0   | 2   | 2     |
| **Total**   | 40  | 31  | 7   | 78    |

<!-- TOTALS-END -->

---

## Test Coverage Plan (risk-linked)

### P0 (Critical)

Run on every PR. Pass rate 100 percent.
These cover R-001 to R-008 and the three epics criteria.

- Authorization: U-Q-CTRL-ROLES, -FLAG-ORDER, -HEADERS, -NO-ORACLE, I-Q-HTTP, P-Q-ROLES, P-Q-FORBIDDEN, C-WEB-Q-FORBIDDEN-NO-DATA, D-RLS-DENIED.
- Privacy: U-Q-CONTRACT-STRICT, U-Q-SVC-SNAPSHOT, -IDENTITY, -MEDIA, -LOGGING, I-Q-DETAIL, C-WEB-Q-HOSTILE-TEXT, C-WEB-Q-MEDIA.
- Audit and read-only: U-Q-SVC-AUDIT-FAILCLOSED, I-Q-AUDIT, I-Q-READONLY, C-WEB-Q-DETAIL-ONE-READ.
- Ordering and correctness: U-Q-RISK-RULES, U-Q-SLA-STATES, U-Q-CURSOR, U-Q-SVC-CLOCK, I-Q-ORDER, I-Q-GROUP, I-Q-ORPHAN, I-Q-FILTERS, I-Q-KEYSET-TIES, I-Q-PAGING-UNDER-CHANGE, I-Q-RISK-PARITY.
- Intake: I-Q-INTAKE-5MIN.
- Console: C-WEB-Q-QUEUE, -DETAIL, -STATES, -NO-ACTIONS, P-Q-CONSOLE, P-Q-AXE.

### P1 (High)

Run on every PR. Pass rate at least 95 percent, failures triaged before merge.
Validation filters, plan test, pact, OpenAPI, locales, deep links, theme and width matrix, keyboard path, audit through the UI, intake through the UI.

### P2 (Medium)

Run on the PR when cheap, otherwise nightly.
Resolved listing budget, concurrency, conflict notice, disabled state in the browser, manual pixel review, budget record.

---

## Explicit negative tests

| Negative                                                                | Test                                  |
| ----------------------------------------------------------------------- | ------------------------------------- |
| Guardian or teen reads a case or the queue                              | U-Q-CTRL-ROLES, P-Q-ROLES             |
| `user_metadata.role=moderator` grants access                            | U-Q-CTRL-ROLES                        |
| Bypass token accepted with `TEST_ENV` unset and production `VERCEL_ENV` | U-Q-CTRL-ROLES                        |
| 403 body differs for real, unknown and malformed ids                    | U-Q-CTRL-NO-ORACLE                    |
| Flag state visible to a non-moderator                                   | U-Q-CTRL-FLAG-ORDER                   |
| Any write other than one audit row                                      | I-Q-READONLY, U-Q-CTRL-READONLY       |
| Alias created by a read                                                 | I-Q-READONLY                          |
| Audit failure still returns data or mints a URL                         | U-Q-SVC-AUDIT-FAILCLOSED              |
| Audit row on denied, missing, disabled or invalid reads                 | U-Q-SVC-AUDIT-FAILCLOSED, I-Q-AUDIT   |
| User id, email, report id, object path, bucket, IP or HMAC in any body  | U-Q-CONTRACT-STRICT, I-Q-DETAIL       |
| Unknown snapshot key returned                                           | U-Q-SVC-SNAPSHOT                      |
| Signed URL in logs, audit rows, errors or session storage               | U-Q-SVC-LOGGING, I-Q-AUDIT, P-Q-MEDIA |
| `Referer` sent with the image request                                   | P-Q-MEDIA                             |
| Reporter text executed or interpreted as markup                         | C-WEB-Q-HOSTILE-TEXT, P-Q-HOSTILE     |
| An action control in the detail view                                    | C-WEB-Q-NO-ACTIONS                    |
| Direct database or storage client in the console                        | U-WEB-Q-NO-DIRECT                     |
| Cached queue hides a fresh report                                       | I-Q-INTAKE-5MIN                       |
| Flagged post with no report appears in the queue                        | I-Q-ORDER                             |
| Duplicate or skipped case across pages with equal tuples                | I-Q-KEYSET-TIES                       |
| Cursor replayed under another filter                                    | U-Q-CURSOR                            |
| Detail refetch on focus, visibility, online or timer                    | C-WEB-Q-DETAIL-ONE-READ               |
| Audit failure rendered as the disabled state                            | C-WEB-Q-STATES                        |
| New migration, table, column or enum                                    | D-NO-MIGRATION                        |

---

## Test data and harness

- **Seed helper** `seedModerationQueue(prisma, { runId })` in `apps/api/integration/helpers/` builds the scenario set through `@couture/testing` factories (`createCommunityPostReport`, the comment report builders) and the real report routes where intake is under test.
  The same function seeds the Playwright database and the Manual check. One source, three consumers.
- **Unique ids per run.** `AuditLog` is immutable and its `user_id` is a RESTRICT foreign key, so moderators and their audit rows stay. Every moderator, reporter and post id includes the run id. Cleanup deletes reports, posts and comments in dependency order and leaves users and audit rows.
- **Clock.** Integration uses `pinClock` from `community-comments-context.ts`. The service takes an injectable clock so U-Q-SVC-CLOCK counts reads without patching globals.
- **Storage.** Unit and integration tests inject a fake `SupabaseCommunityStorageAdapter` with `signReadUrl` that records calls and can throw. The adapter has no client under test-only secrets, so the real one always fails with `signing_failed`. The media E2E uploads a fixture from `apps/api/test/fixtures/community-moderation/v1` to the local `community-images` bucket through the existing `community-session.ts` helper.
- **Identity.** Integration HTTP tests stub `AccessTokenIdentityService` as the reaction HTTP tests do. Playwright uses `authHeaders` and `localE2EAccessToken` with role `moderator`, with a `User` row present and no `UserProfile` row.
- **Pact.** Provider state handlers call the same seed helper with fixed ids. Volatile fields use matchers.
- **Database isolation.** Playwright runs only with an isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true`. The flag stays at the seeded value in shared databases (RG6).

---

## Execution Strategy

| Lane               | Content                                                                     | Budget                                                                                                              |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pr-checks`        | api-client, API and web units, components, API integration, locales, RLS    | Under 12 minutes added: seed once per file, I-Q-PLAN builds 5,000 rows with one `INSERT ... SELECT generate_series` |
| `contract-testing` | C-Q-PACT with determinism, C-Q-OPENAPI                                      | Under 4 minutes added                                                                                               |
| `pr-pw-e2e-local`  | P-Q-\* in one file, chromium, 375 and 1280 as two projects reusing the seed | Under 6 minutes added                                                                                               |
| Local              | S-1 to S-10 seeded-defect proofs, X-Q-PIXEL                                 | Before PR review                                                                                                    |

Commands follow the spec Verification list. During multi-peer work: `npm exec -- vitest run` and `npm exec -- tsc --noEmit -p`, announced before any `npm run`.

---

## Red-first plan and seeded-defect proofs

**Order of work for the builder.**

1. Contract schemas and pure derivations, then U-Q-RISK-RULES, U-Q-SLA-STATES, U-Q-CONTRACT-STRICT, U-Q-CURSOR red.
2. Seed helper, then I-Q-ORDER, -GROUP, -ORPHAN, -FILTERS, -KEYSET-TIES, -INTAKE-5MIN, -READONLY, -AUDIT, -HTTP red against missing routes (404 is the right failure).
3. Controller and service tests red, then implementation until green.
4. Component tests red against the contract fixtures, then the console.
5. Pact and Playwright last, red because the route and page do not exist.

`G` rows (D-RLS-DENIED, D-RLS-AUDIT, D-NO-MIGRATION) start green and stay green.

**Seeded-defect proofs.**
Each proof breaks the finished implementation in a throwaway `git worktree` (node_modules symlinked), confirms the named test goes red for the stated reason, and records the commit and output in `_bmad-output/test-artifacts/story-6-10/seeded-defects.md`.
No stash, checkout of paths or reset in the shared checkout.

| ID   | Defect injected                                            | Must go red                           |
| ---- | ---------------------------------------------------------- | ------------------------------------- |
| S-1  | Remove `RolesGuard` from the detail route                  | U-Q-CTRL-ROLES, P-Q-ROLES             |
| S-2  | Spread the raw snapshot or add `reporter_id` to the detail | U-Q-SVC-SNAPSHOT, U-Q-CONTRACT-STRICT |
| S-3  | Swallow the audit insert error                             | U-Q-SVC-AUDIT-FAILCLOSED, I-Q-AUDIT   |
| S-4  | Replace the OR-chain keyset with a row-value comparison    | I-Q-KEYSET-TIES                       |
| S-5  | Cache the queue for 60 s                                   | I-Q-INTAKE-5MIN                       |
| S-6  | Render `details` with `dangerouslySetInnerHTML`            | C-WEB-Q-HOSTILE-TEXT, P-Q-HOSTILE     |
| S-7  | Change the SQL reporter threshold from 3 to 4              | I-Q-RISK-PARITY                       |
| S-8  | Add `referrerPolicy` default (remove `no-referrer`)        | C-WEB-Q-MEDIA, P-Q-MEDIA              |
| S-9  | Read the flag before the role check                        | U-Q-CTRL-FLAG-ORDER                   |
| S-10 | Add `useEffect` focus refetch to the detail                | C-WEB-Q-DETAIL-ONE-READ               |

### Seeded-defect results

Run in a throwaway `git worktree` at commit `41d0d995` with `node_modules` symlinked, then removed.
Every defect turned the named tests red, and the worktree was clean after each revert.

| ID   | Defect injected                                   | Red tests (failed count)                                                              |
| ---- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| S-1  | `RolesGuard` removed from the controller          | U-Q-CTRL-ROLES guard order (1), I-Q-HTTP 403 body, flag oracle, denied-read audit (4) |
| S-2  | `reporterId` added to each reporter               | U-Q-SVC (24), I-Q-DETAIL and I-Q-ORPHAN through the strict response schema (12)       |
| S-3  | Audit insert error swallowed                      | U-Q-SVC-AUDIT-FAILCLOSED (1), I-Q-AUDIT fail closed (1)                               |
| S-4  | Row-value keyset instead of the OR chain          | I-Q-KEYSET-TIES mid-tie crossing, paging under change (2)                             |
| S-5  | Responses marked `public, max-age=60`             | I-Q-HEADERS on 401, 403, 404/400 and 503 for both routes (2)                          |
| S-6  | `details` rendered with `dangerouslySetInnerHTML` | C-WEB-Q-HOSTILE-TEXT and C-WEB-Q-DETAIL (16)                                          |
| S-7  | Reporter bump threshold 3 to 4                    | U-Q-RISK-RULES oracle, golden examples (5), I-Q-RISK-PARITY erased reporter (1)       |
| S-8  | `referrerPolicy="no-referrer"` removed            | C-WEB-Q-MEDIA image element (1)                                                       |
| S-9  | Role set widened to include `guardian`            | U-Q-CTRL-ROLES exact set and parity with the write controller (2)                     |
| S-10 | Focus refetch added to the case view              | C-WEB-Q-DETAIL-ONE-READ (1)                                                           |

Review-fix proofs, run the same way at commit `0bb770f6` after the independent review fixes:

| ID   | Defect injected                                        | Red tests (failed count)                                                                       |
| ---- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| S-11 | Case stays on screen after a 401, 403 or 503 on reload | C-WEB-Q-DETAIL terminal states (4)                                                             |
| S-12 | Case locale from `min(locale)` again                   | I-Q-LOCALE multi-report, filter agreement, unusable snapshot locale (3)                        |
| S-13 | Queue rows kept in state after a terminal failure      | Survives. Equivalent mutant: the terminal notice replaces the whole console, so no row renders |
| S-14 | Author-typed `<U+202E>` no longer escaped              | C-WEB-Q-HOSTILE-TEXT typed marker (1)                                                          |
| S-15 | Excerpt cut in the middle of a surrogate pair          | U-Q-SVC clamp (1)                                                                              |
| S-16 | Newer server field fails the parse again               | U-WEB-Q-CLIENT version skew (1)                                                                |
| S-17 | 429 mapping removed                                    | U-WEB-Q-CLIENT 429 to `rate_limited` (1)                                                       |

S-9 is the closest mutation the code allows to "flag before role".
The flag read lives in the controller body after the guards, so the only way to let a non-moderator reach it is to widen the role set.

### Execution results (2026-11-03, Chicago time)

| Suite                                                | Result                |
| ---------------------------------------------------- | --------------------- |
| API units (`apps/api/src/modules/moderation`)        | 87 passed, 6 files    |
| API integration (`moderation-queue*`, real Postgres) | 92 passed, 8 files    |
| Contract units (`packages/api-client/testing`)       | 88 passed             |
| Flags (`packages/config`)                            | 26 passed             |
| Database (RLS and flag seed)                         | 8 passed              |
| Web (`vitest run moderation`)                        | 225 passed, 11 files  |
| Pact consumer (three-run determinism) and provider   | passed                |
| Playwright (`moderation-console` plus role matrix)   | 27 passed, three runs |

The first Playwright run of the keyboard test flaked twice because it used programmatic `focus()`, which never shows a focus-visible ring.
The test now reaches the link with real Tab presses and ran green three times after the fix.

### Deployed preview coverage (2026-11-03)

The Vercel preview run has no database secret, so the specs split into two groups.
Live tests sign up a throwaway moderator through the product API and need no database.
Seeded tests need direct database access and skip themselves on a preview.

The preview API has `moderation_console_enabled` off (the preview database row is `false`, as in production).
A moderator therefore passes the role check and meets the closed console, and the live tests assert exactly that on the preview:

- The API answers 503 `moderation_console_disabled`, parsed by the shipped error schema, with `private, no-store`, for the queue, an unknown id, a malformed id and a bad filter.
  The flag is read before the id and the query, so the closed console reveals nothing about which cases exist.
- Guardian and teen get 403, and an anonymous caller gets 401, on both routes.
- The browser shows "The moderation console is turned off." for a moderator, with an axe check on that state.
- A guardian, a teen and a visitor see no case data in the browser.
- Unknown and malformed case ids fail closed, and the 320, 768 and 1280 pixel layouts fit.

Run locally against the real preview (31 tests, one worker, database and service-role key unset to match CI): 20 passed, 11 skipped.
The 11 skips are the 8 seeded tests plus 3 live tests that need the console on: the queue, filter and case journey, the keyboard journey and the queue axe check.
Turning the preview flag on runs those three against the preview without a spec change.

Two preview facts shaped the specs:

- A web build without `NEXT_PUBLIC_E2E_AUTH=true` verifies the session with Supabase and clears a fixture token a moment after hydration.
  The specs keep the token in place on a preview, and the owner lever that removes the workaround is `NEXT_PUBLIC_E2E_AUTH=true` on the preview web build.
- The browser proxy forwarded the web origin cookie to the protected API origin, which rejected it.
  The helper now drops that cookie so the jar's API cookie is used.

### Observations for the owner

- Next.js answers a malformed percent escape in the case path (`%`, `%zz`, `%E0%A4%A`) with its own 400 before the page renders, so the `readCaseId` catch only runs for segments Next lets through.
  The outcome is closed: no case data, no API call, no 5xx.
  P-Q-DEEPLINK accepts either that 400 or the console not-found state.
- The Playwright stack seeds `LookbookPost.published_at` at seed time while reports are back-dated, so a screenshot can show a post published after it was reported.
  This is fixture timing and has no product effect.

---

## Quality Gate Criteria

### Pass/Fail Thresholds

- P0: 100 percent pass.
- P1: 95 percent pass at merge, every failure triaged.
- Flake: zero tolerated. A flaky I-Q-PLAN is fixed by the stable assertions listed above.
- All ten seeded-defect proofs recorded.

### Coverage Targets

- Every acceptance criterion (E1 to E3, S1 to S8) maps to at least one P0 or P1 test (see Traceability).
- Every closed enum the console renders has a localized label (U-WEB-Q-LOCALES).
- Every error code in the contract has a test that produces it.

### Non-Negotiable Requirements

- No case data in any non-2xx body.
- No signed URL outside the detail response body.
- Exactly one audit row per successful detail read.
- Read paths contain no write other than that row.

---

## Traceability

| Criterion | Statement                                                                   | Tests                                                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1 / S1   | Moderator-only keyset queue, filters, signed cursor, `serverNow`            | U-Q-RISK-RULES, U-Q-SLA-STATES, U-Q-CURSOR, U-Q-FILTER-SCHEMA, U-Q-SVC-CLOCK, I-Q-ORDER, -GROUP, -FILTERS, -KEYSET-TIES, -PAGING-UNDER-CHANGE, -RISK-PARITY, -PLAN, C-Q-PACT, C-Q-OPENAPI |
| E3 / S2   | Unauthorized roles get no data, identical 403, flag hidden                  | U-Q-CTRL-ROLES, -FLAG-ORDER, -HEADERS, -NO-ORACLE, I-Q-HTTP, P-Q-ROLES, P-Q-FORBIDDEN, C-WEB-Q-FORBIDDEN-NO-DATA                                                                          |
| E2 / S3   | Detail holds snapshot, live state, findings, reporters, actions, SLA, media | U-Q-SVC-FINDINGS, -MEDIA, -IDENTITY, -SNAPSHOT, -PRIOR-ACTIONS, I-Q-DETAIL, I-Q-ORPHAN, C-WEB-Q-DETAIL, C-WEB-Q-MEDIA, P-Q-CONSOLE, P-Q-MEDIA                                             |
| E3 / S4   | Accepted report visible within five minutes                                 | I-Q-INTAKE-5MIN, P-Q-INTAKE-E2E                                                                                                                                                           |
| E3 / S5   | No direct database client, tables denied, read-only                         | D-RLS-DENIED, U-Q-READSET, U-WEB-Q-NO-DIRECT, I-Q-READONLY, U-Q-CTRL-READONLY, U-Q-CONTRACT-STRICT, U-Q-SVC-LOGGING                                                                       |
| S6        | One audit row per read, fail closed                                         | U-Q-SVC-AUDIT-FAILCLOSED, I-Q-AUDIT, D-RLS-AUDIT, C-WEB-Q-DETAIL-ONE-READ, P-Q-AUDIT-ONE                                                                                                  |
| E2 / S7   | Console states, accessibility, countdown, themes and widths                 | C-WEB-Q-QUEUE, -STATES, -COUNTDOWN, -A11Y, -FILTERS, -HOSTILE-TEXT, U-WEB-Q-CLIENT, U-WEB-Q-LOCALES, P-Q-AXE, P-Q-KEYBOARD, P-Q-THEMES-WIDTHS, P-Q-HOSTILE                                |
| S8        | Under 100 files, jobs under 20 minutes                                      | D-NO-MIGRATION, V-Q-BUDGET                                                                                                                                                                |

### Gap status

No uncovered criterion.
Every P0 and P1 scenario has a green test against the real code, and every acceptance criterion row above lists at least one executed test.
Residual defaults below carry the known limits.

---

## Mitigation Plans

### R-001 Authorization (6)

Keep the guard pair identical to `ModerationController`.
The role matrix is a table in U-Q-CTRL-ROLES so a new role in `API_ROLES` forces a decision.
Seeded defects S-1 and S-9 prove the tests bite.

### R-002 Response leakage (6)

The maximal fixture contains every column the repository can select.
The forbidden-key scan walks the parsed response recursively, so a nested leak fails the same way as a top-level one.

### R-003 Audit integrity (6)

Order is fixed: load, audit insert, sign, respond.
The audit insert and the response share one request, with no retry inside the service.
The console never retries a detail read by itself.

### R-004 Keyset (6)

Use `COLLATE "C"` on `case_key` in `ORDER BY` and in the comparison.
Build the predicate as `rank < $r OR (rank = $r AND due > $d) OR (rank = $r AND due = $d AND key > $k)`.
Timestamps are `TIMESTAMP(3)`, so a JavaScript `Date` round-trips exactly; I-Q-KEYSET-TIES seeds equal-millisecond rows to prove it.

### R-005 Intake (6)

Nothing on the read path may hold state: no memoization, no in-process cache, no `Cache-Control` that permits reuse.
I-Q-INTAKE-5MIN primes the queue before the report to catch a cache that fills on first read.

### R-006 Untrusted text (6)

One `PlainText` component renders every user-authored string as a text node with `overflow-wrap: anywhere` and `white-space: pre-wrap`.
No other component may render those fields.
C-WEB-Q-HOSTILE-TEXT iterates one corpus across every field.

### R-007 Parity (6)

I-Q-RISK-PARITY seeds real rows for every combination, runs the repository query and compares to `deriveCaseRisk`.
The 63 reason subsets cover mixed-strength cases that a six-reason table misses.

### R-008 Media (6)

A single `CaseMedia` component owns the image element.
The expiry timer uses the server offset, so a skewed client clock still shows the expired state at the right moment.

---

## Assumptions and Dependencies

### Assumptions

- RG1: `limit` is not part of the cursor binding. A client may change page size between pages.
- RG2: the API guarantees exactly-once for unchanged rows. A changed row may appear 0 or 1 times. The web client dedupes by `caseId`.
- RG3: a released post keeps its machine finding and the risk bump.
- RG4: a takedown reason equal to a screening code parses as a finding. 6.11 constrains reasons.
- RG5: the resolved listing is unindexed for the risk sort. This story records the budget and leaves optimization to a follow-up.
- RG6: the Playwright flag stays at the seeded value. Disabled-state proof uses a routed 503 in the browser and the real flag in API integration.
- RG7: `acceptedAt` on a case is the earliest accepted time among its open reports.

### Dependencies

- `@couture/testing` factories for post and comment reports.
- Local Supabase with the `community-images` bucket for P-Q-MEDIA.
- `@seontechnologies/playwright-utils` 4.4.1 and `@seontechnologies/pactjs-utils` 1.1.0, already installed.
- CC-1.4 `AuditLog` and its immutability triggers.

### Risks to Plan

- The 5,000-row plan test depends on planner statistics. Run `ANALYZE` after the bulk insert, assert index usability under `enable_seqscan=off`, and hold the default planner to a latency budget. The default plan shape stays unasserted.
- Shared databases make flag toggling a cross-test hazard. See RG6.
- Ten locale files dominate the file count. The spec's split rule applies at 90 files.

---

## Interworking and Regression

- `POST /api/v1/moderation/actions` keeps its contract, role check and analytics event (U-Q-CTRL-READONLY, existing `auth-moderation-security.spec.ts`).
- `community_read_enabled` semantics stay untouched; the new flag is independent (U-Q-CTRL-FLAG-ORDER).
- Report intake routes keep their behavior; the intake tests call them but add no assertion on their internals.
- `CommunityModerationActionsService` changes only in its header comment; its specs stay green.
- Existing RLS and policy-matrix specs stay green (D-RLS-DENIED reuses their helpers).

## Follow-on Workflows (Manual)

- After the build: `bmad-tea-test-review` on the new specs (flake, determinism, fixtures).
- Before the release gate: `bmad-tea-trace` for the traceability matrix and gate decision.
- For 6.11: add decision tests that reuse `seedModerationQueue` and the case-id contract.
