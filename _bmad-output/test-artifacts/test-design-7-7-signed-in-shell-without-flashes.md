# Test design: Story CC-7.7 signed-in shell without flashes

Updated: 2026-11-25. Initial plan from spec-7-7 (ready-for-dev, baseline 11c26918).
Updated: 2026-11-25. D3 amended (Profile gate waits for its commerce reads; signed-out Closet and
Profile in budget): E2E-001 adds a ritual 503 case, E2E-002 covers all four tabs signed out,
E2E-005 drops Profile (no late reads), E2E-010 is the production lane spec, D8 baseline recorded.

Status: active

## Scope

Spec: `_bmad-output/implementation-artifacts/spec-7-7-signed-in-shell-without-flashes.md`.
Acceptance criteria from epics.md CC-7.7:

1. Signed-in members never see signed-out or sample content before their own. Session resolution
   shows the fixed app shell with a neutral placeholder.
2. The tab bar, header and visible controls keep their position until loading completes, on web
   and native.
3. A section whose emptiness is unknown at first paint renders nothing until its data arrives,
   then appears only below the fold or at the end of the screen. No content is inserted above the
   viewport after the first tap on a screen.
4. Returning to a tab within the session shows its last content and scroll position at once and
   refreshes in place.
5. Rebaseline at 390 x 844 on production. A Chromium check runs cold navigation and scripted tab
   switches against fixed empty, populated and delayed responses, measures the full transition
   including shifts after input, and fails above 0.1 in the PR gate.
6. Transitions last 200 ms or less and become instant under reduced motion.

Plus spec decisions D1 (placeholder keyed on `data-session`), D2 (no demo or sample before the
member's own), D3 (one gate per tab body), D4 (late sections), D5 (memory snapshot per member),
D6 (motion), D7 (layout-shift budget) and D8 (production rebaseline).

## Stable hooks (builder, agreed 2026-11-25)

| Hook                                                        | Meaning                                       |
| ----------------------------------------------------------- | --------------------------------------------- |
| `app-header`                                                | Header of every web tab                       |
| `sticky-bottom-nav`, `bottom-nav-<id>`                      | Bottom tab bar and its links                  |
| `screen-gate` + `data-screen` + `data-ready="true"`         | Gate per tab body; `data-ready` absent before |
| `screen-placeholder` (`aria-busy="true"`)                   | Neutral placeholder                           |
| `home-demo-outfit`                                          | Signed-out demo outfit (new)                  |
| `guest-preview-entry`, `landing-sign-in`, `landing-sign-up` | Signed-out content a member must never see    |
| `member-sample-outfit`, `home-live-outfit`                  | Member sample and the member's own outfit     |

## Risk assessment

| ID  | Risk                                                                                     | P   | I   | Score | Mitigation (test IDs)                              |
| --- | ---------------------------------------------------------------------------------------- | --- | --- | ----- | -------------------------------------------------- |
| R1  | Member sees demo, sample, guest card or Sign in before their own content (AC1, D2)       | 3   | 3   | 9     | 7.7-E2E-001..004, 7.7-CMP-003..005, 7.7-NAT-002    |
| R2  | Layout shift above 0.1 on cold load or tab switch (AC5, the 0.574 owner walk)            | 3   | 3   | 9     | 7.7-E2E-001..006                                   |
| R3  | Meter blind: the check cannot see a shift, so a green gate proves nothing                | 2   | 3   | 6     | 7.7-UNIT-001..004, 7.7-E2E-007 (positive control)  |
| R4  | Header or tab bar moves while loading (AC2)                                              | 2   | 2   | 4     | 7.7-E2E-001..006 (rect sampler), 7.7-NAT-001       |
| R5  | Gate never opens or hides an error or Retry state (D3 "gate never hides an error")       | 2   | 3   | 6     | 7.7-CMP-002, 7.7-CMP-004, 7.7-CMP-007, 7.7-E2E-003 |
| R6  | Late section inserted above the viewport after the first tap (AC3, D4)                   | 2   | 2   | 4     | 7.7-E2E-005, 7.7-CMP-008, 7.7-NAT-004              |
| R7  | Snapshot leaks one member's content to the next member, or lands in storage (D5 privacy) | 2   | 3   | 6     | 7.7-UNIT-010..013, 7.7-E2E-009                     |
| R8  | Tab return shows placeholder again, loses scroll, or flashes busy on refresh (AC4)       | 2   | 2   | 4     | 7.7-CMP-001, 7.7-CMP-009, 7.7-E2E-008, 7.7-NAT-003 |
| R9  | Signed-out visitor gets a placeholder or a hidden page (regression of the landing)       | 2   | 3   | 6     | 7.7-E2E-002, 7.7-CMP-002                           |
| R10 | Transition over 200 ms, or animates under reduced motion (AC6, D6)                       | 2   | 1   | 2     | 7.7-UNIT-020..021, 7.7-NAT-005                     |
| R11 | Placeholder label missing in a locale                                                    | 1   | 1   | 1     | existing locale parity suites                      |

## Test inventory

Owner column: TEA writes and runs in CI; builder writes, TEA reviews.

### Meter and guards (TEA)

| ID           | Level                                                                                                                                            | Test                                                                                                                                  | Owner |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 7.7-UNIT-001 | unit                                                                                                                                             | Layout-shift meter sums every entry, `hadRecentInput` included (the standard score drops them)                                        | TEA   |
| 7.7-UNIT-002 | unit                                                                                                                                             | Meter window: entries before the window start do not count; the transition delta equals entries between start and settle              | TEA   |
| 7.7-UNIT-003 | unit                                                                                                                                             | Settle rule: quiet period resets on a new shift, a pending stubbed request or a missing `data-ready`; settles only when all are clear | TEA   |
| 7.7-UNIT-004 | unit                                                                                                                                             | Rect sampler reports the first frame whose header or tab bar rect differs from frame 0, with the delta                                | TEA   |
| 7.7-UNIT-005 | Fixture router: `readKey` tells the two Spotlight reads apart, serves only the resolve POST, knows every gate read (`shell-fixtures.spec.ts`)    | TEA                                                                                                                                   |
| 7.7-UNIT-006 | Fixture router: `fixtureOwner` reads the member from a fixture bearer and is null for any other, so E2E-009 serves each member their own content | TEA                                                                                                                                   |
| 7.7-UNIT-020 | unit                                                                                                                                             | Web motion budget: no CSS animation or transition and no Tailwind `duration-*` above 200 ms in `apps/web/src`                         | TEA   |
| 7.7-UNIT-021 | unit                                                                                                                                             | Native motion budget: no literal `duration` or `animationDuration` above 200 in `apps/mobile/app`, `src`, `components`                | TEA   |

### Web E2E: `playwright/tests/signed-in-shell-layout-shift.spec.ts` (TEA)

Chromium, viewport 390 x 844, production build (`pr-pw-e2e-local.yml`, sharded with
playwright-smart-parallelization, watched by PR Gate). Signed in with a `localE2EAccessToken`
bearer in session storage before load. Fixed responses through `interceptNetworkCall` handlers,
declared before navigation; modes:

- **empty**: every gate read answers its empty body.
- **populated**: every gate read answers one or two items.
- **delayed**: every stubbed read answers the populated body after 3 s.
- **late**: gate reads answer at once; every other stubbed read after 3 s.

Responses come from `playwright/support/helpers/shell-fixtures.ts`: one `interceptNetworkCall`
handler serves every read the four tabs make on mount (bodies parsed by the published schemas
where one exists), counts the ones in flight for the settle rule, and records every other
`/api/v1` GET so the spec fails by name when a tab starts a read nobody stubbed. The community
realtime socket is closed (`routeWebSocket`), which leaves the grid on events polling.

Score: sum of every `layout-shift` entry value, `hadRecentInput` included, from navigation start
(cold) or the tab tap (switch) until the transition settles: `screen-gate[data-ready="true"]` for
the active screen, no stubbed request in flight, and 1 s without a new shift entry. Above 0.1
fails and the failure names the shifted nodes (entry `sources`).

| ID          | Test                                                                                                                                                                                                                                                                             | Owner |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 7.7-E2E-001 | Member cold load of Home, Closet, Community, Profile x empty, populated, delayed (12 cases), plus Home with ritual 503: score at most 0.1; header and tab bar rects constant every frame; Retry visible on 503                                                                   | TEA   |
| 7.7-E2E-002 | Signed-out cold load of every tab: score at most 0.1; header and tab bar still; no `screen-placeholder` ever visible; `landing-sign-in` visible on Home                                                                                                                          | TEA   |
| 7.7-E2E-003 | AC1 sampler on every member case of E2E-001: `home-demo-outfit`, `guest-preview-entry`, `landing-sign-in`, `landing-sign-up` never visible in any frame; `member-sample-outfit` only after the ritual read settled (empty and 5xx only)                                          | TEA   |
| 7.7-E2E-004 | Placeholder shown with `aria-busy` while delayed reads are pending, gone once `data-ready`; body appears once                                                                                                                                                                    | TEA   |
| 7.7-E2E-005 | Late mode on Home and Community: gate reads at once, every other read 3 s late; tap the header title while a late read is pending; score after the tap is 0 (Closet and Profile have only gate reads)                                                                            | TEA   |
| 7.7-E2E-006 | Tab switch Home > Closet > Community > Profile > Home x empty, populated, delayed: each transition at most 0.1, shifts after the tap included                                                                                                                                    | TEA   |
| 7.7-E2E-007 | Positive control: a 300 px block inserted above the content after first paint scores above 0.1 with the same meter (proves R3)                                                                                                                                                   | TEA   |
| 7.7-E2E-008 | Tab return: scroll Closet, go to Community, back to Closet: first frame shows the grid at the same scroll offset, no placeholder in any frame, refresh request sent                                                                                                              | TEA   |
| 7.7-E2E-009 | Owner change in one document, two paths: (a) `landing-sign-out`, then member B bearer plus `couture:session`; (b) bearer swap without sign-out. From the switch on, no frame renders member A outfit text; B Home opens through the gate (first frame not ready); B outfit shows | TEA   |
| 7.7-E2E-010 | Production lane (`signed-in-shell-layout-shift.prod.spec.ts`), read-only, every non-GET aborted: each tab cold, signed out and as the synthetic member, at most 0.1; member never sees signed-out content                                                                        | TEA   |

### Web component and unit (builder, vitest)

| ID           | Test                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.7-UNIT-010 | `screen-snapshot`: remember and recall per owner and screen; cap four tabs                                                                                                   |
| 7.7-UNIT-011 | `screen-snapshot`: owner change via `couture:session` clears it; sign-out clears it; recall for another owner returns nothing                                                |
| 7.7-UNIT-012 | `screen-snapshot`: `Storage.prototype.setItem` never called (no localStorage or sessionStorage)                                                                              |
| 7.7-UNIT-013 | `use-web-session`: a remount with a known session starts at the member state, never `checking`                                                                               |
| 7.7-CMP-001  | `ScreenGate` with a snapshot: opens at once, `scrollTo` runs before paint (layout effect), refresh shows no placeholder                                                      |
| 7.7-CMP-002  | `ScreenGate`: placeholder testid, `aria-busy`, one hidden "Loading" label; children mounted while hidden; `data-ready` on success, empty and error; signed-out opens at once |
| 7.7-CMP-003  | `MemberRitual` never renders `SampleOutfit` while the ritual read is unsettled                                                                                               |
| 7.7-CMP-004  | Ritual empty renders `member-sample-outfit`; ritual 5xx renders sample, failure copy and `home-outfit-retry`                                                                 |
| 7.7-CMP-005  | Home teaser joins the Home gate: the gate opens only after ritual and Spotlight teaser settle                                                                                |
| 7.7-CMP-006  | Closet gate waits for inventory and onboarding; setup banner present at reveal                                                                                               |
| 7.7-CMP-007  | Community gate waits for first feed page and Spotlight; Spotlight error renders inside the gate                                                                              |
| 7.7-CMP-008  | New-looks pill renders as an overlay; list top offset unchanged when it appears                                                                                              |
| 7.7-CMP-009  | Bottom-nav links render with `scroll={false}`                                                                                                                                |

### Native (builder, jest)

| ID          | Test                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.7-NAT-001 | Tabs shell renders during `restoring` with the placeholder per tab body; tab bar present                                                              |
| 7.7-NAT-002 | Home never renders the member sample outfit before the ritual and weather reads settle                                                                |
| 7.7-NAT-003 | Refocus refresh does not set the initial loading state; content stays                                                                                 |
| 7.7-NAT-004 | Community new-looks pill is an overlay; weather alert and stale banners join the Home gate                                                            |
| 7.7-NAT-005 | `useModalAnimation`: `none` under reduce motion, `fade` or `slide` otherwise; stack `animationDuration: 200`, `animation: 'none'` under reduce motion |

## Production rebaseline (D8, TEA)

Read-only: 390 x 844 headless Chromium (mobile, touch) against `https://couture-cast-web.vercel.app`,
GET requests only (every other method aborted), the same meter (`installMeter`), cold load, settled
after 3 s without a new shift. Positive control on the same page: a 300 px block prepended to
`main` scored 0.34, so the zeros are real.

Baseline 2026-11-25 on main `11c26918`, three runs each:

| Surface                     | Before (2026-11-21, 500 px) | Baseline 390 x 844 (main)  | Shifted nodes                                                                           |
| --------------------------- | --------------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| Home, signed out            | n/a                         | 0, 0, 0                    | none                                                                                    |
| Closet, signed out          | n/a                         | 0.1157 x 3                 | `wardrobe-closet-view` at about 415 ms                                                  |
| Community, signed out       | n/a                         | 0.0018 x 3                 | small                                                                                   |
| Profile, signed out         | n/a                         | 0.5143, 0.5143, 0.5231     | `commerce-preferences-section`, `premium-subscription-section`, `premium-theme-section` |
| Home, prod synthetic member | 0.574                       | after merge (decision D8a) |                                                                                         |

Every recorded entry carried `hadRecentInput: true` although no input was sent, so the browser's
cumulative layout shift would have reported 0 for all of them. This is why the meter sums every
entry (7.7-UNIT-001).

Decision D8a (TEA, owner delegated): the prod synthetic member password lives only in GitHub
secrets (`.env.prod` has none), so the member measurement cannot run from a workstation without a
write to the account. `playwright/tests/signed-in-shell-layout-shift.prod.spec.ts` measures Home
as the synthetic member, read-only, in the Prod E2E lane that runs after the merge deploys; its
first run is the member rebaseline and is recorded here.

## Execution

CI is the proof. TEA specs run in `pr-pw-e2e-local.yml`; meter unit specs in the Playwright helper
unit job (`test:playwright-unit`); motion guards with the web and mobile vitest/jest suites.
Locally only tsc and eslint on touched files.

## Exit criteria

- Every test above green on the head SHA in every workflow (`gh pr checks`).
- E2E-007 fails the budget with the control block and passes without it.
- D8 table filled.
