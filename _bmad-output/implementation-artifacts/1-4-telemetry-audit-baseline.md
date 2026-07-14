---
baseline_commit: c0ca9002d2e30d8131b8dea1154bf19fde7ec1bf
---

# Story 1.4: Telemetry & audit baseline

Status: done

## Story

As the product team,
I want activation, forecast view, and alert delivery metrics captured in both
telemetry and a local database,
so that we can track success criteria and maintain an audit log.

## Acceptance Criteria

1. **Activation Funnel Instrumentation:** Capture activation funnel events:
   - `profile_completed` (triggered when user signup is successfully completed).
   - `first_outfit_generated` (triggered on first outfit suggestion for a
     user).

2. **Core Operational Metrics:** Capture the following telemetry events:
   - `forecast_viewed` (triggered when weather forecast is fetched for a
     location key).
   - `alert_sent` (triggered when an alert is successfully dispatched to
     Socket.io or push notifications).
   - `location_switched` (triggered when a user updates their primary location
     preference).
   - `api_error_occurred` (triggered when any HTTP error or internal server
     exception is thrown by the API).

3. **Prism / PostHog Telemetry Store Integration:** Propagate all telemetry
   events to PostHog using the existing `ANALYTICS_CLIENT` provider with
   validated type-safe schemas.

4. **Local Database Analytics Store & 24h Retention:** Persist all telemetry
   events in a new `TelemetryEvent` model in the database, with a scheduled
   background pruner task (run hourly) that deletes events older than 24 hours.

## Tasks / Subtasks

- [x] **Task 1: Prisma Schema & Migration for Telemetry Events (AC: #4)**
  - [x] Add `TelemetryEvent` model to `packages/db/prisma/schema.prisma`:
    - `id` (String, @id, @default(cuid()))
    - `user_id` (String, optional, references `User.id` with onDelete: Cascade)
    - `event_type` (String)
    - `properties` (Json) // holds keys like location_key, error_code, etc.
    - `created_at` (DateTime, default: now)
    - Add indices: `@@index([event_type])`, `@@index([created_at])`,
      `@@index([user_id])`.
  - [x] Run `npx prisma migrate dev --name add_telemetry_event` to apply schema
        and generate client.
  - [x] Implement Row-Level Security (RLS) policies for `TelemetryEvent` in raw
        SQL:
    - Target: `packages/db/prisma/migrations/.../migration.sql`
    - Policy: Users can select/insert their own telemetry records where
      `user_id = auth.uid()`. Let anonymous/system records (where `user_id` is
      null) be insertable by authenticated services.

- [x] **Task 2: Update Type-Safe Analytics Event Contracts (AC: #3)**
  - [x] Modify `packages/api-client/src/types/analytics-events.ts`:
    - Add new event names to `analyticsEventNameSchema`:
      `'profile_completed' | 'first_outfit_generated' | 'forecast_viewed' |`
      `'alert_sent' | 'location_switched' | 'api_error_occurred'`.
    - Define Zod schemas and TypeScript types for each new event and its
      properties:
      - `profile_completed`: properties `{ user_id, age,`
        `guardian_consent_required, timestamp }`
      - `first_outfit_generated`: properties `{ user_id, location_id,`
        `timestamp, is_first_outfit }`
      - `forecast_viewed`: properties `{ user_id, location_key, status,`
        `timestamp }`
      - `alert_sent`: properties `{ user_id, alert_type, severity,`
        `channel, timestamp }`
      - `location_switched`: properties `{ user_id, from_location,`
        `to_location, timestamp }`
      - `api_error_occurred`: properties `{ user_id, endpoint, method,`
        `status_code, error_message, timestamp }`
    - Implement matching `track*` wrappers (e.g. `trackProfileCompleted()`,
      `trackFirstOutfitGenerated()`, etc.) that normalize fields to snake_case.

- [x] **Task 3: Implement Telemetry Service & Retention Scheduler (AC: #3, #4)**
  - [x] Create `apps/api/src/modules/telemetry/telemetry.module.ts` and
        `telemetry.service.ts`.
  - [x] Implement `TelemetryService.capture(userId: string | null,`
        `eventType: string, properties: Record<string, any>)`:
    - Insert event record into `TelemetryEvent` database table.
    - If `userId` is present, format payload via `packages/api-client`
      wrappers and call `analyticsClient.capture(...)`.
  - [x] Implement `pruneOldTelemetry()` running `@Cron(CronExpression.EVERY_HOUR)`
        or `@Cron('0 * * * *')` to delete `TelemetryEvent` records older than
        24 hours.

- [x] **Task 4: Integrate Telemetry into Feature Modules (AC: #1, #2)**
  - [x] **Profile complete:** In `AuthService.signUp()`, call
        `telemetryService.capture()` with event `profile_completed`.
  - [x] **First outfit:** Expose `trackOutfitGenerated(userId, locationId)` in
        `TelemetryService` that checks the count of existing `OutfitRecommendation`
        records. If count is 1, call `capture()` for `first_outfit_generated` with
        `is_first_outfit: true` properties.
  - [x] **Forecast view:** In `WeatherController.getLatestWeather()`, call
        `telemetryService.capture()` with event `forecast_viewed`.
  - [x] **Alert sent:** In `AlertFanoutProcessor.process()`, call
        `telemetryService.capture()` with event `alert_sent` when an alert is
        successfully published via realtime socket or Expo Push.
  - [x] **Location switch:** In `LocationPreferencesService.setPrimary()`,
        retrieve the previous primary location, set the new primary location, and
        capture `location_switched` event if they differ.

- [x] **Task 5: Implement Global API Exception Filter (AC: #2)**
  - [x] Create `apps/api/src/filters/api-exception.filter.ts`.
  - [x] Extend `BaseExceptionFilter` from `@nestjs/core` to preserve standard
        NestJS error formatting.
  - [x] Intercept exceptions to extract context: `url/endpoint`, `method`,
        `status_code` (from exception or falling back to 500), and `userId` (from
        `request.auth?.userId`).
  - [x] Call `telemetryService.capture` with event `api_error_occurred`
        containing details.
  - [x] Register `ApiExceptionFilter` globally in `apps/api/src/main.ts` via
        `app.useGlobalFilters(new ApiExceptionFilter(app.get(TelemetryService)))`.

- [x] **Task 6: Test Suite Verification & Validation (AC: #1-#4)**
  - [x] Add unit tests for `TelemetryService` covering database capture, PostHog
        forwarding, and scheduler pruner.
  - [x] Add unit tests for `ApiExceptionFilter` ensuring telemetry is sent and
        error response formatting is preserved.
  - [x] Add integration/E2E tests verifying that signup, weather requests,
        location updates, and forced errors generate correct telemetry rows and
        PostHog calls.
  - [x] Run typecheck and lint checking to ensure project cleanliness.

## Dev Notes

### Existing Infrastructure and Reusability

- **PostHog Integration:** The `PostHogService` in
  `apps/api/src/posthog/posthog.service.ts` is bound to the `ANALYTICS_CLIENT`
  Nest token. Inject it using the `@InjectAnalyticsClient()` decorator.
- **Request Context:** Request user ID is set on `request.auth` by
  `RequestAuthGuard` and can be retrieved using `request.auth?.userId`.
- **Database Cleanup:** Ensure `packages/testing/src/cleanup.ts` is updated
  to clean up the `TelemetryEvent` table after each test run.

### Project Structure Notes

- Keep all new telemetry service files inside `apps/api/src/modules/telemetry/`.
- Ensure type-safe contracts are correctly exported from
  `packages/api-client/src/types/analytics-events.ts`.

### References

- [PostHog Service](file:///Users/murat/opensource/couture-cast/apps/api/src/posthog/posthog.service.ts)
- [Analytics Event Schema](file:///Users/murat/opensource/couture-cast/packages/api-client/src/types/analytics-events.ts)
- [Auth Security Guard](file:///Users/murat/opensource/couture-cast/apps/api/src/modules/auth/security.guards.ts)
- [Epic 1 Source](file:///Users/murat/opensource/couture-cast/_bmad-output/planning-artifacts/epics.md#L235)

## Dev Agent Record

### Agent Model Used

Gemini 1.5 Pro
