# Code & Security Review — Story 6.15 (`tea615`, Round 38)

- **Repository / Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615` (read-only; mutants & integration DB runs isolated to detached `/tmp/wt-615-mutant-r38` and stopped `agy615` PostgreSQL on `127.0.0.1:55481`, both removed/pruned afterward)
- **Reviewed Range**: `6ccb76ca..4aff0366` (`3f5db565`, `8ff09040`, `22af2351`, `1b139cf6`, `f0b08fa7`, `4aff0366`)
- **Verdict**: **Range `6ccb76ca..4aff0366` is clear above P3.** No P0, P1, or P2 findings; 3 P3 findings documented below.

---

## Findings (P0–P3)

### P3-1 — Drift settlement advances `PremiumEntitlement.synced_at` on permanent/drifted pull failures, masking staleness in status & refresh responses and deferring retries 24h on RC schema drift

- **Locations**:
  - `apps/api/src/modules/commerce/billing-reconciliation.service.ts:227-242` (`settleUnrepresentableRow`)
  - `apps/api/src/modules/commerce/revenuecat-client.ts:218-228,316-336` (`permanentLedgerProjectionFailure`, `projectSubscriber`)
- **Failure scenario**:
  1. `projectSubscriber` throws `RevenueCatUnrepresentableEntitlementError` (`missing_product`, `no_expiry`, `invalid_expiry`) or `RevenueCatUnsupportedStoreError` (including `store: null` when `subscriptions[productId]` is absent). While HTTP non-2xx (`RevenueCatRequestError`), timeouts, and network errors stay transient (`null` -> 503 / kept stale), **RevenueCat JSON schema drift** (e.g. renamed `product_identifier`, `subscriptions`, `store`, or `expires_date`) on an HTTP 200 payload throws those exact classes, causing `POST /refresh` to answer `200` with local state and `correctDrift` to settle the row.
  2. When `settleUnrepresentableRow` executes `prisma.premiumEntitlement.updateMany` setting `synced_at: new Date()`, subsequent `GET /api/v1/commerce/subscription` and `POST /api/v1/commerce/subscription/refresh` calls serialize `row.synced_at` (`subscription.service.ts:211`). As a result, a stale row settled because the ledger could not be projected subsequently reports a fresh `syncedAt` timestamp (whereas `refreshSubscription` alone leaves `syncedAt` unchanged, matching the OpenAPI contract), and schema-drifted rows are skipped by drift reconciliation for `DRIFT_STALENESS_HOURS` (24h).
- **Evidence**: Code inspection (`billing-reconciliation.service.ts:234-237`, `revenuecat-client.ts:316-336`, `subscription.service.ts:211`) and `premium-reconciliation.integration.spec.ts:393-404` verifying `synced_at` moves past `Date.now() - 24h`. Note: `settleUnrepresentableRow` also logs `billing_reconciliation_drift_entitlement_unrepresentable` without gating on `updated.count > 0` if a concurrent webhook/refresh beat it.

### P3-2 — `revenuecat-key-hygiene` uses `dotenv.parse` without `dotenv-expand`, unlike Expo's `@expo/env`

- **Locations**:
  - `scripts/ci/revenuecat-key-hygiene.mjs:60-62,98-112`
  - `node_modules/@expo/env/build/index.js:169,222-227`
- **Failure scenario**: `readEnvEntries` parses each `.env*` file with `dotenv.parse(...)` alone, whereas Expo (`@expo/env`'s `parseEnvFiles`) runs `dotenvExpand.expand(...)` after `dotenv.parse`. If a release env file constructs a `test_` key from shorter variables (e.g. `RC_A=test_AbCdEfGh`, `RC_B=IjKlMnOpQrSt`, `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY=${RC_A}${RC_B}`), `envProblems` checks literal `'${RC_A}${RC_B}'`, returning `[]`, while `@expo/env` resolves `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY` to `'test_AbCdEfGhIjKlMnOpQrSt'`. (This was also absent from the prior line parser and is mitigated downstream by bundle scanning via `revenuecat-bundle-scan.mjs`.)
- **Probe evidence (`P3`)**: Against a temp `.env.production` containing `RC_A=test_AbCdEfGh`, `RC_B=IjKlMnOpQrSt`, `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY=${RC_A}${RC_B}`, `keyHygieneProblems(root)` returned `[]` while `@expo/env` `parseEnvFiles` returned `'test_AbCdEfGhIjKlMnOpQrSt'`.

### P3-3 — `transfersUnhonoredStore` branch is unpinned by assertions and now affects only log classification when `honoredLosingRow` is present

- **Locations**:
  - `apps/api/src/modules/commerce/billing-webhook.service.ts:738-747`
  - `apps/api/src/modules/commerce/billing-webhook.service.spec.ts`
- **Failure scenario**: Mutating `if (transfersUnhonoredStore(event, losingRow))` to `false` (`M2_transfer_drop_transfersUnhonoredStore`) **survived** all 87 tests in `billing-webhook.service.spec.ts` because `planRevenueCatTransition` already handles unhonored `event.store` values and `honoredLosingRow` already turns an unhonored `losingRow` into `null`. Without `transfersUnhonoredStore`, a store-less `TRANSFER` over a `test_store` row still performs zero entitlement writes, audit rows, or deactivation events, changing only the log from `info` (`TRANSFER recorded without transition: its store is not honored in this environment`) to `warn` (`TRANSFER gain skipped: no store/product/period derivable from the event or the losing row`).

---

## Focus Area Assessment

### Focus (1): `TRANSFER` isolation against `test_store` and attacker/store-less fields

- **Cannot revoke or grant from `test_store` outside `local`/`preview`**:
  - Webhook authentication uses timing-safe `safeEquals(input.authorization, expected)` before `JSON.parse` (`billing-webhook.service.ts:601-620`).
  - `planRevenueCatTransition` (`L292-294`) maps unhonored non-empty `event.store` (`TEST_STORE` outside `local`/`preview`, `AMAZON`, etc.) to `RECORD_ONLY`.
  - In `applyTransfer` (`L737-778`), empty/null/undefined `event.store` enters `transfersUnhonoredStore` (`L332-338`) and returns early without mutations if `losingRow.store` is unhonored (`test_store`). Even with an honored `event.store` (e.g. `APP_STORE`), `honoredLosingRow` (`L746-747`) filters `losingRow` through `honorsEntitlementStore(losingRow.store)`, setting `honoredLosingRow = null`:
    - Loss branch (`L749-763`) is skipped -> `test_store` row is untouched, no `AuditLog` (`none -> revoked`) row is created, and `lossTransition` remains `null` so no `premium_entitlement_deactivated` telemetry event is emitted (`L797-800`).
    - Gain branch calls `resolveTransferGainState(event, honoredLosingRow)` (`L766`) -> only `event.store`, `event.product_id`, and `event.expiration_at_ms` can produce a gain (`null` store, product, or expiry skips the gain at `L358-360,775-777`).
- **Shared honored-store check**: `honorsEntitlementStore` (`premium-entitlement.service.ts:86-88`) is the single shared predicate used by read paths (`getEntitlement`, `hasPaidAccess`), write ordering (`honoredRow` -> `applyLedgerEvent`, `applyLedgerSnapshot`), reconciliation (`correctDrift`), and `TRANSFER` (`transfersUnhonoredStore`, `honoredLosingRow`).

### Focus (2): `permanentLedgerProjectionFailure` classification, `syncedAt`, and rate-limit window

- **Transient vs permanent separation**: Timeouts (`Error('RevenueCat ledger pull timed out')`), HTTP 4xx/5xx (`RevenueCatRequestError`), and network/`fetch`/JSON parse errors return `null`, so `refreshSubscription` throws `ServiceUnavailableException` (`503`) and `correctDrift` leaves `synced_at` stale. (See **P3-1** regarding schema drift inside HTTP 200 payloads.)
- **`syncedAt` on refresh**: In `SubscriptionService.pullAndApply` (`subscription.service.ts:113-125`), a permanent failure does not call `applyLedgerSnapshot` and reads back the unchanged local DB row (`syncedAt` stays at its prior timestamp or `null` if `'none'`, failing closed on absent rows). See **P3-1** for the interaction after a worker drift sweep stamps `synced_at`.
- **Rate-limit window**: `this.lastPulledAt.set(userId, Date.now())` (`L119`) behaves identically to any answered pull (throttling repeat REST pulls to 10s per instance and bounding permanent-failure warning logs to once per 10s); webhooks still apply independently, and `inFlight` cleans up in `finally`.

### Focus (3): Drift sweep (`settleUnrepresentableRow`) concurrency, starvation, logging

- **Concurrent write guard**: `updateMany({ where: { user_id: userId, synced_at: { lt: staleBefore } }, data: { synced_at: new Date() } })` (`billing-reconciliation.service.ts:234-237`) is atomic against PostgreSQL; any concurrent webhook or refresh sets `synced_at = now >= staleBefore`, so `updateMany` matches 0 rows and preserves the concurrent write.
- **Starvation/livelock & logging volume**: Advancing `synced_at` to `now()` moves unrepresentable rows out of `synced_at < now - 24h` (`orderBy: { synced_at: 'asc' }, take: 500`) across sweeps (up to 500 per 15m = 48,000/day), preventing batch-head starvation while capping warnings at once per affected user per `DRIFT_STALENESS_HOURS` (24h).

### Focus (4): Assessment of Replaced Assertions

1. **Unsupported-store 503 unit case (`subscription.service.spec.ts:136-212`) — Equal/Stronger**: Replaced the single `'test_store'` -> 503 case with 4 permanent failure cases (`amazon`, `missing_product`, `no_expiry`, `invalid_expiry`) checking exact local `Subscription` serialization, `applyLedgerSnapshot` non-invocation, and exact warning payload, plus a dedicated 10s rate-limit test and `it.each` retaining 503 assertions for `RevenueCatRequestError(503)` and timeout. _(Note: none of those 4 unit cases tests a `null` local row -> `'none'`.)_
2. **34 refresh integration cases (`premium-subscription.integration.spec.ts:450-504`) — Equal/Stronger**: Replaced `toBe(503)` with `toBe(200)`, `pull` called once (`expect(pull).toHaveBeenCalledTimes(1)`), `row.toEqual(before)`, and `subscriptionResponseSchema.parse(response.body).data` `.toMatchObject(...)` checking all 6 entitlement fields including `syncedAt: before?.synced_at.toISOString()`. Cannot pass via rate-limit short-circuit (`pull` count would be 0) or accidental snapshot write/downgrade (`row.toEqual(before)` and `syncedAt` would fail).
3. **Reconciliation `toEqual(before)` (`premium-reconciliation.integration.spec.ts:393-404` & `564-634`) — Stronger**: Asserts `after` matches `{ ...before, synced_at: expect.any(Date), updated_at: expect.any(Date) }` AND `after!.synced_at.getTime() > Date.now() - DRIFT_STALENESS_HOURS * 60 * 60 * 1000`, proving every non-timestamp column (`status`, `store`, `product_id`, `will_renew`, `last_event_id`, etc.) is untouched while `synced_at` actually leaves the staleness window; the new 2-sweep tests prove `pullsAcrossTwoSweeps` (`1` vs `2`).

### Focus (5): `dotenv.parse` in `revenuecat-key-hygiene.mjs`

- Matches `dotenv@17.2.3` (`app.config.ts`) and `@expo/env`'s per-file parser on duplicate keys (**last wins** per file; `P4a` verified overwritten `GOOGLE_API_KEY` passes while `P4b` verified duplicated `TEST_STORE_KEY_VARIABLE` still fails), `export` prefixes (`export NAME=val` and `export NAME: val`, `P4c`), quotes/backticks, and `NAME: value`.
- Only semantic difference vs Expo build-time loading is variable expansion (`dotenv-expand`, **P3-2** / `P3`). No Test Store key format previously caught by the old line regex slips past `dotenv.parse`.

### Focus (6): `apps/api` `tsc` by error code

- Read-only clean worktree (`/Users/murat/opensource/cc/couture-cast-wt-615/apps/api`): `npx tsc --noEmit -p tsconfig.json` -> **exit `0` (`0` errors)**.
- Detached `/tmp/wt-615-mutant-r38/apps/api` (with symlinked `node_modules`, after building shared deps): **2 `TS2742`** symlink-path errors on `integration/helpers/moderation-decisions-seed.ts:87` and `moderation-history-route-context.ts:58` (`0` errors in the real worktree).

---

## Mutants & Probes Executed (in detached `/tmp/wt-615-mutant-r38`, removed & pruned)

| ID                                         | Target                              | Mutation / Probe                                                 | Outcome              | Evidence                                                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M1_transfer_pass_raw_losingRow`           | `billing-webhook.service.ts`        | Bypass `honoredLosingRow` (`const honoredLosingRow = losingRow`) | **KILLED**           | `exit=1`, `billing-webhook.service.spec.ts:621` (revokes `test_store` and grants from losing row)                                                                                             |
| `M2_transfer_drop_transfersUnhonoredStore` | `billing-webhook.service.ts`        | Short-circuit `transfersUnhonoredStore` to `false`               | **SURVIVED**         | `exit=0`, 87/87 pass in `billing-webhook.service.spec.ts` (see **P3-3**)                                                                                                                      |
| `M3_classify_request_error_permanent`      | `revenuecat-client.ts`              | Classify `RevenueCatRequestError` as permanent                   | **KILLED**           | `exit=1`, `subscription.service.spec.ts:208` (returns local state instead of 503)                                                                                                             |
| `M4_skip_rate_limit_on_permanent`          | `subscription.service.ts`           | Drop `lastPulledAt.set` on permanent failure                     | **KILLED**           | `exit=1`, `subscription.service.spec.ts:196` (`ledger` called 2 times instead of 1)                                                                                                           |
| `M5_drop_updateMany_staleness_guard`       | `billing-reconciliation.service.ts` | Drop `synced_at: { lt: staleBefore }` from `updateMany` `where`  | **KILLED**           | `exit=1`, 4 unit specs fail in `billing-reconciliation.service.spec.ts:218`                                                                                                                   |
| `M6_remove_settleUnrepresentableRow`       | `billing-reconciliation.service.ts` | Skip `settleUnrepresentableRow` on permanent error               | **KILLED**           | `exit=1` in both unit (`billing-reconciliation.service.spec.ts:206`, 4 fails) and real PG integration (`premium-reconciliation.integration.spec.ts:616`, 36 test failures reported `[35/36]`) |
| `P3_hygiene_dotenv_expand_bypass`          | `revenuecat-key-hygiene.mjs`        | `.env.production` splits `test_...` across `${RC_A}${RC_B}`      | **BYPASS CONFIRMED** | `keyHygieneProblems` -> `[]`; `@expo/env` `parseEnvFiles` -> `'test_AbCdEfGhIjKlMnOpQrSt'`                                                                                                    |
| `P4a`–`P4c`                                | `revenuecat-key-hygiene.mjs`        | Dup live overwrite, dup `TEST_STORE` var, `export NAME: val`     | **VERIFIED**         | `P4a`: `[]` (`@expo/env`=`'goog_realKey'`); `P4b`: flagged; `P4c`: flagged                                                                                                                    |

---

## Security Review (`codex-security-review` / `security-diff-scan`)

- Finalized cleanly (`finalize_scan_contract.py` exit `0`) against all 11 `deep_review_input.jsonl` diff rows plus `scripts/ci/revenuecat-key-hygiene.mjs`.
- Report: `/private/tmp/codex-security-scans/couture-cast-wt-615/4aff0366_r38/report.md` (**0 reportable findings**).

---

## Verification Suites Run (in detached `/tmp/wt-615-mutant-r38` against `agy615` PG 17 on port `55481`)

- **Commerce unit specs**: `revenuecat-client.spec.ts` (41), `billing-reconciliation.service.spec.ts` (19), `billing-webhook.service.spec.ts` (87), `subscription.service.spec.ts` (14) -> **4 files / 161 passed, 0 failed**.
- **Key hygiene tests**: `node --test scripts/ci/revenuecat-key-hygiene.test.mjs` -> **8 passed, 0 failed**.
- **Premium integration specs (run 1)**: `premium-subscription.integration.spec.ts` (58) + `premium-reconciliation.integration.spec.ts` (48) -> **2 files / 106 passed, 0 failed, 0 skipped**.
- **Webhook & contract parity integration specs (run 2)**: `http-contract-parity.integration.spec.ts` (7) + `premium-stripe-rail.integration.spec.ts` (24) + `premium-revenuecat-webhook.integration.spec.ts` (53) -> **3 files / 84 passed, 0 failed, 0 skipped**.
- **`apps/api` `tsc --noEmit`**: read-only worktree exited **0 (0 errors)**.
- **Cleanup**: `agy615` PostgreSQL container stopped/removed (`integration-postgres.mjs stop --name agy615`), `/tmp/wt-615-mutant-r38` removed and `git worktree prune` verified clean.

REVIEW-615-R38-DONE
