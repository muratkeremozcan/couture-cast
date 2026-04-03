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
    { bindRequestContext },
    { createRequestLoggerMiddleware },
    { configureOpenApi, isOpenApiEnabled },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('#app.module'),
    import('#analytics/analytics.service'),
    import('#logger/request-context'),
    import('#logger/request-logger.middleware'),
    import('#openapi'),
  ])

  // 2) NestFactory.create(AppModule) builds the route graph from that metadata.
  const app = await NestFactory.create(AppModule)
  app.use(bindRequestContext)
  app.use(createRequestLoggerMiddleware())
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
