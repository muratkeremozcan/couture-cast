# Review Round 11 — PR/Handover #615 (`tea615`)

Targets reviewed (strictly read-only on repo checkouts; mutants executed only in detached `/tmp/wt-615-mutant-r11`, removed and pruned immediately after):

1. `/Users/murat/opensource/cc/couture-cast-wt-615-tea` (`tea/no-install-imports`, commit `57bd8cfb`, parent `c9cd3132`):
   - `scripts/ci/workflow-node-deps.mjs` (189 lines)
   - `scripts/ci/workflow-node-deps.test.mjs` (175 lines)
2. `/Users/murat/opensource/cc/couture-cast-wt-615` (`c9cd3132`):
   - `scripts/ci/coverage-shards.test.mjs` (lines 73–91 text-match rewrite replacing `yaml` `parse`)

---

## Findings (P0–P3)

### P1 — `actions/cache` / `actions/cache/restore` of `node_modules` is treated unconditionally as installed (`scripts/ci/workflow-node-deps.mjs:21-26`, `43-59`)

- **Is treating a `node_modules` cache restore as installed safe when the restore can miss? No — it is unsafe.**
- **Mechanism**: `installs(step)` returns `true` whenever `step.uses` starts with `actions/cache@` or `actions/cache/restore@` and `step.with?.path` contains `node_modules` (`workflow-node-deps.mjs:24-25`). `stepsWithInstallState` flips `installed = true` immediately for every subsequent step in the job or expanded composite action (`workflow-node-deps.mjs:46-57`), ignoring `step.if:` conditions and the fact that a cache restore can miss (`cache-hit != 'true'`).
- **Concrete failure scenario**:
  1. In `.github/actions/node-dependencies/action.yml`, `actions/cache/restore@v4` (`line 38`, `if: runner.os == 'Linux'`) runs **before** `node scripts/ci/verify-dependency-tree.mjs` (`line 63`) and **before** `bash .../scripts/ci/install-dependencies.sh` (`line 74`).
  2. If a step between `actions/cache/restore@v4` and `install-dependencies.sh` (or any job that uses `actions/cache/restore@v4` on `node_modules` without a guaranteed fallback install) invokes `node scripts/some-check.mjs` that imports an npm package, `workflow-node-deps.mjs` marks `installed = true` at the restore step and passes locally and in unit tests (`FN-cache-restore-miss => []` in probes).
  3. On GitHub Actions whenever the cache misses (new lockfile, pruned/evicted cache, cold runner, fork PR) or on macOS/Windows where `if: runner.os == 'Linux'` skips the restore, `node_modules` does not exist and that step crashes with `ERR_MODULE_NOT_FOUND`.
- **Recommendation**: Do **not** treat `actions/cache` or `actions/cache/restore` as `installed = true` at all (or at minimum only treat an _unconditional_ `npm ci` / `npm install` / `install-dependencies.sh` as establishing `installed = true`). Keep `verify-dependency-tree.mjs` (and any pre-install script) strictly on Node builtins (`createRequire` inside `try/catch` for probing installed native modules in `verify-dependency-tree.mjs` already needs builtins only at import time, or requires `node_modules` only when `cache-hit == 'true'`, which cannot make an intermediate unconditional `node` step safe).

---

### P2 — High-frequency false negatives allow real `ERR_MODULE_NOT_FOUND` regressions through (`scripts/ci/workflow-node-deps.mjs:14-15, 86-123, 131-141, 172-175`)

Every probe below returned `[]` (undetected) when executed against `workflowProblems()` in `/tmp/wt-615-mutant-r11`:

1. **`createRequire` bypassed (`workflow-node-deps.mjs:110-123`)**:
   - `importPatterns` only matches static `import`, `export ... from`, `import('...')`, and literal `\brequire('...')`.
   - Across `scripts/ci/`, the repo's dominant CJS/package loader pattern is `createRequire` (`node-test-gate.mjs:29` and `workflow-step-shadowing.mjs:18` literally load `yaml` via `createRequire(import.meta.url)('yaml').parse(...)`; `share-card-browser-deps.mjs`, `ubuntu-package-cache.mjs`, `native-build-cache.mjs`, `android-release-abis.mjs`, `playwright-spec-loading.test.mjs`, `supabase-image-cache.test.mjs`, and `verify-dependency-tree.mjs` all use `createRequire`).
   - Concrete failure (`FN-createRequire => []`): rewriting `coverage-shards.test.mjs` to `createRequire(import.meta.url)('yaml').parse(...)` passes `workflow-node-deps.test.mjs` locally and fails the no-install `tests` merge job on CI with `Cannot find module 'yaml'`.
   - Likewise `.resolve('pkg')` via `createRequire` or `require.resolve('pkg')` is ignored.

2. **`node` flags taking a space-separated value eat the script argument (`workflow-node-deps.mjs:90-98`)**:
   - `nodeScripts` parses `(?:--?[\w-]+(?:=\S+)?)*` followed by whitespace-separated tokens, taking `args.slice(0, 1)` when `--test` is absent.
   - Any space-separated option value (`node -r pkg scripts/a.mjs`, `node --require ./scripts/pre.mjs scripts/a.mjs`, `node --import ./reg.mjs scripts/a.mjs`, `node -C production scripts/a.mjs`) leaves the option value as `args[0]`, dropping the actual script `scripts/a.mjs` (and ignoring the `-r`/`--require`/`--import` preload module itself). Both `FN-node-flag-value` and `FN-node-r-pkg` returned `[]`.

3. **Indirect invocations: `npm run`, `npx`, shell scripts, and `cd dir && node ...` (`workflow-node-deps.mjs:86-108`)**:
   - `npm run <script>` (`FN-npm-run => []`), `npx <pkg> ...` (`FN-npx => []`), `bash scripts/run.sh` (`FN-shell-script => []`), and `cd sub && node a.mjs` (`FN-cd-and-node => []`) are all ignored (`cd sub && node a.mjs` resolves `a.mjs` against repo root `.` instead of `sub/`, fails `fs.existsSync`, and drops it). `pr-apple-native.yml` already runs `bash scripts/ci/share-card-header-semantics.sh` in `swift-linux` before install.

4. **Workflow-level `defaults.run.working-directory` ignored (`workflow-node-deps.mjs:172-175`)**:
   - `workflowProblems` checks `step['working-directory']` and job `definition.defaults?.run?.['working-directory']`, omitting top-level `workflow.defaults?.run?.['working-directory']` (`FN-workflow-defaults-wd => []`). Also composite steps ignore any caller context if relative paths rely on it.

5. **Commented `# npm ci` on line >= 2 marks job installed (`workflow-node-deps.mjs:15`)**:
   - `installRun` checks `!/^\s*#/.test(run)` without the `/m` flag. A multi-line `run:` block with a comment like `# npm ci` on line 2 (`echo "skip install"\n# npm ci`) returns `true` and marks every subsequent step in the job installed (`FN-commented-npm-ci-line2 => []`).

6. **Relative `.cjs`, `/index.js`, `/index.cjs` omitted (`workflow-node-deps.mjs:131-141`)**:
   - `resolveRelative` tries `target`, `${target}.mjs`, `${target}.js`, `path.join(target, 'index.mjs')`. Importing `./b` backed by `b.cjs` (`FN-relative-cjs => []`) or `./dir` backed by `dir/index.js` (`FN-relative-index-js => []`) stops traversal before seeing `'yaml'` inside that file.

---

### P2 — Concrete false positives that block valid workflows (`scripts/ci/workflow-node-deps.mjs:14-26, 43-59, 90, 110-123`)

Every probe below produced a spurious failure on a valid workflow:

1. **Regexes match `import`/`require` inside string literals, template literals, and comments (`workflow-node-deps.mjs:110-115`)**:
   - Any builtin-only CI script or `node --test` file running before install whose test fixtures contain multiline `` `\nimport 'yaml'\n` `` (`FP-template-literal-import`), `"require('@scope/pkg')"` (`FP-string-literal-require`), or block comments `/*\nimport "yaml"\n*/` (`FP-block-comment-import`) is flagged as importing an external package. Notably, `scripts/ci/workflow-node-deps.test.mjs:156` itself uses such fixture strings.

2. **`echo` / prose mentioning `node <existing-script>` (`workflow-node-deps.mjs:90`)**:
   - In `echo "Run node scripts/a.mjs after install"` (`FP-echo-node-script`), `nodeScripts` matches `node scripts/a.mjs` inside the quoted echo message and fails the workflow even though `node` is never executed.

3. **Legitimate installs in non-`npm` or flag-prefixed commands (`workflow-node-deps.mjs:14-26`)**:
   - `npm --prefix apps/mobile ci` (`FP-npm-prefix-ci`), `pnpm install`, `yarn install`, or a composite action invoking a custom installer script other than `install-dependencies.sh` (e.g. `bash scripts/bootstrap-deps.sh`, `FP-composite-custom-install`) is not recognized as an install, blocking valid post-install steps.

4. **Skipped / conditional steps (`workflow-node-deps.mjs:46-57, 171`)**:
   - Steps gated with `if: false` (`FP-npm-install-if-false`) or conditions that never run pre-install without `node_modules` are still checked and block the workflow.

---

### P3 — `c9cd3132` (`scripts/ci/coverage-shards.test.mjs:73-91`): pins the four invariants today, with two structural fragilities

- **What `coverage-shards.test.mjs:73-91` pins today (all 4 mutants killed in `/tmp/wt-615-mutant-r11`)**:
  - `id: plugins` on `Mobile plugin prebuild suites`: killed when renamed (`M2`) or omitted.
  - Step order (`plugins` before `Record this shard's result`): killed when `Mobile plugin prebuild suites` moves after `Record this shard's result` (`M3`).
  - `OUTCOME: ${{ steps.tests.outcome }}`: killed when mutated to `steps.plugins.outcome` (`M4`).
  - `PLUGINS_OUTCOME: ${{ steps.plugins.outcome }}`: killed when mutated to `steps.tests.outcome` (`M5`).
- **Two structural gaps/fragilities in the slice logic**:
  1. **Tight formatting coupling (false failure risk, demonstrated by `M2b`)**: `workflow.indexOf('      - name: Mobile plugin prebuild suites\n        id: plugins\n')` requires `id: plugins` to appear _immediately_ on the next line after `name:` with exact 6/8-space indentation. Adding a valid YAML key between `name:` and `id:` (e.g., `continue-on-error: false`, tested as `M2b`) fails the test even though the workflow semantics are unchanged. Similarly, lines `86-90` hardcode 10 spaces before `OUTCOME:` and `PLUGINS_OUTCOME:`.
  2. **Unbounded slice tail (`coverage-shards.test.mjs:82-85`)**: `workflow.indexOf('\n      - name:', record + 1)` looks for the next named step. It works while `Upload this shard's coverage` immediately follows `Record this shard's result` with `- name:`, but if `Record this shard's result` became the last named step in the file (returns `-1` -> `slice(record, -1)` captures the rest of `pr-checks.yml`, including later jobs!) or is followed by an unnamed `- uses:` step, a missing `OUTCOME:`/`PLUGINS_OUTCOME:` in `Record` could be accidentally satisfied by a later step/job. Anchoring the end to `\n      - (?:name|uses):|\n  [a-zA-Z0-9_-]+:` (or `\n[^\n]{0,4}\S`) and scanning the `Mobile plugin prebuild suites` step block separately rather than assuming `id:` follows `name:` immediately would close both.

---

## Codex Security Diff-Scan Assessment

- **Preflight**: Executed `config_preflight.py --profile security_diff_scan` (`status: ready`; one `suggest` gap: `goal_tools_available=false` in this environment).
- **Threat Model & Diff-Scan Scope**: Changes in `57bd8cfb` and `c9cd3132` touch CI test/verification scripts only (`scripts/ci/workflow-node-deps.{mjs,test.mjs}`, `scripts/ci/coverage-shards.test.mjs`); no runtime API, auth, DB, secret, or user-input handlers are modified. No `.env` or secret files were read.
- **Security / Supply-Chain / CI-Integrity Finding**: The `actions/cache/restore` bypass (`P1`) and `createRequire` / preload-flag / shell-wrapper blind spots (`P2`) directly affect **CI gate integrity**: a PR introducing a pre-install dependency (or re-introducing `yaml` via `createRequire`) passes local & PR unit checks (`workflow-node-deps.test.mjs`) while failing live CI on cache miss, macOS runs, or the no-install `tests` merge job. Meanwhile, `c9cd3132` has no untrusted input parsing; its risk is strictly CI gate coverage drift if `Record this shard's result` becomes the final named step (`P3`).

---

## Mutant & Probe Verification Matrix (`/tmp/wt-615-mutant-r11`)

Detached worktree created from `57bd8cfb`, removed (`rm` + `git worktree prune`), confirmed `CLEANED UP EXISTS? False`.

| Check / Mutant                     | Target                                                                                                                                                                                                         | Result                                    | Evidence                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline (`wt-615-tea`)            | `node --test scripts/ci/workflow-node-deps.test.mjs scripts/ci/coverage-shards.test.mjs`                                                                                                                       | **22/22 pass**                            | 15 + 7 tests, 0 fail                                                                                                                                     |
| Baseline (`wt-615`)                | `node --test scripts/ci/coverage-shards.test.mjs`                                                                                                                                                              | **15/15 pass**                            | 15 tests, 0 fail                                                                                                                                         |
| **M1** (`reintroduce yaml`)        | Add `import { parse } from 'yaml'` to `scripts/ci/coverage-shards.test.mjs`, run `workflow-node-deps.test.mjs`                                                                                                 | **KILLED (exit 1, 6 pass / 1 fail)**      | Output: `'.github/workflows/pr-checks.yml tests "Keep every workspace in exactly one coverage shard": scripts/ci/coverage-shards.test.mjs imports yaml'` |
| **M2** (`c9cd3132`)                | Rename `id: plugins` -> `id: plugin-suites` in `pr-checks.yml`                                                                                                                                                 | **KILLED (exit 1, 14 pass / 1 fail)**     | `AssertionError: the plugin step carries id plugins`                                                                                                     |
| **M2b** (`c9cd3132`)               | Insert `continue-on-error: false` between `name:` and `id: plugins`                                                                                                                                            | **FALSE FAIL (exit 1, 14 pass / 1 fail)** | `AssertionError: the plugin step carries id plugins`                                                                                                     |
| **M3** (`c9cd3132`)                | Move `Mobile plugin prebuild suites` after `Record this shard's result`                                                                                                                                        | **KILLED (exit 1, 14 pass / 1 fail)**     | `AssertionError: the record step follows the plugin step` (`coverage-shards.test.mjs:81`)                                                                |
| **M4** (`c9cd3132`)                | Change `OUTCOME: ${{ steps.tests.outcome }}` -> `steps.plugins.outcome`                                                                                                                                        | **KILLED (exit 1, 14 pass / 1 fail)**     | Regex mismatch on `OUTCOME: ${{ steps.tests.outcome }}`                                                                                                  |
| **M5** (`c9cd3132`)                | Change `PLUGINS_OUTCOME: ${{ steps.plugins.outcome }}` -> `steps.tests.outcome`                                                                                                                                | **KILLED (exit 1, 14 pass / 1 fail)**     | Regex mismatch on `PLUGINS_OUTCOME: ${{ steps.plugins.outcome }}`                                                                                        |
| **FN probes** (`workflowProblems`) | `createRequire`, `node --require`/`-r`, `npm run`, `npx`, `bash scripts/run.sh`, workflow `defaults.run.working-directory`, `cache/restore` miss, line-2 `# npm ci`, `.cjs`/`index.js`, `cd sub && node a.mjs` | **All 12 returned `[]` (missed)**         | Executed against `workflowProblems()` on `57bd8cfb`                                                                                                      |
| **FP probes** (`workflowProblems`) | String `"require('@scope/pkg')"`, template `` `\nimport "yaml"\n` ``, block comment, `echo "node ..."`, `npm --prefix . ci`, composite `bootstrap-deps.sh`, `if: false`                                        | **All 7 flagged falsely**                 | Returned problem objects for valid workflows                                                                                                             |

REVIEW-615-R11-DONE
