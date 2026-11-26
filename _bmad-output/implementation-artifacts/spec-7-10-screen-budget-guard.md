---
title: 'Story CC-7.10: Screen budget guard'
type: feature
ticket: '7-10-screen-budget-guard'
created: '2026-11-26'
status: built
baseline_revision: '6d8b1db383d097bdd91c824245344a2a2d948163'
route: full
route_source: auto
risk: medium
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/spec-7-7-signed-in-shell-without-flashes.md'
  - '_bmad-output/implementation-artifacts/spec-7-9-one-app-shell-visual-system.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Nothing stops a later story from making a screen busy again. CC-7.9 gave every tab
one shell and one token set, but Home still carries three analytics-only actions, a marketing
hero, a chip row and the embedded Community feed (3,701 px at phone width), and no check counts
primary buttons, targets, chip rows, nested cards or long paragraphs on any tab.

**Approach:** One measuring function and one limits file, shared by web and native. Web runs it
in Chromium on each tab at 390 x 844 under empty, populated and guardian-pending fixtures; native
runs it on the same tab screens rendered through react-native-web in the mobile Vitest browser
suite with the same three fixtures. A probe clicks every Home control and fails on any whose only
effect is analytics. The violations the current app already has are recorded as a ratchet: each
names the later Epic 7 story that removes it, the guard fails on any new or larger violation, and
fails when a recorded one no longer reproduces so the story that fixes it must delete it.

## Decisions (owner delegated; recorded here)

- D1 Fixtures. Web reuses `playwright/support/helpers/shell-fixtures.ts` (`empty`, `populated`)
  and adds `guardian-pending`: profile role `teen` with one linked guardian `pending`, an empty
  closet and every other read as the API answers a pending teen under the production policy
  (`off`, `teenAccessBlocked`). Native uses MSW handlers with the same three shapes. Signed-in
  member, en-US, light scheme, default text size.
- D2 Screens. Web: Home `/`, Closet `/wardrobe`, Community `/community`, Profile `/settings`.
  Native: `app/(tabs)/index`, Wardrobe hub, Community, Profile tab. Measured after the CC-7.7
  screen gate opens (`screen-placeholder` gone). Names follow CC-7.11's renames (Today, Closet).
- D3 Rules, as measured (one definition for both platforms, in the shared module):
  - Interactive target: visible `a[href]`, `button`, `input`, `select`, `textarea`, `summary`,
    `[tabindex>=0]` and roles button, link, tab, checkbox, radio, switch, menuitem, option; a
    `label[for]` of a visually hidden control counts as that control; nested targets count once.
    Above the fold: top under 844 px at scroll 0. Excluded: anything inside the bottom tab bar or
    inside a tile (garment, saved look, Community look card) named in the limits file's
    `tileSelectors`. Over 7 fails.
  - Primary button: an interactive target whose computed background color is the `primary` token
    (gold, CC-7.9 D3), anywhere on the screen. Over 1 fails.
  - Chip row: two or more pill-shaped targets (radius at least half the height) that carry a
    selection state (`aria-pressed`, `aria-checked`, `aria-selected`, `aria-current`, or role
    radio, tab or option) and share one parent. Over 1 row fails.
  - Card: a non-interactive element at least 64 x 64 px whose computed background is the `card`
    or `cardMuted` token or that carries the `card` elevation, with a radius. A card with a card
    ancestor fails.
  - Paragraph: a visible non-interactive, non-heading block with its own text; its line count is
    the number of distinct line boxes of that text. Over 2 lines fails.
  - Today height: Home's scroll height (web document, native scroll content) over 1,688 px fails.
  - Closet chrome: the top of the garment grid, or the empty-closet Add block, over 160 px from
    the top of the page at scroll 0 fails.
- D4 Analytics-only (AC3). Each visible Home target (tab bar excluded) is clicked in a fresh
  load per fixture; a file chooser receives a 1 x 1 PNG. An effect is a URL path, search or
  scrolling hash change, a request that is not analytics (PostHog capture, telemetry), a dialog,
  or a DOM change outside the control itself within 1 s. A target with no effect besides
  analytics fails. Native does the same with presses, the router mock and MSW.
- D5 Ratchet. `screen-budget.json` holds the limits (the AC values), `tileSelectors`, the closet
  and Today selectors per platform, and `known` violations: platform, screen, fixture, rule, the
  measured value, the owning story (7.11, 7.13, 7.15, 7.16 or 7.17, per the epic) and a decision
  id. The guard fails on a violation absent from `known`, a value above its `known` value, or a
  `known` entry that no longer reproduces. The initial `known` list is this story's owner
  decision (D-KNOWN-7.10). Product code does not change in this story to clear them: the epic
  assigns each removal to its story.
- D6 Recorded decisions (AC4). `scripts/check-screen-budget-decisions.mjs` (node --test, PR gate)
  fails when a limit differs from the AC values or a `known` entry is added, without a decision
  id that appears in the named story's spec file under `## Screen budget decisions`.
- D7 CI. Web runs in `pr-pw-e2e-local.yml`'s smart-sharded job; native in the mobile Workspace
  coverage shard; both inside the 20-minute budget. No Maestro or device lane is added: the
  Android shards already run at 16.8 min p95 of their 20, and react-native-web renders the same
  components and token colors. The baseline values come from CI (workflow_dispatch on this
  branch), never from local suites.
- D8 Owner decision 2026-11-26: CC-7.8 formal usability studies are dropped. The product owner
  uses her own account and comments after Epic 7 ships; the midpoint and exit study gates no
  longer block any story. Recorded in epics.md CC-7.8 and epic-7-context.md; 7-8 set to done.

## Boundaries & Constraints

**Always:** one shared limits file and measuring function for both platforms; the CC-7.7 shift
budget and CC-7.9 token guard stay green; the guard names the rule, screen, fixture, measured
value and offending element in every failure.

**Never:** removing or moving product content to pass the guard (CC-7.11, CC-7.13, CC-7.15,
CC-7.16, CC-7.17); raising a limit without a recorded decision; local unit, Playwright or native
suites; macOS jobs or new device lanes on PRs.

## I/O & Edge-Case Matrix

| Scenario         | Input / State                               | Expected                                            |
| ---------------- | ------------------------------------------- | --------------------------------------------------- |
| Clean screen     | no violations, none known                   | pass                                                |
| New clutter      | a second gold button added to Closet        | fail naming closet, fixture, primary-buttons, 2 > 1 |
| Known violation  | Home chip row, known for 7.13               | pass                                                |
| Worse than known | Home targets 9, known 8                     | fail                                                |
| Fixed but known  | 7.13 removes the chip row, entry kept       | fail: delete the known entry                        |
| Limit raised     | limits file says 8 targets, no decision     | decisions check fails                               |
| Analytics-only   | Home "Preview outfits" only captures        | fail unless known for 7.13                          |
| Hash link no-op  | `#wardrobe` with no target or scroll change | analytics-only                                      |
| Tiles            | 24 garment tiles above the fold             | not counted as targets                              |
| Guardian-pending | teen, pending guardian, empty closet        | measured like the others; no screen skipped         |

</frozen-after-approval>

## Code Map

- `packages/utils/src/screen-budget.ts` (new) -- self-contained `measureScreenBudget(config)`
  (serializable for `page.evaluate`, no imports inside), `evaluateScreenBudget(measured, limits,
known)`; `packages/utils/src/screen-budget.json` (new) -- D5; export both from the index.
- `packages/utils/src/design-tokens.ts:111-153,245` -- `colorRoles` primary, card, cardMuted and
  `elevation.card`, the values the measure compares computed styles against.
- `playwright/support/helpers/shell-fixtures.ts:32,255-265` -- `ShellMode`, profile body; add
  `guardian-pending` (D1).
- `playwright/tests/signed-in-shell-layout-shift.spec.ts` -- pattern for opening a tab under a
  fixture (`openShell`, `seedWebSession`, `interceptNetworkCall`).
- `playwright/tests/screen-budget.spec.ts` (new, TEA) -- 12 audits plus the Home probe.
- `apps/mobile/src/test-utils/msw/handlers.ts`, `src/test-utils/viewport.ts`,
  `src/screens/home-screen-gate.test.tsx:60`, `profile-tab.test.tsx:57`,
  `src/features/wardrobe/wardrobe-hub-screen.test.tsx:299`, `src/screens/community-screen.test.tsx`
  -- render pattern and MSW; `src/screens/screen-budget.test.tsx` (new, TEA).
- Tile and grid selectors: web `garment-card-*`, Community feed cards, saved-look tiles; native
  `garment-card-*`, `garment-tile-*`, Community cards. Add a testID to the native Home scroll
  content and the closet grids where none exists.
- `scripts/check-screen-budget-decisions.mjs` + `.test.mjs` (new), wired in `pr-checks.yml`
  beside `check-design-tokens.mjs:137`.
- `apps/web/src/app/components/analytics-event-actions.tsx:225-258` -- the three analytics-only
  actions (known, 7.13).

## Tasks & Acceptance

**Execution:**

- [x] Shared module and limits file (builder); unit and rule tests on synthetic DOM (TEA, each
      rule passes at the limit and fails one over) -- D3, D5.
- [x] Decisions check script, node test, PR gate step -- D6.
- [ ] `guardian-pending` fixtures (web shell router, native MSW) -- D1.
- [ ] Web spec and native suite (TEA) -- D2 to D4.
- [ ] Baseline `known` list from a CI dispatch run, each entry with story and decision -- D5.
- [x] epics.md CC-7.8, epic-7-context.md, sprint-status 7-8 done -- D8.
- [ ] Learning path Step 67 (added); sprint-status 7-10 done before the final push (open).

**Acceptance Criteria:**

- Given each tab under each fixture at 390 x 844 on web and native, when the guard runs, then it
  reports every D3 measure and passes only within the limits or the `known` list.
- Given a new primary button, chip row, nested card, long paragraph or target over the limit on
  any tab, then the guard fails naming screen, fixture, rule, value and element.
- Given a Home control whose only effect is analytics and no `known` entry, then the guard fails.
- Given a limit change or new `known` entry without a decision in the named story file, then the
  PR gate fails.

## Implementation Notes

- Working rules: shared worktree with TEA, so no git stash, git checkout -- or git reset, and no
  commits (the builder commits). Do not run unit, API, Playwright or native suites locally; tsc
  per touched workspace, eslint on touched files and the decisions node test only.
- Builder scope: the shared module and limits file, the decisions check and its node test and
  pr-checks step, the native testIDs the selectors need, and the docs (epics.md CC-7.8,
  epic-7-context.md, learning path Step 67). TEA owns every other test file: unit tests of the
  shared module, `guardian-pending` fixtures, `playwright/tests/screen-budget.spec.ts`,
  `apps/mobile/src/screens/screen-budget.test.tsx` and the `known` values from CI. Load the
  bmad-tea skill before creating or editing any test file; do not touch `playwright/`.
- Until TEA fills it from CI, `known` is an empty list.

## Plan Change Log

- 2026-11-26, TEA pushback P1-P10 (7.10-tea-pushback.md), all accepted; these amend D3 to D7:
  - D3 tiles: inside a `tileSelectors` tile, targets, chip rows and paragraphs are not measured
    (CC-7.15 keeps one reaction row per Community card; captions are member content); primary
    buttons and card-in-card still are.
  - D3 chip row: chips group by the nearest common ancestor that is role group, radiogroup,
    tablist or listbox, or a flex or grid container; a rendered row counts even when part of it
    is scrolled out of view.
  - D3 visible target: box intersects the 390 x 844 viewport, not clipped by an overflow
    ancestor, not sr-only (1 px clip, clip-path inset 50%), not inside `aria-hidden="true"` or
    `inert`, visibility visible, opacity above 0. Disabled controls count.
  - D3 tokens: primary, card, cardMuted and the card shadow resolve to computed form through a
    probe element in the same document (live CSS variables on web), never a static hex compare.
  - D3 paragraph: after `document.fonts.ready`, lines are distinct line-box tops (2 px
    tolerance) from `Range.getClientRects` over the block's text, inline children included;
    clamped text counts its rendered lines.
  - D4 probe: a file chooser is judged after `setFiles`; the analytics allow list (same-origin
    `/ingest/**`, `*.posthog.com`, OTEL `/v1/traces|logs|metrics`) lives in `screen-budget.json`;
    mutations seen during a 1 s no-click observation are ignored; focus moving, a popup or new
    page and a download are effects; each target is re-found by testid or role plus name in its
    fresh load, and not finding it fails.
  - D5 ratchet: per-element rules (paragraph, card-in-card) list element keys (testid, else tag
    plus the first 40 characters of text); numeric rules match exactly, and a lower measured value
    fails with "lower the known value". D6: lowering or deleting needs no decision; raising or
    adding does.
  - Module split: `screen-budget-measure.ts` (browser-only measure, excluded from the utils node
    coverage, proved by TEA's `screen-budget-rules.spec.ts` on synthetic DOM) and
    `screen-budget.ts` (evaluate, full node coverage).
  - D7 native: react-native-web uses web fonts and line breaking, so native paragraph lines and
    heights approximate the device. Accepted risk; Maestro lanes stay off per D7. Native viewport
    390 x 844 through the Vitest browser viewport; Today height reads the testID on the Home
    scroll content container.
  - Web files: `screen-budget.spec.ts` (12 audits), `screen-budget-home-actions.spec.ts` (one
    test per fixture), `screen-budget-rules.spec.ts` (synthetic DOM) so smart sharding spreads
    them.
- 2026-11-26, TEA: native splits into one suite per screen (each needs its own `vi.mock` set):
  `apps/mobile/src/screens/screen-budget-{home,profile,community}.test.tsx` and
  `apps/mobile/src/features/wardrobe/screen-budget-closet.test.tsx`, with shared MSW fixtures in
  `apps/mobile/src/test-utils/msw/screen-budget-fixtures.ts`. The native suites render the screen
  without the tab bar, so the tab-bar floor check runs on web only.

- 2026-11-26, builder, as built:
  - D5 shape: `limits` is keyed by rule id (`targets-above-fold`, `primary-buttons`,
    `chip-rows`, `nested-cards`, `paragraph-lines`, `today-height`, `closet-chrome`,
    `analytics-only`); `paragraph-lines` is the line limit and its value is the number of
    paragraphs over it. `measure` holds the viewport and the 64 px card size, pinned by the
    decisions check with no decision path. `platforms`, `screens` (`today`, `closet`,
    `community`, `profile`) and `fixtures` list what a `known` entry may name, so an entry for a
    screen or fixture that is never audited fails the PR gate.
  - D5 known entry: `platform`, `screen`, `fixture`, `rule`, `value`, `elements` (per-element
    rules only: card-in-card, paragraph and analytics-only), `story`, `decision` and
    `decidedIn`, the story whose spec records the decision (`7.10` for `D-KNOWN-7.10`). The
    owning story's spec does not exist yet when its violation is recorded, so the decision lives
    in the deciding story's spec. A raised limit cites a `limitDecisions` entry (`limit`,
    `value` as the highest allowed, `decision`, `decidedIn`).
  - D6: the check compares with the merge base of HEAD and `origin/$GITHUB_BASE_REF` (default
    `origin/main`). An added or raised entry, or a raised limit, must cite a decision id the base
    budget did not already use, so re-citing `D-KNOWN-7.10` cannot raise a value. With no base
    file every entry still needs its recorded decision; an unresolvable base fails in CI.
  - D3 as reviewed by TEA (7.10-tea-measure-review.md): an inner card counts only with its own
    box (more than 1 px off on a side) and its own background, the card shadow or a visible
    border (M1); a gold target inside a gold target counts once (M2); a chip row is two or more
    pills in one row container with at least one selection state (M3).
  - Native Today height reads the `scrollHeight` of `hero-experience-scrollview`, the Home
    ScrollView's existing testID: RN `ScrollView` has no testID prop for its content container,
    and the scroll element's `scrollHeight` is its content height. New anchors: web
    `closet-garment-grid` and `closet-empty-state`, native `wardrobe-empty-state`.
- 2026-11-26, TEA P11 (round 2 baseline, a45f15a1): a chip is a pill with any selection state
  or a toggle filter of any shape (`aria-pressed`, role radio or menuitemradio); tabs,
  `aria-selected` and options count only as pills, so a segment control is not a chip row;
  switches and checkboxes never are chips. A row counts the chips on its first member's visual
  line. Web Community's underline filter row now reads one chip row, as native does.
- 2026-11-26, TEA round 3: react-native-web drops `accessibilityState`, so native selection was
  invisible in the DOM and selected toggles read as analytics-only. Native product code moves
  to the ARIA props React Native supports (`aria-disabled`, `aria-checked`, `aria-expanded`,
  `aria-busy`, `aria-selected` on tabs only); radios carry `aria-checked`; buttons with a
  selected state keep `accessibilityState.selected` for native plus `aria-pressed` for the DOM
  (the filter-chips pattern), since ARIA forbids `aria-selected` on buttons and radios.
  `share-card-composer.tsx` is left as is: its blob SHA is pinned by the Story 6.9 iPad proof.

## Review Triage Log

- 2026-11-26, Codex review (7.10-codex-review.md), builder findings:
  - #2 The decisions check compares every limit with its merge-base value (the AC value when
    the base has no file), so a limit lowered and raised back needs a decision. A decision now
    records term lines that bind rule, scope and ceiling (format under `## Screen budget
decisions`); a cited JSON value outside every term fails, and so does a decision with no
    term line. D-KNOWN-7.10 records the initial baseline as rule and scope tuples with the
    highest CI value per fixture group. Cases 7.10-DEC-009 to 012.
  - #7 Chip rows group each row container's chips by visual line; each line with two or more
    chips, one selectable, is a row. A horizontal scroller stays one row, a vertical stack none.
  - #8 Known `paragraph-lines` entries list `{ key, lines }`; a known paragraph with more lines
    fails as worse, fewer as lower, and a key with no recorded count fails as `lines` naming the
    measured count. The checker counts more lines as an increase and caps them by the term's
    `lines`. The line counts come from CI runs 45826461262 (native) and 45826456240 (web).
  - #10 The decisions test keeps the AC values as a fixture and no longer pins the live limits.
  - #11 Native empty Closet chrome measures the Add control (`garment-capture-open`) while
    `wardrobe-empty-state` renders; the grid stays the populated anchor. Web already measures
    `closet-empty-state`, which holds its Add button.
  - #12 Today height and Closet chrome carry what they measured (`document`, the scroll
    element or the anchor) into `todayHeightElement` and `closetChromeElement`, the verdict's
    elements and its failure messages.
  - #13 The Playwright report reads the matrix's shard count through one YAML anchor
    (`pw-shard-total`), pinned by `scripts/ci/pr-pipeline-shape.test.mjs`.

## Screen budget decisions

A decision binds what it allows with one or more term lines, which
`scripts/check-screen-budget-decisions.mjs` parses: `- <id>: ` then, in backticks,
`rule=<rule> scope=<platform>/<screen>/<fixture> max=<value>` for `known` entries (any scope
segment may be `*`; `paragraph-lines` adds `lines=<most lines per paragraph>`), or
`rule=<rule> scope=limit max=<value>` for a limit. A cited JSON value must be within one term's
rule, scope and max, and every increase against the merge base needs a decision the base did
not already cite.

- D-KNOWN-7.10 (owner delegated, 2026-11-26): the violations measured on this story's head are
  accepted as `known`, each owned by the story the epic assigns its removal to. The ceilings are
  the CI-measured values (per fixture group, the highest):
- D-KNOWN-7.10: `rule=targets-above-fold scope=native/profile/* max=13`
- D-KNOWN-7.10: `rule=targets-above-fold scope=native/today/* max=12`
- D-KNOWN-7.10: `rule=targets-above-fold scope=web/today/* max=9`
- D-KNOWN-7.10: `rule=chip-rows scope=native/profile/* max=6`
- D-KNOWN-7.10: `rule=chip-rows scope=native/today/* max=2`
- D-KNOWN-7.10: `rule=chip-rows scope=web/today/* max=3`
- D-KNOWN-7.10: `rule=closet-chrome scope=native/closet/* max=334`
- D-KNOWN-7.10: `rule=closet-chrome scope=web/closet/* max=476`
- D-KNOWN-7.10: `rule=paragraph-lines scope=native/community/* max=1 lines=3`
- D-KNOWN-7.10: `rule=paragraph-lines scope=native/profile/* max=3 lines=7`
- D-KNOWN-7.10: `rule=paragraph-lines scope=web/profile/* max=4 lines=8`
- D-KNOWN-7.10: `rule=paragraph-lines scope=web/today/* max=1 lines=4`
- D-KNOWN-7.10: `rule=today-height scope=web/today/* max=3825`
- D-KNOWN-7.10: `rule=analytics-only scope=web/today/* max=3` (the three analytics-only Home
  actions the Intent names)

## Design Notes

Computed styles decide primary and card, so the rule follows CC-7.9's tokens and catches a new
button or card without any marker; tiles are the only opt-out, by selector in one reviewed file.
The measure is one self-contained function because Playwright serializes it into the page;
react-native-web renders `testID` as `data-testid` and RN styles as computed CSS, so the native
suite calls the same function on its DOM.

## Verification

**Commands:**

- `npm exec -w packages/utils -- tsc --noEmit`, `npm exec -w apps/mobile -- tsc --noEmit`,
  `npx tsc -p playwright/tsconfig.json --noEmit` -- no errors.
- `npx eslint <touched files>` -- clean.
- `node --test scripts/check-screen-budget-decisions.test.mjs` -- passes.
- CI: screen-budget web spec, native suite and every workflow green for the head SHA.
