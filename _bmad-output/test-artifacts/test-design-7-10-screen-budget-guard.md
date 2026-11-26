# Test design: Story CC-7.10 screen budget guard

Updated: 2026-11-26. Initial plan from spec-7-10 (in-progress, baseline 6d8b1db3) with TEA
pushback P1-P10 accepted by the builder (spec Plan Change Log, amends D3-D7).

Updated: 2026-11-26. First CI runs (a0f4d24b, 2c27e80e): pw-e2e on four shards (one of three ran
past 20 minutes with the new specs, which have no duration history on a PR); the probe ends a
control's window at its first effect; the native probe reads requests at fetch (the browser MSW
shim has no lifecycle events) and holds real anchors as navigation; native `tileSelectors` gain
`garment-tile-*` (Today outfit tiles); the native Community fixture signs images for an hour (a
2099 expiry overflows the card's refresh timer and loops).

Status: active

## Scope

Spec: `_bmad-output/implementation-artifacts/spec-7-10-screen-budget-guard.md`.
Acceptance criteria from epics.md CC-7.10:

1. An automated check loads each tab at 390 x 844 with empty, populated and guardian-pending
   fixtures on web, and the matching native screens.
2. It fails on more than one primary button, more than seven interactive targets above the fold
   (excluding the tab bar and garment or look tiles), more than one chip row, a card inside a card,
   a paragraph over two lines, Today over 1,688 px, or chrome above the Closet grid over 160 px.
3. It fails on any Home or Today control whose only effect is an analytics event.
4. It runs in the PR gate within the CI time budget. Raising a limit needs a recorded owner
   decision in the story file.

Plus spec decisions D1 to D8 and pushback P1 to P10.

## What the guard is, as tested

- `screen-budget-measure.ts`: one self-contained browser function. It reads computed styles and
  layout, never class names, and returns every D3 measure with the offending elements.
- `screen-budget.ts`: `evaluateScreenBudget(measured, limits, known)`, pure, returns violations
  and ratchet failures with screen, fixture, rule, value and element in each message.
- `screen-budget.json`: limits (the AC values), `tileSelectors`, per-platform Today and Closet
  selectors, the analytics request allow list, and the `known` ratchet.
- `scripts/check-screen-budget-decisions.mjs`: limits and `known` changes need a decision id in
  the owning story's spec.

## Risk assessment

| ID  | Risk                                                                              | P   | I   | Score | Mitigation (tests)                                  |
| --- | --------------------------------------------------------------------------------- | --- | --- | ----- | --------------------------------------------------- |
| R1  | Vacuous guard: a token or selector mismatch measures zero and passes forever      | 3   | 3   | 9     | RULE-001..030 negative controls, E2E positive floor |
| R2  | Analytics probe counts unrelated DOM churn as an effect and never flags a control | 3   | 3   | 9     | RULE-040..047, known analytics entries must repro   |
| R3  | Permanent false failure (reaction rows, captions, off-screen chips)               | 3   | 2   | 6     | RULE-012, RULE-013, RULE-021 (P1, P2)               |
| R4  | Nondeterministic measures (fonts, clock, late reads) flake the gate               | 3   | 2   | 6     | fixed clock, fonts.ready, gate open, burn-in        |
| R5  | Limit raised or `known` entry added without a decision                            | 2   | 3   | 6     | DEC-001..008 (builder), TEA review                  |
| R6  | Ratchet bypass: one element fixed, another added at the same count                | 2   | 2   | 4     | UNIT-006, UNIT-007 (P7)                             |
| R7  | Guard runs past the 20-minute CI budget                                           | 2   | 2   | 4     | three web files (P10), measured shard times         |
| R8  | react-native-web differs from device in line breaking and height                  | 2   | 2   | 4     | accepted risk (P9); same components and tokens      |
| R9  | Browser-only measure drops utils node coverage under its thresholds               | 3   | 1   | 3     | P8 split, measure covered by RULE spec              |
| R10 | guardian-pending fixture differs from what the API answers a pending teen         | 2   | 2   | 4     | fixture bodies parsed through api-client schemas    |

## Test levels

| Level                   | File                                                                                                                                                                                                 | Owner   | Runs in                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------ |
| Unit, node              | `packages/utils/src/screen-budget.test.ts`                                                                                                                                                           | TEA     | utils vitest (coverage gate)   |
| Rule, real browser      | `playwright/tests/screen-budget-rules.spec.ts`                                                                                                                                                       | TEA     | pw-e2e smart shards            |
| E2E audit, web          | `playwright/tests/screen-budget.spec.ts`                                                                                                                                                             | TEA     | pw-e2e smart shards            |
| E2E Home probe, web     | `playwright/tests/screen-budget-home-actions.spec.ts`                                                                                                                                                | TEA     | pw-e2e smart shards            |
| Component, native (RNW) | `apps/mobile/src/screens/screen-budget-{home,profile,community}.test.tsx`, `apps/mobile/src/features/wardrobe/screen-budget-closet.test.tsx` (one file per screen: each needs its own `vi.mock` set) | TEA     | mobile vitest browser coverage |
| Script, node --test     | `scripts/check-screen-budget-decisions.test.mjs`                                                                                                                                                     | builder | pr-checks; TEA reviews         |
| Fixtures                | `playwright/support/helpers/shell-fixtures.ts`, `apps/mobile/src/test-utils/msw/screen-budget-fixtures.ts`                                                                                           | TEA     | used by the above              |

The rule spec uses `page.setContent` on synthetic DOM with the app's token CSS variables, so each
rule is proved in a real layout engine without the app. It is the coverage of record for
`screen-budget-measure.ts` (P8).

## Coverage plan

### Unit: evaluate and ratchet (node)

| ID            | Scenario                                                                                                                                                 | AC / D |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.10-UNIT-001 | Every rule at its limit passes; one over fails (targets 7/8, primary 1/2, chip rows 1/2, lines 2/3, Today 1,688/1,689, chrome 160/161, nested cards 0/1) | 2      |
| 7.10-UNIT-002 | Failure message names platform, screen, fixture, rule, value, limit and element                                                                          | 2      |
| 7.10-UNIT-003 | Violation in `known` with the same value passes                                                                                                          | D5     |
| 7.10-UNIT-004 | Value above `known` fails (Home targets 9, known 8)                                                                                                      | D5     |
| 7.10-UNIT-005 | Value below `known` fails with "lower the known value"; at the limit, "delete it"                                                                        | D5, P7 |
| 7.10-UNIT-006 | Per-element rule: a new element key fails even at the known count                                                                                        | P7     |
| 7.10-UNIT-007 | Per-element rule: a known key that no longer reproduces fails                                                                                            | P7     |
| 7.10-UNIT-008 | A `known` entry for a screen or fixture that was not measured fails (stale entry)                                                                        | D5     |
| 7.10-UNIT-009 | Limits file shape: limits equal the AC values, every `known` entry names an owning story in 7.11, 7.13, 7.15, 7.16, 7.17 and a decision id               | D5, D6 |
| 7.10-UNIT-010 | Analytics allow list matches `/ingest/**`, `*.posthog.com`, OTEL paths; an API read does not match                                                       | D4, P6 |

### Rule: measure on synthetic DOM (Chromium)

Each rule gets a passing control and a failing one, so a measure that sees nothing cannot pass.

| ID            | Scenario                                                                                                                                                                     | AC / D |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.10-RULE-001 | Seven targets above the fold count 7; an eighth fails; one at top 844 is below the fold                                                                                      | 2, D3  |
| 7.10-RULE-002 | Targets inside the bottom tab bar and inside each `tileSelectors` match are excluded                                                                                         | 2, D3  |
| 7.10-RULE-003 | A button inside a link counts once; a `label[for]` of an sr-only file input counts as one target                                                                             | D3     |
| 7.10-RULE-004 | Not counted: sr-only skip link, aria-hidden subtree, inert subtree, opacity 0, visibility hidden, clipped by an overflow ancestor, off to the right of a horizontal scroller | P3     |
| 7.10-RULE-005 | Disabled and aria-disabled buttons still count                                                                                                                               | P3     |
| 7.10-RULE-006 | Role and tabindex targets: role tab, switch, menuitem, option, `[tabindex=0]` count; `[tabindex=-1]` does not                                                                | D3     |
| 7.10-RULE-010 | One gold primary passes; a second anywhere (below the fold too) fails and names both                                                                                         | 2, D3  |
| 7.10-RULE-011 | Gold resolved from the live CSS variable: change `--color-primary` on `:root` and the new gold is the primary; a near-gold one channel off is not                            | P4     |
| 7.10-RULE-012 | Primary inside a tile still counts                                                                                                                                           | P1     |
| 7.10-RULE-020 | One chip row of aria-pressed pills passes; a second row fails                                                                                                                | 2, D3  |
| 7.10-RULE-021 | Chips wrapped in `li` under one `ul` flex row are one row; a horizontally scrolled row with chips off screen still counts                                                    | P2     |
| 7.10-RULE-022 | Not a chip row: pill CTAs without selection state; a single pill; square tabs (radius under half height)                                                                     | D3     |
| 7.10-RULE-023 | Reaction rows (role group, aria-pressed pills) inside tiles are excluded                                                                                                     | P1     |
| 7.10-RULE-024 | P11: an underline aria-pressed filter row is a chip row; a segment tablist, a vertical stack of toggles and switches or checkboxes are not                                   | 2, P11 |
| 7.10-RULE-025 | P11: two underline filter rows count as two chip rows                                                                                                                        | 2, P11 |
| 7.10-RULE-026 | Codex #7: a wrapping group with one wide chip on line one and two toggles on line two is one row                                                                             | 2      |
| 7.10-RULE-027 | Codex #7: a wrapping group with two chips on each of two lines is two rows                                                                                                   | 2      |
| 7.10-RULE-030 | Card in a card fails; sibling cards pass; a card-coloured input or button is not a card                                                                                      | 2, D3  |
| 7.10-RULE-031 | Card detection: card background, cardMuted background, card shadow each with a radius; under 64 x 64 or radius 0 is not a card                                               | D3, P4 |
| 7.10-RULE-032 | Card in a card inside a tile still fails                                                                                                                                     | P1     |
| 7.10-RULE-040 | Two-line paragraph passes; three lines fail; inline `strong` and `a` stay part of the block                                                                                  | 2, P5  |
| 7.10-RULE-041 | Headings, buttons, labels of controls and tile captions are not paragraphs; line-clamp 2 passes                                                                              | D3, P1 |
| 7.10-RULE-042 | Lines measured after web fonts load (fonts.ready awaited inside the measure)                                                                                                 | P5     |
| 7.10-RULE-050 | Today height from the document scroll height; 1,688 passes, 1,689 fails                                                                                                      | 2      |
| 7.10-RULE-051 | Closet chrome: grid top at 160 passes, 161 fails; empty Add block measured the same; neither present fails as "closet anchor missing"                                        | 2      |

### Rule: analytics-only probe (Chromium, synthetic DOM)

| ID            | Scenario                                                                                                                                                                                                 | AC / D |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.10-RULE-060 | A link whose handler only posts to `/ingest/e` is analytics-only                                                                                                                                         | 3, D4  |
| 7.10-RULE-061 | `href="#"` and `#missing` hash links with no scroll are analytics-only; `#present` that scrolls is an effect                                                                                             | D4     |
| 7.10-RULE-062 | Effects: path or search change, a non-analytics request, a `dialog` or `role=dialog`, focus moved elsewhere, a popup, a download, a DOM change outside the control within 1 s                            | D4, P6 |
| 7.10-RULE-063 | File chooser label: opening the chooser is not an effect; a 1 x 1 PNG with an analytics-only change handler is analytics-only; one that renders a preview is an effect                                   | P6     |
| 7.10-RULE-064 | Background churn (a ticking clock node) without a click is ignored. Known limit: a click that only changes a node that also churns on its own is not attributed to the click                             | P6     |
| 7.10-RULE-065 | A change inside the control only (its own pressed state, label) is not an effect                                                                                                                         | D4     |
| 7.10-RULE-066 | A target not re-found in its fresh load fails with its key                                                                                                                                               | P6     |
| 7.10-RULE-069 | Codex #1: a control below the fold that only captures is analytics-only; the probe scrolls it into view first                                                                                            | D4     |
| 7.10-RULE-070 | Codex #5: an on switch, a checked checkbox and a lone pressed toggle are probed; a checked radio is the current choice                                                                                   | D4     |
| 7.10-RULE-071 | Codex #6: a fresh load resolves the target by the listing rules: no hidden copy, no same-name control of another role                                                                                    | P6     |
| 7.10-RULE-072 | A read alone is no effect; a bare # link below the fold that jumps to the top is analytics-only                                                                                                          | D4     |
| 7.10-RULE-067 | An already selected option (aria-pressed, aria-selected, aria-checked true, aria-current) is not probed; twins keep their positions (CI a45f15a1: the active chip and the current scenario were flagged) | D4     |
| 7.10-RULE-068 | A panel inserted under a parent that churns on its own is still an effect (inserted nodes are new)                                                                                                       | P6     |

Probe scope as built: text entry (fields, text areas, selects, editable regions) is typed into,
not clicked, so it is not probed; a label handing focus to its own control is the click landing,
not an effect; GET requests to a path the page already requested before the click (polls) are
not effects. An option that is already selected is not probed: choosing the current state again
does nothing by design. The web probe is one test per fixture, so the analytics-only limit is judged
per screen (Codex #10); about 80 s a fixture once the baseline passes (CI 61701d25). A read
alone (GET or HEAD) is no effect: polls and link prefetches arrive after any click, and a read
that matters changes the DOM or the URL. A jump to a fragment with no target is no scroll effect.
The probe scrolls a control into view and waits for the scroll to settle before its baseline, and
leaves out controls clipped away by an ancestor.

### E2E audit, web (12 tests)

Each tab under each fixture at 390 x 844, light, en-US, default text size, fixed clock, after the
CC-7.7 gate opens (`screen-placeholder` gone) and `document.fonts.ready`.

| ID                | Scenario                                  | AC / D |
| ----------------- | ----------------------------------------- | ------ |
| 7.10-E2E-001..004 | Home, Closet, Community, Profile, `empty` | 1, 2   |
| 7.10-E2E-005..008 | Same four, `populated`                    | 1, 2   |
| 7.10-E2E-009..012 | Same four, `guardian-pending`             | 1, 2   |

Every audit also asserts a floor so it cannot pass vacuously (R1): at least one target counted
above the fold, the tab bar found and excluded, the Today or Closet anchor found where named, and
at least one primary on the screens whose CC-7.9 one gold action is present (Home, Closet).

| ID           | Scenario                                                                                                                                    | AC / D    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 7.10-E2E-013 | In-app negative control: a second gold button injected into Closet fails naming closet, the fixture, primary-buttons, 2 > 1 and the element | 2, matrix |
| 7.10-E2E-014 | Tiles: populated Closet with 24 garment tiles above the fold counts none of them                                                            | matrix    |

### E2E Home probe, web (3 tests)

| ID                | Scenario                                                                                                                                                                                                                                                                      | AC / D |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.10-E2E-020..022 | Every visible Home target (tab bar excluded), one fresh load each, per fixture; analytics-only controls fail unless `known` for 7.13; the three known actions (Preview outfits, See the planner, Start wardrobe upload) must still be detected or their entries fail as fixed | 3, D4  |

### Native (react-native-web in Chromium, mobile vitest browser)

| ID                | Scenario                                                                                                                                                                                                                 | AC / D |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 7.10-NAT-001..012 | Home, Wardrobe hub, Community, Profile under the three MSW fixtures at 390 x 844 (`setViewport`), same measure, same floors as the web audits except the tab bar (these suites render the screen without the tab layout) | 1, 2   |
| 7.10-NAT-013..015 | Home probe per fixture: presses with the router mock and MSW; effect = router call, non-analytics request, DOM change outside the control                                                                                | 3, D4  |
| 7.10-NAT-016      | Product fix found by the fixture: a Community image signed past setTimeout's 32-bit limit stays on screen and arms no refresh (community-card.test.tsx)                                                                  | D1     |
| 7.10-UNIT-013     | Same class on web: moderation case media whose link expires past the timer limit stays on screen (moderation-case-media.test.tsx)                                                                                        | D1     |

### Decisions check (builder, TEA reviews)

| ID           | Scenario                                                                      | AC / D |
| ------------ | ----------------------------------------------------------------------------- | ------ |
| 7.10-DEC-001 | Limits equal to the AC values and no `known` change: pass                     | 4      |
| 7.10-DEC-002 | A limit raised without a decision id: fail                                    | 4, D6  |
| 7.10-DEC-003 | A limit raised with an id missing from the named story spec section: fail     | 4, D6  |
| 7.10-DEC-004 | A limit raised with the id under `## Screen budget decisions`: pass           | 4, D6  |
| 7.10-DEC-005 | A new `known` entry or a raised known value without a recorded decision: fail | D6     |
| 7.10-DEC-006 | A `known` value lowered or an entry deleted: pass with no decision            | P7     |
| 7.10-DEC-007 | A limit lowered (stricter): pass with no decision                             | D6     |
| 7.10-DEC-008 | Missing story spec file for the named story: fail with its path               | D6     |

## Fixtures

- `guardian-pending` (web `ShellMode`, native MSW): profile role `teen`, birthdate 14 years before
  the fixed clock, one linked guardian with consent `pending`, compliance accountStatus
  `pending_guardian_consent`, empty closet and onboarding `not_started`, no subscription. Under the
  production policy `off` every signed-in read answers as for an active teen
  (`teenAccessBlocked(prefs, 'off')` is false), so the other reads match `empty`. Bodies are parsed
  through the api-client schemas (R10).
- Fixed clock `FIXED_NOW`, inline images, Community socket closed, as in CC-7.9.

## Determinism and CI

- No `waitForTimeout`; waits are on the gate opening, fixture reads served and `fonts.ready`.
- Measures read once per load; the probe uses one fresh load per target.
- Burn-in runs the new files on the PR as usual; flakes go to TEA in this PR.
- Shard times are read from the PR run; if any shard nears 20 minutes, the probe splits per fixture
  into separate files.

## Baseline (`known`)

The first `known` list comes from a `workflow_dispatch` run of this branch (no local suites). TEA
reads every violation in the run output, checks each against the epic story that removes it, and
hands the list to the builder with story and decision `D-KNOWN-7.10`. A violation no epic story
removes is a product bug in this story, not a `known` entry.
