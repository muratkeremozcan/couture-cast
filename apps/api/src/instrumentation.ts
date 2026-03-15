import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node'
import { NodeSDK, core, metrics } from '@opentelemetry/sdk-node'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'

/** Story 0.7 owner file: OpenTelemetry bootstrap and OTLP export configuration.
 * OpenTelemetry (OTEL) in this service:
 * - Why: vendor-neutral observability so traces/metrics/log context are consistent across tools.
 * - Problem solved: fragmented debugging ("logs say one thing, APM says another") and vendor lock-in.
 * - Alternatives: Datadog APM, New Relic, Dynatrace, Elastic APM, Sentry Performance.
 * Ownership anchors:
 * - Story 0.7 Task 4 step 1 owner: define OTLP backend endpoint + auth resolution.
 * - Story 0.7 Task 4 step 2 owner: create OTLP exporters for traces and metrics.
 * - Story 0.7 Task 4 step 3 owner: enable instrumentation + W3C propagation.
 * - Story 0.7 Task 4 step 4 owner: initialize the SDK before app bootstrap.
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
let diagnosticsLoggerConfigured = false
const DEPLOYMENT_ENVIRONMENT_ATTRIBUTE = 'deployment.environment.name'

export function resolveOtelDiagnosticLogLevel(
  env: EnvVars = process.env
): DiagLogLevel | null {
  const value = env.OTEL_LOG_LEVEL?.toLowerCase().trim()

  switch (value) {
    case 'all':
      return DiagLogLevel.ALL
    case 'debug':
      return DiagLogLevel.DEBUG
    case 'info':
      return DiagLogLevel.INFO
    case 'warn':
      return DiagLogLevel.WARN
    case 'error':
      return DiagLogLevel.ERROR
    case 'verbose':
      return DiagLogLevel.VERBOSE
    case 'none':
      return DiagLogLevel.NONE
    default:
      return null
  }
}

export function configureOpenTelemetryDiagnostics(env: EnvVars = process.env): boolean {
  const logLevel = resolveOtelDiagnosticLogLevel(env)
  if (logLevel === null || diagnosticsLoggerConfigured) {
    return false
  }

  diag.setLogger(new DiagConsoleLogger(), logLevel)
  diagnosticsLoggerConfigured = true
  return true
}

export function normalizeGrafanaOtlpAuthHeader(header: string): string {
  const trimmed = header.trim()

  if (trimmed.startsWith('Authorization=')) {
    const rawValue = trimmed.slice('Authorization='.length).trim()

    try {
      return decodeURIComponent(rawValue).trim()
    } catch {
      return rawValue.replace(/%20/g, ' ').trim()
    }
  }

  return trimmed
}

export function resolveGrafanaOtlpAuthHeader(env: EnvVars): string | null {
  const directHeader = env.GRAFANA_OTLP_AUTH_HEADER
  if (directHeader) {
    return normalizeGrafanaOtlpAuthHeader(directHeader)
  }

  const instanceId = env.GRAFANA_INSTANCE_ID
  const apiKey = env.GRAFANA_API_KEY

  if (!instanceId || !apiKey) {
    return null
  }

  const encoded = Buffer.from(`${instanceId}:${apiKey}`).toString('base64')
  return `Basic ${encoded}`
}

export function resolveSignalEndpoint(
  baseUrl: string,
  signal: 'traces' | 'metrics'
): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  const suffix = `/v1/${signal}`

  if (trimmed.endsWith(suffix)) {
    return trimmed
  }

  return `${trimmed}${suffix}`
}

export function createTelemetryResource(env: EnvVars = process.env) {
  const deploymentEnvironment =
    env.APP_ENV ?? env.DEPLOY_ENV ?? env.VERCEL_ENV ?? env.NODE_ENV ?? 'local'

  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? 'couturecast-api',
    [ATTR_SERVICE_VERSION]: env.npm_package_version ?? '0.0.1',
    [DEPLOYMENT_ENVIRONMENT_ATTRIBUTE]: deploymentEnvironment,
  })
}

// Flow ref S0.7/T4/1: define backend endpoint + auth before any exporter is
// created so missing creds can no-op safely.
export function resolveOtlpExporterConfig(
  env: EnvVars = process.env
): OtlpExporterConfig | null {
  const url = env.GRAFANA_OTLP_ENDPOINT
  const authHeader = resolveGrafanaOtlpAuthHeader(env)

  if (!url || !authHeader) {
    return null
  }

  return {
    url,
    headers: {
      Authorization: authHeader,
    },
  }
}

// Flow ref S0.7/T4/2: create OTLP exporters for traces/metrics from the shared
// Grafana config so both signals use the same auth contract.
export function createOpenTelemetrySdkOptions(
  env: EnvVars = process.env
): Partial<NodeSDKConfiguration> | null {
  const exporterConfig = resolveOtlpExporterConfig(env)
  if (!exporterConfig) {
    return null
  }

  const traceExporter = new OTLPTraceExporter({
    ...exporterConfig,
    url: resolveSignalEndpoint(exporterConfig.url, 'traces'),
  })
  const metricExporter = new OTLPMetricExporter({
    ...exporterConfig,
    url: resolveSignalEndpoint(exporterConfig.url, 'metrics'),
  })

  return {
    resource: createTelemetryResource(env),
    traceExporter,
    metricReaders: [
      new metrics.PeriodicExportingMetricReader({
        exporter: metricExporter,
      }),
    ],
    // Flow ref S0.7/T4/3: enable instrumentation + W3C propagation via
    // textMapPropagator + auto-instrumentations.
    textMapPropagator: new core.W3CTraceContextPropagator(),
    instrumentations: [getNodeAutoInstrumentations()],
  }
}

// Flow ref S0.7/T4/4: initialize SDK before app bootstrap so the first request
// path is instrumented instead of starting mid-flight.
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

  configureOpenTelemetryDiagnostics(env)

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
  diagnosticsLoggerConfigured = false
}
