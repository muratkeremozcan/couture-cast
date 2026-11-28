---
title: 'Story CC-7.27: Suggested tags that are right'
type: feature
ticket: '7-27-suggested-tags-that-are-right'
created: '2026-11-28'
status: built
baseline_revision: '6eb89657a78913630136c4228cb79763ee08b1da'
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

- [x] Add subtype scoring to the private FashionCLIP worker and fixture engine.
- [x] Expose and consume opt-in suggestions without breaking legacy responses.
- [x] Add the crop and confirmation state to the web and native tag screens.
- [x] Cover the production entry points and complete the sprint status and Step 84.

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
The worker scores 48 prompts in a pass and caches their tokens. Measure peak memory and CPU on the
intended host before turning on model assistance. The corpus has 18 named subtype cases and two
dresses. A separate smoke case checks a plain shirt with no listed subtype.

## Plan Change Log

## Review Triage Log

The independent review and Codex Security scan covered
`6eb89657a78913630136c4228cb79763ee08b1da..55a92a8110f62f5275ea0ed9b27a5400a9886486`.
Scan `55a92a8_20261128T094120Z` covered 61 changed paths and reported one low finding.

| Finding                                    | Resolution                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 Shared utility coverage               | Exercise confidence, category compatibility, explicit None, and localized fallback.                                               |
| P0-2 Fixture snapshot revision             | Stamp the fixture snapshot with v2. The wire version remains v1.                                                                  |
| P0-3 Stale screen assertions               | Assert the selected chips and current confirmation label on web and native.                                                       |
| P0-4, P0-5 Accuracy workflow               | Build the benchmark dependencies on a clean runner and cover the new quality-gate dependency.                                     |
| P1-1 Private preview after identity change | Key web and native setup by the live identity. Regressions exercise late responses after an account change.                       |
| P1-2 Missing edge cases and output errors  | Cover uncertain and legacy choices, opt-in transport, and malformed logits. Throw the same output error for each malformed group. |
| P2-1 Native journey timing                 | Wait for tagging to settle before confirming in Maestro.                                                                          |
| P2-2 Preview and selection transitions     | Hide an unreadable image, clear loading on close, and wait for the response before selecting an untouched chip.                   |
| P2-3 Inference assumptions                 | Clarify the weights manifest identity and document model capacity and benchmark scope.                                            |
| P3-1 Story closeout                        | Link Step 84, update sprint status and describe the suggestion header in the generated contract.                                  |

CodeRabbit reviewed `d1b409044a04f3b82a7c38e1ef7549378bc85c78` in one round.
The real-session runner pins fixture tagging. The onboarding journey supplies its suggestion response,
and the smart-tagging journey continues to cover the worker-backed path.

## Verification

Run scoped lint, builds and type checks locally. Verify the model benchmark, new browser and native
acceptance tests, and every PR check in CI on the final head.

The opening Linux accuracy run scored 18/20 categories (90%) and 16/18 subtypes (88.9%).
The three smoke cases completed in 15.31 seconds, including the independent plain shirt.
[Accuracy job](https://github.com/muratkeremozcan/couture-cast/actions/runs/46132967595/job/140942067554).
