import {
  BadRequestException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  locationRequestErrorResponseSchema,
  locationUnavailableResponseSchema,
  type LocationRequestErrorCode,
  type LocationUnavailableErrorCode,
} from '../../contracts/http'

/** A typed 400 the clients localize by `code`. */
export function locationRequestError(
  code: LocationRequestErrorCode,
  message: string
): BadRequestException {
  return new BadRequestException(
    locationRequestErrorResponseSchema.parse({
      statusCode: 400,
      code,
      message,
      error: 'Bad Request',
    })
  )
}

/** A typed, retryable 503 the clients localize by `code`. */
export function locationUnavailableError(
  code: LocationUnavailableErrorCode,
  message: string
): ServiceUnavailableException {
  return new ServiceUnavailableException(
    locationUnavailableResponseSchema.parse({
      statusCode: 503,
      code,
      retryable: true,
      message,
      error: 'Service Unavailable',
    })
  )
}

/**
 * The shared rate-limit contract: the body stays exactly
 * `{ statusCode, message, error }` and the retry time travels only in
 * `Retry-After`, which the controller sets from `retryAfterSeconds`.
 */
export class LocationSearchRateLimitException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many location searches. Try again shortly.',
        error: 'Too Many Requests',
      },
      HttpStatus.TOO_MANY_REQUESTS
    )
  }
}
