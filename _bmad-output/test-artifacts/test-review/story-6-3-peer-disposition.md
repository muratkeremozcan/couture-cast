# Story 6.3 Codex peer disposition

Updated: 2026-10-19. Independent review followed by targeted test expansion.

The original peer report is `story-6-3-codex-peer.md`. Its full-file rubric score and
Request Changes verdict remain intact. The review demonstrated no new production defect.
Root accepts the concrete test gaps and repairs below. The peer is implementing them through
`bmad-tea-automate`, expand Create, with focused sequential execution. Verification evidence
will be appended after that handoff.

## Accepted actions

| Review item                         | Disposition                         | Required proof                                                                                                  |
| ----------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Advisory 1, recommendations 2 and 3 | Repair web/native async tests       | Await consumed-response witnesses; seed a broken fence/reconciliation and observe failure                       |
| Recommendation 1                    | Isolate global outbox scenarios     | Real DB isolation, unchanged unrelated sentinel, no global rescheduling, failure-safe cleanup                   |
| Advisory 2                          | Add competing-worker tests          | A stale success or failure cannot settle B's lease; simultaneous claims deliver once                            |
| Advisory 3                          | Add module HTTP privacy tests       | Middleware protects successes and guard/controller refusals; strict legacy schemas and viewer-specific state    |
| Advisory 4                          | Add direct-role write refusal tests | Both client roles receive 42501 for three tables and three write verbs; no FK oracle or privileged-state change |
| Advisory 5                          | Add generated-client contracts      | Both consumers cover 409, 429 Retry-After and negotiated feed through real SDK calls                            |
| Recommendations 4 and 6             | Control sweep clocks                | Explicit deadline progression with real DB I/O and no host-duration sleeps                                      |
| Recommendation 5                    | Adopt composed polling utilities    | Existing bounded deadline, terminal predicate and diagnostic survive recurse/apiRequest migration               |
| Recommendations 7, 8 and 9          | Pin cited server fixture clocks     | Exact quota/expiry outcomes with reliable clock restoration                                                     |
| Recommendations 10 and 11           | Control image-expiry scenarios      | Explicit image-error triggers for incidental refresh; clock advancement for expiry behavior                     |
| Recommendations 19, 20 and 21       | Use user-level interactions         | Disabled, dismiss and capture actions preserve their behavioral assertions                                      |
| Recommendation 22                   | Separate E2E concerns               | Focused layout/accessibility checks retain existing regression evidence                                         |
| Recommendation 23                   | Observe feed before baselines       | Register interception before navigation/filter requests and await the real response                             |

## Existing file organization follow-up

Recommendations 12 through 18 concern full-file length. Each file already exceeded 1,000 lines
at the story baseline. These are recorded as a separate organization follow-up. A focused split
should preserve all scenarios and shared fixture ownership, with its own complete validation.
No test result, coverage threshold, CI gate or product behavior is waived by this disposition.
New expansion coverage should use focused files where practical.

| Review item | File                                                         | Baseline lines | Reviewed lines |
| ----------- | ------------------------------------------------------------ | -------------: | -------------: |
| 12          | apps/api/src/modules/community/community.repository.spec.ts  |           1504 |           1509 |
| 13          | apps/api/src/modules/community/community.service.spec.ts     |           2403 |           2529 |
| 14          | apps/api/src/modules/guardian/guardian.service.spec.ts       |           2522 |           2525 |
| 15          | apps/mobile/src/screens/community-screen.test.tsx            |           1552 |           1991 |
| 16          | apps/web/src/app/components/community-lookbook-grid.test.tsx |           2555 |           3135 |
| 17          | packages/api-client/testing/community-contract.spec.ts       |           1074 |           1074 |
| 18          | pact/http/consumer/interactions/community.ts                 |           1663 |           1760 |

## Execution state

- Codex peer: `01a1536f-b774-72b2-88d1-3d7309a005f3`.
- Review scope: 29 supplied test/support files; source callers read as context.
- Review execution: three targeted real-DB tests passed.
- Expansion and local final verification: passed; evidence below.
- Root owns commits, push/PR, CodeRabbit follow-up, CI repair and conditional merge.

## Final local disposition

All accepted behavioral, isolation, clock, interaction and privacy repairs are implemented.
The original 0/100 full-file rubric and Request Changes verdict are preserved as review
evidence. The seven inherited file-size findings stay documented above for a focused split.

Root inspected the complete peer diff and demonstrated four regression-sensitive failures
by removing detail reconciliation, the eviction read fence, module middleware and lease
settlement ownership. Source bytes were restored in finally for every proof.
The stronger native tests also exposed incorrect singular reaction text. Root removed
the obsolete i18next v3 plural compatibility setting and added locale and capsule wording
regressions. The remaining Pact matcher incompatibility was repaired with a documented
integer-matcher fallback, retaining integer validation and the complete schema assertions.

Final local gates: 6,268 tests pass with 10 existing intentional skips; unchanged coverage
thresholds, types, lint, formatting and builds pass. Both Pact consumers are deterministic
over three runs and the provider passes. All 10 community RLS tests and eight real browser
journeys pass. See the automate summary for commands and logs. Root retains the authorized
CodeRabbit/CI review and conditional merge gates. Production rollout flags remain disabled.
