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

- [ ] Task 1: Prisma schema, migration, RLS (AC: 1 to 4)
  - [ ] Add `WardrobeOnboardingStatus`, `WardrobeOnboardingStep`, `SilhouetteMode`,
        `SilhouettePhotoStatus`, and `SilhouettePhotoFailureReason` enums to
        `packages/db/prisma/schema.prisma`.
  - [ ] Add `WardrobeOnboardingState` (`user_id` unique, `status`, `current_step`,
        `used_starter_wardrobe Boolean @default(false)`,
        `garments_captured_count Int @default(0)`, `started_at`, `completed_at`,
        `revision Int @default(0)`, timestamps) and its singular relation on `User`.
  - [ ] Add `SilhouetteProfile` (`user_id` unique, `mode`, `height_slider Int?`,
        `build_slider Int?`, the full `my_form_*` upload-lifecycle field set mirroring
        `GarmentItem` — object path, upload session id, idempotency keys, payload
        hash, file size, mime type, sha256, dimensions, `upload_expires_at`,
        `committed_at`, `consent_checked_at`, `status`, `failure_reason`,
        `moderation_flagged_at`, `retention_status`, `revision Int @default(0)`,
        timestamps) and its singular relation on `User`.
  - [ ] Add optional `silhouette_profile_id` to `ModerationEvent` plus its relation.
  - [ ] Generate the migration under `packages/db/prisma/migrations` with guardian-
        shared RLS policies (`can_read_shared_user_row` / `can_write_shared_user_row`)
        on both new tables, and the indexes needed for owner lookup by `user_id`.
  - [ ] Extend `packages/db/test/rls-policies.spec.ts` with the same owner, read-only
        guardian, full-access guardian, admin, revoked/pending consent, unverified
        claim, spoofed metadata, unrelated, anonymous, and service-role matrix already
        used for `GarmentItem`, applied to both new tables.
  - [ ] Add `packages/db/test/wardrobe-onboarding-schema.spec.ts` that applies the
        migration to seeded data and directly proves defaults, uniqueness, cascades,
        indexes, policies, and grants (apply-the-migration evidence, not string-
        grepping the migration file — Story 4.3's review found and fixed exactly that
        shortcut).

- [ ] Task 2: Wardrobe contracts, fixtures, and factories (AC: 1 to 5)
  - [ ] Define strict onboarding-state read/PATCH schemas, silhouette slider
        read/PUT schemas, "My Form" upload-url/commit/delete schemas, revision, ETag,
        `If-Match`, and every error schema in
        `packages/api-client/src/contracts/http/wardrobe.ts`.
  - [ ] Register every endpoint, header, response code, and error with
        `OpenAPIRegistry` in `packages/api-client/src/contracts/http/openapi.ts`.
  - [ ] Add `wardrobe_onboarding_started` and `wardrobe_onboarding_completed` to
        `analyticsEventNameSchema` and their strict property allowlists plus tracking
        wrappers in `packages/api-client/src/types/analytics-events.ts`. Add negative
        fixtures proving no photo, silhouette detail, or free-form text ever appears
        in analytics properties.
  - [ ] Add deterministic onboarding/silhouette fixtures to
        `packages/api-client/src/testing/wardrobe-fixtures.ts`.
  - [ ] Add `packages/testing/src/factories/wardrobe-onboarding.factory.ts` and
        `packages/testing/src/factories/silhouette-profile.factory.ts` with in-memory
        and persisted builders. Register both in
        `packages/testing/src/factories/registry.ts` and extend
        `packages/testing/src/cleanup.ts` for reverse-dependency cleanup (moderation
        events referencing a silhouette profile before the profile, before the user).
  - [ ] Run `npm run generate:api-client`; inspect and commit the generated OpenAPI
        and SDK changes without hand-editing generated files.

- [ ] Task 3: Onboarding-state and silhouette API (AC: 1 to 4)
  - [ ] Add `wardrobe-onboarding.controller.ts` and `wardrobe-onboarding.service.ts`
        under `RequestAuthGuard` at `/api/v1/wardrobe/onboarding`. `GET` returns
        current state or a virtual `not_started` default (ETag
        `"onboarding:<userId>:0"`) without persisting a row. `PATCH` validates the
        requested step transition against the forward-only state machine, requires
        `If-Match`, and is a no-op-safe replay for an identical payload against the
        current revision.
  - [ ] Add `wardrobe-silhouette.controller.ts` and `wardrobe-silhouette.service.ts`
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
  - [ ] Set `Cache-Control: private, no-store` on every success and error response for
        both controllers; follow the `CapsuleCacheHeadersMiddleware` pattern from
        `wardrobe-capsule.cache-headers.middleware.ts` if per-handler headers cannot
        reach guard- or validation-raised errors, exactly the gap Story 4.3 found and
        fixed.
  - [ ] Register both controllers and services, plus the new queue class from Task 4,
        in `wardrobe.module.ts`.

- [ ] Task 4: "My Form" processing pipeline (AC: 2, 3)
  - [ ] Add `verifySilhouettePhoto` alongside `verifyGarmentImage` in a new
        `wardrobe-silhouette-image-validation.ts`, reusing its declared-payload and
        decoded-metadata checks with a portrait-framing constraint
        (`heightPx >= widthPx * 1.2`).
  - [ ] Add `SilhouettePhotoModerationEngine` interface, `garment-tagging.engine.ts`-
        style, plus `HeuristicSilhouettePhotoModerationEngine` (Sharp-based border-vs-
        center contrast distance and bare-skin-pixel-ratio heuristic) and
        `FixtureSilhouettePhotoModerationEngine` (gated by
        `SILHOUETTE_MODERATION_ENGINE=fixture` and `allowsTestOnlySecrets()`,
        mirroring `FixtureGarmentTaggingEngine`).
  - [ ] Add `SilhouettePhotoProcessingQueue`, mirroring `WardrobeProcessingQueue`
        exactly, enqueuing onto the existing `moderation-review` BullMQ queue
        (`apps/api/src/config/queues.ts`) with `jobId: silhouetteProfileId`.
  - [ ] Add `SilhouettePhotoProcessor`, mirroring `WardrobeColorProcessor`: downloads
        the photo, runs the contrast check then the moderation engine, writes a
        terminal `ready`/`contrast`/`privacy_violation` result without throwing, and
        lets a genuine storage/timeout fault propagate so BullMQ's existing 3-attempt
        exponential backoff retries it; on final-attempt exhaustion calls a new
        two-argument `markFailed(silhouetteProfileId, 'timeout' | 'storage_error')` at
        the same call-site position `wardrobe.bootstrap.ts` uses for
        `WardrobeColorProcessor.markFailed(garmentId)` today. That existing method
        takes one argument because `GarmentItem.failure_code` is free-form text; this
        is a new two-argument signature on the new processor, not a literal copy.
  - [ ] Register the worker consumer for the `moderation-review` queue in
        `apps/api/src/workers/wardrobe.bootstrap.ts`, following the exact
        `color-extraction` worker registration already there. In the same change,
        remove the no-op placeholder consumer for `moderation-review` from
        `apps/api/src/workers/bootstrap.ts`
        (`createWorker('moderation-review', async () => Promise.resolve(), ...)`).
        Two Worker instances subscribed to the same queue name from different
        processes split jobs nondeterministically; leaving the placeholder running
        would silently drop a fraction of silhouette jobs with no error.
  - [ ] For a `privacy_violation` verdict on a teen actor's photo: write a
        `ModerationEvent` row (`silhouette_profile_id`, `action`, `reason`) and enqueue
        a guardian-notification `EventEnvelope` (`channel:
'email.guardian-silhouette-flag'`) inside the same transaction, mirroring
        `guardian.service.ts`'s existing `email.guardian-invitation` outbox pattern.

- [ ] Task 5: Web onboarding and silhouette experience (AC: 1, 2, 3, 5)
  - [ ] Add `apps/web/src/app/wardrobe/onboarding/page.tsx` as the guided flow: a
        permission step, a capture/tagging loop that renders the existing
        `GarmentCaptureModal` and `GarmentTaggingModal` inline with a running
        checklist, a "Use starter wardrobe" skip action, a silhouette step (sliders
        plus "My Form" upload with the basewear-confirmation checkbox and inline
        retry), and a completion step that routes to the wardrobe hub.
  - [ ] Add a "Set up your closet" entry-point card to
        `apps/web/src/app/wardrobe/page.tsx` (read the current file fully before
        editing — it already owns polling, capture-modal invocation, and focus-
        restoration state) shown while `WardrobeOnboardingState.status` is not
        `completed`.
  - [ ] Add a silhouette settings section reachable outside onboarding (decision 3),
        reusing the same slider and "My Form" components.
  - [ ] Extend `apps/web/src/lib/wardrobe.ts` through generated API-client wrappers.
        Reuse one idempotency key per logical upload attempt; do not mint a fresh key
        per call, the exact bug Story 4.3's review found in
        `capsule-builder-modal.tsx`.
  - [ ] Add the `wardrobe.onboarding.*` and `wardrobe.silhouette.*` key trees to all
        10 Web locale catalogs under `apps/web/src/i18n/locales`, following the
        camelCase convention Story 4.3 established there (the Web catalogs currently
        contain only `wardrobe.capsules`; garment capture/tagging strings on Web
        remain hardcoded from Story 4.1/4.2 — do not silently fix that pre-existing
        gap as part of this story's scope, call it out in Dev Notes instead).
  - [ ] Add component and integration tests for every state: permission grant/deny,
        capture-loop checklist, starter-wardrobe skip, slider persistence, "My Form"
        upload through `ready`/each `failed` reason with retry, guardian-consent
        rejection for a teen actor, focus trap and restoration, live announcements,
        and resume-after-reload.

- [ ] Task 6: Mobile onboarding and silhouette experience (AC: 1, 2, 3, 5)
  - [ ] Extract the garment-capture flow already inline in
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
  - [ ] Add `apps/mobile/app/wardrobe-onboarding.tsx` mirroring the Web flow, reusing
        the existing mobile `garment-tagging-modal.tsx` and the newly extracted
        `garment-capture-modal.tsx` for the capture/tagging loop.
  - [ ] Add a silhouette settings screen reachable outside onboarding, with the same
        slider and "My Form" flows using `accessibilityRole`/`accessibilityState` and
        `accessibilityViewIsModal` conventions already proven in the mobile capsule
        modal.
  - [ ] Add the entry-point card to `apps/mobile/app/(tabs)/wardrobe.tsx` (read fully
        before editing).
  - [ ] Extend `apps/mobile/src/lib/wardrobe.ts` through generated API-client
        wrappers.
  - [ ] Add `wardrobe.onboarding` and `wardrobe.silhouette` key trees to all 10 Mobile
        locale files under `apps/mobile/assets/locales`, following the existing
        snake_case convention there (`add_garment`, `empty_title`) — note this is the
        opposite case convention from the Web catalogs' camelCase; do not unify them
        as part of this story.
  - [ ] Add component and screen tests mirroring the Web matrix in Task 5, plus
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

Status of each branch is tracked here as work proceeds:

- [ ] `feat/epic4-story4-t1-db` — not started
- [ ] `feat/epic4-story4-t2-contracts` — not started
- [ ] `feat/epic4-story4-t3t4-api` — not started
- [ ] `feat/epic4-story4-t5-web` — not started
- [ ] `feat/epic4-story4-t6-mobile` — not started
- [ ] `feat/epic4-story4-t7-pact` — not started
- [ ] `feat/epic4-story4-t8-e2e` — not started
- [ ] `feat/epic4-story4-t9-verify` — not started

### Completion notes list

_To be filled by the dev agent._

### File list

_To be filled by the dev agent._
