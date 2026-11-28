---
title: 'Story CC-7.29: Several garments from one flat-lay photo'
type: feature
ticket: '7-29-several-garments-from-one-flat-lay-photo'
created: '2026-11-28'
status: in-review
baseline_revision: '0763c07082ab872239e6fa8c9840f931009c9d10'
route: full
route_source: pinned
risk: high
review: thorough
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/spec-7-28-add-several-photos-once.md'
---

<frozen-after-approval>

## Intent

Members can add several garments to Closet from a single library photo. Web and native show
detected cutouts in a grid, keep each by default and let members remove pieces or edit tags.

## Boundaries & Constraints

- Detect people and derive masks within the first-party API. Review allows two to five distinct
  pieces on a plain contrasting surface. Refuse person detections, uncertain separation, clipped
  pieces and unsupported photos. Worn-outfit photos require a separate design.
- Hold source bytes only for the review request and accepted masks only in the current client's
  memory. Clear the review on cancel, account change, completion, terminal failure and within 15
  minutes of creation. An ambiguous save can retry the frozen selection until expiry.
- Apply existing member and guardian upload policy. Save only confirmed re-encoded cutouts.
  Restrict mask tokens to one account, review, item, expiry and exact mask bytes. Treat request
  bytes, cutout previews and tokens as private and exclude them from logs and telemetry.
- Let the member supply a category and other tags. A piece without a category uses the existing
  Closet tagging state. The detector must support abstaining from a category suggestion.

## I/O & Edge-Case Matrix

| Scenario                                       | Expected behavior                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Clear flat lay                                 | Show each transparent cutout with Remove and Edit tags. The Add action counts kept pieces.           |
| Person, ambiguous crop or unavailable detector | Return a local refusal before any image storage or external inference.                               |
| Cancel, account change, completion or expiry   | Discard client previews and reject stale confirmation.                                               |
| Forged, foreign or altered item                | Reject the request before publishing any cutout.                                                     |
| Confirm timeout or partial save                | Retry the identical selection and tags. Return existing successes, then complete any missing pieces. |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/wardrobe/flat-lay-detector.ts` implements in-process person screening and
  conservative foreground separation. Use Sharp for bounded decode and clean WebP masks. Use
  YOLOX-Tiny with ONNX Runtime, verify the pinned weights by SHA-256, and fail closed if unavailable.
  Use the backdrop and boundary checks in `packages/utils/src/garment-background.ts` as the basis
  for disconnected, well-separated foreground components. Reject the whole input when uncertain.
- `flat-lay.controller.ts` and `flat-lay.service.ts` in the wardrobe module provide review and
  confirmation. Review is multipart `photo` with a 4 MiB file ceiling. Both endpoints are private,
  no-store, including refusals. The confirm route alone uses a 2 MiB JSON limit with raw-body
  capture disabled. Cap each mask at 240 KiB and every selection at five items.
- `POST /api/v1/wardrobe/flat-lay/review` returns `{items:[{id,mask,token,category}],expiresAt}`.
  Mask is base64 WebP. `POST /api/v1/wardrobe/flat-lay/confirm` accepts
  `{items:[{id,mask,token,tags}]}` and returns `{garments:[...]}`. Both successes are 200.
  Person and uncertain are 422 with `FLAT_LAY_PERSON` and `FLAT_LAY_UNCERTAIN`. Invalid, foreign or
  expired tokens return 400 `FLAT_LAY_INVALID`. Derive signing from `ANALYTICS_ID_SECRET` with a
  distinct HMAC namespace. The injectable `FlatLayDetector.detect(photo: Buffer)` returns
  `{kind:'person'}`, `{kind:'uncertain'}` or `{kind:'accepted',items:[{bytes,category}]}`.
- `wardrobe.service.ts` owns member inventory, retention, publication claims and commit replay.
  Reuse those primitives with a server-owned reservation per reviewed item and direct publication
  of confirmed bytes to the private final key. Keep source and review masks out of storage.
  Validate every selected token and mask before reserving any item. Bind normalized tags to the
  per-piece commit payload so replay can neither duplicate rows nor overwrite edits.
- `packages/api-client/src/contracts/http` owns request and response schemas. Reuse wardrobe tag
  fields (`category` nullable, optional nullable `subtype`, `material`, `comfortRange`).
  Use existing auth-session fences and Closet callbacks from both capture modals. The entry is
  **Add from flat-lay photo**. The review is **Review pieces**, with **Remove**, **Edit tags**,
  a counted **Add N pieces** action and **Try again** after an ambiguous save.

## Tasks & Acceptance

- [x] Implement local screening, cutout quality checks and bounded metadata-free encoding.
- [x] Add the authenticated review and confirmation contract and reuse idempotent publication.
- [x] Wire a single-library picker, accessible review grid and tag editor on web and native.
- [x] TEA adds acceptance coverage and links the new tests to Step 86.
- [ ] Add Step 86 to the learning path and complete sprint status.

Given a supported flat lay, when the member removes one cutout and confirms the others, then
Closet contains one garment per kept cutout with its reviewed tags.

Given a rejected flat lay, when local screening finishes, then Closet is unchanged and
no image bytes were staged or sent to an external inference service.

Given a timed-out confirmation, when the member retries within the review window, then the
same kept items have one garment each and already committed IDs are returned unchanged.

## Implementation Notes

The pinned model loaded locally under Node 24.22.3. The publisher's person example scored
0.74 and was refused by the production detector. Two existing garment fixtures scored 0.10 and
0.01. The production detector returned two masks when the fixtures were placed apart on a
contrasting background. The separation check refused a low-contrast version of the scene.

## Plan Change Log

## Review Triage Log

## Design Notes

The YOLOX release asset is
[yolox_tiny.onnx](https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx)
with SHA-256 `427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7`.
Its observed ONNX input is `images`, float32 NCHW BGR on a 416 square with a 114 fill
and top-left letterboxing, in the 0 to 255 range. Output `output` is `[1,3549,85]`.
The person score is objectness times the first COCO class probability. An asset download is
a fixed, bounded GET for public weights with zero member data and supports a warm cache.
`onnxruntime-node` 1.21.0 is already locked transitively through Transformers.js.

## Verification

Run scoped TypeScript and lint checks locally under Node 24. Use PR CI to run the acceptance
tests and verify every workflow on the final head.
