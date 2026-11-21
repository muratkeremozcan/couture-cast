---
title: 'First outfit and Community follow-up'
type: feature
ticket: ''
created: '2026-11-20'
status: built
baseline_revision: 'a73c81e2e8ea81725e65ac0e3b7d91813f81e5b8'
route: full
route_source: auto
risk: high
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 0
context:
  - _bmad-output/project-context.md
  - _bmad-output/planning-artifacts/ux-first-outfit-first-garment.md
---

<frozen-after-approval reason="human-owned intent">

## Intent

Finish the first-outfit and first-garment experience from PR #274 on web and native,
restore Planner and outfit cards, and add an editable Community post title and description.
Use a manual title field before the description. Keep the title optional for legacy posts
and older clients. Run the uncoached phone study against an isolated build with consenting
participants and record observed results.

Fix the production Playwright artifact rejection from the #274 deployment in this PR.

## Boundaries & Constraints

**Always:** Preserve verified session, guardian consent, wardrobe and commerce access,
Community moderation, existing uploads, and deployed API compatibility. Label sample data.
Keep one follow-up PR and require green CI and resolved reviews before merge.

**Never:** Publish unscreened text, share example outfits, request camera access before a
source action, use personal photos in tests, or count automation as a study observation.

## I/O & Edge-Case Matrix

| State                               | Action        | Expected behavior                                                                                                  |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Wardrobe read fails                 | Retry         | Keep owned stale rows if available. Show empty only after a successful empty read.                                 |
| Member has no saved city            | Set your city | Keep the sample through Cancel or failure. Load live data after a confirmed save.                                  |
| Ready ritual or Planner fetch fails | Retry         | Recover the live outfit or week. Keep missing-city, lock and transient states distinct.                            |
| Owner edits a published look        | Save          | Keep the draft on failure and the last approved public text until screened. Reject other viewers and stale writes. |

</frozen-after-approval>

## Code Map

- Web `apps/web/src/app/page.tsx` and `components/ritual-share-card-launcher.tsx` own
  the current example and ritual read. Native `apps/mobile/app/(tabs)/index.tsx`
  already restores a verified session and refetches after `onLocationsChanged`.
- `packages/utils/src/sample-wardrobe/` owns selection, swaps and conversion intent.
  Reuse the web `guest-preview` and native `features/preview` outfit presenters.
- API `modules/personalization/{planner,ritual}.service.ts` return a recognizable 400
  for missing location. Reproduce alongside transient failure on a saved-city fixture.
- `packages/api-client/src/contracts/http/community.ts`, Prisma `LookbookPost`, and
  API `modules/community/` own projection, publishing, screening and invalidation.

## Tasks & Acceptance

- [x] `apps/web/src/app/`, `apps/mobile/app/(tabs)/index.tsx`, `apps/mobile/src/features/preview/`.
      Surface a labeled outfit early on both platforms, with rotation, swaps and undo. Prefer
      live data when available. Reuse contextual location flows and read back ambiguous saves
      before retry. Restore direct Planner,
      Community and Home navigation and a Wardrobe fallback from its child pages. Remove
      the static Home health claim.
- [x] `packages/utils/src/sample-wardrobe/state.ts`, web/native preview review and Wardrobe
      hubs. Carry explicit garment intent through the existing verified conversion and consent
      checks. Open Wardrobe's direct capture entry. Keep guided setup independently reachable.
      Repair list recovery and exercise saved tags, upload retry and pending-item resume.
- [x] `apps/web/src/lib/planner.ts`, `apps/web/src/app/components/planner-rail.tsx`,
      `apps/mobile/src/features/premium/planner-screen.tsx` and the web ritual share launcher.
      Route missing-city members to city setup, recover transient requests, and expose share
      for eligible live recommendations. Retain per-day Planner states and export support.
- [x] `packages/db/prisma/`, `packages/api-client/src/contracts/http/community.ts`,
      `apps/api/src/modules/community/`. Add nullable title and an owner-scoped, revision-checked
      edit with text screening, audit and invalidation. Preserve publish replay and existing
      client projections. Negotiate title in feed, detail, Spotlight and sync. Package the
      existing text policy for lazy edit screening in `apps/api/vercel.json`. Include title
      in post screening, audit, and erasure. Generate OpenAPI and SDK through repository scripts.
- [x] `apps/web/src/app/components/community-lookbook-grid.tsx`,
      `apps/mobile/components/community/`, and app Community clients. Put title first in
      the localized composer, render title in feed and detail, and let owners save or cancel
      edits without affecting image, reactions or comments.
- [x] `playwright/tests/`, `maestro/`, and colocated tests. TEA owns baseline reproduction,
      matrix and journey regressions, test review, and CI test accounting.
- [x] `playwright/config/prod.config.ts` and `playwright/global-setup-prod-member.ts`.
      Reproduce the rejected artifact and move production session setup outside test-worker
      reporting while keeping the secret scan active.
- [x] `_bmad-output/test-artifacts/first-use-phone-study.md`. Prepare synthetic tasks and
      anonymous outcome sheet, dry-run the first garment and begin participant outreach.
- [ ] Run the participant sessions and record the observations in the study sheet.

**Acceptance criteria**

- Given an eligible guest or empty member on a phone, when they open the first look,
  then they can change it and reach the appropriate garment entry. Verified conversion
  can finish one real garment with confirmed tags through direct capture.
- Given a returning member, when they set a city or recover a failed request, then they
  can reach today's outfit, a seven-day Planner and eligible export from their live data.
- Given a new or existing Community post, when its owner publishes or saves approved
  edits, then title and description persist and render on web and native. Other viewers
  cannot edit the post.
- Given consenting study participants with the isolated fixture, when they try the tasks
  without coaching, then the study records first taps, completion and abandonment by cohort.

## Implementation Notes

- TEA reproduced the wardrobe 503, the Planner and ritual missing-city responses, and
  the missing Community Edit control with isolated browser fixtures at the baseline
  revision. The original hosted Planner and ritual responses were unavailable.
- The [phone study sheet](test-artifacts/first-use-phone-study.md) is ready for participant
  sessions once the isolated build passes preflight.
- The isolated browser and Android runs uploaded a fixture garment and confirmed its tags.
  The browser showed it after reload. Android showed it as ready in Wardrobe and verified
  fixture cleanup. Participant outreach began.
- Both hosted browser shards passed on the #274 deployment. Their HTML artifacts were
  blocked by the JWT scan. The production runner now masks the synthetic member token
  before test workers start.

## Plan Change Log

## Review Triage Log

| Finding                                                                | Verdict and resolution                                                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit could race guardian consent revocation                            | Kept the transactional participation check and used the member lock shared with revocation. A guarded HTTP test proves edits return 403 after revocation. |
| Previous native member's outfit could survive a failed new member read | Tagged ritual state by owner and fenced late results. Tested missing-city and service errors after a switch. Web also keys its owned view explicitly.     |
| Unbounded edit fanout and missing moderator title                      | Added an atomic edit budget and targeted revision signals. The moderator case includes the reported title.                                                |
| Legacy or cross-band visible cards missed text changes                 | Compatible revision signals now update rendered public targets across filters. Hidden posts still suppress the signal.                                    |
| Processing timeout opened tagging prematurely                          | Check garment status remains available through timeout and opens tagging only after the item settles.                                                     |
| Successful guided city save depended on a second list read             | Return to the validated origin after a confirmed write. The account-switch test holds the write response and verifies that a stale save cannot navigate.  |
| Same-member ritual refresh discarded last-known data                   | The web view keeps the owned result, labels it stale, and makes Retry available.                                                                          |
| Native confirmed tags left Home on its old cache                       | Confirmed garments invalidate the mounted Home ritual and trigger a fresh read.                                                                           |
| Navigation, wrapping and focus review findings                         | Deep-linked Wardrobe children return to Wardrobe. Narrow dialogs wrap titles. Swap and discard flows restore focus.                                       |
| Native editor suspension, Spotlight ordering and title visibility      | The editor fences interrupted saves and restores focus. Spotlight honors revisions, and author status views show titles.                                  |
| Pressed scenario and Planner city visual states                        | The controls use existing contrasting theme colors.                                                                                                       |
| Three TEA test quality comments                                        | Named API steps, reusable fixture intent and user-level interactions added.                                                                               |
| Production traces could contain a deployment bypass cookie             | Disable request traces when either deployed Playwright lane holds the bypass secret. Both configurations are covered by the same test.                    |
| Contract suites rejected the new approved public fields                | Updated exact key and negotiation expectations and published the title rule in OpenAPI. The package suite passed with the clock shifted a year ahead.     |
| Phone study needs observed sessions                                    | The study kit and outreach are complete. Results require participant opt-in and actual sessions.                                                          |

## Hosted regressions

- Capsule pages now key their member state by verified identity and cancel old work on
  both platforms. The four account-switch tests reproduced stale reads and delete
  confirmations before the fix.
- Playwright now follows the Community route from Home, checks service health through
  the endpoint, exercises the title's painted contrast and verifies the new Settings
  keyboard stop. Community's separate browser contexts still report unexpected HTTP
  failures. They share Home's scoped missing-city check.
- The browser suite checks example comparison on the guest Home and the live member
  layout separately. Wardrobe labels fit at 320 pixels in Chromium and iPhone WebKit.
  The member Home still reserves no space when Spotlight is absent.
- Added tests for outfit rotation and swaps, API validation, direct capture, city save
  recovery and Community editing. Web, API-client and utility coverage pass the
  existing thresholds.

## Verification

- Run `npm run verify:changed`, `npm run test:pact`, the focused Playwright and Maestro
  regressions, and verify small-phone and large-text layouts in all supported locales.
- Obtain TEA, Antigravity and Codex Security reviews. Check CodeRabbit after push, address
  findings and merge after the required PR Gate is green on the reviewed head.
