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
inputDocuments:
  - '_bmad/tea/config.yaml'
  - '_bmad-output/project-context.md'
  - '_bmad-output/implementation-artifacts/4-3-outfit-capsule-builder.md'
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/test-artifacts/test-design-system.md'
  - '_bmad-output/test-artifacts/testing-standards.md'
  - '.agents/skills/bmad-testarch-test-design/resources/tea-index.csv'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/risk-governance.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/probability-impact.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-levels-framework.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-priorities-matrix.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/nfr-criteria.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/test-quality.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/fixture-architecture.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/data-factories.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/network-first.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/selector-resilience.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/playwright-cli.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/overview.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/api-request.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/auth-session.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/pactjs-utils-overview.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/pactjs-utils-consumer-helpers.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/pactjs-utils-provider-verifier.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/pactjs-utils-request-filter.md'
  - '.agents/skills/bmad-testarch-test-design/resources/knowledge/pact-mcp.md'
---

# Test design progress

## Mode and prerequisites

- Mode: Epic-level test design for Story 4.3, Outfit capsule builder.
- Requirements source: Story 4.3 with seven acceptance criteria and implementation tasks.
- Architecture source: `_bmad-output/project-context.md` and story-level architectural constraints.
- Prerequisite result: Satisfied.

## Loaded context and current coverage

- Detected stack: Full-stack TypeScript using Vitest, Playwright, Pact, k6, Supabase RLS,
  and Maestro.
- Repository scan: 236 existing test files. Existing wardrobe, retention, ritual, analytics,
  localization, RLS, contract, accessibility, and mobile patterns are available for reuse.
- Story coverage: No capsule implementation or executable capsule tests exist. The story defines
  broad test tasks, with several high-risk scenarios still implicit.
- Fixture pattern: Add capsule factories to `@couture/testing`, register cleanup in reverse
  dependency order, and reuse merged Playwright fixtures.
- Contract pattern: Preserve one Pact interaction per test and the existing single-fork,
  non-parallel FFI safeguards.
- Browser exploration: Skipped because `http://127.0.0.1:3005/wardrobe` was unavailable. The
  feature itself is also unimplemented.
- Pact broker exploration: SmartBear Pact MCP tools were unavailable. Checked-in consumer and
  provider suites supplied the contract landscape.
- External cross-check: Current official Playwright, Cypress, Pact, k6, pytest, JUnit, Go test,
  and GitHub Actions documentation was reviewed. The active repository recommendations use the
  Playwright, Pact, k6, Vitest, Maestro, and GitHub Actions stack.

## Risk assessment

Risk score uses probability times impact on a 1 to 9 scale. Scores of 6 or higher require
mitigation evidence before the story can pass a release gate.

| ID      | Category | Risk                                                                                                                                                                                                             | P   | I   | Score | Required mitigation                                                                                                                                                                                                        | Owner                   | Timeline              |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------- |
| 4.3-R01 | SEC      | Owner-scoped API language conflicts with guardian-shared RLS. A guardian could receive the wrong access or another user's existence could leak.                                                                  | 2   | 3   | 6     | Decide guardian API semantics. Test owner, read-only guardian, full-access guardian, admin, revoked guardian, unrelated user, anonymous, service role, and untrusted JWT claims across both tables and every CRUD verb.    | API and database        | Before development    |
| 4.3-R02 | DATA     | Eligibility checks, join replacement, idempotency, revision increments, retention transitions, and deletes can race and leave inconsistent state or duplicate events.                                            | 3   | 3   | 9     | Add real database concurrency tests with separate connections and deterministic barriers. Assert one committed state, exact revision deltas, complete rollback, one event, and no partial joins.                           | API and database        | Before review         |
| 4.3-R03 | BUS      | Recommendation scoring, slot filling, stable ordering, persisted recommendations, and two cache layers can return stale or incorrectly ranked outfits.                                                           | 3   | 2   | 6     | Extract pure ranking functions for table-driven boundary tests. Add database and Redis integration tests for stale revisions, concurrent ritual reads, deletion races, failed cache deletion, and telemetry deduplication. | Personalization         | Before review         |
| 4.3-R04 | SEC      | Analytics can leak user-authored content or duplicate mutation and recommendation events under retries, no-op changes, React remounts, or delivery failure.                                                      | 2   | 3   | 6     | Enforce strict property allowlists. Add negative PII assertions and failure injection. Verify analytics failure never rolls back committed CRUD and that events remain exactly once.                                       | Analytics and clients   | Before review         |
| 4.3-R05 | TECH     | The planned single Playwright lifecycle and single Maestro lifecycle combine API races, filters, CRUD, retention, analytics, accessibility, and recommendations. This will be slow, hard to diagnose, and flaky. | 3   | 2   | 6     | Move business rules and races to unit or integration suites. Split E2E into focused independent journeys with API setup, automatic cleanup, priority tags, and burn-in.                                                    | QA and clients          | During implementation |
| 4.3-R06 | BUS      | Garment ordering is central to the feature, while Web and Mobile reorder controls and accessible semantics are unspecified. Tests cannot prove the intended interaction.                                         | 3   | 2   | 6     | Define the reorder interaction and accessible names for pointer, keyboard, touch, VoiceOver, and TalkBack. Cover order persistence and focus after every move.                                                             | UX and clients          | Before development    |
| 4.3-R07 | DATA     | New foreign keys, unique constraints, cascades, `SetNull`, enum arrays, and key reuse can regress during migration without direct constraint evidence.                                                           | 2   | 3   | 6     | Add migration integration tests for all constraints, owner immutability, cascade behavior, `SetNull`, hard-delete key reuse, and revision defaults. Validate the migration against existing seeded data.                   | Database                | Before review         |
| 4.3-R08 | PERF     | Capsule cardinality, search input limits, filtered-list latency, and ritual latency under capsule load have no story-level threshold. Current architecture and executable k6 thresholds also differ.             | 2   | 2   | 4     | Set expected capsules per user and endpoint latency thresholds. Add k6 tagged thresholds and PostgreSQL query-plan evidence for search, filters, pagination, and cold-cache ritual generation.                             | Product and performance | Before review         |
| 4.3-R09 | TECH     | Tests need capsule graphs across DB, API, Pact, Playwright, and Maestro, yet the story only adds API response fixtures. Ad hoc setup will duplicate data and leak rows.                                          | 3   | 2   | 6     | Add `createOutfitCapsule` and relation factories to `@couture/testing`. Extend cleanup ordering for capsule joins and capsules. Use per-test namespaces and explicit timestamps.                                           | Test infrastructure     | Early implementation  |
| 4.3-R10 | TECH     | Input semantics remain ambiguous for Unicode length, `offset`, maximum search size, unavailable `garmentId` matches, and malformed query combinations.                                                           | 2   | 2   | 4     | Resolve the contract rules and add table-driven Zod, controller, repository, and API boundary tests. Include wildcard, quote, Unicode, repeated parameter, and maximum-length cases.                                       | Product and API         | Before development    |

## NFR planning

| Category        | Threshold or invariant                                                                                                                                                       | Planned evidence                                                                                                       | Status                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Security        | Zero unauthorized capsule or join reads and mutations. Non-owned detail remains indistinguishable from missing detail. Analytics contains no user-authored content.          | RLS role matrix, API authorization tests, JWT claim abuse tests, strict analytics schema tests                         | Defined, with guardian API clarification required |
| Reliability     | Every state-changing transaction is atomic. Revision increments match committed state changes. The first ritual read after mutation is fresh even when Redis deletion fails. | Real Postgres race tests, Redis failure injection, cache revision integration tests, rollback and telemetry assertions | Defined                                           |
| Performance     | Library visibility is within two seconds after a successful mutation under the E2E profile.                                                                                  | Playwright elapsed-time measurement around the mutation response and rendered library state                            | Defined                                           |
| Performance     | Capsule list and ritual P95 latency under representative capsule cardinality.                                                                                                | k6 endpoint tags, thresholds, cardinality profile, and query plans                                                     | UNKNOWN                                           |
| Scalability     | Maximum expected capsules and constituent joins per user.                                                                                                                    | Load profile and seeded database volume                                                                                | UNKNOWN                                           |
| Accessibility   | WCAG 2.2 AA, 44 by 44 pixel targets, keyboard and focus behavior, and VoiceOver or TalkBack completion.                                                                      | Axe, Playwright keyboard and geometry assertions, component semantics tests, manual device evidence                    | Defined, with reorder semantics required          |
| Localization    | Identical key shape across 10 locales and no unapproved English fallback values.                                                                                             | Catalog parity, interpolation and plural tests, locale precedence tests, representative layout checks                  | Defined                                           |
| Maintainability | Tests remain isolated, parallel-safe, self-cleaning, focused, and free of hard waits.                                                                                        | `@couture/testing` factories, four-worker runs, changed-spec burn-in, traces and artifacts on failure                  | Defined by repository standards                   |

## Clarifications required before development

1. Can read-only and full-access guardians use capsule REST endpoints for a linked teen? If yes,
   how does a request identify the teen? If no, RLS and API expectations must be separated clearly.
2. What exact Web and Mobile interaction changes garment order? Define its accessible controls and
   announcements.
3. Does the two-second cross-surface requirement apply independently on each client, or does an
   open Web client need to reflect a Mobile mutation and vice versa?
4. How are the 60 and 280 character limits counted for Unicode text?
5. Does `garmentId` match an unavailable retained join, or only a currently available garment?
6. What are the valid `offset` range, maximum `q` length, expected capsule cardinality, and P95
   latency targets?

## Highest-risk summary

- 4.3-R02 is a score 9 release blocker until deterministic database race tests prove atomicity.
- 4.3-R01, 4.3-R03, 4.3-R04, 4.3-R05, 4.3-R06, 4.3-R07, and 4.3-R09 require
  mitigation evidence.
- The story should preserve E2E coverage for user journeys while relocating algorithmic,
  concurrency, and contract breadth to lower test levels.

## Coverage plan

Each row represents an atomic scenario group. Data variations stay table-driven at the selected
level. E2E repeats only the user-visible outcome for critical defense in depth.

| ID           | Requirement or risk scenario                                                                                                                                                                                                                            | Primary level and tool                     | Priority                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------- |
| 4.3-DB-001   | Apply the migration to an existing seeded schema. Verify defaults, enum array, indexes, policies, grants, and rollback safety.                                                                                                                          | DB integration, Vitest and PostgreSQL      | P0                        |
| 4.3-DB-002   | Enforce same-owner composite foreign keys, distinct garment and order constraints, zero-based order, capsule cascades, garment cascades, recommendation `SetNull`, and key reuse after deletion.                                                        | DB integration, Vitest and PostgreSQL      | P0                        |
| 4.3-DB-003   | Prove the complete RLS matrix for capsules and joins, including admin, revoked consent, unverified claims, user metadata spoofing, and service role.                                                                                                    | DB integration, Vitest and PostgreSQL      | P0                        |
| 4.3-API-001  | Create a valid capsule with ordered joins, revision increment, `201`, no-store headers, and one post-commit event. Force every write stage to fail and prove full rollback.                                                                             | API and real DB integration, Vitest        | P0                        |
| 4.3-API-002  | Normalize whitespace, empty description, occasion order, omitted favorite, and garment order. Verify identical replay, changed payload conflict, invalid key, same key across owners, concurrent identical requests, and concurrent different payloads. | API and real DB integration, Vitest        | P0                        |
| 4.3-API-003  | Race create or garment replacement against retention changes. Race two state-changing mutations. Assert eligibility at commit, no partial joins, and exact revision deltas.                                                                             | API and real DB integration with barriers  | P0                        |
| 4.3-API-004  | Mask missing and unauthorized detail as `404`. Verify every decided guardian API behavior and prevent cross-owner garment use.                                                                                                                          | API integration, Vitest                    | P0                        |
| 4.3-UNIT-001 | Validate metadata, occasion, garment count, uniqueness, UUID, boolean, pagination, query, Unicode, wildcard, and PATCH empty-body boundaries. Verify canonical hashes.                                                                                  | Unit, Vitest and Zod                       | P1                        |
| 4.3-API-005  | Search and filter independently and in combination. Verify totals, stable tie ordering, page boundaries, available-garment comfort matching, and the decided unavailable-garment behavior.                                                              | Repository and API integration, Vitest     | P1                        |
| 4.3-API-006  | Project `ready` and `needs_repair` capsules for each ineligible garment state, including zero available garments. Repair validly and reject repairs that leave fewer than two eligible garments.                                                        | API integration, Vitest                    | P0                        |
| 4.3-API-007  | Update, rename, reorder, set favorite, and delete. Verify state-changing and canonical no-op cases, revision behavior, event behavior, no-store headers on every status, `204` without a body, and later `404`.                                         | API integration, Vitest                    | P0                        |
| 4.3-UNIT-002 | Score exact, adjacent, and far comfort ranges at every adjusted temperature boundary. Verify dress and separates slots, cold outerwear, completeness multiplier, favorite addition order, ties, and canonical garment order.                            | Pure unit, table-driven Vitest             | P0                        |
| 4.3-UNIT-003 | Generate partial-fill candidates across missing slots, duplicate categories, exact or adjacent candidates, equal timestamps, exclusions, no-fill, occasion present or omitted, and no qualifying capsule.                                               | Pure unit, table-driven Vitest             | P0                        |
| 4.3-API-008  | Persist a winning capsule recommendation once. Verify losing capsules, fallback preservation, nullable metadata, auto-filled IDs, retention changes, deletion during generation, and one recommendation event.                                          | Service and DB integration, Vitest         | P0                        |
| 4.3-API-009  | Reject stale Redis and database recommendations. Verify first-read freshness, failed Redis scan or delete, corrupted or missing revision, concurrent ritual reads, and multiple concurrent capsule mutations.                                           | Redis and DB integration, Vitest           | P0                        |
| 4.3-UNIT-004 | Reject extra analytics properties and all name, description, media, and personal-content variants. Verify deterministic changed fields and exact event property schemas.                                                                                | Unit, Vitest and strict Zod                | P0                        |
| 4.3-API-010  | Emit mutation telemetry only after commit and once for replays or races. Verify no-op suppression and fail-open behavior when analytics delivery fails.                                                                                                 | Service integration with failure injection | P0                        |
| 4.3-PACT-001 | Exercise consumer request creation and response handling for `201`, replay `200`, filtered list, repair detail, update, favorite, `204`, ritual metadata, `400`, `404`, and both `409` errors. Assert no-store where consumers depend on it.            | Consumer and provider Pact                 | P1                        |
| 4.3-PACT-002 | Keep each Pact interaction isolated with deterministic provider setup and teardown. Run the existing three-pass contract determinism gate.                                                                                                              | Pact and Vitest single fork                | P0                        |
| 4.3-WEB-001  | Validate create and edit form states, count limits, native checkboxes, ordering controls, inline errors, disabled and double-submit behavior, announcements, Escape, focus trap, scroll lock, and focus restoration.                                    | Web component integration, Vitest browser  | P0                        |
| 4.3-WEB-002  | Validate empty, loading, error, filtered, ready, repair, delete-confirmation, and recommendation states. Verify viewed once per recommendation per screen lifetime and selected on detail open.                                                         | Web component integration, Vitest and MSW  | P1                        |
| 4.3-MOB-001  | Validate equivalent Mobile builder and library states, checkbox state, ordering controls, modal focus movement, restoration, announcements, delete confirmation, and duplicate-submit protection.                                                       | React Native component, Vitest and MSW     | P0                        |
| 4.3-MOB-002  | Verify viewed and selected analytics under rerender, navigation, retry, and screen remount rules.                                                                                                                                                       | Mobile component integration               | P1                        |
| 4.3-E2E-001  | Create a capsule through Web, observe the successful mutation response, and measure rendered library visibility within two seconds. Reload and verify ordered persistence.                                                                              | Playwright focused journey                 | P0                        |
| 4.3-E2E-002  | Repair a retained capsule, request a ritual, open the winning capsule, then favorite and delete it. Verify only user-visible outcomes and selected analytics.                                                                                           | Playwright focused journey                 | P1                        |
| 4.3-E2E-003  | Complete the builder using keyboard only. Verify semantic locators, focus behavior, target geometry, visible focus, live announcements, and axe results.                                                                                                | Playwright accessibility journey           | P0                        |
| 4.3-E2E-004  | Search and apply one representative combined filter. API integration owns the full filter matrix.                                                                                                                                                       | Playwright focused journey                 | P1                        |
| 4.3-MAE-001  | Create and reopen a capsule on one iOS and one Android reference device.                                                                                                                                                                                | Maestro focused journey                    | P0                        |
| 4.3-MAE-002  | Run repair and recommendation navigation as separate Mobile flows. Run one non-English locale smoke.                                                                                                                                                    | Maestro focused journeys                   | P1                        |
| 4.3-I18N-001 | Verify key, placeholder, interpolation, plural, and approved-proper-noun parity across all 10 Web and Mobile catalogs.                                                                                                                                  | Unit, Vitest                               | P1                        |
| 4.3-I18N-002 | Verify Web locale precedence, unsupported locale fallback, region fallback, and representative long-string layout. Preserve and regression-test Mobile locale resolution.                                                                               | Component and browser integration          | P1                        |
| 4.3-A11Y-001 | Complete create, reorder, repair, and delete with VoiceOver and TalkBack. Record device, OS, app build, steps, results, and defects.                                                                                                                    | Manual accessibility evidence              | P1                        |
| 4.3-PERF-001 | Measure filtered list and cold or warm ritual generation at agreed capsule cardinality. Enforce endpoint-tagged P95 and error-rate thresholds.                                                                                                          | k6                                         | P1, blocked on thresholds |
| 4.3-PERF-002 | Capture `EXPLAIN ANALYZE` evidence for search, occasion, favorite, garment, comfort, and deterministic sorting queries at agreed volume.                                                                                                                | PostgreSQL performance integration         | P1, blocked on volume     |
| 4.3-OPS-001  | Run new P0 and P1 tests with four workers and changed-spec burn-in. Upload traces, screenshots, Pact output, k6 summaries, and Maestro artifacts on failure.                                                                                            | GitHub Actions and local Maestro           | P1                        |

### NFR evidence plan

- Security: RLS and API authorization output, strict analytics schema results, and negative PII
  assertions.
- Reliability: Database race logs, revision and cache integration output, rollback assertions,
  four-worker results, and burn-in evidence.
- Performance: k6 summaries, tagged threshold results, two-second Playwright measurement, and
  PostgreSQL query plans. Capsule load thresholds remain a blocker.
- Accessibility: axe output, Playwright focus and geometry assertions, component semantics tests,
  plus signed VoiceOver and TalkBack evidence.
- Localization: 10-locale parity and interpolation reports, precedence results, and layout evidence.
- Maintainability: changed coverage report, Pact determinism output, test artifacts, and zero
  focused or quarantined tests.

### Execution strategy

- PR: Unit, component, API and DB integration, RLS, Pact, locale parity, focused P0 Playwright,
  k6 smoke, typecheck, lint, and build. Keep the functional path under 15 minutes through sharding
  and change selection.
- Nightly: Full Playwright browser matrix, P1 journeys, large-volume query-plan checks, race and
  cache burn-in, plus Maestro when stable device infrastructure is available.
- Weekly: Representative k6 load and soak profiles, Redis degradation drills, migration rehearsal,
  and full artifact review.
- Pre-release: Local iOS and Android Maestro runs plus manual VoiceOver and TalkBack evidence are
  mandatory under the current Mobile CI posture.

### Resource estimate

| Priority | Estimate                                                                    |
| -------- | --------------------------------------------------------------------------- |
| P0       | About 60 to 90 hours                                                        |
| P1       | About 45 to 70 hours                                                        |
| P2       | About 15 to 30 hours                                                        |
| P3       | About 5 to 10 hours                                                         |
| Total    | About 125 to 200 hours, roughly 4 to 6 person-weeks with parallel ownership |

### Quality gates

- P0 pass rate is 100 percent. P1 pass rate is at least 95 percent.
- Every acceptance criterion has test traceability. Changed critical logic meets at least 90
  percent branch coverage, with overall changed coverage at least 80 percent.
- 4.3-R02 has deterministic real-database race evidence. Every score 6 or higher risk has completed
  mitigation evidence.
- Pact generation is identical across three runs. Consumer and provider verification pass.
- New P0 and P1 Playwright tests pass changed-spec burn-in without retries masking a first-run
  failure. Four-worker execution is clean.
- Axe, keyboard, focus, target-size, locale parity, VoiceOver, and TalkBack requirements pass.
- Performance gates cannot pass until capsule cardinality and endpoint thresholds are approved.
- Final NFR status remains deferred to the NFR Evidence Audit after implementation evidence exists.

## Output and validation

- Execution mode: Sequential. Epic-level mode uses one output artifact, and no user override
  requested delegated execution.
- Output: `_bmad-output/test-artifacts/test-design-epic-4.3.md`.
- Template sections populated: scope, exclusions, risks, NFR plan, entry and exit criteria,
  coverage, execution strategy, estimates, prerequisites, gates, mitigations, assumptions,
  regression scope, and implementation handoff.
- Checklist result: Complete for a pre-implementation story review. Ambiguous requirements are
  recorded as required decisions. Final NFR classification and executable test results remain
  deferred until implementation evidence exists.
- Temporary artifacts: None. No browser session was started.
