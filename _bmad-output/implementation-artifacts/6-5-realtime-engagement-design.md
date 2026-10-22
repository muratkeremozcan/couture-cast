# Story 6.5 realtime engagement design

Updated: 2026-10-20. Administrative approval and implementation-status record.

Status: in-progress; both independent story reviews are READY for implementation.
Amendment provenance: document editor verified as GPT-6.1-Sol high. Final independent
TEA approval comes from the fresh verified `gpt-6-astra high` reviewer recorded below.
Parent: [Story 6.5](spec-6-5-realtime-engagement-notifications.md).
Baseline: `aa8cd0e1f12ea778a9ca40b76c0868637f1b55a1`.

This document supplies the implementable contracts and acceptance evidence behind the compact
story. Numeric limits are initial Community Beta limits to verify during implementation.
Production community read/write flags stay disabled. The selected topology reuses existing
infrastructure; the explicit preflight verifies its capabilities and capacity. This design
authorizes no new paid subscription. Normal metered use is measured against the existing budget.

## D1. Deployed topology and realtime transport

Use the existing Vercel API project, Supabase primary PostgreSQL, and Northflank community
worker. Add `apps/api/api/realtime.ts` as a separate function exporting a Node HTTP server
with Socket.IO. Give it `maxDuration: 300`; leave the REST handler's 25-second budget intact.
Use the exact transport path `/api/realtime`, `addTrailingSlash: false` on both ends, and an
explicit rewrite preceding the current catch-all. Host namespace `/community` on that path.
Use the same server factory locally. Pin compatible Socket.IO client/server versions; add the
real client dependency and constructor to the shared client transport layer.

Both browser and native clients use `transports: ['websocket']`, handshake `auth.token`,
and a fresh verified session token on every reconnect. Browser Origin allow-lists, JWT validation,
age/consent, account state and `community_read_enabled` apply before joining. Tokens never
appear in URLs, application logs or event data. Production flag-off users cannot hold an
authorized community connection.
Native clients may omit Origin only with a verified bearer JWT in handshake auth; cookie-only
authentication is rejected. Test absent Origin, allowed browser Origin and denied browser Origin.

Current official guidance supports this server export on Fluid Compute and requires client
reconnect at function-duration expiry. Connections are pinned to instances. This is a
repository integration decision with a mandatory preview proof.
[Vercel WebSocket guide](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections).

Each instance runs one non-overlapping one-second primary-database head check while it has
authorized sockets. Batch public-head and connected users' private-head reads. Attempt the
bounded appender from D2 first. Compare heads internally and send only
`{ version: 1, type: 'community:changed' }` to affected eligible sockets. No stream sequence,
actor, target, private activity count or content crosses this socket boundary.
Separate public and author-private heads prevent another author's pending activity from
triggering a public doorbell. Coalesce doorbells to one per socket per second.

This provides cross-instance notification without adding Redis Pub/Sub commands or relying
on an instance's memory as shared authority. Existing BullMQ/Redis continues screening.
Stop timers and release database connections after the last disconnect or function shutdown.
Start primary-database age/consent/account revalidation at most eight seconds apart, including
jitter, and immediately before a doorbell. Its two-second authorization budget keeps completed
revalidation within ten seconds, using the shared rollout evaluation below. Disconnect at JWT
expiry. Affirmative denial stops delivery and closes the connection. Unverified eligibility
holds doorbells and emits an identifier-free `community:availability` control message with
`{ version: 1, status: 'unavailable' }`, then closes the connection. Affirmative denial uses
the same strict control schema with `status: 'denied'`. These are connection-control messages,
separate from durable domain events. Client handling follows D3 and never treats an ordinary
transport disconnect as affirmative denial.
Content endpoints always independently authorize.

Use API-only PostgreSQL `CommunityFlagEvaluation(member_id, flag_key, remote_value,
remote_evaluated_at, expires_at, next_claim_at, refresh_owner, refresh_until, subject_generation)` for a
shared 60-second per-member cache across API, realtime and worker processes. All community
read paths use this evaluator without changing their wire schemas. A short conditional row
claim gives one refresher a two-second lease; commit the claim before the remote call and
conditionally store the result afterward. Refresh ahead once the remote value reaches
45 seconds of age; its hard expiry remains 60 seconds from that request's start. A caller
with a still-valid result can use it while one refresher works. A cold/expired caller joins
the existing same-member claim and waits for its result within both the claim's remaining
lease and its own absolute two-second authorization budget. Use bounded database rereads
with jitter and one local waiter per member/instance; do not hold a row/privacy lock while
waiting. A completed remote false is an affirmative denial; no result by the deadline is
typed 503 `unavailable`, never 403. Socket behavior is the control path above.
The short claim/completion transactions take D7's shared privacy-member guard and verify
current account/generation before insert/update. No guard is held during the remote flag call.
Allow one claim per member/flag per 45 seconds, including failed refreshes. Each claim permits
one remote invocation with a one-second HTTP deadline, reserving the rest of its two-second
lease for claim/persist/waiter overhead. Completion requires the same unexpired claim owner,
subject generation and request identity; stale/late owners cannot write. A claimant that
misses its invocation deadline makes no remote call. Expired claims can be abandoned; they
never extend authorization or bypass the next-claim limit. A live waiter can consume the
winner's valid result without starting another refresh. A failed call does not extend the
last successful result's expiry. Test timing and actual call counts under pause, contention
and retries; the theoretical cadence alone proves no failure-path traffic bound.
Anchor authorization conservatively to the database claim timestamp before remote invocation:
store that origin as `remote_evaluated_at` on successful completion, expire it at origin+60s
and begin refresh eligibility at origin+45s. Record actual network start separately for timing
evidence. The claim atomically sets `next_claim_at` to at least origin+45s even if it fails.
No client clock or provider latency can extend that validity. If there is no active claim and
the next one is rate-limited, an expired/cold caller receives typed503 with bounded retry
timing. A loser rereads the winner's new validity against database time before returning it.
Recheck expiry at content serialization, doorbell emission and final send authorization;
work queued under a valid result cannot serve an expired grant. If it expired while waiting,
use only the remaining authorization budget to join a refresh, then return unavailable.
The flag adapter must report remote/fallback provenance. Store only coerced remote results;
the existing synthetic-user fallback cannot establish a real member's cohort eligibility.
On timeout, undefined, quota limit or error, keep the last remote result only until its
original expiry, then report unavailable. No expired grant is served. A generation check
prevents an erased member's late refresh from
recreating a row. Read-flag/cohort loss and remote-outage access expiry take effect within
60 seconds plus the ten-second revalidation interval. JWT expiry remains immediate.
The existing deployment freeze stays disabled throughout; no cache may override it.
Measure this existing service's incremental usage in D10.
[PostHog request billing and caching](https://posthog.com/docs/feature-flags/cutting-costs).

Reconnect starts at 500 ms, doubles to 15 seconds, adds up to 20% jitter, and resets after
30 seconds connected. Reconnect and foreground restoration always invoke catch-up.
Healthy WebSocket delivery is a required deployed acceptance path. Polling is an outage
recovery path. Keeping a local socket and a permanently polling deployed client fails this story.

Before deployed proof, record API project Fluid Compute state, plan tier, function duration,
route resolution, allowed origins, exact build SHA, and preview protection configuration.
Use the provider's protected-preview mechanism for the E2E upgrade, redact its credential
from traces, and never ship it in a client bundle. Measure active-connection memory/CPU,
database query rate and transfer usage on the existing plan. Platform usage remains billable.
[Vercel WebSocket operations and billing](https://vercel.com/docs/functions/websockets).

## D2. Committed outboxes, serialized append and ordering proof

Create API-only `CommunityDomainOutbox`, `CommunityStreamHead`, and `CommunityStreamEvent`
tables. Domain transactions insert minimal outbox records in the same transaction as the
change. A domain outbox UUID is identity only. Every producer locks its affected post before
assigning a monotonic `community_revision` and inserting the outbox record. Multi-post
changes lock posts in ascending ID order. Existing member-before-post locking remains.

`community_revision` covers post visibility, reaction aggregate changes, comment publication
and removal. Give author-private submission changes a per-author monotonic revision using
an atomic counter-row update while holding the member lock. Migration-owned triggers record cross-feature visibility/comment/reaction
invalidation; repository code records notification qualification separately. A trigger must
take the post lock before revision allocation. Test trigger recursion, no-op writes and
cascades. Coalesce repeated invalidations within a transaction where practical.

Streams are `public` and one opaque internal author stream per member. Heads contain an
epoch, last appended sequence and retention floor. Events carry a unique source outbox ID,
stream sequence, entity revision, kind and minimal routing identifiers. Public and private
event identities are distinct; private rows never enter the public stream.

Any worker sweep, catch-up request or active realtime instance may run the same bounded
appender. Catch-up assists only when oldest-unappended age exceeds two seconds or no assist
has been claimed for that stream in the last second. A short conditional update of
`last_assist_at` avoids duplicate work; it commits before the append transaction. A claim
never advances the stream sequence. Domain writers never acquire a stream-head lock.
The append transaction:

1. Reads at most 100 committed, unappended candidate IDs in oldest-first order without locking.
2. For each candidate, opens a savepoint, tries its shared privacy-member and privacy-post
   advisory locks in D7 order, then claims the still-unappended row with
   `FOR UPDATE SKIP LOCKED`. On any busy lock, missing row or changed subject set, roll back
   to that savepoint and continue with the next candidate. Rollback releases that candidate's
   locks; successful candidates retain theirs. Ordinary engagement locks are never taken.
   All multi-candidate privacy acquisitions are try-locks, so no waiting cycle can form.
3. Re-reads subject generations and source existence. A purged/stale public source becomes
   an anonymous public resync invalidation when public state needs refreshing. A private
   source stays in its authorized private lane or is discarded; it cannot trigger a public
   resync. Neither case recreates erased identity-bearing rows.
4. Tries the affected stream-head row locks in deterministic order with `NOWAIT`.
   A busy head rolls back immediately; another holder is making progress.
5. Increments each ordinary transactional counter, inserts events with
   `UNIQUE(source_outbox_id)` and `UNIQUE(stream_id, sequence)`, and marks those source rows
   appended in the same transaction. Commit releases the head locks.

Use primary reads, Read Committed, a 500 ms total append transaction deadline and 100 ms
lock timeout as a final guard. No network call or source mutation occurs while holding a
head lock. One busy subject cannot abort unrelated candidates. A failed batch retries on the
next sweep/request with jitter and bounded fairness;
claimable older rows receive priority by creation time and UUID. Expose oldest unappended
age and repeated-busy counts so starvation fails the freshness gate.
Test a continuously busy oldest candidate while later candidates append, followed by prompt
append of the skipped candidate after release. Privacy mutations retain their bounded retry
policy; ordinary reactions cannot keep the appender's privacy keys busy.
INT-001..006 inspects `pg_locks` by the appender's backend PID and exact advisory keys before
and after `ROLLBACK TO SAVEPOINT`: candidate-only transaction advisory locks must disappear,
while locks acquired before that savepoint remain. A second transaction must immediately
claim the skipped row with `FOR UPDATE NOWAIT`; row locks usually do not appear directly in
`pg_locks`, so absence of tuple entries alone proves nothing. Retain both observations.
[PostgreSQL lock inspection](https://www.postgresql.org/docs/17/view-pg-locks.html).

**Ordering argument:** appender B cannot allocate a sequence for a stream until A's lock
releases. If A commits, its event rows and counter become visible together before B allocates.
If A aborts, both roll back. Thus no later committed stream sequence can cause a cursor to
skip an earlier invisible append. `source_outbox_id` uniqueness closes retry/crash duplicates.
PostgreSQL holds row locks through transaction end and ordinary counter updates roll back.
[PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html),
[transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html).

Stream order is durable append order. Different domain transactions can become appendable
in another order, so client state applies only through authoritative per-post revisions and
request ownership fences. A lower revision invalidation cannot overwrite a higher revision.
There is no promise to replay every intermediate rendered state.

The Opus `bigserial` plus `xmin` horizon proposal is rejected: transaction ID allocation and
sequence allocation can occur in different orders, leaving an invisible earlier sequence
behind a returned later sequence. A deferred source-trigger counter could work with complete
lock-order enforcement; the committed-outbox appender keeps the hot head lock out of source
transactions and permits recovery independently of the screening worker.

## D3. Events, catch-up, snapshots and revocation

New canonical contracts live under community contracts. Keep `EventEnvelope`,
`/api/v1/events/poll`, `lookbook:new`, and existing weather/ritual payloads unchanged.
No new community row/channel enters the legacy polling table.

| Internal kind       | Producer                                              | Public response rule                         |
| ------------------- | ----------------------------------------------------- | -------------------------------------------- |
| `post.published`    | Screening publication or authorized release           | Visible post ID and revision                 |
| `post.removed`      | Withdraw, takedown, consent suspension, erasure       | Anonymous `resyncRequired` invalidation      |
| `reactions.changed` | Changed aggregate, removal, actor erasure             | Visible post ID and revision                 |
| `comment.published` | Successful screened publication                       | Visible post/comment/parent IDs and revision |
| `comment.removed`   | Author delete, moderation, consent, erasure           | Anonymous `resyncRequired` invalidation      |
| `comment.status`    | Pending/held/blocked/failed/private status transition | Author-private lane only                     |

Public event schemas exclude member IDs, aliases, text, reaction selection, viewer state and
media URLs. A source that is currently unavailable produces a generic resync marker without
its identifiers. Canary sources are excluded. Author-private IDs are returned only to their
owner; content remains on the existing guarded read endpoints.

Add `POST /api/v1/community/targets/resolve` with at most 50 targets. Each input has an
opaque client correlation key, `postId` and optional `commentId`/`parentId`. Reject duplicate
keys, invalid relationships and oversized requests with canonical typed errors. Each result
echoes only the correlation key plus a discriminated result: unavailable, or available with
`communityRevision`, current post/reaction data and the authorized comment/reply's parent,
page cursor and thread position. Unavailable results disclose no canonical identifier or
reason distinguishing missing from hidden content. The caller already possesses its input.
Read revision and returned state in the same primary snapshot; perform the fresh visibility
check before serialization. Reuse existing nested public schemas inside this new envelope.
Existing strict feed/post/comment response schemas remain byte-compatible. This endpoint
provides versioned rendered-target revalidation, refresh data and off-page deep-link resolution.
Bind client request ownership to correlation key, authenticated scope and visibility generation.
`6.5-CONTRACT-004..005` prove real wrapper parsing and legacy-open-client compatibility.

`GET /api/v1/community/events` returns `{ data: { events, nextCursor, hasMore,
resyncRequired } }`. Cursor is signed/versioned and bound to stream epoch, authenticated
member and community filter scope. It carries independent public/private scan positions.
Limit each request to 200 scanned rows, allocating up to 100 to each nonempty lane.
`hasMore` describes unscanned work in that response's captured head bounds. Advance by
scanned position even when every row is filtered. An empty exhausted lane advances to its
captured head. Deliberate erasure gaps are legal.
Capture heads, retention floors and bounded rows in one primary Repeatable Read transaction;
query only positions at or below those captured heads. After ending that snapshot transaction,
recheck authorization and current visibility using fresh primary reads before serialization.
A row now unavailable becomes an anonymous resync. Transmitted bytes have D3's recall limit.

An absent cursor requests bootstrap heads H, before the client fetches authoritative feed,
rendered card aggregates and any open thread from primary-backed endpoints. Subscribe
before/bootstrap concurrently, buffer doorbells, obtain H, fetch those views, then catch up
strictly after H until caught up. A change already appended at H is reflected by the later
authoritative read; a change appended afterward is caught by replay. A domain change that
committed before the read but remains unappended later causes a harmless refresh.
Doorbells never advance cursors. Poll, reconnect and socket work share one catch-up flight.

Malformed/scope-mismatched cursors return typed 400; stale epoch or position below retained
floor returns typed 409 `resync_required`; transient dependency failure returns typed 503
`unavailable`. Authorization failures retain their established 401/403 behavior.
Errors never masquerade as successful empty pages. A resync clears cursor/request ownership,
captures new heads and rebuilds authoritative views while retaining permitted drafts.

Read paths evaluate the existing community age/consent rules, current read rollout,
account availability and canonical public predicates. The write rollout gates new mutations
and screening publication; a write freeze alone does not revoke read access or cancel an
already published eligible notification. A read freeze suppresses community delivery.
Rollout changes have D1's 70-second maximum evaluation bound. The 20-second active-view
bound below applies to content visibility and database-backed eligibility, with a healthy
response; it does not shorten the rollout-cache expiry.

Periodic catch-up starts at most eight seconds apart including jitter only in fallback mode
when the socket is unavailable. Its two-second authorization budget preserves D1's
70-second rollout-loss bound. The healthy socket lane uses server revalidation and doorbells;
it has no periodic REST catch-up or target polling. It still performs bootstrap, connect,
foreground/resync and doorbell-triggered catch-up. The isolated socket-success test disables
all periodic client polling. Authoritative target fetches triggered by received invalidations
remain part of that event-driven lane.

A typed 503 or socket `unavailable` control hides community content, marks it stale, suppresses
mutations and preserves permitted drafts, focus ownership and cursor state for retry. Use the
bounded reconnect/backoff policy and respect retry timing; coalesce retries with catch-up.
No unknown or expired authorization grants content. An affirmative remote false clears the
rendered community view and subscription; age/consent/account failures and authentication
loss clear personal state/drafts according to their existing ownership/privacy rules.
An ordinary disconnect enters unavailable/fallback without inventing a denial. Successful
verification restores only currently authorized data and permitted same-owner drafts.

After fallback catch-up, including an empty page, revalidate currently rendered targets
in a bounded batch. These data refreshes may coalesce up to 15 seconds apart; allow at most 3 seconds
of scheduling jitter and 2 seconds of successful response time. Thus healthy fallback
removes unavailable content within 20 seconds. Socket notifications normally shorten this.
On offline/error with unverifiable access, hide content, mark the view stale and suppress
interactive mutation while retaining permitted drafts; revalidate
before foreground restoration. Authentication loss immediately clears personal state,
draft ownership, cursors and subscriptions.

Post/comment invalidation increments client visibility/request generation before launching
replacement fetches. Results captured under an older user, filter or visibility generation
are discarded. Maintain authoritative entity revisions; removal cannot be undone by a late
successful fetch. Previously transmitted bytes are outside recall; the bounds above govern
active-view convergence.

## D4. Shared preferences without breaking old clients

Add separate `CommunityNotificationPreference(user_id, enabled=false, revision, updated_at)`.
Do not add keys to the strict legacy alert preference request/response schemas.
Use `GET/PATCH /api/v1/community/notification-preferences`. Return community enablement,
effective global push state, shared account quiet-hours fields/timezone, and an opaque
revision covering both rows. PATCH carries the base revision and only explicitly changed
fields; stale revisions receive 409 with current settings.

Community controls edit the same account quiet-hours policy that weather uses, and their
localized label states that effect. Global `pushEnabled` remains the master switch exposed
by existing alert controls. An older alert PUT keeps its current wire contract and updates
its existing fields only; it cannot reset community enablement. Add internal member locking
and policy-generation invalidation to both write paths. Old-client writes retain last-writer
semantics; a new guarded PATCH detects an intervening old-client write.

Existing/missing community rows mean opted out. The community UI never reports successful
mobile enablement before permission and registration complete. On first configuration,
suggest device IANA timezone when no account timezone preference exists; preserve an existing
chosen timezone. Show the stored timezone and permit explicit change on travel.

Locale already exists in `UserProfile.preferences.locale` through `UserService.updatePreferences`.
Resolve it at send time; support EN/ES/FR and fall back to English for absent/unsupported data.
No second authoritative locale column is needed.

## D5. Authentication, installation binding and notification-open lifecycle

The current mobile resolver has only development token wiring, and current signup creates
an application profile without issuing a Supabase session. Story completion requires a real
session bridge on web/mobile: verified Supabase sign-in, persistence/restore, refresh, and
session-end hooks feeding the existing API and socket token resolvers. Reuse the existing
Supabase Auth project and identity mapping. Add the minimal email OTP sign-in/callback path
for existing application accounts; keep signup age/guardian checks and server-owned role
assignment. A verified identity with no eligible application account remains denied.
Never ship fixture access tokens or trust client-supplied app metadata.
Resolve the canonical application user through authenticated `GET /api/v1/user/profile`.
JWT `sub` identifies the Supabase auth principal; it cannot substitute for the API-resolved
application `User.id`. The native real-auth probe uses different values for these IDs and
proves wardrobe ownership, community state, token registration and session switching all
use the same canonical app user. Cover both server-owned app metadata and verified-email
mapping through the existing API identity rules.

Automated nonproduction sign-in uses a server-side Supabase Admin `generateLink` OTP/token
for an isolated existing eligible account, then enters the returned OTP or consumes its hash
through the app's real `verifyOtp` callback. Exercise actual session persistence, refresh and
logout; keep service-role credentials and generated secrets out of bundles, logs and traces.
The test helper is harness-only and is absent from deployed application routes. No inbox is
part of the automated acceptance dependency chain. Human email sign-in keeps the built-in
relay's restrictions visible: current Supabase guidance limits it to project-team addresses
and two messages/hour. General member email rollout requires an already configured suitable
sender; this story purchases no SMTP service. Production community rollout remains frozen.
[Supabase Admin generation](https://supabase.com/docs/reference/javascript/auth-admin-generatelink),
[OTP verification](https://supabase.com/docs/reference/javascript/auth-verifyotp),
[Supabase SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp).

Persist native session credentials in OS-protected storage; clear them on local sign-out.
Refresh with the app lifecycle and feed auth changes to realtime, registration and pending
deep-link routing. Web session handling must deliver a current bearer token to the socket
without putting it in a URL. Follow current supported Supabase client/session mechanisms.
[Supabase React Native session guidance](https://supabase.com/docs/guides/auth/quickstarts/react-native),
[Supabase email OTP](https://supabase.com/docs/reference/javascript/auth-signinwithotp).

Add canonical authenticated, idempotent endpoints:

- `POST /api/v1/notifications/push-tokens`: body includes Expo token, installation ID,
  platform and current permission state; returns an opaque registration ID and binding
  generation. Derive owner from authenticated identity. Limit active registrations to five
  per account and return a typed limit error; expose owner-scoped registration listing/removal.
- `DELETE /api/v1/notifications/push-tokens/{registrationId}`: owner-scoped conditional
  removal; token strings never occur in URLs or response bodies.

An installation ID is random and stored locally; it is not an authentication credential.
Tokens are unique, persisted only in protected client/provider storage and server-side,
redacted in all logs and bound to the current
account/installation generation. Explicit registration can transfer the installation to
another signed-in account; acquire both privacy-member guards, then any existing member
locks in D7 order and cancel the old
binding's unstarted attempts. Reject stale owner/generation writes. Bound/retry transactions
when ownership changes between candidate discovery and locking.

Mobile enablement requests OS permission, obtains an Expo token with the configured project
ID, registers it, then enables the community preference. Denial leaves community opt-in off
and shows localized device-settings guidance. On foreground, reconcile permission and token
state. `addPushTokenListener` signals native-token rotation; obtain the new Expo token before
registering it. Do not submit the native APNs/FCM token as an Expo token.
Refresh registration on authenticated foreground; expire inactive registrations after 30 days.

Community opt-out cancels community work while preserving tokens used for weather.
Online logout/account switch unbinds that installation before clearing the session; local
state is cleared immediately even when cleanup fails. Offline logout records the opaque
pending registration ID. Cleanup requires reauthentication as its owner, an authorized
installation transfer on the next sign-in, or inactive-binding expiry; network restoration
alone cannot authenticate a deletion after credentials were cleared. The server cannot
observe offline logout immediately, so generic notifications can continue until that binding
is removed, and accepted notifications may arrive later. Opening one requires a fresh
authorized session and never restores the old account's view. Do not represent the existing
no-op session invalidator as proof.

Register both notification-response listener and cold-start last-response consumption.
Serialize pending responses behind auth/router readiness and dedupe by notification ID plus
response action. Remove listeners on teardown. Clear consumed startup responses so reopening
the app cannot navigate again. Received-notification analytics alone is insufficient.

Extend the shared deep-link contract with optional `commentId` and `parentId`, valid only for
community notifications with `cardId`. Resolve an older comment/reply through a canonical
authorized D3 target-resolution endpoint, including its parent and pagination location; never
assume the target occupies page one. Fallback: visible comment/reply, visible thread, visible
post, ritual with localized feedback. Do not reveal which inaccessible object existed.

Native push data is limited to version, opaque notification ID, source/type, post/comment/parent
IDs and expiry. Title/body are localized generic engagement copy, with no alias, user ID,
comment text, reaction choice, media or location. Multi-item summaries route to the visible
post. Web supports preferences and community URL opening; browser push is outside the story.
Use the installed SDK's supported notification APIs and native builds for OS handoff.
[Expo notification lifecycle](https://docs.expo.dev/versions/latest/sdk/notifications/).

## D6. Qualification, recipient dedupe, quiet hours and burst policy

Persist a qualification intent transactionally with the actual changed reaction or successful
comment publication. Each recipient's enabled state and community opt-in generation are
captured at qualification; missing/disabled preferences create no deliverable work.
Record the source's first-occurrence dedupe tombstone even when delivery is suppressed,
including while opted out. A later remove/re-add or re-release cannot turn that source
into a newly qualifying engagement.
The sending worker rechecks the captured generation and current eligibility.
Opt-in never sends historical engagements. Opt-out increments the generation and permanently
cancels pending/deferred work; re-opt-in cannot resurrect it.

| Change                                                    | Logical identity                                     | Recipients / behavior                                   |
| --------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| First changed reaction from null to a selection           | Actor + post + recipient, retained for post lifetime | Post author, excluding actor                            |
| Same selection, replacement, removal, remove/re-add       | Existing reaction identity                           | No additional push                                      |
| Comment first becomes published                           | Comment + recipient                                  | Post author, excluding actor                            |
| Reply first becomes published                             | Same comment identity + recipient                    | Union of post author and parent author, excluding actor |
| Retry, replay, release/rescreen of same published comment | Existing comment identity                            | No additional push                                      |
| Post publication or private submission status             | No push identity                                     | Realtime only                                           |

Deduplicate before token fanout. One logical recipient notification can target all current
active registrations, up to five. Freeze the eligible registration generations when forming
the first send group. Tokens registered later do not replay an accepted/unknown old group.
Known rejected/invalid tokens never cause accepted sibling tokens to resend.

Coalesce unsent qualifying intents for the same recipient/post into one group. Outside quiet
hours, the first group is due immediately; subsequent groups start at most once per 30 seconds.
This caps burst noise while keeping the maximum intentional delay below the 60-second budget.
Attach newly arriving intents to a pending group until its immutable token snapshot/send starts.
Unsent contributors must still be visible and eligible at final dispatch; remove suppressed
contributors and recompute copy/target. Empty groups become suppressed.

Use account quiet hours with inclusive start and exclusive end in the persisted IANA timezone.
Equal endpoints are invalid when enabled. Missing/corrupt zone or time data fails closed with
a durable reason. Defer during quiet hours and persist `next_attempt_at`.
Compute the first allowed UTC minute by evaluating actual instants, up to expiry: nonexistent
spring-forward minutes cannot schedule work, and repeated fall-back minutes remain quiet
when their local labels are within the window. Date changes and midnight-spanning windows
use the same evaluator. A disabled quiet-hours setting permits immediate work.

Store `qualification_recorded_at` with the database clock at the end of the source transaction.
It becomes observable only on commit and conservatively starts the outside-quiet-hours
deadline; PostgreSQL does not supply an ordinary row column with its exact future commit time.
Retain this original timestamp through append and worker handoffs. Tests observe actual
commit completion separately and require the dispatch bound from both timestamps.

Every intent expires 24 hours after `qualification_recorded_at`. At window exit send one
group per recipient/post for surviving deferred intents. Expiry wins when no permitted
instant exists before expiry. Policy edits recalculate unsent work; extending quiet hours
can defer it, disabling quiet hours releases it, and opt-out cancels it. Preserve original
public-commit time and record each policy-derived eligibility change.
The quiet-hour exit groups are due immediately; the normal 30-second subsequent-group
spacing never delays this initial deferred release. D10 explicitly sizes and tests that herd.

The 60-second budget starts at public commit outside quiet hours, or the first allowed instant
for a surviving quiet-hours deferral. Coalescing delay is included. Actual provider/worker
failure never resets this clock. Missing permission/active token, erased actor/recipient,
unavailable target/parent or read rollout off suppresses work permanently. Write rollout
alone follows D3. Current age/consent and actor/source validity are rechecked at dispatch.
Unverified/dependency-unavailable eligibility defers unstarted work for bounded retry with
the original deadline and expiry. It cannot be interpreted as affirmative opt-out/flag-off
or permanently suppress an otherwise valid intent. Proven no-call attempts follow D7.

## D7. Durable attempts, privacy serialization and uncertain outcomes

Create logical-intent/dedupe records, recipient groups, token deliveries, attempts and receipts.
Unique constraints cover logical source/recipient, group/registration-generation for each
token delivery, and delivery/attempt ordinal for each provider attempt.
Keep statuses distinct: `pending`, `deferred`, `sending`, `accepted`, `retryable_rejection`,
`unknown`, `suppressed`, `expired`, `failed`. Leases use random ownership IDs and generations.
Every completion is conditional on current ownership. Recovery never reuses a `sending`
attempt; it becomes terminal `unknown` if acceptance cannot be established.

The community provider adapter issues exactly one HTTP request per token attempt and performs
no hidden SDK retry. Use a bounded abortable transport with an absolute two-second send
deadline. Persist `sending` and immutable attempt ID in a committed transaction before any
provider call. A crash in the following interval may lose a push; the durable marker prevents
repeating an ambiguous external side effect. Logs and metrics expose that loss of certainty.

Use dedicated transaction-level advisory namespaces `community_privacy:<memberId>` and
`community_post_privacy:<postId>`. Senders and appenders take shared guards. Erasure, consent
revocation, opt-out, shared preference-policy writes and token unbind/transfer take exclusive
member guards; takedown, withdraw, comment deletion, consent suspension and erasure also take
exclusive guards for affected posts. Cover direct SQL and trigger-driven privacy paths.
Ordinary reaction/comment submission/publication retains its existing engagement locks.
It never takes a privacy guard. Publication still checks current eligibility under those
existing locks; erasure/consent also retains the existing locks to serialize domain writes.
Represent the new namespaces with PostgreSQL's two-integer advisory-lock API and reserved
namespace integers, distinct from existing one-bigint engagement locks. Deduplicate and sort
the actual computed lock keys inside each level, so even hash collisions preserve acquisition
order. Collisions can add conservative privacy contention; they cannot bypass a guard.

The global order is: privacy-member keys ascending, privacy-post keys ascending, existing
`community_member:` keys ascending, then `community_report:` and `community_submission:`
keys in fixed namespace/key order, then post rows ascending, owned outbox/registration/attempt
rows in fixed table/ID order, then stream heads ascending. Paths may skip levels. Domain
privacy operations discover all subjects/posts before acquiring locks; a changed set causes
rollback and rediscovery. No blocking acquisition returns to an earlier level. D2's
multi-candidate acquisitions use immediate try-locks and savepoints, then lock stream heads
only after candidate discovery ends. Stream-head transactions never acquire earlier locks.
Triggers validate that the owning privacy entry point obtained the necessary guards before
row mutation; they cannot add an earlier-level blocking lock after a post row is held.
The implementation must enumerate and test every erasure/guardian/moderation/delete entry
point, including paths outside the community module.

Before initiating the request, open a separate bounded authorization transaction. Acquire
shared privacy guards for every linked actor/recipient/post author/parent author and target
post, then registration rows `FOR SHARE` and the attempt row `FOR UPDATE` in the order above.
The guard takes no engagement-member or post-row lock. An unrelated reaction/comment must
complete within its normal baseline latency while the recording provider deliberately stalls.
Resolve/refresh rollout before the guard. Inside it, read the shared cache without locking
or refreshing and require a still-unexpired remote grant; expiry ends this attempt's
authorization without a provider call. No remote flag lookup occurs under privacy guards.
Recheck existence, erasure generations, source/parent visibility, opt-in generation, account
quiet hours/global push, token ownership/permission, read rollout and deadline. All privacy
mutations and preference/token changes acquire the corresponding exclusive privacy guards
before their existing domain locks and registration/attempt work. A target-set change requires releasing and retrying
lock discovery before any request starts.

Hold these guards through the bounded provider attempt and its conditional outcome write.
This is an intentional, measured exception to keeping network I/O outside database
transactions: it defines a serialization point for erasure/consent/opt-out against send start.
Use a three-second authorization-transaction limit, D10's bounded send concurrency and a
separate pool with capacity for those sends plus control operations. Never take a stream-head
lock in this transaction. The absolute local deadline and cancellation state must be checked
immediately before calling the transport; a transaction failure aborts the transport.
Start the guard with `SET LOCAL idle_in_transaction_session_timeout = '3s'`,
`lock_timeout = '250ms'` and `statement_timeout = '500ms'`. Record actual Supabase server
version, direct/pooler mode, session pinning and connection limits. This design selects
PostgreSQL 17+ and `SET LOCAL transaction_timeout = '3s'` for guard connections. Startup
fails closed for community dispatch if that setting is unavailable or ineffective through
the selected pooler; record compatibility before enabling the isolated dispatch lane.
Use PostgreSQL 17+ in the isolated integration environment. Verify the effective maximum
lock lifetime under process suspension and a dropped network path, with no guard-renewing
heartbeat. Prisma's client timeout alone is insufficient. Terminated pool connections are
discarded. A required existing-project database upgrade is an explicit preflight failure,
never an implicit version change or a reason to weaken the guard bound.
[PostgreSQL transaction and idle timeouts](https://www.postgresql.org/docs/current/runtime-config-client.html),
[Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).

Give ownership leases ten seconds, exceeding the three-second guarded operation. Recovery
requires both lease expiry and expiry of the recorded server guard window, then conditionally
locks/rechecks the attempt before changing it. Prove the request function was never
entered before treating a live pre-send lock/budget failure as retryable. A crashed process
cannot supply that proof, so recovery treats its durable `sending` marker as unknown.

Successful final authorization under these guards is the handoff linearization point.
If revocation acquires the subject lock first, the attempt is suppressed without authorization.
If final authorization happens first, treat that attempt as in flight; revocation waits for
the guard's bounded release. A database disconnect can release server-side locks before the
worker observes it. There is no atomic transaction spanning PostgreSQL and Expo: an already
authorized request can cross that failure interval or arrive after erasure acknowledgment.
Abort immediately on observed transaction failure and initiate no request after observed
failure/deadline. The residual authorized-handoff risk is bounded operationally and its
payload remains generic. Never claim remote recall or exact send/erasure atomicity.
Local initiation observes the absolute two-second deadline. Process suspension and network
transit mean previously authorized external arrival/display have no finite application bound.
Report database erasure completion only after exclusive privacy guards were acquired and
the prior guard window elapsed; that acknowledgment cannot certify remote notification recall.

A timeout cannot recall provider-bound bytes. Mark unknown and never resend.
If the guarded transaction rolls back after provider acceptance,
the earlier durable `sending` marker survives and recovery marks unknown. A late callback
cannot restore deleted rows or settle another owner. Test connection loss as well as process
death, including connection loss between authorization and transport invocation; preserve
the distinction between a suppressed request and an uncertain already authorized handoff.

Retry an initiated provider call only after an explicit rejection documented to mean the
message was unaccepted. Proven no-call rescheduling follows the guard rule above.
Use at most three attempts with 2-second and 10-second backoff, preserving eligibility time.
Treat timeout, connection reset, malformed/missing ticket, ambiguous 5xx and unclassified
transport errors as unknown. A pre-send validation/configuration failure records a failure
without a provider call. Avoid guessing whether a generic SDK error sent bytes.

Store accepted ticket IDs per registration generation. Receipt lookup begins at 15 minutes,
then retries after 1, 5, 15 and subsequently 60 minutes until 24 hours after acceptance.
`DeviceNotRegistered` from ticket or receipt removes only the matching token/binding
generation. Receipt lookup failures or missing receipts at expiry become `receipt_unknown`;
they never resend accepted messages. Preserve successes while handling a failed sibling.
Every shared weather/community token caller must carry the captured registration ID, owner
and binding generation through fanout, dispatch and conditional pruning. Remove raw-token-only
cleanup from the shared path without changing legacy wire schemas. Cover the production chain
`alert-fanout.repository.ts` -> `alert-fanout.processor.ts` -> `sendBatchNotifications` ->
`push-token.repository.ts`, including both NotificationsModule and `workers/bootstrap.ts`
composition. A delayed weather invalid-token ticket/receipt for an old binding must remove
zero rows after the same token transfers; the new owner's community registration survives.
Expo access credentials, when enhanced push security is enabled, are server-only. `EXPO_TOKEN`
used by EAS CLI is not an assumed send-service requirement.
[Expo tickets, receipts and retry guidance](https://docs.expo.dev/push-notifications/sending-notifications/).

Exactly-once device presentation is not a provider guarantee. The application guarantees a
single logical identity and no new send after an ambiguous attempt, and deduplicates response
handling where it controls the client. Provider-accepted deliveries can still be duplicated
or lost externally.
[Expo delivery guarantees](https://docs.expo.dev/push-notifications/faq/).

## D8. Per-subject erasure, retention and telemetry

Maintain a per-member delivery/erasure generation with server-only subject links from every
outbox, event, intent, group, attempt and receipt that can identify that member. Link actor,
recipient, post author and parent author roles explicitly. No raw identity lives only inside
an opaque JSON payload or concatenated key that cleanup cannot enumerate.
The shared flag-evaluation cache and any refresh claims are subject-linked and erased too.
Flag refresh completion requires matching subject generation and never upserts missing rows.

Account erasure and effective consent revocation acquire exclusive privacy guards first,
then the established member/post locks in D7 order. Increment generation and cancel unsent
work atomically. Privacy operations wait at least the three-second guard limit or retain a
durable pending request and retry on lock timeout; a busy send cannot discard or fail erasure.
Prove completion within the guard bound plus the erasure transaction's measured budget.
Only report completion once D7's database guard window has elapsed.
Erasure immediately removes private event rows, tokens/bindings, identifying payloads and
subject-linked notification data; it anonymizes permitted aggregate outcome evidence.
For a group with other surviving contributors, detach erased contributors and recompute
only work whose send has not started. Preserve accepted/unknown token-delivery tombstones
and never recreate their work while cleaning a sibling. Unstarted surviving work retains
its original deadline; deleting an actor must not silently strand another actor's intent.
Keep required immutable moderation audit records under their existing rules. Physical media
cleanup retains the existing 72-hour deadline. Consent revocation preserves necessary dedupe
tombstones so later consent restoration cannot recreate an old push.

Before deleting visible source material, enqueue an anonymous public resync marker in the
same transaction. Actor erasure also invalidates reactions/comments on other authors' posts.
The appender's subject guards and generation check prevent an erased outbox claim from
reintroducing linkage. Pending queue jobs carry only opaque IDs, and missing authoritative
rows terminate them. Late sink callbacks never upsert.

Retention:

- Stream events: 48 hours from append. Retention advances each head's floor transactionally;
  cursors below it must resync. Expired private heads can be compacted after their member's
  removal. Restore/stream reset rotates epochs before service resumes.
- Unappended invalidations: retain until append or explicit conversion to anonymous resync.
  Age alone cannot discard a mutation silently. Unsent push intents expire at 24 hours.
- Detailed terminal delivery/attempt/receipt rows: 30 days, with bounded daily cleanup.
- Minimal logical dedupe tombstones: lifetime of the source post/comment; reaction tombstones
  survive reaction removal. Source/account erasure removes or anonymizes subject linkage.
- Inactive registrations: 30 days. Pending binding cleanup retries on reconnect/server sweeps.
- Flag evaluations: delete after one day inactive, with immediate erasure and original
  60-second validity unchanged. Refresh-claim expiry cannot extend authorization.

Telemetry stores event type, sanitized reason, outcome, latency, retry count, backlog age and
build identity. Use the existing erasable HMAC subject-mapping pattern when correlation is
necessary. Never log push tokens, JWTs, raw member/target IDs, bodies, aliases, media URLs,
notification data or external error payloads. Durable telemetry delivery deduplicates by
random event ID; subject erasure fences claimed telemetry just as notification work.

## D9. Client presentation and accessible target resolution

All data reconciliation follows the same single-flight catch-up coordinator. Debounce visible
post invalidations for up to one second; refresh only rendered cards and open threads, in
bounded batches. Repeated fetches are allowed. Applied state never regresses in revision.
New looks appear in a localized polite announcement and an "N new looks" action that inserts
them without disrupting scroll/focus; the user needs no full page refresh.

For an open thread, refresh authoritative pages while retaining existing pagination bounds,
draft text and composer focus. Announce new comments without moving focus. Hidden items
leave the view; if a removed item held focus, move to the nearest stable thread/card landmark
and announce unavailability. Clear unauthorized drafts on user/consent loss.

Deep links resolve current visibility before opening and focus the exact card/comment/reply
landmark, with one screen-reader announcement. Preserve a draft when opening an allowed
target in the same authenticated scope. Locale catalogs, keyboard focus, touch target sizes,
contrast, screen-reader order and viewport screenshots are acceptance evidence on web,
iOS and Android.

## D10. Operating envelope and falsifiable proof

Initial envelope: primary database available; each DB operation within its bounded timeout;
at most 100 active community sockets per tested instance; appender batch 100/500 ms; source
arrival at most 20 invalidations/second with a burst of 100; realtime active-view reconciliation
within ten seconds in a healthy lane and within the D3 20-second fallback bound.
Measure these values on the existing resource profile before approval to ship.

Push envelope: one arriving token attempt/second sustained, normal burst/backlog of 40 due
attempts, and a simultaneous quiet-hour exit herd of 500 token deliveries, with maximum five
tokens per recipient. Use 32 send slots and a dedicated pool budget of 36 connections including
control headroom, subject to the existing project's measured total connection/memory budget.
Each guarded operation is at most three seconds, including its two-second provider deadline.
The lower-bound scheduling calculation is `ceil((500 + 40 + 60) / 32) * 3 = 57 seconds`;
measure scheduling/claim overhead within the remaining three seconds. Quiet-hour exit work
is immediately due. Schedule by earliest original eligibility deadline with fair recipient
rotation so new traffic cannot strand the herd. The normal 30-second coalescing delay remains
inside its own 60-second deadline. This arithmetic establishes a capacity target; measured
full-path results establish acceptance.
Preflight records the actual Supavisor server-pool size, direct server-connection limit and
reserved headroom. Budget all API/gateway instance pools and worker pools together, including
rolling-deployment overlap; 32 idle guarded transactions each pin a server connection.
An insufficient existing pool is a failed capacity gate. Concurrency may change only if the
same herd/deadline proof passes; neither the required herd nor expiry/guard bounds shrink.
Report any required compute-plan change to the coordinator; no silent plan upgrade is allowed.

Before proof, count all due groups times their frozen token generations in the largest actual
timezone cohort. Record recipient count, group count, mean/max tokens and total H. The 500
floor covers 100 recipients with five tokens and one group each; multiple post groups count
separately. Test `max(500, H)` at the same minute, including a DST transition and normal traffic.
If H or the real connection budget requires more capacity, improve scheduling/capacity on
the existing service and re-review measured limits before delivery; no item receives a later
eligibility timestamp to hide the herd. Isolated load proof must show every eligible surviving
token dispatch within the deadline under the declared envelope.
If measurements fail, improve scheduling/capacity on the existing service and re-review
the envelope; do not quietly weaken acceptance.

Give append, notification send, receipt cleanup and moderation independent non-overlapping
loops and bounded work budgets in the existing worker runtime. An analytics or screening
stall cannot stop push progress. Realtime/API append assistance keeps event freshness
independent of screening-worker crash recovery. Worker/provider outage is measured
degradation: retain original eligibility time, count overdue/unknown/failed items, expose
oldest pending and unappended ages, and drain within 60 seconds of recovery for the declared
500-attempt backlog plus the normal 40-attempt burst. Queued expired items remain expired.

For OPS, run an owned local community worker against the isolated preview database/Redis
and the same exact build as the Vercel preview. This is the selected nonproduction worker;
never point preview traffic at the production Northflank worker or its database/Redis.
Record environment identities and test flags, disable remote flag evaluation for deterministic
fixtures, and exercise the real cached evaluator separately with its controlled remote adapter.
Stop only that owned process for worker-down append assistance. Production worker resource
measurements may use existing sanitized operational evidence, with no fixture writes.

`6.5-PERF-003` measures shared-cache flag calls across multiple instances. The nominal
45-second refresh cadence is 80 evaluations/member/hour, approximately 5.76 million calls
for 100 continuously active members over 30 days. Forecast one additional call/member per
rolling hour for claim-to-invocation boundary jitter; report interval endpoints explicitly.
These are cadence/budget calculations, not proved failure-path request bounds. Count actual
remote invocations under cold starts, claim contention, expired claims, delayed owners and
retries across instances; record every overrun and its cause. An old owner may never extend
grant validity. Capture actual provider
usage/spend, Vercel active CPU/memory/transfer, database query/connection rate and worker RSS.
Existing metered use is authorized; a free-tier ceiling is not a product acceptance gate.
Record incremental cost against the owner's existing infrastructure budget and alert at 80%
and 100% of that configured budget. Do not introduce a subscription or silently raise a limit.

### Native and infrastructure preflight

| Prerequisite                                                            | Implementation owner / evidence                                                                     | Cost and acceptance boundary                                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `expo-notifications` plugin, channel, Android icon, native entitlements | Story implementer updates app config and inspects generated native config                           | Local build route; actual plugin is absent at baseline                                   |
| FCM V1 service credential and Android project config                    | Existing Firebase/EAS project administrator supplies nonproduction configuration through secrets    | Reuse existing project; no paid service; absent baseline config is a required setup task |
| APNs key, signing and existing Apple membership                         | Existing account administrator supplies signing access, never committed credentials                 | Reuse current membership; this story authorizes no new membership purchase               |
| iOS/Android notification-capable builds                                 | Story implementer uses `expo run:ios` / `expo run:android`; retain app/build identity               | Local tools, or existing EAS free quota; no paid build-plan purchase                     |
| Native devices and CI simulators/emulators                              | Test implementer records OS, permissions and supported notification transport                       | Both platforms must execute OS-tap lifecycle and separate provider-to-device proof       |
| Database guard support and pooler                                       | Implementer records `server_version_num`, effective timeout settings, pinning and connection budget | D7 requires PostgreSQL 17+ total guard timeout on existing infrastructure                |
| Vercel preview and owned local worker                                   | Implementer records isolated DB/Redis/project IDs, exact revisions and routes                       | Existing services/local process; production worker is excluded                           |

Missing access is a concrete implementation blocker to report to the coordinator. It cannot
turn a required native/provider lane into optional or deferred acceptance. Keep the story
undelivered until the lane executes. The selected design contains no purchase decision.
[Expo native push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).
Align every affected local and CI isolated database service/image with PostgreSQL 17+.
The baseline Supabase local config pins 17, while `.github/workflows/pr-checks.yml` still
declares `postgres:16-alpine`; the implementation must update that affected CI service.
At test startup assert actual `server_version_num >= 170000`, then verify effective server
transaction/idle/statement/lock timeouts and the selected pooler's behavior. A configured
image tag alone is insufficient runtime evidence. This document batch changes no workflow.

| IDs / priority              | Required boundary                                          | Evidence that can turn the test red                                                                                                          |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `6.5-INT-001..006`, P0      | Real PostgreSQL, two source transactions and two appenders | Reverse source commit order, blocked head, abort, duplicate source, appender crash, no skipped cursor position                               |
| `6.5-INT-007..011`, P0      | API/gateway, real auth and RLS roles                       | Legacy poll isolation, public/private separation, canary exclusion, expired token, connected consent/read-flag loss                          |
| `6.5-INT-012..018`, P0      | Owned worker process and provider HTTP recorder            | Kill before send/after acceptance, delayed response, rolled-back outcome, stale lease, partial token outcomes, receipt pruning               |
| `6.5-INT-019..024`, P0      | Erasure/consent/preference/binding transactions            | Each subject role races claim and send guard; no resurrection; exact cleanup; preserved audit; old binding receipt cannot delete new binding |
| `6.5-UNIT-001..008`, P1     | Fixed-clock policy and state reducers                      | Midnight/DST boundaries, expiry, opt-out/re-opt-in, grouping deadline, token response dedupe, stale fetch rejection                          |
| `6.5-CONTRACT-001..005`, P1 | Actual client wrappers and provider                        | New sync/settings/token/target endpoints; old alert schemas and writes remain compatible                                                     |
| `6.5-E2E-001..005`, P1      | Two browser identities, real DB/worker/socket              | Incoming post/reaction/comment without Refresh; socket proof with periodic polling disabled; forced polling; draft/focus; takedown           |
| `6.5-MOBILE-001..006`, P1   | Native notification-capable build on iOS/Android           | Real auth/registration, permission denial, rotation, warm/background/cold notification tap, paginated reply focus, unavailable fallback      |
| `6.5-OPS-001..003`, P1      | Isolated Vercel preview and deployed worker                | Exact path upgrade, authenticated clients on separate instances, duration reconnect, worker-down assisted append, rollback compatibility     |
| `6.5-PERF-001..003`, P1     | Declared profile, controlled provider                      | Full deadline distribution/counts, burst backlog/drain, screening/analytics stall independence, memory/query/usage budget                    |

Use shared factories and isolated database helpers. Concurrency tests use explicit barriers,
not sleeps. Pin policy clocks; measure dispatch with actual monotonic elapsed time at the
recording provider. Run crash tests only against owned child processes and retain PID handles.
No production fixtures, provider tokens or resource identities may enter acceptance runs.

Playwright uses the established merged fixtures, `apiRequest`, `interceptNetworkCall`,
`recurse`, auth-session, log and network-error monitor; canonical schemas validate bodies.
Document a narrowly scoped utility deviation for raw WebSocket inspection if required.
Pact uses `createProviderState`, `setJsonContent`/`setJsonBody`, `buildVerifierOptions`,
request-filter utilities and real client wrappers. Broker tooling was unavailable during
design; broker compatibility must be measured later when reachable.

Existing Expo Go flows prove routed-link logic only. Build/install the actual native app for
notification tests. The primary deterministic CI lanes use `xcrun simctl push` on iOS and a
locally scheduled OS notification on Android with the production `data` shape. Maestro opens
the notification shade/notification and taps the actual notification in both lanes, covering
warm, background and cold start. Keep injection helpers restricted to the test build/harness.
Retain a separate nonproduction provider-to-device
proof on supported physical devices for both platforms. Register tokens through the app and
observe ticket, receipt, notification presentation and tap. A shell `openLink` cannot substitute
for OS tap evidence. Missing device/credential evidence leaves that acceptance lane pending.
Android Expo Go lost remote push in SDK 53.
[Expo SDK 53 release](https://expo.dev/changelog/sdk-53).

Required executions must have no skipped acceptance case or swallowed failure.
Retain commands, exit codes, executed IDs, retries, exact revisions, provider attempt ledger,
DB outcomes, latency distribution, traces, screenshots and native hierarchy/video.
Run scoped tests, `verify:changed`, full `validate`, Pact and Optic, then both native flows.
These are future proof obligations; this design document records no test pass.

Rereview-specific proof strengthens the matrix:

- INT-001..006: busy oldest outbox subject while unrelated rows append; release and recover
  the skipped row. Stop the owned worker and prove gateway/catch-up assisted append.
- INT-007..011: two instances share one member cache refresh; a PostHog outage with the
  synthetic ID enabled cannot grant a non-cohort member access. Prior remote grants expire
  within 70 seconds. Private-only erased activity cannot ring a public doorbell.
- INT-007..011: synchronize same-member feed/events/resolver/socket requests across two
  instances at cold start, refresh age45 and expiry age60. With remote success within its
  one-second deadline and database operations inside the declared budget, every request
  resolves from one current result without affirmative denial, cleared drafts or duplicate
  refresh. Hold the result past the two-second lease and assert typed503/control-unavailable,
  hidden content, retained drafts and bounded retries. Race true/false results, abandoned
  claims and stale completion; no result after hard expiry authorizes content.
- INT-019..024: hold a provider request while ordinary reactions/comments complete within
  baseline latency; race every privacy entry point in the global lock order. Suspend only
  an owned worker and sever its database path; observe server guard release, pending erasure
  completion, orphan recovery and no resend. Retain timestamps and conditional database state.
- INT-019..024: hold a weather invalid-token result, transfer that identical token to another
  owner/generation through the real registration endpoint, then release the old result.
  Assert zero deletion of the new binding in both Nest and standalone-worker compositions.
- MOBILE-001..006: real Supabase `sub` differs from app `User.id`; profile-resolved identity
  owns wardrobe/community/token state consistently before and after account switching.
- CONTRACT-004..005: old strict clients continue parsing while the new resolver returns
  revision/state atomically, unavailable correlation keys and off-page parent/reply locations.
- PERF-002: release `max(500, H)` quiet-hour tokens at once with the normal burst and ongoing
  traffic. Every dispatch retains its original allowed-window deadline.
- PERF-003: record cache call rate, cross-instance single flight, pool/RSS/query/CPU/transfer
  usage and actual metered spend. A missing cost observation cannot be reported as measured.

Deploy with community flags frozen: expand API-only tables/contracts first, deploy all new
privacy entry points and producer versions, then enable guard assertions and isolated lanes.
Record API/worker/gateway schema capability compatibility. A mixed old privacy writer cannot
be allowed to create new story work; require the version fence before dispatch starts.
Rollback stops community dispatch and leaves durable rows for recovery. Preserve legacy
weather/ritual behavior and perform a fresh privacy/visibility check on resumed work.

## Repository evidence behind the decisions

The baseline inspection establishes these integration gaps and reusable boundaries:

- `apps/api/api/index.ts` and `apps/api/vercel.json`: Express request forwarding and a
  25-second REST function. D1 adds the distinct supported HTTP-server entry point.
- `apps/api/src/modules/events/events.repository.ts`: timestamp-only polling includes global
  envelopes. D3's new tables prevent that legacy endpoint from exposing community activity.
- `apps/api/src/modules/community/community.repository.ts`,
  `community-comments.processor.ts` and `community-comments.privacy.ts`: existing member/post
  locks, transactional publication, revision patterns and explicit privacy cleanup.
- `apps/api/src/modules/notifications/push-notification.service.ts`: timeout/retry behavior
  has no cancellation or receipt reconciliation. D7 requires a separate community adapter.
- `apps/api/src/modules/user/user.service.ts`: locale already persists in profile preferences.
  D4 reuses that source.
- `apps/mobile/src/lib/mobile-auth.ts` and `apps/mobile/app/_layout.tsx`: development token
  resolver and received-notification analytics do not provide the full D5 lifecycle.
- `apps/api/src/workers/community.bootstrap.ts`: current sequential sweeps motivate independent
  bounded loops. `_bmad-output/test-artifacts/community-content-screening-model-readiness.md`
  records the historical Northflank worker canary and recovery timing; it cannot prove the
  future story revision or its capacity.
- `playwright/support/fixtures/merged-fixtures.ts`, isolated community database helpers and
  existing reaction/comment recovery integration tests supply reusable test infrastructure.
  The Expo Go Maestro runner needs an explicit notification-capable build lane.

## Review dispositions and approval record

| Review finding             | Disposition                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Astra F1 / Opus F1         | D1 selects existing Vercel WebSockets; platform-incapable claim withdrawn; hosted integration proof required                                                                       |
| Astra F2 / Opus F8         | D7 defines durable sending/unknown, no ambiguous resend, guarded handoff and token receipts                                                                                        |
| Astra F3 / Opus F5         | D2-D3 select serialized committed-outbox append and snapshot-before-replay; reject `xmin` recipe                                                                                   |
| Astra F4 / Opus F4/F6/F7   | D1-D3 isolate legacy events, private streams, revocation, anonymous removal and stale-fetch fences                                                                                 |
| Astra F5 / Opus F12        | D7-D8 enumerate subject locks/generations, retention and erasure                                                                                                                   |
| Astra F6 / Opus F8/F9      | D6 fixes logical identity, re-add, recipient union, grouping and quiet-hours policy                                                                                                |
| Astra F7 / Opus F3/F9      | D4/D6 preserve strict legacy contracts, shared account policy, locale source and DST scheduling                                                                                    |
| Astra F8 / Opus F2/F11/F13 | D5/D9/D10 add session/token/response lifecycle, exact target resolution and genuine native proof                                                                                   |
| Astra F9 / Opus F9/F10/F13 | D9-D10 define UX, capacity/deadline envelope, independent progress and measured gates                                                                                              |
| Opus RR-1                  | D7 reserves privacy-only advisory namespaces and a global order; provider-stall proof excludes engagement coupling                                                                 |
| Opus RR-2                  | D2 uses per-candidate savepoints/try-locks and skips busy rows without aborting unrelated work                                                                                     |
| Opus RR-3                  | D1 names the shared PostgreSQL remote-only member cache; D8 erases it; D10 measures calls/cost and outage bounds                                                                   |
| Opus RR-4                  | D10 names native configuration, existing credentials, local builds, OS-tap CI and mandatory provider/device proof                                                                  |
| Opus RR-5                  | D5 uses harness Admin generation plus real client OTP verification; records official human-email restrictions                                                                      |
| Opus RR-6                  | D3 selects the new strict target-resolution envelope carrying revision/state while preserving legacy schemas                                                                       |
| Opus RR-7                  | D6/D10 make exit groups immediately due and test at least 500 token deliveries against measured cohort H                                                                           |
| Opus RR-8                  | D10 selects an owned local worker against isolated preview resources, excluding the production worker                                                                              |
| Opus RR-9                  | D1 permits absent native Origin with verified bearer auth and tests strict browser origins                                                                                         |
| Opus RR-10                 | D2 makes catch-up assistance conditional and claims cadence without advancing stream position                                                                                      |
| Opus RR-11                 | D7 selects server-enforced PostgreSQL 17+ guard timeout; D8 defines erasure waiting; D10 tests suspension/network loss and residual handoff uncertainty                            |
| Opus RR2-1 / N2            | D1 refreshes ahead, waits boundedly and distinguishes unavailable from denial; D3 retains permitted drafts and limits periodic polling to fallback; D10 races cold/expiry requests |
| Opus N1/N3/N4              | D10 budgets actual pool capacity; D7 includes report/submission keys; D2 directly tests advisory release and independent row acquisition after savepoint rollback                  |

Rejected options with concrete reasons: polling-only deployment fails realtime scope; raw
actor-bearing `baseEventSchema` violates pseudonymous community transport; community opt-out
deleting shared tokens would disrupt weather pushes; ten-minute burst deferral would exceed
the 60-second acceptance budget; treating EAS CLI `EXPO_TOKEN` as an Expo send prerequisite
conflates credentials; adding another locale field duplicates existing profile preferences.

| Reviewer                  | Decision                 | Evidence                                                                  |
| ------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| Verified Astra high / TEA | READY for implementation | [Final independent review](reviews/story-6-5-astra-final-story-review.md) |
| Opus                      | READY for implementation | [Rereview 3](reviews/story-6-5-opus-story-review.md)                      |

Both approvals bind iteration 3 inputs before this administrative update:

- Spec SHA-256: `f6631b1ba026bec9eecaad516f0b3aeeba46883d51a36131cc5713e563c2efb2`.
- Design SHA-256: `91dc57ccbdcee454f879c87d08d8e1bdf3e4f883286f700cd31de7cc3cc36fdb`.

Routine design choices are owner-delegated. Both independent reviewers have signed off;
administrative status is in-progress. Hosting preflight, native credentials/devices and runtime measurements are explicit
implementation gates; lack of evidence cannot be reported as acceptance.
