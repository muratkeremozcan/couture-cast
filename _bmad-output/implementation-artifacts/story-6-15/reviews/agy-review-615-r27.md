# Antigravity Review — Story 6.15 Round 27 (`b3ede2bb..f3985243`)

- **Worktree:** `/Users/murat/opensource/cc/couture-cast-wt-615` (read-only; mutants/probes ran in detached `/tmp/wt-615-mutant-r27`, now removed and pruned)
- **Target commit:** `f3985243` (`fix(evidence): keep verified commits to one manifest call`)
- **Automated suite after cleanup:** `node --test scripts/lib/evidence-manifest*.test.mjs scripts/lib/test-store-*.test.mjs` — **129 passed, 0 failed, 0 skipped**
- **Verdict:** **The range `b3ede2bb..f3985243` is clear** — **0 P0, 0 P1, 0 P2, and 0 P3 findings remain.** Both Round 26 P3s are closed and killed by tests.

## Findings (P0–P3)

None.

- Both `P3-1` (stale module-global `verifiedCommits` across same-path `gc`/re-clone in one process) and `P3-2` (missing regression test guarding mutable refs like `HEAD` against caching) from Round 26 are cleanly resolved:
  - `scripts/lib/evidence-manifest.mjs:166-169`: `verifyCommit(rev, cwd, verified)` operates solely on the caller-supplied `verified` `Set` (`verified?.has(rev)` / `verified?.add(rev)` only when `revParse(rev, cwd) === rev`).
  - `scripts/lib/evidence-manifest.mjs:178-179`: exported `objectId(rev, file, cwd, verified)` takes an optional `verified` `Set`; standalone calls with no set verify the commit on every call.
  - `scripts/lib/evidence-manifest.mjs:311-321` (`uncoveredReads`) and `scripts/lib/evidence-manifest.mjs:356-370` (`writeManifest`): each creates a fresh `const verified = new Set([sha])` per invocation, scoped to that single manifest call.

---

## Verification Summary

### 1. Closure Mutants (Detached `/tmp/wt-615-mutant-r27`)

| Mutant                            | Target                          | Result                | Failing Test(s)                                                                                                                                                |
| --------------------------------- | ------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M_global_verified_set`           | `evidence-manifest.mjs:166-169` | **KILLED** (`exit 1`) | `objectId on a commit a shallow clone lacks throws; a missing path under it is null`; `a commit verified before a same-path shallow re-clone is checked again` |
| `M_cache_mutable_ref`             | `evidence-manifest.mjs:168`     | **KILLED** (`exit 1`) | `objectId checks HEAD on every call, within one verified set`                                                                                                  |
| `M_skip_verifyCommit_when_no_set` | `evidence-manifest.mjs:166-169` | **KILLED** (`exit 1`) | `objectId on a commit a shallow clone lacks throws; a missing path under it is null`; `a commit verified before a same-path shallow re-clone is checked again` |

### 2. Probe `3a` Re-run

- Called `objectId(c1, 'a.mjs', work)` against a full clone (`e14c4f2a9561ade31986f9319d5c639094509905`), removed and re-cloned `--depth=1` at the exact same `work` path lacking `c1` in the same Node process, and called `objectId(c1, 'a.mjs', work)` again: threw `evidence_git_failed:rev-parse:exit_128` as required.

---

## Codex Security Review (`~/.codex/skills/codex-security-review/SKILL.md`)

- `config_preflight.py --profile security_diff_scan` exited `2` with `status: "incomplete"` (`delegated_workers` and `goal_tools` `unknown` in this harness).
- Manual security diff review of `b3ede2bb..f3985243` (`scripts/lib/evidence-manifest.mjs:157-180,309-370`): removing the shared process-global `Set` eliminates cross-call state carryover between repositories, standalone `objectId` calls verify uncached on every call, no subprocess invocation or error formatting surface changed (`evidence_git_failed:<subcommand>:<how>`), and no security issues are introduced.

REVIEW-615-R27-DONE
