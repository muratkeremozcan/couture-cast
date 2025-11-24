# Story 0.7: Configure PostHog, OpenTelemetry, and Grafana Cloud

Status: drafted

## Story

As a product team,
I want analytics and observability infrastructure,
so that we can track success metrics and monitor system health across all environments.

## Acceptance Criteria

1. Create PostHog projects: test (CI/dev/staging), production; configure SDK integration in Expo and Next.js apps.
2. Implement event schema per test-design-system.md Analytics Validation Strategy: `ritual_created`, `wardrobe_upload_started`, `alert_received`, `moderation_action`, `guardian_consent_granted`.
3. Set up OpenTelemetry exporters in NestJS (Pino logs → OTLP → Grafana Cloud) with structured logging (timestamp, requestId, userId, feature).
4. Create Grafana dashboards for: queue depth, cache hit rate, Socket.io disconnects, API latency, database query time with alert thresholds per test-design-system.md Performance Baselines.
5. Configure PostHog feature flags with offline mode fallback for tests per ADR-011.

## Tasks / Subtasks

- [ ] Task 1: Create PostHog projects and configure SDKs (AC: #1)
  - [ ] Sign up for PostHog Cloud (or self-hosted)
  - [ ] Create two projects: `couturecast-test` (dev/staging/CI), `couturecast-production`
  - [ ] Install PostHog SDK for Expo: `npm install posthog-react-native --workspace apps/mobile`
  - [ ] Install PostHog SDK for Next.js: `npm install posthog-js --workspace apps/web`
  - [ ] Configure PostHog client in `packages/config/posthog.ts` with project API keys
  - [ ] Initialize PostHog in Expo app: `PostHogProvider` wrapper in App.tsx
  - [ ] Initialize PostHog in Next.js: `app/providers.tsx` with client-side init
  - [ ] Add environment-specific API keys to Doppler (POSTHOG_API_KEY_TEST, POSTHOG_API_KEY_PROD)

- [ ] Task 2: Implement event schema (AC: #2)
  - [ ] Create `packages/api-client/src/types/analytics-events.ts` for event definitions
  - [ ] Define core events per test-design-system.md:
    - `ritual_created`: { userId, locationId, timestamp }
    - `wardrobe_upload_started`: { userId, itemId, fileSize, timestamp }
    - `alert_received`: { userId, alertType, severity, timestamp }
    - `moderation_action`: { moderatorId, targetId, action, reason, timestamp }
    - `guardian_consent_granted`: { guardianId, teenId, consentLevel, timestamp }
  - [ ] Add Zod schemas for event validation
  - [ ] Create helper functions for tracking: `trackRitualCreated()`, `trackWardrobeUpload()`, etc.
  - [ ] Document event schema in `docs/analytics-events.md`

- [ ] Task 3: Implement event tracking in apps (AC: #2)
  - [ ] Add event tracking to mobile app (Expo):
    - Import PostHog from context
    - Track `ritual_created` on outfit generation
    - Track `wardrobe_upload_started` on image upload
    - Track `alert_received` on push notification receipt
  - [ ] Add event tracking to web app (Next.js):
    - Import PostHog client
    - Track same events as mobile
    - Track page views automatically
  - [ ] Add event tracking to API (NestJS):
    - Use PostHog REST API for server-side events
    - Track `moderation_action` in moderation module
    - Track `guardian_consent_granted` in auth module

- [ ] Task 4: Set up OpenTelemetry in NestJS (AC: #3)
  - [ ] Install OpenTelemetry packages:
    ```bash
    npm install @opentelemetry/api @opentelemetry/sdk-node \
      @opentelemetry/auto-instrumentations-node \
      @opentelemetry/exporter-trace-otlp-http \
      @opentelemetry/exporter-metrics-otlp-http \
      --workspace apps/api
    ```
  - [ ] Create `apps/api/src/instrumentation.ts` for OTLP setup
  - [ ] Configure OTLP exporters to Grafana Cloud endpoint
  - [ ] Set up trace context propagation (B3 or W3C Trace Context)
  - [ ] Add OpenTelemetry initialization to `main.ts` (before NestJS bootstrap)

- [ ] Task 5: Configure Pino structured logging (AC: #3)
  - [ ] Install Pino: `npm install pino pino-http pino-pretty --workspace apps/api`
  - [ ] Create `apps/api/src/logger/pino.config.ts` with log format
  - [ ] Configure structured log format: { timestamp, requestId, userId, feature, level, message }
  - [ ] Set up request ID generation middleware (UUID v4)
  - [ ] Integrate Pino with OpenTelemetry: correlate logs with traces
  - [ ] Configure log levels per environment: debug (local), info (dev/staging), warn (prod)
  - [ ] Add Pino HTTP middleware to log all requests/responses

- [ ] Task 6: Set up Grafana Cloud account (AC: #4)
  - [ ] Sign up for Grafana Cloud (free tier)
  - [ ] Create stack: `couturecast-observability`
  - [ ] Generate OTLP endpoint credentials (zone, instance ID, API key)
  - [ ] Add credentials to Doppler: GRAFANA_OTLP_ENDPOINT, GRAFANA_API_KEY
  - [ ] Verify connection: send test trace from local NestJS app
  - [ ] Configure data source in Grafana: Tempo (traces), Loki (logs), Prometheus (metrics)

- [ ] Task 7: Create Grafana dashboards (AC: #4)
  - [ ] Create dashboard: "CoutureCast API Health"
    - Panel: API latency (p50, p95, p99)
    - Panel: Request rate (RPM)
    - Panel: Error rate (5xx responses)
    - Panel: Database query time
    - Alert: p99 latency > 2s for 5 minutes
  - [ ] Create dashboard: "Queue & Cache Metrics"
    - Panel: BullMQ queue depth per queue
    - Panel: Redis cache hit rate
    - Panel: Job processing rate
    - Alert: Queue depth > 1000 for 10 minutes
  - [ ] Create dashboard: "Real-time Connections"
    - Panel: Socket.io active connections
    - Panel: Socket.io disconnect rate
    - Panel: Fallback polling activation count
    - Alert: Disconnect rate > 10/min for 5 minutes
  - [ ] Create dashboard: "Database Performance"
    - Panel: Connection pool usage
    - Panel: Slow queries (>500ms)
    - Panel: Deadlock count
    - Alert: Pool exhaustion (>90% utilization)
  - [ ] Export dashboards as JSON to `infra/grafana/dashboards/`

- [ ] Task 8: Configure PostHog feature flags (AC: #5)
  - [ ] Create feature flags in PostHog:
    - `premium_themes_enabled`: boolean (default: false)
    - `community_feed_enabled`: boolean (default: false)
    - `color_analysis_enabled`: boolean (default: true)
    - `weather_alerts_enabled`: boolean (default: true)
  - [ ] Implement feature flag helper in `packages/config/flags.ts`:
    ```typescript
    export async function getFeatureFlag(flagKey: string, userId: string): Promise<boolean> {
      // Check PostHog first
      // Fall back to Postgres toggle if PostHog unavailable
    }
    ```
  - [ ] Add offline mode fallback: query `feature_flags` table in Postgres
  - [ ] Create migration for `feature_flags` table: { key, enabled, updated_at }
  - [ ] Sync PostHog flags to Postgres via cron job (every 5 minutes)

- [ ] Task 9: Implement analytics validation tests (AC: #2)
  - [ ] (Pruned) analytics scripts will live alongside app code; no separate testing package
  - [ ] Write integration test: verify `ritual_created` event sent to PostHog
  - [ ] Write integration test: verify `guardian_consent_granted` event sent to PostHog
  - [ ] Mock PostHog in CI: capture events in memory, assert schema
  - [ ] Add test helper: `expectEventTracked(eventName, properties)`
  - [ ] Document testing patterns in `docs/analytics-events.md`

- [ ] Task 10: Implement observability tests (AC: #3, #4)
  - [ ] Write integration test: verify OTLP traces sent to Grafana
  - [ ] Write integration test: verify structured logs include requestId
  - [ ] Write E2E test: trigger API request, verify trace in Grafana (manual)
  - [ ] Add test helper: `expectLogEntry(level, message, context)`
  - [ ] Document observability testing in `docs/observability.md`

- [ ] Task 11: Set up alert notification channels (AC: #4)
  - [ ] Configure Grafana alert notification to Slack:
    - Create Slack app and webhook
    - Add contact point in Grafana: `Slack - #alerts`
    - Test alert: manually trigger threshold breach
  - [ ] Configure Grafana alert notification to PagerDuty:
    - Create PagerDuty service for CoutureCast
    - Add contact point in Grafana: `PagerDuty - Oncall`
    - Define on-call schedule
  - [ ] Set alert routing rules:
    - Critical alerts → PagerDuty + Slack
    - Warning alerts → Slack only
    - Info alerts → Grafana only (no notification)

- [ ] Task 12: Document analytics and observability architecture
  - [ ] Create `docs/analytics-events.md` with event catalog
  - [ ] Create `docs/observability.md` with trace/log/metrics strategy
  - [ ] Document PostHog feature flag usage patterns
  - [ ] Add Grafana dashboard screenshots to docs
  - [ ] Document alert thresholds and rationale
  - [ ] Add troubleshooting guide for missing traces/logs

## Dev Notes

### Architecture Context

**Source: docs/bmm-architecture-20251110.md**

**ADR-011 Edge Caching & Experiments (line 228):**
- PostHog experiments for premium/commercial trials
- Vercel Edge Config for caching

**Decision Summary Table (lines 56-72):**
- Analytics/flags: PostHog + OpenTelemetry → Grafana Cloud
- Version: PostHog Cloud 1.83 / OTLP exporter 0.50
- Affects: All epics
- Rationale: Product analytics, feature flags, observability in one stack

**Technology Stack (lines 114-116):**
- PostHog for analytics and feature flags
- OpenTelemetry/Grafana Cloud for observability
- Pino for structured logging

**Integration Points (lines 122-123):**
- PostHog SDKs in Expo/Next.js feed event data
- Server-side uses PostHog REST API for flag checks

**Consistency Rules (lines 154-156):**
- Logging: Pino (API) + consola (clients) emit JSON with timestamp, requestId, userId, feature
- Forwarded via OTLP to Grafana Cloud
- Feature flags: PostHog helpers in `packages/config/flags.ts`; feature code must check flag + fallback to Postgres toggle

**Performance Considerations (line 188):**
- Playwright synthetic monitoring (cron job) hits ritual endpoints to ensure <2s load time
- Telemetry fed into Grafana when breaches occur

### Testing Context

**Analytics Validation Testing:**
- Verify events sent to PostHog with correct schema
- Test feature flag evaluation (online and offline modes)
- Validate event properties match expected types
- Test fallback to Postgres when PostHog unavailable

**Observability Testing:**
- Verify OTLP traces sent to Grafana with correct span structure
- Test log correlation: same requestId in logs and traces
- Validate structured log format in all environments
- Test trace context propagation across service boundaries

**Feature Flag Testing:**
- Test flag evaluation returns correct value
- Test offline mode fallback to Postgres
- Test flag sync from PostHog to Postgres
- Test flag toggle via PostHog UI reflects in app

**Integration Testing:**
- E2E test: user action → event tracked in PostHog
- E2E test: API request → trace visible in Grafana
- E2E test: error logged → appears in Grafana Loki
- E2E test: queue depth increases → metric visible in Grafana

### Implementation Patterns

**PostHog Event Tracking Pattern:**
```typescript
// packages/config/posthog.ts
import posthog from 'posthog-js';

export function trackEvent(eventName: string, properties: Record<string, any>) {
  if (process.env.NODE_ENV === 'test') {
    // Mock in tests
    return;
  }
  posthog.capture(eventName, properties);
}

// Usage in component
trackEvent('ritual_created', {
  userId: user.id,
  locationId: location.id,
  timestamp: new Date().toISOString(),
});
```

**Feature Flag Pattern:**
```typescript
// packages/config/flags.ts
import posthog from 'posthog-js';
import { prisma } from '@couture-cast/db';

export async function getFeatureFlag(
  flagKey: string,
  userId: string,
  fallback: boolean = false
): Promise<boolean> {
  try {
    // Try PostHog first
    const flagValue = await posthog.getFeatureFlag(flagKey, userId);
    return flagValue === true;
  } catch (error) {
    // Fallback to Postgres
    const flag = await prisma.featureFlag.findUnique({
      where: { key: flagKey },
    });
    return flag?.enabled ?? fallback;
  }
}
```

**Structured Logging Pattern:**
```typescript
// apps/api/src/logger/pino.config.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: {
    env: process.env.NODE_ENV,
    service: 'couturecast-api',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Usage in service
logger.info({
  requestId: req.id,
  userId: req.user.id,
  feature: 'outfit-engine',
  duration: Date.now() - startTime,
  msg: 'Generated outfit recommendation',
});
```

**OTLP Configuration Pattern:**
```typescript
// apps/api/src/instrumentation.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.GRAFANA_OTLP_ENDPOINT,
    headers: { Authorization: `Bearer ${process.env.GRAFANA_API_KEY}` },
  }),
  metricExporter: new OTLPMetricExporter({
    url: process.env.GRAFANA_OTLP_ENDPOINT,
    headers: { Authorization: `Bearer ${process.env.GRAFANA_API_KEY}` },
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

### Project Structure Notes

**New Directories:**
```
packages/
├── config/
│   ├── posthog.ts                 # PostHog client config
│   └── flags.ts                   # Feature flag helpers
├── api-client/src/types/
│   └── analytics-events.ts        # Event schema definitions
└── testing/
    └── analytics/
        ├── posthog-mock.ts
        └── analytics.test.ts
apps/api/src/
├── logger/
│   └── pino.config.ts             # Pino logger config
└── instrumentation.ts             # OpenTelemetry setup
infra/grafana/
└── dashboards/
    ├── api-health.json
    ├── queue-cache-metrics.json
    ├── realtime-connections.json
    └── database-performance.json
docs/
├── analytics-events.md            # Event catalog
└── observability.md               # Trace/log/metrics strategy
```

**Environment Variables:**
- `POSTHOG_API_KEY_TEST`: PostHog project key (test)
- `POSTHOG_API_KEY_PROD`: PostHog project key (production)
- `GRAFANA_OTLP_ENDPOINT`: Grafana OTLP endpoint URL
- `GRAFANA_API_KEY`: Grafana API key for OTLP
- `LOG_LEVEL`: Pino log level (debug, info, warn, error)

### References

- [Architecture: ADR-011 Edge Caching & Experiments](docs/bmm-architecture-20251110.md#architecture-decision-records-adrs)
- [Architecture: Decision Summary](docs/bmm-architecture-20251110.md#decision-summary)
- [Architecture: Consistency Rules](docs/bmm-architecture-20251110.md#consistency-rules)
- [Epics: Epic 0 Story CC-0.7](docs/epics.md#epic-0--platform-foundation--infrastructure-sprint-0)
- [PostHog Documentation](https://posthog.com/docs)
- [OpenTelemetry Node.js](https://opentelemetry.io/docs/instrumentation/js/getting-started/nodejs/)
- [Grafana Cloud](https://grafana.com/docs/grafana-cloud/)
- [Pino Logging](https://getpino.io/)

### Learnings from Previous Stories

**From CC-0.1 (Turborepo):**
- Shared packages for cross-app consistency
- Environment-specific configuration

**From CC-0.2 (Prisma):**
- Feature flags fallback to Postgres when PostHog unavailable
- Create migration for `feature_flags` table

**From CC-0.3 (Supabase):**
- Store sensitive keys in Doppler
- Separate test and production projects

**From CC-0.4 (Redis/BullMQ):**
- Monitor queue depth and job latency
- Alert on queue backlog

**From CC-0.5 (Socket.io):**
- Track Socket.io disconnect events
- Monitor connection lifecycle

**From CC-0.6 (CI/CD):**
- Mock PostHog in CI tests
- Track test execution events

**For this story:**
- Event schema must be validated before production
- Feature flags need offline mode for reliability
- Structured logging correlates logs with traces
- Dashboards should reflect performance baselines
- Alert thresholds prevent false positives
- Test analytics and observability in CI

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

<!-- Will be filled by dev agent -->

### Debug Log References

<!-- Will be filled by dev agent during implementation -->

### Completion Notes List

<!-- Will be filled by dev agent upon completion -->

### File List

<!-- Will be filled by dev agent with NEW/MODIFIED/DELETED files -->

## Change Log

| Date | Author | Change |
| ---- | ------ | ------ |
| 2025-11-13 | Bob (Scrum Master) | Story drafted from Epic 0, CC-0.7 acceptance criteria |
