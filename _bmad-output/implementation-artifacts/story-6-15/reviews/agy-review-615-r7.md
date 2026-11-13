# Story 6.15 Review — Round 7 (`b0a2dd3f..70745735`, plus `ca4a532f` on `HEAD`)

Target: `/Users/murat/opensource/cc/couture-cast-wt-615` (read-only audit).
Reviewed commits: `445e2068`, `aec996e1`, `9791c5bb` (docs stat checked), `70745735`, plus `ca4a532f` (live control fix on `HEAD`).
Mutants verified in detached `/tmp/wt-615-mutant-r7` (removed and `git worktree prune`d cleanly).

---

## Findings (Ranked P0–P3)

### [P2] `residualApproved` allows headroom when hand-edited and skips count limit when `maxStaleMisses` is omitted

- **Location**: `scripts/lib/live-font-scale-proof.mjs:540-582` (`line 576`, `line 570`)
- **Failure scenario**:
  - While `proposedResidualEntry` (`lines 590-604`) generates exact `staleIds` and exact `maxStaleMisses: misses.length` with zero headroom, `residualApproved` (`lines 570-580`) only enforces `misses.length <= baseline.maxStaleMisses` and `baseline.staleIds.includes(missId(miss))`.
  - Consequently, a manually edited entry in `scripts/lib/fixtures/live-font-residual-baselines.json` can carry arbitrary headroom (`maxStaleMisses: 999` or extra unused `staleIds` beyond `review.growthFailing`), and an entry with `maxStaleMisses` omitted (`undefined`) or `NaN` evaluates `misses.length > undefined` (`line 576`) as `false` — approving any number of stale misses across those `staleIds`.

### [P3] Canary schedule separation test breaks across UTC midnight and ignores shard chain duration

- **Location**: `scripts/ci/ios-native-workflow.test.mjs:1765-1780` (`lines 1767-1778`)
- **Failure scenario**:
  - `minuteOfDay` computes `hour * 60 + minute` linearly (`[0, 1439]`), and `line 1777` asserts `canary >= nightly + liveFont['timeout-minutes']`.
  - If the nightly run moves to late UTC (e.g. `30 22 * * *` -> `1350` min) and the canary runs after midnight (`0 2 * * *` -> `120` min, 210 minutes later), `120 >= 1350 + 180` fails falsely.
  - Conversely, `line 1777` checks only `ios-live-font` (`180` min). If `ios-live-font['timeout-minutes']` is ever lowered below `ios-build + max(ios-shard, ios-expo-go)` (`60 + 70 = 130` min currently), the test would allow `ios-native-canary.yml` to overlap active shard/Expo Go macOS jobs.

_(Security scan check: no P0/P1 issues or privacy leaks found.)_

---

## Specific Audit Questions `(a)`–`(e)`

- **(a) Replaced below-0.87 assertion (`scripts/lib/live-font-scale-proof.test.mjs:623-633`)**:
  - **Still proves what it proved before.** Because `70745735` evaluates `growthOutside` (`lines 561-568`) before the stale-miss `outside` check (`lines 570-575`), narrowing `staleIds` to `['']` on `bugChange()` (where `current-condition` fails growth) now stops at `growth fails outside baseline: current-condition` instead of reaching the stale-miss check. Keeping `current-condition` in `staleIds: ['', 'current-condition']` exercises the stale-miss check (`stale outside baseline: .*outfit-comfort-notes`) and kills Mutant R7-3, while `lines 682-696` separately exercise `growthOutside` and kill Mutant R7-2.
- **(b) Live control failure vs stored `controlPass` (`ca4a532f`, `scripts/lib/live-font-journey.mjs:183-196,260-265,282-303`)**:
  - Because `assertColdControl` tests `cold[base]` vs `cold[scale]` once per screen (`lines 183-196`) rather than per leg, an already-approved `leg.pass` stays `true`; **however, the run still fails**: `result.controls` records `pass: false`, `aggregateVerdict` (`lines 292-294`) rejects the run with `verdict.pass = false`, and `scripts/run-live-font-proof.mjs:700` exits nonzero (confirmed by Mutant R7-5). On an unapproved leg, `leg.residualProposal.review.controlPass` is also recorded `false` (`lines 262-263`), so committing the proposal approves nothing (`line 549`).
- **(c) Exact leg scoping and headroom (`scripts/lib/live-font-journey.mjs:228-235`, `scripts/lib/live-font-scale-proof.mjs:540-604`)**:
  - **Scope**: `runScreenJourney` (`lines 228-235`) matches exact `(platform, build === label, screen === name, String(from), String(to))` (note `build` matches `--label`, defaulting to `--build`; all baselines stop applying at `reactNativeVersion >= 0.87.0` via `fixExpectedFor`). No entry can match another screen, platform, build label, or scale transition.
  - **Headroom**: Generated proposals (`proposedResidualEntry`, `lines 590-604`) emit exact `staleIds` and exact `maxStaleMisses: misses.length` with zero headroom (confirmed by Mutant R7-4). Hand-edited entries in `live-font-residual-baselines.json` _can_ carry headroom (`maxStaleMisses > misses.length` or extra `staleIds`), tracked in **[P2]** above.
- **(d) Proposed file & upload leak surface (`aec996e1`, `scripts/run-live-font-proof.mjs:650-653,692-698`, `.github/workflows/ios-native-jobs.yml:1124-1135`)**:
  - **No private leak path.** `proposedBaselines` (`live-font-journey.mjs:322-330`) includes only the committed `live-font-residual-baselines.json` metadata plus `(platform, build, screen, from, to)`, static accessibility `testID` strings (`staleIds`, `growthFailing`), integer `maxStaleMisses`, boolean/verdict flags, and `evidence` capture filenames (`<capture.file>`, not capture text or node trees).
  - `run-live-font-proof.mjs:692-698` writes `live-font-residual-baselines.proposed.json` (`0o600`) inside `$RUNNER_TEMP/live-font-ios` before exiting; `ios-native-jobs.yml:1124-1135` runs `native-ios-app-secret-scan.mjs "$RUNNER_TEMP/live-font-ios" "$CC68_HARNESS_DIR"` whenever `steps.live_font.outcome != 'skipped'` (including failures that produced proposals) and gates `upload-artifact` (`ios-live-font-proof`) on `steps.live_font_scan.outcome == 'success'`.
- **(e) Canary schedule test (`445e2068`, `scripts/ci/ios-native-workflow.test.mjs:1765-1780`)**:
  - Validates the current `03:23 UTC` + `180` min vs `06:37 UTC` schedule (`214` vs `180`), but is brittle to midnight wraparound and only checks `ios-live-font`'s timeout (tracked in **[P3]** above).

---

## Checks & Mutants Executed

- `node --test scripts/lib/live-font-*.test.mjs scripts/ci/ios-native-workflow.test.mjs`: **578 passed, 0 failed, 0 skipped, 0 todo** (`23` suites).
- Detached `/tmp/wt-615-mutant-r7` (at `08c6239b`, removed & pruned cleanly):
  - **R7-1**: drop `review.controlPass !== true` check (`live-font-scale-proof.mjs:549`) -> **killed** (`rc = 1`).
  - **R7-2**: drop `growthOutside` runtime check (`live-font-scale-proof.mjs:561-568`) -> **killed** (`rc = 1`).
  - **R7-3**: drop stale-miss `outside` check (`live-font-scale-proof.mjs:570-575`) -> **killed** (`rc = 1`).
  - **R7-4**: add `+ 1` headroom to `proposedResidualEntry.maxStaleMisses` (`live-font-scale-proof.mjs:594`) -> **killed** (`rc = 1`).
  - **R7-5**: drop live `result.controls` check in `aggregateVerdict` (`live-font-journey.mjs:292-294`) -> **killed** (`rc = 1`).

REVIEW-615-R7-DONE
