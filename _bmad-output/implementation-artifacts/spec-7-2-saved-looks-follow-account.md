---
title: 'CC-7.2: Saved looks follow the account'
slug: 'saved-looks-follow-account'
created: '2026-11-21'
status: 'ready-for-dev'
story_id: 'CC-7.2'
epic_id: 'epic-7'
branch: 'feat/epic7-story-7-2-saved-looks-follow-account'
worktree: '/Users/murat/opensource/cc/couture-cast-epic7'
stepsCompleted: [1, 2]
---

# Tech-Spec: CC-7.2 — Saved looks follow the account

## Overview

### Problem Statement & Red-Phase Reproduction

Today, saving a look in **Style this piece** (`apps/web/src/app/wardrobe/style-piece-panel.tsx`, `apps/mobile/src/features/wardrobe/style-piece-panel.tsx`) writes only to browser `localStorage` (`couturecast.style-piece.*`) or device file storage (`sampleRecipeStorage`), and saving a Home sample look (`apps/web/src/app/components/home-ritual.tsx`, `apps/mobile/src/features/preview/member-sample-outfit.tsx`) writes only to `couturecast.member-sample-bookmarks.<owner>`.

**Verified End-to-End Red Reproduction (`playwright/tests/saved-looks-follow-account.spec.ts`):**
Ran against isolated PostgreSQL 17 (`127.0.0.1:54361`, `PLAYWRIGHT_SKIP_DB_RESET=true`):

1. Context 1 (signed-in seeded member `teen-1`) opened `/wardrobe`, opened `Style this piece` for `teen-1-garment-1`, selected weather `warm-rainy`, swapped shoes to `Loafers`, and clicked Save (`data-save-state="saved"`). Zero API persistence occurred.
2. Context 2 (a second browser context for the same member with `window.localStorage` throwing `DOMException('Storage blocked', 'SecurityError')`) opened `/wardrobe`.
3. Result: FAILED (`Locator: getByTestId('closet-saved-looks-row') Expected: visible -> element(s) not found`). The saved look did not follow the account, and blocked browser storage breaks device-saved persistence entirely.

### Scope Boundaries

- **In scope (CC-7.2):**
  - Account-backed `SavedLook` persistence in PostgreSQL (Prisma schema + migration + RLS + `ON DELETE CASCADE` on `User(id)`).
  - Authenticated REST API under `/api/v1/wardrobe/saved-looks` with strict ownership checks, UUID v4 `Idempotency-Key` replay/conflict handling, strong `ETag` + `If-Match` revision checks, `Cache-Control: private, no-store`, derived availability status (`ready` | `missing_garment` | `needs_review`), and resilient photo signing (never failing when photo/storage is unavailable).
  - Guardian-pending teen parity: guardian-pending teens (not suspended accounts) can read, create, and delete saved looks with the same tap counts as approved members, without bypassing photo-upload or community-posting gates.
  - Shared OpenAPI 3.1 HTTP contracts (`packages/api-client/src/contracts/http/saved-looks.ts`), regenerated SDK, Optic lint pass, and Pact consumer + provider contract tests (following `@seontechnologies/pactjs-utils`).
  - Web & mobile Style this piece and Home sample Save wired to the same account Saved Looks API using CC-7.1 `SaveActionButton` / `StatusFeedbackBar`, working even when `localStorage` is completely unavailable.
  - Temporary **"Saved looks" row at the top of the Closet screen** on web (`apps/web/src/app/wardrobe/page.tsx`) and mobile (`apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx`) until CC-7.12 ships, supporting reopen (exact slot order + swaps), missing garment placeholder, `"Needs review"` state when garment tags change, photo-unavailable rendering, and Remove + Undo.
  - 10-locale translations on web and mobile + parity tests.
  - Playwright E2E proving save, reload, reopen, and remove across a second browser context including blocked `localStorage`, plus native tests proving the same against the API contract.
- **Out of scope (deferred to later stories):**
  - Importing or deleting legacy `localStorage` device-saved lists (that is **CC-7.3**).
  - Dedicated Looks tab (that is **CC-7.12**).
  - Unauthenticated guest preview `/preview` (remains ephemeral/local).

## Acceptance Criteria Mapping

1. **AC 1:** Style this piece saves, reopens, and removes looks through `/api/v1/wardrobe/saved-looks` with ownership and revision (`ETag`/`If-Match`) checks. Each saved look stores stable slot and item IDs, weather preset, `source` (`style_piece` | `home_sample`), optional `anchorGarmentId` + `anchorSnapshot` (`category`, `comfortRange`), and an ordered `composition` snapshot (`slotIndex`, `category`, `kind: 'garment' | 'catalog'`, `itemId`, `label?`) + `swaps` map so reopening reproduces the saved slot order and swaps on web and native.
2. **AC 2:** Save uses CC-7.1 (`SaveActionButton` / `StatusFeedbackBar`). A retry after a lost response reuses the same UUID v4 `Idempotency-Key` and creates exactly one record (`200 OK` replay with matching payload hash; `409 Conflict` on different payload hash).
3. **AC 3:** An authenticated member can save, reload, reopen, and remove looks with `window.localStorage` completely unavailable (`SecurityError` on read/write).
4. **AC 4:** Missing garment -> explicit missing-piece placeholder (`availabilityStatus: 'missing_garment'`, `missing: true` on the affected slot); changed anchor garment tags (`category` or `comfortRange` differs from `anchorSnapshot`) -> `"Needs review"` state (`availabilityStatus: 'needs_review'`). Neither state is silently dropped. Saved looks render cleanly when `imageAccess` is null/expired or object-storage signing fails.
5. **AC 5:** Signed-in Home sample `"Save"` (`home-ritual.tsx` on web, `member-sample-outfit.tsx` on mobile) writes to and reads from the same account `/api/v1/wardrobe/saved-looks` list (`source: 'home_sample'`). Until CC-7.12 ships, saved looks open from a `"Saved looks"` row at the top of Closet on web and mobile.
6. **AC 6:** Playwright proves save, reload, reopen, and remove in a second browser context for the same member, including a context with `localStorage` blocked. Native tests prove save, reopen, missing-garment, needs-review, photo-unavailable, and remove against the API contract.

## Technical Design

### 1. Database Schema & Migration (`packages/db`)

**Migration:** `packages/db/prisma/migrations/20261122040000_add_saved_looks/migration.sql`
**Schema (`packages/db/prisma/schema.prisma`):**

- Enum `SavedLookSource`: `style_piece`, `home_sample`.
- Model `SavedLook` (`@@map("SavedLook")`):
  - `id String @id @default(cuid())`
  - `user User @relation(fields: [user_id], references: [id], onDelete: Cascade)`
  - `user_id String`
  - `source SavedLookSource`
  - `look_id String`
  - `weather String`
  - `title String?`
  - `anchor_garment_id String?` (Intentionally NO FK cascade on `GarmentItem` so deleting a garment preserves the saved look and surfaces the explicit missing-piece placeholder per AC 4; API enforces strict same-owner lookup `where: { user_id, id: { in } }` on every create and read.)
  - `anchor_snapshot Json?` (`{ garmentId: string, category: GarmentCategory, comfortRange: ComfortRange }`)
  - `composition Json` (ordered array of `{ slotIndex: number, category: GarmentCategory, kind: 'garment' | 'catalog', itemId: string, label?: string | null }`)
  - `swaps Json` (`Record<string, string>`)
  - `collection String?`
  - `comfort Json?` (`{ runsColdWarm, windTolerance, precipPreparedness }`)
  - `revision Int @default(0)`
  - `idempotency_key String?`
  - `idempotency_payload_hash String?`
  - `deleted_at DateTime?` (soft-delete tombstone so delayed create retries cannot resurrect a removed look and owner-scoped `/restore` Undo restores the exact original `anchor_snapshot`, `composition`, `missing_garment`, and `needs_review` states)
  - `created_at DateTime @default(now())`
  - `updated_at DateTime @updatedAt`
  - Indexes & unique constraints:
    - `@@unique([id, user_id])`
    - `@@unique([user_id, idempotency_key])`
    - `@@index([user_id, deleted_at, updated_at(sort: Desc), id(sort: Asc)])`
    - `@@index([user_id, source, anchor_garment_id])`
- Add `saved_looks SavedLook[]` to `model User`.
- **Postgres RLS & Grants in migration SQL (API-only table):**
  - `REVOKE ALL ON TABLE public."SavedLook" FROM anon;`
  - `REVOKE ALL ON TABLE public."SavedLook" FROM authenticated;`
  - `ALTER TABLE public."SavedLook" ENABLE ROW LEVEL SECURITY;`
  - All reads and writes go strictly through the NestJS API (`/api/v1/wardrobe/saved-looks`) so moderators, anon, and suspended/missing-profile accounts cannot bypass API ownership, guardian consent, photo-signing, or cache-control rules via direct PostgREST queries.
- **Guardian-pending teens & blocked-storage session boundary:**
  - Under the shipped default policy (`GUARDIAN_CONSENT_POLICY=off`), teens with `pending_guardian_consent` sign in normally and can use saved looks; at the API layer, whenever `canTeenAccess(userId)` is false (e.g. under `required_13_15` or consent revocation), `/api/v1/wardrobe/saved-looks` allows `home_sample` CRUD and listing/removing existing looks with `imageAccess: null` while blocking `style_piece` garment creation and wardrobe photo signing (`403`). Under `required_13_15`, web `/signin` continues to route awaiting teens to the guardian invitation step per Story 4.4 / CC-0.11.
  - When browser `localStorage` is blocked (`SecurityError`), the account saved looks API persists and restores all saved looks without touching `localStorage`; web session persistence itself falls back to in-memory auth (requiring re-authentication after a hard browser reload unless a session bearer is re-established).
- **Account Erasure:** `ON DELETE CASCADE` on `SavedLook.user_id -> User.id`.

### 2. HTTP Contracts, OpenAPI & Pact (`packages/api-client`, `pact/`)

- New contract file: `packages/api-client/src/contracts/http/saved-looks.ts`
  - `savedLookSourceEnum = z.enum(['style_piece', 'home_sample'])`
  - `savedLookAvailabilityStatusEnum = z.enum(['ready', 'missing_garment', 'needs_review'])`
  - `savedLookSlotKindEnum = z.enum(['garment', 'catalog'])`
  - `savedLookCompositionSlotInputSchema`: `{ slotIndex: int 0..11, category: garmentCategoryEnum, kind: savedLookSlotKindEnum, itemId: nonEmptyString max 128, label?: string max 120 nullable optional }` (strict; unique sequential `slotIndex`, at least 1 slot, max 12 slots)
  - `savedLookCompositionSlotSchema` (response): extends input with `missing: z.boolean()`, `imageAccess: garmentImageAccessSchema.nullable()`
  - `savedLookAnchorSnapshotSchema`: `{ garmentId: nonEmptyString max 128, category: garmentCategoryEnum, comfortRange: garmentComfortRangeEnum }` (strict)
  - `savedLookComfortSchema`: `{ runsColdWarm: z.enum(['cold', 'neutral', 'warm']), windTolerance: z.enum(['low', 'medium', 'high']), precipPreparedness: z.enum(['low', 'medium', 'high']) }` (strict)
  - `createSavedLookInputSchema`:
    - `source: savedLookSourceEnum`
    - `lookId: nonEmptyStringSchema.max(64)`
    - `weather: nonEmptyStringSchema.max(32)`
    - `title?: graphemeBoundedText(80).nullable().optional()`
    - `anchorGarmentId: nonEmptyStringSchema.max(128).nullable().optional()`
    - `anchorSnapshot: savedLookAnchorSnapshotSchema.nullable().optional()`
    - `composition: z.array(savedLookCompositionSlotInputSchema).min(1).max(12)`
    - `swaps: z.record(garmentCategoryEnum, nonEmptyStringSchema.max(128)).optional().default({})`
    - `collection: nonEmptyStringSchema.max(32).nullable().optional()`
    - `comfort: savedLookComfortSchema.nullable().optional()`
    - Refinement: when `source === 'style_piece'`, `anchorGarmentId` and `anchorSnapshot` are required and `anchorSnapshot.garmentId === anchorGarmentId`; when `source === 'home_sample'`, `anchorGarmentId` and `anchorSnapshot` must be null/omitted and no composition slot may have `kind === 'garment'`.
  - `savedLookSchema` (response):
    - `id`, `ownerUserId`, `source`, `lookId`, `weather`, `title`, `anchorGarmentId`, `anchorSnapshot`, `composition` (array of `savedLookCompositionSlotSchema` in saved `slotIndex` order), `swaps`, `collection`, `comfort`, `availabilityStatus`, `missingGarmentIds: z.array(nonEmptyStringSchema)`, `needsReviewReasons: z.array(z.enum(['category_changed', 'comfort_range_changed']))`, `revision: z.number().int().min(0)`, `createdAt`, `updatedAt`.
  - `listSavedLooksQuerySchema`: `{ source?: savedLookSourceEnum, anchorGarmentId?: nonEmptyStringSchema.max(128), limit?: coerce int 1..100 default 50, offset?: coerce int >=0 default 0 }`
  - `savedLookIdPathParamsSchema`: `{ savedLookId: nonEmptyStringSchema.max(128) }`
  - Response envelopes: `savedLookResponseSchema` (`{ data: savedLookSchema }`), `savedLookListResponseSchema` (`{ data: z.array(savedLookSchema), total, limit, offset }`).
  - Register `GET /api/v1/wardrobe/saved-looks`, `POST /api/v1/wardrobe/saved-looks`, `GET /api/v1/wardrobe/saved-looks/{savedLookId}`, `DELETE /api/v1/wardrobe/saved-looks/{savedLookId}` in `registerSavedLooksContracts(registry, commonSchemas)` and wire into `openapi.ts` (bump `info.version` to `1.9.0`).
  - Export everything from `packages/api-client/src/contracts/http/index.ts` and `packages/api-client/src/index.ts`.
  - Run `npm run generate:api-client`, `npm run optic:lint`, and `npm run build --workspace @couture/api-client`.
- **Pact (`pact/http/`):**
  - Add `pact/http/consumer/interactions/wardrobe-saved-looks.ts` using `@seontechnologies/pactjs-utils` (`createProviderState`, `setJsonBody`, `setJsonContent`, `zodToPactMatchers`, one `addInteraction()` per `it()`), exported from `api-contract-interactions.ts` and wired in both `web-api-client.pacttest.ts` and `mobile-api-client.pacttest.ts`.
  - Add `pact/http/provider/doubles/saved-looks.ts` and wire state handlers in `pact/http/provider/state-handlers.ts` and `provider-helper.ts`.

### 3. API Implementation (`apps/api`)

- **Guardian-pending teen parity (`apps/api/src/modules/auth/`):**
  - Add `@AllowPendingGuardianTeen()` decorator (`API_ALLOW_PENDING_GUARDIAN_TEEN_KEY`) in `security.decorators.ts`.
  - Add `canTeenAccessNonUploadSurface(userId: string)` to `GuardianConsentStateService` allowing `accountStatus === 'active' || accountStatus === 'pending_guardian_consent'` (still blocking `suspended` or any other non-active status!).
  - Update `RequestAuthGuard` to call `canTeenAccessNonUploadSurface(userId)` when `@AllowPendingGuardianTeen()` is set on the handler/controller.
- **Saved Look service & controller (`apps/api/src/modules/wardrobe/`):**
  - `wardrobe-saved-look.service.ts`:
    - `formatSavedLookETag(savedLookId, revision)` -> `"saved-look:${savedLookId}:${revision}"`.
    - `parseSavedLookIfMatchHeader(ifMatchHeader, savedLookId)` -> 428 if missing, `null` for `*`, expected revision number if matching strong ETag, 412 `SAVED_LOOK_REVISION_MISMATCH` otherwise.
    - `computeSavedLookPayloadHash(input)` -> canonical SHA-256 hex (sorted keys, sorted composition by `slotIndex`, sorted swap keys).
    - `createSavedLook(actor, input, idempotencyKey)`:
      - Validate `source === 'style_piece'` / `'home_sample'` invariants and collect all referenced garment IDs (`anchorGarmentId` + composition slots with `kind === 'garment'`).
      - Verify every referenced garment exists for `actor.userId` with `upload_status === 'ready'` and `retention_status === 'active'`; if any fails, throw `NotFoundException('GARMENT_NOT_FOUND')` (never leaking cross-account garment existence).
      - Verify `anchorSnapshot` matches the current garment's `category` and `comfort_range` or overwrite snapshot from the authoritative DB garment row so clients cannot spoof mismatched snapshots on create! (Using the authoritative DB garment's `category` and `comfort_range` when `anchorSnapshot` matches, or accepting validated snapshot — even better: verify garment has non-null `category` and `comfort_range`, and store the authoritative garment's current `{ garmentId, category, comfortRange }` as `anchor_snapshot`!)
      - Check `(user_id, idempotency_key)` inside transaction (catching `P2002` race on `(user_id, idempotency_key)` and re-reading): same payload hash -> `{ data, isReplay: true }` (`200 OK`); different hash -> `ConflictException('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD')`.
      - Create row with `revision: 0`, return formatted `SavedLookContract` + `{ isReplay: false }`.
    - `listSavedLooks(actor, query)`:
      - Query `SavedLook` strictly with `where: { user_id: actor.userId, ...(source), ...(anchorGarmentId) }`, ordered `updated_at DESC, id ASC`, paginated by `limit` / `offset`, plus `count`.
      - Batch-fetch all referenced `GarmentItem` rows strictly with `where: { user_id: actor.userId, id: { in: allGarmentIds } }`.
      - Sign read URLs via `SupabaseWardrobeStorageAdapter` using `isOwnGarmentObject(garment)` with bounded concurrency (8), catching any signing failure and returning `imageAccess: null` (NEVER throwing 503!).
      - Derive `availabilityStatus`, `missingGarmentIds`, `needsReviewReasons`, and per-slot `missing` / `imageAccess`:
        - Any referenced garment missing or `upload_status !== 'ready'` or `retention_status !== 'active'` -> `missing_garment`, slot `missing: true`, `imageAccess: null`.
        - Else if `source === 'style_piece'` and `anchor_snapshot` present and live garment's `category !== anchor_snapshot.category` or `comfort_range !== anchor_snapshot.comfortRange` -> `needs_review` with `needsReviewReasons` (`category_changed` / `comfort_range_changed`).
        - Else -> `ready`.
    - `getSavedLook(actor, savedLookId)`:
      - Strict `where: { id: savedLookId, user_id: actor.userId }`; throw `NotFoundException('SAVED_LOOK_NOT_FOUND')` if missing; format with same derived status + resilient photo signing.
    - `deleteSavedLook(actor, savedLookId, ifMatchHeader)`:
      - Parse `If-Match` (428 / 412).
      - Find strictly by `{ id: savedLookId, user_id: actor.userId }` -> 404 if not found.
      - If `expectedRevision !== null && existing.revision !== expectedRevision` -> throw `PreconditionFailedException('SAVED_LOOK_REVISION_MISMATCH')`.
      - Atomic conditional delete `deleteMany({ where: { id: savedLookId, user_id: actor.userId, ...(expectedRevision !== null ? { revision: expectedRevision } : {}) } })` -> if `count === 0`, re-check existence and throw 404 or 412.
  - `wardrobe-saved-look.controller.ts`:
    - `@Controller('api/v1/wardrobe/saved-looks')`, `@UseGuards(RequestAuthGuard)`, `@AllowPendingGuardianTeen()`.
    - Validate `Idempotency-Key` as UUID v4 when supplied (400 if empty or non-UUID-v4).
    - Set `ETag` on `POST` and `GET :savedLookId`; return `200` on replay, `201` on create, `204` on delete.
  - Register controller & service in `WardrobeModule`, and add `{ path: '/api/v1/wardrobe/saved-looks{/*path}', method: RequestMethod.ALL }` to `CapsuleCacheHeadersMiddleware` so `Cache-Control: private, no-store` applies to every response including errors!

### 4. Shared Utils (`packages/utils`)

- Add `packages/utils/src/sample-wardrobe/saved-looks.ts` (exported from `packages/utils/src/index.ts`):
  - `createIdempotencyKey(): string` (RFC 4122 UUID v4 using `crypto.randomUUID` with `crypto.getRandomValues` fallback).
  - `buildStylePieceSavedLookInput(garment: StylePieceSelection, look: StylePieceLook): CreateSavedLookInput` (ordered composition: slot 0 = anchor `{ kind: 'garment', itemId: garment.id, category: garment.category }`, followed by companions `{ kind: 'catalog', itemId: item.id, category: item.category }`).
  - `buildHomeSampleSavedLookInput(result: SampleOutfitResult): CreateSavedLookInput | null` (ordered composition from `result.garments` with `kind: 'catalog'`, plus `swaps`, `collection`, `comfort`).
  - `savedLookToStylePieceRecipe(savedLook: SavedLookContract): StylePieceRecipe | null` (extracts `{ lookId, weather, swaps }` for reopening in `StylePiecePanel`, respecting saved slot order & swaps).
  - `savedLookToSampleBookmark(savedLook: SavedLookContract): SampleBookmark | null` (extracts `SampleBookmark` for reopening in `HomeRitual` / `MemberSampleOutfit`).
  - `savedLookMatchesStylePiece(savedLook: SavedLookContract, garmentId: string, look: StylePieceLook): boolean`.
  - `savedLookMatchesHomeSample(savedLook: SavedLookContract, result: SampleOutfitResult): boolean`.
  - Keep unit test coverage >= 99% lines / 100% funcs / 96% branches in `packages/utils`!

### 5. Web & Mobile Clients, Closet Saved Looks Row, Style this piece, Home Sample

- **API clients:**
  - `apps/web/src/lib/saved-looks.ts`: `listSavedLooksFromWeb`, `createSavedLookFromWeb`, `getSavedLookFromWeb`, `deleteSavedLookFromWeb`, `formatSavedLookIfMatch(id, revision)`. Uses `webAuthenticatedFetch` (same pattern as `wardrobe.ts`) with `Idempotency-Key` header on POST and `If-Match` header on DELETE.
  - `apps/mobile/src/lib/saved-looks.ts`: `listSavedLooksFromMobile`, `createSavedLookFromMobile`, `getSavedLookFromMobile`, `deleteSavedLookFromMobile`, `formatSavedLookIfMatch(id, revision)`. Uses `resolveMobileAccessToken()` / bearer token (same pattern as `apps/mobile/src/lib/wardrobe.ts`).
- **Web & Mobile `StylePiecePanel`:**
  - Load saved looks for the current anchor garment via `listSavedLooksFromWeb/Mobile({ source: 'style_piece', anchorGarmentId: garmentId })` (zero `localStorage` or `sampleRecipeStorage` calls!).
  - Maintain a stable `saveAttemptKeyRef` (UUID v4 per `(recipeKey, compositionKey)`): generated once per save attempt, reused across retries of a failed/lost network save, cleared only on confirmed success or when weather/swaps/look changes.
  - Save calls `createSavedLookFromWeb/Mobile` with that `Idempotency-Key`, stores the created `{ id, revision }` for Undo, and invokes optional `onSavedLooksChanged?.()` callback so Closet updates immediately.
  - Undo Save calls `deleteSavedLookFromWeb/Mobile(id, formatSavedLookIfMatch(id, revision))`.
  - Remove calls `deleteSavedLookFromWeb/Mobile(entry.id, formatSavedLookIfMatch(entry.id, entry.revision))`, shows CC-7.1 `"Removed"` notice with `"Undo"` (which re-POSTs the removed payload with a fresh UUID v4 `Idempotency-Key`).
  - Accept optional `initialSavedLook?: SavedLookContract` prop: when opened from Closet's `"Saved looks"` row, immediately sets `weather`, `edits`, `reopened`, and `latestEdit` so the reopened look appears first with exact saved slot order and swaps!
  - Even if `localStorage` throws `SecurityError`, Save, Reopen, and Remove succeed via the account API.
- **Web `HomeRitual` (`apps/web/src/app/components/home-ritual.tsx`) & Mobile `MemberSampleOutfit` (`apps/mobile/src/features/preview/member-sample-outfit.tsx`):**
  - Replace `couturecast.member-sample-bookmarks.<owner>` localStorage/file persistence with `listSavedLooksFromWeb/Mobile({ source: 'home_sample' })`, `createSavedLookFromWeb/Mobile`, and `deleteSavedLookFromWeb/Mobile`!
  - Reuse the same UUID v4 `Idempotency-Key` across retries of a failed save attempt; Undo deletes the created saved look with `If-Match`; Remove + Undo re-POSTs with a fresh `Idempotency-Key`.
  - Works seamlessly when `localStorage` is blocked (`SecurityError`).
- **Closet `"Saved looks"` Row (Web & Mobile):**
  - Web component: `apps/web/src/app/wardrobe/saved-looks-row.tsx` mounted at the top of `<main>` in `apps/web/src/app/wardrobe/page.tsx` (wrapped in `SaveFeedbackProvider` so Remove + Undo feedback uses CC-7.1).
  - Mobile component: `apps/mobile/src/features/wardrobe/saved-looks-row.tsx` mounted at the top of `ScrollView` in `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx` (wrapped in `SaveFeedbackProvider`).
  - Renders collapsible/expandable or directly accessible row (`data-testid="closet-saved-looks-row"` / `testID="closet-saved-looks-row"`) showing count + saved look cards (newest first):
    - Displays weather label, ordered pieces (garment thumbnail if `imageAccess` present, clean styled placeholder if `imageAccess === null` or `missing === true`, `SampleGarmentArt` for catalog items).
    - Shows explicit missing-piece badge/text (`data-testid="saved-look-missing-garment"`) when `availabilityStatus === 'missing_garment'` and `"Needs review"` badge (`data-testid="saved-look-needs-review"`) when `availabilityStatus === 'needs_review'`.
    - Clicking **Reopen** (`data-testid="saved-look-reopen"`):
      - For `style_piece` look whose anchor garment is present in `garments` with a valid photo -> opens `StylePiecePanel` with `initialSavedLook` (exact weather, slot order, swaps).
      - For `style_piece` look whose photo is unavailable, garment is missing, or tags changed (`missing_garment` / `needs_review`), OR for `home_sample` look -> opens a clean **Saved Look Detail Modal** (`data-testid="saved-look-detail-modal"`) displaying the exact saved slot order, weather preset, swaps, explicit missing-piece placeholder / `"Needs review"` notice, and a Remove action.
    - Clicking **Remove** (`data-testid="saved-look-remove"`): deletes via API with `If-Match`, shows CC-7.1 `"Removed"` notice with `"Undo"`.
    - Handles API error cleanly with Retry button (`data-testid="saved-looks-retry"`).
- **Localization:**
  - Add `savedLooks` keys (`title`, `count`, `empty`, `reopen`, `remove`, `missingPiece`, `needsReview`, `photoUnavailable`, `loadFailed`, `retry`, `detailTitle`, `sourceStylePiece`, `sourceHomeSample`, `slotOrderLabel`, `close`) across all 10 web locales (`apps/web/src/i18n/locales/*.json`) and 10 mobile locales (`apps/mobile/src/i18n/locales/*.json`), with parity specs (`apps/web/src/i18n/saved-looks-locales.spec.ts`, `apps/mobile/src/i18n/saved-looks-locales.spec.ts`).

### 6. Testing & Verification Strategy (TEA Mandates)

1. **API Unit & Integration (`apps/api`):**
   - `wardrobe-saved-look.service.spec.ts` & `wardrobe-saved-look.controller.spec.ts` (unit tests with >=95% coverage): ownership enforcement, cross-account garment rejection, `Idempotency-Key` replay (200) & conflict (409), `If-Match` (428 missing / 412 mismatch / `*` / matching ETag), derived `missing_garment` & `needs_review` statuses, storage signing failure resilience (`imageAccess: null`), `Cache-Control: private, no-store`, guardian-pending teen allowed while suspended teen blocked.
   - Integration test against isolated pg17 (`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54361/postgres`): verifies real Postgres migration, `ON DELETE CASCADE` on `User`, unique `(user_id, idempotency_key)`, preserved `SavedLook` after garment deletion (`missing_garment`), and `needs_review` after garment tag edit!
2. **Contract & Pact (`packages/api-client`, `pact/`):**
   - `npm run generate:api-client && npm run optic:lint && npm run build --workspace @couture/api-client`
   - `npm run test:pact` (both consumer determinism + provider verification using `@seontechnologies/pactjs-utils`).
3. **Utils (`packages/utils`):**
   - `packages/utils/src/sample-wardrobe/saved-looks.spec.ts` (100% funcs, >=99% lines/stmts, >=96% branches).
4. **Web & Mobile Unit/Component Tests (`apps/web`, `apps/mobile`):**
   - Update existing `page.styling.test.tsx`, `home-ritual.test.tsx`, `save-feedback.test.tsx`, `wardrobe-hub-screen.test.tsx`, `hero-identity-cache.test.tsx` to mock the account Saved Looks API instead of `localStorage` (note: any assertion changes will be explicitly flagged for the Codex peer review round!).
   - Add dedicated tests:
     - `apps/web/src/lib/saved-looks.test.ts` & `apps/web/src/app/wardrobe/saved-looks-row.test.tsx`
     - `apps/mobile/src/lib/saved-looks.test.ts` & `apps/mobile/src/features/wardrobe/saved-looks-row.test.tsx`
     - Verify save, idempotency retry key reuse, reopen with exact slot order & swaps, missing garment placeholder, `"Needs review"` badge, photo-unavailable rendering, blocked `localStorage`, and remove + Undo on BOTH web and mobile!
   - Run Vitest with coverage check in `packages/utils`, `apps/web`, `apps/mobile`, and `apps/api`.
5. **Playwright E2E (`playwright/tests/saved-looks-follow-account.spec.ts`):**
   - Uses merged fixtures + `@seontechnologies/playwright-utils` (`interceptNetworkCall`, `apiRequest`).
   - Proves end-to-end against real API + DB (`127.0.0.1:54361`, `PLAYWRIGHT_SKIP_DB_RESET=true`):
     - Save a Style this piece look with swaps in Context 1 -> reload / open Context 2 with `localStorage` blocked -> reopen from Closet `"Saved looks"` row with exact swaps -> remove in Context 2 -> verify removed across reload/API!
     - Save a Home sample look -> appears in the same Closet `"Saved looks"` row -> reopen -> remove.
     - Clean up all created saved looks in `finally` via `DELETE /api/v1/wardrobe/saved-looks/:id` (`If-Match: *`).
6. **Typecheck & Learning Path:**
   - `tsc --noEmit` in every touched workspace (`packages/utils`, `packages/api-client`, `apps/api`, `apps/web`, `apps/mobile`, `pact`).
   - Add **Step 60** to `_bmad-output/project-knowledge/learning-path-step-by-step.md`, move Step 59 to merged (`0154d786`, PR #286), and add `// Learning path Step 60:` cross-link comments on all listed tests.
