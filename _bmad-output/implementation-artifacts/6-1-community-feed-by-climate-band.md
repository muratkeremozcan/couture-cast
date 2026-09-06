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
