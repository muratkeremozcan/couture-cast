# Review of tea615 Round 41 (`9e0cea34..ddd30654`, F-00i Text Layout Probe)

Reviewed read-only against `/Users/murat/opensource/cc/couture-cast-wt-615` at commit `ddd30654` (`9e0cea34..ddd30654`, skipping `d108cf9a` and `81b95da1`). All test runs, probes, and mutants were executed in a detached throwaway worktree `/tmp/wt-615-mutant-r41` at `ddd30654`, which was removed and pruned afterwards.

## Verdict & Security Result

- **No P0 or P1 findings.** Production/preview build exclusion, Android `DUMP` BroadcastReceiver permission gating, iOS sandboxed request/answer file isolation, and host `execFile` wire handling hold.
- **3 P2 findings and 2 P3 findings** remain in judge soundness and native layout measurement (confirming TEA's scroll-window `clipRect` note plus two additional blind/false-fail paths).
- **Codex Security scan**: Complete for all 28 changed source/config/test files (`0` reportable security vulnerabilities). Canonical report: [/private/tmp/codex-security-scans/couture-cast-wt-615/ddd30654_r41/report.md](file:///private/tmp/codex-security-scans/couture-cast-wt-615/ddd30654_r41/report.md).

---

## Findings (P0–P3)

### [P2-1] Window bounds still cut `clipRect` for scroll-view descendants (`TextLayoutSnapshot.kt:245`, `TextLayoutProbeWire.swift:90`)

- **Files**:
  - [TextLayoutSnapshot.kt](file:///Users/murat/opensource/cc/couture-cast-wt-615/apps/mobile/modules/text-layout-probe/android/src/main/java/expo/modules/textlayoutprobe/TextLayoutSnapshot.kt#L234-L246)
  - [TextLayoutProbeWire.swift](file:///Users/murat/opensource/cc/couture-cast-wt-615/apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeWire.swift#L81-L91)
- **Failure scenario**: Both implementations skip cutting `clip` / `clipRect` while walking scroll ancestors (`isScrollView`), but unconditionally cut `clip = clip.intersect(windowRect)` / `clip = cut(clip, window)` at the end. Whenever a `ScrollView`, `HorizontalScrollView`, or `UIScrollView` extends to or past a window edge and a descendant text element sits partially across that window edge (`scrolledAway == false`, `visibleRect != null`), `clipRect` is trimmed to the window boundary while `contentRect` keeps the full text extent. `contentClipped` then flags an unclipped scrollable item as `clipped_by_layout`.
- **Probe evidence**:
  - **Android Robolectric (`TextLayoutSnapshot.capture`)**: `ScrollView` child spanning `decor.height - 20 .. decor.height + 20` produced `viewRect=ProbeRect(10, 450, 210, 490)`, `visibleRect=ProbeRect(10, 450, 210, 470)`, `clipRect=ProbeRect(10, 450, 210, 470)`, `scrolledAway=false`.
  - **iOS (`TextLayoutProbeWire.cuts`)**: `CGRect(x: 10, y: 820, width: 200, height: 40)` inside `isScrollView: true` and `window` height `844` produced `visible=Optional((10.0, 820.0, 200.0, 24.0))`, `clip=Optional((10.0, 820.0, 200.0, 24.0))`, `scrolledAway=false`.
  - Neither `TextLayoutSnapshotTest` nor `TextLayoutProbeRulesTests` tests a scroll container touching the window edge, so existing tests pass (`M9` gap).

### [P2-2] Single-line `UITextField` horizontal overflow is undetectable on iOS (`TextLayoutProbeSnapshot.swift:109-119`)

- **File**: [TextLayoutProbeSnapshot.swift](file:///Users/murat/opensource/cc/couture-cast-wt-615/apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeSnapshot.swift#L101-L119)
- **Failure scenario**: For `UITextField`, `textInput(...)` calls `TextLayoutProbeMeasure.measure(shown, width: area.width, maximumNumberOfLines: 1, lineBreakMode: .byClipping)`, then discards `measure.unlimitedLineCount` and `measure.ellipsized` by hardcoding `lineCount = 1`, `maxLines = 1`, `unlimited = 1` (producing `ellipsized = 0`). Because TextKit lays out `.byClipping` inside `NSTextContainer(width: area.width)` with `maximumNumberOfLines = 1`, `measure.usedRect.width` is clamped to `area.width`. Horizontal text overflow inside a single-line `<TextInput />` on iOS therefore neither exceeds `clipRect` nor sets `ellipsized > 0`, silently passing. (Contrast Android `ReactEditText`, whose single-line `Layout` extends past view width.)
- **Probe evidence**: Swift TextKit probe matching `TextLayoutProbeMeasure` on `"A very long single-line input string that overflows 100pt horizontally"` at `width: 100`, `maximumNumberOfLines: 1`, `lineBreakMode: .byClipping` returned `usedRect=(0.0, 0.0, 100.0, 20.0)` with `unlim=7 ellip=1` — and `TextLayoutProbeSnapshot.swift:117-119` overwrites `unlimited = 1` (`ellipsized = 0`). Untested by SwiftPM because `TextLayoutProbeSnapshot.swift` is excluded in `Package.swift` (`M12` gap).

### [P2-3] `coveredWindows` misses non-fullscreen focused Android dialogs (`live-font-text-probe.mjs:494-507`)

- **File**: [live-font-text-probe.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/lib/live-font-text-probe.mjs#L494-L507)
- **Failure scenario**: `coveredWindows` only marks an underlying window `id` as covered when a higher-`z`, `focused` window satisfies `contains(other.rect, window.rect, tolerance)`. On Android, centered dialogs (`AlertDialog` / `Dialog`) create a second `WindowInspector` window whose rect is sized to the dialog, smaller than the full-screen Activity window. When UIAutomator dumps only the focused dialog while `TextLayoutSnapshot` dumps both windows, the Activity window is not marked covered and every underlying Activity text record fails with `live_font_text_probe_unmatched`.
- **Probe evidence**:
  - **Robolectric `Dialog` check**: `WindowInspector` reported `[[0, ProbeRect(0,0,320,470), 0, false], [1, ProbeRect(0,0,136,56), 1, false]]`.
  - **Node `matchTextProbe` probe**: With `window 0 = [0,0,1080,2400]` (`focused: false, z: 0`) and `window 1 = [100,300,300,500]` (`focused: true, z: 1`) and dialog node `'OK'`, `matchTextProbe` returned `{ pass: false, code: 'live_font_text_probe_unmatched', covered: [], unmatchedRecords: [ 0 ] }` (`M10` gap).

### [P3-1] `ellipsizeMode="clip"` truncation with `ellipsized = 0` is never judged (`live-font-scale-proof.mjs:422-426`)

- **File**: [live-font-scale-proof.mjs](file:///Users/murat/opensource/cc/couture-cast-wt-615/scripts/lib/live-font-scale-proof.mjs#L422-L426)
- **Failure scenario**: On Android, `<Text numberOfLines={2} ellipsizeMode="clip">` sets `maxLines = 2` and `setEllipsize(null)` (`ReactTextAnchorViewManager.kt:61`), so `StaticLayout` drops lines beyond 2 while `layout.getEllipsisCount(line)` returns `0` and `contentRect` fits inside 2 lines. `layoutClips` only checks `contentClipped` and `record.ellipsized > coldEllipsized` and ignores `record.unlimitedLineCount > record.lineCount`, allowing clipped lines under `ellipsizeMode="clip"` to pass unflagged. (If intended to match cold `unlimitedLineCount` when intentional, comparing `unlimitedLineCount > lineCount` against cold `unlimitedLineCount - lineCount` would catch regressions without failing cold-intentional clips.)
- **Probe evidence**: `evaluateLiveFontChange` on a settled record with `lineCount: 2, maxLines: 2, ellipsized: 0, unlimitedLineCount: 4` (versus cold `before` `unlimitedLineCount: 2`) produced `checks.clipping.clipped: []` (`M11` gap).

### [P3-2] `PreparedLayoutTextView` omits `preparedLayout.verticalOffset` in `contentRect` (`TextLayoutSnapshot.kt:205-213`)

- **File**: [TextLayoutSnapshot.kt](file:///Users/murat/opensource/cc/couture-cast-wt-615/apps/mobile/modules/text-layout-probe/android/src/main/java/expo/modules/textlayoutprobe/TextLayoutSnapshot.kt#L199-L214)
- **Failure scenario**: RN `PreparedLayoutTextView.onDraw` (`PreparedLayoutTextView.kt:108`) translates by `paddingTop.toFloat() + (preparedLayout?.verticalOffset ?: 0f)`. `TextLayoutSnapshot.read` passes `view.paddingTop` only without `verticalOffset` (and reports `unlimitedLineCount = null` when `maxLines != null`), shifting `contentRect` upward by `verticalOffset` when vertically centered or offset.

---

## Focus Area Summary

1. **Production footprint & IPC security (Focus 1)**:
   - `with-text-layout-probe.js` runs last (`app.json` plugin index 9); excludes `text-layout-probe` from `settings.gradle` (`expoAutolinking.exclude`) and `Podfile` (`use_expo_modules!(exclude: ['text-layout-probe'])`) unless `COUTURE_TEXT_LAYOUT_PROBE === '1'`. `assertIsolatedProbeBuild` blocks EAS `production`/`preview`/`development` profiles and requires `com.couturecast.story6[58]` + `STORY6[58]_NATIVE_TEST_BUILD=1`. `app/text-clip-fixture.tsx` returns `null` unless `EXPO_PUBLIC_TEXT_LAYOUT_PROBE === '1'`.
   - Verified prebuild **without `--clean`** transitioning `probe` -> `production`: `Podfile` and `settings.gradle` both re-acquired the `text-layout-probe` exclusion (`r1=0, r2=0`).
   - **Android IPC**: `TextLayoutProbeReceiver.register` gates with `Manifest.permission.DUMP` (`signature|privileged`) using `Context.RECEIVER_EXPORTED` on API 33+ and `registerReceiver(..., Manifest.permission.DUMP, handler)` on API 29-32. Third-party apps cannot send `DUMP`; `TextLayoutProbeWire.acceptsToken` enforces `^[A-Za-z0-9._:-]{1,128}$`.
   - **iOS IPC**: `TextLayoutProbeAppDelegateSubscriber` observes Darwin `com.couturecast.textlayoutprobe.dump`, but reads `request` and writes `<token>.json` strictly inside the app-sandboxed `Library/Caches/text-layout-probe/`, rejecting invalid tokens (`/`, `..`, `"request"`). Unlinked outside probe builds.
2. **Judge & stale-box soundness (Focus 2)**:
   - `clippedKeys`, `clipsStale`, stale-box comparison against starting-scale cold launch (`coldBefore ?? coldBase`), both-axis tolerance checks, multiline input exclusion vs single-line input judging, and hidden/volatile/scrolled classifications work as specified outside **P2-1**, **P2-2**, **P2-3**, and **P3-1** above.
3. **Native reads (Focus 3)**:
   - Robolectric confirms `ReactEditText` with `inputType and TYPE_TEXT_FLAG_MULTI_LINE.inv()` reports `maxLines = 1` (`ANDROID_PROBE_EDIT_MAXLINES=1`).
   - Android receiver registers on `Looper.getMainLooper()`; iOS observer dispatches to `DispatchQueue.main.async` + `MainActor.assumeIsolated`.
   - iOS `TLPParagraphReader.mm` safely inspects `RCTParagraphComponentView` via Objective-C++ `isKindOfClass:` before `static_pointer_cast<const ParagraphProps>`.
4. **Wire protocol (Focus 4)**:
   - Chunking (`2250` bytes -> `3000` Base64 chars), `sha256` verification over decoded UTF-8 bytes, token regex matching, `begin`/`chunk`/`done` conflict detection, retry up to 3 asks on partial/mismatched answers, and fail-fast on contract violations (`validateTextProbeAnswer`) are sound.
5. **Test & mutant verification (Focus 5)**:
   - **Test runs at `ddd30654` (in `/tmp/wt-615-mutant-r41`)**:
     - `node --test scripts/lib/live-font-text-probe.test.mjs`: **36/36 passed** (`8 suites`, `0 failed`, `0 skipped`).
     - `node --test scripts/lib/live-font-scale-proof.test.mjs`: **80/80 passed** (`9 suites`, `0 failed`, `0 skipped`; F-00i `text layout clipping` = `16/16 passed`).
     - Combined `live-font-{text-probe,scale-proof,capture,journey}.test.mjs`: **193/193 passed** (`30 suites`).
     - `node --test scripts/ci/mobile-text-layout-probe-linking.test.mjs`: **6/6 passed** (runs real `expo prebuild --no-install --clean` + `expo-modules-autolinking` `resolve`, `generate-package-list`, `generate-modules-provider`).
     - Android Robolectric (`Gradle 8.14.3` + `ANDROID_HOME`): `TextLayoutSnapshotTest` (**15/15 passed**, API 36) + `TextLayoutProbeWireTest` (**12/12 passed** across API 32 & 36) + `junit-report-check.mjs` passed for both (`15` and `12`).
     - iOS SwiftPM (`swift test --package-path apps/mobile/modules/text-layout-probe/ios`): **14/14 passed** (XCTest; macOS AppKit TextKit sharing).
     - `apps/mobile` `npx vitest run src/screens/text-clip-fixture.test.tsx`: **not usable cleanly in `/tmp` worktree** (`vitest.config.ts` uses `@vitest/browser-playwright`, which failed serving symlinked `/mockServiceWorker.js` across worktree root and was not bypassed due to the `no Playwright` constraint).
   - **Mutants tested (all killed by existing tests unless noted)**:
     - `M1` (drop horizontal left/right check in `contentClipped`): **KILLED** by `live-font-scale-proof.test.mjs` (`1` fail).
     - `M2` (use `coldBase` instead of `coldBefore` for `staleBox`): **KILLED** by `live-font-scale-proof.test.mjs` (`2` fails).
     - `M3` (bypass `coverAnswered` check in `matchTextProbe`): **KILLED** by `live-font-text-probe.test.mjs` (`1` fail).
     - `M4` (skip `excludeFromPodfile` in `with-text-layout-probe.js`): **KILLED** by `mobile-text-layout-probe-linking.test.mjs` (`3` fails).
     - `M5` (cut `clip` inside `isScrollView` in `TextLayoutSnapshot.kt`): **KILLED** by Robolectric `TextLayoutSnapshotTest` (`2` fails).
     - `M6` (weaken `acceptsToken` in `TextLayoutProbeWire.kt`): **KILLED** by Robolectric `TextLayoutProbeWireTest` (`4` fails across API 32 & 36).
     - `M7` (remove `!ancestor.isScrollView` guard in `TextLayoutProbeWire.swift`): **KILLED** by SwiftPM `TextLayoutProbeRulesTests` (`3` fails).
     - `M8` (return `limited.lines` as `unlimitedLineCount` in `TextLayoutProbeMeasure.swift`): **KILLED** by SwiftPM `TextLayoutProbeRulesTests` (`2` fails).
     - Surviving test gaps (`M9`–`M12`): correspond directly to `P2-1`, `P2-2`, `P2-3`, and `P3-1` above.
6. **`apps/mobile` TypeScript (Focus 6)**:
   - `npx tsc -p apps/mobile/tsconfig.json --noEmit`: exit code `0`, `0` errors.

REVIEW-615-R41-DONE
