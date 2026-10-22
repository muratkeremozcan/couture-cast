# Epic 6 Context: Community & Moderation Loop (Phase 2)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Deliver climate-relevant community inspiration through posts, reactions, comments, ranked highlights,
and branded sharing, backed by safe publication and accountable moderation. Community Beta opens
only when staffing, SLA alerts, privacy, deletion, localization, accessibility, model, and rollback
evidence are signed. Production read and write rollout controls stay disabled for the general
population until all eight release gates close. The one sanctioned exception is a complimentary
full-access grant that lets owner-selected family testers use premium and community features in
production without payment.

## Stories

- Story 6.1: Community feed by climate band
- Story 6.2: Production content-screening readiness
- Story 6.2b: Community screening release gate and worker deployment
- Story 6.3: Curated reactions
- Story 6.4: Threaded comments
- Story 6.5: Realtime engagement and notifications
- Story 6.6: Community City Spotlight
- Story 6.7: Home spotlight teaser
- Story 6.8: Safe branded share-card export
- Story 6.9: Native platform sharing
- Story 6.10: Moderator queue and case detail
- Story 6.11: Moderation decisions and account sanctions
- Story 6.12: SLA monitoring and escalation
- Story 6.13: Immutable moderation history
- Story 6.14: Complimentary full access

## Requirements & Constraints

- Community participation requires age 13+. Uploads also enforce the guardian-consent policy for
  under-16 members.
- Climate-band feeds support photo posts, locale metadata, and editorial weekly challenges.
  Reactions use a closed emoji palette, one current reaction per member and post, exact aggregates,
  and retry-safe replacement and removal. Visibility changes invalidate feed and highlight caches.
- Comments support one reply level, stable pagination, screening before publication, deletion
  tombstones, and reporting. Accepted reports reach moderation within five minutes; human review
  has a 24-hour SLA with at-risk and breach escalation.
- Moderator access is role restricted. Decisions require an attributed reason, serialize conflicts,
  and keep immutable history for at least 12 months. Account erasure removes personal content and
  anonymizes subject and reporter identities within 72 hours.
- Spotlight ranking is deterministic from reactions and recency, uses coarse location and a defined
  privacy cohort, and shows affiliate CTAs only when an eligible sponsorship exists.
- Exported cards keep luxury branding and an optional watermark while stripping personal data,
  exact location, source metadata, identifiers, and signed media URLs. Cancellation keeps the
  composition; failed sharing offers camera-roll save or web download.
- Engagement pushes require opt-in and quiet hours, dispatch within 60 seconds, and clean up invalid
  tokens. Community analytics use anonymous, privacy-safe, deduplicated signals.
- Complimentary access grants every premium capability with no billing provider, customer record,
  or charge. It enables community rollout flags and push dispatch for complimentary members only;
  every other member, cohort, and production default stays unchanged. Grant and revoke are
  owner-only and audited (actor, member, reason, time); revoke restores the prior paid or free
  state on the next request; erasure removes the grant and its audit subject identity.
- English, Spanish, and French are launch locales. Screening handles obfuscation and escalates
  unsupported language or uncertain results. Web and mobile controls are localized and accessible,
  with upload alternative text, clear focus, and screen-reader feedback.

## Technical Decisions

- NestJS owns community decisions; Supabase PostgreSQL and Prisma provide persistence with RLS
  isolation and role guards. Next.js hosts the moderator console. Audit records are append-only at
  the database boundary.
- Public HTTP contracts start as shared Zod schemas under `packages/api-client/src/contracts/http`;
  controllers, OpenAPI, SDKs, and wrappers derive from them. `/api/v1` stays stable; incompatible
  changes need `/api/v2`. Use the shared success, pagination, and error envelopes.
- Moderation uses an in-house console and a standalone BullMQ worker deployed as an unprivileged
  container under `tini` on an always-on host: Northflank first, Oracle Always Free if memory
  requires it, then Railway. Serverless HTTP functions cannot host it.
- Screening uses a pinned NSFWJS model on TensorFlow.js WASM with bounded execution and fail-closed
  unavailability: one replica, concurrency one, 512 MiB, a traced dependency budget, and build
  identity proven by a deployed canary. Readiness evidence is an immutable payload signed by the
  owner against its hash; stale or partial evidence fails closed. Thresholds live in that payload.
- Production Redis is Upstash Pay as You Go. Worker blocking and stalled checks are tuned so the
  screening worker's projected monthly cost stays at or below USD 5.
- Highlight read models live in Redis with engagement and moderation invalidation. Realtime events
  publish after durable commits with version and timestamp; reconnect and ordered polling fallback
  suppress duplicates.
- Paid entitlement truth has one writer: the RevenueCat webhook plus its refresh and reconciliation
  pulls, mirrored into our database and enforced by the premium entitlement guard. The
  complimentary source must sit beside that mirror so webhooks, renewals, reconciliation, and
  expiry jobs can never downgrade, overwrite, or bill it.
- Feature flags are checked through PostHog with a Postgres toggle fallback.

## UX & Interaction Patterns

- Lookbook Prism shows ritual and community side by side on desktop and stacked on smaller screens.
  Loading, empty, stale, disabled, and failed community states preserve the daily ritual.
- Cards show weather and location context, engagement counts, accessible applause and report
  actions, and sponsorship disclosure. Use gold success and focus cues, merlot errors, and fog
  informational states. Focus order follows hero, chips, garments, community cards.
- Community deep links focus the referenced visible card. Invalid targets fall back to the ritual
  with informational feedback. Disabled filters state their availability clearly.

## Cross-Story Dependencies

- Story 6.1 is the community foundation. Stories 6.2 and 6.2b supply production screening and
  release evidence; comments consume that screening boundary.
- Reactions feed City Spotlight, then the Home teaser. Realtime consumes durable reaction and
  comment writes. Safe export precedes native sharing.
- Moderator queue precedes decisions and SLA monitoring; decisions precede immutable-history proof.
- Story 6.14 builds on the Story 5.2 billing and entitlement stack and on Story 6.5 push dispatch.
- Localization, accessibility, deep links, consent, image capture, and affiliate infrastructure come
  from earlier epics, including the already-delivered Epics 4 and 5.
- Following stays disabled until product either adds sized follow-graph and profile stories or
  amends the brief and UX to drop it. Close this before Community Beta sign-off.
