# Tea615 Review — Round 49 (`814ce811..1b101d1c`, skip `e79cf25c`)

- **Repository (read-only)**: `/Users/murat/opensource/cc/couture-cast-wt-615` at `1b101d1c` (clean working tree before and after review)
- **Diff scope**: 12 changed code files (`scripts/ci/font-scale-reads.test.mjs`, `scripts/lib/live-font-capture.{mjs,test.mjs}`, `scripts/lib/live-font-scale-proof.{mjs,test.mjs}`, `scripts/lib/live-font-text-probe.{mjs,test.mjs}`, `scripts/lib/live-font-volatile-proof.mjs`, `scripts/lib/maestro-driver-sync.{mjs,test.mjs}`, `scripts/lib/maestro-ios-driver-port.{mjs,test.mjs}`) plus 1 design doc (`_bmad-output/.../f-00i-text-layout-probe-design.md`)
- **Verification**:
  - `npx tsc -p apps/mobile/tsconfig.json --noEmit` -> exit `0`
  - `node --test` across the 17 targeted Node test files -> `tests 433, suites 57, pass 433, fail 0, skipped 0`
  - Security diff scan (`/private/tmp/codex-security-scans/couture-cast-wt-615/1b101d1c_r49/report.md`, finalized via `finalize_scan_contract.py`) -> `0` reportable security findings (`completeness: complete`)

---

## Findings

### P2-1 — `hiddenOwner` `bordersReach` lets adjacent stacked cards steal outside `accessibilityHidden` badges

- **Location**: `scripts/lib/live-font-text-probe.mjs:1007-1054` (`holdsWords`, `bordersReach`, `hiddenOwner`)
- **Failure scenario**: `hiddenOwner` attaches an unmatched `accessibilityHidden` record to any element with an `identifier`, `holdsWords(normalized(element.label), text)`, and `gap(element.rect, rect) <= bordersReach(record, rect, tolerance)` (at least one line height of `record`), without requiring the element to overlap `record.rect` or checking whether another element already contains `rect`. When two cards are stacked `12px` apart and Card 2 holds an `accessibilityHidden` `'Archived'` badge (`y=194..212`) while neighboring Card 1 (`y=100..180`) mentions `'Saved item · Archived'`, Card 1 is `14px` away (`<= 18px` line height) and steals the badge even though `rect` sits wholly outside Card 1 and wholly inside Card 2.
- **Probe evidence**:
  - `2a.hiddenOwner_stacked_card_14px_outside_steal`: `{ pass: true, hiddenAttached: [ { record: 2, element: 0, node: 0 } ] }`.

### P2-2 — `overflowRegionOf` window-edge heuristic drops padded/borderline chips and false-matches unrelated rows

- **Location**: `scripts/lib/live-font-text-probe.mjs:745-756` (`overflowRegionOf`)
- **Failure scenario**: Checking only Y-band overlap plus `region[2] >= window[2] - tolerance` and `rect[0] >= window[2] - tolerance` (or left equivalent) breaks in three ways:
  1. **Missed padded carousel chip**: Horizontal scroll containers with outer padding (`region = [16, 120, 384, 160]` inside `window = [0, 0, 400, 800]`, `tolerance = 4`) fail `384 >= 396`, so genuinely scrolled-away chips stay `'scrolled'` (`offscreen`).
  2. **Missed borderline straddling chip**: A scrolled-away chip starting just inside `window[2] - tolerance` (`viewRect = [390, 125, 470, 155], visibleRect = null, scrolledAway = true`) fails `390 >= 396` even when `region` reaches `400`.
  3. **False volatile attachment**: Any unrelated volatile region touching `window[2]` on the right (`[250, 120, 400, 160]`) steals a non-volatile `'scrolled'` record (`[420, 125, 520, 155]`) from any sibling carousel sharing the same Y band.
- **Probe evidence**:
  - `2b.overflowRegionOf`: `paddedMiss: { kinds: [ 'scrolled' ], offscreen: [ 0 ] }`, `falseVolatile: { kinds: [ 'volatile' ], volatile: [ ... ] }`.
  - `halfCutScrolled`: `{ kinds: [ 'scrolled' ], offscreen: [ 0 ] }`.

### P2-3 — `maestro-ios-driver-port.mjs` `reserve()` stale-marker lockup, TOCTOU window before `renameSync`, and same-PID overwrite

- **Location**: `scripts/lib/maestro-ios-driver-port.mjs:173-242` (`reserve`, `release`)
- **Failure scenarios**:
  1. **Dead runner leaves permanent `.takeover.*` blocker** (`lines 212-228`): `${port}.takeover.${sha}` records `${pid}\n`, but an `EEXIST` on `writeFileSync(marker, ..., { flag: 'wx' })` unconditionally skips (`continue`) without checking whether the marker's PID is still alive. If a runner is `SIGKILL`ed after creating the marker, every future runner fails to reclaim that stale lock (`reserve` returns `false`).
  2. **TOCTOU between `read() !== raw` and `renameSync` (`lines 223-224`)**: `read() !== raw` verifies the stale lock content in user space, then `fs.renameSync(temporary, lock)` unconditionally replaces `lock`. If a competing runner acquires `lock` cleanly in the gap between `read()` (line 223) and `renameSync` (line 224), the latecomer's `renameSync` overwrites the live runner's lock and both report `true`.
  3. **Same-PID clobber (`lines 210, 237`)**: `holder.pid !== pid && alive(holder.pid)` skips the liveness check when `holder.pid === pid`, and `release(port)` checks only `.pid === pid` (not `.token`), so two in-process `createIosDriverPortIo` instances overwrite and unlink each other's reservations.
- **Probe evidence**:
  - `3a.3way_race`: `{ resA: false, resB: true, resC: false, winner: 202, files: [ '17205.json' ] }` (interleaved live race works when markers clean up).
  - `3b.dead_marker_left_behind`: `{ res: false, holder: { device: 'DEAD', pid: 999999 }, files: [ '17205.json', '17205.takeover.c2de2cdcb0328109' ] }`.
  - `3c.same_pid_overwrite`: `{ r1: true, r2: true, holderDevice: 'DEV-2' }`.
  - `3d.toctou_between_read_and_rename`: `{ hookArmed: true, resTakeover: true, resLive: true, finalHolder: { device: 'DEV-A', pid: 101, ... } }`.

### P2-4 — `shortFinalStep` mishandles sticky-header jitter `> tolerance`, chance single-label pairs, and non-bottom final drags

- **Location**: `scripts/lib/live-font-capture.mjs:347-377, 404-453` (`shortFinalStep`, `dragSteps`, `stitchPlaces`)
- **Failure scenarios**:
  1. **Sticky-header jitter (`> tolerance`)**: `chrome` (`line 410`) requires every page to match within `tolerance` (`4px`). A sticky header jittering by `6px` on the final page stops counting as `chrome`, enters `anchors[last]` as a `6px` shift (`> 4px`), and either aborts stitching with `live_font_scroll_short_drag_ambiguous` when real scrolled anchors (`200px`) exist, or becomes the sole step (`+6px`) when the final page has no other anchors.
  2. **Chance repeated text**: A single repeated unlabeled control (`'View details'`) visible at different screen positions on `p1` and `p2` enters `anchors[last]` cleanly (`180px`) with nothing to disagree against.
  3. **Non-bottom final drag**: Because `dragSteps` invokes `shortFinalStep` whenever `!measured[last].length` at `at === last`, a full non-bottom final drag whose anchors missed `[0.9 * expectedShift, 1.1 * expectedShift]` accepts any incidental small UI shift (e.g., `80px` header collapse) instead of `fallbackStep(steps, expectedShift)`.
- **Probe evidence**:
  - `4a.repeated_text_chance_agree`: `{ offsets: [ 0, 600, 780 ], ... }`.
  - `4b.sticky_header_jitter_6px`: `{ err4b: 'live_font_scroll_short_drag_ambiguous: final drag anchors 6, 200 px disagree' }`.
  - `4c.sticky_header_only_6px_step`: `{ offsets: [ 0, 600, 606 ] }`.
  - `4d.non_bottom_final_drag_Accepts_80px_bar`: `{ offsets: [ 0, 600, 680 ] }`.

### P2-5 — `fontScaleReads` `nameOf` misses parenthesized string literals (and dynamic string keys)

- **Location**: `scripts/ci/font-scale-reads.test.mjs:153-165` (`nameOf`)
- **Failure scenario**: While `useWindowDimensions()?.['fontScale']`, `useWindowDimensions()?.fontScale`, and quoted/computed literal destructuring (`const { 'fontScale': s } = ...`, `({ 'fontScale': s } = ...)`, `const { ['fontScale']: s } = ...`) are all caught, wrapping the literal in parentheses (`useWindowDimensions()[('fontScale')]` or `const { [('fontScale')]: s } = ...`) sets `node.parent` to `ParenthesizedExpression`, causing `nameOf` to return `null`. Dynamic property expressions (`'font' + 'Scale'`, `` `font${k}` ``, `const k = 'fontScale'; dims[k]`) also pass unflagged.
- **Probe evidence**:
  - `5.ast_guard`: `'app/paren-bracket.ts': []`, `'app/destructure-paren-computed.ts': []`, `'app/concat-bracket.ts': []`, `'app/template-expr.ts': []`, `'app/var-key.ts': []` (while optional-chaining and non-parenthesized destructuring returned flagged violations).

### P3-1 — `lostText` still misses `2 -> 1` drops when copies only appear on separate scroll pages

- **Location**: `scripts/lib/live-font-scale-proof.mjs:1417-1434, 1444-1453` (`recordTexts`, `lostText`)
- **Failure scenario**: Because `recordTexts(cold, platform, true)` takes `Math.max` per-page count of `COMPARED_KINDS` (`visible`, `hidden`, `regional`, excluding `'scrolled'`), two distinct `'Save'` buttons located on separate scroll pages (copy 1 visible / copy 2 `'scrolled'` on page 0; copy 1 `'scrolled'` / copy 2 visible on page 1) yield `copies = max(1, 1) = 1`. Dropping one copy in `settled` still passes `lostText`.
- **Probe evidence**:
  - `8a.multiplicity_same_page_2_to_1`: `{ pass: false, lost: [ { stage: 'settled', text: 'Save' } ] }`.
  - `8b.multiplicity_cross_page_scrolled_2_to_1`: `{ pass: true, lost: [] }`.

### P3-2 — `reserve()` leaves `linkSync` `EPERM` / `EOPNOTSUPP` (non-hardlink FS) unhandled

- **Location**: `scripts/lib/maestro-ios-driver-port.mjs:201-206`
- **Failure scenario**: On filesystems without hard links, `fs.linkSync(temporary, lock)` throws `EPERM`/`EOPNOTSUPP`, which hits `if (error.code !== 'EEXIST') throw error` instead of falling back or surfacing a clear lock error. (The outer `finally` does clean up `.tmp`.)
- **Probe evidence**:
  - `3e.link_EPERM_unhandled`: `{ errCode: 'EPERM', leftoverFiles: [] }`.

---

## R48 Probe Re-verification Summary

| R48 Probe                               | R49 Observed Result                                                            | Status                                           |
| --------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| `F6_partial_bottom_scroll`              | `offsets: [0, 600, 800]`                                                       | Fixed                                            |
| `F3_android_wrong_attach_across_screen` | `pass: false, code: 'live_font_text_probe_unmatched'`                          | Fixed                                            |
| `F4_stale_lock_race` (sequential)       | `{ resA: true, resB: false }`                                                  | Fixed (marker dead/TOCTOU caveats above)         |
| `F4_catch_probe_swallows_error`         | `{ err: 'real_maestro_failure', logs: ['probe_boom'] }`                        | Fixed                                            |
| `R47_F4_wrong_before_settled_scales`    | `'volatileProof run 0 home-001-before-1.0 is no capture at before\'s scale 1'` | Fixed                                            |
| `R47_F1_string_bracket`                 | Caught `['fontScale']` and ``[`maxFontSizeMultiplier`]``                       | Fixed (parenthesis/dynamic caveats above)        |
| `F6_overflowRegionOf_left_col`          | `{ kinds: ['scrolled'], volatile: [], offscreen: [0] }`                        | Fixed (edge caveats above)                       |
| Multiplicity `2 -> 1` (same page)       | `{ pass: false, lost: [{ stage: 'settled', text: 'Save' }] }`                  | Fixed same-page; cross-page gap remains (`P3-1`) |

---

## Mutation Testing (Detached `/tmp/wt-615-mutant-r49`, removed and pruned)

- `M9a_stop_no_udid_guard` (`maestro-ios-driver-port.mjs`): **KILLED** (`stop searches for runners of a UDID only`)
- `M10a_nameOf_drop_element_access` (`font-scale-reads.test.mjs`): **KILLED** (`a font-scale name spelled as a string property is caught`)
- `M10b_nameOf_drop_computed_binding` (`font-scale-reads.test.mjs`): **KILLED** (`a font-scale name spelled as a string property is caught`)
- `M11a_shortFinalStep_return_null` (`live-font-capture.mjs`): **KILLED** (`takes a short final drag from anchors that agree, and fails when they do not`)
- `M11b_shortFinalStep_no_throw` (`live-font-capture.mjs`): **KILLED** (`takes a short final drag from anchors that agree, and fails when they do not`)
- `M12a_hiddenOwner_drop_holdsWords` (`live-font-text-probe.mjs`): **KILLED** (`an unflagged leftover of the same text, or a flagged one no label holds, stays unmatched`, `a flagged record joins only an element that holds or borders it, by whole words`)
- `M12b_hiddenOwner_drop_bordersReach` (`live-font-text-probe.mjs`): **KILLED** (`a flagged record joins only an element that holds or borders it, by whole words`)
- `M13_overflowRegionOf_drop_edge` (`live-font-text-probe.mjs`): **KILLED** (`a scrolled-away record joins a region sideways only past the window edge the region reaches`)
- `M14a_reserve_drop_reread` (`maestro-ios-driver-port.mjs`): **KILLED** (`a stale lock is taken over by one runner only`)
- `M14b_reserve_rmSync` (replace `fs.renameSync(temporary, lock)` with `fs.rmSync(lock, { force: true }); continue`): **SURVIVED** in `maestro-ios-driver-port.test.mjs` — the single-thread `alive()` test fires `runnerB` before `marker` exists, so `runnerA` aborts at `read() !== raw` and never executes the `rmSync` vs atomic `renameSync` line.
- `M15_catch_probe_unwrapped` (`maestro-driver-sync.mjs`): **KILLED** (`iOS: a failed call whose port probe throws keeps the Maestro failure`)
- `M16_volatileProof_cold_only` (`live-font-volatile-proof.mjs`): **KILLED** across `scripts/lib/live-font-*.test.mjs` (`R47_F4: a proof capture with no launch identity or a cold launch at another scale fails` in `live-font-scale-proof.test.mjs`; survived against `live-font-volatile-proof.test.mjs` alone)
- `M17_lostText_set_presence` (`live-font-scale-proof.mjs`): **KILLED** (`R47_F3B: a text gone live inside a composite label group fails as lost text`)

---

## Codex Security Diff Scan Result

- Scan dir: `/private/tmp/codex-security-scans/couture-cast-wt-615/1b101d1c_r49` (`report.md`, `scan-manifest.json`, `coverage.json`, `findings.json`, sealed via `finalize_scan_contract.py` exit `0`)
- Result: **0 reportable security findings** across all 12 changed code files (`completeness: complete`). `holdsWords` escapes regex metacharacters before constructing its Unicode word-boundary `RegExp`; `stop(device)` gates `pgrep -f` on `/^[0-9A-Fa-f-]{36}$/`. The `maestro-ios-driver-port.mjs` takeover marker stall, `read() !== raw` to `renameSync` TOCTOU, and `font-scale-reads.test.mjs` parenthesis bypass are reliability/guard-completeness bugs within a trusted single-user host / CI test boundary rather than security vulnerabilities.

REVIEW-615-R49-DONE
