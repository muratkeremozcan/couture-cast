# Review — `tea615` Round 21 (`d767f17c..d9903133`)

Target: `/Users/murat/opensource/cc/couture-cast-wt-615`, range `d767f17c..d9903133` (`9b39d326` + `d9903133`).
Verification suite: `node --test scripts/lib/test-store-*.test.mjs` — `86` tests, `86` pass, `0` fail (`8612.13ms` at `d9903133`; `8496.53ms` baseline in `/tmp/wt-615-mutant-r21`, now removed and `git worktree prune`d).
Security lens (`~/.codex/skills/codex-security-review/SKILL.md`): `config_preflight.py --profile security_diff_scan` returned exit `2` (`status: "incomplete"`: `delegated_workers: unknown`, `goal_tools: unknown`), so the security diff scan ran in single-agent mode across `d767f17c..d9903133`; no P0–P2 security regressions found.

## Verdict

- **No P0, P1, or P2 blockers.** Every Round 20 P3 and Round 20 mutant (`M5`) is closed and verified by mutants in `9b39d326`, and the remaining recycled-PID + PGID edge case is recorded in `_bmad-output/test-artifacts/test-design/cc615-expo-sdk58-live-font-scale-test-design.md:546-552` (`d9903133`).
- **Three P3 findings** below on timeout-killed `spawnSync` silent fallthroughs, `ps` / grandchild snapshot edges, and the static `spawnSync` test scanner.

---

## Closure Verification (Mutants in Detached `/tmp/wt-615-mutant-r21`)

| Mutant                                                                                                                | Result     | Failing Test                                                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `M1_r20_M5_runTeardowns_pids_before_fn` (`test-store-output.mjs:323-329`)                                             | **CAUGHT** | `guard.child SIGKILLs a TERM-trapping child within waitMs, with the real kill` (`3206.71ms`) |
| `M2_no_pid_guard_removed` (drop `!Number.isInteger(pid)`, `test-store-output.mjs:372`)                                | **CAUGHT** | `guard.child ignores a child whose spawn failed (no pid)`                                    |
| `M3_no_post_exit_registration_check` (drop `exitCode !== null \|\| signalCode !== null`, `test-store-output.mjs:385`) | **CAUGHT** | `a process group is signalled only while ps shows a member of it`                            |
| `M4_no_snapshot_empty_drop` (fallback to `stillRunning` on empty snapshot, `test-store-output.mjs:392`)               | **CAUGHT** | `a Metro group with no member at the leader exit is dropped, even if the id comes back`      |
| `M5_snapshot_ignore_pgid_move` (omit `entry.pgid === pid`, `test-store-output.mjs:395`)                               | **CAUGHT** | `a Metro group is signalled while a member from the exit snapshot is alive in it`            |
| `M6_unbounded_spawnSync_in_driver` (drop `BOUNDED` on `adb uninstall`, `run-test-store-journey.mjs:287`)              | **CAUGHT** | `every spawnSync in the driver passes a timeout and SIGKILL`                                 |

---

## Findings

### P3-1: Timeout-killed `spawnSync(..., BOUNDED)` can proceed silently on `ETIMEDOUT`

- **Location:** `scripts/run-test-store-journey.mjs:122-128`, `scripts/run-test-store-journey.mjs:236`, `scripts/run-test-store-journey.mjs:252`, `scripts/run-test-store-journey.mjs:285-289`, `scripts/run-test-store-journey.mjs:487-492`
- **Issue & live probe:** Verified with `spawnSync(..., { encoding: 'utf8', timeout: 50, killSignal: 'SIGKILL' })`: a timeout returns `{ status: null, signal: "SIGKILL", code: "ETIMEDOUT", stdout: "" }`.
- **Concrete failure scenarios:**
  1. **`uninstall()` (`lines 285-289`):** Ignores both `status` and `error`. If `adb uninstall` or `xcrun simctl uninstall` hangs for 30 s and is `SIGKILL`ed (`ETIMEDOUT`), `uninstall()` returns cleanly and `install(artifact)` (`adb install -r` / `simctl install`) upgrades in place — violating the fresh-install invariant (`line 427`: no RevenueCat cache/session from a prior member) and potentially attributing an earlier member's cached state or failure to the current run. (Tolerating `status !== 0 && !error` preserves non-installed apps while failing fast on `error` such as `ETIMEDOUT` / `ENOENT`.)
  2. **`force-stop` (`line 236`) / `terminate` (`line 252`):** If `ETIMEDOUT` kills `force-stop` or `terminate`, `launch()` proceeds immediately to open the app while an old instance may still be running.
  3. **`rev(value)` (`lines 122-128`) & `device.log` (`lines 487-492`):** If `git rev-parse HEAD` times out (`ETIMEDOUT`), `rev()` returns `''` silently at startup; the entire device journey runs and prints `stdoutSummary` (`line 440`) before `writeArtifactManifests` (`test-store-runner.mjs:300`) finally throws `test_store_manifest_rev_missing` at the end. (`logcat` at `line 487` intentionally only omits the optional `device.log` on non-zero exit.)

### P3-2: Snapshot edge cases — `ps` failure at teardown skips known members; `G1 -> G2` replacement drops group

- **Location:** `scripts/lib/test-store-output.mjs:377-398`
- **Judgment & probes:**
  1. **Member changed group (`entry.pgid !== pid`):** Sound — checked at `line 395` (`entry.pid === seen.pid && entry.pgid === pid`) and proved by `M5`.
  2. **`ps` failure at leader exit (`snapshot === null`):** `line 391` falls back to `stillRunning([-pid], psTable)`, which degrades safely to pre-snapshot behavior if `ps` fails once at exit, or falls back to `process.kill(-pid, 0)` if `ps` fails at teardown too.
  3. **`ps` failure at teardown after a non-empty snapshot (`live === null`):** At `line 393`, `const live = psTable() ?? []` turns a transient `ps` failure at teardown into `[]`, making `member === false` and returning `[]`! Verified in live **Probe A** (`rows = [{ pid: 4242, pgid: 9000 }]` at `exit`, then `psTable() -> null` at teardown): `signalled: []`. Asymmetric with `line 391`: if `ps` fails at teardown when `snapshot` proved members existed, falling back to `[-pid]` would still stop them.
  4. **Grandchild spawned after snapshot:** If snapshot records `G1` (`4242`), `G1` spawns `G2` (`4300`) in `PGID 9000`, and `G1` exits before teardown, `target()` (`lines 394-396`) checks only `snapshot` PIDs and returns `[]` (**Probe B**: `signalled: []`), leaving `G2` unkilled. (In normal operation Metro's leader stays alive until teardown so `!exited` signals `[-pid]`; only an early leader exit followed by grandchild churn hits this.)

### P3-3: Static `spawnSync` test scanner catches plain calls but has fragile text heuristics

- **Location:** `scripts/lib/test-store-output.test.mjs:800-828`
- **Judgment:** For an ordinary unbounded call like `M6` (`spawnSync(adbBinary, ['-s', device, 'uninstall', appId])`), the test fails immediately. However, its text scan can miss or misparse edge cases:
  1. Line `811` skips any `spawnSync(` preceded on the same line by `import` or `//` (even inside a string like `'https://...'`).
  2. The parenthesis balancer (`lines 814-818`) counts literal `(` and `)` without string/comment awareness or `end < source.length` bounds (unbalanced `'echo ('` would loop until EOF/OOM).
  3. `/\btimeout\b/.test(call)` and `/\bBOUNDED\b/.test(call)` (`lines 824-825`) do not verify that `timeout` / `killSignal` are actually passed in the options object (e.g. a `'--timeout'` CLI arg + `{ killSignal: 'SIGKILL' }`), and `execFileSync` / `execSync` / aliased `spawnSync` are unchecked. Parsing `run-test-store-journey.mjs` with `typescript` (`ts.createSourceFile`, already a root devDependency) would remove these heuristics.

REVIEW-615-R21-DONE
