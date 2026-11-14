# Review Round 16 — PR/Handover #615 (`tea615`)

Target reviewed (strictly read-only across repo worktrees; probes and mutants executed only in detached `/tmp/wt-615-mutant-r16` with `node_modules` symlinked, removed and pruned immediately after):

- **Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615`, range `e3c48f65..0007d4f2`:
  - `3eae1225`: `scripts/ci/workflow-node-deps.mjs`, `scripts/ci/workflow-node-deps.test.mjs`
  - `0007d4f2`: `scripts/lib/test-store-output.mjs`, `scripts/lib/test-store-output.test.mjs`

All three actionable R15 Part A probes (`<<\EOF`, `<<'E'OF`, `cd` before `node` stdin) now pass, all 7 mutants (`A9`–`A11`, `C15`–`C18`) were **KILLED**, and `88/88` tests pass in `445.0ms`. No `P0`–`P2` issues found; two `P3` findings cover the remaining edge cases.

---

## Findings (P0–P3)

### P3 — Part A: Appending `STDIN_MARK` to the line end (`line 506`) and skipping `nodeCommand` on `if (stdin)` (`lines 549-551`) miss trailing comments, pipes, and preload flags on `node` heredocs (`scripts/ci/workflow-node-deps.mjs:503-508, 545-552`)

- **Closure verification (`3eae1225`)**:
  - `R15-FN-backslash-heredoc-delimiter` => `["scripts/a.mjs:yaml"]` (`A9` **KILLED**)
  - `R15-FN-mixed-quote-heredoc-delimiter` => `["scripts/a.mjs:yaml"]` (`A10` **KILLED**)
  - `R15-FN-cd-before-heredoc-relative-import` => `["apps/x/a.mjs:yaml"]` (`A11` **KILLED**)
  - `R15-FN-multiline-string-looks-like-heredoc` => `[]` (explicitly recorded limitation of per-line heredoc splitting)
- **Three `STDIN_MARK` edge cases observed with live probes**:
  1. **Trailing `# comment` (`workflow-node-deps.mjs:506`)**: `kept[kept.length - 1] = `${header} ${STDIN_MARK}${nodeCode.length}``appends the marker *after*`# ...`, so `commands(text)` strips it as part of the comment.
     - **Concrete failure scenario (`R16-FN-heredoc-followed-by-comment => []`)**: `node --input-type=module <<'EOF' # inline comment\nimport 'yaml'\nEOF` loses its marker and returns `[]`.
  2. **Piped or chained command after `node <<'EOF'` (`workflow-node-deps.mjs:506`)**: Appending to the end of `header` attaches `STDIN_MARK` to the last command in a pipeline (`tee out.log`), not `opened.command` (`node <<'EOF'`).
     - **Concrete failure scenario (`R16-FN-heredoc-piped-to-tee => []`)**: `node --input-type=module <<'EOF' | tee out.log\nimport 'yaml'\nEOF` attaches `@@node-stdin:0` to `tee out.log`, so `node` never runs `stdinLoads` and returns `[]`. (Replacing `opened.command` inside `header`—before comments/pipes—fixes both.)
  3. **Preload flag alongside a `node` heredoc (`workflow-node-deps.mjs:549-551`)**: `if (stdin) stdinLoads(...) else nodeCommand(...)` skips `nodeCommand`, ignoring `-r`/`--require`/`--import` preloads on the same invocation.
     - **Concrete failure scenario (`R16-FN-heredoc-with-preload-flag => []`)**: `node -r yaml <<'EOF'\nconsole.log(1)\nEOF` enters the `if (stdin)` branch, skips `nodeCommand`, and misses `'yaml'`.

---

### P3 — Part C: Quarantine collision/failure/unlink trade-offs and `failures[0]` masking (`scripts/lib/test-store-output.mjs:154-207`)

- **Closure verification (`0007d4f2`)**:
  - `C15` (remove `${RUN_ID}-${quarantined}` from `quarantineTarget`) -> **KILLED** (exit 1)
  - `C16` (drop `removeFromEvidence` in `EXDEV` `copyFile`/`chmod`/`symlink` `catch`) -> **KILLED** (exit 1)
  - `C17` (drop `removeFromEvidence` on non-`EXDEV` `rename` failure) -> **KILLED** (exit 1)
  - `C18` (swallow `unlink` error in `removeFromEvidence`) -> **KILLED** (exit 1)
- **Three explicit judgments**:
  1. **Unlinking on failure losing triage evidence (`lines 160-161, 171-172`)**: Yes — when `rename` (non-`EXDEV`) or `EXDEV` `copyFile`/`chmod`/`symlink` fails, `removeFromEvidence(from, ops)` deletes `from` before rethrowing, discarding the only copy of that leaked evidence file. **This is the right security trade**: `dirs.evidence` feeds an `if: always()` CI artifact upload, whereas primary triage data (`device.log`, `metro.log`, Maestro debug output, `*.member.json`) is already written separately to `<out>.private/`. Preventing secrets from reaching uploaded artifacts outweighs keeping a redundant leaking file.
  2. **`RUN_ID` collision risk across concurrent runs (`lines 178-184`)**: Safe within a process (`quarantined += 1`) and across concurrent processes on one OS host (live processes have distinct `process.pid` values plus millisecond timestamp and ~31 bits of `Math.random()`). A theoretical collision would require two isolated PID namespaces (where both get the same PID) sharing a persisted host `--out` directory within the same millisecond (`crypto.randomUUID()` would remove even that edge).
  3. **Remaining leak paths between scan and upload**: Within `writeRunOutputs`, none in normal execution (`quarantineLeaks` runs first, serialized `report` is checked in memory before `writeEvidence`, `assertEvidenceClean` runs immediately after, and failed moves call `removeFromEvidence` or throw `test_store_quarantine_failed`). Two minor diagnostic/harness edges remain:
     - **`failures[0]` masking (`test-store-output.mjs:205`)**: If entry A fails `copyFile` (unlinked cleanly, pushing `ENOSPC`) and entry B fails `removeFromEvidence` (`test_store_quarantine_failed`), `throw failures[0]` reports `ENOSPC` instead of surfacing that B stays in `dirs.evidence` (CI still exits nonzero, only hiding B from the error message).
     - **Uncaught crash / external writer between runs**: No top-level `finally` in `scripts/run-test-store-journey.mjs` calls `assertEvidenceClean`, so if an uncaught exception occurred after another step wrote a secret into `--out`, or an external process dropped a secret into `--out` after `writeRunOutputs`, it would not be scanned before `upload-artifact` (today `writeArtifactManifests` at `line 423` writes only git/artifact hashes).

---

## Codex Security Diff-Scan Assessment

- **Preflight & scope limit**: `python3 /Users/murat/.codex/plugins/cache/openai-curated/codex-security/d6169bef/scripts/config_preflight.py --profile security_diff_scan` returned `status: incomplete` (`delegated_workers=unknown`, `goal_tools=unknown`; `goals_enabled` passed). Reported explicitly as an incomplete automated preflight; manual diff inspection and mutant/probe verification covered `3eae1225` and `0007d4f2`.
- **Security summary**:
  - `0007d4f2`: Closes the R15 `EXDEV` `EEXIST` symlink collision and guarantees any move/copy/chmod failure either unlinks the leaking source from `dirs.evidence` or fails loudly with `test_store_quarantine_failed` naming the remaining file.
  - `3eae1225`: Closes `<<\EOF`, mixed-quote delimiters, and post-`cd` stdin heredoc resolution cleanly; only minor P3 gaps are trailing `# comments`, pipes, or `-r` preloads combined with `node <<EOF`.

---

## Executed Suites, Probes & Mutants

| Target                                                 | Scope / Command                                                                        | Observed Result                                                                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `wt-615` HEAD (`0007d4f2`)                             | `node --test scripts/ci/workflow-node-deps.test.mjs scripts/lib/test-store-*.test.mjs` | **88/88 pass, 0 fail** (`445.0ms`)                                                                                                                           |
| `wt-615` (`3eae1225` probes, `/tmp/wt-615-mutant-r16`) | 4 R15 probes + 3 R16 `STDIN_MARK`/preload probes                                       | R15 `<<\EOF`, `<<'E'OF`, and `cd`+stdin all flagged cleanly; documented multi-line string limit and 3 R16 `comment`/`pipe`/`-r` heredoc probes returned `[]` |
| `wt-615` mutants (`/tmp/wt-615-mutant-r16`)            | Baseline pass + 7 mutants (`A9`–`A11`, `C15`–`C18`)                                    | **7/7 KILLED** (exit 1)                                                                                                                                      |

REVIEW-615-R16-DONE
