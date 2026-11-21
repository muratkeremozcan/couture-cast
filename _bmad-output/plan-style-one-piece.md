---
title: 'Style one piece from your wardrobe'
type: feature
ticket: ''
created: '2026-11-21'
status: built
baseline_revision: '16085db1544a47b385e5608eb7114eb842bb49a7'
route: full
route_source: auto
risk: medium
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 0
context: [_bmad-output/project-context.md, AGENTS.md]
---

<frozen-after-approval reason="human-owned intent">

## Intent

Members can already photograph their clothes and browse sample outfits. Let a member start
with one photographed piece and immediately see several styled looks built around that piece.
Jade's examples showed a real closet alongside generated ideas for multiple ways to wear one item.

## Boundaries and constraints

Use CoutureCast's original UI and sample clothes. Keep the member's exact garment pinned, use
local recommendation rules, and mark the other pieces as examples. Label the selected weather as
an example and offer changes without requiring a city. The private photo is read from the existing
wardrobe inventory. Store only recipe IDs and weather on the device under the owning account.
The feature needs no new service, permissions, entitlement, uploads, or publishing actions.

## Input and edge-case matrix

| Scenario             | Input                                                                               | Behavior                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Start                | Ready garment with category, comfort tag, and authorized photo                      | Offer Style this piece on the item. Show up to three distinct complete looks using the same photo as the anchor.                            |
| Revise               | Weather change or another compatible piece                                          | Refresh suggestions or replace an example piece. Keep the same anchor.                                                                      |
| Unsuitable           | Anchor fails the selected weather or has unknown protection for wet/windy outerwear | Show a helpful message and allow different weather or return to Wardrobe.                                                                   |
| Saved looks          | Save an edited suggestion and reopen it                                             | Restore weather and valid swaps for that garment on this device, with removal.                                                              |
| Account/state change | Switch accounts, deleted garment, expired photo, invalid stored reference           | Use only current authorized inventory and available compatible sample recipes. Keep private photos and saved recipes fenced to their owner. |

</frozen-after-approval>

## Code map

- `apps/web/src/app/wardrobe/page.tsx` keys `WardrobeHubView` by verified `owner` and already
  checks account before applying inventory. Add the entry and selected item to this boundary.
- `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx` keys `MemberWardrobeHub` by auth epoch.
  `mobileApplicationUserId` is the storage owner. Reuse the inventory list and auth epoch fence.
- `packages/utils/src/sample-wardrobe/{selector,catalog,bookmarks,format}.ts` own sample climate
  eligibility, ranked swaps, bounded recipe validation and translated display content.
- `GarmentItemContract` has `category`, `comfortRange`, `status`, `retentionStatus`, and an
  expiring `imageAccess` object. There is no weather protection tag on member outerwear.
- `apps/web/src/app/components/guest-preview/` and `apps/mobile/src/features/preview/` render sample
  art and weather labels. Follow each app's accessible modal and focus restoration patterns.

## Tasks and acceptance

- [x] Add `packages/utils/src/sample-wardrobe/style-one-piece.ts`, export it, and test shared
      eligibility, distinctness, companion swaps, and bounded saved-look recipes. Use existing comfort,
      sample look and swap rules. Replace a matching slot, or build around an eligible anchor category
      with structurally compatible core garments. Keep required sample protection intact. Skip duplicate
      outfits after substitution. Validate stored IDs against the catalog and current eligible recipe.
- [x] Add accessible wardrobes panels in `apps/web/src/app/wardrobe/` and
      `apps/mobile/src/features/wardrobe/`. Use the live owner and current wardrobe item for reopening,
      conditional rendering, and only account-scoped local storage. Reuse project-owned sample art.
      Supply localized action, weather, error, and sample copy for all current locales.
- [x] BMad TEA peer owns phone browser acceptance and focused native coverage. Antigravity and
      Codex Security review the exact change before PR completion.

**Acceptance criteria**

- Given one tagged private upper-body garment, when the owner taps Style this piece, then the phone
  shows three distinct editable ideas and clearly labels the owner photo and sample companions.
- Given an edited look, when its owner saves, reloads, and reopens the same piece, then the same
  approved recipe and weather reopen. Switching accounts removes the prior panel and saved looks.

## Implementation notes

Web and native Wardrobe offer three ideas when enough distinct compatible looks are available.
The selected personal photo stays pinned. Suggestions use checked-in example garments and the
shared weather rules. Storage keeps account-scoped recipe IDs and example weather on the device.

The active panel revalidates its garment on open, foreground resume, save and reopen. It also
refreshes once per minute while visible. Renewed photo URLs preserve the draft. A missing garment
removes the preview and prevents stale actions.

## Plan change log

## Review triage log

| Reviewer    | Finding                                                       | Verdict | Resolution evidence                                                                        |
| ----------- | ------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| Antigravity | A duplicate swap removed the card under edit                  | Medium  | Keep the latest edited card during deduplication and restore its picker focus.             |
| Antigravity | One native modal left its underlying screen exposed           | Medium  | Apply shared background accessibility rules to both modals.                                |
| Antigravity | A failed or expired photo dropped web dialog focus            | Medium  | Focus the unavailable message inside the dialog and keep Tab inside.                       |
| BMad        | A deleted garment could outlive the current inventory listing | Medium  | Recheck on open, foreground, save, and reopen. Periodically recheck only while visible.    |
| BMad        | Missing or failed photos could not recover                    | Medium  | Refresh through the current wardrobe inventory.                                            |
| BMad        | Native photo errors could drop accessibility focus            | Medium  | Focus Close as the unavailable state appears and restore the garment trigger at dismissal. |
| BMad        | Background tagging could present over styling                 | Medium  | Queue tagging until the style modal has finished dismissing.                               |
| BMad        | Two web tabs could overwrite saved recipes                    | Medium  | Serialize per-garment storage updates with Web Locks when supported.                       |
| BMad        | Account isolation fixtures used different garment IDs         | Low     | Use two account-specific photos with the same garment ID.                                  |
| BMad        | Native test did not exercise its file adapter                 | Medium  | Exercise the Expo file adapter path with synthetic file data in the component harness.     |
| BMad        | Duplicate photo expiry scheduling                             | Low     | Share owned garment lookup, loading lifecycle, and timer cleanup.                          |
| Antigravity | A renewed URL could keep the old image error                  | Low     | Associate failures with the failed URL and ignore late errors from older URLs.             |

## Verification

- Run shared sample wardrobe tests and the relevant web and native Wardrobe component suites.
- Run the BMad TEA phone Playwright and native coverage against the stacked worktree's product code.
- Run web and mobile workspace verification and review the final diff.

BMad TEA passed 18 phone browser scenarios. Web coverage passed all 2,619 tests and
95.15% statements. Native coverage passed all 2,386 tests and 93.07% functions. The new
shared policy and its locale selector have 100% coverage in each measured dimension.
Codex Security reviewed the shipped code shape and found no actionable issues. The native
file path was exercised with a file adapter stub.
