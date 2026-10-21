# Story 6.5 pre-implementation review (Claude Opus 5.5, high)

Updated: 2026-10-20. Independent story review requested by the Codex coordinator (herdr wKS:p1).

- Story: `_bmad-output/implementation-artifacts/spec-6-5-realtime-engagement-notifications.md`
- Baseline: `aa8cd0e1` on `feat/story-6-5-realtime-engagement`
- Scope: story review only. No code, story, commit or push changes were made.

## Verdict

**CHANGES_REQUIRED.**

The intent and I/O matrix are sound, and the codebase already has the right building blocks:
per-post `FOR UPDATE` serialization, DB-trigger invalidation through `reaction_generation`, leased
outboxes, HMAC analytics subjects and a quiet-hours evaluator. Four blockers make the story
unimplementable as written, because each one forces a product or architecture decision that a
fresh implementation session would otherwise make silently:

1. There is no deployed host for Socket.io (F1).
2. No device can register a push token and no client has a socket library (F2).
3. Extending the shared preferences schema breaks shipped mobile builds (F3).
4. The legacy polling endpoint would broadcast community events to every user (F4).

Nine further findings tighten ordering, durable delivery, privacy, push policy, convergence and
verification. Each has an exact amendment below.

## Findings

### F1. Blocker: deployed API cannot host the Socket.io gateway

> Superseded by the rereview addendum (R1). The finding about the current `api/index.ts` entry
> holds, but the "platform incapable" premise and options (a) to (c) are withdrawn. Vercel
> Functions serve WebSockets on Fluid Compute.

**Evidence**

- `apps/api/vercel.json` routes all traffic to `api/index.ts` with `maxDuration: 25`.
- `apps/api/api/index.ts` builds Nest on an `ExpressAdapter`, calls `app.init()`, and never
  `listen()`s; its own comment states `src/main.ts` "is never reached in a deployed environment".
- `EventsGateway` and `AlertWeatherGateway` therefore only exist in local `main.ts` runs.
- The only always-on host is the community worker: one replica, concurrency one, 512 MiB,
  cost-ceilinged on Upstash PAYG (`epic-6-context.md` Technical Decisions).

The story's "authenticated subscription ... cross-instance relay" task and the AC "when clients
connect, reconnect or poll" assume a socket host that does not exist in preview or production.
The architecture's `api.` on Fly entry (`architecture.md:211`) is stale against the Vercel entry.

**Amendment.** Add a Design Notes decision record, chosen before implementation:

> Deployed realtime transport: <option>. Polling catch-up (`GET /api/v1/community/events`) is
> the correctness path on every surface and environment; the socket is a latency doorbell only.

Options to choose from:

- (a) Polling-only in deployed environments with the socket enabled locally and in E2E. This is
  the smallest safe scope, and production rollout is disabled anyway. Record a deferred-work
  item for a hosted socket.
- (b) A separate always-on realtime service on the Northflank account, with its own ingress,
  TLS, memory and cost budget, and an explicit statement that it is not the screening worker
  container.
- (c) Supabase Realtime private broadcast channels, with authorization through RLS on
  `realtime.messages`.

Recommendation: (a) for this story. Either way, amend the 60-second and convergence ACs to
state the polling interval that bounds staleness when no socket is available. The current
`PollingService` default is 30 s.

### F2. Blocker: no push-token registration path and no client socket transport

**Evidence**

- `PushNotificationService.registerPushToken` has no production caller and no controller.
- No HTTP contract under `packages/api-client/src/contracts/http/` registers or deletes tokens.
- Mobile never calls `getExpoPushTokenAsync` or `requestPermissionsAsync`. `app/_layout.tsx`
  only adds `addNotificationReceivedListener` for alert analytics.
- There is no `addNotificationResponseReceivedListener` and no
  `getLastNotificationResponseAsync`, so a tapped notification opens nothing, cold start
  included.
- No workspace depends on `socket.io-client`. `apps/web/src/app/lib/fallback.ts` and
  `apps/mobile/src/realtime/mobile-fallback-controller.ts` accept a `MinimalSocket` that nothing
  constructs.
- `mobile-auth.ts` resolves no token in production bundles, and no logout or sign-out exists on
  web or mobile, yet AC5 lists "logout".

"Community push requires ... existing push permission" refers to a capability the product does
not have.

**Amendment.** Add these Execution tasks, or explicitly descope them:

- `contracts/http/notifications.ts` (new): `POST /api/v1/notifications/push-tokens` (register
  or rebind, Expo token validated) and `DELETE /api/v1/notifications/push-tokens/{token}`
  (unbind). Both are authenticated, owner-scoped and idempotent, with regenerated SDK
  wrappers.
- Mobile opt-in flow:
  1. Request OS permission only when the user enables community push.
  2. Obtain the Expo token with `projectId` and register it.
  3. Unregister on opt-out.
  4. Re-register on token rotation through `addPushTokenListener`.
- Mobile tap handling: `addNotificationResponseReceivedListener` plus
  `getLastNotificationResponseAsync` for cold start, routed through the shared deep-link parser.
- Socket client: add `socket.io-client` at an exact version in `@couture/api-client` (shared) or
  in each app. On React Native use `transports: ['websocket']`. Reconnect with a fresh access
  token, because the handshake token is verified once (`createAuthMiddleware`).
- AC5: replace "logout" with "token unbind or session end". Add an Implementation Note that
  account logout does not exist yet and that unbinding is exercised through the DELETE
  endpoint.
- Web scope: there is no Web Push (no service worker or `PushManager`). State "push delivery is
  mobile-only. Web supports the community deep link URL and preference controls."

### F3. Blocker: adding a field to `alertPreferencesSchema` breaks shipped clients

**Evidence**

- `packages/api-client/src/contracts/http/alerts.ts:73` declares `alertPreferencesSchema` as
  `.strict()`.
- `apps/mobile/src/lib/widget-alert-preferences.ts:15` parses the GET response with that strict
  schema and returns `undefined` on failure ("Alert delivery fails closed"). An installed build
  receiving a new key silently disables widget alerts.
- `PUT /api/v1/alerts/preferences` is a full replace with the same strict schema. A required
  new field 400s old clients; an optional one gets reset by an old client saving weather
  preferences.

The story's task lists `contracts/http/alerts.ts` for the opt-in, which leads directly into
this.

**Amendment.**

- Keep `alertPreferencesSchema` byte-identical.
- Add community push preferences as their own resource, for example
  `GET/PUT /api/v1/community/notification-preferences` returning
  `{ communityPushEnabled, quietHours: <shared fields>, timezone }`.
- Persist them in a new column `NotificationPreference.community_push_enabled BOOLEAN NOT NULL
DEFAULT false`, or in a separate row, written with a partial update so weather fields are
  never touched.
- Add a Boundary line: "No change to `/api/v1/alerts/preferences` request or response
  schemas."
- Capture the device IANA timezone when opt-in is enabled. The `NotificationPreference.timezone`
  default `'UTC'` would otherwise evaluate quiet hours in UTC for every user who never opened
  weather preferences.

### F4. Blocker: legacy event polling broadcasts `user_id IS NULL` rows to every user

**Evidence**

- `EventsRepository.findSince` returns `OR: [{ user_id: userId }, { user_id: null }]` with no
  community, age, consent or flag check.
- It has no `take` limit.
- It uses a `created_at > since` cursor, which drops events that share a timestamp and events
  committed late with an earlier `created_at`.
- `EventsService.poll` swallows errors and returns `{ events: [], nextSince: null }`, which a
  client cannot distinguish from "caught up".

If community events land in `EventEnvelope` with a null user, every authenticated user
(under-13, unconsented, flag-off) receives them, which violates "preserve visibility, age,
consent ... rollout controls".

**Amendment.**

- Community events must not be written to `EventEnvelope`. Use a dedicated API-only table and
  a dedicated endpoint (`GET /api/v1/community/events?cursor=`).
- That endpoint enforces `community_read_enabled`, age 13+ and guardian consent on every call
  and returns a typed error (`resync_required`, `unavailable`). It must never return a silent
  empty page on failure.
- Leave `/api/v1/events/poll` behavior unchanged for ritual and weather. Add a regression test
  proving that no community channel ever appears in it.

### F5. High: commit-safe ordering protocol is left open

> The txid/xmin horizon proposed below is incorrect and is withdrawn. See the rereview addendum
> (R2) for the counterexample and the replacement protocol. The finding itself (the protocol
> must be decided in the story) and the trigger-producer and removal points stand.

The story correctly warns that a sequence allocated before commit cannot prove gap-free
catch-up, then leaves the protocol for implementation to choose. A fresh session given this
constraint is likely to reach for `bigserial`, which is exactly the defective option.

**Evidence of usable primitives**

- Every community mutation already serializes on `SELECT ... FROM "LookbookPost" ... FOR UPDATE`:
  reactions in `community.repository.ts:200`, comment publication in
  `community-comments.processor.ts:54`, takedown and release in
  `community-moderation.actions.ts:258`, guardian revocation in `guardian.service.ts:816`, and
  erasure in `community.repository.ts:483`.
- The moderation processor's `publishPost` uses a conditional `updateMany`, which also takes
  the row lock. So per-post revisions such as `reaction_generation` and
  `comment_publication_sequence` are already commit-ordered.
- DB triggers already advance `reaction_generation` on every reaction write, visibility change
  and erasure (migration `20261018090000_add_community_reactions`, lines 49 to 80).

**Amendment.** Replace the open Design Note with a decision:

> Stream rows are written by AFTER triggers in the same transaction as the source change:
>
> - `LookbookPost`: status, `published_at`, erasure, `reaction_generation` or
>   `comment_publication_sequence` changed.
> - `CommunityComment`: status transitions.
>
> Cross-feature paths (guardian revocation, erasure, moderation, worker) therefore cannot
> forget to emit. Each row carries `stream_id BIGINT IDENTITY` and
> `txid XID8 DEFAULT pg_current_xact_id()`.
>
> Catch-up returns rows with `stream_id > cursor` ordered by `stream_id`. It stops before the
> first row whose `txid >= pg_snapshot_xmin(pg_current_snapshot())`, so rows from transactions
> still in flight are never skipped. Each row also carries the per-post revision (`generation`
> or `publication_sequence`), which clients use as the version guard.
>
> Page size is at most 200 with `hasMore`. Retention is N hours, and an older cursor answers
> `resync_required`. The cursor is opaque and includes a stream epoch, so a database restore
> forces a resync.

Also amend:

- Name the coalescing rule. The trigger fires per reaction row, so a no-op upsert still bumps
  the generation. Stream rows are invalidation hints; push eligibility uses the repository's
  `changed` flag, never the trigger.
- Add the I/O row "Long-running transaction holds the horizon: catch-up delays, does not skip"
  and its integration test.

### F6. High: event taxonomy omits removals, so clients cannot converge

The story says events "originate from committed publication or engagement changes". The I/O
matrix and AC5, however, require hidden or deleted content to disappear. Takedown
(`takeDownPublishedPost`), author withdraw, `author_deleted` comments, guardian
`consent_suspended`, erasure (which also deletes the erased user's reactions on other people's
posts) and held or blocked comments are not publication or engagement changes. A client that
rendered the post or comment before removal keeps showing it until a manual refresh.

**Amendment.** Add a closed event-kind list to Boundaries:

- `post.published`, `post.removed`
- `reactions.changed`
- `comment.published`, `comment.removed`
- `comment.status` (author-private)

Removal kinds come from the same triggers as F5. The Code Map should name
`guardian.service.ts`, `community-moderation.actions.ts`, `community.repository.ts`
(`requestErasureForUser`, withdraw) and `community-comments.repository.ts` (author delete) as
producers.

### F7. High: privacy of the event envelope and recipients is underspecified

**Evidence**

- `baseEventSchema` in `packages/api-client/src/types/socket-events.ts` requires
  `userId: z.string().min(1)`. For a public post or reaction event that is the author or actor
  id, which deanonymizes members whom the product deliberately shows only as
  `CommunityAlias`.
- The socket handshake verifies identity once. Flag flips, guardian revocation and token expiry
  are never re-evaluated on a live connection.

**Amendment.** Replace "Event data contains identifiers and revision metadata" with:

> Public stream events carry only:
>
> - `streamId`
> - `kind`
> - `postId`
> - `commentId?`
> - `parentId?`
> - per-post revision
> - `climateBand?`
> - `occurredAt`
>
> They never carry a member user id, alias, body, media URL, reaction selection or viewer
> state. Author-private events go to a per-user room and per-user stream rows. Pending comment
> ids never enter the public stream.

Also add:

> Socket join requires `community_read_enabled`, age eligibility and consent. The server
> re-verifies on reconnect and on JWT expiry, disconnecting expired sockets.
> Guardian revocation disconnects the teen's sockets through the relay.

Define `lookbook:new` either as removed in favor of the new community channel, or as a v2
schema without `userId`, keeping `/api/v1` compatibility.

### F8. High: provider retry semantics can duplicate pushes

**Evidence**

- `PushNotificationService.sendBatchNotifications` retries the whole pending batch after
  `ExpoSendAttemptTimeoutError` or any thrown error, up to 3 attempts (100 ms and 250 ms
  backoff).
- A timeout after Expo accepted the request resends the same messages. Expo has no idempotency
  key.
- Invalid tokens are pruned only from push tickets. Most `DeviceNotRegistered` results arrive
  later in push receipts (`getPushNotificationReceiptsAsync`), which nothing fetches.

So "each logical recipient delivery is deduplicated" and "invalid-token cleanup" cannot hold
when the existing service is reused unchanged.

**Amendment.** In Design Notes:

> Community delivery calls Expo once per lease attempt. A failure before any bytes reach the
> provider (connect refused, DNS) is retryable with backoff. A timeout or ambiguous response
> after the request was sent is recorded as `uncertain` and never retried. Accepted tickets are
> persisted, and a receipt sweep (15 minutes to 24 hours after send) prunes `DeviceNotRegistered`
> tokens and records final outcomes.

Add the schema model `CommunityNotificationDelivery`:

- `UNIQUE (recipient_id, logical_key)`
- `status`: `pending`, `deferred`, `sent`, `uncertain`, `suppressed`, `failed`
- `suppression_reason`, `attempts`, `next_attempt_at`, `lease_id`, `lease_expires_at`
- `eligible_at`, `dispatched_at`, `ticket_ids`

Logical keys:

- reaction: `reaction:<postId>:<actorId>` for its lifetime, so remove/re-add and replace stay
  silent
- comment: `comment:<commentId>`
- reply: `reply:<commentId>`

Rows are written in the source transaction, only when the change is real (`changed`, or comment
publication) and never on submission.

### F9. High: push policy gaps (quiet hours, bursts, copy, eligibility at delivery)

**Evidence**

- `apps/api/src/modules/alerts/quiet-hours.ts` only suppresses (drops). The story says delivery
  "can wait until the allowed window" without choosing.
- There is no per-recipient rate limit or coalescing. Fifty comments on a post send fifty
  pushes.
- There is no recipient locale in the schema (no `locale` on `User` or `UserProfile`), so
  "localized" push copy has no input.
- The lock screen shows push body text.

**Amendment.** Add to Boundaries:

- Quiet hours: deliveries become `deferred` until the window ends. At the window end each
  recipient gets at most one summary push per post, and the 60-second budget starts at the
  window end. Deferred items older than 24 h are dropped as `expired`. A delivery is
  re-evaluated against the then-current preference, flag, consent and target visibility
  immediately before send.
- Coalescing: at most one push per recipient per post per 10 minutes, with Expo `collapseId`
  and `threadId` set to the post id. Choose and record the exact numbers.
- Copy: generic, content-free text ("New comment on your look"). It never contains the comment
  body, alias or image, and is localized from the recipient locale captured at opt-in (new
  column) with an `en` fallback.
- Eligibility at send:
  - recipient: flag on, age 13+, consent valid, not erased, global `pushEnabled` and
    `communityPushEnabled` both true, and at least one token
  - actor: not erased or suspended
  - target: post publicly visible; comment and parent published
  - On any miss, record `suppressed` with a reason. The row is never deleted, so replay stays
    deduplicated.
- Define "supported operating conditions" in the AC as:
  - a healthy single community worker on the existing 1-second dispatch cadence
  - Expo reachable
  - backlog under N

  Note that worker crash recovery (`communityCrashRecoveryMs` about 423 s) is outside the
  60-second budget and is visible through a `pendingAgeMs` metric. The community worker needs
  `EXPO_TOKEN` provisioned per environment and must fail closed (deliveries stay `pending`, and
  the metric fires) when it is missing.

### F10. Medium: client convergence and accessibility behavior is undefined

"Visible clients refresh once" combined with "preserve pagination and drafts" and "without
disrupting active composition" conflict unless the UX is defined. An unprompted feed refetch
moves the reader's scroll position and focus. A per-event `GET /community/posts/{id}` from every
viewer for every reaction is an N-by-M request storm on popular posts.

**Amendment.** Add to Design Notes:

- `post.published`: show a polite live-region affordance ("N new looks", localized). New posts
  insert only when the user activates it. Never auto-insert above the viewport, never move
  focus, and keep the existing `published_at,id` cursor intact.
- `reactions.changed`: debounce per post (trailing 1 to 2 s) and refresh only cards currently
  rendered. Apply results through the existing `revision/generation` guard
  (`community.ts:634`). Alternatively the event may carry public aggregate counts, which contain
  no viewer state, plus `generation`, which avoids the refetch. Choose one.
- `comment.published`: when the thread is open, fetch with the existing `snapshot` and
  `hasNewer` contract, append below with a polite announcement, and never touch the draft,
  composer focus or the `CommunityCommentsState` fences.
- `*.removed`: drop the item. If it held focus, move focus to the nearest stable landmark and
  announce it.
- Socket messages are doorbells only. Every update flows through the single catch-up fetch,
  which is single-flight per client, so socket, poll and reconnect paths cannot reorder state.

### F11. Medium: deep-link contract lacks the thread target

`packages/utils/src/deep-link.ts` has `cardId` but no `commentId`. `deepLinkSchema` is a
non-strict `z.object`, so a `commentId` param is silently stripped. A reply notification cannot
focus the reply.

**Amendment.** Add optional `commentId` to `deepLinkSchema` and `deepLinkIntentKeys`, valid only
with `type: 'community'` and `cardId`.

Define the fallback order:

1. visible comment
2. its thread on the visible post
3. the visible post
4. the ritual, with localized informational feedback

Push `data` carries only `source`, `type`, `cardId` and `commentId?`.

### F12. Medium: erasure and retention cleanup is not enumerated

`requestErasureForUser` and `eraseCommunityComments` are the authoritative erasure transactions.
New tables must be added there explicitly, or the 72-hour erasure promise silently regresses.

**Amendment.** In the schema task, list the following.

Erasure, in the same transaction:

- delete delivery rows where `recipient_id = user`
- delete delivery rows whose logical key names the user as actor
- delete per-user stream rows
- delete push tokens

Guardian revocation: cancel the teen's pending and deferred deliveries as `suppressed`.

Retention:

- stream rows: N hours
- delivery rows: 30 days, matching the reaction outbox
- dedupe keys: kept as long as the source reaction or comment exists

Telemetry uses the `CommunityCommentAnalyticsSubject` HMAC pattern. `PushToken.user` currently
has no `onDelete` behavior (`schema.prisma:746`), so record whether this story changes it or
erasure deletes tokens explicitly.

### F13. Medium: verification plan cannot prove several ACs as written

**Evidence**

- No real push reaches a simulator through Expo in CI.
- The Playwright local stack (`playwright/config/local.config.ts`) must run an API process with
  `listen()` for a socket test; confirm that `e2e stack launcher --with-web` does this and
  starts Redis.

**Amendment.** Specify the proofs:

- API integration against real Postgres:
  - two concurrent transactions committing out of `stream_id` order, with catch-up never
    skipping
  - a long-running transaction delaying the horizon
  - an expired cursor answering `resync_required`
  - duplicate job or replay producing one delivery row
  - quiet-hours deferral then release
  - a timeout after send ending as `uncertain` with no resend
  - receipt-driven token pruning
- Timing: integration with a fake Expo HTTP server, asserting
  `dispatched_at - eligible_at < 60 s`, and exposing a `pendingAgeMs` metric.
- Playwright (`community-engagement.spec.ts`), two browser contexts with two users:
  - live post, reaction and comment convergence
  - the socket blocked through route abort, recovering by polling
  - takedown removing a rendered card
  - draft preserved across an incoming comment
  - keyboard focus on a deep link, and the localized fallback
- Maestro (`community-engagement.yaml`): opt-in control and permission prompt; a
  notification-tap journey through `openLink` with the community deep link, with
  `xcrun simctl push` for the iOS payload where feasible; focus and fallback. State that real
  provider delivery to a device is out of CI scope.
- Pact covers the new catch-up and preference endpoints. Socket payloads are covered by the Zod
  contract tests.

## Smaller notes

- The I/O row "Committed ... visible clients refresh once" should read "apply exactly once per
  revision". Refetches can legitimately repeat; applied state must not regress.
- AC1 should say "in per-post revision order", since global order is not user-visible and is
  costlier to promise.
- The Code Map entry `apps/api/src/workers/community.bootstrap.ts` should note that the new
  dispatch joins the existing 1-second `schedule('dispatch', ...)` sweep with its own time
  budget, and that it must never block moderation dispatch. Alternatively it gets its own
  non-overlapping interval.
- Upstash cost: relay publishes and any new BullMQ use count against PAYG. Prefer Postgres-leased
  sweeps, matching the existing outboxes, and state the expected command budget.
- The sprint-row reconciliation for 6.4 is unrelated scope. Keep it as a separate commit.

## Recommended next step

Amend the story with F1 through F9 as decisions (F1, F3, F5, F8 and F9 need explicit choices),
fold F10 through F13 into Tasks and Verification, then request re-review. Re-review stays
available, as does later code review.

## Rereview addendum: hosting and ordering corrections (2026-10-20)

The coordinator raised two challenges:

- Astra reports that Vercel now serves WebSockets on Fluid Compute.
- The txid/xmin horizon can miss gaps.

Both challenges are correct. This addendum replaces F1's options and F5's protocol. Nothing else
in this review changed.

### R1. Deployed realtime on the existing Vercel API project

**Official sources, read 2026-10-20**

- [Vercel WebSockets docs](https://vercel.com/docs/functions/websockets), last updated
  2026-08-10.
- [Vercel KB: Do Vercel Functions support WebSocket connections?](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections),
  last updated 2026-10-01.
- [Backends on Vercel](https://vercel.com/docs/frameworks/backend), last updated 2026-08-20.

**What the docs establish**

- **Status.** Vercel Functions serve WebSocket connections. Public beta since 2026-06-22, on all
  plans.
- **Requirements.** Fluid Compute is required. It is on by default for projects created on or
  after 2025-04-23.
- **Lifetime.** A connection closes when the function reaches `maxDuration`. The default is 300 s
  on every plan. Hobby is capped at 300 s, Pro and Enterprise at 800 s (1,800 s in an extended
  beta).
- **Instances.** A connection pins to the instance that accepted it, and one instance holds many
  connections. A reconnect or a new deployment can land on another instance. Rooms and fan-out
  need external coordination.
- **Socket.IO.** Supported when the client uses `transports: ['websocket']`. Node servers export a
  `node:http` `Server` as the function file's default export.
- **Billing.**
  - Active CPU while messages are processed.
  - Provisioned Memory for the instance lifetime while any socket is open.
  - Fast Data Transfer and Fast Origin Transfer.

  This uses the existing Vercel project. It adds no new service or subscription, but the usage is
  real and must be bounded.

**Actual configuration (repository evidence)**

- `apps/api/vercel.json` declares one function, `api/index.ts`, with `maxDuration: 25`, and a
  catch-all rewrite `/(.*)` to `/api/index`.
- `api/index.ts` exports a request handler, so no long-lived socket can live there.
- The production API answers at `couture-cast-api.vercel.app` (`server: Vercel`,
  `x-powered-by: Express`).
- I could not verify the project's Fluid Compute toggle, plan tier or Deployment Protection
  settings from this machine, which has no Vercel CLI or token. Those three are preflight items
  below.

**Recommended route**

1. **New function.** Add `apps/api/api/realtime.ts`. It builds a `node:http` server with a
   Socket.IO `Server` attached synchronously and exports the server as the default export.
   - It runs a lean realtime composition: auth resolver, eligibility check, stream reader and
     Prisma. Do not use the full `AppModule`, so cold start and memory stay small.
   - Async dependencies initialize lazily on first connection.
   - Reuse `createAuthMiddleware`. The token travels in Socket.IO `auth.token` inside the
     CONNECT packet, which works over the websocket transport without custom headers.
2. **`vercel.json`.**
   - Add `"api/realtime.ts": { "maxDuration": 300, "memory": <lowest that passes load proof> }`.
     300 is valid on every plan, so plan tier does not change behavior.
   - Set Socket.IO `path: '/api/realtime'` with `addTrailingSlash: false` on both server and
     client, so the handshake targets the exact function path.
   - If a preview shows the `/(.*)` catch-all still captures the handshake, add an explicit
     `/api/realtime` rewrite ahead of it.
3. **Gate at the handshake.** Reject the handshake unless `community_read_enabled`, age 13+ and
   guardian consent all pass.
   - Flag-off and ineligible users never hold a billable socket.
   - With production community rollout disabled, production socket usage stays near zero until
     rollout.
   - Re-check eligibility on every reconnect. Disconnect when the JWT expires, and at most every
     300 s by construction.
4. **Cross-instance fan-out without new cost.** While an instance has at least one socket, it
   polls the stream head counter every 1 s. The poll is a single primary-key read on Supabase
   Postgres, which is existing infrastructure with no per-command billing. When the head
   advances, the instance emits a doorbell `{ streamSeq }` to the subscribed rooms.
   - This avoids Upstash PAYG pub/sub commands and needs no worker-to-API relay.
   - The existing Redis alert relay remains a valid precedent if measured cost allows. The story
     should pick one and record the per-instance query budget.
5. **The socket is only a doorbell.** Clients never apply socket payloads as state. Every
   doorbell, connect, reconnect and visibility-resume runs the single-flight catch-up
   `GET /api/v1/community/events?cursor=` on the normal `api/index.ts` function.
   - Socket loss at the 300 s cap, deploy rollover or instance change costs at most one catch-up.
     It never loses an event.
   - Polling at the configured interval is the bounded fallback when the socket cannot connect.
     It is a degraded mode, and completion still requires the deployed socket path to work.
6. **Client.**
   - `socket.io-client` pinned to the exact version matching server `socket.io` 4.8.x.
   - `transports: ['websocket']`, the `path` and `addTrailingSlash` above, and a fresh access token
     on every reconnect.
   - Jittered exponential backoff with a 30 s cap.
   - Teardown on unmount, sign-out or token unbind, and background (mobile `AppState`).

**Preflight items the story must record** (owner or coordinator with Vercel access):

- **Fluid Compute.** Confirm it is enabled on the `couture-cast-api` project, then redeploy.
- **Plan tier.** Record it. This only matters if anyone later raises `maxDuration` above 300.
- **Preview Deployment Protection.** Prove a WebSocket handshake through protection in E2E. The
  Socket.IO handshake can carry `x-vercel-protection-bypass` and `x-vercel-set-bypass-cookie` as
  query parameters, because browsers cannot set custom headers on a WebSocket. Prove this on a
  real preview before claiming E2E coverage.
- **Usage guardrail.** Use a spend or usage alert in the existing Vercel project. Do not add a
  new service.

**Verification additions**

- A preview-deployment Playwright journey that asserts a live doorbell over `wss://` from a second
  user's action.
- A forced reconnect at a short test `maxDuration`, or a server-initiated disconnect, proving
  catch-up continuity.
- A socket-blocked run proving polling recovery.
- The mobile Maestro flow against the same deployed or preview API.

### R2. Stream ordering: horizon withdrawn, counter row through commit confirmed

**Counterexample to my F5 horizon**

Identity values and xids are allocated independently:

1. Transaction A takes xid 99 early (for example, from its reaction upsert).
2. Transaction B takes xid 100.
3. B inserts its stream row first and receives `stream_id` 10.
4. A inserts later, receives `stream_id` 11, and commits. B is still open.
5. A reader's snapshot has `xmin = 100`. Row 11 (`txid 99 < 100`) is returned, and row 10 is
   invisible.
6. The cursor advances to 11, so row 10 is skipped forever.

Stopping at visible rows whose `txid >= xmin` cannot see the invisible lower id, so the gap is
real. The horizon is withdrawn.

**Confirmed protocol (Astra's choice): one counter row, locked through commit**

- `CommunityStreamHead(id smallint PK CHECK (id = 1), last_seq bigint NOT NULL)`.
- Each producer transaction allocates with
  `UPDATE "CommunityStreamHead" SET last_seq = last_seq + 1 WHERE id = 1 RETURNING last_seq`.

**Proof sketch** (PostgreSQL primary, any isolation level for the reader):

1. _Ordered allocation._ The row lock is held until the transaction ends. Under Read Committed, a
   blocked allocator re-reads the committed row through EvalPlanQual after the holder finishes.
   So `seq` n+1 is allocated only after the holder of n has committed or rolled back.
2. _Visibility before release._ PostgreSQL makes a commit visible (ProcArray end-of-transaction)
   before it releases heavyweight locks. Any transaction that obtains seq n+1 therefore starts
   after n is already visible to every new snapshot.
3. _No phantom gaps._ A rollback also rolls back the counter update, so the next allocator reuses
   the value. Committed sequences are contiguous.
4. _Reader._ `WHERE seq > :cursor ORDER BY seq LIMIT :n` on the primary. Suppose a snapshot sees
   seq k. By (1) and (2), every seq below k committed before k's transaction allocated, and so
   before this snapshot. All lower seqs are therefore visible, and advancing the cursor to the
   largest returned seq never skips.

**Required constraints so the proof holds in this codebase**

- **Allocate at the commit tail.** Producer triggers insert stream rows with `seq NULL`. A
  `CONSTRAINT TRIGGER ... AFTER INSERT ... DEFERRABLE INITIALLY DEFERRED` on the stream table
  allocates and stamps `seq` at COMMIT. The hot lock is then held only for commit, and it is
  always the last lock taken. That ordering removes deadlock cycles with the existing
  member-advisory-then-post-row lock order.
  - Ban `SET CONSTRAINTS ... IMMEDIATE` on community transactions. A test should prove that seq
    allocation happens after the last post lock.
  - If the implementation instead allocates explicitly, it must be the final statement before
    commit in every producer path, including guardian revocation, erasure, moderation actions
    and the worker. The trigger form is preferred because it cannot be forgotten.
- **No I/O after allocation.** No network or provider calls, and no `pg_sleep`, between
  allocation and commit.
- **Reads go to the primary only.** A replica breaks (2).
- **Rows readers see.**
  - Readers select `seq IS NOT NULL`. Uncommitted rows are invisible anyway, and the constraint
    makes it explicit.
  - `seq` is `UNIQUE`.
  - Per-user author-private rows share the same sequence and are filtered by `recipient_user_id`
    at read time. A user's own stream may contain gaps, which is fine because the cursor is
    global.
- **Retention and resync.**
  - Retention deletes rows with `seq <= retained_floor`.
  - A cursor below `retained_floor` answers `resync_required`.
  - The opaque cursor encodes a stream epoch, stored on the head row and rotated on restore, so
    a restored database forces a resync.
- **Throughput budget.** All community commits serialize for their commit tail, roughly one
  fsync each. Record the measured ceiling from an integration test with N concurrent producers.
  Beta scale is far below it; if it is exceeded, the documented fallback is the serialized
  appender below.
- **Required tests** (real Postgres):
  - two producers interleaving with forced commit order (B waits on A), with the reader never
    skipping and seq order matching commit order
  - a rollback that leaves no gap
  - a reader concurrent with 50 producers proving contiguous `seq` and no skips over 10k events
  - a deadlock-freedom test across reaction, comment publication, takedown and erasure running
    concurrently

**Acceptable alternative (not preferred): serialized committed-outbox appender.** Producers
insert unsequenced rows (any id). A single appender, holding the head row lock in its own
transaction, stamps `seq` on all currently visible unsequenced rows in id order and commits.
Readers only see stamped rows, so gaps cannot occur. The cost is appender-cadence latency (the
1 s worker sweep) and a hard dependency on the always-on worker for realtime freshness. Prefer the
commit-tail counter.

### Rereview status

- R1 and R2 replace F1's options and F5's protocol.
- F2 through F4 and F6 through F13 stand unchanged, pending the amended story and design.
- Verdict remains **CHANGES_REQUIRED** until Astra's amended files land and pass independent
  rereview.

### R3. Note on Astra's appender choice (2026-10-20)

Astra chose the serialized committed-outbox appender, with the counter row locked through the
append commit. Domain transactions never touch the stream head. The choice is sound, and it makes
snapshot handoff simple: a snapshot returns the head seq read in the same statement. Anything
committed but not yet appended later receives a higher seq and is applied idempotently.

The amended design must encode three points:

1. **Per-post ordering.** Append order does not guarantee per-post order, because outbox ids are
   allocated before commit. Clients apply events only through per-post versions allocated under
   the existing post `FOR UPDATE` lock. Every producer inserts its outbox row after taking that
   lock.
2. **Freshness without the worker.** Freshness must not depend only on the single worker, whose
   crash recovery takes about 423 s. Any process may run the append step under the head lock
   with NOWAIT or SKIP LOCKED: the worker sweep, a realtime instance's head poll, or the catch-up
   endpoint. The append is idempotent by construction.
3. **Budgets and metrics.** State the append batch bound and its latency budget inside the
   60-second and realtime targets. Expose an oldest-unappended-age metric.

## Rereview 1: amended spec and design (2026-10-20)

**Inputs reviewed**

- `spec-6-5-realtime-engagement-notifications.md` (`review_loop_iteration: 1`, status draft).
- `6-5-realtime-engagement-design.md` (D1 to D10 and the disposition table).

**Verdict: CHANGES_REQUIRED.** Ten concrete items remain: three high, five medium, two low.
Everything else is resolved.

### Disposition check of original findings

| Finding      | Status in amended design                                                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 / R1      | Resolved by D1: dedicated `api/realtime.ts`, 300 s, exact path, websocket-only clients, preflight record. See RR-3 and RR-9 for residual items.                                                                                                           |
| F2           | Resolved by D5: token endpoints, permission, rotation through a fresh Expo token, response and cold-start listeners, honest offline-unbind limits. See RR-4 and RR-5 for prerequisites.                                                                   |
| F3           | Resolved by D4: a separate resource and table, strict legacy schemas untouched, guarded PATCH.                                                                                                                                                            |
| F4           | Resolved by D3: `EventEnvelope`, `/events/poll` and `lookbook:new` unchanged.                                                                                                                                                                             |
| F5 / R2 / R3 | Resolved by D2. The appender argument is correct: head row lock through append commit, atomic counter, `UNIQUE(source_outbox_id)`. Per-post revisions handle source/append skew, and assistance, bounds and metrics are present. See RR-2 for one defect. |
| F6           | Resolved by D3: closed kind table including removals, with anonymous resync for unavailable sources.                                                                                                                                                      |
| F7           | Resolved by D1 and D3: doorbell carries no sequence or identity, separate private heads, revalidation, JWT-expiry disconnect. See RR-3 for cost.                                                                                                          |
| F8           | Resolved by D7: single request per token, durable `sending` before the call, ambiguous means `unknown`, receipts, generation-scoped pruning. See RR-1 for the lock-scope defect.                                                                          |
| F9           | Resolved by D6: deferral, DST-correct evaluator, 24 h expiry, 30 s grouping inside 60 s, generic copy, locale from `UserProfile.preferences`. See RR-7.                                                                                                   |
| F10          | Resolved by D9.                                                                                                                                                                                                                                           |
| F11          | Resolved by D5: `commentId` and `parentId`, plus a paginated target resolver.                                                                                                                                                                             |
| F12          | Resolved by D8: subject links and generations, explicit cleanup, retention.                                                                                                                                                                               |
| F13          | Resolved by D10: falsifiable lanes with IDs. See RR-4 and RR-8 for feasibility prerequisites.                                                                                                                                                             |

### Bootstrap and cursor handoff (D3): verified correct

Bootstrap captures heads H first, then reads the authoritative views on the primary, then
replays only events strictly after H. There are three cases, and none loses data:

- **Appended at or before H.** The append committed before H was read, so the later view read
  includes it.
- **Committed but not appended at H.** It is appended after H and replayed. The resulting
  refresh is harmless.
- **Committed after the view read.** It is appended after H and replayed.

Community responses are `private, no-store` (`community-cache-headers.middleware.ts`) and no
read cache sits in front of the feed, so "authoritative" holds.

The other mechanics are also correct:

- One Repeatable Read capture of heads and rows, with an upper bound at the captured heads.
- Advancing by scanned position, including fully filtered pages.
- Typed 400, 409 and 503 errors.

### Remaining changes

**RR-1. High: D7's send guard couples user-facing writes to provider latency.**

D7 holds the "established" member advisory locks and the post lock through a provider call of up
to two seconds, inside a three-second transaction. Existing engagement writes take those same
keys exclusively:

- `community.repository.ts:199-200` takes `pg_advisory_xact_lock('community_member:'||actor)`
  and then the post `FOR UPDATE`.
- The comment processor and repository do the same.

As a result, a reaction on a post with an in-flight push waits for the provider. So does any
reaction or comment by the push's recipient, actor or parent author. Even `FOR KEY SHARE` on the
post conflicts with the existing `FOR UPDATE`.

Amendment: serialize send start against privacy changes only, through dedicated advisory
namespaces:

- `community_privacy:<memberId>`: shared by the sender, exclusive only for erasure, consent
  revocation, opt-out, preference policy writes and token transfer.
- `community_post_privacy:<postId>`: shared by the sender, exclusive only for takedown, withdraw,
  consent suspension and erasure. Takedown and erasure take it in addition to their existing
  locks.

Define one global acquisition order: existing member lock, then privacy member locks ascending,
then posts ascending, then post-privacy locks ascending, then registration and attempt rows.
Ordinary reaction and comment writes never take the privacy namespaces. Add a test asserting
that a reaction on a post with an in-flight send completes inside its normal latency.

**RR-2. High: D2 step 2 lets one busy member stall the whole append batch.**

Step 2 rolls back the entire batch of up to 100 rows if any referenced member's shared lock is
busy. Every reaction and comment holds its actor's member lock exclusively, so with active
members, batches abort repeatedly and the oldest-first priority keeps re-claiming the same
blocked row. That is head-of-line starvation, which the metric would only detect, not prevent.

Amendment: try subject locks per row. Exclude rows with a busy subject from this batch, releasing
their `FOR UPDATE SKIP LOCKED` claim by not stamping them, and append the remainder. Stream order
is append order and clients apply through per-post revisions, so skipping a row is safe. Bound
the age of a skipped row with the existing oldest-unappended gate.

Alternatively, have the appender take the RR-1 privacy namespace instead of the engagement
member key. Erasure would take both, so ordinary writes never make the appender busy. This is
the simpler fix and aligns with RR-1.

**RR-3. High: authorization revalidation can exceed the PostHog free tier.**

`FeatureFlagsService.getFeatureFlag` calls `PostHogService.getFeatureFlagValue`, which issues a
remote `client.getFeatureFlag` per evaluation. `new PostHog(apiKey, { host })` has no personal
API key, so there is no local evaluation.

D1 revalidates every authorized socket at least every 10 s and again before each doorbell. D3
re-checks the read rollout on every catch-up, with active clients at least every 15 s.

- At the D10 envelope of 100 sockets per instance, socket revalidation alone is about 864,000
  remote flag requests per day, or roughly 26 million per month.
- PostHog's free tier is 1 million flag requests per month, with metered billing beyond it
  ([PostHog flag pricing](https://posthog.com/feature-flags/pricing),
  [cutting flag costs](https://posthog.com/docs/feature-flags/cutting-costs.md)).

That violates "add no paid subscription" through usage.

Amendment: evaluate `community_read_enabled` for realtime and catch-up from a bounded per-member
cache.

- A TTL of 60 s is suggested. Use the existing DB fallback record or a short in-process memo per
  instance.
- Re-check consent, age and account state directly from Postgres, which costs nothing per query.
- State the resulting read-flag-loss bound, for example at most 60 s plus 10 s, in the AC.
- Add a usage budget line (flag requests per active member per hour) to `6.5-PERF-003`.

**RR-4. Medium: native push prerequisites are unnamed, and one may carry cost.**

What the repository has and lacks:

- `apps/mobile/app.json` has an EAS `projectId` and a dev client.
- It does **not** list the `expo-notifications` config plugin.
- There is no `google-services.json` or FCM configuration.

Provider-to-device proof therefore needs:

- an FCM V1 service-account credential uploaded to EAS, plus `google-services.json` (free)
- the `expo-notifications` plugin, with Android channel and icon
- an APNs key, which requires an active Apple Developer Program membership

Amendment:

- Add a D10 preflight table listing each credential, who supplies it and its cost status.
- State that the lane stays pending (D10 already says this) and that no new paid membership is
  purchased under this story unless the owner already holds one.
- Name the deterministic lanes as primary CI evidence:
  - iOS: `xcrun simctl push` with the production payload shape.
  - Android: a locally scheduled notification with the identical `data` shape.
  - Both use a Maestro tap on the OS notification.
- Name local `expo run:ios` and `expo run:android` builds, or the EAS free build quota, as the
  build route.

**RR-5. Medium: D5's email OTP depends on Supabase email delivery.**

Supabase's built-in sender is a low-volume relay, documented by multiple sources at about 2 to 3
auth emails per hour. Custom SMTP needs a third-party provider, which would be a new service
account ([Supabase custom SMTP guide](https://sendlayer.com/supabase-custom-smtp-and-email-configuration-guide/),
[Supabase rate-limit notes](https://www.rapidevelopers.com/md/supabase-tutorial/how-to-fix-rate-limit-issues-in-supabase)).
Neither the E2E lanes nor parallel Maestro shards can depend on inbox delivery.

Amendment:

- Specify that nonprod automated sign-in uses the Supabase Admin API (`generateLink`, or an OTP
  generated with the service role in the isolated environment), then `verifyOtp` in the client.
  This exercises the real session, persistence and refresh path without email.
- Keep the service role out of client bundles.
- Record the human email path as limited by the built-in relay until rollout. Choosing an SMTP
  provider is an owner decision outside this story. Production rollout is frozen, so this does
  not block completion.

**RR-6. Medium: revisions and the revalidation endpoint lack a contract decision.**

D3 and D9 require clients to compare authoritative per-post revisions and to "revalidate
currently rendered targets in a bounded batch", but no response carries `community_revision`
today, and no batch endpoint is named. The existing response schemas are `.strict()`, and
deployed web code parses them strictly: `packages/api-client/src/client.ts:92-133` uses
`communityCommentsResponseSchema.parse`, and `communityFeedItemSchema` is strict. Adding a field
breaks already-open web tabs until reload, and it conflicts with the `/api/v1` rule.

Amendment: add one canonical endpoint, for example
`POST /api/v1/community/targets/resolve { postIds ≤ 50, commentIds ≤ 50 }`.

- It returns, per target: `available`, `communityRevision`, the public reaction summary and its
  thread position.
- Unavailable targets are anonymous.
- It serves D3 revalidation, D5 deep-link resolution and D9 refreshes.

Leave existing feed, post and comment schemas unchanged, or add the field only after an explicit
compatibility note covering open web sessions. Add the endpoint to `6.5-CONTRACT-*`.

**RR-7. Medium: the quiet-hours exit herd is outside the push envelope.**

Account quiet hours default to `22:00` to `07:00`. A beta cohort concentrated in one or two
timezones releases its deferred groups at the same minute. With one request per token, four send
slots and a 2 s response bound, throughput is about 2 to 4 tokens per second. The declared
40-attempt backlog does not cover a herd of, for example, 150 tokens, so the "60 s from allowed
quiet-hour exit" AC fails by construction.

Amendment, in D10:

- Size the envelope for the expected exit herd: the number of opted-in recipients in the largest
  timezone times 1.5 tokens.
- Either raise the send slots within the measured worker and DB budget, or define a documented
  release spread that stays inside 60 s.
- Add a `6.5-PERF` case for the herd.

**RR-8. Medium: the hosted worker for `6.5-OPS` is unnamed.**

`6.5-OPS-001..003` requires an "isolated Vercel preview and deployed worker". The 6.2b worker on
Northflank is the production community worker. Preview tests must not target it, per the project
rule on environment separation.

Amendment: name the nonprod worker. Either confirm a no-cost Northflank nonprod service on the
existing account, or run the worker process locally against the isolated preview database for
the OPS lane. Then prove `worker-down assisted append` by stopping that owned process.

**RR-9. Low: the origin allow-list must accept native clients.**

React Native WebSocket handshakes may omit `Origin` or send one outside the web allow-list. D1
applies "origin allow-lists" before joining. Amendment: allow an absent `Origin` only together
with a valid bearer JWT; never accept cookie-only authentication. Keep the browser allow-list
strict, and test both.

**RR-10. Low: catch-up append assistance should be conditional.**

Running a 500 ms append transaction inside every catch-up request adds write load and tail
latency to read traffic. Amendment: catch-up assists only when the oldest unappended age exceeds
2 s, or when no assist has run for that stream within 1 s, recorded in a head column.

### Sign-off condition

Opus signs READY when RR-1 through RR-8 are reflected in the design, either as amendments or as
explicit owner decisions with rationale. RR-9 and RR-10 may be folded into implementation notes.

Sources:

- [Vercel WebSockets](https://vercel.com/docs/functions/websockets)
- [PostHog feature flag pricing](https://posthog.com/feature-flags/pricing)
- [PostHog cutting flag costs](https://posthog.com/docs/feature-flags/cutting-costs.md)
- [Supabase custom SMTP guide](https://sendlayer.com/supabase-custom-smtp-and-email-configuration-guide/)
- [Supabase rate-limit notes](https://www.rapidevelopers.com/md/supabase-tutorial/how-to-fix-rate-limit-issues-in-supabase)

### Rereview 1 supplement: D7 connection loss and the `FOR SHARE` refinement

**RR-1 still applies with `FOR SHARE`.** `FOR SHARE` on the post conflicts with the `FOR UPDATE`
taken by every reaction and comment write (`community.repository.ts:200`,
`community-comments.processor.ts:54`). Shared member advisory locks on the established
`community_member:` key also conflict with the exclusive lock every engagement write takes. The
send guard still blocks ordinary engagement on the target post, and by the involved members, for
up to the guard limit. `FOR SHARE` on registration rows is fine. The fix remains RR-1's dedicated
privacy namespaces.

**RR-11. High: the D7 guard needs server-side enforcement, and the limitation needs exact
wording.**

_Lock lifetime._ Prisma's interactive-transaction `timeout` is enforced by the client. While the
worker awaits Expo, its database session sits idle in transaction. If the worker freezes (a GC
stall, SIGSTOP or host suspend) or loses its network path without a TCP reset, PostgreSQL keeps
the guard locks until it notices the dead peer. With default keepalives that can take hours.
Erasure, consent revocation and opt-out then block on those locks.

Amendment:

- Each guard transaction begins with
  `SET LOCAL idle_in_transaction_session_timeout = '<guard limit>'`. Also set
  `SET LOCAL lock_timeout` and `SET LOCAL statement_timeout` for its own waits.
- PostgreSQL then terminates the session and releases the locks once the worker stops
  communicating for the guard limit, whatever the client's state. If the database runs
  PostgreSQL 17 or later, `transaction_timeout` can bound the whole transaction as well.
- Record the measured Supabase server version and the pooler mode. An interactive transaction
  needs session pinning, which transaction-mode Supavisor provides only for the duration of the
  transaction.

_Connection-loss outcomes._ Follow the sequence:

1. The worker commits `sending`.
2. It opens the guard, verifies eligibility and checks liveness and the absolute deadline.
3. It initiates exactly one HTTP request.

Between that last check and the transport write there is an unavoidable window. Once bytes leave
the process, PostgreSQL may abort the guard for any reason: a timeout, a connection reset, or a
pooler or failover event. That releases the privacy locks, and erasure or revocation can commit
while the request is still in flight.

None of these failures corrupts state, provided all outcome writes stay conditional, as D7
already requires:

- Expo accepts, the outcome write fails, and recovery finds `sending`: the attempt becomes
  `unknown`, the ticket ID is lost, and receipt-based pruning is skipped for that attempt.
- A late response arrives after erasure deleted the attempt: it is dropped and never upserted.
- The connection drops during COMMIT of the outcome: recovery reads whichever state committed.

Required wording, replacing any atomicity claim:

> The guard serializes healthy send initiation against privacy mutations. It does not make the
> provider handoff atomic with database state. A send whose authorization check passed before
> a privacy mutation committed can reach the provider up to `T_send` (the absolute transport
> deadline, 2 s) after that commit. The provider may queue it and deliver it to the device
> later. Such a delivery carries only generic copy and opaque IDs. Opening it requires a fresh
> authorized resolution, which fails closed for erased or hidden targets. This window is the
> documented residual risk. It is measured by `6.5-INT-019..024` under injected connection
> loss, and erasure completion is reported only after the window has elapsed.

_Erasure interaction._ Erasure and consent transactions must either wait at least the guard
limit for privacy locks or retry on `lock_timeout` without failing the erasure. Otherwise a
guard in flight turns into a failed erasure. Add a test: erasure racing an in-flight guard
completes within the guard limit plus its own budget.

_Lease and guard._ A 10 s lease against a 3 s guard is consistent. Recovery must leave an
attempt alone until both the lease has expired and the server-side guard bound has elapsed, so a
second worker cannot treat a still-open guard as dead.

### Rereview 1 corrections accepted from Astra (2026-10-20)

- **RR-3 arithmetic.** Astra is right. A 60 s TTL for 100 continuously active members is about
  4.32 million requests per month, so it does not stay inside the free tier. Revised
  recommendation, using existing infrastructure only:
  - **Global freeze.** Read it from the existing DB fallback record (`FeatureFlagsRepository`),
    refreshed by the worker's `syncFlags` at a fixed cadence, such as 5 minutes. This costs one
    remote request per flag per sync.
  - **Revalidation cost.** Every socket and catch-up revalidation reads the global freeze and the
    consent, age and account state from Postgres at no per-request cost.
  - **Per-member targeting.** Evaluate it remotely at handshake and resync, then cache it per
    member for 15 minutes. At 100 continuously active members that is about 288,000 requests per
    month.
  - **AC wording.** A global read freeze takes effect within the sync cadence plus 10 s. A
    per-member targeting change takes effect within 15 minutes.
  - **Local evaluation.** It is acceptable only with an explicit poll interval and a measured
    instance count. PostHog bills each definition fetch at 10 credits, and serverless instance
    count is not fixed.
  - **Budget proof.** Add the flag-request budget to `6.5-PERF-003`, sized against the measured
    instance and member counts.
- **RR-5 source.** The official Supabase SMTP documentation (team addresses only, 2 per hour)
  supersedes my secondary sources. Automated `generateLink`/`verifyOtp` plus a recorded
  human-rollout prerequisite resolves RR-5.
- **RR-11 wording.** Astra is right, and my "up to `T_send` after commit" bound was wrong. A
  process suspended between its final deadline check and the socket write, plus network transit,
  can exceed any local deadline. The corrected wording is acceptable:
  - Bound local initiation as observed by the worker.
  - Acknowledge erasure only after the guard window.
  - State that external arrival and display of a previously authorized send are unbounded.
  - Require a generic payload and an authorized open.
  - Test the observed connection-loss cases.

Pending items for READY: the amended D2, D3, D5, D7 and D10 text reflecting RR-1 through RR-11.

### Coordinator scope clarification applied (2026-10-20)

Existing metered infrastructure is authorized in normal scope; only a new paid subscription is
excluded. RR-3 is therefore reclassified. It is a requirement for measured, bounded and alerted
usage (flag requests, Vercel active CPU and memory, database query rate, Expo sends), and no
longer a free-tier ceiling. The free tier serves only as a reference point. The same applies to
RR-4: an Apple Developer membership the owner already holds is existing infrastructure, while a
new purchase is out of scope.

Lock-order requirement for rereview 2: one global acquisition order must hold across domain
writes, the appender, the send guard, erasure and consent, preferences and token transfer. A
path may skip levels, but it never acquires a lower level after a higher one.

### RR-3 resolution check: Astra's shared 60 s cache (2026-10-20)

Accepted. Astra's correction is right, and my earlier global-freeze suggestion was flawed.
`syncFlags` evaluates every flag for `FEATURE_FLAG_SYNC_DISTINCT_ID`
(`feature-flags.service.ts:80-84`), so for a cohort-targeted flag the fallback record says
nothing about real members.

The approach Astra has committed to:

- a shared per-member 60 s cache with single-flight refresh
- consent and age checked against the database every 10 s
- expired cache results fail closed
- read-flag or cohort loss takes effect within 70 s or less
- `PERF-003` bounds the request rate and records spend against the owner's existing budget

**Three conditions for READY, from source evidence:**

1. **Never cache the outage fallback.** `packages/config/src/flags.ts:249-278`
   (`getFeatureFlag`) returns the synthetic-ID fallback record whenever the remote read throws or
   returns `undefined`.
   - For a cohort-targeted `community_read_enabled`, that value is wrong per member in both
     directions. If the synthetic ID is in the cohort, it fails open for every member during a
     PostHog outage.
   - The shared cache must store only coerced remote results, which the resolver must report as
     "remote" or "fallback".
   - On a remote failure, keep the last remote value until it expires, then fail closed.
   - Never write the fallback value into the per-member cache.
   - Add a test covering a PostHog outage with the synthetic ID in the cohort and a non-cohort
     member. The member's access must end within 70 s or less.
2. **Name the shared store.** API instances, realtime instances and the Northflank worker share
   no memory, so the store must be explicit. The recommendation is an API-only Postgres table
   keyed by member and flag, refreshed single-flight through a row lock or `SKIP LOCKED`. State
   it.
3. **Erase the cache rows.** Those rows are member-identifying, so add them to D8's subject
   links and erasure cleanup.

## Rereview 2: amended spec and design, iteration 2 (2026-10-20)

**Inputs, hash-verified locally:**

- spec `01e25534a8a0392ef1c9a5a7c4aa1451e2ef485ee48e848042c245168fd1e4d6`
- design `c0c297ca965098e53d858f1152008cbce5485e93a6570043c2c0ae02acc40627`

Amendment editor: cc65-doc-editor (wKS:p3). This judgment is independent of the fresh Astra
review in wKS:p4.

**Verdict: CHANGES_REQUIRED.** There is one blocker (RR2-1), and its fix is small. Four further
items can be folded in as implementation notes and are not blocking. Every RR-1 to RR-11
disposition is otherwise verified against the actual text and source.

### RR-1 to RR-11 verification

| Item  | Result                 | Evidence                                                                                                                                                                                                                                                                                                 |
| ----- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RR-1  | Resolved               | See below.                                                                                                                                                                                                                                                                                               |
| RR-2  | Resolved               | Per-candidate savepoints with try-locks; busy rows are skipped; appender uses privacy keys only; starvation test named (D2 steps 1-2, INT-001..006).                                                                                                                                                     |
| RR-3  | Resolved, except RR2-1 | Postgres `CommunityFlagEvaluation`, remote-only provenance, synthetic fallback never cached, generation-checked refresh, erasure in D8, PERF-003 call bound and spend.                                                                                                                                   |
| RR-4  | Resolved               | Preflight table lists the plugin, FCM, APNs and existing membership, local builds, `simctl push` and Android local notification with a Maestro OS tap, plus mandatory provider-to-device proof.                                                                                                          |
| RR-5  | Resolved               | Admin `generateLink` plus real `verifyOtp` harness; official SMTP restriction recorded.                                                                                                                                                                                                                  |
| RR-6  | Resolved               | Strict new `targets/resolve` envelope with correlation keys, atomic revision and state, anonymous unavailable results; legacy schemas byte-compatible; CONTRACT-004..005.                                                                                                                                |
| RR-7  | Resolved               | Exit groups immediately due; `max(500, H)` from the measured largest cohort; 32 slots with `ceil(600/32)*3 = 57 s` as a lower-bound target and measured acceptance; no clock rewriting.                                                                                                                  |
| RR-8  | Resolved               | Owned local worker against the isolated preview database and Redis; production worker excluded.                                                                                                                                                                                                          |
| RR-9  | Resolved               | Absent Origin is accepted only with a verified bearer token; three origin cases tested.                                                                                                                                                                                                                  |
| RR-10 | Resolved               | Conditional catch-up assist through a `last_assist_at` claim.                                                                                                                                                                                                                                            |
| RR-11 | Resolved               | Server-side `idle_in_transaction_session_timeout`, `lock_timeout`, `statement_timeout` and PostgreSQL 17 `transaction_timeout` with a fail-closed effectiveness check; 10 s lease plus guard window before orphan recovery; erasure waits or keeps a durable request; honest unbounded external arrival. |

**RR-1 detail.** The privacy namespaces are separate from engagement locks and use the
two-integer advisory keyspace. PostgreSQL keeps that keyspace disjoint from the one-bigint
`hashtext` keys that existing code uses. The send guard takes no engagement-member or post-row
lock, and an INT test runs with a stalled provider.

**Global lock order.** D7 lines 448-458 give a single order: privacy-member, then privacy-post,
then `community_member:`, then post rows, then owned rows, then stream heads. Checked against
source:

- **Engagement writes** take only `community_member:` and then the post `FOR UPDATE`
  (`community.repository.ts:199-200`, `community-comments.processor.ts:53-54`). They skip the
  privacy levels and never wait on them, so they cannot form a cycle with senders.
- **Guardian revocation** (`guardian.service.ts:737`) and **acceptance** (`:540`) take
  `community_member:` as their first statement. Adding the exclusive privacy guard before it
  matches the order, and D7 already requires enumerating these entry points outside the
  community module.
- **Appender.** All of its multi-candidate privacy acquisitions are non-waiting, and it takes
  stream heads last with `NOWAIT`, so it cannot be part of a wait cycle.
- **Sender.** It waits only on privacy keys, then registration rows `FOR SHARE`, then the attempt
  row `FOR UPDATE`, in ascending order. Every exclusive privacy writer acquires the same levels
  in the same order, so no cycle is possible.
- **Database version.** `supabase/config.toml:34` pins `major_version = 17` locally, so PostgreSQL
  17 is feasible in the isolated environment. The production version remains a recorded
  preflight, and the design correctly calls an upgrade an explicit preflight failure.

### Blocker

**RR2-1. High: the shared flag cache denies healthy requests at every expiry boundary.**

D1 lines 59-61 and 69-70 say that refresh happens at expiry, that "losers use an unexpired
remote value or fail closed", and that after expiry access is denied. D3 line 232 says "a
denial or expired, unverified eligibility clears the view immediately".

In healthy operation, several requests from one member meet at the 60 s expiry: socket
revalidation every 10 s, catch-up every 8 s or less, the targets/resolve batch, and the
concurrent bootstrap of feed, events and socket on first load. Only one of them wins the
two-second claim. Every loser finds no unexpired value and is denied, so the client clears the
community view. An eligible member's view therefore flaps on a 60 s cycle and on every cold
first load. That violates the convergence AC and the "accessible focus without disrupting
active composition" boundary, with PostHog fully healthy.

Required amendment, in D1 and D3:

1. **Refresh ahead.** Claim a refresh once a valid value passes about 45 s of age, while it is
   still valid. Validity still runs 60 s from the remote request's start, so the 70 s loss
   bound is unchanged.
2. **Losers wait or report unavailable.** A loser that finds no valid value while a claim is in
   flight waits for that claim's result within the two-second lease. If it still has no result,
   it returns typed 503 `unavailable` (REST) or holds the doorbell (socket). That is never a
   denial.
3. **Separate unverifiable from denied.** A remote outage past expiry, or a cold claim
   timeout, yields `unavailable`. The client hides content (fail closed for content), marks the
   view stale, suppresses mutations, keeps drafts and retries with backoff. Only an affirmative
   remote `false`, a consent, age or account failure, or authentication loss is a denial that
   clears the view and drafts as D3 and D9 specify.
4. **Test it.** INT-007..011 adds concurrent same-member requests across two instances at the
   expiry boundary and on a cold cache. None of them may be denied while PostHog is healthy.

### Non-blocking implementation notes (fold in or carry to implementation)

- **N1. Connection budget feasibility.** Thirty-two guard transactions stay idle in
  transaction for up to 2 s each, and each pins a server connection. Supabase's transaction-mode
  pooler pins per transaction, and its default server pool size on small compute tiers can be
  below 32. Record the pool size and the direct-connection limit in preflight. If the worker
  needs more connections than the existing compute provides, the choices are to lower the
  slots (re-sizing the herd target) or to make an owner plan decision. A compute upgrade is a
  plan change and must not be made silently.
- **N2. D3 catch-up cadence wording.** State that the catch-up loop of 8 s or less runs only in
  fallback mode (socket unavailable). In the healthy socket lane, server revalidation every 10 s
  enforces the 70 s bound. Otherwise "socket proof with periodic polling disabled"
  (E2E-001..005) contradicts D3, and every healthy client generates a REST invocation every
  8 s.
- **N3. Complete the existing engagement-key level.** Existing code also takes
  `community_report:` (`community-comments.repository.ts:446`, `community.repository.ts:643`)
  and `community_submission:` (`community.repository.ts:537`) advisory keys. List them at the
  `community_member:` level in D7's order (member, then report or submission, then posts), so
  the order is complete and verifiable.
- **N4. Savepoint lock release assertion.** D2 relies on `ROLLBACK TO SAVEPOINT` releasing a
  skipped candidate's transaction-level advisory locks and row claims. Assert this directly in
  INT-001..006 through `pg_locks` for the backend PID, so the claim is proven rather than
  assumed.

### Sign-off condition

Opus signs **READY** once RR2-1 is amended in D1 and D3 with its test, and N2 is clarified.
N2 is a direct contradiction with an acceptance lane. N1, N3 and N4 may stay as implementation
notes.

Sources consulted in this pass:

- [PostgreSQL 17 client connection defaults (timeouts)](https://www.postgresql.org/docs/17/runtime-config-client.html)
- [PostgreSQL 17 transaction_timeout behavior (dbi services)](https://www.dbi-services.com/blog/postgresql-17-transaction_timeout/)
- [PostgreSQL 17 release notes](https://www.postgresql.org/docs/release/17/)

## Rereview 3: final story verdict, iteration 3 (2026-10-20)

**Bound to these exact hashes, verified locally:**

- spec `f6631b1ba026bec9eecaad516f0b3aeeba46883d51a36131cc5713e563c2efb2`
- design `91dc57ccbdcee454f879c87d08d8e1bdf3e4f883286f700cd31de7cc3cc36fdb`

Method: a line diff against saved iteration 2 copies (spec `01e25534…`, design `c0c297ca…`). The
diff contains only the announced amendment batch. Existing invariants and review history are
intact.

**Verdict: READY.** It covers the story and design for implementation. No acceptance evidence
exists yet, and every D10 measurement and lane remains an execution requirement.

### Sign-off conditions

| Condition                                        | Result | Evidence in iteration 3                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RR2-1, part 1: refresh ahead                     | Met    | Refresh at 45 s with hard expiry at 60 s, both anchored to the database claim origin (D1).                                                                                                                                                                                                        |
| RR2-1, part 2: losers wait or report unavailable | Met    | Same-member waiters stay inside the claim lease and the caller's absolute 2 s budget. A missing result returns typed 503, never 403. The socket path uses a strict `community:availability` control message (D1).                                                                                 |
| RR2-1, part 3: unavailable separated from denied | Met    | `unavailable` hides content, marks it stale, suppresses mutations and keeps permitted drafts, focus and cursor. Only an affirmative remote false, an age, consent or account failure, or authentication loss clears state (D3). Expiry is rechecked at serialization, doorbell emission and send. |
| RR2-1, part 4: test                              | Met    | INT-007..011 synchronizes cross-instance requests at cold start, age 45 and age 60, and holds a result past the lease.                                                                                                                                                                            |
| N2                                               | Met    | Periodic catch-up applies only in fallback; the healthy socket lane has no periodic REST or target polling; the socket-success test disables it (D3).                                                                                                                                             |
| N1                                               | Met    | The aggregate pool and compute budget includes deployment overlap. Insufficient capacity is a failed gate, with no silent plan change (D10).                                                                                                                                                      |
| N3                                               | Met    | `community_report:` and `community_submission:` are added at the engagement level of the global order (D7).                                                                                                                                                                                       |
| N4                                               | Met    | `pg_locks` advisory checks by backend PID, plus an independent `FOR UPDATE NOWAIT` claim of the skipped row. It correctly notes that row locks do not appear in `pg_locks` (D2).                                                                                                                  |

### Source checks on newly added claims

- `.github/workflows/pr-checks.yml:41` declares `postgres:16-alpine`, while
  `supabase/config.toml:34` pins 17. The CI alignment requirement and the runtime
  `server_version_num` assertion are correct and necessary.
- `GET /api/v1/user/profile` exists (`user.controller.ts:20`, `contracts/http/user.ts:81`).
  `access-token-identity.service.ts` maps `sub` to the app user either through server-owned
  `app_metadata` (`:140`) or through verified-email database resolution (`:283-297`). The
  profile-resolved identity requirement and the `sub != User.id` probe are therefore grounded.
- The weather token chain named in D7 exists:
  - `alert-fanout.repository.ts:63`
  - `alert-fanout.processor.ts:235`
  - `push-notification.service.ts` `deleteTokens`
  - both compositions, `notifications.module.ts` and `workers/bootstrap.ts:134`

  Raw-token pruning in the shared path can delete a transferred binding, so generation and owner
  conditional cleanup is a valid correctness fix. It is not speculative expansion.

### Non-blocking observation for implementation (no design change requested)

- **Recovery after a failed refresh.** "One claim per member/flag per 45 s, including failed
  refreshes" means that a single failed refresh at age 45 leaves the member `unavailable` from
  age 60 until the next claim at age 90. That is up to 30 s, even if PostHog recovers
  immediately.
  - This is fail-closed. Drafts are kept and there is no denial, so it is acceptable as designed.
  - The PERF and INT evidence should report observed unavailable durations after injected
    single failures, so the trade-off is measured rather than assumed.

### Record

| Reviewer | Decision | Bound hashes                                  |
| -------- | -------- | --------------------------------------------- |
| Opus     | READY    | spec `f6631b1b…2efb2`, design `91dc57cc…6fdb` |

Any later change to either file voids this verdict until it is rereviewed.
