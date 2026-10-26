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

- 2026-10-26 first PR CI root causes: Android original-resource lanes failed before app work
  because setup-android's default requests the removed SDK package `tools`. The job now explicitly
  installs `platform-tools`, matching the established native workflows. The iOS original-resource
  lane's ARM host failed to create its configured x86_64 QEMU guest because Homebrew Lima ships
  non-native guest agents separately; install `lima-additional-guestagents` with Colima/QEMU,
  as documented by [Lima installation](https://lima-vm.io/docs/installation/). Product native
  behavior, real original-resource assertions and the fail-fast disk gate remain unchanged.
  The Node Pact consumer failed parsing the React Native Flow entrypoint after the mobile
  community adapter gained a static Platform import. Its protocol-only runner now resolves that
  platform capability to a minimal iOS shim before Vite transforms dependencies. Actual client,
  HTTP request/response, Pact server and provider verification remain active; mobile/device tests
  cover native picker and permission behavior. The exact mobile consumer failure was reproduced
  locally, then all 210 interactions passed with retries disabled after the alias correction.
  Evidence is retained under `story-6-8/runs/ci-pact-mobile-*` and original CI logs/artifact.

- 2026-10-26 external review batch: Astra A1 requires optional native SDK loading after both
  registry capability checks. Baseline clients now boot with no ExpoMediaLibrary registration;
  supported development clients retain the actual SDK and original-resource save paths. Actual
  installed SDK initialization and transpiled import-chain controls fail before the repair and
  pass after it. Precommit cleanup preserves the original failure and queues bounded owned retries.

- 2026-10-26 external review M1 decision: superseded preparation retains ownership until actual
  settlement. A cancelled predecessor permits one replaceable waiter for the member; the existing
  four-active and one-active-per-member bounds remain. The 15-second deadline includes queue time.
  Actual HTTP disconnect/replacement and PostgreSQL-held browser proofs exercise the boundary.
  Mobile feedback ownership is reactive state so rapid watermark changes keep Preparing visible.
  Native proof starts its 12-second SQL hold after the Maestro driver is ready through a one-shot
  loopback capability; explicit release follows the final held assertion and precedes CLI teardown.
  The original product deadline and all held-state assertions remain unchanged.

- 2026-10-26 external review H1/H2 decision: restored collapsed deletion matching and worst
  applicable severity. Generic contexts cannot exempt high-severity targets. The coordinator
  approved nine contiguous French retard constructions and seven Portuguese/Spanish tapete noun
  constructions, independent of declared locale. Each exempts its exact literal occurrence only;
  punctuation, emoji, line breaks, obfuscation, a separate bare occurrence and other high terms
  remain screened. One reviewed table owns this surface, with per-entry neighbor controls and
  generated-view integrity checks. Round 4 is committed as
  `9783ee4701a93b164e13cee2f0aa36aef5eb8d69`; its 38-path manifest SHA-256 is
  `87dbf164c74999949e87508a76b1bc5c5327f52fe5a3177e8ff414cfd3a2057a`.

- 2026-10-26 coordinator Round 5 decision: v5 was retired to development by
  `11dda5768f1f2463876b7245e7eb8deb7a458e0d` after the Italian Wilson upper bound exceeded
  one percent. Its corpus, seal and failed evidence remain preserved. Round 5 may repair general
  classes from the ten authorized development cases. Every added native-sense construction must
  cite preexisting development or training evidence and have a blocked-neighbor test; unsupported
  additions are removed. Existing balls variant behavior remains exact by explicit coordinator
  decision because ordinary fashion uses make broader indexing unjustified. TEA owns the blind
  v6 cohort, release selector and evaluator; the builder does not inspect v6 content or results.

- 2026-10-26 current CI failure repairs: bootstrap fixtures copy both disk-space and native-flow
  dependencies. Prebuild lint uses runtime URLs for generated API entrypoints. Android original
  lanes explicitly grant and require KVM access after measured software-emulation boot failures.
  macOS uses the available ARM64 image architecture and a bounded GNU timeout installed through
  coreutils; the prior missing-timeout fallback exceeded the configured startup budget. Closed
  native failure artifacts admit only a repository flow basename, classification enum, integer
  duration and platform. CI execution must confirm the corrected native startup and save lanes.

- 2026-10-26 global API proof ownership: a Nest rebuild deleted dist during a compiled-child test.
  Builds are serialized before suites that spawn compiled children. Child-exit detection now fails
  immediately with owned diagnostics; real-process regression controls cover the boundary. The
  serialized API gate passes 4,881 tests with 94.99/88.96/96.11/95.73 percent global coverage.

- 2026-10-26 Round 5 freeze: final reviewed surface is 24 constructions. The original 16 are
  exact. Eight additions have preexisting development evidence and per-entry blocked-neighbor
  controls: three textile quantity/compound phrases name yarn or wool bundles; two Italian
  determiner phrases name a repair patch; two Turkish possessive/genitive phrases name ballet
  shoes; one Turkish locative phrase names cooking. The evidence scan removed 37 unsupported
  additions. All seven retired-v5 development sets withhold zero of 1,000, with Wilson upper
  bound 0.382676 percent. All 9,982 disguised training cases remain withheld. Focused plain and
  covered suites each pass 492 tests, and guarded HTTP passes 78 tests. Round 5 is committed as
  `1cd9441b386945ec2ac6e9590bf36c4ef89863d5`; its 48-input manifest SHA-256 is
  `8a2ef3a4138b2a50a0052f3aab24749403f6fe861891d2141324e9d695f8a2a1`.
  Forty-one repair/input paths and seven unchanged retired-v5 inputs are pinned. Independent
  v6 release acceptance remains owned by TEA; these retired-corpus results are development proof.

- 2026-10-26 current native fixture repairs: iOS sign-in succeeded at Auth, then queried the
  previous hierarchy during the native pop transition. Each back/close operation now waits for
  animation settlement. Android live sign-in entered five of six OTP digits, losing the first;
  the captured code had no leading zero and the owned email matched. The fixture waits for the
  keyboard before entry and asserts the full code before Verify. A fresh real Auth journey then
  passed. Sign-in also establishes the tab layout before locale selection, so a failed prior
  form cannot invalidate that prerequisite. Secret code values remain absent from retained logs.

- 2026-10-26 native heading proof repair: actual iOS traversal found two exact-label StaticText
  records at identical nonempty bounds. The diagnostic confirms the direct parent/child pair;
  installed Fabric marks the paragraph container inaccessible and delegates its label and traits
  to one accessible child. Shared XCTest selection now verifies that structure and counts semantic
  leaves. Equal-frame siblings, malformed descendants and invalid visibility still fail. Eleven
  pure controls and three compiled negative controls cover the boundary in mandatory macOS CI.
  Existing nine audit test IDs, the separate fallback test, duplicate-content checks and all
  accessibility audit types remain unchanged. No product change was required for this finding.

- 2026-10-26 fallback evidence: the native proof withdraws only its recorded owned post, requires
  actual foreground target revalidation, dismisses the retained composer and restores the exact
  row. Fingerprints protect every other post field. Android requires the actual TalkBack cursor
  on the existing heading; iOS uses the approved strict XCUITest substitute. Public summaries
  project fixed primitive proof facts and explicitly record the iOS cursor boundary. Private logs,
  identifiers and runtime capabilities cannot enter those summaries.

- 2026-10-26 current global API proof: the frozen Round 5 build passes 4,934 tests across 320 files,
  with 94.96/88.82/96.12/95.69 percent global coverage. Product source remains identical to this run.
  The current fresh-owned Expo Go proof also passes loaded preview, disabled Save and no new asset;
  its temporary simulator was deleted immediately. Preexisting Expo Go installations remain intact.

- 2026-10-26 fallback fixture correction: the live status transition exercises existing reaction
  and realtime triggers. They advance `reaction_generation` before RETURNING and
  `community_revision` afterward. The harness now checks exact expected increments under the
  row lock, rereads after the AFTER trigger, and fingerprints every remaining field. Restoration
  restores content and status while retaining monotonic trigger counters. Concurrent content or
  counter changes refuse overwrite. Unit controls fail before the fix and pass afterward; a real
  database round trip proves content restoration and exactly two increments per counter. The
  public fact is named `ownedPostContentRestored`. Actual iOS fallback execution passes the separate
  strict `.all` audit, retained foreground preview, removed opener and existing semantic heading.
  The completed primary suite also passes all nine strict audits, and the current matrix passes
  thirty states. Android startup remains guarded by the unchanged 15 GiB floor.

- 2026-10-26 Android driver diagnosis: the current matrix passed twenty-two checks, then the
  next Maestro invocation failed before any Cancel command. Device logcat records its gRPC
  server failing to bind port 49998 with Address already in use. Maestro selected a host-free
  ephemeral port that was occupied on the device; its device range is 32768 through 60999.
  Both dedicated test launch paths now reuse the repository's pinned driver port 17001. Four
  actual-function controls cover normal and rapid launches on Android and iOS, and removing the
  pin fails both Android controls. The original failed Cancel journey passes through the corrected
  runner. The closed failure classifier recognizes this fixed startup signature without exporting
  raw logs or identifiers. The iOS invocation is unchanged. Full Android matrix and cursor proof
  continue from a fresh matrix invocation after this measured harness repair.

- 2026-10-26 coordinator font-size decision: development matrix setup may cold-stop the owned
  application before applying the configured large text size, then restore the original size with
  the same cold-start ordering. A separate mandatory Android Release proof changes system font
  size from 1.0 to 1.5 while the card is open. It must preserve or restore the card and its watermark
  choice, keep the same process alive, show no crash or error surface, and measure title growth.
  Actual stock Release execution reproduced card disappearance after Activity/Fabric root
  replacement. Its title was 92 pixels before the change. The preserved hierarchy and logs show
  the same process with no crash or error surface, so this requires a presentation-state repair.
  A diagnostic manifest `fontScale` flag was rejected: it retained the card while preventing text
  growth, measured at 92 pixels before and after. Stock Activity configuration remains required.

- 2026-10-26 coordinator Release networking guard: the owned HTTP proof runtime requires an
  explicit local build exception. Both `CC68_RELEASE_PROOF_LOOPBACK=1` and
  `STORY68_NATIVE_TEST_BUILD=1` are required, with the exact isolated package and validated local
  API/Auth origins. Only an unset local EAS profile or `cc68-release-proof` may generate the policy.
  Production, release and all other named profiles reject that input. The policy keeps base
  cleartext disabled and system trust, allowing only `localhost`, `127.0.0.1` and `10.0.2.2`, each
  without subdomains. Normal generation adds no exception. A read-only guard rejects stale owned
  proof XML or its manifest reference when the input is off, requiring clean normal generation.
  Twelve actual fresh and sequential prebuild controls pass, including production-policy RED
  with the explicit input and GREEN without it. Existing EAS profiles and public build inputs
  remain unchanged. The closed public Release summary validates state, labels, production marker,
  APK digest, process/crash/error facts, measured growth and successful font cleanup before copying
  any evidence. Its two new controls fail before selection and pass after the projection repair.

- 2026-10-26 Android presentation repair: one root-owned host retains a process-memory draft
  containing source IDs, verified member, watermark choice and open state across Fabric root
  replacement. A successor lease freshly prepares eligible bytes. Old-root openers, close and
  focus callbacks, navigation effects and finalizers cannot affect that successor. Identity
  changes destroy the draft synchronously, navigation retires the visit, and Cancel remains
  closed until explicit reopen. The independent save manager retains ownership of committed
  native files until settlement; precommit authorization aborts with its old composer. iOS keeps
  the existing screen-owned composer lifecycle. The real-composer remount reproduction fails
  for both source kinds before repair. All 329 focused checks and the current 1,536-test mobile
  global coverage gate pass afterward. Device acceptance remains separate from those source tests.

- 2026-10-26 permanent Release proof: API36 CI installs a non-debuggable Release APK whose
  extracted installed digest matches its build input. The actual Settings and composer flows
  require the production preview marker, exact localized title and full watermark-OFF label,
  then perform the live font change and assert state, process, crash/error and measured title
  growth. Font restoration always follows a cold stop, including failed assertions. Actual
  Maestro hierarchy calls measured 9,656.819, 7,790.611 and 7,950.786 milliseconds. The baseline
  snapshot has a 20-second bound and later snapshots use the remaining original 20-second
  restoration budget. Private failure diagnostics precede cleanup and preserve the original
  assertion if collection fails. The command's 33 new controls, 45 existing controls and five
  native/generic bootstrap cases pass. CI always regenerates clean normal output with the
  proof input disabled when its Release branch exits.

- 2026-10-26 Release live-font observation diagnosis: the current shared-font/auth/route
  Release APK retains the watermark-OFF card in the fresh failure screenshot, and its restored
  preparation returns HTTP200 in 69ms. The acceptance check fails while starting its first
  post-change Maestro hierarchy capture. Device logs place the font change at 09:50:32, driver
  APK installations at 09:50:46-47, instrumentation startup at 09:50:49 and accessibility listening
  at 09:50:52.387, after the original 20-second observation clock expires. A copied after-tree
  belongs to the earlier proof4 and is excluded by its timestamp. The current failure screenshot,
  driver logs and source hashes remain preserved. Skipping driver reinstallation measures
  9,541.47ms for a valid explicit-device snapshot. The harness repair retains every state, label,
  process, error and measured-growth assertion and the original 20-second deadline. It clears only
  fixed owned attempt artifacts before capture and records command timing privately. Current
  rebuilt Release acceptance remains required before source delivery.

- 2026-10-26 follow-on observation repair: disabling reinstall only for the after-capture still
  leaves cold setup inside the deadline. Installed Maestro 2.8.0 bytecode and device logs show
  that its default baseline close removes both driver APKs. Both captures now disable reinstall;
  an absent driver is installed for the baseline, whose exact production-state assertions still
  precede the live mutation. Actual consecutive explicit-device captures retain both packages'
  code paths, versions and installation timestamps and complete in 14,044.71 and 5,750.13ms.
  The original 20-second restoration clock, full-label and watermark checks, measured growth,
  same-process and error/crash assertions remain unchanged. The failed attempt contains no stale
  tree. Rich command diagnostics and independently dated failure artifacts preserve its cause.

- 2026-10-26 renderer decision hold: current Release passes the card-specific live-font proof
  (title92 to137px, full watermark-OFF label, restored state, same process and no error), but
  visual inspection of Home finds missing paragraphs. An unchanged-source current-build probe
  records44 visible text nodes before scaling,5 after and when settled, then40 on a cold launch
  at1.5. The whole-app font repair therefore remains unaccepted. Exact main1d7b9848 Release
  retains43 nodes before, after and when settled in the same PID, while screenshots show clipping
  and temperature height stays169px. Clipping is pre-existing; the current repair adds wholesale
  paragraph loss. Main's tracked source and lockfile are exact. Its generated-only test identity,
  strict loopback network policy and same-binary Worklets output staging support the controlled
  local comparison. Full source identities, screenshots and trees are retained privately.
  Coordinator requires these baseline facts, the release boundary and native backport feasibility
  before choosing the next path. No further JS renderer workaround is authorized meanwhile.
- 2026-10-26 upstream trace: RN commit45904c866882f136edde55df2fe453327057d387 first ships in
  stable RN0.87.0; ExpoSDK58 ships RN0.88 with the native scaling flag enabled. Installed0.81.5
  consumes older prebuilt renderer artifacts and defaults that flag off. Source-level backport
  contexts are compatible with limited adaptation, but the public LayoutMetrics layout and
  configureYogaTree signature change. Coherent native artifacts and matching Fabric consumers
  must be rebuilt for every shipped ABI. A header or JS patch cannot update the prebuilt renderer.
  The fix does not modify the stopped-surface zero-measurement/cache path, so a cure for the added
  blank-text regression still requires native proof. No backport or upgrade has been implemented.

- 2026-10-26 final coordinator font decision and evidence: the shared AppText repair and all
  27 import migrations plus font-only navigation changes were reverted after actual Release
  text loss (44 to 5 nodes). Unchanged main 1d7b9848 preserves 43 nodes before and after live
  scaling. Independent Android composer, route/detail and authenticated-session restoration
  remain. Facts and upstream version/backport analysis are recorded in
  `_bmad-output/test-artifacts/story-6-8/review-font-three-facts.md`. The remaining clipping is
  the pre-existing RN 0.81.5 Fabric stale font-scale issue fixed upstream in RN 0.87. The
  coordinator assigned the Expo SDK 58 / RN 0.88 upgrade to its own story and rejected an RN
  source build. Current stock Release proof `review-android-release-live-font-10` preserves
  the approved watermark-OFF card, process and all four text nodes without crash or error;
  the measured title is 92 px before and 92 px after. The proof records that unchanged size.
- 2026-10-26 coordinator semantic-viewport decision: current Release four-family proof
  `review-android-live-font-text-preservation-3` preserves the exact text multiset on Home
  (43), feed (26), post detail (16) and settings (28) after live 1.0 to 1.5 scaling. The feed
  is explicitly scrolled back to the same owned post before comparison. Main also loses
  scroll/filter/weather context and resets Home on recreation, so the coordinator excluded
  those additional restorations. The owned Play emulator and CI use 4 GiB after measured
  system-wide memory/IO starvation and an ANR on the 2 GiB VM before any font mutation.
- 2026-10-26 fresh-build Worklets repair: the helper stages the verified native artifact into
  the actual Gradle variant/ABI output path. Same-inode AGP hard links are hash-verified;
  independent targets use a verified temporary sibling and atomic replacement. All 18
  controls and actual clean Release/Debug builds pass, with source/target digests archived.
  The first failed Gradle log was read during diagnosis and later overwritten by a reused
  runtime filename; its wrapper failure and deterministic hard-link red control remain.
  Subsequent build logs and artifact proofs are archived per attempt.
- 2026-10-26 real TalkBack repairs and proof mapping: the existing two-test composer class
  now rejects unresolved fixture intents and proves its owned cache glob with a cleaned-up
  UUID sentinel. UiAutomation executes command strings directly, so literal shell quotes
  had prevented both fixture activation and cache matching. Corrected execution exposed a
  genuine reopened Finishing focus defect: Modal.onShow moved focus from Cancel to the
  title. The targeted callback retains Cancel when an older operation owns Save; unit RED
  (title 41 instead of Cancel 44), composer 119 GREEN, full mobile 1,576 GREEN and actual
  TalkBack-current-7 (two tests) prove the repair. Matrix6 retains its 39 passing states with
  the exact three-path focus delta and current focused native proof recorded explicitly.
- 2026-10-26 removed-post fallback proof transport: actual Android fallback3 passed every
  native assertion, but the command wrapper rejected the missing completion marker. Logcat
  proves Kotlin println delivered the marker only to System.out. The marker now uses
  Instrumentation.sendStatus after all unchanged removal/header/cursor assertions. Actual
  fallback4 passes the wrapper, real TalkBack cursor and exact owned-content restoration.
  Android21 records the single instrumentation-only delta and retires cc68-api36. These
  tests cover I/O matrix U-A11Y and M-A11Y fallback rows together with the strict iOS
  XCUITest substitute and all existing label, trait and announcement checks.
- 2026-10-26 current final native acceptance: iOS original3 extracts one Photos resource with
  approved SHA-256 a1657c67ce12ed6395478013e3482a5e8404682403a167dbe7b7e96b86398e59,
  38,398 bytes and only IHDR/IDAT/IEND. Current iOS matrix5 passes all 30 cases; rapid5 holds
  the real source barrier for 6,843.924 ms with three requests and zero unavailable responses.
  Current strict accessibility6 passes all nine tests, including the coordinator-approved
  exact heuristic exceptions with strict labels, traits, status announcements and near-miss
  controls. Fallback3 passes the approved XCUITest simulator substitute with exact fixture
  restoration. Fresh Expo Go2 loads the preview, disables unsupported Save and preserves the
  Photos asset count; its owned simulator is deleted immediately. Android current original6,
  rapid5 (8,390.775 ms), real TalkBack7 (two tests) and removed-post fallback4 pass. Android21
  verifies the precise test-only transport delta and retires the owned API36 AVD. All cited
  current commands have unchanged source during execution. Pipeline reports and full private
  evidence are under `_bmad-output/test-artifacts/story-6-8/`.

### External review round 2 and screening round 6

- Coordinator tightened the high-severity occurrence table after Opus demonstrated English
  insult readings of French article constructions. Independent development evidence supports
  `en retard` in declared French and `um tapete` in declared Portuguese or Spanish. English
  insult frames refuse the French exemption; French insult frames refuse the rug exemption.
  Every occurrence remains independently screened. Unsupported article and preposition entries
  were removed. Eight existing low or medium constructions remain unchanged. The final table has
  ten entries. Round6 adds658 attack cases; all10,640 attacks refuse publication. Prior9,982
  attack rows and all2,940 clean rows remain intact. Balls behavior remains unchanged.
- Round6 frozen51 manifest SHA256 is
  `7b33f73895622ce85b6900cb965406ebba04de2533d1cb94997727218ce57201`.
  Development suites pass882 tests with and without coverage; real HTTP proof passes17 tests.
  Historical Round4 and Round5 identities remain verified at their original commits. TEA owns
  release eligibility and independent V6 authoring, seal and evaluation. Builder has accessed
  no V6 contents or results.
- Android presentation now treats a missing canonical member as screen-owned. Actual Home
  and Community component taps reproduce the prior absent detail or composer, then pass after
  the repair. Authenticated root restoration remains in place. Mobile coverage passes1,581 tests.
- Web retry success clears the recovery action after moving focus to Save. Held-request
  cancellation is witnessed on the exact Request; a bounded download event window detects late
  handoff. A mounted outfit control test preserves DOM identity across account changes. The
  production ritual launcher unmounts on departure, as verified in source. Browser30 passes
  across Chromium and WebKit for these review changes.
- The Release font proof now verifies the app's resumed MainActivity client configuration at
  scale1.5, then compares two complete stable snapshots spanning one second within its existing
  deadline. Six failing-first controls cover stale, global, foreign, paused and unstable samples.
  The coordinator's prior RN clipping and shared-font rollback decisions remain applicable.
- iOS focus evidence observes the actual posted UIKit layout-change target, its attachment,
  label, identifier, sequence and header trait. Concrete UIView and UIAccessibilityElement
  getters repair the runtime protocol-cast failure found by real UIKit tests. Ten UIKit tests,
  the rebuilt dev client, nine strict accessibility tests and removed-post fallback pass.
  This remains the approved simulator substitute; physical VoiceOver cursor delivery is not
  claimed. Current original Photos extraction matches the preview digest, with one fresh asset,
  an empty feature cache and only IHDR, IDAT and IEND chunks. Fresh Expo Go also passes; its
  owned simulator is deleted immediately after proof.
- Native CI reads the Android SDK once, validates the canonical number against its matrix API,
  and fails before installation on invalid input. Startup-deadline controls run before Supabase.
  The iOS job uses an Intel runner with an HVF precheck and architecture-specific image cache.
  Published ARM macOS logs show Colima using TCG and exhausting the unchanged startup budget.
- Published API32 CI completed original-resource extraction and eight matrix states, then
  failed the first locale's outfit flow. Its four-field summary and nine uploaded artifacts
  omit the failed selector, screen and device logs. The exact log confirms4GiB and failure
  about14m41s after boot. A published-source ARM replay passes all39 states; the CI cause stays
  unestablished. Coordinator authorized actionable, privacy-safe failure capture for the next
  attempt. Diagnosis is recorded in `reviews/cc68-round2-api32-ci-diagnosis-1.md`.
- Published API36 failed the WebKit harness1500ms assertion at2005.593ms before starting its
  emulator. The source remained blocked and OFF, ON and authenticated-profile checks completed.
  Product preparation retains its15-second deadline. APT separately downloaded116MB in52m44s
  from the Azure mirror. Browser provisioning now runs only in the API36 browser lane, uses the
  lockfile-matched CLI and official Ubuntu archive, restores original APT sources, and has a
  ten-minute process deadline plus kill grace within a twelve-minute CI step. The common
  accessibility bridge executes jsdom and requires no browser installation. Eleven controls
  pass; actual Ubuntu provisioning is validated by the next CI run.

- The actual WebKit delay proof now waits for genuine own-target resolution and a subsequent
  cursor replay before acquiring the table barrier. This fixes an observed setup race where the
  barrier blocked bootstrap authorization and the feed correctly hid unverified content. The
  total two-second delay is split across OFF and ON; a single two-second delay before the first
  cancellation correctly exceeds the separate1,950ms community authorization budget. That
  budget and the15-second preparation deadline remain unchanged. With zero503s asserted, old
  code fails at2,165.82ms against1,500ms; repaired code passes at2,235.51ms held time, with three
  requests, verified ownership, blocked source and a loaded final preview. Current Chromium and
  WebKit pass30 cases. Local Firefox repeats the documented macOS profile-launch restriction;
  all45 cases remain mandatory in the Linux CI lane.
- Terminal native failures now capture their exact known command and selector, paired geometry,
  fixed bundled labels, diagnostic signatures and bounded boot, memory and pressure facts.
  Public visuals explicitly mask all original pixels and are regenerated from validated fields.
  Raw account-bearing screenshots, hierarchy and logs remain private. Sensitive sign-in flows
  suppress visual projection. Capture has its own deadline and preserves the original failure.
  Browser artifacts retain the first closed failure per engine across later successful locales.
  Sixty-four current Node controls and nine audit/bootstrap tests pass. The original API32 CI
  failure remains unestablished; the next failure will include this actionable diagnostic record.

### Round2 final current native acceptance and diagnostic capture

Current Android36 acceptance completed on the fresh normal Debug build after the genuine
Release M4 proof. Original-resource extraction produced the exact preview SHA-256
`a1657c67ce12ed6395478013e3482a5e8404682403a167dbe7b7e96b86398e59`,
38,398 bytes, one new asset, empty feature cache and only IHDR/IDAT/IEND chunks. All 39 matrix
states passed. The actual PostgreSQL source-barrier rapid watermark proof held for
7,952.31 ms with three requests and zero unavailable responses. Real TalkBack verified modal
focus, save ownership, cancel restoration and the removed-post fallback cursor. The owned
API36 AVD was retired immediately after acceptance; the API32 AVD was already retired after
its published-baseline replay. Evidence: `review-r2-android36-current-pipeline-1.json` and its
sixteen named run directories. Genuine Release M4 preserved the same process and approved
watermark-OFF card through the live font change, with two stable complete snapshots spanning
one second. The accepted upstream clipping measurement remains 92 to 92 pixels.

The current rebuilt iOS app passed original-resource extraction, all nine strict accessibility
states, the removed-opener substitute and a fresh Expo Go run. Its original resource has the
same SHA-256 and PNG chunks as Android. Actual UIKit controls assert the posted request,
attached focus target and header trait. This is the approved simulator substitute. The owned
Expo Go simulator was deleted after the proof. Evidence: `review-r2-ios-current-pipeline-1.json`.

A controlled actual Maestro missing-watermark failure proved the new capture path before
commit. The closed record identifies `watermark.yaml`, failed `tapOnElement`, exact selector
`share-card-watermark`, the recent command statuses, 4 GiB device memory and boot state.
Commands, hierarchy, screenshot, logcat and system captures all exist. The public PNG was
visually inspected: every original pixel is masked and the replacement shows allowlisted
control outlines and fixed labels. It is a redacted diagnostic derivative. Raw captures remain
private. Evidence: `runs/review-r2-android36-diagnostic-negative-1/native-evidence/`.

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

- 2026-10-26 actual stock Android Release follow-on: the retained watermark-OFF composer restored
  after Activity recreation, then its preparation returned HTTP401 during the interval between
  root auth effects. API timing isolates the gap: successful preview requests preceded recreation,
  the restored preview failed in 3ms, and authenticated profile/Spotlight requests recovered after
  the new effect installed. The bearer boundary now lazily resolves the canonical secure native
  session across roots. Unique resolver leases and a shared SDK lifecycle prevent stale cleanup
  from replacing a successor or stopping its refresh. Actual signout and principal changes still
  invalidate verified identity immediately. Failing-first unit and real-composer overlap checks
  cover both source kinds; current rebuilt native acceptance remains required.
- 2026-10-26 coordinator app-wide font decision: stock Release live scaling from 1.0 to 1.5 clips
  Home, community feed, Spotlight detail and Settings. Private before/after screenshots and trees
  preserve each loaded family and same-process transition. The installed React Native 0.81.5
  Android Fabric surface uses a layout multiplier of 1 with its experimental layout flag disabled.
  These observations match upstream [RN52895](https://github.com/react/react-native/issues/52895)
  and [RN51768](https://github.com/react/react-native/issues/51768). The shared AppText primitive
  supplies current explicit Android metrics from the public fontScale hook and carries unscaled
  nested metrics, scaling opt-outs, maximum multipliers, native refs and accessibility props.
  All 27 app-owned runtime Text import sites use the shared boundary. Supported Android navigation
  title/tab renderers and growing header/tab containers cover those labels. iOS keeps its native
  automatic text path. One failing-first test per affected family, primitive inheritance controls
  and a mandatory AST import-boundary CI check guard this app-wide repair. No experimental native
  feature flag or fontScale manifest handling is introduced.
- 2026-10-26 native proof setup correction: the Settings locale fragment requires an explicit
  MAESTRO_LOCALE. The first permanent Release proof supplied none and targeted locale-btn-undefined
  before changing font size. Exact argument-boundary RED/GREEN controls now require en-US. The
  failed command, screenshots and source identity remain preserved as harness evidence.

- 2026-10-26 stock Activity recreation also resets Expo Router initial state to Home and closes
  screen-owned Spotlight detail. Android now retains an allowlisted static path and eligible detail
  ID in process memory, tied to the canonical member and root lease. A ready successor can replace
  initial Home once. Explicit tab, link, navigation and identity intents supersede the restore;
  stale roots cannot publish or reroute. Auth, guardian and enrollment routes are excluded. The
  composer waits for its restored route and uses that route's newly registered heading. Detail
  waits for freshly ready Spotlight membership and renders only the fresh item. Missing or refused
  membership clears it; a transient failure retains the ID for retry without stale card pixels.
  No query, URL, image bytes or post object enters this checkpoint. Real Community HTTP remount,
  refusal, late identity, Cancel, navigation and fresh-heading controls pass with the complete
  affected 360-test suite. Genuine rebuilt Release acceptance remains the next required check.

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

### Coordinator decision: revert shared font repair and preserve restoration

On 2026-10-26, the coordinator approved removal of the shared AppText font-scale repair,
its 27 import migrations and its navigation text changes. The stock Release comparison in
`_bmad-output/test-artifacts/story-6-8/review-font-three-facts.md` records the evidence:
unchanged main 1d7b98485485c224063b573207c7e78bace717be retained 43/43/43 text nodes
before, after and after settling a live system font change from 1.0 to 1.5. The shared repair
retained only 5 of 44 nodes. This paragraph loss is a regression introduced by that repair.

Composer restoration across Android Activity recreation, route and detail restoration, and
the secure-session auth-gap repair remain independently required. Current Release acceptance
checks every visible application text node on Home, feed, detail and settings across the live
font change, along with card state, process continuity, errors and crashes. The evidence records
actual measured title heights. It makes no claim that the existing Fabric clipping is fixed.

The unchanged main Release reproduces clipping with retained nodes and unchanged 169px
temperature height. React Native upstream commit
45904c866882f136edde55df2fe453327057d387 first ships in stable RN 0.87.0; Expo SDK 58
ships RN 0.88. The coordinator assigns the clean Expo SDK 58 / RN 0.88 upgrade to its own
story. RN source builds and renderer-cache workarounds are excluded by this decision.
The facts report records primary sources and why a source/header patch alone cannot replace
the RN 0.81.5 prebuilt Android renderer.

The coordinator also approved fixing the fresh-build Worklets artifact staging gap in this PR.
A fresh unchanged-main build showed Reanimated importing the legacy `intermediates/cmake`
path while AGP wrote the compiled binary under `intermediates/cxx`. The build harness must
stage the exact freshly compiled variant and ABI binary before its native consumer runs.

The first clean build of the permanent Worklets staging helper exposed an AGP hard-link case.
`review-native-android-final-pipeline-12.json` and its actual build log record compilation and
validation success followed by a failed Sync action. Compiled and legacy paths shared inode
618591403, link count2, and became empty because copying onto the link truncated the source.
The staging repair requires a real hard-link regression control, same-file verification without
overwrite, and safe replacement for independent stale targets. The source bytes must remain
unchanged and both final hashes must match. No APK from that failed build was installed.

The coordinator clarified the four-screen Release acceptance on 2026-10-26: compare the exact
text multiset at the same semantic viewport. After the font change, the feed proof explicitly
scrolls back to the same own post before comparing every text node. The failed first comparison
retained 26 nodes but compared different posts because Activity recreation reset the list to
the top. Home already retained all 43 application text nodes. The coordinator confirms main
also loses feed scroll, filter and weather-header context on recreation and even resets to Home;
those behaviors are excluded from this PR by this decision. Route/detail and composer state
restoration remain required. The proof records its explicit viewport repositioning.

The clean Release also encountered an ANR before any live font change on the owned 2 GiB Play
emulator. `review-native13-anr-root-cause.json` records Android's contemporaneous pressure
snapshot: memory stalls 66.98%, I/O stalls 59.64%, runnable app main thread in an Android splash
transaction, an InputManager watchdog stall and a separate Google service ANR. Cumulative
scheduler counters are identified as lifetime counters. The source APK remained unchanged.
The owned AVD restarted with 4 GiB and its existing data; the same Release card passed with
all four text nodes and OFF state retained, same process and no error/crash. The coordinator
approved retaining 4 GiB in CI. Native timing budgets remain unchanged.
The original pipeline12 Gradle log was read through the tool transcript before retry; its runtime
path was then reused. Its command failure and deterministic hard-link RED remain preserved.
Subsequent build logs and staging reports are copied into their individual evidence directories.
