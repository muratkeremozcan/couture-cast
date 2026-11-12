# Story 6.15 pre-flight: Expo SDK 54 to 58

Updated: 2026-11-12 (pre-flight research for story drafting; sequence superseded by the story after the Codex review)

## Release facts

- Expo SDK 58 is stable (announced 2026-10-15) with React Native 0.88 and React 19.3.0; `expo@58.0.24` pins `react-native` 0.88.1. SDK 57 pins 0.86.3 with React 19.2.3.
- Upstream commit 45904c8 ("Fix Fabric reusing nodes with a stale font scale", #57246) is in v0.87.0 through v0.88.1. The React Native repo now lives at github.com/react/react-native.
- `enableFontScaleChangesUpdatingLayout` defaults to true since 0.82 and is false on 0.81.5. Commit 4b2aef2 removes the flag in 0.89.
- Expo recommends upgrading one SDK at a time: `npx expo install expo@^5X --fix`, `npx expo-doctor`, fresh dev build and full suites at each step.

## Breaking changes that hit this app

| Area                          | Change                                                                                                                      | App impact                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| expo-router (SDK 56)          | `@react-navigation/*` imports in app code are a bundler error                                                               | `app/_layout.tsx`, `share-card-tab-heading.tsx` move to `expo-router/react-navigation` (codemod); drop `@react-navigation/native`                 |
| expo-router (SDK 58)          | navigation core rework, `renderRouter` async, `initialRouteName` prop removed                                               | router 57 to 58 migration guide                                                                                                                   |
| expo-media-library (56.0.5)   | root `saveToLibraryAsync` throws                                                                                            | `share-card-save.native.ts`: `Asset.create()` or `expo-media-library/legacy`                                                                      |
| expo-background-fetch         | deprecated, removal announced                                                                                               | move to expo-background-task                                                                                                                      |
| expo-file-system              | new API `copy`/`move` async (56), `write` async (58)                                                                        | app `.d.ts` re-exports `build/legacy/index`, which the exports map hides                                                                          |
| Minimum iOS                   | 16.4                                                                                                                        | `with-supported-ios-target.js` floor 15.1 to 16.4; iOS app, widget and local podspecs follow; watchOS targets keep their own 9.0 floor (story D4) |
| iOS 27 scene lifecycle        | prebuild generates `SceneDelegate.swift`                                                                                    | device-test watchOS, widgets, orientation locks                                                                                                   |
| RN 0.87 Strict TypeScript API | deep imports and ref types become errors; opt-out ends after 0.89                                                           | type migration                                                                                                                                    |
| Android                       | R8 on in release, AGP 9.2.1, Gradle 9.4.1, Kotlin 2.2.0, compileSdk 37, targetSdk 36                                        | release build and keep rules; local Kotlin modules vs `AppContext` removals                                                                       |
| SDK 56 runtime                | `expo/fetch` replaces `globalThis.fetch`; TypeScript 6.0.3                                                                  | network tests, typecheck                                                                                                                          |
| SDK 58 CLI                    | forces `NODE_ENV`                                                                                                           | `.env` file selection                                                                                                                             |
| app.json                      | `newArchEnabled`, `edgeToEdgeEnabled` removed in SDK 55                                                                     | delete keys                                                                                                                                       |
| react-native-purchases        | 11.0 major (Play Billing 9, Kotlin 2.1+)                                                                                    | decide 10.x vs 11                                                                                                                                 |
| reanimated / worklets         | 4.7.1 / 0.13.0 for RN 0.86 to 0.88; 4.7.0 drops `zIndex` from sync props                                                    | check animations                                                                                                                                  |
| Vitest web setup              | `expo-modules-core` 58.1.0 still exports `./src/polyfill/dangerous-internal`; `build/ExponentConstants.web.js` still exists | AC5 holds; prove it                                                                                                                               |

## Toolchain and CI

- Node 22.13+, 24.3+ or 26+: `.nvmrc` 24.22.1 passes.
- Xcode 26.4+ required. GitHub `macos-15` tops out at Xcode 26.3 and cannot build from SDK 56 on; `macos-26` has 26.4.1 to 26.6; `xcode-27` (preview) has 27.0 to 27.2.
- Jobs on `macos-15` to move: watchos-native, pr-share-native-unit, three in pr-share-card-native, two in pr-accessibility-focus.
- NDK 27.1.12297006 is unchanged and not preinstalled on ubuntu-latest (Gradle downloads it). JDK: CI pins 21.

## Recommended sequence

Superseded by the story's D1 step table and decisions D11 to D15 in
`_bmad-output/implementation-artifacts/spec-6-15-expo-sdk58-live-font-scale-layout.md`, which is the
one sequence to follow. The media-library change happens at Step 2, and the macOS move follows the
D6 probe.

## Resolved after review (2026-11-12)

- `posthog-react-native` 4.86.0 declares no React Native range and no incompatibility; the Step 4
  Release event capture proves it on 0.88.
- `react-native-purchases` 11.0.2 declares `react-native >= 0.80.0`.
- Apple requires the iOS 27 SDK for App Store uploads from April 2027; the exact date is not yet
  announced. Steps 2 and 3 build with Xcode 26.x and stay submittable until then.
- SDK 56 carries a Hermes V1 memory regression for apps importing Worklets or Reanimated, fixed in
  `expo` 57.0.17 with React Native 0.86.3 per Expo's SDK 57 notes (story D12).
