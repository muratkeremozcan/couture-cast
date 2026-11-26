# Test design: Story CC-7.12 Looks tab for saved looks, ideas and plans

Updated: 2026-11-26. Builder accepted P1 to P4, P6 to P11; P5 countered in part and accepted:
signed-out Upgrade opens sign-in with no return path (a caller-supplied return address is its own
open-redirect surface). P11 adds the created-order indexes and 7.12-INT-005.

Updated: 2026-11-26. Initial plan from spec-7-12 (in-progress, baseline a8863b05), decisions D1
to D13, with TEA pushback P1 to P10 sent to the builder.

Status: active

## Scope

Spec: `_bmad-output/implementation-artifacts/spec-7-12-looks-tab-saved-looks-ideas-plans.md`.
Acceptance criteria from epics.md CC-7.12:

1. Looks has Saved, Ideas and Plan segments; opens on Saved with a saved look, else Ideas.
2. Saved lists saved looks and capsules newest first as picture tiles with a name and one state
   line; filters All, Today, Capsules.
3. Ideas shows sample looks until CC-7.22.
4. Plan shows the Premium week; free members see a sample week, one line and one Upgrade; no
   other screen shows a Planner lock; Today's "Plan your week" opens Plan in one tap.
5. `/wardrobe/capsules` redirects to Looks with Capsules; every save confirmation's View opens
   the saved look in Looks; the Closet "Saved looks" row is removed.
6. Tests prove each segment's first content above the fold at 390 x 664, deep links to a saved
   look with back to Saved, and no lock outside Plan for a free account.

## Pushback sent to the builder (P1 to P10)

- P1 Default segment without a flash (D1). The gate holds until both first reads (saved looks
  and capsules) settle; Looks never paints Ideas and then flips to Saved, and never paints
  Saved and flips to Ideas. A failed read counts as settled and opens Saved with the error line
  (a member with looks must not land on Ideas because the API blinked). The default is computed
  once per entry: removing the last look while on Saved keeps Saved with its empty line. Tests
  7.12-UNIT-020, 7.12-E2E-003, 7.12-E2E-004.
- P2 Filters read the server, not a filtered merge (D4). Today reads saved looks with
  `source=home_sample&sort=created_desc` and no capsules; Capsules reads capsules only. Filtering
  merged pages on the client can show an empty line while unloaded pages still hold matches.
  Tests 7.12-UNIT-024, 7.12-E2E-013.
- P3 One tie order across sources (D3). Both endpoints sort `created_at desc, id asc`; the merge
  must use the same key with a fixed source order on an exact tie (saved look before capsule),
  so web, native and every Load more agree. Tests 7.12-UNIT-001 to 006, 7.12-INT-002.
- P4 Free Plan offer within the fold (D10, AC4). At 390 x 664 the one line and `plan-upgrade`
  sit above the sample week, or the week is compact enough that `plan-upgrade` bottom is at or
  above 608 px. A member who never scrolls must see what Premium adds. Test 7.12-E2E-030.
- P5 Signed-out and guardian-pending Upgrade (D10). Signed out, `plan-upgrade` opens sign-in
  (web `/signin`, native sign-in screen) with no return path, by builder counter; it never calls a
  purchase or entitlement endpoint.
  Guardian-pending teens see the same preview; the Upgrade target keeps the existing teen
  purchase rules (no change here). Tests 7.12-E2E-033, 7.12-E2E-061.
- P6 Detail privacy (D5). `/looks/saved/{id}` for another member's look shows "This look is no
  longer saved" with the same response as a removed id (no title, no garment image request, no
  existence hint). Signed out, no saved look read is sent. Tests 7.12-INT-010, 7.12-E2E-022,
  7.12-E2E-023.
- P7 Capsule focus param (D6). `?capsule={id}` is matched against loaded capsule ids by equality
  (no CSS selector or `querySelector` built from the raw value); an unknown or foreign id scrolls
  nowhere and shows no error. Test 7.12-UNIT-041, 7.12-E2E-042.
- P8 Tile accessibility (D2). The tile is one link whose accessible name is the look name plus
  its state line; collage images are decorative (`alt=""`, native `accessible={false}`); target
  at least 44 px; a failed photo swaps to the dashed placeholder without layout shift.
  Tests 7.12-UNIT-030 to 033, 7.12-E2E-012.
- P9 Member switch (CC-7.7 D5). The Looks screen snapshot now holds both sources; after a member
  change the first paint shows no tile of the previous member. Test 7.12-UNIT-022.
- P10 Back from detail keeps the filter (D5). In-app entry from `filter=today` or
  `filter=capsules` returns there with `router.back()`; a cold entry replaces to
  `/looks?segment=saved`. Remove returns to `/looks?segment=saved` with the filter the member
  came from, and the Undo bar restores the tile in place. Tests 7.12-E2E-020, 7.12-E2E-021,
  7.12-E2E-024.

## Risk assessment

| ID  | Risk                                                                                     | P   | I   | Score | Mitigation (tests)                       |
| --- | ---------------------------------------------------------------------------------------- | --- | --- | ----- | ---------------------------------------- |
| R1  | Merge pages out of order or drops or repeats a tile across Load more                     | 3   | 3   | 9     | UNIT-001..006, UNIT-021, INT-001..003    |
| R2  | View, deep link or back strands the member or lands on the wrong segment or filter       | 3   | 3   | 9     | E2E-020..026, NAT-020..024, P10          |
| R3  | A Planner lock survives on another screen, or Plan shows a lock instead of the free week | 3   | 3   | 9     | E2E-030..034, UNIT-050, NAT-030..032     |
| R4  | Default segment flashes or picks Ideas for a member with looks after a read error        | 2   | 3   | 6     | UNIT-020, E2E-003..004, P1               |
| R5  | Another member's saved look title or images exposed through the deep link                | 1   | 3   | 3     | INT-010, E2E-022, P6                     |
| R6  | Legacy routes (`/wardrobe/capsules`, `/looks/plan`, `/?planner=1`, native planner) 404   | 2   | 3   | 6     | E2E-040..041, E2E-035, UNIT-060, NAT-033 |
| R7  | Closet row removal breaks saved-look flows (undo, needs-review repair) that lived there  | 2   | 3   | 6     | E2E-024..026, legacy spec sweep          |
| R8  | Segment fold budget broken (filters plus segments push the first tile under the tab bar) | 2   | 2   | 4     | E2E-001, BUD-001..002, NAT-010           |
| R9  | Missing or 10-locale strings drift (lock strings left, new keys absent)                  | 2   | 2   | 4     | UNIT-070..071, de-DE strings specs       |
| R10 | `sort` param changes default order for existing callers                                  | 1   | 3   | 3     | INT-003, PACT-001..002                   |
| R11 | Capsule focus param used unsafely in a selector                                          | 1   | 2   | 2     | UNIT-041, P7                             |

## Test levels

| Level                   | File                                                                                                     | Owner | Runs in                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ----- | ------------------------------ |
| Unit, node              | `packages/utils/src/looks-feed.test.ts`, `sample-wardrobe/sample-week.test.ts`                           | TEA   | utils vitest (coverage gate)   |
| API integration (pg17)  | `apps/api/integration/looks-sort.integration.spec.ts`, saved look GET ownership (extended)               | TEA   | api integration CI             |
| Contract                | `pact/http/consumer/interactions/wardrobe-saved-looks.ts`, `wardrobe-capsules.ts` (sort interactions)    | TEA   | pact consumer and provider CI  |
| Unit, web (jsdom)       | `looks-screen.test.tsx`, `looks-tile.test.tsx`, `saved-look-detail.test.tsx`, `planner-rail.test.tsx`    | TEA   | web vitest                     |
| E2E, web                | `playwright/tests/looks-tab.spec.ts` (segments, filters, tiles, fold, Ideas)                             | TEA   | pw-e2e smart shards            |
| E2E, web                | `playwright/tests/looks-saved-look-detail.spec.ts` (View, deep link, back, remove, privacy)              | TEA   | pw-e2e smart shards            |
| E2E, web                | `playwright/tests/looks-plan.spec.ts` (free preview, premium week, no lock elsewhere, one-tap Plan)      | TEA   | pw-e2e smart shards            |
| Component, native (RNW) | `apps/mobile/src/screens/looks-screen.test.tsx`, `saved-look-detail.test.tsx`, `planner-screen.test.tsx` | TEA   | mobile vitest browser coverage |
| Screen budget (CC-7.10) | `screen-budget.spec.ts` looks per segment, native `screen-budget-looks.test.tsx`                         | TEA   | as in 7.10                     |
| Device flow (nightly)   | `maestro/looks-tab.yaml` (new), `premium-planner.yaml`, `subflows/open-capsules.yaml` updated            | TEA   | nightly / dispatch only        |

Native layout claims run in the CC-7.10 RNW Chromium harness (accepted risk 7.10-R8); fold at
360 x 640 dp per CC-7.11 P4. Maestro stays nightly; PR proof for native is the RNW suite.

## Coverage plan

### Unit: merge and sample data (`packages/utils`)

| ID            | Scenario                                                                                                                     | AC / D |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.12-UNIT-001 | Two fully loaded sources interleave by `createdAt` desc; output length equals the sum; no id repeats                         | 2, D3  |
| 7.12-UNIT-002 | Boundary: with more looks unloaded, no capsule older than the last loaded look is shown; it appears after the next look page | 2, D3  |
| 7.12-UNIT-003 | Next source: names the source whose last loaded item is newest among those with more; none when both are exhausted           | D3     |
| 7.12-UNIT-004 | Exact `createdAt` tie across sources: saved look first, then by id asc; same result whatever page arrives first              | D3, P3 |
| 7.12-UNIT-005 | Property test (seeded random 60 looks, 3 capsules, page size 50): repeated Load more yields the global sort with no gaps     | 2, D3  |
| 7.12-UNIT-006 | One source empty or failed-at-zero: the other pages alone; an empty pair yields no items and no next source                  | D3     |
| 7.12-UNIT-007 | Sample week: seven days Monday to Sunday, each a sample look id present in `SAMPLE_CATALOG`, no member data                  | 4, D10 |

### API integration and contract

| ID            | Scenario                                                                                                                    | AC / D  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | ------- |
| 7.12-INT-001  | Saved looks `sort=created_desc` returns `created_at desc, id asc` across two pages (limit 2), stable offsets                | 2, D3   |
| 7.12-INT-002  | Capsules `sort=created_desc` same order rule; equal `created_at` rows ordered by id asc                                     | D3, P3  |
| 7.12-INT-003  | Without `sort` both lists keep their existing order (updated_at desc); invalid `sort` value is a 400                        | R10     |
| 7.12-INT-004  | `source=home_sample&sort=created_desc` filters and orders together                                                          | D4, P2  |
| 7.12-INT-005  | EXPLAIN of both lists with `sort=created_desc` uses the P11 index (no Sort node over a seq scan)                            | D3, P11 |
| 7.12-INT-010  | GET saved look of another member and of a deleted id: same status and body shape, no title                                  | D5, P6  |
| 7.12-PACT-001 | Consumer: list saved looks with `sort=created_desc` (provider state with two looks), matchers on order-relevant `createdAt` | D3      |
| 7.12-PACT-002 | Consumer: list capsules with `sort=created_desc`; provider doubles honour the param                                         | D3      |

### Unit, web (jsdom)

| ID            | Scenario                                                                                                                     | AC / D  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| 7.12-UNIT-020 | Default segment: looks read pending shows the gate; one look opens Saved; none opens Ideas; looks read error opens Saved     | 1, P1   |
| 7.12-UNIT-021 | Load more calls the source `looks-feed` names; tiles stay in order after it                                                  | 2, D3   |
| 7.12-UNIT-022 | Member change: no previous member tile on first paint (snapshot keyed by scope)                                              | P9      |
| 7.12-UNIT-023 | Segment and filter changes call `router.replace` with the address; unknown values fall back to the default                   | D1, D4  |
| 7.12-UNIT-024 | Today filter reads `source=home_sample` only and no capsules; Capsules reads capsules only; empty lines from the catalog     | D4, P2  |
| 7.12-UNIT-030 | Tile state line order: missing pieces (1 and many, plural) before Needs review before Saved date; capsule uses unavailable   | 2, D2   |
| 7.12-UNIT-031 | Tile collage: first four pieces; catalog art for catalog slots; dashed placeholder on missing; image error swaps in place    | 2, D2   |
| 7.12-UNIT-032 | Tile is one link; accessible name is name plus state; images `alt=""`                                                        | P8      |
| 7.12-UNIT-033 | Saved date uses the locale short month and day (en-US, de-DE)                                                                | D2, D12 |
| 7.12-UNIT-040 | Detail: loads one look, shows missing and needs-review notices, Remove deletes and navigates with the origin filter          | D5, P10 |
| 7.12-UNIT-041 | Capsules manager `?capsule=`: known id scrolls and focuses; unknown and `"]'><img>` style values do nothing                  | D6, P7  |
| 7.12-UNIT-050 | Planner rail locked and signed-out states render `plan-free-preview` (seven days, one line, one `plan-upgrade`), no lock ids | 4, D10  |
| 7.12-UNIT-051 | Planner rail entitled renders the week; disabled, error, loading and set-city states unchanged                               | 4, D10  |
| 7.12-UNIT-060 | `next.config` redirects: `/wardrobe/capsules` (query kept), `/looks/plan`, `/?planner=1` targets and permanence              | 4, 5    |
| 7.12-UNIT-061 | Sub-screen parent map: `/looks/saved/[id]` and `/looks/capsules` resolve to Looks with their D5 and D6 parent addresses      | D5, D6  |

### E2E web: Looks tab (`looks-tab.spec.ts`, 390 x 664 unless noted)

| ID           | Scenario                                                                                                                                              | AC / D |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.12-E2E-001 | Each segment, populated and empty: `looks-first-content` bottom at or above 608 px; Saved first tile fully inside the band                            | 6, D13 |
| 7.12-E2E-002 | Segments are `role=tab` in order Saved, Ideas, Plan; `aria-selected` on the open one; switching replaces history (one back leaves Looks)              | 1, D1  |
| 7.12-E2E-003 | Member with one saved look opens on Saved; a member with only a capsule opens on Saved; empty member opens on Ideas with "Save a look to see it here" | 1, P1  |
| 7.12-E2E-004 | No flash: layout-shift meter and a paint observer record no Ideas paint before Saved for a member with looks                                          | 1, P1  |
| 7.12-E2E-010 | Newest first: look A, capsule B, look C created in order show C, B, A                                                                                 | 2, D3  |
| 7.12-E2E-011 | State lines: a look with one missing garment reads "1 piece missing"; needs-review reads "Needs review"; others "Saved {date}"                        | 2, D2  |
| 7.12-E2E-012 | Tile opens its target in one click: look to `/looks/saved/{id}`, capsule to `/looks/capsules?capsule={id}` focused                                    | 2, D6  |
| 7.12-E2E-013 | Filters: Today shows only home sample looks; Capsules only capsules plus `looks-manage-capsules`; empty lines; `aria-pressed`                         | 2, D4  |
| 7.12-E2E-014 | Ideas: `looks-idea-card-*` tiles with a name and a weather line; no button inside Ideas                                                               | 3, D9  |
| 7.12-E2E-015 | Signed-out visitor: Ideas opens; Saved asks to sign in; no saved look or capsule request sent                                                         | 1, D1  |
| 7.12-E2E-016 | Closet has no saved looks row (populated member with saved looks)                                                                                     | 5, D8  |

### E2E web: saved look detail (`looks-saved-look-detail.spec.ts`)

| ID           | Scenario                                                                                                               | AC / D  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- | ------- |
| 7.12-E2E-020 | Save on Today, tap View: `/looks/saved/{id}` with the top bar title; back lands on `/looks?segment=saved`              | 5, 6    |
| 7.12-E2E-021 | Cold deep link: detail renders; back replaces to `/looks?segment=saved`; history length unchanged                      | 6, D5   |
| 7.12-E2E-022 | Deep link to a removed look and to another member's look: "This look is no longer saved", back works, no image request | D5, P6  |
| 7.12-E2E-023 | Signed out deep link asks to sign in, sends no saved look read                                                         | D5, P6  |
| 7.12-E2E-024 | Remove from detail: back on Saved with the origin filter, Undo restores the tile at its place                          | D5, P10 |
| 7.12-E2E-025 | Style this piece save, View: opens the detail (same as Today)                                                          | 5, D7   |
| 7.12-E2E-026 | In-app entry from `filter=today`: back returns to `filter=today`                                                       | P10     |

### E2E web: Plan (`looks-plan.spec.ts`)

| ID           | Scenario                                                                                                                        | AC / D |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.12-E2E-030 | Free member on Plan: `plan-free-preview` has seven day rows, the one line, exactly one `plan-upgrade` above 608 px, no lock id  | 4, P4  |
| 7.12-E2E-031 | Entitled member on Plan: the week renders, no `plan-free-preview`, no `plan-upgrade`                                            | 4      |
| 7.12-E2E-032 | Free member walk of every tab and sub-screen in the CC-7.11 back table: no `planner-*-locked*` id, no lock string, no lock icon | 4, 6   |
| 7.12-E2E-033 | Signed out: Plan shows the preview; Upgrade opens `/signin`; no purchase or entitlement call                                    | 4, P5  |
| 7.12-E2E-034 | Today "Plan your week" opens `/looks?segment=plan` in one click for free, premium and signed-out members                        | 4, D11 |
| 7.12-E2E-035 | `/looks/plan` and `/?planner=1` land on `/looks?segment=plan` (server redirect status, no client flash)                         | D11    |

### E2E web: capsules move (`looks-tab.spec.ts`)

| ID           | Scenario                                                                                                          | AC / D |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ------ |
| 7.12-E2E-040 | `/wardrobe/capsules` and `/wardrobe/capsules?x=1` redirect to `/looks?segment=saved&filter=capsules` (query kept) | 5, D6  |
| 7.12-E2E-041 | `/looks/capsules` top bar "Outfit capsules"; back returns to Looks Capsules filter; create still works            | D6     |
| 7.12-E2E-042 | `?capsule=` unknown or foreign id: no scroll, no error, page usable                                               | P7     |

### Native (RNW Chromium harness, 360 x 640)

| ID           | Scenario                                                                                                            | AC / D  |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ------- |
| 7.12-NAT-001 | Segments with roles and selected state; `setParams` on change; default Saved with a look, Ideas empty, gate pending | 1, D1   |
| 7.12-NAT-002 | Saved tiles newest first via `looks-feed`; state lines; filters read the server per P2                              | 2, D3   |
| 7.12-NAT-003 | Ideas tiles from `SAMPLE_CATALOG`, no pressable inside                                                              | 3, D9   |
| 7.12-NAT-010 | Each segment's `looks-first-content` above the tab bar at 360 x 640; free Plan Upgrade inside the band              | 6, P4   |
| 7.12-NAT-020 | `saved-look/[id]` top bar title and back; cold entry replaces to Looks `segment=saved`; `PARENT_TAB` entry          | 6, D5   |
| 7.12-NAT-021 | Gone or foreign id: "This look is no longer saved"                                                                  | D5, P6  |
| 7.12-NAT-022 | Remove returns to Saved and shows Undo                                                                              | D5      |
| 7.12-NAT-023 | Home sample save shows View; View, Style this piece View open `saved-look/{id}`                                     | 5, D7   |
| 7.12-NAT-024 | Wardrobe hub renders no saved looks row                                                                             | 5, D8   |
| 7.12-NAT-030 | Planner screen locked and signed-out render `plan-free-preview`, one `plan-upgrade` to `/settings`; no lock ids     | 4, D10  |
| 7.12-NAT-031 | `home-plan-week` and Profile `planner-link` open Looks with `segment=plan` in one press                             | 4, D11  |
| 7.12-NAT-032 | Source scan: no `planner-locked` or lock string key referenced anywhere in `apps/mobile` and `apps/web` sources     | 4       |
| 7.12-NAT-033 | `planner` route redirects to Looks `segment=plan`; `wardrobe-capsules` parent is Looks; `capsule` param focuses     | D6, D11 |

### Strings, budget, guardian-pending

| ID            | Scenario                                                                                               | AC / D |
| ------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| 7.12-UNIT-070 | New `looks.*` keys present and non-empty in all 10 web and 10 mobile locales; placeholders match en-US | D12    |
| 7.12-UNIT-071 | Removed lock keys absent from every catalog (premium-locales and planner-locales specs updated)        | 4, D12 |
| 7.12-BUD-001  | Budget measures Looks per segment (Saved, Ideas, Plan) and fixture on web; new tile selectors counted  | D13    |
| 7.12-BUD-002  | Native budget looks per segment                                                                        | D13    |
| 7.12-E2E-060  | Guardian-pending teen: every segment, the detail and the capsules manager open with the same taps      | always |
| 7.12-E2E-061  | Guardian-pending teen on Plan sees the preview with Upgrade; target keeps teen purchase rules          | P5     |

## Legacy specs and tests to update (TEA)

Web unit: `looks/page.test.tsx`, `looks/plan/page.test.tsx` and `legacy-redirect.test.ts` (route
removed, redirect asserted in UNIT-060), `wardrobe/capsules/page.test.tsx` (moves to
`looks/capsules`), `wardrobe/saved-looks-row.test.tsx` (moves to `saved-look-detail.test.tsx`),
`wardrobe/page.test.tsx`, `page.styling.test.tsx`, `planner-rail.test.tsx`,
`planner-rail-session.test.tsx`, `lookbook-prism-layout.test.tsx`, `app-top-bar.test.tsx`,
`sticky-bottom-nav.test.tsx`, `app-history*.test.ts`, `member-sections-recheck.test.tsx`,
locale specs. Native: `saved-looks-row.test.tsx`, wardrobe hub tests, `planner-screen.test.tsx`,
`wardrobe-capsules-screen.test.tsx`, `member-sample-outfit.test.tsx`, `five-tab-navigation`,
`app-top-bar*.test.tsx`, `screen-budget-looks|home.test.tsx`, `root-layout-startup`,
`dark-mode-chrome`, `wardrobe-de-de-strings`, locale specs. Playwright: `planner`,
`premium-subscription`, `saved-looks-follow-account`, `wardrobe-capsule-*`,
`wardrobe-garment-delete`, `five-tab-navigation`, `sub-screen-back`, `mobile-viewport-overflow`,
`accessibility-hardening`, `app-shell-*`, `lookbook-prism`, `first-use-member-recovery`,
`community-dark-mode`. API integration capsule specs (default order unchanged). Maestro
`premium-planner.yaml`, `subflows/open-capsules.yaml`.

Rule: a selector or route change is a rename; a removed assertion gets the new behaviour asserted
in the same test (lock panel becomes the free preview, Closet row becomes the Looks tile), so
nothing loosens silently. Any replaced or loosened assertion goes to Codex before merge.

## Quality gates

- New specs burn in with `--repeat-each=3` through CI dispatch; zero flakes.
- No `waitForTimeout`; web-first assertions or `recurse`; network counts with
  `interceptNetworkCall`; API seeding with `apiRequest` (playwright-utils mandate); specs import
  `test` from merged fixtures. Pact interactions through `@seontechnologies/pactjs-utils`.
- Each assertion has a failing control: E2E-030 also runs on the entitled member; E2E-032 runs
  its lock probe on Plan first and must find the preview there; E2E-010 seeds out of id order.
- CI: every workflow green on the head SHA (`gh pr checks`).
