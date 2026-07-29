---
baseline_commit: 4273fd9d6f46849b5c538821a4386de766019612
---

# Story 3.6: Chip navigation & sticky bottom nav

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want chip filters and bottom navigation to stay accessible (touch + keyboard),
so that I can pivot views quickly across mobile and web surfaces.

## Acceptance Criteria

1. **Chip Navigation (Personal / Community / Sponsored):**
   - Build a horizontal chip navigation bar presenting `Personal`, `Community`, and `Sponsored` filter chips.
   - Support horizontal touch scrolling with CSS snap points (`scroll-snap-type: x mandatory`, `snap-align: start`/`center`) and 64px touch/stylus target padding.
   - Implement sticky positioning (`sticky top-0 z-20`) so chip filters remain pinned during vertical page scrolling on both mobile and web viewports.
   - Implement full keyboard accessibility: Left Arrow (`ArrowLeft`), Right Arrow (`ArrowRight`), `Home`, and `End` keys navigate focus between chips. Active chip receives `aria-pressed="true"` (or `aria-selected="true"` if rendering in tablist context).

2. **Mobile Sticky Bottom Navigation:**
   - Build a fixed bottom navigation bar for mobile viewports (`<768px` and mobile preview container) anchored to the viewport bottom (`fixed bottom-0 left-0 right-0 z-30` or React Native absolute bottom).
   - Render primary navigation destinations: `Home` (`/`), `Wardrobe` (`/wardrobe`), `Community` (`/community`), and `Settings` (`/settings`).
   - Active tab features a gold-underlined visual indicator (`#C9A14A` bottom border / active bar).
   - Enforce visible gold focus ring (`focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]`) for keyboard/switch control users.
   - Incorporate safe-area inset handling (`pb-[env(safe-area-inset-bottom,1.25rem)]` on web, `useSafeAreaInsets().bottom` on Expo React Native) to prevent overlap with native iOS/Android gesture bars.

3. **State Synchronization & Telemetry Integration:**
   - Synchronize active chip selection (`Personal`, `Community`, `Sponsored`) across the lookbook grid, hero recommendations, and filter feed modules.
   - Provide an ARIA live region (`aria-live="polite"`, `role="status"`) announcing state changes to screen readers (e.g. "Showing Personal recommendations", "Navigated to Community tab").
   - Track PostHog analytics event `chip_changed` with properties `{ chipCategory: 'Personal' | 'Community' | 'Sponsored', previousCategory: string, surface: 'web' | 'mobile' }` on chip selection.
   - Track PostHog analytics event `bottom_nav_clicked` with properties `{ tabId: string, label: string, targetPath: string }` when bottom navigation items are tapped/clicked.

4. **Cross-Surface Consistency & Accessibility (WCAG 2.1 AA):**
   - Web implementation (`apps/web`): Integrates cleanly into `LookbookPrismLayout` and `CommunityLookbookGrid` without breaking mobile inline preview toggle or ultrawide desktop layouts.
   - Mobile implementation (`apps/mobile`): Updates `apps/mobile/app/(tabs)/_layout.tsx` and custom navigation components with gold active tab styling and safe-area padding.
   - Ensure all touch targets meet minimum 44x44px boundaries.
   - Maintain color contrast ratio ≥ 4.5:1 for text against background in both light (`#FFFFFF`) and dark (`#000000` / Onyx) modes.

## Tasks / Subtasks

- [x] **Task 1: Web Chip Navigation Component (AC: #1, #3, #4)**
  - [x] Create `apps/web/src/app/components/chip-navigation.tsx`:
    - Export `ChipCategory` type (`'Personal' | 'Community' | 'Sponsored'`).
    - Build sticky container (`sticky top-0 z-20 bg-[#FFFFFF]/95 backdrop-blur border-b border-[#E6E6ED] py-3`).
    - Implement scroll-snap horizontal container (`flex items-center gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-none px-4`).
    - Add keyboard event handler listening for `ArrowLeft`, `ArrowRight`, `Home`, and `End` keys to shift focus dynamically.
    - Set `aria-pressed={isActive}` and `aria-label="Filter recommendations by category"`.
    - Apply Surface design tokens: active chip `#C9A14A` border/fill, inactive chip `#F5F5F7` background with `#E6E6ED` border.
    - Trigger `posthog.capture('chip_changed', ...)` on click or keyboard activation.
  - [x] Integrate `ChipNavigation` into `apps/web/src/app/components/lookbook-prism-layout.tsx` and `community-lookbook-grid.tsx`.

- [x] **Task 2: Web Mobile Sticky Bottom Navigation Component (AC: #2, #3, #4)**
  - [x] Create `apps/web/src/app/components/sticky-bottom-nav.tsx`:
    - Render fixed bottom bar visible on mobile viewports (`block min-[768px]:hidden` and when `isMobilePreview` is active).
    - Destinations: Home (`/`), Wardrobe (`#wardrobe`), Community (`#community`), Settings (`#settings`).
    - Active tab indicator: solid gold underline bar (`bg-[#C9A14A] h-1 w-full absolute bottom-0`).
    - Safe-area bottom padding: `pb-[env(safe-area-inset-bottom,0.75rem)]`.
    - Add gold focus ring (`focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]`).
    - Trigger `posthog.capture('bottom_nav_clicked', ...)` on tab switch.
  - [x] Integrate `StickyBottomNav` into `apps/web/src/app/page.tsx` or `lookbook-prism-layout.tsx`.

- [x] **Task 3: Mobile Expo Bottom Tab Bar & Chip Component (AC: #1, #2, #3, #4)**
  - [x] Update `apps/mobile/app/(tabs)/_layout.tsx`:
    - Configure gold active tint color (`tabBarActiveTintColor: '#C9A14A'`).
    - Apply custom tab bar styling with gold active indicator line and safe-area inset handling via `useSafeAreaInsets()`.
    - Add accessible `aria-label` and `testID` properties to all tab buttons (`tab-home`, `tab-wardrobe`, `tab-community`, `tab-settings`).
  - [x] Create `apps/mobile/components/chip-navigation.tsx`:
    - Implement React Native `ScrollView` with `horizontal`, `showsHorizontalScrollIndicator={false}`, `decelerationRate="fast"`, and `snapToInterval`.
    - Render `Personal`, `Community`, `Sponsored` chip pressables with gold active borders and haptic feedback if available.
    - Wire PostHog analytics tracking via `useMobileAnalytics`.

- [x] **Task 4: State Sync & Feed Module Filtering (AC: #3)**
  - [x] Connect `ChipNavigation` selection state to the hero outfit recommendation cards and community grid feed.
  - [x] Add hidden ARIA live region (`<div aria-live="polite" role="status" className="sr-only">`) announcing active filter scope changes ("Showing Personal recommendations").

- [x] **Task 5: Vitest Unit & Integration Test Automation (AC: #1, #2, #3, #4)**
  - [x] Create `apps/web/src/app/components/chip-navigation.test.tsx`:
    - `3.6-UNIT-001`: Verify rendering of Personal, Community, and Sponsored chips with correct `aria-pressed` states.
    - `3.6-UNIT-002`: Verify keyboard arrow navigation (`ArrowLeft` / `ArrowRight` / `Home` / `End`) moves focus between chip elements and `Tab` exits cleanly to next focusable element.
    - `3.6-UNIT-003`: Verify PostHog `chip_changed` event is emitted on chip selection.
    - `3.6-UNIT-004`: Verify `aria-live="polite"` region updates text content dynamically (e.g. "Showing Personal recommendations") upon chip selection.
    - `3.6-UNIT-005`: Verify telemetry failure isolation: if `posthog.capture` throws an exception, chip selection callback and state update proceed without unhandled errors.
  - [x] Create `apps/web/src/app/components/sticky-bottom-nav.test.tsx`:
    - `3.6-UNIT-006`: Verify bottom nav renders 4 destination tabs with gold active indicator line on active route.
    - `3.6-UNIT-007`: Verify PostHog `bottom_nav_clicked` event is emitted on tab selection.
    - `3.6-UNIT-008`: Verify bottom nav is rendered on mobile viewports (<768px) / mobile preview and hidden on desktop viewports (>=768px).
  - [x] Create `apps/mobile/components/chip-navigation.test.tsx`:
    - `3.6-UNIT-009`: Verify mobile chip component renders chips, applies safe-area padding, and triggers selection callback.
  - [x] Run unit test verification: `npm run test` in `apps/web` and `apps/mobile`.

- [x] **Task 6: E2E Playwright & Maestro Test Verification (AC: #1, #2, #3, #4)**
  - [x] Create `playwright/tests/chip-navigation-bottom-nav.spec.ts`:
    - `3.6-E2E-001`: Launch web application at 375x812 viewport; assert sticky bottom nav is visible with gold active indicator; verify hidden state at 1280x800 desktop viewport.
    - `3.6-E2E-002`: Test chip navigation bar sticky positioning on vertical scroll and verify chip clicks update feed state.
    - `3.6-E2E-003`: Assert keyboard arrow navigation across chips and focus ring visibility (`focus-visible:outline-[#C9A14A]`).
    - `3.6-E2E-004`: Verify `prefers-reduced-motion` suppresses transition animations on chip selection.
  - [x] Create `maestro/chip-navigation-bottom-nav.yaml`:
    - `3.6-MAE-001`: Test native mobile bottom tab navigation and chip filter switching flow.
  - [x] Run full workspace validation: `npm run verify:changed` / `npm run lint` / `npm run format`.

### Review Findings

- [x] [Review][Patch] Use `/wardrobe`, `/community`, and `/settings` for the web
      bottom-nav destinations, add minimal route surfaces, and derive active state from
      the pathname [apps/web/src/app/components/sticky-bottom-nav.tsx:16]
- [x] [Review][Patch] Synchronize web chip selection with hero and community content
      [apps/web/src/app/components/lookbook-prism-layout.tsx:20]
- [x] [Review][Patch] Integrate native chip navigation with recommendation state,
      mobile telemetry, stable snapping, and production rendering
      [apps/mobile/components/chip-navigation.tsx:14]
- [x] [Review][Patch] Complete the native four-tab navigation with safe-area spacing,
      active indicator, telemetry, accessible labels, test IDs, and dark-mode contrast
      [apps/mobile/app/(tabs)/_layout.tsx:24]
- [x] [Review][Patch] Keep the web chip controls sticky without overlapping the
      existing filter bar or losing stickiness inside mobile preview
      [apps/web/src/app/components/lookbook-prism-layout.tsx:75]
- [x] [Review][Patch] Constrain the web bottom nav to mobile preview, reserve page
      space, and announce navigation state
      [apps/web/src/app/components/sticky-bottom-nav.tsx:50]
- [x] [Review][Patch] Implement a single-tab-stop keyboard model for the web chip
      group and verify real Tab-key exit
      [apps/web/src/app/components/chip-navigation.tsx:89]
- [x] [Review][Patch] Replace shallow acceptance tests with observable state,
      stickiness, focus, motion, native navigation, and telemetry assertions
      [playwright/tests/chip-navigation-bottom-nav.spec.ts:23]

## Dev Notes

### Architecture & Design System Compliance

- **Surface Design Tokens:**
  - Background: `#FFFFFF` (light mode) / `#000000` (dark mode)
  - Surface Elevated: `#F5F5F7`
  - Text Primary: `#111111` (Onyx)
  - Accent Gold: `#C9A14A` (used for active chip border/fill, bottom nav active underline bar, and focus rings)
  - Cloud Rule: `#E6E6ED`
  - Text Muted: `#5C5C66`
- **Typography:**
  - Display Headers: Canela / Playfair Display (`font-semibold`)
  - Numerical metrics & metrics badges: Space Grotesk / SF Mono (`uppercase tracking-wider`)
  - Body & Tab Labels: Inter / SF Pro (`text-xs` / `text-sm`, `font-medium`)
- **Key Accessibility Requirements (WCAG 2.1 AA):**
  - All interactive buttons must have visible gold focus rings (`focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A14A]`).
  - Minimum touch target size: 44x44px.
  - Screen reader feedback: ARIA live region (`aria-live="polite"`, `role="status"`) announcing filter changes.
  - Keyboard navigation: Arrow key traversal (`ArrowLeft`, `ArrowRight`, `Home`, `End`) must focus the next/previous chip element without dropping out of the container.

### Source Tree Files to Touch

- **Web Workspace (`apps/web`):**
  - `apps/web/src/app/components/chip-navigation.tsx` (NEW)
  - `apps/web/src/app/components/sticky-bottom-nav.tsx` (NEW)
  - `apps/web/src/app/components/community-lookbook-grid.tsx` (UPDATE: consume shared ChipNavigation and state sync)
  - `apps/web/src/app/components/lookbook-prism-layout.tsx` (UPDATE: integrate sticky chip navigation and bottom nav in mobile preview)
  - `apps/web/src/app/page.tsx` (UPDATE: attach sticky bottom nav for web mobile viewports)
  - `apps/web/src/app/components/chip-navigation.test.tsx` (NEW)
  - `apps/web/src/app/components/sticky-bottom-nav.test.tsx` (NEW)
  - `playwright/tests/chip-navigation-bottom-nav.spec.ts` (NEW)

- **Mobile Workspace (`apps/mobile`):**
  - `apps/mobile/app/(tabs)/_layout.tsx` (UPDATE: gold active tint, bottom nav styling, safe-area insets)
  - `apps/mobile/components/chip-navigation.tsx` (NEW)
  - `apps/mobile/components/chip-navigation.test.tsx` (NEW)
  - `maestro/chip-navigation-bottom-nav.yaml` (NEW)

### Learnings from Previous Stories (Stories 3.1 & 3.5)

- **React Native Web DOM Assertions:** In Vitest component tests (`vitest-browser-react`), use DOM queries (`getByText`, `findByText`, `getByRole`) matching React Native Web HTML output rather than `@testing-library/react-native`.
- **Reduced Motion:** Wrap kinetic transitions in `motion-safe:` classes or check `prefers-reduced-motion` media queries so ambient animations do not trigger layout thrashing.
- **PostHog Guard:** Always wrap `posthog.capture` calls in `try / catch` blocks to prevent missing analytics keys or uninitialized client instances from crashing the UI render tree.
- **Single h1 Constraint:** Maintain exactly one `<h1>` per page on web landing routes; section headers for chip navigation or lookbook grids must use `<h2>` or `<h3>`.

### Project Structure Notes

- Web components live in `apps/web/src/app/components/`.
- Mobile components live in `apps/mobile/components/` or `apps/mobile/src/features/`.
- Playwright E2E specs live in `playwright/tests/`.
- Maestro flows live in `maestro/`.

### References

- [Epics Document](file:///_bmad-output/planning-artifacts/epics.md#L341-L349) - Story CC-3.6 Specification
- [UX Design Specification](file:///_bmad-output/planning-artifacts/ux-design-specification.md) - Surface Design Tokens & Accessibility
- [Project Context](file:///_bmad-output/project-context.md) - AI Coding Rules, Tech Stack & Testing Standards
- [Previous Story 3.5](file:///_bmad-output/implementation-artifacts/3-5-lookbook-prism-responsive-layout.md) - Lookbook Prism Responsive Layout Patterns

## Dev Agent Record

### Agent Model Used

Gemini 3.6 Flash (High); Codex review closeout

### Debug Log References

- `npm run test:pw-local -- playwright/tests/chip-navigation-bottom-nav.spec.ts --grep '3.6-E2E-001'`: reproduced the missing `/community` route as a 404.
- `npm run test:pw-local -- playwright/tests/chip-navigation-bottom-nav.spec.ts`: 4 tests passed.
- `npm run verify:changed`: mobile and web validation passed.
- Maestro was not executed because no iOS simulator or Android emulator was available.

### Completion Notes List

- Built web `ChipNavigation` component with horizontal scroll-snap, sticky positioning, arrow keyboard traversal, `aria-pressed`, and PostHog `chip_changed` telemetry.
- Built web `StickyBottomNav` with real route destinations, pathname-derived active state, mobile visibility, safe-area padding, live announcements, telemetry, and minimal destination pages.
- Treated AC 2 route destinations as authoritative over the stale hash examples in Task 2.
- Integrated chip selection with web hero and community content.
- Integrated native chip selection with recommendation state and mobile telemetry.
- Completed the native four-tab layout with route surfaces, safe-area spacing, active indicators, telemetry, accessibility labels, test IDs, and dark-mode contrast.
- Updated Playwright and Maestro coverage to assert observable navigation and state changes.
- Verified `apps/web`: lint, typecheck, 46 tests, and production build passed.
- Verified `apps/mobile`: lint, typecheck, 87 tests, widget checks, and watchOS checks passed.
- Verified Story 3.6 Playwright suite: 4 tests passed.

### File List

- `apps/web/src/app/components/chip-navigation.test.tsx` (NEW)
- `apps/web/src/app/components/chip-navigation.tsx` (NEW)
- `apps/web/src/app/components/community-lookbook-grid.tsx` (UPDATE)
- `apps/web/src/app/components/lookbook-prism-layout.test.tsx` (UPDATE)
- `apps/web/src/app/components/lookbook-prism-layout.tsx` (UPDATE)
- `apps/web/src/app/components/mobile-destination-page.tsx` (NEW)
- `apps/web/src/app/components/sticky-bottom-nav.test.tsx` (NEW)
- `apps/web/src/app/components/sticky-bottom-nav.tsx` (NEW)
- `apps/web/src/app/community/page.tsx` (NEW)
- `apps/web/src/app/page.tsx` (UPDATE)
- `apps/web/src/app/settings/page.tsx` (NEW)
- `apps/web/src/app/wardrobe/page.tsx` (NEW)
- `apps/mobile/app/(tabs)/_layout.tsx` (UPDATE)
- `apps/mobile/app/(tabs)/community.tsx` (NEW)
- `apps/mobile/app/(tabs)/index.tsx` (UPDATE)
- `apps/mobile/app/(tabs)/settings.tsx` (NEW)
- `apps/mobile/app/(tabs)/wardrobe.tsx` (NEW)
- `apps/mobile/components/chip-navigation.test.tsx` (NEW)
- `apps/mobile/components/chip-navigation.tsx` (NEW)
- `apps/mobile/components/tab-destination-screen.tsx` (NEW)
- `apps/mobile/src/screens/hero-experience.test.tsx` (UPDATE)
- `playwright/tests/chip-navigation-bottom-nav.spec.ts` (NEW)
- `maestro/chip-navigation-bottom-nav.yaml` (NEW)
- `_bmad-output/implementation-artifacts/3-6-chip-navigation-sticky-bottom-nav.md` (UPDATE)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE)

### Change Log

- 2026-07-29: Addressed eight code-review findings, restored minimal route surfaces, completed validation, and closed the story.
