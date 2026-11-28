---
title: 'Story CC-7.26: Clean garment cutouts'
type: feature
ticket: '7-26-clean-garment-cutouts'
created: '2026-11-28'
status: built
baseline_revision: 'f127de4b98b4cedfa9920a51aed92454fb39641b'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran:
  - 'independent-correctness'
  - 'codex-security'
review_loop_iteration: 1
context:
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/test-artifacts/test-design-7-26-clean-garment-cutouts.md'
---

<frozen-after-approval>

## Intent

Members can remove a garment's background during capture and see the exact photo that will
appear in their closet. A confident cutout preserves the garment and removes the backdrop.
When the scene is uncertain, the crop keeps its original background.

## Boundaries & Constraints

- Run masking entirely on the member's device in web and native capture. CC-7.24 stays
  disabled for external garment cutout processing. The confirmed file goes through the existing
  private wardrobe upload and ownership checks.
- Favor garment retention in unclear scenes. Keep the existing crop controls and a cleanup
  switch. Apply the confidence check before changing pixels. Preserve patterns and colors
  inside the garment silhouette.
- Encode the crop once for confirmation. Upload the asset shown in the preview and keep the
  current recency and account checks. Crop changes, retakes and account switches invalidate
  old previews. Release temporary assets when they leave the capture flow.
- CC-7.27 owns tag suggestions. CC-7.28 and CC-7.29 own multiple photos and garments.

## I/O & Edge-Case Matrix

| Scenario            | Input or state                                                   | Expected behavior                                            |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Confident cutout    | A centered garment with strong evidence of a continuous backdrop | Remove the backdrop and keep the interior intact.            |
| Uncertain scene     | Clutter, nearby tones, or weak separation                        | Show and save the unmasked crop.                             |
| Manual original     | Member switches cleanup off                                      | Show and save the unmasked crop.                             |
| Stale preparation   | Crop, photo, switch, or account changes during preparation       | Only the current preview can be confirmed.                   |
| Preparation failure | Mask or cutout encoding fails                                    | Keep an ordinary crop available when the source can be read. |

</frozen-after-approval>

## Code Map

- `packages/utils/src/garment-background.ts` owns the shared RGBA confidence check and mask.
  Extract the web backdrop heuristic and reject weak boundaries and substantial disconnected
  foreground before making changes.
- `apps/web/src/lib/garment-background.ts` adapts the algorithm to Canvas. `wardrobe.ts`
  keeps the compact encoding and `garment-capture-modal.tsx` reuses the same prepared blob
  for preview and upload.
- `apps/mobile/src/lib/garment-capture-image.ts` prepares a bounded crop with Expo's image
  manipulator. Try a PNG cutout locally and use the regular JPEG crop on abstention or failure.
  `apps/mobile/components/wardrobe/garment-capture-modal.tsx` previews and confirms that same
  file, reuses the localized cleanup controls and binds the upload to the picker's account.

## Tasks & Acceptance

- [x] Share the RGBA mask and wire the web Canvas path to it.
- [x] Prepare the native preview before confirmation. Send that file through the existing
      signed upload, with its actual format and cleanup state.
- [x] Add [acceptance coverage](../test-artifacts/test-design-7-26-clean-garment-cutouts.md),
      link Step 83, and close the sprint story.

Given four fixed labeled photo scenes (plain, cluttered, pale-on-pale, and patterned), when
masking accepts a scene, the result keeps at least 95% of labeled garment pixels and clears
at least 90% of labeled background pixels. Given an abstention, confirmation uses the
unmasked crop. The plain case must produce a cutout.

Given a cutout or an unmasked crop in the preview, when a member saves and reopens the
garment, the stored asset decodes to the same pixels. Given a member without an external
photo AI grant, local cleanup remains available and sends no photo to an external service.

## Implementation Notes

The mask requires a continuous backdrop and one dominant subject with a distinct edge.
A crop that fails these checks keeps its background. Native limits PNG processing to a
1,024-pixel long edge and keeps the 2,048-pixel JPEG path for the original crop.

The plain reference retained 99.90% of labeled garment pixels and removed 99.99% of the
background. The patterned reference retained 99.998% and removed 98.07%. The cluttered
and pale-on-pale references kept the original pixels.

## Plan Change Log

## Review Triage Log

The independent review and static Codex Security scan covered
`f127de4b98b4cedfa9920a51aed92454fb39641b..56c33450327903b8cd1af07193d48744ecae9575`.
Scan `56c3345_20261128T075214Z` covered 27 changed paths and reported zero security findings.

| Finding                         | Resolution                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| P0-1 Expo decoder compatibility | Use the `pngjs/browser` codec and check expected PNG dimensions before decoding.           |
| P1-1 Acceptance coverage        | Cover crop fallback and failure, stale preparation, codec compatibility, and web encoding. |
| P2-1 Native preparation overlap | Serialize the platform work and skip superseded previews before they start.                |
| P2-2 Maestro readiness          | Wait for the async preview before confirming in both garment journeys.                     |
| P2-3 Capture parity             | Clear hidden RGB on cutouts and clear stale native errors when crop settings change.       |
| P3-1 Story closeout             | Record the review, link Step 83, align the JPEG test mocks, and close the sprint story.    |

## Verification

Run scoped lint and type checks. Verify labeled masks, native capture, and the phone-width
preview and storage journey in CI on the final PR head.
