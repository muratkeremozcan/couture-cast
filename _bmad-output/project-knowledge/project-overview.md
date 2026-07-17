# Project overview

Updated: 2026-07-17 - Current-state entry point for the completed BMAD brownfield deep scan.

## Purpose

CoutureCast is a multi-platform lifestyle product that combines local weather with personalized
outfit guidance. The product brief targets users aged 13 and older, with guardian consent for ages
13-15, and plans community, wardrobe, premium, widget, watch, and localization experiences in
phases. This overview describes what the repository implements now; use the
[brief](couturecast_brief.md) for product intent and the [roadmap](couturecast_roadmap.md) for
authoritative phase order.

## Executive summary

The repository contains substantial backend and platform foundations but not a production-complete
end-user product. A NestJS modular monolith implements identity, guardian consent, locations,
persisted weather, daily outfit recommendations, alerts, event polling, telemetry, moderation, and
feature-flag infrastructure. PostgreSQL migrations add RLS, constraints, outbox coordination, and
immutable audit evidence. Shared Zod contracts generate OpenAPI and a TypeScript Fetch SDK.

The Next.js and Expo clients currently expose landing/diagnostic, signup, invitation, and consent
dashboard surfaces. Neither client implements a Supabase session, Bearer-token lifecycle, or
role-aware navigation, so protected product paths are incomplete. Weather ingestion and alert
delivery depend on a standalone BullMQ worker for which no hosted deployment is recorded. The
roadmap's widget/watch, localization, community, wardrobe upload, premium, and Jr. experiences are
not implemented product flows.

## Repository classification

CoutureCast is a private TypeScript npm-workspaces monorepo orchestrated by Turborepo. It has three
application workspaces and seven package workspaces. Architecturally it is a five-part brownfield
system: a modular-monolith API with a companion worker, web and mobile clients, a database package,
and a shared-package layer. It is not a microservices repository.

| Part     | Current stack                              | Primary pattern                                    | Root                                | Detailed docs                                                                       |
| -------- | ------------------------------------------ | -------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| API      | NestJS 11, Prisma 6, BullMQ 5, Socket.io 4 | Modular monolith plus worker                       | [`apps/api`](../../apps/api/)       | [Architecture](architecture-api.md), [contracts](api-contracts-api.md)              |
| Web      | Next.js 15, React 19, Tailwind 3           | App Router server shells with client leaves        | [`apps/web`](../../apps/web/)       | [Architecture](architecture-web.md), [components](component-inventory-web.md)       |
| Mobile   | Expo 54, Expo Router 6, React Native 0.81  | File-based routes with local screen state          | [`apps/mobile`](../../apps/mobile/) | [Architecture](architecture-mobile.md), [components](component-inventory-mobile.md) |
| Database | Supabase PostgreSQL, Prisma 6              | Prisma model plus authoritative SQL migrations     | [`packages/db`](../../packages/db/) | [Architecture](architecture-database.md), [models](data-models-database.md)         |
| Shared   | Six private npm packages, Zod, OpenAPI     | Exported contracts, policy, test, and k6 libraries | [`packages`](../../packages/)       | [Architecture](architecture-shared.md), [packages](shared-packages.md)              |

Installed versions come from [`package-lock.json`](../../package-lock.json), not older planning
documents.

## Architecture and data flow

Web and mobile call the NestJS API over JSON/HTTPS. Protected HTTP routes require Supabase Bearer
tokens; the API validates tokens through Supabase Auth, applies role and teen-consent guards, and
uses owner-scoped Prisma repositories. Prisma connects as a trusted backend, so API filters and
direct-client PostgreSQL RLS are separate authorization lanes.

Human-authored Zod modules in `@couture/api-client` produce OpenAPI 3.1 and the generated Fetch SDK.
Controllers remain authoritative for routes that actually exist, and Zod remains the runtime trust
boundary because generated SDK runtime checks are disabled.

The worker fetches OpenWeather data with WeatherAPI fallback, persists normalized snapshots and 48
forecast segments, then evaluates alerts. Alert events, cooldowns, and outbox rows are committed in
PostgreSQL before BullMQ handoff. Fan-out uses Redis pub/sub for Socket.io delivery and Expo Push
when realtime is unavailable; persisted events also support polling. The ritual API combines saved
location, weather, comfort preferences, and garments, with Redis as a degradable cache.

See [integration architecture](integration-architecture.md) for the complete system map and
[source tree analysis](source-tree-analysis.md) for ownership and entry points.

## Current implementation versus planned scope

| Area           | Implemented now                                                        | Planned or incomplete                                                 |
| -------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Core backend   | Weather persistence, ritual API, locations, alerts, consent, analytics | Hosted workers, reliable realtime runtime, dependency readiness       |
| Web and mobile | Signup, invitation/consent views, diagnostics, analytics               | Login/session, protected navigation, core weather/outfit product UX   |
| Phase 1        | Backend weather/outfit foundations and analytics contracts             | Widgets/watch, EN/ES/FR localization, complete first-outfit journey   |
| Phase 2        | Social data models and one moderation action endpoint                  | Community feed, challenges, complete moderation operations/readiness  |
| Phase 3        | Garment and recommendation models                                      | Wardrobe upload/storage flow, premium subscriptions and planner       |
| Phase 4        | Under-13 blocking in shared age policy                                 | Separate CoutureCast Jr. product and counsel-approved compliance path |

Database models, queue names, contracts, or dormant adapters are foundations, not proof of a
reachable product capability.

## High-priority current risks

1. **Client authentication is absent.** Web and mobile cannot reliably call protected profile,
   weather, ritual, alert, or event routes.
2. **Operator and invitation endpoints are exposed.** Failed-job list/retry routes are public, and
   invitation creation accepts an arbitrary teen ID and returns a signed link.
3. **Workers have no hosted target.** Production weather refresh, outbox dispatch, realtime relay,
   and push delivery cannot be assumed to run.
4. **The production API topology does not match the long-running design.** Vercel serverless omits
   key logging/telemetry setup and is unsuitable for reliable sockets, subscriptions, and cron.
5. **Authorization has two enforcement lanes.** Trusted Prisma calls do not inherit end-user RLS;
   every API repository must apply correct ownership filters.
6. **Migrations run during API builds.** There is no separate approval, backup, readiness probe,
   rollback, or automated restore path.
7. **Contracts can drift.** OpenAPI generation does not inspect controllers, generated checks are
   disabled, and web/mobile still handwrite most feature transports.
8. **Operational evidence is shallow.** Health endpoints do not verify the database, Auth, Redis,
   workers, providers, or queues; production API SHA verification is also incomplete.

## Getting started

Use Node.js 24, npm 10.8.1, Docker with Compose, and the repository root:

```bash
nvm install 24
nvm use 24
npm ci
npm run supabase:start
docker compose up -d redis
```

Start each runtime explicitly in a separate terminal:

```bash
npm run start:api
npm run start:workers --workspace api
npm run dev --workspace web
npm run start --workspace mobile
```

Set only the environment values needed for the target, using
[`.env.example`](../../.env.example) as the inventory. `npm run start:all` resets and seeds the
selected local database, so do not use it when its data must survive. Validate a focused change
with `npm run verify:changed`; use `npm run validate` for the repository typecheck, lint, test, and
build gate. Contract, database integration, Playwright, Pact, Maestro, k6, and Markdown checks are
separate boundary-specific gates. See the [development guide](development-guide.md) for the full
command matrix and the [deployment guide](deployment-guide.md) for environment/runtime limits.

## Detailed documentation

- Architecture: [API](architecture-api.md), [web](architecture-web.md),
  [mobile](architecture-mobile.md), [database](architecture-database.md), and
  [shared packages](architecture-shared.md)
- System navigation: [source tree](source-tree-analysis.md) and
  [integration architecture](integration-architecture.md)
- Implementation inventories: [API contracts](api-contracts-api.md),
  [database models](data-models-database.md), [web components](component-inventory-web.md),
  [mobile components](component-inventory-mobile.md), and [shared packages](shared-packages.md)
- Operations: [development](development-guide.md), [deployment](deployment-guide.md),
  [secrets](secrets-management.md), and [observability](observability.md)
- Product authority: [project brief](couturecast_brief.md) and
  [roadmap](couturecast_roadmap.md)
