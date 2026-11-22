---
title: 'CC-7.1: Shared save, undo and status feedback'
type: feature
ticket: '7.1'
created: '2026-11-21'
status: done
baseline_revision: 'abce398ba1f3d0028445ca75fd7b085116525664'
route: full
route_source: auto
risk: medium
review: quick
review_source: pinned
lenses_ran: [quick]
review_loop_iteration: 0
followup_review_recommended: false
context:
  - /Users/murat/opensource/cc/couture-cast-epic7/AGENTS.md
  - /Users/murat/opensource/cc/couture-cast-epic7/.agents/skills/bmod-tea/knowledge/playwright-utils-mandate.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Saving, removing, swapping, and shuffling looks on web and mobile give inconsistent or invisible feedback (web Style this piece only announces saved text in an `sr-only` element, Home sample bookmarks have no saving/failed/undo bar, and there is no shared offline line or single-announcement status bar). Members cannot trust whether an action succeeded, failed, or can be undone.

**Approach:** Build a shared, deterministic save-and-status feedback state machine in `@couture/utils` and one shared UI component set on web and native (`SaveActionButton`, `StatusFeedbackBar`, `OfflineStatusLine`, and `SaveFeedbackProvider`) with localized copy across all 10 locales, then wire it into Style this piece and Home sample outfit save/unsave/swap/shuffle flows on both platforms.

## Boundaries & Constraints

**Always:**

- Work exclusively inside `/Users/murat/opensource/cc/couture-cast-epic7` (never touch the main checkout `/Users/murat/opensource/cc/couture-cast`).
- Provide all required states on one shared component per platform: `idle` (`Save`), `saving` (within 100 ms), `still-saving` (`Still saving` after 1,000 ms), `saved` (`Saved` with check icon, only after the async action commits), `failed` (`Failed` with `"Could not save. Try again."` and `Retry`), and `offline` (`"You are offline"` / `"You are offline. Save when you reconnect."` keeping content on screen).
- Display the bottom status bar for 5,000 ms with at most 2 actions (`View`, `Undo`, `Retry`), positioned so it never covers the bottom tab bar or the screen's primary button.
- Render one single `"You are offline"` line under the top bar while offline, disappearing when connectivity returns.
- Support Undo for save, unsave/remove, and swap or shuffle on an unsaved look.
- Announce each state change once to screen readers (no duplicate announcements between button and status bar); respect reduced motion (`<= 200 ms`, instant under reduced motion), 44x44 px/pt touch targets, WCAG AA contrast (4.5:1 text, 3:1 icons) in light and dark, and all 10 locales (`en-US`, `en-CA`, `de-DE`, `es-419`, `fr-CA`, `fr-FR`, `it-IT`, `pt-BR`, `pt-PT`, `tr-TR`) with English reading level <= US grade 6 and button labels <= 3 words.
- Preserve existing Style this piece local persistence and Home sample bookmark behavior (account persistence moves in CC-7.2) so existing tests stay green without loosening assertions.
- Follow TEA rules (`@seontechnologies/playwright-utils` merged fixtures for any Playwright specs) and rebuild `@couture/utils` before web/mobile typecheck and tests.

**Never:**

- Never show `Saved` optimistically before the save promise resolves.
- Never drop or clear on-screen look content on save failure or offline tap.
- Never allow stale or superseded async completions to overwrite a newer save state or another member's session.
- Never add new native Expo modules that require native prebuild changes (`@react-native-community/netinfo`, `expo-network`, etc.).
- Never cover the bottom tab bar (`StickyBottomNav` / native `Tabs`) or any primary action button with the bottom status bar.

## I/O & Edge-Case Matrix

| Scenario                  | Input / State                                             | Expected Output / Behavior                                                                                                                                                         | Error Handling                                       |
| ------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Fast commit               | Online; `onSave` resolves in 50 ms                        | State transitions synchronously (<100 ms) `idle -> saving -> saved`; button shows check + `Saved`; bottom bar shows 5 s with `View`/`Undo` (<=2 actions); announced once           | None                                                 |
| Slow commit               | Online; `onSave` pending >1,000 ms then resolves          | Transitions `idle -> saving` immediately, `-> still-saving` (`"Still saving"`) at 1,000 ms, then `-> saved` on resolve; each transition announced once                             | None                                                 |
| Failed save & retry       | Online; `onSave` rejects or returns `false`               | Keeps look content on screen; button enters `failed`; bottom bar shows `"Could not save. Try again."` + `Retry` for 5 s; tapping `Retry` or button re-runs `onSave`                | Rejects cleanly; no unhandled rejection              |
| Offline network action    | `online === false`; tap `Save` with `requiresNetwork`     | Does not invoke `onSave`; keeps content on screen; bottom bar shows `"You are offline. Save when you reconnect."`; one `"You are offline"` line sits under top bar until reconnect | No network call thrown                               |
| Reconnect                 | Offline -> `online` event / network restored              | Offline line under top bar disappears; next `Save` runs normally                                                                                                                   | None                                                 |
| Undo save                 | State `saved`; tap `Undo` in bottom bar                   | Runs `onUndo()`, restores button to `idle` (`Save`), removes saved look, announces undo once                                                                                       | If undo fails, shows failure status without crashing |
| Undo unsave               | Member removes a saved look                               | Bottom bar shows `"Removed"` + `Undo` for 5 s; tapping `Undo` restores the saved look                                                                                              | None                                                 |
| Undo swap / shuffle       | Member swaps a piece or shuffles an unsaved look          | Bottom bar shows update message + `Undo` for 5 s; tapping `Undo` restores prior unsaved look snapshot                                                                              | Stack bounded; cleared on save or weather reset      |
| Action clamping           | Caller passes 3 actions to bottom bar                     | Bar renders at most 2 actions in order                                                                                                                                             | Excess actions truncated safely                      |
| Stale run / owner switch  | Slow save from run 1 resolves after reset or run 2 starts | Run 1 completion ignored; run 2 / current state preserved                                                                                                                          | Timers cleared on reset/unmount                      |
| Non-overlapping placement | Status bar visible on 390x844 phone web or native         | Status bar rect does not intersect `StickyBottomNav` or primary button rect; clears modal footer cleanly                                                                           | Shifts above tab bar / avoids primary button rect    |

</intent-contract>

## Code Map

- `packages/utils/src/save-feedback/index.ts` (new) -- Shared pure state machine (`SaveFeedbackState`, `SAVE_FEEDBACK_TIMINGS`, `MAX_STATUS_BAR_ACTIONS`, `StatusBarAction`, `StatusBarNotice`, `SaveFeedbackSnapshot`, reducer transitions, `clampStatusBarActions`, `createAnnouncementToken`, `pushLookUndoSnapshot`, `popLookUndoSnapshot`, `isOfflineError`).
- `packages/utils/src/save-feedback/save-feedback.test.ts` (new) -- Unit tests covering every pure state transition, timing constant, action clamping, announcement deduplication, undo stack, and offline error classification.
- `packages/utils/src/index.ts` -- Re-export `./save-feedback`.
- `apps/web/src/i18n/locales/*.json` (all 10 locales) & `apps/mobile/assets/locales/*.json` (all 10 locales) -- Add `feedback` namespace (`save`, `saving`, `stillSaving`, `saved`, `failed`, `retry`, `undo`, `view`, `dismiss`, `savedToLooks`, `saveFailed`, `offlineBanner`, `offlineAction`, `removed`, `undone`, `lookUpdated`, `pieceSwapped`, `close`).
- `apps/web/src/i18n/save-feedback-locales.spec.ts` (new) & `apps/mobile/src/i18n/save-feedback-locales.spec.ts` (new) -- Parity tests across all 10 locales, non-English translation checks, <=3-word English button labels.
- `apps/web/src/app/components/save-feedback/` (new):
  - `save-feedback-context.tsx` -- `SaveFeedbackProvider`, `useStatusBar`, `useOnlineStatus`, single polite/assertive visually-hidden live announcer (deduplicated per announcement id so each state is announced once), `OfflineStatusLine` (`data-testid="offline-status-line"`), and `StatusFeedbackBar` (`data-testid="status-feedback-bar"`) with non-overlap geometry against `[data-testid="sticky-bottom-nav"]` and `[data-primary-action="true"]`.
  - `save-action-button.tsx` -- Shared `SaveActionButton` + `useSaveAction` hook implementing `idle`, `saving`, `still-saving`, `saved`, `failed`, `offline` with 1,000 ms slow-commit timer, 5,000 ms bar auto-dismiss, stale-run epoch guard, standalone fallback when outside provider, 44x44 touch target, WCAG AA light/dark tokens, and `motion-reduce:transition-none` (<=150 ms transition).
  - `save-feedback.test.tsx` -- Vitest tests covering all I/O matrix rows on web, single screen-reader announcement per transition, timer cleanup, standalone & provider modes, and non-overlap geometry.
- `apps/web/src/app/layout.tsx` -- Wrap `{children}` in `SaveFeedbackProvider` so every page has the global `OfflineStatusLine` (one line under top bar) and `StatusFeedbackBar`.
- `apps/web/src/app/wardrobe/style-piece-panel.tsx` -- Wire `SaveActionButton`, `StatusFeedbackBar` (inline/modal-safe placement), and Undo for save, remove, and companion swap; preserve `data-testid="style-piece-save"` and idle label `labels.save` (`"Save look"`).
- `apps/web/src/app/components/home-ritual.tsx` & `apps/web/src/app/components/guest-preview/sample-idea-controls.tsx` -- Wire `SaveActionButton` (`data-testid="sample-save-look"`) and Undo status bar for save, remove, swap, and shuffle (`onTryAnother`).
- `apps/mobile/components/save-feedback/` (new):
  - `network-status.ts` -- Pure JS reactive online/offline store (`getNetworkOnline`, `subscribeNetworkStatus`, `reportNetworkOffline`, `reportNetworkOnline`, `useNetworkOnline`) listening to `window` online/offline when present and `AppState` foreground recovery on native, with zero new native modules.
  - `save-feedback-context.tsx` -- `SaveFeedbackProvider`, `useStatusBar`, `OfflineStatusLine` (`testID="offline-status-line"`), `StatusFeedbackBar` (`testID="status-feedback-bar"`, positioned above tab bar + safe area with `pointerEvents="box-none"`), announcing each state once via `useAccessibilityAnnouncer` (`accessibilityLiveRegion="none"` on visual bar to prevent double readouts), respecting `useReducedMotion()`.
  - `save-action-button.tsx` -- Shared `SaveActionButton` + `useSaveAction` hook mirroring web states, check/warning icons, 44pt min touch targets, light/dark contrast via `useHeroPalette`/`useSchemeColors`.
  - `save-feedback.test.tsx` -- Vitest tests covering all I/O matrix rows on mobile, single announcement verification via `useAccessibilityAnnouncer`, reduced-motion behavior, and offline line lifecycle.
- `apps/mobile/app/_layout.tsx` -- Mount `SaveFeedbackProvider` inside `AppThemeProvider`/`ThemeProvider` (keeping `root-layout-startup.test.tsx` green).
- `apps/mobile/src/features/wardrobe/style-piece-panel.tsx` -- Wire `SaveActionButton`, modal-safe `StatusFeedbackBar`, and Undo for save, remove, and swap.
- `apps/mobile/src/features/preview/member-sample-outfit.tsx` & `apps/mobile/src/features/preview/sample-idea-controls.tsx` -- Wire `SaveActionButton` and Undo status bar for save, remove, swap, and shuffle (`onTryAnother`).

## Tasks & Acceptance

**Execution:**

- [x] `packages/utils/src/save-feedback/index.ts` & `packages/utils/src/index.ts` -- Create shared save/undo/status-bar pure state machine and helpers and export from `@couture/utils` -- Single source of truth for state transitions, timings (1,000 ms still-saving, 5,000 ms bar, max 2 actions), undo stack, and single-announcement token generation across web and native.
- [x] `packages/utils/src/save-feedback/save-feedback.test.ts` -- Unit-test all pure transitions and edge cases from the I/O matrix -- Proves shared core logic before UI integration.
- [x] `apps/web/src/i18n/locales/*.json`, `apps/mobile/assets/locales/*.json`, and both `save-feedback-locales.spec.ts` files -- Add localized `feedback` strings to all 10 locales on web and mobile plus parity tests -- Meets Epic 7 localization, reading level (<= grade 6), and <=3-word button rules.
- [x] `apps/web/src/app/components/save-feedback/save-feedback-context.tsx`, `save-action-button.tsx`, `index.ts` & `apps/web/src/app/layout.tsx` -- Build web shared `SaveActionButton`, `StatusFeedbackBar`, `OfflineStatusLine`, `SaveFeedbackProvider` and mount in root layout -- Delivers web shared feedback UI with non-overlapping placement and single screen-reader announcement.
- [x] `apps/web/src/app/wardrobe/style-piece-panel.tsx`, `apps/web/src/app/components/home-ritual.tsx`, `apps/web/src/app/components/guest-preview/sample-idea-controls.tsx` -- Wire `SaveActionButton` and Undo status bar into save, remove, swap, and shuffle flows -- Proves shared component in real web member surfaces without breaking existing contracts.
- [x] `apps/web/src/app/components/save-feedback/save-feedback.test.tsx` -- Add comprehensive web Vitest suite covering every I/O matrix scenario, single SR announcement, undo save/unsave/swap/shuffle, offline line, and non-overlap geometry -- Verifies web ACs deterministically.
- [x] `apps/mobile/components/save-feedback/network-status.ts`, `save-feedback-context.tsx`, `save-action-button.tsx`, `index.ts` & `apps/mobile/app/_layout.tsx` -- Build native shared `SaveActionButton`, `StatusFeedbackBar`, `OfflineStatusLine`, `SaveFeedbackProvider` and mount in root layout -- Delivers native parity with `useAccessibilityAnnouncer` and `useReducedMotion`.
- [x] `apps/mobile/src/features/wardrobe/style-piece-panel.tsx`, `apps/mobile/src/features/preview/member-sample-outfit.tsx`, `apps/mobile/src/features/preview/sample-idea-controls.tsx` -- Wire `SaveActionButton` and Undo status bar into native save, remove, swap, and shuffle flows -- Proves shared component in real native member surfaces.
- [x] `apps/mobile/components/save-feedback/save-feedback.test.tsx` -- Add comprehensive mobile Vitest suite covering every I/O matrix scenario, single announcement, reduced motion, and offline line -- Verifies native ACs deterministically.

**Acceptance Criteria:**

- Given a member taps Save on web or native while online, when the request starts, then the control shows `Saving` within 100 ms, shows `Still saving` if uncommitted after 1,000 ms, and shows `Saved` with a check plus a 5-second bottom status bar (with up to 2 actions from `View`, `Undo`, `Retry`) only after the promise commits.
- Given a save fails on web or native, when the promise rejects or returns false, then on-screen look content remains intact, the control shows `Failed`, and the bottom status bar shows `"Could not save. Try again."` with `Retry` that re-invokes the save.
- Given the device is offline on web or native, when offline state is active, then one `"You are offline"` line sits under the top bar until connectivity returns, and tapping a network save action shows `"You are offline. Save when you reconnect."` without calling the network or losing content.
- Given a member saves, unsaves/removes, or swaps/shuffles an unsaved look on web or native, when the action completes, then `Undo` in the bottom status bar reverses that action and restores the prior state.
- Given any save, slow-save, saved, failed, offline, or undo transition on web or native, when screen reader announcements are inspected and layout rects are measured at 390x844 (web) or mobile safe-area bounds (native), then each state is announced exactly once and the bottom status bar never overlaps the tab bar or primary button.

## Implementation Notes

- Built shared pure state machine and helpers in `packages/utils/src/save-feedback/index.ts` and exported from `@couture/utils`.
- Added localized `feedback` namespace (18 keys) across all 10 locales on both web and mobile with parity specs.
- Implemented web `SaveFeedbackProvider`, `StatusFeedbackBar` (with non-overlap geometry against `StickyBottomNav` and `[data-primary-action="true"]`, plus `inline` modal mode), `OfflineStatusLine`, `SaveActionButton`, and `useSaveAction`; mounted in `apps/web/src/app/layout.tsx` and wired into `StylePiecePanel`, `HomeRitual`, and `SampleIdeaControls`.
- Implemented mobile `network-status.ts` (zero native modules), `SaveFeedbackProvider`, `StatusFeedbackBar` (safe-area + tab-bar clearance, `useReducedMotion`, `accessibilityLiveRegion="none"`, single announcement via `useAccessibilityAnnouncer`), `OfflineStatusLine`, `SaveActionButton`, and `useSaveAction`; mounted in `apps/mobile/app/_layout.tsx` and wired into `StylePiecePanel`, `MemberSampleOutfit`, and `SampleIdeaControls`.
- Ran `npm run db:generate && npm run build:packages` in the fresh worktree so `@couture/testing` and `@couture/api-client` builds were current for typecheck and mobile Vitest.

## Plan Change Log

## Review Triage Log

### 2026-11-21 — Review pass

- verdicts: 11 findings — high 6, medium 5, low 0, false 0, maybe-false 0
- findings:
  - `[high]` `[patch]` Web inline modal `SaveFeedbackProvider` forwarded announcements to the inert root announcer under `AccessibleModal` — inline providers now mount their own keyed `data-testid="save-feedback-announcer"` live region and announce locally.
  - `[high]` `[patch]` Mobile native offline state deadlocked once `reportNetworkOffline()` ran because `navigator.onLine` is absent on iOS/Android — added abortable connectivity probe on `AppState` active / offline interval and explicit action re-check in `network-status.ts` and `save-action-button.tsx`.
  - `[high]` `[patch]` `StylePieceCard` omitted `requiresNetwork` even though `updateSaved` calls `inventory.refresh()` — passed `requiresNetwork` on web and mobile `StylePieceCard` and guarded `onRemove` when offline so looks stay on screen.
  - `[high]` `[patch]` `OfflineStatusLine` rendered above `<header>` on web and above native safe-area/header outside `underModalAccessibility` on mobile — moved mobile `SaveFeedbackProvider` inside `underModalAccessibility(modalOpen)` with `insets.top + headerOffset`, and measured visible `<header>`/`[role="banner"]` bottom offset on web.
  - `[high]` `[patch]` No production web button carried `data-primary-action="true"` and mobile used hardcoded `72` tab-bar clearance — added `data-primary-action="true"` to Home primary actions and published dynamic `56 + growth` tab-bar height + primary action clearance to mobile `StatusFeedbackBar`.
  - `[high]` `[patch]` `useSaveAction` left notices active on unmount/`ownerKey`/`resetKey` change and did not guard Undo/Retry callbacks — dismissed `activeNoticeIdRef` on unmount and key changes, and gated Undo/Retry/View callbacks on mounted + matching origin owner/reset keys.
  - `[medium]` `[patch]` `SampleIdeaControls` double-announced saved headers and mobile's `useAccessibilityAnnouncer` 80 ms debounce dropped fast-commit `Saving` and repeated shuffles — silenced secondary live regions (`aria-live="off"` web / `accessibilityLiveRegion="none"` mobile) and switched mobile feedback to immediate per-`announcementId` dispatch.
  - `[medium]` `[patch]` Undo Save deleted pre-existing saved looks on update and mobile sample-remove Undo used a stale `bookmarks` closure — captured prior entry/index before save and synced `bookmarksRef` on mobile.
  - `[medium]` `[patch]` `SaveActionButton` stayed in `saved` state after sample garment swap or saved-look removal — included garment signature and removal revision in `resetKey`.
  - `[medium]` `[patch]` Mobile `MemberSampleOutfit.updateBookmarks` mutated React state before storage write — validated writer and completed storage write before updating state on Save/Undo.
  - `[medium]` `[patch]` No-op sample shuffle pushed undo entries, `StylePieceIdeas.openSaved` kept stale swap undo stack/notice, and `onRemove` Undo ignored `false` returns — guarded no-op shuffle, cleared undo stack/notice in `openSaved`, and surfaced failure notice on failed Remove Undo.

### 2026-11-21 — Codex peer review pass (`story-7-1-codex-review.md`)

- verdicts: 13 findings — high 3, medium 8, low 2, security 0
- resolution: All 13 findings fixed in this branch with focused regression tests (`@couture/utils` 13/13, web 110/110, mobile 97/97) and zero loosened existing assertions.

## Auto Run Result

- **Summary:** Implemented Story CC-7.1 shared save, undo, offline, and status feedback across `@couture/utils`, `apps/web`, `apps/mobile`, and all 10 locales, wired into Style this piece and Home sample outfit flows on both platforms.
- **Files changed:**
  - `packages/utils/src/save-feedback/index.ts`, `save-feedback.test.ts`, `packages/utils/src/index.ts` — shared state machine, timing constants, undo stack, offline classifier, unit tests.
  - `apps/web/src/i18n/locales/*.json` (10 files), `apps/web/src/i18n/save-feedback-locales.spec.ts` — web localized `feedback` strings and parity tests.
  - `apps/mobile/assets/locales/*.json` (10 files), `apps/mobile/src/i18n/save-feedback-locales.spec.ts` — mobile localized `feedback` strings and parity tests.
  - `apps/web/src/app/components/save-feedback/*`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/wardrobe/style-piece-panel.tsx`, `apps/web/src/app/components/home-ritual.tsx`, `apps/web/src/app/components/guest-preview/guest-preview-outfit.tsx`, `sample-idea-controls.tsx` — web shared components, root provider, and look flow integrations.
  - `apps/mobile/components/save-feedback/*`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app/(tabs)/_layout.tsx`, `apps/mobile/src/features/wardrobe/style-piece-panel.tsx`, `apps/mobile/src/features/preview/member-sample-outfit.tsx`, `sample-idea-controls.tsx` — mobile shared components, root provider, dynamic tab-bar clearance, and look flow integrations.
- **Review findings breakdown:** 11 findings from Quick review lens (6 high, 5 medium); all 11 patched and verified; 0 deferred, 0 rejected.
- **Follow-up review recommendation:** `true` (6 high, 5 medium patched in pass 1; Codex correctness + security review follows before PR merge; residual risk is real-device VoiceOver/TalkBack announcement cadence and iOS/Android safe-area visual verification).
- **Verification performed:** `@couture/utils` build + 10/10 tests; web Vitest targeted suites (84/84); mobile Vitest targeted suites (92/92); `tsc --noEmit` in `@couture/utils`, `web`, and `mobile`; `eslint --max-warnings=0` on all touched files.
- **Residual risks:** Real-device VoiceOver/TalkBack announcement cadence and physical-device iOS/Android safe-area visual alignment await device/CI lanes; full account-backed persistence for saved looks ships in CC-7.2.

## Design Notes

- **Single announcement guarantee**: On web, `SaveActionButton` uses `aria-busy` on `saving`/`still-saving` without `aria-live`, and `StatusFeedbackBar` renders visual text without `role="status"`/`aria-live` inside the visible bar; instead, `SaveFeedbackProvider` (or the standalone fallback in `SaveActionButton`) maintains ONE dedicated `sr-only` live region that writes each transition's announcement token once per unique `announcementId`. On mobile, `StatusFeedbackBar` sets `accessibilityLiveRegion="none"` and dispatches each state once through `useAccessibilityAnnouncer().announce(...)`.
- **Non-overlap geometry on web**: `StatusFeedbackBar` anchors above `StickyBottomNav` (`bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]` on `<768px`, `bottom-4` on `>=768px`, `z-40`) and checks any visible `[data-primary-action="true"]` element in `useLayoutEffect`; if the bar's rect would intersect a primary button, it shifts `bottom` above that button (or docks cleanly inside a modal's bottom footer via `placement="inline"` inside `AccessibleModal`).
- **Existing test compatibility**: `StylePiecePanel` keeps `data-testid="style-piece-save"` and `idleLabel={labels.save}` (`"Save look"`), and `SampleIdeaControls` keeps `data-testid="sample-save-look"` and existing idle labels so existing tests pass untouched while gaining the shared CC-7.1 states and Undo bar. Note that in `StylePiecePanel` today, `updateSaved` refreshes inventory via API before writing localStorage; while `updateSaved` is pending, the button enters `saving`, and only after it returns `true` does it enter `saved`.

## Verification

**Commands:**

- `cd /Users/murat/opensource/cc/couture-cast-epic7 && npm run build --workspace @couture/utils` -- expected: exits 0
- `cd /Users/murat/opensource/cc/couture-cast-epic7 && npm run test --workspace @couture/utils -- src/save-feedback/save-feedback.test.ts` -- expected: all tests pass
- `cd /Users/murat/opensource/cc/couture-cast-epic7 && npx vitest run --config apps/web/vitest.config.ts apps/web/src/app/components/save-feedback/save-feedback.test.tsx apps/web/src/i18n/save-feedback-locales.spec.ts apps/web/src/app/wardrobe/page.styling.test.tsx apps/web/src/app/components/home-ritual.test.tsx` -- expected: all tests pass
- `cd /Users/murat/opensource/cc/couture-cast-epic7 && npm run vitest:run --workspace mobile -- components/save-feedback/save-feedback.test.tsx src/i18n/save-feedback-locales.spec.ts src/screens/root-layout-startup.test.tsx src/features/wardrobe/wardrobe-hub-screen.test.tsx src/screens/hero-identity-cache.test.tsx` -- expected: all tests pass
- `cd /Users/murat/opensource/cc/couture-cast-epic7 && npm run typecheck --workspace @couture/utils && npm run typecheck --workspace web && npm run typecheck --workspace mobile` -- expected: exits 0
- `cd /Users/murat/opensource/cc/couture-cast-epic7 && npx eslint --max-warnings=0 packages/utils/src/save-feedback packages/utils/src/index.ts apps/web/src/app/components/save-feedback apps/web/src/app/layout.tsx apps/web/src/app/wardrobe/style-piece-panel.tsx apps/web/src/app/components/home-ritual.tsx apps/web/src/app/components/guest-preview/sample-idea-controls.tsx apps/web/src/i18n/save-feedback-locales.spec.ts apps/mobile/components/save-feedback apps/mobile/app/_layout.tsx apps/mobile/src/features/wardrobe/style-piece-panel.tsx apps/mobile/src/features/preview/member-sample-outfit.tsx apps/mobile/src/features/preview/sample-idea-controls.tsx apps/mobile/src/i18n/save-feedback-locales.spec.ts` -- expected: exits 0
