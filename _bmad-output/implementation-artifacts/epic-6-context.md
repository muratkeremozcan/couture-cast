# Epic 6 Context: Community & Moderation Loop

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn CoutureCast from a private daily ritual into a social one. This epic delivers the community
feed grouped by climate band, the engagement mechanics that let members react and comment, curated
locale highlight modules that surface standout looks, outbound social sharing of outfit cards, and
the moderation queue that keeps all of it safe. It matters because community participation is a
primary retention lever, and because none of the social surface can ship without moderation,
age-gating, and audit controls landing alongside it.

Community Beta is Phase 2 per the roadmap and opens only on the signed safety gate: moderation
staffing, SLA alerts, privacy, deletion, localization, accessibility, model, and rollback
evidence. Production read and write rollout controls stay off until every one of those eight is
signed.

## Stories

- Story 6.1: Community feed by climate band
- Story 6.2: Reactions and comments
- Story 6.3: Locale highlight modules
- Story 6.4: Social export workflows
- Story 6.5: Moderation queue and SLA tracking

## Requirements & Constraints

- Feed content groups by climate band derived from the member's current location, supports photo
  post creation with caption and locale metadata, and carries an editorially curated weekly
  challenge banner.
- Engagement is limited to a curated emoji palette plus threaded comments. Every post and comment
  exposes a report action. Aggregated reactions combined with recency drive highlight ranking.
- Social participation is gated at 13+. Age-gate enforcement and the guardian-consent scaffolding
  already used for wardrobe media apply to posting and commenting.
- Flagged content must reach the moderation queue within five minutes of the flag, and must be
  reviewed within a 24-hour SLA with alerting when that window is at risk. Review actions cover
  resolve, escalate, and ban, each with a review timestamp.
- Moderation decisions write to an immutable audit trail retained for twelve months. Planning
  material also carries a shorter 90-day figure for the moderation action history; treat twelve
  months as the retention floor and confirm before implementing anything shorter.
- Exported outfit cards use native share sheets for Pinterest, Instagram, Facebook, and TikTok,
  carry CoutureCast branding with an optional watermark, and strip personal data from the generated
  asset. Cancelling a share must not lose the composed post. A failed platform share falls back to
  saving to the camera roll or downloading, with a user-visible notice.
- Community pushes (mentions, engagement pings) are opt-in, respect quiet hours, and dispatch within
  60 seconds of the trigger.
- Moderation must handle multilingual content with per-language keyword detection and escalation to
  native-language reviewers inside the same SLA. Highlight and feed copy flows through the existing
  localization pipeline with fallback strings.
- Community uploads need auto-suggested alternative text. All community surfaces meet WCAG 2.2 AA
  for contrast, focus, and semantic structure.
- Analytics covers community actions in a privacy-safe, anonymous shape and feeds the weekly-active
  participation metric. Sharing workflows sit inside the 99.5% core-service uptime target.
- The Community Beta launch gate governs release: production read and write rollout controls stay
  disabled until moderation staffing, SLA alerts, privacy, deletion, localization, accessibility,
  model, and rollback evidence are signed.

## Technical Decisions

- Community and moderation live in a NestJS community module with a Next.js admin console for
  moderator review and a BullMQ queue for moderation work. Data lands in `lookbook_posts`,
  `engagement_events`, `moderation_events`, and `audit_log`, with moderation events linking back to
  either a post or a garment item.
- Moderation runs in-house on a NestJS console so the audit trail stays fully under our control.
  Automated image screening uses a server-side NSFW model executed in a background worker; text
  screening uses a profanity filter. Anything flagged short-circuits the publish flow and notifies
  the moderator and guardian channels. Humans review from the admin console; SLA tracking reports
  through product analytics.
- Public endpoints stay under `/api/v1`. Canonical request and response schemas start life as shared
  Zod contracts in `packages/api-client/src/contracts/http`; controllers, OpenAPI, generated SDK,
  and client wrappers derive from them. Success payloads use the shared data envelope, lists add
  pagination metadata, errors use stable codes.
- The feed streams over Socket.io using the namespaced event convention with `version` and
  `timestamp` on every payload. Socket disconnect degrades to a cached feed marked visibly stale.
- Supabase Auth plus PostgreSQL RLS enforce tenant isolation; NestJS guards enforce the role model,
  including the moderator role. Moderation decisions and data exports append immutable audit rows.
- Highlight ranking is deterministic server-side logic over reactions and recency, cached in Redis
  the way other personalization payloads are. Cache keys must not let a removed or moderated post
  survive its removal.
- Community, wardrobe, and commerce metadata aggregate into the shared search view with
  locale-specific tokens.
- Tests use deterministic factories from `@couture/testing`. Vitest owns unit, component, API,
  database, and RLS evidence. Pact protects HTTP consumer and provider understanding. Playwright and
  Maestro cover focused cross-surface journeys.

## UX & Interaction Patterns

- The community surface is the Lookbook Prism split layout: hero ritual and community feed are
  co-present on desktop, stacked with a two-column grid on tablet, and a single column with sticky
  chips on mobile. Community fetches must never block ritual rendering.
- Chips switch between Personal, Community, and Sponsored views and filter the feed (New,
  Following, Near me, Brands) without a page reload. Only the filters with defined server behavior
  are enabled in 6.1; the rest render disabled.
- The Lookbook Card carries hero image, weather and location pill, outfit description, engagement
  counts, and a CTA cluster covering save, import, applaud, and flag. It needs default, hover,
  saved, flagged, reported-with-moderation-status, and loading-skeleton states, plus a sponsorship
  label variant that is announced to screen readers.
- Feedback follows the premium accent system: gold for success confirmations, deep merlot for errors
  and destructive states including flagged content, fog neutrals for informational and sync states.
- A community push notification deep-links into the feed with the referenced card highlighted, and
  both keyboard focus and the screen-reader cursor land on that card. An invalid deep-link payload
  falls back to the hero ritual with an informational banner.
- Screen-reader and tab order run hero, chips, garments, community cards. Each card is a labelled
  region with its CTAs in the tab order. Visible gold focus rings apply throughout.
- Named edge cases: flagged content removes with a toast, network hiccups show a retry banner, and a
  failed import shows an inline error with a ghost fallback image.

## Cross-Story Dependencies

- Story 6.1 is the foundation. Stories 6.2, 6.4, and 6.5 all build on the post model and feed it
  establishes; run 6.1 through 6.3 in order before enabling export and moderation.
- Story 6.3 consumes the reaction aggregates from 6.2 and the localization framework from Epic 3.
- Story 6.4 depends on the shareable outfit card from Epic 2 alongside the feed from 6.1.
- Story 6.5 depends on the flag capture in 6.1 and the telemetry and audit baseline from Epic 1.
- Epic 3 supplies the responsive split layout, chip and bottom navigation, localization, deep-link
  handling, and accessibility hardening. Epic 4 supplies the garment and image capture pipeline that
  community posts reuse, including its consent, retention, and NSFW screening path.
- Delivery note (2026-09-05): Epics 4 and 5 were built ahead of their Phase 3 label; CC-4.1 through
  CC-5.5 are already `done`. Cross-phase prerequisites recorded on CC-3.7 and CC-6.1 are satisfied
  by that early delivery and do not gate the Phase 2 Community Beta.
