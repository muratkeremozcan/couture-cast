import { context, trace } from '@opentelemetry/api'
import pino from 'pino'
import type { DestinationStream, LevelWithSilent } from 'pino'
import { getRequestContext } from './request-context'

type EnvVars = Record<string, string | undefined>

type TraceRuntime = {
  getActiveSpan: () =>
    | {
        spanContext: () => {
          spanId: string
          traceFlags?: number
          traceId: string
        }
      }
    | null
    | undefined
}

type CreateBaseLoggerOptions = {
  destination?: DestinationStream
  env?: EnvVars
  traceRuntime?: TraceRuntime
}

const defaultTraceRuntime: TraceRuntime = {
  getActiveSpan: () => trace.getSpan(context.active()),
}

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>
}

export function resolveLogLevel(env: EnvVars = process.env): LevelWithSilent {
  // 1) resolve environment-driven log level policy.
  const explicitLevel = env.LOG_LEVEL
  if (explicitLevel) {
    return explicitLevel as LevelWithSilent
  }

  const runtime = (
    env.APP_ENV ??
    env.DEPLOY_ENV ??
    env.VERCEL_ENV ??
    env.NODE_ENV ??
    'local'
  ).toLowerCase()

  if (runtime === 'production' || runtime === 'prod') {
    return 'warn'
  }

  if (runtime === 'development' || runtime === 'dev') {
    return 'info'
  }

  return 'debug'
}

export function resolveTraceContext(
  traceRuntime: TraceRuntime = defaultTraceRuntime
): Record<string, string | number> {
  const span = traceRuntime.getActiveSpan()
  const spanContext = span?.spanContext()

  if (!spanContext) {
    return {}
  }

  return removeUndefined({
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
    traceId: spanContext.traceId,
  })
}

function shouldUsePrettyTransport(env: EnvVars, destination?: DestinationStream) {
  return !destination && env.PINO_PRETTY === 'true'
}

/** Task 5 (AC #3): shared Pino logger contract.
 * Why this exists:
 * - We need one JSON log shape across HTTP, cron, sockets, and service logs.
 * - Request context and OTEL trace context should attach automatically instead of per call site.
 * - Local debugging still needs a human-readable option without changing production output.
 * Alternatives:
 * - Nest Logger only, which is simpler but weaker for structured fields and child loggers.
 * - A heavier Nest/Pino adapter package, which adds abstraction we do not need yet.
 * Setup steps (where we did this):
 *   1) resolve environment-driven log level policy.
 *   2) inject request + trace context via Pino mixins.
 *   3) keep the base logger reusable for HTTP middleware and feature-specific child loggers.
 */
export function createBaseLogger(options: CreateBaseLoggerOptions = {}) {
  // 3) keep the base logger reusable for HTTP middleware and feature-specific child loggers.
  const env = options.env ?? process.env

  return pino(
    {
      level: resolveLogLevel(env),
      messageKey: 'message',
      formatters: {
        level: (label) => ({ level: label }),
      },
      base: {
        service: 'couturecast-api',
      },
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      transport: shouldUsePrettyTransport(env, options.destination)
        ? {
            target: 'pino-pretty',
            options: {
              colorize: false,
              singleLine: true,
              translateTime: 'SYS:standard',
            },
          }
        : undefined,
      // 2) inject request + trace context via Pino mixins.
      mixin() {
        const requestContext = getRequestContext()
        return removeUndefined({
          feature: requestContext?.feature,
          requestId: requestContext?.requestId,
          userId: requestContext?.userId,
          ...resolveTraceContext(options.traceRuntime ?? defaultTraceRuntime),
        })
      },
    },
    options.destination
  )
}
