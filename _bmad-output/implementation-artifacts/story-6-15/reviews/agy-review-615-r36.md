# TEA Review — Story 6.15 Round 36 (`db877416..5cd47579`)

- **Target worktree**: `/Users/murat/opensource/cc/couture-cast-wt-615` (read-only)
- **Range reviewed**: `db877416..5cd47579` (`36be6ea7`, `30eff4d6`, `5cd47579`)
- **Mutant worktree**: `/tmp/wt-615-mutant-r36` (detached at `5cd47579`; removed and pruned after verification)
- **Security review**: `~/.codex/skills/codex-security-review/SKILL.md` (`security-diff-scan` finalized cleanly at `/private/tmp/codex-security-scans/couture-cast-wt-615/5cd47579_r36/report.md` — **0 reportable security findings**)
- **Verdict**: **Not clear** — 1 **P1** CI-blocking TypeScript failure in `36be6ea7`, plus 2 **P3** findings.

---

## Findings (P0–P3)

### [P1] `headless-js-timers.test.ts` fails `apps/mobile` `tsc --noEmit` (`TS2345`) under `noUncheckedIndexedAccess`

- **Location**: `apps/mobile/src/lib/headless-js-timers.test.ts:63,66,75` (with root `tsconfig.json:10` and `package.json:36`)
- **Concrete failure scenario**: Commit `36be6ea7` introduced `tasks.push(headlessTask(scope))` (`tasks: Promise<void>[]`) and passes `tasks[0]` directly to `settled(promise: Promise<unknown>)` at lines 63, 66, and 75. Because root `tsconfig.json:10` sets `"noUncheckedIndexedAccess": true`, `tasks[0]` has type `Promise<void> | undefined`, which `settled` rejects with:
  `error TS2345: Argument of type 'Promise<void> | undefined' is not assignable to parameter of type 'Promise<unknown>'.`
  Root `package.json:36` (`"typecheck": "npm run --workspaces typecheck && ..."`) runs `apps/mobile`'s `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) in `.github/workflows/pr-checks.yml:104`, so the `typecheck` PR gate fails on `5cd47579`.
- **Observed evidence**: `npx tsc --noEmit -p tsconfig.json` in `apps/mobile` exited with code `2` (both in `/tmp/wt-615-mutant-r36` and `/Users/murat/opensource/cc/couture-cast-wt-615`).
- **Fix**: Narrow `tasks[0]` after the length check (e.g., `const [task] = tasks; assert(task)` / `if (!task) throw ...`, or accept `Promise<unknown> | undefined` cleanly after asserting definedness).

### [P3] `M_F2_3_reuse_nextScope` mutant (`const scope = nextScope` without `++`) survives all 6 tests in `headless-js-timers.test.ts`

- **Location**: `apps/mobile/src/lib/headless-js-timers.test.ts:46-108` and `apps/mobile/modules/headless-js-timers/scope.ts:30`
- **Concrete failure scenario**: Every test in `headless-js-timers.test.ts` calls `withTimers` once per `setup()`. Mutating `const scope = nextScope++` (`scope.ts:30`) to `const scope = nextScope` (reusing `1`) leaves all 6 tests in `headless-js-timers.test.ts` and all 19 in `background-task.test.ts` passing (`25/25`, exit 0). If two `withHeadlessJsTimers` calls overlap on the same instance in production (e.g., an OS retry/second trigger overlapping a slow call, or a delayed `headlessTask(1)` arriving just as a second call starts), call 1's `finally` runs `running.delete(scope)` (`scope.ts:48`) for `1`, deleting call 2's entry while call 2's work is still running. Call 2's headless task then reads `running.get(1) === undefined` (`scope.ts:25`), resolves immediately, and lets React Native's `JavaTimerManager` pause JS timers mid-work.
- **Fix**: Add a test exercising two overlapping/sequential `withTimers` calls on one `setup()`, asserting distinct scopes (`1`, `2`) and that resolving the first leaves the second JS headless task pending until the second finishes.

### [P3] `lanes.test.mjs` `filesNamed` index narrowing misses `<3`-segment directory reads through `require.resolve`, `new URL`, variables, or `path.join`

- **Location**: `scripts/ci/lanes.test.mjs:451-461`
- **Concrete failure scenario**: Narrowing `/index.ts` and `/index.js` lookup behind `if (imported || !trackedDirs.has(candidate))` checks `imported` with `/\b(?:from|import|require)\s*\(?\s*$/` immediately before the quote (`L451`). Currently zero existing specs escape (see Focus 1 below). However, because `apps/mobile` (`apps/mobile/index.ts`) and `packages/eslint-config` (`packages/eslint-config/index.js`) are 2-segment `trackedDirs` entries (`< 3` segments, so `L469-471` does not expand them), a hypothetical spec in `playwright/tests/probe.spec.ts` (lane `web-e2e`, which does not watch `apps/mobile`) or `apps/api/integration/probe.spec.ts` (lane `coverage-api`, which does not watch `packages/eslint-config`) using `require.resolve('../../apps/mobile')`, `import(new URL('../../apps/mobile', import.meta.url).href)`, `const m = '../../apps/mobile'; await import(m)`, or `path.join(root, 'apps/mobile', 'index.ts')` now returns `[]` from `filesNamed` where `db877416` returned `['apps/mobile/index.ts']`, failing to require the caller's lane to wake on `apps/mobile/index.ts`.
- **Fix**: Document this limitation in `lanes.test.mjs` (or match `require.resolve` / `new URL` if ever needed by a future spec).

---

## Focus Area Verification

### 1. `scripts/ci/lanes.test.mjs` `filesNamed` index narrowing

- **Repo-wide impact (`db877416` vs `5cd47579`)**: Across all tracked `.js`/`.mjs`/`.ts`/`.tsx`/`.cjs` files, only two `<3`-segment tracked directories contain an `index.{ts,js}` file: `apps/mobile/index.ts` and `packages/eslint-config/index.js`.
  - Diffing `filesNamed` before vs after `30eff4d6` across the whole repo dropped `apps/mobile/index.ts` from 24 CI/helper files (such as `scripts/vercel-preview-inputs.mjs`, `scripts/ci/lanes.mjs`, `scripts/ci/mobile-android-autolinking.test.mjs`, `scripts/ci/coverage-shards.mjs`) and `packages/eslint-config/index.js` from `scripts/ci/lanes.mjs`. None of those files read those index files; all used `'apps/mobile'` or `'packages/eslint-config'` as directory path specs. No existing repo test lost a real dependency (`node --test scripts/ci/lanes.test.mjs` passes).
- **Specific patterns probed on `5cd47579`**:
  - Dynamic `import` via variable (`const m = '../../apps/mobile'; await import(m)`): `[]` (`imported = false`).
  - `new URL` (`await import(new URL('../../apps/mobile', import.meta.url).href)`): `[]` (`imported = false`).
  - `require.resolve` (`const p = require.resolve('../../apps/mobile')`): `[]` (`require.resolve(` does not match `/\b(?:from|import|require)\s*\(?\s*$/`).
  - `path.join` of dir + index (`fs.readFileSync(path.join(root, 'apps/mobile', 'index.ts'), 'utf8')`): `[]` (`'index.ts'` has no `/`, `'apps/mobile'` has `imported = false` and `<3` segments).
  - Direct `fs` read (`fs.readFileSync('apps/mobile/index.ts', 'utf8')`): `['apps/mobile/index.ts']` (matches `''` suffix).
  - Re-exports (`export * from '../../apps/mobile'`): `['apps/mobile/index.ts']` (`from ` matches `imported = true`, provided <=20 chars between `from` and quote).
  - Relative vs root candidates (`L454-465`): checked per-candidate inside the loop (`!trackedDirs.has(candidate)` evaluates each candidate independently).
  - 3-level directory rule (`L469-471`): still covers all directories `>=3` levels deep (e.g., `fs.readFileSync(path.join(root, 'apps/mobile/modules/headless-js-timers', 'index.ts'), 'utf8')` returns all 8 tracked files in `apps/mobile/modules/headless-js-timers/`, including `index.ts`).

### 2. `apps/mobile/src/lib/headless-js-timers.test.ts`

- **Typecheck & `?raw` Kotlin read in browser mode**:
  - `/// <reference types="vite/client" />` resolves `?raw` typing cleanly (`tsc --noEmit` produces zero errors on line 12), and Chromium Vitest imports `HeadlessJsTimersModule.kt?raw` cleanly (6/6 pass in 81ms on `wt-615`).
  - However, `tsc --noEmit -p tsconfig.json` fails with 3 `TS2345` errors at lines 63, 66, and 75 (see **P1** above).
- **Stub order vs `HeadlessJsTaskContext.startTask`**:
  - In RN (`node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/jstasks/HeadlessJsTaskContext.kt:62-98`) and `HeadlessJsTimersModule.kt:35-45`, `HeadlessJsTimersModule` calls `startTask(config)` on the UI thread, which calls `reactContext.getJSModule(AppRegistry::class.java).startHeadlessTask(taskId, taskConfig.taskKey, taskConfig.data)` _before_ returning `taskId` to `promise.resolve(...)`. Thus RN can deliver the headless task invocation to JS before `native.begin` resolves.
  - The default stub in `headless-js-timers.test.ts:27-30` calls `tasks.push(headlessTask(scope))` synchronously inside `begin` before `return Promise.resolve(7)`. That accurately exercises task delivery prior to `begin` resolution and kills `running.set` moved after `await native.begin`.
- **Mutants tested (detached `/tmp/wt-615-mutant-r36`)**:
  - `M_F2_1` (`running.set` moved after `await native.begin`): **KILLED** (`starts the native scope before the work and holds its JS task until the work ends` fails; 24/25).
  - `M_F2_2` (`release?.()` dropped in `finally`): **KILLED** (2 tests fail; 23/25).
  - `M_F2_3` (`const scope = nextScope` without `++`): **SURVIVED** (25/25 pass across `headless-js-timers.test.ts` and `background-task.test.ts` -> **P3**).
  - `M_F2_4` (Kotlin `HEADLESS_TIMERS_TASK_KEY` mutated): **KILLED** (`registers the task key the native module starts` fails; 24/25).
  - `M_F2_5` (JS `HEADLESS_TIMERS_TASK_KEY` mutated): **KILLED** (`registers the task key the native module starts` fails; 24/25).

### 3. `scripts/ci/mobile-android-autolinking.test.mjs`

- **Fail-closed behavior**:
  - Timeout / `status === null`: `assert.equal(result.status, 0, ...)` (`L43-46`) uses `node:assert/strict`, so `null !== 0` throws `AssertionError` — fails closed.
  - Missing target file: `fs.readFileSync(target, 'utf8')` (`L47`) throws `ENOENT` in a fresh `mkdtempSync` directory — fails closed.
  - CLI path moved in SDK 58: `createRequire(path.join(mobile, 'package.json')).resolve('expo-modules-autolinking/bin/expo-modules-autolinking.js')` (`L23-25`) throws `ERR_MODULE_NOT_FOUND` / `ERR_PACKAGE_PATH_NOT_EXPORTED` synchronously if moved or hidden behind `exports` — fails closed.
- **Regex tightness (`L55-62`)**:
  - `/^\s*new expo\.modules\.taskmanagermigration\.TaskManagerMigrationPackage\(\),?$/m` and `/^\s*expo\.modules\.headlessjstimers\.HeadlessJsTimersModule\.class,?$/m`.
  - Verified by probe: `// ...`, ` * ...`, `/* ... */`, and other class names (`TaskManagerMigrationPackageV2`, `HeadlessJsTimersModule2.class`) do **not** match. Only a bare un-prefixed interior line inside a multi-line `/* ... */` block comment would theoretically match, which `expo-modules-autolinking`'s generator does not emit.
- **Mutants tested (detached `/tmp/wt-615-mutant-r36`)**:
  - `M_F3_1` (rename `TaskManagerMigrationPackage.kt` -> `MigrationLifecycle.kt`): **KILLED** (exit 1).
  - `M_F3_2` (drop `HeadlessJsTimersModule` from `modules/headless-js-timers/expo-module.config.json`): **KILLED** (exit 1).
- **PR CI execution**:
  - `scripts/ci/node-test-suites.json:14` configures `"native-harness": "discover"` (`discoverRoot: "scripts"`, `discoverPattern: "\\.(test|spec)\\.mjs$"`), which discovers `scripts/ci/mobile-android-autolinking.test.mjs`.
  - On `pull_request`, `.github/workflows/pr-share-card-native.yml`'s `browser-acceptance` job (`L718-833`, gated by `lanes` output `'share-card'`) runs `node scripts/ci/node-test-gate.mjs --start share-card-plugins native-harness` and `--collect share-card-plugins native-harness`. Any PR touching `apps/mobile/**`, `scripts/**`, etc. wakes `'share-card'` (`scripts/ci/lanes.mjs:254-268`), so this test runs on PRs touching P0-07 modules.
- **Temp dir cleanup**:
  - `fs.mkdtempSync(path.join(os.tmpdir(), 'cc615-autolinking-'))` (`L26`) is paired with `finally { fs.rmSync(dir, { recursive: true, force: true }) }` (`L48-50`), cleaning up unconditionally on success, timeout, or error.

### 4. `5cd47579` Documentation Consistency

- `_bmad-output/test-artifacts/test-design/cc615-expo-sdk58-live-font-scale-test-design.md:498-502,639` and `_bmad-output/implementation-artifacts/spec-6-15-expo-sdk58-live-font-scale-layout.md:314`:
  - `P0-10`, `P0-11`, `P0-12`, and `P0-11 red` accurately reflect the verified fixes, Robolectric/CI job placement, TEA rulings (2026-11-14 known behavior for upgraded never-opened installs registering `RITUAL_BACKGROUND_TASK` on first launch), and mutant suite.
  - Note on provenance: the device-proof commit hash `8afa4b2c` cited in `spec-6-15:314` and `P0-10` is not in the ancestry of `5cd47579` (presumably rebased/amended into `7ac7ba77`, which has the same subject `test(mobile): prove the ritual fetch runs inside the headless timers scope`), consistent with the explicit merge condition requiring the `cc68-api36` P0-10 rerun at the pushed head.

---

## Checks Run (after final cleanup of `/tmp/wt-615-mutant-r36`)

In `/Users/murat/opensource/cc/couture-cast-wt-615`:

- `node --test scripts/ci/lanes.test.mjs scripts/ci/mobile-android-autolinking.test.mjs`: **28 passed, 0 failed** (0 skipped).
- `cd apps/mobile && npx vitest run --config vitest.config.ts src/lib/headless-js-timers.test.ts src/lib/background-task.test.ts src/lib/background-task-entry.test.ts`: **3 test files / 26 tests passed, 0 failed** (`headless-js-timers.test.ts` 6/6, `background-task.test.ts` 19/19, `background-task-entry.test.ts` 1/1).
- `cd apps/mobile && npx tsc --noEmit -p tsconfig.json`: **FAILED (`exit 2`)** — 3 `TS2345` errors in `src/lib/headless-js-timers.test.ts:63,66,75` (`tasks[0]` is `Promise<void> | undefined` under `noUncheckedIndexedAccess`).

REVIEW-615-R36-DONE
