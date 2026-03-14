# Grafana dashboard exports

Updated: 2026-03-13 - created dashboard export folder and naming contract

Store exported Grafana dashboard JSON files here.

Expected files:

- `couturecast-api-health.json`
- `couturecast-queue-cache-metrics.json`
- `couturecast-realtime-connections.json`
- `couturecast-database-performance.json`

Export workflow:

1. Open the saved dashboard in Grafana.
2. Click `Export`.
3. Choose `Export as code`.
4. Choose the classic JSON model for repo storage.
5. Save the file in this folder with the expected name.

Rule:

- Export only dashboards backed by real metrics or an intentional Text panel.
- Do not invent metric names in repo JSON exports.
