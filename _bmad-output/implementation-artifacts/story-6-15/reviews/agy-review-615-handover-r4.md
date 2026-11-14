# Story 6.15 Handover Review R4

- **Branch / Range**: `feat/story-6-15-expo-sdk-58` (`a4369dae..3193b018`: commit `3193b018`) in `/Users/murat/opensource/cc/couture-cast-wt-615`
- **Mode**: Read-only review; mutant and probe executed in a detached `/tmp/wt-615-mutant-r4` worktree at `3193b018`, which was removed afterward.

## Findings

### P3 — `settle` widening in `run-live-font-proof.mjs` is unkilled by tests because the runner has no unit-testable seam

- **Location**: [run-live-font-proof.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/run-live-font-proof.mjs#L368-L377), [run-live-font-proof.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/run-live-font-proof.mjs#L51-L71)
- **Concrete failure scenario**: Removing `mounts.captured(stage, flat.markers)` at `run-live-font-proof.mjs:375` leaves `node --test scripts/lib/live-font-*.test.mjs` passing `99/99` (`exit=0`) because `run-live-font-proof.mjs` parses required CLI flags (`--platform`, `--device`, `--out`) and runs top-level device/OS setup (`lines 51-71`, `568-696`), so no test suite imports it. A future edit that removes or bypasses `mounts.captured` inside `settle()` would silently reintroduce R3's 1-read `before` drop without failing any test.
- **Smallest seam**: Extract a pure IO-injected `settleCapture({ read, sameLayout, mounts, stage, capture, pause, now, deadlineMs })` helper into [live-font-capture.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/lib/live-font-capture.mjs) and call it from `settle()` (`run-live-font-proof.mjs:368-390`). A unit test in `live-font-capture.test.mjs` with a `before` settle sequence where read 1 includes `home` and later reads drop it—verifying `capture` receives widened `mounts.scopes()`—would immediately kill that mutant.

## Closure, Residual & Prompt Checks

- **Transient settle-only scope check**: A scope seen only in one transient `before` `settle` read **cannot fail a leg**. Verified against `3193b018`: `mounts.captured('before', markers)` adds that scope only to `mounts.scopes()` (used by `readWithMounts`), which caps at 3 attempts and returns the last read without throwing or synthesizing markers; [mountsKnown](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/lib/live-font-scale-proof.mjs#L297-L303) evaluates only the captured stages (`before`, `immediate`, `settled`, `updated`), yielding `rootKnown: true`, `rootKept: true`, `verdict: 'fixed'` (`PROBE_TRANSIENT_SETTLE_ONLY`: `beforeReads: 3`). Its only effect is making later `makeCapture` calls on that launch run 3 `maestro hierarchy` reads instead of 1.
- **Residual judgment & static declaration safety**:
  - Note exact drop count on leg 1 `before`: if _every_ `settle` read (at least 3 reads: `t=0`, `0.5s`, `1.0s`) drops `Home`, `mounts.scopes()` never widens, so `makeCapture` runs **1** read (4 consecutive drops total), whereas once any `settle` read sees `Home`, `makeCapture` retries 3 times. Operationally that residual is low for intermittent 1x1 iOS dump drops.
  - Declaring `Home` up front in `SCREENS` (`community`, `settings`, `composer`) is **not safe** if a tab ever unmounts on blur (`unmountOnBlur` / `detachInactiveScreens`), if a flow opens without visiting `Home` first, or if a presentation hides the background screen: `Home` would be genuinely absent, forcing 3 `hierarchy` retries per capture and deterministically failing every leg on `rootKnown: false`.
  - If further hardening is wanted later, relaxing `mountsKnown` (`live-font-scale-proof.mjs:297-303`) to require only `['root', mount]` when `mount` is explicitly supplied—while letting `sameMounts` still catch any id change on co-mounted scopes whenever they appear—avoids both consecutive-drop flakes and transient-scope 3x retries.
- **Security lens (`codex-security-review` / `security-diff-scan`)**: No P0/P1 security issues in `a4369dae..3193b018` (`settle` keeps its `60_000` ms deadline and feeds `flat.markers` only to `mountTracker`).

## Mutant & Test Verification (`3193b018`)

- **Clean test run** (`node --test scripts/lib/live-font-*.test.mjs` at `3193b018`): `99` passed, `0` failed, `0` skipped across `14` suites.
- **Mutant in detached `/tmp/wt-615-mutant-r4` at `3193b018` (removed cleanly afterward)**:
  1. `settle_stops_widening` (removed `mounts.captured(stage, flat.markers)` at `scripts/run-live-font-proof.mjs:375`): `node --test scripts/lib/live-font-*.test.mjs` exited `0` (`99` passed, `0` failed, `0` skipped) — unkilled due to missing runner seam.
  2. `PROBE_TRANSIENT_SETTLE_ONLY` (transient `home` on settle read 1, absent in `before`/`immediate`/`settled`/`cold` captures): `beforeReads: 3`, `rootKnown: true`, `rootKept: true`, `verdict: 'fixed'`.

REVIEW-615-HANDOVER-R4-DONE
