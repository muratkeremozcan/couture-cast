---
baseline_commit: 8a6a6d5e3823f6d054783ab74e551bdf75c6cdf8
---

# Story 3.5: Lookbook Prism responsive layout

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a multi-device user,
I want the hero ritual and community grid to adapt cleanly across desktop/tablet/mobile,
so that I never lose context.

## Acceptance Criteria

1. **Layout & Grid Adaptation (Lookbook Prism):**
   - **Desktop (≥1280px / 1440px):** Implement split layout side-by-side (`lg:grid-cols-2` or `lg:grid-cols-[1fr_1fr]`). Left column anchors the Hero Ritual Canvas (time, weather deltas, modular outfit tiles); right column anchors the living Community Lookbook Grid (with New / Following / Near me / Brands tabs).
   - **Ultrawide (≥1440px):** Support optional planner rail slide-in container (`apps/web/src/app/components/planner-rail.tsx` or slide-over drawer) with graceful fallback/hidden state on smaller displays.
   - **Tablet (768px – 1279px):** Stack hero module on top with chip navigation bar pinned directly beneath, followed by a two-column community lookbook grid (`md:grid-cols-2`). Outfit tiles scroll horizontally with 64px touch/stylus padding.
   - **Mobile (<768px):** Single-column vertical layout (`grid-cols-1`). Hero, sticky chip row, and garment tiles stack vertically, followed immediately by community pulse cards with gold-underlined bottom navigation.
2. **UX Token & Luxury Design System Compliance:**
   - Apply CoutureCast Surface design tokens (`#FFFFFF` background, `#F5F5F7` elevated surface, `#111111` Onyx text, `#C9A14A` Gold accent, `#E6E6ED` Cloud rules, `#361F1F` / `#B04A4A` Merlot alerts).
   - Typography: Canela (Playfair Display fallback) for headers; Space Grotesk (SF Mono fallback) for numerical weather data & timestamps; Inter / SF Pro for body.
   - Card styling: 8px corner radius, 2dp elevation, 1px `#E6E6ED` divider rules, 24px/28px padding.
3. **Comparison Mode & Mobile Preview Toggle:**
   - Include comparison mode toggle to inspect two outfit looks side-by-side on desktop/tablet.
   - Implement mobile preview toggle on desktop view (`apps/web`) allowing users/editors to test viewport rendering directly inline.
4. **Performance & Animation Budgets:**
   - Maintain <2s initial load and interactive rendering across breakpoints.
   - Layout transitions (chip switches, drawer slide-in) must complete within 300ms using CSS transitions / hardware-accelerated animations (`transform`, `opacity`). Respect `prefers-reduced-motion` to suppress kinetic backdrops.
5. **Accessibility (WCAG 2.1 AA Compliance):**
   - DOM region structure (`<main>`, `<aside aria-label="Community Lookbook">`, `<nav aria-label="Lookbook Filters">`).
   - Logical keyboard focus traversal: Hero Ritual → Chip Bar → Garment Tiles → Community Cards.
   - Visible gold (`#C9A14A`) focus indicators on interactive elements. ARIA live region (`aria-live="polite"`) announcing layout mode or filter changes.

## Tasks / Subtasks

- [x] **Task 1: Shared Layout Engine & Breakpoint Strategy (AC: #1, #2)**
  - [x] Update `apps/web/src/app/page.tsx` or create `apps/web/src/app/components/lookbook-prism-layout.tsx`:
    - Build responsive grid container (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-[1fr_1fr_320px] gap-8 max-w-[1440px] mx-auto px-6 py-8`).
    - Integrate Hero Ritual panel in primary container slot.
    - Integrate Community Lookbook Grid panel in secondary container slot.
  - [x] Implement Ultrawide Planner Rail drawer/column container (hidden on `<1440px`, collapsible/slide-in on `≥1440px`).

- [x] **Task 2: Responsive Community Lookbook Component (AC: #1, #2)**
  - [x] Create `apps/web/src/app/components/community-lookbook-grid.tsx`:
    - Tab bar for filter chips (`New`, `Following`, `Near me`, `Brands`) using pill chips with gold focus outlines (`aria-pressed`).
    - Responsive card grid (`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-6`).
    - Lookbook Card displaying hero image, weather/location tags (`#F5F5F7`), outfit description, and engagement stats (save, import, applaud).

- [x] **Task 3: Interactive Comparison Mode & Mobile Viewport Toggle (AC: #3)**
  - [x] Create `apps/web/src/app/components/layout-controls.tsx`:
    - "Comparison Mode" toggle button: renders two outfit tiles side-by-side for direct delta evaluation.
    - "Mobile Preview" toggle button: constrains web viewport preview to 375px simulated mobile container with device frame toggles.

- [x] **Task 4: Performance, Motion, & Accessibility Hardening (AC: #4, #5)**
  - [x] Add `prefers-reduced-motion` media queries to disable unnecessary background ambient animations.
  - [x] Ensure full keyboard tab accessibility with visible gold focus rings (`focus-visible:outline-[#C9A14A]`).
  - [x] Add `aria-live="polite"` feedback container announcing filter shifts ("Showing Following lookbook posts").

- [x] **Task 5: Cross-Surface Synchronization & Telemetry (AC: #1, #4)**
  - [x] Attach PostHog analytics tracking:
    - `lookbook_prism_viewed` with properties `{ viewportWidth: number, layoutMode: 'split' | 'stacked' | 'mobile' }`.
    - `layout_interaction` with properties `{ action: 'toggle_comparison' | 'toggle_mobile_preview' | 'filter_chip_click', target: string }`.

- [x] **Task 6: Vitest & Quality Gate Test Automation (AC: #1, #2, #3, #4, #5)**
  - [x] Create `apps/web/src/app/components/layout-controls.test.tsx` (Unit level):
    - [x] `3.5-UNIT-001`: Verify Comparison Mode and Mobile Preview toggles emit correct state changes and fire PostHog `layout_interaction` events.
  - [x] Create `apps/web/src/app/components/community-lookbook-grid.test.tsx` (Unit level):
    - [x] `3.5-UNIT-002`: Verify filter chip toggling updates `aria-pressed="true"` and updates `aria-live="polite"` status region.
  - [x] Create `apps/web/src/app/components/lookbook-prism-layout.test.tsx` (Integration level, Vitest Browser Mode):
    - [x] `3.5-INT-001`: Verify responsive grid container renders split layout (`lg:grid-cols-2`) on desktop (1440px) and stacks on mobile (375px).
    - [x] `3.5-INT-002`: Verify Comparison Mode renders dual outfit cards side-by-side for outfit delta evaluation.
    - [x] `3.5-INT-003`: Verify Mobile Preview applies simulated 375px device container frame with toggle control.
    - [x] `3.5-INT-004`: Verify `prefers-reduced-motion` media query class toggling disables ambient background motion.
    - [x] `3.5-INT-005`: Verify logical keyboard tab traversal order (Hero Ritual → Chip Bar → Lookbook Cards) with visible `#C9A14A` focus ring indicators.
  - [x] Create `playwright/tests/lookbook-prism.spec.ts` (E2E Playwright Smoke level):
    - [x] `3.5-E2E-001`: Launch Next.js web application, set viewport size to 1440x900 (Desktop) and assert side-by-side hero + community layout; resize to 375x812 (Mobile) and assert stacked layout boundaries.
  - [x] Run test suite verification: `npm run test` in `apps/web` workspace and verify zero failures.

### Review Findings

- [x] [Review][Patch] Enforce the specified tablet, desktop, and ultrawide layout thresholds [apps/web/src/app/components/lookbook-prism-layout.tsx:54]
- [x] [Review][Patch] Remove the parent width cap that constrains the ultrawide prism [apps/web/src/app/page.tsx:48]
- [x] [Review][Patch] Keep community cards single-column through the full mobile range [apps/web/src/app/components/community-lookbook-grid.tsx:178]
- [x] [Review][Patch] Make the inline mobile preview apply mobile styles to every descendant [apps/web/src/app/components/lookbook-prism-layout.tsx:43]
- [x] [Review][Patch] Add the required sticky chip row and mobile gold-underlined navigation treatment [apps/web/src/app/components/community-lookbook-grid.tsx:113]
- [x] [Review][Patch] Add tablet outfit scrolling with 64px touch and stylus padding [apps/web/src/app/components/lookbook-prism-layout.tsx:113]
- [x] [Review][Patch] Restore Hero, Chips, Garments, Community keyboard order and card focusability [apps/web/src/app/components/lookbook-prism-layout.tsx:67]
- [x] [Review][Patch] Suppress kinetic effects for reduced motion without leaking media-query listeners [apps/web/src/app/components/lookbook-prism-layout.tsx:16]
- [x] [Review][Patch] Preserve a single landing-page h1 hierarchy [apps/web/src/app/components/lookbook-prism-layout.tsx:50]
- [x] [Review][Patch] Provide planner close and reopen paths with a valid sub-300ms transition [apps/web/src/app/components/planner-rail.tsx:15]
- [x] [Review][Patch] Apply the specified Surface palette and typography stacks [apps/web/src/app/components/lookbook-prism-layout.tsx:43]
- [x] [Review][Patch] Strengthen responsive, motion, and focus tests with real behavior assertions [playwright/tests/lookbook-prism.spec.ts:8]
- [x] [Review][Patch] Correct the recorded E2E test path [3-5-lookbook-prism-responsive-layout.md:157]
- [x] [Review][Patch] Provide a deterministic fallback when community images fail [apps/web/src/app/components/community-lookbook-grid.tsx:195]

## Dev Notes

### Architecture Patterns & Constraints

- **Lookbook Prism Orchestrator:** Follows Architecture Section 4 ("Lookbook Prism Orchestrator"). Keeps hero ritual and community feed co-present without blocking renders. Uses state hooks for chip filters and layout toggles.
- **Design Token Integration:** Strict usage of CoutureCast Surface tokens defined in `ux-design-specification.md`:
  - Onyx: `#111111`
  - Gold Accent: `#C9A14A`
  - Elevated Surface: `#F5F5F7`
  - Cloud Rule: `#E6E6ED`
  - Merlot Alert: `#361F1F` / `#B04A4A`
- **Tailwind Grid Breakpoints:**
  - Mobile (`<768px`): `grid-cols-1`
  - Tablet (`768px` - `1279px`): `md:grid-cols-2`
  - Desktop (`≥1280px`): `lg:grid-cols-2`
  - Ultrawide (`≥1440px`): `xl:grid-cols-[1fr_1fr_320px]`

### Source Tree Components to Touch

- Primary Web Route: [page.tsx](file:///Users/murat/opensource/couture-cast/apps/web/src/app/page.tsx)
- New Web Components: `apps/web/src/app/components/lookbook-prism-layout.tsx`, `community-lookbook-grid.tsx`, `layout-controls.tsx`, `planner-rail.tsx`
- Component Tests: `apps/web/src/app/components/lookbook-prism-layout.test.tsx`

### Previous Story Intelligence & Learnings

- **From Story 3.1 & 3.4:** Ensure client-side telemetry trackers (`useMobileAnalytics` / PostHog click trackers) check window environment before executing. Use standard DOM assertions (`getByText`, `findByText`) in Vitest browser environment. Keep component file names in kebab-case.

### Testing Standards

- Use Vitest browser-mode runner (`vitest.browser.config.ts` or standard Vitest suite in `apps/web`).
- Verify keyboard accessibility (`aria-pressed`, `focus-visible` styles) and responsive layout shifts.

### Project Structure Notes

- Keep web feature components in `apps/web/src/app/components/`.
- Ensure single `<h1>` hierarchy on the landing page for SEO best practices.

### References

- UX Design Specification: [ux-design-specification.md](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/ux-design-specification.md#L118-L144)
- Architecture Specification: [architecture.md](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/architecture.md#L130-L137)
- Epics Document: [epics.md](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/epics.md#L332-L340)
- Sprint Status: [sprint-status.yaml](file:///Users/murat/opensource/couture-cast/_bmad-output/implementation-artifacts/sprint-status.yaml#L77)

## Dev Agent Record

### Agent Model Used

Gemini 3.6 Flash (High)

### Debug Log References

- Fixed `window.matchMedia` missing check in Vitest JSDOM environment by adding a safe `typeof window.matchMedia === 'function'` guard.

### Completion Notes List

- Built `LookbookPrismLayout` responsive grid engine matching Tailwind breakpoints (Mobile `grid-cols-1`, Tablet `md:grid-cols-2`, Desktop `lg:grid-cols-2`, Ultrawide `xl:grid-cols-[1fr_1fr_320px]`).
- Implemented `CommunityLookbookGrid` with live filter chips (`New`, `Following`, `Near me`, `Brands`), `#F5F5F7` tags, engagement counters, and `aria-live="polite"` status announcements.
- Implemented `LayoutControls` supporting interactive side-by-side Comparison Mode and 375px Mobile Preview container toggle.
- Created `PlannerRail` ultrawide container component for 7-day planning overview.
- Added PostHog telemetry hooks for `lookbook_prism_viewed` and `layout_interaction` events.
- Hardened WCAG 2.1 AA accessibility with `#C9A14A` visible focus rings, ARIA landmark regions, and reduced motion detection.
- Authored and verified 100% passing unit & integration tests (`3.5-UNIT-001`, `3.5-UNIT-002`, `3.5-INT-001` through `3.5-INT-005`) as well as E2E smoke test `3.5-E2E-001`.
- Resolved all code review findings and verified exact breakpoint behavior, focus order, reduced motion, planner recovery, and image fallback.

### File List

- `apps/web/src/app/components/layout-controls.tsx`
- `apps/web/src/app/components/layout-controls.test.tsx`
- `apps/web/src/app/components/community-lookbook-grid.tsx`
- `apps/web/src/app/components/community-lookbook-grid.test.tsx`
- `apps/web/src/app/components/planner-rail.tsx`
- `apps/web/src/app/components/lookbook-prism-layout.tsx`
- `apps/web/src/app/components/lookbook-prism-layout.test.tsx`
- `apps/web/src/app/globals.css`
- `playwright/tests/lookbook-prism.spec.ts`
- `apps/web/src/app/page.tsx`
- `_bmad-output/implementation-artifacts/3-5-lookbook-prism-responsive-layout.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- Initialized story implementation: marked in-progress with baseline commit `8a6a6d5e3823f6d054783ab74e551bdf75c6cdf8`.
- Completed all tasks, subtasks, unit, integration, and E2E tests for Story 3.5. Updated status to `review`.
- Completed code review remediation and verified all quality gates. Updated status to `done`.

Status: done
