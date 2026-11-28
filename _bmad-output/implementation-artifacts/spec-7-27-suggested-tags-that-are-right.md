---
title: 'Story CC-7.27: Suggested tags that are right'
type: feature
ticket: '7-27-suggested-tags-that-are-right'
created: '2026-11-28'
status: in-review
baseline_revision: '6eb89657a78913630136c4228cb79763ee08b1da'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/test-artifacts/test-design-7-27-suggested-tags-that-are-right.md'
---

<frozen-after-approval>

## Intent

Members see their garment crop and confident tag suggestions together when they add a piece.
They can confirm the selected chips in one action or supply any choice the model abstained on.

## Boundaries & Constraints

- Use the existing private wardrobe processing and tag confirmation flow on web and native.
  FashionCLIP runs on a model-capable worker against the pinned local snapshot.
  The current 512 MB hosted worker keeps its manual mode. Enabling model assistance on that host
  requires an independently verified deployment with enough memory.
- Give each untouched field only a confident suggestion. Keep a member's selections during
  suggestion retries. Treat subtype as category-specific and validate the relationship at save.
- Keep the original response for clients that do not request subtype. Keep older snapshots readable.
  Leave suitability of external photo processors to CC-7.24. Batch capture belongs to CC-7.28 and CC-7.29.

## I/O & Edge-Case Matrix

| State                                | Expected behavior                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Confident results                    | Show the saved crop, selected tag chips, and an enabled Looks right action.                                         |
| Category or comfort uncertain        | Show Pick one for the unresolved field and keep Looks right disabled until resolved.                                |
| Material uncertain                   | Show Pick one. Choosing a material or explicitly selecting Not sure resolves it.                                    |
| Subtype uncertain                    | Show Pick one if the selected category has subtype choices. Explicit None resolves it.                              |
| Category changes                     | Clear incompatible subtype. Require a choice if the new category has subtypes and this is a subtype-enabled answer. |
| Delayed response or retry            | Preserve explicit edits, including None and Not sure. An earlier garment's response cannot affect this one.         |
| Manual, unavailable, or older answer | Keep the current manual path. Subtype stays optional when the answer has no subtype field.                          |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/wardrobe/{garment-tagging.engine,fashion-clip-inference.worker,fashion-clip-tagging.engine}.ts` score category, subtype, and material prompts in one pass. Compare subtype candidates only within the winning category and use representative alternatives for None. Keep the fixture engine deterministic.
- `packages/api-client/src/contracts/http/wardrobe.ts` and the API wardrobe controller and service expose an optional subtype score on opt-in. Keep the original wire version for existing callers. Stamp fresh snapshots with the prompt revision.
- `apps/{web/src/app/components,mobile/components/wardrobe}/garment-tagging-modal.tsx` display the existing private signed image with selected chips. Distinguish unset values from explicit skips and share the selection rules and localized strings.

## Tasks & Acceptance

- [ ] Add subtype scoring to the private FashionCLIP worker and fixture engine.
- [ ] Expose and consume opt-in suggestions without breaking legacy responses.
- [ ] Add the crop and confirmation state to the web and native tag screens.
- [ ] Cover the production entry points and complete the sprint status and Step 84.

Given the frozen `wardrobe-tagging-holdout-v1` set of garment-only images, when the pinned
FashionCLIP model runs with production prompts and thresholds, the confident top prediction is
correct for at least 90% of category labels and 80% of subtype labels. Every wrong prediction
and abstention counts against the respective full denominator. Ground-truth labels are frozen
before inference.

Given a captured garment, when the member reviews and confirms its tags on web or native, the
screen shows the stored photo and the confirmed values persist when they reopen the piece.

## Implementation Notes

The benchmark uses 20 independent synthetic garment images across all six categories. It
measures the frozen images with the pinned model. Production capture quality still needs
measurement on an appropriately licensed set of representative photos.

Deploy API readers that accept `prompts-v2` snapshots before starting model-capable workers.
Clients explicitly request subtype scores with `x-couture-garment-subtype: 1`.

## Plan Change Log

## Review Triage Log

## Verification

Run scoped lint, builds and type checks locally. Verify the model benchmark, new browser and native
acceptance tests, and every PR check in CI on the final head.
