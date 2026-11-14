# Review — tea615 Round 30 (`bd1d3ecf..956fe627`)

- Worktree: `/Users/murat/opensource/cc/couture-cast-wt-615` (`branch: feat/story-6-15-expo-sdk-58`, `HEAD: 956fe627`)
- Commits reviewed:
  - `a1183ec5`: r29 `maestro-driver-sync` + runner error `.output` + `test-store-driver.test.mjs` `HOME` isolation closures
  - `956fe627`: r28 `proofDirInRepo` + `staleKeys` exact multiset + `requiredMounts` + `runTimezone` + regenerated 10 Android baseline entries

---

## Findings

### P3-1 — Baseline keys for `home` and `community` are not stable across reruns on the same build (even with `America/Chicago` pinned)

- **Locations**:
  - `scripts/lib/fixtures/live-font-residual-baselines.json:12-20, 134, 248-257, 370`
  - `apps/mobile/components/hero/hourly-forecast-ribbon.tsx:23-33` (`timeZone: 'UTC'`)
  - `packages/db/prisma/seeds/weather.ts:190, 240-241`
- **Failure scenario**:
  1. `home` approved `staleKeys` contain `"[\"\",\"1\u202fAM\"]#0"` through `"[\"\",\"5\u202fAM\"]#0"`. `packages/db/prisma/seeds/weather.ts:190` seeds hourly segments relative to `new Date()` when `seedWeather` runs, and `HourlyForecastRibbon` formats them with `timeZone: 'UTC'` (`hourly-forecast-ribbon.tsx:28`), **not** the device timezone. Re-seeding at any UTC hour other than `00:xx UTC` changes the rendered hours on Home, failing `exactnessProblem` even when `runTimezone` pins `America/Chicago`.
  2. `community` approved `staleKeys` contain `"[\"\",\"Your local forecast is out of date, so you are seeing looks from every climate band.\"]#0"` (lines `134`, `370`). Per `packages/db/prisma/seeds/weather.ts:240-241`, that fallback copy appears only once `fetched_at` ages past 1 hour. A rerun within 1 hour of `seedWeather` omits that key and fails `exactnessProblem` (`0 extra, 1 missing`).
  3. Unlabeled duplicate keys (`"68°F"#0..#4`, `"Home"#0..#1`, `"☁️"#1`, `"🌧️"#0..#1`) depend on `(top, left)` ordering in `keyed()` (`scripts/lib/live-font-scale-proof.mjs:139-151`); any layout jitter changing vertical rank or feed/weather card count flips `#n` indices and fails `exactnessProblem`.
- **Suggested fix**: Either fix/pin the seeded forecast clock (or exclude seeded forecast time strings as `volatile` prefixes) for reproducible reruns, and regenerate clean baselines from a fresh non-stale seed if `community` is not expected to display the >1h stale banner.

### P3-2 — `staleKeys` pools `coldParity` and `postUpdateParity` misses without stage separation or exact `growthFailing` matching, and baseline lookup omits `timezone`

- **Locations**:
  - `scripts/lib/live-font-scale-proof.mjs:550-553` (`staleMisses`), `577-603` (`exactnessProblem`)
  - `scripts/lib/live-font-journey.mjs:240-247` (`residualBaselines.find`)
- **Failure scenario**:
  1. `staleMisses` (`L550-553`) concatenates `coldParity.misses` and `postUpdateParity.misses` into one unordered multiset. If a key (e.g., `"[\"\",\"Expand (48h)\"]#0"` or `"[\"\",\"English (Canada)\"]#0"`, listed once) originally failed in `settled` (`coldParity`) and passed in `updated` (`postUpdateParity`), a regression where `updated` turns stale while `settled` changes leaves the pooled multiset count identical (`1`) and passes as `known-residual` (observed in Probe A).
  2. `exactnessProblem` (`L578-584`) checks only that failing growth probes are a subset of `staleIds` (`staleKeys` IDs), not equality with `review.growthFailing`. If a probe missed `postUpdateParity` (putting its ID in `staleKeys` with `review.growthFailing: []`) and later regresses on `growth` (`settled` vs `cold`) while `postUpdateParity` passes, `residualApproved` still returns `{ pass: true }` (observed in Probe B).
  3. `residualBaselines.find` (`live-font-journey.mjs:240-247`) filters only `(platform, build, screen, from, to)` without `entry.timezone === timezone`, so adding an entry for a second timezone always picks the first matching entry and fails `live_font_residual_environment_differs` for the second timezone (Probe C).
- **Suggested fix**: Record or key `staleKeys` separately (or prefix) by phase (`settled` vs `updated`), enforce exact failing growth probe parity against `review.growthFailing`, and filter `residualBaselines.find` by `(entry.timezone === timezone)` (falling back only when none matches `timezone` so the missing/mismatch code still triggers cleanly).

### P3-3 — Device timezone restore runs only in `finally` (skipped by signals/crash) and can abort `font_scale` restore / report write

- **Location**: `scripts/run-live-font-proof.mjs:686-697`
- **Failure scenario**: `SIGINT`, `SIGTERM`, `SIGKILL`, or a Node crash skips JS `finally`, leaving Android `persist.sys.timezone` set to `America/Chicago` (`LIVE_FONT_TIMEZONE`), alongside `font_scale` and iOS `status_bar`. Even on an error caught by `finally`, `adb('shell', 'cmd', 'alarm', 'set-timezone', pinned.previous)` at `L693` has no `try/catch`; if the device/adb fails during cleanup, it throws out of `finally` before restoring `font_scale` (`L694-696`) and before writing `live-font-report.json` (`L719`).
- **Suggested fix**: Register `SIGINT`/`SIGTERM` cleanup handlers matching `test-store-output.mjs` and guard each restore step in `finally` with `try/catch` (logging failures) so later cleanup and report persistence still run.

---

## Explicitly Requested Verifications & Judgments

### Closure Mutants & Re-verified Probes (in detached `/tmp/wt-615-mutant-r30`, removed afterward)

- **r29 closure mutants (`a1183ec5`) — all killed**:
  - `M_r29_1_installed_always_true_on_catch` (`installed = true` in catch): `exit=1` (`10 tests: 9 pass, 1 fail`)
  - `M_r29_2_subcommand_includes` (`!args.includes('hierarchy')`): `exit=1` (`10 tests: 9 pass, 1 fail`)
  - `M_r29_3_ignore_error_output` (`error.message` only): `exit=1` (`10 tests: 9 pass, 1 fail`)
  - `M_r29_4_skip_waitForPortFree`: `exit=1` (`10 tests: 9 pass, 1 fail`)
- **r29 Probes 1–3 re-run on `956fe627` — all verified closed**:
  - Probe 1 (first-call `hierarchy` fails before driver install): now keeps `installed === false`, re-runs `prepare()` and retries cleanly (`maestroCalls: 2`, returns `'{}'`).
  - Probe 2 (`test -e hierarchy flow.yaml` failing `DeviceServerDiedException`): no longer retries (`maestroCalls: 1`, rethrows error).
  - Probe 3 (`test-store-driver.test.mjs` `"the crash path"` with seeded `$HOME/.maestro/sessions` holding `ANDROID_stub-device_999`): `HOME: base` isolates it cleanly (`status: 0`, `2094 ms`).
- **r30 closure mutants + r28 M6 re-run (`956fe627`) — all killed**:
  - `M_r30_1_proofDirInRepo_no_realpath`: `exit=1` (`18 tests: 16 pass, 2 fail`)
  - `M_r30_2_proofDirInRepo_dotdot_prefix`: `exit=1` (`18 tests: 17 pass, 1 fail`)
  - `M_r30_3_staleKeys_extra_ignored`: `exit=1` (`54 tests: 53 pass, 1 fail`)
  - `M_r30_4_staleKeys_missing_ignored`: `exit=1` (`54 tests: 53 pass, 1 fail`)
  - `M_r30_5_staleKeys_set_not_multiset`: `exit=1` (`54 tests: 53 pass, 1 fail`)
  - `M_r30_6_staleKeys_skip_shape`: `exit=1` (`54 tests: 53 pass, 1 fail`)
  - `M_r30_7_timezone_after_keys` (disabled): `exit=1` (`54 tests: 53 pass, 1 fail`)
  - `M_r30_7b_timezone_after_keys_only` (moved after `exactnessProblem`): `exit=1` (`54 tests: 53 pass, 1 fail`)
  - `M_r30_8_runTimezone_no_readback`: `exit=1` (`47 tests: 46 pass, 1 fail`)
  - `M_r30_9_requiredMounts_always_root`: `exit=1` (`54 tests: 52 pass, 2 fail`)
  - `M6_r28_mountsKnown_skip_required`: `exit=1` (`54 tests: 52 pass, 2 fail`)
  - `M6_r28_mountsKnown_skip_later_scope`: `exit=1` (`54 tests: 51 pass, 3 fail`)

### Judgment Questions

1. **Can timezone restore leave a device changed (crash, `SIGKILL`)?**
   - **Yes** — see **P3-3**. `SIGKILL` (uncatchable), `SIGINT`/`SIGTERM`, or a failed adb call in `finally` leaves Android `persist.sys.timezone` changed.
2. **Does `runTimezone` readback trust a value that did not apply?**
   - Mostly sound when changing away from another zone (`AlarmManagerService` writes `persist.sys.timezone` when `cmd alarm set-timezone` succeeds, and `read !== timezone` catches rejected/unchanged writes). Two edge caveats remain: (a) if `persist.sys.timezone` was _already_ `timezone` (e.g. from a crashed run) and `cmd alarm set-timezone` exits `0` silently without applying, `read === timezone` still passes; (b) on iOS (`scripts/run-live-font-proof.mjs:626`), `process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone` trusts `process.env.TZ` verbatim without canonicalizing or checking `Intl`. (Note also: `runTimezone` runs before app launches via `launch()`, so an already-running app does not retain an old cached zone across cold/restart launches.)
3. **Can a `staleKeys` entry still pass a regression?**
   - **Yes** — in addition to pooled `coldParity` vs `postUpdateParity` swaps and `review.growthFailing` subset relaxation (**P3-2**), `parity()` compares only bounding-box height within `tolerance`, so internal text truncation (`ellipsizeMode`), box width changes inside `parent`, or leg-2 height switches between two earlier stages within `tolerance` still pass if the multiset of failing keys matches.
4. **Is the key text (`content` plus `index`) stable across reruns on the same build?**
   - **No** — see **P3-1** (`home` `"1 AM"`..`"5 AM"` tracks UTC hour of `seedWeather`, `community` out-of-date banner depends on >1 h `fetched_at` staleness, and unlabeled `#n` indices track `(top, left)` screen rank).

---

## Test Suite & Security Review

- **Detached mutant worktree cleanup**: `/tmp/wt-615-mutant-r30` removed cleanly via `git worktree remove --force` + `git worktree prune`; `git status --short` clean and `NO_MUTANT_WORKTREES` confirmed.
- **Test run** (`cd /Users/murat/opensource/cc/couture-cast-wt-615 && node --test scripts/lib/live-font-*.test.mjs scripts/lib/maestro-driver-sync.test.mjs scripts/lib/test-store-*.test.mjs`):
  - **233 passed, 0 failed, 0 skipped** across **17 suites**.
- **Security lens** (`~/.codex/skills/codex-security-review/SKILL.md`):
  - `config_preflight.py --profile security_diff_scan` exited `0` (`status: "ready"`, `delegated_workers: true`, `goal_tools: false` `suggest` only).
  - Direct security review of `bd1d3ecf..956fe627` found no P0–P2 issues: `adb` / `maestro` / `xcrun` calls use `spawnSync` with argument arrays (`shell: false`), `proofDirInRepo` resolves symlinks via `fs.realpathSync`, error `.output` is non-enumerable so serialized reports omit full raw process dumps, `HOME` is isolated in `test-store-driver.test.mjs`, and report/proposal files write with `0o600`.

REVIEW-615-R30-DONE
