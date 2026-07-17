# API architecture

Updated: 2026-07-17 - Current-state brownfield architecture of `apps/api`.

<!-- markdownlint-disable MD013 -->

## Scope and evidence boundary

This document describes the API implementation in the current working tree. It is not a target
architecture or a restatement of product plans. Runtime source, current manifests, the lockfile,
the Prisma schema, and committed migrations take precedence over planning artifacts.

The detailed companion inventories are:

- [API contracts](api-contracts-api.md)
- [Database models and security](data-models-database.md)
- [Integration architecture](integration-architecture.md)
- [Source tree analysis](source-tree-analysis.md)
- [Development guide](development-guide.md)
- [Deployment guide](deployment-guide.md)

The older [architecture plan](../planning-artifacts/architecture.md) is useful only as intent.
Planned modules such as lookbook, community, commerce, and color analysis are not API features
merely because a database model, queue name, or event schema exists.

## Executive summary

[`apps/api`](../../apps/api/) is a NestJS modular monolith with three entry points:

1. [`src/main.ts`](../../apps/api/src/main.ts) starts a long-running HTTP and Socket.io server.
2. [`api/index.ts`](../../apps/api/api/index.ts) adapts the same `AppModule` to a cached Vercel
   serverless Express handler.
3. [`src/workers/bootstrap.ts`](../../apps/api/src/workers/bootstrap.ts) starts standalone BullMQ
   schedulers and consumers.

The HTTP application follows a feature-first controller/service/repository pattern. Controllers
define the routes that actually exist. Shared Zod schemas in
[`packages/api-client`](../../packages/api-client/src/contracts/http/) define canonical public
request and response shapes where adopted. Services contain domain behavior, and repositories use
Prisma against PostgreSQL. Weather ingestion and alert delivery add an asynchronous,
Redis-backed pipeline with a durable PostgreSQL outbox.

The currently documented production API target is a Vercel Node function. That runtime is
materially different from the long-running bootstrap: it omits the explicit environment loader,
OpenTelemetry initialization, request logging/context middleware, global exception telemetry,
OpenAPI mounting, and startup analytics. Socket.io, Redis subscriptions, in-process cron jobs, and
the separate workers do not have a reliable or recorded production runtime.

## Exact implemented stack

Versions below are installed resolutions from [`package-lock.json`](../../package-lock.json), not
versions copied from planning documents:

- Node.js 24 or later; TypeScript 5.9.3; npm workspaces and Turborepo.
- NestJS common, core, Express platform, Socket.io platform, and websockets 11.1.9.
- Nest schedule 6.0.1 and Nest Swagger 11.2.6.
- Express through Nest's platform adapter; RxJS 7.8.2 and reflect-metadata 0.2.2.
- Prisma Client 6.19.0 with PostgreSQL hosted locally or remotely by Supabase.
- Zod 3.25.76 for runtime contract validation.
- BullMQ 5.65.0 and ioredis 5.8.2 for queues, cache, pub/sub, and schedulers.
- Socket.io 4.8.1 for realtime namespaces and user rooms.
- Expo Server SDK 4.0.0 for push delivery.
- PostHog Node 5.21.2 for analytics and remote feature flags.
- OpenTelemetry Node SDK 0.213.0 with OTLP/HTTP trace and metric exporters.
- Pino 9.14.0 and pino-http 11.0.0 for structured long-running-process logs.
- Swagger UI Express 5.0.1 for optional live documentation.
- Vitest 4.0.9, Supertest 7.1.4, Testcontainers 11.9.x, Pact, Playwright, and k6
  across API and repository-level verification.

The API also consumes internal workspaces:

- `@couture/api-client` for HTTP, Socket.io, polling, and analytics contracts.
- `@couture/config` for feature-flag definitions and fallback behavior.
- `@couture/utils` for shared age and birthdate policy.
- `@couture/testing` for synthetic factories in tests.

## Architecture pattern

The current shape is a **modular monolith with a companion worker process**:

- `AppModule` is the HTTP composition root and imports feature modules.
- Feature modules use Nest dependency injection and generally separate transport, domain logic,
  and persistence into controllers, services, and repositories.
- A global `PrismaModule` provides one process-level `PrismaClient`.
- Shared Zod contracts are authored outside the app; OpenAPI and the generated SDK are derived.
- BullMQ moves weather ingestion and alert fan-out out of request handlers.
- PostgreSQL event/outbox records bridge durable state to Redis-backed delivery.
- Socket.io and HTTP event polling are two delivery paths over persisted or relayed events.

This is not a set of independently deployable microservices. Feature folders share one module
graph, one database model, and in-process providers. The worker is independently bootstrapped but
reuses API source and the same PostgreSQL and Redis resources.

## Runtime composition

[`AppModule`](../../apps/api/src/app.module.ts) always enables `ScheduleModule` and imports
analytics, alerts, notifications, events, auth, guardian, feature flags, moderation, user,
locations, weather, telemetry, and personalization. It imports the gateway unless
`DISABLE_WEBSOCKETS=true`. Root, API health, queue health, and admin controllers are registered
directly rather than through feature modules.

The long-running bootstrap:

1. loads root environment files;
2. initializes OpenTelemetry before importing Nest;
3. creates the application;
4. installs request context and Pino request logging;
5. installs the telemetry-aware global exception filter;
6. optionally mounts `/api/v1/openapi.json` and `/api/docs`;
7. listens on `PORT`, defaulting to 3000; and
8. emits a best-effort `api_started` analytics event.

The Vercel bootstrap creates an Express adapter, initializes Nest once per warm function instance,
caches the server promise, and forwards requests. It does not execute the long-running bootstrap
steps listed above.

The worker bootstrap loads environment files, creates all queues, instantiates worker-side
services directly rather than through Nest, registers BullMQ schedulers, starts four consumers,
and closes workers, queues, Redis, PostHog, and Prisma on `SIGTERM` or `SIGINT`.

## Module and component overview

### Domain modules

- **Auth**: public signup, guardian-consent recording, Supabase token identity mapping,
  application roles, teen-consent enforcement, and reusable auth-state providers.
- **Guardian**: invitation creation and token acceptance, consent revocation, invitation expiry,
  audit behavior, and daily age-based emancipation.
- **User**: protected profile read model, including linked guardians and teens.
- **Location preferences**: protected CRUD and primary-selection operations for saved locations.
- **Weather**: protected persisted-weather reads plus repository and query services. Provider
  ingestion is assembled by the worker, not the HTTP module.
- **Personalization**: protected daily ritual generation using location, weather, comfort,
  wardrobe, recommendations, and a degradable Redis cache.
- **Alerts**: protected rules/preferences APIs, weather-rule evaluation, cooldown reservation,
  durable outbox creation, BullMQ handoff, realtime publication, and push fan-out components.
- **Events**: protected polling over persisted user-owned and global event envelopes.
- **Notifications**: push-token persistence and Expo push service used by worker fan-out. No
  implemented public push-token registration route exists.
- **Gateway**: authenticated Socket.io connection lifecycle, weather-alert rooms, and Redis alert
  relay.
- **Moderation**: guarded moderation-action tracking and audit behavior.
- **Telemetry**: Zod-validated telemetry persistence, independent PostHog capture, and retention
  cleanup.
- **Feature flags**: PostHog-to-database-to-code fallback and periodic cache synchronization.

### Cross-cutting and operator components

- **Analytics/PostHog**: provider adapters and startup/domain event capture.
- **Prisma**: global process-level client injection.
- **Logger and request context**: Pino configuration and per-request user/correlation context,
  installed only by the long-running HTTP entry.
- **Exception filter**: records error telemetry while preserving Nest's standard error body,
  installed only by the long-running HTTP entry.
- **OpenAPI publication**: serves the generated shared OpenAPI document when enabled.
- **Admin**: failed-job listing, replay, deletion after successful enqueue, and retention cleanup.
- **Health**: process/deployment metadata and configured queue names; neither is dependency
  readiness.

The exact implemented endpoint inventory and its contract exceptions are in
[API contracts](api-contracts-api.md#implemented-http-endpoints).

## Request, authentication, and validation flow

The normal protected HTTP flow is:

1. Nest routes the request to the controller. There is no global URL prefix and no global Zod or
   Nest validation pipe; routes include `/api/v1` in their controller paths.
2. `RequestAuthGuard` requires `Authorization: Bearer <access-token>`.
3. `AccessTokenIdentityService` calls Supabase Auth `GET /auth/v1/user` with a five-second timeout.
4. The returned body is Zod-validated. The API accepts only an allowed role from signed
   `app_metadata`.
5. Identity uses signed `app_metadata.app_user_id` when present. Otherwise, a verified email is
   matched case-insensitively to the application `User` table.
6. The guard attaches `{ token, userId, role }` to the request and request-log context.
7. A teen is rejected unless the guardian-consent state service allows access.
8. `RolesGuard` applies route-specific `guardian`, `moderator`, or `admin` restrictions.
9. Some sensitive controllers additionally bind authenticated IDs to body IDs.
10. The controller parses path, query, and body input with shared Zod schemas where implemented,
    calls a service, and usually parses the output with a response schema.

Local/Preview test token formats are enabled only when `TEST_ENV` is `local` or `preview`, or
`VERCEL_ENV` is `preview`. Some formats also consume test-only user and role headers. Production
identity resolution does not trust those headers.

Validation is explicit and controller-specific. Most canonical domain routes parse shared schemas,
but behavior is not globally uniform:

- some services, rather than controllers, validate auth, guardian, user, or moderation responses;
- admin and root routes have no shared public schema;
- success bodies mix `{ data: ... }` envelopes and bare objects;
- events return invalid cursors and repository failures as HTTP 200 empty-style bodies; and
- the global exception filter adds telemetry but does not normalize responses.

Controller source determines route existence when it disagrees with generated OpenAPI. The full
contract authority and drift analysis is in
[API contracts](api-contracts-api.md#purpose-and-authority).

## Persistence and data interactions

The API uses Prisma against `DATABASE_URL`. Logical models are owned by
[`schema.prisma`](../../packages/db/prisma/schema.prisma); committed
[`migrations`](../../packages/db/prisma/migrations/) additionally own checks, partial indexes,
grants, RLS, security-definer functions, and immutable-audit triggers.

Major API data paths are:

- identity and consent: `User`, `UserProfile`, `GuardianConsent`, and `GuardianInvitation`;
- user preferences: `ComfortPreferences`, `SavedLocation`, `AlertRule`, and
  `NotificationPreference`;
- weather: normalized `WeatherSnapshot`, exactly 48 `ForecastSegment` rows, and
  `WeatherIngestionState`;
- personalization: `GarmentItem`, `PaletteInsights`, and `OutfitRecommendation`;
- alert delivery: `EventEnvelope`, `AlertDeliveryOutbox`, `AlertCooldownReservation`, and
  `PushToken`;
- operations: `JobFailure`, append-only `AuditLog`, `TelemetryEvent`, and `FeatureFlag`.

Repositories generally apply user IDs from authenticated context to owner-scoped queries. Prisma
uses a trusted backend connection; the API does not propagate the request JWT claims into the
database session. End-user RLS must therefore not be assumed to repair a missing repository owner
filter. Several backend-oriented tables also have no RLS.

The alert pipeline persists an event, cooldown reservation, and outbox state before handing work
to BullMQ. This preserves recoverability when Redis is unavailable. Audit rows are database-
immutable. Ritual responses are cached in Redis for 15 minutes and degrade to database computation
on cache errors.

See [database models](data-models-database.md#model-catalog) for the complete model and policy
matrix.

## Workers, queues, schedulers, and realtime

### BullMQ

Four stable queues share Redis connection settings, three attempts, exponential backoff, and
retention defaults:

- `weather-ingestion`: implemented sweep and per-location ingestion; concurrency 5 and a
  60-per-minute worker limiter.
- `alert-fanout`: implemented realtime/push delivery; concurrency 20.
- `color-extraction`: consumer exists, but its processor is a no-op placeholder.
- `moderation-review`: consumer exists, but its processor is a no-op placeholder.

The worker registers repeatable weather sweeps at `WEATHER_REFRESH_MINUTES` and alert-outbox
dispatch every 30 seconds. Sweep targets combine saved locations with configured targets. Weather
uses OpenWeather first and WeatherAPI as fallback, persists normalized snapshots, then evaluates
alerts. The HTTP weather route reads persisted data and does not call providers synchronously.

### Nest in-process schedules

Because `ScheduleModule` is in `AppModule`, these schedules are registered in HTTP application
instances:

- failed-job pruning at 03:00 daily;
- guardian emancipation at 00:05 UTC daily;
- feature-flag synchronization every five minutes; and
- telemetry pruning every hour.

These timers are meaningful in a long-running process. A warm, request-driven Vercel function is
not a reliable cron runtime, and no external scheduler for them is recorded.

### Realtime and fallback

Socket.io exposes a regex namespace for `/lookbook` and `/ritual`, plus `/alert:weather`. A token
comes from `handshake.auth.token` or a Bearer header. The gateway resolves only user ID, stores it
in socket data, and joins weather clients to `alert:user:{userId}`.

The alert worker publishes validated events through Redis. The API relay validates them again and
emits `alert:weather` to the private room. When Redis has no realtime subscriber, fan-out evaluates
quiet hours and notification preferences, then may send Expo push notifications.

There are no inbound Socket.io message handlers. Lookbook and ritual gateways authenticate
connections but emit no domain events. Socket auth does not reproduce HTTP teen-consent or role
checks. Persisted events also support authenticated HTTP polling with a 30-second client default.

## External integrations

- **Supabase Auth**: validates Bearer tokens through the hosted user endpoint.
- **Supabase PostgreSQL**: stores all application, operational, outbox, and audit data.
- **Redis or Upstash**: backs BullMQ, ritual caching, and weather-alert pub/sub.
- **OpenWeather and WeatherAPI**: worker-only forecast providers with normalization and fallback.
- **Expo Push API**: sends worker-side push batches and handles invalid tokens.
- **PostHog**: receives analytics and supplies remote feature-flag values.
- **Grafana/LGTM OTLP**: receives long-running API traces and periodic metrics when configured.
- **Vercel**: hosts the documented serverless API target.

Provider-side projects, domains, retention, alerts, credentials, and resource separation are not
recoverable from this repository. No values or secrets are recorded here.

## Source tree

```text
apps/api/
├── api/index.ts                 Vercel serverless entry
├── src/
│   ├── main.ts                 long-running HTTP and Socket.io entry
│   ├── app.module.ts           HTTP composition root
│   ├── app.controller.ts       public root greeting
│   ├── controllers/            deployment and queue health
│   ├── modules/                feature-first domain modules
│   │   ├── auth/               identity, guards, signup, consent state
│   │   ├── guardian/           invitations, consent, emancipation
│   │   ├── user/               profile read model
│   │   ├── location-preferences/
│   │   ├── weather/            persisted reads, ingestion, providers, scheduler
│   │   ├── personalization/    ritual recommendations and cache
│   │   ├── alerts/             rules, outbox, fan-out, Redis publication
│   │   ├── events/             persisted polling
│   │   ├── notifications/      push tokens and Expo delivery
│   │   ├── gateway/            Socket.io and Redis relay
│   │   ├── moderation/
│   │   ├── telemetry/
│   │   └── feature-flags/
│   ├── workers/                standalone BullMQ entry and lifecycle
│   ├── admin/                  failed-job operations and pruning
│   ├── analytics/, posthog/    analytics abstractions and provider
│   ├── prisma/                 global Prisma provider
│   ├── config/                 Redis and queue configuration
│   ├── filters/                exception telemetry
│   ├── logger/                 Pino and request context
│   └── contracts/http.ts       shared-contract compatibility re-export
├── integration/                assembled API and boundary suites
├── test/                       shared app test factories
├── package.json                scripts and dependency boundary
├── vitest.config.ts
└── vercel.json                 serverless routing and limits
```

Generated `dist`, `.turbo`, and `.vercel` trees are not source. Public contracts live under
[`packages/api-client`](../../packages/api-client/src/contracts/http/), and database ownership
lives under [`packages/db`](../../packages/db/).

## Development workflow

Use Node.js 24 and run repository or workspace scripts from the repository root.

```bash
npm ci
npm run supabase:start
docker compose up -d redis
npm run start:api
npm run start:workers --workspace api
```

`start:api` generates Prisma Client, applies committed migrations, builds shared dependencies, and
watches the API. The API defaults to port 4000 through the repository launcher, although direct
`main.ts` startup defaults to 3000. Workers are separate and must be started explicitly.

For database and contract changes:

```bash
npm run db:generate
npm run db:migrate
npm run generate:http-openapi
npm run generate:api-client
```

Edit shared Zod contracts first and generated OpenAPI/SDK output last through scripts. Edit the
Prisma schema and committed migrations in `packages/db`; never edit generated Prisma Client.
Environment-file precedence and target-sensitive commands are detailed in the
[development guide](development-guide.md).

## Deployment runtimes

### Vercel serverless API

[`vercel.json`](../../apps/api/vercel.json) rewrites all paths to `api/index.ts`, with a 25-second
maximum duration and 1024 MB memory. `vercel:build` generates Prisma Client, runs
`prisma migrate deploy`, and builds Nest. The handler caches one initialized app per warm
instance.

This is the only API production target encoded in the repository. The deployment itself is
expected from Vercel Git integration; GitHub workflows wait for and test deployments but do not
create them.

### Long-running Node API

`npm run start:prod --workspace api` runs compiled `src/main.ts`. It supports stable Socket.io
connections, Redis subscriptions, in-process schedules, complete request logging/error telemetry,
OpenAPI publication, and OTLP initialization. No production host, container, process manifest, or
deployment workflow for this runtime is recorded.

### Standalone workers

`npm run start:workers:prod --workspace api` runs the compiled worker entry. No Docker image,
hosted process, liveness probe, or deployment workflow starts it in Preview or production.

Database migrations run during API builds and startup paths. There is no separate migration
approval, backup, post-migration readiness check, or automated rollback. See the
[deployment guide](deployment-guide.md) for the complete evidence boundary.

## Testing strategy

The API Vitest configuration uses the Node environment and includes colocated `*.spec.ts` and
`integration/**/*.spec.ts`. Current layers are:

- controller, service, repository, provider, guard, gateway, scheduler, worker, logger, telemetry,
  and instrumentation unit tests;
- API integration suites for assembled application behavior, HTTP contract parity, locations,
  weather, alerts, cooldowns, guardian emancipation, analytics, observability, and deployment
  configuration;
- database-package static migration checks and live PostgreSQL/RLS tests;
- Pact consumer/provider verification against generated contracts;
- Playwright browser and API flows across local, Preview, and production environments;
- k6 smoke and selectable load profiles; and
- Optic/OpenAPI lint and diff validation.

Focused API verification is:

```bash
npm run verify:api
npm run test --workspace api
npm run test:integration --workspace api
```

Contract, E2E, load, and live database gates are not included in every focused run. The full
command matrix is in the [development guide](development-guide.md#focused-validation).

## Security posture

Implemented controls include:

- Supabase token introspection with a timeout and strict Zod response parsing;
- roles trusted only from signed app metadata;
- guardian-consent checks on teen HTTP requests;
- route-level role guards and selected authenticated-ID/body-ID binding;
- runtime Zod parsing at most canonical public request and response boundaries;
- owner-aware repository queries;
- PostgreSQL checks, selective RLS, worker-only tables, and immutable audit records;
- environment-gated test authentication bypasses;
- no generated SDK runtime trust: server-side Zod remains the boundary;
- structured telemetry designed to avoid raw tokens and service credentials; and
- durable, deduplicated alert outbox/cooldown behavior.

These controls are not uniform. The Prisma backend lane does not inherit end-user RLS identity.
Socket.io has weaker authorization than HTTP. Public admin and invitation routes remain exposed.
OpenAPI security declarations do not fully match guards. See
[API authentication conventions](api-contracts-api.md#authentication-conventions) and
[database security](data-models-database.md#row-level-security-and-database-security).

## Concrete current risks

1. **Public operator endpoints.** Failed-job listing and replay are unauthenticated. They expose
   raw rows, mutate state through GET, and can requeue and delete stored failures.
2. **Public invitation creation.** Any caller can submit a teen ID and guardian email and receive
   the signed invitation URL without proving a relationship to that teen.
3. **Workers have no deployment target.** Production weather refresh, durable outbox handoff,
   fan-out, Redis publication, and Expo push have no recorded running consumer.
4. **Serverless/runtime mismatch.** The deployed entry omits long-running observability,
   middleware, exception telemetry, OpenAPI, and startup behavior. Long-lived sockets,
   subscriptions, and cron timers are unreliable in this topology.
5. **Background placeholders appear operational.** Color extraction and moderation queues have
   workers, retries, and limits, but their processors perform no work.
6. **Socket authorization is weaker than HTTP.** It resolves identity but omits teen-consent and
   role checks. Lookbook and ritual namespaces currently provide lifecycle only.
7. **Prisma and RLS are separate enforcement lanes.** Trusted backend queries depend on every
   repository applying the correct owner filter; request JWT claims are not set on Prisma sessions.
8. **Contract drift and envelope fragmentation.** Several routes are absent from OpenAPI, guarded
   routes omit security metadata, and successful responses do not share one envelope.
9. **Polling hides failures.** Invalid cursors and storage errors can look like successful empty
   results. Timestamp-only cursors are ambiguous for records with equal creation times.
10. **Health is shallow.** Health routes do not prove PostgreSQL, Supabase Auth, Redis, workers,
    weather providers, Expo, PostHog, or OTLP readiness; queue metrics are empty.
11. **Migrations run inside API builds.** A deployment can change the database before application
    verification, with no encoded approval, backup, post-migration probe, or rollback.
12. **In-process schedules lack a reliable production clock.** Admin cleanup, emancipation,
    feature-flag sync, and telemetry pruning are registered in request-driven serverless instances.
13. **Feature flags do not gate behavior.** Remote/database/default synchronization exists, but no
    production API call site consumes a flag for behavior selection.
14. **Push registration is incomplete.** Push persistence and delivery exist, but no public token
    registration endpoint or complete client registration lifecycle is implemented.
15. **Generated SDK checks are disabled.** Generated TypeScript types do not validate runtime
    payloads; consumers that skip shared Zod parsing can accept drifted data.
16. **Database edge cases remain.** Audit seed reruns conflict with immutable triggers, several
    backend tables lack RLS, JSON-held references lack foreign keys, and nullable recommendation
    uniqueness permits duplicates.

These are current implementation risks, not roadmap commitments. Remediation order and future
design belong in planning artifacts; this document should continue to describe only shipped code
and repository-backed runtime configuration.
