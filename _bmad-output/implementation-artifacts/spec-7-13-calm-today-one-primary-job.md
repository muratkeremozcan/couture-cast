---
title: 'Story CC-7.13: Calm Today with one primary job'
type: feature
ticket: '7-13-calm-today-one-primary-job'
created: '2026-11-26'
status: done
baseline_revision: '0d3b82a3ba9e76be509ddd816817f48a44292485'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran:
  - 'independent-correctness'
  - 'codex-security'
review_loop_iteration: 0
context:
  - 'AGENTS.md'
---

<frozen-after-approval>

## Intent

The Today tab buries the outfit under marketing, filter chips and Community content. A member
should see the weather, an outfit and one action in the first view on web and native.

## Decisions

1. The live outfit's primary action opens its details in place. Existing outfit actions remain
   available there. CC-7.14 owns the composed picture and Wear this save flow.
2. Unavailable weather shows a labeled sample look and makes Set your city the primary action.
   Use the current Profile location entry on web and saved Locations on native. Keep the sample
   editor available inside the same card and retain account-backed saves. A valid, owner-scoped
   cached forecast remains visible with its existing stale state.
3. Show up to three recent wardrobe pieces through the existing authenticated list. Show Add
   your first piece only after a successful empty response. Render neither state while the
   first read is unresolved or failed. Keep garment and forecast reads scoped to the viewer.
4. The existing server-selected Spotlight teaser is the sole Community row. Use its eligibility,
   opt-out, block and moderation behavior. Keep CC-6.7b disclosure and link to the eligible look
   on the Community tab. Empty, ineligible and failed responses leave the row absent.
5. Native opens hourly weather from the weather line. Keep a single period control only when
   Today's representative forecasts differ in a way the member can see. Attach an Android
   screenshot from the 360 x 640 dp small_phone lane to the PR.

## Boundaries & Constraints

**Always:** Keep working guest entry, account and guardian boundaries, shared tab shell, scoped
rendering, notifications and deep links, and the one-tap Plan link for every member.

**Never:** Add a weather permission request, a new feed request, or a new data contract. The
outfit composition and Wear this belong to CC-7.14. The Community and Profile redesigns belong
to CC-7.15 and CC-7.16. Follow the Epic 7 trio rules in
`/Users/murat/opensource/cc/epic7-coord/RULES.md`, including the shared worktree, no local test
suites, and the two-round review maximum. TEA owns tests, fixtures, budget config and CI repairs.

## I/O & Edge-Case Matrix

| State                        | First view                                          | Secondary content                    |
| ---------------------------- | --------------------------------------------------- | ------------------------------------ |
| Forecast and wardrobe        | Weather, live outfit, Outfit details                | Recent pieces, Plan, eligible teaser |
| Forecast and empty wardrobe  | Weather, starter outfit, Outfit details             | One Add row, Plan, eligible teaser   |
| Forecast unavailable         | One unavailable weather line, sample, Set your city | Closet state, Plan, eligible teaser  |
| No eligible Spotlight result | Live or sample outfit                               | Closet state and Plan                |
| Signed out                   | Illustrated sample and preview entry                | Account entry and legal navigation   |

</frozen-after-approval>

## Code Map

- `apps/web/src/app/page.tsx`, `components/lookbook-prism-layout.tsx`, `components/home-ritual.tsx`
  own Today, the web screen gate and the scoped ritual. Reuse guest entry, retain ritual and
  deep-link handling, and remove the marketing hero, chip controls and embedded Community grid
  from the production route. The signed-out guest preview should appear once.
- `apps/web/src/app/components/home-spotlight-teaser.tsx` owns web eligibility, focus, rendering
  and sponsorship. The production link moves to Community. `apps/web/src/app/community/page.tsx`
  and `community-lookbook-grid.tsx` already support server-checked target reads and focus intent.
  Preserve legacy notification targets when moving their web destination. Avoid exposing private
  target data or replaying Community actions under a different account.
- `apps/web/src/app/settings/page.tsx` and `components/guest-preview/guest-preview-entry.tsx`
  contain Profile and the existing web sign-out action. Reuse `signOutNativeSession` on native
  Profile in `apps/mobile/app/(tabs)/settings.tsx`.
- `apps/mobile/app/(tabs)/index.tsx`, `components/hero/`, and
  `src/features/preview/member-sample-outfit.tsx` own native rendering, ritual caching, forecast,
  sharing and sample saves. Reuse the native Spotlight slot and move the ribbon behind the weather
  line. Use the existing forecast timezone and recommendation periods for the time-of-day check.
- `apps/web/src/lib/wardrobe.ts` and `apps/mobile/src/lib/wardrobe.ts` serve the recent pieces.
  Reuse existing garment access, invalidation and add routes. Localize new member-facing labels
  across the supported web and native locales. Reuse shared tokens and scalable text.

## Tasks & Acceptance

- [x] Replace the Today route body on web and native. Keep `today-first-content`, use
      `today-primary-action` on live details and `home-set-city` on the fallback action.
- [x] Place `home-closet-strip` or `home-add-garment`, `home-plan-week`, and at most one existing
      Spotlight slot after the first view. Place Sign out in Profile.
- [x] Coordinate the [acceptance plan](../test-artifacts/test-design-7-13-calm-today-one-primary-job.md)
      and Android capture with TEA. Given a 390 x 844 viewport, the first view fits the weather, card
      and action. Given the three member fixtures at default text size, each is at most 1,688 CSS px
      tall. At 320 px and 200% text, every control is reachable.
- [x] Given native Today with hourly data, a tap on `weather-header` opens `hourly-forecast-ribbon`.
      Given equal representative forecasts, `scenario-toggles` is absent. Given differing forecasts,
      each period can select its outfit. Include small-phone Android evidence in the PR.
- [x] Finish Step 70 at `../project-knowledge/learning-path-step-by-step.md` and set the story to
      done in `sprint-status.yaml` before the final push. The 7.12 entry is already done.

## Implementation Notes

The implementation handoff owns product source and locale changes. The builder owns this spec,
sprint status, Step 70, review coordination, commits, and PR delivery. TEA owns the test files.

Today shares the existing Community deep-link payload across platforms. The weather alert keeps
its existing Plan route and can focus the active outfit action. Closet reads use the same owner
scope as the ritual. TEA migrated the prior Home entry-point coverage to the new routes and
controls, including guest preview, account recovery and the Android share flow.

## Plan Change Log

## Review Triage Log

The independent review covered `0d3b82a3ba9e76be509ddd816817f48a44292485` through
`2e71d4855e768633f7b79eaab7b0dd3f416811ff`. The same round covered all six Playwright files in
`2e71d4855e768633f7b79eaab7b0dd3f416811ff..b34db2a2bb4c77095d44107e0d93ffe055d8d06b`.
The Codex Security scan of the pinned base and head covered all 77 source-like paths in
the 104-path diff. It recorded 27 inventory exclusions, three suppressions and zero reportable
findings. This was static coverage of the pinned range. CI verifies the subsequent fixes.

- P1-1 to P1-4. Migrate the remaining test mocks, disclosure actions, Community routes and Maestro
  anchors to the production entry points.
- P1-5. Keep signed-out notification feedback and bind Community target reads to the original
  account. Settle the link before revealing the feed and announce its outcome.
- P1-6. Keep only categories in the closet strip and restore them for the same session. Refresh in
  place on focus and clear on denial or wardrobe invalidation. Remove routine polling.
- P2-1 and P2-2. Place the native cached-weather notice immediately after the card. If the forecast
  is usable and the outfit is missing, make Edit sample the primary action. Offer period selection
  only across usable outfits with differing forecasts. One disclosure opens the period choices.
- P2-3 and P2-4. Cover Spotlight focus, native Profile sign-out, and the unavailable forecast at
  enlarged text. Limit expected network failures to the affected requests.
- P3-1 to P3-3. Record completion with the Android capture, update diagnostic anchors, add the web
  sample editor anchor and issue a fresh Spotlight focus token on activation.

## Verification

Run touched workspace TypeScript and targeted lint locally. CI runs the acceptance and regression
tests and provides the Android evidence. Verify all checks on the exact head before handoff.
