---
title: 'Story 6.8: Safe branded share-card export'
type: 'feature'
created: '2026-10-25'
status: 'in-review'
baseline_commit: '1d7b98485485c224063b573207c7e78bace717be'
route: 'dispatch'
story_key: '6-8-safe-branded-share-card-export'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="owner delegated delivery and phased peer approval">

## Intent

**Problem:** Members cannot prepare, inspect and save a branded outfit card across web, iOS and
Android. Capturing the existing UI would include personal fields and signed source URLs.

**Approach:** Resolve an authorized source on the API, render one deterministic PNG, preview its
exact bytes, and save those bytes after explicit activation and a fresh eligibility check. Retain the
composition through cancellation and recoverable failures for the native-sharing story to reuse.

## Boundaries & Constraints

**Decisions and reasons, 2026-10-25:**

1. Coordinator decision: community export includes the member's own published photograph. Sharing
   the look is the purpose and CC-6.9 consumes the prepared asset. Decode and re-rasterize the photo;
   all added pixels come from fixed, localized labels, bundled artwork, climate band, brand mark and
   optional watermark. AC2 forbids adding personal fields to pixels. Content already photographed by
   the member remains visible, and the exact-byte preview gives the member control. State this in
   localized preview help. Exclude other authors' photos, captions, alt text, handles, IDs, signed
   URLs, city/exact location, commerce fields and original filenames from overlays and file metadata.
2. Outfit export uses persisted CC-2.1 recommendations and bundled category artwork. Private wardrobe
   photos and user-authored garment/capsule names have no safe overlay role. Recognize only the six
   category enums and exact `default-<category>` starter IDs; use current owned garment categories.
3. Web's hero is demonstration content and planner IDs are synthetic. Add a separate "Create my
   outfit card" launcher inside the hero canvas. On activation it loads the authenticated ritual,
   offers morning/midday/evening, and prepares a real recommendation. Demo and planner cards have no
   export action. Mobile's real active ritual card gets the action. This preserves the CC-2.1 source
   contract without adding planner entitlement or persistence behavior.
4. Keep one full cross-platform spec despite the workflow's 1,600-token guideline. The privacy,
   permission and device proof requirements form one user goal and need explicit boundary coverage.
5. Astra R1 accepted: iOS saves the approved PNG as an original Photos resource through a local
   add-only native adapter. SDK54's `saveToLibraryAsync` decodes PNG to UIImage before saving, so
   that path cannot establish byte preservation. Retain preview SHA256 equality and chunk proof
   against the actual original resource imported into Photos.

**Eligibility and API:**

- New authenticated `POST /api/v1/share-cards/prepare`, canonical contract first. Strict request
  branches: `{source, locale, watermark, purpose:'preview'}` or the same fields with
  `purpose:'save', expectedSha256`. `source` is `{kind:'outfit', recommendationId}` or
  `{kind:'community_post', postId}`; IDs bounded to 128 characters, locale is a supported locale,
  watermark is boolean, digest is 64 lowercase hex. Reject unknown fields, URLs and paths with 400.
- Outfit: existing recommendation belongs to the authenticated, available member; scenario is
  morning/midday/evening; garment list is valid, nonempty, unique and at most 12 entries. Every real
  garment still belongs to that member with active retention, ready upload and recognized category.
  A referenced capsule must still belong to the member and match its recorded revision. Unknown,
  deleted, foreign or malformed sources return the same 404 `source_unavailable`. Preserve existing
  authentication and teen-consent guards. Recheck member, consent and source after rendering.
- Community: require both ownership and `isPubliclyVisiblePost`, including published timestamp,
  no erasure/anonymization and canary exclusion. Existing author-detail access to private states
  never qualifies. Apply `CommunityService.readAuthorized` before source acquisition and again
  after rendering, plus current guardian participation eligibility for export. Flag-off, revoked
  consent, under-age, account suspension or erasure blocks export. Keep production flags unchanged.
  Missing/foreign/nonpublic post yields 404; access denial 403; unavailable dependencies 503.
- Download only a validated DB object path under `community/<postId>/` from the fixed private
  bucket. No traversal or client media URL. Verify stored MIME, SHA256 and byte size through existing
  image validation. Enforce 10 MiB, dimensions 256..4096, one frame and existing JPEG/PNG/WebP types.
  Add bounded streaming download with cancellation, a 5-second storage deadline and immediate reader
  cancellation on overrun. The prepare operation has a 15-second deadline, a 5-second Sharp timeout and
  final source/fingerprint comparison. Keep download/render outside each 1,950 ms community read
  authorization callback. Source changes during preparation yield 409 `preview_changed`.
- Strict response `{data:{pngBase64, sha256, width:1080, height:1350,
mimeType:'image/png', filename:'couturecast-card.png', templateVersion:1}}`. Bound decoded PNG to
  3 MiB and response base64 accordingly. Validate output and digest on server and clients. Use
  `Cache-Control: private, no-store`; no artifact URL, source ID, source text or source metadata in
  the response. Do not persist exported media on the server or in browser/mobile durable storage.
- A save request re-resolves and re-renders the source and compares `expectedSha256`. Return 409 on
  any changed composition; retain the previous preview, disable its Save and offer Refresh preview.
  No silent replacement or export of unseen bytes. A fresh preview is mandatory after change.
  On accepted save authorization write an `AuditLog` event `share_card_export_authorized` linked to
  the actor with closed fields `{sourceKind, locale, watermark, templateVersion}`. Record no image,
  digest, source ID, path or URL. Audit failure blocks authorization. This event records API
  authorization; native save success is shown only after the OS operation resolves.

**Render and privacy:**

- Fixed version-1 1080x1350 sRGB canvas, ivory background, charcoal text, gold rule/brand detail,
  Playfair Display heading and Space Grotesk labels. Bundle font files with licenses and explicit
  font-file loading in the API build; rasterize fixed catalog text with Sharp's text input. Missing
  font or unsupported glyph fails preparation. No system-font fallback or live remote font fetch.
- Header uses localized fixed outfit/scenario or community wording. Content rectangle is
  x=72,y=240,width=936,height=900. Community photo is orientation-corrected, center-cover cropped
  with fixed interpolation, converted to raw sRGB pixels and composited into a new canvas. Outfit
  artwork uses one tile per distinct category in enum order, three columns/two rows. Footer shows
  the CoutureCast brand and, for community, localized coarse climate band when present; NULL omits
  it. No date, weather timestamp, city or location string. Watermark starts ON and controls a
  separate translucent CoutureCast mark inside the content; the fixed brand footer remains.
- Build a fresh RGB PNG with fixed encoder settings and only IHDR, IDAT and IEND chunks. Remove
  ancillary chunks and validate the final chunk structure. No EXIF, XMP, ICC text/profile, GPS,
  comments, original filename or arbitrary text chunks. Identical normalized source pixels/category
  projection, locale, watermark and renderer version produce identical bytes and SHA256. Source
  metadata changes alone cannot alter output. No DOM/view screenshots, arbitrary text inputs,
  serialized response dumps, source image bytes or signed URLs embedded in SVG, PNG or filename.
- Native OS library bookkeeping, such as its asset ID and creation time, remains OS-owned and is
  never written into the PNG or exposed in app telemetry. No new analytics events in this story.
  Operational logs use closed failure codes and source kind, excluding content, source IDs, URLs,
  filenames and native asset IDs. Native sharing and destination integrations belong to CC-6.9.

**Preview, lifetime and save:**

- Separate export control on eligible own community cards/details on both surfaces, including
  spotlight render sites. Server remains authoritative. Mobile cached outfit data may open the
  composer but requires a successful live prepare. No preview or export while offline.
- Session-memory composition includes source, scenario selection, locale, watermark and prepared
  bytes/digest. Preview the decoded returned PNG itself. Watermark/locale/source changes invalidate
  Save immediately, abort prior preparation and ignore stale results. Serialize preparation/save;
  ignore duplicate activation. Clear visible images on identity change or sign-out, abort precommit
  work and ignore late responses. Committed saves retain only their operation-owned immutable file
  and pending guard until native settlement, under the lifetime rule below. Keep composition on
  explicit close/back, failure or permission denial
  for that member's current screen visit; clear on leaving that visit or replacing the source.
- Save disabled until the preview image has loaded and validated. On Save, authorize current bytes,
  then web downloads a Blob of those bytes using fixed filename and releases its object URL after
  handoff. Announce "Download started"; browsers expose no reliable disk-write completion or user
  cancellation signal. An observable Blob/download handoff error gets retry feedback with preview
  retained. Cancel before handoff writes nothing. Never claim browser disk success.
- Mobile uses SDK54-compatible `expo-media-library ~18.2.1`, existing `expo-file-system` and a local
  iOS `ShareCardPhotoSave` Expo module. Only Save
  activation may check/request add-only access. iOS uses write-only permission; Android <33 uses
  its write permission; Android >=33 saves through MediaStore after the explicit app action with
  no fabricated OS prompt. Existing `accessPrivileges:'limited'` permits add-only save when granted;
  do not request broader read access. Denial retains preview and offers explicit Try again when
  `canAskAgain`; permanent denial offers Open settings, never loops requests. Return from settings
  rechecks permission without auto-saving. Opening settings is user-initiated only.
- Write validated bytes to a random feature-owned cache `.png`. Android imports that file through
  `saveToLibraryAsync`. iOS calls `ShareCardPhotoSave.saveOriginalPng(fileUri, expectedSha256)`:
  recheck `.addOnly` permission, validate the feature-cache file, PNG signature/chunks and digest,
  then use `PHPhotoLibrary.performChanges` with
  `PHAssetCreationRequest.addResource(with:.photo,fileURL:options:)`. Set `shouldMoveFile=false`,
  UTI `public.png` and original filename `couturecast-card.png`; await the transaction's completion
  before resolving. Keep the original byte resource intact. Production saving requests no library
  read access, asset lookup or asset metadata. The native bridge returns only success or a closed
  error code; asset IDs remain inside the OS/test harness.
- Resolve the iOS adapter through `requireOptionalNativeModule` using the accessibility-focus
  precedent. Missing module (including Expo Go or an older client) keeps preview/Cancel usable and
  disables native Save with localized `nativeSaveUnavailable` feedback before any permission or
  native write. Do not fall back to a PNG re-encoding save path. Register the local module through
  its Expo module config and podspec, and verify it is linked into both development and release
  simulator builds. Android retains the MediaLibrary adapter.
- A process-lifetime save-operation manager owns one pending native save across composers, screen
  navigation and member generations. The commit boundary is the atomic transfer of the immutable
  file to that manager immediately before native adapter invocation, after authorization,
  permission and generation checks. Before commit, Cancel/sign-out aborts preparation and removes
  the temp file after any in-flight cache write settles. After commit, close/navigation/sign-out
  cannot delete or mutate its file or release its duplicate-write guard. The native promise owns
  the file until success/rejection; the manager then cleans it exactly once and releases the guard.
  Keep the iOS transaction callback retained through settlement. A timeout in the UI never counts
  as native settlement and never permits deletion or a second write.
- Clear the former member's visible preview immediately on identity change. Pending completion
  updates UI only for the original member generation and a still-current composer; suppress all
  completion/error details for a new identity. A global pending guard prevents any composer from
  starting another native write until settlement and may show fixed "Finishing save" feedback.
  Cache failure/full storage/native rejection yields localized Retry with the same-member preview
  retained. Retry requires fresh authorization and permissions. Native success stays success when
  subsequent cache cleanup needs retry; retry cleanup without importing the photo again. Startup
  orphan cleanup touches only this feature's files and excludes every live pending operation.
- Native config enables add-only usage descriptions in all ten locales, disables media-location
  access and unnecessary read/audio/video permissions, preserving existing image-picker needs.
  Inspect generated Info.plist/manifest and rebuild both development clients. No generated native
  project edits. Match default app and isolated native-test build configuration.
- Accessible web modal: title focus, inert background, Tab trap, Escape/Cancel, labeled watermark
  checkbox, image description from fixed localized copy, polite preparation/success and assertive
  errors once. Mobile modal: safe areas, modal accessibility containment, heading focus after open,
  labeled switch, 44-point targets, Dynamic Type/scrolling, Android Back and iOS dismissal. Restore
  focus to invoking control; if gone, use hero/community heading. No focus jump on retry or save.
- All ten locales on both clients plus API render catalogs. New namespace `shareCard`: launcher,
  scenario labels, source labels, title, previewDescription, photoPrivacyHelp, preparing, watermark,
  save/download, saving/finishingSave, saved/downloadStarted, cancel/close, retry/refresh, openSettings,
  nativeSaveUnavailable,
  permissionDenied/permanent, sourceUnavailable/previewChanged/offline/storage/render/unknown errors,
  and climate-band labels. Catalog parity checks placeholders and fallbacks; locale changes replace
  both preview wording and card bytes. Keep long translations inside the image/text bounds.

## I/O & Edge-Case Matrix

Named test IDs below are required additions. U=unit, I=real-database/API integration,
P=Playwright, M=Maestro with the CC68 native dev clients on the named platforms,
N=native integration against actual OS resources.

| AC  | Input / state                                                                                                            | Expected output and handling                                                                              | Required test IDs                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Owned valid ritual; real or starter garments                                                                             | Bundled category card; three selectable web scenarios                                                     | U-OUTFIT, I-OUTFIT, P-OUTFIT, M-OUTFIT (Android/iOS)              |
| 1   | Foreign/missing/malformed recommendation; deleted/foreign garment; stale capsule revision                                | 404, no bytes or artifact                                                                                 | U-OUTFIT-DENY, I-OUTFIT-DENY                                      |
| 1   | Own publicly visible published post                                                                                      | Own photo crop, safe overlays, preview                                                                    | I-POST, P-POST, M-POST (Android/iOS)                              |
| 1,2 | Other author; draft/pending/flagged/review_failed/withdrawn/consent_suspended/erased/canary; missing published timestamp | Same unavailable-source result; no photo download for rejected source                                     | U-POST-DENY, I-POST-DENY, P-FOREIGN                               |
| 1   | Signed out; revoked consent; under 13; suspended/erased account; flag off                                                | Guarded refusal; clear stale UI on identity change                                                        | I-ACCESS, U-IDENTITY, P-IDENTITY, M-IDENTITY (Android/iOS)        |
| 1,2 | Same source, version, locale, toggle; restart renderer                                                                   | Same PNG digest, deterministic center crop and orientation                                                | U-DETERMINISTIC, I-DETERMINISTIC                                  |
| 1   | Watermark ON/OFF/ON, rapid toggles                                                                                       | ON returns original digest; stale responses dropped; footer preserved                                     | U-OPTIONS, P-WATERMARK, M-WATERMARK (Android/iOS)                 |
| 1,3 | Each locale; longest labels; locale change during render                                                                 | Exact localized preview, no clipping, loaded marker gates Save                                            | U-LOCALES, P-LOCALE, M-LOCALE (Android/iOS)                       |
| 2   | EXIF/GPS/XMP/ICC/text/name/URL bait in source metadata and DB free text                                                  | Fresh PNG has only IHDR/IDAT/IEND; overlays unchanged by bait                                             | U-METADATA, I-PRIVACY, P-DOWNLOAD-BYTES                           |
| 2   | Photo pixels contain a member-chosen name/sign                                                                           | Only own photo content retained; no app-added personal fields; help explains control                      | U-PIXELS, P-PHOTO-PREVIEW                                         |
| 2   | Tainted fields plus altered metadata, safe projection unchanged                                                          | Pixel comparison equals clean render; source metadata never copied                                        | U-PIXEL-ALLOWLIST, I-PRIVACY                                      |
| 1,2 | URL/path/extra-field request injection; corrupt/multiframe/oversized/mismatched SHA source                               | 400 input or 503 source-media failure, no export                                                          | U-CONTRACT, U-MEDIA, I-MEDIA                                      |
| 1,3 | Storage slow/oversized stream, renderer failure, missing font                                                            | Cancel bounded work, 503, localized Retry, no partial PNG                                                 | U-BOUNDS, I-BOUNDS, U-PREPARE-ERROR                               |
| 1,3 | Moderation/withdrawal/consent/source change during render or between preview and save                                    | Final recheck denies or 409; Refresh required; no save                                                    | I-RACE, U-STALE-PREVIEW, P-REVALIDATE                             |
| 3   | Explicit Save, iOS granted / Android write granted or API33+                                                             | One OS asset from exact preview bytes; temp file deleted                                                  | U-SAVE, M-SAVE (Android/iOS), native artifact extraction          |
| 3   | Denied and canAskAgain on iOS/legacy Android                                                                             | No write; preview retained; explicit retry only                                                           | U-PERMISSION-DENIED, M-DENIED (iOS/Android API32)                 |
| 3   | Granted limited photo access response                                                                                    | Add-only save, no broad access request                                                                    | U-PERMISSION-LIMITED, native adapter integration                  |
| 3   | Denied and cannot ask again; return from settings                                                                        | Settings action, no auto-request or auto-save                                                             | U-PERMISSION-PERMANENT, M-PERMANENT (iOS/Android API32)           |
| 3   | Cancel/back while preparing or before write                                                                              | No file/asset; preserve composition on reopen; ignore late result                                         | U-CANCEL, P-CANCEL, M-CANCEL (Android/iOS)                        |
| 3   | Double Save; deferred native read after close/navigation/sign-out                                                        | File readable until native settlement; one write; cleanup once afterward; old-member UI suppressed        | U-SINGLE-WRITE, U-PENDING-FILE, M-SINGLE-WRITE (Android/iOS)      |
| 3   | Cache write/full storage/native save rejects                                                                             | Error once, preview retained, retry reauthorizes, temp cleaned                                            | U-STORAGE, M-STORAGE (Android/iOS fixture boundary)               |
| 3   | Web explicit download                                                                                                    | Observed downloaded PNG equals preview digest/metadata; fixed filename                                    | P-DOWNLOAD-BYTES                                                  |
| 3   | Web cancel before click handoff; observable Blob/handoff failure                                                         | No download on cancel; error retains preview; bounded URL cleanup                                         | U-WEB-SAVE, P-DOWNLOAD-ERROR, P-CANCEL                            |
| 3   | Keyboard/screen reader, opener removed, modal retry/close                                                                | Correct focus/return fallback; one announcement; axe clean                                                | U-A11Y, P-A11Y, M-A11Y (Android/iOS), TalkBack/VoiceOver evidence |
| 2,3 | Save audit fails or source has sensitive fields                                                                          | No authorized save; bounded closed audit/log data only                                                    | I-AUDIT, U-LOG-PRIVACY                                            |
| 1,3 | Offline/cached source; sign-out then late render                                                                         | No stale export; same-member retry recovers                                                               | U-OFFLINE, P-OFFLINE, M-OFFLINE (Android/iOS)                     |
| 2,3 | iOS native import with add-only permission                                                                               | Extracted original Photos resource has preview SHA256, PNG signature and IHDR/IDAT/IEND only              | N-IOS-ORIGINAL, M-SAVE (iOS)                                      |
| 3   | iOS adapter absent in Expo Go/old client                                                                                 | Preview retained; Save disabled with localized unavailable state; no permission request or fallback write | U-NATIVE-UNAVAILABLE, M-NATIVE-UNAVAILABLE (iOS)                  |

</frozen-after-approval>

## Code Map

All existing-code references verified against the baseline above; paths under this section are
repository-relative. Proposed files are identified in the tasks.

- `packages/db/prisma/schema.prisma:549`: owned persisted recommendations; `:581` post media,
  free text and location fields; `:983` audit rows. No post/outfit relation exists.
- `apps/api/src/modules/personalization/ritual.service.ts:467`: eligible owned garments;
  `ritual-generation.engine.ts:978`: `default-<category>`; `ritual.controller.ts:26`: authenticated
  ritual endpoint. `packages/api-client/src/contracts/http/ritual.ts:12`: scenario and display
  categories; `wardrobe.ts:12`: six categories. These enums determine artwork and fixed labels.
- `apps/api/src/modules/community/community.repository.ts:123`: public predicate;
  `community.service.ts:338` author detail admits private rows, so export needs stricter selection;
  `:411` authorized reads; `community-access.service.ts:97` account/age rules and `:119` guardian
  participation. `community-availability.ts:18` read budget. Reuse guards without extending budgets
  of existing feed routes. `apps/api/src/modules/auth/security.guards.ts:49` authenticated/teen guard.
- `apps/api/src/modules/community/community-storage.adapter.ts:13` storage interface, `:147`
  unbounded download to leave compatible for existing callers; add a separate bounded method.
  `community-image-validation.ts:142` decode/declaration checks; `wardrobe-image-validation.ts:4`
  size/dimension limits. `community.module.ts:42` worker/request import boundary must stay intact.
- `apps/api/package.json:132` Sharp; `apps/api/nest-cli.json:5` build assets configuration needs font
  copies. `node_modules/sharp/lib/index.d.ts:1108` installed `fontfile` support.
- `apps/web/src/app/components/lookbook-prism-layout.tsx:39` demo hero, `:70` demo recommendations;
  `planner-rail.tsx:111` planner cards have another source contract, synthetic IDs from
  `apps/api/src/modules/personalization/planner.service.ts:551`. New ritual launcher goes in hero
  canvas. `community-lookbook-grid.tsx:876` card, `:994` detail; both show sensitive source fields.
  `accessible-modal.tsx:48` focus lifecycle and `:108` focus trap. Never capture their rendered DOM.
- `apps/mobile/components/hero/outfit-recommendation-card.tsx:14` active outfit;
  `apps/mobile/app/(tabs)/index.tsx:827` live/cached caller.
  `components/community/community-card.tsx:214` shared card and actions;
  `src/features/community/community-screen.tsx:1734` spotlight render, `:1835` detail/deep link,
  `:1967` feed render. `components/community/community-spotlight-detail.tsx:49` dismissal pattern;
  `components/edge-to-edge-modal.tsx:85` safe modal;
  `src/lib/accessibility-focus.ts:18` safe native focus.
- `apps/{web,mobile}/src/lib/api-client.ts`: app-local factories. Generate SDK operations and add
  wrappers through `packages/api-client/src/contracts/http/`; exported APIs at `src/index.ts`.
- `apps/mobile/package.json:47` existing file-system; `node_modules/expo/bundledNativeModules.json:65`
  MediaLibrary compatibility `~18.2.1`; `apps/mobile/app.json:39` plugins;
  `app.config.ts:16` isolated native identity precedent. Rebuild clients for new native module.
- `apps/mobile/modules/accessibility-focus/index.native.ts:24`: optional local native lookup;
  `expo-module.config.json` and `ios/AccessibilityFocus.podspec`: local Expo registration precedent.
  SDK54 `MediaLibraryModule.swift:124-133` and `SaveToLibraryDelegate.swift:9-17` route PNG through
  UIImage; the new iOS original-resource adapter is required for this story's byte guarantee.
- `apps/web/src/i18n/locales/*.json`, `apps/mobile/assets/locales/*.json`: ten matching catalogs;
  `apps/mobile/src/lib/i18n.ts:14` locale imports; add namespace parity coverage.
- `scripts/run-maestro.mjs:135` root-flow discovery; `scripts/maestro-flow-durations.json` timing;
  `scripts/lib/maestro-android-permissions.mjs:75` automatic grants require explicit launch maps;
  `:98` rejects setPermissions; `scripts/run-story65-native.mjs:617` native runner precedent.
  Add flow registration and a CC68 harness that selects the correct built app and test database.

## Tasks & Acceptance

**Execution, in dependency order:**

- [x] `packages/api-client/src/contracts/http/share-cards.ts` (new), `index.ts`, `openapi.ts`,
      `src/index.ts`: strict contracts and deadline-aware prepare wrapper; regenerate SDK/OpenAPI
      through scripts, preserving existing clients. Add `testing/share-cards-contract.spec.ts`.
- [x] `apps/api/src/modules/share-cards/` (new): add `share-cards.module.ts`,
      `share-cards.controller.ts`, `share-cards.service.ts`, `share-card-source.repository.ts`,
      `share-card-renderer.ts` and `share-card-png.ts`; update `apps/api/src/app.module.ts` and
      community storage adapter: auth, source resolution and final
      rechecks, bounded media acquisition, deterministic image, fresh metadata, audit and errors.
- [x] `apps/api/src/modules/share-cards/assets/` (new), `apps/api/nest-cli.json`: bundled artwork,
      licensed fonts and ten-locale fixed render catalogs; copy assets into production build.
- [x] `apps/web/src/lib/share-cards.ts`,
      `apps/web/src/app/components/{share-card-dialog,ritual-share-card-launcher}.tsx` (new),
      `lookbook-prism-layout.tsx`, `community-lookbook-grid.tsx`: real ritual source selection,
      eligible own-post actions, exact PNG preview, Blob download and focus restoration.
- [x] `apps/mobile/src/lib/share-cards.ts`, `share-card-save.ts`, `share-card-save-operations.ts`,
      `apps/mobile/components/share-card-composer.tsx` (new), hero/community cards, Home and Community
      callers above: reusable composition, exact preview, guarded native save, temp cleanup and focus.
- [x] `apps/mobile/modules/share-card-photo-save/` (new): `index.ts`, `index.native.ts`, `types.ts`,
      `expo-module.config.json`, `ios/ShareCardPhotoSaveModule.swift`,
      `ios/ShareCardPhotoSave.podspec` and `ios/Tests/ShareCardPhotoSaveTests.swift`.
      Expose optional lookup, native `.addOnly`
      authorization recheck and original-PNG import; retain transaction/file ownership until
      completion. Add module registration checks for development and release simulator builds.
- [x] `apps/mobile/package.json`, root lockfile, `apps/mobile/app.json`, `app.config.ts`,
      `apps/mobile/locales/*.json` (new native permission descriptions): compatible media module,
      generated permission inspection and both dev-client builds. Preserve image-picker access.
- [x] Both client locale directories and new `share-card-locales.spec.ts` per client: full namespace,
      placeholder parity and fixed API-render string agreement for ten locales.
- [x] Colocated API renderer/source/service/controller specs, web dialog/launcher/save tests, mobile
      composer/save tests: implement every U-ID above. Add
      `apps/api/integration/share-card-export.integration.spec.ts` for every I-ID, real database and
      controlled storage stream; source/consent/moderation races must use synchronized boundaries.
      `U-PENDING-FILE`, `U-SINGLE-WRITE` and `U-STORAGE` defer the native file read, then
      close/navigate/sign out before releasing it: bytes stay readable, the adapter runs once,
      deletion happens after settlement, duplicate activation stays blocked and another member
      receives no completion UI. Cover success, rejection, cache-cleanup failure and timeout.
- [x] `pact/http/consumer/interactions/share-cards.ts` and provider doubles: both source kinds,
      preview/save, denial and conflict. Add `playwright/tests/share-card-export.spec.ts` for every
      P-ID with real own-post/ritual fixtures and actual download-byte inspection.
- [x] `maestro/share-card-export.yaml`, permission/error subflows under `maestro/flows/share-card/`,
      `scripts/run-maestro.mjs`, duration registry, `scripts/lib/mobile-e2e-flow-state.mjs`, and
      `scripts/run-story68-native.mjs` (new): register and execute the flow on Android and iOS.
      Run real OS save/denial where supported; API32 Android verifies legacy permission states.
      Limited and storage failures use a deterministic native-adapter fixture restricted to isolated
      test builds. Keep real-save proof separate. Extract the actual original Photos resource for
      `N-IOS-ORIGINAL` and MediaStore file for Android, assert PNG signature and chunk allowlist,
      and compare SHA256 to the preview. Read access for extraction belongs to the isolated test
      harness only; production saving must pass with add-only permission. A temp-file digest or
      a Photos thumbnail cannot satisfy this proof. Run module-absent behavior on iOS as well.
      Add TalkBack/VoiceOver focus evidence, screenshot QA at narrow/wide web and both devices,
      long translations and large text. Integrate automated flows into CI; fixtures never bypass
      source authorization. Assert loaded markers and expected photo/artwork before saving.
- [x] `.github/workflows/pr-share-card-native.yml` (new), `.github/workflows/pr-mobile-e2e.yml`:
      run automated native share-card proof in CI using built dev clients on iOS and Android,
      including API32 permission coverage. Keep normal flow discovery/sharding and artifact
      collection consistent with local runs. Route native-only flows through the native harness.

**Acceptance criteria:**

- Given an eligible source, when the member prepares a card and changes watermark or locale, then
  AC1 produces the defined deterministic branded card and the preview displays its exact bytes.
- Given source metadata and personal-field bait, when the card renders, then AC2's PNG contains
  only permitted chunks and overlays; own-photo content follows Decision 1 and no source text,
  identity, location or URL enters added pixels, filenames or metadata.
- Given iOS, Android or web, when the member saves, cancels, refuses permission or encounters storage
  failure, then AC3 follows the matrix with truthful feedback, preserved composition and accessible
  focus. Each saved native file or web download equals the approved preview digest.
- Given a changed source, consent, identity or visibility, when prepare/save completes, then current
  authorization wins and unseen or stale bytes cannot reach the platform save operation.

## Implementation Notes

- 2026-10-25: Coordinator GO IMPLEMENT received after Astra and TEA both reported READY on
  `b490d4537a5063c790cc7994e96bf666c31caaad511f69c1008dc3df2604ece0`. Spec and sprint moved
  through ready-for-dev; implementation begins on `feat/epic6-story8-share-card-export` from
  `1d7b98485485c224063b573207c7e78bace717be`. Frozen requirements remain byte-identical.
- Implementation operating rules apply to the implementation worker and primary agent:
  - Never git stash, git checkout paths, git reset, or stage all paths. Red controls use an isolated
    throwaway worktree. Preserve the unrelated untracked coordinator-handoff.md.
  - One implementation writer at a time. The primary agent handles commits, remote operations,
    PR creation and coordinator messages. The implementation worker completes code and evidence
    and reports all unfinished work. Never merge or run coordinator_state.py.
  - Never reset the default local database at 127.0.0.1:54322. Create an isolated UUID database or
    loopback Docker containers named cc68-\*. Every Playwright run sets isolated DATABASE_URL and
    PLAYWRIGHT_SKIP_DB_RESET=true. Remove only resources created for this story.
  - Signal only owned process IDs. No pattern kills, system process changes or system settings.
    Vercel CLI stays in the linked checkout; no link/pull elsewhere or --yes creation/deletion.
  - Prefer direct npx tsc/eslint/vitest. Run touched-package global coverage, including api-client
    98% branches. Evidence commands use story-6-8/run-evidence.py. Checks assert loaded markers and
    fail on absent integration schema; fix every real failure and flake before completion.
  - React Native uses withRequestDeadline/abortError, static native imports and the Expo Go Android
    notification guard. New native code uses config/autolinking and rebuilt clients. Maestro waits
    for settled layouts after focus/keyboard changes and registers flows and durations.
  - No paid subscription or production enablement. No AI attribution. Conventional Commits and
    NODE_OPTIONS=--max-old-space-size=12288 when committing. Stage explicit paths only.
  - At context threshold, update story-6-8/implementation-checkpoint.md with done, in flight,
    failing and next; notify the primary agent/coordinator. No requirement or real defect is deferred.

- 2026-10-26 implementation decision: RitualService persists the global
  UserProfile.capsule_revision in OutfitRecommendation.capsule_revision. Export compares that
  recorded value with the live global profile revision and separately verifies capsule ownership.
  Capsule.revision is an independent counter. The real prepare API regression uses profile7 and
  capsule2, then advances profile8 and confirms refusal.
- 2026-10-26 coordinator accessibility evidence decision: no physical iOS device is available.
  Continue with XCUITest on the iOS simulator using XCUIApplication.performAccessibilityAudit
  across share-card states, accessibility traversal order, labels, traits and focus-target checks.
  This is the approved VoiceOver substitute. Actual VoiceOver interaction is not claimed.
  Android uses actual TalkBack on the owned API36 Play image, where its package is installed.
  Both paths belong in CI. Frozen acceptance text above remains unchanged.

- 2026-10-26: Coordinator approved a narrow Apple accessibility-audit raster OCR exception after the real simulator `.all` audit reported `elementDetection`, compact description `Potentially inaccessible element`, with no accessibility element in the open and unavailable states. The preview keeps the image trait and receives an authoritative bounded `accessibilityLabel` prepared by the server from the exact strings entering the same render, including every localized title, scenario, category, climate band, optional watermark and brand footer. This explicit accessibility requirement adds that response field to the earlier closed response contract. Photograph text and source free text are excluded. Every other issue, state, non-nil element or description fails the audit. Near-miss tests enforce the filter. The complete `.all` audit remains enabled.

- 2026-10-26: After the full authoritative image label was verified before audit, Apple also reported nil-element `Potentially inaccessible text` with detailed description `This element appears to display text that should be represented using the accessibility API.` Coordinator approved this second exact compact and detailed OCR signature only in open/unavailable states. Both signatures now require exact detailed text, nil element and elementDetection type; every other audit outcome still fails. The image keeps its trait and complete text label. A localized `watermarkRole` from each closed server catalog distinguishes the optional mark from the brand footer in speech, with the role phrase omitted when OFF. Additional near-miss tests reject altered descriptions, wrong type/state and non-nil elements.

- 2026-10-26: Coordinator extended the same two exact nil-element raster OCR signatures to observed retained-preview states saved, storage-failure, offline, denied, permanent-denied, limited and pending. The filter requires a present loaded image with exact full catalog/projection/toggle label and image trait verified before audit. Each state independently asserts its own exact localized status/error accessibility element; bridge tests verify the posted announcement, queue, deduplication and identity scope. The simulator substitute proves the posted announcement call and AX state; physical VoiceOver delivery remains outside the supplied device inventory. Missing or incorrectly labelled previews and every other issue fail.

- 2026-10-26: Coordinator approved a Story68-specific native startup disk gate of15GiB after
  shared host and Docker VM disk exhaustion. The generic legacy harness retains20GiB. Both use
  filesystem available blocks, include exact-boundary tests and refuse heavy work below their
  gate. Only recorded story-owned build intermediates, outputs and AVDs may be retired after proof.
- 2026-10-26: Installed Expo iOS permission service reports canAskAgain=false after the first real
  Photos add-only denial. The native proof resets only the owned application's photos-add grant,
  denies the real OS prompt, opens Settings, grants add-only access and returns without import,
  then saves explicitly. The retryable denial branch also receives a restricted adapter response
  test. Evidence distinguishes the actual OS and controlled response paths.

- 2026-10-26: Real Community photo selection exposed the removed read-purpose key and then an
  existing foreground-host dismissal. Coordinator authorized restoring the existing localized
  photo-read purpose alongside add-only save, using the supported iOS PHPicker without broad
  library permission, and retaining an open post draft/native modal host during fresh foreground
  verification. New server actions pause until access recovers; actual denial or identity change
  closes and clears the draft. Android retains its existing permission guard. Real simulator
  background/foreground with PHPicker open and read access revoked now preserves the chooser and
  returns the same draft on Cancel. Share-card export continues using its add-only writer.

- 2026-10-26 coordinator owner-rule decision: all eight existing opt-in API cases must execute
  in mandatory CI. Seven locale release-bound tests run in the corpus step; the real image/comment
  resource case runs in a separate compiled production-worker process with deterministic inputs,
  cached lockfile-pinned model artifacts and the manifest budgets. Both steps reject skipped,
  failed, missing or incomplete JSON reports. Worker RSS excludes the separate fixture driver.
- 2026-10-26 coordinator screening decision: repair general language collisions using training
  and independent development material only. Frozen holdout contents remained unavailable while
  tuning. After v2 failed its unchanged Wilson gate, the coordinator allowed one further general
  repair including German and commissioned independent blind v3 with 1,000 cases per locale.
  The repair preserves all dictionaries, disguised-term checks and the 1% Wilson upper bound.
  TEA reported zero withheld in every locale, zero in-sample errors and zero disguised passes.
  The 21-file repair manifest is
  `5e97ccffd9c2b23ebe16457301b35ca715421783da940a3cb9677061b8d26128`.
  Further repair changes require a fresh independent holdout. Reviewers separately assess the
  synthetic corpus diversity and its repeated-fragment dependence.
- 2026-10-26 coordinator measurement decision: retain the 1,950 ms community authorization
  budget and fail-closed behavior while diagnosing the concurrent 100-socket failure. Compare
  Prisma phase and commit-settlement timings with independent 100 ms database round trips,
  host CPU/runnable processes and PostgreSQL CPU throttling under the same package/native load.
  An independently measured host contention cause permits a dedicated fixed-environment budget
  lane. Fast database service with an application queue stall requires a product fix.

- 2026-10-26 measured scheduling decision: the exact refresh1 replay included an active Release
  compilation, primary PHPicker and fresh secondary simulator cold boot. It reproduced5/100 sockets;
  independent SELECT1 p5015.9/p9572.8/max144.9ms, host idle0% and80 runnable processes accompanied
  ordinary Prisma BEGIN/COMMIT inflation. PostgreSQL had unlimited CPU with zero cgroup throttling.
  The100-socket wall-clock proof now runs through vitest.realtime-budget.config.ts on a dedicated
  ubuntu24.04 CI runner with its own PostgreSQL17 and Redis7, one worker and five independent cold
  starts. Default global coverage excludes that exact test file; every other realtime regression
  remains in the global tier. The mandatory job rejects missing or skipped tests. Product1950ms
  deadline, five-connection pool and100-member assertion remain unchanged. Final local evidence
  must include five complete loaded package runs followed by their isolated cold budget proofs.

- 2026-10-26 notification recovery decision: the replay's second expiry came from the product
  grouping transaction's existing1000ms cap. Retain it to bound shared privacy-lock ownership;
  the production non-overlapping runtime schedules another grouping pass250ms after failure.
  The failed transaction rolls back the group and intent attachment before any provider call.
  Fixture preparation now models that recovery for observed P2028 expiry after at least1000ms,
  with250ms pauses and at most three passes; fast transaction errors and every unrelated failure
  still fail immediately. A real PostgreSQL pg_sleep expiry proves rollback, successful next pass,
  one delivery and no duplicate provider send. A runtime clock test proves250ms rescheduling
  without overlapping passes; negative helper tests prove the retry signature and bound.
  These tests and every cross-feature privacy case remain in each loaded global coverage run.

- 2026-10-26 final browser boundary repair: immediate ritual launcher activation could read an
  empty bearer before initial session verification. The launcher now awaits the canonical verified
  session resolver, preserves its initial identity publication, and cancels former-member work on
  identity departure. A real browser regression holds profile verification across the click and
  asserts an authenticated ritual request. The consolidated suite also validates cached Auth
  sessions before reuse because genuine UI sign-out revokes them before JWT expiry; only an actual
  missing session permits a fresh run-owned OTP. Other verification failures remain fatal.

- 2026-10-26 final local review: all 13 confirmed code findings (B1-B8, B10, E1-E2,
  V1-V2) are implemented. Client disconnect cancels bounded Sharp stages; admission ownership
  lasts through settlement. Authorization inserts audit and then revalidates source/privacy under
  locks, rolling back on revocation. Actual transport errors reach offline feedback. Selected
  PHPicker assets survive foreground access verification. Closing a retained preview clears Saving,
  and unmount cancels precommit work while committed native writes retain file ownership. Failed
  cleanup retries after 1/5/30 seconds. Painted text regions and the real 15-second renderer deadline
  have fault assertions. Mandatory browser CI requires all 45 cases across three engines.
  Per-finding tests and final execution are recorded in
  `_bmad-output/test-artifacts/story-6-8/reviews/local-review-round1-triage.json`.

- 2026-10-26 coordinator B9 decision supersedes the earlier independent-v4 delivery requirement:
  v4 failed its sealed Wilson gate and was retired to development data by commit
  `1061931acef45b1c59ccfbe1c7dc0e7cb601fa50`. Its corpus and failed evidence remain unchanged.
  Round 3 repairs canonical character-run minima, diacritic-preserving literal collisions and
  bounded garment-assembly/storage/material/transport/care grammar. A context clears only its
  exact target token; independent unsafe words and phrases remain screened. Deliberate-review
  terms cannot receive context allowances. All seven released-v4 development sets now withhold
  zero of 1,000, with Wilson upper bound 0.382676%; training has zero clean withholds and all 700
  disguised cases remain withheld. The real HTTP regression proves all 15 released cases publish
  and appear in their authorized comment lists. V4 supplies development evidence only.
  Round-3 frozen manifest SHA-256 is
  `c34a5f550cb616fcb219a5a00794890ed3c9e34fb4e8e43c0991d302f59bff02`.
  TEA authors blind v5 with rotated authorship and the unchanged independence and statistical
  gates. The builder has not inspected v5. Coordinator explicitly authorizes commit, ready PR and
  SOURCE_READY while that independent release evaluation runs in parallel; merge remains gated.

- 2026-10-26 coordinator test-only freeze exception: seven retired-corpus aggregate loops exceeded
  Vitest's 5-second default under coverage. A single screener already serves the whole module.
  Plain/covered milliseconds, measured on the same unchanged source with two-worker configuration:
  de 4443.757/5297.551, en 4661.066/5673.172, es 4375.896/5382.162,
  fr 4495.958/5485.585, it 4498.146/5494.940, pt 4527.883/5511.350,
  tr 4526.612/5290.220. Only these batch tests receive an explicit 20,000 ms deadline,
  3.525 times the maximum measured covered duration. Global defaults, assertions, selected corpora,
  production screening and product budgets are unchanged. The supplemental manifest records the
  sole old/new test hash and verifies all other 25 frozen hashes unchanged; its SHA-256 is
  `df77e029c8ad48b4ebf2da0d1daff8821d14de3ac7dfadc5777f36c95af3a6ae`.
  Both timing commands and reports are retained in `story-6-8/round3-loop-measurement/`.

- 2026-10-26 fixture timing root causes: injected actual PostgreSQL COMMIT delay reproduced the
  quiet-hours omission and HTTP fallback callback failure before their fixture corrections.
  Quiet-hours setup now obtains the completed live flag grant before changing its policy phase.
  Separate mandatory 500 ms claim/persist COMMIT controls prove the unchanged 400 ms product
  transaction safely defers with zero sends. The real HTTP callback proof fences the durable
  event before starting its 10-second callback observation; its original first-poll budget remains
  measured from outage. A 600 ms COMMIT delay passes, including a fence after the first poll;
  missing-history and no-callback mutants fail. Product scheduling and deadlines are unchanged.
  The original uninstrumented T02 omission's precise branch remains unobserved; the injected real
  commit mechanism and its red/green controls establish the repaired fixture boundary.

- 2026-10-26 final execution: five loaded API/SDK/web/mobile coverage batches all pass, including
  the real notification expiry/recovery and delayed-COMMIT controls. Five isolated cold socket
  proofs connect 100/100 in 406/392/384/439/432 ms against the unchanged 1,950 ms budget.
  Loaded SELECT 1 p95 is 1.925/1.749/2.022/1.780/1.849 ms; PostgreSQL throttling stays zero.
  Current Chromium/WebKit acceptance passes all 30 cases; macOS Firefox cannot launch its blank
  profile under the host protection failure, with red artifacts preserved. Mandatory Linux CI
  installs all three engines and requires exactly 45 passes. Current iOS 25-case matrix and real
  PHPicker selection/upload pass with read denied and add-only grant unchanged. Current Android
  production Hermes export and all three targeted real-save/precommit-cancel/committed-navigation
  cases pass, including extracted original SHA/chunks, one asset and empty cache. Both owned AVDs
  are retired. Android's owned emulator console is constrained to supported even ports 5554-5584;
  bounded selected-device reverse restoration never replays a UI command. Final evidence and
  explicit platform limits are in `story-6-8/verification-trace.md` and the checkpoint.

- Final round-3 API global gate `api-post-round3-global-2` passes on unchanged source:
  314 files and 4,657 tests pass; eight opt-ins remain assigned to mandatory corpus/resource CI.
  Coverage statements/branches/functions/lines is 94.96/88.78/96.07/95.70%, clearing every ratchet.
  Exact run-owned UUID database and Redis cleanup is confirmed.

## Spec Change Log

- 2026-10-25, iteration 2 in progress, Astra round 1: accepted A1 and A2. iOS now imports the
  original PNG through a registered local Photos adapter with add-only access and optional lookup;
  actual Photos original-resource extraction proves signature, chunks and SHA256. A process-lifetime
  operation owner retains immutable files and duplicate-write guards through close/navigation/
  sign-out until native settlement. Added module-absent, deferred-read and late-identity tests.
  KEEP: exact-byte preview, own-post eligibility, strict overlays and real-ritual web launcher.

- 2026-10-25, iteration 2 completed, TEA round 1: accepted T1, the same iOS original-resource
  defect as Astra A1. Both reviews are folded in. All original 26 matrix rows remain, with explicit
  original-Photos-resource and absent-module rows added. Actual iOS/Android saved-file assertions,
  add-only production scope and web download-byte assertions remain required.

- 2026-10-26 coordinator B9 decision: the synthetic v3 corpus does not count as independent
  release evidence. TEA owns a fresh independently written v4 corpus, overlap measurements and
  evaluation against the frozen round-2 repair. The builder keeps all 21 repair files and all
  holdout/gate paths untouched. Independent v4 acceptance is required before delivery.

## Review Triage Log

- Astra round 1 on `cfed026c7709c31a1d80970ff3ed074174358ecdd50a135c8dce96a5b248c02b`:
  A1 high accepted, SDK54 PNG save decodes through UIImage, so original-resource adapter and real
  Photos bytes are required. A2 medium accepted, native Android file read is asynchronous, so
  committed file cleanup belongs to the pending-operation owner. Both amended; TEA round 1 pending.

- TEA round 1 on `cfed026c7709c31a1d80970ff3ed074174358ecdd50a135c8dce96a5b248c02b`:
  T1 high accepted and resolved by the same original-resource writer and proof as Astra A1.
  TEA accepted all 26 existing matrix-to-test mappings and reported no additional material finding.
  Iteration 2 contains both reviews; spec remains draft pending rereview. Reports:
  `_bmad-output/test-artifacts/story-6-8/reviews/cc68-astra-story-review-1.md` and
  `_bmad-output/test-artifacts/story-6-8/reviews/cc68-tea-story-review-1.md`.

### Implementation review round1

| Finding | Verdict     | Route                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | ----------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1      | medium      | patch                | Controller.prepare invokes service.prepare with only member/input. No request/response disconnect handler exists; storage and render work continue after a canceled client. Use response close only when incomplete and request aborted; ordinary completed body close must not cancel.                                                                                                                                                             |
| B2      | medium      | patch                | Service deadline aborts its controller, but renderer.prepare receives no signal and awaits multiple separate Sharp jobs. Its five-second stage limits do not stop subsequent stages after the operation deadline.                                                                                                                                                                                                                                   |
| B3      | medium      | patch                | No endpoint or service admission guard exists. Every concurrent authenticated request reaches sources/download/fonts/Sharp; the global Sharp worker pool bounds active threads while queued decoded inputs remain unbounded. Bound admission without adding a new public response branch, using existing closed503 unavailable.                                                                                                                     |
| B4      | high        | patch                | Service resolves eligibility at line77, then awaits auditLog.create; afterward it checks only cancellation. A withdrawal/consent change while the audit waits is never re-resolved before successful authorization. Add a synchronized audit-delay refusal/rollback proof and final guarded authorization boundary.                                                                                                                                 |
| B5      | medium      | patch                | Mobile prepare only creates offline error through restricted fixture. Actual transport rejection is propagated; composer maps it to render or storage. Production transport failure must reach closed network/offline feedback and be tested through real transport boundary.                                                                                                                                                                       |
| B6      | medium      | patch                | CommunityPostSheet checks captured suspended before awaiting picker, then checks only cancellation before allocation/upload. Foreground verification can set suspended during that await; actual caller retains modal on this transition. Preserve selection and defer network actions until current verification succeeds.                                                                                                                         |
| B7      | medium      | patch                | Both close callbacks clear busy/loaded but leave message saving; valid-preview preparation returns early. Old save settlement correctly suppresses its UI, leaving saving text indefinitely after the process pending guard clears. Reset presentation-scoped transient feedback on close/reopen.                                                                                                                                                   |
| B8      | medium      | patch                | commitShareCardSave queues failed deletion; retryShareCardCleanup is called only by startup orphan cleanup. No later scheduler/foreground/save trigger exists. Recoverable deletion can retain an exported photo for the whole session. Schedule bounded cleanup retries without another import.                                                                                                                                                    |
| B9      | maybe-false | coordinator-decision | Repeated fragments and dependence are real and explicitly disclosed in README/diversity metadata. Coordinator requires unchanged preregistered gate and assigns diversity acceptance to code reviewers; this blind reviewer requests independent samples or cluster-aware analysis. No repair/corpus edit is authorized here; coordinator must decide whether existing disclosed gate evidence is adequate or TEA needs a fresh independent corpus. |
| B10     | medium      | patch                | Dedicated Playwright config has no projects and native workflow installs only Chromium. WebKit/Safari asynchronous download handoff is a named affected browser consumer without executed engine coverage. Add Firefox/WebKit projects and mandatory CI installation; preserve all15cases for each.                                                                                                                                                 |
| E1      | high        | patch                | Preparation effect cleanup aborts its captured preview controller, while Save replaces controller.current. No unmount handler invalidates latest.current.open or aborts that current save controller. A pending authorization resolving after React unmount can pass stillCurrent and hand off download.                                                                                                                                            |
| E2      | high        | patch                | The valid-preview early-return cleanup only aborts a captured unused controller and skips generation invalidation. A later save controller can complete permission/authorization after unmount, with latest.open still true. Always invalidate current precommit work at unmount; preserve already committed manager ownership.                                                                                                                     |
| V1      | medium      | patch                | Pre-verified gap: current tests separately assert accessibility strings, photo pixels, dimensions/digests/watermark. Removing text helper overlays.push leaves those passing. Add decoded painted-pixel checks in all required heading/scenario/category/climate/footer regions.                                                                                                                                                                    |
| V2      | medium      | patch                | Pre-verified gap: existing service tests cover immediate failures/already aborted input, while I-BOUNDS uses separate5secondstorage timeout. Add held-operation fake-clock timeout and late-settlement no-success/no-audit assertions.                                                                                                                                                                                                              |

### Implementation review round1 closure

All 13 confirmed findings are patched and verified. B1-B4/V1-V2 pass the API fault,
concurrency, privacy and pixel assertions, plus the final 4,657-test global gate. B5-B8/E2 pass
mobile focused tests and current iOS25/Android real-save and retained-preview lifecycle proofs.
B10/E1 pass the current30 Chromium/WebKit suite and the mandatory45-case CI report gate units.
Five complete loaded package runs and five isolated100-socket proofs pass after the fixture
boundary fixes. The per-finding JSON log retains its original claims and adds final evidence.

B9 is resolved by coordinator decision: v4 is immutable development data; blind independent v5
runs in parallel with code review. Its pending release verdict is explicit. Coordinator requests
SOURCE_READY now; spec stays in-review and sprint stays in-progress until the external reviewer,
TEA and CI phases authorize the later admin commit. No merge is authorized.

## Design Notes

This story adds one API feature module, generated contracts, client composers, a native media
dependency and a local iOS Photos adapter. No schema migration, production configuration change or
external publication is required.
Saving is the explicit irreversible device side effect; only Save activation authorizes it.

The coordinator resolves routine product choices under owner delegation. Draft and sprint backlog
remain until cc68-astra and cc68-tea both report READY; implementation requires GO IMPLEMENT.

Verified external implementation references, 2026-10-25: SDK54
[MediaLibrary API](https://raw.githubusercontent.com/expo/expo/sdk-54/packages/expo-media-library/src/MediaLibrary.ts)
defines write-only access, limited privilege and file save. SDK54
[Android implementation](https://raw.githubusercontent.com/expo/expo/sdk-54/packages/expo-media-library/android/src/main/java/expo/modules/medialibrary/MediaLibraryModule.kt)
excludes granular reads for write-only requests and storage permission for API33+ writes. The
[config plugin](https://raw.githubusercontent.com/expo/expo/sdk-54/packages/expo-media-library/plugin/src/withMediaLibrary.ts)
adds permissions that need inspection. Sharp documents
[explicit font files](https://sharp.pixelplumbing.com/api-constructor/) and
[default metadata removal](https://sharp.pixelplumbing.com/api-output/); final PNG chunk verification
is an additional application invariant. Expo's v54 documentation URLs currently redirect to latest;
the SDK54 source and installed compatibility manifest govern this work.

Astra's native inspection is confirmed by SDK54's
[PNG save dispatch](https://github.com/expo/expo/blob/sdk-54/packages/expo-media-library/ios/MediaLibraryModule.swift#L124-L133)
and [UIKit delegate](https://github.com/expo/expo/blob/sdk-54/packages/expo-media-library/ios/SaveToLibraryDelegate.swift#L9-L17).
The local iOS adapter uses Apple's
[original file-resource import](<https://developer.apple.com/documentation/photos/phassetcreationrequest/addresource(with:fileurl:options:)>)
with [add-only access](https://developer.apple.com/documentation/photos/phaccesslevel/addonly).

## Verification

- Invoke cited checks through
  `_bmad-output/test-artifacts/story-6-8/run-evidence.py LABEL CWD CMD...` and retain source manifests.
- Direct focused Vitest suites, `npx tsc` and `npx eslint` in touched workspaces; locale parity;
  each touched package's global coverage gate, including api-client 98% branches.
- `npm run generate:http-openapi`, `npm run generate:api-client`, `npm run optic:diff`, Pact consumer
  and provider: additive contract only and all interactions pass. Generated files remain tool-owned.
- Playwright share-card and affected community/ritual journeys with isolated UUID `DATABASE_URL`
  and `PLAYWRIGHT_SKIP_DB_RESET=true`; no default database reset. Parse downloaded PNG chunks and
  compare digest against the displayed preview bytes. Inspect screenshots for actual photo crop,
  branding, long-copy bounds and accessible contrast.
- Android and iOS native dev-client builds; new real-save flow on both, API32 permission cases,
  affected existing Maestro flows on Android, focus evidence and extracted saved asset inspection.
  iOS proof reads the actual original Photos resource and compares PNG signature, allowed chunks
  and SHA256 against the preview; development and release builds register the local save module.
  Existing flow runner auto-grants cannot stand in for denial tests. Isolated test adapter cases
  prove limited/failed-storage behavior; successful OS write must also run without adapter stubs.
- Before implementation: retain each draft as `spec-iteration<N>.md`, report its verified SHA256 to
  cc66-coordinator and wait for the two story reviews. Earlier snapshots remain immutable.
  Sprint remains `backlog` until both reviewers report READY.
