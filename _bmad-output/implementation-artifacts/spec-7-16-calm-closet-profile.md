---
title: 'Story CC-7.16: Calm Closet and Profile'
type: feature
ticket: '7-16-calm-closet-profile'
created: '2026-11-27'
status: built
baseline_revision: 'd64216fa612b494fbad164e264068f453f9b60f8'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran: [independent-full-review, codex-security-diff]
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/spec-7-11-five-tab-navigation-back-pattern.md'
  - '/Users/murat/opensource/cc/epic7-coord/7.16-BRIEF.md'
  - '/Users/murat/opensource/cc/epic7-coord/RULES.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

Give Closet a single path to add, find or fix a piece. Give Profile a short list of account
settings with their current values, and move each setting's controls to its own screen.

## Acceptance criteria

1. Given a populated Closet, show the existing Add and More in the title, one category
   chip row and then the grid. All restores the full inventory. A tile shows its photo
   and name. Needs tags, Failed and Processing add an icon and a distinct status tone.
   Keep the existing way to tag, replace or check a garment. Move the Style this piece
   action to the existing garment detail. When setup is incomplete, place one progress
   link after the grid or empty state. Hide it once setup is complete.
2. Given a member on Profile, show Account, Places, Style, Premium, Notifications,
   Language and About and privacy in order, with current values and Sign out after
   the rows. Each opens a titled destination with Back. Verify web Places from a row
   and direct link, and native Style from its row. Planner lives under Looks > Plan.
   Today drops its About button.
3. Given a setting with secondary guidance, show a short line and Learn more.
   Keep the existing disclosures available where member decisions depend on them.
4. Given 320 px or dp at 200% text in a long supported locale, Closet and Profile
   keep their labels and controls legible in light and dark. Rows and labels may wrap.

## Boundaries and decisions

Preserve admission, owner-scoped data and request fencing, paid access, captured
garments, preferences, and existing route returns, including billing and guided city
setup. Account can show the display name on Profile. Keep the email on Account.
Places shows a primary saved label or city. Style uses closet setup status until
CC-7.20 adds an account style profile. Premium uses actual entitlement, Notifications
uses the saved preference, Language uses the active locale, and About shows the app
name. Use a localized neutral value when a member read fails.

Use the existing contract statuses and category values. Count completed setup stages
from the reported step. Preserve the existing More menu as a route into setup when
progress is unavailable. CC-7.30 owns ranking outfits from a member's garments.
Reuse the existing Style this piece flow. Leave age, consent and photo handling intact.

</frozen-after-approval>

## Code map

- Web `apps/web/src/app/wardrobe/page.tsx` and native
  `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx` own the closet view.
  Reuse `closet-more-menu.tsx`, `closet-top-bar.tsx`, the existing detail and wardrobe
  reads, openers and upload or delete recovery.
- Web `apps/web/src/app/settings/` keeps the Profile route and adds four settings
  destinations plus Places. Reuse `NavRow`, `AppTopBar`, `ScreenGate`,
  `LocationsSection`, `ProfileAccount`, commerce and Premium sections. Update callers
  in `lib/ritual.ts` and the Community and Plan components. Keep old guided and billing
  returns working.
- Native `apps/mobile/app/(tabs)/settings.tsx` owns Profile. Move current controls to
  topic screens under `src/features/settings/`. Register routes in `app/_layout.tsx`
  and fallback parents in `src/components/app-top-bar.tsx`. Keep existing Places,
  Style and Notifications routes. Remove the header About action in `(tabs)/_layout.tsx`.
- Web `src/i18n/locales/` and native `assets/locales/` own text for all ten locales.

## Tasks and acceptance

- [x] Update the two Closet views and existing tile flows. Keep the API unchanged.
- [x] Add Profile rows, summary reads and child navigation in both apps.
- [x] Localize new labels and retain the existing disclosures on their topic screens.
- [x] Retire the resolved Profile exceptions from `packages/utils/src/screen-budget.json`.
- [x] Integrate [TEA's acceptance plan](../test-artifacts/test-design-7-16-calm-closet-profile.md)
      and link the verified coverage in learning path Step 73.
- [ ] Fix all findings from the one full review and applicable CodeRabbit round.
- [ ] Mark sprint and spec done. Verify every workflow on the published head.

## Implementation notes

TEA owns tests, migrations and CI. The builder stages and commits after TEA acknowledges.
Keep `profile-{account,places,style,premium,notifications,language,about}-row` and
`profile-sign-out` on both clients. Web uses `/settings/{account,places,style,premium,language,about}`
and `/notification-settings`. Native uses `/settings-{account,style,premium,language,about}`,
`/locations` and `/notification-settings`.

Retain `closet-garment-grid`, `garment-card-ID`, `garment-open-ID` and actionable
`garment-status-STATUS`. Add `closet-category-filters`, `closet-category-all`,
`closet-category-CATEGORY` and `closet-setup-progress`. Web Language shows the active
language and browser setting guidance. Native keeps the existing picker and persistence.

Profile waits for the owner-scoped account, places, setup, Premium and notification
summaries on cold entry. It keeps the current owner's snapshots during a warm refresh.
Places, About and privacy, and Premium have separate web snapshots. The Profile Sign out
control remains available during web session verification. The notification client's
existing preference read accepts an abort signal for the summary.

The new labels cover all ten locales on each client. About and privacy holds Shopping
and partners on both clients. The disclosure remains above its switch.

A completed read with an empty display name or location list shows Not set.
If saved places have no primary, Profile names the first saved place. Account reserves
the email line while it loads. Guided Places keeps a normalized return path only when it
is a same-origin path with a single leading slash.

## Plan change log

The first CI run exposed a 105 px German Closet header at ordinary text and a
lost focus target after a garment disappears during Style. The header keeps Add and
More together. Each label can wrap. Style dismissal returns to Back when its opener
has gone. Native Premium waits for its first destination theme read.

The 320 dp Android captures showed mid-word breaks in garment and Profile labels.
Large text on compact native screens uses full-width garment cards and stacks
Profile values below labels. The visual flow resets device size and font scale
on entry, then shares setup across the enlarged-text captures.

## Review triage log

The independent review compared `d64216fa612b494fbad164e264068f453f9b60f8` with
`8a4ccc2bfcb5b2a4e26c642573ff5e6c6b3a0770`. Codex Security completed 104
static worklist receipts, with 25 inventory exclusions and zero reportable findings.
The review identified four high, six medium and three low items.

| Finding | Verdict | Action                                                                                                   |
| ------- | ------- | -------------------------------------------------------------------------------------------------------- |
| P1-1    | High    | Assert the More accessible name and the full Learn more disclosure trigger.                              |
| P1-2    | High    | Migrate native route, fold, Premium, and ready-card assertions.                                          |
| P1-3    | High    | Migrate web settings callers and inspect updated baselines from CI.                                      |
| P1-4    | High    | Route Maestro sign-out and Premium journeys through the topic rows.                                      |
| P2-1    | Medium  | Validate the final origin-relative Places pathname after normalization.                                  |
| P2-2    | Medium  | Provide the server snapshot for native identity stores.                                                  |
| P2-3    | Medium  | Mask native garment detail during Style dismissal and provide web destination i18n explicitly.           |
| P2-4    | Medium  | Distinguish empty, loading and failed account values. Both bearer helpers use the same storage fallback. |
| P2-5    | Medium  | Handle legal link failures and widen large-text native chips.                                            |
| P2-6    | Medium  | Test a real notification preference value and click through a garment status.                            |
| P3-1    | Low     | Correct Step 73's native Closet references.                                                              |
| P3-2    | Low     | Remove the unused browser guidance from native locale catalogs and update the test comment.              |
| P3-3    | Low     | Restore German visual fixture changes during Maestro cleanup.                                            |

## Screen budget decisions

The seven settings destinations and Sign out fit above the fold on both clients.
Keep direct access to all eight actions. The exception applies only to Profile's
target count. Remove the prior Profile chip, paragraph and 14-target exceptions.

- D-PROFILE-ROWS-7.16: `rule=targets-above-fold scope=web/profile/* max=8`
- D-PROFILE-ROWS-7.16: `rule=targets-above-fold scope=native/profile/* max=8`

## Verification

Use Node 24 for TypeScript and staged lint with `--no-stash`. Use CI for the suites,
screen budgets and 320 px or dp visual evidence. Check every workflow and retry result
on the exact PR head before reporting ready to merge.
