<!-- Step 1 step 5 owner: searchable owner anchor -->

# CoutureCast - Epic Breakdown

**Author:** John – Product Manager (BMAD Method v6)  
**Date:** November 2025  
**Project Level:** Level 3  
**Target Scale:** 2–3 cross-functional squads with shared moderation support

_Updated: 2026-11-21: added Epic 7 from tester and owner feedback._

_Updated: 2026-10-23: moved CC-6.7's sponsored CTA to new CC-6.7b; no post sponsorship model existed._

_Updated: 2026-10-22: added CC-1.2b client location capture, found during CC-6.6 review._

_Updated: 2026-10-22: added CC-6.14 complimentary full access for owner-selected testers._

_Updated: 2026-09-06: re-sliced the remaining Epic 6 work from the shipped Story 6.1 baseline._

---

## Overview

This document expands the CoutureCast PRD into epics and stories sized for 200k-context development agents. Each epic captures a coherent slice of value, and every story is vertically sliced with clear acceptance criteria, sequencing, and prerequisites.

**Epic sequencing anchors**

- **Epic 0** provisions infrastructure, test environments, and foundational services required for all feature development (Sprint 0).
- **Epic 1** establishes the weather backbone, telemetry, and service guardrails that all other experiences depend on.
- **Epic 2** layers in the personalization engine that delivers daily outfit value.
- **Epic 3** surfaces that value across devices and locales to satisfy the MVP promise.
- **Epic 4** deepens wardrobe data once the core loop is stable.
- **Epic 5** unlocks commerce and premium monetization pathways.
- **Epic 6** builds the community flywheel and moderation controls.
- **Epic 7** makes the app calm, reliable and useful before the first upload.

---

## Epic 0 — Platform Foundation & Infrastructure (Sprint 0)

Establish the technical foundation, test environments, and development infrastructure required before feature development can begin. All Epic 0 stories must complete before Epic 1 starts.

**Stories**

**Story CC-0.1: Initialize Turborepo monorepo**
As a platform team, we need a monorepo structure with shared packages so that all teams can develop features in parallel.
**Acceptance Criteria**

1. **FIRST:** Refresh version verification log from architecture document (re-run all `npm info` and version commands); update architecture doc if any versions have changed since 2025-11-11.
2. Execute starter template commands per architecture using verified versions (create-expo-app@3.10.1, create-next-app@15.0.3, @nestjs/cli@11.1.2).
3. Configure Turborepo workspace with apps (mobile, web, api) and packages (db, tokens, ui-web, api-client, testing).
4. Set up npm workspaces, shared ESLint config, TypeScript configs, and turbo.json task graph (lint → test → build).
5. Verify `npm run dev` starts all apps; `npm test` runs all test suites; `npm run build` produces deployable artifacts.
6. Lock all dependency versions in package.json files to match verified versions; commit package-lock.json.
   **Prerequisites:** None (foundational story).

**Story CC-0.2: Configure Prisma schema, migrations, and seed data**
As a developer, I need a shared database schema and migration tooling so that all apps use consistent data models.
**Acceptance Criteria**

1. Create ` with core tables: users, user_profiles, guardian_consent, weather_snapshots, forecast_segments, comfort_preferences, garment_items, palette_insights, outfit_recommendations, lookbook_posts, engagement_events, moderation_events, audit_log.
2. Define relationships per architecture Data Architecture section; enforce `user_id` column on all user-scoped tables.
3. Create initial migration (`prisma migrate dev --name init`); verify migration applies cleanly to local Postgres.
4. Implement seed scripts (`prisma/seeds/`) with coverage per test-design-system.md: 5 teens, 3 guardians, 50 wardrobe items, 20 rituals, 10 weather snapshots, 8 feature flags.
5. Provide `npm run db:migrate`, `npm run db:seed`, `npm run db:reset` scripts.
   **Prerequisites:** CC-0.1 (monorepo structure), CC-0.3 (Supabase projects created).

**Story CC-0.3: Set up Supabase projects (dev/staging/prod)**
As a platform team, we need Supabase infrastructure across environments so that developers can test locally and deploy to production.
**Acceptance Criteria**

1. Create three Supabase projects: dev (wiped weekly), staging (anonymized snapshots), prod (live user data).
2. Configure Storage buckets: `wardrobe-images`, `derived-assets`, `community-uploads` with RLS policies per ADR-004.
3. Set up Supabase local development via Supabase CLI (`npx supabase start`); document access in README.
4. Configure database connection pooling (max 100 connections per environment) and backups (PITR enabled for prod).
5. Document environment URLs, service keys, and access credentials in gitignored `.env` files for local development and GitHub/provider-native secret stores for CI/deployments.
   **Prerequisites:** CC-0.1 (monorepo for config files).

**Story CC-0.4: Configure Redis (Upstash) and BullMQ queues**
As a backend developer, I need Redis caching and job queues so that personalization and alerts scale efficiently.
**Acceptance Criteria**

1. Provision Upstash Redis instances: local (Docker Compose), CI (Testcontainers), dev/staging/prod (Upstash cloud).
2. Configure BullMQ queues: `weather-ingestion`, `alert-fanout`, `color-extraction`, `moderation-review` with 3x retry policy (1s, 5s, 25s exponential backoff).
3. Set concurrency limits per ADR-003: max 5 workers per queue; dead-letter queue for failed jobs stored in Postgres.
4. Implement worker process group in NestJS with graceful shutdown handling.
5. Document queue monitoring strategy (Grafana dashboards for queue depth, job latency).
   **Prerequisites:** CC-0.2 (Postgres for DLQ storage), CC-0.3 (Supabase connection).

**Story CC-0.5: Initialize Socket.io gateway and Expo Push API**
As a developer, I need real-time communication infrastructure so that users receive weather alerts and community updates instantly.
**Acceptance Criteria**

1. Configure Socket.io server in NestJS with namespace strategy per ADR-007 (`lookbook:new`, `ritual:update`, `alert:weather`).
2. Implement connection lifecycle (connect, disconnect, reconnect with exponential backoff 1s, 3s, 9s; max 5 retries).
3. Set up Expo Push API credentials and notification sending service (push token registration, batch notification dispatch).
4. Create shared payload schema for events (version, timestamp, userId, data) and enforce in TypeScript types.
5. Test connection fallback: Socket.io disconnect → polling mode activated; reconnect → resume Socket.io stream.
   **Prerequisites:** CC-0.1 (NestJS API scaffold).

**Story CC-0.6: Scaffold CI/CD pipelines (GitHub Actions)**
As a platform team, we need automated testing and deployment pipelines so that code quality is enforced and deploys are reliable.
**Acceptance Criteria**

1. Create `.github/workflows/test.yml` with multi-stage pipeline per test-design-system.md CI/CD Pipeline Architecture: Smoke (@p0) → Unit+Integration → E2E (@p1) → Burn-In (@p0 3x) → Load (k6).
2. Configure parallelization (4 shards for unit tests, 2 shards for E2E) and timeout limits per stage.
3. Set up deployment workflows: `deploy-web.yml` (Vercel web+API serverless), `deploy-mobile.yml` (Expo EAS) triggered on main branch merges.
4. Configure artifact retention per test-design-system.md: traces (7d/30d), videos (14d), reports (90d), JUnit XML (365d) with S3 lifecycle policies.
5. Implement failure triage: Slack alerts (#test-failures, #flaky-tests) and PagerDuty for smoke test failures.
   **Prerequisites:** CC-0.1 (monorepo), CC-0.2 (Prisma), CC-0.10 (test fixtures for CI).

**Story CC-0.7: Configure PostHog, OpenTelemetry, and Grafana Cloud**
As a product team, we need analytics and observability infrastructure so that we can track success metrics and monitor system health.
**Acceptance Criteria**

1. Create PostHog projects: test (CI/dev/staging), production; configure SDK integration in Expo and Next.js apps.
2. Implement event schema per test-design-system.md Analytics Validation Strategy: `ritual_created`, `wardrobe_upload_started`, `alert_received`, `moderation_action`, `guardian_consent_granted`.
3. Set up OpenTelemetry exporters in NestJS (Pino logs → OTLP → Grafana Cloud) with structured logging (timestamp, requestId, userId, feature).
4. Create Grafana dashboards for: queue depth, cache hit rate, Socket.io disconnects, API latency, database query time with alert thresholds per test-design-system.md Performance Baselines.
5. Configure PostHog feature flags with offline mode fallback for tests per ADR-011.
   **Prerequisites:** CC-0.1 (apps scaffold), CC-0.4 (BullMQ for queue metrics).

**Story CC-0.8: Document env and secret management workflow**
As a security-conscious team, we need a simple documented secret-management workflow so that credentials stay secure across environments without adding extra paid tooling.
**Acceptance Criteria**

1. Standardize gitignored `.env` files for local development and keep `.env.example` as the canonical list of required variables.
2. Use GitHub Actions secrets for CI and provider-native secret stores for hosted environments; no standalone secret manager is required.
3. Keep `gitleaks`-based secret scanning in local workflows and CI.
4. Document quarterly secret rotation and incident-response procedures for leaked or revoked credentials.
5. Enforce least-privilege service keys for Supabase Storage and other hosted services.
   **Prerequisites:** CC-0.3 (Supabase projects), CC-0.4 (Redis credentials).

**Story CC-0.9: Initialize OpenAPI spec generation and API client SDK**
As a frontend developer, I need type-safe API clients so that I can call backend endpoints without manual typing errors.
**Acceptance Criteria**

1. Expose `/api/v1/openapi.json` during Story 0 while transitioning toward canonical shared Zod contracts as the permanent source of truth.
2. Define canonical request/response contracts as shared Zod schemas and derive the OpenAPI spec at `/api/v1/openapi.json` from those contracts rather than controller decorators.
3. Generate a TypeScript SDK from the canonical contract-derived spec and publish it to the npm workspace for web/mobile use.
4. Implement automated OpenAPI diff checks in CI (fail PR if breaking changes are introduced without a versioning decision).
5. Document API versioning strategy: `/api/v1` stable; `/api/v2` for breaking changes; 90-day deprecation notice; shared Zod contracts are the source of truth.
   **Prerequisites:** CC-0.1 (NestJS API scaffold).

**Story CC-0.10: Implement test fixture factories and seed data**
As a test engineer, I need composable fixture factories so that tests don't hardcode data and become brittle.
**Acceptance Criteria**

1. Create factory pattern in ` for core entities: User (teen/guardian variants), WardrobeItem, Ritual, Weather using pure function → fixture → merge composition per test-design-system.md fixture-architecture guidance.
2. Implement cleanup discipline pattern: `afterEach` cleanup template with reverse-order deletion (items → users).
3. Create Prisma seed scripts using factories in ` with coverage: 5 teens, 3 guardians, 50 wardrobe items, 20 rituals, 10 weather snapshots, 8 feature flags.
4. Document factory usage in test templates with examples (e.g., `createUser({ role: 'teen', age: 15 })`).
5. Enforce factory usage in test code review checklist (no hardcoded test data allowed).
   **Prerequisites:** CC-0.2 (Prisma schema), CC-0.3 (Supabase test project).

**Story CC-0.11: Implement guardian consent flow and RLS policies**
As Compliance, we need guardian consent enforcement for under-16 users so that CoutureCast satisfies COPPA requirements and age-gating obligations.
**Acceptance Criteria**

1. Implement age verification on signup: users enter birthdate → calculate age → block if <13, flag if 13-15 (requires guardian), allow if 16+.
2. Create guardian invitation flow: teen account created in "pending consent" state → guardian receives email invite → guardian accepts → consent timestamp recorded in `guardian_consent` table with `guardian_id`, `teen_id`, `timestamp`, `ip_address`.
3. Implement RLS policies per ADR-004 and test-design-system.md Guardian Consent Flow Edge Cases:
   - Teen can only access own wardrobe unless guardian linked
   - Guardian can access linked teen's wardrobe (read-only or full access based on consent level)
   - Cross-account access denial enforced
4. Create immutable audit log entries for all consent events (grant, revoke, guardian deleted) per test-design-system.md Audit Log Verification.
5. Implement consent revocation: guardian revokes → teen session invalidated → wardrobe inaccessible → audit log records revocation.
6. Add test coverage per test-design-system.md: single guardian happy path, revocation mid-session, multiple guardians, teen turns 18, consent audit trail, age verification failure (7 test cases).
   **Prerequisites:** CC-0.2 (Prisma schema with guardian_consent table), CC-0.3 (Supabase Auth + RLS), CC-0.7 (PostHog for `guardian_consent_granted` event).

**Story CC-0.12: Provision test environments and harness services**
As a test engineer, I need isolated test environments so that tests run deterministically without affecting production.
**Acceptance Criteria**

1. Provision 6 test environments per test-design-system.md Test Environment Requirements:
   - Supabase test project with anonymized fixtures and RLS parity
   - Weather provider harness (stub service replaying OpenWeather payloads, emitting 429/500 on demand)
   - BullMQ/Redis sandbox (synthetic jobs, no prod queue access)
   - Media pipeline lab (Sharp/ONNX with GPU fallback for CI)
   - Cross-surface device matrix (Playwright browsers, Expo simulators, watch emulator)
   - Localization snapshot suite (locale bundles, disclosure templates)
2. Document access/runbooks for each environment in `_bmad-output/test-artifacts/test-environments.md`.
3. Implement weather harness as `with fixture loading from`4. Configure CI to use stub provider (no real API calls); dev/staging use real OpenWeather test API key.
4. Validate environment readiness: run smoke tests in each environment and confirm pass.
   **Prerequisites:** CC-0.3 (Supabase), CC-0.4 (Redis), CC-0.7 (PostHog test project), CC-0.10 (fixture factories).

**Story CC-0.13: Scaffold cross-surface E2E automation**
As the master test architect, I need baseline Playwright (web) and Maestro (mobile) harnesses so that we can validate apps end-to-end before Epic 1 work begins.
**Acceptance Criteria**

1. Add Playwright (Chromium-only for now) at the repo root with a shared `playwright/config` directory, smoke spec hitting the Next.js landing route, and scripts `npm run test:pw-local` / `TEST_ENV=<env> npm run test:pw` that build, serve, and execute the tests headlessly per \_bmad-output/test-artifacts/test-design-system.md Test Framework guidance.
2. Add Maestro scaffolding under `maestro/` with a `sanity.yaml` flow launching the Expo app via Expo Router dev server URL injected through env vars, plus scripts `npm run test:e2e:mobile` / `npm run test:e2e:mobile:ci` that install the Maestro CLI and run the smoke flow locally and in CI.
3. Update root documentation (README + `_bmad-output/test-artifacts/test-design-system.md`) with prerequisites for local emulators/Maestro Cloud, describe how developers run both smoke suites concurrently with `npm run dev`, and add new commands to the scripts table.
4. Extend `.github/workflows/pr-checks.yml` with an `e2e` job that reuses the install cache, builds once, runs Playwright + Maestro smoke commands, captures HTML/log artifacts, and is marked optional until suites stabilize.
   **Prerequisites:** CC-0.1 (monorepo scaffold), CC-0.5 (Turborepo/task graph), CC-0.6 (CI skeleton), CC-0.10 (fixture factories once data seeds land).

**Story CC-0.14: Expand test infrastructure for auth-session, burn-in, contract, performance, and PR review automation**
As the master test architect, I need to mature the post-scaffold testing stack so that
auth-backed E2E, CI burn-in reliability, contract checks, and performance baselines are
production-ready.
**Acceptance Criteria**

1. Harden `.github/workflows/rwf-burn-in.yml` (SHA ordering, stable changed-spec handling, deterministic reporting) while preserving existing PR gating behavior.
2. Roll out `auth-session` for login-backed Playwright journeys while keeping explicit unauthenticated/security-negative tests out of auth-session.
3. Add API contract-testing baseline (OpenAPI schema + Pact consumer/provider verification) in CI as non-blocking first, with promotion criteria to required gates.
4. Add performance-testing baseline (k6 scenarios, thresholds, artifacts) in a non-blocking workflow mode (nightly/manual) with promotion criteria.
5. Add Maestro analytics journey coverage and define objective reliability criteria for promotion from manual/local-only to PR optional gating.
6. Add CodeRabbit PR-review automation with repository config and path-scoped instructions focused on test/CI-risk changes, starting advisory before any merge-blocking policy.
   **Prerequisites:** CC-0.6 (CI workflows), CC-0.7 (analytics events), CC-0.11 (auth-backed user journeys), CC-0.12 (test environment readiness), CC-0.13 (baseline E2E scaffolding).

---

## Epic 1 — Weather Intelligence & Platform Foundation (Phase 1)

Deliver resilient weather data ingestion, location preferences, alerting, and the analytics backbone required for downstream features.

**Stories**

**Story CC-1.1: Weather API ingestion service**  
As a daily planner, I want CoutureCast to pull accurate current/hourly forecasts for my location so that outfit guidance reflects real conditions.  
**Acceptance Criteria**

1. Ingest OpenWeather (or configured provider) current + 48-hour hourly data via scheduled job every ≤30 minutes.
2. Persist latest payload with timestamp; expose fallback message when data older than 60 minutes.
3. Log API latency, error rate, and rate-limit responses to telemetry store.  
   **Prerequisites:** None.

**Story CC-1.2: Multi-location preferences**  
As a commuter, I want to save and switch between several cities so that I can plan home and office outfits easily.  
**Acceptance Criteria**

1. Location store supports at least three saved places with friendly labels.
2. Switching updates primary forecast context within two taps and persists preference.
3. Widgets/watch refresh to reflect selected location within 5 minutes.  
   **Prerequisites:** CC-1.1.

**Story CC-1.2b: Client location capture**
As a member, I want to add and choose my city on web and mobile so that my daily ritual, climate band
and City Spotlight use where I actually am.
**Acceptance Criteria**

1. Web and mobile let a member search for and save a location through the existing locations API,
   storing provider-resolved coordinates, timezone, and canonical city, region, and country; a member
   with no saved location is guided to add one instead of seeing a ritual error.
2. The member can mark one saved location primary and switch between saved locations within two
   taps on both platforms, with localized, accessible controls in every supported locale.
3. Prove with Pact, API, Playwright, and Maestro tests that a location saved through the product UI
   drives the ritual, the community climate band, and City Spotlight area stamping.
   **Prerequisites:** CC-1.2, CC-6.6.

**Story CC-1.3: Alert rules & notification pipeline**  
As a user, I want timely alerts for major weather shifts so that I can adjust my wardrobe plan quickly.  
**Acceptance Criteria**

1. Support alert rules for temperature delta, precipitation start, and severe conditions with configurable thresholds.
2. Generate push notification payloads and in-app alert cards within 60 seconds of rule trigger.
3. Respect quiet hours/opt-out preferences and log send outcomes to analytics.  
   **Prerequisites:** CC-1.1 (data freshness), CC-1.2 (active location context).

**Story CC-1.4: Telemetry & audit baseline**  
As the product team, we need activation, forecast view, and alert delivery metrics so that we can track success criteria.  
**Acceptance Criteria**

1. Instrument activation funnel (profile complete + first outfit) and forecast view counts.
2. Capture alert sends/deliveries, location switches, and API error counts in analytics store with 24-hour retention minimum.
3. Provide dashboard-friendly schema and retention policy aligned with FR7.  
   **Prerequisites:** CC-1.1–CC-1.3 for event sources.

---

## Epic 2 — Outfit Personalization Core (Phase 1)

Transform weather and wardrobe inputs into actionable scenario-based outfit recommendations.

**Stories**

**Story CC-2.1: Scenario outfit generator**  
As a style-seeker, I want distinct outfit cards for morning, midday, and evening so that each part of my day is covered.  
**Acceptance Criteria**

1. Generate three scenario cards per day using weather data, wardrobe tags, and activity defaults.
2. Display garment categories, comfort notes, and reason badges for each card.
3. Regenerate recommendations when forecast update timestamp changes.  
   **Prerequisites:** CC-1.1.

**Story CC-2.2: Comfort calibration settings**
As a user who "runs cold or warm," I want to tweak comfort preferences so that outfits feel accurate.
**Acceptance Criteria**

1. Provide slider/toggle preferences for temperature sensitivity, wind tolerance, and precipitation preparedness.
2. Reflect preference changes in cards within 30 seconds, with badge explaining adjustment.
3. Persist preferences per user and feed values into generator service.
   **Prerequisites:** CC-2.1.

**Story CC-2.3: Reasoning badges & explanations**
As a user, I want to understand why an outfit is suggested so that I trust the recommendation.
**Acceptance Criteria**

1. Display badges such as "Wind layer," "Evening chill," "Rain-ready," mapped to weather triggers.
2. Provide quick explanation tooltip/modal with bullet rationale per badge.
3. Internationalize badge text through localization system.
   **Prerequisites:** CC-2.1, CC-3.2 (localization scaffolding).

---

## Epic 3 — Cross-Surface Experience & Localization (Phase 1)

_Updated: 2026-07-09 — added contract testing requirements for locations and_
_weather APIs_

Present CoutureCast recommendations consistently across mobile, web widget, watch, and supported languages.

> [!NOTE]
> **Testing Gate**: Once the consumer UI surfaces (mobile hero, web widgets,
> watch glance) start consuming the location preferences and weather APIs,
> consumer-driven contract tests (Pact) must be implemented to establish API
> contracts and prevent client-server drift.

**Stories**

**Story CC-3.1: Mobile hero experience**  
As a mobile user, I want a polished landing screen pairing weather and outfit guidance so that I can plan in seconds.  
**Acceptance Criteria**

1. Layout includes current condition, hourly ribbon, primary outfit card, and quick toggles.
2. Implements luxury visual system (typography/spacing) with responsive breakpoints.
3. Integrates analytics events for hero interactions.  
   **Prerequisites:** CC-2.1.

**Story CC-3.2: Localization infrastructure**  
As a bilingual user, I want to switch between English, Spanish, and French so that the app matches my locale.  
**Acceptance Criteria**

1. Implement i18n framework with translation bundles for EN (US/CA), ES (LatAm), FR (CA/EU).
2. Format units (°F/°C, currency) automatically per locale.
3. Provide QA checklist and fallback-to-English behavior for missing strings.  
   **Prerequisites:** CC-1.4 for telemetry of locale usage.

**Story CC-3.3: Home/lock-screen widgets**  
As a phone user, I want glanceable widgets showing the “Now” outfit and next-hour preview so that I don’t need to open the app.  
**Acceptance Criteria**

1. Deliver small/medium widget layouts with weather glyph, outfit summary, and CTA tap-through.
2. Refresh cadence matches weather service updates, with background fetch handling failures gracefully.
3. Support locale text/units and analytics tracking for taps.  
   **Prerequisites:** CC-3.2, CC-1.1, CC-2.1.

**Story CC-3.4: watchOS glance**  
As a smartwatch wearer, I want a quick outfit cue on my wrist so that I can act without pulling out my phone.  
**Acceptance Criteria**

1. Present current outfit iconography plus next-hour capsule with swipe interaction.
2. Sync with mobile app refresh and tap-through to open detailed view.
3. Support haptics for severe weather alerts and follow quiet-hour rules.  
   **Prerequisites:** CC-3.2, CC-1.3.

**Story CC-3.5: Lookbook Prism responsive layout**  
As a multi-device user, I want the hero ritual and community grid to adapt cleanly across desktop/tablet/mobile so that I never lose context.  
**Acceptance Criteria**

1. Implement split hero + community layout on ≥1280px, stacked layout on tablet/mobile, matching UX spec tokens (spacing, typography, cards).
2. Include comparison mode + mobile preview toggle exactly as documented, with animation/performance budgets.
3. Support planner rail slide-in on ultrawide screens with graceful fallback on smaller displays.  
   **Prerequisites:** CC-3.1, CC-3.3.

**Story CC-3.6: Chip navigation & sticky bottom nav**  
As a user, I want chip filters and bottom navigation to stay accessible (touch + keyboard) so that I can pivot views quickly.  
**Acceptance Criteria**

1. Build Personal/Community/Sponsored chips with scroll + snap, sticky positioning, and keyboard arrow navigation (aria-pressed semantics).
2. Implement gold-underlined bottom nav on mobile with accessibility focus ring + safe-area handling.
3. Provide state sync between chips, filters, and feed modules; analytics events fire for chip changes.  
   **Prerequisites:** CC-3.1, CC-3.2.

**Story CC-3.7: Widget / notification deep-link handling**  
As a user launching from widgets or alerts, I want to land on the relevant state so that context is preserved.  
**Acceptance Criteria**

1. Encode widget tap source + slot (e.g., `source=widget&slot=am`) and hydrate hero canvas accordingly, including offline fallback.
2. Severe-weather push deep-links open hero canvas with alert state in focus; community pings open Lookbook Prism with highlighted card.
3. Invalid/expired deep-links fail gracefully with info banner and telemetry event.  
   **Prerequisites:** CC-3.3, CC-1.3, CC-6.1.

**Story CC-3.8: Accessibility hardening**  
As Compliance, I need CoutureCast to meet WCAG 2.1 AA so that launch satisfies legal obligations.  
**Acceptance Criteria**

1. Document and implement keyboard navigation order, skip links, and focus traps for hero, chips, modals, and lookbook cards.
2. Provide alt-text pipeline for garment/hero imagery plus aria-live announcements for data refresh and feedback banners.
3. Run automated audits (axe, Lighthouse) and manual VoiceOver/TalkBack sweeps per release; log issues in QA tracker.  
   **Prerequisites:** CC-3.1–CC-3.7.

---

## Epic 4 — Wardrobe Capture & Closet Tools (Phase 3)

Enable users to build their digital closet, powering richer personalization once the MVP loop is live.

**Stories**

**Story CC-4.1: Garment capture flow**  
As a user, I want to photograph or upload clothing pieces so that CoutureCast can personalize recommendations.  
**Acceptance Criteria**

1. Camera/import workflow with cropping and auto background clean-up.
2. Store garment images securely with user ownership metadata and retention policy.
3. Surface upload completion status and integrate telemetry event.  
   **Prerequisites:** CC-3.1.

**Story CC-4.2: Smart tagging & comfort metadata**  
As a user, I want CoutureCast to suggest garment categories and comfort ranges so that setup is fast.  
**Acceptance Criteria**

1. Auto-suggest garment type, material, and temperature range with manual override.
2. Require user confirmation before saving; enforce category + comfort rating fields.
3. Feed saved metadata into outfit generator service.  
   **Prerequisites:** CC-4.1, CC-2.1.

**Story CC-4.3: Outfit capsule builder**  
As a stylist planner, I want to assemble and save favorite outfits so that I can reuse them.  
**Acceptance Criteria**

1. Allow selecting multiple garments, naming the capsule, and tagging occasions.
2. Provide search/filter to retrieve capsules; mark favorites.
3. Make capsules eligible for recommendations and analytics tracking.  
   **Prerequisites:** CC-4.2.

**Story CC-4.4: Wardrobe onboarding & silhouette setup**  
As a new user, I want a guided wardrobe import and silhouette builder so that CoutureCast reflects my body type and closet.  
**Acceptance Criteria**

1. Camera/library permission screen, background removal with manual adjust fallback, and tagging checklist as shown in UX flow.
2. Offer adjustable black silhouette plus “My Form” photo upload with privacy checks, moderation, and storage guardrails.
3. Provide retry path + inline errors for upload failures, and log onboarding completion telemetry feeding activation KPIs.  
   **Prerequisites:** CC-4.1, CC-4.2, CC-3.8 (accessibility requirements).

---

## Epic 5 — Commerce & Premium Enhancements (Phase 3)

Monetize CoutureCast through premium features, affiliate integrations, and beauty/accessory upsell moments.

**Stories**

**Story CC-5.1: Affiliate “Shop this look” CTA**  
As a brand partner, I want qualified traffic from outfit cards so that sponsored products convert.  
**Acceptance Criteria**

1. Embed disclosed “Shop this look” button on eligible cards with partner ID.
2. Track clicks and conversions via analytics + affiliate webhook.
3. Provide opt-out toggle in settings that hides CTAs.  
   **Prerequisites:** CC-2.1, CC-1.4.

**Story CC-5.2: Premium subscription lifecycle**  
As a user, I want to subscribe on mobile/web so that I can unlock advanced styling.  
**Acceptance Criteria**

1. Integrate App Store / Play billing + web Stripe checkout with entitlement sync ≤2 minutes.
2. Support upgrade, downgrade, and cancellation flows with receipts stored securely.
3. Gate Premium-only surfaces (7-day planner, themes, palette analysis) with entitlement check.  
   **Prerequisites:** CC-5.1, CC-1.4.

**Story CC-5.3: Premium theme switcher**  
As a Premium subscriber, I want optional interface palettes (e.g., Midnight Noir) so that the app matches my aesthetic.  
**Acceptance Criteria**

1. Provide theme gallery respecting brand guidelines and WCAG AA contrast.
2. Apply chosen palette across mobile/web/watch instantly with persistence.
3. Fall back gracefully to default theme if asset missing.  
   **Prerequisites:** CC-5.2, CC-3.1 for styling tokens.

**Story CC-5.4: Color palette & beauty/accessory advisor**
As a Premium user, I want makeup and accessory suggestions tailored to my tones so that I complete the look.
**Acceptance Criteria**

1. Accept selfie or wardrobe feed to derive undertone palette with explicit consent flow.
2. Recommend foundation/blush shades and accessory pairings with optional sponsored links.
3. Provide clear disclosure for sponsored suggestions and allow user to dismiss/save.
   **Prerequisites:** CC-4.1 (wardrobe data), CC-5.2.

**Story CC-5.5: Premium 7-day outfit planner**
As a Premium subscriber, I want to preview outfits for the week so that I can plan ahead.
**Acceptance Criteria**

1. Generate seven daily cards with scrollable layout and scenario summary per day.
2. Include "reshuffle" action that re-runs recommendations while respecting wardrobe availability.
3. Gate access behind Premium entitlement check and audit usage for analytics.
   **Prerequisites:** CC-2.1, CC-2.2, CC-5.2.

---

## Epic 6 — Community & Moderation Loop (Phase 2)

Launch the community feed, engagement mechanics, and moderation controls supporting social growth.

**Stories**

**Story CC-6.1: Community feed by climate band**  
As a style explorer, I want a feed of looks from similar weather regions so that inspiration stays relevant.  
**Acceptance Criteria**

1. Group content by climate band (e.g., cold/wet, temperate) using current location.
2. Support photo post creation with caption and locale metadata.
3. Surface weekly challenge banner curated by editorial team.  
   **Prerequisites:** CC-3.1, CC-4.1.

**Story CC-6.2: Production content-screening readiness**
As a trust and safety operator, I want production-grade image and text screening so that Community
Beta can publish safe content without routing every submission to manual review.
**Acceptance Criteria**

1. Integrate the ADR-013 image screener into the standalone moderation worker with a pinned model
   identity, bounded execution time, and fail-closed unavailable behavior.
2. Screen caption and alt text for every enabled Community Beta locale, including documented
   obfuscation cases and escalation for languages or confidence levels requiring human review.
3. Prove model startup, retry, latency, false-positive, false-negative, and degraded-mode behavior
   with versioned fixtures and produce the signed model-readiness evidence for the beta gate.
   **Prerequisites:** CC-6.1, CC-0.4, CC-1.4.

**Story CC-6.2b: Community screening release gate and worker deployment**
As the operator, I want the screening pipeline deployed and gated by evidence I can actually produce,
so that Community Beta can open without waiting on assets and approvals this project cannot obtain.
**Acceptance Criteria**

1. Deploy the community moderation worker as a container on a long-running host, prove it with a
   canary job, and document its readiness, rollback, and incident procedure.
2. Replace the unobtainable release evidence with achievable equivalents: an exhaustive policy-surface
   sweep in place of an unsafe-image corpus, a 250-image openly licensed safe corpus for the
   false-positive gate, and text lists with pinned public provenance.
3. Generate one immutable evidence payload with named limitations and record a single owner signature
   bound to its hash, keeping both production rollout flags disabled.
   **Prerequisites:** CC-6.2.

**Story CC-6.3: Curated reactions**
As a community member, I want to applaud a look with a curated reaction so that I can engage quickly
and contribute a trustworthy ranking signal.
**Acceptance Criteria**

1. Provide a closed emoji palette with one current reaction per member and post; replacement,
   removal, and retried requests are idempotent.
2. Return exact per-emoji and total aggregates on feed items, and invalidate affected feed and
   highlight caches when a post leaves public visibility.
3. Enforce the 13+ participation gate, emit privacy-safe deduplicated analytics, and deliver
   accessible reaction controls on web and mobile.
   **Prerequisites:** CC-6.1.

**Story CC-6.4: Threaded comments**
As a community member, I want to discuss a look in a readable thread so that I can exchange useful
style feedback safely.
**Acceptance Criteria**

1. Create and keyset-page top-level comments with one reply level; stable ordering prevents gaps or
   duplicates during concurrent writes.
2. Screen text before publication, preserve thread shape with author-deletion tombstones, and expose
   a report action on every visible comment.
3. Route accepted reports to moderation within five minutes, enforce age and consent rules, emit
   privacy-safe analytics, and deliver accessible web and mobile states.
   **Prerequisites:** CC-6.1, CC-6.2.

**Story CC-6.5: Realtime engagement and notifications**
As a community member, I want new posts and engagement updates to arrive promptly so that the feed
feels current and relevant.
**Acceptance Criteria**

1. Publish versioned new-post, reaction, and comment events after durable commits; reconnect and
   polling fallback preserve order and suppress duplicates.
2. Send opt-in engagement notifications within 60 seconds while honoring quiet hours and invalid
   token cleanup.
3. Deep-link to the visible target with keyboard and screen-reader focus, and record delivery,
   fallback, and failure telemetry without sensitive content.
   **Prerequisites:** CC-6.3, CC-6.4, CC-3.7.

**Story CC-6.6: Community City Spotlight**
As a community member, I want a ranked City Spotlight in the Community tab so that standout local
looks surface quickly.
**Acceptance Criteria**

1. Rank eligible published posts through deterministic reaction and recency scoring with a pinned
   time window, tie breaker, coarse location source, and documented minimum privacy cohort.
2. Cache the ranked read model in Redis and invalidate it when engagement changes or moderation
   removes a post.
3. Deliver a localized, paginated Community tab module with an accessible View more path and
   privacy-safe impression and open analytics.
   **Prerequisites:** CC-6.3, CC-3.2.

**Story CC-6.7: Home spotlight teaser**
As a user, I want a compact spotlight on Home so that I can discover community inspiration without
interrupting my daily ritual.
**Acceptance Criteria**

1. Render the spotlight independently of hero loading and preserve the existing Home experience
   when highlight data is empty, stale, disabled, or unavailable.
2. Link the teaser to the corresponding Community result and maintain focus and screen-reader
   context across navigation.
3. Localize every state on web and mobile. The sponsored affiliate CTA moved to CC-6.7b.
   **Prerequisites:** CC-6.6, CC-3.2.

**Story CC-6.7b: Sponsored community highlights**
As a member, I want sponsored community highlights to be clearly disclosed so that I can trust what
I see and shop a look only when I choose to.
**Acceptance Criteria**

1. Link a community post to an eligible affiliate offer with an effective window, partner status
   checks, and an owner-only audited way to create and end the link.
2. Show a disclosed affiliate CTA on community cards, the City Spotlight, and the Home teaser only
   when the post's sponsorship is eligible for the viewer, honoring the commerce flag and opt-out.
3. Record privacy-safe click analytics through the existing affiliate click flow with a community
   surface, and localize and announce every state on web and mobile.
   **Prerequisites:** CC-6.7, CC-5.1.

**Story CC-6.8: Safe branded share-card export**
As a trendsetter, I want to create and save a privacy-safe CoutureCast card so that I control the
asset before sharing it.
**Acceptance Criteria**

1. Render a deterministic branded card from an eligible outfit or community post with an optional
   watermark and a localized preview.
2. Strip source metadata, exact location, user identifiers, signed media URLs, and other personal
   fields from both pixels and exported metadata.
3. Save to the camera roll on iOS and Android or download on web with explicit permission,
   cancellation, storage-failure, and accessibility states.
   **Prerequisites:** CC-6.1, CC-2.1, CC-3.2.

**Story CC-6.9: Native platform sharing**
As a trendsetter, I want to send my prepared card through an available social app so that friends
can see the look.
**Acceptance Criteria**

1. Invoke the native share sheet for Pinterest, Instagram, Facebook, and TikTok targets when the
   operating system exposes them, with a generic system-share path for other compatible apps.
2. Preserve the prepared card and composition state when a member cancels, the target is absent, or
   the handoff fails.
3. Offer the Story 6.8 save path after failure and record platform, outcome, and duration analytics
   without exported content or personal data.
   **Prerequisites:** CC-6.8.

**Story CC-6.10: Moderator queue and case detail**
As a community moderator, I want an ordered queue with complete case context so that I can review
the highest-risk and oldest content first.
**Acceptance Criteria**

1. Expose moderator-only, keyset-paginated queue and case-detail contracts over the existing post
   and comment report snapshots, with filters for source, locale, risk, status, and SLA state.
2. Render an accessible Next.js admin queue and case view with safe media access, machine findings,
   reporter context, prior actions, and time remaining.
3. Keep unauthorized roles and direct database clients outside every moderation read path, and
   prove queue intake remains visible within five minutes of an accepted report.
   **Prerequisites:** CC-6.1, CC-6.4, CC-1.4.

**Story CC-6.11: Moderation decisions and account sanctions**
As a community moderator, I want controlled decision actions so that harmful content and repeat
abuse receive consistent treatment.
**Acceptance Criteria**

1. Route resolve, release, takedown, escalate, and ban actions through canonical contracts and the
   existing operator service, with a required reason and authenticated moderator identity.
2. Serialize conflicting reviews, make retries idempotent, invalidate public caches immediately,
   and preserve the first effective decision timestamp.
3. Define temporary and permanent ban effects on sessions, new engagement, existing content, and
   appeal status; show localized operator outcomes and append attributed audit events.
   **Prerequisites:** CC-6.10, CC-0.11.

**Story CC-6.12: SLA monitoring and escalation**
As a community manager, I want at-risk and breached cases escalated automatically so that every
report receives review within 24 hours.
**Acceptance Criteria**

1. Calculate at-risk and breached states from persisted intake and resolution timestamps using a
   scheduled, retry-safe worker.
2. Alert the configured operations channel before breach and at breach, deduplicate retries, and
   escalate delivery failures through the established observability path.
3. Provide queue and SLA dashboards, alert tests, and an operating runbook that proves ownership,
   staffing coverage, and response steps for the beta gate.
   **Prerequisites:** CC-6.10, CC-1.4, CC-0.7.

**Story CC-6.13: Immutable moderation history**
As a compliance reviewer, I want moderation history protected and retained so that CoutureCast can
demonstrate trustworthy safety operations.
**Acceptance Criteria**

1. Enforce append-only moderation decision records at the database boundary and reject updates or
   deletions from application and authenticated database roles.
2. Retain audit metadata for at least 12 months while account erasure removes personal content and
   anonymizes subject and reporter identity within the established 72-hour deadline.
3. Provide a moderator-authorized evidence export plus database, API, and end-to-end proof for the
   audit, privacy, and deletion signatures on the Community Beta gate.
   **Prerequisites:** CC-6.11, CC-1.4.

**Story CC-6.14: Complimentary full access**
As the product owner, I want to give chosen members the full feature set without payment so that
family testers can use premium and community features in production.
**Acceptance Criteria**

1. Add a complimentary entitlement source that grants every premium capability without a billing
   provider, customer record, or charge, and that payment webhooks, renewals, and expiry jobs never
   downgrade, overwrite, or bill.
2. Enable the community rollout flags and push dispatch for complimentary members only, leaving
   every other member, cohort, and production default unchanged.
3. Provide an owner-only, audited grant and revoke path that records actor, member, reason, and
   time; revoking restores the member's prior paid or free state on the next request.
4. Prove with tests that complimentary members reach premium and community features, that paid and
   free members are unaffected, and that account erasure removes the grant and its audit subject
   identity on the established schedule.
   **Prerequisites:** CC-5.2, CC-6.5, CC-1.2b.

**Story CC-6.15: Expo SDK 58 upgrade for live font-scale layout**
As a member who changes the system text size while the app is open, I want every screen to relayout
at the new size so that enlarged text is never clipped or blanked until the next cold launch.
**Acceptance Criteria**

1. Upgrade the mobile app from Expo SDK 54 and React Native 0.81.5 to Expo SDK 58 with the React
   Native version that SDK pins (0.88.x), including every Expo module, config plugin, Worklets and
   Reanimated build, dev client and Release build, with native artifacts rebuilt for every shipped
   ABI. React Native 0.87.0 is the first stable release containing the upstream font-scale layout
   fix (commit 45904c8), and stable 0.87 and 0.88 enable `enableFontScaleChangesUpdatingLayout` by
   default; SDK 57 pins 0.86.3 without it.
2. Remove the Story 6.8 font workarounds that the upgrade makes unnecessary and keep any that
   remain required, recording the reason for each.
3. Prove on Android and iOS, Debug and non-debuggable Release, that changing the system font scale
   from 1.0 to 1.5 while the app runs relayouts Home, Community, Settings and the share-card
   composer without clipped or missing text: the same visible text nodes before, immediately after
   and after settling, heights that grow with the scale, and no process restart. Main at
   1d7b9848 is the failing baseline (43 nodes kept, temperature height fixed at 169 px, clipped
   screenshots).
4. Keep every existing unit, integration, Playwright and Maestro suite green, with the native
   share-card journeys, accessibility focus bridge and large-text matrix rerun on the upgraded
   build.
5. Re-point the mobile vitest Expo web setup, which imports two Expo package internals by path
   (the expo-modules-core `polyfill/dangerous-internal` entry and the expo-constants built web
   module); an upgrade that moves them fails the suite through the missing-`globalThis.expo` guard.
   Prove both imports resolve under SDK 58 and the console guard still rejects the
   missing-`ExponentConstants` warning.
   **Prerequisites:** CC-6.8.
   **Facts:** `_bmad-output/test-artifacts/story-6-8/review-font-three-facts.md`.

### Epic 6 refinement decision

The product brief requires follow and unfollow behavior from feed and profile views. FR4 and the
original Epic 6 story set require reactions and comments without defining a follow graph or public
community profile. Keep the Following filter disabled until product chooses one of these changes:

1. Add separately sized follow-graph, community-profile, privacy, and feed stories.
2. Amend the brief and UX specification to remove Following from the Community Beta promise.

This decision does not block drafting Story 6.2. It must close before Community Beta sign-off.

---

## Epic 7: First-use clarity and member reliability

Make CoutureCast simple enough for a teen to use without help, make every save stick, and fill an
empty account with useful outfits before the member uploads anything. Evidence, target layout,
sequencing and guardrails: `_bmad-output/implementation-artifacts/epic-7-context.md`. Reviews:
`_bmad-output/implementation-artifacts/reviews/epic-7-codex-review.md` and
`_bmad-output/implementation-artifacts/reviews/epic-7-ux-review.md`.

_Numbering: this planning Epic 7 is unrelated to brief Epic 7 (Cross-Platform Delivery), which
maps to planning Epic 3. CC-6.15b, CC-6.16 and CC-6.17 live in `sprint-status.yaml` and their
spec files under `_bmad-output/implementation-artifacts/`._

**Rules for every story in this epic**

1. Web and native ship together unless the story says otherwise.
2. Phone-width checks use 390 x 844 CSS px on web, with the fold at 390 x 664, and the smallest
   supported phone on native.
3. Every member-facing story names the tab and screen it changes and passes the screen budget
   guard (CC-7.10) and the UX bars below.
4. A guardian-pending teen can use Today, Looks, Shuffle, Swap and Save with the same tap counts
   as an approved member. Capture and posting show their pending state only when tapped.
5. Testers are named by role only. Production evidence is redacted.

**UX bars**

| Bar                                | Threshold                                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time to first outfit, guest        | Median 30 s or less from opening the app, age check included (study)                                                                                     |
| Time to Today's outfit, member     | Outfit picture visible within 2 s of a cold load at p75 on throttled 4G                                                                                  |
| Taps to save a look                | 1 from any look surface                                                                                                                                  |
| Taps to any saved look             | 2 or fewer from any tab                                                                                                                                  |
| Taps to the camera or file chooser | 1 from Closet, 2 from Today                                                                                                                              |
| Taps to Plan                       | 1 from Today                                                                                                                                             |
| Above the fold                     | Today: weather line, outfit picture, primary action. Closet: four tiles or Add. Looks: two saved looks or one idea. Community: first photo within 300 px |
| Primary actions                    | Exactly one per screen                                                                                                                                   |
| Interactive targets above the fold | 7 or fewer, excluding the tab bar, garment tiles and look tiles                                                                                          |
| Chip rows                          | At most one per screen                                                                                                                                   |
| Container levels                   | Page and card only; no card inside a card                                                                                                                |
| Paragraphs and labels              | No paragraph over two lines at 390 px; button labels of 3 words or fewer                                                                                 |
| Screen height                      | Today 1,688 px or less; chrome above the Closet grid 160 px or less                                                                                      |
| Layout stability                   | Shift score 0.1 or less per tab load and switch; zero shift after a tap                                                                                  |
| Contrast                           | Text 4.5:1; large text and icons 3:1; light and dark                                                                                                     |
| Touch targets                      | 44 x 44 CSS px or pt with 8 px spacing                                                                                                                   |
| Text size                          | Body 16 px; labels 12 px minimum; 200% text at 320 px without clipping                                                                                   |
| Save feedback                      | State change within 100 ms; Saved within 1 s at p95 or "Still saving"                                                                                    |
| Reading level                      | US grade 6 or below for English member-facing strings                                                                                                    |
| Motion                             | 200 ms or less; instant under reduced motion; no autoplay                                                                                                |

**Target layout**

Five tabs in this order on web and native: Today, Closet, Looks, Community, Profile. Today decides
what to wear. Closet holds the member's pieces. Looks holds saved looks, capsules, ideas and the
plan. Community holds the feed. Profile holds account, places, style, Premium and sign out. The
Closet label is confirmed with teens in the CC-7.8 baseline; routes and test ids keep `wardrobe`.
Wireframes: the UX review.

**Stories**

### Lane A: reliability

**Story CC-7.1: Shared save, undo and status feedback**
As a member, I want every save, delete and change to tell me clearly what happened, so that I
trust the app.
**Acceptance Criteria**

1. One shared component on web and native provides Save, Saving, Saved and Failed states and a
   bottom status bar with up to two actions (View, Undo, Retry) shown for 5 seconds.
2. Saving shows within 100 ms. Saved shows only after the server commits; a slower commit shows
   "Still saving". Failed keeps the content on screen with "Could not save. Try again." and Retry.
3. Offline, network actions show "You are offline" and keep the content on screen; one offline
   line sits under the top bar until the connection returns.
4. Undo is available for save, unsave and swap or shuffle on an unsaved look.
5. Each state is announced once to screen readers. The bar never covers the primary button or the
   tab bar.
   **Prerequisites:** none.

**Story CC-7.2: Saved looks follow the account**
As a member, I want a look I save to be there on any device after reload, so that saving means
something.
**Acceptance Criteria**

1. Style this piece saves, reopens and removes looks through the API with ownership and revision
   checks. A saved look stores stable slot and item ids, the weather preset and an ordered
   composition snapshot, so reopening reproduces the saved slot order and swaps on web and native.
2. Save uses CC-7.1. A retry after a lost response creates one record.
3. An authenticated member can save and reopen with browser storage unavailable (strict cookie
   settings, in-app browsers, full storage).
4. A saved look whose garment is missing shows an explicit placeholder; a look whose garment tags
   changed shows "Needs review". Neither is dropped silently, and saved looks render when the
   garment photo is unavailable.
5. The Home sample "Save" uses the same account list. Until CC-7.12 ships, saved looks open from a
   "Saved looks" row at the top of the Closet screen.
6. Playwright proves save, reload, reopen and remove in a second browser context for the same
   member, including a context with storage blocked. Native tests prove the same against the API
   contract.
   **Prerequisites:** CC-7.1, CC-4.3.
   **Facts:** today the look is written only to `localStorage` by `updateSaved` in the web
   `style-piece-panel.tsx`, by design in `_bmad-output/plan-style-one-piece.md`. When the app
   shell's storage probe fails, `layout.tsx` installs an in-memory store, so a save appears to work
   and is gone on reload. `parseStylePieceRecipes` drops looks whose garment tags changed. Web
   announces the saved notice to screen readers only. Home sample bookmarks use a second list,
   `couturecast.member-sample-bookmarks`.

**Story CC-7.3: Import device-saved looks for the same member**
As a member who saved looks before CC-7.2, I want them in my account, so that I lose nothing.
**Acceptance Criteria**

1. On signed-in load, looks saved on the device under the same authenticated member import once
   per stable source id, after server validation of garment ownership. Imports stay retryable until
   acknowledged and produce no duplicates on concurrent retries.
2. Valid imported looks that no longer resolve enter the "Needs review" state.
3. Guest data keeps the reviewed CC-6.16 comfort-only carryover. No guest look or device data from
   another account imports into the signed-in account.
4. After a successful import the device lists are removed and saved looks appear only in the
   account list.
5. Tests cover tampered references, two accounts on one device, an account switch during import
   and concurrent retries.
   **Prerequisites:** CC-7.2.

**Story CC-7.4: Community post edits persist**
As a member, I want my title and description edits to stay after refresh, so that I can fix my
posts.
**Acceptance Criteria**

1. Reproduce first with a controlled account at phone width: title-only, caption-only and combined
   edits through the editor. Record the PATCH status, the committed revision, and the feed and
   detail readback after reload. Record the root cause in the story file and scope the fix to the
   reproduced path.
2. Title and caption edits persist through the API. Refresh, another browser and native show the
   edited text, and an already-open second client updates without overwriting a newer revision.
3. Each outcome has its own message: saved, rejected by screening, screening unavailable, stale
   revision, and "No changes" for an unchanged payload (which keeps its revision). Rejected or
   unavailable screening leaves the approved text visible and keeps the attempted text in the
   editor.
4. If screening moves before the transaction, the decision binds to the normalized text and policy
   version, and the existing locks recheck eligibility, sanctions, ownership, visibility, revision
   and quota before committing. Tests cover revocation and a competing edit during screening.
5. After a successful edit the card and detail show the new text at once with an "Edited" label.
6. The end-to-end test edits both fields, reloads and reads them back from the feed and the post
   detail; an API integration test covers the reproduced failure.
   **Prerequisites:** CC-6.1, CC-6.2b, CC-7.1.
   **Facts:** the edit writes through `PATCH /api/v1/community/posts/:postId/text` and updates the
   screen only on success. Text screening runs inside the 7-second privacy transaction
   (`community-privacy.ts`). Web and native already apply `post.text_changed` through the shared
   reconciliation in `packages/api-client/src/community-sync-state.ts`. Playwright already covers
   editing both fields with reload readback (`playwright/tests/community-post-text.spec.ts`), so the
   reported failure may come from a stale read, a failed write or failed client reconciliation.

**Story CC-7.5: Garment detail and tag edit**
As a member, I want to open a garment and fix its tags, so that my closet stays accurate.
**Acceptance Criteria**

1. Tapping a ready garment opens its detail with a back control, the photo, category, material and
   comfort range.
2. The member edits tags; Done saves with CC-7.1 states, and the change shows after reload on web
   and native.
3. Garment images use color plus category as alt text ("Blue top").
4. Style this piece opens from the garment detail.
   **Prerequisites:** CC-4.2, CC-7.1.
   **Facts:** the API already exposes tag update and delete routes (`wardrobe.controller.ts`); the
   gap is web and native management of ready garments.

**Story CC-7.6: Garment delete**
As a member, I want to remove a garment, so that my closet shows only what I own.
**Acceptance Criteria**

1. Deleting a piece used by no saved look shows "Deleted" with Undo for 5 seconds. Deleting a
   piece used by saved looks or capsules asks once and names how many looks it affects.
2. On success the piece leaves active closet results, capsules keep their current behavior and
   saved looks show the missing-piece state from CC-7.2.
3. The member returns to the grid at the same scroll position.
4. Tests cover retry, legal hold and the asynchronous retention purge.
   **Prerequisites:** CC-7.2, CC-7.5.

**Story CC-7.7: Signed-in shell without flashes**
As a member on a phone, I want screens to stay still while they load, so that I do not tap the
wrong thing.
**Acceptance Criteria**

1. Signed-in members never see signed-out or sample content before their own. Session resolution
   shows the fixed app shell with a neutral placeholder.
2. The tab bar, header and visible controls keep their position until loading completes, on web
   and native.
3. A section whose emptiness is unknown at first paint renders nothing until its data arrives,
   then appears only below the fold or at the end of the screen. No content is inserted above the
   viewport after the first tap on a screen.
4. Returning to a tab within the session shows its last content and scroll position at once and
   refreshes in place.
5. Rebaseline at 390 x 844 on production. A Chromium check runs cold navigation and scripted tab
   switches against fixed empty, populated and delayed responses, measures the full transition
   including shifts after input, and fails above 0.1 in the PR gate. Later stories enforce the
   budget for each surface in the PR that defines its final layout.
6. Transitions last 200 ms or less and become instant under reduced motion.
   **Prerequisites:** CC-3.6.
   **Facts:** the 2026-11-21 walk at 500 CSS px measured a Home cold-load shift score of 0.574,
   with the signed-out sample outfit replaced by the member's outfit.

### Lane B: clarity

**Story CC-7.8: Teen and adult usability studies**
As the product owner, I want proof that teens can use the app unaided, so that Epic 7 ends on
evidence.
**Acceptance Criteria**

1. Use the protocol in `_bmad-output/test-artifacts/first-use-phone-study.md` on isolated phone
   builds with guest, empty-member, populated-member and guardian-pending accounts and pre-approved
   test posts. Recruit at least three teens aged 13 to 17 (guardian permission and teen assent) and
   three adults per round. Use a fresh cohort or counterbalance build order.
2. Keep the existing task cards and add: find a saved look after reopening the app, edit a post's
   title and caption, and check the Closet tab label.
3. Run three rounds: baseline on the current build before Lane B changes the tested tasks,
   midpoint after CC-7.17, and exit after the last member-facing story in the epic.
4. Midpoint and exit bar: 100% unprompted completion; median time to first outfit under 30 seconds
   in each cohort; at least five of six participants state the job of Today, Closet, Looks and
   Community after five seconds; correct first tap on at least 80% of attempts; median ease of 6
   or higher on a 7-point scale for every task; zero reports of clutter or confusion, each remark
   recorded with its screen.
5. Record anonymous results only. Findings that miss the bar become stories before the epic
   closes.
   **Prerequisites:** none for the baseline.

**Story CC-7.9: One app shell and visual system**
As a member, I want every tab to look like the same app, so that I always know where I am.
**Acceptance Criteria**

1. Every tab and sub-screen uses one page surface, a 56 px top bar with title and optional back,
   one card level and the shared spacing and type scale, on web and native.
2. Light and dark follow the system setting on every screen. The dark page framing an inset light
   card on Home and Community is removed.
3. Color, type, spacing, radius and elevation tokens are published once and consumed by web and
   native. Gold appears only on the primary action, focus ring, active tab and Premium marks.
4. The CC-7.7 session placeholder renders this shell.
5. Every member-facing string on changed screens comes from the locale catalogs (Wardrobe strings
   are hard-coded English today).
6. Visual snapshots of each tab in light and dark at 390 x 844 and the smallest native phone.
   **Prerequisites:** CC-7.7.

**Story CC-7.10: Screen budget guard**
As the product owner, I want every screen checked against a clutter budget, so that later stories
cannot make the app busy again.
**Acceptance Criteria**

1. An automated check loads each tab at 390 x 844 with empty, populated and guardian-pending
   fixtures on web, and the matching native screens.
2. It fails on more than one primary button, more than seven interactive targets above the fold
   (excluding the tab bar and garment or look tiles), more than one chip row, a card inside a card,
   a paragraph over two lines, Today over 1,688 px, or chrome above the Closet grid over 160 px.
3. It fails on any Home or Today control whose only effect is an analytics event.
4. It runs in the PR gate within the CI time budget. Raising a limit needs a recorded owner
   decision in the story file.
   **Prerequisites:** CC-7.9.

**Story CC-7.11: Five-tab navigation and back pattern**
As a member, I want to reach my clothes and looks immediately, so that I never scroll to find them.
**Acceptance Criteria**

1. The tab bar shows Today, Closet, Looks, Community and Profile in that order on web and native,
   with one shared icon set, labels of 12 px or larger in sentence case and an active state that
   does not rely on color alone.
2. Each tab opens on its own content within the fold, with no banner, explanation or setup
   progress first. The Closet tab opens on the garment grid with Add as the one primary button; a
   populated account shows four tiles at 390 x 664 and an empty account shows Add.
3. Capsules move to Looks. Silhouette and closet setup move to a More menu and Profile > Style.
4. Every screen below a tab (garment detail, saved look, post detail, Plan, capsules, setup, each
   Profile row) shows a top bar with a back arrow and a title. Overlays close with X, Escape,
   swipe down and system back, and return focus to their opener. Browser back and the native back
   gesture restore the parent's scroll position; a direct entry without history goes back to the
   parent tab.
5. Tests prove each tab's first content above the fold and a working back control on every named
   sub-screen.
   **Prerequisites:** CC-7.9, CC-7.10.

**Story CC-7.12: Looks tab for saved looks, ideas and plans**
As a member, I want one place for every outfit I saved, new ideas and my week, so that I always
know where a look is.
**Acceptance Criteria**

1. Looks has Saved, Ideas and Plan segments. It opens on Saved when the member has a saved look
   and on Ideas otherwise.
2. Saved lists saved looks and capsules newest first as picture tiles with a name and one state
   line (saved date, "1 piece missing", "Needs review"). Filters: All, Today, Capsules.
3. Ideas shows sample looks until CC-7.22 ships the lookbook.
4. Plan shows the Premium week. Free members see a sample week, one line on what Premium adds and
   one Upgrade button; no other screen shows a Planner lock. Today's "Plan your week" row opens
   Plan in one tap for every member.
5. `/wardrobe/capsules` redirects to Looks with the Capsules filter. Every save confirmation's View
   opens the saved look in Looks, and the Closet "Saved looks" row from CC-7.2 is removed.
6. Tests prove each segment's first content above the fold at 390 x 664, deep links to a saved look
   with back to Saved, and no lock outside Plan for a free account.
   **Prerequisites:** CC-7.2, CC-7.11, CC-5.5.

**Story CC-7.13: Calm Today with one primary job**
As a teen member, I want Today to show me what to wear without noise, so that I can decide in
seconds.
**Acceptance Criteria**

1. At 390 x 844 Today opens on one weather line, one outfit card and one primary action. Below it
   show at most a closet strip (recent pieces, or one "Add your first piece" row when empty), a
   "Plan your week" row and one Community row that hides when no eligible post exists. Any
   sponsored teaser counts as that Community row and keeps its CC-6.7b disclosure and opt-out.
2. Remove from Home on web and native: the analytics-only actions ("Preview outfits", "See the
   planner", "Start wardrobe upload"), the Daily ritual marketing hero and header tagline, the
   Personal, Community and Sponsored chip row, the embedded Community feed with its climate chips,
   reactions and Report controls, and the Lookbook Prism heading. Sign out moves to Profile.
   Native keeps one morning, midday and evening control, shown only when the forecast differs.
3. If the forecast is unavailable, show a labeled sample look with a weather-setting action.
4. Today is 1,688 px or less in empty, populated and forecast-unavailable fixtures at default text
   size. At 320 px and 200% text, scrolling is allowed and every control stays reachable.
5. Native Today matches the web layout; the hourly ribbon opens from the weather line. A native
   screenshot at the smallest supported phone is attached to the PR.
   **Prerequisites:** CC-7.11, CC-7.12.

**Story CC-7.14: Today's outfit as a picture**
As a teen member, I want to see today's outfit as clothes, so that I can decide at a glance.
**Acceptance Criteria**

1. Today's outfit renders as a composed picture of its pieces on web and native: the member's
   garment photos where used and catalog illustrations for the other slots.
2. The card shows a short look name and one weather reason ("Warm enough for 9 to 14 C"). Comfort
   notes, badge details and Shop this look move to the look's detail, which keeps the CC-5.1
   disclosure.
3. A missing or failed photo shows the catalog illustration for its slot.
4. The picture reserves its size before images load and passes the CC-7.7 budget.
5. Each piece is a 44 px target that opens Swap. "Wear this" saves the look for today through
   CC-7.2.
6. Visual snapshots cover a full closet, an empty closet, a missing photo and dark mode at
   390 x 844 and the smallest native phone.
   **Prerequisites:** CC-7.2, CC-7.13.

**Story CC-7.15: Calm Community with an empty state**
As a member, I want Community to show looks quickly and tell me when there are none, so that it
never feels broken.
**Acceptance Criteria**

1. Community opens on a title row with Post, one "Your climate" filter that opens a sheet with All
   climates and the six bands (the explainer paragraph moves into the sheet), the weekly challenge
   as one dismissible row, then the feed. City Spotlight posts join the feed labeled "Near you".
2. Cards show the photo, title, author and one reaction row; a card opens its detail in one tap.
   A "..." button on each card offers Report or Withdraw in one tap, preserving the current
   reporting flow.
3. With no eligible posts in the member's climate, show "No looks in your climate yet" and one "See
   all climates" button. Restricted and unavailable feeds keep their own states. Moderation, blocks,
   age eligibility and rollout gates are unchanged.
4. Verify zero eligible posts and two approved posts from other synthetic members on isolated
   builds, with long localized labels and enlarged text.
   **Prerequisites:** CC-7.11.

**Story CC-7.16: Calm Closet and Profile**
As a member, I want Closet and Profile to show only what I need, so that the app does not feel
busy.
**Acceptance Criteria**

1. Closet shows the title row with Add and More, one category chip row, then the grid. Cards show
   the photo and short name; a badge appears only when the member must act (Needs tags, Failed,
   Processing), with text and an icon colored by meaning. Setup progress is one row after the grid
   until setup completes.
2. Profile lists Account, Places, Style, Premium, Notifications, Language and About and privacy as
   one-line rows with their current value, each opening a sub-screen with back, then Sign out.
   Planner leaves Profile for Looks > Plan; the About button leaves Home's header.
3. Help text is one line with "Learn more".
4. Verify 200% text at 320 px with no clipped labels, light and dark, and long localized labels.
   **Prerequisites:** CC-7.11.

**Story CC-7.17: Teen voice and copy**
As a teen member, I want the app to talk like me, so that it feels made for me.
**Acceptance Criteria**

1. A short voice guide in the design system: second person, short sentences, school, weekend and
   going-out situations, no fashion jargon without a picture, no percentages or match scores.
2. Every member-facing English string on the five tabs and first run reads at US grade 6 or below,
   with button labels of three words or fewer.
3. Commute, office and meeting language leaves Home, the sample catalog descriptions and the share
   card.
4. All supported locales receive the new strings; long translations wrap without clipping at
   320 px.
   **Prerequisites:** CC-7.9.

### Lane C: fill the empty app

**Story CC-7.18: Find mini skirts, tights and socks**
As a member, I want to find the pieces I wear in sample looks, so that looks match my style.
**Acceptance Criteria**

1. In the sample picker with All and Cool or Mild weather, a member can find, preview and swap a
   mini skirt, tights or socks, then save and reopen the look.
2. The swap sheet groups options by type, lists weather-appropriate options first and shows at
   most 12 before "Show more". The current piece is marked; choosing it again closes the sheet.
   **Prerequisites:** CC-6.16, CC-7.2.
   **Facts:** the catalog already has `mini-skirt`, `opaque-tights`, `ribbed-socks` and
   `mini-and-tights` (`packages/utils/src/sample-wardrobe/catalog.ts`); the tester could not find
   them in the tested build.

**Story CC-7.19: Garment subtypes**
As a member, I want my pieces tagged by type, so that looks use the right skirt, boots or layer.
**Acceptance Criteria**

1. Define a short list of subtype ids with sample coverage per look, including mini, midi and maxi
   skirts; tights, socks and leggings; camisoles, tanks and crop tops; moto, ankle and knee boots;
   blazers and moto jackets.
2. Tagging, Closet filters, the swap sheet and the generator use subtypes. Existing garments read
   with their category and an unset subtype.
3. The swap sheet lists the member's own pieces first.
4. Shared utilities tests cover the subtype list, coverage per weather preset and locale strings.
   **Prerequisites:** CC-7.18, CC-7.5.

**Story CC-7.20: Account style profile**
As a new member, I want to tell CoutureCast my style quickly, so that suggestions fit me before I
upload anything.
**Acceptance Criteria**

1. Style mood is asked inline on the first look as one row of four picture choices. The other
   questions (colors, textures, fit, pieces to avoid) form an optional "Tune my style" flow of at
   most three screens, each with Skip, reachable from Today and Profile > Style. No question blocks
   the first look or sign-up.
2. Every choice is a picture with a short label; colors are swatches; pieces to avoid are toggles
   on illustrations. No free text and no body measurements or photos.
3. Answers save to the account as each screen completes, show after reopening Profile > Style, can
   be cleared to restore default ranking, and replace the device-only sample preferences.
4. Today and Looks offer a temporary temperature and mood override for the day.
5. At least five of six pilot participants who start "Tune my style" finish it within 60 seconds.
   **Prerequisites:** CC-2.1, CC-6.16.

**Story CC-7.21: First run with the look first and the account on save**
As a new visitor, I want to see a look I like before I answer questions or sign up, so that I know
the app is worth it.
**Acceptance Criteria**

1. Guest Today shows one sample look teaser and "Show me looks" as the only primary action; Sign in
   and Create account are text links.
2. After the existing 13+ age check, the visitor sees a complete look with the mood row, Shuffle,
   Swap and Save, within 30 seconds median of opening the app.
3. Save opens a sheet asking for a free account. Sign-up reuses the age check's birthdate; cancel
   returns to the same look.
4. After sign-up, the CC-6.16 review screen shows the mood and colors chosen as a guest next to the
   comfort settings, and only confirmed answers carry over. The saved look then appears in Looks >
   Saved with the CC-7.1 confirmation.
5. A guardian-pending teen lands in the same place with the same tools.
6. End-to-end tests cover adult, approved teen and guardian-pending teen paths, cancel at each
   step and the under-13 block.
   **Prerequisites:** CC-6.16, CC-7.2, CC-7.12, CC-7.20.

**Story CC-7.22: Lookbook with shuffle and pinned pieces**
As a member with an empty or small closet, I want complete looks for today's weather in my style,
so that the app is useful on day one.
**Acceptance Criteria**

1. Looks > Ideas shows one look at a time for the selected mood, with the member's moods as one
   chip row. Today shows only the top look as its outfit for an empty or small closet. No other
   screen embeds lookbook cards.
2. For an empty account, three complete catalog looks are available, one per mood, built by the
   rule-based selector from the style profile and weather, each with one weather reason.
3. Each piece has a pin. Shuffle replaces every unpinned piece and keeps the look weather
   appropriate. Pinned state survives reload until the look is saved or reset.
4. Looks save through CC-7.2 in one tap.
   **Prerequisites:** CC-7.2, CC-7.12, CC-7.18, CC-7.20.

**Story CC-7.23: AI-written look ideas (text only)**
As a member, I want looks described and ranked by an AI stylist, so that ideas feel personal.
**Acceptance Criteria**

1. Record the provider decision with a pinned provider, model and version (default: Vercel AI
   Gateway with a current Claude model), its retention and no-training terms, cost per call, the
   timeout, per-account quota and total spend cap.
2. One server module owns model calls: prompts in source control, structured output validation,
   rate limits, spend caps, timeouts and telemetry. Inputs are enumerated style preferences, coarse
   weather and catalog ids only; prompts, outputs, account ids and location never enter telemetry
   or fixtures.
3. Model output is untrusted: only known slot and item ids and bounded plain text pass; results for
   an older request, session or account are dropped; body, age, identity and attractiveness
   inferences are excluded; unsafe suggestions are filtered before display.
4. The lookbook shows the rule-based look within 1 second. A generated look replaces it only if
   the member has not touched the look; otherwise "New ideas ready" appears and nothing moves.
   Timeout or provider failure keeps the rule-based look.
5. CI covers valid output, invalid output, timeout, unsafe output and cap exhaustion with zero live
   model calls. p95 generation is 5 seconds or less on the agreed fixture workload.
   **Prerequisites:** CC-7.22, CC-0.11, CC-1.4.

**Story CC-7.24: Photo AI consent and processor approval**
As a parent and as a member, I want photos sent to an AI model only with clear permission, so that
teen data stays safe.
**Acceptance Criteria**

1. An approved age-by-feature consent matrix covers every photo AI feature before any image call
   is enabled. External image processing starts off.
2. Consent is versioned and scoped to feature, input class and provider, with guardian approval
   where the matrix requires it and teen assent. It is revocable from Profile.
3. The server checks active consent before dispatch and before saving or returning a result. On
   revocation, pending dispatch stops, late results are discarded and the documented deletion path
   runs.
4. A processor list names every party that receives member data (gateway, model provider, queues,
   observability) and the permitted fields per feature. Photos are stripped of metadata and read
   through fresh authorized reads; signed URLs never leave the server.
5. Every photo feature offers the manual flow with consent off.
6. Tests cover missing, expired and revoked consent and account switching.
   **Prerequisites:** CC-7.23, CC-0.11.

**Story CC-7.25: Suggested Community descriptions**
As a member posting a look, I want a short description suggested for me, so that posting is quick.
**Acceptance Criteria**

1. After photo selection the composer offers one "Suggest a description" button. For an eligible,
   consenting member it returns an editable one or two sentence draft within 5 seconds, marked
   "Suggested" until the member edits or accepts it.
2. The color-cue or manual path stays available on decline, timeout or invalid output.
3. A response for an older photo, session or composer revision leaves the current text unchanged.
4. Publishing applies the existing text and image screening.
   **Prerequisites:** CC-7.24.

**Story CC-7.26: Clean garment cutouts**
As a member adding a garment, I want a clean cutout, so that my closet looks good.
**Acceptance Criteria**

1. On fixed labeled photos of plain, cluttered, pale-on-pale and patterned scenes, accepted masks
   keep at least 95% of labeled garment pixels and remove at least 90% of labeled background
   pixels. Otherwise the original photo is kept.
2. Saved and previewed assets have identical decoded pixels.
3. An on-device or server model needs no external processor; an external one requires CC-7.24.
   **Prerequisites:** CC-4.1.

**Story CC-7.27: Suggested tags that are right**
As a member adding a garment, I want tags filled in correctly, so that capture takes seconds.
**Acceptance Criteria**

1. On a named held-out set, top-1 accuracy is at least 90% for category and 80% for subtype,
   counting abstentions as misses.
2. Only confident, untouched fields are prefilled. One screen shows the cutout and each suggested
   tag as a selected chip; "Looks right" is the primary button; a low-confidence field shows "Pick
   one" and blocks "Looks right" until chosen.
   **Prerequisites:** CC-7.19.
   **Facts:** web already preselects confident category, material and comfort suggestions when
   inference returns them (`garment-tagging-modal.tsx`); the tested garment opened with manual
   selections.

**Story CC-7.28: Add several photos at once**
As a member, I want to add several garment photos in one go, so that building my closet is not
tedious.
**Acceptance Criteria**

1. Select up to five existing garment photos, review each and save the confirmed entries in one
   action ("Add 4 pieces").
2. Each item keeps its own status; failed items retry without duplicates.
3. Cancel or failure clears transient images.
   **Prerequisites:** CC-7.27.

**Story CC-7.29: Several garments from one flat-lay photo**
As a member, I want to add a whole outfit laid out on a bed from one photo, so that I add pieces
faster.
**Acceptance Criteria**

1. The member picks one flat-lay photo; the app detects each garment and shows the cutouts in a
   grid, each kept by default with Remove and Edit tags.
2. Photos with a detected person and uncertain crops are rejected before any external send or
   durable save.
3. Staging is private and scoped, purged within 15 minutes on cancel, failure or completion. Only
   confirmed masks are saved; metadata is stripped; staging never appears in logs.
4. One successful confirmation creates one garment per kept item; a retry after timeout returns
   existing successes.
5. Worn-outfit photos need a separately approved design and stay out of this story.
   **Prerequisites:** CC-7.24, CC-7.28.

### Lane D: keep members coming back

**Story CC-7.30: Style this piece with my own garments**
As a member, I want Style this piece to pair my garment with my other clothes, so that the looks
are ones I can wear today.
**Acceptance Criteria**

1. Given an eligible anchor and a weather-compatible owned companion, the owned item shows before
   comparable catalog items. Missing slots fill with catalog pieces; an unavailable photo shows a
   placeholder.
2. Looks cover school, weekend and going out for the selected weather.
3. Verify empty, sparse and populated closets. Save and reopen use CC-7.2.
   **Prerequisites:** CC-7.2, CC-7.5.

**Story CC-7.31: Wear log**
As a member, I want to log what I wore, so that the app learns what I use.
**Acceptance Criteria**

1. "Wear this" on Today and on any saved look logs at most one wear per owned garment per
   member-local day. Catalog pieces create no wear rows.
2. The day's logged state shows after reopen, with undo.
   **Prerequisites:** CC-7.2, CC-7.14.

**Story CC-7.32: Closet insights**
As a member, I want to see what I wear most and least, so that I use more of what I own.
**Acceptance Criteria**

1. One collapsed row at the top of Closet ("You wore 40% of your closet this month") opens a
   sub-screen with most worn and not worn in 30 days. Today shows no statistics.
2. Closet use = active garments worn at least once in the last 30 local days divided by active
   garments. A zero denominator shows "No garments yet".
   **Prerequisites:** CC-7.31.

**Story CC-7.33: Trips**
As a member traveling, I want a look for each day of a trip, so that I plan the trip in one place.
**Acceptance Criteria**

1. Trips live in Looks > Plan below the week. A trip covers 1 to 14 destination-local dates.
2. Forecast shows only for dates with data; others read "Forecast unavailable".
3. The member saves one chosen look per date. Trip dates and destinations stay private.
4. The Planner entitlement for trips is decided before drafting.
   **Prerequisites:** CC-1.1, CC-1.2, CC-7.12, CC-7.22.

**Story CC-7.34: Packing list**
As a member traveling, I want a packing list from my trip looks, so that I pack only what I need.
**Acceptance Criteria**

1. The list combines repeated items by stable item id and marks owned items apart from catalog
   suggestions.
2. Checklist state persists across reopen and devices.
   **Prerequisites:** CC-7.33.

### Epic 7 product decisions

1. **Virtual try-on.** It needs body images and teens are the main audience, so it stays outside
   Epic 7 until the owner decides on a separately gated story.
2. **Social follow graph.** The Epic 6 refinement decision still applies; Epic 7 adds no following.
3. **Competitor features.** Adopted: pinned shuffle (CC-7.22), week calendar (Looks > Plan), one
   piece styled several ways (CC-7.30), chosen palettes (CC-7.20), garments from a flat lay
   (CC-7.29), trips (CC-7.33). Covered by existing work: Community feed, the Premium week planner
   and the palette advisor under Profile > Style. Deferred, because each adds a surface Epic 7
   removes: collage canvas, moodboards, outfit-selfie posts, inferred color season with closet
   compatibility, and shopping match scores.
4. **Closet label.** The tab label changes from Wardrobe to Closet only if the CC-7.8 baseline
   confirms it with teens.

---

## UX Design alignment updates (2025-11-10)

**New stories added**

- CC-3.5 Lookbook Prism responsive layout (hero + community split)
- CC-3.6 Chip navigation & sticky bottom nav (keyboard + analytics)
- CC-3.7 Widget / notification deep-link handling (contextual entry)
- CC-3.8 Accessibility hardening (WCAG 2.1 AA delivery + testing)
- CC-4.4 Wardrobe onboarding & silhouette setup (guided flow)

**Complexity adjustments**

- CC-3.1 Mobile hero experience — increase estimate by +2 points to cover premium silhouette/overlay states defined in UX spec.
- CC-3.3 Home/lock-screen widgets — add responsive preview/compare controls; mark +1 point and dependency on CC-3.5.
- CC-5.3 Premium theme switcher — align palette tokens with new component demos; add dependency on CC-3.5 + CC-3.6.
- Stories now simpler: none identified after UX pass (scope unchanged).
- Stories to split: none yet; monitor during architecture grooming.
- Stories to combine: none recommended—the flows remain discrete.

**Action items**

- Track component implementation tickets (Hero Ritual Canvas, Modular Outfit Tile, Chip System, Lookbook Card, Planner Day Card, Feedback Suite, Widget Modules) under Epics 3–4.
- Add accessibility QA tasks (axe/Lighthouse automation, VoiceOver/TalkBack manual runs) under CC-3.8 each release.
- Wire onboarding telemetry from CC-4.4 into activation dashboards (CC-1.4) and update analytics schema accordingly.

---

## Implementation Guidance

### Phase roadmap

- **Sprint 0 (Epic 0)**: Provision infrastructure, test environments, and development tooling.
  Complete all 14 foundation stories (CC-0.1 through CC-0.14) before Epic 1 begins. Critical path:
  CC-0.1 → CC-0.2 → CC-0.3 → CC-0.11 establishes the guardian-consent baseline; CC-0.4
  through CC-0.14 can partially overlap where their recorded prerequisites allow it.
- **Phase 1 (Epics 1–3)**: Build the weather backbone, personalization engine, and cross-surface experiences with localization. Stories CC-1.1, CC-2.1, CC-3.1 can kick off in parallel once Epic 0 is complete.
- **Phase 2 (Epic 6)**: Build the remaining safety, engagement, highlight, export, and moderation
  lanes behind disabled production controls. Open Community Beta only after CC-6.2 through CC-6.13
  and every signed release-gate item are complete.
- **Phase 3 (Epics 4–5)**: Layer wardrobe capture and monetization. Ensure CC-4.1 (garment capture) lands before CC-5.4 (palette advisor) so the advisor has wardrobe context.
- **Delivery note (2026-09-05):** Epics 4 and 5 were built ahead of their Phase 3 label; CC-4.1 through CC-5.5 are already `done`. Cross-phase prerequisites recorded on CC-3.7 and CC-6.1 are satisfied by that early delivery and do not gate the Phase 2 Community Beta.

### Parallelization hints

**Epic 0 (Sprint 0) Parallel Opportunities:**

- After CC-0.1 completes: CC-0.2, CC-0.3, CC-0.4, CC-0.5, CC-0.7, CC-0.8, CC-0.9 can run in parallel (different service domains)
- Sequential required: CC-0.1 → {CC-0.2, CC-0.3} → CC-0.11 (guardian consent needs Prisma + Supabase); CC-0.10 → CC-0.12 (test fixtures needed for environment validation); CC-0.6 (CI/CD needs CC-0.10 fixtures for testing)

**Feature Epics (Phase 1-3) Parallel Opportunities:**

- Parallel-ready stories: CC-1.1 & CC-1.4 (telemetry) can run concurrently once API schema agreed. CC-3.2 (localization) and CC-3.3 (widgets) can overlap after CC-3.1 design tokens settle. In Epic 6, the content-screening, reactions, export, and moderator-queue lanes can begin after CC-6.1 while production controls remain disabled.
- Sequential chains: CC-2.1 → CC-2.2 → CC-2.3; CC-6.3 → CC-6.6 → CC-6.7 → CC-6.7b; CC-6.2 + CC-6.4 → CC-6.5; CC-6.8 → CC-6.9; CC-6.10 → CC-6.11 → CC-6.13; CC-6.10 → CC-6.12; CC-4.1 → CC-4.2 → CC-4.3; CC-5.2 gates CC-5.3, CC-5.4 & CC-5.5.

### Key files / components

- `services/weather`, `services/outfit-engine`, `services/localization`, `services/commerce`, `services/community`, `services/moderation`
- Shared design tokens + localization bundles for mobile/web/watch surfaces.
- Analytics pipeline (`analytics/events`, `analytics/dashboards`) configured during Epic 1.

### Compliance & guardrails

- Respect consent flows around images (CC-4.1) and color analysis (CC-5.4); log opt-ins.
- Maintain alert quiet hours and COPPA-safe gating for community (CC-6.2).
- Ensure affiliate disclosures and premium entitlements align with legal guidelines per success criteria.

### Success checkpoints

- **Phase 1 complete:** Users can open the app (any language), see accurate weather + outfit cards, and use widgets/watch; telemetry reports activation and forecast metrics.
- **Phase 2 complete:** Community feed live with moderated engagement, highlight modules, and social sharing.
- **Phase 3 complete:** Users can build wardrobes, subscribe, and engage with premium commerce experiences.
- **Checkpoint status (2026-09-05):** the Phase 3 checkpoint is met while the Phase 2 checkpoint is open, because Epics 4 and 5 shipped ahead of their label (see the delivery note under Phase roadmap). Epic 6 is in progress, and Community Beta opens only on the signed safety gate recorded in `_bmad-output/project-knowledge/couturecast_roadmap.md`.

---

## Summary

- **Epics:** 8 (including Epic 0: Platform Foundation)
- **Stories:** 90 in this document (14 Epic 0 infrastructure + 76 feature stories, including 34 in Epic 7)
- **Epic 6 tracker:** one backlog story, CC-6.15b.
- **Sequential dependency chains:** Epic 0 → all other epics (critical path); Epic 6 chains are listed under Parallelization hints
- **Estimated cadence:** Sprint 0 and Phases 1 to 3 are complete. Size Epic 7 lane by lane as each lane starts.
- **Total duration:** The original 7-8 sprint estimate is retired because it treated the four former Epic 6 feature packages as single-session stories.

**Epic 0 (Sprint 0) Completion Criteria:**
All 14 infrastructure stories (CC-0.1 through CC-0.14) must complete before Epic 1 feature work begins. This includes: monorepo initialization, Prisma schema, Supabase setup, Redis/BullMQ config, Socket.io gateway, CI/CD pipelines, observability stack, secret management, OpenAPI tooling, test fixtures, guardian consent implementation, test environment provisioning, cross-surface E2E scaffolding, and expanded test infrastructure.

Every remaining story is planned for one focused delivery context and tagged with prerequisites. Validate that review envelope while drafting each implementation story. Vision requirement FR8 (CoutureCast Jr.) remains intentionally unassigned pending dedicated discovery.
