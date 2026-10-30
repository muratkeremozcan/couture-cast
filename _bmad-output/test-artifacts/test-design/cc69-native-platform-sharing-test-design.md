---
runScope: 'epic'
runKey: 'epic-6-story-6.9'
workflowStatus: 'complete'
totalSteps: 5
stepsCompleted:
  [
    'step-01-detect-mode',
    'step-02-load-context',
    'step-03-risk-and-testability',
    'step-04-coverage-plan',
    'step-05-generate-output',
  ]
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-10-30'
---

# Test Design: Epic 6, Story CC-6.9 Native platform sharing

**Date:** 2026-10-30
**Author:** Murat (TEA), non-interactive run pre-approved by the owner
**Status:** Reconciled to the spec after plan review round 2 (Codex R2-01 to R2-10)

**Precedence:** the spec at
`_bmad-output/implementation-artifacts/spec-6-9-native-platform-sharing.md` wins wherever this
document and the spec disagree. Its result model table is the single policy for UI, analytics and
tests.

Inputs read in full:

- Spec frozen block (intent, D1 to D6, result model, attempt policy), Boundaries, I/O matrix, Code
  Map, Tasks and Acceptance, Spec Change Log
- `cc69-plan-review-codex.md` Round 2 (R1-01 to R1-17 status, R2-01 to R2-10)
- `epic-6-context.md`, `spec-6-8-safe-branded-share-card-export.md`
- Code on `feat/cc69-native-platform-sharing`: share-card service and contract, analytics schemas
  and facades, `share-card-save*.ts`, `scripts/ci/native-ios-shards.mjs` (`AFTER_MATRIX`,
  `SHARD_PLAN`, `commandsForShard`), `scripts/ci/share-card-android.sh`,
  `scripts/e2e-share-card/assert-web-matrix.mjs`, `playwright/share-card.config.ts`,
  `.github/workflows/pr-share-card-native.yml`, `.github/workflows/pr-accessibility-focus.yml`,
  `apps/mobile/app.json`, `apps/mobile/native-tests/`.

Workflow decisions taken without a halt (recommended defaults):

- Mode: Create, then reconciled in place. Level: epic-level, scoped to one story. No checkpoint
  file; this document carries the completed progress frontmatter.
- Test level vocabulary: the caller asked for unit, integration, contract, component, E2E and
  native. The catalog uses those six. The risk coverage plan uses the template's canonical levels
  (Unit, Component, Integration, API, E2E); Contract maps to API, Swift and Kotlin unit tests to
  Unit, and XCUITest or androidTest to Integration.
- No tests were executed. This is design only.

Superseded by the round 2 reconciliation (R2-01): the preview `nativeShareEnabled` field, `cc68-`
share filenames, deletion at composer close or identity change, the earlier web and Android outcome
mappings, events from disabled presses, and the `pr-native-unit` lane name.

---

## Executive Summary

**Scope:** Share action beside Save on mobile (local Expo module on iOS and Android) and web (Web
Share API). It reuses 6.8 authorization with `purpose:'share'`, discovers availability through
`GET /api/v1/share-cards/capabilities`, leases handoff files for 30 minutes, settles through the
spec's result model, and sends one sanitized `share_card_shared` request per attempt.

**Risk summary:**

- Total risks: 17
- High (score >= 6): 8
- Critical categories: SEC (raw-id leakage, SDK enrichment, FileProvider scope), DATA (unseen
  bytes, file lease), BUS (overclaimed outcomes), TECH (analytics throw, Android settlement, web
  user activation)

**Coverage summary:** 76 tests.

| Level       | P0  | P1  | P2  | P3  | Total |
| ----------- | --- | --- | --- | --- | ----- |
| Unit        | 10  | 15  | 1   | 0   | 26    |
| Integration | 7   | 0   | 0   | 0   | 7     |
| Contract    | 0   | 1   | 0   | 0   | 1     |
| Component   | 7   | 5   | 1   | 0   | 13    |
| Native      | 8   | 3   | 0   | 0   | 11    |
| E2E         | 6   | 8   | 1   | 3   | 18    |
| **Total**   | 38  | 32  | 3   | 3   | 76    |

E2E covers 5 Playwright cases (each run in chromium, firefox and webkit), 9 Maestro flows, the
local iPad proof X-IPAD-ANCHOR (P1) and three physical-device rows (P3). Native includes the
XCUITest `ShareCardShareSheetUITests` and the Android receiving androidTest.

**Effort:** roughly 86 to 152 hours (11 to 19 days) including harness wiring.

---

## Not in Scope

| Item                                                           | Reasoning                                     | Mitigation                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Real handoff into Pinterest, Instagram, Facebook, TikTok in CI | Simulators and emulators lack these apps      | Swift and Kotlin mapper tests, fixture modes, receiving-side byte tests; X-SHARE-DEVICE rows |
| Real browser share sheets (Safari, Chrome Android)             | Headless Linux engines expose no Web Share UI | Stubbed `canShare`/`share` per engine; NotAllowedError and AbortError paths tested           |
| Proof that a post was published                                | No platform confirms publication              | Result model and copy negatives                                                              |
| CC-6.15 SDK 58 upgrade                                         | Spec Never list                               | 6.8 regression suites stay green                                                             |
| Production flag value changes                                  | Spec Never list                               | Default-false regression test; seed-only `true`                                              |
| android36-native-matrix workload                               | Spec Never list; lane at its limit            | Share runs in android36-interaction; harness pins the matrix command list                    |

---

## Risk Assessment

Register derived from gap statements in the spec, the Round 2 review, the epic context and loaded
code. Each description opens with the source words.

### High-Priority Risks (Score >=6)

| Risk ID | Category | Description                                                                                                                                                                                                                                                                                            | Probability | Impact | Score | Mitigation                                                                                                                                                                                               | Owner             | Timeline         |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------- |
| R-001   | DATA     | "Share only the bytes the member previewed" (spec Always). A share path that skips the response or decoded-bytes SHA256 check, or a web handoff authorization reused past its 60 s bound or after a composition change, hands unseen bytes to another app.                                             | 2           | 3      | 6     | Double digest check before any write; native `ShareCardShareFile` digest check on iOS; web authorization bound to identity, presentation key and digest; U-SHARE-LIB-BYTES, N-AND-RECEIVE, P-SHARE-BYTES | Dev (mobile, web) | Before PR review |
| R-002   | SEC      | "raw activity ids or package names in analytics or logs" (spec Never). A mapper that passes through or logs `activityType` or a package, or a bridge that forwards keys beyond `{target, outcome, code?}`, leaks app-usage data.                                                                       | 2           | 3      | 6     | Exact-allowlist mappers; strict bridge validator; strict analytics schema; log scan                                                                                                                      | Dev (native)      | Before PR review |
| R-003   | TECH     | "`mobile-analytics.tsx` (no catch, adds `locale`)" (Code Map) against "Other analytics errors are caught and never affect sharing". A capture throw at settlement skips feedback or focus, or surfaces as a share failure.                                                                             | 2           | 3      | 6     | Capture after settlement and lock release inside try/catch; async rejections swallowed                                                                                                                   | Dev (mobile, web) | Before PR review |
| R-004   | BUS      | "Android and web copy never claims a post was published" and the result model's valid pairs. An Android or web path that emits `completed`, or an Android no-callback path that reports `target_chosen`, tells the member a post exists and corrupts the outcome metric.                               | 2           | 3      | 6     | Per-platform outcome types; schema pairs and client binding; copy per outcome; platform-only fixture modes                                                                                               | Dev (native), TEA | Before PR review |
| R-005   | TECH     | "The PendingIntent is FLAG_MUTABLE, built on `Intent(action).setPackage(context.packageName)`" and "The first event wins" (spec Always; R2-10). A missing package binding throws on SDK 34+, and a broken first-event rule leaves the global operation held or misreports a late callback.             | 2           | 3      | 6     | Robolectric PendingIntent construction at SDK 34 and 36; state machine tests; teardown cancels and unregisters                                                                                           | Dev (native)      | Before PR review |
| R-006   | SEC      | "module-owned FileProvider scoped to `cache/share-cards/`" (spec Tasks). A broader path, an exported provider or sibling grants expose other cached files to a receiving app.                                                                                                                          | 2           | 3      | 6     | Paths limited to `share-cards/`; `exported=false`; per-intent read grant; androidTest denies sibling and out-of-scope URIs                                                                               | Dev (native)      | Before PR review |
| R-007   | TECH     | "when a handoff authorization exists, the tap calls `navigator.share` synchronously ... valid for at most 60 s" (spec Always). An await before `share()` loses transient activation; an unbounded authorization outlives revocation.                                                                   | 3           | 2      | 6     | Synchronous share on the authorized tap; 60 s expiry; close, change and identity clear it                                                                                                                | Dev (web)         | Before PR review |
| R-015   | SEC      | "removed by `before_send` on both SDKs. The sanitizer never throws: on any internal error it returns null" (spec Always; R2-02, R2-04). PostHog adds URL, path, `$set` and super properties after the helper validates the four keys, and its hook runner keeps the original event when a hook throws. | 2           | 3      | 6     | Event-specific `before_send` on posthog-js and posthog-react-native; nonthrowing sanitizer returning null; serialized batched request tests with a deliberate sanitizer failure                          | Dev (mobile, web) | Before PR review |

### Medium-Priority Risks (Score 3-4)

| Risk ID | Category | Description                                                                                                                                                                                                                                                                                                         | Probability | Impact | Score | Mitigation                                                                                                                | Owner              |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| R-008   | BUS      | "Simulators lack these apps, so the mapper tests prove the four platforms" (Design Notes). The allowlisted ids are never observed in CI; a renamed id records real shares as `other`.                                                                                                                               | 2           | 2      | 4     | Mapper tests pin the documented ids; X-SHARE-DEVICE rows before any flag flip beyond dev                                  | TEA, owner         |
| R-009   | TECH     | "A statically disabled Share (module absent) shows a localized reason and emits nothing" and no "screenshot or re-encode fallback". An unguarded native call crashes, a fallback ships, or a disabled press emits an event.                                                                                         | 2           | 2      | 4     | `requireOptionalNativeModule` guard before authorization or file write; no handler on the disabled control                | Dev (mobile)       |
| R-010   | SEC      | "Clients treat any error, 404, malformed body or missing field as off. With the flag off, `purpose:'share'` gets 403 and no audit row" (D4). A parse that reads true, a stale capability from a previous member, or client-only gating exposes share before the beta gate.                                          | 1           | 3      | 3     | Server 403 before render; fail-off client parse; member-bound capability state                                            | Dev (API, clients) |
| R-011   | DATA     | "Handoff files are `cache/share-cards/cc69-share-<uuid>.png` under a 30-minute lease ... Save's settlement cleanup and the `cc68-*` orphan sweep never touch `cc69-share-*`" (spec Always). Early deletion breaks a receiver's delayed read; a missing age sweep leaves the member's card readable past 30 minutes. | 2           | 2      | 4     | Lease independent of lock and composer; age sweep at startup and before each share; prefix-scoped sweeps                  | Dev (mobile)       |
| R-012   | TECH     | "present on the main thread from the top-most view controller. The popover sourceView is that controller's view, and sourceRect is the Share button frame" with `"supportsTablet": true` in `app.json`. A missing anchor crashes on iPad.                                                                           | 2           | 2      | 4     | SPM anchor-configuration tests; XCUITest `ShareCardShareSheetUITests` in shard 1; local iPad proof with an evidence check | Dev (native)       |
| R-013   | OPS      | "Playwright: at most 5 shared cases" and "every PR job finishes under 20 minutes" (Tasks, AC6). Extra or per-locale cases push browser-acceptance past the cap.                                                                                                                                                     | 2           | 2      | 4     | 5 cases; matrix assertion caps share titles; before/after timings in the PR                                               | TEA                |
| R-016   | TECH     | "Preview and save responses stay byte-for-byte unchanged, so deployed 6.8 clients keep working" (D3). The strict 6.8 response schemas reject any added field.                                                                                                                                                       | 1           | 3      | 3     | Contract test pins preview and save shapes; capabilities on its own route                                                 | Dev (API)          |
| R-017   | DATA     | "The photo-save `ShareCardPngFile` stays `cc68-`-only and unchanged; cross-prefix files are rejected both ways" (spec Always; R2-03). Reusing the save validator rejects every share file, or loosening it lets share files reach Photos.                                                                           | 2           | 2      | 4     | Separate `ShareCardShareFile`; cross-prefix tests in both packages                                                        | Dev (native)       |

### Low-Priority Risks (Score 1-2)

| Risk ID | Category | Description                                                                                                                                 | Probability | Impact | Score | Action                                          |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ----- | ----------------------------------------------- |
| R-014   | OPS      | "Changing ... android36-native-matrix workload" is forbidden (spec Never). Any share step in the matrix suite overruns its journey timeout. | 1           | 2      | 2     | Harness test pins the matrix suite command list |

### Risk Category Legend

- **TECH**: Technical/Architecture (flaws, integration, scalability)
- **SEC**: Security (access controls, auth, data exposure)
- **PERF**: Performance (SLA violations, degradation, resource limits)
- **DATA**: Data Integrity (loss, corruption, inconsistency)
- **BUS**: Business Impact (UX harm, logic errors, revenue)
- **OPS**: Operations (deployment, config, monitoring)

---

## NFR Planning

| NFR Category             | Requirement / Threshold                                                                                                                                                                    | Risk Link           | Planned Validation                                                                                                                             | Evidence Needed                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Security / privacy       | Only the allowlisted properties per platform, `$geoip_disable: true`, intact transport envelope; no bytes, digests, captions, ids, URLs, filenames, location, raw activity ids or packages | R-002, R-015        | U-SHARE-EVT-FORBIDDEN, U-SHARE-SANITIZER-WEB/-MOBILE, I-SHARE-WIRE-WEB/-MOBILE, N-IOS-MAPPER, N-AND-MAPPER, U-SHARE-LOG-PRIVACY, I-SHARE-AUDIT | Serialized request fixtures; audit row key set |
| Security / access        | Flag default false; capability fail-off; 403 with no audit when off                                                                                                                        | R-010               | U-SHARE-SVC-FLAG, I-SHARE-FLAG, U-SHARE-CAP-CLIENT, C-SHARE-PACT                                                                               | Integration and Pact reports                   |
| Security / file exposure | Provider limited to `cache/share-cards/`; 30-minute lease                                                                                                                                  | R-006, R-011        | N-AND-PROVIDER, N-AND-RECEIVE, U-SHARE-LEASE                                                                                                   | Robolectric, androidTest, vitest reports       |
| Reliability              | 99.5% availability target covers sharing (epic); analytics outage never affects sharing; lock released at settlement                                                                       | R-003, R-005        | C-COMP-SHARE-ANALYTICS-DOWN, N-AND-OUTCOME, U-SHARE-OPS                                                                                        | Unit reports; post-release `failed` rate       |
| Performance (CI)         | Every PR job under 20 minutes; before/after timings for browser-acceptance and `pr-share-native-unit` (AC6)                                                                                | R-013, R-014        | U-HARNESS-WEB-MATRIX, U-HARNESS-ANDROID-LANES, U-HARNESS-PR-WORKFLOW                                                                           | GitHub Actions timings in the PR               |
| Performance (runtime)    | Capabilities request times out at 5 s; web authorization valid 60 s; Android grace 750 ms                                                                                                  | R-005, R-007, R-010 | U-SHARE-CAP-CLIENT, C-WEB-SHARE-DIALOG, N-AND-OUTCOME                                                                                          | Fake-timer unit reports                        |
| Accessibility            | WCAG 2.2 AA, focus router per outcome, one announcement, 44-point targets, Android Back                                                                                                    | -                   | C-COMP-SHARE-\*, C-WEB-SHARE-DIALOG, P-SHARE-TAP-AGAIN (axe)                                                                                   | Component reports; axe JSON                    |
| Compatibility            | Preview and save responses unchanged for deployed 6.8 clients                                                                                                                              | R-016               | C-SHARE-PACT, U-SHARE-SVC-SAVE-REGRESSION                                                                                                      | Pact verification                              |
| Maintainability          | OpenAPI and SDK regenerate with no diff; tsc per touched workspace; lint clean; native unit lanes fail on zero tests                                                                       | -                   | Quality gates below                                                                                                                            | CI logs                                        |

**Unknown thresholds:** no share-specific latency target exists, and no measurement method for the
99.5% availability target is defined for client-side share. Both stay clarifications for
`bmad-tea-nfr`.

---

## Entry Criteria

- [ ] Residual gaps RG1 to RG6 below answered or accepted in the spec Review Triage Log
- [ ] `pr-share-native-unit.yml` exists before the native module lands
- [ ] Isolated Playwright database for local runs (`DATABASE_URL` isolated,
      `PLAYWRIGHT_SKIP_DB_RESET=true`; never 127.0.0.1:54322)

## Exit Criteria

- [ ] All P0 tests pass; P1 at least 95% with waivers recorded
- [ ] Every privacy and truthfulness negative passes (no waivers)
- [ ] Before/after timings for browser-acceptance and `pr-share-native-unit` recorded in the PR,
      each under 20 minutes
- [ ] First main or dispatch run of ios-shard 1 and android36-interaction green with `share-sheet`
- [ ] X-IPAD-ANCHOR evidence recorded under `_bmad-output/test-artifacts/story-6-9/` and its check
      passing
- [ ] X-SHARE-DEVICE evidence recorded before the flag is enabled beyond the dev seed
- [ ] 6.8 suites (vitest, Playwright P-_, Maestro M-_) unchanged and green

---

## Test Catalog

Prefixes follow 6.8: U unit, I integration, C component, P Playwright, M Maestro, N native
(Swift, Kotlin, XCUITest, androidTest), X manual evidence. I/O rows are numbered in spec order:
IO1 iOS completed, IO2 Android chosen, IO3 web resolved, IO4 closed, IO5 failure, IO6 stale
preview, IO7 web activation expired, IO8 capability off or absent, IO9 old 6.8 client, IO10
identity change, IO11 analytics down. ACs in spec order: AC1 receiving bytes, AC2 non-success keeps
composition, AC3 one serialized request, AC4 Android lease, AC5 iPad anchor, AC6 PR timing.

Lanes:

- **pr-tests**: `pr-checks.yml` job `tests` (workspace vitest with coverage, API integration
  against PostgreSQL and Redis)
- **pr-contract**: `contract-testing.yml` (`npm run test:pact`)
- **pr-browser**: `pr-share-card-native.yml` job `browser-acceptance` (native-harness and plugin
  node suites, Playwright share-card config)
- **pr-share-native-unit**: new path-filtered `.github/workflows/pr-share-native-unit.yml`:
  `swift test` for the share module package, Gradle `testDebugUnitTest` (Robolectric), failing on
  zero tests; also runs on main and nightly
- **ios-build**: existing `swift test` for the photo-save package
- **ios-shard-1**: ios-shard matrix shard 1 (Maestro `share-sheet` command and XCUITest), main,
  nightly and dispatch
- **android36-interaction**: interaction suite with `share-sheet` and the androidTest, main,
  nightly and dispatch
- **local**: owner-run iPad proof with a committed evidence file
- **release-qa**: manual physical-device session

### API, contract, capabilities

| ID                          | Scenario                                                                                                                                                                                                                         | Level       | Priority | AC / I/O | Risk  | File                                                                                          | Lane        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- | -------- | ----- | --------------------------------------------------------------------------------------------- | ----------- |
| U-SHARE-CONTRACT            | `purpose:'share'` requires 64-hex `expectedSha256`, rejects extra fields, URLs and paths; capabilities schema is the strict envelope `{data:{nativeShare:boolean}}`; preview and save response schemas unchanged                 | Unit        | P1       | IO8, IO9 | -     | `packages/api-client/testing/share-cards-contract.spec.ts`                                    | pr-tests    |
| U-SHARE-CAP-CLIENT          | Capabilities client: ok true gives on; 404, 5xx, network error, 5 s timeout (fake timers, request aborted), malformed JSON, missing `data`, missing or non-boolean `nativeShare` all give off                                    | Unit        | P1       | IO8      | -     | `packages/api-client/testing/share-cards-client.spec.ts`                                      | pr-tests    |
| U-SHARE-CAP-API             | Capabilities route: authenticated only (401 otherwise); returns the caller's flag value in the shared envelope; `Cache-Control: private, no-store`; nothing beyond the boolean                                                   | Unit        | P1       | IO8      | -     | `apps/api/src/modules/share-cards/share-cards.controller.spec.ts`                             | pr-tests    |
| U-SHARE-SVC-AUTH            | Share with flag on and matching digest returns bytes and writes audit `event_data` exactly `{sourceKind, locale, watermark, templateVersion, purpose:'share'}`                                                                   | Unit        | P0       | AC1      | -     | `apps/api/src/modules/share-cards/share-cards.service.spec.ts`                                | pr-tests    |
| U-SHARE-SVC-FLAG            | Flag off: 403 before source resolve or render (renderer spy not called) and no audit row; flag provider throws: treated as off                                                                                                   | Unit        | P0       | IO8      | -     | same                                                                                          | pr-tests    |
| U-SHARE-SVC-STALE           | Share with a changed digest or source: 409 `preview_changed`, no audit row, no bytes                                                                                                                                             | Unit        | P0       | IO6      | -     | same                                                                                          | pr-tests    |
| U-SHARE-SVC-SAVE-REGRESSION | Preview and save responses byte-identical to 6.8 fixtures with the flag on and off; Save gating unchanged                                                                                                                        | Unit        | P1       | IO9      | -     | same                                                                                          | pr-tests    |
| U-SHARE-CTRL                | Controller routes `share`; 403 and 400 envelopes match shared error shapes; `FeatureFlagsModule` resolves in `ShareCardsModule`                                                                                                  | Unit        | P1       | IO8      | -     | `share-cards.controller.spec.ts`                                                              | pr-tests    |
| I-SHARE-AUDIT               | Real DB: one `share_card_export_authorized` row per accepted share with `purpose:'share'`, save rows carry `purpose:'save'`; key set exact; no digest, source id, path or URL; audit failure blocks the share; 403 writes no row | Integration | P0       | AC1, IO8 | -     | `apps/api/integration/share-card-export.integration.spec.ts`                                  | pr-tests    |
| I-SHARE-FLAG                | Postgres fallback false with PostHog unavailable: share 403 and capabilities `nativeShare:false`; dev seed true: share 200 and `nativeShare:true`; `flags.ts` default false                                                      | Integration | P0       | IO8      | R-010 | same                                                                                          | pr-tests    |
| C-SHARE-PACT                | Consumer interactions: share 200, 403 and 409; capabilities on and off; capabilities 404 provider state (new client, old server); existing 6.8 preview and save interactions verify unchanged (old client, new server)           | Contract    | P1       | IO8, IO9 | R-016 | `pact/http/consumer/interactions/share-cards.ts`, `pact/http/provider/doubles/share-cards.ts` | pr-contract |

### Analytics schema, sanitizer and wire

| ID                       | Scenario                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Level       | Priority | AC / I/O        | Risk  | File                                                             | Lane     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | -------- | --------------- | ----- | ---------------------------------------------------------------- | -------- |
| U-SHARE-EVT-SCHEMA       | Every valid row of the result model parses: completed with the four apps, other or unknown; target_chosen with the four apps or other; handed_off with unknown; cancelled with the four apps, other or none; dismissed, not_confirmed, failed and unavailable with none. `trackShareCardShared` returns exactly the four keys                                                                                                                                                                                                        | Unit        | P0       | AC3             | -     | `packages/api-client/testing/share-card-analytics.spec.ts` (new) | pr-tests |
| U-SHARE-EVT-PAIRS        | Every invalid outcome-to-target pair in the 8 x 7 cross product is rejected (for example completed/none, target_chosen/unknown, target_chosen/none, handed_off/other, cancelled/unknown, dismissed/instagram, not_confirmed/other, failed/unknown). Client binding from the "When" column: completed only ios, target_chosen and not_confirmed only android, handed_off and dismissed only web                                                                                                                                       | Unit        | P0       | AC3, IO1 to IO5 | -     | same                                                             | pr-tests |
| U-SHARE-EVT-FORBIDDEN    | Extra keys rejected one by one: `pngBase64`, `bytes`, `sha256`, `digest`, `expectedSha256`, `caption`, `postId`, `recommendationId`, `sourceId`, `source`, `url`, `uri`, `fileUri`, `filename`, `assetId`, `localIdentifier`, `location`, `latitude`, `longitude`, `city`, `activityType`, `packageName`, `component`, `errorMessage`; raw target values `com.instagram.android`, `com.burbn.instagram.shareextension`, `com.apple.UIKit.activity.Message` rejected; `duration_ms` negative, fractional or above 86,400,000 rejected | Unit        | P0       | AC3             | -     | same                                                             | pr-tests |
| U-SHARE-SANITIZER-WEB    | posthog-js `before_send` for `share_card_shared`: keeps the four business keys, `locale`, `token`, `distinct_id`, `$lib`, `$lib_version`, `$os`, `$device_type`; sets `$geoip_disable: true`; removes `$current_url`, `$pathname`, `$host`, `$referrer`, screen keys, super properties and top-level and nested `$set`/`$set_once`; other events pass through unchanged; an internal error (throwing getter, cyclic value) returns null and logs a closed code; never throws                                                         | Unit        | P0       | AC3             | -     | `apps/web/src/analytics/browser-analytics.test.ts` (new)         | pr-tests |
| U-SHARE-SANITIZER-MOBILE | posthog-react-native `before_send` (the option the installed SDK reads): same property allowlist and removals on the mobile event; internal error returns null with a closed code; never throws                                                                                                                                                                                                                                                                                                                                      | Unit        | P0       | AC3             | -     | `apps/mobile/src/config/posthog.test.ts` (new)                   | pr-tests |
| I-SHARE-WIRE-WEB         | Real posthog-js with transport intercepted, page URL carrying a post id and query, a registered super property and an identify `$set`: the batched serialized request holds one share event whose `properties` key set equals the web allowlist, with event, uuid and timestamp intact; a deliberately failing sanitizer drops the share event from the batch, logs a closed code, and leaves the share outcome unchanged                                                                                                            | Integration | P0       | AC3, IO11       | R-015 | `apps/web/src/analytics/browser-analytics.wire.test.ts` (new)    | pr-tests |
| I-SHARE-WIRE-MOBILE      | Real posthog-react-native with fetch mocked and a forced flush: request body is exactly `{api_key, batch, sent_at}` with each batch item `{event, distinct_id, properties, type, library, library_version, uuid, timestamp}`; `properties` key set equals the mobile allowlist with sensitive enrichment present before sanitizing; deliberate sanitizer failure drops the event                                                                                                                                                     | Integration | P0       | AC3, IO11       | -     | `apps/mobile/src/config/posthog.wire.test.ts` (new)              | pr-tests |

### Native iOS (`apps/mobile/modules/share-card-native-share/ios/`)

| ID                   | Scenario                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Level  | Priority | AC / I/O      | Risk  | File                                                                                | Lane                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ------------- | ----- | ----------------------------------------------------------------------------------- | ------------------------------------- |
| N-IOS-MAPPER         | Four allowlisted extension ids map to their targets; Apple built-ins (Message, Mail, AirDrop, SaveToCameraRoll, CopyToPasteboard) and near misses (suffix, prefix, case, whitespace, `com.burbn.instagram.shareextension.fake`, `pinterest.ShareExtension2`) map to `other`; output always in the closed set                                                                                                                                                                                                   | Native | P0       | IO1, IO4      | R-002 | `Tests/ShareCardActivityTargetTests.swift` (SPM)                                    | pr-share-native-unit                  |
| N-IOS-OUTCOME        | Reducer per result model: (completed, known id) gives completed plus app; (completed, other id) gives completed/other; (completed, nil) gives completed/unknown; (not completed, id) gives cancelled plus app or other; (not completed, nil) gives cancelled/none; error gives failed/none with a closed code; no presenter gives failed/none `presenter_unavailable`; result keys within `{target, outcome, code}`; double callback settles once; never target_chosen, handed_off, dismissed or not_confirmed | Native | P0       | IO1, IO4, IO5 | -     | `Tests/ShareCardShareOutcomeTests.swift` (SPM)                                      | pr-share-native-unit                  |
| N-IOS-SHARE-FILE     | `ShareCardShareFile` accepts only `cache/share-cards/cc69-share-<uuid>.png` with a valid PNG and matching SHA256; rejects `cc68-*` names, other names, files outside the folder, `..` traversal, symlink escape, digest mismatch and extra chunks                                                                                                                                                                                                                                                              | Native | P0       | AC1           | R-017 | `Tests/ShareCardShareFileTests.swift` (SPM)                                         | pr-share-native-unit                  |
| N-IOS-PNGFILE-PREFIX | Photo-save `ShareCardPngFile` still accepts `cc68-*` and rejects `cc69-share-*`; existing photo-save tests unchanged                                                                                                                                                                                                                                                                                                                                                                                           | Native | P1       | AC1           | -     | `apps/mobile/modules/share-card-photo-save/ios/Tests/ShareCardPhotoSaveTests.swift` | ios-build, pr-share-native-unit (RG3) |
| N-IOS-ANCHOR         | Pure anchor configuration: sourceView is the presenter view, sourceRect equals the JS Share frame, a missing presenter yields `presenter_unavailable`                                                                                                                                                                                                                                                                                                                                                          | Native | P1       | AC5           | -     | `Tests/ShareCardAnchorConfigurationTests.swift` (SPM)                               | pr-share-native-unit                  |
| N-IOS-PRESENTER-UI   | XCUITest: Share presents the activity sheet on the main thread from the top-most controller; the test-build anchor report shows sourceView set and sourceRect equal to the Share button frame; dismissal returns focus to Share with `shareClosed`                                                                                                                                                                                                                                                             | Native | P1       | AC5, IO4      | R-012 | `apps/mobile/native-tests/ShareCardShareSheetUITests.swift` (new)                   | ios-shard-1                           |

### Native Android (`apps/mobile/modules/share-card-native-share/android/`)

| ID                  | Scenario                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Level  | Priority | AC / I/O      | Risk  | File                                                            | Lane                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- | ------------- | ----- | --------------------------------------------------------------- | --------------------- |
| N-AND-MAPPER        | Six packages map to four targets (`com.facebook.katana` and `com.facebook.lite` to facebook; `com.zhiliaoapp.musically` and `com.ss.android.ugc.trill` to tiktok); near misses (`com.instagram.android.fake`, `com.instagram.barcelona`, `com.facebook.orca`, `com.pinterest.twa`) map to `other`                                                                                                                                                                                                                                                                                  | Native | P0       | IO2           | R-002 | `src/test/java/.../ShareCardTargetMapperTest.kt`                | pr-share-native-unit  |
| N-AND-OUTCOME       | First event wins: callback gives target_chosen plus app or other; host resume plus 750 ms with no callback gives not_confirmed/none; callback inside the grace window gives target_chosen; callback after not_confirmed settles is ignored; duplicate callback ignored; callback carrying an old attempt id ignored; recreation or destruction mid-attempt gives not_confirmed/none; start error gives failed/none or unavailable/none; teardown cancels the PendingIntent and unregisters the receiver; the Android outcome type has no completed, handed_off or dismissed member | Native | P0       | IO2, IO4, IO5 | R-004 | `src/test/java/.../ShareCardShareResultTest.kt` (Robolectric)   | pr-share-native-unit  |
| N-AND-PENDINGINTENT | `@Config(sdk = [34, 36])`: PendingIntent is FLAG_MUTABLE; its Intent action carries the attempt id and `package == context.packageName`; construction does not throw; receiver registered RECEIVER_NOT_EXPORTED; a fill-in with `EXTRA_CHOSEN_COMPONENT` reaches the receiver                                                                                                                                                                                                                                                                                                      | Native | P0       | IO2           | R-005 | `src/test/java/.../ShareCardPendingIntentTest.kt` (Robolectric) | pr-share-native-unit  |
| N-AND-PROVIDER      | Provider paths expose only `cache/share-cards/`; `getUriForFile` outside it throws; authority module-unique; `exported=false`, `grantUriPermissions=true`                                                                                                                                                                                                                                                                                                                                                                                                                          | Native | P0       | AC1           | R-006 | `src/test/java/.../ShareCardFileProviderTest.kt`                | pr-share-native-unit  |
| N-AND-RECEIVE       | androidTest with a receiving test Activity: chooser wraps `ACTION_SEND` `image/png` with `EXTRA_STREAM` on the module authority, read grant and ClipData; the Activity reads the granted URI and its SHA256 equals the expected digest; a sibling `cc69-share-*` URI and an out-of-scope URI are denied; no `EXTRA_TEXT` or `EXTRA_SUBJECT`                                                                                                                                                                                                                                        | Native | P0       | AC1, IO2      | -     | `src/androidTest/java/.../ShareCardShareReceiveTest.kt`         | android36-interaction |

### Mobile libraries and composer

| ID                          | Scenario                                                                                                                                                                                                                                                                                                                                                                                                                  | Level       | Priority | AC / I/O           | Risk  | File                                                                                                | Lane                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- | ------------------ | ----- | --------------------------------------------------------------------------------------------------- | -------------------- |
| U-SHARE-LIB-BYTES           | Response digest differs from expected: no file, no module call; decoded bytes differ from response digest: no module call; match: module receives `cache/share-cards/cc69-share-<uuid>.png` hashing to the preview digest; prepare-file helper shared with save                                                                                                                                                           | Integration | P0       | AC1                | R-001 | `apps/mobile/src/lib/share-card-share.native.spec.ts` (new)                                         | pr-tests             |
| U-SHARE-LIB-RESULT          | Strict bridge validator: keys within `{target, outcome, code}`; `code` from a closed set; platform-valid pairs only (Android completed, iOS target_chosen, any `unknown` on Android rejected); extra keys `activityType`, `package`, `uri` rejected; rejection settles failed/none (RG2)                                                                                                                                  | Unit        | P0       | AC3, IO2           | R-002 | same                                                                                                | pr-tests             |
| U-SHARE-LEASE               | Share file lease: lock released at settlement while the file remains; composer close keeps it; identity change keeps it; restart keeps a file younger than 30 minutes; age sweep at startup and before each share deletes `cc69-share-*` older than 30 minutes; Save settlement cleanup and the `cc68-*` orphan sweep never touch `cc69-share-*`; the age sweep never touches `cc68-*`                                    | Integration | P0       | AC4, IO2, IO10     | R-011 | `apps/mobile/src/lib/share-card-save-operations.spec.ts`, `share-card-save.native.spec.ts` (extend) | pr-tests             |
| U-SHARE-OPS                 | One global operation: share blocks save and save blocks share, duplicate taps ignored; lock released exactly once at settlement; late or duplicate native callbacks ignored                                                                                                                                                                                                                                               | Integration | P0       | AC4                | -     | `share-card-save-operations.spec.ts` (extend)                                                       | pr-tests             |
| U-SHARE-LIB-UNAVAILABLE     | Module absent: availability false, no prepare request, no file, no event; runtime start error maps to unavailable/none with one event                                                                                                                                                                                                                                                                                     | Unit        | P1       | IO5                | R-009 | `share-card-share.native.spec.ts`                                                                   | pr-tests             |
| U-SHARE-FIXTURE             | Modes `share_completed_instagram` (iOS), `share_chosen_pinterest` (Android), `share_target_other`, `share_closed`, `share_not_confirmed` (Android), `share_failed`, `share_unavailable` parse only with `STORY68_NATIVE_TEST_BUILD`; release builds ignore them; platform-only modes are rejected on the other platform                                                                                                   | Unit        | P1       | IO1, IO2, IO4, IO5 | -     | `apps/mobile/src/lib/share-card-native-fixture.spec.ts` (extend)                                    | pr-tests             |
| U-SHARE-LOG-PRIVACY         | Failure logs carry closed codes when errors embed a file URI, digest or package; a node scan finds no Swift or Kotlin log call formatting activity type, package or URI                                                                                                                                                                                                                                                   | Unit        | P1       | IO5                | -     | `share-card-share.native.spec.ts`; `scripts/lib/story68-native-safety.test.mjs` (extend)            | pr-tests, pr-browser |
| C-COMP-SHARE-GATE           | Share renders only when the current member's capability is on and the module is present; capability 404, timeout or malformed hides it; identity change clears capability state; a late capability response for the previous member is ignored; module absent shows a statically disabled Share with the localized reason, and pressing it emits nothing and sends no prepare; Share disabled until the preview validates | Component   | P0       | IO8, IO10          | -     | `apps/mobile/components/share-card-composer.test.tsx` (extend)                                      | pr-tests             |
| C-COMP-SHARE-COMPLETED      | iOS completed: `shared` announced once, focus Share, event instagram/completed                                                                                                                                                                                                                                                                                                                                            | Component   | P1       | IO1                | -     | same                                                                                                | pr-tests             |
| C-COMP-SHARE-CHOSEN         | Android target chosen: `sentToApp` announced once, the `shared` string never renders, focus Share, event pinterest/target_chosen                                                                                                                                                                                                                                                                                          | Component   | P0       | IO2                | -     | same                                                                                                | pr-tests             |
| C-COMP-SHARE-CLOSED         | iOS cancelled with a named activity (app/cancelled) and without (none/cancelled), Android not_confirmed/none: `shareClosed`, preview, source and watermark kept, focus Share, Save enabled                                                                                                                                                                                                                                | Component   | P1       | AC2, IO4           | -     | same                                                                                                | pr-tests             |
| C-COMP-SHARE-FAIL           | Native error, write error, 403 and offline: merlot `shareFailed`, focus Save, preview kept, Save enabled, event failed/none                                                                                                                                                                                                                                                                                               | Component   | P0       | AC2, IO5           | -     | same                                                                                                | pr-tests             |
| C-COMP-SHARE-UNAVAILABLE    | Runtime unavailable: `shareUnavailable`, focus Save, one unavailable/none event                                                                                                                                                                                                                                                                                                                                           | Component   | P1       | IO5                | -     | same                                                                                                | pr-tests             |
| C-COMP-SHARE-STALE          | 409 `preview_changed`: 6.8 stale feedback, focus Refresh, old composition visible, Save and Share disabled until a fresh preview loads, event failed/none                                                                                                                                                                                                                                                                 | Component   | P1       | IO6                | -     | same                                                                                                | pr-tests             |
| C-COMP-SHARE-IDENTITY       | Sign-out while the sheet is open: preview cleared, late result ignored, no feedback, no event; the leased file stays                                                                                                                                                                                                                                                                                                      | Component   | P0       | IO10               | -     | same                                                                                                | pr-tests             |
| C-COMP-SHARE-ANALYTICS-DOWN | Capture throws synchronously and rejects asynchronously: same copy and focus, lock released, Save usable, no unhandled rejection                                                                                                                                                                                                                                                                                          | Component   | P0       | IO11               | R-003 | same                                                                                                | pr-tests             |
| C-COMP-SHARE-ONE-EVENT      | One event per attempt; duplicate taps during a pending attempt ignored; no event at press time; disabled presses emit nothing                                                                                                                                                                                                                                                                                             | Component   | P0       | AC3                | -     | same                                                                                                | pr-tests             |
| C-COMP-SHARE-ANCHOR         | The Share button's measured frame is passed as the anchor on every attempt and re-measured after layout change                                                                                                                                                                                                                                                                                                            | Component   | P1       | AC5                | -     | same                                                                                                | pr-tests             |
| C-COMP-SHARE-A11Y           | 44-point target, one announcement per settlement, Android Back while pending keeps the global operation, operation-neutral finishing copy                                                                                                                                                                                                                                                                                 | Component   | P2       | AC2                | -     | same                                                                                                | pr-tests             |

### Web

| ID                 | Scenario                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Level     | Priority | AC / I/O                         | Risk  | File                                                              | Lane     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | -------- | -------------------------------- | ----- | ----------------------------------------------------------------- | -------- |
| U-WEB-SHARE-LIB    | `File([authorized bytes], 'couturecast-card.png', {type:'image/png'})` hashes to the preview digest; `canShare` missing, false or throwing means unsupported; resolve maps to handed_off/unknown; AbortError to dismissed/none; NotAllowedError keeps the authorization and signals tap-again; other errors to failed/none                                                                                                                                                                                                                                                                                                                                                                                         | Unit      | P0       | AC1, IO3, IO4, IO7               | -     | `apps/web/src/lib/share-cards.test.ts` (extend)                   | pr-tests |
| C-WEB-SHARE-DIALOG | Share shown only with capability on and `canShare({files})`; capability off, 404, timeout or malformed leaves Download only; identity change clears capability and authorization, and a late capability response for the previous member is ignored; the authorized tap calls `navigator.share` with no await before it; authorization expires at 60 s (fake timers) and is cleared by close, composition change and identity change; resolve gives `sentToApp` and focus Share; AbortError gives `shareClosed` and focus Share; failure gives `shareFailed` and focus Download; 409 gives the 6.8 stale path with focus Refresh; one event per attempt; superseded attempts emit nothing; capture throw swallowed | Component | P0       | AC2, AC3, IO3 to IO8, IO10, IO11 | R-007 | `apps/web/src/app/components/share-card-dialog.test.tsx` (extend) | pr-tests |

### Locales and harness

| ID                      | Scenario                                                                                                                                                                                                                    | Level | Priority | AC / I/O   | Risk  | File                                                               | Lane       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------- | ---------- | ----- | ------------------------------------------------------------------ | ---------- |
| U-SHARE-LOCALES         | Keys `share`, `sharing`, `shared`, `sentToApp`, `shareClosed`, `shareFailed`, `shareUnavailable`, `shareTapAgain` in all 20 catalogs with placeholder parity; per locale `sentToApp` and `shareClosed` differ from `shared` | Unit  | P1       | IO1 to IO7 | -     | `apps/{web,mobile}/src/i18n/share-card-locales.spec.ts` (extend)   | pr-tests   |
| U-HARNESS-IOS-SHARDS    | `share-sheet` is in the dispatchable post-matrix list; it appears exactly once in `commandsForShard(1)` and never in `commandsForShard(2)`; shard 2's explicit command list equals its previous `AFTER_MATRIX` spread       | Unit  | P1       | AC6        | -     | `scripts/ci/native-ios-shards.test.mjs` (extend)                   | pr-browser |
| U-HARNESS-ANDROID-LANES | Interaction suite runs `share-sheet` once on API 36; matrix suite command list byte-identical to main                                                                                                                       | Unit  | P1       | AC6        | R-014 | `scripts/ci/share-card-android.test.mjs` (extend)                  | pr-browser |
| U-HARNESS-WEB-MATRIX    | New shared behaviors registered; at most 5 share titles; zero per-locale share titles                                                                                                                                       | Unit  | P1       | AC6        | R-013 | `scripts/e2e-share-card/assert-web-matrix.test.mjs` (extend)       | pr-browser |
| U-HARNESS-PR-WORKFLOW   | `pr-share-native-unit.yml` path filters cover the share module, the photo-save package and the workflow; both steps fail on zero tests; job timeouts at most 20 minutes                                                     | Unit  | P1       | AC6        | -     | `scripts/ci/share-card-lanes.test.mjs` (extend)                    | pr-browser |
| U-HARNESS-IPAD-EVIDENCE | Evidence check: `_bmad-output/test-artifacts/story-6-9/` holds the iPad proof record with device class iPad, OS version, commit, anchored-to-Share result and screenshot SHA256                                             | Unit  | P1       | AC5        | -     | `scripts/lib/story69-ipad-evidence.test.mjs` (new)                 | pr-browser |
| U-HARNESS-TIMEOUTS      | Every `share-*.yaml` flow has a timeout; the share-sheet total fits each lane budget                                                                                                                                        | Unit  | P2       | AC6        | -     | `scripts/lib/story68-flow-timeouts.test.mjs` (extend)              | pr-browser |
| U-PLUGIN-MANIFEST       | Generated Android manifest has one module provider and no new permissions (`QUERY_ALL_PACKAGES`, storage); iOS Info.plist gains no usage strings                                                                            | Unit  | P1       | AC1        | -     | `apps/mobile/plugins/with-share-card-permissions.test.js` (extend) | pr-browser |

### E2E

| ID                     | Scenario                                                                                                                                                                                                                                                                    | Level        | Priority | AC / I/O      | Risk  | File                                                          | Lane                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------- | ------------- | ----- | ------------------------------------------------------------- | ---------------------------------- |
| P-SHARE-BYTES          | Stubbed `canShare`/`share` capture the File; SHA256 equals the preview digest; fixed name and type; `sentToApp`, focus Share; `__capturedAnalyticsEvents` holds one `share_card_shared` deep-equal to `{client:'web', target:'unknown', outcome:'handed_off', duration_ms}` | E2E          | P0       | AC1, AC3, IO3 | -     | `playwright/tests/share-card-export.spec.ts`                  | pr-browser                         |
| P-SHARE-DISMISS        | AbortError: `shareClosed`, preview digest and watermark unchanged, focus Share, Download enabled, one dismissed/none event                                                                                                                                                  | E2E          | P1       | AC2, IO4      | -     | same                                                          | pr-browser                         |
| P-SHARE-TAP-AGAIN      | NotAllowedError after reauthorization: `shareTapAgain`; the next tap inside 60 s calls `share()` with the same digest and no new prepare request; axe clean                                                                                                                 | E2E          | P0       | IO7           | -     | same                                                          | pr-browser                         |
| P-SHARE-CAPABILITY-OFF | Capabilities 404 with `canShare` stubbed true, then capability on with no `canShare`: no Share control in either state; Download works; no share event                                                                                                                      | E2E          | P1       | IO8           | -     | same                                                          | pr-browser                         |
| P-SHARE-REVALIDATE     | Source changed after preview: share prepare 409, 6.8 stale feedback, focus Refresh, `share()` never called, Download and Share disabled until refresh                                                                                                                       | E2E          | P1       | IO6           | -     | same                                                          | pr-browser                         |
| M-SHARE-COMPLETED      | iOS fixture `share_completed_instagram`: `shared`, focus Share, preview and watermark unchanged                                                                                                                                                                             | E2E          | P1       | IO1           | -     | `maestro/story68/share-completed.yaml`                        | ios-shard-1                        |
| M-SHARE-CHOSEN         | Android fixture `share_chosen_pinterest`: `sentToApp` visible and `shared` absent; close the composer and relaunch the app; harness finds the `cc69-share-*` file via `run-as`; Save works (lock released)                                                                  | E2E          | P0       | AC4, IO2      | -     | `maestro/story68/share-chosen.yaml`                           | android36-interaction              |
| M-SHARE-CLOSED         | Fixture `share_closed` on both platforms: `shareClosed`, preview and watermark kept, Save enabled                                                                                                                                                                           | E2E          | P1       | AC2, IO4      | -     | `maestro/story68/share-closed.yaml`                           | ios-shard-1, android36-interaction |
| M-SHARE-NOT-CONFIRMED  | Android fixture `share_not_confirmed`: `shareClosed`, focus Share, Save enabled                                                                                                                                                                                             | E2E          | P1       | AC2, IO4      | -     | `maestro/story68/share-not-confirmed.yaml`                    | android36-interaction              |
| M-SHARE-FAILED         | Fixture `share_failed` on both platforms: merlot `shareFailed`, focus Save, Save then succeeds                                                                                                                                                                              | E2E          | P0       | AC2, IO5      | -     | `maestro/story68/share-failed.yaml`                           | ios-shard-1, android36-interaction |
| M-SHARE-UNAVAILABLE    | Fixture `share_unavailable` on both platforms: `shareUnavailable`, focus Save, Save works                                                                                                                                                                                   | E2E          | P1       | IO5           | -     | `maestro/story68/share-unavailable.yaml`                      | ios-shard-1, android36-interaction |
| M-SHARE-OTHER          | Fixture `share_target_other` on both platforms: platform-correct copy                                                                                                                                                                                                       | E2E          | P2       | IO1, IO2      | -     | `maestro/story68/share-other.yaml`                            | ios-shard-1, android36-interaction |
| M-SHARE-SHEET-IOS      | Real `UIActivityViewController` opens; harness hashes the `cc69-share-*` file in the app container against the preview digest; dismissal gives `shareClosed` with preview and Save intact                                                                                   | E2E          | P0       | AC1, AC2      | -     | `maestro/story68/share-sheet.yaml` plus `share-sheet` command | ios-shard-1                        |
| M-SHARE-SHEET-ANDROID  | Real chooser opens; harness hashes the file via `run-as`; Back gives `shareClosed` (not_confirmed) with preview and Save intact                                                                                                                                             | E2E          | P0       | AC1, AC2      | -     | same                                                          | android36-interaction              |
| X-IPAD-ANCHOR          | Local iPad proof: Share opens a popover anchored to the Share button; screenshot and record committed                                                                                                                                                                       | E2E (manual) | P1       | AC5           | -     | `_bmad-output/test-artifacts/story-6-9/`                      | local                              |
| X-SHARE-DEVICE-PIN     | Physical devices: Pinterest maps to pinterest (iOS completed, Android target_chosen)                                                                                                                                                                                        | E2E (manual) | P3       | IO1, IO2      | R-008 | `_bmad-output/test-artifacts/story-6-9/`                      | release-qa                         |
| X-SHARE-DEVICE-IG      | Same for Instagram                                                                                                                                                                                                                                                          | E2E (manual) | P3       | IO1, IO2      | -     | same                                                          | release-qa                         |
| X-SHARE-DEVICE-FB-TT   | Same for Facebook and TikTok                                                                                                                                                                                                                                                | E2E (manual) | P3       | IO1, IO2      | -     | same                                                          | release-qa                         |

Playwright stays at 5 shared cases (Tasks cap), each run in three engines. P-SHARE-UNSUPPORTED
folded into P-SHARE-CAPABILITY-OFF; P-SHARE-FAILURE became P-SHARE-TAP-AGAIN.

---

## Test Coverage Plan (risk-linked)

Each scored risk has one row at the level where its failure first becomes observable. Catalog
rows not listed here keep their catalog priority with risk link `-`.

### P0 (Critical)

**Criteria**: Critical business, security, data-integrity, or compliance impact with no safe
workaround. Risk score is supporting evidence and is not a required condition.

| Requirement                          | Test Level  | Risk Link | Test Count | Owner | Notes                                                                                                                                                                                                              |
| ------------------------------------ | ----------- | --------- | ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Previewed bytes only                 | Integration | R-001     | 3          | DEV   | U-SHARE-LIB-BYTES: response mismatch, decoded mismatch, match. Boundary: owned cache file. Consequence: another app receives unseen bytes; no recovery after handoff.                                              |
| Raw-id containment                   | Unit        | R-002     | 4          | DEV   | N-IOS-MAPPER, N-AND-MAPPER, U-SHARE-LIB-RESULT, U-SHARE-EVT-FORBIDDEN. Pure mapping and schema. Consequence: irreversible app-usage data in PostHog.                                                               |
| Analytics cannot break share         | Component   | R-003     | 2          | DEV   | C-COMP-SHARE-ANALYTICS-DOWN (sync throw, async reject). Consequence: wrong copy or focus, or a share shown as failed.                                                                                              |
| No overclaimed outcome               | Unit        | R-004     | 4          | DEV   | N-AND-OUTCOME type, U-SHARE-EVT-PAIRS client binding, U-SHARE-LIB-RESULT, U-SHARE-LOCALES. Consequence: member told a post exists; events cannot be corrected.                                                     |
| Android PendingIntent and settlement | Unit        | R-005     | 4          | DEV   | N-AND-PENDINGINTENT at SDK 34 and 36: mutable, package-bound, attempt action, unexported receiver. Consequence: chooser never opens on Android 14+, or the lock stays held.                                        |
| FileProvider scope                   | Unit        | R-006     | 3          | DEV   | N-AND-PROVIDER: paths, outside-folder throw, exported and grant flags. Consequence: receiving apps read other cache files.                                                                                         |
| Web synchronous handoff              | Component   | R-007     | 4          | DEV   | C-WEB-SHARE-DIALOG: no await before `share()`, 60 s expiry, clear on change, clear on identity. Consequence: first tap fails, or a stale authorization hands bytes after revocation.                               |
| Server flag gate                     | Integration | R-010     | 3          | DEV   | I-SHARE-FLAG: fallback false with PostHog down, seed true, default false. P0 despite score 3: a release-gate breach has no workaround.                                                                             |
| Share file lease                     | Integration | R-011     | 7          | DEV   | U-SHARE-LEASE: settlement, close, identity, restart, startup sweep, pre-share sweep, prefix isolation. Consequence: broken receiver reads, or the card persisting past 30 minutes against the epic's storage rule. |
| SDK boundary sanitizer               | Integration | R-015     | 3          | DEV   | I-SHARE-WIRE-WEB: enriched URL and super property removed, envelope intact, deliberate sanitizer failure drops the event. Boundary: SDK transport. Consequence: URLs and identity enrichment reach PostHog.        |

### P1 (High)

**Criteria**: Core, frequent, or complex behavior with material user reach and a limited workaround.
Risk score is supporting evidence and is not a required condition.

| Requirement                       | Test Level  | Risk Link | Test Count | Owner | Notes                                                                                                                                                       |
| --------------------------------- | ----------- | --------- | ---------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module absent                     | Unit        | R-009     | 2          | DEV   | U-SHARE-LIB-UNAVAILABLE: static absent, runtime start error. Workaround: Save still works.                                                                  |
| iPad presenter                    | Integration | R-012     | 1          | DEV   | N-IOS-PRESENTER-UI (XCUITest, shard 1); X-IPAD-ANCHOR and its evidence check back it. Workaround: Save.                                                     |
| browser-acceptance budget         | Unit        | R-013     | 3          | QA    | U-HARNESS-WEB-MATRIX: behaviors registered, max 5 share titles, 0 per-locale.                                                                               |
| Deployed 6.8 clients              | API         | R-016     | 3          | DEV   | C-SHARE-PACT: old client/new server, new client/old server (404), unchanged save.                                                                           |
| Validator prefix policy           | Unit        | R-017     | 2          | DEV   | N-IOS-SHARE-FILE accepts only `cc69-share-*`. N-IOS-PNGFILE-PREFIX keeps Save `cc68-`-only. Workaround: Save unaffected when share validation fails closed. |
| android36-native-matrix untouched | Unit        | R-014     | 1          | QA    | U-HARNESS-ANDROID-LANES pins the matrix command list.                                                                                                       |

### P2 (Medium)

**Criteria**: Secondary behavior with narrower user reach and an acceptable workaround. Risk score
is supporting evidence and is not a required condition.

No scored risk sits in this band. P2 catalog rows (C-COMP-SHARE-A11Y, U-HARNESS-TIMEOUTS,
M-SHARE-OTHER) cover secondary behavior already guarded at higher priority.

### P3 (Low)

**Criteria**: Rare, cosmetic, or experimental behavior with minimal impact and an easy workaround.
Risk score is supporting evidence and is not a required condition.

| Requirement       | Test Level | Risk Link | Test Count | Owner | Notes                                                                                                             |
| ----------------- | ---------- | --------- | ---------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| Real platform ids | E2E        | R-008     | 3          | QA    | X-SHARE-DEVICE-PIN, -IG, -FB-TT on physical devices. Consequence: a target recorded as `other`; no member impact. |

---

## Explicit negative tests

**Privacy (forbidden properties, no raw ids, no bytes):**

- U-SHARE-EVT-FORBIDDEN: 24 forbidden keys, 3 raw-id target values, 3 bad durations.
- U-SHARE-SANITIZER-WEB and -MOBILE: URL, path, host, referrer, screen, super properties and
  top-level and nested `$set`/`$set_once` removed; `$geoip_disable: true`; internal error returns
  null.
- I-SHARE-WIRE-WEB and -MOBILE: the serialized batched request matches the exact per-platform
  shapes with a sensitive URL and a registered super property; a deliberate sanitizer failure drops
  the event.
- U-SHARE-LIB-RESULT: native results carrying `activityType`, `package` or `uri` are rejected.
- N-IOS-MAPPER, N-AND-MAPPER: near-miss ids never pass through.
- N-IOS-OUTCOME: result keys within `{target, outcome, code}`.
- U-SHARE-LOG-PRIVACY, I-SHARE-AUDIT, N-AND-RECEIVE (no `EXTRA_TEXT`/`EXTRA_SUBJECT`),
  N-AND-PROVIDER and U-PLUGIN-MANIFEST.

**Truthfulness (Android never reports completed):**

- N-AND-OUTCOME: the Android outcome type has no completed member; no callback gives
  not_confirmed/none.
- U-SHARE-EVT-PAIRS: `{android, completed}`, `{web, completed}`, target_chosen/none and
  not_confirmed with any app rejected.
- U-SHARE-LIB-RESULT: an Android `completed` result is rejected.
- C-COMP-SHARE-CHOSEN, M-SHARE-CHOSEN: `shared` never renders on Android.
- U-SHARE-LOCALES: `sentToApp` and `shareClosed` differ from `shared` in every locale.
- U-SHARE-FIXTURE: `share_completed_instagram` rejected on Android.

---

## Execution Strategy

- **Pull request:** pr-tests (unit, component, API integration, SDK wire tests), pr-contract,
  pr-browser (harness node suites plus 5 Playwright share cases in three engines with
  `workers: 1`), and `pr-share-native-unit` (Swift and Robolectric, path-filtered). Record
  before/after timings for browser-acceptance and the new workflow in the PR; if additions exceed
  the measured headroom, move them to a separate job (AC6).
- **Main, nightly and dispatch:** ios-shard 1 runs `share-sheet` (fixture flows plus the real-sheet
  smoke) and `ShareCardShareSheetUITests`; android36-interaction runs `share-sheet` and the
  receiving androidTest; ios-build keeps the photo-save `swift test`. These lanes skip pull requests
  by design, so the PR gate for native correctness is `pr-share-native-unit`.
- **Local:** X-IPAD-ANCHOR, with U-HARNESS-IPAD-EVIDENCE failing the PR until its record exists.
- **Release QA:** X-SHARE-DEVICE rows before the flag is enabled outside the dev seed.

---

## Resource Estimates

| Priority  | Count  | Hours/Test  | Total Hours    | Notes                                                                      |
| --------- | ------ | ----------- | -------------- | -------------------------------------------------------------------------- |
| P0        | 38     | 1.5 to 2.5  | ~57 to 95      | Native state machines, SDK wire tests, receiving androidTest, byte capture |
| P1        | 32     | 0.75 to 1.5 | ~24 to 48      | Component, harness, fixture flows, XCUITest, iPad proof                    |
| P2        | 3      | 0.5 to 1    | ~2 to 3        | Accessibility and timeouts                                                 |
| P3        | 3      | 1 to 2      | ~3 to 6        | One device session                                                         |
| **Total** | **76** | **-**       | **~86 to 152** | **~11 to 19 days**                                                         |

### Prerequisites

- Test data: 6.8 fixtures (`share-card-fixture.ts`, Playwright `share-card-fixtures.ts`), dev seed
  with `share_card_native_share_enabled: true`.
- Tooling: SPM package with pure mapper, reducer, anchor and `ShareCardShareFile` sources;
  Robolectric with SDK 34 and 36; androidTest receiving Activity; test-build anchor report for the
  XCUITest; Playwright init script stubbing `navigator.canShare` and `navigator.share`; real
  posthog-js and posthog-react-native in the wire tests with transport mocked.
- Environment: isolated `DATABASE_URL` and `PLAYWRIGHT_SKIP_DB_RESET=true` for any local Playwright
  run; never the default database at 127.0.0.1:54322.

---

## Quality Gate Criteria

### Pass/Fail Thresholds

- **P0 pass rate**: 100%
- **P1 pass rate**: at least 95%, waivers recorded in the spec Review Triage Log
- **P2/P3 pass rate**: at least 90% (informational)
- **High-risk mitigations**: R-001 to R-007 and R-015 complete before merge

### Coverage Targets

- New share libraries, sanitizers and composer branches: at least 80% line coverage in pr-tests
- Privacy and truthfulness negatives: 100% present and passing
- Every AC and every I/O row has at least one P0 or P1 test (traceability below)

### Non-Negotiable Requirements

- [ ] All P0 tests pass
- [ ] No high risk unmitigated
- [ ] Every PR job under 20 minutes with before/after timings in the PR; android36-native-matrix
      command list unchanged
- [ ] `swift test` and `testDebugUnitTest` report more than zero tests
- [ ] `npm run generate:http-openapi && npm run generate:api-client` leave no diff
- [ ] tsc clean in every touched workspace, counted by error code; lint clean
- [ ] Share Playwright and Maestro flows pass three consecutive runs before the flag leaves the dev
      seed
- [ ] `flags.ts` default stays false; production flag values untouched

---

## Traceability

| Item                                                    | Tests (P0/P1)                                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 receiving bytes equal preview                       | U-SHARE-SVC-AUTH, I-SHARE-AUDIT, U-SHARE-LIB-BYTES, N-IOS-SHARE-FILE, N-AND-PROVIDER, N-AND-RECEIVE, U-WEB-SHARE-LIB, P-SHARE-BYTES, M-SHARE-SHEET-IOS, M-SHARE-SHEET-ANDROID               |
| AC2 non-success keeps composition                       | C-COMP-SHARE-CLOSED, C-COMP-SHARE-FAIL, C-WEB-SHARE-DIALOG, P-SHARE-DISMISS, M-SHARE-CLOSED, M-SHARE-NOT-CONFIRMED, M-SHARE-FAILED                                                          |
| AC3 one serialized allowlisted request                  | U-SHARE-EVT-SCHEMA, U-SHARE-EVT-PAIRS, U-SHARE-EVT-FORBIDDEN, U-SHARE-SANITIZER-WEB, U-SHARE-SANITIZER-MOBILE, I-SHARE-WIRE-WEB, I-SHARE-WIRE-MOBILE, C-COMP-SHARE-ONE-EVENT, P-SHARE-BYTES |
| AC4 Android lease after close or restart, lock released | U-SHARE-LEASE, U-SHARE-OPS, M-SHARE-CHOSEN                                                                                                                                                  |
| AC5 iPad anchor                                         | N-IOS-ANCHOR, N-IOS-PRESENTER-UI, C-COMP-SHARE-ANCHOR, X-IPAD-ANCHOR, U-HARNESS-IPAD-EVIDENCE                                                                                               |
| AC6 PR jobs under 20 minutes                            | U-HARNESS-IOS-SHARDS, U-HARNESS-WEB-MATRIX, U-HARNESS-ANDROID-LANES, U-HARNESS-PR-WORKFLOW, recorded timings                                                                                |
| IO1 iOS completed                                       | N-IOS-OUTCOME, C-COMP-SHARE-COMPLETED, M-SHARE-COMPLETED                                                                                                                                    |
| IO2 Android chosen                                      | N-AND-MAPPER, N-AND-OUTCOME, N-AND-PENDINGINTENT, C-COMP-SHARE-CHOSEN, M-SHARE-CHOSEN                                                                                                       |
| IO3 web resolved                                        | U-WEB-SHARE-LIB, C-WEB-SHARE-DIALOG, P-SHARE-BYTES                                                                                                                                          |
| IO4 closed                                              | N-IOS-OUTCOME, N-AND-OUTCOME, C-COMP-SHARE-CLOSED, P-SHARE-DISMISS, M-SHARE-CLOSED, M-SHARE-NOT-CONFIRMED                                                                                   |
| IO5 failure                                             | N-IOS-OUTCOME, N-AND-OUTCOME, C-COMP-SHARE-FAIL, C-COMP-SHARE-UNAVAILABLE, M-SHARE-FAILED                                                                                                   |
| IO6 stale preview                                       | U-SHARE-SVC-STALE, C-COMP-SHARE-STALE, C-WEB-SHARE-DIALOG, P-SHARE-REVALIDATE                                                                                                               |
| IO7 web activation expired                              | U-WEB-SHARE-LIB, C-WEB-SHARE-DIALOG, P-SHARE-TAP-AGAIN                                                                                                                                      |
| IO8 capability off or absent                            | U-SHARE-CAP-CLIENT, U-SHARE-CAP-API, U-SHARE-SVC-FLAG, I-SHARE-FLAG, C-COMP-SHARE-GATE, P-SHARE-CAPABILITY-OFF                                                                              |
| IO9 old 6.8 client                                      | U-SHARE-SVC-SAVE-REGRESSION, U-SHARE-CONTRACT, C-SHARE-PACT                                                                                                                                 |
| IO10 identity change                                    | U-SHARE-LEASE, C-COMP-SHARE-GATE, C-COMP-SHARE-IDENTITY, C-WEB-SHARE-DIALOG                                                                                                                 |
| IO11 analytics down                                     | C-COMP-SHARE-ANALYTICS-DOWN, C-WEB-SHARE-DIALOG, I-SHARE-WIRE-WEB, I-SHARE-WIRE-MOBILE                                                                                                      |

---

## Gap status

First-pass gaps G1 to G11 are closed by the spec revisions:

| ID  | Resolution in the spec                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------- |
| G1  | `share-sheet` in the dispatchable list, shard 2 explicit, `commandsForShard` assertions; Android interaction branch |
| G2  | `.github/workflows/pr-share-native-unit.yml`, failing on zero tests                                                 |
| G3  | Statically disabled Share emits nothing                                                                             |
| G4  | `share_chosen_pinterest` and `share_not_confirmed` (Android), `share_completed_instagram` (iOS)                     |
| G5  | Web resolve is handed_off/unknown with `sentToApp`                                                                  |
| G6  | Pre-handoff 403, 409, offline and write errors settle as failed; 409 keeps the 6.8 stale path                       |
| G7  | Result model table with `none` meaning no target confirmed                                                          |
| G8  | Partly: module returns `{target, outcome, code?}`; invalid-result handling remains RG2                              |
| G9  | Allowlist includes `locale` and the SDK transport keys                                                              |
| G10 | API tests run with vitest                                                                                           |
| G11 | Android first-event-wins state machine with a 750 ms grace                                                          |

Residual gaps where the spec is silent; the default each test uses is listed:

| ID  | Gap                                                                                                        | Default the tests use                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| RG1 | IO7 gives `shareTapAgain` for NotAllowedError but no outcome or focus                                      | Event failed/none (failure rule); focus follows the failed rule (Download); confirm, since the prompt asks for another Share tap |
| RG2 | Handling of a native result outside the result model                                                       | Settle failed/none with a closed code                                                                                            |
| RG3 | The photo-save cross-prefix test runs only in ios-build, which skips PRs                                   | Add the photo-save package to `pr-share-native-unit` path filters and steps                                                      |
| RG4 | `ShareCardShareSheetUITests` runs on an iPhone simulator, where a compact sheet ignores the popover anchor | A test-build-only anchor report exposes sourceView and sourceRect; X-IPAD-ANCHOR covers the real popover                         |
| RG5 | Which Android start errors are `unavailable` and which are `failed`                                        | No resolvable chooser activity gives unavailable; any other start exception gives failed                                         |
| RG6 | Lease age basis                                                                                            | File modification time; a future timestamp counts as expired                                                                     |

---

## Mitigation Plans

### R-001: Unseen bytes reach the OS (Score: 6)

**Mitigation Strategy:** Share lib compares response digest to `expectedSha256` and decoded bytes to
the response before writing; `ShareCardShareFile` re-validates on iOS; web authorization bound to
identity, presentation key and digest for at most 60 s.
**Owner:** Dev (mobile, web) **Timeline:** before PR review **Status:** Planned
**Verification:** U-SHARE-LIB-BYTES, N-IOS-SHARE-FILE, N-AND-RECEIVE, C-WEB-SHARE-DIALOG,
P-SHARE-BYTES.

### R-002: Raw ids leak (Score: 6)

**Mitigation Strategy:** Exact allowlist per platform; closed output; strict bridge and analytics
schemas; no native logging of ids.
**Owner:** Dev (native) **Timeline:** before PR review **Status:** Planned
**Verification:** N-IOS-MAPPER, N-AND-MAPPER, U-SHARE-LIB-RESULT, U-SHARE-EVT-FORBIDDEN,
U-SHARE-LOG-PRIVACY.

### R-003: Analytics throw breaks share (Score: 6)

**Mitigation Strategy:** Capture after settlement and lock release inside try/catch on both clients.
**Owner:** Dev (mobile, web) **Timeline:** before PR review **Status:** Planned
**Verification:** C-COMP-SHARE-ANALYTICS-DOWN, C-WEB-SHARE-DIALOG.

### R-004: Overclaimed outcome (Score: 6)

**Mitigation Strategy:** Per-platform outcome types; schema pairs and client binding; copy per
outcome; platform-only fixtures.
**Owner:** Dev (native), TEA **Timeline:** before PR review **Status:** Planned
**Verification:** N-AND-OUTCOME, U-SHARE-EVT-PAIRS, U-SHARE-LIB-RESULT, C-COMP-SHARE-CHOSEN,
M-SHARE-CHOSEN, U-SHARE-LOCALES.

### R-005: Android PendingIntent and settlement (Score: 6)

**Mitigation Strategy:** Package-bound mutable PendingIntent with the attempt id in its action,
unexported receiver, first-event-wins settlement, teardown cleanup.
**Owner:** Dev (native) **Timeline:** before PR review **Status:** Planned
**Verification:** N-AND-PENDINGINTENT (SDK 34, 36), N-AND-OUTCOME, M-SHARE-SHEET-ANDROID.

### R-006: FileProvider over-exposure (Score: 6)

**Mitigation Strategy:** Module-owned provider, `share-cards/` only, unexported, per-intent grant.
**Owner:** Dev (native) **Timeline:** before PR review **Status:** Planned
**Verification:** N-AND-PROVIDER, N-AND-RECEIVE, U-PLUGIN-MANIFEST.

### R-007: Web user activation and authorization bound (Score: 6)

**Mitigation Strategy:** Prepare the File before the final activation; call `share()` synchronously;
expire at 60 s; clear on close, change and identity.
**Owner:** Dev (web) **Timeline:** before PR review **Status:** Planned
**Verification:** C-WEB-SHARE-DIALOG, P-SHARE-TAP-AGAIN.

### R-015: SDK enrichment leak (Score: 6)

**Mitigation Strategy:** Event-specific `before_send` on both SDKs, nonthrowing and returning null on
internal error; `$geoip_disable: true`; envelope preserved.
**Owner:** Dev (mobile, web) **Timeline:** before PR review **Status:** Planned
**Verification:** U-SHARE-SANITIZER-WEB, U-SHARE-SANITIZER-MOBILE, I-SHARE-WIRE-WEB,
I-SHARE-WIRE-MOBILE.

---

## Assumptions and Dependencies

### Assumptions

1. The `share_card_shared` event is client-direct (D5); the server audit row is the only server
   record of a share.
2. Fixture modes stay behind `STORY68_NATIVE_TEST_BUILD` as in 6.8.
3. The spec accepts the 60 s web revocation window; tests assert the bound and leave in-window
   revocation unasserted.

### Dependencies

1. RG1 to RG6 answered or accepted before implementation.
2. `pr-share-native-unit.yml` lands with the native module.
3. One green main or dispatch run of ios-shard 1 and android36-interaction after merge.

### Risks to Plan

- **Risk:** ios-shard 1 or android36-interaction lacks headroom for `share-sheet`, the XCUITest and
  the androidTest.
  - **Impact:** native share evidence times out post-merge.
  - **Contingency:** keep the real-sheet smoke and XCUITest on shard 1, move fixture flows into a
    separate dispatchable command, and record the decision in the spec.

---

## Interworking & Regression

| Service/Component  | Impact                                                             | Regression Scope                                                                                                     |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 6.8 Save (mobile)  | Shared prepare-file helper, global operation, prefix-scoped sweeps | `share-card-save.native.spec.ts`, `share-card-save-operations.spec.ts`, photo-save Swift tests, Maestro M-\* matrix  |
| 6.8 Download (web) | Dialog gains Share and the bounded authorization                   | `share-card-dialog.test.tsx`, Playwright P-\* cases                                                                  |
| Share-card API     | New purpose, capabilities route, flag check, audit field           | `share-cards.service.spec.ts`, `share-card-export.integration.spec.ts`, Pact                                         |
| Analytics          | New event, schema and `before_send` hooks on both SDKs             | `packages/api-client/testing/analytics-events.spec.ts`, `mobile-analytics.test.tsx`, Playwright home analytics specs |
| iOS shard dispatch | Shard 2 switches to an explicit command list                       | `scripts/ci/native-ios-shards.test.mjs`                                                                              |
| CC-6.15 SDK 58     | Touches the composer and native journeys                           | Coordinate merges; both stories rerun the composer suite                                                             |

---

## Follow-on Workflows (Manual)

- `/bmad-tea-automate` in red mode for the P0 rows once RG1 to RG6 are settled.
- `/bmad-tea-trace` after implementation for the gate decision.
- `/bmad-tea-nfr` once CI timings and device evidence exist.

---

**Generated by**: BMad TEA Agent, Test Architect Module
**Workflow**: `bmad-tea-test-design`
