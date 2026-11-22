---
title: 'CC-7.3: Import device-saved looks for the same member'
type: feature
ticket: 'CC-7.3'
created: '2026-11-22'
status: built
baseline_revision: '72b685c266b73cdbd903bfa67fc014c8f9b49c5f'
route: oneshot
route_source: auto
risk: medium
review: 'codex-peer'
review_source: '_bmad-output/implementation-artifacts/reviews/story-7-3-codex-review.md'
lenses_ran: ['correctness', 'security', 'verification']
review_loop_iteration: 1
followup_review_recommended: false
context:
  - 'AGENTS.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/reviews/epic-7-codex-review.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Members who saved looks in Style this piece (`couturecast.style-piece.<scope>`) or Home sample (`couturecast.member-sample-bookmarks.<owner>`) before CC-7.2 still have those records in device storage, and the legacy parsers (`parseStylePieceRecipes` and `parseSampleBookmarks`) silently drop valid entries that no longer resolve against current garment tags or catalog rules instead of importing them into the `"Needs review"` state.

**Approach:** On signed-in load on web and mobile, scan and import only device-saved looks keyed to the currently authenticated member id into `/api/v1/wardrobe/saved-looks` using a deterministic UUID v4 `Idempotency-Key` per stable source id after server garment-ownership validation; preserve valid legacy records that no longer resolve into `"Needs review"` (`availabilityStatus: 'needs_review'`), leave guest preview storage (`couturecast.guest-preview.v1`) and other accounts' keys untouched, keep unacknowledged entries retryable on transient failure or account switch, and delete the member's device lists once acknowledged.

## Boundaries & Constraints

**Always:**

- Match device storage keys strictly to the currently authenticated member id (`couturecast.member-sample-bookmarks.<owner>` and `couturecast.style-piece.<scope>` where `<scope>` decodes to `[owner, garmentId]` with `owner === currentOwner` and round-trips through `stylePieceStorageKey(owner, garmentId)`).
- Pin the starting member's bearer token and fence every async step against account switches (`isLiveOwner(owner)` / `currentWebSessionOwner() === owner` on web; `mobileApplicationUserId() === owner && mobileIdentityEpoch() === startEpoch` on mobile).
- Send a deterministic RFC 4122 UUID v4 `Idempotency-Key` per stable source id so concurrent retries and interrupted retries replay idempotently (`200 OK`) with zero duplicates.
- Preserve schema-valid legacy records (`savedStylePieceRecipeSchema` / `legacySampleBookmarkSchema`) that no longer resolve against the live anchor garment or catalog rules into `availabilityStatus: 'needs_review'`.
- Keep unacknowledged entries in device storage on transient (`5xx` / network / timeout / abort) failures, and remove device keys once all entries are acknowledged (`200`/`201`) or terminally rejected (`400`/`404 GARMENT_NOT_FOUND`/`409 SAVED_LOOK_ALREADY_REMOVED`).

**Never:**

- Never read, import, or delete `couturecast.guest-preview.v1` or any device key belonging to a different member id.
- Never alter CC-6.16 comfort-only carryover (`packages/utils/src/sample-wardrobe/carryover.ts`).
- Never silently drop a schema-valid legacy saved look for an owned garment when its look or swaps no longer resolve.

## I/O & Edge-Case Matrix

| Scenario                                             | Input / State                                                                                                                                                        | Expected Output / Behavior                                                                                                                                                                                     | Error Handling                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Happy-path same-member import                        | Authenticated member `owner` has valid `couturecast.member-sample-bookmarks.<owner>` and `couturecast.style-piece.<scope>` entries for owned ready garments          | Each entry imports once via `POST /api/v1/wardrobe/saved-looks` with deterministic UUID v4 `Idempotency-Key`, appears in account saved looks (`availabilityStatus: 'ready'`), and device keys are removed      | No error expected                                                              |
| Unresolved valid legacy look (AC 2)                  | Schema-valid `style_piece` recipe (e.g. anchor garment tags changed or look/swap no longer resolves) or `home_sample` bookmark (look/swap no longer resolves)        | Entry is imported (not dropped), server returns `availabilityStatus: 'needs_review'`, UI displays `"Needs review"` badge, and device key is removed on ack                                                     | No error expected                                                              |
| Cross-account & guest isolation (AC 3)               | Device holds `couturecast.guest-preview.v1`, `couturecast.member-sample-bookmarks.member-b`, and `couturecast.style-piece.<member-b, g-b>` while `member-a` signs in | Only `member-a` keys are read, imported, and deleted; `member-b` keys and guest preview remain byte-for-byte untouched                                                                                         | No error expected                                                              |
| Tampered garment or schema reference (AC 1, AC 5)    | `member-a` device key references `member-b`'s `garmentId` (`404 GARMENT_NOT_FOUND`) or contains a malformed/non-catalog item alongside a valid entry                 | Server rejects unowned `garmentId` with `404 GARMENT_NOT_FOUND`; tampered entry never enters `member-a`'s account while valid entries import and the processed device key is cleaned up                        | `400`/`404`/`409` treated as terminal rejection for the tampered/removed entry |
| Interrupted import & concurrent retries (AC 1, AC 5) | First attempt hits `503`/network failure, or two concurrent import runs fire for the same `owner`                                                                    | Failed entries stay in device storage and retry with the same deterministic `Idempotency-Key`; concurrent retries deduplicate on `(user_id, idempotency_key)` producing 1 record and 0 duplicates              | Transient errors preserve unacknowledged entries in storage                    |
| Account switch during import (AC 5)                  | `member-a` import is in flight when session switches to `member-b`                                                                                                   | `member-a` import aborts/fences on identity change, never posts under `member-b`'s token, leaves unacknowledged `member-a` entries retryable for `member-a`, and imports only `member-b`'s keys for `member-b` | Late responses for `member-a` are ignored                                      |

</intent-contract>

## Code Map

- `packages/utils/src/sample-wardrobe/saved-looks.ts` -- Deterministic UUID v4 `createDeterministicIdempotencyKey`, storage key parsers (`parseStylePieceStorageKey`, `memberSampleBookmarksStorageKeys`, `parseMemberSampleBookmarksStorageKey`), resolution checker (`doesSavedLookResolve`), and legacy import builders (`parseLegacyHomeSampleBookmarksForImport`, `parseLegacyStylePieceRecipesForImport`).
- `apps/api/src/modules/wardrobe/wardrobe-saved-look.service.ts` -- Keep Postgres `anchor_snapshot` authoritative on `verifyOwnedGarmentsAndSnapshot`, derive `availabilityStatus: 'needs_review'` in `formatSavedLooks` when DB snapshot disagrees with live garment tags or `doesSavedLookResolve` is false, and check `deleted_at !== null` before payload hash mismatch in `findIdempotentReplay`.
- `apps/web/src/lib/saved-looks.ts` -- `importLegacyDeviceSavedLooksFromWeb` (scans `localStorage` for `owner`-scoped legacy keys, imports with pinned token and deterministic `Idempotency-Key`, rewrites/removes keys on ack, deduplicates in-flight runs, and fences on `isLiveOwner`).
- `apps/mobile/src/lib/sample-recipe-storage.ts` & `apps/mobile/src/lib/saved-looks.ts` -- Extend `sampleRecipeStorage` with `remove()` and key discovery for `owner`, and implement `importLegacyDeviceSavedLooksFromMobile` fenced on `mobileApplicationUserId` + `mobileIdentityEpoch`.
- `apps/web/src/app/wardrobe/page.tsx`, `apps/web/src/app/components/home-ritual.tsx`, `apps/web/src/app/wardrobe/style-piece-panel.tsx` -- Trigger legacy import on signed-in load before/with saved looks listing and display `"Needs review"` badges on unresolved looks.
- `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx`, `apps/mobile/src/features/preview/member-sample-outfit.tsx`, `apps/mobile/src/features/wardrobe/style-piece-panel.tsx` -- Trigger legacy import on signed-in load on mobile and display `"Needs review"` badges on unresolved looks.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/utils/src/sample-wardrobe/saved-looks.ts` -- Add deterministic UUID v4 generator, strict key parsers, `doesSavedLookResolve`, and non-dropping legacy import parsers (`parseLegacyHomeSampleBookmarksForImport`, `parseLegacyStylePieceRecipesForImport`) -- Preserves valid unresolvable legacy records into `"Needs review"` and produces stable idempotency keys.
- [ ] `apps/api/src/modules/wardrobe/wardrobe-saved-look.service.ts` -- Preserve validated `input.anchorSnapshot` on create and check `doesSavedLookResolve` in `formatSavedLooks` -- Ensures valid imported looks that no longer resolve against current garment tags or catalog rules enter `availabilityStatus: 'needs_review'`.
- [ ] `apps/web/src/lib/saved-looks.ts`, `apps/web/src/app/wardrobe/page.tsx`, `apps/web/src/app/components/home-ritual.tsx`, `apps/web/src/app/wardrobe/style-piece-panel.tsx` -- Implement and wire `importLegacyDeviceSavedLooksFromWeb` and `"Needs review"` badges -- Imports same-member device looks on signed-in web load and removes acknowledged keys.
- [ ] `apps/mobile/src/lib/sample-recipe-storage.ts`, `apps/mobile/src/lib/saved-looks.ts`, `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx`, `apps/mobile/src/features/preview/member-sample-outfit.tsx`, `apps/mobile/src/features/wardrobe/style-piece-panel.tsx` -- Implement and wire `importLegacyDeviceSavedLooksFromMobile` and `"Needs review"` badges -- Imports same-member device looks on signed-in mobile load (web and native file storage) and removes acknowledged keys.
- [ ] `packages/utils/src/sample-wardrobe/saved-looks.spec.ts`, `apps/api/src/modules/wardrobe/wardrobe-saved-look.service.spec.ts`, `apps/web/src/lib/saved-looks.test.ts`, `apps/mobile/src/lib/saved-looks.test.ts`, `playwright/tests/saved-looks-follow-account.spec.ts` -- Add unit, component, and Playwright E2E tests covering all I/O matrix rows (same-member import, unresolved -> `"Needs review"`, tampered references, two accounts on one device, account switch during import, and concurrent retries) -- Proves all 5 ACs end to end.

**Acceptance Criteria:**

- Given a signed-in member with pre-CC-7.2 device-saved looks under the same authenticated member id, when the app loads, then each look imports once per stable source id after the server validates garment ownership; imports stay retryable until acknowledged and produce no duplicates on concurrent retries.
- Given a valid imported look that no longer resolves, when it is imported, then it enters the `"Needs review"` state.
- Given guest preview storage or device keys belonging to another member id, when the current member signs in, then those keys are not read, imported or deleted; CC-6.16 comfort-only carryover stays unchanged.
- Given a completed import, when the server acknowledges it, then the device lists are removed and saved looks appear only in the account list.
- Given verification, when tests run, then they cover tampered references, two accounts on one device, an account switch during import and concurrent retries.

## Implementation Notes

- Oneshot route selected in main worktree session (`feat/epic7-story-7-3-import-device-saved-looks-same-member`) to coordinate shared utils, API service, web/mobile clients, Playwright E2E against isolated PostgreSQL 17 (`127.0.0.1:54361`), and the `epic-7-codex-review` peer session.

## Plan Change Log

## Review Triage Log

- **Codex Round 1 (`_bmad-output/implementation-artifacts/reviews/story-7-3-codex-review.md`):**
  - Finding 1 (High, retry key stability): Fixed. Derived deterministic UUID v4 `Idempotency-Key` strictly from legacy source identity (`legacy-import:v1:${sourceId}`), prioritized `SAVED_LOOK_ALREADY_REMOVED` for deleted rows on API, and added `409 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` reconciliation via filtered account GET so retries after retagging deduplicate with zero duplicates.
  - Finding 2 (High, native file discovery & inventory cap): Fixed. Added `Directory(Paths.document).list()` native enumeration with per-file `try/catch` in `apps/mobile/src/lib/sample-recipe-storage.ts`, plus removed client-slot category comparison in API `deriveNeedsReviewReasons` so owned garments outside the initial inventory page never trigger false `category_changed`.
  - Finding 3 (Medium, post-await session fencing): Fixed. Re-checked `isCurrent()` immediately after every `await` and before all storage reads/mutations on web and mobile; updated account-switch tests to verify distinct bearer tokens, untouched member-A keys, and mobile same-member re-entry with a new epoch.
  - Finding 4 (Medium, exact terminal status/code matching): Fixed. Restricted terminal pruning to `400`, `404 GARMENT_NOT_FOUND`, and `409 SAVED_LOOK_ALREADY_REMOVED`; `409 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` reconciles against the account; unrelated 404/409 responses remain retryable.
  - Finding 5 (Medium, concurrent tab write preservation): Fixed. Re-read current storage bytes before cleanup and re-parse if changed, preserving any entries added or modified while POSTs were in flight.
  - Finding 6 (Medium, Home unmount aborting startup migration): Fixed. Introduced session-scoped `ensureWebLegacySavedLooksMigration` and `ensureMobileLegacySavedLooksMigration` decoupled from view abort signals, with `HomeRitual` and `MemberSampleOutfit` subscribing to saved-look change notifications.
  - Finding 7 (Medium, non-blocking reads & work budget): Fixed. First-page list reads start the single in-flight session migration without blocking existing account reads, enforced aggregate key/byte/time budgets (`32` keys, `64 KiB`, `15s`), snapshotted `Object.keys(localStorage)`, and added a 2s timeout on error JSON body parsing.
  - Finding 8 (Low, canonical browser Style keys): Fixed. Restricted `.json` suffix stripping to `{ allowJsonExtension: true }` at the native file boundary only.
  - Finding 9 (Low, stale Home bookmark reopen): Fixed. Guarded `onOpen` in `HomeRitual` and `MemberSampleOutfit` so `needs_review` Home bookmarks display review feedback instead of silently opening a substitute outfit.
  - Finding 10 (Low, over-8 arrays & empty catalog fallback): Fixed. Raised legacy import cap to 32 valid entries without discarding valid siblings when extra/invalid elements exist, and guaranteed `>= 1` slot in `buildFallbackHomeSampleComposition`.
  - Verification & snapshot contract findings: Fixed. Aligned `spec-7-3`, MSW mocks, and API tests with DB-authoritative `anchorSnapshot`; updated Playwright CC-7.3 E2E to clean up test `SavedLook` rows cleanly in Postgres for retained-DB repeatability, verify settled reloaded account IDs, test a real second member's owned garment (`teen-2-garment-1`), and sign in as `teen-2` to prove untouched isolation.

## Verification

**Commands:**

- `npm --workspace @couture/utils run test` -- expected: all unit tests pass
- `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54361/postgres" INTEGRATION_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54361/postgres" npm --workspace api exec -- vitest run src/modules/wardrobe/wardrobe-saved-look.service.spec.ts` -- expected: all service unit tests pass
- `npm --workspace apps/web exec -- vitest run src/lib/saved-looks.test.ts src/app/wardrobe/saved-looks-row.test.tsx src/app/wardrobe/page.styling.test.tsx src/app/components/home-ritual.test.tsx` -- expected: all web saved-looks and import tests pass
- `npm --workspace apps/mobile exec -- vitest run --config vitest.config.ts src/lib/saved-looks.test.ts src/features/wardrobe/saved-looks-row.test.tsx src/features/wardrobe/wardrobe-hub-screen.test.tsx src/features/preview/member-sample-outfit.test.tsx` -- expected: all mobile saved-looks and import tests pass
- `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54361/postgres" INTEGRATION_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54361/postgres" PLAYWRIGHT_SKIP_DB_RESET=true npx playwright test playwright/tests/saved-looks-follow-account.spec.ts` -- expected: E2E tests pass
