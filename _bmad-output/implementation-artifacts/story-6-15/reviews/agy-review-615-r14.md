# Review Round 14 — PR/Handover #615 (`tea615`)

Target reviewed (strictly read-only across repo worktrees; probes and mutants executed only in detached `/tmp/wt-615-mutant-r14` with `node_modules` symlinked, removed and pruned immediately after):

- **Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615`, range `dc3be089..4c70fe29`:
  - `cedcd1be`: `scripts/ci/workflow-node-deps.mjs`, `scripts/ci/workflow-node-deps.test.mjs`
  - `78864688`: `scripts/ci/android-native-workflow.test.mjs`
  - `0ae598dd`: `scripts/lib/test-store-output.mjs`, `scripts/lib/test-store-output.test.mjs`
  - `4c70fe29`: `scripts/lib/test-store-journey.test.mjs`, `scripts/lib/test-store-runner.test.mjs`

All four Round 13 closures verified cleanly: **all 10 mutants (`A1`–`A4`, `B1`–`B2`, `C6`–`C9`) were killed**, **all 6 non-factory R13 Part A probes now detect their package loads**, and the full requested suite passed (`153/153 pass, 0 fail`). No `P0`, `P1`, or `P2` issues found; four `P3` findings remain.

---

## Findings (P0–P3)

### P3 — Part C: Early throw on a leaking `report` skips `assertEvidenceClean`, and bare `fs.renameSync` lacks an `EXDEV` fallback (`scripts/lib/test-store-output.mjs:109-111, 129-134, 147-152`)

- **Closure verification (`0ae598dd`, `4c70fe29`)**:
  - `C6` (write report before scanning in `writeRunOutputs`) -> **KILLED** (`test-store-output.test.mjs:134`).
  - `C7` (drop quarantine `fs.renameSync` move) -> **KILLED** (`test-store-output.test.mjs:156`).
  - `C8` (drop `assertNoForwardedRefresh` on `unpaid-failure`, R13 `C4b` survivor) -> **KILLED** by `a refresh during the unpaid failure fails that step` (`test-store-runner.test.mjs:445-451`).
  - `C9` (bump `MESSAGE_CAP = 300` -> `800`, R13 `C3b` survivor) -> **KILLED** by pinned `303`-char check (`test-store-journey.test.mjs:436-439`).
- **Judgment of the quarantine move**:
  1. **A file it misses (early return in `writeRunOutputs`, `test-store-output.mjs:148-151`)**: If `leaksInText(text, needles).length` is nonzero, line 149 throws `test_store_evidence_leak` immediately **before** line 151 calls `assertEvidenceClean(dirs, needles)`.
     - **Concrete failure scenario (reproduced)**: Another leaking file `preexisting.json` is present under `dirs.evidence`, and `report` also leaks `member.userId`. `writeRunOutputs` throws `test_store_evidence_leak: rep.json (not written)` and leaves `preexisting.json` un-quarantined inside `dirs.evidence` (`REMAINING_LEAKS_IN_EVIDENCE: [{"file":"preexisting.json","needle":"member-secret-1234"}]`), where an `if: always()` artifact upload step would pick it up. Running `assertEvidenceClean` in a `try/finally` (or before throwing for `report`) avoids skipping `dirs.evidence`.
  2. **Rename across devices (`EXDEV`, `test-store-output.mjs:15-17, 132`)**: `outputDirs(out)` places `private` at `${path.resolve(out)}.private` (sibling in the parent directory). Whenever `--out` is a normal subdirectory under one volume, `evidence` and `private` share a device and `fs.renameSync` is atomic. However, if `--out` itself is a mount point / dedicated tmpfs volume (`evidence` on mount A, parent dir `out.private` on mount B) or `assertEvidenceClean` receives `dirs` spanning mounts, `fs.renameSync` (`line 132`) throws `EXDEV` **before** removing the leaked file from `dirs.evidence` and before throwing `JourneyError`.
  3. **Race with an upload**: No race exists for `report` itself (now refused in memory without touching `dirs.evidence`), nor between sequential GitHub Actions steps (`run-test-store-journey.mjs` finishes `assertEvidenceClean` before exiting into an `if: always()` upload step). A race only exists if an external watcher syncs `--out` concurrently during execution or if an unhandled exception aborts `scripts/run-test-store-journey.mjs` after files exist in `--out` (e.g., lines 423–467) without reaching `writeRunOutputs`.
  4. **Directory symlinks (`test-store-output.mjs:109-111`)**: `entry.isDirectory()` is `false` for symlinks on POSIX; a symlinked directory under `dirs.evidence` falls into `fs.readFileSync(file)` (`line 111`) and fails with `EISDIR` instead of being skipped or traversed.

---

### P3 — Part A: `<<WORD` in a comment or hyphenated heredoc delimiter swallows subsequent `node` steps; heredoc relative imports not followed (`scripts/ci/workflow-node-deps.mjs:441-480`)

- **Closure verification (`cedcd1be`)**:
  - `R13-FN-aliased-createRequire-import` => `["scripts/a.mjs:yaml"]` (mutant `A1` **KILLED**).
  - `R13-FN-destructured-createRequire` => `["scripts/a.mjs:yaml"]` (mutant `A2` **KILLED**).
  - `R13-FN-namespace-read-createRequire` (`const cr = mod.createRequire`) => `["scripts/a.mjs:yaml"]` (mutant `A3` **KILLED**).
  - `R13-FN-heredoc-node-stdin` => `["(inline):yaml"]` (mutant `A4` **KILLED**).
  - `R13-FN-node-e-single-quotes-with-dollar` => `["(inline):yaml"]`; `R13-FN-process-getBuiltinModule` => `["scripts/a.mjs:yaml"]`.
- **Remaining edge cases observed with live probes**:
  1. **Comment `<<WORD` (`workflow-node-deps.mjs:448-456`)**: `/<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/.exec(header)` matches `# note <<EOF` inside a shell comment and drops every line through `EOF` (or EOF of the `run` block) from `kept`. **Concrete failure scenario (`R14-FN-comment-double-lt-swallows-next-node => []`)**: A pre-install step with `# note <<EOF\nnode scripts/a.mjs` (where `scripts/a.mjs` imports `'yaml'`) swallows `node scripts/a.mjs` and passes silently.
  2. **Hyphenated heredoc delimiter (`workflow-node-deps.mjs:448`)**: `[A-Za-z_]\w*` stops before `-`, so `cat <<END-OF-MSG` sets `match[3] = 'END'`. The `while` loop checks `line === 'END'`, never matches `'END-OF-MSG'`, and consumes all remaining commands in the `run` block. **Concrete failure scenario (`R14-FN-hyphen-heredoc-swallows-next-node => []`)**: `cat <<END-OF-MSG\nhello\nEND-OF-MSG\nnode scripts/a.mjs` drops `node scripts/a.mjs` from `text` and reports `[]`.
  3. **Relative imports inside heredocs (`workflow-node-deps.mjs:478-480`)** and **wrapper factories (`line 45-75`)**: `node --input-type=module <<'EOF'\nimport './scripts/a.mjs'\nEOF` (`R14-FN-heredoc-relative-import => []`) only checks `!allowed(s)` on inline specifiers without traversing relative files, and helper functions returning `createRequire(...)` (`R13-FN-wrapper-helper-returning-createRequire => []`) stay unmodeled (low risk in CI scripts).

---

### P3 — Part B: No-trap leak check (`78864688`) cannot practically flake (`scripts/ci/android-native-workflow.test.mjs:367-480`)

- **Closure verification (`78864688`)**:
  - `expectLeak: true` sets `deadline = 0` (`line 447`), reading `alive(child)` immediately without a 5s burn (`418.2ms` total vs `5341ms` in R13).
  - Tarpit `node` stub lives `30s` (`line 389`), matching `npx` (`line 395`).
  - `node` and `npx` write `$$` to `${dir}/stub-pids` and `finally` (`lines 454-465`) `SIGKILL`s all `leftovers` (`child` + `stub-pids`). Verified `pgrep -fl '/bin/sleep 30'` returned `''` after test execution.
  - Mutants `B1` (keep trap in negative test) and `B2` (tarpit exits 0) were both **KILLED**.
- **Judgment on whether the no-trap test can now flake**:
  - **No realistic flake path**: Atomic rename `metro-child.tmp -> metro-child` guarantees `curl` waits until `/bin/sleep 30 &` exists; `script.log` file stdio prevents `spawnSync` from waiting on inherited pipes; `expectLeak: true` reads `process.kill(child, 0)` immediately on return (`~418ms` wall time vs `30s` sleep); POSIX `#!/bin/sh` (`dash` on Ubuntu and `sh` on macOS) preserves backgrounded `/bin/sleep 30 &` across `exec /bin/sleep 30`, and `bash` non-interactive `set -m` does not `SIGHUP` it on exit. Only an extreme `>30s` host pause inside that `0.4s` stub run could expire `/bin/sleep 30` before `alive(child)` executes.

---

## Codex Security Diff-Scan Assessment

- **Preflight & scope limit**: `python3 /Users/murat/.codex/plugins/cache/openai-curated/codex-security/d6169bef/scripts/config_preflight.py --profile security_diff_scan` returned `status: incomplete` because `delegated_workers` and `goal_tools` are `unknown` in this harness (`goals_enabled` passed). Reported explicitly as an incomplete automated plugin preflight rather than claiming exhaustive multi-agent coverage; manual security review + mutant/probe verification covered every file in `dc3be089..4c70fe29`.
- **Security summary**:
  - `0ae598dd`: Eliminates the leaking report write to `dirs.evidence` and quarantines pre-existing leaking files into `<out>.private/quarantine` (`mode 0o700`); remaining P3 hygiene item is ensuring `assertEvidenceClean` still runs when the in-memory `report` check throws (plus `EXDEV` fallback on `renameSync`).
  - `4c70fe29`: Closes test coverage gaps on `unpaid-failure` forwarded refresh leakage and numeric `MESSAGE_CAP` redaction ceiling.
  - `cedcd1be`: TypeScript parser (`ts.createSourceFile`) runs read-only with no eval/execution; closes R13 `createRequire` obfuscation/alias bypasses; P3 heredoc edge cases noted above.
  - `78864688`: Test-only stubbing; no production code or secrets touched.

---

## Executed Suites, Probes & Mutants

| Target                                                 | Scope / Command                                                                                                                    | Observed Result                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `wt-615` HEAD (`4c70fe29`)                             | `node --test scripts/ci/workflow-node-deps.test.mjs scripts/ci/android-native-workflow.test.mjs scripts/lib/test-store-*.test.mjs` | **153/153 pass, 0 fail** (`no-trap` test `418.2ms`, `pass` test `538.4ms`)                                                              |
| `wt-615` (`cedcd1be` probes, `/tmp/wt-615-mutant-r14`) | 7 R13 probes + 3 R14 heredoc probes                                                                                                | All 6 non-factory R13 probes flagged cleanly; factory + comment `<<EOF` + hyphen `<<END-OF-MSG` + heredoc relative import returned `[]` |
| `wt-615` mutants (`/tmp/wt-615-mutant-r14`)            | Baseline pass + 10 mutants (`A1`–`A4`, `B1`–`B2`, `C6`–`C9`)                                                                       | **10/10 KILLED** (exit 1); `LINGERING_SLEEP_30: ''`                                                                                     |
| `wt-615` leak probe (`/tmp/wt-615-mutant-r14`)         | `writeRunOutputs` with leaking `report` + preexisting leaking file in `dirs.evidence`                                              | `THROWN: test_store_evidence_leak` left `preexisting.json` un-quarantined in `dirs.evidence`                                            |

REVIEW-615-R14-DONE
