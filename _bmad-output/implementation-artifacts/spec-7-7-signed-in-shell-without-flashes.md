---
title: 'Story CC-7.7: Signed-in shell without flashes'
type: feature
ticket: '7-7-signed-in-shell-without-flashes'
created: '2026-11-25'
status: in-review
baseline_revision: '11c26918aff1b599c824f39ac2a0945d38abe6fe'
route: full
route_source: auto
risk: high
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/spec-7-6-garment-delete.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** A signed-in member on a phone sees signed-out or sample content first and then
watches the screen jump: web Home measured a cold-load shift score of 0.574 (signed-out sample
outfit swapped for the member's, City Spotlight 0.47, Latest looks 0.10); the Closet setup banner
pops in above the grid; the Community Spotlight skeleton collapses and pulls the feed up. Every
web tab remount starts from nothing, so a tab switch reloads, resets scroll and shifts again.
Native shows skeletons plus the member sample outfit while the session restores and inserts
banners above the hero after load.

**Approach:** Each signed-in tab renders its fixed shell (header, bottom tab bar) at once and a
neutral placeholder in place of its body until the body's first reads settle, then reveals the
body as one unit. Sections that load later appear only at the end of the screen or below the
fold. A per-member, memory-only snapshot of each tab's last content and scroll position makes a
tab return instant, and the reads then refresh in place. A Chromium layout-shift check in the PR
gate keeps the budget at 0.1.

## Decisions (owner delegated; recorded here)

- D1 Session placeholder. Web reuses `<html data-session>` (set before first paint by
  `landing-session.ts`). Under `pending` and `member`, each tab body shows the placeholder
  (`data-testid="screen-placeholder"`, `aria-busy="true"`, one visually hidden "Loading" label,
  a plain surface block, no text, no sample, no skeleton cards); under `none` the signed-out
  page renders as today. Native renders the tabs shell during `restoring` with the same
  placeholder as each tab body. The splash screen does not wait for the session.
- D2 Members never see the demo outfit, the guest preview card or the member sample outfit
  before their own content. The member sample outfit appears only after the ritual read settles
  without a usable outfit (the 6.x first-use recovery behavior stays).
- D3 Screen gate. One gate per tab body, web and native: children mount at once (so their reads
  start) but stay hidden (`hidden` attribute on web, not rendered for layout on native) until the
  gate's reads settle (success, empty, or error). Gate reads: Home = ritual (native: ritual and
  weather); Closet = inventory and onboarding state; Community = first feed page and Spotlight;
  Profile = the commerce preferences, subscription and theme reads (amended 2026-11-25 after the
  D8 prod baseline: those sections land at about 416 ms and shift Profile by 0.49). A signed-out
  session opens every gate at once; any signed-out section that still lands late reserves its
  space or renders below the fold, so signed-out Closet and Profile also stay at 0.1 or less
  (prod baseline: Closet 0.1157, Profile 0.51).
- D4 Late sections. Anything above the last section of a screen that resolves after the gate
  opened (Home Spotlight teaser, Community new-looks pill, native weather alert and stale
  banners, native Scenario toggles, native HomeAddGarment) either joins the gate's reads or
  renders without moving content: the new-looks pill becomes an overlay pinned to the top of the
  list on web and native; the Home teaser joins the Home gate. No content is inserted above the
  viewport after the first tap on a screen.
- D5 Tab return. A memory-only module snapshot per member (never storage; cleared on owner change
  and sign-out; capped at the four tabs) holds each tab's last settled data and scroll offset.
  Remounting a web tab with a snapshot opens its gate at once, renders the snapshot, restores the
  scroll before paint, then refreshes in place without placeholder, skeleton or busy flash. Web
  bottom-nav links use `scroll={false}`; first visits start at the top. Native tabs already stay
  mounted; refocus refreshes must not set the initial loading state again.
- D6 Motion. App-defined transitions are 200 ms or less (`planner-rail-in` 280 to 200 ms,
  `duration-300` to `duration-200`, native `Animated` timings at most 200 ms, native root stack
  `animationDuration: 200`). Under reduced motion they are instant: the existing web global rule;
  native stack `animation: 'none'` and every RN `Modal` `animationType="none"` through one shared
  hook. Platform sheet presentation of RN `Modal` (iOS slide) is system-timed and stays as is
  when reduced motion is off.
- D7 Layout-shift budget. TEA owns the Chromium spec: 390 x 844, signed-in member, cold load of
  each tab and a scripted tab-switch sequence (Home, Closet, Community, Profile, Home), each under
  fixed empty, populated and delayed responses; the score sums every layout-shift entry including
  those with `hadRecentInput`, over the full transition; above 0.1 fails. It runs in the existing
  `pr-pw-e2e-local.yml` sharded job (watched by PR Gate). A signed-out cold load of Home is
  measured too.
- D8 Production rebaseline. Before merge, TEA runs the same measurement read-only against
  production at 390 x 844 (signed-out Home, and Home as the prod synthetic member) and records the
  scores in the test design. No writes on production.

## Boundaries & Constraints

**Always:** web and native parity for D1 to D6; existing testids stay (`member-sample-outfit`,
`home-outfit-retry`, `lookbook-card-skeleton`, spotlight testids) unless a test is updated in the
same change; every new member-visible string in all 10 web and 10 mobile locales; the gate never
hides an error or retry state once its reads settle; reduced motion respected everywhere.

**Never:** member data in localStorage, sessionStorage or SecureStore for the snapshot; a shared
query library (no SWR or react-query); visual redesign of headers, cards or tab bar (CC-7.9);
five-tab rework or back pattern (CC-7.11); Today, Community, Closet calm-down content changes
(CC-7.13, CC-7.15, CC-7.16); a screen budget guard for clutter (CC-7.10); macOS jobs on PRs.

## I/O & Edge-Case Matrix

| Scenario            | Input / State                          | Expected                                                                      | Error handling                  |
| ------------------- | -------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------- |
| Member cold load    | stored session, Home, ritual 200       | shell + placeholder, then member outfit; never demo or sample; shift <= 0.1   | none                            |
| Member, no outfit   | ritual 200 with no usable outfit       | placeholder, then member sample outfit with its actions                       | none                            |
| Ritual fails        | ritual 5xx                             | placeholder, then sample + "outfit failed" + Retry                            | Retry keeps placement           |
| Delayed reads       | every read delayed 3 s                 | placeholder holds 3 s, header and tab bar never move, body appears once       | none                            |
| Empty closet        | inventory [] and onboarding incomplete | body appears with setup banner already in place; nothing inserted later       | none                            |
| Community Spotlight | Spotlight empty or disabled            | body appears without the Spotlight; feed never moves                          | Spotlight error inside the gate |
| New looks arrive    | realtime new looks after first paint   | overlay pill; list content does not move                                      | none                            |
| Tab return          | Home, Closet, back to Home in session  | last outfit and scroll at once, refresh in place, no placeholder              | refresh error keeps snapshot    |
| Owner change        | sign out, sign in as another member    | snapshot cleared; new member sees placeholder, never the old member's content | none                            |
| Signed out          | no stored session                      | signed-out page as today; no placeholder                                      | none                            |
| Reduced motion      | prefers-reduced-motion / OS setting    | transitions and modals instant                                                | none                            |

</frozen-after-approval>

## Code Map

- `apps/web/src/lib/landing-session.ts`, `app/globals.css:222-249` -- pre-paint `data-session`;
  add placeholder/gate rules keyed on it (placeholder shows under pending/member until the gate
  sets `data-ready`).
- `apps/web/src/lib/use-web-session.ts:120` -- `useWebSession` starts at `checking` every mount;
  seed from the live session singleton (`web-session.ts:25-37`) so a remount with a known session
  skips `checking`.
- `apps/web/src/app/page.tsx` -- server Home; wrap the body below the header (except
  `StickyBottomNav`) in the gate.
- `apps/web/src/app/components/home-ritual.tsx:800-931` -- `MemberRitual` renders `SampleOutfit`
  while `ritual` is null (flash, D2); `HomeRitualSession` `checking` text; report readiness to the
  gate; snapshot the settled ritual per owner (module `retainedSample` at :68 is the precedent).
- `apps/web/src/app/components/lookbook-prism-layout.tsx:471-624` -- demo `HomeRitual`,
  `HomeSpotlightTeaserSlot` (:601, joins the Home gate), `CommunityLookbookGrid` (:612).
- `apps/web/src/app/components/community-spotlight.tsx:124,194,473-490,630-646` -- skeleton that
  collapses; replace the skeleton with gate readiness.
- `apps/web/src/app/components/community-lookbook-grid.tsx:2111-2127,2334,2474,4179` -- feed
  skeleton, session pending, new-looks state (overlay pill), Spotlight at top of aside.
- `apps/web/src/app/community/page.tsx` -- Community route; gate wrapper.
- `apps/web/src/app/wardrobe/page.tsx:96-104,481-540,896-942,1082` -- reads, setup banner (:912),
  gate wrapper, snapshot of inventory and onboarding state.
- `apps/web/src/app/settings/page.tsx` -- Profile; gate waits for its section reads (D3 amendment); each section snapshots its data (P1-2).
- `apps/web/src/app/components/sticky-bottom-nav.tsx:28-90` -- tab links get `scroll={false}`;
  scroll restore lives in the gate.
- `apps/web/src/app/components/screen-gate.tsx`, `apps/web/src/lib/screen-snapshot.ts` (new) --
  the gate and the memory snapshot (owner-keyed, cleared via the `couture:session` owner change).
- `apps/web/src/app/globals.css:190-221`, `lookbook-prism-layout.tsx:343,525` -- motion (D6).
- `apps/mobile/app/(tabs)/_layout.tsx` -- tab shell; `apps/mobile/app/_layout.tsx:61-142` root
  stack options (D6), splash unchanged.
- `apps/mobile/src/lib/member-session.ts:12-48` -- `restoring` state drives the placeholder.
- `apps/mobile/app/(tabs)/index.tsx:236-241,329-504,767,817-968` -- sample-outfit flash
  (`showSampleOutfit`), `isLoading` set on every `loadData`, late banners and toggles.
- `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx:479-510,652-735` -- onboarding card
  inserted above; gate.
- `apps/mobile/src/features/community/community-screen.tsx:497,1671,1822-1840,2128,2241-2254` and
  `components/community/community-spotlight-module.tsx:158-183` -- gate, overlay pill.
- `apps/mobile/src/hooks/use-reduced-motion.ts` -- reuse; modals listed in D6 consume one
  `useModalAnimation()` hook.
- `apps/mobile/src/components/screen-gate.tsx` (new) -- native gate with the same placeholder.

## Tasks & Acceptance

**Execution:**

- [x] `apps/web/src/lib/screen-snapshot.ts` -- owner-keyed memory snapshot (`remember`, `recall`,
      `clear`), cleared on owner change; unit tests -- D5.
- [x] `apps/web/src/app/components/screen-gate.tsx` + `globals.css` -- gate with placeholder,
      `data-ready`, scroll restore before paint, readiness API for child reads -- D1, D3, D5.
- [x] `apps/web/src/lib/use-web-session.ts` -- seed from the known session on remount -- D5.
- [x] Web Home (`page.tsx`, `home-ritual.tsx`, `lookbook-prism-layout.tsx`,
      `home-spotlight-teaser.tsx`) -- gate, no sample before settle, snapshot -- D2, D3, D4.
- [x] Web Closet (`wardrobe/page.tsx`) and Community (`community/page.tsx`,
      `community-lookbook-grid.tsx`, `community-spotlight.tsx`) -- gate, overlay pill, snapshots.
- [x] Web Profile and `sticky-bottom-nav.tsx` -- gate, `scroll={false}`.
- [x] Web motion -- D6.
- [x] Native gate + `restoring` placeholder; Home, Wardrobe, Community gates; refocus refresh
      without loading state; overlay pill; motion hook and stack options -- D1 to D6.
- [x] Locales: placeholder label in 10 web + 10 mobile catalogs.
- [x] Unit/component tests for gate, snapshot, sample-before-settle, owner change; TEA owns the
      Chromium layout-shift spec and native tests per the test design.
- [ ] Learning path Step 65 (added); sprint-status 7-7 done before the final push (open).

**Acceptance Criteria:**

- Given a stored member session on web, when Home loads cold at 390 x 844, then neither the demo
  outfit nor the sample outfit nor signed-out actions appear before the member's outfit, and the
  measured shift score is at most 0.1.
- Given any reads delayed, when a tab loads, then the header and tab bar stay at the same
  coordinates from first paint until the body appears.
- Given a member returns to a visited tab in the same session, then its last content and scroll
  show in the first frame and refresh in place.
- Given reduced motion, then no transition or modal animates; otherwise none exceeds 200 ms
  (platform `Modal` presentation excepted per D6).

## Implementation Notes

- Working rules for this run: shared worktree with TEA, so no git stash, git checkout -- or git
  reset, and no commits (the builder commits). Do not run unit, API, Playwright or native suites
  locally; tsc per touched workspace and eslint on touched files only. Load the bmad-tea skill
  before creating or editing any test file. Do not touch `playwright/` (TEA owns it).
- Gate reads as built (web). Home: `ritual` (`GET /api/v1/ritual`), `teaser` (Spotlight with
  `surface=home_teaser&limit=1`, only while the layout stacks below 1280 px) and `spotlight` (the
  Community section's City Spotlight on Home, which sits above the feed, joined per D4). Closet:
  `GET /api/v1/wardrobe/garments`, `GET /api/v1/wardrobe/onboarding`, the user profile read
  (`resolveCurrentUserId`) and the first saved-looks page (its row and errors sit above the grid,
  D4). Community: first feed page and the City Spotlight page one. Profile (D3 amended): profile
  account, locations, commerce preferences, subscription plus premium access, premium theme (the
  account and locations sections sit above the three named reads and would push them, D4).
- Signed-out first paint (D3 amendment): a section in its `checking` state paints the signed-out
  layout it keeps, marked `data-landing="guest"` (`useGuestFirstPaint` in `screen-gate.tsx`):
  the Home demo outfit, the commerce, subscription, theme and locations signed-out pieces. The
  Closet's account and setup-progress errors render below the closet when there is no member.
- Snapshot keying: owner and bearer (TEA, fixture bearers share one owner), so a token rotation
  also clears it. Community and Home grids snapshot per tab (`community-grid` part), the Closet
  its reads (`closet` part), Home its ritual and teaser.
- Test ids added: `app-header` (each web tab header), `screen-gate` + `data-screen` +
  `data-ready`, `screen-placeholder`, `home-demo-outfit`, `community-new-looks-pill`.
- The Community Spotlight loading state keeps `community-spotlight-loading` as an empty marker;
  6.6-WEB-074 now asserts no skeleton cards.

## Plan Change Log

- 2026-11-25, D8 prod baseline (TEA, signed-out, 390 x 844, main 11c26918): Home 0, Closet
  0.1157, Community 0.0018, Profile 0.51, every entry flagged `hadRecentInput`. D3 amended: the
  Profile gate waits for its commerce, subscription and theme reads; signed-out late sections
  reserve space or render below the fold. Avoids shipping a Profile gate that opens at once over
  content that moves.

## Review Triage Log

- 2026-11-25, Codex review of 8327b4fb (2 P1, 11 P2, 2 P3; 7.7-codex-review.md). Decisions:
  every gate also opens after a 10 s deadline so one stalled read never hides finished sections
  or their Retry (P2-2); a verified member's snapshot is keyed by owner and survives a token
  refresh, while the fixture owner is keyed by the bearer captured when each read started, and a
  write whose captured scope is no longer live is dropped (P2-1); Profile snapshots its section
  data like the other tabs (P1-2, replaces the scroll-only note); losing Community access clears
  the Community and teaser snapshot parts (P3-1); one-time focus intents wait for the gate to
  open (P2-8); native tab focus runs the in-place refresh (P2-6); native stack uses a transition
  whose shipped duration is at most 200 ms on Android and iOS (P2-9). TEA owns the meter and
  fixture findings (P2-10) and the pre-merge production member baseline (P2-11).

## Design Notes

The gate keeps children mounted under `hidden` so reads start in parallel with the placeholder;
an element going from `display: none` to shown is an insertion, not a layout shift, and the
placeholder sits where the body will be. Example:

```tsx
<ScreenGate screen="closet" ready={inventorySettled && onboardingSettled}>
  {/* existing body, unchanged */}
</ScreenGate>
```

Server-rendered pages cannot know the session, so the placeholder and the hidden body are both in
the HTML and CSS chooses by `data-session` before paint; the gate sets `data-ready` on hydrate.

## Verification

**Commands:**

- `npm exec -w apps/web -- tsc --noEmit` and `npm exec -w apps/mobile -- tsc --noEmit` --
  expected: no errors (count by code; only symlink TS2742 ignorable).
- `npx eslint <touched files>` -- expected: clean.
- CI: `pr-pw-e2e-local.yml` layout-shift spec green at <= 0.1; every workflow green for the head
  SHA (CI is the proof; no local suites).
