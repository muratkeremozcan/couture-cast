# Epic 1 Context: Weather Intelligence & Platform Foundation

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Deliver the weather backbone that makes CoutureCast trustworthy as a daily ritual: fresh forecast ingestion, saved location context, timely weather-shift alerts, and baseline analytics/observability. This epic matters because downstream outfit recommendations, widgets, watch surfaces, and product dashboards all depend on accurate, recent, user-selected weather data and reliable event telemetry.

## Stories

- Story CC-1.1: Weather API ingestion service
- Story CC-1.2: Multi-location preferences
- Story CC-1.3: Alert rules & notification pipeline
- Story CC-1.4: Telemetry & audit baseline

## Requirements & Constraints

Weather ingestion must support current conditions plus hourly forecast data for the active user location, including at least a 48-hour hourly window where required by the epic stories. Refresh cadence must be configurable and run at least every 30 minutes. The user experience must expose freshness; stale weather data older than 60 minutes needs a fallback or delayed-data message instead of silently presenting old conditions as current.

Users must be able to save at least three locations with friendly labels and switch the primary forecast context within two taps. The selected location must persist and propagate to quick-glance surfaces: widgets and watch views need to reflect the selected location within 5 minutes.

Weather alerts must cover temperature delta, precipitation start, and severe-condition triggers with user-configurable thresholds. Alert delivery must respect opt-in, opt-out, and quiet-hour preferences. Triggered alerts must create both push notification payloads and in-app alert cards within 60 seconds, and delayed alert backlog must stay below the product performance threshold.

Analytics must capture activation progress, forecast views, alert sends and deliveries, location switches, and weather API errors in a dashboard-friendly shape. Operational telemetry must include API latency, error rate, provider rate-limit responses, send outcomes, and enough retention for at least 24-hour product analysis. Forecast usage contributes directly to the daily forecast engagement success metric.

Core services for weather fetch, outfit engine dependencies, and sharing workflows target 99.5% uptime excluding scheduled maintenance. Weather provider health checks must alert when error rate exceeds 2% in a 5-minute window, and provider rate limits must degrade gracefully with cached last-known weather plus a user-visible delayed-data notice.

## Technical Decisions

Epic 1 work belongs primarily in the NestJS API weather module, scheduled jobs, BullMQ workers, Prisma-backed weather tables, API contracts, and PostHog/OpenTelemetry instrumentation. Public REST endpoints must live under `/api/v1`, with shared Zod schemas in the API client package as the source of truth before controllers or generated SDK updates land.

Weather ingestion uses a provider adapter pattern. OpenWeather One Call API is the selected primary provider, with WeatherAPI.com as backup after repeated primary failures or rate-limit exhaustion. Failover uses exponential backoff before switching providers, and cached last-known weather is the tertiary fallback for up to 60 minutes. Contract tests must validate provider response shapes against the internal expected schema.

Weather data should persist as timestamped snapshots and forecast segments in Supabase-managed Postgres via Prisma. Store timestamps in UTC and expose ISO 8601 values; canonical weather data remains metric/Celsius, with display conversion handled by locale/user settings. User-scoped data must follow the existing Supabase Auth/RLS and tenant-isolation approach.

BullMQ and NestJS scheduled jobs coordinate provider polling, ingestion throttling, and alert fan-out so the app can respect provider rate limits. Redis/Upstash is available for short-lived cache needs, and edge/client responses should use short TTLs where appropriate so ritual and widget surfaces stay fast without hiding stale data.

Real-time and notification delivery use Socket.io plus Expo Push API. Weather alert events use the `alert:weather` namespace and the shared event payload shape containing version, timestamp, userId, and data. Socket clients must authenticate, retry reconnects with the established backoff lifecycle, and fall back to polling when socket reconnect fails. Push token registration and Expo ticket classification need telemetry so invalid tokens and rate-limit errors can be cleaned up.

Observability uses PostHog for product events and OpenTelemetry/Pino logs routed to Grafana Cloud for service health. Logs should include timestamp, requestId, userId where available, and feature context. Dashboards should support queue depth, API latency, error rate, cache behavior, alert delivery, and provider health inspection.

## UX & Interaction Patterns

The hero ritual is the primary weather surface. It must show time, weather deltas, outfit context, and freshness in a way that supports quick scanning; relative freshness such as "Updated 2 min ago" is preferred for current state, while absolute timestamps are used for forecast/planner entries.

Severe weather appears as a focused alert state on the hero canvas with a merlot-style banner. Push notification taps should deep-link back to the hero ritual with the alert state focused and actions such as adjusting the outfit or planning the week. Invalid deep links fall back to the hero ritual with an informational refreshed-data banner.

Widgets and wearable cards are glanceable entry points, not separate workflows. Widget taps deep-link to the hero ritual with source/slot state encoded, and offline launches should show cached data plus a stale-state toast. Compact widget/watch layouts use the same weather, success, and alert color cues as the main UI.

Accessibility must preserve readable contrast, at least 44px touch targets where applicable, screen-reader order from hero to controls to garments, and ARIA/live announcements when forecast data refreshes. Motion-heavy premium weather treatments must respect reduced-motion preferences.

## Cross-Story Dependencies

Weather ingestion is the foundation for the other Epic 1 stories. Multi-location preferences depend on fresh forecast retrieval, alert rules depend on both data freshness and active location context, and telemetry depends on event sources from ingestion, location switching, and alert delivery.

Epic 2 outfit personalization depends on this epic's forecast data and active location context. Epic 3 widgets/watch/web surfaces depend on the same freshness, selected-location, deep-link, and notification behaviors established here. Epic 0 infrastructure, especially Prisma, Supabase, BullMQ/Redis, Socket.io, Expo Push, PostHog, and OpenTelemetry, must be in place before this epic can be completed.
