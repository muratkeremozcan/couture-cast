# Antigravity Review — Story 6.15 Round 26 (`bcc7f536..b3ede2bb`)

- **Worktree:** `/Users/murat/opensource/cc/couture-cast-wt-615` (read-only; mutants/probes ran in detached `/tmp/wt-615-mutant-r26`, now removed and pruned)
- **Target commits:** `431378e5` (`docs(story-6.15): record the missing-subtree limit of the evidence manifest`) and `b3ede2bb` (`fix(evidence): verify the commit before reading an object id`)
- **Automated suite after cleanup:** `node --test scripts/lib/evidence-manifest*.test.mjs scripts/lib/test-store-*.test.mjs` — **127 passed, 0 failed, 0 skipped**
- **Verdict:** **The range `bcc7f536..b3ede2bb` is clear** — nothing above **P3** remains, and both Round 25 P3s (`M1`, `M4a`) plus `431378e5` are closed and killed by tests.

## Findings (P0–P3)

No **P0**, **P1**, or **P2** findings remain. Two minor **P3** notes:

### P3-1: Process-lifetime `verifiedCommits` memo can go stale if a repository at the same path is GC'd or re-cloned shallow in the same process

- **Location:** `scripts/lib/evidence-manifest.mjs:162-169` (`verifyCommit`)
- **Concrete failure scenario (reproduced in Probe `3a`):** In one long-lived Node process importing `scripts/lib/evidence-manifest.mjs`, `objectId(c1, 'a.mjs', workDir)` adds `${path.resolve(workDir)}\0${c1}` to the module-level `verifiedCommits` `Set`. If `workDir` is subsequently pruned via `git gc --prune=now` (for an unreachable commit) or replaced in-place with a `--depth=1` shallow clone lacking `c1`, a later `objectId(c1, 'a.mjs', workDir)` in that same process hits `verifiedCommits`, skips `revParse`, executes `git rev-parse --verify --quiet <c1>:a.mjs` (which exits `1` with empty `stdout`/`stderr`), and returns `null` instead of throwing `evidence_git_failed`.
- **Context / severity rationale:** Both CLI commands (`write`, `verify`) and normal test fixtures use one repository snapshot per process or distinct `mkdtempSync` paths, so this is non-blocking (`P3`).

### P3-2: No unit test fails if `verifyCommit` accidentally caches mutable refs (such as `HEAD`)

- **Location:** `scripts/lib/evidence-manifest.mjs:168` (`verifyCommit`), `scripts/lib/evidence-manifest.test.mjs`
- **Mutant evidence:** `M_cache_mutable_ref` (replacing `if (revParse(rev, cwd) === rev) verifiedCommits.add(key)` with unconditional `revParse(rev, cwd); verifiedCommits.add(key)`) exited `0` (`0` failures) in `scripts/lib/evidence-manifest.test.mjs`.
- **Concrete failure scenario:** A future refactor dropping the `=== rev` guard would allow `verifyCommit('HEAD', dir)` to cache `'HEAD'` once and keep skipping `revParse('HEAD', dir)` if the worktree switched to an unborn branch or corrupt `HEAD` later in the same process.

---

## Verification Summary

### 1. Closure Mutants (Detached `/tmp/wt-615-mutant-r26`)

| Mutant                        | Target                      | Result                | Failing Test(s)                                                                                                                       |
| ----------------------------- | --------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `M1_objectId_ignore_stderr`   | `evidence-manifest.mjs:181` | **KILLED** (`exit 1`) | `objectId throws on exit 1 with stderr, leaving the stderr text out`                                                                  |
| `M4a_revParse_no_commit_peel` | `evidence-manifest.mjs:154` | **KILLED** (`exit 1`) | `objectId on a commit a shallow clone lacks throws...`; `a manifest revision peels an annotated tag to its commit and refuses a tree` |
| `M_no_verifyCommit`           | `evidence-manifest.mjs:178` | **KILLED** (`exit 1`) | `objectId on a commit a shallow clone lacks throws; a missing path under it is null`                                                  |
| `M_cache_no_cwd_key`          | `evidence-manifest.mjs:166` | **KILLED** (`exit 1`) | `objectId on a commit a shallow clone lacks throws; a missing path under it is null`                                                  |
| `M_cache_failures`            | `evidence-manifest.mjs:168` | **KILLED** (`exit 1`) | `objectId on a commit a shallow clone lacks throws; a missing path under it is null`                                                  |
| `M_cache_mutable_ref`         | `evidence-manifest.mjs:168` | Survived (`exit 0`)   | — (`P3-2`)                                                                                                                            |

### 2. Probes

- **Uppercase SHA (`upperC1`) & abbreviated SHA (`shortC1`):** Both passed against the full clone (`objectId` returned `e14c4f...`) and were **not** cached because `revParse` returned lowercase full hex (`!== rev`). After replacing `workDir` in-place with a `--depth=1` shallow clone lacking `c1`, both `upperC1` and `shortC1` re-ran `revParse` and threw `evidence_git_failed:rev-parse:exit_128`.
- **Same-path shallow re-clone with lowercase full SHA (`c1`):** Because `verifiedCommits` cached `<resolvedDir>\0<c1>` from the earlier full-clone call in the same Node process, `objectId(c1, 'a.mjs', workDir)` returned `null` after the shallow replacement (`P3-1`).
- **Direct `importClosure(['a.mjs'], c1, shallowWork)` without calling `revParse` first:** Because `show()` does not call `verifyCommit`, `git show <c1>:a.mjs` matched `NOT_AT_REV` (`fatal: path 'a.mjs' exists on disk, but not in '<c1>'`), causing `importClosure` to throw `evidence_manifest_entry_missing:a.mjs` instead of `evidence_git_failed:rev-parse:exit_128` (fails loudly rather than returning absent).

---

## Judgment Questions

1. **Can the memo go stale (commit removed by `gc` or re-clone at the same path in one process, uppercase or abbreviated SHA)?**
   - **Uppercase / abbreviated SHA:** **No.** `verifyCommit` checks `revParse(rev, cwd) === rev` (`evidence-manifest.mjs:168`); `git rev-parse --verify` always emits lowercase full hex (`40` or `64` chars), so uppercase or abbreviated inputs never enter `verifiedCommits` and are re-verified on every call (verified by probes `2a/2b`, `3b/3c`). Mutable refs (`HEAD`, branch names, tags) likewise never equal their resolved OID and are never cached.
   - **In-place `gc` or shallow re-clone at the same resolved `cwd` in one process:** **Yes** (`P3-1`, reproduced by probe `3a`). Because `verifiedCommits` is a process-wide `Set`, removing a previously verified full SHA from the same `path.resolve(cwd)` in the same process lets a subsequent `objectId(sha, ...)` skip `revParse` and read exit `1` as `null`. Safe for single-shot CLI invocations and isolated per-test repos.

2. **Is anything left in the manifest path that reads a failure as absent?**
   - **No, on the manifest path (`writeManifest`, `changedInputs`, `uncoveredReads`, CLI `write`/`verify`),** beyond the missing-subtree object-store limit already recorded in `431378e5` (`_bmad-output/test-artifacts/test-design/cc615-expo-sdk58-live-font-scale-test-design.md:391-394`). Every manifest entrypoint calls `revParse(rev, cwd)` before invoking `legInputs`, `importClosure`, `objectId`, or `show`, and every `git` helper (`git`, `objectId`, `show`, `globFiles`, `dirtyInputs`) throws `evidence_git_failed` on non-zero/timeout/malformed output except exact absent-path exits under an existing commit. (Outside the manifest path, direct calls to exported `importClosure`/`legInputs` skip `verifyCommit` and raise `evidence_manifest_entry_missing` rather than `evidence_git_failed` on a shallow-missing commit with on-disk entry files, as seen in Probe `4a`.)

---

## Codex Security Review (`~/.codex/skills/codex-security-review/SKILL.md`)

- `config_preflight.py --profile security_diff_scan` exited `2` with `status: "incomplete"` (`delegated_workers` and `goal_tools` `unknown` in this harness).
- Manual security diff review of `bcc7f536..b3ede2bb` (`scripts/lib/evidence-manifest.mjs:145-185`): all `git` subprocess arguments remain fixed arrays without shell interpolation, `GIT_TIMEOUT_MS` remains strictly bounded via `boundOf`, error strings never leak raw `git` stderr/stdout (`objectId throws on exit 1 with stderr, leaving the stderr text out` confirmed), and `verifiedCommits` keys on `path.resolve(cwd ?? '.') + '\0' + rev` using only exact `revParse(rev, cwd) === rev` equality. No security findings introduced.

REVIEW-615-R26-DONE
