# Story 6.15 Review — Round 6 (`398eba46..b0a2dd3f`)

Target: `/Users/murat/opensource/cc/couture-cast-wt-615` (read-only audit; range `398eba46..b0a2dd3f` at commit `b0a2dd3f`, local branch `HEAD` at `9791c5bb`).
Mutants verified in detached worktree `/tmp/wt-615-mutant-r6` at `b0a2dd3f` (removed and pruned cleanly afterward).

---

## Findings (Ranked P0–P3)

### [P2] Unhonored `test_store` row corrupts audit/telemetry and can block a real paid activation

- **Location**: `apps/api/src/modules/commerce/premium-entitlement.service.ts:261-318,362-415`
- **Failure scenario**:
  1. In a closed environment (`TEST_ENV` unset, `'staging'`, or `'production'`), a user has an existing `test_store` row with `status: 'active'` (or `'grace_period'`), e.g. from a restored preview snapshot.
  2. Because `getEntitlement` (`lines 197-199`) and `hasPaidAccess` (`line 250`) now treat that row as absent, `createCheckoutSession` allows the user to purchase a real Stripe or App Store subscription.
  3. When the real `'active'` purchase lands in `applyLedgerEvent` (`line 279`) or `applyLedgerSnapshot` (`line 378`), `from` is computed via `statusOf(existing)` as `'active'` (or `'grace_period'`) without checking `honorsEntitlementStore(existing.store)`:
     - `if (from !== input.state.status)` (`line 307` / `line 405`) evaluates `false` for `active -> active`, **skipping the `EntitlementAudit` row** for the real activation.
     - `resolveEntitlementEmission` (`lines 118-131`) returns `null` for `active -> active` and `grace_period -> active`, **silently dropping `premium_entitlement_activated`** telemetry for a genuine paying subscriber.
     - If the stale `test_store` row's `last_event_occurred_at` is newer than or equal to the real purchase event's `occurredAt` (clock skew or future-dated test fixture), `this.shouldApply(...)` (`line 269`) returns `false` and **discards the real Stripe/store purchase** (`applied: false`), leaving `store: 'test_store'` in the database so `getEntitlement` still returns `null` and the paying user remains unentitled.
  4. Additionally, when `applyLedgerSnapshot` receives `state === null` against an active/grace unhonored `test_store` row (`lines 362-375`), it downgrades the row to `'expired'` with `store: 'test_store'`, causing `pullAndApply` (`billing-reconciliation.service.ts:221`) to emit `premium_entitlement_deactivated` telemetry for an unhonored store.

### [P2] Drift reconciliation still polls unhonored `test_store` rows in closed environments

- **Location**: `apps/api/src/modules/commerce/billing-reconciliation.service.ts:178-223`
- **Failure scenario**:
  - `correctDrift` (`lines 180-185`) queries `where: { synced_at: { lt: staleBefore } }` ordered oldest-first (`orderBy: { synced_at: 'asc' }`, `take: 500`) without filtering out `store: 'test_store'` when `!appliesRevenueCatTestStore()`.
  - Every sweep in a closed environment with stale `test_store` rows either:
    - receives `test_store` from RevenueCat, throws `RevenueCatUnsupportedStoreError` in `mapRevenueCatRestStore`, logs `billing_reconciliation_drift_pull_failed` at `warn` level (`lines 197-200`), and leaves `synced_at` untouched—pinning those rows at the head of `orderBy: { synced_at: 'asc' }` and consuming slots in the 500-row batch (starving real `app_store`/`play_store` drift corrections if many stale rows exist), or
    - receives `null` from a production RevenueCat project and triggers `applyLedgerSnapshot`'s downgrade (`premium-entitlement.service.ts:362-375`), emitting `premium_entitlement_deactivated` (`store: 'test_store'`) into production telemetry.

### [P3] `android-release-abis.mjs` pre-build config check skips `app.config.ts`

- **Location**: `scripts/ci/android-release-abis.mjs:424-443`
- **Failure scenario**:
  - `configuredAbiProblems` inspects `apps/mobile/app.json` and `apps/mobile/plugins/*.js` for `buildArchs`, `reactNativeArchitectures`, and `abiFilters`, but does not inspect `apps/mobile/app.config.ts`. A plugin or config change authored directly inside `app.config.ts` would pass `configuredAbiProblems` pre-build (though `checkArtifact` still fails closed if run against the built `.aab`/`.apk`).

### [P3] Several new Step 0 / R8 / ABI checks are local scripts + unit specs without automated CI execution against real binaries yet

- **Location**: `maestro/network-timeout/dev-client-timeout.yaml`, `scripts/lib/network-tarpit.mjs`, `scripts/lib/minified-debuggable-evidence.mjs`, `scripts/ci/android-release-abis.mjs`
- **Failure scenario**:
  - On PRs and nightly workflows, `dev-client-timeout.yaml` is syntax-checked (`scripts/ci/maestro-check-flows.mjs`), `test:minified-debuggable-prebuild` verifies the Gradle prebuild plugin (`pr-checks.yml:370`), and the Node unit tests for `android-release-abis`, `minified-debuggable-evidence`, and `network-tarpit` run under `native-harness`. No CI workflow currently builds `app-minifiedDebuggable.apk`, runs `minified-debuggable-evidence.mjs`, executes `dev-client-timeout.yaml` against `network-tarpit.mjs`, or runs `android-release-abis.mjs` on a built release archive—these remain operator/gate tools for the SDK steps unless wired into CI later.

_(Security scan check: no P0/P1 vulnerabilities found across the 42 files in range.)_

---

## Part A Verification Summary

1. **`a648eb83` (`honorsEntitlementStore` gates `getEntitlement` and `hasPaidAccess`)**:
   - Mutant A1a (dropped `honorsEntitlementStore` in `getEntitlement`): **killed** by `apps/api/src/modules/commerce/premium-entitlement.service.spec.ts` (`TEST_ENV` unset/`staging`/`production`/`qa`).
   - Mutant A1b (dropped `honorsEntitlementStore` in `hasPaidAccess`): **killed** by `apps/api/src/modules/commerce/premium-entitlement.service.spec.ts`.
   - Mutant A1c (`honorsEntitlementStore` returned `false` even when open): **killed** by `apps/api/src/modules/commerce/premium-entitlement.service.spec.ts` under `TEST_ENV=local` and `TEST_ENV=preview`.
2. **`649acce8` (`transfersUnhonoredStore` gate in `applyTransfer`)**:
   - Mutant A2 (dropped `transfersUnhonoredStore` early return at `billing-webhook.service.ts:739-742`): **killed** by `apps/api/src/modules/commerce/billing-webhook.service.spec.ts` (`TEST_ENV` unset/`staging`/`production`/`qa`).
   - Unreachability claim confirmed: `resolveTransferGainState` (`billing-webhook.service.ts:348`) is module-private and called solely at `billing-webhook.service.ts:761`, after `transfersUnhonoredStore(event, losingRow)` early-returns at `lines 739-742`.
3. **`297c162b` (web `manageEntryFor`)**:
   - Mutant A3 (`test_store` mapped to `'store'` instead of `'none'` in `apps/web/src/app/components/subscription-section.tsx:172-177`): **killed** by `apps/web/src/app/components/subscription-section.test.tsx`.

---

## Part B Security & Check-Integrity Audit

1. **No macOS jobs on PR or push**:
   - Confirmed across `.github/workflows/`: `ios-native.yml` (`schedule`, `workflow_dispatch`), `ios-native-canary.yml` (`schedule`), and `watchos-native.yml` (`schedule`, `workflow_dispatch`) have no `pull_request` or `push` triggers; `pr-accessibility-focus.yml:187` and `pr-share-native-unit.yml:41` gate their `macos-15` jobs with `github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'`. `ios-live-font` (`ios-native-jobs.yml:1039`) runs on `macos-26` only from the nightly/dispatch `ios-native.yml` path (`!inputs.ios26-canary`).
2. **Test-only keystore isolation (`c5900c1f`, `e1e1df27`)**:
   - `apps/mobile/plugins/with-minified-debuggable.js:46-111` assigns `signingConfigs.pinnedTest` (`couturecast-test-only.keystore`, CN `CoutureCast test-only debuggable builds (never release)`) strictly to `buildTypes.debug` and `buildTypes.minifiedDebuggable` (`debuggable true`, `src/debug/AndroidManifest.xml`), leaving `buildTypes.release` untouched.
   - Verified SHA-256 `bb0e9edef61334bbc98c133a85200ad218f1eebfd9828cceaf7d71dddcf87df3` matches `.gitleaks.toml:19` exact-line allowlist (only the digest constant in `with-minified-debuggable.test.js` is allowlisted).
   - `revenuecat-key-hygiene.mjs:127-132` blocks any non-`development` EAS profile from running `/debug/i` Gradle commands (`assembleMinifiedDebuggable` included).
3. **Secrets in logs or uploads**:
   - `ios-live-font` (`.github/workflows/ios-native-jobs.yml:1124-1148`) runs `native-ios-app-secret-scan.mjs "$RUNNER_TEMP/live-font-ios" "$CC68_HARNESS_DIR"` before uploading `ios-live-font-proof` (`if: ${{ !cancelled() && steps.live_font_scan.outcome == 'success' }}`). Scan fails closed on empty dirs (`line 70`), non-`anon` JWTs (`lines 62,71`, catching signed-in user session JWTs), and owned env values >=16 chars (`lines 59,72`). Supabase logs run through `redactLogText` (`scripts/ci/native-supabase.mjs:950-966`), and `public-evidence/` is selected explicitly.
   - `revenuecat-bundle-scan.mjs` + `pr-checks.yml:538-541` supplies synthetic `test_ci0synthetic0key0000`, prints matching relative filenames only (`line 139`), exports both `production` (`all`) and `preview` (`ios`, `android`, `__DEV__` false), and scans raw `.hbc`/bundle bytes for both the env key and `TEST_KEY_PATTERN` (`/test_[A-Za-z0-9]{16,}/`) without requiring a leading boundary (`revenuecat-key-hygiene.mjs:33`).
4. **Can checks pass while broken?**:
   - `ios-live-font` (`ios-native-jobs.yml:1111-1118`): `run-live-font-proof.mjs --build release` exits nonzero on failure without `continue-on-error: true`; `native-ios-startup-probe.mjs --app` accepts only `DEV_CLIENT_APP` or `RELEASE_APP`.
   - `dev-client-timeout.yaml` (`maestro/network-timeout/dev-client-timeout.yaml:51-86`): verifies Retry renders skeleton, remains pending (and `hero-error-state` absent) after an 8s wait, then transitions to `hero-error-state` within 20s without `stale-cache-banner`.
   - `minified-debuggable-evidence.mjs`: requires `application-debuggable` in APK badging, package-scoped `DEBUGGABLE` in `dumpsys`, non-empty R8 `mapping.txt`, and probe `<pkg>.R$drawable` removed or renamed.
   - `native-session-storage.test.ts` (`5603b2a7` U-04): pins literal `couturecast.auth-session`, distinct `keychainAccessible: 1` across whole & chunked writes, journal/chunk/manifest key names, backwards-compatible chunked restore, and `signOutNativeSession` deletion of session + `-code-verifier`.

---

## Checks Executed (Post-Read at `9791c5bb` + Mutants at `b0a2dd3f`)

- `node --test scripts/ci/ios-native-workflow.test.mjs scripts/ci/native-ios-startup-probe.test.mjs scripts/ci/android-release-abis.test.mjs scripts/ci/revenuecat-key-hygiene.test.mjs scripts/ci/revenuecat-bundle-scan.test.mjs scripts/ci/lanes.test.mjs scripts/lib/minified-debuggable-evidence.test.mjs scripts/lib/network-tarpit.test.mjs apps/mobile/plugins/with-minified-debuggable.test.js`: **546 passed, 0 failed, 0 skipped** (8 suites).
- `node --test scripts/ci/coverage-shards.test.mjs scripts/ci/lanes-wiring.test.mjs`: **22 passed, 0 failed, 0 skipped**.
- `node scripts/ci/maestro-check-flows.mjs`: **41 flows accepted** (exit 0).
- `npx --workspace=api vitest run src/modules/commerce/`: **36 test files passed, 641 passed, 0 failed, 0 skipped** (integration specs against live PostgreSQL were not run; unit specs used mocked Prisma/env stubs).
- `npx --workspace=web vitest run src/app/components/subscription-section.test.tsx`: **1 file passed, 21 passed, 0 failed, 0 skipped**.
- `npx --workspace=mobile vitest run src/lib/native-session-storage.test.ts src/lib/revenuecat-key.test.ts src/screens/hero-experience.test.tsx`: **3 files passed, 33 passed, 0 failed, 0 skipped**.

REVIEW-615-R6-DONE
