---
title: 'Story CC-7.15: Calm Community with an empty state'
type: feature
ticket: '7-15-calm-community-empty-state'
created: '2026-11-27'
status: in-review
baseline_revision: '53adbe2fa05067b2da2294b40611b19684371d6b'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

Community has two competing feeds, eight visible filters and several actions on each card.
Give members a clear route to the first look, a way to broaden an empty climate feed, and
direct access to Report from each card.

## Acceptance Criteria

1. Given an eligible session, when Community opens, show its title with Post, one climate
   trigger, the active weekly challenge as a dismissible row, then one feed. The trigger
   opens a sheet with Your climate, All climates, six bands and the climate explanation.
   Ranked eligible Spotlight posts appear first with a localized Near you label. Show
   each post once.
2. Given a published look, when the member views its card, show the photo, title, author
   and reaction row. The image and title open detail in one tap. The ellipsis offers Report
   for another member's look or Withdraw for the member's own look. Report opens the
   existing reason form. Preserve comments, owner edits and share through detail.
3. Given a settled, eligible climate with zero displayed looks, show No looks in your
   climate yet and one See all climates button. Selecting it requests the all-climates
   feed. An unresolved automatic band serves all climates and uses the generic empty
   state. A denied, banned or unavailable feed retains its own state.
4. Given isolated zero- and two-post reads with approved synthetic authors, verify both
   clients, a long locale and enlarged text. Exercise Spotlight deduplication, the filter
   transition, detail, challenge dismissal and the existing moderation actions.

## Boundaries & Constraints

Reuse existing signed reads, server admission, realtime invalidation, exposure tracking,
rollout and moderation writes. A selected climate constrains ordinary and ranked looks.
An explicitly activated Spotlight teaser can focus its authorized target outside the
current climate. Use only the existing projected data and generic Near you label in the
feed. Preserve sponsored disclosures and their surface attribution.

Dismiss a challenge for the current account's screen visit, keyed by challenge ID so a
different challenge can appear. Participation still opens the existing challenge composer.
Keep challenge instructions in the composer. Use the current account's existing location
resolution. Keep all new member-visible strings in the supported locales.

</frozen-after-approval>

## Code Map

- Web `apps/web/src/app/community/page.tsx`, `components/community-lookbook-grid.tsx` and
  `components/community-spotlight.tsx` own the shell, presentation and ranked reads.
  Reuse AccessibleModal and the existing focus, action and card handlers.
- Native `apps/mobile/src/features/community/community-screen.tsx` and
  `apps/mobile/components/community/` own the list, card, filters and challenge.
  Reuse EdgeToEdgeModal, the tab header, post detail and report modal.
- Both clients use the existing feed and Spotlight contracts. Shared eligibility can use
  the served mode, resolved viewer band and post climate. Keep the two source cursors
  separate and retain independent retry paths.
- Web `src/i18n/locales/` and native `assets/locales/` supply localized copy.

## Tasks & Acceptance

- [x] Wire the compact title, climate sheet and dismissible challenge on both clients.
- [x] Render ranked and ordinary items in the same feed, preserve the targeted teaser,
      and distinguish climate empty from access, failure and all-climate empty states.
- [x] Simplify feed cards and wire the ellipsis to the existing Report or Withdraw action.
- [x] Integrate TEA's [test plan](../test-artifacts/test-design-7-15-calm-community-empty-state.md).
      Keep `community-climate-filter`, `community-climate-sheet`,
      `community-challenge-dismiss` and `community-card-actions` on both clients.
- [ ] Link the tests in learning path Step 72 and set sprint status to done before final push.

## Implementation Notes

The feed API determines ordinary post eligibility. The clients apply the effective climate to
ranked reads, then deduplicate by post ID. The ranked copy keeps its own paging and detail
analytics. A teaser activation can focus its authorized target across climate filters.

The card uses the existing report reason and withdraw flows. The weekly challenge instructions
appear when the composer is set to join the challenge. Both header layouts let the title and
Post grow when text is enlarged.

## Plan Change Log

## Review Triage Log

## Verification

Run `npm run typecheck --workspace web`, `npm run typecheck --workspace mobile`, and
`tsc --noEmit -p playwright/tsconfig.json` with Node 24. Check staged files with
`npm run lint:staged -- --no-stash`. Run the acceptance tests, visual evidence and
remaining suites in CI. Check every workflow on the exact PR head before reporting ready.
