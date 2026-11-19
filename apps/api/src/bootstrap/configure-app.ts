import { HttpAdapterHost } from '@nestjs/core'
import { BadRequestException, type INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { NextFunction, Request, Response } from 'express'
import { ApiExceptionFilter } from '../filters/api-exception.filter.js'
import { bindRequestContext } from '../logger/request-context.js'
import { createRequestLoggerMiddleware } from '../logger/request-logger.middleware.js'
import { TelemetryService } from '../modules/telemetry/telemetry.service.js'

/**
 * THE SINGLE OWNER OF POST-CREATE APPLICATION WIRING.
 *
 * This exists because the two bootstraps drifted and nobody could see it. Nest
 * is created in more than one place in this repo, and `api/index.ts` is the only
 * one a deployed environment ever runs: `vercel.json` maps
 * `functions: { "api/index.ts": ... }` and rewrites `/(.*)` to `/api/index`, so
 * `src/main.ts` is a local-only entry. `src/main.ts` installed CORS, the
 * request-context binding, the request logger, and `ApiExceptionFilter`;
 * `api/index.ts` installed none of them.
 *
 * The visible consequence was silent. Nest's built-in exception filter produces
 * the same `{ statusCode, message, error }` envelope `ApiExceptionFilter`
 * produces, so responses looked correct while the filter's other job — writing
 * one `api_error_occurred` TelemetryEvent row per `HttpException` — never ran
 * outside a developer's laptop. Every dashboard built on that event since story
 * 1.4 has been reading local traffic only, on every route.
 *
 * So the rule is: an entrypoint calls this and adds nothing of its own. Anything
 * that must be true of every served request belongs in here, where a new
 * entrypoint gets it by construction rather than by someone remembering.
 *
 * Two things deliberately stay OUT of this function, because they are not
 * true of every entrypoint:
 *   - OpenTelemetry init, which must run before Nest and framework modules are
 *     imported at all, not after an app exists.
 *   - `configureOpenApi`, which is gated on its own env switch.
 */

const DEFAULT_CORS_ORIGIN = 'http://localhost:3000'

export type ConfigureAppOverrides = {
  /** Injected by the spec so wiring can be asserted without a container. */
  adapterHost?: HttpAdapterHost
  /** Injected by the spec so wiring can be asserted without a container. */
  telemetry?: TelemetryService
  corsOrigins?: string[]
  env?: NodeJS.ProcessEnv
}

/**
 * `GUARDIAN_INVITE_WEB_BASE_URL` is the fallback rather than a second source:
 * the guardian invite link is the one URL the API knows a browser will follow
 * back to it, so where no explicit CORS list is configured it is the best
 * available guess at the web origin.
 */
export function resolveHttpCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.HTTP_CORS_ORIGIN ?? env.GUARDIAN_INVITE_WEB_BASE_URL ?? DEFAULT_CORS_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

/**
 * The one answer to a body the JSON parser refused, on every route. `code` matches the
 * location routes' typed 400, which the clients already read; the text names nothing the
 * body held.
 */
export const UNPARSABLE_BODY_RESPONSE = Object.freeze({
  statusCode: 400,
  code: 'invalid_request',
  message: 'The request body could not be read.',
  error: 'Bad Request',
})

/**
 * Express's JSON parser fails with a SyntaxError whose message can quote the body (a coordinate
 * pair from Use my location, a search, anything), and Nest forwards that message to the client.
 * Every parse failure gets one fixed 400 instead, with no text from the body.
 */
export function rejectUnparsableJson(
  error: unknown,
  _request: Request,
  _response: Response,
  next: NextFunction
): void {
  const parseFailed =
    typeof error === 'object' &&
    error !== null &&
    (('type' in error && error.type === 'entity.parse.failed') ||
      (error instanceof SyntaxError && 'body' in error))
  next(parseFailed ? new BadRequestException({ ...UNPARSABLE_BODY_RESPONSE }) : error)
}

/**
 * Must be called BEFORE `app.init()` or `app.listen()`. Express middleware
 * registered after initialization never joins the stack, so a late call fails
 * open — no error, no request context, no logs.
 */
export function configureApp(
  app: INestApplication,
  overrides: ConfigureAppOverrides = {}
): void {
  app.enableCors({
    credentials: true,
    origin: overrides.corsOrigins ?? resolveHttpCorsOrigins(overrides.env),
  })
  app.use(bindRequestContext)
  app.use(createRequestLoggerMiddleware())
  // The JSON parser is registered here, ahead of Nest's default (which then skips its own),
  // so a parse failure can be answered right after it with fixed text.
  const expressApp = app as NestExpressApplication
  expressApp.useBodyParser('json')
  app.use(rejectUnparsableJson)

  const adapterHost: HttpAdapterHost =
    overrides.adapterHost ?? app.get<HttpAdapterHost>(HttpAdapterHost)
  const telemetry: TelemetryService =
    overrides.telemetry ?? app.get<TelemetryService>(TelemetryService)
  app.useGlobalFilters(new ApiExceptionFilter(adapterHost, telemetry))
}
