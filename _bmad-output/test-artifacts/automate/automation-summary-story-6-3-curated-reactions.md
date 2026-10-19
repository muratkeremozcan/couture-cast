---
runScope: 'story'
runKey: 'story-6-3-curated-reactions'
testMode: 'expand'
testEntry: 'bmad-tea-automate'
workflowStatus: 'completed'
test_mode: expand
test_operation: create
auto_validate: true
auto_heal_failures: true
max_healing_iterations: 3
use_mcp_healing: true
healing_rounds_used: 3
stepsCompleted:
  [
    'step-01-preflight-and-context',
    'step-02-identify-targets',
    'step-03-generate-tests',
    'step-03c-aggregate',
  ]
lastStep: 'step-04-validate-and-summarize'
lastSaved: '2026-10-19'
inputDocuments:
  - '_bmad-output/implementation-artifacts/spec-6-3-curated-reactions.md'
  - '_bmad-output/implementation-artifacts/epic-6-context.md'
  - '_bmad-output/test-artifacts/test-review/story-6-3-codex-peer.md'
  - '/tmp/couture63-codex-tea-expand.md'
---

# Story 6.3 test expansion

This is the authorized post-review expansion. The original review verdict remains unchanged.
Mode: expand/Create, autonomous, BMad integrated. Stack detection: mobile with explicitly
requested API, database, Pact and web targets. Existing Vitest, Playwright, Maestro and Pact
frameworks are present. No test design was found at the canonical or legacy standard paths.
No new device flow is required for the accepted gaps. Pact MCP is unreachable; provider source
and shared schemas supply the contracts. Both configured utility mandates apply.

## Target plan

| Priority | Boundary                        | Planned proof                                                                           |
| -------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| P0       | Screen and real clients         | Late responses are applied before retained counts/selection and eviction assertions     |
| P0       | PostgreSQL dispatcher           | Isolated global sweeps, sole-connection release, lease ownership and simultaneous claim |
| P0       | Real CommunityModule HTTP       | Private cache headers on viewer-specific and strict legacy success and refusals         |
| P0       | Real database roles             | All write verbs refused consistently on all three reaction tables                       |
| P1       | Generated clients and Pact      | 409 current state, 429 retry metadata and negotiated populated feed                     |
| P1       | Existing browser journeys       | Network readiness before count baseline, focused layout/a11y cases                      |
| P1       | Implicated unit/screen fixtures | Controlled clocks and realistic user actions                                            |

## Provider endpoint map

| Consumer endpoint                            | Provider                                               | Validation and response                                                                            |
| -------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| PUT /api/v1/community/posts/:postId/reaction | apps/api/src/modules/community/community.controller.ts | packages/api-client/src/contracts/http/community.ts: set input, reaction response/conflict schemas |
| GET /api/v1/community/feed                   | apps/api/src/modules/community/community.controller.ts | community feed query, legacy and negotiated response schemas                                       |
| GET /api/v1/community/posts/:postId          | apps/api/src/modules/community/community.controller.ts | legacy and negotiated post response schemas                                                        |

Test generation may operate on disjoint files concurrently under the skill's subagent mode.
All builds, tests, mutation checks and database execution remain sequential in the parent peer.
No production behavior is changed. Temporary mutation proofs restore source bytes in finally.

## Aggregation and execution handoff

All three workers returned success. The independent Codex peer wrote the tests and
completed the API baseline run. Root took over sequential execution after requesting an
edit freeze. No source drift was observed against the handoff hashes. Native, web, API,
RLS and Pact fixtures reuse the installed frameworks. No new device flow or framework
script is needed. Native project runners are used because the skill-only installation
has no tea-unit-check executable; complete stdout, exit status and unhandled errors
are retained with fresh per-command logs.

The frozen owned manifest for this expansion is:

- `apps/api/integration/community-reaction-leases.integration.spec.ts`
- `apps/api/integration/community-reactions.integration.spec.ts`
- `apps/api/integration/helpers/isolated-community-database.ts`
- `apps/api/src/modules/community/community-privacy.http.spec.ts`
- `apps/api/src/modules/community/community.repository.spec.ts`
- `apps/api/src/modules/community/community.service.spec.ts`
- `apps/api/src/modules/guardian/guardian.service.spec.ts`
- `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.test.tsx`
- `apps/mobile/src/screens/community-screen.test.tsx`
- `apps/web/src/app/components/community-lookbook-grid.test.tsx`
- `packages/db/test/rls/community-posts.spec.ts`
- `pact/http/consumer/interactions/community.ts`
- `pact/http/consumer/mobile-api-client.pacttest.ts`
- `pact/http/consumer/web-api-client.pacttest.ts`
- `pact/http/provider/doubles/community.ts`
- `pact/http/provider/state-handlers.ts`
- `pact/http/provider/state.ts`
- `playwright/support/helpers/community-session.ts`
- `playwright/tests/community-publication.spec.ts`
- `playwright/tests/community-reactions.spec.ts`

Each target row above defines its scenario and expected assertion. Exact fixed boundary
values and UUID factory identifiers are intentional. One repair round occurred in the
peer: the guardian clock was restricted to invitation scopes after the broad Date subclass
broke three pre-existing emancipation fixture instanceof checks. Their business assertions
were preserved. The repaired focused API run passed 320 tests.

Root reproduced a separate product defect through the real native screen and i18n:
confirmed one-reaction summaries rendered "1 reactions". Root removed the obsolete
v3 compatibility option, preserving the shipped \_one/\_other locale keys, and added
English, French and Turkish plural regression tests plus a capsule wording assertion.
These root product changes are outside the automate healing manifest. The native
community and wardrobe-hub files then passed all 87 tests.

## Playwright Utils deviations

None in the generated migration. Existing fixture bootstrap/setup uses raw request
contexts before composed utilities exist. API module tests use Supertest under Vitest.
The installed interception handler supports the deliberate connection abort and real retry.

## Pact.js Utils deviations

`pact/http/consumer/interactions/community.ts`: pactjs-utils 1.1.0 maps Zod 3 integer
checks to decimal matchers. Fresh provider verification rejected six added interactions
with "Expected Integer to be a decimal number". Root shipping repair uses Pact's integer
matchers for the reaction summary, preserving the exact integer protocol and full refined
schema validation of the real consumer response. createProviderState/setJsonContent remain
in use. The unsupported Zod 3 matcher case is the documented library fallback.
Source scrutiny supplies contracts because SmartBear Pact MCP tools are unavailable.

## Mutation evidence

- Removing native detail reconciliation failed the confirmed palette assertion.
- Removing the read fence failed the absent-card assertion after its response was consumed.
- Removing real CommunityModule middleware failed private cache header assertions on 401.
- Removing the outbox lease predicate failed both stale-worker settlement cases.

Every temporary mutation was restored byte-for-byte in finally and verified by SHA256.
Logs: /tmp/couture63-root-mutation-{screen,fence,lease}.log and
/tmp/tea-community-privacy-middleware-mutation.log. Final verification is in progress.

Additional confirmed setup/type repairs were applied in rounds 2 and 3: use the API's
CommonJS-compatible migration path, safely unwrap known one-row SQL/contract results,
and type the acknowledged callback's observed argument. TypeScript provided the exact
error locations; all existing business assertions remain intact. The Pact feed now also
asserts its single returned item before accessing it. The retained healing budget is spent.

## Verification checkpoint

Full root validation passed 6,268 tests, with 10 existing intentional skips. All workspace
coverage thresholds, types, lint, formatting and API/web production builds passed.
The bounded automate repair budget reached three rounds. The subsequent provider run
exposed the library integer-matcher incompatibility above; root owns the shipping repair
and final revalidation. That follow-up preserves every business assertion and integer type.
Full log: /tmp/couture63-final-validate.log. Contract rerun: /tmp/couture63-final-pact-fixed.log.

## Final delivered verification

Root shipping follow-up passed every remaining gate. The complete delivered test scope
is green. The initial full-file peer verdict is retained; seven inherited file-size
findings remain in the explicit organization follow-up. No test/coverage gate was waived.

| Gate                                  | Result                                                    | Fresh evidence                      |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| Full types/lint/format/coverage/build | 6,268 passed, 10 existing skips                           | /tmp/couture63-final-validate.log   |
| Deterministic Pact consumers          | Mobile 116 and web 125 interactions, stable across 3 runs | /tmp/couture63-final-pact-fixed.log |
| Pact provider                         | Both consumer pacts verified                              | /tmp/couture63-final-pact-fixed.log |
| Community RLS                         | 10 passed, including all write verbs and roles            | /tmp/couture63-final-rls.log        |
| Browser publication and reactions     | 8 passed, no retries                                      | /tmp/couture63-final-playwright.log |
| Seeded regression sensitivity         | 4 mutations rejected, source restored                     | Mutation evidence above             |

All owned local test and browser processes exited. The browser screenshot was inspected
at playwright/artifacts/community-reactions.png. Existing package commands cover the new
files; no README/script changes are required. Settings and the spent three-round healing
budget are retained above. No completion customization hook is configured.
Next: root-owned PR, CodeRabbit review, CI and conditional merge.

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

## Web agent review and CI isolation follow-up

The independent web agent reviewed exact head 0f288971 and reported no validated
application defects or required corrections. It freshly passed 1,086 checks, including
nine scratch probes. The formatted report is story-6-3-web-agent.md; its original Downloads
file has SHA-256 2f0b02406e76fbd93cf295681e918c9d618144f64da31bc9963efc70519f1d6a.
The optional probe patch is retained as evidence in story-6-3-web-agent-probes.patch.
It is not applied to the source suite. The report's execution limits and reviewed SHA
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
