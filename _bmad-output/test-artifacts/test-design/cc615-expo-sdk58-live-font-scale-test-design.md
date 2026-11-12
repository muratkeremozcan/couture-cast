---
runScope: 'epic'
runKey: 'epic-6-story-6.15'
workflowStatus: 'complete'
totalSteps: 5
stepsCompleted:
  [
    'step-01-detect-mode',
    'step-02-load-context',
    'step-03-risk-and-testability',
    'step-04-coverage-plan',
    'step-05-generate-output',
  ]
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-11-12'
---

# Test Design: Epic 6, Story CC-6.15 Expo SDK 58 upgrade for live font-scale layout

**Date:** 2026-11-12
**Author:** Murat (TEA), peer of the builder in herdr pane `w0:p1`
**Status:** Planned, aligned with the Codex story review (CX-01 to CX-14) on 2026-11-12. Step 0 background-task tests exist (`3d458bcd`).

**Precedence:** the spec at `_bmad-output/implementation-artifacts/spec-6-15-expo-sdk58-live-font-scale-layout.md` wins wherever this document and the spec disagree.
TEA does not edit the frozen block.
Findings that change a frozen decision are marked (intent) in the spec's Plan Change Log, and the builder applies them.

Inputs read at baseline `a01e0307`:

- The spec draft, `story-6-15/preflight-expo-sdk-58.md`, `epics.md` CC-6.15, and the Story 6.8 facts file `review-font-three-facts.md`, which is untracked in the main checkout.
- Versions: `bundledNativeModules.json` on the `sdk-55` to `sdk-58` branches, read 2026-11-12. RN 0.83.10, 0.85.3, 0.86.3 and 0.88.1 pair with React 19.2.0, 19.2.3, 19.2.3 and 19.3.0. Reanimated 4.2.1, 4.3.1, 4.5.1 and 4.7.1 pair with Worklets 0.7.4, 0.8.3, 0.10.1 and 0.13.0. Every version matches D1.
- Code: `apps/mobile/package.json`, `app.json`, `src/lib/background-fetch.ts` and its test, `components/share-card-composer.tsx`, `components/share-card-tab-heading.test.tsx`, `scripts/lib/story68-release-live-font.mjs`, `story68-cold-font-scale.mjs`, `scripts/run-story68-native.mjs`, `scripts/install-expo-go.mjs`, `scripts/ci/pr-job-ceilings.test.mjs`, and every workflow under `.github/workflows`.
- `node_modules/react-native/React/CoreModules/RCTAccessibilityManager.mm:260-271`: the iOS Dynamic Type multipliers.
- Toolchain on this machine: Xcode 27.2 (27B52), with iOS 26.0 and 26.1 simulator runtimes.
- Knowledge: `probability-impact.md`, `test-priorities-matrix.md`, `test-levels-framework.md`, `selective-testing.md`, `burn-in.md`, `ci-burn-in.md`, `test-quality.md`.
  Library mandates: no new Playwright or Pact code is planned. Any Playwright spec this story touches uses `@seontechnologies/playwright-utils` per the mandate.

---

## Spec review: findings against the real code

Each finding is recorded as TEA-NN in the spec's Plan Change Log with the fix.
The evidence is here.

**TEA-01 (intent; D5, Boundaries, AC4): a version-keyed characterization replaces the named expected failure.**
_Superseded in part by CX-07: below 0.87 the proof classifies and records a per-step baseline (F-09) and no longer requires the exact 6.8 signature._
The draft keeps the live-font proof red under a named expected-failure marker through Steps 0 to 3.
An expected failure cannot tell the known bug from a broken emulator, a sign-in timeout or a crash: every one of them is "red, as expected".
It also needs a `continue-on-error` or a skip somewhere in CI, which Boundaries forbid for every other test.
The fix: the proof reads `fixExpected` from the build identity.
That value is the `react-native` version the build actually bundled, read from `ReactNativeVersion` in the built app (the binary is what runs; `package.json` can drift from it), compared against 0.87.0.

- Below 0.87.0, the proof asserts the exact Story 6.8 bug signature and passes. The text is preserved, the PID is unchanged, and every anchor height is unchanged within 1 px at the new scale. Any other outcome fails: lost nodes, a restart, an error surface, missing anchors, or heights that grow.
- At 0.87.0 or above, the proof asserts the fix (TEA-02).
- The proof never skips and never runs as `continue-on-error`. Every step PR shows it green.
- Two cases turn it red: the bug changes shape before Step 4, or the fix lands early. Either way someone looks.
- Step 4 deletes the below-0.87 branch and its fixtures in the same PR, and a spec asserts the branch is gone.
- In the Never list, "other than the D5 live-font proof's named expected failure in Steps 0 to 3" is deleted.

**TEA-02 (intent; AC3, I/O matrix): "same visible text nodes" fails on a correct build.**
_Superseded by CX-01, CX-02 and R2-05: per-style expected growth from the platform converter replaces the 0.9 scale-ratio floor; Activity, scene and root identity catch recreation, which a same-PID recreation hides from the PID check; and no step requires the SDK 54 signature. The table below is the original contract, kept for history. F-00 is the current one._
`assertReleaseTextPreserved` (`scripts/lib/story68-release-live-font.mjs:33`) compares the full multiset of on-screen text nodes.
UiAutomator and Maestro hierarchies only list nodes visible to the user.
Once layout grows, Home, Community and Settings push nodes below the fold, so a working 0.88 build changes the visible multiset and fails the oracle.
On 0.81.5 the baseline kept 43 nodes only because nothing grew.
The oracle needs these parts, all of which must hold:

| Part        | Assertion                                                                                                                                                                                                                       | Catches                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Anchors     | A fixed per-screen set of `testID` anchors above the fold at 1.5 is present before, immediately after (first frame the harness can read, at most 1 s) and after settling (two equal hierarchy reads 500 ms apart, at most 10 s) | The 6.8 blank-text regression (44 to 5 nodes)                               |
| Full text   | The text multiset collected by scrolling each screen top to bottom is equal before and after settling                                                                                                                           | Lost or duplicated nodes anywhere on the screen                             |
| Cold parity | After settling, every anchor's live height equals its height after a cold launch at the same scale, within 2 px on Android and 1 pt on iOS                                                                                      | Clipping: a stale box differs from the cold box, as 169 px did on main      |
| Growth      | Each single-line anchor's height ratio is at least 0.9 times the scale ratio                                                                                                                                                    | A cold layout that is also wrong, for example a `maxFontSizeMultiplier` cap |
| Process     | PID or iOS process identifier unchanged, and no error surface                                                                                                                                                                   | Restart or recreation hiding the bug                                        |

The oracle is proved before it is trusted.
On SDK 54, a positive control compares a cold launch at 1.0 with a cold launch at 1.5, a layout known to be correct.
The control must pass "Full text" and "Growth".
Then the live change on SDK 54 must fail "Cold parity" and "Growth" with the 6.8 signature.
The frozen AC3 text and I/O rows read "the same anchor set and the same full-screen text, live heights equal to cold-launch heights at that scale".

**TEA-03 (intent; AC3 iOS, I/O matrix): iOS has no 1.5 step.**
`RCTAccessibilityManager.mm:260-271` maps Dynamic Type categories to multipliers: Large 1.0, ExtraExtraExtraLarge 1.353, AccessibilityMedium 1.786.
iOS uses `xcrun simctl ui <udid> content_size` live: `large` to `extra-extra-extra-large` to `accessibility-medium`, then back to `large`.
The Growth ratios use the multiplier actually set.
The "1.5 equivalent" in the I/O matrix becomes "AccessibilityMedium (1.786), with ExtraExtraExtraLarge (1.353) on the way".

**TEA-04 (intent; D1, D6): Step 2 cannot build iOS in CI without the runner move.**
_The local Xcode 27.2 fallback is replaced by CX-05: Steps 2 and 3 build on Xcode 26.x (D14)._
SDK 56 needs Xcode 26.4 or later, and `macos-15` tops out at 26.3.
Seven jobs pin `macos-15`, and no workflow may change before the owner's go.
If the go has not come when Step 2 starts, Step 2 has no CI iOS evidence.
The fix: make the D6 runner move, or its recorded main-plus-nightly fallback, an entry criterion for Step 2.
Until then, iOS Debug and Release builds for Step 2 come from this machine's Xcode 27.2, with the build identity recorded: Xcode version, SDK, `ReactNativeVersion`, and app digest.

**TEA-05 (D9): the PR Maestro suite runs on Expo Go 54.**
`scripts/install-expo-go.mjs:11` pins `Expo-Go-54.0.8.apk`, and `pr-mobile-e2e` plus `ios-expo-go` run the app in Expo Go.
The step after `expo install expo@^55` runs a 55 bundle in a 54 client, and every flow fails on the SDK mismatch.
Each step moves the Expo Go pin to that SDK's latest Expo Go.
A new node test asserts that the Expo Go major equals the `expo` major in `apps/mobile/package.json`.
Expo Go also cannot host the app's local native modules, so AC3 proofs run only on our dev client and Release builds.

**TEA-06 (D5 row 1): the guard spec does not exist.**
No spec asserts that app code stays free of a font-scale wrapper; `git grep` finds no `AppText` and no wrapper guard.
TEA writes `scripts/ci/font-scale-reads.test.mjs`.
It scans `apps/mobile/{app,components,src}` for `fontScale`, `PixelRatio.getFontScale`, `maxFontSizeMultiplier` and `allowFontScaling`.
Only listed sites may use them: `feedbackSlotHeight`, `actionRowTier`, `useActionColumns` in `share-card-composer.tsx`, and their tests.
Each listed site carries its D5 reason.
A seeded `AppText` wrapper must turn the test red.

**TEA-07 (intent; D4 background task): the upgrade path needs its own proof at Step 0.**
_R2-01: on the iOS simulator the upgrade asserts retained state only, because `expo-background-task` rejects registration there before persisting. Registration, scheduler and worker run on a physical iPhone (P0-09)._
`registerBackgroundFetchAsync` skips registration when `TaskManager.isTaskRegisteredAsync` is true (`background-fetch.ts:62-72`).
`expo-task-manager` persists registrations with the consumer class of the module that made them.
These cases need a test:

- If the new code reuses `RITUAL_BACKGROUND_FETCH_TASK`, an upgraded install reads "registered" and never registers with `expo-background-task`. The task is then silently dead.
- Once `expo-background-fetch` is uninstalled, its consumer class is gone. Restoring or unregistering the persisted task on cold start and on boot (`startOnBoot: true`) must not crash.
- On iOS, prebuild must replace `UIBackgroundModes` `fetch` with `processing` and add `BGTaskSchedulerPermittedIdentifiers`.

The draft proves the upgrade only in D7, after Step 4.
Step 0 ships the change to `main`, so Step 0 proves the upgrade from the `a01e0307` build to the Step 0 build on both platforms (P0-07 and P0-08).
D7 proves 54 to 58 again end to end.

**TEA-08 (D7): in-place install over a production build needs one signing identity.**
`adb install -r` refuses a different certificate.
A Play-distributed build is signed with the Play app signing key, which differs from the upload key that `eas build` uses.
Both the SDK 54 "before" build and the SDK 58 "after" build therefore come from the EAS production profile, from the commit last deployed by `deploy-mobile` and from Step 4.
`bundletool` turns each into a universal APK, and the evidence records the certificate SHA-256 of both.
On iOS, `xcrun simctl install` over the same bundle id keeps the data container and keychain, and the evidence records the container path before and after.

**TEA-09 (intent; D6): 10 runs make p95 the maximum.**
With 10 samples, nearest-rank p95 is the 10th value, so "p95 of 15 or less and maximum of 20" reduces to "maximum of 15 or less".
The fix: require 20 consecutive PR runs, or state the criterion as maximum 15 over 10.
TEA recommends 20 runs.
Queue time is also measured two ways:

- The owner's figure is job `started_at` minus run `created_at`. For a job with `needs`, that counts upstream jobs as queue.
- The script records that figure and also job `started_at` minus job `created_at`. The gate uses the owner's figure.

The script is `scripts/ci/pr-job-p95.mjs`, with a node test, and it is the only source for D6 numbers.

**TEA-10 (D9, AC4): device lanes skip on pull requests.**
`pr-share-card-native` device lanes, `pr-accessibility-focus` `ios-app-build`, and the original-resource and evidence jobs have `if: github.event_name != 'pull_request'`.
A step PR can go green without any native journey running on its code.
Until the D6 workflows land, each step's merge gate needs `workflow_dispatch` runs of `pr-share-card-native.yml`, `pr-accessibility-focus.yml` and `watchos-native.yml` on the step branch head SHA.
Their run URLs go in the PR description, and the first nightly on `main` after merge must be green before the next step starts.

**TEA-11 (AC1): "every shipped ABI" is never built in CI.**
CI builds pass `-PreactNativeArchitectures=x86_64` (`pr-accessibility-focus.yml:130`) or the host ABI (`story68-native-build.mjs:130`).
Only EAS builds all four.
Each step runs one all-ABI `bundleRelease`, on a dispatch or locally.
A node script checks the AAB:

- `lib/{arm64-v8a,armeabi-v7a,x86,x86_64}/libreactnative.so`, `libhermes*.so` and `libworklets.so` are all present.
- The `ReactNativeVersion` string matches the step.

**TEA-12 (D4, SDK 56): new runtime surfaces have no device test.**
`expo/fetch` replaces `globalThis.fetch` at SDK 56.
The vitest suites run under Node and MSW, so they never exercise it.
Supabase auth refresh, realtime, PostHog flush and the API client's abort and timeout paths on device are covered only by Maestro flows.
TEA adds a Maestro assertion on the Debug dev-client build that a network timeout surfaces the existing error state.
The localization flows cover the Hermes version moving at each step (Intl polyfills; `Intl.Segmenter` broke all 18 flows once).
That makes `localization.yaml` and `garment-capsule-localization-flow.yaml` mandatory in every step's run.

**TEA-13 (D5 rows 4 and 5): verdicts need a recorded measurement.**
Step 4 records the following for each row:

- Activity recreation (row 4): the `onCreate` count and PID from `adb shell dumpsys activity` before and after a live font change on 0.88. 6.8 recorded that a font change recreates the Activity. If it still does, the restore stays for font too.
- `feedbackSlotHeight` and the action-row tiers (rows 2 and 3): the composer's Save and Share bounds before and after the live change and after a feedback message appears. The bounds must stay put, matching the iPad popover anchor requirement.
- Row 5: `story68-cold-font-scale.mjs` stays as the cold-parity reference that TEA-02 needs, so its verdict is "keep, retargeted to assert growth". Only the "no claim that clipping is fixed" wording and the allowances in `story68-release-live-font.mjs` are deleted.

**TEA-14 (D3): `react-test-renderer` follows React.**
`apps/mobile/package.json:90` pins `react-test-renderer` 19.1.0.
Each step moves it with React (19.3.0 exists on npm).
A node test asserts that `react`, `react-dom`, `react-test-renderer` and `@types/react` majors and minors are identical across every workspace and the lockfile, so D3 is enforced by a test.

**TEA-15 (intent; D5 row 4, AC3 Android): Android recreates the Activity on every system font change.**
The prebuild template's `MainActivity` `android:configChanges` has no `fontScale` in either SDK:

- `expo-template-bare-minimum` 54: `keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode`.
- `expo-template-bare-minimum` 58: the same plus `smallestScreenSize|assetsPaths`.

No plugin in `apps/mobile/plugins` adds `fontScale` (`git grep configChanges` finds nothing), and the Story 6.8 spec records stock Activity recreation on a font change (`spec-6-8-safe-branded-share-card-export.md:1159`).
Under CX-01, a recreated Activity is a restored screen and never a fix.
As planned, every Android run on SDK 58 would therefore classify as a restored screen, and Android AC3 could never pass.
The fix: a config plugin adds `fontScale` to `MainActivity` `configChanges`, so Android delivers `onConfigurationChanged` to the running Activity, which is the path the 0.87 layout fix serves.
A prebuild spec pins the plugin's output (F-12).
The D5 row 4 verdict becomes: the recreation restore stays for locale, permission revocation and memory pressure, and the manifest decides font changes.
TEA-16 decides the step the plugin lands in.

**TEA-16 (D5): an SDK 58 Android spike before the Step 0 proof merges.**
_R2-03 sets the spike's matched pairs, evidence and the manifest delta (SP-01), and the four F-12 mutants._
Run it in a throwaway worktree:

- Build SDK 58 Android Release with and without `fontScale` in `configChanges`.
- Run the live font proof on Home and the composer.
- Repeat on SDK 54 with `fontScale` added.

The spike shows two things:

- AC3 is reachable on Android at all, before four SDK steps are spent.
- Whether adding `fontScale` on 0.81.5 leaves members worse off than today's recreation. Today the layout is already stale, at 169 px. A blank or frozen screen would make it worse.

If 0.81.5 is no worse, the plugin lands in Step 0 and every step measures the live path that AC3 certifies.
Otherwise it lands in Step 4, and Steps 0 to 3 record Android as a restored screen in their baselines.
The outcome and the evidence path go in the Plan Change Log.

**TEA-17 (intent; D4 R8 row, D15): the paid journey never runs under R8.**
Test Store runs only in debuggable builds, and the app's debuggable Android builds are not minified.
Production has no RevenueCat key: `premium.ts:257-300` configures `Purchases` only when `EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY` or `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY` is set, and no env file names one.
So no Release build ever runs RevenueCat native code, and the D4 R8 row's "proved by the D15 paid journey" covers nothing.
The fix: an Android `minifiedDebuggable` build type that initializes from `release`, keeps the release R8 rules, minifies and shrinks resources, and is debuggable.
It is signed with the pinned test keystore (TEA-19), so the Test Store key is accepted and the D15 journey runs under R8 (S4-15).
S4-06's targeted reflection mutant then picks a RevenueCat class reached only by reflection in that variant, plus a PostHog or local-module class in the true Release.
To verify before relying on it: the RevenueCat mutant must turn S4-15 red.
AGP may run R8 differently for a debuggable variant, so a mutant that stays green there means the variant gives no R8 evidence, and RevenueCat under R8 stays only a D11 Google gate.

**TEA-18 (D15): webhooks need a public endpoint.**
RevenueCat delivers webhooks from its servers, so the owned local API on loopback never receives one.
Local runs prove reconciliation only, and the webhook leg runs against the preview API.
Each step's S4-12 evidence names the path that delivered the entitlement, a webhook event id or a reconciliation pull, and every step shows both paths at least once.

**TEA-19 (D13, D15): the paid over-install needs a paid predecessor and one debug certificate.**
The `a01e0307` build has no Test Store key and no `test_store` handling, so Step 0 has no paid predecessor.
Step 0 records the paid baseline on its own debuggable build: purchase, server entitlement, and a restore after uninstall, reinstall and sign-in.
The first paid over-install is Step 0 to Step 1.
Android debug keystores are generated per machine, and `adb install -r` refuses a different certificate.
The debuggable pair therefore uses a pinned, test-only keystore committed with a note that it signs nothing distributed.
Otherwise both sides are built on one machine.
The certificate SHA-256 is recorded on both sides.

**TEA-20 (D15 key hygiene): a config spec does not cover the bundle.**
An `EXPO_PUBLIC_` value is inlined into the JS bundle at export.
S4-13 adds two checks. A scan of `expo export` output for the production and preview environments finds no Test Store key (prefix `test_`, plus the configured key's hash). A unit shows `resolveRevenueCatApiKey` refuses a `test_` key when `__DEV__` is false, so a misconfigured Release logs and stays unconfigured instead of hitting the SDK's deliberate crash.

---

## Alignment with the Codex re-review R2 (2026-11-12)

| R2    | Decision              | Test IDs                                                      |
| ----- | --------------------- | ------------------------------------------------------------- |
| R2-01 | Approach, D1, D4, D13 | P0-08, P0-09, U-05, exit and quality-gate scope               |
| R2-02 | D4                    | S0-01                                                         |
| R2-03 | D5                    | SP-01, F-12                                                   |
| R2-04 | D4                    | S4-11                                                         |
| R2-05 | D5                    | F-00a, F-00a2, F-00a3, F-00b, F-00b2, F-00q, F-09, red proofs |
| R2-06 | D12                   | S2-07, S2-08, S3-02                                           |
| R2-07 | D2                    | Exit criteria, S4-06, S4-12, S4-15                            |
| R2-08 | D14                   | S4-04                                                         |

## Alignment with the Codex story review (2026-11-12)

The builder applied CX-01 to CX-14 to the frozen block.
CX-05 replaces TEA-04's local Xcode 27.2 fallback.
CX-07 replaces TEA-01's "assert the exact 6.8 signature below 0.87" with classification and per-step baselines.
The test IDs each CX item owns:

| CX    | Decision     | Test IDs                                         |
| ----- | ------------ | ------------------------------------------------ |
| CX-01 | D5           | F-00e, F-00f, F-00g, F-00m, F-12                 |
| CX-02 | D5           | F-00i, F-00j, F-00k                              |
| CX-03 | D4, D7, D11  | P0-08 (simulator scope), P0-09, U-01             |
| CX-04 | D12          | S2-07, S2-08, S3-02                              |
| CX-05 | D1, D14      | Gate matrix iOS row, S3-03, S4-04                |
| CX-06 | D4, D11, D15 | S4-06, S4-12 to S4-15, D7-06, D7-08              |
| CX-07 | D5           | F-00a, F-00h, F-00l, F-09, F-10                  |
| CX-08 | D4           | S2-05                                            |
| CX-09 | D13          | U-05, U-03                                       |
| CX-10 | D1           | Exit criteria, gate matrix "Native evidence" row |
| CX-11 | D6           | C-01, C-01b                                      |
| CX-12 | D5           | F-05a, F-05b                                     |
| CX-13 | D4           | S4-11                                            |
| CX-14 | D4           | S0-01                                            |

## Executive Summary

The story replaces the React Native runtime under every mobile screen, four times, and ends in a production build.
The one behavior change members should see is AC3: live font-scale layout, certified from Step 4.
Everything else must stay exactly as it is.
The plan has four layers:

1. **Static and unit gates at every step:** typecheck per workspace by error code, vitest, node-test-gate, plugin prebuild specs, and the new guards: Expo Go pin, font-scale reads, React parity, ABI check, semantic prebuild diff, release hold.
2. **Device gates before every step merges, on the exact head SHA:**
   - Maestro on Expo Go.
   - Native journeys on our dev client and Release builds on both platforms.
   - The live font classification, Debug and Release.
   - The installed-predecessor upgrade smoke.
   - The accessibility focus bridge, share-card save, watchOS and widgets.
   - Every applicable P0 and P1 test (D1).
3. **Step 4 additions:**
   - Complete-fix assertion.
   - The direct SDK 54 to 58 upgrade.
   - The RevenueCat Test Store paid journey under R8 (S4-15), which runs in debuggable builds at every step from Step 0.
   - The R8 reflection mutant.
   - Foreground notifications.
   - iOS 27 and resizable iPad checks.
4. **Sign-off:**
   - The D7 production-shaped run.
   - The D11 device and store gates. Each blocks sign-off and holds iOS releases, so "shippable" at every step means Android (D1, R2-01). A missing-access record never counts as a pass.

Risk summary: 22 risks, 13 high (score 6 or 9), 7 medium, 2 low.

## Not in Scope

- Behavior changes beyond AC3. Every other user-visible change is a regression.
- A React Native source build or renderer backport (Story 6.8 ruled them out).
- Web feature changes. The web suites run only because React moves (D3).
- New iOS 27 SDK features. The scene lifecycle is proved for parity only.

## Risk Assessment

Probability (P) and Impact (I) are on a 1 to 3 scale; Score = P x I.

### High-Priority Risks (Score >= 6)

| ID  | Category | Risk                                                                                                                  | P   | I   | Score | Mitigation (test IDs)                                                     |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------- | --- | --- | ----- | ------------------------------------------------------------------------- |
| R01 | TECH     | Live font fix absent or partial on a screen, or a stale clone returns on a later commit                               | 2   | 3   | 6     | F-00a to F-00n, F-01 to F-08                                              |
| R02 | DATA     | In-place upgrade loses the session or the ritual cache (`expo-secure-store` or storage format change across 4 majors) | 2   | 3   | 6     | U-03, U-04, U-05, P0-07, P0-08                                            |
| R03 | TECH     | Background task dead or crashing after upgrade (TEA-07)                                                               | 3   | 3   | 9     | P0-05 to P0-09, U-01                                                      |
| R04 | TECH     | R8 strips a class reached only by reflection, in Release only                                                         | 3   | 3   | 9     | S4-06 targeted mutants, S4-15, D7-04; real billing under R8 is a D11 gate |
| R05 | OPS      | iOS CI cannot build from Step 2 (Xcode 26.4), or the macOS queue breaks the 20-minute ceiling                         | 3   | 2   | 6     | Step 2 entry criterion, C-01 to C-04                                      |
| R06 | TECH     | expo-router 58 navigation rework breaks deep links, widget taps, back behavior or `initialRouteName` users            | 2   | 3   | 6     | S4-03, `deep-link-handling.yaml`, `widget-deep-link.yaml`                 |
| R07 | TECH     | Share-card save fails on the new Android media-library API, or the 6.8 add-only permission regresses                  | 2   | 3   | 6     | S2-04, U-05 Step 2 Photos states                                          |
| R08 | OPS      | A green PR with no native journey on its exact head SHA                                                               | 3   | 2   | 6     | Gate matrix "Native evidence", exit criteria                              |
| R18 | TECH     | Android Activity recreation on font change makes AC3 unreachable or masks the fix (TEA-15)                            | 3   | 3   | 9     | TEA-16 spike, F-00e, F-12                                                 |
| R19 | TECH     | SDK 56 Hermes memory regression ships to members (D12)                                                                | 2   | 3   | 6     | S2-07, S2-08, S3-02                                                       |
| R20 | BUS      | Paid entitlement lost across an upgrade, or purchase, cancel or restore broken by RevenueCat 11 (D15)                 | 2   | 3   | 6     | S4-12 to S4-15, U-05                                                      |
| R21 | OPS      | Store gates (Apple and Google) never run because neither store account exists, which blocks sign-off                  | 3   | 2   | 6     | D11 list, D7-06; owner enrollment decision routed                         |
| R22 | TECH     | An Xcode 27 artifact misbehaves on iOS 27 (application lifecycle) or on resizable iPad                                | 2   | 3   | 6     | S3-03, S4-04                                                              |

### Medium-Priority Risks (Score 3 to 4)

| ID  | Category | Risk                                                                        | P   | I   | Score | Mitigation                             |
| --- | -------- | --------------------------------------------------------------------------- | --- | --- | ----- | -------------------------------------- |
| R09 | TECH     | `expo/fetch` global changes abort, timeout or streaming behavior            | 2   | 2   | 4     | S2-06                                  |
| R10 | TECH     | Strict TypeScript API surfaces real ref or deep-import bugs hidden by casts | 2   | 2   | 4     | tsc per workspace by code, S4-01       |
| R11 | TECH     | Hermes and Intl change breaks localization or plural rules                  | 2   | 2   | 4     | Localization flows mandatory each step |
| R12 | TECH     | Per-target iOS floors break widget, watch or pods                           | 2   | 2   | 4     | S2-05, watchOS lane                    |
| R13 | TECH     | `NODE_ENV` forced by the CLI loads the wrong env file into a build          | 2   | 2   | 4     | S4-07                                  |
| R14 | OPS      | Linux PR jobs over 15 min p95 get slower as builds grow                     | 2   | 2   | 4     | C-02 each step                         |
| R23 | TECH     | SDK 58 shows foreground notifications the app suppressed on SDK 54 (CX-13)  | 2   | 2   | 4     | S4-11                                  |

### Low-Priority Risks (Score 1 to 2)

| ID  | Category | Risk                                                                              | P   | I   | Score | Action                             |
| --- | -------- | --------------------------------------------------------------------------------- | --- | --- | ----- | ---------------------------------- |
| R15 | TECH     | Reanimated 4.7 drops `zIndex` from sync props, so an animation's stacking changes | 1   | 2   | 2     | S4-08 grep guard plus visual check |
| R16 | TECH     | AC5 Expo internals move                                                           | 1   | 2   | 2     | S4-09                              |

R17 (RevenueCat 11, low) is merged into R20 now that D15 runs a paid journey at every step.

### Risk Category Legend

TECH: technical or architecture. DATA: data integrity or loss. OPS: CI, build, deployment. BUS: business logic.

## Entry Criteria

- The spec is approved with the TEA and CX intent entries applied to the frozen block, and TEA-15 decided.
- Before the Step 0 proof merges: the TEA-16 spike result is recorded.
- Step 0:
  - An isolated `DATABASE_URL` for Playwright.
  - An Android emulator (API 36 and API 32) and an iOS 26.1 simulator.
  - A RevenueCat project with the `premium` entitlement, a Test Store monthly product in an offering, the secret REST key, and the webhook pointed at the preview API (D15).
  - A non-complimentary test member.
  - The pinned test keystore (TEA-19).
- Step 2: the `macos-26` move or D6 fallback is in, and Xcode 26.x (26.4 or later) is installed beside Xcode 27.2 for `DEVELOPER_DIR` builds (D14). An iOS 16.4 simulator runtime is installed (S2-05).
- Step 4:
  - An iOS 27 simulator runtime and a resizable iPad simulator are installed (D14).

## Exit Criteria (per step)

- Every applicable P0 and P1 test in this plan is green on the step's exact head SHA, the Debug font proof and U-05 included (D1).
- Native evidence on that SHA is linked in the PR (CX-10):
  - Before the D6 workflows: `workflow_dispatch` runs of `pr-share-card-native`, `pr-accessibility-focus` and `watchos-native`.
  - After D6: the consolidated iOS job by dispatch, or a recorded local run of its suites when the job is off the PR path, plus the Android lanes.
- The first nightly on `main` after merge is green before the next step opens. It never stands in for pre-merge evidence.
- Every flake met is fixed and burned in by TEA (see Flake policy).
- The step's C-02 table is appended to the spec.
- A step that changes `react-native-purchases` runs S4-12 and S4-15 on that head SHA. A step that changes `posthog-react-native` runs S4-06's Release event capture on that head SHA. The PR lists those runs (R2-07).

## Gate matrix per step

"Every step" means each of Steps 0 to 4, run on the step's exact head SHA.

| Gate                          | How                                                                                                                                                                                                                                                              | Steps                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `npx expo-doctor`             | Zero findings, logged in the PR                                                                                                                                                                                                                                  | Every step                                     |
| Typecheck by code             | `npm exec -- tsc --noEmit -p <tsconfig>` in `apps/mobile`, `apps/web`, `apps/api` and every package; only the known symlink TS2742; count by code recorded; rebuild `packages/api-client` dist first                                                             | Every step                                     |
| Unit                          | `npm exec -- vitest run` in every workspace; `apps/mobile` `test:widget-prebuild`, `test:watchos-prebuild`, `test:share-card-prebuild` and the background-task prebuild spec (no workflow runs these today, so the PR records the local run until D6 wires them) | Every step                                     |
| Node-test-gate                | Every suite in `scripts/ci/node-test-suites.json`, run blocks included                                                                                                                                                                                           | Every step                                     |
| New guards                    | Expo Go pin, font-scale reads, React parity, semantic prebuild diff, release hold, `configChanges` prebuild spec (F-12); all-ABI AAB check                                                                                                                       | From the step that adds each, every step after |
| Web e2e and contract          | `pr-pw-e2e-local`, the Vercel preview, `contract-testing.yml`; locally only with an isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true`                                                                                                                  | Every step                                     |
| Maestro on Expo Go            | `pr-mobile-e2e` (9 shards) and `ios-expo-go`, with Expo Go pinned to the step's SDK; localization flows mandatory                                                                                                                                                | Every step                                     |
| Native evidence               | Android: prebuild `--clean`, Debug and Release, every `pr-share-card-native` device lane, accessibility focus (TalkBack, Robolectric). iOS: prebuild, Debug and Release, `ios-build`, `ios-shard`, accessibility module and `ios-app-build`, `watchos-native`    | Every step                                     |
| iOS toolchain                 | Xcode 26.3 on `macos-15` at Steps 0 and 1; Xcode 26.x (26.4 or later) at Steps 2 and 3; Xcode 27 from Step 4 with S4-04's iOS 27 and resizable iPad checks                                                                                                       | Per step                                       |
| Share card save               | Android 13+ and iOS add-only save journeys, `share-card-export.yaml`                                                                                                                                                                                             | Every step; Step 2 is the Android API change   |
| Live font classification      | F-01 to F-09 on Android API 36 and iOS 26.1, Debug and Release                                                                                                                                                                                                   | Every step; complete fix asserted from Step 4  |
| Large-text matrix             | `story68-cold-font-scale.mjs` cold matrix                                                                                                                                                                                                                        | Every step                                     |
| Installed-predecessor upgrade | U-05 (U-03 too at Step 4)                                                                                                                                                                                                                                        | Every step                                     |
| Memory                        | S2-07 at Step 2, S3-02 at Step 3, as recorded local runs outside PR jobs                                                                                                                                                                                         | Steps 2 and 3                                  |
| CI timing                     | C-02 table for the step's PR runs; `pr-job-ceilings.test.mjs`                                                                                                                                                                                                    | Every step after the Step 0 CI work            |

## Test Catalog

Priorities: P0 and P1 both block the step they apply to (D1); P2 is recorded.
Nothing waits for sign-off except D7 and the D11 device and store gates, which hold iOS releases. Shippable at every step means Android (D1, R2-01).

### Live font-scale proof

The builder fork owns the code: `scripts/lib/live-font-scale-proof.mjs`, its test, and the driver `scripts/run-live-font-proof.mjs`.
TEA owns the test IDs and the fixtures' expected classes, and reviews each fixture against a recorded hierarchy.

Oracle unit tests run on recorded hierarchies and fake driver logs.
Expected class at `fixExpected` false and true:

| ID     | Priority | Fixture                                                                                                                                                                                                                                                                                                       | Below 0.87                                   | 0.87 and above          |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------- |
| F-00a  | P0       | Residual predicate match: a run inside the approved predicate for its platform, configuration and screen in the reviewed baseline file. The predicate says which probes may stay stale, by how much, and that every control stays visible, reachable and unclipped                                            | Residual bug, pass                           | Fail                    |
| F-00a2 | P0       | Residual outside the predicate: one more clipped node, a lost text, a control no longer reachable, or a probe staler than its bound                                                                                                                                                                           | Fail until a PR adjudicates it into the file | Fail                    |
| F-00a3 | P0       | Baseline file review: an entry without platform, configuration, screen, bounds, reviewer or reason is rejected; the Story 6.8 Android Release baseline (43 nodes, 169 px) is the first entry                                                                                                                  | Rejected                                     | Rejected                |
| F-00b  | P0       | Cold 1.0 and cold 1.5 captures used as layout fixtures only: the oracle's layout checks (text, growth, clipping) pass on them                                                                                                                                                                                 | Layout checks pass                           | Layout checks pass      |
| F-00b2 | P0       | Provenance: a cold capture presented as a live change. Process start time, Activity token, root marker or capture sequence breaks continuity, and the driver rejects it                                                                                                                                       | Unrelated failure, fail                      | Unrelated failure, fail |
| F-00c  | P0       | 44 nodes before, 5 after (the rejected `AppText` repair)                                                                                                                                                                                                                                                      | Unrelated failure, fail                      | Unrelated failure, fail |
| F-00d  | P0       | PID changes                                                                                                                                                                                                                                                                                                   | Unrelated failure, fail                      | Unrelated failure, fail |
| F-00e  | P0       | Same-PID Activity recreation mutant: Activity token changes, `onCreate` count rises, layout correct                                                                                                                                                                                                           | Restored screen, recorded                    | Fail                    |
| F-00f  | P0       | Remount mutant: same Activity, mounted-root identity marker changes, layout correct                                                                                                                                                                                                                           | Restored screen, recorded                    | Fail                    |
| F-00g  | P0       | iOS scene or key window identity changes                                                                                                                                                                                                                                                                      | Restored screen, recorded                    | Fail                    |
| F-00h  | P0       | Stale clone: parity and clipping hold when settled, fail after the post-change React update                                                                                                                                                                                                                   | Pass only inside the predicate               | Fail                    |
| F-00i  | P0       | Clipping: heights equal the cold reference, but one text node's content bounds exceed its container                                                                                                                                                                                                           | Pass only inside the predicate               | Fail                    |
| F-00j  | P0       | Android 14 and later nonlinear scaling, from the device's converter at 1.5. A large-text probe (above the converter's nonlinear threshold) grows little and passes; a linear 1.5 expectation applied to the same fixture must fail the oracle's own self-check; a small-text probe that stays unchanged fails | Per class                                    | Per class               |
| F-00k  | P0       | iOS per text style: the expected size comes from the content-size category table for the probe's style at 1.353 and 1.786; a probe that does not grow fails                                                                                                                                                   | Per class                                    | Per class               |
| F-00l  | P0       | Early complete fix below 0.87                                                                                                                                                                                                                                                                                 | Pass, `baselineReview`                       | n/a                     |
| F-00q  | P0       | Version switch (R2-05): a residual fixture passes at 0.86.3 and fails at 0.87.0 and 0.88.1; a healthy fixture passes at all three. `0.87.0-rc.0` counts as 0.87 (the switch compares major and minor numerically, because semver ranks a prerelease below 0.87.0 and the rc contains the fix)                 | Per row                                      | Per row                 |
| F-00m  | P0       | Driver order: the identity check runs before any scroll-through or cold reference run; a fake driver that scrolls first is rejected                                                                                                                                                                           | Fail                                         | Fail                    |
| F-00n  | P0       | Return leg: after 1.5 to 1.0, a stale tall box remains                                                                                                                                                                                                                                                        | Pass only inside the predicate               | Fail                    |

Device runs: each screen goes up and back down. The post-change React update is a deterministic state update the driver triggers on that screen, chosen per screen and recorded.

| ID    | Priority | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-01  | P0       | Positive control, SDK 54, per platform: a cold launch at the base scale against a cold launch at the target scale passes "Full text", per-style growth and clipping. It runs before any build is judged                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F-02  | P0       | Android Release, Home                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| F-03  | P0       | Android Release, Community feed (6.14 test member)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F-04  | P0       | Android Release, Settings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F-05a | P0       | Composer, cross-scale reflow (CX-12): at each scale, Save and Share are visible, reachable and non-overlapping, in the tier `actionRowTier` chooses from the measured labels                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F-05b | P0       | Composer, fixed-scale stability (CX-12): at each scale, toggling the feedback message leaves Save and Share bounds and the popover anchor rect unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F-06  | P0       | iOS Release, F-02 to F-05b equivalents, `large` to `extra-extra-extra-large` to `accessibility-medium` and back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F-07  | P1       | Debug dev client, both platforms, F-02 to F-06 (runs before every step merges, per D1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F-08  | P1       | Light and dark, Release, screenshots stored beside node counts, heights, identities and PIDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F-09  | P0       | Per-step baseline (CX-07, R2-05): below 0.87, the observed class and measurements per platform, configuration and screen go to `_bmad-output/test-artifacts/story-6-15/live-font-baselines/step-N-<platform>-<config>.json`, beside the reviewed predicate file. A run outside its predicate fails until a PR adjudicates it; a changed class gets a baseline-review entry in the Plan Change Log                                                                                                                                                                                                                                          |
| F-10  | P0       | Step 4: the below-0.87 branch and its fixtures are deleted, and a spec asserts that no class other than complete fix passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F-11  | P0       | iOS physical device, Release, F-06 (D11, blocks sign-off)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F-12  | P0       | Prebuild spec: the prebuilt manifest differs from the control by exactly the `fontScale` token appended to `MainActivity` `configChanges`, with every existing token and attribute kept. Four mutants must turn it red: `fontScale` removed; the original tokens replaced; `locale` or `density` added; the token placed on another Activity (R2-03)                                                                                                                                                                                                                                                                                       |
| SP-01 | P0       | TEA-16 spike (R2-03), before the Step 0 proof merges. Matched SDK 54 Release pairs with and without the plugin on one emulator, and SDK 58 pairs. All four screens, scale up and down; a live theme change handled in place; locale and density changes, which still recreate, with route and state restored. Each capture records the OS scale, JS `useWindowDimensions().fontScale`, Activity and root identity, and layout. A no-op change (OS scale moved, JS scale did not) fails. "No worse" on SDK 54, screen by screen against the control: same text content, no new clipping, every control reachable, navigation and state kept |

Stability: at Step 4 the proof runs 3 times consecutively per platform and configuration with identical classes before Step 4 merges.

### Background task and upgrades

| ID    | Priority | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0-05 | P0       | Unit: with `RITUAL_BACKGROUND_FETCH_TASK` registered, launch unregisters it, then registers `RITUAL_BACKGROUND_TASK` with `minimumInterval: 15` (minutes). An unregister throw is logged, and registration still happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P0-06 | P0       | Prebuild spec: iOS `processing`, `com.expo.modules.backgroundtask.processing` in `BGTaskSchedulerPermittedIdentifiers`, no `fetch`; no fetch component on Android                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P0-07 | P0       | Android in-place upgrade, `a01e0307` Release to the Step 0 Release, same certificate. Signed in with the fetch task registered: install over, cold start, `adb reboot`. No `ClassNotFoundException` or crash in logcat; `dumpsys jobscheduler` shows exactly one WorkManager job for the package; a forced run (`cmd jobscheduler run -f`) refreshes the ritual cache; the session is kept                                                                                                                                                                                                                                                                                                                                                                                                 |
| P0-08 | P0       | iOS simulator in-place upgrade (R2-01): retained state only, meaning the signed-in session, ritual cache, locale and theme. It asserts nothing about task registration, because `expo-background-task` rejects registration on a simulator before persisting (`BackgroundTaskModule.swift:41`, `BackgroundTaskScheduler.swift:154`)                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P0-09 | P0       | Physical iPhone at Step 0 and in D7: the in-place upgrade with registration of `RITUAL_BACKGROUND_TASK` only, OS scheduler acceptance and a Debug worker run. A D11 gate; it holds iOS releases and blocks sign-off                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| U-01  | P0       | Android emulator, Debug: `triggerTaskWorkerForTestingAsync()` runs the ritual task: it fetches when the cache is stale, and skips the fetch when the cache is fresh or there is no session. On iOS this runs only within P0-09                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| U-02  | P1       | Unit parity: every `background-fetch.test.ts` case is ported, with the result enums mapped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| U-03  | P0       | Direct SDK 54 to SDK 58 upgrade before Step 4 merges (D13), and again in D7 from EAS production builds under one certificate (TEA-08): session, ritual cache read with no network, one task, locale, theme                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| U-04  | P1       | Unit: the SecureStore key names and options for auth storage are pinned, so a rename across steps is caught                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| U-05  | P0       | Installed-predecessor smoke before each step merges (D13): the previous step's `main` Release, used, then this head's Release installed over it under the same certificate, Android and iOS simulator. On Android it carries session, ritual cache, task registration, locale, theme, and deep-link state. On the iOS simulator it carries retained state only (session, ritual cache, locale, theme, scene and deep-link state), with no registration assertion (R2-01). Step 2 adds the Photos add-only and denied states and a real PNG save after the upgrade. A second, debuggable pair carries the Test Store paid install (S4-12): Step 0 records the paid baseline on its own build, and every step from Step 1 installs over the previous step's paid debuggable install (TEA-19) |

### Step-specific checks

| ID    | Step                                                | Priority | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0-01 | 0                                                   | P0       | Structural prebuild diff (CX-14, R2-02, `f108b625`): `prebuild-semantic-diff.mjs` parses `project.pbxproj` and compares reference-preserving structure (each object labelled by its fields and the labels of objects it references, refined until stable; arrays keep order). It allows only the `newArchEnabled` deletion from `Podfile.properties.json`, requires every other file byte-identical, and asserts the effective settings. Mutants that must turn it red: one `gradle.properties` value changed; a build-phase order swap; a configuration retargeted to another target or base file; a real-project phase swap on the actual prebuilt tree                                                           |
| S1-01 | 1                                                   | P0       | React parity guard green; web build and web e2e on React 19.2.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S2-01 | 2                                                   | P0       | No `@react-navigation/*` import in app code (grep test); the codemod compiles; `share-card-tab-heading.test.tsx` green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S2-02 | 2                                                   | P0       | TypeScript decision recorded with a by-code tsc count on both versions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S2-03 | 2                                                   | P0       | Async `copy` and `move` awaited, with a unit per caller in which a rejected promise reaches the existing error path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S2-04 | 2                                                   | P0       | Android `share-card-save.native.ts` on the new asset API: units for success, add-only grant and refusal; native save journeys. The iOS `saveOriginalPng` adapter, its hash and its add-only assertions are byte-unchanged (diff check)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S2-05 | 2                                                   | P0       | Per-target floors (CX-08): the iOS app and iOS widget at 16.4; the generated Pods floor at 16.4; the three local podspecs at 16.4; the watch app and watch widget at watchOS 9.0. A plugin spec covers each target. The app launches on the iOS 16.4 runtime, and a paired watch syncs                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S2-06 | 2                                                   | P1       | Maestro: a network timeout shows the error state on the dev client (TEA-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| S2-07 | 2                                                   | P0       | Memory (D12, R2-06): Release on one emulator and one simulator, Step 2 against the Step 1 control. Cold start, a 30-minute sustained Home, Community and composer journey with animations, peak and settled PSS (Android) and physical footprint (iOS), three runs each, medians compared. These are recorded local runs outside PR jobs, which cannot fit the 20-minute ceiling. A lift needs both peak and settled within 10%                                                                                                                                                                                                                                                                                     |
| S2-08 | 2                                                   | P0       | `mobile-release-hold.mjs` refusal units (`2e6fb24f`): a missing hold file refuses from SDK 56; a malformed file refuses; refusal unless a lift measured on the current SDK, with date and evidence, is within 10% of the Step 1 control; a lift from an earlier SDK never carries over; SDK 57 below `expo` 57.0.17 refuses. Removing the check turns the spec red                                                                                                                                                                                                                                                                                                                                                  |
| S3-01 | 3                                                   | P0       | Clean-prebuild default: every config plugin spec runs against a fresh tree                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S3-02 | 3                                                   | P0       | S2-07 repeated on `expo` 57.0.17 or later, and its lift recorded. Over the threshold or without evidence, the hold stays, and Step 4 cannot open its release until a current-SDK lift passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S3-03 | 3                                                   | P0       | Scene lifecycle opted in, built on Xcode 26.x: launch, deep link, widget tap, orientation lock, VoiceOver focus and modal system bars on the scene window                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S4-01 | 4                                                   | P0       | Strict TypeScript API on, with no opt-out flag in any tsconfig (grep test)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S4-02 | 4                                                   | P0       | `write` awaited, with a unit per caller                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S4-03 | 4                                                   | P0       | Async `renderRouter` in tests; deep-link, widget-deep-link and back-navigation flows green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S4-04 | 4                                                   | P0       | `SceneDelegate.swift` is generated, and the iOS modules find the key window (XCTest, VoiceOver journey). Xcode 27 artifact (D14): an iOS 27 simulator runs launch, deep link, foreground and resume, window geometry and VoiceOver focus. The iPad runs two separate checks (R2-08). Where the system honors the lock, the locked orientation holds. In an iOS 27 resizable window, where the lock may not be honored and the reported orientation can differ from the window, the check asserts the actual window bounds across resizes, adaptive layout, reachable controls, the share popover anchored inside the scene, and retained state, with no assertion on the reported orientation                       |
| S4-05 | 4                                                   | P0       | Robolectric and module unit tests on AGP 9.2.1 and Kotlin 2.2.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S4-06 | 4, and any step that changes `posthog-react-native` | P0       | R8 Release: complimentary state, the unconfigured-purchases path (no RevenueCat key in production), PostHog event capture (the `posthog-react-native` 4.86.0 compatibility proof) and the four local modules. Targeted reflection mutants (CX-06): a PostHog or local-module class reached only by reflection in the true Release, and a RevenueCat class in `minifiedDebuggable` (S4-15). For each, `-whyareyoukeeping` shows our rule is the only keeper, the rule is removed, and the journey must fail                                                                                                                                                                                                          |
| S4-07 | 4                                                   | P0       | Env-file spec: `expo start`, `expo export` and `eas build --profile production` each load the pinned file; a missing API base URL fails fast                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| S4-08 | 1 to 4                                              | P2       | `zIndex` in animated styles: grep guard plus a screenshot pair on the affected screens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S4-09 | 4                                                   | P0       | AC5: both internal imports resolve; the console guard fails a seeded missing-`ExponentConstants` warning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S4-10 | 4                                                   | P0       | D5 verdict measurements (TEA-13) written into the D5 table, with the TEA-15 manifest verdict for row 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S4-11 | 4                                                   | P0       | Foreground notifications (CX-13, R2-04). Units: the community filter lives in a module the root layout imports statically, so it is installed before the first render; it answers synchronously from the payload; cleanup detaches response listeners only and never clears the filter. Native, Android and iOS: valid and invalid community data with a responsive handler; a handler delayed past the 3-second deadline, which asserts the platform shows it (the accepted D4 behavior); cold-start delivery; delivery after sign-out cleanup. Mutants: moving the filter back behind a dynamic import fails the unit for installation before first render; clearing it on cleanup fails the after-sign-out check |
| S4-12 | 0 to 4                                              | P0       | Test Store journey (D15), debuggable builds (Android debuggable, iOS Debug), emulator and simulator, non-complimentary member. Fetch offerings. Failure and cancel leave no entitlement in `CustomerInfo`, on the server or on `GET /api/v1/commerce/premium/access`. Purchase success shows the entitlement in all three, through the webhook on the preview API and through reconciliation locally (TEA-18). The over-install from the previous step's paid debuggable build keeps the entitlement (from Step 1). A restore after uninstall, reinstall and sign-in returns it. Step 0 is the baseline                                                                                                             |
| S4-13 | 0 to 4                                              | P0       | Evidence and key hygiene. The evidence names store `TEST_STORE`, the debuggable build and the delivery path, and rejects mocks and the Expo Go fallback flow. A config spec shows `production`, `production-simulator`, preview and every Release resolve no Test Store key. A bundle scan of production and preview `expo export` finds none. `resolveRevenueCatApiKey` refuses a `test_` key when `__DEV__` is false (TEA-20)                                                                                                                                                                                                                                                                                     |
| S4-14 | 0 to 4                                              | P0       | Server: `test_store` is applied to `PremiumEntitlement` when `TEST_ENV` is local or preview; in production the event is recorded and not applied; an unset or unknown `TEST_ENV` counts as production (fail closed); the App Store and Play mappings are unchanged. Integration specs cover webhook and reconciliation                                                                                                                                                                                                                                                                                                                                                                                              |
| S4-15 | 0 to 4                                              | P0       | Android `minifiedDebuggable` (TEA-17): S4-12 runs under the release R8 rules; the RevenueCat targeted mutant from S4-06 turns it red. If the mutant stays green, the variant is recorded as giving no R8 evidence and RevenueCat under R8 stays with D11                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### What the Test Store journey does not prove

These stay D11 store gates and are reported blocked, never passed:

- The native StoreKit and Play Billing code paths, store purchase dialogs, receipts and purchase tokens.
- Store-driven renewal, grace, billing retry and refunds.
- The Play-signed install path.
- R8 keep rules exercised by a real billing purchase in a non-debuggable build. S4-15 is the nearest proxy, and only if its mutant turns it red.
- RevenueCat in a true Release build: production has no RevenueCat key, so `Purchases` is never configured there.
- App Store review's sandbox behavior.
- A production RevenueCat project wired to real App Store and Play apps.

### CI timing (`scripts/ci/pr-job-p95.mjs` and test)

| ID    | Priority | Test                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01  | P0       | Units (CX-11): nearest-rank p95; both queue definitions; a job with `needs`; failed and timed-out jobs kept with observed durations; a job cancelled after start kept; a job cancelled before start counted as a queue-only lower bound; skipped-without-running excluded with its reason; queue plus run over 20 minutes is a breach although `timeout-minutes` did not fire |
| C-01b | P0       | Lane fixtures: a second macOS job on one PR is rejected; macOS selected for a JS-only change is rejected; a native iOS change selects exactly one macOS job                                                                                                                                                                                                                   |
| C-02  | P0       | Per step: every PR job's queue plus run p95 is 15 minutes or less and its maximum is 20 or less, by the owner's queue measure                                                                                                                                                                                                                                                 |
| C-03  | P0       | Probe: 20 runs each on `macos-26` and `macos-15`; queue p50 and p95 recorded in D6                                                                                                                                                                                                                                                                                            |
| C-04  | P0       | Consolidated iOS job: 20 consecutive PR runs meet C-02, or it moves to `main` plus nightly with the numbers logged                                                                                                                                                                                                                                                            |
| C-05  | P1       | `pr-job-ceilings.test.mjs` and every spec that reads a changed workflow file run when workflows change                                                                                                                                                                                                                                                                        |

### D7 production-shaped run (`_bmad-output/test-artifacts/story-6-15/d7/`)

| ID    | Priority | Test                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D7-01 | P0       | Build identities: EAS build ids, AAB and universal APK SHA-256, certificate SHA-256, `ReactNativeVersion`, all-ABI listing; iOS `production-simulator` app digest                                                                                                                                                                                                                                     |
| D7-02 | P0       | Production API and Supabase, 6.14 test member: sign-in, session restore after force-stop, Home ritual, Community feed, share-card save and share, Settings, push permission prompt                                                                                                                                                                                                                    |
| D7-03 | P0       | F-02 to F-06 on the production builds                                                                                                                                                                                                                                                                                                                                                                 |
| D7-04 | P0       | S4-06 on the production AAB                                                                                                                                                                                                                                                                                                                                                                           |
| D7-05 | P0       | U-03 from the EAS production build of the last deployed SDK 54 commit                                                                                                                                                                                                                                                                                                                                 |
| D7-06 | P0       | D11 gates, each reported blocked on enrollment until it runs, never passed. Apple: P0-09, F-11, the iOS device in-place upgrade, App Store sandbox purchase, entitlement and restore, TestFlight. Google: Play license tester purchase, entitlement, upgrade-while-paid and restore; the Play-signed internal-track upgrade path; a non-debuggable R8 Release completing a real Play Billing purchase |
| D7-07 | P0       | Evidence scrub: a scan for tokens, emails, member ids and JWT shapes over the evidence dir is clean before commit                                                                                                                                                                                                                                                                                     |
| D7-08 | P0       | Paid state: a Test Store key cannot run in a production build, so D7 attaches the Step 4 head's S4-12 to S4-15 evidence, and real-store purchases on production builds stay D7-06 gates                                                                                                                                                                                                               |

### Documents

- D8 learning path Step 55 and test cross-links; the deployment guide mobile section, which states that devices below iOS 16.4 keep the last supporting build.
- The spec's Verification commands updated for the new scripts.

## Red-first plan and seeded-defect proofs

| Test                   | Red proof                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-00 fixtures          | Each fixture runs at both sides of the version switch (F-00q); every row whose two columns differ must change outcome                                |
| F-01 to F-06 at Step 0 | Forced `fixExpected` true, only on runs classified residual or restored: each must fail. Healthy runs are covered by F-00q's healthy fixture (R2-05) |
| F-10 at Step 4         | Before deletion, a fixture with SDK 58's observed run classified under the below-0.87 rules is compared, proving the flip is real                    |
| F-12 red               | The four R2-03 mutants, plus removing the plugin: the prebuild spec fails, and an Android run classifies as a restored screen                        |
| Font-scale reads guard | Seed an `AppText` that multiplies by `fontScale`: red                                                                                                |
| Expo Go pin            | Bump `expo` without the Expo Go pin: red                                                                                                             |
| React parity           | Move `react` in one workspace only: red                                                                                                              |
| P0-05                  | Drop the unregister call: two units fail (done in `3d458bcd`)                                                                                        |
| P0-06                  | Drop the plugin from `app.json`: the iOS prebuild test fails (done in `3d458bcd`)                                                                    |
| P0-07                  | Keep the old task name: the stale consumer shows in `dumpsys`, and the proof fails                                                                   |
| S0-01 red              | The four seeded mutants listed in S0-01                                                                                                              |
| S2-08 red              | Each refusal unit in S2-08, and removing the check                                                                                                   |
| S4-06, S4-15           | Targeted reflection mutants in the true Release and in `minifiedDebuggable`                                                                          |
| S4-13                  | Point the `production` profile at a `test_` key: the config spec fails; inline a key in an export: the bundle scan fails                             |
| S4-14                  | Apply `test_store` in production: the spec fails                                                                                                     |
| S4-09                  | Point the alias at a missing path: the suite fails through the `globalThis.expo` guard                                                               |
| S4-11 red              | The dynamic-import and clear-on-cleanup mutants                                                                                                      |
| C-01, C-01b            | A fixture set with each rule broken                                                                                                                  |

Red proofs run in a throwaway worktree or a reverted temporary commit, never with stash or reset in the shared checkout.

## Flake policy

TEA owns every flaky or unrelated red check met during the story:

1. Root cause from run artifacts and probe headers first.
2. Fix.
3. Burn in with the same shard shape CI uses (`playwright-smart-parallelization` with `$PSP_ARGS` for Playwright; 10 consecutive Maestro runs for a flow).
4. Record in the spec's Review Triage Log.

Nothing is retried green, quarantined, marked expected-failure or marked `continue-on-error`.

## Quality Gate Criteria

### Pass/Fail Thresholds

- Every applicable P0 and P1 test: 100% pass on the step's exact head SHA before it merges. P2: recorded.
- Every high risk has its mitigating tests green at the step that owns it.
- D7 and the D11 device and store gates: 100% before sign-off; iOS releases stay held until the D11 gates pass.

### Non-Negotiable Requirements

- AC3 complete fix in Release on both platforms, on emulator, simulator and production builds, with an iOS physical device under D11.
- Every upgrade keeps the session and exactly one background task; the paid entitlement survives the upgrade.
- No PR job over 20 minutes including queue; p95 at most 15.
- No production mobile build while the SDK 56 hold stands.

## Traceability

| AC or decision                     | Tests                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------- |
| AC1                                | Gate matrix doctor, prebuild and builds; all-ABI check; D7-01              |
| AC2                                | Font-scale reads guard, S4-10, F-12                                        |
| AC3                                | F-00a to F-12, SP-01, D7-03                                                |
| AC4                                | Gate matrix, exit criteria, U-05, flake policy                             |
| AC5                                | S4-09                                                                      |
| D4 rows                            | P0-05 to P0-08, S0-01, S2-01 to S2-06, S3-01, S3-03, S4-01 to S4-08, S4-11 |
| D6                                 | C-01 to C-05                                                               |
| D7                                 | D7-01 to D7-08                                                             |
| D11                                | P0-09, F-11, D7-06; iOS releases held until they pass                      |
| D12                                | S2-07, S2-08, S3-02                                                        |
| D13                                | U-03, U-05                                                                 |
| D14                                | Gate matrix iOS toolchain row, S3-03, S4-04                                |
| D15                                | S4-12 to S4-15, U-05, D7-08; store gates D7-06                             |
| I/O "Live font up" (both)          | F-02 to F-06                                                               |
| I/O "Live font, Debug"             | F-07                                                                       |
| I/O "Live font down"               | F-02 to F-06 return leg, F-00n                                             |
| I/O "Cold launch at 1.5"           | Cold parity in F-02 to F-06, F-01                                          |
| I/O "Composer mid-flow"            | F-05a, F-05b                                                               |
| I/O "Activity recreation"          | S4-10, existing 6.8 recreation journey                                     |
| I/O "Recreated during font change" | F-00e, F-00f, F-00g                                                        |
| I/O "Foreground notification"      | S4-11                                                                      |
| I/O "Held release"                 | S2-08                                                                      |
| I/O "Paid member upgrade"          | S4-12, U-05 debuggable pair                                                |
| I/O "In-place upgrade"             | P0-07, P0-08, U-03, U-05                                                   |
| I/O "Background task"              | U-01, P0-09                                                                |
| I/O "Share-card save"              | S2-04, U-05 Step 2                                                         |
| I/O "Env file selection"           | S4-07                                                                      |
| I/O "iOS scene lifecycle"          | S3-03, S4-04                                                               |
| I/O "Release with R8"              | S4-06, D7-04                                                               |
| I/O "Vitest Expo web setup"        | S4-09                                                                      |
| I/O "iOS job queue over budget"    | C-03, C-04                                                                 |

## Execution record

(Filled in per step: test files, run URLs, p95 tables, baselines, seeded-defect results, differences from the plan.)

- Step 0, `3d458bcd`: P0-05 and P0-06 seeded defects recorded by the builder (Implementation Notes).
