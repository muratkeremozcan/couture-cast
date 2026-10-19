# Story 6.3 Codex peer disposition

Updated: 2026-10-19. Independent review followed by targeted test expansion.

The original peer report is `story-6-3-codex-peer.md`. Its full-file rubric score and
Request Changes verdict remain intact. The review demonstrated no new production defect.
All concrete gaps and organization findings are implemented. The Codex peer used
`bmad-tea-automate`, expand Create; root completed sequential verification and the final
organization and retry-coverage repairs.

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

## Completed file organization repairs

The user's final scope requires every review item to close in Story 6.3. Recommendations
12 through 18 are implemented here. The original report remains historical evidence;
its earlier file sizes describe the reviewed source before these repairs.

| Review item | Original suite                 | Completed split                                                                              |              Preserved cases |
| ----------- | ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------: |
| 12          | Community repository           | Five focused specs and shared repository fixtures                                            |                           67 |
| 13          | Community service              | Seven focused specs and shared service fixtures                                              |                          131 |
| 14          | Guardian service               | Five focused specs and shared guardian fixtures                                              |                           90 |
| 15          | Mobile community screen        | Registration entrypoint, five case modules and shared harness                                |                           71 |
| 16          | Web community grid             | Seven focused specs and shared grid fixtures                                                 |                          104 |
| 17          | API-client community contracts | Three focused specs and shared contract builders                                             |                           57 |
| 18          | Pact community interactions    | Public entrypoint and focused fixture/feed/publication/moderation/challenge/reaction modules | 33 interactions per consumer |

Every resulting spec and support module is below 1,000 lines. Support modules use the
existing test-scaffolding locations and coverage exclusions. Test discovery, mock ownership,
clock cleanup and scoped hooks remain explicit. Root's token-level comparison verifies
unchanged test bodies across the API, web and contract splits. Mobile's ten route-parameter
assignments use a shared setter with the same assignment semantics. All 21 existing reaction
integration scenarios also survive their focused split; each file owns a disposable database.

## Execution state

- Codex peer: `01a1536f-b774-72b2-88d1-3d7309a005f3`.
- Review scope: 29 supplied test/support files; source callers read as context.
- Review execution: three targeted real-DB tests passed.
- Expansion and local final verification: passed; evidence below.
- Root owns commits, push/PR, CodeRabbit follow-up, CI repair and conditional merge.

## Earlier behavioral verification

All accepted behavioral, isolation, clock, interaction and privacy repairs are implemented.
The original 0/100 full-file rubric and Request Changes verdict are preserved as review
evidence. The seven inherited file-size findings are closed by the focused splits above.

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
/tmp/couture63-coderabbit-validate.log. The original TEA report remains historical evidence; all seven file-size findings are now closed. Production rollout flags remain disabled.

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

## Web agent review and CI isolation follow-up

The independent web agent reviewed exact head 0f288971 and reported no validated
application defects or required corrections. It freshly passed 1,086 checks, including
nine scratch probes. The formatted report is story-6-3-web-agent.md; its original Downloads
file has SHA-256 2f0b02406e76fbd93cf295681e918c9d618144f64da31bc9963efc70519f1d6a.
The original probe patch is retained as evidence in story-6-3-web-agent-probes.patch.
All nine probes are now permanent cases in community-reaction-concurrency.integration.spec.ts. The report's execution limits and reviewed SHA
remain explicit. The subsequent delta changes the test harness and its regression coverage.

Android CI exposed a fixture-isolation bug after a watchdog retry. The first community
attempt saved Love, then stalled during relaunch. Its retry retained that member's Love
selection. Replacing it with Applaud correctly produced Applaud 1 and Love 0, while the
flow expected its initial Love 1 to remain. Per-flow reset now atomically clears only the
synthetic reacting member's onboarding, reaction, receipt, and outbox state. Blank or
missing member IDs are rejected before any deletion. The Prisma client's selected E2E
database and finally-disconnect lifetime remain intact.

The real database regression failed against the old reset and passes after repair. It
checks crossed post ownership, exact preservation of another member's rows, generation
invalidation, idempotence, invalid-ID safety, and a fresh revision-1 Applaud with Love 0.
All 21 reaction integration tests, API type checks and affected-file lint pass. A separate
Codex source review found no blocking issues. The fresh iOS community flow passes in
3m 38s and its screenshot was inspected. Evidence: /tmp/couture63-flow-reset-{red,green,
types,lint,ios}.log. The watchdog's existing timeout and retry budget are retained, with
its documentation corrected to cover relaunch stalls after saved writes.

Android shard 6 also encountered a Maestro deviceInfo transport failure before its hero
flow executed any command. A fresh-device rerun passed the unchanged shard. The current
remote head's other quality/browser checks passed. Final CI must pass on the new harness
commit before the already-authorized merge. Production rollout flags remain disabled.

## Completed retry coverage repairs

CodeRabbit's two coverage suggestions are implemented within this story. The runner calls
an import-safe orchestration module that owns the reset before the first attempt and before
its one watchdog retry. Tests cover a saved reaction surviving a timeout, the exact
reset/run/retry/reset/run ordering, missing reset wiring, initial reset failure, retry reset
failure, ordinary failure and exhaustion of the single retry. A reset failure prevents the
next device attempt.

The PostgreSQL fault test installs an AFTER DELETE trigger ordered after the real generation
trigger. Its error includes the incremented generation, proving that the generation update
executed. The transaction restores onboarding, outbox, receipt, reaction and post generation
exactly. The fault trigger and function are removed in finally within the disposable database.

Both regression proofs rejected seeded implementation defects: removing the second reset
leaves Love revision 1 visible to the retry; replacing the transaction with sequential deletes
leaves partially removed rows. Source bytes were restored after each proof. Logs:
/tmp/couture63-retry-orchestration-red.log and /tmp/couture63-reset-rollback-red.log.

Independent split review also identified a cluster-wide pg_stat_activity witness. It now
requires datname = current_database(), so parallel suites cannot satisfy the revocation gate
with an unrelated database's advisory wait. The new mobile scaffolding lives under the
existing src/test-utils coverage exclusion. No review item is assigned to a later story. The final local quality gate is
story-6-3-final-quality-gate.md; current-head CI is recorded in PR #153.

## Final review closure verification

All 23 recommendations, the advisory coverage actions, all six CodeRabbit findings, and
both subsequent retry-coverage suggestions are closed within this story. The largest
resulting test/support file is 599 lines. The nine web-agent probes are permanent tests.
Independent final source reviews report no remaining concern.

Full runtime verification exposed mock ordering after test extraction. All ten native mocks
now register in the spec entrypoint and share a pure state module. Each web spec registers
its own PostHog mock before component imports. Original assertions are retained. All 877
native tests and all 777 web tests pass with unchanged coverage limits after these repairs.

Final local verification totals 6,303 passing tests with ten existing intentional skips.
Types, lint, formatting, unchanged coverage limits and production builds pass. Pact consumers
are deterministic over three runs (116 mobile, 125 web), and the provider passes. All ten
community RLS cases and nine browser journeys pass. The fresh iOS flow passes in 220 seconds;
both browser and native screenshots were inspected. Full evidence and execution boundaries
are recorded in story-6-3-final-quality-gate.md. The approved frozen intent remains exact.
Production rollout flags remain disabled. Current-head CodeRabbit inspection and green CI
remain the merge conditions in PR #153; root is completing those gates in this session.
