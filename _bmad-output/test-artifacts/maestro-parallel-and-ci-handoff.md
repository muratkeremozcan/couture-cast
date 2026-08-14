# Maestro: parallel local suite, and the CI work that remains

Written 2026-08-13 by the mobile session (Murat, Test Architect), handing the CI
work to a fresh session. Everything below was measured on this machine unless it
says otherwise.

## Where things stand

- **Local iOS suite is green: 18/18 flows in 13.8 minutes**, run across four
  simulators. The serial baseline at the start of the day was 9/18 in ~35
  minutes.
- Story 5.2 merged as `0c34858` (PR #129, 22/22 checks green). Work continues on
  branch `test/maestro-local`, where `744ca0d` is the latest commit.
- **Mobile CI has never executed.** `.github/workflows/pr-mobile-e2e.yml` is
  `workflow_dispatch`-only right now: the `pull_request` and `push` triggers were
  deliberately removed so a 60-minute red run would not block the PR.

Four measured runs after sharding landed: 18/18, 17/18, 17/18, 18/18. The two
17s were the same flow (`analytics`) with the same cause, now fixed. The first
18/18 predated the reporting fix below, so the final 18/18 is the one to trust.

## The tasks handed over

0. **Run Android locally first.** This machine can already do it — the SDK,
   `adb`, `emulator` and a `Pixel_9_Pro_XL` AVD are installed under
   `~/Library/Android/sdk`, just not on `PATH`. Nothing to install.

   ```
   MOBILE_E2E_PLATFORM=android node ./scripts/run-maestro.mjs maestro/sanity.yaml --artifacts
   ```

   Expecting CI to run a path that has never executed anywhere is the expensive
   way to debug it: a local failure gives a live screenshot, a hierarchy dump and
   a two-minute turnaround, where CI gives a log tail and a forty-minute wait.
   Get `sanity` passing on Android locally, then a few more flows, before
   dispatching anything.

   Report the asymmetry honestly: the local AVD is **API 36 / arm64-v8a /
   google_apis_playstore** and CI is **API 34 / x86_64 / google_apis** on Linux.
   (CI ran API 30 when this was written; it was moved to 34 later that day.)
   A local pass validates `ensureExpoGoOnAndroid`, `bootAndroidTarget`, the
   `install-expo-go.mjs` adb path, the `10.0.2.2` host mapping and the
   `host.exp.exponent` app id. It does **not** validate KVM, the AVD snapshot
   cache, or the `$GITHUB_PATH` fix.

1. `workflow_dispatch` the Maestro workflow with `suite: smoke` (3 flows). This
   exercises the whole pipeline — KVM, AVD snapshot, Expo Go install, Metro, the
   API, Supabase, Maestro — in a fraction of the time of the full suite, and
   yields the setup-cost number needed to decide about sharding CI.
2. Once smoke is clean, dispatch `suite: full`.
3. Restore the `pull_request` and `push` trigger blocks in the workflow, and
   remove the comment above `on:` saying it is intentionally dispatch-only.

## Confidence, stated plainly

**Low for a first-run pass.** Expect several iterations. The reasons are
specific:

- **The entire Android path of `scripts/run-maestro.mjs` has never run
  anywhere.** `ensureExpoGoOnAndroid`, `bootAndroidTarget`, the `10.0.2.2` host
  mapping and the `host.exp.exponent` app id are all first-run code in CI.
- Today's three fixes were found on iOS. Two generalise, one may not:
  - Metro answering its health check before it can serve a bundle: generalises.
    The runner now warms the bundle over HTTP first.
  - Stale driver processes holding a fixed port: iOS-specific.
  - The `Open in "Expo Go"?` confirmation: **iOS-specific, and Android has its
    own analogue.** Android may raise a chooser or a "just once / always" dialog
    on the first `openLink` on a fresh emulator. The guard added to
    `maestro/subflows/open-app.yaml` matches the iOS alert title only, so it is a
    no-op on Android. If Android flows fail on `tab-home` having never mounted,
    look for a dialog on screen before looking anywhere else, and take a live
    screenshot rather than reading the post-teardown one.
- Timing. Eighteen flows serial on a 4 vCPU runner, against a `timeout-minutes:
60` ceiling. Local serial was ~35 minutes on an M4 with 14 cores. If the full
  run lands near the ceiling, shard the flow list across parallel matrix jobs
  sharing one AVD cache rather than raising the limit. Do not use the local
  parallel path in CI: it needs several devices on one machine, which a 4 vCPU
  runner cannot host.

## How the local parallel run works, in case CI borrows from it

`npm run test:mobile:e2e:ios:shards` (or
`node ./scripts/run-maestro-shards.mjs --shards 4`).

- `scripts/run-maestro-shards.mjs` creates and names simulators
  (`couture-e2e-1..4`, pinned to `iPhone 17` to match the serial baseline) and
  hands the UDID list to the runner.
- `scripts/run-maestro.mjs` seeds **one fixture user per simulator** and drives
  them all from a **single** Maestro process with `--shard-split`.
- It must be one process: Maestro pins its iOS driver to a fixed host port and
  derives per-device ports from the device list it is given, so two `maestro`
  processes on one machine drive the same XCUITest runner and fail with
  `only one gesture can be performed at a time`.
- One process means one set of `-e` values and one Metro bundle, and a bundle can
  bake only one `EXPO_PUBLIC_E2E_ACCESS_TOKEN`. So the bundle carries a device
  name to token map and `apps/mobile/src/lib/mobile-auth.ts` selects this
  device's entry, still behind `__DEV__`. `expo-device` is imported **lazily**
  there: at module scope it breaks every unit test that reaches the module.
- `maestro/deep-link-handling.yaml` is excluded from the sharded pass and run
  afterwards on the first device, because its `WEATHER_ALERT_ID` belongs to one
  specific user and Maestro sends one set of `-e` values to every device.

## Rules that cost runs today

- **Never write to `apps/mobile/**`or`maestro/**` while a run is in flight.**
  Metro watches that tree; even a Prettier-only reformat triggers a rebundle and
  a live reload mid-flow, and results stop being attributable. This happened
  twice today, once from a sibling session and once from a `git pull`.
  `scripts/**` is safe mid-run because the runner is already loaded.
- **Launch long runs detached** (`nohup ... & disown`). Two 13-minute
  measurements were lost to an external `SIGTERM` tearing down the process tree.
  The runner logs `Received SIGTERM; stopping managed process trees` when this
  happens, so grep for it before believing a batch of failures.
- **Diagnose from `commands-*.json`** (`metadata.status` per step, and the
  `error.errorResponse` field), never from the failure screenshot, which is taken
  after teardown and shows the Expo Go launcher. For a live problem, take a
  screenshot of the running simulator instead: that is what identified the iOS
  confirmation dialog in one step after an hour of wrong theories.
- **Verify a Maestro property exists before using it.** `centerElement` was
  checked against `maestro-orchestra-models.jar` first. A previous session
  invented a `maxRuns` property and killed all 18 flows on a parse error.

## Defects fixed today, for the record

- `analytics.yaml` was the only functional flow launching with
  `clearState: false`, so it inherited whatever screen ran before it. Serially it
  always followed the same flow and got away with it; sharding removed that
  accident and it failed three times from three different screens.
- **The runner reported a green suite over a red one.** A `--shard-split`
  invocation exited 0 while its own summary printed `Passed: 16/17` and the JUnit
  report recorded `failures="1"`. The report is now the authority, and any flow
  missing from it fails the run. If you touch the reporting path, keep that
  property: the exit code may only _add_ a failure, never clear one.
- `alert-777` was a hardcoded row id two concurrent runs would fight over; it is
  now per user, and `deep-link-handling.yaml` reads it from `WEATHER_ALERT_ID`.
- The locale parity spec (`4.3-I18N-MOB-06`) surfaced a hardcoded English string
  still live on web, a sentence duplicated between a hint and an error on both
  surfaces, and the bounds `2` and `10` baked into twenty translations. The first
  two are fixed. The third is an open product-copy question with the user:
  `errors.garmentCount` should probably reuse the `{{min}}`/`{{max}}`
  interpolation that `garmentsRange` introduced.

## Open, not blocking

- **CodeRabbit did not review PR #129 at all** — zero comments, zero reviews,
  zero timeline events. Its last activity on this repository was PR #125 on
  2026-08-11; #128 and #129 both got nothing. `.coderabbit.yaml` is not the
  explanation. Needs someone with access to the GitHub App installation or the
  CodeRabbit dashboard. Note the config disables every summary comment type, so a
  clean review would look identical to no review; the empty timeline is the
  evidence, not the empty comment thread.
- Stale local Redis queue state fails `4.4-INT-15` and `4.4-INT-17` in
  `apps/api/integration/wardrobe-silhouette.integration.spec.ts` on this machine.
  Both pass in CI against a clean `redis:7-alpine`. Flush the queue locally.
