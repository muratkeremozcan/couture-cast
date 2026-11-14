# Story 6.15 Code & Security Review — Round 9

- **Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615` (`a9816083`, strictly read-only)
- **Range**: `8c521f44..a9816083` (`a2b04887`, `2711779a`, `b0910b09`, `953df770`, `424aeec1`, `82972a26`, `a9816083`)
- **Secret handling**: No `.env` files or secret values were read.

## Summary Verdict

No **P0** or **P1** findings. Two **P2** findings in `scripts/lib/evidence-manifest.mjs` (`LEGS` omits real runtime inputs — `live-font-residual-baselines.json`, `maestro/subflows/open-app.yaml`, and `ios-build`'s `maestro/` + `apps/api/` + `packages/db/` dependencies; and `verify` ignores dirty working trees and accepts `--rev` other than `HEAD`), plus two **P3** notes (`relativeImports` / `entries: []` limits; `DEP0187` when `usage` is `undefined` in `collectEvidence`). All R8 closures (`424aeec1`, `82972a26`) and `b0910b09` / `953df770` / `a9816083` invariants passed targeted mutant testing.

---

## Findings (Ranked P0–P3)

### P2-1 — `evidence-manifest.mjs` `LEGS` omits committed fixtures, Maestro subflows, and backend assets that legs read, so changed heads pass `verify`

- **Location**: `scripts/lib/evidence-manifest.mjs:40-58, 133-141`
- **Mechanism**:
  1. **`live-font` (`line 42`)**: `globs: ['scripts/lib/live-font-*']` uses non-recursive `git ls-tree --name-only <rev>:scripts/lib` (`line 136`), so **`scripts/lib/fixtures/live-font-residual-baselines.json`** (loaded by `scripts/run-live-font-proof.mjs:561-562` to decide which failing probes count as approved residuals) is not recorded.
  2. **`network-timeout` (`lines 50-58`)**: records `maestro/network-timeout`, omitting **`maestro/subflows/open-app.yaml`** (invoked by `maestro/network-timeout/dev-client-timeout.yaml:36` via `- runFlow: ../subflows/open-app.yaml`, which also invokes `absorb-expo-dev-sheet.yaml`).
  3. **`ios-build` (`lines 45-49`)**: records `[...APP_INPUTS]`, `scripts/lib/story68-*`, and `scripts/run-story68-native.mjs`'s JS import closure, omitting:
     - **`maestro/story68`**, **`maestro/story65`**, **`maestro/share-card-export.yaml`**, and **`maestro/subflows`** (`scripts/run-story68-native.mjs:311, 593, 1220, 1286, 1327-1328, 1520` etc. execute these Maestro flows);
     - **`apps/api`** (`scripts/run-story68-native.mjs:990-1001` copies `apps/api/src/modules/share-cards/assets/*.json` into the generated Xcode UI test project, and `scripts/lib/story68-api-entry.mjs:8-29` boots `apps/api/dist/src/main.js` / `load-env.js`);
     - **`packages/db`** (`scripts/lib/story68-api-entry.mjs:3` instantiates `@prisma/client`).
- **Concrete failure scenario**: A follow-up commit loosens `scripts/lib/fixtures/live-font-residual-baselines.json`, alters `maestro/subflows/open-app.yaml`, or modifies `maestro/story68/save.yaml` / `apps/api/src/modules/share-cards/assets/en-US.json`, and `node scripts/lib/evidence-manifest.mjs verify <manifest>` exits `0` (`OK ... inputs unchanged`), falsely accepting prior device evidence as current for `HEAD`.
  - **Empirically reproduced** in the isolated mutant worktree: committing edits to each of those three files still yielded `exit 0` (`OK`) on `verify` for `live-font`, `network-timeout`, and `ios-build`.

### P2-2 — `evidence-manifest.mjs verify` passes on a dirty working tree and when `--rev` differs from `HEAD`

- **Location**: `scripts/lib/evidence-manifest.mjs:174-206, 219-237`
- **Mechanism**: `writeManifest` (`lines 174-181`) rejects `sha !== head` and `dirtyInputs(...)` only when `requireClean` is `true` (used by `write`, `line 216`). `verify` (`lines 219-237`) calls `changedInputs(manifest, { rev })` (`line 226`), which calls `writeManifest({ leg: manifest.leg, rev, cwd, requireClean: false })` (`line 196`) without running `dirtyInputs(...)` on the working tree and without verifying that `--rev` resolves to `HEAD`.
- **Concrete failure scenario**:
  1. A developer has uncommitted edits under `apps/mobile/app.config.ts` or `scripts/lib/...` in a local worktree and runs `node scripts/lib/evidence-manifest.mjs verify <manifest>` before committing; `changedInputs` hashes committed `HEAD:<path>` objects and exits `0` (`OK`), missing dirty local inputs.
  2. Passing `verify <manifest> --rev <build-sha>` after `HEAD` has moved on evaluates the manifest against `<build-sha>` and exits `0` (`OK`).
  - **Empirically reproduced** both cases in the isolated worktree (`PROBE_VERIFY_DIRTY: 0 OK` and `PROBE_VERIFY_OLD_REV: 0 OK`).

### P3-1 — `relativeImports` misses `createRequire`/`require` and spawned scripts; `test-store` and `upgrade` list `entries: []`

- **Location**: `scripts/lib/evidence-manifest.mjs:68-77, 98-109, 121-130`
- **Concrete failure scenario**: `relativeImports` tracks static/dynamic ES `import` and `export ... from` string literals only (`lines 100-105`), so a harness helper imported via `createRequire(...)` or invoked via `spawnSync('node', ['scripts/...'])`, or scripts for `test-store` / `upgrade` (currently `entries: []`), would not enter the manifest automatically unless added to `paths` or `globs`.

### P3-2 — Node `DEP0187` deprecation warning when `collectEvidence` is called with `usage: undefined`

- **Location**: `scripts/lib/minified-debuggable-evidence.mjs:273-275`
- **Concrete failure scenario**: Passing omitted/undefined `usage` into `collectEvidence({ apk, mapping, aapt2 })` hits `fs.existsSync(undefined)` inside `for (const file of [apk, mapping, usage])` (`line 274`). It fails closed as desired (`minified_debuggable_output_missing: undefined`), while emitting `[DEP0187] DeprecationWarning: Passing invalid argument types to fs.existsSync is deprecated` in `node --test` output (`if (!file || !fs.existsSync(file))` avoids it cleanly).

---

## Judge Questions

### 1. Can any production or EAS build ever set `COUTURE_CONFIG_NO_ENV_FILES` or `EXPO_NO_DOTENV` and lose its env?

**No** in the current repository:

- Repo-wide search (`rg -n "COUTURE_CONFIG_NO_ENV_FILES|EXPO_NO_DOTENV"`) shows `COUTURE_CONFIG_NO_ENV_FILES` appears only in `scripts/lib/resolved-app-config.mjs:11,25`, `scripts/lib/resolved-app-config.test.mjs:27`, and `apps/mobile/app.config.ts:12,14`; `EXPO_NO_DOTENV` appears only in `scripts/lib/resolved-app-config.mjs:10,24`, `scripts/lib/resolved-app-config.test.mjs:26`, and `apps/mobile/plugins/with-story68-release-network.test.js:51`.
- Neither `.github/workflows/*.yml`, `eas.json`, nor `package.json` sets either variable, and `resolveEnv()` (`scripts/lib/resolved-app-config.mjs:17-27`) builds a child-process env object without mutating parent `process.env`.
- Furthermore, in `eas.json` (`build.production`), EAS supplies build environment variables directly in `process.env` rather than `.env.local`, so `app.config.ts:14` gating root `dotenv` files behind `COUTURE_CONFIG_NO_ENV_FILES !== '1'` only affects callers explicitly passing `COUTURE_CONFIG_NO_ENV_FILES=1`.

### 2. Can `android-native.yml` run on a PR or push, leak a secret, or pass while a step it depends on failed (pipefail, `if` conditions)?

- **PR / push trigger**: **No.** `.github/workflows/android-native.yml:31-35` defines only `schedule` (`'37 3 * * *'`) and `workflow_dispatch` (no inputs), enforced by `scripts/ci/android-native-workflow.mjs:103-114`.
- **Secrets**: **No secret exposure found.** Top-level `permissions: { contents: read }` (`lines 37-38`), no job-level permissions, and zero `${{ secrets.* }}` references (`android-native-workflow.mjs:115-127`). Uploaded artifacts (`commit.txt`, `minified-debuggable.json`, `release-abis.txt`, `tarpit.log`, `metro.log`, `maestro/`, screenshot) hold no credentials and expire in 7 days.
- **Passing when a dependency failed**: **No bypass found.**
  - In `android-release-builds`: `minified_debuggable` (`line 100`) and `release_abis` (`line 106`) gate on `${{ !cancelled() && steps.android_build.outcome == 'success' }}` and run `set -euo pipefail` before `| tee ...`. If `android_build` (or an earlier setup step) fails, those checks skip so they don't misreport against missing artifacts, while the failed step still fails the job (`continue-on-error` is absent and forbidden by `android-native-workflow.mjs:143-145`). The final `upload-artifact` uses `if: always()` (`line 111`, `if-no-files-found: error`), which uploads evidence without masking earlier step failures.
  - In `android-network-timeout`: `scripts/ci/android-network-timeout.sh:11` sets `set -euo pipefail`; `line 35` checks Metro outside `if`, `line 36` warms the bundle with `curl -fsS`, `line 39` verifies `kill -0 "$tarpit"` before `adb install` (`line 41`) and `maestro` (`lines 42-46`). The only `|| true` is inside `stop_services` (`trap stop_services EXIT`, `lines 22-25`). Even if the tarpit dies after `line 39`, `maestro/network-timeout/dev-client-timeout.yaml:246-256` fails if `hero-error-state` appears before the 8 s wait finishes (`assertVisible: weather-header-skeleton`, `assertNotVisible: hero-error-state`).

### 3. Can `evidence-manifest.mjs` miss an input a leg really reads (dynamic import, shell script, fixture, config) so a changed head passes `verify`?

**Yes — P2-1 and P3-1 above.** Specifically verified: `scripts/lib/fixtures/live-font-residual-baselines.json` (`live-font`), `maestro/subflows/open-app.yaml` (`network-timeout`), and `maestro/story68` / `maestro/story65` / `maestro/subflows` / `apps/api` / `packages/db` (`ios-build`).

### 4. Can `verify` pass on a dirty or different tree?

**Yes — P2-2 above.** `verify` checks `rev` (`HEAD` by default) via `requireClean: false` (`line 196`), so uncommitted working-tree edits or an explicit `--rev <build-sha>` still pass `verify` with `exit 0`.

---

## Security Review Lens (`~/.codex/skills/codex-security-review/SKILL.md`)

Applied per `codex-security-review` -> resolved plugin `/Users/murat/.codex/plugins/cache/openai-curated/codex-security/d6169bef` (`skills/security-diff-scan/SKILL.md`, direct read-only diff review; app/subagent scan tools skipped to keep workspace strictly read-only):

- **CI workflow isolation (`b0910b09`)**: `android-native.yml` uses `schedule` + inputless `workflow_dispatch`, `permissions: { contents: read }`, no `pull_request` / `pull_request_target`, no `${{ secrets.* }}`, and strict command pinning in `android-native-workflow.mjs`. `network-tarpit.mjs` binds `0.0.0.0:4010` inside the ephemeral `ubuntu-latest` VM, discards socket data, and closes cleanly on exit.
- **Config isolation (`424aeec1`)**: `resolvedAppConfig` drops ambient `process.env` except `PATH`/`HOME`, sets `EXPO_OFFLINE: '1'`, `EXPO_NO_TELEMETRY: '1'`, `EXPO_NO_DOTENV: '1'`, and `COUTURE_CONFIG_NO_ENV_FILES: '1'`, preventing local dev secrets/flags from tainting release ABI/R8 evidence.
- **Gate integrity (`953df770`, `a9816083`)**: `P2-1` and `P2-2` weaken the merge-evidence integrity check when missed files change or `verify` runs on a dirty/non-`HEAD` tree.
- **Docs (`a2b04887`)**: `deployment-guide.md` and `learning-path-step-by-step.md` accurately capture SDK 54 Step 0 boundaries and contain no secrets or credentials.

---

## Mutant Verification (Detached `/tmp/wt-615-mutant-r9`, removed after run)

| Commit           | Mutant                                                                                                                  | Result                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `424aeec1` (M1a) | Omit `COUTURE_CONFIG_NO_ENV_FILES: '1'` in `resolveEnv` (`scripts/lib/resolved-app-config.mjs:25`)                      | **KILLED** (`resolved-app-config.test.mjs`, `android-release-abis.test.mjs`, rc=1) |
| `424aeec1` (M1b) | Spread `...env` in `resolveEnv` (`scripts/lib/resolved-app-config.mjs:18`)                                              | **KILLED** (`resolved-app-config.test.mjs`, `android-release-abis.test.mjs`, rc=1) |
| `424aeec1` (M1c) | Bypass `COUTURE_CONFIG_NO_ENV_FILES !== '1'` check in `apps/mobile/app.config.ts:14`                                    | **KILLED** (`android-release-abis.test.mjs`, rc=1)                                 |
| `82972a26` (M2a) | Drop `usage` from `for (const file of [apk, mapping, usage])` (`scripts/lib/minified-debuggable-evidence.mjs:273`)      | **KILLED** (`minified-debuggable-evidence.test.mjs`, rc=1)                         |
| `82972a26` (M2b) | Ignore `resolvedGradleProperties(resolvedConfig)[MINIFY_PROPERTY]` (`scripts/lib/minified-debuggable-evidence.mjs:168`) | **KILLED** (`minified-debuggable-evidence.test.mjs`, rc=1)                         |
| `82972a26` (M2c) | Drop `cx06_app_root_missing` `package.json` guard (`scripts/lib/cx06-reflection-mutant.mjs:68-69`)                      | **KILLED** (`cx06-reflection-mutant.test.mjs`, rc=1)                               |
| `b0910b09` (M3a) | Add `pull_request:` trigger to `.github/workflows/android-native.yml:35`                                                | **KILLED** (`android-native-workflow.test.mjs`, rc=1)                              |
| `b0910b09` (M3b) | Reference `${{ secrets.EXPO_TOKEN }}` in `.github/workflows/android-native.yml`                                         | **KILLED** (`android-native-workflow.test.mjs`, rc=1)                              |
| `b0910b09` (M3c) | Weaken `set -euo pipefail` to `set -u` in `scripts/ci/android-network-timeout.sh:11`                                    | **KILLED** (`android-native-workflow.test.mjs`, rc=1)                              |
| `b0910b09` (M3d) | Add `continue-on-error: true` to `release_abis` in `.github/workflows/android-native.yml:105`                           | **KILLED** (`android-native-workflow.test.mjs`, rc=1)                              |
| `a9816083` (M4a) | Drop `sha !== head` guard in `writeManifest` (`scripts/lib/evidence-manifest.mjs:178`)                                  | **KILLED** (`evidence-manifest.test.mjs`, rc=1)                                    |
| `a9816083` (M4b) | Drop `dirtyInputs` guard in `writeManifest` (`scripts/lib/evidence-manifest.mjs:180`)                                   | **KILLED** (`evidence-manifest.test.mjs`, rc=1)                                    |
| `953df770` (M4c) | Drop dynamic `import(...)` regex in `relativeImports` (`scripts/lib/evidence-manifest.mjs:103`)                         | **KILLED** (`evidence-manifest.test.mjs`, rc=1)                                    |

---

## Test Runs Observed

- `node --test scripts/lib/resolved-app-config.test.mjs scripts/ci/android-release-abis.test.mjs scripts/lib/minified-debuggable-evidence.test.mjs scripts/lib/cx06-reflection-mutant.test.mjs scripts/ci/android-native-workflow.test.mjs scripts/lib/evidence-manifest.test.mjs scripts/lib/live-font-*.test.mjs`:
  - **211 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo** (`17` suites).

REVIEW-615-R9-DONE
