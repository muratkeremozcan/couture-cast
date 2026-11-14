# Antigravity Review — `tea615` Round 35 (`47fa19b7..db877416`)

- **Repository / Worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615` (kept strictly read-only; no files edited, staged, committed, reset, or pushed)
- **Target Range**: `47fa19b7..db877416` (`feat/story-6-15-expo-sdk-58`, 7 commits: `39c0434c`..`db877416`)
- **Mutant Worktree**: Detached throwaway `/tmp/wt-615-mutant-r35` at `db877416`, removed (`rm -rf` + `git worktree prune`) and verified absent from `git worktree list`
- **Security Lens**: Codex Security diff scan (`security_diff_scan`, plugin `codex-security/d6169bef`, preflight `ready` with host `goal_tools_available=false` note; scan report `/private/tmp/codex-security-scans/couture-cast-wt-615/db877416_r35/report.md`): **0 reportable findings (`no_findings`)**

## Verdict

No **P0**, **P1**, or **P2** findings remain in `47fa19b7..db877416`. Two **P3** test/guard gaps exist in the committed range `47fa19b7..db877416` (subsequently targeted after `db877416` on `wt-615`, where `HEAD` advanced to `5cd47579` during review via `36be6ea7` and `30eff4d6`).

---

## Findings (P0–P3)

### [P3] `headless-js-timers.test.ts` in `db877416` does not catch `running.set` after `await native.begin` or a Kotlin/TS task-key mismatch

- **Locations**:
  - `apps/mobile/modules/headless-js-timers/scope.ts:31-40`
  - `apps/mobile/modules/headless-js-timers/scope.ts:4` vs `apps/mobile/modules/headless-js-timers/android/src/main/java/expo/modules/headlessjstimers/HeadlessJsTimersModule.kt:12`
  - `apps/mobile/src/lib/headless-js-timers.test.ts:17-57` (at `db877416`)
- **Failure scenario**:
  1. In `db877416`, `headless-js-timers.test.ts:44` triggers `headlessTask(startedScope())` inside `work()` _after_ `await native.begin(...)` resolves. In React Native, `HeadlessJsTaskContext.startTask` (`node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/jstasks/HeadlessJsTaskContext.kt:83-86`) calls `AppRegistry.startHeadlessTask` via `BridgelessReactContext.getJSModule` (`BridgelessReactContext.kt:111-112`) _before_ `HeadlessJsTimersModule.kt:45` resolves `begin`. If a refactor moves `running.set(scope, ...)` after `await native.begin(...)`, `running.get(scope)` is `undefined` when JS runs `startHeadlessTask`, so `AppRegistryImpl.startHeadlessTask` immediately calls `NativeHeadlessJsTaskSupport.notifyTaskFinished(taskId)` and `JavaTimerManager` clears the choreographer timer callback while `fetch` is running — yet `db877416`'s `headless-js-timers.test.ts` passes (`5/5`).
  2. `HEADLESS_TIMERS_TASK_KEY` is duplicated in `scope.ts:4` (`'CoutureCastHeadlessJsTimers'`) and `HeadlessJsTimersModule.kt:12` (`"CoutureCastHeadlessJsTimers"`). If either diverges, `HeadlessJsTimersModule` starts a key that JS `AppRegistry` has not registered (`No task registered for key ...` -> immediate `notifyTaskFinished`), and no check in `47fa19b7..db877416` fails.
- **Empirical mutant / probe evidence**:
  - **Mutant 1** (`running.set` moved after `await native.begin` in `scope.ts`, run at `db877416`): **SURVIVED** `src/lib/headless-js-timers.test.ts` (`5 passed / 5 tests`).
  - **Mutant 4** (`HEADLESS_TIMERS_TASK_KEY` changed to `"MismatchKey"` in `HeadlessJsTimersModule.kt`, run at `db877416`): **SURVIVED** all three Vitest suites (`3 files, 25 passed / 25 tests`).
  - **Probe 1** (simulating RN calling `provider()({ scope })` inside `begin()` before `begin` resolves on unmodified `scope.ts`): `orig_finished_before_work: false` (unmutated `scope.ts` is safe).
- _(Context note: `wt-615` subsequently added commit `36be6ea7` after `db877416` updating `headless-js-timers.test.ts`.)_

### [P3] No autolinking guard in `47fa19b7..db877416` prevents silent unlinking of `TaskManagerMigrationPackage` or `HeadlessJsTimersModule`

- **Locations**:
  - `apps/mobile/modules/task-manager-migration/expo-module.config.json:1-3`
  - `apps/mobile/modules/task-manager-migration/android/src/main/java/expo/modules/taskmanagermigration/TaskManagerMigrationPackage.kt:1-24`
  - `apps/mobile/modules/task-manager-migration/android/src/test/java/expo/modules/taskmanagermigration/PersistedTaskConsumersTest.kt:1-121`
- **Failure scenario**:
  - `expo-modules-autolinking` (`node_modules/expo-modules-autolinking/src/platforms/android/android.ts:218,228`) adds a `Package` to `ExpoModulesPackageList.java` only if a file ends with `Package.kt`/`Package.java` and matches `\bimport\s+expo\.modules\.core\.(interfaces\.Package|BasePackage)\b`, while `expo-module.config.json` contains only `{"platforms": ["android"]}`. Because `PersistedTaskConsumersTest.kt` instantiates `TaskManagerMigrationPackage()` directly, renaming `TaskManagerMigrationPackage.kt` (e.g., to `MigrationLifecycle.kt`) or importing the interface via wildcard leaves Robolectric tests and `:app` Gradle compilation passing while silently dropping `new expo.modules.taskmanagermigration.TaskManagerMigrationPackage()` from `ExpoModulesPackageList.java`, regressing SDK 54 -> 58 upgrades.
- **Evidence**:
  - Inspected `android.ts:205-247`; confirmed `expo prebuild --platform android --no-install` generates `ExpoModulesPackageList.java` containing both `new expo.modules.taskmanagermigration.TaskManagerMigrationPackage()` and `expo.modules.headlessjstimers.HeadlessJsTimersModule.class`. No test in `47fa19b7..db877416` asserts that generated list.
- _(Context note: `wt-615` subsequently added `30eff4d6` creating `scripts/ci/mobile-android-autolinking.test.mjs`, which passed when run in `wt-615`.)_

---

## Explicit Review Questions (1–9)

1. **`scope.ts` ordering & mutant survival**:
   - `scope.ts:32-40` calls `running.set(scope, ...)` _synchronously before_ `await native.begin(...)` while React Native `HeadlessJsTaskContext.startTask` (`HeadlessJsTaskContext.kt:83-86`) queues `AppRegistry.startHeadlessTask` onto the JS thread before `HeadlessJsTimersModule.kt:45` resolves `begin`. Thus `scope.ts` is safe as written (verified by Probe 1: `orig_finished_before_work: false`).
   - At `db877416`, `headless-js-timers.test.ts` fails to kill Mutant 1 (`running.set` after `await native.begin`: `5/5` passed) because it invokes `headlessTask` inside `work()` instead of inside `begin()`. Reported as P3 above.

2. **JS headless task leaks / early completion / RN 0.81 bridgeless**:
   - **`begin` rejects**: Caught in `scope.ts:41-44`, `work()` still runs, and `finally` (`scope.ts:46-49`) calls `release?.()` and deletes `scope` from `running`. Even if `startTask` had queued the JS task before throwing, `release?.()` settles it. No leak.
   - **`reactContext == null`**: `HeadlessJsTimersModule.kt:30-32` resolves `null` without starting a native task; `scope.ts` runs `work()` and deletes `scope` in `finally`. No leak.
   - **Timeout (`HEADLESS_TIMERS_TIMEOUT_MS = 9 * 60 * 1000`)**: `HeadlessJsTaskContext.scheduleTaskTimeout` (`HeadlessJsTaskContext.kt:165-169`) calls `finishTask(taskId)` at 9 minutes, removing it from `activeTasks` and notifying `JavaTimerManager.onHeadlessJsTaskFinish` without cancelling JS `work()`. When `work()` eventually finishes, `finally` still deletes `scope` and resolves any pending promise. (Wait: if the native task timed out at 9m before `work()` finished, a subsequent `AppRegistry` `notifyTaskFinished` simply logs a warning in `HeadlessJsTaskSupportModule.kt:45-48`.)
   - **App foregrounded mid-run**: `HeadlessJsTimersModule.kt:43` passes `allowInForeground = true`. `JavaTimerManager.onHostResume()` (`JavaTimerManager.kt:82-88`) sets `isPaused = false` and ensures the choreographer callback runs; `HeadlessJsTaskContext` does not finish active tasks on resume, and `onHostPause()` (`clearFrameCallback`, `JavaTimerManager.kt:135-142`) keeps choreographer active while `headlessJsTaskContext.hasActiveTasks()` is true.
   - **Overlapping scopes**: `nextScope++` creates distinct keys in `running`; `HeadlessJsTaskContext` tracks multiple integer `taskId`s in `activeTasks: MutableSet<Int>`, and `JavaTimerManager.onHeadlessJsTaskFinish` (`JavaTimerManager.kt:97-104`) only sets `isRunningTasks = false` and clears callbacks when `!headlessJsTaskContext.hasActiveTasks()`. Verified safe.
   - **Bridgeless RN 0.81**: `BridgelessReactContext` (`BridgelessReactContext.kt:45-46`) subclasses `ReactApplicationContext` (which subclasses `ReactContext`), so `appContext.reactContext as? ReactContext` (`HeadlessJsTimersModule.kt:29`) succeeds, and `BridgelessReactContext.getJSModule(AppRegistry::class.java)` (`BridgelessReactContext.kt:117-130`) returns a dynamic proxy invoking `reactHost.callFunctionOnModule("AppRegistry", "startHeadlessTask", ...)`.

3. **`PersistedTaskConsumers` ordering vs `TaskService` restore & live-task safety**:
   - **Restore paths vs `Application.onCreate`**: In `MainApplication.kt:47-48`, `ApplicationLifecycleDispatcher.onApplicationCreate(this)` invokes `TaskManagerMigrationLifecycleListener.onCreate(application)` synchronously on the main thread before `TaskManagerPackage` (`ModuleRegistryProvider.createSingletonModules`), `TaskBroadcastReceiver` (`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`), or `TaskJobService` (`onStartJob`/`onStopJob`) constructs `TaskService(context)`. Checked merged `AndroidManifest.xml`: no `android:process` attributes exist (single process only), and `ShareCardFileProvider`, `FileSystemFileProvider`, `ImagePickerFileProvider`, `CropFileProvider`, `MlKitInitProvider`, and `FirebaseInitProvider` do not touch `TaskService`. `androidx.startup.InitializationProvider` initializes `WorkManagerInitializer` (`expo-background-task`'s `BackgroundTaskWork`) in `ContentProvider.onCreate()` before `MainApplication.onCreate()`; on SDK 54 -> SDK 58 upgrades, WorkManager has no SDK 54 `EXPO_BACKGROUND_WORKER` job queued (SDK 54 used `expo-background-fetch` via `JobScheduler`), so `TaskService` is not touched before `Application.onCreate()` on upgrade; on post-upgrade cold starts when a live WorkManager job runs, `BackgroundTaskConsumer` is loadable anyway.
   - **Alphabetical `ExpoModulesPackageList` listener order**: In `ExpoModulesPackageList.java`, `TaskManagerPackage` precedes `TaskManagerMigrationPackage`, and `TaskManagerPackage` inherits `BasePackage.createApplicationLifecycleListeners` (empty), so it does not touch `TaskService` during `ApplicationLifecycleDispatcher.onApplicationCreate`.
   - **Live-task drop risks**:
     - **R8 / ProGuard**: Both `expo-background-task/android/proguard-rules.pro` (`-keep class expo.modules.backgroundtask.** { *; }`) and `expo-notifications/android/proguard-rules.pro` (`-keep class expo.modules.notifications.** {*;}`) keep consumer class names intact; `TaskService.restoreTasks` (`TaskService.java:555`) also uses `Class.forName(consumerClassString)`, so any class retained for `TaskService` is found by `PersistedTaskConsumers.loadable` (`Class.forName(className, false, context.classLoader)`).
     - **`LinkageError`**: Using `initialize = false` avoids triggering `<clinit>` early, and catching `LinkageError` prevents an incompatible leftover consumer binary from crashing startup inside `Application.onCreate` (whereas `TaskService.restoreTasks` only catches `ClassNotFoundException | NullPointerException`).
     - **`apply` vs `commit` race**: `PersistedTaskConsumers.dropUnloadable` (`PersistedTaskConsumers.kt:49`) uses synchronous `editor.commit()` when `dropped.isNotEmpty()`, ensuring SharedPreferences updates are committed before `TaskService` reads them.
     - **Unreadable entries**: Invalid JSON / missing `"tasks"` / empty `consumerClass` are skipped untouched (`PersistedTaskConsumers.kt:30-37`, verified by Robolectric test #2). (Minor quirk: JSON `{"consumerClass": null}` turns into `"null"` via `org.json.JSONObject.optString` and is dropped, which matches `TaskService.restoreTasks` rejecting non-string consumer classes.)

4. **Autolinking discovery & static guard**:
   - `expo prebuild --platform android --no-install` in the mutant worktree generated `ExpoModulesPackageList.java` containing both `new expo.modules.taskmanagermigration.TaskManagerMigrationPackage()` and `expo.modules.headlessjstimers.HeadlessJsTimersModule.class`.
   - Static guard was missing in `47fa19b7..db877416` (see P3 #2; subsequently added in `30eff4d6` after `db877416`).

5. **Duplicate headless task key (`CoutureCastHeadlessJsTimers`)**:
   - Duplicated at `apps/mobile/modules/headless-js-timers/scope.ts:4` and `HeadlessJsTimersModule.kt:12`. Not caught by any test in `47fa19b7..db877416` (Mutant 4 survived; see P3 #1; subsequently checked in `36be6ea7`).

6. **Robolectric spec & CI grep / `share-card-lanes` rule**:
   - On unmodified `db877416`, `./gradlew --no-daemon --max-workers=2 :task-manager-migration:testDebugUnitTest --tests expo.modules.taskmanagermigration.PersistedTaskConsumersTest` passed (`tests="3" skipped="0" failures="0" errors="0"`, `CI GREP PASSED`, 1.572s test duration).
   - With `dropUnloadable` disabled (**Mutant 3**), Robolectric failed `2/3` tests for the exact intended reasons: `an app scope left without tasks is removed...` failed `expected:<[RITUAL_BACKGROUND_FETCH_TASK]> but was:<[]>`, and `the upgrade restore after the cleanup logs no ClassNotFoundException...` failed `AssertionError: restore errors: [expo.modules.backgroundfetch.BackgroundFetchTaskConsumer]` from `ShadowLog.getLogsForTag("TaskService")` (matching `TaskService.java:50` `TAG = "TaskService"`).
   - `scripts/ci/share-card-lanes.mjs:389` enforces `steps.task_manager_migration.outcome == 'success'` before `apk_scan` and cache save, and `node --test scripts/ci/share-card-lanes.test.mjs` + `lanes-wiring.test.mjs` passed cleanly (`300/300` in mutant worktree; `301/301` in `wt-615` with untracked autolinking test).

7. **`build.gradle` invoking `node` at configuration time**:
   - `apps/mobile/modules/task-manager-migration/android/build.gradle:22-25` uses `providers.exec { commandLine('node', '--print', "require.resolve('expo-task-manager/package.json')") }` unconditionally during Gradle configuration.
   - This matches Expo/RN's own generated `android/settings.gradle` and `android/app/build.gradle:13-21`, which already invoke `node --print` / `.execute()` unconditionally at configuration time (and `providers.exec` is configuration-cache compatible). Low risk: only fails if `node` is missing from PATH (where RN/Expo Android builds already fail earlier in `settings.gradle`) or `expo-task-manager` is absent. Does not alter release APK inputs (`testImplementation` only).

8. **Entry point (`index.ts` / `package.json` `main`), web/iOS startup, double definition**:
   - `expo/scripts/resolveAppEntry` resolves `/tmp/.../apps/mobile/index.ts` identically for `android`, `ios`, and `web`.
   - Web & iOS startup: `index.ts` imports `'expo-router/entry'` then `'./src/lib/background-task'`; on web, `modules/headless-js-timers/index.ts` exports a no-op `withHeadlessJsTimers`, `ExpoTaskManager.web.ts` stubs listeners, and `ExpoBackgroundTaskModule.web.js` returns `Restricted`; on iOS, `requireOptionalNativeModule('HeadlessJsTimers')` in `index.native.ts` returns `null`, falling back safely to `work()`.
   - Double definition: ESM/Metro caches `'./src/lib/background-task'` alongside `app/_layout.tsx`'s `'@/src/lib/background-task'`, and `TaskManager.defineTask` (`node_modules/expo-task-manager/src/TaskManager.ts:123`) is an idempotent `tasks.set(taskName, taskExecutor)`.
   - `background-task-entry.test.ts` catches removing `./src/lib/background-task` from `index.ts` (**Mutant 2a** killed) and catches unknown `package.json` `main` values (`L46-47`); `background-task.test.ts` catches removing `withHeadlessJsTimers` (**Mutant 2b** killed). As a unit test, `background-task-entry.test.ts` mocks `expo-router/entry` rather than bundling via Metro, while `resolveAppEntry` separately confirms `package.json` `main` routes Metro to `index.ts`.

9. **CI timing & runner budget**:
   - `pr-share-card-native.yml` adds `:task-manager-migration:testDebugUnitTest` only in `original-resource` (`L257-264`) and `android36-native-matrix` (`L505-512`), both gated with `if: github.event_name != 'pull_request'` on `ubuntu-latest` (no macOS runners added) and running only on `native_build` cache misses.
   - Local cold Gradle run for `:task-manager-migration:testDebugUnitTest` took `44s` (warm incremental after `dropUnloadable` edit took `15s`; Robolectric test suite itself took `1.572s`). No PR job approaches the 15 min p95 / 20 min max limit (`browser-acceptance` timeout remains `20` minutes and does not run Gradle). `@expo/fingerprint` (`native-build-cache.mjs`) includes both `modules/headless-js-timers/android` and `modules/task-manager-migration/android` in the Android cache key.

---

## Checks Executed

- In `/tmp/wt-615-mutant-r35` (exact `db877416`):
  - `cd apps/mobile && npx vitest run --config vitest.config.ts src/lib/background-task-entry.test.ts src/lib/background-task.test.ts src/lib/headless-js-timers.test.ts`: **3 files, 25 passed, 0 failed** (duration `1.38s`).
  - `node --test scripts/ci/share-card-lanes.test.mjs scripts/ci/lanes-wiring.test.mjs`: **300 passed, 0 failed** (`11` suites).
  - `expo prebuild --platform android --no-install` + `./gradlew --no-daemon --max-workers=2 :task-manager-migration:testDebugUnitTest --tests expo.modules.taskmanagermigration.PersistedTaskConsumersTest`: **tests="3" skipped="0" failures="0" errors="0"**, `CI GREP PASSED` (`44s` Gradle, `1.572s` suite).
  - Mutants tested:
    - **M1** (`running.set` after `await native.begin` in `scope.ts`): **SURVIVED** at `db877416` (`5/5` passed in `headless-js-timers.test.ts`). **Probe 1** confirmed unmutated `scope.ts` keeps the task open (`orig_finished_before_work: false`).
    - **M2a** (remove `'./src/lib/background-task'` import from `index.ts`): **KILLED** by `background-task-entry.test.ts` (`0` calls to `defineTask`).
    - **M2b** (remove `withHeadlessJsTimers` wrapper in `background-task.ts`): **KILLED** by `background-task.test.ts` (`expected +0 to be 1`).
    - **M3** (early `return emptyList()` in `PersistedTaskConsumers.dropUnloadable`): **KILLED** by `PersistedTaskConsumersTest` (`2/3` failed: stale task & `TaskService` `ClassNotFoundException`).
    - **M4** (mismatch `HEADLESS_TIMERS_TASK_KEY` in `HeadlessJsTimersModule.kt`): **SURVIVED** at `db877416` (`25/25` vitest tests passed).
- In `/Users/murat/opensource/cc/couture-cast-wt-615` (read-only after mutant worktree removal; reflects `36be6ea7` & `30eff4d6` working tree/branch additions):
  - `cd apps/mobile && npx vitest run --config vitest.config.ts src/lib/background-task-entry.test.ts src/lib/background-task.test.ts src/lib/headless-js-timers.test.ts`: **3 files, 26 passed, 0 failed** (`1.55s`).
  - `node --test scripts/ci/share-card-lanes.test.mjs scripts/ci/lanes-wiring.test.mjs scripts/ci/mobile-android-autolinking.test.mjs`: **301 passed, 0 failed**.

REVIEW-615-R35-DONE
