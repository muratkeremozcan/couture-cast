# Round 43 Review (`b0bd7215..791123d1`)

**Target**: `/Users/murat/opensource/cc/couture-cast-wt-615` (`HEAD = 791123d1`, range `b0bd7215..791123d1` excluding report commits `e0db5bc8` and `cdfffecc`)
**Mutant/Run Worktree**: `/tmp/wt-615-mutant-r43` (detached at `791123d1`, removed and pruned; shared tree stayed read-only and clean)
**Codex Security Scan**: `/private/tmp/codex-security-scans/couture-cast-wt-615/791123d1_r43/report.md` (0 reportable security findings)

---

## Findings

### P1 — Axis-opening scroll rule passes visibly cut, unreachable text across smaller outer clippers, tall scroll views, and unscrollable Android `ScrollView`s
- **Locations**:
  - `apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeWire.swift:105-123` (`TextLayoutProbeWire.cuts`)
  - `apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeSnapshot.swift:183-189` (`scrolls(_:horizontally:)`)
  - `apps/mobile/modules/text-layout-probe/android/src/main/java/expo/modules/textlayoutprobe/TextLayoutSnapshot.kt:246-259` (`clips`)
- **What happens**: Once any ancestor scroll view opens `openX` or `openY`, every ancestor clipper above it and the `window` itself are opened unconditionally along that axis (`openAxes`) with no bound for actual scrollable travel.
- **Concrete failure scenarios (reproduced in XCTest & Robolectric probes)**:
  1. **Outer clipper smaller than scroll view / small scroll travel**: In `Wire.cuts`, a fixed clipper at `y = 100..160` (`height = 60`) wrapping a `UIScrollView` (`y = 100..200`, `scrollsY = true`, max scroll = `5pt`) with text at `y = 140..190` cannot scroll the bottom `25pt` (`160..185`) into the `100..160` clipper. `Wire.cuts` returned `visible = (0.0, 140.0, 100.0, 20.0)` and `clip = (0.0, 140.0, 100.0, 50.0)`, leaving `clipRect` uncut across `y` so the oracle passes permanently cut, unreachable text.
  2. **Scroll view taller than the window**: In `Wire.cuts`, a `UIScrollView` (`y = 0..1000`, `scrollsY = true`, e.g., `10pt` max scroll) inside a `window` (`0..500`) with text at `y = 600..640` returned `visible = nil` and `clip = (0.0, 600.0, 100.0, 40.0)` (`scrolledAway = true`). Even though `10pt` scroll cannot bring `600..640` into `0..500`, the record is treated as `scrolledAway` and passes.
  3. **Unscrollable `ScrollView` on Android / `isScrollEnabled = false` on iOS**: `TextLayoutSnapshot.kt:246-247` sets `scrollsX = ancestor is HorizontalScrollView` and `scrollsY = ancestor is ScrollView` without checking whether content actually overflows the viewport. Under Robolectric, a `300x200` `ScrollView` containing a non-overflowing `300x180` child inside a `300x60` `OverflowViewGroup` with text at `y = 35..85` yielded `visible = ProbeRect(0, 35, 200, 60)` alongside `clip = ProbeRect(0, 35, 200, 85)` (`scrolledAway = false`), opening the `60px` outer clip even though `0px` can scroll. On iOS, `scrolls(_:horizontally:)` checks `contentSize + adjustedContentInset > bounds + 0.5` without checking `scroll.isScrollEnabled`.

### P2 — iOS `collect` drops views with `alpha <= 0.01`, contradicting TEA's opacity ruling (`0` vs `> 0`) and omitting `opacity: 0` records
- **Locations**:
  - `apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeSnapshot.swift:29` (`collect`)
  - Secondary wire precision note: `apps/mobile/modules/text-layout-probe/android/src/main/java/expo/modules/textlayoutprobe/TextLayoutProbeWire.kt:73-77` (`number`)
- **What happens**: `TextLayoutProbeSnapshot.swift:29` returns early when `view.isHidden || view.alpha <= 0.01`.
- **Concrete failure scenarios**:
  1. A partially faded iOS view at `alpha = 0.01` (`> 0`) still renders pixels and should be judged per TEA's ruling ("exactly `0` opacity is invisible, anything above is judged"), yet iOS omits the view and its entire subtree from `records`. On Android (`TextLayoutSnapshot.kt:118` checks only `view.isShown`), `alpha = 0.01f` emits `0.01` (`0.009999999776482582`) and is judged.
  2. When an iOS view becomes hidden (`alpha = 0` or `isHidden = true`), iOS omits its record instead of emitting `opacity: 0`, so `hiddenText()` (`live_font_text_hidden`) receives `invisible = []` on iOS; whereas on Android `alpha = 0f` (`visibility = VISIBLE`) emits `opacity: 0` and triggers `live_font_text_hidden`. (Note also that Android `TextLayoutProbeWire.number` rounds to 4 decimals, so `4e-5f` serializes to `0`.)

### P2 — Build probe guard (`assertNativeProbeMode`) checks `ios/Podfile` before `pod install` and ignores `ios/Podfile.lock` / `Pods` on `build`
- **Locations**:
  - `scripts/lib/text-layout-probe-mode.mjs:23-26, 52-63`
  - `scripts/run-story68-native.mjs:761-773, 811-815`
- **What happens**: `PROBE_MODE_FILES.ios` inspects only `ios/Podfile`. During `prebuild`, `assertNativeProbeMode` runs *before* `pod install` (`L762-773`), and during `build` (`L811`) it never verifies `ios/Podfile.lock` (or generated `Pods` target support files).
- **Concrete failure scenarios**:
  1. If `ios/Podfile` matches a production build (`use_expo_modules!(exclude: ['text-layout-probe'])`), e.g. after switching modes without `--clean` and skipping or failing `pod install`, `assertNativeProbeMode({ platform: 'ios', ... })` passes cleanly while `xcodebuild` still compiles and links `TextLayoutProbe` from stale `ios/Pods` / `Podfile.lock` (reproduced with a synthetic `Podfile` + stale `Podfile.lock` listing `TextLayoutProbe`).
  2. **Minor P3 regex fragility**: `EXCLUDED.ios` (`text-layout-probe-mode.mjs:23-26`) rejects trailing comments (`# ...`) and double quotes (`"text-layout-probe"`), classifying such a production `Podfile` as `'probe'`. On Android `build`, `prepareWorkletsStaging` (`run-story68-native.mjs:789`) runs before `assertNativeProbeMode` (`L811`).

### P3 — Two test-coverage gaps shown by surviving mutants in `preparedUnlimitedLines` and `TextLayoutProbeMeasure.field`
- **Locations**:
  - `apps/mobile/modules/text-layout-probe/android/src/main/java/expo/modules/textlayoutprobe/TextLayoutSnapshot.kt:387-395` (`preparedUnlimitedLines`), `485-490` (`verticalOffsetOf`), `492-497` (`maxLinesOf`)
  - `apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeMeasure.swift:88-90` (`field`)
- **What happens**:
  1. Mutating `preparedUnlimitedLines` to `return layout.lineCount` **survived** all 26 `TextLayoutSnapshotTest` cases because `StaticLayout.Builder.setMaxLines(2).setEllipsize(null)` on API 36 already produces `layout.lineCount == 4`; re-layout is never differentiated from returning `layout.lineCount` on a capped `Layout`. Also `preparedUnlimitedLines` passes `textView = null` to `relaidLines` (omitting `breakStrategy`, `hyphenationFrequency`, `justificationMode`), and `verticalOffsetOf` / `maxLinesOf` have no field fallback (unlike `layoutOf` at `L476-483`).
  2. Mutating `if width > area.width` to `if false` in `TextLayoutProbeMeasure.field` **survived** all 25 `TextLayoutProbeRulesTests` cases because `testAFieldWiderThanItsTextRectRunsPastItAtItsNaturalWidth` tests only `.natural` LTR (where the `else` branch also selects `area.minX`), leaving `.right` and `.center` overflow anchoring untested.

---

## Focus Verification & Baselines

- **Focus (4) verified clean**:
  - `junit-report-check.mjs`: r42 probes `C1b` (comment split across CDATA -> `['case a: failure']`), `C4` (PI hiding comment markers -> `['case b: failure', '2 <testcase> elements, but tests says 1']`), and empty report (`['no <testsuite> element']`) all caught; two-pass mutant **J1** killed.
  - `revenuecat-key-hygiene.mjs`: EAS `extends`, `NODE_ENV`, platform env overrides, and assembled `test_` prefixes caught across both loader orders; mutants **K1** (`extends` ignored), **K2** (`seed` dropped), **K3** (single loader order) all killed.
  - `revenuecat-client.ts`: empty `non_subscriptions` list, missing `purchase_date`/`store`, or object-shaped map throw transient `RevenueCatResponseShapeError` (only Zod `path: code` logged); mutant **R1** (`.nonempty()` dropped) killed.
- **Focus (5) killed mutants**: J1, K1, K2, K3, R1, M1 (`probeMode` accepting `'true'`), L1 (`opacity === 0`), L2 (`comparable` filter), L3 (`truncatedLines > coldTruncated`), L4 (`entryKeys` `maskText`), S1 (iOS open both axes), A1 (Android `verticalOffset=0`), A3 (Android open both axes) all **KILLED**. Survived: **A2** (`preparedUnlimitedLines`), **S2** (`field` `width > area.width`).
- **Focus (6) & Test Baselines** (in `/tmp/wt-615-mutant-r43` & shared tree read-only `tsc`):
  - `npx tsc -p apps/api/tsconfig.json --noEmit && npx tsc -p apps/mobile/tsconfig.json --noEmit`: exit `0`
  - `node --test scripts/ci/junit-report-check.test.mjs scripts/ci/revenuecat-key-hygiene.test.mjs scripts/ci/revenuecat-bundle-scan.test.mjs scripts/lib/live-font-scale-proof.test.mjs scripts/lib/live-font-text-probe.test.mjs scripts/lib/text-layout-probe-mode.test.mjs scripts/lib/story68-native-build-env.test.mjs scripts/lib/story68-release-live-font-command.test.mjs`: `193 passed, 0 failed, 0 skipped`
  - `npx --prefix apps/api vitest run src/modules/commerce/revenuecat-client.spec.ts`: `60 passed (60)`
  - `swift test --package-path apps/mobile/modules/text-layout-probe/ios`: `25 passed, 0 failed`
  - `gradle -p apps/mobile/modules/text-layout-probe/android/unit-tests testDebugUnitTest` + `junit-report-check.mjs`: `TextLayoutSnapshotTest` (`26`, 0 skipped/failed/errored) + `TextLayoutProbeWireTest` (`14`, 0 skipped/failed/errored) passed.

REVIEW-615-R43-DONE
