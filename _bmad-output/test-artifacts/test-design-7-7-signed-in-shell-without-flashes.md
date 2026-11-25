# Test design: Story CC-7.7 signed-in shell without flashes

Updated: 2026-11-25. Initial plan from spec-7-7 (ready-for-dev, baseline 11c26918).
Updated: 2026-11-25. Builder web fixes after CI and CodeRabbit r1: 7.7-CMP-030..044; the Profile
gate no longer waits on the account read; the Home hero and legal links sit outside the gate.
Updated: 2026-11-25. CI on 61d7156e and CodeRabbit round 1: reduced motion for modals moved into
`EdgeToEdgeModal` so `share-card-composer.tsx` keeps the blob the Story 6.9 iPad anchor proof
records (native-harness `U-HARNESS-IPAD-EVIDENCE`); 7.7-CMP-021; E2E-009 holds reads with
`router.hold`; the resolve fixture looks up by postId.
Updated: 2026-11-25. Codex fixes from the builder: 7.7-UNIT-014..015, 7.7-CMP-010..019,
7.7-NAT-006; Home gate also waits for the city line (`locations`) and deep-link focus.
Updated: 2026-11-25. Codex review: member baseline at 390 x 844 recorded before merge (P2-11);
meter samples from the first frame, every member case proves member content per tab, fixtures
refuse member reads without a bearer, stored-session case 7.7-E2E-011 (P2-10).
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

| ID           | Level                                                                                                                                                                                                                                                                                                                                | Test                                                                                                                                  | Owner |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 7.7-UNIT-001 | unit                                                                                                                                                                                                                                                                                                                                 | Layout-shift meter sums every entry, `hadRecentInput` included (the standard score drops them)                                        | TEA   |
| 7.7-UNIT-002 | unit                                                                                                                                                                                                                                                                                                                                 | Meter window: entries before the window start do not count; the transition delta equals entries between start and settle              | TEA   |
| 7.7-UNIT-003 | unit                                                                                                                                                                                                                                                                                                                                 | Settle rule: quiet period resets on a new shift, a pending stubbed request or a missing `data-ready`; settles only when all are clear | TEA   |
| 7.7-UNIT-004 | unit                                                                                                                                                                                                                                                                                                                                 | Rect sampler reports the first frame whose header or tab bar rect differs from frame 0, with the delta                                | TEA   |
| 7.7-UNIT-005 | Fixture router: `readKey` tells the two Spotlight reads apart, serves only the resolve POST, knows every gate read (`layout-shift-meter.spec.ts`)                                                                                                                                                                                    | TEA                                                                                                                                   |
| 7.7-UNIT-006 | Fixture router: `fixtureOwner` reads the member from a fixture bearer and is null for any other, so E2E-009 serves each member their own content                                                                                                                                                                                     | TEA                                                                                                                                   |
| 7.7-UNIT-020 | unit                                                                                                                                                                                                                                                                                                                                 | Web motion budget: no CSS animation or transition and no Tailwind `duration-*` above 200 ms in `apps/web/src`                         | TEA   |
| 7.7-UNIT-021 | Native motion budget: every `Animated.timing`/`withTiming` gives a literal duration of at most 200 (comments ignored); root stack `animationDuration` at most 200; a bare `Modal` takes its animation from the shared hook, and `EdgeToEdgeModal` (the wrapper every app modal opens through) applies the reduced-motion rule itself | TEA                                                                                                                                   |

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

| ID          | Test                                                                                                                                                                                                                                                                                                                                                                              | Owner |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 7.7-E2E-001 | Member cold load of Home, Closet, Community, Profile x empty, populated, delayed (12 cases), plus Home with ritual 503: score at most 0.1; header and tab bar rects constant every frame; Retry visible on 503                                                                                                                                                                    | TEA   |
| 7.7-E2E-002 | Signed-out cold load of every tab: score at most 0.1; header and tab bar still; no `screen-placeholder` ever visible; `landing-sign-in` visible on Home                                                                                                                                                                                                                           | TEA   |
| 7.7-E2E-003 | AC1 sampler on every member case of E2E-001: `home-demo-outfit`, `guest-preview-entry`, `landing-sign-in`, `landing-sign-up` never visible in any frame; `member-sample-outfit` only after the ritual read settled (empty and 5xx only)                                                                                                                                           | TEA   |
| 7.7-E2E-004 | Placeholder shown with `aria-busy` while delayed reads are pending, gone once `data-ready`; body appears once                                                                                                                                                                                                                                                                     | TEA   |
| 7.7-E2E-005 | Late mode on Home and Community: gate reads at once, every other read 3 s late; tap the header title while a late read is pending; score after the tap is 0 (Closet and Profile have only gate reads)                                                                                                                                                                             | TEA   |
| 7.7-E2E-006 | Tab switch Home > Closet > Community > Profile > Home x empty, populated, delayed: each transition at most 0.1, shifts after the tap included; the first returning Home frame holds the outfit and the teaser (Codex P2-4)                                                                                                                                                        | TEA   |
| 7.7-E2E-007 | Positive control: a 300 px block inserted above the content after first paint scores above 0.1 with the same meter (proves R3)                                                                                                                                                                                                                                                    | TEA   |
| 7.7-E2E-008 | Tab return: scroll Closet, go to Community, back to Closet: first frame shows the grid at the same scroll offset, no placeholder in any frame, refresh request sent                                                                                                                                                                                                               | TEA   |
| 7.7-E2E-009 | Owner change in one document, three paths: (a) `landing-sign-out`, then member B bearer plus `couture:session`; (b) bearer swap from Closet; (c) bearer swap on Home while A's ritual read is still in flight (Codex P2-1). From the switch on, no frame renders member A outfit text, through a later tab round trip; (a) and (b) open B's Home through the gate; B outfit shows | TEA   |
| 7.7-E2E-011 | Returning member: stored session, no bearer, profile verification held 2.5 s: first Home frame is the placeholder, never signed-out or sample content, then the member outfit; at most 0.1                                                                                                                                                                                        | TEA   |
| 7.7-E2E-012 | Profile return with delayed reads (Codex P1-2): first Profile frame is ready, shows the member email and the old scroll offset, no placeholder; the refresh read runs                                                                                                                                                                                                             | TEA   |
| 7.7-E2E-013 | Community return from the `all` filter (Codex P2-5): first frame ready, no placeholder; after the refresh the filter is still selected and the anchored card has not moved                                                                                                                                                                                                        | TEA   |
| 7.7-E2E-010 | Production lane (`signed-in-shell-layout-shift.prod.spec.ts`), read-only, every non-GET aborted: each tab cold, signed out and as the synthetic member, at most 0.1; member never sees signed-out content                                                                                                                                                                         | TEA   |

### Web component and unit (builder, vitest)

| ID           | Test                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.7-UNIT-010 | `screen-snapshot`: remember and recall per owner and screen; cap four tabs                                                                                                   |
| 7.7-UNIT-011 | `screen-snapshot`: owner change via `couture:session` clears it; sign-out clears it; recall for another owner returns nothing                                                |
| 7.7-UNIT-012 | `screen-snapshot`: `Storage.prototype.setItem` never called (no localStorage or sessionStorage)                                                                              |
| 7.7-UNIT-013 | `use-web-session`: a remount with a known session starts at the member state, never `checking`                                                                               |
| 7.7-UNIT-014 | Session scope: the verified owner, or the fixture owner with its bearer; a write captured under a scope no longer live is dropped (Codex P2-1)                               |
| 7.7-UNIT-015 | Losing Community access drops its snapshot parts and fences pending writes; a read with access allows them again (Codex P3-1)                                                |
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

| ID          | Test                                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.7-NAT-001 | Tabs shell renders during `restoring` with the placeholder per tab body; tab bar present; the gate opens after the 10 s deadline (never while restoring)                                                   |
| 7.7-NAT-002 | Home never renders the member sample outfit before the ritual and weather reads settle                                                                                                                     |
| 7.7-NAT-003 | Refocus refresh does not set the initial loading state; content stays                                                                                                                                      |
| 7.7-NAT-004 | Community new-looks pill is an overlay; weather alert and stale banners join the Home gate                                                                                                                 |
| 7.7-NAT-005 | `useModalAnimation`: `none` under reduce motion, `fade` or `slide` otherwise; root stack uses `fade` (Android `rns_fade` 150 ms, iOS `animationDuration: 200`) and `none` under reduce motion (Codex P2-9) |
| 7.7-NAT-006 | Community Spotlight focus intent waits for the gate: consumed only once the first feed page and Spotlight settled, in both read orders (Codex P2-8, `spotlight-focus.cases.tsx`)                           |

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

Member baseline 2026-11-25 on main `11c26918` (Codex P2-11: recorded before merge). The
`prod-synthetic-member` environment deploys only to `main`, so the secret-backed lane cannot run
from this branch. Measured instead in the owner's signed-in Chrome on production: a same-origin
390 x 844 iframe opened from `/terms`, a buffered `layout-shift` observer attached as the frame
document appeared, 10 to 12 s per load, the same sum-every-entry rule. Nothing was written; the
first load refreshed the stored session as any visit does.

| Surface           | Member baseline 390 x 844 (main) | Shifted nodes                                                                                          |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Home, member      | 0.8191, 0.8187, 0.8187           | `lookbook-prism-grid` + `hero-section` 0.51 at about 100 ms; `lookbook-prism-grid` 0.31 at about 0.5 s |
| Closet, member    | 0, 0                             | none                                                                                                   |
| Community, member | 0.0393, 0.0393                   | `community-feed-loading` 0.037 at about 0.4 s                                                          |
| Profile, member   | 0, 0                             | none                                                                                                   |

Home as a member is worse than the 2026-11-21 walk (0.574 at 500 px): the taller phone layout puts
more of the swapped hero inside the viewport. `signed-in-shell-layout-shift.prod.spec.ts`
(7.7-E2E-010) repeats the measurement as the synthetic member in the Prod E2E lane after the merge
deploys, and fails above 0.1.

## Execution

CI is the proof. TEA specs run in `pr-pw-e2e-local.yml`; meter unit specs in the Playwright helper
unit job (`test:playwright-unit`); motion guards with the web and mobile vitest/jest suites.
Locally only tsc and eslint on touched files.

## Exit criteria

- Every test above green on the head SHA in every workflow (`gh pr checks`).
- E2E-007 fails the budget with the control block and passes without it.
- D8 table filled.
