# Maestro mobile E2E: state, evidence, and what is left

Written 2026-08-14 on branch `test/maestro-local`, handing over to a fresh
session. Everything here was measured on this machine or read out of a CI run;
where something is believed rather than measured, it says so.

## The goal, unchanged

Local Android green and fast. Local iOS green and fast. CI green and fast.

## Where things stand

|               | Green                                                 | Fast                            |
| ------------- | ----------------------------------------------------- | ------------------------------- |
| Local iOS     | 18/18 (measured before this session, untouched since) | 13.8 min, 4 simulators          |
| Local Android | 7 pass / 3 fail of the first 10, run in progress      | **~1.5-2h serial, no sharding** |
| CI Android    | 0 flows have ever passed                              | sharded 4 ways, infra ~6 min    |

Local Android went from "the Android path had never executed anywhere" to a
suite that mostly passes. CI runs everything up to the app launching and then
fails, for a reason that is now pinned down but not fixed.

## THE CI BLOCKER, and the evidence for it

**The device's HTTP request has never reached Metro.** The decisive evidence is
Metro's own output: across five CI runs it logged only `Web Bundled …entry.js`
and `λ Bundled …render.js`, and **never once an Android bundle**. Both of those
lines come from the harness's own host-side checks. A real
`expo-platform: android` request would have made Metro bundle for Android.

Corroborating, from `logs/device-logcat.txt` in the uploaded artifacts: Expo Go
shows its own `Something went wrong.` screen and `expo-updates` logs
`Remote update request not successful` with code `UpdateFailedToLoad`.

Be careful with that last line. In expo-updates it is emitted at exactly one
place, behind `if (!response.isSuccessful)`, which is OkHttp's 200-299 check, so
it normally means an HTTP response WAS received with an error status. That
reading is what sent this session chasing a manifest 500 for several runs. It
sits in tension with the Metro evidence, and the tension is not resolved. One of
these is true and I do not know which:

1. Expo Go's `expo-updates` is failing to update **itself** against Expo's
   servers (the logcat does show an embedded kernel manifest with
   `assets.eascdn.net` URLs), and that error is a red herring, while the real
   fault is that the project request never leaves the device.
2. The project request does reach something and gets a non-2xx, and Metro's
   logging simply does not show a rejected manifest request as a bundle line.

**Resolve this first.** The cheapest discriminator: get the response body. The
harness now requests the manifest the way Expo Go does and logs status,
content-type and body, so read that line in the next run before theorising.

### What has been ruled out, with evidence

- Not the AVD snapshot. `Successfully loaded snapshot 'default_boot' using
5275 ms` in CI, down from a ~40s cold boot.
- Not KVM, the Maestro install, the `$GITHUB_PATH` fix, Supabase, the database
  reset, or Expo Go installation. All succeed in CI every run.
- Not the API level, despite a confident claim to the contrary earlier in the
  session. Issue #479 (API 30 emulators with no network on GitHub runners) was a
  symptom match, the bump to API 34 was made on that basis, and **the identical
  failure reproduces on 34**. Treat a known-bad image as a hypothesis to falsify.
- Not the host choice on its own. Both `127.0.0.1` (with `adb reverse`) and
  `10.0.2.2` have been tried; the app fails the same way on both.

### The trap that cost this session the most

**A check reported a verdict it had not earned, six times.** Every instance had
the same shape: the instrument failed, and its silence was read as evidence
about the thing being measured.

1. `toybox wget` absent on the image, reported as "cannot reach the network".
2. `nc` absent, reported the same way.
3. `nc -z` against a reverse-mapped port always succeeds at TCP level because
   the device itself is listening there, so a dead route reported healthy.
4. The netcat control was applied only to the `127.0.0.1` path, so `10.0.2.2`
   was still convicted by a broken instrument.
5. The probe's `adb` calls had no timeout, so a hang blocked the run for 30+
   minutes and looked like slow flows.
6. The manifest check asserted a 2xx and not the content type, so the browser
   interstitial's HTML 200 was logged as "manifest served".

The current code fixes all six. Keep the property: **a probe must observe the
thing it claims to observe, and must have a could-not-measure state distinct
from failure.** If you add a diagnostic, ask what else could make it pass, and
what happens when the tool it depends on is missing.

## What was fixed this session, all pushed

Bugs, not workarounds:

- `set -euo pipefail` in the CI emulator step. The action runs `script:` through
  dash AND splits it per line, so strict mode was both fatal and inert. The body
  now lives in `scripts/ci-mobile-e2e.sh`, invoked in one line.
- The AVD snapshot restored but was rejected at boot, because the action appends
  `hw.ramSize`/`disk.dataPartition.size` to `config.ini` on every invocation and
  the emulator normalises those values. Hardware inputs are on the creation step
  only.
- `new PostHog('')` threw at module scope and took down the whole bundle on any
  environment without a key. `app.config.ts` coerces the key to `''`, and `??`
  treats that as present.
- `lsof -ti tcp:8081 | xargs kill` in the Metro port cleanup killed the emulator
  and iOS simulators, because `lsof -i` matches clients as well as listeners.
  This is what made every local run after the first die with `0 devices`.
- `BackButton` is an iOS-only identity; Android needs `back`. `back` on iOS is
  an empty method, not a swipe as the old comments claimed.
- `hideKeyboard` on Android is `input keyevent 4`, which React Native's
  `Modal onRequestClose` treats as dismiss, so it closed the capsule builder.
- The tagging modal blocks the hub assertion on Android but not iOS, where the
  hub stays in the hierarchy behind it. `garment-capture-flow` was green while
  blocked.
- The JUnit report is now authoritative on the **serial** path, which is the one
  CI runs. It previously guarded only the parallel path.
- Report parsing follows Maestro 2.8.0's `<timestamp>/<Flow Name>/` layout,
  counts `<skipped>` as a failure, and fails loudly on an unreadable report.

Hollow green removed:

- `garment-capsule-repair` asserted a Home-screen ritual label from the wardrobe
  hub with `optional: true`, after a `back` that is a no-op on iOS. Neither half
  could fail. Removed; the behaviour is asserted in `ritual.service.spec.ts`.
- `garment-capsule-create` selected garments by `index: 0`/`index: 1`, and
  `index` resolves against what is currently RENDERED. With ten seeded garments
  the list is virtualised, so it had been selecting **one** garment while
  claiming two, and every later step still passed. It now selects by seeded id
  (`GARMENT_A_ID`/`GARMENT_B_ID`, passed like `WEATHER_ALERT_ID`) and asserts
  `Garments (2 of N selected)`.

Infrastructure:

- Maestro is pinned to 2.8.0 in `scripts/maestro-install.mjs`, and CI asserts the
  resolved version rather than merely that a binary exists. Local was 2.0.10 and
  CI was taking whatever the installer served: eight releases apart.
- CI is sharded across four parallel jobs, round-robin sliced, sharing the AVD
  cache. Serial was ~66 min against a 60 min ceiling, so it could not have passed
  even fully green. Projected ~20 min.
- AVD cache key includes the runner image, so an emulator bump cannot silently
  invalidate the snapshot while the key still hits.

## What is left

### 1. The CI blocker

Above. Nothing else in CI matters until the app launches.

### 2. Three local Android failures

- `garment-capsule-create`: **fix is known and not yet applied.** Selecting by id
  removed the positional ambiguity but not the virtualisation, so
  `garment-checkbox-${GARMENT_B_ID}` is not in the hierarchy. Add
  `scrollUntilVisible` on that exact id before the tap. Deterministic now that
  the id is exact.
- `commerce-affiliate`: `assertNotVisible: shop-this-look-block` failed, meaning
  the block was still visible after the opt-out toggle. Passed 40 minutes
  earlier on the same Maestro version. Untriaged: flake or order dependence.
- `garment-smart-tagging`: untriaged.

Re-run each in isolation first to separate flake from order dependence.

### 3. Local Android sharding

Local Android is serial at roughly 1.5-2 hours; iOS does 18 flows in 13.8
minutes across four simulators. `scripts/run-maestro-shards.mjs` hardcodes
`MOBILE_E2E_PLATFORM: 'ios'` and creates simulators. Android needs the same:
create N named AVDs (distinct names matter, because the bundle carries a device
name to token map and `apps/mobile/src/lib/mobile-auth.ts` selects this device's
entry), boot them, and drive them from one Maestro process with `--shard-split`.

### 4. Move E2E off Expo Go

This is the future-proofing change and it is the one with the largest payoff.
Expo's own Maestro CI tutorial builds an `e2e-test` EAS profile
(`buildType: apk`, `withoutCredentials: true`) and never uses Expo Go. Expo
states plainly that Expo Go does not accurately simulate deep linking, which is
how every flow in this suite launches the app.

Concretely, testing Expo Go costs:

- A CI-only failure surface: a live Metro, a manifest HTTP exchange, and a deep
  link into a third-party app. The current blocker lives entirely in that
  surface.
- `widget-deep-link` cannot pass on Android at all, because Expo Go does not
  register the `mobile` scheme that `app.json` declares.
- `premium-subscription` can only assert the feature is ABSENT, because the
  RevenueCat native module is not in Expo Go. Already recorded as debt in
  `deferred-work.md`.
- Roughly 120 of the 195 lines in `maestro/subflows/open-app.yaml` exist purely
  to fight Expo Go, including two blind coordinate taps for a sheet the comment
  admits Maestro cannot see.

An audit put 6 to 8 of this session's ten fixes in the category of "would not
have been needed". `expo-dev-client` is already a dependency and `eas.json`
already has a `development` profile with `buildType: apk`. Only two flows
reference `${APP_URL}` directly; everything else goes through `open-app.yaml`,
which mostly deletes.

Frame it as a build-artifact decision rather than an Expo one: the defect class
is "a development shell with a CI-only launch path", and it is not unique to
Expo.

## Rules that cost runs, keep them

- **Never write to `apps/mobile/**`or`maestro/**` while a run is in flight.**
  Metro watches that tree and a reformat rebundles mid-flow. `scripts/**` is
  safe. This session broke that rule once and had to discard a run.
- **Launch long runs detached** (`nohup … & disown`) and grep for
  `Received SIGTERM` before believing a batch of failures.
- **Diagnose from `commands.json` and `screen-hierarchy/step-*.json`**, never the
  failure screenshot, which is taken after teardown and shows the launcher. The
  per-step hierarchies let you read the step BEFORE the failure.
- **Verify a Maestro property exists before using it**, and verify it behaves as
  believed before writing a comment asserting why. A previous session invented a
  `maxRuns` property and killed all 18 flows on a parse error; this one asserted
  `xargs -r` was GNU-only when the BSD man page documents it.
- **`[ci skip]` on iteration commits** whose verification comes from a dispatch
  rather than the pipeline. Drop it on the commit meant to be reviewed.

## Open, not blocking

- CodeRabbit has not reviewed PR #129 or #130. Last activity on this repository
  was #125 on 2026-08-11. Needs someone with GitHub App access. Its config
  disables summary comments, so a clean review and no review look identical; the
  empty timeline is the evidence.
- `766c475`'s message describes only the CI script and cache changes, but the
  commit also carries the report-authority rewrite. The code is right, the
  message is incomplete. Not rewritten because it was already pushed.
- The `pull_request` and `push` triggers are still off. Restore them only after
  a dispatched run is green: a workflow_dispatch run still publishes its check
  against the head SHA, so `pr-gate` counts it either way, but that is not a
  reason to commit every PR in the repo to an unproven job.
