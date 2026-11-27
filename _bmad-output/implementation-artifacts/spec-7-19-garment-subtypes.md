---
title: 'Story CC-7.19: Garment subtypes'
type: feature
ticket: '7-19-garment-subtypes'
created: '2026-11-27'
status: done
baseline_revision: '213cc386512a243d90ecd849ee81ce8a6b4dd25c'
route: full
route_source: pinned
risk: medium
review: thorough
review_source: pinned
lenses_ran: [independent-full-review, codex-security-diff]
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/test-artifacts/test-design-7-19-garment-subtypes.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

Let a member name a piece precisely and use that subtype when finding garments and building looks.

## Boundaries and decisions

- Keep the six existing categories. The optional subtypes are mini, midi and maxi skirts and
  leggings under Bottom, tights and socks under Accessory, camisole, tank and crop top under
  Top, moto, ankle and knee boots under Shoes, and blazer and moto jacket under Outerwear.
- A member chooses the subtype during tagging or edit. Existing rows start unset. Keep the
  current photo, ownership and guardian rules. CC-7.27 owns changes to automatic tag suggestions.
- The live Today swap sheet keeps the current choice visible and puts eligible owned alternatives
  ahead of samples, with matching subtypes preferred within each source. The sample editor uses
  the bundled catalog. CC-7.30 owns adding member garments to Style this piece companions.
- Weather fit comes first in generation. Use matching look subtypes and weather-appropriate
  subtype preferences where available. Keep category fallback for a closet with older pieces.

</frozen-after-approval>

## Code map

- `packages/utils/src/sample-wardrobe/` owns catalog, localized names and weather selection.
  Share the subtype taxonomy with the wardrobe contract, filters and live Today swaps.
- `packages/db/prisma/`, the wardrobe contract and the wardrobe service own storage and
  validation. Apply subtype inside the existing guarded tag update and optimistic comparison.
- `apps/{web,mobile}/src/` owns the tagging form, garment detail, Closet filtering and Today
  picture. Reuse the category picker interaction and the existing list and tag PATCH calls.
- `ritual-generation.engine.ts` owns member generation and the weather match ladder.

## Tasks and acceptance

- [x] Add the shared category-scoped subtype vocabulary and names in all ten locales.
- [x] Add a nullable column, preserve strict HTTP clients with an independent header opt-in,
      and regenerate the published HTTP contract and SDK.
- [x] Extend tag confirmation, tag edit, and the Closet category filters on web and mobile.
- [x] Add subtype examples to complete looks, preserve weather eligibility, and rank swaps and
      generated looks by subtype.
- [x] Link the TEA acceptance tests from Step 76.

1. Given All examples, when selecting a supported weather preset, the catalog provides complete
   weather-compatible looks. Across those looks, all listed subtypes are represented.
2. Given an old garment, when it loads, the category remains and subtype is unset. A member can
   save or clear a valid subtype and find the garment with its category and subtype filter after
   reload. Invalid category and subtype pairs are rejected.
3. Given a live swap with compatible owned and catalog choices, the current choice stays marked.
   Eligible owned alternatives appear first. An eligible match for the slot subtype heads each
   alternative group, and category-level alternatives remain available.
4. Given equally weather-suitable candidates, the generator can choose a matching subtype.
   A category-only garment still works as a fallback.

## Implementation notes

- List and tag PATCH return subtype when the client sends `x-couture-garment-subtype: 1`.
  The existing color header is independent. An omitted PATCH subtype preserves a compatible
  stored value. Null clears it. A new category clears an incompatible stored value. An
  explicit incompatible pair returns 400. A stale subtype comparison returns 409.
- Undo explicitly clears a newly set subtype when the previous read omitted the field.
  The comparison still uses the tags returned by the edit.
- Expose `GARMENT_SUBTYPES`, `GARMENT_SUBTYPES_BY_CATEGORY`, `garmentSubtypesForCategory`,
  and `garmentSubtypeStrings(locale)` from utils. The latter returns
  `{ label, none, all, values }`, with `values` keyed by the subtype IDs in the story.
- Use the category's matching subtype options in tag confirmation and detail editing. Stable IDs
  on web and mobile are `garment-detail-subtype-picker`, `garment-detail-subtype-<id>`
  (`none` clears), `garment-detail-subtype` for display, and `closet-subtype-all`
  plus `closet-subtype-<id>` after selecting a Closet category. Retain existing Today option IDs.
- Rank member generator choices within each existing comfort tier. Cold and cool scenarios
  prefer cold-weather boots or layers when eligible. Preserve reshuffle and capsule behavior.
  For Style this piece, use a matching compatible base look as a preference while preserving
  saved recipes and their companion availability.
- The shared worktree belongs to the builder and TEA. Edit production code only. TEA owns tests
  and the acceptance plan. The builder handles Step 76, Git commits, review and publication.
  Do not stage or commit. Do not run local test suites or connect to a database.
  Format and type-check affected packages. Regenerate tool-owned files with the repo commands.

## Plan change log

## Review triage log

The combined review used base `213cc386512a243d90ecd849ee81ce8a6b4dd25c` and head
`ad4c2f23061b239647dbef055e572b6f23f353c5`.
Codex Security found zero issues across 55 source worklist paths and eight supporting paths.
It accounted for 23 documentation and version-comment exclusions.

| Finding | Verdict   | Action                                                                                                                                         |
| ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1    | Confirmed | Update client header assertions and verify older responses.                                                                                    |
| P1-2    | Confirmed | Preserve the member's explicit swaps when opening a look for a different slot. Cover the direct and fallback sock paths.                       |
| P2-1    | Confirmed | Validate subtype and category at the HTTP input. Align optimistic comparison with the normalized read and preserve the published 400 response. |
| P2-2    | Confirmed | Refresh the Style this piece editor when the anchor subtype changes.                                                                           |
| P2-3    | Confirmed | Cover the client contract, tagging choices, Closet filters, swap state and generator weather choices.                                          |
| P3-1    | Confirmed | Announce the localized subtype on mobile swaps.                                                                                                |
| P3-2    | Confirmed | Distinguish subtype filters and clear a filter when the member removes its last matching garment.                                              |
| P3-3    | Confirmed | Link Step 76 to the acceptance tests and close the spec and sprint entry before publishing.                                                    |

## Verification

- Run the touched workspace type checks, formatter, and lint. Use GitHub Actions for the unit,
  API, browser, and native suites.
- Verify every check on the PR head with `gh pr checks`.

[TEA acceptance plan](../test-artifacts/test-design-7-19-garment-subtypes.md)
