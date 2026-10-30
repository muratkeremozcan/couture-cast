---
title: 'CC-6.9 Native platform sharing'
type: 'feature'
created: '2026-10-30'
status: 'in-progress'
baseline_commit: '185e827c949a5a038b18f6c1fd1feb22f3aad3e9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-8-safe-branded-share-card-export.md'
  - '{project-root}/_bmad-output/test-artifacts/test-design/cc69-native-platform-sharing-test-design.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 6.8 lets a member preview and save a branded share card, but the card cannot reach
Pinterest, Instagram, Facebook, TikTok or any other app without a manual save and re-upload.

**Approach:** Add a Share action beside Save in the mobile composer and the web dialog. It reauthorizes
the exact previewed bytes and hands them to the OS share sheet: a local Expo module on iOS and Android,
and the Web Share API on web. It keeps the composition on every non-success outcome, offers Save after
a failure, and records one privacy-safe analytics event per attempt. Native share ships behind a new
flag that is off in production.

Decisions (owner delegated planning, 2026-10-30; revised after Codex plan review and TEA test design):

- D1 Native share uses a local module `share-card-native-share`, because `expo-sharing` reports no
  target and no outcome.
- D2 Web shows Share only where the capability is on and `navigator.canShare({files})` passes;
  elsewhere Download stays the only action.
- D3 The share prepare uses a new request purpose `share` (`expectedSha256` required), handled like
  `save`. The audit row records `purpose`. Preview and save responses stay byte-for-byte unchanged, so
  deployed 6.8 clients keep working.
- D4 Flag `share_card_native_share_enabled`, default false; true only in the dev seed. A new
  `GET /api/v1/share-cards/capabilities` (authenticated) returns the shared envelope
  `{data:{nativeShare:boolean}}` per member, with `Cache-Control: private, no-store`. The client
  request times out after 5 s. Capability state is bound to the member: sign-out or identity change
  clears it, and a late response for a previous member is ignored. Clients treat any error, 404,
  malformed body or missing field as off. With the flag off, `purpose:'share'` gets 403 and no audit
  row.
- D5 Analytics go client-direct to PostHog as one event, `share_card_shared`, with a final allowlist at
  the SDK boundary and GeoIP disabled.
- D6 One PR. The spec stays whole above 1600 tokens because the layers ship as one user goal.

Result model, the single policy for UI, analytics and tests:

- `client`: ios, android, web.
- `target`: pinterest, instagram, facebook, tiktok, other, none or unknown.
  - other: a selected app outside the allowlist.
  - none: no selected target is confirmed. It reports what was observed and never proves that no
    app was picked.
  - unknown: handed off, but the OS hides the target.
- `outcome`, with its only valid targets:

  | Outcome         | When                                               | Valid targets                                                     |
  | --------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
  | `completed`     | iOS reports completed                              | the four apps, other, unknown                                     |
  | `target_chosen` | Android chooser callback                           | the four apps, other                                              |
  | `handed_off`    | web share resolves                                 | unknown                                                           |
  | `cancelled`     | iOS reports not completed                          | the four apps or other when iOS names an activity, otherwise none |
  | `dismissed`     | web AbortError, which means cancelled or no target | none                                                              |
  | `not_confirmed` | Android chooser closed with no callback            | none                                                              |
  | `failed`        | any failure                                        | none                                                              |
  | `unavailable`   | the share path cannot run                          | none                                                              |

- An attempt is one enabled Share activation that passes the duplicate guard. Pre-handoff 403, 409,
  offline and write errors settle as `failed`. Exactly one event per attempt. An attempt superseded by
  an identity change or sign-out emits no event. A statically disabled Share (module absent) shows a
  localized reason and emits nothing.

## Boundaries & Constraints

**Always:**

- Share only the bytes the member previewed. Reauthorize with `purpose:'share'`, then match the SHA256
  of the response and of the decoded bytes before any handoff. On iOS, the share module also checks
  the path and digest natively with its own `ShareCardShareFile` validator, which accepts only
  `cc69-share-*` files inside `cache/share-cards`. The photo-save `ShareCardPngFile` stays
  `cc68-`-only and unchanged; cross-prefix files are rejected both ways. A composition change requires
  a fresh preview.
- Stale preview stays the 6.8 path. A 409 `preview_changed` shows the existing stale-preview feedback,
  moves focus to Refresh, and keeps the old composition visible. Save and Share stay disabled until a
  fresh preview loads. Analytics records `failed`.
- Handoff files are `cache/share-cards/cc69-share-<uuid>.png` under a 30-minute lease. The lease is
  independent of the operation lock and the composer, survives restart, and is enforced by an age sweep
  at startup and before each share. Save's settlement cleanup and the `cc68-*` orphan sweep never touch
  `cc69-share-*`.
- One global native operation covers save and share. The lock releases at settlement, and late or
  duplicate native callbacks are ignored.
- Android settlement is a per-attempt state machine:
  - The PendingIntent is FLAG_MUTABLE, built on `Intent(action).setPackage(context.packageName)`,
    with the attempt id in its action. The receiver is RECEIVER_NOT_EXPORTED. At teardown, cancel the
    PendingIntent and unregister the receiver.
  - The first event wins:
    - the callback, which settles as `target_chosen`;
    - the host resuming after the chooser plus a 750 ms grace with no callback, which settles as
      `not_confirmed`;
    - recreation or destruction mid-attempt, which settles as `not_confirmed`;
    - a start error, which settles as `failed` or `unavailable`.
- On iOS, present on the main thread from the top-most view controller. The popover sourceView is that
  controller's view, and sourceRect is the Share button frame passed from JS. If there is no presenter,
  settle as `failed` with the code `presenter_unavailable`.
- Web: when a handoff authorization exists, the tap calls `navigator.share` synchronously. A handoff
  authorization is valid for at most 60 s and is bound to the identity, the presentation key and the
  digest. After NotAllowedError, keep the authorization and prompt the member to tap again. Close,
  composition change, identity change or expiry clears it. The 60 s revocation window is accepted and
  documented.
- Focus and copy: every outcome except `failed` and `unavailable` returns focus to Share; those two
  move focus to Save (Download on web). One announcement per settlement. Each outcome has its own copy:

  | Outcome                                      | Key                |
  | -------------------------------------------- | ------------------ |
  | `completed`                                  | `shared`           |
  | `target_chosen` and `handed_off`             | `sentToApp`        |
  | `cancelled`, `dismissed` and `not_confirmed` | `shareClosed`      |
  | `failed`                                     | `shareFailed`      |
  | `unavailable`                                | `shareUnavailable` |

  The tap-again prompt is `shareTapAgain`. Android and web copy never claims a post was published.

- The SDK transport envelope stays intact, per platform: `api_key`, `batch`, `sent_at`, `type`,
  `library` and `library_version` on mobile, plus event, uuid, timestamp and, on mobile, the top-level
  `distinct_id` (web keeps `distinct_id` inside properties). Only the event's
  `properties` are allowlisted:
  - the four business keys and `locale`;
  - `$geoip_disable: true`;
  - the SDK identity and transport keys `token`, `distinct_id`, `$lib`, `$lib_version`, `$os` and
    `$device_type`.

  Everything else, including top-level and nested `$set` and `$set_once`, URL, path, host, referrer,
  screen and super properties, is removed by `before_send` on both SDKs. The sanitizer never throws:
  on any internal error it returns null, which drops the event, and logs a closed code. Tests
  validate the actual batched serialized request against these exact shapes, including the
  deliberate-sanitizer-failure case. Other analytics errors are caught and never affect sharing.

- All ten locales on both clients, catalog parity, WCAG 2.2 AA, 44-point targets, Android Back.
- Edge rulings (TEA RG1-RG6):
  - Web NotAllowedError settles the attempt as `failed` with code `activation_expired`. It shows the
    polite `shareTapAgain` copy, not merlot, and focus stays on Share. The next tap is a new attempt.
  - A native result outside the model settles as `failed`/none with code `invalid_result`.
  - Android: no resolvable chooser means `unavailable`; any other start error means `failed`.
  - The lease age is the file modification time.
  - The photo-save cross-prefix test also runs in `pr-share-native-unit.yml`.
  - On iPhone simulators, a test-build anchor report proves the sourceView and sourceRect wiring;
    the local iPad proof covers the real popover.

**Never:**

- Image bytes, digests, captions, source or post IDs, URLs, filenames, native asset IDs, location or
  raw activity ids or package names in analytics or logs.
- A screenshot or re-encode fallback, or edits to generated native projects.
- Changing 6.8 Save gating or responses, production flag values, or android36-native-matrix workload.
- Pulling this work into the CC-6.15 SDK 58 upgrade.

## I/O & Edge-Case Matrix

| Scenario                  | Input / State                                   | Expected Output / Behavior                                                                 | Error Handling                            |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| iOS completed             | Member posts via Instagram                      | `shared` copy, focus Share, event `instagram/completed`                                    | N/A                                       |
| Android chosen            | Member picks Pinterest                          | `sentToApp` copy, event `pinterest/target_chosen`, file leased                             | N/A                                       |
| Web resolved              | `navigator.share` resolves                      | `sentToApp` copy, event `unknown/handed_off`                                               | N/A                                       |
| Closed                    | iOS cancel, web AbortError, Android no callback | Preview and watermark kept, `shareClosed`, matching outcome, target none                   | N/A                                       |
| Failure                   | Native error, write error, 403 or offline       | Merlot `shareFailed`, focus Save, preview kept, `failed`                                   | Closed failure code                       |
| Stale preview             | 409 `preview_changed`                           | 6.8 stale feedback, focus Refresh, Save and Share disabled until a fresh preview, `failed` | Existing 6.8 path                         |
| Web activation expired    | NotAllowedError after reauth                    | `shareTapAgain`; next tap within 60 s shares synchronously                                 | Authorization cleared on expiry or change |
| Capability off or absent  | Flag off, 404 or old server                     | No Share action; forced `purpose:'share'` gets 403 with no audit                           | Treat as off                              |
| Old 6.8 client            | New server                                      | Preview and save responses unchanged                                                       | Contract test                             |
| Identity change mid-share | Sign-out while sheet open                       | Preview cleared, late result ignored, no event                                             | Settlement suppressed                     |
| Analytics down            | SDK throws                                      | Outcome unaffected                                                                         | Swallow                                   |

</frozen-after-approval>

## Code Map

- `apps/mobile/components/share-card-composer.tsx` -- Save: `saveDisabled` 55-61, `save()` 327-381, `stillCurrent` 340-345. Feedback and focus router: `ComposerFeedback` 560-622 and `recoveryTarget` 455, 592. Share goes after Save (479-491) with its own ref. Make the `finishingSave` copy operation-neutral.
- `apps/mobile/src/lib/share-card-save.native.ts` -- lines 70-118 (digest, write, reserve, commit, cleanup); extract a shared prepare-file helper. The orphan sweep at 51-60 must skip `cc69-share-*`.
- `apps/mobile/src/lib/share-card-save-operations.ts` -- `reserveShareCardFile`, `commitShareCardSave` (the lock; deletes at settlement, :107), `enqueueShareCardCleanup`. Share files bypass settlement deletion.
- `apps/mobile/modules/share-card-photo-save/` -- pattern: `requireOptionalNativeModule`, a podspec excluding Tests, `ShareCardPngFile.swift`, and `ios/Package.swift`, which excludes the UIKit bridge.
- `apps/mobile/src/lib/share-card-native-fixture(.native).ts` -- fixture modes gated by `STORY68_NATIVE_TEST_BUILD`; the type unions at :136 and :20.
- `apps/mobile/src/config/posthog.ts`, `src/analytics/mobile-analytics.tsx` (no catch, adds `locale`), `track-events.ts`. Web: `apps/web/src/analytics/browser-analytics.ts` (:47, :77).
- `apps/web/src/lib/share-cards.ts` (`validateWebShareCard` 12-20, `downloadShareCard` 43-58), `apps/web/src/app/components/share-card-dialog.tsx` (`save()` 230-282, recovery 270-277).
- `packages/api-client/src/contracts/http/share-cards.ts` -- purpose union 34-43; the response schemas at 63 and 66 are strict, so do not add fields to them. `src/share-cards-client.ts:13`. `src/types/analytics-events.ts`: names 52-134, schemas map 1020-1072, `durationMs` :319, client-only precedent 2294-2309.
- `apps/api/src/modules/share-cards/share-cards.service.ts` -- the checks at :98 and :117 become non-preview. `share-cards.module.ts:12` must import `FeatureFlagsModule` (`feature-flags.module.ts:19`); CommunityModule does not re-export it.
- `packages/config/src/flags.ts:71-78`, `packages/db/prisma/seeds/feature-flags.ts`.
- Harness:
  - `scripts/ci/native-ios-shards.mjs` owns `AFTER_MATRIX` (:69) and `SHARD_PLAN` (:83). Shard 2 spreads `AFTER_MATRIX`, so put `share-sheet` in shard 1's commands explicitly.
  - `scripts/ci/share-card-android.sh:29-38` hardcodes the interaction commands.
  - Also `scripts/run-story68-native.mjs` (:1227), `scripts/lib/story68-flow-timeouts.mjs`, `maestro/story68/`, and `scripts/e2e-share-card/assert-web-matrix.mjs:18-33`.
  - Native jobs skip pull requests; `pr-accessibility-focus.yml` is the pattern for a path-filtered PR workflow.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/config/src/flags.ts`, `packages/db/prisma/seeds/feature-flags.ts` -- the flag, default false, seed true -- D4.
- [ ] `packages/api-client/src/contracts/http/share-cards.ts`, `share-cards-client.ts` -- add the `share` purpose and the capabilities contract and client (missing means off), then regenerate OpenAPI and the SDK -- D3, D4.
- [ ] `apps/api/src/modules/share-cards/*` -- import `FeatureFlagsModule`. Add the capabilities route. Treat share like save. Return 403 with no audit when the flag is off. Put `purpose` in the audit `event_data` -- server truth.
- [ ] `pact/http/consumer/interactions/share-cards.ts` -- share and capabilities scenarios -- contract.
- [ ] `packages/api-client/src/types/analytics-events.ts` -- `share_card_shared` strict schema with valid outcome-to-target pairs and `duration_ms`, plus `trackShareCardShared` -- result model.
- [ ] `apps/mobile/src/config/posthog.ts`, `apps/web/src/analytics/browser-analytics.ts` -- an event-specific final allowlist hook and `$geoip_disable` -- D5.
- [ ] `apps/mobile/modules/share-card-native-share/` -- the new module.
  - iOS: a presenter, a validated file-URL activity item, the completion mapping, and a Swift package for the mappers and file validation.
  - Android: a module-owned FileProvider scoped to `cache/share-cards/`, the chooser state machine, the package mapper, Robolectric tests, and an androidTest with a receiving test Activity. The test reads the granted URI, compares the SHA256, and checks that sibling and out-of-scope URIs are denied.
  - The module returns only `{target, outcome, code?}` -- D1.
- [ ] `apps/mobile/src/lib/share-card-share(.native).ts`, `share-card-save.native.ts`, `share-card-save-operations.ts`, fixtures -- shared prepare-file helper, lease and sweep, share flow. Fixture modes: `share_completed_instagram` (iOS), `share_chosen_pinterest` (Android), `share_target_other`, `share_closed`, `share_not_confirmed` (Android), `share_failed`, `share_unavailable`.
- [ ] `apps/mobile/components/share-card-composer.tsx` -- Share action gated by capability and module, an anchor measurement, the focus router, one event at settlement -- ACs.
- [ ] `apps/web/src/lib/share-cards.ts`, `share-card-dialog.tsx` -- `canShare` gate, the bounded handoff authorization, the synchronous share on tap -- D2.
- [ ] 20 locale files -- keys `share`, `sharing`, `shared`, `sentToApp`, `shareClosed`, `shareFailed`, `shareUnavailable`, `shareTapAgain` -- parity.
- [ ] Tests: every test ID in the Test Design section below, including the serialized-request privacy tests with a sensitive URL and a registered super property.
- [ ] `.github/workflows/pr-share-native-unit.yml` (new, path-filtered) -- Swift `swift test` and Gradle `testDebugUnitTest` for the module, failing on zero tests -- TEA G2.
- [ ] Native lanes:
  - Add a `share-sheet` runner command in `scripts/run-story68-native.mjs`. It covers the fixture outcomes plus a real-sheet open-and-dismiss smoke per platform.
  - Add `share-sheet` to the dispatchable post-matrix command list in `native-ios-shards.mjs`, and replace shard 2's spread of `AFTER_MATRIX` with its explicit existing commands. Tests assert that `share-sheet` appears exactly once in `commandsForShard(1)` and never in `commandsForShard(2)`.
  - Add `share-sheet` to the interaction branch of `share-card-android.sh`.
  - UIKit presenter assertions (sourceView, sourceRect, presentation) live in a new XCUITest `apps/mobile/native-tests/ShareCardShareSheetUITests.swift`, run in iOS shard 1. SPM covers only the pure anchor-configuration logic. A local iPad proof is required, plus an evidence check file.
  - The Robolectric PendingIntent construction test runs at SDK 34 and 36.
  - Run the androidTest in android36-interaction.
  - Update the timeouts and the partition tests -- TEA G1.
- [ ] Playwright: at most 5 shared cases with share and canShare stubbed per engine, plus the matrix list update -- web ACs.

**Acceptance Criteria:**

- Given the capability on and a valid preview, when the member taps Share, then the receiving side reads a PNG whose SHA256 equals the previewed digest: the iOS activity item, the Android receiving Activity, and the web File.
- Given any outcome other than `completed`, `target_chosen` or `handed_off`, then the preview, source and watermark choice stay, and Save remains available.
- Given every settled, non-superseded attempt, then exactly one analytics capture is attempted; on a healthy analytics path exactly one sanitized `share_card_shared` request is serialized with only allowlisted keys and a valid outcome-to-target pair, and when the sanitizer fails closed zero share events are serialized and the share outcome is unchanged.
- Given an Android handoff, then the file stays readable for its lease after the composer closes or the app restarts, and the global lock is already released.
- Given an iPad, when Share opens, then the sheet presents anchored to the Share button. A local proof is recorded under `_bmad-output/test-artifacts/story-6-9/`.
- Given the PR, then every PR job finishes under 20 minutes. Record browser-acceptance and the new workflow's timings before and after in the PR; if the additions exceed the measured headroom, move them to a separate job.

## Spec Change Log

- 2026-10-30, plan review (Codex: 6 high, 9 medium, 2 low) and TEA gaps G1-G11. Amended:
  - Capabilities moved to their own endpoint, because strict response schemas would reject a new field on deployed 6.8 clients.
  - Added the share file lease, the Android state machine, iPad anchoring, and the bounded web authorization.
  - Added the SDK-boundary allowlist.
  - Made the result model and attempt policy the single policy.
  - Wired the native unit tests into a PR lane, fixed shard placement, made the CI budget measurable, and switched the API tests to vitest.

  KEEP: D1-D6, the reuse of the 6.8 lock and prepare path, and fixture-driven native outcome tests.

- 2026-10-30, plan review round 2 (Codex R2-01 to R2-10). Amended:
  - The capabilities envelope and its member lifecycle.
  - `none` now means no target confirmed, and iOS cancelled may name a target.
  - A separate iOS share-file validator.
  - The 6.8 stale-preview exception.
  - The package-bound PendingIntent.
  - `before_send` on both SDKs, with a fail-closed sanitizer and envelope-aware allowlists.
  - Explicit shard dispatch, and the XCUITest presenter coverage.

  The test design document was reconciled to this spec; where the two disagree, this spec wins.

- 2026-10-30, round 3 (Codex R3-01, R3-02): mobile top-level `distinct_id` kept in the envelope;
  the event AC allows zero serialized events when the sanitizer fails closed.

## Review Triage Log

## Design Notes

Allowlists, exact match, unknown values mapped to other:

- iOS: `pinterest.ShareExtension`, `com.burbn.instagram.shareextension`,
  `com.facebook.Facebook.ShareExtension`, `com.zhiliaoapp.musically.ShareExtension`.
- Android: `com.pinterest`, `com.instagram.android`, `com.facebook.katana`, `com.facebook.lite`,
  `com.zhiliaoapp.musically`, `com.ss.android.ugc.trill`.

Simulators lack these apps, so the mapper tests prove the four platforms, and the receiving-side tests
prove the bytes.

## Verification

**Commands:**

- `npm exec -w apps/mobile -- vitest run`, `npm exec -w apps/web -- vitest run`, `npm exec -w apps/api -- vitest run share-card` plus the share-card integration spec -- pass.
- `npm run test:pact`; `npm run generate:http-openapi && npm run generate:api-client` with no diff -- pass.
- `node scripts/ci/node-test-gate.mjs native-harness` and `startup-deadline` -- pass.
- `swift test` in the module's ios folder, and the module's Gradle `testDebugUnitTest` -- pass with more than zero tests.
- `npx playwright test -c playwright/share-card.config.ts` with an isolated DATABASE_URL and `PLAYWRIGHT_SKIP_DB_RESET=true` -- pass.
- `node scripts/run-story68-native.mjs share-sheet` on an iOS simulator and an API 36 emulator -- pass.
- tsc in every touched workspace, and lint -- clean.

## Implementation Notes

## Test Design (TEA)

Full plan, reconciled to this spec after round 2 (this spec wins on any disagreement):
`_bmad-output/test-artifacts/test-design/cc69-native-platform-sharing-test-design.md`. 17 risks
(8 high); 76 tests: P0 38, P1 32, P2 3, P3 3. Residual defaults RG1-RG6 are listed there. Lanes:
pr-tests, pr-contract, pr-browser (browser-acceptance), pr-share-native-unit, ios-build,
ios-shard-1, android36-interaction, local (iPad), release-qa.

| IDs                                                                              | Level        | Pri | File (create or extend)                                                                                                         | Lane                               |
| -------------------------------------------------------------------------------- | ------------ | --- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| U-SHARE-SVC-AUTH, -FLAG, -STALE                                                  | Unit         | P0  | `apps/api/src/modules/share-cards/share-cards.service.spec.ts`                                                                  | pr-tests                           |
| U-SHARE-SVC-SAVE-REGRESSION                                                      | Unit         | P1  | same                                                                                                                            | pr-tests                           |
| U-SHARE-CTRL, U-SHARE-CAP-API (auth, envelope, private no-store)                 | Unit         | P1  | `share-cards.controller.spec.ts`                                                                                                | pr-tests                           |
| U-SHARE-CONTRACT, U-SHARE-CAP-CLIENT (5 s timeout, 404, malformed, missing: off) | Unit         | P1  | `packages/api-client/testing/share-cards-{contract,client}.spec.ts`                                                             | pr-tests                           |
| I-SHARE-AUDIT, I-SHARE-FLAG                                                      | Integration  | P0  | `apps/api/integration/share-card-export.integration.spec.ts`                                                                    | pr-tests                           |
| C-SHARE-PACT (share, capabilities, old/new client and server)                    | Contract     | P1  | `pact/http/consumer/interactions/share-cards.ts`                                                                                | pr-contract                        |
| U-SHARE-EVT-SCHEMA, -PAIRS, -FORBIDDEN                                           | Unit         | P0  | `packages/api-client/testing/share-card-analytics.spec.ts` (new)                                                                | pr-tests                           |
| U-SHARE-SANITIZER-WEB, -MOBILE (`before_send`, null on error)                    | Unit         | P0  | `apps/web/src/analytics/browser-analytics.test.ts`, `apps/mobile/src/config/posthog.test.ts` (new)                              | pr-tests                           |
| I-SHARE-WIRE-WEB, -MOBILE (serialized batch, deliberate sanitizer failure)       | Integration  | P0  | `browser-analytics.wire.test.ts`, `posthog.wire.test.ts` (new)                                                                  | pr-tests                           |
| N-IOS-MAPPER, -OUTCOME, -SHARE-FILE (`cc69-share-*` only)                        | Native       | P0  | `modules/share-card-native-share/ios/Tests/*.swift` (new)                                                                       | pr-share-native-unit               |
| N-IOS-ANCHOR                                                                     | Native       | P1  | `ios/Tests/ShareCardAnchorConfigurationTests.swift` (new)                                                                       | pr-share-native-unit               |
| N-IOS-PNGFILE-PREFIX (rejects `cc69-share-*`)                                    | Native       | P1  | `modules/share-card-photo-save/ios/Tests/ShareCardPhotoSaveTests.swift`                                                         | ios-build, pr-share-native-unit    |
| N-IOS-PRESENTER-UI                                                               | Native       | P1  | `apps/mobile/native-tests/ShareCardShareSheetUITests.swift` (new)                                                               | ios-shard-1                        |
| N-AND-MAPPER, -OUTCOME, -PENDINGINTENT (SDK 34, 36), -PROVIDER                   | Native       | P0  | `android/src/test/java/.../*Test.kt` (new, Robolectric)                                                                         | pr-share-native-unit               |
| N-AND-RECEIVE (receiving Activity, sibling and out-of-scope denied)              | Native       | P0  | `android/src/androidTest/java/.../ShareCardShareReceiveTest.kt` (new)                                                           | android36-interaction              |
| U-SHARE-LIB-BYTES, U-SHARE-LEASE, U-SHARE-OPS                                    | Integration  | P0  | `share-card-share.native.spec.ts` (new), `share-card-save-operations.spec.ts`, `share-card-save.native.spec.ts`                 | pr-tests                           |
| U-SHARE-LIB-RESULT                                                               | Unit         | P0  | `apps/mobile/src/lib/share-card-share.native.spec.ts`                                                                           | pr-tests                           |
| U-SHARE-LIB-UNAVAILABLE, U-SHARE-FIXTURE, U-SHARE-LOG-PRIVACY                    | Unit         | P1  | same; `share-card-native-fixture.spec.ts`; `scripts/lib/story68-native-safety.test.mjs`                                         | pr-tests                           |
| C-COMP-SHARE-GATE, -CHOSEN, -FAIL, -IDENTITY, -ANALYTICS-DOWN, -ONE-EVENT        | Component    | P0  | `apps/mobile/components/share-card-composer.test.tsx`                                                                           | pr-tests                           |
| C-COMP-SHARE-COMPLETED, -CLOSED, -UNAVAILABLE, -STALE, -ANCHOR                   | Component    | P1  | same                                                                                                                            | pr-tests                           |
| C-COMP-SHARE-A11Y                                                                | Component    | P2  | same                                                                                                                            | pr-tests                           |
| U-WEB-SHARE-LIB                                                                  | Unit         | P0  | `apps/web/src/lib/share-cards.test.ts`                                                                                          | pr-tests                           |
| C-WEB-SHARE-DIALOG                                                               | Component    | P0  | `apps/web/src/app/components/share-card-dialog.test.tsx`                                                                        | pr-tests                           |
| U-SHARE-LOCALES (8 keys)                                                         | Unit         | P1  | `apps/{web,mobile}/src/i18n/share-card-locales.spec.ts`                                                                         | pr-tests                           |
| U-HARNESS-IOS-SHARDS (once in `commandsForShard(1)`, never in 2)                 | Unit         | P1  | `scripts/ci/native-ios-shards.test.mjs`                                                                                         | pr-browser                         |
| U-HARNESS-ANDROID-LANES, -WEB-MATRIX, -PR-WORKFLOW, U-PLUGIN-MANIFEST            | Unit         | P1  | `share-card-android.test.mjs`, `assert-web-matrix.test.mjs`, `share-card-lanes.test.mjs`, `with-share-card-permissions.test.js` | pr-browser                         |
| U-HARNESS-IPAD-EVIDENCE                                                          | Unit         | P1  | `scripts/lib/story69-ipad-evidence.test.mjs` (new)                                                                              | pr-browser                         |
| U-HARNESS-TIMEOUTS                                                               | Unit         | P2  | `scripts/lib/story68-flow-timeouts.test.mjs`                                                                                    | pr-browser                         |
| P-SHARE-BYTES, P-SHARE-TAP-AGAIN                                                 | E2E          | P0  | `playwright/tests/share-card-export.spec.ts` (5 shared cases)                                                                   | pr-browser                         |
| P-SHARE-DISMISS, -CAPABILITY-OFF, -REVALIDATE                                    | E2E          | P1  | same                                                                                                                            | pr-browser                         |
| M-SHARE-FAILED, M-SHARE-SHEET-IOS                                                | E2E          | P0  | `maestro/story68/share-failed.yaml`, `share-sheet.yaml`                                                                         | ios-shard-1                        |
| M-SHARE-CHOSEN (lease after relaunch), M-SHARE-SHEET-ANDROID, M-SHARE-FAILED     | E2E          | P0  | `share-chosen.yaml`, `share-sheet.yaml`, `share-failed.yaml`                                                                    | android36-interaction              |
| M-SHARE-COMPLETED (iOS), -CLOSED, -NOT-CONFIRMED (Android), -UNAVAILABLE         | E2E          | P1  | `maestro/story68/share-*.yaml`                                                                                                  | ios-shard-1, android36-interaction |
| M-SHARE-OTHER                                                                    | E2E          | P2  | `maestro/story68/share-other.yaml`                                                                                              | ios-shard-1, android36-interaction |
| X-IPAD-ANCHOR                                                                    | E2E (manual) | P1  | `_bmad-output/test-artifacts/story-6-9/`                                                                                        | local                              |
| X-SHARE-DEVICE-PIN, -IG, -FB-TT                                                  | E2E (manual) | P3  | same                                                                                                                            | release-qa                         |

Privacy negatives: U-SHARE-EVT-FORBIDDEN, U-SHARE-SANITIZER-_, I-SHARE-WIRE-_, U-SHARE-LIB-RESULT,
N-\*-MAPPER, U-SHARE-LOG-PRIVACY, I-SHARE-AUDIT. Truthfulness: N-AND-OUTCOME, U-SHARE-EVT-PAIRS,
U-SHARE-LIB-RESULT, C-COMP-SHARE-CHOSEN, M-SHARE-CHOSEN, U-SHARE-LOCALES, U-SHARE-FIXTURE.
