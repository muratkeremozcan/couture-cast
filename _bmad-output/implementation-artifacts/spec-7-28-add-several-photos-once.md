---
title: 'Story CC-7.28: Add several photos at once'
type: feature
ticket: '7-28-add-several-photos-once'
created: '2026-11-28'
status: in-review
baseline_revision: 'a6ce147492c565bffe7ee6ea16febf53ec57e676'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/spec-7-27-suggested-tags-that-are-right.md'
  - '_bmad-output/test-artifacts/test-design-7-28-add-several-photos-once.md'
---

<frozen-after-approval>

## Intent

Members can review up to five library photos in one Closet session and add the pieces they keep in one action.
Each confirmed photo represents one garment. Each row reports its own upload result.

## Boundaries & Constraints

- Ship on web and native through the current Closet Add menu, alongside the existing single-photo and camera paths.
- Review square, prepared previews on-device. Require an explicit Keep piece selection per photo.
  Add only the selected photos. Use the current private upload, guardian checks, and wardrobe tagging after save.
- Bind each batch to the identity at picker open. Cancel or identity change clears local images and fences late work.
  Clear failed and successful upload previews as each reaches its outcome. A retry opens a picker for the same photo.
- Retry the same row with its original allocation and commit keys while the outcome is unresolved.
  Keep its prepared-photo fingerprint to validate the reselected photo. Keep successfully saved pieces independently.
- Retire temporary server bytes through the existing upload validation, deletion outbox and expiry sweep.
  Keep all unconfirmed images on-device. Flat-lay detection belongs to CC-7.29.

## I/O & Edge-Case Matrix

| Scenario                              | Expected behavior                                                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Select one to five valid photos       | Preview each independently. The primary Add action counts only explicitly kept photos.                          |
| Select more than five                 | The native picker caps selection. Web rejects the selection and lets the member choose again.                   |
| Invalid image                         | Show a row error, release the invalid image, and allow the other photos to proceed.                             |
| Mixed results                         | Preserve successful pieces and report each failure. A retry validates the same photo and submits only that row. |
| Commit succeeds after a lost response | Retry with the same key and receive the existing garment.                                                       |
| Cancel or change account              | Release browser object URLs and app-owned native files, abort work, and ignore late responses.                  |

</frozen-after-approval>

## Code Map

- `apps/web/src/app/wardrobe/page.tsx` and `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx` own the Closet Add and tagging menus. Batch save refreshes inventory without opening a tagging modal for every piece.
- `apps/web/src/app/components/garment-capture-modal.tsx` and `apps/mobile/components/wardrobe/garment-capture-modal.tsx` expose the batch entry only for Closet callers. Reuse existing modal and focus behavior.
- `apps/web/src/lib/wardrobe.ts` and the native capture flow already use account-scoped tracked direct uploads. Reuse the transport with an optional row attempt identity and keep fingerprint checks. Extract the native transport to a library module for both capture flows.
- `apps/mobile/src/lib/garment-capture-image.ts` prepares and disposes app-owned images. Restrict disposal of picker copies to Expo ImagePicker's private cache directory.
- Use a shared batch state model for selection limits, stable row identity, outcomes and resource cleanup. Keep picker and image adapters platform-specific.
- Existing wardrobe contracts and retention support this workflow without a new API route.

## Tasks & Acceptance

- [x] Implement batch state, sequential save, stable retry and resource lifetime.
- [x] Wire the web and native Closet entry points, previews, controls and localized copy.
- [x] TEA covers user paths and retry and cleanup edge cases. Link Step 85 from the new tests.
- [ ] Record Step 85 and complete the sprint status after review and verification.

Given four valid photos and four Keep selections, when the member presses Add 4 pieces, then four individual pieces appear in Closet.

Given mixed outcomes, when the member retries a failed row with its original photo, then previous successes stay and each row can create at most one piece.

Given a cancellation before Add, a failure or an account change, when the flow settles, then the affected transient local images are released. Before Add, the batch sends zero image requests.

## Implementation Notes

The story treats review as approval of each prepared photo. Members tag saved pieces through the existing Closet cards once processing finishes.

Before confirmation all photos are local. After confirmation the standard private staging path
removes rejected bytes on validation failure and releases staging on commit. An abandoned upload
session expires after 15 minutes. The hourly sweep can remove its staged object after the signed
upload window and the 15-minute safety margin have elapsed. The user cannot read staged objects.
A commit already accepted by the server stays saved if the reply is lost or the sheet closes.

## Plan Change Log

## Review Triage Log

## Verification

Run scoped workspace builds, type checks and lint locally under Node 24.
Use PR CI for all acceptance tests and workflow verification.
