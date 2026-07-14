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
