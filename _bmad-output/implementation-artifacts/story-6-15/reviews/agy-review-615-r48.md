# tea615 Review — Round 48 (`23314978..d3a888eb`)

Scope: READ-ONLY on `/Users/murat/opensource/cc/couture-cast-wt-615` at `d3a888eb` (34 non-report files changed, excluding report/flake-log commits `7c8d86c9`, `93c54679`, `564b3cff`). Mutants, Swift, Android Gradle/Robolectric, and probe runs executed inside detached `/tmp/wt-615-mutant-r48`, which was cleanly unlinked, removed, and pruned before final shared-tree checks.

---

## R47 Fix Verification Summary

- **`R47_F1` (`scripts/ci/font-scale-reads.test.mjs`)**: TS AST `scopeOf` + per-identifier scanning properly catches multiple banned reads on one line and isolates sibling/nested function scopes. Still bypassed by string-literal bracket access (`P2` Finding 4).
- **`R47_F3` (`apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeWire.swift:93-98`, `TextLayoutProbeSnapshot.swift:48-49`)**: `modalOpaque` now checks `if found.clips && found.rounded { return false }` across clipping rounded-corner views at or under `modal`; verified by 85/85 passing Swift tests and killed by mutant `M1` (4 failures).
- **`R47_F4` (`scripts/lib/live-font-volatile-proof.mjs:199-223`)**: `launchOf` rejects `pid=0`, `'01'`, `'1e2'`, `null`, and `captureProblem` rejects cold captures at the wrong `fontScale` (`cold scale 1.0 vs 1.5`). Gap remains for live `before`/`settled` stage scales (`P2` Finding 4).
- **`R47_F3B` (`scripts/lib/live-font-scale-proof.mjs:1408-1446`, `lostText`)**: Missing live records vs cold `COMPARED_KINDS` trigger `live_font_text_lost`, verified by tests and mutant `M6c` (KILLED). Known exclusions (`scrolled`, Set deduplication) noted in `P3` Finding 5.

---

## Findings (P0–P3)

### P2-1 — Partial final scroll drag rejected by `measuredShifts` (`SHIFT_SPREAD`), duplicating bottom items in `stitchPlaces`

- **Location**: `scripts/lib/live-font-capture.mjs:324-334` (`measuredShifts`), `scripts/lib/live-font-capture.mjs:397-416` (`stitchPlaces`)
- **Failure scenario**: When `expectedShift` (`capture.pageShift`) is set, `measuredShifts` discards any shift outside `[0.9 * expectedShift, 1.1 * expectedShift]`. On the last drag that reaches the bottom of a `ScrollView` (when remaining scroll travel is smaller than `0.9 * expectedShift`, e.g., `200px` when `expectedShift = 600`), every anchor shifts by `200px` and is filtered out. `stitchPlaces` receives `[]` for that drag and falls back to `fallbackStep(steps, expectedShift)` (`median(steps) = 600`), placing the bottom page `400px` too low and double-counting cards already seen on the penultimate page.
- **Probe evidence**: `F6_partial_bottom_scroll` (`expectedShift: 600`, drag shifts `600, 200`) produced `offsets: [0, 600, 1200]` and duplicated `'["c3","Card 3"]'` and `'["c4","Card 4"]'` in `taken`.

### P2-2 — `hiddenOwner` attaches `accessibilityHidden` records across the screen without containment or word boundaries

- **Location**: `scripts/lib/live-font-text-probe.mjs:1003-1030` (`hiddenOwner`), `scripts/lib/live-font-text-probe.mjs:1046-1075` (`attachHiddenRecords`)
- **Failure scenario**: `hiddenOwner` selects any identified `element` where `normalized(element.label).includes(normalized(record.text))`, choosing the minimum `gap(element.rect, rect)` with no containment/overlap check and no delimiter/word boundaries. On Android (`groupRule: false`) or whenever a record is left free outside its own container, a short/common token (e.g. `"cast"`) in a card whose label omits it is silently attached hundreds of pixels away to an unrelated element (e.g. `"Forecast details"`).
- **Probe evidence**: `F3_android_wrong_attach_across_screen` (`platform: 'android'`, `groupRule: false`, `tolerance: 4`) attached record 2 (`"cast"` at `y=610..640`) to `element 0` (`"Forecast details"` at `y=100..150`) with `pass: true, code: null`.

### P2-3 — Stale-lock TOCTOU race in `createIosDriverPortIo.reserve` and unguarded `io.probe` in `createIosDriver.run` catch block

- **Location**: `scripts/lib/maestro-ios-driver-port.mjs:164-185` (`reserve`), `scripts/lib/maestro-driver-sync.mjs:276-285` (`createIosDriver`)
- **Failure scenario**:
  1. When a dead runner leaves a stale `<port>.json` lock, two concurrent runners executing `reserve` both hit `EEXIST`, see `!alive(holder.pid)`, and call `fs.rmSync(lockOf(port), { force: true })` (line 182). If Runner B finishes its `writeFileSync(..., { flag: 'wx' })` before Runner A reaches line 182, Runner A deletes Runner B's live lock and creates its own lock, leaving both runners believing they hold the same port.
  2. In `createIosDriver`'s `run()` `catch (error)` block (line 278), `io.probe(port)` is called unguarded; if `io.probe` throws, it masks the underlying `maestro` failure error.
  3. Additionally, mutant `M9a_stop_skip_udid_guard` survived, showing no unit test covers non-UDID rejection in `stop(device)` (`maestro-ios-driver-port.mjs:203`).
- **Probe evidence**: `F4_stale_lock_race` confirmed `{ resB: true, resA: true, lockNow: { device: 'DEV-A', pid: 111111 } }`; `F4_catch_probe_swallows_error` returned `'probe_boom'` instead of `'real_maestro_failure'`.

### P2-4 — `volatileProof` ignores live stage `fontScale`s; AST font-scale guard bypassed by bracket string literals

- **Location**: `scripts/lib/live-font-volatile-proof.mjs:211-223` (`captureProblem`), `scripts/ci/font-scale-reads.test.mjs:158-171` (`fontScaleReads`)
- **Failure scenario**:
  1. `volatileProofProblem` (`scripts/lib/live-font-scale-proof.mjs:1788-1794`) passes `scales` for every stage in `VOLATILE_STAGES`, but `captureProblem` (`live-font-volatile-proof.mjs:217-220`) only enforces `Number(capture.fontScale) === Number(scales[stage])` when `CAPTURE_STAGE[stage] === 'cold'`, allowing a committed proof whose `before`/`settled` captures come from wrong scales.
  2. `fontScaleReads` only visits `ts.isIdentifier(node)`, so bracket string/template property accesses like `useWindowDimensions()['fontScale']` or `['maxFontSizeMultiplier']` pass without error.
- **Probe evidence**: `R47_F4_wrong_before_settled_scales` returned `null` (accepted) with `before.fontScale = 999, settled.fontScale = 1.0` against `{ before: 1.0, settled: 1.5, cold: 1.5 }`. `R47_F1_string_bracket` returned `['app/normal.ts:1 const fs = useWindowDimensions().fontScale']`, missing both `'fontScale'` and `` `maxFontSizeMultiplier` `` bracket accesses.

### P3-1 — `overflowRegionOf` Y-band cross-column capture and `lostText` `scrolled`/multiplicity blind spots

- **Location**: `scripts/lib/live-font-text-probe.mjs:742-757` (`overflowRegionOf`), `scripts/lib/live-font-scale-proof.mjs:1408-1446` (`COMPARED_KINDS`, `recordTexts`, `lostText`)
- **Failure scenario**:
  1. `overflowRegionOf` assigns any `scrolledAway` record whose vertical center lies in `[region[1], region[3]]` and whose X sits left/right of the region to that volatile region, even if the record belongs to an unrelated column or sibling container outside `region`.
  2. `lostText` only compares `Set` membership against cold `COMPARED_KINDS` (`visible`, `hidden`, `regional`), so a horizontally scrolled chip (`scrolledAway: true`) present in cold and completely dropped in live passes `textLost`, and losing duplicate copies (`2 -> 1`) also passes `textLost`.
- **Probe evidence**: `F6_overflowRegionOf_left_col` mapped a record at `[500, 120, 620, 160]` (`scrolledAway: true`) into left-half `volatileRegions: [[0, 100, 200, 180]]` as `kinds: ['volatile']`. `F5_scrolled_chip_lost_in_live` returned `{ pass: true, lost: [] }` when a `cold` `scrolledAway` chip was deleted from `live`.

---

## Mutation Testing Results (Executed in `/tmp/wt-615-mutant-r48`)

- `M1` (`TextLayoutProbeWire.swift` — drop `if found.clips && found.rounded { return false }`): **KILLED** (`swift test`: 4 failures, exit 1)
- `M2` (`TextLayoutProbeWire.swift` — disable `elementsHidden` check in `accessibilityHidden`): **KILLED** (`swift test`: 2 failures, exit 1)
- `M3` (`TextLayoutSnapshot.kt` — disable `NO_HIDE_DESCENDANTS` check in `accessibilityHidden`): **KILLED** (Gradle `testDebugUnitTest`: exit 1)
- `M4_ios_driver_port_drop_ipv6` (`maestro-ios-driver-port.mjs` — `LOOPBACKS = ['127.0.0.1']`): **KILLED** (`node --test`: exit 1)
- `M5a_volatile_proof_allow_pid0` (`live-font-volatile-proof.mjs` — drop `pid > 0` check): **KILLED** (`node --test`: exit 1)
- `M5b_volatile_proof_skip_cold_scale` (`live-font-volatile-proof.mjs` — disable cold `fontScale` check): **KILLED** (`node --test`: exit 1)
- `M6a_faces_drop_stale_width` (`live-font-scale-proof.mjs` — `staleWidth = false`): **KILLED** (`node --test`: exit 1)
- `M6b_faces_drop_chained_box` (`live-font-scale-proof.mjs` — `staleChain = false`): **KILLED** (`node --test`: exit 1)
- `M6c_drop_text_lost_gate` (`live-font-scale-proof.mjs` — disable `textLost` gate): **KILLED** (`node --test`: exit 1)
- `M7_attach_hidden_ignore_flag` (`live-font-text-probe.mjs` — drop `each.accessibilityHidden === true`): **KILLED** (`node --test`: exit 1)
- `M8_stitch_drop_shift_spread` (`live-font-capture.mjs` — drop `SHIFT_SPREAD` filter): **KILLED** (`node --test`: exit 1)
- `M9a_stop_skip_udid_guard` (`maestro-ios-driver-port.mjs` — remove `!UDID.test(device)` guard in `stop`): **SURVIVED** (exit 0)
- `M9b_staleClip_drop_group_vias` (`live-font-scale-proof.mjs` — drop `GROUP_VIAS` own-box branch): **KILLED** (`node --test`: exit 1)
- `M9c_volatileFacts_drop_lookupOnly` (`live-font-scale-proof.mjs` — drop `lookupOnly` on scrolled volatile): **KILLED** (`node --test`: exit 1)

Total: 14 mutants run — 13 killed, 1 survived (`M9a_stop_skip_udid_guard`).

---

## Codex Security Diff Scan

- **Scan directory**: `/private/tmp/codex-security-scans/couture-cast-wt-615/d3a888eb_r48`
- **Report**: `/private/tmp/codex-security-scans/couture-cast-wt-615/d3a888eb_r48/report.md`
- **Result**: `complete` coverage across all 34 diff-scoped files; **0 reportable findings** (`critical`/`high`/`medium`/`low`). Process spawns use `spawnSync` argv arrays with `UDID` validation (`^[0-9A-Fa-f-]{36}$`), 30s timeouts, and `0o700`/`0o600` tmpdir locks (dev-host TOCTOU race and `stop(device)` test gap tracked as `P2-3` above).

---

## Verification Matrix

- Shared tree `/Users/murat/opensource/cc/couture-cast-wt-615` after cleanup (`git status -s` clean, `git worktree list` free of `/tmp/wt-615-mutant-r48`):
  - `npx tsc -p apps/mobile/tsconfig.json --noEmit`: exit `0` (`0` errors)
  - `node --test` on the 18 targeted suites (`font-scale-reads`, `live-font-*`, `maestro-*`, `story68-{fallback-post,native-build-env,release-live-font-command}`, `test-store-driver`, `text-layout-probe-mode`): `tests 426, suites 57, pass 426, fail 0`
- Mutant worktree `/tmp/wt-615-mutant-r48` (before removal):
  - `swift test --package-path apps/mobile/modules/text-layout-probe/ios`: `85 tests, 0 failures`
  - Android Robolectric (`gradle 8.14.3` `-p apps/mobile/modules/text-layout-probe/android/unit-tests testDebugUnitTest`): `BUILD SUCCESSFUL` + `junit-report-check.mjs` passed (`TextLayoutSnapshotTest` >= 75, `TextLayoutProbeWireTest` >= 27, none skipped or failed).
  - Note: `apps/mobile/components/tab-bar-label.{test,native.test}.tsx` were not executed because their Vitest configuration runs browser/Playwright + MSW (`mockServiceWorker.js`) and `npm --prefix apps/mobile test` triggers `pretest` workspace builds; excluded per review constraints.

REVIEW-615-R48-DONE
