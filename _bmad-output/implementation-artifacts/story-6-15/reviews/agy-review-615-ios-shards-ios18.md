# TEA Review: `ci/ios-shards-ios18` (`8f9d5dc2..92676def`)

Worktree: `/Users/murat/opensource/cc/couture-cast-wt-iosnative`
Range: `8f9d5dc2..92676def` (7 commits)
Verification run: `node --test scripts/ci/ios-native-workflow.test.mjs scripts/ci/native-supabase.test.mjs scripts/ci/native-ios-flow-deadline.test.mjs scripts/ci/native-ios-runtime-fits.test.mjs scripts/ci/native-ios-command-evidence.test.mjs` (437/437 passing) and `node scripts/ci/ios-native-workflow.mjs` (exit 0).

## Findings

### P2-1: `client_fits` is omitted from `MANDATORY`, allowing shell neutralization to pass the workflow validator

- **Location:** `scripts/ci/ios-native-workflow.mjs:255-261`, `scripts/ci/ios-native-workflow.mjs:846-864`, `.github/workflows/ios-native-jobs.yml:567-576`, `.github/workflows/ios-native-jobs.yml:828-837`
- **Concrete failure scenario:**
  Commit `d0245e14` added `client_pack` and `client_unpack` to `MANDATORY`, which enforces `step.shell === undefined`, `!neutralizedRun(step.run)`, and `requiredLineProblems(step.run, required)` through `mandatoryProblems` (`scripts/ci/ios-native-workflow.mjs:661-678`).
  Commit `92676def` added `client_fits` to `ios-shard` and `ios-expo-go`, checking it only in `consumerProblems` (`scripts/ci/ios-native-workflow.mjs:846-864`) via `String(step.run ?? '').includes(...)` on the three commands.
  If a later edit comments out `node scripts/ci/native-ios-runtime-fits.mjs "$min" "$sdk"`, appends `|| true`, adds `set +e`, wraps the commands in `if false; then ... fi`, or places them inside a here-document, `String(step.run ?? '').includes(...)` still matches and `iosNativeProblems` returns zero problems.
  The C-16 deployment-target check then becomes a no-op while both `node scripts/ci/ios-native-workflow.mjs` and `scripts/ci/ios-native-workflow.test.mjs` pass.
- **Required fix:**
  Add `client_fits` for both `ios-shard` and `ios-expo-go` to `MANDATORY` in `scripts/ci/ios-native-workflow.mjs` with condition `undefined` and required lines `['set -euo pipefail', 'min=$(plutil -extract MinimumOSVersion raw "$APP/Info.plist")', 'sdk=$(xcrun --sdk iphonesimulator --show-sdk-version)', 'node scripts/ci/native-ios-runtime-fits.mjs "$min" "$sdk"']`.
  That also enrolls both steps in the `describe('mandatory step checks')` negative-fixture matrix in `scripts/ci/ios-native-workflow.test.mjs:1044-1178`.

### P2-2: Missing deadline-record path prints unredacted Maestro stderr to the public CI log, and worker cleanup misses `SIGINT`/`SIGHUP`

- **Location:** `scripts/ci/native-ios-flow-deadline.mjs:30-36`, `scripts/ci/native-ios-flow-deadline.mjs:70-75`, `scripts/ci/native-ios-flow-deadline.mjs:110-121`
- **Concrete failure scenario:**
  1. `runDeadlineWorker` spawns `maestro` with `stdio: ['ignore', 'inherit', 'inherit']` (`scripts/ci/native-ios-flow-deadline.mjs:74`), so `result.stderr` in `spawnIosFlow` contains the combined stderr of `maestro` and the worker.
     In `scripts/run-story68-native.mjs:540-549` and `570-593`, `maestro` runs flows with sensitive values (`MAESTRO_EMAIL` and the fresh OTP code in `MAESTRO_OTP`) and redacts `secret` before writing the output only to a mode-`0o600` private log file.
     When `timingFile` is missing (`!child`), `console.error(String(result.stderr ?? '').slice(-2000))` at `scripts/ci/native-ios-flow-deadline.mjs:32` writes up to 2000 characters of raw `result.stderr` directly to the public GitHub Actions log before `run-story68-native.mjs` can redact `secret`.
  2. `runDeadlineWorker` registers `process.once('SIGTERM', () => abort(143))` (`line 115`), leaving `SIGINT` and `SIGHUP` unhandled.
     When GitHub Actions cancels or times out a step, the runner sends `SIGINT` before `SIGTERM`; the worker exits immediately on `SIGINT`, leaves the detached `-child.pid` Maestro process group running, and skips writing `timingFile`.
     In addition, `uncaughtException` (`lines 116-121`) calls `console.error(...)` before `abort(1)`, so a broken stderr pipe (`EPIPE` after the parent closes pipes on `maxBuffer`) can prevent `killOwned()` and `writeOnce()` from running.
- **Required fix:**
  1. Replace `console.error(String(result.stderr ?? '').slice(-2000))` in `scripts/ci/native-ios-flow-deadline.mjs:32` with closed token extraction from `result.stderr` (matching only worker diagnostic lines such as `/^(?:owned_flow_[a-z_]+(?::[A-Za-z0-9_.-]+)?|Timed out at the native flow deadline)$/gm`).
  2. In `runDeadlineWorker` (`scripts/ci/native-ios-flow-deadline.mjs:110-121`), attach `SIGINT` (`abort(130)`) and `SIGHUP` (`abort(129)`) handlers alongside `SIGTERM`, and invoke `killOwned()` and `writeOnce()` before writing to `console.error` in `uncaughtException` (logging only `error?.code ?? 'unknown'`).

### P3-1: Quiet service with a transient PID in `launchctl list` that exits before `ps` is recorded as `'idle'` and skipped by `bootout`

- **Location:** `scripts/ci/native-ios-quiesce.mjs:360-369`, `scripts/ci/native-ios-command-evidence.test.mjs:279-315`
- **Concrete failure scenario:**
  `probeSimulatorTuning` runs `xcrun simctl spawn <device> launchctl list` (`scripts/ci/native-ios-quiesce.mjs:401`) and then runs `ps -A` (`line 404`).
  If a service in `QUIET_SERVICES` (such as `mediaanalysisd`) has a numeric PID in `launchctl list` (`labels.get(label)` is a number) and exits in the window before `ps -A` runs (`ownedService` returns `null`), line 364 sets `census[name].state` to `'idle'` (`service ? 'running' : labels.has(label) ? 'idle' : 'absent'`), while line 367 computes `const idle = !service && labels.get(label) === null` (`false`).
  Line 368 (`if (!service && !idle) continue`) then skips `launchctl bootout`, leaving `com.apple.mediaanalysisd` loaded in `launchd_sim` to start on demand during the Maestro flows while recording `{ state: 'idle', bootoutExit: null }`.
- **Required fix:**
  Treat a listed label whose PID is absent from `ps` as idle (skipping only when the listed PID is present in `ps` under a non-simulator manager), and keep `census[name].state` consistent with the `idle` predicate.

## Area-by-Area Assessment

1. **Workflow changes (`.github/workflows/ios-native-jobs.yml`, `.github/workflows/ios-native.yml`, `.github/workflows/ios-native-dispatch.yml`, `.github/workflows/ios-native-canary.yml`):**
   - `ios-build` runs on `macos-26` with Xcode 26.4+ (`XCODE: '26.4+'`) on every trigger, skips `native_cache` lookup on `workflow_dispatch`, skips all `actions/cache/save@v5.1.0` steps and the post-save cache lookup on `workflow_dispatch`, disables the `actions/setup-go@v5` cache on `workflow_dispatch`, installs without `./.github/actions/install` on `workflow_dispatch`, runs `native-ios-app-secret-scan.mjs` before saving or packing, and packs/uploads `ios-dev-client` (`retention-days: 1`, `if-no-files-found: error`) only on `workflow_dispatch`.
   - `ios-shard` and `ios-expo-go` require `needs.ios-build.result == 'success'`, run on `macos-15` with `XCODE: '16.4'` by default and `macos-26` with `XCODE: '26.4+'` only when `inputs.ios26-canary` is `true`, verify the `XCODE:sdk` pair (`16.4:18.5 | 26.4+:26.*`), restore the cached client on non-dispatch runs or download/unpack `ios-dev-client` on dispatch runs, and run `native-ios-runtime-fits.mjs` before the startup probe and flows.
   - `ios-native-canary.yml` runs only on its own nightly cron (`23 5 * * *`, separate from `23 3 * * *` in `ios-native.yml`), with `contents: read`, concurrency group `ios-native-canary` (`cancel-in-progress: false`), and `run-name: iOS 26.5 canary ${{ github.sha }}` (which does not match `RUN_NAME_PREFIX = 'iOS native '` in `scripts/ci/ios-native-evidence.mjs:41`).
   - `scripts/ci/native-supabase.mjs` keys all four native Supabase caches by Darwin kernel major (`darwin24` on `macos-15`, `darwin25` on `macos-26`).
2. **Validator rules and negative fixtures (`scripts/ci/ios-native-workflow.mjs`, `scripts/ci/ios-native-workflow.test.mjs`):**
   - No prior validator guarantee from `8f9d5dc2` was dropped: the former dispatch per-consumer build checks (`DISPATCH_BUILD`) and `CONSUMER_IF` skip allowance were replaced by the single-build `ios-build` artifact handoff checks (`handOffProblems`, `consumerProblems`, `artifactProblems`) and `CLIENT_BUILD` prohibition in consumers.
   - One gap exists in the new `client_fits` rule: see **P2-1**.
3. **Deadline worker and quiesce (`scripts/ci/native-ios-flow-deadline.mjs`, `scripts/ci/native-ios-quiesce.mjs`):**
   - See **P2-2** and **P3-1**.

## Security (`codex-security-review`)

- **Cache-poisoning isolation (`ios-native-dispatch.yml` / `ios-native-jobs.yml`):**
  `ios-native-dispatch.yml` enforces `cache-mode: read` at the workflow and job levels, and `ios-native-jobs.yml` omits `cache-mode` so the caller's read-only cache token governs.
  In `ios-build`, every `actions/cache/save@v5.1.0` step and `./.github/actions/install` is gated by `github.event_name != 'workflow_dispatch'`, `actions/setup-go@v5` sets `cache: ${{ github.event_name != 'workflow_dispatch' }}`, and `ios-cache-proof` verifies at the end of a dispatch run that a cache save is rejected.
- **Artifact scope (`ios-dev-client`):**
  `actions/download-artifact@v4` in `ios-shard` and `ios-expo-go` specifies only `name: ios-dev-client` and `path: ${{ runner.temp }}/ios-client` (pinned by `same(step.with, { name: CLIENT_ARTIFACT, path: CLIENT_DIRECTORY })` in `scripts/ci/ios-native-workflow.mjs:118`), with no `run-id`, `repository`, or `github-token`, confining artifact download to the current workflow run.
- **Tar pack/unpack path safety:**
  `client_pack` archives `$(basename "$APP")` (`CoutureCastStory68.app`) from `$(dirname "$APP")` into `$RUNNER_TEMP/ios-client/client.tar`, and `client_unpack` extracts `$RUNNER_TEMP/ios-client/client.tar` into `$(dirname "$APP")` and verifies `test -d "$APP"`.
  Both steps run in the same workflow run for the same verified 40-hex commit `sha`.
- **Pre-publish secret scan (`native-ios-app-secret-scan.mjs`):**
  Both `native_save` (cache path) and `client_pack` (dispatch artifact path) require `steps.app_scan.outcome == 'success'`, ensuring the built `.app` bundle passes `native-ios-app-secret-scan.mjs` before leaving `ios-build`.
- **Public log exposure surface:**
  `scripts/ci/native-ios-flow-deadline.mjs:32` (`console.error(String(result.stderr ?? '').slice(-2000))`) can print unredacted Maestro stderr to the public job log when `timingFile` is missing; see **P2-2** above for the concrete scenario and fix.

REVIEW-615-IOS-SHARDS-IOS18-DONE
