---
title: 'Story CC-7.30: Style this piece with my own garments'
type: feature
ticket: '7-30-style-this-piece-my-own-garments'
created: '2026-11-28'
status: in-review
baseline_revision: '8e9b2d07574c77172e635c3a4ad57ca7a451289c'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/test-artifacts/test-design-7-30-style-this-piece-my-own-garments.md'
---

<frozen-after-approval>

## Intent

Style this piece keeps the selected garment pinned and fills each outfit with compatible closet
garments first. Members get school, weekend and going-out ideas for the weather they select.
They can save and reopen the exact outfit through the CC-7.2 account flow.

## Boundaries and constraints

- The existing owner-scoped inventory provides active, ready garments with category and comfort
  tags. Use the established weather policy and keep the anchor out of the companion pool.
- Owned garments can fill a slot without a usable photo. Display a localized placeholder and keep
  the item eligible to save. Keep signed URLs in the active owner session and out of saved payloads.
- Use catalog outerwear when weather policy requires rain or wind protection. Owned tags cannot
  establish those properties.
- Keep the garment detail entry, account save, guardian checks, idempotency, and existing
  missing-garment and needs-review states. This story performs local selection on web and native.
- Wear logging, closet insights, trip planning and photo processing belong to other stories.

## I/O and edge cases

| Closet or saved state                             | Expected behavior                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Empty closet                                      | Keep the Closet empty state. Styling starts from an eligible anchor.                                 |
| Anchor only                                       | Fill companion slots from the weather-compatible catalog.                                            |
| Sparse or populated closet                        | Use matching owned pieces first. Fill each remaining slot from the catalog.                          |
| Companion photo unsigned, expired or failed       | Keep the garment and show the photo placeholder.                                                     |
| Saved mixed outfit                                | Reopen the stored order, kinds and IDs despite later inventory additions.                            |
| Companion deleted, held, retagged or inaccessible | Apply the existing missing-piece or needs-review state. Clear photo access for unavailable garments. |
| Different member or permission revoked            | Clear the inventory view and refuse unauthorized owned references.                                   |

</frozen-after-approval>

## Code map

- `packages/utils/src/sample-wardrobe/style-one-piece.ts` owns weather, companion ranking, recipe
  application, and the live inventory refresh. Extend it without changing guest sample behavior.
- `packages/utils/src/sample-wardrobe/saved-looks.ts` builds payloads and checks exact recipes.
  Save owned slots with their stable IDs and reconstruct the editor from the stored composition.
- The web and native `style-piece-panel.tsx` files render owned photos, placeholders, occasion
  headings and swap choices. Both saved-look detail entry points use the shared reopen check.
- `apps/api/src/modules/wardrobe/wardrobe-saved-look.service.ts` already resolves and signs owned
  slots. Extend write checks to cover Style this piece companions using current garment tags.

## Tasks and acceptance

- [x] Add owned companion selection and occasion ideas within the existing weather rules.
- [x] Render the same behavior on web and native using the owner-scoped refresh lifecycle.
- [x] Save and reopen exact mixed compositions with the existing API and storage.
- [ ] Verify the acceptance plan with TEA and link Step 87 from the test files.
- [ ] Complete the full peer review with Codex Security and resolve findings.

- Given a compatible anchor and owned companion, when the member opens styling or swaps that
  slot, then the owned piece leads and any unfilled slot has a catalog suggestion.
- Given selected weather suitable for the anchor, when the ideas load, then they cover school,
  weekend and going out using weather-compatible pieces.
- Given a mixed outfit, when the member saves and reopens it from their account, then the
  editor restores the same slot order and item IDs without substituting newly added garments.

## Implementation notes

The brief delegates routine design decisions and authorizes the builder to continue through CI.
The existing API supports garment and catalog slots in the same composition. Reuse that contract.

## Plan change log

## Review triage log

## Verification

Use the Epic 7 CI workflows and the companion acceptance plan. Locally check types, formatting,
lint and the diff. The story is ready when every PR workflow passes at the same head.
