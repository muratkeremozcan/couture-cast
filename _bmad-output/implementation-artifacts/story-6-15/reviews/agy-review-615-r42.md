# Story 6.15 Code & Security Review — Round 42 (`e659829f..b0bd7215`)

- **Base / Head**: `e659829f..b0bd7215` (plus `bb746e3e`, `8b31e55e`) on `/Users/murat/opensource/cc/couture-cast-wt-615` (`HEAD = b0bd7215`)
- **Workspace hygiene**: Read-only on shared tree (`git status -s` unchanged); all test runs, probes, and mutants ran in detached `/tmp/wt-615-mutant-r42` and isolated Postgres `agy615` (`127.0.0.1:55481`), both torn down and pruned cleanly (`PORT_55481_CLOSED`).
- **Codex Security scan**: Completed Phases 1–4 + sealed contract under `/private/tmp/codex-security-scans/couture-cast-wt-615/b0bd7215_r42/report.md` (finalized cleanly via `finalize_scan_contract.py`: 2 `low` CI gate findings, 1 `ignore`/rejected correctness edge case).

---

## Findings (P0–P3)

### P2 — `clipRect` ignores scroll axis and clips scroll views taller/wider than the window
- **Locations**:
  - `apps/mobile/modules/text-layout-probe/android/src/main/java/expo/modules/textlayoutprobe/TextLayoutSnapshot.kt:238-252` (`cuts`), `325-330` (`cutInto`)
  - `apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeWire.swift:90-113` (`cuts`, `cutInto`)
- **Failure scenarios**:
  1. **Visibly cut text on the non-scrolling axis passes (false negative)**: Neither Android (`isScrollView`) nor iOS (`ancestor.isScrollView`) distinguishes vertical scroll views (`ScrollView`) from horizontal scroll views (`HorizontalScrollView` / horizontal `UIScrollView`), nor horizontal clipping on vertical scroll views. Setting `viewport = ancestor.rect` opens any matching ancestor/window edge on **both** axes. In `SWIFT_P1_HORIZ_CLIP_Y` (`Wire.cuts`), text `(10, 100, 200, 80)` inside a scroll container `(0, 100, 390, 40)` reported `visible = (10, 100, 200, 40)` while keeping `clip = (10, 100, 200, 80)` — even though a horizontal scroll container cannot scroll vertically to reveal the clipped bottom 40 pt. Symmetrically (`SWIFT_VERT_SCROLL_CUTS_HORIZ`), a vertical scroll container width `200` clipping width-`300` text reported `visible = (0, 100, 200, 30)` and `clip = (0, 100, 300, 30)`. Because `scripts/lib/live-font-scale-proof.mjs:390` (`contentClipped`) judges `contentRect` against `clipRect`, visibly clipped text on the non-scrolling axis passes.
  2. **Scrollable content inside a scroll view extending past the window edge is falsely clipped (false positive)**: `cutInto(window, viewport)` only opens an edge when `rect.edge == viewport.edge` (`>` / `<` check passes `rect` unchanged when `viewport` extends beyond `window`). In `SWIFT_P5_SCROLL_WIDER_THAN_WINDOW`, window `(0, 0, 390, 844)`, scroll container `(0, 0, 450, 400)`, and text `(360, 100, 60, 30)` produced `clip = (360, 100, 30, 30)` — cutting `clipRect` at `window.maxX = 390` even though `390..420` is inside the scroll viewport and scrollable into view. The same vertical cut occurs on Android (`TextLayoutSnapshot.kt:252`) and iOS (`TextLayoutProbeWire.swift:101`) whenever a scroll view extends past `window.bottom` or `window.top`.
  - *(Minor related notes verified: Android `isScrollView` also skips `ancestorClips` on the scroll view itself (`TextLayoutSnapshot.kt:240-243`), ignoring `clipToPadding`; iOS updates `viewport` even when `ancestor.clips == false` (`TextLayoutProbeWire.swift:93`); nested scroll views with an intermediate clipping container smaller than inner/outer scroll views still cut `clipRect` at that container as explicitly tested in `aClippingContainerSmallerThanItsScrollViewCutsTheClipRect`.)*

### P3 — `junit-report-check.mjs` strips comments before CDATA, allowing unmatched markers in CDATA to hide `<failure/>` elements
- **Location**: `scripts/ci/junit-report-check.mjs:52-53`
- **Failure scenario**: `junitReportProblems` runs `.replace(/<!--[\s\S]*?-->/g, '')` (`L52`) before `.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')` (`L53`) and leaves processing instructions (`<?...?>`) untouched. In probe `C1b`:
  `<testsuite name="s" tests="2" failures="0" errors="0" skipped="0"><testcase name="t1"><system-out><![CDATA[<!--]]></system-out></testcase><testcase name="t2"><failure message="REAL"/><system-out><![CDATA[-->]]></system-out></testcase><testcase name="t3"/></testsuite>`
  comment removal spans from `<!--` in test 1's `<system-out>` CDATA to `-->` in test 2's CDATA, erasing `<failure message="REAL"/>` and `<testcase name="t2">`, so `junitReportProblems(xml, 's', 1)` returns `[]` (pass). Conversely (`Probe C4`), `<testcase name="t1"><?pi <failure/> ?></testcase>` yields `['case t1: failure']`. Replacing the two sequential `.replace()` calls with a single left-to-right alternation `/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g` handles both CDATA-inside-comment (`Probe C7`) and comment-delimiters-inside-CDATA (`Probe C1b`).

### P3 — `revenuecat-key-hygiene.mjs` omits EAS profile `env` overrides from `${VAR}` expansion and lacks a `keyHygieneProblems` test for `expo-cli-first`
- **Locations**:
  - `scripts/ci/revenuecat-key-hygiene.mjs:211-227` (`resolvedEnvProblems`), `234-235`
  - `scripts/ci/revenuecat-key-hygiene.test.mjs:241-267`
- **Failure scenario**: `resolvedEnvProblems` starts `resolveBuildEnv(root, { mode, order, rootFiles })` from `{}` without seeding `eas.json` profile `env` blocks (`env`, `ios.env`, `android.env`) or per-profile `NODE_ENV` overrides (which change `app.config.ts` root file selection between `.env.prod` and `.env.preview`). In `Probe A2`, setting `eas.json` `production.env.RC_PART = "test_AbCd"` (<10 chars after `test_`, below `TEST_KEY_PATTERN`) and `apps/mobile/.env.production` `EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY=${RC_PART}EfGhIjKlMnOp` returned `keyHygieneProblems == []`, even though EAS Build + `@expo/env` resolves the full `test_` key. *(Mitigated on PRs by `revenuecat-bundle-scan.mjs`, which scans compiled export bytes.)* Additionally, mutant `M2a` (dropping `'expo-cli-first'` from line 218) **survived** `revenuecat-key-hygiene.test.mjs`, because no test asserts a key leakage through `keyHygieneProblems` that only `'expo-cli-first'` catches.

### P3 — `revenuecat-client.ts` treats empty or non-array `non_subscriptions[productId]` as permanent `non_subscription`
- **Location**: `apps/api/src/modules/commerce/revenuecat-client.ts:163`, `392-399`
- **Failure scenario**: `revenueCatSubscriberEnvelopeSchema` accepts `non_subscriptions: z.record(z.string(), z.unknown()).optional()`, and `if (ownEntry(non_subscriptions, productId) !== undefined)` (`L394`) immediately throws `RevenueCatUnrepresentableEntitlementError('non_subscription')` -> `permanentLedgerProjectionFailure` returns `{ reason: 'non_subscription' }`, causing `driftSweep` to stamp `drift_settled_at`. In `Probe B (empty_non_sub_array)`, `{ entitlements: { premium: { expires_date: null, product_identifier: 'premium_lifetime' } }, subscriptions: {}, non_subscriptions: { premium_lifetime: [] } }` triggered permanent `non_subscription` instead of requiring at least one purchase record (or treating malformed/empty entries as transient `RevenueCatResponseShapeError`).

---

## Focus Review Notes

1. **Replaced assertions (r38 root-file reference & `no subscription record`)**: Both updates accurately reflect runtime behavior. `apps/mobile/app.config.ts:16` uses `dotenv.config` without `dotenv-expand`, so unreferenced root variables containing `${...}` remain literal strings unless expanded by `apps/mobile/.env*` via `@expo/env` (verified in `Probe A1`, where `apps/mobile/.env.production` referencing root `SPLIT_KEY` is still caught). Moving a missing `subscriptions[productId]` entry (when absent from `non_subscriptions`) from `unsupported_store` to transient `RevenueCatResponseShapeError` prevents permanent settlement on key-format changes (`renamed_subscription_key_format`).
2. **`@expo/env` & CI/process env**: Installed `@expo/env` version (`2.0.12`) matches `@expo/cli`'s resolved `@expo/env` (`/Users/murat/opensource/cc/couture-cast-wt-615/node_modules/@expo/env/build/index.js`). `getEnvFiles` modes (`production`, `preview`, `development`) all match `mobileEnvFileScope`. Process env and EAS server secrets are out of scope for static file hygiene and are covered downstream by `revenuecat-bundle-scan.mjs`.
3. **RevenueCat v1 response handling**: Unrelated sibling entitlements/subscriptions (`unrelated_sibling`), omitted `non_subscriptions`, optional `unsubscribe_detected_at`/`billing_issues_detected_at`, uppercase `store: "PROMOTIONAL"`, and inherited prototype keys (`__proto__` / `constructor`) behave as designed; missing required fields (`expires_date`, `product_identifier`, `store`) return transient 503 `RevenueCatResponseShapeError`. Unknown string `store` values (`rc_billing`) intentionally map to permanent `RevenueCatUnsupportedStoreError`.
4. **TypeScript checks (`tsc --noEmit`)**: Passed cleanly across `apps/api`, `apps/mobile`, `packages/db`, and `packages/api-client` (0 errors).

---

## Checks & Mutant Kill Summary

| Check / Suite | Scope & Result |
| --- | --- |
| `npx tsc -p <pkg>/tsconfig.json --noEmit` | `apps/api`, `apps/mobile`, `packages/db`, `packages/api-client`: **pass (0 errors)** |
| `node --test scripts/ci/{junit-report-check,revenuecat-key-hygiene,revenuecat-bundle-scan}.test.mjs` | **30 / 30 passed** |
| `npx --prefix apps/api vitest run src/modules/commerce/revenuecat-client.spec.ts` | **56 / 56 passed** |
| `npx --prefix packages/db vitest run test/commerce-seed.spec.ts` (isolated DB `agy615:55481`) | **12 / 12 passed** |
| Android Robolectric (`Gradle 8.14.3` + `temurin-21`) + `junit-report-check.mjs` | **pass** (`TextLayoutSnapshotTest` >= 18, `TextLayoutProbeWireTest` >= 12, 0 failed/skipped) |
| `swift test --package-path apps/mobile/modules/text-layout-probe/ios` | **17 / 17 passed** |

| Mutant | Outcome | Notes |
| --- | --- | --- |
| `M1a_junit_no_comment_strip` | **KILLED** | `junit-report-check.test.mjs` failed |
| `M1b_junit_no_cdata_strip` | **KILLED** | `junit-report-check.test.mjs` failed |
| `M1c_junit_ignore_case_problems` | **KILLED** | `junit-report-check.test.mjs` failed |
| `M2a_hygiene_single_order_only` | **SURVIVED** | `resolvedEnvProblems` dropping `'expo-cli-first'` passed `revenuecat-key-hygiene.test.mjs` |
| `M2b_hygiene_skip_preview_mode` | **KILLED** | `revenuecat-key-hygiene.test.mjs` failed |
| `M3a_rc_strict_all_subscriptions` | **KILLED** | `revenuecat-client.spec.ts` failed (`unrelated_sibling`) |
| `M3b_rc_missing_sub_as_unsupported_store` | **KILLED** | `revenuecat-client.spec.ts` failed (`renamed_subscription_key_format`) |
| `M4_seed_keep_drift_settled` | **KILLED** | `commerce-seed.spec.ts` failed (`6.15-DB-001`) |
| `M5a_android_cut_clip_at_window` | **KILLED** | `TextLayoutSnapshotTest` failed |
| `M5b_swift_cut_clip_at_window` | **KILLED** | `TextLayoutProbeRulesTests` failed |

REVIEW-615-R42-DONE
