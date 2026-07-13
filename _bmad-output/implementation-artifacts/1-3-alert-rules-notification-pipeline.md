---
baseline_commit: b9bb9de7033dca7c37674ea02e1546b4e66f005c
---

# Story 1.3: Alert rules & notification pipeline

Status: review

## Story

As a daily planner,
I want timely alerts for major weather shifts,
so that I can adjust my wardrobe plan quickly.

## Acceptance Criteria

1. **Configurable Alert Rules:** Support alert rules for:
   - Temperature delta (e.g., sudden drop/rise of X degrees).
   - Precipitation start (rain/snow/sleet starting in upcoming hours).
   - Severe conditions (severe warnings from weather providers).
   - All rules must have user-configurable thresholds and active toggles.

2. **Real-time & Push Delivery:** Generate push notification payloads and in-app alert cards (persisted as `EventEnvelope` records) within 60 seconds of weather rule trigger.
   - Connected clients receive alerts immediately via Socket.io namespace `alert:weather`.
   - Disconnected/backgrounded clients receive push notifications via the Expo Push API.

3. **Quiet Hours & Timezone Respect:** Respect quiet hours preferences (e.g., do not send push notifications between 22:00 and 07:00 in the user's local timezone) and opt-out settings. In-app alert cards must still be created even during quiet hours.

4. **Inconsistent Database `location` Field Alignment:** Resolve the deferred cleanup from Story 1.1/1.2. The database `WeatherSnapshot.location` field must store the descriptive location name (e.g., "London, UK") instead of the slugified `location_key`.

## Tasks / Subtasks

- [x] **Task 1: Prisma Schema & Migrations for Alerts and Preferences (AC: #1, #3)**
  - [x] Add `AlertRule` model to `packages/db/prisma/schema.prisma`:
    - `id` (String, @id, @default(cuid()))
    - `user_id` (String, references `User.id` with onDelete: Cascade)
    - `rule_type` (String, values: `'temperature' | 'precipitation' | 'severe'`)
    - `threshold` (Float, optional, e.g., temperature delta limit)
    - `enabled` (Boolean, default: true)
    - `created_at` (DateTime, default: now)
    - `updated_at` (DateTime, updatedAt)
    - Add unique constraint `@@unique([user_id, rule_type])` and index `@@index([user_id])`.
  - [x] Add `NotificationPreference` model to `packages/db/prisma/schema.prisma`:
    - `id` (String, @id, @default(cuid()))
    - `user_id` (String, @unique, references `User.id` with onDelete: Cascade)
    - `quiet_hours_enabled` (Boolean, default: false)
    - `quiet_hours_start` (String, default: "22:00") // "HH:MM" 24h format
    - `quiet_hours_end` (String, default: "07:00") // "HH:MM" 24h format
    - `timezone` (String, default: "UTC") // e.g. "Europe/London" or "America/New_York"
    - `created_at` (DateTime, default: now)
    - `updated_at` (DateTime, updatedAt)
  - [x] Update `User` model to link `alert_rules` and `notification_preference`.
  - [x] Generate migrations and implement RLS policies in raw SQL:
    - Target: `packages/db/prisma/migrations/`
    - Policy: Users can only select/insert/update/delete their own `AlertRule` and `NotificationPreference` records.
  - [x] Regenerate the Prisma Client.

- [x] **Task 2: API Contract Definitions for Alerts (AC: #1, #3)**
  - [x] Add `packages/api-client/src/contracts/http/alerts.ts`.
  - [x] Define schemas for:
    - `GET /api/v1/alerts/preferences` (returns user's notification preferences and alert rules).
    - `PUT /api/v1/alerts/rules` (updates/upserts list of alert rules).
    - `PUT /api/v1/alerts/preferences` (updates quiet hours settings).
  - [x] Register new routes in `packages/api-client/src/contracts/http/openapi.ts`.
  - [x] Export the schemas and types from `packages/api-client/src/contracts/http/index.ts`.
  - [x] Regenerate client artifacts and OpenAPI specs (`http.openapi.json` / generated SDKs).

- [x] **Task 3: Implement Alerts API Module (AC: #1, #3)**
  - [x] Create NestJS module under `apps/api/src/modules/alerts/`.
  - [x] Implement controller, service, repository, and tests.
  - [x] Secure routes using `RequestAuthGuard` and `@AuthContext()` to ensure operations filter by authenticated `userId`.
  - [x] Validate quiet hours format (`HH:MM`) and check timezone validity.
  - [x] Add factories for `AlertRule` and `NotificationPreference` in `packages/testing/src/factories/`.

- [x] **Task 4: Inconsistent Database `location` Field Alignment (Deferred Work)**
  - [x] Extend `WeatherIngestionTarget` interface in `apps/api/src/modules/weather/providers/weather.types.ts` to include optional `locationName?: string`.
  - [x] Update `SavedLocationWeatherTargetSource.getTargets()` in `apps/api/src/modules/weather/weather-target-source.ts` to populate `locationName` using the saved location's display name metadata (e.g. `city`, or falling back to `label`).
  - [x] Update the OpenWeather/WeatherAPI provider fetch adapters to carry `locationName` through to the final normalized forecast payload.
  - [x] Update `WeatherRepository.toCreateInput()` to map `forecast.locationName` (falling back to `forecast.locationKey` if absent) to `WeatherSnapshot.location`.

- [x] **Task 5: Weather Alert Processing & Rule Trigger Engine (AC: #1, #2)**
  - [x] Trigger alert checks upon successful weather ingestion in `WeatherIngestionService`.
  - [x] Identify all users who have saved this location key as primary.
  - [x] Evaluate rules for each user:
    - **Temperature Delta**: Compare current temperature with the 24h hourly segments; trigger if the delta is greater than user's threshold.
    - **Precipitation Start**: Check upcoming hourly segments for precipitation transition (no-rain to rain/snow) with probability > user preparedness threshold.
    - **Severe**: Check if `alerts` are present in the provider payload.
  - [x] If triggered, persist as `EventEnvelope` with channel `alert:weather`.

- [x] **Task 6: Quiet Hours & Notification Dispatch Pipeline (AC: #2, #3)**
  - [x] Implement `alert-fanout` BullMQ worker processor.
  - [x] For each alert, check user's `NotificationPreference` and local time.
  - [x] If local time falls within quiet hours, suppress push notification dispatch (do not send to Expo Push API).
  - [x] If outside quiet hours, batch send notifications via the existing `PushNotificationService`.
  - [x] Broadcast real-time alerts via `Gateway` on the Socket.io `alert:weather` namespace.
  - [x] Log outcomes (sent, suppressed, failed) via audit logging / telemetry store.

- [x] **Task 7: Test Coverage and Validation (AC: #1-#4)**
  - [x] Add unit tests for the rule evaluation engine (delta temp, precip start, severe alert).
  - [x] Add integration tests for RLS enforcement and transactional alerts API.
  - [x] Add worker tests covering batching, Expo SDK response classification, and quiet hours evaluation.
  - [x] Verify clean OpenAPI specs and optic diff validation.

### Review Findings

- [x] [Review][Decision] AlertRule threshold column is mandatory in schema but optional in spec — Keep DB mandatory (Option 1)
- [x] [Review][Patch] Socket.io Namespace Configuration Mismatch — Change namespace to alert:weather [apps/api/src/modules/gateway/gateway.gateway.ts:22-23]
- [x] [Review][Patch] Redundant Push Notifications Sent to Connected Clients — Suppress push if realtime.published is true [apps/api/src/modules/alerts/alert-fanout.processor.ts:156-177]
- [x] [Review][Patch] Precipitation alert ignored if initial transition is low-probability [apps/api/src/modules/alerts/weather-alert-evaluator.ts:75-87]
- [x] [Review][Patch] Severe alerts with unmapped severity levels are ignored [apps/api/src/modules/alerts/weather-alert-evaluator.ts:103-114]
- [x] [Review][Patch] Realtime alerts published multiple times on job retry [apps/api/src/modules/alerts/alert-fanout.processor.ts:157]
- [x] [Review][Patch] Validation failure skips logging due to empty userId [apps/api/src/modules/alerts/alert-fanout.processor.ts:151-153]
- [x] [Review][Patch] Sequential query on bulk alert cooldown reservations [apps/api/src/modules/alerts/weather-alert-processing.repository.ts:105-135]
- [x] [Review][Patch] Missing BullMQ failed job retention policy [apps/api/src/modules/alerts/weather-alert-fanout.queue.ts:33-36]
- [x] [Review][Patch] V8 performance bottleneck in local time evaluation [apps/api/src/modules/alerts/quiet-hours.ts:40-45]
- [x] [Review][Patch] Fragile and strict time-epoch matching in Weather API provider [apps/api/src/modules/weather/providers/weatherapi.provider.ts:221-229]
- [x] [Review][Patch] Fragile hourly segment length validation [apps/api/src/modules/weather/providers/openweather.provider.ts:206-214]
- [x] [Review][Patch] Risk of duplicate push deliveries on non-aborted timeouts [apps/api/src/modules/notifications/push-notification.service.ts]
- [x] [Review][Patch] Inconsistent logging and console log usage [apps/api/src/modules/weather/weather-target-source.ts]
- [x] [Review][Patch] Silent data leak on user account deletion [packages/db/prisma/schema.prisma]
- [x] [Review][Patch] Test DB pollution and missing table cleanup [packages/testing/src/cleanup.ts]
- [x] [Review][Patch] Synchronous weather ingestion blocked by alert engine failures [apps/api/src/modules/weather/weather-ingestion.service.ts:214]
- [x] [Review][Defer] Looping database queries inside transaction [apps/api/src/modules/alerts/alerts.repository.ts:85-110] — deferred, pre-existing

## Dev Notes

### Existing Infrastructure and Reusability

- **Push Delivery:** The `PushNotificationService` in `apps/api/src/modules/notifications/push-notification.service.ts` is already configured to batch send push notification payloads via Expo Push SDK and classify invalid or rate-limited tokens. Reuse it!
- **Real-time Gateway:** `Gateway` in `apps/api/src/modules/gateway/gateway.gateway.ts` defines namespace matches for `alert`. Emitting events to the `/alert` namespace will push updates to active client sessions.
- **In-App Alert Cards:** The fallback polling system parses `EventEnvelope` records. Creating an `EventEnvelope` with channel `'alert:weather'` makes the alert visible as an in-app card on both mobile and web clients.

### Database Snapshot Alignment (Deferred Work)

- The deferred work ledger `_bmad-output/implementation-artifacts/deferred-work.md` highlights that `WeatherSnapshot.location` currently stores `location_key`. Story 1.3 must ensure this is updated to a descriptive name (e.g. city) during target ingestion, mapping from the `SavedLocation` fields.

## References

- [Prisma Schema](file:///Users/murat/opensource/couture-cast/packages/db/prisma/schema.prisma)
- [Deferred Work Ledger](file:///Users/murat/opensource/couture-cast/_bmad-output/implementation-artifacts/deferred-work.md)
- [Push Notification Service](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/notifications/push-notification.service.ts)
- [Socket Event Types](file:///Users/murat/opensource/couture-cast/packages/api-client/src/types/socket-events.ts)
- [Epic 1 Source](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/epics.md#L226)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-07-13: Story created based on Epic 1 specification, current database schemas, and the deferred work ledger.
- 2026-07-13: Task 1 followed red-green-refactor with an alert schema and migration contract test. Prisma shadow databases could not replay existing Supabase-specific RLS migrations, so SQL was generated by diffing the migrated local Supabase database against the schema, then applied through `prisma migrate deploy`.
- 2026-07-13: Added explicit `push_enabled` persistence because AC 3 requires notification opt-out behavior but the original field list did not provide a durable opt-out setting.
- 2026-07-13: Task 2 used strict Zod contracts for rule-specific thresholds, duplicate rule prevention, exact 24-hour quiet-hours values, valid IANA timezones, non-ambiguous enabled intervals, authenticated OpenAPI routes, and generated SDK request coverage.
- 2026-07-13: Task 3 followed controller, service, and repository red-green-refactor. All repository reads and writes carry the authenticated `userId`; rule upserts share one transaction; service-level schema parsing provides defense in depth; and missing preferences return immutable defaults without side effects.
- 2026-07-13: Task 4 first reproduced the user-visible persistence defect through the saved-location ingestion path: `WeatherSnapshot.location` received `new-york-ny` instead of `New York`. Focused red tests then covered saved target metadata, both provider adapters, repository mapping, and the integration boundary.
- 2026-07-13: Task 5 used pure evaluator tests for strict temperature and precipitation thresholds, the 24-hour boundary, dry-to-wet transitions, severe warnings, disabled rules, and malformed thresholds. Processing tests then drove owner filtering, shared-schema payload validation, deterministic IDs, replay idempotency, ingestion ordering, and failure propagation.
- 2026-07-13: Task 6 used red tests for durable fanout enqueueing, quiet-hours boundaries and daylight-saving transitions, Expo batching and response classification, authenticated room ownership, owner-safe polling, and bounded audit records. A transactional database outbox, exact rolling cooldown reservations, and retained deterministic BullMQ jobs make replay safe.
- 2026-07-13: Security hardening first reproduced authenticated-user spoofing through trusted-looking request headers. Alert HTTP, polling, and Socket.io access now resolve verified bearer identities through Supabase, ignore spoofable identity headers, and preserve trusted app metadata roles.
- 2026-07-13: Durability hardening reproduced lost enqueue work, partial queue drains, nullable thresholds, missing configured location names, fixed-hour cooldown gaps, unbounded transport waits, and unsafe shutdown order. Database-backed outbox dispatch, retry sweeps, strict threshold constraints, bounded Redis and Expo attempts, rolling cooldown reservations, and ordered shutdown now cover those paths.
- 2026-07-13: Task 7 covered evaluator boundaries, transactional HTTP APIs, live RLS, concurrent cooldown reservations, fanout batching, Expo classification, quiet hours, realtime relay recovery, and worker shutdown. Contract generation, Pact provider verification, OpenAPI lint, and Optic diff validation all pass.

### Completion Notes List

- 2026-07-13: Completed Task 1 with user-owned `AlertRule` and `NotificationPreference` models, database constraints, cascading relations, self-only RLS policies, explicit push opt-out persistence, generated Prisma Client, and applied local migrations. Verified with focused contract tests, the full repository test suite, lint, and type checking.
- 2026-07-13: Completed Task 2 with shared request and response schemas for all alert settings routes, canonical OpenAPI registration, regenerated `AlertsApi` SDK artifacts, bearer-auth request verification, and Optic validation. Full repository tests, lint, and type checking pass.
- 2026-07-13: Completed Task 3 with the guarded alerts NestJS module, transactionally isolated rule updates, notification preference upserts, strict time and timezone validation, fixture factories, and dependency-safe cleanup support. Focused API and factory tests plus full repository tests, lint, and type checking pass.
- 2026-07-13: Completed Task 4 by carrying an optional descriptive location name through validated ingestion targets and normalized forecasts, preferring city metadata over labels, and preserving the canonical key for lookup. Focused weather tests and the full repository test, lint, and type-check suites pass.
- 2026-07-13: Completed Task 5 with primary-location owner discovery, per-user rule evaluation, descriptive in-app alert envelopes, deterministic replay-safe persistence, and standalone worker wiring. Processing failures retry through the ingestion job instead of reporting false success. Focused tests and the full repository test, lint, and type-check suites pass.
- 2026-07-13: Completed Task 6 with a transactional database outbox, 7-day deterministic BullMQ job retention, exact rolling one-hour cooldown reservations, timezone-aware quiet-hours and opt-out suppression, targeted Expo retries, authenticated user-scoped Socket.io rooms, a reconnecting Redis relay, owner-safe alert polling, delivery-record RLS, and bounded audit outcomes. Transport and audit failures are isolated according to delivery semantics.
- 2026-07-13: Completed Task 7 with unit, HTTP integration, live RLS, real-database cooldown, fanout, Expo, shutdown, Pact, OpenAPI, and Optic coverage. `npm run validate` passes with API 383 passed and 5 skipped, mobile 27, web 24, API client 21, config 7, database 34, testing 9, and utils 8 tests, plus clean typecheck, lint, API build, and web build. The opt-in real-database cooldown suite passes 3 of 3, Pact passes all consumer and provider runs, and Optic passes 15 of 15 checks.

### File List

- `_bmad-output/implementation-artifacts/1-3-alert-rules-notification-pipeline.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260713133703_add_alert_rules_notification_preferences/migration.sql`
- `packages/db/prisma/migrations/20260713133930_add_alert_push_opt_out/migration.sql`
- `packages/db/test/alert-schema.spec.ts`
- `packages/api-client/docs/http.openapi.json`
- `packages/api-client/src/contracts/http/alerts.ts`
- `packages/api-client/src/contracts/http/index.ts`
- `packages/api-client/src/contracts/http/openapi.ts`
- `packages/api-client/src/generated/apis/AlertsApi.ts`
- `packages/api-client/src/generated/apis/index.ts`
- `packages/api-client/src/generated/default-api.ts`
- `packages/api-client/src/generated/models/index.ts`
- `packages/api-client/testing/alerts-contract.spec.ts`
- `packages/api-client/testing/generated-client.spec.ts`
- `packages/api-client/testing/http-openapi.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/contracts/http.ts`
- `apps/api/src/modules/alerts/alerts.controller.ts`
- `apps/api/src/modules/alerts/alerts.controller.spec.ts`
- `apps/api/src/modules/alerts/alerts.module.ts`
- `apps/api/src/modules/alerts/alerts.repository.ts`
- `apps/api/src/modules/alerts/alerts.repository.spec.ts`
- `apps/api/src/modules/alerts/alerts.service.ts`
- `apps/api/src/modules/alerts/alerts.service.spec.ts`
- `apps/api/src/modules/alerts/weather-alert-evaluator.spec.ts`
- `apps/api/src/modules/alerts/weather-alert-evaluator.ts`
- `apps/api/src/modules/alerts/weather-alert-processing.repository.spec.ts`
- `apps/api/src/modules/alerts/weather-alert-processing.repository.ts`
- `apps/api/src/modules/alerts/weather-alert-processing.service.spec.ts`
- `apps/api/src/modules/alerts/weather-alert-processing.service.ts`
- `apps/api/src/modules/alerts/alert-fanout.processor.spec.ts`
- `apps/api/src/modules/alerts/alert-fanout.processor.ts`
- `apps/api/src/modules/alerts/alert-fanout.repository.spec.ts`
- `apps/api/src/modules/alerts/alert-fanout.repository.ts`
- `apps/api/src/modules/alerts/alert-fanout.types.ts`
- `apps/api/src/modules/alerts/quiet-hours.spec.ts`
- `apps/api/src/modules/alerts/quiet-hours.ts`
- `apps/api/src/modules/alerts/redis-alert-realtime.publisher.spec.ts`
- `apps/api/src/modules/alerts/redis-alert-realtime.publisher.ts`
- `apps/api/src/modules/alerts/weather-alert-fanout.queue.spec.ts`
- `apps/api/src/modules/alerts/weather-alert-fanout.queue.ts`
- `apps/api/src/modules/auth/access-token-identity.service.spec.ts`
- `apps/api/src/modules/auth/access-token-identity.service.ts`
- `apps/api/src/modules/events/events.controller.spec.ts`
- `apps/api/src/modules/events/events.controller.ts`
- `apps/api/src/modules/events/events.module.ts`
- `apps/api/src/modules/events/events.repository.spec.ts`
- `apps/api/src/modules/events/events.repository.ts`
- `apps/api/src/modules/events/events.service.spec.ts`
- `apps/api/src/modules/events/events.service.ts`
- `apps/api/src/modules/gateway/alert-weather-relay.service.spec.ts`
- `apps/api/src/modules/gateway/alert-weather-relay.service.ts`
- `apps/api/src/modules/gateway/connection-manager.service.ts`
- `apps/api/src/modules/gateway/gateway.constants.ts`
- `apps/api/src/modules/gateway/gateway.gateway.spec.ts`
- `apps/api/src/modules/gateway/gateway.gateway.ts`
- `apps/api/src/modules/gateway/gateway.module.ts`
- `apps/api/src/modules/gateway/gateway.test.ts`
- `apps/api/integration/weather.integration.spec.ts`
- `apps/api/src/modules/weather/providers/openweather.provider.spec.ts`
- `apps/api/src/modules/weather/providers/openweather.provider.ts`
- `apps/api/src/modules/weather/providers/weather.schemas.ts`
- `apps/api/src/modules/weather/providers/weather.types.ts`
- `apps/api/src/modules/weather/providers/weatherapi.provider.spec.ts`
- `apps/api/src/modules/weather/providers/weatherapi.provider.ts`
- `apps/api/src/modules/weather/weather-target-source.spec.ts`
- `apps/api/src/modules/weather/weather-target-source.ts`
- `apps/api/src/modules/weather/weather-ingestion.service.spec.ts`
- `apps/api/src/modules/weather/weather-ingestion.service.ts`
- `apps/api/src/modules/weather/weather.repository.spec.ts`
- `apps/api/src/modules/weather/weather.repository.ts`
- `apps/api/src/workers/bootstrap.ts`
- `packages/api-client/src/contracts/http/events.ts`
- `packages/api-client/src/generated/apis/EventsApi.ts`
- `packages/db/prisma/migrations/20260713142500_secure_alert_delivery_records/migration.sql`
- `packages/db/test/alert-delivery-security.spec.ts`
- `packages/testing/src/cleanup.ts`
- `packages/testing/src/factories/alert-rule.factory.ts`
- `packages/testing/src/factories/notification-preference.factory.ts`
- `packages/testing/src/factories/index.ts`
- `packages/testing/src/factories/registry.ts`
- `packages/testing/templates/test-template.spec.ts`
- `packages/testing/test/alert.factory.spec.ts`
- `packages/testing/test/cleanup.spec.ts`
- `.env.example`
- `apps/api/README.md`
- `apps/api/integration/alert-pipeline-latency.integration.spec.ts`
- `apps/api/integration/alerts.integration.spec.ts`
- `apps/api/integration/analytics-tracking.integration.spec.ts`
- `apps/api/integration/guardian-emancipation.integration.spec.ts`
- `apps/api/integration/http-contract-parity.integration.spec.ts`
- `apps/api/integration/location-preferences.integration.spec.ts`
- `apps/api/integration/observability.integration.spec.ts`
- `apps/api/integration/weather-alert-cooldown.integration.spec.ts`
- `apps/api/package.json`
- `apps/api/src/config/queues.ts`
- `apps/api/src/modules/auth/auth-state.module.ts`
- `apps/api/src/modules/auth/security.guards.spec.ts`
- `apps/api/src/modules/auth/security.guards.ts`
- `apps/api/src/modules/location-preferences/location-preferences.controller.spec.ts`
- `apps/api/src/modules/notifications/notifications.test.ts`
- `apps/api/src/modules/notifications/push-notification.service.ts`
- `apps/api/src/modules/notifications/push-token.repository.spec.ts`
- `apps/api/src/modules/notifications/push-token.repository.ts`
- `apps/api/src/modules/weather/providers/weather.config.spec.ts`
- `apps/api/src/modules/weather/providers/weather.config.ts`
- `apps/api/src/modules/weather/weather-processor.spec.ts`
- `apps/api/src/modules/weather/weather-processor.ts`
- `apps/api/src/modules/weather/weather-scheduler.spec.ts`
- `apps/api/src/modules/weather/weather-scheduler.ts`
- `apps/api/src/workers/shutdown-resources.spec.ts`
- `apps/api/src/workers/shutdown-resources.ts`
- `packages/db/prisma/migrations/20260713151000_add_alert_delivery_outbox/migration.sql`
- `packages/db/prisma/migrations/20260713160000_enforce_alert_rule_thresholds/migration.sql`
- `packages/db/prisma/migrations/20260713170000_add_rolling_alert_cooldowns/migration.sql`
- `packages/db/test/alert-outbox-schema.spec.ts`
- `packages/db/test/rls-policies.spec.ts`
- `pact/http/consumer/api-contract-interactions.ts`
- `pact/http/consumer/mobile-api-client.pacttest.ts`
- `pact/http/consumer/web-api-client.pacttest.ts`
- `pact/http/provider/provider-helper.ts`

### Change Log

- 2026-07-13: Implemented Story 1.3 alert rules and notification pipeline and moved it to review.
