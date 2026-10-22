# Story 6.5 independent code review (Opus)

Updated: 2026-10-20. Review only. No source, test, spec or design file was modified.

## Review identity and inputs

| Item              | Value                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviewer model    | `claude-opus-5-5` (Claude Opus 5.5), confirmed from the session's system configuration                                                                                                |
| Reasoning effort  | The brief requested "high". This session cannot confirm "high" from inside; its configured effort setting appears lower. The coordinator should treat the effort level as unverified. |
| Branch / HEAD     | `feat/story-6-5-realtime-engagement` at `aa8cd0e1f12ea778a9ca40b76c0868637f1b55a1`, uncommitted tree                                                                                  |
| All-changes diff  | `all.diff`, SHA256 `bd39e86827490dc6b83be6f0dee1aad0ad6ee2f7c47c5d79c7f1978671f9c8fe` (verified)                                                                                      |
| Source projection | `source.diff`, SHA256 `a22b38990f8257ab87dcf9dd191993118e147cb969affdee392eb812420aff92` (verified), 166 files                                                                        |
| Context read      | `source-ready.md`, `implementation-checkpoint.md`, `privacy-writer-inventory.md`, the spec and the normative design                                                                   |

**Effort provenance (added 2026-10-20, from coordinator evidence).** The caveat in the table above
is preserved as written. The coordinator independently verified the configured effort from outside
this session:

- `herdr pane process-info --pane wKS:p2` reports live PID 86915 with argv
  `[claude, --model, claude-opus-5-5, --effort, high, --permission-mode, auto]`.
- `~/.claude/settings.json` sets the model-specific `claude-opus-5-5` `effortLevel` to `high`.

The configured effort level `high` is therefore verified from the launch and runtime process. That
evidence attests the configuration only. It does not attest the internal computation of any
individual response.

**Method.** I reviewed these areas directly:

- the migration (triggers, privacy guard functions, forget/erasure)
- the appender (`community-stream.repository.ts`)
- the send guard and provider
- the flag evaluation cache
- the realtime server, its Vercel entry and `main.ts` attachment
- producers and intent qualification
- the sync serialization of private events
- the client transport

Three parallel read-only lanes covered, respectively:

1. client, web, mobile and native lifecycle;
2. push registration, tokens, dispatch, receipts, retention and policy;
3. auth, contracts, sync and targets, flags and the privacy-writer lock order.

I re-verified every High and Medium finding from those lanes against the source and cite the
lines below. Low findings from the lanes were spot-checked and are attributed to their lane.

**Exclusions.** The checkpoint declares these acceptance lanes open, and they are not reported as
defects:

- native OS taps
- real Supabase sessions
- provider-to-device delivery
- the hosted preview
- fault, process-loss and privacy races
- the herd and perf runs
- Pact, Optic and full `validate`

Where a declared-open lane would have exposed a defect, the defect is still reported.

## Verdict

**CHANGES_REQUIRED.** There are 6 High and 11 Medium findings, plus Low findings. Several High
findings are reachable in normal healthy operation:

- a stalled or disconnecting realtime lane
- silent loss of all community push for default-preference users
- whole-batch 503 on active posts
- removed comments staying visible
- user publishes aborted by a tab switch

## High findings

### H1. The appender's write phase has no time bound, so append can livelock silently

**Evidence.** `apps/api/src/modules/community/community-stream.repository.ts`:

- `:61-63` sets `transaction_timeout = '500ms'`.
- `:74` bounds only candidate preparation, at 150 ms or 25 rows.
- `:96-125` runs four sequential round trips per ready row: head update, event insert, link
  insert, outbox update.
- `:46-55` (`assist`) swallows `55P03/57014/25P04` and returns 0.

**Failure scenario.** Against a database that is not local, a burst batch is 25 candidates. At
about 9 round trips each to prepare, plus 4 each to write, that is roughly 325 round trips. At
2-4 ms RTT that is about 0.6-1.3 s, which exceeds the 500 ms server `transaction_timeout`. PostgreSQL
terminates the session and the whole batch rolls back. The next run selects the same oldest
candidates at the same size and fails again. Append makes no progress, and `assist` reports 0
without telemetry.

The 100-row burst test (`community-stream.integration.spec.ts:55`) runs only on localhost, so it
cannot detect this.

**Corrective requirement.**

- Bound the write phase by elapsed time with per-row checks against the remaining server budget,
  or make the write set-based: one `UPDATE ... RETURNING` on the head plus one `INSERT ... SELECT`
  with `row_number()`, which takes a constant number of round trips.
- Shrink the batch after a timeout, so a failed batch is never retried at the same size.
- Emit telemetry on every swallowed timeout.
- Add an integration case with injected per-statement latency (a proxy or `pg_sleep` in a
  statement) proving progress at the declared envelope of 20/s plus a burst of 100.

### H2. Any appender failure in the realtime tick disconnects every socket on the instance

**Evidence.** `apps/api/src/realtime/community-realtime.server.ts:111-113` awaits
`deps.streams.assist()` inside the tick's `try`. The `catch` at `:159-160` sends `unavailable` to
every connection and disconnects it.

`assist()` rethrows anything outside `55P03/57014/25P04`, including:

- Prisma `P2028` from `timeout: 750` or `maxWait: 100` (`community-stream.repository.ts:128-131`)
- `40P01` between the assist claim's multi-row head `UPDATE` and `retain()`'s blocking `FOR UPDATE`
- connection loss after a `transaction_timeout` FATAL

**Failure scenario.** One slow append under pool contention disconnects all sockets on the
instance. Every client then reconnects with backoff and runs bootstrap catch-up, a reconnect storm.
Combined with H1, this repeats every second. Opportunistic housekeeping must never degrade the
delivery lane.

**Corrective requirement.**

- Isolate assist: catch, log and meter it, and continue with the head comparison.
- Disconnect a socket only for its own authorization result.
- Treat a head-read failure as instance-local degradation with bounded retry before emitting
  `unavailable`.
- Add a test where assist throws and every socket stays connected.

### H3. A missing `NotificationPreference` row silently suppresses all community push

**Evidence.**

- `community-notifications.worker.ts:74-83` marks the intent `deliverable: false` when there is
  no account row.
- `:186-195` suppresses the group when `!policy?.push_enabled`.
- `community-send-guard.ts:255-262` does the same.
- `community-preferences.service.ts:37-42`, however, reports the defaults `pushEnabled: true` and
  quiet hours off to clients, and creates the row only when quiet-hour fields change (`:104-123`).
- Web PATCH sends only changed fields, and native enable sends only `{ baseRevision, enabled }`.
- The weather path treats a missing row as `DEFAULT_NOTIFICATION_PREFERENCE`.

**Failure scenario.** A user who never saved weather alert settings opts in to community push.
The UI shows "enabled", and every qualifying reaction or comment is permanently non-deliverable
with no visible reason.

The integration fixture always creates the row (`community-delivery.integration.spec.ts:94`), which
masks this.

**Corrective requirement.**

- Resolve a missing row to the same defaults as the preference service and the weather path,
  consistently in qualification, fanout, the send guard and policy reconciliation. Alternatively,
  create the row inside the opt-in PATCH transaction.
- Add an integration case with no account row.

### H4. `targets/resolve` fails the whole batch with 503 whenever a rendered post is active

**Evidence.** `community-targets.service.ts:70-88`.

- The fresh check requires `community_revision` to equal the snapshot value (`:74`). Every
  reaction and comment bumps that revision through `community_record_invalidation`.
- When the post is still visible but its revision moved, the code retries once (`:83`) and then
  throws 503 for the entire batch.
- The window between the snapshot and the fresh check includes `projectSnapshot` (`:65-69`). For
  every earlier target, that is image URL signing over the network.

**Failure scenario.** Any of up to 50 rendered posts receiving about one reaction per second
makes revalidation fail persistently. Per D3, a typed 503 hides community content and marks it
stale, so the busiest feed becomes unusable, with the healthy dependency reported as unavailable.

**Corrective requirement.**

- D3 requires a fresh _visibility_ check, not revision equality. If the post is still visible,
  return the authoritative newer state, or recapture only that target in a new snapshot.
- Never fail unrelated targets.
- Reserve 503 for real dependency failure.
- Add a test with concurrent reactions during resolve.

### H5. Removed comments stay visible in an open thread

Found by the client lane; re-verified.

**Evidence.**

- `comment.removed` serializes as an anonymous resync (`community-sync.service.ts:95,168`).
- The web `changed` handler refreshes the open thread only when an event carries a matching
  `postId` (`apps/web/src/app/components/community-lookbook-grid.tsx:2222-2229`). Mobile does the
  same (`community-screen.tsx` around `:699-706`).
- The resync `rebuild` (`refreshFeed`) and `validateTargets` (`community-sync-state.ts:187-206`)
  handle feed cards and post-level targets only.

**Failure scenario.** A viewer has a thread open. A moderator removes a comment, or its author
deletes it. The comment's text stays on screen until the thread is reopened. This violates D9
("hidden items leave the view") and D3's 20-second active-view bound.

**Corrective requirement.**

- Resync and bootstrap rebuild, and every resync event, must refresh the open thread while keeping
  its page bounds, draft and focus.
- Fallback target revalidation must include the open thread's comments.
- Add a web and a mobile component test for removal while a thread is open.

### H6. Foregrounding and routine disconnects abort in-flight user actions and hide content

Found by the client lane; re-verified.

**Evidence.**

- `community-sync-state.ts:75-81`: `foreground()` always emits `availability('unavailable')`.
- Web calls it on every `visibilitychange` and `online` event
  (`community-lookbook-grid.tsx:2258-2262`). Mobile calls it on every AppState `active`.
- Every transport disconnect, including the 295 s function-duration recycle, also emits
  `unavailable` (`community-transport.ts:74-81`).
- The web `availability` handler (`community-lookbook-grid.tsx:2231-2243`) aborts
  `actionControllerRef`, which is used by publish, report, withdraw and photo preparation, and
  resets `isPublishing`.
- Mobile aborts the post sheet's pick and allocate flow.

**Failure scenario.**

- A user switches tabs while a look is uploading or publishing. The publish is silently aborted.
- On Android, returning from the image picker fires `active`, which discards the picked photo.
- Every five minutes the socket recycle does the same to any in-flight action.
- Mobile renders the "No looks yet" empty state while unavailable, and the
  `community.realtime.unavailable` copy is never shown.

This is a regression in existing core publishing flows.

**Corrective requirement.**

- An ordinary disconnect or foreground enters fallback catch-up without aborting in-flight
  mutations.
- Suppress only new mutations, and only while verification is actually unavailable.
- Hide content only on a typed 503, a socket `unavailable` control, or a failed verification.
- Render the localized unavailable state.
- Add tests: a tab switch during publish, and a picker return.

## Medium findings

### M1. Handshake rejections do not say "denied", so denied clients retry forever

**Evidence.** `community-realtime.server.ts:197-198` maps every handshake failure to
`next(new Error('Community connection unavailable.'))`, including the `ForbiddenException` from
`access.assert` (`:179`). The client maps `connect_error` to `unavailable` and retries
(`community-transport.ts:74-81`). Only the post-connect control message can say `denied`.

**Failure scenario.** A member whose read rollout is off, or who becomes ineligible, reconnects
every 15 s or less indefinitely. Each attempt costs a function invocation plus flag and database
checks, and the UI shows "unavailable" instead of the denial state.

**Corrective requirement.** Attach `err.data = { version: 1, status: 'denied' | 'unavailable' }`
on handshake errors, have the client stop on denied, and test both cases.

### M2. The comment screening processor now throws on flag unavailability

**Evidence.**

- `feature-flags.service.ts:58-73` routes `community_read_enabled` through the remote-only cache
  and throws `CommunityUnavailableException` when no result exists.
- `community-comments.processor.ts:34,48` (`rolloutAllows`), unchanged, evaluates it through
  `getFeatureFlag` for every job and in `markFailed`.
- The worker (`community-moderation.worker.ts:243-259`) calls `markFailed` after the last attempt.
  `markFailed` throws again on its own `rolloutAllows`.
- `sweepStale` (`community-comments.outbox.ts`) loops `markFailed` and aborts on the first throw.

**Failure scenario.**

- A PostHog outage, or a cold-cache claim taking longer than 2 s, exhausts the comment's screening
  attempts.
- Once the outage ends, the stale sweep marks those comments `screening_failed` and files them as
  moderation intake. Comments that would have passed screening are never published, and moderators
  get spurious items.
- During the outage, one failing row blocks the whole sweep.

The legacy behavior used the stored fallback here, so this is a new failure mode.

**Corrective requirement.**

- Treat unavailability as a defer: requeue with a generation bump, as the existing `defer()` does,
  instead of a screening failure.
- Make `sweepStale` per-row fault-tolerant.
- Add a test of a flag outage spanning screening attempts.

### M3. Guardian revocation runs forget before the suspension mutations

**Evidence.** `apps/api/src/modules/guardian/guardian.service.ts:822` calls
`forgetCommunitySubject(tx, teenId, false)`. The `updateMany` calls at `:823-844` then fire
triggers that recreate outbox rows (`migration.sql` `community_comment_invalidation` and
`community_reaction_invalidation`):

- private `comment.status` rows in the teen's freshly purged stream
- public rows with `community_link_subject` links at the new generation

Erasure orders this correctly: `community.repository.ts:507-515` runs forget last.

**Failure scenario.** After an effective revocation, teen-linked outbox and event rows and
subject links exist again at a valid generation. This contradicts D8's requirement to cancel
unsent work atomically with no resurrection.

**Corrective requirement.** Move forget after the suspension updates, and add an integration
assertion that no teen-linked outbox, event or private rows remain.

### M4. The flag invocation deadline mixes the database clock with the application clock

**Evidence.** `community-flag-evaluation.service.ts:148-153`: `origin` is the database
`clock_timestamp()`, while `invocationDeadline = min(deadline, origin + 1000)` is compared with
`Date.now()`.

**Failure scenario.**

- If the app clock runs ahead of the database by about 1 s, every claim returns before the remote
  call, yet each claim still consumes `next_claim_at`. Cold members get 503 indefinitely.
- If the app clock runs behind, the remote call can exceed its 1 s budget.

**Corrective requirement.** Keep `origin` only for validity. Derive the invocation deadline from a
local monotonic time taken when the claim commits.

### M5. Housekeeping failures in `events()` surface as untyped 500

**Evidence.** `community-sync.service.ts:46-55` runs `assist()` before reading.
`community-stream.repository.ts:46-55` rethrows Prisma `P2028` and `40P01`. Failures of the
snapshot transaction are also unmapped.

**Failure scenario.** The read fails as a 500 through the generic filter, although D3 requires
typed 503 `unavailable` for transient dependency failure. Opportunistic work turns a healthy read
into an error.

**Corrective requirement.** Make assist best-effort in `events()`, and map transient Prisma
connection, timeout and serialization errors in `events` and `targets` to the typed unavailable
exception.

### M6. A flag-unavailable delivery hot-loops and starves other deliveries

**Evidence.** `community-send-guard.ts:160` calls `flags.evaluate` before `claim`. A
`CommunityUnavailableException` propagates without moving `next_attempt_at`.
`community-notifications.worker.ts:359-371` reselects the same oldest 32 due rows about every
50 ms.

**Failure scenario.** A few recipients whose cache refresh failed hold the next-claim window for 45
s and fill all 32 slots. Healthy recipients miss the 60 s dispatch budget. Every round can also
wait up to 2 s in the flag wait loop.

**Corrective requirement.** Record this case as a proven no-call deferral with bounded backoff that
preserves the original deadline, or exclude recently deferred rows from the due query. Add a
starvation test.

### M7. The engagement runtime starts in both worker processes

**Evidence.** `apps/api/src/workers/bootstrap.ts:132` (the weather worker) and
`apps/api/src/workers/community.bootstrap.ts:106` both call `startCommunityEngagementRuntime`.

**Failure scenario.**

- With dispatch enabled, the 36-connection guard pool and the 32 send slots are doubled, against
  the D10 budget.
- The append, retention and telemetry loops are duplicated.
- If the community capability check fails (PostgreSQL below 17, ineffective timeouts or a missing
  guard URL), the weather worker exits (`bootstrap.ts:345-347`) and weather alerts stop.

**Corrective requirement.** Run the runtime in exactly one composition, the community worker, and
keep weather startup independent of community dispatch configuration.

### M8. Replayed comment events are dropped after target validation

**Evidence.**

- `community_revision` is a per-post counter that comment events also bump.
- `validateTargets` stores the current post revision from resolve
  (`community-sync-state.ts:199-202`).
- `newerEvents` then drops replayed events whose revision is at or below it (`:143-148`), and
  `apply` refreshes only cards, never threads.

**Failure scenario.** In fallback mode, or on a `hasMore` page, a `comment.published` for an open
post is filtered out, and the new comment never appears.

**Corrective requirement.** Keep separate card and thread revision tracking, or refresh the open
thread whenever the post revision advances.

### M9. Loading flags stay stuck after a sync invalidation

**Evidence.**

- Web `changed` and `availability` bump the feed generation and abort the feed controller
  (`community-lookbook-grid.tsx:2223-2225,2236-2238`).
- `loadFeed` clears `isLoading` and `isLoadingMore` only when the generation still matches.
- Mobile does the same (`community-screen.tsx` around `:578-582`).
- `refreshFeed` throws "superseded", and that is reported as `unavailable`.

**Failure scenario.**

- "Load more" or pull-to-refresh stays disabled or spinning forever after a doorbell.
- On mobile, infinite scroll stops.
- A user action during bootstrap hides the community.

**Corrective requirement.** Whatever supersedes a request resets its loading flags, and a
superseded rebuild is never reported as unavailability.

### M10. Buffered and deep-linked posts are never revalidated

**Evidence.** `rendered()` returns only `items` and the opened item (web
`community-lookbook-grid.tsx:2197-2200`, and the same on mobile). It excludes `newLooks` and the
deep-linked item, which are still displayed or insertable.

**Failure scenario.** A taken-down post sitting in "N new looks" is inserted when the user taps
"Show". A removed deep-linked post stays pinned at the head of the grid.

**Corrective requirement.** Include buffered and deep-linked IDs in `rendered()`.

### M11. Wardrobe tests are stale and now fail

**Evidence.**

- `apps/mobile/src/lib/wardrobe.ts:197-200` made `resolveOwnerUserId` async and profile-based.
- `apps/mobile/src/lib/wardrobe.test.ts:318-333` (unchanged) still asserts synchronously. It
  checks `.toBe('user-42')` on a Promise and `toThrow` on an async function.

The recorded mobile run covered only 5 files, so this file was not executed. Full `validate` will
fail.

**Corrective requirement.** Rewrite these tests, and any dependent onboarding test that relies on
JWT decoding, against the profile endpoint using an MSW handler.

## Low findings

Source tags: own (my direct review), C (client lane), P (push lane), A (auth, contracts and privacy
lane).

**Realtime, stream and test coverage**

- **L1 (own).** Erasure writes `comment.status` rows to the public stream table.
  - `community_comment_invalidation` passes `NEW.user_id` as `private_owner`. The erasure
    `UPDATE` nulls `user_id`, so `community_record_invalidation` takes the public branch and stores
    pending comment IDs in the public stream.
  - Serialization never transmits them (`community-sync.service.ts:152,187-206`), but they violate
    the D3 rule that private rows never enter the public stream, and they ring the public doorbell.
  - Fix: use `OLD.user_id` as the owner, or skip private emission when the owner is NULL.
- **L2 (own).** Revalidation can start more than 8 s apart. The tick reschedules 1 s after
  completion and awaits `assist()` first (up to 750 ms), and the 7.5 s check is measured from the
  last check (`community-realtime.server.ts:100-102,135`). Revalidation can therefore start about
  9.3 s apart, over D1's 8-second bound. Fix: schedule the check on a fixed cadence that is not
  delayed by assist.
- **L3 (C).** The reconnect transport has no executable tests: backoff, jitter, the 30 s reset, a
  fresh token, and denied versus unavailable. The consumer test mocks it.

**Native and client**

- **L4 (C).** A token-rotation event can join an in-flight reconcile that fetched the pre-rotation
  Expo token (`native-notifications.ts:151-153,248-250`). Use a dirty flag and rerun.
- **L5 (C).** Mobile notification settings:
  - no 409 handling, so after one conflict every later save fails with a stale revision;
  - PATCH sends all fields instead of only the changed ones;
  - no device timezone suggestion (D4);
  - a foreground reconcile can absorb the enable request without showing the OS prompt.
- **L6 (C).** OTP calls use `shouldCreateUser: true` (`web-session.ts:112`,
  `native-session.ts:177`), which contradicts D5's "existing application accounts". Set it to
  `false`.
- **L7 (C).** Comment-state issues:
  - `refresh()` always announces new comments, including on reaction and status events;
  - `loadLocation` has no error handling;
  - reply-target loading invalidates the author's private status read.
- **L8 (C).** A reaction-state capability fence returns `null` and drops the whole post instead of
  stripping only its reactions (`community-reaction-state.ts:115-116`).

**Dispatch, policy and retention**

- **L9 (P).** An intent can attach to an already-snapshotted group, because `group()` does not lock
  it. Lock it `FOR UPDATE` and recheck `snapshot_at IS NULL`.
- **L10 (P).** The first legacy PUT that creates the row is invisible to the PATCH revision, since
  the revision trigger fires on `BEFORE UPDATE` only. Distinguish an absent row in the revision
  hash.
- **L11 (P).** Policy edits set `next_attempt_at = now`, bypassing the 30 s group spacing.
- **L12 (P).** Group expiry comes from the first intent only, so surviving contributors expire
  early.
- **L13 (P).** A fanout quiet-hour deferral does not advance `eligible_at`, so the 60 s clock and
  the latency metric measure from before quiet hours.
- **L14 (P).** `community_forget_subject` marks attempts `unknown` without `completed_at`. The
  retention worker requires `completed_at < cutoff`, so those rows are never deleted.
- **L15 (P).** The receipt lookup schedule is not clamped to `expires_at`, so the final lookup can
  be skipped.

**Auth, flags and errors**

- **L16 (A).** `createPostDraft` takes no `community_member:` lock. A draft created after the
  erasure privacy recheck makes the unguarded `updateMany` raise `23514`, which is not retried, so
  erasure fails. There is currently no production caller, hence Low.
- **L17 (A).** Typed-error gaps:
  - a fixed `retryAfterSeconds: 2` while the next claim may be 45 s away;
  - the targets 503 body lacks `statusCode` and `retryAfterSeconds`;
  - the 400s carry no `code`;
  - OpenAPI declares 400, 409 and 503 without schemas.
- **L18 (A).** The email-based identity fallback is nondeterministic:
  - a case-insensitive `findFirst` over a case-sensitive unique email, with no normalization at
    signup;
  - `app_user_id` without a role now falls back to email mapping, where it used to be rejected.

  Normalize email, reject more than one match, and reject `app_user_id` without a role.

- **L19 (A).** A valid flag result that arrives after the request deadline is discarded without
  releasing the claim, so other waiters spin until the lease ends.

## Open question (not a defect)

Release and screening publication still gate `community_write_enabled` through the legacy
resolver, whose outage fallback uses the synthetic ID (`feature-flags.service.ts:76-80`). D1 applies
remote-only provenance to read paths only. The coordinator or owner should confirm whether write
rollout was meant to stay on the legacy resolver.

## Verified correct (summary)

**Ordering and appender**

- Serialized append under head row locks.
- Per-candidate savepoints with try-locks and `SKIP LOCKED`.
- Generation re-checks.
- Unavailable public sources become anonymous resync.
- `UNIQUE(source_outbox_id)` and per-stream sequence uniqueness.

**Privacy writers**

- Two-integer privacy namespaces 65001 and 65002, disjoint from engagement keys.
- `community_prepare_subject_privacy` follows the global order with rediscovery.
- Takedown, withdraw, author delete, maintenance, preferences, legacy alerts and token paths take
  privacy guards first.
- Engagement writes take none.
- Triggers allocate revisions under the post row before the outbox insert.

**Send path**

- `sending` is committed before the provider call.
- One `fetch` per attempt, with no SDK retry.
- An ambiguous response is `unknown`, with no resend.
- Only `MessageRateExceeded` retries, with at most 3 initiated attempts and 2 s then 10 s backoff.
- Server-side guard timeouts are verified at startup, with PostgreSQL 17 required.
- Lease plus guard window apply before orphan recovery.
- Generation- and owner-conditional pruning in both the weather and community chains.

**Contracts**

- OpenAPI changes are purely additive.
- Legacy alert, feed, post, comment, `lookbook:new` and poll schemas are byte-compatible.
- New schemas are strict.
- The cursor is HMAC-signed and bound to member and scope.
- Events use a Repeatable Read snapshot with a fresh visibility check.

**Flags**

- Remote-only provenance; synthetic fallback never stored.
- Claim origin from database time, refresh at 45 s, hard expiry at 60 s.
- Owner-, lease- and generation-conditional completion with no upsert.

**Client**

- Websocket-only transport, token in `auth`, exact path.
- Backoff of 500 ms rising to 15 s with jitter.
- Heads captured before rebuild, with single-flight catch-up.
- No periodic REST while the socket is healthy.
- Notification-response and cold-start consumption with dedupe.
- Expo-token registration; SecureStore session storage.
- Logout unbinds before sign-out.
- Deep-link `commentId`/`parentId` validation.
- Locale keys present in all 10 locales.

## Process

This review started no persistent processes. The only process-like activity was three read-only
background review lanes inside this session; all have completed. No source, test, spec or design
was edited, and nothing was staged, committed, pushed or deployed. No permission was denied.

The fixes listed above are corrective requirements for the coordinator to triage. No repairs were
made in this phase. Opus remains available for rereview of remedies.
