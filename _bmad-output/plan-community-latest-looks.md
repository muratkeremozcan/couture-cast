---
title: 'Community: a real web /community page, Latest looks heading, climate filter explainer'
type: 'bugfix'
ticket: ''
created: '2026-11-19'
status: 'built'
baseline_revision: 'f913ce6f2c62f760ac5529a67cbcdf24a3729de4'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'thorough'
review_source: 'pinned'
lenses_ran: ['codex-peer']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The PM tested prod on Android Chrome mobile web on 2026-11-19. The bottom-nav
Community tab opens `/community`, still the Story 3.6 stub: a black page with only the word
"Community". On Home, the lookbook heading "Living community lookbook" read as unclear, and the
climate chips ("Cold and wet") have no explanation. The feed itself is also empty; the Community
Beta flags (0% in prod) are the owner's decision and stay out of this change. Correction after
review: the flags are a possible cause of the empty feed, not a proven one (Implementation Notes).

**Approach:** `/community` renders the real community lookbook (spotlight, filter nav, feed) with the
bottom nav. Rename `community.heading` to "Latest looks" in all 10 web and mobile catalogs (the feed
is newest-first by `published_at`; "Trending" would promise a ranking that does not exist). Add a
one-line climate filter explainer next to the chips on web and mobile, in all 10 locales.

## Boundaries & Constraints

**Always:** same key set in web and mobile catalogs; each locale keeps its own word for "look"
(pt-PT "visuais", tr-TR "kombin"); the explainer is visible text tied to the chip group for screen
readers; ids stay unique when two filter navs render on Home.

**Never:** change feature flags, feed ordering, band thresholds or band chip labels; re-add a content
heading on mobile (Story 6.8 L8 removed it; the native header says "Community"); change the band
notice gate (it is `auto`-only by design, and Jade was served the experiment's `all` arm).

## I/O & Edge-Case Matrix

| Scenario                 | Input / State                          | Expected Output / Behavior                                                                    | Error Handling                            |
| ------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Signed-in phone web      | tap bottom-nav Community               | `/community` shows Latest looks, explainer, chips, feed or empty state; Community tab current | feed errors show the existing retry state |
| Signed out               | open `/community`                      | the grid's existing signed-out message                                                        | none new                                  |
| Community off for viewer | flag denies read                       | the grid's existing disabled message                                                          | none new                                  |
| Home, two navs           | Home renders hero nav and none in grid | explainer id unique, aria-describedby resolves                                                | n/a                                       |
| Locale tr-TR / pt-PT     | switch language                        | translated heading and explainer                                                              | n/a                                       |

</frozen-after-approval>

## Code Map

- `apps/web/src/app/community/page.tsx` -- stub; replace `MobileDestinationPage` with a client
  community page. Pattern: `apps/web/src/test-utils/community-lookbook-grid.tsx:287` renders
  `<CommunityLookbookGrid showFilterNav activeTab=... />`; the light surface comes from the prism
  layout's container (`lookbook-prism-layout.tsx`); bottom nav `components/sticky-bottom-nav.tsx`.
- `apps/web/src/app/components/community-lookbook-grid.tsx:447` `LookbookFilterNav` -- h2 + chip row;
  add the explainer `<p>` with `useId`, chip row `aria-describedby`.
- `apps/mobile/components/community/community-filter-chips.tsx` -- add the explainer above the
  ScrollView.
- `apps/web/src/i18n/locales/*.json`, `apps/mobile/assets/locales/*.json` -- `community.heading`,
  new `community.filters.explainer`.
- `apps/mobile/modules/accessibility-focus/android/src/androidTest/.../ShareCardComposerTalkBackTest.kt:200`
  -- literal old heading; update.
- `_bmad-output/project-knowledge/learning-path-step-by-step.md` -- Production follow-ups under Step 58.

## Tasks & Acceptance

**Execution:**

- [ ] `apps/web/src/app/community/page.tsx` (+ client component if needed) -- real lookbook page.
- [ ] `apps/web/src/app/components/community-lookbook-grid.tsx` -- explainer in `LookbookFilterNav`.
- [ ] `apps/mobile/components/community/community-filter-chips.tsx` -- explainer line.
- [ ] 20 catalogs -- heading + explainer.
- [ ] Kotlin TalkBack literal; learning path entry.

**Acceptance Criteria:**

- Given a signed-in member on a 448px viewport, when they tap Community in the bottom nav, then the
  page shows the Latest looks heading, the explainer, the climate chips and the feed or its empty state.
- Given any of the 10 locales, when the community filters render on web or mobile, then the heading
  and explainer are translated.

## Implementation Notes

- Empty-feed evidence, corrected after Codex review 1: every production feed read returned zero
  published looks (8 loads on the PM's session, all 8 modes on an admin session), as a successful
  empty state, not the disabled error. That establishes zero visible published looks for those
  sessions and modes, nothing more. Write being open only to complimentary members is a possible
  explanation; the inventory of submissions (for example looks held in screening) is unknown,
  because production tables were not read.
- `/community` renders `CommunityLookbookGrid` with `showFilterNav`, `filterNavStickyTop={0}` (no chip
  bar above it there) and `returnPath="/community"`; the wrapper uses `overflow-x-clip` so the sticky
  nav sticks to the viewport; a CoutureCast home link covers widths where the bottom nav hides.
- Home: the hero `LookbookFilterNav` is gone; the grid renders the only nav beside the feed. The grid
  props `onViewerBandChange` and `onServedModeChange` existed only for the second nav and were removed.
- Explainer copy states the real rule: the week's forecast at the sharer's saved location
  (`resolveViewerBand` at publish, primary location first).
- Signed-out reader: neutral note, no Try again. A stored session the API refuses (401) counts as
  signed out for member actions and gets a Sign in link without the guest-only CSS marker.
- `COMMUNITY_ADD_LOCATION_HREF` became `communityAddLocationHref(returnPath)`.

## Verification

**Commands:**

- `npm exec --workspace apps/web -- vitest run src/app` -- expected: green.
- `npm exec --workspace apps/mobile -- jest components/community src/features/community` -- expected: green.
- `npm exec --workspace apps/web -- tsc --noEmit`, same for apps/mobile -- expected: no new errors.
- TEA's Playwright spec with an isolated DATABASE_URL and PLAYWRIGHT_SKIP_DB_RESET=true -- expected: green.

## Review Triage Log

Codex peer reviewed every fix round (reviews 1 to 12, all closed, last LGTM review 12); TEA reviewed
tests with Codex (review 11 LGTM). Product findings, all real and patched in this change:

- high/medium: add-location returned `/community` readers to Home (returnPath); `overflow-x-hidden`
  wrappers on `/community` and Home made the sticky chip bar and filters scroll away (`overflow-x-clip`);
  explainer named the posting place instead of the saved-location forecast (copy in 20 catalogs);
  a 401 stored session kept New post, challenge entry, the composer, a late photo allocation and an
  open report dialog; a later 503 restored member actions; a realtime rebuild did not lift the refusal.
- low: plan overstated the empty-feed cause (corrected in Intent and Implementation Notes).
