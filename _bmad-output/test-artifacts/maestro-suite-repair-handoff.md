# Maestro suite repair — handoff state

Rewritten 2026-08-13 by the second session (Murat, Test Architect), replacing the
first session's handoff. Everything below was verified on this machine. Verify
anything you rely on.

## The job

Make all 18 Maestro flows in `maestro/` pass locally. Murat's standing rule
applies: root-cause and fix, do not characterise-and-defer.

Work as Murat: invoke the `bmad-tea` skill first and keep the 🧪 prefix. He has
asked for this repeatedly and unprompted.

## Read this before running any git command

**Every file in `maestro/subflows/` is untracked (`??`), including
`open-app.yaml`, which carries this session's central fix.** `git clean -fd`, a
stray checkout, or a discard-untracked step would delete the entire launch
subflow set — `open-app.yaml`, `open-capsules.yaml`, `open-settings.yaml`,
`open-wardrobe-tab.yaml`, `scroll-to-card-bottom.yaml`, `set-locale.yaml` — and
with them the only working record of the developer-sheet fix. They are staged
work on a branch whose changes are deliberately uncommitted, so nothing else
protects them. Verify `git status --porcelain maestro/subflows/` still lists six
files before doing anything destructive.

Baseline at the end of this session: `HEAD` is `0e22a7c`, nothing committed,
nothing pushed, and `feat/epic5-story2-{rails,mobile,web,verify}` all present.

## Hard constraints

- **Story 5.2 is STAGED, NOT COMMITTED** (HEAD `0e22a7c`). Deliberate — he
  reviews it as one diff. **Do not commit. Do not push.** He has now finished
  that review and said it is good on his end, but the no-commit rule stands
  until he says otherwise explicitly.
- Safety net: the original 17 commits are reachable only from
  `feat/epic5-story2-{rails,mobile,web,verify}` and the reflog. Do not delete
  those branches.
- `.github/workflows/**` belonged to a second session (`ci-tea`), which has
  finished. `pr-mobile-e2e.yml` has still **never executed**. Claim nothing
  about its runtime behaviour.

## How to run

```
MOBILE_E2E_PLATFORM=ios node ./scripts/run-maestro.mjs --artifacts
```

With no flow arguments this now runs **all 18** flows (see defect 20). A single
flow still works: append `maestro/<flow>.yaml`. Android is unavailable locally
(no `adb`); every result here is iOS-only. Full suite ≈ 25-30 min.

Per-flow lines are `[maestro:runner] PASS|FAIL <path>`; the tail is
`Maestro suite: N/18`.

**Diagnose from `commands-*.json`, never from screenshots.** Maestro takes its
failure screenshot _after_ tearing the app down, so failures show the Expo Go
launcher and look like crashes when nothing crashed. `commands-*.json` in
`maestro/artifacts/<timestamp>/` carries a per-step `metadata.status`. Note the
array is **not in chronological order** — read statuses, not sequence.

Useful one-liner:

```
python3 -c "
import json,glob,os
fs=sorted(glob.glob('maestro/artifacts/*/commands-*.json'), key=os.path.getmtime)[-4:]
for f in fs:
    print('==', os.path.basename(f))
    for c in json.load(open(f)):
        if c.get('metadata',{}).get('status')=='FAILED':
            print('   ', json.dumps(c.get('command',{}))[:200])
"
```

Mid-flow `takeScreenshot` output is reliable and lands under
`maestro/artifacts/screenshots/maestro/artifacts/<name>.png` (the path nests).

## Verified score: 9/18

From the junit reports. A third full run was still in flight when this session
ended; its partial results are folded into the per-flow notes below and are
flagged as such.

**Passing (9):** `sanity`, `analytics`, `chip-navigation-bottom-nav`,
`deep-link-handling`, `garment-capture-flow`, `garment-smart-tagging-flow`,
`hero-experience`, `localization`, `premium-subscription`.

**Failing (9):**

| Flow                                    | Failing assertion                           |
| --------------------------------------- | ------------------------------------------- |
| `accessibility-hardening`               | `id: garment-swap-modal`                    |
| `commerce-affiliate`                    | `text: 'Shop this look'`                    |
| `garment-capsule-create-flow`           | `id: create-capsule-button`                 |
| `garment-capsule-repair-flow`           | `id: wardrobe-capsules-link`                |
| `garment-capsule-localization-flow`     | `text: 'Kombin kapsülleri'`                 |
| `wardrobe-onboarding-flow`              | `id: onboarding-permission-step`            |
| `wardrobe-onboarding-my-form-flow`      | `id: silhouette-tab-my-form`                |
| `wardrobe-onboarding-localization-flow` | `text: 'Gardırobunu oluştur'`               |
| `widget-deep-link`                      | `id: tab-home`, at launch, as the 18th flow |

Three of these (`chip-navigation-bottom-nav`, `deep-link-handling`,
`garment-smart-tagging-flow`) were red before this session and are now green.

---

## SOLVED: the chip taps — and it was never the chips

The previous session spent most of its time on `assertVisible: id: chip-community,
selected: true` and left it unsolved. **The chips were never broken.**

**Cause: Expo Go's developer-menu sheet eats the flow's first gesture.**

It is a native modal — dimmed backdrop over the top half, sheet over the bottom
half. The app under test stays fully rendered behind it, so **every
`assertVisible` still passes**, and then the backdrop swallows the next touch.
That is why the symptom always had the same shape: assertions fine, first gesture
silently ineffective, second gesture works.

Proved with a screenshot ladder (probe flow, since deleted):

| Shot       | After                                     | Result                                                                       |
| ---------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| `probe-00` | `runFlow: subflows/open-app.yaml` returns | **sheet still up**; `assertVisible: chip-community` passes anyway            |
| `probe-01` | first plain `tapOn: chip-community`       | sheet dismissed, PERSONAL still selected — the tap was spent on the backdrop |
| `probe-02` | second identical plain `tapOn`            | **COMMUNITY selected.** Plain `tapOn` works                                  |

This retires every earlier hypothesis. `longPressOn` only ever "worked" because a
coordinate tap had already spent the backdrop. The three disproved app-side
theories were disproved because none of them was the cause.
`apps/mobile/components/chip-navigation.tsx` is still byte-for-byte original and
should stay that way.

### The critical follow-on: Maestro cannot see this sheet

**This is the single most important thing in this document.** The sheet is drawn
by Expo Go, not by the app under test, so it never appears in the hierarchy
Maestro queries. The step log proves it: with the sheet filling half the screen,
`tapOn: text: 'Continue'` reports the element **not found**, and an
`assertNotVisible` on the sheet's own body text **passes**.

Consequences, all of which cost this session time:

- The sheet cannot be asserted on, waited for, or detected. Any guard that claims
  to prove it is gone is a false guarantee. I wrote one, caught it in the step
  log, and removed it.
- The optional `tapOn: text: 'Continue' / 'Open app'` steps that have been in
  these flows for months **were never capable of dismissing it**. They are kept
  only for a hypothetical variant Maestro can reach.
- Only a blind coordinate tap on the backdrop clears it.

`subflows/open-app.yaml` now spends two deliberate throwaway taps at `50%,10%`
(the navigation header, inert on the screen this subflow always lands on) with a
`waitForAnimationToEnd` between them, because the sheet rises a beat after
`tab-home` paints and a single tap can land just before it appears. The only
real post-condition available is `tab-home`.

Independent confirmation that others hit this: `garment-capture-flow.yaml`
carried a blind `tapOn: point: '93%,35%'` labelled "Close the Expo Go developer
panel when it appears late". That coordinate is the sheet's ✕ button. It has been
removed along with that flow's hand-rolled launch preamble.

---

## Defects fixed this session (numbering continues the previous handoff's 1-15)

16. **`accessibility-hardening` asserted MSW fixture garment ids.**
    `garment-tile-classic-trench-coat` and `swap-option-leather-jacket` exist only
    in the mobile unit tests' mock data. The live seed generates
    `<userId>-garment-<n>` (`packages/db/prisma/seeds/wardrobe.ts`), so the ids
    differ every run and the flow could never pass against a real server. Same
    class as defect 8. Rewritten to assert the contract data-independently: a tile
    opens the swap modal, the worn option carries `accessibilityState.selected`,
    and choosing another dismisses it.

17. **`deep-link-handling` asserted against an event nothing seeds.** The flow
    opens `?alertId=alert-777`; the app resolves the target by event id from
    `GET /api/v1/events/poll` via `resolveWeatherAlertDeepLinkTarget`. Real
    `alert:weather` envelopes come from the weather-alert fanout worker, and
    `alert-777` was only ever a unit-test fixture id.
    `scripts/run-maestro.mjs` now seeds exactly that envelope for the fixture user
    it creates, so it is torn down with the user. **This flow now passes.**

18. **The runner's cleanup was pointed at the wrong database.** _(the serious
    one — worth telling him about explicitly)_ `cleanupMobileE2EIdentity`
    resolved `MOBILE_E2E_DATABASE_URL || process.env.DATABASE_URL || <local
54322>`, while the API child process is handed
    `MOBILE_E2E_DATABASE_URL || <local 54322>` and ignores `DATABASE_URL`.
    Importing `@prisma/client` loads `packages/db/.env`, which sets
    `DATABASE_URL` to the developer's own database
    (`postgresql://murat@localhost:5432/couture_cast`). So the suite ran against
    54322 while cleanup issued its `deleteMany` calls against a different
    database: the deletes matched nothing, the transaction committed, and the
    runner logged success. Every run has been leaking its fixture user, location
    and ritual into the test database, and pointing deletes at a database it was
    never meant to write to. There is now one `MOBILE_E2E_DATABASE_URL` constant
    used by the API spawn, the cleanup and the new seed, with the
    `process.env.DATABASE_URL` fallback deliberately gone.

19. **`commerce-affiliate` never scrolled to the affiliate block**, which is the
    last child of the outfit card and off-screen on every device the suite runs
    on. Worse, its `assertNotVisible` opt-out checks were **not falsifiable**:
    content below the fold is "not visible" whether or not it renders, so those
    assertions would have gone green against a CTA that was still showing — the
    exact regression they exist to catch. Positive checks now `scrollUntilVisible`;
    negative checks go through the new `subflows/scroll-to-card-bottom.yaml`,
    which anchors on the garment tiles that sit directly above the block.
    **Still failing for a different reason — see below.**

20. **`scripts/run-maestro.mjs` defaulted to two flows.**
    `npm run test:mobile:e2e:ios` with no arguments ran `sanity` and `analytics`
    and reported success, having exercised two of eighteen. The default is now
    discovered from `maestro/*.yaml` (excluding `subflows/`), so a new flow is
    covered the moment it is written.

21. **Cross-flow leak #4: `WardrobeOnboardingState`.** It advances as garments
    are captured, and `wardrobe-onboarding-screen.tsx` reads `current_step` from
    the server to decide which step to resume at. A flow that captured a garment
    therefore left `wardrobe-onboarding-flow` opening past its own first step,
    reporting `onboarding-permission-step` "not found" — a stale server row
    presenting as a missing element. `scripts/run-maestro.mjs` now deletes that
    row before every flow (`resetMobileE2EPerFlowState`).
    **Deliberately narrow:** garments are NOT reset, because
    `DELETE /api/v1/wardrobe/garments/:id` is a retention _request_ rather than a
    hard delete and `GarmentItem` has relations without `onDelete: Cascade`.
    Adding a hand-ordered cascade that runs 18 times per suite on a hunch was not
    justified. Extend it only with a failure that demonstrates the need.

## Files changed this session

- `maestro/subflows/open-app.yaml` — the real fix; read its comments first.
- `maestro/subflows/open-capsules.yaml` — **new**, unverified.
- `maestro/subflows/scroll-to-card-bottom.yaml` — **new**, unverified.
- `maestro/chip-navigation-bottom-nav.yaml`, `maestro/accessibility-hardening.yaml`
  — `longPressOn` reverted to plain `tapOn`; the long misleading comment block
  about "Maestro's tap does not register on these chips" is gone from both.
- `maestro/garment-capture-flow.yaml`, `maestro/widget-deep-link.yaml` — migrated
  off hand-rolled launch preambles onto `subflows/open-app.yaml`.
- `maestro/deep-link-handling.yaml` — redundant post-launch dismissal taps removed.
- `maestro/commerce-affiliate.yaml` — scrolling and falsifiable negatives.
- `maestro/garment-capsule-{create,repair,localization}-flow.yaml` — routed
  through `subflows/open-capsules.yaml`.
- `scripts/run-maestro.mjs` — defects 17, 18, 20, 21.

No `apps/mobile/**` or `packages/**` source was changed by this session.

---

## Still red — what is known, and what is a guess

### `garment-capsule-*` (3 flows) — `wardrobe-capsules-link` not found

**This is the highest-value unsolved one: it blocks three flows.**

Established, do not re-derive: the element is **absent from Maestro's
hierarchy**, not merely slow. `subflows/open-capsules.yaml` waits for it with
`extendedWaitUntil ... timeout: 15000` inside a `retry: maxRetries: 3`, so it
survived 45 s of polling and still reported not found. My "the hub is still
mounting" hypothesis is therefore **disproved** — the added wait did not help.

Also established: `open-wardrobe-tab.yaml` succeeded first, so the app _is_ on
`wardrobe-screen`. And in an earlier run (before the subflow existed) the very
same `tapOn: id: 'wardrobe-capsules-link'` **completed** in
`garment-capsule-create-flow`, and only the following
`assertVisible: create-capsule-button` failed. So the link is reachable
sometimes.

**The untested lead, and it is a good one.** `wardrobe-hub-screen.tsx` sets
`importantForAccessibility={taggingGarmentId ? 'no-hide-descendants' : 'auto'}`
on the whole `wardrobe-screen` View. When a garment is left in `awaiting_tags`,
the hub auto-opens its tagging modal on mount (see the `pendingGarmentId` effect,
around lines 91-129), which sets that prop and **removes every descendant testID
from the accessibility tree Maestro queries** — while `wardrobe-screen` itself
stays visible, exactly matching the symptom. Garments are not reset between
flows (defect 21, deliberately), so a leftover `awaiting_tags` garment from
`garment-capture-flow` or `garment-smart-tagging-flow` is a live candidate.

To test it cheaply: add `takeScreenshot` immediately before the tap in
`subflows/open-capsules.yaml` (mid-flow screenshots are reliable) and run one
capsule flow. If the tagging modal is on screen, extend
`resetMobileE2EPerFlowState` to clear garments — and then the un-cascaded
relations problem in defect 21 has to be solved properly, most likely by deleting
`PaletteInsights` and any tagging-job rows before `GarmentItem`.

### `commerce-affiliate` — `text: 'Shop this look'`

**Nearly solved; the diagnosis is in hand.** The scroll fix worked. In the latest
run `scrollUntilVisible: id: shop-this-look-opens-in-browser`,
`assertVisible: id: shop-this-look-block`,
`'Paid partnership. CoutureCast may earn a commission.'` and
`'Presented by Sample Partner'` all **completed**, and only
`assertVisible: 'Shop this look'` failed.

The cause is almost certainly that the CTA is a `Pressable` carrying a composed
`accessibilityLabel` (`outfit-recommendation-card.tsx` joins label, partner and
the opens-in-browser warning into one string), so what Maestro sees is
`"Shop this look. Presented by Sample Partner. Opens in an in-app browser"`, and
Maestro's `textRegex` anchors rather than substring-matching. The plain `Text`
nodes matched fine, which is consistent.

Fix: assert `id: 'shop-this-look-cta'` instead of the bare text, and do the same
for the `below:` reading-order assertion. Keep the disclosure assertions on text,
since reading order is the actual requirement there.

### `wardrobe-onboarding-*` (3 flows)

`wardrobe-onboarding-flow` got materially further this session: it now clears
`wardrobe-onboarding-screen` (the previous failure) and stops at
`onboarding-permission-step`. Defect 21's per-flow reset was written specifically
for this and is **staged but never verified** — it landed after the last full run
that measured these flows.

`wardrobe-onboarding-localization-flow` fails on `'Gardırobunu oluştur'`, the
onboarding entry card title. `showOnboardingCard` is false once onboarding has
progressed, so this is plausibly the same leak and may be fixed by the same
reset. Unverified.

`wardrobe-onboarding-my-form-flow` fails on `id: silhouette-tab-my-form`.
**Not diagnosed at all.** Nothing is known about it beyond the assertion name.

### `widget-deep-link` — `tab-home` at launch

Failed as the **18th** flow, after 17 others, at `extendedWaitUntil: tab-home`
inside `open-app.yaml`'s retry, meaning the app never mounted. In the following
run the same flow produced **no failed steps at all**. Treat as environmental
end-of-run degradation rather than a defect in the flow, but confirm before
declaring it green — this flow was migrated onto `subflows/open-app.yaml` this
session and that change has only one clean run behind it.

---

## Scoped but NOT started: two guard tests

Requested near the end of the session, explicitly **after** the flows are green.
Both are deliberately low-tier: this work changed no schema, so contracts did not
move and a Pact or Playwright addition here would assert something that did not
change.

**Guard 1 — import safety across runtimes.** No tier in this repo catches "a
shared module throws at import time in one runtime". Unit tests run
Node/jsdom/chromium, Pact runs Node, Playwright runs a browser; only Maestro runs
Hermes. That is exactly why the module-scope `Intl.Segmenter` in
`packages/api-client` survived from 2026-08-08 until this week. The two
regression tests added for it cover that one function; **the class is
uncovered.** Write a test in `packages/api-client` that, for every public entry
point (`contracts/http`, `contracts/events`, the package index — enumerate them
rather than hardcoding if possible), deletes the optional `Intl` APIs a
Hermes-class runtime lacks (at minimum `Segmenter`; consider `ListFormat`, which
`packages/utils/src/accessibility.ts` already feature-detects, and
`DisplayNames`), then imports the module fresh under `vi.resetModules()` and
asserts it does not throw. Restore the descriptors in a `finally`. Seconds of
runtime; would have caught the outage on the day it shipped.

**Guard 2 — MSW fixtures drifting from the real seed.** Three defects now share
this root cause: `hero-experience` asserted MSW `comfortNotes` copy against a
live API (defect 8); `accessibility-hardening` asserted MSW garment ids (defect
16); `deep-link-handling` needed an event id nothing seeded (defect 17). The
pattern is that `apps/mobile/src/test-utils/msw/handlers.ts` invents shapes the
seed never produces, unit tests go green against the invention, and only an E2E
against real data exposes it. Add a guard that fails when a mobile MSW handler
fixture could not be produced by the real seed. **Shape level is the right
altitude** — garment ids match the seed's generated pattern rather than being
human-readable slugs, alert/event ids match what `packages/db` emits. Do not diff
full payloads; assert the identifier and enum shapes that actually drifted. Put
it somewhere `npm run validate` actually runs it.

---

## Verified green outside Maestro (from the previous session, re-check)

`mobile` 586 tests / 59 files · `api-client` 32 · API build clean · mobile
typecheck clean. **`npm run validate` was NOT re-run after this session's
changes.** This session touched only `maestro/**` and `scripts/run-maestro.mjs`,
neither of which unit tests cover, but run it before declaring done.

## Traps that cost time — do not pay for these twice

1. **Screenshots lie.** The failure screenshot is taken after teardown. Read
   `commands-*.json`. Its array is not in chronological order.
2. **Maestro cannot see the Expo Go developer sheet.** Nothing about it can be
   asserted. See the section above.
3. **`assertNotVisible` on below-the-fold content passes for the wrong reason.**
   Any negative assertion about card content must scroll first or it is
   unfalsifiable.
4. **`scrollUntilVisible` stops when its target _starts_ being visible.** Target
   the last element of a block, not the block container, or the rest stays below
   the fold.
5. **`@prisma/client` loads `packages/db/.env` on import**, silently setting
   `process.env.DATABASE_URL` in the runner process. Never resolve a test
   database URL through that variable.
6. **The suite shares ONE fixture user across all 18 flows** because
   `EXPO_PUBLIC_E2E_ACCESS_TOKEN` is baked into the Metro bundle at startup. Any
   durable server-side state a flow creates leaks into every later flow.
   Four such leaks have now been found (locale, settings scroll offset, affiliate
   opt-out, wardrobe onboarding state). Assume there are more.
7. **Do not edit flow files while a suite run is in progress.** Later flows pick
   up the edits mid-run and the resulting N/18 is meaningless. One run in this
   session was wasted that way.
