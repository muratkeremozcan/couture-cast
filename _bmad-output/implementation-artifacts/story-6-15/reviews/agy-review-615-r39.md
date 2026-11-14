# Review Report: tea615 Round 39 (`6c966f49..6ccb76ca`)

- **Reviewed tree (read-only)**: `/Users/murat/opensource/cc/couture-cast-wt-615` (`git status -s` clean)
- **Revision range**: `6c966f49..6ccb76ca` (7 commits, 16 files: `996cb99a`, `99ea4c02`, `fd0af98b`, `a9ade128`, `9f2b7f25`, `2b054c9e`, `6ccb76ca`)
- **Mutants & test runs**: Executed in detached throwaway worktree `/tmp/wt-615-mutant-r39` at `6ccb76ca` (removed and `git worktree prune`d after); no Playwright, no database started.
- **Security scan (`~/.codex/skills/codex-security-review/SKILL.md`)**: Completed against `/private/tmp/codex-security-scans/couture-cast-wt-615/6ccb76ca_r39/report.md` — **0 exploitable security findings** (`no_issue_found` across all 4 diff surfaces; `network-tarpit.mjs` `127.0.0.1` default is a security improvement).

## Verdict

No P0, P1, or P2 blockers found. **One P3 finding** remains on `scripts/ci/junit-report-check.mjs` around multi-suite, bodyless/truncated, and suite-name checks. All six focus areas pass verification, with four mutants (`M1`–`M4`) killed.

## Findings

### [P3] `junitReportProblems` inspects only the first `<testsuite>` opening tag without verifying suite closure, `<testcase>` elements, or suite `name`

- **Location**: `scripts/ci/junit-report-check.mjs:14-32`
- **Failure scenario**: `junitReportProblems(xml, minimum)` extracts only the first match of `/<testsuite\b[^>]*>/` (`scripts/ci/junit-report-check.mjs:15`) and checks its numeric `tests`, `skipped`, `failures`, and `errors` attributes (`L17-30`). Three malformed or multi-suite report shapes pass (`[]`, exit `0`):
  1. **Multi-suite XML**: If a second `<testsuite>` element follows a passing first suite (e.g., `<testsuite name="First" tests="2" skipped="0" failures="0" errors="0">...</testsuite><testsuite name="Second" tests="1" skipped="0" failures="1" errors="0">...</testsuite>`), failures/errors/skips in the second suite are ignored.
  2. **Truncated or bodyless `<testsuite>`**: A report truncated right after the opening tag (`<?xml version="1.0"?><testsuite name="ModalSystemBarsTest" tests="2" skipped="0" failures="0" errors="0">`) or self-closing with zero `<testcase>` elements (`<testsuite ... tests="2" skipped="0" failures="0" errors="0"/>`) returns `[]` even though no `</testsuite>` or `<testcase>` was written.
  3. **Renamed or mismatched suite `name`**: Because `name="..."` is never checked, any `<testsuite>` XML placed at the target path (for example from a stale non-`clean` run if a caller runs `junit-report-check.mjs` after a pre-test step failure, or a copied report from another test class) passes as long as the first opening tag has `tests >= minimum`. (Mitigated today in CI because jobs run under `set -euo pipefail` / bash `-eo pipefail` on fresh workspaces without Gradle build cache, and Gradle 8.14.3 deletes prior `TEST-*.xml` files when `--tests` matches nothing and exits `1`.)
- **Probe evidence** (in `/tmp/wt-615-mutant-r39`):
  - `junitReportProblems('<testsuite name="First" tests="2" skipped="0" failures="0" errors="0"><testcase name="a"/><testcase name="b"/></testsuite><testsuite name="Second" tests="1" skipped="0" failures="1" errors="0"><testcase name="c"><failure/></testcase></testsuite>', 2)` -> `[]`
  - `junitReportProblems('<?xml version="1.0"?><testsuite name="ModalSystemBarsTest" tests="2" skipped="0" failures="0" errors="0">', 2)` -> `[]`
  - `junitReportProblems('<testsuite name="ModalSystemBarsTest" tests="2" skipped="0" failures="0" errors="0"/>', 2)` -> `[]`
  - `junitReportProblems('<testsuite name="expo.modules.other.RenamedTest" tests="2" skipped="0" failures="0" errors="0"><testcase name="a"/><testcase name="b"/></testsuite>', 2)` -> `[]`
- **Recommendation**: Iterate over all `<testsuite\b[^>]*>` tags (or require total summed `tests >= minimum` across suites with zero `skipped`/`failures`/`errors` in every suite), require at least `minimum` `<testcase\b` elements and a closing `</testsuite>`, and optionally accept an expected `--suite <ClassName>` argument in the three workflow callers. (Minor CLI note: `fs.realpathSync(process.argv[1])` at `L49` also throws unhandled `ENOENT` if the file is imported while `process.argv[1]` is `'-'` from stdin evaluation.)

## Focus Verification

### 1. Loosened assertion (`scripts/ci/junit-report-check.mjs`)

- **Counts match current suites**: `ModalSystemBarsTest.kt` defines `2` `@Test` cases (`sdk = [28]`, `sdk = [33]`), matching minimum `2` in `.github/workflows/pr-modal-system-bars.yml:97` and `.github/workflows/pr-share-card-native.yml:255,494`. `PersistedTaskConsumersTest.kt` defines `3` `@Test` cases, matching minimum `3` in `.github/workflows/pr-task-manager-migration.yml:91`.
- **Missing / empty / zero-test / failing XML**: Confirmed fail-closed on missing file (`no report at ...`, exit `1`), empty/whitespace (`no <testsuite> element`), `<testsuites/>` (`no <testsuite> element`), `tests="0"` with min `2` (`ran 0 tests, expected at least 2`), `skipped`/`failures`/`errors > 0`, missing attribute counts, and single-quoted attributes.
- **Gradle stale-XML probe**: Running `gradle -p apps/mobile/modules/task-manager-migration/android/unit-tests testDebugUnitTest --tests expo.modules.taskmanagermigration.NonExistent` after a passing run exited `1` (`No tests found for given includes`) and deleted the previous `TEST-expo.modules.taskmanagermigration.PersistedTaskConsumersTest.xml`.
- **Red proofs & mutant**: `scripts/ci/junit-report-check.test.mjs` covers both `tests="4"` against `3` (pass) and `tests="2"` against `3` (fail). Mutant `M1` (`else if (tests < 0)`) was **KILLED** by `junit-report-check.test.mjs`.
- **Path filters & lane wiring**: `scripts/ci/junit-report-check.mjs` is listed in `pull_request.paths` and `push.paths` of both `pr-modal-system-bars.yml:15,30` and `pr-task-manager-migration.yml:16,25`, and covered by `'scripts/**'` in `pr-share-card-native.yml:23` (`push.paths`) and `scripts/ci/lanes.mjs:88` (`SHARED`, triggering all lanes). `scripts/ci/junit-report-check.test.mjs` is auto-discovered by `"native-harness": "discover"` in `scripts/ci/node-test-suites.json:2,14`.

### 2. Deleting `pr-share-card-native.yml` `task_manager_migration` steps

- No other job, step, or validator gates APK caching or native jobs on `task_manager_migration`: `scripts/ci/share-card-lanes.mjs:384-392` requires `steps.native_build.outcome == 'success' && steps.modal_system_bars.outcome == 'success'` for `apk_scan` (matching `.github/workflows/pr-share-card-native.yml:260,499`).
- Standalone `.github/workflows/pr-task-manager-migration.yml` is the sole Robolectric harness on `pull_request`, `push` to `main` (path-filtered), and `workflow_dispatch`, monitored by `.github/workflows/pr-gate.yml` (`workflow_run: workflows: ['**']`) and matching `_bmad-output/test-artifacts/test-design/cc615-expo-sdk58-live-font-scale-test-design.md:499`.

### 3. `127.0.0.1` network tarpit (`scripts/lib/network-tarpit.mjs`)

- `startTarpit` defaults `host = '127.0.0.1'` (`scripts/lib/network-tarpit.mjs:21`), and CLI invokes `startTarpit({ port })` (`L58`).
- Callers (`scripts/ci/android-network-timeout.sh:20,25`, `scripts/ci/android-native-workflow.mjs:73,76`, `.github/workflows/android-native.yml:16`, `maestro/network-timeout/dev-client-timeout.yaml:15-16`) point the Android emulator at `http://10.0.2.2:4010`, which QEMU SLIRP routes to host IPv4 loopback `127.0.0.1:4010`. No iOS caller exists (and iOS simulator uses `127.0.0.1` directly).

### 4. Webhook 401 contract pin & `scripts/lib` dist imports

- `scripts/lib/test-store-webhook.mjs:29` exports `UNAUTHORIZED_MESSAGE = 'Invalid webhook credentials.'` (used in `classifyProbe` at `L51`).
- `packages/api-client/testing/subscription-contract.spec.ts:276-288` dynamically imports `scripts/lib/test-store-webhook.mjs` and pins `UNAUTHORIZED_MESSAGE === BILLING_WEBHOOK_UNAUTHORIZED_MESSAGE`. Mutant `M2` changing the literal to `'Drifted webhook credentials.'` was **KILLED** (`exit 1`).
- `rg -n '@couture/' scripts/lib` finds only one workspace import: `scripts/lib/story68-built-render.mjs:6` (`import { validateShareCardPng } from '@couture/api-client'`). It is executed directly by `.github/workflows/pr-share-card-native.yml:196,793` **after** `npm run build:packages` (`L193,790`) and is not imported by any `native-harness` test file, so `native-harness` (`--start` at `L734`) runs cleanly before `build:packages`.

### 5. `apps/mobile/modules/task-manager-migration/android/build.gradle`

- Reduced to `com.android.library`, `expo-module-gradle-plugin`, `namespace 'expo.modules.taskmanagermigration'`, and `defaultConfig`, with no configure-time `node` call or test dependencies (`apps/mobile/modules/task-manager-migration/android/build.gradle:1-13`).
- Verified in `/tmp/wt-615-mutant-r39` via `npx expo prebuild --platform android --no-install` + Gradle 8.14.3:
  - `:task-manager-migration:assembleRelease` succeeded (`BUILD SUCCESSFUL`), bundling `TaskManagerMigrationPackage`, `TaskManagerMigrationLifecycleListener`, and `PersistedTaskConsumers` in `task-manager-migration-release.aar`.
  - `:task-manager-migration:dependencies --configuration releaseRuntimeClasspath` contains only `org.jetbrains.kotlin:kotlin-stdlib-jdk7:2.1.20` (`kotlin-stdlib:2.1.20` -> `annotations:13.0`), with zero test-only dependencies.
  - `scripts/ci/mobile-android-autolinking.test.mjs` passed, confirming `TaskManagerMigrationPackage()` is generated in `ExpoModulesPackageList.java`.

### 6. `subscriptionManageEntry` deduplication (`packages/api-client/src/contracts/http/subscription.ts`)

- Behavior matches both removed `manageEntryFor` helpers across all 5 `EntitlementStore` values: `'stripe'` -> `'web'`, `'app_store' | 'play_store'` -> `'store'`, `'promotional' | 'test_store'` -> `'none'` (`packages/api-client/src/contracts/http/subscription.ts:172-185`).
- Exhaustive at compile time (`switch (store)` without `default`, return type `SubscriptionManageEntry`).
- **Typecheck (`tsc --noEmit`)**: `packages/api-client` exit `0`, `apps/web` exit `0`, `apps/mobile` exit `0`.
- **Mutants**: `M3` (deleting `case 'test_store': return 'none'`) failed `tsc --noEmit` in `packages/api-client` (`error TS2366`), `apps/web` (`exit 2`), and `apps/mobile` (`exit 2`); `M4` (mapping `'test_store'` to `'store'`) was **KILLED** by `packages/api-client/testing/subscription-contract.spec.ts` (`exit 1`).

## Mutants & Checks Run

### Mutants (all in `/tmp/wt-615-mutant-r39`, reverted immediately after each run)

| ID   | Target                                                           | Mutation                                                          | Result     | Evidence                                                                                                                                                     |
| ---- | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `M1` | `scripts/ci/junit-report-check.mjs:24`                           | `else if (tests < minimum)` -> `else if (tests < 0)`              | **KILLED** | `node --test scripts/ci/junit-report-check.test.mjs` exit `1` (`ERR_ASSERTION`: `expected [ 'ran 2 tests, expected at least 3' ], actual []`)                |
| `M2` | `scripts/lib/test-store-webhook.mjs:29`                          | Change `UNAUTHORIZED_MESSAGE` to `'Drifted webhook credentials.'` | **KILLED** | `vitest run testing/subscription-contract.spec.ts` exit `1` (`AssertionError: expected 'Drifted webhook credentials.' to be 'Invalid webhook credentials.'`) |
| `M3` | `packages/api-client/src/contracts/http/subscription.ts:179-180` | Delete `case 'test_store': return 'none'`                         | **KILLED** | `tsc --noEmit` failed in `packages/api-client` (`TS2366`), `apps/web` (`exit 2`), `apps/mobile` (`exit 2`)                                                   |
| `M4` | `packages/api-client/src/contracts/http/subscription.ts:179-180` | Map `'test_store'` -> `'store'`                                   | **KILLED** | `vitest run testing/subscription-contract.spec.ts` exit `1` (`"test_store": "store"` vs `"none"`)                                                            |

### Checks

- **TypeScript (`tsc --noEmit`)** in `/Users/murat/opensource/cc/couture-cast-wt-615`: `packages/api-client` exit `0`, `apps/web` exit `0`, `apps/mobile` exit `0`.
- **CI & lib Node suites** in `/tmp/wt-615-mutant-r39`: `node --test scripts/ci/junit-report-check.test.mjs scripts/ci/share-card-lanes.test.mjs scripts/ci/share-card-paths.test.mjs scripts/ci/android-native-workflow.test.mjs scripts/ci/pr-pipeline-shape.test.mjs scripts/ci/mobile-android-autolinking.test.mjs scripts/lib/network-tarpit.test.mjs scripts/lib/test-store-webhook.test.mjs` -> **389/389 passed** (`13` suites). `node --test scripts/ci/lanes.test.mjs` -> **27/27 passed**.
- **Full `node-test-gate.mjs` note** in `/tmp/wt-615-mutant-r39`: `node scripts/ci/node-test-gate.mjs native-harness` ran **2774 tests**: **2773 passed, 1 failed** — the sole failure was `scripts/ci/verify-dependency-tree.test.mjs:12:1` because the throwaway `/tmp` worktree symlinked only root `node_modules` and not `apps/api/node_modules`. Not executed on the clean shared tree.
- **Vitest (`packages/api-client`, `apps/web`)** in `/tmp/wt-615-mutant-r39`:
  - `packages/api-client/testing/subscription-contract.spec.ts`: **18/18 passed**.
  - `apps/web/src/app/components/subscription-section.test.tsx` + `subscription-section.complimentary.test.tsx`: **33/33 passed**.
  - `apps/mobile` Vitest specs not executed (configured with `browser.provider: playwright()`, excluded by the no-Playwright constraint).
- **Gradle 8.14.3 + Temurin 21** in `/tmp/wt-615-mutant-r39`:
  - Standalone `apps/mobile/modules/task-manager-migration/android/unit-tests` `testDebugUnitTest`: **BUILD SUCCESSFUL** (`32 actionable tasks: 32 executed`); `PersistedTaskConsumersTest.xml`: `tests="3" skipped="0" failures="0" errors="0"`.
  - Prebuild (`expo prebuild --platform android --no-install`) + `:modal-system-bars:testDebugUnitTest --tests expo.modules.modalsystembars.ModalSystemBarsTest :task-manager-migration:assembleRelease :task-manager-migration:dependencies --configuration releaseRuntimeClasspath`: **BUILD SUCCESSFUL** (`117 actionable tasks: 89 executed, 28 up-to-date`); `ModalSystemBarsTest.xml` passed `junit-report-check.mjs ... 2` (`tests="2" skipped="0" failures="0" errors="0"`).

REVIEW-615-R39-DONE
