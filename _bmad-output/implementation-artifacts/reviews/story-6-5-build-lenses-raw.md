# Story 6.5 bmad-build review lens outputs

Frozen review snapshot: source manifest e5ddae544aa29ec1bf6886f842cebae26fd786887516b78c79b115ea46d37bdf; full diff bd39e86827490dc6b83be6f0dee1aad0ad6ee2f7c47c5d79c7f1978671f9c8fe. These are untriaged reviewer claims. All five layers must report before classification.

## Blind hunter

Finding floor: 5,014,047 bytes / 1,000 = 5,014.047 kB; min(floor(sqrt(5,014.047)+1),10)=10.

- B1. community-preferences.service.ts:104: enabling alone leaves optional NotificationPreference absent while snapshot presents default push=true. Web sends changed fields only; notifications worker group permanently disables intent when account row missing. Create policy/default consistently.
- B2. native-notifications.ts:94: five-second HTTP client timeout starts before imports, OS permission and token acquisition. A user spending five seconds approving permission reaches register with aborted signal. Create per-invocation deadlines after native work.
- B3. push-registration.service.ts:37: expectedBinding remains on device after retention/invalid cleanup deletes server row. Every refresh rejects missing row and device keeps expectation. Reconcile authoritatively and re-register safely.
- B4. mobile notification-settings.tsx:59: revision conflict leaves stale revision, so every later save conflicts. Fetch current settings and preserve recoverable edits.
- B5. web notification-settings/page.tsx:15 and mobile settings: one-shot load races asynchronous restoration and never reloads at session/account readiness. Gate on verified session and scope.
- B6. community-sync-state.ts:157: anonymous removal resync bootstraps feed, but UI rebuild callbacks do not refresh open comments. Healthy socket disables comment polling, leaving deleted/moderated text visible. Invalidate or refresh open thread during resync.
- B7. community-lookbook-grid.tsx:2197 and mobile queue: pending newLooks excluded from revalidation/eviction. Removed post remains cached and Show new looks exposes old content. Revalidate queued entries before insertion.
- B8. community-sync-client.ts:32: events/resolve production requests have no timeout. Stalled fetch holds coordinator flight forever, subsequent doorbells/fallback join it. Fresh bounded requests and owner-stop cancellation required.
- B9. community-receipts.worker.ts:65: receipt marked invalid_token before separate prune; prune failure excludes it from later sweeps and alternate cleanup handles failed tickets only. Make cleanup durable/retryable or atomic with generation-scoped settlement.
- B10. native-notifications.ts:251: subscriptions added after session may already restore; no initial authenticated reconciliation, token/last_used stays stale until next lifecycle. Reconcile current owner once listeners are installed.

## Verification gap lens

- V1. Regression gap: web-session.ts accept resolves canonical identity and writes bearer at lines50/58; communitySyncFromWeb consumes it. Searches for web-session/startWebSession/resolveWebSessionToken/verifyWebOtp/requestWebOtp/signOutWebSession/SessionBridge find no test refs. UI harness injects token and auth-session-standard Playwright checks fixture cookie; native tests cover separate implementation. Removing sessionStorage bearer write would leave checked tests green while login appears successful and community rejects requests. Add controlled real web-session plus actual authenticated community HTTP assertion.
- V2. Broken-verification gap: production community-transport.ts:62 validates doorbell then options.changed(). Coordinator test mocks transport/calls changed; realtime integration uses raw socket clients; web harness disables coordinator; native test replaces startup/manually catches up. Removing actual options.changed() leaves checked tests green while healthy clients stop updating and periodicREST is off. Extend real local server test through production transport+coordinator to observable reconciled aggregate.
- V3. Other finding: same enable-only default-account-policy defect as B1. User.notification_preference optional, production writers only alerts/community preferences, no creation trigger/required row. HTTP preference test sends all quiet-hours fields and delivery fixtures explicitly create account row, masking first-time enable-only path.

## Edge-case hunter

- E1. community-sync-state.ts:119-121: deleting a comment while its thread is open causes anonymous resync to rebuild posts without clearing old comment bodies. Refresh open comments before rebuild completes.
- E2. community-lookbook-grid.tsx:2185-2200 and mobile: withdrawn buffered new looks survive and can be inserted from cache. Include pending IDs in validation/eviction.
- E3. native-notifications.ts:94-120: slow permission/token acquisition outlives5s signal before register. Use fresh deadline per HTTP invocation.
- E4. native-notifications.ts:120-134: server-pruned binding remains in SecureStore; stale expectedBinding causes perpetual conflict. Reconcile authoritative ownership/missing row safely before retry.
- E5. community-preferences.service.ts:104-123: enabled-only opt-in without account NotificationPreference creates no policy and grouping suppresses qualified intents. Materialize displayed defaults consistently.
- E6. community-receipts.worker.ts:64-66: cleanup failure after invalid receipt settlement leaves invalid registration active forever. Durable cleanup retry with generation scope.
- E7. community-lookbook-grid.tsx:2235-2242: unavailable during initialfeed/pagination fences old request cleanup, leaving loading flags/page controls stuck. Clear loading flags and rebuild pagination metadata.
- E8. community-comments-state.ts:371-385: realtime refresh after off-first-page notification navigation replaces targetpage with pageone, removing focused target. Retain/refetch target page boundaries.
- E9. community-comments-state.ts:431-433: post inaccessible between targetresolve and targetpageload rejects without unavailable handling/localizedfallback. Catch failure and apply actual fallback. Reviewer kindclaim/confidencehigh.
- E10. wardrobe.ts:197-199: existing wardrobe.test.ts:318-331 still exercises removed synchronous owner resolution;5tests fail on Promise vs synchronous return/throw. Update to await canonical profileHTTP resolution and preserve assertions. Reviewer kinddeletion/confidencehigh.
