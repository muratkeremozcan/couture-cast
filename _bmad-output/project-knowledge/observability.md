<!-- Step 10 support owner: searchable owner anchor -->

# Observability

Updated: 2026-03-21
Reason: added testing, threshold rationale, troubleshooting,
screenshot policy, and local Grafana stack guidance

Status: active

## Current signals

Working now:

- traces export from `apps/api` to Grafana Tempo
- metrics export from `apps/api` to Grafana Prometheus/Mimir
- API service name is `couturecast-api`
- runtime metrics exist under `nodejs_*` and `v8js_*`
- HTTP metrics exist under `http_server_duration_milliseconds_*` and
  `http_client_*`

Not present in the local inventory pass:

- `process*`
- `redis*`
- `bull*`
- `socket*`
- `db*`

Repo evidence for missing custom metrics:

- `apps/api/src/controllers/health.controller.ts` still has queue
  metrics TODOs
- `apps/api/src/modules/gateway/connection-manager.service.ts` logs
  lifecycle events but does not expose Prometheus metrics
- `apps/api/src/config/queues.ts` defines BullMQ queues only
- `apps/api/src/admin/admin.service.ts` handles retries, not DB
  telemetry

## Verified metric inventory

Confirmed in Grafana:

- `http_server_duration_milliseconds_bucket`
- `http_server_duration_milliseconds_count`
- `http_server_duration_milliseconds_sum`
- `http_client_duration_milliseconds_bucket`
- `http_client_duration_milliseconds_count`
- `http_client_duration_milliseconds_sum`
- `http_client_request_duration_seconds_bucket`
- `http_client_request_duration_seconds_count`
- `http_client_request_duration_seconds_sum`
- `nodejs_eventloop_delay_max_seconds`
- `nodejs_eventloop_delay_mean_seconds`
- `nodejs_eventloop_delay_min_seconds`
- `nodejs_eventloop_delay_p50_seconds`
- `nodejs_eventloop_delay_p90_seconds`
- `nodejs_eventloop_delay_p99_seconds`
- `nodejs_eventloop_delay_stddev_seconds`
- `nodejs_eventloop_time_seconds_total`
- `nodejs_eventloop_utilization_ratio`
- `v8js_gc_duration_seconds_bucket`
- `v8js_gc_duration_seconds_count`
- `v8js_gc_duration_seconds_sum`
- `v8js_memory_heap_limit_bytes`

Confirmed label evidence:

- HTTP metric samples included `service_name="couturecast-api"`
- local samples included `deployment_environment_name="local"`

## Dashboard contract

Build charts only from metrics that exist now.

Use real metrics for:

- `CoutureCast API Health`
  Use `http_server_duration_milliseconds_*` for latency and request
  volume.

Use `Text` panels for now:

- `Queue & Cache Metrics`
- `Real-time Connections`
- `Database Performance`

Do not create alerts from placeholder Text panels.

Dashboard exports belong in:

- `infra/grafana/dashboards/`

Expected filenames:

- `couturecast-api-health.json`
- `couturecast-queue-cache-metrics.json`
- `couturecast-realtime-connections.json`
- `couturecast-database-performance.json`

Dashboard screenshots are intentionally skipped for now.

- The repo JSON exports remain the source of truth.
- Import validation plus manual Grafana checks are the required
  evidence instead of image captures.

## Local development

An optional local stack now exists under `infra/grafana/local/`.

Use it when you need:

- local iteration on `infra/grafana/dashboards/*.json`
- local Tempo traces without Grafana Cloud credentials
- local Prometheus-backed API charts for the signals that exist today

Local stack contract:

- start it with `npm run observability:local:up`
- for the simplest reliable local flow, run
  `npm run observability:local:up`, then
  `npm run observability:local:api`
- set `GRAFANA_OTLP_AUTH_HEADER=disabled` for local-only no-auth OTLP
- `observability:local:api` now wraps the normal repo `start:api` path,
  which runs the compiled API and restarts it after successful rebuilds
  in either `apps/api` or `@couture/config`
- the API runs on `4000`
- if you also want the web app, `npm run start:web` runs on `3005`
- open Grafana on `http://127.0.0.1:3300`
- open the CoutureCast folder directly at
  `http://127.0.0.1:3300/dashboards/f/afgoesq31dz40a/couturecast`
- open the API Health dashboard directly at
  `http://127.0.0.1:3300/d/couturecast-api-health/couturecast-api-health`
- use the provisioned Prometheus datasource UID `couturecast-prom`
- use the provisioned Tempo datasource UID `couturecast-traces`

Current limitation stays the same locally:

- queue, cache, realtime, and DB dashboards remain intentional Text
  panels until real metrics exist
- Loki is still not the source of truth for app logs in this repo
- local startup rewrites dashboard datasource UIDs into generated local
  copies because the Grafana Cloud datasource IDs are too long for local
  provisioning validation

## Testing

Automated coverage:

- `apps/api/integration/observability.integration.spec.ts` sends a real
  OTLP trace export to a local capture server and asserts the request
  hits `/v1/traces` with the configured Basic auth header,
  `service.name="couturecast-api"`, and the expected test span name.
- The same integration spec boots the real `AuthModule` behind the
  request logging middleware and asserts structured `request_received`
  and `request_completed` log entries carry the same `requestId`.
- `packages/api-client/src/testing/observability-assertions.ts` provides
  the shared `expectLogEntry(level, message, context)` helper used by
  observability integration tests.

Manual Grafana trace verification:

- Start the API with Grafana OTLP credentials loaded.
- Send one authenticated request with a fixed request ID:

```bash
curl -X POST http://localhost:4000/api/v1/auth/guardian-consent \
  -H 'Authorization: Bearer test-token' \
  -H 'Content-Type: application/json' \
  -H 'x-request-id: req-observe-manual-001' \
  -H 'x-user-id: guardian-123' \
  -H 'x-user-role: guardian' \
  -d '{"guardianId":"guardian-123","teenId":"teen-123","consentLevel":"full","timestamp":"2026-03-21T12:00:00.000Z"}'
```

- Confirm the API responds `201` and echoes
  `x-request-id: req-observe-manual-001`.
- In Grafana Explore, select
  `grafanacloud-couturecastobservability-traces`.
- Set the time range to `Last 15 minutes`, keep query type `Search`,
  and run a blank trace query.
- Confirm a recent trace appears for
  `service.name="couturecast-api"`.
- Open the trace and confirm the request timestamp lines up with the
  manual API call.

Pass criteria:

- the API accepts the request and returns the same `x-request-id`
- a recent Tempo trace appears for `couturecast-api`
- the trace timestamp matches the request you triggered locally

Current limitation:

- Loki log ingestion is not wired in this repo yet, so the Grafana
  manual check is trace-only
- structured log validation is automated locally through the integration
  test above

## Thresholds and rationale

These thresholds are documentation and dashboard interpretation
guidance only.

- Task 11 records a no-notification policy, so nothing here implies
  Slack, PagerDuty, or on-call paging.
- Use these values to judge dashboard health and any future
  Grafana-managed rules if the policy changes later.

Documented thresholds:

- API response time
  Source: `test-design-system.md` performance baselines
  Threshold: `>500ms` at P95
  Current repo status: measurable now via `http_server_*`
  Rationale: the PRD target is `<200ms` P95, so `500ms` marks a clear
  degradation instead of normal variance.
- Database query time
  Source: `test-design-system.md` performance baselines
  Threshold: `>100ms` at P95
  Current repo status: not exported in repo metrics
  Rationale: the baseline doc sets `<50ms` as the target. Until repo
  metrics exist, treat `100ms` as the investigation threshold in
  Supabase insights.
- Weather ingestion
  Source: `test-design-system.md` performance baselines
  Threshold: `>90s` at P99
  Current repo status: not exported in repo metrics
  Rationale: the target is `<60s` end to end, so `90s` captures
  material worker delay without overreacting to single-job noise.
- Alert fan-out
  Source: `test-design-system.md` performance baselines
  Threshold: `>10s` at P95
  Current repo status: not exported in repo metrics
  Rationale: the target is `<5s` per user, so `10s` represents a
  meaningful delivery regression.
- Wardrobe upload pipeline
  Source: `test-design-system.md` performance baselines
  Threshold: `>15s` at P95
  Current repo status: not exported in repo metrics
  Rationale: the target is `<10s`, and `15s` gives room for heavy-image
  variance while still surfacing worker slowdowns.
- BullMQ queue backlog
  Source: `test-design-system.md` resource utilization testing
  Threshold: `>100` queued jobs
  Current repo status: not exported in repo metrics
  Rationale: the legacy test-design baseline already treats `>100`
  queued jobs as backlog pressure.
- Database connections
  Source: `test-design-system.md` resource utilization testing
  Threshold: `>80` active connections
  Current repo status: not exported in repo metrics
  Rationale: `80%` of the documented pool size is the first capacity
  warning line.
- Redis memory
  Source: `test-design-system.md` resource utilization testing
  Threshold: `>800MB` used
  Current repo status: not exported in repo metrics
  Rationale: `80%` of the documented 1 GB limit is the first capacity
  warning line.
- Cache hit rate
  Source: no numeric baseline in current repo docs
  Threshold: deferred
  Current repo status: not exported in repo metrics
  Rationale: do not invent a cache-hit percentage until a real metric
  family and baseline measurement exist.
- Socket.io disconnect rate
  Source: no numeric baseline in current repo docs
  Threshold: deferred
  Current repo status: not exported in repo metrics
  Rationale: connection lifecycle is logged, but there is no repo-side
  disconnect counter or baseline yet.

## Troubleshooting

If Grafana shows no traces:

- verify the API is running locally
- hit `curl http://localhost:4000/api/v1/health/queues`
- use `grafanacloud-couturecastobservability-traces`
- run blank Search first, not TraceQL
- confirm the trace data source row actually shows the `-traces`
  source, not `-prom`
- confirm the API restarted after any env change
- confirm the OTLP request is using Basic auth built from
  `GRAFANA_INSTANCE_ID:GRAFANA_API_KEY`
- look for a local `otel_bootstrap` JSON line with `initialized=true`

If Grafana shows no metrics:

- switch to `grafanacloud-couturecastobservability-prom`
- click the metric selector before judging `No data`
- search broad prefixes such as `http`, `nodejs`, and `v8js`
- wait a short time after traces appear; metrics can lag behind traces
- treat missing `redis*`, `bull*`, `socket*`, and `db*` metrics as
  expected until those signals are instrumented

If telemetry stops exporting:

- confirm `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID`, and
  `GRAFANA_API_KEY`
- restart the API after env changes
- set `OTEL_LOG_LEVEL=debug` and inspect OTEL bootstrap or export logs
- confirm `service.name` still resolves to `couturecast-api`
- confirm the API is not running with `NODE_ENV=test` or
  `OTEL_SDK_DISABLED=true`

If structured logs seem missing:

- check the local API terminal first; Loki is not the source of truth
  yet
- confirm `bindRequestContext` runs before
  `createRequestLoggerMiddleware()` in `apps/api/src/main.ts`
- send a request with a fixed `x-request-id` and confirm the API
  echoes the same header back
- use `apps/api/integration/observability.integration.spec.ts` as the
  contract for expected `request_received` and `request_completed` log
  shapes
