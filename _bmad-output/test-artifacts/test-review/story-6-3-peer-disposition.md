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

## Hermes runtime follow-up

The fresh iOS E2E run reproduced a missing Intl.PluralRules error after modern plural
resolution was enabled. The first Android CI run showed the same error and blocked
settings journeys. Root added the FormatJS getCanonicalLocales, Locale and PluralRules
polyfills in dependency order, with locale data for all ten supported locales, including
the distinct Portuguese regional rule. The bootstrap test removes the native APIs before
loading the real polyfills and verifies locale behavior. Modern FormatJS static blocks
also required the standard Babel class-static-block transform under Expo SDK 54.

All 877 mobile tests, mobile lint/types, widget/watchOS plugin tests and unchanged mobile
coverage thresholds pass. The complete production iOS Hermes export passes. The fresh
iOS community flow passes in 218 seconds with exact singular/plural text, add/replace,
relaunch persistence and removal. Its screenshot was inspected. A separate read-only
Codex subagent reviewed all seven native repair files and returned no findings.
Logs: /tmp/couture63-polyfill-verify-mobile.log, /tmp/couture63-polyfill-coverage.log,
/tmp/couture63-ios-export.log and /tmp/couture63-final-native-verified.log.

The local runner used MOBILE_E2E_EXPO_NO_OPEN=1 because Simulator.app lookup failed
while simctl and the booted iPhone remained available. Maestro opened the target device
through the existing harness. No launcher policy, timeout or assertion was waived.
CodeRabbit's status page reports a partial review outage beginning 2026-10-19 08:58 UTC;
review has been requested and remains a prerequisite for merge.

## CodeRabbit follow-up

CodeRabbit completed review 5570286660 on commit b292db4a and reported six minor findings.
All six were accepted and repaired. Independent Codex reviewers verified the fixes.

| Comment    | Repair                                                                                                                                                                            | Regression evidence                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4312806100 | Preserve the accepted feed position of highlighted cards; clear stale pins and guard late detail responses.                                                                       | Real browser reproduction failed with the highlighted card promoted ahead of the first feed item. Three gated screen cases cover loaded cards, refresh admission, and pagination admission.                   |
| 4312806164 | Match the existing formal Portuguese voice in both platform catalogs.                                                                                                             | Full locale validation and mobile tests pass.                                                                                                                                                                 |
| 4312806191 | Match the existing informal Turkish voice in both platform catalogs.                                                                                                              | Full locale validation and mobile tests pass.                                                                                                                                                                 |
| 4312806229 | Document all reaction error bodies and Retry-After; regenerate OpenAPI and SDK. Keep the established required three-field 500 contract and normalize unexpected runtime failures. | Real HTTP tests parse all documented errors, including an unexpected failure; OpenAPI assertions cover body references and the retry header.                                                                  |
| 4312806240 | Add a generated forward migration setting update cascades on all six foreign keys. Applied SQL remains byte-for-byte unchanged.                                                   | Test first failed on the original user FK. After migration, both parent identities update with state, receipts, and event IDs preserved; receipt replay adds no event; all six live constraints match Prisma. |
| 4312806253 | Prepare utils and API-client before standalone testing build, watch, lint, and typecheck commands.                                                                                | Cold build first failed with TS2307 after cleaning API-client dist; the same standalone command passes after repair. Dependency order is acyclic.                                                             |

Fresh focused API verification: 39 passed. Full validation: 6,281 passed with ten existing
intentional skips; types, lint, formatting, unchanged coverage thresholds, and production
builds pass. Logs: /tmp/couture63-coderabbit-api.log and
/tmp/couture63-coderabbit-validate.log. The original TEA report and inherited file-size
follow-up remain intact. Production rollout flags remain disabled.

Pact consumers remain deterministic over three runs (116 mobile, 125 web), and provider
verification passes. Nine real browser publication/reaction journeys pass without retries,
including the ordering regression. Logs: /tmp/couture63-coderabbit-pact.log and
/tmp/couture63-coderabbit-playwright.log. The fresh browser screenshot was inspected.

## HTTP compatibility follow-up

CI Optic rejected making the established shared 500 error field optional. The field is
required again, preserving the existing generated SDK contract. The global exception
filter now normalizes unexpected failures to the three-field public envelope, logs the
original exception, and retains telemetry behavior. Existing HttpExceptions and http-errors
objects keep their prior response handling. The actual HTTP regression failed against the
old runtime response before repair. Regenerated OpenAPI and SDK pass Optic diff against main.
Focused tests cover exact responses, private-detail protection, original logging, sent
headers, custom errors, webhook exclusions, and telemetry failures.

Final compatibility verification: 6,285 tests pass with ten existing intentional skips;
unchanged coverage thresholds and production builds pass. Type checks and workspace lint
completed in /tmp/couture63-500-validate.log. A new test's type-import style error was
corrected, then API types/lint and remaining root lint/format/coverage/build checks passed
in /tmp/couture63-500-resume.log. Pact consumers remain stable across three runs, and
provider verification passes in /tmp/couture63-500-pact.log. Optic compatibility passes
in /tmp/couture63-500-optic.log. Focused filter/privacy verification passes all 39 cases
in /tmp/couture63-500-focused.log. The independent runtime source review found no issues.
