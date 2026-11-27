---
title: 'Story CC-7.18: Find mini skirts, tights and socks'
type: bugfix
ticket: '7-18-find-mini-skirts-tights-socks'
created: '2026-11-27'
status: in-review
baseline_revision: '39bf6515fc0da0bf4c9a87b50c6353d7574fd342'
route: full
route_source: pinned
risk: medium
review: thorough
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/test-artifacts/test-design-7-18-find-mini-skirts-tights-socks.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

Give members a direct path from Today to browse, preview and use the mini skirt, tights and
socks in a sample look. Keep the exact composition when the member reopens the saved look.

## Boundaries and decisions

- Use the bundled catalog, existing weather and collection settings, and account save flow.
  All examples includes both existing collections and asks the member for no personal information.
- When the current look has the right slot, swap that slot and keep the rest of the look.
  If it lacks the slot, choosing the piece opens an eligible look that can use it.
  Prefer a look that already features the piece, such as Mini skirt and tights.
- The current piece uses one of the 12 visible rows. Exact weather matches precede nearby fits
  among alternatives. Group by the sample garment's visible type within each weather tier.
- The age gate, guardian consent and account save permissions apply as before. CC-7.19 owns
  persisted garment subtypes and CC-7.21 owns guest-to-member account timing.

</frozen-after-approval>

## Baseline

The phone pilot on `5862e9cf` records a tester who could not find a mini skirt or preview and
save their sample looks. The tester did not check hosiery.
[First-use phone study](../test-artifacts/first-use-phone-study.md)

At the current baseline, Today exposes only swaps for the current outfit's slots. The member
editor has weather controls and no catalog browser. The web guest swap uses a checked radio's
change event, which does not fire when the member chooses that piece again.

## Code map

- `packages/utils/src/sample-wardrobe/selector.ts` defines fit and collection eligibility.
  `member-outfit.ts` selects the member's current look. `saved-looks.ts` already serializes its
  base look, weather and swaps for account reopening.
- `apps/web/src/app/components/home-ritual.tsx` and
  `apps/mobile/src/features/preview/member-sample-outfit.tsx` own Today sample editor state.
  Each can reuse its guest illustration and detail flow for browsing.
- `guest-preview-swap-dialog.tsx`, `guest-preview-parts.tsx` and both `today-outfit-picture.tsx`
  implementations own the existing swap sheets.

## Tasks and acceptance

- [x] Add shared sample navigation and display grouping in `packages/utils/src/sample-wardrobe/`.
- [x] Mount the picker in both Today sample editors and localize its type choices and pagination.
- [x] Apply the shared ordering and limit on web and native with scroll and focus handling.
- [x] Add TEA coverage for the account journey and sheet limits. Link the tests from Step 75.

1. Given a member on Today with All examples and Cool or Mild weather, when they open the sample
   closet, they can find and preview a mini skirt, tights or socks and use it in the look.
   When they save and reopen it from Looks, the preview contains the same pieces.
2. Given a sample swap sheet with more than 12 choices, when it opens, the current choice is
   marked and only 12 rows are visible. Alternatives are grouped by type with exact weather fits
   first. Show more reveals the remaining choices. Choosing the current row returns to the
   outfit with the existing selection and undo history.

## Implementation notes

- Keep `home-edit-sample` and add `guest-preview-browse-wardrobe` in the editor. Reuse the
  wardrobe detail and use-item IDs. Append `skirt`, `tights` and `socks` type controls with IDs
  `guest-preview-category-skirts`, `guest-preview-category-tights`, and
  `guest-preview-category-socks`. Keep the editor's existing weather control as the source.
- Retain existing swap option IDs and add `guest-preview-swap-show-more` and
  `today-outfit-swap-show-more`. Today picture option 0 remains the current one. Group the sample
  picture swaps and the editor and guest sample swap. The live outfit keeps its current behavior.
- Use localized labels in all ten shared locales. Keep the grouped sample rows scrollable,
  restore focus when closing, and reset expansion on every open. Preserve a readable current row
  when the sample has zero alternatives. Skip save, swap feedback and undo on a same-piece choice.
- The shared worktree belongs to builder and TEA. Implement production code only. TEA writes
  tests and owns regressions there. The builder stages commits and publishes. No local unit, API,
  Playwright, native or lane suites run. Type checks and lint on touched files are permitted.
- The web picker uses the shared full-height Back layer. Native returns focus to Browse sample
  closet when its inline picker closes. Both reuse the illustrated piece details.

## Plan change log

## Review triage log

## Verification

- Use the tracked TEA acceptance plan and verify all workflows on the PR head with `gh pr checks`.
- In the shared worktree run touched-workspace type checks, formatting, and artifact lint.
