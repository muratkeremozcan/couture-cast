# Antigravity Review — Story 6.15 Round 25 (`5030a682..bcc7f536`)

- **Worktree:** `/Users/murat/opensource/cc/couture-cast-wt-615` (read-only; mutants/probes ran in detached `/tmp/wt-615-mutant-r25`, now removed and pruned)
- **Target commit:** `bcc7f536` (`fix(evidence): fail the manifest on a hung or failed git call`)
- **Automated suite after cleanup:** `node --test scripts/lib/evidence-manifest*.test.mjs scripts/lib/test-store-*.test.mjs` — **124 passed, 0 failed, 0 skipped**

## Findings (P0–P3)

No **P0**, **P1**, or **P2** findings remain in `5030a682..bcc7f536`. Every Round 24 `P2`/`P3` closure is implemented cleanly. Two **P3** test/edge gaps remain:

### P3-1: `objectId` non-empty stderr on exit `1` is untested; direct `objectId` call on a shallow missing commit returns `null`

- **Location:** `scripts/lib/evidence-manifest.mjs:160-167` (`objectId`)
- **Mutant evidence:** `M1_objectId_ignore_stderr` (removing `&& result.stderr === ''` at `evidence-manifest.mjs:163`) **survived** `scripts/lib/evidence-manifest.test.mjs` (`exit 0`, `0` failures).
- **Concrete failure scenario:**
  1. If a future refactor drops `result.stderr === ''` in `objectId`, the test suite will still pass (`only a clean not-found exit reads as absent` currently proves stderr gating on `show` exit `128`, not `rev-parse` exit `1` with stderr).
  2. Independently, empirical `git 2.55.0` probing shows `git rev-parse --verify --quiet <missingCommit>:<file>` in a `--depth=1` shallow clone exits `1` with empty `stdout` and `stderr`. While internal flows (`writeManifest`, `changedInputs`, `uncoveredReads`) call `revParse(rev, cwd)` first—failing loudly with `evidence_git_failed:rev-parse:exit_128` (`fatal: Needed a single revision`)—`objectId` is exported (`evidence-manifest.mjs:160`), so any direct caller passing an unverified commit SHA on a shallow clone gets `null` instead of `evidence_git_failed`.
- **Suggested closure:** Add a stubbed `git` test case in `scripts/lib/evidence-manifest.test.mjs` where `rev-parse --verify --quiet` exits `1` with non-empty `stderr` and assert `objectId` throws `evidence_git_failed:rev-parse:exit_1` without leaking stderr.

### P3-2: `revParse` commit peeling (`${rev}^{commit}`) has no regression test

- **Location:** `scripts/lib/evidence-manifest.mjs:149-154` (`revParse`)
- **Mutant evidence:** `M4a_revParse_no_commit_peel` (replacing `` `${rev}^{commit}` `` with `` `${rev}` `` at `evidence-manifest.mjs:150`) **survived** `scripts/lib/evidence-manifest.test.mjs` (`exit 0`, `0` failures).
- **Concrete failure scenario:** Removing `^{commit}` causes an annotated tag passed as `--rev` to resolve to its tag object SHA instead of its commit SHA (failing subsequent tree/commit semantics if mismatched), and stops rejecting bare tree/blob OIDs.
- **Suggested closure:** Add a test in `scripts/lib/evidence-manifest.test.mjs` verifying `revParse` / `writeManifest` peels an annotated tag to its commit SHA and rejects a tree OID (`HEAD^{tree}`) with `evidence_git_failed`.

_(Observation: Mutant `M3_spawnGit_drop_error_throw`, removing `if (result.error) throw ...` at `evidence-manifest.mjs:134`, also exited `0` in `evidence-manifest.test.mjs` because Node `spawnSync` sets `result.status = null` whenever `result.error` is present, so `git()`, `objectId()`, and `show()` already reach `gitFailed` via `result.status !== 0` and still format `result.error?.code`. Keeping `if (result.error)` in `spawnGit` remains good defense-in-depth.)_

---

## Verification Summary

### 1. R24 Probes 1–4 Re-run

| Probe                                                                 | Target                                | Observed Result in `bcc7f536`                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Probe 1 (`dirtyInputs`, hung `git status`)                            | `scripts/lib/evidence-manifest.mjs`   | Threw `evidence_git_failed:status:ETIMEDOUT` (`EVIDENCE_MANIFEST_GIT_TIMEOUT_MS=50`)                                    |
| Probe 2 (`legInputs('live-font')` -> `globFiles`, hung `git ls-tree`) | `scripts/lib/evidence-manifest.mjs`   | Threw `evidence_git_failed:ls-tree:ETIMEDOUT` (`EVIDENCE_MANIFEST_GIT_TIMEOUT_MS=50`)                                   |
| Probe 3 (`objectId`, hung `git rev-parse`)                            | `scripts/lib/evidence-manifest.mjs`   | Threw `evidence_git_failed:rev-parse:ETIMEDOUT` (`EVIDENCE_MANIFEST_GIT_TIMEOUT_MS=50`)                                 |
| Probe 4 (`resolvedAppConfig`, hung `expo config`)                     | `scripts/lib/resolved-app-config.mjs` | Returned `{ error: "expo config exited null: spawnSync .../node ETIMEDOUT" }` at bound (existing non-zero failure path) |

_(Note: `test-store` in `LEGS` has `globs: []`; `live-font` and `ios-build` exercise `globFiles` / `git ls-tree`.)_

### 2. Closure Mutants (Detached `/tmp/wt-615-mutant-r25`)

| Mutant                                 | Target                          | Result                                           | Failing Test(s)                                                                                                                                                     |
| -------------------------------------- | ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M1_objectId_ignore_stderr`            | `evidence-manifest.mjs:163`     | **SURVIVED** (`exit 0`)                          | — (`P3-1`)                                                                                                                                                          |
| `M2_show_allow_any_128`                | `evidence-manifest.mjs:178`     | **KILLED** (`exit 1`)                            | `only a clean not-found exit reads as absent`                                                                                                                       |
| `M3_spawnGit_drop_error_throw`         | `evidence-manifest.mjs:134`     | Survived (`status: null` still hits `gitFailed`) | —                                                                                                                                                                   |
| `M4a_revParse_no_commit_peel`          | `evidence-manifest.mjs:150`     | **SURVIVED** (`exit 0`)                          | — (`P3-2`)                                                                                                                                                          |
| `M4b_revParse_no_objectId_check`       | `evidence-manifest.mjs:152`     | **KILLED** (`exit 1`)                            | `a hung or failing git call throws evidence_git_failed on every path`                                                                                               |
| `M5_driverClosure_no_scripts_literals` | `test-store-spawn.test.mjs:231` | **KILLED** (`exit 1`)                            | `the closure follows scripts named by repository path, from scripts and shell`                                                                                      |
| `M6_driverClosure_follow_LEG_TABLE`    | `test-store-spawn.test.mjs:231` | **KILLED** (`exit 1`)                            | `every spawnSync, execFileSync and execSync the Test Store driver loads is bounded`; `the closure follows scripts named by repository path, from scripts and shell` |
| `M7_env_override_skip_boundOf`         | `evidence-manifest.mjs:104-107` | **KILLED** (`exit 1`)                            | `a git bound of 0 or text refuses to load`; `every spawnSync, execFileSync and execSync the Test Store driver loads is bounded`                                     |

---

## Judgment Questions

1. **Can `NOT_AT_REV` or the quiet exit-1 rule misclassify a real failure as absent (corrupt object, shallow clone missing the commit, git version wording change)?**
   - **Corrupt / missing blob:** Probed with `git 2.55.0`. `git show` exits `128` with `"fatal: bad object ..."` (deleted blob) or `"error: inflate: data stream error ... fatal: loose object ... is corrupt"` (corrupt blob). Neither matches `NOT_AT_REV`, so `show` throws `evidence_git_failed:show:exit_128`. `rev-parse --verify --quiet` does not read blob contents and returns exit `0` + SHA.
   - **Corrupt tree:** Probed: both `rev-parse --verify --quiet` and `show` exit `128` with inflate/corrupt stderr, so both throw `evidence_git_failed`.
   - **Deleted intermediate tree (missing loose tree file, not corrupt):** Probed: `git rev-parse --verify --quiet HEAD:sub/b.mjs` exits `1` silently and `git show HEAD:sub/b.mjs` exits `128` with `"fatal: path 'sub/b.mjs' exists on disk, but not in 'HEAD'\n"`, matching `NOT_AT_REV` — a Git-level ambiguity when a subtree object is missing from object storage.
   - **Shallow clone missing the commit:** Probed in a `--depth=1` clone: `revParse(c1, shallowDir)` runs `rev-parse --verify --end-of-options <c1>^{commit}` and fails cleanly with exit `128` (`fatal: Needed a single revision`) -> throws `evidence_git_failed:rev-parse:exit_128` before `objectId` or `show` run in `writeManifest` / `changedInputs` / `uncoveredReads`. Direct callers of exported `objectId(missingCommit, file, cwd)` bypass `revParse` and receive `null` (`P3-1`).
   - **Git version wording change:** `GIT_ENV` forces `LC_ALL: 'C'` and `LANGUAGE: ''` (verified under `fr_FR.UTF-8`, which otherwise localizes stderr to `"fatal : le chemin 'nope.mjs' n'existe pas dans 'HEAD'\n"`). If a future upstream Git changes the C-locale strings matched by `NOT_AT_REV`, `show()` fails closed (`evidence_git_failed:show:exit_128`) rather than returning `null`.

2. **Does `${rev}^{commit}` break a caller that passed a tree or tag?**
   - **Tags:** Verified by probe: both lightweight and annotated tags peel cleanly via `${rev}^{commit}` to their target commit SHA.
   - **Trees / blobs:** Verified by probe: passing a tree SHA, `HEAD^{tree}`, or blob SHA fails with `evidence_git_failed:rev-parse:exit_128`. All evidence manifests represent a build commit (`HEAD` or commit SHA), so rejecting non-commit objects is intentional.

3. **Can a stale manifest `verify` now fail where it passed before for a benign reason?**
   - No benign regression identified on modern Git (`>= 2.24.0`, needed for `--end-of-options`; runner is `git 2.55.0`). Stale manifests with legitimately absent files still receive `null` from `objectId`; failures now trigger only on non-commit revs, corrupt objects, git errors/timeouts, or Git older than `2.24.0`.

4. **Does `EVIDENCE_MANIFEST_GIT_TIMEOUT_MS` let a run disable the bound?**
   - **No.** `GIT_TIMEOUT_MS` parses `process.env.EVIDENCE_MANIFEST_GIT_TIMEOUT_MS ?? '30000'` through `spawn-bound.mjs`'s `boundOf` at module import (`evidence-manifest.mjs:104-107`), rejecting `0`, `''`, negative numbers, non-integers, text, and unsafe integers (`> Number.MAX_SAFE_INTEGER`) with `evidence_git_timeout_invalid`. (Probed `2147483647`, `2147483648`, and `Number.MAX_SAFE_INTEGER`: Node `spawnSync` accepts large positive safe integers without throwing `ERR_OUT_OF_RANGE`, so setting an absurdly huge explicit value is accepted as a large bound rather than disabling the option.)

REVIEW-615-R25-DONE
