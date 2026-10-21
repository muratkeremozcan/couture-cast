# Story 6.5 final independent Astra story review

Updated: 2026-10-20. Independent TEA review of frozen iteration 3.

**Verdict: READY for implementation.**

The specification makes the required architecture and acceptance decisions concrete. I found
no remaining specification blocker in the exact inputs below. Completion still requires every
D10 execution lane and its retained evidence. This review grants no production rollout or
release approval. Required preflight observations and runtime measurements remain unexecuted.

## Runtime and reviewed inputs

- Active model: **`gpt-6-astra`**.
- Active reasoning effort: **`high`**.
- Runtime evidence: this session's own `turn_context`, timestamp
  `2026-10-20T19:08:28.730Z`, records `"model":"gpt-6-astra","effort":"high"`.
  Session ID is `01a15aac-8690-7553-b15f-fc33a071c3fc`; metadata identifies `codex-tui`
  version `0.163.0`. I read the metadata before activation and rechecked it before this
  verdict. Both recorded turn contexts agree on model and effort.
- Runtime evidence file:
  `/Users/murat/.codex/sessions/2026/10/20/rollout-2026-10-20T13-56-58-01a15aac-8690-7553-b15f-fc33a071c3fc.jsonl`.
- Repository HEAD: `aa8cd0e1f12ea778a9ca40b76c0868637f1b55a1`.
- Coordinator: Codex Herdr `wKS:p1`. Amendment editor: `cc65-doc-editor`, `wKS:p3`.
  The editor's Sol provenance remains separate from this independent Astra verdict.

| Frozen input                                                           | Verified SHA-256                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Story, iteration 3](../spec-6-5-realtime-engagement-notifications.md) | `f6631b1ba026bec9eecaad516f0b3aeeba46883d51a36131cc5713e563c2efb2` |
| [Normative design](../6-5-realtime-engagement-design.md)               | `91dc57ccbdcee454f879c87d08d8e1bdf3e4f883286f700cd31de7cc3cc36fdb` |

Both hashes were computed locally with `shasum -a 256` after AMENDMENTS_READY and checked
again immediately before writing this verdict. The initial iteration 2 hashes supplied in
the request also matched before review began. This approval applies to the iteration 3
hashes in the table.

## TEA activation and independence

Read the complete project-local
[TEA skill](../../../.agents/skills/bmad-tea/SKILL.md), `AGENTS.md`,
`_bmad-output/project-context.md`, `epic-6-context.md`, the entire initial story/design,
both historical review artifacts, the Opus rereview 2 addendum, and the amended story and
design requirements. Existing review conclusions were treated as hypotheses to check against
source and primary documentation.

The team and user TEA customization files were absent; no legacy menu override required
migration. Both resolver commands succeeded:

```text
uv run /Users/murat/opensource/couture-cast/_bmad/scripts/resolve_customization.py --skill /Users/murat/opensource/couture-cast/.agents/skills/bmad-tea --project-root /Users/murat/opensource/couture-cast --key agent
uv run /Users/murat/opensource/couture-cast/_bmad/scripts/resolve_config.py --project-root /Users/murat/opensource/couture-cast --key core --key modules.tea
```

Resolved persona: Murat, Master Test Architect, icon 🧪; English communication and documents.
Prepend steps, append steps and persistent facts were empty. The review remained in
conversation with menu/workflow unset: the requested deliverable is a pre-implementation
story-readiness judgment.

Consulted `tea-index.csv` and loaded the library integration, Playwright utilities, Pact
utilities, Pact MCP, evidence-integrity, mobile-test-strategy and test-levels guidance,
plus the risk-governance criteria. Both utility flags resolve true; root dependencies contain
`@seontechnologies/playwright-utils` 4.4.1 and `@seontechnologies/pactjs-utils` 1.1.0.
Their mandates apply to the corresponding future suites. Existing merged fixtures and
isolated database/barrier patterns provide suitable foundations.

Pact broker: unreachable (SmartBear MCP tools not available). Provider evidence came from
repository source and canonical contracts. No broker compatibility result is claimed.
Context7 supplied official Socket.IO guidance. Relevant current primary documentation was
also checked directly; references accompany the assessments below.

## Findings resolved in the frozen amendment

### 1. Shared flag-cache expiry and unavailable semantics

Iteration 2 could turn a healthy losing refresh request into a denial and clear its view.
Independent source inspection also confirmed that the existing flag resolver falls back to
a synthetic-subject record: `packages/config/src/flags.ts:249` and
`apps/api/src/modules/feature-flags/feature-flags.service.ts:80`. That record cannot prove
a real member's cohort membership.

D1 now requires one shared claim, refresh eligibility at age 45 seconds, a hard 60-second
validity, and database-time origin before remote invocation. Claim ownership, generation,
`next_claim_at`, and conditional completion prevent stale owners from extending authority.
Cold/expired callers wait within the remaining claim and their two-second authorization
budget; the one-second remote deadline reserves overhead. Final serialization, doorbells
and send authorization recheck expiry.

Typed dependency-unavailable responses hide content and preserve permitted drafts for retry.
Affirmative false and actual eligibility/authentication failures have their explicit denial
behavior. D6 also preserves unstarted notification work and its original deadline on unknown
eligibility. This resolves the cache race without granting expired access.

The arithmetic is correct: `3600 / 45 = 80` nominal evaluations/member/hour, and
`80 * 24 * 30 * 100 = 5,760,000` calls per 30 days for 100 continuously active members.
The additional rolling-hour boundary forecast is explicitly separated from measured
failure-path counts. D10 still requires cold-start, contention, paused-owner and retry
measurements plus actual spend. Shared caching is consistent with
[PostHog's cost guidance](https://posthog.com/docs/feature-flags/cutting-costs).

### 2. Shared weather cleanup must preserve transferred bindings

Independent source evidence identifies the complete existing pruning chain:

- `alerts/alert-fanout.repository.ts:63` selects token strings without binding identity.
- `alerts/alert-fanout.processor.ts:235` passes those strings into message construction.
- `notifications/push-notification.service.ts:190` calls raw-token cleanup.
- `notifications/push-token.repository.ts:58` deletes matching token strings.
- `notifications/notifications.module.ts` and `workers/bootstrap.ts:130` compose that path.

A delayed invalid-token outcome from the old owner can therefore remove a newly transferred
registration if this chain is retained unchanged. D7 now explicitly requires captured
registration ID, owner and generation through every shared caller, with conditional pruning
in both Nest and standalone-worker compositions. INT-019..024 must hold the old weather
result, transfer the same token through the real endpoint, then assert zero deletion of the
new binding. This is a concrete implementation obligation under the existing token invariant.

### 3. Real authentication must use the canonical application identity

`apps/mobile/src/lib/wardrobe.ts:196` derives ownership from JWT `sub`.
`apps/api/src/modules/auth/access-token-identity.service.ts:291` resolves the application
identity through trusted `app_user_id` or verified-email mapping. Those identifiers can
differ. The existing guarded profile endpoint exposes the canonical application user.

D5 now requires profile-resolved client identity and a native probe where Supabase `sub`
differs from application `User.id`. It covers wardrobe, community, token registration and
account switching through both supported mappings. Harness Admin generation followed by
real client OTP verification exercises the session boundary using supported
[generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink) and
[verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp) APIs.

### 4. Database version and infrastructure evidence are explicit

`supabase/config.toml:34` selects PostgreSQL 17 locally.
`.github/workflows/pr-checks.yml:41` still selects `postgres:16-alpine`.
The frozen D10 text requires updating affected isolated CI services and asserting actual
`server_version_num >= 170000`, effective timeouts and pooler behavior at runtime.
Local configuration establishes no CI or deployed compatibility result.

D7's server-side transaction timeout is supported in
[PostgreSQL 17](https://www.postgresql.org/docs/17/runtime-config-client.html).
D10 now budgets all API, gateway and worker pools, including deployment overlap and control
headroom. Each active guarded transaction needs a server connection; a configured client
pool of 36 does not establish available server capacity. The existing project's actual
connection path and limits remain mandatory preflight evidence under
[Supabase's connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Independent architecture assessment

| Boundary                                      | Readiness assessment and retained proof obligation                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordering and snapshot handoff, D2/D3          | The transactional counter lock lasts through append commit. A later visible sequence cannot pass an earlier invisible allocation from another appender. Bootstrap heads precede authoritative primary views, then replay starts strictly after those heads. Per-post revisions handle source/append skew; doorbells never advance cursors. Real concurrent transactions must prove the argument.               |
| Privacy and global lock order, D2/D7/D8       | Dedicated shared privacy guards avoid the engagement locks held by ordinary reactions/comments. Exclusive privacy writers enter before member/report/submission keys and post rows. Source inventory confirms those existing key families. Appender try-lock/savepoint acquisition and final NOWAIT heads avoid waiting backwards. Every cross-feature writer and trigger still needs implementation coverage. |
| Guard lifetime and erasure, D7/D8             | PostgreSQL-enforced three-second transaction lifetime, shorter statement/lock limits, ten-second leases, conditional recovery and durable pending erasure make failure behavior explicit. Process suspension and lost database paths must prove release and recovery. The documented external handoff interval accurately preserves uncertainty.                                                               |
| Expo uncertainty and receipts, D6/D7          | Durable `sending` precedes the single provider call. Ambiguous outcomes become terminal `unknown`; recovery cannot resend them. Explicit safe rejection and proven no-call work have bounded handling. Receipt cleanup is generation-scoped, and accepted sibling tokens remain settled.                                                                                                                       |
| Visibility and legacy compatibility, D3/D4/D9 | Public/private streams and new preferences/target envelopes preserve strict legacy schemas and keep community rows out of the global legacy poll table. Anonymous removals, request generations, current visibility and off-page target resolution cover stale fetches and exact focus.                                                                                                                        |
| Healthy socket and fallback, D1/D3            | Dedicated Vercel HTTP-server export and websocket-only clients have a concrete hosted path. Server revalidation starts within eight seconds and completes within its two-second budget. Periodic client polling is fallback-only; the socket-success lane disables it.                                                                                                                                         |
| Auth and native lifecycle, D5/D10             | Real session restore/refresh/logout, protected native storage, permission/token binding, rotation, cold/warm/background responses and canonical identity are required. Both platforms retain actual OS-tap and separate provider-to-device evidence.                                                                                                                                                           |
| Qualification and capacity, D6/D10            | Logical source/recipient identities, reaction re-add tombstones, opt-in generations, shared quiet hours, DST rules and original deadlines are explicit. The 32-slot calculation yields a 57-second scheduling target for 600 operations. Measured full-path deadlines, pool capacity and the largest actual timezone herd decide acceptance.                                                                   |

Source checks included reaction and comment repositories/processors, guardian revocation,
withdrawal/erasure, moderation actions, migration-owned reaction triggers, legacy events and
alert schemas, the shared comments state, API deployment configuration, mobile root/config,
worker composition, existing integration barriers and Playwright fixtures.

PostgreSQL documents transaction-end locking and savepoint rollback behavior. D2 strengthens
the proof with exact advisory-key observations and a second backend's immediate row claim.
The latter matters because row locks are generally absent from `pg_locks`.
See [locking](https://www.postgresql.org/docs/current/explicit-locking.html),
[advisory key spaces](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS)
and [lock inspection](https://www.postgresql.org/docs/17/view-pg-locks.html).

Vercel documents exported Node HTTP servers, Socket.IO websocket transport, instance affinity
and duration expiry. The selected topology is implementable; protected-preview upgrade and
cross-instance/reconnect evidence remain required.
See [Vercel WebSockets](https://vercel.com/docs/functions/websockets).
Socket.IO's durable server replay remains application work, which D2/D3 supply.
See [delivery guarantees](https://socket.io/docs/v4/delivery-guarantees).

Expo's handoff can duplicate or lose messages, and receipts describe provider handoff.
The story correctly limits its guarantee to logical dedupe and no ambiguous resend.
See [Expo guarantees](https://docs.expo.dev/push-notifications/faq/) and
[tickets/receipts](https://docs.expo.dev/push-notifications/sending-notifications/).
The installed notification source exposes response listeners and last-response clearing;
the current mobile root only consumes received-notification analytics. D5 must implement
the required response lifecycle using the supported
[notification APIs](https://docs.expo.dev/versions/latest/sdk/notifications/).

## Required implementation and delivery gates

All remain open until executed against the implementation:

1. INT-001..011: commit/append races, aborts, rollback-to-savepoint lock release, worker-down
   assistance, public/private and legacy isolation, RLS, auth expiry and cache boundary races.
2. INT-012..024: provider-observed request counts through process death, response loss and
   rolled-back outcomes; every privacy subject and entry point; shared weather pruning,
   transfer, server timeout and erasure completion. Signal only owned process IDs.
3. UNIT/CONTRACT: quiet-hour/DST/expiry/dedupe policies, stale-state rejection, canonical
   wrapper parsing, old-client compatibility, Pact and Optic.
4. E2E/OPS: two identities, real database/worker, passive updates, polling-disabled socket
   success, forced fallback, draft/focus preservation, protected-preview upgrade on the exact
   path, separate instances, duration reconnect and compatible rollout/rollback.
5. MOBILE: real auth and registration on notification-capable iOS/Android builds, permission
   denial, rotation, account switching, exact paginated reply focus, unavailable fallback,
   warm/background/cold OS taps, plus actual nonproduction provider-to-device proof.
6. PERF: every surviving eligible token within its original deadline for `max(500, H)` plus
   normal traffic, capacity and worker-stall independence, actual aggregate pool/RSS/query
   load, flag invocations and metered spend. The 57-second calculation supplies no measurement.
7. Required quality checks and evidence manifest: scoped tests, `verify:changed`, full
   `validate`, Pact, Optic and native flows; exact build identities, executed IDs, failures,
   retries, timing distributions, provider ledgers, traces, screenshots and native artifacts.

The test architecture assigns database concurrency to integration, contract compatibility to
real wrappers, and OS handoff to native devices. Playwright supports the necessary managed
service topology; Pact covers consumer/provider contracts. Required failures must propagate
through CI. The existing quality workflow has an explicit final failure step after its
artifact-producing checks, which must retain that behavior.
See [Playwright web servers](https://playwright.dev/docs/test-webserver),
[Pact scope](https://docs.pact.io/getting_started/what_is_pact_good_for) and
[GitHub failure handling](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepscontinue-on-error).

## Scope and handoff

This session wrote only this review artifact. It made no source, story, design, workflow,
migration or historical-review edits, and performed no application test execution,
deployment, commit, push, merge or production rollout. No runtime capacity, native delivery,
hosted upgrade or timeout measurement is claimed. No process was signaled. No approval
request or automatic approval denial occurred.

**READY** permits the coordinator to begin the fresh implementation phase against the frozen
inputs. Required infrastructure/native access and measurements remain completion gates.
Production community rollout remains disabled. This reviewer remains available for assigned
code review, TEA evidence review and test remedies.
