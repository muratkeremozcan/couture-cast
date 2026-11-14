# Story 6.15 Code & Security Review — Round 10

- **Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615` (`e9b403af`, strictly read-only)
- **Range**: `a9816083..e9b403af` (`677782e6`, `77ef2661`, `e9b403af`)
- **Secret handling**: No `.env` files or secret values were read.

## Summary Verdict

No **P0**, **P1**, or **P2** findings. All four Round 9 findings (`P2-1`, `P2-2`, `P3-1`, `P3-2`) are cleanly closed and verified both via targeted mutants and by re-running all six Round 9 bypass reproductions (every one now fails `verify` with `rc=1`). Two minor **P3** observations remain around CLI zero-argument `verify`, shell-script scanning (`android-network-timeout.sh` in `paths` rather than `entries`), and known static-analysis limits of `uncoveredReads`.

---

## Findings (Ranked P0–P3)

_(No P0, P1, or P2 findings.)_

### P3-1 — `verify` exits `0` with zero manifest args, and `network-timeout` shell script sits in `paths` rather than `entries`

- **Location**: `scripts/lib/evidence-manifest.mjs:62-66, 305-324`
- **Concrete failure scenarios**:
  1. Invoking `node scripts/lib/evidence-manifest.mjs verify` without any manifest file argument builds `files = []` (`lines 306-308`), runs zero checks, and exits `0` (`stale = 0`, `line 323`) instead of exiting `2` (usage error).
  2. `scripts/ci/android-network-timeout.sh` is listed under `LEGS['network-timeout'].paths` (`line 63`), not `entries` (`line 65`). Because `uncoveredReads` (`lines 212-226`) walks only `importClosure(LEGS[leg].entries)`, adding a call like `node scripts/lib/new-helper.mjs` inside `android-network-timeout.sh` would not be scanned by `uncoveredReads` (adding the `.sh` file to `entries` lets `importClosure` scan its `repoPathLiterals` too).

### P3-2 — Untracked top-level `scripts/lib/live-font-*` files are invisible to `dirtyInputs`

- **Location**: `scripts/lib/evidence-manifest.mjs:195-202, 264`
- **Concrete failure scenario**: `globFiles` resolves `scripts/lib/live-font-*` via `git ls-tree -r` against committed `HEAD` (`line 198`). An untracked file matching `scripts/lib/live-font-stray.mjs` in the working tree is not in `legInputs` passed to `dirtyInputs` (`line 264`). In practice, any run executing that code must import/call it from a tracked file (which makes that importer dirty and fails `dirtyInputs`).

---

## R9 Closures & Re-run Reproductions (Verified in Isolated `/tmp/wt-615-mutant-r10`)

Every Round 9 bypass reproduction now fails `evidence-manifest.mjs verify` (`rc=1`):

| R9 Case                                                | Action                                                                                                        | Result on `e9b403af`                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Baselines fixture (`P2-1`)                             | Commit edit to `scripts/lib/fixtures/live-font-residual-baselines.json`, run `verify` on `live-font` manifest | **FAILS (`rc=1`)**: `RERUN live-font (...): scripts/lib/fixtures`                    |
| Maestro subflow (`P2-1`)                               | Commit edit to `maestro/subflows/open-app.yaml`, run `verify` on `network-timeout` manifest                   | **FAILS (`rc=1`)**: `RERUN network-timeout (...): maestro`                           |
| Story 6.8 flow (`P2-1`)                                | Commit edit to `maestro/story68/save.yaml`, run `verify` on `ios-build` manifest                              | **FAILS (`rc=1`)**: `RERUN ios-build (...): maestro, scripts/lib/fixtures`           |
| Share-card assets (`P2-1`)                             | Commit edit to `apps/api/src/modules/share-cards/assets/en-US.json`, run `verify` on `ios-build` manifest     | **FAILS (`rc=1`)**: `RERUN ios-build (...): apps/api, maestro, scripts/lib/fixtures` |
| Dirty working tree (`P2-2`)                            | Uncommitted edit to `apps/mobile/app.config.ts`, run `verify` on `live-font` manifest                         | **FAILS (`rc=1`)**: throws `evidence_manifest_dirty_inputs`                          |
| Old `--rev` (`P2-2`)                                   | Pass `--rev <base_sha>` after `HEAD` advances, run `verify` on `live-font` manifest                           | **FAILS (`rc=1`)**: throws `evidence_manifest_rev_not_head`                          |
| `require()` / spawned script / recursive glob (`P3-1`) | Targeted mutants removing each feature                                                                        | **KILLED (`rc=1`)** by `evidence-manifest.test.mjs`                                  |
| `usage: undefined` (`P3-2`, `77ef2661`)                | Revert `!file \|\| !fs.existsSync(file)` to `!fs.existsSync(file)`                                            | **KILLED (`rc=1`)** by `minified-debuggable-evidence.test.mjs` (`DEP0187` assertion) |

---

## Judge Questions

### 1. What can `uncoveredReads` still miss, and is that residual acceptable?

- **What it still misses**:
  - **Dynamic/indirect JS paths**: paths constructed from non-root-prefixed variables (`path.join(dir, file)` or `` `${base}/x` ``), variable `new URL(varName, import.meta.url)`, or `createRequire` bound to an identifier (`const r = createRequire(import.meta.url); r('./x.cjs')`, noted in `evidence-manifest.test.mjs:214`).
  - **Non-entry script & flow internals**: reads/invocations inside shell scripts listed only in `paths` (`scripts/ci/android-network-timeout.sh`) and inside Maestro `runScript` files (`maestro/subflows/open-expo-go-link.js`, though `open-link.yaml:10` already only runs on Expo Go via `MAESTRO_EXPO_GO_OPEN_URL`).
  - **Outside-repo tooling & config**: external Maestro binary (`$HOME/.maestro/bin/maestro` — though its installer/pin `scripts/maestro-install.mjs` & `scripts/maestro-version.mjs` are repo files outside `network-timeout`), `~/.gradle/gradle.properties`, Xcode/SDK/simulator OS images, Android emulator system images, and untracked `.env*` files.
- **Is the residual acceptable?** **Yes.** Now that every leg covers `apps/mobile`, `packages`, the entire `maestro/` tree, and root build/dependency files (`APP_INPUTS`), and API-booting legs cover `apps/api`, `packages/db`, `supabase`, and `HARNESS_DATA` (`scripts/lib/fixtures`, `native-supabase-bootstrap.sql`, `maestro-flow-durations.json`), all real in-repo app, flow, fixture, and API inputs sit under hashed directory trees rather than fragile per-file patterns.

### 2. Can the over-inclusion make `verify` fail on a head that changed nothing a leg reads, in a way that blocks merge?

- **Only as a conservative rerun cost, not an unresolvable merge block.**
  - PRs touching unrelated areas (`docs/`, `_bmad-output/`, `apps/web/`, `.github/`) still pass `verify` cleanly (`OK`).
  - Because `SHARED_INPUTS` includes all of `maestro/` for every leg (`lines 36, 53, 58, 63, 68, 78, 86`) and `live-font` includes `SERVER_INPUTS` + `HARNESS_DATA` + `scripts/run-story68-native.mjs` (`lines 52-55`), changing e.g. `maestro/story68/...` forces `android-evidence` and `network-timeout` to rerun even though neither executes `maestro/story68/`, and changing an unrelated `apps/api/` or `story68-*` file forces a `live-font` rerun.
  - Because `verify`'s `RERUN` signal triggers rerunning that leg on the new `HEAD` (`lines 8-9`), this adds CI/device wait time rather than permanently blocking a valid head — consistent with the explicit design invariant at `line 34` (_"a false rerun is cheap, a false pass is not"_).

---

## Security Review Lens (`~/.codex/skills/codex-security-review/SKILL.md`)

- **Gate enforcement (`e9b403af`)**: `verify` (`changedInputs`) now enforces the same clean-working-tree (`dirtyInputs`) and `HEAD`-equality (`sha === head`) checks as `writeManifest` (`lines 259-282`), closing the bypass where uncommitted local edits or stale `--rev` flags could pass verification (`P2-2`). Broadening `LEGS` + `uncoveredReads` closes the missed-input bypass (`P2-1`).
- **Fail-closed evidence check (`77ef2661`)**: `if (!file || !fs.existsSync(file))` continues to fail closed on missing/undefined `apk`, `mapping`, or `usage` while eliminating Node's `DEP0187` warning.

---

## Mutant Verification (Isolated `/tmp/wt-615-mutant-r10`, removed after run)

| Mutant                                                                                                            | Result                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `M1`: Revert `globFiles` `git ls-tree -r` to non-recursive `ls-tree` (`evidence-manifest.mjs:198`)                | **KILLED** (`evidence-manifest.test.mjs`, rc=1)            |
| `M2`: Remove `require(...)` pattern in `relativeImports` (`evidence-manifest.mjs:118`)                            | **KILLED** (`evidence-manifest.test.mjs`, rc=1)            |
| `M3`: Drop spawned `repoPathLiterals` follow in `importClosure` (`evidence-manifest.mjs:183-189`)                 | **KILLED** (`evidence-manifest.test.mjs`, rc=1)            |
| `M4`: Remove `scripts/lib/fixtures` from `HARNESS_DATA` (`evidence-manifest.mjs:39`)                              | **KILLED** (`evidence-manifest.test.mjs`, rc=1)            |
| `M5`: Default `requireClean = false` in `changedInputs` (`evidence-manifest.mjs:280`)                             | **KILLED** (`evidence-manifest.test.mjs`, rc=1)            |
| `M6`: Revert `!file \|\| !fs.existsSync(file)` to `!fs.existsSync(file)` (`minified-debuggable-evidence.mjs:274`) | **KILLED** (`minified-debuggable-evidence.test.mjs`, rc=1) |

---

## Test Runs Observed

- `node --test scripts/lib/evidence-manifest.test.mjs scripts/lib/minified-debuggable-evidence.test.mjs`:
  - **22 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**.

REVIEW-615-R10-DONE
