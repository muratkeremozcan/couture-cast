---
title: 'Story CC-7.12: Looks tab for saved looks, ideas and plans'
type: feature
ticket: '7-12-looks-tab-saved-looks-ideas-plans'
created: '2026-11-26'
status: done
baseline_revision: 'a8863b05'
route: full
route_source: auto
risk: high
review: quick
review_source: pinned
lenses_ran: []
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/reviews/epic-7-ux-review.md'
  - '_bmad-output/implementation-artifacts/spec-7-11-five-tab-navigation-back-pattern.md'
  - '_bmad-output/implementation-artifacts/spec-7-2-saved-looks-follow-account.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** CC-7.11 gave Looks a tab, but the tab is a text list of saved looks with a Capsules
row and a Plan row. Capsules live on their own screen, the week planner sits behind a row and
shows free members a lock, saved looks also sit below the Closet grid, and a save
confirmation's View only scrolls the screen the member is on. A member cannot tell where a look
went.

**Approach:** Looks gets three segments: Saved, Ideas and Plan. Saved is one picture-tile grid
of saved looks and capsules, newest first, with All, Today and Capsules filters. Ideas shows the
sample looks. Plan holds the planner; free and signed-out members see a sample week with one
Upgrade button. Every saved look has its own address, so View, deep links and back work the same
everywhere. The Closet saved looks row, the capsules screen address and the Plan address fold
into Looks.

## Decisions (owner delegated; recorded here)

- D1 Segments (AC1). A segment control under the Looks top bar: Saved, Ideas, Plan
  (`looks-segment-saved|ideas|plan`), built as `role=tablist` with `role=tab` buttons that are
  not pill shaped, so the CC-7.10 guard does not count it as a chip row. The open segment lives
  in the address: web `/looks?segment=saved|ideas|plan`, native `looks` tab params
  `{ segment }`; a change replaces the entry (web `router.replace`, native `setParams`), so back
  leaves Looks. With no segment in the address, Looks opens on Saved when the member has one
  saved look or capsule, else on Ideas; the gate waits for the first reads. A signed-out visitor
  opens on Ideas. An unknown value falls back to the default.
- D2 Saved tiles (AC2). Saved shows a two-column grid of picture tiles. A tile is a 2 x 2
  collage of its first four pieces (garment photo, catalog art for catalog slots, a dashed
  placeholder for a missing or failed photo), then the name and one state line. Saved look name:
  its title, else the existing untitled fallback; capsule name: its name. State line, first
  match: missing pieces ("1 piece missing", "{count} pieces missing"; saved look
  `missingGarmentIds.length`, capsule `unavailableGarmentCount`), then "Needs review" (saved
  look `needs_review`), else "Saved {date}" (`createdAt`, locale short month and day). Test ids:
  `saved-look-card-{id}` and `looks-capsule-card-{id}`, both tile selectors in
  `screen-budget.json`; the tile is one link.
- D3 Newest first (AC2). Both list endpoints gain an opt-in `sort=created_desc` query
  (`created_at desc, id asc`); without it each keeps its order. A shared pure merge in
  `packages/utils/src/looks-feed.ts` interleaves the two paged sources by `createdAt`, shows
  only items no unloaded item can precede, and says which source the next Load more reads. Web
  and native both use it. Page sizes: saved looks 50, capsules 50.
- D4 Filters (AC2). One chip row on Saved: All, Today, Capsules (`looks-filter-all|today|
capsules`, `aria-pressed`), in the address as `filter`. Today means looks saved from the Today
  tab (saved look source `home_sample`); Capsules means capsules only. A filter with nothing to
  show reads one line ("No looks from Today yet", "No capsules yet"). Rejected: Today as
  "fits today's forecast", because neither app reads a member forecast outside the planner and
  a guess would mislabel looks.
- D5 Saved look detail and deep link (AC5, AC6). Each saved look has a sub-screen: web
  `/looks/saved/[savedLookId]`, native `saved-look/[savedLookId]`, top bar with back and the
  look's name, parent Looks with `segment=saved`. It reads the one look (existing GET), shows
  the full composition with the missing and needs-review notices, and Remove; Remove deletes,
  returns to Saved and shows the existing Undo bar. A look that is gone or not the member's
  shows "This look is no longer saved" with the back control. Signed out, it asks to sign in.
  The detail content moves out of the Closet row into a shared detail component per platform.
- D6 Capsules (AC5). The capsule manager moves to web `/looks/capsules` (top bar "Outfit
  capsules", parent Looks with `filter=capsules`); native keeps its `wardrobe-capsules` route
  with parent Looks. `/wardrobe/capsules` redirects (server side, query kept) to
  `/looks?segment=saved&filter=capsules`. A capsule tile opens the manager with
  `?capsule={id}`, which scrolls to that card and focuses it. The Capsules filter ends with one
  "Manage capsules" row (`looks-manage-capsules`) to the manager, where create lives.
- D7 View (AC5). Every save confirmation's View opens the saved look's detail (D5): web Home
  sample, web and native Style this piece, and native Home sample (which gains View). The
  scroll-to-list behaviour is removed.
- D8 Closet row removed (AC5). The CC-7.2 saved looks row leaves web and native Closet; the
  row component is deleted once Looks and the detail no longer use it.
- D9 Ideas (AC3). Ideas shows the sample catalog's looks (`SAMPLE_CATALOG`, shared) as the same
  picture tiles drawn from catalog art, with the look name and its weather line
  (`looks-idea-card-{lookId}`, a tile selector). Tiles are pictures with no control until
  CC-7.22 ships the lookbook, so Ideas adds no dead button. When Saved is empty, Ideas starts
  with the line "Save a look to see it here".
- D10 Plan (AC4). The Plan segment renders the planner body in Looks (web `PlannerRail`
  `variant="rail" hideHeader`, native the planner screen's body). The planner's locked and
  signed-out states render the free preview: a sample week (seven day rows, each a weekday and
  a sample look name with its art), one line "Premium plans your whole week around your
  forecast." and one Upgrade button (`plan-upgrade`, the screen's primary) to Profile's Premium
  section (web `/settings#premium`, native `/settings`). The old lock panels and their test ids
  (`planner-rail-locked`, `planner-rail-get-premium`, `planner-locked`, `planner-locked-cta`)
  are removed; `plan-free-preview` marks the preview. Disabled, error, loading and set-city
  states stay.
- D11 One tap to Plan (AC4). Web `/looks/plan` and `/?planner=1` redirect (server side) to
  `/looks?segment=plan`; native `planner` becomes a redirect to the Looks tab with
  `segment=plan`. Today's Plan controls (web `planner-open-control` and the alert link, native
  `home-plan-week`) and native Profile's `planner-link` open that address in one tap.
- D12 Strings. New member-facing strings come from the catalogs in all 10 web and 10 mobile
  locales (`looks.segments.*`, `looks.filters.*`, `looks.state.*`, `looks.plan.*` and the rest);
  the CC-7.11 `looks.capsules` and `looks.plan` keys are removed or reused where unused.
- D13 Budget. Looks stays in the CC-7.10 guard; `looksAnchors` keeps `looks-first-content`,
  which marks the first block of the open segment (the grid, the filter's empty line, Ideas'
  grid or Plan's first block). New tile test ids join `tileSelectors`.

## Boundaries & Constraints

**Always:** web and native ship together; one primary button per screen; 44 px targets;
CC-7.7 shift budget, CC-7.9 token guard and CC-7.10 screen budget stay green; a
guardian-pending teen gets every segment and the detail with the same taps; existing API
behaviour is unchanged without the new query.

**Never:** lookbook Shuffle, pin or save on Ideas (CC-7.22); trips (CC-7.18); Today layout
beyond the Plan link (CC-7.13); Profile rows beyond the planner link target (CC-7.16); local
unit, Playwright or native suites; macOS jobs on PRs.

## I/O & Edge-Case Matrix

| Scenario              | Input / State                       | Expected                                        |
| --------------------- | ----------------------------------- | ----------------------------------------------- |
| First open, saved     | 1 saved look, no segment in address | Saved, All, tile visible above the fold         |
| First open, empty     | no looks, no capsules               | Ideas with "Save a look to see it here"         |
| Signed out            | visitor opens `/looks`              | Ideas; Plan shows the free preview              |
| Newest first          | capsule saved after a look          | capsule tile before the look tile               |
| Merge paging          | 60 looks, 3 capsules                | no tile out of order across Load more           |
| Missing piece         | look with 1 missing garment         | "1 piece missing"                               |
| Today filter          | 2 home samples, 1 style piece look  | two tiles                                       |
| Capsules redirect     | `/wardrobe/capsules`                | `/looks?segment=saved&filter=capsules`          |
| View                  | save on Today, tap View             | `/looks/saved/{id}`; back lands on Saved        |
| Deep link cold        | load `/looks/saved/{id}`            | detail; back replaces to `/looks?segment=saved` |
| Gone look             | deep link to a removed look         | "This look is no longer saved" and back         |
| Free Plan             | free member, Plan                   | sample week, one line, one Upgrade; no lock     |
| Premium Plan          | entitled member                     | the week                                        |
| Plan from Today       | tap Plan your week                  | Looks on Plan, one tap, every member            |
| Old Plan address      | `/looks/plan`, `/?planner=1`        | `/looks?segment=plan`                           |
| Guardian-pending teen | teen with pending guardian          | every segment and the detail open               |

</frozen-after-approval>

## Code Map

Shared and API:

- `packages/api-client/src/contracts/http/saved-looks.ts:254` `listSavedLooksQuerySchema`,
  `wardrobe.ts:696` `listOutfitCapsulesQuerySchema` -- add `sort` (D3); rebuild api-client dist.
- `apps/api/src/modules/wardrobe/wardrobe-saved-look.service.ts:664`,
  `wardrobe-capsule.repository.ts:380` -- honour `sort=created_desc`.
- `packages/utils/src/looks-feed.ts` (new) -- merge, boundary, next source (D3).
- `packages/utils/src/sample-wardrobe/catalog.ts:334,412` -- Ideas source and the sample week.
- `packages/utils/src/screen-budget.json` -- tile selectors (D13).

Web (`apps/web/src`):

- `app/components/looks-screen.tsx` -- segments, filters, grid, Ideas, Plan (D1 to D4, D9, D10).
- New `app/components/looks-tile.tsx`, `app/components/saved-look-detail.tsx`,
  `app/looks/saved/[savedLookId]/page.tsx`, `app/looks/capsules/page.tsx` (manager moved from
  `app/wardrobe/capsules/page.tsx`).
- `app/wardrobe/saved-looks-row.tsx` -- detail extracted, then deleted (D5, D8);
  `app/wardrobe/page.tsx:1394-1420` -- row removed.
- `app/components/planner-rail.tsx:368-399` `LockedPanel` -- free preview (D10);
  `app/components/plan-screen.tsx`, `app/looks/plan/page.tsx` -- removed for the redirect.
- `next.config.ts:102` -- redirects (D6, D11); `components/sticky-bottom-nav.tsx:42`.
- `app/components/home-ritual.tsx:529`, `app/wardrobe/style-piece-panel.tsx:686`,
  `components/lookbook-prism-layout.tsx:291,346` -- View and Plan links (D7, D11).
- `lib/saved-looks.ts`, `lib/wardrobe.ts:649` -- `sort` passthrough.

Native (`apps/mobile`):

- `src/features/looks/looks-screen.tsx` -- segments, filters, grid, Ideas, Plan.
- New `app/saved-look/[savedLookId].tsx` and a shared detail component; `app/_layout.tsx`
  registers it; `src/components/app-top-bar.tsx:77` `PARENT_TAB`.
- `src/features/wardrobe/saved-looks-row.tsx`, `wardrobe-hub-screen.tsx:805-830` -- row removed.
- `src/features/premium/planner-screen.tsx:77-93` -- free preview; `app/planner.tsx` redirect.
- `src/features/wardrobe/style-piece-panel.tsx:758`, `src/features/preview/
member-sample-outfit.tsx:157,422`, `app/(tabs)/settings.tsx:1889` -- View and Plan links.
- `app/wardrobe-capsules.tsx` -- `capsule` param focus.
- Catalogs `assets/locales/*.json`, web `src/i18n/locales/*.json`.

## Tasks & Acceptance

**Execution:**

- [x] API `sort=created_desc` on both lists, contract and dist -- D3.
- [x] `looks-feed.ts` merge and sample week data in `@couture/utils` -- D3, D10.
- [x] Web Looks segments, filters, tiles, Ideas, Plan segment and free preview -- D1 to D4,
      D9, D10.
- [x] Web saved look route, capsules move and redirects, View and Plan links, Closet row
      removed -- D5 to D8, D11.
- [ ] Native Looks segments, filters, tiles, Ideas, Plan and free preview -- D1 to D4, D9, D10.
- [ ] Native saved look route, capsule focus, planner redirect, View and Plan links, Closet row
      removed -- D5 to D8, D11.
- [x] Catalog keys in 10 + 10 locales; screen budget tile selectors -- D12, D13.
- [ ] Tests (TEA, per the test design) -- AC6.
- [ ] Learning path Step 69; sprint-status 7-12 done before the final push.

**Acceptance Criteria:**

- Given a member with a saved look, when Looks opens, then Saved shows; with none, Ideas shows.
- Given Saved, then saved looks and capsules show newest first as picture tiles with a name and
  one state line, and All, Today and Capsules filter them.
- Given Ideas, then sample looks show as picture tiles.
- Given a free member on Plan, then a sample week, one line and one Upgrade button show, and no
  other screen shows a Planner lock; given Today, then Plan your week opens Plan in one tap.
- Given `/wardrobe/capsules`, then Looks opens with Capsules; given any save confirmation, then
  View opens the saved look in Looks; given Closet, then no saved looks row shows.
- Given 390 x 664, then each segment's first content is above the fold; given a deep link to a
  saved look, then back lands on Saved.

## Implementation Notes

- Shared worktree with TEA: no git stash, git checkout -- or git reset; announce before git add
  and wait for an ack. CI is the proof: tsc per touched workspace, eslint on touched files.
- Builder owns product code, catalogs, contracts, `screen-budget.json` and docs; TEA owns every
  test file and the test design.
- Rebuild api-client and utils dist after contract or module edits before trusting app tsc.

## Plan Change Log

- 2026-11-26, TEA pushback P1-P10 (test-design-7-12-looks-tab-saved-looks-ideas-plans.md),
  accepted except P5 in part; these amend D1 to D6 and D10:
  - P1 (D1): the gate waits for both first reads; Looks never paints Ideas and then flips. A
    failed saved looks read opens Saved with its error line. The default segment is computed
    once per entry.
  - P2 (D4): Today reads `source=home_sample&sort=created_desc` with no capsules; Capsules reads
    capsules only; merged pages are never filtered on the client.
  - P3 (D3): ties sort `created_at desc, id asc` on both APIs; the merge puts a saved look before
    a capsule on an exact `createdAt` tie.
  - P4 (D10): the free preview's line and `plan-upgrade` sit above the sample week;
    `plan-upgrade`'s bottom is at or above 608 px at 390 x 664 (native inside the 360 x 640 dp
    band).
  - P5 (D10), countered in part: signed out, Upgrade opens sign-in (web `/signin`, native the
    sign-in screen) and makes no purchase or entitlement call. Sign-in gains no return path in
    this story: a caller-supplied return address is an open-redirect surface of its own, and
    sign-in already lands the member in the app, one tap from Profile.
  - P6 (D5): a foreign id renders exactly like a removed id (no title, no image request);
    signed out sends no read.
  - P7 (D6): the `capsule` param is matched by equality against loaded ids, never put into a
    selector.
  - P8 (D2): a tile is one link whose accessible name is its name plus its state line; collage
    images have empty alt (native `accessible={false}`); 44 px; a failed photo swaps to the
    placeholder without a layout shift.
  - P9 (D3): the return snapshot holds both sources keyed by session scope; no previous
    member's tile shows after a switch.
  - P10 (D5): back from the detail returns to the origin filter in the app; Remove returns to
    Saved with the origin filter, and Undo restores the look.
  - Test ids added: `looks-filter-empty` on the filter empty line, `plan-free-day-0` to
    `plan-free-day-6` on the sample week rows.

- 2026-11-26, TEA P11 (D3): indexes `SavedLook_user_id_created_at_id_idx` (user_id, created_at
  desc, id asc) and `OutfitCapsule_user_id_created_at_id_idx`, migration
  `20261126120000_looks_feed_created_order`. The saved looks index leaves `deleted_at` out:
  `deleted_at IS NULL` is a filter that does not fix index order, so with it the plan still sorts
  (TEA proof on pg17).
- 2026-11-26, TEA code read T1-T3, all patch:
  - T1 (D4): a filter change resets the feed in the same render to that filter's snapshot or to
    unread, so the previous filter's tiles never show under the new one.
  - T2 (D5): a Saved tile always passes `from` (`all` included) and View passes none. Remove
    steps back when the look was opened from a tile and app history sits below; otherwise it
    replaces to Saved.
  - T3 (D5, CC-7.2 AC1): the detail keeps Reopen (`saved-look-reopen`) with the CC-7.2 rule (a
    ready Style this piece look whose anchor is in the closet and whose slots the editor rebuilds
    exactly) and hosts the Style this piece panel; the rule lives in
    `components/looks/saved-look-reopen.ts`.
- 2026-11-26, TEA T4 (D5, I/O row View), patch: the top bar back of a look opened by View (no
  `from`) replaces to `/looks?segment=saved` on web and dismisses to Looks Saved on native; a
  tile entry keeps the history back and a cold entry the replace. Browser and system back still
  return to the saving screen.
- 2026-11-26, builder, as built:
  - D9: an Ideas tile's line is the sample look's one-line description; sample looks carry no
    weather.
  - D8: the Closet page no longer reads saved looks, so its gate waits on the closet read only.
  - D6: the capsule manager reads `?capsule=` once on mount and focuses the matching card on its
    first load; a capsule beyond the manager's first page gets no focus.
  - D10: Profile's Premium section carries `id="premium"`; the planner's set-city return goes to
    `/looks?segment=plan`.
  - Analytics routes: web drops `/looks/plan` and `/wardrobe/capsules` and adds `/looks/capsules`
    and `/looks/saved/[savedLookId]`; mobile adds `/saved-look/[savedLookId]`.

## Review Triage Log

- 2026-11-26, Codex review (7.12-codex-review.md, 11 findings), verdicts:
  - #1 P1, patch: View after a save that confirmed an existing look did nothing; each save
    surface keeps the confirmed look id (created or existing) for View.
  - #2 P1, patch (TEA T4): the arrow of a View entry returns to Saved on web and native; browser
    and system back return to the saving screen, as every other back in the app.
  - #3 P2 Codex Security, patch: the web detail is keyed by the signed-in member, so an account
    switch never shows the previous member's look while the new read is pending.
  - #4 P2, patch: the capsule manager reads the tile's capsule on its own when its first page
    lacks it and shows it first (web and native).
  - #5 P2, patch: native refresh keeps the loaded depth of each list.
  - #6 P2, patch: native chooses the default segment after the first reads settle, even when the
    gate deadline opens first.
  - #7 P2, patch: photo failure is keyed by the signed URL (tiles and detail), and the web
    detail treats an expired URL as unusable.
  - #8 P2, patch: web Undo keeps Undo offline and Retry after a failed restore, one restore at a
    time.
  - #9 P2, TEA: stale native row test and Community dark-mode Plan assertions.
  - #10 P3, patch: the web route decodes safely; a malformed id reads as gone.
  - #11 P3, patch: the Ideas first-save line follows an empty All only.
  - Codex Security: one Medium (#3), 48 of 83 paths with full-file receipts, the rest in its
    coverage ledger.

## Design Notes

The address carries segment and filter so View, deep links, back and the redirects need no
extra state. The merge lives in utils because both apps page two sources and must agree on order.

## Verification

**Commands:**

- `npm run build -w packages/api-client`, `npm run build -w packages/utils`, then
  `npm exec -w <workspace> -- tsc --noEmit` for api, web, mobile, utils, api-client and
  `npx tsc -p playwright/tsconfig.json --noEmit` -- no errors.
- `npx eslint <touched files>` -- clean.
- CI: every workflow green for the head SHA.
