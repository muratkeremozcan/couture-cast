---
title: 'Story 6.5: Realtime engagement and notifications'
type: 'feature'
created: '2026-10-20'
status: 'in-review'
baseline_commit: 'aa8cd0e1f12ea778a9ca40b76c0868637f1b55a1'
route: 'dispatch'
story_key: '6-5-realtime-engagement-notifications'
review_loop_iteration: 3
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/6-5-realtime-engagement-design.md'
---

<frozen-after-approval reason="owner delegated delivery and phased peer approval">

## Intent

Members receive fresh community posts, reactions, and comments without manual refresh.
Opted-in members receive timely engagement pushes and can open the visible target accessibly.

## Boundaries and constraints

Preserve existing screening, visibility, age, consent, authentication, RLS and rollout controls.
Public events originate from committed publication or engagement changes.
Pending comments remain author-private.
Event data contains identifiers and revision metadata; clients resolve current visible content.
Removal and socket doorbells carry generic invalidations; private events have separate streams.
Community push requires explicit default-off opt-in, OS permission, registered token ownership,
the global push switch and shared account quiet hours.
Notify the post author for reactions/comments and the parent-comment author for replies,
deduplicating recipients and excluding the actor.
Removal/replacement, retries and replay must not produce repeated engagement pushes.
Respect current eligibility, visibility, consent and preferences at delivery.
Support localized web and mobile controls and accessible focus without disrupting active composition.
Keep production community rollout disabled.
Use existing Vercel, Supabase, Redis and Northflank infrastructure; add no paid subscription.
Deployed WebSocket operation, real session/token registration and native notification taps
are required for completion.
Following, mentions, spotlight ranking, moderator UI and branded sharing remain outside this story.

## I/O and edge-case matrix

| Scenario                                        | Expected behavior                                                |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| Committed publication/reaction/comment          | Durable versioned event; visible clients refresh once            |
| Rollback, duplicate job or mutation replay      | No phantom event or duplicate logical notification               |
| Concurrent commit, reconnect, delayed packet    | Commit-safe append cursor; per-post revisions prevent regression |
| Socket outage or expired cursor                 | Bounded fallback/resync; deployed healthy lane uses WebSockets   |
| Hidden/deleted target, consent loss, flag off   | Suppress delivery; discard stale fetches; safe link fallback     |
| Opt-out, self-action, quiet hours               | No immediate push; retain preference control                     |
| Ambiguous acceptance or worker crash after send | Terminal uncertainty; no resend of that token attempt            |
| Explicit rejection or invalid-token receipt     | Bounded safe retry or generation-scoped token cleanup            |
| Native notification opened warm/background/cold | Wait for auth/router; resolve exact visible target; focus once   |

</frozen-after-approval>

## Code map

- `apps/api/src/modules/community/`: repositories commit reactions/comments; moderation worker publishes posts/comments.
  Existing outboxes and member-before-post locking establish durable retry and privacy patterns.
- `apps/api/api/index.ts`, `apps/api/vercel.json`: existing REST function has a 25-second limit.
  Add a separate `api/realtime.ts` HTTP-server export and explicit WebSocket route.
- `apps/api/src/modules/events/`, gateway and legacy alert contracts: preserve current wire contracts.
  New community streams/preferences have separate endpoints and API-only storage.
- `apps/api/src/modules/notifications/`: reuse persistence conventions; community gets a single-attempt
  provider adapter, durable uncertainty and receipt handling.
- `packages/api-client/src/types/socket-events.ts`: retain strict legacy `lookbook:new`; add community doorbell.
- `packages/db/prisma/schema.prisma`: event envelopes, push tokens and notification preferences.
  Current `push_enabled` defaults true, so it cannot establish community opt-in.
- `packages/api-client/src/community-comments-state.ts`: shared drafts, request ownership and visibility fences.
- `packages/utils/src/deep-link.ts`: community notification parser already requires `cardId`.
- Web `community-lookbook-grid.tsx` and mobile `community-screen.tsx`: existing detail/comment focus and safe fallback.
- Mobile auth resolver and root layout: production session, token registration and response lifecycle gaps.

## Tasks and acceptance

The linked [design](6-5-realtime-engagement-design.md) is normative for policies, locking,
contracts, numeric limits and evidence. D1-D10 identify implementation and review boundaries.

**Execution:**

- [ ] D2/D8: schema/migrations for transactional domain outboxes, public/private stream heads/events,
      per-post revisions, notification state, subject generations/links, API-only RLS and retention.
- [ ] D2/D3: all publication/engagement/removal producers take existing member/post locks;
      append committed outboxes under counter locks through commit. Worker, gateway and catch-up
      can assist with bounded idempotent batches. Implement snapshot/replay and typed resync.
- [ ] D1: deployable dedicated Vercel Socket.IO function, websocket-only clients, authenticated
      eligibility, cross-instance head checks, duration reconnect and measured preview preflight.
- [ ] D3/D4/D5: canonical community sync/preferences/target and owned token-registration contracts;
      real wrappers, OpenAPI/SDK generation and legacy compatibility.
- [ ] D5: verified Supabase session bridge on web/mobile, native secure persistence/refresh,
      OS permission, Expo registration/rotation/unbind, startup and response listeners.
- [ ] D6/D7: qualifying intent identities, recipient union, token fanout, coalescing, quiet-hour/DST
      evaluator, expiry, guarded dispatch, terminal uncertainty, tickets/receipts and conditional cleanup.
- [ ] D7/D8: dedicated privacy lock namespaces and verified global order, server-bounded guard
      lifetime, per-subject fences for every recipient/actor/author, erasure of identifying
      artifacts and late-callback suppression; retain required moderation audit.
- [ ] D3/D9: shared reconciliation, revisions/request ownership, fallback and teardown;
      passive reaction/comment updates, accessible new-look insertion and preserved drafts.
- [ ] D4/D5/D9: localized controls and exact paginated target routing, warm/background/cold
      notification taps and safe inaccessible-target fallback.
- [ ] D1/D8: shared per-member remote-only flag cache, bounded refresh/expiry, fail-closed
      outage behavior, cohort-preserving authorization and cache erasure.
- [ ] D5/D7: canonical profile-resolved native app identity and generation/owner-conditional
      token cleanup across every shared weather/community caller and both worker compositions.
- [ ] D7/D10: align affected local/CI isolated database services with PostgreSQL17+; assert
      runtime server version and effective timeout/pooler behavior in the guard lane.
- [ ] D8/D10: content-free deduplicated telemetry, backlog/uncertainty/latency metrics,
      independent worker loops and measured supported capacity.
- [ ] D10: factories, policy/unit, real database/worker fault tests, Pact, two-identity Playwright,
      native iOS/Android notification builds and protected-preview WebSocket evidence.

**Acceptance Criteria:**

- Eligible posts/reactions/published comments converge without cursor skips or revision regression:
  within 10 seconds on the healthy deployed WebSocket lane and 20 seconds on healthy fallback,
  under D10's measured envelope. Author-private status never leaks to public streams.
- Qualifying opted-in engagement dispatches within 60 seconds of public commit or allowed quiet-hour
  exit, including coalescing delay, under D10's measured envelope. Original deadlines survive failures.
- D6's recipient, reaction re-add, replay, self-action, quiet-hour/DST, expiry and permission rules hold.
  Each token has a durable outcome; ambiguous acceptance never authorizes another send.
- Web target links and actual native warm/background/cold notification taps resolve current visibility,
  focus the exact post/comment/reply accessibly and announce localized fallback once.
- Takedown, erasure, consent loss, opt-out, token transfer and read-flag loss fence late work and stale
  fetches. Offline logout and already accepted provider handoffs retain D5/D7's explicit limitations.
- Read-rollout/cohort changes take effect within 70 seconds, including cache expiry and active
  revalidation. Consent, age and account state use direct database checks; synthetic-user
  outage fallback never grants community access.
- Concurrent cold/expiring cache requests wait boundedly for one refresh. Unverified access
  returns unavailable, hides content and retains permitted drafts for retry; it never serves
  an expired grant or invents an affirmative denial. Healthy socket proof disables periodic polling.
- Quiet-hour exit proof covers at least 500 due token deliveries plus normal traffic, and the
  largest measured timezone herd. No deferred item receives a new clock to conceal delay.
- All D10 acceptance lanes execute with retained evidence. Production rollout stays disabled.

## Design notes

Use existing worker hosting and request/worker import boundaries.
Use a serialized committed-domain-outbox appender; its transactional counter lock lasts through commit.
Per-post revisions cover different source/append ordering. Read heads before authoritative bootstrap views.
Community events/preferences remain separate from strict legacy endpoints and weather token use.
Provider acceptance is the dispatch boundary. Device display has no exactly-once guarantee.
Migration and deployment are delivery side effects; local fixtures remain isolated from production.

## Implementation notes

- Owner authorized autonomous delivery through merge with story reviews preceding a fresh implementation session.
- Story 6.4 merged as PR #154; its sprint row is reconciled to done.
- 2026-10-20: both independent story reviews are READY for implementation on iteration 3.
  Their approval applies to these exact inputs before this administrative update:
  - Spec SHA-256: `f6631b1ba026bec9eecaad516f0b3aeeba46883d51a36131cc5713e563c2efb2`.
  - Design SHA-256: `91dc57ccbdcee454f879c87d08d8e1bdf3e4f883286f700cd31de7cc3cc36fdb`.
  - [Verified Astra high final review](reviews/story-6-5-astra-final-story-review.md): READY.
  - [Opus final review](reviews/story-6-5-opus-story-review.md), rereview 3: READY.
- Administrative status/approval records preserve the baseline, frozen normative content,
  acceptance criteria and all open implementation checkboxes. No runtime acceptance pass is claimed.

### Operational handoff

- Fresh `cc65-sol` owns implementation after coordinator handoff. Coordinator `wKS:p1`
  owns dispatch, review phases and merge. The implementer writes no ledgers and performs no merge.
- Report `completed`, `failed` and `progress` through `herdr agent prompt wKS:p1`, including
  concrete results and evidence paths. Report approval denials without routing around them.
- After implementation, the coordinator dispatches code reviews to existing `cc65-opus`
  and verified `cc65-astra`, followed by TEA test remedies. Reuse those reviewers; spawn
  no duplicate external reviewers and start no later phase before coordinator handoff.
- The required delivery sequence continues through ready PR, CodeRabbit findings addressed
  with replies, green CI and coordinator-owned merge. Required evidence gates remain open
  until executed. Signal only PIDs started by the session performing that action.

## Spec change log

- 2026-10-20, iteration 1: integrated both readiness reviews into D1-D10; retained full scope and
  rollout freeze. Added concrete deployment, ordering, native lifecycle, privacy, policy and proof.
- 2026-10-20, iteration 2: resolved Opus RR-1..RR-11 through dedicated privacy guards,
  server-side timeouts, row-skipping append, shared remote-only flag cache, compatible target
  resolution, quiet-hour herd sizing, isolated worker and native/auth preflight. Amendment
  editor runtime verified as GPT-6.1-Sol high; final Astra approval requires a fresh verified
  `gpt-6-astra high` independent reviewer.

## Review triage log

- 2026-10-20, iteration 3: RR2-1 refresh-ahead and unavailable/denied separation, N2 fallback-only
  polling, N1/N3/N4 pool/lock/proof requirements, and shared-token/canonical-identity probes.
  Review history is preserved; this Sol amendment batch issues no reviewer sign-off.

- [Astra review](reviews/story-6-5-astra-story-review.md) and
  [Opus review](reviews/story-6-5-opus-story-review.md): dispositions and approval record are in the design.
- Vercel platform-incapable finding withdrawn after official support verification.
- `xmin` ordering recipe rejected; bounded assisted appender selected and independently acknowledged.
- Both independent iteration 3 verdicts are READY; administrative status is in-progress.

### Code review batch1

[Fulltriage and ownership](reviews/story-6-5-code-triage.md). Everyfinding classified below; original storyreview history above remains intact.

| Finding   | Verdict | Route  | Repair group | Verified evidence                                                                                                                                                                                  |
| --------- | ------- | ------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1        | high    | patch  | R04          | Enabled-only PATCH leaves optional account policy absent; all downstream paths suppress the newly opted-in member.                                                                                 |
| E5        | high    | patch  | R04          | Enabled-only PATCH leaves optional account policy absent; all downstream paths suppress the newly opted-in member.                                                                                 |
| V3        | high    | patch  | R04          | Enabled-only PATCH leaves optional account policy absent; all downstream paths suppress the newly opted-in member.                                                                                 |
| ASTRA-C07 | high    | patch  | R04          | Enabled-only PATCH leaves optional account policy absent; all downstream paths suppress the newly opted-in member.                                                                                 |
| OPUS-H3   | high    | patch  | R04          | Enabled-only PATCH leaves optional account policy absent; all downstream paths suppress the newly opted-in member.                                                                                 |
| B2        | medium  | patch  | R10          | Native permission/token work can outlive the precreated5s request signal before register begins.                                                                                                   |
| E3        | medium  | patch  | R10          | Native permission/token work can outlive the precreated5s request signal before register begins.                                                                                                   |
| B3        | medium  | patch  | R10          | Server pruning leaves a stored expected binding and repeated409 without authenticated reconciliation.                                                                                              |
| E4        | medium  | patch  | R10          | Server pruning leaves a stored expected binding and repeated409 without authenticated reconciliation.                                                                                              |
| ASTRA-C06 | medium  | patch  | R10          | Server pruning leaves a stored expected binding and repeated409 without authenticated reconciliation.                                                                                              |
| B4        | medium  | patch  | R11          | Mobile policy409 retains stale revision; already-enabled member cannot recover subsequent saves.                                                                                                   |
| B5        | medium  | patch  | R11          | One-shot settings load can precede verified session and retains old account settings after identity changes.                                                                                       |
| B6        | high    | patch  | R07          | Anonymous removal rebuilds cards without refreshing open thread; required refresh failures are swallowed and cursor advances.                                                                      |
| E1        | high    | patch  | R07          | Anonymous removal rebuilds cards without refreshing open thread; required refresh failures are swallowed and cursor advances.                                                                      |
| ASTRA-C01 | high    | patch  | R07          | Anonymous removal rebuilds cards without refreshing open thread; required refresh failures are swallowed and cursor advances.                                                                      |
| OPUS-H5   | high    | patch  | R07          | Anonymous removal rebuilds cards without refreshing open thread; required refresh failures are swallowed and cursor advances.                                                                      |
| B7        | high    | patch  | R08          | Pending newLooks excluded from validation/eviction and inserted from stale cache after withdrawal.                                                                                                 |
| E2        | high    | patch  | R08          | Pending newLooks excluded from validation/eviction and inserted from stale cache after withdrawal.                                                                                                 |
| ASTRA-C03 | high    | patch  | R08          | Pending newLooks excluded from validation/eviction and inserted from stale cache after withdrawal.                                                                                                 |
| B8        | medium  | patch  | R09          | Events/resolve have no deadline; unresolved flight blocks every later doorbell/fallback and is not aborted on stop.                                                                                |
| B9        | medium  | patch  | R05          | Invalid receipt settlement discards prune obligation on transient failure; inactive retention disproves literal forever claim.                                                                     |
| E6        | medium  | patch  | R05          | Invalid receipt settlement discards prune obligation on transient failure; inactive retention disproves literal forever claim.                                                                     |
| B10       | medium  | patch  | R10          | Restoration can precede subscriptions, leaving startup without an initial token/last-used reconciliation.                                                                                          |
| E7        | medium  | patch  | R09          | Generation invalidation makes old loading cleanup inert; rebuild does not restore pagination; supersession misreported unavailable.                                                                |
| OPUS-M9   | medium  | patch  | R09          | Generation invalidation makes old loading cleanup inert; rebuild does not restore pagination; supersession misreported unavailable.                                                                |
| E8        | medium  | patch  | R07          | Realtime refresh restarts pageone after off-page target and drops focused target page.                                                                                                             |
| E9        | medium  | patch  | R07          | Target-page rejection escapes loadTarget without unavailable/fallback handling.                                                                                                                    |
| E10       | medium  | patch  | R15          | Five existing wardrobe cases synchronously assert a now-async profile lookup; scoped runs excluded them.                                                                                           |
| OPUS-M11  | medium  | patch  | R15          | Five existing wardrobe cases synchronously assert a now-async profile lookup; scoped runs excluded them.                                                                                           |
| V1        | medium  | patch  | R16          | Existing tests inject browser bearer and never exercise new web-session publication into an actual authenticated request.                                                                          |
| V2        | medium  | patch  | R16          | Existing tests bypass actual transport doorbell callback; reconnect policy and production reconciliation linkage remain unverified.                                                                |
| OPUS-L3   | medium  | patch  | R16          | Existing tests bypass actual transport doorbell callback; reconnect policy and production reconciliation linkage remain unverified.                                                                |
| ASTRA-C02 | high    | patch  | R07          | Post snapshot revision advances invalidation map without reconciling comments and filters later equal-revision comment event.                                                                      |
| OPUS-M8   | high    | patch  | R07          | Post snapshot revision advances invalidation map without reconciling comments and filters later equal-revision comment event.                                                                      |
| ASTRA-C04 | high    | patch  | R08          | Web notification resolver checks localactive only and can reopen an evicted post from held response.                                                                                               |
| ASTRA-C05 | high    | patch  | R03          | Actual-source slowDB probe grants trueafter2102/2103ms; expired pre-claim valid result can return, boolean wrapper loses expiry proof.                                                             |
| ASTRA-T01 | medium  | patch  | R16          | Manual SAVEPOINT probe never invokes production candidate rollback; removing production rollback leaves that probe unchanged.                                                                      |
| OPUS-H1   | high    | patch  | R01          | Preparation adapts and disproves fixedRTT example; write set still lacks completion budget/adaptation and slowwrite rollback can repeat without telemetry.                                         |
| OPUS-H2   | high    | patch  | R02          | Assist exception reaches instancewide catch and disconnects authorized sockets before independent head/auth checks.                                                                                |
| OPUS-H4   | high    | patch  | R02          | Two projection-window revisions retry/503 whole batch; frequency estimate unproved, but fresh visible target churn must not fail unrelated targets.                                                |
| OPUS-H6   | high    | patch  | R09          | Foreground and ordinary recycle emit unavailable, aborting publish/report/photo work and showing wrong mobile empty state.                                                                         |
| OPUS-M1   | medium  | patch  | R09          | Handshake403 and dependency errors indistinguishable; HTTP403 normally stops coordinator, but independent/delayed HTTP denial can retry sockets indefinitely.                                      |
| OPUS-M2   | medium  | patch  | R14          | Read-flag outage throws through process/markFailed, consumes screening attempts and blocks whole sequential stale sweep.                                                                           |
| OPUS-M3   | medium  | patch  | R06          | Guardian forget runs before status mutations; triggers recreate valid-generation identifying/private artifacts. Unauthorized send not proven.                                                      |
| OPUS-M4   | medium  | patch  | R03          | Database origin compared to app wallclock can skip all fresh calls or enlarge invocation allowance under clock skew.                                                                               |
| OPUS-M5   | medium  | patch  | R02          | Unexpected assist/snapshot/target transient Prisma failures become generic500 through exception filter.                                                                                            |
| OPUS-M6   | high    | patch  | R05          | Unavailable flag throws before scheduling update; oldest32 due rows can repeatedly occupy dispatch and starve healthy recipients.                                                                  |
| OPUS-M7   | high    | patch  | R05          | New community capability failure can terminate weather startup. Duplicatepool claim false for documented mutually-exclusive worker topology; preserve supported general-only deployment.           |
| OPUS-M10  | high    | patch  | R08          | Both insertable buffers and displayed closed deep-link cards are omitted from revalidation.                                                                                                        |
| OPUS-L1   | medium  | patch  | R06          | Erasure NEW.user_idNULL sends private comment.status to public outbox/head; serializer suppresses IDs, but private stream isolation/doorbell invariant breaks.                                     |
| OPUS-L2   | medium  | patch  | R03          | Actual-source200msassist virtualclock yields authorization starts0/8400ms; completion-based tick exceeds8sstart bound.                                                                             |
| OPUS-L4   | medium  | patch  | R10          | Rotation event joins older same-owner flight and ignores deliveredtoken; actual-source probe binds only oldtoken.                                                                                  |
| OPUS-L5   | medium  | patch  | R11/R10      | Four verified subclaims:409recovery, full-policy PATCH, missing first-time timezone provenance/suggestion, enable-permission escalation swallowed by backgroundflight.                             |
| OPUS-L6   | false   | reject | none         | D5 intentionally permits creation of missing Supabase principal for existing application profile; API requires existing eligible appuser. Setting shouldCreateUserfalse breaks approvedfirstlogin. |
| OPUS-L7   | medium  | patch  | R07          | Three verified subclaims: unconditional newcomments announcement; uncaught targetpagefailure; targetload fences concurrent private status read without replacement.                                |
| OPUS-L8   | medium  | patch  | R12          | Capability-fenced reaction-bearing late read returnsnull, causing feed callers to discard entire visiblecard.                                                                                      |
| OPUS-L9   | medium  | patch  | R04          | Group attach reads snapshot_atNULL without rowlock; fanout can freeze/send before attachment, losing lateintent.                                                                                   |
| OPUS-L10  | medium  | patch  | R04          | Missing account revision0 equals firstcreatedpolicy0; first legacyPUT doesnotinvalidate prior communityPATCHrevision.                                                                              |
| OPUS-L11  | medium  | patch  | R04          | Policy writes/reconcile overwrite nextattempt floor and can bypass30soutsidequiet spacing; retain initialquietexit exception.                                                                      |
| OPUS-L12  | medium  | patch  | R04          | Firstintent expiry copied togroup can expire later still-valid contributors; preserve individual clocks and surviving delivery opportunity.                                                        |
| OPUS-L13  | medium  | patch  | R04          | Boundary quietdeferral changes nextattempt but not eligibility/history, mismeasuring firstallowedinstant.                                                                                          |
| OPUS-L14  | false   | reject | none         | Prisma-generated every uses NOT(completed_at<cutoff); NULL isnotaviolation under SQLlogic, so alleged permanentretention exclusion disproved by SQLprobe.                                          |
| OPUS-L15  | low     | patch  | R05          | Nextlookup beyond24h delays required unknownsettlement; extra finalproviderlookup requirement unproved. Clamp independent expiry due time.                                                         |
| OPUS-L16  | high    | patch  | R06          | Productionallocate route calls unguarded draftinsert afterstorageI/O. Draft introduced afterprivacy rediscovery can23514failerasure; no-memberlock premise verified, nocaller premise refuted.     |
| OPUS-L17  | medium  | patch  | R02/R03      | Actualnew errorenvelopes/OpenAPI lack fields/schemas; retry2sguidance ignores45scadence. Some400alreadyinvalid_cursor, so universalnocodeclaim false.                                              |
| OPUS-L18  | high    | patch  | R13          | CaseinsensitivefindFirst canpickambiguous casevariant; trusted app_user_idA withoutrole isdiscarded for emailmappedB/guardian. Preserve binding; blanketmissingrole rejection incomplete.          |
| OPUS-L19  | low     | patch  | R03          | Late boolean returns without conditional claimrelease, leaving brief abandonedlease. Do notstorelategrant or resetcadence.                                                                         |

### Remedy rereview round 2

Both independent verdicts collected; coordinator source verification and exclusive repair routes are recorded below. Full evidence is in test-artifacts/story-6-5/repairs/reviews/round2-triage.md.

| Finding                           | Verdict | Route / group | Verified outcome and qualification                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPUS-RR2-N1                       | high    | patch / A01   | Targets perform sequential signing and queries; events serialize up to 200 rows through sequential reads and await optional assistance. Healthy latency can exhaust the shared deadline. The 15-20-card threshold and hosted frequency are unmeasured. Preserve the existing response/authorization bounds, batch signing/reads and cursor semantics; no retryable-target wire variant is authorized by this claim.                                                         |
| OPUS-RR2-N2 dependency failures   | high    | patch / A02   | Real identity network/503/429/JSON failures become Unauthorized; HTTP also converts fast identity DB failure to 401. Socket raw DB failures already become unavailable, and the outer community deadline normally wins against the five-second fetch timeout. Preserve infrastructure provenance through identity/profile/community boundaries.                                                                                                                             |
| OPUS-RR2-N2 expiry race           | medium  | patch / A02   | Installed SDK normally refreshes within 90 seconds, so the ordinary healthy-race premise is unsupported. A controlled actual SDK fallback/token-callback/handshake probe did return a token with 1404 ms left after refresh failure; handshake crossed expiry and emitted denied while the refresh session remained stored. Reject expired JWTs immediately; insufficient lifetime at token supply must enter retryable recovery without clearing same-owner session state. |
| ASTRA-RR2-01                      | high    | patch / A02   | Actual-source 503/network probes yield 401 and downstream denial. Same dependency-classification root cause as N2. Require actual guarded HTTP/socket tests using the real identity service, plus retained same-owner draft and recovery proof.                                                                                                                                                                                                                             |
| OPUS-RR2-N3                       | high    | patch / A03   | Every append exception halves readyLimit, including ordinary NOWAIT contention; no success path restores it. Four aborts reduce 25 to 1. Aggregate backlog frequency is unmeasured; permanent per-process capacity loss is real. Preserve bounded transactions and ordered locks.                                                                                                                                                                                           |
| OPUS-RR2-H6 action cancellation   | high    | patch / A04   | Unrelated catch-up failure cancels already-owned screen actions on both platforms. Hiding unverifiable content is required; indiscriminate cancellation of same-owner work is the narrower defect. Preserve true session/privacy-loss fencing and suppress new mutations while access is unknown.                                                                                                                                                                           |
| OPUS-RR2-H6 picker cancellation   | false   | reject        | The mobile post sheet now cancels its own controller only on unmount. The former suspended-triggered cancellation effect is absent. Its held-picker proof already exists.                                                                                                                                                                                                                                                                                                   |
| OPUS-RR2-H6 recovering visibility | false   | reject        | D3 explicitly requires stale content hiding on ordinary disconnect/error and foreground restoration. Item/comment state, permitted drafts and the post-sheet component remain retained. Guaranteed draft loss is unsupported; native scroll/focus preservation still needs the existing execution proof. Keeping unverifiable content visible would violate the approved design.                                                                                            |
| OPUS-RR2-M9                       | medium  | patch / A05   | Reaction/comment invalidation advances feed ownership and aborts a held pagination/refresh request, whose stale finalizer cannot clear loading flags. No replacement feed request or successful availability callback clears them.                                                                                                                                                                                                                                          |
| OPUS-RR2-N4                       | medium  | patch / A06   | A single 2s timer covers the entire reconcile callback, including locate/root/reply/private requests. Actual coordinator/comment-state probe with three healthy 750ms requests aborts after 2003ms. Target validation has a separate timer. Bound individual requests and the overall operation without conflating them.                                                                                                                                                    |
| OPUS-RR2-N5a                      | medium  | patch / A07   | React state eviction can precede render-assigned open refs, causing immediate refresh of the removed post and global unavailable on 404. Scheduled fallback normally recovers, so permanent stickiness is overstated. Evict authoritatively before reconciliation.                                                                                                                                                                                                          |
| OPUS-RR2-N5b                      | medium  | patch / A08   | Failed buffered insertion directly sets view availability false without notifying the connected coordinator. A quiet healthy socket has no scheduled recovery. Preserve the buffer and schedule bounded owned revalidation.                                                                                                                                                                                                                                                 |
| OPUS-RR2-N6                       | medium  | patch / A09   | Dispatch owner/guard/capability failure occurs before independent loops and dedicated moderation creation. Dedicated startup exits. A supervisor crash loop and total deployment screening loss depend on topology, but the source coupling is real.                                                                                                                                                                                                                        |
| OPUS-RR2-N7                       | medium  | patch / A09   | The general bootstrap continues weather/moderation after runtime rejection, but that runtime registered no append/retention loops. Dispatch failure must leave independent work running and expose a degraded dispatch signal.                                                                                                                                                                                                                                              |
| OPUS-RR2-N8                       | medium  | patch / T01   | Combined V2 callbacks receive events plus AbortSignal; exact-one-argument assertions fail. Visible reaction and outage timing passed before failure; healthy 8.1s no-poll observation and final availability did not execute successfully.                                                                                                                                                                                                                                  |
| ASTRA-RR2-02                      | medium  | patch / T01   | Same stale callback expectation. Assert the actual signal and preserve every event, visibility, 8s/10s and full no-poll assertion.                                                                                                                                                                                                                                                                                                                                          |
| OPUS-RR2-N9                       | medium  | patch / A10   | Unrelated invalidation increments the global detail generation and discards the only pending notification resolution. Discarding a superseded response is safe; the missing fresh owned retry loses valid navigation. Preserve per-target eviction fences.                                                                                                                                                                                                                  |
| OPUS-RR2-N10                      | medium  | patch / A11   | Explicit normal navigation leaves old focusTargets intent; later refresh returns to the old target page. Actual state probe produced OLD_TARGET, FIRST, OLD_TARGET. Explicit navigation/close must retire focus intent while temporary suspension preserves it.                                                                                                                                                                                                             |
| OPUS-RR2-N11                      | medium  | patch / A12   | Joiners already race their own budgets and recheck expiry. Shared work still inherits the first caller's earlier deadline, which can reject a later live caller. Permit bounded re-resolution under that caller's remaining budget while preserving claim cadence, one invocation, lease ownership and hard expiry.                                                                                                                                                         |
| ASTRA-RR2-03                      | medium  | patch / A13   | Final mobile log contains an MSW handler assertion converted to 500 while 194 tests report passing. A prior permission case displays its banner before awaiting capture advancement, providing a concrete unfinished-work route. Exact offending request provenance needs explicit case/request ownership proof. Await assertions in the test body and settle or cancel work.                                                                                               |
| OPUS-RR2-N12 quiet boundary       | medium  | patch / T02   | Policy-edit history tests do not exercise quiet-boundary history changes in actual fanout and send authorization. Test both production branches without a policy edit, preserving expiry.                                                                                                                                                                                                                                                                                   |
| OPUS-RR2-N12 PATCH spacing        | medium  | patch / T02   | Direct Prisma policy edits plus reconciliation do not prove actual PATCH preserves an existing scheduling floor. Add real HTTP write and pending-group assertions.                                                                                                                                                                                                                                                                                                          |
| OPUS-RR2-N12 PUT spacing          | medium  | patch / T02   | A literal revert can fail an incomplete fake transaction fixture, so the blanket revert claim is too broad. No behavior-based real PUT test proves the scheduling floor. Add that proof.                                                                                                                                                                                                                                                                                    |
| OPUS-RR2-N12 owner selection      | medium  | patch / T03   | Existing bootstrap tests mock the engagement runtime and do not execute owner/role pool selection. Prove exactly one dispatch owner with independent housekeeping for both roles.                                                                                                                                                                                                                                                                                           |
| OPUS-RR2-N12 general-only startup | medium  | patch / T03   | Existing tests prove general startup survives a mocked engagement rejection, but not actual runtime selection/pool/loop behavior. Add actual runtime composition and degraded-dispatch proof.                                                                                                                                                                                                                                                                               |
| OPUS-RR2-N12 receipt clamp        | medium  | patch / T04   | Existing already-expired selection test does not prove a pending receipt just before 24h clamps its next lookup to expiry. Add near-boundary pending-response and no-resend proof.                                                                                                                                                                                                                                                                                          |
| OPUS-RR2-N12 web thread removal   | medium  | patch / A14   | Rendered comments already prove direct refresh/removal/focus/draft behavior. Grid tests disable realtime startup, leaving actual grid/coordinator anonymous-resync integration unproved.                                                                                                                                                                                                                                                                                    |
| OPUS-RR2-N12 foreground actions   | medium  | patch / A04   | Mobile actual coordinator held-publish/report/picker tests exist. Web equivalent and intermediate stale-hidden ownership restoration need proof. Preserve required stale hiding.                                                                                                                                                                                                                                                                                            |
| OPUS-RR2-N12 loading              | medium  | patch / A05   | Existing ordinary pagination tests do not inject invalidation while a request is held. Add both platforms' loading ownership proof and subsequent successful load.                                                                                                                                                                                                                                                                                                          |
| OPUS-RR2-N12 wardrobe cases       | low     | patch / A13   | Canonical-owner test already fails a JWT-owner revert, so the blanket missing-revert claim is false. Four unconditional-401 token-shape cases are redundant and their re-authentication title is unasserted. Correct the test descriptions/duplication and prove authenticated profile failure behavior; add no client JWT-derived ownership.                                                                                                                               |

### Regression rereview round 3

Both peer verdicts collected. Source-backed qualifications and exclusive repair ownership are recorded in test-artifacts/story-6-5/repairs/reviews/round3-triage.md.

| Finding                                  | Verdict | Route / group | Verified evidence and required correction                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ASTRA-RR3-01 web                         | medium  | patch / B02   | Actual installed SDK, production web-session and generated profile probe starts with 5.4s token lifetime, awaits a 4s profile response and supplies a token with 1397ms left. Recheck at final supply after every await; retain same-owner identity/session and retryable unavailability.                                      |
| ASTRA-RR3-01 native                      | medium  | patch / B02   | Native resolver has the same pre-check, awaited acceptance and unchecked return ordering. Exercise native return-boundary ordering and preserve immediate server JWT rejection.                                                                                                                                                |
| OPUS-RR3-R1 native                       | high    | patch / B01   | Startup operational failure invokes cleanup, uninstalling the production bearer resolver, auth subscription and lifecycle recovery. Root layout swallows the rejection. Keep recovery machinery installed until its actual lifecycle cleanup; no bearer grant before canonical verification.                                   |
| OPUS-RR3-R1 web                          | medium  | patch / B01   | Startup profile/restore/lifetime failure unsubscribes application auth updates. On-demand recovery still works, but later automatic refresh/sign-out events are lost until startup runs again. Preserve subscription through recoverable operational failures.                                                                 |
| OPUS-RR3-R1 absolute unrecoverability    | false   | reject        | Direct native resolver and OTP acceptance can restore identity, and calling startup/remount can reinstall machinery. OTP does not itself reinstall the ordinary production bearer resolver. The specific installation defect is retained above; process-lifetime impossibility is overstated.                                  |
| OPUS-RR3-R2 native card deadline         | medium  | patch / B03   | The card signal starts before the wrapper awaits token/profile resolution. It can already be aborted when HTTP begins. Start the request deadline at actual HTTP initiation under the existing bounded operation and owner cancellation.                                                                                       |
| OPUS-RR3-R2 native card timeout outcome  | medium  | patch / B04   | A timed-out valid card read reaches invalid-link failure without retry. Distinguish unavailable transport/identity from invalid input or authoritative target absence; retry within the operation bound and retain a retryable result after exhaustion.                                                                        |
| OPUS-RR3-R2 native comment target        | medium  | patch / B04   | Target retry repeats only successful superseded results. A timeout rejects straight into invalid-link state/analytics. A delayed first attempt followed by a valid owned response must open the exact target without invalid-link analytics.                                                                                   |
| OPUS-RR3-R2 web comment target           | medium  | patch / B04   | Web comment-target timeout also escapes the retry loop and displays invalid-link copy. This callback emits no invalid-link analytics itself. Preserve bounded retries, exact focus and established unavailable/expired target fallback.                                                                                        |
| OPUS-RR3-R3 mobile fenced target         | medium  | patch / B05   | A held comment-target result can be fenced by reaction mutation 404 without changing screen detail generation. reactionState.read returns null, yet the callback opens commentsPostId. No hidden content disclosure is established; prevent the spurious sheet/root read with an early return.                                 |
| OPUS-RR3-R4 wording                      | low     | patch / B06   | Identity failures now return community-specific wording through all guarded routes; wardrobe/user readers display that top-level message. Use neutral wording and verify a non-community guarded response while retaining typed community unavailability and actual credential denial.                                         |
| OPUS-RR3-R4 code/schema generalization   | false   | reject        | code unavailable is domain-neutral. No actual client parsing failure through a strict legacy 503 schema was demonstrated. Add no second exception type, new public error code or broad contract expansion solely for this claim. Preserve correct 503 dependency provenance.                                                   |
| OPUS-RR3-G1 mobile A07                   | medium  | patch / T05   | Existing comment removal keeps the post visible; buffered withdrawal has no open thread. Add an actual-screen open-post eviction/same-pass reconciliation proof with a surviving card, no removed-thread refresh and no global outage. Require a mutation red only if the old full-screen ordering is reproducible.            |
| OPUS-RR3-G1 mobile A08                   | medium  | patch / T05   | Existing buffered withdrawal does not exercise failed insertion and coordinator-owned quiet-socket recovery. Add bounded recovery with retained buffer, restored controls and safe insertion.                                                                                                                                  |
| OPUS-RR3-G1 mobile A10                   | medium  | patch / T05   | Existing card-only delayed reads do not exercise comment-target retry after unrelated generation change. Add exact-target retry plus withdrawn-target no-sheet proof.                                                                                                                                                          |
| OPUS-RR3-G1 mobile A11                   | medium  | patch / T05   | Existing focus-return cases do not hold notification resolution across explicit close. Add late-result retirement while independent card/negative-visibility results remain authoritative, and normal reopen/refresh retains normal navigation.                                                                                |
| OPUS-RR3-G1 web mandatory revert failure | false   | reject        | A current actual-screen test proves no removed-thread refresh, closed detail and surviving visibility. Both retained prepatch attempts passed; the earlier minimal scheduling probe did not reproduce the full screen. Preserve positive proof and the synchronous ref invariant. Inventing a failing ordering is unsupported. |

### Regression rereview round 4

Both verdicts collected. Opus CHANGES_REQUIRED and Astra READY within its assigned delta.
Coordinator traced the remaining cold concurrency and target-result visibility/intent paths.
All prior B01-B06 closures remain recorded. Detailed scope/ownership and source binding:
[test-artifact triage](../test-artifacts/story-6-5/repairs/reviews/round4-triage.md).

| Finding                           | Verdict | Group | Required correction and proof                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPUS-RR4-F1 native                | medium  | C01   | Concurrent cold/unverified suppliers can supersede canonical verification while member remains null and return undefined. This is an uncertainty-to-signed-out misclassification; reproduce through actual production suppliers and rendered initial feed before repair.                                                                           |
| OPUS-RR4-F1 web                   | medium  | C01   | Equivalent accept generation and null-member return ordering. Same-principal/token calls must join verification; superseded verification waits or rejects retryably, with no false undefined. Preserve true denial/logout, principal switching and final lifetime checks.                                                                          |
| OPUS-RR4-F2 mobile notice         | low     | C02   | Mobile successful unavailable-target branch sets invalid notice without retired-intent check. Hold a real target response across manual navigation and prove no stale notice/focus/navigation, with current-intent fallback retained.                                                                                                              |
| OPUS-RR4-F2 mobile visibility     | medium  | C02   | Targets service returns unavailable for missing/ineligible post projection or failed final post freshness; removed child alone yields available post and null child. Process authoritative negative post projection through existing post/comment eviction independently of retired focus intent and preserve owner/generation fences.             |
| ROOT-RR4-F2 web visibility parity | medium  | C02   | Web target success handler exits on retired intent before inspecting unavailable post result, and active unavailable path only sets notice. Apply the same independently owned negative visibility behavior through existing eviction, preserving unrelated current discussion/draft. Source-traced extension requires rendered red before repair. |

## Verification

- `npm run verify:changed`, `npm run validate`: pass all applicable quality gates.
- `npm run test:pact`, `npm run optic:diff`: compatible canonical contracts.
- `npm run test:pw-local -- playwright/tests/community-engagement.spec.ts`: real browser journeys.
- Extend existing Maestro runners for notification-capable native iOS/Android builds; retain real
  provider-to-device and OS response evidence. Expo Go/open-link checks alone cannot satisfy this lane.
- Prove crash recovery, concurrency, ordering, privacy races and timing with isolated database/worker
  processes and a recording provider; use mandated Playwright/Pact utilities and D10's test IDs.
- Prove protected-preview WebSocket upgrade, cross-instance delivery, duration reconnect and
  worker-down append assistance on existing infrastructure.
- Review screenshots and accessibility behavior; retain evidence for final peer review and CI.
