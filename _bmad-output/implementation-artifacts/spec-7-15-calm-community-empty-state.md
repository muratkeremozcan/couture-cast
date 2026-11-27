---
title: 'Story CC-7.15: Calm Community with an empty state'
type: feature
ticket: '7-15-calm-community-empty-state'
created: '2026-11-27'
status: done
baseline_revision: '53adbe2fa05067b2da2294b40611b19684371d6b'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran: [independent-full-review, codex-security-diff]
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
- [x] Link the tests in learning path Step 72 and set sprint status to done before final push.

## Implementation Notes

The feed API determines ordinary post eligibility. The clients apply the effective climate to
ranked reads, then deduplicate by post ID. The ranked copy keeps its own paging and detail
analytics. A teaser activation can focus its authorized target across climate filters.

The card uses the existing report reason and withdraw flows. The weekly challenge instructions
appear when the composer is set to join the challenge. Both header layouts let the title and
Post grow when text is enlarged.

## Plan Change Log

The first CI run measured a 57 px web header at default text size and a 60 px scroll jump
on tab return. The header keeps its 56 px minimum including the border and can grow when the title wraps. The Post action waits for its header slot before rendering. The notification footer reserves space on a trusted tab return and stays hidden during a cold feed read.

Spotlight paging treats an ordinary look that gains a ranked placement as newly ranked.
Only visible ranked rows count in the announcement and can receive focus. Closing web Share
returns focus to the active post detail if the Share opener disappears.

The small-phone German capture exposed a one-letter wrap in the sheet title. Both clients use
`Klimafilter` in German.

## Review Triage Log

The full review covered `53adbe2fa05067b2da2294b40611b19684371d6b` through
`32423cbc83443223a719a60f6354492709ca4299`. Codex Security completed 79 static
worklist receipts with 23 inventory exclusions and zero reportable findings.
The review recorded 6 high, 6 medium and 3 low items.

| Finding | Verdict | Resolution                                                                                             |
| ------- | ------- | ------------------------------------------------------------------------------------------------------ |
| P1-1    | High    | Keep one confirmed outage notice and suppress empty content during re-verification.                    |
| P1-2    | High    | Use design-token values for native spacing and radii.                                                  |
| P1-3    | High    | Cover both shared feed functions and their climate and deduplication paths.                            |
| P1-4    | High    | Audit the closed filter and retire the three resolved explainer budget entries.                        |
| P1-5    | High    | Suppress Spotlight paging in climate empty and focus only visible results.                             |
| P1-6    | High    | Migrate test actions and selectors to the sheet, inline feed and detail.                               |
| P2-1    | Medium  | Permit the native navigator's Community heading to wrap.                                               |
| P2-2    | Medium  | Leave snapshot restore mode when a member selects a climate.                                           |
| P2-3    | Medium  | Wait for the highlighted web row to appear before moving focus.                                        |
| P2-4    | Medium  | Return native focus to the filter after challenge dismissal.                                           |
| P2-5    | Medium  | Cover withdrawal, unavailable and restricted states, challenge and teaser behavior, and enlarged text. |
| P2-6    | Medium  | Wait for the native notification target to mount before retiring focus.                                |
| P3-1    | Low     | Remove the obsolete web comments opener selector and describe the current card.                        |
| P3-2    | Low     | Bring the learning-path overview through Step 72.                                                      |
| P3-3    | Low     | Restore web focus after the member withdraws the focused look.                                         |

## Verification

Run `npm run typecheck --workspace web`, `npm run typecheck --workspace mobile`, and
`tsc --noEmit -p playwright/tsconfig.json` with Node 24. Check staged files with
`npm run lint:staged -- --no-stash`. Run the acceptance tests, visual evidence and
remaining suites in CI. Check every workflow on the exact PR head before reporting ready.
