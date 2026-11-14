# Story 6.15 Review — Range `44581fe0..c119df78` (Device Driver, Option (a) Merge & Evidence Judge)

- **Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615` (`feat/story-6-15-expo-sdk-58`)
- **Range**: `44581fe0..c119df78` (first-parent)
- **Verdict**: **CHANGES REQUESTED (2 P2, 1 P3; 0 P1 — Merge `4ad5daa6`, Evidence Judge `c119df78`, and Production Marker Gate Pass)**

---

## Summary by Part

1. **Part (1) — Device-driver & live font-scale capture commits (`01f97ea9`, `d8c600e5`, `141e9c32`, `091a7226`, `424b27ef`, `85036706`, `4ca32312`, `e23216b4`)**:
   - **Production build marker gate (`141e9c32`) — PASS**: `liveFontMountMarkersEnabled` (`apps/mobile/components/live-font-mount-marker.tsx:32-34`, `:77`) gates marker rendering on `__DEV__ || Constants.expoConfig?.extra?.liveFontMountMarkers === true`, and `apps/mobile/app.config.ts:26`, `:69` sets `liveFontMountMarkers: isolatedNative` (`STORY65_NATIVE_TEST_BUILD === '1' || STORY68_NATIVE_TEST_BUILD === '1'`, which also enforces localhost API/Supabase URLs and isolated bundle/package IDs). Production builds return `null` and never render test markers.
   - **Stale / wrong-device / wrong-build capture guards (`e23216b4`) and centred touch-target clipping rule (`4ca32312`)**: Found **P2-1**, **P2-2**, and **P3-1** below.
2. **Part (2) — Merge `4ad5daa6` of `origin/main` `a0a01813` (Option (a): iOS shards on `macos-15` iOS 18.5) — PASS**:
   - `scripts/ci/ios-native-workflow.mjs:86-102`: Cleanly combines Story 6.15's `RUN_IF` (`needs.ios-changes.outputs.run == 'true'`) and `PUSH_GROUP` (`schedule` vs `main-push` concurrency groups) with `main`'s `CONSUMER_IF` (`!cancelled() && needs.ios-build.result == 'success'`), `CLIENT_ARTIFACT` tar pack/unpack hand-off on dispatch, `CANARY_WORKFLOW` (`ios-native-canary.yml`), and fixed consumer timeouts.
   - `.github/workflows/pr-apple-native.yml:39-84` & `scripts/ci/apple-native-workflow.test.mjs:61-66`: The Xcode selection step and `env: { XCODE: '26.4+' }` match `ios-native-jobs.yml`'s `ios-build` step-for-step, and the parity test asserts both `run` and `env`.
   - `scripts/ci/native-ios-flow-budget.mjs:10-28`, `scripts/ci/native-ios-command-evidence.test.mjs:215-248`, `scripts/lib/share-card-native-diagnostics.test.mjs:275-401`, `scripts/ci/native-ios-shards.test.mjs:64-68`, and `scripts/lib/story68-flow-timeouts.test.mjs:398-404`: Conflict resolutions keep `main`'s `triald` boot-out, Story 6.15's after-timeout hierarchy / deadline-kill capture tests, and integer `timeout-minutes` checks.
3. **Part (3) — Evidence Judge `c119df78` (`scripts/ci/ios-native-inputs.mjs`) — PASS**:
   - `scripts/ci/ios-native-inputs.mjs:479-485`, `:597`: `runJobsPassed` drops `DISPATCH_SKIPPED_JOB` and requires `jobs.every((job) => job?.conclusion === 'success')` alongside `required.every(...)`. Both `scripts/ci/ios-native-evidence.test.mjs:991-1007` and `scripts/ci/ios-native-runs.test.mjs:148-150` assert that a dispatch with `ios-native / ios-build` skipped fails closed.

---

## Findings

### [P2-1] `clipping()`'s `centred` rule exempts any vertically centered text that grows taller than a fixed-height parent

- **File**: `scripts/lib/live-font-scale-proof.mjs:208-221` (and callers at `:386`, `:501`)
- **Code**:
  ```js
  // A box that overflows its parent by the same amount above and below is a touch target
  // centred on a shorter row (a 44 pt icon button on iOS); text that grows overflows below.
  const centred = pt - top > tolerance && Math.abs(pt - top - (bottom - pb)) <= tolerance
  if (
    left < pl - tolerance ||
    right > pr + tolerance ||
    (!centred && (top < pt - tolerance || bottom > pb + tolerance))
  )
    clipped.push({ id: node.id ?? '', text: node.text })
  ```
- **Failure Scenario**:
  - In React Native (Yoga Flexbox), whenever a text node sits inside a fixed-height container that centers its children vertically (`justifyContent: 'center'` in a column container or `alignItems: 'center'` in a row container — the standard layout for buttons, pills, chips, headers, and list rows), a text child whose scaled height `H_text` exceeds `H_parent` is positioned at `top = pt - (H_text - H_parent) / 2` and `bottom = pb + (H_text - H_parent) / 2`.
  - Consequently, `pt - top` and `bottom - pb` are equal (within `<= 1px` pixel rounding, which is `<= tolerance` on both iOS `1` and Android `2`).
  - Because `centred` checks only `pt - top > tolerance && Math.abs(pt - top - (bottom - pb)) <= tolerance` without checking whether the node is actually a fixed-height 44pt touch target or whether its height grew across scales, **any real text node inside a vertically centered fixed-height container that grows taller than its parent at large font scales overflows equally at top and bottom and is marked `centred = true` (`clipping.pass: true`, `verdict: 'fixed'`)**.
  - Verified in a detached worktree: a probe (`current-condition`) growing from `20pt` (`[0,209][100,229]`) at scale `1.0` to `50pt` (`[0,194][100,244]`) inside a fixed `38pt` centered row (`[0,200][200,238]`) — 6pt clipped at the top and 6pt clipped at the bottom — returns `checks.clipping.pass === true` and `verdict === 'fixed'`.
- **Fix**:
  - Restrict `centred` to fixed-size touch targets that did **not** grow with font scale:
    1. Bound the box to a fixed 44pt touch target with small overhang (e.g. `Math.abs(bottom - top - 44) <= tolerance && pt - top <= 4 + tolerance`), and/or
    2. Pass the base-scale capture (`base` / `coldBefore ?? before`) into `clipping(capture, tolerance, base)` and disallow `centred` when the node's height grew from `base` (`bottom - top - baseHeight > tolerance`).

---

### [P2-2] `EdgeToEdgeModal` places `<LiveFontMountMarker scope="modal" />` outside `accessibilityViewIsModal`, causing iOS `composer` to lose its markers and forcing `assertHierarchySource` + `--config-change` to leave `reactNativeVersion` unchecked

- **Files**:
  - `apps/mobile/components/edge-to-edge-modal.tsx:94-106` (with `apps/mobile/components/share-card-composer.tsx:877-883`)
  - `scripts/lib/live-font-capture.mjs:479-499`
  - `scripts/run-live-font-proof.mjs:580-613`, `:648`
- **Failure Scenarios**:
  1. **iOS `composer` hides `<LiveFontMountMarker scope="modal" />` from XCUITest (`apps/mobile/components/edge-to-edge-modal.tsx:96-105`)**:
     - `EdgeToEdgeModal` renders `<LiveFontMountMarker scope="modal" />` as a sibling of `<KeyboardAvoidingView>`, outside `{children}`.
     - Inside `{children}`, `ShareCardComposer` (`apps/mobile/components/share-card-composer.tsx:878`) and every other sheet (`CommunityPostSheet`, `CommunityCommentsSheet`, `CommunityReportModal`, etc.) sets `accessibilityViewIsModal` on its inner sheet `<View>`.
     - On iOS, UIKit's `accessibilityViewIsModal = YES` hides all sibling subtrees of the modal view and its ancestors from the XCUITest hierarchy, stripping `<LiveFontMountMarker scope="modal" />` (as well as `<LiveFontMountMarker scope="root" />`).
     - As a result, on iOS `composer`, `flattenHierarchy` sees no `live-font-mount-modal-*`, `live-font-scale-modal-*`, or `live-font-env-modal-*` markers (`flat.markers` is `[]`, `flat.jsFontScale` is `undefined`, `flat.environment` is `undefined`), causing `assertLiveProvenance` (`scripts/lib/live-font-capture.mjs:332`) to fail with `live_font_provenance_js_scale:before` and `inPlaceContinuity` (`scripts/lib/live-font-scale-proof.mjs:254`) to fail `rootKnown`.
  2. **`assertHierarchySource` fails open when `seen` is `undefined` (`scripts/lib/live-font-capture.mjs:494-498`)**:
     - Because `composer` hid the markers, `assertHierarchySource` was written as:
       ```js
       if (reactNativeVersion) {
         const seen = flattenHierarchy(tree, { platform }).environment?.reactNativeVersion
         if (seen && seen !== reactNativeVersion)
           throw new Error(`live_font_hierarchy_wrong_build:${seen}`)
       }
       ```
     - On Android (`fingerprint === undefined`), `reactNativeVersion` is the **only** guard in `assertHierarchySource`. Because `if (seen && seen !== reactNativeVersion)` does nothing when `seen === undefined`, any hierarchy read without `live-font-env-*` markers (an unmarked build on another emulator, Android Settings / Launcher after a crash, or an unmarked window) passes `assertHierarchySource` silently.
  3. **`--config-change` runs never initialize `reactNativeVersion` (`scripts/run-live-font-proof.mjs:580-613`, `:648`)**:
     - In `scripts/run-live-font-proof.mjs:582-594`, `if (configChange)` runs `proveConfigChange(name, configChange)` and `continue`s **before** lines `597-613` ever read `reactNativeVersion`.
     - Consequently, during any `--config-change` run, `reactNativeVersion` remains `undefined` for the entire run (`assertHierarchySource` never checks `reactNativeVersion` even when a wrong build marker is present, and `report.reactNativeVersion` at line `648` is written as `null`).
- **Fix**:
  1. In `apps/mobile/components/edge-to-edge-modal.tsx` (without touching `share-card-composer.tsx`, which is pinned by `story69-ipad-evidence.mjs`), inject `<LiveFontMountMarker scope="modal" />` inside the `accessibilityViewIsModal` child element when `children` carries `accessibilityViewIsModal` (e.g. via `cloneElement`), so iOS XCUITest keeps `scope="modal"` markers in the hierarchy when a modal sheet is open.
  2. In `scripts/run-live-font-proof.mjs:580-613`, move the `if (!reactNativeVersion)` initialization block **above** `if (configChange)` so `--config-change` runs also read and enforce `reactNativeVersion` and populate `report.reactNativeVersion`.
  3. In `scripts/lib/live-font-capture.mjs:494-498`, once modal markers stay visible, fail closed when `reactNativeVersion` is given and `seen !== reactNativeVersion` (including when `seen` is `undefined`: `throw new Error(\`live_font_hierarchy_wrong_build:\${seen ?? 'missing'}\`)`).

---

### [P3-1] Substring battery match in `assertHierarchySource` and zero-area `[0,0][0,0]` window selection in `windowBounds`

- **File**: `scripts/lib/live-font-capture.mjs:480-490` and `scripts/lib/live-font-capture.mjs:376-379`
- **Failure Scenarios**:
  1. **Single-digit battery substring match (`scripts/lib/live-font-capture.mjs:483-488`)**:
     - `assertHierarchySource` checks `${fingerprint.battery}% battery power` using `texts.some((text) => text.includes(part))`.
     - `fingerprint.battery` is `1 + (hash % 99)` (`1..99`). Whenever a simulator's UDID hashes to a single-digit battery `b` in `1..9` (e.g. `5`), `"5% battery power"` is a substring of `"15% battery power"`, `"25% battery power"`, ..., `"95% battery power"`. Another simulator at `85% battery power` (with the same `cellular` `0..4` and `wifi` `0..2`) satisfies `text.includes("5% battery power")`.
  2. **Zero-area `[0,0][0,0]` container selected as `window` (`scripts/lib/live-font-capture.mjs:376-379`)**:
     - `windowBounds` sets `if (l === 0 && t === 0 && (!window || area([l, t, r, b]) > area(window))) window = [l, t, r, b]`.
     - When the tree starts with the iOS status bar container `bounds: "[0,0][0,0]"` (`area === 0`) and no other node is anchored at `(0,0)` (for example, a partial/modal hierarchy whose sheet starts at `[0,80][393,852]`), `!window` is `true` on `[0,0][0,0]`, so `window` is set to `[0,0,0,0]` and `windowBounds` returns `"[0,0][0,0]"` instead of falling back to `union`.
- **Fix**:
  1. In `assertHierarchySource`, match each status-bar token with a non-digit boundary before the leading number (e.g. `new RegExp(\`(?:^|\\\\D)\${part}\`)`or`text === part || text.startsWith(\`\${part},\`)`).
  2. In `windowBounds`, require positive area (`area([l, t, r, b]) > 0`) before considering a `(0,0)` node as `window`.

REVIEW-615-MERGE-A-DONE
