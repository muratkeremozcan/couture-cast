# CoutureCast Architecture

_Created on 2025-11-10 by BMad-user_

---

## Executive Summary

CoutureCast runs on a Supabase-first platform where a NestJS decision layer powers weather intelligence, outfit personalization, moderation, and notifications, while Expo Router delivers the ritual across iOS/Android/watch and Next.js App Router handles the responsive web plus admin tooling. A Turborepo monorepo keeps shared Prisma models, design tokens, and automated tests aligned so multiple agents can ship features without collisions. Free-tier friendly services (Supabase, Upstash, PostHog, Vercel for web/API, Expo EAS) let us launch quickly yet scale smoothly once the app succeeds in the stores.

## Project Initialization

First implementation story should execute the following commands (verify latest versions before running):

```bash
# Mobile + widgets
npx create-expo-app@3.10.1 apps/mobile --template

# Web + Turborepo scaffold (includes lint/tests)
npx create-next-app@15.0.3 apps/web --example with-turborepo

# API + workers
npx @nestjs/cli@11.1.2 new apps/api --package-manager npm
```

### Starter-provided decisions

- **create-expo-app@3.10.1** supplies Expo Router with TypeScript, ESLint, Metro config, OTA-ready `app.json`, default testing stubs, and platform assets so mobile/web/widget shells share identical navigation.
- **create-next-app@15.0.3** wires in the App Router, SWC, TypeScript, ESLint, Tailwind optionality, and Turborepo workspace config so the web BFF can share packages immediately.
- **@nestjs/cli@11.1.2** scaffolds the NestJS project structure (modules/controllers/providers), TypeScript config, ESLint, and testing harness we replace with Vitest.
- These templates collectively decide: TypeScript everywhere, linting defaults, base scripts (`dev`, `build`, `lint`), jest stubs (pruned), and the folder hierarchy under `apps/`. All other decisions in this document extend or override those defaults explicitly, so future agents know which behaviors are inherited versus custom.

### Version verification log (captured 2025-11-11)

| Tool / CLI | Command or source | Result (refreshed 2025-11-14) |
| ---------- | ----------------- | ----------------------------- |
| Node.js | `node --version` | v22.12.0 |
| npm | `npm --version` | 11.3.0 |
| create-expo-app | `npm info create-expo-app version` | 3.5.3 |
| create-next-app | `npm info create-next-app version` | 16.0.3 |
| @nestjs/cli | `npm info @nestjs/cli version` | 11.0.10 |
| Prisma | `npm info prisma version` | 6.19.0 |
| Next.js | `npm info next version` | 16.0.3 |
| Expo SDK | `npm info expo version` | 54.0.23 |
| Vitest | `npm info vitest version` | 4.0.9 |
| Playwright | `npm info playwright version` | 1.56.1 |
| Maestro CLI | Local binary metadata | 3.3.0 |

These commands establish TypeScript, ESLint, testing harnesses, and directory conventions that every downstream story inherits, with version locks recorded above for traceability.

- **Breaking change watchlist (updated 2025-11-14):** Node.js 22.x is the current LTS; ensure any native addons and tooling declare support for Node ≥22 before upgrading runtime images. Next.js 16.0.3 keeps the App Router requirement and ships with React 19 features—stay on template versions that match this stack or pin to older versions if React 19 support becomes an issue. Prisma 6.x drops compatibility with Node 16 and has new client bundling defaults, so re-run `prisma generate` before merging. Vitest 4.x introduces new config defaults (Vitest runner 2 pipeline); verify shared `vitest.config.ts` aligns. Continue routing schema changes through `prisma migrate dev`—`prisma migrate save` remains removed.
These commands establish TypeScript, ESLint, testing harnesses, and directory conventions that every downstream story inherits.

## Decision Summary

| Category                  | Decision                                                  | Version (verified 2025-11-11)        | Affects Epics | Rationale                                                                           |
| ------------------------- | --------------------------------------------------------- | ------------------------------------ | ------------- | ----------------------------------------------------------------------------------- |
| Data store                | Supabase-managed PostgreSQL + Prisma ORM                  | Postgres 15.5 / Prisma 5.9.1         | 1‑6           | Free tier, RLS, familiar tooling, easy migration to Fly/AWS later                   |
| Media pipeline            | Supabase Storage + NestJS color-analysis worker           | Supabase Storage SDK 2.8.5           | 2,4,6         | Keeps wardrobe images + derived palettes in-house with webhook-triggered processing |
| API pattern               | Versioned REST (`/api/v1`) + Next.js BFF route handlers   | NestJS 11.1.2 / Next.js 15.0.3       | 1‑6           | Simple contracts for Expo/widgets, SSR aggregation for web                          |
| AuthN/AuthZ               | Supabase Auth + NextAuth bridge + Postgres RBAC           | Supabase Auth 2.57 / NextAuth 5.1.2  | 3‑6           | Zero-cost identity, teen/guardian policies via RLS                                  |
| Personalization           | NestJS module + BullMQ + Redis cache                      | BullMQ 4.12.0 / Upstash Redis 1.29   | 2             | Deterministic rules + optional ML hook with caching                                 |
| Moderation                | NSFW model + text filters + human console (Next.js admin) | TensorFlow.js 4.16.0                 | 6             | Meets 24h SLA, logs to Postgres audit trail                                         |
| Real-time + notifications | Socket.io + Expo Push API                                 | Socket.io 4.7.2 / Expo SDK 51.0.3    | 1‑6           | Live ritual updates plus push alerts without extra vendors                          |
| Deployment                | Vercel (web/API serverless), Expo EAS (apps)              | Vercel Platform 2025.10 / Expo EAS CLI 3.17 | All | Free-tier friendly, regional scaling ready                                          |
| Search                    | PostgreSQL FTS + trigram (upgrade path to Typesense)      | pg_trgm 1.6                          | 3‑6           | No extra cost now, abstraction ready for Typesense                                  |
| Background jobs           | BullMQ + Nest Cron decorators                             | BullMQ 4.12.0 / @nestjs/schedule 4.0 | 1‑6           | Unified queueing for weather, alerts, moderation                                    |
| Analytics/flags           | PostHog + OpenTelemetry → Grafana Cloud                   | PostHog Cloud 1.83 / OTLP exporter 0.50 | All        | Product analytics, feature flags, observability in one stack                        |
| Localization              | `inlang`/`i18next` JSON catalogs served from Next.js      | i18next 23.11.0                      | 3‑6           | Updates locales without app releases                                                |
| Testing                   | Turborepo tasks (Vitest, Playwright, Maestro) | Vitest 2.1.4 / Playwright 1.49.1 / Maestro 3.3.0 | All           | Ensures every layer is verifiable without Appium                                    |
| Edge caching              | Vercel Edge Config + REST cache headers                   | Edge Config API 2.4                  | 1‑3           | Keeps ritual snappy under load                                                      |
| Experimentation           | PostHog multivariate flags                                | PostHog Experiments 1.83             | 5             | Run premium/commerce experiments without new tooling                                |

## Project Structure

```
couturecast/
├─ apps/
│  ├─ web/                  # Next.js App Router + BFF route handlers
│  ├─ mobile/               # Expo Router (iOS/Android/watch/widgets)
│  └─ api/                  # NestJS monolith (REST, Socket.io, BullMQ workers)
├─ │  ├─ db/                   # Prisma schema + migrations + client factory
│  ├─ tokens/               # Design tokens shared across web/mobile
│  ├─ ui-web/               # Vite component library + Story/preview files
│  ├─ api-client/           # Generated OpenAPI SDK consumed by apps
│  └─ testing/              # Playwright/Maestro fixtures + mock servers and seed utils
├─ infra/
│  ├─ vercel/               # Vercel configs (web/api projects)
│  ├─ vercel/               # Edge Config, env templates
│  └─ eas/                  # Expo EAS configs (ignored in git)
├─ tools/                   # Scripts/generators (migrate, seed, sync-i18n)
├─ docs/                    # PRD, UX spec, architecture, validation
├─ .github/workflows/       # CI/CD pipelines (lint, tests, deploy)
├─ turbo.json               # Task graph for lint/test/build
└─ package.json (npm workspaces) / package-lock.json
```

## Epic to Architecture Mapping

| Epic                                           | Scope                                                   | Primary Modules / Services                                                                     |
| ---------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1 – Weather Intelligence & Platform Foundation | Weather ingestion, location prefs, alerts, telemetry    | `apps/api` (weather module, Cron), BullMQ jobs, Prisma weather tables, PostHog instrumentation |
| 2 – Outfit Personalization Core                | Scenario outfits, comfort calibration, reasoning badges | `apps/api` personalization module, Redis cache, ` Expo ritual screens         |
| 3 – Multi-surface Delivery                     | Web/mobile/watch/widgets ritual                         | `apps/mobile`, `apps/web`, Socket.io gateway, Next.js BFF, `                   |
| 4 – Wardrobe & Silhouette Management           | Uploads, color analysis, silhouette overlay             | Supabase Storage + NestJS worker, Prisma wardrobe tables, Expo upload flows                    |
| 5 – Commerce & Premium                         | Premium themes, commerce rails, experiments             | Next.js premium flows, PostHog flags, NestJS commerce module                                   |
| 6 – Community & Moderation                     | Lookbook feed, engagement, moderation console           | NestJS community module, Socket.io events, Next.js admin routes, BullMQ moderation queue       |

## Technology Stack Details

### Core Technologies

- **Frontend:** Next.js 15 App Router, Expo Router (SDK 51), React 19, Tailwind CSS + custom couture tokens.
- **Backend:** NestJS 11, Prisma 5, Node.js 20 LTS, BullMQ 4, Socket.io 4, Supabase Postgres 15, Supabase Storage, Upstash Redis.
- **Tooling:** Turborepo + npm workspaces, Vitest, Playwright, Maestro, PostHog, OpenTelemetry/Grafana Cloud, Vercel Edge Config.

### Integration Points

- **Weather provider** (OpenWeather or chosen API) ingested hourly via NestJS Cron + BullMQ jobs.
- **Supabase webhooks** trigger color-analysis workers on new wardrobe uploads.
- **PostHog** SDKs in Expo/Next.js feed event + experimentation data while server-side uses their REST API for flag checks.
- **Expo Push API** sends alerts; Socket.io mirrors the same payload for web/widgets.
- **Payments/commerce** reserved for future integration (Stripe) with placeholders in the commerce module.

## Novel Pattern Designs

### Lookbook Prism Orchestrator

- **Goal:** Keep the hero ritual and community inspiration visible simultaneously without blocking renders.
- **Structure:** `RitualPanel` (SSR via BFF) + `LookbookFeed` (Socket.io stream) coordinated by `PrismCoordinator` hook that stores layout state (chips, premium skins) in a shared Zustand store. Community updates stream independently, while ritual updates tap cached personalization payloads. Skeletons ensure degraded networks still show context.
- **States & transitions:** `idle` → `loading` (skeletons) → `hydrated`. From `hydrated`, users can branch into `premium-theme-preview` (when previewing seasonal skins) or `community-highlight` (when focusing on community posts). `PrismCoordinator` enforces transitions and prevents community fetches from blocking ritual rendering.
- **Failure modes:** Socket disconnect → fall back to `community-stale` state with cached feed and toast; personalization errors → inline banner plus retry button; premium preview timeout → auto revert to `hydrated`.

### Silhouette Overlay & Color Pipeline

- **Goal:** Process sensitive wardrobe/silhouette uploads entirely in-house while keeping UI responsive.
- **Flow:** Expo `UploadService` enforces background/contrast rules and writes to Supabase via signed URLs. Supabase sends a webhook → NestJS `ColorWorker` pulls the asset, extracts palettes (Sharp + ONNX/TensorFlow), saves metadata to Postgres, writes derived overlays to `/derived/{userId}/{assetId}`, and emits a Socket.io event when ready. UI `SilhouetteRenderer` consumes the derived asset + palette tokens for consistent overlays.
- **States & transitions:** `uploading` → `processing` → `ready` or `failed`. When `processing`, worker job IDs are stored so UI can poll/subscribe; `failed` includes reason codes (contrast, privacy violation, timeout) to inform the user.
- **Failure modes:** Worker timeout triggers up to 3 exponential retries before setting status `failed`; moderation/NSFW flags short-circuit the flow and notify guardian/moderator channels; storage errors revert to `uploading` with actionable guidance.

## Implementation Patterns

- Feature-first directories (`apps/api/src/modules/lookbook`, `apps/web/app/(ritual)`).
- PascalCase components, kebab-case file names, snake_case DB tables (`garment_items`, `palette_insights`).
- REST success payloads always `{ data }`, lists add `{ meta: { total, page, pageSize } }`, errors `{ error: { code, message, detail? } }`.
- Socket.io events namespaced (`lookbook:new`, `ritual:update`) with `version` and `timestamp`.
- Background jobs retry 5 times with exponential backoff before hitting the DLQ (stored in Postgres for audit).
- Tests: colocated `*.test.ts` except Playwright/Maestro suites in `
## Consistency Rules

- **Error handling:** map server codes to couture-themed banners/toasts; moderation/auth failures append to `audit_log`.
- **Logging:** Pino (API) + consola (clients) emit JSON with `timestamp`, `requestId`, `userId`, `feature`; forwarded via OTLP to Grafana Cloud.
- **Date/time:** store UTC `TIMESTAMPTZ`, expose ISO 8601; format via `dayjs` respecting locale. Canonical data remains metric/°C; toggles convert to imperial for display.
- **Feature flags:** PostHog helpers in ` feature code must check flag + fallback to Postgres toggle.
- **Testing gates:** Turborepo runs lint → unit (Vitest) → API schema check (OpenAPI/Zod) → e2e (Playwright/Maestro) on every PR; merge blocked if any snapshot or schema mismatches.

## Data Architecture

- **Core tables:** `users`, `user_profiles`, `guardian_consent`, `weather_snapshots`, `forecast_segments`, `comfort_preferences`, `garment_items`, `palette_insights`, `outfit_recommendations`, `lookbook_posts`, `engagement_events`, `moderation_events`, `audit_log`.
- **Relationships:** `user_profiles` ↔ `garment_items` (one-to-many), `lookbook_posts` reference `palette_insights` for derived colors, `moderation_events` link to `lookbook_posts` or `garment_items`, `outfit_recommendations` cached per `user_id + forecast_segment_id`.
- **Search:** materialized view `search_documents` aggregates wardrobe, community, and commerce metadata with locale-specific tokens; FTS indexes plus trigram similarity for fuzzy queries.

## API Contracts

- All public endpoints prefixed `/api/v1`.
- Authentication via Supabase JWT; BFF handles cookie sessions for web.
- Example endpoints:
  - `GET /api/v1/ritual?locationId=...` → `{ data: { weather, outfits, badges } }`
  - `POST /api/v1/lookbook` → creates post; responds with `{ data: { id, status } }`
  - `POST /api/v1/moderation/:id/resolve` → moderators mark events complete.
- OpenAPI spec generated from NestJS decorators and published to ` for typed SDK generation; schema drift caught via automated OpenAPI diff checks in CI.

## Security Architecture

- Supabase Auth + RLS enforce tenant isolation; guardian consent stored and checked before enabling uploads for under-16 accounts.
- Postgres `pgcrypto` encrypts sensitive guardian/contact fields.
- NestJS guards enforce role-based access (teen, adult, guardian, moderator, brand).
- Audit logging writes immutable entries for authentication changes, moderation decisions, and data exports.
- All secrets managed via Doppler (or Supabase Vault) per environment; least-privilege service keys for Supabase Storage.

## Performance Considerations

- Redis cache (Upstash) stores personalization payloads per user/location/time block for 15 minutes.
- Vercel Edge Config caches weather + outfit snippets with ISR; NestJS responses include cache headers so CDN edges honor short TTLs.
- BullMQ queues throttle weather ingestion and alert fan-out to avoid provider rate limits.
- Playwright synthetic monitoring (cron job) hits ritual endpoints to ensure <2s load time on reference devices; telemetry fed into Grafana when breaches occur.

## Deployment Architecture

- **Web:** Vercel (Hobby tier). Preview deployments per PR; promote to production on main merges.
- **API + workers:** Vercel serverless (Nest adapter) for HTTP; background workers deferred until workload requires dedicated hosts.
- **Mobile:** Expo EAS for build/signing, distributing via App/Play stores. OTA updates for minor UI copy or token tweaks.
- **Networking:** Custom domain `couturecast.app` with `app.` (Vercel) and `api.` (Fly) subdomains; HSTS enforced. Socket.io + REST behind HTTPS only.

## Development Environment

### Prerequisites

- Node.js 20 LTS, npm 10+ (workspaces enabled), Docker (for local Postgres if needed), Supabase CLI, Fly CLI, Vercel CLI, Expo CLI, OpenSSL (for auth keys).

### Setup Commands

```bash
npm install
npm run db:migrate        # Apply Prisma schema to Supabase (or local Postgres)
npm run dev:web           # Runs Next.js + BFF
npm run dev:mobile        # Starts Expo (web target by default)
npm run dev:api           # Runs NestJS API + workers
npm test                  # Runs lint + unit suites
npm run test:pw-local     # Playwright smoke (local)
npm run test:e2e:mobile   # Maestro flows
```

## Architecture Decision Records (ADRs)

1. **ADR-001 Data Persistence:** Supabase Postgres + Prisma for unified models and migrations.
2. **ADR-002 Media Pipeline:** Supabase Storage + NestJS color-analysis worker keeps wardrobe assets private.
3. **ADR-003 API Contracts:** REST + Next.js BFF with OpenAPI + typed SDK.
4. **ADR-004 Auth & Roles:** Supabase Auth + NextAuth + Postgres RBAC + guardian consent.
5. **ADR-005 Personalization Engine:** NestJS module + BullMQ + Redis caching with ML hook.
6. **ADR-006 Moderation Pipeline:** Automated NSFW/text screening plus human console + audit logging.
7. **ADR-007 Real-time + Notifications:** Socket.io + Expo Push + shared payload schema.
8. **ADR-008 Deployment Targets:** Vercel (web/API serverless), Expo EAS (stores), Upstash Redis, PostHog analytics.
9. **ADR-009 Search Strategy:** Postgres FTS now, Typesense-ready abstraction for scale.
10. **ADR-010 Testing & CI:** Turborepo orchestrated Vitest unit suites plus Playwright/Maestro end-to-end checks gating every PR.
11. **ADR-011 Edge Caching & Experiments:** Vercel Edge Config + PostHog experiments for premium/commercial trials.
12. **ADR-012 Weather Provider Selection & Failover Strategy:** Primary provider OpenWeather API v3.0 (One Call API) with 1000 free calls/day; backup provider WeatherAPI.com activated on primary failure (3+ consecutive errors or rate limit exceeded). Failover logic: exponential backoff (5s, 15s, 45s) then switch provider; cache last-known weather for 60 min as tertiary fallback. Adapter pattern (`IWeatherProvider` interface) ensures swappable implementations without business logic changes. Contract tests validate response schema matches expected shape for both providers; weekly cron job checks provider availability and SLA compliance.
13. **ADR-013 Moderation Tooling Selection:** In-house NestJS moderation console (not external vendor) to maintain full control over audit trail, customization, and cost. TensorFlow.js NSFW model for automated image screening (runs server-side in BullMQ worker); profanity filter using `bad-words` library for text; human moderators review flagged content via Next.js admin console (`apps/web/app/admin/moderation`). Moderation queue stored in Postgres with immutable audit trail; SLA tracking via PostHog metrics. Decision favors control and cost over vendor speed; staffing plan requires 2 moderators during beta (24-hour coverage via rotating shifts).
14. **ADR-014 Color Analysis Architecture:** Server-side processing (not on-device) for wardrobe color extraction and palette analysis. NestJS worker receives upload webhook from Supabase Storage, processes via Sharp (image resize) → ONNX Runtime (color inference using pre-trained model), then caches results in `wardrobe_items.color_palette` JSONB column. Privacy: images stay in Supabase Storage with user-scoped access; only derived metadata (palette hex codes, undertone classification) surfaces to clients. Performance: ~3-5s per image; GPU fallback to CPU in CI environments. On-device processing rejected due to: (1) model size (50+ MB) would bloat mobile bundle, (2) inconsistent device performance (older Android devices timeout), (3) centralized processing enables palette quality monitoring and ML model updates without app releases.

---

_Generated by BMAD Decision Architecture Workflow v1.0 — Date: 2025-11-10 — For: BMad-user_
_Updated: 2025-11-13 — ADR-012 through ADR-014 added to resolve open technical questions_

## Real-time reference flows

- **Namespaces (ADR-007):** `lookbook:new`, `ritual:update`, `alert:weather`. Base payload: `{ version: string; timestamp: ISO8601; userId: string; data: T }`. Event schemas live in `@couture/api-client/src/types/socket-events.ts`.
- **Connection lifecycle (Socket.io):**
  1) Client connects with auth token; server middleware rejects missing token.
  2) `ConnectionManager` logs connect/disconnect (namespace, requestId, userId), retries with backoff (1s, 3s, 9s; max 5). Emits `connection:retry` or `connection:fallback`.
  3) On reconnect success, client resumes socket stream.
- **Fallback (polling):**
  - API: `GET /api/v1/events/poll?since=<ISO>` returns ordered events + `nextSince`.
  - Clients (web/mobile): disconnect → start `PollingService` (default 30s); reconnect → stop polling. Telemetry hooks for activate/deactivate and errors.
  - Server stores events in `EventEnvelope` (channel, payload, user_id, created_at) for poll retrieval.
- **Expo push flow:**
  1) Client registers Expo push token → `PushNotificationService.registerPushToken` (validates format, stores via Prisma `PushToken`).
  2) Batch sends (`EXPO_BATCH_SIZE=100`) via Expo SDK; classifies `DeviceNotRegistered` and `MessageRateExceeded` tickets.
  3) Access token: `EXPO_ACCESS_TOKEN` (documented in .env.example).
- **Troubleshooting:** Missing socket auth token → connection rejected. Exceeded retries → client switches to polling. Invalid `since` → poll returns `{ error: 'Invalid since timestamp' }` and empty events. Expo errors surfaced per-ticket; invalid tokens are reported for cleanup.
