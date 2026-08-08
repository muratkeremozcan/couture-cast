---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted:
  - 'step-01-detect-mode'
  - 'step-02-load-context'
  - 'step-03-risk-and-testability'
  - 'step-04-coverage-plan'
  - 'step-05-generate-output'
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-08-07'
---

# Test design: Epic 4, Story 4.3. Outfit capsule builder

**Date:** 2026-08-07  
**Author:** Murat  
**Status:** Draft for story refinement

## Executive summary

This design reviews Story 4.3 before implementation. The story has strong breadth, especially in
its API, RLS, contract, Web, Mobile, accessibility, and localization tasks. Its main test gap is
test-level allocation. Concurrency, database integrity, ranking boundaries, cache invalidation,
and authorization need deterministic integration or unit evidence. The planned Playwright and
Maestro lifecycle flows should stay focused on user-visible outcomes.

- Risks identified: 10
- High-priority risks with score 6 or higher: 8
- Highest risk: data races and atomicity, score 9
- Coverage groups: 36 across database, API, unit, contract, component, E2E, Mobile, NFR, and CI
- Estimated test-development effort: about 115 to 185 hours, or 3 to 5 person-weeks with parallel
  ownership

## Required decisions before development

1. Decide whether read-only and full-access guardians can call capsule REST endpoints for a linked
   teen. If they can, define how the request identifies that teen. The current owner-scoped API
   language conflicts with guardian-shared RLS.
2. Define the Web and Mobile garment reorder interaction, including accessible control names,
   announcements, focus behavior, pointer behavior, and touch behavior.
3. Define whether the two-second cross-surface requirement applies independently to each client or
   requires live propagation between open Web and Mobile clients.
4. Define Unicode counting for the 60 and 280 character limits.
5. Define whether `garmentId` matches retained, unavailable joins or only currently available
   garments.
6. Define the valid `offset`, maximum `q` length, expected capsule cardinality per user, and P95
   latency targets for capsule list and ritual generation.

## Not in scope

| Item                     | Reason                                                                      | Mitigation                                                                                        |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Executable capsule tests | The feature has no implementation yet.                                      | Use this design for ATDD and implementation sequencing.                                           |
| Final NFR verdict        | Implementation evidence does not exist.                                     | Run an NFR evidence audit after all evidence artifacts exist.                                     |
| Browser exploration      | The local Web application was unavailable and the feature is unimplemented. | Inspect the implemented UI with Playwright CLI before E2E automation.                             |
| Pact Broker history      | SmartBear Pact MCP was unavailable.                                         | Use checked-in Pact suites now, then confirm broker compatibility during contract implementation. |

## Acceptance-criteria traceability

| Acceptance criterion                | Primary scenario groups                                                                                   | Evidence focus                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| AC 1. Create safely                 | 4.3-DB-002, 4.3-API-001, 4.3-UNIT-001, 4.3-UNIT-004, 4.3-WEB-001, 4.3-MOB-001, 4.3-E2E-001                | Valid graph, atomic commit, revision, response, visibility, privacy-safe event     |
| AC 2. Retry safely                  | 4.3-API-002, 4.3-API-003, 4.3-API-010, 4.3-PACT-001                                                       | Replay, changed payload, race, one row, one event                                  |
| AC 3. Retrieve predictably          | 4.3-DB-003, 4.3-API-004, 4.3-API-005, 4.3-API-006, 4.3-E2E-004                                            | Authorization, deterministic pagination, filters, repair projection, masked detail |
| AC 4. Mutate and delete             | 4.3-API-003, 4.3-API-007, 4.3-API-010, 4.3-WEB-001, 4.3-MOB-001, 4.3-E2E-002                              | Atomic mutation, no-op rules, revision, event, client state, delete semantics      |
| AC 5. Retention and RLS             | 4.3-DB-003, 4.3-API-003, 4.3-API-006, 4.3-API-008, 4.3-API-009, 4.3-E2E-002                               | Exclusion, repair state, recommendation blocking, role boundaries                  |
| AC 6. Deterministic recommendations | 4.3-UNIT-002, 4.3-UNIT-003, 4.3-API-008, 4.3-API-009, 4.3-PACT-001, 4.3-E2E-002                           | Score boundaries, fill, tie-break, fallback, persistence, cache freshness          |
| AC 7. Accessible and localized      | 4.3-WEB-001, 4.3-MOB-001, 4.3-E2E-003, 4.3-MAE-001, 4.3-MAE-002, 4.3-I18N-001, 4.3-I18N-002, 4.3-A11Y-001 | Semantics, input methods, focus, speech, geometry, locale parity and layout        |

## Risk assessment

Risk score is probability multiplied by impact on a 1 to 9 scale. A score of 6 or higher requires
mitigation evidence before release.

### High-priority risks

| ID      | Category | Risk                                                                                                                                | P   | I   | Score | Mitigation                                                                                             | Owner                 | Timeline              |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ----- | ------------------------------------------------------------------------------------------------------ | --------------------- | --------------------- |
| 4.3-R01 | SEC      | Owner-scoped API language conflicts with guardian-shared RLS. Access could be incorrect or reveal another user's capsule existence. | 2   | 3   | 6     | Decide guardian API semantics and test the complete role matrix on both tables and all CRUD verbs.     | API and database      | Before development    |
| 4.3-R02 | DATA     | Eligibility, join replacement, idempotency, revision updates, retention transitions, and deletes can race.                          | 3   | 3   | 9     | Add real PostgreSQL concurrency tests using separate connections and deterministic barriers.           | API and database      | Before review         |
| 4.3-R03 | BUS      | Ranking, slot filling, stable ordering, persistence, and two cache layers can return stale or incorrectly ranked outfits.           | 3   | 2   | 6     | Extract pure ranking logic and add database plus Redis integration tests.                              | Personalization       | Before review         |
| 4.3-R04 | SEC      | Analytics can leak authored content or duplicate events during retries, no-op changes, remounts, or delivery failure.               | 2   | 3   | 6     | Enforce strict property allowlists, negative PII assertions, exact event rules, and failure injection. | Analytics and clients | Before review         |
| 4.3-R05 | TECH     | Single mega Playwright and Maestro flows will combine unrelated failure modes and become slow and flaky.                            | 3   | 2   | 6     | Move rule breadth to lower levels and split E2E into independent user journeys.                        | QA and clients        | During implementation |
| 4.3-R06 | BUS      | Garment ordering is required, while reorder controls and accessible semantics are unspecified.                                      | 3   | 2   | 6     | Define pointer, keyboard, touch, VoiceOver, and TalkBack behavior before component tests.              | UX and clients        | Before development    |
| 4.3-R07 | DATA     | New foreign keys, uniqueness, cascades, `SetNull`, arrays, and idempotency-key reuse can regress in migration.                      | 2   | 3   | 6     | Add migration tests for every constraint and referential action against a seeded schema.               | Database              | Before review         |
| 4.3-R09 | TECH     | Capsule graphs lack shared factories and cleanup rules across database, API, Pact, Playwright, and Maestro.                         | 3   | 2   | 6     | Add capsule and relation factories to `@couture/testing` with reverse-dependency cleanup.              | Test infrastructure   | Early implementation  |

### Medium-priority risks

| ID      | Category | Risk                                                                                                                 | P   | I   | Score | Mitigation                                                                                | Owner                   |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------- | --- | --- | ----- | ----------------------------------------------------------------------------------------- | ----------------------- |
| 4.3-R08 | PERF     | Capsule volume and endpoint latency thresholds are absent. Current architecture and executable k6 thresholds differ. | 2   | 2   | 4     | Agree on volumes and tagged endpoint thresholds, then collect k6 and query-plan evidence. | Product and performance |
| 4.3-R10 | TECH     | Unicode length, pagination, search size, retained joins, and malformed query semantics are ambiguous.                | 2   | 2   | 4     | Resolve the API contract and add table-driven boundary cases.                             | Product and API         |

### Residual risk

- Concurrency evidence will reduce data-integrity risk only if tests use the production database
  transaction path and separate connections.
- Client analytics deduplication still depends on a precise screen-lifetime definition.
- Performance risk remains open until product approves representative data volume and thresholds.
- Manual screen-reader evidence remains release-critical because axe cannot prove a usable spoken
  interaction.

## NFR planning

This section defines planned evidence. It does not make a final PASS, CONCERNS, or FAIL decision.

| Category        | Requirement or threshold                                                                                                                                               | Risk             | Planned validation                                                                           | Evidence                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Security        | Zero unauthorized capsule or join reads and mutations. Non-owned detail must remain indistinguishable from missing detail. Analytics must contain no authored content. | 4.3-R01, 4.3-R04 | RLS matrix, API authorization, JWT claim abuse, analytics allowlist and negative PII tests   | Vitest, PostgreSQL, and analytics schema reports         |
| Reliability     | Every mutation is atomic. Revisions match committed state changes. The first ritual read after mutation is fresh even when Redis deletion fails.                       | 4.3-R02, 4.3-R03 | Database race barriers, rollback injection, cache revision checks, four-worker runs, burn-in | Database logs, Vitest output, burn-in report             |
| Performance     | Successful mutations become visible in the acting client within two seconds.                                                                                           | 4.3-R08          | Measure from successful response to rendered library state                                   | Playwright timing artifact                               |
| Performance     | Capsule list and ritual P95 at representative cardinality.                                                                                                             | 4.3-R08          | Tagged k6 scenarios and PostgreSQL query plans                                               | UNKNOWN until thresholds and volume are approved         |
| Accessibility   | WCAG 2.2 AA, 44 by 44 pixel targets, keyboard and focus behavior, VoiceOver or TalkBack completion.                                                                    | 4.3-R06          | Axe, geometry, keyboard, component semantics, manual reference-device runs                   | Playwright, component, VoiceOver, and TalkBack artifacts |
| Localization    | Identical catalog shape across 10 locales with valid interpolation, plurals, precedence, and fallback.                                                                 | 4.3-R10          | Catalog parity, locale resolution, and representative long-string layout                     | Vitest and browser reports                               |
| Maintainability | Tests are isolated, parallel-safe, self-cleaning, focused, and free of hard waits.                                                                                     | 4.3-R05, 4.3-R09 | Shared factories, four workers, changed-spec burn-in, trace inspection                       | CI reports and failure artifacts                         |

**Unknown thresholds:** Maximum capsules per user, maximum query length, filtered-list P95, cold
ritual P95, warm ritual P95, and acceptable Redis degradation latency.

## Entry criteria

- [ ] Six required decisions above are recorded in the story or linked architecture decision.
- [ ] Capsule factories and cleanup ordering exist in `@couture/testing`.
- [ ] Real PostgreSQL and Redis test environments support deterministic failure and race injection.
- [ ] Web, Mobile, API, consumer, and provider implementations are deployed to their test targets.
- [ ] Stable `data-testid` attributes exist only where semantic roles and labels cannot identify
      dynamic controls reliably.

## Exit criteria

- [ ] P0 pass rate is 100 percent. P1 pass rate is at least 95 percent with every failure triaged.
- [ ] No open severity 1 or severity 2 defect exists.
- [ ] Every score 6 or higher risk has mitigation evidence or an approved waiver.
- [ ] Changed critical logic reaches at least 90 percent branch coverage. Overall changed coverage
      reaches at least 80 percent.
- [ ] Pact output is deterministic across three runs. Consumer and provider verification pass.
- [ ] New P0 and P1 tests pass changed-spec burn-in without retries hiding a first-run failure.
- [ ] Axe, keyboard, focus, target-size, catalog parity, VoiceOver, and TalkBack evidence passes.
- [ ] Performance gates remain blocked until product approves capsule volume and endpoint thresholds.

## Test coverage plan

P0, P1, P2, and P3 express risk and business priority. Execution timing is defined separately.
Each row is a scenario group. Data variants within a group should be table-driven.

### P0. Critical

**Criteria:** Core workflow or data protection, linked to a high risk, with no safe workaround.

| Test ID      | Requirement                                                                             | Level and tool                         | Risk             | Owner           | Notes                                             |
| ------------ | --------------------------------------------------------------------------------------- | -------------------------------------- | ---------------- | --------------- | ------------------------------------------------- |
| 4.3-DB-002   | Same-owner composite FKs, uniqueness, order, cascades, `SetNull`, and key reuse         | DB integration, Vitest and PostgreSQL  | 4.3-R07          | Database        | Direct constraint evidence                        |
| 4.3-DB-003   | Full RLS role matrix on capsules and joins                                              | DB integration, Vitest and PostgreSQL  | 4.3-R01          | Database        | Include revoked links and claim spoofing          |
| 4.3-API-001  | Atomic create, rollback at each write stage, revision, response, headers, and one event | API and real DB integration, Vitest    | 4.3-R02, 4.3-R04 | API             | Assert post-commit telemetry                      |
| 4.3-API-003  | Retention, replacement, mutation, and delete races                                      | API and DB integration with barriers   | 4.3-R02          | API             | Separate connections, exact revision delta        |
| 4.3-API-004  | Masked unauthorized detail and decided guardian behavior                                | API integration, Vitest                | 4.3-R01          | API             | All CRUD verbs and cross-owner garments           |
| 4.3-API-006  | `ready` and `needs_repair` projections plus valid and invalid repair                    | API integration, Vitest                | 4.3-R02          | API             | Include zero available garments                   |
| 4.3-UNIT-002 | Ranking boundaries, dress and separates, cold outerwear, multiplier, favorite, ties     | Pure unit, table-driven Vitest         | 4.3-R03          | Personalization | Canonical deterministic order                     |
| 4.3-API-009  | Redis and database stale recommendation rejection                                       | Redis and DB integration, Vitest       | 4.3-R03          | Personalization | Include cache-delete failure and concurrent reads |
| 4.3-UNIT-004 | Strict analytics schemas and negative PII assertions                                    | Unit, Vitest and Zod                   | 4.3-R04          | Analytics       | Reject extra properties and authored content      |
| 4.3-WEB-001  | Builder state, ordering, validation, focus, announcements, and duplicate submit         | Web component, Vitest browser          | 4.3-R05, 4.3-R06 | Web             | Interaction must be specified first               |
| 4.3-MOB-001  | Mobile builder parity, ordering, focus, announcements, and duplicate submit             | React Native component, Vitest and MSW | 4.3-R05, 4.3-R06 | Mobile          | Test both platform adaptations                    |
| 4.3-E2E-001  | Web create, two-second visibility, reload, and persisted order                          | Focused Playwright journey             | 4.3-R05, 4.3-R08 | QA              | Time from successful response                     |

Estimated P0 implementation: about 55 to 85 hours. These groups expand into table-driven atomic
cases. Keep the minimal release-blocking subset tagged P0.

### P1. High

**Criteria:** Important user behavior, common workflow, contract protection, or significant edge
case.

| Test ID      | Requirement                                                                         | Level and tool                             | Risk             | Owner           | Notes                                     |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------------------ | ---------------- | --------------- | ----------------------------------------- |
| 4.3-DB-001   | Apply migration to seeded schema and verify defaults, indexes, policies, and grants | DB integration, Vitest and PostgreSQL      | 4.3-R07          | Database        | Include migration rehearsal               |
| 4.3-API-002  | Idempotency normalization, replay, conflict, ownership, and concurrent keys         | API and real DB integration, Vitest        | 4.3-R02          | API             | Canonical hash boundaries                 |
| 4.3-UNIT-001 | Metadata, UUID, boolean, pagination, Unicode, wildcard, and empty PATCH validation  | Unit, table-driven Vitest and Zod          | 4.3-R10          | API             | Resolve ambiguous limits first            |
| 4.3-API-005  | Search and filters alone and combined with totals and stable pagination             | Repository and API integration, Vitest     | 4.3-R10          | API             | E2E covers one representative combination |
| 4.3-API-007  | Update, rename, reorder, favorite, delete, no-op, headers, and later `404`          | API integration, Vitest                    | 4.3-R02, 4.3-R04 | API             | Exact revision and event semantics        |
| 4.3-UNIT-003 | Partial fills, missing slots, ties, exclusions, no-fill, and no qualifying capsule  | Pure unit, table-driven Vitest             | 4.3-R03          | Personalization | Preserve canonical order                  |
| 4.3-API-008  | Winner persistence, fallback, nullable metadata, deletion race, and one event       | Service and DB integration, Vitest         | 4.3-R03, 4.3-R04 | Personalization | Event after commit only                   |
| 4.3-API-010  | Analytics replay, no-op, race, and delivery-failure behavior                        | Service integration with failure injection | 4.3-R04          | Analytics       | Delivery failure cannot roll back CRUD    |
| 4.3-PACT-001 | Consumer behavior for success, replay, list, repair, CRUD, ritual, and errors       | Consumer and provider Pact                 | 4.3-R01, 4.3-R10 | API and clients | Include headers consumers use             |
| 4.3-PACT-002 | Isolated interaction state and three-pass determinism                               | Pact and Vitest single fork                | 4.3-R05          | API and clients | One interaction per test                  |
| 4.3-WEB-002  | Library empty, loading, error, filter, repair, delete, and recommendation states    | Web component, Vitest and MSW              | 4.3-R04, 4.3-R05 | Web             | Viewed once per defined screen lifetime   |
| 4.3-MOB-002  | Mobile analytics across rerender, navigation, retry, and remount                    | Mobile component, Vitest                   | 4.3-R04          | Mobile          | Define remount rule                       |
| 4.3-E2E-002  | Web repair, ritual winner, detail, favorite, and delete                             | Focused Playwright journey                 | 4.3-R03, 4.3-R05 | QA              | User-visible assertions only              |
| 4.3-E2E-003  | Keyboard builder, focus, geometry, announcements, and axe                           | Focused Playwright accessibility journey   | 4.3-R06          | QA              | Axe does not replace interaction checks   |
| 4.3-E2E-004  | Search with one representative combined filter                                      | Focused Playwright journey                 | 4.3-R05          | QA              | API owns full matrix                      |
| 4.3-MAE-001  | Create and reopen on one iOS and one Android reference device                       | Focused Maestro flows                      | 4.3-R05          | Mobile and QA   | Separate platform results                 |
| 4.3-MAE-002  | Repair, recommendation navigation, and one non-English locale                       | Separate Maestro flows                     | 4.3-R05          | Mobile and QA   | No mega lifecycle flow                    |
| 4.3-I18N-001 | Key, placeholder, interpolation, plural, and proper-noun parity across 10 locales   | Unit, Vitest                               | 4.3-R10          | Clients         | Web and Mobile catalogs                   |
| 4.3-I18N-002 | Locale precedence, region fallback, and long-string layout                          | Component and browser integration          | 4.3-R10          | Clients         | Preserve Mobile resolution behavior       |
| 4.3-A11Y-001 | VoiceOver and TalkBack create, reorder, repair, and delete                          | Manual reference-device evidence           | 4.3-R06          | QA and UX       | Record device, OS, build, steps, result   |
| 4.3-OPS-001  | Four-worker execution, burn-in, and failure artifacts                               | CI                                         | 4.3-R05, 4.3-R09 | QA and platform | No retries masking first-run failure      |

Estimated P1 implementation: about 45 to 70 hours.

### P2. Medium

**Criteria:** Expensive NFR validation or secondary edge coverage with a temporary operational
workaround.

| Test ID      | Requirement                                                 | Level and tool                     | Risk    | Owner       | Notes                 |
| ------------ | ----------------------------------------------------------- | ---------------------------------- | ------- | ----------- | --------------------- |
| 4.3-PERF-001 | Filtered list and cold or warm ritual at agreed cardinality | k6                                 | 4.3-R08 | Performance | Blocked on thresholds |
| 4.3-PERF-002 | Query plans for search, filters, joins, and stable sorting  | PostgreSQL performance integration | 4.3-R08 | Database    | Blocked on volume     |

Estimated P2 implementation: about 10 to 20 hours after thresholds exist.

### P3. Low

**Criteria:** Exploratory investigation and polish beyond the named acceptance paths.

| Test ID     | Requirement                                                                         | Level and tool             | Owner     | Notes                                                   |
| ----------- | ----------------------------------------------------------------------------------- | -------------------------- | --------- | ------------------------------------------------------- |
| 4.3-EXP-001 | Exploratory long-content, rapid navigation, interruption, and device-layout session | Web and Mobile exploratory | QA and UX | Record findings and convert defects to regression tests |

Estimated P3 implementation: about 5 to 10 hours.

## Execution strategy

Run everything in PRs when the functional path remains under 15 minutes. Parallelize Playwright
and keep tests independent. Defer only expensive, long-running, or manual evidence.

- PR: Unit, component, API and DB integration, RLS, Pact, locale parity, focused P0 Playwright,
  k6 smoke, typecheck, lint, and build.
- Nightly: Full Playwright browser matrix, P1 journeys, race and cache burn-in, and large-volume
  query-plan checks.
- Weekly: Representative k6 load and soak, Redis degradation drills, migration rehearsal, and full
  artifact review.
- Pre-release: Local iOS and Android Maestro plus manual VoiceOver and TalkBack evidence under the
  current Mobile CI posture.

## Resource estimates

| Priority | Estimate               | Main complexity                                                   |
| -------- | ---------------------- | ----------------------------------------------------------------- |
| P0       | About 55 to 85 hours   | Database barriers, authorization, cache, core client interactions |
| P1       | About 45 to 70 hours   | Contract breadth, component states, focused E2E, localization     |
| P2       | About 10 to 20 hours   | Performance profiles and query plans after threshold decisions    |
| P3       | About 5 to 10 hours    | Cross-device exploratory evidence                                 |
| Total    | About 115 to 185 hours | Roughly 3 to 5 person-weeks with parallel ownership               |

The estimate includes shared factory work, deterministic concurrency support, test review,
four-worker stabilization, and failure-artifact configuration.

## Prerequisites and test infrastructure

### Test data

- Add `createOutfitCapsule` and relation factories to `@couture/testing`.
- Support persisted and in-memory variants, explicit timestamps, revisions, retained garment state,
  recommendation metadata, and owner roles.
- Register cleanup in reverse dependency order: recommendation references, joins, capsules, then
  garments and users.
- Use per-test namespaces and deterministic clocks. Avoid shared hard-coded IDs.

### Tooling and environment

- Reuse merged Playwright fixtures for API requests, schema validation, auth sessions, network
  recording, interception, and error monitoring.
- Run database races on separate production-equivalent PostgreSQL connections with explicit
  barriers. In-memory repositories cannot prove transaction behavior.
- Run Redis integration against a disposable namespace with scan, delete, corruption, and timeout
  injection.
- Preserve Pact's single-fork, non-parallel FFI configuration and one interaction per test.
- Upload traces, screenshots, Pact output, k6 summaries, and Maestro artifacts on failure.

## Quality gate criteria

- P0 pass rate: 100 percent.
- P1 pass rate: at least 95 percent, with approved waivers for any failure.
- P2 and P3 pass rate: at least 90 percent or explicitly informational where no threshold exists.
- Score 6 or higher mitigation completion: 100 percent or approved waiver.
- Authorization and analytics privacy scenarios: 100 percent pass.
- Critical changed logic: at least 90 percent branch coverage. Overall changed coverage: at least
  80 percent.
- Database race evidence proves one committed state, exact revision changes, no partial joins,
  complete rollback, and one post-commit event.
- Pact output is identical across three runs. Four-worker and changed-spec burn-in are clean.
- Accessibility and localization evidence is complete on both clients.
- Performance cannot pass until missing volume and latency thresholds are approved.
- Final NFR evidence classification is deferred to the implementation-stage NFR audit.

## High-risk mitigation plans

| Risk    | Planned verification                                                                                                       | Completion evidence                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 4.3-R01 | Query both tables directly under every role, then repeat allowed and denied API verbs.                                     | RLS and API authorization reports                           |
| 4.3-R02 | Orchestrate races with separate connections and barriers. Verify committed rows, joins, revision, response, and telemetry. | Database race report and transaction logs                   |
| 4.3-R03 | Prove pure score boundaries, then exercise persisted winner and cache revision paths under concurrency and failure.        | Unit, database, and Redis reports                           |
| 4.3-R04 | Validate strict allowlists, negative PII, exact event counts, no-op suppression, and analytics delivery failure.           | Schema and failure-injection reports                        |
| 4.3-R05 | Review test allocation, split E2E journeys, run four workers, and burn in changed specs.                                   | Test map, timing, burn-in, and trace artifacts              |
| 4.3-R06 | Approve interaction semantics, then verify pointer, keyboard, touch, focus, speech, and persisted order.                   | UX decision, automated results, manual screen-reader record |
| 4.3-R07 | Apply migration to seeded data and test each constraint plus referential action directly.                                  | Migration integration report                                |
| 4.3-R09 | Use shared capsule graphs in DB, API, Pact, Playwright, and Mobile suites. Prove cleanup.                                  | Factory tests and parallel leak check                       |

## Assumptions and dependencies

### Assumptions

1. PostgreSQL transactions and RLS policies in test match production behavior.
2. Revision is the authoritative cache-consistency token for capsule recommendations.
3. Analytics delivery is fail-open for committed core CRUD.
4. Existing Web and Mobile locale-resolution rules remain authoritative unless the story changes
   them explicitly.

### Dependencies

1. Product and architecture decisions for guardian API behavior, Unicode limits, query bounds,
   cross-surface timing, and performance thresholds.
2. UX decision for accessible reorder behavior.
3. Database and Redis failure-injection support.
4. Stable reference devices or simulators for iOS and Android.
5. Pact provider-state setup for every consumer interaction.

### Risks to the plan

- If deterministic database barriers cannot be added, 4.3-R02 remains unmitigated and release is
  blocked.
- If reference-device access is delayed, automate component semantics first and keep manual
  screen-reader evidence as a pre-release gate.
- If performance thresholds remain undecided, publish raw measurements and retain UNKNOWN status.

## Interworking and regression scope

- Database: `OutfitCapsule`, `OutfitCapsuleItem`, `DailyLookRecommendation`, Garment retention,
  guardian consent policies, indexes, and grants.
- API: capsule CRUD, search and filters, idempotency, ritual generation, cache headers, error shapes,
  and analytics dispatch.
- Web and Mobile: wardrobe selection, ritual display, locale resolution, modal behavior, analytics,
  and accessibility foundations.
- Contracts: checked-in Web and Mobile consumer pacts, provider verification, and determinism gate.
- Operations: Redis cache invalidation, four-worker execution, failure artifacts, k6, and migration
  rehearsal.

## Implementation planning handoff

1. Resolve the six required decisions before coding the affected contracts.
2. Build capsule factories, cleanup, database barriers, and Redis namespaces early.
3. Implement failing P0 database, API, ranking, analytics, Web component, Mobile component, and
   focused Playwright tests alongside the first production slices.
4. Add P1 contract and breadth coverage as each endpoint and client state lands.
5. Add performance evidence after volume and latency thresholds are approved.

## Reference guidance

- Playwright locators should prioritize roles and accessible names. Auto-waiting plus web-first
  assertions should replace hard waits: [locators](https://playwright.dev/docs/locators),
  [actionability](https://playwright.dev/docs/actionability).
- Pact should protect consumer and provider understanding. Provider functional behavior belongs in
  API and database tests: [consumer testing](https://docs.pact.io/consumer).
- k6 thresholds should convert approved performance objectives into executable pass or fail
  criteria: [thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/).
- GitHub Actions should retain failure evidence for diagnosis: [workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data).
