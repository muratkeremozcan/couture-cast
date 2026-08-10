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
  - _bmad-output/implementation-artifacts/4-4-wardrobe-onboarding-silhouette-setup.md
  - _bmad-output/test-artifacts/testing-standards.md
  - _bmad-output/test-artifacts/test-reviews/README.md
  - _bmad-output/test-artifacts/test-reviews/wardrobe-onboarding-silhouette-pact-test-review-2026-08-10.md
  - _bmad-output/test-artifacts/story-4.4-t5-web-test-review.md
  - _bmad-output/project-knowledge/learning-path-step-by-step.md
  - _bmad/tea/config.yaml
---

# Test quality review: Story 4.4 Tasks 1-7, full merged suite (API, DB/RLS, Mobile; Web/Pact/factories re-verified)

Review date: 2026-08-10
Review scope: the complete, already-merged Tasks 1-7 test suite for Story 4.4 "Wardrobe onboarding and silhouette setup" on `main`, executed from branch `feat/epic4-story4-murat-test-review`
Reviewer: Murat / TEA

Note: this review audits test quality. Coverage mapping and coverage gates are out of scope; use `trace` for coverage decisions.

This story already carries multiple prior review rounds (CodeRabbit, `bmad-code-review` adversarial passes, and two prior dedicated `bmad-tea` passes — one on Task 5 Web, `_bmad-output/test-artifacts/story-4.4-t5-web-test-review.md`, and one on Task 7 Pact, `wardrobe-onboarding-silhouette-pact-test-review-2026-08-10.md`, both read in full before starting). This review's job was to cover the parts of the Tasks 1-7 surface that had **not** yet had a dedicated test-architecture pass — backend API unit specs, backend API integration specs, and DB/RLS specs had none; Mobile had review-driven fixes recorded in the story's completion notes but no standalone report — and to re-verify, lightly, that Web/Pact/factories are still in the state their own reports describe. Every finding below is new; nothing already fixed in a prior round is re-flagged.

## Executive summary

Overall score across the four newly-reviewed areas: 95/100 (weighted average), grade A
Recommendation: Approve

Four parallel review passes ran, one per functional area, each grounded in this repo's own `testing-standards.md` and the four-dimension rubric (determinism, isolation, maintainability, performance). Combined, they surfaced **25 real findings**, all fixed directly in test files with real verification (unit runs, and for integration/DB, real local PostgreSQL + Redis, not mocks). Two were HIGH severity — both isolation bugs where `process.env` restoration used direct assignment instead of delete-if-undefined, which in Node.js sets a variable to the literal string `"undefined"` instead of unsetting it, silently corrupting global state for later tests in the same process. No production code was modified in this review; three production-code observations were surfaced and are listed as flagged-not-fixed below, for the parent session's judgment.

Web (Task 5) and Pact/api-client-testing (Task 7) were not re-reviewed from scratch — both already have dedicated, dated reports recording fixes with full verification. I spot-checked that those fixes are still present in the current code and re-ran their full suites; both are green (Web: 30 files / 427 tests; `@couture/api-client`: 18 files / 365 tests). `packages/testing`'s two new factories and the `wardrobe-onboarding-analytics.spec.ts` negative-fixture spec were read in full and found clean — no findings, no changes made.

## Scope and area scores

| Area                                                                   | Files                                                                                                        | Dimension scores (post-fix)                                                                                                                             | Weighted | Reviewed by                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | -------------------------------------------- |
| Backend API unit specs                                                 | 10 files under `apps/api/src/modules/wardrobe/*.spec.ts` + `apps/api/src/workers/wardrobe.bootstrap.spec.ts` | Determinism 100, Isolation 100, Maintainability 100, Performance 100                                                                                    |      100 | Dedicated subagent pass                      |
| Backend API integration specs                                          | `apps/api/integration/wardrobe-onboarding.integration.spec.ts`, `wardrobe-silhouette.integration.spec.ts`    | Determinism 98, Isolation 95, Maintainability 92, Performance 96                                                                                        |       95 | Dedicated subagent pass                      |
| DB / RLS specs                                                         | `packages/db/test/wardrobe-onboarding-schema.spec.ts`, `rls-policies.spec.ts` (`4.4-DB-003` block)           | Determinism 95, Isolation 95, Maintainability 85, Performance 95                                                                                        |       93 | Dedicated subagent pass                      |
| Mobile wardrobe specs                                                  | 6 files under `apps/mobile/{components,src/features,src/lib}/wardrobe/**`                                    | Determinism 96, Isolation 93, Maintainability 90, Performance 94 (+ Accessibility-testing quality 87, tracked separately, not part of the 4-dim weight) |       93 | Dedicated subagent pass                      |
| Web (Task 5)                                                           | `page.test.tsx`, `silhouette-settings-panel.test.tsx`, `wardrobe.test.ts`                                    | Not re-scored — prior report (2026-08-09) stands at 91/100                                                                                              |        — | Re-verified only (fixes intact, suite green) |
| Pact + api-client testing (Task 7)                                     | `pact/http/**`, `packages/api-client/testing/wardrobe-*.spec.ts`                                             | Not re-scored — prior report (2026-08-10) stands at 100/100                                                                                             |        — | Re-verified only (fixes intact, suite green) |
| `packages/testing` factories + `wardrobe-onboarding-analytics.spec.ts` | `wardrobe-onboarding.factory.ts`, `silhouette-profile.factory.ts`                                            | Read in full, no findings                                                                                                                               |        — | Direct read, no dedicated pass needed        |

Weighted average across the four dedicated-pass areas: (100 + 95 + 93 + 93) / 4 = 95.25, rounds to **95/100, grade A**.

## Findings — fixed

### Backend API unit specs (`apps/api/src/modules/wardrobe/*.spec.ts`, `wardrobe.bootstrap.spec.ts`)

1. **Isolation, HIGH.** `wardrobe-upload-token.spec.ts` — `afterEach` restored `WARDROBE_UPLOAD_TOKEN_SECRET`/`NODE_ENV` via `process.env.X = originalValue`. When the original value is `undefined` (the common case), Node coerces the assignment to the literal string `"undefined"` rather than unsetting the variable, corrupting global state for any later test in the same process. Fixed with delete-if-undefined restoration, matching the correct pattern already established elsewhere in this same story (`wardrobe.bootstrap.spec.ts`).
2. **Isolation, HIGH.** `silhouette-photo-moderation.engine.spec.ts` — identical bug on `SILHOUETTE_MODERATION_ENGINE`/`NODE_ENV`. If corrupted to the string `"undefined"`, `createSilhouetteModerationEngine()`'s real implementation throws `Unsupported SILHOUETTE_MODERATION_ENGINE value: undefined` for any test relying on the default engine. Fixed the same way.
3. **Maintainability, LOW.** `wardrobe-silhouette.service.spec.ts` — `tokenFor()` was defined twice, byte-for-byte identical, in two nested `describe` blocks. Consolidated to one shared helper.
4. **Maintainability, LOW.** Same file — `pendingSession(bytes)` and `pending(bytes, overrides)` were near-duplicate row builders (the latter a strict superset). Consolidated to one `pending()`.
5. **Maintainability, MEDIUM.** `wardrobe-silhouette.controller.spec.ts` (478 lines, 21 tests) was almost entirely flat under one top-level `describe`. Restructured into per-route `describe` groups (`getProfile`, `updateSliders`, `createMyFormUploadUrl`, `uploadMyFormBytes`, `commitMyForm`, `deleteMyForm`) — no test IDs, assertions, or bodies changed.
6. **Maintainability, LOW.** Same file — a 36-character idempotency-key UUID literal was repeated 6 times. Extracted to a named constant.
7. **Maintainability, LOW.** `wardrobe-onboarding.service.spec.ts` (349 lines, 14 flat tests for one method) — added 5 logical sub-`describe` groups. No behavior change.

Verification: 10 files / 139 tests targeted, full `api` unit workspace 117 files (1 skipped) / 1271 tests (5 pre-existing, unrelated skips) — all green. `lint`/`typecheck` clean.

### Backend API integration specs (`apps/api/integration/wardrobe-onboarding.integration.spec.ts`, `wardrobe-silhouette.integration.spec.ts`)

All previously-fixed issues from prior review rounds (real-BullMQ job draining, `onTestFinished` cleanup ordering, `PreconditionFailedException` assertions, `beforeAll` queue clearing, explicit timeouts, `worker.on('error')` capture, `queue.onModuleDestroy()`) were verified still intact — no regressions.

1. **Maintainability/traceability, MEDIUM.** `4.4-INT-10` was reused as a test ID by both files (onboarding's crash-replay-telemetry test and silhouette's virtual-default-profile test), breaking ID-based traceability into the story's own dev-record prose. Renumbered the silhouette-side collision to `4.4-INT-19` (next free id in the shared `4.4-INT-*` sequence).
2. **Determinism/assertion precision, LOW.** The missing-`If-Match` case in `wardrobe-silhouette.integration.spec.ts` asserted `rejects.toBeInstanceOf(Error)` — since `HttpException` extends `Error`, this would still pass if a regression made the parser throw an unrelated error instead of the documented 428. Tightened to `HttpException`, matching the sibling onboarding test.
3. **Isolation, MEDIUM.** `beforeAll` sets `process.env.WARDROBE_UPLOAD_TOKEN_SECRET` and never restored it — a cross-file leakage risk, and an inconsistency with three sibling spec files in the same package that all save/restore or use `vi.stubEnv` for this exact variable. Fixed: captured and restored (or deleted) in `afterAll`.
4. **Real-vs-mock boundary, LOW.** A test named "...with no persisted row" never actually queried the real database — only asserted the service's return value, unlike its sibling `4.4-INT-01`. Added the real `prisma.silhouetteProfile.findUnique` / `toBeNull()` check.
5. **Maintainability, LOW.** Three near-identical `await import('node:crypto')` dynamic imports for `createHash`, despite `randomUUID` from the same module already being statically imported. Hoisted to the static import.

Verification: 4 consecutive full runs against real local PostgreSQL (127.0.0.1:54322) and Redis (`couturecast-redis`), each 19/19 passing; the canonical `npm run test:integration` invocation swept the whole `integration/` folder — 71 passed, 5 pre-existing unrelated skips, matching the story's own documented skip count. `lint`/`typecheck`/`prettier` clean.

### DB / RLS specs (`packages/db/test/wardrobe-onboarding-schema.spec.ts`, `rls-policies.spec.ts`)

The single most important check — that `wardrobe-onboarding-schema.spec.ts` proves real applied-schema behavior rather than string-grepping the migration file, the exact anti-pattern Story 4.3's review caught — **passed**: confirmed empirically by contrasting it against a genuinely-string-grepping pre-existing sibling (`garment-upload-schema.spec.ts`), which this file does not resemble.

1. **Maintainability, MEDIUM.** A test titled "scopes `my_form_object_path` **and `upload_session_id`** uniqueness globally" only ever exercised the former. Added a second real duplicate-insert-rejection assertion for `my_form_upload_session_id`.
2. **Coverage completeness, MEDIUM.** The `4.4-DB-003` RLS block only ever exercised `SELECT`/`UPDATE` for both new tables — the declared INSERT/DELETE policies (including decision 10's explicit claim that a full-access guardian gets raw DB-level write capability) were never behaviorally proven. Extended the owner and full-access-guardian tests to actually `DELETE` then `INSERT`, and the read-only-guardian test with a blocked `DELETE` and a WITH-CHECK-refused `INSERT`.
3. **Actor-matrix completeness, MEDIUM.** "Pending" consent (as opposed to "revoked") was never tested, despite Task 1's own checklist naming it explicitly. Added a real `pending` `GuardianConsent` scenario for both tables.
4. **Actor-matrix completeness, MEDIUM.** The Postgres `service_role` leg was absent, despite Task 1's checklist naming it and a real, provable boundary existing (`service_role` has `BYPASSRLS` but no table `GRANT` — confirmed via direct `docker exec` against the local Supabase Postgres). Added a `42501`-permission-denied assertion for both tables.

No schema/migration/production changes were needed — all four findings were pure test-completeness gaps.

Verification: full `@couture/db` suite, 8 files / 74 tests, all green, run twice for stability against real local Postgres. Post-suite DB residue check confirmed zero leaked rows from any new test path. `lint`/`typecheck` clean.

### Mobile wardrobe specs (`wardrobe-onboarding-screen.test.tsx`, `wardrobe-silhouette-screen.test.tsx`, `wardrobe-hub-screen.test.tsx`, `silhouette-editor.test.tsx`, `garment-capture-modal.test.tsx`, `src/lib/wardrobe.test.ts`)

All previously-fixed issues from the Task 6 review pass (mimeType-on-skip-resize, checklist-gate status handling, per-slider announcement naming, `pollGarmentUntilSettled` extraction, My-Form resume-into-processing polling, idempotency-key-on-retry, retry-after-412 revision refresh, guarded `resolveOwnerUserId`, the `native-utils`/`expo-native-helpers` split) were verified still intact — no regressions.

1. **Performance, MEDIUM.** `wardrobe-onboarding-screen.test.tsx`'s garment-poll test paid a real ~1s+ wall-clock wait — the same bug class already fixed once for `silhouette-editor.test.tsx`, but `WardrobeOnboardingScreen` has no injectable poll-offsets prop the way `WardrobeHubScreen` does. Fixed at the test level via a scoped `vi.mock` collapsing the poll delay to 5ms while preserving real abort-signal semantics, without touching production code. Runtime dropped from ~1s+ to ~400ms for that file.
2. **Isolation, LOW (×4 files).** `process.env.EXPO_PUBLIC_API_BASE_URL` set in `beforeEach` but never restored in `afterEach` in four files, unlike two sibling files that do. Fixed in all four to match the established pattern.
3. **Isolation, MEDIUM.** `wardrobe-silhouette-screen.test.tsx`'s access-token resolver was restored as the last line of each test body — a failing assertion earlier in the test would skip cleanup and leak the resolver into the next test. Converted to `let` + `afterEach`, matching every other file in scope.
4. **Maintainability, LOW.** A default-silhouette-profile literal duplicated verbatim 3 times in one file. Extracted to a shared constant.
5. **Maintainability, MEDIUM.** Two tests in `wardrobe-hub-screen.test.tsx` manually inlined ~90 lines of capture-flow/upload-handler boilerplate that existing helpers in the same file already covered. Rewrote both to use the existing helpers.
6. **Maintainability, LOW.** An identical `press()` helper (with its explanatory comment) was duplicated verbatim across two files. Extracted to a new shared `apps/mobile/src/test-utils/press.ts` (test-support code only, no production files touched).
7. **Maintainability, MEDIUM.** `garment-capture-modal.test.tsx` repeated a "pick library photo → wait for crop step" sequence inline ~9 times. Extracted two helpers, replaced all 9 call sites.
8. **Maintainability, LOW.** `src/lib/wardrobe.test.ts` duplicated the same `beforeEach`/`afterEach` env-restore pair across 3 of 4 `describe` blocks. Hoisted to one top-level pair.
9. **Accessibility-testing coverage, MEDIUM.** `wardrobe-silhouette-screen.test.tsx` has 3 render branches (loading / editor / sign-in prompt) but only 2 were tested — the loading `ActivityIndicator`'s `accessibilityLabel` was never verified, a real AC5 gap on a component this small. Extended the existing test to assert it on the initial synchronous render.

Verification: 6 files / 107 tests targeted, full mobile workspace 52 files / 463 tests, all green (plus widget/watchOS prebuild checks). `lint`/`typecheck` clean (one real `@typescript-eslint/consistent-type-imports` violation was introduced mid-fix and caught/fixed by the same pass).

## Findings — deliberately deferred (not fixed), with rationale

- **Backend unit, informational.** `wardrobe-silhouette.service.spec.ts` calls a `sharp()`-based `portraitPng()` helper 11 times (9 with identical default args) rather than caching one buffer. Real, sub-millisecond cost each; judged not worth the churn of touching 9 call sites in an already-large file for negligible wall-clock savings.
- **Backend unit, informational.** A handful of `new Date(Date.now() + 60_000)` fixture timestamps build "not-yet-expired"/"expired" values against the live clock rather than a mocked one. 60-second margins against millisecond-scale synchronous tests make this a non-issue in practice.
- **Backend integration.** `drainModerationJob`/`4.4-INT-15`'s inline-worker duplication, and the repo-wide `apps/api/integration/**` convention of not using `@couture/testing` factories — both already on record twice in prior review rounds as consciously deferred; not re-litigated.
- **Mobile, LOW.** `SliderRow`'s `accessibilityValue`/`aria-valuenow` binding is never directly asserted — investigated and found genuinely ambiguous whether the installed react-native-web version populates it at all from the object-shaped prop this component passes; the live-region announcement (already tested) is the mechanism a screen-reader user would actually rely on, so AC5's practical intent is covered. Left as a documented LOW gap rather than adding a possibly-no-op assertion.
- **Mobile, LOW.** Mode-tab and slider-stepper assertions use `testID` rather than `getByRole`/`getByLabelText` in places — a valid RTL pattern, not a defect, but a `getByRole`-based tightening is a real future enhancement.
- **Pact/api-client (Task 7, from the 2026-08-10 report, re-confirmed still open).** Duplicate error-envelope verification logic across three near-identical functions — already documented and deferred twice; not re-touched here.

## Flagged: production-code observations (not fixed — out of a test-review's authority)

These surfaced while reading production code to judge whether a test's assertions were meaningful. None were acted on; each is a production-code question, not a test-file defect, and deserves the parent session's or story owner's judgment rather than a guess made under review-time pressure — consistent with this story's own established convention of flagging rather than guessing at ambiguous behavior.

1. **`SilhouetteProfile.revision` does not increment on `createMyFormUploadUrl` or `uploadMyFormBytes`**, only on `commitMyForm`, slider updates, and delete. This means the response body's `myForm.status` can change (`null` → `pending_upload` → `bytes_uploaded`) without the strong ETag (`"silhouette:<userId>:<revision>"`) changing. Traced this end-to-end: the API has no conditional-GET (`If-None-Match`/304) path anywhere in this controller, and both Web and Mobile clients already read `myForm.status` directly from each poll's fresh response body rather than diffing on the ETag — so this does not appear to break current client polling behavior in practice. It is, however, undocumented as an intentional design choice anywhere in the story, and no test in scope currently pins down expected revision behavior across that window. This exact class of gap (`packages/db`'s `learning-path-step-by-step.md` Step 32, key takeaway 6) is called out as a lesson without a corresponding "fixed" entry in the story's own completion notes — worth a deliberate decision (bump revision on every `my_form_status` transition, or explicitly document why not) rather than leaving it implicit.
2. **`WardrobeOnboardingScreen` (mobile) has no injectable poll-offsets prop**, unlike `WardrobeHubScreen`, which is why finding 1 above under Mobile needed a test-level `vi.mock` workaround instead of a component-level prop. For architectural symmetry, a `pollOffsetsMs` prop matching the hub screen's existing pattern would let the test avoid mocking the module directly.
3. **Mobile onboarding's `allGarmentsTagged` gate has no retry/removal affordance for a `failed` garment**, which could permanently block reaching Continue. Web found and explicitly documented the identical gap as a known follow-up; Mobile's dev record does not record an equivalent fix, so this may be a genuine, still-open parity gap between the two clients.

## Best practices found (worth preserving, no action needed)

- **Backend unit:** `wardrobe.bootstrap.spec.ts` already modeled the correct delete-if-undefined env-restore pattern that findings 1-2 above brought the other two files up to. Consistent row-factory pattern with documented invariant-derivation logic. Strong negative-path coverage throughout (precondition races, malformed input, guardian-consent rejection, idempotency replay) — not just happy paths.
- **Backend integration:** extensive, accurate "why" comments explaining non-obvious choices (advisory locks over row locks, `onTestFinished` over trailing statements, why jobs are filtered by id rather than counted by array length). Real dual-connection concurrency testing (`Promise.allSettled` against two independent Prisma clients) rather than sequential simulation of races.
- **DB/RLS:** `withRole`'s "a refused statement aborts its transaction, so it needs its own session" discipline applied correctly and consistently across the whole matrix.
- **Mobile:** unusually thorough inline rationale comments cross-referencing regression IDs to prior bugs; a deliberate `press()` pointer-event dance documented in place to work around a real react-native-web timing quirk; runtime-built fake JWTs (not literals) specifically to avoid tripping gitleaks.

## Verification run (final, aggregate, all real — no assertions taken on faith)

```
npm run lint --workspace api            # clean
npm run typecheck --workspace api       # clean
npm run test --workspace api            # 117 files (1 skipped) / 1271 passed (5 pre-existing skips)

npm run lint --workspace @couture/db    # clean
npm run typecheck --workspace @couture/db  # clean
npm run test --workspace @couture/db    # 8 files / 74 tests, all passed

npm run lint --workspace mobile         # clean
npm run typecheck --workspace mobile    # clean
npm run test --workspace mobile         # 52 files / 463 tests, all passed

# real local PostgreSQL (127.0.0.1:54322) + real local Redis (couturecast-redis)
INTEGRATION_TEST_DATABASE_URL=... npm run test:integration -- \
  integration/wardrobe-onboarding.integration.spec.ts \
  integration/wardrobe-silhouette.integration.spec.ts
                                         # 14 files / 71 passed, 5 pre-existing skips (whole integration/ folder)

# re-verification only, not re-reviewed
npm run test --workspace web             # 30 files / 427 tests, all passed
npm run test --workspace @couture/api-client  # 18 files / 365 tests, all passed
grep -rn "\.only(" pact/ packages/api-client/testing/wardrobe-*.spec.ts  # no matches
```

Blocked: none. All 25 fixes are staged/unstaged in the working tree on `feat/epic4-story4-murat-test-review`, not yet committed at the time this report was generated (committed immediately after, in logical groups, in the same session).

## Next recommended workflow

Coverage-to-AC traceability and the formal PASS/CONCERNS/FAIL/WAIVED quality-gate decision belong to `trace`, not this workflow. The three flagged production-code observations above are worth a deliberate decision before Task 9's verification gate closes this story out.
