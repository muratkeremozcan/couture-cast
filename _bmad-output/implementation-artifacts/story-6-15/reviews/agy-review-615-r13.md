# Review Round 13 — PR/Handover #615 (`tea615`)

Targets reviewed (strictly read-only across all repo worktrees; mutants and probes executed only in detached `/tmp/wt-615-mutant-r13-tea` and `/tmp/wt-615-mutant-r13-615`, removed and pruned immediately after):

- **Part A** (`/Users/murat/opensource/cc/couture-cast-wt-615-tea`, `tea/no-install-imports`, commit `8de2b7fb`, parent `c9cd3132`): `scripts/ci/workflow-node-deps.mjs` (542 lines, TypeScript AST `specifiers` + shell parser) & `scripts/ci/workflow-node-deps.test.mjs`.
- **Part B** (`/Users/murat/opensource/cc/couture-cast-wt-615-tea`, `tea/network-timeout-stub`, commit `d144937f`, parent `0156d41a`): `scripts/ci/android-native-workflow.test.mjs` (`android-network-timeout.sh` leak check).
- **Part C** (`/Users/murat/opensource/cc/couture-cast-wt-615`, range `0156d41a..76b60289`): `test-store-proxy.mjs`, `test-store-output.mjs`, `test-store-journey.mjs`, `test-store-runner.mjs`, `run-test-store-journey.mjs`, `worklets-staged-gradle.mjs`, and their test files.

---

## Findings (P0–P3)

### P2 — Part C: `writeRunOutputs` writes the report before running `assertEvidenceClean`, leaving a leaked file on disk (`scripts/lib/test-store-output.mjs:127-132`)

- **Closure verification (`0156d41a..76b60289`)**:
  - `C1` (`test-store-proxy.mjs:24, 46-47`): `ID_BEARING` covers `'users'`, `'members'`, `'receipts'`, `'subscribers'`; mutant removing `'receipts'` was **killed**.
  - `C2` (`test-store-output.mjs:46-111`, `run-test-store-journey.mjs:468-477`): `base64Fragments` alignment math (`offset = 0, 1, 2`), double URL encoding, case-folding, JSON `\u` escapes, and `extraIds: [member?.token, testStoreKey, ...Object.values(bypassHeaders)]` all work cleanly; mutants `C2a` (offset 0 only), `C2b` (drop double URL encode), `C2c` (drop `\u` escape) were **killed**.
  - `C3a` (`test-store-runner.mjs:223-224`, `test-store-journey.mjs:184-210`): failure messages pass through `redactMessage`, and mutant `C3a` bypassing `redactMessage` was **killed**.
  - `C5` (`worklets-staged-gradle.mjs:42-45`): refuses 0 or >1 `-PreactNativeArchitectures=` flags; mutant `C5` reverting `flags.length !== 1` was **killed**.
- **Remaining P2 gap**: In `writeRunOutputs({ dirs, label, report, member, extraIds })` (`scripts/lib/test-store-output.mjs:127-132`), `writeEvidence(dirs, `${label}.json`, report)` writes the report into `dirs.evidence` **before** calling `assertEvidenceClean(dirs, [member?.userId, ...extraIds])`. When `assertEvidenceClean` detects a leak and throws `test_store_evidence_leak`, the offending `${label}.json`file remains in`dirs.evidence`.
- **Concrete failure scenario**: A CI job running `run-test-store-journey.mjs --out "$RUNNER_TEMP/evidence"` catches a nonzero exit on `test_store_evidence_leak`, then runs its `if: always()` `actions/upload-artifact` step over `$RUNNER_TEMP/evidence` — uploading the leaked `${label}.json` that `writeRunOutputs` already wrote before throwing. Scanning serialized `report` in memory (or deleting/staging before committing to `dirs.evidence`) avoids persisting a dirty file.

---

### P3 — Part C: Two Part C mutants survived (`test-store-runner.test.mjs`, `test-store-journey.test.mjs`)

1. **`unpaid-failure` refresh assertion untested in `runJourney` (`C4b` SURVIVED — `scripts/lib/test-store-runner.mjs:119-128`, `scripts/lib/test-store-runner.test.mjs:88-99, 426-441`)**:
   - `C4a` (removing `assertNoForwardedRefresh` from `'unpaid-cancel'`) was **killed** by `a refresh during the unpaid cancel fails that step` (`test-store-runner.test.mjs:426`).
   - `C4b` (removing `assertNoForwardedRefresh` from `'unpaid-failure'`) **survived** (12/12 passed, exit 0) because `fakeIo` in `test-store-runner.test.mjs` has `faults.refreshOnCancel` but no `faults.refreshOnFailure` test driving `'unpaid-failure'`.
2. **`redactMessage` cap asserted tautologically against imported `MESSAGE_CAP` (`C3b` SURVIVED — `scripts/lib/test-store-journey.test.mjs:436`)**:
   - Line 436 asserts `redactMessage('x '.repeat(400)).length <= MESSAGE_CAP + 3` using the imported constant `MESSAGE_CAP`. Mutating `MESSAGE_CAP = 300` -> `800` in `test-store-journey.mjs:196` **survived** (19/19 passed, exit 0). Pinning an explicit numeric ceiling (e.g. `<= 303`) kills the mutant.

---

### P3 — Part A: TS AST closes all 8 R12 JS/shell bypasses; 4 edge-case load patterns remain (`scripts/ci/workflow-node-deps.mjs:41-106`)

- **All R12 closures verified in `/tmp/wt-615-mutant-r13-tea` (`8de2b7fb`)**:
  - `R12-FN-postfix-div-masks-require`, `R12-FN-if-regex-quote-unmasked`, `R12-FN-regex-after-paren-multiline`, `R12-FN-node-e-with-dollar-backtick` (and single-quoted `-e` with `$`), `R12-FN-createRequire-nested-2-parens`, `R12-FN-node-flags-extensionless-script`, `R12-FN-import-meta-resolve`, `R12-FN-let-reassigned-createRequire`, and `process.getBuiltinModule(...).createRequire(...)` **all now report the package import cleanly**.
- **Judgment on `npx`**: Agree `npx` stays out of scope for a repository-script import checker, since `npx` by design resolves/downloads package binaries on its own rather than importing `node_modules` from a repository script. (Note: any job invoking `npx <pkg>` before install still depends on network/npm fetch unless preinstalled.)
- **Minor remaining bypasses (`R13-FN-*`, low risk in normal CI scripts)**:
  - **Aliased or destructured `createRequire` (`isCreateRequire` at `workflow-node-deps.mjs:43-47`)**: `import { createRequire as cr } from 'node:module'` (`R13-FN-aliased-createRequire-import => []`) and `const { createRequire: cr } = mod` (`R13-FN-destructured-createRequire => []`) miss `node.expression.text === 'createRequire'`.
  - **Wrapper factory returning `createRequire`**: `const req = () => createRequire(import.meta.url); req()('yaml')` (`R13-FN-wrapper-helper-returning-createRequire => []`).
  - **Shell heredocs (`commands`/`nodeCommand`)**: `node --input-type=module <<'EOF'\nimport 'yaml'\nEOF` (`R13-FN-heredoc-node-stdin => []`).

---

### P3 — Part B: Leak check (`d144937f`) is meaningful on Linux CI and cannot hang, with minor runtime/flake nuances (`scripts/ci/android-native-workflow.test.mjs:383-462`)

- **Is the check meaningful on Linux CI? Yes**:
  - Waiting for `${dir}/metro-child` in the `curl` stub guarantees `/bin/sleep 30 &` is spawned before `stop_services` runs.
  - Redirecting bash output to `script.log` (`stdio: ['ignore', output, output]`) ensures `spawnSync` returns immediately when bash exits instead of holding the pipe open until leaked grandchildren die.
  - Removing `trap stop_services EXIT\n` directly fails cleanup and proves `childAlive === true` (`status === 0, child > 0, childAlive === true`).
- **Can the new test hang or flake?**
  - **Cannot hang**: `curl` wait is bounded (`100 * 0.1s = 10s`), `spawnSync` uses file stdio (not pipes), `Atomics.wait` is bounded (`5000ms`), and `sleep` inside `android-network-timeout.sh` is stubbed to `exit 0`.
  - **Three minor timing/process-hygiene issues**:
    1. **Guaranteed 5s wait in the no-trap test (`lines 438-444`)**: Because `child` stays alive in `"Metro's grandchild outlives..."`, `while (alive(child) && Date.now() < deadline)` always sleeps the full 5s deadline (observed `5341ms` vs `314ms` for normal pass) before SIGKILLing `child`. Under a hypothetical >25s host stall, `/bin/sleep 30` could expire before `Date.now() < deadline` ends, causing a spurious `childAlive === false` flake.
    2. **Asymmetric tarpit timeout (`line 383`)**: The `node` tarpit stub uses `exec /bin/sleep 5`, while `curl` waits up to `10s` for `metro-child`. If CI CPU contention delays `npx` > 5s before line 61 (`kill -0 "$tarpit"`), `tarpit` exits on its own and flakes the run; using `/bin/sleep 30` matches Metro's window.
    3. **Orphaned parent stub in the no-trap test (`lines 383, 388, 443`)**: Line 443 kills `child` (`metro-child`) only, leaving `npx`'s `exec /bin/sleep 30` (and `node`'s `sleep 5`) alive until their sleep completes (~25s/5s); harmless to `node --test` because pipes aren't held open, though recording and reaping `npx`/`node` PIDs in `finally` keeps the runner completely clean.

---

## Codex Security Diff-Scan Assessment

- **Preflight**: `config_preflight.py --profile security_diff_scan` returned `status: ready` on both repositories (`goal_tools_available=false` only `suggest`).
- **Security review**:
  - **Part A (`8de2b7fb`)**: Uses TypeScript's parser purely read-only (`createSourceFile`) with zero execution of untrusted code; AST closes all R12 `maskJs` obfuscation/edge-case bypasses of the pre-install CI gate.
  - **Part B (`d144937f`)**: Stubbed CI script test only; no secrets or untrusted external inputs.
  - **Part C (`0156d41a..76b60289`)**: Closes base64/base64url/double-URL/unicode-escape/extraIds leak-detection gaps, redacts failure error messages, and blocks duplicate `-PreactNativeArchitectures=` overrides. Only remaining security hygiene gap is `writeRunOutputs` persisting `${label}.json` into `dirs.evidence` prior to throwing `test_store_evidence_leak` (`P2`).

---

## Executed Suites & Mutants Summary

| Target                                                  | Command / Scope                                                                                                                                                            | Observed Result                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `wt-615-tea` (`8de2b7fb`, `/tmp/wt-615-mutant-r13-tea`) | `node --test scripts/ci/workflow-node-deps.test.mjs scripts/ci/coverage-shards.test.mjs`                                                                                   | **40/40 pass, 0 fail**                                                                                              |
| `wt-615-tea` (`8de2b7fb` probes)                        | 11 R12 probes + 6 R13 AST/shell probes                                                                                                                                     | All 8 R12 JS/shell bypasses fixed; 3 AST alias/wrapper + 1 heredoc + `npx` returned `[]`                            |
| `wt-615-tea` (`d144937f` HEAD)                          | `node --test scripts/ci/android-native-workflow.test.mjs`                                                                                                                  | **74/74 pass, 0 fail** (no-trap test ran in `5341ms`)                                                               |
| `wt-615` (`76b60289` HEAD)                              | `node --test scripts/lib/test-store-*.test.mjs scripts/ci/worklets-staged-gradle.test.mjs scripts/ci/android-native-workflow.test.mjs scripts/ci/coverage-shards.test.mjs` | **140/140 pass, 0 fail**                                                                                            |
| `wt-615` mutants (`/tmp/wt-615-mutant-r13-615`)         | 9 mutants (`C1`, `C2a`–`C2c`, `C3a`–`C3b`, `C4a`–`C4b`, `C5`)                                                                                                              | **7 killed**, **2 survived** (`C3b` `MESSAGE_CAP = 800`, `C4b` drop `assertNoForwardedRefresh` on `unpaid-failure`) |

REVIEW-615-R13-DONE
