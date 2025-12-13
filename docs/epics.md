# CoutureCast - Epic Breakdown

**Author:** John – Product Manager (BMAD Method v6)  
**Date:** November 2025  
**Project Level:** Level 3  
**Target Scale:** 2–3 cross-functional squads with shared moderation support

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
5. Document environment URLs, service keys, and access credentials in Doppler (or Supabase Vault).
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

**Story CC-0.8: Set up environment management (Doppler) and secret rotation**
As a security-conscious team, we need centralized secret management with rotation policies so that credentials stay secure across environments.
**Acceptance Criteria**

1. Configure Doppler projects: local, ci, dev, staging, production with secrets per test-design-system.md Secrets & Configuration Management table (DATABASE_URL, WEATHER_API_KEY, REDIS_URL, LAUNCHDARKLY_SDK_KEY, SUPABASE_SERVICE_KEY).
2. Implement healthcheck endpoint (`/api/health?check=secrets`) to validate Doppler sync on deploy.
3. Set up pre-commit hooks using `gitleaks` or `detect-secrets` to scan for hardcoded secrets; CI fails if patterns detected.
4. Document quarterly secret rotation schedule and test secret rotation via staging environment.
5. Enforce least-privilege service keys for Supabase Storage (read-only for web, write for API workers).
   **Prerequisites:** CC-0.3 (Supabase projects), CC-0.4 (Redis credentials).

**Story CC-0.9: Initialize OpenAPI spec generation and API client SDK**
As a frontend developer, I need type-safe API clients so that I can call backend endpoints without manual typing errors.
**Acceptance Criteria**

1. Add NestJS Swagger decorators to all API controllers; generate OpenAPI spec at `/api/v1/openapi.json`.
2. Configure `@openapitools/openapi-generator-cli` to produce TypeScript SDK in `3. Implement automated OpenAPI diff checks in CI (fail PR if breaking changes detected without version bump).
4. Publish SDK to npm workspace so web and mobile apps can import typed client.
5. Document API versioning strategy: `/api/v1` stable; `/api/v2` for breaking changes; deprecation policy (90-day notice).
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
2. Document access/runbooks for each environment in `docs/test-environments.md`.
3. Implement weather harness as ` with fixture loading from `4. Configure CI to use stub provider (no real API calls); dev/staging use real OpenWeather test API key.
5. Validate environment readiness: run smoke tests in each environment and confirm pass.
   **Prerequisites:** CC-0.3 (Supabase), CC-0.4 (Redis), CC-0.7 (PostHog test project), CC-0.10 (fixture factories).

**Story CC-0.13: Scaffold cross-surface E2E automation**
As the master test architect, I need baseline Playwright (web) and Maestro (mobile) harnesses so that we can validate apps end-to-end before Epic 1 work begins.
**Acceptance Criteria**

1. Add Playwright (Chromium-only for now) at the repo root with a shared `playwright/config` directory, smoke spec hitting the Next.js landing route, and scripts `npm run test:pw-local` / `TEST_ENV=<env> npm run test:pw` that build, serve, and execute the tests headlessly per docs/test-design-system.md Test Framework guidance.
2. Add Maestro scaffolding under `maestro/` with a `sanity.yaml` flow launching the Expo app via Expo Router dev server URL injected through env vars, plus scripts `npm run test:e2e:mobile` / `npm run test:e2e:mobile:ci` that install the Maestro CLI and run the smoke flow locally and in CI.
3. Update root documentation (README + docs/testing notes) with prerequisites for local emulators/Maestro Cloud, describe how developers run both smoke suites concurrently with `npm run dev`, and add new commands to the scripts table.
4. Extend `.github/workflows/pr-checks.yml` with an `e2e` job that reuses the install cache, builds once, runs Playwright + Maestro smoke commands, captures HTML/log artifacts, and is marked optional until suites stabilize.
   **Prerequisites:** CC-0.1 (monorepo scaffold), CC-0.5 (Turborepo/task graph), CC-0.6 (CI skeleton), CC-0.10 (fixture factories once data seeds land).

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

Present CoutureCast recommendations consistently across mobile, web widget, watch, and supported languages.

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

## Epic 4 — Wardrobe Capture & Closet Tools (Phase 2)

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

## Epic 5 — Commerce & Premium Enhancements (Phase 2)

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

## Epic 6 — Community & Moderation Loop (Phase 3)

Launch the community feed, engagement mechanics, and moderation controls supporting social growth.

**Stories**

**Story CC-6.1: Community feed by climate band**  
As a style explorer, I want a feed of looks from similar weather regions so that inspiration stays relevant.  
**Acceptance Criteria**

1. Group content by climate band (e.g., cold/wet, temperate) using current location.
2. Support photo post creation with caption and locale metadata.
3. Surface weekly challenge banner curated by editorial team.  
   **Prerequisites:** CC-3.1, CC-4.1.

**Story CC-6.2: Reactions and comments**  
As a community member, I want to react and comment on posts so that I can engage with peers.  
**Acceptance Criteria**

1. Provide curated emoji palette and threaded comments with report option.
2. Aggregate reactions to drive highlight ranking.
3. Enforce age gate (13+) and log interactions for analytics.  
   **Prerequisites:** CC-6.1.

**Story CC-6.3: Locale highlight modules**  
As a user, I want curated highlight sections so that standout looks surface quickly.  
**Acceptance Criteria**

1. Rank posts using reactions + recency to populate “City Spotlight” modules.
2. Display modules on home screen and community tab with CTA to view more.
3. Respect locale copy via localization framework.  
   **Prerequisites:** CC-6.2, CC-3.2.

**Story CC-6.4: Social export workflows**  
As a trendsetter, I want to share CoutureCast outfit cards to social platforms so that my friends see them.  
**Acceptance Criteria**

1. Provide native share sheet integration for Pinterest, Instagram, Facebook, TikTok.
2. Generate branded asset with optional watermark and stripped personal data.
3. Offer “Save to camera roll” fallback if platform share fails.  
   **Prerequisites:** CC-6.1, CC-2.1.

**Story CC-6.5: Moderation queue & SLA tracking**  
As a community manager, I need queueing and audit controls so that flagged content is reviewed within 24 hours.  
**Acceptance Criteria**

1. Capture flags with content snapshot and submit to moderation dashboard.
2. Track review timestamps, actions (resolve, escalate, ban) and enforce 24-hour SLA alerts.
3. Maintain immutable audit log for 12 months.  
   **Prerequisites:** CC-6.1, CC-1.4.

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

- **Sprint 0 (Epic 0)**: Provision infrastructure, test environments, and development tooling. Complete all 12 foundation stories (CC-0.1 through CC-0.12) before Epic 1 begins. Critical path: CC-0.1 → CC-0.2 → CC-0.3 → CC-0.11 (guardian consent) establishes baseline; CC-0.4 through CC-0.12 can partially overlap.
- **Phase 1 (Epics 1–3)**: Build the weather backbone, personalization engine, and cross-surface experiences with localization. Stories CC-1.1, CC-2.1, CC-3.1 can kick off in parallel once Epic 0 is complete.
- **Phase 2 (Epics 4–5)**: Layer wardrobe capture and monetization. Ensure CC-4.1 (garment capture) lands before CC-5.4 (palette advisor) so the advisor has wardrobe context.
- **Phase 3 (Epic 6)**: Launch community loop; run CC-6.1–CC-6.3 sequentially before enabling social export and moderation.

### Parallelization hints

**Epic 0 (Sprint 0) Parallel Opportunities:**

- After CC-0.1 completes: CC-0.2, CC-0.3, CC-0.4, CC-0.5, CC-0.7, CC-0.8, CC-0.9 can run in parallel (different service domains)
- Sequential required: CC-0.1 → {CC-0.2, CC-0.3} → CC-0.11 (guardian consent needs Prisma + Supabase); CC-0.10 → CC-0.12 (test fixtures needed for environment validation); CC-0.6 (CI/CD needs CC-0.10 fixtures for testing)

**Feature Epics (Phase 1-3) Parallel Opportunities:**

- Parallel-ready stories: CC-1.1 & CC-1.4 (telemetry) can run concurrently once API schema agreed. CC-3.2 (localization) and CC-3.3 (widgets) can overlap after CC-3.1 design tokens settle.
- Sequential chains: CC-2.1 → CC-2.2 → CC-2.3; CC-4.1 → CC-4.2 → CC-4.3; CC-5.2 gates CC-5.3, CC-5.4 & CC-5.5; CC-6.1 → CC-6.2 → CC-6.3 → CC-6.5.

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
- **Phase 2 complete:** Users can build wardrobes, subscribe, and engage with premium commerce experiences.
- **Phase 3 complete:** Community feed live with moderated engagement, highlight modules, and social sharing.

---

## Summary

- **Epics:** 7 (including Epic 0: Platform Foundation)
- **Stories:** 41 (12 Epic 0 infrastructure + 29 feature stories)
- **Parallel-ready stories:** 9 (post-Epic 0 completion)
- **Sequential dependency chains:** Epic 0 → all other epics (critical path); 6 primary chains within feature epics
- **Estimated cadence:** Sprint 0 (Epic 0 foundation), Phase 1 (~2 sprints for Epics 1-3), Phase 2 (~2 sprints for Epics 4-5), Phase 3 (~2 sprints for Epic 6)
- **Total Duration:** ~7-8 sprints (Sprint 0 + 6-7 feature sprints = 14-16 weeks / 3.5-4 months)

**Epic 0 (Sprint 0) Completion Criteria:**
All 12 infrastructure stories (CC-0.1 through CC-0.12) must complete before Epic 1 feature work begins. This includes: monorepo initialization, Prisma schema, Supabase setup, Redis/BullMQ config, Socket.io gateway, CI/CD pipelines, observability stack, secret management, OpenAPI tooling, test fixtures, guardian consent implementation, and test environment provisioning.

Every story is scoped for a single-agent session and tagged with prerequisites to keep dependency management explicit. Use the `create-story` workflow for detailed implementation plans as you pull stories into sprint planning. Vision requirement FR8 (CoutureCast Jr.) remains intentionally unassigned pending dedicated discovery.
