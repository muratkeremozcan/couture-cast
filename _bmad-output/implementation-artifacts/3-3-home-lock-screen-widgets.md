# Story 3.3: Home/lock-screen widgets

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a phone user,
I want glanceable widgets showing the “Now” outfit and next-hour preview,
so that I don’t need to open the app.

## Acceptance Criteria

1. **Widget Layouts (Small/Medium) (AC: #1):**
   - Deliver **Small Widget (2x2)** layout:
     - Renders current feels-like temperature.
     - Renders weather condition glyph.
     - Renders short summary text of the "Now" outfit recommendation.
     - Tap action deep-links into the mobile app landing page.
   - Deliver **Medium Widget (4x2)** layout:
     - Left column: Displays current temperature, weather glyph, and "Now" outfit summary.
     - Right column: Displays next-hour forecast preview (time label like "14:00" or "2 PM" per locale, weather glyph, temp, and precipitation probability) and the "Next Hour" outfit summary.
     - Tap action deep-links into the mobile app landing page.
   - **Luxury Aesthetics:** Layouts must follow the brand design tokens (monochrome background, Onyx `#111111` or pure white text, Space Grotesk font for metrics, Gold `#C9A14A` accents, 8px corner radius).

2. **Data Sync & Shared Storage (AC: #2):**
   - Implement a shared data utility in `apps/mobile/src/lib/widget-share.ts` to serialize and write weather/outfit data.
   - **iOS App Group Shared Storage:** Write widget payload to Shared App Groups (`group.com.anonymous.mobile`) using `UserDefaults(suiteName: "group.com.anonymous.mobile")` or a shared JSON file.
   - **Android Shared Preferences:** Write widget payload to a shared preferences file named `OutfitWidgetPrefs` (accessible via custom module or standard Android APIs).
   - Hook this utility into `apps/mobile/src/lib/ritual-cache.ts` inside `saveRitualCache` to ensure the widget payload updates automatically whenever the main app cache changes.
   - The shared payload dictionary must contain:
     - `currentTemp` (string)
     - `feelsLikeTemp` (string)
     - `currentConditionIcon` (string)
     - `currentConditionText` (string)
     - `nowOutfitSummary` (string)
     - `nextHourTime` (string)
     - `nextHourTemp` (string)
     - `nextHourIcon` (string)
     - `nextOutfitSummary` (string)
     - `lastUpdated` (string timestamp)
     - `locale` (string)

3. **Background Refresh and Fallback (AC: #3):**
   - Register a background refresh task using `expo-background-fetch` and `expo-task-manager` or direct native bindings.
   - Schedule the task to run every 15-30 minutes. The task checks local cache age. If expired (>30 minutes), it triggers a background fetch using `apiV1RitualGet({ locale })` from `@couture/api-client`, updates the local cache, and refreshes the shared widget storage.
   - **Offline Degradation:** If background refresh fails or device is offline, keep displaying the existing cached data, showing a "Stale" indicator (e.g. "Stale" or "Updated X min ago" translated to the active language) in the widget footer.

4. **Deep-Link State Hydration & Analytics (AC: #4):**
   - Configure deep links for widget taps: `mobile://(tabs)?source=widget&size=small|medium&slot=now|next`.
   - Update `apps/mobile/app/(tabs)/index.tsx`:
     - Import `useLocalSearchParams` from `expo-router`.
     - Detect if `source === 'widget'`.
     - Parse the `slot` parameter, map it to the corresponding active scenario (`morning`, `midday`, or `evening`), and switch the toggle.
     - Fire telemetry event `hero_interaction` with properties `{ interactionType: 'widget_tap', widgetSize: size, slot: slot }`.

5. **Locale & Unit Compliance (AC: #5):**
   - The shared widget payload must supply text and unit-formatted data matching the user's active locale (EN, ES, FR, TR, DE, IT, PT).
   - Dynamically format temperatures: °F for `en-US`, and °C for all other locales.
   - Translate all static widget strings natively or pass translated labels inside the shared payload.

6. **E2E & Component Testing (AC: #6):**
   - Add unit tests verifying `TabOneScreen` parses deep-link parameters, switches the scenario toggle, and fires the PostHog telemetry event.
   - Add unit tests verifying `widget-share.ts` serialization logic.
   - Create a Maestro flow `maestro/widget-deep-link.yaml` verifying routing from widgets.

## Tasks / Subtasks

- [x] **Task 1: Shared Widget Data Utility (AC: #2, #5)**
  - [x] Implement `apps/mobile/src/lib/widget-share.ts` to serialize and write weather/outfit data to shared storage.
  - [x] Integrate `widget-share.ts` into `saveRitualCache` in `apps/mobile/src/lib/ritual-cache.ts`.
  - [x] Write unit tests for `widget-share.ts` to verify payload structure.

- [x] **Task 2: Native Widget Implementations (AC: #1, #2, #5)**
  - [x] **Android AppWidgetProvider:**
    - [x] Create `OutfitWidgetProvider.kt` and register the widget broadcast receiver in `AndroidManifest.xml`.
    - [x] Add widget metadata XML files under `res/xml/`.
    - [x] Add XML layout templates for small and medium widgets.
    - [x] Update layouts via `RemoteViews` using data from `OutfitWidgetPrefs`.
  - [x] **iOS SwiftUI WidgetKit Extension:**
    - [x] Configure custom Expo Config Plugin `apps/mobile/plugins/with-widgets.js` to create the SwiftUI Widget Extension target.
    - [x] Add iOS App Group entitlement configuration.
    - [x] Implement SwiftUI Small and Medium widget layouts reading from the App Group container.

- [x] **Task 3: Background Sync Task (AC: #3)**
  - [x] Configure `expo-task-manager` and `expo-background-fetch` in `apps/mobile/app/_layout.tsx`.
  - [x] Implement background check: fetch updated ritual data if cache is expired, update cache, and update shared widget payload.

- [x] **Task 4: App Deep-Link Hydration & Telemetry (AC: #4)**
  - [x] Update `apps/mobile/app/(tabs)/index.tsx` to read search parameters using `useLocalSearchParams`.
  - [x] Hydrate `activeScenario` state from deep link parameters.
  - [x] Track PostHog event `hero_interaction` with widget properties.

- [x] **Task 5: Vitest & Maestro Verification (AC: #6)**
  - [x] Add Vitest screen tests in `apps/mobile/src/screens/widget-deep-link.test.tsx` verifying deep link hydration.
  - [x] Create E2E workflow in `maestro/widget-deep-link.yaml`.

### Review Findings

- [x] [Review][Patch] High: Generate and embed a real iOS WidgetKit extension target [apps/mobile/plugins/with-widgets.js:15]
- [x] [Review][Patch] High: Make Android widget sources reproducible from a clean prebuild instead of relying on the ignored native tree [apps/mobile/.gitignore:42]
- [x] [Review][Patch] High: Add iOS widget tap URLs for the required `now` and `next` slots [apps/mobile/targets/widgets/OutfitWidget.swift:217]
- [x] [Review][Patch] High: Honor the `now|next` deep-link contract, validate parameters, and track every tap [apps/mobile/app/(tabs)/index.tsx:163]
- [x] [Review][Patch] High: Use the active user cache identity during background refresh [apps/mobile/src/lib/background-fetch.ts:14]
- [x] [Review][Patch] High: Make widget persistence atomic and propagate native bridge failures [apps/mobile/src/lib/widget-share.ts:98]
- [x] [Review][Patch] High: Replace fabricated fallback weather and outfit advice with an honest empty state [apps/mobile/targets/widgets/OutfitWidget.swift:37]
- [x] [Review][Patch] High: Preserve source freshness and render a localized stale indicator [apps/mobile/src/lib/widget-share.ts:84]
- [x] [Review][Patch] High: Render feels-like temperature, weather glyphs, and next-hour precipitation [apps/mobile/targets/widgets/OutfitWidget.swift:100]
- [x] [Review][Patch] High: Localize all static and condition text in the shared widget payload [apps/mobile/src/lib/widget-share.ts:47]
- [x] [Review][Patch] Medium: Select current and next-hour scenarios using forecast timestamps and location timezone [apps/mobile/src/lib/widget-share.ts:55]
- [x] [Review][Patch] Medium: Merge the widget App Group entitlement without deleting existing groups [apps/mobile/plugins/with-widgets.js:6]
- [x] [Review][Patch] Medium: Treat future-dated or corrupt cache timestamps as expired [apps/mobile/src/lib/background-fetch.ts:19]
- [x] [Review][Patch] Medium: Runtime-validate background API responses before caching them [apps/mobile/src/lib/background-fetch.ts:31]
- [x] [Review][Patch] Medium: Apply the specified widget font, color, and corner-radius brand tokens [apps/mobile/targets/widgets/OutfitWidget.swift:100]
- [x] [Review][Patch] Medium: Test native prebuild integration and the production widget deep-link contract [apps/mobile/src/screens/widget-deep-link.test.tsx:51]

## Dev Notes

- **Widget Isolation Principle:** The native widget code (Swift/Kotlin) must be purely presenter logic. It must never request APIs or parse business logic directly. It simply reads the shared storage JSON/dictionary and binds values to the UI views. All networking, caching, and i18n formatting must run inside the React Native background/foreground task.
- **Shared Package Dependencies:** Ensure `@couture/api-client` and `@couture/utils` are rebuilt before executing the mobile runner.
- **Security Constraint:** Never store private access tokens, JWTs, or user secrets in the shared widget storage.
- **Reuse Formatting Logic:** The background updater must format temperatures via formatting helpers from `apps/mobile/src/lib/formatters.ts` and locale strings using i18n instances.

### Project Structure Notes

- Keep file naming lowercase kebab-case for assets and config files.
- Align with Prettier styling: 90-column width, 2-space indentation, single quotes, no semicolons.

### References

- UX Design Specification: [ux-design-specification.md](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/ux-design-specification.md#L371-L396)
- Mobile Hero Experience: [index.tsx](file:///Users/murat/opensource/couture-cast/apps/mobile/app/%28tabs%29/index.tsx#L52-L68)
- Localization Infrastructure Story: [3-2-localization-infrastructure.md](file:///Users/murat/opensource/couture-cast/_bmad-output/implementation-artifacts/3-2-localization-infrastructure.md)
- Formatting Helpers: [formatters.ts](file:///Users/murat/opensource/couture-cast/apps/mobile/src/lib/formatters.ts)
- Ritual Cache: [ritual-cache.ts](file:///Users/murat/opensource/couture-cast/apps/mobile/src/lib/ritual-cache.ts)

## Dev Agent Record

### Agent Model Used

Gemini 3.5 Flash (High)

### Debug Log References

### Completion Notes List

- Implemented widget data sharing utility `widget-share.ts` with unit tests verifying local storage outputs.
- Hooked widget sharing utility directly into `ritual-cache.ts` (`saveRitualCache`).
- Built Android native `AppWidgetProvider` classes (`OutfitWidgetProvider`, `OutfitWidgetProviderSmall`, `OutfitWidgetProviderMedium`) and layouts (`widget_small.xml`, `widget_medium.xml`, `widget_background.xml`).
- Registered Android widget providers in `AndroidManifest.xml` and registered custom `WidgetSharedPackage` in `MainApplication.kt` / `WidgetSharedModule.kt`.
- Built iOS SwiftUI `OutfitWidget.swift` layouts and native iOS bridge (`WidgetSharedModule.swift`, `WidgetSharedModule.m`).
- Created Expo config plugin `with-widgets.js` to automatically set App Group entitlements and copy native bridge files on iOS prebuild, registered in `app.json`.
- Integrated background sync task `RITUAL_BACKGROUND_FETCH_TASK` using `expo-background-fetch` and `expo-task-manager` registered on app startup in `_layout.tsx`.
- Implemented deep-link scenario hydration and widget tap analytics tracking inside `TabOneScreen`.
- Wrote screen tests in `widget-deep-link.test.tsx` verifying deep-link parameter scenario hydration and analytics triggers.
- Authored Maestro workflow `widget-deep-link.yaml` to verify end-to-end deep link integration.
- Resolved all 16 adversarial review findings across native target generation, atomic storage, cache identity and freshness, runtime validation, localization, brand fidelity, and deep-link behavior.
- Addressed all valid CodeRabbit findings across widget payload fallbacks, native accessibility and localization, clean-prebuild generation, deterministic local E2E, and review-focused regression coverage.
- Repaired SDK 54 native file persistence by replacing the Metro-opaque FileSystem loader with a literal lazy legacy-module import and native-path regression tests.
- Made local Maestro runs self-contained with deterministic API identities, SDK-compatible Expo Go installation, platform-correct networking, robust process cleanup, and Android/iOS widget-link coverage.
- Replaced the broken blank mobile error view and starter Tab Two content with polished, testable states.
- Verified `npm run validate`, Playwright E2E (29/29), mobile E2E on Android and iOS, Pact contracts, k6 thresholds, clean Expo prebuild, iOS widget compilation, and Android Kotlin compilation.

### File List

- `apps/mobile/src/lib/widget-share.ts`
- `apps/mobile/src/lib/widget-share.test.ts`
- `apps/mobile/src/lib/widget-copy.ts`
- `apps/mobile/src/lib/widget-cache-freshness.ts`
- `apps/mobile/src/lib/ritual-cache.ts`
- `apps/mobile/src/lib/native-file-storage.test.ts`
- `apps/mobile/src/lib/settings-storage.ts`
- `apps/mobile/src/lib/background-fetch.ts`
- `apps/mobile/src/lib/background-fetch.test.ts`
- `apps/mobile/src/lib/mobile-auth.ts`
- `apps/mobile/src/screens/widget-deep-link.test.tsx`
- `apps/mobile/src/screens/hero-experience.test.tsx`
- `apps/mobile/src/screens/tab-two-screen.test.tsx`
- `apps/mobile/expo-file-system-legacy.d.ts`
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/(tabs)/index.tsx`
- `apps/mobile/app/(tabs)/two.tsx`
- `apps/mobile/targets/widgets/android/java/OutfitWidgetProvider.kt`
- `apps/mobile/targets/widgets/android/java/OutfitWidgetProviderSmall.kt`
- `apps/mobile/targets/widgets/android/java/OutfitWidgetProviderMedium.kt`
- `apps/mobile/targets/widgets/android/java/WidgetSharedModule.kt`
- `apps/mobile/targets/widgets/android/java/WidgetSharedPackage.kt`
- `apps/mobile/targets/widgets/android/java/WidgetConstants.kt`
- `apps/mobile/targets/widgets/android/res/xml/widget_info_small.xml`
- `apps/mobile/targets/widgets/android/res/xml/widget_info_medium.xml`
- `apps/mobile/targets/widgets/android/res/layout/widget_small.xml`
- `apps/mobile/targets/widgets/android/res/layout/widget_medium.xml`
- `apps/mobile/targets/widgets/android/res/drawable/widget_background.xml`
- `apps/mobile/targets/widgets/OutfitWidget.swift`
- `apps/mobile/targets/widgets/WidgetSharedModule.swift`
- `apps/mobile/targets/widgets/WidgetSharedModule.m`
- `apps/mobile/plugins/with-widgets.js`
- `apps/mobile/plugins/with-widgets.test.js`
- `apps/mobile/app.json`
- `apps/mobile/package.json`
- `apps/mobile/vitest.config.ts`
- `apps/mobile/src/test-utils/mocks/react-native-safe-area-context.jsx`
- `apps/mobile/assets/locales/*.json`
- `scripts/install-expo-go.mjs`
- `scripts/run-maestro.mjs`
- `maestro/sanity.yaml`
- `maestro/analytics.yaml`
- `maestro/widget-deep-link.yaml`
- `playwright/support/auth-session/custom-auth-provider.ts`
- `package-lock.json`
