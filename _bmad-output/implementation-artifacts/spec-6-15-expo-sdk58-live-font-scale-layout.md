---
title: 'CC-6.15 Expo SDK 58 upgrade for live font-scale layout'
type: 'upgrade'
ticket: '6-15-expo-sdk58-live-font-scale-layout'
created: '2026-11-12'
status: 'drafted'
baseline_revision: 'a01e03072885f747d18ffb7246fe2ea235c9efb7'
route: 'full'
route_source: 'owner'
risk: 'high'
review: 'thorough'
review_source: 'owner'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/_bmad-output/implementation-artifacts/story-6-15/preflight-expo-sdk-58.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-8-safe-branded-share-card-export.md'
  - '{project-root}/_bmad-output/project-knowledge/deployment-guide.md'
  - '{project-root}/_bmad-output/test-artifacts/ci-cd-pipeline.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On Expo SDK 54 with React Native 0.81.5, Fabric keeps the font scale a text node was first measured with.
A member who raises the system text size while the app runs sees enlarged glyphs drawn into boxes of the old height, so Home, Community, Settings and the share-card composer clip text until the next cold launch.

Failing baseline, recorded by Story 6.8 on 2026-10-26 (the facts file sits untracked in the main checkout, so the numbers are quoted here):

| Fact                    | Value                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Source                  | `main` at `1d7b98485485c224063b573207c7e78bace717be`                                                           |
| Build                   | Android non-debuggable Release APK, SHA-256 `4204ce439f736a3534f5e3de7b42e49ee36810f3767cb890c2b23854626ce382` |
| Live change             | System font scale 1.0 to 1.5 with the app in the foreground                                                    |
| Visible text nodes      | 43 before, 43 immediately after, 43 after settling                                                             |
| Process                 | PID 19127 before and after (no restart)                                                                        |
| Temperature text height | 169 px before and after (no growth)                                                                            |
| Screenshots             | Enlarged glyphs clipped inside unchanged boxes                                                                 |
| Rejected repair         | Shared `AppText` repair kept 44 nodes before and only 5 after; reverted in `51d29f19`                          |

The upstream fix is React Native commit `45904c866882f136edde55df2fe453327057d387` ("Fix Fabric reusing nodes with a stale font scale", #57246).
It first ships in stable 0.87.0 and is present through 0.88.1.
`enableFontScaleChangesUpdatingLayout` is false on 0.81.5 and true on 0.87 and 0.88; commit `4b2aef2` removes the flag in 0.89.
Expo SDK 57 pins 0.86.3, which lacks the fix. Expo SDK 58 pins 0.88.1 with React 19.3.0 (`expo@58.0.25`, read from the `sdk-58` `bundledNativeModules.json` on 2026-11-12).

**Approach:** One story, five sequential steps: pre-work on SDK 54, then SDK 55, 56, 57 and 58, one SDK at a time as Expo recommends.
Each step is its own pull request, merged to `main` through the full merge gate before the next step starts, so `main` holds a green, shippable app at every SDK.
The live font-scale proof is written red against SDK 54 in Step 0 and turns green at Step 4.

Decisions (owner direction 2026-11-12; the rest delegated to the builder):

- D1 Steps. Exit gate for every step: `npx expo-doctor` with zero findings, fresh `expo prebuild --clean` on both platforms, Debug and Release builds on Android and iOS, every suite in D9 green, the merge gate in Boundaries, and the step's row in the table ticked with its PR number.

  | Step | Target                           | Contents                                                                                                                                                                                                                                                                                                      |
  | ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 0    | SDK 54, RN 0.81.5, React 19.1.0  | macOS queue probe and CI consolidation (D6, after the owner's go); `expo-background-fetch` to `expo-background-task`; delete `newArchEnabled` and `edgeToEdgeEnabled` from `app.json` with an unchanged prebuild; in-place upgrade proof (D4); live font-scale proof as a version-keyed characterization (D5) |
  | 1    | SDK 55, RN 0.83.10, React 19.2.0 | `expo install expo@^55 --fix`; module majors; React moves across the monorepo (D3)                                                                                                                                                                                                                            |
  | 2    | SDK 56, RN 0.85.3, React 19.2.3  | expo-router codemod to `expo-router/react-navigation` and drop `@react-navigation/native`; `expo-media-library` save on the new API; iOS minimum 16.4; `expo/fetch` global; async file-system calls; TypeScript decision (D3)                                                                                 |
  | 3    | SDK 57, RN 0.86.3, React 19.2.3  | prebuild cleans native folders by default; config plugins re-proved against a clean tree                                                                                                                                                                                                                      |
  | 4    | SDK 58, RN 0.88.1, React 19.3.0  | Strict TypeScript API; expo-router 57 to 58; `SceneDelegate.swift`; R8 keep rules; RevenueCat 11; `NODE_ENV` env-file selection; font workaround verdicts (D5); live font proof asserts the fix and its below-0.87 branch is deleted; production-shaped sign-off (D7)                                         |

  Step 2 entry criterion (TEA-04): SDK 56 needs Xcode 26.4 and `macos-15` tops out at 26.3, so the D6 runner move to `macos-26`, or D6's fallback, lands before Step 2 opens. Until it does, Step 2 iOS builds come from local Xcode 27.2 with the build identity recorded.

- D2 Upgrade method. `npx expo install expo@^5X --fix` in `apps/mobile`, then `npx expo-doctor`, then one lockfile regeneration from the root. Every Expo module, `react-native-reanimated`, `react-native-worklets`, `react-native-screens`, `react-native-safe-area-context`, `react-native-svg`, `react-native-web`, `@expo/vector-icons`, `babel-preset-expo` and `expo-dev-client` take the version the SDK's `bundledNativeModules.json` names. Third-party native libraries outside that list (`react-native-purchases`, `posthog-react-native`) float to their latest release that declares support for the step's React Native. No `overrides`, `resolutions` or `--legacy-peer-deps` to silence a peer conflict; a conflict is fixed at its source.
- D3 One React across the monorepo. `apps/web` (Next 15.5.25) and `apps/mobile` share the hoisted React today (19.1.0). Each step moves `react`, `react-dom`, `react-test-renderer` and `@types/react` in every workspace to the SDK's React, and the web suites run in that step. TypeScript stays one version for the monorepo (root `5.9.3`); Step 2 moves the whole monorepo to the version SDK 56 types require, or records that 5.9.x compiles them.
- D4 Breaking changes this app hits, with the step that handles each:

  | Area                          | Step | Handling                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
  | ----------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `expo-background-fetch`       | 0    | Move `src/lib/background-fetch.ts` to `expo-background-task` under a new task name, because registration skips a name already registered and `expo-task-manager` persists the old consumer; unregister the old name on first launch, tolerating a missing consumer; a prebuild spec checks `processing`, `BGTaskSchedulerPermittedIdentifiers` and that `fetch` is gone; in-place upgrade from an `a01e0307` build to the Step 0 build proved on both platforms (TEA-07) |
  | `app.json` removed keys       | 0    | Delete `newArchEnabled` and `edgeToEdgeEnabled`; prebuild output on SDK 54 is byte-identical before and after                                                                                                                                                                                                                                                                                                                                                            |
  | expo-router navigation import | 2    | Codemod `app/_layout.tsx`, `components/share-card-tab-heading.tsx`, `src/theme/theme-context.tsx` comment and their tests; remove `@react-navigation/native`                                                                                                                                                                                                                                                                                                             |
  | `expo-media-library` save     | 2    | `share-card-save.native.ts` saves with the new asset API; the 6.8 add-only permission behavior and its specs stay intact                                                                                                                                                                                                                                                                                                                                                 |
  | `expo-file-system`            | 2, 4 | Delete `expo-file-system-legacy.d.ts` when the package types `expo-file-system/legacy` itself; await the async `copy`, `move` (56) and `write` (58) calls                                                                                                                                                                                                                                                                                                                |
  | Minimum iOS 16.4              | 2    | `plugins/with-supported-ios-target.js` floor 15.1 to 16.4; widget and watchOS targets follow; plugin tests updated                                                                                                                                                                                                                                                                                                                                                       |
  | `expo/fetch` global           | 2    | Mobile API client, Supabase client and MSW-based specs proved on the new global                                                                                                                                                                                                                                                                                                                                                                                          |
  | expo-router 58                | 4    | Async `renderRouter` in tests; `initialRouteName` removal; navigation core migration guide applied                                                                                                                                                                                                                                                                                                                                                                       |
  | iOS 27 scene lifecycle        | 4    | Generated `SceneDelegate.swift`; widgets, watchOS, orientation lock, `modal-system-bars` and `accessibility-focus` iOS modules proved on the scene window                                                                                                                                                                                                                                                                                                                |
  | Strict TypeScript API (0.87)  | 4    | Opt in; fix deep imports and ref types; no opt-out flag                                                                                                                                                                                                                                                                                                                                                                                                                  |
  | Android toolchain             | 4    | AGP 9.2.1, Gradle 9.4.1, Kotlin 2.2.0, compileSdk 37, targetSdk 36; local Kotlin modules fixed for `AppContext` changes                                                                                                                                                                                                                                                                                                                                                  |
  | R8 in Release                 | 4    | Keep rules for RevenueCat, PostHog and the four local modules; proved by the Release journeys in D9                                                                                                                                                                                                                                                                                                                                                                      |
  | `NODE_ENV` forced by CLI      | 4    | `app.config.ts` picks `.env.prod` or `.env.preview` by `NODE_ENV`; a spec pins which file each CLI command loads                                                                                                                                                                                                                                                                                                                                                         |
  | `react-native-purchases` 11   | 4    | Take 11 (Play Billing 9, Kotlin 2.1+); the 6.14 complimentary and paid flows re-proved                                                                                                                                                                                                                                                                                                                                                                                   |
  | Reanimated 4.7 `zIndex`       | 1-4  | Every animated style using `zIndex` found and moved off the sync path                                                                                                                                                                                                                                                                                                                                                                                                    |
  | Vitest Expo web setup (AC5)   | 4    | Prove `expo-modules-core/src/polyfill/dangerous-internal` and the `ExponentConstants.web` alias in `vitest.config.ts` resolve on SDK 58; re-point if moved                                                                                                                                                                                                                                                                                                               |

- D5 Font workarounds (AC2). Story 6.8 left these, each with the verdict this story expects to confirm at Step 4:

  | Workaround                                                                                | Expected verdict | Reason                                                                                                                                                              |
  | ----------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Shared `AppText` repair and its 27 import migrations                                      | Already gone     | Reverted in `51d29f19`; `scripts/ci/font-scale-reads.test.mjs` allows font-scale reads only at the three composer sites (TEA-06)                                    |
  | `feedbackSlotHeight` in `components/share-card-composer.tsx`                              | Keep             | Reserves the feedback slot so Save and Share never move (iPad popover anchor); a layout rule, independent of the renderer bug                                       |
  | `actionRowTier` and `useActionColumns` re-measure on `fontScale` change                   | Keep             | Chooses halves, content or stacked rows from measured labels; needs the live `fontScale` from `useWindowDimensions` either way                                      |
  | Android Activity recreation restore (route, Spotlight detail, composer)                   | Keep             | Locale, permission revocation and memory pressure also recreate the Activity; record whether a font change still recreates it on 0.88                               |
  | 6.8 Release proof wording "no claim that clipping is fixed" and harness allowances for it | Remove           | `scripts/lib/story68-release-live-font.mjs` asserts the fix; `story68-cold-font-scale.mjs` stays as the cold-parity reference, retargeted to assert growth (TEA-13) |

  Step 4 records the observed verdict for each row; a row that turns out unnecessary is deleted with its tests in the same step.
  Step 0 adds the live font-scale proof for AC3 on Home, Community, Settings and the composer (TEA-01). It reads `fixExpected` from the bundled `ReactNativeVersion` (0.87.0 or above). Below 0.87 it asserts the exact 6.8 bug signature and passes, so any other outcome is red, an early fix included. Steps 0 to 3 run it green on that branch; Step 4 deletes the below-0.87 branch, and from then on it asserts the fix.
  The oracle has five parts (TEA-02): an anchor set above the fold; the full-screen text multiset by scroll-through; live heights equal to cold-launch heights at the same scale (within 2 px on Android, 1 pt on iOS); single-line text growth of at least 0.9 times the scale ratio; an unchanged PID. Before it judges any build, an SDK 54 cold launch at 1.0 against a cold launch at 1.5 proves the oracle on a known-good pair.
  Scales (TEA-03): Android 1.0 to 1.5 and back. iOS has no 1.5 step, so `xcrun simctl ui content_size` runs `large` (1.0) to `extra-extra-extra-large` (1.353) to `accessibility-medium` (1.786) and back.
  Each Step 4 verdict in the table carries a measurement (TEA-13): Activity `onCreate` count and PID across a live font change, Save and Share bounds before and after.

- D6 CI shape (owner, 2026-11-12 3:35 PM CST). Public repo, hosted macOS capacity: the owner measured queue p50 11 s, p95 about 12 min, max 14 min on our last 45 macOS jobs, and on 2026-11-12 `ios-build` and watchOS on `main` queued from 3:28 PM with no other macOS job of ours running.
  1. At most one macOS job per pull request. It builds the iOS app once and runs, inside that job, the work of seven macOS jobs today: `watchos-native`, `pr-share-native-unit` Swift packages, `pr-share-card-native` `ios-build`, `ios-shard` and `ios-expo-go`, and `pr-accessibility-focus` `ios` and `ios-app-build`.
  2. It runs only when lane selection (`scripts/ci/lanes.mjs`, PR #212) reports changed native iOS inputs.
  3. Everything Linux can cover stays on Linux: Android builds and device lanes, web, JS units, Maestro Android.
  4. The 20-minute ceiling and the 15-minute p95 for every PR job include queue time.
  5. Before any job moves to `macos-26`, a probe workflow runs 20 times on `macos-26` and on `macos-15` (the owner asked for about 10; at 10 runs the nearest-rank p95 is the maximum), and its queue p50 and p95 are recorded in the table below. If `macos-26` queue p95 is over 5 minutes, the iOS job leaves the PR path for `main` plus nightly, and the Android lanes are the PR gate.

  Measured on 2026-11-12 from the last 30 runs per workflow (job `started_at` minus run `created_at` for queue; successful jobs only):

  | Job (runner)                               | Runs | Run p50 | Run p95 | Queue p95 |
  | ------------------------------------------ | ---- | ------- | ------- | --------- |
  | accessibility-focus iOS app build (mac 15) | 6    | 25.1    | 30.9    | 12.8      |
  | accessibility-focus iOS module (mac 15)    | 20   | 2.5     | 5.0     | 12.1      |
  | share-card `ios-shard` (mac 15)            | 6    | 35.7    | 44.4    | 26.4      |
  | share-card `ios-expo-go` (mac 15)          | 2    | 23.2    | 26.6    | 29.4      |
  | share-native Swift packages (mac 15)       | 21   | 2.0     | 2.4     | 14.2      |
  | watchOS native (mac 15)                    | 25   | 4.2     | 4.7     | 12.5      |
  | mobile-e2e-android (Linux, PR runs)        | 126  | n/a     | 16.4    | n/a       |
  | accessibility Android app build (Linux)    | 16   | n/a     | 17.7    | n/a       |
  | share-card `browser-acceptance` (Linux)    | 15   | n/a     | 17.7    | n/a       |

  Today's iOS app build and shard run past 20 minutes before any queue, so the one iOS job keeps the PR path only if both hold: the probe's `macos-26` queue p95 is 5 minutes or less, and 20 consecutive pull-request runs of the consolidated job show queue plus run p95 of 15 minutes or less and a maximum of 20. Otherwise it runs on `main` and nightly, and the story says so in the Plan Change Log with the numbers. Every p95 in this story comes from `scripts/ci/pr-job-p95.mjs` (with its test), which records queue as job start minus run creation, the owner's measure, and also job start minus job creation (TEA-09).
  The Linux jobs above 15 minutes p95 come under 15 in this story (build the APK once and reuse it, Gradle and compiler caches, Maestro sharding); the browser-acceptance cuts PR in flight now counts toward that.
  No file under `.github/workflows` changes until the owner says PR #212 and the browser-acceptance cuts PR have merged; the CI work in Step 0 starts from that `main`.

- D7 Production-shaped run before sign-off. After Step 4 merges and before the story moves to done:
  - Android: `eas build --platform android --profile production` (app bundle, R8, upload key, `environment: production`), turned into a universal APK with `bundletool` and installed on an emulator; submitted to the Play internal testing track when the existing submit credentials allow.
  - iOS: a new `production-simulator` EAS profile (`environment: production`, Release, `ios.simulator: true`), installed on a simulator; a TestFlight internal build too when EAS holds Apple credentials. What access does not allow is recorded with the reason, and the rest runs.
  - Both run against the production API and Supabase with one dedicated test member holding a 6.14 complimentary grant, so Community and the share-card composer are reachable with production flags unchanged.
  - The run covers the AC3 live font proof, sign-in and session restore, Home ritual, Community feed, a share-card save and share, Settings, push permission prompt, and an in-place upgrade that keeps the signed-in session and the background task registration. The "before" (last deployed SDK 54 commit) and the "after" both come from the EAS production profile under one certificate, both go through `bundletool`, and both certificate SHA-256 values are recorded; a Play-distributed APK cannot be the "before" (TEA-08).
  - Evidence (build ids, APK and app digests, screenshots, node counts, heights, PIDs) goes under `_bmad-output/test-artifacts/story-6-15/`, with no secret, token or member identity in it.
- D8 Learning path. `_bmad-output/project-knowledge/learning-path-step-by-step.md` gets Step 55 for this story, Step 54 moves to merged, and the new specs carry cross-link comments to Step 55.
- D9 Suites at every step. Every unit, integration, contract, Playwright, Maestro and node-test-gate suite stays green, including the native share-card journeys, the accessibility focus bridge (TalkBack and VoiceOver), the large-text matrix (`scripts/lib/story68-cold-font-scale.mjs`), the widget, watchOS and share-card prebuild plugin tests, and `tsc` in every workspace counted by error code.
- D10 No deferred work. Nothing from this story lands in `deferred-work.md`. Every `expo-doctor` finding, every deprecation warning that names our code in Metro, Gradle or Xcode output, and every flaky or red check met on the way is fixed inside the story (flakes go to TEA to fix and prove).

## Boundaries & Constraints

**Always:**

- One SDK per step, each step merged green before the next begins.
- Merge gate for every PR: green CI, Codex clear (owner routes Codex), a local code review at high effort, zero open review threads. CodeRabbit is not awaited.
- Versions float to what the SDK names; no pin is kept for its own sake.
- Playwright runs only with an isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true`.
- Times in reports and artifacts are Chicago local time.

**Never:**

- A React Native source build, renderer patch, `patch-package` on Expo or React Native, or an experimental native flag; Story 6.8 ruled those out.
- A skipped, quarantined, expected-failure or `continue-on-error` test to get a step green.
- An edit under `.github/workflows` before the owner's go.
- `git stash`, `git checkout --` or `git reset` in the shared checkout; AI attribution trailers in commits; a secret printed or committed.
- A change to `bmad/`.

## I/O & Edge-Case Matrix

| Scenario                        | Input / State                                                                                   | Expected Output / Behavior                                                                                                                               | Error Handling                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Live font up, Android Release   | App foreground on Home, Community, Settings, composer; 1.0 to 1.5                               | Anchors held; scroll-through text multiset unchanged; live heights equal cold-launch heights; growth at least 0.9 times the ratio; same PID; no clipping | N/A                                                                      |
| Live font up, iOS Release       | Same screens; `large` to `extra-extra-extra-large` (1.353) to `accessibility-medium` (1.786)    | Same as Android                                                                                                                                          | N/A                                                                      |
| Live font, Debug both platforms | Dev client, same screens                                                                        | Same as Release                                                                                                                                          | N/A                                                                      |
| Live font down                  | 1.5 back to 1.0                                                                                 | Heights shrink back; no stale tall boxes                                                                                                                 | N/A                                                                      |
| Cold launch at 1.5              | App killed, launched at 1.5                                                                     | Same layout as live change settled                                                                                                                       | N/A                                                                      |
| Composer mid-flow               | Card rendered, feedback copy showing, font changes                                              | Card state kept; Save and Share stay put; action rows re-tier                                                                                            | N/A                                                                      |
| Activity recreation             | Android locale change with Spotlight detail open                                                | Route and detail restored as in 6.8                                                                                                                      | N/A                                                                      |
| In-place upgrade                | SDK 54 build signed in, next build installed over it under the same certificate (Step 0 and D7) | Session kept, ritual cache read, one background task registered                                                                                          | Old task name unregistered on first launch, a missing consumer tolerated |
| Background task                 | OS wakes the ritual task                                                                        | Fetches and caches the ritual as the old background fetch did                                                                                            | No session: returns with no fetch                                        |
| Share-card save                 | Android 13+ and iOS add-only photo permission                                                   | Card saved through the new media-library API                                                                                                             | Permission refusal path unchanged from 6.8                               |
| Env file selection              | `expo start`, `expo export`, EAS production build                                               | Each loads the env file the pinning spec names                                                                                                           | Missing API base URL fails fast as today                                 |
| iOS scene lifecycle             | Widget tap, watch app, orientation lock                                                         | Deep link opens the right route; watch sync works; orientation held                                                                                      | N/A                                                                      |
| Release with R8                 | Production Android bundle                                                                       | RevenueCat, PostHog and local modules work                                                                                                               | Missing keep rule fails the Release journeys                             |
| Vitest Expo web setup           | SDK 58 packages installed                                                                       | Both internal imports resolve; missing-`ExponentConstants` warning still rejected                                                                        | Guard fails the suite if either moves                                    |
| iOS job queue over budget       | Probe `macos-26` queue p95 above 5 min                                                          | iOS job runs on `main` and nightly; Android lanes gate PRs                                                                                               | Recorded in the Plan Change Log                                          |

</frozen-after-approval>

## Code Map

Verified against `main` at `a01e0307`.

- `apps/mobile/package.json`: `expo ~54.0.36`, `react-native 0.81.5`, `react 19.1.0`, `react-native-reanimated 4.1.5`, `react-native-worklets 0.5.1`, `expo-router ~6.0.24`, `expo-background-fetch ~14.0.9`, `expo-media-library ~18.2.1`, `expo-file-system ~19.0.23`, `@react-navigation/native ^7.1.20`, `react-native-purchases ^10.7.0`, `posthog-react-native ^4.36.1`, `@expo/vector-icons 15.0.3`, `babel-preset-expo 54.0.12`.
- `apps/web/package.json` (:33 to :36): `next 15.5.25`, `react 19.1.0`, `react-dom 19.1.0`. Root `package.json` (:183): `typescript 5.9.3`.
- `apps/mobile/app.json`: `newArchEnabled` and `android.edgeToEdgeEnabled` to delete; plugin list.
- `apps/mobile/app.config.ts` (:8): env file chosen by `NODE_ENV`; (:16 to :27) Story 6.5 and 6.8 native test build switches; (:44) `with-story68-release-network` plugin.
- `apps/mobile/eas.json`: `development` and `production` profiles; add `production-simulator` (D7).
- `apps/mobile/src/lib/background-fetch.ts`, `app/_layout.tsx`, `src/screens/root-layout-startup.test.tsx`, `src/lib/background-fetch.test.ts`: background fetch to background task.
- `apps/mobile/app/_layout.tsx` (:7), `components/share-card-tab-heading.tsx` (:3), `src/theme/theme-context.tsx` (:7), `components/share-card-tab-heading.test.tsx`: `@react-navigation/native` imports.
- `apps/mobile/src/lib/share-card-save.native.ts` (:81 `saveToLibraryAsync`) and its spec.
- `apps/mobile/expo-file-system-legacy.d.ts`; legacy imports in `src/lib/share-card-file.ts`, `share-card-save.native.ts`, `share-card-share.native.ts`, `share-card-native-fixture.native.ts`; new API in `src/features/premium/palette-advisor-screen.tsx`, `components/wardrobe/garment-capture-modal.tsx`, `components/wardrobe/silhouette-editor.tsx`.
- `apps/mobile/plugins/with-supported-ios-target.js` (:17 to :18 floor 15.1), `with-widgets.js`, `with-watchos.js`, `with-share-card-permissions`, `with-story68-release-network.js` and their `node --test` specs; `targets/widgets`, `targets/watchos`.
- `apps/mobile/modules/accessibility-focus`, `modal-system-bars`, `share-card-native-share`, `share-card-photo-save`: Kotlin `appContext` use and Swift window access to re-prove.
- `apps/mobile/vitest.expo-env.setup.ts`, `vitest.config.ts` (:69 prebundle, :98 alias): AC5.
- `apps/mobile/components/share-card-composer.tsx` (:166 `feedbackSlotHeight`, :262 `actionRowTier`, :284 `useActionColumns`): D5.
- `scripts/lib/story68-release-live-font.mjs`, `story68-cold-font-scale.mjs` and fixtures, `scripts/run-story68-native.mjs`, `maestro/story68`: live and cold font proofs.
- `.github/workflows/watchos-native.yml`, `pr-share-native-unit.yml`, `pr-share-card-native.yml` (`ios-build`, `ios-shard`, `ios-expo-go`), `pr-accessibility-focus.yml` (`ios`, `ios-app-build`), `pr-mobile-e2e.yml`, `scripts/ci/lanes.mjs` (after #212), `scripts/ci/native-*`: D6, after the owner's go.
- `_bmad-output/project-knowledge/deployment-guide.md` (:245 to :265 mobile release), `learning-path-step-by-step.md` (Step 54 at :10356), `sprint-status.yaml` (:116).

## Tasks & Acceptance

**Execution:**

- [ ] Step 0, SDK 54 (PR 1 of 5)
  - [ ] Live font-scale proof for AC3 on Android and iOS, Debug and Release, keyed on `ReactNativeVersion`, green on SDK 54 by asserting the 6.8 bug signature; oracle proved first by the SDK 54 cold 1.0 against cold 1.5 control -- D5, TEA-01 to TEA-03.
  - [ ] `scripts/ci/font-scale-reads.test.mjs` guard, red on a seeded `AppText` -- D5, TEA-06.
  - [ ] `expo-background-task` replaces `expo-background-fetch` under a new task name, tolerant unregister of the old one, prebuild spec, in-place upgrade from an `a01e0307` build proved on both platforms -- D4, TEA-07.
  - [ ] `app.json` keys removed with a byte-identical prebuild -- D4.
  - [ ] After the owner's go: queue probe on `macos-26` and `macos-15`, numbers recorded in D6; consolidated iOS job behind lane selection, or `main` plus nightly per D6; Linux jobs over 15 minutes p95 brought under -- D6.
- [ ] Every step, as part of its merge gate (TEA-05, TEA-10, TEA-11, TEA-12, TEA-14):
  - [ ] `scripts/install-expo-go.mjs` Expo Go pin moved to the step's SDK, with a node test that the Expo Go major equals the `expo` major.
  - [ ] `workflow_dispatch` runs of `pr-share-card-native`, `pr-accessibility-focus` and `watchos-native` on the head SHA, linked in the PR, until the D6 workflows land; the first nightly on `main` green before the next step opens.
  - [ ] All-ABI `bundleRelease` checked by a script for four ABIs and the bundled `ReactNativeVersion`.
  - [ ] Maestro network-timeout check on the dev client; `localization.yaml` and `garment-capsule-localization-flow.yaml` run.
  - [ ] Node test that `react`, `react-dom`, `react-test-renderer` and `@types/react` match across workspaces and the lockfile.
- [ ] Step 1, SDK 55 (PR 2 of 5): upgrade, React 19.2.0 across the monorepo, suites green -- D2, D3, D9.
- [ ] Step 2, SDK 56 (PR 3 of 5), opened only after the `macos-26` move or D6 fallback (TEA-04): router codemod, media library, iOS 16.4, `expo/fetch`, async file system, TypeScript decision -- D3, D4.
- [ ] Step 3, SDK 57 (PR 4 of 5): clean-prebuild default, plugins re-proved -- D4.
- [ ] Step 4, SDK 58 (PR 5 of 5): every Step 4 row of D4, D5 verdicts recorded with their measurements, live font proof asserting the fix with its below-0.87 branch deleted, AC5 proved -- D4, D5.
- [ ] Production-shaped run on Android and iOS with evidence -- D7.
- [ ] Learning path Step 55, Step 54 to merged, test cross-links; deployment guide mobile section updated for SDK 58, `production-simulator` and the new CI shape; `sprint-status.yaml` -- D8.

**Acceptance Criteria:**

- Given the app on SDK 58 with React Native 0.88.x, when `npx expo-doctor` runs and Debug and Release builds are made for Android (every shipped ABI) and iOS, then doctor reports nothing and every build succeeds from a clean prebuild (AC1).
- Given each Story 6.8 font workaround, when Step 4 closes, then each is either deleted with its tests or kept with its recorded reason (AC2).
- Given Android and iOS, Debug and non-debuggable Release, when the system font scale changes live (Android 1.0 to 1.5; iOS `large` to `extra-extra-extra-large` to `accessibility-medium`) and back with Home, Community, Settings or the composer open, then the anchors hold, the scroll-through text multiset is unchanged, live heights equal cold-launch heights at that scale, single-line growth is at least 0.9 times the scale ratio, no text is clipped and the process id is unchanged (AC3).
- Given each of the five PRs, when CI runs, then every existing suite in D9 is green on that PR with no skipped, quarantined or expected-failure test, and the device lanes dispatched on the head SHA pass (AC4).
- Given SDK 58 packages, when the mobile vitest suite starts, then both Expo internal imports resolve and the console guard still rejects the missing-`ExponentConstants` warning (AC5).
- Given any pull request after Step 0, when CI runs, then at most one macOS job runs, only for native iOS input changes, and every PR job's queue plus run time, measured by `scripts/ci/pr-job-p95.mjs` over 20 consecutive runs, has p95 of 15 minutes or less and never exceeds 20 (D6).
- Given the production EAS builds, when the D7 run completes, then the AC3 proof and the listed journeys pass against production with the evidence recorded (D7).

## Implementation Notes

(Filled in during the build.)

## Plan Change Log

(TEA review entries go here as TEA-NN; entries marked (intent) change a frozen decision and the builder applies them there.)

TEA review, 2026-11-12, against `a01e0307`. Evidence for each entry is in `_bmad-output/test-artifacts/test-design/cc615-expo-sdk58-live-font-scale-test-design.md`.

- **TEA-01 (intent; D5, Boundaries, AC4).** Replace the named expected failure with a version-keyed characterization. The proof reads `fixExpected` from the bundled `ReactNativeVersion` (0.87.0 or above). Below it, the proof asserts the exact 6.8 bug signature and passes; any other outcome is red, including an early fix. Step 4 deletes the below-0.87 branch. Delete the Never-list exception for the expected failure; no step needs `continue-on-error` or a skip.
- **TEA-02 (intent; AC3, I/O matrix).** "Same visible text nodes" fails on a correct build. Grown layout pushes nodes below the fold, and `assertReleaseTextPreserved` (`scripts/lib/story68-release-live-font.mjs:33`) compares the on-screen multiset. The new oracle has five parts: an anchor set above the fold, the full-screen text multiset by scroll-through, live heights equal to cold-launch heights at that scale (2 px Android, 1 pt iOS), single-line growth of at least 0.9 times the scale ratio, and an unchanged PID. An SDK 54 cold 1.0 against cold 1.5 positive control proves the oracle first.
- **TEA-03 (intent; AC3 iOS, I/O matrix).** iOS has no 1.5 (`RCTAccessibilityManager.mm:260-271`). Use `xcrun simctl ui content_size`: `large` (1.0) to `extra-extra-extra-large` (1.353) to `accessibility-medium` (1.786) and back.
- **TEA-04 (intent; D1, D6).** SDK 56 needs Xcode 26.4 and every iOS job is on `macos-15` (26.3). Make the D6 runner move, or its fallback, an entry criterion for Step 2. Until then, Step 2 iOS builds come from local Xcode 27.2 with the build identity recorded.
- **TEA-05 (D9).** `scripts/install-expo-go.mjs:11` pins Expo Go 54.0.8 for `pr-mobile-e2e` and `ios-expo-go`, so each step moves the pin to its SDK. A node test asserts that the Expo Go major equals the `expo` major. AC3 proofs run only on our dev client and Release builds.
- **TEA-06 (D5 row 1).** The guard spec D5 cites does not exist. TEA adds `scripts/ci/font-scale-reads.test.mjs`, which allows `fontScale`, `getFontScale`, `maxFontSizeMultiplier` and `allowFontScaling` only at the three composer sites, each with its reason. A seeded `AppText` must turn it red.
- **TEA-07 (intent; D4).** `registerBackgroundFetchAsync` skips registration when the name is already registered (`background-fetch.ts:62-72`), and `expo-task-manager` persists the old consumer. Use a new task name, and keep an unregister that tolerates a missing consumer. A prebuild spec checks `processing`, `BGTaskSchedulerPermittedIdentifiers` and that `fetch` is gone. Prove the in-place upgrade at Step 0 on both platforms (`a01e0307` build to the Step 0 build), as well as at D7.
- **TEA-08 (D7).** `adb install -r` needs one certificate. Build the "before" (last deployed SDK 54 commit) and "after" from the EAS production profile, convert both with `bundletool`, and record both certificate SHA-256 values. A Play-distributed APK cannot be the "before".
- **TEA-09 (intent; D6).** With 10 runs, nearest-rank p95 is the maximum. Require 20 consecutive PR runs. Numbers come only from `scripts/ci/pr-job-p95.mjs` (with a test), which records the owner's queue figure (job start minus run creation) and job start minus job creation.
- **TEA-10 (AC4, D9).** Device lanes skip on `pull_request`. Until the D6 workflows land, each step's merge gate includes `workflow_dispatch` runs of `pr-share-card-native`, `pr-accessibility-focus` and `watchos-native` on the head SHA, linked in the PR. The first nightly on `main` must be green before the next step.
- **TEA-11 (AC1).** CI builds one ABI (`-PreactNativeArchitectures=x86_64`, host ABI in `story68-native-build.mjs:130`). Each step runs an all-ABI `bundleRelease` checked by a script for four ABIs plus the `ReactNativeVersion`.
- **TEA-12 (D4, SDK 56).** `expo/fetch` and Hermes changes have no device coverage in vitest. Add a Maestro network-timeout check on the dev client; `localization.yaml` and `garment-capsule-localization-flow.yaml` are mandatory every step.
- **TEA-13 (D5).** Each Step 4 verdict carries a measurement: Activity `onCreate` count and PID on a live font change, Save and Share bounds before and after. Row 5 becomes "keep `story68-cold-font-scale.mjs` as the cold-parity reference, retargeted to assert growth"; only the 6.8 wording and allowances in `story68-release-live-font.mjs` go.
- **TEA-14 (D3).** `react-test-renderer` 19.1.0 (`apps/mobile/package.json:90`) moves with React. A node test asserts that `react`, `react-dom`, `react-test-renderer` and `@types/react` are identical across workspaces and the lockfile.

Builder, 2026-11-12: TEA-01, TEA-02, TEA-03, TEA-04, TEA-07 and TEA-09 applied to the frozen block; TEA-06, TEA-08 and TEA-13 also folded into D5 and D7 where the frozen text named the old approach; the rest are in Tasks and Acceptance.

## Review Triage Log

(Filled in per review pass.)

## Test Design (TEA)

Full plan: `_bmad-output/test-artifacts/test-design/cc615-expo-sdk58-live-font-scale-test-design.md` (17 risks: 8 high, 6 medium, 3 low).

**Gates at every step (0 to 4), on the PR head SHA:**

- Static: `expo-doctor` zero findings, plus `tsc` in every workspace counted by error code (rebuild `packages/api-client` dist first; only the symlink TS2742 is allowed).
- Unit and node-test-gate: vitest in every workspace, the plugin prebuild specs, every suite in `node-test-suites.json`, and the new guards for the Expo Go pin, font-scale reads, React parity and the ABI check.
- Web: `pr-pw-e2e-local`, the Vercel preview e2e and contract tests. Local Playwright runs only with an isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true`.
- Maestro: Android on Expo Go (all 9 shards) and `ios-expo-go`, with the Expo Go pin at the step's SDK. The localization flows are mandatory.
- Native, through dispatch until D6 lands:
  - `pr-share-card-native`: every API32 and API36 lane, `ios-build` and `ios-shard`.
  - `pr-accessibility-focus`: TalkBack, Robolectric, the iOS module and `ios-app-build`.
  - `watchos-native`, plus the all-ABI `bundleRelease`.
  - The share-card save journeys on both platforms.
- Live font proof on Android API 36 and iOS 26.1, Debug and Release, on Home, Community, Settings and the composer. Below RN 0.87 it asserts the 6.8 bug signature; from Step 4 it asserts the fix. Step 4 needs 3 consecutive identical runs per platform.
- Large-text cold matrix.
- CI timing: the `pr-job-p95.mjs` table appended per step. Every PR job's queue plus run p95 is 15 minutes or less, and the maximum is 20 or less.

**Step-specific (P0):**

- Step 0: the oracle unit tests and the SDK 54 positive control; the background-task units, prebuild spec and in-place upgrade on both platforms; a byte-identical prebuild after the `app.json` key removal.
- Step 1: React parity and web on 19.2.0.
- Step 2:
  - No `@react-navigation/*` import in app code.
  - The TypeScript decision, with tsc counts on both versions.
  - Async `copy` and `move`.
  - The media-library save on the new API.
  - The iOS 16.4 floor on all three targets.
  - The network-timeout Maestro check.
- Step 3: every config plugin spec on a clean tree.
- Step 4:
  - The Strict TypeScript API with no opt-out.
  - Async `write` and async `renderRouter`.
  - The scene delegate with the window lookups for the iOS modules.
  - The AGP 9 and Kotlin 2.2 module tests.
  - R8 Release checks for purchase, PostHog and the four modules.
  - The env-file spec, the AC5 proof, and the D5 verdict measurements.

**Before sign-off (D7):**

- Build identities and the all-ABI listing.
- The AC3 proof on the production builds.
- Sign-in, session restore, Home, Community, share-card save and share, Settings and the push prompt against production, using the 6.14 test member.
- R8 checks.
- The 54 to 58 in-place upgrade under one certificate.
- An evidence secret scan before commit.

**Red proofs:**

- A seeded defect for each new guard.
- The live proof forced to "fix expected" on SDK 54, which must fail with the 6.8 signature.
- The characterization branch run on SDK 58 before deletion, which must fail.

Red proofs run in a throwaway worktree. TEA owns and burns in every flake met.

## Verification

**Commands (every step):**

- `npx expo-doctor` in `apps/mobile` -- expected: no findings.
- `npm exec -- vitest run` in `apps/mobile`, `apps/web`, `apps/api` and every package -- expected: green.
- `npm exec -- tsc --noEmit -p <tsconfig>` in every workspace, counted by code -- expected: only the known symlink TS2742.
- `node --test` for the mobile plugin specs and every node-test-gate suite in `scripts/ci/node-test-suites.json` -- expected: green.
- `npx expo prebuild --clean` for both platforms, then Debug and Release builds -- expected: success.
- `DATABASE_URL=<isolated database> PLAYWRIGHT_SKIP_DB_RESET=true npx playwright test` for the share-card config -- expected: green.
- Maestro Android and iOS journeys, accessibility focus bridge and the large-text matrix on the step's build -- expected: green.

**Manual checks:**

- Step 4 and D7: live font change from 1.0 to 1.5 and back on each listed screen, both platforms, Release, light and dark, screenshots beside the measured node counts and heights.
