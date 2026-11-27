---
title: "Story CC-7.14: Today's outfit as a picture"
type: feature
ticket: '7-14-todays-outfit-as-picture'
created: '2026-11-26'
status: in-review
baseline_revision: 'a519243dbec677047f5f4aefadd9eb6a26d62b2d'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context:
  - 'AGENTS.md'
  - '/Users/murat/opensource/cc/epic7-coord/RULES.md'
---

<frozen-after-approval>

## Intent

Today shows category chips where the member needs to see the outfit. Compose the pieces as one
picture, give the member a short weather reason, and let them swap or save what they see.

## Decisions

1. Use one fixed first-view picture frame with the pieces in their outfit order. Use the member's
   photo when available and a bundled illustration for its category while the photo loads or
   after failure. Keep picture and adjacent control geometry unchanged.
2. Open Swap from any piece. List the current piece first, then compatible pieces in the same
   category from the closet and first-party catalog. Selecting one changes only that slot and
   returns focus to it. Preserve the edit while the same recommendation refreshes.
3. On a live look, Wear this is the only primary action. It saves an ordered snapshot to Looks >
   Saved using the CC-7.2 endpoint and the CC-7.1 button, View, Retry and Undo. Use the date in the
   forecast location's timezone. Another composition can be saved without overwriting a previous
   look. Retain the same idempotency key for a retry of the same attempt.
4. Keep the setup action primary without weather. The labeled sample still opens its existing
   account-backed editor and uses the same picture and per-piece Swap affordance. Approved and
   guardian-pending members can swap and save a catalog look with the same taps.
5. A short localized look name and weather reason sit on the card. The details reveal comfort,
   badges, share, and the eligible CC-5.1 Shop this look disclosure. Suppress recommendation-bound
   share and commerce after an edit changes the outfit, since their server inputs still identify
   the original composition. Preserve cached-commerce suppression.

## Boundaries & Constraints

Keep the CC-7.7 session gate and shift budget and the CC-7.10 first-view, text and target budgets.
Use owner-scoped, guardian-gated photo reads and ephemeral URL handling. Persist stable IDs,
categories, and date, with all photo reads in the member request's scope. All new copy is localized.
Follow the Epic 7 trio rules. TEA owns tests, visual fixtures, snapshots, and CI repairs.

## I/O & Edge-Case Matrix

| Given                                       | When                     | Then                                                                                           |
| ------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| A populated closet and a mixed outfit       | Today opens              | The picture shows the matching private photo and catalog art, with controls and a short reason |
| An empty closet or guardian-pending account | Today opens              | Catalog slots render, open Swap, and save through the same account action                      |
| A missing, expired, delayed or broken photo | The slot draws           | Its illustration fills the reserved slot, and a successful photo replaces it without movement  |
| An eligible affiliate offer                 | The member opens details | Comfort, badge details and the disclosed offer appear together                                 |
| The member edits a slot and wears the look  | The write commits        | Looks opens the exact ordered snapshot, and a lost-response retry reuses the same attempt      |
| A save fails or the account changes         | The response settles     | Current-session feedback keeps the outfit visible and prior-account effects are discarded      |

</frozen-after-approval>

## Code Map

- `apps/web/src/app/components/home-ritual.tsx` and `apps/mobile/app/(tabs)/index.tsx` own Today.
  Reuse the shell and weather readiness, scoped wardrobe reads, sample editors and share flows.
  Extract cross-platform slot construction, catalog candidates, date and saved snapshot inputs
  into `packages/utils/src/sample-wardrobe/`. Reuse platform sample art and themed tokens.
- `apps/api/src/modules/personalization/ritual.controller.ts` can attach ephemeral owner-gated
  image access for the exact recommended IDs after the recommendation cache. Use a batched
  lookup and guarded object signing. Keep cached payloads, logs and analytics free of photo
  URLs. Strip access on device-cache writes. Reuse the parallel wardrobe list for swap choices.
- `packages/api-client/src/contracts/http/saved-looks.ts`,
  `apps/api/src/modules/wardrobe/wardrobe-saved-look.service.ts` and `packages/db/prisma/`
  extend CC-7.2 with a Today source and a dated look identifier. Reuse ownership, availability,
  idempotency and revision checks. Opt the current Looks feed into Today rows so installed
  strict decoders can still open their existing saved lists.
- `apps/mobile/components/hero/outfit-recommendation-card.tsx` owns the native details and
  disclosed offer. Web reuses the verified commerce client and its safe partner handoff.
- `apps/web/src/i18n/locales/` and `apps/mobile/assets/locales/` contain member-facing copy.

## Tasks & Acceptance

- [x] Implement and wire the shared picture and slot model. Use `today-outfit-picture`,
      `today-outfit-slot-N`, `today-outfit-catalog-N`, `today-outfit-photo-N` (loaded),
      `today-outfit-swap` and `today-outfit-swap-option-N` on both platforms.
- [x] Enable `today-primary-action` for Wear this and `today-outfit-details` for disclosure.
      Reuse app shell focus, status, signing and tab navigation; rebuild generated contracts.
- [ ] Coordinate the [test plan](../test-artifacts/test-design-7-14-todays-outfit-as-picture.md).
      Given the four visual fixtures, CI captures full views at 390 x 844 on web and
      360 x 640 dp on Android. A delayed photo preserves slot bounds, layout shift is at most
      0.1, and each slot target is at least 44 x 44 with an 8 px gap.
- [ ] Complete Step 71 and mark this story done before the final push.

## Implementation Notes

Today uses the stored active-account state as the private-photo gate, including under policy off.
The Today wardrobe read opts into the same gate. Pending members can still use catalog slots.

The saved-look API stores Today records under the new source and returns a wear date for them.
The response keeps the existing source enum, and current Looks explicitly opts into Today records.

## Plan Change Log

## Review Triage Log

## Verification

Use TypeScript, targeted lint and the generated-contract build locally. The CI gate runs
acceptance tests, budget checks, and Linux web and Android screenshots. Verify every workflow
against the exact PR head before reporting ready.
