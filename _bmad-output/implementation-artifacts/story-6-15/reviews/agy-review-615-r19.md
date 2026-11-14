# Review — `tea615` Round 19 (`4183df6c..ee773079`)

Target: `/Users/murat/opensource/cc/couture-cast-wt-615` (commit `ee773079`, parent `4183df6c`).
Verification suite: `node --test scripts/lib/test-store-*.test.mjs` — `75` tests, `75` pass, `0` fail (`7839.62ms` on latest post-cleanup run in the main checkout; `8093.29ms` in detached `/tmp/wt-615-mutant-r19`). All mutants and probes ran in `/tmp/wt-615-mutant-r19` (since removed and `git worktree prune`d).

## Verdict

- **No P0, P1, or P2 blockers.** Commit `ee773079` cleanly closes Round 18 `C26` (`onExit` tears down children before `quarantineLeaks`) and `C30` (Android `adb reverse --remove` removes the actually bound proxy port), and hardens `driver.test.mjs`.
- **Three P3 items** below: overly loose `ERROR_CODE` regex allowing bare lowercase alphanumeric IDs without `_`, missing test coverage for `awaitExit`'s deadline `SIGKILL`, and theoretical PID/PGID reuse + `ps`-failure fallback behavior in `awaitExit`.

---

## Closure Verification (Mutants in Detached `/tmp/wt-615-mutant-r19`)

| Closure / Probe                                                                                                               | Result       | Failing / Observing Test or Output                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `M1_C26_onExit_scan_before_teardown` (swap `quarantineLeaks` before `runTeardowns` in `test-store-output.mjs:323-325`)        | **CAUGHT**   | Failed `teardowns stop their children before the exit scan, so a late write is quarantined too` & `the exit path tears down before it scans` |
| `M2_no_awaitExit_in_runTeardowns` (remove `awaitExit(pids, waitMs)` at `test-store-output.mjs:318`)                           | **CAUGHT**   | Failed `teardowns stop their children before the exit scan, so a late write is quarantined too`                                              |
| `M3_no_zombie_filter` (remove `&& !stat.startsWith('Z')` at `test-store-output.mjs:251`)                                      | **CAUGHT**   | Failed `the teardown wait treats an exited, unreaped child as gone` (`3018.20ms`)                                                            |
| `M4_no_SIGKILL_at_deadline` (remove `process.kill(pid, 'SIGKILL')` at `test-store-output.mjs:270`)                            | **SURVIVED** | All `75` tests passed (`P3-2` below)                                                                                                         |
| `M5_no_timeout_adb_reverse_remove` (drop `{ timeout: 5_000, killSignal: 'SIGKILL' }` at `run-test-store-journey.mjs:234-237`) | **CAUGHT**   | Failed `the driver installs the exit guard right after its dirs and feeds it every id it learns`                                             |
| `M6_stdoutSummary_raw_error` (return `record.error` directly at `test-store-runner.mjs:329`)                                  | **CAUGHT**   | Failed `stdout carries error codes only: an uncoded message prints uncoded_error`                                                            |
| `M7_C30_remove_tcp_zero` (remove `0` instead of `proxy.port` at `run-test-store-journey.mjs:231`)                             | **CAUGHT**   | Failed `Android: the crash path removes the reverse of the actual proxy and Metro ports`                                                     |

---

## Findings

### P3-1: `ERROR_CODE` matches bare lowercase alphanumeric strings without underscores

- **Location:** `scripts/lib/test-store-runner.mjs:315-316`, `scripts/lib/test-store-runner.mjs:223`, `scripts/lib/test-store-runner.mjs:328-330`
- **Issue:** `export const ERROR_CODE = /^[a-z][a-z0-9_]*$/` matches any lowercase alphanumeric token even with zero `_` characters, contrary to the JSDoc (`lowercase snake case, as every JourneyError code is`). Every genuine `JourneyError` and `test_store_*` error code in `scripts/lib/test-store-*.mjs` and `scripts/run-test-store-journey.mjs` contains underscores (`test_store_*`).
- **Concrete failure scenario:** When `runJourney` (`scripts/lib/test-store-runner.mjs:223`) catches a non-`JourneyError` whose `String(error.message).split(':')[0]` is a short unredacted lowercase ID or secret (e.g. `throw new Error('a1b2c3d4: bad response')` or `'secret123: oops'`), `redactMessage` preserves `'a1b2c3d4'`/`'secret123'`, and live probe output showed `ERROR_CODE.test('a1b2c3d4') === true`, `ERROR_CODE.test('secret123') === true`, and `stdoutSummary` emitting `{"errors":["a1b2c3d4"]}` to stdout instead of `uncoded_error`.
- **Recommendation:** Require at least one underscore: `/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/`.

### P3-2: Deadline `SIGKILL` escalation in `awaitExit` is untested

- **Location:** `scripts/lib/test-store-output.mjs:268-274`, `scripts/lib/test-store-driver.test.mjs:265-278`
- **Issue:** Mutant `M4_no_SIGKILL_at_deadline` removed `process.kill(pid, 'SIGKILL')` from `awaitExit` and all `75` tests still passed. While `test-store-driver.test.mjs:265-278` tests `goneWithin` against a `SIGTERM`-ignoring `lingering(t, null)` child, no test verifies that `awaitExit` sends `SIGKILL` at `waitMs`.
- **Concrete failure scenario:** If `process.kill(pid, 'SIGKILL')` in `awaitExit` were deleted or replaced with `SIGTERM`, a `SIGTERM`-trapping Metro child would survive teardown, continue running after exit, and keep writing into evidence after `quarantineLeaks`, while the unit suite remained green. (A live node probe verified the production code _does_ currently `SIGKILL` a `trap '' TERM` child after `waitMs`.)
- **Recommendation:** Add a test in `scripts/lib/test-store-output.test.mjs` spawning a `trap '' TERM` child, calling `awaitExit([child.pid], 300)`, and asserting the child closes due to `SIGKILL` rather than sitting running.

### P3-3: `ps` parse / PID & PGID reuse / `ps`-failure fallback risks in `stillRunning` & `awaitExit`

- **Location:** `scripts/lib/test-store-output.mjs:235-276`, `scripts/run-test-store-journey.mjs:208-218,339-340`
- **Judgment breakdown:**
  1. **`ps` columns across macOS vs Linux procps:** `ps -A -o pid=,pgid=,stat=` works consistently on both macOS BSD `ps` (observed live: `ps exit: 0`, `899` lines, `0` non-3-column lines; zombies begin with `'Z'`, e.g., `Z`/`Z+`) and Linux `procps-ng` (`stat=` outputs `Z`/`Zs`/`Z+` with no header when `=` is used). Splitting `line.trim().split(/\s+/)` and checking `!stat.startsWith('Z')` will not miss a running process when `ps` succeeds. Note: if a grandchild created a new session/process group via `setsid()`, `entry.pgid === -pid` intentionally no longer matches it.
  2. **Reused PID / PGID -> `SIGKILL` risk:** `startMetro` (`run-test-store-journey.mjs:217`) and `startDeviceLog` (`run-test-store-journey.mjs:340`) pass `[-metroPid]` and `[stream.pid]` without deregistering when the child exits normally mid-run. If either exits early and the OS recycles the PID (or another process ends up with `pgid === metroPid`), or in the TOCTOU window between `stillRunning` and `process.kill(pid, 'SIGKILL')` (`test-store-output.mjs:268-270`), `runTeardowns`/`awaitExit` can `SIGTERM` and then `SIGKILL` the unrelated recycled PID/PGID. (Inside `awaitExit`, filtering only via exact `entry.pid === pid` / `entry.pgid === -pid` prevents hitting unrelated processes absent PID/PGID recycling.)
  3. **`ps` failure fallback:** If `ps` fails (`table.status !== 0`), `stillRunning` falls back to `process.kill(pid, 0)`. Verified live (`PATH=""` probe): an exited, unreaped zombie child returns `left: [78775]` after `318ms` (`waitMs: 300`), so every exit hits the full `TEARDOWN_WAIT_MS` (`3_000ms`) and attempts `SIGKILL` on zombies. (Passing `stream.pid` when `spawn` fails so `stream.pid === undefined` is harmless: `awaitExit([undefined])` returns `[]` in `20ms`.)

---

## Android Driver Test Determinism

- **Verdict:** **Deterministic.**
- **Evidence:** Inspected `scripts/lib/test-store-driver.test.mjs:89-165,209-228,281-297`. `runDriver(t, 'crash', 'android')` isolates `npx`, `adb`, and `maestro` stubs into per-test temp directories, uses `--proxy-port 0` so `startProxy` binds a real ephemeral port, polls `goneWithin(pid, 5_000)` up to `5_000ms`, short-circuits the `sigterm` wait loop via `exited`, and registers `t.after` cleanup for `child.pid` and `stubPids()`. Passed **10/10** consecutive standalone iterations and all baseline suite runs.

REVIEW-615-R19-DONE
