# Review — `tea615` Round 20 (`ee773079..d767f17c`)

Target: `/Users/murat/opensource/cc/couture-cast-wt-615` (code commit `d767f17c`, parent `d6e5966b`; also reviewed range `ee773079..d767f17c`).
Verification suite: `node --test scripts/lib/test-store-*.test.mjs` — `80` tests, `80` pass, `0` fail (`8154.60ms` on latest post-cleanup run in the main checkout; `8207.11ms` in detached `/tmp/wt-615-mutant-r20`). All mutants and probes ran in `/tmp/wt-615-mutant-r20` (removed and `git worktree prune`d after).
Security lens (`~/.codex/skills/codex-security-review/SKILL.md`): `config_preflight.py --profile security_diff_scan` exited `2` (`status: "incomplete"`: `delegated_workers: unknown`, `goal_tools: unknown`), so the security diff review ran directly in-session over `ee773079..d767f17c`; no new P0–P2 security regressions found.

## Verdict

- **No P0, P1, or P2 blockers.** Commit `d767f17c` cleanly closes all three Round 19 P3s (`ERROR_CODE` underscore requirement + exhaustive `test_store_*` check, `awaitExit` deadline `SIGKILL` test, and `guard.child` dropping exited direct children and gating group signals via `stillRunning`).
- **Two P3 findings + recorded limits/notes** below.

---

## Closure Verification (Mutants in Detached `/tmp/wt-615-mutant-r20`)

| Mutant                                                                                                                 | Result       | Failing Test / Observation                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| `M1_r19_M4_no_SIGKILL_at_deadline` (remove `process.kill(pid, 'SIGKILL')` in `awaitExit`, `test-store-output.mjs:270`) | **CAUGHT**   | Failed `awaitExit SIGKILLs a child that ignores SIGTERM past the deadline` (`3205.43ms`) |
| `M2_ERROR_CODE_no_underscore_required` (revert `ERROR_CODE` to `/^[a-z][a-z0-9_]*$/`, `test-store-runner.mjs:319`)     | **CAUGHT**   | Failed `a bare lowercase token is no error code: it prints uncoded_error`                |
| `M3_child_ignore_exited_flag` (return `[pid]` ignoring `exited`, `test-store-output.mjs:366`)                          | **CAUGHT**   | Failed `a child that exited mid-run is dropped from the teardown and never signalled`    |
| `M4_child_group_skip_stillRunning` (return `[-pid]` unconditionally in `group` branch, `test-store-output.mjs:365`)    | **CAUGHT**   | Failed `a process group is signalled only while ps shows a member of it`                 |
| `M5_runTeardowns_pids_before_fn` (collect `entry.pids()` before `entry.fn()`, `test-store-output.mjs:312-318`)         | **SURVIVED** | All `80` tests passed (`P3-1` below)                                                     |

---

## Findings

### P3-1: `guard.child`'s `awaitExit` wait/escalation path has no test (`M5` survived)

- **Location:** `scripts/lib/test-store-output.mjs:312-320`, `scripts/lib/test-store-output.mjs:372-383`, `scripts/lib/test-store-output.test.mjs:661-698`
- **Issue:** In `runTeardowns`, `entry.pids()` must run _after_ `entry.fn()` (`test-store-output.mjs:318`) because `guard.child` populates `targets` inside `fn()` (`test-store-output.mjs:372-374`). Mutant `M5_runTeardowns_pids_before_fn` reversed that order so `awaitExit` received `[]` from every `guard.child`, yet all `80` tests passed. Both new `guard.child` tests inject a recording `kill` stub and assert `signalled` from `SIGTERM` without asserting that `awaitExit` waits for or `SIGKILL`s a `guard.child` past `waitMs`, and `test-store-output.test.mjs:590` still uses `guard.teardown` directly.
- **Concrete failure scenario:** Reordering `entry.pids()` or omitting `targets` from `guard.child.pids` would leave `runTeardowns` firing `SIGTERM` without waiting in `awaitExit` or escalating to `SIGKILL`, letting a slow-draining or `SIGTERM`-ignoring `guard.child` keep writing into evidence past `quarantineLeaks`, undetected by the suite.
- **Recommendation:** Add a test registering a `stubborn(t)` child via `guard.child('stubborn', child)` (with real default `kill`) and asserting `runTeardowns()` `SIGKILL`s it within `waitMs`.

### P3-2: Group-mode PGID reuse after leader exit & `ENOENT` `undefined` PID in `guard.child`

- **Location:** `scripts/lib/test-store-output.mjs:358-383`
- **Details & probes:**
  1. **Recycled PID leading a new process group (`group: true`):** `target()` at `test-store-output.mjs:365` ignores `exited` and only checks `stillRunning([-pid]).length`. Verified in a live probe (`live` detached process sharing `pid` of a fake exited leader with `exitCb()` already invoked): `guard.runTeardowns()` emitted `[[-56422, "SIGTERM"]]`. Once Metro's leader exits, is reaped by Node, and all original Metro children exit (temporarily emptying PGID `pid`), if the OS later recycles `pid` to a new process that leads its own process group (`pgid === pid`), `stillRunning([-pid])` matches it and `guard.child` sends `SIGTERM` + `SIGKILL`. Recording this as a known limit of numeric PGID tracking on POSIX (or additionally checking process start time against `spawn` / observing an empty group after `exit`) documents why `exited` alone cannot skip `group: true` without prematurely sparing surviving Metro grandchildren.
  2. **`spawn` failure before PID assignment (`child.pid === undefined`):** In `test-store-output.mjs:359-367`, when `spawn` fails with `ENOENT`, Node emits `'error'` without `'exit'` and `child.pid` is `undefined`. Verified live: `guard2.child('bad', bad)` sent `[[null, "SIGTERM"]]` (JSON-serialized `undefined` in array) to `kill`. Guarding `if (!pid) return` at the top of `guard.child` avoids signalling `undefined`.

---

## Judgment Summary

1. **Can a recycled PID leading a new process group match `stillRunning([-pid])` after Metro leader exited, was reaped, and its group emptied?**
   **Yes** (documented in `P3-2` above). Skipping `group` immediately when `exited` fires would fail to kill Metro grandchildren that outlive `npx`, while checking `stillRunning([-pid])` at teardown cannot distinguish a recycled group leader (`pgid === pid`) if the group had emptied mid-run. Without polling or comparing OS process start times (`ps -o lstart=` / `etime=`), documenting this as a known POSIX PID-wrap limit (and optionally guarding `ps` failure fallback `table.status !== 0` when `exited` holds) is the right boundary.
2. **Can `exit` event vs reaping race so a reused PID is signalled?**
   - **Direct child (`group: false`):** No realistic race in normal Node execution. In `libuv`, `waitpid` runs in `uv__chld` and dispatches the JS `'exit'` callback synchronously in the same turn, setting `exited = true` right when the OS PID is freed. While the JS thread is blocked in `spawnSync` (`run-test-store-journey.mjs`) or `awaitExit`'s `Atomics.wait`, Node cannot call `waitpid`, so an exited direct child stays an unreaped zombie (`Z`) owned by Node and the OS cannot reassign its PID until Node resumes. (Wait-time zombies are skipped by `stillRunning` via `!stat.startsWith('Z')`.)
   - **Process group (`group: true`):** Grandchildren of Metro are reaped asynchronously by Metro or PID 1 even while Node is idle or blocked, which only creates a problem once the _leader_ itself has exited, been reaped by Node, and the group has emptied (item 1 above).
3. **Does any other spawn in `scripts/run-test-store-journey.mjs` (`proxy`, `maestro`, `adb`) still need a teardown?**
   - **`proxy` (`run-test-store-journey.mjs:352-356, 429`):** In-process HTTP server (not a child process), closed via `await proxy?.close()` in `finally`, never writes to `dirs.evidence`, and the OS closes its socket immediately on `process.exit()` from `SIGINT`/`SIGTERM`. No separate teardown needed.
   - **`maestro`, `adb`, `xcrun simctl`, `apksigner`, `git`:** All invoked via synchronous `spawnSync` (`lines 120, 128, 223, 229, 245, 279, 280, 479`), so no background process remains after they return. (`metro` at `line 196` and `logStream` at `line 311` are the only async `spawn`s, and both now register via `guard.child`.) Non-blocking note: the five direct `spawnSync` calls outside `run()` / `adb reverse --remove` (`lines 229, 245, 279, 280, 479`) lack `timeout` / `killSignal`, unlike `run()` (`lines 132-133`) and `adb reverse --remove` (`lines 224-225`).

REVIEW-615-R20-DONE
