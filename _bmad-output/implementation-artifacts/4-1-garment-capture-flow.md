---
baseline_commit: 53e9909d40384403ce8ae102ef5f1989601f2a19
---

# Story 4.1: Garment capture flow

Status: ready-for-dev

Updated: 2026-08-04: security, privacy, lifecycle, cross-surface, and test contracts
made implementation-ready after critical review

## Story

As a user,
I want to photograph or upload clothing pieces,
so that CoutureCast can personalize recommendations.

## Scope and product decisions

This story owns the journey from source selection through a verified private image, a committed
`GarmentItem`, and initiation of ADR-014 color processing.

- Upload completion means the final image has been verified in private Supabase Storage, the
  `GarmentItem` has been committed, and its status is `processing`.
- Color analysis completion is asynchronous. The persistent status later becomes `ready` or
  `failed`; a user may leave the screen after the upload reaches `processing`.
- CC-4.2 owns category, material, and comfort tagging. `category` is nullable in CC-4.1 and is
  returned as `null` until CC-4.2 sets it.
- Original filenames are never sent to the API, persisted, logged, or captured in analytics.
- Storage remains private. A public bucket URL must never be generated, persisted, or returned.
- Clients may decode platform-native camera and library formats, including HEIC where supported,
  but they must transcode the final upload to JPEG, PNG, or WebP before requesting an upload URL.
- The final asset extension is derived by the server from the validated MIME type. The server never
  trusts a client-supplied object path or filename.

## Acceptance Criteria

### AC1: Capture source and permission handling

**Scenario: Capture a garment on the web**

Given an authenticated user is eligible to upload wardrobe images
And the browser is in a secure context with an available camera
When the user chooses `Take photo` and grants camera permission
Then the web app opens a live `MediaDevices.getUserMedia` preview
And the user can switch between available front and rear cameras
And capturing a frame advances to the crop screen
And every media track is stopped when the capture UI closes or leaves the camera step.

**Scenario: Import a garment on the web**

Given an authenticated user is eligible to upload wardrobe images
When the user chooses `Choose file`
Then the web file picker accepts JPEG, PNG, and WebP images up to 10 MiB
And a valid selected image advances to the crop screen.

**Scenario: Capture or import a garment on mobile**

Given an authenticated user is eligible to upload wardrobe images
When the user chooses camera or photo library
Then Expo Camera or Expo ImagePicker requests only the permission required for that choice
And a valid result advances to the mobile crop screen.

**Scenario: Camera access is unavailable**

Given camera permission is denied, blocked, dismissed, unsupported, or no camera exists
When camera initialization fails
Then the app shows a localized actionable explanation
And offers file or photo-library import without losing the current wardrobe screen
And does not create an upload session or telemetry completion event.

### AC2: Crop, orientation, and cleanup preview

**Scenario: Adjust the garment image**

Given a valid image has been decoded and normalized for EXIF orientation
When the crop screen opens
Then the user can select a `1:1` or `4:3` aspect ratio
And can pan, zoom, rotate, and reset the crop without moving it outside the source bounds
And web keyboard users can perform equivalent crop adjustments
And the preview clearly identifies the selected aspect ratio.

**Scenario: Preview automatic background cleanup**

Given a valid crop exists
When the cleanup preview finishes successfully
Then the user sees the cleaned result before upload
And can toggle between cleaned and original cropped results
And the confirmed toggle value determines which bytes are uploaded
And cleanup and preview run locally before the user confirms the image
And source bytes do not leave the device during editing.

**Scenario: Cleanup confidence is insufficient**

Given cleanup returns low confidence, an empty mask, more than 95 percent transparent pixels, or a
processing error
When the preview result is evaluated
Then cleanup is switched off
And the original cropped image remains available
And the user receives a localized `cleanup unavailable` message
And the user can upload the cropped original, retry cleanup, or recapture.

**Scenario: Confirm or retry the image**

Given a crop and preview are visible
When the user selects `Use this image`
Then the app prepares and validates the final asset before any upload session is created
And selecting `Retake` or `Choose another` discards the prepared bytes and returns to source
selection.

### AC3: Final asset validation

**Scenario: Validate a final client asset**

Given the user confirms the preview
When the client encodes the final asset
Then source bytes were limited to 10 MiB before bounded decode
And the MIME type is exactly `image/jpeg`, `image/png`, or `image/webp`
And the encoded size is between 1 byte and 10 MiB inclusive
And width and height are each between 256 and 4096 pixels inclusive
And the client calculates a lowercase 64-character SHA-256 hex digest
And the detected signature, decoded content, MIME type, and chosen extension agree.

**Scenario: Reject an invalid asset before upload**

Given the source or final asset is empty, corrupt, oversized, undecodable, animated, has a spoofed
MIME type, exceeds dimension limits, or cannot be transcoded
When validation runs
Then no upload URL is requested
And the user receives a localized error with retry or source-selection guidance.

Server verification in AC6 repeats every security-relevant validation. Client validation is a user
experience optimization and is never a trust boundary.

### AC4: Authorize and allocate a private upload session

**Scenario: Allocate an upload session**

Given a valid authenticated user and a valid final-asset declaration
And wardrobe upload authorization succeeds
When `POST /api/v1/wardrobe/upload-url` is called with a unique idempotency key
Then the server derives the application user ID from `RequestAuthContext`
And generates `garmentId`, `uploadSessionId`, and the canonical object path
And persists a tenant-owned `GarmentItem` in `pending_upload`
And returns a single-use CoutureCast API upload URL and opaque upload token
And the upload capability expires exactly 900 seconds after issuance
And returns the required `content-type` header
And sets `Cache-Control: private, no-store` on the response.

The API upload URL is a consent-aware relay. It requires the user's bearer token plus the opaque
upload token, rechecks session ownership and guardian consent, validates the bytes, and writes the
object to Supabase Storage through the server Storage adapter. The client never receives a Supabase
service credential or Supabase signed upload token.

The canonical object path is:

```text
wardrobe/{appUserId}/{garmentId}.{jpg|png|webp}
```

The extension mapping is `image/jpeg -> jpg`, `image/png -> png`, and `image/webp -> webp`.

**Scenario: Replay upload-session allocation**

Given the same authenticated user repeats the request with the same idempotency key and identical
body while the session remains valid
When the allocation request is handled
Then the same garment, session, upload capability, and expiry are returned
And no duplicate database row is created.

Given the same key is reused with a different body
When the allocation request is handled
Then the API returns `409 IDEMPOTENCY_KEY_REUSED`.

### AC5: Enforce guardian consent for ages 13 through 15

**Scenario: Authorize a user who does not require guardian consent**

Given `RequestAuthGuard` authenticated the request
And the user is not a teen, or the teen is at least 16 years old with an active account
When either wardrobe POST endpoint or the upload relay is called
Then `WardrobeUploadGuard` allows the request.

**Scenario: Authorize an under-16 teen**

Given `RequestAuthGuard` authenticated a teen aged 13 through 15
When either wardrobe POST endpoint or the upload relay is called
Then `WardrobeUploadGuard` calls
`GuardianService.assertWardrobeUploadAllowed(auth.userId, auth.role)`
And `GuardianService` reads birthdate, account state, and active consent from PostgreSQL without
using the 30-second access cache
And the request proceeds only when at least one unrevoked consent record is `granted`.

**Scenario: Consent is absent, stale, or revoked**

Given the user is aged 13 through 15
And active guardian consent is missing or revoked
When an upload URL, byte upload, or garment commit is requested
Then the API fails closed with `403 GUARDIAN_CONSENT_REQUIRED`
And no completion event is emitted
And an existing pending upload becomes inaccessible and is eligible for orphan cleanup.

Missing birthdate, missing profile, age below 13, or an unreadable consent state fails closed with a
stable authorization error. Age is calculated from the persisted birthdate and current UTC date.
Client-supplied age or role values are ignored.

### AC6: Verify storage content and commit idempotently

**Scenario: Upload and commit a valid garment**

Given an unexpired pending upload session owned by the authenticated user
And the final bytes were uploaded using the assigned API upload URL and required headers
When `POST /api/v1/wardrobe/garments` is called
Then the server rechecks wardrobe authorization
And loads the object path, declared metadata, and checksum from the pending server record
And verifies bucket, path, byte size, MIME signature, checksum, dimensions, and successful decode
And rejects animated or multi-frame images
And atomically changes the garment status from `bytes_uploaded` to `processing`
And records `committed_at`, transformation flags, and retention metadata
And ensures one idempotent ADR-014 processing job exists with `jobId = garmentId`
And emits `garment_upload_completed` exactly once
And returns `201 Created` with a short-lived private read URL.

The private read URL expires 900 seconds after response creation, is never persisted, and is
returned only in a `Cache-Control: private, no-store` response.

**Scenario: Retry a completed commit**

Given the same owner repeats a successful commit with the same idempotency key and identical body
When the request is handled
Then the API returns `200 OK` with the same garment record
And does not create a second job or telemetry event.

**Scenario: Verification fails**

Given the uploaded object is absent, in another bucket or path, too large, corrupt, has mismatched
metadata or checksum, or cannot be decoded
When commit verification runs
Then the garment is not moved to `processing`
And the API returns the specific error defined in the API contract
And the invalid object is deleted or quarantined without exposing it to clients
And no completion telemetry is emitted.

Clients cannot submit `userId`, `objectPath`, `fileSizeBytes`, `mimeType`, `checksum`, `category`,
or retention fields to the commit endpoint.

### AC7: Surface truthful upload and processing status

**Scenario: Display upload progress**

Given a confirmed final asset
When the upload flow runs
Then the client uses these states in order:
`preparing`, `requesting_upload`, `uploading`, `verifying`, `processing`
And may then display persisted `ready` or `failed` when ADR-014 processing resolves
And determinate percentage is shown only during byte upload
And allocation, verification, and processing use labeled indeterminate indicators
And the `processing` success message says the garment uploaded and analysis is finishing.

**Scenario: Announce state accessibly**

Given upload state changes
When a major phase starts or resolves
Then web announces localized status through `role="status"` and `aria-live="polite"`
And web errors use `role="alert"` with `aria-live="assertive"`
And mobile uses the shared accessibility announcer and appropriate live-region urgency
And percentage changes are not announced more than once per 10 percent to prevent speech flooding.

### AC8: Retry, cancellation, timeout, and recovery

**Scenario: Retry a transient request**

Given URL allocation, byte upload, or commit returns a network error, timeout, `429`, or `5xx`
When retry policy runs
Then the client makes at most three attempts with delays of 1, 3, and 9 seconds
And reuses the same idempotency key
And never automatically retries other `4xx` responses.

**Scenario: Upload stops making progress**

Given an object upload reports no byte progress for 60 seconds
When the inactivity timeout expires
Then the transfer is aborted
And the UI displays a retry action
And retry reuses the unexpired session or requests a new session after expiry.

**Scenario: Storage upload succeeded but commit failed**

Given object upload completed
And record verification or commit failed transiently
When the user retries
Then the client retries commit before uploading bytes again.

**Scenario: Byte-upload response is lost after server success**

Given the relay stored verified bytes and consumed the upload token
And the client did not receive the `204 No Content` response
When a retry returns `409 UPLOAD_TOKEN_CONSUMED`
Then the client advances to garment commit with the existing session
And does not request another upload URL or resend image bytes.

**Scenario: Storage permission or bucket configuration fails**

Given the server Storage adapter receives a bucket-not-found, authentication, or permission error
When byte upload, verification, read signing, or cleanup runs
Then the operation fails closed with `503 STORAGE_PERMISSION_DENIED`
And the user receives a localized retryable storage error
And an operational alert contains request and environment identifiers without bucket paths,
credentials, tokens, or provider payloads.

**Scenario: The user cancels or leaves**

Given an upload is preparing or transferring
When the user cancels or leaves the flow
Then active camera tracks and network requests are aborted
And no completion event is emitted
And pending records and objects are removed by the orphan policy if the user does not resume.

Upload sessions are not restored after app termination in this story. The user begins a new capture,
and the abandoned session is cleaned up.

### AC9: Apply retention and deletion policy

**Scenario: Retain an active garment**

Given a committed garment belongs to an active account
And required guardian consent remains active
And no deletion or legal-hold event exists
Then `retention_status` is `active`
And source and derived assets remain private and available for requested wardrobe features.

**Scenario: Trigger garment deletion**

Given the user deletes the garment, deletes the account, completes a valid privacy request, or an
aged 13 through 15 user loses the last active guardian consent
When the trigger is recorded
Then access is revoked immediately
And `retention_status` changes to `deletion_pending`
And source objects, derived objects, and palette metadata are queued for purge
And purge completes within 24 hours under normal operation
And failures retry with an operational alert
And the audit record contains only opaque garment identity, trigger, timestamps, and outcome.

**Scenario: A legal hold applies**

Given an authorized compliance workflow applies a legal hold
When deletion would otherwise occur
Then `retention_status` becomes `legal_hold`
And user and guardian reads remain denied
And physical deletion waits for an authorized hold release
And the image, object path, signed URL, and contact data never enter the audit record.

Pending records and uncommitted objects older than 24 hours are purged by an idempotent scheduled
job. Production publication remains gated on legal approval of this policy and related user copy.

### AC10: Enforce telemetry privacy

**Scenario: Emit upload completion telemetry**

Given a garment first reaches `processing`
When telemetry is captured
Then the only event properties are:
`garment_id`, `file_size_bytes`, `mime_type`, `has_cropping`, `has_bg_cleanup`, and `duration_ms`
And the runtime schema rejects unknown properties
And `duration_ms` covers confirmation through successful commit
And the PostHog envelope uses the platform analytics subject identifier rather than email, IP, or
raw authentication claims
And PostHog IP capture is disabled for the event.

**Scenario: Sensitive data reaches a telemetry or logging boundary**

Given any payload or error contains an authorization header, JWT, upload URL, signed token, original
filename, object path, user email, IP address, binary bytes, base64 image, or image data URI
When Pino or PostHog serializes the event
Then centralized redaction removes the sensitive value
And strict telemetry validation rejects properties outside the allowlist
And sanitized sink failures do not fail the user upload.

### AC11: Provide localized, automatable cross-surface controls

**Scenario: Render localized controls**

Given any supported locale is active
When the capture flow renders
Then every visible label, permission explanation, status, and error comes from the exact keys listed
under Mobile and web localization contract
And locale tests fail when any supported catalog lacks a required key.

**Scenario: Automate the mobile flow**

Given the mobile E2E test profile is enabled outside production
When Maestro selects the deterministic fixture source
Then it can complete capture without controlling a native camera or personal photo library
And every interaction and status is addressable through the stable `testID` contract
And the fixture seam cannot be enabled in production builds.

### AC12: Meet quality gates

Given the story implementation is complete
When the change is proposed for merge
Then unit, component, contract, database RLS, Storage RLS, API integration, Playwright, Maestro,
accessibility, Optic, and Pact checks listed in the test matrix pass
And generated OpenAPI and SDK artifacts match the canonical Zod contracts
And no focused, skipped, or flaky garment-capture test remains.

## Tasks / Subtasks

- [x] Task 1: Define the persistence lifecycle and migration (AC: 4, 6, 7, 9)
  - [x] Add Prisma enums `GarmentUploadStatus` with `pending_upload`, `bytes_uploaded`,
        `processing`, `ready`, `failed` and `GarmentRetentionStatus` with `active`,
        `deletion_pending`, `legal_hold`.
  - [x] Make `GarmentItem.category` nullable until CC-4.2.
  - [x] Replace new-use reliance on `image_url` with unique `object_path`; migrate fixtures and
        seeds so no public or signed URL is persisted.
  - [x] Add `upload_session_id`, `upload_idempotency_key`, `file_size_bytes`, `mime_type`,
        `content_sha256`, `width_px`, `height_px`, `upload_status`, `retention_status`,
        `upload_expires_at`, `committed_at`, `consent_checked_at`, `has_cropping`,
        `has_bg_cleanup`, `failure_code`, `deletion_requested_at`, and audit timestamps.
  - [x] Add uniqueness and lookup indexes for object path, upload session, owner/status/expiry, and
        owner/idempotency key.
  - [x] Preserve the established `GarmentItem` RLS policies after schema migration.
  - [x] Add migration and schema tests for null category, lifecycle transitions, constraints, and
        tenant isolation.

- [x] Task 2: Version-control private Storage configuration and policies (AC: 3, 4, 5, 6, 9)
  - [x] Add a Supabase migration for private bucket `wardrobe-images` with 10 MiB limit and JPEG,
        PNG, and WebP allowlist.
  - [x] Add operation-specific `storage.objects` policies from the Storage security contract.
  - [x] Deny direct authenticated INSERT, UPDATE, and DELETE operations; all Storage mutations in
        this story go through the consent-aware API relay or server cleanup worker.
  - [x] Allow reads to the owner, linked guardian at the permitted consent level, and admin or
        moderator actors through existing private helper functions.
  - [x] Keep API and worker Storage credentials server-only and route every mutation through a
        bucket and canonical-path allowlisting adapter.
  - [x] Add local Supabase Storage RLS integration tests with real JWT claims for every role and
        revocation state in the authorization matrix.

- [x] Task 3: Implement fresh wardrobe-consent authorization (AC: 4, 5, 6, 9)
  - [x] Add `GuardianService.assertWardrobeUploadAllowed(userId, role)` using server birthdate,
        active account state, and a fresh active-consent query.
  - [x] Fail closed for missing profile, missing birthdate, under-13 account, and unreadable
        consent.
  - [x] Export `GuardianService` from `GuardianModule` and import `GuardianModule` in
        `WardrobeModule`.
  - [x] Add `WardrobeUploadGuard` after `RequestAuthGuard` on both POST endpoints and the
        byte-upload relay.
  - [x] Recheck consent at commit, independent of the general 30-second teen access cache.
  - [x] Invalidate pending upload sessions and enqueue orphan cleanup when the last required
        guardian consent is revoked.
  - [x] Add unit and integration tests for ages 13, 15, 16, missing birthdate, granted consent,
        the day before and day of the 16th birthday, revocation between allocation and commit, and
        non-teen roles.

- [x] Task 4: Define canonical Wardrobe HTTP contracts (AC: 3, 4, 5, 6, 8)
  - [x] Add strict Zod schemas in `packages/api-client/src/contracts/http/wardrobe.ts`.
  - [x] Apply `.strict()` to every request, success response, error envelope, and telemetry property
        object so generated OpenAPI sets `additionalProperties: false`.
  - [x] Register both POST operations plus the binary PUT relay, security, idempotency header,
        response headers, all success codes, and all error schemas in `openapi.ts`.
  - [x] Export the contracts through the package public entry point.
  - [x] Add a public `@couture/api-client` binary-upload wrapper with injected web and native
        transports, byte-progress callbacks, abort support, bearer and upload-token headers, and
        runtime response validation.
  - [x] Regenerate OpenAPI and SDK artifacts; validate with Optic and Pact.
  - [x] Add parsing tests proving unknown and client-controlled ownership fields are rejected.

- [x] Task 5: Implement the Wardrobe API and Storage adapter (AC: 4, 5, 6, 8)
  - [x] Create feature-first controller, service, repository, storage adapter, module, and tests
        under `apps/api/src/modules/wardrobe/`.
  - [x] Allocate the pending database record before issuing the API upload URL so the Storage
        webhook can always resolve the garment.
  - [x] Generate the path and extension server-side, derive the opaque upload token from the
        server HMAC contract, persist no raw token, and expire the relay capability after 900
        seconds.
  - [x] Add validated `WARDROBE_UPLOAD_TOKEN_SECRET` configuration, `.env.example` documentation,
        and fail-closed startup behavior outside tests.
  - [x] Implement the authenticated binary PUT relay with byte limits, bounded decode, streaming
        upload progress support, fresh consent checks, checksum validation, and no overwrite.
  - [x] Verify stored object bytes and metadata at commit without trusting the client request.
  - [x] Make allocation and commit idempotent under concurrent requests and duplicate taps.
  - [x] Return only a 900-second private read URL; never persist or log it.
  - [x] Map every failure to the standard error envelope and stable error code.

- [x] Task 6: Connect the ADR-014 processing lifecycle (AC: 6, 7, 9)
  - [x] Ensure the Storage webhook resolves the existing `pending_upload` record.
  - [x] Deduplicate webhook and commit races with `jobId = garmentId`.
  - [x] Start processing only after verified commit and persist `processing`, `ready`, or `failed`.
  - [x] Preserve the source image on recoverable analysis failure and expose a safe failure code.
  - [x] Apply the architecture retry policy and prevent duplicate palettes or derived assets.
  - [x] Purge derived assets alongside the source garment under deletion policy.

- [x] Task 7: Implement strict telemetry and logger redaction (AC: 6, 10)
  - [x] Add `garment_upload_completed` to the canonical analytics event enum, strict input and
        provider schemas, tracking wrapper, shared exports, and test assertions.
  - [x] Add the event to `TelemetryPropertiesMap`, validators, and event builders.
  - [x] Remove open-ended `Record<string, unknown>` behavior for this event.
  - [x] Use the platform pseudonymous analytics subject identifier and explicitly disable provider
        IP capture.
  - [x] Add validated, stable-per-environment `ANALYTICS_ID_SECRET` configuration and fail-closed
        startup behavior when garment analytics is enabled.
  - [x] Add Pino redaction paths for authorization, JWTs, upload tokens, upload URLs,
        token-query parameters, object paths, filenames, image data, and nested Storage errors.
  - [x] Normalize the upload relay route to `/api/v1/wardrobe/uploads/:uploadSessionId` before
        request logging so session IDs do not enter logs or traces.
  - [x] Guarantee exactly-once emission by persisting the completion marker in the garment commit
        transaction and dispatching through an idempotent handoff.
  - [x] Test both sink failures and malicious sensitive-field injection.

- [x] Task 8: Implement the responsive web capture experience (AC: 1, 2, 3, 7, 8, 11)
  - [x] Upgrade `apps/web/src/app/wardrobe/page.tsx` while preserving the existing single main
        landmark and server/client boundaries.
  - [x] Build kebab-case files for `GarmentCaptureModal`, `WebCameraCapture`,
        `CanvasImageCropper`, `BackgroundCleanupPreview`, and `GarmentUploadStatus`.
  - [x] Implement secure-context and camera-capability detection with file-picker fallback.
  - [x] Stop media tracks on close, route change, error, and unmount.
  - [x] Normalize orientation, validate decoded pixels, prepare the final asset, and compute
        SHA-256.
  - [x] Run cleanup preview in a worker-backed Canvas helper, detect the AC2 fallback conditions,
        and keep raw source bytes out of network and telemetry boundaries before confirmation.
  - [x] Use an upload transport that exposes real byte progress and supports abort.
  - [x] Use an upload transport that exposes real byte progress and supports abort.
  - [x] Implement the defined state machine, timeout, retry, and commit-first recovery.
  - [x] Support keyboard crop controls, visible focus, focus trap, Escape close, trigger focus
        restoration, and accessible status semantics.
  - [x] Add component tests with MSW and Playwright coverage from the test matrix.

- [x] Task 9: Implement the native mobile capture experience (AC: 1, 2, 3, 7, 8, 11)
  - [x] Install compatible Expo Camera and image-manipulation dependencies and configure iOS and
        Android camera and photo-library permission copy.
  - [x] Upgrade `apps/mobile/app/(tabs)/wardrobe.tsx` and add focused kebab-case feature files.
  - [x] Implement `MobileImageCropper` and `BackgroundCleanupPreview` with the same crop,
        confidence, mask-coverage, toggle, retry, and fallback semantics as web.
  - [x] Handle granted, denied, limited, dismissed, permanently blocked, and settings-return states.
  - [x] Handle iOS HEIC and Android content URIs by transcoding before final validation.
  - [x] Bound decode memory and dimensions before cleanup, preview, or checksum work.
  - [x] Use the shared accessibility announcer with throttled progress announcements.
  - [x] Implement every localization key and stable `testID` from the contracts below.
  - [x] Add a build-gated deterministic image-fixture seam for Maestro; fail production builds when
        the seam is enabled.
  - [x] Add component tests and iOS and Android Maestro coverage from the test matrix.

- [x] Task 10: Implement retention cleanup and operational evidence (AC: 8, 9)
  - [x] Add an idempotent scheduled cleanup for expired sessions and uncommitted objects older than
        24 hours.
  - [x] Add a deletion workflow for garment deletion, account deletion, privacy request, and last
        required-consent revocation.
  - [x] Revoke reads before asynchronous physical deletion begins.
  - [x] Purge source object, derived assets, palette metadata, and sensitive database fields within
        the 24-hour operational target unless legal hold applies.
  - [x] Retry failures and alert operations without recording sensitive paths or image data.
  - [x] Add legal-hold tests and record legal approval as a production-release prerequisite.

- [x] Task 11: Complete quality and security validation (AC: 12)
  - [x] Run the entire test matrix below.
  - [x] Run `npm run verify:changed` and all relevant integration, Playwright, Maestro, Pact, Optic,
        and local Supabase checks.
  - [x] Verify generated artifacts changed only through their canonical generators.
  - [x] Inspect rendered web and mobile flows at supported viewport classes and device text sizes.
  - [x] Confirm no token, URL, path, filename, image, email, IP, or raw auth claim appears in
        captured logs, errors, traces, PostHog payloads, screenshots, or test artifacts.

## Required implementation contract

### POST `/api/v1/wardrobe/upload-url`

Headers:

```http
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>
Content-Type: application/json
```

Strict request body:

```json
{
  "fileSizeBytes": 2048576,
  "mimeType": "image/png",
  "sha256": "b6d81b360a5672d80c27430f39153e2c3f359dd3a214b61213cfa1447d2d73e5",
  "widthPx": 1600,
  "heightPx": 1600
}
```

Constraints:

- `Idempotency-Key`: UUID; required and scoped to authenticated user plus operation.
- `fileSizeBytes`: integer, minimum 1, maximum 10,485,760.
- `mimeType`: enum `image/jpeg`, `image/png`, `image/webp`.
- `sha256`: lowercase hexadecimal, exactly 64 characters.
- `widthPx`, `heightPx`: integers from 256 through 4096.
- Unknown properties are rejected.

`uploadToken` is
`base64url(HMAC-SHA256(WARDROBE_UPLOAD_TOKEN_SECRET, uploadSessionId + "." + auth.userId + "." +
expiresAt))`. It is reproducible for an idempotent allocation replay, never persisted, sent only in
the response body and `X-Upload-Token` header, and invalid after expiry or successful consumption.

`201 Created` response for a new allocation:

```json
{
  "data": {
    "garmentId": "clx123456789",
    "uploadSessionId": "b0e9bf1d-2a18-4d59-bef8-fb559cbb3272",
    "uploadUrl": "https://api.example/wardrobe/uploads/<uploadSessionId>",
    "uploadToken": "<opaque-single-use-token>",
    "requiredHeaders": {
      "content-type": "image/png"
    },
    "expiresAt": "2026-08-04T09:40:00.000Z"
  }
}
```

The same allocation may return `200 OK` for an idempotent replay. Both responses include
`Cache-Control: private, no-store`.

Errors:

- `400 INVALID_UPLOAD_DECLARATION`
- `401 UNAUTHORIZED`
- `403 GUARDIAN_CONSENT_REQUIRED`
- `403 WARDROBE_UPLOAD_FORBIDDEN`
- `409 IDEMPOTENCY_KEY_REUSED`
- `413 IMAGE_TOO_LARGE`
- `415 UNSUPPORTED_IMAGE_TYPE`

### PUT `/api/v1/wardrobe/uploads/{uploadSessionId}`

This operation is the binary upload target returned by `POST /upload-url`. It is registered in
OpenAPI so web and mobile use the generated API client transport.

Headers:

```http
Authorization: Bearer <jwt>
X-Upload-Token: <opaque-single-use-token>
Content-Type: image/jpeg | image/png | image/webp
Content-Length: <1..10485760>
```

The body contains only the encoded image bytes. The operation:

- Loads the session by path parameter and compares the expected HMAC upload token in constant time.
- Verifies authenticated owner, session state, expiry, content length, and fresh guardian consent.
- Streams with a hard 10 MiB ceiling and aborts immediately when the limit is exceeded.
- Computes SHA-256 and verifies it against the pending server declaration.
- Performs bounded decode, MIME signature, animation, and dimension validation.
- Rechecks session and consent immediately before the server Storage adapter writes the object.
- Writes only to the server-owned bucket and canonical path with overwrite disabled.
- Marks the session `bytes_uploaded` without committing the garment or emitting completion
  telemetry.
- Consumes the upload token after success. A replay returns `409 UPLOAD_TOKEN_CONSUMED`.

Success returns `204 No Content` with `Cache-Control: private, no-store`.

Errors:

- `400 INVALID_UPLOAD_BODY`
- `401 UNAUTHORIZED`
- `401 INVALID_UPLOAD_TOKEN`
- `403 GUARDIAN_CONSENT_REQUIRED`
- `403 WARDROBE_UPLOAD_FORBIDDEN`
- `404 UPLOAD_SESSION_NOT_FOUND`
- `409 UPLOAD_SESSION_EXPIRED`
- `409 UPLOAD_TOKEN_CONSUMED`
- `413 IMAGE_TOO_LARGE`
- `415 UNSUPPORTED_IMAGE_TYPE`
- `422 IMAGE_CHECKSUM_MISMATCH`
- `422 IMAGE_DECODE_FAILED`
- `422 IMAGE_DIMENSIONS_INVALID`
- `503 STORAGE_UNAVAILABLE`
- `503 STORAGE_PERMISSION_DENIED`

### POST `/api/v1/wardrobe/garments`

Headers:

```http
Authorization: Bearer <jwt>
Idempotency-Key: <uuid>
Content-Type: application/json
```

Strict request body:

```json
{
  "garmentId": "clx123456789",
  "uploadSessionId": "b0e9bf1d-2a18-4d59-bef8-fb559cbb3272",
  "hasCropping": true,
  "hasBgCleanup": true
}
```

`201 Created` response after the first successful commit:

```json
{
  "data": {
    "id": "clx123456789",
    "status": "processing",
    "category": null,
    "fileSizeBytes": 2048576,
    "mimeType": "image/png",
    "retentionStatus": "active",
    "createdAt": "2026-08-04T09:25:00.000Z",
    "committedAt": "2026-08-04T09:26:22.000Z",
    "imageAccess": {
      "url": "https://example.supabase.co/storage/v1/object/sign/...",
      "expiresAt": "2026-08-04T09:41:22.000Z"
    }
  }
}
```

An identical committed replay returns `200 OK`. Both responses include
`Cache-Control: private, no-store`.

Errors:

- `400 INVALID_GARMENT_COMMIT`
- `401 UNAUTHORIZED`
- `403 GUARDIAN_CONSENT_REQUIRED`
- `403 WARDROBE_UPLOAD_FORBIDDEN`
- `404 UPLOAD_SESSION_NOT_FOUND`
- `409 IDEMPOTENCY_KEY_REUSED`
- `409 UPLOAD_SESSION_EXPIRED`
- `409 UPLOAD_ALREADY_CLAIMED`
- `413 IMAGE_TOO_LARGE`
- `415 UNSUPPORTED_IMAGE_TYPE`
- `422 IMAGE_CHECKSUM_MISMATCH`
- `422 IMAGE_DECODE_FAILED`
- `422 IMAGE_DIMENSIONS_INVALID`
- `503 STORAGE_UNAVAILABLE`
- `503 STORAGE_PERMISSION_DENIED`

All errors use:

```json
{
  "error": {
    "code": "UPLOAD_SESSION_EXPIRED",
    "message": "This upload expired. Prepare the image again.",
    "requestId": "req_123"
  }
}
```

Production messages may be localized by clients through `code`; server messages never contain an
object path, signed URL, token, filename, user contact field, or Storage provider payload.

## Storage security contract

- Bucket: `wardrobe-images`.
- Visibility: private with `public = false`.
- Maximum object size: 10 MiB.
- MIME allowlist: JPEG, PNG, WebP.
- Authenticated clients have no object INSERT, UPDATE, or DELETE policy in this story.
- The API-owned upload relay uses a server-allocated path, 900-second session, single-use opaque
  token, and overwrite disabled.
- Signed read URLs are created only after authorization and expire after 900 seconds.
- `auth.uid()` is not compared directly with `GarmentItem.user_id` or path user IDs. The app uses
  `private.current_app_user_id()` because Supabase Auth subjects and application IDs differ.

Required authenticated read policy:

```sql
CREATE POLICY wardrobe_read_authorized
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'wardrobe-images'
  AND private.can_read_shared_user_row((storage.foldername(name))[2])
);
```

Do not create authenticated INSERT, UPDATE, or DELETE policies for `wardrobe-images`. The API and
cleanup worker use server-only Storage credentials through an adapter that accepts a fixed bucket
and a previously allocated canonical path. Guardian read access follows the established
consent-level policy. Guardian upload or delete access is outside CC-4.1.

Do not use Supabase `createSignedUploadUrl` for this flow. Supabase upload capabilities currently
have a provider-controlled two-hour validity window, which cannot meet the story's 900-second expiry
or fresh consent-revocation guarantee. The API relay is a deliberate ADR-002 refinement; final bytes
still reside only in private Supabase Storage. Reference:
<https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl>.

## Telemetry contract

Event name: `garment_upload_completed`

Strict property schema:

```json
{
  "garment_id": "clx123456789",
  "file_size_bytes": 2048576,
  "mime_type": "image/png",
  "has_cropping": true,
  "has_bg_cleanup": true,
  "duration_ms": 1420
}
```

Constraints:

- `garment_id`: nonempty opaque ID, maximum 64 characters.
- `file_size_bytes`: integer from 1 through 10,485,760.
- `mime_type`: the three-value image MIME enum.
- `has_cropping`, `has_bg_cleanup`: booleans.
- `duration_ms`: nonnegative integer, maximum 86,400,000.
- The property object is strict. Unknown properties are rejected.
- The event emits once when verified commit first reaches `processing`.
- `distinctId` is `base64url(HMAC-SHA256(ANALYTICS_ID_SECRET, auth.userId))`; the secret comes from
  the environment secret store and the raw user ID is never sent to PostHog for this event.
- The PostHog adapter adds provider-control property `$ip: null` after strict product-property
  validation. `$ip` is not accepted from application callers.
- Email, IP, raw user ID, auth claims, filename, object path, public URL, signed URL, token, binary,
  base64, data URI, EXIF, and provider error objects are prohibited.

## Upload state contract

Client states:

```text
idle
  -> selecting
  -> editing
  -> preparing
  -> requesting_upload
  -> uploading
  -> verifying
  -> processing
  -> ready | failed
```

Persistent upload states:

```text
pending_upload -> bytes_uploaded -> processing -> ready | failed
```

Retention states:

```text
active -> deletion_pending -> physically deleted
active -> legal_hold -> deletion_pending -> physically deleted
```

Client errors retain the last safe recoverable phase. Retrying after object upload begins with
commit verification. A new byte upload occurs only when the object is absent, rejected, or its
session expired.

## Mobile and web localization contract

Every supported locale catalog must define:

```text
wardrobe.capture.title
wardrobe.capture.camera
wardrobe.capture.library
wardrobe.capture.retake
wardrobe.capture.choose_another
wardrobe.permission.camera_denied
wardrobe.permission.camera_blocked
wardrobe.permission.library_denied
wardrobe.permission.open_settings
wardrobe.error.camera_unavailable
wardrobe.error.invalid_image
wardrobe.error.corrupt_image
wardrobe.error.image_too_large
wardrobe.error.unsupported_type
wardrobe.error.network_timeout
wardrobe.error.storage_forbidden
wardrobe.error.consent_required
wardrobe.error.upload_expired
wardrobe.crop.title
wardrobe.crop.aspect_square
wardrobe.crop.aspect_four_three
wardrobe.crop.rotate
wardrobe.crop.reset
wardrobe.cleanup.title
wardrobe.cleanup.toggle
wardrobe.cleanup.retry
wardrobe.cleanup.unavailable
wardrobe.confirm.use_image
wardrobe.upload.preparing
wardrobe.upload.requesting
wardrobe.upload.uploading
wardrobe.upload.verifying
wardrobe.upload.processing
wardrobe.upload.ready
wardrobe.upload.failed
wardrobe.upload.retry
wardrobe.upload.cancel
```

English copy is the semantic source. Other locales may use the established English fallback during
development, but the release test requires complete catalog coverage.

## Mobile `testID` contract

```text
wardrobe-screen
garment-capture-open
garment-source-camera
garment-source-library
garment-camera-preview
garment-camera-shutter
garment-permission-error
garment-permission-open-settings
garment-crop-screen
garment-crop-aspect-square
garment-crop-aspect-four-three
garment-crop-rotate
garment-crop-reset
garment-cleanup-preview
garment-cleanup-toggle
garment-cleanup-retry
garment-cleanup-unavailable
garment-confirm-use-image
garment-confirm-retake
garment-upload-progress
garment-upload-status
garment-upload-error
garment-upload-retry
garment-upload-cancel
garment-upload-success
garment-e2e-fixture-source
```

These identifiers are stable public test contracts. Changes require simultaneous Maestro updates.

## Test matrix

### Unit and component tests

- Validate crop bounds, aspect ratios, EXIF orientation, rotation, reset, and keyboard controls.
- Validate cleanup success, low confidence, empty mask, excessive transparency, and thrown errors
  with deterministic image fixtures.
- Validate final byte size, dimensions, MIME signature, decode, animation rejection, and checksum.
- Validate all client state transitions, timeout, cancellation, commit-first retry, idempotency key
  reuse, consumed-token recovery, session expiry, and screen-reader throttling.
- Validate every supported locale contains every required key.
- Validate every mobile interactive state exposes the specified `testID`.

### API, contract, and persistence tests

- Zod tests reject unknown fields, client `userId`, path, filename, category, and retention input.
- Controller tests validate auth, response envelopes, cache headers, status codes, and error
  mapping.
- Service tests validate canonical path allocation, extension mapping, single-use upload-token
  verification, overwrite denial, server-side verification, concurrent idempotency, and sanitized
  provider errors.
- Storage adapter tests map provider authentication, permission, missing-bucket, timeout, and `5xx`
  failures to stable safe errors without leaking provider payloads.
- Guardian tests cover ages 13, 15, and 16, missing birthdate, active consent, revoked consent, and
  revocation between URL issuance and commit.
- Repository tests cover nullable category, ownership, every lifecycle transition, cleanup claims,
  and transaction rollback.
- Pact covers web and mobile consumers for both POST operations and the binary PUT relay.
- Optic validates the generated OpenAPI change.

### Database and Storage RLS tests

- Owner can read only the assigned canonical path after upload through the API relay.
- An unrelated tenant cannot upload, read, update, delete, obtain a read URL, or commit the object.
- Teen aged 13 through 15 with active consent can upload and commit.
- Missing or revoked consent blocks allocation and commit.
- A linked guardian can read only at the required consent level and cannot upload or delete.
- Revoked and unrelated guardians cannot read.
- Admin or moderator access matches the existing role policy and is audited.
- Authenticated clients have no direct Storage mutation policy and cannot overwrite an object.
- Service worker access is server-only and environment-isolated.
- Database `GarmentItem` RLS remains tenant and guardian isolated after migration.

### Playwright web E2E

- File import completes crop, cleanup toggle, upload, verification, and processing success.
- Mocked `getUserMedia` capture completes and stops every media track.
- Permission denial and unavailable camera fall back to file import.
- Oversized, corrupt, unsupported, and spoofed files fail before upload allocation.
- Low-confidence cleanup preserves the cropped original.
- Upload timeout and `5xx` recover with the same idempotency key.
- Successful object upload followed by commit failure retries without uploading bytes twice.
- Consent revocation between allocation and commit returns the localized consent error.
- Modal focus, keyboard crop controls, Escape, focus restoration, status regions, and automated axe
  checks pass at mobile, tablet, and desktop viewports.

### Maestro mobile E2E

- Deterministic fixture import completes the entire flow on iOS and Android.
- Camera and library permission denial expose the correct actions and `testID` values.
- Crop ratio, rotate, cleanup toggle, confirmation, progress, processing success, retry, and cancel
  are selectable through stable IDs.
- Network timeout, consent failure, and expired session render localized recoverable errors.
- Accessibility labels and live-region status are present on all critical controls.
- Production-build validation proves the fixture seam is absent.

### Privacy and resilience tests

- Logger capture tests inject JWTs, signed URLs, token queries, object paths, emails, IPs,
  filenames, provider errors, buffers, base64, and data URIs, then assert redaction.
- Telemetry tests reject every unknown or prohibited property and set provider IP capture off.
- PostHog, telemetry persistence, and logging transport failures do not fail upload commit.
- Concurrent commit and webhook delivery produce one processing job, one record, and one completion
  event.
- Cleanup retries remain idempotent and produce no sensitive audit payload.

## Developer context and guardrails

- Canonical HTTP schemas live under `packages/api-client/src/contracts/http/` and are the only API
  source of truth.
- Canonical analytics schemas live in `packages/api-client/src/types/analytics-events.ts`.
- `RequestAuthGuard` authenticates and performs the general account gate.
- `WardrobeUploadGuard` performs the fresh, upload-specific guardian authorization.
- `GuardianConsentStateService` remains the general cached access-state service. It is not the fresh
  upload-relay decision source.
- Existing database RLS uses `private.current_app_user_id()` and guardian-aware helper functions.
- `GarmentItem` currently requires category and stores `image_url`; this story must migrate those
  fields before the new API can commit safely.
- `WARDROBE_UPLOAD_TOKEN_SECRET` and `ANALYTICS_ID_SECRET` are required secret-store values outside
  local tests. Startup fails closed when either required integration is enabled without its secret;
  `.env.example` contains names and descriptions only.
- Web and mobile must consume the generated `@couture/api-client` wrapper. App-local public contract
  types or handwritten fetch clients are prohibited.
- Camera, picker, crop, cleanup, Storage, PostHog, and logger boundaries are external boundaries for
  unit testing.
- Test fixtures contain synthetic garment images with stripped metadata and no identifiable people,
  locations, documents, reflections, or wardrobe data.

## Architecture references

- ADR-001: Supabase PostgreSQL and Prisma own garment persistence and migrations.
- ADR-002: Supabase Storage keeps wardrobe assets private.
- ADR-004: Supabase Auth, application RBAC, RLS, and guardian consent enforce access.
- ADR-014: verified wardrobe uploads initiate server-side color processing through Sharp and ONNX.
- Existing processing states are `uploading`, `processing`, `ready`, and `failed`; this story makes
  the upload boundary and persistent transitions explicit.

## Standard validation commands

```bash
npm run generate:api-client
npm run verify:changed
npm run test:pw-local
npm run test:e2e:mobile
```

Run the repository's local Supabase database and Storage RLS integration command in addition to the
standard gates. Production and preview resources must never be used for local or CI tests.
