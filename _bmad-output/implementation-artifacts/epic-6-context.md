# Epic 6 Context: Community & Moderation Loop (Phase 2)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Deliver climate-relevant community inspiration through posts, reactions, comments, ranked
highlights, and branded export and sharing, backed by safe publication and accountable moderation.
Every lane ships behind disabled production read and write controls. Community Beta opens only after
Stories 6.2 through 6.13 and every signed release-gate item are complete. The one sanctioned
exception is complimentary full access, which lets owner-selected family testers use premium and
community features in production without payment. Stories 6.1 through 6.8 are done; the current
story is 6.9, native platform sharing of the card that 6.8 prepares.

## Stories

- Story 6.1: Community feed by climate band
- Story 6.2: Production content-screening readiness
- Story 6.2b: Community screening release gate and worker deployment
- Story 6.3: Curated reactions
- Story 6.4: Threaded comments
- Story 6.5: Realtime engagement and notifications
- Story 6.6: Community City Spotlight
- Story 6.7: Home spotlight teaser
- Story 6.7b: Sponsored community highlights
- Story 6.8: Safe branded share-card export
- Story 6.9: Native platform sharing
- Story 6.10: Moderator queue and case detail
- Story 6.11: Moderation decisions and account sanctions
- Story 6.12: SLA monitoring and escalation
- Story 6.13: Immutable moderation history
- Story 6.14: Complimentary full access
- Story 6.15: Expo SDK 58 upgrade for live font-scale layout

## Requirements & Constraints

- Participation requires age 13+; uploads and export also enforce guardian consent for under-16
  members. Flag-off, revoked consent, suspension, or erasure blocks community actions and export.
- Feeds group photo posts by climate band with locale metadata and editorial weekly challenges.
  Reactions use a closed palette, one current reaction per member and post, exact aggregates, and
  idempotent replace and remove. Visibility changes invalidate feed and highlight caches.
- Comments: one reply level, stable keyset paging, screening before publication, deletion
  tombstones, report on every visible comment. Accepted reports reach moderation within five
  minutes; human review has a 24-hour SLA with at-risk and breach escalation.
- Moderation is role restricted; decisions carry an attributed reason, serialize conflicts, and keep
  immutable history for at least 12 months. Erasure removes personal content and anonymizes subject
  and reporter identity within 72 hours.
- Spotlight ranking is deterministic from reactions and recency, uses coarse location and a
  minimum privacy cohort. Affiliate CTAs appear only for an eligible, disclosed sponsorship.
- Sharing (6.8 and 6.9): cards go to Pinterest, Instagram, Facebook, and TikTok through the native
  share sheet only when the OS exposes those targets, with a generic system-share path for other
  compatible apps. Cards keep luxury branding and an optional watermark and carry no personal data.
  Cancel, absent target, or handoff failure must lose nothing: the prepared card and composition
  survive. If a platform share fails, notify the member and offer the 6.8 save path (camera roll on
  iOS and Android, download on web). Sharing workflows count toward the 99.5% availability target.
- Analytics privacy: event tracking is anonymous and covers community actions. Community analytics
  are privacy-safe and deduplicated, and identity uses the PostHog pseudonym discipline. Share
  analytics record platform, outcome, and duration only: no image bytes, digests, captions, source
  or post IDs, URLs, filenames, native asset IDs, location, or other personal data. Operational logs
  use closed failure codes. Analytics ingestion stays idempotent, and an analytics outage must not
  break the share flow. Story 6.8 added no analytics events, so 6.9 introduces the share events.
- Engagement pushes require opt-in and quiet hours, dispatch within 60 seconds, and clean up invalid
  tokens.
- Complimentary access grants every premium capability with no billing provider, customer, or
  charge; enables community flags and push only for those members; grant and revoke are owner-only
  and audited; revoke restores the prior state on the next request.
- English, Spanish, and French at launch. Every web and mobile state is localized and accessible
  (WCAG 2.2 AA), with clear focus and screen-reader announcements.

## Technical Decisions

- NestJS owns community decisions over Supabase PostgreSQL and Prisma with RLS and role guards.
  Next.js hosts the moderator console. Audit records are append-only at the database boundary.
- Public REST contracts start as shared Zod schemas; controllers, OpenAPI, and SDKs derive from
  them. `/api/v1` stays stable; incompatible changes go to `/api/v2`. Use the shared envelopes.
- Moderation screening runs in a standalone BullMQ worker container on an always-on host with a
  pinned NSFWJS model, bounded execution, and fail-closed behavior. Serverless functions cannot
  host it. Readiness evidence is an owner-signed, hash-bound payload.
- Highlight read models live in Redis with engagement and moderation invalidation. Realtime events
  publish after durable commits; reconnect and ordered polling suppress duplicates.
- Feature flags check PostHog with a Postgres toggle fallback. Product analytics go to PostHog;
  operational telemetry goes through OpenTelemetry to Grafana.
- The 6.8 share card is the only shareable asset: a server-rendered, deterministic 1080x1350 PNG
  with only core chunks, so it holds no EXIF, GPS, or text metadata. The member previews its exact
  bytes and SHA256. Never screenshot UI or hand the OS bytes the member has not previewed; a
  composition change requires a fresh preview. Prepared bytes live in session-memory composition
  only, never in server or durable client storage. OS-owned asset bookkeeping stays out of
  telemetry and out of the PNG.
- Paid entitlement truth has one writer (the RevenueCat webhook plus reconciliation); the
  complimentary source sits beside that mirror so billing jobs can never downgrade or bill it.

## UX & Interaction Patterns

- Community states (loading, empty, stale, disabled, failed) never disrupt the daily ritual. Focus
  order runs hero, chips, garments, community cards.
- Feedback uses gold for success, merlot for errors, fog for informational states. Toasts sit
  top-center on mobile and top-right on desktop and auto-dismiss after 6 seconds; ARIA live regions
  announce key feedback.
- Share flows report only outcomes the platform actually confirms. A failed share shows truthful
  merlot feedback with the save path offered beside the retained preview.
- Community deep links focus the referenced visible card; invalid targets fall back to the ritual.

## Cross-Story Dependencies

- 6.1 is the community foundation; 6.2 and 6.2b supply screening and release evidence that 6.4
  consumes. 6.3 feeds 6.6, then 6.7, then 6.7b; 6.3 and 6.4 feed 6.5.
- 6.8 feeds 6.9 directly: 6.9 reuses 6.8's composer, prepared bytes, eligibility checks, and save
  path, and must keep 6.8's privacy and cancellation guarantees intact. 6.15 (Expo SDK 58) also
  touches the share-card composer and its native journeys, so coordinate if both are in flight.
- 6.10 precedes 6.11 and 6.12; 6.11 precedes 6.13. 6.14 builds on 5.2 billing, 6.5 push, and 1.2b.
- Following stays disabled until product adds follow-graph stories or drops it from the brief and
  UX. This must close before Community Beta sign-off.
