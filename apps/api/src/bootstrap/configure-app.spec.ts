import { HttpAdapterHost } from '@nestjs/core'
import { BadRequestException, type INestApplication } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiExceptionFilter } from '../filters/api-exception.filter'
import { bindRequestContext } from '../logger/request-context'
import { TelemetryService } from '../modules/telemetry/telemetry.service'
import express, { type NextFunction, type Request, type Response } from 'express'
import request from 'supertest'
import {
  configureApp,
  createJsonBodyParser,
  JSON_BODY_LIMIT_BYTES,
  resolveHttpCorsOrigins,
  UNPARSABLE_BODY_RESPONSE,
} from './configure-app'

/**
 * These tests exist because the deployed entrypoint silently lacked all four of
 * these wirings and no response ever looked wrong. Nest's built-in filter emits
 * the same envelope `ApiExceptionFilter` emits, so the only observable symptom
 * was an `api_error_occurred` dashboard that had never seen deployed traffic.
 *
 * A wiring assertion here is therefore the only cheap thing standing between a
 * future entrypoint and the same invisible regression.
 */

type AppDouble = {
  enableCors: ReturnType<typeof vi.fn>
  use: ReturnType<typeof vi.fn>
  useGlobalFilters: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

function createAppDouble(): AppDouble {
  return {
    enableCors: vi.fn(),
    use: vi.fn(),
    useGlobalFilters: vi.fn(),
    get: vi.fn(),
  }
}

const adapterHost = { httpAdapter: {} } as HttpAdapterHost
const telemetry = {} as TelemetryService

describe('resolveHttpCorsOrigins', () => {
  it('splits, trims, and drops empty entries from HTTP_CORS_ORIGIN', () => {
    expect(
      resolveHttpCorsOrigins({
        HTTP_CORS_ORIGIN: ' https://a.example , ,https://b.example ',
      })
    ).toEqual(['https://a.example', 'https://b.example'])
  })

  it('falls back to the guardian invite base URL when no CORS list is set', () => {
    expect(
      resolveHttpCorsOrigins({ GUARDIAN_INVITE_WEB_BASE_URL: 'https://web.example' })
    ).toEqual(['https://web.example'])
  })

  it('falls back to localhost when neither variable is set', () => {
    expect(resolveHttpCorsOrigins({})).toEqual(['http://localhost:3000'])
  })

  it('prefers HTTP_CORS_ORIGIN over the guardian invite base URL', () => {
    expect(
      resolveHttpCorsOrigins({
        HTTP_CORS_ORIGIN: 'https://explicit.example',
        GUARDIAN_INVITE_WEB_BASE_URL: 'https://fallback.example',
      })
    ).toEqual(['https://explicit.example'])
  })
})

describe('configureApp', () => {
  let app: AppDouble

  beforeEach(() => {
    app = createAppDouble()
  })

  function configure(overrides = {}) {
    configureApp(app as unknown as INestApplication, {
      adapterHost,
      telemetry,
      env: {},
      ...overrides,
    })
  }

  it('enables CORS with credentials against the resolved origin list', () => {
    configure({ env: { HTTP_CORS_ORIGIN: 'https://web.example' } })

    expect(app.enableCors).toHaveBeenCalledWith({
      credentials: true,
      origin: ['https://web.example'],
    })
  })

  it('binds the request context before the request logger', () => {
    configure()

    expect(app.use).toHaveBeenCalledTimes(3)
    expect(app.use.mock.calls[0]?.[0]).toBe(bindRequestContext)
    expect(typeof app.use.mock.calls[1]?.[0]).toBe('function')
  })

  // 2026-11-19 review: a JSON parse failure must not quote the body anywhere.
  it('installs the JSON parser after the request logger, named so Nest adds no second one', () => {
    configure()

    const parser = app.use.mock.calls[2]?.[0] as { name: string } | undefined
    expect(parser?.name).toBe('jsonParser')
  })

  it('installs ApiExceptionFilter as a global filter', () => {
    configure()

    expect(app.useGlobalFilters).toHaveBeenCalledTimes(1)
    expect(app.useGlobalFilters.mock.calls[0]?.[0]).toBeInstanceOf(ApiExceptionFilter)
  })

  it('resolves the filter dependencies from the container when not injected', () => {
    app.get.mockImplementation((token: unknown) => {
      if (token === HttpAdapterHost) return adapterHost
      if (token === TelemetryService) return telemetry
      throw new Error('unexpected token')
    })

    configureApp(app as unknown as INestApplication, { env: {} })

    expect(app.get).toHaveBeenCalledWith(HttpAdapterHost)
    expect(app.get).toHaveBeenCalledWith(TelemetryService)
    expect(app.useGlobalFilters.mock.calls[0]?.[0]).toBeInstanceOf(ApiExceptionFilter)
  })

  it('applies all four wirings in one call', () => {
    configure()

    expect(app.enableCors).toHaveBeenCalledTimes(1)
    expect(app.use).toHaveBeenCalledTimes(3)
    expect(app.useGlobalFilters).toHaveBeenCalledTimes(1)
  })
})

/**
 * The parser alone behind a recording error handler: what reaches `next` is what an exception
 * filter, a log line or a tracing wrapper around the middleware could see.
 */
describe('createJsonBodyParser', () => {
  function harness() {
    const handed: unknown[] = []
    const server = express()
    server.use(createJsonBodyParser())
    server.post('/', (req: Request & { rawBody?: Buffer }, res: Response) => {
      res.json({
        rawBytes: req.rawBody?.length ?? null,
        keys: Object.keys((req.body as Record<string, unknown> | undefined) ?? {}),
      })
    })
    server.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      handed.push(error)
      const status =
        error instanceof BadRequestException
          ? error.getStatus()
          : ((error as { status?: number }).status ?? 500)
      res.status(status).end()
    })
    return { server, handed }
  }

  const BODY_TEXT = /41\.88|87\.63|latitude|longitude|Unexpected|JSON/

  it('hands next one fixed 400 that carries no body text', async () => {
    const { server, handed } = harness()

    const response = await request(server)
      .post('/')
      .set('content-type', 'application/json')
      .send('{"latitude": 41.88, "longitude": -87.63x}')

    expect(response.status).toBe(400)
    expect(handed).toHaveLength(1)
    const error = handed[0] as BadRequestException
    expect(error).toBeInstanceOf(BadRequestException)
    expect(error.getResponse()).toEqual(UNPARSABLE_BODY_RESPONSE)
    expect(error.cause).toBeUndefined()
    for (const text of [
      error.message,
      JSON.stringify(error.getResponse()),
      String(error.stack),
    ])
      expect(text).not.toMatch(BODY_TEXT)
  })

  function bodyOf(bytes: number) {
    const prefix = '{"pad":"'
    const suffix = '"}'
    return prefix + 'a'.repeat(bytes - prefix.length - suffix.length) + suffix
  }

  it('keeps the raw bytes and the 100 kB limit', async () => {
    const { server, handed } = harness()

    const atLimit = await request(server)
      .post('/')
      .set('content-type', 'application/json')
      .send(bodyOf(JSON_BODY_LIMIT_BYTES))
    expect(atLimit.status).toBe(200)
    expect(atLimit.body).toEqual({ rawBytes: 102_400, keys: ['pad'] })

    const overLimit = await request(server)
      .post('/')
      .set('content-type', 'application/json')
      .send(bodyOf(JSON_BODY_LIMIT_BYTES + 1))
    expect(overLimit.status).toBe(413)
    expect((handed[0] as { type?: string }).type).toBe('entity.too.large')
  })
})
