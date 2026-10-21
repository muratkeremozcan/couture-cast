# Story 6.5 readiness and test architecture review

Updated: 2026-10-20. Pre-implementation peer review.

**Initial verdict: CHANGES_REQUIRED. Final independent Astra review pending.**

Reviewer: requested Codex Astra peer, operating as Murat / TEA.
Coordinator: Herdr `wKS:p1`.
Scope: review and this evidence file only.

Reviewed baseline: `aa8cd0e1f12ea778a9ca40b76c0868637f1b55a1`.
Reviewed story: `spec-6-5-realtime-engagement-notifications.md`, draft, iteration 0.
Story SHA-256: `30e460790e6a0fc9c0ec717ee40b6d587005722ff34423b9d09bbd59f790a341`.

The story identifies the right risks and preserves the existing safety boundaries. Approval
requires explicit decisions about ordering, delivery uncertainty, visibility invalidation,
preferences compatibility, and the deployed test path. These are observable behavior and
architecture decisions that determine whether the acceptance criteria can be proved.

## Activation and evidence boundary

- Read `AGENTS.md`, `_bmad-output/project-context.md`, the complete requested TEA skill,
  story draft, and `epic-6-context.md`.
- Checked team/user customization paths. Neither supplied a legacy dispatch override.
  Both customization and configuration resolvers completed successfully.
- Resolved persona: Murat, icon `🧪`, English communication/documents. No prepend, append,
  or persistent-fact entries were configured.
- Kept menu/workflow unset. The requested result is a pre-implementation story review,
  outside the menu's declared system/epic test-design and existing-test review deliverables.
- Consulted the TEA index and relevant library mandates, Pact MCP, test-levels,
  evidence-integrity, timing-debugging, risk-governance, mobile-test-strategy,
  mobile-ci-device-lab, and Maestro guidance.
- Both utility flags are true. Root dependencies contain
  `@seontechnologies/playwright-utils` 4.4.1 and `@seontechnologies/pactjs-utils` 1.1.0.
  The mandates bind the corresponding suites.
- Pact MCP is configured, but no broker tool was exposed in the available tool inventory.
  Review used repository contracts and provider source. No live broker compatibility claim.
- Cross-checked relevant official Socket.IO, Playwright, Expo, Pact, Vercel, and GitHub
  Actions documentation. Context7 supplied Socket.IO guidance and Playwright 1.58.2 docs.
  Other language/framework runners are outside this repository review's scope.
- This is static readiness evidence. No application tests, deployments, production probes,
  migrations, source edits, story edits, commits, pushes, or merges were performed.
  No approval was denied or escalation requested. No process was signaled.

## Severity-ranked findings

Severity describes consequence; risk scores use probability x impact on TEA's 1-3 scale.
Proposed values below are review recommendations for the coordinator to incorporate or replace
with an equally explicit decision.

### F1. HIGH: the deployed realtime path is unspecified

Risk: OPS/TECH, 3 x 2 = 6.
Story anchors: lines 57, 73, 90, 111-113.

`apps/api/vercel.json:3` routes requests into a 25-second function.
`apps/api/api/index.ts:10` creates and initializes Nest through Express, then forwards HTTP
requests. `gateway.gateway.ts` declares Socket.IO gateways; the inspected handler provides
no explicit platform upgrade integration. `community.bootstrap.ts` runs a standalone worker
with sweep timers and no client-facing gateway.

The deployment guide contains conflicting historical statements about worker availability.
The recorded model-readiness evidence identifies a deployed Northflank community worker
and a successful hosted canary on 2026-10-17. That proves a historical worker deployment;
it does not establish a current gateway endpoint or this story's future worker revision.

Current Vercel documentation supports native WebSockets on Fluid Compute, including
Socket.IO integration guidance. Platform support therefore leaves an implementation and
verification decision for this repository. See
[Vercel WebSocket support](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections).

**Proposed amendment:** name the gateway entry point, externally reachable origin/path,
platform upgrade adapter, auth/CORS rules, connection limits and reconnect behavior.
Choose and document the Vercel integration or a separately hosted gateway. Specify where
the durable dispatcher and push worker run, their startup/readiness/shutdown wiring, and
their compatibility with rolling API/worker versions. Preserve disabled production rollout.

**Approval evidence:** authenticated web and native clients connect through the intended
deployed entry point in an isolated environment; a commit made through API instance A
reaches a client on gateway instance B. Repeat across instance termination, Redis loss,
and reconnection. An ordinary HTTP health response cannot prove the upgrade or relay.

### F2. HIGH: push dedupe conflicts with the existing timeout/retry mechanism

Risk: DATA/BUS, 3 x 2 = 6.
Story anchors: lines 31, 42, 47, 74, 84, 95.

`push-notification.service.ts:123` retries rejected send attempts.
`sendWithDeadline` races the Expo promise against a timer without canceling the provider
request. A timed-out request may succeed after the next attempt starts. A worker can also
die after acceptance and before recording its ticket. A unique database delivery row
cannot resolve whether that external side effect happened.

Expo documents best-effort, at-least-once handoff and rare duplicate/lost deliveries.
Ticket acceptance and subsequent receipts also describe different boundaries.
See [Expo delivery guarantees](https://docs.expo.dev/push-notifications/faq/) and
[tickets and receipts](https://docs.expo.dev/push-notifications/sending-notifications/).

**Proposed amendment:** distinguish logical notification, recipient delivery, token attempt,
provider acceptance, and device presentation. Persist attempt identity and states including
`sending`, `accepted`, `retryable_rejection`, `unknown`, `suppressed`, and terminal failure.
Recommend terminal `unknown` for ambiguous sends with no automatic resend; permit bounded
retries only for known rejection before acceptance. Document the resulting possible missed
push. If automatic ambiguous retries are chosen, explicitly permit possible duplicate pushes.
Use stable logical IDs for client-side dedupe where the application controls presentation.
Define per-token partial-batch outcomes and receipt reconciliation/invalid-token pruning.
Do not reuse the existing automatic timeout retry unchanged for a no-repeat promise.

**Approval evidence:** a provider fake accepts a request but withholds its response; release
it after the application timeout and verify exact request counts and durable outcomes.
Kill an owned worker after provider acceptance and before persistence, restart it, and
assert the selected uncertainty policy. Also cover partial acceptance, stale lease completion,
ticket/receipt errors, and token deletion failure. Test fakes must observe outbound requests.

### F3. HIGH: the cursor contract still permits lost updates during catch-up

Risk: DATA, 2 x 3 = 6.
Story anchors: lines 41-44, 73, 75, 82, 91-93.

The design correctly rejects an unguarded pre-commit sequence, but leaves the replacement
protocol undecided. `events.repository.ts:30` currently uses `created_at > since`, orders by
timestamp alone, and has no limit. Comments already have per-post publication ordering in
`community-comments.processor.ts:111`; that does not order a multi-post event stream.

Several distinct races need a shared contract: transaction A reserves an earlier position
and commits after B; a live packet advances the cursor past an unseen catch-up page; a
mutation occurs between snapshot fetch and subscription; and a filtered page contains no
deliverable events but must still make scan progress.

**Proposed amendment:** define stream ordering separately from entity revision ordering.
Choose a serialized, durable append protocol over committed domain outboxes, or a
transactional counter lock held through commit by all participating writers. Document the
lock order and contention bound. Define cursor version/scope, scanned high-water mark,
page limit, retention window, expiry response, and snapshot-to-stream handoff.
Live invalidations must not advance the durable catch-up cursor past unscanned work.
Advance the scan cursor across invisible rows. Reset cursor and view state when user or
filter scope changes. Entity revisions must reject delayed older results.

**Approval evidence:** real PostgreSQL transactions with explicit barriers reverse commit
order across two posts; a second client polls while A is blocked. Prove rollback silence,
equal timestamps, live/page overlap, an all-filtered page, retention expiry, and a mutation
at every snapshot/subscription boundary. Socket.IO's default delivery has no disconnected
server buffer; persistence and offsets remain application responsibilities.
See [Socket.IO guarantees](https://socket.io/docs/v4/delivery-guarantees).

### F4. HIGH: visibility suppression needs both transport authorization and invalidation

Risk: SEC, 2 x 3 = 6.
Story anchors: lines 24-27, 32, 45, 73, 86.

The legacy poll endpoint uses only `RequestAuthGuard`; its repository returns all envelopes
with `user_id = null`. Adding community events to that table could expose identifiers and
activity through `/api/v1/events/poll` even when the new community endpoint rejects the
viewer. Identifier-only payloads still disclose activity. The generic lookbook gateway
currently checks identity on connection, with no community eligibility lifecycle.

Separately, suppressing every event after takedown leaves an already-open client's visible
card, comment body, or reaction aggregate stale. A delayed successful fetch can restore
content after the client's view was cleared.

**Proposed amendment:** isolate community events from the legacy poll path, or explicitly
filter/authorize them there while preserving weather/ritual behavior. Apply the canonical
public predicate, canary exclusion, recipient/viewer eligibility, and rollout rules at every
delivery/read boundary. State whether read and write flags have separate meanings.
Specify JWT expiry, consent loss, logout and cohort-change handling for live subscriptions.
Add identifier-free resync signals or authorized tombstone invalidations and an explicit
active-view revalidation bound when such signals are unavailable. Bind fetch ownership to
user, scope and visibility generation. Define the final authorization/dispatch boundary;
already transmitted packets cannot be recalled.

**Approval evidence:** denied viewers probe both poll endpoints and socket subscriptions;
a connected viewer loses access without reconnecting; a hidden target disappears from an
open view; a held fetch settles after revocation and cannot restore it. Check pending,
blocked, erased and canary content, token expiry, and a lost invalidation during Redis outage.

### F5. HIGH: erasure cleanup does not define how claimed work loses authority

Risk: SEC/DATA, 2 x 3 = 6.
Story anchors: lines 70, 72, 77, 86.

`community.repository.ts:480` serializes erasure using the member lock followed by sorted
post locks. It deletes current reaction receipts/outboxes and calls comment erasure.
`community-comments.privacy.ts` clears comment content and analytics subject mappings.
New event/delivery tables can reference the actor, post author, parent author, or recipient.
Deleting rows alone does not stop a worker already holding those values from publishing,
recreating delivery rows, recording identifiers, or completing a stale lease.

**Proposed amendment:** enumerate erasure effects on event payloads, recipient rows, token
attempts, receipts, retry jobs, leases and analytics mappings for every subject role.
Carry stable IDs in queue jobs and re-read authoritative state before side effects.
Use conditional lease/generation updates and the established lock order so erased work
cannot recreate rows or regain authority. Define immediate suppression, deletion/anonymization
deadlines, event-retention gaps, and preservation of required moderation audit records.
Recompute/invalidate aggregates after actor erasure. Limit external provider payloads to
generic localized copy and opaque routing data. State the boundary for an already accepted
external push.

**Approval evidence:** pause workers after claim and before final authorization, erase actor
and recipient in separate cases, then resume. Assert no new send, event resurrection or
identity-bearing telemetry. Repeat during recipient expansion and stale lease completion.
Inspect all new tables and captured sink payloads, including jobs retained for retries.
Exercise the inverse serialization order and verify the documented in-flight boundary.

### F7. HIGH: preference migration and quiet-hours behavior remain ambiguous

Risk: BUS/TECH, 3 x 2 = 6.
Story anchors: lines 28, 46, 61, 71, 74, 76, 84, 94.

`alertPreferencesSchema` in `contracts/http/alerts.ts:73` is strict. Adding a community field
to existing responses breaks already-installed clients that parse the older schema.
Existing PUT requests also contain a full preferences object. Missing/new fields need
explicit preservation rules so an older client cannot reset community opt-in.

`NotificationPreference` defaults global push on, and the current quiet-hours evaluator
supports suppression at the current instant. It does not provide a durable deferred-send
schedule. The story permits waiting through quiet hours without choosing expiry, backlog,
preference-edit, opt-out/re-opt-in, or missing-timezone behavior.

**Proposed amendment:** introduce a community settings contract that preserves existing
v1 alert response shapes and old-client writes. Default community opt-in false for both
existing and missing rows. Require community opt-in AND global push enablement AND a current
registered token; obtain native OS permission through an explicit registration lifecycle.
Choose whether quiet hours are the shared account setting and state that effect in the UI.
Recommend capture only engagements eligible for community opt-in at publication, permanently
cancel queued pushes on opt-out, and never resurrect old work on re-opt-in.
Define start-inclusive/end-exclusive quiet hours, invalid-zone fail-closed behavior,
persisted next eligible instant, DST handling, preference-edit rescheduling, and a finite
maximum deferred age. Recheck policy before every provider attempt.

**Approval evidence:** run the old client parser and old PUT body against the new provider;
exercise concurrent weather/community preference edits. Use a fixed clock for overnight
windows, exact boundaries, DST spring gaps/fall folds, timezone changes, invalid persisted
data, token transfer/logout, opt-out while queued, and re-opt-in. Verify restart recovery at
the quiet-hours release instant.

### F8. HIGH: the proposed E2E evidence can pass without exercising push or live delivery

Risk: TECH, 3 x 2 = 6.
Story anchors: lines 63-64, 76, 78, 85, 111-114.

The existing local stack starts the narrow community worker, so real database/worker
browser testing is feasible. Existing comment journeys deliberately use Refresh.
Copying them does not prove unsolicited delivery to a second user's active session.

`scripts/run-maestro.mjs:148` pins Expo Go 54.0.8 for Android.
`apps/mobile/app/_layout.tsx:110` skips notification listener setup in Android Expo Go.
The inspected app has a received-notification analytics listener; no notification-response
listener, cold-start response consumption, or Expo token registration call was found by
repository search. The parser currently carries `cardId` and no comment/reply target.
These are concrete implementation prerequisites for the stated journey.

Expo removed Android remote-push support from Expo Go in SDK 53.
See [the SDK 53 release record](https://expo.dev/changelog/sdk-53).

**Proposed amendment:** define separate evidence lanes for provider dispatch, native OS
notification open, and routed-link behavior. Name a notification-capable native build and
device profile for iOS/Android. Make permission/token registration, foreground/background
tap handling, cold-start response consumption and duplicate-tap handling explicit.
Specify post/comment/reply target IDs and how an older paginated target is resolved.
Clarify whether web supports opening links/preferences only or browser push as well; the
existing Expo adapter supplies native push.

**Approval evidence:** two authenticated identities, a real mutation and worker, a real
socket or polling transport, and a receiving UI that updates without Refresh.
Prevent polling from masking the socket-success test; then force socket failure and prove
polling recovery separately. Native builds must prove an OS notification tap with exact
target focus, warm and cold app states, and localized unavailable fallback.
Shell-routed deep links remain useful routing tests. Record OS handoff coverage separately.
Include EN/ES/FR, keyboard composition/draft preservation, screen-reader announcement,
target outside the first comment page, and screenshots on both platforms.

### F6. MEDIUM: logical notification identity and reaction re-add semantics are undefined

Risk: BUS, 2 x 2 = 4.
Story anchors: lines 29-31, 42, 74, 84.

`community.repository.ts:205` deduplicates mutation replays with a receipt. Changed reactions
create analytics events; remove followed by add is a new mutation and another added event.
Those identities do not establish the story's promised no-repeat engagement notification.
Comment submission and comment publication are also separate commits.

**Proposed amendment:** write the qualification and identity table. Recommend one reaction
notification per actor/post/recipient for the post's retained lifetime, with replacement,
removal, no-op mutation and re-add all unable to generate a second notification. Use one
comment-publication notification per comment/recipient, including retries/rescreening.
For replies, form the union of post author and parent author and exclude the actor.
Define whether all currently registered devices receive the one logical recipient delivery,
how new tokens affect pending work, and how retention/erasure interacts with dedupe.

**Approval evidence:** concurrent duplicate mutations; add/replace/remove/re-add; same-value
mutation; repeated publication; post author equal to parent author; actor equal to either
recipient; multiple devices with one failed token; replay after dedupe retention. Assert
provider attempt counts and durable unique keys alongside the visible outcome.

### F9. MEDIUM: the 60-second claim has no reproducible operating envelope

Risk: PERF/OPS, 2 x 2 = 4.
Story anchors: lines 74, 77, 83, 94-95.

The story leaves "supported operating conditions" undefined. The narrow worker schedules
dispatch every second, and `community-worker-runtime.ts` executes post, reaction analytics
and comment sweep steps sequentially. Adding notification work behind slow dependencies
can consume its budget. Recorded deployment has one worker and a 512 MiB resource profile.
Screening acceptance and public comment publication are separate milestones.

**Proposed amendment:** start the normal deadline at the qualifying public commit; start a
quiet-hours deadline at the first allowed instant; preserve both timestamps across retries.
Declare arrival rate/burst, queued backlog, token fanout, provider timeout, outage exclusions,
lease-recovery bound, expiry and drain target. Give notification dispatch independent bounded
progress when screening or analytics stalls. Include restart downtime as visible degradation.
Emit pending age, eligible age, oldest overdue work, unknown/failed/suppressed counts and
deadline misses through a sink known to run in the deployed worker.

**Approval evidence:** use a deterministic local provider recorder and real wall-clock
integration runs under the declared workload/resource profile. Retain counts and latency
distribution plus every deadline miss. Block analytics/screening independently and verify
notification progress. Validate deadline arithmetic with a fixed clock at unit level.
Measure live provider acceptance separately when a safe nonproduction lane is available;
provider-device arrival time is outside the stated dispatch boundary.

## Required test architecture and acceptance proof

| Priority / IDs              | Level and boundary                                        | Required falsifiable evidence                                                                          |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| P0, `6.5-INT-001..004`      | Real PostgreSQL transactions and two independent readers  | Reversed commit order, rollback, equal timestamps, snapshot/live catch-up overlap                      |
| P0, `6.5-INT-005..008`      | Real API authorization, RLS roles, socket and legacy poll | Denied viewers learn no community activity; live revocation; expired auth; canary/private exclusion    |
| P0, `6.5-INT-009..012`      | Owned worker process, database leases, provider recorder  | Crash before enqueue, after claim, after provider acceptance; late response and stale-owner settlement |
| P0, `6.5-INT-013..016`      | Erasure/consent transactions racing claimed work          | No resurrection or unauthorized send; exact linkage cleanup; retained audit integrity                  |
| P1, `6.5-UNIT-001..006`     | Pure policy/state reducers with fixed clocks              | Dedupe qualification, quiet-hours/DST, cursor scope, stale entity revision, request ownership          |
| P1, `6.5-CONTRACT-001..004` | Actual client wrappers and provider verification          | New polling/preferences schemas; old weather clients; expiry/error semantics; malformed events         |
| P1, `6.5-E2E-001..003`      | Two browser identities, real worker/API/transport         | Passive recipient refresh, isolated socket success, forced polling recovery, preserved draft/focus     |
| P1, `6.5-MOBILE-001..004`   | Native build on iOS and Android                           | Permission/registration, foreground/background/cold tap, off-page reply focus, unavailable fallback    |
| P1, `6.5-PERF-001..002`     | Real worker topology and controlled provider              | Defined dispatch envelope, backlog/drain, bounded progress during sibling failure                      |
| P1, `6.5-OPS-001`           | Intended hosted entry points in isolated environment      | Upgrade/auth, cross-instance relay, worker revision/readiness, rolling-version compatibility           |

These IDs are proposed allocations, not tests that already exist.

Reuse `apps/api/integration/helpers/isolated-community-database.ts` and shared
`@couture/testing` factories. Existing reaction-lease and comment-recovery integration
tests supply useful deterministic barriers and database-clock controls. Add real process
termination only at the crash boundary; retain handles/PIDs for processes created by the
harness. Stop and clean only those owned resources.

Compose Playwright fixtures through the existing
`playwright/support/fixtures/merged-fixtures.ts` and community-session helpers.
Use `apiRequest` for HTTP setup/assertions, `interceptNetworkCall` for HTTP observation
registered before actions, `recurse` for eventual conditions, and the configured log,
auth-session and network-error-monitor fixtures. Supply canonical response schemas.
Document any uncovered raw WebSocket inspection as a narrow utility deviation.
Keep the acceptance path on real transports; fault injection belongs in explicitly named cases.

For Pact, use the real API-client wrappers, `createProviderState`, `setJsonContent` /
`setJsonBody`, `buildVerifierOptions`, and `createRequestFilter` or `noOpRequestFilter`.
Use provider-scrutinized schemas and one interaction per test. Preserve the repository's
version-compatible isolated Pact runner configuration. Pact validates messages/contracts;
the database/worker suite must establish delivery ordering and crash behavior.
See [Pact scope](https://docs.pact.io/getting_started/what_is_pact_good_for).

Require readiness for the exact API, worker, database, Redis and gateway topology.
Playwright supports multiple managed services; a server already listening on a port needs
identity verification before reuse. See
[Playwright web servers](https://playwright.dev/docs/test-webserver).
Keep local and CI lanes isolated from production and disable remote flag evaluation in
deterministic fixtures.

Retain the executed-test manifest, skips, retries, commands, exit codes, revision/build IDs,
sanitized provider attempt ledger, traces, screenshots, native hierarchy/video and timing
results. Required cases must execute and fail the gate on failure; optional/skipped assertions
cannot count as acceptance. GitHub's `continue-on-error` changes failure propagation, so
it must not swallow required acceptance failures.
See [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).

## Decision and next peer checkpoint

**CHANGES_REQUIRED.** Resolve F1-F9 in the story or an explicitly linked design decision
before implementation approval. The coordinator can make the routine choices already
delegated by the owner. Re-review the amended delivery guarantees, cursor protocol,
visibility/erasure linearization, preference compatibility and concrete E2E lane.

This verdict concerns story readiness. It makes no claim that the unimplemented feature
passed acceptance or that Community Beta can open. Preserve the production rollout freeze.

## Amendment provenance and handoff, 2026-10-20

The owner expanded the initial review scope to document amendments. This session edited
the story and linked `6-5-realtime-engagement-design.md`, integrating the initial findings
and Opus rereview RR-1 through RR-11. Initial review evidence above is retained as history.

The current editor's own Herdr terminal footer was read and reported to the coordinator:
**GPT-6.1-Sol high**, with 79% weekly allowance at that observation. The requested final
independent `gpt-6-astra high` sign-off has not run in this runtime. This amendment note
issues no Astra approval and makes no claim about the initial runtime beyond its requested
reviewer role. The coordinator will start a fresh verified Astra high reviewer.

The amended story is iteration 2 and remains draft. Decisions are concrete in D1-D10:

- Dedicated Vercel WebSocket function, primary-database cross-instance doorbells, actual
  protected-preview upgrade/reconnect evidence and an owned isolated preview worker.
- Committed-domain-outbox appender with transactional head locks, per-post revisions,
  row-skipping assistance and a proved bootstrap-before-replay handoff.
- Separate public/private community streams and preferences, a compatible batch target
  resolver, current visibility fences and legacy contract isolation.
- Real Supabase session/OTP, installation registration/rotation, generic native payloads,
  warm/background/cold OS notification response handling and exact reply resolution.
- Explicit qualification identities, quiet-hour/DST/expiry policy, token receipts, terminal
  uncertainty without ambiguous resend and partial-token conditional outcomes.
- Privacy-only advisory keyspaces with a global order, PostgreSQL 17+ server guard timeout,
  per-subject erasure generations and an honest external-handoff limitation.
- Shared remote-only cohort cache with fail-closed expiry and erasure, measured flag costs,
  quiet-hour herd sizing, native prerequisites and mandatory browser/native/worker proof.

The Sol amendment self-check corrected additional details: disabled-state first-occurrence
tombstones, offline logout authentication limits, private erased sources staying out of
public doorbells, cache refresh avoiding guard lock-order inversion, and target schema
compatibility. These checks are amendment work, separate from the forthcoming independent
TEA judgment.

Verification at this boundary is documentation-only: local formatting, relative-link checks,
conflict-marker checks, artifact hashes and worktree scope. Runtime acceptance remains
unexecuted. D10 requires every browser/native/provider/worker/deployment lane before story
delivery. Credential, platform-version and capacity observations are explicit preflight
evidence, with no optional substitute or new purchase decision.

No source implementation, migrations, deployments, commits, pushes or merges occurred.
No process was signaled. No permission denial or escalation occurred. `wKS:p1` remains
the active coordinator; no successor takeover was initiated.

Review dispositions are in the linked design. The next boundary is **AMENDMENTS_READY**
for independent Opus rereview 2 and a fresh verified Astra high review.

Stable amendment inputs at this boundary:

- Spec SHA-256: `01e25534a8a0392ef1c9a5a7c4aa1451e2ef485ee48e848042c245168fd1e4d6`.
- Design SHA-256: `c0c297ca965098e53d858f1152008cbce5485e93a6570043c2c0ae02acc40627`.
- Local Prettier check passed for the spec, design and this review; relative links resolved,
  no conflict markers or trailing whitespace were found. `git diff --check` passed; the
  artifacts are untracked, so the explicit file checks cover their content.
