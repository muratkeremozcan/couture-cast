# TEA615 Review Report — Round 45 (`0027bf63..f57ec60b`)

- **Repository**: `/Users/murat/opensource/cc/couture-cast-wt-615` (read-only throughout; probe/mutant runs executed in detached `/tmp/wt-615-mutant-r45`, removed and pruned cleanly)
- **Reviewed Range**: `0027bf63..f57ec60b` (skipping `_bmad-output` report commit `23872e29`; 36 non-report files changed: +2997/-221)
- **Overall Assessment**: Solid fixes to `offWindow`, iOS `accessibilityAncestor` identity, Android `transformMatrixToGlobal` pivot mapping, `TabBarLabel` growth/font parity, and Playfair Display Italic loading. **7 P2 issues** and **1 P3 test-gap (2 surviving mutants)** remain across proof self-attestation, non-6.8 clip misclassification, resting-translation masking real overflow as `offWindow`, Android Fabric ignoring `minimumFontScale`, scaled scroll/padding/text bugs, and iOS `accessibilityAncestor` attachment edge cases.
- **Codex Security Diff Scan**: **0 findings** across all 31 code/config diff surfaces (`complete` coverage) — [Codex Security Report](file:///private/tmp/codex-security-scans/couture-cast-wt-615/f57ec60b_r45/report.md)

---

## Findings by Severity (P0–P3)

- **P0**: None.
- **P1**: None.

### P2-1 — `volatileProof` accepts copied same-run `volatileKeys` and omits volatile/non-parity clips from failure (`scripts/lib/live-font-scale-proof.mjs:1501-1512, 1541-1565`)
- **Failure scenario**: `volatileProofProblem` checks `runs.length >= 2`, distinct non-empty string `id`s, `shaped(entry.volatileKeys)`, and `canonicalVolatileKeys(entry.volatileKeys) === canonicalVolatileKeys(legVolatileKeys(captures))` against the current run only. Duplicating the single run's `volatileKeys` twice with `"copied-run-1"` and `"copied-run-2"` satisfies the proof without executing a second independent capture run, and `volatileKeys` does not pin capture hashes, launch IDs, or distinct artifact files. Additionally, `clipProblem` (`L1501-1512`) puts every `entry.parityKey === null && entry.face === 'staleBox'` clip into `pageOnly`, exempting all volatile and later-page `staleBox` clips. Finally, `volatileRegionIds` keys records as `[regionId, maskText(text)]#n`, so adding/removing a duplicate-text row inside a volatile region between `before`/`cold` and `settled` shifts ordinal `#n` indices and pairs different elements.
- **Probe evidence**:
  - `PROBE_1A`: Passing two cloned entries (`"copied-run-1"`, `"copied-run-2"`) produced from a single run's `volatileKeys` passes `volatileProofProblem` (matching `scripts/lib/live-font-scale-proof.test.mjs:2779-2783`).
  - `PROBE_1D`: Inserting an extra `"Saved"` row in `settled` inside volatile region `"spotlight"` shifted indices and emitted `{"key":"volatile:[\"spotlight\",\"Saved\"]#0","volatile":true,"comparable":true,"staleBox":true,"face":"staleBox"}`.

### P2-2 — Non-6.8 clips misclassified as `staleContent` or `staleBox` (`scripts/lib/live-font-scale-proof.mjs:721-740, 1222-1232`)
- **Failure scenario**:
  1. `faces` sets `staleContentFrom = keptFrom(start) ? 'startCold' : keptFrom(before) ? 'before' : null` using only scalar `rectHeight(source.contentRect)` equality. On a downward leg (e.g., `2.0 -> 1.0`), a genuinely fresh `50px` box (`freshBox = true`) that introduces a new horizontal+vertical clip whose `contentRect` height (`32`) happens to match `before`'s `contentRect` height (`32`) is stamped `face: "staleContent"` (`staleContentFrom: "before"`), attributing a real layout clip to the 6.8 stale-content exemption class.
  2. On later pages (`pages: [1]`), `parityKey` is always `null` (parity is page-0 only). When a text's content scales to `80px` inside a fixed `maxHeight: 40px` container matching `start` (`baseHeight: 40`), `markStaleClips` marks `stale: true, face: "staleBox"` solely from `staleBox && boxMiss` with no content-parity check, causing `clipProblem` to exempt it via `pageOnly`.
- **Probe evidence**:
  - `PROBE_1B`: `{"key":"[\"title\",\"Title\"]#0","content":true,"height":50,"baseHeight":60,"targetHeight":50,"staleBox":false,"staleContent":true,"staleContentFrom":"before","face":"staleContent"}` (`clipKeys: ["staleContent:cold:[\"title\",\"Title\"]#0"]`).
  - `PROBE_1C`: `{"key":"[\"detail\",\"Detail\"]#0","parityKey":null,"pages":[1],"height":40,"baseHeight":40,"targetHeight":80,"staleBox":true,"boxMiss":true,"stale":true,"face":"staleBox"}`.

### P2-3 — Resting translation with real layout overflow collapses into `offWindow: true` (`TextLayoutProbeWire.swift:473-477`, `TextLayoutSnapshot.kt:482-487`)
- **Failure scenario**: Both iOS (`TextLayoutProbeWire.swift:473-477`) and Android (`TextLayoutSnapshot.kt:482-487`) mark `offWindow = true` whenever `clip == nil && disjoint(viewRect, window) && untranslatedClip != nil`. Because `untranslatedClip != null` only asks whether any slice of the untranslated frame overlaps `window` (even by `1px`), a view that was already laid out overflowing the window AND also has a resting translation pushing its visible rect outside the window is reported as `offWindow: true`, hiding the layout overflow inside the non-clipping `offWindow` category instead of failing or requiring full containment before translation.
- **Probe evidence**:
  - Swift `testR45ProbeFocus2And3`: `viewRect(400, 100, 110, 30)` with `translationX: 30` (laid out at `370..480` over a `0..390` window — overflowing by `90pt`) returned `offWindow = true`.
  - Android `r45ProbeFocus2And3`: `ProbeRect(10, 860, 210, 900)` with `translationY: 30f` over an `844px` window (laid out at `830..870`) printed `ANDROID_F2_OFFWINDOW=true clip=null`.

### P2-4 — Android Fabric ignores `minimumFontScale` (`0.5`) on `TabBarLabel` and drops `beside-icon` positioning (`apps/mobile/components/tab-bar-label.tsx:101-102`, `apps/mobile/app/(tabs)/_layout.tsx:114`)
- **Failure scenario**:
  1. `TabBarLabel` sets `adjustsFontSizeToFit` and `minimumFontScale={TAB_LABEL_MIN_SCALE}` (`0.5`) expecting Android and iOS to stop shrinking at 50% of `11px` (`5.5px`). In `node_modules/react-native/ReactCommon/react/renderer/components/text/conversions.h:950-955, 1070-1097`, C++ Fabric parses `minimumFontScale` into `ParagraphAttributes`, but `toMapBuffer` only writes `PA_KEY_MINIMUM_FONT_SIZE` (`L1092`) and omits `minimumFontScale`. In `node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/views/text/TextLayoutManager.kt:712-715, 819`, `minimumFontSize` reads `NaN` and falls back to `4.dpToPx()`, and `L839-849` multiplies existing span sizes in-place per binary-search iteration (`span.size * ratio`), compounding shrink down toward `4dp`.
  2. `TabLayout` (`apps/mobile/app/(tabs)/_layout.tsx:114`) overrides `tabBarLabel` without forwarding or handling `@react-navigation/bottom-tabs` `position` (`beside-icon` vs `below-icon`) on tablets (`apps/mobile/app.json` has `ios.supportsTablet: true`) or horizontal bar layouts.

### P2-5 — Android `Reading.content`, flipped `ancestorClips` padding, scaled scroll travel, and API < 29 `screenRect` inaccuracies (`TextLayoutSnapshot.kt:202-214, 328-335, 449-455, 495-517`, `TextLayoutProbeWire.swift:489-495`)
- **Failure scenario**:
  1. `TextLayoutSnapshot.kt:202-214` adds unscaled `layout.getLineTop(0)` / `getLineBottom(...)` onto `viewRect.top`, so under a scaled parent (`scaleY = 0.5f`), `contentRect` height stays unscaled (`24px`) inside a `50px` `viewRect` (or exceeds `viewRect` at smaller scales).
  2. `TextLayoutSnapshot.kt:328-335` subtracts unflipped `paddingTop` / `paddingBottom` in screen coordinates (`bounds.top + ancestor.paddingTop`), so under `scaleY = -1f` with `paddingTop = 30, paddingBottom = 0`, visual padding is at the bottom (`270..300`) while `ancestorClips` wrongly clips `200..230` off the top.
  3. Both `TextLayoutSnapshot.kt:449-455` and `TextLayoutProbeWire.swift:489-495` widen `reach` using unscaled `scroll.maximum` / `scroll.offset` even when an ancestor scales screen coordinates (`scale != 1`).
  4. On Android API `< 29`, `TextLayoutSnapshot.kt:495-517` lacks `transformMatrixToGlobal` and falls back to unscaled `at + width/height`.
- **Probe evidence**:
  - `ANDROID_F3A_SCALED_TEXT viewH=50 contentH=24` (`scaleY = 0.5f`).
  - `ANDROID_F3B_PIVOT viewRect=ProbeRect(left=0, top=250, right=200, bottom=300)` confirmed `transformMatrixToGlobal` works accurately for `pivotY=0f, scaleY=-1f, translationY=200f` on API >= 29.
  - `ANDROID_F3C_PADDING_FLIP viewRect=ProbeRect(left=0, top=170, right=200, bottom=270) visible=ProbeRect(left=0, top=230, right=200, bottom=270)`.

### P2-6 — iOS `accessibilityAncestor` attachment blocks geometric fallback and skips `contains` (`scripts/lib/live-font-text-probe.mjs:760-810`)
- **Failure scenario**:
  1. When an iOS `TextRecord` carries `accessibilityAncestor.identifier` for a child/inner container that Appium omits from the accessibility tree (flattened under an accessible parent such as `"tab-home"`), `named` matching that identifier is empty (`named.length === 0`), `resolveLeftovers` leaves the record free instead of falling back to geometric container matching, and pairing fails with `live_font_text_probe_unmatched`.
  2. When multiple open hierarchy nodes share the same `id` (e.g., `"pill"`), `resolveLeftovers` picks by `node.id === ancestor.identifier && overlapRatio(node.box, ancestor.rect) > 0` without checking that `node.box` actually `contains` the record's rect, allowing a shifted `ancestor.rect` to attach the record to a sibling `pillB` that does not enclose it. Meanwhile, when `accessibilityAncestor` is `null`, an already-paired enclosing sibling button can still claim the leftover via `attached`.
- **Probe evidence**:
  - `R4E`: Missing hierarchy node for `"icon-box"` fails `live_font_text_probe_unmatched` without geometric fallback.
  - `R4D`: Duplicate `id: "pill"` (`pillA [10..110]` vs `pillB [15..115]`), shifted `ancestor.rect [16..116]` attaches record `[12..24]` to `pillB` with `"via": "attached"`.
  - `R4C`: `accessibilityAncestor: null` attaches either via open enclosing `"card"` (`"via": "group"`) or already-paired enclosing sibling button (`"via": "attached"`).

### P3-1 — Two surviving mutants expose missing unit tests (`TextLayoutProbeWire.swift`, `TextLayoutSnapshot.kt`)
- `M2_ios_inverted_x_single_ancestor` (**SURVIVED**, `rc=0`): Mutating `inverted: onScreen.a < 0` to `inverted: ancestor.transform.a < 0` in `TextLayoutProbeWire.swift` passes because `TextLayoutProbeRulesTests.testAHorizontallyInvertedScrollViewReachesLeftOfItsViewport` places `scaleX = -1` directly on the scroll view without an outer `holder` ancestor.
- `M11_android_untranslated_unscaled_shiftY` (**SURVIVED**, `rc=0`): Mutating `shiftY += level.transform.translationY * scaleY` to `shiftY += level.transform.translationY` in `TextLayoutSnapshot.kt` passes because `aTranslationIsUndoneAsTheScaleOfTheViewsOutsideItMapsIt` puts `translationY = 300f` on `own` rather than on an intermediate `Level` inside a scaled outer `Level`.

---

## Focus Areas (1)–(7) Assessment

### Focus (1) — `volatile` pairing, `volatileProof`, `faces`, `staleContentFrom`, `clipKeys`
- `volatileRegionIds` aligns 1:1 with `volatileRegions` in `flattenHierarchy` (`scripts/lib/live-font-capture.mjs:153-165`).
- Weaknesses documented in **P2-1** (`PROBE_1A`, `PROBE_1D`) and **P2-2** (`PROBE_1B`, `PROBE_1C`): `volatileProofProblem` checks against current-run `volatileKeys` only; `pageOnly` exempts all `parityKey === null && face === 'staleBox'` entries; `staleContent` / `staleBox` classify non-6.8 clips on downward legs (`before` height collision) and later pages (`parityKey === null`).

### Focus (2) — `offWindow` by translation on iOS and Android
- Both platforms restrict `offWindow = true` to `clip == nil && disjoint(viewRect, window) && untranslatedClip != nil` (solving r44's layout-off-window mask).
- Remaining flaw documented in **P2-3** (`testR45ProbeFocus2And3`, `ANDROID_F2_OFFWINDOW=true`): any 1px untranslated window overlap causes a view with genuine layout overflow plus a small resting translation to collapse into `offWindow: true`.

### Focus (3) — Inversion & full-matrix transform mapping
- Android `screenRect` via `transformMatrixToGlobal` + `Matrix.mapPoints` (`TextLayoutSnapshot.kt:495-517`) accurately maps custom pivots (`pivotY = 0f, scaleY = -1f, translationY = 200f` verified by `ANDROID_F3B_PIVOT` on API >= 29).
- Remaining issues documented in **P2-5** (`Reading.content` unscaled line offsets, unflipped `ancestorClips` padding under negative scale, unscaled `scroll.travel`, API `< 29` fallback) and **P3-1** (`M2` and `M11` surviving mutants).

### Focus (4) — iOS attachment identity (`accessibilityAncestor`)
- Native capture (`TextLayoutProbeSnapshot.swift`) and wire schema correctly identify the nearest element inside the enclosing accessible superview (`isAccessibilityElement`), and `live-font-text-probe.mjs` strictly validates `accessibilityAncestor` shape.
- Attachment flaws documented in **P2-6** (`R4D`, `R4E`, `R4C`).

### Focus (5) — `TabBarLabel`, `glyph-box`, Playfair Display Italic
- **Accessibility & LCV parity**: `node_modules/expo-router/node_modules/@react-navigation/bottom-tabs/lib/module/views/BottomTabItem.js:134-142` keeps `'aria-label'`, `accessibilityLargeContentTitle`, `accessibilityShowsLargeContentViewer: true`, `role`, and `'aria-selected'` on `PlatformPressable` even with custom `tabBarLabel`. `MEDIUM` in `apps/mobile/components/tab-bar-label.tsx:24-28` matches `fonts.medium` in `@react-navigation/native/lib/module/theming/fonts.js:11-49`.
- **Android Fabric `minimumFontScale` & tablet `position` gap**: See **P2-4**.
- **`glyph-box` & Playfair Italic**: `glyphBoxSide` in `apps/mobile/components/glyph-box.ts` skips pixel rounding when effective `scale <= 1` and caps via finite `maxFontSizeMultiplier >= 1`; `apps/mobile/app/_layout.tsx` registers `'Playfair Display Italic': PlayfairDisplay_400Regular_Italic`, matching `apps/mobile/components/hero/outfit-recommendation-card.tsx` (Playfair family index confirmed `PlayfairDisplay_400Regular_Italic`).
- **Vitest Playwright scope note**: `tab-bar-label.test.tsx`, `glyph-box.test.tsx`, `community-card.test.tsx`, `community-post-sheet.test.tsx`, `outfit-recommendation-card.test.tsx`, `wardrobe-hub-screen.test.tsx`, and `root-layout-startup.test.tsx` were inspected in diff/source; they were **not executed** because `apps/mobile/vitest.config.ts` uses `@vitest/browser-playwright` (prohibited in this review).

### Focus (6) — Replaced-Assertion Audit
All 7 replaced/removed assertions in `0027bf63..f57ec60b` are justified and do not weaken coverage:

| Change | Verdict | Assessment |
| --- | --- | --- |
| iOS outside window by layout -> `offWindow: false` (`TextLayoutProbeRulesTests.swift`) | **Sound** | Aligns test with r44 P1-1 ruling (only translation-induced off-window is non-clipping). |
| Non-clipping scroll -> widens reach (`TextLayoutProbeRulesTests.swift`, `TextLayoutSnapshotTest.kt`) | **Sound** | Aligns with r44 P2-1 ruling using travel band rather than fixed clip. |
| Taller-than-window `far` -> `offWindow: false` on iOS & Android | **Sound** | Prevents tall oversized frames from being hidden as `offWindow`. |
| Parked sheet fixture gains explicit `translation` | **Sound** | Models the off-screen parked-sheet mechanism accurately. |
| Probe record wire contract adds `accessibilityAncestor: null` on iOS | **Sound** | Matches additive wire contract update in `TextLayoutProbeSnapshot.swift` and fixture helper. |
| Android `number()` rejects non-`Number` instead of coercing | **Sound** | Enforces fail-closed wire parsing per r44 P3-1. |
| Invalid-list opacity assertions moved to dedicated `live_font_text_probe_opacity_invalid` test (`live-font-text-probe.test.mjs`) | **Sound** | Tightened to dedicated fail-closed error code rather than weakened. |

### Focus (7) — TypeScript Check (`apps/mobile/tsconfig.json`)
- Executed read-only: `npx tsc -p /Users/murat/opensource/cc/couture-cast-wt-615/apps/mobile/tsconfig.json --noEmit` -> **`rc=0`** (0 errors).

---

## Test & Mutation Evidence

### Automated Suites Executed (in detached `/tmp/wt-615-mutant-r45` at `f57ec60b`, pruned after run)
1. **Node harness tests**:
   `node --test scripts/lib/live-font-{capture,pages,text-probe,scale-proof,journey}.test.mjs scripts/lib/text-layout-probe-mode.test.mjs scripts/lib/story68-{native-build-env,release-live-font-command}.test.mjs`
   -> `tests 302`, `suites 45`, `pass 302`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`, `duration_ms 885.86275`.
2. **iOS Swift rules tests**:
   `swift test --package-path apps/mobile/modules/text-layout-probe/ios`
   -> `Test Suite 'TextLayoutProbeRulesTests' passed`: `Executed 54 tests, with 0 failures (0 unexpected) in 0.035 (0.037) seconds`. (Swift Testing reported `0` tests.)
3. **Android Robolectric + CI JUnit gate**:
   `gradle -p apps/mobile/modules/text-layout-probe/android/unit-tests testDebugUnitTest --console=plain --no-daemon` + `node scripts/ci/junit-report-check.mjs`
   -> exited `0`; verified `TEST-expo.modules.textlayoutprobe.TextLayoutSnapshotTest.xml` (at least `52` tests, 0 skipped/failed/errored) and `TEST-expo.modules.textlayoutprobe.TextLayoutProbeWireTest.xml` (at least `20` tests, 0 skipped/failed/errored).

### Mutation Testing Summary (13 mutants: 11 KILLED, 2 SURVIVED)

| Mutant | Description | Outcome |
| --- | --- | --- |
| `M1_ios_offWindow_no_untranslated` | Drop `untranslatedClip != nil` guard in iOS `offWindow` | **KILLED** (`rc=1`) |
| `M2_ios_inverted_x_single_ancestor` | Use single `ancestor.transform.a < 0` instead of composed `onScreen.a < 0` | **SURVIVED** (`rc=0`) |
| `M3_ios_opacity_refusal_bypass` | Bypass iOS out-of-range/non-finite opacity refusal | **KILLED** (`rc=1`) |
| `M4_ios_omit_accessibilityAncestor` | Omit `accessibilityAncestor` from iOS wire output | **KILLED** (`rc=1`) |
| `M5_android_screenRect_no_matrix` | Bypass `transformMatrixToGlobal` in Android `screenRect` | **KILLED** (`rc=1`) |
| `M6_android_inverted_y_single_ancestor` | Use single-level Y inversion instead of composed `scaleY < 0` | **KILLED** (`rc=1`) |
| `M7_android_wire_number_no_require` | Drop strict `Number` `require` check in `TextLayoutProbeWire.kt` | **KILLED** (`rc=1`) |
| `M8_js_missing_ancestor_fallback` | Allow geometric fallback when named `accessibilityAncestor` is missing | **KILLED** (`rc=1`) |
| `M9a_js_volatileProof_single_run` | Accept `runs.length === 1` in `volatileProofProblem` | **KILLED** (`rc=1`) |
| `M9b_js_staleContent_before` | Drop `'before'` check in `staleContentFrom` | **KILLED** (`rc=1`) |
| `M10_js_pageImage_page0` | Emit `-page0.png` suffix in `pageImage(..., 0)` | **KILLED** (`rc=1`) |
| `M11_android_untranslated_unscaled_shiftY` | Drop `* scaleY` on `level.transform.translationY` in `TextLayoutSnapshot.kt` | **SURVIVED** (`rc=0`) |
| `M12_android_switch_ignore_showText` | Ignore `getShowText()` thumb text check on `ReactSwitch` | **KILLED** (`rc=1`) |

REVIEW-615-R45-DONE
