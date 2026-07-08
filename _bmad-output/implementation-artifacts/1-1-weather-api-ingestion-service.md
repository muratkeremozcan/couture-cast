---
baseline_commit: e183add80c96d9f486786132f06006361f9c89ee
---

# Story 1.1: Weather API ingestion service

Updated: 2026-07-07 — completed tasks and resolved code review findings

Status: in-progress

## Story

As a daily planner,
I want CoutureCast to pull accurate current and hourly forecasts for my location,
so that outfit guidance reflects real conditions.

## Acceptance Criteria

1. Ingest OpenWeather, or the configured provider, current conditions plus exactly 48 hourly
   forecast entries for every canonical ingestion target at a configurable cadence no greater than
   30 minutes. Scheduling and fan-out must be idempotent across process restarts and replicas.
2. Persist each normalized provider payload transactionally with its source and fetch timestamps.
   The latest-weather query must expose `fresh`, `cached`, `stale`, and `unavailable` outcomes and a
   user-safe fallback message whenever the newest snapshot is older than 60 minutes.
3. Emit provider latency, request outcomes, rate-limit responses, ingestion outcomes, and snapshot
   age through the existing Pino and OpenTelemetry pipeline. Grafana must be able to derive the
   five-minute provider error rate and alert when it exceeds 2%.

## Required implementation contract

### Provider contract and normalization

- `IWeatherProvider` exposes one operation:
  `fetchForecast(target, signal): Promise<NormalizedWeatherForecast>`. Do not make separate current
  and hourly calls; both supported providers return them in one forecast response.
- `NormalizedWeatherForecast` contains the provider, canonical `locationKey`, rounded latitude and
  longitude, timezone, provider update time, fetch time, current conditions, alerts, and exactly 48
  hourly entries.
- Store and process canonical values in metric units and UTC. Preserve the provider timezone for
  later display conversion. Provider adapters own all vendor-specific condition and unit mapping.
- Validate provider responses with Zod before normalization. Invalid or incomplete payloads are
  provider failures and must never be partially persisted.
- Never include API keys, raw provider payloads, exact coordinates, or user identifiers in logs,
  metric attributes, PostHog events, or thrown error messages.

### Freshness contract

The query response is a discriminated union defined in the shared API-client contract:

- `fresh`: the latest live-provider snapshot is at most 60 minutes old; no fallback message.
- `cached`: the live request failed but a snapshot at most 60 minutes old is returned; message
  indicates that recently cached weather is being used.
- `stale`: the newest snapshot is more than 60 minutes old; return the data with the message
  `Weather data is delayed. Check again shortly.`
- `unavailable`: no snapshot exists; return no weather data and the message
  `Weather data is temporarily unavailable.`

Exactly 60 minutes old is not stale; `age > 60 minutes` is stale. Compute age from `fetched_at`
using an injected clock in tests.

### Retry and failover contract

- OpenWeather One Call 4.0 (or 3.0 in backward compatibility mode) is primary; WeatherAPI.com is secondary.
- A primary `429` switches to the secondary provider immediately without retrying the primary.
- For timeouts and retryable `5xx` responses, make at most three primary attempts: immediately,
  after 5 seconds, and after another 15 seconds. After the third failure, try the secondary
  provider immediately. Do not add a fourth primary attempt.
- Use one bounded secondary attempt. If it fails, return the latest persisted snapshot using the
  freshness contract above.
- Per-location BullMQ jobs use `attempts: 1`; provider retry/failover is owned by the ingestion
  orchestrator. This prevents multiplication with the queue-wide three-attempt default.
- Use an injected sleeper and timeout/abort signal so retry timing is deterministic in tests.
- Reconcile ADR-012 to this three-attempt interpretation; its obsolete third `45s` delay must not
  create a fourth provider call or push failover beyond the defined sequence.

### Scheduling and target contract

- BullMQ 5 Job Schedulers own the periodic cadence. Do not add a Nest cron inside the Vercel HTTP
  process; serverless instances cannot guarantee one durable scheduler execution.
- On worker startup, idempotently call `upsertJobScheduler` with stable scheduler ID
  `weather-refresh-sweep` and the configured interval, defaulting to 30 minutes.
- A sweep job obtains targets from `WeatherTargetSource` and enqueues one location job per canonical
  target. Location job IDs include `locationKey` and the UTC interval bucket so replicas cannot
  duplicate work.
- Story 1.1 supplies `ConfiguredWeatherTargetSource` for non-personal bootstrap locations via
  `WEATHER_INGESTION_TARGETS_JSON`. Story 1.2 replaces that adapter with saved active locations;
  provider, scheduling, and ingestion code must not change.
- The standalone worker must execute the real weather processor using explicit dependencies or a
  dedicated Nest application context. It must not retain the current no-op callback.
- A deployed runtime must execute `npm run start:workers:prod`. The Vercel HTTP deployment alone
  does not satisfy AC1.

## Tasks / Subtasks

- [ ] Task 1: Implement provider contracts, adapters, and configuration (AC: #1, #2)
  - [x] Add `weather-provider.interface.ts`, `weather.types.ts`, and `weather.schemas.ts` under
        `apps/api/src/modules/weather/providers/` with the single-call normalized contract.
  - [x] Implement `OpenWeatherProvider` against One Call API 4.0 (or 3.0 backward compatibility mode) using one request with
        `units=metric`; normalize current conditions, alerts, and exactly 48 hourly entries.
  - [x] Implement `WeatherApiProvider` using its forecast endpoint and map the response into the
        same normalized shape.
  - [x] Add checked-in provider fixtures for success, missing fields, `429`, `5xx`, timeout, and
        malformed payload cases. Reuse `@couture/testing` weather factories where their shapes fit.
  - [x] Extend `.env.example` with placeholder-only `OPENWEATHER_API_KEY`, `WEATHERAPI_API_KEY`,
        `WEATHER_REFRESH_MINUTES`, `WEATHER_PROVIDER_MODE`, and
        `WEATHER_INGESTION_TARGETS_JSON` entries.
  - [x] Follow the existing `load-env.ts` and typed parsing pattern. Do not introduce
        `@nestjs/config` unless the dependency and migration of existing configuration are an
        explicit, justified part of this story.
  - [x] **OpenWeather Setup & Billing Caps**: - OpenWeather One Call API 4.0/3.0 has a free tier of **1,000 requests per day**. - **To get OPENWEATHER_API_KEY**: 1. Create an account at the [OpenWeather Sign-Up Page](https://home.openweathermap.org/users/sign_up). 2. Access your API key under the "My API keys" tab in your profile (or go to [OpenWeather My API Keys](https://home.openweathermap.org/api_keys)). 3. Subscribe to the "One Call by Call" plan on the [One Call API Subscription Page](https://home.openweathermap.org/subscriptions/billing_info/onecall_30/base) (requires a credit card, but includes the 1,000 free daily calls). 4. Set the **Calls per day (no more than)** cap in your dashboard to **1,000** to ensure it remains 100% free and you are never charged.
        _Note: OpenWeather keys can take up to 2 hours to activate on their servers._
  - [x] **WeatherAPI Setup**: - **To get WEATHERAPI_API_KEY**: 1. Create an account at the [WeatherAPI Registration Page](https://www.weatherapi.com/signup.aspx) (no credit card required). 2. Copy your API key from the top of the [WeatherAPI Dashboard](https://www.weatherapi.com/my/).
        _Note: WeatherAPI keys are activated instantly._

### Review Findings — Task 1 checkpoint

- [x] [Review][Patch] Define a canonical condition enum while preserving raw provider condition
      text and code [apps/api/src/modules/weather/providers/weather.types.ts:7]
- [x] [Review][Patch] Prevent provider errors from exposing API keys or coordinates
      [apps/api/src/modules/weather/providers/openweather.provider.ts:33]
- [x] [Review][Patch] Preserve typed rate-limit, HTTP, timeout, cancellation, and validation failure
      semantics for the Task 3 orchestrator
      [apps/api/src/modules/weather/providers/weather-provider.interface.ts:3]
- [x] [Review][Patch] Validate targets and construct encoded provider URLs safely
      [apps/api/src/modules/weather/providers/openweather.provider.ts:27]
- [x] [Review][Patch] Reject stale, duplicate, non-contiguous, or incomplete 48-hour forecast
      horizons instead of backfilling historical hours
      [apps/api/src/modules/weather/providers/weatherapi.provider.ts:67]
- [x] [Review][Patch] Tighten raw and normalized schemas for bounded measurements, timestamps,
      non-empty identifiers, alert intervals, and response-location consistency
      [apps/api/src/modules/weather/providers/weather.schemas.ts:6]
- [x] [Review][Patch] Parse and validate all Task 1 weather environment settings through a typed
      configuration boundary [apps/api/src/modules/weather/providers/openweather.provider.ts:14]
- [x] [Review][Patch] Complete the required success/missing/429/5xx/timeout/malformed fixture and
      test matrix, and clear the scoped provider lint failures
      [apps/api/src/modules/weather/providers/openweather.provider.spec.ts:3]
- [x] [Review][Patch] Reject delayed forecast horizons and duplicate provider hours rather than
      silently repairing them [apps/api/src/modules/weather/providers/openweather.provider.ts:107]
- [x] [Review][Patch] Preserve timeout and cancellation semantics while consuming response bodies,
      including custom abort reasons [apps/api/src/modules/weather/providers/openweather.provider.ts:76]
- [x] [Review][Patch] Treat HTTP 408 as retryable and distinguish invalid deployment configuration
      from invalid ingestion targets [apps/api/src/modules/weather/providers/weather-provider.error.ts:63]
- [x] [Review][Patch] Bound stale/future provider update timestamps while allowing ordinary clock
      skew [apps/api/src/modules/weather/providers/weather.schemas.ts:175]
- [x] [Review][Patch] Validate IANA timezones and compare response locations correctly across the
      antimeridian with a tighter tolerance
      [apps/api/src/modules/weather/providers/openweather.provider.ts:94]
- [x] [Review][Patch] Complete freezing-rain, ice-pellet, and alert-severity normalization
      [apps/api/src/modules/weather/providers/weather-condition.mapper.ts:6]
- [x] [Review][Patch] Make time-sensitive provider fixtures deterministic across hour boundaries
      [apps/api/src/modules/weather/providers/openweather.provider.spec.ts:27]
- [x] [Review][Patch] Classify missing provider credentials as invalid configuration rather than an
      HTTP failure [apps/api/src/modules/weather/providers/openweather.provider.ts:47]
- [x] [Review][Patch] Anchor fetch time when the response arrives so JSON parsing across an hour
      boundary cannot discard a valid forecast hour
      [apps/api/src/modules/weather/providers/openweather.provider.ts:93]

### Review Findings — Round 2 (2026-07-06)

- [x] [Review][Decision] Strict provider staleness check rejects valid payloads — In
      `NormalizedWeatherForecastSchema`, `.superRefine` rejects any payload if `providerUpdatedAt` is
      more than 60 minutes older than `fetchedAt`. While the spec requires queries to report age > 60m
      as stale, rejecting the payload entirely at the adapter boundary prevents the stale snapshot
      from being persisted in the database (causing an unavailable state instead of stale).
      Options: [1] Remove the staleness check from the Zod validation schema (recommended), [2] Keep
      it and handle stale responses differently.
- [x] [Review][Patch] Alert validation triggers complete ingestion failure
      [apps/api/src/modules/weather/providers/weather.schemas.ts:161]
- [x] [Review][Patch] Swallowing of Zod validation error details
      [apps/api/src/modules/weather/providers/openweather.provider.ts:180]
- [x] [Review][Patch] Tight coupling of configuration loading in provider constructors
      [apps/api/src/modules/weather/providers/openweather.provider.ts:37]
- [x] [Review][Patch] Loss of original error stack trace in classifyFetchFailure
      [apps/api/src/modules/weather/providers/weather-provider.error.ts:34]
- [x] [Review][Patch] Timeout classification is fragile when AbortSignal reason is a string
      [apps/api/src/modules/weather/providers/weather-provider.error.ts:40]
- [x] [Review][Patch] WEATHER_INGESTION_TARGETS_JSON parses crashes on empty string
      [apps/api/src/modules/weather/providers/weather.config.ts:29]
- [x] [Review][Patch] Ambiguous single quotes surrounding target JSON in .env.example
      [.env.example:66]
- [x] [Review][Defer] Absence of global network request blocking or interceptors in tests — deferred,
      pre-existing

### Review Findings — Round 3 (2026-07-07)

- [x] [Review][Patch] NestJS Dependency Injection Compatibility Risk in `WeatherIngestionService` [apps/api/src/modules/weather/weather-ingestion.service.ts:123]
- [x] [Review][Patch] Abort/Cancellation Handling during Provider Fetch/Sleep [apps/api/src/modules/weather/weather-ingestion.service.ts:90-103]
- [x] [Review][Patch] Memory Leak in defaultSleeper Listener Cleanup [apps/api/src/modules/weather/weather-ingestion.service.ts:59-76]
- [x] [Review][Patch] Concurrent persistForecast Unique Constraint Crash [apps/api/src/modules/weather/weather.repository.ts:19-40]
- [x] [Review][Patch] Sequential Awaits in Sweeper Loop [apps/api/src/modules/weather/weather-processor.ts:72-85]
- [x] [Review][Patch] Seed Snapshot Dates Hardcoded in the Past [packages/db/prisma/seeds/weather.ts]
- [x] [Review][Patch] Non-deterministic Latest Snapshot Order [apps/api/src/modules/weather/weather.repository.ts:45-54]
- [x] [Review][Patch] Unnormalized Location Key Query [apps/api/src/modules/weather/weather.repository.ts:42-54]
- [x] [Review][Patch] Missing `clock` Injection in `WeatherIngestionService` [apps/api/src/modules/weather/weather-ingestion.service.ts]
- [x] [Review][Defer] Inconsistent Database `location` Field Populated with `location_key` [apps/api/src/modules/weather/weather.repository.ts:60] — deferred, pre-existing

- [x] Task 2: Migrate the persistence model and shared fixtures (AC: #1, #2)
  - [x] Extend `WeatherSnapshot` with `location_key`, rounded `latitude`/`longitude`, `timezone`,
        `provider`, and `provider_updated_at`; index `(location_key, fetched_at)` and enforce an
        ingestion uniqueness key across location, provider, and provider update time.
  - [x] Extend `ForecastSegment` with `forecast_at`, `feels_like`, precipitation probability and
        amount, wind speed/gust, and provider weather code; add indexes required for latest-location
        and forecast-time reads plus uniqueness within a snapshot.
  - [x] Create a forward Prisma migration that safely backfills existing seed rows before adding
        non-null constraints. Regenerate Prisma Client.
  - [x] Update `packages/testing/src/factories/weather.factory.ts`, weather seeds, cleanup helpers,
        and their tests to match the migrated shape.
  - [x] Persist a normalized snapshot and its 48 hourly segments in one Prisma transaction. A retry
        of an already committed provider update must be idempotent.
  - [x] Do not prune snapshots on a hard-coded 24-hour schedule in this story. Retention requires a
        separately approved policy because forecast segments and outfit recommendations reference
        these records.

- [x] Task 3: Implement bounded provider orchestration and freshness fallback (AC: #1, #2, #3)
  - [x] Add `WeatherIngestionService` with injected providers, repository, clock, sleeper, logger,
        and meter; implement the retry/failover contract without BullMQ-level retries.
  - [x] Handle timeout, retryable `5xx`, `429`, malformed response, and non-retryable `4xx` outcomes
        explicitly; preserve causes internally without logging credentials or location data.
  - [x] Add `WeatherQueryService` that returns the freshness union using the exact 60-minute
        boundary and most recent snapshot for a canonical location.
  - [x] Ensure cached and stale reads never trigger provider calls and never mutate the stored
        snapshot timestamp.

- [x] Task 4: Implement durable scheduling, target fan-out, and the real worker processor (AC: #1)
  - [x] Add `WeatherTargetSource` plus a validated `ConfiguredWeatherTargetSource` adapter for
        non-personal Story 1.1 bootstrap targets.
  - [x] Add a sweep processor that coalesces targets by canonical location key and enqueues stable,
        interval-bucketed location jobs.
  - [x] Replace the `weather-ingestion` no-op in `apps/api/src/workers/bootstrap.ts` with the real
        processor and preserve shared queue construction, graceful shutdown, DLQ capture, and
        Redis configuration.
  - [x] Register `weather-refresh-sweep` through BullMQ `upsertJobScheduler`; verify repeated worker
        starts produce one scheduler configuration.
  - [x] Set weather worker concurrency to at most five, consistent with the platform foundation,
        and retain a provider-aware rate limiter.
  - [x] Document and configure the non-serverless worker runtime that runs
        `npm run start:workers:prod`; include a startup health/observability check.

- [ ] Task 5: Expose the canonical latest-weather read contract (AC: #2)
  - [ ] Add `packages/api-client/src/contracts/http/weather.ts` with canonical Zod schemas for the
        normalized current/hourly data and freshness discriminated union.
  - [ ] Register the authenticated `/api/v1/weather/:locationKey` GET operation in the canonical
        OpenAPI registry before implementing controller code; regenerate checked-in OpenAPI and SDK
        artifacts.
  - [ ] Add `WeatherController` as a thin authenticated adapter over `WeatherQueryService`; follow
        existing `{ data }` success-envelope and API error conventions.
  - [ ] Register `WeatherModule` in `AppModule`; import existing `PrismaModule`, auth guard support,
        and observability dependencies instead of constructing duplicate global clients.

- [ ] Task 6: Add privacy-safe operational telemetry (AC: #3)
  - [ ] Use `createBaseLogger().child({ feature: 'weather' })` and stable event names for provider
        attempts, failover, ingestion completion/failure, and fallback outcomes.
  - [ ] Add OpenTelemetry counters/histograms for provider request duration, requests by outcome,
        rate limits, ingestion jobs by outcome, and snapshot age. Metric attributes are limited to
        bounded values such as provider, outcome, and HTTP status class.
  - [ ] Add/update the Grafana weather-ingestion dashboard and an alert derived from provider
        request counters when the five-minute error rate exceeds 2%.
  - [ ] Do not send operational ingestion events to PostHog. Story 1.4 owns product analytics;
        weather provider telemetry belongs in OpenTelemetry/Grafana.

- [ ] Task 7: Prove provider, persistence, scheduling, fallback, and telemetry behavior (AC: #1-#3)
  - [ ] Add provider contract tests for both official fixture shapes, unit normalization, metric
        units, UTC timestamps, exactly 48 hourly entries, and malformed-response rejection.
  - [ ] Add orchestration tests for success, three-attempt primary failover, immediate `429`
        failover, secondary failure, timeout, and no multiplied queue retries.
  - [ ] Add freshness tests for 59:59, exactly 60:00, greater than 60:00, cached fallback, and no
        snapshot; assert the exact user-safe messages.
  - [ ] Add scheduler tests proving `upsertJobScheduler` and interval-bucketed job IDs remain
        idempotent across repeated starts and duplicate targets.
  - [ ] Add API integration tests under `apps/api/integration/` for transactional persistence,
        duplicate provider updates, latest-location reads, auth, and canonical response validation.
  - [ ] Add telemetry tests that assert bounded attributes and confirm that coordinates, user IDs,
        provider keys, and raw payloads are absent.
  - [ ] Block live network access in unit/integration tests. Real-provider smoke is opt-in,
        non-blocking, and restricted to approved non-production credentials.
  - [ ] Run targeted API/database tests plus repository `typecheck`, `lint`, OpenAPI generation/diff,
        and build gates; record commands and results in the Dev Agent Record.

- [ ] Task 8: Align architecture and operational documentation (AC: #1-#3)
  - [ ] Update ADR-012 to the implemented three-attempt failover, BullMQ 5 Job Scheduler, canonical
        location, normalized data, and privacy-safe telemetry decisions.
  - [ ] Update environment and deployment runbooks with provider credentials, worker runtime,
        scheduler ownership, quota monitoring, and rollback/disable procedures.
  - [ ] Document provider-call budgeting. At a 30-minute cadence, each canonical target consumes up
        to 48 primary forecast calls per day before retries; alert before the configured account
        quota is approached.
  - [ ] Update the @/Users/murat/opensource/couture-cast/\_bmad-output/project-knowledge/learning-path-step-by-step.md
  - [ ] Using the Bmad test architect agent, evaluate if we have to add e2e, contract or perforance tests.

## Dev Notes

### Existing implementation to extend

- `apps/api/src/config/queues.ts` already owns the `weather-ingestion` queue, Redis connection, and
  shared job defaults. Override attempts only for the per-location weather job.
- `apps/api/src/workers/bootstrap.ts` already owns worker lifecycle and currently registers a no-op
  weather processor; replace that callback without duplicating worker startup or shutdown logic.
- `apps/api/src/prisma/prisma.module.ts` and `apps/api/src/workers/prisma.ts` own Prisma lifecycle for
  HTTP and worker processes respectively.
- `apps/api/src/logger/pino.config.ts` and `apps/api/src/instrumentation.ts` own logging and OTLP
  setup. Extend them through public APIs rather than creating a second telemetry stack.
- `packages/testing/src/factories/weather.factory.ts`, database weather seeds, and cleanup helpers
  already model weather fixtures and must evolve with the schema.
- Shared public REST contracts originate in `packages/api-client/src/contracts/http/`; controllers,
  OpenAPI JSON, and generated clients are downstream artifacts.

### Scope boundaries

- Story 1.1 establishes provider ingestion and a configurable target-source seam. Saved-location
  persistence, labels, selection, and user preference UX remain Story 1.2.
- Story 1.3 owns user alert rules and push delivery. This story persists the weather fields required
  by those rules but does not send alerts.
- Story 1.4 owns product analytics. This story emits operational weather telemetry only.
- Do not add a 7-day forecast, outfit generation, widgets, or mobile UI in this story.

### Runtime and dependency baseline

Repository manifests and lockfiles are authoritative: Node.js 24+, Prisma 6.19, BullMQ 5.65,
NestJS 11.1, Vitest 4, Pino 9, and the installed OpenTelemetry 0.213 packages. Older versions in the
planning architecture are historical context, not implementation pins.

### Expected file map

- `apps/api/src/modules/weather/**`: providers, schemas, services, repository, controller, module,
  processors, target source, and colocated unit tests.
- `apps/api/src/workers/bootstrap.ts`: real processor and scheduler startup integration.
- `apps/api/src/config/queues.ts`: weather-specific job option/rate-limit adjustment only.
- `apps/api/integration/weather*.spec.ts`: database/API integration coverage.
- `packages/db/prisma/schema.prisma` plus a new migration: normalized weather persistence.
- `packages/testing/src/factories/weather.factory.ts` and weather seed/cleanup tests: shared fixtures.
- `packages/api-client/src/contracts/http/weather.ts` plus generated artifacts: public contract.
- `.env.example`, Grafana assets, architecture, and deployment/environment runbooks: operations.

### References

- [Product requirements](../planning-artifacts/prd.md#fr1--weather-intelligence-core-phase-1--mvp)
- [Architecture and ADR-012](../planning-artifacts/architecture.md#architecture-decision-records-adrs)
- [Epic 1 source](../planning-artifacts/epics.md#epic-1--weather-intelligence--platform-foundation-phase-1)
- [OpenWeather One Call API 3.0](https://openweathermap.org/api/one-call-3)
- [WeatherAPI documentation](https://www.weatherapi.com/docs/)
- [BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers)

## Dev Agent Record

### Agent Model Used

Gemini 3.5 Flash (High)

### Debug Log References

- Command `npm run test` completed successfully, 155/155 tests passing.
- Command `npm run db:generate` completed successfully after the normalized weather Prisma schema
  update.
- Command `npm run test --workspace @couture/testing` completed successfully, 7/7 tests passing.
- Command `npm run test --workspace api -- --run src/modules/weather` completed successfully, 70/70
  tests passing.
- Command `npm run typecheck --workspace @couture/testing` completed successfully.
- Command `npm run typecheck --workspace @couture/db` completed successfully.
- Command `npm run typecheck --workspace api` completed successfully.
- Command `npm run lint --workspace @couture/testing` completed successfully.
- Command `npm run lint --workspace @couture/db` completed successfully.
- Command `npm run lint --workspace api` completed successfully.
- Command `npm run test --workspace @couture/db` was attempted but could not run because the local
  migrated Postgres/Supabase target on `127.0.0.1:54322` was unavailable.
- Command
  `npm run test --workspace api -- --run src/modules/weather/weather-query.service.spec.ts src/modules/weather/weather-ingestion.service.spec.ts`
  completed successfully, 9/9 tests passing.
- Command `npm run test --workspace api -- --run src/modules/weather` completed successfully, 79/79
  tests passing.
- Command `npm run typecheck --workspace api` completed successfully after Task 3 service additions.
- Command `npm run lint --workspace api` completed successfully after Task 3 service additions.
- Command
  `npm run test --workspace api -- --run src/modules/weather/weather-target-source.spec.ts src/modules/weather/weather-scheduler.spec.ts src/modules/weather/weather-processor.spec.ts`
  completed successfully, 6/6 tests passing.
- Command `npm run test --workspace api -- --run src/modules/weather` completed successfully, 85/85
  tests passing after Task 4 worker/scheduler additions.
- Command `npm run typecheck --workspace api` completed successfully after Task 4 additions.
- Command `npm run lint --workspace api` completed successfully after Task 4 additions.
- Command `npm run test --workspace api` completed successfully, 227/227 tests passing.

### Completion Notes List

- Implemented standard typescript interface `IWeatherProvider` and target/normalization typescript types in `weather.types.ts`.
- Implemented Zod schemas `weather.schemas.ts` to validate OpenWeather API, WeatherAPI responses, and final normalized forecasts (including ensuring exactly 48 hourly entries).
- Implemented `OpenWeatherProvider` client (mapping 48-hour slice, coordinate rounding, alerts, converting units to metric).
- Implemented `WeatherApiProvider` client (mapping 3-day forecast with consecutive hourly selection, converting wind speed to m/s, alerts, coordinates rounding).
- Created mock response fixtures for both providers in `/fixtures`.
- Added 13 Vitest tests (7 for OpenWeather, 6 for WeatherAPI) under `.spec.ts` files, verifying correctness of mapping, validation, error handling, rate limiting, and timeout/malformed handling.
- Extended `.env.example` with the new environment variable configurations.
- Migrated weather persistence to normalized provider snapshots, canonical location keys, provider
  update timestamps, indexed latest-location reads, and unique idempotency keys for
  location/provider/provider-update ingestion.
- Extended forecast segments with absolute forecast timestamps, feels-like temperature,
  precipitation, wind, gust, provider weather code, forecast-time indexes, and per-snapshot forecast
  uniqueness.
- Added shared weather fixtures that produce a normalized current snapshot plus exactly 48 hourly
  segments, updated weather seeds to populate the migrated shape, and retained cleanup behavior
  without adding snapshot pruning.
- Added `WeatherRepository.persistForecast()` to persist normalized snapshots and all 48 hourly
  entries in one Prisma transaction, returning an existing provider update without duplicating
  segments.
- Added `WeatherIngestionService` with injected primary/secondary providers, repository, query
  fallback service, sleeper, logger, and meter hooks. The orchestrator performs exactly three primary
  attempts for timeout/retryable HTTP failures with 5s and 15s waits, fails over immediately on
  primary `429`, uses one bounded secondary attempt, and returns stored weather fallback when both
  providers fail.
- Added `WeatherQueryService` freshness classification for `fresh`, `cached`, `stale`, and
  `unavailable`, including the exact 60-minute boundary and the required user-safe fallback
  messages. Cached/stale reads use repository state only and do not call providers or mutate
  timestamps.
- Added `ConfiguredWeatherTargetSource` backed by validated `WEATHER_INGESTION_TARGETS_JSON`, a
  BullMQ scheduler helper for the stable `weather-refresh-sweep` scheduler, and a weather processor
  that coalesces duplicate canonical targets into interval-bucketed location jobs with
  `attempts: 1`.
- Replaced the worker bootstrap no-op for `weather-ingestion` with explicit provider, repository,
  query, ingestion, target-source, scheduler, and processor dependencies while preserving shared
  queue creation, DLQ handling, shutdown, Redis configuration, and a weather worker concurrency cap
  of five.
- Documented the required non-serverless worker runtime using `npm run start:workers:prod` and the
  startup observability checks in the API README.

### File List

- `apps/api/src/modules/weather/providers/weather.types.ts`
- `apps/api/src/modules/weather/providers/weather.schemas.ts`
- `apps/api/src/modules/weather/providers/weather-provider.interface.ts`
- `apps/api/src/modules/weather/providers/openweather.provider.ts`
- `apps/api/src/modules/weather/providers/weatherapi.provider.ts`
- `apps/api/src/modules/weather/providers/fixtures/openweather.fixtures.ts`
- `apps/api/src/modules/weather/providers/fixtures/weatherapi.fixtures.ts`
- `apps/api/src/modules/weather/providers/openweather.provider.spec.ts`
- `apps/api/src/modules/weather/providers/weatherapi.provider.spec.ts`
- `.env.example`
- `apps/api/src/modules/weather/weather.repository.ts`
- `apps/api/src/modules/weather/weather.repository.spec.ts`
- `apps/api/src/modules/weather/weather-ingestion.service.ts`
- `apps/api/src/modules/weather/weather-ingestion.service.spec.ts`
- `apps/api/src/modules/weather/weather-query.service.ts`
- `apps/api/src/modules/weather/weather-query.service.spec.ts`
- `apps/api/src/modules/weather/weather-processor.ts`
- `apps/api/src/modules/weather/weather-processor.spec.ts`
- `apps/api/src/modules/weather/weather-scheduler.ts`
- `apps/api/src/modules/weather/weather-scheduler.spec.ts`
- `apps/api/src/modules/weather/weather-target-source.ts`
- `apps/api/src/modules/weather/weather-target-source.spec.ts`
- `apps/api/src/workers/bootstrap.ts`
- `apps/api/README.md`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260707104000_normalize_weather_persistence/migration.sql`
- `packages/db/prisma/seeds/weather.ts`
- `packages/testing/src/factories/weather.factory.ts`
- `packages/testing/test/weather.factory.spec.ts`

### Change Log

- 2026-07-07: Completed Task 2 normalized weather persistence migration, fixture/seed updates, and
  transactional idempotent persistence repository.
- 2026-07-07: Completed Task 3 bounded provider orchestration and latest-weather freshness fallback
  services.
- 2026-07-07: Completed Task 4 durable BullMQ weather scheduling, target fan-out, real worker
  processing, and worker runtime documentation.
