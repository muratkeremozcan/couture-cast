# CC-7.4 Codex review

**Changes requested.** Some Community reads can still replace newer approved text. A blank-caption
save can also consume quota and increment the revision even though nothing changed.

Reviewed `feat/epic7-story-7-4-community-post-edits-persist` at `d580f117` against `origin/main`
at `f65ed8e5`, the merge base. [Epic acceptance criteria](../../planning-artifacts/epics.md#L868),
[epic context](../epic-7-context.md#L64), [story specification](../spec-7-4-community-post-edits-persist.md)

## Correctness findings

### 1. Medium. Spotlight can replace a newer edit with an older response (AC 2, AC 5)

`apps/web/src/app/components/community-spotlight.tsx:175`,
`apps/mobile/src/features/community/use-community-spotlight.ts:179`,
`apps/mobile/src/features/community/community-screen.tsx:1454`

The first-page Spotlight read replaces the array outright on both platforms. If an author save
or a second client's realtime target update lands while that read is pending, its older response
can replace the newer text and clear the author's Edited badge. Native Spotlight detail renders
from the same array, so the open detail also regresses. Full Spotlight loads need the same
revision reconciliation as individual refreshes.

For non-authors, even the individual Spotlight image refresh can overwrite a newer realtime
update. Its request has an independent lifecycle and both responses legitimately omit the
owner-only `textRevision`, so the helper has no ordering signal. Fence these reads against
same-viewer text invalidations or use the existing sync ordering metadata where it is available.
Keep numeric text revisions owner-only.
`apps/web/src/app/components/community-spotlight.tsx:287`,
`apps/mobile/src/features/community/use-community-spotlight.ts:381`,
`packages/api-client/src/contracts/http/community.ts:681`,
`apps/api/src/modules/community/community.service.ts:215`

### 2. Medium. New Looks and deep-link reads miss the same revision guard (AC 2)

`apps/web/src/app/components/community-lookbook-grid.tsx:3223`,
`apps/web/src/app/components/community-lookbook-grid.tsx:4396`,
`apps/web/src/app/components/community-lookbook-grid.tsx:3474`,
`apps/mobile/src/features/community/community-screen.tsx:689`

The web realtime feed rebuild prioritizes newly fetched rows over the current New Looks buffer
when deduplicating. A delayed snapshot can replace a higher revision already stored in that
buffer. Revealing buffered looks also accepts fresh target objects without comparing their
revisions to the current buffered objects on web and mobile. The web deep-link GET and web and
mobile notification target handlers have request-generation guards, but their assignments still
replace text without a revision check. A local save can advance text while those requests remain
current. Reconcile at each commit using the newest copy for the active viewer and post. Preserve
existing eviction on a genuinely unavailable target.
`apps/web/src/app/components/community-lookbook-grid.tsx:3167`,
`apps/web/src/app/components/community-lookbook-grid.tsx:3611`,
`apps/mobile/src/features/community/community-screen.tsx:1139`

### 3. Medium. Resaving a blank legacy caption can count as an edit (AC 3, AC 4)

`apps/api/src/modules/community/community.repository.ts:857`,
`apps/api/src/modules/community/community.repository.ts:923`,
`apps/api/src/modules/community/community.service.ts:1380`,
`apps/api/src/modules/community/community-post-text.ts:21`

Publication can store a whitespace-only caption as an empty string. Both editors send a blank
caption as `null`. The repository normalizes the submitted value but compares it with raw stored
text in both preflight and the transaction. The same visible text runs screening, can increment
`textRevision` and consume quota, and can produce Saved or a refusal where the member should
receive No changes. Compare normalized stored and submitted text in both checks and keep the
unchanged response and its UI classification consistent.

### 4. Medium. The repository can supply its own missing screening evidence (AC 4)

`apps/api/src/modules/community/community-post-text.ts:14`,
`apps/api/src/modules/community/community.repository.ts:866`,
`apps/api/src/modules/community/community.repository.ts:930`

The decision type makes the fingerprint and locale optional. The repository fills absent values
from the request and preflight post, so its later equality checks can pass without the screener
attesting to either value. It accepts any nonblank `policyVersion` and does not compare it against
the expected policy identity. Require a complete decision from the screener, validate it against
the normalized payload, current persisted locale and server-selected policy identity, and reject
missing or mismatched values. The production callback supplies all three from a validated,
in-process screener. This is a decision-contract gap with no established remote screening bypass.
`apps/api/src/modules/community/community-post-text.ts:43`,
`apps/api/src/modules/community/community-post-text.ts:84`,
`apps/api/src/modules/community/community.service.ts:1308`

## Verification findings

- **Medium. The new stale-resolve regression test can pass without running the resolve.** Its setup
  stubs realtime startup, and opening a card does not start target resolution. The test never
  asserts that its delayed handler ran, or that the app processed its response before the final
  assertion. Drive sync explicitly and wait for both request start and response application.
  Assert the latest card and open detail after the older response on both surfaces.
  `apps/web/src/app/components/community-lookbook-grid.edit-text.test.tsx:34`,
  `apps/web/src/app/components/community-lookbook-grid.edit-text.test.tsx:390`,
  `apps/web/src/test-utils/community-lookbook-grid.tsx:380`
- **Medium. A baseline reload assertion was weakened (AC 6).** The prior Playwright case reloaded
  and asserted the exact title and caption saved together through the editor. The new case checks
  the combined response immediately, then overwrites the title with a direct API PATCH before
  reload. The later readback proves a different write. Restore reload assertions for both
  editor-saved values before advancing the revision. The protected moderation, sync integration
  and API Playwright files have no diff.
  `f65ed8e5:playwright/tests/community-post-text.spec.ts:122`,
  `playwright/tests/community-post-text.spec.ts:198`,
  `playwright/tests/community-post-text.spec.ts:240`,
  `playwright/tests/community-post-text.spec.ts:269`
- **Low. The AC 1 trace documents the happy paths and missing feedback.** It records all three
  editor inputs, PATCH statuses, revisions, and reload readbacks at 390 x 844. Each write persisted
  and the open second browser updated. Its stale-overwrite and transaction-timeout explanations
  are code diagnoses. The table has no observed late response reverting text or timed screening
  failure. Attach the baseline evidence for whichever persistence failure drives the fix.
  `_bmad-output/implementation-artifacts/spec-7-4-community-post-edits-persist.md:32`
- **Low. The native and screening tests leave specific contract gaps.** The native mocked flow
  verifies the Latest card badge and the editor outcomes. It lacks an already-open second client,
  a stale Spotlight read and an Edited assertion in native detail. The status-bar tests assert
  inline messages that render independently of the provider. The paused-screening tests
  cover revocation, sanction and competing edits. The sanction test inserts a row directly,
  leaving the production ban lock path outside that test. The test named unbound supplies a
  wrong hash and never checks missing binding, a wrong locale, or a wrong policy version. The
  outage test injects a repository exception. The browser outage response is also stubbed.
  `apps/mobile/src/test-utils/community-screen/publishing.cases.tsx:27`,
  `apps/mobile/components/community/community-post-text-editor.test.tsx:90`,
  `apps/api/integration/community-post-text-http.integration.spec.ts:222`,
  `apps/api/integration/community-post-text-http.integration.spec.ts:277`,
  `apps/api/integration/community-post-text-http.integration.spec.ts:331`,
  `apps/api/integration/community-post-text-http.integration.spec.ts:385`

## Acceptance coverage

| AC  | Result                        | Evidence                                                                                                                                                                                                                                         |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Recorded with a proof gap     | The phone-width sequence and root-cause record exist. The table demonstrates missing feedback. See the AC 1 verification finding for the missing failure trace.                                                                                  |
| 2   | Partial                       | Real HTTP title-only, caption-only and combined writes passed. Chromium verified live readback in an already-open second browser using the author's account. The Spotlight and buffer races remain. Native was exercised with component tests.   |
| 3   | Partial                       | Both editors map Saved, No changes, rejection, outage and 409 to distinct translations. Refusal/outage preserves the draft and approved text. All 20 locale catalogs provide the five outcomes. Blank stored captions still fail the no-op path. |
| 4   | Partial                       | Screening precedes the 7-second transaction. The locked checks and all three paused-screening tests remain effective. The decision metadata gap is finding 4.                                                                                    |
| 5   | Present for owner projections | Web rendering covers card and detail. Native Spotlight detail reuses the same CommunityCard that renders the badge. Stale Spotlight results can still revert it. Revision visibility stays owner-only.                                           |
| 6   | Partial                       | Both Chromium cases and API integration passed. The original combined-editor reload assertion is weakened, and the delayed stale-read test does not demonstrate its regression.                                                                  |

Ordinary web and mobile feed and detail requests invalidate their request generations before
applying a realtime text change. The shared sync transport also orders available target
projections by `communityRevision`. The independent Spotlight and buffer paths above fall
outside those guards.
`packages/api-client/src/community-sync-state.ts:243`,
`packages/api-client/src/community-sync-state.ts:300`

## Codex Security pass

No standalone vulnerability met the reporting threshold. The internal decision-binding and
screening-work limits warrant follow-up. [Codex Security scan report](/private/var/folders/3b/5kzs662j47v6vdz26gbkvlgc0000gn/T/codex-security-scans/couture-cast-epic7/d580f1175e99_20261122T180838Z/report.md)

- **Authentication, ownership, consent and sanctions.** The guarded PATCH gets the actor from
  authenticated request context and accepts only title, caption and base revision. The route
  returns a private, no-store response. The transaction holds the subject, member, post guard
  and row locks, then rechecks subject availability, eligibility, guardian participation,
  active sanctions, ownership, publication state, revision, unchanged text and rolling quota.
  Production guardian revocation and moderation bans share the subject guard. A rejected
  write records a withheld event and leaves approved content and revision intact.
  `apps/api/src/modules/community/community.controller.ts:395`,
  `apps/api/src/modules/community/community.repository.ts:909`,
  `apps/api/src/modules/community/community-access.service.ts:163`,
  `apps/api/src/modules/guardian/guardian.service.ts:751`,
  `apps/api/src/modules/moderation/moderation-decisions.service.ts:660`
- **Screening and disclosure.** The server selects the policy and reads the stored post locale.
  Edited text renders as text and the UI maps errors to localized copy. Owner revision is omitted
  from other viewers' API projections, and client session changes clear prior state. An owner
  can still see a cached Edited badge on a refreshed nonpublic item because the helper treats an
  omitted revision as stale. The editor still requires a published post. The diff
  did not establish a cross-tenant write, owner-only revision disclosure, or public screening
  bypass. See finding 4 for the internal decision checks that should fail closed.
  `apps/api/src/modules/community/community.service.ts:193`,
  `packages/api-client/src/contracts/http/community.ts:688`,
  `apps/api/src/modules/community/community-post-text.ts:43`,
  `apps/web/src/app/components/community-lookbook-grid.tsx:3058`,
  `apps/mobile/src/features/community/community-screen.tsx:1018`
- **Quota and screening work.** The locked count caps approved and withheld attempts at ten per
  member per rolling hour. The pre-screen count sees only recorded attempts. Concurrent requests
  can therefore all start screening while one revision or quota slot is still available, even
  when their writes later receive 409 or 429. The durable cap holds. A separate bound on in-flight
  screening would preserve the shorter transaction and restore a limit on screening work.
  Request fields and individual screening work are bounded. Shared-service impact and deployed
  edge throttling were not verified.
  `apps/api/src/modules/community/community.repository.ts:859`,
  `apps/api/src/modules/community/community.repository.ts:929`,
  `apps/api/src/modules/community/community.repository.ts:1492`,
  `apps/api/src/modules/community/community-post-text.ts:73`

## Checks run

- **424 Vitest tests passed.** Contract 32, web editor 13, mobile editor/screen/Spotlight 215,
  API moderation and guardian lock 108, API HTTP and sync integration 35, and locale parity 21.
  The story command names a missing Vitest config. The integration run used the API workspace
  config at `apps/api/vitest.config.ts`.
  `_bmad-output/implementation-artifacts/spec-7-4-community-post-edits-persist.md:128`
- **Both Chromium cases passed** with a dedicated local PostgreSQL database and local Supabase
  Storage credentials. The first run failed before reaching edits because Storage refused upload
  allocation. The passing run used the same source revision and corrected local credentials.
- The diff has no whitespace errors. Security candidate assessment used static tracing and
  existing tests. Native coverage used mocks and no device or emulator run.
