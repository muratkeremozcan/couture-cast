---
title: 'Story CC-7.6: Garment delete'
type: feature
ticket: '7-6-garment-delete'
created: '2026-11-25'
status: built
baseline_revision: '246577af39e8917eee29e14f437deccaf65c2c88'
route: full
route_source: auto
risk: high
review: thorough
review_source: pinned
lenses_ran:
  - quick
  - codex-correctness
  - codex-security
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/spec-7-5-garment-detail-tag-edit.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Members cannot remove a garment. The API has `DELETE /api/v1/wardrobe/garments/:id`
(204, immediate purge), but no web or native client calls it, the contract and generated client
omit it, nothing tells the member which saved looks or capsules lose the piece, a legal hold
silently drops the member's request, and a purge failure after the committed flip returns 5xx.

**Approach:** Add Delete to the garment detail on web and native. A piece in no saved look or
capsule shows "Deleted" with Undo for 5 seconds and the request is sent when the window closes;
a piece in use asks once, naming how many looks it is in, then deletes at once. The API gains a
usage count read, records deletion requests under legal hold, and finishes a failed purge
asynchronously.

## Decisions (owner delegated; recorded here)

- D1 Undo is a deferred client commit. Tap Delete hides the piece at once and shows "Deleted"
  with Undo for 5 s (`SAVE_FEEDBACK_TIMINGS.statusBarDurationMs`); the DELETE is sent when the
  window ends. Undo cancels and the piece returns. The window flushes early when the member starts
  another delete, leaves the closet, hides the page (web `pagehide`/`visibilitychange` with
  `keepalive`) or backgrounds the app (native `AppState`). On native, leaving the closet is a
  navigation blur of the hub (tab switch, Capsules, Silhouette) other than opening a garment
  detail. Rejected: a server soft delete with a
  restore route, because it delays byte removal to the hourly sweep and adds a restore race; the
  deferred commit keeps the existing immediate purge.
- D2 "Looks it affects" = saved looks (not soft-deleted) whose anchor or composition slots hold
  the garment plus capsules that contain it. New read
  `GET /api/v1/wardrobe/garments/:garmentId/usage` returns
  `{ garmentId, savedLookCount, capsuleCount }`; the prompt names the sum with plural forms.
  After confirmation the DELETE runs at once with no Undo, then "Deleted".
- D3 Usage read failure: no delete, error notice with Retry. Unknown or non-active garment: 404
  `GARMENT_NOT_FOUND`; the client treats it as already gone and removes it.
- D4 Legal hold: DELETE still answers 204 and the member sees "Deleted" (the list already hides
  held pieces; nothing reveals the hold). The request is recorded on the row
  (`deletion_requested_at`, `retention_trigger`) without changing `legal_hold`. A database
  trigger (new migration, BEFORE UPDATE on `GarmentItem`) turns a release (`legal_hold` to
  `active`) of a row with a recorded request into `deletion_pending`, so no reader of active
  garments (list, capsule eligibility, outfit and ritual generation, Style this piece, saved
  looks) ever sees it as active; the hourly sweep purges it. No reader filter changes needed.
- D5 Async purge: when the flip commits but the synchronous purge throws, DELETE logs
  `wardrobe_retention_purge_deferred` and returns 204; the hourly sweep completes it. A repeat
  DELETE is idempotent (204).
- D6 Failed deferred DELETE (network, 5xx, 403): the piece returns to the grid and the status bar
  says it could not be deleted, with Retry (offline uses the offline tone).
- D7 Delete lives on the garment detail only. After the tap the detail closes to the grid at its
  saved scroll position; focus moves to the next card, else the previous one, else the grid
  heading. Native pops back to the hub, which stays mounted and keeps its scroll.
- D8 A member can always delete their own data: DELETE and the usage read skip the guardian
  upload-consent check (`WardrobeUploadGuard`); auth and ownership stay. Both routes move to a
  separate controller under `/api/v1/wardrobe` guarded by `RequestAuthGuard` only.
- D9 A failed commit returns its piece at once. Its failure notice ("Could not delete", Retry)
  waits until no delete is inside its Undo window, so a later delete keeps its Undo on the bar
  until its own deadline (at most 5 s). Failures reported together share one notice, which also
  carries the ids of a failure notice still on screen; its Retry sends each of those pieces
  alone, at once, with no new Undo window, under the bearer the app holds when Retry is pressed.
  Every other delete keeps its window.
- D11 Every notice, action and late answer belongs to the account that started the delete. Once
  the tab or app holds another account (or none), that account's last notice leaves the bar, its
  pending deletes are sent with its own bearer, and their answers show nothing; Undo and Retry
  do nothing for another account. The piece stays in the old account's closet, where the next
  load shows it. This is the one exception to D6. The deletes and their notices outlive a closet
  mount, so a Retry pressed after leaving the closet is still heard, and a closet mounted later
  for the same account gets its grid update.
- D10 Test seam: web takes an injected controller factory (one controller per member session);
  native takes an injected deletion with injectable epoch, bearer and identity sources; both
  expose a reset for tests, so pending deletes never leak between tests.

## Boundaries & Constraints

**Always:** CC-7.1 status bar and confirm patterns; every new string in all 10 web and 10 mobile
locales with parity specs; ownership and guardian checks on the server path; the existing lock
order (owner profile, capsules, garments) for every retention write; strict response schemas.

**Never:** batch delete; deleting non-ready garments from the UI; changing capsule repair
(capsules keep `needs_repair`); changing saved-look missing-piece rendering (CC-7.2); grid or
shell redesign (CC-7.7, CC-7.9, CC-7.16); tab rework (CC-7.11); a garment restore endpoint.

## I/O & Edge-Case Matrix

| Scenario      | Input / State                       | Expected                                                                  | Error handling            |
| ------------- | ----------------------------------- | ------------------------------------------------------------------------- | ------------------------- |
| Unused piece  | usage 0/0, tap Delete               | grid at same scroll, piece gone, "Deleted" + Undo 5 s, then DELETE 204    | none                      |
| Undo          | within 5 s                          | no DELETE sent, piece back in place, "Undone"                             | none                      |
| Used piece    | usage 2 looks + 1 capsule           | prompt names 3 looks; Cancel keeps it; Delete sends DELETE now, "Deleted" | none                      |
| After delete  | used piece purged                   | gone from list; saved look shows missing piece; capsule needs repair      | none                      |
| Second delete | another delete inside window        | first commits immediately, second gets its own Undo                       | none                      |
| Leave / hide  | navigate away, pagehide, background | pending DELETE sent at once                                               | none                      |
| Commit fails  | DELETE network error or 5xx         | piece returns, "Couldn't delete" + Retry                                  | offline tone when offline |
| Retry         | tap Retry                           | DELETE again; 204 removes piece, "Deleted"                                | same as commit fails      |
| Usage fails   | usage read network/5xx              | nothing deleted, error + Retry                                            | none                      |
| Gone already  | usage or DELETE on missing garment  | piece removed, "Deleted"                                                  | 404 usage treated as gone |
| Legal hold    | garment under hold                  | 204; request recorded; hold untouched; purged after release by sweep      | none                      |
| Purge throws  | flip committed, purge fails         | 204, row `deletion_pending`, hidden; sweep purges later                   | logged, not surfaced      |
| Other member  | garment of another user             | usage 404; DELETE 204 no-op                                               | no data leak              |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/wardrobe/wardrobe-retention.service.ts:103-158` `requestDeletion` --
  legal-hold branch records the request (`updateMany` where `legal_hold`); wrap `purgeGarment` in
  catch + log (D5). Keep lock order.
- `packages/db/prisma/migrations/<ts>_garment_hold_release_honours_deletion/migration.sql` (new) --
  D4 trigger; precedent `20260420160000_harden_audit_log_immutability`.
- `apps/api/src/modules/wardrobe/wardrobe-saved-look.service.ts:175,634` -- export
  `collectGarmentIdsFromRow`; add `countSavedLooksUsingGarment(userId, garmentId)` over `deleted_at:
null` rows (select `anchor_garment_id`, `composition`).
- `apps/api/src/modules/wardrobe/wardrobe.controller.ts:55,137` -- move DELETE to a new
  `WardrobeGarmentRemovalController` (D8, `RequestAuthGuard` only, register in `wardrobe.module.ts`)
  and add `GET garments/:garmentId/usage` there (no-store); 404 unless the garment is the caller's,
  `active`, ready, no recorded request. Capsule count: `outfitCapsule.count({ where: { user_id,
garment_joins: { some: { garment_id } } } })`.
- `packages/api-client/src/contracts/http/wardrobe.ts` -- register DELETE garment (204) and the
  usage GET with a strict `garmentUsageResponseSchema`; `openapi.ts:178` to 1.11.0 with a note;
  regenerate the client; rebuild api-client dist.
- `packages/utils/src/wardrobe/deferred-garment-deletion.ts` (new, exported) -- one platform-free
  controller: `schedule(id, commit)`, `undo(id)`, `flush()`, `pendingIds()`, `subscribe`; injectable
  timer; scheduling a second id flushes the first. Unit tested.
- `apps/web/src/lib/wardrobe.ts:552-575` -- `deleteGarmentFromWeb(id, { keepalive })`,
  `getGarmentUsageFromWeb(id)`; copy `deleteCapsuleFromWeb` (:711).
- `apps/mobile/src/lib/wardrobe.ts:197-227` -- `deleteGarmentFromMobile`,
  `getGarmentUsageFromMobile`.
- `apps/web/src/app/wardrobe/garment-detail.tsx:792-803` -- Delete button (`garment-delete`) beside
  Edit tags / Style this piece; confirm dialog (`garment-delete-confirm`,
  `garment-delete-confirm-accept`, `garment-delete-cancel`). Calls an `onDelete` prop.
- `apps/web/src/app/wardrobe/page.tsx:244-298,345-372,807` -- own the controller per page; hide
  pending ids from `garments`; close detail via `closeGarmentDetail`, restore scroll, focus next
  card; notice from root `useStatusBar`; bump `setSavedLooksAttempt` after commit; flush on unmount
  and `pagehide`.
- `apps/mobile/src/features/wardrobe/garment-detail-screen.tsx:735-918` -- Delete in
  `GarmentTagPanel` row, confirm via `Alert`-free in-screen confirm (same test ids); on tap:
  schedule or commit, then `router.back()`.
- `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx:198-209,621` -- module-level controller
  instance; hub filters pending ids, shows Deleted/Undo/Retry through the root `useStatusBar`,
  flushes on `AppState` background; `notifyWardrobeChanged` after commit.
- Locales: `wardrobe.detail.delete*` keys (button, confirm title with `_one/_other`, accept, cancel,
  deleted, undone, failed, usage failed) in 10 web + 10 mobile catalogs; add to `REQUIRED_KEYS` in
  both `wardrobe-detail-locales.spec.ts`.
- Test ids (TEA contract, web `data-testid` = native `testID`): `garment-delete`,
  `garment-delete-confirm`, `garment-delete-confirm-count`, `garment-delete-confirm-accept`,
  `garment-delete-cancel`; status bar ids unchanged.

## Tasks & Acceptance

**Execution:**

- [x] `wardrobe-retention.service.ts`, hold-release trigger migration -- D4 legal-hold record and
      release, D5 deferred purge.
- [x] `wardrobe-saved-look.service.ts`, `wardrobe.controller.ts` (+ module wiring) -- usage read.
- [x] `packages/api-client` contract, openapi 1.11.0, generated client, dist rebuild.
- [x] `packages/utils` deferred deletion controller + unit test.
- [x] Web lib, `garment-detail.tsx`, `page.tsx` -- delete, confirm, undo, retry, scroll and focus.
- [x] Mobile lib, `garment-detail-screen.tsx`, `wardrobe-hub-screen.tsx` -- same on native.
- [x] Locales (10 + 10) and parity spec keys.
- [x] Tests per TEA plan (`_bmad-output/test-artifacts/test-design-7-6-garment-delete.md`),
      cross-link comments.
- [x] `learning-path-step-by-step.md` -- Step 63 to merged (`246577af`, PR #290), add Step 64;
      sprint-status 7-6 done before final push.

**Acceptance Criteria:**

- Given a ready garment in no saved look or capsule, when the member taps Delete, then the grid
  shows at the same scroll position without the piece, "Deleted" with Undo shows for 5 s, and after
  reload the piece is gone (web and native).
- Given the same, when Undo is tapped inside 5 s, then no DELETE is sent and the piece is back.
- Given a garment in 2 saved looks and 1 capsule, when Delete is tapped, then one prompt names 3
  looks; confirming deletes it, the saved looks show the missing-piece state and the capsule shows
  needs repair.
- Given the DELETE fails, when Retry is tapped and succeeds, then the piece is gone.
- Given a garment under legal hold, when DELETE is called, then 204, the hold and bytes stay, and
  after release the sweep purges it.
- Given the purge throws after the flip, when DELETE is called, then 204 and the next sweep purges
  it.

## Implementation Notes

- API: DELETE and the usage GET live in `wardrobe-garment-removal.controller.ts`
  (`RequestAuthGuard` plus `@AllowPendingGuardianTeen`, the same non-upload surface rule as
  saved looks; a suspended account stays blocked). Both validate the id (400 over 128 chars).
  `countGarmentCapsules` (`wardrobe.service.ts`) gives the 404 for anything but the caller's own
  ready, active, unrequested garment with an object; `countSavedLooksUsingGarment` counts in SQL
  (anchor or a `{kind:'garment', itemId}` composition slot, `deleted_at IS NULL`).
- `requestDeletion`: a purged row returns before any lock; the flip requires
  `retention_purged_at: null`; under a hold the request is recorded once (`deletion_requested_at
IS NULL`) inside the same lock order. Hold release: trigger
  `private.garment_hold_release_honours_deletion` (BEFORE UPDATE OF `retention_status`, only
  `legal_hold` to `active` with a recorded, unpurged request becomes `deletion_pending`).
- The WardrobeController DELETE handler moved; `wardrobe.controller.spec.ts` now constructs
  `WardrobeController(service)` and runs its existing delete-delegation case on the new
  controller. The Pact provider registers the new controller. OpenAPI version pins in
  `community-openapi-contract.spec.ts` and `wardrobe-contract.spec.ts` (7.5-UNIT-012) read 1.11.0.
- Web: `garment-deletion.ts` (`useGarmentDeletion`) owns one controller per Closet mount; a Next
  page takes no props, so the D10 seam is `injectWardrobeGarmentDeletionForTests(controller)`.
  Every web send uses `keepalive: true` (TEA review) and the bearer captured when Delete was
  tapped. The detail runs the usage read and the confirm (`role="alertdialog"`, focus on Cancel,
  Escape cancels, focus back to Delete); the page closes the detail at once and focuses the next
  card's first button, else the previous, else `wardrobe-closet-heading`. The Closet wraps itself
  in an inline status bar provider only when no root provider exists.
- Native: module instance `garmentDeletion` (`createMobileGarmentDeletion`,
  `resetGarmentDeletionForTests`); hub and detail take an optional `deletion` prop. The detail
  requests the delete and pops (`router.back()`, else `dismissTo('/wardrobe')`); the hub shows
  Deleted/Undo/Undone/Could not delete/Retry through the root status bar, flushes on
  `AppState` `background` and on unmount, and calls `notifyWardrobeChanged` after a commit.
- Review fixes: a usage 404 reads as gone only when its body says `GARMENT_NOT_FOUND`; a gone
  piece still gets the idempotent DELETE at once (so a hold that landed after the list read
  records the request); `commitNow` first sends every other delete still in its window; Undo
  after the send started shows "Deleted" again with no Undo.
- Codex fixes: `retry` sends one id alone, and `failuresToReport` holds a failure notice until no
  Undo window is open (UNIT-017, UNIT-018). Web deletes live in a per-member module session that
  outlives a Closet mount and speaks only while the tab holds that member. Native notices live in
  the module deletion, which the hub hands its root status bar; identity changes dismiss the
  last notice, Undo and Retry check the epoch at press, and Retry resolves the verified bearer
  when pressed. The hub flushes on navigation blur unless a garment detail opened; Capsules
  reloads on a wardrobe change. Ritual staleness counts garments that left `active`, and the
  hold-release trigger stamps `updated_at`. A repeat DELETE of a pending row keeps its first
  request time and reason.
- Locale keys: `delete`, `deleteConfirmTitle_one/_other`, `deleteConfirmAccept`, `deleteCancel`,
  `deleteSucceeded`, `deleteUndone`, `deleteFailed`, `deleteUsageFailed`. The web parity spec now
  allows `{{count}}` in the plural keys only.

## Plan Change Log

## Review Triage Log

Pass 1: quick lens (Claude) on the full diff against `246577af`, plus TEA source findings while
writing tests. Verdicts: 0 high, 6 medium, 5 low, 3 false. Every kept finding routes to patch.

| #   | Verdict | Finding                                                                                                         | Resolution                                                                         |
| --- | ------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Q1  | medium  | Any usage 404 (route-level during deploy skew) treated as gone; gone never sent DELETE, so a hold race skips D4 | 404 is gone only for `GARMENT_NOT_FOUND`; gone sends the idempotent DELETE at once |
| Q2  | medium  | Leave-flush failure never shown: cleanup unsubscribed before flush                                              | Unsubscribe after the flush settles; root status bar shows Retry                   |
| Q3  | medium  | Mobile module controller showed a previous account's failure and Retry to the next account                      | Events carry the requesting identity epoch; hub ignores other epochs               |
| Q4  | medium  | Mobile Retry reused the token captured at tap (TEA 3 same root)                                                 | Failed commit dropped; `retry(id, accessToken)` rebuilds with live bearer          |
| Q5  | medium  | Undo after an early flush or started commit dismissed silently (TEA 2 same root)                                | Undo returning false re-shows "Deleted" without Undo                               |
| Q6  | medium  | `commitNow` did not flush other waiting deletes (D1), hiding their Undo                                         | `commitNow` commits other waiting entries first; UNIT-016                          |
| T1  | low     | Native detail stayed busy when the pop did not happen                                                           | Phase back to idle after `returnToHub`                                             |
| Q7  | low     | Orphaned JSDoc in `scripts/lib/mobile-e2e-flow-state.mjs`                                                       | TEA moves its block above the existing JSDoc                                       |
| Q8  | low     | Spec lines over 100 characters (AGENTS.md)                                                                      | Reflowed                                                                           |
| Q9  | low     | `collectGarmentIdsFromRow` exported but unused                                                                  | Export reverted                                                                    |
| Q10 | low     | Web locale spec branched inside the test; usage/DELETE 403 text named guardian consent (TEA)                    | Two loops; 403 reads "Account blocked from member access."                         |
| T2  | low     | Late Undo showed "Deleted" before the in-flight DELETE answered                                                 | Pending id: the commit outcome speaks; committed id: "Deleted" without Undo        |
| T3  | low     | Hub remount before the leave-flush settled doubled notices                                                      | Module hub mount generation; an unmounted listener yields to a newer hub           |
| T4  | low     | Event with no recorded epoch was stamped as the current account                                                 | Such events are dropped                                                            |
| T5  | false   | reset() clears epochs mid-send; generation shared across instances                                              | Test seam only; no app path calls reset or builds a second instance                |
| Q11 | false   | Native component tests missing                                                                                  | TEA landed NAT-002..007 after the diff was staged                                  |
| Q12 | false   | Maestro flow absent from the diff                                                                               | Untracked when staged; `maestro/garment-delete-flow.yaml` ships in the PR          |
| Q13 | false   | Spec tasks and sprint status unfinished                                                                         | Flipped before the final push, as the spec says                                    |

Pass 2: Codex review plus Codex Security on `246577af..fd00e337`
(`epic7-coord/7.6-codex-review.md`). 3 P1, 8 P2, 3 P3; Codex Security reported none. Every
finding routes to patch; test-only findings went to TEA. T6 to T11 are TEA source findings
while writing the tests for these fixes.

| #   | Verdict | Finding                                                                                  | Resolution                                                                       |
| --- | ------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| C1  | high    | Retry for A used `commitNow`, sending B inside its Undo window; A's notice hid B's Undo  | `retry` sends its id alone; failure notice waits for no open window (D9)         |
| C2  | high    | UNIT-029 asserted a write the purged path skips                                          | TEA: zero writes; UNIT-029b covers a row purged under the lock                   |
| C3  | high    | INT-008 ran under policy `off` and a fixed birthdate                                     | TEA: `required_13_15` and `birthdateForAge(15)`                                  |
| C4  | medium  | Retry after leaving the closet had no listener; web Retry tied to a retired controller   | Deletes and notices live in a member session that outlives a mount (D11)         |
| C5  | medium  | Native Retry read the hub's last-load bearer                                             | Retry resolves the verified bearer at press and rechecks the epoch               |
| C6  | medium  | Native tab switch or Capsules push did not flush                                         | Hub blur flushes unless a garment detail was opened (D1)                         |
| C7  | medium  | Ritual reused cached or persisted outfits naming a released held piece                   | Staleness counts garments that left `active`; trigger stamps `updated_at`        |
| C8  | medium  | Native Capsules stayed Ready after the delete landed                                     | Capsules reloads on `onWardrobeChanged` for its epoch                            |
| C9  | medium  | Parallel Maestro runner skipped the dress fixture hook                                   | TEA: flow added to `USER_SCOPED_FLOWS`                                           |
| C10 | medium  | CMP-005 asserted zero DELETEs after a valid schedule                                     | TEA: zero before Retry, one after the window                                     |
| C11 | medium  | Playwright clock and Maestro timing could cross the deadline on a slow runner            | TEA: clock paused before Delete; Maestro timed leg trimmed, commit polled        |
| C12 | low     | Web published a previous member's late failure and Retry                                 | Session speaks only while the tab holds its owner; ends and dismisses on change  |
| C13 | low     | Native notice actions outlived their account                                             | Identity change dismisses the last notice; Undo and Retry check epoch at press   |
| C14 | low     | Repeat DELETE overwrote the first request time and reason                                | Pending rows keep both; purge audit reads the locked row's trigger               |
| T6  | medium  | A Retry or confirmed delete landing during another window replaced its Undo with Deleted | "Deleted" is held until no window is open, before any failure report             |
| T7  | medium  | A native Retry landing with no hub mounted never told Capsules or Today                  | The module calls `notifyWardrobeChanged` when no hub of that account is attached |
| T8  | low     | Capsules epoch guard and late-Undo epoch guard could never decide                        | Removed; `loadCapsules` and the identity flush already cover both                |
| T9  | low     | Native deletion never unsubscribed from identity changes                                 | `dispose()` stops following the controller and the account                       |
| T10 | medium  | A merged failure notice kept ids that were retried or had committed                      | Retry clears the notice's ids; a commit drops its id from the notice             |
| T11 | false   | Undo of the last window while a "Deleted" is held announces both                         | Kept: each names a different piece, and dropping it leaves a Retry unconfirmed   |

Pass 3: CodeRabbit round 1 on `3f5122ac` (5 threads, 27 minor and 2 nitpicks in the review body).
Source fixes below; every test-side item went to TEA.

| #   | Verdict | Finding                                                                              | Resolution                                                                     |
| --- | ------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| R1  | medium  | Native Retry with no bearer covered an open Undo                                     | Failure notice held until no window is open                                    |
| R2  | medium  | Usage Retry on the bar could act on another piece or outlive its detail              | Usage failure and Retry live inside the detail (web and native)                |
| R3  | medium  | Usage failure for B replaced A's Undo on the bar                                     | Same fix as R2                                                                 |
| R4  | medium  | Hub remounted mid-DELETE never finished its first read                               | A commit before the first read landed reads again                              |
| R5  | low     | Controller re-entrancy: send not registered, reset during committing still sent      | Send registered before `committing`; ownership checked before the request      |
| R6  | low     | Held notices shown while a superseding window was not yet open                       | `schedule` opens the new window before sending the superseded delete           |
| R7  | low     | Regenerated recommendation stayed stale (`created_at`)                               | Staleness reads `updated_at`                                                   |
| R8  | low     | Edit tags during a delete check could lose a draft                                   | Edit tags disabled while the check or prompt runs                              |
| R9  | low     | "Deleted" replaced a live Retry; Retry not restored after another notice             | Covered Retry returns once no window is open; "Deleted" only announced over it |
| R10 | low     | Web notice stayed after an account change with no Closet mounted                     | Session ends on the session event and dismisses its notice                     |
| R11 | low     | D7 focus could land on a processing card's status button                             | Focus uses the next or previous detail opener                                  |
| R12 | false   | A `failuresToReport` listener that schedules could see the report with a window open | No listener schedules from a report; the report is decided with no window open |
| R13 | false   | Prompt says "looks" for a capsule-only piece                                         | D2 counts saved looks and capsules together as looks                           |
| T12 | medium  | A Retry the member dismissed or another feature replaced still counted as showing    | The bar's notice is read at each render; a replaced Retry ends                 |
| T13 | low     | Failure notice expiry ran on real time only                                          | Clock seam: web `injectWardrobeGarmentDeletionClockForTests`, native `now`     |
| T14 | false   | Inline usage failure lost the offline tone                                           | One style: the text is the same either way and the offline line already shows  |

## Design Notes

On web the bar is read from the last Closet render, so a Retry dismissed or replaced while no
Closet is mounted is not seen; no "Deleted" can arise then, since nothing deletes outside the
Closet and a dismissed Retry cannot be pressed.

The controller is shared because both apps need the same window, flush and supersede rules; only
the commit function and the lifecycle hooks (pagehide vs AppState) differ. Web sends every
DELETE with `keepalive` (no body, so no size limit applies). The usage read is separate from DELETE
so the existing 204 route
keeps its contract for the Playwright and Maestro cleanup callers.

## Verification

**Commands:**

- `npm run build --workspace @couture/utils && npm run build --workspace @couture/api-client` --
  clean
- `npx tsc --noEmit -p <workspace>` for utils, api-client, apps/api, apps/web, apps/mobile -- 0
  errors
- `npx eslint --max-warnings=0 <touched files>` -- 0 warnings
- Unit, API, Playwright and native suites run in CI only. Shared worktree with TEA: never git
  stash, checkout --, reset; announce before git add/commit; never touch a database.
