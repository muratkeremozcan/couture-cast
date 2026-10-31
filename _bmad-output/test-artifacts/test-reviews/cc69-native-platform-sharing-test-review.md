---
workflowType: 'testarch-test-review'
runScope: 'story'
runKey: 'story-6-9'
---

# Test Quality Review: Story CC-6.9 native platform sharing

**Quality Score**: 40/100 (F - Critical Issues)
**Raw Deduction Score**: 40/100
**Score Cap**: 79/100
**Score Override Rule**: Highest severity HIGH caps effective score at 79: min(raw deduction score 40, 79) = 40.
**Review Date**: 2026-10-30
**Review Mode**: pr
**Reviewer**: Murat (TEA), non-interactive run

---

Note: This review audits existing tests; it does not generate tests.
Coverage mapping and coverage gates are out of scope here. Use `trace` for coverage decisions.
The caller asked for a gap list mapped to test-design IDs in addition to the rubric. That list is
in `## Gap List` below; it carries no score and does not change the verdict.

## Executive Summary

**Overall Assessment**: Critical Issues

**Recommendation**: Request Changes
**Verdict Rule**: any HIGH => Request Changes (12 HIGH, 0 CRITICAL)

**Context Basis**: pr_diff

**Context Waivers Applied**: 0

**Execution Mode**: subagent

Run notes:

- Branch `feat/cc69-native-platform-sharing` in `/Users/murat/opensource/couture-cast-cc69`,
  diff `185e827c..f7024d48`. Review set: every test file the diff adds or changes (filter
  `*.test.*`, `*.spec.*`, `*Test.kt`, `*Tests.swift`, `*.pacttest.ts`, `playwright/tests/*`,
  `maestro/story68/*`), plus the pact interaction and provider double files.
- Reviewed state is commit `f7024d48`. During the review another session left uncommitted edits
  in the worktree (`playwright/tests/share-card-export.spec.ts` grew from 1805 to 1861 lines,
  `apps/web/src/app/components/accessible-modal.tsx`, and a new `cc69-code-review-codex.md`).
  Those edits are not covered here; re-check G23 against them once they are committed.
- PR mode: each file was read whole; only defects this story introduced or worsened are scored.
- Execution: five parallel subagents, each owning one slice of the review set (API and
  contract; analytics and web; mobile libraries and composer; native unit and device tests;
  harness, Maestro and evidence). Each read the test design and spec, read every file in its
  slice, and ran the runnable suites. Rubric rows were assigned centrally from the registry.

### Key Strengths

✅ Breadth matches the test design: every one of the 76 test IDs has a test that exists and
runs; nothing in the catalog is absent as a whole. 1,205 automated tests in the slices were
executed in this review and all passed (see Advisory Observations).

✅ Privacy and truthfulness negatives are strong: the full 8 x 7 outcome-to-target cross product,
all 24 forbidden keys, real-SDK serialized-batch tests on both platforms with a deliberate
sanitizer failure, and near-miss mapper tables on iOS and Android.

✅ Native unit tests run in a real PR lane: 24 Swift, 5 photo-save Swift and 42 Robolectric tests
(PendingIntent at SDK 34 and 36) pass locally with the CI-pinned Gradle 8.14.3 on Java 21.

### Advisory Observations

ℹ️ Tests executed in this review, all green: API 48, api-client 204, config 24, web vitest 111,
mobile vitest 376 (slice B 45 plus slice C 331, chromium browser mode, 11.3 s for slice C),
node script suites 371, `swift test` 24 plus 5, Gradle `testDebugUnitTest` 42. Not executed by
design: Playwright, the API integration spec and pact (both fall back to 127.0.0.1:54322 or
rebuild shared outputs), Maestro, the XCUITest and the androidTest.

ℹ️ `gh run list --branch feat/cc69-native-platform-sharing` returns no runs. The device lanes
(ios-shard-1, android36-interaction) skip pull requests, so the test design exit criterion
"first main or dispatch run green with share-sheet" is still open.

ℹ️ playwright-utils is installed and `tea_use_playwright_utils` is true; 0 of 8 sampled files
outside the review set use it. Adoption has not spread past the reviewed set.

ℹ️ `apps/mobile/vitest.config.ts:141` includes `components/**` and `src/**` but not `app/**`.
A test placed beside `app/_layout.tsx` would never run, which is why the startup-sweep gap below
names a file under `src/`.

ℹ️ `apps/api/integration/share-card-export.integration.spec.ts:996` runs `seedFeatureFlags`,
which upserts every seeded flag; the `afterEach` at :852 deletes only the share flag row. No test
depends on the leftover rows today. Deleting all seeded rows in `afterEach` removes the
order coupling.

ℹ️ `apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardTestSupport.kt`
clears FileProvider's private static `sCache` by reflection. An androidx.core upgrade that renames
the field breaks every provider test; fail with a named message when the field is missing.

ℹ️ Layout assertions within 0.5 px (`share-card-composer.test.tsx:1504-1537`,
`hero-experience.test.tsx:278-288`, `expectRestingDialogFits` in the Playwright spec across three
engines) can drift with font metrics in a new browser build; 1 px tolerance is safer.

### Summary

The suite covers the story thoroughly and its privacy and truthfulness negatives are among the
strongest in the repo, yet the computed verdict is Request Changes. Twelve HIGH findings drive it:
four test files grew past 1000 lines in this story, seven fixed 20 ms real-timer waits prove
"nothing else happened" by sleeping, and one capability-privacy test can pass on an unrelated
throw. Separately from the score, the gap list names two missing P0 lease checks, several
assertions that could pass on broken code, and device lanes that have never run on this branch.

---

## Quality Criteria Assessment

| Criterion                            | Status          | Violations | Basis                                    | Notes                                                                         |
| ------------------------------------ | --------------- | ---------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| Test IDs                             | ✅ PASS         | 0          | Convention: testIds (4 of 8 sampled)     | Components use `getByTestId`/`testID`; Maestro uses ids and env copy          |
| Disabled or Focused Tests            | ✅ PASS         | 0          | Absolute                                 | No skip, only, `@Ignore` in the review set                                    |
| Hard Waits (sleep, waitForTimeout)   | ❌ FAIL         | 7          | Absolute                                 | 20 ms real-timer sleeps in composer and dialog tests                          |
| Determinism (assertions always run)  | ✅ PASS         | 0          | Absolute                                 | Fake timers for 5 s, 60 s and 750 ms bounds                                   |
| Isolation (cleanup, no shared state) | ✅ PASS         | 0          | Absolute                                 | Leftover seeded flag rows noted as advisory                                   |
| Fixture Patterns                     | ✅ PASS         | 0          | Applicability: shared setup helpers      | Boundary helpers reused across tests                                          |
| Network-First Pattern                | ✅ PASS         | 0          | Applicability: Playwright spec navigates | Routes registered before navigation                                           |
| Pact.js Utils Adoption               | ✅ PASS         | 0          | Applicability: pact consumer files       | Interactions extend the existing builders                                     |
| Explicit Assertions                  | ❌ FAIL         | 1          | Absolute                                 | Bare `.rejects.toThrow()` as the only assertion                               |
| Test Length (≤1000 lines)            | ❌ FAIL         | 4          | Absolute                                 | 1805, 1538, 1133, 1027 lines                                                  |
| Test Duration (≤1.5 min)             | ➖ Not measured | -          | Not measured                             | A static read cannot time a run                                               |
| Flakiness Patterns                   | ❌ FAIL         | 7          | Absolute                                 | Same 7 hard waits; counted once in the ledger                                 |
| Mobile Flow Patterns                 | ✅ PASS         | 0          | Applicability: Maestro flow              | No `optional: true`, no sleeps; the coordinate swipe has a justifying comment |

**Total Violations**: 0 Critical, 12 High, 0 Medium, 0 Low

**Convention Baseline**: 8 test files sampled outside the review set

Baseline detail (corpus 845 eligible files outside the review set, 8 read from the reviewed
neighborhood): priorityMarkers 0 of 8 (absent), testIds 4 of 8 (established, `getByTestId` /
`testID`), dataFactories 0 of 8 (absent), fixtures 0 of 8 (absent), playwrightUtils 0 of 8
(absent), assertionStyle 8 of 8 (established, `expect` with vitest matchers).

---

## Quality Score Breakdown

```text
Starting Score:          100
Critical Violations:     -0 × 10 = -0
High Violations:         -12 × 5 = -60
Medium Violations:       -0 × 2 = -0
Low Violations:          -0 × 1 = -0

Bonus Points:
  Comprehensive Fixtures: +0
  Data Factories:        +0
  Network-First:         +0
  Perfect Isolation:     +0
  All Test IDs:          +0
                         --------
Total Bonus:             +0

Raw Deduction Score:     40/100
Score Cap:               79/100 (HIGH)
Effective Score:         40/100
Grade:                   F
```

---

## Critical Issues (Must Fix)

No critical issues detected. ✅

---

## Recommendations (Should Fix)

### 1. Playwright share-card spec past 1000 lines

**Severity**: P1 (High)
**Location**: `playwright/tests/share-card-export.spec.ts:1`
**Row**: H5
**Provenance**: modified

**Issue**: The file was 1443 lines at the baseline and is 1805 now; the five share cases added
362 lines. Failures in one engine force a reader through unrelated 6.8 cases.

**Fix**: Move the five P-SHARE cases into `playwright/tests/share-card-native-share.spec.ts` and
add it to `playwright/share-card.config.ts` `testMatch` and to the assert-web-matrix registry.

### 2. Mobile composer test past 1000 lines

**Severity**: P1 (High)
**Location**: `apps/mobile/components/share-card-composer.test.tsx:1`
**Row**: H5
**Provenance**: introduced

**Issue**: 874 lines at the baseline, 1538 now. The C-COMP-SHARE block alone is about 600 lines.

**Fix**: Move the C-COMP-SHARE describe into `apps/mobile/components/share-card-composer.share.test.tsx`
and the shared boundary mock into a sibling helper module.

### 3. Web share dialog test past 1000 lines

**Severity**: P1 (High)
**Location**: `apps/web/src/app/components/share-card-dialog.test.tsx:1`
**Row**: H5
**Provenance**: introduced

**Issue**: 520 lines at the baseline, 1133 now.

**Fix**: Split the C-WEB-SHARE-DIALOG block into `share-card-dialog.share.test.tsx`, the same
pattern `community-lookbook-grid.*.test.tsx` already uses.

### 4. API share-card integration spec past 1000 lines

**Severity**: P1 (High)
**Location**: `apps/api/integration/share-card-export.integration.spec.ts:1`
**Row**: H5
**Provenance**: introduced

**Issue**: 798 lines at the baseline, 1027 now.

**Fix**: Move I-SHARE-AUDIT and I-SHARE-FLAG into `apps/api/integration/share-card-share.integration.spec.ts`.

### 5-8. Fixed 20 ms sleeps prove absence in the composer test

**Severity**: P1 (High)
**Location**: `apps/mobile/components/share-card-composer.test.tsx:1209` (also `:1274`, `:1331`, `:1415`)
**Row**: H1
**Provenance**: introduced

**Issue**: Each test waits a real 20 ms and then asserts that no second event or announcement
arrived. A duplicate that lands after 20 ms passes, and a slow CI worker can make the window
meaningless. Four occurrences, four findings.

**Fix**: Await the concrete settle signal (the analytics dynamic-import promise and the
settlement promise inside `act`), or run the block under `vi.useFakeTimers()` and
`await vi.runAllTimersAsync()` before the absence assertion.

### 9-11. Fixed 20 ms sleeps prove absence in the web dialog test

**Severity**: P1 (High)
**Location**: `apps/web/src/app/components/share-card-dialog.test.tsx:638` (also `:969`, `:996`)
**Row**: H1
**Provenance**: introduced

**Issue**: Capability fail-off (IO8) and superseded-attempt (IO10) absence checks rest on a 20 ms
real sleep. A parser that renders Share one tick later, or an event emitted late, passes.

**Fix**: Spy on `shareCardCapabilitiesFromWeb`, await its resolved promise inside `act`, flush
microtasks, then assert `queryByTestId('share-card-share')` is null and zero share events.

### 12. Capability privacy test passes on any throw

**Severity**: P1 (High)
**Location**: `apps/api/src/modules/share-cards/share-cards.controller.spec.ts:227`
**Row**: H10
**Provenance**: introduced

**Issue**: "never forwards anything beyond the boolean" asserts only `.rejects.toThrow()`. A
TypeError from an unrelated refactor satisfies it while an extra `cohort` field could still leak.

**Fix**: `.rejects.toMatchObject({ issues: [expect.objectContaining({ code: 'unrecognized_keys', keys: ['cohort'] })] })`,
or `.rejects.toBeInstanceOf(ZodError)` plus the key check.

---

## Gap List

Unscored. Each entry maps to (a) a test-design ID, matrix row or AC, (b) its kind, (c) the exact
file, and (d) the assertion that must exist. Ordered by the mapped priority, then impact.

### P0-mapped gaps

| #   | (a) Maps to                                                                                       | (b) Kind                            | (c) File to add or change                                                                                                                                                | (d) Assertion that must exist                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G01 | U-SHARE-LEASE "age sweep at startup"; AC4                                                         | missing                             | new `apps/mobile/src/screens/root-layout-startup.test.tsx` (mocks `@/src/lib/share-card-share` and `@/src/lib/share-card-save`, renders `@/app/_layout`)                 | After mount, `expect(sweepExpiredShareCardFiles).toHaveBeenCalledOnce()` and `expect(cleanOrphanShareCards).toHaveBeenCalledOnce()`; with the sweep `mockRejectedValue`, an `unhandledrejection` spy is never called.                                                                                                       |
| G02 | U-SHARE-LEASE "composer close keeps it"; AC4                                                      | missing                             | `apps/mobile/components/share-card-composer.test.tsx` (Android, Cancel after `shareFile` is called, then resolve `target_chosen`)                                        | After settlement: `expect(shareFiles()).toHaveLength(1)`, the delete mock never receives a `cc69-share-` URI, and `expect(nativeShareCardSavePending()).toBe(false)`.                                                                                                                                                       |
| G03 | N-AND-RECEIVE; AC1 Android                                                                        | weak (wiring)                       | `scripts/lib/story69-share-sheet.mjs` `assertShareReceiveInstrumentation`, and `scripts/lib/story69-share-sheet.test.mjs`                                                | Expected count comes from a source scan of `@Test` in `ShareCardShareReceiveTest.kt`; `OK (1 test)` throws `share_receive_android_test_failed` when 2 are expected, `OK (2 tests)` passes. Today any n >= 1 passes, so an `@Ignore` on the sibling/out-of-scope denial test is green.                                       |
| G04 | AC1 iOS (receiving side reads the previewed digest)                                               | weak                                | `apps/mobile/modules/share-card-native-share/ios/ShareCardNativeShareModule.swift` (DEBUG anchor report) and `apps/mobile/native-tests/ShareCardShareSheetUITests.swift` | The anchor report records `itemSha256` of the URL `ShareCardActivityItem.activityViewController(_:itemForActivityType: nil)` returns; the test asserts `XCTAssertTrue(anchor.itemIsFileURL)` and `XCTAssertEqual(anchor.itemSha256, previewDigest)`.                                                                        |
| G05 | N-AND-OUTCOME "host resume plus a 750 ms grace"                                                   | weak                                | `apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardShareResultTest.kt`                                        | `assertEquals(750L, ShareCardShareSession.GRACE_MS)`, and the scheduled delay in `resumeAfterTheChooserPlusGraceWithNoCallbackIsNotConfirmed` equals the literal `listOf(750L)`.                                                                                                                                            |
| G06 | N-AND-OUTCOME "teardown cancels and unregisters"                                                  | weak                                | same `ShareCardShareResultTest.kt`                                                                                                                                       | `assertNull(livePendingIntent(action, attemptId))` after settlement in `controllerSettlesNotConfirmedAfterResumeAndGrace`, `hostDestructionMidAttemptSettlesNotConfirmed` and `noResolvableChooserIsUnavailableAndOtherStartErrorsFail` (today only the callback path at :246 checks it).                                   |
| G07 | U-SHARE-OPS "late or duplicate native callbacks ignored"                                          | weak (cannot fail)                  | `apps/mobile/src/lib/share-card-save-operations.spec.ts:245-247`                                                                                                         | Replace the second `native.resolve(...)` on an already-settled Promise with a share double that fires its completion twice through the real guard; assert one settlement and exactly 2 `subscribeShareCardSave` notifications (commit, release).                                                                            |
| G08 | U-SHARE-LIB-RESULT; result model                                                                  | weak                                | `apps/mobile/src/lib/share-card-share.native.spec.ts` rejection table at :220-258 (and a source fix in `share-card-share.native.ts:94-98`)                               | iOS `{target:'unknown', outcome:'cancelled'}` and iOS `{target:'other', outcome:'failed'}` settle as failed/none `invalid_result`; `{target:'instagram', outcome:'completed', code:'native_error'}` is rejected because `code` is valid only with `failed` or `unavailable`.                                                |
| G09 | C-COMP-SHARE-GATE (404, timeout, malformed hide Share); IO8                                       | weak / flaky-risk (false green)     | `apps/mobile/components/share-card-composer.test.tsx:1021-1033`                                                                                                          | `await waitFor(() => expect(boundary.capabilities).toHaveBeenCalledOnce())`, await the settled capability promise inside `act`, then Share is absent and `share-card-save` is present.                                                                                                                                      |
| G10 | C-WEB-SHARE-DIALOG; R2 owner ruling (close after handoff keeps `handed_off`); IO4, AC3            | missing                             | `apps/web/src/app/components/share-card-dialog.test.tsx`                                                                                                                 | Hold `webShare`, click Share, press Escape (variant: toggle watermark), release; `expect(shareEvents(capture)).toEqual([{client:'web', target:'unknown', outcome:'handed_off', duration_ms: expect.any(Number), locale:'en-US'}])`, no alert, and no `sentToApp` after reopen.                                              |
| G11 | C-WEB-SHARE-DIALOG; IO10 identity change during the share prepare                                 | missing                             | `apps/web/src/app/components/share-card-dialog.test.tsx`                                                                                                                 | Hold the prepare, switch identity, release; `expect(webShare).not.toHaveBeenCalled()` and `expect(shareEvents(capture)).toEqual([])`.                                                                                                                                                                                       |
| G12 | C-WEB-SHARE-DIALOG "late capability response for the previous member is ignored"; IO10            | weak                                | `apps/web/src/app/components/share-card-dialog.test.tsx:645-689`                                                                                                         | Member two's held answer is `true`, member three's is `false`; release member two after the switch, wait for member three's answer, then `expect(screen.queryByTestId('share-card-share')).not.toBeInTheDocument()`.                                                                                                        |
| G13 | C-COMP-SHARE-ONE-EVENT, C-COMP-SHARE-IDENTITY, C-WEB-SHARE-DIALOG superseded; AC3                 | flaky-risk (false green)            | `share-card-composer.test.tsx:1209,1274,1331,1415`; `share-card-dialog.test.tsx:638,969,996`                                                                             | Same as Recommendations 5-11: absence asserted only after an awaited settle signal or `vi.runAllTimersAsync()`, never after a real sleep.                                                                                                                                                                                   |
| G14 | I-SHARE-WIRE-WEB; AC3 exact serialized shape                                                      | weak                                | `apps/web/src/analytics/browser-analytics.wire.test.ts:159-163`                                                                                                          | The share batch item's top-level keys, minus `timestamp`/`offset`, equal `['event','properties','uuid']`, and `timestamp` or `offset` is present.                                                                                                                                                                           |
| G15 | M-SHARE-\* (all 9), M-SHARE-SHEET-IOS/-ANDROID, N-IOS-PRESENTER-UI, N-AND-RECEIVE; exit criterion | not wired into PR CI; no run yet    | Dispatch `.github/workflows/pr-share-card-native.yml` on the branch                                                                                                      | `native-share-sheet-ios.json` and `native-share-sheet-android.json` exist with `passed:true` and `cases` equal to the `SHARE_SHEET_STEPS` ids plus the native case. These lanes skip PRs by design; today nothing has run.                                                                                                  |
| G16 | M-SHARE-FAILED, M-SHARE-UNAVAILABLE "focus Save"; IO5                                             | weak (Maestro cannot observe focus) | `apps/mobile/native-tests/ShareCardShareSheetUITests.swift` and `SHARE_SHEET_UITEST_MARKERS` in `scripts/lib/story69-share-sheet.mjs`                                    | New case sets `/fixture?mode=share_failed`, taps Share, waits for the error, polls `/focus-observation`: `XCTAssertEqual(focus.label, labels.save)`; prints `CC69_PRESENTER_FAILED_FOCUS_PASS`; a runner test proves a log missing that marker fails. Android device focus stays component-level only (record as accepted). |
| G17 | C-COMP-SHARE-CLOSED and C-COMP-SHARE-FAIL styling; IO4 polite, IO5 merlot                         | weak                                | `share-card-composer.test.tsx` CLOSED at :1136, FAIL at :1184                                                                                                            | CLOSED: `share-card-feedback` holds `shareClosed` and `share-card-error` is absent. FAIL: `expect(error).toHaveAttribute('role','alert')` or the merlot computed color.                                                                                                                                                     |
| G18 | M-SHARE-FAILED, M-SHARE-UNAVAILABLE                                                               | weak (low)                          | `maestro/story68/share-failed.yaml`, `maestro/story68/share-unavailable.yaml`                                                                                            | `assertNotVisible: ${MAESTRO_SHARED}` and `assertNotVisible: ${MAESTRO_SENT_TO_APP}`.                                                                                                                                                                                                                                       |

### P1-mapped gaps

| #   | (a) Maps to                                                                                      | (b) Kind                           | (c) File to add or change                                                                                                                                                         | (d) Assertion that must exist                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| G19 | U-SHARE-CTRL "`FeatureFlagsModule` resolves in `ShareCardsModule`"                               | weak                               | new `apps/api/src/modules/share-cards/share-cards.module.spec.ts`                                                                                                                 | `Test.createTestingModule({ imports: [ShareCardsModule] })` with PrismaService and the storage adapter overridden compiles; `expect(ref.get(ShareCardsService)).toBeInstanceOf(ShareCardsService)` and `expect(ref.get(FeatureFlagsService)).toBeInstanceOf(FeatureFlagsService)`. pr-tests never compiles the real graph today. |
| G20 | U-SHARE-CAP-API "nothing beyond the boolean"; IO8                                                | weak                               | `apps/api/src/modules/share-cards/share-cards.controller.spec.ts:227`                                                                                                             | See Recommendation 12.                                                                                                                                                                                                                                                                                                           |
| G21 | C-COMP-SHARE-UNAVAILABLE; AC2                                                                    | weak                               | `apps/mobile/components/share-card-composer.test.tsx:1193-1212`                                                                                                                   | After settlement `expect(screen.getByTestId('share-card-preview-loaded')).toBeInTheDocument()` and `expectSaveUsable()`.                                                                                                                                                                                                         |
| G22 | C-COMP-SHARE-STALE "focus Refresh"; IO6                                                          | weak                               | `apps/mobile/components/share-card-composer.test.tsx:100-104` (tag map) and the 6.8 409 tests that expect 43                                                                      | Give `share-card-refresh` its own tag (for example 46); `await waitFor(() => expect(boundary.focus).toHaveBeenLastCalledWith(46))`. Tag 43 is shared with Retry and Settings today.                                                                                                                                              |
| G23 | P-SHARE-CAPABILITY-OFF; IO8                                                                      | flaky-risk (false green)           | `playwright/tests/share-card-export.spec.ts`                                                                                                                                      | `await page.waitForResponse('**/api/v1/share-cards/capabilities')` plus one rAF before `await expect(first.share).toHaveCount(0)`.                                                                                                                                                                                               |
| G24 | U-SHARE-LOCALES truthfulness ("copy never claims a post was published")                          | weak                               | `apps/web/src/i18n/share-card-locales.spec.ts`, `apps/mobile/src/i18n/share-card-locales.spec.ts`                                                                                 | Per-locale denylist on `sentToApp`, `shareClosed`, `shareTapAgain`: en `/\b(posted                                                                                                                                                                                                                                               | published)\b/i`, de `/veröffentlicht | gepostet/i`, fr `/publié/i`, es and pt `/publicad/i`, it `/pubblicat/i`, tr `/yayınlandı/i`. |
| G25 | U-HARNESS-IPAD-EVIDENCE, X-IPAD-ANCHOR; AC5                                                      | weak (stale proof passes)          | `scripts/lib/story69-ipad-evidence.mjs` and `scripts/lib/story69-ipad-evidence.test.mjs`                                                                                          | Record field `presenterSourceSha256` over the sorted contents of `ShareCardNativeShareModule.swift`, `ShareCardAnchorConfiguration.swift`, `ShareCardActivityItem.swift` and `share-card-composer.tsx`; `ipadEvidenceProblems(repo)` returns `['ipad_evidence_stale']` when the recomputed digest differs.                       |
| G26 | U-PLUGIN-MANIFEST (generated manifest)                                                           | weak                               | `scripts/lib/story69-share-sheet.mjs` `runShareReceiveTest` plus a unit test in `story69-share-sheet.test.mjs`                                                                    | After the android36-interaction Gradle build, the merged `AndroidManifest.xml` has exactly one `<provider>` with authority ending `.sharecardnativeshare.fileprovider` and `exported=false`, and no `QUERY_ALL_PACKAGES`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`.                                |
| G27 | U-SHARE-LOG-PRIVACY (node scan half)                                                             | weak (passes with nothing scanned) | last test in `scripts/lib/story68-native-safety.test.mjs`                                                                                                                         | `shippedSources(root)` includes the iOS `ShareCardNativeShareModule.swift`, the Android `src/expo/.../ShareCardNativeShareModule.kt` and `ShareCardShareController.kt`, and has length >= 14; delete the stale "no native sources yet" comment.                                                                                  |
| G28 | N-IOS-PRESENTER-UI                                                                               | flaky-risk                         | `apps/mobile/native-tests/ShareCardShareSheetUITests.swift:166` and `:195-199`                                                                                                    | :166 uses the optional `read(...)` and compares against `previousFocus?.sequence ?? -1` (today it throws `timedOut` when no earlier record exists or the harness returns 404). :195 compares the anchor rect to `share.frame` captured right before `share.tap()`.                                                               |
| G29 | N-IOS-PRESENTER-UI (public card name)                                                            | weak (low)                         | `scripts/lib/story69-share-sheet.mjs:295-298` and its test                                                                                                                        | `SHARE_SHEET_UITEST_MARKERS` includes `CC69_PRESENTER_PUBLIC_NAME_PASS`; a log without it throws `share_sheet_ios_uitest_failed`.                                                                                                                                                                                                |
| G30 | N-IOS-OUTCOME `presenter_unavailable` via the 10 s presentation deadline (regression `2be1b14b`) | missing                            | extract `ShareCardPresentationWatchdog` into the Swift package; new `ios/Tests/ShareCardPresentationWatchdogTests.swift`                                                          | No presentation by the deadline settles `failed/presenter_unavailable` exactly once; a sheet that appears after it is dismissed with no second settle. `ShareCardNativeShareModule.swift` is excluded from the package, so nothing automated covers this today.                                                                  |
| G31 | N-AND-OUTCOME (host lifecycle bridge)                                                            | missing                            | move the pause/resume/destroy mapping from `android/src/expo/.../ShareCardNativeShareModule.kt` into `src/main/.../ShareCardHostLifecycle.kt`; Robolectric test beside the others | pause, resume, advance 750 ms gives `not_confirmed/none`; destroy mid-attempt gives `not_confirmed/none`. The unit-test project does not compile the Expo module today.                                                                                                                                                          |
| G32 | U-HARNESS-PR-WORKFLOW "fail on zero tests"                                                       | weak (low)                         | `.github/workflows/pr-share-native-unit.yml:91-97` and the stub cases in `scripts/ci/share-card-lanes.test.mjs`                                                                   | Gradle guard requires tests minus skipped > 0; Swift guard fails when every executed test was skipped; a stub run with all-skipped output fails.                                                                                                                                                                                 |
| G33 | N-AND-PENDINGINTENT (SDK 34 chooser)                                                             | weak (low)                         | `android/src/test/java/expo/modules/sharecardnativeshare/ShareCardPendingIntentTest.kt`                                                                                           | SDK 34 variant of `chooserWrapsOnePngSend...`: chooser carries the callback under the pre-Android-15 extra, same send, type, grant and no-text checks.                                                                                                                                                                           |
| G34 | I-SHARE-AUDIT unit leg "audit failure blocks the share"                                          | weak (low)                         | `apps/api/src/modules/share-cards/share-cards.service.spec.ts` (test labelled U-SHARE-SVC-STALE)                                                                                  | `expect(failure).toMatchObject({ status: 503, response: { code: 'render_unavailable' } })` and `expect(JSON.stringify(failure.getResponse())).not.toContain('private audit payload')`; relabel to I-SHARE-AUDIT or U-SHARE-SVC-AUTH.                                                                                             |

### P2-mapped gaps

| #   | (a) Maps to                                                        | (b) Kind      | (c) File to add or change                                                                            | (d) Assertion that must exist                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G35 | C-COMP-SHARE-A11Y "Android Back while pending keeps the operation" | weak          | `apps/mobile/components/share-card-composer.test.tsx:1390-1392` and the EdgeToEdgeModal mock at :115 | With `setOS('android')`, invoke the modal's `onRequestClose` (clicking Cancel is a different path); `expect(nativeShareCardSavePending()).toBe(true)` and `expect(boundary.shareFile).toHaveBeenCalledOnce()`. |
| G36 | U-SHARE-SANITIZER-MOBILE (internal error)                          | weak (low)    | `apps/mobile/src/config/posthog.test.ts`                                                             | A cyclic `properties` value returns null with exactly one closed-code warn.                                                                                                                                    |
| G37 | C-WEB-SHARE-DIALOG; R-007 60 s bound when timers are throttled     | missing (low) | `apps/web/src/app/components/share-card-dialog.test.tsx`                                             | Fake only `Date`, move system time past 60 s, click Share: `webShare` is not called synchronously and a second share prepare runs.                                                                             |
| G38 | M-SHARE-SHEET-IOS (real sheet dismissal)                           | flaky-risk    | `maestro/story68/share-sheet.yaml` iOS dismissal steps                                               | No new assertion; the flow fails closed. If it flakes, move real-sheet dismissal into the XCUITest (which already closes the sheet) and keep Maestro on fixture modes.                                         |

### Only provable on physical devices or a local iPad

These cannot be proven by any automated lane in this repo, on a PR or otherwise:

- **X-SHARE-DEVICE-PIN, X-SHARE-DEVICE-IG, X-SHARE-DEVICE-FB-TT** (P3, release-qa): need
  physical iOS and Android devices with Pinterest, Instagram, Facebook and TikTok installed. CI
  mapper tests only pin the documented ids; no run ever observes a real extension id or package.
  Per the test design these must be recorded before the flag is enabled beyond the dev seed.
- **X-IPAD-ANCHOR on real hardware** (P1, local): the committed record
  (`_bmad-output/test-artifacts/story-6-9/ipad-anchor-proof.json`) says
  `"environment": "simulator"`, iPadOS 26.1, commit `032c0ced`. It proves the popover anchors on
  an iPad simulator. A physical iPad popover is unproven.
- **AC1 at a third-party receiving extension on iOS**: no automated lane can read the bytes an
  installed app's share extension receives. G04 proves the item handed to UIKit; the last hop
  stays a device check.

Simulator or emulator only (provable without physical hardware, but never on a PR): all nine
M-SHARE-\* flows, N-IOS-PRESENTER-UI and N-AND-RECEIVE run on main, nightly or dispatch in
ios-shard-1 and android36-interaction. See G15.

---

## Decision

**Recommendation**: Request Changes

---

## Reviewed Files

- apps/api/integration/share-card-export.integration.spec.ts
- apps/api/src/modules/feature-flags/feature-flags.service.spec.ts
- apps/api/src/modules/share-cards/share-cards.controller.spec.ts
- apps/api/src/modules/share-cards/share-cards.service.spec.ts
- apps/mobile/components/share-card-composer.test.tsx
- apps/mobile/components/share-card-presentation.test.tsx
- apps/mobile/modules/accessibility-focus/android/src/androidTest/java/expo/modules/accessibilityfocus/ShareCardComposerTalkBackTest.kt
- apps/mobile/modules/share-card-native-share/android/src/androidTest/java/expo/modules/sharecardnativeshare/ShareCardReceiveTestActivity.kt
- apps/mobile/modules/share-card-native-share/android/src/androidTest/java/expo/modules/sharecardnativeshare/ShareCardShareReceiveTest.kt
- apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardFileProviderTest.kt
- apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardPendingIntentTest.kt
- apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardShareFilesTest.kt
- apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardShareResultTest.kt
- apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardTargetMapperTest.kt
- apps/mobile/modules/share-card-native-share/android/src/test/java/expo/modules/sharecardnativeshare/ShareCardTestSupport.kt
- apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardActivityTargetTests.swift
- apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardAnchorConfigurationTests.swift
- apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardShareFileTests.swift
- apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardShareMetadataTests.swift
- apps/mobile/modules/share-card-native-share/ios/Tests/ShareCardShareOutcomeTests.swift
- apps/mobile/modules/share-card-photo-save/ios/Tests/ShareCardPhotoSaveTests.swift
- apps/mobile/native-tests/ShareCardShareSheetUITests.swift
- apps/mobile/plugins/with-share-card-permissions.test.js
- apps/mobile/src/analytics/mobile-analytics.test.tsx
- apps/mobile/src/analytics/track-events.test.ts
- apps/mobile/src/config/posthog.test.ts
- apps/mobile/src/config/posthog.wire.test.ts
- apps/mobile/src/i18n/share-card-locales.spec.ts
- apps/mobile/src/lib/share-card-native-fixture.spec.ts
- apps/mobile/src/lib/share-card-save-operations.spec.ts
- apps/mobile/src/lib/share-card-save.native.spec.ts
- apps/mobile/src/lib/share-card-share.native.spec.ts
- apps/mobile/src/lib/share-cards.spec.ts
- apps/mobile/src/screens/hero-experience.test.tsx
- apps/web/src/analytics/browser-analytics.test.ts
- apps/web/src/analytics/browser-analytics.wire.test.ts
- apps/web/src/app/components/share-card-dialog.test.tsx
- apps/web/src/i18n/share-card-locales.spec.ts
- apps/web/src/lib/share-cards.test.ts
- maestro/story68/share-chosen.yaml
- maestro/story68/share-closed.yaml
- maestro/story68/share-completed.yaml
- maestro/story68/share-failed.yaml
- maestro/story68/share-not-confirmed.yaml
- maestro/story68/share-other.yaml
- maestro/story68/share-sheet.yaml
- maestro/story68/share-unavailable.yaml
- maestro/story68/tap-share.yaml
- packages/api-client/testing/share-card-analytics.spec.ts
- packages/api-client/testing/share-cards-client.spec.ts
- packages/api-client/testing/share-cards-contract.spec.ts
- packages/config/src/flags.spec.ts
- pact/http/consumer/interactions/share-cards.ts
- pact/http/consumer/interactions/shared.ts
- pact/http/consumer/mobile-api-client.pacttest.ts
- pact/http/consumer/web-api-client.pacttest.ts
- pact/http/provider/doubles/share-cards.ts
- pact/http/provider/state-handlers.ts
- playwright/tests/share-card-export.spec.ts
- scripts/ci/native-ios-shards.test.mjs
- scripts/ci/share-card-android.test.mjs
- scripts/ci/share-card-lanes.test.mjs
- scripts/e2e-share-card/assert-web-matrix.test.mjs
- scripts/e2e-share-card/public-evidence.test.mjs
- scripts/lib/story68-flow-timeouts.test.mjs
- scripts/lib/story68-native-safety.test.mjs
- scripts/lib/story68-talkback-composer-test-source.test.mjs
- scripts/lib/story69-ipad-evidence.test.mjs
- scripts/lib/story69-share-sheet.test.mjs

## Review Context

- \_bmad-output/implementation-artifacts/spec-6-9-native-platform-sharing.md
- \_bmad-output/test-artifacts/test-design/cc69-native-platform-sharing-test-design.md
- \_bmad-output/test-artifacts/story-6-9/ipad-anchor-proof.json
- \_bmad-output/test-artifacts/story-6-9/README.md
- .github/workflows/pr-share-native-unit.yml
- .github/workflows/pr-share-card-native.yml
- packages/api-client/src/testing/analytics-event-assertions.ts
- scripts/lib/story69-share-sheet.mjs
- scripts/lib/story69-ipad-evidence.mjs
- scripts/ci/native-ios-shards.mjs
- scripts/ci/share-card-android.sh
- scripts/e2e-share-card/assert-web-matrix.mjs
- apps/mobile/vitest.config.ts
- apps/mobile/src/lib/share-card-share.native.ts
- apps/mobile/components/share-card-composer.tsx
- apps/web/src/app/components/share-card-dialog.tsx
- apps/api/src/modules/share-cards/share-cards.controller.ts
- apps/api/src/modules/share-cards/share-cards.service.ts
