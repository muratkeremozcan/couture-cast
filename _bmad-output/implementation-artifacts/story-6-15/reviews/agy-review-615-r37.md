# Code & Security Review — Story 6.15 (`tea615`, Round 37)

- **Repository / Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615` (read-only)
- **Reviewed Range**: `5cd47579..9865cc74` (`915c447c`, `c4760103`, `adb8d339`, `23a8eb6b`, `f5ec0bb6`, `f607a69a`, `9865cc74`)
- **Note on HEAD**: `wt-615` subsequently advanced one commit past `9865cc74` to `8e06efc0` (`test(ci): keep the filesNamed doc block on filesNamed`), while `tea/p007-r37` is at `9865cc74`.
- **Verdict**: **Range `5cd47579..9865cc74` is clear above P3.** No P0, P1, or P2 findings; 3 P3 findings documented below (one of which—the `filesNamed` JSDoc placement—was already resolved post-`9865cc74` in `8e06efc0`).

---

## Findings (P0–P3)

### P3-1 — `filesNamed` JSDoc sits above `referenceBefore` at `9865cc74` (fixed post-range in `8e06efc0`)

- **Location**: `9865cc74:scripts/ci/lanes.test.mjs:438-452` (introduced by `23a8eb6b`)
- **Failure scenario**: Commit `23a8eb6b` inserted `referenceBefore`'s JSDoc and function body between `filesNamed`'s JSDoc (`Repository files a source names in a string literal...`) and `function filesNamed(source, file, modules = new Set())`, leaving `filesNamed` with no attached doc comment and placing two stacked JSDoc blocks above `referenceBefore`. Future tooling or maintainers reading `filesNamed` see the contract detached above `referenceBefore`.
- **Status**: Resolved after `9865cc74` in `wt-615` commit `8e06efc0` (`filesNamed` JSDoc moved back above `function filesNamed`).

### P3-2 — `referenceBefore` treats non-resolving `new URL(...)` calls as directory-index reads, and small-depth path gaps remain beyond those documented

- **Location**: `9865cc74:scripts/ci/lanes.test.mjs:439-444,459,467-475`
- **Failure scenario**:
  1. `referenceBefore` matches `/\b(?:require\.resolve|new\s+URL)\s*\(\s*$/` across the 20 characters preceding a quoted path literal, without checking what base argument `new URL(...)` uses or whether the literal has a trailing slash (stripped by `\/?` in normalization).
     - Across the repository diff (`5cd47579 -> 9865cc74`), `scripts/ci/mobile-android-autolinking.test.mjs:19` (`fileURLToPath(new URL('../../apps/mobile/', import.meta.url))`) is the only file whose `filesNamed` result changed, gaining `apps/mobile/index.ts` from a trailing-slash directory URL.
     - Synthetic probe `non_resolving_http_base` (`new URL('apps/mobile', 'https://example.com')`) also maps to `["apps/mobile/index.ts"]` even though it constructs a remote URL rather than reading a local index file. If a non-mobile test file (e.g., `playwright/tests/*`) writes `new URL('../../apps/mobile/', import.meta.url)` or uses a non-file base URL for an HTTP assertion, `lanes.test.mjs` would misclassify it as reading `apps/mobile/index.ts` and require the unrelated lane to wake.
  2. Beyond documented gaps (imports through a variable, `path.join` of a `<3`-segment directory plus `'index.ts'`), edge probes show `filesNamed` also returns `[]` for `<3`-segment directory targets on:
     - `import_meta_resolve` (`import.meta.resolve('../../apps/mobile')`) -> `[]`
     - `createRequire_call` (`createRequire(import.meta.url)('../../apps/mobile')`) -> `[]`
     - `path_resolve_dir` -> `[]`
     - `multiline_url_over_20` (>20 characters of whitespace/newlines between `new URL(` and the literal) -> `[]`
     - `webpack_comment` (`await import(/* x */ '../../apps/mobile')`) -> `[]`
     - non-`.ts`/`.js` index suffixes (`.tsx`, `.mjs`, `.cjs`)

### P3-3 — New Robolectric workflows omit prebuild/bootstrap inputs from `paths` and omit `github.event_name` from `concurrency.group`

- **Locations**:
  - `.github/workflows/pr-modal-system-bars.yml:10-23,40-65`
  - `.github/workflows/pr-task-manager-migration.yml:11-27`
- **Failure scenario**:
  1. `.github/workflows/pr-modal-system-bars.yml` executes `.github/actions/free-runner-disk`, `.github/actions/install`, and `npx expo prebuild --platform android --no-install` in `apps/mobile`, which read `apps/mobile/app.json`, `apps/mobile/app.config.ts`, `apps/mobile/package.json`, and `apps/mobile/plugins/**`. Unlike `.github/workflows/pr-accessibility-focus.yml:19-34`, `pr-modal-system-bars.yml:11-16` omits those paths plus `.github/actions/free-runner-disk/**`, `.github/actions/install/**`, and `.nvmrc` from `on.pull_request.paths` / `on.push.paths`, so a change to Expo prebuild configuration or plugins that affects Android prebuild for `modal-system-bars` would not trigger the workflow on PRs.
  2. Both `.github/workflows/pr-task-manager-migration.yml:26-27` and `.github/workflows/pr-modal-system-bars.yml` omit `-${{ github.event_name }}` in `concurrency.group` (compare `.github/workflows/pr-accessibility-focus.yml` and `.github/workflows/pr-share-native-unit.yml`), so a manual `workflow_dispatch` on `main` and a `push` to `main` share the same group key and cancel each other.

---

## Focus Area Assessment

### Focus (1): `task-manager-migration/android/unit-tests` standalone Robolectric project

- **Real `TaskService` restore executes**: Verified against `node_modules/expo-task-manager/expo-module.config.json` and `TaskService.java` inside `expo.modules.taskmanager-14.0.9-sources.jar`. `TaskService(context)` invokes `restoreTasks()`, which calls `Class.forName(consumerClassString)` and catches `ClassNotFoundException` (`L572-574`), logging errors under tag `"TaskService"`. Baseline `gradle -p apps/mobile/modules/task-manager-migration/android/unit-tests testDebugUnitTest --console=plain` passes with `TEST-expo.modules.taskmanagermigration.PersistedTaskConsumersTest.xml`: `tests="3" skipped="0" failures="0" errors="0"`.
- **Cannot go green with stale staged sources or broken migration**:
  - Probe `P_F1_stale_staged_removed` (invalid Kotlin written into `build/staged-src/expo/modules/taskmanagermigration/StaleBroken.kt`) passed with `exit=0` and `stale_still_exists=false`, confirming Gradle's `Sync` task deletes stale staged files before compilation.
  - Mutant `M_F1_drop_cleanup` (removing `PersistedTaskConsumers.dropUnloadable(application)` in `TaskManagerMigrationLifecycleListener.kt`) was **KILLED** (`exit=1`, `PersistedTaskConsumersTest.kt:79`: `java.lang.AssertionError: restore errors: [expo.modules.backgroundfetch.BackgroundFetchTaskConsumer]`).
  - Version coupling (`unit-tests/build.gradle:74-76`): reads `taskManagerPublication.version` directly from `node_modules/expo-task-manager/expo-module.config.json` (same version `14.0.9` as the app), failing loudly if `publication.version` is missing.
  - **Observed scope limitation**: `TaskManagerMigrationPackage.createApplicationLifecycleListeners` itself is not invoked in `PersistedTaskConsumersTest` (the test instantiates `TaskManagerMigrationLifecycleListener` directly at line 72, while `mobile-android-autolinking.test.mjs` checks package presence in `ExpoModulesPackageList.java`; full `Application.onCreate` wiring is exercised on-device). Also, `unit-tests/settings.gradle:24-29` places `local-maven-repo` after `google()` and `mavenCentral()` rather than scoping it first via `exclusiveContent` (safe while `host.exp.exponent` is absent from remote repos, cleaner if pinned first).
- **Moved `TaskManagerMigrationLifecycleListener`**: Behavior preserved verbatim (`PersistedTaskConsumers.dropUnloadable(application)`).
- **PR path filter coverage (`.github/workflows/pr-task-manager-migration.yml`)**: Covers `apps/mobile/modules/task-manager-migration/**`, `package-lock.json` (which governs `node_modules/expo-modules-core`, `expo-task-manager`, `unimodules-app-loader`, and `settings.gradle` Node resolution), and `.github/workflows/pr-task-manager-migration.yml`.

### Focus (2): `.github/workflows/pr-task-manager-migration.yml` & `.github/workflows/pr-modal-system-bars.yml`

- **PR Gate requiredness**: `.github/workflows/pr-gate.yml` uses `muratkeremozcan/pr-gate@main` with `workflow_run: workflows: ['**']`, automatically gating both workflows whenever triggered on a PR.
- **Fail-closed reporting**: Both workflows fail closed on missing reports, zero tests, skipped tests, or failures/errors via strict XML checks (`grep -q 'tests="3" skipped="0" failures="0" errors="0"' "$report"` in `pr-task-manager-migration.yml`; `grep -q 'tests="2" skipped="0" failures="0" errors="0"' "$report"` in `pr-modal-system-bars.yml`).
- **Timeouts, caches, permissions, fork safety, runtime**:
  - `timeout-minutes: 15` on both jobs.
  - `permissions: contents: read` on both workflows; triggered on `pull_request` / `push(main)` / `workflow_dispatch` with no secrets or write permissions, safe for forks.
  - `pr-task-manager-migration.yml` caches only `~/.m2/repository/org/robolectric` keyed on `apps/mobile/modules/task-manager-migration/**/build.gradle` with no Gradle build/test result cache (`org.gradle.caching` unset), so stale test results cannot be served.
  - Runtime fits well under the 15-minute p95 budget (standalone Robolectric runs in seconds locally plus dependency setup; `pr-modal-system-bars.yml` follows the `pr-accessibility-focus.yml` `android-robolectric` pattern documented around ~7 minutes including setup).

### Focus (3): `apps/mobile/src/lib/headless-js-timers.test.ts` & TypeScript health

- **`tsc` error count**: `cd apps/mobile && npx tsc --noEmit -p tsconfig.json` in `/Users/murat/opensource/cc/couture-cast-wt-615` exits `0` (`0` errors, resolving the 3 `TS2345` errors from round 36).
- **Mutant matrix**: All 5 required mutants in `headless-js-timers.test.ts` / `scope.ts` / `HeadlessJsTimersModule.kt` were **KILLED** (0 survived).

### Focus (4): `scripts/ci/lanes.test.mjs` `referenceBefore`

- Matches `require.resolve` (`["apps/mobile/index.ts"]` in probe) and `new URL` (`["apps/mobile/index.ts"]` on `mobile-android-autolinking.test.mjs:19`).
- Remaining non-resolving `new URL` match, additional unstated edge gaps on `<3`-segment directory references, and the `9865cc74` JSDoc placement issue are recorded in **P3-1** and **P3-2** above.

---

## Mutants & Probes Executed (in detached `/tmp/wt-615-mutant-r37`, removed & pruned)

| ID                             | Target                                           | Mutation / Probe                                                             | Outcome           | Evidence                                                                                                                                             |
| ------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M_F1_drop_cleanup`            | `TaskManagerMigrationLifecycleListener.kt`       | Remove `PersistedTaskConsumers.dropUnloadable(application)`                  | **KILLED**        | `exit=1`, `PersistedTaskConsumersTest.kt:79`: `java.lang.AssertionError: restore errors: [expo.modules.backgroundfetch.BackgroundFetchTaskConsumer]` |
| `P_F1_stale_staged_removed`    | `unit-tests/build/staged-src/.../StaleBroken.kt` | Inject invalid Kotlin file into staged source dir before `testDebugUnitTest` | **PASSED (safe)** | `exit=0`, `stale_still_exists=false`; Gradle `Sync` wipes stale staged files                                                                         |
| `M_F3_reuse_nextScope`         | `modules/headless-js-timers/src/scope.ts:30`     | `const scope = nextScope` without `++`                                       | **KILLED**        | `exit=1`, fails `gives overlapping work its own scope, so ending one leaves the other task pending`                                                  |
| `M_F3_running_set_after_begin` | `modules/headless-js-timers/src/scope.ts`        | Move `running.set` after `await native.begin(...)`                           | **KILLED**        | `exit=1`, 2 tests fail                                                                                                                               |
| `M_F3_drop_release`            | `modules/headless-js-timers/src/scope.ts`        | Drop `release` cleanup                                                       | **KILLED**        | `exit=1`, 3 tests fail                                                                                                                               |
| `M_F3_kt_key_changed`          | `HeadlessJsTimersModule.kt`                      | Rename `"CoutureCastHeadlessJsTimers"` -> `"OtherHeadlessKey"`               | **KILLED**        | `exit=1`, 1 test fails                                                                                                                               |
| `M_F3_js_key_changed`          | `modules/headless-js-timers/src/scope.ts`        | Rename `'CoutureCastHeadlessJsTimers'` -> `'OtherHeadlessKey'`               | **KILLED**        | `exit=1`, 1 test fails                                                                                                                               |

_(All `node_modules/_`in`/tmp/wt-615-mutant-r37`were temporary symlinks plus copied`msw`; the detached worktree was deleted and `git worktree prune` verified clean.)\*

---

## Security Review (`codex-security-review` / `security-diff-scan`)

- Executed Codex Security `security-diff-scan` against the diff and finalized cleanly (`finalize_scan_contract.py` exit `0`).
- Report: `/private/tmp/codex-security-scans/couture-cast-wt-615/9865cc74_r37/report.md` (**0 reportable findings**).

---

## Verification Commands Observed on Clean Worktree

- **Gradle Robolectric (`unit-tests`)**: `gradle -p apps/mobile/modules/task-manager-migration/android/unit-tests testDebugUnitTest --console=plain` -> **BUILD SUCCESSFUL** (`32 actionable tasks: 32 executed`); `TEST-expo.modules.taskmanagermigration.PersistedTaskConsumersTest.xml`: `tests="3" skipped="0" failures="0" errors="0"`.
- **TypeScript (`apps/mobile`)**: `cd apps/mobile && npx tsc --noEmit -p tsconfig.json` -> **exit 0** (`0` errors).
- **ESLint**: `npx eslint --max-warnings=0 apps/mobile/src/lib/headless-js-timers.test.ts` -> **exit 0**.
- **Vitest (`apps/mobile`)**: `cd apps/mobile && npx vitest run --config vitest.config.ts src/lib/headless-js-timers.test.ts src/lib/background-task.test.ts src/lib/background-task-entry.test.ts` -> **3 test files / 27 passed** (`7 + 19 + 1`), `0` failed.
- **Node CI suites**:
  - `node --test scripts/ci/lanes.test.mjs scripts/ci/pr-job-ceilings.test.mjs scripts/ci/workflow-node-deps.test.mjs scripts/ci/workflow-step-shadowing.test.mjs scripts/ci/free-runner-disk.test.mjs scripts/ci/node-dependencies.test.mjs scripts/ci/pr-pipeline-shape.test.mjs scripts/ci/pr-job-p95.test.mjs` -> **118 passed, 0 failed**.
  - Earlier 11-suite run (including `share-card-lanes`, `lanes-wiring`, `mobile-android-autolinking`) -> **419 passed, 0 failed**.

REVIEW-615-R37-DONE
