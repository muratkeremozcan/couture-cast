---
title: 'Story 6.7: Home spotlight teaser'
type: 'feature'
created: '2026-10-23'
status: 'ready-for-dev'
baseline_commit: '27041941a0ec4b2528b8309b5cf8558adbb69f6e'
route: 'dispatch'
story_key: '6-7-home-spotlight-teaser'
review_loop_iteration: 5
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-6-community-city-spotlight.md'
---

<frozen-after-approval reason="owner delegated delivery and phased peer approval">

## Intent

**Problem:** Members only meet the City Spotlight after they open Community; Home, where the daily
ritual lives, gives no hint that standout local looks exist.

**Approach:** Add a compact, localized teaser of the viewer's top spotlight entry to Home on mobile
and on narrow web layouts. It loads on its own, disappears whenever there is nothing safe to show,
and links to that entry inside the existing City Spotlight with focus and screen-reader context kept.

## Boundaries & Constraints

**Always:**

- Owner-delegated scope decision (2026-10-23): epic AC3's sponsored affiliate CTA moves to new
  Story CC-6.7b, because no community post can carry a sponsorship today (no table, contract field
  or eligibility rule; card `isSponsored`/`sponsoredPostIds` props have no production caller). This
  story ships no CTA.
- Data: one page-one spotlight read with `limit=1` and a new optional query `surface`
  (`community` default, or `home_teaser`). Ranking, level, cohort, cursor and caching are 6.6's,
  unchanged. The teaser shows rank 1 only.
- Independence: the teaser has its own fetch, state and error handling. It never delays, hides,
  reorders or re-renders the hero, chips, garments or planner. On mobile, hero loading, error and
  no-location states never hide it.
- Identity: the teaser reads only once a member is resolved (mobile `subscribeMobileApplicationUser`,
  web the same session scope the grid spotlight uses). An identity change or sign-out clears its
  state, aborts the read in flight and drops any late response from an earlier identity. Signed out
  renders nothing. Cold start before session restore performs no read and reads when the member
  resolves.
- Lifecycle: a teaser value belongs to one member and expires 5 minutes after its read completed.
  While Home is shown and the app or tab is in the foreground, the client re-reads 4 minutes after
  the last read attempt. It also re-reads when Home regains focus, the app returns to the foreground
  (mobile `AppState`) or the page becomes visible again (web `visibilitychange`), when the last
  attempt is older than 60 seconds; a quick return inside 60 seconds reads nothing. Reads never run
  more often than once per 60 seconds, and a 429 `Retry-After` defers the next read until it passes.
  The last-attempt time, the 60-second floor and any `Retry-After` deferral belong to the current
  member; an identity change resets them, so a newly resolved member reads at once.
  A re-read keeps rendering the current valid value until it settles. Success replaces the value; a
  failed re-read removes the teaser and schedules no timed retry (the next focus, foreground or
  visibility trigger reads again); reaching expiry without a successful re-read removes it. No ritual
  cache, storage or offline copy.
- Render rule: render only a valid value with level other than `none` and one item. First load,
  empty, `none`, disabled (403/503 disabled message), age gate, rate limit, network or server error,
  a failed re-read, an image load error, or expiry render nothing and reserve no space. A re-read
  that returns a different rank-1 entry replaces the content in place.
- Content: localized heading with the area label, the entry's first media image (decorative: web
  `alt=""`, mobile hidden from the accessibility tree), the author name by the existing card rule
  (`community.card.authorSelf` for `isSelf`, the existing blank-name fallback), total reaction count,
  and one link control. No caption, coordinates, cohort size or level wording beyond the label. Every
  teaser id and test id uses the `home-spotlight-teaser-` prefix and never reuses a module or card id.
- Placement: mobile Home scroll view directly after the whole hero conditional (outfit card, hero
  error state or no-location state), so it follows whichever renders in focus order. Web: inside the
  Hero Ritual Canvas, mounted only while the layout is stacked, defined as
  `isMobilePreview || window.innerWidth < 1280` measured after mount. The value and its read time
  live in layout-level state that survives unmounting; entering stacked follows the same 60-second
  rule. Side-by-side layouts issue no teaser read.
- Link and focus intent: each activation creates a fresh focus token. Mobile pushes `/community` with
  `{ source: 'app', type: 'community', cardId, focus: 'spotlight', focusToken }`; the deep-link
  schema accepts `source: 'app'` with `cardId`, `focus: 'spotlight'` and `focusToken`. On first sight
  of a new token, Community copies `{ cardId, focusToken }` into screen state, then clears the
  spotlight params; clearing never cancels the copied intent. The intent is consumed by its outcome
  below; a repeated token, a later identity change or a later module recovery moves no focus. Web
  resolves the same intent in page.
- Destination outcomes (both clients): a loading module is awaited at most 10 seconds. Entry present
  focuses that entry (mobile: the module's `focusRequest` to the entry's rank node; web:
  `spotlight-lookbook-card-{id}`) and announces `community.feed.announceFocused` once. Every other
  outcome shows one informational notice and moves focus to it:
  `community.spotlight.targetUnavailable` when the module settled and rendered without the entry
  (loaded without it, `none`, or failed); `community.spotlight.destinationUnavailable` when the
  module is absent or still loading after 10 seconds, which takes precedence. Never the invalid-link
  banner.
- Notice surface: a persistent, focusable notice region at the top of the Community surface that
  renders outside every availability gate. Mobile: the Community `InfoBanner` placed above the
  module gate; `InfoBanner` gains an optional forwarded ref and an option that turns its polite live
  region off, used only for this focused notice, and it keeps one mounted instance while its message
  changes. The list scrolls to offset 0 before focus moves. Web: an informational banner with
  `tabIndex={-1}` at the top of the `Community Section` column, outside the spotlight and grid gates,
  fog styling. Focusing the notice is its single announcement; no live region repeats it.
- Return: the first time Home regains focus after an activation (Android back or a Home tab press on
  either platform), consumed once per token, accessibility focus returns to the teaser link if it
  still renders, else to the Home scroll view. Whenever the teaser unmounts while it holds focus
  (failed re-read, expiry, identity change), focus moves to the Home scroll view on mobile and the
  Hero Ritual Canvas on web.
- Accessibility: one focusable link whose label names area, author and reaction count; 44-point
  minimum target; teaser follows the hero conditional in focus order.
- Copy (new keys, web and mobile): `home.spotlightTeaser.heading` (`{{label}}`),
  `home.spotlightTeaser.reactions` with `_one|_other` (`{{count}}`), `home.spotlightTeaser.linkLabel`
  with `_one|_other` (`{{label}}`, `{{author}}`, `{{count}}`), `home.spotlightTeaser.cta`,
  `community.spotlight.targetUnavailable`, `community.spotlight.destinationUnavailable`. Plural keys
  follow the existing base-plus-forms pattern. Reused: `community.card.authorSelf`, the author
  fallback key, `community.feed.announceFocused`. All ten locales, parity specs passing.
- Analytics: `community_spotlight_viewed` and `community_spotlight_opened` gain a required `surface`
  property (`community | home_teaser`); existing 6.6 calls send `community`. The teaser read sends
  `surface=home_teaser`. A teaser activation posts the opened branch with `surface: 'home_teaser'`,
  rank and level; dedupe keys include the surface. No captions, names, media, coordinates or raw IDs.

**Never:**

- No sponsorship CTA or sponsorship data (CC-6.7b), no new feature flag or flag default, no
  production rollout enablement, no new paid service.
- No change to spotlight ranking, eligibility, cursor, cache, rate limit or the Community feed.
- No change to hero data, ritual cache or the 6.6 module beyond accepting the focus intent.
- No reuse of `community_card_opened` for teaser activations.

## I/O & Edge-Case Matrix

| Scenario                | Input / State                                | Expected Output / Behavior                              | Error Handling                  |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------- | ------------------------------- |
| Happy path              | Member, cohort met, rank-1 entry             | Teaser shows label, image, author, count                | N/A                             |
| Empty                   | Level `none` or no items                     | No teaser, no space                                     | N/A                             |
| Disabled                | 403/503 disabled message                     | No teaser; Home unchanged                               | No retry loop                   |
| Server or network error | 5xx or timeout                               | No teaser; hero unaffected                              | Next trigger re-reads           |
| Mobile hero states      | Ritual loading, error or no location         | Teaser follows that state                               | N/A                             |
| Cold start              | Session not yet restored                     | No read; reads when member resolves                     | N/A                             |
| Identity change         | Sign-out or another member                   | Teaser cleared; late response dropped; read floor reset | Signed out: nothing             |
| Expiry                  | No successful re-read 5 min after the last   | Teaser removed                                          | Re-read at 4 min keeps it shown |
| Quick return            | Refocus within 60 s                          | Current valid value kept                                | N/A                             |
| Withdrawn after read    | Entry no longer visible                      | Next re-read replaces or removes it                     | N/A                             |
| Image fails             | Image load error                             | Teaser removed, no space                                | N/A                             |
| Entry present           | Activate teaser                              | Entry focused, one announcement                         | N/A                             |
| Entry gone              | Module ready without entry, `none` or failed | Target notice focused                                   | Never invalid banner            |
| Module absent           | Community unavailable or 10 s loading        | Destination notice focused                              | Never invalid banner            |
| Repeat activation       | Same entry tapped twice                      | Focus moves on each tap                                 | Fresh token each tap            |
| Back to Home            | Android back or Home tab press               | Focus returns to teaser link once                       | Scroll view if gone             |
| Wide web layout         | Columns side by side                         | No teaser, no `home_teaser` read                        | N/A                             |

</frozen-after-approval>

## Code Map

- `packages/api-client/src/contracts/http/community.ts:867-933` spotlight query/response; add
  `surface` query. `:794-856` opened spotlight branch and `isSpotlightOpenInput` (discriminates on
  `surface` presence): widen the literal to `spotlight | home_teaser`. `contracts/http/openapi.ts`:
  regenerate.
- `packages/api-client/src/types/analytics-events.ts:883-910` spotlight events: add `surface`;
  `packages/api-client/src/testing/analytics-event-assertions.ts` and
  `packages/api-client/testing/community-analytics.spec.ts` pin their shapes.
  `apps/api/src/modules/telemetry/telemetry.service.ts:408-409` input schemas.
- `apps/api/src/modules/community/community-spotlight.service.ts:62` view bucket, `:102-108`
  `spotlightViewDedupeKey`, `:174-176` viewed record, `:398-414` open path (dedupe `:408`);
  `community-analytics.ts:55-62` `spotlightOpenDedupeKey` takes the surface.
  `community.controller.ts:148,352` routes.
- `packages/utils/src/deep-link.ts:4,38-61` (`app` already in the source enum; add `focus` and
  `focusToken`). `apps/mobile/src/lib/mobile-deep-link-handler.ts:143-147`.
- Mobile Home `apps/mobile/app/(tabs)/index.tsx`: identity `:206-213`, announcer `:218`, scroll view
  `:699`, hero conditional `:748-829`, push to `/community` `:433-438`. Community
  `src/features/community/community-screen.tsx`: params `:364-393` (deps `:562-572`, no `setParams`
  today), focus `:577-605`, identity `:824`, verification `:935-1006`, `InfoBanner` live region
  `:1324-1335`, module `:1619-1633`, rank refs `:1151-1153`;
  `components/community/community-spotlight-module.tsx:118-136` `focusRequest`;
  `apps/mobile/components/info-banner.tsx:6-11,28` (no ref, fixed polite live region; remounted per message at
  `community-screen.tsx:1538-1540`);
  `components/community/community-card.tsx:351-353,371` author rule and container id;
  `use-community-spotlight.ts:236-256` identity handling to mirror; `src/lib/community.ts:278-298`
  (the existing wrapper never retries the disabled refusal); `src/lib/accessibility-focus.ts:18`.
- Web `apps/web/src/app/components/lookbook-prism-layout.tsx`: stacking `:437-443`, viewport state
  `:185-195,274`, hero canvas `:447`, community column `:572`, `getI18n()` `:161-168`;
  `community-lookbook-grid.tsx:251` author rule, `:1939` live region, `:2734-2748` focus pattern,
  `:3058-3071` spotlight section; `community-spotlight.tsx:52-55` card ids, `:549-570` render and
  heading; `apps/web/src/lib/community.ts:403-423` `getCommunitySpotlightFromWeb`.
- Locales: `apps/web/src/i18n/locales/*.json`, `apps/mobile/assets/locales/*.json`; parity specs.
- Tests: `pact/http/` spotlight and opened interactions, `apps/api/integration/` spotlight suites,
  `playwright/tests/community-spotlight.spec.ts`, `home.spec.ts`, `lookbook-prism.spec.ts`,
  `maestro/community-spotlight.yaml` (duplicate post id workaround `:16-20`), `hero-experience.yaml`,
  `scripts/run-maestro.mjs`, `scripts/maestro-flow-durations.json`, spotlight seeds in
  `packages/db/prisma/seeds/`.

## Tasks & Acceptance

**Execution:**

- [ ] `_bmad-output/planning-artifacts/epics.md`, `sprint-status.yaml`, `epic-6-context.md` -- commit
      the CC-6.7b split already drafted -- record the scope decision.
- [ ] Contracts, analytics registry, telemetry, spotlight service and analytics -- `surface` query and
      opened branch, `surface` event property and dedupe; regenerate OpenAPI/SDK; Optic diff clean.
- [ ] `packages/utils/src/deep-link.ts`, mobile deep-link handler -- `app` source with focus intent.
- [ ] Mobile teaser component and hook, Home placement, Community focus intent handling, notices and
      return focus.
- [ ] Web teaser in the hero canvas for stacked layouts, lifecycle, in-page focus and notices.
- [ ] All 20 locale catalogs -- listed keys.
- [ ] Unit tests for every matrix row on both clients with a controlled clock and deferred reads (hero
      rows mobile only; web asserts the hero canvas is unchanged); API unit and real-database
      integration for `surface`; Pact for the `home_teaser` read, both opened branches and legacy
      bodies; Playwright teaser spec on `pr-pw-e2e-local` (narrow viewport, axe, wide viewport issues
      no `surface=home_teaser` request); Maestro `home-spotlight-teaser.yaml` registered in
      `run-maestro.mjs` and `maestro-flow-durations.json`.

**Acceptance Criteria:**

- Given mobile Home with the hero loading, failed or without a location, when the spotlight read
  succeeds, then the teaser renders after that state and the hero is unchanged.
- Given any non-valid teaser state, when Home renders, then its layout matches Home without the teaser.
- Given keyboard or screen-reader users, when they activate the teaser in any destination state and
  return, then focus lands on the defined target with one announcement, and back on the teaser.
- Given any teaser interaction, when analytics are captured, then events pass strict schemas with
  `surface: home_teaser` and contain no content, names or raw identifiers.
- Given all ten locales, when parity specs run, then every listed key, placeholder and plural matches.

## Implementation Notes

- 2026-10-23, implementation. Decisions and surprises, each with its reason:
  - One lifecycle for both clients: `SpotlightTeaserState` in `@couture/api-client` owns the
    member-scoped value, the 4-minute re-read anchored to the last attempt, the 5-minute expiry
    from read completion, the 60-second floor and the `Retry-After` deferral. Web and mobile only
    bind it to their identity, focus, foreground and layout signals. A successful read that is
    not renderable (`none`, no items) still schedules the timed re-read; only a failed attempt
    schedules nothing.
  - Analytics dedupe keys carry the event `surface`: the viewed key gains a trailing
    `community|home_teaser`, and the opened key's last component, which was the literal
    `spotlight`, is now the event surface. An opened body with `surface: 'spotlight'` reports
    `surface: 'community'`. Existing 6.6 calls omit the query `surface`, so the server's default
    records `community` for them.
  - Mobile member: the same identity the Community screen reads for, from
    `communityCommentsSessionFromMobile` (the verified application user, else the bearer's
    subject), resolved again on every `subscribeMobileApplicationUser` change. Using the
    application user alone left the teaser without a member in every build that holds a bearer
    but never verifies a native session, which is how the Maestro harness runs; the first local
    Android run of `home-spotlight-teaser.yaml` found no teaser for that reason.
  - Web member: the grid's session source and sync (one-second sync plus the `storage`,
    `couture:session` and `couture:account-erased` events). Web teaser reads run under a
    10-second deadline, because the web spotlight wrapper has none and a hung read would
    otherwise hold the lifecycle's in-flight slot for good.
  - Mobile image: a load that settles neither way within the card's 15-second image timeout
    counts as an image failure, matching the card rule for Android stacks that never fire
    `onError`. Its loaded marker sits beside the link, because iOS hides an accessible element's
    descendants from automation.
  - Web link name: the `linkLabel` copy is screen-reader text inside the link and the visible
    lines are `aria-hidden`. With `aria-label` instead, axe reported
    `label-content-name-mismatch` (WCAG 2.5.3) on the first local Playwright run.
  - Focus when the teaser leaves while focused: web checks `document.activeElement` in a layout
    effect cleanup, which runs before React removes the link. React Native has no screen-reader
    focus event, so mobile tracks the link's `onFocus`/`onBlur` and its own return-focus move.
  - Notices: mobile reuses the Community `InfoBanner`, which now forwards a ref to its message
    element, takes `liveRegion={false}` for this notice only, and keeps one mounted instance whose
    dismissal belongs to the message it was dismissed on. Web renders
    `community-spotlight-notice`, a `tabIndex={-1}` paragraph heading the Community aside with
    no live region; it stays until the next activation or an identity change.
  - Maestro: `scripts/run-maestro.mjs` discovers every flow in `maestro/`, so the new flow needs
    no list entry there; it is not user scoped (it only reads the shared seeded cohort).
    `scripts/maestro-flow-durations.json` carries its estimate.
  - Defect fixed along the way: 6.6-MOB-053 replaced `communityCommentsSessionFromMobile` with
    a `member-1` mock and never restored it, so every later case in `community-screen.test.tsx`
    ran as `member-1` whatever its own setup said. It now restores the spy when it finishes.
  - Local E2E ran against an isolated `tea_community_<uuid>` database on the local Supabase
    cluster (the Playwright cleanup guard's accepted isolated name) with
    `PLAYWRIGHT_SKIP_DB_RESET=true` and the `cc67-redis` container, so the default database was
    never reset.
  - Mobile CTA text uses `#8A691F` on light surfaces and `#C9A14A` on dark ones. The accent gold
    on white measured about 2.3:1 in the first iOS screenshot, under the AA floor for 13 pt text.
  - Local iOS Maestro ran with `MOBILE_E2E_EXPO_NO_OPEN=1`: Xcode 27.1 on this machine ships no
    `Simulator.app`, so `expo start --ios` exits before serving. The flag is the runner's existing
    no-open path; Maestro opens the app through its link endpoint either way.

- 2026-10-23, code review round 1 (`reviews/code-triage-1.md`, R1 to R10). Each fix has a test
  that fails without it; the mutation runs are listed in the repair reply.
  - R1: the mobile member is keyed by the application user it was resolved for, so a change
    hides the previous member's value in the same render and the lifecycle clears and aborts
    before the next identity resolves (6.7-MOB-018). Web already resolves synchronously; 6.7-WEB-007
    now asserts the clear in the same commit.
  - R2: on native the teaser counts as holding focus only for 10 seconds
    (`TEASER_RETURN_FOCUS_HOLD_MS`) after a return focus, or while the link reports input focus.
    Home blur and activation end the window, so a later removal never pulls a screen reader away
    from what the member swiped to (6.7-MOB-033, 6.7-MOB-034).
  - R3: `HomeSpotlightTeaserSlot` owns the lifecycle, focus state and return focus as a memoized
    child, so teaser updates never re-render the hero (6.7-MOB-035 counts hero card renders).
  - R4: the spotlight hook retires a handled focus request (`acknowledgeFocusRequest`), so a module
    that remounts after an availability lapse never replays it (6.7-MOB-026).
  - R5: Community retires a pending teaser intent and any unexecuted targeted focus on navigation
    blur, and guards its deadline timer and animation-frame callbacks (6.7-MOB-027, 6.7-MOB-028).
  - R6: native return focus is covered with native handles and exact call counts (6.7-MOB-030 to
    6.7-MOB-032). Home renders a 1-point automation marker,
    `home-spotlight-teaser-focused-<target>-<count>`, after a focus request reached a real node, and
    the Maestro flows assert it for the Home tab return, Android back and, in
    `home-spotlight-teaser-fallback.yaml`, the return after the value expired.
  - R7: `surface=home_teaser` reads make one transport attempt on both clients; the Community
    module keeps its single contention retry (6.7-MOB-015, 6.7-WEB-017).
  - R8: absence assertions wait on the wrapper's own settled promise or on synchronous read starts,
    never on sleeps; new rows cover the disabled 503, a network error, a 429 `Retry-After` and the
    client deadlines (mobile 15 s, web 10 s). The mobile teaser suites share
    `src/test-utils/home-teaser.tsx`, which releases any read a test left unanswered so it cannot
    hold a browser connection into the next test.
  - R10: the layout cancels its preview scroll frame on unmount, and the web teaser suite stubs
    `scrollIntoView`, which jsdom lacks, restoring it afterwards (6.7-WEB-004, 6.7-WEB-019).
  - CodeRabbit: `Retry-After` deferrals ignore non-finite values and are capped at five minutes
    (`SPOTLIGHT_TEASER_MAX_DEFERRAL_MS`), since the spotlight read limit counts per minute.

## Spec Change Log

- 2026-10-23, iteration 5 (rereview 3): read floor, last-attempt time and `Retry-After` are
  scoped to the current member and reset on identity change.

- 2026-10-23, iteration 4 (rereview 2): re-read timing anchored to the last attempt, at most one read
  per 60 seconds, `Retry-After` honored, no timed retry after failure; focused mobile notice uses a
  ref-capable `InfoBanner` with its live region off and one mounted instance, scrolled into view; a
  timed-out loading module takes the destination notice; focus rule when the teaser unmounts while
  focused.

- 2026-10-23, iteration 3 (rereview 1): re-read at 4 minutes keeps the value shown until it
  settles; image-expiry clause dropped (device clock skew; 5 minutes is inside the 900-second URL
  life); fallback outcomes focus one persistent notice region outside every availability gate; intent
  copied to screen state before params clear; layout-level web state survives unmount; return
  trigger covers the Home tab press; plural base keys; `home-spotlight-teaser-` id prefix.

- 2026-10-23, iteration 2 (story review 1, coordinator under owner delegation): member-scoped
  reads with clearing and late-response drop; bounded lifecycle (5 min, image expiry, focus,
  foreground, visibility); mobile placement after the hero conditional; web stacked gate measured
  after mount with no wide-layout read; per-activation focus token consumed once; destination
  outcomes for every module state with a stable fallback; copy inventory and notice surfaces;
  decorative image; author rule; hero rows mobile only; Code Map corrections. KEEP: CC-6.7b split,
  `limit=1` reuse of the 6.6 read, `surface` analytics.

## Review Triage Log

- 2026-10-23, rereview 4 on SHA `4c09bcbc...cecec`: cc67-opus READY; cc67-astra READY on iteration 4
  (iteration 5 changed only the member-scoped read floor). Approved by the coordinator under owner
  delegation; status ready-for-dev.

- 2026-10-23, rereview 3 on SHA `3c2df9c4...fdf36`: cc67-astra READY; cc67-opus CHANGES_REQUIRED
  (1 low, prior 3 resolved). Accepted.

- 2026-10-23, rereview 2 on SHA `a615cc3a...ddb8`: cc67-opus CHANGES_REQUIRED (3 new, prior 8
  resolved), cc67-astra CHANGES_REQUIRED (1 new, prior resolved). All accepted.

- 2026-10-23, rereview 1 on SHA `039b7d63...183f`: cc67-opus CHANGES_REQUIRED (8 new, prior 12
  resolved), cc67-astra CHANGES_REQUIRED (1, overlapping Opus R3). All accepted.

- 2026-10-23, story review 1 on SHA `57ef572a...5371`: cc67-opus CHANGES_REQUIRED (12),
  cc67-astra CHANGES_REQUIRED (2, overlapping Opus 1, 6, 7). All accepted; none refuted. Reviews:
  `_bmad-output/test-artifacts/story-6-7/reviews/cc67-{opus,astra}-story-review.md`.

## Verification

**Commands:**

- `npx vitest run` in `apps/api`, `apps/web`, `apps/mobile` for touched suites -- green.
- `npx tsc -p` and `npx eslint` per touched workspace -- clean.
- API integration spotlight suites with `TEST_ENV=local` on an isolated database -- green.
- Pact consumer and provider for spotlight and opened -- green; Optic diff shows only additions.
- Playwright `community-spotlight.spec.ts` plus the teaser spec on the local lane; Maestro
  `home-spotlight-teaser.yaml` on Android -- green.
