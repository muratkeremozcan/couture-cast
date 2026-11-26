# Test design: Story CC-7.9 one app shell and visual system

Updated: 2026-11-25. Initial plan from spec-7-9 (ready-for-dev, baseline 812cadce).
Updated: 2026-11-25. As built by TEA: baselines come from a failing CI run's captured screens
(no dispatch input), the native dark flip goes through a runner endpoint, unit IDs NVIS-U01..U10
and VIS-U01..U03 added.

Updated: 2026-11-26. Codex review (c8d1fcd6): native flow captures only and
`compare-native.mjs` compares all eight after it (P1-1); pull copies nothing unless complete;
fixture suites `@local-lane` (P1-2); shell probe fixes (P2-4); endpoint hardening (P3-3); proxy
UNIT-113 and no relayed Set-Cookie (P2-1), fragment and userinfo bases (P3-2).

Status: active

## Scope

Spec: `_bmad-output/implementation-artifacts/spec-7-9-one-app-shell-visual-system.md`.
Acceptance criteria from epics.md CC-7.9:

1. Every tab and sub-screen uses one page surface, a 56 px top bar with title and optional back,
   one card level and the shared spacing and type scale, on web and native.
2. Light and dark follow the system setting on every screen. The dark page framing an inset light
   card on Home and Community is removed.
3. Color, type, spacing, radius and elevation tokens are published once and consumed by web and
   native. Gold appears only on the primary action, focus ring, active tab and Premium marks.
4. The CC-7.7 session placeholder renders this shell.
5. Every member-facing string on changed screens comes from the locale catalogs.
6. Visual snapshots of each tab in light and dark at 390 x 844 and the smallest native phone.

Plus spec decisions D1 to D11.

## Stable hooks (requested from the builder)

| Hook                                         | Meaning                                                      |
| -------------------------------------------- | ------------------------------------------------------------ |
| `app-header` (web), `app-top-bar` (native)   | The one top bar; title is its `h1` (web) / header role       |
| `app-top-bar-back`                           | Back control in the top bar (web and native testID)          |
| `data-surface="page"`                        | The one page surface element per screen (web)                |
| `data-surface="card"`                        | Every card container (web); a card never has a card ancestor |
| `data-gold="primary\|focus\|tab\|premium"`   | Elements allowed to paint gold (web); nothing else may       |
| `screen-gate`, `screen-placeholder`          | Unchanged from CC-7.7                                        |
| `sticky-bottom-nav`, `gold-active-indicator` | Unchanged                                                    |

`data-gold` is the test's allow list. It is markup only and carries no style, so it cannot hide a
wrong color: the probe reads computed colors and fails on gold anywhere outside it.

## Risk assessment

| ID  | Risk                                                                        | P   | I   | Score | Mitigation (tests)                                              |
| --- | --------------------------------------------------------------------------- | --- | --- | ----- | --------------------------------------------------------------- |
| R1  | Replacing Tailwind `colors` wholesale makes an unmigrated class render none | 3   | 3   | 9     | GRD-001..006, E2E-003, VIS-001..008                             |
| R2  | A dark screen keeps a light card or text loses contrast (teens on dark OS)  | 3   | 3   | 9     | E2E-004, E2E-005, UNIT-001..003, NVIS                           |
| R3  | Premium palette in dark scheme fails contrast or stops applying             | 2   | 3   | 6     | UNIT-002, E2E-008                                               |
| R4  | Top bar change moves the shell and breaks the CC-7.7 0.1 shift budget       | 2   | 3   | 6     | existing 7.7-E2E-001..013 unchanged                             |
| R5  | Gold leaks to chips, reactions, borders                                     | 3   | 2   | 6     | E2E-006, GRD-007, NAT-003                                       |
| R6  | Hard-coded English left on Wardrobe / capsules                              | 3   | 2   | 6     | E2E-009, locale specs (builder), NAT-005                        |
| R7  | Snapshot flake (fonts, clock, images, emulator status bar)                  | 3   | 2   | 6     | fixed fixtures, fixed clock, crop, retries 0 on mismatch triage |
| R8  | Existing specs pinned to old classes / colors go red                        | 3   | 1   | 3     | TEA updates in this PR (inventory below)                        |
| R9  | Native follows OS dark only on cold start, not on a live flip               | 2   | 2   | 4     | NAT-004, NVIS dark run flips while open                         |
| R10 | Sub-screen back goes nowhere on direct entry                                | 2   | 2   | 4     | E2E-007                                                         |

## Coverage plan

Levels: unit and component tests prove token values, contrast, the guard and the top bar in
isolation; Playwright proves the composed screens (computed styles in both schemes); snapshots
lock the look. Pixel snapshots are the last line, never the only proof of a rule: every AC has a
structural assertion that names what broke.

### Unit and component (builder writes, TEA reviews)

| ID           | Level     | What it proves                                                                                               | AC / D |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------ | ------ |
| 7.9-UNIT-001 | unit      | Every text role meets 4.5:1 on `page`, `card`, `cardMuted` in light and dark                                 | 2, D2  |
| 7.9-UNIT-002 | unit      | Every premium palette, light and dark variant, meets 4.5:1 text on card                                      | D5     |
| 7.9-UNIT-003 | unit      | Meaning icon/line roles meet 3:1; `focus` meets 3:1 on both pages                                            | D2     |
| 7.9-UNIT-004 | unit      | Gold hexes appear only under `primary`, `focus`, `tabActive`, `premium*`                                     | 3, D3  |
| 7.9-UNIT-005 | unit      | Scales equal D4 exactly (type, space, radius, elevation, shell sizes 56/56/44)                               | 1, D4  |
| 7.9-UNIT-006 | unit      | Tailwind plugin emits `--cc-*` for `:root`, dark media and every `[data-theme]` x scheme, as channel triples | 3, D1  |
| 7.9-CMP-001  | component | Web `AppTopBar`: one row, `h1` title, back only when given, back label from catalog                          | 1, D6  |
| 7.9-CMP-002  | component | Web placeholder sits between `app-header` and `sticky-bottom-nav`, `bg-card-muted`                           | 4, D8  |
| 7.9-NAT-001  | component | Native `useTokens()` returns dark roles when `useColorScheme` is dark, updates on change                     | 2      |
| 7.9-NAT-002  | component | Native `AppTopBar`: 56 + top inset, title, back testID and label from catalog                                | 1, D6  |
| 7.9-NAT-003  | component | Native active tab tint is `tabActive`, inactive is `inkMuted`                                                | 3, D3  |
| 7.9-NAT-004  | component | Native tab screen re-renders page background on a live scheme change                                         | 2      |
| 7.9-NAT-005  | component | Native Wardrobe hub and capsules render de-DE strings (no en-US source string)                               | 5, D9  |

### Guard (builder writes `scripts/check-design-tokens.mjs`; TEA owns the mutation cases)

`scripts/check-design-tokens.test.mjs`, `node --test`, runs against fixture trees in a temp dir.
Each case writes one offending line and expects exit 1 naming `file:line`; the clean fixture and
the real branch tree exit 0.

| ID          | Offence                                                                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.9-GRD-001 | Tailwind palette class `bg-amber-300`, `text-zinc-500`                                                                                                                                                                                              |
| 7.9-GRD-002 | Arbitrary color `bg-[#fff]`, `text-[rgb(0,0,0)]`, `bg-[var(--x)]`                                                                                                                                                                                   |
| 7.9-GRD-003 | Raw hex / `rgb(` in a web `.tsx` style object and in `.css` outside base rules                                                                                                                                                                      |
| 7.9-GRD-004 | `dark:` color variant                                                                                                                                                                                                                               |
| 7.9-GRD-005 | Off-scale spacing `p-7`, `gap-[13px]`; `text-4xl`, `text-[15px]`; `rounded-3xl`, `shadow-2xl`                                                                                                                                                       |
| 7.9-GRD-006 | Native hex, `rgb(`, named color literal (`'white'`) in a `.tsx`                                                                                                                                                                                     |
| 7.9-GRD-007 | Exemption list: an exempt file passes, the same line in a non-exempt sibling fails; a test file is ignored                                                                                                                                          |
| 7.9-GRD-008 | Real tree: `node scripts/check-design-tokens.mjs` exits 0 on the branch (PR gate step)                                                                                                                                                              |
| 7.9-GRD-009 | Web named colour in a style object or `fill`/`stroke`/`stopColor` (TEA probe gap 1)                                                                                                                                                                 |
| 7.9-GRD-010 | Colour class naming no token role (`bg-gold`, `text-foreground`): emits no CSS, R1 (TEA probe gap 2)                                                                                                                                                |
| 7.9-GRD-011 | Interpolated colour class (`` `bg-${tone}` ``) and upper-case named colour (TEA probe gap 3)                                                                                                                                                        |
| 7.9-GRD-012 | Native literal `fontSize`, `borderRadius` (per corner too), padding, margin and gap off D4 (13, 10, 6, 18, -7, 9, 66 fail; 14, 9999, 4, 20, -8, 64 pass)                                                                                            |
| 7.9-GRD-013 | CSS named colour in a plain declaration (`border: 1px solid Red`, `background: rebeccapurple`) and any CSS Color 4 keyword in JSX or native fail; system colours, `transparent`, `currentColor`, `inherit` and `rgb(var(--cc-*))` pass (Codex P3-1) |
| 7.9-GRD-014 | The guard exports `SCALES` read from `design-tokens.ts`, equal to D4, with no literal step list of its own; `text-[17px]` fails (Codex P2-12)                                                                                                       |

### Web E2E (TEA, `playwright/tests/app-shell-visual-system.spec.ts`)

Chromium at 390 x 844, `isMobile`, fixed member fixtures from `helpers/shell-fixtures.ts`
(populated mode), `page.clock.setFixedTime`, both `colorScheme` values. Screens: Home, Wardrobe,
Community, Profile, plus sub-screens capsules, onboarding, palette, notification settings,
inline garment detail, sign-in, not-found.

| ID                | What it proves                                                                                                                                                                                                      | AC / D        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 7.9-E2E-001       | Each screen: `app-header` bounding box height is exactly 56, one row, its `h1` holds the title                                                                                                                      | 1, D6         |
| 7.9-E2E-002       | Each screen: exactly one `data-surface="page"`; its computed background is the `page` role; no `data-surface="card"` has a card ancestor                                                                            | 1, D7         |
| 7.9-E2E-003       | Each screen, both schemes: every visible element's computed color, background and border color is a token role value (no transparent fallback from a dropped class: text never paints the UA default black on dark) | 3, R1         |
| 7.9-E2E-004       | Dark scheme: body and page are the dark `page`; no element covering more than 40% of the viewport paints a light background (the inset card is gone); Home and Community no longer paint the gradient               | 2             |
| 7.9-E2E-005       | Both schemes: painted text contrast >= 4.5:1 per screen (`painted-contrast` helpers)                                                                                                                                | 2, D2         |
| 7.9-E2E-006       | Gold probe: any computed color within gold distance outside `data-gold` fails, naming the node; focus ring on Tab is gold                                                                                           | 3, D3         |
| 7.9-E2E-007       | Sub-screen back: top bar back returns to the parent; direct entry back goes to the parent tab                                                                                                                       | 1, D6         |
| 7.9-E2E-008       | Premium palette + OS dark: palette dark variant on Community cards and planner; contrast holds                                                                                                                      | D5            |
| 7.9-E2E-009       | de-DE: Wardrobe and capsules show no en-US catalog value that differs from de-DE; `shell.back` label localized                                                                                                      | 5, D9         |
| 7.9-E2E-010       | Scheme flip with the page open: `emulateMedia` light to dark changes `page` without a navigation                                                                                                                    | 2             |
| 7.9-E2E-011       | Session pending (7.7 hold): top bar and tab bar at their final boxes, placeholder inside, `cardMuted`                                                                                                               | 4, D8         |
| 7.9-E2E-013       | Profile account read held past the reveal: reserve visible, then the exact email, reserve gone, the Locations heading box unchanged (Codex replaced-assertions check 2)                                             | 4, CC-7.7 AC3 |
| 7.9-PROBE-001a..c | Probe skips text hidden by clip on a positioned box, clip-path inset(50%), or a 1 x 1 px box clipping both axes; each alone beside a faint visible line that must still fail (CI e5d4cfa5, Codex check 3)           | D3            |
| 7.9-PROBE-001d    | Clip on a box that is not positioned clips nothing: its faint text is measured and fails                                                                                                                            | D3            |
| 7.9-PROBE-002     | Text painted over by an opaque layer is still refused as covered                                                                                                                                                    | D3            |
| 7.9-PROBE-003     | Focus ring: a 2 px outline at offset 2 covers the WCAG 2.4.13 area at 3:1                                                                                                                                           | D3            |
| 7.9-PROBE-004     | Focus ring negative control: focus that paints nothing falls short of the area                                                                                                                                      | D3            |
| 7.9-PROBE-005     | Focus ring negative control: focus that moves the control is refused before scoring                                                                                                                                 | D3            |
| 7.9-PROBE-006     | Focus ring negative control: a faint ring below 3:1 falls short of the area                                                                                                                                         | D3            |

### Coordinator add-ons in this PR (TEA)

| ID                | File                                           | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7.9-UNIT-101..113 | `apps/web/src/lib/preview-api-proxy.test.ts`   | Preview proxy (ea7c7936): production and local keep the direct rewrite; 404 unconfigured; no `..` escape from `/api/v1` (was red: reached `/api/internal`); secret never logged or returned (was red: an echoed bypass header reached the browser); browser `x-vercel-*` and `_vercel` cookies dropped; reserved `x-vercel-*` query options stripped and no upstream Set-Cookie relayed (Codex P2-1); fragment and userinfo bases refused (P3-2) |
| 7.9-E2E-012       | `playwright/tests/wardrobe-signed-out.spec.ts` | Signed-out `/wardrobe`: no alert, no member error copy, a sign-in link, Add garment goes to sign-in. Reproduced on production (main) 2026-11-25: three alerts, no API call                                                                                                                                                                                                                                                                       |

### Web snapshots (TEA, `playwright/tests/app-shell-visual-snapshots.spec.ts`, tag `@local-lane`)

| ID               | Snapshot                                                      |
| ---------------- | ------------------------------------------------------------- |
| 7.9-VIS-001..004 | Home, Wardrobe, Community, Profile, light, viewport 390 x 844 |
| 7.9-VIS-005..008 | Same four, dark                                               |

Rules: `toHaveScreenshot` with `animations: 'disabled'`, `caret: 'hide'`, fixed clock, fixtures
that serve local images, fonts awaited (`document.fonts.ready`), `deviceScaleFactor: 1` to keep
PNGs small, `maxDiffPixelRatio: 0.01`. Linux baselines only (`*-chromium-linux.png`), generated in
CI. Local lane only (`@local-lane`; preview and prod configs `grepInvert` it).

Baselines: a missing or changed snapshot fails the run, and `pw-e2e` copies each
`<name>-actual.png` into `blob-report/visual-actuals/` of the uploaded shard artifact.
`npm run visual:pull-baselines -- --web <run-id>` (`scripts/visual-baselines/pull.mjs`) places
them as `*-chromium-linux.png`; TEA reviews each PNG and commits it. Lane B stories 7.10 to 7.17
rebaseline the same way. No dispatch input: a dispatch runs the whole workflow and could not run
on this branch before merge anyway.

### Native snapshots (TEA, `maestro/shell-visual-snapshots.yaml`)

Android `small_phone` (360 x 640 dp), API 34, in `pr-mobile-e2e.yml` as shard 11
(`lane: visual`, `profile: small_phone`) with its own AVD cache key; the job env reads the
device from the row, every other row stays on `medium_phone`. Suite discovery and the member
shards never list the flow (`scripts/lib/native-maestro-flows.mjs` `VISUAL_MAESTRO_FLOWS`);
`resolve-maestro-shard.mjs --lane visual` lists only it.

Maestro cannot run adb, and a second Maestro invocation would restart the stack
`run-maestro.mjs` owns. So the runner hosts a loopback endpoint
(`scripts/lib/device-appearance-endpoint.mjs`, `MAESTRO_APPEARANCE_URL`) and the flow posts to it
from `runScript` (`maestro/subflows/set-system-appearance.js`): `cmd uimode night yes|no` and
SystemUI demo mode (12:00 clock, full battery, no notification icons). The flow shoots the four
tabs in light, flips the system to dark with the app open, and shoots them again, so the dark
half also proves the live flip (R9). `onFlowComplete` puts the device back.

| ID                | Snapshot                                      |
| ----------------- | --------------------------------------------- |
| 7.9-NVIS-001..004 | Home, Wardrobe, Community, Profile tab, light |
| 7.9-NVIS-005..008 | Same four, dark                               |

Each tab waits for its top bar title (`id: app-top-bar-title` with the tab label; Android reports the title beside `app-top-bar`, so `childOf` cannot match) and the gate to open, then
`takeScreenshot` into `maestro/artifacts/shell-visual/`. The flow never compares: the visual row's
next step, `node scripts/visual-baselines/compare-native.mjs`, compares all eight captures with
`maestro/snapshots/shell-visual/<scheme>-<tab>.png` (channel tolerance 16, at most 1% of pixels
changed), names every missing capture, missing baseline, size change and pixel change in one run,
and writes `<name>-diff.png` beside each changed capture (Codex P1-1). Text that changes every run by design (the run-maestro member email on Profile, the seeded spotlight alias on Community) is ignored through committed rectangles in `maestro/snapshots/shell-visual/masks.json`, each with its reason (7.9-NVIS-U14b). Baselines:
`npm run visual:pull-baselines -- --native <run-id>` from the visual shard's artifact. iPhone SE stays on the nightly and
manual iOS lanes without pixel baselines: 360 x 640 dp is the smallest supported phone (D11).

### CI plumbing unit tests (TEA)

| ID                     | File                                               | What it proves                                                                                                                        |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 7.9-NVIS-U01..U04, U14 | `scripts/lib/device-appearance-endpoint.test.mjs`  | Fixed adb commands only, named device only, 400/404/405/413/500/502, the server survives bad input (Codex P3-3)                       |
| 7.9-NVIS-U05..U10      | `scripts/ci/maestro-visual-lane.test.mjs`          | Flow kept out of the suite, `--lane visual`, the shard 11 row, device and cache key                                                   |
| 7.9-VIS-U01..U04       | `scripts/visual-baselines/pull.test.mjs`           | Actual to baseline names, folder filter, workflows export what the script reads, a short set is named and nothing copied (Codex P1-1) |
| 7.9-NVIS-U11..U13      | `scripts/visual-baselines/compare-native.test.mjs` | Noise tolerance, all eight reported in one run with diffs, flow capture-only, compare step before the upload                          |

`scripts/ci/maestro-signed-out-lane.test.mjs` and `scripts/lib/native-maestro-flows.test.mjs`
count the visual row and flow separately.

### Existing tests touched by the restyle (TEA updates in this PR)

Rule: a replaced or loosened assertion goes to Codex before merge; a selector or value moved to
the new token is a straight update. None below loosens a check.

| Spec                                                                                                                                                                     | Change                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chip-navigation-bottom-nav.spec.ts`                                                                                                                                     | Focus ring read from the tokens (`focusEssential` outline, `focus` halo, now `#9A7A2A` in light); desktop Home link is `primary-nav` > `nav-ritual`; Community h1 is in `app-header`                                                                                                  |
| `community-jade-signed-out.spec.ts`                                                                                                                                      | Community h1 is in `app-header`, above `community-page`                                                                                                                                                                                                                               |
| `sign-in-doors-locale.spec.ts`                                                                                                                                           | /signup h1 is the top bar title (`Créer le compte`); the age-check heading is an h2, still French                                                                                                                                                                                     |
| `wardrobe-smart-tagging`, `wardrobe-garment-capture`, `wardrobe-onboarding-flow`, `wardrobe-session-reload.prod`                                                         | h1 `Wardrobe Hub` becomes the top bar title `Wardrobe` (D6)                                                                                                                                                                                                                           |
| `moderation-console`, `moderation-sla`, `moderation-decisions`                                                                                                           | Case title `Post case` / `Comment case` is an h2; the top bar holds `Case review`                                                                                                                                                                                                     |
| `mobile-viewport-overflow.spec.ts`                                                                                                                                       | TEA P4 layout read from `wardrobe-actions` in the body, plus a check the actions are not in the bar                                                                                                                                                                                   |
| `maestro/garment-detail-tag-edit-flow.yaml`                                                                                                                              | Back is the top bar's `app-top-bar-back` (the in-body `garment-detail-back` is gone, D6)                                                                                                                                                                                              |
| `wardrobe-garment-detail`, `moderation-console`, `moderation-decisions`, `moderation-sla` (Codex P2-5)                                                                   | Back is the top bar `app-top-bar-back`; destination, keyboard, focus, history and scroll restore kept; tab order now includes the bar                                                                                                                                                 |
| `maestro/garment-capsule-repair-flow.yaml`, `subflows/open-app.yaml`, `subflows/open-settings.yaml`, `story65/open-app.yaml`, `story67/teaser-signout.yaml` (Codex P2-6) | iOS `BackButton` becomes `app-top-bar-back` with a destination wait; Android system back only where no top bar Back                                                                                                                                                                   |
| `community-dark-mode`, `community-reactions`, `accessibility-hardening`, `commerce-affiliate-preferences`, `helpers/painted-contrast.ts` (Codex P2-7)                    | Surfaces read from `data-surface`; palette cards dark in dark mode (D5) at 4.5:1; focus outline `focusEssential` at 3:1 on its real backdrop plus a painted ring; desktop tab order through the top bar. Replaced expected colours only (retired by D2, D3, D5); no threshold lowered |
| `app-shell-visual-system.spec.ts` 7.9-E2E-008                                                                                                                            | Three palettes x two schemes: Community cards and planner carry the scheme's palette `cardBg` (computed and painted), text contrast passes                                                                                                                                            |
| `lookbook-prism.spec.ts`                                                                                                                                                 | Lookbook width at 1440 is the D7 shared main column (1152 px less 16 px gutters = 1120), builder decision 2026-11-26; no-overflow and even-column checks kept                                                                                                                         |
| `wardrobe-garment-capture.spec.ts`                                                                                                                                       | Signs a local fixture member in and runs `@local-lane`: capture is a member action after add-on B; the visitor path is 7.9-E2E-012                                                                                                                                                    |
| `signed-in-landing-real-session.spec.ts` L-9                                                                                                                             | Strict case waits for `/privacy` to settle: the top bar Back link prefetches `/`, and WebKit reported the cancelled fetch                                                                                                                                                             |
| `maestro/guest-preview-conversion.yaml`, `palette-advisor.yaml`, `premium-planner.yaml`, `subflows/shell-visual-tab.yaml`                                                | Submit by `signup-submit` (the top bar title also reads Create account); titles by `app-top-bar-title` (Android reports the title beside `app-top-bar`)                                                                                                                               |
| `guest-preview.spec.ts`                                                                                                                                                  | Unchanged on purpose: its above-the-fold checks are product rules; a red there is a layout fix                                                                                                                                                                                        |

## Ownership

- Builder: tokens, apps, guard script and its clean run, unit and component tests UNIT and CMP
  and NAT, locale specs, existing unit tests that pin old classes.
- TEA: this plan, GRD mutation cases, every E2E, VIS and NVIS test, the baseline dispatch path,
  the small-phone shard row, existing Playwright and Maestro specs that break, every red or flaky
  CI check.

## Exit criteria

- Every ID above green in CI on the head SHA; baselines committed from CI.
- Guard passes on the branch and its mutation cases fail as listed.
- CC-7.7 layout-shift spec unchanged and green.
