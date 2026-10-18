# Epic 6 Context: Community & Moderation Loop (Phase 2)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Deliver climate-relevant community inspiration through posts, reactions, comments, ranked highlights,
and branded sharing, backed by safe publication and accountable moderation. Community Beta opens
only when staffing, SLA alerts, privacy, deletion, localization, accessibility, model, and rollback
evidence are signed. Production read and write rollout controls remain disabled until all eight
release gates close.

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

## Requirements & Constraints

- Main CoutureCast and community participation require age 13+. Uploads additionally enforce the
  applicable guardian-consent policy for under-16 members.
- Climate-band feeds support photo posts, locale metadata, and editorial weekly challenges.
  Reactions use a closed emoji palette, one current reaction per member and post, exact aggregates,
  and retry-safe replacement and removal. Visibility changes invalidate feed and highlight caches.
- Comments support one reply level, stable pagination, screening before publication, deletion
  tombstones, and reporting. Accepted reports reach moderation within five minutes; human review
  has a 24-hour SLA with at-risk and breach escalation.
- Moderator access is role restricted. Decisions require an attributed reason, serialize conflicts,
  and preserve immutable history for at least 12 months. Account erasure removes personal content
  and anonymizes subject and reporter identities within 72 hours.
- Spotlight ranking is deterministic from reactions and recency, uses coarse location and a defined
  privacy cohort, and offers sponsored affiliate CTAs only when eligible sponsorship exists.
- Exported cards preserve luxury branding and optional watermark while removing personal data,
  exact location, source metadata, identifiers, and signed media URLs. Cancellation preserves the
  composition; failed sharing offers camera-roll save or web download.
- Engagement pushes require opt-in and quiet-hour controls, dispatch within 60 seconds, and clean
  up invalid tokens. Community analytics use anonymous, privacy-safe, deduplicated signals.
- English, Spanish, and French are launch locales. Screening handles obfuscation and escalates
  unsupported language or uncertain results. Localized, accessible web and mobile controls include
  upload alternative text, clear focus, and screen-reader feedback.

## Technical Decisions

- NestJS owns community decisions; Supabase PostgreSQL and Prisma provide persistence, with RLS
  isolation and authenticated role guards. Next.js supplies the moderator console. Audit records
  are append-only at the database boundary.
- Public HTTP contracts start in shared Zod schemas under `packages/api-client/src/contracts/http`.
  Controllers, OpenAPI, SDKs, and wrappers derive from them. `/api/v1` remains stable; incompatible
  changes require `/api/v2`. Use shared success, pagination, and stable error envelopes.
- Moderation uses an in-house console and a standalone BullMQ worker. The worker deploys as an
  unprivileged container under `tini` on an always-on host: Northflank first, Oracle Always Free
  if memory requires it, then Railway. HTTP serverless instances cannot host its process.
- The screening worker uses a pinned NSFWJS model with TensorFlow.js WASM, bounded execution, and
  fail-closed unavailability. Its container has a traced dependency budget, one replica at
  concurrency one, and a 512 MiB resource envelope. Build identity must be provable through a
  deployed canary.
- Model readiness uses a policy-surface sweep, a creator-separated licensed safe-image holdout,
  pinned public text lists with provenance, obfuscation checks, and an immutable evidence payload
  signed by the repository owner against its hash. Stale or partial evidence fails closed. Recorded
  limitations include unmeasured real-unsafe-image recall, stock-photo coverage, community text-list
  provenance, and two-moderator beta staffing. Detailed thresholds and measurements belong to the
  generated model-readiness evidence.
- Production Redis uses Upstash Pay as You Go. Worker blocking and stalled checks are tuned for
  that billing model; the screening worker's projected idle-plus-traffic cost ceiling is USD 5 per
  month. Shared API queue commands are outside that measurement.
- Highlight read models use Redis with engagement and moderation invalidation. Realtime events
  publish after durable commits with version and timestamp; reconnect and ordered polling fallback
  suppress duplicates. Community reads remain independent of ritual loading.

## UX & Interaction Patterns

- Lookbook Prism shows ritual and community together on desktop and stacks them on smaller
  screens. Loading, empty, stale, disabled, and failed community states preserve the daily ritual.
- Cards expose weather/location context, engagement counts, accessible applause and report actions,
  and sponsorship disclosure. Use gold success and focus cues, merlot errors, and fog informational
  states. Screen-reader and keyboard order follows hero, chips, garments, community cards.
- Community deep links focus the referenced visible card. Invalid targets fall back to the ritual
  with informational feedback. Disabled filters clearly communicate availability.

## Cross-Story Dependencies

- Story 6.1 supplies the community foundation. Stories 6.2 and 6.2b supply production screening and
  release evidence; comments consume that screening boundary.
- Reactions feed City Spotlight, then the Home teaser. Realtime consumes durable reaction and
  comment writes. Safe export precedes native sharing.
- Moderator queue precedes decisions and SLA monitoring; decisions precede immutable-history proof.
  Localization, accessibility, deep links, consent, image capture, and affiliate infrastructure come
  from earlier epics, including already-delivered Epics 4 and 5.
- Following remains disabled pending separately sized follow-graph and profile stories or a product
  amendment removing that promise. Resolve this before Community Beta sign-off.
