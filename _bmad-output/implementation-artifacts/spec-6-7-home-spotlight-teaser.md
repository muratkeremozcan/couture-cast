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
  - R2: on native the teaser counted as holding focus for 10 seconds after a return focus, or
    while the link reported input focus. Round 2 (R13) replaced the window with OS-reported focus.
  - R3: `HomeSpotlightTeaserSlot` owns the lifecycle, focus state and return focus as a memoized
    child, so teaser updates never re-render the hero (6.7-MOB-035 counts hero card renders).
  - R4: the spotlight hook retires a handled focus request (`acknowledgeFocusRequest`), so a module
    that remounts after an availability lapse never replays it (6.7-MOB-026).
  - R5: Community retires a pending teaser intent and any unexecuted targeted focus on navigation
    blur, and guards its deadline timer and animation-frame callbacks (6.7-MOB-027, 6.7-MOB-028).
  - R6: native return focus is covered with native handles and exact call counts (6.7-MOB-030 to
    6.7-MOB-032). The Maestro flow asserts an automation marker for the Home tab return and Android
    back. The test phase removed the expiry fallback flow, and round 2 (R12) moved the device
    focus check to OS-confirmed TalkBack focus.
  - R7: `surface=home_teaser` reads make one transport attempt on both clients; the Community
    module keeps its single contention retry (6.7-MOB-015, 6.7-WEB-017).
  - R8: absence assertions wait on the wrapper's own settled promise or on synchronous read starts,
    never on sleeps; new rows cover the disabled 503, a network error, a 429 `Retry-After` and the
    client deadlines (mobile 15 s, web 10 s). The mobile teaser suites share
    `src/test-utils/home-teaser.tsx`, which releases any read a test left unanswered so it cannot
    hold a browser connection into the next test.
  - R10: the layout cancels its preview scroll frame on unmount, and the web teaser suite stubs
    `scrollIntoView`, which jsdom lacks, restoring it afterwards (6.7-WEB-004, 6.7-WEB-019).
  - CodeRabbit: `Retry-After` deferrals ignore non-finite values. A five-minute cap added here
    was reversed in round 2 (R15).

- 2026-10-23, code review round 2 (`reviews/code-triage-1.md`, R12 to R15, with
  `reviews/cc67-astra-code-review-2.md` D1 to D4) and the test review's open items
  (`reviews/cc67-tea-test-review.md`). Decision (coordinator, option A): React Native 0.81
  reports no screen-reader focus, so a local Expo module reports and moves it.
  - Evidence for the decision: Android `AccessibilityInfoModule.setAccessibilityFocus` is a no-op
    and the JS call sends `TYPE_VIEW_FOCUSED`; iOS posts `UIAccessibilityLayoutChangedNotification`;
    `ReactAccessibilityDelegate` forwards only declared custom actions; no React Native view
    implements `accessibilityElementDidBecomeFocused`.
  - `apps/mobile/modules/accessibility-focus`: `observeAccessibilityFocus` reports OS focus
    changes as native view tags from the focused element outwards (iOS
    `UIAccessibility.elementFocusedNotification`; Android an accessibility delegate on the window's
    decor view that sees `TYPE_VIEW_ACCESSIBILITY_FOCUSED` and `_CLEARED`).
    `focusAccessibilityElement` moves the cursor (Android `ACTION_ACCESSIBILITY_FOCUS`, iOS a
    layout-changed notification for the view). Expo Go and web carry no module; there both
    return null and the hook falls back to React Native's call and to what the DOM reports.
  - R13: the teaser hands focus to the scroll view on removal only while the link holds input
    focus or the OS reports accessibility focus on it. There is no timer. Without the module it
    hands nothing off and logs nothing (6.7-MOB-032 to 034, 046).
  - R14: the return target is chosen in the frame focus moves in, and again in each retry frame;
    the return is consumed once a destination exists (6.7-MOB-047).
  - R12: Home renders `home-spotlight-teaser-focus-requested-<target>-<count>` once a request
    reached a real node, and `home-spotlight-teaser-focused-<target>-<count>` only after the
    platform confirmed it (the DOM on web, the OS report on a native build). The Expo Go flow
    asserts the request marker. `scripts/run-story67-talkback.mjs` with `maestro/story67/` asserts
    the confirmed marker on an Android development build with TalkBack enabled through adb: Android
    back to the link, and the return after a sign-out identity change to the scroll view. With
    the platform focus call suppressed, the request marker still renders and both cases fail.
    CI has no development-build lane, so this flow is local evidence. The Expo Go lanes keep
    running in CI. iOS is covered at unit level only: the Simulator has no VoiceOver.
  - Defects the device run found and fixed: TalkBack ignores React Native's Android
    `TYPE_VIEW_FOCUSED` for the link, so the module moves the cursor itself. Home's views are
    reattached a frame after navigation reports focus, so a refused move is retried for up to
    `NATIVE_FOCUS_FRAMES` (6.7-MOB-048, 049). TalkBack reports focus from inside the native call,
    before its promise resolves, so a request waits for its report from the moment it is sent
    (6.7-MOB-050).
  - Harness facts: any UiAutomation client (Maestro, `uiautomator dump`) suspends TalkBack and the
    app's touch exploration while connected, so no flow runs while TalkBack is on and the runner
    waits a fixed 4 s for a transition before reading the recorded marker. Maestro's `inputText`
    stalls its device server on the Gboard emulator image, so the runner types with
    `adb shell input text` in short chunks.
  - R15: a finite positive `Retry-After` defers the next read to its exact deadline; non-finite
    and non-positive values fall back to the read floor (6.7-UNIT-036, 043).
  - Test review items: the native "moves nothing" checks wait five frames; 6.7-MOB-035 takes its
    baseline once hero renders hold steady and drives an identity change; the native suite clicks
    through `userEvent`.
  - CodeRabbit, round 2: Community keeps its focus in state as well as the ref, so an intent the
    router delivers before the focus event resolves once focus arrives, and each notice takes
    focus once (6.7-MOB-051 to 053). The web hero layout check now fails on an empty hero canvas.
    The Android second tap in `home-spotlight-teaser.yaml` keeps its swipe: the teaser is the last
    item on Home, so the scroll clamps at the end of the content and cannot carry it off screen.
  - Found on the Android Expo Go lane: the 15 s image deadline kept counting while the app was in
    the background, so a teaser read just before the app went to the background was removed on
    return, and the 60 s read floor kept it away. The deadline now runs only while Home is
    focused and in the foreground, and each return gives the image a whole deadline
    (6.7-MOB-054). The Community Spotlight carousel flow waits for the carousel to settle between
    swipes and allows sixteen of them, after eight unsettled swipes stopped on #5 under load.
  - R16, incident: on 2026-10-23 at 21:52:56Z a validation run, `npx playwright test
playwright/tests/community-comments.spec.ts --repeat-each=3`, went out without the isolated
    database env. Playwright's global teardown then ran `npm run db:reset` on the default local
    database at 127.0.0.1:54322: dropped, migrated and re-seeded. Rows beyond the seed were lost.
    Cause: the teardown reset every local run that did not opt out, and the environment loader
    supplies a local `DATABASE_URL` on its own, so a raw run qualified. Fix: the reset is opt-in.
    `playwright/support/helpers/db-reset-policy.ts` decides, `npm run test:pw-local` alone sets
    `PLAYWRIGHT_DB_RESET=true`, and a raw run skips with a message naming that script. The CI,
    non-local TEST_ENV, missing or remote DATABASE_URL and `PLAYWRIGHT_SKIP_DB_RESET` guards
    still win over the opt-in. `db-reset-policy.spec.ts` covers the table, the one opting-in
    script and the teardown itself with `execSync` mocked; four cases fail on the old rule.
  - Playwright fixture: the community session closes its pages before deleting its rows. A page
    left open reacted to the cleanup's realtime events, read the replies of a just-erased root,
    got a 400, and failed the Story 6.4 tombstone test through the network monitor.

- 2026-10-23, round 4 (`reviews/code-triage-1.md`, R17 to R22).
  - R17, R21: burn-in failed with "Process from config.webServer exited early". The burn-in web
    server's launcher runs `prepare:playwright`, which ends with the Playwright helper suite, and
    the new teardown spec called the real teardown for an opted-in run. That stops this checkout's
    recorded E2E stack before `db:reset`, so it signalled the launcher it ran inside. The spec now
    mocks the stack stopper and asserts whether it is called. It runs the teardown under a fresh
    `TMPDIR`, set on the real environment because `os.tmpdir()` reads it there. In that directory
    it records a stand-in launcher, which must survive; without the mock the stand-in is killed
    and the case fails. Reproduced locally first: a stand-in recorded at the real path was
    SIGTERMed by the old spec and survived the new one.
  - R19, R20 (Android): `AccessibilityFocusObserver` forwards every `AccessibilityDelegate` method
    to the delegate the decor view already had. A stop restores that delegate and leaves alone one
    that someone installed later. Before API 29 the existing delegate cannot be read, so the
    observer installs nothing there, and the module reports `canObserveFocus: false`. Attach and
    detach run on the main looper behind an observing flag, so observing can start before an
    Activity exists and attaches when one reaches the foreground; a destroyed window's decor view
    is released. Robolectric: 9 tests, each red on a one-line break.
  - R18 (iOS): `focus` refuses a view outside a window or under a hidden ancestor
    (`AccessibilityFocusTarget.swift`, XCTest through `ios/Package.swift`), and the hook asks again
    on later frames. After `NATIVE_FOCUS_FRAMES` refusals it sends React Native's own request for
    the target still wanted (6.7-MOB-049). The JS wrapper reads the module on each call
    (6.7-MOB-055 to 057).
  - R22 (decision B): a TalkBack probe on GitHub-hosted emulators (run 40034636703) found no
    TalkBack package on the API 34 `google_apis_playstore` x86_64 image; on API 35 and 36 TalkBack
    binds from adb and touch exploration turns on. `.github/workflows/pr-accessibility-focus.yml`
    keeps the Android unit and build job and the iOS module tests, drops the probe, and adds
    "Android module against TalkBack (API 35)". It runs
    `scripts/ci/accessibility-focus-device-tests.sh`: TalkBack on over adb
    (`scripts/ci/android-talkback.sh`), the module's androidTest suite on real views, then the same
    suite with `suppressFocus=true`, a control that must fail. The suite covers the focus action,
    the `TYPE_VIEW_ACCESSIBILITY_FOCUSED` report with its ancestors, delegate chaining and
    restore, the API 29 gate through its code path, and attach and detach without an Activity.
    Its first device run found a defect: TalkBack refuses `ACTION_ACCESSIBILITY_FOCUS` on a view
    it already holds and sends no event, so the module reported a refusal and the hook retried
    without ever confirming. `moveFocus` now counts a held view as moved and reports the focus it
    holds (red in `runs/r4-talkback-already-held-red`, green with the control failing in
    `runs/r4-android-talkback-instrumentation-local-3`). The test APK leaves out the React Native
    and Expo native libraries, which no test touches; at 170 MB it overflowed the emulator's
    storage. The workflow is path filtered on the module, the teaser hook and component, the two
    scripts and itself, and PR Gate makes it required when it runs. The full Home teaser flow
    under TalkBack stays local evidence through `scripts/run-story67-talkback.mjs`:
    `runs/r2b-*`, `runs/r2c-talkback-return`, `runs/r2c-talkback-fallback`, `runs/r2d-*`, with
    `runs/r2-talkback-suppressed-return` and `runs/r2-talkback-suppressed-fallback` red as they
    must be. A CI lane for it would need the development build, the API, Supabase, an OTP proxy
    and Metro on the runner.
  - R23: `maestro/community-feed.yaml` failed on CI with the feed card's author row at y 2224 to
    2190, just below the list's bottom edge, and the flow only searched upward. Nothing on this
    branch moved that layout; the row's position depends on the device's height. The flow now
    makes a short slow drag first, which brings a row clipped at the edge into view.
  - R24: `maestro/commerce-affiliate.yaml` switched affiliate suggestions off, then stalled in
    Maestro's app launch until the 360 s watchdog killed it. The retry inherited the member's
    opt-out and found no affiliate block. The per-flow reset in
    `scripts/lib/mobile-e2e-flow-state.mjs` now deletes the member's `CommercePreference`, with an
    integration case in `apps/api/integration/mobile-e2e-flow-state.integration.spec.ts` that
    fails without it.
  - Engagement isolation: the Story 6.5 engagement tests shared the seeded post `lookbook-5`, so
    parallel `--repeat-each` runs collided on its reaction counts. Each test now publishes its own
    look from a fresh owner (`publishOwnLook` and the `look` fixture), and the tests that read the
    shared feed take a cross-worker lock (`playwright/support/helpers/exclusive-lock.ts`, replaced by a Postgres advisory lock in R32), with the
    test timeout suspended while one waits. `runs/r4-engagement-repeat-parallel-6`: 30 passed.

- 2026-10-23, round 5 (`reviews/code-triage-1.md`, R25 to R29).
  - R25: the Android module job builds the release app and the module's androidTest APK.
    `scripts/ci/check-accessibility-focus-builds.sh` checks that the app keeps the module class,
    Expo's module list and `libreactnative.so`, and that the test APK has no native libraries and
    still holds the TalkBack tests, so the `**/*.so` exclusion reaches the test APK only. The iOS
    job adds a release simulator app build after the SwiftPM XCTest: it compiles
    `AccessibilityFocusModule.swift` with ExpoModulesCore, and the same script checks that the
    binary links it and `ExpoModulesProvider.swift` registers it.
  - R26: superseded by R32 (round 6).
  - R27: the device runner gives the TalkBack run and the suppressed-focus control fresh,
    separate result directories, and `scripts/ci/check-accessibility-focus-results.mjs` decides
    the lane from their JUnit XML. Every test must pass with TalkBack; the control must fail
    exactly the four tests that need the OS focus report, on that assertion, and pass the API 28
    case. A control that failed to build or install, or failed some other way, fails the job.
    The runner's spec drives the real script with a fake `gradlew` and `adb`; it is red on the
    previous runner and on one that keeps stale results.
  - R28: the lane's path filters add the lockfile, the mobile `package.json`, `app.config.ts`
    and `app.json`, the JS wrapper `src/lib/accessibility-focus.ts`, the new checks and
    `scripts/run-story67-talkback.mjs`; a spec holds both triggers to that list.
  - R29: the delegate-forwarding device test puts TalkBack on the first view after attaching,
    confirms it, clears what it recorded, then moves to the second view and checks that the
    window's own delegate saw that event. Without forwarding it fails
    (`runs/r5-talkback-chain-no-forwarding-red`); before, TalkBack's initial focus event could
    satisfy it.
  - Found by the round 4 gates: the locations screen cleared a refused save's explanation when the
    query searched again on its own, about 300 ms later, so 1.2b-MOB-05d failed under coverage
    load. A search result now clears search errors only, and the test checks the error after the
    second search.
  - Declined: Astra F4, the full app return and fallback flow in CI; see the triage decision
    record (option B, 2026-10-23).

- 2026-10-24, round 6 (`reviews/code-triage-1.md`, R30 to R33).
  - R30: the iOS check matched the plain name `AccessibilityFocusModule`, which a Swift binary
    does not carry as a symbol, and a stripped release binary keeps no symbols at all.
    `check-accessibility-focus-builds.sh ios-app` now reads the binary's strings for the runtime
    class name `_TtC18AccessibilityFocus24AccessibilityFocusModule`, which survives stripping,
    and requires `AccessibilityFocusModule.self` in the generated provider. The local release
    build also checks a stripped copy. The red control is a release build with the module's
    `expo-module.config.json` set aside, so autolinking leaves it out.
  - R31: the dev-build and release evidence ran at `e6ce9d47`, each through `run-evidence.py`
    with no source change during the run:
    `runs/r7f-dev-build-android`; `runs/r7f-talkback-return` (OS focus landed on the link) and
    `runs/r7f-talkback-fallback` (landed on the scroll view); the app-level controls
    `runs/r7f-talkback-suppressed-return` and `runs/r7f-talkback-suppressed-fallback`, red with
    "No OS-confirmed focus" as they must be; `runs/r7f-release-android` (module class, package
    list and `libreactnative.so` in the app; no native library in the test APK);
    `runs/r7f-release-ios` (runtime class name in the binary and in a stripped copy, provider
    registration); and the iOS red control `runs/r7f-release-ios-without-module` (build
    succeeded, check failed). Each TalkBack run holds `workspace.json` with the workspace's
    source head, a hash over its source files and the hook's hash; the controls also hold
    `suppression.patch`, the one-line change to the harness copy of the hook that skips the
    module's focus call. Later commits change only the advisory-lock integration spec and this
    file.
  - R32: two review rounds kept finding races in the file-lock protocol (a waiter acting on a
    stale observation could claim a pruned generation beside a live holder). The lock is now a
    Postgres session advisory lock on the test database
    (`playwright/support/helpers/advisory-lock.ts`): Postgres grants the key to one session at a
    time and releases it when the session's connection closes, so there is no stale-holder or
    generation handling. The generation protocol and its tests are gone.
    `apps/api/integration/playwright-advisory-lock.integration.spec.ts` runs three worker
    processes and asserts their holds never overlap (red with a per-worker key), that a holder
    dying without releasing frees the lock, and that a wait ends with `lock_not_available` at
    its deadline.
  - R33: 1.2b-MOB-05d records announcements from the start, waits for the choice's own
    "Selected" announcement, then clears the record before saving, so the save's announcements
    are exactly the error and, for an expired result, the second search's count.

- 2026-10-24, round 7 (`reviews/code-triage-1.md`, R34, R35).
  - R34: the automatic feed-lock fixture ran before the community fixtures' non-local skip, so a
    preview or prod run would have connected to a database for the lock. The fixture body is now
    `holdEngagementFeed` in `playwright/support/helpers/engagement-feed-lock.ts`, which skips a
    non-local run first; its spec shows no database URL is read and no lock is taken there, and
    fails with the skip moved after the lock.
  - R35: the advisory-lock integration spec keeps every worker it starts, runs each as one Node
    process so a signal reaches it, rejects a spawn error, and in `afterEach` kills and awaits
    every worker still running. A test cuts a run short with a worker holding the lock and checks
    that the worker exits, `pg_locks` shows no holder, and the lock is free; it fails when the
    cleanup does not kill.

- 2026-10-24, round 8 (`reviews/code-triage-1.md`, R36).
  - R36: after a worker exits, its socket closes at once but the server backend drops its locks
    a moment later, so the cut-short case asserted an empty `pg_locks` too early. It now polls
    the holders to a five-second deadline and fails naming each holder's pid, state and backend
    start, then still reacquires the lock. Two cases without a database cover the wait: a holder
    seen just after exit and then gone passes, and a holder that never goes fails at the
    deadline (the first is red when the wait looks only once).

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
