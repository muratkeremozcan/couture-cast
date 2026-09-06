---
title: 'Story 6.1: Community feed by climate band'
type: 'feature'
created: '2026-09-05'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: '55ab7998a97959b2c0bae9542324b5bb35f01af7'
story_key: '6-1-community-feed-by-climate-band'
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent; do not modify unless human renegotiates">

## Intent

**Problem:** Style explorers need climate-relevant community inspiration, yet the current draft can
expose private fields, lose posts during moderation and pagination, strand uploads, and enable a beta
without the safety, consent, accessibility, and operations controls promised by the PRD.

**Approach:** Deliver one gated community loop across web and mobile: climate-aware browsing,
accessible post creation, production screening, reporting, weekly challenge participation, and a
measured beta. Use REST projections for public data and durable state transitions for every job.

## Boundaries & Constraints

**Always:** Use one six-value `CLIMATE_BANDS` tuple with parity tests across Prisma, Zod, generated
clients, and Socket.io. Resolve bands from `fresh` or `cached` weather under 60 minutes old. Use
`published_at,id` public cursors bound to filter mode. Keep authors pseudonymous. Enforce active
guardian consent for public posts by members aged 13 through 15. Generate an editable alt-text
suggestion and require confirmation. Screen caption and alt text in the resolved locale. Hide content
before deleting objects. Retain anonymized moderation audit metadata for 12 months. Keep production
read and write rollout controls disabled until the beta gate passes.

**Ask First:** Change climate thresholds, publish real profile names, retain raw content after account
erasure, change ADR-013 moderation technology, or advance production rollout state.

**Never:** Expose cross-user `LookbookPost`, `CommunityChallenge`, or `ModerationEvent` table rows to
authenticated clients. Put user IDs in object paths or signed URLs. Permit client-controlled lifecycle
fields. Infer wetness for legacy rows. Publish unconfirmed alt text or unscreened content. Use active
chips without defined server behavior. Hand-edit generated clients.

## I/O & Edge-Case Matrix

| Scenario            | Input / State                                                          | Expected Output / Behavior                                                                                                  | Error Handling                                                                                                   |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Band resolution     | Ordered locations and valid override                                   | `auto`, `all`, or named band; override controls challenge selection                                                         | Unknown override `400`; stale, malformed, or fewer than three usable unique days returns all regions with reason |
| Classification      | Finite `min <= max`; precipitation probability `0..1` or amount `>= 0` | Deduplicate `localDate`; days missing usable precipitation are excluded; legacy values map to `null`                        | Fewer than three usable days returns `null`                                                                      |
| Feed page           | Published posts plus author-owned private states                       | Public rows use `published_at,id`; author states use a separate section; cursor embeds filter mode                          | Changed filter discards cursor and late response; malformed cursor returns stable `400`                          |
| Media access        | URL expired, post withdrawn, consent suspended, or post flagged        | Refetch expired URLs; takedown moves or deletes the object and invalidates feed caches                                      | Removed content renders a localized notice                                                                       |
| Upload              | Retried allocate, byte upload, or publish                              | Replay matching payloads; expose upload status; orient, decode, re-encode, then persist checksum and MIME                   | Mismatched replay `409`; expiry sweep deletes abandoned objects                                                  |
| Rate limit          | Parallel submissions around rolling 24-hour boundary                   | Atomically count accepted submissions in `(now-24h, now]`; cap at ten                                                       | Eleventh submission returns `429` with retry time                                                                |
| Moderation          | Duplicate jobs, engine disagreement, timeout, or exhausted retry       | Transactional outbox; deterministic job ID; record both engine results; terminal `published`, `flagged`, or `review_failed` | Fail closed, alert operations, and show author recovery state                                                    |
| Report              | Visibility race, duplicate request, changed reason, or self-report     | Insert from a visible row transactionally; unique reporter and post record; snapshot and SLA clock persist                  | Invisible `404`; changed reason `409`; abuse limit `429`                                                         |
| Consent and erasure | Consent revoked, author withdraws, or account deleted                  | Hide immediately; block new posts; durable object deletion; anonymize retained audit fields                                 | Fresh consent requires resubmission; deletion completes within 72 hours                                          |
| Challenge           | Monday seven-day IANA-zone window and preselected CTA                  | Associate eligible submission with challenge; retain association after close; count unique published participants           | Invalid window `400`; transactional overlap `409` including global rows                                          |
| Client race         | Filter changes, deep link outside first page, or moderation completes  | Cancel stale requests; resolve visible target directly; poll owned post until terminal                                      | Invisible target falls back with localized banner                                                                |
| Analytics           | Retry or telemetry outage                                              | Closed-enum, exactly-once events; core requests continue                                                                    | Record bounded operational failure without sensitive payloads                                                    |

</frozen-after-approval>

## Code Map

- `_bmad-output/project-knowledge/{couturecast_brief,couturecast_roadmap}.md`:
  release authority; Community Beta is Phase 2 and requires safety sign-off.
- `_bmad-output/planning-artifacts/{prd,epics,architecture}.md`: align Phase 2 labels; preserve ADR-013.
- `packages/utils/src/climate-band.ts`: current uncommitted classifier; add date, ordering,
  precipitation, and parity invariants.
- `packages/db/prisma/schema.prisma` and
  `packages/db/prisma/migrations/20260905120000_add_community_feed_and_challenges/migration.sql`:
  current uncommitted model; replace unsafe cascades and public table grants, add challenge,
  moderation, alias, outbox, erasure, and lifecycle fields.
- `packages/db/test/rls/{harness,policy-matrix.spec,community-posts.spec}.ts`: prove API-only
  cross-user access and protected lifecycle columns through the real actor matrix.
- `packages/api-client/src/contracts/http/community.ts`: canonical REST inputs, projections, errors,
  cursors, rollout states, and challenge payloads; generated output stays tool-owned.
- `packages/api-client/src/types/{socket-events,analytics-events}.ts`: tuple parity and closed event
  schemas with deduplication keys.
- `apps/api/src/modules/community/`: controller, service, repository, upload, moderation, challenge,
  report, outbox, cleanup, and alias ownership.
- `apps/api/src/modules/weather/weather-query.service.ts`: reuse the 60-minute freshness union.
- `apps/api/src/modules/guardian/guardian.service.ts`: reuse age and consent rules; add revocation
  suspension handoff.
- `apps/api/src/modules/wardrobe/`: reuse validation, storage, FashionCLIP, and worker lifecycle
  patterns. The silhouette heuristic is excluded from community content-safety decisions.
- `apps/web/src/app/components/community-lookbook-grid.tsx` and
  `apps/mobile/app/(tabs)/community.tsx`: replace mock data, wire defined filters, reports, withdrawal,
  status polling, challenge CTA, deep-link resolution, localization, and accessibility.

## Tasks & Acceptance

**Execution:**

- [x] `_bmad-output/project-knowledge/couturecast_brief.md`,
      `_bmad-output/project-knowledge/couturecast_roadmap.md`,
      `_bmad-output/planning-artifacts/prd.md`, `_bmad-output/planning-artifacts/epics.md`, and
      `_bmad-output/implementation-artifacts/epic-6-context.md`: align phase labels, source ranges,
      launch gates, and scope language.
- [x] `packages/utils/src/climate-band.ts`, `packages/db/prisma/schema.prisma`, the Story 6.1
      migration, and `packages/db/test/rls/community-posts.spec.ts`: harden classification, API-only
      RLS, private opaque storage, lifecycle, challenge, audit, outbox, erasure, and factory support.
- [x] `packages/api-client/src/contracts/http/community.ts`,
      `packages/api-client/src/types/socket-events.ts`, and
      `packages/api-client/src/types/analytics-events.ts`: define contracts first; regenerate OpenAPI
      and SDK; add parity, bounds, idempotency, projection, and analytics tests.
- [x] `apps/api/src/modules/community/`: implement climate feed, upload recovery, local alt suggestion,
      ADR-013 image screening, multilingual text screening, moderation/report handoff, challenges,
      withdrawal, erasure, and separate read/write rollout controls.
- [x] `apps/web/src/app/components/community-lookbook-grid.tsx` and
      `apps/mobile/app/(tabs)/community.tsx`: deliver identical localized states; disable future
      filters; preserve hero independence and deep-link focus behavior.
- [x] `apps/api/integration/`, `apps/web/e2e/`, `apps/mobile/e2e/`, and affected package test paths:
      add Pact, PostgreSQL integration, Playwright, Maestro, axe, model smoke, and k6 coverage for
      every matrix row, worker retry, actor boundary, and beta gate.

**Acceptance Criteria:**

- Given any matrix scenario, when its boundary is exercised, then the stated behavior and error are
  proven at the closest deterministic test tier.
- Given a cross-user database client, when it queries or mutates community tables, then it receives
  no protected row or lifecycle access while the API returns the allowlisted projection.
- Given publication and concurrent feed paging, when moderation completes, then the post appears once
  under `published_at,id` ordering.
- Given a teen consent change, withdrawal, report, moderation failure, or account erasure, when the
  transition commits, then visibility changes atomically and durable work completes idempotently.
- Given an eligible challenge submission, when screening publishes it, then the association and one
  participation event persist.
- Given local or test data, when seeded, then both positive paths are reachable; production remains
  `off` until moderation staffing, SLA alerts, privacy, deletion, localization, accessibility, model,
  and rollback evidence are signed.
- Given the beta experiment, when 1,000 eligible viewers complete two weeks, then climate matching
  advances only with at least 10% relative non-self card-open lift and a 95% confidence interval above
  zero; unresolved bands stay at or below 15% and empty feeds below 5%.

## Spec Change Log

Decisions taken during remediation that the frozen Intent, Boundaries and Matrix did not
pin down. None of them changes a frozen requirement; each records how an ambiguous
requirement was resolved.

- **Filter mode is one parameter, not two.** The matrix names `auto`, `all` and a named
  band as three outcomes, and the original contract expressed only an optional
  `climateBand`, under which an absent value meant `auto` and `all` was unrequestable. The
  feed now takes a single `mode` parameter over an eight-value enum (`auto`, `all`, and the
  six `CLIMATE_BANDS`). Without a requestable `all` the beta experiment's 50/50 assignment
  between `auto` and `all` cannot be run at all.
- **Author states are a separate response section.** The matrix says public rows use
  `published_at,id` and author states use a separate section. A draft has no `published_at`
  to keyset on, so the two cannot share a cursor. `items` now carries published rows only
  and `authorStates` is an unpaginated array of the caller's own non-published rows.
- **Alt-text confirmation is enforced by the type, not by a check.** `altTextConfirmed` is
  `z.literal(true)` rather than a boolean. The spec forbids publishing unconfirmed alt
  text, and a boolean would put the whole guarantee in a server-side check that a direct
  API caller could reach with `false`.
- **Precipitation is required per day, never inferred.** The Classification row lists
  probability `0..1` or amount `>= 0` without saying whether a day missing both is usable.
  It is not. A legacy row carrying no precipitation was being counted as a dry day, which
  both inflated the wet-ratio denominator and inferred wetness for legacy rows, an explicit
  Never. A day is usable when at least one precipitation signal is present and in range.
- **Rate limiting uses an advisory lock, not a quota table.** The matrix requires an atomic
  count over the rolling `(now-24h, now]`. A fixed-bucket quota row keyed on a window start
  cannot express a rolling window and would admit twenty submissions around a boundary,
  which is the exact scenario the row names. Submissions carry `submitted_at` and the
  publish transaction opens with `pg_advisory_xact_lock` on the user, serialising one
  author's submissions without serialising the table.
- **Reports moved to their own table.** Report uniqueness had been imposed on
  `ModerationEvent` via `UNIQUE (post_id, flagged_by_id)`, which capped the moderation log
  at one row per actor per post and made it non-append-only. `CommunityPostReport` now owns
  the reporter uniqueness, the content snapshot and the SLA clock, and `ModerationEvent`
  returns to append-only with `post_id` set null on erasure so a third party's report
  survives the author's account deletion.
- **Rollout is two controls.** The spec asks for separate read and write rollout. The
  single `community_feed_enabled` flag became `community_read_enabled` and
  `community_write_enabled`, both defaulting false, so the beta can open reading to a
  cohort while posting stays shut, and closing posting after an incident does not dark the
  feed for everyone already reading.
- **Analytics gained the events the beta gate needs.** The advance condition is a non-self
  card-open lift, which no event could measure, and the guardrails need an empty-feed
  signal and an arm label. `community_card_opened` carries `isSelf` and the variant;
  `community_feed_viewed` gained `itemCount`, `isEmpty`, `filterMode` and the variant, and
  its band is the viewer's resolved band rather than the requested filter. Every community
  event carries a `dedupeKey`, because the moderation pipeline emits from a retrying BullMQ
  job and a double-counted publication corrupts a gate input.
- **Band resolution walks the ordered locations.** The matrix input is "ordered locations";
  the implementation read only the first. It now walks the list until one classifies.
- **The 90-day moderation retention figure in the PRD is superseded.** Planning material
  carried both 90 days and 12 months. The PRD line now states the 12-month floor and
  records that the shorter figure is superseded, so a compliance reader reaches the same
  answer as an implementer.
- **Image screening fails closed, and nothing publishes automatically.** ADR-013 names a
  TensorFlow.js NSFW model, and neither `nsfwjs` nor `@tensorflow/tfjs-node` is a
  dependency of this repository. Adding one is the story's own ask-first item, so it was
  not added. `UnavailableNsfwImageScreener` returns `passed: false` with reason
  `screening_unavailable` and engine version `adr013-nsfw-unavailable`, and
  `DefaultCommunityModerationEngine` takes an injected `NsfwImageScreener` so the real
  model drops in through the constructor with no other change. **The consequence, stated
  plainly: every post now terminates at `flagged` for human review rather than reaching
  `published`.** That is correct behavior for an unavailable screener and it is one of the
  eight signatures the beta gate requires. A second fail-open was found in the same place
  and fixed: the combined verdict was derived from the reason list, so a screener that
  refused without naming a reason read as a pass.
- **Realtime announcement of a new post belongs to Story 6.2, not 6.1.** The matrix's
  client-race row asks for direct resolution of a visible target and polling of an owned
  post until terminal, and `GET /api/v1/community/posts/{postId}` serves both. Story 6.1's
  only Socket.io obligation is `CLIMATE_BANDS` tuple parity, which the contract satisfies
  and `community-socket-parity.spec.ts` proves. No production code emits `lookbook:new`
  today; wiring that emit is 6.2's work alongside reactions and comments. Recorded as a
  boundary so the absence is a decision rather than an oversight.
- **`mediaUrls` was removed from the `lookbook:new` socket payload.** A URL broadcast over
  the socket carries no expiry and no revocation path, so a takedown cannot reach one
  already pushed to a client, which contradicts both "refetch expired URLs" and "hide
  content before deleting objects". The payload is now `.strict()`, because a plain
  `z.object` strips unknown keys and would have let a producer believe it had delivered a
  media URL that was silently discarded.

## Design Notes

`draft -> uploading -> pending_review -> published | flagged | review_failed -> withdrawn`.
`consent_suspended` hides a published post and requires author resubmission after fresh consent.
The experiment uses stable 50/50 assignment between `auto` and `all`. Revisit thresholds when the
advance condition fails, any guardrail fails, or one band trails control by 20%.

## Verification

**Commands:**

- `npm run generate:api-client && npm run optic:lint`: generated contract and OpenAPI checks pass.
- `npm run verify:changed`: changed workspace checks pass.
- `npm run validate`: full typecheck, lint, test, and build gate passes.
- `npm run test:pact`: consumer determinism over three runs, then provider verification.
- `npm run test:pw-local`: web journeys pass against the local stack.
- `npm run test:pw:burn-in-changed`: changed Playwright specs pass three consecutive
  times with no retries, which is what gates the E2E job.
- `npm run test:mobile:e2e:android`: Maestro flows pass. Android only, by project
  decision; iOS coverage stays local and is not a CI target.
- `npm run test:k6:local`: k6 smoke thresholds hold.

Corrected on 2026-09-05: this section previously named `npm run test:e2e:mobile`, which
is not a script in this repository. The mobile entry point is
`npm run test:mobile:e2e:android`. Pact, burn-in and k6 were absent and are all tiers
this story's own task list requires.

## Code Review Findings

Produced by `/bmad-code-review` on 2026-09-06 over the whole story branch. Four
review layers ran (blind hunter, edge case hunter, verification gap, acceptance
auditor); all four returned and none failed. The diff was reviewed in two
passes because it exceeded the workflow's chunking threshold by roughly sixteen
times: groups A and B (`packages/db`, `packages/utils`, the HTTP contracts,
`apps/api`) against baseline `55ab7998`, then groups C, D and E (web and mobile
clients, the outer test tiers, the generated artifacts) against the working tree
at `a2cf8ba5` and later.

Owners are `w-api` for `apps/api`, `w-tests` for the test tiers, `f3` for the
contracts and the clients, and `w-review` for the contract documentation set.

### Pass one: groups A and B

Nine findings rated high. Six were closed while the review was still running and
were re-verified in code before this record was written.

| ID   | Severity | Finding                                                                                                                                                                           | Owner | Disposition                                                                                                                                                                                                                                                                     |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AB-1 | high     | Guardian consent revocation never hid published posts; `consent_suspended` had no producer                                                                                        | w-api | Closed. `guardian.service.ts:813-822` now suspends `published` and `pending_review` inside the revocation transaction                                                                                                                                                           |
| AB-2 | high     | `erasure_requested_at` had no producer, so the whole erasure sweep was unreachable                                                                                                | w-api | Partly closed. `community.repository.ts:272` `withdrawPostAndRequestErasure` stamps the clock on withdrawal. `requestAccountContentErasure` (`community.service.ts:1161`) still has no caller outside specs, so the account-deletion half of the matrix row remains unreachable |
| AB-3 | high     | `EngagementEvent` kept `authenticated` grants and self-only RLS policies while `LookbookPost` was locked down, giving a post-id existence oracle through its required foreign key | w-api | Closed. `migration.sql:379-385` revokes the grants and drops all four policies                                                                                                                                                                                                  |
| AB-4 | high     | `community_card_opened` had no HTTP route, and its dedupe key omitted the viewer                                                                                                  | f3    | Route closed (`community.controller.ts:244`) and the key is now `${postId}:${userId}`. The client half is open; see C-F2                                                                                                                                                        |
| AB-5 | high     | The age gate returned early unless the role claim was exactly `teen`                                                                                                              | w-api | Closed. `assertWardrobeUploadAllowed` now resolves age from the stored profile for every caller                                                                                                                                                                                 |
| AB-6 | high     | Reporting and withdrawal were gated on `community_write_enabled`, so an incident that closed posting also closed abuse reporting and author self-removal                          | w-api | Closed. Both call `assertReadEnabled` (`community.service.ts:1034`, `:1099`)                                                                                                                                                                                                    |
| AB-7 | high     | No moderation resolution or takedown path existed anywhere                                                                                                                        | w-api | Closed by `community-moderation.actions.ts`                                                                                                                                                                                                                                     |
| AB-8 | high     | A passing verdict wrote no `ModerationEvent`, and `content_snapshot` was declared on both audit tables and never written                                                          | w-api | Closed by `community-audit-snapshot.ts`                                                                                                                                                                                                                                         |
| AB-9 | high     | The feed cursor bound the filter mode and not the resolved band, so under `auto` a band change between pages re-filtered the page under a stale keyset                            | f3    | Closed. The cursor payload carries `band`. Note that closing it made a 400 reachable in ordinary reading, which is C-F4                                                                                                                                                         |

Twenty-three medium findings and a low tail were also raised in that pass. The
ones being fixed on the branch are folded into the table below where they
overlap; the ones that are not are recorded in `deferred-work.md` under
"Deferred from: code review of 6-1-community-feed-by-climate-band (2026-09-06)".

### Pass two: groups C, D and E

Twenty-six findings, eight rated high. Nothing is deferred; all twenty-six are
being fixed on this branch.

| ID    | Severity                | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Owner        | Disposition                                                                         |
| ----- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------- | --- | -------- |
| C-F2  | high                    | `community_card_opened` still has no producer. The route and SDK operation exist, but neither client wraps them and neither card carries a click or press affordance (`community-lookbook-grid.tsx:672`, `community-card.tsx:262`). AC 7's advance condition cannot rise above zero                                                                                                                                                                                               | f3           | Assigned                                                                            |
| E-1   | high                    | The generated SDK types four nullable community fields as non-null (`generated/models/index.ts:1629`, `:1972`, `:2152`, `:2518`). Regenerating does not fix it: openapi-generator 7.21.0 drops `null` from OpenAPI 3.1 `type: [object, "null"]` for object nodes while handling scalars correctly. Seven nodes repository-wide. `packages/api-client/src/index.ts:35` re-exports `./generated` without the community contract types, so the wrong type wins from the package root | f3           | Assigned                                                                            |
| C-F1  | high                    | The age-gate 403 message both clients classify on is never sent. Every refusal is `GUARDIAN_CONSENT_REQUIRED`, so consent refusals render as a generic error and `community.error.ageGate` is unreachable in all ten locales. The tests on both surfaces construct the message themselves, so they are vacuous                                                                                                                                                                    | w-api and f3 | Assigned                                                                            |
| C-F4  | high                    | A 400 invalid cursor classifies as `unknown` and never restarts paging. Closing AB-9 made this reachable without tampering, because the resolved band is derived per request from weather guaranteed fresh for only 60 minutes. Mobile re-fires the dead cursor on `onEndReached` at threshold 0.5, which is an unbounded loop                                                                                                                                                    | f3           | Assigned                                                                            |
| D-1   | high, vacuous pass      | Pact provider verification of all three feed rejections cannot fail. `doubles/community.ts:281-295` implements `getFeed` as a zero-argument function that unconditionally rejects, and one state backs all three rows                                                                                                                                                                                                                                                             | w-tests      | Assigned                                                                            |
| D-2   | high, vacuous pass      | `6.1-API-01` never inspects an item, so the strict item-projection parse never runs against a real row. This is the tier Pact explicitly delegates non-leakage to. `assertSeededFeed` exists at `community-session.ts:99` with zero call sites                                                                                                                                                                                                                                    | w-tests      | Assigned                                                                            |
| C-F6  | high                    | Mobile lets an author confirm alt text and then rewrite it. Web resets confirmation on edit; `community-post-sheet.tsx:558` does not. `z.literal(true)` still holds structurally while the guarantee it encodes is gone                                                                                                                                                                                                                                                           | f3           | Assigned                                                                            |
| C-F7  | high                    | The mobile card's outer `accessible` grouping makes the confirmed alt text unannounced and the Report and Withdraw controls unfocusable on iOS (`community-card.tsx:264-266`). The test asserts the nested prop rather than reachability, so it passes                                                                                                                                                                                                                            | f3           | Assigned                                                                            |
| C-F3  | medium                  | Neither client reads `feed.mode` or `feed.experimentVariant`, so a viewer in the `all` arm sees the `auto` chip labelled with their resolved band over an every-region feed                                                                                                                                                                                                                                                                                                       | f3           | Assigned                                                                            |
| C-F5  | medium                  | The band-unresolved banner renders on reason truthiness alone and `bandResolved` is read by neither client, so it appears under a pinned band where its text is false                                                                                                                                                                                                                                                                                                             | f3           | Assigned                                                                            |
| C-F8  | medium                  | "Resolve visible target directly" is unimplemented. Web discards the resolved `CommunityFeedItem` and focuses by element id, which is null past the first page; mobile renders a synthetic card from notification data and leaves `getCommunityPostFromMobile` with no production caller. Neither client polls an owned post until terminal                                                                                                                                       | f3           | Assigned                                                                            |
| C-F9  | medium                  | Four hardcoded English strings on the mobile deep-link card, pinned by `deep-link-handling.test.tsx:266` asserting them verbatim                                                                                                                                                                                                                                                                                                                                                  | f3           | Assigned                                                                            |
| C-F10 | medium                  | Four further web and mobile divergences against the identical-states requirement, including web's `item.altText ?? …` yielding `alt=""` where mobile's `?.trim()                                                                                                                                                                                                                                                                                                                  |              | ` falls back correctly                                                              | f3  | Assigned |
| C-F11 | medium                  | A 503 carrying `COMMUNITY_MEDIA_UNAVAILABLE_MESSAGE` classifies as `unknown` on both surfaces, with no catalog key                                                                                                                                                                                                                                                                                                                                                                | f3           | Assigned                                                                            |
| D-3   | medium, vacuous pass    | `6.1-INT-075`, described in its own comment as the control, passes over zero rows: `filter(...).toEqual([])` and `every(...).toBe(true)` are both vacuous on an empty second page                                                                                                                                                                                                                                                                                                 | w-tests      | Assigned                                                                            |
| D-4   | medium, wrong assertion | The query-plan predicate check is satisfied by the SELECT list. `toContain('published_at')` plus a detached `toContain('IS NOT NULL')` cannot detect loss of the predicate the file was rewritten to guard                                                                                                                                                                                                                                                                        | w-tests      | Assigned                                                                            |
| D-5   | medium, wrong assertion | `6.1-API-04`'s guard admits both legal values so it cannot fire, and its comment claims `auto` is never the effective mode when `auto` is one of the two arms                                                                                                                                                                                                                                                                                                                     | w-tests      | Assigned                                                                            |
| D-6   | medium, vacuous pass    | `6.1-E2E-04`'s axe scan waits only for `toBeAttached` on a grid the file itself documents as rendering with zero items and no layout box                                                                                                                                                                                                                                                                                                                                          | w-tests      | Assigned                                                                            |
| E-2   | medium                  | Withdraw throws `ConflictException('POST_NOT_WITHDRAWABLE')` and 409 was undocumented                                                                                                                                                                                                                                                                                                                                                                                             | w-review     | Fixed                                                                               |
| E-3   | medium                  | Report's and withdraw's 503 descriptions said "Community write rollout is disabled" while both call `assertReadEnabled`                                                                                                                                                                                                                                                                                                                                                           | w-review     | Fixed                                                                               |
| E-4   | medium                  | `GET /posts/{postId}`, `POST /posts/{postId}/opened` and `POST /posts/{postId}/withdraw` validate a required header or body and returned an undocumented 400                                                                                                                                                                                                                                                                                                                      | w-review     | Fixed                                                                               |
| E-5   | medium                  | Publish documented the challenge-not-found condition under 404 while the service throws 400                                                                                                                                                                                                                                                                                                                                                                                       | w-review     | Fixed                                                                               |
| E-6   | medium                  | Publish's 409 omitted the upload-not-completed condition                                                                                                                                                                                                                                                                                                                                                                                                                          | w-review     | Fixed                                                                               |
| E-7   | medium                  | The cursor parameter description and the feed 400 description were both silent about `band`                                                                                                                                                                                                                                                                                                                                                                                       | w-review     | Fixed                                                                               |
| E-8   | low                     | `openapi.ts:154-157` said eight community operations and listed eight; nine are registered                                                                                                                                                                                                                                                                                                                                                                                        | w-review     | Fixed. Version stays `1.6.0` because the ninth path is additive under the same bump |
| D-7   | low, wrong assertion    | `6.1-DB-001` is titled "in every status" and inserts four posts, but its assertion is a table-grant refusal raised before any row is considered, so the fixture cannot influence the outcome                                                                                                                                                                                                                                                                                      | w-tests      | Assigned                                                                            |

A separate process gap was raised and is recorded in `deferred-work.md` under
"Generated SDK freshness has no CI guard, unlike the OpenAPI document": the
OpenAPI document is protected by an equality test and `src/generated/**` is
protected by nothing.

### Verified clean

Recorded so a later reader does not re-open settled ground. Each of these was
attacked deliberately and held.

- **RLS posture.** API-only access on the owner connection, zero policies and
  zero grants to `anon` and `authenticated` on all six community tables, a
  private bucket with no client-facing storage policy, and opaque
  `community/<postId>/<random>.<ext>` object paths carrying no user id. The
  author's own row stays reachable through `getPost` and `authorStates`.
- **Keyset paging on its own axis.** A post published mid-page receives a newer
  `published_at`, so it is excluded from later pages rather than duplicated, and
  `nextCursor` is taken before the unsignable-media filter, so a dropped item
  does not skip rows.
- **The rolling rate limit.** One production writer of `submitted_at`, one of
  `pending_review`, the advisory lock genuinely the first statement of the
  transaction, and both early returns commit and release the lock.
- **Fail-closed screening.** No production path reaches a passing verdict. The
  fixture is double-gated on the environment variable and `allowsTestOnlySecrets()`,
  an unknown value throws at startup rather than falling back, and both
  non-runtime compositions default to `UnavailableNsfwImageScreener`.
- **Generated artifact freshness.** Nine operations, every schema, field, enum
  member and its order, default, bound and `additionalProperties` matched
  contract to OpenAPI JSON to SDK in both directions with zero divergence. The
  late `/opened` path and the `CommunityChallengeCopy` `additionalProperties`
  override both landed on all three carriers. No enum-null corruption in any
  community enum. No hand-editing under `src/generated/**`.
- **Client fundamentals.** `isSelf` is server-sourced everywhere and nothing
  compares ids client-side. Request cancellation on filter change is correct on
  both surfaces. Both MSW handler sets parse every fixture through the
  contract's own response schema, which closes fixture drift. Ten-locale
  `community.*` parity holds. `altTextConfirmed` is a genuine UI gate on both
  surfaces at the component layer.
- **Test tiers that hold.** `migration-hygiene.spec.ts` carries explicit
  non-vacuity floors on all three guards. `6.1-DB-034` was already repaired
  against this bug class and `6.1-DB-015` skips loudly. Every Maestro
  `assertNotVisible` id resolves to a real `testID`. The k6 community scenario
  requires at least one item and its thresholds are genuinely exercised.

### Could not check without executing

Recorded with the exact command, so whoever picks these up does not have to
reconstruct them.

- Whether `docs/http.openapi.json` is byte-identical to a fresh generate. Three
  converging signals say yes, and the equality spec at
  `testing/http-openapi.spec.ts:70-75` enforces it in the suite. To settle it:
  `npm run generate:api-client && git diff --stat -- packages/api-client/docs packages/api-client/src/generated`
- D-1 as a mutation test: `npm run test:pact` after deleting the mode comparison
  inside `safeDecodeCommunityFeedCursor`. Provider verification staying green is
  the defect.
- D-2 as a mutation test: `npm run test:pw-local -- playwright/tests/api/community-feed.api.spec.ts`
  against a database with `LookbookPost` truncated. `6.1-API-01` staying green
  over an empty feed is the defect.
- C-F7's runtime half needs TalkBack on Android or a manual iOS VoiceOver pass.
  The code and the React Native grouping contract are verified; the announced
  output is not.
- Whether the `EngagementEvent` grants are live in the deployed database rather
  than only in the migration DDL:
  `npm run test --workspace packages/db -- test/rls/policy-matrix.spec.ts`
- Prisma's transaction timeout behaviour under `pg_advisory_xact_lock`
  contention, specifically whether concurrent same-user submissions surface as
  the documented 429 or as a P2028 500.
