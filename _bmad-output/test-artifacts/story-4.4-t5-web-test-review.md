---
stepsCompleted:
  [
    'step-01-load-context',
    'step-02-discover-tests',
    'step-03-quality-evaluation',
    'step-04-generate-report',
  ]
lastStep: 'step-04-generate-report'
lastSaved: '2026-08-09'
inputDocuments:
  - '_bmad-output/implementation-artifacts/4-4-wardrobe-onboarding-silhouette-setup.md'
  - 'resources/knowledge/test-quality.md'
  - 'resources/knowledge/data-factories.md'
  - 'resources/knowledge/test-levels-framework.md'
  - 'resources/knowledge/selective-testing.md'
  - 'resources/knowledge/test-healing-patterns.md'
  - 'resources/knowledge/selector-resilience.md'
  - 'resources/knowledge/timing-debugging.md'
  - 'resources/knowledge/fixture-architecture.md'
  - 'resources/knowledge/network-first.md'
  - 'resources/knowledge/playwright-config.md'
  - 'resources/knowledge/component-tdd.md'
  - 'resources/knowledge/ci-burn-in.md'
---

# Test Review — Story 4.4 Task 5 (Web wardrobe onboarding & silhouette)

**Reviewer:** Murat, Master Test Architect
**Branch:** `feat/epic4-story4-t5-web`
**Scope:** `single`/`directory` (5 named files, Task 5's web test surface)
**Execution mode:** sequential (dimensions evaluated directly against a 5-file, well-understood scope — the risk/value math didn't justify spinning up 4 parallel subagents to re-derive context I already had)

Files in scope:

- `apps/web/src/lib/wardrobe.test.ts`
- `apps/web/src/app/components/silhouette-settings-panel.test.tsx`
- `apps/web/src/app/wardrobe/onboarding/page.test.tsx`
- `apps/web/src/app/wardrobe/page.test.tsx`
- `apps/web/src/i18n/wardrobe-onboarding-locales.spec.ts`

> **Coverage boundary:** this workflow does not score requirement-to-test coverage — that's `trace`'s job. As a value-add (asked for explicitly), the story's Task 5 matrix is cross-checked in a separate section below, clearly marked as outside this workflow's formal scope.

---

## Score Summary

| Dimension              | Score      | Notes                                                                                      |
| ---------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| Determinism            | 90/100     | No hard waits anywhere; two tests depended on real timers before this review               |
| Isolation              | 88/100     | One global-state leak (`navigator.mediaDevices`) before this review                        |
| Maintainability        | 90/100     | Good selector hierarchy and factories; some duplicated action sequences before this review |
| Performance            | 98/100     | 138 tests / 25 files in ~3s; no individual test near the 1.5min budget                     |
| **Overall (weighted)** | **91/100** | All findings below were fixed during this review, not just reported                        |

---

## Critical Findings — Fixed

### 1. `navigator.mediaDevices` leaked across tests (Isolation)

**File:** `apps/web/src/app/wardrobe/onboarding/page.test.tsx`

Two tests (`grants camera permission...`, `denies camera permission...`) redefined `navigator.mediaDevices` with `Object.defineProperty` but never restored the original descriptor. The exact same problem was already solved once in this codebase — `garment-capture-modal.test.tsx`'s `installCameraMock()` captures the original descriptor and restores it via a `globalRestorers` array in `afterEach`. The onboarding test didn't reuse that proven pattern; it just clobbered the global.

Vitest's default per-file module isolation makes this unlikely to bleed into _other_ test files today, but it's a latent isolation bug: any future change to test pooling/parallelism config, or a second `it()` in the same file relying on the original `navigator.mediaDevices`, would silently inherit the wrong value.

**Fix applied:** Added `installMediaDevicesMock()` mirroring `installCameraMock()` exactly (capture descriptor → set mock → push a restorer that reinstates or deletes), wired through the same `globalRestorers` + `afterEach` convention. Both tests now use it.

### 2. Two tests depended on real timers instead of fake/injectable ones (Determinism)

**Files:** `apps/web/src/app/components/silhouette-settings-panel.test.tsx`, `silhouette-settings-panel.tsx`

The slider auto-save test waited out the component's real 400ms debounce window via `waitFor` (RTL's default `waitFor` timeout is 1000ms, leaving only a 600ms margin — fine today, but a source of latent CI-timing flakiness as the suite grows or CI load increases). A stray `vi.useRealTimers()` in `afterEach` hinted fake timers were intended but never wired up.

I considered `vi.useFakeTimers()` directly, but mixing fake timers with `@testing-library/user-event`'s internal async scheduling is a known source of _new_ flakiness, and the fix-the-cause option was cleaner: the component already had exactly this pattern for its My Form poll cadence (`pollIntervalsMs`, injectable, defaults to the real `[1000, 2000, 4000, 8000]`).

**Fix applied:** Added a matching `sliderSaveDebounceMs` prop to `SilhouetteSettingsPanel` (default: the real 400ms), threaded into `scheduleSliderSave`. The test now passes `sliderSaveDebounceMs: 5`, making the auto-save assertion near-instant and removing the real-clock dependency entirely — no fake-timer/user-event interaction risk introduced. Removed the dead `vi.useRealTimers()`.

### 3. Repeated 3–5 line action sequences not extracted (Maintainability)

**Files:** `silhouette-settings-panel.test.tsx`, `apps/web/src/app/wardrobe/onboarding/page.test.tsx`

Per this project's own fixture-extraction rule (3+ uses → extract), two sequences crossed the threshold without being extracted:

- "confirm the basewear checkbox → click Upload → select a file" appeared in 3 non-parametrized tests in `silhouette-settings-panel.test.tsx` (the `it.each` failure-reason tests already shared code via the loop).
- "click Add another garment → upload a file → click Use This Image" appeared 3 times in `onboarding/page.test.tsx`.

**Fix applied:** Extracted `confirmAndStartMyFormUpload(user)` and `captureAndCommitGarment(user)` respectively; all affected tests now call the helper. No behavior changed — same actions, same assertions, less duplication.

---

## Warnings / Non-Blocking Observations

- **Focus trap depth.** The two focus-restoration tests (capture modal in `onboarding/page.test.tsx`, silhouette modal in `wardrobe/page.test.tsx`) verify focus _returns to the invoker on close_, but neither exercises Tab-cycling _within_ the open dialog (a true trap test). That's intentional, not a gap: `AccessibleModal`'s Tab-wrapping behavior is already covered by Story 4.1/4.3's own component suites, and re-proving it here would be exactly the "duplicate coverage across levels" anti-pattern `test-levels-framework.md` warns against. Flagging for visibility, not action.
- **Live-region wiring isn't asserted directly for every message.** Tests confirm the user-facing _content_ of live announcements (e.g., `screen.getByText('Picking up where you left off')`), which is the behavior that matters, but don't separately assert `role="status"`/`aria-live` attributes on every message element. The component code has the right roles; this is a coverage style choice, not a defect.
- **`silhouette-settings-panel.test.tsx`'s poll test** still uses a small real interval (`pollIntervalsMs: [5, 5]`) rather than the debounce-style prop fix applied above. At 5ms this adds negligible wall-clock time and hasn't shown flakiness; left as-is rather than over-engineering a second injectable-timing mechanism for a already-low-risk case.

---

## Story 4.4 Task 5 Test-Matrix Cross-Check (value-add, outside `test-review`'s formal scope)

| Required state                                                | Covered | Where                                                                                     |
| ------------------------------------------------------------- | :-----: | ----------------------------------------------------------------------------------------- |
| Permission grant/deny                                         |   ✅    | `onboarding/page.test.tsx`                                                                |
| Capture-loop checklist                                        |   ✅    | `onboarding/page.test.tsx`                                                                |
| Starter-wardrobe skip                                         |   ✅    | `onboarding/page.test.tsx`                                                                |
| Slider persistence                                            |   ✅    | `silhouette-settings-panel.test.tsx`                                                      |
| My Form upload through `ready` / each `failed` reason + retry |   ✅    | `silhouette-settings-panel.test.tsx` (poll-to-ready test + `it.each` over all 4 reasons)  |
| Guardian-consent rejection for a teen actor                   |   ✅    | Both `silhouette-settings-panel.test.tsx` _and_ `onboarding/page.test.tsx` (capture step) |
| Focus trap and restoration                                    |   ✅    | `onboarding/page.test.tsx` (capture modal), `wardrobe/page.test.tsx` (silhouette modal)   |
| Live announcements                                            |   ✅    | `onboarding/page.test.tsx` (`resumed` live region)                                        |
| Resume-after-reload                                           |   ✅    | `onboarding/page.test.tsx`                                                                |

Every required state from the story's Task 5 subtask has real coverage. No gaps found.

---

## Verification After Fixes

```
npm run test --workspace web       # 25 files, 138 tests, all passing
npm run lint --workspace web       # clean
npm run typecheck --workspace web  # clean
```

No `.only`, no skipped tests, no hard waits (`waitForTimeout`/raw `sleep`) anywhere in scope.

## Next Recommended Workflow

Coverage-to-AC traceability and the formal quality gate decision belong to `trace` (Phase 1 + Phase 2), not this workflow — recommend running that next if a formal PASS/CONCERNS/FAIL/WAIVED gate is needed before this story's Task 5 branch merges.
