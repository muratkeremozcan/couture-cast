# Test design: Story CC-7.11 five-tab navigation and back pattern

Updated: 2026-11-26. Builder contract confirmed (titles, menu roles, Looks signed out shows the
empty line and both rows, notification settings entered from Community); E2E-035, 044 and 045
moved or dropped as noted in their rows.

Updated: 2026-11-26. Initial plan from spec-7-11 (ready-for-dev, baseline 4e5702c3), decisions
D1 to D15, with TEA pushback P1 to P8 accepted by the builder (spec Plan Change Log; P4 native fold
at 360 x 640).

Status: active

## Scope

Spec: `_bmad-output/implementation-artifacts/spec-7-11-five-tab-navigation-back-pattern.md`.
Acceptance criteria from epics.md CC-7.11:

1. Tab bar shows Today, Closet, Looks, Community and Profile in that order on web and native, one
   shared icon set, labels 12 px or larger in sentence case, active state not by color alone.
2. Each tab opens on its own content within the fold, no banner, explanation or setup progress
   first. Closet opens on the grid with Add as the one primary; populated shows four tiles at
   390 x 664, empty shows Add.
3. Capsules move to Looks. Silhouette and closet setup move to a More menu and Profile > Style.
4. Every sub-screen shows a top bar with back arrow and title. Overlays close with X, Escape,
   swipe down and system back and return focus to the opener. Browser back and the native back
   gesture restore the parent's scroll; a direct entry goes back to the parent tab.
5. Tests prove each tab's first content above the fold and a working back control on every named
   sub-screen.

## Pushback sent to the builder (P1 to P8)

- P1 History tracker storage (D11). Keep the URL stack in memory only, not `sessionStorage`.
  Chrome copies `sessionStorage` into a tab opened from a link without `noopener` and into a
  duplicated tab, so a stored stack can claim an entry below that the new tab's history does
  not have; `router.back()` then does nothing and the member is stuck. A stored stack also keeps
  garment ids of the previous member after sign-out on a shared device. In memory, a reload
  counts as a direct entry and back replaces to the parent tab, which AC4 allows. Test
  7.11-E2E-034 and 7.11-UNIT-012.
- P2 Overlay history entry (D13) must not trigger an app-router navigation: back closes the
  layer with no refetch of the parent's reads and no remount (scroll, typed text and focus
  stay). Push the entry with `window.history.pushState(window.history.state, '', location.href)`
  so Next keeps its tree state on that entry. A link inside a layer that navigates away must not
  leave the layer's entry dangling: after navigating from post detail to another route, one
  browser back returns to the parent with the layer closed. Tests 7.11-E2E-041 to 045.
- P3 Swipe down on web (D13). Listen to Pointer Events with `pointerType` touch or pen, not
  Touch Events only, so mouse drags never close a layer and the test can drive it with CDP
  `Input.dispatchTouchEvent` (Chromium emits both). Threshold 80 px measured from pointerdown;
  a horizontal drag or an upward one never closes; inside a scrolled body only when the body is
  at scrollTop 0. Tests 7.11-E2E-046 to 048.
- P4 Fold definition for AC2. "Above the fold" means the element's bottom edge is at or above
  the top of the bottom tab bar (664 - 56 = 608 px on web at 390 x 664); for the Closet four
  tiles, all four tiles fully inside that band. Native: builder counter accepted, the smallest supported phone from CC-7.9 D11,
  360 x 640 dp, band from below the 56 pt top bar to the tab bar top, through the CC-7.10 RNW
  harness. Recorded in the spec Plan Change Log.
- P5 Test hooks. Each tab's first own content needs one stable `data-testid` anchor (web and
  native, same id): `today-first-content` on the outfit card, `closet-garment-grid` (exists),
  `looks-first-content` on the saved looks list or the empty line, `community-first-content` on
  the first feed card or empty state, `profile-account` (exists). Sub-screen top bars keep
  `app-top-bar`, `app-top-bar-back`, `app-top-bar-title`. More menu: `closet-more-menu` (button),
  `closet-more-setup`, `closet-more-silhouette`. Style: `profile-style-row`, `style-row-silhouette`,
  `style-row-setup`, `style-row-palette`. Looks rows: `looks-capsules-row`, `looks-plan-row`.
  Layers: `layer-swipe-handle` on the draggable header.
- P6 Active state proof. The non-color cues must be measurable: active label weight 600 or more
  and inactive 400 or 500; the underline indicator present only on the active tab and visible
  under `forced-colors: active` (use a border or `CanvasText`-safe color, not only a background
  that forced colors removes). Test 7.11-E2E-004.
- P7 Native label floor (D3). `TabBarLabel` with `minimumFontScale` must still render 12 px or
  more: at fontScale 2 on a 360 dp width the computed font size is at least 12 and the label is
  two lines, not truncated (`numberOfLines` 2, no ellipsis). Test 7.11-NAT-004.
- P8 Sign-out clears in-app history (P1 in memory) and closes any open layer; guardian-pending
  teens reach every tab and every sub-screen (no redirect to consent). Tests 7.11-E2E-035,
  7.11-E2E-060.

## Risk assessment

| ID  | Risk                                                                                            | P   | I   | Score | Mitigation (tests)                        |
| --- | ----------------------------------------------------------------------------------------------- | --- | --- | ----- | ----------------------------------------- |
| R1  | Back arrow strands the member (no history, wrong parent, router.back no-op)                     | 3   | 3   | 9     | E2E-020..036 table, NAT-020..028, P1      |
| R2  | Overlay history entry desyncs the Next router: back reloads, refetches, or needs two presses    | 3   | 3   | 9     | E2E-041..045, P2                          |
| R3  | Web and native tab lists or icons drift apart                                                   | 2   | 3   | 6     | UNIT-001..004 (shared list), NAT-001..003 |
| R4  | Closet chrome returns above the grid (banner, explainer) and members scroll again               | 2   | 3   | 6     | E2E-010..013, budget closet-chrome at 160 |
| R5  | Focus lost on overlay close (keyboard and screen reader members)                                | 2   | 3   | 6     | E2E-040..048 focus asserts, NAT-030..034  |
| R6  | Removed Home planner drawer or Closet rows break existing journeys (capsules, plan, silhouette) | 3   | 2   | 6     | E2E-014..017, updated legacy specs        |
| R7  | Old labels pinned in specs fail en masse or pass vacuously after rename                         | 3   | 2   | 6     | legacy spec sweep, de-DE strings spec     |
| R8  | Swipe gesture closes on scroll or mouse drag (accidental dismiss, lost edits)                   | 2   | 2   | 4     | E2E-047, E2E-048, NAT-033                 |
| R9  | Native label clipped at large text, or shrinks below 12 px                                      | 2   | 2   | 4     | NAT-004, P7                               |
| R10 | Guardian-pending teen blocked from a tab or sub-screen                                          | 1   | 3   | 3     | E2E-060, NAT-040                          |
| R11 | Previous member's URLs (garment ids) kept in browser storage after sign-out                     | 1   | 3   | 3     | UNIT-012, E2E-035, P1                     |

## Test levels

| Level                   | File                                                                                                                       | Owner | Runs in                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------ |
| Unit, node              | `packages/utils/src/app-tabs.test.ts`                                                                                      | TEA   | utils vitest (coverage gate)   |
| Unit, web (jsdom)       | `apps/web/src/lib/app-history.test.ts`, `sticky-bottom-nav.test.tsx`, `app-top-bar.test.tsx`, `accessible-modal.test.tsx`  | TEA   | web vitest                     |
| E2E, web                | `playwright/tests/five-tab-navigation.spec.ts` (tabs, fold, More, Style, Looks)                                            | TEA   | pw-e2e smart shards            |
| E2E, web                | `playwright/tests/sub-screen-back.spec.ts` (every named sub-screen, in-app and direct entry, scroll)                       | TEA   | pw-e2e smart shards            |
| E2E, web                | `playwright/tests/overlay-close.spec.ts` (X, Escape, browser back, swipe, focus)                                           | TEA   | pw-e2e smart shards            |
| Component, native (RNW) | `apps/mobile/src/screens/five-tab-navigation.test.tsx`, `src/components/app-top-bar.routing.test.tsx` (extended)           | TEA   | mobile vitest browser coverage |
| Component, native (RNW) | `apps/mobile/components/edge-to-edge-modal.test.tsx`, `components/tab-bar-label.test.tsx` (extended)                       | TEA   | mobile vitest browser coverage |
| Screen budget (CC-7.10) | `screen-budget.spec.ts`, native `screen-budget-looks.test.tsx` (new), `screen-budget-closet.test.tsx` (known entries gone) | TEA   | as in 7.10                     |
| Device flow (nightly)   | `maestro/five-tab-navigation.yaml`, updated subflows; `native-tests/ShareCard*UITests.swift` label updates                 | TEA   | nightly / dispatch only        |

Native layout claims run in the CC-7.10 RNW Chromium harness (accepted risk 7.10-R8). Maestro is
nightly only (no macOS on PRs); PR proof for native is the RNW suite.

## Coverage plan

### Unit: shared tab definition and history (node, jsdom)

| ID            | Scenario                                                                                                                          | AC / D |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.11-UNIT-001 | `APP_TABS` ids in order today, closet, looks, community, profile; web hrefs `/`, `/wardrobe`, `/looks`, `/community`, `/settings` | 1, D1  |
| 7.11-UNIT-002 | Native routes `index`, `wardrobe`, `looks`, `community`, `settings`; label keys unique and present in en-US and de-DE             | 1, D15 |
| 7.11-UNIT-003 | Every tab has one icon path set, 24 x 24 viewBox, non-empty `d`, no fill colors baked in (follows label color)                    | 1, D2  |
| 7.11-UNIT-004 | Sub-screen parent map: every D10 sub-screen resolves to its parent tab (web path and native route)                                | 4, D10 |
| 7.11-UNIT-010 | History tracker: push on new URL, pop when the URL equals the entry below, replace keeps depth                                    | 4, D11 |
| 7.11-UNIT-011 | `canGoBack` false on first entry, true after one in-app push; same-URL overlay entries do not count as a page                     | 4, D11 |
| 7.11-UNIT-012 | Tracker writes nothing to `localStorage` or `sessionStorage`; `reset()` on sign-out empties it                                    | P1, P8 |
| 7.11-UNIT-013 | `resolveActiveNavTab`: `/looks/plan` -> looks, `/wardrobe/silhouette` -> closet, `/settings/style` -> profile, `/` exact          | 1      |
| 7.11-UNIT-020 | Web `AppTopBar` back: `canGoBack` calls `router.back()`; otherwise `router.replace(parentHref)`; never both                       | 4, D11 |
| 7.11-UNIT-021 | Web bottom nav renders five links in order, labels from catalog, svg icons `aria-hidden`, no emoji characters                     | 1, D2  |

### E2E web: tabs and fold (`five-tab-navigation.spec.ts`, 390 x 664 unless noted)

| ID           | Scenario                                                                                                                                                                                      | AC / D    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 7.11-E2E-001 | Bottom nav: five links in order Today, Closet, Looks, Community, Profile; each has an inline svg; no emoji in the nav text                                                                    | 1         |
| 7.11-E2E-002 | Labels: computed font-size >= 12 px, text equals sentence case (first letter upper, rest as catalog)                                                                                          | 1, D3     |
| 7.11-E2E-003 | Desktop (1280 wide): top tabs show the same five in the same order with the same icon paths                                                                                                   | 1, D1     |
| 7.11-E2E-004 | Active not by color alone: active has aria-current page, weight >= 600 vs inactive < 600, indicator visible; same under forced-colors active and grayscale filter                             | 1, P6     |
| 7.11-E2E-005 | Each tab, each fixture (empty, populated, guardian-pending): its first-content anchor bottom <= 608; no element with role banner/status/alert, explainer paragraph or setup progress above it | 2, P4, P5 |
| 7.11-E2E-010 | Closet populated: four `closet-garment-grid` tiles fully above 608; Add (`garment-capture-open`) is the only gold primary                                                                     | 2, D4     |
| 7.11-E2E-011 | Closet empty: empty-state Add visible above 608; no setup banner, no Capsules or Silhouette buttons above the grid                                                                            | 2, D4     |
| 7.11-E2E-012 | Closet: saved looks row renders below the grid                                                                                                                                                | D4        |
| 7.11-E2E-013 | Closet with onboarding not completed: no setup banner above the grid; More shows "Closet setup"; completed shows "Closet setup: done"                                                         | 2, 3, D5  |
| 7.11-E2E-014 | More menu: role menu with Closet setup and Silhouette; Escape closes, focus on More; outside click closes; each item navigates                                                                | 3, D5     |
| 7.11-E2E-015 | Profile > Style: Style row below the account header opens `/settings/style` with Silhouette, Closet setup, Color palette; each opens its screen                                               | 3, D7     |
| 7.11-E2E-016 | Looks populated: saved looks first, then Capsules and Plan rows; Looks empty: "Save a look to see it here" plus both rows                                                                     | 3, D8     |
| 7.11-E2E-017 | Home "Plan week" control navigates to `/looks/plan`; `/?planner=1` redirects to `/looks/plan`; no planner drawer on Home                                                                      | D9        |

### E2E web: sub-screen back (`sub-screen-back.spec.ts`)

One parameterised table over every D10 sub-screen. Each row runs two cases.

| ID           | Scenario                                                                                                                    | AC / D |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.11-E2E-020 | In-app entry from the parent: top bar has back arrow and the screen title (h1); back returns to the parent URL              | 4, 5   |
| 7.11-E2E-021 | Direct entry (cold `page.goto`): back arrow replaces to the parent tab; browser history length does not grow                | 4, 5   |
| 7.11-E2E-030 | Closet scrolled to 1,200 px, open garment detail, back arrow: Closet at the same offset (+-2 px), focus on the opening tile | 4, D14 |
| 7.11-E2E-031 | Same with browser back instead of the arrow                                                                                 | 4, D14 |
| 7.11-E2E-032 | Community scrolled, open post detail layer, browser back: layer closed, same offset, URL unchanged                          | 4, D12 |
| 7.11-E2E-033 | Two levels: Profile > Style > Palette, back, back: Style then Profile; arrow and browser back agree                         | 4, D11 |
| 7.11-E2E-034 | Reload on a sub-screen after in-app entry: back still lands on the parent (no stuck arrow)                                  | 4, P1  |
| 7.11-E2E-035 | Covered at unit level (UNIT-012: in-memory stack, `reset()` on sign-out); E2E-034 proves a fresh document has no stack      | P1, P8 |
| 7.11-E2E-036 | Notification settings parent is Profile (moved from Community)                                                              | D10    |

Rows: garment detail (Closet), saved look detail layer (Looks), post detail layer (Community),
Plan (Looks), capsules (Looks), setup (Closet), Silhouette (Closet), Style (Profile), palette
(Profile), notification settings (Profile), locations (Profile), guardian dashboard (Profile),
teen dashboard (Profile).

### E2E web: overlays (`overlay-close.spec.ts`)

| ID           | Scenario                                                                                                                                  | AC / D |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.11-E2E-040 | For each overlay (post detail, saved look, garment capture, tagging, capsule builder, share card, style piece): X closes, focus on opener | 4, D13 |
| 7.11-E2E-041 | Escape closes; only the top layer when stacked                                                                                            | 4, D13 |
| 7.11-E2E-042 | Browser back closes, URL unchanged, no new request to the parent's reads (interceptNetworkCall count), window marker survives (no reload) | 4, P2  |
| 7.11-E2E-043 | Close by X then browser back: leaves the page to the previous route (the entry was consumed, history did not grow)                        | D13    |
| 7.11-E2E-044 | Stacked layers: back closes the top one only, second back closes the next (web unit `accessible-modal.stack.test.tsx`)                    | D13    |
| 7.11-E2E-045 | Dropped 2026-11-26: no layer holds a link that navigates away (builder). Re-add if one appears                                            | P2     |
| 7.11-E2E-046 | Touch drag header down 100 px closes, focus on opener (CDP touch)                                                                         | 4, P3  |
| 7.11-E2E-047 | Touch drag down 60 px, horizontal 120 px, or upward does not close                                                                        | P3     |
| 7.11-E2E-048 | Body scrolled down: drag down inside the body scrolls, does not close; mouse drag never closes                                            | P3     |

### Native (RNW Chromium harness)

| ID           | Scenario                                                                                                             | AC / D |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.11-NAT-001 | Tab layout renders five tabs in order with `tab-{home,wardrobe,looks,community,settings}` and labels from `tabs.*`   | 1, D1  |
| 7.11-NAT-002 | Each tab icon is the shared path set (react-native-svg Path `d` equals `@couture/utils` tab-icons); no FontAwesome   | 1, D2  |
| 7.11-NAT-003 | Active tab: selected state, heavier weight, indicator present only on the active tab                                 | 1, D3  |
| 7.11-NAT-004 | Label at fontScale 1 and 2, 360 dp: rendered size >= 12, two lines allowed, no ellipsis                              | 1, P7  |
| 7.11-NAT-010 | Each tab at 360 x 640, three fixtures: first-content anchor above the tab bar, nothing banner-like above it          | 2, P4  |
| 7.11-NAT-011 | Closet populated: four tiles above the tab bar; empty: Add visible; Add the only primary; More in the top bar        | 2, D4  |
| 7.11-NAT-012 | More sheet: Closet setup and Silhouette rows, X closes, focus back on More                                           | 3, D5  |
| 7.11-NAT-013 | Profile Style row opens `settings-style` with Silhouette, Closet setup, Color palette                                | 3, D7  |
| 7.11-NAT-014 | Looks: saved looks list then Capsules and Plan rows; empty line                                                      | 3, D8  |
| 7.11-NAT-020 | `PARENT_TAB` covers every D10 native route; cold entry back replaces to it                                           | 4, D10 |
| 7.11-NAT-021 | `renderStackTopBar` on each named route: back arrow and title present (guardian and teen dashboards titled)          | 4, 5   |
| 7.11-NAT-022 | In-stack back calls `router.back()`; Android hardware back and iOS gesture use the same path (`tabsAnchorListeners`) | 4      |
| 7.11-NAT-023 | Closet scrolled, push garment detail, back: Closet list offset unchanged (tab stays mounted)                         | 4, D14 |
| 7.11-NAT-030 | `EdgeToEdgeModal` without `onRequestClose` fails type check (ts-expect-error test) and Android back calls it         | 4, D13 |
| 7.11-NAT-031 | X closes; `returnFocusRef` receives accessibility focus after close                                                  | 4, D13 |
| 7.11-NAT-032 | Header swipe down past threshold closes; focus to opener                                                             | 4, D13 |
| 7.11-NAT-033 | Short or upward swipe does not close                                                                                 | P3     |
| 7.11-NAT-034 | Every `EdgeToEdgeModal` caller passes `returnFocusRef` (source scan test, like the 7.9 token guard)                  | D13    |
| 7.11-NAT-040 | Guardian-pending fixture: every tab and the Style sub-screen open                                                    | P8     |

### Guardian-pending and screen budget

| ID           | Scenario                                                                                           | AC / D |
| ------------ | -------------------------------------------------------------------------------------------------- | ------ |
| 7.11-E2E-060 | Guardian-pending teen: every tab and every sub-screen in the back table opens with its top bar     | P8     |
| 7.11-BUD-001 | Budget `screens` includes looks on both platforms with three fixtures; measured, not skipped       | D8     |
| 7.11-BUD-002 | No `closet-chrome` known entry remains; Closet chrome measured at or under 160 px in every fixture | D4     |

## Legacy specs and tests to update (TEA)

Per the spec Code Map: `playwright/support/helpers/app-shell.ts:28-31` (`SHELL_TABS`),
`app-shell-visual-system`, `signed-in-shell-layout-shift`, `chip-navigation-bottom-nav`,
`moderation-sla:611-614`, `commerce-affiliate-preferences:225`, `app-shell-de-de-strings`,
`accessibility-hardening:440`, every `h1 Wardrobe` check, `mobile-viewport-overflow:143-177`,
`wardrobe-signed-out`, specs opening the Home planner drawer or `/?planner=1`, specs clicking the
Closet Capsules or Silhouette buttons or the onboarding banner; web unit `sticky-bottom-nav`,
`app-top-bar`, `page.garment-detail`; native `localization`, `profile-tab`,
`app-top-bar.routing`, `screen-budget-closet`, wardrobe hub tests; Maestro `subflows/*`,
`shell-visual-tabs.yaml`, `chip-navigation-bottom-nav.yaml`; iOS `native-tests/ShareCard*UITests.swift`.

Rule for updates: a label or selector change is a rename; a removed assertion needs the new
behaviour asserted in its place in the same test, so nothing loosens silently.

## Quality gates

- Every new spec runs `--repeat-each=3` in a burn-in dispatch before the PR leaves draft review;
  zero flakes.
- No `waitForTimeout`; waits are web-first assertions or `recurse`. Network observed with
  `interceptNetworkCall` (playwright-utils mandate). Specs import `test` from merged fixtures.
- Every new test has a failing control: E2E-004 runs on an inactive tab too; E2E-042 asserts the
  parent read count, not only that the layer closed.
- CI: every workflow green on the head SHA (`gh pr checks`).
