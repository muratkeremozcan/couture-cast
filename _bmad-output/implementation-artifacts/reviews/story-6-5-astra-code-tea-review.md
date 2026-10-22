# Story 6.5 independent Astra code and TEA review

Updated: 2026-10-20. Frozen SOURCE_READY implementation review.

**Verdict: CHANGES_REQUIRED.** Findings below are independent reviewer findings awaiting
coordinator triage. Repairs require an exclusive assignment after all five reviews arrive.
The earlier READY judgment concerned the approved specification. The implementation has
concrete reconciliation, authorization and lifecycle defects. Final acceptance also has
explicit unexecuted gates; those gates are recorded separately.

## Runtime, activation and immutable evidence

- Verified this session's own latest `turn_context` before review:
  `2026-10-20T21:11:54.749Z`, model **gpt-6-astra**, reasoning effort **high**.
- Thread: `01a15aac-8690-7553-b15f-fc33a071c3fc`. Runtime evidence:
  `/Users/murat/.codex/sessions/2026/10/20/rollout-2026-10-20T13-56-58-01a15aac-8690-7553-b15f-fc33a071c3fc.jsonl`.
- Baseline HEAD: `aa8cd0e1f12ea778a9ca40b76c0868637f1b55a1`.
  Branch: `feat/story-6-5-realtime-engagement`. This is an uncommitted source snapshot.
- Independently hashed both immutable diffs in
  `/var/folders/3b/5kzs662j47v6vdz26gbkvlgc0000gn/T/couture65-code-review-0vw0taow/`:

| Artifact                     | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `all.diff`                   | `bd39e86827490dc6b83be6f0dee1aad0ad6ee2f7c47c5d79c7f1978671f9c8fe` |
| `source.diff`                | `a22b38990f8257ab87dcf9dd191993118e147cb969affdee392eb812420aff92` |
| `source-ready-manifest.json` | `e5ddae544aa29ec1bf6886f842cebae26fd786887516b78c79b115ea46d37bdf` |

Rehashed all 1,736 manifest paths. Only the authorized administrative story status and
`sprint-status.yaml` differed. Current story hash is
`2ea547aac17a98463c51fc389188256de355e676e98dc5a92e3bacc0955745a7`;
current design hash is `1f9d80e249fb9ab038d28442d04727ad3a5d498c0f735f86b715a00fd36fc4ea`.
The original specification approval remains bound to spec
`f6631b1ba026bec9eecaad516f0b3aeeba46883d51a36131cc5713e563c2efb2` and design
`91dc57ccbdcee454f879c87d08d8e1bdf3e4f883286f700cd31de7cc3cc36fdb` in the
[phase-one review](story-6-5-astra-final-story-review.md).

Read the project-local [TEA skill](../../../.agents/skills/bmad-tea/SKILL.md), AGENTS.md,
project context, source-ready evidence, implementation checkpoint, privacy writer inventory,
normative requirements and relevant actual source/callers. Team/user TEA overrides remain
absent. Both activation commands succeeded:

```text
uv run _bmad/scripts/resolve_customization.py --skill .agents/skills/bmad-tea --project-root /Users/murat/opensource/couture-cast --key agent
uv run _bmad/scripts/resolve_config.py --project-root /Users/murat/opensource/couture-cast --key core --key modules.tea
```

Persona Murat, English; prepend/append steps and persistent facts empty. Consulted tea-index
and the general library mandate, Playwright and Pact mandates, Pact MCP, test quality,
evidence integrity and mobile strategy guidance. Both utility flags are true and packages
are installed: playwright-utils 4.4.1 and pactjs-utils 1.1.0. Their mandates apply to their
respective runners. This is a conversational code/TEA audit; no scored test-review workflow
completion is claimed. Pact broker tools are unavailable, so provider source and canonical
contracts supplied the contract evidence. No broker result is claimed.

## Concrete findings

### ASTRA-C01: Anonymous resync leaves removed comments in an open thread

**P1. Privacy and realtime correctness.**

Evidence: `packages/api-client/src/community-sync-state.ts:119` discards the resync page and
restarts bootstrap. `:159` calls `rebuild`; the web callback at
`apps/web/src/app/components/community-lookbook-grid.tsx:2196` and mobile callback at
`apps/mobile/src/features/community/community-screen.tsx:674` rebuild only the feed.
Thread refresh occurs only in their `changed` callbacks (`:2227` and `:704`). Target
validation sends only post IDs (`community-sync-state.ts:194`), and its apply callbacks
replace post/reaction state. It supplies no authoritative thread page.

Reachable failure: another member deletes a published comment while its thread is open.
The removal becomes anonymous resync, the parent post remains available, and the client
never reloads the thread. Deleted text remains visible through a healthy socket session.
Fallback target validation also omits thread pages. This violates D3/D9 removal behavior.

An in-memory execution of the actual transpiled coordinator returned
`{"rebuilds":2,"threadRefreshCallbacks":0}` after bootstrap and anonymous resync.
This is a controlled coordinator observation, with the UI wiring established by source.

**Correction and proof:** make bootstrap/resync and fallback reconciliation refresh open
threads with their existing pagination bounds, drafts and focus ownership. Exercise remote
comment/parent deletion and consent loss on both actual screens with polling disabled;
assert removed text disappears and permitted draft/focus survives. Also make required
thread-refresh failures observable to the coordinator: `community-comments-state.ts:367`
catches a failed refresh and resolves, allowing `applyPage` to advance the cursor and
announce connected after a 503. A failed required refresh must preserve the unapplied
invalidation and put the view into the specified unavailable state.

### ASTRA-C02: A post snapshot revision consumes comment work it never fetched

**P1. Missed updates.**

Evidence: `packages/api-client/src/community-sync-state.ts:202` puts a target's
`communityRevision` into the same map used by `newerEvents` at `:143-147`. Target validation
requests no comment ID and does not read open thread pages. A later public comment event
at or below that revision is filtered before the screen's `changed` callback.

Reachable interleaving: capture stream head H, then a comment commits revision 7 while its
outbox remains unappended. Bootstrap resolves the post at revision 7. The appender later
publishes the comment event at revision 7 after H. The client advances its cursor but
never refreshes the comments. The same issue occurs when a target read sees a newer comment
than the event that triggered that read. Healthy sockets have no periodic repair.

The actual-source in-memory probe observed snapshot revision 7, subsequent comment event
revision 7, three event-page reads, and **zero comment-refresh callbacks**.

**Correction and proof:** separate projection freshness from invalidation consumption, or
advance a revision only after every affected authoritative view is reconciled. Retain stale
response fences. Add a deterministic head/view/append barrier test and a component test with
an already-open thread. The existing shared tests return empty target arrays and cannot
exercise this crossing (`packages/api-client/testing/community-sync-state.spec.ts:29-39`).

### ASTRA-C03: Buffered new looks can reinsert withdrawn content

**P1. Visibility invalidation.**

Evidence: web `community-lookbook-grid.tsx:2186-2193` and mobile
`community-screen.tsx:663-670` retain incoming objects in `newLooks`. The `rendered` lists
at web `:2197` and mobile `:675` exclude this buffer. Unavailable target handling removes
items/open detail, but does not evict `newLooks`. Rebuild merges incoming objects with the
previous buffer. The insertion actions at web `:2746` and mobile `:1233-1238` directly add
the cached objects without current authorization or target resolution.

Reachable failure: receive a new look, leave the announcement pending, then its author
withdraws it. Anonymous resync validates the existing visible cards and leaves the buffer.
Clicking the announcement inserts the withdrawn caption/image. With the removal cursor
already consumed and a healthy socket, the stale card can remain until another event.

**Correction and proof:** include buffered targets in invalidation ownership and prune them
on authoritative resync; resolve current visibility before insertion. A late buffer read
must lose to an eviction. Add web/mobile tests for publish, queue, withdraw, resync, then
insert; assert neither the removed card nor its image/caption appears.

### ASTRA-C04: Web notification resolution can reopen an evicted target

**P1. Stale-response privacy fence.**

Evidence: `apps/web/src/app/components/community-lookbook-grid.tsx:2343-2371` owns the
notification target request with only an effect-local `active` boolean. On resolution it
calls `setOpenedItem(target.post)` directly. The effect's dependencies at `:2380` are
session scope and highlighted card. Realtime eviction/unavailability increments
`detailGenerationRef` at `:2205`/`:2237`, but this request never captures or checks that
generation or the reaction-state eviction ticket. The neighboring legacy detail request
does check both. The mobile comment-target request also checks detail ownership.

Reachable failure: hold a valid target response in transit, withdraw the post, let the
realtime resolver evict it, then release the old response. The highlighted card and session
remain unchanged, so `active` is true and the old post reopens with comment focus.

**Correction and proof:** bring this resolver under the same request/revision/eviction
ownership as other detail reads. Test actual web rendering with the old target response
released after withdrawal and after unavailable/denied control. It must not reopen or move
focus. A current same-owner target must still open the exact requested reply once.

### ASTRA-C05: Authorization has no enforceable end-to-end two-second bound

**P1. Availability and authorization freshness.**

Evidence: `community-flag-evaluation.service.ts:47` computes a deadline, but `read` at
`:58-65` awaits an ordinary Prisma query without a request deadline. The first read at `:80`
and subsequent reads can exceed the budget; the fresh-cache return at `:87` does not check
the elapsed deadline. Claim/completion transaction limits cover only those transactions.
`community-access.service.ts:23-26` then performs further database eligibility work after
the flag result. The websocket tick awaits assist/head queries before revalidation
(`community-realtime.server.ts:113-139`), schedules its next tick after work completes, and
records `checkedAt` at completion (`:144`). It cannot enforce D1's start-at-most-eight-
seconds and complete-within-ten-seconds requirements under dependency delay.

**Executed probe:** the actual flag service, transpiled in memory with a controlled 2,100ms
database read, returned **true after 2,102ms**. It made zero remote calls. Exact command and
output are preserved below. This proves the local deadline control gap; it makes no claim
about deployed database latency.

There is also an expiry edge on this same authorization path: `resolve` retains `valid`
from before awaiting `claim` and can return it at `:96-98` after its expiry. The feature-flag
wrapper retains only its boolean, so the subsequent eligibility reads and final socket
emission have no expiry proof to check. An initial valid observation cannot establish
validity at serialization/emission.

**Correction and proof:** carry an absolute authorization deadline and verified expiry
through all dependent reads to final use, with bounded database/pool waits and typed 503 or
socket unavailable on failure. Revalidation scheduling needs start-based deadlines that
cannot be blocked by append/head work. Prevent late work from granting expired access.
Add held DB/pool/read probes, expiry during claim/read, a delayed owner completion, and
healthy cache-boundary concurrent requests. Assert actual HTTP/control completion and
remote call counts. The current HTTP test at
`apps/api/integration/community-sync-http.integration.spec.ts:258` mocks an immediate
undefined provider result; it demonstrates that fast failure path only.

### ASTRA-C06: Native registration cannot recover after the server prunes its binding

**P2. Durable native lifecycle failure.**

Evidence: `apps/mobile/src/lib/native-notifications.ts:120-134` always includes the locally
stored expected registration/generation when one exists. It has no `binding_changed`
reconciliation path. `push-registration.service.ts:37` rejects an expected binding whose
row is missing. Server retention deletes inactive bindings after 30 days
(`community-retention.worker.ts:10-24`); invalid-token ticket/receipt handling also removes
bindings through `community-receipts.worker.ts:128-145`.

Reachable failure: the app returns after retention or after an invalid-token cleanup. Secure
storage still has the old binding, so every startup/foreground/enable request receives 409.
The old local record survives each failure. A new OS token alone does not recover it.

**Correction and proof:** reconcile a missing/stale server binding with authenticated owned
registration state and safely refresh the local expectation. Preserve generation and
explicit-transfer protection against another owner. Test retention, invalid-token cleanup,
same-owner retry and concurrent cross-account transfer through real wrappers and the real
registration service. Current native tests cover three enablement cases with an always-
successful registration handler (`native-notifications.test.ts:61-80`), so they miss this.

### ASTRA-C07: Enabled-only preference PATCH reports success but drops new work

**P2. Valid contract path loses notifications.**

Evidence: the canonical PATCH permits `{baseRevision, enabled:true}`. The settings snapshot
defaults missing account preferences to push enabled (`community-preferences.service.ts:39`).
PATCH creates the community preference at `:88`, but creates `NotificationPreference` only
when quiet-hour fields are present at `:104-122`. No account-preference creation exists in
signup/profile initialization. `CommunityNotificationsWorker.group` at `:74-82` permanently
sets new intents `deliverable:false` when that account row is absent. The native enablement
helper itself issues enabled-only PATCH (`native-notifications.ts:180-184`), before the
settings screen's separate full-policy write.

Reachable failure: a member who has never saved weather settings uses the valid enabled-only
operation. GET/PATCH reports enabled and push enabled, while subsequent engagement intents
are discarded. Interruption between the native screen's two writes leaves that state.

**Correction and proof:** atomically materialize the shared policy defaults when enabling,
or consistently apply those defaults throughout qualification/send. Preserve existing
weather policy. Start with no preference rows, PATCH enabled only, qualify an engagement and
assert provider-observed delivery. The current HTTP test supplies all quiet-hour fields;
the delivery fixture inserts both rows directly, masking this path.

### ASTRA-T01: The savepoint test does not exercise production candidate rollback

**P2. Required concurrency proof is ineffective against an implementation regression.**

Evidence: `apps/api/integration/community-stream.integration.spec.ts:154-196` manually
executes SAVEPOINT, locks and ROLLBACK on a separate pg client. It never invokes
`CommunityStreamRepository.prepareCandidate` for the contested candidate. Removing the
production rollback at `community-stream.repository.ts:142` or `:154` leaves this test
unchanged. Its lock observations compare counts, rather than the exact retained/released
keys required by D2/N4. The separate busy-oldest test establishes eventual append output,
but does not inspect the appender's held locks before transaction completion.

**Correction and proof:** retain the PostgreSQL semantic probe as supporting evidence and
add a production appender test with a deterministic barrier after its skip. Inspect that
backend PID and exact key identities while the transaction is alive. Verify candidate
advisory release, retained earlier locks and a second backend's immediate row NOWAIT claim.
Demonstrate that removing the production rollback makes the regression test fail.

## Coverage and quality assessment

The eight retained SOURCE_READY results all report exit 0,
`sourceChangedDuringRun:false`, and manifest `e5ddae544...`. I read their command/result
records; I did not rerun those suites. Scope is API/mobile/web types, changed-source lint,
core 166 tests, shared 126 tests, mobile 106 tests and web 127 tests, as recorded by the
implementer. These counts are scoped suite totals, not completed story acceptance IDs.

Useful evidence includes actual isolated PostgreSQL migration/RLS paths, real HTTP wrappers
against Nest routes, a recording HTTP push provider, two local Socket.IO instances, and
barriers for late normalization/screening. Source inspection supports commit-serialized
append counters, scoped signed cursors, separate private streams, strict new contracts,
durable sending/unknown and generation-conditioned weather pruning in both compositions.
The global privacy namespace/order and capability default-off are visible in the migration;
runtime success of every writer remains unproved.

Important limits and exact next proof obligations:

| Boundary        | Current evidence and required completion                                                                                                                                                                                                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stream/snapshot | Local source commit/abort and concurrent append tests exist. Add production savepoint observation, busy-prefix fairness and source/view/append races against the actual coordinator. Test cursor retention/reset and no stale response revival.                                                                                                                                        |
| Auth/profile    | API metadata/verified-email mapping and native profile identity have unit/HTTP-boundary tests. Actual Supabase OTP restore/refresh/logout, sub differing from User.id, both mappings, web startup/session switching and token-expiry socket behavior still need real-session evidence.                                                                                                 |
| Flag/cache      | Cold two-instance single flight and immediate failure timings exist. Refresh-at-45/hard-60 contention, request deadline/expiry crossings, paused owner, cancellation and real call-rate/spend need execution, including ASTRA-C05.                                                                                                                                                     |
| Privacy/send    | Accepted replay and missing-ticket unknown use a real recording endpoint. Execute owned-process death/suspension/network loss, maximum server guard lifetime, each actor/recipient/post-author/parent-author mutation entry point, all privacy writers, rollback/late callback and surviving-contributor recomputation. Keep provider-observed request counts and immutable deadlines. |
| Weather/token   | INT-023 calls deleteBindings directly after transfer. It does not run held weather fanout/provider completion through Nest and standalone bootstrap. Both actual caller-chain races remain required, plus native recovery in ASTRA-C06 and receipt/retention/cascade races.                                                                                                            |
| UI              | Shared coordinator tests mock transport. Web setup replaces `CommunitySyncState.start` with a no-op (`apps/web/src/test-utils/community-lookbook-grid.tsx:345`). Mobile has one useful real-coordinator passive-reaction component case. Add actual-screen comment/removal/resync/buffer/late-target cases above, then two-identity browser socket/fallback evidence.                  |
| Native          | Three enablement and three session tests mock SDK/OS boundaries. Existing build results establish buildability only. Execute warm/background/cold taps, exact off-page reply focus, permissions, refresh, rotation, logout/account switch, offline cleanup and return-after-pruning on both platforms; retain physical provider-to-device ticket/receipt/display/tap evidence.         |
| Contracts       | New strict schemas and generated wrappers exist; HTTP tests cover selected routes. New Pact consumer/provider interactions are absent from the reviewed change. Add actual-wrapper interactions, legacy compatibility assertions, provider verification and Optic evidence using the configured utilities.                                                                             |
| Hosted/capacity | Distinct Vercel HTTP-server export, PG17 CI image and 36-connection guard configuration exist. Prove protected exact-path upgrade, cross-instance/duration reconnect, deployed version/timeouts/pooler behavior, aggregate connection budget, independent loop progress, max(500,H) herd plus normal traffic, deadline distributions and metered spend.                                |

For target pagination, the current HTTP test checks truthy cursors at
`community-sync-http.integration.spec.ts:253-254`; the remaining integration must consume
those cursors through the actual comments wrapper and reach/focus the exact off-page row.
For native token rotation, exercise the actual listener callback with its delivered token
while another registration is in flight. The source ignores that callback payload and joins
the current flight; SDK-boundary tests need to establish that the newest token is eventually
bound without a reentrant token lookup loop.

No utility mandate violation is inferred from Vitest's raw fetch/pg calls: those files do
not run under Playwright. New Playwright and Pact suites must use the configured utility
patterns and document justified deviations. No score or coverage percentage is fabricated.
Required `verify:changed`, full `validate`, Pact, Optic, native and deployed lanes stay open.
No optional assertion or accepted skip can replace those lanes.

Primary documentation checked for the recommendations: PostgreSQL's
[timeout semantics](https://www.postgresql.org/docs/17/runtime-config-client.html),
[Expo notification lifecycle APIs](https://docs.expo.dev/versions/latest/sdk/notifications/),
[Playwright assertions](https://playwright.dev/docs/test-assertions) and
[Vitest clock control](https://vitest.dev/guide/mocking/timers).
Installed Expo source additionally documents the token-listener reentrancy caveat in
`node_modules/expo-notifications/src/TokenEmitter.ts:9`; `getExpoPushTokenAsync.ts:52`
accepts a delivered device token or invokes device-token lookup.

## Exact authorization-deadline probe

Executed from `/Users/murat/opensource/couture-cast`. Exit code 0. Actual application source
was read and transpiled in memory. Decorators and database/provider boundaries were replaced
by controlled objects. No application file, test file, database or external service changed.
This was a reviewer probe, not a retained suite pass or deployed performance measurement.
The probed source SHA-256 is
`53336d35902d43ebb9fc7c53f9a4fe720429eba51936cb1b3a7743a0ad2233ce`, matching the
SOURCE_READY manifest before and after review.

```sh
node <<'JS'
const fs=require('fs'),ts=require('typescript'),vm=require('vm');
const p='apps/api/src/modules/feature-flags/community-flag-evaluation.service.ts';
const m={exports:{}};
class Unavailable extends Error{}
const fakeRequire=(id)=>id==='@nestjs/common'?{Inject:()=>()=>{},Injectable:()=>()=>{},ServiceUnavailableException:Unavailable}:id==='@prisma/client'?{}:id.includes('remote-feature-flag-provider')?{InjectRemoteFeatureFlagProvider:()=>()=>{}}:require(id);
vm.runInNewContext(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText,{module:m,exports:m.exports,require:fakeRequire,Date,Map,Promise,AbortSignal,setTimeout});
(async()=>{let calls=0;const service=new m.exports.CommunityFlagEvaluationService({$queryRaw:()=>new Promise(resolve=>setTimeout(()=>{const now=new Date();resolve([{remote_value:true,now,remote_evaluated_at:now,expires_at:new Date(+now+60000)}]);},2100))},{getFeatureFlagValue:async()=>{calls++;return true}});const start=performance.now();const result=await service.evaluate('synthetic'); console.log(JSON.stringify({probe:'actual flag evaluator transpiled in memory; controlled slow database read',elapsedMs:Math.round(performance.now()-start),value:result.value,remoteCalls:calls}));})();
JS
```

Observed stdout:

```text
{"probe":"actual flag evaluator transpiled in memory; controlled slow database read","elapsedMs":2102,"value":true,"remoteCalls":0}
```

## Phase-boundary checkpoint and handoff

Coordinator: `wKS:p1`. Original source owner: `cc65-sol`, frozen. Reviewer: verified
gpt-6-astra/high with project-local TEA mandates retained. Findings ASTRA-C01..C07 and
ASTRA-T01 await coordinator triage with the other four reviews. Preserve source-ready
manifest/diffs and this probe before assigning repairs. Do not interpret an idle reviewer
as a completed remedy. Rereview must bind to the assigned repair's exact source identity and
fresh execution evidence, with original failures retained.

This review wrote only this artifact. It ran read-only source/integrity checks and three
small in-memory probes. It made no source/test/spec edits, staging, commit, push, deployment,
merge or expensive build. No process was signaled. No approval/escalation was requested or
denied. Production rollout remains disabled. Native/hosted/fault/privacy/herd/performance,
Pact/Optic and full-quality acceptance remain required and unwaived.
