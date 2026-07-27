# watchOS companion app and complications local validation

Use this guide to validate the watchOS companion app, complications, synchronization,
alerts, and handoff behavior.

## Prerequisites

- Xcode with the watchOS 9 SDK or newer
- A Watch Simulator paired with an iPhone Simulator
- Repository dependencies installed with `npm install`

## Step 1: Run automated native validation

Run the watchOS regression suite from the repository root:

```bash
npm run test:watchos-prebuild --workspace mobile
```

The suite performs two clean Expo prebuilds to verify plugin idempotency. On macOS, it
also:

- type-checks the watch app and complication Swift sources for watchOS 9
- builds the generated `WatchApp` target with `xcodebuild`
- verifies target membership, embed phases, dependencies, entitlements, and font resources
- executes native Swift behavior tests for payload compatibility, freshness, ordering,
  quiet hours, payload projection, and handoff URL validation

## Step 2: Generate the local Xcode project

From `apps/mobile`, generate the iOS project:

```bash
npx expo prebuild --platform ios --no-install
```

The `with-widgets` and `with-watchos` config plugins create the native targets, asset
references, target dependencies, embed phases, and App Group entitlements.

## Step 3: Build and run from Xcode

1. Open `apps/mobile/ios/CoutureCast.xcworkspace` in Xcode.
2. Select the `CoutureCast` scheme and run it on the paired iPhone simulator.
3. Select the `WatchApp` scheme and run it on the paired Apple Watch simulator.
4. Verify the watch app starts with a clean unavailable state before its first sync.
5. Verify the Now and Next Hour pages use the expected typography, spacing, weather
   glyphs, outfit cues, and gold accent treatment.

## Step 4: trigger simulated syncs

1. With the iOS application active, perform a weather refresh or trigger a widget update.
2. The React Native app invokes `WidgetSharedModule.setWidgetData(payload)`.
3. Verify the watch updates after `WCSession` activation. This includes a payload queued
   while the session is activating.
4. Verify the Now page shows current temperature, weather, and outfit guidance.
5. Swipe to Next Hour. Verify time, weather, temperature, precipitation, and outfit
   guidance are populated.
6. Disable connectivity, advance the payload timestamp beyond the freshness window, and
   relaunch the watch app. Verify it shows the unavailable state instead of stale advice.

## Step 5: verify complications

1. Return to the watch simulator home screen.
2. Long-press the watch face and select **Edit**.
3. Select circular, corner, rectangular, or inline slots and search for **CoutureCast**.
4. Confirm complications display current weather details and outfit summary cues.
5. Tap a complication. Verify the watch app forwards the selected slot to the
   paired iOS app and the mobile hero canvas opens. Check logs to confirm
   exactly one matching `hero_interaction` `watch_tap` event is captured with
   `slot` (e.g. `next`) and `locale` (e.g. `en-US`).
6. Repeat with the paired phone temporarily unreachable. Reconnect it and
   verify the queued handoff opens the hero canvas and captures the deferred
   `hero_interaction` `watch_tap` event.

## Step 6: verify severe weather alerts and quiet hours

1. Configure alert preferences in the mobile app.
2. Trigger an active high-severity alert in the iOS mock response.
3. Sync the payload to the watchOS target.
4. During configured quiet hours, confirm haptic and notification delivery are suppressed.
5. Outside quiet hours, confirm the foreground code path invokes the notification haptic.
   The simulator may not reproduce physical haptic feedback.
6. With the watch app backgrounded and notification permission granted, confirm a local
   notification contains the alert title and description.
7. Deliver the same payload twice. Confirm the alert is emitted once.
8. Deliver an older payload after a newer payload. Confirm the watch keeps the newer data.
9. Disable alert preferences. Confirm the watch suppresses alert delivery.

## Step 7: run repository validation

Before merging, run from the repository root:

```bash
npm run verify:changed
npm run validate
```
