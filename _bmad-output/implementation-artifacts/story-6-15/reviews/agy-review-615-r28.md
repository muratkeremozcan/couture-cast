# Antigravity Review — Story 6.15 Round 28 (`f3985243..5bac1637`)

- **Worktree:** `/Users/murat/opensource/cc/couture-cast-wt-615` (read-only; mutants/probes ran in detached `/tmp/wt-615-mutant-r28`, now removed and pruned)
- **Target commits:** `fdd7e461`, `773c3296`, `5bac1637`
- **Automated suite after cleanup:** `node --test scripts/lib/live-font-*.test.mjs` — **107 passed, 0 failed, 0 skipped** (15 suites)
- **Verdict:** No **P0**, **P1**, or **P2** findings remain; **the range `f3985243..5bac1637` has only minor P3 observations**.

## Findings (P0–P3)

No **P0**, **P1**, or **P2** issues found. Three **P3** observations:

### P3-1: `proofDir` outside-repo guard in `run-live-font-proof.mjs` is untested and checks `startsWith('..')` lexically

- **Location:** `scripts/run-live-font-proof.mjs:693-697`
- **Mutant evidence:** `M6_run_proofDir_no_outside_guard` (passing `dir: proofDir` unconditionally) exited `0` against `scripts/lib/live-font-*.test.mjs`.
- **Concrete failure scenario:**
  1. `scripts/run-live-font-proof.mjs` is the CLI driver (device-bound) and is not executed by `scripts/lib/live-font-*.test.mjs`, so no test catches a regression that drops the `proofDir.startsWith('..') || path.isAbsolute(proofDir)` guard.
  2. Lexically, a repo-internal output dir whose name begins with `..` (e.g. `--out ..cache-inside-repo`) sets `dir: undefined`, while a symlink created inside the repo pointing to an external directory would emit the symlink's repo-relative name rather than `undefined` because `path.resolve`/`path.relative` do not call `realpathSync`. Standard outside paths (`--out /tmp/...`, `--out ../...`, `--out ..`) and `--out .` (`''` falsy) safely omit `dir`.

### P3-2: Empty-string `""` in approved `staleIds` allows an equal-count unlabeled stale swap on `< 0.87`

- **Location:** `scripts/lib/live-font-scale-proof.mjs:537, 561-580` (`missId`, `exactnessProblem`); `scripts/lib/fixtures/live-font-residual-baselines.json:10, 33, 56, 79, 102, 125, 148, 171, 194, 217`
- **Concrete failure scenario:** All 10 approved SDK 54 Android entries include `""` in `staleIds` (representing text nodes without `testID`). Adding a new stale miss raises `misses.length` above `maxStaleMisses` and fails, **but** if one currently stale unlabeled text node is fixed or removed (`-1`) while a different unlabeled text node regresses to stale (`+1`)—keeping total misses equal to `maxStaleMisses` (`63`, `1`, `15`, `36`, `3`)—`exactnessProblem` sees `misses.length === maxStaleMisses` and `""` still hit, so the swap passes until RN `0.87.0` (`fixExpectedFor` >= `0.87.0` rejects all residuals). _(Same-total swap across hits of a repeated named id in both `coldParity` and `postUpdateParity`, such as `community-new-post-label`, has the same property while `hit` retains that id.)_

### P3-3: Modal capture tracker still retries 3 dumps per capture looking for `'root'` on Android

- **Location:** `scripts/run-live-font-proof.mjs:599-602`, `scripts/lib/live-font-capture.mjs:182-198` (`missingMounts`, `readWithMounts`)
- **Concrete failure scenario:** `mounts = mountTracker(['root', ...(SCREENS[name]?.mount ? [SCREENS[name].mount] : [])])` includes `'root'` even when `mount === 'modal'`. Because Android UiAutomator dumps only the modal Dialog window (`live-font-mount-modal-...`), `missingMounts` keeps returning `['root']`, causing `readWithMounts` to execute all 3 `maestro hierarchy` attempts per capture before returning the last read to `evaluateLiveFontChange`. Non-failing, adds extra dump latency on Android `composer`.

---

## Verification Summary

### 1. Mutants (Detached `/tmp/wt-615-mutant-r28`)

| Mutant                                   | Target                              | Result                | Failing Test(s)                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M1_mountsKnown_require_root_for_modal`  | `live-font-scale-proof.mjs:302`     | **KILLED** (`exit 1`) | `a modal capture with only the modal marker judges identity by the modal mount`                                                                                     |
| `M2_mountsKnown_skip_partial_root_check` | `live-font-scale-proof.mjs:305-306` | **KILLED** (`exit 1`) | `a screen marker missing from any stage leaves identity unknown`; `a scope the before capture showed is reread...`; `a modal capture with only the modal marker...` |
| `M3_mountsKnown_no_root_for_non_modal`   | `live-font-scale-proof.mjs:302`     | **KILLED** (`exit 1`) | `a modal capture with only the modal marker judges identity by the modal mount`                                                                                     |
| `M4_proposedBaselines_no_legs_fallback`  | `live-font-journey.mjs:326`         | **KILLED** (`exit 1`) | `an unapproved known-residual leg proposes its exact baseline entry`                                                                                                |
| `M5_proposedBaselines_ignore_dir`        | `live-font-journey.mjs:330`         | **KILLED** (`exit 1`) | `an unapproved known-residual leg proposes its exact baseline entry`                                                                                                |
| `M6_run_proofDir_no_outside_guard`       | `run-live-font-proof.mjs:696`       | Survived (`exit 0`)   | — (`P3-1`, CLI-only module)                                                                                                                                         |

### 2. Artifact & Hierarchy Probes

- **Approved 10 entries in `5bac1637`:** Verified all 10 entries (5 `sdk54-release` + 5 `sdk54-debug`, identical `screen`, `from`, `to`, `staleIds`, `maxStaleMisses`, and `review` fields) directly against the captured JSON proof files in `_bmad-output/test-artifacts/story-6-15/runs/live-font-android-*-sdk54-plugin-20261113-*/` via `assertLiveFontProof`. Every entry returned `verdict=known-residual` with all 4 referenced evidence files present on disk and `structuralPass: true`, `controlPass: true`, `everyMissStale: true`.
- **Android `composer` re-evaluation under `fdd7e461`:** Re-evaluating the captured Android Release and Debug `composer` JSONs through `evaluateLiveFontChange(..., { mount: 'modal' })` moved both from `unexpected` (`rootKnown=false`) to `known-residual` (`1->1.5`, `rootKnown=true`, `rootKept=true`, `activityKept=true`, `staleCount=10`) and `fixed` (`1.5->1`, `staleCount=0`).

---

## Judgment Questions

1. **Can a modal capture now pass while the screen behind it remounted or the Activity was recreated?**
   - **Activity recreated:** **No.** `identityCheck` (`scripts/lib/live-font-scale-proof.mjs:332-348`) still enforces `processKept`, `nativeKnown`, `activityKept` (Activity token equality), and `!(created > 0)` (`onCreate` delta), and Activity recreation also recreates the Fabric root and `LiveFontMountMarker scope="modal"` ID.
   - **ThemeProvider / RootLayoutNav / AndroidShareCardPresentation remounted:** **No.** In `apps/mobile/app/_layout.tsx:231-276`, `<LiveFontMountMarker scope="root" />` (`line 235`) and `<AndroidShareCardPresentation>` (`line 236`) are direct siblings under `<ThemeProvider value={theme}>` (`line 232`). On Android, `<AndroidShareCardPresentation>` renders `<ShareCardComposer>` directly when signed in (`member` truthy, `android-share-card-presentation.tsx:144-174`), and `ScreenShareCardComposer` (`lines 47-50`) renders `<ShareCardComposer>` inside the `<Stack>` screen (still under `AndroidShareCardPresentation` and `ThemeProvider`) when `member` is null. `<ShareCardComposer>` wraps `<EdgeToEdgeModal>` (`share-card-composer.tsx:861`), which places `<LiveFontMountMarker scope="modal" />` (`edge-to-edge-modal.tsx:145`). Any remount of `ThemeProvider` or `AndroidShareCardPresentation` creates a new modal mount ID, failing `sameMounts`.
   - **Screen behind `<AndroidShareCardPresentation>` (`<Stack>` child) remounted alone (signed-in Android path):** If only a `<Stack>` screen behind `<AndroidShareCardPresentation>` remounted while `ThemeProvider` and `AndroidShareCardPresentation` stayed mounted, `<ShareCardComposer>` and `scope="modal"` would stay mounted with the same ID. However, `scope="root"` (`_layout.tsx:235`) is also outside `<Stack>` (so checking `root` never detected `<Stack>` screen remounts either), Android modal window dumps omit `<Stack>` and `root` anyway, and every node measured by the `composer` proof lives inside `ShareCardComposer`, not the screen behind `<Stack>`.

2. **Does any approved entry let a real regression through?**
   - On RN `>= 0.87.0`, baseline entries are not consulted (`fixExpectedFor` requires `fixed`). Below `0.87.0`, structural regressions (clipping, dropped `fullText`, missing anchors, off-screen/overlapping controls, remounts, Activity recreation, control growth failures) still fail immediately. Purely adding a new stale node increases `misses.length` above `maxStaleMisses` and fails, and dropping all hits of a named stale ID fails `unused`. Only an equal-count `""` trade-off swap (`-1` existing unlabeled stale node + `+1` newly regressed unlabeled node preserving `maxStaleMisses`) could pass undetected (`P3-2`).

3. **Is the `dir` derivation safe for an `--out` outside the repo?**
   - **Yes for real external paths:** `path.relative(repoRoot, out)` produces `'..'` / `'../...'` (or a drive-qualified path on Windows), caught by `proofDir.startsWith('..') || path.isAbsolute(proofDir)`, and `--out .` produces `''` which `dir ? ...` omits cleanly (`P3-1` notes only lexical edge cases for symlinked dirs or repo-root subdirs named `..*`).

---

## Codex Security Review (`~/.codex/skills/codex-security-review/SKILL.md`)

- `config_preflight.py --profile security_diff_scan` exited `2` (`status: "incomplete"`, `delegated_workers`/`goal_tools` `unknown` in this harness).
- Manual diff review of `f3985243..5bac1637`: `proposedBaselines` only computes a relative `dir` string from CLI `--out`, `live-font-residual-baselines.json` contains test fixture expectations matching captured artifacts (`_bmad-output/test-artifacts/...`), and `mountsKnown` evaluates already-parsed hierarchy marker maps. No security regressions introduced.

REVIEW-615-R28-DONE
