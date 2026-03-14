# Observability

Updated: 2026-03-14 - trimmed to current signal inventory and dashboard reference

Status: in-progress

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

- `apps/api/src/controllers/health.controller.ts` still has queue metrics TODOs
- `apps/api/src/modules/gateway/connection-manager.service.ts` logs lifecycle
  events but does not expose Prometheus metrics
- `apps/api/src/config/queues.ts` defines BullMQ queues only
- `apps/api/src/admin/admin.service.ts` handles retries, not DB telemetry

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
  Use `http_server_duration_milliseconds_*` for latency and request volume.

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

## Troubleshooting

If Grafana shows no traces:

- verify the API is running locally
- hit `curl http://localhost:3000/api/v1/health/queues`
- use `grafanacloud-couturecastobservability-traces`
- run blank Search first, not TraceQL

If Grafana shows no metrics:

- switch to `grafanacloud-couturecastobservability-prom`
- click the metric selector before judging `No data`
- search broad prefixes such as `http`, `nodejs`, and `v8js`

If telemetry stops exporting:

- confirm `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_INSTANCE_ID`, and `GRAFANA_API_KEY`
- restart the API after env changes
- set `OTEL_LOG_LEVEL=debug` and inspect OTEL bootstrap/export logs
