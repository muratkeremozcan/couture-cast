# Review Round 18 — PR/Handover #615 (`tea615`)

Target reviewed (strictly read-only across repo worktrees; probes and mutants executed only in detached `/tmp/wt-615-mutant-r18` with `node_modules` symlinked, removed and pruned immediately after):

- **Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615`, range `1ea493d9..4183df6c`:
  - `e85890bd`: `_bmad-output/test-artifacts/test-design/cc615-expo-sdk58-live-font-scale-test-design.md`
  - `4183df6c`: `scripts/lib/test-store-output.mjs`, `scripts/lib/test-store-output.test.mjs`, `scripts/run-test-store-journey.mjs`, `scripts/lib/test-store-driver.test.mjs`

All requested tests passed (`69/69`, `3.11s`), the live `DOUBLE_SIGINT_AND_SIGTERM` probe exited cleanly (`code: 130, signal: null, remaining: []`), and `6` of `8` mutants were **KILLED**. No `P0`–`P2` issues found; four `P3` findings/judgments cover the remaining gaps.

---

## Findings (P0–P3)

### P3 — Driver subprocess test can flake on single-shot `alive(pid)` after `close`, burns 60 s on early crash before `planted`, leaves `sleep 300` stubs on mid-test abort, and omits Android `adb-reverse` coverage (`scripts/lib/test-store-driver.test.mjs:81-165`)

- **Closure verification (`4183df6c`)**:
  - `C28a` (drop `metro` teardown in `run-test-store-journey.mjs:207-213`) -> **KILLED**
  - `C28b` (drop `log-stream` teardown in `run-test-store-journey.mjs:332`) -> **KILLED**
  - `C29` (drop verdict stdout print in `run-test-store-journey.mjs:434-439`) -> **KILLED**
  - `C30` (revert `proxy.port` -> `proxyPort` in `adb-reverse` teardown, `line 226`) -> **SURVIVED** (`test-store-driver.test.mjs` tests `--platform ios` only).
- **Determinism & leak judgments**:
  1. **Single-shot `alive(pid)` after `child.on('close')` (`test-store-driver.test.mjs:149, 164`)**: `onExit` calls `process.kill(-metroPid, 'SIGTERM')` / `stream.kill('SIGTERM')` and immediately exits the parent driver. On a loaded Linux CI runner, kernel signal delivery and PID reaping of `sleep 300` are asynchronous (`android-native-workflow.test.mjs:434-435` fixed the exact same race with a 5 s reap loop). **Concrete failure scenario**: `driver` exits microseconds after sending `SIGTERM`, `child.on('close')` fires while `sleep 300` is still shutting down or a zombie, and `process.kill(pid, 0)` returns `true`, flaking the test.
  2. **Fixed `500 ms` wait & `60 s` poll without early-exit check (`lines 141-148`)**: In `sigterm` mode, `500 ms` after `planted` works reliably even if `runJourney` hasn't reached `waitForPaid()` yet (`leak.json`, `member`, and both PIDs already exist once `planted` appears). However, `while (!fs.existsSync(planted) && Date.now() < deadline)` never checks whether `child` already exited, so any crash before `planted` burns the full `60 s` waiting loop.
  3. **Leaks on mid-test failure**: `stubServer` closes sockets and server in `t.after` (`lines 61-68`) and driver's ephemeral `--proxy-port 0` dies with the child, **but** `runDriver` has no `t.after` killing `child`, `metro.pid`, or `stream.pid` — an early abort leaves `sleep 300` processes alive for up to `300 s`.

---

### P3 — `spawnSync` (`adb reverse --remove`) in exit teardown lacks a timeout (`scripts/run-test-store-journey.mjs:226-231`)

- Inside Node's `'exit'` event, synchronous `spawnSync` calls execute normally and return immediately when `adb` succeeds or is missing (`ENOENT`).
- **Concrete failure scenario**: If a hung local `adb` daemon stalls on `adb -s <device> reverse --remove tcp:<port>`, `spawnSync` at `line 229` has no `timeout` option (unlike `run()` at `line 126`, which sets `timeout: 180_000, killSignal: 'SIGKILL'`). `onExit` hangs indefinitely before reaching subsequent teardowns (`log-stream`) until killed with `SIGKILL`. Adding a short `timeout` (e.g., `5_000, killSignal: 'SIGKILL'`) prevents a stalled daemon from hanging process exit.

---

### P3 — `onExit` scans before teardowns (`scripts/lib/test-store-output.mjs:256-269`) and mutant `C26` survives (`scripts/lib/test-store-output.test.mjs:491-511`)

- **Closure verification**:
  - `DOUBLE_SIGINT_AND_SIGTERM` probe -> `{"code":130,"signal":null,"remaining":[]}` (closed; `C24` `proc.once` and `C25` missing `exiting` both **KILLED**, `C27` missing `entry.done` **KILLED**).
  - `C26` (move `runTeardowns()` before `quarantineLeaks(...)` in `onExit`) -> **SURVIVED** because `test-store-output.test.mjs:504` calls `guard.runTeardowns()` manually before `proc.emit('SIGTERM')`, so scan-before-teardown order inside `onExit` is unverified.
- **Can a child write into `evidence` after the scan?**: In `run-test-store-journey.mjs`, background children (`metro`, `logStream`) redirect only to `<out>.private/` and teardowns don't touch `--out`, so no current child writes there. Still, if any child process or teardown ever wrote into `dirs.evidence` between `line 259` (`quarantineLeaks`) and `line 268` (`runTeardowns` killing it), the file would not be rescanned; stopping children before scanning (or rescanning after) closes that ordering window.

---

### P3 — Stdout verdict `errors` hygiene assessment (`scripts/run-test-store-journey.mjs:434-439`, `scripts/lib/test-store-runner.mjs:223`)

- `console.log(JSON.stringify({ verdict, errors }))` prints step names/booleans plus `record.error` (`error.code ?? redactMessage(String(error.message).split(':')[0])`).
- For all `JourneyError` failures and Node system errors, `.code` is a static identifier with zero secrets; for uncoded errors, `.split(':')[0]` drops detail after a colon and `redactMessage` masks queries, ID path segments, `$RCAnonymousID:`, UUIDs, JWTs, and >=16-char mixed-case/digit runs (`TOKEN_RUN`). Only an uncoded error with a digitless all-lowercase secret (or <16-char non-UUID opaque ID) appearing before any colon could reach stdout.

---

## Codex Security Diff-Scan Assessment

- **Preflight & scope limit**: `python3 /Users/murat/.codex/plugins/cache/openai-curated/codex-security/d6169bef/scripts/config_preflight.py --profile security_diff_scan` returned `status: incomplete` (`delegated_workers=unknown`, `goal_tools=unknown`; `goals_enabled` passed). Reported explicitly as an incomplete automated preflight; manual diff inspection plus runtime probes and mutants covered `e85890bd` and `4183df6c`.
- **Security summary**:
  - `4183df6c`: Closes the R17 `DOUBLE_SIGINT` `SIG_DFL` kill window (confirmed live), guarantees registered teardowns stop Metro's process group and simulator `log stream` once per exit path including `SIGINT`/`SIGTERM`, avoids leaking raw details in the pre-write stdout verdict, and exercises the live driver in subprocess tests. Remaining P3 edges are single-shot `alive(pid)` reaping race / missing `t.after` cleanup in the driver test, missing `spawnSync` timeout in `adb-reverse` teardown, and scan-vs-teardown ordering.
  - `e85890bd`: Explicitly documents the uncatchable `SIGKILL` / `spawnSync`-hang boundary in the test design and states that no CI workflow uploads Test Store evidence without an `always()` leak scan.

---

## Executed Suites, Probes & Mutants

| Target                                                        | Scope / Command                                           | Observed Result                                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `wt-615` HEAD (`4183df6c`)                                    | `node --test scripts/lib/test-store-*.test.mjs`           | **69/69 pass, 0 fail** (`3.11s`)                                                                                                     |
| `wt-615` (`4183df6c` runtime probe, `/tmp/wt-615-mutant-r18`) | `DOUBLE_SIGINT_AND_SIGTERM` during slow `quarantineLeaks` | `{"code":130,"signal":null,"remaining":[]}` (both files quarantined, exit 130)                                                       |
| `wt-615` mutants (`/tmp/wt-615-mutant-r18`)                   | Baseline pass + 8 mutants (`C24`–`C30`)                   | **6 KILLED**, **2 SURVIVED** (`C26` `onExit` scan-before-teardown order untested; `C30` Android `adb-reverse` `proxy.port` untested) |

REVIEW-615-R18-DONE
