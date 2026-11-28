import { HttpAdapterHost } from '@nestjs/core'
import { BadRequestException, type INestApplication } from '@nestjs/common'
import {
  FLAT_LAY_CONFIRM_PATH,
  FLAT_LAY_REVIEW_PATH,
} from '@couture/api-client/contracts/http'
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express'
import { ApiExceptionFilter } from '../filters/api-exception.filter.js'
import { bindRequestContext, normalizedRequestRoute } from '../logger/request-context.js'
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

/** Body-parser's default limit, kept explicit for both parsers: 100 kB. */
export const JSON_BODY_LIMIT_BYTES = 102_400
const FLAT_LAY_CONFIRM_LIMIT_BYTES = 2 * 1024 * 1024

function isJsonParseFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('type' in error && error.type === 'entity.parse.failed') ||
      (error instanceof SyntaxError && 'body' in error))
  )
}

/**
 * The application's JSON parser. Express's parser fails with a SyntaxError whose message can quote
 * the body (a coordinate pair from Use my location, a search, anything). Its own callback swaps
 * that error for one fixed 400 before anything else sees it, so neither the client, the
 * exception filter nor a tracing wrapper around this middleware can record body text. It keeps
 * `request.rawBody` for the signed webhooks, as Nest's `rawBody: true` does, and the same 100 kB
 * limit.
 */
/** Keeps the unparsed bytes on `request.rawBody`, as Nest's `rawBody: true` does. */
function keepRawBody(
  request: Request & { rawBody?: Buffer },
  _response: unknown,
  buffer: Buffer
) {
  if (Buffer.isBuffer(buffer)) request.rawBody = buffer
}

export function createJsonBodyParser() {
  const parseDefault = json({ limit: JSON_BODY_LIMIT_BYTES, verify: keepRawBody })
  const parseConfirm = json({ limit: FLAT_LAY_CONFIRM_LIMIT_BYTES, inflate: false })
  return function jsonParser(request: Request, response: Response, next: NextFunction) {
    const route = normalizedRequestRoute(request.path)
    if (route === FLAT_LAY_REVIEW_PATH) return next()
    const parse = route === FLAT_LAY_CONFIRM_PATH ? parseConfirm : parseDefault
    parse(request, response, (error?: unknown) => {
      if (error === undefined) return next()
      next(
        isJsonParseFailure(error)
          ? new BadRequestException({ ...UNPARSABLE_BODY_RESPONSE })
          : error
      )
    })
  }
}

/** Nest's URL-encoded defaults (`extended: true`, 100 kB), with the raw body kept. */
export function createUrlencodedBodyParser() {
  const parse = urlencoded({
    extended: true,
    limit: JSON_BODY_LIMIT_BYTES,
    verify: keepRawBody,
  })
  return function urlencodedParser(
    request: Request,
    response: Response,
    next: NextFunction
  ) {
    const route = normalizedRequestRoute(request.path)
    if (route === FLAT_LAY_REVIEW_PATH || route === FLAT_LAY_CONFIRM_PATH) return next()
    parse(request, response, next)
  }
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
  // The body parsers belong to this function, so every app that comes through here is created
  // with `bodyParser: false` (configure-app.spec.ts checks each caller). Nest would otherwise add
  // its own, and it recognizes an existing parser only by function name, which tracing renames.
  // The JSON parser answers a parse failure inside its own callback with fixed text.
  app.use(createJsonBodyParser())
  app.use(createUrlencodedBodyParser())

  const adapterHost: HttpAdapterHost =
    overrides.adapterHost ?? app.get<HttpAdapterHost>(HttpAdapterHost)
  const telemetry: TelemetryService =
    overrides.telemetry ?? app.get<TelemetryService>(TelemetryService)
  app.useGlobalFilters(new ApiExceptionFilter(adapterHost, telemetry))
}
