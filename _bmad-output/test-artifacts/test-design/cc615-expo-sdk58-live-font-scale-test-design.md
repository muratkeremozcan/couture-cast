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
**Status:** Planned. No test is written yet.

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

---

## Executive Summary

The story replaces the React Native runtime under every mobile screen, four times, and ends in a production build.
The one behavior change members should see is AC3, which turns from red to green at Step 4.
Everything else must stay exactly as it is.
The plan has three layers:

1. **Static and unit gates at every step:** typecheck per workspace by error code, vitest, node-test-gate, plugin prebuild specs, and the new guards from TEA-05, TEA-06, TEA-11 and TEA-14. They run on Linux in minutes.
2. **Device gates at every step:**
   - Maestro on Expo Go for the PR (Android).
   - Native journeys on our own dev client and Release builds (Android and iOS) through dispatch.
   - The live font proof on both platforms in Debug and Release.
   - The accessibility focus bridge, share-card save, watchOS and widgets.
3. **Release gate once:** the D7 production-shaped run, including the in-place upgrade, with Step 0 proving the background-task upgrade early (TEA-07).

Risk summary: 17 risks, 8 high (score 6 or 9), 6 medium, 3 low.

## Not in Scope

- Behavior changes beyond AC3. Every other user-visible change is a regression.
- A React Native source build or renderer backport (Story 6.8 ruled them out).
- Web feature changes. The web suites run only because React moves (D3).
- New iOS 27 SDK features. Scene lifecycle is proved for parity only.

## Risk Assessment

Probability (P) and Impact (I) are on a 1 to 3 scale; Score = P x I.

### High-Priority Risks (Score >= 6)

| ID  | Category | Risk                                                                                                                  | P   | I   | Score | Mitigation (test IDs)                                      |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------- | --- | --- | ----- | ---------------------------------------------------------- |
| R01 | TECH     | Live font fix absent or partial on a screen (Fabric still caches a stale scale on some path)                          | 2   | 3   | 6     | F-01 to F-08, cold parity oracle                           |
| R02 | DATA     | In-place upgrade loses the session or the ritual cache (`expo-secure-store` or storage format change across 4 majors) | 2   | 3   | 6     | U-01 to U-04, D7-05                                        |
| R03 | TECH     | Background task dead or crashing after upgrade (TEA-07)                                                               | 3   | 3   | 9     | P0-05 to P0-08, U-03                                       |
| R04 | TECH     | R8 strips a class used by reflection (RevenueCat, PostHog, local modules) in Release only                             | 3   | 3   | 9     | S4-06, Release journeys, D7-02                             |
| R05 | OPS      | iOS CI cannot build from Step 2 (Xcode 26.4) or queues past the 20-minute ceiling                                     | 3   | 2   | 6     | TEA-04, C-01 to C-04                                       |
| R06 | TECH     | expo-router 58 navigation rework breaks deep links, widget taps, back behavior or `initialRouteName` users            | 2   | 3   | 6     | S4-03, `deep-link-handling.yaml`, `widget-deep-link.yaml`  |
| R07 | TECH     | Share-card save fails on the new media-library API, or the 6.8 add-only permission regresses                          | 2   | 3   | 6     | S2-04, share-card native journeys                          |
| R08 | OPS      | A green PR with no native journey on its code (TEA-10)                                                                | 3   | 2   | 6     | Dispatch evidence per step, nightly green before next step |

### Medium-Priority Risks (Score 3 to 4)

| ID  | Category | Risk                                                                        | P   | I   | Score | Mitigation                             |
| --- | -------- | --------------------------------------------------------------------------- | --- | --- | ----- | -------------------------------------- |
| R09 | TECH     | `expo/fetch` global changes abort, timeout or streaming behavior            | 2   | 2   | 4     | S2-06, TEA-12 Maestro timeout check    |
| R10 | TECH     | Strict TypeScript API surfaces real ref or deep-import bugs hidden by casts | 2   | 2   | 4     | tsc per workspace by code, S4-01       |
| R11 | TECH     | Hermes and Intl change breaks localization or plural rules                  | 2   | 2   | 4     | Localization flows mandatory each step |
| R12 | TECH     | iOS 16.4 floor or scene delegate breaks widget, watchOS or orientation      | 2   | 2   | 4     | S2-05, S4-04, watchOS lane             |
| R13 | TECH     | `NODE_ENV` forced by the CLI loads the wrong env file into a build          | 2   | 2   | 4     | S4-07                                  |
| R14 | OPS      | Linux PR jobs over 15 min p95 get slower as builds grow                     | 2   | 2   | 4     | C-02, p95 recorded each step           |

### Low-Priority Risks (Score 1 to 2)

| ID  | Category | Risk                                                                              | P   | I   | Score | Action                                  |
| --- | -------- | --------------------------------------------------------------------------------- | --- | --- | ----- | --------------------------------------- |
| R15 | TECH     | Reanimated 4.7 drops `zIndex` from sync props, so an animation's stacking changes | 1   | 2   | 2     | S4-08 grep guard plus visual check      |
| R16 | TECH     | AC5 Expo internals move                                                           | 1   | 2   | 2     | S4-09                                   |
| R17 | BUS      | RevenueCat 11 changes the purchase or complimentary flow                          | 1   | 2   | 2     | `premium-subscription.yaml`, 6.14 flows |

### Risk Category Legend

TECH: technical or architecture. DATA: data integrity or loss. OPS: CI, build, deployment. BUS: business logic.

## Entry Criteria

- The spec is approved with TEA-01, TEA-02, TEA-03, TEA-04, TEA-07 and TEA-09 applied to the frozen block.
- For Step 0: an isolated `DATABASE_URL` is available for Playwright, and an Android emulator (API 36 and API 32) plus an iOS 26.1 simulator are available on this machine.
- For Step 2: the D6 runner move is merged or its fallback is recorded (TEA-04).

## Exit Criteria (per step)

The step's row in the gate matrix below is fully green on the PR head SHA:

- Dispatch run URLs are linked in the PR (TEA-10), and the next nightly on `main` is green before the following step starts.
- Every flake met is fixed and burned in by TEA (see Flake policy).
- The step's PR job p95 table is appended to the spec.

## Gate matrix per step

"Every step" means each of Steps 0 to 4.
A cell lists what must be green; "dispatch" means a `workflow_dispatch` on the step head.

| Gate                            | How                                                                                                                                                                                                           | Steps                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `npx expo-doctor` zero findings | Local, logged in PR                                                                                                                                                                                           | Every step                                        |
| Typecheck by code               | `npm exec -- tsc --noEmit -p <tsconfig>` in `apps/mobile`, `apps/web`, `apps/api` and every package; only the known symlink TS2742 allowed; count by code recorded. Rebuild `packages/api-client` dist first. | Every step                                        |
| Unit                            | `npm exec -- vitest run` in every workspace; `apps/mobile` `test:widget-prebuild`, `test:watchos-prebuild`, `test:share-card-prebuild`                                                                        | Every step                                        |
| Node-test-gate                  | Every suite in `scripts/ci/node-test-suites.json`, run blocks included                                                                                                                                        | Every step                                        |
| New guards                      | Expo Go pin (TEA-05), font-scale reads (TEA-06), React parity (TEA-14), AAB ABI check (TEA-11)                                                                                                                | Added Step 0 (TEA-11 at Step 1), every step after |
| Web e2e                         | PR workflows `pr-pw-e2e-local` and the Vercel preview; locally only with isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true`                                                                          | Every step (React moves)                          |
| Contract                        | `contract-testing.yml`                                                                                                                                                                                        | Every step                                        |
| Maestro Android (Expo Go)       | `pr-mobile-e2e`, all 9 shards, Expo Go pinned to the step's SDK                                                                                                                                               | Every step                                        |
| Maestro iOS (Expo Go)           | `ios-expo-go` dispatch                                                                                                                                                                                        | Every step                                        |
| Android native                  | Prebuild `--clean`, Debug and Release (x86_64 in CI); all-ABI `bundleRelease` (TEA-11); `pr-share-card-native` dispatch: API32 shards, API36 matrix, original, controls, interaction, release-font            | Every step                                        |
| iOS native                      | Prebuild `--clean`, Debug and Release; `ios-build` and `ios-shard` dispatch, or local Xcode 27.2 with identity until TEA-04 clears                                                                            | Every step                                        |
| watchOS and widgets             | `watchos-native` dispatch; `widget-deep-link.yaml`                                                                                                                                                            | Every step                                        |
| Share card save                 | Android 13+ and iOS add-only save journeys in the share-card lanes, plus `share-card-export.yaml`                                                                                                             | Every step; Step 2 is the API change              |
| Accessibility focus             | `pr-accessibility-focus` Android (TalkBack, Robolectric), iOS module, `ios-app-build` dispatch                                                                                                                | Every step                                        |
| Live font proof                 | F-01 to F-08 on Android API 36 and iOS 26.1, Debug and Release. Below 0.87 it asserts the bug signature; Step 4 asserts the fix (TEA-01)                                                                      | Every step                                        |
| Large-text matrix               | `story68-cold-font-scale.mjs` cold matrix                                                                                                                                                                     | Every step                                        |
| CI timing                       | `pr-job-p95.mjs` table for the step's PR runs; `pr-job-ceilings.test.mjs`                                                                                                                                     | Every step after Step 0 CI work                   |

## Test Catalog

Priorities: P0 blocks the step, P1 blocks story sign-off, P2 is recorded.

### Live font-scale proof (`scripts/lib/live-font-scale-proof.mjs`, `.test.mjs`, driver `scripts/run-live-font-proof.mjs`, Maestro anchors `maestro/live-font/*.yaml`)

| ID   | Priority | Test                                                                                                                                                                                                                                              |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-00 | P0       | Oracle unit tests on recorded hierarchies: the 6.8 baseline fixture (43 nodes, 169 px) classifies as the bug signature; a cold 1.0 and 1.5 pair classifies as correct; a 44-to-5 blank fixture fails "Anchors"; a restart fixture fails "Process" |
| F-01 | P0       | Positive control on SDK 54: cold 1.0 against cold 1.5 per screen passes "Full text" and "Growth" (TEA-02)                                                                                                                                         |
| F-02 | P0       | Android Release, Home: live 1.0 to 1.5, then back to 1.0                                                                                                                                                                                          |
| F-03 | P0       | Android Release, Community feed: live up and down (test member with 6.14 grant)                                                                                                                                                                   |
| F-04 | P0       | Android Release, Settings: live up and down                                                                                                                                                                                                       |
| F-05 | P0       | Android Release, composer with card rendered and a feedback message showing: live up and down; card state kept; Save and Share bounds unchanged; action rows re-tier                                                                              |
| F-06 | P0       | iOS Release, same four screens: `large` to `extra-extra-extra-large` to `accessibility-medium` and back (TEA-03)                                                                                                                                  |
| F-07 | P1       | Debug dev client, both platforms, same four screens                                                                                                                                                                                               |
| F-08 | P1       | Light and dark, Release, screenshots stored beside node counts, heights and PIDs                                                                                                                                                                  |

Stability rule: the proof runs 3 times consecutively per platform at Step 4 with identical verdicts before Step 4 merges.

### Background task and upgrade (`src/lib/background-task.test.ts`, `plugins` prebuild spec, `scripts/run-upgrade-proof.mjs`)

| ID    | Priority | Test                                                                                                                                                                                                                                                                                           |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-05 | P0       | Unit: with the old name registered, launch unregisters it, then registers the new name; an unregister throw is caught and logged, and registration still happens                                                                                                                               |
| P0-06 | P0       | Prebuild spec: iOS Info.plist has `processing` and the task identifier in `BGTaskSchedulerPermittedIdentifiers`, and no `fetch`; Android manifest has no background-fetch receiver                                                                                                             |
| P0-07 | P0       | Android in-place upgrade, `a01e0307` Release to Step 0 Release, same keystore. Signed in with fetch registered: install over; cold start; `adb reboot`. Logcat has no `ClassNotFoundException` and no crash; `dumpsys jobscheduler` shows exactly one job for the package; the session is kept |
| P0-08 | P0       | iOS simulator in-place upgrade, same shape; the session is kept; the task identifier is registered                                                                                                                                                                                             |
| U-01  | P0       | Debug: `triggerTaskWorkerForTestingAsync()` runs the ritual task: fetches when the cache is stale, no fetch when fresh, no fetch with no session                                                                                                                                               |
| U-02  | P1       | Unit parity: the existing `background-fetch.test.ts` cases are ported one to one, with result enums mapped                                                                                                                                                                                     |
| U-03  | P0       | D7 54 to 58 upgrade (TEA-08): session, ritual cache read with no network, one task                                                                                                                                                                                                             |
| U-04  | P1       | Unit: the SecureStore key names and options used for auth storage are pinned by a spec, so a rename across steps is caught                                                                                                                                                                     |

### Step-specific checks

| ID    | Step   | Priority | Test                                                                                                                                                                                                          |
| ----- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0-01 | 0      | P0       | `app.json` keys removed: prebuild output on SDK 54 is byte-identical before and after (`diff -r` of both native trees, recorded hash)                                                                         |
| S1-01 | 1      | P0       | React parity guard green; web build and web e2e on React 19.2.0                                                                                                                                               |
| S2-01 | 2      | P0       | No `@react-navigation/*` import in app code (grep test); the router codemod compiles; `share-card-tab-heading.test.tsx` green                                                                                 |
| S2-02 | 2      | P0       | TypeScript decision recorded with a by-code tsc count on both versions                                                                                                                                        |
| S2-03 | 2      | P0       | Async `copy` and `move` awaited: units for `share-card-file.ts`, `palette-advisor-screen.tsx`, `garment-capture-modal.tsx`, `silhouette-editor.tsx`, with a rejected promise reaching the existing error path |
| S2-04 | 2      | P0       | `share-card-save.native.ts` on the new asset API: units for success, add-only grant, refusal; native save journeys on both platforms                                                                          |
| S2-05 | 2      | P0       | `with-supported-ios-target.js` floor 16.4 on app, widget and watch targets (plugin spec); watchOS lane                                                                                                        |
| S2-06 | 2      | P1       | Maestro: network timeout shows the error state on the dev client (TEA-12)                                                                                                                                     |
| S3-01 | 3      | P0       | Clean-prebuild default: every config plugin spec re-run against a fresh tree; the native tree checked-in policy unchanged                                                                                     |
| S4-01 | 4      | P0       | Strict TypeScript API on, with no opt-out flag in any tsconfig (grep test)                                                                                                                                    |
| S4-02 | 4      | P0       | `write` awaited (SDK 58 file system), with a unit for each caller                                                                                                                                             |
| S4-03 | 4      | P0       | Async `renderRouter` in tests; deep-link, widget-deep-link and back-navigation flows green                                                                                                                    |
| S4-04 | 4      | P0       | `SceneDelegate.swift` generated; `modal-system-bars` and `accessibility-focus` iOS modules find the key window (XCTest on the module, VoiceOver focus journey)                                                |
| S4-05 | 4      | P0       | Android toolchain: Robolectric and module unit tests on AGP 9.2.1 and Kotlin 2.2.0                                                                                                                            |
| S4-06 | 4      | P0       | R8 Release: purchase sheet opens and the complimentary state reads; PostHog event reaches the local capture stub; the four local modules respond. Keep-rule spec lists every reflective class                 |
| S4-07 | 4      | P0       | Env-file spec: `expo start`, `expo export`, `eas build --profile production` each load the pinned file; a missing API base URL fails fast                                                                     |
| S4-08 | 1 to 4 | P2       | `zIndex` in animated styles: grep guard plus the screenshot pair on the affected screens                                                                                                                      |
| S4-09 | 4      | P0       | AC5: both internal imports resolve under SDK 58; the console guard fails a seeded missing-`ExponentConstants` warning                                                                                         |
| S4-10 | 4      | P0       | D5 verdict measurements per TEA-13, written into the spec table                                                                                                                                               |

### CI timing (`scripts/ci/pr-job-p95.mjs` and test)

| ID   | Priority | Test                                                                                                                      |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| C-01 | P0       | Unit: p95 nearest-rank, both queue definitions, a job with `needs`, cancelled and skipped runs excluded                   |
| C-02 | P0       | Per step: every PR job, queue plus run, p95 at most 15 and max at most 20 (owner queue definition)                        |
| C-03 | P0       | `macos-26` and `macos-15` probe, about 10 runs each, queue p50 and p95 recorded (D6.5)                                    |
| C-04 | P0       | Consolidated iOS job: 20 consecutive PR runs meet C-02, or it moves to main plus nightly with the numbers logged (TEA-09) |
| C-05 | P1       | `pr-job-ceilings.test.mjs` updated when workflows change, plus every spec that reads a changed workflow file              |

### D7 production-shaped run (`_bmad-output/test-artifacts/story-6-15/d7/`)

| ID    | Priority | Test                                                                                                                                                                                                    |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D7-01 | P0       | Build identities: EAS build ids, AAB and universal APK SHA-256, certificate SHA-256, `ReactNativeVersion`, all-ABI listing; iOS `production-simulator` app digest                                       |
| D7-02 | P0       | Production API and Supabase, dedicated test member with 6.14 grant: sign-in, session restore after force-stop, Home ritual, Community feed, share-card save and share, Settings, push permission prompt |
| D7-03 | P0       | F-02 to F-06 on the production builds                                                                                                                                                                   |
| D7-04 | P0       | R8 checks from S4-06 on the production AAB                                                                                                                                                              |
| D7-05 | P0       | U-03 in-place upgrade from the EAS production build of the last deployed SDK 54 commit                                                                                                                  |
| D7-06 | P1       | Play internal track submit and TestFlight internal build when credentials allow; otherwise recorded with the reason                                                                                     |
| D7-07 | P0       | Evidence scrub: a scan for tokens, emails, member ids and JWT shapes over the evidence dir is clean before commit                                                                                       |

### Documents

- D8 learning path Step 55 and test cross-links; the deployment guide mobile section.
- Spec Verification commands updated for the new scripts.

## Red-first plan and seeded-defect proofs

| Test                   | Red proof                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-00 oracle            | Feed the 6.8 baseline as "fix expected": it must fail "Cold parity" and "Growth"                                                                         |
| F-01 to F-06 at Step 0 | Run with `fixExpected` forced true on SDK 54: must fail with the 6.8 signature (heights fixed, nodes kept). Then the real run passes as characterization |
| F at Step 4            | Run the characterization branch against SDK 58 before deleting it: must fail on "heights grow". This proves the flip is real and not an oracle no-op     |
| TEA-06 guard           | Seed an `AppText` that multiplies by `fontScale`: red                                                                                                    |
| TEA-05 pin             | Bump `expo` without the Expo Go pin: red                                                                                                                 |
| TEA-14 parity          | Move `react` in one workspace only: red                                                                                                                  |
| P0-05                  | Remove the unregister call: the upgraded-install unit fails                                                                                              |
| P0-07                  | Keep the old task name: `dumpsys` shows the stale consumer, and the proof fails                                                                          |
| S4-06                  | Remove one keep rule: the Release journey fails                                                                                                          |
| S4-09                  | Point the alias at a missing path: the suite fails through the `globalThis.expo` guard                                                                   |

Red proofs run in a throwaway worktree or a reverted temporary commit, never with stash or reset in the shared checkout.

## Flake policy

TEA owns every flaky or unrelated red check met during the story:

1. Root cause from run artifacts and probe headers first.
2. Fix.
3. Burn in with the same shard shape CI uses (`playwright-smart-parallelization` with `$PSP_ARGS` for Playwright; 10 consecutive Maestro runs for a flow).
4. Record in the spec's Review Triage Log.

Nothing is retried green, quarantined or marked `continue-on-error`.

## Quality Gate Criteria

### Pass/Fail Thresholds

- P0: 100% pass on the step head SHA. P1: 100% pass before story sign-off. P2: recorded.
- Every high risk (R01 to R08) has its mitigating tests green at the step that owns it.

### Non-Negotiable Requirements

- The AC3 proof is green in Release on both platforms against production in D7.
- In-place upgrade keeps the session and exactly one background task.
- No PR job over 20 minutes including queue; p95 at most 15.

## Traceability

| AC or decision                  | Tests                                                         |
| ------------------------------- | ------------------------------------------------------------- |
| AC1                             | Gate matrix doctor, prebuild, builds; TEA-11 ABI check; D7-01 |
| AC2                             | TEA-06 guard, S4-10, TEA-13 measurements                      |
| AC3                             | F-00 to F-08, D7-03                                           |
| AC4                             | Gate matrix, TEA-10 dispatch evidence, flake policy           |
| AC5                             | S4-09                                                         |
| D4 rows                         | P0-05 to P0-08, S0-01, S2-01 to S2-06, S3-01, S4-01 to S4-08  |
| D6                              | C-01 to C-05                                                  |
| D7                              | D7-01 to D7-07, U-03                                          |
| I/O "Live font down"            | F-02 to F-06 return leg                                       |
| I/O "Cold launch at 1.5"        | Cold parity oracle                                            |
| I/O "Composer mid-flow"         | F-05                                                          |
| I/O "Activity recreation"       | TEA-13 row 4 measurement, existing 6.8 recreation journey     |
| I/O "In-place upgrade"          | P0-07, P0-08, U-03                                            |
| I/O "Background task"           | U-01                                                          |
| I/O "Share-card save"           | S2-04                                                         |
| I/O "Env file selection"        | S4-07                                                         |
| I/O "iOS scene lifecycle"       | S4-04, widget and watchOS lanes                               |
| I/O "Release with R8"           | S4-06, D7-04                                                  |
| I/O "Vitest Expo web setup"     | S4-09                                                         |
| I/O "iOS job queue over budget" | C-03, C-04                                                    |

## Execution record

(Filled in per step: test files, run URLs, p95 tables, seeded-defect results, differences from the plan.)
