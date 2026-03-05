import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node'
import { NodeSDK, core, metrics } from '@opentelemetry/sdk-node'

/** Task 3: Implement event tracking in apps (AC: #2)
 * OpenTelemetry (OTEL) in this service:
 * - Why: vendor-neutral observability so traces/metrics/log context are consistent across tools.
 * - Problem solved: fragmented debugging ("logs say one thing, APM says another") and vendor lock-in.
 * - Alternatives: Datadog APM, New Relic, Dynatrace, Elastic APM, Sentry Performance.
 * - Core setup steps (where we did this):
 *   1) define backend endpoint + auth
 *   2) create OTLP exporters for traces/metrics
 *   3) enable instrumentation + propagation standard (W3C here)
 *   4) initialize SDK before app bootstrap
 */
type EnvVars = Record<string, string | undefined>

type TelemetrySdk = Pick<NodeSDK, 'start' | 'shutdown'>

type InitializeRuntime = {
  createSdk?: (options: Partial<NodeSDKConfiguration>) => TelemetrySdk
}

type OtlpExporterConfig = {
  headers: Record<string, string>
  url: string
}

let telemetrySdk: TelemetrySdk | null = null

// 1) define backend endpoint + auth
export function resolveOtlpExporterConfig(
  env: EnvVars = process.env
): OtlpExporterConfig | null {
  const url = env.GRAFANA_OTLP_ENDPOINT
  const apiKey = env.GRAFANA_API_KEY

  if (!url || !apiKey) {
    return null
  }

  return {
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  }
}

// 2) create OTLP exporters for traces/metrics
export function createOpenTelemetrySdkOptions(
  env: EnvVars = process.env
): Partial<NodeSDKConfiguration> | null {
  const exporterConfig = resolveOtlpExporterConfig(env)
  if (!exporterConfig) {
    return null
  }

  const traceExporter = new OTLPTraceExporter(exporterConfig)
  const metricExporter = new OTLPMetricExporter(exporterConfig)

  return {
    traceExporter,
    metricReaders: [
      new metrics.PeriodicExportingMetricReader({
        exporter: metricExporter,
      }),
    ],
    // 3) enable instrumentation + propagation standard (W3C here)
    // createOpenTelemetrySdkOptions() via textMapPropagator + auto-instrumentations.
    textMapPropagator: new core.W3CTraceContextPropagator(),
    instrumentations: [getNodeAutoInstrumentations()],
  }
}

// 4) initialize SDK before app bootstrap
export function initializeOpenTelemetry(
  env: EnvVars = process.env,
  runtime: InitializeRuntime = {}
): boolean {
  if (env.NODE_ENV === 'test' || env.OTEL_SDK_DISABLED === 'true' || telemetrySdk) {
    return false
  }

  const options = createOpenTelemetrySdkOptions(env)
  if (!options) {
    return false
  }

  const createSdk =
    runtime.createSdk ??
    ((sdkOptions: Partial<NodeSDKConfiguration>) => new NodeSDK(sdkOptions))
  telemetrySdk = createSdk(options)
  telemetrySdk.start()

  return true
}

export async function shutdownOpenTelemetry(): Promise<void> {
  if (!telemetrySdk) {
    return
  }

  await telemetrySdk.shutdown()
  telemetrySdk = null
}

export function resetOpenTelemetryForTests() {
  telemetrySdk = null
}
