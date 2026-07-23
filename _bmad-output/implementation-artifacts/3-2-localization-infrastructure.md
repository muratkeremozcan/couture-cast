# Story 3.2: Localization infrastructure

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a multilingual user,
I want to switch between English, Spanish, French, and Turkish,
so that the app matches my locale.

## Acceptance Criteria

1. **i18n Framework & Translation Bundles (AC: #1):**
   - Implement a shared or app-local i18n structure using `i18next` (v23.11.0) and `react-i18next` inside `apps/mobile`.
   - Setup translation JSON catalogs for the following locales:
     - **English:** `en-US` (default) and `en-CA`
     - **Spanish:** `es-419` (LatAm)
     - **French:** `fr-CA` and `fr-FR`
     - **Turkish:** `tr-TR`
     - **German:** `de-DE`
     - **Italian:** `it-IT`
     - **Portuguese:** `pt-BR` and `pt-PT`
   - Use `expo-localization` to resolve the device's system language/region on startup and fallback to `en-US` if unsupported.

2. **Dynamic Unit & Currency Formatting (AC: #2):**
   - Implement locale-aware formatters:
     - **Temperature:** Format to °F for `en-US`, and °C for all other locales (`en-CA`, `es-419`, `fr-CA`, `fr-FR`, `tr-TR`, `de-DE`, `it-IT`, `pt-BR`, `pt-PT`).
     - **Currency:** Format currency based on locale (USD for US, CAD for CA, EUR for EU/DE/IT/PT, BRL for BR, TRY for TR).
     - **Sizing guides:** Format measurement numbers to metric (cm) or imperial (inches) automatically depending on locale preference.
   - Refactor current hero screen elements (e.g., `apps/mobile/components/hero/weather-header.tsx`) to pull unit settings dynamically from the active locale instead of raw system preferences.

3. **Dynamic Backend Recommendations & Comfort Notes Translation (AC: #3):**
   - Refactor NestJS monolith API (`GET /api/v1/ritual`) to parse `Accept-Language` headers or an optional `locale` query parameter.
   - The backend `RitualService` must localize dynamic comfort notes (e.g., wind warnings, rain prep) and reasoning badges (labels & bullets) into the requested language (EN, ES, FR, TR), with fallback to EN.

4. **Fallback & QA Verification Safeguards (AC: #4):**
   - Enable strict English fallback behavior for any missing keys in other language bundles.
   - Create a QA localization validation checklist stored as `_bmad-output/test-artifacts/localization-qa-checklist.md` listing critical screens, buttons, and error conditions to verify translations.

5. **PostHog Telemetry of Locale Usage (Prerequisite: CC-1.4):**
   - Define a type-safe `locale_switched` event in `packages/api-client/src/types/analytics-events.ts` with properties `{ userId: string, fromLocale: string, toLocale: string, timestamp: string }`.
   - Trigger the `locale_switched` event via `useMobileAnalytics` whenever the user manually overrides their language preference.
   - Include the active locale key as a user profile property or as part of event context metadata on all telemetry events.

6. **Sync Preferred Locale to User Profile Database (AC: #5):**
   - When the user changes their language setting, propagate this preference to the backend profile via a PATCH/PUT request to update `UserProfile.preferences.locale`. This ensures that push notifications and backend-driven messages match the user's preferred language.

## Tasks / Subtasks

- [x] **Task 1: Shared Locales Structure & JSON Bundles (AC: #1, #4)**
  - [x] Add translation bundles in JSON files for English, Spanish, French, Turkish.
  - [x] Include namespaces for common UI labels (tabs, buttons, weather alerts) and settings strings.
  - [x] Write a script `tools/sync-i18n.js` to enforce the canonical supported-locale
        manifest and translation-key parity across mobile catalogs.
  - [x] Write the QA localization validation checklist to `_bmad-output/test-artifacts/localization-qa-checklist.md`.

- [x] **Task 2: Typesafe i18n Event Contract & Telemetry (AC: #5)**
  - [x] Add `locale_switched` event name to `analyticsEventNameSchema` and define Zod schemas in `packages/api-client/src/types/analytics-events.ts`.
  - [x] Write `trackLocaleSwitched()` tracking wrapper function and generate updated SDK client via `npm run generate:api-client`.

- [x] **Task 3: Backend API Localization Support (AC: #3, #6)**
  - [x] Initialize basic backend i18n support in `apps/api` using lightweight local translations.
  - [x] Extract hardcoded comfort notes in `ritual.service.ts` into localized catalogs.
  - [x] Read `Accept-Language` headers in `RitualController` and pass to `RitualService` for localizing output properties.
  - [x] Implement database preferences update endpoint to save user locale in `UserProfile.preferences.locale`.

- [x] **Task 4: Mobile i18n Client Framework Integration (AC: #1, #4)**
  - [x] Install `i18next` and `react-i18next` in `apps/mobile/package.json`.
  - [x] Create `apps/mobile/src/lib/i18n.ts` helper to initialize the `i18next` instance with support for storage.

- [x] **Task 5: Dynamic Unit Formatting Helpers (AC: #2)**
  - [x] Implement formatting helpers in `apps/mobile/src/lib/formatters.ts`.
  - [x] Refactor `weather-header.tsx` to consume formatting helpers using the active locale context.

- [x] **Task 6: Settings Screen Language Switcher UI (AC: #1, #2, #5, #6)**
  - [x] Update `two.tsx` (Tab Two) settings panel to render language selector.
  - [x] Wire selector to change language, save choice, update backend user profile via preferences endpoint, and fire `locale_switched` telemetry event.

- [x] **Task 7: Vitest & Maestro Verification (AC: #1-#6)**
  - [x] Add unit tests for `formatters.ts` verifying correct units per locale.
  - [x] Add screen unit tests in `apps/mobile/src/screens/localization.test.tsx` verifying UI translations and fallback.
  - [x] Update MSW mock handlers in `apps/mobile/src/test-utils/msw/handlers.ts` to support localized ritual responses.
  - [x] Add `maestro/localization.yaml` for end-user locale-switch and localized-hero verification.

### Review Findings

- [x] [Review][Patch] Use Expo's real regional locale property [apps/mobile/src/lib/i18n.ts:52]
- [x] [Review][Patch] Resolve the device locale on first launch [apps/mobile/src/lib/settings-storage.ts:19]
- [x] [Review][Patch] Recover safely from i18n initialization failures [apps/mobile/app/_layout.tsx:63]
- [x] [Review][Patch] Persist language switches through the canonical API and request the active locale [apps/mobile/app/(tabs)/two.tsx:58]
- [x] [Review][Patch] Include locale in the server ritual cache identity [apps/api/src/modules/personalization/ritual.service.ts:649]
- [x] [Review][Patch] Include locale in the mobile ritual cache and reload after locale changes [apps/mobile/src/lib/ritual-cache.ts:18]
- [x] [Review][Patch] Preserve an explicit en-US profile preference over request headers [apps/api/src/modules/personalization/ritual.service.ts:539]
- [x] [Review][Patch] Support explicit locale overrides and complete Accept-Language negotiation [apps/api/src/modules/personalization/ritual.controller.ts:33]
- [x] [Review][Patch] Regenerate OpenAPI and the shared SDK for the preferences endpoint [packages/api-client/src/generated/apis/UserApi.ts:20]
- [x] [Review][Patch] Restore lint and formatting quality gates before claiming verification [apps/api/src/modules/personalization/ritual.service.ts:199]
- [x] [Review][Patch] Localize all visible hero, navigation, status, and badge-detail copy [apps/mobile/components/hero/hourly-forecast-ribbon.tsx:72]
- [x] [Review][Patch] Respect each locale's native hour cycle [apps/mobile/components/hero/hourly-forecast-ribbon.tsx:20]
- [x] [Review][Patch] Format en-US comfort-note temperatures in Fahrenheit [apps/api/src/modules/personalization/ritual.service.ts:201]
- [x] [Review][Patch] Validate persisted profile locales against the supported locale set [packages/api-client/src/contracts/http/user.ts:43]
- [x] [Review][Patch] Make the language settings screen safe-area aware and scrollable [apps/mobile/app/(tabs)/two.tsx:108]
- [x] [Review][Patch] Correct the Italian hot-weather translation [apps/api/src/modules/personalization/ritual.service.ts:284]
- [x] [Review][Patch] Use the type-safe locale event wrapper and attach active locale to all telemetry [apps/mobile/app/(tabs)/two.tsx:64]
- [x] [Review][Patch] Enforce the canonical locale manifest and remove false web-sync claims [tools/sync-i18n.js:14]
- [x] [Review][Patch] Add behavioral localization tests and truthful QA evidence [apps/mobile/src/screens/localization.test.tsx:65]
- [x] [Review][Patch] Prevent concurrent preference updates from overwriting unrelated profile preferences [apps/api/src/modules/user/user.service.ts:52]
- [x] [Review][Patch] Preserve custom badge bullets when no canonical translation matches [apps/api/src/modules/personalization/ritual.service.ts:444]
- [x] [Review][Patch] Serialize locale switches and ignore no-op selections [apps/mobile/app/(tabs)/two.tsx:58]

## Dev Notes

- **Workspace Dependencies:** Run `npm install` in root to verify workspace graph and install dependencies.
- **Expo Localization Interface:** Native device locale is obtained from `expo-localization`'s `getLocales()`. Keep UI language decoupled from device settings once overridden by user preferences.
- **Fallback Safe-path:** Check for missing translation strings programmatically and log warnings only in non-production environments to avoid polluting logs.

### Project Structure Notes

- Locales reside inside `apps/mobile/assets/locales/` to align with Expo resource bundles.
- Keep helper files inside `apps/mobile/src/lib/`.
- Component naming must follow lowercase kebab-case (e.g., `locale-picker.tsx`).

### References

- Project Rules: [project-context.md](file:///Users/murat/opensource/couture-cast/_bmad-output/project-context.md#L27)
- Weather Header Component: [weather-header.tsx](file:///Users/murat/opensource/couture-cast/apps/mobile/components/hero/weather-header.tsx#L13-L38)
- Tab Two Diagnostic Screen: [two.tsx](file:///Users/murat/opensource/couture-cast/apps/mobile/app/%28tabs%29/two.tsx)
- Epics Document: [epics.md](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/epics.md#L305-L312)

## Dev Agent Record

### Agent Model Used

Antigravity (Gemini 2.5 Pro)

### Debug Log References

- `/Users/murat/.gemini/antigravity-cli/brain/dc4a4c29-d28f-4395-a164-48ec45f30595/.system_generated/logs/transcript.jsonl`

### Completion Notes List

- All tasks, subtasks, and 22 code-review patches for Epic 3 Story 2 are complete.
- Implemented 10 canonical mobile locale catalogs with strict key parity and English fallback.
- Added locale-aware backend recommendations, profile persistence, cache isolation, telemetry,
  generated SDK coverage, browser-backed screen tests, Pact verification, and a Maestro flow.
- Verified affected workspaces, root lint, root typecheck, locale catalog sync, and HTTP consumer
  and provider contracts.

### File List

- `apps/mobile/src/lib/formatters.ts`
- `apps/mobile/src/lib/formatters.test.ts`
- `apps/mobile/components/hero/weather-header.tsx`
- `apps/mobile/components/hero/hourly-forecast-ribbon.tsx`
- `apps/mobile/components/hero/scenario-toggles.tsx`
- `apps/mobile/app/(tabs)/two.tsx`
- `apps/api/src/modules/personalization/ritual.service.ts`
- `apps/api/src/modules/personalization/ritual.service.spec.ts`
- `apps/api/src/modules/personalization/ritual.controller.ts`
- `apps/api/src/modules/personalization/ritual.controller.spec.ts`
- `apps/api/src/modules/user/user.service.ts`
- `apps/api/src/modules/user/user.service.spec.ts`
- `apps/api/src/modules/user/user.controller.ts`
- `apps/api/src/modules/user/user.controller.spec.ts`
- `apps/api/src/contracts/http.ts`
- `packages/api-client/src/contracts/http/user.ts`
- `packages/api-client/src/testing/analytics-event-assertions.ts`
- `apps/mobile/src/screens/localization.test.tsx`
- `apps/mobile/src/test-utils/msw/handlers.ts`
- `tools/sync-i18n.js`
- `_bmad-output/test-artifacts/localization-qa-checklist.md`
