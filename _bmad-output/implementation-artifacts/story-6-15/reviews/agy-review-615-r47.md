# Review Report — `tea615` Round 47 (`231c323c..23314978`)

Target commit: `23314978` (16 non-report files changed; report-only commit `bd298fd7` skipped).
Shared tree `/Users/murat/opensource/cc/couture-cast-wt-615` kept strictly READ-ONLY (`git status -s` clean); mutants and Swift/Node runs used `/tmp/wt-615-mutant-r47` (removed and pruned).

---

## Findings

### [P1] `font-scale-reads.test.mjs` still bypassed by same-line multi-use `BANNED`, multi-declarator `const`, and nested functions

- **Location**: `scripts/ci/font-scale-reads.test.mjs:37, 90-135`
- **Failure scenario**:
  1. `BANNED` (`line 37`) is non-global; `BANNED.exec(line)?.[1]` (`line 126`) checks only the first banned identifier on a line and skips the `else if (FONT_SCALE.test(line))` branch. Inside `TabBarLabel`, adding `maxFontSizeMultiplier={1}` (or `fontScale`) on the line with `allowFontScaling={Platform.OS === 'ios' ? false : undefined}` passes. Inside `glyphScale`, `maxFontSizeMultiplier && <Text allowFontScaling={false} />` passes against `/./`.
  2. `enclosingNames` (`lines 90-117`) takes only `statement.declarationList.declarations[0]` (`lines 108-109`) and assigns that name to lines `first..last` of the statement. A multi-declarator `const` (`export const glyphBoxSide = () => 1, EvilScaler = ...`) or a nested helper/component (`function AppText` declared inside `TabBarLabel` or `ComposerFeedback`) inherits the outer allowance across all lines of its body.
  3. `SOURCE_DIRECTORIES = ['app', 'src', 'components']` (`line 36`) omits sibling source directories in `apps/mobile` (e.g., `constants/`, `index.ts`).
- **Probe evidence**:
  - `R47_F1_DOUBLE_BANNED_ON_LINE: []`
  - `R47_F1_GLYPH_SAME_LINE_ALLOW: []`
  - `R47_F1_MULTI_DECL_CONST: []`
  - `R47_F1_NESTED_IN_ALLOWED: []`

### [P2] iOS `modalOpaque` returns `true` for a rounded clipping modal or ancestor enclosing an opaque square child

- **Location**: `apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeSnapshot.swift:42-49`, `apps/mobile/modules/text-layout-probe/ios/TextLayoutProbeWire.swift:56-89`
- **Failure scenario**: `Paint` checks `layer.cornerRadius <= 0` only on `fills`, while `modalOpaque`'s `passes` check (`found.shown && (!found.clips || covers(found.rect))`) does not propagate corner rounding on clipping views. A rounded sheet (`clipsToBounds = true, cornerRadius > 0, backgroundColor = nil`) wrapping an opaque square subview (`cornerRadius = 0, rect = modal.rect`) leaves the corner cutouts transparent while `modalOpaque` reports `true`. (Shaped sublayers, `CAGradientLayer`, and `UIVisualEffectView` blur leave `layer.backgroundColor` nil and fail safe with `fills = false` -> `opaque = false`; partial/safe-area inset children fail `covers(found.rect)` -> `opaque = false`.)
- **Probe evidence (`R47_F3_ROUNDED_CLIP_OPAQUE`)**: `opaque(view(screen, clips: true, [view(screen, background: 1)]))` returned `true`.

### [P2] `volatileProof` accepts captures omitting `pid` (`undefined` vs `null`) and does not pin `fontScale` per cold stage

- **Location**: `scripts/lib/live-font-volatile-proof.mjs:45-53, 222-231`
- **Failure scenario**:
  1. `readRunUnsafe` computes launch identity as `` `${capture.pid}|${capture.identity?.root ?? ''}` `` (`line 229`) without validating that `capture.pid` exists. Two committed captures lacking `pid` (`undefined` in one, `null` in the other) produce `"undefined|"` vs `"null|"` and pass the distinct-launch check.
  2. `CAPTURE_STAGE` maps `coldBefore`, `cold`, `coldBeforeUpdated`, and `coldUpdated` all to `'cold'` without checking `capture.fontScale` matches the target scale of each leg stage.
- **Probe evidence**: `R47_F4_MISSING_PID_BYPASS: null` (passed with `pid: undefined` and `pid: null`).

### [P2] `TabBarLabel` `lineBox` wrapper lacks `flexShrink: 1` for `beside-icon`, and `layoutHeight.current` stays stale across `key` changes

- **Location**: `apps/mobile/components/tab-bar-label.tsx:161-175, 190-195, 231-235`
- **Failure scenario**:
  1. `176465ec` put `flexShrink: 1` on `styles.beside` on `<Text>` (`line 234`), while `d747d141` wrapped `<Text>` in `<View style={styles.lineBox}>` (`line 190`, `justifyContent: 'flex-end'`, no `flexShrink: 1`). Inside React Navigation's `tabHorizontalUiKit` (`flexDirection: 'row'`), a flex child `<View>` defaults to `flexShrink: 0`, preventing `lineBox` from shrinking to constrain and wrap `<Text>` on narrow tablet/iPad tabs; `justifyContent: 'flex-end'` with `minHeight: lineBoxHeight` also bottom-aligns shorter beside-icon labels rather than centering them beside the icon.
  2. When `settledKey.current !== key` (`lines 163-166`), `settled.current` resets to `false` (native), but `layoutHeight.current` (`line 167`) is not cleared to `null`. If `onTextLayout` settles before `onLayout` fires for the new `key`, `report()` passes the prior key's `layoutHeight.current`.

### [P2] iOS composite `accessibilityLabel` group still masks a dropped child `<Text>` in `hiddenText`

- **Location**: `scripts/lib/live-font-scale-proof.mjs:1168-1253`
- **Failure scenario**: The exact-label `Submit` case (`PROBE_F3B`) is now caught by `groups` in `hiddenText`. However, if an iOS container has a composite `accessibilityLabel` (e.g., `"Submit, required"`) wrapping `<Text>Submit</Text>` + `<Text>*</Text>`, `cold` records `keys` in `textPresence` under `"Submit"`, while when `"Submit"` disappears live, `resolveLeftovers` pairs `"*"` into `"Submit, required"` (`pass: true`) and `pageCounts` increments `groups` under `"Submit, required"` instead of `"Submit"`, so `hiddenText` sees `now.get("Submit") === undefined` and skips the alert.
- **Probe evidence (`R47_F3B_COMPOSITE`)**: `{"coldGroups":[{"node":0,"records":[0,1]}],"settledGroups":[{"node":0,"records":[0]}],"settledPass":true}`.

---

## Focus Verdicts (1)–(7)

1. **r46 re-verification**:
   - `PROBE_F1A`, `PROBE_F1B`: fixed for top-level statements (`3e5427de`), though bypassable via multi-declarator `const`, nested functions, or multi-use banned lines (P1).
   - `PROBE_F3A` (`pairElements`): **fixed** — `R47_F3A_RETEST` returned `{"pass":false,"code":"live_font_text_probe_unmatched","elements":[]}`.
   - `PROBE_F3D` (`behindModal` opaque & ordering): **fixed** — `transparent` backdrops stay `behind` (not `modalCovered`), `invisible`/`offWindow` precede `modalCovered`, and `{ rect }` without `opaque` is rejected by `validateTextProbeAnswer` (`R47_F3D_CONTRACT`). Rounded-clip corner false positive remains (P2).
   - `PROBE_F5` (`volatileProof`): forged SHA, null inputs, and cross-platform (`ios` vs `android`) are now rejected cleanly via `commitAncestor`, git recomputation, `capture-hashes.json`, and `capture.textProbe.platform` (`M22`, `M23` killed); missing `pid` / unpinned cold `fontScale` remain (P2).
   - `PROBE_F2C` (`faces`): **fixed** — `rectWidth` check added regardless of `horizontalClip` (`M24` killed).
   - `PROBE_F3B` (Submit group): **fixed** for matching label (`groups` in `hiddenText`, `M25` killed); composite-label container still bypasses (P2).
2. **Guard parser (`scripts/ci/font-scale-reads.test.mjs`)**: TS AST replaces fragile regex scanning for top-level statement bounds, cleanly handling default named exports and rejecting unnamed defaults/classes; remaining bypasses are multi-use single-line `BANNED.exec`, comma-separated `VariableStatement`s, nested functions in allowed scopes, and unscanned sibling directories (P1).
3. **Opaque detection (`541732f4`)**: Correctly reads `CALayer` (`layer.backgroundColor`, `layer.opacity`, `layer.mask`, `layer.cornerRadius <= 0`) rather than UIView wrapper props, so shaped sublayers/gradients/blur/partial frames fail safe (`opaque: false`). Rounded clipping view enclosing an opaque child still yields `opaque: true` (P2).
4. **`volatileProof` (`23314978`)**: Verified real `HEAD~5` ancestor recomputation caught all 8 modified inputs (`diffFromSha5Count: 8` vs `diffFromHeadCount: 0`), pre-harness root commit rejected cleanly (`volatileProof run 0 is unreadable: evidence_manifest_entry_missing`), and `capture-hashes.json` binds captures by SHA-256 (`M23` killed). Note `.gitignore` ignores `_bmad-output/test-artifacts/story-*/**`, requiring explicit negation entries or tracked paths for `git show HEAD:` resolution.
5. **`TabBarLabel` & `useTabBarSizing`**: No state feedback loops (`nextTabLabelFit` monotonically hits `0.5` floor; `onLayout` measures `<Text>`, unaffected by `<View style.minHeight>`); `indicatorDrop` zeroes in `beside-icon`. Gaps remain in `lineBox` `flexShrink` for `beside-icon` and stale `layoutHeight.current` on `key` change (P2).
6. **Replaced Assertions Audit**:
   - `6.15-MOB-TAB-05` (`tab-bar-label.test.tsx:86-107`, `d747d141`): Moved `minHeight`/`justifyContent` check from `<Text>` to `lineBox` `<View>`, explicitly asserting `minHeight: undefined` & `textAlignVertical: undefined` on `<Text>` plus bounding bottom parity — **justified & tightened**.
   - `6.15-MOB-TAB-03` (`tab-bar-label.test.tsx:66`, `176465ec`): `onHeight` now asserts 3rd argument `'below-icon'` — **strengthened**.
   - `behindModal` JSON key test (`TextLayoutProbeRulesTests.swift:1204-1219`, `541732f4`): Now verifies both `opaque: false/true`, `"opaque", "rect"` key set, and literal JSON boolean — **strengthened**.
   - Rect-only `behindModal` contract (`live-font-text-probe.test.mjs:483-506`, `23314978`): Previously accepted `{ rect }` moved to rejected assertions while backwards-compatible non-opaque fallback is tested separately at lines `1095-1097` — **strengthened**.
7. **`tsc --noEmit` in `apps/mobile`**: `MOBILE_TSC_RC=0` (**0 errors**).

---

## Mutation Testing Summary (`/tmp/wt-615-mutant-r47` at `23314978`)

| Mutant | File & Mutation                                                           | Result              | Failing Test(s)                                                                                                                  |
| ------ | ------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `M19`  | `TextLayoutProbeWire.swift:82` ignore `found.clips` in `modalOpaque`      | **KILLED** (`rc=1`) | `testAHiddenOrFadedOpaqueChildIsNotOpaque`, `testAModalUnderAFadedOrClippingAncestorIsNotOpaque`                                 |
| `M20`  | `live-font-text-probe.mjs:914` drop `element.identifier === null`         | **KILLED** (`rc=1`) | `live-font-text-probe.test.mjs` (64/65 pass, 1 fail)                                                                             |
| `M21`  | `live-font-text-probe.mjs:687` drop `opaque === true` in `modalCovered`   | **KILLED** (`rc=1`) | `live-font-text-probe.test.mjs` (64/65 pass, 1 fail)                                                                             |
| `M22`  | `live-font-volatile-proof.mjs:164` disable `ancestor(manifest.sha)`       | **KILLED** (`rc=1`) | `live-font-scale-proof.test.mjs` (128/129 pass, 1 fail: `a forged sha` failed on `built at different heads` instead of ancestry) |
| `M23`  | `live-font-volatile-proof.mjs:218` disable `list.captures[name] !== hash` | **KILLED** (`rc=1`) | `live-font-scale-proof.test.mjs` (126/127 pass, 1 fail: `a capture that does not hash as listed`)                                |
| `M24`  | `live-font-scale-proof.mjs:756` drop `rectWidth` check in `faces`         | **KILLED** (`rc=1`) | `live-font-scale-proof.test.mjs` (124/127 pass, 3 fail)                                                                          |
| `M25`  | `live-font-scale-proof.mjs:1238` drop `shown?.groups` in `hiddenText`     | **KILLED** (`rc=1`) | `live-font-scale-proof.test.mjs` (126/127 pass, 1 fail)                                                                          |
| `M26`  | `scripts/ci/font-scale-reads.test.mjs:129` drop `!pattern?.test(line)`    | **KILLED** (`rc=1`) | `font-scale-reads.test.mjs` (6/7 pass, 1 fail)                                                                                   |

All **8/8 mutants KILLED**, **0 survived**.

---

## Verification Matrix

- **TypeScript (`tsc --noEmit`)** on `/Users/murat/opensource/cc/couture-cast-wt-615`:
  - `npx tsc -p apps/mobile/tsconfig.json --noEmit`: `rc=0` (**0 errors**)
- **Node suites** on `/Users/murat/opensource/cc/couture-cast-wt-615` (`font-scale-reads`, `live-font-{capture,pages,text-probe,scale-proof,journey,volatile-proof}`, `text-layout-probe-mode`, `story68-{native-build-env,release-live-font-command}`):
  - **336 tests, 49 suites, 336 pass, 0 fail, 0 skipped, 0 cancelled, 0 todo** (`1119.23ms`).
- **iOS Swift (`swift test`)** in `/tmp/wt-615-mutant-r47`:
  - **77 XCTest cases passed, 0 failures** (`0 Swift Testing tests`).
- **Playwright / `tab-bar-label*.test.tsx` / DB / `prisma generate`**: Not run per constraints (`apps/mobile/vitest.config.ts` runs Chromium via Playwright).
- **Security Scan (`codex-security-review`)**: Complete diff scan across all 16 non-report files recorded in `/private/tmp/codex-security-scans/couture-cast-wt-615/23314978_r47/report.md` (`FINALIZE_RC=0`, **0 security findings**; `commitAncestor` and `committedReader` use discrete `git` argv arrays guarded by 40-hex `SHA`, `safeDir`, and `CAPTURE_NAME` regexes, and AST parsing uses `ts.createSourceFile` with no evaluation).

REVIEW-615-R47-DONE
