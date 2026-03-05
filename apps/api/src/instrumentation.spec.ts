import { beforeEach, describe, expect, it, vi } from 'vitest'
import { core } from '@opentelemetry/sdk-node'
import {
  createOpenTelemetrySdkOptions,
  initializeOpenTelemetry,
  shutdownOpenTelemetry,
  resetOpenTelemetryForTests,
  resolveOtlpExporterConfig,
} from './instrumentation'

describe('instrumentation', () => {
  beforeEach(async () => {
    await shutdownOpenTelemetry()
    resetOpenTelemetryForTests()
  })

  it('returns null OTLP exporter config when Grafana credentials are missing', () => {
    expect(resolveOtlpExporterConfig({})).toBeNull()
    expect(
      resolveOtlpExporterConfig({
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.grafana.net/otlp',
      })
    ).toBeNull()
    expect(resolveOtlpExporterConfig({ GRAFANA_API_KEY: 'secret' })).toBeNull()
  })

  it('builds OTLP exporter config with bearer auth when credentials exist', () => {
    expect(
      resolveOtlpExporterConfig({
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.grafana.net/otlp',
        GRAFANA_API_KEY: 'secret',
      })
    ).toEqual({
      url: 'https://otlp.grafana.net/otlp',
      headers: {
        Authorization: 'Bearer secret',
      },
    })
  })

  it('creates SDK options using W3C trace context propagation', () => {
    const options = createOpenTelemetrySdkOptions({
      GRAFANA_OTLP_ENDPOINT: 'https://otlp.grafana.net/otlp',
      GRAFANA_API_KEY: 'secret',
    })

    expect(options).not.toBeNull()
    expect(options?.textMapPropagator).toBeInstanceOf(core.W3CTraceContextPropagator)
  })

  it('initializes once and no-ops in test env', () => {
    const start = vi.fn()
    const shutdown = vi.fn().mockResolvedValue(undefined)
    const runtime = {
      createSdk: () => ({
        start,
        shutdown,
      }),
    }

    const firstInit = initializeOpenTelemetry(
      {
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.grafana.net/otlp',
        GRAFANA_API_KEY: 'secret',
        NODE_ENV: 'development',
      },
      runtime
    )
    const secondInit = initializeOpenTelemetry(
      {
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.grafana.net/otlp',
        GRAFANA_API_KEY: 'secret',
        NODE_ENV: 'development',
      },
      runtime
    )
    const testEnvInit = initializeOpenTelemetry(
      {
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.grafana.net/otlp',
        GRAFANA_API_KEY: 'secret',
        NODE_ENV: 'test',
      },
      runtime
    )

    expect(firstInit).toBe(true)
    expect(secondInit).toBe(false)
    expect(testEnvInit).toBe(false)
    expect(start).toHaveBeenCalledTimes(1)
  })
})
