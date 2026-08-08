# Epic 4 Context: Wardrobe Capture & Closet Tools

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable users to build a secure digital closet that enriches weather-aware outfit
recommendations. The epic moves wardrobe data from captured images through confirmed garment
metadata into reusable outfit capsules and onboarding. It must preserve user ownership,
retention controls, guardian consent, accessibility, localization, and responsive behavior across
Web and Mobile.

## Stories

- Story 4.1: Garment capture flow
- Story 4.2: Smart tagging and comfort metadata
- Story 4.3: Outfit capsule builder
- Story 4.4: Wardrobe onboarding and silhouette setup

## Requirements & Constraints

- Users can capture garments through camera or photo import, confirm category and comfort
  metadata, assemble reusable capsules, rename and favorite saved outfits, and surface qualifying
  capsules in recommendations.
- Garment images and derived wardrobe data are private personal data. Every stored object and row
  must retain ownership metadata, enforce retention state, and honor guardian consent boundaries.
- Recommendation behavior must respect wardrobe availability and preserve a deterministic fallback
  when personalization data or supporting services are unavailable.
- User-visible wardrobe changes must remain responsive on modern mobile networks. The broader
  product target is first contentful paint under two seconds on current reference devices.
- Web and Mobile surfaces must satisfy WCAG 2.2 AA for contrast, focus, and semantic structure.
  Interactive targets are at least 44 pixels. Dynamic outfit content requires screen-reader
  labels and announcements.
- Localized surfaces support the established translation pipeline, fallback rules, regional units,
  and human review for critical copy.
- Analytics may measure wardrobe and recommendation use. Telemetry must remain privacy-safe and
  must not expose wardrobe images, authored descriptions, or other sensitive payloads.
- The platform must degrade safely when Redis, personalization, media processing, or analytics is
  unavailable. A supporting dependency failure cannot corrupt or block an otherwise valid core
  wardrobe mutation.

## Technical Decisions

- Supabase-managed PostgreSQL and Prisma own wardrobe metadata. Supabase Storage owns private media.
  PostgreSQL RLS and NestJS authorization guards jointly enforce tenant and guardian boundaries.
- Public endpoints live under `/api/v1`. Canonical request and response schemas live in
  `packages/api-client/src/contracts/http`. Controllers, OpenAPI, generated clients, and client
  wrappers derive from those schemas.
- NestJS features separate transport, business logic, and persistence. Public responses use the
  shared data envelope and stable error codes.
- PostgreSQL full-text search and trigram indexes provide the initial wardrobe search path.
- Personalization uses deterministic NestJS domain logic with Redis caching. Cache keys and
  persisted recommendation state must prevent stale wardrobe data from surviving committed
  changes.
- PostHog receives Web, Mobile, and server analytics. Events use explicit schemas, stable names,
  privacy-safe identifiers, and idempotent delivery behavior.
- Tests use deterministic factories from `@couture/testing`. Vitest owns unit, component, API,
  database, and RLS evidence. Pact protects HTTP consumer and provider understanding. Playwright
  and Maestro cover focused cross-surface journeys. k6 owns executable load thresholds.

## UX & Interaction Patterns

- Mobile uses a single-column wardrobe flow with one-handed interactions. Tablet and desktop can
  use grid or split layouts while preserving the same information hierarchy.
- Garment and outfit tiles expose clear selected, loading, disabled, missing-image, and error
  states. Feedback uses status announcements for success and alerts for errors.
- Modal and bottom-sheet workflows trap focus, restore focus to the invoking control, support
  Escape where applicable, and keep validation next to the affected field.
- Keyboard order follows the visible hierarchy. Visible gold focus rings, reduced-motion behavior,
  screen-reader order, and descriptive garment labels remain consistent across wardrobe flows.

## Cross-Story Dependencies

- Story 4.2 depends on the garment records and upload lifecycle from Story 4.1.
- Story 4.3 depends on confirmed category and comfort metadata from Story 4.2 and feeds the existing
  outfit recommendation engine.
- Story 4.4 reuses garment capture and confirmed metadata from Stories 4.1 and 4.2. Its silhouette
  and photo paths inherit the same privacy, moderation, retention, and accessibility controls.
- Epic 2 supplies scenario recommendations and comfort calibration. Epic 3 supplies localization,
  responsive cross-surface foundations, and accessibility hardening.
