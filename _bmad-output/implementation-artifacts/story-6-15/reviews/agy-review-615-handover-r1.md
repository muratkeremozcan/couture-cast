# Story 6.15 Handover Review R1

- **Branch / Range**: `feat/story-6-15-expo-sdk-58` (`2561c69c..1bb80e6b`, skipping `886e88ad` and `1bb80e6b`; reviewing `66de9e80`, `5c4ddbcc`, `a4505d81`, `b3bfd15e`, and `--remerge-diff 3d6bd7a8`)
- **Mode**: Read-only review; worktree untouched.

## Findings

### P2 — Dropped screen/modal mount marker in `sameMounts` can hide a real remount

- **Location**: `scripts/lib/live-font-scale-proof.mjs:294-310` (and caller `scripts/lib/live-font-journey.mjs:196-247`)
- **Details**: `sameMounts(mounts)` checks that each scope appearing in at least one capture has a single distinct id across the captures that happen to report it, while `rootKnown` only requires `'root'` in every stage (`mounts.every((scopes) => scopes?.has('root'))`).
- **Concrete failure scenario**:
  1. **Within a single leg**: `before` captures `live-font-mount-root-r1,live-font-mount-settings-s1` (or `modal-m1` for the composer). During the font-scale transition, the Settings screen (or modal) unmounts and remounts as `s2` while `<LiveFontMountMarker scope="root" />` in `apps/mobile/app/_layout.tsx:235` stays mounted as `r1`. Because the remounted screen renders fresh at the new scale, `coldParity` and `growth` pass. If XCUITest drops the 1x1 `settings-s2` marker from `immediate`, `settled`, and `updated` (or drops `s1` from `before` while `settled` reports `s2`), `ids.get('settings')` has size `1`, so `sameMounts` returns `true`, `identity.rootKept` is `true`, and `evaluateLiveFontChange` returns `verdict: 'fixed'`. Similarly, if the screen marker is absent in every capture of the leg, `rootKnown` and `rootKept` are both `true` with no screen-level mount evidence.
  2. **Across legs in `runScreenJourney`**: `identityCheck` only inspects `[before, immediate, settled, updated]` of one leg (`scripts/lib/live-font-scale-proof.mjs:440-445`). If Leg 1 `before` sees `settings-s1`, Leg 1 `settled`/`updated` drop `settings` while the screen remounts to `s2` (or remounts during `io.revert()`), Leg 1 sees `{s1}` (passes) and Leg 2 sees `{s2}` across all of its captures (passes); `s1` and `s2` are never compared across legs.

### P2 — `mountsOf` overwrites duplicate markers in the same scope

- **Location**: `scripts/lib/live-font-scale-proof.mjs:278-287`
- **Details**: `mountsOf` inserts parsed markers into a `Map` keyed by `scope` (`scopes.set(match[1], match[2])`), and `flattenHierarchy` (`scripts/lib/live-font-capture.mjs:103`) sorts `markers` lexicographically before joining them with `','`. Any second marker in the same scope overwrites the earlier id.
- **Concrete failure scenario**: If `before` has `live-font-mount-root-r1,live-font-mount-modal-m2` and `settled` has two coexisting markers in that scope (e.g. a leaked/old modal alongside a newly mounted one: `live-font-mount-root-r1,live-font-mount-modal-m1,live-font-mount-modal-m2`), `mountsOf` overwrites `'m1'` with `'m2'`, producing `{ root => 'r1', modal => 'm2' }` for both stages and reporting `identity.rootKept: true` and `verdict: 'fixed'`. (Likewise, non-marker entries in `else scopes.set('root', item)` overwrite `'root'`.)

### P3 — Skipped middle iOS duplicate with `id: ''` shadows non-empty ancestor `id` during `walk`

- **Location**: `scripts/lib/live-font-capture.mjs:84-86`
- **Details**: When `repeatsParent(entry, parentEntry)` is true for an intermediate node whose `id === ''` under an ancestor `parentEntry` with a non-empty `id`, `record` skips pushing `entry`, but `walk` still passes `entry ?? parentEntry` (the skipped `id: ''` entry) to descendants. A grandchild with the same text, bounds, and the ancestor's non-empty `id` will fail `entry.id === '' || entry.id === parentEntry.id` and be emitted as an extra node instead of deduplicating against the ancestor. (Cannot hide stale text, as it only risks an un-deduplicated repeat.)

---

## Focus Questions

1. **Does any test change replace or loosen an assertion?**
   - `66de9e80` (`apps/mobile/components/wardrobe/capsule-builder-modal.test.tsx:635-641`): Replaces the old check (`[data-testid^="live-font-mount-modal-"]` non-null + `liveFontMarkerPlacement()` returning `{ markerInside: false, host: null }`) with `expect(liveFontMarkerPlacement()).toEqual({ markerInside: true, host: 'mobile-capsule-builder-container' })`. Since `liveFontMarkerPlacement()` (`apps/mobile/src/test-utils/edge-to-edge-modal.tsx:55-65`) only returns `markerInside: true` when the modal marker exists and is nested inside the `[data-live-font-modal-host="true"]` container, the assertion is strictly tighter.
   - `a4505d81` (`scripts/lib/live-font-scale-proof.test.mjs:337-354`) and `b3bfd15e` (`scripts/lib/live-font-capture.test.mjs:663-685`): Additive tests only; no existing assertions were replaced or loosened.
   - `3d6bd7a8` (`scripts/ci/node-test-gate.test.mjs:6-9,1672`): Cleanly keeps `main`'s `parse` import and updates line 1672 from `parseYaml(...)` to `parse(...)` (matching line 1424).

2. **Can a dropped screen marker or a duplicate static text now hide a real remount or a real stale text?**
   - **Dropped screen marker (`a4505d81`)**: Yes — see the two P2 findings above.
   - **Duplicate static text (`b3bfd15e`)**: No for stale text. `repeatsParent` (`scripts/lib/live-font-capture.mjs:19-27`) only skips an iOS descendant when `entry.text === parentEntry.text && entry.bounds === parentEntry.bounds && (entry.id === '' || entry.id === parentEntry.id)`. If one copy keeps a stale height while the other grows, `entry.bounds !== parentEntry.bounds`, so both stay in `nodes` (failing `fullText` and/or `coldParity`); if both stay stale, the retained `parentEntry` preserves the stale height and fails `coldParity`.

3. **Does the modal move (`66de9e80`) keep VoiceOver containment on every sheet state?**
   - **Yes** (by code inspection and jsdom/vitest; native iOS VoiceOver/XCUITest was not run). In `apps/mobile/components/wardrobe/capsule-builder-modal.tsx:263-507`, `<EdgeToEdgeModal>` renders `<View style={styles.overlay}><View testID="mobile-capsule-builder-container" accessibilityViewIsModal>...</View></View>`, and all conditional sheet states (error box, repair banner, garment list, reorder section, favorite toggle, submitting state, create/edit modes) render inside `mobile-capsule-builder-container`, matching the other eight `accessibilityViewIsModal` sheets/modals in `apps/mobile`.

4. **Spec D6 amendment (`5c4ddbcc`)**:
   - `_bmad-output/implementation-artifacts/spec-6-15-expo-sdk58-live-font-scale-layout.md` consistently records the owner's 2026-11-13 rule (no macOS runner jobs on PRs; nightly/dispatch `ios-native.yml` plus recorded local iOS run on head SHA for pre-merge evidence; `pr-job-p95.mjs` covers Linux PR jobs).

---

## Codex Security Diff Scan

- **Workflow**: Executed `~/.codex/skills/codex-security-review/SKILL.md` -> `security-diff-scan` terminal/chat workflow (`config_preflight.py` returned `status: "ready"`, with `goal_tools_available=false` suggest-level note).
- **Result**: No runtime security vulnerabilities (authz bypass, injection, SSRF, path traversal, ReDoS, or secret/token exposure) found in `66de9e80`, `5c4ddbcc`, `a4505d81`, `b3bfd15e`, or `3d6bd7a8`. Verification-gate integrity weaknesses in `a4505d81` are captured in the P2 findings above.

## Checks Run

- `node --test scripts/lib/live-font-*.test.mjs scripts/ci/node-test-gate.test.mjs`: **152/152 passed** (23 suites, 0 failed, 0 skipped).
- `npm --prefix apps/mobile run vitest:run -- components/wardrobe/capsule-builder-modal.test.tsx components/edge-to-edge-modal.test.tsx`: **41/41 passed** (`capsule-builder-modal.test.tsx` 30 tests, `edge-to-edge-modal.test.tsx` 11 tests).
- `node --input-type=module -e ...` repro against `scripts/lib/live-font-scale-proof.mjs`: confirmed both P2 remount/duplicate-scope scenarios return `verdict: 'fixed'` and `checks.identity.rootKept: true`.

REVIEW-615-HANDOVER-R1-DONE
