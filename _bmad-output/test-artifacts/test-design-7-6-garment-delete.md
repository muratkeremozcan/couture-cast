# Test design: Story CC-7.6 garment delete

Updated: 2026-11-25. Initial plan from spec-7-6 (in-progress, baseline 246577af).
Updated: 2026-11-25. Builder decisions D8-D10 and the D4 release trigger folded in.
Updated: 2026-11-25. Follow-up source fixes: gone sends an idempotent DELETE, late Undo, identity
epochs, commitNow order, leave-flush failure notice.
Updated: 2026-11-25. Usage counts, 404 states, IDOR and D8 moved from mocked controller units
(UNIT-023..028, 030) to pg17 (INT-001..008): the real query and the real guards are the oracle.

Status: active

## Scope

Spec: `_bmad-output/implementation-artifacts/spec-7-6-garment-delete.md`. Acceptance criteria from
epics.md CC-7.6:

1. An unused piece shows "Deleted" with Undo for 5 seconds. A piece used by saved looks or
   capsules asks once and names how many looks it affects.
2. On success the piece leaves active closet results, capsules keep `needs_repair` and saved looks
   show the CC-7.2 missing-piece state.
3. The member returns to the grid at the same scroll position.
4. Tests cover retry, legal hold and the asynchronous retention purge.

Plus the spec decisions D1 (deferred client commit), D2 (usage read), D3 (usage failure, 404 as
gone), D4 (legal hold records the request), D5 (purge failure answers 204, sweep finishes), D6
(failed commit returns the piece with Retry) and D7 (focus and native pop).

## Risk assessment

| ID  | Risk                                                                                                   | P   | I   | Score | Mitigation (test IDs)                                                 |
| --- | ------------------------------------------------------------------------------------------------------ | --- | --- | ----- | --------------------------------------------------------------------- |
| R1  | Undo fails open: a DELETE is sent inside the window, or the piece is purged after Undo                 | 2   | 3   | 6     | 7.6-UNIT-001..004, 7.6-CMP-004, 7.6-E2E-001, 7.6-NAT-004              |
| R2  | Lost delete: the window never commits (page hide, navigation, backgrounding, second delete)            | 2   | 3   | 6     | 7.6-UNIT-005..007, 7.6-CMP-006..007, 7.6-NAT-006, 7.6-E2E-001         |
| R3  | Legal hold broken: held bytes purged, or the hold reveals itself to the member                         | 1   | 3   | 3     | 7.6-UNIT-020..021, 7.6-INT-004..005                                   |
| R4  | Released-hold or purge-deferred row reappears in list, capsules, saved looks, outfits before the sweep | 2   | 3   | 6     | 7.6-UNIT-022, 7.6-INT-005..006                                        |
| R5  | Wrong usage count (soft-deleted looks, anchor and slot double count, other member's rows)              | 2   | 2   | 4     | 7.6-INT-001..002, 7.6-INT-007                                         |
| R6  | Usage read leaks another member's garment existence or counts (IDOR)                                   | 1   | 3   | 3     | 7.6-INT-007..008                                                      |
| R7  | Failed commit loses the piece from the grid or shows Deleted; Retry re-enters a new window             | 2   | 2   | 4     | 7.6-CMP-008..009, 7.6-NAT-005, 7.6-E2E-002                            |
| R8  | Confirm path wrong: unused piece prompts, used piece skips the prompt, plural form wrong               | 2   | 2   | 4     | 7.6-CMP-002..003, 7.6-NAT-003, 7.6-E2E-001, 7.6-E2E-002               |
| R9  | Grid scroll or focus lost after delete (AC3)                                                           | 2   | 2   | 4     | 7.6-CMP-010, 7.6-E2E-001, 7.6-NAT-007                                 |
| R10 | Purge throws after the flip and DELETE answers 5xx, so the client shows a failure for a deleted piece  | 2   | 2   | 4     | 7.6-UNIT-021, 7.6-INT-006                                             |
| R11 | Saved looks and capsules do not follow the delete (missing piece, needs repair)                        | 2   | 2   | 4     | 7.6-INT-003, 7.6-CMP-011, 7.6-E2E-002                                 |
| R12 | Maestro flow deletes a shared fixture garment and breaks the tag-edit and capsule flows                | 2   | 2   | 4     | 7.6-MAE-001 deletes only a dress its own state hook seeds and removes |

Gate: every score 6 risk needs a passing P0 test at two levels before merge.

## Test matrix

Priorities follow `test-priorities-matrix.md`. Levels: UNIT (pure function, contract schema, Nest
controller/service with doubles), INT (Nest over the pg17 integration DB), PACT, CMP (web vitest
component), NAT (mobile jest component), E2E (Playwright phone 390x844), MAE (Maestro Android PR
lane).

### Shared deferred-deletion controller (`packages/utils`, builder-owned spec, TEA review)

All with the injectable timer; no real sleeps.

| ID           | P   | Behavior                                                                                                                                          |
| ------------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.6-UNIT-001 | P0  | `schedule` hides the id at once (`pendingIds`), calls `commit` exactly once after 5000 ms                                                         |
| 7.6-UNIT-002 | P0  | At 4999 ms no commit; `undo` before the end cancels, `commit` never runs, id leaves pending                                                       |
| 7.6-UNIT-003 | P0  | `undo` after commit started is a no-op that reports false (no restore of a sent delete)                                                           |
| 7.6-UNIT-004 | P1  | `undo` of an unknown id is a no-op; subscribers notified once per state change                                                                    |
| 7.6-UNIT-005 | P0  | Scheduling a second id commits the first at once; the second gets its own full window                                                             |
| 7.6-UNIT-006 | P0  | `flush` commits every pending id once; a second `flush` and the late timer send nothing more                                                      |
| 7.6-UNIT-007 | P1  | A commit that rejects reports the id as failed to subscribers, never as committed                                                                 |
| 7.6-UNIT-008 | P2  | Window length reads `SAVE_FEEDBACK_TIMINGS.statusBarDurationMs` (no second 5000 constant)                                                         |
| 7.6-UNIT-013 | P0  | `commitNow` sends at once with no window (confirmed delete, Retry); a piece inside its window commits once; D9 failure while a later delete waits |
| 7.6-UNIT-014 | P1  | `reset` drops pending deletes without committing; a late settle leaves a newer delete of the same id alone                                        |
| 7.6-UNIT-015 | P1  | A throwing listener never stops the commit or the events other listeners get (builder)                                                            |

### Contract (`packages/api-client`)

| ID           | P   | Behavior                                                                                                                                            |
| ------------ | --- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.6-UNIT-010 | P0  | `garmentUsageResponseSchema` accepts `{ garmentId, savedLookCount, capsuleCount }`; rejects extra keys, negative or fractional counts, missing keys |
| 7.6-UNIT-011 | P1  | OpenAPI registers `DELETE /garments/{garmentId}` (204, no body) and `GET .../usage` (200, 404)                                                      |
| 7.6-UNIT-012 | P1  | OpenAPI version pin 1.11.0 (`community-openapi-contract.spec.ts`)                                                                                   |

### API (`apps/api`)

| ID           | P   | Behavior                                                                                                                                                                                                                                                                           |
| ------------ | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.6-UNIT-020 | P0  | `requestDeletion` on a held garment records `deletion_requested_at` and trigger; `retention_status` stays `legal_hold`; no purge called                                                                                                                                            |
| 7.6-UNIT-021 | P0  | Flip commits, purge throws: resolves (no throw), logs `wardrobe_retention_purge_deferred`, row stays `deletion_pending`                                                                                                                                                            |
| 7.6-UNIT-022 | P0  | Sweep still excludes `legal_hold` rows that carry a recorded request; purges `deletion_pending` rows the release trigger wrote                                                                                                                                                     |
| 7.6-UNIT-029 | P1  | Repeat DELETE on a purged or pending garment answers 204 and calls no purge                                                                                                                                                                                                        |
| 7.6-INT-001  | P0  | pg17 HTTP: unused ready garment, usage 0/0, DELETE 204, list no longer returns it, row purged (`retention_purged_at`)                                                                                                                                                              |
| 7.6-INT-002  | P0  | pg17 HTTP: garment in 2 saved looks (anchor; slot) + 1 soft-deleted look + 1 capsule: usage `savedLookCount: 2, capsuleCount: 1`                                                                                                                                                   |
| 7.6-INT-003  | P0  | pg17 HTTP: after DELETE of that garment, saved looks read the missing-piece slot and the capsule reads `needs_repair`                                                                                                                                                              |
| 7.6-INT-004  | P0  | pg17: legal hold: DELETE 204, row `legal_hold`, request recorded, object path and storage kept, hourly sweep leaves it                                                                                                                                                             |
| 7.6-INT-005  | P0  | pg17 trigger: operator release (`legal_hold` to `active`) of a row with a recorded request lands `deletion_pending`; list, capsule eligibility, generation and saved looks (`missing_garment`) exclude it; hourly sweep purges it. Release of a row with no request stays `active` |
| 7.6-INT-006  | P0  | pg17: purge transaction fails once (fault at `purgeGarment`): DELETE 204, row `deletion_pending`, hidden; next sweep purges; repeat DELETE 204                                                                                                                                     |
| 7.6-INT-007  | P1  | pg17: member B usage on A's garment 404, DELETE 204, A's row and list unchanged                                                                                                                                                                                                    |
| 7.6-INT-008  | P0  | pg17 (D8): guardian-pending teen reads usage 200 and deletes 204 (purged); upload-url still 403; suspended account refused, row untouched                                                                                                                                          |
| 7.6-PACT-001 | P1  | Consumer: usage read returns the strict shape; provider state seeds a garment in one saved look and one capsule                                                                                                                                                                    |
| 7.6-PACT-002 | P1  | Consumer: DELETE garment answers 204 with no body                                                                                                                                                                                                                                  |

### Web

| ID          | P   | Behavior                                                                                                                                                                                            |
| ----------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.6-CMP-001 | P0  | `lib/wardrobe`: `getGarmentUsageFromWeb` parses strict; `deleteGarmentFromWeb` sends DELETE with auth; `keepalive` when asked (the closet asks on every send); 404 usage reads as gone              |
| 7.6-CMP-002 | P0  | Detail Delete on an unused piece: no prompt, detail closes, piece hidden, "Deleted" with Undo, zero DELETE until 5000 ms, then exactly one                                                          |
| 7.6-CMP-003 | P0  | Used piece: one prompt `garment-delete-confirm` naming 3 looks (`_other`) and 1 look (`_one`); Cancel sends nothing; accept sends DELETE at once, "Deleted", no Undo                                |
| 7.6-CMP-004 | P0  | Undo inside the window: zero DELETE, piece back in its original position, "Undone"; an Undo after the send started re-shows Deleted with no Undo                                                    |
| 7.6-CMP-005 | P1  | Usage read fails: nothing hidden, nothing sent, error with Retry; Retry re-reads usage; `GARMENT_NOT_FOUND` 404 is gone and sends one idempotent DELETE at once; a route-level 404 is a failed read |
| 7.6-CMP-006 | P0  | `pagehide` and `visibilitychange` hidden inside the window send the DELETE at once; every closet send carries `keepalive: true` (the DELETE has no body); unmount flushes                           |
| 7.6-CMP-007 | P0  | A second delete inside the window commits the first at once; the second keeps its own Undo; a confirmed delete sends a waiting delete first                                                         |
| 7.6-CMP-008 | P0  | Commit fails (network, 500, 403): piece returns, "Couldn't delete" with Retry, offline tone when offline; never "Deleted"                                                                           |
| 7.6-CMP-009 | P0  | Retry sends one DELETE at once (no second window); 204 removes the piece and shows "Deleted"                                                                                                        |
| 7.6-CMP-010 | P1  | Grid scroll restored after the detail closes; focus moves to the next card, else previous, else grid heading                                                                                        |
| 7.6-CMP-011 | P1  | After a committed delete saved looks reload (attempt bumped); a look holding the piece shows the missing-piece row                                                                                  |
| 7.6-CMP-012 | P2  | Delete control absent on non-ready garments                                                                                                                                                         |

### Mobile

| ID          | P   | Behavior                                                                                                                                                      |
| ----------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.6-NAT-001 | P0  | `lib/wardrobe`: usage strict parse, DELETE with bearer, 404 usage as gone                                                                                     |
| 7.6-NAT-002 | P0  | Detail Delete on an unused piece: no prompt, `router.back()`, hub hides the piece, "Deleted" with Undo, DELETE only after 5000 ms                             |
| 7.6-NAT-003 | P0  | Used piece: in-screen confirm with count and plural form; Cancel sends nothing; accept deletes at once                                                        |
| 7.6-NAT-004 | P0  | Undo inside the window: zero DELETE, piece back, "Undone"; late Undo re-shows Deleted with no Undo; events from another identity epoch are ignored            |
| 7.6-NAT-005 | P0  | Commit fails: piece returns, failure with Retry; Retry deletes at once; Retry rebuilds the commit with the live bearer; a pending id is never requested twice |
| 7.6-NAT-006 | P0  | `AppState` to `background` inside the window sends the DELETE at once                                                                                         |
| 7.6-NAT-007 | P1  | Hub stays mounted under the pushed detail and keeps its scroll offset after the pop; `notifyWardrobeChanged` after commit                                     |

### End to end

| ID          | P   | Behavior                                                                                                                                                                                                           |
| ----------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7.6-E2E-001 | P0  | Local real API at 390x844: two seeded ready garments, scroll, open the lower one, Delete, grid at same scroll, "Deleted"; Undo, zero DELETE, piece back; Delete again, DELETE 204 after window, reload, piece gone |
| 7.6-E2E-002 | P0  | Local real API: garment in a saved look and a capsule: prompt names 2 looks, Cancel keeps it, accept deletes; saved look shows missing piece; capsule needs repair after reload                                    |
| 7.6-E2E-003 | P1  | Phone, real API with one intercepted DELETE answering 500 (`interceptNetworkCall`): piece returns, Retry, real 204, reload gone                                                                                    |
| 7.6-E2E-004 | P2  | axe on the confirm dialog and the Deleted notice (`checkA11y`); confirm reachable and dismissable by keyboard, focus returns to Delete on Cancel                                                                   |
| 7.6-MAE-001 | P1  | Android: open the flow's own seeded dress, Delete, Deleted with Undo, Undo brings it back, Delete again, the window ends, relaunch: the newest card is no longer the dress                                         |

## Ownership

Builder owns source, the deferred controller spec in `packages/utils` (UNIT-001..008, TEA reviews),
the `REQUIRED_KEYS` additions to both `wardrobe-detail-locales.spec.ts`, and any existing test a
source change breaks (for example list fixtures that now need `deletion_requested_at: null`).

TEA owns:

- `packages/api-client/testing/wardrobe-contract.spec.ts` additions (UNIT-010..011) and the
  `community-openapi-contract.spec.ts` version pin (UNIT-012)
- `apps/api/src/modules/wardrobe/wardrobe-retention.service.spec.ts` additions (UNIT-020..022,
  UNIT-029; UNIT-020 replaces the pre-7.6 legal-hold test, which asserted no write at all)
- `apps/api/integration/wardrobe-garment-delete-http.integration.spec.ts` (new; INT-001..008)
- Pact: `pact/http/consumer/interactions/wardrobe-garment-delete.ts` (new), consumer
  registrations, `pact/http/provider/doubles/wardrobe.ts` and its provider state (PACT-001..002)
- `apps/web/src/lib/wardrobe.test.ts` additions (CMP-001)
- `apps/web/src/app/wardrobe/garment-detail.test.tsx` additions and
  `apps/web/src/app/wardrobe/page.garment-delete.test.tsx` (new; CMP-002..012)
- `apps/mobile/src/lib/wardrobe.test.ts` additions (NAT-001),
  `garment-detail-screen.test.tsx` additions (NAT-002..003),
  `wardrobe-hub-screen.garment-delete.test.tsx` (new; NAT-004..007)
- `playwright/tests/wardrobe-garment-delete.spec.ts` (new; E2E-001..004) and any saved-look or
  capsule seeding helper it needs under `playwright/support/helpers/`
- `maestro/garment-delete-flow.yaml`, its `GARMENT_DELETE_FLOW` state hook in
  `scripts/lib/mobile-e2e-flow-state.mjs` (+ `.d.mts`, node test) and its
  `scripts/maestro-flow-durations.json` estimate (MAE-001)

## Decisions settled with the builder (2026-11-25)

1. D8: DELETE and usage move to `WardrobeGarmentRemovalController` under `RequestAuthGuard` only;
   a member can always delete their own data. INT-008.
2. D4 trigger: a BEFORE UPDATE trigger turns a `legal_hold` to `active` release of a row with a
   recorded request into `deletion_pending`, so every active-garment reader (list, capsules,
   generation, saved looks) stays correct with no filter change. INT-005 proves it on pg17.
3. D9: when the first commit fails during a second window, the first piece returns with its
   failure and Retry; the second stays hidden and commits on its own timer.
4. Retry after a failed commit sends at once, no new Undo window (CMP-009, NAT-005).
5. D10: web page and native hub take an optional injected controller; the module instance
   exposes a reset for tests.

## Test-ability asks for the builder

- Test ids per the spec Code Map (`garment-delete`, `garment-delete-confirm`,
  `garment-delete-confirm-count`, `garment-delete-confirm-accept`, `garment-delete-cancel`) on web
  `data-testid` and native `testID`. Status bar ids unchanged.
- The deferred controller takes an injectable timer and reads the window from
  `SAVE_FEEDBACK_TIMINGS`; tests use fake timers, never sleeps.
- Web and native page/hub accept an injected controller or expose the module instance with a
  reset hook for tests, so one test's pending delete never leaks into the next.
- `wardrobe_retention_purge_deferred` log carries `garmentId` only (no path, no user content).

## Execution

CI is the proof (RULES). Locally only tsc and eslint on touched files. Integration runs on the CI
pg17 lane. E2E-001..003 run on the local real-API PR lane; E2E-004 runs everywhere the wardrobe
specs run. MAE-001 runs on the Android PR shard. Each new test file carries the learning path
Step 64 cross-link comment.

## Exit criteria

- All P0 and P1 tests above pass in CI on the PR head; no skips added.
- R1, R2 and R4 each covered at two levels and green.
- Burn-in of the new Playwright spec through the existing burn-in workflow stays green.
