---
title: 'Story 6.3: Curated reactions'
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: '427b26c7772bcf157afcd3ec3b26273968543cd2'
route: 'dispatch'
story_key: '6-3-curated-reactions'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent">

## Intent

Members can react to public looks using Applaud, Love, and Inspired, the owner's selected palette.
Deliver persistent selection, exact counts, and accessible controls.

## Boundaries & Constraints

IDs `applause`, `love`, `inspiration` render clapping hands, heart, sparkles.
One current reaction per member/post, including authors; tapping the selected emoji removes it.
Add/replace requires authentication, age 13+, existing under-16 consent, and both community flags.
Removal requires authentication and the read flag, permitting retraction during posting freezes/consent loss.
All mutations require public visibility; hidden owner detail exposes no reaction summary.
Consent revocation removes that member's counted votes atomically. Erasure removes reaction data.
Keep production flags disabled. Realtime, pushes, ranking, and comments belong to later stories.
Preserve installed strict-schema clients through opt-in feed/detail reaction fields.

## I/O & Edge-Case Matrix

| State/input                                  | Result                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Selection/replacement/removal                | Atomically set desired state; return all three counts, total, viewer choice, revision |
| Duplicate accepted mutation ID               | Return current state without reapplying or emitting analytics                         |
| Delayed first attempt or stale base revision | Conflict with current state; preserve newer choice                                    |
| Retained mutation ID with changed payload    | Conflict; unchanged state                                                             |
| Concurrent writes                            | Unique member/post state; coherent aggregate snapshot                                 |
| Invalid input/auth/eligibility               | Stable localized refusal                                                              |
| Hidden/deleted post                          | Mutation 404; no public summary                                                       |
| Network failure                              | Keep confirmed counts and retry identity; accessible recovery                         |

</frozen-after-approval>

## Code Map

- `packages/api-client/src/contracts/http/community.ts`: strict legacy schemas; current clients reject extra fields.
- `apps/api/src/modules/community/community.repository.ts`: public predicate, post/advisory locks; service projects feed/detail and applies flags/consent.
- `apps/api/src/modules/community/community-analytics.ts`: HMAC helpers; telemetry dedupe properties currently enforce no uniqueness.
- `apps/api/src/modules/guardian/guardian.service.ts`: authoritative consent and revocation; moderation, maintenance, withdrawal, cascades also change visibility.
- `apps/web/src/app/components/community-lookbook-grid.tsx`: real feed at `/`, shared live region.
- `apps/mobile/components/community/community-card.tsx`, `apps/mobile/src/features/community/community-screen.tsx`: native controls/state; preserve independently focusable children.
- `packages/db/test/rls/community-posts.spec.ts`: API-only tables. Current server feed/highlight caches do not exist.

## Tasks & Acceptance

**Execution:**

- [x] `packages/db/prisma/schema.prisma` and new migration: add unique nullable reaction state with persistent member/post revision, payload-bound receipts, analytics outbox, RLS, cascade cleanup, indexed aggregation. Retain receipts 30 days; stale revisions protect later retries. Cap new mutation IDs at 60/member/minute; accepted retries bypass quota.
- [x] `packages/api-client/src/contracts/http/community.ts`, `packages/api-client/src/client.ts`: define `PUT /api/v1/community/posts/:postId/reaction` with desired selection/null, UUID, base revision, and authoritative response. Negotiate feed/detail fields through `x-couture-reactions: 1`; absent header preserves legacy strict shape. Regenerate SDK/OpenAPI.
- [x] `apps/api/src/modules/community/community.repository.ts`, `apps/api/src/modules/guardian/guardian.service.ts`: share member advisory-lock then post-lock order; check eligibility inside transaction, compare revisions, replay receipts, withdraw votes on consent loss. Batch counts/viewer state from one snapshot; retain null-state revision after removal.
- [x] `apps/api/src/modules/community/community.service.ts`, `community.controller.ts`, `community.module.ts`: wire authorization, mutation, negotiated projections, private/no-store responses.
- [x] `packages/db/prisma/migrations/`: maintain per-post generation/invalidation on reactions and every visibility/erasure path, including cascades. Document its future Story 6.6 cache contract; current reads stay uncached. Erased posts purge reactions/receipts even when post rows survive.
- [x] `packages/api-client/src/types/analytics-events.ts`, `apps/api/src/modules/telemetry/telemetry.service.ts`, community analytics/maintenance scheduler: dispatch outbox added/replaced/removed events with bounded retry/backoff, stable sink insertion IDs, server-computed self flag, HMAC identity, canary exclusion. Preserve committed reactions during outages; purge delivered payloads after 30 days.
- [x] `apps/web/src/lib/community.ts`, `apps/mobile/src/lib/community.ts`: negotiate capability, validate responses, retain retry IDs/base revisions, reconcile conflicts.
- [x] Web/mobile card/screen paths above: labeled toggle controls, counts, selected/pending states, stale-response rejection, retries, hidden-post eviction, synchronized deep-link copies, mobile haptics, 44px targets.
- [x] `apps/web/src/i18n/locales/*.json`, `apps/mobile/assets/locales/*.json`, `packages/testing/src/factories/community.factory.ts`: all ten locales and deterministic fixtures.
- [x] `apps/api/integration/community-reactions.integration.spec.ts`, existing RLS and colocated API/client/UI tests: matrix, legacy compatibility, age/consent races, quota, delivery recovery, erasure.
- [x] `pact/http/consumer/interactions/community.ts`, provider doubles, `playwright/tests/community-reactions.spec.ts`, `maestro/community-feed.yaml`: contract and add/replace/remove/reload journeys, keyboard and accessibility.

**Acceptance Criteria:**

- Given concurrent writes and delayed requests, when they settle, then counts equal durable rows and older intent cannot restore a removed reaction.
- Given consent/visibility/erasure changes, when committed, then affected counts and per-post generations change atomically and hidden content disappears on refresh.
- Given installed clients and supported locales, when loading/reacting, then legacy feeds parse and new accessible controls enforce eligibility and recovery.
- Given analytics outages/retries, when delivery resumes, then each changed mutation has one privacy-safe event and user actions remain committed.

## Implementation Notes

The following evidence records iteration 0. Re-run verification for iteration 1.

- 2026-10-18: Implemented and audited the complete staged diff against baseline.
  Approved intent SHA-256 remains `961ebb22b7fc955dac003a9688dae74d347495ebb60885794a0fe316f1932378`.
- Guardian grants, revocations, and mutations share the member lock. The reproduced
  revocation snapshot race requires ReadCommitted after lock acquisition.
- Acknowledged sink delivery retains stable UUID and occurrence time through outages.
  Current public reads remain uncached; the migration documents future per-post cache validation.
- Matrix audit: all eight rows have passing coverage. The 12 real-DB reaction tests cover
  transitions, receipts, stale intent, concurrency, quota, age/consent, visibility, and erasure.
  Controller/guard/contract suites cover malformed requests and authentication.
  Web MSW and real Playwright cover network recovery; native Maestro covers add/replace/relaunch/remove.
- Verification: full validate passed 6,204 tests and unchanged coverage thresholds, lint,
  types, formatting, and builds. verify:changed passed all six affected workspaces.
  API integration passed 480 tests; RLS passed nine; deterministic Pact and provider verification passed.
  Playwright passed two journeys with axe; iOS Maestro passed its full Community flow.
- Evidence logs: `/tmp/story63-validate-final.log`, `/tmp/story63-verify-changed-final5.log`,
  `/tmp/story63-api-integration-final2.log`, `/tmp/story63-rls-final.log`,
  `/tmp/story63-pact-final.log`, `/tmp/story63-playwright-layout-final.log`,
  `/tmp/story63-maestro-final5.log`. Local migration applied; production flags remain disabled.

### Iteration 1 evidence

- 2026-10-18: Rebuilt reaction request ownership around one screen-owned coordinator per
  platform. Cards and highlighted/detail copies share pending requests, retry payloads,
  confirmed snapshots, omission barriers, and visibility fences. Earlier reads and mutation
  results cannot restore reactions after an authoritative omission or 404. Both withdrawn
  and published owner payloads with omitted summaries have screen regression coverage.
- Deep-link focus runs once per target. Native headers retain their element identity through
  refreshes; controls wrap for large counts and text. Web feedback is available inside the
  modal. Browser checks cover selected text and focus contrast in all four themes, in both
  light and dark modes. Nearby community badge and action contrast failures were repaired.
- Feature-flag evaluations finish before repository entry. Authoritative consent stays under
  the member lock. The actual decorated HTTP route accepts revoked-teen retraction and
  refuses participation. Report visibility checks now require and select erasure fields.
- Reaction analytics use committed 30-second leases, delivery outside database transactions,
  conditional settlement, a one-second sweep budget plus one bounded send, and safe failure
  reason/attempt/age logs. Real database tests prove one-connection delivery recovery,
  expired-lease recovery, an untouched second due row after the sweep deadline, and a
  delivered row through the runtime sweep.
- Full `validate` passed 6,238 tests, unchanged coverage thresholds, types, lint, formatting,
  and builds before the final owner-omission edge correction. `verify:changed` passed all six
  affected workspaces. After that correction, API-client coverage passed 823 tests
  (99.84% statements, 98.76% branches, 100% functions, 99.83% lines); web screens passed 98
  tests and native screens passed 70. Final client/web/mobile types, changed-file lint, and
  the asynchronous flag-completion/order regression test passed. The final root quality
  rerun belongs to the review handoff.
- SDK/OpenAPI generation, deterministic Pact/provider verification, all 484 API integration
  tests, and nine RLS tests passed. Post-correction Playwright passed all three journeys with
  axe, focus, modal feedback, retry identity, and theme contrast checks. iOS Maestro passed
  its complete Community flow with `MOBILE_E2E_EXPO_NO_OPEN=1` on the already-booted device.
  The switch avoids this machine's Simulator UI app-detection failure.
- Evidence: `/tmp/story63-r1-validate-final.log`,
  `/tmp/story63-r1-verify-changed-final.log`, `/tmp/story63-r1-pact-final.log`,
  `/tmp/story63-r1-api-integration-final.log`, `/tmp/story63-r1-rls-final.log`,
  `/tmp/story63-r1-client-omission-coverage.log`, `/tmp/story63-r1-web-omission.log`,
  `/tmp/story63-r1-mobile-omission.log`, `/tmp/story63-r1-service-order-final.log`,
  `/tmp/story63-r1-last-types-{client,web,mobile}.log`, `/tmp/story63-r1-last-lint.log`,
  `/tmp/story63-r1-playwright-post-omission.log`, and
  `/tmp/story63-r1-maestro-final-no-open.log`. Both local migrations are applied. Production
  rollout flags remain disabled. The approved frozen block is byte-identical to iteration 0.

- Parent verification before the iteration 1 patches: Root `npm run validate` exited 0
  with 6,242 passing tests, unchanged coverage thresholds, types, lint,
  formatting, and production builds. Evidence: `/tmp/story63-r1-parent-validate.log`.
  All eleven tasks and eight frozen matrix rows have executed passing coverage.

## Spec Change Log

- 2026-10-18, iteration 1: BH4/BH5/BH6/EC1/EC2 expose fragmented client ownership;
  BH8/BH9/BH10/CC2 expose network work under database locks and unbounded sweep latency.
  Amend the client and outbox tasks with the review implementation plan below. Preserve the
  frozen intent verbatim. Avoid child-owned requests, independently stale highlighted copies,
  resurrection from older reads, remote calls under locks, and silent delivery failures.
  KEEP: the approved palette and contracts, legacy negotiation, payload-bound receipts,
  persistent revisions, SQL snapshot aggregation, consent advisory-lock ordering and
  ReadCommitted fix, per-post generation triggers/RLS, acknowledgement-based analytics,
  privacy fields and stable delivery IDs/timestamps, ten locales, native haptics, existing
  UI layout corrections, generated SDK workflow, and every previously passing acceptance test.
  The archived iteration-0 source at `/var/folders/3b/5kzs662j47v6vdz26gbkvlgc0000gn/T/couture-story63-iteration0-f6ulxx4l` is a positive reference for these working parts; rebuild
  the defective ownership and delivery paths from this revised plan.

## Review Triage Log

| Finding | Verdict | Route    | Evidence                                                                                                                                                                                                                                                                             |
| ------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VG1     | medium  | patch    | Actual HTTP controller/guard teen retraction is untested. Service and repository tests bypass the route; deleting its transactional-consent metadata would leave them green.                                                                                                         |
| VG2     | medium  | patch    | Worker sweep tests observe moderation only. Direct outbox tests cannot detect removal of reaction dispatch from the runtime.                                                                                                                                                         |
| VG3     | medium  | patch    | Native coverage exercises successful writes. A failed first PUT and exact retry payload identity remain unobserved.                                                                                                                                                                  |
| VG4     | medium  | patch    | Helper tests prove comparison logic, while neither screen holds an older feed response across a confirmed mutation. Caller reconciliation can regress undetected.                                                                                                                    |
| BH1     | medium  | patch    | Selected web controls pair theme-primary text with theme-secondary. Three shipped palettes fall below 4.5:1 text contrast, including Winter at about 2.25:1.                                                                                                                         |
| BH2     | medium  | patch    | Web focus uses theme-secondary against card backgrounds; Default, Autumn and Winter are below 3:1. Existing focus-essential tokens supply contrasting focus colors.                                                                                                                  |
| BH3     | medium  | patch    | The web highlight effect depends on displayedItems. Reaction updates recreate that array, moving focus from the pressed control and replacing its announcement. Native highlighted copies also refocus on each object update.                                                        |
| BH4     | medium  | bad_spec | Mutation 404 removes current copies without invalidating already-started reads. A late successful feed/detail response can reinsert the known-hidden post.                                                                                                                           |
| BH5     | medium  | bad_spec | Both controls own intent and busy refs locally and return before parent reconciliation after unmount. Closing detail or FlatList virtualization loses accepted results and retry identity.                                                                                           |
| BH6     | medium  | bad_spec | Web card and detail mount separate control instances with independent busy refs. Both can submit against one revision before either settles, causing an avoidable self-conflict.                                                                                                     |
| BH7     | medium  | patch    | Detail uses an aria-modal dialog but sends feedback only to a feed live region outside it. Modal screen-reader navigation may exclude the success, conflict and failure feedback.                                                                                                    |
| BH8     | medium  | bad_spec | Reaction delivery runs serially after moderation dispatch with 100 requests of up to three seconds each. This can delay later moderation ticks and the shared single-concurrency maintenance worker. Dedicated community timers keep their other sweeps independent.                 |
| BH9     | medium  | bad_spec | Outbox delivery holds a transaction/row lock while telemetry upserts through the root Prisma client. A one-connection pool waits on itself; slow HTTP also consumes the transaction deadline and can prevent backoff updates.                                                        |
| BH10    | medium  | bad_spec | Delivery catch records backoff silently. Missing sink configuration and repeated rejections leave pending events without an operator-visible failure reason or age signal.                                                                                                           |
| BH11    | medium  | patch    | Native controls use a single nonwrapping row. Large counts with accessibility text scaling exceed a narrow card width and clip controls.                                                                                                                                             |
| EC1     | medium  | bad_spec | Mobile deep-link resolution reconciles only its previous highlighted copy. A delayed detail response can overwrite the newer feed-confirmed reaction when no previous highlighted copy exists.                                                                                       |
| EC2     | medium  | bad_spec | Native refresh updates items independently of deepLinkPost. New reaction counts in the refreshed feed do not update the highlighted copy, and public visibility must be revalidated through detail when refreshing that target.                                                      |
| CC1     | false   | reject   | The claimed unauthorized consent-loss retraction contradicts the approved boundary: removal requires authentication plus the read flag and returns authoritative counts. Deleting the decorator would break the explicitly approved retraction path. Public-post checks still apply. |
| CC2a    | medium  | bad_spec | assertEligible calls remote feature flag evaluation inside the member/post locked transaction. PostHog latency serializes reactors and can exceed Prisma transaction timeouts. Flags are external state and gain no transactional consistency here.                                  |
| CC2b    | medium  | bad_spec | Acknowledged HTTP delivery and a root-client telemetry upsert run inside the outbox transaction. Timeout can roll back attempts/backoff and abort the sweep. This shares BH9 root cause.                                                                                             |
| CC3     | medium  | bad_spec | The mounted guard precedes onChange in both clients. Accepted writes after child unmount never reach the parent, sharing BH5 root cause.                                                                                                                                             |
| CC4a    | false   | reject   | The hypothesized delayed request after account-content erasure requires a production caller that does not exist. Searches find only the unused service method and repository method; normal post withdrawal changes visibility and cannot re-add to that post.                       |
| CC4b    | medium  | patch    | The report transaction selects status and publication fields but omits erasure/anonymization. The strengthened shared predicate accepts undefined optional fields, so this caller silently skips those visibility checks.                                                            |

### Iteration 1 review

| Finding | Verdict | Route  | Evidence                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1-B1   | low     | reject | An older owner omission can temporarily clear a newer public snapshot. Durable server state is preserved and a fresh read restores it. This requires an owner visibility transition between overlapping reads; adding another accepted-read/snapshot order is extra state for a rare, transient omission.                                                                            |
| R1-B2   | medium  | patch  | Two consecutive successful writes set identical feed and modal live-region text. React leaves the text node unchanged, so repeated success lacks a reliable live announcement. This shares R1-E2 root cause.                                                                                                                                                                         |
| R1-B3   | false   | reject | No supported identity-switch caller retains these screens. Web bearer writers are test fixtures and route navigation remounts the grid; mobile production resolution currently returns undefined and its resolver setter has no production caller. The claimed cross-member retry requires an unimplemented authentication transition.                                               |
| R1-B4   | medium  | patch  | Both retention deleteMany calls run after the one-second deadline and can remove an arbitrarily large expiry backlog. Bounded indexed batches inside the existing sweep budget remove this unbounded cleanup work without a new scheduler.                                                                                                                                           |
| R1-B5   | low     | reject | Slow moderation Redis can delay reaction delivery, while committed events remain durable for retry. This is a rare infrastructure-outage freshness delay with no captured analytics freshness deadline. Independent scheduling adds new lifecycle states; it provides no additional reaction durability for this case.                                                               |
| R1-B6   | medium  | patch  | The aggregate LEFT JOIN visits persistent null-selection rows even though they contribute zero to every count. Add selection IS NOT NULL to the join; the existing post_id/selection index supports this and separate viewer subqueries retain tombstone revisions.                                                                                                                  |
| R1-B7   | low     | reject | Stale attempts and accepted replays still take the hot-post lock. The approved contract exempts accepted replays, successful new mutations are capped, and the member advisory lock permits one in-flight post-lock attempt per identity. A malicious request-flood scenario needs a separate abuse policy; it is rare in ordinary feature use and that fix adds policy/guard state. |
| R1-B8   | medium  | patch  | The web fallback detail fetch after a malformed-shape 409 has no timeout, so controls can remain pending. The mobile claim is refuted: getCommunityPostFromMobile already wraps the fallback in withRequestTimeout. Bound the web fallback through its existing signal parameter.                                                                                                    |
| R1-B9   | medium  | patch  | deleteCommunityRowsForUser deletes reports, moderation events and authored posts but keeps the member and reactions on seeded posts. Tombstones, receipts and outbox rows survive each browser test; failures can retain counted votes.                                                                                                                                              |
| R1-B10  | medium  | patch  | Browser and native journeys assert selection and persistence without visible palette-count and total deltas. Wrong count bindings can pass these checks despite exact server aggregation. Extend those existing journeys and card/detail agreement assertions.                                                                                                                       |
| R1-E1   | medium  | patch  | Native loadFeed validates its generation before awaiting highlighted revalidation, then writes pagination/filter metadata afterward without checking again. A filter change during that await lets the older request overwrite the new request state.                                                                                                                                |
| R1-E2   | medium  | patch  | Repeated identical success text has no live-region DOM change. Keep each success observable and announce through the currently active surface. Same root cause as R1-B2.                                                                                                                                                                                                             |
| R1-E3   | medium  | patch  | Web refresh revalidates only highlightedIdRef. A normally opened modal retains its cached reaction summary when refreshed feed rows remove that post. Extend the existing detail revalidation path to the open modal and evict it on 404.                                                                                                                                            |
| R1-V1   | medium  | patch  | Pre-verified gap: tests observe flag lookup/order and freeze removal, but no actual service/HTTP refusal for fresh additions or replacements under read=true/write=false. Removing the writeEnabled guard leaves those tests green.                                                                                                                                                  |
| R1-V2   | medium  | patch  | Pre-verified gap: current erasure tests let own-post triggers or User deletion cascades perform cleanup. No account-content erasure test keeps both members and another author public post alive while asserting member-scoped reaction, receipt and outbox deletion.                                                                                                                |
| R1-C1   | false   | reject | carried CC4a: same requestErasureForUser deletion and hypothetical delayed base-0 retry after an account erasure call. The production service method still has no caller; normal withdrawal makes its target non-public. No patch or deferral is repeated.                                                                                                                           |

Surviving groups: repeated live confirmations (R1-B2/R1-E2), bounded retention
(R1-B4), active-only aggregate join (R1-B6), web fallback deadline (R1-B8), browser
fixture cleanup (R1-B9), journey count assertions (R1-B10), native post-await generation
check (R1-E1), open-modal refresh wiring (R1-E3), posting-freeze regression evidence
(R1-V1), and cross-author account-erasure evidence (R1-V2). Each is a direct correction
using an existing internal state or interface. No public contract or new lifecycle is
needed; all route to patch. The remaining findings are rejected individually above.

### Iteration 1 patch resolution

- R1-B2/R1-E2: Each accepted confirmation replaces a child inside the stable live-region
  parent. Only the active card or modal surface announces. Repeated-success screen checks pass.
- R1-B4: Retention runs before delivery in indexed batches of at most 100 rows per table,
  checking the existing deadline. Real-database expiry backlogs drain across sweeps while
  slow delivery consumes each remaining budget. The unbounded implementation fails this test.
- R1-B6: The aggregate join excludes null selections; viewer revision queries retain them.
- R1-B8: Malformed conflict fallback reads use a 15-second signal. Screen coverage proves
  timeout recovery with the original retry identity and fails when that timeout is removed.
- R1-B9: Browser fixture teardown deletes the member's outbox, receipts and reactions,
  including reactions on another member's seeded post.
- R1-B10: Browser and iOS journeys capture initial visible counts, then assert each palette
  count and total after add, replace, persistence and removal. Browser checks also compare
  the card and modal. Shared seeded-post journeys run serially to keep snapshots stable.
- R1-E1: Native feed requests recheck abort and generation immediately after the detail await.
  The deferred filter-change screen regression fails without that guard and passes with it.
- R1-E3: Web refresh revalidates deduplicated highlighted and ordinary open-detail IDs.
  Existing generation fences and coordinator eviction handle a detail 404. The screen
  regression verifies that both the open modal and feed card disappear.
- R1-V1: Actual decorated HTTP coverage refuses fresh add and replacement with read enabled
  and posting frozen, preserving the database summaries.
- R1-V2: Account-content erasure removes reactions, receipts and outbox rows from another
  author's public post while retaining both members and the post, reducing its total and
  advancing its generation.
- Claude's iteration 1 review confirmed the earlier concerns resolved with no blockers.
  R1-C1 retains its carried verdict. All current review entries are resolved or rejected;
  no deferred entry or further loopback is required.
- Focused evidence: 95 API tests, 101 web screen tests, 71 native screen tests, three browser
  journeys, one iOS flow, formatting and lint passed. Logs:
  `/tmp/story63-r1-patch-api.log`, `/tmp/story63-r1-patch-api-final.log`,
  `/tmp/story63-r1-patch-web-final.log`, `/tmp/story63-r1-patch-mobile-final2.log`,
  `/tmp/story63-r1-patch-playwright-final2.log`, `/tmp/story63-r1-patch-maestro.log`,
  `/tmp/story63-r1-patch-format-final.log`, `/tmp/story63-r1-patch-lint-final2.log`.
  Failure-before-fix logs: `/tmp/story63-r1-patch-web-red.log`,
  `/tmp/story63-r1-patch-mobile-red-corrected.log`, `/tmp/story63-r1-patch-retention-red.log`,
  `/tmp/story63-r1-patch-fallback-red.log`.
- Parent audited the complete patch delta and restored proof reversions. Post-patch SDK
  generation, deterministic Pact/provider, 487 API integration tests (three existing skips),
  nine RLS cases, three browser journeys, one iOS flow and all six affected workspaces passed.
  After the wardrobe test correction below, full `validate` exited 0 with 6,249 passing tests,
  ten existing intentional skips, unchanged coverage thresholds, types, lint, formatting and
  production builds. Audited source hashes match the final tree; frozen approval is unchanged.
- Parent evidence: `/tmp/story63-r1-patched-parent-generate.log`,
  `/tmp/story63-r1-patched-parent-pact.log`,
  `/tmp/story63-r1-patched-parent-api-integration.log`,
  `/tmp/story63-r1-patched-parent-rls.log`,
  `/tmp/story63-r1-patched-parent-playwright.log`,
  `/tmp/story63-r1-patched-parent-maestro.log`,
  `/tmp/story63-r1-patched-parent-verify-changed.log`,
  `/tmp/story63-r1-patched-parent-validate-final.log`.
  Android and physical-device haptics were not exercised. Both local migrations are applied;
  production flags remain disabled and no deployment occurred.
- The first parent validation run exposed an existing wardrobe test race under coverage:
  a poll could receive the original empty-list handler before the test installed its next
  response. The screen reproduction failed with the original ordering. One stable handler
  now controls initial, processing and explicitly released awaiting-tags responses; all 16
  screen tests pass under coverage. Production files, polling cadence and coverage thresholds
  are unchanged. Evidence: `/tmp/story63-r1-hub-race-red.log`,
  `/tmp/story63-r1-hub-coverage.log`. The full workspace coverage run applies the existing
  floor to its intended scope; a single-screen invocation falls below that global floor.

## Review implementation plan

Reproduction evidence and draft screen tests are in `/tmp/story63-race-repros/`.
`web.log` shows two simultaneous same-post UUIDs at baseRevision 0 and an old feed
resurrecting a post after mutation 404. Its close-detail assertion is inconclusive;
complete that reproduction and the native scenarios before fixing their paths.
Use draft test bodies as a reference; avoid duplicating entire existing suites.

- `apps/web/src/app/components/community-lookbook-grid.tsx`, web reaction controls, native
  screen/card/controls: own pending intent, retry identity, and confirmed snapshots per post
  at the grid/screen level. Card and detail share one in-flight request. Child unmount must
  preserve the intent and parent update. Keep controls presentational; retain error/retry
  state until resolution and reconcile success even after its invoking child disappears.
- In both screens, reconcile every feed/detail response with the latest confirmed snapshot
  across all visible copies, independent of stale render closures. Fence pre-404 reads so
  they cannot reinsert an evicted post; subsequent fresh reads may establish public visibility.
  Native refresh also revalidates the highlighted target directly, since absence from a
  paginated feed alone does not establish hidden status. Detail 404 clears that copy.
- Focus a deep-link target once per target navigation. Reaction updates preserve the active
  control and its announcement. Put web reaction feedback inside the active modal as well as
  the feed surface. Use WCAG AA selected text and 3:1 focus colors for all four themes.
  Native controls wrap at narrow widths and accessibility text sizes.
- `community.service.ts`: resolve read/write feature flags before entering the repository
  transaction. Keep authoritative consent checks under the member lock. Preserve the approved
  consent-loss removal exception and replay semantics. HTTP tests use the actual decorated
  controller and guards: revoked teen removal succeeds, add/replace are refused.
- `community-reaction.outbox.ts`: claim rows in a short committed lease transaction, deliver
  telemetry and acknowledged HTTP outside database transactions, then conditionally settle
  delivery/backoff against that claim. A crashed worker's lease expires. Preserve stable UUIDs
  and original occurrence time, sink deduplication, privacy, retry retention and erasure.
  Bound each sweep by a short wall-time budget plus its one bounded in-flight send. Log safe
  failure reason, attempt, and pending age without member identifiers or payloads. Prove delivery
  and recovery with a one-connection pool and slow/unavailable sink; runtime sweep coverage
  must observe the reaction dispatcher and delivered row.
- `community.repository.ts`: require the erasure/anonymization fields in the shared public
  predicate and select both in the report lock query. Cover erasure-pending report refusal.
- Add screen-level deferred-response tests on both platforms: older feed after mutation,
  older detail after mutation, old reads after 404, card/detail overlapping writes, closing
  detail or virtualizing a card while pending, and identical native network-retry payload.
  Reproduce each bug through its user-facing screen before applying the correction.
  Extend browser checks for highlighted focus preservation, modal live feedback and theme
  contrast; verify responsive native controls through screen assertions and the existing flow.

Review groups: client request ownership (BH5/BH6/CC3); cross-reader reconciliation
(BH4/EC1/EC2); bounded observable outbox leases (BH8/BH9/BH10/CC2b); flag I/O
outside locks (CC2a). These route to bad_spec. Patch entries are incorporated into
this re-derivation; CC1 and CC4a are rejected on the evidence recorded above.

## Design Notes

Additive local migration changes persistent structures; test locally before deployment.
Desired-state writes, retained revisions, and receipts prevent resurrection through retries.

## Verification

- `npm run generate:api-client` and `npm run test:pact`: generated/public contracts agree.
- `npm --workspace apps/api run test:integration`: real database/concurrency evidence passes.
- `npm --workspace packages/db test -- test/rls/community-posts.spec.ts`: client access and isolation pass.
- `npm run test:pw-local -- playwright/tests/community-reactions.spec.ts`: browser journey passes.
- `MOBILE_E2E_PLATFORM=ios node scripts/run-maestro.mjs maestro/community-feed.yaml --artifacts`: native journey passes.
- `npm run verify:changed` and `npm run validate`: affected/full quality gates pass.
