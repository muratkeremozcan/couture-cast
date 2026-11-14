# Story 6.15 Code & Security Review — Round 8

- **Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615` (`8c521f44`, tested at `a2b04887`, strictly read-only)
- **Range**: `70745735..8c521f44` (`da2fcf31`, `b28139d7`, `3b85992f`, `77dbdbcb`, `a371d4ed`, `ce92e8f4`, `7e2bf3c9`, `8c521f44`, plus R7 `ca4a532f`)
- **Secret handling**: No `.env` files or secret values were read.

## Summary Verdict

No **P0** or **P1** findings. One **P2** (`revenueCatSurvival` silently accepts a missing `usage.txt` inside `collectEvidence`), two **P3** notes (`resolvedAppConfig` inheriting ambient `process.env`; CX-06 S4-15 launch crash inferred from `dexdump` + `ModuleRegistry.kt` and not yet executed on a device). All six R6/R7 closures (`ca4a532f`, `da2fcf31`, `b28139d7`, `3b85992f`, `77dbdbcb`, `a371d4ed`) were verified with targeted mutants, including both **gate open** (`TEST_ENV=local|preview`) and **gate closed** (`TEST_ENV=undefined|staging|production`) for `77dbdbcb` and `a371d4ed`.

---

## Findings (Ranked P0–P3)

### P2-1 — `revenueCatSurvival` / `collectEvidence` can pass when R8 strips RevenueCat classes or members if `usage.txt` is missing or omitted

- **Location**: `scripts/lib/minified-debuggable-evidence.mjs:132-146, 259-261, 275`
- **Mechanism**:
  - `collectEvidence` (`lines 259-261`) requires only `[apk, mapping]` to exist on disk; at `line 275`, when `usage` is omitted or the file is missing, it silently substitutes `''` (`const usageText = usage && fs.existsSync(usage) ? fs.readFileSync(usage, 'utf8') : ''`).
  - `revenueCatSurvival` (`lines 132-146`) defaults `usage = ''` and relies _exclusively_ on `usage.txt` (`line 143`) to detect R8 removal of `com.revenuecat.*` classes outside the two required names (`com.revenuecat.purchases.Purchases`, `com.revenuecat.purchases.hybridcommon.CommonKt`) or stripped members inside them.
- **Concrete failure scenario**: If an AGP build does not emit `usage.txt` at the expected path (or a caller omits `--usage`), and R8 keeps `Purchases` and `CommonKt` by name while stripping internal classes (e.g., `CustomerInfo`, `Offerings`) or bridge-called methods, `mapping.txt` still contains both named classes and nothing reads the missing `usage.txt`. `collectEvidence` exits `0` and reports `{ keptClasses: 2, required: ['com.revenuecat.purchases.Purchases', 'com.revenuecat.purchases.hybridcommon.CommonKt'] }`.
  - **Reproduced empirically** against `collectEvidence` with a stripped `mapping.txt` (containing only `Purchases` and `CommonKt`) and a nonexistent `missing-usage.txt` path -> exited `0` and returned `{ keptClasses: 2, required: [...] }`.
- **Suggested fix**: Require `usage` to exist on disk in `collectEvidence` alongside `[apk, mapping]` (`line 259`), or reject missing/unreadable `usage` when running R8 survival verification.

### P3-1 — `resolvedAppConfig` spreads ambient `process.env` during local ABI checks

- **Location**: `scripts/ci/android-release-abis.mjs:412-434` (`line 426`)
- **Mechanism**: `resolvedAppConfig` passes `env: { ...process.env, NODE_ENV: 'production', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1' }` to `expo config --json --type introspect`, while `apps/mobile/app.config.ts` loads repo `.env.local`/`.env` and reads build-flavor env flags.
- **Concrete failure scenario**: On a developer workstation where shell env or `.env.local` sets dev/test build flags that alter `app.config.ts` plugins, `resolvedAppConfig` evaluates that ambient dev config rather than a clean release environment, producing false failures or false passes locally compared to CI. (CI itself starts from a clean step env, and clean-env local execution with `env -i PATH="$PATH" HOME="$HOME"` succeeded with zero network or secrets.)

### P3-2 — Pre-prebuild TS minify detection & CX-06 `--android` copy layout assumption

- **Location**:
  - `scripts/lib/minified-debuggable-evidence.mjs:156-176` (`releaseMinifyConfig`)
  - `scripts/lib/cx06-reflection-mutant.mjs:134-142` (`cli` `apply --android`)
- **Concrete failure scenarios**:
  1. `releaseMinifyConfig` reads `app.json` (`expo-build-properties`) and `android/gradle.properties`, ignoring `app.config.ts`. Once prebuild has generated `android/gradle.properties`, `android.enableMinifyInReleaseBuilds=true` catches it; if run against `app.config.ts` only before prebuild, `releaseMinifyConfig` would see `enabled: false` (unless a direct `build.gradle` `minifyEnabled` edit or stale prebuild is the change under test).
  2. `cx06-reflection-mutant.mjs:135` derives `appRoot = path.dirname(path.resolve(value))` when resolving `node_modules/expo-modules-core/package.json`. If a harness copies only `apps/mobile/android` into `/tmp/<dir>/android` without a parent `package.json` + `node_modules`, `expoModulesCoreRules(appRoot)` fails at `createRequire(path.join(appRoot, 'package.json'))`.

---

## Judge Questions

### 1. Can a real Stripe or store purchase over an unhonored `test_store` row lose data the row held that it should keep (product, period, original transaction)?

**No.**

- **Schema check**: `packages/db/prisma/schema.prisma:1537-1561` defines `PremiumEntitlement` with columns `id`, `user_id`, `status`, `store`, `product_id`, `will_renew`, `current_period_end`, `synced_at`, `last_event_occurred_at`, `last_event_id`, `created_at`, `updated_at`. There is **no `original_transaction_id` column** on `PremiumEntitlement`.
- **Overwrite behavior**: Both `applyLedgerEvent` (`apps/api/src/modules/commerce/premium-entitlement.service.ts:275-330`) and `applyLedgerSnapshot` (`lines 352-415`) perform a single-row `upsert` by `user_id` that already replaces `status`, `store`, `product_id`, `will_renew`, `current_period_end`, `synced_at`, `last_event_occurred_at`, and `last_event_id` with the new real purchase's values (`BillingCustomer`, `BillingEvent`, and prior `AuditLog` rows are untouched).
- Treating an unhonored `test_store` row as absent via `honoredRow` (`lines 96-98`) cleanly ensures:
  1. The real purchase emits `from: 'none'`, writes its activation `AuditLog`, and emits activation telemetry.
  2. A stale future `last_event_occurred_at` on an unhonored `test_store` row cannot drop a real webhook event via `shouldApply`.
  3. A `null` snapshot pull cannot overwrite or expire an unhonored `test_store` row.

### 2. Does `3b85992f`'s config resolve (`resolvedAppConfig`) depend on network, secrets, or the dev env?

- **Network**: **No.** `resolvedAppConfig` (`scripts/ci/android-release-abis.mjs:426`) sets `EXPO_OFFLINE: '1'` and `EXPO_NO_TELEMETRY: '1'`.
- **Secrets**: **No.** Verified with `env -i PATH="$PATH" HOME="$HOME" node -e "import('./scripts/ci/android-release-abis.mjs').then(m => { const r = m.resolvedAppConfig(process.cwd()); console.log(Object.keys(r), r.error ?? 'none'); })"` -> `resolved keys: [ 'config' ] error: none`. Output helpers report only config key paths and ABI values (`resolvedConfigProblems`), never env/secret values.
- **Dev env**: **Partially (P3-1).** It spreads `...process.env` (`line 426`), so ambient shell variables (plus `.env.local`/`.env` read by `apps/mobile/app.config.ts`) can influence the evaluated config on a dev machine.

### 3. Is the CX-06 mutant (`7e2bf3c9`) truly the only keeper (`whyareyoukeeping`), and is its expected launch failure proven or only inferred?

- **Only keeper**: Confirmed in repo sources:
  - `apps/mobile/modules/modal-system-bars/android/src/main/java/expo/modules/modalsystembars/ModalSystemBarsModule.kt:1-39` subclasses `expo.modules.kotlin.modules.Module`, has no `@DoNotStrip` annotation, and has no direct Kotlin/Java constructor call in `apps/mobile/`.
  - `node_modules/expo-modules-core/android/proguard-rules.pro` has the single `Module` keep rule (`-keep,allowoptimization,allowobfuscation class * extends expo.modules.kotlin.modules.Module { public <init>(); ... }`), and `cx06-reflection-mutant.mjs:48-58` clears `expo-modules-core`'s `consumerProguardFiles` in a prebuild copy to replace it with the narrowed rule (`!expo.modules.modalsystembars.ModalSystemBarsModule,**`).
- **Expected launch failure**: **Inferred, not yet empirically proven.**
  - Code evidence strongly predicts startup crash: `node_modules/expo-modules-core/android/src/main/java/expo/modules/kotlin/AppContext.kt:120` registers providers via `registry.register(modulesProvider)`, and `ModuleRegistry.kt:46` instantiates each module eagerly with `type.getDeclaredConstructor().newInstance()` (failing with `NoSuchMethodException` when `<init>()` is stripped).
  - However, `_bmad-output/implementation-artifacts/spec-6-15-expo-sdk58-live-font-scale-layout.md:317` explicitly records that R8 stripping `ModalSystemBarsModule.<init>()` was verified via `dexdump`, while the mutant APK is **"not yet run on a device"**.

### 4. Can the RevenueCat survival assert (`ce92e8f4`) pass when RevenueCat is stripped?

**Yes — P2-1 above.** When `--usage` is omitted or `usage.txt` is missing on disk (`scripts/lib/minified-debuggable-evidence.mjs:275`), `revenueCatSurvival` checks only `mapping.txt` for any `com.revenuecat.` entry plus exact-name preservation of `Purchases` and `CommonKt`. Any R8 stripping of sibling `com.revenuecat.*` classes (or methods on `Purchases`/`CommonKt`) goes undetected without `usage.txt`. (When `usage.txt` _is_ present and passed, `revenueCatSurvival` fails on any `com.revenuecat.` class or member line.)

---

## Security Review Lens (`~/.codex/skills/codex-security-review/SKILL.md`)

- **Gate enforcement (`77dbdbcb`, `a371d4ed`)**: Closed-gate (`TEST_ENV` unset / `staging` / `production` / invalid) `applyLedgerEvent` and `applyLedgerSnapshot` treat unhonored `test_store` rows as absent, preventing spoofed or stale `test_store` cursors from blocking real Apple/Google/Stripe events and preventing null snapshots from writing. `correctDrift` filters `{ store: { not: 'test_store' } }` when `honorsEntitlementStore('test_store')` is false. No privilege escalation or unauthorized access path found.
- **Prebuild mutant safety (`7e2bf3c9`)**: `applyMutant` (`scripts/lib/cx06-reflection-mutant.mjs:71-76`) checks `git -C <realpath> rev-parse --is-inside-work-tree` and refuses to modify any git worktree (`cx06_refuses_a_git_checkout`). `gradleBlock` writes JSON-quoted path strings into the non-git prebuild copy's `build.gradle`.

---

## Mutant Verification (Isolated `/tmp/wt-615-mutant-r8`, removed after run)

| Scope            | Mutant                                                                                                                               | Gate / Env                                    | Result                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------- |
| `ca4a532f` (C1)  | Drop `result.controls` loop in `aggregateVerdict` (`scripts/lib/live-font-journey.mjs`)                                              | N/A                                           | **KILLED** (`live-font-journey.test.mjs`, rc=1)             |
| `da2fcf31` (C2a) | Drop `unused` `staleIds` check in `exactnessProblem` (`scripts/lib/live-font-scale-proof.mjs:568-569`)                               | N/A                                           | **KILLED** (`live-font-scale-proof.test.mjs`, rc=1)         |
| `da2fcf31` (C2b) | Weaken `misses.length !== baseline.maxStaleMisses` to `>` (`scripts/lib/live-font-scale-proof.mjs:572`)                              | N/A                                           | **KILLED** (`live-font-scale-proof.test.mjs`, rc=1)         |
| `b28139d7` (C3a) | Make `cyclicGap` non-cyclic `to - from` (`scripts/ci/ios-native-workflow.test.mjs:1771`)                                             | N/A                                           | **KILLED** (`ios-native-workflow.test.mjs`, rc=1)           |
| `b28139d7` (C3b) | Shift `.github/workflows/ios-native-canary.yml` cron to `'00 5 * * *'` (97 min gap < 180 min)                                        | N/A                                           | **KILLED** (`ios-native-workflow.test.mjs`, rc=1)           |
| `b28139d7` (C3c) | Raise `ios-shard` timeout to `135` (`60 + 135 = 195 > 194` gap)                                                                      | N/A                                           | **KILLED** (`ios-native-workflow.test.mjs`, rc=1)           |
| `3b85992f` (C4)  | Drop `resolvedConfigProblems(root)` from `configuredAbiProblems` (`scripts/ci/android-release-abis.mjs:493`)                         | N/A                                           | **KILLED** (`android-release-abis.test.mjs`, rc=1)          |
| `77dbdbcb` (C5a) | Drop `honoredRow(...)` in `applyLedgerEvent` (`premium-entitlement.service.ts:275-277`)                                              | Closed (`undefined`, `staging`, `production`) | **KILLED** (`premium-entitlement.service.spec.ts`, rc=1)    |
| `77dbdbcb` (C5b) | Drop `honoredRow(...)` in `applyLedgerSnapshot` (`premium-entitlement.service.ts:352-354`)                                           | Closed (`undefined`, `staging`, `production`) | **KILLED** (`premium-entitlement.service.spec.ts`, rc=1)    |
| `77dbdbcb` (C5c) | Force `honoredRow` to always return `null` (`premium-entitlement.service.ts:96-98`)                                                  | Open (`local`, `preview`) + existing rows     | **KILLED** (`premium-entitlement.service.spec.ts`, rc=1)    |
| `a371d4ed` (C6a) | Remove `...(honorsEntitlementStore('test_store') ? {} : { store: { not: 'test_store' } })` (`billing-reconciliation.service.ts:186`) | Closed (`undefined`, `staging`, `production`) | **KILLED** (`billing-reconciliation.service.spec.ts`, rc=1) |
| `a371d4ed` (C6b) | Hardcode `{ store: { not: 'test_store' } }` unconditionally (`billing-reconciliation.service.ts:186`)                                | Open (`local`, `preview`)                     | **KILLED** (`billing-reconciliation.service.spec.ts`, rc=1) |
| `ce92e8f4` (N1)  | Drop `shrunk` check in `revenueCatSurvival` (`minified-debuggable-evidence.mjs:144`)                                                 | N/A                                           | **KILLED** (`minified-debuggable-evidence.test.mjs`, rc=1)  |
| `ce92e8f4` (N2)  | Drop `!mappingExists` throw in `releaseR8Status` (`minified-debuggable-evidence.mjs:185`)                                            | N/A                                           | **KILLED** (`minified-debuggable-evidence.test.mjs`, rc=1)  |
| `7e2bf3c9` (N3)  | Make `narrowModuleKeepRule` a no-op (`cx06-reflection-mutant.mjs:41-44`)                                                             | N/A                                           | **KILLED** (`cx06-reflection-mutant.test.mjs`, rc=1)        |

_(Note: mutating inner `Math.max(timeout('ios-shard'), timeout('ios-expo-go'))` to `Math.min` in `ios-native-workflow.test.mjs` alone survived against the committed workflow YAML because `ios-live-font` (`180` min) currently dominates `ios-build + ios-shard` (`60 + 70 = 130` min); `C3c` confirms raising `ios-shard` to `135` (`195 > 194`) is caught by the `Math.max` chain.)_

---

## Test Runs Observed

- **Node suites** (`node --test scripts/lib/live-font-*.test.mjs scripts/ci/ios-native-workflow.test.mjs scripts/ci/android-release-abis.test.mjs scripts/lib/minified-debuggable-evidence.test.mjs scripts/lib/cx06-reflection-mutant.test.mjs`):
  - **605 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo** (`23` suites).
- **API commerce unit specs** (`npx --workspace=api vitest run src/modules/commerce/`):
  - **36 test files passed, 661 tests passed, 0 failed, 0 skipped**.
  - Scope caveat: mocked/unit specs only; PostgreSQL-backed integration specs were not executed in this read-only run.

REVIEW-615-R8-DONE
