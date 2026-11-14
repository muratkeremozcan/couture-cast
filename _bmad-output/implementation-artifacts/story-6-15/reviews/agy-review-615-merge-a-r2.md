# Story 6.15 Re-Check Round 2 — Range `c119df78..13873a7d`

- **Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615` (`feat/story-6-15-expo-sdk-58`)
- **Range**: `c119df78..13873a7d` (`f2b59869`, `d7daafde`, `ef9bb9e0`, `d55a6ce8`, `bdeaf988`, `b36401d1`, `13873a7d`)
- **Verdict**: **CHANGES REQUESTED (1 P2, 1 P3; 0 P1 — P2-2b, P2-2c, P3-1, and `f2b59869` Closed)**

---

## Closure Verification Summary

1. **`f2b59869` (`scripts/ci/ios-native-evidence.mjs:339`) — CLOSED (PASS)**:
   - Drops the dead `{ dispatch: true }` argument to `runJobsPassed(jobs, options.graphs.dispatch)`.
2. **P2-2b (`bdeaf988`: `scripts/lib/live-font-journey.mjs:318-323`, `scripts/run-live-font-proof.mjs:592-628`) — CLOSED (PASS)**:
   - `screenRunSteps({ configChange, versionKnown })` orders `'read-version'` before `'config-change'` whenever `versionKnown` is `false`, so `--config-change` runs read and enforce `reactNativeVersion` and record it in the output report.
3. **P2-2c (`13873a7d`: `scripts/lib/live-font-capture.mjs:499-506`, `scripts/run-live-font-proof.mjs:117-133`) — CLOSED (PASS)**:
   - `assertHierarchySource` now fails closed with `live_font_hierarchy_wrong_build:missing` when `reactNativeVersion` is set and `seen` is `undefined`.
   - `hierarchy()` retries only `error.message === 'live_font_hierarchy_wrong_build:missing'` and only while `attempt < 3`: a wrong device (`live_font_hierarchy_wrong_device:...`) or wrong build (`live_font_hierarchy_wrong_build:<other>`) fails immediately on attempt 1, and a persistently unmarked screen fails on attempt 3 without ever turning into a pass.
4. **`ef9bb9e0` (`apps/mobile/components/live-font-mount-marker.tsx:71`, `:88`) — CLOSED (PASS)**:
   - Uses `i18n?.language ?? 'unknown'` so test doubles that mock `useTranslation` with `{ t }` alone do not throw.
5. **P3-1 (`b36401d1`: `scripts/lib/live-font-capture.mjs:366-386`, `:494-497`) — CLOSED (PASS)**:
   - `whole = (part) => new RegExp(\`(^|\\\\D)\${part}\`)` prevents single-digit battery levels (`5%`) from matching `85%`, and `windowBounds`ignores boxes where`!(box[2] > box[0] && box[3] > box[1])`.
6. **P2-1 (`d7daafde`: `scripts/lib/live-font-scale-proof.mjs:211-232`, `:401`, `:427`) — PARTIAL (See P2-1 below)**.
7. **P2-2a (`d55a6ce8`: `apps/mobile/components/edge-to-edge-modal.tsx:89-105`) — PARTIAL for nested/fragment/array modal sheets (See P3-1 below)**.

---

## Remaining Findings

### [P2-1] `clipping()`'s `centred` rule still exempts tolerance-slack growth (`+1..2px` across the clipping boundary), unclipped-at-base boxes whose parent shrunk, and stale clipped text on return legs (`1.5 -> 1.0`)

- **File**: `scripts/lib/live-font-scale-proof.mjs:211-232`, `:401`, `:427`
- **Code**:
  ```js
  function clipping(capture, tolerance, base) {
    const baseNodes = base ? keyed(base) : new Map()
    const clipped = []
    for (const [key, node] of keyed(capture)) {
      if (node.parent === undefined) continue
      const [left, top, right, bottom] = parseBounds(node.bounds)
      const [pl, pt, pr, pb] = parseBounds(node.parent)
      const before = baseNodes.get(key)
      const centred =
        before !== undefined &&
        Math.abs(height(before) - (bottom - top)) <= tolerance &&
        pt - top > tolerance &&
        Math.abs(pt - top - (bottom - pb)) <= tolerance
  ```
- **Failure Scenarios** (both verified in the detached `/tmp` worktree):
  1. **Tolerance-slack growth (`Math.abs(height(before) - (bottom - top)) <= tolerance`) and no check that `before` was already centred-overflowing**:
     - On Android (`tolerance = 2`), suppose a text node at `base` (`1.0`) is `28px` tall (`[0,98][100,126]`) inside a `24px` centered row (`[0,100][200,124]`): at `1.0` it overflows by `2px` top and bottom (`<= tolerance`, unclipped), or suppose at `1.0` its parent was `40px` tall (0px overflow, unclipped).
     - At `settled` (`1.5`), the text grows by `2px` (`tolerance`) to `30px` (`[0,97][100,127]`, overflowing `3px > tolerance` top and bottom — now clipped!), or its parent row is squeezed to `24px` while the text stays `28px`/`30px`.
     - Because `|28 - 30| = 2 <= tolerance` and `clipping()` never checks whether `before` had the same height without growth (`bottom - top <= height(before)`) or already had that same centred overhang over `before.parent`, `centred` evaluates to `true` and `checks.clipping` returns `{ pass: true, clipped: [] }`.
  2. **Return-leg (`1.5 -> 1.0` / `1.786 -> 1.0`) stale clipped text exempted as a touch target (`scripts/lib/live-font-scale-proof.mjs:401`, `:427`)**:
     - In `runScreenJourney`, on the return leg (`1.5 -> 1.0` on Android, or `extra-extra-extra-large -> accessibility-medium -> large` on iOS), `before` is the capture at the **scaled** font size (`1.5` or `1.786`), not the base scale `1.0`.
     - If a text node grew to `50pt` at `1.5` inside a fixed `38pt` centered row (`[0,194][100,244]` in `[0,200][200,238]`, clipped `6pt` top and `6pt` bottom) and stays **stale** at `50pt` on the return leg to `1.0` (while `cold` at `1.0` is `20pt`, `[0,209][100,229]`), `evaluateLiveFontChange` calls `clipping(settled, tolerance, before)` where `height(before) === 50 === bottom - top`.
     - `clipping()` treats the stale `50pt` clipped text as an unchanged centred touch target (`checks.clipping.pass === true`), turning an `'unexpected'` structural clipping failure into a waivable `'known-residual'` verdict!
- **Fix**:
  1. Require zero growth (`bottom - top === height(before)`) and require that `before` itself already had the same centred overhang over `before.parent` (`before.parent !== undefined`, `bpt - btop === pt - top`, `bbottom - bpb === bottom - pb`).
  2. In `evaluateLiveFontChange` (`lines 401, 427`), also pass `cold` (or `[coldBefore ?? before, cold]`) to `clipping` so a box is only exempt as a fixed touch target if it keeps that exact height and centred overhang in `cold` as well as `coldBefore ?? before` (a fixed 44pt icon button has the same 44pt box at every scale, whereas stale `50pt` text on a `1.5 -> 1.0` return leg is `20pt` in `cold`).

---

### [P3-1] `withModalMarker` in `EdgeToEdgeModal` only inspects a top-level single element, missing `accessibilityViewIsModal` inside wrapper views, fragments, or child arrays

- **File**: `apps/mobile/components/edge-to-edge-modal.tsx:89-105`
- **Code**:
  ```tsx
  function withModalMarker(children: React.ReactNode) {
    const marker = <LiveFontMountMarker key="live-font-mount-marker" scope="modal" />
    if (
      isValidElement<{
        accessibilityViewIsModal?: boolean
        children?: React.ReactNode
      }>(children) &&
      children.props.accessibilityViewIsModal
    )
      return cloneElement(children, undefined, marker, children.props.children)
    return (
      <>
        {marker}
        {children}
      </>
    )
  }
  ```
- **Failure Scenario**:
  - While `ShareCardComposer` (`apps/mobile/components/share-card-composer.tsx:861-878`), `CapsuleBuilderModal`, and `GarmentCaptureModal` pass `<View accessibilityViewIsModal>` as the direct single child of `<EdgeToEdgeModal>`, **6 of the 9 `EdgeToEdgeModal` callers in `apps/mobile` wrap `<View accessibilityViewIsModal>` inside an outer overlay/backdrop `<View>`** (or could pass a Fragment / array of children):
    - `apps/mobile/components/community/community-post-sheet.tsx:554-558` (`<View style={styles.overlay}><View accessibilityViewIsModal ...>`)
    - `apps/mobile/components/community/community-comments-sheet.tsx:419-426` (`<View style={styles.anchor}><View accessibilityViewIsModal ...>`)
    - `apps/mobile/components/community/community-report-modal.tsx:115-124` (`<View style={styles.overlay}><View accessibilityViewIsModal ...>`)
    - `apps/mobile/components/community/community-spotlight-detail.tsx:63-70` (`<View style={styles.backdrop}><View accessibilityViewIsModal ...>`)
    - `apps/mobile/components/wardrobe/garment-tagging-modal.tsx:299-303` (`<View style={styles.overlay}><View accessibilityViewIsModal={true} ...>`)
    - `apps/mobile/app/(tabs)/index.tsx:923-937` (`<View style={styles.modalOverlay}><View accessibilityViewIsModal ...>`)
  - Similarly, if `children` is a Fragment (`<>...</>`) or an array (`[<Pressable />, <View accessibilityViewIsModal>...]`), `isValidElement(children) && children.props.accessibilityViewIsModal` is `false`, so `withModalMarker` places `marker` as a sibling _outside_ the descendant `accessibilityViewIsModal` view, where iOS UIKit Accessibility hides it from VoiceOver and XCUITest.
- **Fix**:
  - Recursively walk `children` (handling arrays via `Children.toArray` / `Array.isArray`, Fragments, and wrapper `<View>` elements) to locate the first element with `props.accessibilityViewIsModal` and clone along that path to prepend `marker` inside it, falling back to `<>{marker}{children}</>` only when no element in `children` sets `accessibilityViewIsModal`.

REVIEW-615-MERGE-A-R2-DONE
