import { HttpAdapterHost } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiExceptionFilter } from '../filters/api-exception.filter'
import { bindRequestContext } from '../logger/request-context'
import { TelemetryService } from '../modules/telemetry/telemetry.service'
import { configureApp, resolveHttpCorsOrigins } from './configure-app'

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

    expect(app.use).toHaveBeenCalledTimes(2)
    expect(app.use.mock.calls[0]?.[0]).toBe(bindRequestContext)
    expect(typeof app.use.mock.calls[1]?.[0]).toBe('function')
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
    expect(app.use).toHaveBeenCalledTimes(2)
    expect(app.useGlobalFilters).toHaveBeenCalledTimes(1)
  })
})
