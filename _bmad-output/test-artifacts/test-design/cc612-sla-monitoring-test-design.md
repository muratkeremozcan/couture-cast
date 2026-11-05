---
runScope: 'epic'
runKey: 'epic-6-story-6.12'
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

# Test Design: Epic 6, Story CC-6.12 SLA monitoring and escalation

**Date:** 2026-11-05
**Author:** Murat (TEA), non-interactive run, owner unavailable, decisions recorded in the spec
**Status:** Executed. Results are in the Execution record, and where a test landed differs from the plan, the Execution record wins.

**Precedence:** the spec at `_bmad-output/implementation-artifacts/spec-6-12-sla-monitoring-escalation.md` wins wherever this document and the spec disagree.
The frozen block stays byte-identical to the builder's draft.
Where a frozen sentence needs tightening, the ruling sits in the Spec Change Log and the builder is told.

Inputs read:

- Spec, every section. `epics.md` CC-6.12 criteria E1 to E3. Story brief and fleet rules.
- Prior example `cc611-moderation-decisions-test-design.md` and the Test Design (TEA) section of spec 6.11.
- Code at `3efd8423`, the sections this story touches: `moderation-queue.repository.ts` `listCases`, `moderation-queue.ts` `deriveSlaState`, `moderation-decisions.service.ts`, `moderation-decisions.repository.ts`, `moderation-decisions.ts` availability, `moderation-queue-tables.ts`, the controller and cache-header middleware, `moderation.module.ts`, `maintenance.processor.ts`, `bootstrap.ts`, `community.bootstrap.ts`, `base.worker.ts`, `community-maintenance.service.ts`, `community-moderation.actions.ts`, `community-comments.privacy.ts`, `admin.service.ts`, `admin.controller.ts`, `packages/config/src/flags.ts`, `posthog.service.ts`, `community-moderation.telemetry.ts`, `instrumentation.ts`, `prune-community-worker-deps.mjs`, `start-api-e2e-with-workers.mjs`, `caller-owned-env.mjs`, `playwright/config/local.config.ts`, `sign-community-screening-readiness.mjs`, `pr-checks.yml`, `schema.prisma` models, Grafana README, deployment guide sections.
- Knowledge fragments, read for their scales, rules and mandates: `risk-governance.md`, `probability-impact.md`, `test-levels-framework.md`, `test-priorities-matrix.md`, `nfr-criteria.md`, `library-integration-mandate.md`, `playwright-utils-mandate.md`, `pactjs-utils-mandate.md`, `pact-mcp.md`, `webhook-testing-fundamentals.md`, `webhook-providers.md`.

Workflow decisions taken without a halt:

- Mode: Create. Level: epic-level, scoped to one story. The completed frontmatter above replaces a checkpoint file, and the output path follows the coordinator's brief and the 6.10 and 6.11 precedent.
- Level vocabulary: Unit, Integration (real Postgres, real Nest where stated), API (real HTTP on a real Nest app), DB (RLS and constraints), Contract (Pact and OpenAPI), Component (Vitest and Testing Library), E2E (Playwright), Manual.
- `tea_use_playwright_utils` and `tea_use_pactjs_utils` are true and both packages are installed.
  Playwright specs use `apiRequest`, `recurse`, `interceptNetworkCall` and the merged fixtures.
  Pact interactions use `createProviderState`, `setJsonContent` and `buildVerifierOptions`.
  The webhook wait uses the playwright-utils webhook registry over a capture script speaking the `/__admin/requests` format, because the mandate lists it as the intended pattern for webhook assertions.
  Component-state tests that stub a 503 follow the repo's `network-error-monitor` opt-out, with the reason stated in the test.
  Interactions follow the pact rules: one interaction per `it`, a provider endpoint comment and matchers in responses only.
  `tea_pact_mcp` is `mcp`, and no pact broker tool is reachable in this session, so the plan uses local pact verification and invents no broker data.
- Browser exploration was skipped, because `/moderation/sla` does not exist yet. The manual check M-VISUAL covers the rendered page.
- Probes run for this plan, read-only: `fetch` redirect and error text on Node 24.22.1 (TEA-02, TEA-03), and Prisma `Date` binding on a Chicago session at `127.0.0.1:54339` (TEA-15), with no table created. The third read was the latest `pr-checks` job durations (TEA-18).

---

## Spec review: findings against the real code

Each finding says what the code shows, the disposition and the test that guards it.
"Fixed" means a non-frozen spec section is edited now because the code settles the answer.
"Ruling" means a default decision is recorded in the Spec Change Log and the builder is told.
Intent-level rulings are marked **(intent)**.

| ID     | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                        | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Guard                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| TEA-01 | D2 reads the clock once per sweep, D5 sets a 60-second lease, and D8 allows 5 seconds per send. A lease computed from a sweep-start clock is already aged, and 13 failing sends outlive it even when fresh, so a second worker repeats a send or overwrites an outcome. A row lock held across the POST would also stall `SKIP LOCKED` peers.                                                                                                  | Ruling **(intent)**. State, relevance and `detected_at` use the single sweep read. Each claim is one row in one short transaction, with `lease_until` and `next_attempt_at` from a fresh clock read. No transaction spans the POST. The outcome write is fenced on the claimed `attempts` value. Claiming stops 45 seconds after the sweep began, and the rest waits for the next sweep.                                                                                                                                                                                                                                                                                        | U-S-CLOCK, U-S-BUDGET, I-D-NO-TX-OVER-POST, I-D-FENCE, I-D-BACKLOG-SLOW, S-5, S-6, S-7 |
| TEA-02 | D8 sets `redirect: error` and the matrix requires code `http_3xx`. Probe on Node 24.22.1: a 302 under `redirect: error` throws `TypeError: fetch failed` with cause `unexpected redirect` and no status or code, so the adapter cannot tell it from a network failure. `redirect: manual` returns status 302 with the target hit zero times.                                                                                                   | Ruling **(intent)**. Use `redirect: manual`, and map 300 to 399 to `http_3xx`. The security property of D8 is unchanged: no redirect is followed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | U-CH-CODES, U-CH-REQUEST, I-W-CODES-REAL                                               |
| TEA-03 | Probe: `fetch` on a URL with credentials throws `Request cannot be constructed from a URL that includes credentials: http://user:pw@127.0.0.1:9/hook`, so the raw message prints the secret. D8 says only that HTTPS is required except for loopback, which leaves `localhost.evil.test` and empty values undefined.                                                                                                                           | Ruling. Validate before any fetch. Unset, empty or whitespace means console. Credentials, a non-HTTPS non-loopback URL or an unparseable value give `invalid_config`. Loopback is exactly `localhost`, a literal `127.0.0.0/8` address or `[::1]`. No exception text leaves the adapter: classify by error class to a closed code.                                                                                                                                                                                                                                                                                                                                              | U-CH-CONFIG, U-CH-NO-SECRET, I-P-WEBHOOK-SECRET, S-9                                   |
| TEA-04 | D5 increments `attempts` at claim "so a crash loop still counts", and D9 escalates at the third failed attempt inside the failure write. A crash loop never reaches that write, so it would count and never escalate.                                                                                                                                                                                                                          | Ruling **(intent)**. A finished attempt clears `lease_until`. A claim that finds an expired `lease_until` records `last_error_code = interrupted`, a new closed code on the contract and the metric label. When `attempts` reaches 3 with the stamp null, the claim runs the D9 escalation.                                                                                                                                                                                                                                                                                                                                                                                     | I-W-CRASH-LOOP, U-C-ENUMS                                                              |
| TEA-05 | D10 and the matrix expect `moderation_sla_flag_unavailable` when PostHog and the fallback fail. `packages/config/src/flags.ts:272-318` catches both and returns the default, so a provider or database outage reads as a plain false and that log line cannot fire from an outage.                                                                                                                                                             | Ruling **(intent)**. The behavior the matrix asks for holds: skip, no write, no send, stale dashboard, closed route. The log line stays for a thrown read only. `posthog_feature_flag_failed` already records the provider outage. No flag API changes.                                                                                                                                                                                                                                                                                                                                                                                                                         | U-S-FLAG-THROW, I-S-FLAG-OUTAGE, U-R-ORDER                                             |
| TEA-06 | D10 evaluates flags for subject `system:moderation-sla`. A PostHog rule keyed to moderators leaves the worker off, and the fallback table is synced only by the `maintenance` queue, which no hosted process consumes, so it never turns the worker on.                                                                                                                                                                                        | Fixed in Tasks. The runbook rollout step names both flags and the system subject, and says the fallback table does not carry a production opening.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | U-RB-RUNBOOK                                                                           |
| TEA-07 | D7 places the insert in the `escalate` arm of `applyEffects`, which receives no decision id (`moderation-decisions.service.ts:648`). The decision row is written later, in `writeRecord`. Only `ModerationRecordWriteError` maps to `audit_unavailable` (:385), so a raw insert error surfaces as a 500. `DecisionCaseReport` holds neither `sla_due_at` nor a reason.                                                                         | Fixed in Code Map. Insert from `applyDecision` right after `writeRecord` when the action is `escalate`, through `writeModerationRecord`. `decision_id` is a plain column with no foreign key. `loadCase` gains what the anchor and risk need. D7 is unchanged in meaning: same transaction, same refusal.                                                                                                                                                                                                                                                                                                                                                                       | I-E-ATOMIC, I-E-ROLLBACK, S-11                                                         |
| TEA-08 | D1 computes the anchor in SQL and D7 computes it again in a transaction, and D4 stores `risk`, whose rank depends on findings and distinct reporters. Two computations can drift. `ORDER BY report_id` follows the database collation by default.                                                                                                                                                                                              | Ruling. Both read anchor, due and risk through SQL fragments shared with `listCases`, run on the transaction client, ordered with `COLLATE "C"`. A parity test holds them together.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | I-S-ANCHOR, I-E-PARITY                                                                 |
| TEA-09 | D11 leaves fields undefined. `queue.escalated`: the code meaning is `escalatedCaseKeys`, with terminal decisions clearing and orphans matched by report id. `alerts.failing`, `oldestDueAt`, `oldestPendingReviewAt`, `monitor.channel` before the first sweep, `recentAlerts` order, and `caseId` when an anchor row is gone are all open.                                                                                                    | Ruling. `escalated` is the count of open cases `escalatedCaseKeys` would mark, computed in SQL. `pending` is every pending row, and `failing` is the pending rows with `last_error_code` set, cleared on delivery. `oldestDueAt` is the earliest open due time or null. `oldestPendingReviewAt` is the earliest `updated_at` of `pending_review` posts, the column `sweepStalePendingReview` reads, or null, and the gauge reports 0 then. `channel` is `webhook`, `console` or null. Order is `detected_at` then `id`, both descending. `caseId` falls back to the stored `case_key`. Resolution window is `resolved_at > now - 7 days`, and `late` is `resolved - withinSla`. | I-R-COUNT-PARITY, I-R-ALERT-COUNTS, I-R-RECENT, I-R-PENDING-AGE, I-R-RESOLUTION        |
| TEA-10 | D13 has the sweep capture `moderation_sla_alert_recorded` per alert, and D7 inserts `escalated` rows in the API. The throttle store for `moderation_sla_snapshot` is unnamed, and D4 lists no column for it.                                                                                                                                                                                                                                   | Ruling. `at_risk` and `breached` emit on an actual insert (`RETURNING`). `escalated` emits at its first claim. The snapshot throttle is per process in memory: a restart or a second worker adds a harmless extra, and the runbook absence window stays above 5 minutes.                                                                                                                                                                                                                                                                                                                                                                                                        | U-S-RECORDED, U-S-SNAPSHOT                                                             |
| TEA-11 | D6 says relevance runs before each attempt, and D8 says a claimed alert becomes `console_only` when no URL is set. The order and the later behavior are unstated.                                                                                                                                                                                                                                                                              | Ruling. Relevance runs first, so a stale row becomes `superseded` even with no URL. `console_only` is terminal: setting a URL later replays nothing, and the next new alert sends.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | I-W-NO-CHANNEL, I-W-BACKLOG                                                            |
| TEA-12 | The hosted worker env table (`deployment-guide.md:470-481`) has no `APP_URL`, and Boundaries forbid editing Northflank. The golden payload shows a `caseUrl`. The `stripe-billing.service.ts:42` precedent ends in a localhost default, which must not reach an operator.                                                                                                                                                                      | Fixed in Design Notes and Tasks. `caseUrl` is nullable with a null value when neither variable is set, and `text` uses the path. The rollout section lists `APP_URL` beside the webhook secret.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | U-CH-PAYLOAD, U-C-PAYLOAD-STRICT                                                       |
| TEA-13 | `run` in `maintenance.processor.ts` logs the sweep result, and `base.worker.ts:42` copies `err.message` to `JobFailure` on every failed attempt.                                                                                                                                                                                                                                                                                               | Ruling. The sweep returns integer counts only, and the adapter never throws, so no sweep-level message can carry the URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | U-S-RESULT-SAFE, I-D-BULLMQ                                                            |
| TEA-14 | `scripts/start-api-e2e-with-workers.mjs` boots `community.bootstrap`, and the seed turns both flags on, so a real sweep runs every 60 seconds across every open seeded report in every local Playwright run. A seeded stale stamp is overwritten, and a global count races. Under `TEST_ENV=local`, `.env.local` overrides the launcher env, so a developer value for `MODERATION_OPS_WEBHOOK_URL` would post test data to a real destination. | Fixed in Tasks. `playwright/support/moderation-ops-capture.mjs` runs as a second `webServer` on loopback and answers `/__admin/requests`, so the webhook registry reads it. The launcher forces `MODERATION_OPS_WEBHOOK_URL` to it and lists the key in `E2E_CALLER_OWNED_ENV_KEYS`. Assertions scope to seeded ids. The stale banner uses `interceptNetworkCall`, and I-R-STALE owns the logic.                                                                                                                                                                                                                                                                                | P-SLA-REAL-DELIVERY, P-SLA-STABLE, P-SLA-STALE-UI                                      |
| TEA-15 | Probe on a `TimeZone=America/Chicago` session: a JS `Date` parameter binds as `timestamp with time zone`, `'2026-11-06 12:00'::timestamp = $date` is false, and so is `11:00 <= 12:00Z`. `$date_iso::timestamp` is true. `listCases` uses the text cast and the new claim and count SQL has no rule yet.                                                                                                                                       | Ruling. Every instant in new raw SQL binds as ISO text with a `::timestamp` cast. New SQL uses no database clock. Supabase runs UTC today, so this defect would stay hidden until a session default changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | U-S-NO-DB-CLOCK, I-S-TZ-DST, S-3                                                       |
| TEA-16 | D9 tells the operator to delete the `JobFailure` row. `admin.controller.ts` offers list and `failed-jobs/retry` only, retry enqueues the stray job D9 warns about, and `pruneFailedJobs` runs on `maintenance`, which is not hosted, so rows never age out.                                                                                                                                                                                    | Fixed in Tasks. The runbook gives the exact `DELETE` by `job_id` for the Supabase SQL editor, warns against retry, and states that rows stay until removed. Rows are bounded at one per alert.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | U-RB-RUNBOOK                                                                           |
| TEA-17 | The Code Map says to keep the `generate-community-screening-readiness.mjs:1911` sentence true. That text is inside a payload whose SHA-256 the owner signature binds (`sign-community-screening-readiness.mjs:4-8`), so editing it invalidates the signature.                                                                                                                                                                                  | Fixed in Code Map. Leave the generator and its artifacts unchanged. The sentence stays true through the at-risk row and console in D8, and the runbook states that nobody is paged until a webhook is set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | U-RB-READINESS                                                                         |
| TEA-18 | The Tasks name one integration spec, and this plan needs five plus a crash worker. The Verification command names only that one file. `Workspace coverage (api)` has a 15-minute limit, and the last green run took 7.7 minutes.                                                                                                                                                                                                               | Fixed in Tasks, Verification and Design Notes. The budget moves from about 80 to about 86 files. Integration specs add no real-time wait, using injected clocks and latches, for an added budget under 2 minutes.                                                                                                                                                                                                                                                                                                                                                                                                                                                               | M-BUDGET                                                                               |
| TEA-19 | D6 supersedes on a resolved anchor. `resolveReport` can resolve one report of a case, which would discard an `escalated` alert on a case still open. It has no production caller at `3efd8423`, and decisions resolve every open report.                                                                                                                                                                                                       | Recorded as a residual with no change. I-S-PARTIAL pins the at-risk and breached path. A later story that wires `resolveReport` must move `escalated` relevance to the case.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | I-S-PARTIAL                                                                            |
| TEA-20 | The acceptance bullet says a flag-off sweep touches no table, and the flag fallback reads `FeatureFlag`.                                                                                                                                                                                                                                                                                                                                       | Read as: no table of this feature and no report table. The test asserts `FeatureFlag` is the only table read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | I-S-FLAG-OFF                                                                           |

Reviewed and confirmed with no change:

- Boundaries: `deriveSlaState` and the `listCases` SQL both use `<=`, so 6 hours exactly is `at_risk` and 0 exactly is `breached`.
- Clock source: `MODERATION_QUEUE_CLOCK` is a Nest token, and `systemModerationQueueClock` is a plain function a worker can take as a parameter.
- Reopen: no code path clears `resolved_at`. The `git grep` hits are all `where` predicates, and I-S-NO-REOPEN keeps it so.
- Report rows are never deleted in `apps/api/src`, and foreign keys use `SetNull`, so a missing anchor is defensive only.
- `already_escalated` and `no_open_reports` mean an escalate always has an open anchor, and at most one standing escalation exists per case.
- `FeatureFlagEvaluationSubject` is a plain string, so `system:moderation-sla` is a legal subject.
- `maintenance` runs with concurrency 1, and `schedule()` in `community.bootstrap.ts` guards overlap inside one process.
- Migrations run inside API builds (`deployment-guide.md:868`), so the table exists before new API code reaches the D7 insert.

The two owner-droppable items:

- Operations channel ships reduced, per D8. Tests prove delivery to a real HTTP endpoint from a real process. No test proves delivery to a production destination, Slack or Discord, because none exists. That stays open and is named in the runbook.
- Staffing coverage is dropped, per D16. U-RB-RUNBOOK proves the runbook claims no coverage.

---

## Executive Summary

**Scope:** one sweep on two trigger paths, one alert table doubling as an outbox, one webhook adapter, the 6.11 escalate hook, `GET /api/v1/moderation/sla`, `/moderation/sla`, Grafana and PostHog signals and an operating runbook, behind `moderation_sla_monitoring_enabled`.

**Risk summary:**

- Total risks: 24
- High (score >= 6): 13
- Medium (score 3 to 4): 7
- Low (score 1 to 2): 4
- Critical categories: BUS and OPS (a silent case, a silent worker, a silent channel), SEC (private data and the webhook secret), DATA (the escalate transaction, duplicate sends)

**Coverage summary:** 132 scenarios: P0 67, P1 55, P2 10, P3 0. Totals by level are in the Test Catalog. Forty-one seeded-defect proofs sit outside the count.

**Red-first:** 116 red-first, 4 green guards, 6 manual.

**Effort:** roughly 55 to 95 hours (7 to 12 days), including the crash worker, the concurrency harness and the capture server.

---

## Not in Scope

| Item                                                       | Reasoning                                                          | Mitigation                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Append-only enforcement, retention, evidence export        | CC-6.13 per the epic                                               | Alert rows hold no subject identity (D-SCHEMA), and the seam is in Design Notes |
| Paging, on-call, reminders, acknowledgment, mobile surface | Never list                                                         | The dashboard keeps every breached case visible                                 |
| Delivery to a production webhook, Slack or Discord         | No destination or account exists (D8)                              | Real HTTP proof plus the drill; open item in the runbook                        |
| Hosted Grafana panels and alert rules                      | Image budget and the 0.7 no-notification policy (D13)              | PostHog signal; local LGTM proof                                                |
| Named staffing coverage                                    | No staff to name (D16)                                             | Blank coverage table; gate signature stays open                                 |
| Load testing                                               | No NFR threshold beyond the 5-minute stale line and the job limits | `moderation-queue-plan` precedent, I-S-PAGING, I-D-BACKLOG-SLOW                 |

---

## Risk Assessment

Scores use probability and impact from 1 to 3.
Probability and impact reasons are in each description and in the coverage notes.

### High-Priority Risks (Score >= 6)

| Risk ID | Category | Description                                                                                                                                                                                                                                                       | Probability | Impact | Score | Mitigation                                                                                              | Owner           | Timeline         |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | ------------------------------------------------------------------------------------------------------- | --------------- | ---------------- |
| R-001   | BUS      | Calculate at-risk and breached states (E1): an off-by-one at a boundary or a copied threshold makes the sweep disagree with the 6.10 definition, so a case stays silent past its window. Source: D1, D2.                                                          | 2           | 3      | 6     | One definition, boundary tables in unit and real SQL, threshold scan.                                   | Builder and TEA | Before PR review |
| R-002   | TECH     | Persisted timestamps compared through a raw `Date` parameter or a database clock shift by the session offset: the 2026-11-05 probe shows a `Date` binds as `timestamptz`, and on a Chicago session `11:00 <= 12:00Z` is false. Source: D2, `listCases` `nowText`. | 2           | 3      | 6     | TEA-15 binding rule, a scan, and the run on a Chicago session across both DST changes.                  | Builder         | Before PR review |
| R-003   | OPS      | Scheduled worker: the hosted process runs the interval path only (D3), so a sweep wired to `maintenance` alone never runs in production and nothing fails.                                                                                                        | 2           | 3      | 6     | Wiring units per path, and real delivery from the real `community.bootstrap` process.                   | Builder and TEA | Before PR review |
| R-004   | DATA     | Retry-safe worker and deduplicate retries (E1, E2): a 60-second lease (D5) with a 5-second timeout (D8) expires inside a batch of 13 failing sends, and a sweep-time clock shortens it further, so a second worker repeats a send or overwrites an outcome.       | 3           | 2      | 6     | TEA-01: per-row claim, fresh lease clock, no transaction over the POST, fenced write, 45-second budget. | Builder         | Before PR review |
| R-005   | BUS      | Alert before breach and at breach (E2): a sweep reading one page, a wrong anchor or a key that blocks a legitimate later alert leaves a case with no alert at all.                                                                                                | 2           | 3      | 6     | Paging, anchor, outage and new-report scenarios on real rows.                                           | Builder and TEA | Before PR review |
| R-007   | SEC      | Reporter, subject and reason text leak into a third-party webhook, logs or analytics: the sweep reads `listCases` rows holding excerpts and reasons, and `run` logs the sweep result. Source: Boundaries, D4.                                                     | 2           | 3      | 6     | Strict schemas, canary scan over every surface, closed analytics keys.                                  | TEA             | Before PR review |
| R-008   | SEC      | The webhook URL is a secret (D8), and raw `fetch` error text prints a credentials URL in full, per the 2026-11-05 probe: logging an error message publishes it.                                                                                                   | 2           | 3      | 6     | TEA-03: validate first, closed codes, no error text leaves the adapter.                                 | Builder         | Before PR review |
| R-009   | OPS      | Escalate delivery failures (E2): `redirect: error` makes `http_3xx` unreachable and a crash loop writes no failure, so a dead channel stays silent. Source: D8, D9, 2026-11-05 probe.                                                                             | 2           | 3      | 6     | TEA-02, TEA-04, exact third-attempt scenarios, recovery with no operator step.                          | Builder and TEA | Before PR review |
| R-010   | TECH     | Alert tests (E3) that stop at a fake channel pass while the real adapter is broken, and nothing proves the real process sends.                                                                                                                                    | 2           | 3      | 6     | Real `node:http` server in integration, and real worker process to a real capture server in Playwright. | TEA             | Before PR review |
| R-011   | DATA     | The 6.11 escalate notifies nobody until this story: an alert outside the decision transaction loses an escalation or leaves a false append-only decision, and only `writeModerationRecord` errors map to 503. Source: D7, `moderation-decisions.service.ts:385`.  | 2           | 3      | 6     | TEA-07, TEA-08, fault injection through a real trigger, parity with `listCases`.                        | Builder         | Before PR review |
| R-015   | OPS      | Dead worker is silent (6.2b BH18, D14): if `stale` or the pending age is wrong, the one pull signal for a dead hosted worker lies.                                                                                                                                | 2           | 3      | 6     | Boundary tests from the API alone; manual stop-worker check.                                            | TEA             | Before PR review |
| R-016   | OPS      | The community image has a 150 MB budget and no CI prune job: a sweep import pulling the OTEL SDK, or a changed export, stops the screening worker. A prior commit broke its CMD with green specs (`1fd6c2dd`).                                                    | 2           | 3      | 6     | Import graph unit, local prune run, caller grep.                                                        | Builder         | Before PR review |
| R-020   | TECH     | Flaky E2E: `scripts/start-api-e2e-with-workers.mjs` boots `community.bootstrap` with seeded flags on, so a live 60-second sweep races every Playwright test.                                                                                                      | 3           | 2      | 6     | TEA-14: scoped assertions, stubbed stale state, `recurse`, repeat-each proof.                           | TEA             | Before PR review |

### Medium-Priority Risks (Score 3 to 4)

| Risk ID | Category | Description                                                                                                                                                          | Probability | Impact | Score | Mitigation                                                                        | Owner           |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | --------------------------------------------------------------------------------- | --------------- |
| R-006   | BUS      | Relevance at send (D6): an alert for a case closed between sweeps, or a backlog after an outage, pages people about nothing and trains them to ignore the channel.   | 2           | 2      | 4     | Relevance table, real decision between sweeps, backlog scenario.                  | Builder         |
| R-012   | SEC      | Moderator-only route (D11): a new controller can miss the guard class or the `forRoutes` cache-header list.                                                          | 1           | 3      | 3     | Role matrix at HTTP and E2E, headers on every status, RLS proof.                  | TEA             |
| R-013   | OPS      | Off in production (D10): a sweep that reads before the flag, or an alert sent with a flag off, breaks the rollout control.                                           | 1           | 3      | 3     | Query log proof with flags off; default false; outage scenario.                   | Builder         |
| R-014   | BUS      | A second SQL for dashboard counts can disagree with the queue, and D11 leaves `escalated` and `failing` undefined.                                                   | 2           | 2      | 4     | TEA-09 definitions; parity against paged `listCases` and queue `escalated` flags. | Builder and TEA |
| R-017   | PERF     | Sweep length: `maintenance` runs serially and 5-second timeouts across a backlog can pass the 5-minute stale line, reporting a live worker as dead.                  | 2           | 2      | 4     | 45-second budget (TEA-01), slow-backlog scenario.                                 | Builder         |
| R-019   | BUS      | Console states (D12): a missing state, locale key or low contrast hides a stale monitor from the moderator who needs it.                                             | 2           | 2      | 4     | Component states, ten locales, axe, theme and width matrix.                       | TEA             |
| R-021   | OPS      | No invented metrics (dashboard README, D13): today only `main.ts` starts the SDK, so worker meters export nothing and a dashboard can name metrics no process sends. | 2           | 2      | 4     | Name-existence unit, OTLP capture, manual LGTM read.                              | Builder         |

### Low-Priority Risks (Score 1 to 2)

| Risk ID | Category | Description                                                                                                                                     | Probability | Impact | Score | Action                                                                 |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | ---------------------------------------------------------------------- |
| R-018   | DATA     | Erasure re-key (D5, 6.10 D1): `post.X` splitting into orphan cases can re-alert the alerted report or break a link.                             | 1           | 2      | 2     | Document and pin through the real erasure path.                        |
| R-022   | BUS      | Runbook proves ownership and staffing (E3): an invented roster or a claim of coverage is a false signature on the beta gate. D16 keeps it open. | 1           | 2      | 2     | Pin with the runbook unit; leave the signed readiness payload alone.   |
| R-023   | OPS      | The drill posts through the real adapter (D15): it could write a row or reach a real destination by mistake.                                    | 1           | 2      | 2     | Pin with the drill test: no table touched, `--local` is loopback only. |
| R-024   | OPS      | A PostHog failure or a double count (D13) could fail a sweep or skew the absence signal.                                                        | 1           | 2      | 2     | Pin with snapshot and recorded-event units.                            |

### Risk Category Legend

- **TECH**: technical and test architecture
- **SEC**: access control and data exposure
- **PERF**: duration and resource limits
- **DATA**: integrity, loss and duplication
- **BUS**: wrong operator-facing behavior
- **OPS**: deployment, configuration and monitoring

---

## NFR Planning

This plans validation only. `bmad-tea-nfr` reads the evidence later.

| NFR Category    | Requirement / Threshold                                                                                                 | Risk Link           | Planned Validation                                      | Evidence Needed                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| Security        | Moderator and admin only, `private, no-store`, zero client grants, no private data or webhook URL on any surface        | R-007, R-008, R-012 | I-P-\*, I-R-HTTP, I-R-HEADERS, D-RLS, P-SLA-ROLES       | Integration and Playwright reports                             |
| Reliability     | One row per key, at-least-once with a stable id, third failure escalates, recovery with no operator, stale at 5 minutes | R-004, R-009, R-015 | I-D-_, I-W-_, I-R-STALE, S-4 to S-7, S-12               | Reports, seeded-defect record, burn-in of the concurrency file |
| Performance     | Webhook timeout 5 seconds, lease 60 seconds, claim budget 45 seconds, sweep every 60 seconds, API counts in SQL         | R-017               | U-CH-REQUEST, U-S-BUDGET, I-D-BACKLOG-SLOW, I-R-NO-LOAD | Reports and query logs                                         |
| Maintainability | One SLA definition, no hand edit of generated files, under 150 MB image                                                 | R-001, R-016        | U-S-NO-THRESHOLD, C-OPENAPI, U-W-IMAGE-GRAPH, M-IMAGE   | Reports and the prune output                                   |
| Operability     | Dashboards from real metrics, runbook with roles and steps, drill exits non-zero on failure                             | R-021, R-022, R-023 | U-GF-METRICS, I-O-OTLP, U-RB-RUNBOOK, I-W-DRILL, M-LGTM | Reports and screenshots                                        |

**Unknown thresholds:** no end-to-end alert latency target exists beyond D7's "one sweep plus the channel", and no sweep duration target exists. Both are recorded as observations in the first run, with no pass or fail value invented here.

---

## Entry Criteria

- [ ] Spec Change Log rulings TEA-01 to TEA-20 accepted by the builder, or countered in the log.
- [ ] Isolated Postgres at `127.0.0.1:54339` with a database created for this story, and Redis on loopback for I-D-BULLMQ.
- [ ] `apps/api/integration/helpers/moderation-queue-seed.ts` usable with explicit `dueAt`.
- [ ] Contract file `moderation-sla.ts` exists, so component and contract tests can import it.

## Exit Criteria

- [x] Every P0 passes and every P1 passes or has a triaged owner.
- [x] Zero flakes, with every tier burned in on three consecutive runs.
- [x] All seventeen planned seeded-defect proofs recorded, plus twenty-two added during the build and the Codex round.
- [x] Every open item named in the runbook, with nothing claimed as proved beyond the tests.

---

## Test Catalog

Columns: **AC** maps to the epics criteria E1, E2 and E3 and to the spec acceptance bullets S1 to S12, numbered in spec order (see Traceability).
**Risk** is the scored risk the scenario primarily covers, or `-`.
**Red** is `R` for red-first (written before the implementation and watched fail for the right reason), `G` for a green guard (passes before the build and protects against regression), `M` for manual.

### Contract package units (`packages/api-client/testing/moderation-sla-contract.spec.ts`)

| ID                  | Level | Pri | AC     | Risk  | Red | Scenario                                                                                                                                                                                                                                                                                         |
| ------------------- | ----- | --- | ------ | ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U-C-RESPONSE-STRICT | Unit  | P0  | E3, S9 | R-007 | R   | The route response schema is strict; an unknown key fails at every level; `monitor.channel` and `lastSweepAt` accept null; a recursive scan of a maximal fixture finds no `reason`, `excerpt`, `alias`, `reporter`, `subject`, `userId`, `email`, `anchorReportId`, `decisionId` or webhook key. |
| U-C-PAYLOAD-STRICT  | Unit  | P0  | E2, S4 | R-007 | R   | The webhook payload schema accepts the Design Notes golden example, accepts `caseUrl: null`, accepts `kind: drill` only in the drill schema, and rejects any extra key.                                                                                                                          |
| U-C-ENUMS           | Unit  | P1  | S9     | R-019 | R   | Exported kind, delivery and failure code arrays drive the locale key set; the code array includes `interrupted`; the OpenAPI enums equal the arrays.                                                                                                                                             |

### Sweep units (`apps/api/src/modules/moderation/moderation-sla.sweep.spec.ts`, fakes around a plain class)

| ID               | Level | Pri | AC     | Risk  | Red | Scenario                                                                                                                                                                                                                                                          |
| ---------------- | ----- | --- | ------ | ----- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-S-BOUNDARY     | Unit  | P0  | E1, S1 | R-001 | R   | Table on an injected clock: remaining 6 hours plus 1 ms gives no alert; exactly 6 hours and 1 ms give `at_risk`; exactly 0 and minus 1 ms give `breached`. A row whose SQL state says `at_risk` while `deriveSlaState` says `breached` alerts as `breached` (D1). |
| U-S-NO-THRESHOLD | Unit  | P0  | S1     | R-001 | R   | Scan of the non-empty `moderation-sla.*` source list: no `21600000`, `21_600_000`, `6 * 60 * 60`, `86400000`, or `interval ` duration literal; the only threshold import is from `@couture/api-client/contracts/http`.                                            |
| U-S-CLOCK        | Unit  | P0  | E1, S1 | R-002 | R   | State and relevance use the single sweep read; `detected_at` equals it; `lease_until` and `next_attempt_at` use a fresh clock read at claim, so a test clock advanced 50 seconds mid-sweep yields a lease ending 60 seconds after the claim (TEA-01).             |
| U-S-NO-DB-CLOCK  | Unit  | P1  | E1     | R-002 | R   | Scan of the new repository SQL: no `now()`, `CURRENT_TIMESTAMP` or `timestamptz`; every instant in a raw query is bound as ISO text with a `::timestamp` cast (TEA-15).                                                                                           |
| U-S-FLAG-ORDER   | Unit  | P0  | S8     | R-013 | R   | Either flag false: no repository, channel, telemetry or PostHog call. Flags are read first, once each per sweep, for subject `system:moderation-sla`.                                                                                                             |
| U-S-FLAG-THROW   | Unit  | P1  | S8     | R-013 | R   | A thrown flag read skips the run, logs `moderation_sla_flag_unavailable` and does not reject (TEA-05).                                                                                                                                                            |
| U-S-RELEVANCE    | Unit  | P0  | S3     | R-006 | R   | Table of kind by anchor state by time: resolved anchor supersedes every kind; `at_risk` at or past due supersedes; `breached` and `escalated` past due still send; a missing anchor row supersedes.                                                               |
| U-S-ISOLATION    | Unit  | P1  | E2     | R-009 | R   | A repository or channel failure on one alert leaves the rest of the batch processed and counted.                                                                                                                                                                  |
| U-S-SWEEP-FAILS  | Unit  | P1  | E1     | R-015 | R   | A detection failure rejects, sends nothing and does not stamp the monitor.                                                                                                                                                                                        |
| U-S-RESULT-SAFE  | Unit  | P0  | S4     | R-007 | R   | The sweep result holds integer counts only, because `run` in `maintenance.processor.ts` logs it (TEA-13).                                                                                                                                                         |
| U-S-BUDGET       | Unit  | P1  | E2     | R-017 | R   | Claiming stops 45 seconds after delivery starts, and a run always claims once, so slow detection cannot starve delivery; unclaimed alerts stay `pending` (TEA-01, CX-2).                                                                                          |
| U-S-BACKOFF      | Unit  | P1  | S5     | R-009 | R   | Failed attempt n schedules 1, 2, 4, 8, 16, then 30 minutes, and stays capped at 30 for attempts 6 to 20.                                                                                                                                                          |
| U-S-SNAPSHOT     | Unit  | P2  | E3     | R-024 | R   | `moderation_sla_snapshot` fires at most once per 5 minutes per process, at the exact boundary; it has state counts and pending review age, distinct id `system:moderation-sla`, no case id; a capture throw leaves the sweep result unchanged.                    |
| U-S-RECORDED     | Unit  | P2  | E3     | R-024 | R   | `moderation_sla_alert_recorded` and the counter fire once per inserted row for `at_risk` and `breached`, once at the first claim of an `escalated` row, and never on a conflict or a retry (TEA-10).                                                              |

### Channel units (`apps/api/src/modules/moderation/moderation-sla.channel.spec.ts`)

| ID             | Level | Pri | AC     | Risk  | Red | Scenario                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ----- | --- | ------ | ----- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-CH-CONFIG    | Unit  | P0  | S4, S6 | R-008 | R   | URL table with a spy `fetch`: unset, empty and whitespace mean console. `https://` passes. `http://` passes for `localhost`, `127.0.0.1`, `127.9.9.9`, `[::1]`. `http://example.test`, `http://localhost.evil.test`, `http://127.0.0.1.nip.io`, `https://user:pw@example.test`, `ftp://x` and a garbage string give `invalid_config` with zero fetch calls (TEA-03). |
| U-CH-CODES     | Unit  | P0  | S5     | R-009 | R   | Status and error table: 200 and 204 deliver; 301, 302 and 307 give `http_3xx`; 400, 404 and 429 give `http_4xx`; 500 and 503 give `http_5xx`; abort gives `timeout`; a `TypeError` gives `network`. `deliver` never rejects.                                                                                                                                         |
| U-CH-NO-SECRET | Unit  | P0  | S4     | R-008 | R   | Every result and logged field of every path above excludes the URL, its host, its path and its token, with a canary token in the URL.                                                                                                                                                                                                                                |
| U-CH-REQUEST   | Unit  | P1  | S4     | R-010 | R   | POST with JSON content type, `Idempotency-Key` equal to the alert id, `redirect: manual`, default timeout 5000 ms (TEA-02).                                                                                                                                                                                                                                          |
| U-CH-PAYLOAD   | Unit  | P0  | S4     | R-007 | R   | Builder output equals the golden example byte for byte. `APP_URL` wins over `NEXT_PUBLIC_APP_URL`; a trailing slash leaves one slash; with neither set `caseUrl` is null and `text` uses the path, with no localhost default (TEA-12). `text` has one closed template per kind.                                                                                      |

### Route units (`apps/api/src/modules/moderation/moderation-sla.controller.spec.ts`, `moderation-sla.service.spec.ts`)

| ID        | Level | Pri | AC  | Risk  | Red | Scenario                                                                                                                                                    |
| --------- | ----- | --- | --- | ----- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U-R-ORDER | Unit  | P0  | S8  | R-012 | R   | Check order is bearer, role, flags. A non-moderator causes no flag read. Each flag off, or a thrown read, gives 503 `moderation_sla_disabled` with no data. |
| U-R-STALE | Unit  | P1  | E3  | R-015 | R   | `stale` on the injected clock: null is true, 4:59.999 is false, exactly 5:00 is false, 5:00.001 is true.                                                    |

### Worker wiring units (`maintenance.processor.spec.ts`, `maintenance.scheduler.spec.ts`, `bootstrap.spec.ts`, `community.bootstrap.spec.ts`, `community-worker-runtime.spec.ts`, `community-worker-release-gate.spec.ts`)

| ID              | Level | Pri | AC  | Risk  | Red | Scenario                                                                                                                                                                                                                                         |
| --------------- | ----- | --- | --- | ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U-W-ROUTE       | Unit  | P0  | E1  | R-003 | R   | `moderation-sla-sweep` routes to the sweep; a rejection logs and rethrows, so BullMQ applies `attempts: 3`; an unknown name still warns and returns.                                                                                             |
| U-W-SCHEDULER   | Unit  | P0  | E1  | R-003 | R   | `registerModerationSlaScheduler` upserts one id at a one-minute cadence on `maintenance`, twice with no second scheduler, and `bootstrap.ts` calls it.                                                                                           |
| U-W-INTERVAL    | Unit  | P0  | E1  | R-003 | R   | `startCommunityWorkers` schedules the sweep at 60000 ms with no overlap; a rejection logs `community_sweep_failed` and the process survives; the process still has no `maintenance` subscription.                                                |
| U-W-FACTORY     | Unit  | P1  | E1  | R-003 | R   | `bootstrap.ts` and `community.bootstrap.ts` call the same function from `createCommunityWorkerRuntime` sweeps.                                                                                                                                   |
| U-W-OTEL        | Unit  | P1  | E3  | R-021 | R   | General bootstrap starts `initializeOpenTelemetry` and closes it on shutdown; `community.bootstrap.ts` does neither.                                                                                                                             |
| U-W-IMAGE-GRAPH | Unit  | P0  | E1  | R-016 | R   | The import graph from `community.bootstrap` reaches `moderation-sla.sweep` and reaches neither `instrumentation` nor `@opentelemetry/sdk-node` nor `auto-instrumentations-node`. Every `moderation-sla` bare import resolves in the prune trace. |
| U-F-REGISTRY    | Unit  | P1  | S8  | R-013 | R   | `moderation_sla_monitoring_enabled` is boolean, default false, seeded true, with the seed spec and the four service count assertions updated.                                                                                                    |

### Integration: detection (`apps/api/integration/moderation-sla.integration.spec.ts`, real Postgres)

| ID                | Level       | Pri | AC     | Risk  | Red | Scenario                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ----------- | --- | ------ | ----- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-S-BOUNDARY      | Integration | P0  | E1, S1 | R-001 | R   | Real rows at each boundary for posts and comments through the real SQL: alert kinds equal `deriveSlaState`, and equal `listCases` `slaState` at the same instant.                                                                                                                                                                                     |
| I-S-PAGING        | Integration | P0  | E1, S1 | R-005 | R   | More than two pages of each state at limit 50 with mixed risk ranks: every case gets one alert. A sweep reading one page fails this.                                                                                                                                                                                                                  |
| I-S-ANCHOR        | Integration | P0  | E1, S1 | R-005 | R   | `anchorReportId` is the open report with the earliest due time, with ties by id in `COLLATE "C"` order. A resolved earlier report is skipped. A resolved case gives null. The queue route response still has no anchor field.                                                                                                                         |
| I-S-TZ-DST        | Integration | P1  | E1     | R-002 | R   | The boundary, claim, backoff, resolution window and stale reads run twice, on a `TimeZone=UTC` session and on a `TimeZone=America/Chicago` session with `process.env.TZ=America/Chicago`, with clocks across 2026-11-01 and 2027-03-14. All results match. The 2026-11-05 probe shows a JS `Date` parameter shifts by 6 hours on the Chicago session. |
| I-S-OUTAGE        | Integration | P0  | E1, S1 | R-005 | R   | First sweep after the due time writes `breached` only.                                                                                                                                                                                                                                                                                                |
| I-S-SUPERSEDE     | Integration | P0  | S3     | R-006 | R   | An unsent `at_risk` reaching the due time becomes `superseded` in the same sweep that writes and sends `breached`. Detection precedes delivery.                                                                                                                                                                                                       |
| I-S-NEW-REPORT    | Integration | P1  | S1     | R-005 | R   | A new report on a resolved case gets fresh alerts at its own window. A later report on an alerted open case adds no alert and moves `reportCount`.                                                                                                                                                                                                    |
| I-S-NO-REOPEN     | Unit        | P1  | E1     | R-005 | G   | Scan of `apps/api/src`: no `data` clause and no raw SQL sets `resolved_at` to null, pinning D2.                                                                                                                                                                                                                                                       |
| I-S-PARTIAL       | Integration | P2  | E1     | R-018 | R   | `resolveReport` on the anchor: the next open report alerts under its own key. `resolveReport` has no production caller today (TEA-19).                                                                                                                                                                                                                |
| I-S-REKEY         | Integration | P1  | S1     | R-018 | R   | `post.X` with three reports and the first alerted goes through the real erasure path: the alerted orphan does not re-alert and the other two alert once each.                                                                                                                                                                                         |
| I-S-REKEY-COMMENT | Integration | P2  | S1     | R-018 | R   | The same for `comment.X` through `eraseCommunityComments` and the `SetNull` foreign key.                                                                                                                                                                                                                                                              |
| I-S-MONITOR       | Integration | P1  | E3     | R-015 | R   | The singleton row is created at the first completed sweep and stamped at each later one with the channel value; a failed sweep leaves it.                                                                                                                                                                                                             |
| I-S-FLAG-OFF      | Integration | P0  | S8     | R-013 | R   | Each flag combination with a Prisma query log: the only table read is `FeatureFlag` (TEA-20), with zero queries on reports and alerts, zero POSTs, zero PostHog calls and no monitor row.                                                                                                                                                             |
| I-S-FLAG-OUTAGE   | Integration | P1  | S8     | R-013 | R   | Remote throws and the fallback read fails: `getFeatureFlag` returns the default false, the sweep does nothing, the route answers 503 and the row goes stale (TEA-05).                                                                                                                                                                                 |

### Integration: dedup and concurrency (`apps/api/integration/moderation-sla-concurrency.integration.spec.ts`, `support/moderation-sla-crash-worker.mjs`)

| ID                   | Level       | Pri | AC     | Risk  | Red | Scenario                                                                                                                                                                                                                                                          |
| -------------------- | ----------- | --- | ------ | ----- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-D-RETRY            | Integration | P0  | E2, S2 | R-004 | R   | The same sweep twice on a fixed clock: one row per key and one POST per alert.                                                                                                                                                                                    |
| I-D-RESTART          | Integration | P0  | E2, S2 | R-004 | R   | A new sweep instance on a new `PrismaClient` over the same state writes and sends nothing new.                                                                                                                                                                    |
| I-D-CONCURRENT       | Integration | P0  | E2, S2 | R-004 | R   | Two sweeps on two clients over 20 cases, released together by a latch: one row per key, and the capture server sees each alert id once.                                                                                                                           |
| I-D-SKIP-LOCKED      | Integration | P0  | E2, S2 | R-004 | R   | A test transaction holds one alert row lock: the sweep does not wait on it, delivers the rest, and delivers the held row at the next sweep after release.                                                                                                         |
| I-D-LEASE            | Integration | P0  | E2, S2 | R-004 | R   | A claimed row is skipped at lease plus 0 ms and reclaimed at lease plus 1 ms on the injected clock, with `attempts` incremented at claim.                                                                                                                         |
| I-D-CRASH-AFTER-POST | Integration | P0  | E2, S2 | R-004 | R   | A child process running the real sweep and adapter is killed with SIGKILL while the capture server holds the POST. After the lease a new sweep resends with the same `id` and `Idempotency-Key`, and the row ends `delivered`. This pins the at-least-once bound. |
| I-D-NO-TX-OVER-POST  | Integration | P0  | E2     | R-004 | R   | While the capture server holds a POST, `SELECT ... FOR UPDATE NOWAIT` on that row succeeds, proving no transaction spans the send (TEA-01).                                                                                                                       |
| I-D-FENCE            | Integration | P0  | E2     | R-004 | R   | A stale claimant writing a failure after a later claimant wrote `delivered` changes nothing, because the write is fenced on the claimed `attempts` value (TEA-01).                                                                                                |
| I-D-DELIVERED-ONCE   | Integration | P0  | E2, S2 | R-004 | R   | After `delivered`, three more sweeps across an expired lease send nothing.                                                                                                                                                                                        |
| I-D-BULLMQ           | Integration | P1  | E1, E2 | R-004 | R   | A real `maintenance` worker on a namespaced queue and real Redis: an injected first-attempt database fault is retried by `attempts: 3`, with one row per key. The `failed` hook writes a `JobFailure` row whose message has no URL (TEA-13).                      |
| I-D-BACKLOG-SLOW     | Integration | P1  | E2     | R-017 | R   | 30 pending alerts against a hanging capture server with a short injected timeout and a second sweep running: no alert is sent twice, the budget ends the claim loop, and the monitor is stamped.                                                                  |

### Integration: delivery and failure (`apps/api/integration/moderation-sla-delivery.integration.spec.ts`, real Postgres, real `node:http` capture server, real adapter)

| ID                    | Level       | Pri | AC      | Risk  | Red | Scenario                                                                                                                                                                                                                                       |
| --------------------- | ----------- | --- | ------- | ----- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-W-REAL-THREE-KINDS  | Integration | P0  | E2, S4  | R-010 | R   | `at_risk`, `breached` and `escalated` each arrive as a real HTTP request. The body parses under the strict payload schema, the header carries the alert id, the row is `delivered` with `delivered_at`, and no fake channel is in the graph.   |
| I-W-REKEY-PAYLOAD     | Integration | P0  | S1, S4  | R-005 | R   | A pending alert whose case was re-keyed by erasure links the case as it stands now.                                                                                                                                                            |
| I-W-RESOLVED-DECISION | Integration | P1  | S3      | R-006 | R   | A real terminal decision between two sweeps supersedes the alert and sends nothing.                                                                                                                                                            |
| I-W-THIRD-FAILURE     | Integration | P0  | E2, S5  | R-009 | R   | A server answering 500: attempts 1 and 2 write a warn log and a counter. Attempt 3 writes exactly one `JobFailure` with the D9 fields, one error log and one PostHog event. Attempts 4 and 5 add none. Two concurrent escalations add one row. |
| I-W-CLAIM-FAILS       | Integration | P0  | E2, E3  | R-015 | R   | A raising trigger on the claim write rejects the run with fixed text, leaves the stamp and the snapshot, and the page goes stale. An outcome-write fault finishes the batch and then fails the run. The general worker retries it (CX-3).      |
| I-W-OWED-ESCALATION   | Integration | P0  | E2, S5  | R-009 | R   | An owed failure record survives a later delivery, a supersede, a console-only turn and a crash after the third failure, exactly once. A success at attempt three owes nothing (CX-4).                                                          |
| I-O-TRACE-SECRET      | Integration | P0  | S4      | R-008 | R   | The real SDK and the real adapter: the webhook URL reaches no trace, metric or log on success or failure, with a plain fetch as the control that tracing is live (CX-1).                                                                       |
| U-S-LAST-MEASURED     | Unit        | P1  | S10     | R-021 | R   | The measurement time is published only after the counts read succeeded, so a flag or a failure leaves gauges reading as stale (CX-5).                                                                                                          |
| I-W-RECOVERS          | Integration | P0  | E2, S5  | R-009 | R   | After the third failure the server answers 200: the row is `delivered`, `last_error_code` clears, the `JobFailure` row stays, and no operator step was involved.                                                                               |
| I-W-CODES-REAL        | Integration | P1  | S5      | R-009 | R   | Real responses give the closed codes: 500, 404, 302 with its target server hit zero times, a hanging socket with a short timeout, and a closed port.                                                                                           |
| I-W-CRASH-LOOP        | Integration | P0  | E2, S5  | R-009 | R   | Three claims that never finish: the next claim records `interrupted` and writes one `JobFailure`. A crash loop writes no failure of its own, so this path is the only signal (TEA-04).                                                         |
| I-W-RECORD-FAILS      | Integration | P1  | S5      | R-009 | R   | A raising trigger on `JobFailure` insert: the stamp stays null and `moderation_sla_failure_record_failed` is logged. With the trigger dropped, the next attempt writes the row.                                                                |
| I-W-BACKOFF-HONORED   | Integration | P1  | S5      | R-009 | R   | A sweep before `next_attempt_at` sends nothing, and a sweep at exactly `next_attempt_at` sends.                                                                                                                                                |
| I-W-NO-CHANNEL        | Integration | P0  | S6      | R-009 | R   | URL unset: the claimed alert is `console_only`, no failure and no `JobFailure`, and `monitor.channel` is `console`. Setting the URL later replays nothing and the next new alert sends (TEA-11).                                               |
| I-W-BAD-CONFIG        | Integration | P0  | S5      | R-009 | R   | A non-HTTPS, non-loopback URL pointing at a listening server: zero requests reach it, the code is `invalid_config`, and the third attempt escalates.                                                                                           |
| I-W-BACKLOG           | Integration | P0  | S3      | R-006 | R   | Flag opens with a backlog: closed cases and past-due `at_risk` rows become `superseded` and live ones send. Relevance runs before the channel check, with the URL set and unset (TEA-11).                                                      |
| I-W-RESOLVED          | Integration | P0  | S3      | R-006 | R   | A real terminal decision between detection and the next sweep: zero POSTs and the row is `superseded`.                                                                                                                                         |
| I-W-DRILL             | Integration | P2  | S11     | R-023 | R   | `moderation:sla:drill --local` (`apps/api/integration/moderation-sla-operations.spec.ts`): one `kind: drill` payload and exit 0; a 500 server exits non-zero; a database probe shows no table touched.                                         |
| I-O-OTLP              | Integration | P1  | E3, S10 | R-021 | R   | A real sweep with the SDK started and a local OTLP capture server: the four metric names arrive and every attribute is in the closed label set, following `observability.integration.spec.ts`.                                                 |

### Integration: privacy (same file, one canary seed)

| ID                 | Level       | Pri | AC  | Risk  | Red | Scenario                                                                                                                                                                                                                                                                                                       |
| ------------------ | ----------- | --- | --- | ----- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-P-CANARY         | Integration | P0  | S4  | R-007 | R   | Canaries in `details`, caption, comment body, alias, image path, decision reason, reporter id, subject id and a markup string. After success, failure and escalation runs, a scan of the request bodies and headers, pino stream, PostHog spy, `JobFailure`, every alert column and the route JSON finds none. |
| I-P-WEBHOOK-SECRET | Integration | P0  | S4  | R-008 | R   | A canary token URL through every failure path, plus a credentials URL whose raw `fetch` error text prints the full URL per the 2026-11-05 probe: the token is absent from the same surfaces and from `last_error_code`.                                                                                        |
| I-P-ANALYTICS      | Integration | P0  | S4  | R-007 | R   | Every captured event has exactly the allowed property keys, the fixed distinct id and no case id.                                                                                                                                                                                                              |

### Integration: escalate (`apps/api/integration/moderation-sla-escalate.integration.spec.ts`)

| ID                     | Level       | Pri | AC     | Risk  | Red | Scenario                                                                                                                                                                   |
| ---------------------- | ----------- | --- | ------ | ----- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-E-ATOMIC             | Integration | P0  | S7     | R-011 | R   | One escalate through HTTP commits one decision, one audit row and one `escalated` alert keyed `escalated:<decisionId>`, with delivery `pending`.                           |
| I-E-ROLLBACK           | Integration | P0  | S7     | R-011 | R   | A raising trigger on the alert insert: 503 `audit_unavailable`, no decision, no audit and no alert. With the trigger dropped, the same `mutationId` succeeds (TEA-07).     |
| I-E-REPLAY             | Integration | P0  | S7     | R-011 | R   | A sequential replay returns the stored response with no new alert.                                                                                                         |
| I-E-REPLAY-RACE        | Integration | P1  | S7     | R-011 | R   | Concurrent identical requests produce one decision and one alert.                                                                                                          |
| I-E-REESCALATE         | Integration | P0  | S7     | R-011 | R   | Escalate, terminal, new report, escalate: two alerts under two keys. A second escalate on an escalated case is refused `already_escalated` and writes none.                |
| I-E-PARITY             | Integration | P0  | S7     | R-011 | R   | For post and comment cases, with a finding and with the reporter bump, the alert anchor, due time, source and risk equal the `listCases` row at the same instant (TEA-08). |
| I-E-FLAG-OFF           | Integration | P1  | S7, S8 | R-011 | R   | Monitoring flag off: the row is written and the decision succeeds. The sweep sends nothing until the flag opens, then a live case sends and a closed one supersedes.       |
| I-E-NEXT-SWEEP         | Integration | P1  | E2, S7 | R-010 | R   | An escalated alert reaches the capture server at the next sweep. A case both escalated and breached gets two alerts.                                                       |
| I-E-ORPHAN             | Integration | P2  | S7     | R-018 | R   | Escalating an orphan case anchors on its one report; re-keying `post.X` after an escalate leaves the alert linked to the live orphan case.                                 |
| I-E-DECISION-UNCHANGED | Integration | P0  | S7     | R-011 | G   | The 6.11 decision response, `moderation-decisions*.integration.spec.ts` and the 6.10 queue order specs stay green with no assertion edited except one added row count.     |

### Integration: route (`apps/api/integration/moderation-sla-route.integration.spec.ts`)

| ID               | Level | Pri | AC     | Risk  | Red | Scenario                                                                                                                                                                                                                                            |
| ---------------- | ----- | --- | ------ | ----- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-R-HTTP         | API   | P0  | E3, S8 | R-012 | R   | Real Nest app: no token 401; guardian and teen 403 with the 6.10 body in each flag state; moderator 503 with either flag off; moderator and admin 200, parsed by the strict schema.                                                                 |
| I-R-HEADERS      | API   | P0  | S8     | R-012 | R   | 200, 401, 403 and 503 all carry `Cache-Control: private, no-store` and `Vary: Authorization`, which requires the controller in the `forRoutes` list.                                                                                                |
| I-R-COUNT-PARITY | API   | P0  | E3     | R-014 | R   | Over one seed, `onTrack`, `atRisk`, `breached` equal paging `listCases` per state at the same instant, boundary rows included. `escalated` equals the count of `escalated: true` queue items, orphans and terminal-cleared cases included (TEA-09). |
| I-R-NO-LOAD      | API   | P1  | E3     | R-014 | R   | Query log: counts run as aggregates, one statement each; no `AuditLog` row and no write of any kind.                                                                                                                                                |
| I-R-RESOLUTION   | API   | P1  | E3     | R-014 | R   | `resolved_at` equal to `sla_due_at` is within SLA; 1 ms later is late; the 7-day window edge is pinned on both sides; an escalation changes no count.                                                                                               |
| I-R-ALERT-COUNTS | API   | P1  | S5, S6 | R-014 | R   | `pending` counts all pending, `failing` counts pending rows with a `last_error_code`, and `consoleOnly` counts terminal console rows (TEA-09).                                                                                                      |
| I-R-RECENT       | API   | P1  | E3, S1 | R-014 | R   | 51 alerts return the newest 50 by `detected_at` then `id`. `caseId` is recomputed after a re-key and falls back to the stored `case_key` if the anchor row is gone (TEA-09).                                                                        |
| I-R-STALE        | API   | P0  | E3     | R-015 | R   | With no worker in the process: no monitor row, a fresh row, and a row at 5 minutes and 5 minutes plus 1 ms give the D11 `stale` values. Viewer flag on with the system subject off goes stale.                                                      |
| I-R-PENDING-AGE  | API   | P0  | E3     | R-015 | R   | `oldestPendingReviewAt` is the earliest `updated_at` of `pending_review` posts, the column the stale sweep reads, and null when none exist (TEA-09).                                                                                                |
| I-R-SANCTIONED   | API   | P2  | S8     | R-012 | R   | An operator under a sanction reads the route as the queue route allows, pinned so a later change is deliberate.                                                                                                                                     |

### Database (`packages/db/test/rls/moderation-queue.spec.ts`, `migration-hygiene.spec.ts`, new schema spec)

| ID        | Level | Pri | AC     | Risk  | Red | Scenario                                                                                                                                                                                                                           |
| --------- | ----- | --- | ------ | ----- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-SCHEMA  | DB    | P0  | S2, S4 | R-007 | R   | `dedupe_key` is unique and a duplicate raw insert fails. The enums are closed. The partial index exists. No column named for a reason, excerpt, alias, reporter, subject or URL exists. There is no foreign key to a report table. |
| D-RLS     | DB    | P0  | E3     | R-012 | R   | Both tables are in `MODERATION_QUEUE_READ_TABLES`; `anon` and `authenticated` are denied every privilege; RLS is on with zero policies.                                                                                            |
| D-HYGIENE | DB    | P1  | S12    | R-016 | R   | `migration-hygiene.spec.ts` passes, the migration is additive, and `prisma migrate diff` reports no drift.                                                                                                                         |

### Contract (`pact/http/`, OpenAPI)

| ID        | Level    | Pri | AC  | Risk | Red | Scenario                                                                                                                                          |
| --------- | -------- | --- | --- | ---- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-OPENAPI | Contract | P1  | S9  | -    | R   | The path, 401, 403 and 503 bodies are registered, and regeneration is clean with no existing model renamed.                                       |
| C-PACT    | Contract | P1  | S9  | -    | R   | Summary, 403 and 503 interactions through `createProviderState`, `setJsonContent` and `buildVerifierOptions`, with deterministic provider states. |

### Web units and components (`apps/web`)

| ID              | Level     | Pri | AC     | Risk  | Red | Scenario                                                                                                                                                     |
| --------------- | --------- | --- | ------ | ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U-WEB-CLIENT    | Unit      | P1  | S9     | R-019 | R   | `apps/web/src/lib/moderation.ts` parses through the contract and maps 401, 403, 503 and network failure to named states.                                     |
| U-WEB-NO-DIRECT | Unit      | P0  | S8     | R-012 | G   | `moderation-no-direct-access.test.ts` covers the new page and component with no edit, and fails if they are moved outside its scan.                          |
| U-WEB-LOCALES   | Unit      | P1  | S9     | R-019 | R   | `moderation-locales.spec.ts`: all ten locales hold `moderation.sla.*` with one label per contract enum, catalog parity holds and no value equals the key.    |
| C-WEB-STATES    | Component | P0  | S6, S9 | R-019 | R   | Loading, empty, error, forbidden, disabled and stale each render a distinct view; the channel-console-only notice renders with data; retry works from error. |
| C-WEB-NO-WRITE  | Component | P1  | S9     | R-019 | R   | The page holds no button that mutates: no POST client call exists and the only controls are links and retry.                                                 |
| C-WEB-LINKS     | Component | P1  | S9     | R-019 | R   | Each alert links to `/moderation/cases/<caseId>`, and the queue header links to `/moderation/sla`.                                                           |
| C-WEB-ANNOUNCE  | Component | P1  | S9     | R-019 | R   | One polite announcement per state change, and none on a refresh with equal data.                                                                             |
| C-WEB-LABELS    | Component | P1  | S9     | R-019 | R   | Every kind, delivery and failure code renders a human label, `interrupted` included, with no raw enum on screen.                                             |
| C-WEB-TIME      | Component | P2  | S9     | R-019 | R   | Relative times come from `serverNow`. Under `TZ=America/Chicago` a due time inside the repeated hour of 2026-11-01 renders one correct value.                |
| C-WEB-A11Y      | Component | P1  | S9     | R-019 | R   | Component axe on each state with table semantics and heading order.                                                                                          |

### End to end (`playwright/tests/moderation-sla.spec.ts`, `playwright/tests/api/auth-moderation-security.spec.ts`, `playwright/support/moderation-ops-capture.mjs`)

The local stack runs the real `community.bootstrap` process with seeded flags on, so a real sweep runs every 60 seconds during this file (TEA-14). Every assertion is scoped to the seeded case ids. No test asserts a global count.

| ID                  | Level | Pri | AC             | Risk  | Red | Scenario                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----- | --- | -------------- | ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P-SLA-REAL-DELIVERY | E2E   | P0  | E1, E2, S4, S7 | R-010 | R   | Seed one at-risk and one breached case, escalate a third in the real console, then wait through the playwright-utils webhook registry (`WireMockWebhookProvider`, `waitFor`, `matchField` on `casePath`), up to 150 seconds with no fixed sleep. All three kinds arrive from the real worker process with schema-valid bodies, and the dashboard shows them `delivered`. |
| P-SLA-HOSTED-PATH   | E2E   | P0  | E1             | R-003 | R   | Same run: the stack process list has `community.bootstrap` and no general bootstrap, so delivery proves the production interval path. The test fails if a general bootstrap is what delivered.                                                                                                                                                                           |
| P-SLA-ROLES         | E2E   | P0  | S8             | R-012 | R   | `auth-moderation-security.spec.ts` matrix: anonymous, guardian, teen, moderator and admin, with identical 403 bodies.                                                                                                                                                                                                                                                    |
| P-SLA-JOURNEY       | E2E   | P0  | E3, S9         | R-019 | R   | A moderator goes from the queue header to the SLA page, sees the seeded states, opens an alert and lands on its case.                                                                                                                                                                                                                                                    |
| P-SLA-AXE           | E2E   | P0  | S9             | R-019 | R   | Axe reports no serious or critical violation on the live page and on the stale, disabled and error states.                                                                                                                                                                                                                                                               |
| P-SLA-STABLE        | E2E   | P1  | S9             | R-020 | R   | Two consecutive sweeps during an open page cause no announcement change and no layout shift for unchanged data. The spec passes under `--repeat-each=3` with zero flakes.                                                                                                                                                                                                |
| P-SLA-STALE-UI      | E2E   | P1  | E3, S9         | R-015 | R   | `interceptNetworkCall` returns a stale response, because the live worker would overwrite a seeded stamp within 60 seconds. The banner renders and the rest of the page stays usable. I-R-STALE owns the real stale logic.                                                                                                                                                |
| P-SLA-THEMES-WIDTHS | E2E   | P1  | S9             | R-019 | R   | 375 and 1280 widths in light and dark: no horizontal overflow, 44-pixel targets, readable contrast, table reflow on mobile.                                                                                                                                                                                                                                              |
| P-SLA-LOCALE        | E2E   | P1  | S9             | R-019 | R   | The longest locale and one other render with no clipped label and no key text.                                                                                                                                                                                                                                                                                           |
| P-SLA-KEYBOARD      | E2E   | P1  | S9             | R-019 | R   | Tab order runs from the queue link through alerts, with a visible focus ring and skip link intact.                                                                                                                                                                                                                                                                       |

### Documents, dashboards and process

| ID             | Level  | Pri | AC      | Risk  | Red | Scenario                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ------ | --- | ------- | ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U-GF-METRICS   | Unit   | P1  | S10     | R-021 | R   | `couturecast-moderation-sla.json`: each `moderation_sla_` name in an `expr` is exported by `moderation-sla.telemetry.ts`, each exported metric has a panel, no case or member label appears, and the file adds no alert rule or notification policy.                                                                                                                            |
| U-RB-RUNBOOK   | Unit   | P1  | E3, S11 | R-022 | R   | Runbook checks: four role sections; a response section per alert kind; stale monitor, failing channel, webhook setup, drill, rollout and rollback sections; the coverage table has a blank assignee on every row; no email or at-handle pattern; D16 is stated as open; the `JobFailure` removal SQL and the `system:moderation-sla` rollout step are present (TEA-06, TEA-16). |
| U-RB-READINESS | Unit   | P1  | S11     | R-022 | G   | `scripts/generate-community-screening-readiness.mjs` and its signed artifacts are unchanged against the baseline, which keeps the owner signature hash valid (TEA-17).                                                                                                                                                                                                          |
| M-VISUAL       | Manual | P1  | S9      | R-019 | M   | One case per state on an isolated database with a real sweep: read the page as moderator and admin at 1280 and 375 in light and dark, with screenshots under `_bmad-output/test-artifacts/story-6-12/`.                                                                                                                                                                         |
| M-LGTM         | Manual | P1  | S10     | R-021 | M   | `npm run observability:local:up`, general worker, real sweep: every dashboard panel has data, with a screenshot.                                                                                                                                                                                                                                                                |
| M-STOP-WORKER  | Manual | P1  | E3      | R-015 | M   | Stop the worker with the API up: the stale banner appears after 5 minutes.                                                                                                                                                                                                                                                                                                      |
| M-POSTHOG      | Manual | P2  | S10     | R-024 | M   | The PostHog dashboard exists. The absence alert exists disabled, or its unavailability is written down. Ids are in the runbook.                                                                                                                                                                                                                                                 |
| M-IMAGE        | Manual | P1  | E1      | R-016 | M   | `node scripts/prune-community-worker-deps.mjs --out <tmp> --max-node-modules-mb 150` on a built checkout passes, and `git grep` of the changed exports across `scripts/`, `package.json` and Dockerfile CMD finds no broken caller. No CI job runs the prune today.                                                                                                             |
| M-BUDGET       | Manual | P2  | S12     | -     | M   | `git diff --name-only main...                                                                                                                                                                                                                                                                                                                                                   | wc -l`is under 100 as the goal, and the`Workspace coverage (api)`shard stays well under its 15-minute limit (7.7 minutes on the last green`pr-checks` run read on 2026-11-05). |

### Generated totals

| Measure           | Count |
| ----------------- | ----- |
| Scenarios         | 132   |
| Priority P0       | 67    |
| Priority P1       | 55    |
| Priority P2       | 10    |
| Level Unit        | 39    |
| Level Integration | 55    |
| Level API         | 10    |
| Level DB          | 3     |
| Level Contract    | 2     |
| Level Component   | 7     |
| Level E2E         | 10    |
| Level Manual      | 6     |
| Red-first         | 122   |
| Green guards      | 4     |
| Manual            | 6     |

---

## Test Coverage Plan (risk-linked)

Priority criteria, used as written:

- P0: critical business, security, data-integrity or compliance impact with no safe workaround.
- P1: core or complex behavior with material reach and a limited workaround.
- P2: secondary behavior with narrower reach and an acceptable workaround.
- P3: rare or cosmetic. No item fits: cosmetic checks sit inside the console risk, whose reader is the moderator on a stale monitor.

Each scored risk has one row under the priority of its consequence.
The row level is where the failure first becomes observable.
A scenario's own priority in the catalog can sit below its risk's row, and the gate reads the catalog priority.
Silent-failure risks stay P0 because the epic mandates the control, and the only workaround is someone already reading the console, which is the problem the story states.

### P0 (Critical)

Run on every PR. Pass rate 100 percent.

| Requirement                                       | Test Level  | Risk Link | Test Count | Owner | Notes                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ----------- | --------- | ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| State at each boundary matches the one definition | Integration | R-001     | 3          | TEA   | Wrong state from two clocks and two definitions crosses the database boundary. Consequence: a safety report passes 24 hours unnoticed. Workaround: none while the console is closed, which is the problem the story states. Scenarios: U-S-BOUNDARY, U-S-NO-THRESHOLD, I-S-BOUNDARY.                                                                   |
| The hosted process runs the sweep                 | E2E         | R-003     | 5          | TEA   | Spans the worker process, the database and the receiver. Consequence: no alert ever in production. Workaround: none, the stale banner shows only to someone already reading the console. Scenarios: U-W-ROUTE, U-W-SCHEDULER, U-W-INTERVAL, U-W-FACTORY, P-SLA-HOSTED-PATH.                                                                            |
| Every case in the window gets its alert           | Integration | R-005     | 5          | TEA   | Paging and keys cross the database boundary. Consequence: a silent case. Workaround: none while the console is closed. Scenarios: I-S-PAGING, I-S-ANCHOR, I-S-OUTAGE, I-S-NEW-REPORT, I-S-NO-REOPEN.                                                                                                                                                   |
| No private data on any alert surface              | Integration | R-007     | 7          | TEA   | Row content crossing into payload, log and analytics surfaces. Consequence: private reporter or subject data leaves the system, with no recall from a third party. Workaround: none. Scenarios: U-C-RESPONSE-STRICT, U-C-PAYLOAD-STRICT, U-S-RESULT-SAFE, U-CH-PAYLOAD, I-P-CANARY, I-P-ANALYTICS, D-SCHEMA.                                           |
| The webhook URL stays secret                      | Unit        | R-008     | 3          | DEV   | The failure lives inside the adapter with no boundary crossed. Consequence: a secret in logs forces a rotation. Workaround: rotation, after exposure. Scenarios: U-CH-CONFIG, U-CH-NO-SECRET, I-P-WEBHOOK-SECRET.                                                                                                                                      |
| A failing channel escalates and recovers          | Integration | R-009     | 11         | TEA   | Attempts, stamp and `JobFailure` cross the database boundary. Consequence: alerts stop and nobody knows. Workaround: none, the source mandates the control. Scenarios: U-S-ISOLATION, U-S-BACKOFF, U-CH-CODES, I-W-THIRD-FAILURE, I-W-RECOVERS, I-W-CODES-REAL, I-W-CRASH-LOOP, I-W-RECORD-FAILS, I-W-BACKOFF-HONORED, I-W-NO-CHANNEL, I-W-BAD-CONFIG. |
| Alert tests prove a real delivery                 | E2E         | R-010     | 4          | TEA   | Proof spans a process and a receiver. Consequence: a broken channel ships as verified. Workaround: the drill, run by hand. Scenarios: U-CH-REQUEST, I-W-REAL-THREE-KINDS, I-E-NEXT-SWEEP, P-SLA-REAL-DELIVERY.                                                                                                                                         |
| Escalate and its alert commit together            | Integration | R-011     | 8          | DEV   | One transaction across one store. Consequence: a false append-only record or a lost escalation, with no recovery once 6.13 protects rows. Workaround: none. Scenarios: I-E-ATOMIC, I-E-ROLLBACK, I-E-REPLAY, I-E-REPLAY-RACE, I-E-REESCALATE, I-E-PARITY, I-E-FLAG-OFF, I-E-DECISION-UNCHANGED.                                                        |
| Moderator-only route and tables                   | API         | R-012     | 7          | TEA   | HTTP boundary of one service. Consequence: case counts and ids exposed to members. Workaround: none. Scenarios: U-R-ORDER, I-R-HTTP, I-R-HEADERS, I-R-SANCTIONED, D-RLS, U-WEB-NO-DIRECT, P-SLA-ROLES.                                                                                                                                                 |
| Flags off means no read, write or send            | Integration | R-013     | 5          | DEV   | Flag read then table access in one process. Consequence: production writes and sends before rollout. Workaround: none, production values are the rollout control. Scenarios: U-S-FLAG-ORDER, U-S-FLAG-THROW, U-F-REGISTRY, I-S-FLAG-OFF, I-S-FLAG-OUTAGE.                                                                                              |
| A dead worker shows on the dashboard              | API         | R-015     | 7          | TEA   | HTTP contract read with no worker. Consequence: a dead worker reads as healthy. Workaround: none from the outside, BH18 names this gap. Scenarios: U-S-SWEEP-FAILS, U-R-STALE, I-S-MONITOR, I-R-STALE, I-R-PENDING-AGE, P-SLA-STALE-UI, M-STOP-WORKER.                                                                                                 |
| The community image stays intact                  | Integration | R-016     | 3          | DEV   | File and import graph inside one build. Consequence: screening stops and posts stall. Workaround: redeploy the old image, after an outage. Scenarios: U-W-IMAGE-GRAPH, D-HYGIENE, M-IMAGE.                                                                                                                                                             |

**Total P0 catalog scenarios**: 63.

### P1 (High)

Run on every PR. Pass rate at least 95 percent, every failure triaged before merge.

| Requirement                                                                                                                                      | Test Level  | Risk Link | Test Count | Owner | Notes                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | --------- | ---------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comparisons hold under any session time zone                                                                                                     | Integration | R-002     | 3          | DEV   | Session offset applies in the database boundary. Consequence: alerts hours late. Workaround: Supabase sessions run UTC today, unguaranteed by the repo. Scenarios: U-S-CLOCK, U-S-NO-DB-CLOCK, I-S-TZ-DST.                                                                                                                              |
| Retry, restart and concurrency keep one row and one send                                                                                         | Integration | R-004     | 10         | DEV   | Lease and row locks live in Postgres. Consequence: a repeated send with a stable id, recoverable by the receiver. Workaround: the `Idempotency-Key`. Scenarios: I-D-RETRY, I-D-RESTART, I-D-CONCURRENT, I-D-SKIP-LOCKED, I-D-LEASE, I-D-CRASH-AFTER-POST, I-D-NO-TX-OVER-POST, I-D-FENCE, I-D-DELIVERED-ONCE, I-D-BULLMQ.               |
| Nothing is sent for a closed case                                                                                                                | Integration | R-006     | 4          | DEV   | Reload crosses the database boundary. Consequence: noise only. Workaround: the console shows the truth. Scenarios: U-S-RELEVANCE, I-S-SUPERSEDE, I-W-BACKLOG, I-W-RESOLVED.                                                                                                                                                             |
| Dashboard counts match the queue                                                                                                                 | API         | R-014     | 5          | TEA   | HTTP contract of one service. Consequence: wrong counts on a dashboard. Workaround: the queue itself. Scenarios: I-R-COUNT-PARITY, I-R-NO-LOAD, I-R-RESOLUTION, I-R-ALERT-COUNTS, I-R-RECENT.                                                                                                                                           |
| A slow backlog stays bounded                                                                                                                     | Integration | R-017     | 2          | DEV   | Long sweep against the database and channel. Consequence: a false stale banner and delayed sweeps. Workaround: the next sweep recovers. Scenarios: U-S-BUDGET, I-D-BACKLOG-SLOW.                                                                                                                                                        |
| Console states, locales and accessibility                                                                                                        | Component   | R-019     | 16         | TEA   | One rendered page. Consequence: a moderator misses a state. Workaround: the queue countdown. Scenarios: U-C-ENUMS, U-WEB-CLIENT, U-WEB-LOCALES, C-WEB-STATES, C-WEB-NO-WRITE, C-WEB-LINKS, C-WEB-ANNOUNCE, C-WEB-LABELS, C-WEB-TIME, C-WEB-A11Y, P-SLA-JOURNEY, P-SLA-AXE, P-SLA-THEMES-WIDTHS, P-SLA-LOCALE, P-SLA-KEYBOARD, M-VISUAL. |
| E2E stays stable beside a live sweep                                                                                                             | E2E         | R-020     | 1          | TEA   | Live sweep across the stack and the runner. Consequence: flaky PR gates. Workaround: reruns, which the quality bar refuses. Scenarios: P-SLA-STABLE.                                                                                                                                                                                    |
| Dashboard metrics exist and export                                                                                                               | Unit        | R-021     | 4          | DEV   | A name check with no boundary crossed. Consequence: empty panels. Workaround: PostHog events and the console. Scenarios: U-W-OTEL, I-O-OTLP, U-GF-METRICS, M-LGTM.                                                                                                                                                                      |
| The runbook claims only what is true                                                                                                             | Unit        | R-022     | 2          | DEV   | Document content with no boundary crossed. Consequence: a false gate claim. Workaround: the release owner reads it. Scenarios: U-RB-RUNBOOK, U-RB-READINESS.                                                                                                                                                                            |
| The path, 401, 403 and 503 bodies are registered, and regeneration is clean with no existing model renamed                                       | Contract    | -         | 1          | TEA   | C-OPENAPI                                                                                                                                                                                                                                                                                                                               |
| Summary, 403 and 503 interactions through `createProviderState`, `setJsonContent` and `buildVerifierOptions`, with deterministic provider states | Contract    | -         | 1          | TEA   | C-PACT                                                                                                                                                                                                                                                                                                                                  |

**Total P1 catalog scenarios**: 53.

### P2 (Medium)

Run on every PR. Pass rate at least 90 percent.

| Requirement                         | Test Level  | Risk Link | Test Count | Owner | Notes                                                                                                                                                                                      |
| ----------------------------------- | ----------- | --------- | ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Erasure re-key alerts correctly     | Integration | R-018     | 4          | DEV   | Re-key through the database. Consequence: one extra alert or a stale link. Workaround: the queue shows the orphan cases. Scenarios: I-S-PARTIAL, I-S-REKEY, I-S-REKEY-COMMENT, I-E-ORPHAN. |
| The drill touches nothing else      | Integration | R-023     | 1          | DEV   | Script against one receiver and one store. Consequence: a stray drill row or message. Workaround: delete it. Scenarios: I-W-DRILL.                                                         |
| Analytics stay correct and harmless | Unit        | R-024     | 3          | DEV   | Pure throttle and emit logic. Consequence: a skewed chart. Workaround: the console. Scenarios: U-S-SNAPSHOT, U-S-RECORDED, M-POSTHOG.                                                      |
| `git diff --name-only main          | Manual      | -         | 1          | TEA   | M-BUDGET                                                                                                                                                                                   |

**Total P2 catalog scenarios**: 10.

### P3 (Low)

No scenario. See the criteria above.

---

## Explicit negative tests

Each is a scenario above, listed because the review asked for it by name.

| Question from the brief                      | Scenarios                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| Exact at-risk and breach boundaries          | U-S-BOUNDARY, I-S-BOUNDARY                                                    |
| Clock source                                 | U-S-CLOCK, U-S-NO-DB-CLOCK                                                    |
| Time zone and DST                            | I-S-TZ-DST, C-WEB-TIME                                                        |
| Resolved or reopened between sweeps          | I-W-RESOLVED, I-S-SUPERSEDE, I-S-NEW-REPORT, I-S-NO-REOPEN                    |
| Retry safety                                 | I-D-RETRY, I-D-BULLMQ, I-D-FENCE                                              |
| Dedup across restarts and concurrent workers | I-D-RESTART, I-D-CONCURRENT, I-D-SKIP-LOCKED, I-D-LEASE, I-D-CRASH-AFTER-POST |
| Delivery failure and its escalation          | I-W-THIRD-FAILURE, I-W-CRASH-LOOP, I-W-RECORD-FAILS, I-W-RECOVERS             |
| The 6.11 escalate decision                   | I-E-\*                                                                        |
| Flag off                                     | U-S-FLAG-ORDER, I-S-FLAG-OFF, I-S-FLAG-OUTAGE, I-E-FLAG-OFF                   |
| Authorization on the route and dashboards    | U-R-ORDER, I-R-HTTP, I-R-HEADERS, D-RLS, P-SLA-ROLES                          |
| Reporter and subject privacy                 | I-P-CANARY, I-P-ANALYTICS, U-C-RESPONSE-STRICT, D-SCHEMA                      |
| Alert tests prove a real delivery            | I-W-REAL-THREE-KINDS, I-E-NEXT-SWEEP, P-SLA-REAL-DELIVERY, S-16               |

---

## Test data and harness

- **Seed:** extend `moderation-queue-seed.ts` with `seedSlaCase({ state, source, now })`, computing `dueAt` from the contract constants, so one seed serves integration, Playwright and the manual check.
- **Clock:** a mutable test clock passed to the sweep class. Boundary tests never read wall time.
- **Capture server:** one helper around `node:http` for integration, recording body and headers, with script modes for status, a hanging socket and a latch.
  Integration tests assert only on what the socket received.
- **Crash worker:** `apps/api/integration/support/moderation-sla-crash-worker.mjs`, following `community-crash-worker.mjs`, runs the real sweep and adapter. The parent kills it with SIGKILL on the POST, through `ownedChild`.
- **Fault injection:** a real `BEFORE INSERT` trigger that raises, created and dropped in the test, in the same transaction order the code uses.
  This proves the mapping and the rollback with no mock of Prisma.
- **Session time zone:** a second `PrismaClient` with `?options=-c%20TimeZone%3DAmerica%2FChicago`.
- **Live worker in Playwright:** assertions scope to seeded case ids, webhook waits use the registry with `matched-only` cleanup, other polling uses `recurse`, and no test uses a fixed sleep.
- **Database:** isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true` for every Playwright run. Integration uses a database created at `127.0.0.1:54339`, leaving `cc610_tea_e2e` and `cc610_tea_rls` alone.

### File plan against the budget

Integration: `moderation-sla`, `-concurrency`, `-delivery`, `-escalate`, `-route`, plus one crash worker.
API units: rules with channel, and controller. The scheduler spec is in `maintenance.scheduler.spec.ts`.
Playwright: `moderation-sla.spec.ts`, the security spec, `local.config.ts`, the capture script.
API tier: `moderation-sla-operations.spec.ts`, because `scripts/*.test.mjs` runs only in the native workflow gate.
The branch ends at 100 changed files, the most CodeRabbit reviews, after folding four specs and the test review into existing files.

---

## Execution Strategy

| Lane                         | Content                                                   | Budget                                                                 |
| ---------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `Workspace coverage (api)`   | API units and integration, on injected clocks and latches | Under 2 minutes added to a 7.7-minute run, against a 15-minute limit   |
| `Workspace coverage (other)` | Contract, web units and components, locales, RLS          | Under 1 minute added                                                   |
| `contract-testing`           | C-PACT with determinism, C-OPENAPI                        | Under 2 minutes added                                                  |
| `pr-pw-e2e-local`            | P-SLA-\* in one file, chromium, 375 and 1280              | Under 4 minutes added, one test may wait up to 150 seconds for a sweep |
| Local                        | S-1 to S-17, M-\*                                         | Before PR review                                                       |

During multi-peer work, use `npm exec -- vitest run` and `npm exec -- tsc --noEmit -p`, and announce any `npm run`.

---

## Red-first plan and seeded-defect proofs

**Order of work for the builder.**

1. Migration, then D-SCHEMA and D-RLS red against missing tables.
2. Contract schemas, then U-C-RESPONSE-STRICT, U-C-PAYLOAD-STRICT and U-C-ENUMS red.
3. `seedSlaCase` and the capture helper, then I-S-BOUNDARY, I-S-PAGING, I-S-ANCHOR and I-W-REAL-THREE-KINDS red against a missing sweep. A missing module is the right failure.
4. U-S-_ and U-CH-_ red, then the sweep and adapter until green. I-S-TZ-DST, I-D-NO-TX-OVER-POST, I-D-FENCE and I-W-CRASH-LOOP come before the code they guard, since each encodes a ruling.
5. I-E-\* red, then the decision hook. I-E-ROLLBACK comes before the insert is written.
6. U-W-\* red, then both trigger paths. U-W-IMAGE-GRAPH before the runtime factory changes.
7. U-R-_ and I-R-_ red, then the route.
8. Component tests red against contract fixtures, then the page.
9. Pact and Playwright last, red because the route and page do not exist. P-SLA-REAL-DELIVERY is the final proof.

`G` rows (I-S-NO-REOPEN, I-E-DECISION-UNCHANGED, U-WEB-NO-DIRECT, U-RB-READINESS) start green and stay green.

**Seeded-defect proofs.**
Each proof breaks the finished implementation in a throwaway `git worktree` with `node_modules` symlinked, confirms the named test goes red for the stated reason, and records the result in the Execution record below.
No stash, checkout of paths or reset in the shared checkout.

| Proof | Defect seeded                                           | Must fail                                 |
| ----- | ------------------------------------------------------- | ----------------------------------------- |
| S-1   | A 7-hour window literal in the sweep                    | U-S-NO-THRESHOLD, I-S-BOUNDARY            |
| S-2   | `remaining < 0` for breached                            | U-S-BOUNDARY, I-S-BOUNDARY                |
| S-3   | A `Date` parameter in the claim query                   | I-S-TZ-DST                                |
| S-4   | Plain insert with no conflict clause                    | I-D-RETRY, I-D-CONCURRENT                 |
| S-5   | Claim without `SKIP LOCKED`                             | I-D-SKIP-LOCKED                           |
| S-6   | POST inside the claim transaction                       | I-D-NO-TX-OVER-POST                       |
| S-7   | Outcome write without the `attempts` fence              | I-D-FENCE                                 |
| S-8   | Relevance reload removed                                | I-W-RESOLVED, I-W-BACKLOG                 |
| S-9   | Log the raw `fetch` error message                       | I-P-WEBHOOK-SECRET                        |
| S-10  | `excerpt` added to the payload                          | U-C-PAYLOAD-STRICT, I-P-CANARY            |
| S-11  | Alert insert after the decision transaction commits     | I-E-ROLLBACK                              |
| S-12  | `JobFailure` written on every failure past the third    | I-W-THIRD-FAILURE                         |
| S-13  | Interval schedule removed from `community.bootstrap.ts` | U-W-INTERVAL, P-SLA-REAL-DELIVERY         |
| S-14  | SLA controller left out of `forRoutes`                  | I-R-HEADERS                               |
| S-15  | Flag check moved after detection                        | U-S-FLAG-ORDER, I-S-FLAG-OFF              |
| S-16  | Adapter returns `delivered` with no request             | I-W-REAL-THREE-KINDS, P-SLA-REAL-DELIVERY |
| S-17  | `instrumentation` imported from the sweep               | U-W-IMAGE-GRAPH                           |

---

## Quality Gate Criteria

### Pass/Fail Thresholds

- P0: 100 percent pass.
- P1: 95 percent pass at merge, every failure triaged.
- P2: 90 percent pass, informational.
- Flake: zero tolerated. A race test that flakes is a harness defect and blocks merge.
- All seventeen seeded-defect proofs recorded.
- High-risk mitigations complete before the PR leaves review.

### Coverage Targets

- Every acceptance criterion (E1 to E3, S1 to S12) maps to at least one P0 or P1 test, or a named manual check (see Traceability).
- Every closed code and enum in the contract has a test that produces it from real state.
- Statement coverage on `moderation-sla.*` at or above 80 percent.
- NFR status stays with `bmad-tea-nfr`.

### Non-Negotiable Requirements

- One SLA definition, imported.
- No reason, excerpt, alias, reporter, subject or webhook URL on any alert surface.
- A delivered alert is sent again only across the documented crash window, with the same id.
- A failing channel always reaches `JobFailure`, including a crash loop.
- With either flag off, the sweep writes and sends nothing.
- The document claims no production delivery and no staffing coverage.

---

## Execution record

Run on 2026-11-05 at `c01a506b`, the state after Codex round 1, on isolated Postgres at `127.0.0.1:54339` and Redis databases 6 and 7.

**Burn-in: three consecutive runs, each row identical on all three, no retries.**

| Tier                  | Scope                                                                             | Passed per run                                                              |
| --------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/api`            | The whole suite, units and integration                                            | 8343, with 38 skips in location and storage specs this story does not touch |
| `packages/api-client` | The whole suite                                                                   | 1624                                                                        |
| `packages/db`         | The whole suite, RLS and hygiene on a database migrated by Prisma                 | 282, with 1 skip                                                            |
| `packages/config`     | The whole suite                                                                   | 31                                                                          |
| `apps/web`            | The whole suite                                                                   | 1886                                                                        |
| Pact                  | Consumer 447, provider 1                                                          | 448                                                                         |
| Playwright            | `moderation-sla.spec.ts`, `auth-moderation-security.spec.ts`, chromium, retries 0 | 34                                                                          |

The first sign-off at `d93a8cfc` was wrong to rest on filtered runs.
It burned in only the moderation specs, so U-D-MODULE-WIRING, U-Q-READSET and the Prisma client guard stayed red from `413f5c4b` until the builder's whole-suite run found them.
Whole suites are the burn-in from now on.

`prisma migrate diff` from the migrated database to the schema reports no difference, which closes D-HYGIENE with the spec above.

**Where tests landed against the plan.**

- U-S-CLOCK, -BUDGET, -ISOLATION, -RESULT-SAFE, -FLAG-ORDER, -FLAG-THROW, -SWEEP-FAILS, -SNAPSHOT and -RECORDED run on real Postgres in the integration specs, which is stronger than the planned fakes.
- There is no `moderation-sla.sweep.spec.ts`. Pure rules, source scans and the adapter's spy-fetch tests are in `moderation-sla.rules.spec.ts`.
- U-RB-READINESS is a manual check: `git diff --stat 3efd8423` over the generator and its artifacts is empty.
- The ATDD checklist file is not written, following 6.10 and 6.11. Tests were watched failing directly and there are no `test.skip` scaffolds. Seeded defects below replace the checklist's proof role, and this keeps the story's file count down.

| Where it runs                                                                                                                                       | Scenarios                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-client/testing/moderation-sla-contract`                                                                                                        | U-C-RESPONSE-STRICT, U-C-PAYLOAD-STRICT, U-C-ENUMS, C-OPENAPI                                                                                                                                                                                                                                                                                                                                                  |
| `api/workers/bootstrap`, `api/workers/community.bootstrap`                                                                                          | U-W-OTEL                                                                                                                                                                                                                                                                                                                                                                                                       |
| `api/workers/bootstrap`, `api/workers/maintenance.scheduler`                                                                                        | U-W-SCHEDULER                                                                                                                                                                                                                                                                                                                                                                                                  |
| `api/workers/community.bootstrap`                                                                                                                   | U-W-INTERVAL                                                                                                                                                                                                                                                                                                                                                                                                   |
| `api/workers/maintenance.processor`                                                                                                                 | U-W-ROUTE                                                                                                                                                                                                                                                                                                                                                                                                      |
| `config/src/flags`, `db/test/moderation-console-flag-seed`                                                                                          | U-F-REGISTRY                                                                                                                                                                                                                                                                                                                                                                                                   |
| `db/test/migration-hygiene`                                                                                                                         | D-HYGIENE                                                                                                                                                                                                                                                                                                                                                                                                      |
| `db/test/moderation-sla-schema`                                                                                                                     | D-SCHEMA, D-RLS                                                                                                                                                                                                                                                                                                                                                                                                |
| `integration/community-worker-release-gate`                                                                                                         | U-W-IMAGE-GRAPH                                                                                                                                                                                                                                                                                                                                                                                                |
| `integration/moderation-sla-concurrency`                                                                                                            | U-S-CLOCK, U-S-BUDGET, I-D-RETRY, I-D-RESTART, I-D-CONCURRENT, I-D-SKIP-LOCKED, I-D-LEASE, I-D-CRASH-AFTER-POST, I-D-NO-TX-OVER-POST, I-D-FENCE, I-D-DELIVERED-ONCE, I-D-BULLMQ, I-D-BACKLOG-SLOW                                                                                                                                                                                                              |
| `integration/moderation-sla-delivery`                                                                                                               | U-S-FLAG-ORDER, U-S-ISOLATION, U-S-RESULT-SAFE, U-S-SNAPSHOT, U-S-RECORDED, I-W-REAL-THREE-KINDS, I-W-REKEY-PAYLOAD, I-W-THIRD-FAILURE, I-W-CLAIM-FAILS, I-W-OWED-ESCALATION, I-O-TRACE-SECRET, U-S-LAST-MEASURED, I-W-RECOVERS, I-W-CODES-REAL, I-W-CRASH-LOOP, I-W-RECORD-FAILS, I-W-BACKOFF-HONORED, I-W-NO-CHANNEL, I-W-BAD-CONFIG, I-W-BACKLOG, I-W-RESOLVED, I-O-OTLP, I-P-WEBHOOK-SECRET, I-P-ANALYTICS |
| `integration/moderation-sla-delivery`, `api/modules/community/community-worker-runtime`, `api/workers/bootstrap`, `api/workers/community.bootstrap` | U-W-FACTORY                                                                                                                                                                                                                                                                                                                                                                                                    |
| `integration/moderation-sla-delivery`, `integration/moderation-sla-route`                                                                           | I-P-CANARY                                                                                                                                                                                                                                                                                                                                                                                                     |
| `integration/moderation-sla-escalate`                                                                                                               | I-W-RESOLVED-DECISION, I-E-ATOMIC, I-E-ROLLBACK, I-E-REPLAY, I-E-REPLAY-RACE, I-E-REESCALATE, I-E-PARITY, I-E-FLAG-OFF, I-E-NEXT-SWEEP, I-E-ORPHAN, I-E-DECISION-UNCHANGED                                                                                                                                                                                                                                     |
| `integration/moderation-sla-operations`                                                                                                             | I-W-DRILL, U-GF-METRICS, U-RB-RUNBOOK                                                                                                                                                                                                                                                                                                                                                                          |
| `integration/moderation-sla-route`                                                                                                                  | I-R-HTTP, I-R-HEADERS, I-R-COUNT-PARITY, I-R-NO-LOAD, I-R-RESOLUTION, I-R-ALERT-COUNTS, I-R-RECENT, I-R-STALE, I-R-PENDING-AGE, I-R-SANCTIONED                                                                                                                                                                                                                                                                 |
| `integration/moderation-sla-route`, `integration/moderation-sla`                                                                                    | I-S-TZ-DST                                                                                                                                                                                                                                                                                                                                                                                                     |
| `integration/moderation-sla`                                                                                                                        | U-S-FLAG-THROW, U-S-SWEEP-FAILS, I-S-BOUNDARY, I-S-PAGING, I-S-ANCHOR, I-S-OUTAGE, I-S-SUPERSEDE, I-S-NEW-REPORT, I-S-PARTIAL, I-S-REKEY, I-S-REKEY-COMMENT, I-S-MONITOR, I-S-FLAG-OFF, I-S-FLAG-OUTAGE                                                                                                                                                                                                        |
| `moderation/moderation-sla.controller`                                                                                                              | U-R-ORDER                                                                                                                                                                                                                                                                                                                                                                                                      |
| `moderation/moderation-sla.rules`                                                                                                                   | U-S-BOUNDARY, U-S-NO-THRESHOLD, U-S-NO-DB-CLOCK, U-S-RELEVANCE, U-S-BACKOFF, U-CH-CONFIG, U-CH-CODES, U-CH-NO-SECRET, U-CH-REQUEST, U-CH-PAYLOAD, U-R-STALE, I-S-NO-REOPEN                                                                                                                                                                                                                                     |
| `pact/http/consumer/interactions/moderation.ts`                                                                                                     | C-PACT                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pw/api/auth-moderation-security`                                                                                                                   | P-SLA-ROLES                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pw/moderation-sla`                                                                                                                                 | P-SLA-REAL-DELIVERY, P-SLA-HOSTED-PATH, P-SLA-JOURNEY, P-SLA-AXE, P-SLA-STABLE, P-SLA-STALE-UI, P-SLA-THEMES-WIDTHS, P-SLA-LOCALE, P-SLA-KEYBOARD                                                                                                                                                                                                                                                              |
| `web/components/moderation-sla-dashboard`                                                                                                           | C-WEB-STATES, C-WEB-NO-WRITE, C-WEB-LINKS, C-WEB-ANNOUNCE, C-WEB-LABELS, C-WEB-TIME, C-WEB-A11Y                                                                                                                                                                                                                                                                                                                |
| `web/i18n/moderation-locales`                                                                                                                       | U-WEB-LOCALES                                                                                                                                                                                                                                                                                                                                                                                                  |
| `web/lib/moderation`                                                                                                                                | U-WEB-CLIENT                                                                                                                                                                                                                                                                                                                                                                                                   |
| `web/moderation/moderation-no-direct-access`                                                                                                        | U-WEB-NO-DIRECT                                                                                                                                                                                                                                                                                                                                                                                                |

**Seeded-defect proofs.**
Forty-one proofs in a throwaway worktree, each restored afterwards: the seventeen planned, with S-4 and S-10 in two variants each, and twenty-two added.
A control run on unmodified code passed 255 of 255 across the seven files the proofs use.
All were re-run after Codex round 1 at `916a78d1`, with S-33 re-run on its tightened tests at `38957f25`, and S-18, S-19, S-29 and S-36 after the last spec fold at `c01a506b`.
S-13 and S-16 also ran through the full stack at that commit, where P-SLA-REAL-DELIVERY timed out at 150 seconds.
S-18 onward came from the build, the independent review and Codex round 1. S-29 to S-38 prove CX-1 to CX-6.
S-33 survived at first: the sweep's first repair pass runs while the row is pending, so the tests now keep the record refused through the terminal sweep.

| Proof | Defect                                                                     | Named test                                                  | Tests red |
| ----- | -------------------------------------------------------------------------- | ----------------------------------------------------------- | --------- |
| S-1   | A 7-hour window literal in the sweep                                       | U-S-NO-THRESHOLD, I-S-BOUNDARY                              | 8         |
| S-2   | remaining < 0 for breached                                                 | U-S-BOUNDARY, I-S-BOUNDARY                                  | 9         |
| S-3   | A Date parameter in the claim query                                        | I-S-TZ-DST                                                  | 4         |
| S-4a  | Plain insert with no conflict clause (read-before-insert kept)             | I-D-CONCURRENT                                              | 4         |
| S-4b  | Plain insert with no conflict clause and no read-before-insert             | I-D-RETRY, I-D-CONCURRENT                                   | 14        |
| S-5   | Claim without SKIP LOCKED                                                  | I-D-SKIP-LOCKED                                             | 1         |
| S-6   | POST inside the claim transaction                                          | I-D-NO-TX-OVER-POST                                         | 17        |
| S-7   | Outcome write without the attempts fence                                   | I-D-FENCE                                                   | 2         |
| S-8   | Relevance reload removed                                                   | I-W-RESOLVED, I-W-BACKLOG                                   | 4         |
| S-9   | Log the raw fetch error message                                            | I-P-WEBHOOK-SECRET                                          | 4         |
| S-10a | excerpt added to the payload the sweep sends                               | I-P-CANARY                                                  | 2         |
| S-10b | excerpt added to the payload contract                                      | U-C-PAYLOAD-STRICT                                          | 1         |
| S-11  | Alert insert outside the decision transaction                              | I-E-ROLLBACK                                                | 9         |
| S-12  | JobFailure written on every failure past the third                         | I-W-THIRD-FAILURE                                           | 11        |
| S-13  | Interval schedule removed from community.bootstrap.ts                      | U-W-INTERVAL, P-SLA-REAL-DELIVERY (webhook timeout)         | 3         |
| S-14  | SLA controller left out of forRoutes                                       | I-R-HEADERS                                                 | 1         |
| S-15  | Flag check moved after detection                                           | U-S-FLAG-ORDER, I-S-FLAG-OFF                                | 6         |
| S-16  | Adapter returns delivered with no request                                  | I-W-REAL-THREE-KINDS, P-SLA-REAL-DELIVERY (webhook timeout) | 29        |
| S-17  | instrumentation imported from the sweep                                    | U-W-IMAGE-GRAPH                                             | 1         |
| S-18  | A label outside the closed set on a metric                                 | I-O-OTLP                                                    | 1         |
| S-19  | A dashboard metric the sweep never records                                 | I-O-OTLP                                                    | 1         |
| S-20  | Worker composition drops the sweep                                         | U-W-FACTORY                                                 | 1         |
| S-21  | A private key on the PostHog snapshot                                      | I-P-ANALYTICS                                               | 2         |
| S-22  | Failure guard removed from escalateFailure                                 | I-W-THIRD-FAILURE                                           | 1         |
| S-23  | COLLATE C removed from the anchor tie                                      | I-S-ANCHOR                                                  | 1         |
| S-24  | A refresh that also writes                                                 | C-WEB-NO-WRITE                                              | 1         |
| S-25  | Every refresh announces itself                                             | C-WEB-ANNOUNCE                                              | 1         |
| S-26  | Maintenance queue stops retrying                                           | I-D-BULLMQ                                                  | 2         |
| S-27  | The sweep reads its flags for a viewer, so an open viewer keeps it running | stale monitor stale                                         | 1         |
| S-29  | The webhook POST traced with its URL                                       | I-O-TRACE-SECRET                                            | 1         |
| S-30  | Delivery budget counted from the sweep start                               | U-S-BUDGET                                                  | 2         |
| S-31  | A failed claim reported as a completed sweep                               | I-W-CLAIM-FAILS                                             | 3         |
| S-32  | An alert-level fault still stamps the monitor                              | I-W-CLAIM-FAILS, U-S-ISOLATION                              | 2         |
| S-33  | Repair sees pending rows only                                              | I-W-OWED-ESCALATION                                         | 3         |
| S-34  | A success at attempt three still owes a record                             | owes nothing                                                | 3         |
| S-35  | Measurement time published before any measurement                          | U-S-LAST-MEASURED                                           | 4         |
| S-36  | A gauge panel with no freshness gate                                       | U-GF-METRICS                                                | 1         |
| S-37  | Escalated count ordered by wall clock                                      | I-R-COUNT-PARITY                                            | 3         |
| S-38  | Detection failure rethrows the raw Prisma message                          | U-S-SWEEP-FAILS                                             | 1         |
| S-28  | Counter series that start at their first event                             | I-O-OTLP, observed red until `43e4b1e4`                     | 1         |
| S-39  | A gated stat panel that keeps an older point from its range                | U-GF-METRICS, observed red until `c7a52fad`                 | 1         |

**Manual checks.**

| ID            | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-VISUAL      | Pass   | Builder walk and Playwright captures at 1280 and 375, light and dark, in `_bmad-output/test-artifacts/story-6-12/` (gitignored).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| M-LGTM        | Pass   | General worker on the local LGTM stack at `c01a506b`, real sweep: all five metrics arrive, no panel shows No data, and a first alert after a worker start reads above zero. With the worker alive and the flag off, at a measurement age of 330 seconds the four stat panels read Stale, the age panel is red, and the time series stop at the gate. Captures `lgtm-moderation-sla.png` and `lgtm-moderation-sla-stale.png`, same folder. Two limits stay: a sweep that alerts before the first 60-second export still has no zero sample, and the Stale text takes the panel's base green, with the red age panel beside it. |
| M-STOP-WORKER | Pass   | Builder walk: SIGSTOP on the worker, stale banner 5 minutes after the last stamp, cleared one sweep after SIGCONT.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M-POSTHOG     | Pass   | Dashboard `2307559` and the disabled alert, ids in the runbook.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| M-IMAGE       | Pass   | Builder prune run at 118.4 MB against the 150 MB limit, with `@opentelemetry/core` in the image.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| M-BUDGET      | Pass   | 100 changed files against `main`, the most CodeRabbit reviews.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Findings sent to the builder and fixed.**
Enum array mutation by the OpenAPI generator, and the lease boundary.
F-1 payload case id from the anchor after a re-key.
F-2 the interrupted attempt's log and counter.
F-3 a stale claimant that lost the fence no longer escalates.
F-4 the budget counts from the sweep's clock read.
F-5 the page announced every timed refresh.
F-6 two alerts in the repeated hour of a DST change rendered identical times, fixed at `26ffaf5f` by showing the zone.
F-7 the first alert and failure after a worker start read as zero in Grafana, fixed at `43e4b1e4` by starting each series at zero.
Prisma error text stays out of logs, with only the code logged.

**Codex round 1 on `6b438525`, all fixed by the builder with tests written first.**
Each test failed against `6b438525` for the reason Codex reproduced.

| Finding                                 | Severity | Fix                                                                                                                                   | Tests                                                               |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| CX-1 webhook URL on trace spans         | Major    | The POST runs with tracing suppressed                                                                                                 | I-O-TRACE-SECRET, S-29                                              |
| CX-2 slow detection starves delivery    | Major    | The budget counts from delivery start, and a run always claims once                                                                   | U-S-BUDGET, S-30                                                    |
| CX-3 failed claim reads as healthy      | Major    | The run rejects with fixed text, with no stamp and no snapshot                                                                        | I-W-CLAIM-FAILS, I-D-BULLMQ, U-S-ISOLATION, S-31, S-32              |
| CX-4 owed escalation lost               | Major    | `failure_owed_code`, written with the failed attempt and repaired in any delivery state                                               | I-W-OWED-ESCALATION, S-22, S-33, S-34                               |
| CX-5 stale gauges with fresh timestamps | Minor    | `moderation_sla_last_measured_timestamp_seconds` gates every gauge panel, and gated stat panels query the latest value and read Stale | U-S-LAST-MEASURED, U-GF-METRICS, I-O-OTLP, M-LGTM, S-35, S-36, S-39 |
| CX-6 escalated count by wall clock      | Minor    | The newest row picks the case key, and that key's highest sequence decides                                                            | I-R-COUNT-PARITY, S-37                                              |

Added by TEA in the same round: a detection failure also rejects with fixed text (S-38), and `failure_owed_code` has a closed CHECK and a partial index.
F-8 came from the real Grafana proof: with the gates empty, a range query and `lastNotNull` still printed the last count, so a stale zero read as a fresh zero. Query checks alone had passed it.

**Independent test review.**
The report at the end of this document scored `bb8491d5` at 45 of 100 and blocked it.
Its Resolution section lists what each finding became.
The fixes are proved by S-21 to S-27 and were not rescored.

---

## Traceability

| Criterion | Statement                                                                                                                   | Tests                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1        | Calculate at-risk and breached states from persisted timestamps in a scheduled, retry-safe worker                           | U-S-BOUNDARY, U-S-CLOCK, U-S-NO-DB-CLOCK, U-S-SWEEP-FAILS, U-W-ROUTE, U-W-SCHEDULER, U-W-INTERVAL, U-W-FACTORY, U-W-IMAGE-GRAPH, I-S-BOUNDARY, I-S-PAGING, I-S-ANCHOR, I-S-TZ-DST, I-S-OUTAGE, I-S-NO-REOPEN, I-S-PARTIAL, I-D-BULLMQ, P-SLA-REAL-DELIVERY, P-SLA-HOSTED-PATH, M-IMAGE                                                                                      |
| E2        | Alert the channel before and at breach, deduplicate retries, escalate delivery failures through the established path        | I-W-CLAIM-FAILS, I-W-OWED-ESCALATION, U-C-PAYLOAD-STRICT, U-S-ISOLATION, U-S-BUDGET, I-D-RETRY, I-D-RESTART, I-D-CONCURRENT, I-D-SKIP-LOCKED, I-D-LEASE, I-D-CRASH-AFTER-POST, I-D-NO-TX-OVER-POST, I-D-FENCE, I-D-DELIVERED-ONCE, I-D-BULLMQ, I-D-BACKLOG-SLOW, I-W-REAL-THREE-KINDS, I-W-THIRD-FAILURE, I-W-RECOVERS, I-W-CRASH-LOOP, I-E-NEXT-SWEEP, P-SLA-REAL-DELIVERY |
| E3        | Queue and SLA dashboards, alert tests, operating runbook                                                                    | I-W-CLAIM-FAILS, U-C-RESPONSE-STRICT, U-S-SNAPSHOT, U-S-RECORDED, U-R-STALE, U-W-OTEL, I-S-MONITOR, I-O-OTLP, I-R-HTTP, I-R-COUNT-PARITY, I-R-NO-LOAD, I-R-RESOLUTION, I-R-RECENT, I-R-STALE, I-R-PENDING-AGE, D-RLS, P-SLA-JOURNEY, P-SLA-STALE-UI, U-RB-RUNBOOK, M-STOP-WORKER                                                                                            |
| S1        | Each boundary matches `deriveSlaState`, and no threshold exists outside `@couture/api-client`                               | U-S-BOUNDARY, U-S-NO-THRESHOLD, I-W-REKEY-PAYLOAD, U-S-CLOCK, I-S-BOUNDARY, I-S-PAGING, I-S-ANCHOR, I-S-OUTAGE, I-S-NEW-REPORT, I-S-REKEY, I-S-REKEY-COMMENT, I-R-RECENT                                                                                                                                                                                                    |
| S2        | Retry, restart or two workers: one row per key, and a delivered alert is not sent again                                     | I-D-RETRY, I-D-RESTART, I-D-CONCURRENT, I-D-SKIP-LOCKED, I-D-LEASE, I-D-CRASH-AFTER-POST, I-D-DELIVERED-ONCE, D-SCHEMA                                                                                                                                                                                                                                                      |
| S3        | A case resolved before delivery sends nothing                                                                               | U-S-RELEVANCE, I-S-SUPERSEDE, I-W-BACKLOG, I-W-RESOLVED, I-W-RESOLVED-DECISION                                                                                                                                                                                                                                                                                              |
| S4        | Each kind arrives at a real HTTP endpoint, and the payload holds no reason, excerpt, alias, reporter or subject             | I-O-TRACE-SECRET, U-C-PAYLOAD-STRICT, U-S-RESULT-SAFE, U-CH-CONFIG, U-CH-NO-SECRET, U-CH-REQUEST, U-CH-PAYLOAD, I-W-REAL-THREE-KINDS, I-P-CANARY, I-P-WEBHOOK-SECRET, I-P-ANALYTICS, D-SCHEMA, P-SLA-REAL-DELIVERY                                                                                                                                                          |
| S5        | Each failed attempt logged and counted, the third writes one `JobFailure` and one error log, and recovery needs no operator | I-W-OWED-ESCALATION, U-S-BACKOFF, U-CH-CODES, I-W-THIRD-FAILURE, I-W-RECOVERS, I-W-CODES-REAL, I-W-CRASH-LOOP, I-W-RECORD-FAILS, I-W-BACKOFF-HONORED, I-W-BAD-CONFIG, I-R-ALERT-COUNTS                                                                                                                                                                                      |
| S6        | No webhook: `console_only` on the console, and the dashboard names it                                                       | U-CH-CONFIG, I-W-NO-CHANNEL, I-R-ALERT-COUNTS, C-WEB-STATES                                                                                                                                                                                                                                                                                                                 |
| S7        | Escalate commits with its alert or both roll back, and a replay adds nothing                                                | I-E-ATOMIC, I-E-ROLLBACK, I-E-REPLAY, I-E-REPLAY-RACE, I-E-REESCALATE, I-E-PARITY, I-E-FLAG-OFF, I-E-NEXT-SWEEP, I-E-ORPHAN, I-E-DECISION-UNCHANGED, P-SLA-REAL-DELIVERY                                                                                                                                                                                                    |
| S8        | Either flag off: the sweep touches no table and sends nothing, the route answers 503 and 403                                | U-S-FLAG-ORDER, U-S-FLAG-THROW, U-R-ORDER, U-F-REGISTRY, I-S-FLAG-OFF, I-S-FLAG-OUTAGE, I-E-FLAG-OFF, I-R-HTTP, I-R-HEADERS, I-R-SANCTIONED, U-WEB-NO-DIRECT, P-SLA-ROLES                                                                                                                                                                                                   |
| S9        | Desktop and mobile, light and dark, ten locales, every state, axe clean                                                     | U-C-RESPONSE-STRICT, U-C-ENUMS, C-OPENAPI, C-PACT, U-WEB-CLIENT, U-WEB-LOCALES, C-WEB-STATES, C-WEB-NO-WRITE, C-WEB-LINKS, C-WEB-ANNOUNCE, C-WEB-LABELS, C-WEB-TIME, C-WEB-A11Y, P-SLA-JOURNEY, P-SLA-AXE, P-SLA-STABLE, P-SLA-STALE-UI, P-SLA-THEMES-WIDTHS, P-SLA-LOCALE, P-SLA-KEYBOARD, M-VISUAL                                                                        |
| S10       | Each dashboard metric exists in code, and LGTM shows it from a real sweep                                                   | U-S-LAST-MEASURED, I-O-OTLP, U-GF-METRICS, M-LGTM, M-POSTHOG                                                                                                                                                                                                                                                                                                                |
| S11       | Runbook names roles and steps and no person, staffing signature recorded open                                               | I-W-DRILL, U-RB-RUNBOOK, U-RB-READINESS                                                                                                                                                                                                                                                                                                                                     |
| S12       | Fewer than 100 changed files as the goal, every PR job under 20 minutes                                                     | D-HYGIENE, M-BUDGET                                                                                                                                                                                                                                                                                                                                                         |

### Gap status

No criterion lacks a test.
Reduced by decision: E2 "configured operations channel" is proved to a real HTTP endpoint only, per D8.
Dropped by decision: E3 "staffing coverage" and named ownership, per D16.
Manual by nature, results in the Execution record: visual review (M-VISUAL), LGTM (M-LGTM), worker stop (M-STOP-WORKER), image prune (M-IMAGE), PostHog ids (M-POSTHOG).
Residual: TEA-19.

---

## Mitigation Plans

### R-001 State disagreement (6)

**Mitigation Strategy:** one import of `deriveSlaState`, boundary tables in unit and real SQL, a threshold scan.
**Owner:** builder. **Timeline:** before PR review. **Status:** planned.
**Verification:** U-S-BOUNDARY, I-S-BOUNDARY, S-1, S-2.

### R-002 Session time zone (6)

**Mitigation Strategy:** the TEA-15 binding rule and a run on a Chicago session across both DST changes.
**Owner:** builder. **Timeline:** before PR review. **Status:** planned.
**Verification:** I-S-TZ-DST, S-3.

### R-003 Hosted path never runs (6)

**Mitigation Strategy:** wiring units per path and a real delivery from the real process.
**Owner:** builder and TEA. **Timeline:** before PR review. **Status:** planned.
**Verification:** U-W-INTERVAL, P-SLA-REAL-DELIVERY, S-13.

### R-004 Duplicate send (6)

**Mitigation Strategy:** the TEA-01 claim protocol.
**Owner:** builder. **Timeline:** before PR review. **Status:** planned.
**Verification:** I-D-\*, S-4 to S-7.

### R-005 Missed alert (6)

**Mitigation Strategy:** paging to exhaustion and report-anchored keys, on real rows.
**Owner:** builder and TEA. **Timeline:** before PR review. **Status:** planned.
**Verification:** I-S-PAGING, I-S-ANCHOR, I-S-OUTAGE.

### R-007 Private data leak (6)

**Mitigation Strategy:** strict schemas and a canary scan of every surface.
**Owner:** TEA. **Timeline:** before PR review. **Status:** planned.
**Verification:** I-P-CANARY, I-P-ANALYTICS, S-10.

### R-008 Webhook secret leak (6)

**Mitigation Strategy:** the TEA-03 validation and closed codes.
**Owner:** builder. **Timeline:** before PR review. **Status:** planned.
**Verification:** U-CH-NO-SECRET, I-P-WEBHOOK-SECRET, S-9.

### R-009 Silent channel (6)

**Mitigation Strategy:** TEA-02, TEA-04 and the exact third-attempt scenario.
**Owner:** builder and TEA. **Timeline:** before PR review. **Status:** planned.
**Verification:** I-W-THIRD-FAILURE, I-W-CRASH-LOOP, S-12.

### R-010 Tests stop at a fake (6)

**Mitigation Strategy:** a real socket in integration and a real process in Playwright.
**Owner:** TEA. **Timeline:** before PR review. **Status:** planned.
**Verification:** I-W-REAL-THREE-KINDS, P-SLA-REAL-DELIVERY, S-16.

### R-011 Escalate atomicity (6)

**Mitigation Strategy:** TEA-07, TEA-08 and a real trigger fault.
**Owner:** builder. **Timeline:** before PR review. **Status:** planned.
**Verification:** I-E-ROLLBACK, I-E-PARITY, S-11.

### R-015 Dead worker reads healthy (6)

**Mitigation Strategy:** boundary tests from the API alone and a manual stop.
**Owner:** TEA. **Timeline:** before PR review. **Status:** planned.
**Verification:** I-R-STALE, I-R-PENDING-AGE, M-STOP-WORKER.

### R-016 Image breakage (6)

**Mitigation Strategy:** an import graph unit, a local prune run and a caller grep.
**Owner:** builder. **Timeline:** before PR review. **Status:** planned.
**Verification:** U-W-IMAGE-GRAPH, M-IMAGE, S-17.

### R-020 Live sweep flake (6)

**Mitigation Strategy:** the TEA-14 scoping rules and a burn-in.
**Owner:** TEA. **Timeline:** before PR review. **Status:** planned.
**Verification:** P-SLA-STABLE at repeat count 3.

---

## Test Quality Review: Story CC-6.12 SLA monitoring and escalation

**Quality Score**: 45/100 (F: Critical Issues)
**Raw Deduction Score**: 45/100
**Score Cap**: 69/100
**Score Override Rule**: Highest severity CRITICAL caps effective score at 69: min(raw deduction score 45, 69) = 45.
**Review Date**: 2026-11-05
**Review Mode**: full-file
**Reviewer**: TEA independent reviewer, reading commit bb8491d5

---

Note: This review audits existing tests.
Coverage mapping and coverage gates are out of scope here.
Use `trace` for coverage decisions.

### Executive Summary

**Overall Assessment**: Critical Issues

**Recommendation**: Block
**Verdict Rule**: Critical > 0 => Block (1 Critical).

**Context Basis**: pr_diff

**Context Waivers Applied**: 0

**Execution Mode**: sequential

#### Key Strengths

✅ The delivery specs talk to a real socket, and the crash spec kills a real child process with SIGKILL and compares the resend byte for byte.

✅ The reviewed files hold no hard wait, no focused test and no undocumented skip, so the sleep-free design holds at HEAD.

✅ The injected clock pins lease, backoff and budget boundaries to the millisecond.

#### Advisory Observations

These carry no severity and no deduction, because no registry row describes them.
Several are the most consequential defects in this review.

ℹ️ **A1. A stale-monitor test that exercises nothing.** `apps/api/integration/moderation-sla-route.integration.spec.ts:530`
The test title promises that opening the route for one viewer leaves a stale monitor stale.
No sweep runs in the test, so the flag double at line 532 is never consulted for the system subject, and `key !== key` is a spelled-out `false`.
The monitor row is absent because `beforeEach` deleted it, so `stale` is true whatever the sweep does.
Fix: run a real `ModerationSlaSweep` with that same flag double, assert `moderationSlaMonitor.findFirst()` is null, assert the route reads stale, then flip the system subject on and assert `stale` turns false.

ℹ️ **A2. The snapshot privacy check reads the wrong event.** `apps/api/integration/moderation-sla-delivery.integration.spec.ts:590`
`const [event]` takes the first captured call, which is `moderation_sla_alert_recorded` from detection.
The snapshot body is never inspected in the reviewed files.
Mutation proof: replacing the whole snapshot body with `{ mutated_reporter_id }` left all 118 tests of four spec files green.
Fix: read `snapshots()[0]` and `toEqual` the full event, with distinct id and the five named properties.

ℹ️ **A3. The concurrent escalation guard is unproven.** `apps/api/integration/moderation-sla-delivery.integration.spec.ts:177`
The plan row says two concurrent escalations add one row.
The lease stops the second worker from claiming, so it never reaches `escalateFailure`.
Mutation proof: removing the `failure_escalated_at: null` guard and the count check left the test and the suite green.
Fix: claim once, then call `escalateFailure` twice through two clients in `Promise.all`, and assert one `true`, one `false` and one `JobFailure`.

ℹ️ **A4. The byte-order tiebreak is unproven.** `apps/api/integration/moderation-sla.integration.spec.ts:129`
The seeded ids end in `-0`, `-1`, `-2`, so byte order, locale order and insertion order all agree.
Mutation proof: removing `COLLATE "C"` from the anchor aggregate left the test and the suite green.
Fix: seed ids whose byte order and locale order differ, such as `...-Zb` and `...-aa`, and insert them out of order.

ℹ️ **A5. I-D-BULLMQ tests a configuration production does not use.** `apps/api/integration/moderation-sla-concurrency.integration.spec.ts:484`
The test hardcodes `attempts: 3` and a fixed backoff on `queue.add`, so a production queue with no retries would still pass.
It builds a plain `Worker`, so the `createWorker` failed hook that writes `JobFailure` never runs, although the plan row requires that row.
The canary at line 494 scans a Prisma connection error raised before the channel is touched, so that message has no path to the webhook URL.
Fix: use `queueConfigs` job options and `createWorker` on a namespaced queue, then scan `prisma.jobFailure.findMany()` and `logs.text()` for the canary.

ℹ️ **A6. P-SLA-STABLE cannot see a transient announcement.** `playwright/tests/moderation-sla.spec.ts:391`
`toHaveText('')` retries until it matches, so a brief "Refreshing" announcement passes.
HEAD has that exact code path at `apps/web/src/app/components/moderation-sla-dashboard.tsx:106`.
`reads` increments at line 374 before the fulfill, so lines 391 and 392 can also run before the refresh renders, and the plan asks for two sweeps where the test runs one.
Fix: record live region text with a `MutationObserver` from an init script, assert the recorded list equals `['']`, and vary one rendered silent field so the test can wait for the refresh to land.

ℹ️ **A7. C-WEB-TIME proves no instant.** `apps/web/src/app/components/moderation-sla-dashboard.test.tsx:324`
No web config or CI workflow sets `TZ`, so on a UTC runner the two clocks are simply one hour apart.
Under Chicago both format to the same string, so swapped rows still pass.
The oracle copies the formatter of the component, so the assertion restates the implementation.
Fix: pin `TZ=America/Chicago` for this file, add a time zone name to the rendered value so the two instants differ, and assert literal strings or a `dateTime` attribute.

ℹ️ **A8. "Announces once" counts nothing.** `apps/web/src/app/components/moderation-sla-dashboard.test.tsx:268`
The test checks the final text only, so a repeated announcement on every refresh passes.
The sibling silent test at lines 253 and 254 waits on handler entry and one zero-millisecond tick, which may end before the response renders.
Fix: count observer mutations across a third refresh, and wait on a rendered change before reading the live region.

ℹ️ **A9. I-P-CANARY scans less than its title.** `apps/api/integration/moderation-sla-delivery.integration.spec.ts:676`
`capture().reset()` erases the failing requests before the scan, so the receiver surface holds only the last successful sweep, and nothing asserts it holds any request.
Lines 667 to 669 collect post reporters only, so the comment reporter id goes unscanned.
Fix: snapshot `received` before the reset, assert its length, and add the comment reporter ids.

ℹ️ **A10. Further weak oracles.**
`apps/api/integration/moderation-sla-route.integration.spec.ts:573` compares two sibling routes, so both can break together, and the plan says pinned; assert a literal status.
`packages/api-client/testing/moderation-sla-contract.spec.ts:124` scans a body the test wrote, so a new optional private field stays invisible; walk the keys of the OpenAPI component.
`apps/api/integration/moderation-sla-concurrency.integration.spec.ts:102` ignores the run result, and by reading the source a waiting claim ends at the 5-second transaction timeout, so the test catches it only when the held row sorts first; assert `{ delivered: 2, errors: 0 }` and hold the row that sorts last.
`apps/api/src/modules/moderation/moderation-sla.rules.spec.ts:171` misses a multi-column `SET`; widen the pattern to any `SET` list.
`playwright/tests/moderation-sla.spec.ts:232` scans launcher text although the plan asks for the process list; have the launcher write a process manifest and read it.
`playwright/tests/moderation-sla.spec.ts:500` passes on any permanent box shadow; compare computed style before and after focus.
`apps/api/integration/moderation-sla-delivery.integration.spec.ts:244` releases a port that a parallel file can reuse; use a server that destroys each socket.
`apps/api/integration/moderation-sla.integration.spec.ts:452` is filler, and `apps/api/integration/moderation-sla-delivery.integration.spec.ts:270` is a dead call; delete both.

#### Summary

The suite is strong at its core, with real sockets, real Postgres and a real process kill.
The verdict comes from one assertion that cannot fail, plus state written in tests with no hook to reset it.
The advisory list holds the sharper problem: several tests carry a title their body does not exercise, and three of those were proven by mutation.
Findings describe commit bb8491d5, and a peer holds uncommitted edits to reviewed files during this review.

---

### Quality Criteria Assessment

| Criterion                            | Status          | Violations | Basis                                              | Notes                                               |
| ------------------------------------ | --------------- | ---------- | -------------------------------------------------- | --------------------------------------------------- |
| Disabled or Focused Tests            | ✅ PASS         | 0          | Absolute                                           | Two conditional skips carry a documented reason     |
| Hard Waits (sleep, waitForTimeout)   | ✅ PASS         | 0          | Absolute                                           | No match in any reviewed file at HEAD               |
| Determinism (assertions always run)  | ❌ FAIL         | 3          | Absolute + Applicability                           | H3 twice, H2 once                                   |
| Isolation (cleanup, no shared state) | ❌ FAIL         | 4          | Absolute                                           | H4 four times                                       |
| Fixture Patterns                     | ⚠️ WARN         | 1          | Applicability: the file constructs domain payloads | The M2 finding, counted once in the total           |
| Data Factories                       | ⚠️ WARN         | 1          | Applicability: the file constructs domain payloads | The same M2 finding                                 |
| Network-First Pattern                | ⚠️ WARN         | 1          | Applicability: the file navigates and reads data   | M1                                                  |
| Explicit Assertions                  | ❌ FAIL         | 2          | Absolute                                           | C3 once, H10 once                                   |
| Test Length (≤1000 lines)            | ✅ PASS         | 0          | Absolute                                           | 753 lines at most                                   |
| Test Duration (≤1.5 min)             | ➖ Not measured | -          | Not measured                                       | A static read cannot time a run                     |
| Flakiness Patterns                   | ❌ FAIL         | 8          | Absolute + Applicability                           | The H2, H3, H4 and M1 findings above, counted above |

**Total Violations**: 1 Critical, 8 High, 2 Medium, 1 Low

**Convention Baseline**: 8 test files sampled outside the review set

The corpus holds 944 test files, the closest 40 were ranked, and 8 were read.
All 8 are Vitest integration specs, so `priorityMarkers`, `testIds`, `networkFirst`, `fixtures` and `playwrightUtils` each measured 0 of 8 and their rows are closed.
playwright-utils is installed and `tea_use_playwright_utils` is true; 0 of 8 sampled files outside the review set use it.
Adoption has not spread past the reviewed set.
A wider scan of the corpus finds 30 files that import the package, so this zero reflects the closest-first sample.

---

### Quality Score Breakdown

```text
Starting Score:          100
Critical Violations:     -1 × 10 = -10
High Violations:         -8 × 5 = -40
Medium Violations:       -2 × 2 = -4
Low Violations:          -1 × 1 = -1

Bonus Points:
  Comprehensive Fixtures: +0
  Data Factories:        +0
  Network-First:         +0
  Perfect Isolation:     +0
  All Test IDs:          +0
                         --------
Total Bonus:             +0

Raw Deduction Score:     45/100
Score Cap:               69/100 (CRITICAL)
Effective Score:         45/100
Grade:                   F
```

---

### Critical Issues (Must Fix)

#### 1. "Sends only GETs" reads a list only a GET handler can fill

**Severity**: P0 (Critical)
**Location**: `apps/web/src/app/components/moderation-sla-dashboard.test.tsx:199`
**Row**: C3
**Provenance**: introduced

**Issue**: `calls` is filled only inside `http.get`, so `call.method` can only be `GET`.
A POST misses that handler, reaches the unhandled-request hook in `vitest.setup.ts`, and the component swallows the rejected fetch, so the test stays green.
The test also clicks nothing, so it observes the page load alone.

**Fix**: Register a catch-all `http.all('*/api/*')` recorder, click Refresh, and assert the recorded method list equals `['GET', 'GET']`.

---

### Recommendations (Should Fix)

#### 1. The allowed-keys check skips any event missing from its own list

**Severity**: P1 (High)
**Location**: `apps/api/integration/moderation-sla-delivery.integration.spec.ts:746`
**Row**: H3
**Provenance**: introduced

**Issue**: `if (allowed[event.event])` skips key checks for an unlisted event, and `moderation_sla_snapshot` is unlisted.
Mutation proof: a snapshot carrying `mutated_reporter_id` left this privacy test green.

**Fix**: Add the snapshot keys to `allowed`, and replace the `if` with `expect(Object.keys(event.properties ?? {}).sort()).toEqual(allowed[event.event])`, which fails on an unknown event.

#### 2. A restore replaces the shared flag double with a different one

**Severity**: P1 (High)
**Location**: `apps/api/integration/moderation-sla-route.integration.spec.ts:537`
**Row**: H4
**Provenance**: introduced

**Issue**: The `finally` installs a hand-written implementation that drops the `failingFlags` branch of `moderation-decisions-seed.ts`.
From this test on, `failFlag` does nothing, so any test running later that relies on it gets a 200.

**Fix**: Use `mockImplementationOnce` for the override, or save and restore `getMockImplementation()`.

#### 3. Route flag state is cleared inline

**Severity**: P1 (High)
**Location**: `apps/api/integration/moderation-sla-route.integration.spec.ts:219`
**Row**: H4
**Provenance**: introduced

**Issue**: Lines 206 to 209, 219 to 221 and 257 to 259 write `flagValues` and clear it after an `expect`.
No hook in the spec or its helpers clears the map, so one failure turns every later route test into a 503 and hides the real cause.

**Fix**: Add `flagValues.clear()` to the `beforeEach` at line 100, and delete the inline clears.

#### 4. The escalate spec leaves monitoring off on failure

**Severity**: P1 (High)
**Location**: `apps/api/integration/moderation-sla-escalate.integration.spec.ts:294`
**Row**: H4
**Provenance**: introduced

**Issue**: The flag is set at line 294 and removed at line 308, with assertions between them and no hook.
A failure there makes each later sweep in the file a no-op, which fails unrelated tests.

**Fix**: Add a `beforeEach` that clears `flagValues` and resets `receiver`.

#### 5. Playwright cleanup runs only when the test passes

**Severity**: P1 (High)
**Location**: `playwright/tests/moderation-sla.spec.ts:228`
**Row**: H4
**Provenance**: introduced

**Issue**: `closeCase` at lines 228 and 281 and the alert delete at line 282 sit at the end of test bodies.
The `fx` teardown only withdraws posts, so a failed run leaves open cases in the shared database, where the live sweep keeps alerting on them and later queue specs meet them.
The journey alert is dated one hour ahead, so a leaked row also tops Recent alerts.

**Fix**: Track seeded post ids in `fx`, and close reports and delete alerts for that run in its teardown.

#### 6. The flag-order test asserts only that a result exists

**Severity**: P1 (High)
**Location**: `apps/api/integration/moderation-sla-delivery.integration.spec.ts:572`
**Row**: H10
**Provenance**: introduced

**Issue**: `resolves.toBeDefined()` is the only claim about a predictable result.
The explosive proxy catches an early database touch, while any wrong result object still passes.

**Fix**: Assert `.resolves.toMatchObject({ skipped: 1, recorded: 0, delivered: 0 })`.

#### 7. The target-size loop can run zero times and checks one axis

**Severity**: P1 (High)
**Location**: `playwright/tests/moderation-sla.spec.ts:422`
**Row**: H3
**Provenance**: introduced

**Issue**: `controls.all()` does not wait and may return nothing, so the loop asserts nothing on an empty `main`.
Line 424 checks height only, so a 20-pixel-wide control passes a 44-pixel target test.

**Fix**: Assert `await expect(controls).not.toHaveCount(0)` first, and assert width beside height.

#### 8. Due times come from the live clock

**Severity**: P1 (High)
**Location**: `playwright/tests/moderation-sla.spec.ts:179`
**Row**: H2
**Provenance**: introduced

**Issue**: Lines 179 to 181, 252 and 272 derive SLA due times and a detection time from `Date.now()` on the test host.
The worker runs on a real clock, so the margins of an hour or more keep the live flake risk low, and this is the least urgent High here.

**Fix**: Read `serverNow` from `GET /api/v1/moderation/sla` and derive seeds from it, so host clock skew has no effect.

#### 9. Navigation reads data with no readiness signal

**Severity**: P2 (Medium)
**Location**: `playwright/tests/moderation-sla.spec.ts:215`
**Row**: M1
**Provenance**: introduced

**Issue**: The receiver records the request before the worker writes `delivered`, so the page fetched here can read `pending` and hold it until the 60-second refresh.
Lines 184, 276 and 292 share the shape with less risk.

**Fix**: Register `interceptNetworkCall` for the SLA route before navigating, and use `recurse` on that read until all three rows report delivered.

#### 10. Two tests bypass the report factory

**Severity**: P2 (Medium)
**Location**: `apps/api/integration/moderation-sla.integration.spec.ts:288`
**Row**: M2
**Provenance**: introduced

**Issue**: Lines 288 and 311 build a report inline although `seedPostReport` exists and is already imported by the harness.

**Fix**: Call `seedPostReport`, or add a `laterReport` helper to the harness.

#### 11. A failure state is located by its copy

**Severity**: P3 (Low)
**Location**: `playwright/tests/moderation-sla.spec.ts:321`
**Row**: L1
**Provenance**: introduced

**Issue**: `getByText` with an English sentence breaks on a copy edit, and the catalog already holds that text.

**Fix**: Read the expected text from `en-US.json`, as the locale test in this file does, or scope it through a role.

---

### Decision

**Recommendation**: Block

---

### Reviewed Files

- apps/api/integration/helpers/moderation-sla-harness.ts
- apps/api/integration/moderation-sla.integration.spec.ts
- apps/api/integration/moderation-sla-concurrency.integration.spec.ts
- apps/api/integration/moderation-sla-delivery.integration.spec.ts
- apps/api/integration/moderation-sla-escalate.integration.spec.ts
- apps/api/integration/moderation-sla-route.integration.spec.ts
- apps/api/integration/moderation-sla-drill.spec.ts
- apps/api/integration/moderation-sla-docs.spec.ts
- apps/api/integration/support/moderation-sla-crash-worker.ts
- apps/api/src/modules/moderation/moderation-sla.rules.spec.ts
- apps/api/src/modules/moderation/moderation-sla.channel.spec.ts
- apps/api/src/modules/moderation/moderation-sla.controller.spec.ts
- apps/api/src/modules/moderation/moderation-sla.scheduler.spec.ts
- packages/api-client/testing/moderation-sla-contract.spec.ts
- packages/db/test/moderation-sla-schema.spec.ts
- apps/web/src/app/components/moderation-sla-dashboard.test.tsx
- playwright/tests/moderation-sla.spec.ts
- playwright/support/moderation-ops-capture.mjs

### Review Context

- \_bmad-output/implementation-artifacts/spec-6-12-sla-monitoring-escalation.md
- \_bmad-output/test-artifacts/test-design/cc612-sla-monitoring-test-design.md
- apps/api/src/modules/moderation/moderation-sla.sweep.ts
- apps/api/src/modules/moderation/moderation-sla.channel.ts
- apps/api/src/modules/moderation/moderation-sla.rules.ts
- apps/api/src/modules/moderation/moderation-sla.repository.ts
- apps/api/src/modules/moderation/moderation-sla.scheduler.ts
- apps/api/src/modules/moderation/moderation-sla.controller.ts
- apps/api/src/modules/moderation/moderation-sla.service.ts
- apps/api/src/modules/moderation/moderation-queue.repository.ts
- apps/api/src/workers/base.worker.ts
- apps/api/src/workers/bootstrap.ts
- apps/api/src/workers/community.bootstrap.ts
- apps/api/src/config/queues.ts
- apps/api/integration/helpers/moderation-queue-seed.ts
- apps/api/integration/helpers/moderation-queue-context.ts
- apps/api/integration/helpers/moderation-decisions-seed.ts
- apps/api/vitest.config.ts
- apps/web/vitest.config.ts
- apps/web/vitest.setup.ts
- apps/web/src/app/components/moderation-sla-dashboard.tsx
- scripts/start-api-e2e-with-workers.mjs

---

### Resolution

Fixed at `eee9c4b0` and `89288e62`, and proved by seeded defects S-21 to S-27 in the test design's Execution record.
This score describes `bb8491d5` and was not recomputed.

| Finding                                        | Outcome                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard no-write check                       | A catch-all recorder and a real refresh click. S-24 is red.                                                                                                |
| Analytics allow-list                           | An unlisted event now fails, and the snapshot keys are listed. S-21 is red.                                                                                |
| Snapshot body                                  | Compared whole against the snapshot event. S-21 is red.                                                                                                    |
| Two workers at the escalation guard            | A new test calls `escalateFailure` twice on two clients. S-22 is red.                                                                                      |
| Anchor tie order                               | Ids sort differently by byte and by locale, and the columns take an ICU collation during the test, because the Alpine default sorts by bytes. S-23 is red. |
| Stale monitor for one viewer                   | Runs a real sweep with the system subject off, then on. S-27 is red.                                                                                       |
| I-D-BULLMQ                                     | Production queue options and `createWorker`, scanning `JobFailure` and logs. S-26 is red.                                                                  |
| P-SLA-STABLE                                   | A `MutationObserver` from first paint, and a rendered count to wait on.                                                                                    |
| C-WEB-TIME                                     | Pinned zone and literal text. It exposed identical times in the repeated hour, fixed at `26ffaf5f`.                                                        |
| C-WEB-ANNOUNCE                                 | Counts announcements, and holds a response so the in-flight state renders. S-25 is red.                                                                    |
| I-P-CANARY                                     | Keeps the failing sends, asserts they exist, and scans comment reporter ids.                                                                               |
| Flag-order result                              | Asserts the exact counts.                                                                                                                                  |
| P-SLA-THEMES-WIDTHS                            | Asserts controls exist, and checks width too.                                                                                                              |
| Restored flag implementation and cleared flags | The route restores the original implementation, and route and escalate clear flags in `beforeEach`.                                                        |
| Playwright cleanup                             | Moved to `fx` teardown.                                                                                                                                    |
| Delivered row race                             | `recurse` on the rows before the page opens.                                                                                                               |
| Report factory bypass                          | Both now call `seedPostReport`.                                                                                                                            |
| English locator                                | Reads the catalog.                                                                                                                                         |
| I-R-SANCTIONED                                 | Pins status 200 on both routes.                                                                                                                            |
| Private field scan                             | Walks the published OpenAPI schema.                                                                                                                        |
| I-D-SKIP-LOCKED result                         | Asserts `delivered: 2, errors: 0`.                                                                                                                         |
| Reopen scan                                    | Matches a multi-column `SET`.                                                                                                                              |
| P-SLA-HOSTED-PATH                              | Reads the process tree under this run's launcher.                                                                                                          |
| Focus ring                                     | Compares the focused look with the resting look.                                                                                                           |
| Closed port                                    | Replaced by a dropped connection, so no parallel file can take the port.                                                                                   |
| Filler assertion, dead call, bare poll         | Removed.                                                                                                                                                   |

Declined, with the reason recorded:

- Live-clock due times in `moderation-sla.spec.ts`, rubric row H2. The real worker reads the real clock and cannot take an injected one, so a due time has to come from that same clock. Margins are an hour or more against a 60-second sweep, and the review rated the real risk low. Three burn-in runs showed no drift.
