# Review Round 17 — PR/Handover #615 (`tea615`)

Target reviewed (strictly read-only across repo worktrees; probes and mutants executed only in detached `/tmp/wt-615-mutant-r17` with `node_modules` symlinked, removed and pruned immediately after):

- **Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615`, range `6cd4974e..1ea493d9`:
  - `62b651bf`: `scripts/ci/workflow-node-deps.mjs`, `scripts/ci/workflow-node-deps.test.mjs`
  - `1ea493d9`: `scripts/lib/test-store-output.mjs`, `scripts/lib/test-store-output.test.mjs`, `scripts/run-test-store-journey.mjs`

All three R16 Part A probes (`comment`, `pipe`, `-r` preload on `node` heredocs) now detect `'yaml'` cleanly, all 7 mutants (`A12`–`A13`, `C19`–`C23`) were **KILLED**, and `95/95` tests pass in `413.1ms`. No `P0`–`P2` issues found; three `P3` findings/assessments remain.

---

## Findings (P0–P3)

### P3 — Part C: `proc.once` signal listeners allow a second `SIGINT`/`SIGTERM` to kill mid-scan (`SIG_DFL`), `spawnSync` delays signal handling until `SIGKILL`, and signal exit skips `try/finally` child cleanup (`scripts/lib/test-store-output.mjs:235-258`, `scripts/run-test-store-journey.mjs:195, 289, 399-414`)

- **Closure verification (`1ea493d9`)**:
  - `C19` (revert `quarantineLeaks` multi-failure `test_store_quarantine_failed` + `AggregateError` cause back to `failures[0]`) -> **KILLED** (exit 1)
  - `C20` (drop `if (!code) proc.exitCode = 1` on `moved.length`) -> **KILLED** (exit 1)
  - `C21` (drop `SIGINT`/`SIGTERM` listeners) -> **KILLED** (exit 1)
  - `C22` (drop `quarantineLeaks` inside `onExit`) -> **KILLED** (exit 1)
  - `C23` (drop `scanIds.push(member.userId, member.token)` in driver) -> **KILLED** (exit 1)
- **Can a leak still reach the upload?**
  1. **Second identical signal during `onExit` (reproduced live — `test-store-output.mjs:250-252`)**: `proc.once('SIGINT', onSigint)` and `proc.once('SIGTERM', onSigterm)` deregister their listener on the first signal, restoring OS `SIG_DFL` while `proc.exit(130/143)` runs `onExit` synchronously.
     - **Concrete failure scenario (`DOUBLE_SIGINT` probe)**: Sending a second `SIGINT` while `onExit` is quarantining `a.json` and `b.json` (e.g., Ctrl-C twice or slow `EXDEV` `copyFileSync`) terminates the process immediately via `SIG_DFL` (`code: null, signal: "SIGINT", remaining: ["a.json", "b.json"]`), leaving both leaking files in `dirs.evidence` for an `if: always()` upload. Using `proc.on` with an `exiting` guard keeps repeated signals caught until `_exit()` completes.
  2. **Blocked `spawnSync` child + `SIGKILL` (`scripts/run-test-store-journey.mjs:122, 229, 461`)**: `SIGKILL` is uncatchable, and `spawnSync` (`adb`, `simctl`, `maestro` with `180s`–`300s` timeouts) blocks Node's event loop so `onSigint`/`onSigterm` cannot run until `spawnSync` returns. If a hung child ignores signals until CI escalates to `SIGKILL`, `onExit` never runs.
  3. **ID learned after evidence is written**: `scanIds` (`run-test-store-journey.mjs:90, 148, 155, 325`) is read live at exit (`[...ids]`, `line 238`), so any already-learned ID (`testStoreKey`, `bypassHeaders`, `member.userId`, `member.token`) scans earlier files cleanly. (`REVENUECAT_SECRET_API_KEY` at `line 156` is only checked non-empty and never held in driver memory.)
  4. **`unhandledRejection` (verified live)**: On Node v24, an unhandled Promise rejection exits `1` and fires `'exit'` synchronously (`UNHANDLED_REJECTION: {"status":1,"evidence":[],"stderrHasQuarantine":true}`).
- **Does overriding `SIGINT` and `SIGTERM` change child simulator / Metro cleanup (`run-test-store-journey.mjs:195, 289, 400-414`)?**
  - Neither Node's default signal termination nor `onSigint`/`onSigterm` calling `proc.exit(130/143)` enters `try ... finally` (`lines 400-414`), so on `SIGINT`/`SIGTERM`, detached Metro (`-metro.pid`, `line 195`), simulator `log stream` (`logStream`, `line 289`), and `adb reverse --remove` (`lines 410-413`) are still skipped. What changes is that `proc.exit(130/143)` ensures `onExit` runs cleanly with exit code `130`/`143`, and because `installEvidenceGuard` runs `proc.exit` synchronously in its line-91 listener, any later signal listener registered afterward cannot execute async teardown.

---

### P3 — Part C: Source-text driver test does not execute `run-test-store-journey.mjs` (`scripts/lib/test-store-output.test.mjs:428-448`)

- `the driver installs the exit guard right after its dirs and feeds it every id it learns` checks fixed string substrings and `/require|await|throw/` between `dirsAt` and `guardAt`.
- **Assessment**: Good structural smoke test against moving `installEvidenceGuard` down, **not sufficient by itself**: trivial formatting changes or helper extractions break it, while a broken `scanIds` runtime flow (e.g., reassigning `scanIds = [...]` or `signup` failing after another writer wrote to `out`) is never exercised dynamically.
- **Recommendation**: Add a fast subprocess test running `scripts/run-test-store-journey.mjs` against a minimal temp HTTP server (`--api-url`, `--secrets-env`, stub `ANDROID_HOME` `adb`) that plants a leak containing `testStoreKey` / signed-up `member.userId` before crashing mid-run and verifies `dirs.evidence` is emptied.

---

### P3 — Part A: All R16 heredoc/`STDIN_MARK`/preload gaps verified closed (`scripts/ci/workflow-node-deps.mjs:488-564`)

- **Closure verification (`62b651bf`)**:
  - `R16-FN-heredoc-followed-by-comment` => `["(inline):yaml"]`
  - `R16-FN-heredoc-piped-to-tee` => `["(inline):yaml"]`
  - `R16-FN-heredoc-with-preload-flag` => `["(inline):yaml"]`
  - `R17-edge-then-node-heredoc` => `["(inline):yaml"]`
  - Mutants `A12` (revert `STDIN_MARK` to line end) and `A13` (skip `nodeCommand` when `stdin` exists) were both **KILLED** (exit 1).
- **Note (`workflow-node-deps.mjs:494`)**: `header.indexOf(command, from)` relies on `command` matching verbatim in `header` (holds for normal `commands(header)` output; only a stripped keyword/reformatted line continuation could return `-1`, harmless unless chained with a later command).

---

## Codex Security Diff-Scan Assessment

- **Preflight & scope limit**: `python3 /Users/murat/.codex/plugins/cache/openai-curated/codex-security/d6169bef/scripts/config_preflight.py --profile security_diff_scan` returned `status: incomplete` (`delegated_workers=unknown`, `goal_tools=unknown`; `goals_enabled` passed). Reported explicitly as an incomplete automated preflight; manual diff inspection and mutant/probe verification covered `62b651bf` and `1ea493d9`.
- **Security summary**:
  - `1ea493d9`: Ensures failed quarantine moves surface every file remaining in `dirs.evidence` via `test_store_quarantine_failed` with `AggregateError` causes, and closes normal/throw/`process.exit`/unhandledRejection/`SIGINT`/`SIGTERM` leak paths via `installEvidenceGuard`. Remaining P3 edges are `SIG_DFL` on double `SIGINT`/`SIGTERM` (`proc.once`), `spawnSync` child hangs past CI `SIGKILL`, signal-skipped `finally` child cleanup, and running the driver live in tests.
  - `62b651bf`: Closes trailing-comment, pipeline, and `-r` preload bypasses on `node` heredocs cleanly.

---

## Executed Suites, Probes & Mutants

| Target                                                 | Scope / Command                                                                        | Observed Result                                                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `wt-615` HEAD (`1ea493d9`)                             | `node --test scripts/ci/workflow-node-deps.test.mjs scripts/lib/test-store-*.test.mjs` | **95/95 pass, 0 fail** (`413.1ms`)                                                                                                           |
| `wt-615` (`62b651bf` probes, `/tmp/wt-615-mutant-r17`) | 3 R16 probes + 1 `if ...; then node <<EOF` probe                                       | All 4 flagged `["(inline):yaml"]` cleanly                                                                                                    |
| `wt-615` (`1ea493d9` runtime probes)                   | `unhandledRejection` & `DOUBLE_SIGINT` subprocesses                                    | `unhandledRejection` quarantined cleanly (`status: 1`); `DOUBLE_SIGINT` killed mid-scan (`signal: "SIGINT", remaining: ["a.json","b.json"]`) |
| `wt-615` mutants (`/tmp/wt-615-mutant-r17`)            | Baseline pass + 7 mutants (`A12`–`A13`, `C19`–`C23`)                                   | **7/7 KILLED** (exit 1)                                                                                                                      |

REVIEW-615-R17-DONE
