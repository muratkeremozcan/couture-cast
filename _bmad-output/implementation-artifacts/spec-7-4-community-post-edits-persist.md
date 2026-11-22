---
title: 'Story CC-7.4: Community post edits persist'
type: bugfix
ticket: '7-4-community-post-edits-persist'
created: '2026-11-22'
status: in-review
baseline_revision: 'f65ed8e5'
route: full
route_source: auto
risk: high
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - '_bmad-output/implementation-artifacts/reviews/epic-7-codex-review.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Community post title and caption edits lacked monotonic client-side revision reconciliation against concurrent feed/target reads, ran text screening inside the 7-second privacy transaction lock window, collapsed distinct failure/unchanged outcomes (saved, rejected by screening, screening unavailable, stale revision, "No changes") into generic or silent UI states, and did not show an "Edited" label on the card or detail after a successful edit.

**Approach:** Reproduce title-only, caption-only, combined, unchanged, second-client, and rejected edits at phone width first; move text screening before the privacy transaction with decision binding to normalized text, locale, and policy version while rechecking all locks and invariants before commit; guard web and native reconciliation against overwriting newer text revisions; render distinct localized outcome messages and an immediate "Edited" label on card and detail across all 10 locales.

## AC 1 Reproduction Trace (2026-11-22, 390x844 phone width, isolated pg17 `127.0.0.1:54361`)

Controlled adult account created via `/api/v1/auth/signup` on `/community` at `390x844` viewport. Post published with initial title `"Plum layers"` and caption `"Layers for a cool evening"` (`textRevision: 0`).

| Step                | Editor Input                                                                                    | PATCH Status                                           | Committed Revision                                     | After Reload (Feed Card + Detail)                                            | Observed Gap                                                                                                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title-only          | `title: "Plum satin layers"`, `caption: "Layers for a cool evening"`, `baseRevision: 0`         | `200`                                                  | `1`                                                    | Card & detail: `"Plum satin layers"` / `"Layers for a cool evening"`         | No `"Edited"` label (`hasEditedInDetail: 0`, `hasEditedOnCard: 0`); no `"Saved"` confirmation                                                                                                                                                                                     |
| Caption-only        | `title: "Plum satin layers"`, `caption: "Warm wrap dress for cool evenings"`, `baseRevision: 1` | `200`                                                  | `2`                                                    | Card & detail: `"Plum satin layers"` / `"Warm wrap dress for cool evenings"` | Same missing `"Edited"` label & saved feedback                                                                                                                                                                                                                                    |
| Combined            | `title: "Autumn plum look"`, `caption: "Wrap dress with cropped jacket"`, `baseRevision: 2`     | `200`                                                  | `3`                                                    | Card & detail: `"Autumn plum look"` / `"Wrap dress with cropped jacket"`     | Same missing `"Edited"` label & saved feedback                                                                                                                                                                                                                                    |
| Unchanged           | Identical title + caption, `baseRevision: 3`                                                    | `200`                                                  | `3` (kept)                                             | Unchanged                                                                    | Editor closed silently (`statusText: ""`, `alertCount: 0`); no `"No changes"` message                                                                                                                                                                                             |
| Second open browser | Already open before edits                                                                       | —                                                      | `3` via `post.text_changed` -> `POST /targets/resolve` | Updated to `"Autumn plum look"` / `"Wrap dress with cropped jacket"`         | Web `apply(target)`, `loadFeed`, `revalidateHighlighted`, `spotlight.refreshItem` and mobile `apply(target)`, `loadFeed`, `revalidateHighlighted` lack a monotonic `textRevision` guard; a stale in-flight read/resolve landing after `onTextSaved` overwrites the newer revision |
| Screening rejection | Profane title, `baseRevision: 3`                                                                | `400` (`"Community post text could not be approved."`) | `3` (kept)                                             | Original text retained                                                       | Alert rendered generic `editFailed` (`"We couldn’t save your changes. Check the text and try again."`) instead of a screening-rejection message; `503` screening unavailable (`"Community text screening is temporarily unavailable."`) also collapsed to `editFailed`            |

### Root Causes Scoped to the Reproduced Path

1. **Stale-revision client clobber:** Web (`apps/web/src/app/components/community-lookbook-grid.tsx:3255`, `2951`, `2958`, `2852`; `community-spotlight.tsx:299`) and mobile (`apps/mobile/src/features/community/community-screen.tsx:1240`, `931`, `852`) replaced post objects without checking `textRevision`, allowing an in-flight target resolve or feed read started before a save to revert displayed text back to an older revision.
2. **Screening inside the 7-second privacy transaction:** `CommunityRepository.editPublishedPostText` (`apps/api/src/modules/community/community.repository.ts:840-896`) awaited `screen()` inside `communityPrivacyTransaction` while holding member advisory and post row locks under the 7s timeout.
3. **Missing distinct outcome feedback & `"Edited"` label:** Web and mobile `CommunityPostTextEditor` collapsed `400` screening rejection and `503` screening unavailable into `editFailed`, gave no saved confirmation or `"No changes"` feedback on unchanged revision replies, and neither card nor detail rendered an `"Edited"` badge for `textRevision > 0`.

## Boundaries & Constraints

**Always:**

- Preserve owner-only `textRevision` visibility (`isSelf && isPubliclyVisiblePost(post)`) so existing contract and privacy tests remain unchanged.
- Keep `assertCommunityDatabaseAccess`, `guardCommunitySubject`, `pg_advisory_xact_lock`, `guardCommunityPost`, `SELECT ... FOR UPDATE`, ownership, public visibility, revision, quota, and screening binding checks inside `communityPrivacyTransaction` before commit.
- Never invoke screening for requests that already fail pre-flight eligibility, consent, sanction, ownership, revision, unchanged, or hourly-quota checks.
- Keep approved text visible on card/detail and retain attempted text in the editor on screening rejection (`400`), screening unavailable (`503`), stale revision (`409`), rate limit (`429`), or generic failure.
- Localize all new user-facing copy across all 10 web and 10 mobile locales.

**Never:**

- Do not change the HTTP wire schema keys of `communityFeedItemSchema` or `editCommunityPostTextResponseSchema` (avoid unnecessary OpenAPI/Pact churn).
- Do not weaken or remove existing assertions in `moderation-sanctions.service.spec.ts`, `community-sync-http.integration.spec.ts`, `community-post-text.api.spec.ts`, or `community-post-text.spec.ts`.

## I/O & Edge-Case Matrix

| Scenario                                | Input / State                                                                                                  | Expected Output / Behavior                                                                                                                                                 | Error Handling |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Title-only, caption-only, combined edit | Valid changed text with matching `baseRevision`                                                                | Commits `textRevision + 1`, updates card & detail immediately with `"Edited"` label, shows saved feedback, persists across reload and second client                        | No error       |
| Unchanged payload                       | Normalized `(title, caption)` equals persisted post with matching `baseRevision`                               | Returns `200` with unchanged `textRevision`, does not consume edit quota or run screening, UI shows `"No changes"`                                                         | No error       |
| Rejected by screening                   | Text fails `screenPostText`                                                                                    | `400` `COMMUNITY_POST_TEXT_REJECTED_MESSAGE`, writes `post_text_withheld`, leaves approved text visible, keeps editor draft, shows distinct screening-rejected alert       | `400`          |
| Screening unavailable                   | `screenPostText` throws                                                                                        | `503` `COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE`, nothing committed, leaves approved text visible, keeps editor draft, shows distinct screening-unavailable alert | `503`          |
| Stale revision                          | `baseRevision !== post.text_revision`                                                                          | `409` `COMMUNITY_POST_TEXT_CONFLICT_MESSAGE`, leaves approved text visible, keeps editor draft, shows stale-revision alert                                                 | `409`          |
| Revocation during screening             | Guardian revokes consent while `screen()` awaits                                                               | Lock recheck inside transaction throws `403` `COMMUNITY_AGE_GATE_DENIED_MESSAGE`, post remains `consent_suspended` with prior text & revision                              | `403`          |
| Competing edit during screening         | Concurrent edit commits `text_revision + 1` while `screen()` awaits                                            | Lock recheck inside transaction throws `409` `COMMUNITY_POST_TEXT_CONFLICT_MESSAGE`, competing edit stays intact                                                           | `409`          |
| Stale resolve/feed after save           | In-flight `targets/resolve` or `loadFeed` with `textRevision: 0` lands after `onTextSaved` (`textRevision: 1`) | `reconcileCommunityPostText` preserves newer `title`, `caption`, and `textRevision` across feed, detail, deep-link, and spotlight                                          | No overwrite   |

</intent-contract>

## Code Map

- `packages/api-client/src/contracts/http/community.ts` -- shared message constants (`COMMUNITY_POST_TEXT_CONFLICT_MESSAGE`, `COMMUNITY_POST_TEXT_REJECTED_MESSAGE`, `COMMUNITY_POST_TEXT_SCREENING_UNAVAILABLE_MESSAGE`) and `reconcileCommunityPostText` helper
- `apps/api/src/modules/community/community-post-text.ts` -- `normalizePostText`, `ScreenedPostTextDecision`, and bound `screenPostText`
- `apps/api/src/modules/community/community.service.ts` -- `editPostText` delegating normalized bound screening to repository
- `apps/api/src/modules/community/community.repository.ts` -- `editPublishedPostText` running read-only pre-flight + screening before `communityPrivacyTransaction` and rechecking all locks/invariants/binding inside transaction
- `apps/web/src/app/components/community-post-text-editor.tsx` -- 5 distinct outcome messages (using CC-7.1 `useStatusBar()` + inline status fallback) and unchanged `"No changes"` handling
- `apps/web/src/app/components/community-lookbook-grid.tsx` -- `"Edited"` label on `LookbookCardContent` and `LookbookDetailDialog`, plus `reconcileCommunityPostText` on `apply`, `loadFeed`, `revalidateHighlighted`, `refreshFeed`, and `onTextSaved`
- `apps/web/src/app/components/community-spotlight.tsx` -- `reconcileCommunityPostText` in `refreshItem`
- `apps/mobile/components/community/community-post-text-editor.tsx` -- 5 distinct outcome messages + CC-7.1 `useStatusBar()` + inline fallback
- `apps/mobile/components/community/community-card.tsx` -- `"Edited"` label on card header
- `apps/mobile/src/features/community/community-screen.tsx` -- `reconcileCommunityPostText` in `apply`, `loadFeed`, `revalidateHighlighted`, and `updateSavedText`
- `apps/mobile/src/features/community/use-community-spotlight.ts` -- reuse `reconcileCommunityPostText` in `applyPost`
- `apps/web/src/i18n/locales/*.json` & `apps/mobile/assets/locales/*.json` -- 10-locale keys for `community.card.edited`, `community.compose.editSaved`, `community.compose.editNoChanges`, `community.compose.editRejected`, `community.compose.editScreeningUnavailable`

## Tasks & Acceptance

**Execution:**

- [ ] `packages/api-client/src/contracts/http/community.ts` -- export post-text error constants and `reconcileCommunityPostText`, then rebuild `@couture/api-client` dist
- [ ] `apps/api/src/modules/community/community-post-text.ts`, `community.service.ts`, `community.repository.ts` -- move screening before `communityPrivacyTransaction` with normalized text/locale/policyVersion binding and full locked rechecks
- [ ] `apps/web/src/app/components/community-post-text-editor.tsx`, `community-lookbook-grid.tsx`, `community-spotlight.tsx` -- add distinct outcome messages, CC-7.1 status bar confirmation, `"Edited"` label on card & detail, and monotonic `textRevision` reconciliation
- [ ] `apps/mobile/components/community/community-post-text-editor.tsx`, `community-card.tsx`, `apps/mobile/src/features/community/community-screen.tsx`, `use-community-spotlight.ts` -- mirror distinct outcome messages, CC-7.1 status bar feedback, `"Edited"` label, and monotonic `textRevision` reconciliation
- [ ] `apps/web/src/i18n/locales/*.json`, `apps/mobile/assets/locales/*.json` -- add localized strings across all 10 locales
- [ ] Tests (`packages/api-client/testing/`, `apps/api/integration/community-post-text-http.integration.spec.ts`, `apps/web/src/app/components/community-lookbook-grid.edit-text.test.tsx`, `apps/mobile/components/community/community-post-text-editor.test.tsx`, `apps/mobile/src/test-utils/community-screen/publishing.cases.tsx`, `playwright/tests/community-post-text.spec.ts`) -- cover all ACs including revocation/competing edit during screening, stale-revision reconciliation, all 5 outcome messages, `"Edited"` label, and phone-width reload readback
- [ ] `_bmad-output/project-knowledge/learning-path-step-by-step.md` -- move Step 61 to merged and add Step 62 with test cross-links

**Acceptance Criteria:**

- Given a published community post at phone width (`390x844`), when the author saves title-only, caption-only, and combined edits, then each PATCH returns `200` with incremented `textRevision`, card and detail immediately show the updated text with an `"Edited"` label and saved confirmation, and reload + second browser context show the persisted text without stale reads overwriting a newer revision.
- Given an unchanged edit payload, when the author saves, then `textRevision` stays unchanged and the UI shows `"No changes"`.
- Given screening rejection (`400`), screening unavailable (`503`), or stale revision (`409`), when the author saves, then each renders its own distinct message while leaving approved text visible and retaining the attempted draft in the editor.
- Given screening runs before the privacy transaction, when guardian consent is revoked or a competing edit commits while screening is in flight, then the locked transaction rechecks eligibility, sanctions, ownership, visibility, revision, quota, and screening binding and refuses the stale/revoked write cleanly.

## Implementation Notes

- AC 1 phone-width reproduction run on 2026-11-22 against isolated pg17 (`127.0.0.1:54361`) confirmed persistence of title-only, caption-only, and combined edits on clean happy paths, and directly reproduced the missing `"Edited"` label, silent unchanged save (no `"No changes"`), collapsed 400/503 error messages, and unguarded stale-revision reconciliation across web and mobile.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**

- `npm run build --workspace @couture/api-client` -- expected: clean build
- `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54361/postgres" INTEGRATION_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54361/postgres" npx vitest run apps/api/integration/community-post-text-http.integration.spec.ts apps/api/integration/community-sync-http.integration.spec.ts --config apps/api/vitest.integration.config.ts` -- expected: all pass
- `npx vitest run src/modules/moderation/moderation-sanctions.service.spec.ts src/modules/auth/guardian-lock-route-sweep.spec.ts` (in `apps/api`) -- expected: all pass
- `npx vitest run testing/community-contract.spec.ts` (in `packages/api-client`) -- expected: all pass
- `npx vitest run src/app/components/community-lookbook-grid.edit-text.test.tsx` (in `apps/web`, with coverage check) -- expected: all pass
- `npx vitest run components/community/community-post-text-editor.test.tsx` and mobile community screen publishing test (in `apps/mobile`, with coverage check) -- expected: all pass
- `TEST_ENV=local DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54361/postgres" INTEGRATION_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54361/postgres" PLAYWRIGHT_SKIP_DB_RESET=true node scripts/run-with-local-db-env.mjs npx playwright test playwright/tests/community-post-text.spec.ts playwright/tests/api/community-post-text.api.spec.ts --reporter=list` -- expected: all pass
- `tsc --noEmit` in every touched workspace + ESLint `--max-warnings=0` on all touched files -- expected: 0 errors, 0 warnings
