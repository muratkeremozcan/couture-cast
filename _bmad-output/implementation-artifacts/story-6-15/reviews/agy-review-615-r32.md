# Review 615 — Round 32 (`99480151..9e96ab9d`)

Target: `/Users/murat/opensource/cc/couture-cast-wt-615` at commit `9e96ab9d` (range `99480151..9e96ab9d`).
Verdict: **Range is clear above P3** (0 P0, 0 P1, 0 P2; 2 P3 findings below).

## Test Verification & Security Scan Summary

- `node --test scripts/lib/owned-process.test.mjs scripts/ci/android-native-workflow.test.mjs scripts/ci/native-ios-runtime-diagnostics.test.mjs scripts/ci/native-ios-flow-deadline.test.mjs scripts/ci/node-test-gate.test.mjs scripts/lib/test-store-*.test.mjs scripts/lib/live-font-*.test.mjs` in `/Users/murat/opensource/cc/couture-cast-wt-615`: **420 tests / 34 suites passed, 0 failed, 0 cancelled, 0 skipped, 0 todo** (`duration_ms 17889.461125`).
- Codex Security preflight (`config_preflight.py --profile security_diff_scan`) returned `status: "ready"` (`goal_tools_available=false` `suggest` notice only); security audit of the diff `99480151..9e96ab9d` found no security regressions (`harnessDatabaseUrl` now enforces `postgres:`/`postgresql:` scheme and empty `search`/`hash`; `owned-process.mjs` validates positive safe integer PIDs and uses argv-array `spawnSync('ps', ...)` with 5 s timeout and `SIGKILL`).
- Cleanliness: mutant worktree `/tmp/wt-615-mutant-r32` removed and `git worktree prune`d; repository working tree is clean.

## Closure Verification (Mutants & Probes in Detached `/tmp/wt-615-mutant-r32`)

- **r31 P3-1 Probe (`P_r31_pg_query_param`):** `postgresql://...?host=evil.attacker.com`, `?host=/var/run/postgresql`, `#frag` (`live_font_harness_database_required: connection options in the URL are not allowed`), and `http://...` (`scheme http: is not postgres`) all rejected by `harnessDatabaseUrl`.
- **r31 P3-2 Probe (`P_r31_banner_cold_flip`):** `before`/`settled` showing `'out-of-date'` and `cold` showing `'none'` now rejected (`live_font_residual_environment_differs: baseline weather banner out-of-date, cold capture shows none`).
- **Closure mutants:**
  - `M1_killOwned_cmd_check` (`scripts/lib/owned-process.mjs`: drop `entry?.command.includes(expected)`): **KILLED** by `scripts/lib/owned-process.test.mjs`.
  - `M2_killOwnedGroup_cmd_check` (`scripts/lib/owned-process.mjs`: drop `row.command.includes(expected)`): **KILLED** by `scripts/lib/owned-process.test.mjs`.
  - `M3_processTable_zombie_filter` (`scripts/lib/owned-process.mjs:24`: drop `!match[3].startsWith('Z')`): **SURVIVED** `scripts/lib/owned-process.test.mjs` (no unit test supplies a `'Z'` zombie row to `processTable`; signalling a zombie is harmless at the kernel level).
  - `M4_node_test_gate_signal` (`scripts/ci/node-test-gate.mjs:581`: revert `status ?? \`by ${signal}\``to`status`): **KILLED** by `scripts/ci/node-test-gate.test.mjs`.
  - `M5_weather_scheme` (`scripts/lib/live-font-weather.mjs:38`: disable protocol check): **KILLED** by `scripts/lib/live-font-weather.test.mjs`.
  - `M6_weather_search_hash` (`scripts/lib/live-font-weather.mjs:43`: disable `search`/`hash` check): **KILLED** by `scripts/lib/live-font-weather.test.mjs`.
  - `M7_banner_cold_stage` (`scripts/lib/live-font-scale-proof.mjs:755`: revert `['before', 'settled', 'cold']` to `['before', 'settled']`): **KILLED** by `scripts/lib/live-font-scale-proof.test.mjs`.

## Findings

### P3-1: `native-ios-runtime-diagnostics.test.mjs` deletes its temp directory before `killOwned` and reads `grandchild.pid` after the awaited call

- Location: `scripts/ci/native-ios-runtime-diagnostics.test.mjs:16-21`, `scripts/ci/native-ios-runtime-diagnostics.test.mjs:89-108`
- Evidence:
  - `directoryFor(t)` (`L18`) registers `t.after(() => fs.rmSync(directory, { recursive: true, force: true }))` first.
  - Test `'a grandchild that keeps the pipes open cannot hold the query past its deadline'` (`L89-108`) then registers `t.after(() => killOwned(grandchild, 'setInterval'))` second, relying on `if (fs.existsSync(pidFile)) grandchild = Number(fs.readFileSync(pidFile, 'utf8'))` running _after_ `await collectSimulatorLogCounts(...)` returns.
  - Because `node:test` (`Node v24.22.1`) runs `t.after` hooks in FIFO registration order (`AFTER_HOOK_ORDER: [ 'first', 'second' ]`), `P_R32_DIAGNOSTICS_LEAK` demonstrated that when the test throws/aborts after the detached grandchild has started and written `grandchild.pid` (`{ pid: 36617, aliveAfterTest: true }`), `grandchild` stays `undefined` and `directory` is deleted first, leaving the detached `setInterval` writer running.
- Concrete failure scenario: If `collectSimulatorLogCounts` throws/rejects after spawning the detached grandchild in `native-ios-runtime-diagnostics.test.mjs:96-107`, or the test aborts mid-await, the cleanup hook receives `grandchild === undefined` and leaks the background Node process. Registering a `pidFile` reader `t.after` hook _before_ `directoryFor(t)` (matching `scripts/ci/native-ios-flow-deadline.test.mjs:114-116`) fixes it.

### P3-2: `node-test-gate.test.mjs` still performs one blind `process.kill(-checkedGroup(pid), 'SIGKILL')` in its suite `after()` hook

- Location: `scripts/ci/node-test-gate.test.mjs:213-221`, `scripts/ci/node-test-gate.test.mjs:264-289`
- Evidence:
  - `git grep -n "process\.kill" -- 'scripts/**/*.test.mjs'` confirms all other blind `SIGKILL` calls were replaced; `node-test-gate.test.mjs:215` (`killGroup`) still calls `process.kill(-checkedGroup(pid), 'SIGKILL')`.
  - Background tests call `trackStarted` (`backgroundGroups.add(pid)`) and remove `pid` inside `finally { await settleGroup(pid) }`. However, if an exception happens before `settleGroup` completes (or a `describe` timeout tears down early), `pid` remains in `backgroundGroups` until `after()` runs (`L281-289`).
- Concrete failure scenario: If a detached background suite exits after an early throw skips/interrupts `settleGroup` and the OS recycles `pid` as a new process group leader before `describe`'s `after()` runs, `killGroup` will send `SIGKILL` to `-pid` without checking `ps` command ownership.

## Explicit Judgments Requested

1. **Can `killOwned` still hit an unrelated process (recycled pid running the same command, `ps` unavailable)?**
   - _When `ps` is unavailable or fails_: **No.** `processTable()` (`scripts/lib/owned-process.mjs:20`) returns `[]`, so `killOwned` returns `false` and `killOwnedGroup` returns `0` without signalling.
   - _Recycled PID running a matching command_: **Yes, in the narrow collision case.** `killOwned` / `killOwnedGroup` check `command.includes(expected)` (`'/bin/sleep 30'`, `'sleep 300'`, `'sleep 30'`, `'sleep 0.05'`, `'setInterval'`), not start time or a unique per-test token. If a test's PID exits and the OS recycles that same PID to another process whose command line also contains `expected` (e.g., another concurrent test's `sleep 300` or `setInterval`), `killOwned` will signal it. Unlike blind `process.kill`, it will never hit an unrelated runner, shell, or system process without that substring.

2. **Does any test still `SIGKILL` a pid it does not own (`git grep process.kill` in scripts tests)?**
   - Only **`scripts/ci/node-test-gate.test.mjs:215`** (`process.kill(-checkedGroup(pid), 'SIGKILL')` — see **P3-2**). All other `process.kill` occurrences in `scripts/**/*.test.mjs` are signal-`0` liveness checks (`android-native-workflow.test.mjs:439`, `native-ios-flow-deadline.test.mjs:133,211,272`, `node-test-gate.test.mjs:203,237`, `test-store-driver.test.mjs:75`) or the mock assignment in `owned-process.test.mjs:40-45`. Direct `child.kill(...)` calls act only through Node's `ChildProcess` handle.

3. **Can an `after`-hook order still leak (hooks run in registration order)?**
   - Node `v24.22.1` `t.after()` hooks run in FIFO registration order (`AFTER_HOOK_ORDER: [ 'first', 'second' ]`).
   - In `scripts/ci/native-ios-flow-deadline.test.mjs` (`L114-116`, `L183-185`, `L234-236`), `reapOwnedCommand(t, pidFile)` is registered _before_ `t.after(() => fs.rmSync(dir, ...))`, so it does not leak (`P_R32_FLOW_HOOK_ORDER`: `reverse: false` -> `aliveAfterTest: false`; `reverse: true` -> `aliveAfterTest: true`).
   - In **`scripts/ci/native-ios-runtime-diagnostics.test.mjs:18,95,108`**, hook order + post-await assignment **can still leak** on early failure (see **P3-1**).

4. **Does any cleanup now skip a process the old code killed?**
   - _`ps` failure/timeout_: If `ps` fails or exceeds `5_000` ms, `killOwned`/`killOwnedGroup` intentionally skips signalling rather than signalling blind.
   - _`scripts/lib/test-store-output.test.mjs:638` (`stubborn`)_: Skips `killOwnedGroup` when `child.exitCode !== null || child.signalCode !== null`. If a detached `sh` leader exited before `t.after` while a child `sleep 0.05` remained alive in its group, the old `process.kill(-child.pid, 'SIGKILL')` signalled the group whereas the new early return skips it (though `sleep 0.05` finishes in 50 ms anyway). Also, in `stubborn`, running `killOwnedGroup` before `child.kill('SIGKILL')` leaves `sh` looping during `ps` (~5 ms), allowing one `sleep 0.05` iteration to fork right before `sh` receives `SIGKILL`.
   - Every normal helper cleanup (`'/bin/sleep 30'` in `android-native-workflow.test.mjs`, `'sleep 300'` in `test-store-driver.test.mjs`, `'sleep 30'` in `test-store-output.test.mjs`, `'setInterval'` in `native-ios-flow-deadline.test.mjs` and `native-ios-runtime-diagnostics.test.mjs`) matches the exact command line spawned by its stubs.

REVIEW-615-R32-DONE
