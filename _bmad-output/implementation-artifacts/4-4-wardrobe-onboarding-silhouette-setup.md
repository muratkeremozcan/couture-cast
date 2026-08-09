---
baseline_commit: 45d584c2f90debccef9bc6f89f008069ab612a48
---

<!-- markdownlint-disable MD013 MD036 MD052 -->

# Story 4.4: Wardrobe onboarding and silhouette setup

Status: in-progress

## Story

As a new user,
I want a guided wardrobe import and silhouette builder,
so that CoutureCast reflects my body type and closet from the first session.

## Scope and non-negotiable decisions

This story extends Story 4.1, Garment Capture Flow, and Story 4.2, Smart Tagging and
Comfort Metadata, and depends on Story 3.8's accessibility patterns. It introduces two
new capabilities: a resumable, server-authoritative **wardrobe onboarding** sequence
that orchestrates the existing capture and tagging components, and a new **silhouette
profile** (adjustable mannequin sliders, or a "My Form" full-body photo with a private
processing pipeline). Both are reachable again after onboarding completes, because a
user's body and closet change over time.

1. **No premium gating in this story.** The UX specification describes "My Form" as a
   Premium unlock, but Epic 5 (commerce, premium subscription lifecycle) has not been
   built: there is no `premium`, `subscription`, or `entitlement` concept anywhere in
   `packages/db/prisma/schema.prisma` or `apps/api/src/modules/auth`. Epic 4's own
   acceptance criteria for this story do not condition "My Form" on a paid tier. Ship
   "My Form" open to every authenticated user now. Do not invent a placeholder premium
   flag; that speculative gate belongs to whichever Epic 5 story defines real
   entitlements, and inventing one now risks a shape that does not match what that
   story actually needs.

2. **"Use starter wardrobe" never writes synthetic `GarmentItem` rows.** Choosing to
   skip capture marks the onboarding capture step `skipped` and moves straight to the
   silhouette step. It does not seed fake garments into the user's real closet.
   Recommendations for these users keep using the existing non-wardrobe
   scenario-outfit-generator fallback from Epic 2 until the user adds real garments
   later from the wardrobe hub.

3. **Onboarding progress is server-authoritative**, stored in a new one-row-per-user
   `WardrobeOnboardingState` table, not client storage. This makes the flow resumable
   across devices and app restarts and lets another open client converge on committed
   state the same way Story 4.3 established for capsules. Step transitions are a
   validated forward-only state machine enforced server-side; the client cannot jump to
   an arbitrary step. Reopening `/wardrobe/onboarding` after `status = completed`
   redirects to the wardrobe hub; the automatic first-run entry point fires at most
   once, but the silhouette step remains reachable afterward as its own settings
   surface (Task 5) because bodies and closets change.

4. **Body representation is two continuous sliders, not a labeled body-type taxonomy.**
   The UX specification calls for "body type + height sliders" on an adjustable black
   silhouette. This story implements that as two independent 0–100 integer sliders,
   `heightSlider` and `buildSlider`, that reshape the rendered mannequin continuously.
   It does not introduce a fixed category picker (for example "pear" or "hourglass").
   No such taxonomy is specified anywhere in the product documents, and inventing one
   is a product and inclusivity risk this story does not need to take to satisfy the
   epic's acceptance criteria.

5. **"My Form" photo lifecycle mirrors the architecture's Silhouette Overlay & Color
   Pipeline exactly**: `pending_upload` → `bytes_uploaded` → `processing` → `ready` or
   `failed`. A `failed` result carries exactly one reason: `contrast`,
   `privacy_violation`, `timeout`, or `storage_error`. A transient processing fault
   (timeout, storage) retries automatically up to 3 times with exponential backoff
   using the existing BullMQ `moderation-review` queue, whose `defaultJobOptions` in
   `apps/api/src/config/queues.ts` already declare `attempts: 3` and
   `backoff: { type: 'exponential', delay: 1000 }`. This queue is provisioned since
   Story 0.4. `apps/api/src/workers/bootstrap.ts` already registers a no-op placeholder
   consumer for it (`createWorker('moderation-review', async () => Promise.resolve(),
...)`) that has never processed a real job; this story replaces that placeholder
   with the real processor (Task 4) rather than adding a second consumer elsewhere.
   BullMQ splits jobs nondeterministically across every Worker instance subscribed to
   the same queue name regardless of process, so leaving both consumers running would
   silently "succeed" a fraction of silhouette jobs without ever running moderation.
   `wardrobe.bootstrap.ts` (not `bootstrap.ts`) is the correct home: it is already the
   only worker process gated by `verify:tagging-model`
   (`apps/api/package.json`'s `start:workers:wardrobe:prod`), i.e. the model-capable
   process, and `architecture.md`'s ADR-013 commits this same `moderation-review` queue
   to a TensorFlow.js NSFW model for Epic 6 later — a model-loading consumer belongs
   with `wardrobe.bootstrap.ts`, not the lightweight `bootstrap.ts` group that only runs
   weather-ingestion and alert-fanout. A
   `contrast` or `privacy_violation` verdict is a terminal business outcome, not a
   queue fault: the processor writes it directly and returns normally, it never
   retries.

6. **A `privacy_violation` verdict for a teen actor also writes a `ModerationEvent`
   and notifies the linked guardian**, matching the architecture's stated failure mode
   ("moderation/NSFW flags short-circuit the flow and notify guardian/moderator
   channels"). Reuse the durable `EventEnvelope` outbox pattern already established in
   `apps/api/src/modules/guardian/guardian.service.ts` (the `channel: 'email.*'`
   convention used for guardian-invitation email) rather than sending email
   synchronously from the request path.

7. **Guardian consent gates "My Form" uploads exactly like garment photo capture.**
   Call the existing `GuardianService.assertWardrobeUploadAllowed(userId, role)` before
   allocating an upload URL or accepting a commit for a "My Form" photo. A full-body
   photo of a minor is at least as sensitive as a garment photo, so the bar cannot be
   lower than what Story 4.1 already established for wardrobe media. `WardrobeController`
   applies this same check to every route in the controller, including reads, via a
   class-level `@UseGuards(RequestAuthGuard, WardrobeUploadGuard)`; `WardrobeUploadGuard`
   itself is generic (it only calls `assertWardrobeUploadAllowed(auth.userId, auth.role)`)
   so a teen without active guardian consent cannot even list existing garments today.
   Apply that exact same `WardrobeUploadGuard` class-level to
   `wardrobe-silhouette.controller.ts` — no new guard class is needed — so slider reads
   and writes are gated the same as My Form routes, not only upload-url/commit; a
   consent-revoked teen cannot read or write any silhouette data.
   `wardrobe-onboarding.controller.ts` (the step state machine) does not need the same
   gate: it exposes no photo bytes, and its capture/tagging steps already delegate to
   `WardrobeController`'s existing, already-gated endpoints.

8. **The "plain white or black basewear" instruction is enforced by copy, a required
   confirmation, and an automated contrast heuristic — not garment or pose
   segmentation.** No such classifier exists in this codebase and none is proposed in
   `architecture.md`. The commit endpoint requires `confirmsBasewearGuidance: true` in
   the payload (the user-facing checkbox), and the processing worker independently
   measures contrast between the image's outer border region (assumed background) and
   its center region (assumed subject) using `sharp().extract().stats()`, the same
   primitive `wardrobe-color.processor.ts` already uses for dominant-color extraction.
   Below a tunable Euclidean RGB distance threshold, the photo fails with `contrast`
   and the user is guided to retake it. This is a conservative first-line guardrail,
   not a substitute for a vendor-grade moderation service; document that limitation in
   Dev Notes rather than overstating what a heuristic can guarantee. This deliberately
   follows `architecture.md`'s server-side ADR-014 and the Silhouette Overlay & Color
   Pipeline pattern, not `ux-design-specification.md` §9.1's closing summary, which
   claims "on-device palette detection so user imagery never leaves CoutureCast's
   boundary" — that line is stale and contradicts the architecture doc; note the
   discrepancy in Dev Notes rather than letting a future reviewer read this story's
   correct server-side approach as a defect.

9. **Moderation uses the same pluggable-engine pattern Story 4.2 established for
   tagging.** Define a `SilhouettePhotoModerationEngine` interface (mirroring
   `GarmentTaggingEngine`), a deterministic `FixtureSilhouettePhotoModerationEngine`
   gated by `SILHOUETTE_MODERATION_ENGINE=fixture` plus `allowsTestOnlySecrets()`
   (mirroring `FixtureGarmentTaggingEngine`) for tests, and a real default
   `HeuristicSilhouettePhotoModerationEngine` combining the contrast check with a
   conservative bare-skin-pixel-ratio heuristic over the same Sharp region stats. State
   plainly in Dev Notes that this heuristic engine is a safety net pending a real
   content-safety vendor integration, exactly as Story 4.3 recorded remaining
   live-environment work instead of pretending completeness.

10. **New tables reuse the exact RLS boundary already proven for wardrobe data.** Add
    `WardrobeOnboardingState` and `SilhouetteProfile`, each with a `revision Int
@default(0)` column following the `capsule_revision` precedent. RLS both tables
    with `private.can_read_shared_user_row(user_id)` /
    `private.can_write_shared_user_row(user_id)`, identical to `GarmentItem` and
    `OutfitCapsule`, because a guardian overseeing a teen's account needs the same
    visibility into onboarding progress and a body photo that they already have into
    wardrobe photos. Add an optional `silhouette_profile_id` foreign key to
    `ModerationEvent`, mirroring its existing optional `garment_item_id`. This grants a
    full-access guardian raw DB-level write capability over both tables even though
    decision 11 gives guardians no application route to use it — the same asymmetry
    `GarmentItem` already has today (`WardrobeController` is also self-scoped to
    `auth.userId` with no guardian route, yet `GarmentItem` RLS grants guardian write).
    That is existing, accepted precedent here, not a gap this story introduces.

11. **Routes are self-scoped to `auth.userId`, not owner-path-scoped like capsules.**
    Nobody configures another user's body representation or drives their onboarding on
    their behalf; a guardian's read access flows only through RLS, not through a
    dedicated guardian-facing route (no such dashboard is in scope). This matches
    `WardrobeController`'s existing convention (garments, upload-url) rather than
    `WardrobeCapsuleController`'s `:ownerUserId` path convention.

12. **"My Form" deletion is an immediate hard delete**, not the deferred
    `deletion_pending` retention sweep built for garments in
    `WardrobeRetentionService`. Nothing else references a silhouette photo the way
    capsules reference garments, so the safer, simpler, more privacy-respecting choice
    is synchronous removal: delete the storage object and clear the photo fields in the
    same request, then fall back the profile to `default_mannequin`.

13. **Onboarding completion telemetry is new and distinct from the existing MVP
    activation events.** `profile_completed` and `first_outfit_generated` already exist
    in `packages/api-client/src/types/analytics-events.ts` and fire from
    `auth.service.ts` and ritual generation for the original signup flow; they are out
    of scope here. This story adds `wardrobe_onboarding_started` and
    `wardrobe_onboarding_completed`, mirroring the existing
    `wardrobe_upload_started` / `garment_upload_completed` pairing, to feed the wardrobe
    activation KPI the epic's AC3 requires. No numeric target exists yet for this KPI
    in `prd.md`'s Business Metrics table — only the unrelated "Activation completion"
    metric (≥75% of new users finish profile + first outfit within 2 minutes) is
    defined there, and that is the metric this decision already excludes. This story
    instruments the events; it does not own a target number.

14. **No high-volume performance fixture.** Unlike Story 4.3's capsule listing and
    search, every table this story adds is a singleton per user with no search,
    filter, or pagination surface. Hold new endpoints to the house mutation latency
    bar already exercised in `k6/tests/couture-api-baseline.k6test.ts` rather than
    inventing a 1,000-row fixture profile that does not match this data shape.

---

## Acceptance criteria

### AC 1: Guided onboarding orchestrates existing capture and tagging

- **Given** an authenticated new user whose `WardrobeOnboardingState` is absent or
  `not_started`,
- **When** the user enters the onboarding flow, grants or is denied camera/library
  permission, and either captures one or more garments through the existing crop and
  background-cleanup steps (Story 4.1) followed by the existing smart-tagging
  confirmation (Story 4.2), or explicitly chooses "Use starter wardrobe",
- **Then** the server-side state advances `permission → capture → tagging → silhouette`
  in order (or `permission → capture(skipped) → silhouette` for the starter-wardrobe
  path), each captured garment shows a checklist row that reflects its live upload and
  tagging status, no synthetic garments are created for the skip path, and reloading or
  switching devices mid-flow resumes at the same step with the same checklist state.

### AC 2: Silhouette setup offers sliders and a private "My Form" photo pipeline

- **Given** a user who reaches the silhouette step,
- **When** the user adjusts the height and build sliders and saves, or instead uploads
  a full-body photo after confirming the basewear guidance checkbox,
- **Then** slider values persist as the default `SilhouetteProfile` immediately; a
  "My Form" upload follows `pending_upload → bytes_uploaded → processing → ready` or
  `failed` with exactly one reason (`contrast`, `privacy_violation`, `timeout`,
  `storage_error`); guardian consent is enforced identically to garment capture for a
  teen actor; a `privacy_violation` on a teen's photo writes a `ModerationEvent` and
  queues a guardian notification through the durable outbox; and a `ready` photo
  becomes the active silhouette mode while the previous mannequin sliders remain saved
  for later switching back.

### AC 3: Retry, inline errors, and completion telemetry

- **Given** an upload failure at any onboarding or silhouette step,
- **When** the failure occurs,
- **Then** the acting client shows an inline, reason-specific error with a retry
  action that resumes from the failed step without discarding earlier completed steps,
  a transient processing fault retries automatically up to 3 times before surfacing as
  `failed`, and once the user reaches `complete` the server marks
  `WardrobeOnboardingState.status = completed`, records `completed_at`, and emits
  exactly one `wardrobe_onboarding_completed` event carrying duration, whether the
  starter wardrobe was used, the captured garment count, and the chosen silhouette
  mode; a `wardrobe_onboarding_started` event fires exactly once when the state first
  leaves `not_started`.

### AC 4: Respect RLS, guardian boundaries, and idempotent mutations

- **Given** an owner, an active guardian, an unrelated user, or an anonymous actor,
- **When** any actor reads or writes `WardrobeOnboardingState` or `SilhouetteProfile`
  rows, directly or through the API,
- **Then** RLS and the API enforce the same owner/guardian boundary already proven for
  `GarmentItem` and `OutfitCapsule`; every mutating request after the first requires
  `If-Match` against the current `revision`-derived ETag, a stale precondition changes
  nothing, and a repeated identical mutation is a safe no-op that changes no revision
  or telemetry.

### AC 5: Deliver an accessible, localized cross-surface experience

- **Given** a supported locale and keyboard, screen-reader, touch, or switch input,
- **When** the user completes onboarding or edits their silhouette later on Web or
  Mobile,
- **Then** the flow reuses `AccessibleModal`/`accessibilityViewIsModal` focus-trap
  conventions already proven in Story 4.3, exposes sliders and permission/error states
  with descriptive labels and live announcements, meets 44 by 44 pixel targets and
  WCAG 2.2 AA contrast, and every user-visible string resolves through the locale
  catalogs for all 10 supported locales with `en-US` fallback.

---

## Tasks and subtasks

- [x] Task 1: Prisma schema, migration, RLS (AC: 1 to 4)
  - [x] Add `WardrobeOnboardingStatus`, `WardrobeOnboardingStep`, `SilhouetteMode`,
        `SilhouettePhotoStatus`, and `SilhouettePhotoFailureReason` enums to
        `packages/db/prisma/schema.prisma`.
  - [x] Add `WardrobeOnboardingState` (`user_id` unique, `status`, `current_step`,
        `used_starter_wardrobe Boolean @default(false)`,
        `garments_captured_count Int @default(0)`, `started_at`, `completed_at`,
        `revision Int @default(0)`, timestamps) and its singular relation on `User`.
  - [x] Add `SilhouetteProfile` (`user_id` unique, `mode`, `height_slider Int?`,
        `build_slider Int?`, the full `my_form_*` upload-lifecycle field set mirroring
        `GarmentItem` — object path, upload session id, idempotency keys, payload
        hash, file size, mime type, sha256, dimensions, `upload_expires_at`,
        `committed_at`, `consent_checked_at`, `status`, `failure_reason`,
        `moderation_flagged_at`, `retention_status`, `revision Int @default(0)`,
        timestamps) and its singular relation on `User`.
  - [x] Add optional `silhouette_profile_id` to `ModerationEvent` plus its relation.
  - [x] Generate the migration under `packages/db/prisma/migrations` with guardian-
        shared RLS policies (`can_read_shared_user_row` / `can_write_shared_user_row`)
        on both new tables, and the indexes needed for owner lookup by `user_id`.
  - [x] Extend `packages/db/test/rls-policies.spec.ts` with the same owner, read-only
        guardian, full-access guardian, admin, revoked/pending consent, unverified
        claim, spoofed metadata, unrelated, anonymous, and service-role matrix already
        used for `GarmentItem`, applied to both new tables.
  - [x] Add `packages/db/test/wardrobe-onboarding-schema.spec.ts` that applies the
        migration to seeded data and directly proves defaults, uniqueness, cascades,
        indexes, policies, and grants (apply-the-migration evidence, not string-
        grepping the migration file — Story 4.3's review found and fixed exactly that
        shortcut).

- [x] Task 2: Wardrobe contracts, fixtures, and factories (AC: 1 to 5)
  - [x] Define strict onboarding-state read/PATCH schemas, silhouette slider
        read/PUT schemas, "My Form" upload-url/commit/delete schemas, revision, ETag,
        `If-Match`, and every error schema in
        `packages/api-client/src/contracts/http/wardrobe.ts`.
  - [x] Register every endpoint, header, response code, and error with
        `OpenAPIRegistry` in `packages/api-client/src/contracts/http/openapi.ts`.
  - [x] Add `wardrobe_onboarding_started` and `wardrobe_onboarding_completed` to
        `analyticsEventNameSchema` and their strict property allowlists plus tracking
        wrappers in `packages/api-client/src/types/analytics-events.ts`. Add negative
        fixtures proving no photo, silhouette detail, or free-form text ever appears
        in analytics properties.
  - [x] Add deterministic onboarding/silhouette fixtures to
        `packages/api-client/src/testing/wardrobe-fixtures.ts`.
  - [x] Add `packages/testing/src/factories/wardrobe-onboarding.factory.ts` and
        `packages/testing/src/factories/silhouette-profile.factory.ts` with in-memory
        and persisted builders. Register both in
        `packages/testing/src/factories/registry.ts` and extend
        `packages/testing/src/cleanup.ts` for reverse-dependency cleanup (moderation
        events referencing a silhouette profile before the profile, before the user).
  - [x] Run `npm run generate:api-client`; inspect and commit the generated OpenAPI
        and SDK changes without hand-editing generated files.

- [x] Task 3: Onboarding-state and silhouette API (AC: 1 to 4)
  - [x] Add `wardrobe-onboarding.controller.ts` and `wardrobe-onboarding.service.ts`
        under `RequestAuthGuard` at `/api/v1/wardrobe/onboarding`. `GET` returns
        current state or a virtual `not_started` default (ETag
        `"onboarding:<userId>:0"`) without persisting a row. `PATCH` validates the
        requested step transition against the forward-only state machine, requires
        `If-Match`, and is a no-op-safe replay for an identical payload against the
        current revision.
  - [x] Add `wardrobe-silhouette.controller.ts` and `wardrobe-silhouette.service.ts`
        at `/api/v1/wardrobe/silhouette`. Apply the existing `WardrobeUploadGuard`
        class-level (`@UseGuards(RequestAuthGuard, WardrobeUploadGuard)`, the same guard
        class `WardrobeController` uses — do not write a new guard) so every route,
        including the slider `PUT` and not only upload-url/commit, is blocked for a
        teen without active guardian consent. `PUT` upserts slider values with the same
        revision/`If-Match` discipline.
        `POST /my-form/upload-url`, `PUT /my-form/uploads/:uploadSessionId`, and
        `POST /my-form/commit` mirror the existing garment upload-url/bytes/commit
        endpoints in `wardrobe.controller.ts`/`wardrobe.service.ts`, and
        `confirmsBasewearGuidance: true` is required in the commit payload.
        `DELETE /my-form` performs the immediate hard delete described in decision 12.
  - [x] Set `Cache-Control: private, no-store` on every success and error response for
        both controllers; follow the `CapsuleCacheHeadersMiddleware` pattern from
        `wardrobe-capsule.cache-headers.middleware.ts` if per-handler headers cannot
        reach guard- or validation-raised errors, exactly the gap Story 4.3 found and
        fixed.
  - [x] Register both controllers and services, plus the new queue class from Task 4,
        in `wardrobe.module.ts`.

- [x] Task 4: "My Form" processing pipeline (AC: 2, 3)
  - [x] Add `verifySilhouettePhoto` alongside `verifyGarmentImage` in a new
        `wardrobe-silhouette-image-validation.ts`, reusing its declared-payload and
        decoded-metadata checks with a portrait-framing constraint
        (`heightPx >= widthPx * 1.2`).
  - [x] Add `SilhouettePhotoModerationEngine` interface, `garment-tagging.engine.ts`-
        style, plus `HeuristicSilhouettePhotoModerationEngine` (Sharp-based border-vs-
        center contrast distance and bare-skin-pixel-ratio heuristic) and
        `FixtureSilhouettePhotoModerationEngine` (gated by
        `SILHOUETTE_MODERATION_ENGINE=fixture` and `allowsTestOnlySecrets()`,
        mirroring `FixtureGarmentTaggingEngine`).
  - [x] Add `SilhouettePhotoProcessingQueue`, mirroring `WardrobeProcessingQueue`
        exactly, enqueuing onto the existing `moderation-review` BullMQ queue
        (`apps/api/src/config/queues.ts`) with `jobId: silhouetteProfileId`.
  - [x] Add `SilhouettePhotoProcessor`, mirroring `WardrobeColorProcessor`: downloads
        the photo, runs the contrast check then the moderation engine, writes a
        terminal `ready`/`contrast`/`privacy_violation` result without throwing, and
        lets a genuine storage/timeout fault propagate so BullMQ's existing 3-attempt
        exponential backoff retries it; on final-attempt exhaustion calls a new
        two-argument `markFailed(silhouetteProfileId, 'timeout' | 'storage_error')` at
        the same call-site position `wardrobe.bootstrap.ts` uses for
        `WardrobeColorProcessor.markFailed(garmentId)` today. That existing method
        takes one argument because `GarmentItem.failure_code` is free-form text; this
        is a new two-argument signature on the new processor, not a literal copy.
  - [x] Register the worker consumer for the `moderation-review` queue in
        `apps/api/src/workers/wardrobe.bootstrap.ts`, following the exact
        `color-extraction` worker registration already there. In the same change,
        remove the no-op placeholder consumer for `moderation-review` from
        `apps/api/src/workers/bootstrap.ts`
        (`createWorker('moderation-review', async () => Promise.resolve(), ...)`).
        Two Worker instances subscribed to the same queue name from different
        processes split jobs nondeterministically; leaving the placeholder running
        would silently drop a fraction of silhouette jobs with no error.
  - [x] For a `privacy_violation` verdict on a teen actor's photo: write a
        `ModerationEvent` row (`silhouette_profile_id`, `action`, `reason`) and enqueue
        a guardian-notification `EventEnvelope` (`channel:
'email.guardian-silhouette-flag'`) inside the same transaction, mirroring
        `guardian.service.ts`'s existing `email.guardian-invitation` outbox pattern.

- [x] Task 5: Web onboarding and silhouette experience (AC: 1, 2, 3, 5)
  - [x] Add `apps/web/src/app/wardrobe/onboarding/page.tsx` as the guided flow: a
        permission step, a capture/tagging loop that renders the existing
        `GarmentCaptureModal` and `GarmentTaggingModal` inline with a running
        checklist, a "Use starter wardrobe" skip action, a silhouette step (sliders
        plus "My Form" upload with the basewear-confirmation checkbox and inline
        retry), and a completion step that routes to the wardrobe hub.
  - [x] Add a "Set up your closet" entry-point card to
        `apps/web/src/app/wardrobe/page.tsx` (read the current file fully before
        editing — it already owns polling, capture-modal invocation, and focus-
        restoration state) shown while `WardrobeOnboardingState.status` is not
        `completed`.
  - [x] Add a silhouette settings section reachable outside onboarding (decision 3),
        reusing the same slider and "My Form" components.
  - [x] Extend `apps/web/src/lib/wardrobe.ts` through generated API-client wrappers.
        Reuse one idempotency key per logical upload attempt; do not mint a fresh key
        per call, the exact bug Story 4.3's review found in
        `capsule-builder-modal.tsx`.
  - [x] Add the `wardrobe.onboarding.*` and `wardrobe.silhouette.*` key trees to all
        10 Web locale catalogs under `apps/web/src/i18n/locales`, following the
        camelCase convention Story 4.3 established there (the Web catalogs currently
        contain only `wardrobe.capsules`; garment capture/tagging strings on Web
        remain hardcoded from Story 4.1/4.2 — do not silently fix that pre-existing
        gap as part of this story's scope, call it out in Dev Notes instead).
  - [x] Add component and integration tests for every state: permission grant/deny,
        capture-loop checklist, starter-wardrobe skip, slider persistence, "My Form"
        upload through `ready`/each `failed` reason with retry, guardian-consent
        rejection for a teen actor, focus trap and restoration, live announcements,
        and resume-after-reload.

- [x] Task 6: Mobile onboarding and silhouette experience (AC: 1, 2, 3, 5)
  - [x] Extract the garment-capture flow already inline in
        `apps/mobile/app/(tabs)/wardrobe.tsx` (its `ImagePicker` calls, crop/upload
        state machine, and inline `<Modal>`) into a new, reusable
        `apps/mobile/components/wardrobe/garment-capture-modal.tsx`, mirroring the
        Web's existing separation between `garment-capture-modal.tsx` and
        `wardrobe/page.tsx`. No such reusable component exists on Mobile today — unlike
        `garment-tagging-modal.tsx`, capture has never been extracted, so there is no
        "capture screen" file to import as-is. This extraction is required, not
        optional: `project-context.md` states "avoid adding duplicate utility
        implementations to apps," and copying the inline flow into
        `wardrobe-onboarding.tsx` instead of extracting it would be exactly that.
        Update
        `apps/mobile/app/(tabs)/wardrobe.tsx` to consume the extracted component so its
        existing capture entry point keeps working unchanged; its existing tests must
        stay green.
  - [x] Add `apps/mobile/app/wardrobe-onboarding.tsx` mirroring the Web flow, reusing
        the existing mobile `garment-tagging-modal.tsx` and the newly extracted
        `garment-capture-modal.tsx` for the capture/tagging loop.
  - [x] Add a silhouette settings screen reachable outside onboarding, with the same
        slider and "My Form" flows using `accessibilityRole`/`accessibilityState` and
        `accessibilityViewIsModal` conventions already proven in the mobile capsule
        modal.
  - [x] Add the entry-point card to `apps/mobile/app/(tabs)/wardrobe.tsx` (read fully
        before editing).
  - [x] Extend `apps/mobile/src/lib/wardrobe.ts` through generated API-client
        wrappers.
  - [x] Add `wardrobe.onboarding` and `wardrobe.silhouette` key trees to all 10 Mobile
        locale files under `apps/mobile/assets/locales`, following the existing
        snake_case convention there (`add_garment`, `empty_title`) — note this is the
        opposite case convention from the Web catalogs' camelCase; do not unify them
        as part of this story.
  - [x] Add component and screen tests mirroring the Web matrix in Task 5, plus
        offline handling and screen-reader announcement coverage.

- [ ] Task 7: Consumer and provider contracts (AC: 1 to 4)
  - [ ] Add onboarding-state and silhouette contract specs under
        `packages/api-client/src/contracts/http/__tests__`.
  - [ ] Prove `OpenAPIRegistry` coverage through `npm run optic:lint` and
        `npm run build:packages`.
  - [ ] Add Web and Mobile consumer Pact interactions and deterministic provider
        states for ownership, guardian access, stale ETag, each "My Form" failure
        reason, and guardian-notification enqueue, keeping one interaction per test
        and the existing single-fork FFI configuration.

- [ ] Task 8: End-to-end and accessibility automation (AC: 1 to 5)
  - [ ] Add `playwright/tests/wardrobe-onboarding-flow.spec.ts` for the full guided
        path: permission, capture-and-tag one garment, silhouette sliders, completion
        redirect, and resume-after-reload mid-flow.
  - [ ] Add `playwright/tests/wardrobe-onboarding-my-form.spec.ts` for the "My Form"
        upload path, one representative failure reason with retry, and the completed
        photo becoming the active silhouette.
  - [ ] Add `playwright/tests/wardrobe-onboarding-accessibility.spec.ts` for keyboard-
        only completion, visible focus, slider target geometry, live announcements,
        and axe.
  - [ ] Add Maestro flows for the guided path and the "My Form" path on one iOS and
        one Android reference device, plus one non-English locale, with public-API
        cleanup.
  - [ ] Record manual VoiceOver and TalkBack evidence with device, OS, build, steps,
        expected/actual results, defects, and reviewer.

- [ ] Task 9: Verification gate (AC: 1 to 5)
  - [ ] Run database generation and migration checks, RLS tests, unit and integration
        tests (including a real-PostgreSQL integration spec for the onboarding state
        machine and "My Form" lifecycle — Story 4.3's review found that a mock-only
        integration suite let non-functional code ship), Pact generation and provider
        verification, Playwright, Maestro, locale parity, and manual accessibility
        evidence.
  - [ ] Run `npm run verify:changed`, then `npm run validate` because the change
        crosses the API, Web, Mobile, and shared-contract boundaries.
  - [ ] Confirm zero lint, typecheck, test, build, accessibility, generated-artifact,
        contract, determinism, retry-masked, focused, or quarantined-test failures
        before moving the story to review.

---

## Dev notes

### Architectural constraints and coding standards

1. **Strict TypeScript and Zod.** Preserve `strict`, `noUncheckedIndexedAccess`,
   `useUnknownInCatchVariables`, and `isolatedModules`. Parse every request and
   response boundary with canonical schemas from `@couture/api-client`. Avoid `any`
   and `as unknown as TargetType` — Story 4.3's review found exactly that pattern
   bypassing response validation.

2. **NestJS architecture.** Keep transport in `*.controller.ts`, business rules in
   `*.service.ts`, and register new providers through `WardrobeModule` with
   constructor injection. Include `.js` on relative imports within `apps/api`.

3. **Prisma and RLS.** Edit `packages/db/prisma/schema.prisma`, generate a migration
   under `packages/db/prisma/migrations`, run the repository database generation
   command, and never hand-edit generated Prisma client output. Reuse the existing
   private RLS helper functions; do not compare `auth.uid()` directly.

4. **Contracts and generated artifacts.** Treat the Wardrobe Zod schemas as the public
   API source. Register every endpoint in OpenAPI before regenerating
   `packages/api-client/docs/http.openapi.json` and
   `packages/api-client/src/generated/**`. Web and Mobile consume generated or stable
   package wrappers only.

5. **Files this story reads before modifying** (per project convention, these already
   exist and this story extends their behavior — read each completely first):
   - `apps/web/src/app/wardrobe/page.tsx` and `apps/web/src/app/components/garment-
capture-modal.tsx` / `garment-tagging-modal.tsx` — the capture and tagging UI
     this story orchestrates rather than rebuilds.
   - `apps/mobile/app/(tabs)/wardrobe.tsx` and
     `apps/mobile/components/wardrobe/garment-tagging-modal.tsx` — the mobile
     equivalents. `wardrobe.tsx` also holds the inline garment-capture flow
     (`ImagePicker` calls, crop/upload state machine, modal) that Task 6 extracts into
     a new reusable `garment-capture-modal.tsx` before the onboarding screen can
     consume it; no separate "capture screen" file exists to reuse as-is.
   - `apps/api/src/modules/wardrobe/wardrobe.controller.ts`,
     `wardrobe.service.ts`, `wardrobe.guard.ts`, and `wardrobe-image-validation.ts` —
     the upload-url/bytes/commit lifecycle and validation this story mirrors for "My
     Form".
   - `apps/api/src/modules/wardrobe/wardrobe-color.processor.ts` and
     `wardrobe-processing.queue.ts` — the BullMQ processing pattern this story mirrors
     for silhouette-photo processing.
   - `apps/api/src/modules/guardian/guardian.service.ts` — the
     `assertWardrobeUploadAllowed` consent gate and the `EventEnvelope`
     outbox-notification pattern this story reuses.
   - `apps/api/src/config/queues.ts`, `apps/api/src/workers/wardrobe.bootstrap.ts`, and
     `apps/api/src/workers/bootstrap.ts` — the `moderation-review` queue, the worker
     registration pattern this story's processor plugs into, and the no-op placeholder
     consumer already registered in `bootstrap.ts` that this story must remove rather
     than leave running alongside the new one.
   - `apps/api/src/modules/wardrobe/wardrobe-capsule.cache-headers.middleware.ts` — the
     error-path `Cache-Control` fix Story 4.3 needed; apply the same discipline here
     from the start.

6. **Test architecture and determinism.** Keep authorization, transactions, and the
   onboarding/silhouette state machines in real-PostgreSQL API integration tests, not
   mocks. Use `@couture/testing` factories in every layer that can consume them and
   register new entities for reverse-dependency cleanup. Keep Playwright and Maestro
   focused on independent user-visible journeys; keep filter/permutation matrices in
   lower-level suites. Never commit `.only`.

7. **Canonical localization key shape** (Web camelCase / Mobile snake_case per
   decision above; values below are the `en-US` source):

   ```json
   {
     "wardrobe": {
       "onboarding": {
         "title": "Set up your closet",
         "permissionTitle": "Allow camera and photo access",
         "permissionBody": "CoutureCast needs camera or library access to capture your garments.",
         "permissionDenied": "We couldn't access your camera or photos. You can still import files or use the starter wardrobe.",
         "useStarterWardrobe": "Use starter wardrobe",
         "addAnother": "Add another garment",
         "continue": "Continue",
         "back": "Back",
         "checklistTagged": "{{garment}}: tags confirmed",
         "checklistPending": "{{garment}}: needs tags",
         "complete": "Your closet is ready",
         "resumed": "Picking up where you left off",
         "errors": {
           "loadFailed": "Unable to load your onboarding progress.",
           "saveFailed": "Unable to save this step. Try again.",
           "stale": "This step changed elsewhere. Review the latest version and try again."
         }
       },
       "silhouette": {
         "title": "Silhouette",
         "modeDefault": "Adjustable silhouette",
         "modeMyForm": "My Form photo",
         "heightSliderLabel": "Height",
         "buildSliderLabel": "Build",
         "myFormUpload": "Upload a full-body photo",
         "myFormGuidance": "Wear plain white or black clothing against a plain background for the cleanest overlay.",
         "myFormConfirm": "I'm wearing plain white or black clothing",
         "myFormRetry": "Retry upload",
         "myFormRemove": "Remove My Form photo",
         "processing": "Processing your photo…",
         "ready": "My Form photo ready",
         "errors": {
           "contrast": "We couldn't separate you from the background clearly. Retake the photo with plainer clothing or a plainer background.",
           "privacyViolation": "This photo can't be used. Choose a different photo.",
           "timeout": "Processing took too long. Try again.",
           "storageError": "We couldn't save this photo. Try again.",
           "confirmRequired": "Confirm the basewear guidance before uploading."
         }
       }
     }
   }
   ```

### Verification commands

Run the narrow suites while implementing, then execute the complete gate:

```bash
npm run db:generate
npm run generate:api-client
npm run optic:lint
npm run test --workspace @couture/db
npm run test --workspace @couture/testing
npm run test --workspace @couture/api-client
npm run test --workspace api
npm run test:integration --workspace api
npm run test --workspace web
npm run test --workspace mobile
npm run test:pact
npm run test:pw-local -- wardrobe-onboarding
npm run test:pw:burn-in-changed
npm run test:mobile:e2e:ios
npm run test:mobile:e2e:android
npm run verify:changed
npm run validate
```

### Previous story intelligence (from Story 4.3)

Story 4.3 shipped a much larger surface (capsule search, ranking, recommendation
integration) after an adversarial review found 74 defects in a first pass that had
530 green tests against a non-functional real-database path. The recurring root
causes worth deliberately avoiding here:

- Row locking, ETag parsing, and revision preconditions must be proven against real
  PostgreSQL integration tests, not mocked repositories — a mock-only integration
  suite passed while the feature 500'd against a real database.
- The revision/`If-Match` precondition must be evaluated as part of the same atomic
  `UPDATE ... WHERE user_id = ? AND revision = ?` statement inside the transaction,
  never a separate pre-check read followed by an unconditional write. That exact gap
  ("revision precondition evaluated outside the transaction and absent from the
  UPDATE predicate") is what let concurrent PATCHes silently lose writes in 4.3.
  `WardrobeOnboardingState` and `SilhouetteProfile` add the identical revision/
  `If-Match` mechanism on two new tables, so this is not optional here.
- `Cache-Control: private, no-store` must reach guard- and validation-raised error
  responses, not just handler success paths; use middleware if per-handler headers
  cannot cover that.
- A fresh idempotency key must not be minted per call/render; reuse one key per
  logical user attempt.
- Reorder/slider controls need persistent keyboard focus and disabled-boundary
  `accessibilityState`; a naive implementation loses focus to `<body>` at the
  boundaries.
- Tasks marked complete must have real evidence (applied migrations, executed
  Playwright/Maestro, actual Pact interactions) — string-grepping a migration file or
  leaving a described task unimplemented while checked off is exactly what the 4.3
  review caught and had to unwind.

### Risk register

No dedicated risk-scored test-design document exists for this story the way
`_bmad-output/test-artifacts/test-design-epic-4.3.md` did for 4.3. This table is the
lightweight substitute; carry these IDs into test names or metadata where practical.
Every High-severity row needs completed mitigation evidence before review approval.

| ID      | Risk                                                                                                                               | Severity | Mitigation required before review                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.4-R01 | Two live consumers on the `moderation-review` queue split jobs; the placeholder silently "succeeds" jobs with no moderation run    | High     | Remove the `workers/bootstrap.ts` placeholder in the same change; a real-Redis integration test asserts exactly one worker processes each silhouette job end-to-end |
| 4.4-R02 | Revision-precondition race on `WardrobeOnboardingState`/`SilhouetteProfile` loses concurrent writes, exactly as in 4.3             | High     | Real-PostgreSQL concurrent-PATCH integration test asserting no lost update, per the lesson above                                                                    |
| 4.4-R03 | Contrast/bare-skin heuristic false-negatives let an inappropriate photo through                                                    | High     | Documented limitation (decision 8/9); fixture-engine tests cover both false-positive and false-negative boundary cases                                              |
| 4.4-R04 | Guardian notification on a `privacy_violation` verdict is lost between write and delivery                                          | Medium   | Outbox durability test: the `EventEnvelope` row survives a simulated crash between write and delivery                                                               |
| 4.4-R05 | Extracting Mobile's inline capture flow into `garment-capture-modal.tsx` regresses the existing `wardrobe.tsx` capture entry point | Medium   | Existing `wardrobe.tsx` capture tests stay green after the extraction; add a regression test if coverage gaps exist                                                 |

### Source tree files to create or modify

```text
packages/db/prisma/schema.prisma
packages/db/prisma/migrations/<timestamp>_add_wardrobe_onboarding_silhouette/migration.sql
packages/db/test/wardrobe-onboarding-schema.spec.ts
packages/db/test/rls-policies.spec.ts
packages/testing/src/factories/wardrobe-onboarding.factory.ts
packages/testing/src/factories/silhouette-profile.factory.ts
packages/testing/src/factories/index.ts
packages/testing/src/factories/registry.ts
packages/testing/src/cleanup.ts
packages/api-client/src/contracts/http/wardrobe.ts
packages/api-client/src/contracts/http/openapi.ts
packages/api-client/src/types/analytics-events.ts
packages/api-client/src/testing/wardrobe-fixtures.ts
packages/api-client/docs/http.openapi.json
packages/api-client/src/generated/**
apps/api/src/config/queues.ts
apps/api/src/workers/wardrobe.bootstrap.ts
apps/api/src/workers/bootstrap.ts
apps/api/src/modules/wardrobe/wardrobe-onboarding.controller.ts
apps/api/src/modules/wardrobe/wardrobe-onboarding.controller.spec.ts
apps/api/src/modules/wardrobe/wardrobe-onboarding.service.ts
apps/api/src/modules/wardrobe/wardrobe-onboarding.service.spec.ts
apps/api/src/modules/wardrobe/wardrobe-silhouette.controller.ts
apps/api/src/modules/wardrobe/wardrobe-silhouette.controller.spec.ts
apps/api/src/modules/wardrobe/wardrobe-silhouette.service.ts
apps/api/src/modules/wardrobe/wardrobe-silhouette.service.spec.ts
apps/api/src/modules/wardrobe/wardrobe-silhouette-image-validation.ts
apps/api/src/modules/wardrobe/wardrobe-silhouette-image-validation.spec.ts
apps/api/src/modules/wardrobe/silhouette-photo-moderation.engine.ts
apps/api/src/modules/wardrobe/heuristic-silhouette-photo-moderation.engine.ts
apps/api/src/modules/wardrobe/fixture-silhouette-photo-moderation.engine.ts
apps/api/src/modules/wardrobe/silhouette-photo-moderation.engine.spec.ts
apps/api/src/modules/wardrobe/silhouette-photo-processing.queue.ts
apps/api/src/modules/wardrobe/silhouette-photo-processing.queue.spec.ts
apps/api/src/modules/wardrobe/silhouette-photo.processor.ts
apps/api/src/modules/wardrobe/silhouette-photo.processor.spec.ts
apps/api/src/modules/wardrobe/wardrobe.module.ts
apps/api/src/modules/guardian/guardian.service.ts
apps/api/integration/wardrobe-onboarding.integration.spec.ts
apps/api/integration/wardrobe-silhouette.integration.spec.ts
apps/web/src/app/wardrobe/onboarding/page.tsx
apps/web/src/app/wardrobe/onboarding/page.test.tsx
apps/web/src/app/wardrobe/page.tsx
apps/web/src/app/wardrobe/page.test.tsx
apps/web/src/app/components/silhouette-settings-panel.tsx
apps/web/src/app/components/silhouette-settings-panel.test.tsx
apps/web/src/i18n/locales/*.json
apps/web/src/lib/wardrobe.ts
apps/mobile/app/wardrobe-onboarding.tsx
apps/mobile/app/(tabs)/wardrobe.tsx
apps/mobile/components/wardrobe/garment-capture-modal.tsx
apps/mobile/components/wardrobe/garment-capture-modal.test.tsx
apps/mobile/components/wardrobe/silhouette-settings-panel.tsx
apps/mobile/components/wardrobe/silhouette-settings-panel.test.tsx
apps/mobile/src/lib/wardrobe.ts
apps/mobile/assets/locales/*.json
pact/http/consumer/api-contract-interactions.ts
pact/http/consumer/web-api-client.pacttest.ts
pact/http/consumer/mobile-api-client.pacttest.ts
pact/http/provider/state-handlers.ts
playwright/tests/wardrobe-onboarding-flow.spec.ts
playwright/tests/wardrobe-onboarding-my-form.spec.ts
playwright/tests/wardrobe-onboarding-accessibility.spec.ts
maestro/wardrobe-onboarding-flow.yaml
maestro/wardrobe-onboarding-my-form-flow.yaml
maestro/wardrobe-onboarding-localization-flow.yaml
_bmad-output/test-artifacts/story-4.4-release-qa.md
```

### Open questions for follow-up (not blocking dev-story)

- Epic 5 (premium subscription lifecycle) will need to decide how and whether to gate
  "My Form" once real entitlements exist; this story deliberately leaves it open per
  decision 1.
- The heuristic moderation engine (decision 9) is a conservative safety net. A
  follow-up story should evaluate a real content-safety vendor before this feature
  scales past an initial rollout.

---

## Dev agent record

### Agent model used

Claude Sonnet 5 (claude-sonnet-5), via the `bmad-dev-story` workflow.

### Debug log references

**Orchestration plan (stacked branches + parallel worktree sessions).** This
story is too large for one linear session, so it is split into a stack of
branches that mirror the Tasks/Subtasks list. Each branch is pushed to
`origin` as soon as its task is verified, so progress survives a session
boundary — resume by checking which of these branches/PRs exist and picking
up the next unchecked task below.

```
feat/epic4-story4                          (this story file only)
 └─ feat/epic4-story4-t1-db                Task 1: schema, migration, RLS
     └─ feat/epic4-story4-t2-contracts     Task 2: contracts, fixtures, factories
         └─ feat/epic4-story4-t3t4-api     Task 3 + 4: onboarding/silhouette API + My Form pipeline
             ├─ feat/epic4-story4-t5-web        Task 5 (parallel worktree peer "web")
             ├─ feat/epic4-story4-t6-mobile     Task 6 (parallel worktree peer "mobile")
             └─ feat/epic4-story4-t7-pact       Task 7 (parallel worktree peer "pact")
                 └─ feat/epic4-story4-t8-e2e    Task 8, after t5/t6/t7 merge (integrator)
                     └─ feat/epic4-story4-t9-verify  Task 9: full verify:changed + validate gate
```

Tasks 1 to 4 are a strict dependency chain (DB types feed contracts, contracts
feed the API layer, the API module registers the Task 4 queue class), so one
session (this one) implements them sequentially. Once `t3t4-api` is pushed,
Tasks 5, 6, and 7 are independent of each other (Web, Mobile, and Pact each
only need the merged contracts + running API) and are handed to separate
`peer-sessions` Claude Code sessions, each in its own `herdr worktree` off
`t3t4-api`, so they run concurrently instead of consuming one session's
context/usage window serially. Task 8 (E2E) needs both Web and Mobile UI, so
it waits for `t5`/`t6` to land and is done by the integrating session. Task 9
is the final cross-boundary gate on top of everything.

Known environment gaps flagged up front rather than glossed over at the end:

- No Android emulator/`adb` in this sandbox (iOS simulator via `xcrun simctl`
  and the `maestro` CLI are both available). Android Maestro flows are
  authored but cannot be executed here; that is called out explicitly when
  Task 8 is reached, not silently skipped.
- "Record manual VoiceOver and TalkBack evidence with device, OS, build,
  steps... and reviewer" (Task 8) requires a human on physical hardware. No
  agent, peer or otherwise, can produce that evidence. Automated coverage
  (axe via Playwright, `accessibilityRole`/`accessibilityLabel` assertions in
  RTL/RNTL) is delivered instead, and the manual-evidence gap is left as an
  explicit outstanding item rather than fabricated.

Refinement made mid-flight: Web (Task 5) and Mobile (Task 6) only hard-depend
on Task 2 (contracts + generated SDK), not on Task 3/4 being finished, because
this repo's convention is MSW-mocked contracts for web/mobile tests. So the
fan-out is 4 parallel peers once Task 2 lands, not 3 after Task 4: `web`,
`mobile`, `api` (Task 3+4), and `pact` (Task 7, consumer side first, provider
verification once `api` lands).

Status of each branch is tracked here as work proceeds:

- [x] `feat/epic4-story4-t1-db` — done: migration applied to local Supabase
      Postgres, `db:reset` run to clear pre-existing unrelated drift on
      `outfit-capsule-schema.spec.ts`, full `@couture/db` suite green (72
      tests), lint and typecheck clean.
- [x] `feat/epic4-story4-t2-contracts` — done: onboarding-state and
      silhouette Zod contracts, 8 new OpenAPI paths, 2 new analytics events
      with negative-fixture privacy tests, fixtures, 2 new
      `@couture/testing` factories, cleanup ordering (moderation event before
      silhouette profile before user). `generate:api-client` run, `optic
lint` clean, `build:packages` clean. `@couture/api-client` 192/192,
      `@couture/testing` 9/9, both lint/typecheck clean.
- [x] `feat/epic4-story4-t3t4-api` — done: onboarding state machine and
      silhouette sliders/My Form pipeline, full moderation engine pair,
      BullMQ worker swap, guardian outbox notification. Real-Postgres and
      real-Redis integration tests (15 cases across two files) prove the
      revision/If-Match races (4.4-R02) and the exactly-once worker
      handoff (4.4-R01). 668 unit + 67 integration tests passing, lint and
      typecheck clean.
- [x] `feat/epic4-story4-t5-web` — done: onboarding guided flow, silhouette
      settings panel, wardrobe hub entry points, `lib/wardrobe.ts` API
      wrappers, and all 10 Web locale catalogs. Web `apps/web` suite 25/25
      files, 138/138 tests, lint and typecheck clean.
- [x] `feat/epic4-story4-t6-mobile` — done: extracted the previously-inline
      capture flow into `garment-capture-modal.tsx`, onboarding/silhouette
      feature screens, wardrobe hub entry points, `src/lib/wardrobe.ts`
      wrappers, all 10 Mobile locale catalogs. Found and fixed two
      pre-existing bugs along the way: `vitest.config.ts`'s include glob
      excluded `app/**` entirely (zero coverage on `wardrobe.tsx` before
      this), and unguarded `findNodeHandle` calls that throw on
      `react-native-web`. Mobile suite 36 files, 198 tests, lint and
      typecheck clean.
- [ ] `feat/epic4-story4-t7-pact` — in progress, peer session "pact" in
      `~/.herdr/worktrees/couture-cast/feat-epic4-story4-t7-pact`; ran its
      own adversarial self-review after an initial pass, found real gaps,
      fixing them now with provider verification unblocked against the
      pushed `t3t4-api`
- [ ] `feat/epic4-story4-t8-e2e` — in progress, this session, merging
      `t3t4-api` + `t5-web` + `t6-mobile` (not `t7-pact`, which only needs
      Web/Mobile at the code level and lands on `main` independently)
- [ ] `feat/epic4-story4-t9-verify` — not started

All three peers were spawned via `herdr worktree create` (one worktree per
branch, based on `origin/feat/epic4-story4-t2-contracts`) and
`peer-sessions`' `spawn-fleet.py` (herdr backend). This machine's
`SendMessage` does not reach herdr-spawned siblings (see this project's
`herdr, not cmux` memory), so progress is polled with `herdr agent
read/wait <name>` rather than an inbound reply — if you are a future session
picking this up, do the same. Each peer's brief instructed it to check off
only its own task's checkboxes, append (not overwrite) its own Completion
Notes/File List entries, and push its branch when its own verification gate
is green.

**Incident, self-corrected:** the original brief to the "web" peer gave an
absolute path prefixed `/Users/murat/opensource/couture-cast (this
worktree)/apps/web/...` intending "this worktree" to mean _its own_
worktree, but the literal path was the _main_ worktree's. The web peer
followed the literal path and wrote its first ~12 Task 5 files/edits into
the main worktree (this session's, on `feat/epic4-story4-t3t4-api`) instead
of its own. Caught via `git worktree list` + comparing `git status` across
worktrees before committing Task 3/4 — the API branch's commit never
included any `apps/web/**` files. Fix applied: copied the 12 stray
files/dirs into the web peer's actual worktree at matching relative paths,
reverted the main worktree's `apps/web/**` back to clean, and re-briefed the
web peer to verify from its own worktree and use only relative/cwd-rooted
paths going forward. Mobile and pact peers were unaffected (checked
directly). Lesson for future orchestration: never hand a peer an absolute
path into a _different_ worktree, even inside a parenthetical meant to
clarify context — say "your own worktree" and let the peer resolve its own
`pwd`, or give the exact worktree-specific absolute path if one must be
given at all.

### Completion notes list

**Task 1 (branch `feat/epic4-story4-t1-db`).** Added the five new enums,
`WardrobeOnboardingState`, and `SilhouetteProfile` to `schema.prisma`, plus
the optional `silhouette_profile_id` relation on `ModerationEvent`. Hand-
authored the migration (this repo's Supabase-specific RLS/`auth.jwt()` SQL
makes `prisma migrate dev`'s shadow-database diffing unusable here, matching
every prior migration in this history) applying the identical
`can_read_shared_user_row` / `can_write_shared_user_row` guardian-shared RLS
policy pair already proven for `GarmentItem`/`OutfitCapsule`. Applied cleanly
via `prisma migrate deploy` against local Supabase Postgres
(127.0.0.1:54322); `prisma migrate status` reports up to date. Extended
`rls-policies.spec.ts`'s shared scenario fixture with both new tables and
added a `4.4-DB-003` block set (owner, read-only guardian, full-access
guardian, admin, revoked consent, unrelated/unverified/spoofed/anonymous)
mirroring the existing `4.3-DB-003` OutfitCapsule set exactly, rather than
threading new-table assertions into all ~30 pre-existing scenario tests.
Added `wardrobe-onboarding-schema.spec.ts` proving defaults, one-row-per-user
uniqueness, global uniqueness on `my_form_object_path`, cascade-on-user-delete,
and the `ModerationEvent.silhouette_profile_id` set-null-on-delete behavior
against the real applied schema. Along the way, found and fixed unrelated
pre-existing local-DB drift: this machine's long-running local Supabase
Postgres container had `20260807080000_add_outfit_capsules` recorded as
applied before that migration file was later extended, so
`outfit-capsule-schema.spec.ts` was failing locally for a reason unconnected
to this story; ran `prisma migrate reset` (user-confirmed, since Prisma's own
AI-agent safety guard requires explicit consent for this destructive command)
to get a clean baseline. Full `@couture/db` suite: 72/72 passing, lint clean,
typecheck clean.

**Task 2 (branch `feat/epic4-story4-t2-contracts`).** Added onboarding-state
and silhouette Zod contracts (enums, `wardrobeOnboardingStateSchema`,
`silhouetteProfileSchema` with a nullable `myForm` sub-object, slider PUT,
My Form upload-url/uploads/commit/delete, every error schema) plus 8
`registry.registerPath` entries to `wardrobe.ts`, mirroring the existing
garment upload-url/bytes/commit and capsule revision/`If-Match` patterns
exactly — reused the existing generic `uploadGarmentBytes` helper for My Form
bytes rather than duplicating it, since its signature has no garment-specific
coupling. Added `wardrobe_onboarding_started`/`wardrobe_onboarding_completed`
to `analytics-events.ts` (event schema, snake_case properties schema, track
wrapper) and to the second properties-schema map in
`testing/analytics-event-assertions.ts` that a first pass missed (caught by
`tsc`, not by inspection). Added a `4.4-UNIT-001` negative-fixture spec
mirroring Story 4.3's `4.3-UNIT-004` pattern, proving both events' schemas
reject photo/media URLs, slider values, and free-form text. Added onboarding
and silhouette fixtures to `wardrobe-fixtures.ts`, and
`wardrobe-onboarding.factory.ts` / `silhouette-profile.factory.ts` with
in-memory and persisted builders, registered in the factory registry and
wired into `cleanup.ts` (`ModerationEvent` has no `user_id` column, so it
needed its own where-builder keyed on `id` and `silhouette_profile_id`,
deleted before `SilhouetteProfile`, before `WardrobeOnboardingState`, before
`GarmentItem`). Ran `generate:api-client`; `optic lint` and `build:packages`
both clean. Full suites: `@couture/api-client` 192/192 (was 161 before this
task), `@couture/testing` 9/9, both lint and typecheck clean.

**Task 3 + 4 (branch `feat/epic4-story4-t3t4-api`).** Onboarding:
server-authoritative forward-only step machine (`permission → capture →
{tagging|silhouette skip} → silhouette → complete`), garment count
recomputed server-side (never client-supplied) by counting real `ready`/
`awaiting_tags` `GarmentItem` rows created since `started_at` at the
transition into `silhouette`, so decision 3's "server-authoritative"
principle holds for the completion-telemetry payload too. Added two
telemetry-guard columns (`started_telemetry_emitted_at`,
`completed_telemetry_emitted_at`) via a small follow-up migration
discovered while implementing the exactly-once emission requirement —
row creation alone makes "started" exactly-once only on the happy path; a
crash between commit and emission needs its own guard, mirroring
`GarmentItem.completion_telemetry_emitted_at`.

Both onboarding and silhouette use a Postgres advisory transaction lock
(`pg_advisory_xact_lock(hashtext(...))`) rather than
`wardrobe-capsule.locks.ts`'s `SELECT ... FOR UPDATE` pattern, because that
pattern cannot lock a row that does not exist yet and the first-ever
PATCH/PUT for a user always starts from the no-row virtual-default state.
`$queryRaw` cannot deserialize `pg_advisory_xact_lock`'s `void` return
(`$executeRaw` can); documented as a P2010 gotcha for the next person who
reaches for this pattern.

Silhouette: sliders always set `mode: 'default_mannequin'` on save (the
explicit "switch back to sliders" action per AC2); extracted
`wardrobe.service.ts`'s upload-token HMAC helpers into
`wardrobe-upload-token.ts` so My Form reuses the identical signed-token
protocol instead of a second implementation. My Form upload-url allocation
upserts the one `SilhouetteProfile` row per user (unlike `GarmentItem`'s
one-row-per-attempt), best-effort removing a superseded storage object
after a successful reallocation.

Task 4: `HeuristicSilhouettePhotoModerationEngine` combines the border-vs-
center contrast check and a bare-skin-pixel-ratio heuristic in one engine
(Task 4's own bullet lists both inside the same class, resolving an
apparent tension with decision 8's "processing worker independently
measures contrast" wording). While building it, found and worked around a
real Sharp/libvips 0.34.5 behavior: `.stats()` chained directly after
`.extract()` reports the _pre-crop_ image's statistics, not the extracted
region's — confirmed by comparing raw pixel bytes against reported stats.
Materializing each extracted region to its own buffer first, then opening
a fresh `sharp()` instance on that buffer, is the workaround; documented
in the source so it isn't "fixed" back into the broken form later.
`FixtureSilhouettePhotoModerationEngine` reads its outcome from a
`FIXTURE:<outcome>:` marker prefix in the buffer, mirroring
`FixtureGarmentTaggingEngine`'s env-gate exactly.

Guardian notification (decision 6) is scoped to teen actors only, per
Task 4's literal bullet: an actor with no active `GuardianConsent` row gets
the failure marked on the profile alone, no `ModerationEvent`, no outbox
row. Risk 4.4-R01's real-BullMQ-Worker integration test
(`4.4-INT-15`) is the one genuinely novel test infrastructure this story
added: no existing suite in this repo ran a real `Worker` against real
Redis before. Risk 4.4-R03 (heuristic false-positive/false-negative
boundaries) and Risk 4.4-R02 (revision races, both tables) both have
dedicated test cases per the risk register.

Full `api` workspace: 668 unit + 67 integration tests passing (0 skipped
beyond 5 pre-existing, unrelated skips), lint clean, typecheck clean.

**Task 5 (branch `feat/epic4-story4-t5-web`).** Built the Web onboarding and
silhouette experience against the `t2-contracts` Zod contracts and generated
SDK only (Task 3/4's API implementation is not in this branch), per the
orchestration plan's note that Web/Mobile/Pact only hard-depend on Task 2.
Extended `apps/web/src/lib/wardrobe.ts` with `getOnboardingStateFromWeb` /
`advanceOnboardingStepFromWeb`, `getSilhouetteProfileFromWeb` /
`updateSilhouetteSlidersFromWeb`, `uploadMyFormPhotoFromWeb` /
`deleteMyFormPhotoFromWeb`, and `onboardingETag` / `silhouetteETag` helpers
building the `"onboarding:<userId>:<revision>"` / `"silhouette:<userId>:<revision>"`
strong entity tags exactly as decision 3 specifies, mirroring the capsule
`If-Match` discipline exactly. `uploadMyFormPhotoFromWeb` reuses the existing
generic `uploadGarmentBytes` helper (same pattern Task 2 already established
for the SDK side) and takes `idempotencyKey` as a caller-supplied parameter
rather than minting one internally, so the caller can reuse one key across an
upload attempt's retries — the exact bug class Story 4.3's review found in
`capsule-builder-modal.tsx`.

Built `apps/web/src/app/components/silhouette-settings-panel.tsx`: height/build
sliders that auto-save on change (400ms debounce) using the loaded revision's
strong entity tag, and a "My Form" upload flow (basewear-confirmation
checkbox gate with an inline `confirmRequired` error before any upload
starts, a file picker, a processing poll loop mirroring the wardrobe hub's
existing `pollCommittedGarment` cadence, all four reason-specific failure
messages with a retry action that reuses the same `idempotencyKey` and cached
image preview, and a ready state with a "Remove My Form photo" action).
Extracted the upload/error/ready UI into a `MyFormPanel` subcomponent to keep
the outer component's cyclomatic complexity under the project's lint budget.

Built `apps/web/src/app/wardrobe/onboarding/page.tsx`: on mount, fetches the
onboarding state and redirects to `/wardrobe` if already `completed` (decision
3); otherwise resumes directly at the persisted `currentStep` (no
`not_started`-only entry path) and announces `resumed` via a polite live
region when status was already `in_progress`. The permission step requests
`getUserMedia`, and either way immediately calls `PATCH targetStep: 'capture'`
(permission has no server-persisted screen of its own); a denial keeps a
local `permissionDenied` reminder visible through the capture step since the
view moves on before the user could otherwise see it. The capture/tagging
step reuses `GarmentCaptureModal`/`GarmentTaggingModal` exactly as the
wardrobe hub does (same auto-chain-into-tagging pattern, same invoker-ref
focus-restoration convention) with a live checklist rendered from
`tagsConfirmedAt`; "Use starter wardrobe" sends `usedStarterWardrobe: true`
with `targetStep: 'silhouette'` in one call per decision 2. The silhouette
step embeds `SilhouetteSettingsPanel` inline (no modal wrapper — the whole
route already is the guided surface) with a "Continue" button that PATCHes
`targetStep: 'complete'`, and the complete step routes to `/wardrobe`. Found
and fixed a real bug during TDD, not just a test artifact: an early draft
nested `<GarmentCaptureModal>`/`<GarmentTaggingModal>` inside the
`[data-app-shell]` div, so `AccessibleModal`'s own inert/`aria-hidden` on the
shell while open also hid the modal it belongs to; fixed by rendering both
modals as siblings of the app shell via a top-level fragment, matching
`wardrobe/page.tsx`'s existing structure exactly.

Added a "Set up your closet" entry-point card to `apps/web/src/app/wardrobe/page.tsx`,
shown while a best-effort onboarding-status fetch reports anything other than
`completed` (a failed fetch here silently leaves the card unshown rather than
surfacing a second, unrelated error banner on top of the hub's own). Added a
"Silhouette" header button opening `SilhouetteSettingsPanel` inside the
existing `AccessibleModal`, giving the settings surface decision 3 requires
outside onboarding and a second, real proof point for focus-trap/restoration
beyond the onboarding flow's inherited capture/tagging modals.

Added the full `wardrobe.onboarding.*` / `wardrobe.silhouette.*` camelCase key
tree (the story's canonical `en-US` JSON block, translated) to all 10 Web
locale catalogs, plus `wardrobe-onboarding-locales.spec.ts` mirroring Story
4.3's `wardrobe-capsules-locales.spec.ts` parity/placeholder/no-untranslated/
no-empty-string checks. "Silhouette" is a deliberate, approved cognate for
`de-DE`/`fr-FR`/`fr-CA`/`it-IT` (native loanword, identical spelling); every
other locale has a genuinely distinct translation. Did not touch the
pre-existing hardcoded garment capture/tagging strings on Web, per the task's
explicit scope note — that gap is unchanged.

The `wardrobe.onboarding.back` key ships in every locale catalog (the
canonical shape requires it) but is not wired to a control in this pass: the
onboarding state machine is forward-only server-side, no user journey in AC1
through AC5 requires stepping backward, and building a client-only
"review previous step" affordance risked exactly the state-machine edge cases
Story 4.3's review flagged for this kind of flow. Left as an explicit,
documented gap rather than an invented interaction.

Followed the project's TDD workflow throughout: every new function and
component has a test file written and run red before implementation, with
tests exercising the full Task 5 matrix — permission grant/deny, the
capture-loop checklist, the starter-wardrobe skip, slider persistence, "My
Form" upload through `ready` and each of the four `failed` reasons with
retry, a guardian-consent (`GUARDIAN_CONSENT_REQUIRED`) rejection surfaced
inline both at the silhouette-panel level and through the onboarding page's
capture step, focus trap and restoration (both the onboarding flow's
inherited capture-modal restoration and the wardrobe hub's own silhouette
modal), live announcements, and resume-after-reload. Full `apps/web` suite:
25/25 test files, 138/138 tests passing; `npm run lint --workspace web` and
`npm run typecheck --workspace web` both clean; no `.only` or skipped tests.
**Task 6 (branch `feat/epic4-story4-t6-mobile`).** Required first step:
extracted the garment-capture flow inline in `apps/mobile/app/(tabs)/wardrobe.tsx`
(ImagePicker calls, crop/upload state machine, inline `<Modal>`) into
`apps/mobile/components/wardrobe/garment-capture-modal.tsx`, mirroring Web's
`garment-capture-modal.tsx`/`wardrobe/page.tsx` split: the modal owns
capture/crop/upload and reports a committed garment plus the access token it
used back to the caller via `onGarmentCommitted`; the caller (wardrobe hub,
onboarding screen) owns what happens next (open tagging, poll a still-
processing garment). Along the way added the `accessibilityViewIsModal`/
title-focus/invoker-restoration conventions already proven in
`garment-tagging-modal.tsx` to the extracted modal, since the new onboarding
screen reuses it and Task 6 explicitly calls for those conventions. There
were no pre-existing tests for `wardrobe.tsx` to keep green (confirmed by
search); added a full regression suite instead, both for the extracted modal
(9 tests) and for the wardrobe hub screen end-to-end capture flow (8 tests,
including a real capture→commit→tagging-modal-opens run through MSW).

Discovered mid-task that `apps/mobile/vitest.config.ts`'s `include` only
covers `components/**` and `src/**`, not `app/**` — this is why `wardrobe.tsx`
and `wardrobe-capsules.tsx` have zero coverage today despite both being
non-trivial screens; a test file placed directly under `app/` silently never
runs. Followed the repo's own established fix for this
(`app/guardian-accept.tsx` → `src/features/guardian/guardian-accept-screen.tsx`):
moved the wardrobe hub, the new onboarding screen, and the new silhouette
settings screen into `src/features/wardrobe/*-screen.tsx`, each with a
co-located test file, leaving `app/(tabs)/wardrobe.tsx`, `app/wardrobe-onboarding.tsx`,
and `app/wardrobe-silhouette.tsx` as thin re-exports (the two new routes also
carry the `<Stack.Screen options={{ title }}>` nav-title wiring, kept out of
the testable feature component because `Stack.Screen`'s import chain pulls in
native-only `expo-asset`/`EventEmitter` modules this browser-based runner
can't polyfill — confirmed by direct reproduction).

Also found and fixed a latent, previously-untested bug while writing these
tests: react-native-web's `findNodeHandle` unconditionally throws
("not supported on web"), including when called synchronously during render
or from inside an event handler regardless of ref nullity (verified directly
with isolated probes). `wardrobe.tsx`'s pre-existing `findNodeHandle` call
sites were never guarded by the `Platform.OS !== 'web'` check that
`garment-tagging-modal.tsx`/`capsule-builder-modal.tsx` already use, and my
own extraction copied that same unguarded pattern for the new
`invokingNodeHandle` prop; added a local `safeFindNodeHandle` helper and
applied it at every call site in the wardrobe hub and onboarding screens.

Built `apps/mobile/components/wardrobe/silhouette-editor.tsx`, a component
shared by both the onboarding silhouette step and the standalone settings
screen (decision 3: bodies and closets change over time, so the same editor
must be reachable outside onboarding too): height/build steppers (0–100,
step 5, 44×44 targets, `accessibilityRole="adjustable"` plus explicit
increment/decrement buttons with boundary `accessibilityState.disabled`,
matching the reorder-button convention from the capsule modal) that persist
immediately per slider change (AC2's "persist immediately", not a separate
Save action, since the canonical copy block has no "Save" string); a
mode-tab switch between "Adjustable silhouette" and "My Form photo"; and the
full My Form pipeline (camera/library pick, resize to fit the 4096px max,
sha256, upload-url allocation with one idempotency key minted per attempt and
reused across that attempt's retries, `uploadGarmentBytes`, commit with
`confirmsBasewearGuidance: true`, then polling until `ready`/`failed`) with
all four failure reasons mapped to their canonical copy keys and a retry path
back to source selection. Guardian-consent 403s (`GUARDIAN_CONSENT_REQUIRED`)
are caught at every call site and rendered as a blocking message using the
existing `wardrobe.error.consent_required` key rather than inventing a new
onboarding/silhouette-specific one.

Built `apps/mobile/src/features/wardrobe/wardrobe-onboarding-screen.tsx`: a
server-authoritative step machine (`permission → capture/tagging → silhouette
→ complete`, or `capture(skipped) → silhouette` via "Use starter wardrobe")
driven entirely by GET/PATCH against `/api/v1/wardrobe/onboarding` with the
documented `"onboarding:<userId>:<revision>"` If-Match format; the `capture`
and `tagging` server steps share one UI phase with a live checklist (reusing
the newly extracted capture modal and the existing tagging modal), Continue
is disabled while any garment is `awaiting_tags`, and a resumed session (any
step past `permission` on first load) announces "Picking up where you left
off" through the existing accessibility-announcer live region. A redundant
retry path tracks the last attempted step transition (not just the current
phase) so retrying an advance-to-silhouette failure while still displaying
the capture step doesn't accidentally resubmit `targetStep: capture`.

Extended `apps/mobile/src/lib/wardrobe.ts` with GET/PATCH onboarding,
GET/PUT silhouette sliders, and My Form upload-url/commit/delete wrappers,
all through the generated `@couture/api-client` SDK client (matching this
file's existing `listGarmentsFromMobile` pattern), plus `onboardingETag`/
`silhouetteETag` builders. Left the pre-existing raw-`fetch` garment
allocation/commit calls in the extracted capture modal untouched — migrating
those to the generated client was not part of this extraction and would have
widened the regression surface without a corresponding requirement.

Added the `wardrobe.onboarding`/`wardrobe.silhouette` key trees (snake_case,
converted directly from the story's canonical camelCase block) to all 10
Mobile locale catalogs with real per-locale translations (not English
copies), reusing each locale's own already-established terminology for
"upload" (e.g. fr-CA "téléversement" vs fr-FR "chargement") rather than a
single machine translation for all Latin/Romance locales. `en-CA` mirrors
`en-US` verbatim, matching this catalog's existing convention (no US/CA
spelling divergence in this key set). Added a parity spec
(`wardrobe-onboarding-silhouette-locales.spec.ts`) mirroring Story 4.3's
`wardrobe-capsules-locales.spec.ts` pattern (identical key trees, matching
placeholders, no leaked English strings outside one documented cognate table
entry for "Silhouette" in fr/de/it, no empty strings); deliberately did not
add a Mobile-vs-Web key-parity check since decision text explicitly makes the
case conventions opposite, so a literal key match against Web would be
meaningless here.

Full mobile suite: `npm run test --workspace mobile` → 36 test files, 198
tests, all green (widget and watchOS prebuild checks included); `npm run lint
--workspace mobile` and `npm run typecheck --workspace mobile` both clean.
No `.only`/`.skip` anywhere. Confirmed no unrelated files were touched
(`npm install`'s MSW postinstall had regenerated
`apps/web/public/mockServiceWorker.js`; reverted it since it's outside this
task's scope).

Known gaps, left for the sessions/tasks that own them: Task 3/4 (API) is not
merged into this branch, so the exact server-side `onboarding`/`silhouette`
ETag format, PATCH validation errors, and My Form processing timing are
implemented here against the contracts and the documented
`"onboarding:<userId>:0"` example only, not against a running API; Task 7
(Pact) is the natural place to catch any drift once `t3t4-api` lands. This
story's own Task 8 (Playwright/Maestro) and Task 9 (verify:changed/validate)
are out of this branch's scope entirely.

### File list

**Task 1 (branch `feat/epic4-story4-t1-db`):**

- `packages/db/prisma/schema.prisma` (modified)
- `packages/db/prisma/migrations/20260809090000_add_wardrobe_onboarding_silhouette/migration.sql` (new)
- `packages/db/test/wardrobe-onboarding-schema.spec.ts` (new)
- `packages/db/test/rls-policies.spec.ts` (modified)

**Task 2 (branch `feat/epic4-story4-t2-contracts`):**

- `packages/api-client/src/contracts/http/wardrobe.ts` (modified)
- `packages/api-client/src/types/analytics-events.ts` (modified)
- `packages/api-client/src/testing/analytics-event-assertions.ts` (modified)
- `packages/api-client/src/testing/wardrobe-fixtures.ts` (modified)
- `packages/api-client/testing/wardrobe-onboarding-analytics.spec.ts` (new)
- `packages/api-client/docs/http.openapi.json` (generated, modified)
- `packages/api-client/src/generated/**` (generated, modified)
- `packages/testing/src/factories/wardrobe-onboarding.factory.ts` (new)
- `packages/testing/src/factories/silhouette-profile.factory.ts` (new)
- `packages/testing/src/factories/index.ts` (modified)
- `packages/testing/src/factories/registry.ts` (modified)
- `packages/testing/src/cleanup.ts` (modified)
- `packages/testing/test/cleanup.spec.ts` (modified)
- `packages/testing/templates/test-template.spec.ts` (modified)

**Task 3 + 4 (branch `feat/epic4-story4-t3t4-api`):**

- `packages/db/prisma/schema.prisma` (modified — telemetry-guard columns)
- `packages/db/prisma/migrations/20260809110000_add_onboarding_telemetry_guards/migration.sql` (new)
- `packages/utils/src/wardrobe-object-path.ts` (modified — `buildSilhouetteObjectPath`)
- `packages/utils/src/wardrobe-object-path.spec.ts` (modified)
- `apps/api/src/modules/wardrobe/wardrobe-onboarding.controller.ts` (new)
- `apps/api/src/modules/wardrobe/wardrobe-onboarding.controller.spec.ts` (new)
- `apps/api/src/modules/wardrobe/wardrobe-onboarding.service.ts` (new)
- `apps/api/src/modules/wardrobe/wardrobe-onboarding.service.spec.ts` (new)
- `apps/api/src/modules/wardrobe/wardrobe-silhouette.controller.ts` (new)
- `apps/api/src/modules/wardrobe/wardrobe-silhouette.controller.spec.ts` (new)
- `apps/api/src/modules/wardrobe/wardrobe-silhouette.service.ts` (new)
- `apps/api/src/modules/wardrobe/wardrobe-silhouette-image-validation.ts` (new)
- `apps/api/src/modules/wardrobe/wardrobe-silhouette-image-validation.spec.ts` (new)
- `apps/api/src/modules/wardrobe/wardrobe-upload-token.ts` (new — extracted from `wardrobe.service.ts`)
- `apps/api/src/modules/wardrobe/wardrobe-upload-token.spec.ts` (new)
- `apps/api/src/modules/wardrobe/wardrobe.service.ts` (modified — consumes extracted upload-token helpers)
- `apps/api/src/modules/wardrobe/silhouette-photo-moderation.engine.ts` (new)
- `apps/api/src/modules/wardrobe/heuristic-silhouette-photo-moderation.engine.ts` (new)
- `apps/api/src/modules/wardrobe/fixture-silhouette-photo-moderation.engine.ts` (new)
- `apps/api/src/modules/wardrobe/silhouette-photo-moderation.engine.spec.ts` (new)
- `apps/api/src/modules/wardrobe/silhouette-photo-processing.queue.ts` (new)
- `apps/api/src/modules/wardrobe/silhouette-photo-processing.queue.spec.ts` (new)
- `apps/api/src/modules/wardrobe/silhouette-photo.processor.ts` (new)
- `apps/api/src/modules/wardrobe/silhouette-photo.processor.spec.ts` (new)
- `apps/api/src/modules/wardrobe/wardrobe.module.ts` (modified)
- `apps/api/src/workers/wardrobe.bootstrap.ts` (modified — registers `moderation-review` consumer)
- `apps/api/src/workers/bootstrap.ts` (modified — removes the placeholder consumer)
- `apps/api/integration/wardrobe-onboarding.integration.spec.ts` (new)
- `apps/api/integration/wardrobe-silhouette.integration.spec.ts` (new)

**Task 5 (branch `feat/epic4-story4-t5-web`):**

- `apps/web/src/lib/wardrobe.ts` (modified)
- `apps/web/src/lib/wardrobe.test.ts` (modified)
- `apps/web/src/app/components/silhouette-settings-panel.tsx` (new)
- `apps/web/src/app/components/silhouette-settings-panel.test.tsx` (new)
- `apps/web/src/app/wardrobe/onboarding/page.tsx` (new)
- `apps/web/src/app/wardrobe/onboarding/page.test.tsx` (new)
- `apps/web/src/app/wardrobe/page.tsx` (modified)
- `apps/web/src/app/wardrobe/page.test.tsx` (modified)
- `apps/web/src/i18n/locales/en-US.json` (modified)
- `apps/web/src/i18n/locales/en-CA.json` (modified)
- `apps/web/src/i18n/locales/de-DE.json` (modified)
- `apps/web/src/i18n/locales/es-419.json` (modified)
- `apps/web/src/i18n/locales/fr-CA.json` (modified)
- `apps/web/src/i18n/locales/fr-FR.json` (modified)
- `apps/web/src/i18n/locales/it-IT.json` (modified)
- `apps/web/src/i18n/locales/pt-BR.json` (modified)
- `apps/web/src/i18n/locales/pt-PT.json` (modified)
- `apps/web/src/i18n/locales/tr-TR.json` (modified)
- `apps/web/src/i18n/wardrobe-onboarding-locales.spec.ts` (new)
  **Task 6 (branch `feat/epic4-story4-t6-mobile`):**

- `apps/mobile/components/wardrobe/garment-capture-modal.tsx` (new — extracted
  from `apps/mobile/app/(tabs)/wardrobe.tsx`)
- `apps/mobile/components/wardrobe/garment-capture-modal.test.tsx` (new)
- `apps/mobile/components/wardrobe/silhouette-editor.tsx` (new)
- `apps/mobile/components/wardrobe/silhouette-editor.test.tsx` (new)
- `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.tsx` (new — moved out
  of `apps/mobile/app/(tabs)/wardrobe.tsx` for test-runner coverage; adds the
  onboarding entry-point card and the silhouette settings link)
- `apps/mobile/src/features/wardrobe/wardrobe-hub-screen.test.tsx` (new)
- `apps/mobile/src/features/wardrobe/wardrobe-onboarding-screen.tsx` (new)
- `apps/mobile/src/features/wardrobe/wardrobe-onboarding-screen.test.tsx` (new)
- `apps/mobile/src/features/wardrobe/wardrobe-silhouette-screen.tsx` (new)
- `apps/mobile/src/features/wardrobe/wardrobe-silhouette-screen.test.tsx` (new)
- `apps/mobile/app/(tabs)/wardrobe.tsx` (modified — now a thin re-export of
  `WardrobeHubScreen`)
- `apps/mobile/app/wardrobe-onboarding.tsx` (new — thin route wrapper)
- `apps/mobile/app/wardrobe-silhouette.tsx` (new — thin route wrapper)
- `apps/mobile/src/lib/wardrobe.ts` (modified — onboarding/silhouette
  generated-SDK wrappers and ETag helpers)
- `apps/mobile/src/lib/wardrobe.test.ts` (new)
- `apps/mobile/src/i18n/wardrobe-onboarding-silhouette-locales.spec.ts` (new)
- `apps/mobile/assets/locales/en-US.json` (modified)
- `apps/mobile/assets/locales/en-CA.json` (modified)
- `apps/mobile/assets/locales/es-419.json` (modified)
- `apps/mobile/assets/locales/fr-CA.json` (modified)
- `apps/mobile/assets/locales/fr-FR.json` (modified)
- `apps/mobile/assets/locales/de-DE.json` (modified)
- `apps/mobile/assets/locales/it-IT.json` (modified)
- `apps/mobile/assets/locales/pt-BR.json` (modified)
- `apps/mobile/assets/locales/pt-PT.json` (modified)
- `apps/mobile/assets/locales/tr-TR.json` (modified)
