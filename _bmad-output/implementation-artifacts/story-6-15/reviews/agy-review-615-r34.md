# Review 615 — Round 34 (`8a6816f4..904405a9`)

Target: `/Users/murat/opensource/cc/couture-cast-wt-615-tea` (`branch: tea/owned-kill-r33`, commit `904405a9`, range `8a6816f4..904405a9`).
Verdict: **The range `8a6816f4..904405a9` is clear** (0 P0, 0 P1, 0 P2, 0 P3 findings).

## Test Verification & Security Scan Summary

- `node --test scripts/ci/node-test-gate.test.mjs scripts/lib/owned-process.test.mjs` in `/Users/murat/opensource/cc/couture-cast-wt-615-tea`: **73 tests / 9 suites passed, 0 failed, 0 cancelled, 0 skipped, 0 todo** (`duration_ms 3465.098542`).
- Codex Security preflight (`config_preflight.py --profile security_diff_scan`) returned `status: "ready"` (`goal_tools_available=false` `suggest` notice only); audit of `8a6816f4..904405a9` (`scripts/ci/node-test-gate.test.mjs:213-225`) found no security issues.
- Cleanliness: mutant/probe worktree `/tmp/wt-615-mutant-r34` removed and `git worktree prune`d; repository working tree is clean.

## Closure Verification (`BG_GROUP_MEMBERS_R34` Probe in Detached `/tmp/wt-615-mutant-r34`)

- Re-ran the `BG_GROUP_MEMBERS` probe launching a live `startBackgroundSuites(['blocked'], ...)` group (`pgid: 24339`) with the exact markers from `scripts/ci/node-test-gate.test.mjs:216,224` (`['node-test-gate', ...BACKGROUND_FIXTURES]` where `BACKGROUND_FIXTURES = [...Object.keys(sources), 'blocked.test.mjs']`):
  - Before `killOwnedGroup`: **3 live group members** (`node ... node-test-gate.mjs --background-run blocked`, `node --test ... blocked.test.mjs`, and the isolated `blocked.test.mjs` child worker).
  - Result: **`killedCount: 3, remainingCount: 0, remaining: []`** — all three members were signalled and died cleanly.
- Verified with `git grep -n "startBackgroundSuites"` in `scripts/ci/node-test-gate.test.mjs` that every background fixture file passed to `startBackgroundSuites` is covered by `BACKGROUND_FIXTURES`.

## Findings

- None (0 P0–P3 findings; range is clear).

## Explicit Judgment Requested

- **Is a fixture file name like `passing.test.mjs` narrow enough in a recycled group?**
  - **Yes (acceptable / non-blocking).** Unlike bare `os.tmpdir()` (`/tmp` or user `TMPDIR`), which appears on almost any temp-using process, `killOwnedGroup(checkedGroup(pid), ['node-test-gate', ...BACKGROUND_FIXTURES])` (`scripts/ci/node-test-gate.test.mjs:216-225`) requires _both_ membership in the tracked `pgid` _and_ a command substring matching `'node-test-gate'` or one of the 9 synthetic fixture names (`passing.test.mjs`, `grouped.test.mjs`, `empty.test.mjs`, `skipped.test.mjs`, `skipped-suite.test.mjs`, `todo.test.mjs`, `failing.test.mjs`, `crashing.test.mjs`, `blocked.test.mjs`). `git grep` across `scripts/` shows no other tests in the repo using those filenames. A false match would require an unsettled PGID to exit, get recycled to another detached group before `after()`, _and_ contain one of those test filenames in that group's command line — a remote theoretical overlap rather than a realistic failure.

REVIEW-615-R34-DONE
