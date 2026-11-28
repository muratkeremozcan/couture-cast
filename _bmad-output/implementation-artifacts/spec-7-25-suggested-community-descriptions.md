---
title: 'Story CC-7.25: Suggested Community descriptions'
type: feature
ticket: '7-25-suggested-community-descriptions'
created: '2026-11-28'
status: built
baseline_revision: 'dcd09dee7d8d0e2866e8cfe6407c6a7e610deadc'
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
  - '_bmad-output/test-artifacts/test-design-7-25-suggested-community-descriptions.md'
---

<frozen-after-approval>

## Intent

Members can start a Community description from their chosen photo, review the draft,
and publish it through the same screening as anything they write.

## Boundaries & Constraints

- On web and native, an eligible member opts in for the current upload by tapping
  **Suggest a description**. Use the existing authenticated color-cue generator
  in CoutureCast's API. It reads the verified private draft and returns a localized
  sentence about visible colors. CC-7.24 keeps external processing disabled.
- The deadline is five seconds from the tap, with a matching API budget.
  Keep manual entry and publishing available during the request and after a failure.
- Keep normal Community eligibility, ownership, upload validation, quota, and text
  and image screening in force. Keep the caption separate from required alt text.
- Suggestions remain ephemeral until the member publishes.
  The route accepts the existing draft and upload session IDs and returns caption text.

## I/O & Edge-Case Matrix

| Scenario           | Input or state                                                       | Expected behavior                                                                                       |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Request            | Eligible member selects a photo and taps the single action           | One editable sentence arrives within five seconds and shows **Suggested**.                              |
| Take ownership     | Member edits or accepts the draft                                    | Keep the chosen text and clear **Suggested**. Publishing uses the existing review path.                 |
| Decline or failure | Member skips the action, service times out, or response is malformed | Manual entry stays available. A failed request leaves existing text intact.                             |
| Draft changes      | Photo, session, or a composer field changes before reply             | Discard the late response. A replacement photo clears an unaccepted suggestion and keeps authored text. |
| Access changes     | Draft expires, eligibility is lost, or ownership fails               | Refuse the suggestion. Recheck eligibility and the current source before returning it.                  |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/community/community.service.ts` owns `describeDraft`,
  including access, ownership, per-member quota, bounded private storage and
  the final access/source recheck. Reuse `community-photo-caption.ts` and
  `sampleCommunityImageColors` for processing. Keep existing status mappings.
- `packages/api-client/src/contracts/http/community.ts` owns request and response
  validation. Keep the published wire shape. Reject blank output and use the
  existing caption link and email rules for suggestions too.
- `packages/api-client/src/request-deadline.ts` owns portable cancellation.
  Add a strict Community description deadline using the existing deadline helper.
  Race cancellation against pending work and clean up listeners on settlement.
  Use the same duration in the API and both clients. In the API, keep the in-flight
  slot until underlying work settles and check cancellation before each new phase.
- `apps/web/src/lib/community.ts` and `apps/mobile/src/lib/community.ts` already
  bind describe replies to the web session scope and native identity epoch.
  Include the native access-token read in the deadline.
- `apps/web/src/app/components/community-lookbook-grid.tsx` and
  `apps/mobile/components/community/community-post-sheet.tsx` own the compose
  controls and cancellation. Keep local React state in each component and share
  the HTTP deadline and validation. Keep the existing suggestion action selector.
  Add `community-description-suggested` and `community-accept-description`.

## Tasks & Acceptance

- [x] Extend the existing describe contract, clients, and API service with strict
      deadline and output checks. Preserve authenticated draft validation and publication.
- [x] Update both composers to label, accept, and fence suggestions. Localize the
      action, marker, and accept control across the ten web and native locales.
- [x] Complete the [acceptance plan](../test-artifacts/test-design-7-25-suggested-community-descriptions.md),
      link the test files from Step 82, and close the sprint story.

Given a fresh upload, the description stays empty until the member requests a suggestion.
Given a suggestion that the member edits or accepts, publishing submits that text through
the ordinary Community pipeline. Given a timeout, manual entry can continue and a late
reply leaves the current composer untouched.

## Implementation Notes

The API describes visible colors from a bounded raster and rechecks ownership,
eligibility, and the upload declaration before delivery. Choosing **Use this
description** keeps the text as part of the member's draft.

## Plan Change Log

## Review Triage Log

The independent code review and Codex Security covered
`dcd09dee7d8d0e2866e8cfe6407c6a7e610deadc..7b560e9a5ee2d4b02d12a55daf3234eb88ed8d77`.
The static security scan covered all 37 changed paths and reported zero findings.

| Finding                    | Resolution                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 Deadline branches     | Remove the unused listener initializer and cover cancellation before dispatch and clock overrun after resolution.                      |
| P1-2 Acceptance gaps       | Cover in-flight reader limits, changed source data, stale and timed-out replies, invalid output, and accepted text across replacement. |
| P2-1 Session changes       | Recheck identity when a description request resolves or rejects.                                                                       |
| P2-2 Private image buffers | Clear downloaded bytes and the sampled raster when analysis settles.                                                                   |
| P2-3 Invalid output        | Reject control characters and line separators in description replies.                                                                  |
| P3-1 Closeout              | Record review decisions, link the Step 82 evidence, and close the sprint story.                                                        |
| P3-2 Busy state            | Expose the web suggestion button's busy state to assistive technology.                                                                 |

## Verification

Use targeted lint and workspace type checks. Rebuild the API client before checking
its consumers. Run acceptance and verify screening in CI on the final PR head.
