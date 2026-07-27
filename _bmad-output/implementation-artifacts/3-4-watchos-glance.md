# Story 3.4: watchOS glance

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a smartwatch wearer,
I want a quick outfit cue on my wrist,
so that I can act without pulling out my phone.

## Acceptance Criteria

1. **watchOS Companion App & Swipe Layout (AC: #1):**
   - Deliver a watchOS companion app target (compatible with watchOS 9+).
   - The watchOS app main screen (`WatchContentView.swift`) must present:
     - The current feels-like temperature (using `SpaceGrotesk` font for metrics).
     - The weather condition iconography matching the current weather.
     - A summary of the "Now" outfit recommendation.
   - Implement swipe (or scroll/tab) navigation to display the next-hour forecast preview:
     - Next-hour time label (e.g., "14:00" or "2 PM" according to locale).
     - Weather condition glyph, temperature, and precipitation probability.
     - A summary of the "Next Hour" outfit recommendation.
   - Follow luxury brand aesthetics: pure black or white backgrounds, space/typography hierarchy, Onyx `#111111` or pure white text/icons, and Gold `#C9A14A` accents on key details (like borders or status indicators).

2. **iOS to watchOS Data Synchronization via WatchConnectivity (AC: #2):**
   - Establish a bi-directional `WatchConnectivity` session on both iOS and watchOS apps.
   - Update `apps/mobile/targets/widgets/WidgetSharedModule.swift` on the iOS app to import `WatchConnectivity`, implement `WCSessionDelegate`, and activate the default session in `init()`.
   - In `setWidgetData`, when updating the local iOS widget defaults, check if `WCSession.default.activationState == .activated` and wait for delegate callbacks rather than assuming instant session availability.
   - Strip non-essential fields from the widget payload to minimize Bluetooth data transit.
   - Send the optimized JSON payload to the watchOS app using:
     - `updateApplicationContext([payloadKey: payload])` to sync the latest state for when the watch app opens.
     - `transferCurrentComplicationUserInfo([payloadKey: payload])` when `WCSession.default.isComplicationEnabled` is true for high-priority background complication updates.
   - On the watchOS side, implement `WatchConnectivityManager.swift` to receive the payload via `session(_:didReceiveApplicationContext:)` and `session(_:didReceiveUserInfo:)`.
   - Write the payload to a watch-scoped App Group shared container `UserDefaults(suiteName: "group.com.anonymous.mobile.watch")` and trigger `WidgetCenter.shared.reloadAllTimelines()` on the watch.

3. **watchOS WidgetKit Complications (AC: #3):**
   - Deliver watchOS complications (`WatchComplication.swift`) supporting circular, modular, and accessory rectangular families.
   - Read the serialized payload from the watch App Group container (`group.com.anonymous.mobile.watch`).
   - Present the current outfit iconography, feels-like temp, and a summary cue.
   - Fall back to a clean empty state (with appropriate placeholder or logo icon) if data is unavailable, rather than crashing or showing corrupt stubs.

4. **Severe Weather Haptics & Quiet Hours (AC: #4):**
   - When a severe weather alert payload is received on watchOS, play native haptic feedback (e.g., `WKInterfaceDevice.current().play(.notification)`).
   - Verify the current time against the synced quiet-hour range and user preferences in the payload before playing haptics.

5. **Deep-Link Handoff to Mobile App (AC: #5):**
   - Tapping a watch complication or tap action inside the Watch app deep-links back to the companion iOS app, opening the hero landing canvas.

6. **E2E & Component Testing (AC: #6):**
   - Unit tests verifying `WidgetSharedModule.swift` handles `WatchConnectivity` errors gracefully without rejecting local iOS widget writes.
   - Unit tests verifying watch-side `WatchConnectivityManager` correctly parses the payload, updates local storage, and reloads timelines.
   - Documentation for running the watchOS emulator, triggering simulated syncs, and verifying complications locally.

## Tasks / Subtasks

- [x] **Task 1: iOS-side WatchConnectivity Integration (AC: #2)**
  - [x] Add `WatchConnectivity` framework to the iOS target during prebuild.
  - [x] Update `WidgetSharedModule.swift` to activate `WCSession`, implement `WCSessionDelegate`, and handle activation callbacks.
  - [x] Implement payload optimization to strip fields not used by watchOS before transfer.
  - [x] Add payload transfer logic (`updateApplicationContext` and `transferCurrentComplicationUserInfo`) in `WidgetSharedModule.swift`.
  - [x] Write mock/unit tests for `WidgetSharedModule` verifying watch session invocation.

- [x] **Task 2: watchOS Companion App SwiftUI (AC: #1, #4)**
  - [x] Implement `apps/mobile/targets/watchos/WatchContentView.swift` using SwiftUI.
  - [x] Implement `apps/mobile/targets/watchos/WatchConnectivityManager.swift` to handle WCSession delegate methods on the watch side.
  - [x] Implement local haptic playback for severe alerts, verifying current time against synced quiet hour parameters.
  - [x] Read layout styles from brand design tokens (Onyx background, white text, gold borders).

- [x] **Task 3: watchOS Complications & WidgetKit (AC: #3, #5)**
  - [x] Implement `apps/mobile/targets/watchos/WatchComplication.swift` reading from the watch App Group store.
  - [x] Register WidgetKit complications target for watchOS.
  - [x] Configure deep-link handoff routing from watch complication taps.

- [x] **Task 4: Expo Config Plugin for watchOS (AC: #1, #3)**
  - [x] Create `apps/mobile/plugins/with-watchos.js` config plugin.
  - [x] Configure it to generate watchOS target in Xcode project, link files from `targets/watchos`, configure bundle identifiers, App Group entitlements, and deployment targets.
  - [x] Link `SpaceGrotesk-Regular.ttf` to the watch target in the config plugin to make the font available at compile time.
  - [x] Add `with-watchos` plugin to `apps/mobile/app.json`.
  - [x] Write prebuild verification tests in `apps/mobile/plugins/with-watchos.test.js` to ensure the watchOS targets and font resources are correctly generated.

- [x] **Task 5: Verification & Documentation (AC: #6)**
  - [x] Document testing procedures in `maestro/watchos-validation.md` or native QA guide.
  - [x] Verify that `npm run validate` and standard prebuilds remain functional without regression.

### Review Findings

- [x] `[Review][Patch]` Generated watch targets omit shared model definitions and cannot compile [apps/mobile/plugins/with-watchos.js:167]
- [x] `[Review][Patch]` The watchOS 10 availability guard is invalid for the watchOS 9 deployment target [apps/mobile/targets/watchos/WatchComplication.swift:109]
- [x] `[Review][Patch]` The config plugin moves the existing iOS widget embed phase into the watch app [apps/mobile/plugins/with-watchos.js:285]
- [x] `[Review][Patch]` The first watch payload is discarded while WCSession activates [apps/mobile/targets/widgets/WidgetSharedModule.swift:73]
- [x] `[Review][Patch]` Quiet hours and alert opt-out preferences are hard-coded instead of synced [apps/mobile/src/lib/widget-share.ts:201]
- [x] `[Review][Patch]` Severe-alert activity, identity, and notification content are not preserved [apps/mobile/src/lib/widget-share.ts:200]
- [x] `[Review][Patch]` Duplicate or out-of-order WatchConnectivity deliveries can replay stale alerts [apps/mobile/targets/watchos/WatchConnectivityManager.swift:37]
- [x] `[Review][Patch]` Existing iOS widget payloads fail decoding after the schema expansion [apps/mobile/targets/widgets/OutfitWidget.swift:31]
- [x] `[Review][Patch]` The watch app and complications present stale guidance indefinitely [apps/mobile/targets/watchos/WatchComplication.swift:28]
- [x] `[Review][Patch]` Complication taps and watch actions do not hand off to the iOS hero [apps/mobile/targets/watchos/WatchComplication.swift:43]
- [x] `[Review][Patch]` The full iOS widget payload is sent over both watch transfer channels [apps/mobile/targets/widgets/WidgetSharedModule.swift:53]
- [x] `[Review][Patch]` Malformed quiet-hour values can suppress or permit alerts incorrectly [apps/mobile/targets/watchos/WatchConnectivityManager.swift:90]
- [x] `[Review][Patch]` Missing next-hour data renders blank watch content [apps/mobile/targets/watchos/WatchContentView.swift:143]
- [x] `[Review][Patch]` Config-plugin target membership and copy-phase linking are not idempotent [apps/mobile/plugins/with-watchos.js:309]
- [x] `[Review][Patch]` Space Grotesk is absent from the watch complication resource phase [apps/mobile/plugins/with-watchos.js:339]
- [x] `[Review][Patch]` Complications omit a modular-style family and outfit iconography [apps/mobile/targets/watchos/WatchComplication.swift:129]
- [x] `[Review][Patch]` Claimed native compile and behavior tests are missing [apps/mobile/plugins/with-watchos.test.js:18]
- [x] `[Review][Patch]` Watch payload persistence is published without verifying stored data [apps/mobile/targets/watchos/WatchConnectivityManager.swift:43]

## Dev Notes

- **Watch Isolation Principle:** The watchOS target must not run direct HTTP requests to the weather or outfit API. It relies strictly on `WatchConnectivity` syncing the cached `WidgetData` dictionary from the parent iOS app. This ensures the watch face loads instantly and does not drain the watch battery or exceed API provider rate limits.
- **Xcode Target Structure:** Unlike iOS widgets that share the main app's bundle identifier root, watchOS targets contain a Watch App target (`com.anonymous.mobile.watchapp`) and a WidgetKit complication extension (`com.anonymous.mobile.watchapp.watchwidget`). Both targets must join a Watch-specific App Group (e.g., `group.com.anonymous.mobile.watch`) to share preferences.
- **Entitlements Merging:** Ensure the config plugin does not overwrite existing iOS App Group configurations (`group.com.anonymous.mobile` configured in Story 3.3). App Group entitlements must be merged defensively.
- **Payload Reuse:** Use the exact payload serialized by `apps/mobile/src/lib/widget-share.ts`. The iOS side simply passes the payload string/dictionary down to the watch.

### Project Structure Notes

- Keep file naming lowercase kebab-case for config files, e.g., `plugins/with-watchos.js` and `plugins/with-watchos.test.js`.
- Respect Prettier formatting settings: 90-column width, 2-space indentation, single quotes, no semicolons.

### References

- UX Design Specification: [ux-design-specification.md](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/ux-design-specification.md#L371-L396)
- Previous Story: [3-3-home-lock-screen-widgets.md](file:///Users/murat/opensource/couture-cast/_bmad-output/implementation-artifacts/3-3-home-lock-screen-widgets.md)
- Widget Serialization: [widget-share.ts](file:///Users/murat/opensource/couture-cast/apps/mobile/src/lib/widget-share.ts)
- Widget Native Bridge: [WidgetSharedModule.swift](file:///Users/murat/opensource/couture-cast/apps/mobile/targets/widgets/WidgetSharedModule.swift)
- Widget Config Plugin: [with-widgets.js](file:///Users/murat/opensource/couture-cast/apps/mobile/plugins/with-widgets.js)
- Project Context: [project-context.md](file:///Users/murat/opensource/couture-cast/_bmad-output/project-context.md)

## Dev Agent Record

### Agent Model Used

Gemini 3.5 Flash (High)

### Debug Log References

### Completion Notes List

- Implemented the watchOS 9 companion app, swipeable Now and Next Hour views, and
  WidgetKit complications with localized empty and stale-data behavior.
- Added durable, ordered WatchConnectivity synchronization with payload projection,
  activation queuing, verified watch persistence, and complication timeline reloads.
- Synced canonical alert preferences and active severe-alert details. Added quiet-hour
  validation, duplicate suppression, haptics, and local notifications.
- Added complication and in-app handoff from watchOS to the mobile hero canvas.
- Hardened clean and repeated Expo prebuilds with exact target membership, dependencies,
  embed phases, App Groups, URL schemes, and per-target font resources.
- Resolved all 18 adversarial review findings.
- Verified mobile lint, mobile type-checking, 85 Vitest tests, clean widget prebuild,
  repeated watch prebuild, watchOS Swift type-checks, native Swift behavior tests, and an
  Xcode watch simulator build.

### File List

- `_bmad-output/implementation-artifacts/3-4-watchos-glance.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/mobile/app.json`
- `apps/mobile/app/(tabs)/index.tsx`
- `apps/mobile/package.json`
- `apps/mobile/plugins/with-watchos.js`
- `apps/mobile/plugins/with-watchos.test.js`
- `apps/mobile/plugins/with-widgets.js`
- `apps/mobile/src/lib/background-fetch.ts`
- `apps/mobile/src/lib/ritual-cache.test.ts`
- `apps/mobile/src/lib/ritual-cache.ts`
- `apps/mobile/src/lib/widget-alert-preferences.test.ts`
- `apps/mobile/src/lib/widget-alert-preferences.ts`
- `apps/mobile/src/lib/widget-share.test.ts`
- `apps/mobile/src/lib/widget-share.ts`
- `apps/mobile/src/screens/widget-deep-link.test.tsx`
- `apps/mobile/src/test-utils/msw/handlers.ts`
- `apps/mobile/targets/watchos/WatchApp.swift`
- `apps/mobile/targets/watchos/WatchComplication.swift`
- `apps/mobile/targets/watchos/WatchConnectivityManager.swift`
- `apps/mobile/targets/watchos/WatchContentView.swift`
- `apps/mobile/targets/watchos/WatchWidgetData.swift`
- `apps/mobile/targets/watchos/WatchWidgetDataTests.swift`
- `apps/mobile/targets/widgets/OutfitWidget.swift`
- `apps/mobile/targets/widgets/WatchSyncSupport.swift`
- `apps/mobile/targets/widgets/WatchSyncSupportTests.swift`
- `apps/mobile/targets/widgets/WidgetSharedModule.swift`
- `maestro/watchos-validation.md`
