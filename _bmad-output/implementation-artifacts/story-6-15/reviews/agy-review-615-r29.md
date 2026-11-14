# Review — tea615 Round 29 (`5bac1637..5ebf952e`)

- Worktree: `/Users/murat/opensource/cc/couture-cast-wt-615-tea` (`branch: tea/live-font-maestro-driver`, `HEAD: 5ebf952e`)
- Scope: `scripts/lib/maestro-driver-sync.mjs`, `scripts/lib/maestro-driver-sync.test.mjs`, `scripts/lib/test-store-driver.test.mjs`, `scripts/run-live-font-proof.mjs`, `scripts/run-test-store-journey.mjs`

---

## Findings

### P2-1 — `finally { installed = true }` breaks first-invocation `hierarchy` retry (and subsequent `test` invocations) when attempt 1 fails before installing the driver

- **Location**: `scripts/lib/maestro-driver-sync.mjs:140-160` (`once` / `run`), affecting `scripts/run-live-font-proof.mjs:619` (`read-version`, the first Maestro call on Android) and `scripts/run-live-font-proof.mjs:132`.
- **Failure scenario**: On the first Android Maestro invocation (`installed === false`), `prepare()` uninstalls `dev.mobile.maestro.test` and `dev.mobile.maestro` (`L97-110`). If `maestro hierarchy --no-reinstall-driver` fails with a `DRIVER_START_FAILURE` (`DeviceServerDiedException`, `did not start up in time`, or `BindException`) before Maestro finishes installing both APKs and registering `AndroidJUnitRunner`, the `finally` block at `L147` unconditionally sets `installed = true`. When `run()` immediately retries `once(args, options)` (`L159`), `prepare()` takes the `else` branch (`L111-120`), sees the driver packages missing via `missingMaestroDriverParts(...)`, and throws `maestro_driver_not_ready:...` without ever retrying `maestro hierarchy`. (The same bug hits `maestro test`: if the first `test` invocation fails before installing both APKs, the second `test` invocation immediately fails with `maestro_driver_not_ready`.)
- **Observed proof (Probe 1 in detached `/tmp/wt-615-mutant-r29`)**: First `run(['--device', 'emulator-5554', 'hierarchy'])` throws `DeviceServerDiedException` with driver packages absent -> `maestroCalls: 1`, thrown error is `maestro_driver_not_ready:package dev.mobile.maestro is not installed; ...`.
- **Suggested fix**: Only set `installed = true` when both driver packages and instrumentation exist after `maestro(...)` (or check `missingMaestroDriverParts(...)` on failure and keep `installed = false` when missing so the `hierarchy` retry / next call starts fresh).

### P3-1 — `test-store-driver.test.mjs` does not isolate `HOME`, so real `~/.maestro/sessions` affects Android subprocess tests

- **Location**: `scripts/lib/test-store-driver.test.mjs:160-183` (`runDriver`), calling `scripts/run-test-store-journey.mjs:160-165` (`createSyncMaestro` without overriding `read`, defaulting to `MAESTRO_SESSIONS_FILE` at `scripts/lib/maestro-android-driver-session.mjs:46`).
- **Failure scenario**: `MAESTRO_SESSIONS_FILE` resolves `path.join(os.homedir(), '.maestro', 'sessions')` at import time. Because `runDriver` spreads `...process.env` without setting `HOME` to a temp directory, any stale or live `ANDROID_stub-device_<id>=<ms>` entry in the host `~/.maestro/sessions` makes `android: the crash path...` stall up to 21 s or fail with `maestro_session_live`. (By contrast, all 6 tests in `scripts/lib/maestro-driver-sync.test.mjs` inject `read`.)
- **Observed proof (Probe 3 in detached `/tmp/wt-615-mutant-r29`)**: Running `--test-name-pattern="the crash path" scripts/lib/test-store-driver.test.mjs` with `$HOME/.maestro/sessions` seeded with `ANDROID_stub-device_999=${Date.now() - 1000}` stalled and timed out (`ETIMEDOUT`, `6508 ms`).
- **Suggested fix**: Set `HOME: base` (or a per-test temp home) in `runDriver`'s `env` in `scripts/lib/test-store-driver.test.mjs`.

### P3-2 — `run()` checks `args.includes('hierarchy')` instead of subcommand position

- **Location**: `scripts/lib/maestro-driver-sync.mjs:156` (compare `withDriverArgs` at `L127`, which finds `at = args.findIndex((arg) => arg === 'test' || arg === 'hierarchy')`).
- **Failure scenario**: Passing `'hierarchy'` anywhere in `args` (e.g., an argument `-e hierarchy` or flow arg `'hierarchy'`) to a `maestro test` invocation causes `run()` to retry a `test` flow on `DRIVER_START_FAILURE`.
- **Observed proof (Probe 2)**: `run(['--device', 'emulator-5554', 'test', '-e', 'hierarchy', 'flow.yaml'])` retried `maestro` (`maestroCalls: 2`) on `DeviceServerDiedException`.
- **Suggested fix**: Extract a helper for subcommand index `at` and check `args[at] === 'hierarchy'`.

---

## Explicitly Requested Judgments

1. **Is the hierarchy retry safe (could it hide a real failure or read a different screen)?**
   - `maestro hierarchy` is read-only and `run()` retries at most once (`scripts/lib/maestro-driver-sync.mjs:153-160`), gated on `DRIVER_START_FAILURE`. `hierarchy()` in `scripts/run-live-font-proof.mjs:128-144` validates every parsed tree with `assertHierarchySource(tree, { platform, fingerprint, reactNativeVersion })`, and captures validate mount markers (`L231-236`), so it will not accept a different screen or wrong build. Real/non-driver hierarchy failures throw immediately.
   - Note two gaps above: **P2-1** prevents the retry from running if invocation #1 failed before driver APKs finished installing, and **P3-2** (`args.includes('hierarchy')`) would also retry `test` if a non-subcommand arg equaled `'hierarchy'`. Also note `run()` in `scripts/run-live-font-proof.mjs:91` and `scripts/run-test-store-journey.mjs:150` slices combined output to `.trim().slice(-900)`, so a Maestro traceback emitting >900 chars _after_ `DeviceServerDiedException` / `BindException` / `did not start up in time` / `Address already in use` would drop the matching text before `DRIVER_START_FAILURE` runs.

2. **Is `DRIVER_START_FAILURE` too broad?**
   - `/DeviceServerDiedException|did not start up in time|BindException|Address already in use/` (`scripts/lib/maestro-driver-sync.mjs:41-42`) matches only driver/socket startup failures; scoped to `hierarchy` reads, it is not overly broad.

3. **Can the driver check or `force-stop` break a run on a real device?**
   - **Emulator that never had the driver**: Safe — `prepare()` ignores `pm uninstall` failures (`L100-104`), `pm list packages dev.mobile.maestro` returns empty so `left.length === 0`, and `am force-stop dev.mobile.maestro` exits `0` on Android even when the package is not installed.
   - **`adb` returning extra lines**: Safe — `prepare()` (`L108`) checks `line.trim() === 'package:' + name` and `missingMaestroDriverParts` (`scripts/lib/maestro-driver-reuse.mjs:59-78`) parses `line.trim().startsWith('package:')` / `line.trim().split(/\s+/)[0]`. Probe 4 verified daemon startup banners, blank lines, and unrelated `package:dev.mobile.maestro.other` do not trigger false failures or misses.
   - **Maestro `2.8.0` installing the driver under `--no-reinstall-driver` when absent**: Verified in `/opt/homebrew/Cellar/maestro/2.8.0/libexec/lib/maestro-client.jar` (`maestro.drivers.AndroidDriver`): in both `installMaestroDriverApp$lambda$86` (`dev.mobile.maestro`) and `installMaestroServerApp` (`dev.mobile.maestro.test`), when `reinstallDriver == false` (`--no-reinstall-driver`), Maestro calls `isPackageInstalled(pkg)` and **installs the bundled APK whenever the package is not installed**.

4. **Does pinning `17001` for `test` while `hierarchy` uses a random port leave the R18 port collision for hierarchy reads?**
   - **Yes, for `hierarchy` reads.** `javap` on `/opt/homebrew/Cellar/maestro/2.8.0/libexec/lib/maestro-cli-2.8.0.jar` confirms `TestCommand` supports `driverHostPort` (`--driver-host-port`), while `PrintHierarchyCommand` has `reinstallDriver` (`--no-reinstall-driver`) and no `driverHostPort` option. Thus `maestro hierarchy` still picks a random host ephemeral port (`ServerSocket(0)`), leaving the R18 collision possible and relying on the `DRIVER_START_FAILURE` retry after `am force-stop` + `waitOutStaleSessions`. Also note unlike `scripts/run-maestro.mjs:1984-2004`, `createSyncMaestro` does not call `waitForDevicePortFree` for `17001` between `am force-stop` and `maestro test`.

5. **Does the stale-session wait read the real `~/.maestro/sessions` in tests?**
   - In `scripts/lib/maestro-driver-sync.test.mjs`: **No** — all 6 tests inject `read`.
   - In `scripts/lib/test-store-driver.test.mjs`: **Yes** — `runDriver` does not isolate `HOME` (see **P3-1**).

---

## Mutation & Verification Summary

All mutants and probes ran in detached `/tmp/wt-615-mutant-r29` (with `node_modules` symlinked), which was removed and pruned cleanly afterward (`git worktree list` clean).

- **Mutants killed (`scripts/lib/maestro-driver-sync.test.mjs`)**:
  - `M1_skip_initial_uninstall` (`exit=1`, `6 tests: 3 pass, 3 fail`)
  - `M2_valid_skip_reuse_check` (`exit=1`, `6 tests: 5 pass, 1 fail`)
  - `M3_skip_force_stop` (`exit=1`, `6 tests: 5 pass, 1 fail`)
  - `M4_skip_wait_stale` (`exit=1`, `6 tests: 5 pass, 1 fail`)
  - `M5_drop_no_reinstall_arg` (`exit=1`, `6 tests: 5 pass, 1 fail`)
  - `M6_drop_driver_host_port` (`exit=1`, `6 tests: 5 pass, 1 fail`)
  - `M7_no_hierarchy_retry` (`exit=1`, `6 tests: 5 pass, 1 fail`)
  - `M8_retry_test_subcmd_too` (`exit=1`, `6 tests: 5 pass, 1 fail`)
  - `M9_retry_non_driver_error` (`exit=1`, `6 tests: 5 pass, 1 fail`)
  - `M10_valid_live_session_not_thrown` (`exit=1`, failed/timed out live-session throw test)
  - `M11_missing_keeps_installed_true` (`exit=1`, `6 tests: 5 pass, 1 fail`)
  - `M12_still_installed_on_initial_fail_check` (`exit=1`, `6 tests: 4 pass, 2 fail`)
- **Wiring mutant killed (`scripts/lib/test-store-driver.test.mjs`)**:
  - `M_wiring_test_store_driver` (bypassing `createSyncMaestro` in `scripts/run-test-store-journey.mjs`): `exit=1`, `17 tests: 16 pass, 1 fail`.
- **Requested final suite** in `/Users/murat/opensource/cc/couture-cast-wt-615-tea`:
  - `node --test scripts/lib/maestro-driver-sync.test.mjs scripts/lib/test-store-*.test.mjs scripts/lib/live-font-*.test.mjs`: **217 passed, 0 failed, 0 skipped** across **15 suites**.
- **Security review (`~/.codex/skills/codex-security-review/SKILL.md`)**:
  - Automated `config_preflight.py --profile security_diff_scan` exited `2` (`status: "incomplete"`, `delegated_workers` and `goal_tools` `unknown` in this harness). Direct security inspection of `5bac1637..5ebf952e` found no shell-interpolation, injection, or secret-exposure bugs (`spawnSync` uses array arguments, fixed package constants, and integer port `17001`; logs emit only `sessionId` and error summaries; subprocess session isolation gap is tracked in **P3-1**).

REVIEW-615-R29-DONE
