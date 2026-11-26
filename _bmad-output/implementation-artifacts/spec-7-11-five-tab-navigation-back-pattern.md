---
title: 'Story CC-7.11: Five-tab navigation and back pattern'
type: feature
ticket: '7-11-five-tab-navigation-back-pattern'
created: '2026-11-26'
status: in-review
baseline_revision: '4e5702c3c130899d9c4a9b1548d6e911dc49744a'
route: full
route_source: auto
risk: high
review: quick
review_source: pinned
lenses_ran: ['codex']
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/reviews/epic-7-ux-review.md'
  - '_bmad-output/implementation-artifacts/spec-7-9-one-app-shell-visual-system.md'
  - '_bmad-output/implementation-artifacts/spec-7-10-screen-budget-guard.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Members scroll to find their clothes. Web and native have four tabs (Home,
Wardrobe, Community, Profile); web draws them with emoji and native with FontAwesome. Above the
Closet grid sit a Capsules / Silhouette / Add row, a setup banner, the saved looks row and an
explainer, so the first garment starts 390 to 476 px down on web and 334 px on native (the
CC-7.10 `closet-chrome` ratchet, owned by this story). Capsules, Planner and saved looks have no
home. Sub-screens disagree on back: web back is a fixed link, saved look and post detail are
modals with an X, the web planner is a drawer on Home, Silhouette is a modal on Closet, and web
overlays ignore browser back and swipe.

**Approach:** Five tabs, Today, Closet, Looks, Community, Profile, on both platforms from one
tab definition and one SVG icon set in `@couture/utils`. Closet opens on its grid with Add and a
More menu in its top bar. A new Looks tab holds saved looks, Capsules and Plan. Profile gains a
Style row whose sub-screen holds Silhouette, closet setup and the color palette. Every screen
below a tab gets the 56 px top bar with a back arrow and title; back follows in-app history and
falls back to the parent tab on direct entry. Overlays close with X, Escape, swipe down and
system back and return focus to their opener.

## Decisions (owner delegated; recorded here)

- D1 Tabs. Order Today, Closet, Looks, Community, Profile. Routes and existing test ids stay
  (web `/`, `/wardrobe`, `/community`, `/settings`, `bottom-nav-{home,wardrobe,community,
settings}`, `nav-{ritual,wardrobe,community,profile}`; native `index`, `wardrobe`,
  `community`, `settings`, `tab-{home,wardrobe,community,settings}`), per the UX review rule 5.
  Looks is new: web `/looks`, `bottom-nav-looks`, `nav-looks`; native `app/(tabs)/looks.tsx`,
  `tab-looks`. Labels and titles read Today, Closet, Looks, Community, Profile from new catalog
  keys (web `nav.today|closet|looks`, native `tabs.today|closet|looks`) in all 10 locales on
  both apps; the old `nav.home|wardrobe` and `tabs.home|wardrobe` keys are deleted where unused.
- D2 One tab definition and icon set. `packages/utils/src/app-tabs.ts` exports the ordered tab
  list (id, web href, native route, label key) and `packages/utils/src/tab-icons.ts` one 24 x 24
  outline SVG path set (today: sun, closet: hanger, looks: layered cards, community: two people,
  profile: person). Web draws them as inline `<svg>`, native through `react-native-svg` (already
  a dependency). Emoji and FontAwesome leave the tab bars. Icon color follows the label color.
- D3 Labels and active state. Labels 12 px or larger, sentence case, on web and native at every
  text size: native `TabBarLabel` may shrink a label to fit but never below 12 rendered px; a
  label that still does not fit wraps to two lines. The active tab keeps three cues: gold
  (`tabActive`), heavier label weight and the underline indicator (`gold-active-indicator` on
  web, `tab-<id>-active-indicator` on native), plus `aria-current="page"` on web and the
  selected state on native.
- D4 Closet opens on its grid (AC2). Web and native Closet top bars carry Add
  (`garment-capture-open`, the one gold primary) and a neutral More button (`closet-more-menu`)
  in the trailing slot. Removed from above the grid: the Capsules / Silhouette / Add action row,
  the setup banner or card, the in-body Closet heading and explainer, and the native header
  description. The saved looks row moves below the grid until CC-7.12 deletes it. Account
  notices and load errors stay where they are, since they render only on a problem. Populated:
  four tiles visible at 390 x 664; empty: the empty-state block with its Add visible. The
  CC-7.10 `closet-chrome` known entries are deleted, so the guard now holds Closet to 160 px.
- D5 More menu (AC3). Items: Closet setup (opens `/wardrobe/onboarding` or native
  `wardrobe-onboarding`; reads "Closet setup: done" once completed) and Silhouette. Web: a
  `menu` popover anchored to the More button, Escape and outside click close it and focus
  returns to More. Native: a bottom sheet (`EdgeToEdgeModal`) with the same two rows and an X.
- D6 Silhouette as a route. Web adds `/wardrobe/silhouette` (top bar with back, parent Closet)
  rendering the existing `SilhouetteSettingsPanel`; the modal on `/wardrobe` is removed. Native
  already has `wardrobe-silhouette`.
- D7 Profile > Style (AC3). Profile gets one Style row (`profile-style-row`) below the account
  header on web and native. It opens web `/settings/style` and native `settings-style`, a
  sub-screen with three rows: Silhouette, Closet setup and Color palette (web `/palette`, native
  `palette-advisor`). The rest of Profile's layout is CC-7.16's.
- D8 Looks tab (AC3). It opens on saved looks (the existing saved looks list component, moved
  out of the Closet header), then a Capsules row (to the capsules screen) and a Plan row (to
  Plan). Empty: one line "Save a look to see it here" plus the two rows. Segments, filters,
  Ideas and the `/wardrobe/capsules` redirect are CC-7.12. Looks joins the CC-7.10 budget
  (`screens` gains `looks`, audited on both platforms with the three fixtures).
- D9 Plan as a route. Web adds `/looks/plan` rendering `PlannerRail` with `variant="rail"`
  under a top bar with back (parent Looks); the Home drawer is removed, the Home "Plan week"
  controls link to `/looks/plan` and `/?planner=1` redirects there. Native `planner` keeps its
  route; its parent becomes Looks.
- D10 Sub-screens (AC4). Top bar with back arrow and title on: garment detail, saved look
  detail, post detail, Plan, capsules, setup (onboarding), Silhouette, Style, palette,
  notification settings, locations, guardian and teen dashboards. Direct-entry parent tab:
  Closet for garment, setup, Silhouette; Looks for capsules, Plan, saved look; Community for
  post detail; Profile for Style, palette, notification settings, locations, guardian and teen
  dashboards (web notification settings moves from Community to Profile). Native guardian and
  teen dashboards get titles.
- D11 Back behaviour. Web: `AppTopBar` back calls `router.back()` when the app has an in-app
  history entry below the current one, otherwise `router.replace(parentTab)`. In-app history
  is a session-scoped URL stack kept by one tracker in the root layout (push on a new URL, pop
  when the URL equals the entry below). Native keeps `renderStackTopBar` plus
  `tabsAnchorListeners` and adds the new routes to `PARENT_TAB`.
- D12 Saved look and post detail are full-height layers, not routes (deep links to a saved look
  are CC-7.12). Their header is the top bar with back and the look or post title, in place of
  the X. They close like an overlay (D13).
- D13 Overlays (AC4). Web `AccessibleModal`: on open it pushes one same-URL history entry;
  browser or system back closes the top layer, and closing by X, Escape, swipe or back arrow
  consumes that entry, so history does not grow. A downward touch drag of 80 px or more that
  starts in the header, or anywhere while the panel is scrolled to the top, closes it. Focus
  returns to the opener (existing). Native `EdgeToEdgeModal`: requires `onRequestClose`
  (Android back), adds a swipe-down close on its header area, and takes a `returnFocusRef` that
  gets accessibility focus after close; every caller passes its opener.
- D14 Scroll restore. Web tabs keep the CC-7.7 `ScreenGate` per-tab offset, which also serves a
  return from a sub-screen; a direct entry starts at the top. Native stack and overlay screens
  sit over the mounted tab, so its scroll stays. Tests prove both.
- D15 Strings. Every new member-facing string comes from the catalogs in all 10 web and 10
  mobile locales; existing locale parity specs cover the new keys.

## Boundaries & Constraints

**Always:** web and native ship together; existing routes and test ids stay; one primary
button per screen; CC-7.7 shift budget, CC-7.9 token guard and CC-7.10 screen budget stay green;
44 px targets; reduced motion; guardian-pending teens get every tab.

**Never:** Looks segments, filters, Ideas, the capsules redirect, saved-look deep links or
removing the Closet saved looks row (CC-7.12); Today content changes beyond the Plan links
(CC-7.13); Community calm-down (CC-7.15); Closet chip row, badges, setup row after the grid,
Profile rows other than Style (CC-7.16); copy rewrites (CC-7.17); local unit, Playwright or
native suites; macOS jobs on PRs.

## I/O & Edge-Case Matrix

| Scenario            | Input / State                           | Expected                                               |
| ------------------- | --------------------------------------- | ------------------------------------------------------ |
| Tab bar             | any signed-in member, web or native     | Today, Closet, Looks, Community, Profile; shared icons |
| Active tab          | Closet open, forced colors or grayscale | weight, underline and aria-current still mark it       |
| Large text          | native 200% text, 360 dp wide           | labels at least 12 px, wrapped not clipped             |
| Closet populated    | 6 garments, 390 x 664                   | four tiles visible; Add the only primary               |
| Closet empty        | 0 garments                              | empty-state Add visible above the fold                 |
| More menu           | tap More, then Escape                   | Setup and Silhouette listed; focus back on More        |
| Looks empty         | no saved looks                          | one line, Capsules and Plan rows                       |
| Sub-screen back     | Closet scrolled, open garment, back     | Closet at the same scroll offset                       |
| Direct entry        | cold load of `/wardrobe/capsules`       | back arrow replaces to `/looks`                        |
| Overlay system back | post detail open, browser back          | layer closes, URL unchanged, focus on the opening card |
| Swipe down          | sheet open, drag header down 100 px     | closes, focus on opener                                |
| Planner deep link   | `/?planner=1`                           | redirect to `/looks/plan`                              |
| Guardian-pending    | teen with pending guardian              | every tab and sub-screen opens; capture shows pending  |

</frozen-after-approval>

## Code Map

Web (`apps/web/src/app`):

- `components/sticky-bottom-nav.tsx:12,28-51,75-90,141-164` -- `NavTabId`, `NAV_TABS` (emoji),
  `resolveActiveNavTab`, active indicator; read the list from `@couture/utils` app-tabs and draw
  `tab-icons`.
- `components/app-top-bar.tsx:13-28,30-59,86-101` -- props `title|titleKey|backHref|onBack|
trailing`, `DESKTOP_TABS` (second list, same change), back link; add `parentHref` and the
  history-aware back (D11).
- `layout.tsx` -- mount the in-app history tracker (new `lib/app-history.ts`).
- `wardrobe/page.tsx:1230-1371` -- top bar, `wardrobe-actions` row (:1239-1265),
  `ClosetAccountNotices` (:1287), onboarding banner (:1289-1297), `ClosetSavedLooksRow` (:1299),
  heading and body (:1325-1337), grid (:1371); silhouette modal (:1507-1523) and button ref
  (:807); `ADD_GARMENT_CLASS` (:334-368).
- `wardrobe/saved-looks-row.tsx:661` -- saved look modal (D12); list reused by `/looks`.
- `wardrobe/capsules/page.tsx:98` -- back parent becomes `/looks`.
- `components/wardrobe-onboarding-flow.tsx:547` -- back parent Closet (history-aware).
- `components/lookbook-prism-layout.tsx:80-200,385-455` -- planner slots, `?planner=1` effect,
  "Plan week" controls (D9).
- `components/planner-rail.tsx:63` -- `PlannerRailProps`, `variant="rail"`.
- `components/community-lookbook-grid.tsx:1187` -- post detail modal (D12).
- `components/accessible-modal.tsx`, `components/modal-stack.ts:53,84` -- Escape and focus
  return exist; add history entry, swipe and the `screen` presentation (D12, D13).
- `settings/page.tsx` -- Style row; new `settings/style/page.tsx`; `palette/page.tsx:39-41` and
  `notification-settings/page.tsx:185` back parents.
- New pages: `looks/page.tsx`, `looks/plan/page.tsx`, `wardrobe/silhouette/page.tsx`,
  `settings/style/page.tsx`; each with `AppPage`, `AppTopBar`, `StickyBottomNav`, `ScreenGate`
  where it reads data.
- Catalogs `apps/web/src/i18n/locales/*.json` (`nav.*` at en-US :1543-1551, `shell.back` :1597).

Native (`apps/mobile`):

- `app/(tabs)/_layout.tsx` -- five `Tabs.Screen`, shared icons, labels from `tabs.*`; drop the
  hidden `two` only if nothing routes to it.
- `components/tab-bar-label.tsx:35,90-95,236` -- 12 px floor (D3).
- `src/components/app-top-bar.tsx:26,146,154-165,189-206,231-246` -- `AppTopBar`,
  `renderTabTopBar` (trailing for Closet), `PARENT_TAB`, `tabsAnchorListeners`,
  `renderStackTopBar`.
- `app/_layout.tsx:295-370` -- register `settings-style`, titles for guardian and teen
  dashboards.
- `src/features/wardrobe/wardrobe-hub-screen.tsx:690-760,844` -- header row, onboarding card,
  saved looks row, grid.
- `src/features/wardrobe/saved-looks-row.tsx:676-683`, `components/community/
community-post-sheet.tsx:626`, `community-spotlight-detail.tsx:54-57` -- layers (D12, D13).
- `components/edge-to-edge-modal.tsx:211-260` and its callers -- swipe down, `returnFocusRef`.
- `app/(tabs)/settings.tsx` -- Style row; new `app/settings-style.tsx`, `app/(tabs)/looks.tsx`.
- Catalogs `assets/locales/*.json` (`tabs` at en-US :2-9).

Shared and checks:

- `packages/utils/src/app-tabs.ts`, `tab-icons.ts` (new), exported from the index.
- `packages/utils/src/screen-budget.json` -- delete the `closet-chrome` known entries, add
  `looks` to `screens` with its anchors (D4, D8).
- Tests that pin the old labels or the removed Closet row (TEA): `playwright/support/helpers/
app-shell.ts:28-31`, `app-shell-visual-system.spec.ts`, `signed-in-shell-layout-shift.spec.ts`,
  `chip-navigation-bottom-nav.spec.ts`, `moderation-sla.spec.ts:611-614`,
  `commerce-affiliate-preferences.spec.ts:225`, `app-shell-de-de-strings.spec.ts`,
  `accessibility-hardening.spec.ts:440`, the `h1 Wardrobe` checks, `mobile-viewport-overflow.
spec.ts:143-177`, `wardrobe-signed-out.spec.ts`; web unit `sticky-bottom-nav.test.tsx`,
  `app-top-bar.test.tsx`; native `localization.test.tsx`, `profile-tab.test.tsx`,
  `app-top-bar.routing.test.tsx`, `screen-budget-closet.test.tsx`; Maestro `maestro/subflows/*`,
  `shell-visual-tabs.yaml`, `chip-navigation-bottom-nav.yaml`; iOS UI tests
  `native-tests/ShareCard*UITests.swift`.

## Tasks & Acceptance

**Execution:**

- [x] Shared tab list and icon set in `@couture/utils` -- D1, D2.
- [x] Web tab bar, desktop tabs, history tracker and history-aware back -- D1 to D3, D11.
- [x] Native tab bar, label floor, Looks tab, parents and titles -- D1 to D3, D10, D11.
- [x] Closet top bar with Add and More, menu, removed rows, saved looks below grid (web, native)
      -- D4, D5.
- [x] Web Silhouette route; Style row and Style sub-screen (web, native) -- D6, D7.
- [x] Looks tab (web, native) and web Plan route with the Home planner links -- D8, D9.
- [x] Back parents and titles on every sub-screen -- D10.
- [x] Overlay history entry, swipe down, layer presentation and focus return (web, native) --
      D12, D13.
- [x] Catalog keys in 10 + 10 locales -- D15.
- [x] Screen budget: delete closet-chrome known entries, add Looks -- D4, D8.
- [ ] Tests (TEA, per the test design) -- AC5.
- [ ] Learning path Step 68; sprint-status 7-11 done before the final push.

**Acceptance Criteria:**

- Given a signed-in member on web or native, when any tab is open, then the bar shows Today,
  Closet, Looks, Community and Profile in that order with the shared icons, labels of 12 px or
  more in sentence case, and the active tab marked by weight, underline and state, not color
  alone.
- Given each tab at 390 x 664 (web) or the smallest native phone, when it opens, then its first
  own content is above the fold with no banner, explanation or setup progress before it; a
  populated Closet shows four garment tiles and an empty one shows Add, the one primary.
- Given Closet, when the member opens More, then Closet setup and Silhouette are listed; given
  Profile, when the member opens Style, then Silhouette, Closet setup and Color palette are
  listed; given Looks, then saved looks, Capsules and Plan are listed.
- Given any named sub-screen, then it shows a top bar with a back arrow and a title; back
  returns to the parent at its scroll offset; a direct entry's back goes to the parent tab.
- Given any overlay, when the member presses X, Escape, swipes down or uses system or browser
  back, then it closes and focus returns to its opener.

## Implementation Notes

- Shared worktree with TEA: no git stash, git checkout -- or git reset; announce before
  git add and wait for an ack; no mutants in the tree. CI is the proof: tsc per touched
  workspace and eslint on touched files only, no local suites.
- Builder scope: product code, catalogs, `screen-budget.json` selectors and screens, docs. TEA
  owns every test file (new and updated, including Maestro and the iOS UI tests) and the
  test design; load bmad-tea before touching a test.
- Rebuild `@couture/utils` dist after adding the new modules before trusting app tsc.
- Do not commit; the builder commits after TEA acks. Work the tasks in order and tick each one
  here as it lands; if context runs low, stop at a task boundary and report what remains.
- npm pre-hooks rebuild shared dist; use `npm exec` for tsc during the work.

## Plan Change Log

- 2026-11-26, TEA pushback P1-P8 (test-design-7-11-five-tab-navigation-back-pattern.md),
  accepted except the native viewport in P4; these amend D3, D4, D11 and D13:
  - P1 (D11): the in-app URL stack lives in memory only, never `sessionStorage`; a reload is a
    direct entry and back replaces to the parent tab.
  - P2 (D13): the layer's entry is `history.pushState(history.state, '', location.href)`; back
    closes the layer with no router navigation, refetch or remount. A link inside a layer that
    navigates away replaces the layer's entry, so one browser back returns to the parent with
    the layer closed.
  - P3 (D13): web swipe uses Pointer Events with `pointerType` touch or pen, 80 px down from
    pointerdown; horizontal or upward drags never close; in a scrolled body only at scrollTop 0.
  - P4 (D4): above the fold means the element's bottom edge is at or above the top of the tab
    bar (608 px at 390 x 664 on web); the four Closet tiles must all sit inside that band.
    Countered for native: the smallest supported phone stays 360 x 640 dp (CC-7.9 D11), with
    the band ending at the tab bar top below the 56 pt top bar.
  - P5: test ids `today-first-content`, `looks-first-content`, `community-first-content`
    (first feed card or the empty state), `closet-more-menu`, `closet-more-setup`,
    `closet-more-silhouette`, `profile-style-row`, `style-row-silhouette`, `style-row-setup`,
    `style-row-palette`, `looks-capsules-row`, `looks-plan-row`, `layer-swipe-handle`, plus the
    existing `closet-garment-grid`, `profile-account`, `app-top-bar`, `app-top-bar-back`,
    `app-top-bar-title`, on web and native with the same ids.
  - P6 (D3): active label weight 600 or more, inactive 400 or 500; the indicator renders only on
    the active tab and stays visible under `forced-colors: active` (border or `CanvasText`).
  - P7 (D3): native labels at fontScale 2 on 360 dp render 12 px or more, `numberOfLines` 2, no
    ellipsis.
  - P8 (D11, D13): sign-out clears the in-app stack and closes any open layer.

- 2026-11-26, builder and TEA test contract: titles Closet setup, Silhouette, Outfit capsules
  (unchanged), Plan, Style, Color palette. Web More is a button with `aria-expanded` opening
  `role=menu` with two `menuitem`s; the setup item reads exactly "Closet setup: done" once
  completed. Looks empty text is exactly "Save a look to see it here"; its gate reads only
  `wardrobe/saved-looks`; signed out it opens at once with the empty line and both rows.
  `planner-open-control` is a link to `/looks/plan`. Layers are `role=dialog` with
  `app-top-bar-back`, `layer-swipe-handle` on the header and `layer-body` on the scroll
  container; garment capture keeps its X and gains `layer-swipe-handle`. The empty Closet block
  has no second gold Add. Native adds `closet-more-close` (sheet X) and `closet-garment-grid` on
  the Closet list beside `wardrobe-garment-list`; each tab button reports selected.

- 2026-11-26, builder, as built:
  - D11 (review #1): entry identity, not URL equality. The `pushState` and `replaceState`
    wrappers in `lib/app-history.ts` stamp each entry's position (`__ccIdx`) into its state: a
    push stamps the next position, a replace keeps the replaced entry's, a popstate reads the
    landed one. Back stays in the app while the position is above this document's first one;
    sign-out moves the first position up. The tracker component only loads the module.
  - D13 (review #7): layer entries carry `__ccLayer` beside the position. A popstate closes the
    live layers whose entries sit above the landed position; landing on the entry of a layer that
    already closed (Forward) steps back over it. A layer steps back over its entry on close only
    while that entry is on top at the same address. Pushes wait for this module's back steps to
    land, and a layer that refuses a back close gets its entry again. Every `AccessibleModal`
    header carries `layer-swipe-handle` and its scroll container `layer-body`; at scroll top
    the scroll container pans `pan-x pan-down` only, so a downward drag is not taken by the
    browser (review #6).
  - D9: `/?planner=1` redirects in `next.config.ts` (server side); the Plan screen drops the
    passed-through `planner` query with a router replace. `SET_CITY_FROM_PLANNER` returns to `/looks/plan`.
    The 320 px desktop rail column on Home left with the drawer.
  - D4: the top bar Add reads "+ Add" (`wardrobe.menu.add`) with the full add-garment label as
    its accessible name, so long locales keep the Closet title.
  - D10: the web tab bar marks Looks on `/wardrobe/capsules` and Profile on `/palette`,
    `/notification-settings` and the guardian and teen dashboards. Titles: onboarding reads
    Closet setup, palette Color palette, Plan Plan (web and native).
  - D8: `ScreenName` gains `looks` (snapshot cap 5) and the Looks list is snapshotted, so a
    return opens on its last list. Web Looks reopens a saved look in its detail layer (it reads
    no closet); native reopens Style this piece looks in the editor.
  - Review round (7.11-codex-review.md, TEA unit sweep): Closet tiles have square photos with
    the name and status on one row and the actions on the next, gap 12, so two rows of tagged
    tiles end at about 598 px of the 608 px web fold; the Closet gate waits on the closet and
    saved looks reads only, and the account and setup notices sit below the closet. Desktop
    links show the tab icon, the label from 1024 px. Profile gains a Notifications row
    (`profile-notifications-row`); Locations stays inline for CC-7.16. Leaving Silhouette lets
    a started save or removal finish. Looks snapshots every loaded page and reads them all back
    on a return. More's name is "More closet options" (`wardrobe.menu.moreLabel`), and an
    outside click on plain chrome returns focus to More. Capsules shows the tab bar.
  - Screen budget: `selectors.<platform>.looksAnchors`; the native empty Closet anchor is
    `wardrobe-empty-state`, since Add moved into the top bar outside `wardrobe-screen`.

- 2026-11-26, builder, D16 (owner delegated, AC2 on native at 360 x 640 dp): a tab's first own
  content is the block that carries its job. Native Today opens on the weather header and the
  outfit card; the hourly ribbon, scenario toggles, the add-first-piece prompt, the weather
  alert and the Plan link move below the card (no section removed; CC-7.13 calms the rest).
  Community's first own content is the City Spotlight when it shows looks, else the first feed
  card or the empty state, on web and native (`community-first-content` follows it); the New
  post row and filter chips stay above as Community's controls, and info, error, band and
  challenge notices move after the first content (their removal is CC-7.15). The web top bar
  stays non-sticky (D14): returning to a Closet scrolled before opening More lands where the
  member was when they tapped More.

## Review Triage Log

- 2026-11-26, Codex review (7.11-codex-review.md, 16 findings through 58937e72), verdicts:
  - #1 high, patch: URL equality treats a repeat visit as a back step, and a replace with
    Next's own state can leave the replace flag set. Entries now carry an index stamped by the
    pushState and replaceState wrappers; the stack is index to URL.
  - #2 high, patch: two rows of tagged tiles exceed the 608 px web fold and the native band at
    360 x 640 dp; tiles tightened.
  - #3 high, patch: eight native overlays mounted no swipe handle; each header wired through
    its guarded close.
  - #4 medium, patch: desktop tab links lacked the shared icons.
  - #5 high, TEA: Looks visual baselines and refreshed tab captures from CI.
  - #6 medium, patch: a body drag at scrollTop 0 lost to browser panning; the downward gesture
    is reserved at the top.
  - #7 medium, patch: Forward onto a closed layer's entry left a dead Back, and any popstate
    closed the top layer; layer entries are matched by index.
  - #8 medium, patch: native focus returned to the top-bar Add or nowhere; each open records
    its real opener.
  - #9 medium, patch in part: web Profile gains a Notifications row. Web Locations stays inline:
    its sub-screen is CC-7.16 (Profile rows open sub-screens), so it is not deferred work here.
  - #10 medium, patch: native regular feed cards had no detail; they open the titled layer.
  - #11 medium, patch: leaving the Silhouette route aborted an in-flight save; started saves
    finish and pending edits flush.
  - #12 low, patch: Looks restored scroll past page one; every loaded page is kept.
  - #13, #15, #16 TEA: stale Maestro selectors, AC5 proof depth, keyboard and account-switch
    assertions.
  - #14 low, patch: an outside click dropped focus to the body; it returns to More.
  - Codex Security: no findings, partial coverage (25 runtime files reviewed by changed area).
- 2026-11-26, TEA unit sweep gaps, all patch: More's accessible name contains "More"; the
  unreachable Plan `onClose` is removed; the Looks load-more read takes an owner and abort
  signal; the onboarding read leaves the Closet gate; capsules renders the tab bar; post
  detail drops the unused close label; back records a replace of the current entry.

## Design Notes

One tab definition removes the second hand-kept list in `app-top-bar.tsx` and the native layout,
so a sixth tab or a rename touches one file. The history tracker is a URL stack, not
`history.state` keys, because the Next app router owns `history.state`. Saved look and post
detail stay layers since their data lives on the parent screen; making them routes waits for
CC-7.12's deep links.

## Verification

**Commands:**

- `npm run build -w packages/utils`, then `npm exec -w packages/utils -- tsc --noEmit`,
  `npm exec -w apps/web -- tsc --noEmit`, `npm exec -w apps/mobile -- tsc --noEmit`,
  `npx tsc -p playwright/tsconfig.json --noEmit` -- no errors.
- `npx eslint <touched files>` -- clean.
- `node --test scripts/check-screen-budget-decisions.test.mjs` -- passes.
- CI: every workflow green for the head SHA.
