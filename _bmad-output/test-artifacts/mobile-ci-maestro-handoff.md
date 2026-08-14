# Mobile Maestro CI: state and handoff

Written 2026-08-13 by the CI session (Murat, Test Architect), working alongside
`maestro-tea`, which owns the flows themselves. This file covers only
`.github/workflows/pr-mobile-e2e.yml`.

**The workflow has still never run.** Everything below is either verified
statically, verified in a Linux container, or explicitly flagged as unproven.

## Suite state at handoff: 9 of 18 passing

From the JUnit reports, iOS only. This is the number CI would be gating on, so it
matters to the CI decision below.

Passing: `sanity`, `analytics`, `chip-navigation-bottom-nav`,
`deep-link-handling`, `garment-capture-flow`, `garment-smart-tagging-flow`,
`hero-experience`, `localization`, `premium-subscription`.

Failing, with the assertion that fails:

| Flow | Fails on |
|---|---|
| `accessibility-hardening` | `garment-swap-modal` |
| `commerce-affiliate` | `Shop this look` |
| `garment-capsule-create-flow` | `create-capsule-button` |
| `garment-capsule-repair-flow` | `wardrobe-capsules-link` |
| `garment-capsule-localization-flow` | `Kombin kapsülleri` |
| `wardrobe-onboarding-flow` | `onboarding-permission-step` |
| `wardrobe-onboarding-my-form-flow` | `silhouette-tab-my-form` |
| `wardrobe-onboarding-localization-flow` | `Gardırobunu oluştur` |
| `widget-deep-link` | `tab-home`, at launch, as the 18th flow in the run |

Two things a fresh session should not have to rediscover:

- The chip-activation problem that dominated the previous handoff **no longer
  reproduces**. `chip-navigation-bottom-nav` passes and `accessibility-hardening`
  now fails later, at `garment-swap-modal`. Do not re-derive the chip
  investigation.
- `widget-deep-link` fails at `tab-home`, meaning it never launched, and it is
  the last flow in an 18-flow serial run against one shared fixture user. Suspect
  accumulated state or teardown before suspecting the flow. It is not in the same
  category as the eight that fail on a real screen assertion.

## Why Maestro-in-CI was abandoned, and why that no longer holds

The old job took 30-40 minutes cold, so it was reduced to `workflow_dispatch`
only and the paid Maestro Cloud was assumed to be the only route. Three facts
changed that:

1. The job enabled KVM and then threw it away by passing `-accel off` in
   `emulator-options`, forcing software emulation. That was self-inflicted, not
   a platform limit.
2. GitHub extended hardware-accelerated Android virtualization to standard Linux
   runners in April 2024, and doubled public-repo runners to 4 vCPU / 16 GB in
   January 2024. `couture-cast` is public, so it clears both bars.
3. There was no AVD snapshot caching. `-no-snapshot` meant a full cold boot every
   run.

A benchmark on the emulator action's own tracker: cold boot 2m23s to 15s with
KVM; a suite 12m to 6m.

## The structural problem the rewrite fixes

CI ran a completely different harness from local. It built a debug APK and
invoked `npx maestro test` with `MOBILE_E2E_SKIP_SERVER=1`: no API, no Metro, no
seeded fixture user, and no `APP_URL`, which every flow dereferences in
`openLink: ${APP_URL}`. Only three flows were listed and two were
`continue-on-error`. **The job could report success while the app never
mounted**, which is how an app-crash-on-import (`Intl.Segmenter` at module scope,
absent in Hermes) survived months of CI.

The rewrite runs `scripts/run-maestro.mjs`, the same harness a developer runs
locally, against Expo Go, with real Supabase and Redis services and `db:reset`.
`expo prebuild` and `gradlew assembleDebug` are gone.

## Defects found and fixed in the rewrite itself

### 1. `maestro` was never going to be on PATH (proven in a container)

`npm run maestro:install` pipes `get.maestro.mobile.dev` into bash. That
installer puts the binary in `~/.maestro/bin` and advertises it **only** by
appending to `~/.bashrc`, `~/.zshrc` and `~/.bash_profile`. GitHub Actions runs
every step as `bash --noprofile --norc`, which sources none of them.

This failed *silently*, not loudly: `run-maestro.mjs` catches the `ENOENT` and
falls back to `npx --yes maestro@latest`, so the job would have kept working
while testing against a floating Maestro version no developer runs locally.

Reproduced on `eclipse-temurin:17-jdk`:

| shell | result |
|---|---|
| `bash --noprofile --norc -c 'command -v maestro'` | not found |
| same, with `PATH=$PATH:$HOME/.maestro/bin` | `/root/.maestro/bin/maestro` |

Fixed by appending to `$GITHUB_PATH`, plus a `Verify Maestro CLI is on PATH`
step that fails the job rather than letting it degrade silently again.

Also learned: the installer hard-requires **a JDK and `unzip`**. Both ship on the
ubuntu runner image. If either goes missing the installer exits non-zero and
fails the step loudly, so no extra guard was added.

### 2. The AVD snapshot cache would have cancelled itself out

`actions/cache@v4` declares `post-if: "success()"` (verified against the action's
own `action.yml`). Its save step is skipped whenever any earlier step fails. A
failing Maestro flow is exactly the case this job exists to produce, so on every
red run the snapshot would never have been written, and every red run would have
paid a full cold boot. The optimisation would have been absent precisely when it
mattered most.

Replaced with an `actions/cache/restore` + `actions/cache/save` split, saving
immediately after snapshot generation. `save-always` is the
documented-but-deprecated patch; the split is what the action's docs point to.

Note the save step deliberately has **no `always()`**. A bare `if:` is implicitly
`success() && (...)`, which is what is wanted. Forcing it would publish a
half-written AVD under the primary key whenever generation itself failed, and a
poisoned cache is worse than no cache, because every later run restores it
instead of rebuilding.

### 3. A macOS-only workaround leaking into Linux

`run-maestro.mjs` shims `xcrun` onto PATH for Android runs, to stop Maestro
hanging on a broken CoreSimulator install. That is a developer-machine
workaround. On Linux there is no `/usr/bin/xcrun` for the shim to delegate to,
and putting an `xcrun` on PATH where the platform has none inverts the signal
Maestro uses to decide whether iOS tooling exists. The workflow now sets
`MAESTRO_DISABLE_ANDROID_XCRUN_SHIM=1`, the escape hatch the script provides.

### 4. Smaller ones

- Added `permissions: contents: read`.
- `timeout-minutes` 45 to 60. Eighteen flows run serially and setup adds
  `npm ci`, Supabase, `db:reset`, emulator boot and a cold Metro bundle.
- `disable-spellchecker: true` on the run step. Several flows type into text
  fields and the suggestion strip is a known flake source.
- `emulator-boot-timeout` 1200 to 900 (cold create) and 600 (snapshot restore).
  A long ceiling only buys a longer hang before the job gives up, and it competes
  with `timeout-minutes` for the same budget.
- Flow glob now excludes `config.yaml`, Maestro's reserved suite-config filename.

### Checked and found NOT to be problems

- `-camera-back none` does not break `garment-capture-flow`. The flow only
  asserts `garment-source-camera` is visible, then taps
  `garment-e2e-fixture-source`. No camera is opened.
- Expo Go version is consistent: `run-maestro.mjs` expects `54.0.8` and
  `install-expo-go.mjs` pins the `54.0.8` APK.
- Redis reaches the API. `apps/api/src/config/redis.ts` defaults to
  `redis://localhost:6379` and the job publishes that port.
- Android networking is right. `10.0.2.2` is the emulator's alias for the host
  loopback, so both `exp://10.0.2.2:8081` and `http://10.0.2.2:4000` reach Metro
  and the API on the runner.
- `actionlint` 1.7.7 is clean on this workflow and on every other workflow in the
  repo.

## What is still completely unproven

**The job has never executed.** In particular:

- The **entire Android path of `run-maestro.mjs` has never run anywhere**. Local
  work is iOS-only because the dev machine has no `adb`. CI will be its first
  execution: `ensureExpoGoOnAndroid`, `expo start --android --go`, and Expo Go
  launching against `10.0.2.2` are all first-run code.
- Whether KVM actually engages on the runner, and what the real timings are.
- Whether Supabase's container stack, a 2 GB emulator, Metro, the API and Redis
  coexist on one 4 vCPU / 16 GB runner.
- Total wall-clock. 60 minutes is a provisional ceiling, not a measurement.

## Recommended first validation

Not the full suite. Once the story is committed and pushed, run
`workflow_dispatch` with `suite: smoke` (3 flows). That exercises the whole
pipeline (KVM, snapshot, Expo Go, Metro, API, Supabase, Maestro) in a fraction of
the time and yields the setup-cost number needed to decide about sharding. Only
then run `full`.

If the full run lands near the 60-minute ceiling, the fix is to shard the flow
list across parallel jobs sharing one AVD cache, not to keep raising the limit.

## How to re-verify this without burning a CI run

Both techniques below found real defects and cost minutes, not a push.

`actionlint` is not installed on this machine and does not need to be. Fetch the
release binary into a scratch directory and run it against every workflow:

```
curl -sL https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_darwin_arm64.tar.gz \
  | tar xz -C /tmp && /tmp/actionlint .github/workflows/*.yml
```

For anything that depends on Linux or on the shell Actions actually uses, run it
in a container rather than reasoning about it. This is how the `maestro`-on-PATH
defect went from a plausible reading of the installer to a demonstrated fact:

```
docker run --rm eclipse-temurin:17-jdk bash -c '
  apt-get update -qq >/dev/null && apt-get install -y -qq curl unzip >/dev/null
  curl -Ls https://get.maestro.mobile.dev | bash >/dev/null 2>&1
  bash --noprofile --norc -c "command -v maestro || echo NOT-FOUND"'
```

`bash --noprofile --norc` is the important part: it is what GitHub runs every
step with, and it is why anything an installer writes to `.bashrc` is invisible.

When a claim about an action's behaviour matters, read the action's own
`action.yml` rather than its README. That is where `post-if: "success()"` on
`actions/cache@v4` was found, and the README does not mention it.

## Sequencing and constraints

- Story 5.2 is **staged, not committed** (HEAD `0e22a7c`). Do not commit or push
  without an explicit instruction.
- **This CI session staged nothing and committed nothing.** Its two changed files
  are `.github/workflows/pr-mobile-e2e.yml` (unstaged) and this document (new,
  untracked). Nothing in it has been verified at runtime.
- There is **no way to validate this workflow without pushing**. The flows, the
  scripts and the workflow are all uncommitted, so a branch push is the only
  route to a run.
- The `pull_request` trigger is live and path-filtered on `apps/mobile/**` and
  `maestro/**`. **The moment this branch is pushed, the job runs, and at 9 of 18
  passing it will be red.** That redness is true, not noise. Do not weaken it
  into a hollow green by re-adding `continue-on-error` or trimming the flow list;
  that is the exact failure mode the rewrite exists to remove. The route to green
  is fixing the nine flows, not the workflow.
- Do not delete `feat/epic5-story2-{rails,mobile,web,verify}`.
- Learning path Step 35's "Evidence boundaries" paragraph was corrected to 9/18
  and now names every failing flow and its assertion. Keep it honest if the
  number moves.

## One thing to notice in the diff

The index still carries a one-line change setting `MAESTRO_APP_ID:
com.couturecast.app`, left over from the APK-based job. The rewrite deletes that
variable entirely, because Expo Go's app id is `host.exp.exponent` and
`run-maestro.mjs` resolves it. The rewrite itself is currently **unstaged** while
the rest of story 5.2 is staged, so `git diff --cached` alone will not show it.
