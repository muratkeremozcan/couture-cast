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

interface HttpExceptionResponse {
  message?: string | string[]
  error?: string
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

      const endpoint = request.url || request.path || 'unknown'
      const method = request.method || 'unknown'
      const userId = request.auth?.userId || null

      let statusCode = HttpStatus.INTERNAL_SERVER_ERROR
      let errorMessage = 'Internal Server Error'

      if (exception instanceof HttpException) {
        statusCode = exception.getStatus()
        const resBody = exception.getResponse() as string | HttpExceptionResponse
        errorMessage =
          typeof resBody === 'string'
            ? resBody
            : Array.isArray(resBody.message)
              ? resBody.message.join(', ')
              : resBody.message || resBody.error || exception.message
      } else if (exception instanceof Error) {
        errorMessage = exception.message
      }

      this.telemetryService
        .captureEvent(userId, 'api_error_occurred', {
          userId,
          endpoint,
          method,
          statusCode,
          errorMessage,
        })
        .catch((err: unknown) => {
          this.logger.error(
            { err },
            'Failed to dispatch api_error_occurred telemetry event'
          )
        })
    } catch (err: unknown) {
      this.logger.error(
        { err },
        'Error in global API exception filter telemetry extraction'
      )
    }
  }
}
