# Story 6.15 Re-Check Round 3 — Range `13873a7d..2561c69c`

- **Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615` (`feat/story-6-15-expo-sdk-58`)
- **Range**: `13873a7d..2561c69c` (`052104c1`, `2561c69c`)
- **Verdict**: **PASS (0 P1, 0 P2; P2-1 and P3-1 from R2 Closed; 1 Pre-existing P3 VoiceOver Note on `capsule-builder-modal.tsx`)**

---

## Closure & Mutant Verification

1. **R2 P2-1 (`052104c1`: `scripts/lib/live-font-scale-proof.mjs:205-249`, `:424`, `:450`; `scripts/lib/live-font-journey.mjs:210`) — CLOSED (PASS)**:
   - `unchangedCentredTarget(node, base, tolerance)` requires `base?.parent !== undefined`, `now.above > tolerance`, `now.above === now.below`, `now.height === then.height`, `now.above === then.above`, and `now.below === then.below` against `coldBase` (`cold[base].reference`).
   - Verified with 3 mutants in a detached `/tmp` worktree (`871/871` baseline tests passing):
     - **Mutant 1** (restoring `Math.abs(now.height - then.height) <= tolerance` without overhang equality): caught by `growth within the height tolerance still ends the exemption (P2-1 re-check)` in `scripts/lib/live-font-scale-proof.test.mjs:197-208`.
     - **Mutant 2** (comparing against `before` instead of `coldBase` in `evaluateLiveFontChange`): caught by `stale text on a return leg is judged against the cold base launch (P2-1 re-check)` in `scripts/lib/live-font-scale-proof.test.mjs:210-230`.
     - **Mutant 3** (omitting `coldBase: cold[base].reference` in `runScreenJourney`): caught by `scripts/lib/live-font-journey.test.mjs:50-55` (`header-info-modal` 44pt button centred over a 38pt row).
   - **Check — Can `coldBase` be missing or from another build so the exemption silently disappears or silently applies?**
     - **Missing `coldBase` fails closed**: When `reference` (`coldBase`) is `undefined`, `referenceNodes` is an empty `Map`, `unchangedCentredTarget` sees `base?.parent === undefined` and returns `false` (`scripts/lib/live-font-scale-proof.test.mjs:176-178`), so no overflowing box is ever exempted without `coldBase`. In `runScreenJourney` (`scripts/lib/live-font-journey.mjs:166-173`, `:210`), `cold[base].reference` is always captured before any live leg runs and passed to every leg.
     - **`coldBase` cannot come from another build or device**: In `scripts/run-live-font-proof.mjs:592-605`, `screenRunSteps` runs `'read-version'` before `runScreenJourney`, locking `reactNativeVersion`. Every hierarchy read in `io.cold(base)` runs through `assertHierarchySource(tree, { platform, fingerprint, reactNativeVersion })`, which fails closed on another simulator (`live_font_hierarchy_wrong_device`) or another/unmarked build (`live_font_hierarchy_wrong_build`).

2. **R2 P3-1 (`2561c69c`: `apps/mobile/components/edge-to-edge-modal.tsx:89-159`) — CLOSED (PASS)**:
   - `placeMarker` recursively walks arrays, Fragments, and wrapper `<View>` elements (skipping only `undefined` or render-function children) to prepend `<LiveFontMountMarker key="live-font-mount-marker" scope="modal" />` inside the first element with `props.accessibilityViewIsModal`, tagging it with `dataSet: { ...node.props.dataSet, liveFontModalHost: 'true' }`.
   - Every one of the 9 `EdgeToEdgeModal` callers in `apps/mobile` (`share-card-composer.marker.test.tsx`, `community-post-sheet.test.tsx`, `community-comments-sheet.test.tsx`, `community-report-modal.test.tsx`, `community-spotlight-detail.test.tsx`, `garment-capture-modal.test.tsx`, `garment-tagging-modal.test.tsx`, `hero-cache-recovery.test.tsx`, and `capsule-builder-modal.test.tsx`) plus `edge-to-edge-modal.test.tsx` (wrapper, fragment, array shapes) asserts placement.
   - **Check — Does the recursive walk ever clone or reorder production children?**
     - **No — production output is reference- and byte-identical**: `withModalMarker(children)` (`apps/mobile/components/edge-to-edge-modal.tsx:144-146`) returns `children` on its first line (`if (!liveFontMountMarkersEnabled()) return children`). When `__DEV__ === false` and `Constants.expoConfig?.extra?.liveFontMountMarkers !== true`, `placeMarker` is never called, no marker or Fragment is created, no element is cloned, and no `dataSet` prop is added.

---

## Pre-Existing Finding (Non-Blocking for Story 6.15)

### [P3-1] `MobileCapsuleBuilderModal` sets `accessibilityViewIsModal` on `<EdgeToEdgeModal>` (`<Modal>`), where React Native drops it, instead of on its sheet `<View>`

- **File**: `apps/mobile/components/wardrobe/capsule-builder-modal.tsx:263-274`
- **Code**:
  ```tsx
  <EdgeToEdgeModal
    visible={visible}
    animationType="slide"
    onRequestClose={onClose}
    accessibilityViewIsModal
    scrim="rgba(0,0,0,0.5)"
  >
    <View style={styles.overlay}>
      <View
        style={[styles.modalContainer, { paddingBottom: 16 + insets.bottom }]}
        testID="mobile-capsule-builder-container"
      >
  ```
- **Failure Scenario**:
  - `ModalProps` in React Native spreads `...ViewProps` in its type definition (`node_modules/react-native/Libraries/Modal/Modal.js:179`), so passing `accessibilityViewIsModal` to `<EdgeToEdgeModal>` type-checks cleanly.
  - At runtime, however, `Modal.render()` (`node_modules/react-native/Libraries/Modal/Modal.js:326-347`) forwards only an explicit list of modal props to `<RCTModalHostView>` and silently drops `accessibilityViewIsModal`.
  - Because `<EdgeToEdgeModal>` defaults to `transparent={true}` (`presentationStyle = 'overFullScreen'` on iOS, `Modal.js:303-305`), UIKit keeps the presenting view controller's views in the window hierarchy underneath the scrim and does **not** hide the underlying Wardrobe screen from VoiceOver unless a view inside the modal sets `accessibilityViewIsModal = YES`.
- **Fix**:
  - Move `accessibilityViewIsModal` from `<EdgeToEdgeModal>` (`apps/mobile/components/wardrobe/capsule-builder-modal.tsx:267`) onto `<View style={[styles.modalContainer, ...]} testID="mobile-capsule-builder-container">` (`line 271-274`), matching the other 8 `EdgeToEdgeModal` callers, and update `apps/mobile/components/wardrobe/capsule-builder-modal.test.tsx:636-643` to assert `liveFontMarkerPlacement().markerInside === true`.

REVIEW-615-MERGE-A-R3-DONE
