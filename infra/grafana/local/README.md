# Local Grafana stack

Updated: 2026-03-21
Reason: added a local LGTM stack for API traces and metrics and
corrected the local API startup path

This folder provides a local Grafana development stack for the signals
that CoutureCast actually emits today.

What it is for:

- local iteration on `infra/grafana/dashboards/*.json`
- local trace verification without Grafana Cloud credentials
- local API metrics and Tempo traces from the OTEL-enabled API

What it is not for:

- production or shared environments
- queue, Redis, Socket.io, or DB metrics that do not exist yet
- Loki-backed application log verification; structured logs still live in
  the API terminal in this repo

## Start the stack

From the repo root:

```bash
npm run observability:local:up
```

This starts `grafana/otel-lgtm` with:

- Grafana at `http://127.0.0.1:3300`
- OTLP/HTTP ingress at `http://127.0.0.1:4318`
- Prometheus UI at `http://127.0.0.1:9090`

Grafana is configured for anonymous local access. The repo dashboard JSON
files are auto-provisioned on startup.
`observability:local:up` also generates local-only dashboard copies with
shortened datasource UIDs so Grafana provisioning succeeds locally.

## Start the API against local OTLP

Recommended API startup from the repo root:

```bash
npm run observability:local:up
npm run observability:local:api
```

`GRAFANA_OTLP_AUTH_HEADER=disabled` is a local-only escape hatch so the
API can talk to the local stack without fake Grafana Cloud credentials.
`observability:local:api` now wraps the normal repo `start:api` command,
which runs the API from compiled output and rebuilds/restarts it when
either `apps/api` or `@couture/config` changes.

What starts where:

- API: `http://127.0.0.1:4000`
- Grafana: `http://127.0.0.1:3300`
- optional web app: `http://127.0.0.1:3005`

If you also want the web app in a separate terminal:

```bash
npm run start:web
```

## Verify it

1. Start the local stack.
2. Start the API with the copy-paste command above.
3. Hit any API endpoint that passes through OTEL instrumentation, for
   example:

```bash
curl http://127.0.0.1:4000/api/v1/health/queues
```

1. Open `http://127.0.0.1:3300`.
2. Open the CoutureCast folder directly:

   `http://127.0.0.1:3300/dashboards/f/afgoesq31dz40a/couturecast`

3. Open the API dashboard directly:

   `http://127.0.0.1:3300/d/couturecast-api-health/couturecast-api-health`

4. In Explore, select `couturecast-traces` to inspect recent traces.

Expected result:

- `CoutureCast API Health` shows HTTP latency and request-rate panels
- the three non-API dashboards still render as intentional Text panels
- traces appear in Explore for `service.name="couturecast-api"`
- Loki is not the source of truth for app logs in this repo yet

Port note:

- Grafana intentionally uses `3300` so it does not collide with the web
  app on `3005`.
- The local observability flow does not require `start:all`.

## Stop the stack

```bash
npm run observability:local:down
```

To tail container logs:

```bash
npm run observability:local:logs
```
