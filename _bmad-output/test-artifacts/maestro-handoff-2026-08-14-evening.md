# Maestro mobile E2E: handoff, evening of 2026-08-14

Branch `test/maestro-local`, PR #130. Everything below was measured on this
machine or read out of a CI run. Where something is believed rather than
measured, it says so.

## Where it stands

|               | Start of day                                    | Now                                             |
| ------------- | ----------------------------------------------- | ----------------------------------------------- |
| CI Android    | 0 flows had ever passed; the app never launched | 18/18 green once, 17/18 twice with named causes |
| Local Android | 10/18, ~1.5-2 h, serial only                    | 18/18, ~21 min across 4 emulators               |

CI run history, most recent last. Every failure was traced to a cause and
fixed rather than re-run until lucky:

- `31823987190` 18/18 — but `widget-deep-link` was hollow, see below
- `31826278787` 16/18 — capsule retry re-tapping a stale position; affiliate
- `31828805210` 17/18 — capsule asserting an off-screen count label
- `31831107409` 17/18 — a third count assertion that had been missed
- `31832602862` **18/18, verified real** (5+4+5+4, every flow named PASS)
- `31834020735` 17/18 — affiliate, `retryTapIfNoChange` undoing the opt-out

## THE IMMEDIATE TASK

Our user's instruction, verbatim: "now, instead of a trigger job, let's make
that run in PRs. Trigger job is optional. Wait for the run to finish, make the
changes, watch CI. If green, merge."

Order of work:

1. **A local verification is in flight.** `commerce-affiliate` twice in a row,
   PID may still be alive; the log is
   `/private/tmp/claude-501/-Users-murat-opensource-couture-cast/c32aa7a8-2118-409d-b717-3ab0a1dd1f22/scratchpad/affiliate-toggle-verify.log`.
   Wait for it. It verifies the uncommitted `maestro/commerce-affiliate.yaml`
   change described below. **Do not write to `maestro/**`or`apps/mobile/**`
   while a run is in flight** — Metro watches that tree and a reformat
   rebundles mid-flow.
2. **Commit the affiliate toggle fix** (currently uncommitted in the working
   tree) once verified.
3. **Enable the PR trigger.** `.github/workflows/pr-mobile-e2e.yml` is
   `workflow_dispatch`-only today. Match the sibling convention in
   `.github/workflows/pr-pw-e2e-local.yml`, which is exactly:

   ```yaml
   on:
     pull_request:
     push:
       branches:
         - main
     workflow_dispatch:
   ```

   Keep `workflow_dispatch` and its `suite` input — our user said the manual
   trigger stays, as optional. Two things to know: on a `pull_request` event the
   `inputs` context is empty, so `${{ inputs.suite }}` renders as `""`, the
   smoke branch is false and discovery takes the full-suite path, which is what
   we want. And the header comment at the top of the file explains why the
   triggers were removed; rewrite it rather than leaving it contradicting the
   new `on:` block.

4. **Do NOT put `[ci skip]` on that commit.** Every commit today carries it
   because verification came from a dispatch; this one must actually run.
5. **Watch the PR run, and merge if green.** Verify green is real before
   merging: `gh run view <id> --json jobs` plus grepping the logs for
   `Maestro suite: N/N flows passed` on every shard and the per-flow `PASS`
   lines. The counts must add to 18. This suite has produced a green run
   containing a flow that proved nothing, so a green conclusion is not
   sufficient evidence on its own.

## The uncommitted change you are about to verify and commit

`maestro/commerce-affiliate.yaml`: removed `retryTapIfNoChange: true` from both
`commerce-opt-out-toggle` taps.

Evidence, from run `31834020735` shard 4. The opt-out assertion failed with the
block fully rendered — all five `shop-this-look-*` nodes present in the
hierarchy — and the API log shows **two** `PUT /api/v1/commerce/preferences`
315ms apart, both 200. Maestro tapped, did not see the screen change quickly
enough, and tapped again, so the flow opted out and straight back in. The ritual
fetched afterwards correctly carried the offer and the assertion was right to
fail.

The rule: `retryTapIfNoChange` is safe for an idempotent action and destructive
for anything that flips state. I audited the other twelve uses in the suite —
tab navigation, locale buttons, and the scenario toggles, which are radio-like
selectors rather than binary flips — and the commerce opt-out was the only true
toggle. The `extendedWaitUntil` on `Shopping preferences updated` already proves
the write round-tripped, so a genuinely lost tap still fails loudly.

Two theories I ruled out on the way, so you do not repeat them: a stale server
ritual cache (`shopThisLook` is deliberately excluded from the Redis payload and
added by `RitualController` after the service returns — see the comment at
`apps/api/src/modules/personalization/ritual.service.ts:50`), and a missing
cache invalidation on opt-out (invalidation exists for tag updates and is not
needed here for the same reason).

## The single most useful thing learned today

**`assertVisible` and `extendedWaitUntil: visible` require the element inside the
VIEWPORT, not merely present in the hierarchy.** This caused three separate
defects, each presenting as something else entirely:

1. `premium-subscription` failing on `premium-unavailable`. I chased a PostHog
   flag answer, an unbounded dynamic import, and a stuck availability state, and
   wrote up a plausible mechanism for each. All three were wrong. Two
   measurements killed them: the device log said
   `Expo Go app detected. Using RevenueCat in Browser Mode.`, and querying the
   API directly returned `purchasesEnabled: true`. That left the viewport.
2. CI booting `pixel_3a` (~807dp tall) against local `medium_phone` (~914dp).
   A screen 12% shorter produced a class of CI-only "not visible" failures:
   `premium-status-line`, `garment-confirm-image`, `reorder-row-.*`,
   `garment-tag-comfort-mild`. Both now use `medium_phone`.
3. My own capsule assertion targeting the `Garments (n of m selected)` label,
   which the scroll that reaches the garment pushes off screen.

**The discriminator is cheap and should be the first thing you reach for**: dump
the failing step's `screen-hierarchy/step-*.json`. Id present with out-of-bounds
coordinates means a scroll problem. Id absent means a different bug.

An audit found most flows assert without scrolling at all —
`wardrobe-onboarding-flow` has 17 assertions and 0 scrolls, `garment-capture-flow`
11 and 0. Those are latent screen-height dependencies, latent only because CI and
local now boot the same profile. Deliberately left alone: adding scrolls to 18
files on suspicion is churn and the profile match is the systemic fix. Anyone
changing a device profile again needs to know this is underneath.

## Everything fixed today

- **The CI blocker.** Expo Go requests a code-signed manifest
  (`expo-expect-signature`, `keyid="expo-root"`). Because `app.json` carries
  `extra.eas.projectId`, `@expo/cli` fetches a development certificate from
  Expo's API, which needs an account, and `EXPO_NO_INTERACTIVE=1` turns the login
  prompt into a hard error. A developer machine never sees it because
  `~/.expo/state.json` and `~/.expo/codesigning/<projectId>` both exist locally.
  Fixed with `--offline` on the dev server, which serves an unsigned manifest —
  Expo Go accepts those by design. The trigger is `projectId`, NOT `owner`.
- **Three `avdmanager` defects**, worst first: `target=android-0` in the AVD's
  `.ini` (it cannot parse a dotted API level), which silently disables hardware
  acceleration and the device never leaves `offline`; `hw.gpu.enabled=no`; and
  `hw.keyboard=no`. Shard emulators also boot `-gpu auto` rather than
  `swiftshader_indirect`, which does not survive several at once on this host.
- **Android device naming.** `expo-device`'s `deviceName` reads
  `Settings.Global.DEVICE_NAME` (API 32+) or `bluetooth_name` below that, and on
  an emulator both default to the product model. Four differently-named AVDs
  produce four identical token-map keys, so every shard signs in as the same user
  and they delete each other's data while every flow still passes. The name is
  written per device with `adb shell settings put`, read back from the same
  namespace, and a duplicate key is a hard error.
- **Expo Go installer**: re-downloaded ~183MB per emulator; then the first cache
  attempt reused a truncated fragment. Now keyed on a hash of the resolved URL
  and validated by looking for the ZIP end-of-central-directory record.
- **ANR dialog** (`Pixel Launcher isn't responding`) taking window focus.
  `hide_error_dialogs` is set per device but is NOT sufficient on its own —
  ActivityManager latches it at boot — so `open-app.yaml` also dismisses it.
- **The splash race**: the route-cleanup guard fired when the app had not
  mounted, and two system BACK presses walked Expo Go out to the Android
  launcher. Measured in today's artifacts.
- **Hollow greens**: `widget-deep-link` asserted a container already on screen;
  `garment-capsule-repair` picked the replacement garment by `index: 0` and its
  reversal assertion was equally true of a capsule that had LOST a garment; the
  create flow's edit tap could open the seeded capsule and still pass.
- **`text:` selectors are whole-element regex.** `Garments (2 of .* selected)`
  reads the brackets as a capture group, so it could never match
  `Garments (2 of 10 selected)`.
- **`inputText` duplicated the leading character** under four-emulator load,
  committing a capsule named `MMaestro capsule`. Now `eraseText`, type, assert
  what was typed, inside a `retry`.
- **A retry that does not re-locate its target** is a retry of a stale position.
  The `scrollUntilVisible` must be INSIDE the `retry`.
- **The widget deep link was built with the wrong scheme on Android.** iOS used
  the `exp://…/--/` form Expo Go routes; Android hardcoded `mobile://`, which the
  shell cannot resolve. There was never a reason for them to differ. The flow is
  NOT impossible in the shell, contrary to what an earlier handoff said.
- **A CI pin check broken by a refactor**: it scraped the version constant out of
  `maestro-install.mjs` by regex, and would have died on `[1] of null` after the
  pin moved to `scripts/maestro-version.mjs`. It imports the module now.

## Rules that cost runs, keep them

- Never write to `apps/mobile/**` or `maestro/**` while a run is in flight.
  `scripts/**` is safe.
- Launch long runs detached (`nohup … & disown`) and grep for `Received SIGTERM`
  before believing a batch of failures.
- Diagnose from `commands.json` and `screen-hierarchy/step-*.json`, never the
  failure screenshot, which is taken after teardown.
- Verify a Maestro command or selector exists before relying on it: write a
  scratch flow and run `maestro check-syntax`. A previous session invented a
  property and broke all eighteen flows on a parse error. Confirmed real in 2.8.0
  this way: `retry`/`maxRetries`, `eraseText`, `selected:`, `checked:`. Confirmed
  ABSENT: `--driver-host-port`.
- `[ci skip]` on iteration commits verified by a dispatch. Drop it on the commit
  meant to be reviewed — including the trigger commit.
- The workflow's concurrency group uses `cancel-in-progress`, so dispatching a
  second run kills the first. Serialise them.
- Maestro is pinned to 2.8.0 in `scripts/maestro-version.mjs`. Do not let it
  float.

## Open, not blocking

- **Shard count stays 4.** Measured: four emulators 21.1 min, two 27.3 min. Four
  oversubscribes this host (load average 20 on 14 cores) and stretches per-flow
  times, but total wall clock is shorter and that is what gates a PR.
- **`--flatten-debug-output`** drops the per-run timestamped subfolders entirely.
  Better than our current newest-directory resolution, which cost a wrong path
  more than once. Not adopted yet.
- **Capsule edit/delete blast radius.** Two `index: 0` taps remain in
  `garment-capsule-create-flow`; no id exists because the capsule is created
  in-flow. A mis-tap fails loudly rather than passing hollow, but if it ever
  resolved to the runner's seeded capsule it would also destroy the fixture
  `garment-capsule-repair-flow` depends on.
- **P0-P3 priority tags.** Both TeA reviews flagged their absence. The suite has
  18 flows and the reviews saw 6; tagging 6 is worse than tagging none. Nothing
  consumes tags today. Our user's call.
- **The Expo Go to release-APK migration**, researched and endorsed but not
  started. Only a RELEASE variant embeds the JS bundle; `developmentClient: true`
  forces `assembleDebug` and keeps the live-Metro dependency, so it would swap
  one CI-only network surface for another. Use `expo prebuild` +
  `./gradlew :app:assembleRelease`, not `eas build --local` ("Caching is not
  supported"). A locally prebuilt release APK is debug-signed and installs on an
  emulator. `__DEV__` is false in release, so the E2E token must move to an
  `EXPO_PUBLIC_` variable with a throwaway credential.
- **Reviews are all closed.** CodeRabbit (3 fixed, 1 skipped with reasoning),
  Codex TeA 96/100 (5 fixed), Claude TeA 97/100 (all findings stale). The
  bmad-tea knowledge base was updated by a peer session in PRs #132 and #133,
  both merged.

## Corrections I made to my own work, so you do not inherit the errors

I was wrong three times about the premium failure before measuring. I claimed
crash dialogs were "suppressed" when I had only verified a setting was written.
I hypothesised the harness's back-presses caused the ANR before the step
hierarchies showed it appears at step 9, well before them. I told a peer session
`widget-deep-link` was impossible under Expo Go and had to retract it. And I
built a retry to defend against a lost tap that, in CI, was not a lost tap at
all — the tap had worked and the checkbox carried `checked=true` in the very same
hierarchy dump.

The pattern in all of them: reasoning ahead of measurement, and a plausible
mechanism is not evidence. The cheap measurement is usually already sitting in
the captured artifacts.
