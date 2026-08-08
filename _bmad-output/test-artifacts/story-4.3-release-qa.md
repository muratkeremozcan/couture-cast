<!-- markdownlint-disable MD013 -->

# Story 4.3 Release QA Artifact — Outfit Capsule Builder

Updated: 2026-08-08

This artifact records the verification evidence required by Story 4.3 Tasks 8, 9,
and 10. Sections marked **PENDING** require a live environment or a physical
device and must be completed by a human operator before release approval.

---

## 1. Automated suite results

Recorded from a local run at the commit that introduced this artifact.

| Suite                                     | Command                                                                   | Result                    |
| ----------------------------------------- | ------------------------------------------------------------------------- | ------------------------- |
| API unit + integration                    | `npm run test --workspace api`                                            | **559 passed**, 5 skipped |
| API capsule integration (real PostgreSQL) | `vitest run integration/wardrobe-capsules.integration.spec.ts`            | **11 passed**             |
| API capsule query plans (real PostgreSQL) | `vitest run integration/wardrobe-capsules-query-plan.integration.spec.ts` | **6 passed**              |
| Web                                       | `npm run test --workspace web`                                            | **97 passed**             |
| Mobile                                    | `npm run test --workspace mobile`                                         | **139 passed**            |

The capsule integration and query-plan suites skip with an explicit warning when
the target database has not had the Story 4.3 migration applied. They must be
run against a migrated database for this artifact to be valid; a skipped run is
not evidence.

### Database used for the real-PostgreSQL runs

A throwaway database was created, migrated from the full 29-migration history,
exercised, and dropped. This proves the migration applies cleanly from scratch,
including the composite same-owner foreign key, the `pg_trgm` extension, and the
`CapsuleTelemetryClaim` table.

```
createdb couture_cast_story43_verify
DATABASE_URL=... npx prisma migrate deploy     # All migrations successfully applied
INTEGRATION_TEST_DATABASE_URL=... npm run test --workspace api
dropdb couture_cast_story43_verify
```

---

## 2. Risk 4.3-R02 — transaction and retention races

Declared release-blocking by the story. Discharged by
`apps/api/integration/wardrobe-capsules.integration.spec.ts`, which runs against
real PostgreSQL using two independent `PrismaClient` connections and
deterministic barriers rather than timed sleeps.

| Scenario                                 | Test         | Evidence                                                               |
| ---------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| Lock graph acquires real rows            | `4.3-INT-01` | Create succeeds; profile revision reaches 1                            |
| Concurrent update with the same ETag     | `4.3-INT-02` | Exactly one succeeds; the loser receives `412`; final revision is 2    |
| Idempotent replay and payload conflict   | `4.3-INT-03` | Replay returns the same capsule; changed payload returns `409`         |
| Two connections race one idempotency key | `4.3-INT-04` | Exactly one capsule row; join order contiguous `[0,1]`                 |
| Ineligible garment rejected              | `4.3-INT-05` | `upload_status != ready` returns `409`; no capsule persisted           |
| Rollback at a write stage                | `4.3-INT-06` | No capsule, no joins, no telemetry claim; key remains reusable         |
| Exactly one telemetry claim per mutation | `4.3-INT-07` | One row; `mutation_key` is `<capsule>:<revision>:<event>`; undelivered |
| Canonical no-op                          | `4.3-INT-08` | No revision change, no profile change, no claim                        |
| Atomic ordered join replacement          | `4.3-INT-09` | Joins rewritten contiguously; `changedFields` is `['garmentIds']`      |
| Hard delete releases the key             | `4.3-INT-10` | Capsule and joins gone; key reusable                                   |
| Stale precondition                       | `4.3-INT-11` | `412`; no state, no revision change                                    |

**Status: SATISFIED** by automated evidence.

---

## 3. Query-plan evidence

`apps/api/integration/wardrobe-capsules-query-plan.integration.spec.ts` captures
`EXPLAIN (ANALYZE, BUFFERS)` for each read path.

| Path                | Test          | Assertion                                                        |
| ------------------- | ------------- | ---------------------------------------------------------------- |
| Index inventory     | `4.3-PLAN-01` | Composite listing, both trigram, and GIN occasions indexes exist |
| Owner listing order | `4.3-PLAN-02` | Index scan; no sequential scan of `OutfitCapsule`                |
| Keyword search      | `4.3-PLAN-03` | Served by a `*_trgm_idx`                                         |
| Occasion filter     | `4.3-PLAN-04` | Served by `OutfitCapsule_occasions_idx`                          |
| Favorite filter     | `4.3-PLAN-05` | No sequential scan                                               |
| Garment join filter | `4.3-PLAN-06` | Resolved as a join; no per-row `SubPlan`                         |

Text and occasion predicates are explained in isolation. With an owner filter
present the planner reasonably prefers the highly selective `user_id` index and
filters afterwards, which would mask whether the specialized index exists at all.

**Status: SATISFIED** by automated evidence at the seeded volume.
Capturing plans at the full 1,000-capsule / 10,000-join profile is **PENDING** and
requires the performance fixture environment.

---

## 4. k6 capacity thresholds

Scenarios and thresholds are defined in `k6/tests/couture-api-baseline.k6test.ts`
and `k6/helpers/config.ts`. Every capsule request is individually tagged so a
breach names the endpoint responsible.

| Tag                    | Threshold                     | Story requirement                   |
| ---------------------- | ----------------------------- | ----------------------------------- |
| `capsules/list`        | P95 < 300 ms, error rate < 1% | List                                |
| `capsules/detail`      | P95 < 300 ms, error rate < 1% | Detail                              |
| `capsules/search`      | P95 < 300 ms, error rate < 1% | Filtered search                     |
| `capsules/create`      | P95 < 500 ms, error rate < 1% | Create                              |
| `capsules/update`      | P95 < 500 ms, error rate < 1% | PATCH                               |
| `capsules/favorite`    | P95 < 500 ms, error rate < 1% | Favorite                            |
| `capsules/delete`      | P95 < 500 ms, error rate < 1% | Delete                              |
| `capsules/ritual-cold` | P95 < 800 ms, error rate < 1% | Cold ritual with capsule evaluation |

Run with `CAPSULE_PERF_USER_ID` pointing at the representative 1,000-capsule
owner, against a warmed application.

**Status: PENDING execution.** The scenarios and thresholds are committed and
type-check; measured P95 numbers require the load environment.

| Field            | Value                    |
| ---------------- | ------------------------ |
| Date             | _to be completed_        |
| Environment      | _to be completed_        |
| Command          | `npm run test:k6:local`  |
| Summary artifact | _attach k6 summary JSON_ |
| Result           | _PASS / FAIL per tag_    |

---

## 5. Playwright end-to-end

| Spec                                                      | Scenarios                                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright/tests/wardrobe-capsule-create.spec.ts`        | `4.3-E2E-01` create within 2s of the response; `4.3-E2E-02` order survives reload; `4.3-E2E-03` second client refreshes on focus; `4.3-E2E-04` combined filter journey                                                                                    |
| `playwright/tests/wardrobe-capsule-repair.spec.ts`        | `4.3-E2E-05` repair; `4.3-E2E-06` favorite within 2s; `4.3-E2E-07` delete via confirmation; `4.3-E2E-08` saved-capsule badge                                                                                                                              |
| `playwright/tests/wardrobe-capsule-accessibility.spec.ts` | `4.3-A11Y-01` axe on library and dialog; `4.3-A11Y-02` keyboard-only creation; `4.3-A11Y-03` focus at reorder boundary; `4.3-A11Y-04` polite announcement; `4.3-A11Y-05` 44px targets; `4.3-A11Y-06` focus restoration; `4.3-A11Y-07` named delete dialog |

Each journey asserts one representative network contract. Full filter matrices,
idempotency conflicts, cache failures, and retention races stay in the API and
integration suites.

**Status: PENDING execution.** Requires the Playwright environment with seeded
wardrobe data.

| Field                | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| Date                 | _to be completed_                                               |
| Command              | `npm run test:pw-local -- wardrobe-capsule`                     |
| Burn-in              | `npm run test:pw:burn-in-changed` (3 repetitions, zero retries) |
| Traces / screenshots | _attach on failure_                                             |
| Result               | _PASS / FAIL_                                                   |

---

## 6. Maestro mobile flows

| Flow                                             | Purpose                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `maestro/garment-capsule-create-flow.yaml`       | Create, reorder via accessible controls, reopen, verify persisted order, public-API cleanup |
| `maestro/garment-capsule-repair-flow.yaml`       | Repair an unavailable garment, favorite, recommendation navigation                          |
| `maestro/garment-capsule-localization-flow.yaml` | Turkish locale strings and localized validation                                             |

**Status: PENDING execution.** Requires one iOS and one Android reference device.

| Field      | iOS                 | Android             |
| ---------- | ------------------- | ------------------- |
| Device     | _to be completed_   | _to be completed_   |
| OS version | _to be completed_   | _to be completed_   |
| App build  | _to be completed_   | _to be completed_   |
| Result     | _PASS / FAIL_       | _PASS / FAIL_       |
| Artifacts  | _attach on failure_ | _attach on failure_ |

---

## 7. Manual accessibility verification

The automated suites assert semantics that render to the DOM. Native
`accessibilityState` mapping, VoiceOver rotor behaviour, and TalkBack focus
order can only be confirmed on a device.

**Status: PENDING.** Required before release approval.

### VoiceOver (iOS)

| Field       | Value             |
| ----------- | ----------------- |
| Device / OS | _to be completed_ |
| App build   | _to be completed_ |
| Reviewer    | _to be completed_ |
| Date        | _to be completed_ |

| #   | Step                        | Expected                                            | Actual | Result |
| --- | --------------------------- | --------------------------------------------------- | ------ | ------ |
| 1   | Open the capsule library    | Screen title announced; Create button reachable     |        |        |
| 2   | Open the builder            | Focus moves to the heading; content behind is inert |        |        |
| 3   | Swipe to a garment row      | Announced as a checkbox with checked state          |        |        |
| 4   | Activate a garment row      | Checked state announced as changed                  |        |        |
| 5   | Activate Move down on row 1 | "Moved …to position 2 of N" announced               |        |        |
| 6   | Move a row to the top       | Move up announced as disabled; focus stays usable   |        |        |
| 7   | Submit with no name         | Error announced assertively                         |        |        |
| 8   | Close the builder           | Focus returns to the invoking control               |        |        |
| 9   | Delete a capsule            | Confirmation announced; destructive action clear    |        |        |

### TalkBack (Android)

| Field       | Value             |
| ----------- | ----------------- |
| Device / OS | _to be completed_ |
| App build   | _to be completed_ |
| Reviewer    | _to be completed_ |
| Date        | _to be completed_ |

Same nine steps as above.

### Defects found

| #   | Step | Severity | Description | Resolution |
| --- | ---- | -------- | ----------- | ---------- |
|     |      |          |             |            |

---

## 8. Pact contract determinism

Consumer interactions for create, idempotent replay, list, detail, update,
favorite, delete, and the documented error envelopes are defined in
`pact/http/consumer/api-contract-interactions.ts` and wired into both the web
and mobile consumer suites. Provider states are registered in
`pact/http/provider/state-handlers.ts`.

**Status: PENDING execution.**

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| Date             | _to be completed_                            |
| Command          | `npm run test:pact`                          |
| Determinism gate | `npm run test:pact:consumer` run three times |
| Result           | _PASS / FAIL_                                |

---

## 8b. Schema drift

`prisma migrate diff` reports zero drift for every capsule object: the composite
recommendation foreign key, the `pg_trgm` extension, and the GIN and trigram
indexes are all declared in `schema.prisma`. Five drift statements remain on
`WeatherIngestionState`, `feature_flags`, `AlertCooldownReservation`, and
`AlertDeliveryOutbox`; these predate this story and are unrelated to capsules.

---

## 9. Open items blocking release approval

1. k6 capacity run at the 1,000-capsule profile — Section 4.
2. Playwright execution and three-repetition burn-in — Section 5.
3. Maestro on one iOS and one Android reference device — Section 6.
4. Manual VoiceOver and TalkBack evidence — Section 7.
5. Pact provider verification and the three-run determinism gate — Section 8.
6. `EXPLAIN` capture at full representative volume — Section 3.

Items 1 through 6 require a live environment or physical hardware and cannot be
discharged from the repository alone.
