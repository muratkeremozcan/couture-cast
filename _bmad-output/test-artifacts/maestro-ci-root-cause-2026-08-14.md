# The Maestro CI blocker: root cause, fix, and what the research changed

Written 2026-08-14 on branch `test/maestro-local`, continuing the work recorded
in `maestro-handoff-2026-08-14.md`. That document remains accurate about
everything except its central diagnosis, which is corrected below.

## The goal

Parallel, stable mobile runs with Android and iOS locally. The same for CI,
Android only: CI iOS is explicitly not wanted, so the single
`mobile-e2e-android` job in `.github/workflows/pr-mobile-e2e.yml` is correct as
it stands and its absence of an iOS counterpart is not a defect.

## The CI blocker, root-caused

Zero flows had ever passed in CI. It is not the AVD snapshot, the API level, the
host route, KVM, the Maestro install, Supabase, or the database reset. It is
**Expo Go asking the dev server for a signed manifest**.

The chain, each link read out of `@expo/cli` in this repository's
`node_modules` and confirmed against a CI log:

1. Expo Go requests the manifest with an `expo-expect-signature` header whose
   `keyid` is `expo-root`.
2. `getCodeSigningInfoAsync` (`@expo/cli/build/src/utils/codesigning.js:187`)
   routes that to `getExpoRootDevelopmentCodeSigningInfoAsync`, which proceeds
   only when the app config carries `extra.eas.projectId`. `apps/mobile/app.json`
   carries `340f5908-84cd-492e-bc59-2909fca66e9e`.
3. Unless `EXPO_OFFLINE` is set, that function calls
   `fetchAndCacheNewDevelopmentCodeSigningInfoAsync`, which calls
   `tryGetUserAsync` (`@expo/cli/build/src/api/user/actions.js:137`) to fetch a
   development certificate from Expo's API and cache it under
   `~/.expo/codesigning/<projectId>`.
4. With no Expo session, `tryGetUserAsync` prompts to log in.
   `scripts/start-mobile-server.sh` exports `EXPO_NO_INTERACTIVE=1`, so the
   prompt cannot be answered and the CLI throws:

   ```
   CommandError: Input is required, but 'npx expo' is in non-interactive mode.
   Use the EXPO_TOKEN environment variable to authenticate in CI
   ```

That error appeared in three of the four shards of run `31797613899`. A
developer machine never sees it: `~/.expo/state.json` holds a session and
`~/.expo/codesigning/340f5908-…` holds the cached certificate. A GitHub runner
has neither.

The fix is `--offline` on the dev server, which takes the `!EXPO_OFFLINE` branch
out of the signing path so an unsigned manifest is served instead. Expo Go
accepts unsigned manifests by design. Expo CLI documents the flag as "Skip
network requests and use anonymous manifest signatures". It is applied on every
path rather than only in CI, because nothing in this suite asserts anything
about manifest signing and local/CI parity is the point of the harness.

### Two premises from the previous handoff that are now disproven

- **"The device's HTTP request has never reached Metro."** Run `31797613899`
  logged `Android Bundled 23540ms node_modules/expo-router/entry.js (2044
modules)`. Metro does bundle for Android in CI.
- **The tension the previous session could not resolve** — `Remote update
request not successful` implying a response was received, versus Metro
  appearing never to be asked — dissolves here. A response _was_ received: the
  error the CLI returned when it could not sign the manifest.

### Why the old manifest check missed it for five runs

The check omitted `expo-expect-signature`, so it took a different branch through
the middleware than the app under test and was answered with a healthy manifest
while every request Expo Go made failed. It now sends that header. The general
rule the previous session wrote still holds and this is another instance of it:
a probe must ask the same question as the thing it stands in for.

## Three defects in `avdmanager`-created AVDs

Found while building local Android sharding. All three were measured on this
machine, and the third is the one that actually stopped the emulators booting.

1. **`target=android-0` in the AVD's `.ini` pointer file.** `avdmanager` cannot
   parse a dotted API level, so `system-images;android-36.1;…` produces
   `target=android-0`. The emulator then cannot resolve the platform, silently
   drops hardware acceleration (`hvf is not enabled on this aarch64 host`,
   followed by `qemu_mprotect__osdep: mprotect failed: Permission denied`), and
   software-emulates ARM64 on an ARM64 host. The device never leaves `offline`
   in `adb devices`. The same parse failure leaves `avd.id` and `avd.name` as the
   literal string `<build>`. With `target` corrected the identical AVD boots with
   zero acceleration warnings.
2. **`hw.gpu.enabled=no`.** gfxstream then logs `Failed to make display surface
context current` and `Failed to bind to post worker context`, and boot never
   completes.
3. **`hw.keyboard=no`.** Milder, but wrong for a suite that types through adb
   rather than the soft keyboard.

`disk.dataPartition.path=<temp>` is left alone deliberately. It means the data
partition does not survive shutdown, so Expo Go is reinstalled on each cold
boot. That is a cost rather than a failure, and removing the key without
supplying a real userdata image leaves the emulator with no data partition and
hangs the boot.

## Android device naming, which is not symmetric with iOS

The bundle carries a device-name-to-token map that `apps/mobile/src/lib/mobile-auth.ts`
reads, so each shard signs in as its own fixture user. On iOS the name is a
property of the simulator and the runner reads it.

Android has no equivalent. `expo-device`'s `deviceName` reads
`Settings.Global.DEVICE_NAME` on API 32 and above and the `bluetooth_name`
secure setting below that
(`node_modules/expo-device/android/src/main/java/expo/modules/device/DeviceModule.kt:103`).
On an emulator both default to the product model: AVD `Medium_Phone_API_36.1`
reports `sdk_gphone64_arm64` for both. **Naming the AVDs distinctly does not
work** — four differently named AVDs produce four identical map keys, every
shard signs in as the same user, and they delete each other's garments mid-flow
while every flow still passes.

So the name is written per device with `adb shell settings put`, read back, and a
duplicate key is a hard error.

## Local Android suite, reframed

The 2026-08-14 serial run finished 10/18. The raw count overstates the number of
distinct defects: the last four failures (`wardrobe-onboarding`,
`wardrobe-onboarding-localization`, `wardrobe-onboarding-my-form`,
`widget-deep-link`) are one cascade from

```
Maestro Android driver did not start up in time on emulator [ emulator-5554 ] (driver port 53711)
```

after which the following three flows failed in one to two seconds each with no
`commands.json` written at all.

Distinct failures:

- `garment-capsule-create` — **fixed**. The builder virtualizes a ten-garment
  list, so selecting by seeded id still could not find a garment below the fold.
  Both ids are now scrolled to before being tapped.
- `commerce-affiliate` — `assertNotVisible: shop-this-look-block` failed, plus
  three separate 45-second `tab-home` launch timeouts within the one flow.
- `garment-smart-tagging` — `"Loading wardrobe" is not visible` failed.
- `premium-subscription` — `premium-unavailable` never rendered.
- `widget-deep-link` — cannot pass under Expo Go on Android, which does not
  register the `mobile` scheme.

**Eight of the fourteen flows whose artifacts were inspected burned at least one
45-second `tab-home` timeout, ten in total.** Every one is in the Expo Go launch
path. Most flows recovered through the retry subflow and still passed, so the
cost shows up as wall-clock and flakiness rather than as failures.

## Moving off Expo Go: what the research established

Commissioned because the vendor or the community had probably solved this
already. They have, and the finding corrected the plan.

- **Expo's tutorial shape is current.** `docs.expo.dev/eas/workflows/examples/e2e-tests`
  (updated 2026-07-22) and `docs.expo.dev/tutorial/cicd/e2e-tests` (2026-07-08)
  both build an `e2e-test` profile with `withoutCredentials: true`,
  `android.buildType: "apk"`, `ios.simulator: true`, and launch flows with
  `launchApp` against the package id rather than `openLink`.
- **A development build does not solve this.** `developmentClient: true` sets
  `gradleCommand` to `:app:assembleDebug`, and a debug variant does not embed
  the JS bundle, so it still needs a live Metro and a manifest exchange. Only a
  **release** APK embeds the bundle and removes the network surface. SDK 54's
  `debugOptimized` variant is a trap: it optimizes C++ only and remains a debug
  variant. `--no-dev --minify` changes bundle contents while still serving from
  Metro and solves nothing here.
- **`eas build --local` is the wrong tool**: its own documentation says
  "Caching is not supported", it still requires `EXPO_TOKEN`, and
  `withoutCredentials` with `--local --non-interactive` is reported broken
  (eas-cli#3197). Use `npx expo prebuild --platform android` followed by
  `./gradlew :app:assembleRelease`.
- **A locally prebuilt release APK is debug-signed.** The generated
  `android/app/build.gradle` sets `release { signingConfig signingConfigs.debug }`,
  so it installs on an emulator without credentials. This must not be carried
  into a store build.
- **`__DEV__` is the sharp edge for this repository.** The E2E access token in
  `apps/mobile/src/lib/mobile-auth.ts` is gated behind `__DEV__`, which is false
  in release, so a release APK would resolve no token at all. The gate has to
  move to an `EXPO_PUBLIC_` variable, which Metro inlines at bundle time and
  which therefore survives into a release binary. It lands in the binary in
  plaintext, so the credential must be a throwaway test one.
- **Build cost**: 15-30 minutes cold and 3-8 minutes warm are working estimates,
  not measurements; no controlled benchmark exists. `newArchEnabled: true`
  pushes toward the high end. The established shape is one build job publishing
  an artifact that every Maestro shard downloads, which is what `expo/expo` and
  `obytes/react-native-template-obytes` both do.
- Prior art worth reading before implementing: `expo/expo`'s own
  `.github/workflows/test-suite.yml` (release APK, `reactivecircus/android-emulator-runner`
  pinned, boot and flow retries) and `bluesky-social/social-app`'s
  `nightly-e2e.yml` (dev-client APK, and the price it pays in `adb reverse`
  plumbing).

`apps/mobile/eas.json` currently has a `development` profile that sets both
`developmentClient: true` and `android.buildType: "apk"`, where the first
silently overrides the second to `assembleDebug`, and a `production` profile
that builds an app bundle. Neither produces a release APK. The migration needs a
new `e2e-test` profile.

## Results after the fixes, measured

|               | Start of 2026-08-14                         | End of 2026-08-14            |
| ------------- | ------------------------------------------- | ---------------------------- |
| CI Android    | 0 flows had ever passed; app never launched | 3 of 4 shards green          |
| Local Android | 10/18, ~1.5-2 h, serial only                | 15/18, 21.1 min, 4 emulators |

**Shard count: keep 4.** Measured on this machine, same suite, same day: four
emulators finished in 21.1 minutes, two in 27.3 minutes. Four does oversubscribe
the host — load average 20 on 14 cores, and per-flow times stretch from ~40
seconds to several minutes — but total wall clock is still the shorter of the
two, which is the number that gates a pull request.

Flows that went green without being touched, once the manifest fix removed the
per-launch signing round trip: `commerce-affiliate`, `garment-smart-tagging`,
and all three onboarding flows.

### The three that remain, each diagnosed rather than guessed

- **`widget-deep-link`** — `openLink mobile://(tabs)` fails with
  `Activity not started, unable to resolve Intent`. Expo Go does not register
  the app's own scheme. Only a built artifact fixes this.
- **`garment-capsule-create`** — reaches the count assertion with
  `Garments (1 of 10 selected)` while _both_ checkbox taps report COMPLETED, so
  one tap completes without registering. Adding a settle after each
  `scrollUntilVisible` did **not** fix it, so the cause is not scroll momentum.
  Next step is a per-tap assertion so the flow names which tap failed, rather
  than a third guess.
- **`premium-subscription`** — the section renders its title, disclosure and
  status line (`You don't have a Premium subscription.`), and renders neither
  `premium-unavailable` nor any purchase control. Reading
  `apps/mobile/app/(tabs)/settings.tsx`, that narrows to exactly two states:
  either `purchasesAvailability` is still `null` — meaning
  `ensurePurchasesConfigured()` never settled, which would make
  `await import('react-native-purchases')` an unbounded await in a UI path — or
  it is `'unavailable'` while the server answered `purchasesEnabled: false`.
  Separating them needs one bit of runtime state that the current UI does not
  expose. In CI the same flow fails one assertion earlier, at
  `premium-status-line`, with the API having answered
  `/api/v1/commerce/subscription` 200 in 6ms, which is the same shape: the
  client had not stored a result.

  Note this flow's premise changes completely under a built artifact: RevenueCat
  is present, so it would assert the real feature instead of its absence.

## Standing rules that still cost runs

Unchanged from the previous handoff, and all still true:

- Never write to `apps/mobile/**` or `maestro/**` while a run is in flight;
  `scripts/**` is safe.
- Launch long runs detached and check for `Received SIGTERM` before believing a
  batch of failures.
- Diagnose from `commands.json` and `screen-hierarchy/step-*.json`, never the
  failure screenshot.
- Verify a Maestro property exists before using it. Maestro 2.8.0 has **no**
  `--driver-host-port` flag, contrary to a claim made during the handover; it is
  absent from both `maestro --help` and `maestro test --help`.
- `[ci skip]` on iteration commits verified by a dispatch rather than the
  pipeline.
- Restore the `pull_request` and `push` triggers only after a dispatched run is
  green.
