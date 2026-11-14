# Review Report: tea615 Round 40 (`66304447..9357f4b9` + `9e0cea34`, `3dccf698`, `b4d334f1`)

- **Repository**: `/Users/murat/opensource/cc/couture-cast-wt-615` (read-only; `git status -s` clean; shared `node_modules/.prisma/client` untouched)
- **Ranges reviewed**: Billing `66304447..9357f4b9` (`663ebcbf`, `6fb13b9a`, `9357f4b9`) + `9e0cea34`; CI `3dccf698` + `b4d334f1`
- **No findings above P2.** No exploitable security regressions.

---

## Findings (P0–P3)

### [P2] Cross-file precedence inversion in `revenuecat-key-hygiene.mjs` misses `test_` keys resolved by `app.config.ts` and `@expo/env`
- **Location**: `scripts/ci/revenuecat-key-hygiene.mjs:69-74`, `scripts/ci/revenuecat-key-hygiene.mjs:176-182`, `scripts/ci/revenuecat-key-hygiene.mjs:209-211`
- **Failure scenario**:
  - At build time with `NODE_ENV=production`, `apps/mobile/app.config.ts:14-17` loads `.env.local`, `.env.prod`, and `.env` with `override: false`, so `.env.local` wins over `.env.prod` which wins over `.env`, and both populate `process.env`. Next, `@expo/env/build/index.js:105-110, 138, 196-200, 222-227` parses `apps/mobile/.env*` and never lets mobile `.env*` files overwrite `systemEnv` (`process.env`).
  - `buildEnvContext` (`scripts/ci/revenuecat-key-hygiene.mjs:176-182, 209-211`) instead merges `rootFiles` forward via `Object.assign(context, parseEnvFile(file))` and then merges `readdirSync(mobile)` after root files, letting `.env` overwrite `.env.local` and `.env.prod`, and letting `apps/mobile/.env*` overwrite root files. Also, `readEnvEntries` (`L69-74`) deletes keys present in the target file from `processEnv`, whereas `@expo/env`'s `expandEnvFromSystem` lets root `process.env` win over the mobile file.
  - **Probe evidence (`3A`, `3D`)**:
    - Probe `3A`: `.env.local` sets `RC_PART=test_12345678`, `.env` sets `RC_PART=live_12345678`, `apps/mobile/.env.production` sets `EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY=${RC_PART}90abcdef`. `keyHygieneProblems()` returned `[]` (pass), while `app.config.ts` + `@expo/env` (`mode: 'production'`) resolved `EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY="test_1234567890abcdef"`.
    - Probe `3D`: `.env.prod` sets `RC_PART=test_12345678`, `apps/mobile/.env` sets `RC_PART=live_12345678` + `EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY=${RC_PART}90abcdef`. `keyHygieneProblems()` returned `[]`, while `@expo/env` (`mode: 'production'`) resolved `"test_1234567890abcdef"`.
  - Mitigated downstream by `revenuecat-bundle-scan.mjs` on exported Hermes bundles, leaving this a static pre-export CI gate bypass (P2).

### [P3] `revenueCatSubscriberResponseSchema` validates unrelated sibling records globally while a `subscriptions` key mismatch still hits `RevenueCatUnsupportedStoreError`
- **Location**: `apps/api/src/modules/commerce/revenuecat-client.ts:153-176`, `apps/api/src/modules/commerce/revenuecat-client.ts:371-377`, `apps/api/src/modules/commerce/revenuecat-client.ts:248-252`
- **Failure scenario**:
  - `revenueCatSubscriberResponseSchema` uses `z.record(z.string(), ...)` across all entries of `subscriber.entitlements` and `subscriber.subscriptions`. In probe `unrelated_sibling_entitlement_missing_expires_date`, a valid `premium` entitlement whose sibling `entitlements.beta_perk` omits `expires_date` triggers `RevenueCatResponseShapeError` (`subscriber.entitlements.beta_perk.expires_date: invalid_type`) and keeps that member pinned at 503 on refresh.
  - Conversely, if RevenueCat keys `subscriber.subscriptions` by anything other than `product_identifier` (probe `renamed_subscription_key_format`), or for a `non_subscriptions` purchase (`lifetime_in_non_subscriptions_only`), schema validation passes and `Object.hasOwn(subscriptions, productId)` (`L372`) yields `undefined`, throwing `RevenueCatUnsupportedStoreError(null)` (`permanentLedgerProjectionFailure` -> `{ reason: 'unsupported_store', store: null }`), classifying a response-key change as permanent rather than transient. (Renaming optional `unsubscribe_detected_at` / `billing_issues_detected_at` silently defaults `willRenew` / `status` without triggering any error.)

### [P3] `junit-report-check.mjs` regex check matches inside CDATA/XML comments and misses `<testcase>` child `<failure>`/`<error>`/`<skipped>` elements
- **Location**: `scripts/ci/junit-report-check.mjs:18-48`
- **Failure scenario**:
  - All r39 probes pass in `3dccf698` / `b4d334f1` (multi-suite failing second suite, truncated open tag, self-closing `<testsuite/>`, renamed suite class, `<testsuites>` wrapper), and every caller passes the right class/count (`pr-modal-system-bars.yml:97-98`, `pr-share-card-native.yml:255,494`, `pr-task-manager-migration.yml:91-92`).
  - However, `junitReportProblems` scans raw `xml` without stripping CDATA or comments and inspects counts only on `<testsuite>` attributes:
    - Probe `4a` (CDATA in `<system-out>`) and `4b` (XML comment `<!-- <testcase .../> <testsuite .../> -->`) trigger false failures or allow commented/CDATA `<testcase>` strings to pad `cases === tests`.
    - Probe `4c` (`<testsuite name="..." tests="2" skipped="0" failures="0" errors="0">` with `<testcase><failure .../></testcase>` and `<testcase><skipped/></testcase>`) returns `[]` (exit 0).

---

## Focus Area Verification

1. **Confirmed sync & `drift_settled_at` (`9e0cea34`, `663ebcbf`)**:
   - All confirmed sync updates in `apps/api/src/modules/commerce/premium-entitlement.service.ts` clear `drift_settled_at: null` (`applyLedgerEvent` update at `L314`, `applyLedgerSnapshot` already-expired update at `L369`, `applyLedgerSnapshot` upsert update at `L414`; creates default `null`). (Dev-only `packages/db/prisma/seeds/commerce.ts:552-561` updates `synced_at` without resetting `drift_settled_at`.)
   - `settleUnrepresentableRow` (`billing-reconciliation.service.ts:243-265`) updates only `drift_settled_at` under `synced_at: { lt: staleBefore }` and `notSettledSince(staleBefore)`, logging only when `settled.count > 0`. No production path moves `synced_at` without ledger confirmation.
   - **Backlog > 500 probe** (against `agy615` Postgres 55481 with 502 rows): `recon.sweep()` pulled `500` rows, started with `probe-fresh-oldest` (`drift_settled_at: null`, oldest `synced_at`), processed all 500 unsettled rows, deferred `probe-resettled-oldest` (settled 30h ago) behind them, and excluded `probe-settled-recent` (settled 10h ago).
   - **Migration & Supabase**: `20261114120000_premium_entitlement_drift_settled_at/migration.sql` is strictly additive (`ADD COLUMN "drift_settled_at" TIMESTAMP(3);`); prior `ENABLE ROW LEVEL SECURITY` and `REVOKE ALL ON TABLE public."PremiumEntitlement" FROM authenticated, anon` (`20260812090000_add_premium_subscription/migration.sql:167-168`) remain intact with no grant/policy gap.

2. **RevenueCat shape gate (`apps/api/src/modules/commerce/revenuecat-client.ts`)**:
   - Probed legitimate v1 shapes: `no_entitlements` -> `null`; `non_subscriptions_only_no_entitlement` -> `null`; `promotional_grant_timed` (`store: 'promotional'`) -> `active`; `sandbox_app_store` -> `active`; `promotional_grant_lifetime` -> `RevenueCatUnrepresentableEntitlementError('no_expiry')` (permanent, expected for non-null `current_period_end`).
   - PII hygiene probe (`pii_in_failing_field` with `subscriber_attributes.email` and numeric invalid types): `RevenueCatResponseShapeError.message` and `logger.error({ issues })` emit schema key paths and Zod codes only, never subscriber attribute values or failing field values.

3. **Key hygiene (`scripts/ci/revenuecat-key-hygiene.mjs`)**:
   - `dotenv-expand` behavior probed (`3B`, `3C`): resolves within-file/multi-hop chains (`3B` caught `${RC_B}90abcdef`), `${VAR:-fallback}`, unresolved `${DOES_NOT_EXIST}` -> `''`, and `\${...}` escape -> literal.
   - Precedence bug detailed in P2 above (`3A`, `3D`).

4. **`junit-report-check.mjs` & callers (`3dccf698`, `b4d334f1`)**:
   - r39 probes + `<testsuites>` wrapper (`4d`) pass; workflow class names (`ModalSystemBarsTest`, `PersistedTaskConsumersTest`) verified against Kotlin sources (`ModalSystemBarsTest.kt:1,18`, `PersistedTaskConsumersTest.kt:1,34`). CDATA/comment/child-tag gaps detailed in P3 above.

5. **Replaced / loosened assertions in range**:
   - `billing-reconciliation.service.spec.ts` / `premium-reconciliation.integration.spec.ts` tightened assertions from `synced_at` advancement on unrepresentable rows to `synced_at` unchanged + `drift_settled_at` stamped + later confirmed sync clearing `drift_settled_at`.
   - `billing-webhook.service.spec.ts` (`9357f4b9`) strengthened TRANSFER store-less assertions by pinning exact captured log lines (`unhonored` info, no gain-skipped warning).
   - `junit-report-check.test.mjs` kept all pass/fail invariants and added suite-name, tag-balance, self-closing, and `<testcase>` count equality assertions. No weakened assertions found.

6. **`tsc --noEmit` (`apps/api` and `packages/db`)**:
   - `npx tsc -p apps/api/tsconfig.json --noEmit`: exit `0` (0 errors).
   - `npx tsc -p apps/api/tsconfig.build.json --noEmit`: exit `0` (0 errors).
   - `npx tsc -p packages/db/tsconfig.json --noEmit`: exit `0` (0 errors).

---

## Mutants Tested (in detached `/tmp/wt-615-mutant-r40`, reverted & removed after)

| Mutant | Change | Result | Killing test(s) |
|---|---|---|---|
| `M1_clear_drift_settled_at_event` | Drop `drift_settled_at: null` in `applyLedgerEvent` | **KILLED** | `premium-entitlement.service.spec.ts` (2), `premium-reconciliation.integration.spec.ts` (1) |
| `M2a_settle_log_count0` | Log settle when `settled.count === 0` | **KILLED** | `billing-reconciliation.service.spec.ts` (1) |
| `M2b_orderBy_no_nulls_first` | Drop `nulls: 'first'` on `drift_settled_at` orderBy | **KILLED** | `billing-reconciliation.service.spec.ts` (1) |
| `M3_bypass_rc_zod_gate` | Bypass `revenueCatSubscriberResponseSchema.safeParse` | **KILLED** | `revenuecat-client.spec.ts` (6) |
| `M4_transfersUnhonoredStore_false` | Short-circuit `transfersUnhonoredStore` to `false` | **KILLED** | `billing-webhook.service.spec.ts` (4) |
| `M5_skip_dotenv_expand` | Return unexpanded `parsed` in `readEnvEntries` | **KILLED** | `scripts/ci/revenuecat-key-hygiene.test.mjs` (2) |
| `M6_junit_skip_case_count` | Disable `cases !== tests` check | **KILLED** | `scripts/ci/junit-report-check.test.mjs` (3) |
| `M7_clear_drift_settled_at_expired_pull` | Drop `drift_settled_at: null` in already-expired pull update | **KILLED** | `premium-entitlement.service.spec.ts` (1) |
| `M8_clear_drift_settled_at_active_pull` | Drop `drift_settled_at: null` in active/grace pull upsert | **KILLED** | `premium-entitlement.service.spec.ts` (1) |

---

## Verification Runs

- `node --test scripts/ci/junit-report-check.test.mjs scripts/ci/revenuecat-key-hygiene.test.mjs`: **19 passed, 0 failed, 0 skipped**.
- Commerce Vitest unit specs (`src/modules/commerce/`): **36 test files passed, 706 passed, 0 failed**.
- Billing Vitest integration specs against isolated `agy615` (`postgres:17-alpine`, port `55481`, stopped & cleaned after):
  `premium-subscription.integration.spec.ts` (62) + `premium-reconciliation.integration.spec.ts` (56) = **2 test files passed, 118 passed, 0 failed**.
- **Codex Security scan** (`/private/tmp/codex-security-scans/couture-cast-wt-615/9e0cea34_r40/report.md`): Completed diff scan across 20 diff/supporting files; **0 exploitable security findings** (`delegated_workers` and `goal_tools` `unknown` in CLI preflight; parent-agent exhaustive diff coverage completed).

REVIEW-615-R40-DONE
