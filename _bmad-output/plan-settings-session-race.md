---
title: 'Settings and Home sections follow the verified web session'
type: 'bugfix'
ticket: ''
created: '2026-11-19'
status: 'in-progress'
baseline_revision: '8b0fed06'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On production (8b0fed06), a signed-in member who loads /settings directly sees Shopping and partners say "Sign in to change this", Premium say "You don't have a Premium subscription yet" with a sign-in hint, and Interface palettes say "Sign in and subscribe", even with complimentary Premium. Each section calls `hasWebSession()` once on mount, while web-session.ts has removed the bearer pending verification, and never checks again. The Home palette advisor and planner rail have the same one-shot check; the community grid briefly shows signed-out affordances while verification runs.

**Approach:** One shared session primitive in `apps/web/src/lib/use-web-session.ts` (built on the existing `useWebSession` and `useWebSessionOwner`) that every affected section uses: checking renders the section's loading state, a verified member loads that member's data once, a definitive no-member renders the signed-out state, a verification outage renders a retryable error. Member-owned state is keyed by owner, the way LocationsSection does it. Handlers that re-check the session check the live owner instead of `hasWebSession()`.

## Boundaries & Constraints

**Always:** one shared primitive, no per-section copies of the session logic; exactly one data read per member per load; a signed-in member never sees a sign-in hint or a signed-out locked panel during or after verification; signed-out members keep today's hints and locked panels; an owner change discards the previous member's data, busy state and errors in the same render; the theme section's `<html data-theme>` side effect follows the owner (cleared on signed-out, applied for the verified member); every new string localized in all ten locales.

**Never:** no change to the API contracts, the subscription/checkout/portal flows, the activation poll semantics, or the community feed's own owner reset (`clearScope`); no `hasWebSession()` one-shot checks left in these components.

## I/O & Edge-Case Matrix

| Scenario              | Input / State                                        | Expected Output / Behavior                                            | Error Handling             |
| --------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- | -------------------------- |
| Signed-in direct load | stored session, bearer re-stored after profile check | each section shows its signed-in state; one read each                 | N/A                        |
| Signed-in reload      | same                                                 | same, no sign-in hint at any point                                    | N/A                        |
| Signed out            | no stored session                                    | today's hints and locked panels                                       | N/A                        |
| Verification outage   | profile check 503                                    | section shows its load error with retry; retry recovers with one read | retry re-runs verification |
| Profile denial        | 401/403/404                                          | signed-out state                                                      | N/A                        |
| Member switch         | A then B                                             | B sees only B's data; A's in-flight reads never apply                 | owner check                |

</frozen-after-approval>

## Code Map

- `apps/web/src/lib/use-web-session.ts` -- `useWebSession` (:110, checking/signed_in{owner}/signed_out/unavailable{retry}), `useWebSessionOwner` (:89, useSyncExternalStore), `currentWebSessionOwner` (:67). Add the shared primitive here (for example `useMemberSession()` returning `{ status, owner, retry }` plus a small `MemberScope` keyed wrapper or documented keying pattern).
- Reference implementation: `apps/web/src/app/components/locations/locations-section.tsx` (outer wrapper reads the session, renders `MemberLocationsSection key={owner}`).
- `apps/web/src/app/components/commerce-preferences-section.tsx:55-71,146,210-216` -- mount check; state `enabled,error,confirmation,isSaving`; hint `commerce-signed-out-hint`.
- `apps/web/src/app/components/subscription-section.tsx:301-306,315-445,568-575` -- mount check, `applyFailure` drops to signed_out (keep that only for a definitive denial), activation poll on `?checkout=success`, hint `premium-signed-out-hint`.
- `apps/web/src/app/components/premium-theme-section.tsx:110-124,291-312,341-342,415,559` -- mount check plus `handleSelect` re-check; `applyWebThemeAttribute` side effect; locked `premium-theme-locked`.
- `apps/web/src/app/components/palette-advisor-panel.tsx:125-138,189-205,653-665,674-675,778` -- mount check plus `runWrite` re-check; locked `palette-advisor-locked`.
- `apps/web/src/app/components/planner-rail.tsx:373-389,422-430,440,478-515` -- check inside `load()` (open effect and window focus); locked `planner-rail-locked`.
- `apps/web/src/app/components/community-lookbook-grid.tsx:2016-2034,2434,2634-2698,3675` -- `hasSession` gates canAct, the settings link and canAddLocation; keep `clearScope`; while checking show neither the signed-in nor the signed-out affordance.
- Tests that drive the session with bearers `'test-access-token'`/`'token'` and no env stub will read as signed out under `useWebSession`: `subscription-section.test.tsx` (:59,:101), `subscription-section.complimentary.test.tsx`, `premium-theme-section.test.tsx` (:36), `planner-rail.test.tsx` (:129+), `test-utils/palette-advisor-panel.tsx:67`, `test-utils/community-lookbook-grid.tsx:277`. Migrate them to `vi.stubEnv('NEXT_PUBLIC_E2E_AUTH','true')` plus `test-token-*` bearers (the pattern `app/settings/page.test.tsx:106-110` uses), keeping every assertion.
- Playwright specs that read these states: `commerce-affiliate-preferences.spec.ts:326`, `premium-subscription.spec.ts`, `premium-theme-switcher.spec.ts`, `palette-advisor.spec.ts`, `planner.spec.ts`, `complimentary-access.spec.ts`, `community-real-session*.spec.ts`.
- TEA-owned (do not edit): any new red test files TEA creates for this bug, and `playwright/tests/settings-locations-real-session.spec.ts`, `scripts/e2e-real-session/harness.mjs`.

## Tasks & Acceptance

**Execution:**

- [x] `apps/web/src/lib/use-web-session.ts` -- add the shared member-session primitive and its unit tests.
- [x] Each of the six components -- replace the one-shot check with the primitive; key member-owned state by owner; handler re-checks compare the live owner; outage renders the section's error with retry.
- [x] Existing unit tests -- migrate bearers/env as listed; no assertion removed or loosened.
- [x] i18n -- any new retry/error strings in all ten web locales with parity specs.
- [x] `_bmad-output/project-knowledge/learning-path-step-by-step.md` -- add this fix under Step 58 "Production follow-ups after the project close" with test cross-links.

Working rules: never git stash, git checkout -- or git reset; never touch /Users/murat/opensource/cc/couture-cast; load the bmad-tea skill before editing any test; never run npx playwright without an isolated DATABASE_URL and PLAYWRIGHT_SKIP_DB_RESET=true; in apps/api run only `vitest run src` or named spec paths; run tsc via `npm exec` per workspace; do not commit or git add (the builder commits; TEA commits in the same worktree).

**Acceptance Criteria:**

- Given a signed-in member with complimentary Premium, when they load /settings directly or reload it, then Shopping shows the enabled toggle without a sign-in hint, Premium shows complimentary access, and Interface palettes shows the palette choices.
- Given the Home page for a signed-in Premium member, when it loads directly, then the palette advisor and planner rail show the member's content, never the locked signed-out panels.

## Implementation Notes

- Primitive: `MemberScope` (render prop, keyed by `useWebSessionOwner()`), `useMemberSession()`,
  `memberSessionOf()`, `isLiveOwner()` in `apps/web/src/lib/use-web-session.ts`. Locations now
  uses it too, so no section keeps its own follower.
- Commerce, Premium, Interface palettes and the palette advisor render a keyed inner component;
  the planner rail keeps its chrome (focus trap, scroll lock, `aria-busy`) outside the key and
  keys only the week (`PlannerWeek`, mounted while open). The community grid derives its
  affordances from `useMemberSession().status` and keeps `clearScope`.
- Outage retry: one shared `SessionRetryButton` (`session.retry`, new `session` namespace in all
  ten locales, `session-locales.spec.ts`); the planner reuses its own error panel and retry.
- The theme section clears `<html data-theme>` in a layout effect on every live-owner change.
- Premium hides its status line while `checking` (it read "You don't have a Premium subscription
  yet" during verification); `loading` keeps today's line because
  `subscription-section.complimentary.test.tsx` W-DISCLOSURE-HIDDEN pins it.
- Test migration: `src/test-utils/member-session.ts` (`signInFixtureMember`: env stub plus a
  `test-token-access` bearer, unstubbed by `onTestFinished`).

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**

- `cd apps/web && npx tsc --noEmit -p tsconfig.json` -- expected: no errors.
- `cd apps/web && npx vitest run` -- expected: all pass, TEA's new red files included.
- Real-session lane for TEA's settings reload spec (isolated DB, PLAYWRIGHT_SKIP_DB_RESET=true) -- expected: green.

**Results (2026-11-19, builder):**

- `npm exec -- tsc --noEmit -p tsconfig.json` in apps/web: clean; eslint and prettier on every
  changed file: clean.
- `npm exec -- vitest run` in apps/web: 148 files, 2307 tests passed, TEA's five red files
  included (SUBSCRIPTION-SESSION-WEB-04/05 as TEA revised them).
- Real-session lane, full (`scripts/e2e-real-session/run.mjs`, own database, REDIS 6390,
  PLAYWRIGHT_SKIP_DB_RESET=true): 50 passed, none skipped, PS-1, PS-2 and PL-1..3 included.
- Local lane on a runner-owned database (temporary runner, removed): commerce affiliate
  preferences, premium subscription, premium theme switcher, palette advisor and planner specs,
  31 passed. Complimentary lane (`scripts/e2e-complimentary/run.mjs`): 5 passed.
