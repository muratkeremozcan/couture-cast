# Code Review Round 2: `7785bb0f..28c8a7a6` (`feat/story-6-15-expo-sdk-58`)

Worktree: `/Users/murat/opensource/cc/couture-cast-wt-615`
Commit reviewed: `28c8a7a6` (`test(ci): make the iOS audit failure line print, safely, whatever xcodebuild left`; skipped `c0157cf7` docs commit)
Test suites run (read-only): `node --test scripts/lib/story68-audit-failure-digest.test.mjs scripts/lib/story68-hierarchy-driver.test.mjs scripts/lib/story68-fallback-focus.test.mjs scripts/lib/story69-share-sheet.test.mjs scripts/ci/native-ios-public-diagnostics.test.mjs` (131/131 passing).

## Round 1 Closure Status

- **Round 1 P1 (Closed):** `scripts/run-story68-native.mjs:1076-1097` reads `auditText` immediately after `audit.once('exit')`, `readAuditResult` (`scripts/lib/share-card-audit-report.mjs:155-166`) checks `exists(result)` and catches `xcresulttool` errors to return `{ summary: {}, tree: {}, resultError: 'missing' | 'unreadable' }`, and `closedShareCardAuditReport` produces `passed: false` with zero counts so `iosAuditFailure` always prints `exitCode`, `resultError`, `counts`, `failedTestIDs`, and `xcodebuildFailureReport(auditText)`.
- **Round 1 P2 (Closed):** `scripts/run-story68-native.mjs:1103-1115` stops and clears the owned driver via `recordIosDriverFlow({ platform, directory, device, ok: false })`, reads the hierarchy through `hierarchyOutput()` on `--driver-host-port 17101`, catches any failure to log `{ iosAuditFailureScreen: 'unavailable' }` before throwing `ios_accessibility_audit_failed`, and `scripts/lib/story68-hierarchy-driver.test.mjs:33-58` pins `bare.length === 1` (`breadcrumbIn`) and the guarded stop-then-read sequence.
- **Round 1 P3 (Partially Closed):** `publicLogLine` (`scripts/ci/native-ios-public-diagnostics.mjs:63-76`) is wired into all four `xcodebuildFailureReport` sections (`issues`, `context`, `tests`, `tail`), with two remaining defects detailed below.

## Findings

### P2-1: `publicLogLine` leaves paths after `|` or `[` unmasked and lets `EMAIL`, `file://`, and `.swift` regexes cross `|` boundaries in `CC68_AUDIT_ISSUE` records

- **Location:** `scripts/ci/native-ios-public-diagnostics.mjs:63-76`, `scripts/lib/story68-audit-failure-digest.test.mjs:235-277`
- **Concrete failure scenario:**
  1. `failedAuditIssues` and `failedAuditContext` pass pipe-delimited `CC68_AUDIT_ISSUE` payloads (`scope|type|id|label|description` and `scope-context|type|id|label|frame`) to `publicLogLine` (`scripts/lib/share-card-audit-report.mjs:116-129`).
     In `scripts/ci/native-ios-public-diagnostics.mjs:68`, the local-path pattern `/(^|[\s=:('"])(?:~\/|\/)[^\s'"),]+/g` requires a path to follow start-of-line or `[\s=:('"]`, omitting `|` and `[` as leading delimiters and omitting the `/\/(Users|private|var|tmp|Library|Volumes|home|opt|runner)\//` root check from `LOCAL_PATH` (`line 54`).
     As a result, `xcodebuildFailureReport('CC68_AUDIT_ISSUE open|1|/Users/murat/project/x.png|Today|Contrast').issues` returns `['open|1|/Users/murat/project/x.png|Today|Contrast']` with `/Users/murat/project/x.png` unmasked, and `publicLogLine('path=[/Users/runner/x.png]')` returns `'path=[/Users/runner/x.png]'` (both fail `closedValueProblem` with `path_in_string`).
  2. In `scripts/ci/native-ios-public-diagnostics.mjs:56, 66-67, 70`, `EMAIL` (`/[^\s@]+@[^\s@]+\.[^\s@]+/`), `file:\/\/\S+`, and `\S*\/(?=[^/\s]+\.swift)` match any non-whitespace character across `|` separators.
     On the test fixture at `scripts/lib/story68-audit-failure-digest.test.mjs:237` (`'CC68_AUDIT_ISSUE open|1|/Users/runner/work/couture-cast/couture-cast/x.png|a@b.example|Contrast'`), line 68 does not match `/Users/runner/...`; instead, `EMAIL` matches the entire string across all four `|` separators and collapses `failed.issues` to `['<email>']`.
     That destroys the 5-field issue record while allowing `assert.doesNotMatch(JSON.stringify(section), /\/Users\/|@b\.example/)` (`line 276`) to pass as a false positive.
     Similarly, `open|1|file:///Users/murat/x.png|Today|Contrast` collapses to `'open|1|<path>'` (dropping `|Today|Contrast`), and `open|1|/Users/runner/ShareCard.swift|Today|Contrast` collapses to `'ShareCard.swift|Today|Contrast'` (dropping `open|1|`).
- **Required fix:**
  Treat `[\s|,:;='"()[\]{}<>]` as token boundaries across all replacements in `publicLogLine`:
  - Strip Swift directory prefixes with `/(?:file:\/\/|~\/|\/)[^\s|,:;='"()[\]{}<>]*\/(?=[^\s/|,:;='"()[\]{}<>]+\.swift)/g`.
  - Mask `file://` URLs with `/file:\/\/[^\s|,:;='"()[\]{}<>]+/g`.
  - Mask local paths with `/(^|[\s|,:;='"()[\]{}<>])(?:~\/|\/|[A-Za-z]:\\)[^\s|,:;='"()[\]{}<>]+/g` and `/\/(?:Users|private|var|tmp|Library|Volumes|home|opt|runner)\/[^\s|,:;='"()[\]{}<>]+/g`.
  - Bound `EMAIL` in `publicLogLine` to `/[^\s@|,:;='"()[\]{}<>]+@[^\s@|,:;='"()[\]{}<>]+\.[^\s@|,:;='"()[\]{}<>]+/g`.
  - In `scripts/lib/story68-audit-failure-digest.test.mjs:237-276`, assert `assert.deepEqual(failed.issues, ['open|1|<path>|<email>|Contrast'])` and add a path-only issue fixture (`'CC68_AUDIT_ISSUE open|1|/Users/murat/project/x.png|Today|Contrast'`) asserting `['open|1|<path>|Today|Contrast']`.

### P3-1: `LONG_TOKEN` masks 40+ character XCUITest method names across callers, runs ahead of `SECRET_TEXT`, and neutralizes the 300/400-char truncation tests

- **Location:** `scripts/ci/native-ios-public-diagnostics.mjs:71-75`, `scripts/lib/story68-audit-failure-digest.test.mjs:45-56`, `scripts/lib/story68-audit-failure-digest.test.mjs:147-153`
- **Concrete failure scenario:**
  1. In `scripts/lib/story68-audit-failure-digest.test.mjs:48, 50, 149`, the line-length cap tests build 900-character lines with `'x'.repeat(900)`, `'y'.repeat(900)`, and `'z'.repeat(900)`.
     Because `LONG_TOKEN` (`/[A-Za-z0-9+/_=-]{40,}/g`) replaces any 40+ character run of letters with `'<token>'` before `masked.slice(0, limit)` runs on line 75, those 900-character fixtures shrink to `'t = 0s <token>'` (14 chars) and `'<token>'` (7 chars).
     Mutating `masked.slice(0, limit)` to `masked` (removing the length cap) leaves every test in `story68-audit-failure-digest.test.mjs` passing.
  2. Across all three `xcodebuildFailureReport` callers (`scripts/run-story68-native.mjs:1095`, `scripts/lib/story68-fallback-focus.mjs:65`, `scripts/lib/story69-share-sheet.mjs:929, 946`), `LONG_TOKEN` matches pure alphabetic camelCase XCUITest method names of 40+ characters (`testDeniedPermanentLimitedAndPendingTraversal`, `testOwnedSavingAndReopenedFinishingRestoreWatermark`, `testRasterOCRExceptionRejectsEveryNearMiss`, `testTextOCRExceptionRejectsEveryNearMiss`, `testRasterExceptionsRequirePresentExactlyLabelledPreview`, `testRemovedCommunityOpenerLeavesExistingHeaderAndPassesAllAudit`, `testSheetPresentsFromTheTopMostControllerAnchoredToShareAndClosesBackToShare`, and `testFailedShareShowsTheErrorAndMovesFocusToSave`), replacing the method name in XCTAssert failure lines with `<token>`.
  3. Because `LONG_TOKEN` (`line 71`) runs before `SECRET_TEXT.test(masked)` (`line 73`), a 40+ character token matching `SECRET_TEXT` (such as `ghp_<36_alnum>`, `sb_live_<32_alnum>`, `sk_live_<32_alnum>`, or a JWT whose header segment is at least 40 chars without a `Bearer ` prefix) is replaced with `<token>` first instead of withholding the line as `'[withheld: secret-shaped line]'`.
- **Required fix:**
  1. Evaluate `if (SECRET_TEXT.test(masked)) return '[withheld: secret-shaped line]'` before replacing `LONG_TOKEN`.
  2. Restrict `LONG_TOKEN` replacement in `publicLogLine` to tokens containing at least one digit or token symbol (`/(?=[A-Za-z0-9+/_=-]{40,})[A-Za-z0-9+/_=-]*[0-9+/_=-][A-Za-z0-9+/_=-]*/g` after splitting out `ClassName/testMethod`), preserving pure alphabetic camelCase XCUITest method names.
  3. In `scripts/lib/story68-audit-failure-digest.test.mjs:48, 50, 149`, build long lines from space-separated short words (such as `'word '.repeat(200)`) and assert `digest.lines[0].length === 300` and `issues[0].length === 400`.

## Security (`codex-security-review`)

- **Public log sanitization boundary:**
  Routing `failedAuditTestDigest`, `failedAuditIssues`, `failedAuditContext`, and `xcodebuildFailureReport` through `publicLogLine` centralizes redaction for `run-story68-native.mjs`, `story68-fallback-focus.mjs`, and `story69-share-sheet.mjs`.
  Closing **P2-1** and **P3-1** ensures paths following `|` or `[` in `CC68_AUDIT_ISSUE` and log lines cannot bypass `<path>` masking and that 40+ character secret tokens trigger line withholding before `<token>` substitution.

REVIEW-615-AUDIT-DIAG-R2-DONE
