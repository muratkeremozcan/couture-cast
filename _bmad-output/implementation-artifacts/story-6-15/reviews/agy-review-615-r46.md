# Review Report — `tea615` Round 46 (`f57ec60b..231c323c`)

Target commit: `231c323c` (28 non-report files changed; report-only commits `a4c2ea25`, `0abc24e7`, `c8a32bed` skipped).
Shared tree `/Users/murat/opensource/cc/couture-cast-wt-615` kept strictly READ-ONLY; mutants and native/Node checks outside `tsc` ran in `/tmp/wt-615-mutant-r46` (since removed and pruned).

---

## Findings

### [P1] `pairElements` falls back to `sameFrame` across mismatched `accessibilityIdentifier`s

- **Location**: `scripts/lib/live-font-text-probe.mjs:897-906`
- **Failure scenario**: When an unmatched node (`id: "btn-save"`, `text: "Save"`) fails `named` matching against an element at the same coordinates whose `identifier` explicitly differs (`identifier: "btn-cancel"`, `label: "Save"`), line `905` falls back to `eligible.filter(({ element }) => sameFrame(element.rect, node.box))` without requiring `element.identifier === ''`. Another widget's element at matching bounds stands in for the lost node.
- **Probe evidence (`PROBE_F3A_MISMATCH_ID_SAMEFRAME`)**: Node `{ id: "btn-save", text: "Save", box }` paired with `{ identifier: "btn-cancel", label: "Save", rect: box }` returned `{"code":null,"elements":[{"node":0,"element":0,"label":"Save"}]}`.

### [P1] Full-window `behindModal` backdrop masks clipped background text and precedes `invisible`/`offWindow`

- **Location**: `scripts/lib/live-font-text-probe.mjs:672-685`
- **Failure scenario**: `classifyRecords` checks `record.behindModal && contains(record.behindModal.rect, recordRect(record), tolerance)` (`lines 675-679`) before `opacity === 0` (`invisible`, `line 682`) and `offWindow` (`line 684`). If an `accessibilityViewIsModal` container fills the screen (`[0, 0, 390, 844]`, such as React Native's transparent `<Modal>` backdrop overlay), background clipped text inside that rect is classified `modalCovered` and excluded from clipping judgments even though visually unoccluded.
- **Probe evidence (`PROBE_F3D_MODAL_HIDES_BG_CLIP`)**: Clipped background record under `behindModal: { rect: [0, 0, 390, 844] }` produced `{"modalCovered":[1],"clipping":{"pass":true,"clipped":[]}}`.

### [P1] `volatileProof` does not verify `manifest.sha` against `HEAD`, bind capture files, or validate `capture.platform` / `capture.stage` / non-null `manifest.inputs`

- **Location**: `scripts/lib/live-font-volatile-proof.mjs:91-116`, `scripts/lib/evidence-manifest.mjs:385-410`
- **Failure scenario**:
  1. `run-live-font-proof.mjs` invokes `changedInputs(manifest, { requireClean: false })`. `readRun` validates `SHA.test(String(manifest.sha))` and `changed(manifest).length === 0`, but neither checks that `manifest.sha` exists / equals `HEAD` nor includes committed captures in `manifest.inputs`. Two runs built from an unrelated bogus SHA (`0...0`) with `HEAD`'s `inputs` map pass cleanly.
  2. `readRun` passes `captureVolatileKeys(capture, platform)` without verifying `capture.platform === platform` or `capture.stage === stage`, allowing cross-platform captures (`ios` run + `android` run) to prove determinism for `android`.
  3. Passing `manifest.inputs: null` crashes inside `changedInputs` (`Object.keys(manifest.inputs)`).
- **Probe evidence**:
  - `PROBE_F5_FORGED_SHA_PASS`: `{ leg: "live-font", sha: "0".repeat(40), inputs: realManifest.inputs }` yielded `fakeChangedCount: 0`, and `createVolatileProofCheck({ platform: "android" })` returned `res: null` (PASS) across `capA` (`platform: "ios"`) and `capB` (`platform: "android"`).
  - `PROBE_F5_NULL_INPUTS_CRASH`: `TypeError: Cannot convert undefined or null to object`.

### [P2] Loosened guard in `font-scale-reads.test.mjs` admits app-wide text rescaling and unused banned APIs

- **Location**: `scripts/ci/font-scale-reads.test.mjs:37-57, 76-84`
- **Failure scenario**:
  1. `enclosingNames` sets `current` only on top-level `^(?:export\s+)?(?:default\s+)?(?:function|const)\s+([A-Za-z0-9_]+)` (`lines 79-82`) and retains it across all subsequent lines until the next matching declaration. `TabLayout` wraps `<Tabs>` in `app/(tabs)/_layout.tsx`, and `useGlyphBox` is the last `const`/`function` in `components/glyph-box.ts`. Any `<Text style={{ fontSize: 16 * fontScale }}>` or context provider inside `TabLayout`, or a trailing `class` wrapper after `useGlyphBox`, passes `fontScaleReads()`.
  2. `BANNED_ALLOWED` (`lines 54-57`) permits `getFontScale`, `maxFontSizeMultiplier`, and `allowFontScaling` across all three functions of `components/glyph-box.ts` (`glyphScale`, `glyphBoxSide`, `useGlyphBox`) — none of which call `getFontScale` or pass `<Text maxFontSizeMultiplier>` — and allows all three banned identifiers (plus Android/Web `allowFontScaling={false}`) anywhere inside `TabBarLabel`, whereas `TabBarLabel` only needs `allowFontScaling` on iOS (`tab-bar-label.tsx:147`).
- **Probe evidence**:
  - `PROBE_F1A_TABLAYOUT_BYPASS: []` (`<Text style={{ fontSize: 16 * fontScale }}>` inside `TabLayout`).
  - `PROBE_F1B_GLYPH_TRAILING_BYPASS: []` (`class GlobalTextScaler` trailing `useGlyphBox`).

### [P2] Downward-leg flex squeeze still triggers false `staleContent` in `faces`

- **Location**: `scripts/lib/live-font-scale-proof.mjs:759-774`
- **Failure scenario**: Adding `record.lineCount === source.lineCount` (`line 764`) and `(!sideCut || near(rectWidth(record.contentRect), rectWidth(source.contentRect), tolerance))` (`lines 765-766`) fixed the r45 horizontal+vertical false positive (`sideCut`). However, on a downward leg (`2.0 -> 1.0`), a wrapped flex-squeezed control that stays at `lineCount === 2` (matching `start`/`before` at a different content height than `target`) with `sideCut: false` still satisfies `keptFrom` and fails as `staleContent`.
- **Probe evidence (`PROBE_F2C_SQUEEZE_STALE_CONTENT`)**: Downward flex squeeze (`2.0 -> 1.0`) classified as `face: "staleContent"`, `staleContentFrom: "startCold"`.

### [P2] iOS partial group remnant (`"*"`) absorbs an interactive node before `pairElements` checks it

- **Location**: `scripts/lib/live-font-text-probe.mjs:813-861, 1039-1058`
- **Failure scenario**: When an iOS `accessibilityAncestor` container (`id: "btn-submit"`, `text: "Submit"`) drops its primary `<Text>Submit</Text>` at large font scale while keeping an auxiliary glyph `<Text>*</Text>`, `resolveLeftovers` places `"*"` into `"btn-submit"` (`via: "group"`), removing the node from `open` before `pairElements` inspects `elements` and `hasText`. The capture passes with `code: null`.
- **Probe evidence (`PROBE_F3B_MATCH_FIXED`)**: Node `{ id: "btn-submit", text: "Submit" }` with only `"*"` inside returned `{"pass":true,"code":null,"pairs":[{"node":0,"record":0,"via":"group"}],"groups":[{"node":0,"records":[0]}],"unmatchedNodes":[]}`.

### [P2] `TabBarLabel` keeps a stale `settled` ref across live prop/scale changes and `beside-icon` omits `flexShrink: 1` and dynamic `lineHeight`

- **Location**: `apps/mobile/components/tab-bar-label.tsx:120-161, 173`; `apps/mobile/app/(tabs)/_layout.tsx:48`
- **Failure scenario**:
  1. `TabBarLabel` resets `fit` cleanly when `key = "${children}|${fontScale}|${position}"` changes (`lines 120-122`), but `settled = useRef(Platform.OS === 'web')` (`line 125`) is never reset on `key` change. While mounted across a live scale/position update, a stale `settled.current === true` allows `onLayout` (`line 133`) to report an unsettled wrapped height via `onHeight` before `onTextLayout` (`line 140`) runs.
  2. In `beside-icon` mode (`BottomTabItem` `tabHorizontalUiKit` uses `flexDirection: 'row'`), `TabBarLabel`'s `<Text>` lacks `flexShrink: 1` (to constrain row width for wrapping) and hardcodes `styles.beside.lineHeight: 24` (`line 173`) even if font size shrinks toward `0.5 * 13 = 6.5`; `TabBarIcon` (`_layout.tsx:48`) still computes `bottom: INDICATOR_BOTTOM - growth` tailored to below-icon geometry.

---

## Focus Verdicts (1)–(6)

1. **Loosened guard (`scripts/ci/font-scale-reads.test.mjs`)**: Incomplete containment — see P2 above (`TabLayout` / trailing `class` bypasses and overly broad `BANNED_ALLOWED`). Only `useGlyphBox` in `glyph-box.ts` needs `fontScale`, and `TabBarLabel` only needs `allowFontScaling` for iOS.
2. **r45 re-verification**:
   - **Fixed & killed by mutants**: iOS nested inverted scroll (`M2`), Android scaled untranslated `shiftY` (`M11`), iOS `offWindow` layout overflow (`M13`), Android scaled/flipped `Reading.content` (`M14`), `faces` line-count & side-cut width check (`M18`, except downward-leg squeeze), and `volatileProof` capture hash uniqueness (`M17`).
   - **Remaining gaps**: `volatileProof` `manifest.sha` / platform checks (P1) and downward-leg `faces` flex-squeeze `staleContent` (P2).
3. **Accessibility elements & `behindModal`**: Element `hasText` check (`M15`) and `modalCovered` containment (`M16`) work and kill their mutants, but leave three holes: mismatched `identifier` fallback via `sameFrame` (P1), full-screen transparent backdrop `modalCovered` masking `clipping` / `invisible` / `offWindow` (P1), and iOS partial group remnant hiding dropped button label (P2).
4. **`TabBarLabel` (`5c456f00`)**: Replacing `adjustsFontSizeToFit`/`minimumFontScale` with JS `onTextLayout` avoids the Fabric Android `minimumFontScale` drop, enforces `TAB_LABEL_MIN_SCALE = 0.5`, drops `numberOfLines: 1` (unlike React Navigation's `Label.js`) so labels wrap instead of clipping, and tracks per-scale heights. Gaps remain in `settled.current` across live key changes and `beside-icon` row shrinking/`lineHeight` (P2).
5. **`volatileProof` (`185fd2de`, `5177518d`)**: Reading via `spawnSync('git', ['show', 'HEAD:<dir>/<capture>.json'])` avoids shell injection and verifies capture hashes and distinct launches, while trusting forged `manifest.sha`, ignoring unhashed captures/`platform`/`stage`, and crashing on `inputs: null` (P1). `pr-text-layout-probe.yml` preserves zero-skip/zero-fail JUnit checks (`>= 69` and `>= 23`).
6. **`tsc` by error code**:
   - `apps/mobile/tsconfig.json`: **0 errors** (`MOBILE_TSC_RC=0`).
   - `packages/api-client/tsconfig.json`: **0 errors** (`API_CLIENT_TSC_RC=0`).

---

## Mutation Testing Summary (`/tmp/wt-615-mutant-r46` at `231c323c`)

| Mutant | File & Mutation                                                                  | Result              | Failing Test(s)                                                                                        |
| ------ | -------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| `M2`   | `TextLayoutProbeWire.swift:367` single-ancestor `ancestor.transform.a`           | **KILLED** (`rc=1`) | `testAFlipOnAnOuterHolderInvertsAHorizontalScrollViewAndAFlipInsideItDoesNot` (5 assertions)           |
| `M11`  | `TextLayoutSnapshot.kt:552` unscaled `translationY`                              | **KILLED** (`rc=1`) | `aTranslationOnAnIntermediateLevelIsUndoneAsTheScaledLevelOutsideItMapsIt`                             |
| `M13`  | `TextLayoutProbeWire.swift:310` drop `untranslatedClip == untranslatedRect`      | **KILLED** (`rc=1`) | 3 `testR45A...OffWindow...` tests                                                                      |
| `M14`  | `TextLayoutSnapshot.kt:326` unscaled `Reading.content`                           | **KILLED** (`rc=1`) | `r45AScaledParentScalesTheTextsLinesWithItsBox`, `r45AFlippedParentPutsTheTextsTopPaddingBelowItsLine` |
| `M15`  | `live-font-text-probe.mjs:895` drop `(!element.hasText \|\| holdsText(element))` | **KILLED** (`rc=1`) | `live-font-text-probe.test.mjs` (63/64 pass, 1 fail)                                                   |
| `M16`  | `live-font-text-probe.mjs:676` drop `contains(behindModal.rect, ...)`            | **KILLED** (`rc=1`) | `live-font-text-probe.test.mjs` (63/64 pass, 1 fail)                                                   |
| `M17`  | `live-font-volatile-proof.mjs:146` disable `hashes` uniqueness check             | **KILLED** (`rc=1`) | `live-font-scale-proof.test.mjs` (124/125 pass, 1 fail via `volatileProof runs share a launch`)        |
| `M18`  | `live-font-scale-proof.mjs:764` drop `record.lineCount === source.lineCount`     | **KILLED** (`rc=1`) | `live-font-scale-proof.test.mjs` (123/125 pass, 2 fail)                                                |

All **8/8 mutants KILLED**, **0 survived**.

---

## Verification Matrix

- **TypeScript (`tsc --noEmit`)** on `/Users/murat/opensource/cc/couture-cast-wt-615`:
  - `npx tsc -p apps/mobile/tsconfig.json --noEmit`: `rc=0` (0 errors)
  - `npx tsc -p packages/api-client/tsconfig.json --noEmit`: `rc=0` (0 errors)
- **Node suites** on `/Users/murat/opensource/cc/couture-cast-wt-615` (`font-scale-reads`, `live-font-{capture,pages,text-probe,scale-proof,journey}`, `text-layout-probe-mode`, `story68-{native-build-env,release-live-font-command}`):
  - **328 tests, 47 suites, 328 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo** (`1053.61ms`).
- **iOS Swift (`swift test`)** on `231c323c` (`/tmp/wt-615-mutant-r46`):
  - **72 XCTest cases passed, 0 failures**.
- **Android Robolectric + CI JUnit gate** on `231c323c` (`/tmp/wt-615-mutant-r46`, Gradle 8.14.3 + `ANDROID_HOME`):
  - `TextLayoutSnapshotTest` (`>= 69`), `TextLayoutProbeWireTest` (`>= 23`): **BUILD SUCCESSFUL**, `junit-report-check.mjs` passed with 0 skipped/failed/errored.
- **Playwright / DB / `prisma generate`**: Not run per constraints.
- **Security Scan (`codex-security-review`)**: Complete diff scan across all 28 changed files recorded in `/private/tmp/codex-security-scans/couture-cast-wt-615/231c323c_r46/report.md` (`FINALIZE_RC=0`, **0 security findings**; Android `TextLayoutProbeReceiver` requires `Manifest.permission.DUMP` + valid token + API >= 29; `committedReader` invokes `git show` with argument array + path/capture regex gates).

REVIEW-615-R46-DONE
