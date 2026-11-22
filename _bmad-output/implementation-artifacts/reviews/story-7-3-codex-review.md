# CC-7.3 Codex review

**Changes requested.** A retry can create duplicate account rows, and native discovery
can strand valid device saves. The import also needs stronger session fencing and cleanup guards.

Reviewed `feat/epic7-story-7-3-import-device-saved-looks-same-member` at `17f358df` against
`origin/main` at `72b685c2`, which is the merge base. Acceptance criteria came from
[epics.md](../../planning-artifacts/epics.md#L852), [epic-7-context.md](../epic-7-context.md),
and the [CC-7.3 specification](../spec-7-3-import-device-saved-looks-same-member.md).

## Correctness findings

### 1. High. Retry keys change for the same legacy source (AC 1, AC 4)

`packages/utils/src/sample-wardrobe/saved-looks.ts:815`,
`packages/utils/src/sample-wardrobe/saved-looks.ts:562`,
`apps/api/src/modules/wardrobe/wardrobe-saved-look.service.ts:460`

The Style key hashes a snapshot and slot category derived from live tags. If the server commits
before the response is lost, a retry after retagging can send a different UUID for the same recipe.
Concurrent mounts with different inventory snapshots can also generate distinct UUIDs. Home keys
likewise include mutable preferences and swaps outside the Home source ID. Copies of one bookmark
with different edits can import twice. The database uniqueness constraint is on member and key,
so it can't deduplicate these requests. Derive the UUID from the legacy source identity and make
import replay stable when reconstructed payloads change. A source-only UUID still needs an explicit
replay rule because the existing endpoint compares payload hashes.

### 2. High. Native discovery misses owned looks and leaves stale files behind (AC 1, AC 4)

`apps/mobile/src/lib/sample-recipe-storage.ts:133`,
`apps/mobile/src/lib/saved-looks.ts:262`,
`apps/api/src/modules/wardrobe/wardrobe.service.ts:611`,
`packages/utils/src/sample-wardrobe/saved-looks.ts:686`

Native Style discovery probes files only for IDs supplied by the caller. Home supplies none and
Closet supplies a filtered inventory capped at the latest 100 garments. An older owned garment can
keep a valid recipe on disk indefinitely. Files for deleted or unowned IDs also miss the terminal
ownership check. Both browser clients discover these keys, but may invent a slot category when the
anchor is omitted from the same inventory. The server can then flag an unchanged garment as
`category_changed`. Enumerate canonical native filenames before reading their contents and resolve
anchor data by the discovered ID. Handle native read errors per file. One thrown `textSync()` currently
rejects all discovery, including other valid files.

### 3. Medium. A superseded session still reads or changes device storage (AC 3, AC 5)

`apps/web/src/lib/saved-looks.ts:191`, `apps/mobile/src/lib/saved-looks.ts:146`,
`apps/mobile/src/lib/sample-recipe-storage.ts:70`,
`apps/mobile/src/lib/sample-recipe-storage.ts:125`

Both importers check identity before submitting a POST. A response that arrives after a switch or
abort can update the acknowledgment set, enter the returned result, and remove or rewrite the
starting member's storage. Mobile discovery also reads values after awaited storage-handle calls
without checking the captured epoch. Check the captured identity after each await and immediately
before reads and mutations. Let the original member resume and obtain an idempotent replay. The new
switch tests currently require the late response to prune the record.
`apps/web/src/lib/saved-looks.test.ts:612`, `apps/mobile/src/lib/saved-looks.test.ts:476`

### 4. Medium. Unrelated 404 and 409 responses delete unacknowledged saves (AC 1, AC 4)

`apps/web/src/lib/saved-looks.ts:165`, `apps/mobile/src/lib/saved-looks.ts:120`,
`apps/api/src/modules/wardrobe/wardrobe-saved-look.service.ts:474`

The terminal checks accept every 404 and 409. An unrelated 404 can erase a device save without an
ownership result. A `409 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` can erase a record whose
reconstructed payload changed since an earlier request. These results are distinct from
`GARMENT_NOT_FOUND` and `SAVED_LOOK_ALREADY_REMOVED`. Match the documented status/code pairs and
retain or explicitly reconcile unresolved conflicts.

### 5. Medium. Cleanup can erase a newer device save (AC 4)

`apps/web/src/lib/saved-looks.ts:208`, `apps/mobile/src/lib/saved-looks.ts:163`

Cleanup prunes the snapshot captured before network requests. A tab still running the prior release
can write another look under the same key while import waits. The completed import then deletes the
whole key or overwrites the new value with an older pending list. Recheck the current bytes before
pruning and preserve any records added or changed after discovery.

### 6. Medium. Home can cancel startup import before it finishes (AC 1)

`apps/web/src/app/components/home-ritual.tsx:229`,
`apps/web/src/app/components/home-ritual.tsx:806`,
`apps/mobile/src/features/preview/member-sample-outfit.tsx:249`,
`apps/mobile/app/(tabs)/index.tsx:894`

The sample component owns the import signal. A successful live outfit load replaces the sample
component, whose cleanup aborts the request and stops the import. A member who lands on Home and
stays there can leave some or all device saves pending until they visit Closet. Tie the migration
to the authenticated session lifecycle so changing Home content doesn't cancel it.

### 7. Medium. Legacy migration blocks existing account reads without a total work limit (AC 1)

`apps/web/src/lib/saved-looks.ts:408`, `apps/mobile/src/lib/saved-looks.ts:383`,
`apps/web/src/lib/saved-looks.ts:263`, `apps/mobile/src/lib/sample-recipe-storage.ts:107`

First-page list requests wait for all migration sources, even when the caller asks for one source.
Browser discovery collects matching raw values before parsing, then both clients run serial POSTs
with a deadline per request. The parser caps each string at 8,192 code units and each list at eight entries. There is no
aggregate key, byte, or time budget. Closet and Style refreshes can start overlapping runs, and
error-body parsing happens after the POST deadline wrapper has unwound. Load the account list
independently and put a shared budget and one in-flight migration per session around the work.

### 8. Low. Browser scanners accept noncanonical Style keys (AC 3)

`packages/utils/src/sample-wardrobe/saved-looks.ts:267`,
`apps/web/src/lib/saved-looks.ts:154`, `apps/mobile/src/lib/sample-recipe-storage.ts:114`

The shared parser removes `.json` before checking the canonical key. Web and Expo Web pass the
actual localStorage key, so they can read, import, and delete a suffixed alias that fails the
required round trip. Remove the suffix only at the native filename boundary. The alias still maps
to the parsed owner.

### 9. Low. A stale Home bookmark can open a different outfit (AC 2)

`apps/web/src/app/components/home-ritual.tsx:490`,
`apps/mobile/src/features/preview/member-sample-outfit.tsx:511`,
`packages/utils/src/sample-wardrobe/selector.ts:481`

The inline badge renders, but opening an unresolved bookmark runs the current selector. When the
stored look is ineligible, the selector substitutes the first eligible outfit. The member can see a
different outfit from the one selected in the saved list. Show the stored account composition or
explain why the look can't reopen. The Closet detail copy also attributes all review states to tag
changes, including catalog-only Home looks.
`apps/web/src/app/wardrobe/saved-looks-row.tsx:681`,
`apps/mobile/src/features/wardrobe/saved-looks-row.tsx:716`

### 10. Low. The unresolved fallback can discard valid legacy data (AC 2, AC 4)

`packages/utils/src/sample-wardrobe/saved-looks.ts:446`,
`packages/utils/src/sample-wardrobe/saved-looks.ts:502`,
`packages/utils/src/sample-wardrobe/saved-looks.ts:764`,
`packages/api-client/src/contracts/http/saved-looks.ts:130`

Both parsers discard an entire array over eight entries, including otherwise valid rows alongside an
invalid extra entry. Preserve valid siblings within the work budget or keep the file for recovery.
Separately, if a future catalog has neither the retired Home look nor any eligible fallback, a valid
bookmark with no swaps produces zero composition slots. The API rejects it and the importer prunes
the row. Every supported Home filter and comfort combination had a selection in the current catalog.
The missing branch matters when the catalog changes, which is the case AC 2 is meant to handle.

## Verification findings

- **Medium. The browser case can't repeat on a retained database.** The test reuses a seeded
  member, garment, and legacy inputs. Cleanup soft-deletes the saved rows, which keeps their
  deterministic keys. A repeat run returns three 409 responses and records zero successful
  imports. Use an isolated fixture per run or clean up its rows and idempotency records.
  The reload check also reads the POST response set immediately after opening the panel. Assert the
  settled account list and its exact row IDs after reload.
  `playwright/tests/saved-looks-follow-account.spec.ts:328`, `:465`, `:504`, `:510`
- **Medium. Critical behavior is outside the current assertions.** Switch tests use SDK mocks that
  ignore credentials, the native test supplies both owned IDs through inventory, and retry tests use
  Home records. Add a distinct bearer for each member, a same-member re-entry with a new epoch, an
  owned native file absent from the inventory page, and a lost Style acknowledgment followed by a
  retag. The browser case uses a missing garment and another member's storage keys. It does not sign
  in as that second member or use a garment that the second member actually owns.
  `apps/web/src/lib/saved-looks.test.ts:36`, `:536`,
  `apps/mobile/src/lib/saved-looks.test.ts:37`, `:415`,
  `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.test.tsx:1474`,
  `playwright/tests/saved-looks-follow-account.spec.ts:384`
- **Low. Inline badges and strict storage reads are unverified.** New badge assertions cover
  Closet only. Add Home and Style assertions and inspect storage reads as well as surviving bytes
  for guest and other-member data.
  `apps/web/src/app/wardrobe/page.styling.test.tsx:945`,
  `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.test.tsx:1494`

## Codex Security pass

No standalone security finding met the reporting threshold. The pass confirmed local defects in
session fencing, canonical key handling, and availability, as detailed above.
[Codex Security scan report](/private/var/folders/3b/5kzs662j47v6vdz26gbkvlgc0000gn/T/codex-security-scans/couture-cast-epic7/17f358dff0c3_20261122T160458Z/report.md)

- **Shared-device isolation.** Findings 3 and 8 affect the device storage lifecycle and
  canonical key enforcement. POSTs use the pinned bearer, the normal web bridge publishes identity
  with the bearer, and subsequent mobile requests check the original owner and epoch. The web
  unverified-owner exception is limited to the E2E fixture mode. No cross-member API write or
  garment photo disclosure was established. The server derives actor identity from its auth guard
  and checks every wardrobe garment reference against that actor. Catalog slot IDs are metadata
  and do not enter the photo signing path.
  `apps/web/src/lib/web-session.ts:58`, `:289`,
  `apps/mobile/src/lib/saved-looks.ts:296`,
  `apps/api/src/modules/auth/security.guards.ts:92`,
  `apps/api/src/modules/wardrobe/wardrobe-saved-look.service.ts:507`, `:327`
- **Local availability.** Finding 7 is a device-side availability issue. The browser quota
  fallback also reconstructs all keys for each `length` and `key()` call, making the scan quadratic
  in that mode. Native checks size before reading file contents. The API has a 100 KiB JSON body
  limit and a bounded composition schema. The review did not establish a remote service DoS.
  `apps/web/src/lib/browser-persistence.ts:24`,
  `apps/mobile/src/lib/sample-recipe-storage.ts:47`,
  `apps/api/src/bootstrap/configure-app.ts:74`,
  `packages/api-client/src/contracts/http/saved-looks.ts:122`
- **Key and payload controls.** Style uses canonical tuple encoding and exact owner comparison.
  Home raw and encoded aliases coincide for production-generated member IDs. No production
  delimiter or URL-encoding path to another member's key was established. Schema-malformed rows
  fail local validation, while a syntactically valid retired catalog ID can be preserved as
  unresolved. Same-origin storage supplies historical content; it does not prove who authored it.
  The guest key is outside both import namespaces and CC-6.16 carryover has no diff.
  `packages/utils/src/sample-wardrobe/style-one-piece.ts:513`,
  `packages/utils/src/sample-wardrobe/saved-looks.ts:118`, `:221`,
  `packages/db/prisma/schema.prisma:301`
- **Snapshot contract discrepancy.** The spec asks to preserve submitted `anchorSnapshot`. The
  API persists the owned garment's current database tags, which preserves the server trust
  boundary. A client-supplied composition category can still make a caller's own look display
  `category_changed` even when its server snapshot matches. Align the spec and MSW mocks with the
  database authority, treat inferred history as separate metadata if needed, and assert both
  the persisted snapshot and status in the service test.
  `apps/api/src/modules/wardrobe/wardrobe-saved-look.service.ts:445`, `:530`, `:562`,
  `apps/api/src/modules/wardrobe/wardrobe-saved-look.service.spec.ts:595`,
  `apps/web/src/test-utils/saved-looks-msw.ts:106`,
  `apps/mobile/src/test-utils/saved-looks-msw.ts:106`

## Checks run

- Shared utilities, targeted API service, web, and mobile Vitest suites passed all 590 tests
  (493, 10, 44, and 43 respectively). Existing assertions were preserved in the diff.
- All three Chromium tests in `saved-looks-follow-account.spec.ts` passed on a fresh, isolated
  local PostgreSQL database after adding the repository's test auth schema. The CC-7.3 case then
  failed on the same retained database with three 409 responses and zero successful imports.
- `git diff --check origin/main...HEAD` passed. The security pass covered all 22 generated
  source-like worklist files and their relevant dependencies. Security candidate validation used
  static tracing and existing test evidence. Native coverage used the mocked Expo filesystem, with
  no device or emulator run.
