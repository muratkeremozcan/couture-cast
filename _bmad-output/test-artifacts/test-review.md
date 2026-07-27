---
stepsCompleted:
  [
    'step-01-load-context',
    'step-02-discover-tests',
    'step-03f-aggregate-scores',
    'step-04-generate-report',
  ]
lastStep: 'step-04-generate-report'
lastSaved: '2026-07-27'
workflowType: 'testarch-test-review'
reviewScope: 'directory'
detectedStack: 'fullstack'
inputDocuments:
  - '_bmad-output/project-context.md'
  - '_bmad-output/implementation-artifacts/3-4-watchos-glance.md'
  - 'apps/mobile/vitest.config.ts'
  - 'apps/mobile/package.json'
  - 'package.json'
  - '.github/workflows/pr-checks.yml'
  - '.agents/skills/bmad-testarch-test-review/resources/tea-index.csv'
---

<!-- markdownlint-disable MD013 -->

# Test quality review: Story 3.4 watchOS glance

**Mechanical quality score**: 69/100, grade D, needs improvement
**Review date**: 2026-07-27
**Review scope**: Story 3.4 mobile and native test directory set
**Reviewer**: Murat, Test Architect
**Recommendation**: Request changes

This workflow audits existing tests. Coverage mapping and coverage gates are outside its
scope. Use the trace workflow for acceptance-criteria coverage and a release-gate
decision.

## Executive summary

The Story 3.4 tests are deterministic, fast, and unusually strong at native generation
validation. The suite runs a real Expo prebuild twice, parses the generated Xcode
project, compiles native Swift behavior executables, type-checks watchOS sources, and
builds the generated WatchApp target for a simulator. All reviewed tests pass locally.

One merge risk remains: the PR quality gate runs on Ubuntu, while the native Swift
executables, watchOS type checks, and generated WatchApp build run only on macOS. No
other workflow supplies that macOS evidence. A pull request can therefore pass while
the native watch implementation fails to compile.

The parallel quality workers also reported maintainability and cleanup concerns. Some
high-severity isolation and performance findings are contained or justified by the
actual framework configuration:

- Vitest 4 defaults to per-file isolation. The shared i18n module, environment override,
  and token resolver do not leak into another test file under the current configuration.
- Repeating the real Expo prebuild directly verifies plugin idempotency. That check
  protects the exact class of duplicate Xcode-linking regression fixed in this story.
- The repeated prebuild completes within 13.04 seconds. It is far below the 90-second
  test-quality target.

These dispositions do not change the workflow's required mechanical score. They do
change the remediation priority.

### Key strengths

- Fixed clocks, explicit timestamps, deterministic payloads, and condition-based UI
  waits produced a 100/100 determinism score.
- Temporary native projects are isolated with unique directories and guaranteed
  teardown.
- Assertions inspect target embedding, resources, entitlements, source membership,
  payload compatibility, quiet hours, alert behavior, and deep-link analytics.
- The test suite exercises generated native output instead of relying only on source
  snapshots.
- All targeted tests passed with no retries, hard waits, or intermittent failures.

### Key weaknesses

- Native watchOS evidence is absent from pull-request CI.
- The config-plugin suites duplicate fixture setup and combine several responsibilities
  in long test bodies.
- Two browser tests clean storage only before the next test, instead of cleaning the
  state they create.
- Deep-link hydration cases repeat the same setup and assertion flow.
- No Story 3.4 test-design artifact assigns test IDs or P0 through P3 priorities.

## Execution evidence

| Command                    | Result                   | Duration |
| -------------------------- | ------------------------ | -------: |
| Story 3.4 Vitest selection | 5 files, 18 tests passed |   2.38 s |
| `test:widget-prebuild`     | 1 test passed            |   2.45 s |
| `test:watchos-prebuild`    | 2 tests passed           |  13.04 s |

The watchOS command completed both native behavior executables, both watchOS source
type checks, and the generated simulator-target build on macOS.

## Test inventory

Nine files are in scope. They contain 21 JavaScript or TypeScript cases plus two native
Swift behavior executables.

| File                                                      | Framework        | Lines | Tests | Assertions |
| --------------------------------------------------------- | ---------------- | ----: | ----: | ---------: |
| `apps/mobile/plugins/with-watchos.test.js`                | Node test        |   324 |     2 |         44 |
| `apps/mobile/plugins/with-widgets.test.js`                | Node test        |   159 |     1 |         30 |
| `apps/mobile/src/lib/background-fetch.test.ts`            | Vitest           |    19 |     3 |          4 |
| `apps/mobile/src/lib/ritual-cache.test.ts`                | Vitest           |    58 |     2 |          3 |
| `apps/mobile/src/lib/widget-alert-preferences.test.ts`    | Vitest           |    43 |     2 |          3 |
| `apps/mobile/src/lib/widget-share.test.ts`                | Vitest           |   152 |     5 |         21 |
| `apps/mobile/src/screens/widget-deep-link.test.tsx`       | Vitest browser   |   174 |     6 |         15 |
| `apps/mobile/targets/watchos/WatchWidgetDataTests.swift`  | Swift executable |   100 |     1 |         10 |
| `apps/mobile/targets/widgets/WatchSyncSupportTests.swift` | Swift executable |    48 |     1 |          7 |

Aggregate assertion count is 137. No test IDs or priority markers are present.

## Quality criteria

| Criterion                   | Status |   Findings | Notes                                                         |
| --------------------------- | ------ | ---------: | ------------------------------------------------------------- |
| Behavior-readable structure | Pass   |          0 | Test names state observable behavior                          |
| Test IDs                    | Warn   |         23 | No Story 3.4 IDs                                              |
| Priority markers            | Warn   |         23 | No P0 through P3 classification                               |
| Hard waits                  | Pass   |          0 | No sleeps or fixed UI waits                                   |
| Determinism                 | Pass   |          0 | Fixed clocks and stable synthetic data                        |
| Isolation                   | Warn   |      5 raw | Two cleanup improvements remain; three findings are contained |
| Fixture patterns            | Warn   |          1 | Native prebuild setup is duplicated                           |
| Data factories              | Pass   |          0 | Shared ritual data and explicit native fixtures are suitable  |
| Network-first pattern       | N/A    |          0 | No Playwright page navigation exists in scope                 |
| Explicit assertions         | Pass   |          0 | 137 focused assertions                                        |
| Test length                 | Warn   |          1 | One file is 324 lines; its longest case is 223 lines          |
| Test duration               | Pass   |          0 | Longest suite is 13.04 seconds                                |
| Flakiness patterns          | Warn   | 1 unscored | Native validation depends on a macOS runner absent from CI    |

### Weighted dimension scores

| Dimension       |   Weight |  Score | Grade |
| --------------- | -------: | -----: | :---: |
| Determinism     |      30% |    100 |   A   |
| Isolation       |      30% |     65 |   D   |
| Maintainability |      25% |     30 |   F   |
| Performance     |      15% |     80 |   B   |
| **Overall**     | **100%** | **69** | **D** |

The workers returned 15 mechanical findings: 10 high and 5 medium. The macOS CI gap
was found during integration review and is recorded separately from that score.

## Must address before merge

### 1. Run native watchOS validation in pull-request CI

**Severity**: P1
**Locations**:

- `.github/workflows/pr-checks.yml:24`
- `apps/mobile/plugins/with-watchos.test.js:200`
- `apps/mobile/plugins/with-watchos.test.js:269`

**Criterion**: Environment-complete execution

The quality gate uses `ubuntu-latest`. The watchOS suite deliberately skips Swift
behavior compilation on non-macOS systems and wraps Xcode type checks and builds in a
Darwin condition. The current CI result therefore proves JavaScript generation and
project-file assertions only.

Add a separate macOS job that runs the native watchOS prebuild command:

```yaml
watchos-native:
  runs-on: macos-latest
  steps:
    - uses: actions/checkout@v4
    - uses: ./.github/actions/setup-node-env
      with:
        use-npm-ci: 'false'
    - run: npm run test:watchos-prebuild --workspace mobile
```

Pin the Xcode version if the generated project depends on a specific SDK. Keep this job
required for changes to watchOS targets, widget bridges, config plugins, app
configuration, or mobile package metadata.

**Why this matters**: Apple toolchains are the only environment that can compile the
WatchConnectivity and WidgetKit code. A green Linux gate currently provides no native
compile guarantee.

## Recommended improvements

### 1. Make browser storage cleanup symmetric

**Severity**: P2
**Locations**:

- `apps/mobile/src/lib/ritual-cache.test.ts:10`
- `apps/mobile/src/lib/widget-share.test.ts:16`

Both suites clear local storage before a case. The final or individually filtered case
can leave state in the browser page. Clean the state after each case as well:

```typescript
afterEach(() => {
  localStorage.clear()
  clearRitualMemoryCache()
  vi.useRealTimers()
})
```

Keep only the functions each suite uses. Symmetric cleanup makes filtered runs and
future changes safer.

### 2. Extract a shared Expo prebuild fixture harness

**Severity**: P2
**Locations**:

- `apps/mobile/plugins/with-watchos.test.js:13`
- `apps/mobile/plugins/with-widgets.test.js:12`

Both suites copy the same fixture directories, link `node_modules`, mutate
entitlements, run Expo, and remove the temporary project. Move that lifecycle into a
small test helper that returns the fixture path and command result.

Keep each test's generated project independent. Share harness code, rather than a
mutable generated project, so parallel safety remains intact.

### 3. Split native assertions by responsibility

**Severity**: P2
**Locations**:

- `apps/mobile/plugins/with-watchos.test.js:43`
- `apps/mobile/plugins/with-widgets.test.js:18`

Use suite grouping and helper assertions for:

1. Target generation and embedding.
2. Source and resource membership.
3. Entitlement merging.
4. Native compilation and simulator build.
5. Android widget generation.
6. Localization fallback parity.

The real prebuild can remain in a suite-level fixture. Focused assertion helpers will
produce shorter failure messages and reduce the chance that future changes overlook a
target concern.

### 4. Convert repeated deep-link hydration cases to a scenario table

**Severity**: P2
**Location**: `apps/mobile/src/screens/widget-deep-link.test.tsx:57`

The `now`, `next`, and watch handoff cases repeat parameter assignment, rendering,
hydration waiting, and analytics validation. A typed case table can keep the distinct
expectations visible while centralizing the flow.

Retain separate cases for malformed input and route changes while mounted. They exercise
different branches.

### 5. Name Swift behavior scenarios

**Severity**: P3
**Locations**:

- `apps/mobile/targets/watchos/WatchWidgetDataTests.swift:11`
- `apps/mobile/targets/watchos/WatchWidgetDataTests.swift:91`

Extract functions such as `verifyLegacyDecoding`, `verifyStaleness`,
`verifyQuietHours`, and `verifyPayloadOrdering`. Rename `XCTimestamp` to
`requireTimestamp`. This gives failures a clear behavioral location and avoids a name
that resembles XCTest.

## Contextual disposition of mechanical findings

| Mechanical finding                        | Disposition      | Rationale                                                                          |
| ----------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| i18n singleton persists after `beforeAll` | Accepted         | Vitest defaults to isolated test-file environments                                 |
| API base URL is not restored              | P3 hygiene       | Vitest contains file-to-file environment mutation; `vi.stubEnv` would state intent |
| Token resolver is not reset               | P3 hygiene       | It is set in every case and the module graph is isolated per file                  |
| Watch prebuild runs twice                 | Accepted         | Repetition is the direct idempotency regression test                               |
| Widget suite repeats iOS generation       | Accepted for now | The suite independently validates all-platform output in 2.45 seconds              |
| Prebuild test bodies are long             | P2               | Runtime is healthy; structure and failure localization can improve                 |

Vitest's official guidance supports `vi.stubEnv` with `vi.unstubAllEnvs` when a suite
wants explicit environment restoration. The current `restoreMocks: true` configuration
already restores spies between cases.

## Best practices found

### Deterministic time control

`widget-share.test.ts` uses fake timers and fixed timestamps. The deep-link suite spies
on `Date.now` with a fixed instant. Time-sensitive behavior therefore has reproducible
results.

### Condition-based asynchronous assertions

`widget-deep-link.test.tsx` waits for observable content and analytics state. It does
not use arbitrary sleeps.

### Self-cleaning native fixtures

Both config-plugin suites use unique temporary directories and register teardown before
generation starts. A failed assertion still removes generated native projects.

### Real idempotency and native-build validation

`with-watchos.test.js` repeats Expo prebuild, parses the generated project, compiles the
Swift behavior tests, type-checks watchOS code against the watchOS SDK, and builds the
generated WatchApp target. This is a strong regression boundary for a generated native
project.

## Coverage candidates for the trace workflow

These are unscored because test-review does not perform requirements traceability:

1. Verify `WatchSyncSupport.swift` is copied into the generated iOS app and linked in
   the main target. The widget prebuild test currently asserts only
   `WidgetSharedModule.m` and `WidgetSharedModule.swift`.
2. Exercise the actual WatchConnectivity delegate behavior around activation,
   unreachable peers, malformed payloads, persistence, and timeline reloads.
3. Add a watchOS unit-test target for native behavior and a watchOS UI-test target for
   glance layout, Dynamic Type, localization, alert affordances, complications, and
   phone handoff.
4. Run an app-to-watch simulator flow that writes a real payload through the bridge and
   observes the watch app or complication.

Apple documents watchOS unit-test and UI-test bundles as the supported path for direct
behavior and interaction testing. The current Swift executables cover pure logic well,
while the framework integration and rendered watch experience still depend on manual
validation.

## Related artifacts

- [Story 3.4 watchOS glance](../implementation-artifacts/3-4-watchos-glance.md)
- No Story 3.4-specific test-design document was found.
- [Project context](../project-context.md)

## Knowledge and official references

- [Test quality](../../.agents/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md)
- [Fixture architecture](../../.agents/skills/bmad-testarch-test-review/resources/knowledge/fixture-architecture.md)
- [Data factories](../../.agents/skills/bmad-testarch-test-review/resources/knowledge/data-factories.md)
- [Test levels](../../.agents/skills/bmad-testarch-test-review/resources/knowledge/test-levels-framework.md)
- [Selective testing](../../.agents/skills/bmad-testarch-test-review/resources/knowledge/selective-testing.md)
- [Timing debugging](../../.agents/skills/bmad-testarch-test-review/resources/knowledge/timing-debugging.md)
- [Vitest mocking and environment guidance](https://vitest.dev/guide/mocking.html)
- [Expo config-plugin development and debugging](https://docs.expo.dev/config-plugins/development-and-debugging/)
- [Apple watchOS test setup](https://developer.apple.com/documentation/watchos-apps/setting-up-tests-for-your-watchos-app)
- [Apple WatchConnectivity session guidance](https://developer.apple.com/documentation/watchconnectivity/wcsession)
- [GitHub Actions runner guidance](https://docs.github.com/en/actions/get-started/understand-github-actions)

Playwright supports the Vitest browser provider in this scope. There is no browser URL
or web navigation path for the watch experience, so standalone Playwright inspection
would provide weak evidence. Cypress, Pact, k6, pytest, JUnit, and Go test do not
participate in Story 3.4's execution path.

## Decision and next steps

**Recommendation**: Request changes

Add required macOS execution for `test:watchos-prebuild` before merge. The test source
is deterministic and currently green, yet the existing pull-request gate cannot prove
the native implementation compiles.

After that gate exists:

1. Apply the symmetric storage cleanup.
2. Run the trace workflow to map Story 3.4 acceptance criteria to automated and manual
   evidence.
3. Use the automate workflow for the missing WatchConnectivity and watchOS UI layers.
4. Refactor the prebuild harness and deep-link scenario duplication as a focused test
   maintenance change.

A focused re-review is needed after the macOS gate is added.
