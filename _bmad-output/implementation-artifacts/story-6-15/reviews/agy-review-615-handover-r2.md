# Story 6.15 Handover Review R2

- **Branch / Range**: `feat/story-6-15-expo-sdk-58` (`8586f43c..dee515eb`: `aa68d881`, `41ef1b75`, `dee515eb`) in `/Users/murat/opensource/cc/couture-cast-wt-615`
- **Mode**: Read-only review; mutants and probes executed in a detached `/tmp/wt-615-mutant-r2` worktree at `dee515eb`, which was removed afterward.

## Findings

### P2 — `mountsKnown` requires any incidentally seen optional scope in every stage, so a legitimate capture omitting an unrequired scope false-fails the leg

- **Location**: [live-font-scale-proof.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/lib/live-font-scale-proof.mjs#L297-L303), [run-live-font-proof.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/run-live-font-proof.mjs#L220-L224), [run-live-font-proof.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/run-live-font-proof.mjs#L600)
- **Concrete failure scenario**: During `composer` (`SCREENS.composer.mount === 'modal'`), `open-composer.yaml` opens `<EdgeToEdgeModal>` over `HomeScreen` (`scope="home"`), and during `community`/`settings` the initial `home` tab remains mounted in the tab navigator. At `run-live-font-proof.mjs:600`, `activeMounts` is `['root', 'modal']`, so `readWithMounts` (`run-live-font-proof.mjs:220-224`) only retries when `root` or `modal` is missing and accepts attempt 1 if `home` is absent. However, `mountsKnown(mounts, 'modal')` at `live-font-scale-proof.mjs:301-302` gathers every scope key seen in any stage (`const scopes = new Set(mounts.flatMap((stage) => [...stage.keys()]))`) and requires every stage in `mounts` to carry it. When `before` captures `live-font-mount-home-h1,live-font-mount-modal-m1,live-font-mount-root-r1` and `immediate` legitimately omits the background `home` marker (`live-font-mount-modal-m1,live-font-mount-root-r1`), `evaluateLiveFontChange` returns `rootKnown: false`, `rootKept: false`, `verdict: 'unexpected'` (reproduced against `dee515eb`), failing the leg—or every leg if any stage consistently differs on whether a background scope appears. When `mount` is explicitly provided, `mountsKnown` should only require `['root', mount]` in every stage (keeping the all-seen-scopes fallback only when `mount` is omitted), while `sameMounts` still catches an actual id change on any scope that does appear across stages.

### P3 — `pr-checks.yml` `OUTCOME` expression evaluates to `steps.tests.outcome` (`'success'`) when `steps.plugins.outcome` is `'cancelled'`

- **Location**: [pr-checks.yml](file:///Users/murat/opensource/cc/couture-cast-wt-615/.github/workflows/pr-checks.yml#L371-L375), [coverage-shards.test.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/ci/coverage-shards.test.mjs#L66-L75)
- **Concrete failure scenario**: In `pr-checks.yml:375`, `OUTCOME: ${{ steps.plugins.outcome == 'failure' && 'failure' || steps.tests.outcome }}` evaluates accurately when `plugins.outcome` is `'success'` (returns `steps.tests.outcome`), `'failure'` (short-circuits to truthy `'failure'`), or `'skipped'` on non-mobile shards (returns `steps.tests.outcome`). However, if `steps.plugins.outcome == 'cancelled'` and `steps.tests.outcome == 'success'`, the expression evaluates to `'success'`. On line `371`, `Record this shard's result` is guarded by `if: ${{ !cancelled() && steps.tests.outcome != 'skipped' }}`, so a workflow/job cancellation skips recording (and `coverage-shards.mjs merge` treats a missing planned shard as failure). If that step condition were ever broadened to `always()` (like line `402`), or if the expression is evaluated standalone on a cancelled `plugins` step, it would write `outcome: "success"` into `coverage-shard-result-mobile.json`. Checking `(steps.plugins.outcome == 'failure' || steps.plugins.outcome == 'cancelled') && steps.plugins.outcome || steps.tests.outcome` makes the expression itself right across all four outcomes.

## R1 Closure & Prompt Checks

- **P2-1 closure (`mountsKnown`, `earlier` cross-leg comparison, `readWithMounts`)**: Verified closed on `dee515eb`. `readWithMounts` stops at 3 attempts and returns the last read without synthesizing missing markers (`markers: ['live-font-mount-root-r1']` -> `rootKnown: false`, `verdict: 'unexpected'`).
- **P2-2 closure (`mountsOf` Set per scope)**: Verified closed on `dee515eb` (`sameMounts` fails when one scope carries two distinct ids in a single capture).
- **P3 closure (skipped iOS repeat hands `parentEntry` down)**: Verified closed on `dee515eb` (`flattenHierarchy` skips a deeper identical-id copy below an unlabelled skipped repeat).
- **Security lens (`codex-security-review` / `security-diff-scan`)**: No P0/P1 security findings in `8586f43c..dee515eb` (bounded `readWithMounts` retry loop, anchored linear-time marker regexes, `steps.*.outcome` passed via `env:` to `JSON.stringify` rather than interpolated in shell scripts).

## Mutant & Test Verification (`dee515eb`)

- **Clean test run** (`node --test scripts/lib/live-font-*.test.mjs scripts/ci/coverage-shards.test.mjs`): `110` passed, `0` failed, `0` skipped across `14` suites.
- **Mutants run in detached `/tmp/wt-615-mutant-r2` (removed cleanly afterward)**:
  1. `P2-1a` (`mountsKnown` reverted to root-only check): failed `4` tests (`a capture without the screen marker fails its leg`, `a screen that never shows its own marker fails every leg`, `a screen marker missing from any stage leaves identity unknown`, `the screen's own marker is required even when no stage shows it`).
  2. `P2-1b` (`identityCheck` drops `earlierMounts`): failed `2` tests (`a screen remounted by the revert between legs fails the later leg`, `a remount between legs of one launch is caught by the later leg`).
  3. `P2-1c` (`readWithMounts` `attempts = 1`): failed `1` test (`readWithMounts rereads a dump that drops a required marker, three reads at most`).
  4. `P2-2` (`mountsOf` overwrites scope in `Map` instead of accumulating a `Set`): failed `1` test (`two mounts of one scope in one capture are no kept identity`).
  5. `P3` (`flattenHierarchy` passes `entry ?? parentEntry` instead of `parentEntry` on skipped repeat): failed `1` test (`iOS skips a deeper copy with the labelled id below a skipped copy without one`).
  6. `CI OUTCOME` (`.github/workflows/pr-checks.yml:375` reverted to `${{ steps.tests.outcome }}`): failed `1` test (`a shard's recorded outcome includes the mobile plugin prebuild suites`).

REVIEW-615-HANDOVER-R2-DONE
