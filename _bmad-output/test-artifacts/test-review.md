---
stepsCompleted:
  [
    'step-01-load-context',
    'step-02-discover-tests',
    'step-03f-aggregate-scores',
    'step-04-generate-report',
  ]
lastStep: 'step-04-generate-report'
lastSaved: '2026-08-20'
workflowType: 'testarch-test-review'
inputDocuments: []
---

# Test Quality Review: Story 5.3 premium theme switcher — Pact, Playwright, adapter unit coverage

**Quality Score**: 71/100 (C - Acceptable)
**Review Date**: 2026-08-20
**Review Scope**: files (14, explicitly enumerated)
**Reviewer**: TEA Agent

---

Note: This review audits existing tests; it does not generate tests.
Coverage mapping and coverage gates are out of scope here. Use `trace` for coverage decisions.

## Executive Summary

**Overall Assessment**: Acceptable

**Recommendation**: Request Changes

**Context Basis**: none

**Context Waivers Applied**: 0

This review set is dominated by a very large, carefully-built Pact contract suite (the 5.3 premium theme switcher slice on top of four prior stories' worth of interactions) plus one Playwright spec, one adapter unit-test pair, one integration spec, and supporting infrastructure files. The engineering discipline is genuinely high in the places that matter most for a contract suite: one `addInteraction()` per `it()` everywhere (with documented rationale tied to a real PactV4 FFI bug), correct Vitest pool/parallelism/determinism-gate configuration, and a Playwright spec that is a clean, deliberate example of network-first testing with careful shared-state serialization. Set against that, the newest (Story 5.1-5.3) interactions in `api-contract-interactions.ts` consistently extract repeated request bodies into named constants and document raw-`fetch` deviations inline — a pattern several of the file's older (Story 4.3/4.4) interactions have not caught up to, which is most of what pulls the score down. Nothing in this set is CRITICAL — no disabled tests, no tautological or unreachable assertions, no test that cannot fail.

### Key Strengths

✅ Zero determinism defects across ~90 Pact interactions and the Playwright spec: no committed skips/focus, no tautological or unreachable assertions, no ungated wall-clock dependency, and a documented, consistently-applied fix for PactV4's real "multiple `addInteraction()` per `it()` drops interactions" FFI bug
✅ Pact Vitest configuration (`fileParallelism: false`, `pool: 'forks'`, `singleFork: true`) is correct on both the consumer and provider side, and the consumer determinism gate (`check-pact-determinism.sh`) is wired into `npm run test:pact:consumer`
✅ `playwright/tests/premium-theme-switcher.spec.ts` is a clean, deliberate example of network-first testing, test-id selectors, and correctly-scoped shared-state serialization (`test.describe.configure({ mode: 'serial' })` plus `beforeEach`/`afterEach` reset) for the one test that writes to a shared seeded row
✅ 100% behavioral test naming and a single assertion dialect across every reviewed file (Convention: bddNaming and assertionStyle both established at 40 of 40 sampled)
✅ `pact/http/provider/provider-helper.ts`'s module-level provider-state stores, which look like a shared-mutable-state risk on first read, are confirmed correctly reset per-interaction via the Pact Verifier's `beforeEach`/`afterEach` hooks in `api-provider.pacttest.ts`

### Key Weaknesses

❌ Two files have grown past the 1000-line maintainability ceiling: `api-contract-interactions.ts` (3985 lines, ~4x over) and `provider-helper.ts` (1711 lines)
❌ Three request-body shapes in the older capsule/My-Form interactions are retyped verbatim four times each, where the newer Story 5.1-5.3 interactions in the same file already use named constants for exactly this
❌ Three raw-`fetch` error-envelope interactions carry none of the explanatory comment their four sibling interactions all have, making an intentional pattern look accidental at three call sites
❌ A fixed `setTimeout`-based hard wait in `premium-theme.integration.spec.ts` orders two writes by wall-clock delay instead of an observable condition
❌ `load-env.spec.ts`'s `afterEach` uses `vi.clearAllMocks()` where `vi.resetAllMocks()` is needed — two tests' custom mock implementations silently survive into whatever test runs after them
❌ Priority markers are a Playwright-only habit in this repo today (12 of 40 sampled, all Playwright); six Vitest-based files in this review set carry no priority marker in any form

### Summary

Score is 71/100 (C). None of the findings are CRITICAL and none reflect a test that asserts the wrong thing — every HIGH and MEDIUM finding here is a maintainability or reliability gap (an oversize file, duplicated literals, an undocumented deviation, a hard wait, an incomplete mock reset), not a false-positive-prone or false-negative-prone assertion. Because `HIGH > 0`, the computed recommendation is **Request Changes** regardless of the numeric score: both HIGH-severity code defects (the hard wait and the incomplete mock reset) are exactly the shape HIGH rows exist to catch — a test that can fail at random, and one that can pass while hiding a real defect in a differently-ordered future run. The two oversize-file findings and the six MEDIUM consistency gaps are real debt but are follow-up-sized, not merge-blocking on their own.

## Quality Criteria Assessment

| Criterion                            | Status  | Violations | Basis                                                              | Notes                                                                                           |
| ------------------------------------ | ------- | ---------: | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| BDD Format (Given-When-Then)         | ✅ PASS |          0 | Convention: bddNaming (40 of 40 sampled)                           | Every test name in every reviewed file states behavior, not implementation                      |
| Test IDs                             | ✅ PASS |          0 | Convention: testIds (8 of 40 sampled)                              | Every DOM lookup in the one UI spec uses `getByTestId`; no CSS/text selectors on elements       |
| Priority Markers (P0/P1/P2/P3)       | ⚠️ WARN |          6 | Convention: priorityMarkers (12 of 40 sampled)                     | Playwright-only habit repo-wide; 6 Vitest-based files in this set carry none                    |
| Disabled or Focused Tests            | ✅ PASS |          0 | Absolute                                                           | No `.skip`, `.only`, `xit`, `fdescribe` anywhere in the set                                     |
| Hard Waits (sleep, waitForTimeout)   | ❌ FAIL |          1 | Absolute                                                           | Fixed `setTimeout` wait in `premium-theme.integration.spec.ts`                                  |
| Determinism (no conditionals)        | ✅ PASS |          0 | Absolute + Applicability                                           | No conditional assertions, no ungated wall-clock use                                            |
| Isolation (cleanup, no shared state) | ❌ FAIL |          1 | Absolute                                                           | Incomplete mock reset in `load-env.spec.ts`                                                     |
| Fixture Patterns                     | ⚠️ WARN |          3 | Applicability: files needing setup use fixtures/DI                 | Same 3 repeated-payload instances as Data Factories below — counted once in the ledger          |
| Data Factories                       | ⚠️ WARN |          3 | Applicability: several files construct domain payloads             | 3 request-body shapes retyped 4x each in `api-contract-interactions.ts` with no shared constant |
| Network-First Pattern                | ✅ PASS |          0 | Applicability: the file navigates and reads data-dependent content | Only `premium-theme-switcher.spec.ts` navigates; all 3 navigations are network-first            |
| Playwright Utils Adoption            | ✅ PASS |          0 | Convention: playwrightUtils (12 of 40 sampled)                     | The one `page.route` usage is a documented, legitimate exception (see Recommendation 4)         |
| Pact.js Utils Adoption               | ⚠️ WARN |          3 | Applicability: the reviewed files are JS/TS Pact artifacts         | 3 raw-`fetch` error interactions lack the explanatory comment their siblings all have           |
| Explicit Assertions                  | ✅ PASS |          0 | Absolute                                                           | Every test has a falsifiable assertion; none tautological, unreachable, or mock-only            |
| Test Length (≤1000 lines)            | ❌ FAIL |          2 | Absolute                                                           | `api-contract-interactions.ts` (3985) and `provider-helper.ts` (1711)                           |
| Test Duration (≤1.5 min)             | ⚠️ WARN |          1 | Absolute                                                           | Not directly measured; the H1 hard wait is the one evidence of timing-unsafe behavior           |
| Flakiness Patterns                   | ❌ FAIL |          2 | Absolute + Applicability                                           | Same H1 and H4 findings counted once each in the ledger                                         |

**Total Violations**: 0 Critical, 4 High, 6 Medium, 7 Low

**Convention Baseline**: 40 test files sampled outside the review set

## Quality Score Breakdown

```
Starting Score:          100
Critical Violations:     -0 × 10 = -0
High Violations:         -4 × 5 = -20
Medium Violations:       -6 × 2 = -12
Low Violations:          -7 × 1 = -7

Bonus Points:
  Excellent BDD:         +5
  Comprehensive Fixtures: +0
  Data Factories:        +0
  Network-First:         +5
  Perfect Isolation:     +0
  All Test IDs:          +0
                         --------
Total Bonus:             +10

Final Score:             71/100
Grade:                   C
```

---

## Critical Issues (Must Fix)

No critical issues detected. ✅

## Recommendations (Should Fix)

### 1. Replace the Fixed-Duration Wait Between Two Writes

**Severity**: P1 (High)
**Location**: `apps/api/integration/premium-theme.integration.spec.ts:113` (definition), used at lines 349 and 371
**Row**: H1
**Criterion**: Hard Waits
**Knowledge Base**: [test-quality.md](../../../.claude/skills/bmad-tea/resources/knowledge/test-quality.md), [timing-debugging.md](../../../.claude/skills/bmad-tea/resources/knowledge/timing-debugging.md)

**Issue Description**: A file-local `wait(ms)` helper (`return new Promise((resolve) => setTimeout(resolve, ms))`) is called as `await wait(15)` in two tests to force two sequential `PUT` writes to land in different database milliseconds, so `updated_at` can be asserted as having moved. This is a bare timer ordering test steps rather than a condition. The Absolute gate on H1 applies regardless of the legitimate-sounding justification in the surrounding comment — a slow CI runner can still make 15ms insufficient, and a fast one wastes the 15ms unconditionally.

**Current Code**:

```typescript
// ❌ Bad (current implementation)
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
// ...
await wait(15)
const second = await putTheme(app, userId, { theme: 'autumn_umber' })
```

**Recommended Fix**:

```typescript
// ✅ Good (recommended approach)
// Poll for the observable condition instead of sleeping a fixed duration:
async function waitForUpdatedAtToAdvance(after: Date, userId: string): Promise<void> {
  await expect
    .poll(async () => {
      const row = await prisma.premiumThemePreference.findUniqueOrThrow({
        where: { user_id: userId },
      })
      return row.updated_at.getTime() > after.getTime()
    })
    .toBe(true)
}
```

**Why This Matters**: The response is the state transition the assertion depends on. A fixed sleep is either too short (flaky) or wastes CI time being longer than necessary; a poll on the actual condition is deterministic across runner speeds.

**Related Violations**: The same `wait(15)` call appears at both line 349 and line 371, in two different tests. Counted as one violation (one defect, the helper's design) rather than two.

### 2. Complete the Mock Reset Between Tests

**Severity**: P1 (High)
**Location**: `apps/api/src/load-env.spec.ts:20`
**Row**: H4
**Criterion**: Isolation
**Knowledge Base**: [test-quality.md](../../../.claude/skills/bmad-tea/resources/knowledge/test-quality.md)

**Issue Description**: `afterEach` calls `vi.clearAllMocks()`, which per Vitest's own semantics only clears `mock.calls`/`mock.results` and explicitly does **not** reset a mock's `mockImplementation`. Two tests install a custom implementation that therefore survives past their own test: `loadEnvMock.mockImplementation(...)` at line 60, and `existsSyncMock.mockImplementation(...)` at line 71. Both are currently harmless only because they happen to be the last two tests in file order. Reordering the tests, adding a new test after either one, or enabling sequence shuffling would silently run the next test against the wrong `existsSync`/`dotenv.config` behavior.

**Current Code**:

```typescript
// ❌ Bad (current implementation)
afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  delete process.env.NODE_ENV
  delete process.env.TEST_ENV
  delete process.env.POSTHOG_API_KEY
})
```

**Recommended Fix**:

```typescript
// ✅ Good (recommended approach)
afterEach(() => {
  vi.resetModules()
  vi.resetAllMocks() // clears calls AND restores the default mock implementation
  delete process.env.NODE_ENV
  delete process.env.TEST_ENV
  delete process.env.POSTHOG_API_KEY
})
```

**Why This Matters**: Every test in this file should start from the same declared default mock behavior, independent of what a prior test configured. `resetAllMocks` is the one call that guarantees that; `clearAllMocks` guarantees it only for call-tracking state, not behavior.

**Related Violations**: None elsewhere in the set — `premium-theme.integration.spec.ts`'s `beforeEach` uses the correct `mockReset()` pattern for its own mocks, which is the contrasting good example.

### 3. Split the Two Oversize Pact Files

**Severity**: P1 (High)
**Location**: `pact/http/consumer/api-contract-interactions.ts` (3985 lines), `pact/http/provider/provider-helper.ts` (1711 lines)
**Row**: H5
**Criterion**: Test Length
**Knowledge Base**: [test-quality.md](../../../.claude/skills/bmad-tea/resources/knowledge/test-quality.md)

**Issue Description**: Both files are nearly four times and nearly twice the 1000-line ceiling, respectively. `api-contract-interactions.ts` is a flat sequence of ~50 exported `verify*Interaction` functions across 8 story sections, already marked by its own `/* --- Story X.Y --- */` divider comments. `provider-helper.ts` is dominated by one ~1150-line function (`startLocalPactProvider`, lines 298-1444) that inlines roughly 15 mock-service object literals plus the Nest `TestingModule` wiring.

**Current Code**: (structure, not a snippet — one flat sequence of interaction-verifier functions / one large factory function)

**Recommended Fix**: Split `api-contract-interactions.ts` along its own existing section comments into per-domain modules (e.g. `wardrobe-onboarding-interactions.ts`, `commerce-interactions.ts`, `subscription-interactions.ts`, `premium-theme-interactions.ts`) re-exported from a barrel `index.ts` that the two `*-api-client.pacttest.ts` files import from unchanged. Split `startLocalPactProvider`'s per-domain mock-service blocks (capsules, onboarding/silhouette, commerce, subscription, premium theme) into sibling modules exporting a factory each, and have the function compose them.

**Why This Matters**: A file this size is a diff-review and merge-conflict magnet — any two stories touching different domains in the same file will collide on unrelated lines. Splitting by the boundaries the file already documents is close to mechanical and carries low risk.

### 4. Extract the Three Repeated Request Bodies Into Named Constants

**Severity**: P2 (Medium)
**Location**: `pact/http/consumer/api-contract-interactions.ts:1040, 1064, 1095, 1116` (capsule-create body), `:2167, 2197, 2243, 2273` (My Form upload-url body), `:2313, 2351, 2395, 2427` (My Form commit body)
**Row**: M2
**Criterion**: Data Factories / Fixture Patterns
**Knowledge Base**: [data-factories.md](../../../.claude/skills/bmad-tea/resources/knowledge/data-factories.md)

**Issue Description**: Three request-body shapes are each retyped verbatim four times across a pair of sibling interaction functions (the "create" and its "idempotent replay" counterpart), with no shared constant:

- `{ name: 'Work capsule', occasions: ['work'], garmentIds: [CAPSULE_GARMENT_A, CAPSULE_GARMENT_B], isFavorite: false }` — 4 times, across `verifyCreateCapsuleInteraction` and `verifyCapsuleIdempotentReplayInteraction`
- `{ fileSizeBytes: 2048576, mimeType: 'image/png', sha256: SILHOUETTE_SHA256, widthPx: 1024, heightPx: 1536 }` — 4 times, across `verifyMyFormUploadUrlInteraction` and `verifyMyFormUploadUrlReplayInteraction`
- `{ uploadSessionId: SILHOUETTE_UPLOAD_SESSION_ID, confirmsBasewearGuidance: true }` — 4 times, across `verifyMyFormCommitInteraction` and `verifyMyFormCommitReplayInteraction`

This is exactly the pattern the file's own newer (Story 5.1-5.3) interactions already avoid: `affiliateClickRequestBody` (line 2719), `commerceWebhookPayload` (line 2710), `checkoutSessionRequestBody` (line 3241), and `updateThemeRequestBody`/`resetThemeRequestBody` (lines 3615-3616) are all named constants used in both the `withRequest` body and the `executeTest` client call.

**Current Code**:

```typescript
// ❌ Bad (current implementation) — retyped independently at 4 call sites
.withRequest(
  'POST',
  `/api/v1/wardrobe/${CAPSULE_OWNER_ID}/capsules`,
  setJsonContent({
    body: {
      name: 'Work capsule',
      occasions: ['work'],
      garmentIds: [CAPSULE_GARMENT_A, CAPSULE_GARMENT_B],
      isFavorite: false,
    },
  })
)
```

**Recommended Improvement**:

```typescript
// ✅ Better approach (recommended) — matching the pattern already used for
// affiliateClickRequestBody / checkoutSessionRequestBody elsewhere in this file
const capsuleCreateRequestBody = {
  name: 'Work capsule',
  occasions: ['work'],
  garmentIds: [CAPSULE_GARMENT_A, CAPSULE_GARMENT_B],
  isFavorite: false,
}
// ... reused in both withRequest bodies and both executeTest createOutfitCapsuleInput calls
```

**Benefits**: One shared constant means a change to the fixture shape only needs to happen once, and the two "create" and "replay" tests are visibly asserting against the identical input, which is the whole point of a replay test.

**Priority**: P2 — mechanical, low-risk, and the target pattern already exists twice over in the same file to copy from.

### 5. Document the Three Undocumented Raw-`fetch` Sites

**Severity**: P2 (Medium)
**Location**: `pact/http/consumer/api-contract-interactions.ts:724` (`verifySmartTagErrorInteraction`), `:1884` (`verifyWardrobeErrorInteraction`), `:3196` (`verifyAffiliateWebhookErrorInteraction`)
**Row**: M10
**Criterion**: Pact.js Utils Adoption
**Knowledge Base**: [pactjs-utils-mandate.md](../../../.claude/skills/bmad-tea/resources/knowledge/pactjs-utils-mandate.md)

**Issue Description**: Each of these three `executeTest` blocks calls raw `fetch(`${mockServer.url}${interaction.path}`, ...)` instead of the generated SDK client, with no comment anywhere on or near the line. Four structurally identical sibling functions — `verifyCapsuleErrorInteraction` (line 1473), `verifyAffiliateClickErrorInteraction` (line 3068), `verifySubscriptionErrorInteraction` (line 3574), `verifyPremiumThemeErrorInteraction` (line 3970) — all carry "The generated SDK throws on these statuses, so the request goes out directly." This is `pactjs-utils-mandate.md`'s Banned Pattern: "Raw `fetch` inside `executeTest` in a project whose consumer client is importable, with no note saying why." The reasoning clearly exists in the codebase (it's the same reasoning as the four documented siblings); it just wasn't copied to these three sites.

**Current Code**:

```typescript
// ⚠️ Could be improved (current implementation) — no explanation at line 724
.executeTest(async (mockServer: V3MockServer) => {
  const response = await fetch(`${mockServer.url}${interaction.path}`, {
    method: interaction.method,
    // ...
```

**Recommended Improvement**:

```typescript
// ✅ Better approach (recommended) — the same rationale already used at
// lines 1473, 3068, 3574, and 3970
.executeTest(async (mockServer: V3MockServer) => {
  // The generated SDK throws on these statuses, so the request goes out
  // directly: the point is to pin the status and error envelope the
  // clients branch on, not the SDK's error-handling.
  const response = await fetch(`${mockServer.url}${interaction.path}`, {
    method: interaction.method,
    // ...
```

**Benefits**: Makes an intentional, already-justified-elsewhere pattern look intentional at every site instead of at 4 of 7. Also consider standardizing all seven raw-`fetch` sites (documented and undocumented alike) on the mandate's literal `// pactjs-utils deviation: <reason>` prefix so the pattern is greppable.

**Priority**: P2 — copy-paste-sized fix, three sites.

## Additional Findings (No Registry Row — Documentation Consistency Only, No Score Impact)

Per `criteria-registry.md`'s rule that a defect matching no row is reported in prose without a severity or deduction:

- **`playwright/tests/premium-theme-switcher.spec.ts:141-144`** — the one raw `page.route()` call in the file (proving a signed-out user issues zero calls to the theme endpoint) is a genuine, legitimate exception, not a bypass: `interceptNetworkCall`'s promise only resolves on a matching call, so it cannot structurally prove an absence. The file's header docblock (lines 11-17) explains this in detail, mirroring the identical pattern in `premium-subscription.spec.ts` (Story 5.2). The one gap is that the explanation lives 130 lines above the code rather than as a colocated pointer at line 141 itself; a reader who lands there via blame or a diff won't see it without scrolling up. A one-line `// playwright-utils deviation: interceptNetworkCall cannot prove absence of a call, see file header` at line 141 would close that gap cheaply.
- **`pact/http/consumer/api-contract-interactions.ts:1473, 3068, 3574, 3970`** — these four raw-`fetch` sites carry a substantive rationale that satisfies the mandate's Banned-Pattern bar, but use their own prose rather than the registry's literal `// pactjs-utils deviation: <reason>` prefix. Not a defect on its own, but standardizing the prefix across all seven raw-`fetch` sites (these four plus the three undocumented ones above) would have made the three gaps in Recommendation 5 harder to introduce in the first place.
- **`pact/http/consumer/api-contract-interactions.ts`** (search `Provider endpoint:`, lines 3619, 3676, 3731, 3778, 3834, 3930) — only the six newest Story 5.3 premium-theme interactions carry the mandate's `// Provider endpoint: <path> -> <METHOD> <route>` comment with cited Provider Scrutiny Evidence. None of the file's other ~50 interactions (Story 2.3 through 5.2) do. This convention has no registry row of its own, so it isn't scored, but it's a good pattern worth backporting as those older interactions are next touched.

### Priority Markers Are Missing in Six Vitest-Based Files

**Severity**: P3 (Low)
**Location**: `pact/http/consumer/mobile-api-client.pacttest.ts` (0 of 45), `pact/http/consumer/web-api-client.pacttest.ts` (0 of 45), `playwright/support/helpers/accessibility.spec.ts` (0 of 2), `apps/api/integration/premium-theme.integration.spec.ts` (0 of 5 in the established bracket form), `packages/utils/src/contrast.spec.ts` (0 of ~13), `apps/api/src/load-env.spec.ts` (0 of 4)
**Row**: L2
**Criterion**: Priority Markers
**Knowledge Base**: [test-priorities-matrix.md](../../../.claude/skills/bmad-tea/resources/knowledge/test-priorities-matrix.md)

**Issue Description**: The repo's `[P0]`/`[P1]`/`[P2]` bracket-prefix convention is adopted in 12 of 40 sampled files (`emerging`), and every one of those 12 is a Playwright spec — 0 of the 22 sampled Vitest files use it. This review set's one Playwright file (`premium-theme-switcher.spec.ts`) follows the convention on all 4 of its tests; the six Vitest-based files in the set carry none. `premium-theme.integration.spec.ts` does embed `(P0, AC 3)` / `(P1)` parenthetically in two of its five test names — evidence of intent, but not the established bracket form.

**Recommended Improvement**: Either extend the bracket convention to Vitest test names the same way, or, if priority markers are meant to be a Playwright/E2E-tier concept rather than a Vitest/unit-and-contract-tier one, record that scope explicitly somewhere discoverable so the next test-review run measures the right population instead of re-deriving the split by hand.

**Priority**: P3 — a repo-wide convention question, not a defect in these six files specifically.

**Methodology note**: none of the four specialized quality-dimension workers dispatched for this review (determinism, isolation, maintainability, performance) own registry row L2 — it does not appear in any of their row-ownership tables in `steps-c/step-03{a,b,c,e}.md`. This is a gap in the workflow's own subagent partitioning, not a deliberate exclusion. The orchestrator scored it directly against the same convention baseline and deduction schedule the other Convention rows use, verified against file contents with `grep`. Granularity is per-file (one violation per file with zero adoption), matching how the file-level H5 row is reported, rather than per-test — a per-test count across ~114 tests in this set would have produced dozens of near-identical LOW findings and swamped the ledger, which is exactly the noise the Convention-scoring mechanism exists to prevent.

## Best Practices Found

### 1. Documented, Enforced Fix for a Real PactV4 FFI Bug

**Location**: `pact/http/consumer/api-contract-interactions.ts:684-695` (and repeated at 1326-1339, 1821-1832, 2989-2996, 3483-3489, 3885-3893)
**Pattern**: One `addInteraction()` per `it()`, enforced via `it.each` over exported interaction tables
**Knowledge Base**: [pactjs-utils-mandate.md](../../../.claude/skills/bmad-tea/resources/knowledge/pactjs-utils-mandate.md)

Every error-envelope interaction table (`capsuleErrorInteractions`, `onboardingErrorInteractions`, `affiliateClickErrorInteractions`, `subscriptionErrorInteractions`, `premiumThemeErrorInteractions`, etc.) is exported as data and driven by `it.each(...)` in the consuming `.pacttest.ts` files, specifically to avoid awaiting more than one `addInteraction()...executeTest()` chain inside a single test body — documented as a real, previously-hit PactV4 Rust FFI bug that non-deterministically drops interactions otherwise.

### 2. Correctly-Scoped Serial Write With Explicit Reset

**Location**: `playwright/tests/premium-theme-switcher.spec.ts:206-220`
**Pattern**: `test.describe.configure({ mode: 'serial' })` plus symmetric `beforeEach`/`afterEach` reset
**Knowledge Base**: [test-quality.md](../../../.claude/skills/bmad-tea/resources/knowledge/test-quality.md)

The one test that writes for real to a shared, worker-pooled seeded row (`PremiumThemePreference` on the `'active'` seed user) is isolated in its own `describe` block running in `serial` mode, with `beforeEach`/`afterEach` both resetting via a direct `PUT { theme: null }` (never a delete, matching the production "never delete" rule). The long serial test itself (lines 222-305) reads as one coherent selection → persist → reset journey rather than several unrelated concerns bundled together, so it is not flagged as a multi-concern test despite its length.

### 3. Verified Per-Interaction State Reset in the Pact Provider

**Location**: `pact/http/provider/provider-helper.ts` (the eight `let provider*State` stores) plus `pact/http/provider/api-provider.pacttest.ts`'s `buildVerifierOptions({ beforeEach, afterEach })`
**Pattern**: Module-level mutable state, reset through the Verifier's own per-interaction hooks rather than left to chance
**Knowledge Base**: [pactjs-utils-provider-verifier.md](../../../.claude/skills/bmad-tea/resources/knowledge/pactjs-utils-provider-verifier.md)

`provider-helper.ts`'s module-level `let` state stores look, on first read, like exactly the H4 shared-mutable-state shape. They are not: `resetProviderState()` is wired into both `beforeEach` and `afterEach` of the Pact Verifier options in `api-provider.pacttest.ts`, and Pact's own verifier semantics fire these proxy hooks once per interaction, not once per suite. Confirmed rather than assumed.

### 4. Newest Interactions Model the Full Mandate

**Location**: `pact/http/consumer/api-contract-interactions.ts:2719, 2710, 3241, 3615-3616, 3619-3930`
**Pattern**: Named request-body constants plus the `// Provider endpoint:` comment with cited Provider Scrutiny Evidence
**Knowledge Base**: [pactjs-utils-mandate.md](../../../.claude/skills/bmad-tea/resources/knowledge/pactjs-utils-mandate.md), [contract-testing.md](../../../.claude/skills/bmad-tea/resources/knowledge/contract-testing.md)

The Story 5.1-5.3 interactions are the cleanest in the file: `affiliateClickRequestBody`, `commerceWebhookPayload`, `checkoutSessionRequestBody`, `updateThemeRequestBody`/`resetThemeRequestBody` are all named constants, and the six newest premium-theme interactions cite the exact controller handler and line range backing each matcher. This is the pattern Recommendations 4 and 5 above ask the older interactions to catch up to — the fix is "make the rest of the file look like the newest sixth of it," not a new pattern to invent.

### 5. Two Independent App/Connection Contexts Proving Real Persistence

**Location**: `apps/api/integration/premium-theme.integration.spec.ts:154-173, 221-228`
**Pattern**: Two fully independent `TestingModule`/`PrismaClient` pairs (`app`/`app2`)
**Knowledge Base**: [test-levels-framework.md](../../../.claude/skills/bmad-tea/resources/knowledge/test-levels-framework.md)

A write through `app` and a read through `app2` share no in-process JS heap state, only the real database — genuinely proving cross-connection persistence rather than asserting against a cache the production code doesn't even have.

## Test File Analysis

### File Metadata

| File                                                     | Lines | Framework           | Role                                                            |
| -------------------------------------------------------- | ----: | ------------------- | --------------------------------------------------------------- |
| `pact/http/consumer/api-contract-interactions.ts`        |  3985 | TypeScript / PactV4 | Shared interaction-definition library (not a test file)         |
| `pact/http/consumer/mobile-api-client.pacttest.ts`       |   358 | Vitest / PactV4     | Consumer contract test (CoutureCastMobile)                      |
| `pact/http/consumer/web-api-client.pacttest.ts`          |   372 | Vitest / PactV4     | Consumer contract test (CoutureCastWeb)                         |
| `pact/http/provider/provider-helper.ts`                  |  1711 | TypeScript / NestJS | Provider doubles, state stores, app bootstrap (not a test file) |
| `pact/http/provider/state-handlers.ts`                   |   425 | TypeScript / Pact   | Verifier `stateHandlers` map (not a test file)                  |
| `playwright/tests/premium-theme-switcher.spec.ts`        |   395 | Playwright          | E2E spec, Story 5.3                                             |
| `playwright/support/helpers/accessibility.ts`            |   106 | TypeScript          | a11y + contrast-ratio adapter helper (not a test file)          |
| `playwright/support/helpers/accessibility.spec.ts`       |    53 | Vitest              | Adapter delegation unit test                                    |
| `apps/api/integration/premium-theme.integration.spec.ts` |   392 | Vitest / Supertest  | Integration spec against real PostgreSQL                        |
| `packages/utils/src/contrast.spec.ts`                    |   199 | Vitest              | Pure-function unit test (contrast ratio math)                   |
| `apps/api/src/load-env.ts`                               |    70 | TypeScript          | Env-loading bootstrap (not a test file)                         |
| `apps/api/src/load-env.spec.ts`                          |    78 | Vitest              | Unit test for the bootstrap above                               |
| `scripts/start-api-e2e-with-workers.mjs`                 |   339 | Node.js script      | E2E orchestration script (not a test file)                      |
| `package.json`                                           |   169 | JSON                | Workspace config (scripts, dependencies)                        |

### Test Structure

- **Total test cases across the set**: ~114 (`it`/`test`/`it.each` sites): ~45 in `mobile-api-client.pacttest.ts`, ~45 in `web-api-client.pacttest.ts` (both driven substantially by shared `it.each` tables from `api-contract-interactions.ts`), 4 in `premium-theme-switcher.spec.ts`, 2 in `accessibility.spec.ts`, 5 in `premium-theme.integration.spec.ts`, ~13 in `contrast.spec.ts`, 4 in `load-env.spec.ts`
- **Fixtures used**: `premiumFreshTest`/`premiumSeededTest` (from `support/helpers/premium-session.ts`) and the anonymous `merged-fixtures` test in the Playwright spec; two independently-compiled NestJS `TestingModule`s (`app`/`app2`) in the integration spec
- **Data factories used**: `@couture/testing`'s `buildPremiumEntitlementCreateInput`/`createPremiumEntitlement` in the integration spec; Pact interaction bodies and the contrast fixture table are deliberately literal by design, except the three repeated shapes flagged in Recommendation 4, which should be named constants like their newer siblings

### Test Scope

- **Test IDs embedded in names**: `5.3-E2E-010` through `5.3-E2E-013` (Playwright spec), `5.3-INT-001`/`5.3-INT-002` (integration spec, 2 of 5 tests), `5.3-UTIL-001` through `5.3-UTIL-008` (contrast spec, 9 of ~13 tests), `5.3-UTIL-007` (accessibility adapter spec)
- **Priority Distribution** (bracket-form `[P#]` only, per the established Playwright convention):
  - P0: 3 (`premium-theme-switcher.spec.ts`: 5.3-E2E-011, 5.3-E2E-010, 5.3-E2E-013)
  - P1: 1 (`premium-theme-switcher.spec.ts`: 5.3-E2E-012)
  - P2: 0
  - P3: 0
  - Unknown/unmarked: ~110 (every test in the other 6 test-bearing files)

### Assertions Analysis

- **Assertion style**: `expect(...).toX(...)` throughout — Vitest matchers in the Vitest files, Playwright's auto-retrying web-first matchers in the E2E spec. No `assert`/`chai` dialect anywhere in the set (Convention: assertionStyle, established, 40 of 40 sampled)
- **No tautological, unreachable, or mock-only assertions found anywhere in the set**

## Context and Integration

### What the Context Said

No story, PRD, or test-design document was supplied for this review (`context_basis: none`). The findings above speak to how these tests are built — determinism, isolation, maintainability, and structure — not to whether they cover a specific requirement. Coverage-to-requirement mapping is out of scope for `test-review`; use `trace` for that.

## Knowledge Base References

This review consulted the following knowledge base fragments:

- [test-quality.md](../../../.claude/skills/bmad-tea/resources/knowledge/test-quality.md) — Definition of Done for tests
- [fixture-architecture.md](../../../.claude/skills/bmad-tea/resources/knowledge/fixture-architecture.md) — Pure function → Fixture → mergeTests pattern
- [network-first.md](../../../.claude/skills/bmad-tea/resources/knowledge/network-first.md) — Route intercept before navigate
- [data-factories.md](../../../.claude/skills/bmad-tea/resources/knowledge/data-factories.md) — Factory functions with overrides
- [test-levels-framework.md](../../../.claude/skills/bmad-tea/resources/knowledge/test-levels-framework.md) — E2E vs API vs Component vs Unit appropriateness
- [selective-testing.md](../../../.claude/skills/bmad-tea/resources/knowledge/selective-testing.md) — Tag/priority-based execution
- [test-healing-patterns.md](../../../.claude/skills/bmad-tea/resources/knowledge/test-healing-patterns.md) — Failure-pattern catalog
- [selector-resilience.md](../../../.claude/skills/bmad-tea/resources/knowledge/selector-resilience.md) — Selector hierarchy
- [timing-debugging.md](../../../.claude/skills/bmad-tea/resources/knowledge/timing-debugging.md) — Deterministic waiting, wall-clock fixtures, unawaited promises
- [playwright-utils-mandate.md](../../../.claude/skills/bmad-tea/resources/knowledge/playwright-utils-mandate.md) — REQUIRED/RECOMMENDED substitution table for M9/L9
- [pactjs-utils-mandate.md](../../../.claude/skills/bmad-tea/resources/knowledge/pactjs-utils-mandate.md) — REQUIRED/RECOMMENDED substitution table for M10
- [pact-consumer-di.md](../../../.claude/skills/bmad-tea/resources/knowledge/pact-consumer-di.md) — Mock-server DI pattern
- [contract-testing.md](../../../.claude/skills/bmad-tea/resources/knowledge/contract-testing.md) — Contract testing fundamentals
- [pact-mcp.md](../../../.claude/skills/bmad-tea/resources/knowledge/pact-mcp.md) — Broker MCP degradation path
- [confidence-gate.md](../../../.claude/skills/bmad-tea/resources/knowledge/confidence-gate.md) — Evidence-before-generation discipline
- [evidence-integrity.md](../../../.claude/skills/bmad-tea/resources/knowledge/evidence-integrity.md) — Falsifiability standards for this review's own findings

For coverage mapping, consult `trace` workflow outputs.

See [tea-index.csv](../../../.claude/skills/bmad-tea/resources/tea-index.csv) for the complete knowledge base.

## Next Steps

### Immediate Actions (Before Merge)

1. **Replace the fixed 15ms wait in `premium-theme.integration.spec.ts`** with a poll on `updated_at` actually changing.
   - Priority: P1
   - Owner: PR author
   - Estimated Effort: 15 minutes

2. **Switch `load-env.spec.ts`'s `afterEach` from `clearAllMocks()` to `resetAllMocks()`.**
   - Priority: P1
   - Owner: PR author
   - Estimated Effort: 5 minutes

### Follow-up Actions (Future PRs)

1. **Split `api-contract-interactions.ts` and `provider-helper.ts`** along their own existing domain-section boundaries.
   - Priority: P1 (tracked as follow-up since it's a larger, higher-risk mechanical refactor best done as its own reviewable change)
   - Target: next available slot; do not let the file grow further in the meantime

2. **Extract the three repeated request bodies into named constants** and **add the missing rationale comment at the three undocumented raw-`fetch` sites**.
   - Priority: P2
   - Target: next touch of `api-contract-interactions.ts`

3. **Decide and record whether priority markers are meant to be a Playwright-only convention or a repo-wide one**, then batch-apply to the six files currently missing them if the answer is repo-wide.
   - Priority: P3
   - Target: backlog

### Re-Review Needed?

⚠️ Re-review after the two HIGH findings (H1, H4) are fixed. The computed recommendation remains `Request Changes` until both are resolved; the H5 and M2/M10 findings do not block merge on their own but should not be allowed to grow further.

## Decision

**Recommendation**: Request Changes

**Rationale**: Two HIGH-severity defects (a hard wait that can flake on a slow runner, and an incomplete mock reset that can silently corrupt an unrelated future test) are both real correctness/reliability risks despite the 71/100 score, and `HIGH > 0` computes to `Request Changes` regardless of the numeric score. The two oversize-file findings and six MEDIUM/LOW documentation-consistency gaps are real debt but not independently blocking; they're called out as required follow-up so the debt doesn't compound further. Nothing in this set is CRITICAL.

**For Request Changes**:

> Test quality needs improvement with 71/100 score. There are no CRITICAL findings, but both HIGH violations should be fixed before merge: they are exactly the two shapes HIGH rows exist to catch, a test that can fail at random (the hard wait) and one that can pass while hiding a real defect in a future, differently-ordered run (the incomplete mock reset).

## Appendix

### Violation Summary by Location

| File                                                     | Line | Severity | Row | Criterion                   | Issue                                                                 | Fix                                                                |
| -------------------------------------------------------- | ---: | -------- | --- | --------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/api/integration/premium-theme.integration.spec.ts` |  113 | P1       | H1  | Hard Waits                  | Fixed `setTimeout(resolve, 15)` orders two writes                     | Poll the observable `updated_at` change instead                    |
| `apps/api/src/load-env.spec.ts`                          |   20 | P1       | H4  | Isolation                   | `clearAllMocks()` leaves `mockImplementation` set                     | Use `resetAllMocks()`                                              |
| `pact/http/consumer/api-contract-interactions.ts`        |    1 | P1       | H5  | Test Length                 | 3985 lines, ~4x the ceiling                                           | Split along existing story-section boundaries                      |
| `pact/http/provider/provider-helper.ts`                  |    1 | P1       | H5  | Test Length                 | 1711 lines                                                            | Split per-domain doubles/state stores into sibling modules         |
| `pact/http/consumer/api-contract-interactions.ts`        | 1040 | P2       | M2  | Data Factories              | Capsule-create body repeated verbatim 4x                              | Extract `capsuleCreateRequestBody` constant                        |
| `pact/http/consumer/api-contract-interactions.ts`        | 2167 | P2       | M2  | Data Factories              | My Form upload-url body repeated verbatim 4x                          | Extract `myFormUploadRequestBody` constant                         |
| `pact/http/consumer/api-contract-interactions.ts`        | 2313 | P2       | M2  | Data Factories              | My Form commit body repeated verbatim 4x                              | Extract `myFormCommitRequestBody` constant                         |
| `pact/http/consumer/api-contract-interactions.ts`        |  724 | P2       | M10 | Pact.js Utils Adoption      | Raw `fetch` in `verifySmartTagErrorInteraction`, no rationale         | Add the sibling comment from lines 1473/3068/3574/3970             |
| `pact/http/consumer/api-contract-interactions.ts`        | 1884 | P2       | M10 | Pact.js Utils Adoption      | Raw `fetch` in `verifyWardrobeErrorInteraction`, no rationale         | Add the sibling comment                                            |
| `pact/http/consumer/api-contract-interactions.ts`        | 3196 | P2       | M10 | Pact.js Utils Adoption      | Raw `fetch` in `verifyAffiliateWebhookErrorInteraction`, no rationale | Add the sibling comment                                            |
| `playwright/support/helpers/accessibility.ts`            |   15 | P3       | L1  | Test IDs / Fragile Selector | `page.locator('main#main-content')` is a CSS id selector              | Use `page.getByRole('main')`                                       |
| `pact/http/consumer/mobile-api-client.pacttest.ts`       |    — | P3       | L2  | Priority Markers            | 0 of 45 tests carry a marker                                          | Add `[P#]` markers, or record the Playwright-only convention scope |
| `pact/http/consumer/web-api-client.pacttest.ts`          |    — | P3       | L2  | Priority Markers            | 0 of 45 tests carry a marker                                          | Same as above                                                      |
| `playwright/support/helpers/accessibility.spec.ts`       |    — | P3       | L2  | Priority Markers            | 0 of 2 tests carry a marker                                           | Same as above                                                      |
| `apps/api/integration/premium-theme.integration.spec.ts` |    — | P3       | L2  | Priority Markers            | 0 of 5 tests use the established bracket form                         | Same as above                                                      |
| `packages/utils/src/contrast.spec.ts`                    |    — | P3       | L2  | Priority Markers            | 0 of ~13 tests carry a marker                                         | Same as above                                                      |
| `apps/api/src/load-env.spec.ts`                          |    — | P3       | L2  | Priority Markers            | 0 of 4 tests carry a marker                                           | Same as above                                                      |

### Quality Trends

No earlier review exists for this file set.

## Reviewed Files

- pact/http/consumer/api-contract-interactions.ts
- pact/http/consumer/mobile-api-client.pacttest.ts
- pact/http/consumer/web-api-client.pacttest.ts
- pact/http/provider/provider-helper.ts
- pact/http/provider/state-handlers.ts
- playwright/tests/premium-theme-switcher.spec.ts
- playwright/support/helpers/accessibility.ts
- playwright/support/helpers/accessibility.spec.ts
- apps/api/integration/premium-theme.integration.spec.ts
- packages/utils/src/contrast.spec.ts
- apps/api/src/load-env.ts
- apps/api/src/load-env.spec.ts
- scripts/start-api-e2e-with-workers.mjs
- package.json

## Review Context

- none

## Runtime and Methodology Notes

- `playwright_utils_installed`: true (`@seontechnologies/playwright-utils` 3.14.0 in `package.json` devDependencies)
- `pactjs_utils_installed`: true (`@seontechnologies/pactjs-utils` 1.1.0 in `package.json` devDependencies)
- `pact_mcp_reachable`: false — the SmartBear MCP "Review Pact Tests" tool was probed via a tool-list search and is not present in this session's tool set. Per `pact-mcp.md`'s degradation path, Pact matcher/state review fell back to provider source: `apps/api/src/modules/commerce/premium-theme.controller.ts`, `premium-theme.service.ts`, `wardrobe-onboarding.service.ts`, `wardrobe-silhouette.service.ts`, and the other controllers/services `provider-helper.ts` wires up directly, all read in full as part of this review. No broker data was used or implied to have been used anywhere in this report.
- Execution mode: four quality-dimension passes were run as dispatched background subagents — determinism, isolation, and performance each independently read all 14 files in full against their owned registry rows and completed in 2-5.5 minutes. The maintainability subagent took substantially longer (about 7.5 minutes) than its peers; the orchestrator independently completed its own maintainability pass in the interim as a safety net, then reconciled the two on arrival, keeping the dispatched worker's findings wherever they differed (it found six real violations — three repeated-payload instances, three undocumented raw-`fetch` sites — the orchestrator's own faster pass had missed, and correctly overturned one false-positive the orchestrator's pass had flagged, a multi-concern-test finding on the Playwright spec's serial write journey).
- Registry row L2 (Priority Markers) is owned by none of the four workers' row-ownership tables in `steps-c/step-03{a,b,c,e}.md` — a gap in the workflow's own subagent partitioning — and was scored directly by the orchestrator against the same convention-baseline schedule the other Convention rows use.
- Convention baseline was computed by a dedicated subagent pass over 40 files sampled from a corpus of 60 test files outside the review set, closest-first by directory distance, with every sampled file read in full.
