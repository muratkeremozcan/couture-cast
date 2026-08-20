// Step 2 step 4 owner: searchable owner anchor
// Step 9 bootstrap order owner: searchable owner anchor
import 'reflect-metadata'
import './load-env'
import type { AnalyticsClient } from '#analytics/analytics.service'
import {
  initializeOpenTelemetry,
  resolveOtelDiagnosticLogLevel,
  resolveOtlpExporterConfig,
} from './instrumentation'

async function bootstrap() {
  // 4) initialize SDK before app bootstrap
  const otelInitialized = initializeOpenTelemetry()
  const otlpConfig = resolveOtlpExporterConfig(process.env)
  const otelDiagnosticLevel = resolveOtelDiagnosticLogLevel(process.env)

  // Emit one explicit OTEL bootstrap line so local verification is not guesswork.
  console.info(
    JSON.stringify({
      component: 'otel',
      diagnosticsEnabled: otelDiagnosticLevel !== null,
      hasAuthHeader: Boolean(otlpConfig?.headers.Authorization),
      hasEndpoint: Boolean(otlpConfig?.url),
      initialized: otelInitialized,
      level: 'info',
      message: 'otel_bootstrap',
      otelLogLevel: process.env.OTEL_LOG_LEVEL ?? null,
    })
  )

  // Delay Nest/app imports until after OTEL starts so HTTP/framework modules are patched before
  // they load; otherwise incoming request instrumentation can be missed.
  const [
    { NestFactory },
    { AppModule },
    { ANALYTICS_CLIENT },
    { configureApp },
    { configureOpenApi, isOpenApiEnabled },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('#app.module'),
    import('#analytics/analytics.service'),
    import('./bootstrap/configure-app.js'),
    import('#openapi'),
  ])

  // 2) NestFactory.create(AppModule) builds the route graph from that metadata.
  //
  // `rawBody: true` makes Nest keep the unparsed request bytes on
  // `request.rawBody` alongside the parsed body. The affiliate conversion webhook
  // signs `${timestamp}.${rawBody}`, and a re-serialized body differs from the
  // bytes that arrived in JSON key order and whitespace without differing in
  // meaning, so verifying against anything else rejects honest partners.
  //
  // This option must be set on EVERY bootstrap, not just this one. `api/index.ts`
  // is the deployed entry and the test suites create their own applications; a
  // bootstrap without it 401s every signed webhook it serves.
  const app = await NestFactory.create(AppModule, { rawBody: true })

  // CORS, request context, request logging, and ApiExceptionFilter all live in
  // `configureApp` so this entry and the deployed `api/index.ts` cannot drift.
  // They drifted before, and the deployed side lost `api_error_occurred`
  // entirely without any response ever looking wrong.
  configureApp(app)

  const openApiEnabled = isOpenApiEnabled(process.env)
  // Step 13 evidence:
  // this is the API-boundary hook where the OpenAPI surface is attached during bootstrap.
  // Story 0.9 Task 1 step 3 owner:
  // hook OpenAPI setup into the Nest bootstrap flow here.
  //
  // Task 1 hook point: run Swagger setup after Nest has created the app, but before listen(),
  // so the documentation endpoints are available as soon as the server starts.
  if (openApiEnabled) {
    configureOpenApi(app)
  }
  console.info(
    JSON.stringify({
      component: 'openapi',
      enabled: openApiEnabled,
      level: 'info',
      message: 'openapi_bootstrap',
      nodeEnv: process.env.NODE_ENV ?? 'unknown',
    })
  )
  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port)

  try {
    void app.get<AnalyticsClient>(ANALYTICS_CLIENT).capture({
      distinctId: 'api',
      event: 'api_started',
      properties: {
        port,
        nodeEnv: process.env.NODE_ENV ?? 'unknown',
      },
    })
  } catch {
    // Startup should continue even if telemetry wiring fails.
  }
}

bootstrap().catch((error: unknown) => {
  console.error('bootstrap_failed', error)
  process.exit(1)
})
