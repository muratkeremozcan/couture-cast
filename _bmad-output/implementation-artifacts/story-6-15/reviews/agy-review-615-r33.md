# Review 615 — Round 33 (`9e96ab9d..c9bcc24b`)

Target: `/Users/murat/opensource/cc/couture-cast-wt-615-tea` (`branch: tea/owned-kill-r32`, commit `c9bcc24b`, range `9e96ab9d..c9bcc24b`).
Verdict: **Range is clear above P3** (0 P0, 0 P1, 0 P2; 2 P3 findings below).

## Test Verification & Security Scan Summary

- `node --test scripts/lib/owned-process.test.mjs scripts/ci/native-ios-runtime-diagnostics.test.mjs scripts/ci/node-test-gate.test.mjs` in `/Users/murat/opensource/cc/couture-cast-wt-615-tea`: **85 tests / 9 suites passed, 0 failed, 0 cancelled, 0 skipped, 0 todo** (`duration_ms 3607.23075`).
- Codex Security preflight (`config_preflight.py --profile security_diff_scan`) returned `status: "ready"` (`goal_tools_available=false` `suggest` notice only); diff audit across `9e96ab9d..c9bcc24b` found no security regressions above P3 (see P3-2 for overly broad `os.tmpdir()` matching in recycled PGIDs).
- Cleanliness: mutant worktree `/tmp/wt-615-mutant-r33` removed and `git worktree prune`d; worktree is clean.

## Closure Verification (Mutants & Probes in Detached `/tmp/wt-615-mutant-r33`)

- **r32 `P_R32_DIAGNOSTICS_LEAK` probe re-run (`R32_DIAGNOSTICS_LEAK_RETEST`):** Using `directoryFor(t, { reap: [['grandchild.pid', 'setInterval']] })`, throwing after writing `grandchild.pid` kills the detached `setInterval` grandchild before deleting the directory (`aliveAfterTest: false`).
- **Closure mutants:**
  - `M3_processTable_zombie_filter` (`scripts/lib/owned-process.mjs:18`: remove `!match[3].startsWith('Z')` in `parseProcessTable`): **KILLED** by `scripts/lib/owned-process.test.mjs`.
  - `M4_owned_list` (`scripts/lib/owned-process.mjs:38`: ignore `Array.isArray(expected)`): **KILLED** by `scripts/lib/owned-process.test.mjs`.
  - `M5_diag_reap_after_rm` (`scripts/ci/native-ios-runtime-diagnostics.test.mjs:23-29`: move `fs.rmSync` before `reap`): **SURVIVED** existing `native-ios-runtime-diagnostics.test.mjs` (happy-path test exits cleanly with child already reaped, so error-path hook ordering is covered by `R32_DIAGNOSTICS_LEAK_RETEST` rather than an injected-throw unit test).
  - `M6_killGroup_empty` (`scripts/ci/node-test-gate.test.mjs:218-224`: make `killGroup` a no-op): **SURVIVED** existing `node-test-gate.test.mjs` (tests wait for `settleGroup` / `groupAlive === false` before calling `killGroup`).

## Findings

### P3-1: `killGroup` in `node-test-gate.test.mjs` misses `node --test`'s child test-file worker process when files are relative to `cwd`

- Location: `scripts/ci/node-test-gate.test.mjs:218-224`, `scripts/ci/node-test-gate.test.mjs:305`, `scripts/ci/node-test-gate.test.mjs:514`, `scripts/ci/node-test-gate.test.mjs:563`
- Evidence:
  - `killGroup(pid)` calls `killOwnedGroup(checkedGroup(pid), ['node-test-gate', os.tmpdir(), fs.realpathSync(os.tmpdir())])`.
  - Launching a real `startBackgroundSuites(['blocked'], ...)` group (`BG_GROUP_MEMBERS`, `pgid: 16979`) showed three live members in the group:
    1. `pid 16979`: `node .../scripts/ci/node-test-gate.mjs --background-run blocked` (contains `node-test-gate`)
    2. `pid 16980`: `node --test ... --test-reporter=.../node-test-gate-reporter.mjs --test-reporter-destination=/var/folders/.../blocked/events.jsonl blocked.test.mjs` (contains both `node-test-gate` and `os.tmpdir()`)
    3. `pid 16982`: `node --test-concurrency=0 ... --trace-event-file-pattern=node_trace.${rotation}.log blocked.test.mjs` (the isolated child worker executing the test file!)
  - Because `startBackgroundSuites` tests pass relative filenames (`['blocked.test.mjs']`, `['passing.test.mjs', ...]`) with `cwd: directory`, `pid 16982`'s `ps` command line ends with `blocked.test.mjs` and contains **none** of `'node-test-gate'`, `os.tmpdir()`, or `fs.realpathSync(os.tmpdir())`.
  - Calling `killGroup` left `killedCount: 2, remainingCount: 1` with `pid 16982` (`blocked.test.mjs`) still running.
- Concrete failure scenario: If a background fixture test fails or hangs while `temp` still exists (for instance before `temporary()` removes `temp`, or in a test without a `fs.existsSync(temp)` exit check), `killGroup(pid)` in `node-test-gate.test.mjs` kills only the `--background-run` parent and `node --test` coordinator while leaving the child `blocked.test.mjs` worker alive in the group (which also stalls `settleGroup` / fails the `after()` `survivors` assertion without reaping the survivor). Passing `files` as `directory`-prefixed paths or including the fixture test basenames fixes this.

### P3-2: `os.tmpdir()` / `fs.realpathSync(os.tmpdir())` in `killGroup` is broad enough to match unrelated processes in a recycled PGID

- Location: `scripts/ci/node-test-gate.test.mjs:218-224`
- Evidence:
  - On Linux CI, `os.tmpdir()` is `/tmp`; on macOS, it is the user's shared `/var/folders/<hash>/<id>/T`.
  - Unlike `'node-test-gate'` or the test suite's fixture prefix `'node-test-gate-fixture-'` (`scripts/ci/node-test-gate.test.mjs:75`), matching any substring of `os.tmpdir()` matches every process whose arguments reference `/tmp` or user `TMPDIR`.
- Concrete failure scenario: If a tracked PGID ends cleanly before `after()` runs and is recycled by the OS to an unrelated detached process group using system temp (e.g., another CI job, browser profile `--user-data-dir=/tmp/...`, or temp script under `/tmp` / `TMPDIR`), `killGroup` will match `os.tmpdir()` and send `SIGKILL` to that unrelated process. Narrowing the marker to `'node-test-gate-fixture-'` (with absolute fixture paths) or `'node-test-gate'` + specific fixture filenames avoids hitting generic `/tmp` / `TMPDIR` processes.

## Explicit Judgments Requested

1. **Can `killGroup` now miss a real survivor of the background run (a member whose command names neither marker, macOS `/var` vs `/private/var` temp paths)?**
   - **macOS `/var` vs `/private/var`**: Handled correctly (`killGroup` includes both `os.tmpdir()` and `fs.realpathSync(os.tmpdir())`, which on this host were `/var/folders/.../T` and `/private/var/folders/.../T`).
   - **Member whose command names neither marker**: **Yes — verified (`P3-1`).** `node --test` runs each test file in an isolated child Node process whose argv holds the file argument verbatim (`blocked.test.mjs`, `passing.test.mjs`, etc.), not the `cwd`, and no `node-test-gate` string. Thus `killGroup` misses the test-file child process whenever relative paths are used (1 of 3 members survived `killGroup`).

2. **Is the temp-dir marker so broad that it could match an unrelated process in a recycled group?**
   - **Yes (`P3-2`).** Using bare `os.tmpdir()` (`/tmp` on Linux, shared user `TMPDIR` on macOS) matches any process inside a recycled PGID that happens to pass a path under `/tmp` or user `TMPDIR` on its command line, rather than scoping to this test's own temp directory prefix (`'node-test-gate-fixture-'`) or fixture names.

REVIEW-615-R33-DONE
