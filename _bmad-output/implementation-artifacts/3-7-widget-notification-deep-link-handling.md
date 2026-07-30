---
baseline_commit: dd5e773bb5b0e9ee9a050e50e3fc4a29573321b1
---

# Story 3.7: Widget / notification deep-link handling

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user launching from widgets or alerts,
I want to land on the relevant state so that context is preserved across web and mobile surfaces.

## Acceptance Criteria

1. **Widget Tap Deep-Link Hydration & Offline Fallback (AC: #1):**
   - Encode widget tap source and slot parameters (e.g. `source=widget&slot=am`, `source=widget&slot=pm`, `source=widget&slot=evening`, `source=widget&slot=now`, `source=widget&slot=next`).
   - On launch, parse search parameters and hydrate the hero canvas to display the matching recommendation scenario (`morning`, `midday`, `evening`) and corresponding chip selection (`Personal`, `Community`, `Sponsored`).
   - Support offline degradation: if device is offline or networking fails during deep link navigation, open the hero canvas with local cached data (`readLatestRitualCache`) and surface a stale indicator / toast informing the user that cached data is displayed.

2. **Severe-Weather Push & Community Notification Deep-Links (AC: #2):**
   - Severe-weather push notification deep-links (`source=notification&type=severe_weather&alertId=...` or `source=notification&type=weather_alert`) open the hero canvas directly with the severe weather alert state in focus (autoscrolled to alert banner, with clear action buttons "Adjust outfit" and "Plan week").
   - Community ping push notification deep-links (`source=notification&type=community&cardId=...`) open directly into the Lookbook Prism / Community view with the referenced lookbook card highlighted (visual border highlight and autoscrolled into view).
   - Ensure screen-reader cursor and keyboard focus land directly on the focused alert banner or highlighted community card upon arrival.

3. **Invalid & Expired Deep-Link Handling (AC: #3):**
   - Invalid or expired deep-link payloads (e.g. malformed query parameters, missing required fields, non-existent `cardId`/`alertId`, or expired link tokens) must fail gracefully.
   - The app falls back to the default hero ritual view (`/`) without crashing or showing blank/error screens.
   - Display a non-intrusive info banner at the top of the canvas: _"We refreshed your data after reconnecting"_ (or translated equivalent: _"We refreshed your daily guidance"_).
   - Fire PostHog telemetry event `deep_link_invalid` with properties `{ rawUrl: string, reason: string, surface: 'web' | 'mobile' }`.

4. **Cross-Surface Consistency, Telemetry & Accessibility (WCAG 2.1 AA) (AC: #4):**
   - Web implementation (`apps/web`): Support search params in Next.js App Router (`apps/web/src/app/page.tsx`, `apps/web/src/app/components/lookbook-prism-layout.tsx`) using `useSearchParams()` or URL parsing.
   - Mobile implementation (`apps/mobile`): Support URL parameters in Expo Router (`apps/mobile/app/(tabs)/index.tsx`, `apps/mobile/app/(tabs)/community.tsx`) using `useLocalSearchParams()`.
   - Fire PostHog telemetry event `deep_link_handled` on valid deep-link navigation with properties `{ source: 'widget' | 'notification' | 'watch', slot?: string, type?: 'severe_weather' | 'community', alertId?: string, cardId?: string, surface: 'web' | 'mobile' }`.
   - Announce state transition via ARIA live region (`aria-live="polite"`, `role="status"`).
   - Maintain color contrast ratio ≥ 4.5:1 for info banners, focus rings (`#C9A14A`), and alert overlays.

## Tasks / Subtasks

- [x] **Task 1: Shared Deep-Link Parsing & Validation Utility (AC: #1, #2, #3, #4)**
  - [x] Create `packages/utils/src/deep-link.ts`:
    - Export `DeepLinkPayload` type and Zod validation schema `deepLinkSchema`:
      - `source`: `'widget' | 'notification' | 'watch' | 'app'`
      - `slot`: `'am' | 'pm' | 'evening' | 'now' | 'next'` (optional)
      - `type`: `'severe_weather' | 'community' | 'weather_alert'` (optional)
      - `alertId`: string (optional)
      - `cardId`: string (optional)
    - Implement `parseDeepLink(params: Record<string, unknown>): { valid: boolean; payload?: DeepLinkPayload; errorReason?: string }`.
    - Map widget slots (`am` -> `morning`, `pm` -> `midday`, `evening` -> `evening`, `now`/`next` resolved via forecast timestamps).
  - [x] Write unit tests for deep link parsing & validation logic (`packages/utils/src/deep-link.spec.ts`).

- [x] **Task 2: Web Deep-Link Hydration, Alert Focus & Community Card Highlighting (AC: #1, #2, #3, #4)**
  - [x] Update `apps/web/src/app/components/lookbook-prism-layout.tsx` and `apps/web/src/app/lib/deep-link-handler.ts`:
    - Read search params using `URLSearchParams(window.location.search)`.
    - Validate params using `parseDeepLink`.
    - If `source === 'widget'` and valid `slot`: hydrate `chipCategory` and hero recommendation state.
    - If `source === 'notification'` and `type === 'severe_weather'`: focus weather alert banner, autoscroll to hero section, set `aria-expanded="true"`.
    - If `source === 'notification'` and `type === 'community'` with `cardId`: switch to Community tab/grid, scroll target card into view, apply visual highlight border (`ring-2 ring-[#C9A14A]`), and focus card element.
    - If invalid or expired link: set `isInvalidDeepLink = true`, render `<InfoBanner message="We refreshed your data after reconnecting" />`, and capture `deep_link_invalid` PostHog event.
    - On valid deep link: capture `deep_link_handled` PostHog event.
  - [x] Add ARIA live announcement: _"Navigated from widget/notification. Guidance updated."_.

- [x] **Task 3: Mobile Expo Router Deep-Link Hydration & Focus Management (AC: #1, #2, #3, #4)**
  - [x] Update `apps/mobile/app/(tabs)/index.tsx`:
    - Expand deep link search param handling using `useLocalSearchParams()`.
    - Handle `source === 'notification'` and `type === 'severe_weather'`: focus `WeatherAlertBanner`, autoscroll to alert card.
    - Handle `source === 'notification'` and `type === 'community'`: navigate to `apps/mobile/app/(tabs)/community.tsx`, passing `cardId`.
    - Handle invalid/expired deep-link params: display native info banner and capture PostHog telemetry `deep_link_invalid`.
    - Clear search params via `router.setParams({...})` after processing.
  - [x] Update `apps/mobile/app/(tabs)/community.tsx`:
    - Accept `cardId` search parameter.
    - Highlight and focus matching community lookbook card upon mount.

- [x] **Task 4: Invalid & Expired Info Banner Component (AC: #3, #4)**
  - [x] Create `apps/web/src/app/components/info-banner.tsx`:
    - Reusable alert/info banner component with Gold/Onyx design tokens.
    - Dismissible with `Close` button.
    - Includes `aria-live="polite"` and `data-testid="deep-link-info-banner"`.
  - [x] Create `apps/mobile/components/info-banner.tsx`:
    - Native React Native info banner component with safe-area spacing and accessibility support.

- [x] **Task 5: Vitest & Component Unit Tests (AC: #1, #2, #3, #4)**
  - [x] Create `apps/web/src/app/components/deep-link-handling.test.tsx`:
    - `3.7-UNIT-001`: Verify `parseDeepLink` correctly parses valid widget slots (`am`, `pm`, `evening`, `now`, `next`).
    - `3.7-UNIT-002`: Verify severe-weather notification deep link focuses weather alert banner and triggers `deep_link_handled` telemetry.
    - `3.7-UNIT-003`: Verify community notification deep link switches tab, highlights target card by `cardId`, and focuses element.
    - `3.7-UNIT-004`: Verify malformed/expired deep link falls back to default hero ritual, renders info banner, and fires `deep_link_invalid` event.
  - [x] Create `apps/mobile/src/screens/deep-link-handling.test.tsx`:
    - `3.7-UNIT-005`: Verify severe weather alert focus on notification deep link.
    - `3.7-UNIT-006`: Verify InfoBanner and `deep_link_invalid` event on malformed parameters.
    - `3.7-UNIT-007`: Verify CommunityScreen highlights post card on notification deep link.

- [x] **Task 6: E2E Playwright & Maestro Automation (AC: #1, #2, #3, #4)**
  - [x] Create `playwright/tests/deep-link-handling.spec.ts`:
    - `3.7-E2E-001`: Test widget deep link URL `/?source=widget&slot=am` -> verifies hero canvas hydrated with Personal/Morning recommendation.
    - `3.7-E2E-002`: Test severe weather notification deep link `/?source=notification&type=severe_weather&alertId=alert-999` -> verifies severe weather alert banner focused.
    - `3.7-E2E-003`: Test community notification deep link `/?source=notification&type=community&cardId=look-3` -> verifies community view displayed with highlighted card.
    - `3.7-E2E-004`: Test invalid deep link `/?source=invalid_source&slot=bad_slot` -> verifies fallback hero ritual with info banner visible.
  - [x] Create `maestro/deep-link-handling.yaml`:
    - `3.7-MAE-001`: Test native mobile deep link routing for widget taps, severe weather alerts, and community pings.
  - [x] Verify full workspace verification suite: `npm run verify:changed` / `npm run lint` / `npm run test`.

### Review Findings

- [x] [Review][Patch] [High] Add canonical data-backed notification target and expiry contracts [packages/api-client/src/contracts/http/weather.ts:51]; decision: implement in Story 3.7
- [x] [Review][Patch] [High] Provide canonical forecast context for web `now` and `next` resolution [apps/web/src/app/lib/deep-link-handler.ts:32]; decision: implement in Story 3.7
- [x] [Review][Patch] [High] Make the mobile deep-link flow pass strict TypeScript and lint checks [apps/mobile/app/(tabs)/index.tsx:227]
- [x] [Review][Patch] [High] Replace the unsupported Playwright `toHaveTextContent` matcher so the E2E spec typechecks [playwright/tests/deep-link-handling.spec.ts:24]
- [x] [Review][Patch] [High] Reject incomplete source-specific payloads and missing-source deep links instead of emitting handled telemetry [packages/utils/src/deep-link.ts:16]
- [x] [Review][Patch] [High] Resolve the web community card's owning filter, then scroll and focus the rendered target [apps/web/src/app/lib/deep-link-handler.ts:54]
- [x] [Review][Patch] [Medium] Use alert, focus-ring, and dismiss-icon colors that meet the story's contrast requirement [apps/web/src/app/components/lookbook-prism-layout.tsx:176]
- [x] [Review][Patch] [Medium] Emit mobile community `deep_link_handled` telemetry once after successful destination handling [apps/mobile/app/(tabs)/community.tsx:13]

## Dev Notes

### Architecture & Design System Compliance

- **Design System Tokens:**
  - Active Accent Gold: `#C9A14A`
  - Onyx Text / Background: `#111111` / `#000000`
  - Elevated Surface / Card Background: `#F5F5F7` / `#1A1A1E`
  - Warning / Alert Merlot / Amber: `#D97706` / `#B91C1C`
- **Focus & Accessibility Rules (WCAG 2.1 AA):**
  - Highlighting cards or alert banners must use visible outline/ring: `ring-2 ring-[#C9A14A]` or `focus-visible:outline-[#C9A14A]`.
  - ARIA live region (`aria-live="polite"`, `role="status"`) announces deep link state hydration to screen readers.
  - Keyboard focus must programmatically land on the target element using `.focus()` when navigating from notification deep links.

### File Structure & Dependencies

- **Web Source Files Touched:**
  - `apps/web/src/app/components/lookbook-prism-layout.tsx`
  - `apps/web/src/app/components/community-lookbook-grid.tsx`
  - `apps/web/src/app/components/sticky-bottom-nav.tsx`
  - `apps/web/src/app/components/info-banner.tsx` (NEW)
  - `apps/web/src/app/lib/deep-link-handler.ts` (NEW)
  - `apps/web/src/app/components/deep-link-handling.test.tsx` (NEW)
- **Mobile Source Files Touched:**
  - `apps/mobile/app/(tabs)/index.tsx`
  - `apps/mobile/app/(tabs)/community.tsx`
  - `apps/mobile/components/info-banner.tsx` (NEW)
  - `apps/mobile/src/screens/deep-link-handling.test.tsx` (NEW)
- **Shared Utilities Touched:**
  - `packages/utils/src/deep-link.ts` (NEW)
  - `packages/utils/src/deep-link.spec.ts` (NEW)
  - `packages/utils/src/index.ts`
- **Test Automation Files:**
  - `playwright/tests/deep-link-handling.spec.ts` (NEW)
  - `maestro/deep-link-handling.yaml` (NEW)

### Previous Story Learnings & Integration Points

- **Story 3.3 (Home/lock-screen widgets):** Established initial widget parameter contract (`source=widget&size=small|medium&slot=now|next`). Story 3.7 extends this contract to support `am`, `pm`, `evening`, notification deep links (`severe_weather`, `community`), invalid/expired link fallbacks, and cross-surface web parity.
- **Story 3.6 (Chip navigation & sticky bottom nav):** Established state sync between chip selection (`Personal`, `Community`, `Sponsored`), hero recommendations, lookbook grid filtering, and route destinations (`/`, `/wardrobe`, `/community`, `/settings`). Story 3.7 leverages this chip navigation synchronization when processing widget/notification deep links.
- **Offline & Cache Resilience:** Always check `readLatestRitualCache` before displaying fallback error UI if network request fails or device is offline.

### References

- Epic 3 Specification: [\_bmad-output/planning-artifacts/epics.md](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/epics.md#L350-L358)
- UX Specification for Deep Links: [\_bmad-output/planning-artifacts/ux-design-specification.md](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/ux-design-specification.md#L242-L248)
- Story 3.3 Implementation: [\_bmad-output/implementation-artifacts/3-3-home-lock-screen-widgets.md](file:///Users/murat/opensource/couture-cast/_bmad-output/implementation-artifacts/3-3-home-lock-screen-widgets.md)
- Story 3.6 Implementation: [\_bmad-output/implementation-artifacts/3-6-chip-navigation-sticky-bottom-nav.md](file:///Users/murat/opensource/couture-cast/_bmad-output/implementation-artifacts/3-6-chip-navigation-sticky-bottom-nav.md)
- Mobile Hero Screen: [apps/mobile/app/(tabs)/index.tsx](file:///Users/murat/opensource/couture-cast/apps/mobile/app/%28tabs%29/index.tsx)
- Web Lookbook Prism Layout: [apps/web/src/app/components/lookbook-prism-layout.tsx](file:///Users/murat/opensource/couture-cast/apps/web/src/app/components/lookbook-prism-layout.tsx)

## Dev Agent Record

### Agent Model Used

Gemini 3.6 Flash (High)

### Debug Log References

### Completion Notes List

- Implemented shared Zod deep link parsing and validation utility `packages/utils/src/deep-link.ts` with unit tests.
- Integrated deep link hydration, severe weather alert focus, community card highlighting, and invalid link info banner in `apps/web/src/app/components/lookbook-prism-layout.tsx`.
- Integrated Expo Router deep link handling and community card highlighting in `apps/mobile/app/(tabs)/index.tsx` and `community.tsx`.
- Built cross-platform `<InfoBanner>` component in `apps/web` and `apps/mobile`.
- Created unit test suites for web (`deep-link-handling.test.tsx`) and mobile (`deep-link-handling.test.tsx`).
- Created Playwright E2E spec (`playwright/tests/deep-link-handling.spec.ts`) and Maestro E2E test (`maestro/deep-link-handling.yaml`).
- Review fixes added expiry-aware validation, canonical event targets, time-aware scenario
  resolution, deterministic focus, single destination telemetry, and accessible colors.
- Verification passed with `npm run verify:changed`, Playwright TypeScript checks, four
  end-to-end scenarios, and a 12-run Playwright burn-in.

### File List

- `packages/utils/src/deep-link.ts`
- `packages/utils/src/deep-link.spec.ts`
- `packages/utils/src/index.ts`
- `packages/utils/package.json`
- `package-lock.json`
- `packages/api-client/src/index.ts`
- `packages/api-client/src/types/deep-link-targets.ts`
- `packages/api-client/src/testing/deep-link-events.ts`
- `apps/api/src/modules/alerts/alert-fanout.processor.ts`
- `apps/api/src/modules/alerts/alert-fanout.processor.spec.ts`
- `apps/web/src/app/components/info-banner.tsx`
- `apps/web/src/app/lib/deep-link-handler.ts`
- `apps/web/src/app/components/lookbook-prism-layout.tsx`
- `apps/web/src/app/components/community-lookbook-grid.tsx`
- `apps/web/src/app/components/sticky-bottom-nav.tsx`
- `apps/web/src/app/components/deep-link-handling.test.tsx`
- `apps/mobile/components/info-banner.tsx`
- `apps/mobile/app/(tabs)/index.tsx`
- `apps/mobile/app/(tabs)/community.tsx`
- `apps/mobile/src/screens/deep-link-handling.test.tsx`
- `apps/mobile/src/lib/mobile-deep-link-handler.ts`
- `apps/mobile/src/screens/widget-deep-link.test.tsx`
- `apps/mobile/components/chip-navigation.test.tsx`
- `apps/mobile/src/analytics/mobile-analytics.test.tsx`
- `apps/mobile/src/screens/hero-experience.test.tsx`
- `apps/mobile/src/screens/tab-two-screen.test.tsx`
- `playwright/tests/deep-link-handling.spec.ts`
- `playwright/support/auth-session/custom-auth-provider.ts`
- `maestro/deep-link-handling.yaml`
- `_bmad-output/implementation-artifacts/3-7-widget-notification-deep-link-handling.md`
