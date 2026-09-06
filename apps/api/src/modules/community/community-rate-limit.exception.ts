import { HttpException, HttpStatus } from '@nestjs/common'

/**
 * A 429 that carries the instant the caller may retry.
 *
 * The spec's rate-limit row requires the eleventh submission to return "429 with
 * retry time", and the previous implementation returned a bare
 * `HttpException('DAILY_POST_LIMIT_REACHED', 429)` with nothing a client could
 * schedule against.
 *
 * The retry time travels in the `Retry-After` header and NOWHERE ELSE. The body
 * stays exactly `{ statusCode, message, error }` because
 * `tooManyRequestsHttpErrorSchema` is `.strict()` over those three fields and is
 * shared by every 429 in the API — and because a thrown exception bypasses the
 * controller's response `parse`, an extra field here would ship unvalidated and
 * no test would catch it. `Retry-After` is the standard place for this value and
 * the place the contract documents it.
 *
 * `retryAfterSeconds` is carried on the exception object itself, which is what
 * the controller reads to set the header.
 */
export class CommunityRateLimitException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number
  ) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message,
        error: 'Too Many Requests',
      },
      HttpStatus.TOO_MANY_REQUESTS
    )
  }
}
