# Review — `tea615` Round 23 (`5cd05fcb..4fff09fc`)

Target: `/Users/murat/opensource/cc/couture-cast-wt-615`, range `5cd05fcb..4fff09fc` (`4fff09fc`).
Verification suite: `node --test scripts/lib/test-store-*.test.mjs` — `103` tests, `103` pass, `0` fail (`18712.79ms` in `/Users/murat/opensource/cc/couture-cast-wt-615` after `/tmp/wt-615-mutant-r23` cleanup; `18098.15ms` at first run).
Security lens (`~/.codex/skills/codex-security-review/SKILL.md`): `config_preflight.py --profile security_diff_scan` returned exit `2` (`status: "incomplete"`: `delegated_workers: unknown`, `goal_tools: unknown`), so the security diff scan ran in single-agent mode across `5cd05fcb..4fff09fc`; no P0–P2 security regressions found.

## Verdict

- **No P0, P1, or P2 blockers.** Commit `4fff09fc` cleanly closes all Round 22 P3s (`boundOf`, non-tolerated Android `adb force-stop`, strict `unboundedCalls` import/callee/const rules, and the `not-a-sha` `git rev-parse` driver test). All `8` closure mutants (including Round 22 `M4`) were **caught**, and all `7` Round 22 bypass probes now fail `unboundedCalls`.
- **Recommendation on static check scope:** Stop adding AST rules to `scripts/lib/test-store-spawn.test.mjs` — it is at the diminishing-returns knee (`322` lines guarding `45` lines of `scripts/lib/test-store-spawn.mjs`). Only two minor/informational P3 notes below.

---

## Closure Verification (Mutants & R22 Re-probes in `/tmp/wt-615-mutant-r23`)

### Mutants

| Mutant                                                                  | Result     | Failing Test                                                                                 |
| ----------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `M1_r22_M4_rev_no_sha_check` (`run-test-store-journey.mjs:131`)         | **CAUGHT** | `git rev-parse printing a non-sha fails the run as test_store_rev_failed`                    |
| `M2_boundOf_allow_zero` (`test-store-spawn.mjs:23`: `ms < 0`)           | **CAUGHT** | `--spawn-timeout-ms 0 fails...`, `boundOf takes positive safe integers...`                   |
| `M3_driver_no_boundOf_on_option` (`run-test-store-journey.mjs:124`)     | **CAUGHT** | `--spawn-timeout-ms abc fails...`, `--spawn-timeout-ms 9007199254740993 fails...`            |
| `M4_driver_run_no_boundOf` (`run-test-store-journey.mjs:145`)           | **CAUGHT** | `every spawnSync, execFileSync and execSync in the Test Store driver and helpers is bounded` |
| `M5_adb_force_stop_tolerate_status` (`run-test-store-journey.mjs:246`)  | **CAUGHT** | `android: a nonzero force-stop fails the step as test_store_stop_failed`                     |
| `M6_static_no_aliased_import` (`test-store-spawn.test.mjs:54`)          | **CAUGHT** | `the bound check rejects every bypass`                                                       |
| `M7_static_allow_non_callee` (`test-store-spawn.test.mjs:172`)          | **CAUGHT** | `the bound check rejects every bypass`                                                       |
| `M8_static_allow_zero_timeout_literal` (`test-store-spawn.test.mjs:52`) | **CAUGHT** | `the bound check rejects every bypass`                                                       |

### Round 22 Bypass Re-Probes (All Closed)

All seven probes in `test-store-spawn.test.mjs` (`unboundedCalls`) now report a miss:

- `aliased import`, `reassigned let B`, `timeout zero`, `timeout undefined` -> `misses: [ 'x.mjs:1 unbounded call' ]`
- `reassigned var`, `passed as value` -> `misses: [ 'x.mjs:1 spawnSync used other than as a direct callee' ]`
- `bracket access` -> `misses: [ 'x.mjs:1 cp (child_process) used other than by property' ]`

---

## Findings & Judgments

### P3-1: Remaining static-check boundaries vs diminishing returns

- **Location:** `scripts/lib/test-store-spawn.test.mjs:124-130, 194-214`, `scripts/run-test-store-journey.mjs:31-36`
- **Judgment & probes:**
  - **Outside-glob helper modules:** `test-store-spawn.test.mjs:195-203` scans only `scripts/run-test-store-journey.mjs` and `scripts/lib/test-store-*.mjs`. Non-`test-store-*` modules imported by the driver (`./lib/expo-dev-server.mjs`, `./lib/minified-debuggable-evidence.mjs` at `run-test-store-journey.mjs:31-36`, and `./lib/evidence-manifest.mjs`) are outside that glob, so an unbounded `spawnSync` added inside one of them would not be flagged by this test.
  - **`createRequire`, dynamic `import('node:child_process')`, async `spawn`/`exec`, inner shadowing:** Live probes returned `misses: []` for `createRequire`, dynamic `import()`, async `spawn`/`exec`, and inner shadowing (`const MS = 1000; function f() { const MS = 0; spawnSync(..., { timeout: MS, killSignal: 'SIGKILL' }) }`). (Calling a non-matching `boundOf` imported from `'./other.mjs'` _was_ caught: `misses: [ 'x.mjs:1 unbounded call' ]`.)
  - **Cost vs value:** Async `spawn` processes (`metro`, `logStream`) are long-lived and managed via `guard.child`, not a 30 s synchronous bound; `createRequire`, dynamic `import()`, and local shadowing of a top-level bound constant require significant symbol/scope modeling to catch deliberate bypasses rather than real contributor mistakes. This AST check has reached diminishing returns — do not add further complexity to `test-store-spawn.test.mjs` (at most, only include non-test imported driver helpers in `files` if ever desired).

### P3-2 (Informational): `boundOf` accepting `'1e3'` or `'0x10'` does not weaken safety

- **Location:** `scripts/lib/test-store-spawn.mjs:21-26`
- **Probe:** `boundOf('1e3') -> 1000`, `boundOf('0x10') -> 16`, `boundOf(' 300 ') -> 300`, while `0`, `'0'`, `'abc'`, `''`, `-5`, `1.5`, `null` all throw `test_store_spawn_timeout_invalid`.
- **Judgment:** Because `boundOf` checks `Number.isSafeInteger(ms) && ms > 0`, `'1e3'` and `'0x10'` still guarantee a finite positive millisecond bound (`>= 1` ms). Accepting valid numeric literals parsed by `Number(...)` cannot disable the timeout or inject `NaN`/`0`.

REVIEW-615-R23-DONE
