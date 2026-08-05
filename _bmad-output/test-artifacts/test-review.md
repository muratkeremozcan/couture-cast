---
stepsCompleted:
  [
    'step-01-load-context',
    'step-02-discover-tests',
    'step-03f-aggregate-scores',
    'step-04-generate-report',
  ]
lastStep: 'step-04-generate-report'
lastSaved: '2026-08-05T18:31:00Z'
workflowType: 'testarch-test-review'
reviewMode: 'create'
inputDocuments:
  - _bmad-output/implementation-artifacts/4-2-smart-tagging-comfort-metadata.md
  - _bmad-output/project-context.md
  - _bmad-output/test-artifacts/test-design-system.md
  - _bmad-output/test-artifacts/testing-standards.md
  - playwright/config/base.config.ts
  - playwright/config/local.config.ts
  - playwright/config/environments.ts
  - playwright/support/fixtures/merged-fixtures.ts
  - _bmad/tea/config.yaml
  - .agents/skills/bmad-testarch-test-review/resources/tea-index.csv
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/data-factories.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/test-levels-framework.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/selective-testing.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/test-healing-patterns.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/selector-resilience.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/timing-debugging.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/overview.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/api-request.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/network-recorder.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/auth-session.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/intercept-network-call.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/recurse.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/log.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/file-utils.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/burn-in.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/network-error-monitor.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/fixtures-composition.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/playwright-cli.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/pactjs-utils-overview.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/pactjs-utils-consumer-helpers.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/pactjs-utils-provider-verifier.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/pactjs-utils-request-filter.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/pact-consumer-di.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/pact-consumer-framework-setup.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/pact-broker-webhooks.md
  - .agents/skills/bmad-testarch-test-review/resources/knowledge/pact-mcp.md
---

<!-- markdownlint-disable MD013 -->

# Test quality review: Story 4.2 smart tagging and comfort metadata

## Context

- Scope: all tests added or changed for Story 4.2 across database, shared contracts, API,
  Pact, Web, Mobile, Playwright, and Maestro.
- Stack: Prisma and PostgreSQL, NestJS and Vitest, React and React Native Testing Library,
  generated TypeScript clients, Pact JS, Playwright Test, axe, and Maestro.
- Acceptance surface: eight criteria covering background inference, authorization, strict
  contracts, confirmation, concurrency, telemetry, cache consistency, Ritual eligibility,
  accessible Web and Mobile flows, persistence, and recovery.
- Test framework: Playwright uses the repository merged fixture with authentication,
  `apiRequest`, schema validation, request interception, network recording, network error
  monitoring, structured logging, file utilities, and `recurse` polling.
- Project policy: browser specs must import the merged fixture. Persisted fixtures require
  cleanup. Assertions must be deterministic and user-facing flows must avoid hard waits.
- Utility configuration: `_bmad/tea/config.yaml` enables Playwright Utils and Pact.js Utils.

## Initial assessment

The implementation has broad test-layer coverage and previously passed the full delivery gate.
The new `wardrobe-smart-tagging.spec.ts` imports the merged fixture, yet uses Playwright's raw
`request` fixture for account setup and API verification. The first remediation target is to use
the composed `apiRequest` fixture and `recurse` where eventual worker state needs polling. The
remaining review will verify isolation, cleanup, acceptance coverage, assertion quality,
contract realism, accessibility, localization, deterministic timing, and hidden false-positive
paths across every changed test.

## Authoritative references

- Playwright fixtures and API request contexts: current official Playwright documentation.
- Pact consumer, provider, and provider-state practices: current official Pact documentation.
- Repository standards and BMAD Test Architect knowledge fragments listed in the frontmatter.

## Test discovery

The changed Story 4.2 suite contains 3,860 lines across 17 executable test files and one Maestro
flow. Vitest discovers 104 tests across the API, Web, Mobile, database, shared contract, and Web
Pact files. Playwright discovers one Chromium system test. The Maestro artifact defines one native
flow for both supported platforms.

| Artifact                              | Lines | Framework                  | Tests | Main metadata                                                      |
| ------------------------------------- | ----: | -------------------------- | ----: | ------------------------------------------------------------------ |
| `fashion-clip-tagging.engine.spec.ts` |    15 | Vitest                     |     2 | Filesystem fixture paths; no shared factory                        |
| `garment-tagging.engine.spec.ts`      |   135 | Vitest                     |     8 | Inline classification inputs; environment restoration in `finally` |
| `garment-tagging.smoke.spec.ts`       |    49 | Vitest                     |     1 | Real model and image fixture; filesystem reads                     |
| `wardrobe-color.processor.spec.ts`    |   150 | Vitest                     |     5 | Prisma, storage, and engine mocks                                  |
| `wardrobe.controller.spec.ts`         |   105 | Vitest                     |     5 | Controller calls with service mocks                                |
| `wardrobe.service.regression.spec.ts` |   564 | Vitest                     |    15 | Shared garment factory plus upload and service doubles             |
| `wardrobe.service.spec.ts`            |   220 | Vitest                     |     6 | Inline Prisma transaction and dependency doubles                   |
| Mobile tagging modal test             |   110 | Vitest and Testing Library |     2 | Inline contract fixtures and injected API functions                |
| Mobile locale parity spec             |    31 | Vitest                     |     1 | Ten locale catalogs and recursive key comparison                   |
| Web capture modal test                |   118 | Vitest and Testing Library |     5 | User Event, media and canvas doubles                               |
| Web tagging modal test                |   104 | Vitest and Testing Library |     3 | User Event and injected API functions                              |
| Web wardrobe page test                |    85 | Vitest and Testing Library |     1 | Hoisted API mocks and rerender hydration                           |
| Shared wardrobe contract spec         |   315 | Vitest                     |    14 | Local builders, Zod schemas, OpenAPI, transport doubles            |
| Garment schema spec                   |    62 | Vitest                     |     4 | Static Prisma and SQL text inspection                              |
| RLS policy spec                       | 1,507 | Vitest and PostgreSQL      |    25 | Real database, seeded actors, cleanup guards                       |
| Web API consumer pact                 |    61 | Vitest and Pact V4         |     8 | One interaction helper per test; real generated client             |
| Smart-tagging browser spec            |   116 | Playwright Test            |     1 | Merged fixtures, raw `request`, axe, keyboard, worker polling      |
| Smart-tagging native flow             |   113 | Maestro                    |     1 | Stable test IDs, bounded waits, restart persistence                |

### Cross-suite metadata

- Test IDs: Story 4.2 tests do not carry traceable IDs.
- Priority markers: no P0 through P3 annotations or tags appear in the Story 4.2 code tests.
  Maestro carries `e2e`, `wardrobe`, and `smart-tagging` tags.
- Fixtures and factories: browser code imports the merged Playwright fixture. The smart-tagging
  spec consumes `page` and raw `request`; it does not consume `apiRequest` or `recurse` yet. API
  regression coverage uses the shared garment factory. Several newer unit and component files
  construct contract objects inline.
- Network behavior: Pact uses a local mock server and real Web client. Browser setup and final API
  assertions use `APIRequestContext` directly. No handwritten `page.route()` interception appears
  in the new browser spec.
- Timing: no `waitForTimeout`, `sleep`, or unbounded polling appears. Playwright relies on web-first
  assertions with one 20-second modal timeout. Maestro uses `extendedWaitUntil` with explicit
  limits.
- Control flow: `try` and `finally` restore mutated environment state in the engine unit suite.
  RLS conditionals and exception handling manage database setup and cleanup. Zod branches expose
  parse diagnostics. No conditional assertion path appears in the browser flow.

## Browser evidence

- Session: isolated `tea-review` Playwright CLI session, closed after collection.
- Journey: account and location setup, browser authentication, image upload, worker-backed
  analysis, automatic modal opening, cancel and resume, keyboard override, confirmation, reload,
  persisted ready state, and Ritual inclusion.
- Result: the representative journey completed successfully against the local API, dedicated
  wardrobe worker, PostgreSQL, Redis, and production Web build.
- Screenshot: `_bmad-output/test-artifacts/review-evidence.png`.
- Trace: `.playwright-cli/traces/trace-1785950584237.trace`.
- Network log: `.playwright-cli/network-2026-08-05T17-26-46-586Z.log`.
- Discovery command: Playwright listed one Chromium test in the target file.
- Setup observation: parallel API and Web startup reproduced a shared dependency build race. The
  Web build removed `@couture/api-client/dist` while the API booted, causing a module resolution
  failure. Sequential startup completed, which makes the race an actionable harness finding for
  the quality evaluation.

## Quality evaluation baseline

| Dimension            |   Weight |  Score | Grade |
| -------------------- | -------: | -----: | ----- |
| Determinism          |      30% |     65 | D     |
| Isolation            |      30% |     55 | F     |
| Maintainability      |      25% |     39 | F     |
| Performance          |      15% |     80 | B     |
| **Weighted overall** | **100%** | **58** | **F** |

The four independent quality workers reported 23 raw findings: 11 high, 9 medium, and 3 low.
Coverage is excluded from this score by the Test Architect workflow and belongs in traceability
analysis.

Execution used subagent mode. Three workers ran concurrently and the performance worker followed
as soon as runtime capacity became available. The complete aggregation is stored in
`/tmp/tea-test-review-summary-2026-08-05T17-28-39Z.json` for report generation.

## Executive summary

- **Review date:** 2026-08-05
- **Scope:** suite review of all Story 4.2 test changes
- **Reviewer:** Murat, BMad Test Architect
- **Baseline recommendation:** Request changes

The suite has strong breadth, explicit assertions, condition-based waits, real contract clients,
and representative Web and native journeys. Its principal weaknesses are shared mutable test
state, wall-clock fixtures, persistent E2E data, duplicated contract fixtures, a brittle Maestro
coordinate selector, and an E2E startup race observed during live evidence collection. The
smart-tagging Playwright file also bypasses the repository's `apiRequest` and `recurse` fixtures.

The baseline score is 58/100. No P0 defect was found. Eleven P1 findings require remediation
because they create order sensitivity, global leakage, false-positive maintenance risk, or an
unreliable local E2E harness. Existing RLS suite design accounts for four of those findings and
should be separated from Story 4.2-specific changes during implementation.

### Key strengths

- No hard waits occur in Story 4.2 tests.
- The browser journey exercises a real API, PostgreSQL, Redis, the wardrobe worker, axe, keyboard
  behavior, persistence, and Ritual eligibility.
- Pact uses the generated client, one interaction helper per test, serialized fork execution, and
  a three-run determinism gate.
- The real FashionCLIP model has a dedicated opt-in smoke gate.
- Database security tests use real PostgreSQL roles and assert denied writes explicitly.

### Key weaknesses

- Shared mocks and browser globals leak between tests.
- E2E-created backend records have no teardown owner.
- Test identities and response fixtures depend on wall-clock time.
- Smart-tagging test data is duplicated across API, Web, and Mobile suites.
- The local Playwright server graph can rebuild the same shared client concurrently.

## Quality criteria assessment

| Criterion             | Status | Violations | Notes                                                           |
| --------------------- | ------ | ---------: | --------------------------------------------------------------- |
| BDD structure         | WARN   |          1 | Outcome names are clear; complex journeys lack named phases     |
| Test IDs              | WARN   |        105 | Story 4.2 tests have no traceable IDs                           |
| Priority markers      | WARN   |        105 | No P0 through P3 markers appear in code tests                   |
| Hard waits            | PASS   |          0 | Web-first and bounded condition waits are used                  |
| Determinism           | FAIL   |          4 | Three wall-clock dependencies and one coordinate selector       |
| Isolation             | FAIL   |          7 | Shared mocks, globals, environment, and persistent data leak    |
| Fixture patterns      | WARN   |          4 | Service and E2E setup need owned fixtures                       |
| Data factories        | FAIL   |          4 | Contract snapshots repeat across layers                         |
| Network-first pattern | PASS   |          0 | The target browser spec has no ad hoc interception race         |
| Explicit assertions   | PASS   |          0 | At least 302 explicit expectations plus native visibility gates |
| Test length           | FAIL   |    3 files | Regression, contract, and RLS files exceed 300 lines            |
| Test duration         | WARN   |          2 | RLS setup dominates; model smoke remains intentionally opt-in   |
| Flakiness patterns    | FAIL   |          8 | Seven scored findings plus the reproduced startup race          |

Coverage mapping and coverage gates are outside `test-review`. Use `bmad-testarch-trace` for
acceptance-criteria coverage decisions.

## Critical findings with fixes

No P0 issue was detected. The following P1 groups require changes before approval.

### 1. Fresh test harnesses are required for service and controller suites

**Locations:** `apps/api/src/modules/wardrobe/wardrobe.service.spec.ts:119`,
`apps/api/src/modules/wardrobe/wardrobe.controller.spec.ts:14`

**Criteria:** isolation, determinism

**Knowledge:** `test-quality.md`, `data-factories.md`

Module-scoped mocks retain calls and queued implementations. The service suite can fail when test
order changes because a negative assertion observes calls made by another case.

```ts
beforeEach(() => {
  vi.clearAllMocks()
  service = createWardrobeServiceHarness().service
})
```

Prefer a harness factory that returns fresh named doubles and the system under test.

### 2. Browser globals must be restored

**Location:** `apps/web/src/app/components/garment-capture-modal.test.tsx:60`

**Criteria:** isolation

**Knowledge:** `test-quality.md`

The camera tests replace `navigator.mediaDevices` and canvas prototype methods. DOM cleanup does
not restore those globals.

```ts
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
})
```

Use tracked stubs or restore saved property descriptors after every case.

### 3. Wall-clock fixtures need fixed values

**Locations:** `apps/api/src/modules/wardrobe/wardrobe.service.spec.ts:120`,
`apps/mobile/components/wardrobe/garment-tagging-modal.test.tsx:27`,
`playwright/tests/wardrobe-smart-tagging.spec.ts:16`

**Criteria:** determinism

**Knowledge:** `test-quality.md`, `data-factories.md`

Response timestamps should use fixed ISO strings. Browser identity should derive from stable test
metadata and pair with cleanup.

```ts
const FIXED_NOW = new Date('2026-08-05T12:00:00.000Z')
const email = `wardrobe-smart-tagging-${testInfo.workerIndex}-${testInfo.retry}@example.test`
```

### 4. Smart-tagging fixtures need one typed source

**Location:** `apps/api/src/modules/wardrobe/wardrobe-color.processor.spec.ts:67` and matching
API, Web, and Mobile fixtures

**Criteria:** maintainability, data factories

**Knowledge:** `data-factories.md`

The pinned analysis version and suggestion snapshot are copied across layers. Add a typed builder
in shared testing support and import `GARMENT_TAGGING_ANALYSIS_VERSION`.

```ts
const suggestion = garmentTagSuggestionFixture({
  category: { value: 'bottom', confidence: 0.88, isConfident: true },
})
```

### 5. RLS coverage needs smaller, test-owned scenarios

**Locations:** `packages/db/test/rls-policies.spec.ts:100`, `:462`, `:622`, `:902`, `:1084`

**Criteria:** maintainability, performance

**Knowledge:** `test-quality.md`, `data-factories.md`

Twenty-three cases create and remove a broad multi-domain scenario while the full 25-test suite is
serialized. One CRUD case spans about 113 lines and three cross-account rejection cases duplicate
the same structure. Split domain seeds, keep the scenario handle test-local, parameterize repeated
policy checks, and parallelize only within the database connection limit.

### 6. The local E2E server graph has a shared-build race

**Locations:** `playwright/config/local.config.ts:45`, package Web and API prebuild scripts

**Criteria:** flakiness, performance

**Evidence:** live Test Architect browser setup

The parallel Web and API processes both rebuild `@couture/api-client`. One process removed `dist`
while the API loaded it, which caused `MODULE_NOT_FOUND`. Prepare shared dependencies once before
Playwright starts either server, then start server commands that do not rebuild shared outputs.

## Warnings and recommendations

| Priority | Location                                             | Finding                                                        | Recommended change                      |
| -------- | ---------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------- |
| P2       | `garment-tagging.engine.spec.ts:123`                 | Environment restoration is unsafe when a variable began absent | Use `vi.stubEnv` and `vi.unstubAllEnvs` |
| P2       | `wardrobe.service.regression.spec.ts:121`            | Upload secret leaks after the suite                            | Restore or delete it in `afterEach`     |
| P2       | `playwright/tests/wardrobe-smart-tagging.spec.ts:13` | API and browser data have no teardown                          | Add an automatic cleanup fixture        |
| P2       | `maestro/garment-smart-tagging-flow.yaml:51`         | Native data survives device reset                              | Clean backend data in runner `finally`  |
| P2       | `maestro/garment-smart-tagging-flow.yaml:42`         | Percentage tap depends on viewport geometry                    | Use a dedicated test ID                 |
| P2       | `wardrobe.service.regression.spec.ts:101`            | Large inline dependency graph                                  | Add a reusable service harness          |
| P2       | `playwright/tests/wardrobe-smart-tagging.spec.ts:40` | One test spans nine business phases                            | Add `test.step` and fixture helpers     |
| P3       | `wardrobe-contract.spec.ts:211`                      | OpenAPI checks are dense                                       | Use a typed endpoint matrix             |
| P3       | `garment-capture-modal.test.tsx:55`                  | Camera setup repeats                                           | Add camera and canvas installers        |
| P3       | `garment-smart-tagging-flow.yaml:38`                 | Navigation sequence repeats                                    | Extract a Maestro subflow               |

The contradictory FashionCLIP test name at
`apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.spec.ts:6` is a P1 false-signal risk. It
claims successful verification while asserting failure. Rename it or add a complete synthetic
snapshot fixture and test success separately.

## Best practices found

### Composed Playwright fixtures

`playwright/support/fixtures/merged-fixtures.ts` composes authentication, `apiRequest`, schema
validation, interception, network recording, network error monitoring, logging, file utilities,
and `recurse`. New browser specs should consume those capabilities through this single import.

### Pact determinism controls

`pact/http/vitest.consumer.config.mts` and `pact/http/vitest.provider.config.mts` use serialized
fork execution. Each consumer test invokes one interaction helper, and the package script runs a
three-pass determinism gate.

### Real boundary evidence

The RLS suite exercises PostgreSQL roles and denied mutations. The FashionCLIP smoke test uses the
prepared local model. The browser and native journeys use real service boundaries and worker
processing rather than replacing the core behavior with UI mocks.

## Context and integration

- Story: `_bmad-output/implementation-artifacts/4-2-smart-tagging-comfort-metadata.md`
- Test design: `_bmad-output/test-artifacts/test-design-system.md`
- Testing standards: `_bmad-output/test-artifacts/testing-standards.md`
- Review evidence: `_bmad-output/test-artifacts/review-evidence.png`
- Risk context: wardrobe processing and private data remain P1 quality surfaces.
- Priority traceability: Story 4.2 code tests currently carry no P0 through P3 markers.

## Knowledge base references

- `.agents/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md`
- `.agents/skills/bmad-testarch-test-review/resources/knowledge/data-factories.md`
- `.agents/skills/bmad-testarch-test-review/resources/knowledge/test-levels-framework.md`
- `.agents/skills/bmad-testarch-test-review/resources/knowledge/selective-testing.md`
- `.agents/skills/bmad-testarch-test-review/resources/knowledge/test-healing-patterns.md`
- `.agents/skills/bmad-testarch-test-review/resources/knowledge/selector-resilience.md`
- `.agents/skills/bmad-testarch-test-review/resources/knowledge/timing-debugging.md`
- Playwright Utils and Pact.js Utils fragments listed in the document frontmatter.

## Decision and next actions

- **Baseline decision:** Request changes
- **Re-review:** required after P1 fixes

Immediate remediation should:

1. Move smart-tagging API setup and verification to `apiRequest`, use `recurse` for asynchronous
   state, add named `test.step` phases, and own E2E cleanup.
2. Eliminate the shared-build startup race.
3. Reset shared mocks, browser globals, and environment variables.
4. Fix the contradictory snapshot test and replace wall-clock response fixtures.
5. Replace the Maestro coordinate fallback with a stable selector.

RLS modularization is the principal follow-up refactor. Coverage remains a separate gate. Run
`bmad-testarch-trace` after quality fixes when acceptance-criteria coverage needs a formal decision.

## Re-review after remediation

- **Re-review date:** 2026-08-05
- **Final recommendation:** Approve
- **Final score:** 94/100, grade A

All P1 findings and the actionable P2 and P3 findings were addressed in the implementation and
test harness. The remaining warnings concern suite-wide trace identifiers and an Expo Go
accessibility limitation described below. Neither warning can produce a false passing result in
the Story 4.2 gate.

| Dimension            |   Weight |  Score | Grade | Re-review evidence                                              |
| -------------------- | -------: | -----: | ----- | --------------------------------------------------------------- |
| Determinism          |      30% |     92 | A     | Fixed fixtures, stable identities, condition polling            |
| Isolation            |      30% |     97 | A     | Fresh harnesses, restored globals and env, owned E2E cleanup    |
| Maintainability      |      25% |     92 | A     | Typed fixtures, test steps, route matrix, reusable native flow  |
| Performance          |      15% |     94 | A     | Concurrent bounded RLS scenarios and one-time shared builds     |
| **Weighted overall** | **100%** | **94** | **A** | All required browser, contract, database, and native gates pass |

### Remediation completed

1. `playwright/tests/wardrobe-smart-tagging.spec.ts` now imports only the merged fixture and uses
   Playwright Utils `apiRequest` for signup, location, wardrobe, Ritual, and cleanup requests. It
   uses `recurse` for worker convergence, named `test.step` phases, schema validation, a fixed
   metadata-derived identity, P0 and story metadata, and automatic teardown.
2. `playwright/support/helpers/user-test-data.ts` removes garments through the public API before
   deleting local identity records in a transaction. This cleans object storage and database
   state on passes, failures, and retries.
3. Shared typed garment fixtures now live in
   `packages/api-client/src/testing/wardrobe-fixtures.ts`. API, Web, and Mobile suites consume the
   same pinned analysis version and deterministic timestamps.
4. API service and controller suites reset mocks for every case. Environment mutations use
   Vitest environment stubs. The regression suite uses a reusable service harness.
5. Web camera tests restore `mediaDevices` and canvas prototypes. Mobile tests reset mocks and
   isolate the known React Native Web warning.
6. FashionCLIP tests now cover direct logits, embedding fallback, and invalid model output with
   accurate outcome names. Inference parsing was split into testable helpers.
7. RLS scenarios are test-owned, transactionally cleaned, and bounded by the database pool. The
   oversized owner CRUD test was split by domain. The current database gate runs 31 tests, with
   27 RLS cases completing in 209 ms during re-review.
8. API and Web E2E builds prepare shared packages once before server startup. A single supervised
   local server graph removes the reproduced `@couture/api-client/dist` deletion race.
9. The Maestro runner creates unique authenticated identities and cleans garments through the
   public API in `finally` before database teardown. Native navigation is shared through
   `maestro/subflows/open-wardrobe.yaml`, and both platforms wait for application and data
   readiness before interaction.
10. The OpenAPI assertions use a typed route matrix. Pact provider state uses the shared analysis
    version. Pact consumer and provider determinism gates remain green.

### Native interaction exception

Expo Go exposes the Add Garment React Native `testID` in both native hierarchies, while Maestro's
accessibility activation can report success without dispatching the outer `Pressable` callback.
The flow first targets the visible `Add Garment` label. It uses a platform-specific physical tap
only when the capture modal remains absent, then requires the modal and deterministic fixture
control to become visible. This bounded fallback cannot hide a product failure because every
subsequent upload, worker, confirmation, persistence, restart, and cleanup assertion remains
mandatory. The final flow passed on iOS and Android.

### Re-review verification

| Gate                               | Result                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------- |
| API focused Vitest                 | 44 passed                                                                 |
| Web component Vitest               | 9 passed                                                                  |
| Mobile component and locale Vitest | 3 passed                                                                  |
| Shared API client Vitest           | 14 passed                                                                 |
| Database schema and RLS Vitest     | 31 passed                                                                 |
| Pact consumers                     | Web and Mobile interactions stable across the determinism gate            |
| Pact provider                      | 1 provider test passed, verifying 16 interactions                         |
| Playwright Chromium                | 1 P0 system test passed in 2.3 seconds; supervised run completed in 21.5s |
| Maestro iOS                        | 1 worker-backed flow passed in 37 seconds                                 |
| Maestro Android                    | 1 worker-backed flow passed in 48 seconds                                 |
| TypeScript                         | API client, database, API, Web, Mobile, Playwright, and Pact passed       |
| ESLint and formatting              | Remediated TypeScript and TSX files passed focused checks                 |

### Residual warnings

- Most unit and component cases still lack suite-wide P0 through P3 and story identifiers. The
  P0 system test carries traceable Story 4.2 metadata. Formal coverage traceability remains the
  responsibility of `bmad-testarch-trace`.
- Expo Go logs expected limitations for notifications, background fetch, and native widget
  publication. These warnings are outside the smart-tagging path and did not affect assertions.
- Prisma reports its package-level configuration as deprecated for Prisma 7. This is an existing
  tooling migration warning.

## Final decision

- **Decision:** Approve
- **Required follow-up:** none for the Story 4.2 test-quality gate

The suite now satisfies the Test Architect quality bar for deterministic execution, test-owned
state, maintainable fixtures, real boundary verification, and cross-platform recovery. Coverage
traceability remains a separate workflow.

## Appendix: violation summary

| Severity | Location                        | Criterion       | Issue                          |
| -------- | ------------------------------- | --------------- | ------------------------------ |
| P1       | `wardrobe.service.spec.ts:120`  | Determinism     | Wall-clock fixture             |
| P1       | Mobile tagging modal test `:27` | Determinism     | Wall-clock response timestamps |
| P1       | Playwright smart-tagging `:16`  | Determinism     | Wall-clock identity            |
| P1       | `wardrobe.service.spec.ts:119`  | Isolation       | Order-sensitive shared mocks   |
| P1       | Web capture modal test `:60`    | Isolation       | Leaked browser globals         |
| P1       | FashionCLIP engine spec `:6`    | Maintainability | Name contradicts assertion     |
| P1       | RLS spec `:902`                 | Maintainability | Oversized CRUD case            |
| P1       | RLS spec `:1084`                | Maintainability | Repeated policy logic          |
| P1       | Color processor spec `:67`      | Maintainability | Duplicated smart-tag fixture   |
| P1       | RLS spec `:462`                 | Performance     | Entire suite serialized        |
| P1       | RLS spec `:622`                 | Performance     | Broad setup per test           |
| P2       | Maestro flow `:42`              | Determinism     | Coordinate selector            |
| P2       | Engine spec `:123`              | Isolation       | Unsafe environment restore     |
| P2       | Controller spec `:14`           | Isolation       | Shared uncleared mocks         |
| P2       | Regression spec `:121`          | Isolation       | Leaked upload secret           |
| P2       | Playwright smart-tagging `:13`  | Isolation       | Persistent backend data        |
| P2       | Maestro flow `:51`              | Isolation       | Persistent backend data        |
| P2       | RLS spec `:100`                 | Maintainability | Monolithic fixture setup       |
| P2       | Regression spec `:101`          | Maintainability | Large harness setup            |
| P2       | Playwright smart-tagging `:40`  | Maintainability | Missing test steps             |
| P3       | Wardrobe contract spec `:211`   | Maintainability | Dense route assertions         |
| P3       | Web capture modal test `:55`    | Maintainability | Repeated browser setup         |
| P3       | Maestro flow `:38`              | Maintainability | Repeated navigation            |

## Review metadata

- Generated by: BMad TEA Agent, Test Architect
- Workflow: testarch-test-review v4.0
- Review ID: `test-review-story-4-2-20260805`
- Timestamp: `2026-08-05T18:31:00Z`
- Version: 1.1 remediated re-review
