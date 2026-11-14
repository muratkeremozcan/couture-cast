# Review Round 15 — PR/Handover #615 (`tea615`)

Target reviewed (strictly read-only across repo worktrees; probes and mutants executed only in detached `/tmp/wt-615-mutant-r15` with `node_modules` symlinked, removed and pruned immediately after):

- **Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615`, range `c95c608d..570b933b` (note: local `HEAD` `c4ee0d99` only merges `origin/main` for `apt-install.test.mjs` and `node-test-gate.*`; `workflow-node-deps.*` and `test-store-*` are unchanged since `570b933b`):
  - `1c6cfb8d`: `scripts/ci/workflow-node-deps.mjs`, `scripts/ci/workflow-node-deps.test.mjs`
  - `570b933b`: `scripts/lib/test-store-output.mjs`, `scripts/lib/test-store-output.test.mjs`

All Round 14 `R14-FN` probes (`comment-double-lt`, `hyphen-heredoc`, `heredoc-relative-import`) now detect their package loads cleanly, `84/84` tests pass in `418.2ms`, and `8` of `9` mutants were **KILLED** (`A7-drop-herestring-<<<-guard` survived because `delimiterAt` already rejects `<`). No `P0`–`P2` issues found; two `P3` findings cover the remaining edge cases.

---

## Findings (P0–P3)

### P3 — Part A: Backslash-quoted heredoc delimiters (`<<\EOF`), multi-line quoted strings, and `cd` before `node` stdin still evade or swallow steps (`scripts/ci/workflow-node-deps.mjs:438-498, 501-531`)

- **Closure verification (`1c6cfb8d`)**:
  - `R14-FN-comment-double-lt-swallows-next-node` => `["scripts/a.mjs:yaml"]` (closed)
  - `R14-FN-hyphen-heredoc-swallows-next-node` => `["scripts/a.mjs:yaml"]` (closed)
  - `R14-FN-heredoc-relative-import` => `["scripts/a.mjs:yaml"]` (closed)
  - Mutants `A5` (drop quote tracking in `heredocMarker`), `A6` (revert `delimiterAt` word regex to `\w+`), and `A8` (drop relative imports in `stdinLoads`) were all **KILLED** (exit 1).
  - Mutant `A7` (remove `command[i + 2] !== '<' && command[i - 1] !== '<'` in `heredocMarker`) **SURVIVED** (exit 0): on `cat <<< "here string"` (`cat <<<EOF` alike), `command.startsWith('<<', i)` triggers on the first `<<`, `delimiterAt` sees `<` at `i + 2`, and `delimiterAt` already returns `null` directly (`heredocMarker` returns `null` before advancing to `i + 1`).
- **Can a delimiter edge still swallow a `node` command? Yes (2 concrete cases reproduced live)**:
  1. **Backslash-escaped delimiter (`workflow-node-deps.mjs:447-448`, `delimiterAt`)**: `/^[^\s<>|&;()'"]+/` keeps backslashes intact, so `cat <<\EOF` produces `word: '\\EOF'` instead of unescaping to `'EOF'`. `heredocs` looks for `line === '\\EOF'`, never matches the closing `EOF`, and drops all subsequent lines in the step (`R15-FN-backslash-heredoc-delimiter => []`). (Same applies to mixed concatenation like `<<'E'OF`.)
     - **Concrete failure scenario**: A pre-install workflow `run:` block runs `cat <<\EOF\nhello\nEOF\nnode scripts/a.mjs` where `scripts/a.mjs` imports `'yaml'`; `heredocs` swallows `node scripts/a.mjs` and the guard reports `[]`.
  2. **Multi-line quoted string spanning a `<<WORD` line (`workflow-node-deps.mjs:480-496`, `heredocs`)**: `heredocs` splits on `\n` and inspects each line independently. A line inside a multi-line quoted string containing `cat <<EOF` without quotes on that line opens a phantom heredoc and swallows the rest of the step (`R15-FN-multiline-string-looks-like-heredoc => []`).
- **Additional `stdinLoads` `cd` gap (`workflow-node-deps.mjs:501-510, 526-531`)**: `stdinLoads(root, cwd, nodeCode, loads)` resolves relative imports inside `node <<'EOF'` against the step's initial `cwd` before the command loop processes `cd apps/x` (`R15-FN-cd-before-heredoc-relative-import => []`).

---

### P3 — Part C: `EXDEV` symlink quarantine fails with `EEXIST` if `--out` is reused, and `EXDEV` copy/unlink errors leave the source in `dirs.evidence` (`scripts/lib/test-store-output.mjs:130-142, 150-156`)

- **Closure verification (`570b933b`)**:
  - Mutants `C10` (skip `quarantineLeaks` before throwing on leaking `report`), `C11` (drop `EXDEV` fallback), `C12` (drop `chmodSync(to, 0o600)`), `C13` (drop symlink check in `EXDEV`), and `C14` (stop reporting non-regular/symlink entries in `scanForLeaks`) were all **KILLED** (exit 1).
- **Quarantine judgments**:
  1. **Can the `EXDEV` copy leave a readable copy behind on failure (partial copy, unlink failing)?**
     - If `fs.copyFileSync(from, to)` fails partway (e.g., `ENOSPC`/`EIO`), or `fs.chmodSync(to, 0o600)` / `fs.unlinkSync(from)` fails (`lines 137-140`), `from` remains untouched inside `dirs.evidence` (readable there, and reachable by a subsequent `if: always()` upload), while any partial/un-chmodded `to` stays inside `<private>/quarantine` (protected by `mode 0o700` on `<private>` and `quarantine`).
     - During the narrow window between `copyFileSync` and `chmodSync`, `to` briefly holds process-umask permissions under the `0o700` quarantine directory.
     - **Reproduced `EXDEV` symlink collision (`test-store-output.mjs:135`)**: When a symlink (`link`) is quarantined across mounts into a reused `--out` directory whose `<private>/quarantine/link` already exists from a prior failed run, `fs.symlinkSync(fs.readlinkSync(from), to)` throws `EEXIST` (`unlinkSync` is never reached), leaving `link` inside `dirs.evidence`. **Concrete failure scenario (`EXDEV_EXISTING_SYMLINK_ERROR: EEXIST`)**: Re-running a failing journey with `--out` on a separate mount leaves the non-regular symlink entry inside `dirs.evidence` for an always-run upload. Removing any stale `to` before `symlinkSync` (or staging via temp name + `unlinkSync(from)`) avoids `EEXIST`.
  2. **Can a symlink in `evidence` point the quarantine or the copy outside the `private` dir?**
     - **No (for entries in `dirs.evidence`)**: `scanForLeaks` (`lines 108-120`) walks using `readdirSync(..., { withFileTypes: true })` (`lstat` semantics), never traverses or `readFileSync`s symlinks, and classifies every symlink (`entry.isDirectory()` / `entry.isFile()` both `false`) as `kind: 'non-regular'`. `quarantineLeaks` builds `target` exclusively from real directory components under `dirs.evidence` joined beneath `privatePath(dirs, 'quarantine')`, and `moveAcrossMounts` (`lines 132, 135`) moves or recreates the symlink entry itself using `readlinkSync(from)` as symlink data rather than dereferencing it as a destination path.

---

## Codex Security Diff-Scan Assessment

- **Preflight & scope limit**: `python3 /Users/murat/.codex/plugins/cache/openai-curated/codex-security/d6169bef/scripts/config_preflight.py --profile security_diff_scan` returned `status: incomplete` (`delegated_workers=unknown`, `goal_tools=unknown`; `goals_enabled` passed). Reported explicitly as an incomplete automated preflight; manual diff inspection and mutant/probe verification covered every line of `1c6cfb8d` and `570b933b`.
- **Security summary**:
  - `570b933b`: Eliminates the R14 un-quarantined pre-existing leak path when `report` also leaks, isolates symlinks without traversal (`lstat`/`isSymbolicLink` + `non-regular`), and adds `EXDEV` cross-mount copying (`mode 0o600`). Only P3 residuals are `EXDEV` copy/unlink error leftovers and `EEXIST` on reused symlink quarantine targets.
  - `1c6cfb8d`: Strengthens pre-install CI import scanning across `#` comments, quoted `<<`, `<<<` here-strings, hyphenated delimiters, and relative stdin imports; P3 residuals are `<<\EOF` backslash-escaped delimiters, multi-line strings containing `<<EOF`, and `cd` before stdin heredocs.

---

## Executed Suites, Probes & Mutants

| Target                                                 | Scope / Command                                                                        | Observed Result                                                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wt-615` HEAD (`570b933b` / `c4ee0d99`)                | `node --test scripts/ci/workflow-node-deps.test.mjs scripts/lib/test-store-*.test.mjs` | **84/84 pass, 0 fail**                                                                                                                                                            |
| `wt-615` (`1c6cfb8d` probes, `/tmp/wt-615-mutant-r15`) | 3 R14 probes + 3 R15 probes                                                            | All 3 R14 probes (`comment-double-lt`, `hyphen-heredoc`, `heredoc-relative-import`) flagged cleanly; `<<\EOF`, multi-line string `cat <<EOF`, and `cd` before stdin returned `[]` |
| `wt-615` mutants (`/tmp/wt-615-mutant-r15`)            | Baseline pass + 9 mutants (`A5`–`A8`, `C10`–`C14`)                                     | **8 KILLED**, **1 SURVIVED** (`A7` `<<<` guard redundant because `delimiterAt` rejects leading `<`)                                                                               |
| `wt-615` `EXDEV` symlink probe                         | `assertEvidenceClean` (`EXDEV` rename) when `<private>/quarantine/link` exists         | `EEXIST` thrown; `link` remained in `dirs.evidence` (`['link']`)                                                                                                                  |

REVIEW-615-R15-DONE
