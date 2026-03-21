import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagLogLevel } from '@opentelemetry/api'
import { core } from '@opentelemetry/sdk-node'
import {
  configureOpenTelemetryDiagnostics,
  createTelemetryResource,
  createOpenTelemetrySdkOptions,
  initializeOpenTelemetry,
  resolveGrafanaOtlpAuthHeader,
  resolveOtelDiagnosticLogLevel,
  shutdownOpenTelemetry,
  resetOpenTelemetryForTests,
  resolveOtlpExporterConfig,
  resolveSignalEndpoint,
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
    expect(resolveOtlpExporterConfig({ GRAFANA_INSTANCE_ID: '1555123' })).toBeNull()
  })

  it('builds OTLP exporter config with basic auth when instance id and token exist', () => {
    expect(
      resolveOtlpExporterConfig({
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.grafana.net/otlp',
        GRAFANA_API_KEY: 'secret',
        GRAFANA_INSTANCE_ID: '1555123',
      })
    ).toEqual({
      url: 'https://otlp.grafana.net/otlp',
      headers: {
        Authorization: 'Basic MTU1NTEyMzpzZWNyZXQ=',
      },
    })
  })

  it('accepts a direct OTLP auth header override', () => {
    expect(
      resolveOtlpExporterConfig({
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.grafana.net/otlp',
        GRAFANA_OTLP_AUTH_HEADER: 'Authorization=Basic abc123',
      })
    ).toEqual({
      url: 'https://otlp.grafana.net/otlp',
      headers: {
        Authorization: 'Basic abc123',
      },
    })
  })

  it('allows an explicit no-auth override for local OTLP targets', () => {
    expect(
      resolveOtlpExporterConfig({
        GRAFANA_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
        GRAFANA_OTLP_AUTH_HEADER: 'disabled',
      })
    ).toEqual({
      url: 'http://127.0.0.1:4318',
      headers: {},
    })
    expect(
      resolveGrafanaOtlpAuthHeader({
        GRAFANA_OTLP_AUTH_HEADER: 'disabled',
      })
    ).toBeNull()
  })

  it('builds a direct OTLP auth header override when provided', () => {
    expect(
      resolveGrafanaOtlpAuthHeader({
        GRAFANA_OTLP_AUTH_HEADER: 'Authorization=Basic abc123',
      })
    ).toBe('Basic abc123')
  })

  it('decodes URL-encoded direct OTLP auth header overrides', () => {
    expect(
      resolveGrafanaOtlpAuthHeader({
        GRAFANA_OTLP_AUTH_HEADER: 'Authorization=Basic%20abc123',
      })
    ).toBe('Basic abc123')
  })

  it('maps OTEL_LOG_LEVEL strings to OpenTelemetry diagnostic levels', () => {
    expect(resolveOtelDiagnosticLogLevel({ OTEL_LOG_LEVEL: 'debug' })).toBe(
      DiagLogLevel.DEBUG
    )
    expect(resolveOtelDiagnosticLogLevel({ OTEL_LOG_LEVEL: 'info' })).toBe(
      DiagLogLevel.INFO
    )
    expect(resolveOtelDiagnosticLogLevel({ OTEL_LOG_LEVEL: 'warn' })).toBe(
      DiagLogLevel.WARN
    )
    expect(resolveOtelDiagnosticLogLevel({ OTEL_LOG_LEVEL: 'error' })).toBe(
      DiagLogLevel.ERROR
    )
    expect(resolveOtelDiagnosticLogLevel({ OTEL_LOG_LEVEL: 'none' })).toBe(
      DiagLogLevel.NONE
    )
    expect(resolveOtelDiagnosticLogLevel({ OTEL_LOG_LEVEL: 'invalid' })).toBeNull()
  })

  it('configures diagnostics only when OTEL_LOG_LEVEL is set', () => {
    expect(configureOpenTelemetryDiagnostics({})).toBe(false)
    expect(configureOpenTelemetryDiagnostics({ OTEL_LOG_LEVEL: 'debug' })).toBe(true)
    expect(configureOpenTelemetryDiagnostics({ OTEL_LOG_LEVEL: 'debug' })).toBe(false)
  })

  it('resolves signal-specific OTLP URLs for JS exporters', () => {
    expect(resolveSignalEndpoint('https://otlp.grafana.net/otlp', 'traces')).toBe(
      'https://otlp.grafana.net/otlp/v1/traces'
    )
    expect(resolveSignalEndpoint('https://otlp.grafana.net/otlp/', 'metrics')).toBe(
      'https://otlp.grafana.net/otlp/v1/metrics'
    )
    expect(
      resolveSignalEndpoint('https://otlp.grafana.net/otlp/v1/traces', 'traces')
    ).toBe('https://otlp.grafana.net/otlp/v1/traces')
  })

  it('creates a telemetry resource with a stable service name', async () => {
    const resource = createTelemetryResource({
      APP_ENV: 'dev',
      OTEL_SERVICE_NAME: 'couturecast-api',
      npm_package_version: '1.2.3',
    })

    await expect(resource.waitForAsyncAttributes?.()).resolves.toBeUndefined()
    expect(resource.attributes).toMatchObject({
      'service.name': 'couturecast-api',
      'service.version': '1.2.3',
    })
  })

  it('creates SDK options using W3C trace context propagation', () => {
    const options = createOpenTelemetrySdkOptions({
      GRAFANA_OTLP_ENDPOINT: 'https://otlp.grafana.net/otlp',
      GRAFANA_API_KEY: 'secret',
      GRAFANA_INSTANCE_ID: '1555123',
    })

    expect(options).not.toBeNull()
    expect(options?.textMapPropagator).toBeInstanceOf(core.W3CTraceContextPropagator)
    expect(options?.resource?.attributes['service.name']).toBe('couturecast-api')
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
        GRAFANA_INSTANCE_ID: '1555123',
        NODE_ENV: 'development',
      },
      runtime
    )
    const secondInit = initializeOpenTelemetry(
      {
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.grafana.net/otlp',
        GRAFANA_API_KEY: 'secret',
        GRAFANA_INSTANCE_ID: '1555123',
        NODE_ENV: 'development',
      },
      runtime
    )
    const testEnvInit = initializeOpenTelemetry(
      {
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.grafana.net/otlp',
        GRAFANA_API_KEY: 'secret',
        GRAFANA_INSTANCE_ID: '1555123',
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
