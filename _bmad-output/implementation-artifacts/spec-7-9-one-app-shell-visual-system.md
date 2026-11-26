---
title: 'Story CC-7.9: One app shell and visual system'
type: feature
ticket: '7-9-one-app-shell-visual-system'
created: '2026-11-25'
status: in-progress
baseline_revision: '812cadce47adddfb4c891a5b8ae327c504e09f57'
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
  - '_bmad-output/implementation-artifacts/reviews/epic-7-ux-review.md'
  - '_bmad-output/implementation-artifacts/spec-7-7-signed-in-shell-without-flashes.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Each tab looks like a different app. Web Home and Community are an always-dark
gradient page framing an inset light lookbook card (an extra container level); Wardrobe is a
light zinc admin layout; Profile and /palette are always dark; error pages are hard black. Headers
differ in height and markup per tab, and the Wardrobe header wraps to two rows on phones. Colors
are duplicated by hand (web `globals.css`, native `constants/colors.ts`, `hero-theme.ts`,
`theme-palettes.ts`, seven local gold constants in Community) with about 1,431 Tailwind palette
classes and 244 raw hexes on web and 149 hexes on native. Gold marks chips, reactions, borders,
eyebrows and banners. Web Wardrobe strings are hard-coded English.

**Approach:** Publish one token set (color roles for light and dark, type, spacing, radius,
elevation, shell sizes, premium palettes) from `@couture/utils`. Web reads it through the
Tailwind config, which emits the CSS variables; native reads it through one `useTokens()` hook.
Both apps get one top bar component (56 px, title, optional back) and one page surface on every
tab and routed sub-screen, with cards one level deep. A guard script in the PR gate fails on any
raw color, palette class or off-scale value outside the token module, so the set stays the only
source. Visual snapshots of each tab in light and dark lock the result.

## Decisions (owner delegated; recorded here)

- D1 Token source. `packages/utils/src/design-tokens.ts` (exported from the package index): both
  apps already depend on, alias and pre-build `@couture/utils`, so a new package is unnecessary.
  It holds `colorRoles.light|dark`, `typeScale`, `space`, `radius`, `elevation`, `shell`
  (`topBarHeight: 56`, `tabBarHeight: 56`, `touchTarget: 44`) and `premiumPalettes`.
- D2 Color roles (same names on web and native): `page`, `card`, `cardMuted`, `ink`, `inkSoft`,
  `inkMuted`, `line`, `lineStrong`, `inverse`, `onInverse`, `primary` (gold fill), `onPrimary`,
  `focus` (gold halo), `focusEssential`, `tabActive` (gold), `premium` (gold), `premiumInk`
  (gold text), `notice*`, `danger*`, `successInk`, `merlotInk`, `scrim`. Light page `#FFFFFF`,
  card `#F5F5F7`; dark page `#121214`, card `#1C1C21`; values otherwise carried from today's
  lookbook and native tokens. Every text role meets 4.5:1 and every icon or line role used for
  meaning meets 3:1 on `page`, `card` and `cardMuted` in its scheme, pinned by `contrast.spec.ts`.
- D3 Gold. Only `primary`, `focus`, `tabActive`, `premium` and `premiumInk` carry gold, so gold is
  reachable only through those roles. Selected chips, pressed reactions, checkbox accents, active
  toggles and pull-to-refresh use `inverse`/`ink`; decorative gold borders and eyebrows use
  `line`/`inkMuted`; warnings use `notice*`. A gold button that is not the screen's main action
  becomes a neutral outline button. Native active tab becomes gold (`tabActive`) with the label
  weight change that already exists; web keeps its indicator bar and `gold-active-indicator` id.
- D4 Scales. Type: 12, 14, 16, 18, 20, 24, 30 px (Tailwind `text-xs` to `text-3xl`; body 16;
  top bar title 18 semibold). Spacing: 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64. Radius:
  `sm` 4, `md` 8, `lg` 12, `xl` 16, `full`. Elevation: `none`, `card`, `overlay`. Web font is
  Geist Sans on every page (already self-hosted); native uses the system font. The unloaded
  Canela/Playfair/Space Grotesk fallbacks are dropped.
- D5 Premium palettes. A premium palette is a member choice and must also follow the system
  setting: each palette gains a dark variant (same hue identity, dark card) in the token module,
  contrast pinned in both schemes. Web `[data-theme]` blocks and native `theme-palettes.ts` come
  from the tokens. Where a palette applies (Community cards, planner, Profile gallery) is
  unchanged.
- D6 Top bar. Web `AppTopBar` (`data-testid="app-header"`, height exactly 56 px, one row: optional
  back, `h1` title, optional trailing slot; at 768 px and up the trailing slot also holds the
  existing desktop tab links). Native `AppTopBar` is the `header` of the tab navigator and every
  root stack screen that shows a header: 56 pt plus the top safe-area inset. Titles: the current
  tab label (Home, Wardrobe, Community, Profile until CC-7.11 renames them) or the sub-screen
  title. In-body duplicate titles (native Wardrobe, garment detail, onboarding) are removed.
  Header actions that do not fit one row move to the first row of the body (web Wardrobe's
  three buttons); no action is removed.
- D7 Page surface and one card level. Every tab, routed sub-screen (web capsules, onboarding,
  palette, notification settings, sign-in, guardian and teen screens, error and not-found;
  native stack screens), and the web inline garment detail use `page`. The Home and Community
  inset lookbook card, the dark gradients and always-dark pages are removed. A card never
  contains a card: inner cards in Home, Wardrobe and the planner become plain sections inside
  their card. Section content and order do not change (calm-down belongs to CC-7.13, CC-7.15,
  CC-7.16). The web inline garment detail shows the top bar with back and the garment title.
- D8 Session placeholder (AC4). The top bar and tab bar render outside each `ScreenGate`, so the
  placeholder sits inside the final shell; the placeholder uses `cardMuted` on web and native.
- D9 Strings. Every hard-coded member-facing string on changed screens moves to the locale
  catalogs in all 10 web and 10 mobile locales (web `wardrobe/page.tsx` about 20,
  `wardrobe/capsules/page.tsx` about 17, native `wardrobe-hub-screen.tsx`, `wardrobe-capsules.tsx`,
  `capsule-builder-modal.tsx`), plus the new `shell.back` label. Staff-only moderation strings are
  out of scope.
- D10 Guard. `scripts/check-design-tokens.mjs` with a `node --test` spec, run in the PR gate.
  Web `apps/web/src/**/*.{ts,tsx,css}` (not tests): fails on Tailwind palette color names,
  arbitrary color values (`-[#`, `-[rgb`, `-[var(--`), raw hex or `rgb(` outside
  `globals.css` base rules, `dark:` color variants, padding, margin, gap or space classes off
  D4's scale or arbitrary, `text-4xl` and larger or `text-[`, radius and shadow classes not in
  D4. Native `apps/mobile/{app,src,components}/**/*.{ts,tsx}` (not tests): fails on hex, `rgb(`
  or named color literals. A short, commented exemption list covers rendered images, not screens
  (share-card PNG composer, OG images) and staff moderation pages for spacing only.
- D11 Snapshots (AC6). TEA owns them: web Playwright `toHaveScreenshot` of each tab in light and
  dark at 390 x 844 with fixed member fixtures, baselines generated on Linux CI and committed;
  native snapshots of each tab in light and dark on the smallest supported phone. Smallest
  supported phone: 360 x 640 dp (Android `small_phone`), narrower than iPhone SE (375 x 667 pt),
  run on the Linux Android emulator in PRs within the 20-minute budget; iPhone SE runs only in the
  nightly and manual iOS lanes (no macOS on PRs).

## Boundaries & Constraints

**Always:** web and native parity; existing test ids stay (`app-header`, `gold-active-indicator`,
`screen-gate`, `screen-placeholder`, `member-sample-outfit`) unless a test changes in the same
commit; CC-7.7 layout-shift budget stays at 0.1 or less; reduced motion and 44 px targets keep
working; focus ring stays visible on both schemes; premium palettes still apply where they do
today.

**Never:** five-tab rename, Looks tab, tab icons or back-pattern rules for overlays (CC-7.11,
CC-7.12); removing or adding sections, chips or actions (CC-7.13, CC-7.15, CC-7.16); copy rewrites
for reading level (CC-7.17); the clutter budget guard (CC-7.10); a new UI or styling library
(no NativeWind, no CSS-in-JS); member data or theme choice in new storage; macOS jobs on PRs;
changes to the rendered share-card image.

## I/O & Edge-Case Matrix

| Scenario           | Input / State                        | Expected                                                                               | Error handling           |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------ |
| System light       | OS light, any tab, web or native     | `page` light surface, 56 px top bar with tab title, cards one level, gold only by role | none                     |
| System dark        | OS dark, any tab                     | same layout in dark roles; no light inset card; no always-dark page in light mode      | none                     |
| Scheme flip        | OS changes while the app is open     | every screen follows without reload                                                    | none                     |
| Premium palette    | palette chosen, OS dark              | palette's dark variant on Community cards and planner; contrast holds                  | none                     |
| Session pending    | stored member session, cold load     | top bar and tab bar in final position; placeholder inside the shell                    | none                     |
| Sub-screen         | capsules, onboarding, garment detail | top bar with back and title; back returns to the parent                                | direct entry: parent tab |
| Non-English locale | `de-DE`, Wardrobe and capsules       | every string from the catalog; no English left                                         | none                     |
| Guard              | raw hex or `bg-amber-300` added      | PR gate fails naming file and line                                                     | exemption list only      |

</frozen-after-approval>

## Code Map

- `packages/utils/src/design-tokens.ts` (new), `index.ts`, `contrast.ts`/`contrast.spec.ts` --
  token source; contrast pins move here from `colors.test.ts` and `globals.css` parsing.
- `apps/web/tailwind.config.ts` -- replace `colors` with token roles as
  `rgb(var(--cc-<role>) / <alpha-value>)` plus `transparent`/`current`/`inherit`; `borderRadius`,
  `boxShadow` from tokens; plugin `addBase` emits `:root`, dark media, `[data-theme]` x scheme
  vars from the tokens.
- `apps/web/src/app/globals.css` -- drop hand-written `--theme-*`, `--lookbook-*`,
  `--background` blocks (now emitted); keep focus, forced-colors, reduced-motion and gate rules
  rewritten on `--cc-*`; body uses Geist.
- `apps/web/src/app/layout.tsx:11-21` -- apply Geist on `<html>` for every page.
- `apps/web/src/app/components/app-top-bar.tsx` (new) -- D6.
- `apps/web/src/app/page.tsx:25-111`, `components/lookbook-prism-layout.tsx:379-388,437,507-620`
  -- Home frame, inset card, nested cards, alert card hexes.
- `apps/web/src/app/community/page.tsx:19-54`, `components/community-lookbook-grid.tsx` (37 gold
  uses, 70 `--theme-*`) -- Community frame and gold roles.
- `apps/web/src/app/settings/page.tsx:36-58`, `palette/page.tsx:42`, `error.tsx:34`,
  `not-found.tsx:9`, `signin`, `notification-settings` -- always-dark pages to tokens + top bar.
- `apps/web/src/app/wardrobe/page.tsx:1046-1265`, `garment-detail.tsx:106-139,887`,
  `capsules/page.tsx:54-540`, `components/wardrobe-onboarding-flow.tsx:469` -- header row,
  nested cards, dead `gold-*` classes, hard-coded strings.
- `apps/web/src/app/components/sticky-bottom-nav.tsx:122-164`, `screen-gate.tsx:312,365-386` --
  tab bar and placeholder on tokens.
- `apps/web/src/lib/premium-theme.ts:231-258` -- unchanged API; reads emitted vars.
- `apps/web/src/i18n/locales/*.json` -- `shell.back`, wardrobe and capsules strings.
- `apps/mobile/src/theme/tokens.ts` (new) -- `useTokens()` from `useColorScheme` + utils tokens.
- `apps/mobile/constants/colors.ts`, `components/hero/hero-theme.ts`, `components/themed.tsx`,
  `src/theme/theme-palettes.ts` -- derive from tokens; no literals.
- `apps/mobile/src/components/app-top-bar.tsx` (new); `app/(tabs)/_layout.tsx:87-253` (header,
  tab bar active gold); `app/_layout.tsx:156-370` (stack header, nav theme from tokens);
  `src/features/wardrobe/wardrobe-back-button.tsx`, `garment-detail-screen.tsx:227`.
- `apps/mobile/app/(tabs)/index.tsx:1140-1492`, `components/hero/*` -- hard-coded light hexes.
- `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx:447-1228`, `wardrobe-capsules.tsx`,
  `capsule-builder-modal.tsx` -- duplicate titles, strings.
- `apps/mobile/src/features/community/*`, `components/community/*` -- local gold constants.
- `apps/mobile/app/(tabs)/settings.tsx:1904-2130`, `notification-settings.tsx:367-381`,
  guardian and teen screens -- hard-coded and dark-only colors.
- `apps/mobile/src/components/screen-gate.tsx:189,210` -- placeholder `cardMuted`.
- `apps/mobile/assets/locales/*.json` -- `shell.back`, wardrobe strings.
- `scripts/check-design-tokens.mjs` (new) + spec; `.github/workflows/pr-gate.yml` or the
  node-test-gate list -- D10.

## Tasks & Acceptance

**Execution:**

- [x] `packages/utils/src/design-tokens.ts` + contrast pins -- D1, D2, D4, D5.
- [x] Web token plumbing: `tailwind.config.ts`, `globals.css`, `layout.tsx` -- D1, D4.
- [x] Web `AppTopBar` and tab frames: Home, Community, Wardrobe, Profile, bottom nav, gate -- D6,
      D7, D8.
- [x] Web token migration of every remaining non-test source under `apps/web/src` -- D2, D3.
- [x] Web routed sub-screens and inline garment detail -- D6, D7.
- [x] Native `useTokens`, color modules derived, `AppTopBar` as tab and stack header -- D1, D6.
- [x] Native migration of every screen and component with literals; duplicate titles removed;
      active tab gold -- D2, D3, D7, D8.
- [x] Strings into 10 web + 10 mobile catalogs with locale specs -- D9.
- [x] `scripts/check-design-tokens.mjs` + `node --test` spec wired into the PR gate -- D10.
- [x] Existing unit tests that assert old classes or hexes updated (bmad-tea loaded first).
- [ ] TEA: snapshots (D11) and the test plan's specs.
- [ ] Learning path Step 66 (added); sprint-status 7-9 done before the final push (open).
- [x] Coordinator add-on A: preview web reaches its protected preview API through a same-origin
      proxy route (commit ea7c7936 from `study/7-8-baseline`: `apps/web/next.config.ts`,
      `apps/web/src/app/api/preview-api/[...path]/route.ts`, `apps/web/src/lib/preview-api-proxy.ts`),
      applied to the tree; TEA writes its unit tests (production keeps the direct rewrite; 404 when
      unconfigured; secret never logged).
- [x] Coordinator add-on B: signed-out `/wardrobe` shows "Your session expired" and two other
      errors to a visitor who never signed in. TEA reproduced on production (main 812cadce, 390 x
      844, `data-session` none, zero API calls): `wardrobe.capture.errors.signedOut`,
      `wardrobe.hub.accountFailed` and `wardrobe.hub.setupFailed` are raised client-side from a
      null user id, not from a failed read. Decision (safest first visit): a signed-out visitor
      sees no error alerts, is offered one Sign in link (`community.notifications.signin`) to
      `/signin` in the page, the add action (`garment-capture-open`) goes to `/signin`, and
      Silhouette stays disabled. Failing spec: `playwright/tests/wardrobe-signed-out.spec.ts`
      (7.9-E2E-012).

**Acceptance Criteria:**

- Given any tab or routed sub-screen at 390 x 844, then the top bar measures 56 px high, there is
  one page surface, and no card element contains another card.
- Given a source tree with a raw hex, palette class or off-scale spacing outside the exemptions,
  when the guard runs, then it fails naming the file and line; on this branch it passes.
- Given system dark, then no screen shows a light page or light inset card, and every text role
  meets 4.5:1 on its surfaces.
- Given each tab in light and dark, then its web and native snapshots match the committed
  baselines.

## Implementation Notes

- Working rules for this run: shared worktree with TEA, so no git stash, git checkout --, git
  reset, git add or commits (the builder commits). Do not run unit, API, Playwright or native
  suites locally; tsc per touched workspace, eslint on touched files and the guard script only.
  Load the bmad-tea skill before creating or editing any test file. Do not touch `playwright/`,
  `maestro/` or native e2e flows (TEA owns them). Rebuild utils dist
  (`npm run build -w @couture/utils`) after editing the token module, before trusting app tsc.
- Test hooks from TEA's plan (`_bmad-output/test-artifacts/test-design-7-9-one-app-shell-visual-system.md`),
  markup only: web `data-surface="page"` on the one page element per screen and
  `data-surface="card"` on every card container; `data-gold="primary|focus|tab|premium"` on every
  element allowed to paint gold (TEA's probe fails on gold anywhere else); `app-top-bar-back` on
  the back control (web test id and native testID); native top bar testID `app-top-bar`; keep
  `app-header`, `screen-gate`, `screen-placeholder`, `sticky-bottom-nav`, `gold-active-indicator`.
- Builder-owned tests: UNIT-001..006 (contrast light and dark, premium dark variants, gold only in
  the five roles, scales equal D4, Tailwind plugin emits `--cc-*` for root, dark and every
  `data-theme` x scheme), CMP-001..002 (web AppTopBar, placeholder inside the shell),
  NAT-001..005 (useTokens live flip, native AppTopBar 56 + inset, active tab `tabActive`, de-DE
  wardrobe strings), the locale specs, and the guard script with one clean-tree test in
  `scripts/check-design-tokens.test.mjs`. TEA adds the guard mutation cases GRD-001..008 to that
  file, every Playwright spec, snapshots and the small_phone native shard.
- The change is large: work the Execution tasks in order and tick each one here as it lands.
  Disjoint file groups (web screens, native screens, locales) may go to parallel subagents once
  the token module and both apps' plumbing exist; each subagent gets this file as its brief.

## Plan Change Log

- 2026-11-25, builder, D2 as built: `notice*` is `noticeSurface`, `noticeLine`, `noticeInk`;
  `danger*` is `danger` (destructive fill), `onDanger`, `dangerSurface`, `dangerLine`,
  `dangerInk`. Three light values darkened to clear their floors on `cardMuted`: `premiumInk` and
  `tabActive` `#7A5C14` (the lookbook's `#8A691F` measured 4.29:1) and `focus` `#9A7A2A` (the fill
  gold is 2.4:1 on white, UNIT-003 asks 3:1). The notice roles are orange (15 to 31 degrees), so a
  warning never reads as gold. Palette card borders are solid (the alpha borders flattened onto
  their card).
- 2026-11-25, builder, D4: two named spacing keys beyond the scale for the shell only, `pb-safe`
  (bottom safe area) and `pb-tab-bar` (tab bar clearance). Tailwind `borderRadius` and `boxShadow`
  are replaced wholesale like `colors`, so a bare `rounded` or `shadow-lg` emits nothing and the
  guard flags it.
- 2026-11-25, builder with TEA, D10: the guard also fails on web named colors in style values and
  SVG paint attributes, on any color utility whose value is not a role (allow list read from
  `design-tokens.ts`), on interpolated color classes (`bg-${tone}`), and on native literal
  `fontSize`, radius and spacing values off D4, which backs AC 1's shared scale on native.
- 2026-11-25, builder, D6: sub-screens drop their in-body back links in favor of the top bar back
  (moderation case, SLA and evidence pages, capsules, onboarding, garment detail).
  `/notification-settings` goes back to `/community`, its only entry (the Community bell).
- 2026-11-25, builder, D5: the dimmed premium gallery card goes from `opacity-70` to `opacity-80`,
  the lowest that keeps every palette at 4.5:1 on the white page (Jewel Radiance fell to 3.77:1).
- 2026-11-25, builder, D9: the native capsules catalog carries the web capsule keys too (92 keys),
  because 4.3-I18N-MOB-06 requires one key tree on both surfaces.

## Review Triage Log

## Design Notes

Web colors carry channels so Tailwind opacity modifiers keep working:

```ts
// tailwind.config.ts
colors: Object.fromEntries(
  roleNames.map((r) => [kebab(r), `rgb(var(--cc-${kebab(r)}) / <alpha-value>)`])
)
// emitted: :root { --cc-page: 255 255 255; } @media (prefers-color-scheme: dark) { :root { --cc-page: 18 18 20; } }
```

Tailwind's default spacing and font-size keys already match D4, so they stay; the guard keeps
classes on the scale. Replacing `colors` wholesale makes a palette class silently produce no CSS,
which is why the guard must land in the same PR as the migration.

## Verification

**Commands:**

- `node --test scripts/check-design-tokens.test.mjs` and `node scripts/check-design-tokens.mjs`
  -- expected: pass on the branch.
- `npm exec -w packages/utils -- tsc --noEmit -p tsconfig.build.json`, then
  `npm exec -w apps/web -- tsc --noEmit` and `npm exec -w apps/mobile -- tsc --noEmit` --
  expected: no errors (only symlink TS2742 ignorable; rebuild utils dist first).
- `npx eslint <touched files>` -- expected: clean.
- CI: every workflow green for the head SHA, snapshots and layout-shift spec included.
