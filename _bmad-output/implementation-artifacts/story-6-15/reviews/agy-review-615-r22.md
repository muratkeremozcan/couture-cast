# Review — `tea615` Round 22 (`d9903133..5cd05fcb`)

Target: `/Users/murat/opensource/cc/couture-cast-wt-615`, range `d9903133..5cd05fcb` (`c0e91781` + `5cd05fcb`).
Verification suite: `node --test scripts/lib/test-store-*.test.mjs` — `94` tests, `94` pass, `0` fail (`13593.18ms` in `/Users/murat/opensource/cc/couture-cast-wt-615` after `/tmp/wt-615-mutant-r22` cleanup).
Security lens (`~/.codex/skills/codex-security-review/SKILL.md`): `config_preflight.py --profile security_diff_scan` returned exit `2` (`status: "incomplete"`: `delegated_workers: unknown`, `goal_tools: unknown`), so the security diff scan ran in single-agent mode across `d9903133..5cd05fcb`; no P0–P2 security regressions found.

## Verdict

- **No P0, P1, or P2 blockers.** Commit `c0e91781` closes Round 21 P3s via `boundedSpawn` (`scripts/lib/test-store-spawn.mjs`), TypeScript AST enforcement (`scripts/lib/test-store-spawn.test.mjs`), and `stillRunning` fallback on `ps` failure after a non-empty snapshot (`scripts/lib/test-store-output.mjs:393-395`), while `5cd05fcb` documents the remaining `ps`-failure and post-snapshot grandchild gaps in `_bmad-output/test-artifacts/test-design/cc615-expo-sdk58-live-font-scale-test-design.md:552-555`.
- **Four P3 findings** below covering `--spawn-timeout-ms` `0`/`NaN`, `tolerateStatus: true` on `adb force-stop`, `unboundedCalls` bypasses, and `M4` survival on `rev` format checking.

---

## Closure Verification (Mutants in Detached `/tmp/wt-615-mutant-r22`)

| Mutant                                                                     | Result       | Failing Test                                                                                     |
| -------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `M1_boundedSpawn_no_timeout` (`test-store-spawn.mjs:24`)                   | **CAUGHT**   | Hung driver `uninstall`/`stop` tests (`300916ms`+), `test-store-spawn.test.mjs` unit & AST tests |
| `M2_boundedSpawn_ignore_error` (`test-store-spawn.mjs:28-29`)              | **CAUGHT**   | Crash test, all 4 hung `uninstall`/`stop` driver tests, `test-store-spawn.test.mjs`              |
| `M3_boundedSpawn_ignore_nonzero_exit` (`test-store-spawn.mjs:30`)          | **CAUGHT**   | `a hung call past its bound throws its code; a tolerated nonzero exit does not`                  |
| `M4_driver_rev_no_sha_check` (`run-test-store-journey.mjs:131`)            | **SURVIVED** | All `94` tests passed (`P3-4` below)                                                             |
| `M5_driver_uninstall_raw_spawnSync` (`run-test-store-journey.mjs:309-310`) | **CAUGHT**   | `ios: a hung uninstall fails...`, `android: a hung uninstall fails...`                           |
| `M6_driver_stop_raw_spawnSync` (`run-test-store-journey.mjs:242,263`)      | **CAUGHT**   | `ios: a hung terminate fails...`, `android: a hung force-stop fails...`                          |
| `M7_output_ps_fail_after_snapshot` (`test-store-output.mjs:393-395`)       | **CAUGHT**   | `a Metro group is still signalled when ps fails at teardown`                                     |
| `M8_static_check_ignore_post_spread` (`test-store-spawn.test.mjs:62-65`)   | **CAUGHT**   | `the bound check rejects what it should`                                                         |

---

## Findings

### P3-1: `--spawn-timeout-ms` and `boundedSpawn` allow `0`, `NaN`, or negative bounds

- **Location:** `scripts/run-test-store-journey.mjs:124`, `scripts/lib/test-store-spawn.mjs:19-26`
- **Live probe:** Calling Node `spawnSync('sh', ['-c', 'sleep 0.2; echo done'], { timeout: val, killSignal: 'SIGKILL' })` gave:
  - `val = 0` -> completed with `status=0 err=none stdout="done"` (**disables the timeout completely**)
  - `val = NaN` -> threw `ERR_OUT_OF_RANGE: The value of "timeout" is out of range. It must be an unsigned integer. Received NaN`
  - `val = -5` -> threw `ERR_OUT_OF_RANGE: ... Received -5`
- **Concrete failure scenario:** Passing `--spawn-timeout-ms 0` sets `spawnTimeout = 0`, bypassing the `timeout = SPAWN_TIMEOUT_MS` default in `boundedSpawn` (`test-store-spawn.mjs:19`) and silently running every driver `boundedSpawn` call (`git rev-parse`, `uninstall`, `force-stop`, `terminate`) unbounded. Passing `--spawn-timeout-ms abc` produces `NaN` and crashes in `rev()` with an uncoded `RangeError` (`ERR_OUT_OF_RANGE`) rather than failing cleanly during argument validation.
- **Recommendation:** Enforce `Number.isSafeInteger(timeout) && timeout > 0` in both `boundedSpawn` and `--spawn-timeout-ms` parsing (throwing a `JourneyError`).

### P3-2: `tolerateStatus: true` on `adb shell am force-stop` hides real `adb` failures

- **Location:** `scripts/run-test-store-journey.mjs:242-246`
- **Issue:** On iOS, `xcrun simctl terminate` legitimately exits nonzero when the app is not running (`line 262`). On Android, `adb shell am force-stop <appId>` exits `0` whether the app is running or not; a nonzero exit indicates an ADB transport/shell error (such as `device offline` or `device not found`), not an already-stopped app.
- **Concrete failure scenario:** If `adb` drops offline transiently at `force-stop` (`line 242`) and recovers before `adb('shell', 'am', 'start', ...)` (`lines 248-257`), `tolerateStatus: true` discards the `device offline` exit from `force-stop`, and `am start` launches over a still-running app instance instead of stopping the run as `test_store_stop_failed`. (On `uninstall()` at `lines 304-310`, `adb uninstall` does exit nonzero when absent, so `tolerateStatus: true` there is necessary unless stderr is parsed, though a transient `device offline` on `uninstall` is likewise deferred until `install()`.)
- **Recommendation:** Drop `tolerateStatus: true` from Android `force-stop` (`line 244`).

### P3-3: Static `unboundedCalls` check is sound against dot-access `cp.*` and plain variable options, but has AST bypasses

- **Location:** `scripts/lib/test-store-spawn.test.mjs:42-130`
- **Judgment & live probes:** Namespace dot-access (`cp.spawnSync` / `cp.execSync`) IS checked (`misses: 1` for `cp.execSync`), and passing an unknown options variable (`const opts = { cwd }; spawnSync('a', [], opts)`) IS flagged as a miss rather than bypassed. However, seven probes each produced **`misses: 0`** (bypassed):
  1. Aliased import (`import { spawnSync as r } from 'node:child_process'; r('a', [])`) -> `0` misses.
  2. Reassigned variable or value-passed reference (`const r = spawnSync; r(...)` / `((f)=>f(...))(spawnSync)`) -> `0` misses.
  3. Bracket property access (`cp['spawnSync']('a', [])`) -> `0` misses.
  4. Non-`const`/reassigned or cross-scope variable matching `boundingNames` (`let B = { timeout: 1, killSignal: 'SIGKILL' }; B = {}; spawnSync('a', [], B)`) -> `0` misses because `collect` adds every file-wide declaration initializer to `boundingNames` without tracking mutation or lexical scope.
  5. Unchecked `timeout` values (`{ timeout: 0, killSignal: 'SIGKILL' }` and `{ timeout: undefined, killSignal: 'SIGKILL' }`) -> `0` misses (`line 69` only checks property name `'timeout'`).

### P3-4: `rev` 40-hex validation has no direct test (`M4` survived)

- **Location:** `scripts/run-test-store-journey.mjs:131`, `scripts/lib/test-store-driver.test.mjs:312-325`
- **Issue & scenario:** Mutant `M4_driver_rev_no_sha_check` deleted `if (!/^[0-9a-f]{40}$/.test(sha)) throw new JourneyError('test_store_rev_failed', value)`, and all `94` tests still passed because `ios: a hung git fails the run as test_store_rev_failed` tests `ETIMEDOUT` (`result.error`), never `git` returning exit `0` with empty/non-SHA stdout (or a non-40-hex `--build-sha`).

REVIEW-615-R22-DONE
