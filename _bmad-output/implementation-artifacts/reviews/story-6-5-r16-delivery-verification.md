# Story 6.5 R16 delivery verification

Coordinator verification, 2026-10-20. Astra delivered `TEST_REMEDIES_READY` after
independently confirming `gpt-6-astra/high` and activating the project Test Architect.
The coordinator rehashed all four owned files and inspected completed result records
and logs. R16 focused delivery is accepted. Verification against the final combined
repair tree remains required.

| Owned file                                                               | Verified SHA256                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `apps/web/src/lib/web-session.auth-boundary.test.ts`                     | `27d4f4565082ba729f543b4f930ec8d419f880fc2b2fe3882af9baebde78474a` |
| `apps/api/integration/community-transport-client.integration.spec.ts`    | `f1b213cd3fc7295e43452f424ecc908630f3c36e3c5d447cfe55198b52e1a65e` |
| `apps/api/integration/community-stream-lock-release.integration.spec.ts` | `239230919ce80105f74746382d7cba13e84643c9b8493da24f83f1b12d67e674` |
| `packages/api-client/testing/community-transport.spec.ts`                | `0176ad29c2231fc367675d590067c2a41bece5391ead29662e1b13ec660c3b66` |

Evidence is under `_bmad-output/test-artifacts/story-6-5/runs/`. Each cited run
contains its actual command, working directory, source manifest and completed log.

| Run                                                              | Verified outcome                                                                                                                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `r16-v1-final`                                                   | 6/6 session-to-HTTP tests; exit 0, unchanged tree. Actual source session publication, generated profile bearer and community wrapper requests; controlled Supabase SDK and MSW HTTP boundary. |
| `r16-api-final`                                                  | 4/4; exit 0, unchanged tree. Real local socket/server/coordinator/HTTP reaction reconciliation plus two production appender lock-release checks. Healthy lane 9259 ms; outage lane 7924 ms.   |
| `r16-l3-final`                                                   | 13/13 transport tests; exit 0, unchanged tree. Retry/backoff, stability timer, strict controls, fresh tokens and teardown.                                                                    |
| `r16-t01-green2` / `r16-t01-mutant2`                             | Same unchanged manifest. Production 2/2 passes; rollback-omission mutant fails both retained-lock assertions, actual 3 and 4 locks versus expected 2.                                         |
| `r16-t01-final-mutant`                                           | Current test version again fails both retained-lock assertions through actual-source `prepareCandidate`; canonical source untouched.                                                          |
| `r16-lint2`                                                      | Four-file lint exits 0.                                                                                                                                                                       |
| `r16-api-types-final`, `r16-web-types`, `r16-client-types-final` | Each exits 0 on its recorded unchanged tree.                                                                                                                                                  |

API-final and L3-final share manifest
`df0175a1fd99129d573c87ec88145fff0a47de7ca9670c94e968764f1df43cc3`.
V1-final uses
`ec4f4a955862ac8736a384a439d70efaad1768a71b07988141bd44a35c255002`.
The matched production/mutation pair uses
`ca4f40e12ca3af745708f4a66d6320a513b1b2c8b0636590f91301fcac7ee702`.

The first `r16-t01-mutant` failed to load `pino.config.js`. It provides no mutation
proof. Astra retracted its premature assertion claim; the coordinator corrected
the report to Sol and the user. Original logs remain retained. Initial L3 was 9/9;
the final suite expanded to 13. Initial V2 and extended L3 exposed the postponed
fallback and early stability-reset bugs. Sol applied the production R09 fixes.

Astra now preserves the four files and awaits the combined-tree verification and
independent TEA remedy rereview. Sol retains R01-R15 ownership. Full native,
real-session/provider, physical-device, hosted, privacy/fault, herd/performance,
Pact/Optic and full-quality acceptance gates remain open. This delivery does not
establish story completion, CI success or merge readiness.
