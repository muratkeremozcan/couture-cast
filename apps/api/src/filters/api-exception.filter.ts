import { Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common'
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core'
import { TelemetryService } from '../modules/telemetry/telemetry.service'
import { createBaseLogger } from '../logger/pino.config'

interface AuthenticatedRequest {
  url?: string
  path?: string
  method?: string
  auth?: {
    userId?: string
  }
}

/**
 * Routes excluded from `api_error_occurred` capture.
 *
 * This filter persists one `TelemetryEvent` row per `HttpException`. That is
 * fine for authenticated routes, where a caller has to get past a bearer token
 * before it can generate rows. The affiliate conversion webhook is deliberately
 * unauthenticated, so an anonymous caller posting garbage in a loop would write
 * a row per attempt into a table pruned only hourly: a free amplification vector
 * against storage. Rejections there are logged by the webhook service instead,
 * which is where the useful diagnosis lives anyway.
 *
 * Matched on the resolved route path so a query string cannot slip past it.
 */
const TELEMETRY_EXCLUDED_ROUTES: ReadonlySet<string> = new Set([
  '/api/v1/commerce/affiliate/webhook',
  // Story 5.2: the billing webhooks share the affiliate webhook's exact
  // amplification-vector reasoning — unauthenticated by bearer design, so an
  // anonymous caller must not be able to write a telemetry row per attempt.
  '/api/v1/commerce/subscription/webhooks/stripe',
  '/api/v1/commerce/subscription/webhooks/revenuecat',
])

/**
 * Express routing is case-insensitive and tolerates trailing slashes by default,
 * so the same handler answers `/API/v1/.../webhook/`. Normalizing before the
 * lookup keeps the exclusion from being bypassable by casing the URL.
 */
function normalizeRoute(route: string): string {
  const withoutTrailingSlashes = route.replace(/\/+$/, '')
  return (withoutTrailingSlashes || '/').toLowerCase()
}

function getErrorCodeForStatus(statusCode: HttpStatus): string {
  if (statusCode === HttpStatus.BAD_REQUEST) return 'BAD_REQUEST'
  if (statusCode === HttpStatus.UNAUTHORIZED) return 'UNAUTHORIZED'
  if (statusCode === HttpStatus.FORBIDDEN) return 'FORBIDDEN'
  if (statusCode === HttpStatus.NOT_FOUND) return 'NOT_FOUND'
  if (statusCode === HttpStatus.TOO_MANY_REQUESTS) return 'RATE_LIMIT'
  if (
    statusCode >= HttpStatus.BAD_REQUEST &&
    statusCode < HttpStatus.INTERNAL_SERVER_ERROR
  ) {
    return 'CLIENT_ERROR'
  }
  return 'INTERNAL_ERROR'
}

@Catch()
export class ApiExceptionFilter extends BaseExceptionFilter {
  private readonly logger = createBaseLogger().child({ feature: 'api-exception-filter' })

  constructor(
    adapterHost: HttpAdapterHost,
    private readonly telemetryService: TelemetryService
  ) {
    super(adapterHost.httpAdapter)
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(exception, host)

    try {
      const ctx = host.switchToHttp()
      const request = ctx.getRequest<AuthenticatedRequest | undefined>()

      if (!request) {
        return
      }

      const route = request.path || request.url?.split('?')[0] || 'unknown'

      if (TELEMETRY_EXCLUDED_ROUTES.has(normalizeRoute(route))) {
        // The response has already been sent by `super.catch` above. Only the
        // telemetry row is suppressed.
        return
      }

      const method = request.method || 'unknown'
      const userId = request.auth?.userId || null

      let statusCode = HttpStatus.INTERNAL_SERVER_ERROR
      if (exception instanceof HttpException) {
        statusCode = exception.getStatus() as HttpStatus
      }

      const errorCode = getErrorCodeForStatus(statusCode)

      const telemetryPromise = this.telemetryService.captureEvent(
        userId,
        'api_error_occurred',
        {
          userId,
          route,
          method,
          statusCode,
          errorCode,
        }
      )

      if (
        telemetryPromise !== undefined &&
        typeof (telemetryPromise as unknown as { catch: unknown }).catch === 'function'
      ) {
        telemetryPromise.catch((err: unknown) => {
          this.logger.error(
            { err },
            'Failed to dispatch api_error_occurred telemetry event'
          )
        })
      }
    } catch (err: unknown) {
      this.logger.error(
        { err },
        'Error in global API exception filter telemetry extraction'
      )
    }
  }
}
