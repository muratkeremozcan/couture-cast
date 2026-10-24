---
title: 'Story 6.7b: Sponsored community highlights'
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'f7045a7b734c44720291a49ca4f253e09cc92e43'
route: 'dispatch'
story_key: '6-7b-sponsored-community-highlights'
review_loop_iteration: 4
context:
  - '{project-root}/_bmad-output/project-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/5-1-affiliate-shop-this-look-cta.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-7-home-spotlight-teaser.md'
---

<frozen-after-approval reason="owner delegated delivery and phased peer approval">

## Intent

**Problem:** Community posts cannot carry a sponsorship. The City Spotlight and Home teaser show
standout looks with no way to shop them, and PRD FR (community) 3 requires click-to-buy CTAs
labeled "Partnered" wherever a sponsorship is configured.

**Approach:** Add a post-to-offer sponsorship link with an effective window, created and ended only
by the owner through an audited operator command. Serve a per-viewer sponsorship block on opted-in
community reads when every eligibility check passes. Render a disclosed "Partnered" CTA on community
cards, the City Spotlight and the Home teaser on web and mobile. Record clicks through the existing
Story 5.1 affiliate click flow with community surfaces.

## Boundaries & Constraints

**Always:**

- Data: new `CommunityPostSponsorship` (post FK cascade, offer FK restrict, `starts_at` inclusive,
  `ends_at` exclusive or NULL, `created_by_id`, `create_reason`, `ended_at`, `ended_by_id`,
  `end_reason`, timestamps). At most one non-ended link per post (partial unique index). Window CHECK
  `ends_at > starts_at`. RLS denies every client role; only the API service and the operator command
  touch it.
- Owner-only creation and ending: an operator command with no HTTP route. A shared TypeScript
  service in `apps/api/src/modules/commerce/` holds the logic (so Story 6.10 can reuse it); a `tsx`
  entry `scripts/community-sponsorship.ts` wraps it, exposed as `npm run community:sponsorship --
link|end`. Targeting: `--env-file` is required. Any `DATABASE_URL` whose host is not loopback
  (`localhost`, `127.0.0.1`, `::1`) also requires `--confirm-target <project ref>` equal to the ref
  parsed from the URL (pooler username `postgres.<ref>` or host `db.<ref>.supabase.co`); an
  unparseable remote URL is refused.
  - Actor: `--actor-email` resolves in the same Postgres through
    `auth.users.raw_app_meta_data ->> 'app_role'`, which must equal `admin`, then maps to the app
    `User` (`app_metadata.app_user_id`, else `User.email`). The command refuses when the auth user
    is missing, the role differs, the app user is missing, or the two identities disagree.
  - Link requires `--post`, `--offer`, `--reason`, `--author-agreement <reference>`, optional
    `--starts-at` (default UTC now) and `--ends-at` (default NULL). The agreement reference must
    be a ULID with an `agr_` prefix (`^agr_[0-9A-HJKMNP-TV-Z]{26}$`), the id
    of the owner's off-system agreement record, so no name or contact detail can fit; anything else
    is refused. `--reason` (link and end) is a closed code, never free text: link
    `partner_campaign | owner_pick`, end `campaign_ended | author_withdrew | partner_inactive |
correction`. The command refuses `ends_at <= starts_at` and an `ends_at` already
    in the past before any write. The post must pass the public visibility predicate
    (`community.repository.ts:132-145`), and its author must have reached majority (reuse the
    guardian age rule; export it). The offer must be a garment offer (`advisor_slot` NULL); advisor
    offers are refused.
  - One transaction writes the link and an `AuditLog` row (`community_sponsorship_linked` or
    `community_sponsorship_ended`; actor user id, post id, offer id, window, reason, author agreement
    reference). Ending sets `ended_at`, `ended_by_id`, `end_reason` and never deletes. `--dry-run`
    prints the plan and writes nothing.
- Eligibility, evaluated per viewer at read time with `now() AT TIME ZONE 'UTC'` against the
  `timestamp(3)` columns (same as `commerce.repository.ts:425-426`): link not ended and inside its
  window; offer `active`, garment, inside its window; partner `active`; offer `locale_region` equal
  to the viewer's resolved region or `'*'`; flag `commerce_affiliate_enabled` on; viewer
  `affiliate_ctas_enabled` true (missing row reads true); post passes the public visibility
  predicate. Viewer authorization alone never qualifies: an author's own withdrawn or moderated post
  keeps its existing author read with no block. Region uses `resolveLocaleRegion` with identical
  inputs on every read route and the click re-check, so the spotlight and post routes now pass
  `accept-language` like the feed. Any failure or error yields no block (fail closed, logged without
  identifiers). No viewer age suppression, per Story 5.1 Decision 1.
- Contract: opt-in per request with header `x-couture-sponsorship: 1`, following the Story 6.3
  reactions precedent, so installed strict clients never see a new field. Opted-in feed, post,
  spotlight (including `surface=home_teaser`) responses use new strict variants whose items carry an
  optional `sponsorship` block `{partnerId, partnerDisplayName, offerId, offerTitle}` (no URL, no
  window, no reason). Absent block means no CTA. `Vary` adds the header in both the middleware and
  every route `@Header('Vary', ...)` (`community.controller.ts:101,150,197`). Works with and without
  the reactions header.
- Caching: the block is projected after the spotlight Redis read model (snapshots keep ids only), so
  linking or ending applies on the next read with no cache change. Clients render a block only from
  a live response; mobile never persists or renders it from an offline or cached payload (mirror
  `withoutShopThisLook`).
- Click: extend `affiliateSurfaceSchema` with `community_feed`, `community_spotlight`, `home_teaser`;
  the request's `recommendationId` is the post id. After the flag, audience and opt-out checks, a
  community surface runs the full eligibility lookup (post, offer, viewer) before the dedupe lookup
  and before the offer-row garment or advisor branch; no eligible link returns 404 with no redirect
  and no row, including a replay inside 60 seconds after the link ended. Passing rows store
  `recommendation_id = postId` and `scenario = 'community'` (a named constant like
  `ADVISOR_SCENARIO`). Token, redirect validation and the existing `redirectUrl` response stay.
- Analytics: `affiliate_cta_shown` and `affiliate_cta_clicked` properties become strict unions keyed
  by `surface`. Hero and advisor members keep their current fields. The community member carries
  `partner_id`, `offer_id`, `surface`, `locale_region` and rejects `scenario`, `recommendation_id` or
  any post, author, caption or user identifier. The server emits the community clicked event on its
  own path (no scenario gate) without `recommendationId`. Shown events: mobile through
  `track-events.ts`, web through the `posthog-js` client with the shared builder; once per rendered
  block per screen visit. Negative fixtures in `commerce-contract.spec.ts`.
- UI: a "Partnered" disclosure label and a separate "Shop this look" button, never nested inside the
  card's or teaser's existing link or open action. Web: `LookbookCard` (feed and spotlight scopes),
  `LookbookDetailDialog`, and `home-spotlight-teaser.tsx` (button outside the teaser `<a>`). Mobile:
  `CommunityCard` (feed, spotlight module, detail, deep-link card) and the Home teaser (button
  outside the link `Pressable`). The existing badge slots render "Partnered" only from
  `item.sponsorship`; the caller-supplied `sponsoredPostIds` prop is removed and `isSponsored` is
  derived from the item. Button
  label names partner and action; the card's accessible name includes the disclosure; opening states
  "opens in browser". Activation mints the click, opens the partner site (web `noopener,noreferrer`,
  mobile in-app browser), and shows localized loading and error states without moving focus away.
- Copy: every new or changed key in all ten locales on both clients, parity specs green.
- Seeds: a test/local-only sponsorship on a seeded spotlight post by an adult seed author through
  `allowsCommerceSeeding`. Every teardown that deletes offers or posts deletes sponsorships first
  (`packages/testing/src/cleanup.ts`, `packages/db/test/commerce-seed.spec.ts:58-79`, commerce and
  palette advisor integration teardowns).

**Never:** an HTTP or client path that creates or ends a link; a sponsorship field on non-opted-in
responses; caching a viewer's block in Redis; an offer URL, window, operator reason or agreement
reference in the sponsorship block or sponsorship analytics (existing image URLs and the click
`redirectUrl` stay); CTA rendering from cached data; sponsoring a minor's post or an advisor offer;
changing hero or palette advisor offers; enabling any production flag.

## I/O & Edge-Case Matrix

| Scenario                          | Input / State                                                                                                                                                               | Expected                                      | Handling            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------- |
| Eligible                          | live link, offer, partner, flag on, opted in, region match                                                                                                                  | block on card, spotlight, teaser; CTA         | N/A                 |
| Not opted-in client               | no `x-couture-sponsorship` header                                                                                                                                           | today's response shape                        | N/A                 |
| Window                            | before `starts_at`, at or after `ends_at`, ended                                                                                                                            | no block                                      | next read reflects  |
| Offer or partner                  | inactive or outside offer window                                                                                                                                            | no block                                      | click 404           |
| Region                            | offer region differs, not `'*'`                                                                                                                                             | no block                                      | N/A                 |
| Flag off / opted out              | either                                                                                                                                                                      | no block; click 503 / 403                     | existing precedence |
| Link ended between read and click | click, also a replay within 60 s                                                                                                                                            | 404, CTA error state                          | no redirect, no row |
| Post withdrawn or moderated       | other member                                                                                                                                                                | not in public feed, spotlight or teaser       | click 404           |
| Post withdrawn or moderated       | its author                                                                                                                                                                  | existing author read, no block                | click 404           |
| Post erased                       | any                                                                                                                                                                         | gone; erasure cascades the link               | audit row kept      |
| No saved locale                   | region-specific offer                                                                                                                                                       | same result on feed, spotlight, teaser, click | N/A                 |
| Eligibility error                 | DB or flag failure                                                                                                                                                          | no block, community read succeeds             | logged, no ids      |
| Second link on same post          | operator link while one is open                                                                                                                                             | refused, nothing written                      | names open link     |
| Operator refusals                 | non-admin, identity mismatch, reason not a listed code, agreement missing or not an `agr_` ULID, minor author, advisor offer, bad or past window, unconfirmed remote target | nothing written                               | exit non-zero       |
| Click failure                     | 5xx or network                                                                                                                                                              | localized error, focus stays on button        | retry by user       |

</frozen-after-approval>

## Code Map

- Schema `packages/db/prisma/schema.prisma`: `CommercePartner` :1105 (status), `AffiliateOffer`
  :1160 (status, `locale_region` :1171, `effective_from/to` :1179-1181, CHECK one of
  `garment_category`/`advisor_slot`), `CommercePreference` :1193, `AffiliateClick` :1207 (free
  `surface` string, dedupe :1236), `AuditLog` :980. New migration plus RLS.
- Commerce API `apps/api/src/modules/commerce/`: `affiliate-offer.service.ts` `resolveLocaleRegion`
  :160-176, flag and preference chain :225-276, `isAffiliateAudienceEligible` :93-128 (Decision 1);
  `commerce.repository.ts` eligibility SQL :298-345, click offer lookup :410-427, preference
  :126-135; `affiliate-click.service.ts` `recordClick` :140 (flag :146, audience :159, opt-out :163,
  `findActiveClickOffer` :173, offer-type branch :183, recommendation check :199-212, dedupe :214,
  telemetry :258); `affiliate-click.telemetry.ts` :63,83; `affiliate-deep-link.ts:36`.
- Contracts `packages/api-client/src/contracts/http/commerce.ts`: `affiliateSurfaceSchema` :34,
  `shopThisLookSchema` :42-56, click request :93; `community.ts`: feed item :541-556 (strict, "served
  to every viewer" :536-540), reaction variants :628-630, spotlight :889-924, reactions opt-in note
  :458 and OpenAPI header :1844-1850. `types/analytics-events.ts` shown :1830-1838 (hand-copied
  surface enum), clicked :1840-1856. Regenerate: `generate:http-openapi`, `generate:api-client`,
  `optic:diff`.
- Community API `apps/api/src/modules/community/`: `community.service.ts` `getFeed` :208,
  `readAuthorized` :411-444, `projectFeedItems` :330-336, `buildFeedItems` :611;
  `community-spotlight.service.ts` `page()` :371-402 (projection :384), params :66-74;
  `community.controller.ts` feed :99-133, spotlight :148-192 (no accept-language today);
  `community-cache-headers.middleware.ts` Vary plus route `@Header` :101,150,197; author read
  `community.service.ts:350-358`; public predicate `community.repository.ts:132-145`;
  `community-spotlight-cache.ts` snapshot ids only :73-84. Operator logic precedent (service, no
  CLI): `community-moderation.actions.ts:34-43`. Role source:
  `auth/access-token-identity.service.ts:298-301` (`app_metadata.app_role`); `User`
  `schema.prisma:233`; `AuditLog.user_id` FK :982-983. Age: `guardian.service.ts:261`
  `hasReachedAgeOfMajority` (export it), `packages/utils/src/age.ts:69`. Click internals:
  `ADVISOR_SCENARIO` :68, unresolved recommendation :94, `findRecentClick` :214-226,
  `findRecommendationScenario` :199-203, clicked telemetry gate :266-286.
- Web: `community-lookbook-grid.tsx` sponsored badge :677-685, `LookbookCard` :802-865, actions
  :745-776, `sponsoredPostIds` :1777-1782 (remove), set :3102, spotlight render :3196-3203, feed
  :3276-3283, `LookbookDetailDialog` :909 rendered :3336; shown transport
  `apps/web/src/analytics/browser-analytics.ts:77`;
  `home-spotlight-teaser.tsx` link :200-252, slot :260-281; `apps/web/src/lib/community.ts:310,433`
  parsers; `apps/web/src/lib/commerce.ts` mint :146, open :170.
- Mobile: `components/community/community-card.tsx` `isSponsored` :213-214, label :359-360, pill
  :413-423, actions :460-479; `community-screen.tsx` `renderSpotlightCard` :1676-1683, deep-link card
  :1783, feed :1913-1914; `community-spotlight-module.tsx:265-282`;
  `components/home/home-spotlight-teaser.tsx` :77-143; `src/lib/community.ts:263,310` parsers;
  `src/lib/commerce.ts` mint :118, open :142, `resolveRenderableShopThisLook` :79; hero CTA pattern
  `components/hero/outfit-recommendation-card.tsx:216-272`.
- Locales: `community.card.sponsored*`, `commerce.shopThisLook.*` in
  `apps/{web/src/i18n,mobile/assets}/locales/*.json`; parity specs incl. `commerce-locales.spec.ts`.
- Tests: `pact/http/consumer/interactions/community/*`, `interactions/commerce-affiliate.ts`,
  provider doubles; `apps/api/integration/` community and commerce suites;
  `playwright/tests/community-feed.spec.ts`, `community-spotlight.spec.ts`,
  `home-spotlight-teaser.spec.ts`, `api/commerce-affiliate.api.spec.ts`;
  `maestro/community-spotlight.yaml`, `home-spotlight-teaser.yaml`, `commerce-affiliate.yaml`,
  `scripts/run-maestro.mjs`, `scripts/maestro-flow-durations.json`,
  `scripts/lib/mobile-e2e-flow-state.mjs` (resets `CommercePreference`); seeds
  `packages/db/prisma/seeds/commerce.ts:54`.

## Tasks & Acceptance

**Execution:**

- [ ] Schema, migration, RLS -- `CommunityPostSponsorship` with constraints and indexes.
- [ ] Shared sponsorship operator service, `scripts/community-sponsorship.ts`, package script,
      README section -- link, end, dry-run, env targeting, audit, every refusal.
- [ ] Commerce repository and a sponsorship eligibility service -- one batched query per page.
- [ ] Contracts, OpenAPI, SDK, analytics registry -- opt-in variants, block, surfaces, shown fix.
- [ ] Community feed, post and spotlight services, controllers, Vary -- opted-in projection.
- [ ] Click service and telemetry -- community branch and re-check.
- [ ] Web and mobile clients -- header, parsers, CTA on card, spotlight and teaser, shown events.
- [ ] Locales, ten per client -- "Partnered" and CTA keys.
- [ ] Seeds and e2e flow-state reset.
- [ ] Tests: unit for every matrix row on API, web and mobile; real-database integration for
      eligibility (incl. the `ends_at` boundary and withdrawn or moderated posts read by author and
      others), the operator command (every refusal, single open link, audit atomicity) and click
      re-check (advisor offer, ended-link replay inside 60 s); a Vary assertion on feed, post and
      spotlight; Pact for opted-in feed and spotlight and the three click surfaces; Playwright on
      `pr-pw-e2e-local` for card, detail dialog, spotlight and teaser CTA (opt-out hides it, axe
      clean, opens partner URL, not-opted-in requests unchanged); Maestro flow registered with
      durations.

**Acceptance Criteria:**

- Given an eligible link, when an opted-in viewer reads feed, spotlight or teaser, then each item
  for that post shows "Partnered" and a CTA, and the hero and other cards are unchanged.
- Given the owner runs link or end, then exactly one link and one audit row change atomically, and
  the next read reflects it with no cache action.
- Given any CTA activation, when the click is accepted, then the partner site opens and the events
  parse strict schemas with a community surface and no post, author or user identifier.
- Given keyboard and screen-reader users, then disclosure is announced with the card, the CTA is a
  separate focus stop, and loading and error states are announced once.
- Given all locales, parity specs pass for every new or changed key.

## Implementation Notes

- 2026-10-24: Opted-in variants extend the reaction variants (their `reactions` is optional), so one
  sponsored schema per route serves requests with or without `x-couture-reactions`.
- The block is attached in `CommunityController` after the community read and after the spotlight
  read model, through `CommunitySponsorshipService.resolveForPosts` (one batched query). The public
  visibility rule is shared as `publiclyVisiblePostSql`, which the spotlight ranking now also uses.
- Post erasure anonymizes rows rather than deleting them, so `eraseMetadata` deletes the post's
  links in the same transaction; the FK cascade covers hard deletes. Audit rows stay.
- The operator command is `scripts/community-sponsorship.ts` run with
  `tsx --tsconfig apps/api/tsconfig.json` (the root tsconfig has no decorator support). Its logic is
  `community-sponsorship.cli.ts` and `CommunitySponsorshipOperatorService`, registered in
  `CommerceModule` for Story 6.10. `--ends-at` in the past with a defaulted start refuses as
  `window_invalid`; with both times given it refuses as `window_in_past`. Both write nothing.
- The `community_sponsorship_ended` audit row repeats the agreement reference by reading the
  matching `community_sponsorship_linked` row; the link table carries no agreement column.
- Surprise: with `noopener`, `window.open` always returns null, so the web open helper reported every
  successful handoff as an error. Fixed for the community CTA and the Story 5.4 palette advisor CTA.
- Surprise: the realtime catch-up re-reads visible posts through `targets/resolve`, which carries no
  sponsorship, and replaced the live copies on both clients. Resolve copies now keep the block from
  the visit's last live read of the same published post; live reads still replace it, and the click
  re-checks server-side.
- Device runs: Android closes the Custom Tab from its close button; iOS reports elements under the
  tab bar as visible, so the Maestro flow centres each CTA before tapping.

## Spec Change Log

- 2026-10-24, iteration 2 (story review 1, coordinator under owner delegation): operator command
  concretized (shared service, `tsx` entry, env targeting, role from `auth.users` app metadata,
  app user mapping, refusals); sponsorable posts limited to adult authors with a recorded author
  agreement and to garment offers; public visibility predicate for projection and clicks, author
  reads keep behavior without a block; community click branch before dedupe and offer-row branch,
  stored `scenario = 'community'`; analytics unions keyed by surface and web shown transport;
  same region inputs on every route; Vary at route level; UTC window comparison; detail dialog
  disclosure, badge derived from the item; teardown order; URL ban scoped to sponsorship data.
  KEEP: CLI with no HTTP route, opt-in header, no viewer age suppression, three click surfaces.

- 2026-10-24, iteration 3 (rereview 1): author agreement reference limited to an opaque id (no
  personal data in audit rows that outlive erasure); any non-loopback target needs a confirmation
  matching the ref parsed from the URL; window defaults and pre-write window refusals.

- 2026-10-24, iteration 4 (rereview 2): agreement reference is an `agr_` ULID and reasons are closed
  codes, so no audit field can hold an author name or contact detail.

## Review Triage Log

- 2026-10-24, story review 1 on SHA `f9262165...ae86`: cc67b-opus CHANGES_REQUIRED (9: 2 high,
  4 medium, 3 low), cc67b-astra CHANGES_REQUIRED (2 medium). All accepted; none refuted. Opus 4
  resolved by coordinator decision: adult authors with a recorded agreement only. Reviews:
  `_bmad-output/test-artifacts/story-6-7b/reviews/cc67b-{opus,astra}-story-review.md`.

- 2026-10-24, rereview 1 on SHA `8666c452...4012`: cc67b-astra READY; cc67b-opus CHANGES_REQUIRED
  (3 new: 1 medium, 2 low; prior 11 resolved). All accepted.

- 2026-10-24, rereview 2 on SHA `3f1c13e6...7b70`: cc67b-opus READY; cc67b-astra CHANGES_REQUIRED
  (1: opaque id still admits names; free-text reasons). Accepted.

- 2026-10-24, rereview 3 on SHA `6f8a83cc...ebb4`: cc67b-opus READY, cc67b-astra READY. Approved by
  the coordinator under owner delegation; status ready-for-dev.

## Design Notes

The opt-in header keeps the 6.3 rule that installed clients parse strict schemas. A CLI over an
admin HTTP route removes an attack surface for an action only the owner performs; the moderator
console (6.10) can add a UI later through the same service.

## Verification

**Commands:**

- `npx vitest run` in `apps/api`, `apps/web`, `apps/mobile`, `packages/api-client` touched suites --
  green; `npx tsc -p`, `npx eslint` per workspace -- clean.
- API integration suites on an isolated DB with `TEST_ENV=local` -- green.
- `npm run optic:diff` -- additions only; Pact consumer and provider -- green.
- Playwright CTA specs on the local lane; Maestro flow on Android -- green.
