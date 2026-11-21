---
title: 'Style ideas before wardrobe setup and photo follow-up'
type: feature
ticket: ''
created: '2026-11-21'
status: built
baseline_revision: '831f4b9f6bb4f4dc4da1e43a6808e47e40593d74'
route: full
route_source: auto
risk: high
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

A member who tried the phone flow could upload and edit a post, but background cleanup distorted
the preview, there were no other looks to browse, and individual uploads made the app feel empty.
Offer weather-aware inspiration before uploads, make cleanup predictable, and draft editable
Community descriptions from the selected photo.

## Boundaries and constraints

The style questions are optional. Continue to offer the immediate example outfit, existing swaps,
conversion and garment capture. Label example weather, illustrations and device-only saved looks.
Use the existing catalog and private image pipeline. Keep guest choices local and bounded. Keep
Community draft ownership, eligibility, screening and publishing rules. The photo draft uses
observable color cues and leaves garment details to the author. No new external photo processor.

## Input and edge-case matrix

| Scenario     | Input                               | Behavior                                                                                                                                           |
| ------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| First outfit | Guest or member with empty wardrobe | Start with a look. Optional style, palette and texture choices prioritize compatible ideas and keep alternatives available.                        |
| Sample looks | Mini skirt, hosiery, edits          | Preview, swap and bookmark samples. Reopen or remove local bookmarks. Keep the default outfit stable and distinguish ideas from personal garments. |
| Capture      | Plain or cluttered background       | Show actual processed pixels and upload the same preparation. Preserve the original when removal is uncertain.                                     |
| Community    | No other member looks               | Offer labeled inspiration along with any of the member's posts.                                                                                    |
| Description  | Selected image                      | Offer a short editable draft. Avoid overwriting text. Keep the original publish flow usable when suggestion fails.                                 |

</frozen-after-approval>

## Code map

- `packages/utils/src/sample-wardrobe` owns the catalog, selector, guest validation and locale text.
- `apps/web/src/app/components/{guest-preview,home-ritual.tsx}` and `apps/mobile/src/features/preview`
  share catalog and swap policy. Guest and signed-in samples have separate state boundaries.
- `apps/web/src/lib/wardrobe.ts` prepares actual crop bytes. `garment-capture-modal.tsx` currently
  uses CSS to simulate cleanup. The native modal exposes a switch while always encoding JPEG.
- `community-lookbook-grid.tsx` and native `community-screen.tsx` know feed author ownership, page
  state and filters. The web and native composers already fence upload attempts by account.
- `community.service.ts` and `community-storage.adapter.ts` own and bound validated draft images.
  `packages/api-client/src/contracts/http/community.ts` defines Community request shapes.

## Tasks and acceptance

**Execution**

- [x] Extend sample wardrobe policy, catalog and guest storage. Integrate optional preference
      questions, several weather-compatible looks, swaps, preview and saved samples on web and native.
- [x] Correct background cleanup and preview in web wardrobe capture. Remove the no-op native
      cleanup control so native capture accurately reflects the cropped original it saves.
- [x] Add owned-draft photo analysis and description UI to both composers. Add example inspiration
      to sparse Community feeds. Record the anonymous phone follow-up.
- [x] Have the BMad TEA peer reproduce and verify customer flows. Run Antigravity and Codex Security
      against the feature diff. Apply valid findings and rerun affected checks.

**Acceptance criteria**

- Given no wardrobe, when a visitor wants suggestions, then they can see and edit examples before
  uploading and can recover a saved guest look after reload on that device.
- Given a phone photo, when a member enables cleanup and confirms upload, then the same cropped
  image shown in preview is prepared for upload, including original-image fallback.
- Given a sparse feed, when a member opens Community, then labeled sample inspiration is available
  while their real posts and filters work normally.
- Given an owned uploaded draft, when a member requests a description, then they get a brief draft
  they can edit, and a changed photo or account cannot receive the earlier draft.

## Implementation notes

The signed-in and guest flows reuse the same catalog. The native capture flow saves the
crop. The web cleanup preview shows the prepared image and falls back on uncertain edges.
The optional Community description uses color cues from the member's private draft.

## Plan change log

## Review triage log

| Reviewer    | Finding                                                                    | Verdict | Resolution evidence                                                                                                                   |
| ----------- | -------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Antigravity | Caption capacity shared across accounts and replicas                       | Medium  | Bound in-flight work per account and instance. Lock the account row for the rolling request budget.                                   |
| Antigravity | Changed eligibility during image analysis                                  | High    | Recheck eligibility and draft ownership before returning.                                                                             |
| Antigravity | Invalid draft or missing private image shared a storage error              | Medium  | Classify missing and oversize objects for captions while preserving the share export contract. Cover wrapped Supabase responses.      |
| Antigravity | Superseded caption left the composer busy                                  | Medium  | Reset the pending state and fence the previous photo and account.                                                                     |
| Antigravity | Late ban could leave examples visible                                      | Medium  | Respect unavailable Community state on web and native.                                                                                |
| Antigravity | Save could race initial native recipe storage read                         | Medium  | Wait for current owner storage before saving.                                                                                         |
| Antigravity | Reopened capture reused a revoked preview or erased a low-contrast subject | Medium  | Invalidate in-flight capture work and retain the original crop when selection is uncertain.                                           |
| Antigravity | Supabase can wrap an object 404 in HTTP 400                                | Medium  | Read only the bounded JSON error and distinguish missing objects from bucket or proxy outages.                                        |
| BMad        | Pale sleeves disappeared against a nearby wall color                       | Medium  | Phone test reproduced transparent sleeves in the actual PUT. The new fallback preserves their opacity and retains plain-wall cleanup. |
| BMad        | Reselecting a failed crop ratio cleared the error indefinitely             | Medium  | Ignore repeated selection and retain recovery.                                                                                        |
| BMad        | Closing a pending publish could hide a successful post                     | Medium  | Guard Escape and the close action until publishing settles. Keep cancellation for an abandoned upload or suggestion.                  |
| BMad        | Self-only first page hid example outfits behind pagination                 | Low     | Show examples alongside loaded self posts. Remove them as soon as another member's look appears.                                      |
| BMad        | Community climate filter could reverse dry and wet labels                  | Medium  | Map to sample weather with compatible precipitation. Keep the three guest presets.                                                    |
| BMad        | Two tabs could erase a saved look                                          | Medium  | Read the latest owner storage on mutation, synchronize storage events, and serialize writes with Web Locks when available.            |
| BMad        | Swaps left the base garment copy visible                                   | Medium  | Show the localized generic title and current garments for an edited look.                                                             |
| BMad        | Restoring a default look showed Undo swaps                                 | Low     | Show Undo only when a swap changes a garment.                                                                                         |
| BMad        | Plan headings used title case                                              | Low     | Apply repository sentence case to the final plan headings.                                                                            |

## Verification

- Run targeted sample policy, image-preparation, Community API and composer tests.
- Run phone viewport Playwright and native flow tests using synthetic images and isolated accounts.
- Run workspace verification, generated API check and the security and code review workflows.

Local verification passed 10,414 API, 2,603 web, 2,379 native, 432 shared utility, and
1,890 API client tests. BMad TEA ran 35 browser tests on the isolated stack and 80 focused
native tests. The exact migration replay and OpenAPI lint passed. The API route-matrix and
Supabase error contract changes passed the final 171-test targeted run.

After review fixes, 2,607 web and 2,382 native tests passed. The web production build
passed. The affected phone browser cases passed, including the new low-contrast sleeve
fixture and the edited hosiery save and reopen. Antigravity verified the corrective diff.
