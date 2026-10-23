# Epic 1 Context: Weather Intelligence & Platform Foundation

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Deliver the weather backbone every other CoutureCast experience depends on: fresh forecast
ingestion, saved and selectable member locations captured from the product UI, timely weather-shift
alerts, and the analytics baseline that measures activation and forecast habit. Outfit
recommendations, widgets, the watch glance, the community climate band, and City Spotlight all read
the active location and its forecast, so accuracy and freshness here decide whether the daily ritual
is trustworthy.

## Stories

- Story CC-1.1: Weather API ingestion service
- Story CC-1.2: Multi-location preferences
- Story CC-1.2b: Client location capture
- Story CC-1.3: Alert rules & notification pipeline
- Story CC-1.4: Telemetry & audit baseline

## Requirements & Constraints

- Ingest current conditions plus a 48-hour hourly forecast per active location on a configurable
  cadence of at most 30 minutes.
- Show freshness to the user. Data older than 60 minutes is stale and carries a delayed-data notice;
  provider rate limits degrade to cached last-known weather with that notice.
- Members save at least three labeled locations, mark one primary, and switch within two taps; the
  choice persists, and widgets and watch reflect it within 5 minutes.
- Location capture works on web and mobile: search, then save provider-resolved coordinates,
  timezone, and canonical city, region, and country. A member with no saved location gets a guided
  add-location path on the ritual. Controls are localized (EN US/CA, ES LatAm, FR CA/EU) and
  accessible.
- Alerts cover temperature delta, precipitation start, and severe conditions with configurable
  thresholds per alert type. Push payloads and in-app alert cards go out within 60 seconds of a
  trigger, with under 1% delayed beyond 3 minutes. Opt-out and quiet hours are honored.
- Analytics capture activation (profile complete plus first outfit), forecast views, alert sends and
  deliveries, location switches, and weather API errors in a dashboard-friendly schema with at least
  24-hour retention. Event tracking is anonymous. Targets: activation of at least 75% within 2
  minutes and at least 1.5 forecast views per user per day.
- Weather fetch is a core service with a 99.5% uptime target. Alert when provider error rate exceeds
  2% in a 5-minute window.

## Technical Decisions

- Weather lives in the NestJS API weather module with Prisma-backed weather tables
  (`weather_snapshots`, `forecast_segments`) on Supabase Postgres under Supabase Auth and RLS.
- Providers sit behind a `IWeatherProvider.fetchForecast(target, signal)` adapter that normalizes to
  metric, UTC, 48-hour payloads before a transactional write. OpenWeather One Call (4.0, compatible
  with 3.0) is primary; WeatherAPI.com is a bounded secondary.
- The ingestion orchestrator owns retry and failover. A primary `429` fails over at once; primary
  timeouts or `5xx` get three attempts total (immediate, +5s, +15s), then one secondary attempt.
  BullMQ per-location jobs use `attempts: 1` so queue retries never multiply provider calls.
- Latest-weather reads return the newest persisted snapshot with a freshness state of `fresh`,
  `cached`, `stale`, or `unavailable`.
- A BullMQ 5 Job Scheduler drives the `weather-refresh-sweep` cadence in the standalone worker
  runtime. Vercel HTTP instances run no weather cron. BullMQ also throttles alert fan-out.
- Provider health telemetry goes to OpenTelemetry and Grafana with bounded provider, outcome, and
  status attributes. Product events go to PostHog. Logs are JSON with `timestamp`, `requestId`,
  `userId`, and `feature`.
- Public REST sits under `/api/v1` and starts in the shared Zod contracts in
  `packages/api-client/src/contracts/http/*`; controllers, OpenAPI JSON, and the SDK are
  downstream. Responses use `{ data }`, lists add `meta`, errors use `{ error: { code, message } }`.
  The ritual reads by `locationId`.
- Once client surfaces consume the locations and weather APIs, Pact consumer contracts guard against
  client and server drift.
- Store UTC `TIMESTAMPTZ`, expose ISO 8601, keep canonical units metric/Celsius, and convert for
  display per locale.
- Alerts use the `alert:weather` Socket.io namespace with the shared `{ version, timestamp, userId,
data }` envelope, mirrored to Expo Push. Sockets require an auth token, reconnect with backoff,
  then fall back to `GET /api/v1/events/poll`. Expo tickets classify `DeviceNotRegistered` and
  `MessageRateExceeded` for token cleanup.

## UX & Interaction Patterns

- The hero ritual is the primary weather surface. Use relative freshness ("Updated 2 min ago") for
  current state and absolute timestamps for forecasts.
- Severe weather shows a merlot banner on the hero. A push tap opens the hero with the alert focused
  and actions to adjust the outfit or plan the week; invalid deep links land on the hero with an
  info banner.
- Widget taps deep-link to the hero with source and slot encoded; offline launches show cached data
  with a stale-state toast.
- Empty states use one empathetic sentence plus a single action CTA, which fits the no-location path.
- Touch targets are at least 44px. Screen-reader order runs hero, chips, garments; forecast refresh
  is announced through an ARIA live region. Reduced motion suppresses weather motion backdrops.

## Cross-Story Dependencies

- CC-1.1 feeds everything. CC-1.2 needs CC-1.1. CC-1.3 needs CC-1.1 freshness and CC-1.2 active
  location. CC-1.4 instruments events from CC-1.1 through CC-1.3, and can start alongside CC-1.1 once
  the API schema is agreed.
- CC-1.2b builds on the CC-1.2 locations API and on CC-6.6, and must prove a UI-saved location
  drives the ritual, the community climate band (CC-6.1), and City Spotlight area stamping. It relies
  on CC-3.2 localization.
- Epic 2 outfit generation and Epic 3 widgets, watch, and deep links consume this epic's forecast,
  freshness, and selected-location behavior. Epic 0 infrastructure (Prisma, Supabase, BullMQ and
  Redis, Socket.io, Expo Push, PostHog, OpenTelemetry) is assumed in place.
