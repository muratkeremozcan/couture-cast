// Story 6.12 test owner: I-O-OTLP, the real SDK and the real exporter against a local OTLP server.
// A real sweep records through the production meter, so a metric the dashboard names has to reach
// the wire, and every attribute on the wire has to be in the closed label set.
import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  initializeOpenTelemetry,
  resetOpenTelemetryForTests,
  shutdownOpenTelemetry,
} from '../src/instrumentation.js'
import { createModerationOpsChannel } from '../src/modules/moderation/moderation-sla.channel.js'
import {
  createOpenTelemetryModerationSlaMeter,
  MODERATION_SLA_METRIC_NAMES,
} from '../src/modules/moderation/moderation-sla.telemetry.js'
import {
  SLA_HOUR_MS,
  moderationSlaTestContext,
} from './helpers/moderation-sla-harness.js'

vi.setConfig({ testTimeout: 60_000 })

const NOW = new Date('2026-11-05T12:00:00.000Z')
const ctx = moderationSlaTestContext({ now: NOW })
const inMs = (ms: number) => new Date(NOW.getTime() + ms)

type OtlpAttribute = { key: string; value: { stringValue?: string } }
type OtlpDataPoint = { attributes?: OtlpAttribute[]; asDouble?: number; asInt?: number }
type OtlpMetric = {
  name: string
  gauge?: { dataPoints: OtlpDataPoint[] }
  sum?: { dataPoints: OtlpDataPoint[] }
}
type OtlpMetricsBody = {
  resourceMetrics?: { scopeMetrics?: { metrics?: OtlpMetric[] }[] }[]
}

async function startOtlpServer() {
  const bodies: OtlpMetricsBody[] = []
  const server = createServer((request, response) => {
    void (async () => {
      let raw = ''
      for await (const chunk of request) raw += String(chunk)
      if (request.url?.endsWith('/v1/metrics') && raw) {
        bodies.push(JSON.parse(raw) as OtlpMetricsBody)
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{}')
    })()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return {
    endpoint: `http://127.0.0.1:${port}/otlp`,
    metrics: () =>
      bodies.flatMap((body) =>
        (body.resourceMetrics ?? []).flatMap((resource) =>
          (resource.scopeMetrics ?? []).flatMap((scope) => scope.metrics ?? [])
        )
      ),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

const dataPoints = (metric: OtlpMetric) =>
  metric.gauge?.dataPoints ?? metric.sum?.dataPoints ?? []

/** Every label this monitor may put on the wire, with the values it may carry. */
const CLOSED_LABELS: Record<string, Record<string, readonly string[]>> = {
  moderation_sla_open_cases: { state: ['on_track', 'at_risk', 'breached'] },
  moderation_sla_oldest_pending_review_age_seconds: {},
  moderation_sla_alerts_total: { kind: ['at_risk', 'breached', 'escalated'] },
  moderation_sla_delivery_failures_total: {
    code: [
      'timeout',
      'network',
      'http_3xx',
      'http_4xx',
      'http_5xx',
      'invalid_config',
      'interrupted',
    ],
  },
}

describe('I-O-OTLP: a real sweep reaches a real OTLP server', () => {
  beforeEach(async () => {
    await shutdownOpenTelemetry()
    resetOpenTelemetryForTests()
  })

  afterEach(async () => {
    await shutdownOpenTelemetry()
    resetOpenTelemetryForTests()
  })

  it('exports the four metric names, each with only its closed labels', async () => {
    const otlp = await startOtlpServer()
    try {
      expect(
        initializeOpenTelemetry({
          GRAFANA_API_KEY: 'secret',
          GRAFANA_INSTANCE_ID: '1555123',
          GRAFANA_OTLP_ENDPOINT: otlp.endpoint,
          NODE_ENV: 'development',
        })
      ).toBe(true)
      const atRisk = await ctx.seedCase({ dueAt: inMs(SLA_HOUR_MS) })
      const breached = await ctx.seedCase({ dueAt: inMs(-SLA_HOUR_MS) })
      ctx.capture().respondWith(500)

      const result = await ctx
        .sweep({
          channel: createModerationOpsChannel({ url: ctx.capture().url }),
          meter: createOpenTelemetryModerationSlaMeter(),
        })
        .run()
      expect(result.recorded).toBe(2)
      expect(result.failed).toBe(2)

      await shutdownOpenTelemetry()

      const exported = otlp.metrics().filter((metric) => {
        return metric.name.startsWith('moderation_sla_')
      })
      expect(exported.map((metric) => metric.name).sort()).toEqual(
        [...MODERATION_SLA_METRIC_NAMES].sort()
      )
      for (const metric of exported) {
        const closed = CLOSED_LABELS[metric.name] as Record<string, readonly string[]>
        expect(dataPoints(metric).length, metric.name).toBeGreaterThan(0)
        for (const point of dataPoints(metric)) {
          const attributes = point.attributes ?? []
          expect(attributes.map(({ key }) => key).sort(), metric.name).toEqual(
            Object.keys(closed).sort()
          )
          for (const { key, value } of attributes) {
            expect(closed[key], `${metric.name}.${key}`).toContain(value.stringValue)
          }
        }
      }

      // The values are the sweep's, so a wire that dropped them could not pass.
      const wire = JSON.stringify(exported)
      const byName = (name: string) =>
        exported.find((metric) => metric.name === name) as OtlpMetric
      const value = (point: OtlpDataPoint) => point.asInt ?? point.asDouble
      const openByState = new Map(
        dataPoints(byName('moderation_sla_open_cases')).map((point) => [
          point.attributes?.[0]?.value.stringValue,
          value(point),
        ])
      )
      expect(openByState.get('at_risk')).toBe(1)
      expect(openByState.get('breached')).toBe(1)
      expect(
        dataPoints(byName('moderation_sla_delivery_failures_total')).map(value)
      ).toEqual([2])

      for (const identifier of [
        atRisk.caseId,
        atRisk.targetId,
        atRisk.anchorReportId,
        breached.caseId,
        breached.anchorReportId,
      ]) {
        expect(wire).not.toContain(identifier)
      }
    } finally {
      await otlp.close()
    }
  })
})
