# Story 6.15 Handover Review R3

- **Branch / Range**: `feat/story-6-15-expo-sdk-58` (`7642df4e..a4369dae`: `96021618`, `a4369dae`) in `/Users/murat/opensource/cc/couture-cast-wt-615`
- **Mode**: Read-only review; mutants and probes executed in a detached `/tmp/wt-615-mutant-r3` worktree at `a4369dae`, which was removed afterward.

## Findings

### P2 — A `before` capture that misses `Home` on its single `makeCapture` read (or across every `settle` read) still lacks `Home` while later stages show it, false-failing `mountsKnown`

- **Location**: [run-live-font-proof.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/run-live-font-proof.mjs#L222-L227), [live-font-capture.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/lib/live-font-capture.mjs#L168-L179), [live-font-scale-proof.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/lib/live-font-scale-proof.mjs#L297-L303)
- **Concrete failure scenario**: At `a4369dae`, `mountTracker` starts each launch with only `base = ['root', screen.mount]` (`run-live-font-proof.mjs:393,604-607`) and widens only inside `makeCapture` _after_ `readWithMounts` returns (`run-live-font-proof.mjs:222-227`). Because `Home` is not in `mounts.scopes()` yet on leg 1's `before` capture (`composer` over `Home`, or `settings`/`community` with `Home` kept mounted), `readWithMounts` exits after **1 read** as soon as `root` and `screen.mount` appear—without retrying for a dropped `Home` marker. Even if every read of a `before` `settle` missed `Home`, `before` still finishes without `Home` (`tracker.scopes()` remains `['root', screen.mount]`). If `immediate` or `settled` then captures `Home`, `mountsKnown` (`live-font-scale-proof.mjs:301-302`) still sees `'home'` in one stage and missing in `before`, returning `rootKnown: false`, `rootKept: false`, and `verdict: 'unexpected'` (reproduced in `PROBE_BEFORE_DROPS_HOME`: `beforeReads: 1`, `verdict: "unexpected"`, `rootKnown: false`). Notice `mountTracker` resets at the right point for `runScreenJourney`'s 1-screen-per-launch flow—keeping widened scopes across legs of one launch and resetting on `launch()` (`run-live-font-proof.mjs:393`) and per-screen `mountTracker(...)` construction (`run-live-font-proof.mjs:604`)—though `mountTracker` itself has no screen-switch reset if one launch ever ran multiple screens. Requiring only `['root', mount]` in `mountsKnown` when `mount` is explicitly provided remains the cleaner fix over trying to widen to every incidental background scope.

## R2 Closure & Prompt Checks

- **P3 closure (`shardResult` + `PLUGINS_OUTCOME` + `mergeShardResults`)**: Verified closed at `a4369dae` ([pr-checks.yml](file:///Users/murat/opensource/cc/couture-cast-wt-615/.github/workflows/pr-checks.yml#L371-L377), [coverage-shards.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/ci/coverage-shards.mjs#L81-L110)).
  - `shardResult` cannot turn a real `tests` failure (`outcome: 'failure'`) into `'success'`: when `plugins` is `undefined`, `''`, `'skipped'`, or `'success'`, it returns `{ outcome, dirs, failures }` unchanged; for any other `plugins` value (`'failure'`, `'cancelled'`), it forces `outcome: 'failure'` and preserves existing `failures` while appending the `mobile plugin prebuild suites` failure (`reason: 'tests'` for `'failure'`, `'error'` otherwise).
  - `mergeShardResults` (`coverage-shards.mjs:34-59`) marks the merged `outcome` as `'failure'` whenever a planned shard's recorded `outcome !== 'success'` (or when a planned shard left no result), so `Fail unless every shard passed` (`pr-checks.yml:605`) goes red when a planned mobile shard has a failed or cancelled plugin step.
- **P2 closure (`mountTracker` widening after `before`, reset on `launch()`)**: Mechanism verified by mutants (`P2-a`, `P2-b`, `P2-c`); once `before` observes `Home`, subsequent `immediate`/`settled`/`updated` captures retry up to 3 reads for `Home`. Remaining P2 gap documented above when `before` itself drops `Home`.
- **Security lens (`codex-security-review` / `security-diff-scan`)**: No P0/P1 security issues introduced in `7642df4e..a4369dae`. `mountScopes` uses the same anchored linear-time regex `/^live-font-mount-([a-z]+)-/`, and `PLUGINS_OUTCOME` is passed via `env:` and compared with strict equality before `JSON.stringify` (no shell interpolation or CI gate bypass).

## Mutant & Test Verification (`a4369dae`)

- **Clean test run** (`node --test scripts/lib/live-font-*.test.mjs scripts/ci/coverage-shards.test.mjs` at `a4369dae`): `114` passed, `0` failed, `0` skipped across `14` suites.
- **Mutants run in detached `/tmp/wt-615-mutant-r3` at `a4369dae` (removed cleanly afterward)**:
  1. `P2-a` (`mountTracker.captured` no longer widens on `stage === 'before'`): failed `1` test (`mountTracker widens after a before capture and resets at each launch`).
  2. `P2-b` (`mountTracker.launched()` no-op): failed `1` test (`mountTracker widens after a before capture and resets at each launch`).
  3. `P2-c` (`widenMounts` ignores `markers`): failed `3` tests (`widenMounts adds every scope the markers carry, once`, `mountTracker widens after a before capture and resets at each launch`, `a scope the before capture showed is reread, and fails only after three drops`).
  4. `P3-a` (`shardResult` treats `plugins === 'cancelled'` as pass): failed `1` test (`a plugin outcome other than success or skipped fails the shard and names the step`).
  5. `P3-b` (`pr-checks.yml:377` drops `PLUGINS_OUTCOME`): failed `1` test (`a shard's recorded outcome includes the mobile plugin prebuild suites`).

REVIEW-615-HANDOVER-R3-DONE
