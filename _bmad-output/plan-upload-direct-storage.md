---
title: 'Upload image bytes straight to storage instead of through the API function'
type: 'bugfix'
ticket: ''
created: '2026-11-19'
status: 'built'
baseline_revision: 'f913ce6f2c62f760ac5529a67cbcdf24a3729de4'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 5
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Garment, My Form and palette selfie uploads PUT the image through the API's Vercel
function, which rejects bodies over about 4.49 MB with 413 FUNCTION_PAYLOAD_TOO_LARGE. Web and
mobile encode PNG at up to 2048 px (mobile My Form up to 4096 px), 3 to 9 MB for a real photo, so
Jade's Android Chrome garment upload failed on 2026-11-19.

**Approach:** The upload-url allocations hand out a short-lived Supabase Storage signed upload
URL scoped to the one object path (as community already does); the bucket enforces 10 MiB and
jpeg/png/webp; commit downloads the stored object and verifies it (size, sniffed type, sha256,
dimensions) before any processing. The PUT relay routes are removed. Clients also encode smaller:
JPEG wherever no transparency is needed, WebP when web background cleanup needs alpha.

## Boundaries & Constraints

**Always:** one object per signed URL, no upsert; commit rejects missing, oversized, mistyped or
mismatched bytes and deletes them; guardian upload checks still run at allocate and commit; the
storage URL is used exactly as given by web and mobile (installed mobile builds keep working with
no release because they already PUT to uploadUrl as given); every caller covered: garments,
My Form, palette selfie on web and mobile; community stays storage-direct and gets JPEG/PNG
encoding untouched.

**Never:** squeeze bytes under the cap as the only fix; keep a byte relay through a Vercel
function; widen the bucket limits; change Jade's or any real user's data; edit `playwright/` specs
(upload-tea owns them).

## I/O & Edge-Case Matrix

| Scenario            | Input / State                                 | Expected Output / Behavior                           | Error Handling                   |
| ------------------- | --------------------------------------------- | ---------------------------------------------------- | -------------------------------- |
| Large photo         | 5-9 MB PNG, valid                             | stored directly, commit verifies, garment processing | none                             |
| Commit before bytes | pending_upload, no object                     | 409 UPLOAD_BYTES_MISSING                             | row stays pending, retry allowed |
| Tampered bytes      | object sha/size/type differs from declaration | 4xx mapped validation error                          | object removed                   |
| Expired session     | upload_expires_at past                        | 409 UPLOAD_SESSION_EXPIRED                           | retention sweep removes          |
| Replay allocate     | same idempotency key                          | same session, fresh signed URL for same path         | none                             |
| Legacy row          | bytes_uploaded before deploy                  | commit still accepted and verified                   | none                             |

**Decision (coordinator, 2026-11-19, round 5 C5-3):** a legal hold on a not-yet-committed upload
preserves the staged bytes present when the maintenance job captures them; when two first
transfers overlap on hosted storage the exact generation present at hold start cannot be pinned.
This is accepted as documented residual risk (PR description and deferred-work); no generation
pinning is built. Round 6 is the last review loop.

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/community/community-storage.adapter.ts:33,200` -- reuse pattern: `createSignedUploadUrl`, `signedUploadExpiry` JWT exp check; lift the expiry helper to a shared module.
- `apps/api/src/modules/wardrobe/wardrobe-storage.adapter.ts` -- add `createUploadSession(path)` and `downloadIfPresent(path)` (null on 404) to `WardrobeStorage`; bucket `wardrobe-images` serves all three kinds.
- `apps/api/src/modules/wardrobe/wardrobe.service.ts:340-529,777-850` -- allocation response, `uploadBytes` (delete), commit gate `bytes_uploaded` (:792), `verifyStoredGarment` (:839, reuse).
- `apps/api/src/modules/wardrobe/wardrobe-silhouette.service.ts:262-580` -- allocation (:358), `uploadMyFormBytes` (delete), `commitMyForm` gate (:510) gains download+`verifySilhouettePhoto`.
- `apps/api/src/modules/commerce/palette-advisor.service.ts:356-650` -- same for selfie with `verifyGarmentImage`.
- controllers: `wardrobe.controller.ts:95`, silhouette and palette controllers -- remove PUT relay routes; raw-body middleware for them if any.
- `packages/api-client/src/contracts/http/wardrobe.ts` (+ silhouette, palette contracts, OpenAPI, `src/generated`) -- drop relay operations; keep `uploadGarmentBytes`, `resolveApiUploadUrl` stays harmless.
- `apps/web/src/lib/wardrobe.ts:178` `prepareGarmentImage` -- encode JPEG 0.9 without cleanup, WebP with alpha when cleanup is on (PNG only where the browser cannot encode WebP).
- `apps/web/src/app/components/garment-capture-modal.tsx:357` -- Snap Photo frame as JPEG.
- mobile: `components/wardrobe/garment-capture-modal.tsx:233`, `components/wardrobe/silhouette-editor.tsx:334-352`, `src/features/premium/palette-advisor-screen.tsx:599-620` -- `SaveFormat.JPEG` compress 0.9.
- `scripts/run-maestro.mjs:1455` -- hardcoded relay PUT; switch to uploadUrl.
- `apps/api/src/logger/request-logger.middleware.spec.ts:100` -- route redaction of removed path.
- Working rules: load the bmad-tea skill before editing any test file; never run git stash, git checkout -- or git reset; run tsc and vitest through `npm exec` in each workspace (npm run typecheck/lint rebuild shared dist); never run npx playwright; do not edit `playwright/`; rebuild packages/api-client dist after a contract edit before trusting apps/api tsc. Before any packages/db, apps/api or Playwright run, export an isolated DATABASE_URL and INTEGRATION_TEST_DATABASE_URL on a disposable container port and PLAYWRIGHT_SKIP_DB_RESET=true (coordinator rule 2026-11-19). Never run next build or next dev in this worktree (the test architect's E2E server builds into apps/web/.next), never commit, and test new migrations on a disposable Postgres or Supabase container on a free port, never 127.0.0.1:54322.
- Staging keys: `packages/utils/src/wardrobe-object-path.ts` -- add a staging builder/parser `staging/<uploadSessionId>.<ext>`; `foldername[2]` is null there, so `wardrobe_read_authorized` (migration 20260804180000 :90) denies member reads.
- Member writes: `GarmentItem`, `SilhouetteProfile`, `PaletteProfile` grant authenticated INSERT/UPDATE/DELETE (guardian shared RLS migration :170, silhouette :143, palette :158); no client writes them through PostgREST (grep clean).
- Late-write cleanup sites today: `wardrobe-retention.service.ts:95,214`, `wardrobe-silhouette.service.ts:328` and `deleteMyForm`, palette delete and `palette-analysis.processor.ts:265` `purgeSelfie`; retention runs from `workers/maintenance.scheduler.ts`.
- Rollback predicates: `wardrobe-silhouette.service.ts` commitMyForm enqueue-failure updateMany (~:512), `palette-advisor.service.ts` commitSelfie (~:593).
- Commit error contracts: `packages/api-client/src/contracts/http/wardrobe.ts:954` (garment and My Form commit), `palette-advisor.ts:902` (selfie commit).
- `apps/web/src/lib/community.ts:654` calls `prepareGarmentImage(..., false)`; community must keep the source format (PNG stays PNG, transparency kept).
- `apps/api/src/config/runtime-environment.ts:31` `publicApiUrl` has no runtime caller left.
- Do not touch: bucket size and mime limits, the community upload flow itself.

## Tasks & Acceptance

**Execution:**

- [ ] wardrobe storage adapter + shared signed-upload expiry helper -- signed URL per object, 404-aware download -- unit specs.
- [ ] three services -- allocate returns `{uploadUrl: signedUrl, uploadToken: token, expiresAt: min(session, token)}`; commit accepts `pending_upload|bytes_uploaded`, downloads, verifies, transitions atomically; relay methods removed -- update all inline storage mocks and URL-shape specs.
- [ ] controllers, contracts, OpenAPI, generated client, maestro script -- relay removed everywhere.
- [ ] web and mobile encoders -- JPEG/WebP as above -- unit tests on mime choice.
- [ ] learning path Step 58 production follow-up entry with test cross-links.
- [ ] Final review fixes F-1 to F-7 (Review Triage Log, final review; fix exactly as each row's action says, prove each with a test that fails without it).
- [ ] Round 6, final (see Plan Change Log entry 5 and Design Notes "Round 6 design").
- [ ] Round 5 (see Plan Change Log entry 4 and Design Notes "Round 5 design").
- [ ] Round 4 (see Plan Change Log entry 3 and Design Notes "Round 4 design").
- [ ] Round 3 (see Plan Change Log entry 2 and Design Notes "Round 3 design").
- [ ] Round 2 (see Plan Change Log entry 1): staging keys, commit move, canonical path checks, member-write revoke migration, staging sweep, session rotation on mismatch, rollback predicates, duplicate-PUT reconcile, community encoding preserved, commit error contracts, IMAGE_SIZE_MISMATCH, cache-control, publicApiUrl removal, Step 58 update.

**Acceptance Criteria:**

- Given a 12 MP phone photo on a 412 px phone with cleanup on, when the member taps Use This Image, then the garment uploads, appears in the wardrobe, and no byte PUT goes to `/api/v1`.
- Given Snap Photo with cleanup off, when uploaded, then the stored object is JPEG under 1.5 MB.
- Given My Form and palette selfie photos over 4.5 MB as PNG, when uploaded on web or mobile, then both commit and process.
- Given a stored object that does not match its declaration, when commit runs, then it is rejected and removed.
- Given a garment, My Form or selfie that was deleted, replaced or purged, when a still-live signed URL PUTs afterwards, then no readable or tracked object returns and the staging sweep removes the write.
- Given a row whose path columns name another member's object, when allocate, commit or delete runs, then the service refuses before calling storage, and a member cannot write those columns at all.

## Implementation Notes

- `wardrobe-upload-token.ts` and its spec are deleted: with the relay gone nothing signs or
  verifies the HMAC token, so `WARDROBE_UPLOAD_TOKEN_SECRET` is no longer read (removed from
  `.env.example`; the Vercel value is now unused and harmless).
- The upload-session path normalization in `request-logger.middleware.ts` went with the route;
  query stripping stays.
- Allocation writes the session row, then signs. A signing failure answers 503 and leaves a
  pending row; a same-key retry replays it and signs again, and the retention sweep removes
  rows that are never committed.
- Commit claims are guarded on the session id as well as the status for My Form and selfie, so
  a reallocation between verification and the claim cannot commit the new session's object.
- Web JPEG paints the canvas white before drawing, since JPEG has no alpha.
- The OpenAPI path-param schemas used only by the relay routes are removed from the contracts.
- Round 2: the garment allocation now signs before writing its row (a signing failure leaves
  no row); My Form and selfie sign before their replacing transaction.
- Round 2: the revoke migration also revokes TRUNCATE, which bypasses RLS.
- Round 2: `uploadGarmentBytes` takes `cacheControl` and `acceptExistingObject` as opt-in
  options; wardrobe, My Form and selfie callers pass both, community callers pass neither.
- Round 2: the reallocate, delete and erase paths also remove the old session's staging key,
  and `toResponse` refuses to sign a foreign ready path.
- Round 2: the new commit error schemas are named components (`UploadCommitConflictError`,
  `UploadCommitUnsupportedMediaTypeError`, `UploadCommitUnprocessableError`,
  `SilhouetteCommitConflictError`); the garment commit keeps its generic 409.
- Round 2: `playwright/config/local.config.ts` still sets `PUBLIC_API_URL`, now read by nothing
  (TEA-owned file).
- Round 3 (C2-12 clarification, frozen intent untouched): the 413 is the reproduced mechanism; no
  saved response was correlated to the tester's own attempt.
- Round 3 deviation: owner ids are checked as one safe key segment (`[A-Za-z0-9_-]{1,128}`), not
  as UUIDs. Seeded and k6 accounts (`teen-1`, `premium-active-user`, used by the E2E selfie and
  My Form specs) have readable ids, and an owner id always comes from the verified token or the
  row's owner column, never a member-written field. Session ids and API-allocated garment ids are
  UUID-checked as designed; seeded garments (`teen-1-garment-1`) are only parsed and compared.
- Round 3: the deletion outbox drops, instead of removing, any path still live when it runs: a
  final object a row has committed (or a legacy `bytes_uploaded` relay upload) and any object of a
  garment under legal hold. A compensation or sweep row recorded before a concurrent claim
  therefore never deletes the claimed object. Garment commit compensates only when the row no
  longer holds the session or left `active`; a claim that failed with the session still pending
  leaves the published object for the retry or the sweep.
- Round 3: worker jobs carry an optional `uploadSessionId`. Jobs enqueued before the deploy carry
  none and are fenced on the session the profile holds when the job starts.
- Round 3: client attempts live in memory per tab or app session; sign-out forgets them.
- Round 4: publication claims are columns (`publish_attempt_id`, `publish_started_at` and the
  My Form and selfie equivalents, migration 20261119140000). The lease is the API function's
  `maxDuration` (25 s, `apps/api/vercel.json`) plus 5 min. A claim is released when the attempt
  fails before its publish started; a publish that started and failed keeps it until the lease.
- Round 4: replacement, deletion and erasure lock the profile row (`FOR UPDATE`) after the
  advisory lock, so a publication claim either precedes the read or waits for the transaction.
- Round 4 deviation: the silhouette worker keeps the My Form photo on every outcome (a flagged
  photo stays for moderation), so it has no deletion obligation; only the palette worker writes
  one with its terminal update. Its terminal writes are still fenced on the job's session.
- Round 4: job identity lives in the deterministic job id; producers send only the profile id,
  which every deployed consumer (strict or not) accepts, so worker and API deploy in any order.
  `PaletteProfile.analysis_attempt_id` names the running analysis (the selfie session, or a fresh
  id for a wardrobe analysis); the migration backfills markers and selfie attempts for rows
  already processing.
- Round 4: the enqueue-failure rollbacks on My Form and selfie commits are removed; the handoff
  marker plus replay and the hourly re-enqueue (5 min grace) replace them. The wardrobe analysis
  keeps its rollback, fenced on its own attempt.
- Round 4: each outbox removal is its own transaction (`singleRunTransaction`, added to the
  reviewed callers in `prisma-client.guard.spec.ts`), so one key's fault no longer fails a batch.
- Round 4: when the server ends an attempt for good (an expired, ended or reused session,
  `UPLOAD_BYTES_PRESENT`, or a rejection of bytes an earlier run staged), the same Retry or pick
  starts one fresh attempt at once (new allocation and keys, PUT, commit); a second end in that
  fresh attempt is shown. A rejection of bytes the same run just uploaded is shown without a
  restart. `UPLOAD_IN_PROGRESS` and other ambiguous outcomes keep the attempt and its keys.
- Round 4: `drainDue` takes an optional key scope; the integration suites drain only the rows
  they created, and the hourly job drains everything.
- Round 4: download failures other than the object-not-found code answer 503
  `STORAGE_UNAVAILABLE`; the other adapter failures keep `STORAGE_PERMISSION_DENIED`.
- Round 5: migration 20261119140000 (round 4, not yet deployed) was edited in place for C4-7
  instead of followed by a corrective one: no later migration can tell a backfilled marker from
  a real one. Processing markers stay null; wardrobe analyses get `legacy-wardrobe-analysis`.
  Checked on a disposable Postgres (port 54341) migrated to round 3 with seeded processing rows.
- Round 5 deviation: the outbox's next attempt is the existing `not_before`, so only
  `repeat_until` was added (migration 20261119150000); `next_attempt_at` would duplicate it.
  A caller's immediate removal also runs a repeating row that is not yet due, so a commit's
  compensation of its late publish never waits for the next repeat; the hourly drain still
  honours `not_before`.
- Round 5: the held copy's digest lives in `GarmentItem.held_source_sha256` and
  `held_source_captured_at`; the copy is written with no upsert (`publishOnce`), an existing
  copy is accepted only when its digest matches, and a garment purge removes it.
- Round 5: a garment rejection sets `upload_ended_at` and also `upload_expires_at` to now, so
  the abandoned-upload purge and allocation replay treat it as expired without new predicates.
- Round 5: a garment replay's read is signed inside the row-locked classification
  transaction; a fresh commit's response is read under the lock too and carries no image access
  when the garment left `active` after the transition.
- Round 5: a wardrobe analysis that supersedes a pending selfie clears that selfie session in
  its claim, so the in-flight publisher's own claim fails and compensates as well.
- Round 5 (client): the account epoch lives in the shared `DirectUploadAttemptRegistry`
  (`isCurrent` checks epoch and account, `subscribe`, `bearerFor`); each upload function takes
  the session captured when the picker opened. Mobile My Form resolves its bearer through the
  registry, so the stale `accessToken` prop no longer reaches allocation.
- Round 6 (C5-2): the horizon columns are `publish_cleanup_until`, `my_form_publish_cleanup_until`
  and `selfie_publish_cleanup_until` (migration 20261119160000), written with the claim and
  never cleared by release, takeover or success; they reset only with the session (allocation,
  delete, erase, a rejection), after that path recorded the old keys' repeating removal. A
  rejection after a takeover records the session's keys repeating until the earlier claim's
  horizon. The outbox also turns any one-time removal of a final key into a repeating one when
  its session's horizon is ahead, so the selfie processor, compensation and the sweep are
  covered whoever recorded the row; staging keys never repeat on this account. Keeping the
  horizon on success means a key removed within 24 hours of its claim is removed up to 96 times.
- Round 6 (C5-3, C5-4, C5-5): `held_source_object_path` is the obligation, written in its own
  committed transaction under the garment row lock; the copy is then written and its digest
  recorded in a `singleRunTransaction` (added to the guard spec) that rechecks the hold under the
  same lock and holds it across one upload (30 s timeout). `held_source_capture_outcome` and
  `held_source_checked_at` are the operator-visible state; capture orders by
  `held_source_checked_at` nulls first. A new hourly step, `releaseUnheldCopies`, removes the copy
  of any garment whose hold ended. Operator releases are plain row updates, so they wait on the
  capture's row lock.
- Round 6 (C5-6): orphan analyses get the selfie session as their attempt when the source is a
  selfie, else a fresh UUID (never the legacy id, whose job id may already be retained), under
  an update guarded on status, a null attempt and the revision read.
- Round 6 (C5-7): `processing_deferred_at` records the color worker's hold deferral; the job id
  after a deferral is `<garmentId>__deferred-<ms>`, derived from the row by both the commit
  replay and the maintenance handoff. `WardrobeProcessingQueue` gained the binding seam
  `SilhouettePhotoProcessingQueue` has, so the integration suite runs a real queue under a per-run
  name.
- Round 6 (C5-8): the drain runs at minutes 7, 22, 37 and 52 (every 15 minutes, off the hourly
  jobs' minute 0) and the hourly job no longer drains.
- Round 6: `captureHeldSources`, `releaseUnheldCopies` and `reenqueueStrandedProcessing` take an
  optional member scope, as `drainDue` takes a key scope, so integration suites on a shared
  database touch only their own rows.
- Round 6 (client): the web remover takes the upload session and resolves its bearer through the
  registry; the mobile editor keeps the open tab while it reloads for the new account; the web
  garment errors gained `uploadRestricted` in all ten locales (mobile already showed guardian
  copy only for `GUARDIAN_CONSENT_REQUIRED`).

- Final review (F-1 to F-7): `held_source_cleanup_until` is a new migration
  (20261119170000) instead of an edit of 20261119160000, since a preview database may already
  hold round 6. The release step leaves out garments whose held key already has an outbox row,
  so repeating removals cannot crowd its page. The outbox clears the held key and horizon when
  the removal settles for good. The mobile editor's `accessToken` prop is removed (both hosts
  stop passing it), so no host token can stand in for a verified bearer. The color worker
  retries a hold that flips during one job at most three passes, then fails the job for the
  queue to retry.

## Plan Change Log

1. Review round 1 (upload-codex report upload-codex-review-2.md, quick lens). Triggering findings: signed writes outlive deletion, replacement and selfie purge (2 h token, final path targeted); stale mismatch validation can delete a corrected object; unverified bytes sit in a member-readable folder; service-role storage operations trust member-writable path columns; enqueue-failure rollback clears a newer session; abandoned My Form and selfie sessions keep unverified bytes; community encoding changed. Amended: Code Map, Tasks, ACs, Design Notes (round 2 design). Known-bad states avoided: a deleted private photo reappearing in storage; one member steering service-role storage operations at another member's object; a stale validator deleting a corrected upload. Applied on top of the round 1 tree (no revert: repository rules forbid git checkout/reset, and round 1 is otherwise reviewed and green). KEEP: storage-direct allocation and relay removal, commit-time verification, JPEG/WebP for garment, My Form and selfie, the shared expiry helper, the garment card label (category and material, Untagged when null; Jade-visible raw UUIDs on the same screen, upload-tea finding), all round 1 tests.

2. Review round 2 (upload-codex-review-10.md on aa779e5b). Triggering findings: commit moves a client-written staging object by name, so a newer generation, client metadata and an unbounded download can reach the final object; a crash between move and claim strands the upload; malformed historical ids enter keys; the staging sweep ignores legal hold; selfie erasure races replacement and loses failed deletes; old workers stamp newer sessions; My Form retry re-allocates; null-MIME ready rows lose images; staging readable by admin/moderator claims. Amended: Design Notes (round 3 design), Tasks round 3 line. Known-bad states avoided: publishing bytes other than the verified ones; a held garment's only image deleted; an erased selfie surviving; a ready garment losing its image. KEEP: storage-direct signed PUT, staging keys, commit-time verification, revoke migration, canonical path checks at every service-role call (now parse-and-compare), rollback predicates, community source encoding, commit error contracts, IMAGE_SIZE_MISMATCH, card label, all round 1-2 tests except those the new design replaces (send replaced assertions to Codex).

3. Review round 3 (upload-codex-review-12.md on 692e7052). Triggering findings: an in-flight or duplicate publication lands after purge or erasure with nothing recording it; the selfie worker can lose its deletion obligation; staging signed with upsert lets a held source be overwritten and the outbox liveness check races a new hold; liveness matches path text across tables; a committed profile can sit in processing with no job; legacy jobs adopt a replacement session; a rejected garment session can still win the claim; web retry entry points mint or reuse the wrong keys; attempt caches cross accounts; a missing bucket reads as missing bytes; held objects starve the sweep. Amended: Design Notes (round 4 design), Tasks round 4 line. Known-bad states avoided: an erased or purged photo restored by a late write; a held garment's source overwritten or deleted; one member's attempt replayed under another account. KEEP: everything round 3 built that the round 4 design does not replace: publish of the verified buffer with server metadata, bounded download, staging key shape and read-policy migration, the deletion outbox, uuid and parse-and-compare checks, per-member locks, session-fenced workers, commit-first client retry.

4. Review round 4 (upload-codex-review-13.md on 2d747041). Triggering findings: a picked photo and its confirmation survive an account switch; a rejection after a new hold deletes the held source; wardrobe palette analysis can start after erasure or supersede a selfie publication; reconciliation signs reads before checking retention and can report a false expiry; erasure leaves an already published final readable and settles an ambiguous publisher's cleanup once; overlapping first transfers can replace held staging bytes; the migration marks historical processing rows as delivered; one-tap restart misses the selfie's 400 image codes. Amended: Design Notes (round 5 design), Tasks round 5 line. Known-bad states avoided: one member's photo uploaded under another account; held bytes deleted or replaced; analysis on a revoked profile; a read signed for a held garment; a stranded upgraded row. KEEP: all round 4 mechanisms the round 5 design does not replace.

5. Review round 5 (upload-codex-review-18.md on 7acaff77), escalated at the loop limit; the coordinator approved round 6 and accepted C5-3 as residual risk. Triggering findings: C5-1, C5-2, C5-4 to C5-9. Amended: Design Notes (round 6 design), Tasks round 6 line. KEEP: everything round 5 built except what the round 6 design changes.

6. Final review (upload-codex-review-19.md on fa085a40), final disposition, no further review loop (coordinator): seven round 6 commitments incomplete are fixed in this PR without re-review, per the merge rule (fix the final round in the PR); the two mixed-version follow-ups and C5-3 go to the ready-for-PR report.

## Review Triage Log

Round 1: high 4, medium 9, low 3, false 0, maybe-false 0.

| Finding                                                        | Verdict | Route       | Evidence / action                                                                                                     |
| -------------------------------------------------------------- | ------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| Codex 1 path columns member-writable, service role trusts them | high    | bad_plan    | Local DB grants authenticated I/U/D on all three tables with own-row RLS; canonical path checks plus revoke migration |
| Codex 2 + lens 1 late signed write after delete/replace/purge  | high    | bad_plan    | S-2 shows re-PUT after removal succeeds; staging keys plus commit move plus staging sweep                             |
| Codex 3 stale validation deletes corrected object              | high    | bad_plan    | Mismatch removes by path while session stays open; rotate session on mismatch so a correction uses a fresh key        |
| Codex 4 unverified bytes readable before commit                | medium  | bad_plan    | wardrobe_read_authorized keys on foldername[2] only; staging key has none                                             |
| Codex 5 + rollback race clears newer session                   | medium  | bad_plan    | Rollback predicate is profile id plus status only; add session id and commit key                                      |
| Codex 6 My Form retry after lost PUT ack stalls                | medium  | bad_plan    | No-upsert duplicate aborts the client before commit; treat duplicate as uploaded, commit verifies sha                 |
| Codex 7 + lens 3 community PNG flattened to JPEG               | medium  | bad_plan    | community.ts:654 uses the shared helper with cleanup off; preserve source format there                                |
| Codex 8 storage test sends privileged defaults                 | medium  | patch (TEA) | Routed to upload-tea, playwright/ is TEA-owned                                                                        |
| Codex 9 commit error contracts missing                         | medium  | bad_plan    | My Form conflict schema cannot parse UPLOAD_BYTES_MISSING; register 409/415/422 per commit route                      |
| Codex 10 claims exceed evidence, rollout gap                   | low     | patch       | Record as reproduced cause and document the 15 min in-flight allocation gap in Step 58                                |
| Lens 2 abandoned My Form/selfie sessions keep bytes            | medium  | bad_plan    | No sweep reads my_form/selfie upload expiry; staging sweep covers them                                                |
| Lens 4 card label unplanned                                    | low     | patch       | Recorded in KEEP and Step 58                                                                                          |
| Lens 5 Step 58 cross-links and test list incomplete            | medium  | patch       | upload-tea added comments; update the test list and drop the stale line                                               |
| Lens 6 publicApiUrl dead                                       | low     | patch       | Remove it, its spec and the PUBLIC_API_URL exports that only fed it                                                   |
| Lens 7 cache policy lost                                       | medium  | bad_plan    | Removed adapter upload set private, max-age=0; client PUT sends cache-control                                         |
| Lens 8 diff file omitted generated client, tsconfig noise      | false   | reject      | Generated client excluded on purpose (regenerated output); tsconfig is TEA dev-server noise, restored before commit   |
| TEA: IMAGE_SIZE_MISMATCH mapped to IMAGE_DECODE_FAILED         | medium  | patch       | Commit is now the only byte check; map to 422 IMAGE_SIZE_MISMATCH in all three mappers                                |

Round 2: high 5, medium 6, low 2, false 0, maybe-false 0.

| Finding                                                       | Verdict | Route    | Evidence / action                                                                                                      |
| ------------------------------------------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| C2-1 move publishes an unverified generation                  | high    | bad_plan | move selects source by name (storage v1.32.0 object.ts:470); publish the verified buffer instead                       |
| C2-2 malformed historical ids in keys                         | high    | bad_plan | session/id columns are text and were member-writable; validate uuid, parse-and-compare, retire invalid sessions        |
| C2-3 staging sweep deletes held garments                      | high    | bad_plan | sweep deletes by age only (retention.service.ts:162); make it session-aware and hold-aware                             |
| C2-4 selfie erasure races replacement, loses failed delete    | high    | bad_plan | paths snapshotted outside the per-member lock; delete failure swallowed; lock plus durable deletion outbox             |
| C2-5 crash after move strands upload                          | high    | bad_plan | staging gone, row pending, retry 409; keep staging until claim, idempotent publish                                     |
| C2-6 My Form retry re-allocates, replay re-signs occupied key | medium  | bad_plan | client re-allocates before PUT; no-upsert signing fails on occupied key; commit-first retry and upsert staging signing |
| C2-7 old worker stamps newer session                          | medium  | bad_plan | palette-analysis.processor.ts:331, silhouette-photo.processor.ts:199 status-only updates; fence on session id          |
| C2-8 null-MIME ready rows lose image                          | medium  | bad_plan | read signing requires declaration; seed rows have null mime; parse owner/id with any allowed extension                 |
| C2-9 cache policy uploader-controlled                         | medium  | bad_plan | move copies staging metadata; server publish sets content type and cache-control                                       |
| C2-10 unbounded download before limit                         | medium  | bad_plan | download buffers whole object; bounded stream with a 10 MiB ceiling                                                    |
| C2-11 staging readable by admin/moderator                     | medium  | bad_plan | can_read_shared_user_row allows privileged claims; restrict policy to the wardrobe prefix                              |
| C2-12 evidence overstated                                     | low     | patch    | correct Step 58 wording; record clarification in Implementation Notes (frozen intent untouched)                        |
| C2-13 TEA build dir in tsconfig                               | low     | patch    | restored to 3f02694d content                                                                                           |

Round 3: high 4, medium 7, low 0, false 0, maybe-false 0.

| Finding                                                       | Verdict | Route    | Evidence / action                                                                                                                  |
| ------------------------------------------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| C3-1 late or duplicate publish restores purged/erased photo   | high    | bad_plan | publish runs before any durable ownership; add a publication claim and terminal-deletion reconciliation                            |
| C3-2 selfie worker loses deletion obligation                  | high    | bad_plan | outbox insert after the terminal update and its failure swallowed; record in the same transaction                                  |
| C3-3 held source mutable, liveness races new hold             | high    | bad_plan | upsert staging signing; check-then-delete without a row lock; immutable staging and row-locked deletion                            |
| C3-4 cross-table path alias suppresses erasure                | high    | bad_plan | liveness matches text across tables; derive table, owner and id from the parsed key                                                |
| C3-5 processing without a queued job                          | medium  | bad_plan | storage work between claim and enqueue; durable job handoff with replay and maintenance re-enqueue                                 |
| C3-6 legacy jobs adopt replacement; deploy order              | medium  | bad_plan | identity read from current profile; recover from deterministic job id, tolerant payload schemas, fenced wardrobe-analysis rollback |
| C3-7 rejected garment session still wins claim                | medium  | bad_plan | claim matches pending regardless of expiry; explicit ended state                                                                   |
| C3-8 web retry entry points mint/reuse wrong keys             | medium  | bad_plan | picker mints a new key; My Form reuses an expired key; keep keys while ambiguous, fresh after definitive end                       |
| C3-9 attempt caches cross accounts                            | medium  | bad_plan | fingerprint-only cache; scope to account, fence late completions, single bounded store                                             |
| C3-10 bucket outage reads as missing bytes                    | medium  | bad_plan | 404 statusCode shared; match object-missing code, bound error reads, mid-stream failure to 503                                     |
| C3-11 held objects starve sweep; listing failure blocks drain | medium  | bad_plan | null cursor each run; persist continuation and drain outbox independently                                                          |

Round 4: high 4, medium 5, low 0, false 0, maybe-false 0.

| Finding                                                        | Verdict | Route       | Evidence / action                                                                                                                                 |
| -------------------------------------------------------------- | ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| C4-1 photo and confirmation cross an account switch            | high    | bad_plan    | preview and confirmation outlive the principal; bind to an account epoch, discard stale callbacks, resolve the bearer for that principal          |
| C4-2 rejection after a hold deletes held staging               | high    | bad_plan    | rejection clears the session id unconditionally; ended marker instead, gated on active retention and affected count                               |
| C4-3 palette analysis after erasure, supersedes selfie         | high    | bad_plan    | read-then-update by user id outside the member lock; lock, recheck, atomic claim                                                                  |
| C4-4 signed read after retention change, false expiry          | high    | bad_plan    | two reads and sign before retention check; classify from one locked row, retention before sign or enqueue                                         |
| C4-5 erasure leaves published final readable, one-shot cleanup | medium  | bad_plan    | ambiguous publisher handled by one deferred delete; remove now and repeat until a horizon                                                         |
| C4-6 overlapping first transfers replace held staging          | medium  | bad_plan    | provider admits two first writes (v1.32.0 uploader.ts); snapshot held pending staging to an immutable key when its digest matches the declaration |
| C4-7 migration marks historical rows delivered                 | medium  | bad_plan    | backfill sets the marker; leave it null so handoff recovers, assign legacy attempt ids, legacy jobs reconcile without mutating                    |
| C4-8 selfie 400 image codes miss one-tap restart               | medium  | bad_plan    | classifier keys on 415/422 only; add the selfie's terminal 400 codes                                                                              |
| C4-9 S-5 deep-compares changing fields                         | medium  | patch (TEA) | upload-tea already excludes the read signature; compare stable identity only                                                                      |

Round 5: high 4, medium 4, low 1, false 0, maybe-false 0. Review loop limit reached; escalated to the coordinator before any loopback.

| Finding                                                   | Verdict | Route    | Evidence / action                                                                                                          |
| --------------------------------------------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| C5-1 ready My Form photo survives account switch          | high    | bad_plan | editor keeps A's profile, URL and bearer after the switch; clear and fence on identity change                              |
| C5-2 late write after lease expiry or takeover            | high    | bad_plan | cleanup horizon returned only inside the lease; retain the outstanding write's horizon across expiry, takeover and success |
| C5-3 hold misses the generation present at hold start     | high    | defer    | coordinator accepted as residual risk; mismatch stays operator-visible; deferred-work entry                                |
| C5-4 held copy outlives purge                             | high    | bad_plan | object written before its digest marker; persist the obligation first, coordinate with release and purge                   |
| C5-5 capture starvation                                   | medium  | bad_plan | oldest-twenty query; persistent cursor or fair next-attempt ordering                                                       |
| C5-6 rollout: old instances create unrecoverable analyses | medium  | bad_plan | null attempt rows excluded from recovery; guarded reconcile assigns an attempt                                             |
| C5-7 held garment stuck in processing after release       | medium  | bad_plan | marker set, worker skips held; recover on release                                                                          |
| C5-8 drain cadence hourly                                 | medium  | bad_plan | drain scheduled hourly; schedule every 15 minutes or document                                                              |
| C5-9 consent copy for any 403                             | low     | patch    | reserve guardian copy for explicit consent denial; fix Step 58 upsert wording                                              |

Final review: high 5, medium 2 in scope; 2 follow-ups.

| Finding                                                        | Verdict   | Route  | Evidence / action                                                                                                                                          |
| -------------------------------------------------------------- | --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 web reload reads with the previous bearer                  | high      | patch  | web-session notifies before swapping the bearer; publish identity and credential together, suppress reads after sign-out, AS-3 must show B's known profile |
| F-2 manual conflict Reload bypasses the account guard          | high      | patch  | silhouette-settings-panel.tsx:396 applies getProfile unconditionally; route through the account-bound loader, test A's delayed Reload after B loads        |
| F-3 native editor mounted after sign-out reuses A's prop token | high      | patch  | silhouette-editor.tsx:227 accepts the host token; require a verified current bearer for load and Remove                                                    |
| F-4 held write lands after release settled cleanup             | high      | patch  | capture write inside a 30 s transaction; persist a cleanup horizon before dispatch and repeat removal on release or purge                                  |
| F-5 rehold discards the only cleanup record                    | high      | patch  | release clears the held path; keep it on the garment until removal succeeds, or a blocked obligation                                                       |
| F-6 wardrobe analysis cancels a repeating selfie purge         | medium    | patch  | outbox live verdict on any processing profile; require matching selfie source and attempt, transfer cleanup on transition                                  |
| F-7 release between worker read and deferral strands garment   | medium    | patch  | conditional deferral update hits zero rows; classify and defer atomically or re-read and resume                                                            |
| FU-1 old instance reanalysis keeps stale attempt and marker    | follow-up | report | mixed-version overlap during deploy                                                                                                                        |
| FU-2 running legacy selfie job vs recovery attempt id          | follow-up | report | fresh recovery job identity or let the legacy worker finalize                                                                                              |

## Design Notes

Installed mobile builds PUT to `uploadUrl` as given with Bearer, X-Upload-Token and Content-Type
headers; Supabase signed upload ignores the extra headers and prod storage CORS allows them
(checked 2026-11-19), so the server change alone fixes the field. Commit is where verification
lives because the server no longer sees bytes in flight.

Round 2 design (Plan Change Log 1):

- Signed upload URLs only ever target a staging key `staging/<uploadSessionId>.<ext>` in
  `wardrobe-images`. No member can read it (no owner folder), and no final path is ever signed,
  so deletion, replacement and selfie purge of a final path cannot be undone by a late PUT.
- Commit: derive the staging and final keys from the row (owner, kind, id/session, ext from
  mime) and refuse with a server error before any storage call when stored paths differ; download
  staging, verify, then `move` staging to final (no overwrite), then the guarded DB transition.
  The move is the serialization point: a losing concurrent commit finds no source, rereads the
  row and replays or answers 409 UPLOAD_BYTES_MISSING. A failed transition after the move
  removes the final object. Legacy `bytes_uploaded` rows skip the move.
- Mismatch: remove the staging object and end the session (garment row to an expired/failed
  pending state or cleared profile session, guarded on session id), so a correction needs a fresh
  allocation and a fresh key; a stale validator can only touch a dead session's key.
- Sweep: the hourly wardrobe retention job lists `staging/` oldest first and removes objects
  older than SIGNED_UPLOAD_LIFETIME_MS plus 15 min, covering late writes, abandoned My Form and
  selfie sessions, and failed removals.
- Migration: revoke INSERT, UPDATE, DELETE on the three tables from authenticated and anon and
  drop their write policies (explicit role names; try it on a disposable Supabase first, since
  role statements have crashed supautils before).
- `uploadGarmentBytes`: send `cache-control: private, max-age=0`; treat storage's duplicate
  answer as already uploaded so commit verifies it (sha256 makes this safe).
- Rollback after enqueue failure: predicate adds the original session id and commit key.
- `prepareGarmentImage` gains an explicit encoding choice; community keeps the source format.

Round 3 design (Plan Change Log 2):

- Keys: staging key `staging/<userId>/<kind>/<uploadSessionId>.<ext>` (kind garment, silhouette,
  palette). A migration restricts `wardrobe_read_authorized` to `(storage.foldername(name))[1] =
'wardrobe'`, so no member, guardian, admin or moderator can read staging. Every id that enters a
  key (user, garment, session) must parse as a UUID first; a row whose stored ids or path fail is
  treated as an expired session (allocation replay and commit answer UPLOAD_SESSION_EXPIRED).
  Every service-role call parses the path and compares owner, kind and exact object id; workers
  (color, silhouette photo, palette analysis) also compare the row's own id. Read signing for
  ready rows accepts any allowed extension and needs no MIME (seed rows have none).
- Signing: staging URLs are signed with upsert, so a retried or duplicate PUT overwrites staging and
  replay can always re-sign; nothing trusts staging bytes until commit verifies them.
- Commit: download staging through a bounded stream (abort past MAX_GARMENT_IMAGE_BYTES), verify,
  then the server uploads the verified buffer to the final key itself with the verified content type,
  `cache-control: private, max-age=0` and upsert (the final key is server-only and the bytes match
  the declared sha256, so a retry or concurrent commit writes the same bytes). Then the guarded
  claim. Staging is deleted only after the claim succeeds. A crash anywhere before the claim leaves
  staging in place, so the retry verifies and publishes again. No move.
- Deletion outbox: a new table (object path unique, reason, not_before, attempts, last_error) takes
  every wardrobe-bucket deletion: garment purge, My Form replace and delete, selfie replace, purge
  and erasure, commit compensation, mismatch staging removal, swept staging. Rows are written in the
  same transaction as the state change; the request tries the delete at once and removes the row
  on success; the hourly maintenance job retries due rows with backoff and logs past a threshold.
- Staging sweep: for each staged object older than SIGNED_UPLOAD_LIFETIME_MS plus 15 min, parse
  owner, kind and session; skip it while the owning garment is under legal hold; otherwise enqueue
  the staging key, and also the derived final key when no row references that final key as its
  committed object (covers a crash between publish and a failed claim).
- Selfie erasure and replacement: take the `palette_profile:<userId>` advisory lock before reading
  paths and revoking consent; allocation re-checks consent under the same lock; deletions go through
  the outbox. Same lock discipline for My Form delete and replace (`silhouette_profile:<userId>`).
- Workers: palette analysis and silhouette photo processors write success, failure, retry
  exhaustion and purge stamps with `updateMany` fenced on the job's session id (and status
  processing), so an old job cannot touch a newer session.
- Clients (web and mobile, garment, My Form, selfie): one upload attempt keeps its allocation and
  commit idempotency key across retries; a retry commits first and only re-PUTs on
  UPLOAD_BYTES_MISSING; a lost commit response replays with the same key.
- Docs: Step 58 says the mechanism was reproduced and no response was correlated to the tester's own
  attempt; the client PUT bypasses the function and commit downloads in the function as an outbound
  read; the JPEG classifier note is qualified unless a paired evaluation backs it.

Round 4 design (Plan Change Log 3):

- Publication ownership: before any storage I/O, commit atomically claims the session for
  publication (new columns on the three tables: publish attempt id and publish started at; or an
  explicit `publishing` state), guarded on an unexpired pending session. Only the owning attempt
  downloads, verifies, publishes and moves the row to processing. A losing attempt replays the
  owner's outcome or answers 409 UPLOAD_IN_PROGRESS without touching storage. A publish claim
  older than the function's maximum duration plus margin is stale and may be taken over.
- Terminal deletion vs publication: erasure, purge, replacement and garment deletion take the
  per-member (or per-garment) lock; if a publication is claimed and not finished, they record the
  session's final key in the outbox with `not_before` = claim time + maximum duration + margin, so a
  publish that lands late (or whose acknowledgement was lost) is deleted after it lands. The
  staging marker is kept until then. A second commit after the owner finished never publishes.
- Rejection is an explicit ended state (or the session id is cleared), never "pending with expiry
  now"; the claim requires an unexpired pending session. The legacy `bytes_uploaded` branch stays.
- Immutable staging: sign staging without upsert again (first write wins); a duplicate PUT answer
  is treated as uploaded by the client (commit verifies the sha256). Allocation replay that cannot
  re-sign an occupied key answers 409 UPLOAD_BYTES_PRESENT and the client commits. This keeps a held
  pending garment's source immutable.
- Deletion and holds: the outbox and the staging sweep, for any garment-derived key, lock the
  garment row (`SELECT ... FOR UPDATE`) across the liveness check and the storage removal, so a
  hold applied by an operator waits for or precedes the removal. Liveness parses the candidate key
  and checks only the authoritative row for that table, owner and object id; anything else is not
  live.
- Durable obligations: the palette and silhouette workers write the final-key deletion in the same
  transaction as their guarded terminal update (success, failure, retry exhaustion); an outbox
  insert failure fails the transaction. `selfie_purged_at` means deletion scheduled durably and is
  set in that transaction. Profiles get a job handoff marker like garments
  (`processing_job_enqueued_at`): commit sets processing and enqueues with the deterministic job
  id; replay of a processing row without the marker re-enqueues; the maintenance job re-enqueues
  processing rows whose marker is missing past a grace period.
- Job identity: recover the originating session from the deterministic job id when the payload has
  none; a job whose session differs from the profile's current one exits without mutating
  anything. Payload schemas accept unknown fields (deploy order). The wardrobe-analysis enqueue
  rollback in palette-advisor.service is fenced on its own attempt.
- Sweep: persist the listing continuation across runs (small key-value row) and skip held keys
  without spending the page budget on them repeatedly; drain the outbox in its own step so a
  listing failure cannot block due retries.
- Storage errors: object-missing only on the provider's object-not-found code; bucket-missing and
  other 404s are 503 STORAGE_UNAVAILABLE; error bodies are read with a cap; a mid-stream read
  failure is 503.
- Clients: upload attempts are scoped to the signed-in account id and fenced on session changes
  (auth state change, not only explicit sign-out); one bounded store holds attempts and their
  fingerprints together. Keys are kept while the outcome is ambiguous and replaced with fresh keys
  once the server ends the attempt (expired, rejected, terminal). The palette picker reuses the
  pending attempt for the same photo; My Form Retry mints fresh keys after expiry. Tests go through
  the real Retry button and picker.

Round 5 design (Plan Change Log 4):

- Account epoch (web and mobile, garment, My Form, selfie): capture the signed-in principal and an
  epoch counter before opening a picker or camera; previews, the My Form confirmation and pending
  FileReader or picker callbacks are bound to that epoch and dropped when it changes (auth state
  change, not only sign-out). Allocation resolves the bearer for the captured principal and
  refuses when the current session belongs to someone else. Tests: account switch with the picker
  open, and with A's preview waiting on Retry, per flow.
- Garment rejection: mark the session ended with a new `upload_ended_at` column (keep
  `upload_session_id`, so the outbox still finds the garment), in an update guarded on active
  retention, the claim and the session; record the staging deletion only when that update changed
  one row. The claim requires `upload_ended_at` null. A held garment's staging is never deleted.
- Wardrobe palette analysis: take the `palette_profile` lock, recheck consent and the current
  attempt, and claim atomically; if it supersedes a selfie whose publication is in flight, record
  that publication's keys under its own identity with the lease deferral.
- Commit classification: inside one transaction, lock the row once and classify replay, retention,
  session identity, ended state, expiry and claim from that row; check retention before any read
  signing or enqueue; a released pre-write claim with a valid session is claimable, never expired.
- Ambiguous publisher at erasure or deletion: remove the current final and staging immediately,
  and record an outbox row that repeats the removal every 15 minutes until a horizon of 24 hours
  after the lease start (columns `repeat_until`, `next_attempt_at`), so a remote write that
  completes late is removed whenever it lands; the row is settled only after the horizon.
- Held pending staging: the hourly maintenance job finds pending garments under legal hold whose
  staging exists, downloads it bounded, and when its sha256 matches the declaration copies it to an
  immutable key `held/<userId>/<garmentId>.<ext>` (server write, no upsert) and records the digest;
  a mismatch is logged for the operator. The outbox and sweep treat `held/` keys as never
  removable while the hold lasts.
- Migration: leave the job handoff marker null for historical processing rows so replay and the
  maintenance handoff recover them; give historical wardrobe analyses a known attempt id; a legacy
  job without an attempt only completes a profile whose attempt is that legacy id. Tests: an
  upgraded processing row with no queued job, and a stale job for the same profile.
- One-tap restart: the shared classifier also ends a resumed attempt on the selfie's 400
  IMAGE_CHECKSUM_MISMATCH, IMAGE_DIMENSIONS_INVALID and IMAGE_DECODE_FAILED; web and mobile picker
  tests use the real status and code pairs; a first-run rejection still shows without restart.

Round 6 design (Plan Change Log 5), last loop:

- C5-1: on any identity change the My Form editor (web and mobile) clears the profile, revision,
  signed image URL and any preview, cancels or fences outstanding reads and polls (a late A poll
  is dropped), and enables Remove and Retry only after resolving B's verified bearer; Remove sends
  the bearer and revision of the account that is current. Tests: switch with A's photo ready, and
  with an A poll completing after the switch.
- C5-2: every publication claim records its cleanup horizon (claim start + 24 h) durably, and the
  horizon survives lease expiry, takeover and success (keep the latest horizon per key, never
  shorten). Any terminal removal (erasure, purge, replacement, selfie processor terminal removal,
  garment deletion) consults the recorded horizon for its keys and records a repeating outbox row
  until that horizon, even after the lease expired or the publication succeeded. Tests: erase after
  lease expiry with a write landing afterwards; retry takeover then success then processor
  terminal removal.
- C5-4: capture records the deterministic held key obligation (and MIME) before writing, under the
  garment lock that release and purge also take; purge removes the held key whether or not the
  digest marker exists and clears `held_source_sha256` and `held_source_captured_at` with
  `content_sha256`; reconciliation removes a held object with no live hold. Test: purge between
  write and marker, and a crash after the write.
- C5-3 (accepted residual): a digest mismatch at capture is recorded in operator-visible state
  (a column or log event the operator runbook names), not only a log line.
- C5-5: capture uses a persisted cursor or next-attempt ordering so unavailable rows cannot starve
  later ones. Test two pages with an unavailable first page.
- C5-6: maintenance reconciles processing wardrobe analyses with a null attempt (old producer
  during rollout) under a guarded update that assigns a durable attempt before enqueueing; the stale
  job fence stays. Test an old-producer write after migration then recovery.
- C5-7: a processing garment whose worker skipped it because of a hold is recoverable on release:
  the handoff recovery covers garments, clears or rechecks the enqueue marker, and uses a fresh job
  id when the old one is retained as completed. Test hold, skip, release, completion.
- C5-8: schedule the outbox drain every 15 minutes in `workers/maintenance.scheduler.ts`, separate
  from the hourly sweep and capture, and document eligibility, cadence, batch size and the 24-hour
  bound in Step 58.
- C5-9: guardian copy only for an explicit consent denial code; `WARDROBE_UPLOAD_FORBIDDEN` and other
  403s get neutral restriction copy in all ten locales; fix Step 58's "upsert signing" wording.

## Verification

**Commands:**

- `npm exec --workspace apps/api -- vitest run src/modules/wardrobe src/modules/commerce src/modules/community src/logger` -- green
- `npm exec --workspace packages/api-client -- vitest run` -- green
- `npm exec --workspace apps/web -- vitest run src/lib` and mobile jest for touched files -- green
- `tsc --noEmit` in apps/api, apps/web, apps/mobile, packages/api-client -- clean
- upload-tea's `wardrobe-garment-capture-phone.spec.ts` G-1/G-4/G-5 and size tests, isolated DATABASE_URL, PLAYWRIGHT_SKIP_DB_RESET=true -- red on baseline, green on fix
