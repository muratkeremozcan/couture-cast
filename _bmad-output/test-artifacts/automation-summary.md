---
stepsCompleted:
  [
    'step-01-preflight-and-context',
    'step-02-identify-targets',
    'step-03c-aggregate',
    'step-04-validate-and-summarize',
  ]
lastStep: 'step-04-validate-and-summarize'
lastSaved: '2026-07-27'
workflowType: 'testarch-automate'
mode: 'bmad-integrated'
detectedStack: 'fullstack'
inputDocuments:
  - '_bmad-output/project-context.md'
  - '_bmad-output/implementation-artifacts/3-4-watchos-glance.md'
  - '_bmad-output/test-artifacts/test-design-system.md'
  - '_bmad-output/test-artifacts/test-review.md'
  - 'apps/mobile/vitest.config.ts'
  - 'playwright.config.ts'
  - 'apps/mobile/package.json'
  - 'package.json'
  - '.agents/skills/bmad-testarch-automate/resources/tea-index.csv'
---

# Automation summary: Story 3.4 watchOS glance

## Preflight and context

The repository has complete automation scaffolding for the requested expansion:

- Vitest browser tests for React Native mobile behavior.
- Node test suites for Expo config-plugin generation.
- Swift compiler and Xcode build validation on macOS.
- Maestro mobile flows and a documented manual watchOS validation path.
- Playwright and Pact infrastructure for adjacent web and contract boundaries.

The run is BMAD-integrated. Story 3.4 supplies six acceptance criteria and the system
test design supplies the mobile device strategy. The test review identifies the concrete
automation targets: symmetric cleanup, reusable native fixtures, direct native behavior
coverage, watchOS UI coverage, and macOS CI execution.

No browser URL exists for the watchOS surface. Playwright API guidance remains available
for repository context, while native Xcode and simulator tooling provide the primary
evidence for this workflow.

## Coverage plan

No Story 3.4 ATDD artifact exists. Existing tests already cover payload serialization,
pure watch model behavior, Expo generation, mobile deep-link hydration, and native
compilation. The expansion avoids duplicating those assertions.

| Priority | Level              | Target                                                                | Evidence                                                                        |
| -------- | ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| P0       | Native unit        | iOS local writes survive watch transfer failures                      | Test an injectable transfer coordinator and preserve local-write ordering       |
| P0       | Native unit        | Watch payload parsing, ordering, persistence, and timeline reload     | Test the production payload-processing collaborator with in-memory dependencies |
| P0       | CI                 | All native checks execute on pull requests                            | Required macOS job running generated native tests and build validation          |
| P1       | Native UI          | Now and next-hour watch pages render and swipe                        | Generated watchOS UI-test target with deterministic launch payload              |
| P1       | Native unit        | Watch handoff queues, sends, and falls back                           | Injected transport tests for reachable and unreachable sessions                 |
| P1       | Config integration | Test targets and all shared bridge sources are generated idempotently | Node project inspection plus Xcode compilation                                  |
| P2       | Browser unit       | Storage, timers, environment, and auth state clean up symmetrically   | Vitest teardown assertions through stable suite behavior                        |
| P2       | Test architecture  | Native fixture setup and repeated deep-link scenarios are concise     | Shared fixture harness and table-driven cases                                   |
| P3       | Native unit        | Swift scenario failures identify the behavior under test              | Named scenario functions and conventional helper names                          |

### Acceptance-criteria mapping

| Acceptance criterion                  | Existing evidence                                | Expansion                                                             |
| ------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| AC1 watch app and swipe layout        | Swift source type check and WatchApp build       | Deterministic watchOS UI test for both pages                          |
| AC2 WatchConnectivity synchronization | Projection, queue, and generated-source checks   | Transfer failure, persistence, reload, and handoff collaborator tests |
| AC3 complications                     | Generated target, families, resources, and build | Preserve compile coverage; trace manual family rendering separately   |
| AC4 haptics and quiet hours           | Pure quiet-hours and active-alert behavior       | Payload processor event tests with injected alert callback            |
| AC5 phone handoff                     | URL validation and mobile hydration              | Reachability and transfer fallback tests                              |
| AC6 tests and documentation           | Swift executables, Xcode build, local guide      | Generated XCTest targets, UI test, and required macOS CI              |

Browser exploration is skipped because the target has no web URL. Contract tests are
also excluded because Story 3.4 does not add or change a provider endpoint. A Provider
Endpoint Map is therefore not applicable.

## Generated automation

The parallel generation workers completed successfully:

- API worker: zero tests because Story 3.4 has no provider boundary.
- Native behavior worker: 15 scenarios in
  `apps/mobile/targets/watchos/WatchConnectivityBehaviorTests.swift`.
- Native UI worker: one wrist journey in
  `apps/mobile/targets/watchos/WatchAppUITests.swift`.

Priority coverage totals seven P0 scenarios and nine P1 scenarios.

### Production test seams

The aggregation added Foundation-only coordinators and narrow platform protocols:

- `WidgetPayloadWriteCoordinator` preserves the local widget write when watch transport
  fails.
- `WidgetWatchTransferCoordinator` owns payload projection, latest-value queuing,
  activation draining, application-context recovery, and complication transfer budgets.
- `WatchPayloadProcessor` owns decode, duplicate and ordering checks, verified persistence,
  publication, timeline reload, quiet hours, and severe-alert delivery.
- `WatchHandoffCoordinator` owns immediate messages, durable fallback, activation, and
  latest-value handoff queuing.

The UIKit, WidgetKit, WatchKit, UserNotifications, and WatchConnectivity APIs remain in
thin production adapters.

### Native test infrastructure

The Expo watchOS plugin now generates idempotent `WatchAppTests` and `WatchAppUITests`
targets. It copies all support sources, gives each source explicit target membership,
links XCTest, adds WatchApp target dependencies, and writes the shared
`WatchAppTests.xcscheme`.

The UI launch seam requires `-CoutureCastWatchUITestMode` and reads a deterministic
payload from `COUTURECAST_WATCH_UI_TEST_PAYLOAD`. That mode suppresses session activation.
Stable accessibility identifiers cover every asserted Now and Next Hour element.

The existing native compiler harness now includes the 15 connectivity scenarios. Xcode
compilation covers both generated test bundles without requiring a locally installed
watchOS simulator runtime. Runtime execution and result-bundle retention are handled by
the macOS CI expansion in the next workflow phase.

## Validation

Command:

```text
npm run test:watchos-prebuild --workspace mobile
```

The focused Node run completed in 23.05 seconds:

- 2 Node subtests passed.
- 15 new WatchConnectivity behavior scenarios compiled and passed.
- Existing watch model and transfer-support executables compiled and passed.
- Expo prebuild completed twice to verify idempotence.
- The generated WatchApp target built for the generic watchOS simulator.
- The generated WatchAppTests and WatchAppUITests targets passed Xcode compilation.

The local Xcode installation has no watchOS simulator runtime, so the XCUITest compiled
without executing locally. The required macOS CI job owns runtime execution and retains
the `.xcresult` bundle.

## Files created or expanded

- `apps/mobile/targets/watchos/WatchConnectivityBehaviorTests.swift`
- `apps/mobile/targets/watchos/WatchAppUITests.swift`
- `apps/mobile/targets/watchos/WatchConnectivitySupport.swift`
- `apps/mobile/targets/widgets/WatchSyncSupport.swift`
- `apps/mobile/targets/widgets/WidgetSharedModule.swift`
- `apps/mobile/targets/watchos/WatchConnectivityManager.swift`
- `apps/mobile/targets/watchos/WatchContentView.swift`
- `apps/mobile/targets/watchos/WatchApp.swift`
- `apps/mobile/targets/watchos/WatchWidgetDataTests.swift`
- `apps/mobile/plugins/with-watchos.js`
- `apps/mobile/plugins/with-watchos.test.js`

## Definition of done

- [x] Story 3.4 acceptance criteria mapped to existing and expanded evidence.
- [x] P0 and P1 native behavior gaps automated without provider-test duplication.
- [x] Deterministic launch data and stable accessibility identifiers added.
- [x] Production seams remain Foundation-only and platform adapters remain thin.
- [x] Generated Xcode targets and scheme are idempotent.
- [x] Generated native tests compile and all locally executable scenarios pass.
- [x] No hard waits, shared mutable test state, browser sessions, or retained temp output.
- [ ] Execute the XCUITest on a concrete watchOS simulator in required macOS CI.

The next workflow is `bmad-testarch-ci`, followed by `bmad-testarch-trace` after all
browser and native checks pass.
