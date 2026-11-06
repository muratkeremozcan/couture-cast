---
workflowType: 'testarch-test-review'
runScope: 'story'
runKey: 'story-6-13-immutable-moderation-history'
---

# Test quality review: Story 6.13 immutable moderation history

**Review date**: 2026-11-05
**Review mode**: full-file
**Reviewer**: an independent read by a fresh agent, because cc613-tea wrote these tests. cc613-tea verified each finding and made the fixes.
**Execution mode**: sequential
**Quality score**: not computed. The verdict below comes from the violation counts, which is the rule the rubric itself uses.

## Executive summary

**First pass: Request Changes**, because HIGH findings were open.
**After the fixes: Approve**, with every finding below fixed and the seeded-defect proofs rerun.
The independent read ran once, on the first pass, and no one re-read these fixes independently. The seeded proofs and the full runs in the test design are what check them.

The first pass found tests that were weaker than they looked, and two of them hid real information.
`I-E-LOCKED-OUT` asserted `status >= 403`, so it passed on a 500 that came from an incomplete storage double, and on a publish answer that was never the denial.
Making that assertion exact exposed a wrong answer in the product, which the builder fixed in `80a53081`.

## Findings and fixes

| #   | Rule | File                                         | Defect                                                                                                             | Fix                                                                                                          |
| --- | ---- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 1   | H3   | `moderation-history-erasure`                 | The subject race had no barrier and took `status < 500`, so a refused decision left no rows and passed             | Both orders forced, each with an exact status and row count                                                  |
| 2   | H1   | `moderation-history-erasure`                 | A 500 ms sleep stood in for "the second session is blocked"                                                        | `waitForLockWaiters` polls `pg_stat_activity`, and a second session that never blocks fails                  |
| 3   |      | `moderation-history-erasure`                 | `status >= 403` on every lockout route, and reaction and publish were never called                                 | Exact 403 and message on all five routes                                                                     |
| 4   | H10  | `moderation-history-erasure`                 | `.resolves.toBeDefined()` on a function that always returns an object                                              | Asserts the three counts are zero                                                                            |
| 5   |      | `moderation-history.retention.spec`          | The write-path scan exempted production `moderation-history.*` files                                               | Exempts spec files only, seeded as S-25                                                                      |
| 6   |      | `moderation-history.retention.spec`          | The prune scan saw client calls only, and the prunes here are raw SQL                                              | Scans raw `DELETE FROM` and `TRUNCATE`, seeded as S-28                                                       |
| 7   |      | `moderation-history-immutability`            | `D-EX-NO-SPOOF` ran on the application role, where the privilege refuses before the guard runs                     | Repeats on the superuser                                                                                     |
| 8   |      | `moderation-history-immutability`            | `D-IMM-BYPASS` matched only the SQLSTATE, which the guard shares, so a plain image could not tell the layers apart | Matches the privilege's own message, seeded as S-30                                                          |
| 9   |      | `moderation-history-immutability`            | Bare `BEGIN` with no rollback, so one failure aborted every later test on that connection                          | `committed()` rolls back and rethrows                                                                        |
| 10  |      | `moderation-history-migration`               | `D-MIG-CONCURRENT` never reached role creation, because the cluster role already exists                            | New `D-MIG-ROLE-RACE` runs the shipped statement in a forced order, seeded as S-26                           |
| 11  |      | `support/moderation-history-database`        | A failed migration leaked its database, and a killed run left a grant that kept `V-CLEAN` red                      | Drops on failure, sweeps abandoned databases by age, and revokes at setup                                    |
| 12  |      | `playwright/tests/moderation-history.spec`   | On a regression, `TRUNCATE` would commit on the stack the parallel workers share                                   | One rolled-back transaction, with savepoints                                                                 |
| 13  | H2   | `playwright/tests/moderation-history.spec`   | The range used today's date, computed after the decision, so a run crossing UTC midnight failed                    | Uses the decision's own `decided_at`                                                                         |
| 14  | M1   | `playwright/tests/moderation-history.spec`   | `not.toContainText` could pass on a page that had not loaded                                                       | Waits for the decision panel first                                                                           |
| 15  | H1   | `moderation-evidence-export.test`            | A timed wait could assert an empty DOM before the availability answer rendered                                     | A `Profiler` commit count is the latch, seeded as S-27                                                       |
| 16  | C3   | `moderation-history-gate.spec`               | `every(commit.length === 40)` restated what the regex had already guaranteed                                       | Removed. A squash merge makes existence uncheckable later, so `M-GATE-READ` checks it once                   |
| 17  |      | `moderation-history-route`                   | An assertion read back the test's own insert                                                                       | Asserts the bundle's `actorId`                                                                               |
| 18  |      | `pact/http/consumer/interactions/moderation` | Only erased rows were pinned, so the live types of nullable columns could drift unseen                             | A second interaction with live rows, and its provider state                                                  |
| 19  |      | `moderation-history-contract.spec`           | The header claimed `U-C-OPENAPI`, which the file does not implement                                                | The header names `http-openapi.spec.ts` and `schema-validation.yml`, which do                                |
| 20  | H5   | `moderation-history-immutability`, `-route`  | 1321 and 1069 lines                                                                                                | Split into `-function`, `-migration` and `-route-period`, with shared fixtures. The largest is now 593 lines |

## Corrected while verifying

A first reading of finding 3 looked like an erased member could allocate a draft, because allocate reached the storage call just as a live member's did.
A complete storage double showed `createPostDraft` refusing with 403, so nothing is written, and this was not a defect.
The upload session is minted before that refusal and never returned to the member.

## Found by the unfiltered run, and missed by every filtered one

Five older specs still asserted the state before this story.
All five were stale expectations, and no product behavior was wrong.

- `moderation-sanctions`: a subject's decision keeping its reason.
- `community-privacy-matrix`: a post row surviving its purge.
- `moderation-sla-operations`: the runbook's open staffing signature.
- `moderation-queue-contract`: a fixture with no `reasonRemoved`.
- `analytics-tracking`: a Prisma mock with no namespace, which failed the whole file at import.

The first full run at `92d17916` also failed `4.4-DB-003` and `D-RLS-AUDIT`, because my database prep did not match `pr-checks.yml`.
The prep now grants default privileges to `authenticated` only, as CI does.

## After this review

An independent Codex review of `1175a24c` found three major gaps this plan had not named (C1, C2, C3), and its tests had not caught them.
Hunting siblings of those gaps added 17 tests that were red against the unfixed source, and the `I-S` and `I-O` scenarios now keep them closed.
A later range test found a conflict link outside the period, and a visual pass found `lang="en"` in every locale. Both are fixed and tested.

## Decision

**Approve.** Results of the three consecutive full runs are in the test design's Execution record, at `743f179a`.
