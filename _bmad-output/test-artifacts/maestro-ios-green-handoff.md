# Maestro iOS suite — handoff

Written 2026-08-13 by the outgoing session (Murat, Test Architect). Everything
below was measured on this machine unless it says otherwise. Verify anything you
rely on.

## The number

- **Baseline, measured at the start of this session: 9/18.**
- **Best measured clean run: 15/18.**
- A full run is in flight as this is written. Its log is
  `scratchpad/run-final2.log` under the session's temp dir; the durable copy of
  every result is `maestro/artifacts/*-report.xml` plus
  `maestro/artifacts/<timestamp>/commands-*.json`.

Of the three failures in the 15/18 run, **two were not flow defects**: Maestro's
iOS driver dropped its connection (`Failed to connect to /127.0.0.1:7001`) during
`garment-capture-flow` and `wardrobe-onboarding-flow`, both of which had passed
cleanly in earlier runs. The third, `garment-capsule-create-flow`, was the real
UUID defect described below, and its fix landed **after** that run finished, so
it has never been measured. Expected state is 18/18; that is a prediction, not a
measurement. Do not report it as fact.

Before a measuring run, `xcrun simctl shutdown booted`. Two driver disconnects
happened late in a long session and did not recur on a fresh simulator.

## How to run

```
MOBILE_E2E_PLATFORM=ios node ./scripts/run-maestro.mjs --artifacts          # all 18
MOBILE_E2E_PLATFORM=ios node ./scripts/run-maestro.mjs maestro/<flow>.yaml --artifacts
```

Put `maestro/sanity.yaml` first in any targeted list. It is the canary: if a
shared subflow is broken, sanity fails in ~2 minutes instead of after twenty.

## Rules that held all session

- Green must mean green. No weakened assertions, no `continue-on-error`, no
  deleted flows.
- **Never edit the working tree while a measuring run is in flight.** Metro
  rebuilds mid-run and the results become unattributable. I did this twice and
  lost two runs to it. Flow YAML and `scripts/run-maestro.mjs` are safe to edit
  mid-run (Maestro re-reads YAML per flow; the runner is already loaded). Locale
  JSON and anything under `apps/mobile/**` that Metro bundles is NOT.
- Diagnose from `commands-*.json` (`metadata.status` per step) and the
  `resource-id` / `accessibilityText` values in its hierarchy dumps. **Never from
  the failure screenshot** — it is captured after teardown and shows the Expo Go
  launcher, which looks like a crash when nothing crashed.

## Product bugs found and fixed (all pre-existing, all shipping)

1. **Capsule creation was broken on every device.**
   `capsule-builder-modal.tsx` minted the API idempotency key as
   ``globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}` ``.
   The API requires a UUID v4 and answers `400 Idempotency-Key must be a UUID
   v4`. Hermes has no `globalThis.crypto.randomUUID`, so the fallback fired on
   every real device. Fixed with `src/lib/uuid.ts`.
   **A unit test was enshrining this**: `4.3-MOB-MODAL-13` asserted the key
   matched `/^\d+-[0-9a-z]+$/`, i.e. that it was explicitly not a UUID. It named
   the right scenario ("without crypto.randomUUID" = Hermes = every device) and
   asserted the wrong contract. Now asserts a real v4.
   `src/lib/uuid.ts` deliberately does **not** import `expo-crypto`:
   `vitest.config.ts` records that native-only Expo modules wedge the optimizer,
   and importing it breaks these suites at import time.
2. **A ninth `findNodeHandle` crash site.** `wardrobe-capsules.tsx` did
   `node as unknown as number` and handed a host object to
   `AccessibilityInfo.setAccessibilityFocus`, killing the process with
   `Exception in HostFunction: Unsupported jsi::Value kind`. The earlier sweep of
   eight missed it because it never called `findNodeHandle` at all. Now routed
   through `safeFindNodeHandle`.
3. **A radiogroup with no selected option.** The hero garment swap modal declares
   `accessibilityRole="radiogroup"` and marks the worn garment selected, but its
   options came from a fixed catalogue that never contains a `default-*`
   placeholder — what every new account wears. Screen-reader users got five
   alternatives with nothing marked current. The worn garment now leads its own
   list.
4. **Two hardcoded English strings**, both in `capsule-builder-modal.tsx`: the
   garment count (`"Parçalar (0 of 10 selected)"` on a Turkish device) and the
   `Garment Order` heading, which had no `t()` call at all. Both localized across
   all ten locales.

## Harness defects fixed

- **The E2E token was not a JWT.** `test-token:guardian:<id>` has no `.`, and the
  mobile client derives its own user id from the bearer token's `sub`
  (`resolveOwnerUserId`). Six screens rendered "Your session token is malformed"
  instead of content. The runner now mints a JWT-shaped token; the API accepts it
  through a new `TEST_ENV`-gated bypass in `access-token-identity.service.ts`
  (8 unit tests, including one asserting it is refused in production).
- **One testID across three states.** `wardrobe-onboarding-screen` and
  `silhouette-editor` used the same id for loading, error and ready, so a wait on
  it returned during a spinner and an auth error looked identical to success.
  Loading and error now carry their own ids.
- **Locale persisted across entire runs.** The app writes
  `couture-cast-settings.json` into the experience's document directory, and
  `clearState: true` does not remove it. A flow that switched to Turkish and then
  failed before its restore step left the simulator Turkish for **every later
  run** — a fresh run with a brand-new user opened on a Turkish settings screen.
  `clearMobileE2EDeviceSettings()` now deletes it before each suite and logs when
  it does.
- **Three ordering dependencies** the runner's own comment forbids. The fixture
  user owned no garments and no capsules, but the flows that create them sort
  *after* the capsule flows alphabetically, and `create` deletes its own capsule
  as cleanup. The runner now seeds four garments **through the real public API**
  (declare → PUT bytes → commit → poll for analysis → confirm tags) plus one
  capsule. Prisma-inserted rows do not work: their `object_path` points at
  storage objects that do not exist and `toResponse` signs a read URL with no
  fallback, so `GET /wardrobe/garments` answers 503 for the whole list. Softening
  that signing behaviour would have hidden a genuine failure mode.
- **Assertions that could never pass**, four of them, all the same shape —
  React Native merges a Pressable's children into one accessible name, and
  Maestro matches a text selector against a whole node:
  - `'Shop this look'` → really `"Shop this look. Presented by Sample Partner.
    Opens in an in-app browser"`
  - `'Gardırobunu oluştur'` → really the title and body joined with `", "`
  - `capsule-status-region` is styled `{height: 0, opacity: 0, width: 0}` — a
    deliberately invisible live region that `assertVisible` can never see
  - one `assertNotVisible` that passed whether or not the CTA rendered
- **Taps that "succeeded" without reaching anything.** A garment tile under the
  sticky tab bar (`centerElement: true`), and garment checkboxes under the
  software keyboard (`hideKeyboard`). Maestro reports COMPLETED because it found
  the element; the touch lands elsewhere.
- **Expo Go asks per permission type.** After
  `onboarding-request-permission` it raises its own consent dialog for `camera`,
  then a second for `mediaLibrary`. `launchApp: permissions:` grants the OS-level
  permission to Expo Go itself, which is a different consent.
- **Pushed routes survive between flows** (`stopApp: false`), and `openLink` does
  not pop the stack. `back` does **not** work here — measured, two presses
  reported COMPLETED with the screen unmoved. Tapping the native `BackButton`
  resource-id does. `open-app.yaml` and `open-settings.yaml` both guard on it.
  `widget-deep-link.yaml` moved to `clearState: true` like its 17 siblings.

## Guard tests written (both proven falsifiable)

- `packages/api-client/testing/intl-import-safety.spec.ts` — deletes the optional
  Intl APIs Hermes lacks and imports every module fresh. 51 cases. Verified red
  by reintroducing a module-scope `Intl.Segmenter`.
- `packages/db/test/mock-vs-seed-drift.spec.ts` — no Maestro flow may reference a
  literal that exists only in the mobile MSW fixtures. Verified red by adding one
  back to a flow.
- `apps/mobile/src/test-utils/msw/fixture-seed-drift.test.ts` — the shape half,
  parsing fixtures against the canonical contracts.

## Still open

1. **Confirm the number.** Run the full suite on a fresh simulator and report
   what it says, not what it should say.
2. **Task 2: the Android path of `run-maestro.mjs` has never executed anywhere.**
   No install needed — the SDK, `adb`, `emulator` and a `Pixel_9_Pro_XL` AVD are
   already on this machine (`~/Library/Android/sdk`, not on PATH).
   `MOBILE_E2E_PLATFORM=android node ./scripts/run-maestro.mjs maestro/sanity.yaml --artifacts`
   Local AVD is **API 36 / arm64-v8a / google_apis_playstore**; CI is
   **API 30 / x86_64 / google_apis**. Say so when reporting. Local Android
   validates `bootAndroidTarget`, `start-android-emulator.sh`, the
   `install-expo-go.mjs` adb path, the `10.0.2.2` host mapping and the
   `host.exp.exponent` app id. It does **not** validate the Linux runner, KVM,
   the AVD snapshot cache or the `$GITHUB_PATH` fix — those stay unproven until a
   push.
3. **CI.** `.github/workflows/pr-mobile-e2e.yml` has still never run. See
   `mobile-ci-maestro-handoff.md`.

## Hard constraints

- **Nothing is committed.** HEAD is `0e22a7c` and every change is working-tree
  state. Do not commit or push; the user pushes.
- Do not delete `feat/epic5-story2-{rails,mobile,web,verify}`.
- Standing rule: root-cause and fix, never characterise-and-defer. Provenance is
  not mitigation — "pre-existing" is not a reason to leave anything broken.

## Mistakes I made, so you do not repeat them

- Edited app source during two measuring runs. Cost both runs.
- Invented a `maxRuns` property on Maestro's `repeat`. It does not exist, it went
  into the one subflow every flow uses, and all 18 died on a parse error. Verify
  a command exists before using it — `HideKeyboardCommand.class` is in
  `/opt/homebrew/Cellar/maestro/2.0.10/libexec/lib/maestro-orchestra-models.jar`,
  which is how `hideKeyboard` was checked.
- Guessed Prisma enum members twice (`footwear` is `shoes`; `occasions` is
  non-nullable). Read `packages/db/prisma/schema.prisma`. A rolled-back
  transaction probe validates seed shapes in ~10s and is worth writing first.
- Used a fixed `mobile-e2e-capsule` id, so each run re-owned one row to a new
  user while its join rows still referenced the previous user's garments. Per-user
  ids now.
