---
stepsCompleted:
  - step-01-load-context
  - step-02-discover-tests
  - step-03-quality-evaluation
  - step-03f-aggregate-scores
  - step-04-generate-report
lastStep: step-04-generate-report
lastSaved: 2026-08-10
workflowType: testarch-test-review
inputDocuments:
  - .gitleaks.toml
  - _bmad-output/implementation-artifacts/4-4-wardrobe-onboarding-silhouette-setup.md
  - packages/api-client/docs/http.openapi.json
  - packages/api-client/src/contracts/http/wardrobe.ts
  - packages/api-client/src/generated/apis/WardrobeApi.ts
  - packages/api-client/testing/wardrobe-onboarding-contract.spec.ts
  - packages/api-client/testing/wardrobe-silhouette-contract.spec.ts
  - pact/http/consumer/api-contract-interactions.ts
  - pact/http/consumer/mobile-api-client.pacttest.ts
  - pact/http/consumer/web-api-client.pacttest.ts
  - pact/http/provider/provider-helper.ts
  - pact/http/provider/state-handlers.ts
  - _bmad/tea/config.yaml
---

# Test quality review: Story 4.4 Task 7 wardrobe onboarding/silhouette Pact contracts (PR #106)

Review date: 2026-08-10
Review scope: PR #106's full diff (`git diff main...HEAD`), 12 files: the Pact consumer/provider layer under `pact/http/`, the two new wardrobe contract-spec files, the `wardrobe.ts` HTTP contract, `.gitleaks.toml`, the story completion notes, and the two generated artifacts (`http.openapi.json`, `WardrobeApi.ts`, read for context only, never hand-edited)
Reviewer: Murat / TEA

Note: this review audits test quality. Coverage mapping and coverage gates are out of scope; use `trace` for coverage decisions.

This is the first dedicated bmad-tea test-architecture pass against this diff's final, current state. An earlier bmad-tea review ran once on an interim commit and found two defects (fixed in `33595bb`); a later remediation pass driven mostly by a general-purpose `bmad-code-review` landed real provider verification, `.superRefine()` schema invariants, and replay coverage (`e6f7bb9`, `c5bfb1a`). Neither of those passes is what this review re-runs; this review evaluates the code those passes actually produced, independently, from scratch.

## Executive summary

Overall score: 100/100 (99.5 before rounding), grade A
Recommendation: Approve

Quality evaluation ran as four parallel dimension subagents (determinism, isolation, maintainability, performance) against the 12 in-scope files, each grounded in this repo's own `pactjs-utils` knowledge base (one-`addInteraction()`-per-`it()`, `fileParallelism`/`singleFork` FFI safety, consumer-curated matchers) rather than generic test-quality heuristics. Combined, they surfaced 6 real findings: 3 determinism, 1 isolation, 4 maintainability minus 1 already counted twice, netting to the totals below. All HIGH and MEDIUM findings were fixed in this pass, in the source, with the fix itself doubling as the regression-proof convention this file already uses (`it.each` per interaction). One LOW-severity finding is left deliberately deferred, matching a decision this story's own completion notes already recorded twice.

The most consequential finding was a genuine live-flake risk: two pre-existing (Story 4.2) grouped verify functions in `api-contract-interactions.ts` still awaited multiple `addInteraction()...executeTest()` chains inside a single `it()`, the exact PactV4 Rust-FFI pattern this same file's own doc comments warn can non-deterministically drop an interaction. This had already been fixed once for the newer onboarding/silhouette tables in the first bmad-tea pass, which explicitly flagged the pre-existing capsule/tagging instances as "worth the same `it.each` treatment in a follow-up." This review is that follow-up.

## Quality criteria assessment

| Criterion                                                                       | Status       | Notes                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One `addInteraction()` per `it()`                                               | Fail -> Pass | 3 pre-existing grouped verify functions violated this; converted to `it.each` in this review, see Resolved 1-3                                                                                                                        |
| Consumer Vitest `fileParallelism: false` + `pool: 'forks'` + `singleFork: true` | Pass         | `pact/http/vitest.consumer.config.mts` correctly set; untouched, no gap found                                                                                                                                                         |
| Provider Vitest `pool: 'forks'` + `singleFork: true`                            | Pass         | `pact/http/vitest.provider.config.mts` correctly set; untouched                                                                                                                                                                       |
| `test:pact:consumer` wired through `check-pact-determinism.sh`                  | Pass         | Confirmed in `package.json`; 3x determinism gate already in place                                                                                                                                                                     |
| Consumer-curated matchers, no over-specified provider schema                    | Pass         | Hand-written `onboardingStateBody`/`silhouetteProfileBody` helpers match this file's 100%-consistent existing convention; `zodToPactMatchers` confirmed genuinely unavailable in the installed `@seontechnologies/pactjs-utils@1.1.0` |
| Provider state isolation (reset cascade covers every domain fixture)            | Fail -> Pass | `resetProviderState()` reset onboarding and silhouette fixtures but not the pre-existing capsule fixture; fixed, see Resolved 4                                                                                                       |
| Schema cross-field invariants grounded in real service behavior                 | Pass         | `.superRefine()` on `silhouetteMyFormSchema`/`wardrobeOnboardingStateSchema` explicitly comments the service/processor file each invariant encodes                                                                                    |
| Doc-comment accuracy (no stale "not wired yet" claims)                          | Fail -> Pass | Two comment blocks in `state-handlers.ts`/`provider-helper.ts` still described the onboarding/silhouette provider doubles as unwired scaffolding after a later commit in the same PR wired them for real; fixed, see Resolved 5-6     |
| Type derivation from canonical contract types (no hand-duplicated unions)       | Fail -> Pass | `SilhouetteRow` hand-wrote the `mode`/`status` literal unions instead of importing `SilhouetteMode`/`SilhouettePhotoStatus`, unlike its sibling `OnboardingRow`; fixed, see Resolved 7                                                |
| Expensive fixture reuse across tests in one suite                               | Fail -> Pass | `generateHttpOpenApiDocument()` (full registry + document rebuild) called 3 times across one describe block instead of once; fixed, see Resolved 8                                                                                    |
| Duplicate error-envelope verification logic (3 near-identical implementations)  | Warn         | Real, but already documented and consciously deferred twice; kept deferred here too, see Findings                                                                                                                                     |
| Test length / structure                                                         | Pass         | No test exceeds this repo's own conventions; `it.each` tables keep per-case bodies small                                                                                                                                              |
| No `.only`                                                                      | Pass         | Confirmed via repo-wide grep across `pact/` and the two contract-spec files                                                                                                                                                           |

## Dimension scores

| Dimension       | Score | Rationale                                                                                                                                                                                                                                                           |
| --------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Determinism     |   100 | All 3 HIGH-severity multi-interaction-per-`it()` violations and the 1 LOW-severity wall-clock timestamp fixed. Consumer/provider Vitest FFI-safety config, the determinism-check wiring, and every new Story 4.4 interaction's timestamps were already correct.     |
| Isolation       |   100 | The 1 MEDIUM-severity missing reset-cascade entry fixed. Fixtures in both contract-spec files build fresh objects per test; provider state handlers fully overwrite rather than merge.                                                                              |
| Maintainability |    98 | Both HIGH-severity stale doc comments and the 1 MEDIUM-severity hand-duplicated type union fixed. 1 LOW-severity, deliberately deferred finding remains (duplicate error-envelope logic across 3 functions), matching a decision this story already recorded twice. |
| Performance     |   100 | The 1 MEDIUM-severity redundant `generateHttpOpenApiDocument()` rebuild fixed. Provider `moduleFixture` builds once per verification run; no inappropriate serialization leaked into the plain-Zod contract-spec suites.                                            |

Weighted score: 0.3(100) + 0.3(100) + 0.25(98) + 0.15(100) = 99.5, rounds to 100/100.

## Findings

### 1. Duplicate error-envelope verification logic across three near-identical functions

Severity: LOW
Status: Open, deliberately deferred
Location: `pact/http/consumer/api-contract-interactions.ts`: `verifySmartTagErrorInteraction`, `verifyCapsuleErrorInteraction`, `verifyWardrobeErrorInteraction`

All three functions independently implement the same `addInteraction`/`uponReceiving`/`withRequest`/`willRespondWith`/`executeTest`-with-three-assertions shape for a documented error envelope, differing only in their interaction-table field names. `WardrobeErrorInteraction`'s own doc comment already acknowledges this ("generalized... instead of duplicating the helper a third time") as a conscious choice at the time it was written, and this story's completion notes flag the same duplication as "worth the same it.each treatment in a follow-up" for a different, adjacent issue. Unifying all three into one generic helper is a real, legitimate simplification, but it touches interaction-table shapes across three domains (smart-tagging, capsules, onboarding/silhouette) under review-time pressure and is not itself a correctness or flakiness risk now that all three drive `it.each`. Left deferred, consistent with the two prior decisions already on record; a future pass can fold them into one generic helper parameterized by field names.

## Resolved during review

### 1. PactV4 multi-interaction-per-`it()`: smart-tagging error envelopes

Prior severity: HIGH
Location: `pact/http/consumer/web-api-client.pacttest.ts`, `pact/http/consumer/api-contract-interactions.ts`

`verifySuggestGarmentTagsErrorInteractions`/`verifyUpdateGarmentTagsErrorInteractions` awaited 6 total `addInteraction()...executeTest()` chains inside one `it()` body (Story 4.2, pre-existing). Fixed by exporting `verifySmartTagErrorInteraction` (the existing single-interaction primitive) and two interaction-table arrays (`suggestGarmentTagsErrorInteractions`, `updateGarmentTagsErrorInteractions`), then driving them with `it.each(...)` in `web-api-client.pacttest.ts`, one interaction per `it()`.

### 2 and 3. PactV4 multi-interaction-per-`it()`: capsule error envelopes (Web and Mobile)

Prior severity: HIGH
Location: `pact/http/consumer/web-api-client.pacttest.ts`, `pact/http/consumer/mobile-api-client.pacttest.ts`, `pact/http/consumer/api-contract-interactions.ts`

`verifyCapsuleErrorInteractions` `for`-looped 5 `addInteraction()...executeTest()` chains inside one `it()` body in both consumer files independently (Story 4.3, pre-existing), directly contradicting this same file's own "One interaction per test." design comment. Fixed by extracting the loop body into `verifyCapsuleErrorInteraction(pact, interaction)` and exporting `capsuleErrorInteractions`, then driving both pacttest files with `it.each(...)`. Both were flagged by the first bmad-tea pass as a known follow-up item; this is that follow-up.

### 4. Provider state isolation: capsule fixture excluded from the reset cascade

Prior severity: MEDIUM
Location: `pact/http/provider/provider-helper.ts`

`resetProviderState()`, which the Verifier calls in `beforeEach`/`afterEach` around every interaction, cascaded into `resetProviderOnboardingState()` and `resetProviderSilhouetteState()` but not the pre-existing, structurally identical `resetProviderCapsuleState()`. Currently dormant (every capsule state handler fully overwrites `providerCapsuleState` before use), but it broke the "every fixture starts clean before each interaction" guarantee for exactly one domain out of four. Fixed by adding `resetProviderCapsuleState()` to the cascade. Proven by the full `npm run test:pact` re-run (93/93 interactions, real provider verification), the existing convention for this file since it has no separate unit-test layer for its internal reset functions.

### 5 and 6. Stale "not wired yet" doc comments

Prior severity: HIGH (both)
Location: `pact/http/provider/state-handlers.ts:164`, `pact/http/provider/provider-helper.ts:1027`

Both comment blocks still said the onboarding/silhouette provider state was "state-setup only," that "no provider service double consumes this state yet," and that `test:pact:provider` "legitimately fails... with 404s" pending a branch merge. `feat/epic4-story4-t3t4-api` landed and was merged into this branch months before this review, and the real `mockWardrobeOnboardingService`/`mockWardrobeSilhouetteService` doubles were wired in during the earlier remediation pass; `provider-helper.ts` even carries a second, corrected comment 460 lines below the stale one that directly contradicts it. A maintainer debugging a real regression could read the stale comment and wrongly dismiss a genuine 404 as expected. Rewrote both to describe the real wiring.

### 7. Hand-duplicated literal-union type instead of the canonical contract type

Prior severity: MEDIUM
Location: `pact/http/provider/provider-helper.ts`

`SilhouetteRow`'s `mode` and `myForm.status` fields were written as inline string-literal unions instead of importing `SilhouetteMode`/`SilhouettePhotoStatus` from `@couture/api-client/contracts/http`, the same module this file already imports `SilhouettePhotoFailureReason` from for the same struct. Its sibling `OnboardingRow` correctly derives from the canonical `WardrobeOnboardingStateResponse['data']` type. A future enum addition to `silhouetteModeEnum`/`silhouettePhotoStatusEnum` would silently fail to surface here as a compiler error. Fixed by importing and using the canonical types; `npx tsc -p pact/tsconfig.json --noEmit` confirms no drift.

### 8. Redundant OpenAPI document rebuild across three tests

Prior severity: MEDIUM
Location: `packages/api-client/testing/wardrobe-silhouette-contract.spec.ts`

`generateHttpOpenApiDocument()` (a full registry rebuild across all 12 `register*Contracts` slices, followed by `OpenApiGeneratorV31.generateDocument()` and a recursive nullable-enum walk) was called once per `it()` inside the "OpenAPI Registration" describe block, three times total, with identical output each call. The sibling `wardrobe-onboarding-contract.spec.ts` and other contract-spec files in this package already establish the convention of computing it once. Fixed with a `beforeAll` shared across the three tests.

## Best practices found

### Consumer-curated matcher helpers over a shared full-response schema

Location: `pact/http/consumer/api-contract-interactions.ts`, `onboardingStateBody`/`silhouetteProfileBody`

These helpers assert only the fields the consumer actually reads, matching this file's 100% pre-existing convention (`capsuleBody` and the ritual/comfort inline matchers) rather than importing the shared full-response Zod schema, which would have over-specified the contract and blocked future field deprecation on the provider side.

### Schema invariants grounded in the real service, not guessed

Location: `packages/api-client/src/contracts/http/wardrobe.ts`, `silhouetteMyFormSchema`/`wardrobeOnboardingStateSchema` `.superRefine()`; `packages/api-client/testing/wardrobe-silhouette-contract.spec.ts:196`

Each cross-field invariant (`committedAt` set iff status is processing/ready/failed, `failureReason` set iff failed, `imageAccess` set iff ready) carries a comment citing the exact service/processor file line it encodes, with negative-fixture tests proving every invalid combination. This is the right way to harden a schema against drift: read the real implementation first, then encode what it actually does.

### Real provider doubles at the right fidelity level, not a re-simulation

Location: `pact/http/provider/provider-helper.ts`, `mockWardrobeOnboardingService`/`mockWardrobeSilhouetteService`

Canned responses per named provider state plus the documented error paths, reusing the real, pure `formatOnboardingETag`/`parseOnboardingIfMatchHeader`/`formatSilhouetteETag`/`parseSilhouetteIfMatchHeader` exports for header handling instead of hand-duplicating that logic. The full state-machine business logic is correctly left to `apps/api/integration/wardrobe-onboarding.integration.spec.ts`/`wardrobe-silhouette.integration.spec.ts` against a real database, not re-proven here.

## Validation run

Passed:

- `npx tsc -p pact/tsconfig.json --noEmit`
- `npx eslint --max-warnings=0 --ext .ts,.tsx,.mts pact` (5 prettier formatting errors auto-fixed with `--fix`, then re-verified clean)
- `npx eslint --max-warnings=0 --ext .ts packages/api-client/testing/wardrobe-silhouette-contract.spec.ts`
- `npm run test --workspace @couture/api-client` (220/220, including the 16 silhouette contract-spec tests with the shared `beforeAll`)
- `npm run test:pact` (full chain: `db:generate` -> `build:packages` -> `generate:http-openapi` -> `optic:lint` -> consumer determinism (3 runs) -> real provider verification): consumer determinism stable at 49 Web + 44 Mobile = 93 interactions across all 3 runs (unchanged from before this review, confirming the `it.each` refactor moved tests without dropping or adding interactions); provider verification 1/1 passed, all 93 interactions satisfied against the real `WardrobeOnboardingController`/`WardrobeSilhouetteController`
- Repo-wide grep for `.only(` under `pact/` and the two contract-spec files: no matches

Blocked: none.
