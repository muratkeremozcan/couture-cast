# Code Review: `946b1190`, `152d0b81`, `7785bb0f` (`feat/story-6-15-expo-sdk-58`)

- **Worktree:** `/Users/murat/opensource/cc/couture-cast-wt-615`
- **Branch:** `feat/story-6-15-expo-sdk-58`
- **Commits reviewed:** `946b1190`, `152d0b81`, `7785bb0f`
- **Touched files:** `scripts/run-story68-native.mjs`, `scripts/lib/story68-audit-failure-digest.test.mjs` (plus supporting `scripts/lib/share-card-audit-report.mjs`, `scripts/lib/story68-hierarchy-driver.test.mjs`, `scripts/ci/native-ios-maestro-driver.mjs`)
- **Test execution (read-only):** `node --test scripts/lib/story68-audit-failure-digest.test.mjs scripts/lib/story68-hierarchy-driver.test.mjs` — 14/14 passing.
- **Security lens (`~/.codex/skills/codex-security-review/SKILL.md` / `security-diff-scan`):** Applied diff-scoped discovery, validation, and attack-path analysis across `scripts/run-story68-native.mjs` and `scripts/lib/share-card-audit-report.mjs` (artifacts kept out of the Git worktree per read-only constraint).

---

## Findings (Severity-Ranked)

### [P1] Unconditional `xcresulttool` calls before reading `auditText` crash on missing or testless `.xcresult`, preventing `iosAuditFailure` from logging on build or early-launch failures

- **Location:** `scripts/run-story68-native.mjs:1073-1095` (and test coverage in `scripts/lib/story68-audit-failure-digest.test.mjs:56-66`)
- **Concrete failure scenario:**
  Commit `946b1190` spreads `...xcodebuildFailureReport(auditText)` into `iosAuditFailure` so that when `tests.length === 0` (such as a build or runner-launch failure), `tail` logs the last 12 lines of `accessibility-ios.log` beside `exitCode`, `counts`, and `failedTestIDs`.
  However, lines `1074-1079` unconditionally run:
  ```js
  const summary = JSON.parse(
    run('xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', result])
  )
  const tree = JSON.parse(
    run('xcrun', ['xcresulttool', 'get', 'test-results', 'tests', '--path', result])
  )
  ```
  before `auditText` is read (`line 1080`) and before `if (code !== 0 || !closed.passed)` (`line 1083`).
  When `xcodebuild test` fails during compilation, destination lookup, or early runner launch before creating a finalized test-results bundle at `result` (or if `xcodebuild` is killed before writing test results), `xcrun xcresulttool get test-results summary --path <result>` exits with code `64` (`Error: File or directory doesn't exist at path: ...`). Because `run()` (`scripts/run-story68-native.mjs:195-198`) throws `Error: owned_command_failed:xcrun:64:...` on non-zero exit, execution aborts at line `1075` before reaching line `1080` or line `1084`. The `iosAuditFailure` log line (including `exitCode` and `tail`) is never printed. (By contrast, `scripts/lib/story68-fallback-focus.mjs:60-68,204-216` and `scripts/lib/story69-share-sheet.mjs:927-955` check the `xcodebuild` exit status and log `xcodebuildFailureReport` before invoking `xcresulttool`.)
- **Required fix:**
  Read `auditText` immediately after `audit.once('exit')`, then guard the two `xcresulttool` invocations (check `fs.existsSync(result)` and wrap the `xcresulttool` reads in a `try / catch`, falling back to empty summary/tree objects `{ result: 'Failed', totalTestCount: 0, passedTests: 0, failedTests: 0, skippedTests: 0 }` and `{ testNodes: [] }` when `xcresulttool` fails). That preserves `closedShareCardAuditReport(summary, tree, auditText)` (`passed: false`, zero `counts`, empty `failedTestIDs`) and guarantees `iosAuditFailure` logs `exitCode`, `counts`, `failedTestIDs`, and `xcodebuildFailureReport(auditText).tail` even when `result` is missing or lacks test results. Add a unit test covering a missing `.xcresult`.

---

### [P2] Reverting `hierarchyOutput()` in `152d0b81`/`7785bb0f` leaves an unguarded bare `maestro hierarchy` call on the audit failure path that cold-starts a second XCTest runner (up to 120 s) and can mask `ios_accessibility_audit_failed`

- **Location:** `scripts/run-story68-native.mjs:1096` and `scripts/lib/story68-hierarchy-driver.test.mjs:33-41`
- **Concrete failure scenario:**
  Commit `946b1190` routed the post-failure hierarchy check through `hierarchyOutput()` (`--driver-host-port 17101`) per `Codex RUNS-R4-01`. Commits `152d0b81` and `7785bb0f` reverted line `1096` back to:
  ```js
  const hierarchy = run(maestroBinary, ['--device', device, 'hierarchy'])
  ```
  solely because `scripts/lib/story68-hierarchy-driver.test.mjs:33-41` had a static assertion `assert.equal(bare.length, 2)` from commit `185e827c`.
  In shard 3 (`scripts/ci/native-ios-shards.mjs:67`, `['permission-baseline', 'rapid-watermark', 'a11y']`), earlier Maestro flows in `permission-baseline`, `matrix`, and `rapid-watermark` (`scripts/run-story68-native.mjs:1448-1449`) start the Maestro XCTest driver on `--driver-host-port 17101` and write `native-ios-driver.json`. When `a11y` subsequently fails and runs the bare `run(maestroBinary, ['--device', device, 'hierarchy'])` at line `1096`:
  1. Because `--driver-host-port 17101` (`iosDriverGlobalArgs('ios')`) is omitted, Maestro CLI checks its default port (`22087`), misses the port `17101` driver, reinstalls the driver bundle, and cold-starts a second `xcodebuild test-without-building` XCTest runner on the simulator, burning 37–120 s.
  2. Under macOS/iOS simulator load where the cold-started second runner does not answer within Maestro's 120 s startup wait (the exact failure mode documented at `scripts/run-story68-native.mjs:271-273` and `scripts/ci/native-ios-maestro-trace.mjs:693-697`), `run(maestroBinary, ...)` throws `Error: owned_command_failed:maestro:1:...` at line `1096` and masks the actual `throw new Error('ios_accessibility_audit_failed')` on line `1105`.
  3. Note also that `ShareCardAccessibility` runs its own XCUITest bundle on the same simulator before line `1096`, which can evict or wedge the earlier port `17101` Maestro runner while `native-ios-driver.json` still marks it reusable (`--no-reinstall-driver`).
- **Required fix:**
  1. Match the post-kill pattern in `afterTimeoutHierarchy` (`scripts/run-story68-native.mjs:209-222`): call `recordIosDriverFlow({ platform, directory, device, ok: false })` first so any runner wedged/displaced by `ShareCardAccessibility` is stopped and the stale `--no-reinstall-driver` state is cleared, then read via `captureIosTimeoutHierarchy` (or `hierarchyOutput()` inside a `try / catch`) with `iosDriverGlobalArgs(platform)` (`--driver-host-port 17101`) so a hierarchy read failure cannot mask `throw new Error('ios_accessibility_audit_failed')`.
  2. Update `scripts/lib/story68-hierarchy-driver.test.mjs:33-41` to expect only the Settings `breadcrumbIn` bare call (or route that through `hierarchyOutput()` as well) and restore the assertion in `scripts/lib/story68-audit-failure-digest.test.mjs`.

---

### [P3] (Security / Privacy Lens) `xcodebuildFailureReport(auditText).tail` only strips path prefixes before `.swift`, leaking runner/worktree filesystem paths and simulator UDIDs into the public CI job log and lacking secret/email redaction

- **Location:** `scripts/lib/share-card-audit-report.mjs:144-155` and `scripts/run-story68-native.mjs:1084-1094` (test in `scripts/lib/story68-audit-failure-digest.test.mjs:157-169`)
- **Security & privacy analysis:**
  - **Direct credential exposure check:** `run-story68-native.mjs` in the `a11y` (`platform === 'ios'`) branch calls `requireDevice() -> ownedEnv()` (`lines 973, 224-228, 154-165`), which validates `owned-env.json` without merging its database/Supabase credentials into `process.env`. `ShareCardAccessibilityUITests` only reads static locale JSON files and queries loopback `http://127.0.0.1:63068/fixture` and `/focus-observation`, so database and Supabase service-role secrets are not passed into `accessibility-ios.log` during normal execution.
  - ** concrete leakage scenario in `tail`:**
    `scripts/lib/share-card-audit-report.mjs:150-154` sanitizes each `tail` line using only:
    ```js
    line
      .replace(/\S*\/(?=[^/\s]+\.swift)/g, '')
      .trim()
      .slice(0, failureLineChars)
    ```
    That regex only strips a path prefix when it is immediately followed by `<name>.swift`. In a real `xcodebuild test` failure where no test case failed (`tests.length === 0`), the last 12 lines of `accessibility-ios.log` are `xcodebuild`'s session footer and launch diagnostics, which contain `.xcresult`, `.xcodeproj`, `.app`, and DerivedData paths (e.g., `/Users/runner/work/.../_bmad-output/test-artifacts/story-6-8/runtime/accessibility-ios-<ts>.xcresult` or a developer's `/Users/<name>/...` path) and simulator UDIDs (`id=<UUID>`). Because those paths do not end in `.swift`, `.replace(/\S*\/(?=[^/\s]+\.swift)/g, '')` leaves `/Users/...` paths and UUIDs unredacted in `iosAuditFailure.tail` printed to `console.log` (the public GitHub Actions job log). Furthermore, if `xcodebuild` fails during a build phase or environment dump, or if UI text in `context`/`tests`/`tail` includes an email (`@cc68.test` / `@example.test`) or token-shaped value, `xcodebuildFailureReport` has no redaction filter comparable to `scripts/ci/native-ios-public-diagnostics.mjs:50-56` (`LOCAL_PATH`, `UUID`, `SECRET_TEXT`, `EMAIL`) or `scripts/e2e-share-card/public-evidence.mjs:338`.
- **Required fix:**
  In `scripts/lib/share-card-audit-report.mjs`, replace the `.swift`-only path stripper with a sanitizer applied across `tail`, `tests`, `issues`, and `context` that:
  1. Strips any local path prefix (`/(?:^|(?<=[\s=:(]))(?:\/Users|\/private|\/var|\/tmp|\/Library|\/Volumes|\/home|\/opt|\/runner)\/\S+/g` -> basename) in addition to `\S*\/(?=[^/\s]+\.swift)`.
  2. Redacts `UUID`, `EMAIL`, `SECRET_TEXT`, and `LONG_TOKEN` patterns using the same rules as `scripts/ci/native-ios-public-diagnostics.mjs:50-56`.
  3. Expand `scripts/lib/story68-audit-failure-digest.test.mjs:157-169` to include realistic `xcodebuild` footer lines (`.xcresult`, `.app`, `/Users/...`, simulator UUIDs, and secret/email patterns) and assert they are redacted in `tail`.

REVIEW-615-AUDIT-DIAG-DONE
