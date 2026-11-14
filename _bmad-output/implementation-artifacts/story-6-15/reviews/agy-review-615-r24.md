# Review — `tea615` Round 24 (`4fff09fc..5030a682`)

Target: `/Users/murat/opensource/cc/couture-cast-wt-615`, range `4fff09fc..5030a682` (`5030a682`).
Verification suite: `node --test scripts/lib/evidence-manifest*.test.mjs scripts/lib/minified-debuggable*.test.mjs scripts/lib/resolved-app-config*.test.mjs scripts/lib/test-store-*.test.mjs` — `131` tests, `131` pass, `0` fail (`21428.47ms` at `5030a682`; `21070.71ms` post-cleanup). All mutants and probes ran in `/tmp/wt-615-mutant-r24` (removed and `git worktree prune`d after).
Security lens (`~/.codex/skills/codex-security-review/SKILL.md`): `config_preflight.py --profile security_diff_scan` returned exit `2` (`status: "incomplete"`: `delegated_workers: unknown`, `goal_tools: unknown`), so the security diff scan ran in single-agent mode across `4fff09fc..5030a682`.

## Verdict

- **No P0 or P1; one P2 finding** in `scripts/lib/evidence-manifest.mjs` where a timeout-killed `git` call (`ETIMEDOUT`, `status: null`, `stdout: ''`) silently bypasses dirty-tree checks or produces incomplete/`null`-filled manifests instead of failing.
- All five closure mutants (including glob-only revert) were **CAUGHT**. `resolved-app-config.mjs` and `minified-debuggable-evidence.mjs` both take their failure paths cleanly on `ETIMEDOUT`.

---

## Closure Verification (Mutants in Detached `/tmp/wt-615-mutant-r24`)

| Mutant                                                                   | Result     | Failing Test                                                                        |
| ------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| `M1_glob_only_revert` (`test-store-spawn.test.mjs:226`)                  | **CAUGHT** | `every spawnSync, execFileSync and execSync the Test Store driver loads is bounded` |
| `M2_evidence_manifest_unbounded_git` (`evidence-manifest.mjs:103-108`)   | **CAUGHT** | `every spawnSync, execFileSync and execSync the Test Store driver loads is bounded` |
| `M3_evidence_manifest_unbounded_show` (`evidence-manifest.mjs:120-125`)  | **CAUGHT** | `every spawnSync, execFileSync and execSync the Test Store driver loads is bounded` |
| `M4_minified_unbounded_run` (`minified-debuggable-evidence.mjs:214-215`) | **CAUGHT** | `every spawnSync, execFileSync and execSync the Test Store driver loads is bounded` |
| `M5_resolved_app_config_unbounded` (`resolved-app-config.mjs:45-46`)     | **CAUGHT** | `every spawnSync, execFileSync and execSync the Test Store driver loads is bounded` |

---

## Findings

### P2-1: Killed or errored `git` / `show` calls in `evidence-manifest.mjs` silently pass dirty trees or write wrong manifests

- **Location:** `scripts/lib/evidence-manifest.mjs:102-127`, `scripts/lib/evidence-manifest.mjs:210-216`, `scripts/lib/evidence-manifest.mjs:222-229`, `scripts/lib/evidence-manifest.mjs:249`, `scripts/lib/evidence-manifest.mjs:272-302`
- **Issue & live probes:** `git()` returns `{ ok: result.status === 0, out: result.stdout.trim() }` without throwing on `result.error` (`ETIMEDOUT`), and multiple callers ignore `ok` or conflate `ETIMEDOUT` (`status: null`) with "not found":
  1. **`dirtyInputs` (`lines 272-279`):** `const { out } = git(['status', ...], cwd)` ignores `ok`. When `git status` was stalled past `GIT_TIMEOUT_MS` (`Probe 1`) on a working tree with a dirty `scripts/run-test-store-journey.mjs`, `writeManifest({ leg: 'test-store', rev: 'HEAD', requireClean: true })` **succeeded without throwing `evidence_manifest_dirty_inputs`** (`inputs count: 96`).
  2. **`globFiles` (`lines 222-229`):** `const { out } = git(['ls-tree', ...], cwd)` ignores `ok`. When `git ls-tree` timed out (`Probe 2`), `writeManifest` **succeeded** (`hasMaestro: false`), silently omitting every `maestro/` file from `inputs`.
  3. **`objectId` (`lines 113-116`):** On `ETIMEDOUT`, `ok` is `false` so `objectId` returns `null` identically to a missing file (`Probe 3`: `writeManifest` **succeeded with `null inputs: 96 of 96`**). In `uncoveredReads` (`line 249`), `objectId(...) !== null` would also evaluate to `false` and skip reporting uncovered reads.
  4. **`importClosure` spawned script check (`lines 210-216`):** `show(rev, named, cwd) !== null` treats a `show` `ETIMEDOUT` (`status: null -> null`) on a spawned `scripts/*.mjs` script as absent, silently dropping it from `inputs`.
- **Concrete failure scenario:** Under heavy I/O or a stalled Git subprocess on CI, `GIT_TIMEOUT_MS` kills `git status`, `git ls-tree`, or `git rev-parse --verify` after 30 s, and `writeManifest` / `changedInputs` exits `0` with a dirty-tree false pass or a manifest whose `inputs` omits `maestro/` flows or marks existing inputs as `null`.
- **Recommendation:** In `git()`, throw on `result.error`; require `ok` in `dirtyInputs`, `globFiles`, and `rev-parse`; in `objectId` and `show`, throw when `result.error` (only returning `null` for clean "object does not exist" non-error exits).

### P3-1: `driverClosure` does not follow repository path literals for spawned sub-scripts

- **Location:** `scripts/lib/test-store-spawn.test.mjs:201-217`, `scripts/lib/evidence-manifest.mjs:210-216`
- **Issue & scenario:** Unlike `importClosure` (`evidence-manifest.mjs:210-216`), `driverClosure` follows `relativeImports` and `moduleRelativeLiterals` only (`test-store-spawn.test.mjs:209-214`). Currently neither `run-test-store-journey.mjs` nor `test-store-preview-webhook.mjs` spawns another `scripts/*.mjs` by path literal, so all loaded runtime files are covered; if a future change spawns a repo helper script by path string, `driverClosure` will omit it from `unboundedCalls`.

---

## Judgment Summary

1. **Failure paths in `resolved-app-config.mjs` and `minified-debuggable-evidence.mjs`:**
   - **Sound.** In `resolvedAppConfig` (`resolved-app-config.mjs:49-59`), `result.status !== 0` is checked before `JSON.parse(result.stdout)`. **Live Probe 4** (`10ms` timeout) returned `{"error":"expo config exited null: spawnSync .../node ETIMEDOUT"}` cleanly without ever returning `{ config }`.
   - In `minified-debuggable-evidence.mjs:210-222`, `run()` checks `if (result.status !== 0) throw new Error(...)` before returning `result.stdout`, so a killed `aapt2`/`adb` call always throws.
2. **Are timeouts (`git` 30 s, `aapt2`/`adb` 120 s, `expo config` 120 s) long enough for a cold CI runner?**
   - Yes. `expo config --json --type introspect` (`EXPO_OFFLINE=1`) runs in a few seconds even cold (~1–15 s vs 120 s bound); `aapt2` and `adb` manifest/APK operations complete in seconds (120 s bound); `git rev-parse`/`ls-tree`/`status`/`show` on tracked scripts and flows run in tens of milliseconds (30 s bound).
3. **Do other callers of these shared modules change behavior?**
   - `resolved-app-config.mjs` (`scripts/ci/android-release-abis.mjs`), `minified-debuggable-evidence.mjs` (`android-native.yml`, `android-native-workflow.mjs`), and `evidence-manifest.mjs` behave identically for all runs finishing under 30 s / 120 s, and convert infinite tool hangs into timeouts (`{ error }` / `throw` for the first two, and P2-1 fix needed for `evidence-manifest.mjs`).

REVIEW-615-R24-DONE
