---
baseline_commit: 75e24cf25220f6de3652bbafcf8f713593e6004e
---

<!-- markdownlint-disable MD013 MD036 MD052 -->

# Story 4.2: Smart tagging and comfort metadata

Status: done

Updated: 2026-08-05: completed Tasks 1-9, resolved the full code review, and passed the
Test Architect re-review across API, database, contracts, Web, Mobile, Playwright, and Maestro

## Story

As a CoutureCast user,
I want garment category, material, and comfort suggestions that I can review,
so that my wardrobe is quick to organize and useful for personalized outfits.

## Scope and non-negotiable decisions

This story extends Story 4.1. Upload commit still sets `committed_at` and enqueues the
existing `color-extraction` job. Story 4.2 completes color extraction and smart tagging from
that queue in a dedicated wardrobe worker process, then requires the user to confirm the tags
before the garment becomes eligible for `RitualService`.

### Garment lifecycle

The only valid lifecycle for a new successful upload is:

`pending_upload` -> `bytes_uploaded` -> `processing` -> `awaiting_tags` -> `ready`

- `committed_at` remains the upload commit timestamp. Tag confirmation never changes it.
- Successful image and color processing always ends at `awaiting_tags`, even when tag
  inference is unavailable. The user can finish through manual selection.
- Core image or color processing failure ends at `failed` under the Story 4.1 behavior.
- A garment reaches `ready` only after valid `category` and `comfort_range` values are saved.
- Closing either tagging modal leaves the garment at `awaiting_tags`. Wardrobe lists show a
  localized `Needs tags` action for resuming the flow.
- A later edit to an already `ready` garment stays `ready` and updates `updated_at`.
- Garments at `awaiting_tags`, `failed`, or a non-active retention state are excluded from
  outfit generation.

### Inference and privacy

- Run inference inside a dedicated wardrobe worker entry point in `apps/api`. Garment bytes
  stay within the existing private storage and worker boundary. No image, signed URL, or
  embedding is sent to an external inference service.
- Use `@huggingface/transformers` version `3.8.1` with the official
  `patrickjohncyh/fashion-clip` ONNX model at revision
  `7e3ba62ce16b379a1ab479346b66f192e76f51b7`.
- Use `onnx/model.onnx` in `fp32`. Its expected SHA-256 is
  `dc4c724479e49d1da9598969125353113a341bd4fd5a1dbc7d528d3f1545bba9`.
- Worker deployment preparation runs `prepare:tagging-model` and includes the pinned snapshot
  at `GARMENT_TAGGING_MODEL_DIR`. Runtime configuration sets
  `env.allowRemoteModels = false`, points `env.localModelPath` to that snapshot, and fails
  wardrobe worker startup when the manifest or model checksum is invalid.
- Do not commit model binaries. Commit the small integrity manifest and the preparation and
  verification script.
- Initialize one supervised inference worker thread per wardrobe worker process. The thread
  owns one model instance. Consume the existing `color-extraction` queue at concurrency `1`
  because image preprocessing and `fp32` inference are memory intensive.
- Load and warm the production model before the wardrobe worker begins consuming jobs. Apply a
  `30,000` millisecond timeout to inference after warmup. A timeout terminates the inference
  thread before returning a recoverable failure and starts a replacement thread. Do not use
  `Promise.race` around an uninterruptible inference call.
- Provide a `GarmentTaggingEngine` interface. Production uses the local FashionCLIP adapter.
  Tests use a deterministic fixture adapter only when
  `GARMENT_TAGGING_ENGINE=fixture` and the existing `allowsTestOnlySecrets()` check is true.
  Production must fail closed if fixture mode is requested.
- English prompts are internal model inputs. Persist canonical enum values and localize only
  user-facing labels.
- Pass the decoded image buffer already loaded by `WardrobeColorProcessor` into the engine.
  Do not download the same private object a second time.
- Preserve both existing color outputs: `GarmentItem.color_palette` and the
  `PaletteInsights` upsert remain in the same database transaction as the new status and
  suggestion metadata.
- Keep weather, alert, and moderation workers in the existing general bootstrap. A wardrobe
  model load failure must not stop unrelated queues.
- Add exact API package scripts `prepare:tagging-model`, `verify:tagging-model`,
  `test:tagging-model:smoke`, `start:workers:wardrobe`, and
  `start:workers:wardrobe:prod`. Production start verifies the prepared local snapshot and
  performs no download.
- Configure the absolute snapshot location with `GARMENT_TAGGING_MODEL_DIR`. Document it in
  `.env.example`, ignore the local cache in `.gitignore`, and update the worker deployment
  runbook with the required prepare, verify, migrate, and start order.
- Emit structured worker logs for analysis version, outcome, duration, and stable failure code.
  Never log image bytes, signed URLs, object paths, prompts containing user data, embeddings,
  or raw model tensors.

### Canonical values and confidence

Use these enums in Prisma, Zod, OpenAPI, generated clients, UI options, and tests:

| Field          | Canonical values                                                                     |
| -------------- | ------------------------------------------------------------------------------------ |
| `category`     | `top`, `bottom`, `outerwear`, `dress`, `shoes`, `accessory`                          |
| `material`     | `cotton`, `wool`, `linen`, `leather`, `denim`, `fleece`, `synthetic`, `down`, `silk` |
| `comfortRange` | `cold`, `cool`, `mild`, `warm`, `hot`                                                |

The engine runs zero-shot classification with these exact labels:

| Value       | Prompt                                                                      |
| ----------- | --------------------------------------------------------------------------- |
| `top`       | `a photo of a shirt, blouse, sweater, or other upper-body garment`          |
| `bottom`    | `a photo of pants, jeans, shorts, or a skirt`                               |
| `outerwear` | `a photo of a coat, jacket, blazer, or other outerwear`                     |
| `dress`     | `a photo of a dress or one-piece garment`                                   |
| `shoes`     | `a photo of shoes, boots, sandals, or other footwear`                       |
| `accessory` | `a photo of a wearable accessory such as a bag, scarf, hat, or belt`        |
| `cotton`    | `a garment made primarily from cotton fabric`                               |
| `wool`      | `a garment made primarily from wool`                                        |
| `linen`     | `a garment made primarily from linen`                                       |
| `leather`   | `a garment made primarily from leather`                                     |
| `denim`     | `a garment made primarily from denim`                                       |
| `fleece`    | `a garment made primarily from fleece`                                      |
| `synthetic` | `a garment made primarily from synthetic fabric such as polyester or nylon` |
| `down`      | `an insulated garment filled with down`                                     |
| `silk`      | `a garment made primarily from silk`                                        |

For each classification group, normalize model logits with softmax and return the top score
as `confidence` in the inclusive range `0` through `1`.

- Category is confident when top score is at least `0.55` and the top-one versus top-two
  margin is at least `0.15`.
- Material is confident when top score is at least `0.45` and the margin is at least `0.10`.
- A confident suggestion is preselected. A low-confidence suggestion is displayed with a
  localized `Needs review` label and remains unselected.
- Comfort is derived deterministically from the top category and material result:

| Condition, evaluated in order           | `comfortRange` |
| --------------------------------------- | -------------- |
| Material is `down`, `wool`, or `fleece` | `cold`         |
| Category is `outerwear`                 | `cool`         |
| Material is `denim` or `leather`        | `cool`         |
| Material is `cotton` or `synthetic`     | `mild`         |
| Material is `silk`                      | `warm`         |
| Material is `linen`                     | `hot`          |
| No preceding rule matches               | `mild`         |

Comfort confidence is the lower of category and material confidence when both inputs are
confident. Otherwise it is the lower of the available scores, capped at `0.49`, and
`isConfident` is false.

### Persisted suggestion snapshot

Inference occurs once in the worker. The suggestion endpoint reads the persisted result and
never reruns the model. Persist a strict JSON snapshot with this shape:

```ts
type GarmentTagSuggestionSnapshot = {
  analysisVersion: string
  category: { value: GarmentCategory; confidence: number; isConfident: boolean }
  material: { value: GarmentMaterial; confidence: number; isConfident: boolean }
  comfortRange: {
    value: GarmentComfortRange
    confidence: number
    isConfident: boolean
  }
}
```

Set `analysisVersion` to
`fashion-clip:7e3ba62ce16b379a1ab479346b66f192e76f51b7:prompts-v1`.
Validate this JSON through the shared Zod schema before every database write and read.
Treat a malformed persisted snapshot as unavailable: log a structured corruption error, return
the same suggestion-route `503`, and allow manual confirmation. First manual confirmation clears
the malformed JSON, stores `TAGGING_OUTPUT_INVALID`, and computes telemetry as no suggestion.

Use only these internal `tagging_failure_code` values:

- `TAGGING_INFERENCE_FAILED`: model execution threw or exceeded `30,000` milliseconds.
- `TAGGING_OUTPUT_INVALID`: inference returned non-finite scores or failed snapshot validation.
- `LEGACY_TAGS_REQUIRED`: migration moved an untagged legacy row to `awaiting_tags`.

### API contract

Add these authenticated routes under the existing `WardrobeController` class guards:

- `POST /api/v1/wardrobe/garments/{garmentId}/suggest-tags`
- `PATCH /api/v1/wardrobe/garments/{garmentId}/tags`

`WardrobeController` already applies `RequestAuthGuard` and `WardrobeUploadGuard`. Reuse
them. Do not create another auth, ownership, age, consent, storage, or queue mechanism.
Set `@HttpCode(200)` on the POST suggestion handler because Nest POST handlers default to
`201`. Set `Cache-Control: private, no-store` on both tagging responses.

The successful suggestion response is strict:

```json
{
  "data": {
    "garmentId": "garment-id",
    "analysisVersion": "fashion-clip:7e3ba62ce16b379a1ab479346b66f192e76f51b7:prompts-v1",
    "suggestions": {
      "category": { "value": "top", "confidence": 0.84, "isConfident": true },
      "material": { "value": "cotton", "confidence": 0.67, "isConfident": true },
      "comfortRange": { "value": "mild", "confidence": 0.67, "isConfident": true }
    }
  }
}
```

The strict tag update body is:

```json
{
  "category": "top",
  "material": "cotton",
  "comfortRange": "mild"
}
```

- `category` and `comfortRange` are required.
- `material` is optional and nullable. Omission preserves the stored value. Explicit `null`
  clears it.
- Unknown keys and values are rejected.
- A successful update returns `{ "data": GarmentItemContract }`.
- Extend `GarmentItemContract` with the `awaiting_tags` status, typed `category`, typed
  `material`, typed `comfortRange`, and nullable `tagsConfirmedAt`.
- All controller responses are parsed by the shared Zod response schema before return.
- Register both paths and every response in the OpenAPI 3.1 registry. Regenerate the SDK.
  Never hand-edit `packages/api-client/src/generated/`.

Reuse the existing Nest error envelope. Add strict route-specific schemas for the constant
tagging messages below. For Zod failures, use the existing controller `validationMessage()`
helper with `Invalid garment id` or `Invalid garment tags` as its prefix.

Use this exact error behavior for both routes unless a row says otherwise:

| Condition                                                            | HTTP                         | Exception message                             |
| -------------------------------------------------------------------- | ---------------------------- | --------------------------------------------- |
| Missing bearer token                                                 | `401`                        | `Missing or invalid bearer token`             |
| Token identity resolution fails                                      | `401`                        | `Invalid access token`                        |
| Global teen access state is blocked                                  | `403`                        | `Guardian consent required before continuing` |
| Wardrobe age or consent rule denies tagging                          | `403`                        | `GUARDIAN_CONSENT_REQUIRED`                   |
| Garment is absent or belongs to another user                         | `404`                        | `GARMENT_NOT_FOUND`                           |
| Present path parameter fails its schema                              | `400`                        | Prefix `Invalid garment id`                   |
| Update body fails its strict schema                                  | `400`                        | Prefix `Invalid garment tags`                 |
| Garment is still `pending_upload`, `bytes_uploaded`, or `processing` | `409`                        | `GARMENT_ANALYSIS_PENDING`                    |
| Garment is `failed` or retention is not `active`                     | `409`                        | `GARMENT_NOT_TAGGABLE`                        |
| Snapshot is absent or invalid                                        | `503`, suggestion route only | `TAGGING_INFERENCE_UNAVAILABLE`               |

The suggestion route returns the same persisted response for repeated calls. The update route
is idempotent for an identical body. It supports `awaiting_tags` to `ready` confirmation and
later edits while `ready`.

For an already `ready` garment, compare the normalized update body to stored values. If they
are equal, return the current contract without a database write, `updated_at` change, cache
invalidation, or telemetry action.

### Telemetry and cache behavior

- Emit `garment_tagging_completed` only from the API after the first successful transition
  from `awaiting_tags` to `ready`. Frontends do not emit this completion event.
- Add the event name, input schema, snake-case properties schema, track wrapper, API
  `TelemetryPropertiesMap` entry, runtime validator, builder, pseudonymization path, and
  tests. Follow the existing `garment_upload_completed` privacy pattern.
- Event properties are: `garment_id`, `suggested_category`, `confirmed_category`,
  `suggested_material`, `confirmed_material`, `suggested_comfort_range`,
  `confirmed_comfort_range`, `suggestion_available`, `analysis_version`, `was_overridden`,
  and `override_fields`. Suggested values and `analysis_version` are nullable when no snapshot
  exists. Confirmed material is nullable.
- `was_overridden` is true when any confirmed value differs from the persisted suggestion.
  A confirmed null material differs from a non-null suggested material.
- `override_fields` contains only `category`, `material`, and `comfort_range`, sorted in that
  order. When no snapshot exists, set `suggestion_available` to false,
  `was_overridden` to false, and `override_fields` to an empty array.
- Store a `tagging_telemetry_emitted_at` claim in the same transaction as first
  confirmation. This creates at-most-once completion emission under concurrent retries.
- Store only the pseudonymous analytics subject and set `$ip` to `null`. Do not include
  image bytes, image URLs, object paths, color palettes, embeddings, raw user IDs, or free
  text.
- Tag persistence succeeds even if telemetry or cache invalidation fails. Log those failures
  through the existing structured logger.
- Call `RitualService.invalidateUserCache(userId)` after a successful database transaction.
  Retain the existing database freshness check so a Redis invalidation failure still causes
  stale recommendations to be recomputed.

### Ritual integration

Update both the wardrobe selection query and the latest-garment staleness query in
`RitualService.getOrCreateRitual()` with the same eligibility filter:

```ts
where: {
  user_id: userId,
  retention_status: 'active',
  upload_status: 'ready',
  category: { not: null },
  comfort_range: { not: null },
}
```

Use deterministic wardrobe ordering:

```ts
orderBy: [{ updated_at: 'desc' }, { id: 'asc' }]
```

Preserve the existing category selection, comfort adjacency, per-category defaults,
temperature thresholds, and `runs_cold_warm` adjustment. Preserve the existing wind and
precipitation reasoning badges. This story does not infer waterproof or windproof traits.
Material is persisted for display, telemetry, and later stories. It does not change outfit
selection in this story.

### Web and mobile behavior

- After upload commit, poll the existing garment list after `1`, `2`, `4`, and `8` seconds.
  Stop after `15` seconds, on terminal `failed`, or when `awaiting_tags` or `ready` appears.
- Track the committed garment ID. Allow one polling sequence per client, prevent overlapping
  list requests, and cancel timers and requests on navigation, unmount, or a new commit.
- Open tagging automatically when the committed garment reaches `awaiting_tags`. If the user
  navigates away or polling expires, keep the garment visible with `Needs tags` so the flow
  can be resumed.
- Never stack capture and tagging dialogs. If processing completes while capture completion is
  still open, defer tagging until capture closes, then transfer focus into the tagging modal.
- Load the persisted suggestion snapshot when the modal opens. A `503` response opens manual
  mode with no preselection. A `409 GARMENT_ANALYSIS_PENDING` response shows a localized
  progress message and retry action.
- Include a localized `Not sure` option in the material group. It maps to explicit null so a
  user can reject or clear a material suggestion. Material remains optional.
- Disable save until category and comfort are selected. Disable duplicate submissions while
  saving.
- Keep the modal open on an API error, announce the error, and preserve the draft.
- On success, reconcile from the API response, close the modal, and refresh the wardrobe list.
- Use the generated SDK through `apps/web/src/lib/api-client.ts` and
  `apps/mobile/src/lib/api-client.ts`. Add feature helpers to the existing web wardrobe helper
  and a matching mobile wardrobe helper. Do not create another handwritten HTTP client.

For Web, extract the focus management from the existing capture modal into
`apps/web/src/app/components/accessible-modal.tsx`, then use it for both capture and tagging:

- `role="dialog"`, `aria-modal="true"`, accessible title, and accessible description.
- Initial focus, Tab and Shift+Tab focus trap, Escape close, body scroll lock, and focus
  restoration to the invoking control.
- For automatic open, treat the garment's `Needs tags` action as the invoking control. If it
  is not mounted, restore focus to `Add Garment`.
- Single-select chips are `button` elements with `aria-pressed` and a named group.
- Chip groups use roving `tabIndex`. Arrow keys, Home, End, Space, and Enter work.
- Validation and request state use `aria-live`. Invalid save moves focus to the first invalid
  group.
- Text meets `4.5:1` contrast. Controls and state indicators meet `3:1`. Selection has a
  non-color indicator. Interactive targets are at least `44` by `44` CSS pixels.

For Mobile, use React Native `Modal` and the existing accessibility announcer:

- Mark modal content with `accessibilityViewIsModal`, hide background descendants from the
  accessibility tree while open, move accessibility focus to the title, support
  `onAccessibilityEscape` and Android hardware Back, and return focus to the invoking control.
- For automatic open, restore accessibility focus to the garment's `Needs tags` action when
  present, otherwise to `Add Garment`.
- Single-select chips expose `accessibilityRole="radio"`, `accessibilityState.selected`, and
  disabled state when saving.
- Groups and controls have localized accessibility labels and hints.
- Important progress, validation, and request errors are announced.
- Interactive targets are at least `44` by `44` density-independent pixels.
- Add copy to every supported mobile locale: `en-US`, `en-CA`, `es-419`, `fr-FR`, `fr-CA`,
  `de-DE`, `it-IT`, `pt-BR`, `pt-PT`, and `tr-TR`.

## Acceptance criteria

### AC1: Background analysis and lifecycle

**Scenario: Successful local analysis produces reviewable suggestions**

Given a committed garment owned by the user has status `processing`
And its private image passes the existing Story 4.1 image and color processing
When the dedicated wardrobe worker consumes its existing `color-extraction` job
Then it runs the pinned local tagging engine exactly once
And atomically persists the color palette, validated suggestion snapshot, analysis version,
and suggestion timestamp
And changes the garment status to `awaiting_tags`
And does not change `committed_at`.

**Scenario: Tag inference fails after successful image processing**

Given image and color processing succeeds
And local tag inference throws, times out, or returns an invalid result
When the worker handles the failure
Then it persists the color palette
And sets status to `awaiting_tags`
And stores a stable tagging failure code with no suggestion snapshot
And does not mark the garment `failed`
And the user can complete manual tagging.

**Scenario: Core image processing fails**

Given the committed image cannot pass the existing image or color processing pipeline
When all configured BullMQ attempts are exhausted
Then the existing Story 4.1 failure path sets status to `failed`
And no tag suggestion is exposed.

**Scenario: Production cannot load the verified model**

Given the dedicated wardrobe worker starts outside an allowed test environment
When the pinned local model, manifest, or expected checksum is missing or invalid
Then wardrobe worker startup fails before consuming tagging jobs
And it does not download a model at runtime
And it does not fall back to fixture inference or an external service
And general weather, alert, and moderation workers remain independent.

### AC2: Suggestion API authorization and contract

**Scenario: Owner receives the persisted suggestion**

Given an authenticated user owns an active garment at `awaiting_tags` with a valid snapshot
When the user calls `POST /api/v1/wardrobe/garments/{garmentId}/suggest-tags`
Then the API returns `200` with the exact strict suggestion response contract
And the response has `Cache-Control: private, no-store`
And every confidence value is between `0` and `1`
And a repeated call returns the same `analysisVersion`, values, and confidence scores.

**Scenario: Analysis is still pending**

Given the authenticated owner garment is at `pending_upload`, `bytes_uploaded`, or `processing`
When the suggestion route is called
Then the API returns `409 GARMENT_ANALYSIS_PENDING`
And no database state changes.

**Scenario: Inference is unavailable and manual entry is possible**

Given the authenticated owner garment is at `awaiting_tags`
And its snapshot is absent or invalid
When the suggestion route is called
Then the API returns `503 TAGGING_INFERENCE_UNAVAILABLE`
And both clients open manual mode with all tag options available.

**Scenario: Authentication is missing or invalid**

Given the request has no valid authenticated user
When either tagging route is called
Then the API returns `401`
And no garment existence or ownership information is disclosed.

**Scenario: Garment is missing or belongs to another user**

Given the request is authenticated
And the garment is absent or owned by a different user
When either tagging route is called
Then the API returns `404` for both cases
And no database state changes.

**Scenario: Guardian policy allows an eligible teen**

Given the authenticated role is `teen`
And the profile has a birthdate and active account status
And the user is age 13 through 15 with granted, unrevoked guardian consent
When either tagging route is called for an owned garment
Then the request continues to normal route handling.

**Scenario: Guardian policy denies an ineligible teen**

Given the authenticated role is `teen`
And the user has an active account but is under 13, is age 13 through 15 without granted
unrevoked consent, or has a missing birthdate
When either tagging route is called
Then the existing `WardrobeUploadGuard` returns `403 GUARDIAN_CONSENT_REQUIRED`
And no garment state changes.

**Scenario: Global teen access state is blocked before wardrobe handling**

Given the authenticated role is `teen`
And the user record or profile is missing, or the compliance account status is not active
When either tagging route is called
Then the existing `RequestAuthGuard` returns `403`
And the exception message is `Guardian consent required before continuing`
And `WardrobeUploadGuard`, controller, and service are not invoked.

**Scenario: User age 16 or older needs no guardian consent**

Given the authenticated role is `teen`
And the profile has a birthdate, active account status, and calculated age of at least 16
When either tagging route is called for an owned garment
Then the request continues without guardian consent.

### AC3: Tag confirmation and persistence

**Scenario: First confirmation makes a garment eligible**

Given the authenticated owner garment is active and at `awaiting_tags`
When the user sends a valid tag body with required category and comfort values
Then the API persists typed enum values in one transaction
And sets status to `ready`, sets `tags_confirmed_at`, and updates `updated_at`
And leaves `committed_at` unchanged
And returns `200` with the strict updated `GarmentItemContract`.

**Scenario: Optional material is omitted**

Given a taggable owner garment already has a material value
When the valid update body omits `material`
Then the API preserves the stored material.

**Scenario: Optional material is explicitly cleared**

Given a taggable owner garment has a material value
When the valid update body contains `material: null`
Then the API stores a null material
And the garment can still be `ready`.

**Scenario: Invalid or incomplete input is rejected**

Given the body is missing category or comfort range, contains an unknown enum, contains an
unknown key, or the path parameter is empty or longer than 128 characters
When the update route is called
Then the API returns `400`
And does not change garment data, cache state, or telemetry markers.

**Scenario: Repeated confirmation is idempotent**

Given a garment is already `ready`
When the owner repeats the same valid body
Then the API returns `200` with the same confirmed values
And `updated_at` remains unchanged
And no cache invalidation is attempted
And no second completion telemetry event is emitted.

**Scenario: Owner edits a ready garment**

Given the active owner garment is `ready`
When the owner sends different valid tags
Then the API updates the enum values and `updated_at`
And keeps the garment `ready`
And invalidates the Ritual cache
And does not emit another completion event.

**Scenario: Untaggable state is rejected**

Given the owner garment is still processing, has failed, or has a non-active retention state
When the update route is called
Then the API returns the specified `409` error
And no database state changes.

### AC4: Telemetry and cache consistency

**Scenario: First confirmation emits privacy-safe completion telemetry**

Given a valid first confirmation transitions a garment from `awaiting_tags` to `ready`
When the transaction succeeds
Then the API claims and emits one `garment_tagging_completed` event
And derives override fields from the persisted suggestion snapshot
And uses the pseudonymous analytics subject with `$ip` set to null
And includes no garment image, location, palette, embedding, raw user ID, or free text.

**Scenario: Concurrent confirmation retries do not double count**

Given two identical valid first-confirmation requests race for the same garment
When both complete
Then both responses represent the persisted ready garment
And at most one request claims completion telemetry.

**Scenario: Cache or telemetry dependency fails**

Given valid tags were committed to PostgreSQL
When Redis invalidation or telemetry delivery fails
Then the API logs the dependency failure
And returns the successful persisted garment
And the next Ritual request uses the database freshness check to avoid stale wardrobe data.

### AC5: Ritual uses only confirmed garments

**Scenario: Matching confirmed garments replace defaults**

Given the user has active, ready garments with confirmed categories and comfort ranges
And at least one garment matches a required category and target comfort range
When `RitualService.getOrCreateRitual()` generates morning, midday, and evening outfits
Then it selects matching user garment IDs using the existing category and comfort logic
And uses a default only for a category without a suitable user garment.

**Scenario: Ineligible garments never enter recommendations**

Given the wardrobe also contains `awaiting_tags`, `failed`, deletion-pending, legal-hold, or
null-tagged garments
When a Ritual is generated or checked for cache freshness
Then those rows are excluded from both wardrobe queries
And deterministic ordering makes repeated selections stable.

**Scenario: Comfort preferences retain current behavior**

Given the user has `runs_cold_warm`, `wind_tolerance`, and `precip_preparedness` values
When a Ritual is generated
Then `runs_cold_warm` retains its current temperature adjustment
And wind and precipitation preferences retain their current reasoning badges
And material does not imply windproof or waterproof behavior.

### AC6: Accessible Web confirmation

**Scenario: Web modal supports pointer and keyboard selection**

Given a garment reaches `awaiting_tags` on Web
When the tagging dialog opens
Then confident suggestions are preselected and low-confidence suggestions require review
And every chip reports `aria-pressed`
And arrow keys, Home, End, Space, and Enter operate each named single-select group
And the material group offers a localized `Not sure` option that saves null
And save remains disabled until category and comfort are selected.

**Scenario: Web modal manages focus and errors**

Given the Web dialog is open
When the user tabs, presses Escape, submits invalid state, or receives an API error
Then focus remains trapped while open
And Escape closes the dialog
And close restores focus to the invoking control
And validation focuses the first invalid group
And progress and errors are announced through `aria-live`
And the draft remains intact after a request error.

**Scenario: Web visual accessibility meets WCAG 2.1 AA**

Given the tagging dialog is rendered at supported viewports
When automated accessibility and visual checks run
Then text contrast is at least `4.5:1`
And control and state contrast is at least `3:1`
And selection is communicated without relying on color
And interactive targets are at least `44` by `44` CSS pixels.

### AC7: Accessible and localized Mobile confirmation

**Scenario: Mobile controls expose accessible state**

Given a garment reaches `awaiting_tags` on Mobile
When the React Native modal opens
Then chips expose radio role and selected state with localized labels and hints
And accessibility focus enters the modal while background content is hidden
And accessibility escape and Android hardware Back close the modal and restore focus
And the material group offers a localized `Not sure` option that saves null
And state, progress, validation, and request errors are announced
And all interactive targets are at least `44` by `44` density-independent pixels.

**Scenario: Every supported locale is complete**

Given the app is set to any supported locale
When the wardrobe and tagging flow renders
Then every user-facing and accessibility string resolves from that locale
And locale parity tests cover `en-US`, `en-CA`, `es-419`, `fr-FR`, `fr-CA`, `de-DE`,
`it-IT`, `pt-BR`, `pt-PT`, and `tr-TR`
And no raw translation key or English fallback appears for a declared supported locale.

### AC8: End-to-end recovery and completion

**Scenario: User completes the full Web flow**

Given a signed-in eligible user uploads a valid garment through the real Web UI
And the E2E API and existing worker run with the allowed deterministic fixture engine
When processing reaches `awaiting_tags`, the user reviews, overrides, and saves tags
Then the grid shows the returned ready garment
And reload preserves the selected values
And a Ritual request can select the garment when its category and comfort match.

**Scenario: User completes the full Mobile flow**

Given a signed-in eligible user uploads a valid garment through the real Mobile UI
And the E2E API and existing worker run with the allowed deterministic fixture engine
When processing reaches `awaiting_tags`, the user reviews, overrides, and saves tags
Then the screen shows the returned ready garment
And app relaunch preserves the selected values
And the flow passes on both iOS and Android.

**Scenario: User resumes an abandoned tagging flow**

Given a user closes the modal or leaves before confirming
When the user returns to the wardrobe
Then the garment remains visible with localized `Needs tags`
And selecting it reopens the tagging flow with the persisted suggestion and any confirmed values
And the user can complete confirmation.

## Tasks and subtasks

- [x] Task 1: Add typed database lifecycle and metadata. AC: 1, 3, 4, 5
  - [x] Update `packages/db/prisma/schema.prisma` with `GarmentCategory`,
        `GarmentMaterial`, and `GarmentComfortRange` enums.
  - [x] Add `awaiting_tags` to `GarmentUploadStatus`.
  - [x] Change `GarmentItem.category`, `material`, and `comfort_range` from nullable strings to
        their nullable Prisma enum types.
  - [x] Add nullable `tag_suggestions`, `tagging_model_version`, `tag_suggested_at`,
        `tags_confirmed_at`, `tagging_failure_code`, and `tagging_telemetry_emitted_at` fields.
  - [x] Create a migration under `packages/db/prisma/migrations/`. First normalize unknown
        legacy string values to null. Then move ready rows missing category or comfort to
        `awaiting_tags` with `LEGACY_TAGS_REQUIRED`, cast valid values to enums, and retain already
        tagged ready rows.
  - [x] Add a database check constraint requiring non-null category and comfort when status is
        `ready`.
  - [x] Update database seeds, Story 4.1 schema assertions, migration tests, and RLS tests to
        use the new enum and status values.

- [x] Task 2: Define shared HTTP and analytics contracts. AC: 2, 3, 4
  - [x] Update `packages/api-client/src/contracts/http/wardrobe.ts` with shared enum schemas,
        the strict snapshot schema, strict path parameter with length `1` through `128`, strict
        update input, strict response schemas, and the extended garment item schema.
  - [x] Register both tagging paths with exact request, response, security, and error status
        definitions in the OpenAPI 3.1 registry.
  - [x] Export the new schemas and inferred types from `packages/api-client/src/index.ts`.
  - [x] Add `garment_tagging_completed` and its strict input, properties, wrapper, and exports
        in `packages/api-client/src/types/analytics-events.ts`.
  - [x] Regenerate OpenAPI docs and the SDK through `npm run generate:api-client`. Do not
        hand-edit generated files.
  - [x] Extend contract, OpenAPI, generated-client, analytics assertion, Pact consumer, Pact
        provider, and Pact provider-state tests.

- [x] Task 3: Implement and verify the local tagging engine. AC: 1, 2
  - [x] Add exact dependency `@huggingface/transformers@3.8.1` to the API workspace.
  - [x] Add the exact `prepare:tagging-model`, `verify:tagging-model`,
        `test:tagging-model:smoke`, `start:workers:wardrobe`, and
        `start:workers:wardrobe:prod` scripts to `apps/api/package.json`. Production start runs
        verification only.
  - [x] Add `apps/api/src/modules/wardrobe/garment-tagging.engine.ts` for the engine interface,
        prompt constants, thresholds, score normalization, and deterministic comfort mapping.
  - [x] Add `apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.ts` for private image
        preprocessing and supervision of the local ONNX inference thread.
  - [x] Add `apps/api/src/modules/wardrobe/fashion-clip-inference.worker.ts`. Load and warm one
        verified model instance before worker consumption. On a `30,000` millisecond inference
        timeout, terminate this thread before resolving failure and warm a replacement.
  - [x] Add `apps/api/src/modules/wardrobe/fixture-garment-tagging.engine.ts` with the strict
        test-only environment gate.
  - [x] Add `scripts/prepare-garment-tagging-model.mjs` and
        `apps/api/model-manifests/fashion-clip-7e3ba62.json`. Verify the pinned revision and every
        downloaded file. Verify the ONNX SHA-256 specified in this story.
  - [x] Add `GARMENT_TAGGING_MODEL_DIR` and engine selection documentation to `.env.example`.
        Add the local model cache to `.gitignore` and the prepare, verify, migrate, and start
        sequence to `_bmad-output/project-knowledge/deployment-guide.md`.
  - [x] Unit test prompt coverage, label mapping, confidence boundaries, top-score ties,
        malformed output, NaN and infinity rejection, comfort rule order, fixture gating, missing
        files, checksum mismatch, timeout termination, and replacement-thread readiness.
  - [x] Add a CI smoke test that loads the real pinned local model from the prepared cache,
        processes a neutral licensed garment fixture, and asserts valid finite schema output. Keep
        the fixture license and provenance beside the test asset.

- [x] Task 4: Integrate inference into the existing worker. AC: 1
  - [x] Extend `WardrobeColorProcessor` in
        `apps/api/src/modules/wardrobe/wardrobe-color.processor.ts`. Reuse
        `SupabaseWardrobeStorageAdapter` and the existing `color-extraction` queue.
  - [x] After successful color extraction, run the injected tagging engine and atomically
        preserve both existing palette writes while persisting the validated snapshot, model
        version, suggestion timestamp, and `awaiting_tags`.
  - [x] Treat tag inference failure as recoverable. Persist palette, stable tagging failure
        code, null snapshot, and `awaiting_tags`, then resolve the job successfully so the outer
        worker does not retry or call `markFailed()`.
  - [x] Preserve `markFailed()` for exhausted core image or color processing failures.
  - [x] Add `apps/api/src/workers/wardrobe.bootstrap.ts` to construct and warm the configured
        engine once, then consume the existing `color-extraction` queue with
        `defaultWorkerOptions(1)` and existing coordinated shutdown helpers.
  - [x] Remove the `color-extraction` consumer from the general
        `apps/api/src/workers/bootstrap.ts`. Continue creating the existing queue and preserve
        weather, alert, and moderation worker behavior.
  - [x] Extend processor and both worker bootstrap tests for retries, atomic writes, inference
        failure, singleton loading, shutdown, queue isolation, and status transitions.

- [x] Task 5: Add guarded API operations and side effects. AC: 2, 3, 4
  - [x] Add `suggestGarmentTags()` and `updateGarmentTags()` to the existing
        `WardrobeService` in `apps/api/src/modules/wardrobe/wardrobe.service.ts`.
  - [x] Scope every query by both garment ID and authenticated user ID. Return identical 404
        behavior for absent and cross-owner IDs.
  - [x] Parse snapshots on read and API responses before return. Never trust raw Prisma JSON.
  - [x] Implement exact lifecycle and HTTP behavior from the error matrix.
  - [x] Update the first confirmation and telemetry claim in one transaction. Compute
        overrides from the persisted snapshot.
  - [x] Call the existing `RitualService.invalidateUserCache(userId)` after a successful
        transaction. Isolate telemetry and Redis failure from the persisted response.
  - [x] Add both routes to `WardrobeController`. Keep the existing class-level
        `RequestAuthGuard` and `WardrobeUploadGuard`.
  - [x] Set `@HttpCode(200)` on the suggestion POST and set
        `Cache-Control: private, no-store` on both routes.
  - [x] Import the existing `PersonalizationModule` from `WardrobeModule` so
        `WardrobeService` can use the exported `RitualService`. Do not construct a second Ritual
        service or Redis client in wardrobe code.
  - [x] Extend `apps/api/src/modules/telemetry/telemetry.service.ts` with validator, property
        map, privacy-safe builder, pseudonymous persistence, `$ip: null`, and tests.
  - [x] Add service, controller, guard, concurrency, telemetry, and integration tests for every
        AC2, AC3, and AC4 branch, including which existing guard rejects each teen state.

- [x] Task 6: Restrict Ritual inputs without changing selection policy. AC: 5
  - [x] Update both garment queries in
        `apps/api/src/modules/personalization/ritual.service.ts` with the exact eligibility filter
        and deterministic ordering in this story.
  - [x] Keep the implemented `getOrCreateRitual()` method name and current selection rules.
  - [x] Extend `ritual.service.spec.ts` for eligible selection, every excluded state,
        deterministic tie handling, defaults, cache freshness, Redis invalidation failure, comfort
        adjustment, and unchanged wind and precipitation badges.

- [x] Task 7: Build the accessible Web flow. AC: 6, 8
  - [x] Extract `apps/web/src/app/components/accessible-modal.tsx` from the current capture
        modal and migrate the capture modal to it without behavior regressions.
  - [x] Add `apps/web/src/app/components/garment-tagging-modal.tsx` with the prescribed dialog,
        focus, chip, validation, live-region, contrast, and target-size behavior.
  - [x] Add suggestion and update SDK helpers to `apps/web/src/lib/wardrobe.ts` through
        `createWebApiClient`.
  - [x] Update `apps/web/src/app/wardrobe/page.tsx` with bounded polling, automatic open,
        manual fallback, `Needs tags`, retry, save, response reconciliation, and resume behavior.
  - [x] Add component and page Vitest tests with MSW. Add axe, keyboard, focus, request error,
        polling timeout, and visual regression coverage in Playwright.

- [x] Task 8: Build the accessible localized Mobile flow. AC: 7, 8
  - [x] Add `apps/mobile/components/wardrobe/garment-tagging-modal.tsx` with the prescribed
        React Native modal, radio state, announcements, validation, and target sizes.
  - [x] Add `apps/mobile/src/lib/wardrobe.ts` through the existing generated SDK wrapper.
  - [x] Update `apps/mobile/app/(tabs)/wardrobe.tsx` with bounded polling, automatic open,
        manual fallback, `Needs tags`, retry, save, response reconciliation, and resume behavior.
  - [x] Add all visual and accessibility copy to all ten locale JSON files in
        `apps/mobile/assets/locales/`.
  - [x] Add component and screen Vitest tests with MSW. Extend locale parity assertions to
        ensure every new key exists and is nonempty in all ten locales.
  - [x] Add `maestro/garment-smart-tagging-flow.yaml` for suggestion, override, save, error
        recovery, relaunch, and resume on iOS and Android.
  - [x] Update `scripts/run-maestro.mjs` to start and supervise the dedicated wardrobe worker
        with the same E2E database, allowed test environment, and fixture engine whenever the
        smart-tagging flow runs. Wait for its ready signal and include it in signal forwarding
        and final cleanup.

- [x] Task 9: Make end-to-end execution representative and deterministic. AC: 8
  - [x] Add `scripts/start-api-e2e-with-workers.mjs` to start the API and dedicated wardrobe
        worker against the E2E database with `GARMENT_TAGGING_ENGINE=fixture` and an allowed
        test environment.
  - [x] Update `playwright/config/local.config.ts` to use that runner. Ensure one migration
        application, readiness checks for API and worker, signal forwarding, and clean shutdown.
  - [x] Add `playwright/tests/wardrobe-smart-tagging.spec.ts` for upload, background status,
        suggestions, low confidence, override, save, reload, Ritual eligibility, abandoned flow,
        manual inference failure, keyboard access, and visual snapshots.
  - [x] Add API integration coverage for unauthenticated, cross-owner, teen consent, invalid
        enums, missing fields, illegal status, telemetry races, and cache dependency failure.
  - [x] Run all verification gates listed below and record exact commands and results in the
        Dev Agent Record.

### Review Findings

- [x] [Review][Patch] Tokenize FashionCLIP prompts with `AutoTokenizer` instead of the image
      processor [apps/api/src/modules/wardrobe/fashion-clip-inference.worker.ts:79]
- [x] [Review][Patch] Harden model snapshot loading with a runtime-stable manifest path,
      checksums for every asset, manifest identity validation, and an absolute model directory
      [apps/api/src/modules/wardrobe/fashion-clip-inference.worker.ts:44]
- [x] [Review][Patch] Supervise inference-worker initialization exits and await timed-out thread
      termination before starting its replacement [apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.ts:31]
- [x] [Review][Patch] Fail closed when fixture inference is requested outside an allowed test
      environment [apps/api/src/workers/wardrobe.bootstrap.ts:20]
- [x] [Review][Patch] Make color-processing persistence conditional so duplicate jobs cannot
      revert a confirmed garment to `awaiting_tags` [apps/api/src/modules/wardrobe/wardrobe-color.processor.ts:41]
- [x] [Review][Patch] Persist `TAGGING_OUTPUT_INVALID` for invalid model output instead of
      classifying every thrown validation failure as inference failure
      [apps/api/src/modules/wardrobe/wardrobe-color.processor.ts:59]
- [x] [Review][Patch] Emit privacy-safe structured inference outcome, duration, analysis version,
      and stable failure-code logs [apps/api/src/modules/wardrobe/wardrobe-color.processor.ts:55]
- [x] [Review][Patch] Put first confirmation and its telemetry claim in one owner-scoped,
      concurrency-safe transaction [apps/api/src/modules/wardrobe/wardrobe.service.ts:518]
- [x] [Review][Patch] Clear malformed suggestion JSON and record `TAGGING_OUTPUT_INVALID` on
      first manual confirmation [apps/api/src/modules/wardrobe/wardrobe.service.ts:521]
- [x] [Review][Patch] Preserve canonical `category`, `material`, `comfort_range` telemetry
      override order [apps/api/src/modules/wardrobe/wardrobe.service.ts:557]
- [x] [Review][Patch] Require Ritual cache invalidation and log telemetry and cache dependency
      failures through the structured logger [apps/api/src/modules/wardrobe/wardrobe.service.ts:570]
- [x] [Review][Patch] Accept `awaiting_tags` as a valid idempotent commit replay state without
      re-enqueuing completed processing [apps/api/src/modules/wardrobe/wardrobe.service.ts:622]
- [x] [Review][Patch] Include active failed garments in list results so polling can observe its
      terminal failure state [apps/api/src/modules/wardrobe/wardrobe.service.ts:397]
- [x] [Review][Patch] Order selectable Ritual garments by `updated_at` descending and `id`
      ascending [apps/api/src/modules/personalization/ritual.service.ts:1077]
- [x] [Review][Patch] Make analysis version exact and new garment tag fields required-nullable in
      the shared contract [packages/api-client/src/contracts/http/wardrobe.ts:34]
- [x] [Review][Patch] Register strict tagging error envelopes and parse controller responses
      through shared Zod response schemas [packages/api-client/src/contracts/http/wardrobe.ts:352]
- [x] [Review][Patch] Route new Web and Mobile tagging helpers through app-local generated SDK
      factories with actionable error parsing [apps/web/src/lib/wardrobe.ts:299]
- [x] [Review][Patch] Add cancellable Web polling at 1, 2, 4, and 8 seconds with automatic tagging
      open and terminal-state handling [apps/web/src/app/wardrobe/page.tsx:20]
- [x] [Review][Patch] Prevent stacked Web dialogs, track the actual tagging invoker, restore focus
      correctly, and keep modal controls at least 44 pixels [apps/web/src/app/wardrobe/page.tsx:147]
- [x] [Review][Patch] Implement roving tabindex and Arrow, Home, End, Space, and Enter behavior for
      Web single-select chip groups [apps/web/src/app/components/garment-tagging-modal.tsx:203]
- [x] [Review][Patch] Display low-confidence Web suggestions as `Needs review`, surface all request
      failures, and provide pending-analysis retry [apps/web/src/app/components/garment-tagging-modal.tsx:104]
- [x] [Review][Patch] Migrate the Web capture dialog to the shared `AccessibleModal` primitive
      [apps/web/src/app/components/garment-capture-modal.tsx:441]
- [x] [Review][Patch] Add cancellable Mobile polling at 1, 2, 4, and 8 seconds with automatic
      tagging open and terminal-state handling [apps/mobile/app/(tabs)/wardrobe.tsx:288]
- [x] [Review][Patch] Resolve every Mobile tagging and accessibility string through all ten locale
      catalogs and add locale parity coverage [apps/mobile/components/wardrobe/garment-tagging-modal.tsx:44]
- [x] [Review][Patch] Add Mobile modal focus entry and restoration, background isolation,
      announcements, accessibility escape, and disabled radio state
      [apps/mobile/components/wardrobe/garment-tagging-modal.tsx:157]
- [x] [Review][Patch] Preserve low-confidence Mobile suggestions, classify SDK errors, add pending
      retry, and bound suggestion requests [apps/mobile/components/wardrobe/garment-tagging-modal.tsx:90]
- [x] [Review][Patch] Run the tagging-model smoke gate through the real production FashionCLIP
      engine and prepared snapshot [apps/api/src/modules/wardrobe/garment-tagging.smoke.spec.ts:16]
- [x] [Review][Patch] Wire the API plus wardrobe-worker runner into Playwright and replace the
      placeholder test with the complete smart-tagging flow [playwright/config/local.config.ts:48]
- [x] [Review][Patch] Add the missing smart-tagging Maestro flow and supervise the wardrobe worker
      during that flow on iOS and Android [scripts/run-maestro.mjs:941]
- [x] [Review][Patch] Restore the removed Story 4.1 WardrobeService regression suite alongside
      smart-tagging coverage [apps/api/src/modules/wardrobe/wardrobe.service.spec.ts:15]
- [x] [Review][Patch] Document and test the irreversible migration checkpoint before legacy
      normalization and enum casts [packages/db/prisma/migrations/20260805120000_add_garment_smart_tags/migration.sql:48]
- [x] [Review][Patch] Correct story and sprint completion claims and record actual verification
      commands, results, notes, and changed files before marking the story done
      [_bmad-output/implementation-artifacts/4-2-smart-tagging-comfort-metadata.md:7]

### Test Architect Review Findings

- [x] [TEA][P1] Replace raw Playwright request usage with the merged `apiRequest` fixture, use
      `recurse` for worker convergence, add trace metadata and named steps, and own all cleanup
      [playwright/tests/wardrobe-smart-tagging.spec.ts]
- [x] [TEA][P1] Replace wall-clock response data and duplicated suggestion snapshots with typed
      shared fixtures [packages/api-client/src/testing/wardrobe-fixtures.ts]
- [x] [TEA][P1] Reset module mocks, browser globals, and environment mutations between tests
      [apps/api/src/modules/wardrobe/wardrobe.service.spec.ts]
- [x] [TEA][P1] Correct contradictory FashionCLIP test outcomes and cover direct logits,
      embedding fallback, and invalid model results
      [apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.spec.ts]
- [x] [TEA][P1] Make RLS scenarios test-owned, transactionally cleaned, pool-bounded, and smaller
      by domain [packages/db/test/rls-policies.spec.ts]
- [x] [TEA][P1] Remove the parallel shared-package deletion race from local Playwright startup
      [scripts/start-api-e2e-with-workers.mjs]
- [x] [TEA][P2] Clean Playwright and Maestro garments through the public API before local database
      teardown so object storage cannot leak [playwright/support/helpers/user-test-data.ts]
- [x] [TEA][P2] Make native launch, navigation, capture, restart, and cleanup condition-driven on
      iOS and Android [maestro/garment-smart-tagging-flow.yaml]
- [x] [TEA][P3] Replace dense OpenAPI assertions with a typed route matrix and reuse the shared
      analysis version in Pact provider state [packages/api-client/testing/wardrobe-contract.spec.ts]
- [x] [TEA][Gate] Raise the test-quality score from 58/100, grade F, to 94/100, grade A, with all
      required focused and end-to-end gates passing
      [_bmad-output/test-artifacts/test-review.md]

## Dev notes

### Existing architecture to preserve

- Database model: `GarmentItem` in `packages/db/prisma/schema.prisma`. PostgreSQL table name is
  `"GarmentItem"`; there is no `garment_items` table.
- API routes: `apps/api/src/modules/wardrobe/wardrobe.controller.ts`.
- Domain operations: `apps/api/src/modules/wardrobe/wardrobe.service.ts`.
- Existing queue: `apps/api/src/modules/wardrobe/wardrobe-processing.queue.ts`.
- Existing processor: `apps/api/src/modules/wardrobe/wardrobe-color.processor.ts`.
- Existing worker bootstrap: `apps/api/src/workers/bootstrap.ts`.
- Existing storage: `apps/api/src/modules/wardrobe/wardrobe-storage.adapter.ts`.
- Existing guards: `RequestAuthGuard` and `WardrobeUploadGuard`.
- Wardrobe Nest module: `apps/api/src/modules/wardrobe/wardrobe.module.ts`.
- Personalization method: `RitualService.getOrCreateRitual()`.
- Cache invalidation method: `RitualService.invalidateUserCache()`.
- Shared HTTP source: `packages/api-client/src/contracts/http/wardrobe.ts`.
- Generated SDK output: `packages/api-client/src/generated/`.
- Analytics source: `packages/api-client/src/types/analytics-events.ts`.
- API telemetry: `apps/api/src/modules/telemetry/telemetry.service.ts`.
- Web API wrapper: `apps/web/src/lib/api-client.ts`.
- Mobile API wrapper: `apps/mobile/src/lib/api-client.ts`.

Current stack versions are Next.js `15.5.9`, React `19.1`, Tailwind CSS `3.4`, NestJS `11`,
Expo `54`, React Native `0.81`, Prisma `6.19`, Zod `3.24`, and OpenAPI `3.1`.

### Migration safety

The migration must be safe for existing Story 4.1 data:

1. Create a replacement `GarmentUploadStatus` PostgreSQL enum containing `awaiting_tags`.
   Drop the column default, cast through text to the replacement type, replace the old type,
   then restore the default. This avoids using a newly added PostgreSQL enum value in the same
   migration transaction.
2. Set unknown legacy category, material, and comfort strings to null before enum casts.
3. Move `ready` rows with null category or comfort to `awaiting_tags` and set
   `LEGACY_TAGS_REQUIRED`.
4. Preserve `ready` for rows whose category and comfort are valid.
5. Cast text columns to the new enum types.
6. Add the ready-tag check constraint after normalization.
7. Reapply or verify existing RLS behavior and indexes through migration tests.

The migration must have a tested rollback or a documented irreversible boundary before enum
casts. Production deployment applies the migration before workers using the new status start.

### Verification gates

Run these repository commands from the project root:

```bash
npm run db:generate
npm run generate:api-client
npm run optic:lint
npm run prepare:tagging-model --workspace api
npm run verify:tagging-model --workspace api
npm run test:tagging-model:smoke --workspace api
npm run test --workspace @couture/db
npm run test --workspace @couture/api-client
npm run test --workspace api
npm run test:integration --workspace api
npm run test --workspace web
npm run test --workspace mobile
npm run test:pact
npm run test:pw-local -- wardrobe-smart-tagging.spec.ts
npm run test:mobile:e2e:ios
npm run test:mobile:e2e:android
npm run verify:changed
```

Contract verification must cover Vitest schema tests, generated SDK compilation, OpenAPI and
Optic lint, Web and Mobile Pact consumers, API Pact provider states, and strict response
validation. UI verification must include Web Playwright, axe, keyboard, focus, visual
snapshots, and Mobile Maestro on iOS and Android.

### Expected files

Paths marked generated are outputs of repository generators and must never be edited by hand.

- `packages/db/prisma/schema.prisma`: update
- `packages/db/prisma/migrations/<timestamp>_add_garment_smart_tags/migration.sql`: new
- `packages/db/prisma/seeds/wardrobe.ts`: update
- `packages/api-client/src/contracts/http/wardrobe.ts`: update
- `packages/api-client/src/types/analytics-events.ts`: update
- `packages/api-client/src/index.ts`: update
- `packages/api-client/docs/http.openapi.json`: generated
- `packages/api-client/src/generated/`: generated
- `packages/api-client/testing/wardrobe-contract.spec.ts`: update
- `packages/api-client/testing/generated-client.spec.ts`: update
- `pact/http/consumer/api-contract-interactions.ts`: update
- `pact/http/consumer/web-api-client.pacttest.ts`: update
- `pact/http/consumer/mobile-api-client.pacttest.ts`: update
- `pact/http/provider/state-handlers.ts`: update
- `apps/api/package.json`: update
- `package-lock.json`: generated by npm install
- `.env.example`: update
- `.gitignore`: update
- `_bmad-output/project-knowledge/deployment-guide.md`: update
- `apps/api/model-manifests/fashion-clip-7e3ba62.json`: new
- `apps/api/src/modules/wardrobe/garment-tagging.engine.ts`: new
- `apps/api/src/modules/wardrobe/garment-tagging.engine.spec.ts`: new
- `apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.ts`: new
- `apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.spec.ts`: new
- `apps/api/src/modules/wardrobe/fashion-clip-inference.worker.ts`: new
- `apps/api/src/modules/wardrobe/fixture-garment-tagging.engine.ts`: new
- `apps/api/src/modules/wardrobe/wardrobe-color.processor.ts`: update
- `apps/api/src/modules/wardrobe/wardrobe-color.processor.spec.ts`: update
- `apps/api/src/modules/wardrobe/wardrobe.service.ts`: update
- `apps/api/src/modules/wardrobe/wardrobe.service.spec.ts`: update
- `apps/api/src/modules/wardrobe/wardrobe.controller.ts`: update
- `apps/api/src/modules/wardrobe/wardrobe.controller.spec.ts`: update
- `apps/api/src/modules/wardrobe/wardrobe.module.ts`: update
- `apps/api/src/modules/telemetry/telemetry.service.ts`: update
- `apps/api/src/modules/telemetry/telemetry.service.spec.ts`: update
- `apps/api/src/modules/personalization/ritual.service.ts`: update
- `apps/api/src/modules/personalization/ritual.service.spec.ts`: update
- `apps/api/src/workers/bootstrap.ts`: update
- `apps/api/src/workers/wardrobe.bootstrap.ts`: new
- `apps/api/src/workers/wardrobe.bootstrap.spec.ts`: new
- `apps/api/test/fixtures/garment-tagging/neutral-top.svg`: new project-owned smoke fixture
- `apps/api/test/fixtures/garment-tagging/README.md`: new fixture provenance
- `apps/web/src/app/components/accessible-modal.tsx`: new
- `apps/web/src/app/components/garment-capture-modal.tsx`: update
- `apps/web/src/app/components/garment-tagging-modal.tsx`: new
- `apps/web/src/app/components/garment-tagging-modal.test.tsx`: new
- `apps/web/src/app/wardrobe/page.tsx`: update
- `apps/web/src/app/wardrobe/page.test.tsx`: update
- `apps/web/src/lib/wardrobe.ts`: update
- `apps/web/src/lib/wardrobe.test.ts`: update
- `apps/mobile/components/wardrobe/garment-tagging-modal.tsx`: new
- `apps/mobile/app/(tabs)/wardrobe.tsx`: update
- `apps/mobile/src/lib/wardrobe.ts`: new
- `apps/mobile/src/lib/wardrobe.test.ts`: new
- `apps/mobile/assets/locales/*.json`: update all ten files
- `scripts/prepare-garment-tagging-model.mjs`: new
- `scripts/start-api-e2e-with-workers.mjs`: new
- `scripts/run-maestro.mjs`: update
- `playwright/config/local.config.ts`: update
- `playwright/tests/wardrobe-smart-tagging.spec.ts`: new
- `maestro/garment-smart-tagging-flow.yaml`: new

### References

- [Epic 4 story source](../planning-artifacts/epics.md)
- [Product requirements](../planning-artifacts/prd.md)
- [Architecture](../planning-artifacts/architecture.md)
- [Story 4.1 garment capture](./4-1-garment-capture-flow.md)
- [Official FashionCLIP repository](https://github.com/patrickjohncyh/fashion-clip)
- [Pinned official FashionCLIP ONNX revision](https://huggingface.co/patrickjohncyh/fashion-clip/commit/7e3ba62ce16b379a1ab479346b66f192e76f51b7)
- [Transformers.js server-side inference](https://huggingface.co/docs/transformers.js/main/tutorials/node)
- [Transformers.js custom model settings](https://huggingface.co/docs/transformers.js/en/custom_usage)

## Dev Agent Record

### Agent model used

Codex (GPT-5)

### Debug log references

- `maestro/artifacts/garment-smart-tagging-flow-report.xml`
- `maestro/artifacts/garment-smart-tagging-flow-maestro.log`

### Completion notes

- Resolved all 32 adversarial review findings across the model runtime, queue processor,
  persistence transaction, API contracts, generated clients, Web, Mobile, migration safety,
  automated tests, and delivery records.
- Added deterministic Web and native E2E orchestration with the API and dedicated wardrobe worker.
  The flow exercises upload, background inference, suggestions, overrides, confirmation, Ritual
  eligibility, restart, and persisted state.
- Reproduced and fixed two native harness failures. The iOS flow now clears stale Authentication
  Services sheets. The Android flow now verifies physical tab navigation when the platform ripple
  is misclassified as a screen change.
- Resolved the Test Architect review findings across determinism, isolation, maintainability, and
  performance. The formal score improved from 58/100, grade F, to 94/100, grade A.
- Migrated the Playwright system flow to Playwright Utils `apiRequest` and `recurse`. Added
  automatic public-API cleanup, deterministic identities, schema parsing, traceable priority and
  story metadata, and named business steps.
- Reverified the worker-backed Maestro flow after the TEA fixes. iOS passed in 37 seconds and
  Android passed in 48 seconds. Both runs deleted their garment through the public API during
  final cleanup.
- Verification passed on 2026-08-05:
  - API lint, typecheck, 498 tests with 5 skipped, and production build.
  - Mobile lint, typecheck, 119 tests, widget prebuild, watchOS prebuild, and production checks.
  - Web lint, typecheck, 65 tests, and production Next.js build.
  - API client lint, typecheck, 40 tests, and build. Database lint, typecheck, and 39 tests.
  - OpenAPI validation, stable Web and Mobile Pact consumers, and API Pact provider verification.
  - Real FashionCLIP production-engine smoke test against the prepared pinned snapshot.
  - Full Playwright suite: 61 tests passed, including axe, keyboard, focus, persistence, worker
    polling, reload, and Ritual consumption.
  - Smart-tagging Maestro flow: iOS passed in 39 seconds. Android passed in 53 seconds.
  - Repository Prettier check, targeted ESLint, Playwright TypeScript check, and `git diff --check`.

### File list

- `_bmad-output/implementation-artifacts/4-2-smart-tagging-comfort-metadata.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/project-knowledge/deployment-guide.md`
- `_bmad-output/test-artifacts/review-evidence.png`
- `_bmad-output/test-artifacts/test-review.md`
- `.env.example`
- `.gitignore`
- `.prettierignore`
- `package.json`
- `package-lock.json`
- `apps/api/package.json`
- `apps/api/model-manifests/fashion-clip-7e3ba62.json`
- `apps/api/src/modules/personalization/ritual.service.ts`
- `apps/api/src/modules/telemetry/telemetry.service.ts`
- `apps/api/src/modules/wardrobe/fashion-clip-inference.worker.ts`
- `apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.spec.ts`
- `apps/api/src/modules/wardrobe/fashion-clip-tagging.engine.ts`
- `apps/api/src/modules/wardrobe/fixture-garment-tagging.engine.ts`
- `apps/api/src/modules/wardrobe/garment-tagging.engine.spec.ts`
- `apps/api/src/modules/wardrobe/garment-tagging.engine.ts`
- `apps/api/src/modules/wardrobe/garment-tagging.smoke.spec.ts`
- `apps/api/src/modules/wardrobe/wardrobe-color.processor.spec.ts`
- `apps/api/src/modules/wardrobe/wardrobe-color.processor.ts`
- `apps/api/src/modules/wardrobe/wardrobe.controller.spec.ts`
- `apps/api/src/modules/wardrobe/wardrobe.controller.ts`
- `apps/api/src/modules/wardrobe/wardrobe.module.ts`
- `apps/api/src/modules/wardrobe/wardrobe.service.regression.spec.ts`
- `apps/api/src/modules/wardrobe/wardrobe.service.spec.ts`
- `apps/api/src/modules/wardrobe/wardrobe.service.ts`
- `apps/api/src/workers/bootstrap.ts`
- `apps/api/src/workers/wardrobe.bootstrap.ts`
- `apps/api/test/fixtures/garment-tagging/README.md`
- `apps/api/test/fixtures/garment-tagging/neutral-top.svg`
- `apps/api/vitest.config.ts`
- `apps/mobile/app/(tabs)/wardrobe.tsx`
- `apps/mobile/assets/locales/de-DE.json`
- `apps/mobile/assets/locales/en-CA.json`
- `apps/mobile/assets/locales/en-US.json`
- `apps/mobile/assets/locales/es-419.json`
- `apps/mobile/assets/locales/fr-CA.json`
- `apps/mobile/assets/locales/fr-FR.json`
- `apps/mobile/assets/locales/it-IT.json`
- `apps/mobile/assets/locales/pt-BR.json`
- `apps/mobile/assets/locales/pt-PT.json`
- `apps/mobile/assets/locales/tr-TR.json`
- `apps/mobile/components/wardrobe/garment-tagging-modal.test.tsx`
- `apps/mobile/components/wardrobe/garment-tagging-modal.tsx`
- `apps/mobile/src/i18n/wardrobe-tagging-locales.spec.ts`
- `apps/mobile/src/lib/wardrobe.ts`
- `apps/web/src/app/components/accessible-modal.tsx`
- `apps/web/src/app/components/garment-capture-modal.test.tsx`
- `apps/web/src/app/components/garment-capture-modal.tsx`
- `apps/web/src/app/components/garment-tagging-modal.test.tsx`
- `apps/web/src/app/components/garment-tagging-modal.tsx`
- `apps/web/src/app/wardrobe/page.test.tsx`
- `apps/web/src/app/wardrobe/page.tsx`
- `apps/web/src/lib/wardrobe.ts`
- `packages/api-client/docs/http.openapi.json` (generated)
- `packages/api-client/src/contracts/http/common.ts`
- `packages/api-client/src/contracts/http/wardrobe.ts`
- `packages/api-client/src/generated/apis/WardrobeApi.ts` (generated)
- `packages/api-client/src/generated/models/index.ts` (generated)
- `packages/api-client/src/index.ts`
- `packages/api-client/src/testing/analytics-event-assertions.ts`
- `packages/api-client/src/testing/wardrobe-fixtures.ts`
- `packages/api-client/src/types/analytics-events.ts`
- `packages/api-client/testing/wardrobe-contract.spec.ts`
- `packages/db/prisma/migrations/20260805120000_add_garment_smart_tags/migration.sql`
- `packages/db/prisma/schema.prisma`
- `packages/db/test/garment-upload-schema.spec.ts`
- `packages/db/test/rls-policies.spec.ts`
- `pact/http/consumer/api-contract-interactions.ts`
- `pact/http/consumer/web-api-client.pacttest.ts`
- `pact/http/provider/provider-helper.ts`
- `pact/http/provider/state-handlers.ts`
- `playwright/config/local.config.ts`
- `playwright/support/helpers/user-test-data.ts`
- `playwright/tests/wardrobe-smart-tagging.spec.ts`
- `scripts/prepare-garment-tagging-model.mjs`
- `scripts/run-maestro.mjs`
- `scripts/start-api-e2e-with-workers.mjs`
- `maestro/garment-smart-tagging-flow.yaml`
- `maestro/subflows/open-wardrobe.yaml`
