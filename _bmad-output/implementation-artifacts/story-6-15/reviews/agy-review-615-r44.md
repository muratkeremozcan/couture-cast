# tea615 Review — Round 44 (`e1b8a80f..0027bf63`, skipping `d87631ca`)

- **Shared repo**: `/Users/murat/opensource/cc/couture-cast-wt-615` untouched (`git status -s` clean; worktree `/tmp/wt-615-mutant-r44` removed and pruned).
- **Codex Security Diff Scan**: Completed cleanly against `e1b8a80f..0027bf63` (27 diff files, 0 security findings) — [scan report](/private/tmp/codex-security-scans/couture-cast-wt-615/0027bf63_r44/report.md).
- **`apps/mobile` `tsc`**: `npx tsc -p apps/mobile/tsconfig.json --noEmit` exited `0` (`0` errors).

---

## Findings

### P1-1 — Real text pushed wholly off-window on both `cold` and `settled` (or in `assertColdControl`) passes as `offWindow`

- **Locations**:
  - `apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeWire.swift:142-144`
  - `apps/mobile/modules/text-layout-probe/android/src/main/java/expo/modules/textlayoutprobe/TextLayoutSnapshot.kt:382-384`
  - `scripts/lib/live-font-text-probe.mjs:562-563,722`
  - `scripts/lib/live-font-scale-proof.mjs:976-993,1563-1600`
- **Failure scenario**: `offWindow` (`clip == nil && disjoint(viewRect, window)`) treats any view wholly outside its window with no scroll reach the same way as a parked bottom sheet, including a non-scrolling horizontal row item pushed past `window.right` or a non-scrolling footer pushed past `window.bottom`. `matchTextProbe` puts `offWindow` records outside `facts` (never judged for clipping), and `hiddenText` only fails when `cold` has strictly more paired on-screen keys (`shown.keys.length < keys.length`). When `cold` at target scale _also_ pushes that non-anchor text off-window (or in `assertColdControl`, which never inspects `offWindow`) and accessibility keeps the node in `nodes`, `clipping` and `textHidden` both pass (`verdict: 'fixed'` with healthy identity).
- **Probe evidence** (`/tmp/wt-615-mutant-r44`):
  - Swift `testR44ProbeNonClippingScrollInsideClipperAndRightOverflowOffWindow` (`cutsB`) & Android `r44ProbeInvertedScrollAndRightOverflowOffWindow`: a label pushed right of `window.right` received `offWindow = true, clipRect = null, scrolledAway = false`.
  - Node `PROBE_4_OFFWINDOW_HIDES_LOST_TEXT` (one-sided on `settled`): `textHidden` caught it (`textHiddenPass: false`), `clippingPass: true`.
  - Node `PROBE_4B_COLD_AND_SETTLED_OFFWINDOW` (both `cold` and `settled` pushed off-window while nodes stay in hierarchy): `textHiddenPass: true`, `clippingPass: true`, only synthetic `identity` failed (`failing: ['identity']`).

### P1-2 — `staleContent` second-face check can classify non-6.8 target clips as `face: 'staleContent'`

- **Location**: `scripts/lib/live-font-scale-proof.mjs:581-597,1037-1042`
- **Failure scenario**: `faces()` computes `staleContent` solely from `near(height, rectHeight(targetRecord.viewRect), tolerance) && near(rectHeight(record.contentRect), rectHeight(startRecord.contentRect), tolerance)`. It never checks that `startRecord.contentRect` height actually differed from `targetRecord.contentRect` height (for example, single-line text or Android 14+ large capped text `>= 36sp` whose height is equal at `1.5` and `1.0`), nor that the clip is vertical content height exceeding `clipRect` rather than a fresh horizontal clip (`contentRect.right > clipRect.right`) or truncation (`ellipsize`). A brand-new horizontal overflow at the target scale then receives `face: 'staleContent'` and is accepted into `clippedKeys` / `clipsStale: true`.
- **Probe evidence** (`/tmp/wt-615-mutant-r44`):
  - Node `PROBE_2A_DETAIL`: on `1.5 -> 1.0`, `outfit-comfort-notes` kept identical height (`40px` at start and target), `coldParityMisses: []`, and adding horizontal overflow (`contentRect.right = viewRect.right + 40`) produced `clipped: [{ key: '["outfit-comfort-notes","t-cf83675a2f00"]#0', reason: 'clipped_by_layout', face: 'staleContent', staleBox: true, staleContent: true }]` and `clipKeys: ['staleContent:cold:["outfit-comfort-notes","t-cf83675a2f00"]#0']`.

### P2-1 — iOS non-clipping `UIScrollView` (`clipsToBounds == false`) inside an outer clipping ancestor cuts reachable scroll content to `nil`

- **Location**: `apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeWire.swift:179` (`TextLayoutProbeSnapshot.swift:176-179`)
- **Failure scenario**: `Wire.cuts` iterates `for ancestor in ancestors.reversed() where ancestor.clips`. If an outer view clips (`clips: true`) around a `UIScrollView` with `clipsToBounds == false` (RN `overflow: 'visible'` on `ScrollView`) that has positive scroll travel, skipping the non-clipping scroll view skips `widen(...)` too. Reachable content outside the outer clipper is falsely cut to `clip == nil` (`clipped_by_layout`). (Android `TextLayoutSnapshot.kt:255` avoids this by always adding `bounds` for `ScrollView`/`HorizontalScrollView` regardless of `clipChildren`.)
- **Probe evidence** (`/tmp/wt-615-mutant-r44`):
  - Swift `testR44ProbeNonClippingScrollInsideClipperAndRightOverflowOffWindow` (`cutsA`): `viewRect (y=210..240)` with `scrollY(0, of: 200)` (`clips: false`) inside `rect (y=100..200)` (`clips: true`) yielded `clip = nil`.

### P2-2 — Inverted `ScrollView` / `FlatList` (`scaleY: -1`) widens the scroll band on the wrong side of the viewport

- **Locations**:
  - `apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeWire.swift:159-162`
  - `apps/mobile/modules/text-layout-probe/android/src/main/java/expo/modules/textlayoutprobe/TextLayoutSnapshot.kt:350-353`
- **Failure scenario**: `widen` always opens `[span.lo - offset, span.hi + maximum - offset]`, assuming increasing `offset` shifts content upward (`y - d`) in window coordinates. In an inverted RN `FlatList`/`ScrollView` (`scaleY: -1`), `offset = 0` rests at the visual bottom and increasing `offset` moves older content downward (`y + d`) from above `span.lo` into the viewport, causing reachable rows above to get `clip == nil` and unreachable space below to open.

### P3-1 — Android `TextLayoutProbeWire.number(Double)` throws on `Double.NaN`

- **Location**: `apps/mobile/modules/text-layout-probe/android/src/main/java/expo/modules/textlayoutprobe/TextLayoutProbeWire.kt:77-80`
- **Detail**: `Double.NaN.coerceIn(0.0, 1.0)` returns `Double.NaN`, so `BigDecimal("NaN")` throws `NumberFormatException` if a view's effective alpha ever evaluates to `NaN` (probe-only build).

### P3-2 — `useGlyphBox` has no `maxFontSizeMultiplier` cap and rounds at `1.0` on fractional PixelRatio densities

- **Location**: `apps/mobile/components/glyph-box.ts:14-17,23-29`
- **Detail**: All 5 current callers (`apps/mobile/app/(tabs)/index.tsx:266,837`, `apps/mobile/components/community/community-card.tsx:289,450`, `apps/mobile/components/community/community-post-sheet.tsx:138,161`, `apps/mobile/components/hero/garment-item-tile.tsx:154,207`, `apps/mobile/components/info-banner.tsx:27,58`) omit `maxFontSizeMultiplier` and `allowFontScaling`, so boxes and glyphs scale in 1:1 lockstep from `1.0` past `3.0x` (and clamp at `base` when `fontScale < 1`). If a future caller adds `maxFontSizeMultiplier` to the child `<Text>`, `useGlyphBox` would overgrow past the glyph; at `1.0`, fractional device densities (`2.625`) nudge integer dimensions by `<0.4px`.

---

## Focus Review (1)–(8)

1. **Band rule**: Outer-to-inner narrowing + scroll travel widening `[V start - offset, V end + (max - offset)]` composes accurately across nested same-axis/cross-axis scroll views, iOS `adjustedContentInset`, disabled/non-overflowing scroll views, and Android RTL `HorizontalScrollView` (`r44ProbeAndroidBandAndOffWindow` passed at `scrollX = 150`). Remaining gaps: `P2-1` (iOS `clips: false` scroll view inside clipper), `P2-2` (inverted lists), Android `ScrollView` child margins ignored in `travel` (matches AOSP `getScrollRange()`), and OS keyboard occlusion when `window` does not resize.
2. **Second face (`staleContent`)**: `clippedKeys` multiset matching, `face:stage:node[>group]` parsing (`splitClipKey`), `staleKeys` cross-check for `staleBox`, and `predatesClipAmendment` are solid. Gap: `P1-2` (`staleContent` false positive when start/target `contentRect` height matches on horizontal clip). Note `live-font-scale-proof.test.mjs` has 0 `staleContent` assertions of its own (covered instead in `live-font-journey.test.mjs`).
3. **Per-page (`scripts/lib/live-font-pages.mjs`, `live-font-scale-proof.mjs`)**: `stablePage` sandwich read prevents accepting a probe answer while the UI moves; `scrollPages` stops cleanly on unchanged bottom page; `stitchPlaces` + `pageCaptures` + `allFacts` deduplicate across pages and `textProbeCheck` validates every page (`before`, `settled`, `updated`, and `*.pageN`).
4. **`offWindow` and `hidden`**: `hiddenText` checks both `invisible` (`opacity: 0`) and single-stage `offWindow` drops against `cold` (`shown.keys.length < keys.length`); gap documented in `P1-1`.
5. **Glyph boxes**: No layout/proportion regression at `1.0` (`scale = 1` when `fontScale <= 1`), no `maxFontSizeMultiplier` mismatch across all 5 callers, and flex rows (`info-banner`, `community-card`, `community-post-sheet`, `garment-item-tile`) allow wrapping/flexing cleanly beyond `3.0x`.
6. **Build guard (`18ddd58e`)**: `text-layout-probe-mode.mjs` + `run-story68-native.mjs` enforce fail-closed agreement across `Podfile`, `Podfile.lock`, `Pods.xcodeproj/project.pbxproj`, `settings.gradle`, and `COUTURE_TEXT_LAYOUT_PROBE` before `pod install` and before `prepareWorkletsStaging`/build. Note `settingsGradleExclusions` / `podfileExclusions` intentionally target the Expo plugin's generated syntax (`expoAutolinking.exclude = / +=`, `use_expo_modules!(exclude: [...])`), not Kotlin `.kts` or `.add(...)`.
7. **Replaced assertions**:
   - `TextLayoutProbeRulesTests.swift:664-669` (`reachable.offWindow == false`, `scrolledAway == true`): sound alignment with `offWindow` definition (`0027bf63`).
   - `TextLayoutProbeWireTest.kt:92-108` (`opacityIsWrittenUnroundedInPlainNotation`): sound pin of unrounded opacity JSON (`62f2b7e7`).
   - `story68-native-build-env.test.mjs:357` (`['probe-mode', 'prepare', 'build', 'verify']`): sound ordering before mutating worklets staging (`18ddd58e`).
   - Existing Swift/Kotlin scroll tests given explicit scroll travel in `62f2b7e7`: sound; preserves scroll reachability under travel > 0 requirement.
8. **`tsc` (`apps/mobile`)**: Passed (`exit 0`, 0 errors).

---

## Verification & Mutation Summary

### Baseline Runs (in detached `/tmp/wt-615-mutant-r44` unless noted)

- `npx tsc -p apps/mobile/tsconfig.json --noEmit` (shared tree, read-only): **PASS** (`exit 0`, 0 errors).
- `node --test scripts/lib/live-font-{capture,pages,text-probe,scale-proof,journey}.test.mjs scripts/lib/text-layout-probe-mode.test.mjs scripts/lib/story68-{native-build-env,release-live-font-command}.test.mjs`: **268 / 268 PASS**.
- `swift test --package-path apps/mobile/modules/text-layout-probe/ios`: **42 / 42 PASS**.
- Gradle `:testDebugUnitTest` (`unit-tests`) + `junit-report-check.mjs`: **55 / 55 PASS** (`TextLayoutSnapshotTest` >= 39, `TextLayoutProbeWireTest` >= 16; 0 skipped/failed).
- `apps/mobile/components/glyph-box.test.tsx`: **Not executed** (requires `@vitest/browser-playwright`, excluded by no-Playwright constraint).

### Targeted Mutants (`/tmp/wt-615-mutant-r44`, all reverted)

- `M1` `live-font-pages.mjs:58` skip post-probe sandwich read -> **KILLED** (`live-font-pages.test.mjs`).
- `M2` `live-font-pages.mjs:83` disable `scrollPages` end-of-scroll break -> **KILLED** (`live-font-pages.test.mjs`).
- `M3` `live-font-scale-proof.mjs:587` force `staleContent: false` -> **SURVIVED** `live-font-scale-proof.test.mjs` alone; **KILLED** when run across `live-font-journey.test.mjs`.
- `M4` `live-font-scale-proof.mjs:1038` drop `entry.stale &&` on `staleBox` -> **KILLED** (`live-font-scale-proof.test.mjs`).
- `M5` `live-font-scale-proof.mjs:983` drop `|| shown?.offWindow` in `hiddenText` -> **KILLED** (`live-font-scale-proof.test.mjs`).
- `M6` `live-font-scale-proof.mjs:1298` skip `staleBox` membership in `staleKeys` -> **KILLED** (`live-font-scale-proof.test.mjs`).
- `M7` `text-layout-probe-mode.mjs:192` skip `podsProjectTargets` check -> **KILLED** (`text-layout-probe-mode.test.mjs`).
- `M8` `text-layout-probe-mode.mjs:128` skip `withoutComments` in `settingsGradleExclusions` -> **KILLED** (`text-layout-probe-mode.test.mjs`).
- `M9` `TextLayoutProbeWire.swift:120` drop `+ insetStart` in `travel` offset -> **KILLED** (`swift test`).
- `M10` `TextLayoutProbeWire.swift:179` iterate `ancestors` forward instead of `.reversed()` -> **KILLED** (`swift test`).
- `M11` `TextLayoutProbeWire.swift:143` drop `clip == nil &&` in `offWindow` -> **KILLED** (`swift test`).
- `M12` `TextLayoutSnapshot.kt:326` iterate `levels` forward instead of `.asReversed()` -> **KILLED** (Gradle Robolectric).
- `M13` `TextLayoutSnapshot.kt:383` drop `clip == null &&` in `offWindow` -> **KILLED** (Gradle Robolectric).
- `M14` `TextLayoutProbeWire.kt:78` round opacity to 4 decimals -> **KILLED** (`TextLayoutProbeWireTest`).

REVIEW-615-R44-DONE
